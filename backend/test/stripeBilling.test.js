/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const { expect } = require('@jest/globals');

const stripeClient = require('../src/services/billing/stripeClient');
const billingModel = require('../src/models/billingModel');
const organisationModel = require('../src/models/organisationModel');
const userModel = require('../src/models/userModel');
const billingController = require('../src/controllers/billingController');
const { syncPracticeSeats } = require('../src/services/billing/seatSync');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });

const authedReq = (extra = {}) => ({
    pool: {},
    user: { userId: 'u1', orgId: 'org-1', orgRole: 'owner', platformRole: 'user' },
    ...extra,
});

afterEach(() => {
    sinon.restore();
    delete process.env.STRIPE_PRICE_SOLO;
    delete process.env.STRIPE_PRICE_SEAT;
});

describe('POST /billing/checkout-session', () => {
    it('502s cleanly when Stripe is not configured', async () => {
        sinon.stub(stripeClient, 'getStripeClient').returns(null);
        const res = makeRes();
        await billingController.createCheckoutSession(authedReq(), res);
        expect(res.status.calledWith(502)).toBe(true);
    });

    it('a solo org checks out the solo price at quantity 1, creating the customer once', async () => {
        process.env.STRIPE_PRICE_SOLO = 'price_solo';
        const create = sinon.stub().resolves({ id: 'cus_new' });
        const sessions = sinon.stub().resolves({ url: 'https://stripe.test/checkout' });
        sinon.stub(stripeClient, 'getStripeClient').returns({
            customers: { create },
            checkout: { sessions: { create: sessions } },
        });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', name: 'Galway Equine', is_accountant_practice: false, stripe_customer_id: null,
        });
        sinon.stub(userModel, 'getUserById').resolves({ id: 'u1', email: 'aoife@example.ie' });
        const saveCustomer = sinon.stub(billingModel, 'setStripeCustomerId').resolves({ id: 'org-1' });

        const res = makeRes();
        await billingController.createCheckoutSession(authedReq(), res);

        expect(create.calledOnce).toBe(true);
        expect(create.firstCall.args[0]).toEqual(expect.objectContaining({ email: 'aoife@example.ie' }));
        expect(saveCustomer.calledWith(sinon.match.any, 'org-1', 'cus_new')).toBe(true);
        const args = sessions.firstCall.args[0];
        expect(args.line_items).toEqual([{ price: 'price_solo', quantity: 1 }]);
        expect(args.mode).toBe('subscription');
        expect(args.client_reference_id).toBe('org-1');
        expect(res.json.firstCall.args[0]).toEqual({ url: 'https://stripe.test/checkout' });
    });

    it('a practice checks out the SEAT price at its active-link count', async () => {
        process.env.STRIPE_PRICE_SEAT = 'price_seat';
        const sessions = sinon.stub().resolves({ url: 'https://stripe.test/checkout' });
        sinon.stub(stripeClient, 'getStripeClient').returns({
            checkout: { sessions: { create: sessions } },
        });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', name: 'Rian Accountancy', is_accountant_practice: true, stripe_customer_id: 'cus_existing',
        });
        sinon.stub(billingModel, 'countActiveSeats').resolves(7);

        const res = makeRes();
        await billingController.createCheckoutSession(authedReq(), res);

        expect(sessions.firstCall.args[0].line_items).toEqual([{ price: 'price_seat', quantity: 7 }]);
        expect(sessions.firstCall.args[0].customer).toBe('cus_existing');
    });

    it('a practice with zero clients still checks out one seat (never an empty cart)', async () => {
        process.env.STRIPE_PRICE_SEAT = 'price_seat';
        const sessions = sinon.stub().resolves({ url: 'x' });
        sinon.stub(stripeClient, 'getStripeClient').returns({ checkout: { sessions: { create: sessions } } });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', is_accountant_practice: true, stripe_customer_id: 'cus_1',
        });
        sinon.stub(billingModel, 'countActiveSeats').resolves(0);

        await billingController.createCheckoutSession(authedReq(), makeRes());
        expect(sessions.firstCall.args[0].line_items[0].quantity).toBe(1);
    });

    it('502s when the price id for the org kind is missing', async () => {
        sinon.stub(stripeClient, 'getStripeClient').returns({});
        sinon.stub(organisationModel, 'getOrgById').resolves({ id: 'org-1', is_accountant_practice: false });
        const res = makeRes();
        await billingController.createCheckoutSession(authedReq(), res);
        expect(res.status.calledWith(502)).toBe(true);
    });
});

