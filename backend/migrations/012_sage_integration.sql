-- Up Migration
--
-- Sage Business Cloud Accounting export (feature-flagged via SAGE_ENABLED).
--
-- `sage_connections` holds ONE OAuth connection per accountancy-practice org.
-- Tokens are stored AES-256-GCM encrypted (utils/tokenCrypto.js, keyed by
-- TOKEN_ENCRYPTION_KEY) - never plaintext. Sage refresh tokens ROTATE on every
-- use, so the row is updated inside a SELECT ... FOR UPDATE transaction
-- (services/sage/sageAuth.js). status='expired' marks a dead refresh token so
-- the UI can prompt a reconnect; disconnect deletes the row outright.
--
-- `sage_export_settings` remembers the per-client mapping choices (which Sage
-- business/bank account/ledger accounts) so the export dialog is prefilled the
-- next time. Kept OFF accountant_org_links deliberately: links get revoked and
-- reassigned, and that table is security-critical.
--
-- `sage_exported_expenses` is the idempotency ledger: an expense already pushed
-- to a given Sage business is skipped on re-export. Pointing the client at a
-- DIFFERENT Sage business legitimately re-creates, hence the composite key.
--
-- This migration is ADDITIVE, idempotent, and reversible.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- provides gen_random_uuid()

CREATE TABLE IF NOT EXISTS sage_connections (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                    uuid NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
    connected_by              uuid REFERENCES users(id),
    access_token_encrypted    text NOT NULL,
    refresh_token_encrypted   text NOT NULL,
    access_token_expires_at   timestamptz,
    refresh_token_expires_at  timestamptz,
    status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sage_export_settings (
    id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    accountant_org_id             uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    client_org_id                 uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    sage_business_id              text NOT NULL,
    sage_business_name            text,
    bank_account_id               text NOT NULL,
    bank_account_name             text,
    expense_ledger_account_id     text NOT NULL,
    expense_ledger_account_name   text,
    income_ledger_account_id      text NOT NULL,
    income_ledger_account_name    text,
    tax_rate_id                   text,
    updated_by                    uuid REFERENCES users(id),
    created_at                    timestamptz NOT NULL DEFAULT now(),
    updated_at                    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (accountant_org_id, client_org_id)
);

CREATE TABLE IF NOT EXISTS sage_exported_expenses (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id          uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    sage_business_id    text NOT NULL,
    sage_resource_type  text NOT NULL CHECK (sage_resource_type IN ('other_payment','other_receipt')),
    sage_resource_id    text NOT NULL,
    accountant_org_id   uuid REFERENCES organisations(id),
    exported_by         uuid REFERENCES users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (expense_id, sage_business_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_export_settings_client ON sage_export_settings(client_org_id);
CREATE INDEX IF NOT EXISTS idx_sage_exported_expenses_business ON sage_exported_expenses(sage_business_id);

-- Down Migration
DROP INDEX IF EXISTS idx_sage_exported_expenses_business;
DROP INDEX IF EXISTS idx_sage_export_settings_client;

DROP TABLE IF EXISTS sage_exported_expenses;
DROP TABLE IF EXISTS sage_export_settings;
DROP TABLE IF EXISTS sage_connections;
