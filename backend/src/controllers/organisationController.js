const organisationModel = require('../models/organisationModel');
const { getTemplateFor } = require('../config/categoryTemplates');
const { isSuperAdmin } = require('../middlewares/tenantScope');
const logger = require('../utils/logger');

// Org-scoping: a caller may only touch their own org (the one in their token),
// unless they are a platform super_admin. Returns true when access is allowed;
// otherwise responds 403 and returns false.
const allowOrgAccess = (req, res) => {
    if (isSuperAdmin(req) || req.params.id === req.orgId) {
        return true;
    }
    logger.warn('Cross-org organisation access attempt by %s for org %s', req.user && req.user.userId, req.params.id);
    res.status(403).json({ error: 'Access denied. You do not have permission to access this organisation.' });
    return false;
};

// Shallow structural validation for a category tree posted by the client. We
// keep it lenient (slugs/labels are strings, children optional) — the tree is
// config, not referential data.
const isNodeArray = (arr) =>
    Array.isArray(arr) &&
    arr.every(
        (n) =>
            n &&
            typeof n.slug === 'string' &&
            typeof n.label === 'string' &&
            (n.children === undefined || isNodeArray(n.children)),
    );

const isValidCategoryTree = (tree) =>
    tree && typeof tree === 'object' && isNodeArray(tree.expense) && isNodeArray(tree.income);

const getOrganisation = async (req, res) => {
    if (!allowOrgAccess(req, res)) return;
    try {
        const org = await organisationModel.getOrgById(req.pool, req.params.id);
        if (!org) {
            return res.status(404).json({ error: 'Organisation not found.' });
        }
        return res.status(200).json(org);
    } catch (error) {
        logger.error('Error fetching organisation: %s', error.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// Returns the org's effective category tree (stored custom tree, or the type
// template when none is stored) plus the pristine `defaults` for the org's type
// so the UI can offer "Reset to defaults" in a single round trip.
const getCategories = async (req, res) => {
    if (!allowOrgAccess(req, res)) return;
    try {
        const org = await organisationModel.getOrgById(req.pool, req.params.id);
        if (!org) {
            return res.status(404).json({ error: 'Organisation not found.' });
        }
        const defaults = getTemplateFor(org.org_category);
        const isCustom = Boolean(org.categories);
        return res.status(200).json({
            orgCategory: org.org_category,
            categories: isCustom ? org.categories : defaults,
            isCustom,
            defaults,
        });
    } catch (error) {
        logger.error('Error fetching organisation categories: %s', error.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// Owner-only (enforced by requireOrgRole('owner') on the route) + org-scoped.
const updateOrganisation = async (req, res) => {
    if (!allowOrgAccess(req, res)) return;

    if (req.body.categories !== undefined && !isValidCategoryTree(req.body.categories)) {
        return res.status(400).json({ error: 'Invalid categories: expected { expense: [...], income: [...] }.' });
    }

    try {
        const updated = await organisationModel.updateOrg(req.pool, req.params.id, req.body);
        if (!updated) {
            return res.status(404).json({ error: 'Organisation not found or nothing to update.' });
        }
        return res.status(200).json(updated);
    } catch (error) {
        logger.error('Error updating organisation: %s', error.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = {
    getOrganisation,
    getCategories,
    updateOrganisation,
};
