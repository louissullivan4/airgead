const jwt = require('jsonwebtoken');
require('dotenv').config();
const adminModel = require('../models/adminModel');
const userModel = require('../models/userModel');
const organisationModel = require('../models/organisationModel');
const storage = require('../utils/storage');
const userController = require('./userController');
const { sendEmail } = require('../utils/email');
const { BRAND } = require('../config/brand');
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

// GET /admin/practice-applications - accountancy practices awaiting review.
const listPracticeApplications = async (req, res) => {
    try {
        res.status(200).json(await adminModel.getPracticeApplications(req.pool));
    } catch (error) {
        logger.error('Error listing practice applications: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// Tell a practice owner the outcome of their application (best-effort).
const sendPracticeDecisionEmail = async (email, practiceName, approved) => {
    const name = (practiceName && String(practiceName).trim()) || 'your practice';
    if (approved) {
        await sendEmail({
            to: email,
            subject: `${name} is approved on ${BRAND}`,
            heading: "You're approved",
            paragraphs: [
                `Good news - ${name} has been approved on ${BRAND}.`,
                'Your practice account is free. You can now invite clients from the Clients workspace and manage their books. Each client gets a 14-day free trial and then subscribes directly.',
            ],
            cta: { label: 'Go to your practice', url: `${frontendURL}/clients` },
            footerNote: `You received this because you applied for a ${BRAND} practice account.`,
            text: `${name} has been approved on ${BRAND}. Your practice account is free - invite clients from the Clients workspace: ${frontendURL}/clients`,
        });
    } else {
        await sendEmail({
            to: email,
            subject: `Update on your ${BRAND} practice application`,
            heading: 'Practice application update',
            paragraphs: [
                `Thanks for your interest in ${BRAND}.`,
                `We're not able to approve ${name} as a practice account at this time. If you think this is a mistake, reply to this email and we'll take another look.`,
            ],
            footerNote: `You received this because you applied for a ${BRAND} practice account.`,
            text: `We're not able to approve ${name} as a ${BRAND} practice account at this time. Reply to this email if you think this is a mistake.`,
        });
    }
};

// PATCH /admin/orgs/:id/practice-approval { decision: 'approved' | 'rejected' }
// Approve unlocks free practice powers (invites + always-active entitlement);
// reject records the decision. Either way the applicant is emailed the outcome.
const setPracticeApproval = async (req, res) => {
    const { id } = req.params;
    const { decision } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
        return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
    }
    try {
        const org = await organisationModel.getOrgById(req.pool, id);
        if (!org) return res.status(404).json({ error: 'Organisation not found.' });

        const updated = await organisationModel.setPracticeApproval(req.pool, id, {
            approved: decision === 'approved',
            approverId: req.user.userId,
        });

        try {
            const owner = org.owner_account_id ? await userModel.getUserById(req.pool, org.owner_account_id) : null;
            if (owner && owner.email) {
                await sendPracticeDecisionEmail(owner.email, org.name, decision === 'approved');
            }
        } catch (mailError) {
            logger.warn('Practice decision email failed for org %s: %s', id, mailError.message);
        }

        logger.info('Practice %s %s by %s', id, decision, req.user.userId);
        res.status(200).json({
            message: `Practice ${decision}.`,
            org: {
                id: updated.id,
                practice_status: updated.practice_status,
                is_accountant_practice: updated.is_accountant_practice,
            },
        });
    } catch (error) {
        logger.error('Error setting practice approval: %s', error.message);
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
    listPracticeApplications,
    listUsers,
    invite,
    setUserPlatformRole,
    setUserStatus,
    setOrgStatus,
    setPracticeApproval,
    deleteUser,
    deleteOrg,
};
