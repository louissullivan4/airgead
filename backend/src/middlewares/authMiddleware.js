const jwt = require('jsonwebtoken');
require('dotenv').config();
const jwtSecret = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) return res.status(403).json({ error: 'Access denied. Invalid bearer token.' });

        // Backward compatibility: tokens issued before Phase 0 carry no orgId.
        // Treat their absence as "needs re-login" (401) — never a 500/403/crash.
        if (!user || !user.orgId) {
            return res.status(401).json({ error: 'Session out of date, please log in again.' });
        }

        req.user = user;
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