-- Up Migration
--
-- Baseline: the pre-migration core schema (users, expenses, user_invites) as
-- it existed before any tooling. Every statement is IF NOT EXISTS, so:
--
--   - on the EXISTING production database this file is a no-op twice over
--     (its pgmigrations row is already recorded, and the tables exist anyway);
--   - on an EMPTY database `npm run migrate:up` now bootstraps the whole
--     schema end-to-end (000 core -> 001+ evolution) with no seed script
--     required. Migrations are the source of truth; scripts/seed.js remains a
--     dev convenience for demo data.
--
-- Columns here are the pre-Phase-0 shape ONLY. Everything later phases added
-- (org linkage, receipts, assets, billing, verification) arrives via 001-011,
-- exactly as it did on prod.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- provides gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fname              text,
    mname              text DEFAULT '',
    sname              text,
    email              text UNIQUE NOT NULL,
    phone_number       text,
    date_of_birth      date,
    ppsno              text,
    address_line1      text,
    address_line2      text DEFAULT '',
    city               text,
    county             text DEFAULT '',
    country            text,
    tax_status         text,
    marital_status     text,
    postal_code        text DEFAULT '',
    occupation         text,
    currency           text NOT NULL DEFAULT 'EUR',
    password_hash      text NOT NULL,
    inviter_id         uuid,
    id_image_url       text,
    poa_image_url      text,
    role               text NOT NULL DEFAULT 'user',
    account_status     text DEFAULT 'active',
    subscription_level text DEFAULT 'free',
    renewal_date       date,
    is_auto_renew      boolean DEFAULT false,
    payment_method     text,
    last_login         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title              text,
    description        text,
    category           text,
    amount             numeric(12,2) NOT NULL DEFAULT 0,
    currency           text NOT NULL DEFAULT 'EUR',
    receipt_image_url  text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_invites (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text NOT NULL,
    invite_token       text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
-- Reverses a fresh-database bootstrap. (On long-lived databases you would
-- never migrate down through the baseline.)
DROP TABLE IF EXISTS user_invites;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS users;
