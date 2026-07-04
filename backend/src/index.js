const express = require('express');
const userRoutes = require('./routes/userRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const receiptRoutes = require('./routes/receiptRoutes');
const organisationRoutes = require('./routes/organisationRoutes');
const accountantRoutes = require('./routes/accountantRoutes');
const adminRoutes = require('./routes/adminRoutes');
const fileRoutes = require('./routes/fileRoutes');
const assetRoutes = require('./routes/assetRoutes');
const reportRoutes = require('./routes/reportRoutes');
const billingRoutes = require('./routes/billingRoutes');
const sageRoutes = require('./routes/sageRoutes');
const billingController = require('./controllers/billingController');
const healthController = require('./controllers/healthController');
const injectPool = require('./middlewares/poolMiddleware');
const { buildGlobalLimiter, buildStrictLimiter, buildHealthLimiter } = require('./config/rateLimits');
const path = require('path');
const logger = require('./utils/logger');
const pool = require('./utils/db');
const { BRAND } = require('./config/brand');
const { requestContext } = require('./middlewares/requestContext');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
require('dotenv').config();

// Sentry (Phase 6 ops): completely inert without SENTRY_DSN - the module is
// not even required. Error capture only; no tracing.
const Sentry = process.env.SENTRY_DSN ? require('@sentry/node') : null;
if (Sentry) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
    });
}

const app = express();

// Behind a proxy/load balancer (Cloud Run, Railway…) the client IP arrives in
// X-Forwarded-For - trust the first hop so rate limiting keys on real IPs.
app.set('trust proxy', 1);

// First middleware: request ids - everything after this (including error
// logs) carries the id, and the response echoes it as x-request-id.
app.use(requestContext);

app.use(helmet());

// Stripe webhook FIRST, with the raw body - signature verification needs the
// exact bytes, so this must be mounted before any JSON body parser. All other
// /billing routes live in billingRoutes below. No auth: the signature is the
// auth.
app.post(
    '/billing/webhook',
    express.raw({ type: 'application/json' }),
    injectPool,
    billingController.handleWebhook
);

// Health probe: unauthenticated and ABOVE the global limiter - probes fire
// constantly and must never compete with API traffic for rate-limit budget.
// It still hits the DB, so it carries its own (very generous) limiter.
app.get('/health', buildHealthLimiter(), injectPool, healthController.health);

// Rate limits (skipped under test so the mocked suites stay deterministic):
// a generous global ceiling, plus a strict budget on credential endpoints.
if (process.env.NODE_ENV !== 'test') {
    app.use(buildGlobalLimiter());
    const strict = buildStrictLimiter();
    app.use('/users/login', strict);
    app.use('/users/register', strict);
    app.use('/users/request-password-reset', strict);
    app.use('/users/resend-verification', strict);
}

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// CORS: with CORS_ORIGINS set (comma-separated, e.g. the frontend origin) only
// those origins may call the API from a browser; unset keeps the historical
// permissive behaviour for local dev. Production should always set it.
const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : {}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res, next) => {
    req.pool = pool;
    next();
});

app.get('/', (req, res) => {
    res.send(`Hello, welcome to ${BRAND}!`);
    logger.info('Root endpoint was accessed');
});

app.use('/users', userRoutes);
app.use('/expenses', expenseRoutes);
app.use('/receipts', receiptRoutes);
app.use('/organisations', organisationRoutes);
app.use('/accountant', accountantRoutes);
app.use('/admin', adminRoutes);
app.use('/files', fileRoutes);
app.use('/assets', assetRoutes);
app.use('/reports', reportRoutes);
app.use('/billing', billingRoutes);
// Feature-flagged: everything under /sage 404s unless SAGE_ENABLED=true.
app.use('/sage', sageRoutes);

// Sentry's error handler sees exceptions first (captures + re-throws to ours).
if (Sentry) {
    Sentry.setupExpressErrorHandler(app);
}

app.use((err, req, res, _next) => {
    logger.error('Unhandled error: ', err);
    res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
