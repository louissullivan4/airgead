-- Up Migration
--
-- Phase 3 / Accountant ↔ Client: model the relationship where an accountancy
-- practice oversees a CLIENT's separate organisation (read + export) WITHOUT
-- being a member of it. This is distinct from the existing org-admin ↔ member
-- relationship (which puts members in the inviter's org via users.inviter_id /
-- users.org_id). A client gets their OWN isolated org; the accountant's access
-- is an explicit grant row in `accountant_org_links`.
--
-- This migration is ADDITIVE, idempotent, and reversible. It does NOT backfill.
--
-- `organisations.is_accountant_practice` flags practice orgs that may send
-- client invites. It defaults false and (this phase) is flipped manually in the
-- DB - there is no self-serve enablement (it becomes a paid capability later).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- provides gen_random_uuid()

CREATE TABLE IF NOT EXISTS accountant_org_links (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    accountant_org_id  uuid NOT NULL REFERENCES organisations(id),
    client_org_id      uuid NOT NULL REFERENCES organisations(id),
    created_by         uuid REFERENCES users(id),
    status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (accountant_org_id, client_org_id)
);

-- Practice flag on organisations. Guarded ALTER so re-runs are safe.
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS is_accountant_practice boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_accountant_org_links_accountant ON accountant_org_links(accountant_org_id);
CREATE INDEX IF NOT EXISTS idx_accountant_org_links_client ON accountant_org_links(client_org_id);

-- Down Migration
DROP INDEX IF EXISTS idx_accountant_org_links_client;
DROP INDEX IF EXISTS idx_accountant_org_links_accountant;

ALTER TABLE organisations DROP COLUMN IF EXISTS is_accountant_practice;

DROP TABLE IF EXISTS accountant_org_links;
