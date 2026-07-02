# Phase 3 - Accountant ↔ Client workspace

This phase adds the relationship an accountancy practice needs: oversight of a
client's **separate, isolated** organisation (read + export), without the
accountant ever becoming a member of that org.

> **Phase 3.1 update - firms with multiple accountants.** A practice can now be a
> real firm: a self-serve "accountancy practice" signup creates a flagged firm
> org whose signer is the **admin accountant** (org owner); the admin invites
> **other accountants** (firm members); each accountant **owns the clients they
> invite** (`accountant_org_links.created_by`). A **member accountant sees only
> their own clients**, the **admin sees every client** in the firm, and the admin
> can **reassign** a client to another accountant. See the "Firms" section below.

## The three relationships (keep them distinct)

1. **Accountant ↔ Client org** - *cross-org oversight* (new in Phase 3). An
   explicit grant row in `accountant_org_links`, **not** membership. The client
   owns their own org; the accountant is granted read access to it.
2. **Org admin ↔ Member** - *same-org membership* (pre-existing). An invited user
   *joins the inviter's org* (`users.inviter_id`, `org_role='member'`, provisioned
   by `createUserWithOrg(mode='invite')`). Surfaced in the **Team** tab.
3. **Member → expenses** - *data scoping* (pre-existing). Rows are in-scope when
   their `user_id` belongs to the caller's org (`orgPredicate` in
   `expenseModel` / `receiptModel`).

> Never model accountant→client by putting clients in the accountant's org.
> Clients must have isolated orgs; the accountant's access is a separate grant.

## The link table

`backend/migrations/007_accountant_client_links.sql` (additive, reversible, no
backfill):

```
accountant_org_links
  id                 uuid PK
  accountant_org_id  uuid  → organisations(id)   -- the practice
  client_org_id      uuid  → organisations(id)   -- the client's own org
  created_by         uuid  → users(id)           -- the inviting accountant
  status             text  CHECK in ('pending','active','revoked') DEFAULT 'pending'
  created_at / updated_at
  UNIQUE (accountant_org_id, client_org_id)

organisations.is_accountant_practice  boolean NOT NULL DEFAULT false
```

A client invite encodes `{ email, accountant_org_id, created_by, kind:'client' }`.
On signup, `createUserWithOrg` runs the normal **self** org-creation (the client
becomes owner of a brand-new org) **and**, in the same transaction, inserts an
`accountant_org_links` row with `status='active'`. Member invites
(`kind` absent → `mode='invite'`) are unaffected and write no link.

### Enabling a practice / firm

**Phase 3.1:** self-serve at signup - choosing "This is an accountancy practice"
sets `organisation.is_accountant_practice = true`; `createUserWithOrg` writes the
flag (and forces `type='business'`), making the signer the firm **admin/owner**.
The flag can still be flipped directly in the DB for existing orgs:

```sql
UPDATE organisations SET is_accountant_practice = true WHERE id = '<org-id>';
```

## Firms: admin vs member, per-accountant clients (Phase 3.1)

- **Firm** = org with `is_accountant_practice=true`.
- **Admin accountant** = firm **owner** (`orgRole='owner'`): sees every firm
  client, manages accountants (Team tab), can reassign clients.
- **Member accountant** = firm **member** (`orgRole='member'`): invited by the
  admin via the existing owner-only `POST /organisations/:id/invite-member`.
  Because the firm org is flagged, members automatically get the Clients tab and
  may invite/own/revoke **their own** clients. They cannot see the Team tab.
- **Client ownership** is `accountant_org_links.created_by` - the accountant who
  invited the client. **Reassignment** (admin-only) simply updates `created_by`.

## The accessible-set scoping rule (security-critical)

A user may read: **their own org**, plus the **client orgs they hold an active
link to**. Ownership-aware: a firm **admin (owner)** / `super_admin` sees **all**
firm clients; a **member accountant** sees only clients where
`created_by = their userId`.

