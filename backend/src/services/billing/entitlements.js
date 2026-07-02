const logger = require('../../utils/logger');

// Phase 6 entitlement resolution - the one place that decides whether an org
// is "active" (allowed to write). Everything billing-related reads this; the
// answer is COMPUTED per request from the org row + links, never cached or
// stored, so there is no entitlement state to drift.
//
// Resolution order (first match wins):
//   1. accountancy practice orgs are always active - the practice is free,
//      its SEATS pay (enforced on each client org via rule 3).
//   2. own subscription: billing_status 'active' (or 'past_due' - Stripe is
//      still retrying the card; we warn via status but never lock a paying
//      customer out mid-dunning).
//   3. covered seat: the org is a client with an ACTIVE accountant_org_links
//      row to a practice whose own billing is active - the practice pays for
//      this seat. A revoked link removes cover instantly.
//   4. unexpired trial (trial_ends_at in the future).
//   5. otherwise expired → not active. Reads stay open regardless (the
//      middleware only ever gates writes); this only switches the org to
//      read-only-until-subscribed.

// Single round trip: the org row plus (for client orgs) whether any active
// link points at a practice that is itself paying.
const ENTITLEMENT_QUERY = `
    SELECT
        o.id,
        o.is_accountant_practice,
        o.subscription_level,
        o.billing_status,
        o.trial_ends_at,
        cover.practice_org_id AS covered_by_practice_org_id
    FROM organisations o
    LEFT JOIN LATERAL (
        SELECT l.accountant_org_id AS practice_org_id
        FROM accountant_org_links l
        JOIN organisations p ON p.id = l.accountant_org_id
        WHERE l.client_org_id = o.id
          AND l.status = 'active'
          AND p.billing_status IN ('active', 'trialing', 'past_due')
        LIMIT 1
    ) cover ON true
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

        const base = {
            orgId: org.id,
            isPractice: Boolean(org.is_accountant_practice),
            trialEndsAt: org.trial_ends_at || null,
            coveredByPracticeOrgId: org.covered_by_practice_org_id || null,
            // Raw column, for UI that needs to know whether Stripe was ever
            // set up (a practice is always ACTIVE yet may have no billing).
            billingStatus: org.billing_status || 'none',
        };

        if (base.isPractice) {
            return { ...base, active: true, tier: 'standard', status: 'active', reason: 'practice' };
        }
        if (PAYING_STATUSES.includes(org.billing_status)) {
            return { ...base, active: true, tier: 'standard', status: org.billing_status, reason: 'subscribed' };
        }
        if (base.coveredByPracticeOrgId) {
            return { ...base, active: true, tier: 'standard', status: 'active', reason: 'covered_seat' };
        }
        if (org.trial_ends_at && new Date(org.trial_ends_at) > new Date()) {
            return { ...base, active: true, tier: 'trial', status: 'trialing', reason: 'trial' };
        }
        return {
            ...base,
            active: false,
            tier: org.subscription_level === 'standard' ? 'standard' : 'trial',
            // Preserve a real Stripe lifecycle status ('canceled'…) for the
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
