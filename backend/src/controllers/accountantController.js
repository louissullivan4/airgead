const jwt = require('jsonwebtoken');
require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');
const expenseModel = require('../models/expenseModel');
const userModel = require('../models/userModel');
const accountantLinkModel = require('../models/accountantLinkModel');
const { isSuperAdmin } = require('../middlewares/tenantScope');
const { sendInviteEmail } = require('./userController');
const { downloadImages, createZipArchive } = require('../middlewares/imageDownload');
const { buildTaxSummary } = require('../services/tax/taxSummaryService');
const seatSync = require('../services/billing/seatSync');
const gf = require('../utils/gf');
const logger = require('../utils/logger');

const jwtSecret = process.env.JWT_SECRET;
const frontendURL = process.env.FRONTEND_URL;
const TAX_YEAR = () => new Date().getFullYear();

// Is the caller the firm admin (org owner) or a platform super_admin? Such
// callers see every client of the firm; member accountants see only their own.
const isFirmAdmin = (req) => isSuperAdmin(req) || (req.user && req.user.orgRole === 'owner');

// Security-critical gate for every accountant → client endpoint. super_admin
// passes; otherwise the caller's firm must hold an *active* link to the target
// client org. A firm admin (owner) may access any firm client; a member
// accountant may access only clients they own (link.created_by === their id).
// A missing/revoked link, or another accountant's client, → 403 (and the data
// layer is never reached). Returns true when allowed; false after sending 403.
const assertClientAccess = async (req, res, clientOrgId) => {
    if (isSuperAdmin(req)) return true;
    const link = await accountantLinkModel.getActiveLink(req.pool, req.user.orgId, clientOrgId);
    if (!link || (req.user.orgRole !== 'owner' && link.created_by !== req.user.userId)) {
        logger.warn('Accountant access denied: org %s user %s to client %s', req.user.orgId, req.user.userId, clientOrgId);
        res.status(403).json({ error: 'Access denied. You do not manage this client.' });
        return false;
    }
    return true;
};