- `accountantLinkModel.getAccessibleOrgIds(pool, user)` →
  `[ownOrgId, ...activeClientOrgIds]` (members filtered to `created_by = userId`;
  owners/super_admin get all); `null` for super_admin (= "all", matching the
  `orgId=null` bypass convention in the expense/receipt models).
- `accountantController.assertClientAccess(req, res, clientOrgId)` runs on **every**
  accountant→client request: super_admin passes; otherwise an **active**
  `accountant_org_links` row must exist **and** the caller must be the firm owner
  *or* the link's `created_by`. A missing/revoked link, or another accountant's
  client → **403**, and the data layer is never reached. The client-supplied
  `clientOrgId` is never trusted without this check.

Cross-org access lives only in dedicated `/accountant/*` endpoints. The existing
`/expenses`, `/receipts`, `/users`, `/organisations` routes stay scoped to the
token's own org and are unchanged - single-org behaviour is identical.

## Endpoints

| Method & path | Guard | Purpose |
|---|---|---|
| `POST /organisations/:id/invite-client` | `requireAccountantPractice` | Send a client invite (provisions a separate org + active link on signup). |
| `GET /accountant/clients` | active links | Linked client orgs with this-tax-year stats (count, expense/income totals, last activity). |
| `GET /accountant/clients/:clientOrgId/transactions` | `assertClientAccess` | The client org's line items (`?year=` optional). |
| `GET /accountant/clients/:clientOrgId/export` | `assertClientAccess` | Excel + receipt-image zip (default), or `?format=csv`. Reuses `gf.generateExcel` + `imageDownload`. |
| `DELETE /accountant/clients/:clientOrgId/link` | `assertClientAccess` | Revoke access (`status='revoked'`); member only their own, admin any. |
| `PATCH /accountant/clients/:clientOrgId/assign` | `requireOrgRole('owner')` | Reassign a client to another firm accountant (updates `created_by`). |
| `GET /organisations/:id/members` | `requireOrgRole('owner')` | Org member / firm-accountant list (Team tab). |
| `POST /organisations/:id/invite-member` | `requireOrgRole('owner')` | Member / accountant invite (joins the org). |

## Frontend

- **Nav gating** (`app/(app)/layout.tsx`): the app layout fetches the caller's
  org; the desktop sidebar shows **Clients** when `is_accountant_practice` (or
  super_admin) and **Team** when the caller is the owner of a *business* org.
  Solo personal users see neither.
- **Clients** (`/clients`): tight table (name + `org_category` tag, right-aligned
  tabular totals, last activity, row menu Open/Export/Revoke), search, and the
  primary purple **Invite client** action. Empty state prompts the first invite.
  For the **admin** it also shows an **Accountant** column (owning accountant) and
  a per-row **Reassign** action (dialog lists firm accountants via
  `api.organisations.members`).
- **Client detail** (`/clients/[clientOrgId]`): the shared `TransactionsTable` in
  `readOnly` mode behind a persistent "Viewing *client* · read-only" context bar
  with Export / Back.
- **Team** (`/team`): owner-only. For a firm it relabels to **Accountants** /
  "Invite an accountant"; otherwise "Team" / "Invite member".
- **Signup** (`app/(auth)/signup/page.tsx`): a "This is an accountancy practice"
  checkbox in the org section flags the new firm.
- **Landing** (`app/page.tsx`): a quiet "For accountants" header link and one
  honest line about managing a whole client book.

## Tests

`backend/test/accountant.test.js` covers: client invite → separate org + active
link (owner, not member); member invite still joins the inviter's org with no
link; accountant reads a linked client; 403 on an unlinked org; 403 on a revoked
link; solo user's accessible set is only their own org; super_admin bypass.
**Phase 3.1:** firm-signup flag sets `is_accountant_practice`/business (and stays
false for ordinary signups); `listClients` scopes a member by `ownerUserId` but
not an admin; `assertClientAccess` denies a member a colleague's client yet allows
their own and allows the admin any; reassignment validates firm membership and is
blocked for non-owners by the route guard.
