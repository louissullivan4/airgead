# Phase 0 runbook — multi-tenancy & security hardening

This is the operational guide for rolling out Phase 0 against the live database.
Read `docs/schema-capture.md` first — migrations 002–004 are **blocked** until
`db/schema.sql` is committed and the column-type / `inviter_id` questions are
answered.

## Prerequisites

- `DB_URL` is set to the target database (use a **dev/staging** copy first).
- `db/schema.sql` captured and committed; types in `001` reconciled (esp.
  `users.id` → `organisations.owner_account_id`).
- `npm install` has been run (adds `node-pg-migrate`).

## Run order

Migrations live in `backend/migrations/` and run via `npm run migrate up`
(append `down` to roll back the most recent). They run in filename order:
`000_baseline` → `001` → `002` → `003` → `004`.

### 1. Tooling + rename + GCS code (no DB change)
Already in code. Deploy normally. Verify `npm run check:brand` passes.

### 2. Migration 001 — organisations + accounts (additive, reversible)
```bash
npm run migrate up        # applies 000_baseline then 001
# rollback: npm run migrate down   (undoes 001)
```
Adds `organisations`, `users.org_id/org_role/platform_role`, indexes. No data
change yet. Safe to deploy with the app running.

### 3. JWT + auth (Task 4) — deploy, then everyone re-logs in
Deploy the code. Existing tokens have no `orgId`, so `authenticateToken` returns
**401 "Session out of date, please log in again."** Clients must re-login to get
a token carrying org claims. This is expected and non-destructive.

> Order note: `org_id` is null until step 4 backfills it, so freshly issued
> tokens will carry `orgId = null` until backfill completes. Run step 4 promptly
> after deploying 001, or sequence 4 before re-login traffic ramps.

### 4. Backfill 002 / 003 (GATED, data-dependent)
Run the dry-run queries embedded at the top of each file FIRST:
```sql
SELECT count(*) FROM users;
SELECT count(*) FROM users WHERE inviter_id IS NOT NULL;
SELECT count(*) FROM users WHERE org_id IS NULL;
```
Decide whether to enable the inviter branch in `002` (commented by default).
Then:
```bash
npm run migrate up        # applies 002_backfill_orgs then 003_enforce_not_null
```
`003` will fail if any user still lacks an org — re-run `002` (idempotent) until
`SELECT count(*) FROM users WHERE org_id IS NULL;` returns 0.
Rollback: `npm run migrate down` (003 then 002; 002's down clears org linkage).

### 5. Tenant scoping (Task 5)
Code-only; deployed with the app. Verify isolation (see Verification below).

### 6. GCS lockdown 004 + bucket script (Task 6)
```bash
# dry run the DB rewrite first (see SELECT in 004_receipt_path.sql), then:
npm run migrate up        # applies 004_receipt_path
# objects are still public until you run, manually:
node scripts/lockdown-bucket.js --dry-run
node scripts/lockdown-bucket.js
```

## Verification

```bash
cd backend && npm test         # unit + tenant-isolation tests
npm run migrate up && npm run migrate down   # against a DEV DB: round-trips cleanly
```

Manual smoke (against dev):
- Log in → token now contains `orgId/orgRole/platformRole`.
- List / create / view / update / delete your own expenses still work.
- `GET /expenses/:id/receipt-url` returns a working signed URL for your receipt.
- Request another org's expense id → **403/404** (no data returned).
- Use a pre-Phase-0 token (no `orgId`) → **401** re-login.

## Rollback summary

| Step | Rollback |
|------|----------|
| 004  | `migrate down` (DB lossy — see banner); objects unaffected |
| 003  | `migrate down` (drops NOT NULL) |
| 002  | `migrate down` (clears org linkage, deletes orgs) |
| 001  | `migrate down` (drops columns + organisations table) |
| Code | redeploy previous build |

## Open items / known gaps (follow-ups, not Phase 0)

- **`getAllUsers`** (admin/accountant) still returns users across all orgs — an
  accountant should be scoped to their org. Tighten to `super_admin` only, or
  org-scope it, in a follow-up. `getAssignedUsers` (by `inviter_id`) is already
  scoped.
- **New-user provisioning**: `createUser` issues a token via `generateJwtToken`
  before the new account has an `org_id`, so that token is immediately stale
  (401 on next call). New accounts need org assignment at creation — future work.
- **`expenses.org_id` denormalisation** (Phase 0.5) would let scoping drop the
  `user_id IN (SELECT ... )` subquery.
