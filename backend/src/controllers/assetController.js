const assetModel = require('../models/assetModel');
const { scheduleForYear } = require('../services/tax/wearAndTear');
const { isSuperAdmin } = require('../middlewares/tenantScope');
const logger = require('../utils/logger');

// Phase 5 asset register. All endpoints operate on the CALLER's org (the org is
// the business entity; members' purchases roll up) — cross-org reads live on
// the /accountant surface via the tax summary. Mutations are org-scoped through
// the model's orgPredicate; super_admin bypasses (null orgId), matching the
// expense/receipt convention.
const scopeOrgIdFor = (req) => (isSuperAdmin(req) ? null : req.user.orgId);

const ASSET_TYPES = ['plant_machinery', 'motor_vehicle'];

const parseYear = (value) => {
    const year = parseInt(value, 10);
    return Number.isInteger(year) && year > 1900 ? year : new Date().getFullYear();
};

// GET /assets?year= — the register plus the computed wear & tear schedule for
// the (tax) year. Allowances are derived on demand, never stored.
const listAssets = async (req, res) => {
    try {
        const year = parseYear(req.query.year);
        const assets = await assetModel.getAssetsByOrgId(req.pool, req.user.orgId);
        res.status(200).json({ year, assets, schedule: scheduleForYear(assets, year) });
    } catch (error) {
        logger.error('Error listing assets: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// POST /assets — a standalone register entry (opening balance / pre-app
// purchase; no linked expense). Capital items captured day-to-day come in
// through the expense/receipt save instead.
const createAsset = async (req, res) => {
    try {
        const { description, asset_type, cost, currency, acquired_date } = req.body;
        if (!description || !String(description).trim()) {
            return res.status(400).json({ error: 'Description is required.' });
        }
        const numericCost = Number(cost);
        if (!numericCost || numericCost <= 0) {
            return res.status(400).json({ error: 'Cost must be a positive amount.' });
        }
        if (asset_type && !ASSET_TYPES.includes(asset_type)) {
            return res.status(400).json({ error: 'asset_type must be plant_machinery or motor_vehicle.' });
        }

        const asset = await assetModel.createAsset(req.pool, {
            user_id: req.user.userId,
            expense_id: null,
            description: String(description).trim(),
            category: req.body.category || null,
            asset_type: asset_type || 'plant_machinery',
            cost: numericCost,
            currency: currency || 'EUR',
            acquired_date: acquired_date || null,
        });
        res.status(201).json(asset);
    } catch (error) {
        logger.error('Error creating asset: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// PATCH /assets/:id — edit details, record a disposal (date + proceeds), or
// correct a cost. Org-scoped; 404 when out of scope.
const updateAsset = async (req, res) => {
    try {
        const { id } = req.params;
        const { asset_type, cost } = req.body;
        if (asset_type !== undefined && !ASSET_TYPES.includes(asset_type)) {
            return res.status(400).json({ error: 'asset_type must be plant_machinery or motor_vehicle.' });
        }
        if (cost !== undefined && (!Number(cost) || Number(cost) <= 0)) {
            return res.status(400).json({ error: 'Cost must be a positive amount.' });
        }

        const updated = await assetModel.updateAsset(req.pool, id, req.body, scopeOrgIdFor(req));
        if (!updated) {
            return res.status(404).json({ error: 'Asset not found.' });
        }
        res.status(200).json(updated);
    } catch (error) {
        logger.error('Error updating asset: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// DELETE /assets/:id — remove from the register. A linked expense stays and
// simply reverts to an ordinary revenue expense (the row's absence IS the
// "not capital" state).
const deleteAsset = async (req, res) => {
    try {
        const { id } = req.params;
        const count = await assetModel.deleteAsset(req.pool, id, scopeOrgIdFor(req));
        if (count === 0) {
            return res.status(404).json({ error: 'Asset not found.' });
        }
        res.status(200).json({ message: 'Asset removed from the register.' });
    } catch (error) {
        logger.error('Error deleting asset: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = { listAssets, createAsset, updateAsset, deleteAsset, ASSET_TYPES };
