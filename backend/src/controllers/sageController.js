const jwt = require('jsonwebtoken');
require('dotenv').config();
const { isSageConfigured } = require('../config/sage');
const sageClient = require('../services/sage/sageClient');
const sageAuth = require('../services/sage/sageAuth');
const sageExportService = require('../services/sage/sageExportService');
const sageModel = require('../models/sageModel');
const tokenCrypto = require('../utils/tokenCrypto');
const organisationModel = require('../models/organisationModel');
const { assertClientAccess } = require('./accountantController');
const logger = require('../utils/logger');

const jwtSecret = process.env.JWT_SECRET;
const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const TAX_YEAR = () => new Date().getFullYear();

const notConfigured = (res) => res.status(502).json({ error: 'Sage is not configured on this server.' });
const notConnected = (res) => res.status(409).json({ error: 'Sage is not connected. Link your Sage account in Settings.', code: 'sage_not_connected' });
const reconnectRequired = (res) => res.status(409).json({ error: 'Your Sage connection has expired - reconnect in Settings.', code: 'sage_reconnect_required' });

// POST /sage/connect (owner + practice, route-guarded). Returns the Sage
// consent URL; the frontend leaves via window.location.href (checkout
// precedent). The signed `state` is both the CSRF check and - because the
// callback redirect carries no app JWT - the identity that survives the round
// trip through Sage.
const connect = async (req, res) => {
    if (!isSageConfigured()) return notConfigured(res);
    try {
        const state = jwt.sign(
            { userId: req.user.userId, orgId: req.user.orgId, purpose: 'sage_oauth' },
            jwtSecret,
            { expiresIn: '10m' }
        );
        return res.status(200).json({ url: sageClient.buildAuthorizeUrl(state) });
    } catch (error) {
        logger.error('Error starting sage connect', { orgId: req.user && req.user.orgId, error: error.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// GET /sage/callback?code=&state= - UNAUTHENTICATED (the browser arrives here
// straight from Sage). Everything hangs off the signed state; a bad state
// means no token exchange is even attempted. Always redirects back to
// Settings - a user mid-OAuth should never see raw JSON.
const callback = async (req, res) => {
    const settingsUrl = `${frontendUrl()}/settings`;
    const fail = (reason) => res.redirect(`${settingsUrl}?sage=error&reason=${reason}`);

    if (!isSageConfigured()) return fail('unconfigured');
    if (req.query.error) {
        logger.warn('Sage consent denied: %s', req.query.error);
        return fail('denied');
    }

    let payload;
    try {
        payload = jwt.verify(req.query.state, jwtSecret);
        if (payload.purpose !== 'sage_oauth') throw new Error('wrong token purpose');
    } catch (error) {
        logger.warn('Sage callback with invalid state: %s', error.message);
        return fail('state');
    }

    try {
        const tokens = await sageClient.exchangeCodeForTokens(req.query.code);
        await sageModel.upsertConnection(req.pool, {
            orgId: payload.orgId,
            connectedBy: payload.userId,
            accessTokenEncrypted: tokenCrypto.encrypt(tokens.accessToken),
            refreshTokenEncrypted: tokenCrypto.encrypt(tokens.refreshToken),
            accessTokenExpiresAt: new Date(Date.now() + (tokens.expiresIn || 300) * 1000),
            refreshTokenExpiresAt: new Date(Date.now() + (tokens.refreshTokenExpiresIn || 31 * 24 * 3600) * 1000),
        });
        logger.info('Sage connected', { orgId: payload.orgId });
        return res.redirect(`${settingsUrl}?sage=connected`);
    } catch (error) {
        logger.error('Sage token exchange failed', { orgId: payload.orgId, error: error.message });
        return fail('exchange');
    }
};

// GET /sage/status (any authed org member) - drives the Settings card. Never
// returns token material.
const status = async (req, res) => {
    try {
        const [org, connection] = await Promise.all([
            organisationModel.getOrgById(req.pool, req.user.orgId),
            sageModel.getConnectionByOrgId(req.pool, req.user.orgId),
        ]);
        return res.status(200).json({
            enabled: true,
            configured: isSageConfigured(),
            connected: Boolean(connection),
            connectionStatus: connection ? connection.status : null,
            connectedAt: connection ? connection.created_at : null,
            isPractice: Boolean(org && org.is_accountant_practice),
        });
    } catch (error) {
        logger.error('Error fetching sage status', { orgId: req.user && req.user.orgId, error: error.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// DELETE /sage/connection (owner + practice). Local delete only - Sage has no
// public revocation endpoint; the user can revoke the app inside Sage.
const disconnect = async (req, res) => {
    try {
        await sageModel.deleteConnection(req.pool, req.user.orgId);
        return res.status(200).json({ message: 'Sage disconnected.' });
    } catch (error) {
        logger.error('Error disconnecting sage', { orgId: req.user && req.user.orgId, error: error.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// Shared shape for the live Sage lookups the export dialog needs. Sage lists
// wrap results in $items; we forward only what the dropdowns render.
const mapItems = (data) =>
    ((data && data.$items) || []).map((item) => ({ id: item.id, displayed_as: item.displayed_as || item.name }));

const lookup = (path, { paged = false } = {}) => async (req, res) => {
    if (!isSageConfigured()) return notConfigured(res);
    try {
        const connection = await sageModel.getConnectionByOrgId(req.pool, req.user.orgId);
        if (!connection) return notConnected(res);
        const data = await sageAuth.authedRequest(req.pool, req.user.orgId, {
            businessId: req.params.businessId,
            path,
            ...(paged ? { params: { items_per_page: 200 } } : {}),
        });
        return res.status(200).json(mapItems(data));
    } catch (error) {
        if (error instanceof sageAuth.SageReconnectError) return reconnectRequired(res);
        logger.error('Sage lookup failed', { path, orgId: req.user && req.user.orgId, error: error.message });
        return res.status(502).json({ error: 'Could not reach Sage. Please try again.' });
    }
};

const listBusinesses = lookup('/businesses');
const listBankAccounts = lookup('/bank_accounts');
const listLedgerAccounts = lookup('/ledger_accounts', { paged: true });
const listTaxRates = lookup('/tax_rates');

// GET /accountant/clients/:clientOrgId/sage-settings - remembered mapping (or
// null) + whether the practice is connected, in one call for dialog prefill.
const getClientSageSettings = async (req, res) => {
    try {
        const { clientOrgId } = req.params;
        if (!(await assertClientAccess(req, res, clientOrgId))) return;
        const [settings, connection] = await Promise.all([
            sageModel.getExportSettings(req.pool, req.user.orgId, clientOrgId),
            sageModel.getConnectionByOrgId(req.pool, req.user.orgId),
        ]);
        res.status(200).json({
            settings,
            connected: Boolean(connection && connection.status === 'active'),
        });
    } catch (error) {
        logger.error('Error fetching client sage settings', { error: error.message });
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// POST /accountant/clients/:clientOrgId/sage-export - the export itself.
// Same access gate as the zip/csv export; the connection and settings always
// belong to the CALLER's practice org.
const exportClientToSage = async (req, res) => {
    if (!isSageConfigured()) return notConfigured(res);
    try {
        const { clientOrgId } = req.params;
        if (!(await assertClientAccess(req, res, clientOrgId))) return;

        const { year, businessId, businessName, bankAccountId, bankAccountName,
            expenseLedgerAccountId, expenseLedgerAccountName,
            incomeLedgerAccountId, incomeLedgerAccountName, taxRateId } = req.body || {};
        if (!businessId || !bankAccountId || !expenseLedgerAccountId || !incomeLedgerAccountId) {
            return res.status(400).json({ error: 'businessId, bankAccountId, expenseLedgerAccountId and incomeLedgerAccountId are required.' });
        }

        const connection = await sageModel.getConnectionByOrgId(req.pool, req.user.orgId);
        if (!connection) return notConnected(res);

        // Remember the choices first, so even a failed run prefills next time.
        const settings = await sageModel.upsertExportSettings(req.pool, {
            accountantOrgId: req.user.orgId,
            clientOrgId,
            sageBusinessId: businessId,
            sageBusinessName: businessName || null,
            bankAccountId,
            bankAccountName: bankAccountName || null,
            expenseLedgerAccountId,
            expenseLedgerAccountName: expenseLedgerAccountName || null,
            incomeLedgerAccountId,
            incomeLedgerAccountName: incomeLedgerAccountName || null,
            taxRateId: taxRateId || null,
            updatedBy: req.user.userId,
        });

        const summary = await sageExportService.exportToSage(req.pool, {
            accountantOrgId: req.user.orgId,
            clientOrgId,
            userId: req.user.userId,
            year: parseInt(year, 10) || TAX_YEAR(),
            settings,
        });
        return res.status(200).json(summary);
    } catch (error) {
        if (error instanceof sageAuth.SageReconnectError) return reconnectRequired(res);
        if (error instanceof sageExportService.SageExportTooLargeError) {
            return res.status(422).json({ error: error.message });
        }
        logger.error('Error exporting client to sage', { error: error.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = {
    connect,
    callback,
    status,
    disconnect,
    listBusinesses,
    listBankAccounts,
    listLedgerAccounts,
    listTaxRates,
    getClientSageSettings,
    exportClientToSage,
};
