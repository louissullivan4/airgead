# ⚠️ db/schema.sql is required before running data migrations

`db/schema.sql` is **not yet committed**. The production tables (`users`,
`expenses`, `user_invites`) exist only on the live database.

Migrations `002_backfill_orgs`, `003_enforce_not_null`, and `004_receipt_path`
are **data-dependent and gated** — do not run them until:

1. `db/schema.sql` is captured and committed (see `docs/schema-capture.md`), and
2. the type of `users.id` is confirmed and reconciled in
   `backend/migrations/001_organisations_and_accounts.sql`
   (`organisations.owner_account_id` currently assumes `uuid`), and
3. the `inviter_id` question is answered (is it populated? — drives the inviter
   branch in `002`).

Migrations `000_baseline` and `001` are additive/reversible and validated
against a uuid-`id` schema. Full run order, dry-run queries, and rollback steps
are in `docs/phase-0-runbook.md`.

Delete this file once `db/schema.sql` is committed and the migrations are
reconciled.
