/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const jwt = require('jsonwebtoken');
const { expect } = require('@jest/globals');

const { requireSageEnabled } = require('../src/config/sage');
const tokenCrypto = require('../src/utils/tokenCrypto');
const sageClient = require('../src/services/sage/sageClient');
const sageAuth = require('../src/services/sage/sageAuth');
const sageModel = require('../src/models/sageModel');
const sageController = require('../src/controllers/sageController');

const KEY = 'a'.repeat(64);

const makeRes = () => ({
    status: sinon.stub().returnsThis(),
    json: sinon.stub(),
    redirect: sinon.stub(),
});

const authedReq = (extra = {}) => ({
    pool: {},
    params: {},
    query: {},
    user: { userId: 'u1', orgId: 'org-1', orgRole: 'owner', platformRole: 'user' },
    ...extra,
});

// Full config: creds + encryption key (isSageConfigured() true).
const configureSage = () => {
    process.env.SAGE_CLIENT_ID = 'client-id';
    process.env.SAGE_CLIENT_SECRET = 'client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
};

afterEach(() => {
    sinon.restore();
    delete process.env.SAGE_ENABLED;
    delete process.env.SAGE_CLIENT_ID;
    delete process.env.SAGE_CLIENT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.PUBLIC_BACKEND_URL;
    delete process.env.FRONTEND_URL;
});

describe('requireSageEnabled (feature flag gate)', () => {
    it('404s when the flag is off and never calls next', () => {
        const res = makeRes();
        const next = sinon.stub();
        requireSageEnabled({}, res, next);
        expect(res.status.calledWith(404)).toBe(true);
        expect(next.notCalled).toBe(true);
    });

    it('passes through when SAGE_ENABLED=true', () => {
        process.env.SAGE_ENABLED = 'true';
        const next = sinon.stub();
        requireSageEnabled({}, makeRes(), next);
        expect(next.calledOnce).toBe(true);
    });
});

describe('POST /sage/connect', () => {
    it('502s when client credentials are missing', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = KEY;
        const res = makeRes();
        await sageController.connect(authedReq(), res);
        expect(res.status.calledWith(502)).toBe(true);
    });

    it('502s when the token encryption key is missing', async () => {
        process.env.SAGE_CLIENT_ID = 'client-id';
        process.env.SAGE_CLIENT_SECRET = 'client-secret';
        const res = makeRes();
        await sageController.connect(authedReq(), res);
        expect(res.status.calledWith(502)).toBe(true);
    });

    it('returns the consent URL with a verifiable signed state', async () => {
        configureSage();
        process.env.PUBLIC_BACKEND_URL = 'https://api.example.com';
        const res = makeRes();
        await sageController.connect(authedReq(), res);

        const { url } = res.json.firstCall.args[0];
        const params = new URL(url).searchParams;
        expect(params.get('client_id')).toBe('client-id');
        expect(params.get('redirect_uri')).toBe('https://api.example.com/sage/callback');
        expect(params.get('scope')).toBe('full_access');
        expect(params.get('response_type')).toBe('code');

        const state = jwt.verify(params.get('state'), process.env.JWT_SECRET);
        expect(state).toEqual(expect.objectContaining({ userId: 'u1', orgId: 'org-1', purpose: 'sage_oauth' }));
        // Short-lived: ~10 minutes, not the 7-day session TTL.
        expect(state.exp - state.iat).toBeLessThanOrEqual(600);
    });
});