describe('POST /billing/portal-session', () => {
    it('400s an org that has never checked out', async () => {
        sinon.stub(stripeClient, 'getStripeClient').returns({});
        sinon.stub(organisationModel, 'getOrgById').resolves({ id: 'org-1', stripe_customer_id: null });
        const res = makeRes();
        await billingController.createPortalSession(authedReq(), res);
        expect(res.status.calledWith(400)).toBe(true);
    });

    it('returns the portal url for a customer', async () => {
        const portal = sinon.stub().resolves({ url: 'https://stripe.test/portal' });
        sinon.stub(stripeClient, 'getStripeClient').returns({ billingPortal: { sessions: { create: portal } } });
        sinon.stub(organisationModel, 'getOrgById').resolves({ id: 'org-1', stripe_customer_id: 'cus_1' });
        const res = makeRes();
        await billingController.createPortalSession(authedReq(), res);
        expect(portal.calledWith(sinon.match({ customer: 'cus_1' }))).toBe(true);
        expect(res.json.firstCall.args[0]).toEqual({ url: 'https://stripe.test/portal' });
    });
});

describe('POST /billing/webhook', () => {
    const webhookReq = (body = {}) => ({
        pool: {},
        headers: { 'stripe-signature': 'sig_test' },
        body: Buffer.from(JSON.stringify(body)),
    });

    const stubStripe = (event) => {
        const constructEvent = event instanceof Error
            ? sinon.stub().throws(event)
            : sinon.stub().returns(event);
        sinon.stub(stripeClient, 'getStripeClient').returns({ webhooks: { constructEvent } });
        sinon.stub(stripeClient, 'getWebhookSecret').returns('whsec_test');
        return constructEvent;
    };

    it('502s when Stripe/webhook secret are unconfigured', async () => {
        sinon.stub(stripeClient, 'getStripeClient').returns(null);
        const res = makeRes();
        await billingController.handleWebhook(webhookReq(), res);
        expect(res.status.calledWith(502)).toBe(true);
    });

    it('400s a bad signature and touches nothing', async () => {
        stubStripe(new Error('No signatures found'));
        const apply = sinon.stub(billingModel, 'applySubscriptionState');
        const res = makeRes();
        await billingController.handleWebhook(webhookReq(), res);
        expect(res.status.calledWith(400)).toBe(true);
        expect(apply.notCalled).toBe(true);
    });

    it('checkout.session.completed activates the org and stores the Stripe ids', async () => {
        stubStripe({
            type: 'checkout.session.completed',
            data: { object: { client_reference_id: 'org-1', customer: 'cus_1', subscription: 'sub_1' } },
        });
        const apply = sinon.stub(billingModel, 'applySubscriptionState').resolves({});
        const res = makeRes();
        await billingController.handleWebhook(webhookReq(), res);
        expect(res.status.calledWith(200)).toBe(true);
        expect(apply.calledOnce).toBe(true);
        expect(apply.firstCall.args[2]).toEqual(expect.objectContaining({
            billingStatus: 'active', subscriptionLevel: 'standard', subscriptionId: 'sub_1', customerId: 'cus_1',
        }));
    });

    it('subscription.updated maps the Stripe status and renewal date, finding the org by customer', async () => {
        const periodEnd = Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000);
        stubStripe({
            type: 'customer.subscription.updated',
            data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', current_period_end: periodEnd } },
        });
        sinon.stub(billingModel, 'getOrgByStripeCustomerId').resolves({ id: 'org-9' });
        const apply = sinon.stub(billingModel, 'applySubscriptionState').resolves({});
        await billingController.handleWebhook(webhookReq(), makeRes());
        expect(apply.firstCall.args[1]).toBe('org-9');
        expect(apply.firstCall.args[2]).toEqual(expect.objectContaining({
            billingStatus: 'past_due',
            renewalDate: new Date(periodEnd * 1000),
        }));
    });

    it('subscription.deleted cancels the org', async () => {
        stubStripe({
            type: 'customer.subscription.deleted',
            data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { org_id: 'org-1' } } },
        });
        const apply = sinon.stub(billingModel, 'applySubscriptionState').resolves({});
        await billingController.handleWebhook(webhookReq(), makeRes());
        expect(apply.firstCall.args[2]).toEqual(expect.objectContaining({ billingStatus: 'canceled' }));
    });

    it('still 200s when the handler blows up - Stripe must not retry a poison event forever', async () => {
        stubStripe({
            type: 'checkout.session.completed',
            data: { object: { client_reference_id: 'org-1' } },
        });
        sinon.stub(billingModel, 'applySubscriptionState').rejects(new Error('db down'));
        const res = makeRes();
        await billingController.handleWebhook(webhookReq(), res);
        expect(res.status.calledWith(200)).toBe(true);
    });

    it('unknown event types are acknowledged and ignored', async () => {
        stubStripe({ type: 'invoice.finalized', data: { object: {} } });
        const apply = sinon.stub(billingModel, 'applySubscriptionState');
        const res = makeRes();
        await billingController.handleWebhook(webhookReq(), res);
        expect(res.status.calledWith(200)).toBe(true);
        expect(apply.notCalled).toBe(true);
    });
});