// POST /organisations/:id/invite-client (practice-only; guarded on the route)
// Sends a client invite whose token, on signup, provisions a SEPARATE org for
// the invitee and links it back to this practice.
const inviteClient = async (req, res) => {
    const { email } = req.body;
    const accountantOrgId = req.params.id;

    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    // The practice may only invite on behalf of its own org (super_admin aside).
    if (!isSuperAdmin(req) && accountantOrgId !== req.user.orgId) {
        return res.status(403).json({ error: 'Access denied. You do not have permission to invite for this organisation.' });
    }

    try {
        const existingUser = await userModel.getUserByEmail(req.pool, email);
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists.' });
        }

        const inviteToken = jwt.sign(
            { email, accountant_org_id: accountantOrgId, created_by: req.user.userId, kind: 'client' },
            jwtSecret,
            { expiresIn: '168h' }
        );
        const inviteLink = `${frontendURL}/signup?token=${inviteToken}`;

        await sendInviteEmail(email, inviteLink);

        logger.info('Client invite sent to %s for practice %s', email, accountantOrgId);
        res.status(200).json({ message: 'Client invitation sent successfully.' });
    } catch (error) {
        logger.error('Error sending client invitation: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// GET /accountant/clients - linked client orgs with this-tax-year summary stats.
// Admins/super_admins see all firm clients; member accountants see only theirs.
const listClients = async (req, res) => {
    try {
        const accountantOrgId = isSuperAdmin(req) ? null : req.user.orgId;
        const ownerUserId = isFirmAdmin(req) ? null : req.user.userId;
        const clients = await accountantLinkModel.getClientsWithStats(req.pool, accountantOrgId, TAX_YEAR(), ownerUserId);
        res.status(200).json(clients);
    } catch (error) {
        logger.error('Error listing accountant clients: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// GET /accountant/clients/:clientOrgId/transactions - that client's line items.
// ?year= optionally narrows to a tax year; omitted = all.
const getClientTransactions = async (req, res) => {
    try {
        const { clientOrgId } = req.params;
        if (!(await assertClientAccess(req, res, clientOrgId))) return;

        const { year } = req.query;
        const expenses = year
            ? await expenseModel.getExpensesByOrgIdAndYear(req.pool, clientOrgId, year)
            : await expenseModel.getExpensesByOrgId(req.pool, clientOrgId);
        res.status(200).json(expenses);
    } catch (error) {
        logger.error('Error fetching client transactions: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// Minimal RFC-4180-ish CSV from the expense rows (same columns as the Excel
// export, minus the embedded images). `capitalIds` marks asset-register-linked
// rows so the accountant can see at a glance what is claimed via wear & tear
// rather than as a revenue expense.
const toCsv = (expenses, capitalIds = new Set()) => {
    const headers = ['ID', 'Title', 'Description', 'Category', 'Amount', 'Currency', 'Date', 'Merchant', 'Tax', 'Capital'];
    const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = expenses.map((e) => [
        e.id, e.title, e.description, e.category, e.amount, e.currency,
        e.created_at, e.merchant_name, e.tax_amount,
        capitalIds.has(e.id) ? 'yes' : '',
    ].map(esc).join(','));
    return [headers.join(','), ...rows].join('\n');
};

// GET /accountant/clients/:clientOrgId/export?format=zip|csv&year=
// zip (default): reuses the existing Excel + receipt-image archive path, sourced
// from the client org. csv: the same rows as a flat CSV (no images).
const exportClient = async (req, res) => {
    const { clientOrgId } = req.params;
    const format = (req.query.format || 'zip').toLowerCase();
    const year = req.query.year || TAX_YEAR();

    try {
        if (!(await assertClientAccess(req, res, clientOrgId))) return;

        const expenses = await expenseModel.getExpensesByOrgIdAndYear(req.pool, clientOrgId, year);
        if (expenses.length === 0) {
            return res.status(404).json({ error: 'No transactions found for the given client and year.' });
        }

        // The tax-season pack: Form 11 buckets, capital-allowances schedule and
        // VAT position ride along with the raw rows (extra Excel sheets + a
        // Capital marker column). Never let a summary failure kill the export.
        const summary = await buildTaxSummary(req.pool, clientOrgId, year).catch((err) => {
            logger.error('Tax summary failed during export (continuing without): %s', err.message);
            return null;
        });
        const capitalIds = new Set((summary && summary.capitalExpenseIds) || []);

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="client_${clientOrgId}_${year}.csv"`);
            return res.status(200).send(toCsv(expenses, capitalIds));
        }

        const timestamp = Date.now();
        const tempDir = path.join(__dirname, '..', 'temp', `client_${clientOrgId}_${year}_${timestamp}`);
        const imagesDir = path.join(tempDir, 'images');
        const excelFilePath = path.join(tempDir, `transactions_${year}.xlsx`);
        const zipFilePath = path.join(tempDir, `transactions_${year}.zip`);

        try {
            await fs.ensureDir(imagesDir);
            await downloadImages(expenses, imagesDir);
            await gf.generateExcel(expenses, imagesDir, excelFilePath, summary);
            await createZipArchive([excelFilePath, imagesDir], zipFilePath);

            res.download(zipFilePath, `client_transactions_${year}.zip`, async (err) => {
                if (err) {
                    logger.error('Error sending client export ZIP: %s', err.message);
                }
                await fs.remove(tempDir);
            });
        } catch (error) {
            await fs.remove(tempDir);
            throw error;
        }
    } catch (error) {
        logger.error('Error exporting client data: %s', error.message);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
    }
};

// GET /accountant/clients/:clientOrgId/tax-summary?year= - the client's full
// tax picture (Form 11 buckets, capital allowances, VAT position). Same link
// gate as every other client read.
const getClientTaxSummary = async (req, res) => {
    try {
        const { clientOrgId } = req.params;
        if (!(await assertClientAccess(req, res, clientOrgId))) return;

        const year = parseInt(req.query.year, 10) || TAX_YEAR();
        const summary = await buildTaxSummary(req.pool, clientOrgId, year);
        if (!summary) {
            return res.status(404).json({ error: 'Organisation not found.' });
        }
        res.status(200).json(summary);
    } catch (error) {
        logger.error('Error building client tax summary: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// DELETE /accountant/clients/:clientOrgId/link - revoke access (status='revoked').
// A member accountant may revoke only their own client; the admin any firm client.
const revokeClient = async (req, res) => {
    try {
        const { clientOrgId } = req.params;
        if (!(await assertClientAccess(req, res, clientOrgId))) return;
        const accountantOrgId = isSuperAdmin(req)
            ? (req.body && req.body.accountantOrgId) || req.user.orgId
            : req.user.orgId;
        await accountantLinkModel.revokeLink(req.pool, accountantOrgId, clientOrgId);
        // One fewer active seat - sync the practice's Stripe quantity.
        // Best-effort: never throws, no-ops when Stripe is unconfigured.
        await seatSync.syncPracticeSeats(req.pool, accountantOrgId);
        res.status(200).json({ message: 'Client access revoked.' });
    } catch (error) {
        logger.error('Error revoking client access: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// PATCH /accountant/clients/:clientOrgId/assign - reassign a client to another
// accountant in the firm. Admin-only (requireOrgRole('owner') on the route;
// super_admin bypasses). The target must be a member of the firm org.
const reassignClient = async (req, res) => {
    try {
        const { clientOrgId } = req.params;
        const { accountantUserId } = req.body;
        if (!accountantUserId) {
            return res.status(400).json({ error: 'accountantUserId is required.' });
        }

        const accountantOrgId = isSuperAdmin(req)
            ? (req.body && req.body.accountantOrgId) || req.user.orgId
            : req.user.orgId;

        // The new owner must belong to the firm (super_admin scopes to the
        // resolved firm org too).
        const inFirm = await userModel.isUserInOrg(req.pool, accountantUserId, accountantOrgId);
        if (!inFirm) {
            return res.status(400).json({ error: 'That accountant is not a member of this firm.' });
        }

        const updated = await accountantLinkModel.reassignLink(req.pool, accountantOrgId, clientOrgId, accountantUserId);
        if (!updated) {
            return res.status(404).json({ error: 'No active link to this client.' });
        }
        res.status(200).json({ message: 'Client reassigned.' });
    } catch (error) {
        logger.error('Error reassigning client: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = {
    assertClientAccess,
    inviteClient,
    listClients,
    getClientTransactions,
    getClientTaxSummary,
    exportClient,
    revokeClient,
    reassignClient,
};
