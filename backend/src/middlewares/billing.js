const logger = require('../utils/logger');
const { isBillingEnforced } = require('../config/tiers');
const entitlements = require('../services/billing/entitlements');
const { isSuperAdmin } = require('./tenantScope');

// Phase 6 write gating. The product promise: you can ALWAYS see your data and
// always pay - an expired org is read-only, never locked out. So this gate is
// mounted router-wide on /expenses, /receipts and /assets but only bites on
// write verbs; reads, exports, login, settings and /billing itself never pass
// through it.
//
// With BILLING_ENFORCED unset/false (the default until GA) it is a no-op.
// A billing-infrastructure failure FAILS OPEN: our outage must never stop a
// sole trader capturing a receipt in a yard.

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const requireActiveSubscription = async (req, res, next) => {
    if (!isBillingEnforced()) return next();
    if (isSuperAdmin(req)) return next();

    let entitlement;
    try {
        entitlement = await entitlements.getEffectiveSubscription(req.pool, req.user.orgId);
    } catch (error) {
        logger.error('Entitlement check failed open', { orgId: req.user && req.user.orgId, error: error.message });
        return next();
    }

    if (entitlement && entitlement.active) {
        req.entitlement = entitlement;
        return next();
    }

    logger.info('Blocked write for inactive subscription', {
        orgId: req.user && req.user.orgId,
        status: entitlement && entitlement.status,
    });
    return res.status(402).json({
        error: 'Your trial has ended. Subscribe to keep adding records - everything you have entered stays available.',
        code: 'subscription_required',
        status: (entitlement && entitlement.status) || 'trial_expired',
    });
};

// Router-wide wrapper: gate only write verbs, wave reads straight through.
const requireActiveSubscriptionForWrites = (req, res, next) => {
    if (!WRITE_METHODS.has(req.method)) return next();
    return requireActiveSubscription(req, res, next);
};

module.exports = { requireActiveSubscription, requireActiveSubscriptionForWrites };
