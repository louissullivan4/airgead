const { SAGE_AUTH_URL, SAGE_TOKEN_URL, SAGE_API_BASE, getSageCredentials, getRedirectUri } = require('../../config/sage');

// The ONLY module that talks to Sage over the network - same seam discipline
// as billing/stripeClient.js. Everything else (sageAuth, sageExportService,
// sageController) calls through this module object so tests can
// `sinon.stub(sageClient, 'apiRequest')` and never touch the wire.

// Lazy require (stripeClient precedent): an unconfigured server never loads it.
let axios = null;
const getAxios = () => {
    if (!axios) axios = require('axios');
    return axios;
};

class SageApiError extends Error {
    constructor(message, status, sageBody) {
        super(message);
        this.name = 'SageApiError';
        this.status = status;
        this.sageBody = sageBody;
    }
}

// Normalize axios failures: HTTP responses become SageApiError (with .status
// for the 401-retry and invalid_grant paths); network errors pass through.
const toSageError = (error) => {
    if (error && error.response) {
        const body = error.response.data;
        const detail = body && (body.$message || body.message || (Array.isArray(body) && body[0] && body[0].$message));
        return new SageApiError(
            `Sage request failed (${error.response.status})${detail ? `: ${detail}` : ''}`,
            error.response.status,
            body
        );
    }
    return error;
};

const buildAuthorizeUrl = (state) => {
    const creds = getSageCredentials();
    if (!creds) throw new Error('Sage credentials are not configured.');
    const params = new URLSearchParams({
        filter: 'apiv3.1',
        response_type: 'code',
        client_id: creds.clientId,
        redirect_uri: getRedirectUri(),
        scope: 'full_access',
        state,
    });
    return `${SAGE_AUTH_URL}?${params.toString()}`;
};

// Both token calls return the same normalized shape. Sage rotates the refresh
// token on EVERY grant - callers must persist the returned pair immediately.
const parseTokenResponse = (data) => ({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    refreshTokenExpiresIn: data.refresh_token_expires_in,
});

const postTokenRequest = async (form) => {
    const creds = getSageCredentials();
    if (!creds) throw new Error('Sage credentials are not configured.');
    try {
        const response = await getAxios().post(
            SAGE_TOKEN_URL,
            new URLSearchParams({
                client_id: creds.clientId,
                client_secret: creds.clientSecret,
                ...form,
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return parseTokenResponse(response.data);
    } catch (error) {
        throw toSageError(error);
    }
};

const exchangeCodeForTokens = (code) =>
    postTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: getRedirectUri() });

const refreshAccessToken = (refreshToken) =>
    postTokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

// Generic authenticated API call. `businessId` becomes the X-Business header
// Sage uses to route multi-business accounts (omitted for /businesses itself).
const apiRequest = async ({ accessToken, businessId, method = 'get', path, params, data }) => {
    try {
        const response = await getAxios()({
            method,
            url: `${SAGE_API_BASE}${path}`,
            params,
            data,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(businessId ? { 'X-Business': businessId } : {}),
            },
        });
        return response.data;
    } catch (error) {
        throw toSageError(error);
    }
};

module.exports = { buildAuthorizeUrl, exchangeCodeForTokens, refreshAccessToken, apiRequest, SageApiError };