describe('GET /sage/callback', () => {
    const redirectOf = (res) => res.redirect.firstCall.args[0];

    it('rejects a garbage state without attempting the token exchange', async () => {
        configureSage();
        const exchange = sinon.stub(sageClient, 'exchangeCodeForTokens');
        const res = makeRes();
        await sageController.callback({ pool: {}, query: { code: 'c', state: 'garbage' } }, res);
        expect(redirectOf(res)).toContain('sage=error&reason=state');
        expect(exchange.notCalled).toBe(true);
    });

    it('rejects a real JWT signed for a different purpose', async () => {
        configureSage();
        const exchange = sinon.stub(sageClient, 'exchangeCodeForTokens');
        const state = jwt.sign({ userId: 'u1', orgId: 'org-1', purpose: 'invite' }, process.env.JWT_SECRET);
        const res = makeRes();
        await sageController.callback({ pool: {}, query: { code: 'c', state } }, res);
        expect(redirectOf(res)).toContain('sage=error&reason=state');
        expect(exchange.notCalled).toBe(true);
    });

    it('maps a user denial at Sage to reason=denied, no exchange', async () => {
        configureSage();
        const exchange = sinon.stub(sageClient, 'exchangeCodeForTokens');
        const res = makeRes();
        await sageController.callback({ pool: {}, query: { error: 'access_denied' } }, res);
        expect(redirectOf(res)).toContain('sage=error&reason=denied');
        expect(exchange.notCalled).toBe(true);
    });

    it('happy path: exchanges the code, stores ENCRYPTED tokens for the state org, redirects connected', async () => {
        configureSage();
        process.env.FRONTEND_URL = 'https://app.example.com';
        sinon.stub(sageClient, 'exchangeCodeForTokens').resolves({
            accessToken: 'atk', refreshToken: 'rtk', expiresIn: 300, refreshTokenExpiresIn: 2678400,
        });
        const upsert = sinon.stub(sageModel, 'upsertConnection').resolves({});
        const res = makeRes();
        const state = jwt.sign({ userId: 'u1', orgId: 'org-1', purpose: 'sage_oauth' }, process.env.JWT_SECRET, { expiresIn: '10m' });
        await sageController.callback({ pool: {}, query: { code: 'the-code', state } }, res);

        const args = upsert.firstCall.args[1];
        expect(args.orgId).toBe('org-1');
        expect(args.connectedBy).toBe('u1');
        // Stored encrypted, decrypts back to the originals.
        expect(args.accessTokenEncrypted).not.toContain('atk');
        expect(tokenCrypto.decrypt(args.accessTokenEncrypted)).toBe('atk');
        expect(tokenCrypto.decrypt(args.refreshTokenEncrypted)).toBe('rtk');
        expect(redirectOf(res)).toBe('https://app.example.com/settings?sage=connected');
    });

    it('a failed exchange redirects reason=exchange and persists nothing', async () => {
        configureSage();
        sinon.stub(sageClient, 'exchangeCodeForTokens').rejects(new Error('boom'));
        const upsert = sinon.stub(sageModel, 'upsertConnection');
        const res = makeRes();
        const state = jwt.sign({ userId: 'u1', orgId: 'org-1', purpose: 'sage_oauth' }, process.env.JWT_SECRET);
        await sageController.callback({ pool: {}, query: { code: 'c', state } }, res);
        expect(redirectOf(res)).toContain('sage=error&reason=exchange');
        expect(upsert.notCalled).toBe(true);
    });
});

describe('getValidAccessToken - rotation-safe refresh', () => {
    const freshRow = () => ({
        org_id: 'org-1',
        status: 'active',
        access_token_encrypted: tokenCrypto.encrypt('fresh-token'),
        refresh_token_encrypted: tokenCrypto.encrypt('refresh-old'),
        access_token_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    const staleRow = () => ({
        org_id: 'org-1',
        status: 'active',
        access_token_encrypted: tokenCrypto.encrypt('stale-token'),
        refresh_token_encrypted: tokenCrypto.encrypt('refresh-old'),
        access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const makeTxClient = () => ({ query: sinon.stub().resolves({ rows: [] }), release: sinon.stub() });

    it('returns a fresh token from the hot path without ever taking a lock', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = KEY;
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(freshRow());
        const pool = { connect: sinon.stub() };
        const token = await sageAuth.getValidAccessToken(pool, 'org-1');
        expect(token).toBe('fresh-token');
        expect(pool.connect.notCalled).toBe(true);
    });

    it('an expired token refreshes under FOR UPDATE and persists the ROTATED pair', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = KEY;
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(staleRow());
        const client = makeTxClient();
        const pool = { connect: sinon.stub().resolves(client) };
        sinon.stub(sageModel, 'lockConnection').resolves(staleRow());
        const refresh = sinon.stub(sageClient, 'refreshAccessToken').resolves({
            accessToken: 'access-new', refreshToken: 'refresh-new', expiresIn: 300, refreshTokenExpiresIn: 2678400,
        });
        const persist = sinon.stub(sageModel, 'updateConnectionTokens').resolves();

        const token = await sageAuth.getValidAccessToken(pool, 'org-1');

        expect(token).toBe('access-new');
        expect(refresh.calledOnceWith('refresh-old')).toBe(true);
        const saved = persist.firstCall.args[2];
        expect(tokenCrypto.decrypt(saved.accessTokenEncrypted)).toBe('access-new');
        expect(tokenCrypto.decrypt(saved.refreshTokenEncrypted)).toBe('refresh-new');
        expect(client.query.calledWith('BEGIN')).toBe(true);
        expect(client.query.calledWith('COMMIT')).toBe(true);
        expect(client.release.calledOnce).toBe(true);
    });

    it('concurrent-refresh safety: a locked re-read that is already fresh skips the refresh', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = KEY;
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(staleRow());
        const client = makeTxClient();
        const pool = { connect: sinon.stub().resolves(client) };
        // By the time WE hold the lock, someone else already refreshed.
        sinon.stub(sageModel, 'lockConnection').resolves(freshRow());
        const refresh = sinon.stub(sageClient, 'refreshAccessToken');

        const token = await sageAuth.getValidAccessToken(pool, 'org-1');

        expect(token).toBe('fresh-token');
        expect(refresh.notCalled).toBe(true);
    });

    it('invalid_grant (400) marks the connection expired and demands a reconnect', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = KEY;
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(staleRow());
        const client = makeTxClient();
        const pool = { connect: sinon.stub().resolves(client) };
        sinon.stub(sageModel, 'lockConnection').resolves(staleRow());
        const rejection = new Error('invalid_grant');
        rejection.status = 400;
        sinon.stub(sageClient, 'refreshAccessToken').rejects(rejection);
        const expire = sinon.stub(sageModel, 'markConnectionExpired').resolves();

        await expect(sageAuth.getValidAccessToken(pool, 'org-1')).rejects.toBeInstanceOf(sageAuth.SageReconnectError);
        expect(expire.calledOnce).toBe(true);
        expect(client.release.calledOnce).toBe(true);
    });

    it('no connection row means reconnect required', async () => {
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(null);
        await expect(sageAuth.getValidAccessToken({}, 'org-1')).rejects.toBeInstanceOf(sageAuth.SageReconnectError);
    });
});

