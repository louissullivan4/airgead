/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const { expect } = require('@jest/globals');

const stripeClient = require('../src/services/billing/stripeClient');
const billingModel = require('../src/models/billingModel');
const organisationModel = require('../src/models/organisationModel');
const userModel = require('../src/models/userModel');
const billingController = require('../src/controllers/billingController');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });

const authedReq = (extra = {}) => ({
    pool: {},
    user: { userId: 'u1', orgId: 'org-1', orgRole: 'owner', platformRole: 'user' },
    ...extra,
});

afterEach(() => {
    sinon.restore();
    delete process.env.STRIPE_PRICE_SOLO;
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

    it('a practice is free and is refused checkout (nothing to buy)', async () => {
        process.env.STRIPE_PRICE_SOLO = 'price_solo';
        const sessions = sinon.stub().resolves({ url: 'x' });
        sinon.stub(stripeClient, 'getStripeClient').returns({ checkout: { sessions: { create: sessions } } });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', name: 'Airgead Accountancy', is_accountant_practice: true, stripe_customer_id: 'cus_existing',
        });

        const res = makeRes();
        await billingController.createCheckoutSession(authedReq(), res);

        expect(res.status.calledWith(400)).toBe(true);
        expect(sessions.notCalled).toBe(true);
    });

    it('a pending practice applicant is also refused checkout (free during review)', async () => {
        process.env.STRIPE_PRICE_SOLO = 'price_solo';
        const sessions = sinon.stub().resolves({ url: 'x' });
        sinon.stub(stripeClient, 'getStripeClient').returns({ checkout: { sessions: { create: sessions } } });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-1', is_accountant_practice: false, practice_status: 'pending', stripe_customer_id: 'cus_1',
        });

        const res = makeRes();
        await billingController.createCheckoutSession(authedReq(), res);
        expect(res.status.calledWith(400)).toBe(true);
        expect(sessions.notCalled).toBe(true);
    });

    it('502s when the solo price id is missing', async () => {
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
