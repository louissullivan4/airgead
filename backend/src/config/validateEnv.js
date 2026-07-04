const logger = require('../utils/logger');

// Boot-time environment validation (Phase 6). Pure function so it is
// unit-testable: returns { fatal: [], warnings: [] }; server.js decides to
// exit. In production a missing secret is FATAL - better a refused deploy
// than tokens signed with 'change-me-in-production'. Everywhere else the same
// problems only warn, so dev and tests keep working out of the box.

const MIN_JWT_SECRET_LENGTH = 32;

const validateEnv = (env = process.env) => {
    const production = env.NODE_ENV === 'production';
    const fatal = [];
    const warnings = [];
    const problem = (message) => (production ? fatal : warnings).push(message);

    if (!env.JWT_SECRET) {
        problem('JWT_SECRET is not set - tokens cannot be issued safely.');
    } else if (env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
        problem(`JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters - use a long random value.`);
    }
    if (!env.DB_URL && !env.PGHOST) {
        problem('DB_URL is not set - no database to connect to.');
    }
    if (!env.FRONTEND_URL) {
        problem('FRONTEND_URL is not set - email links and Stripe redirects will be broken.');
    }

    // Degraded-but-runnable integrations warn everywhere, never block boot.
    if (!env.EMAIL_USERNAME || !env.EMAIL_PASSWORD) {
        warnings.push('Email credentials (EMAIL_USERNAME/EMAIL_PASSWORD) are not set - invites, password resets and verification emails will fail.');
    }
    if (env.BILLING_ENFORCED === 'true' && !env.STRIPE_SECRET_KEY) {
        warnings.push('BILLING_ENFORCED is true but STRIPE_SECRET_KEY is not set - expired orgs will have no way to pay.');
    }
    if (env.SAGE_ENABLED === 'true') {
        if (!env.SAGE_CLIENT_ID || !env.SAGE_CLIENT_SECRET) {
            warnings.push('SAGE_ENABLED is true but SAGE_CLIENT_ID/SAGE_CLIENT_SECRET are not set - Sage routes will answer 502.');
        }
        // Unlike missing client creds (502 keeps the app safe), a missing or
        // malformed encryption key would only surface at the first token write.
        if (!env.TOKEN_ENCRYPTION_KEY) {
            problem('SAGE_ENABLED is true but TOKEN_ENCRYPTION_KEY is not set - Sage tokens cannot be stored securely.');
        } else if (!/^[0-9a-fA-F]{64}$/.test(env.TOKEN_ENCRYPTION_KEY)) {
            problem('TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) - generate with: openssl rand -hex 32');
        }
    }
    if (production && !env.CORS_ORIGINS) {
        warnings.push('CORS_ORIGINS is not set - the API will accept cross-origin requests from anywhere.');
    }

    return { fatal, warnings };
};

// Convenience wrapper for server boot: log everything, exit on fatal.
const validateEnvOrExit = () => {
    const { fatal, warnings } = validateEnv();
    warnings.forEach((w) => logger.warn('Env check: %s', w));
    if (fatal.length > 0) {
        fatal.forEach((f) => logger.error('Env check FAILED: %s', f));
        logger.error('Refusing to start with an unsafe production configuration.');
        process.exit(1);
    }
};

module.exports = { validateEnv, validateEnvOrExit, MIN_JWT_SECRET_LENGTH };