describe('authedRequest - 401 retry', () => {
    const makeTxClient = () => ({ query: sinon.stub().resolves({ rows: [] }), release: sinon.stub() });
    const rowWith = (token, expiresInMs) => ({
        org_id: 'org-1',
        status: 'active',
        access_token_encrypted: tokenCrypto.encrypt(token),
        refresh_token_encrypted: tokenCrypto.encrypt('refresh-old'),
        access_token_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    });

    it('a 401 forces one refresh and retries once with the new token', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = KEY;
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(rowWith('revoked-but-fresh', 10 * 60_000));
        const client = makeTxClient();
        const pool = { connect: sinon.stub().resolves(client) };
        // The forced-refresh path re-reads under lock: hand it a stale row so
        // it actually refreshes rather than reusing the rejected token.
        sinon.stub(sageModel, 'lockConnection').resolves(rowWith('revoked-but-fresh', -1000));
        sinon.stub(sageClient, 'refreshAccessToken').resolves({
            accessToken: 'access-new', refreshToken: 'refresh-new', expiresIn: 300,
        });
        sinon.stub(sageModel, 'updateConnectionTokens').resolves();

        const unauthorized = new Error('unauthorized');
        unauthorized.status = 401;
        const apiRequest = sinon.stub(sageClient, 'apiRequest');
        apiRequest.onFirstCall().rejects(unauthorized);
        apiRequest.onSecondCall().resolves({ id: 'op-1' });

        const result = await sageAuth.authedRequest(pool, 'org-1', { path: '/other_payments', method: 'post' });

        expect(result).toEqual({ id: 'op-1' });
        expect(apiRequest.callCount).toBe(2);
        expect(apiRequest.firstCall.args[0].accessToken).toBe('revoked-but-fresh');
        expect(apiRequest.secondCall.args[0].accessToken).toBe('access-new');
    });

    it('a second 401 marks the connection expired and gives up', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = KEY;
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(rowWith('dead-token', 10 * 60_000));
        const client = makeTxClient();
        const pool = { connect: sinon.stub().resolves(client) };
        sinon.stub(sageModel, 'lockConnection').resolves(rowWith('dead-token', -1000));
        sinon.stub(sageClient, 'refreshAccessToken').resolves({
            accessToken: 'also-dead', refreshToken: 'refresh-new', expiresIn: 300,
        });
        sinon.stub(sageModel, 'updateConnectionTokens').resolves();
        const expire = sinon.stub(sageModel, 'markConnectionExpired').resolves();

        const unauthorized = () => Object.assign(new Error('unauthorized'), { status: 401 });
        const apiRequest = sinon.stub(sageClient, 'apiRequest');
        apiRequest.onFirstCall().rejects(unauthorized());
        apiRequest.onSecondCall().rejects(unauthorized());

        await expect(sageAuth.authedRequest(pool, 'org-1', { path: '/businesses' }))
            .rejects.toBeInstanceOf(sageAuth.SageReconnectError);
        expect(apiRequest.callCount).toBe(2);
        expect(expire.calledOnce).toBe(true);
    });
});

describe('Sage lookups', () => {
    it('maps Sage $items to dropdown options and forwards the business id', async () => {
        configureSage();
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves({ status: 'active' });
        const authed = sinon.stub(sageAuth, 'authedRequest').resolves({
            $items: [{ id: 'ba-1', displayed_as: 'Current account' }, { id: 'ba-2', name: 'Savings' }],
        });
        const res = makeRes();
        await sageController.listBankAccounts(authedReq({ params: { businessId: 'biz-1' } }), res);

        expect(authed.firstCall.args[2]).toEqual(expect.objectContaining({ businessId: 'biz-1', path: '/bank_accounts' }));
        expect(res.json.firstCall.args[0]).toEqual([
            { id: 'ba-1', displayed_as: 'Current account' },
            { id: 'ba-2', displayed_as: 'Savings' },
        ]);
    });

    it('409s with sage_not_connected when the practice has no connection', async () => {
        configureSage();
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(null);
        const res = makeRes();
        await sageController.listBusinesses(authedReq(), res);
        expect(res.status.calledWith(409)).toBe(true);
        expect(res.json.firstCall.args[0].code).toBe('sage_not_connected');
    });

    it('409s with sage_reconnect_required when the connection is dead', async () => {
        configureSage();
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves({ status: 'expired' });
        sinon.stub(sageAuth, 'authedRequest').rejects(new sageAuth.SageReconnectError());
        const res = makeRes();
        await sageController.listBusinesses(authedReq(), res);
        expect(res.status.calledWith(409)).toBe(true);
        expect(res.json.firstCall.args[0].code).toBe('sage_reconnect_required');
    });
});
