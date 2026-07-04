const logger = require('../utils/logger');
const { isBillingEnforced, TIERS, TRIAL_DAYS } = require('../config/tiers');
const entitlements = require('../services/billing/entitlements');
const stripeClient = require('../services/billing/stripeClient');
const priceService = require('../services/billing/prices');
const billingModel = require('../models/billingModel');
const organisationModel = require('../models/organisationModel');
const userModel = require('../models/userModel');

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

// Stripe subscription status → organisations.billing_status. Anything Stripe
// still considers recoverable maps to past_due (access continues, banner
// warns); terminal states map to canceled.
const STRIPE_STATUS_MAP = {
    active: 'active',
    trialing: 'trialing',
    past_due: 'past_due',
    incomplete: 'past_due',
    paused: 'past_due',
    canceled: 'canceled',
    unpaid: 'canceled',
    incomplete_expired: 'canceled',
};
const mapStripeStatus = (status) => STRIPE_STATUS_MAP[status] || 'past_due';

// GET /billing/status - the caller's own org's entitlement, plus whether the
// platform is enforcing billing at all. The frontend trial banner and the
// Settings billing card are both driven entirely by this one response; when
// `enforced` is false they render nothing.
const getStatus = async (req, res) => {
    try {
        const entitlement = await entitlements.getEffectiveSubscription(req.pool, req.user.orgId);
        if (!entitlement) {
            return res.status(404).json({ error: 'Organisation not found.' });
        }
        // Practices manage seats, so their card shows the live seat count.
        let seatCount;
        if (entitlement.isPractice) {
            seatCount = await billingModel.countActiveSeats(req.pool, req.user.orgId);
        }
        // Live Stripe prices so the Settings card shows the real figure, never a
        // drifting hardcoded one. Cached; null when Stripe is unconfigured.
        const prices = await priceService.getLivePrices();
        return res.status(200).json({
            enforced: isBillingEnforced(),
            configured: Boolean(stripeClient.getStripeClient()),
            trialDays: TRIAL_DAYS,
            tierInfo: TIERS[entitlement.tier] || TIERS.trial,
            premium: prices.premium,
            seat: prices.seat,
            ...(seatCount === undefined ? {} : { seatCount }),
            ...entitlement,
        });
    } catch (error) {
        logger.error('Error fetching billing status', { orgId: req.user && req.user.orgId, error: error.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// POST /billing/checkout-session (owner-only). A solo org subscribes for
// itself (solo price, qty 1); a practice subscribes per SEAT (seat price,
// qty = its active client links, min 1 so checkout is never empty).
const createCheckoutSession = async (req, res) => {
    const stripe = stripeClient.getStripeClient();
    if (!stripe) {
        return res.status(502).json({ error: 'Billing is not configured on this server.' });
    }
    try {
        const org = await organisationModel.getOrgById(req.pool, req.user.orgId);
        if (!org) return res.status(404).json({ error: 'Organisation not found.' });

        const isPractice = Boolean(org.is_accountant_practice);
        const priceId = isPractice ? process.env.STRIPE_PRICE_SEAT : process.env.STRIPE_PRICE_SOLO;
        if (!priceId) {
            return res.status(502).json({ error: 'Billing is not configured on this server.' });
        }
        const quantity = isPractice
            ? Math.max(1, await billingModel.countActiveSeats(req.pool, org.id))
            : 1;

        let customerId = org.stripe_customer_id;
        if (!customerId) {
            const owner = await userModel.getUserById(req.pool, req.user.userId);
            const customer = await stripe.customers.create({
                email: owner && owner.email,
                name: org.name,
                metadata: { org_id: org.id },
            });
            customerId = customer.id;
            await billingModel.setStripeCustomerId(req.pool, org.id, customerId);
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            line_items: [{ price: priceId, quantity }],
            client_reference_id: org.id,
            subscription_data: { metadata: { org_id: org.id } },
            allow_promotion_codes: true,
            success_url: `${frontendUrl()}/settings?billing=success`,
            cancel_url: `${frontendUrl()}/settings?billing=canceled`,
        });

        logger.info('Created checkout session', { orgId: org.id, isPractice, quantity });
        return res.status(200).json({ url: session.url });
    } catch (error) {
        logger.error('Error creating checkout session', { orgId: req.user && req.user.orgId, error: error.message });
        return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
};

// POST /billing/portal-session (owner-only) - Stripe's hosted portal handles
// cards, invoices, cancellation; we never build billing management UI.
const createPortalSession = async (req, res) => {
    const stripe = stripeClient.getStripeClient();
    if (!stripe) {
        return res.status(502).json({ error: 'Billing is not configured on this server.' });
    }
    try {
        const org = await organisationModel.getOrgById(req.pool, req.user.orgId);
        if (!org) return res.status(404).json({ error: 'Organisation not found.' });
        if (!org.stripe_customer_id) {
            return res.status(400).json({ error: 'No billing account yet - start a subscription first.' });
        }
        const session = await stripe.billingPortal.sessions.create({
            customer: org.stripe_customer_id,
            return_url: `${frontendUrl()}/settings`,
        });
        return res.status(200).json({ url: session.url });
    } catch (error) {
        logger.error('Error creating portal session', { orgId: req.user && req.user.orgId, error: error.message });
        return res.status(500).json({ error: 'Could not open the billing portal. Please try again.' });
    }
};

// Resolve which org a webhook event is about: prefer our own ids stamped on
// the object (client_reference_id / metadata.org_id), fall back to the
// customer lookup.
const orgIdFromEvent = async (pool, object) => {
    const direct = object.client_reference_id || (object.metadata && object.metadata.org_id);
    if (direct) return direct;
    if (object.customer) {
        const org = await billingModel.getOrgByStripeCustomerId(pool, object.customer);
        if (org) return org.id;
    }
    return null;
};

// POST /billing/webhook - mounted in src/index.js with express.raw() BEFORE
// the JSON body parser (signature verification needs the exact raw bytes).
// No auth middleware: authenticity IS the signature. Per-event errors are
// logged and swallowed - Stripe retries on non-2xx, and a poison event must
// not wedge the queue.
const handleWebhook = async (req, res) => {
    const stripe = stripeClient.getStripeClient();
    const secret = stripeClient.getWebhookSecret();
    if (!stripe || !secret) {
        return res.status(502).json({ error: 'Billing is not configured on this server.' });
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
    } catch (error) {
        logger.warn('Rejected webhook with bad signature: %s', error.message);
        return res.status(400).json({ error: 'Invalid signature.' });
    }

    try {
        const object = event.data.object;
        switch (event.type) {
            case 'checkout.session.completed': {
                const orgId = await orgIdFromEvent(req.pool, object);
                if (!orgId) break;
                await billingModel.applySubscriptionState(req.pool, orgId, {
                    subscriptionId: object.subscription || undefined,
                    customerId: object.customer || undefined,
                    billingStatus: 'active',
                    subscriptionLevel: 'standard',
                });
                break;
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const orgId = await orgIdFromEvent(req.pool, object);
                if (!orgId) break;
                await billingModel.applySubscriptionState(req.pool, orgId, {
                    subscriptionId: object.id,
                    billingStatus: mapStripeStatus(object.status),
                    subscriptionLevel: 'standard',
                    renewalDate: object.current_period_end
                        ? new Date(object.current_period_end * 1000)
                        : undefined,
                });
                break;
            }
            case 'customer.subscription.deleted': {
                const orgId = await orgIdFromEvent(req.pool, object);
                if (!orgId) break;
                await billingModel.applySubscriptionState(req.pool, orgId, {
                    billingStatus: 'canceled',
                });
                break;
            }
            default:
                logger.info('Ignoring webhook event type %s', event.type);
        }
    } catch (error) {
        logger.error('Webhook handling error (acknowledged anyway)', { type: event.type, error: error.message });
    }

    return res.status(200).json({ received: true });
};

// GET /billing/plans - PUBLIC (no auth): the marketing pricing + landing pages
// render entirely from this. Returns whether billing is enforced, the trial
// length, and the live Stripe prices (premium = self-serve, seat = per client
// seat). With enforcement off ("complete demo mode") the pages show the free
// story; the prices are still returned so the paid copy is ready to render the
// moment the flag flips. Never throws to the client - degrades to null prices.
const getPlans = async (req, res) => {
    try {
        const prices = await priceService.getLivePrices();
        return res.status(200).json({
            enforced: isBillingEnforced(),
            trialDays: TRIAL_DAYS,
            premium: prices.premium,
            seat: prices.seat,
        });
    } catch (error) {
        logger.error('Error building plans response', { error: error.message });
        return res.status(200).json({
            enforced: isBillingEnforced(),
            trialDays: TRIAL_DAYS,
            premium: null,
            seat: null,
        });
    }
};

module.exports = { getStatus, getPlans, createCheckoutSession, createPortalSession, handleWebhook, mapStripeStatus };
