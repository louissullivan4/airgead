-- Up Migration
--
-- Phase 0 / Task 2: introduce the organisations table and evolve `users` into
-- "accounts" without renaming it (live queries depend on the name `users`).
-- This migration is ADDITIVE and reversible. It does NOT backfill data — see
-- 002_backfill_orgs.sql for that (gated) step.
--
-- !!! TYPE RECONCILIATION REQUIRED BEFORE RUNNING !!!
-- `organisations.owner_account_id` references users(id). Its type MUST match the
-- real type of users.id (see db/schema.sql once captured). This file assumes
-- users.id is `uuid` (per the Phase 0 spec). If users.id is integer/bigint,
-- change `owner_account_id uuid` -> `owner_account_id integer/bigint` below.
-- users.org_id is a brand-new uuid column referencing organisations(id) and is
-- independent of the users.id type.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- provides gen_random_uuid()

CREATE TABLE IF NOT EXISTS organisations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    type               text NOT NULL CHECK (type IN ('personal','business')),
    owner_account_id   uuid,  -- FK added below; nullable now, set in 002_backfill_orgs
    subscription_level text,
    renewal_date       date,
    is_auto_renew      boolean,
    payment_method     text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Account (users) evolution. Keep the existing `role` column for now; it is
-- mapped onto the new axes in 002 and removed in a later phase.
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role text DEFAULT 'owner';
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role text DEFAULT 'user';

-- Constraints added separately so re-runs are safe.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_org_id_fkey') THEN
        ALTER TABLE users
            ADD CONSTRAINT users_org_id_fkey
            FOREIGN KEY (org_id) REFERENCES organisations(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_org_role_check') THEN
        ALTER TABLE users
            ADD CONSTRAINT users_org_role_check CHECK (org_role IN ('owner','member'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_platform_role_check') THEN
        ALTER TABLE users
            ADD CONSTRAINT users_platform_role_check CHECK (platform_role IN ('user','super_admin'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_owner_account_id_fkey') THEN
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_owner_account_id_fkey
            FOREIGN KEY (owner_account_id) REFERENCES users(id);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);

-- Down Migration
DROP INDEX IF EXISTS idx_expenses_user_id;
DROP INDEX IF EXISTS idx_users_org_id;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_org_id_fkey;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_org_role_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_platform_role_check;

ALTER TABLE users DROP COLUMN IF EXISTS platform_role;
ALTER TABLE users DROP COLUMN IF EXISTS org_role;
ALTER TABLE users DROP COLUMN IF EXISTS org_id;

DROP TABLE IF EXISTS organisations;
