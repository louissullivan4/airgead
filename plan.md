Phase 0 Implementation Spec — for Claude Code
Goal of Phase 0: make the app multi-tenant and secure without changing user-visible behaviour. No new features. Every existing endpoint must still work at the end.

There is no schema in the repo. Tables (users, expenses, user_invites) exist only on the live DB. Do not invent column definitions — capture the real schema first (Task 1).
No migration tooling exists. Introduce node-pg-migrate. Do not add an ORM. Migrations are plain SQL.
JWT payload is currently { userId, role } (see userController.login, dashboardLogin, gf.generateJwtToken). It has no org context. Phase 0 adds orgId to the token.
All controllers read req.user.userId. Preserve that. Add org scoping alongside, don't replace.
req.pool is injected via poolMiddleware. Use it; don't import the pool directly in new code.
This is a live database with real users. Every destructive step must be reversible and gated. Run nothing against production automatically.

Hard constraints

Backward compatible: old JWTs (without orgId) must not 500 the API — handle their absence gracefully (treat as "needs re-login" with 401, never a crash).
Each migration has a working down.
No endpoint loses functionality. The diff to controllers should be minimal and mechanical.
Secrets/.env untouched except documented additions.

Task 0 — Rename equiLedger → rian
Prerequisite: human confirms final name + has secured domain and checked CRO/EUIPO. Claude Code must not invent the name.
0.1 Cosmetic layer (safe): replace user-facing "EquiLedger"/"equiledger" in: README.md, UI copy, package.json name (both repos), app.json/manifest, email templates and sender identity, support strings. Add a BRAND constant in one config module so the name lives in a single place going forward — no more scattered string literals.
0.2 Identifier layer (gated, human-run): produce a docs/rename-runbook.md listing the external renames the human performs, not Claude Code:

GitHub repo rename (GitHub auto-redirects old URLs, but update remotes).
New Cloud Run service under the new name; deploy; then update mobile/servers.txt + frontend SERVER_URL env to the new URL; verify before deleting the old service.
npm package name (if published).

