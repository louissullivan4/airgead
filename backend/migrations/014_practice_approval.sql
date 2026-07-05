-- Up Migration
--
-- Accountancy model rework. An accountancy practice is now FREE but must be
-- APPROVED by a platform super_admin before it gains practice powers (free
-- access + inviting clients). Previously `is_accountant_practice` was set
-- straight from the signup body (organisationModel.createUserWithOrg), so any
-- self-serve signup could grant itself a free-forever practice account. This
-- adds the approval lifecycle:
--
--   practice_status : 'none'     - not a practice (the default for every org)
--                     'pending'  - applied at signup, awaiting review
--                     'approved' - a super_admin approved it; is_accountant_practice
--                                  is flipped true at the same moment
--                     'rejected' - declined
--
-- `is_accountant_practice` stays the EFFECTIVE capability flag (only true once
-- approved), so every existing gate (requireAccountantPractice, the entitlement
-- resolver's practice rule) keeps working unchanged. `practice_status` is the
-- application state that drives the approval UI and the pending grace.
--
-- Grandfather: every org already flagged is_accountant_practice predates this
-- and is folded to 'approved' so no live practice loses access.
--
-- This migration is ADDITIVE, idempotent, and reversible.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS practice_status text NOT NULL DEFAULT 'none';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS practice_approved_at timestamptz;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS practice_approved_by uuid REFERENCES users(id);

-- Existing practices are grandfathered as approved (they were self-served before
-- approval existed); everything else stays 'none'.
UPDATE organisations SET practice_status = 'approved'
WHERE is_accountant_practice = true AND practice_status <> 'approved';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_practice_status_check') THEN
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_practice_status_check
            CHECK (practice_status IN ('none', 'pending', 'approved', 'rejected'));
    END IF;
END$$;

-- The admin surface lists pending applications; index the lookup.
CREATE INDEX IF NOT EXISTS idx_organisations_practice_status ON organisations(practice_status);

-- Down Migration
DROP INDEX IF EXISTS idx_organisations_practice_status;

ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_practice_status_check;

ALTER TABLE organisations DROP COLUMN IF EXISTS practice_approved_by;
ALTER TABLE organisations DROP COLUMN IF EXISTS practice_approved_at;
ALTER TABLE organisations DROP COLUMN IF EXISTS practice_status;
