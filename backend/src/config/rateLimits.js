const rateLimit = require('express-rate-limit');

// Rate limiting (Phase 6 hardening). Two tiers:
//   - global: generous per-IP ceiling across the whole API (abuse backstop,
//     not a throttle - normal interactive use never gets near it).
//   - strict: credential endpoints (login / register / password reset /
//     resend-verification) where 10 attempts per window is already a lot.
//
// Built as factories so tests can construct fresh instances (each limiter
// carries its own hit-counter state); src/index.js skips mounting them
// entirely when NODE_ENV === 'test' so the mocked suites stay deterministic.

const WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_LIMIT = 300;
const STRICT_LIMIT = 10;
const HEALTH_WINDOW_MS = 60 * 1000;
const HEALTH_LIMIT = 60;

const buildGlobalLimiter = (overrides = {}) =>
    rateLimit({
        windowMs: WINDOW_MS,
        limit: GLOBAL_LIMIT,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: 'Too many requests - please slow down.' },
        ...overrides,
    });

const buildStrictLimiter = (overrides = {}) =>
    rateLimit({
        windowMs: WINDOW_MS,
        limit: STRICT_LIMIT,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        // Count everything: failed AND successful attempts both consume budget
        // on credential endpoints.
        message: { error: 'Too many attempts - please wait 15 minutes and try again.' },
        ...overrides,
    });

// Health probes must effectively never be throttled, but the endpoint still
// does a DB round-trip, so it gets its own per-IP ceiling far above any real
// probe cadence (probes fire every few seconds; this allows one per second).
// Unlike the other limiters this one is mounted directly on the route, so it
// self-skips under test to keep the mocked suites deterministic.
const buildHealthLimiter = (overrides = {}) =>
    rateLimit({
        windowMs: HEALTH_WINDOW_MS,
        limit: HEALTH_LIMIT,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: () => process.env.NODE_ENV === 'test',
        message: { error: 'Too many requests - please slow down.' },
        ...overrides,
    });

module.exports = { buildGlobalLimiter, buildStrictLimiter, buildHealthLimiter, WINDOW_MS, GLOBAL_LIMIT, STRICT_LIMIT, HEALTH_WINDOW_MS, HEALTH_LIMIT };
