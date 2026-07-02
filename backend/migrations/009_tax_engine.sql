-- Up Migration
--
-- Phase 5 / Irish tax engine: capital allowances + VAT treatment.
--
-- `assets` is the capital-asset register. An expense is a CAPITAL item iff an
-- assets row references it (no flag column on expenses - one source of truth).
-- Deleting the source expense cascades the asset; removing the asset row
-- reverts the expense to an ordinary revenue expense. Standalone register
-- entries (expense_id NULL) cover opening balances / pre-app purchases.
--
-- Wear & tear is COMPUTED (12.5% straight-line over 8 years, €24k cap for
-- passenger cars - see services/tax/wearAndTear.js), never stored, so there is
-- no schedule state to drift.
--
-- `organisations.vat_status` drives the VAT section of the tax summary:
-- 'not_registered' | 'registered' | 'flat_rate_farmer' (unregistered farmers on
-- the flat-rate addition scheme, incl. the VAT 58 building/fencing reclaim).
--
-- This migration is ADDITIVE, idempotent, and reversible. No backfill.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- provides gen_random_uuid()

CREATE TABLE IF NOT EXISTS assets (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expense_id         uuid REFERENCES expenses(id) ON DELETE CASCADE,
    description        text NOT NULL,
    category           text,
    asset_type         text NOT NULL DEFAULT 'plant_machinery'
                       CHECK (asset_type IN ('plant_machinery','motor_vehicle')),
    cost               numeric(12,2) NOT NULL,
    currency           text NOT NULL DEFAULT 'EUR',
    acquired_date      date NOT NULL,
    disposal_date      date,
    disposal_proceeds  numeric(12,2),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS vat_status text NOT NULL DEFAULT 'not_registered';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_vat_status_check') THEN
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_vat_status_check
            CHECK (vat_status IN ('not_registered','registered','flat_rate_farmer'));
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_expense_id ON assets(expense_id);

-- Down Migration
DROP INDEX IF EXISTS idx_assets_expense_id;
DROP INDEX IF EXISTS idx_assets_user_id;

ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_vat_status_check;
ALTER TABLE organisations DROP COLUMN IF EXISTS vat_status;

DROP TABLE IF EXISTS assets;