describe('syncPracticeSeats', () => {
    it('no-ops without Stripe configured', async () => {
        sinon.stub(stripeClient, 'getStripeClient').returns(null);
        expect(await syncPracticeSeats({}, 'org-1')).toEqual({ synced: false, reason: 'unconfigured' });
    });

    it('no-ops for a practice that has not subscribed yet', async () => {
        sinon.stub(stripeClient, 'getStripeClient').returns({});
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', is_accountant_practice: true, stripe_subscription_id: null,
        });
        expect(await syncPracticeSeats({}, 'org-1')).toEqual({ synced: false, reason: 'no_subscription' });
    });

    it('updates the subscription item quantity to the active-link count', async () => {
        const update = sinon.stub().resolves({});
        sinon.stub(stripeClient, 'getStripeClient').returns({
            subscriptions: {
                retrieve: sinon.stub().resolves({ id: 'sub_1', items: { data: [{ id: 'si_1', quantity: 2 }] } }),
                update,
            },
        });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', is_accountant_practice: true, stripe_subscription_id: 'sub_1',
        });
        sinon.stub(billingModel, 'countActiveSeats').resolves(5);

        expect(await syncPracticeSeats({}, 'org-1')).toEqual({ synced: true, seats: 5, changed: true });
        expect(update.calledWith('sub_1', sinon.match({ items: [{ id: 'si_1', quantity: 5 }] }))).toBe(true);
    });

    it('skips the Stripe call when the quantity already matches', async () => {
        const update = sinon.stub();
        sinon.stub(stripeClient, 'getStripeClient').returns({
            subscriptions: {
                retrieve: sinon.stub().resolves({ id: 'sub_1', items: { data: [{ id: 'si_1', quantity: 3 }] } }),
                update,
            },
        });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', is_accountant_practice: true, stripe_subscription_id: 'sub_1',
        });
        sinon.stub(billingModel, 'countActiveSeats').resolves(3);

        expect(await syncPracticeSeats({}, 'org-1')).toEqual({ synced: true, seats: 3, changed: false });
        expect(update.notCalled).toBe(true);
    });

    it('swallows Stripe failures - a sync must never fail the signup/revoke that triggered it', async () => {
        sinon.stub(stripeClient, 'getStripeClient').returns({
            subscriptions: { retrieve: sinon.stub().rejects(new Error('stripe 500')) },
        });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', is_accountant_practice: true, stripe_subscription_id: 'sub_1',
        });
        sinon.stub(billingModel, 'countActiveSeats').resolves(2);

        expect(await syncPracticeSeats({}, 'org-1')).toEqual({ synced: false, reason: 'error' });
    });
});
