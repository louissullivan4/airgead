/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { expect } = require('@jest/globals');

const { validateEnv } = require('../src/config/validateEnv');
const { buildStrictLimiter, STRICT_LIMIT } = require('../src/config/rateLimits');
const healthController = require('../src/controllers/healthController');
const userController = require('../src/controllers/userController');
const userModel = require('../src/models/userModel');
const organisationModel = require('../src/models/organisationModel');

const makeRes = () => ({
    status: sinon.stub().returnsThis(),
    json: sinon.stub(),
    send: sinon.stub(),
    redirect: sinon.stub(),
});

afterEach(() => {
    sinon.restore();
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
});

describe('validateEnv', () => {
    const goodEnv = {
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(40),
        DB_URL: 'postgres://u:p@h/db',
        FRONTEND_URL: 'https://app.example.com',
        EMAIL_USERNAME: 'mail@example.com',
        EMAIL_PASSWORD: 'secret',
        CORS_ORIGINS: 'https://app.example.com',
    };

    it('a complete production env passes with no fatals', () => {
        const { fatal } = validateEnv(goodEnv);
        expect(fatal).toEqual([]);
    });

    it('production without JWT_SECRET / DB_URL / FRONTEND_URL is fatal', () => {
        const { fatal } = validateEnv({ NODE_ENV: 'production' });
        expect(fatal.length).toBeGreaterThanOrEqual(3);
    });

    it('a short JWT_SECRET is fatal in production', () => {
        const { fatal } = validateEnv({ ...goodEnv, JWT_SECRET: 'short' });
        expect(fatal.some((f) => f.includes('JWT_SECRET'))).toBe(true);
    });

    it('the same problems only WARN outside production', () => {
        const { fatal, warnings } = validateEnv({ NODE_ENV: 'development' });
        expect(fatal).toEqual([]);
        expect(warnings.length).toBeGreaterThan(0);
    });

    it('enforced billing without Stripe keys warns loudly', () => {
        const { warnings } = validateEnv({ ...goodEnv, BILLING_ENFORCED: 'true' });
        expect(warnings.some((w) => w.includes('STRIPE_SECRET_KEY'))).toBe(true);
    });
});

describe('strict rate limiter', () => {
    it(`blocks the ${STRICT_LIMIT + 1}th attempt from one key with a 429`, async () => {
        const limiter = buildStrictLimiter({ validate: false, keyGenerator: () => 'same-ip' });
        const next = sinon.stub();
        let lastRes;
        for (let i = 0; i < STRICT_LIMIT + 1; i += 1) {
            lastRes = makeRes();
            lastRes.setHeader = sinon.stub();
            await limiter({ ip: '1.1.1.1', method: 'POST', headers: {} }, lastRes, next);
        }
        expect(next.callCount).toBe(STRICT_LIMIT);
        expect(lastRes.status.calledWith(429)).toBe(true);
    });
});

describe('GET /health', () => {
    it('200s when the database answers', async () => {
        const res = makeRes();
        await healthController.health({ pool: { query: sinon.stub().resolves({ rows: [] }) } }, res);
        expect(res.status.calledWith(200)).toBe(true);
    });

    it('503s when the database is unreachable', async () => {
        const res = makeRes();
        await healthController.health({ pool: { query: sinon.stub().rejects(new Error('conn refused')) } }, res);
        expect(res.status.calledWith(503)).toBe(true);
    });
});

