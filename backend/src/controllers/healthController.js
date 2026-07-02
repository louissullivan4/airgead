const logger = require('../utils/logger');

// GET /health - load balancer / uptime probe. 200 when the database answers,
// 503 when it doesn't. Deliberately unauthenticated and mounted before the
// rate limiters (probes fire constantly and must never be throttled away).
const health = async (req, res) => {
    try {
        await req.pool.query('SELECT 1');
        return res.status(200).json({ status: 'ok' });
    } catch (error) {
        logger.error('Health check failed: %s', error.message);
        return res.status(503).json({ status: 'degraded', error: 'database unreachable' });
    }
};

module.exports = { health };
