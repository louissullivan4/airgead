-- Up Migration
--
-- Shorten the automatic free trial from 30 to 14 days. The trial clock is the
-- volatile DEFAULT on organisations.trial_ends_at (see 010_billing.sql), so
-- changing the default is all that is needed - signup code stays untouched and
-- every NEW org gets a 14-day trial. Keep the display figure (config/tiers.js
-- TRIAL_DAYS) in sync.
--
-- Existing orgs keep whatever trial_ends_at they already have; this only
-- affects orgs created after the migration runs. Additive and reversible.

ALTER TABLE organisations ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

-- Down Migration
ALTER TABLE organisations ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '30 days');
