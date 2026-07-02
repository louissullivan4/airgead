-- Up Migration
--
-- Phase 6 / email verification. `email_verified_at` records when the address
-- was confirmed:
--
--   - invite-token signups (member/client/platform) are stamped at creation -
--     the invite itself arrived by email, so the address is proven;
--   - self-serve signups get a signed 24h verification link and a 7-day login
--     grace window (enforced in userController.login behind
--     REQUIRE_EMAIL_VERIFICATION, default on).
--
-- Every user that exists BEFORE this migration predates verification and is
-- grandfathered in as verified - flipping enforcement must never lock out a
-- live account.
--
-- This migration is ADDITIVE, idempotent, and reversible.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
