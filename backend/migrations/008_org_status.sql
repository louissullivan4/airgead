-- Up Migration
--
-- Phase 4 / Super-admin: organisations gain a lifecycle status so a platform
-- super_admin can SUSPEND an org (e.g. non-payment) without deleting it. Login
-- is blocked for users of a suspended org; reactivation restores access. This is
-- distinct from GDPR hard-delete (a cascade performed by the app, not a column).
-- Users already carry `account_status` for the same purpose at the user level.
--
-- Additive, idempotent, reversible. No backfill (DEFAULT 'active').

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- CHECK added separately (guarded) so re-runs are safe.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_status_check') THEN
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_status_check CHECK (status IN ('active','suspended'));
    END IF;
END$$;

-- Down Migration
ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_status_check;
ALTER TABLE organisations DROP COLUMN IF EXISTS status;