0.3 Explicitly out of scope for Phase 0 (document, don't do): GCS bucket rename (buckets are immutable — handled via object-key prefix in Task 6, full bucket migration deferred), Postgres database name. Leave both as-is.
0.4 Add a regression check: grep the codebase for the old name post-rename; the only permitted remaining references are in docs/rename-runbook.md and historical migration comments.


Task 1 — Capture current schema & set up migrations

Add node-pg-migrate and a migrate script to package.json ("migrate": "node-pg-migrate -j sql"), configured to read DB_URL.
Create /migrations directory.
Create docs/schema-capture.md with the exact commands the human must run against production and paste back:

pg_dump --schema-only "$DB_URL" > db/schema.sql
fallback: psql "$DB_URL" -c "\d users" -c "\d expenses" -c "\d user_invites"


STOP and wait for the human to commit db/schema.sql. Do not write any ALTER/migration touching existing tables until that file exists in the repo. Write a baseline migration that is a no-op reflecting the captured schema (so migration history has a known starting point).


Claude Code: if db/schema.sql is absent, do Tasks 1 and 6 (those don't need it) and leave a clear TODO blocking Tasks 2–5.

Task 2 — organisations table + accounts evolution
Write migration 001_organisations_and_accounts:
up:

Create organisations: id (uuid, pk, default gen), name text not null, type text check in ('personal','business') not null, owner_account_id (uuid, nullable for now — set in Task 3), subscription_level, renewal_date, is_auto_renew, payment_method (copy types from captured users schema), created_at, updated_at.
Alter users (do not rename the table in Phase 0 — too risky with live queries; keep users, treat it as "accounts" conceptually):

add org_id uuid, FK → organisations(id), nullable for now (backfilled in Task 3).
add org_role text check in ('owner','member') default 'owner'.
add platform_role text check in ('user','super_admin') default 'user'.


Add index on users(org_id) and expenses(user_id) if not already present.

down: drop the added columns and the organisations table.

Keep the existing role column for now — don't drop it in Phase 0. Map it in Task 3, remove it in a later phase once nothing reads it.

Task 3 — Data backfill migration (the gated, destructive-ish one)
Write migration 002_backfill_orgs as idempotent SQL:

For every existing user, create a personal organisation, set users.org_id to it, org_role='owner'.
Preserve accountant groupings: the human will confirm whether inviter_id is populated.

If a user has inviter_id pointing to an accountant, instead of a solo org, attach them as a member of the inviter's organisation. (Write the SQL to handle both cases; guard the inviter branch behind a clear comment so it's easy to disable.)


Map old role → new axes: role IN ('admin') → platform_role='super_admin'; role IN ('accountant') → org_role='owner' on a business-type org; everyone else org_role='owner' on personal org.
After backfill: set organisations.owner_account_id, then a follow-up migration 003_enforce_not_null makes users.org_id NOT NULL.


Claude Code: put a banner comment at the top of 002 and 003: "DESTRUCTIVE / DATA-DEPENDENT — do not run until db/schema.sql committed and inviter_id question answered." Provide a dry-run query (counts of users, users-with-inviter, expected orgs created) the human runs first.

Task 4 — JWT carries org context

gf.generateJwtToken and both login paths (login, dashboardLogin): add orgId and orgRole, platformRole to the signed payload alongside existing userId/role (keep role for backward compat this phase).
authMiddleware.authenticateToken: after verify, if orgId missing from token, return 401 with a re-login required message (not 403, not 500). This handles users holding pre-migration tokens.

Task 5 — Tenant-scoping middleware + query scoping

New src/middlewares/tenantScope.js: exports scopeToOrg that reads req.user.orgId and attaches it; and requirePlatformRole(role) / requireOrgRole(role) replacing the overloaded authoriseRole usage. super_admin bypasses org checks.
expenseModel: add an org_id predicate to every read/write/delete. Since expenses currently keys on user_id, Phase 0 scoping = "user_id belongs to req.user.orgId." Add a guard in controllers that rejects cross-org access with 403. (Full expenses.org_id denormalisation can be a Phase 0.5 migration; for now enforce via the user→org relationship to keep the change small.)
Update expenseController and userController: every handler that fetches/mutates by :id must verify the target belongs to the caller's org (or caller is super_admin).

Task 6 — GCS: private objects + signed URLs + tenant key prefix

imageUpload.js: remove file.makePublic(). Change object key from ids/${filename} to org_${orgId}/${year}/${receiptId}.${ext} (orgId from req.user.orgId, year from now). Stop returning a public storage.googleapis.com URL; store the object path in DB instead of a public URL.
New src/utils/signedUrl.js: getSignedUrl(objectPath, ttlSeconds=300).
New endpoint GET /expenses/:id/receipt-url (authed + org-scoped) returning a fresh signed URL.
imageDownload.js: update to read by stored object path rather than parsing a public URL.
Migration 004_receipt_path (data, gated): existing rows store full public URLs in receipt_image_url; write SQL to extract the object path. Provide a dry-run SELECT first. Flag clearly that old objects are still public in the bucket until a one-time makePrivate script (provide scripts/lockdown-bucket.js, run manually) is executed.


Deliverables checklist for Claude Code

 package.json: node-pg-migrate + scripts
 /migrations/000_baseline … 004_receipt_path
 docs/schema-capture.md + committed db/schema.sql (human-provided)
 tenantScope.js, updated authMiddleware.js, signedUrl.js
 Updated imageUpload.js, imageDownload.js, both controllers, both models, gf.js
 scripts/lockdown-bucket.js (manual run)
 docs/phase-0-runbook.md: exact order to run, dry-run queries, rollback steps
 Existing tests pass; add tests for tenant isolation (user A cannot read user B's expense) and for missing-orgId-token → 401

Suggested commit/PR order

Migration tooling + schema capture (Task 1, 6-no-op parts)
Schema migrations 001 (Task 2)
JWT + auth changes (Task 4) — deploy, everyone re-logs in
Backfill 002/003 (Task 3) — gated
Tenant scoping (Task 5)
GCS lockdown 004 + bucket script (Task 6)