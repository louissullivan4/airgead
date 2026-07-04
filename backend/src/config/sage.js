const tokenCrypto = require('../utils/tokenCrypto');

// Sage Business Cloud Accounting integration config. Same discipline as
// billing: the flag and credentials are read as FUNCTIONS so tests and
// long-lived processes see env changes, and everything is inert by default -
// SAGE_ENABLED unset means the /sage routes 404, credentials unset means they
// answer 502 "not configured".

const SAGE_AUTH_URL = 'https://www.sageone.com/oauth2/auth/central';
const SAGE_TOKEN_URL = 'https://oauth.accounting.sage.com/token';
const SAGE_API_BASE = 'https://api.accounting.sage.com/v3.1';

const isSageEnabled = () => process.env.SAGE_ENABLED === 'true';

const getSageCredentials = () =>
    process.env.SAGE_CLIENT_ID && process.env.SAGE_CLIENT_SECRET
        ? { clientId: process.env.SAGE_CLIENT_ID, clientSecret: process.env.SAGE_CLIENT_SECRET }
        : null;

// The OAuth redirect URI registered with the Sage app. Reuses
// PUBLIC_BACKEND_URL (already required for signed file URLs) because the
// callback must land on the API directly - a browser redirect carries no JWT.
const getRedirectUri = () =>
    `${(process.env.PUBLIC_BACKEND_URL || 'http://localhost:8080').replace(/\/$/, '')}/sage/callback`;

const isSageConfigured = () => Boolean(getSageCredentials()) && tokenCrypto.isConfigured();

// Router-level gate: flag off -> the routes do not exist (404, no info leak).
const requireSageEnabled = (req, res, next) =>
    (isSageEnabled() ? next() : res.status(404).json({ error: 'Not found.' }));

module.exports = {
    SAGE_AUTH_URL,
    SAGE_TOKEN_URL,
    SAGE_API_BASE,
    isSageEnabled,
    isSageConfigured,
    getSageCredentials,
    getRedirectUri,
    requireSageEnabled,
};
