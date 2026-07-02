const logger = require('../../utils/logger');
const stripeClient = require('./stripeClient');
const organisationModel = require('../../models/organisationModel');
const billingModel = require('../../models/billingModel');

// Keep a practice's Stripe seat quantity in step with its ACTIVE client links.
// Called best-effort after a client-invite signup and after a revoke - it
// NEVER throws (a Stripe hiccup must not fail the signup/revoke that caused
// it) and no-ops entirely when Stripe is unconfigured, the org isn't a
// practice, or it has no subscription yet (the next checkout picks up the
// current count instead).
const syncPracticeSeats = async (pool, practiceOrgId) => {
    try {
        const stripe = stripeClient.getStripeClient();
        if (!stripe || !practiceOrgId) return { synced: false, reason: 'unconfigured' };

        const org = await organisationModel.getOrgById(pool, practiceOrgId);
        if (!org || !org.is_accountant_practice || !org.stripe_subscription_id) {
            return { synced: false, reason: 'no_subscription' };
        }

        const seats = Math.max(1, await billingModel.countActiveSeats(pool, practiceOrgId));
        const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
        const item = subscription && subscription.items && subscription.items.data && subscription.items.data[0];
        if (!item) return { synced: false, reason: 'no_item' };
        if (item.quantity === seats) return { synced: true, seats, changed: false };

        await stripe.subscriptions.update(subscription.id, {
            items: [{ id: item.id, quantity: seats }],
            proration_behavior: 'create_prorations',
        });
        logger.info('Synced practice seat quantity', { practiceOrgId, seats, was: item.quantity });
        return { synced: true, seats, changed: true };
    } catch (error) {
        logger.error('Seat sync failed (non-fatal)', { practiceOrgId, error: error.message });
        return { synced: false, reason: 'error' };
    }
};

module.exports = { syncPracticeSeats };
