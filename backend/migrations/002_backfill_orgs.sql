-- ============================================================================
-- DESTRUCTIVE / DATA-DEPENDENT - do not run until db/schema.sql is committed
-- and the inviter_id question is answered (is inviter_id actually populated?).
-- Run the dry-run queries below FIRST and eyeball the counts.
-- ============================================================================
--
-- DRY RUN (run manually, do not include in migration):
--   SELECT count(*) AS total_users FROM users;
--   SELECT count(*) AS users_with_inviter FROM users WHERE inviter_id IS NOT NULL;
--   SELECT count(*) AS users_without_org FROM users WHERE org_id IS NULL;
--   -- Expected orgs created (default, inviter branch DISABLED) = users_without_org
--   -- Expected orgs created (inviter branch ENABLED) = users_without_org - users_with_inviter (roughly)
--
-- This migration is IDEMPOTENT: every step is guarded on `org_id IS NULL`, so
-- re-running it only fills in users that still lack an org.

-- Up Migration

-- ----------------------------------------------------------------------------
-- [INVITER BRANCH - DISABLED BY DEFAULT]
-- If inviter_id IS populated and you want invited users to join their
-- inviter's organisation as members (rather than each getting a solo org),
-- UNCOMMENT the UPDATE below. It must run AFTER top-level (non-invited) users
-- have orgs, so the recommended flow when enabling is:
--   1. comment out "AND u.inviter_id IS NULL" is NOT needed; instead run this
--      migration once to create orgs for everyone, OR
--   2. enable this block + add "AND u.inviter_id IS NULL" to the solo-org step,
--      then re-run the migration so stragglers (inviters without orgs) get solo orgs.
-- ----------------------------------------------------------------------------
-- UPDATE users u
-- SET org_id = inv.org_id,
--     org_role = 'member'
-- FROM users inv
-- WHERE u.inviter_id = inv.id
--   AND inv.org_id IS NOT NULL
--   AND u.org_id IS NULL;

-- ----------------------------------------------------------------------------
-- Solo / business org per remaining user without an org.
-- owner_account_id is set in the same INSERT so we can map the new org back to
-- its user (and so organisations.owner_account_id is populated immediately).
-- Type: 'business' for accountants, 'personal' for everyone else.
-- ----------------------------------------------------------------------------
WITH new_orgs AS (
    INSERT INTO organisations (name, type, owner_account_id, is_auto_renew, subscription_level, renewal_date, payment_method)
    SELECT
        COALESCE(NULLIF(TRIM(COALESCE(u.fname,'') || ' ' || COALESCE(u.sname,'')), ''), u.email, 'Account'),
        CASE WHEN u.role = 'accountant' THEN 'business' ELSE 'personal' END,
        u.id,
        u.is_auto_renew,
        u.subscription_level,
        u.renewal_date,
        u.payment_method
    FROM users u
    WHERE u.org_id IS NULL
      -- When enabling the inviter branch above, also add: AND u.inviter_id IS NULL
    RETURNING id AS org_id, owner_account_id AS user_id
)
UPDATE users u
SET org_id = n.org_id,
    org_role = 'owner'
FROM new_orgs n
WHERE u.id = n.user_id;

-- ----------------------------------------------------------------------------
-- Map the legacy `role` column onto the new axes (kept this phase; not dropped).
--   role = 'admin'      -> platform_role = 'super_admin'
--   role = 'accountant' -> org_role = 'owner' on a business-type org (already
--                          'owner' + business from the step above)
--   everyone else       -> org_role = 'owner' on a personal org (default)
-- ----------------------------------------------------------------------------
UPDATE users SET platform_role = 'super_admin' WHERE role = 'admin';

-- Down Migration
-- Detach users from their orgs and remove the orgs created here. This reverses
-- the backfill but cannot distinguish orgs created by this migration from any
-- created afterwards, so it clears all org linkage. Safe because 001's down
-- drops the columns/table entirely anyway.
UPDATE users SET org_id = NULL, org_role = 'owner', platform_role = 'user';
DELETE FROM organisations;
