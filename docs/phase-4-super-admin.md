# Phase 4 - Super-admin platform dashboard

A platform-wide surface for `platform_role='super_admin'`: an overview of **every**
organisation and user (regardless of who created them), type-selectable invites,
read-only drill-down into any org, and management actions including
GDPR-compliant deletion.

## Roles & gating
- `super_admin` already bypasses org scoping, `assertClientAccess`,
  `requireOrgRole`, and `allowOrgAccess`. Phase 4 wires the previously-unused
  `requirePlatformRole('super_admin')` to a new `/admin/*` router.
- Frontend: the **Admin** nav item and `/admin` page show only when
  `session.platformRole === 'super_admin'`.

## Enable / disable accounts (reversible)
- **User** - `users.account_status` ('active' | 'suspended').
- **Org** - `organisations.status` ('active' | 'suspended'), added by
  `migration 008_org_status.sql` (additive, reversible).
- Enforced at **login** (`userController.login`): a suspended user, or a member of
  a suspended org, gets 403. (Stateless JWTs already issued lapse at expiry -
  suspension blocks new logins.) Suspend a firm for non-payment, reactivate to
  restore - no data loss.

## GDPR hard-delete (irreversible)
A full cascade in one transaction, plus best-effort removal of stored receipt
images (`storage.deleteObject`, added for both the local and GCS drivers):
- **Delete org** (`DELETE /admin/orgs/:id`) - `adminModel.deleteOrgCascade`:
  erases the org, all its users, their expenses + receipts (+ image objects), and
  all `accountant_org_links` where the org is the accountant or the client.
- **Delete user** (`DELETE /admin/users/:id`) - if the user **solely owns** their
  org, the whole org is cascaded; if they own an org with **other members** →
  **409** (delete the org or reassign first); a plain member is erased via
  `adminModel.deleteUserCascade` (their data removed, any links they owned have
  `created_by` set NULL so the firm keeps access).
- **Self-targeting is blocked** (own user / own org) to avoid lockout. DB work is
  transactional; image deletion runs after commit and never fails the request.

## Invites (type-selectable)
`POST /admin/invite { email, kind:'user'|'accountant' }` signs a platform invite
token `{ email, kind:'platform', is_accountant_practice: kind==='accountant' }`.
On signup (`userController.register`, `kind==='platform'` branch) the invitee
creates their **own** org (`mode='self'`); an **accountant** invite flags it as a
firm (they become admin/owner). Org is auto-created and refined later in Settings.

## Endpoints (`/admin/*`, all `requirePlatformRole('super_admin')`)

| Method & path | Purpose |
|---|---|
| `GET /admin/overview` | Platform counts + this-tax-year totals. |
| `GET /admin/orgs` | Every org with stats, member count, firm flag, status. |
| `GET /admin/users` | Every user with org name + role/status fields. |
| `POST /admin/invite` | Invite a regular user or an accountant (firm). |
| `PATCH /admin/users/:id/platform-role` | Grant / revoke super_admin (not self). |
| `PATCH /admin/users/:id/status` | Suspend / reactivate a user (not self). |
| `DELETE /admin/users/:id` | GDPR-erase a user (cascades their solely-owned org). |
| `PATCH /admin/orgs/:id/status` | Suspend / reactivate an org (not own). |
| `DELETE /admin/orgs/:id` | GDPR-erase an org and all its data. |

Read-only drill-down into **any** org reuses the existing
`/accountant/clients/:id/transactions` + export (super_admin bypasses the link
gate); the client-detail page resolves an unlinked org's name via
`GET /organisations/:id`.

## Frontend
- `app/(app)/admin/page.tsx` - stat cards + Organisations table (Open / Suspend /
  Delete) + Users table (Grant/Revoke super admin / Suspend / Delete), one search
  box, and an **Invite** button. Destructive actions confirm via `AlertDialog`;
  the caller's own rows hide self-destructive actions.
- `components/invite-dialog.tsx` - gains an optional `kinds` selector (a
  `Segmented`); the admin passes Regular user / Accountant.

## Tests - `backend/test/admin.test.js`
Route guard (403 non-super / pass super); platform invite token flagging
(accountant vs user) + unknown-kind 400; self-target blocks for role/status/org;
delete routing (member → `deleteUserCascade`; sole owner → `deleteOrgCascade`;
owner-with-members → 409; own org → 400) with image cleanup; login rejects a
suspended user and a suspended org.

## Seed
`demo@rian.dev` is the platform super admin for now (`platform_role='super_admin'`,
password `Password123!`) - log in to reach the Admin dashboard.