describe('email verification', () => {
    const DAY = 24 * 3600 * 1000;
    const baseUser = {
        id: 'u1', email: 'test@example.ie', password_hash: 'hash', role: 'user',
        org_id: 'org-1', org_role: 'owner', platform_role: 'user', account_status: 'active',
        fname: 'Test',
    };

    const loginReq = () => ({ pool: {}, body: { email: 'test@example.ie', password: 'pw' } });

    const stubLoginPath = (userRow) => {
        sinon.stub(userModel, 'getUserPasswordByEmail').resolves(userRow);
        sinon.stub(bcrypt, 'compare').resolves(true);
        sinon.stub(organisationModel, 'getOrgById').resolves({ id: 'org-1', status: 'active' });
    };

    it('login blocks an unverified account past the 7-day grace with code email_unverified', async () => {
        stubLoginPath({
            ...baseUser,
            email_verified_at: null,
            created_at: new Date(Date.now() - 8 * DAY).toISOString(),
        });
        const res = makeRes();
        await userController.login(loginReq(), res);
        expect(res.status.calledWith(403)).toBe(true);
        expect(res.json.firstCall.args[0]).toEqual(expect.objectContaining({ code: 'email_unverified' }));
    });

    it('login allows an unverified account still inside the grace window', async () => {
        stubLoginPath({
            ...baseUser,
            email_verified_at: null,
            created_at: new Date(Date.now() - 2 * DAY).toISOString(),
        });
        const res = makeRes();
        await userController.login(loginReq(), res);
        expect(res.status.calledWith(200)).toBe(true);
    });

    it('login allows a verified account regardless of age', async () => {
        stubLoginPath({
            ...baseUser,
            email_verified_at: new Date().toISOString(),
            created_at: new Date(Date.now() - 100 * DAY).toISOString(),
        });
        const res = makeRes();
        await userController.login(loginReq(), res);
        expect(res.status.calledWith(200)).toBe(true);
    });

    it('REQUIRE_EMAIL_VERIFICATION=false disables the login gate entirely', async () => {
        process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
        stubLoginPath({
            ...baseUser,
            email_verified_at: null,
            created_at: new Date(Date.now() - 100 * DAY).toISOString(),
        });
        const res = makeRes();
        await userController.login(loginReq(), res);
        expect(res.status.calledWith(200)).toBe(true);
    });

    it('register through an invite token stamps the account verified and sends no verify mail', async () => {
        const inviteToken = jwt.sign({ email: 'invitee@example.ie', inviter_id: 'u9' }, process.env.JWT_SECRET);
        sinon.stub(userModel, 'isEmailUnique').resolves(true);
        const create = sinon.stub(organisationModel, 'createUserWithOrg').resolves({ ...baseUser, email: 'invitee@example.ie' });
        const transport = sinon.stub(nodemailer, 'createTransport');
        const res = makeRes();

        await userController.register({
            pool: {},
            body: { token: inviteToken, fname: 'A', sname: 'B', email: 'invitee@example.ie', password: 'Password123!', currency: 'EUR' },
        }, res);

        expect(res.status.calledWith(201)).toBe(true);
        expect(create.firstCall.args[1]).toEqual(expect.objectContaining({ emailVerified: true }));
        expect(transport.notCalled).toBe(true);
    });

    it('self-serve register starts unverified and sends the verification email', async () => {
        sinon.stub(userModel, 'isEmailUnique').resolves(true);
        const create = sinon.stub(organisationModel, 'createUserWithOrg').resolves(baseUser);
        const sendMail = sinon.stub().resolves();
        sinon.stub(nodemailer, 'createTransport').returns({ sendMail });
        const res = makeRes();

        await userController.register({
            pool: {},
            body: { fname: 'A', sname: 'B', email: 'test@example.ie', password: 'Password123!', currency: 'EUR' },
        }, res);

        expect(res.status.calledWith(201)).toBe(true);
        expect(create.firstCall.args[1]).toEqual(expect.objectContaining({ emailVerified: false }));
        expect(sendMail.calledOnce).toBe(true);
        expect(sendMail.firstCall.args[0].text).toContain('/users/verify-email?token=');
    });

    it('a mail outage never fails the signup itself', async () => {
        sinon.stub(userModel, 'isEmailUnique').resolves(true);
        sinon.stub(organisationModel, 'createUserWithOrg').resolves(baseUser);
        sinon.stub(nodemailer, 'createTransport').returns({ sendMail: sinon.stub().rejects(new Error('smtp down')) });
        const res = makeRes();

        await userController.register({
            pool: {},
            body: { fname: 'A', sname: 'B', email: 'test@example.ie', password: 'Password123!', currency: 'EUR' },
        }, res);

        expect(res.status.calledWith(201)).toBe(true);
    });

    it('GET /users/verify-email with a valid token stamps and bounces to login?verified=1', async () => {
        const token = jwt.sign({ email: 'test@example.ie', kind: 'verify' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        const setVerified = sinon.stub(userModel, 'setEmailVerifiedByEmail').resolves({ id: 'u1' });
        const res = makeRes();

        await userController.verifyEmail({ pool: {}, query: { token } }, res);

        expect(setVerified.calledWith(sinon.match.any, 'test@example.ie')).toBe(true);
        expect(res.redirect.firstCall.args[0]).toContain('verified=1');
    });

    it('a token of the wrong kind cannot verify (an invite token is not a verify token)', async () => {
        const token = jwt.sign({ email: 'test@example.ie', inviter_id: 'u9' }, process.env.JWT_SECRET);
        const setVerified = sinon.stub(userModel, 'setEmailVerifiedByEmail');
        const res = makeRes();

        await userController.verifyEmail({ pool: {}, query: { token } }, res);

        expect(setVerified.notCalled).toBe(true);
        expect(res.redirect.firstCall.args[0]).toContain('verified=expired');
    });

    it('an expired/garbage token bounces to login?verified=expired', async () => {
        const res = makeRes();
        await userController.verifyEmail({ pool: {}, query: { token: 'garbage' } }, res);
        expect(res.redirect.firstCall.args[0]).toContain('verified=expired');
    });

    it('resend-verification answers 200 identically for unknown accounts (no enumeration)', async () => {
        sinon.stub(userModel, 'getUserByEmail').resolves(null);
        const transport = sinon.stub(nodemailer, 'createTransport');
        const res = makeRes();

        await userController.resendVerification({ pool: {}, body: { email: 'nobody@example.ie' } }, res);

        expect(res.status.calledWith(200)).toBe(true);
        expect(transport.notCalled).toBe(true);
    });

    it('resend-verification sends for an existing unverified account', async () => {
        sinon.stub(userModel, 'getUserByEmail').resolves({ ...baseUser, email_verified_at: null });
        const sendMail = sinon.stub().resolves();
        sinon.stub(nodemailer, 'createTransport').returns({ sendMail });
        const res = makeRes();

        await userController.resendVerification({ pool: {}, body: { email: 'test@example.ie' } }, res);

        expect(res.status.calledWith(200)).toBe(true);
        expect(sendMail.calledOnce).toBe(true);
    });

    it('resend-verification does NOT re-send for an already-verified account', async () => {
        sinon.stub(userModel, 'getUserByEmail').resolves({ ...baseUser, email_verified_at: new Date().toISOString() });
        const transport = sinon.stub(nodemailer, 'createTransport');
        const res = makeRes();

        await userController.resendVerification({ pool: {}, body: { email: 'test@example.ie' } }, res);

        expect(res.status.calledWith(200)).toBe(true);
        expect(transport.notCalled).toBe(true);
    });
});
