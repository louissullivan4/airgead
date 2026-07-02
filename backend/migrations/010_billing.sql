-- Up Migration
--
-- Phase 6 / billing tiers. Adds the commercial columns to organisations:
--
--   subscription_level : 'trial' | 'standard' (existing column, now constrained;
--                        legacy/unknown values are folded into 'trial')
--   billing_status     : lifecycle mirror of the Stripe subscription
--                        ('none' until Stripe ever touches the org)
--   trial_ends_at      : 30-day clock; volatile DEFAULT so every NEW org starts
--                        a trial automatically without touching signup code
--   stripe_customer_id / stripe_subscription_id : set by the webhook handlers
--
-- Whether an org is "active" is COMPUTED (services/billing/entitlements.js):
-- own active subscription OR covered seat via an active accountant_org_links
-- row to a paying practice OR unexpired trial. Nothing here enforces anything -
-- enforcement is the BILLING_ENFORCED env flag (default off).
--
-- This migration is ADDITIVE, idempotent, and reversible.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '30 days');
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'none';

-- Existing orgs (created before the column) start their 30-day clock now.
UPDATE organisations SET trial_ends_at = now() + interval '30 days' WHERE trial_ends_at IS NULL;

-- Fold legacy subscription_level values ('free', 'premium', NULL, …) into the
-- two-tier model before constraining it. Nobody has ever been billed, so every
-- existing org is a trial until Stripe says otherwise.
UPDATE organisations
SET subscription_level = 'trial'
WHERE subscription_level IS NULL OR subscription_level NOT IN ('trial', 'standard');

ALTER TABLE organisations ALTER COLUMN subscription_level SET DEFAULT 'trial';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_subscription_level_check') THEN
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_subscription_level_check
            CHECK (subscription_level IN ('trial', 'standard'));
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_billing_status_check') THEN
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_billing_status_check
            CHECK (billing_status IN ('none', 'trialing', 'active', 'past_due', 'canceled'));
    END IF;
END$$;

-- Webhooks look orgs up by Stripe customer.
CREATE INDEX IF NOT EXISTS idx_organisations_stripe_customer ON organisations(stripe_customer_id);

-- Down Migration
DROP INDEX IF EXISTS idx_organisations_stripe_customer;

ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_billing_status_check;
ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_subscription_level_check;
ALTER TABLE organisations ALTER COLUMN subscription_level DROP DEFAULT;

ALTER TABLE organisations DROP COLUMN IF EXISTS billing_status;
ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE organisations DROP COLUMN IF EXISTS trial_ends_at;
