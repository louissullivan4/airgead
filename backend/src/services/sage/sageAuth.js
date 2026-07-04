const sageClient = require('./sageClient');
const sageModel = require('../../models/sageModel');
const tokenCrypto = require('../../utils/tokenCrypto');
const logger = require('../../utils/logger');

// Token lifecycle for the per-practice Sage connection. The hard constraint:
// Sage ROTATES the refresh token on every use, and using a stale one
// invalidates BOTH tokens. So a refresh must be serialized per connection
// (SELECT ... FOR UPDATE) and the rotated pair persisted before anyone else
// may refresh. Access tokens live ~5 minutes; refresh tokens 31 days.

// Thrown when the connection is missing or its refresh token is dead - the
// controllers map this to 409 { code: 'sage_reconnect_required' }.
class SageReconnectError extends Error {
    constructor(message = 'Sage connection requires re-linking.') {
        super(message);
        this.name = 'SageReconnectError';
    }
}

const EXPIRY_SKEW_MS = 60_000;
const DEFAULT_ACCESS_TTL_S = 300;
const DEFAULT_REFRESH_TTL_S = 31 * 24 * 3600;

const isFresh = (row) =>
    Boolean(row.access_token_expires_at)
    && new Date(row.access_token_expires_at).getTime() - Date.now() > EXPIRY_SKEW_MS;

// Serialized refresh. Holding the row lock across the single token HTTPS call
// is deliberate - the lock IS the serialization that protects the rotating
// refresh token from concurrent double-use.
const refreshLocked = async (pool, orgId) => {
    const client = await pool.connect();
    let inTx = false;
    try {
        await client.query('BEGIN');
        inTx = true;
        const row = await sageModel.lockConnection(client, orgId);
        if (!row || row.status !== 'active') {
            throw new SageReconnectError();
        }
        // A concurrent request may have refreshed while we waited on the lock;
        // its token is the live one - refreshing again would burn it.
        if (isFresh(row)) {
            await client.query('COMMIT');
            inTx = false;
            return tokenCrypto.decrypt(row.access_token_encrypted);
        }

        let refreshed;
        try {
            refreshed = await sageClient.refreshAccessToken(tokenCrypto.decrypt(row.refresh_token_encrypted));
        } catch (error) {
            // invalid_grant: the refresh token is expired or already rotated
            // elsewhere. Mark the connection dead so the UI prompts reconnect.
            if (error && (error.status === 400 || error.status === 401)) {
                await client.query('ROLLBACK');
                inTx = false;
                await sageModel.markConnectionExpired(pool, orgId);
                logger.warn('Sage refresh token rejected - connection marked expired', { orgId });
                throw new SageReconnectError();
            }
            throw error;
        }

        await sageModel.updateConnectionTokens(client, orgId, {
            accessTokenEncrypted: tokenCrypto.encrypt(refreshed.accessToken),
            refreshTokenEncrypted: tokenCrypto.encrypt(refreshed.refreshToken),
            accessTokenExpiresAt: new Date(Date.now() + (refreshed.expiresIn || DEFAULT_ACCESS_TTL_S) * 1000),
            refreshTokenExpiresAt: new Date(Date.now() + (refreshed.refreshTokenExpiresIn || DEFAULT_REFRESH_TTL_S) * 1000),
        });
        await client.query('COMMIT');
        inTx = false;
        return refreshed.accessToken;
    } catch (error) {
        if (inTx) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
};

// Returns a usable access token for the practice org, refreshing (and
// persisting the rotated pair) only when needed. The fresh-token hot path
// never takes a lock.
const getValidAccessToken = async (pool, orgId, { forceRefresh = false } = {}) => {
    const row = await sageModel.getConnectionByOrgId(pool, orgId);
    if (!row || row.status !== 'active') {
        throw new SageReconnectError();
    }
    if (!forceRefresh && isFresh(row)) {
        return tokenCrypto.decrypt(row.access_token_encrypted);
    }
    return refreshLocked(pool, orgId);
};

// apiRequest with automatic token handling: on 401 (revoked / clock-skewed
// token) force ONE refresh and retry once; a second 401 means the connection
// itself is dead.
const authedRequest = async (pool, orgId, options) => {
    const accessToken = await getValidAccessToken(pool, orgId);
    try {
        return await sageClient.apiRequest({ accessToken, ...options });
    } catch (error) {
        if (!error || error.status !== 401) throw error;
        const retryToken = await getValidAccessToken(pool, orgId, { forceRefresh: true });
        try {
            return await sageClient.apiRequest({ accessToken: retryToken, ...options });
        } catch (retryError) {
            if (retryError && retryError.status === 401) {
                await sageModel.markConnectionExpired(pool, orgId);
                throw new SageReconnectError('Sage rejected a freshly refreshed token.');
            }
            throw retryError;
        }
    }
};

module.exports = { getValidAccessToken, authedRequest, SageReconnectError, EXPIRY_SKEW_MS };
