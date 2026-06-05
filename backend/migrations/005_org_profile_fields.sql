-- Up Migration
--
-- Phase 2 / Org setup: enrich the organisations table so a sole trader can
-- describe their business and have it classified by a granular `org_category`
-- slug. That slug drives the per-type category template seeded into the new
-- `categories` jsonb column (owner-editable thereafter). This migration is
-- ADDITIVE, idempotent, and reversible. It does NOT touch `expenses` — category
-- stays free text (see categoryTemplates.js / organisationModel.js).
--
-- The existing `type` column (personal/business) is kept as-is; `org_category`
-- is the finer classification.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'IE';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS vat_number text;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS org_category text NOT NULL DEFAULT 'personal';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS categories jsonb;

-- CHECK added separately (guarded) so re-runs are safe. The allowed slugs MUST
-- stay in sync with ORG_CATEGORY_SLUGS in
-- backend/src/config/categoryTemplates.js (the seed/template source of truth).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_org_category_check') THEN
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_org_category_check
            CHECK (org_category IN (
                'personal',
                'sole_trader_equine',
                'sole_trader_agriculture',
                'consultant',
                'retail',
                'trades_construction',
                'hospitality',
                'other'
            ));
    END IF;
END$$;

-- Down Migration
ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_org_category_check;

ALTER TABLE organisations DROP COLUMN IF EXISTS categories;
ALTER TABLE organisations DROP COLUMN IF EXISTS org_category;
ALTER TABLE organisations DROP COLUMN IF EXISTS vat_number;
ALTER TABLE organisations DROP COLUMN IF EXISTS country;
ALTER TABLE organisations DROP COLUMN IF EXISTS description;
