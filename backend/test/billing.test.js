/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const { expect } = require('@jest/globals');

const entitlements = require('../src/services/billing/entitlements');
const { getEffectiveSubscription } = entitlements;
const { requireActiveSubscription, requireActiveSubscriptionForWrites } = require('../src/middlewares/billing');
const billingController = require('../src/controllers/billingController');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });

const FUTURE = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();

// One organisations row as the entitlement query returns it.
const orgRow = (overrides = {}) => ({
    id: 'org-1',
    is_accountant_practice: false,
    subscription_level: 'trial',
    billing_status: 'none',
    trial_ends_at: FUTURE,
    covered_by_practice_org_id: null,
    ...overrides,
});

const poolWith = (rows) => ({ query: sinon.stub().resolves({ rows }) });

afterEach(() => {
    sinon.restore();
    delete process.env.BILLING_ENFORCED;
});

describe('getEffectiveSubscription', () => {
    it('returns null for an unknown org', async () => {
        expect(await getEffectiveSubscription(poolWith([]), 'nope')).toBeNull();
    });

    it('a practice org is always active - the seats pay, not the practice', async () => {
        const ent = await getEffectiveSubscription(
            poolWith([orgRow({ is_accountant_practice: true, trial_ends_at: PAST })]), 'org-1');
        expect(ent).toEqual(expect.objectContaining({ active: true, tier: 'standard', reason: 'practice' }));
    });

    it('an org with its own active subscription is active standard', async () => {
        const ent = await getEffectiveSubscription(
            poolWith([orgRow({ billing_status: 'active', subscription_level: 'standard', trial_ends_at: PAST })]), 'org-1');
        expect(ent).toEqual(expect.objectContaining({ active: true, tier: 'standard', reason: 'subscribed', status: 'active' }));
    });

    it("past_due keeps access during Stripe's dunning window, surfacing the status", async () => {
        const ent = await getEffectiveSubscription(
            poolWith([orgRow({ billing_status: 'past_due', trial_ends_at: PAST })]), 'org-1');
        expect(ent).toEqual(expect.objectContaining({ active: true, reason: 'subscribed', status: 'past_due' }));
    });

    it('a client of a paying practice is an active covered seat', async () => {
        const ent = await getEffectiveSubscription(
            poolWith([orgRow({ trial_ends_at: PAST, covered_by_practice_org_id: 'practice-9' })]), 'org-1');
        expect(ent).toEqual(expect.objectContaining({
            active: true, tier: 'standard', reason: 'covered_seat', coveredByPracticeOrgId: 'practice-9',
        }));
    });

    it('cover vanishes with the link: no covered_by + expired trial = inactive', async () => {
        // The SQL only surfaces ACTIVE links to PAYING practices, so a revoked
        // link (or a lapsed practice) simply returns null cover.
        const ent = await getEffectiveSubscription(poolWith([orgRow({ trial_ends_at: PAST })]), 'org-1');
        expect(ent).toEqual(expect.objectContaining({ active: false, reason: 'expired', status: 'trial_expired' }));
    });

    it('an unexpired trial is active on the trial tier', async () => {
        const ent = await getEffectiveSubscription(poolWith([orgRow()]), 'org-1');
        expect(ent).toEqual(expect.objectContaining({ active: true, tier: 'trial', status: 'trialing', reason: 'trial' }));
    });

    it('a canceled subscription past its trial reports the Stripe status', async () => {
        const ent = await getEffectiveSubscription(
            poolWith([orgRow({ billing_status: 'canceled', subscription_level: 'standard', trial_ends_at: PAST })]), 'org-1');
        expect(ent).toEqual(expect.objectContaining({ active: false, tier: 'standard', status: 'canceled' }));
    });

    it('a missing trial_ends_at counts as expired, not as a free pass', async () => {
        const ent = await getEffectiveSubscription(poolWith([orgRow({ trial_ends_at: null })]), 'org-1');
        expect(ent).toEqual(expect.objectContaining({ active: false, reason: 'expired' }));
    });
});

