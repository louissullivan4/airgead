const { buildTaxSummary } = require('../services/tax/taxSummaryService');
const logger = require('../utils/logger');

const parseYear = (value) => {
    const year = parseInt(value, 10);
    return Number.isInteger(year) && year > 1900 ? year : new Date().getFullYear();
};

// GET /reports/tax-summary?year= — the caller's own org, always (the org id
// comes from the token, never the request; the accountant's cross-org view
// lives on /accountant/clients/:id/tax-summary behind assertClientAccess).
const getTaxSummary = async (req, res) => {
    try {
        const year = parseYear(req.query.year);
        const summary = await buildTaxSummary(req.pool, req.user.orgId, year);
        if (!summary) {
            return res.status(404).json({ error: 'Organisation not found.' });
        }
        res.status(200).json(summary);
    } catch (error) {
        logger.error('Error building tax summary: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = { getTaxSummary };
