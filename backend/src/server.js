require('dotenv').config();
const { validateEnvOrExit } = require('./config/validateEnv');

// Fail fast on an unsafe production configuration BEFORE loading the app
// (missing JWT_SECRET etc. must refuse to boot, not limp along).
validateEnvOrExit();

const app = require('./index');
const logger = require('./utils/logger');
const pool = require('./utils/db');
const { startReminderCron } = require('./services/billing/reminderJob');

const port = process.env.PORT || 3000;

const server = app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
});

// Daily trial/payment reminder sweep. Lives here (not in ./index) so importing
// the app in tests never spins a timer; the sweep itself no-ops until billing
// is enforced.
startReminderCron(pool);

// Graceful shutdown (Phase 6 ops): stop accepting connections, let in-flight
// requests finish, close the pool - with a 10s hard deadline so a wedged
// connection can't stall a deploy.
const SHUTDOWN_DEADLINE_MS = 10_000;
let shuttingDown = false;
const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received - draining connections`);

    const force = setTimeout(() => {
        logger.error('Drain deadline (%dms) passed - forcing exit', SHUTDOWN_DEADLINE_MS);
        process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    force.unref();

    server.close(() => {
        pool.end()
            .catch((err) => logger.error('Error closing pool: %s', err.message))
            .finally(() => {
                logger.info('Shutdown complete');
                process.exit(0);
            });
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Visibility hooks: log (and, when configured, let Sentry capture) instead of
// dying silently. An uncaught exception still exits - state is unknown.
// (Messages are embedded, not %s args - this winston config has no splat.)
process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception - exiting: ${err.stack || err.message}`);
    process.exit(1);
});