describe('requireActiveSubscriptionForWrites', () => {
    const reqFor = (method, platformRole = 'user') => ({
        method,
        pool: poolWith([]),
        user: { userId: 'u1', orgId: 'org-1', platformRole },
    });

    it('is a no-op while BILLING_ENFORCED is off (the default)', async () => {
        const req = reqFor('POST');
        const next = sinon.stub();
        await requireActiveSubscriptionForWrites(req, makeRes(), next);
        expect(next.calledOnce).toBe(true);
        expect(req.pool.query.notCalled).toBe(true);
    });

    it('waves reads through untouched even when enforced against an expired org', async () => {
        process.env.BILLING_ENFORCED = 'true';
        const resolve = sinon.stub(entitlements, 'getEffectiveSubscription');
        const next = sinon.stub();
        await requireActiveSubscriptionForWrites(reqFor('GET'), makeRes(), next);
        expect(next.calledOnce).toBe(true);
        expect(resolve.notCalled).toBe(true);
    });

    it('402s a write from an expired org with the subscription_required code', async () => {
        process.env.BILLING_ENFORCED = 'true';
        sinon.stub(entitlements, 'getEffectiveSubscription')
            .resolves({ active: false, status: 'trial_expired' });
        const res = makeRes();
        const next = sinon.stub();
        await requireActiveSubscriptionForWrites(reqFor('POST'), res, next);
        expect(next.notCalled).toBe(true);
        expect(res.status.calledWith(402)).toBe(true);
        expect(res.json.firstCall.args[0]).toEqual(
            expect.objectContaining({ code: 'subscription_required', status: 'trial_expired' }));
    });

    it('passes an active org and attaches the entitlement to the request', async () => {
        process.env.BILLING_ENFORCED = 'true';
        const ent = { active: true, tier: 'standard', reason: 'covered_seat' };
        sinon.stub(entitlements, 'getEffectiveSubscription').resolves(ent);
        const req = reqFor('DELETE');
        const next = sinon.stub();
        await requireActiveSubscriptionForWrites(req, makeRes(), next);
        expect(next.calledOnce).toBe(true);
        expect(req.entitlement).toBe(ent);
    });

    it('super_admin writes bypass the gate without resolving anything', async () => {
        process.env.BILLING_ENFORCED = 'true';
        const resolve = sinon.stub(entitlements, 'getEffectiveSubscription');
        const next = sinon.stub();
        await requireActiveSubscriptionForWrites(reqFor('POST', 'super_admin'), makeRes(), next);
        expect(next.calledOnce).toBe(true);
        expect(resolve.notCalled).toBe(true);
    });

    it('fails OPEN when entitlement resolution blows up - billing outages must not block capture', async () => {
        process.env.BILLING_ENFORCED = 'true';
        sinon.stub(entitlements, 'getEffectiveSubscription').rejects(new Error('db down'));
        const res = makeRes();
        const next = sinon.stub();
        await requireActiveSubscription(reqFor('POST'), res, next);
        expect(next.calledOnce).toBe(true);
        expect(res.status.notCalled).toBe(true);
    });

    it('an org the resolver cannot find is blocked, not waved through', async () => {
        process.env.BILLING_ENFORCED = 'true';
        sinon.stub(entitlements, 'getEffectiveSubscription').resolves(null);
        const res = makeRes();
        const next = sinon.stub();
        await requireActiveSubscription(reqFor('POST'), res, next);
        expect(next.notCalled).toBe(true);
        expect(res.status.calledWith(402)).toBe(true);
    });
});

describe('GET /billing/status', () => {
    const reqFor = () => ({ pool: {}, user: { userId: 'u1', orgId: 'org-1', platformRole: 'user' } });

    it('returns the entitlement plus the platform enforcement flag', async () => {
        sinon.stub(entitlements, 'getEffectiveSubscription').resolves({
            active: true, tier: 'trial', status: 'trialing', reason: 'trial',
            trialEndsAt: FUTURE, coveredByPracticeOrgId: null, isPractice: false, orgId: 'org-1',
        });
        const res = makeRes();
        await billingController.getStatus(reqFor(), res);
        expect(res.status.calledWith(200)).toBe(true);
        const body = res.json.firstCall.args[0];
        expect(body).toEqual(expect.objectContaining({
            enforced: false, active: true, tier: 'trial', status: 'trialing', trialEndsAt: FUTURE,
        }));
        expect(body.tierInfo).toEqual(expect.objectContaining({ key: 'trial' }));
    });

    it('reflects BILLING_ENFORCED when set', async () => {
        process.env.BILLING_ENFORCED = 'true';
        sinon.stub(entitlements, 'getEffectiveSubscription').resolves({
            active: false, tier: 'trial', status: 'trial_expired', reason: 'expired',
        });
        const res = makeRes();
        await billingController.getStatus(reqFor(), res);
        expect(res.json.firstCall.args[0]).toEqual(expect.objectContaining({ enforced: true, active: false }));
    });

    it('404s when the org row has vanished', async () => {
        sinon.stub(entitlements, 'getEffectiveSubscription').resolves(null);
        const res = makeRes();
        await billingController.getStatus(reqFor(), res);
        expect(res.status.calledWith(404)).toBe(true);
    });
});
