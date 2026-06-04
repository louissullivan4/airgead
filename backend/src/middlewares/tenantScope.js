const logger = require('../utils/logger');

// Attaches the caller's organisation id to the request for downstream handlers.
// authenticateToken already guarantees req.user.orgId exists (else 401), but we
// stay defensive in case this is mounted without it.
const scopeToOrg = (req, res, next) => {
    const orgId = req.user && req.user.orgId;
    if (!orgId) {
        return res.status(401).json({ error: 'Session out of date, please log in again.' });
    }
    req.orgId = orgId;
    next();
};

const isSuperAdmin = (req) => req.user && req.user.platformRole === 'super_admin';

// Platform-level authorisation (replaces the overloaded authoriseRole for
// platform concerns). super_admin is the only elevated platform role today.
const requirePlatformRole = (role) => (req, res, next) => {
    if (!req.user || req.user.platformRole !== role) {
        logger.warn('Platform role check failed: required %s, had %s', role, req.user && req.user.platformRole);
        return res.status(403).json({ error: 'Access denied. You do not have the required role.' });
    }
    next();
};

// Org-level authorisation. super_admin bypasses org-role checks entirely.
const requireOrgRole = (role) => (req, res, next) => {
    if (isSuperAdmin(req)) return next();
    if (!req.user || req.user.orgRole !== role) {
        logger.warn('Org role check failed: required %s, had %s', role, req.user && req.user.orgRole);
        return res.status(403).json({ error: 'Access denied. You do not have the required role.' });
    }
    next();
};

module.exports = {
    scopeToOrg,
    requirePlatformRole,
    requireOrgRole,
    isSuperAdmin,
};
