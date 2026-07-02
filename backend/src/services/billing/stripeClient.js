// Stripe access behind the same discipline as the OCR seam: fully built,
// completely inert without configuration. `getStripeClient()` returns null
// when STRIPE_SECRET_KEY is unset and every billing route answers 502
// "billing not configured" - the rest of the app never notices.

let cachedClient = null;
let cachedKey = null;

const getStripeClient = () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    if (!cachedClient || cachedKey !== key) {
        // Lazy require: an unconfigured server never loads the SDK.
        const Stripe = require('stripe');
        cachedClient = new Stripe(key);
        cachedKey = key;
    }
    return cachedClient;
};

const getWebhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || null;

module.exports = { getStripeClient, getWebhookSecret };
