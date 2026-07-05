const logger = require('../../utils/logger');

// Entitlement resolution - the one place that decides whether an org is
// "active" (allowed to write). Everything billing-related reads this; the
// answer is COMPUTED per request from the org row, never cached or stored, so
// there is no entitlement state to drift.
//
// Commercial model (accountancy rework): an accountancy practice is FREE; its
// CLIENTS pay for themselves. A client org is billed exactly like a solo org -
// its own trial, then its own subscription. There is no "covered seat"; the
// accountant link is a pure access grant, decoupled from billing.
//
// Resolution order (first match wins):
//   1. practice: an approved practice (is_accountant_practice) OR one still
//      pending review (practice_status = 'pending') is always active and free.
//      Approved practices are free forever; pending ones get grace so an
//      applicant is never gated or dunned while we review them.
//   2. own subscription: billing_status 'active' (or 'past_due' - Stripe is
//      still retrying the card; we warn via status but never lock a paying
//      customer out mid-dunning).
//   3. unexpired trial (trial_ends_at in the future).
//   4. otherwise expired -> not active. Reads stay open regardless (the
//      middleware only ever gates writes); this only switches the org to
//      read-only-until-subscribed.

const ENTITLEMENT_QUERY = `
    SELECT
        o.id,
        o.is_accountant_practice,
        o.practice_status,
        o.subscription_level,
        o.billing_status,
        o.trial_ends_at
    FROM organisations o
    WHERE o.id = $1
`;

// Stripe statuses that still grant access. 'trialing' is a live Stripe-side
// subscription trial; 'past_due' is the dunning window - Stripe keeps retrying
// for days; cutting access on the first failed charge punishes card expiries.
const PAYING_STATUSES = ['active', 'trialing', 'past_due'];

const getEffectiveSubscription = async (pool, orgId) => {
    try {
        const result = await pool.query(ENTITLEMENT_QUERY, [orgId]);
        const org = result.rows[0];
        if (!org) return null;

        const isPractice = Boolean(org.is_accountant_practice);
        const base = {
            orgId: org.id,
            isPractice,
            practiceStatus: org.practice_status || 'none',
            trialEndsAt: org.trial_ends_at || null,
            // Raw column, for UI that needs to know whether Stripe was ever
            // set up (a practice is always ACTIVE yet may have no billing).
            billingStatus: org.billing_status || 'none',
        };

        // A practice - approved OR still under review - is free and always
        // active. Pending gets grace so review latency never blocks the account.
        if (isPractice || org.practice_status === 'pending') {
            return { ...base, active: true, tier: 'standard', status: 'active', reason: 'practice' };
        }
        if (PAYING_STATUSES.includes(org.billing_status)) {
            return { ...base, active: true, tier: 'standard', status: org.billing_status, reason: 'subscribed' };
        }
        if (org.trial_ends_at && new Date(org.trial_ends_at) > new Date()) {
            return { ...base, active: true, tier: 'trial', status: 'trialing', reason: 'trial' };
        }
        return {
            ...base,
            active: false,
            tier: org.subscription_level === 'standard' ? 'standard' : 'trial',
            // Preserve a real Stripe lifecycle status ('canceled'...) for the
            // banner; a never-billed org just has an expired trial.
            status: org.billing_status && org.billing_status !== 'none' ? org.billing_status : 'trial_expired',
            reason: 'expired',
        };
    } catch (error) {
        logger.error('Error resolving entitlement', { orgId, error: error.message });
        throw error;
    }
};

module.exports = { getEffectiveSubscription };
