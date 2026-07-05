-- Up Migration
--
-- Trial / payment reminder log. A daily in-process job (services/billing/
-- reminderJob.js) nudges trialing orgs as their 14-day trial deadline nears and
-- after it lapses ("subscribe to keep going"). Each nudge is recorded here so
-- the job is IDEMPOTENT: one row per (org, kind), and a UNIQUE constraint makes
-- a re-send a no-op (INSERT ... ON CONFLICT DO NOTHING). Deleting the org
-- cascades its reminder history away.
--
--   kind : the reminder milestone, e.g. 'trial_t7' | 'trial_t3' | 'trial_t1'
--          (days before expiry), 'trial_expired' (day of), 'post_trial_3' |
--          'post_trial_7' (follow-ups), or 'manual_YYYY-MM-DD' for an accountant's
--          on-demand nudge (kept once-per-day per client by the date suffix).
--
-- This migration is ADDITIVE, idempotent, and reversible.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS billing_reminders (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    kind       text NOT NULL,
    sent_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_billing_reminders_org ON billing_reminders(org_id);

-- Down Migration
DROP INDEX IF EXISTS idx_billing_reminders_org;
DROP TABLE IF EXISTS billing_reminders;
