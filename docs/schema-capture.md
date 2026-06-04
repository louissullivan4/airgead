# Schema capture (Phase 0, Task 1)

There is **no schema in the repo**. The tables (`users`, `expenses`, `user_invites`)
exist only on the live database. Migrations 002–004 are **data-dependent** and must
not be run until the real schema is captured and committed here.

## What to run (human, against production — read-only)

Set `DB_URL` to the production connection string, then:

```bash
# Preferred: full schema-only dump
pg_dump --schema-only "$DB_URL" > db/schema.sql

# Fallback if pg_dump is unavailable:
psql "$DB_URL" -c "\d users" -c "\d expenses" -c "\d user_invites" > db/schema.txt
```

Commit the resulting `db/schema.sql` (or `db/schema.txt`) to the repo.

## Why this gates the migrations

The biggest unknown is **the type of `users.id`** (uuid vs integer/bigint):

- `backend/migrations/001_organisations_and_accounts.sql` defines
  `organisations.owner_account_id` and the FK to `users(id)` assuming **uuid**.
- If `users.id` is integer/bigint, change `owner_account_id`'s type (and only
  that column — `users.org_id` is a new uuid column referencing `organisations`
  and is unaffected).

Also confirm:

- Whether `inviter_id` is actually populated (drives the inviter branch in
  `002_backfill_orgs.sql`).
- The real types of `subscription_level`, `renewal_date`, `payment_method`,
  `is_auto_renew` on `users` (copied onto `organisations` in 001).

## After committing the schema

1. Reconcile the column types in `001` (and the inviter branch in `002`).
2. Follow `docs/phase-0-runbook.md` for the exact run order, dry-run queries, and
   rollback steps.
