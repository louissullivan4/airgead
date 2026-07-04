// Phase 6 tier model - the single source of truth for what tiers exist and
// whether the app ENFORCES them. Prices deliberately live in Stripe (surfaced
// for display via GET /billing/plans + /status), never here.
//
// The model is two tiers and one twist:
//   - trial    : the full product, free for TRIAL_DAYS from org creation.
//   - standard : the full product, paid. A solo org pays for itself; a client
//                org linked to a PAYING accountancy practice is a covered seat
//                (the practice pays per seat; the practice's own org is free).
//
// Enforcement is OFF by default (BILLING_ENFORCED unset/false): everything
// stays free-and-open ("complete demo mode") until the flag is flipped. Read
// via the function - not a module constant - so tests and long-lived processes
// see env changes.
//
// NOTE: TRIAL_DAYS is the DISPLAY figure. The actual trial clock is the
// organisations.trial_ends_at column DEFAULT (migrations/013_trial_14_days.sql);
// keep the two in sync.

const TRIAL_DAYS = 14;

const TIERS = {
    trial: {
        key: 'trial',
        label: 'Trial',
        blurb: `The full product, free for ${TRIAL_DAYS} days.`,
    },
    standard: {
        key: 'standard',
        label: 'Standard',
        blurb: 'Capture, tax engine, accountant workspace and exports.',
    },
};

const isBillingEnforced = () => process.env.BILLING_ENFORCED === 'true';

module.exports = { TRIAL_DAYS, TIERS, isBillingEnforced };
