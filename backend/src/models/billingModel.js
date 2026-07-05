const logger = require('../utils/logger');

// Billing columns on organisations (migration 010). Only this model and the
// seed ever write them; the webhook handlers are the usual caller.

const setStripeCustomerId = async (pool, orgId, customerId) => {
    try {
        const result = await pool.query(
            'UPDATE organisations SET stripe_customer_id = $2, updated_at = now() WHERE id = $1 RETURNING id',
            [orgId, customerId]
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error storing stripe customer id', { orgId, error: error.message });
        throw error;
    }
};

const getOrgByStripeCustomerId = async (pool, customerId) => {
    try {
        const result = await pool.query(
            'SELECT * FROM organisations WHERE stripe_customer_id = $1',
            [customerId]
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error fetching org by stripe customer', { customerId, error: error.message });
        throw error;
    }
};

// Apply a subscription lifecycle change (from a webhook). Only the provided
// fields are written, so partial events never blank out earlier state.
const applySubscriptionState = async (pool, orgId, { subscriptionId, billingStatus, renewalDate, subscriptionLevel, customerId }) => {
    const sets = [];
    const values = [orgId];
    const add = (column, value) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
    };
    if (subscriptionId !== undefined) add('stripe_subscription_id', subscriptionId);
    if (billingStatus !== undefined) add('billing_status', billingStatus);
    if (renewalDate !== undefined) add('renewal_date', renewalDate);
    if (subscriptionLevel !== undefined) add('subscription_level', subscriptionLevel);
    if (customerId !== undefined) add('stripe_customer_id', customerId);
    if (sets.length === 0) return null;
    sets.push('updated_at = now()');

    try {
        const result = await pool.query(
            `UPDATE organisations SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
            values
        );
        if (result.rows.length > 0) {
            logger.info('Applied subscription state', { orgId, billingStatus, subscriptionLevel });
            return result.rows[0];
        }
        logger.warn('Organisation not found applying subscription state', { orgId });
        return null;
    } catch (error) {
        logger.error('Error applying subscription state', { orgId, error: error.message });
        throw error;
    }
};

module.exports = { setStripeCustomerId, getOrgByStripeCustomerId, applySubscriptionState };
