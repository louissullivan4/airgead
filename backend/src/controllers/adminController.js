const jwt = require('jsonwebtoken');
require('dotenv').config();
const adminModel = require('../models/adminModel');
const userModel = require('../models/userModel');
const organisationModel = require('../models/organisationModel');
const storage = require('../utils/storage');
const userController = require('./userController');
const logger = require('../utils/logger');

const jwtSecret = process.env.JWT_SECRET;
const frontendURL = process.env.FRONTEND_URL;
const TAX_YEAR = () => new Date().getFullYear();

// Normalise a stored image reference to a storage object key (legacy rows may
// hold a full public URL). Mirrors imageDownload.toObjectPath.
const toObjectPath = (stored) => {
    if (typeof stored !== 'string') return null;
    if (/^https?:\/\//.test(stored)) {
        return stored.split('?')[0].replace(/^https?:\/\/storage\.googleapis\.com\/[^/]+\//, '');
    }
    return stored;
};

// Best-effort storage cleanup after a hard delete (never fails the request).
const removeImages = async (paths) => {
    await Promise.all(
        (paths || []).map(async (p) => {
            const key = toObjectPath(p);
            if (!key) return;
            try {
                await storage.deleteObject(key);
            } catch (err) {
                logger.warn('Failed to delete storage object %s: %s', key, err.message);
            }
        })
    );
};

// GET /admin/overview
const getOverview = async (req, res) => {
    try {
        const stats = await adminModel.getPlatformStats(req.pool, TAX_YEAR());
        res.status(200).json(stats);
    } catch (error) {
        logger.error('Error fetching platform overview: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// GET /admin/orgs
const listOrgs = async (req, res) => {
    try {
        res.status(200).json(await adminModel.getAllOrgsWithStats(req.pool, TAX_YEAR()));
    } catch (error) {
        logger.error('Error listing orgs: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// GET /admin/users
const listUsers = async (req, res) => {
    try {
        res.status(200).json(await adminModel.getAllUsersWithOrg(req.pool));
    } catch (error) {
        logger.error('Error listing users: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// POST /admin/invite { email, kind: 'user' | 'accountant' }
// A platform invite: on signup the invitee creates their OWN org (mode='self').
// 'accountant' flags that org as a firm (is_accountant_practice=true).
const invite = async (req, res) => {
    const { email, kind } = req.body;
    if (!email || !['user', 'accountant'].includes(kind)) {
        return res.status(400).json({ error: 'Email and a valid kind (user|accountant) are required.' });
    }
    try {
        const existing = await userModel.getUserByEmail(req.pool, email);
        if (existing) {
            return res.status(400).json({ error: 'User with this email already exists.' });
        }
        const token = jwt.sign(
            { email, kind: 'platform', is_accountant_practice: kind === 'accountant' },
            jwtSecret,
            { expiresIn: '168h' }
        );
        await userController.sendInviteEmail(email, `${frontendURL}/signup?token=${token}`);
        logger.info('Platform invite sent to %s (%s)', email, kind);
        res.status(200).json({ message: 'Invitation sent successfully.' });
    } catch (error) {
        logger.error('Error sending platform invite: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// PATCH /admin/users/:id/platform-role { platformRole }
const setUserPlatformRole = async (req, res) => {
    const { id } = req.params;
    const { platformRole } = req.body;
    if (!['user', 'super_admin'].includes(platformRole)) {
        return res.status(400).json({ error: 'platformRole must be user or super_admin.' });
    }
    if (id === req.user.userId) {
        return res.status(400).json({ error: 'You cannot change your own platform role.' });
    }
    try {
        const updated = await userModel.updateUserById(req.pool, id, { platform_role: platformRole });
        if (!updated) return res.status(404).json({ error: 'User not found.' });
        res.status(200).json({ message: 'Platform role updated.' });
    } catch (error) {
        logger.error('Error setting platform role: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// PATCH /admin/users/:id/status { status: 'active' | 'suspended' }
const setUserStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'status must be active or suspended.' });
    }
    if (id === req.user.userId) {
        return res.status(400).json({ error: 'You cannot change your own status.' });
    }
    try {
        const updated = await userModel.updateUserById(req.pool, id, { account_status: status });
        if (!updated) return res.status(404).json({ error: 'User not found.' });
        res.status(200).json({ message: 'User status updated.' });
    } catch (error) {
        logger.error('Error setting user status: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// PATCH /admin/orgs/:id/status { status }
const setOrgStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'status must be active or suspended.' });
    }
    if (id === req.user.orgId) {
        return res.status(400).json({ error: 'You cannot suspend your own organisation.' });
    }
    try {
        const updated = await organisationModel.updateOrg(req.pool, id, { status });
        if (!updated) return res.status(404).json({ error: 'Organisation not found.' });
        res.status(200).json({ message: 'Organisation status updated.' });
    } catch (error) {
        logger.error('Error setting org status: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// DELETE /admin/users/:id - GDPR erasure of an individual.
// A user who solely owns their org → the whole org is erased; a user owning an
// org that still has other members → 409 (delete the org or transfer first).
const deleteUser = async (req, res) => {
    const { id } = req.params;
    if (id === req.user.userId) {
        return res.status(400).json({ error: 'You cannot delete your own account here.' });
    }
    try {
        const user = await userModel.getUserById(req.pool, id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const ownedRes = await req.pool.query('SELECT id FROM organisations WHERE owner_account_id = $1', [id]);
        let imagePaths;
        if (ownedRes.rows.length) {
            const ownedOrgId = ownedRes.rows[0].id;
            const membersRes = await req.pool.query('SELECT count(*)::int AS n FROM users WHERE org_id = $1', [ownedOrgId]);
            if (membersRes.rows[0].n > 1) {
                return res.status(409).json({
                    error: 'This user owns an organisation with other members. Delete the organisation or reassign ownership first.',
                });
            }
            imagePaths = await adminModel.deleteOrgCascade(req.pool, ownedOrgId);
        } else {
            imagePaths = await adminModel.deleteUserCascade(req.pool, id);
        }
        await removeImages(imagePaths);
        res.status(200).json({ message: 'User permanently deleted.' });
    } catch (error) {
        logger.error('Error deleting user: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// DELETE /admin/orgs/:id - GDPR erasure / account closure of an entire org.
const deleteOrg = async (req, res) => {
    const { id } = req.params;
    if (id === req.user.orgId) {
        return res.status(400).json({ error: 'You cannot delete your own organisation.' });
    }
    try {
        const org = await organisationModel.getOrgById(req.pool, id);
        if (!org) return res.status(404).json({ error: 'Organisation not found.' });
        const imagePaths = await adminModel.deleteOrgCascade(req.pool, id);
        await removeImages(imagePaths);
        res.status(200).json({ message: 'Organisation permanently deleted.' });
    } catch (error) {
        logger.error('Error deleting org: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = {
    getOverview,
    listOrgs,
    listUsers,
    invite,
    setUserPlatformRole,
    setUserStatus,
    setOrgStatus,
    deleteUser,
    deleteOrg,
};
