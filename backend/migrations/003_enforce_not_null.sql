-- ============================================================================
-- DESTRUCTIVE / DATA-DEPENDENT — do not run until db/schema.sql is committed,
-- the inviter_id question is answered, AND 002_backfill_orgs has completed
-- successfully (every user must have an org_id, or this will fail).
-- ============================================================================
--
-- DRY RUN (must return 0 before running this migration):
--   SELECT count(*) AS users_still_without_org FROM users WHERE org_id IS NULL;

-- Up Migration
ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;

-- Down Migration
ALTER TABLE users ALTER COLUMN org_id DROP NOT NULL;
