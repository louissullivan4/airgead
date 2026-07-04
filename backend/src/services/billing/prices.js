const stripeClient = require('./stripeClient');
const logger = require('../../utils/logger');

// Live Stripe price amounts, surfaced for DISPLAY only (the public pricing +
// landing pages and the Settings billing card). Cached briefly so a burst of
// pricing-page hits does not hammer the Stripe API - prices change rarely and a
// few minutes of staleness is harmless. Stripe stays the single source of truth
// for the number; nothing here is ever used to actually charge.

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = null; // { at, value }

// Stripe Price -> the minimal shape the UI needs. Null for anything that is not
// a usable recurring/one-off price object.
const shape = (price) => (price && typeof price.unit_amount === 'number'
    ? {
        amount: price.unit_amount, // minor units, e.g. 1500 = €15.00
        currency: price.currency, // ISO code, lowercase (Stripe convention)
        interval: price.recurring ? price.recurring.interval : null,
    }
    : null);

// Resolve { premium, seat }:
//   premium = the self-serve price   (STRIPE_PRICE_SOLO)
//   seat    = the per-client-seat price a practice pays (STRIPE_PRICE_SEAT)
// Either may be null when Stripe is unconfigured or a lookup fails - callers
// fall back to their own static display defaults.
const getLivePrices = async () => {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const stripe = stripeClient.getStripeClient();
    if (!stripe) return { premium: null, seat: null };

    const soloId = process.env.STRIPE_PRICE_SOLO;
    const seatId = process.env.STRIPE_PRICE_SEAT;
    try {
        const [solo, seat] = await Promise.all([
            soloId ? stripe.prices.retrieve(soloId) : Promise.resolve(null),
            seatId ? stripe.prices.retrieve(seatId) : Promise.resolve(null),
        ]);
        const value = { premium: shape(solo), seat: shape(seat) };
        cached = { at: Date.now(), value };
        return value;
    } catch (error) {
        // A Stripe hiccup must never break a page render: fall back to nulls and
        // let the caller show its static default. Deliberately not cached, so
        // the next request retries.
        logger.warn('Could not fetch live Stripe prices: %s', error.message);
        return { premium: null, seat: null };
    }
};

// Drop the memoised prices (e.g. after changing the price ids, or in tests).
const clearPriceCache = () => { cached = null; };

module.exports = { getLivePrices, clearPriceCache };
