const jwt = require('jsonwebtoken');
require('dotenv').config();
const organisationModel = require('../models/organisationModel');
const userModel = require('../models/userModel');
const { getTemplateFor } = require('../config/categoryTemplates');
const { isSuperAdmin } = require('../middlewares/tenantScope');
const { sendInviteEmail } = require('./userController');
const logger = require('../utils/logger');

const jwtSecret = process.env.JWT_SECRET;
const frontendURL = process.env.FRONTEND_URL;

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
// keep it lenient (slugs/labels are strings, children optional) - the tree is
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

// VAT treatments the tax summary understands (mirrors the DB CHECK from
// migration 009 - validate here so a typo 400s instead of 500ing).
const VAT_STATUSES = ['not_registered', 'registered', 'flat_rate_farmer'];

// Owner-only (enforced by requireOrgRole('owner') on the route) + org-scoped.
const updateOrganisation = async (req, res) => {
    if (!allowOrgAccess(req, res)) return;

    if (req.body.categories !== undefined && !isValidCategoryTree(req.body.categories)) {
        return res.status(400).json({ error: 'Invalid categories: expected { expense: [...], income: [...] }.' });
    }

    if (req.body.vat_status !== undefined && !VAT_STATUSES.includes(req.body.vat_status)) {
        return res.status(400).json({ error: `Invalid vat_status: expected one of ${VAT_STATUSES.join(', ')}.` });
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

// GET /organisations/:id/members - owner-only (enforced on the route) + scoped.
// Lists everyone in the org (members' submissions roll up to the org).
const getMembers = async (req, res) => {
    if (!allowOrgAccess(req, res)) return;
    try {
        const members = await userModel.getUsersByOrgId(req.pool, req.params.id);
        return res.status(200).json(members);
    } catch (error) {
        logger.error('Error fetching organisation members: %s', error.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// POST /organisations/:id/invite-member - owner-only (enforced on the route).
// Sends a MEMBER invite: the invitee joins this org (inviter_id token, handled
// by register's mode='invite'). Distinct from the accountant client invite.
const inviteMember = async (req, res) => {
    if (!allowOrgAccess(req, res)) return;
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    try {
        const existingUser = await userModel.getUserByEmail(req.pool, email);
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists.' });
        }
        const inviteToken = jwt.sign(
            { email, inviter_id: req.user.userId },
            jwtSecret,
            { expiresIn: '168h' }
        );
        const inviteLink = `${frontendURL}/signup?token=${inviteToken}`;
        await sendInviteEmail(email, inviteLink);
        logger.info('Member invite sent to %s for org %s', email, req.params.id);
        return res.status(200).json({ message: 'Invitation email sent successfully.' });
    } catch (error) {
        logger.error('Error inviting member: %s', error.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = {
    getOrganisation,
    getCategories,
    updateOrganisation,
    getMembers,
    inviteMember,
};
