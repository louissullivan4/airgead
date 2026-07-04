const jwt = require('jsonwebtoken');
require('dotenv').config();
const userModel = require('../models/userModel');
const logger = require('../utils/logger');
const jwtSecret = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, jwtSecret, async (err, user) => {
        if (err) return res.status(403).json({ error: 'Access denied. Invalid bearer token.' });

        // Backward compatibility: tokens issued before Phase 0 carry no orgId.
        // Treat their absence as "needs re-login" (401) - never a 500/403/crash.
        if (!user || !user.orgId) {
            return res.status(401).json({ error: 'Session out of date, please log in again.' });
        }

        req.user = user;

        // Suspension used to be enforced at login only, so a suspended user's
        // existing token kept working for up to 7 days. Check per request
        // (one indexed query). Skipped when no pool is wired (bare unit tests).
        if (!req.pool) return next();
        try {
            const status = await userModel.getAccountStatuses(req.pool, user.userId);
            if (!status) {
                // The account no longer exists (e.g. GDPR delete) - the token
                // must die with it.
                return res.status(401).json({ error: 'Session out of date, please log in again.' });
            }
            if (status.account_status === 'suspended') {
                return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
            }
            if (status.org_status === 'suspended') {
                return res.status(403).json({ error: 'This organisation has been suspended. Please contact support.' });
            }
        } catch (dbError) {
            // Fail open: a DB blip here must not lock every user out - the
            // request will fail downstream anyway if the DB is really gone.
            logger.warn('Suspension check skipped: %s', dbError.message);
        }
        next();
    });
};

const authoriseRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied. You do not have the required role.' });
        }
        next();
    };
};

module.exports = {
    authenticateToken,
    authoriseRole
};