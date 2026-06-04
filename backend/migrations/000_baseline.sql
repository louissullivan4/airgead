-- Up Migration
-- Baseline migration: a deliberate no-op.
--
-- The production schema (tables: users, expenses, user_invites) predates any
-- migration tooling and is NOT created by these migrations. This baseline only
-- gives the migration history a known starting point. The authoritative
-- pre-migration schema must be captured into db/schema.sql by a human — see
-- docs/schema-capture.md. Migrations 001+ build on top of that captured schema.
SELECT 1;

-- Down Migration
-- No-op: nothing to undo for the baseline.
SELECT 1;
