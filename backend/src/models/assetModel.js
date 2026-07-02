const logger = require('../utils/logger');

// Phase 5 capital-asset register. Tenant scoping mirrors expenseModel: assets
// key on user_id only; a row is in-scope when its user_id belongs to the
// caller's org. Pass orgId = null/undefined to bypass scoping (super_admin).
const orgPredicate = (alias, orgId, paramIndex) => {
    if (orgId === null || orgId === undefined) {
        return { sql: '', usesParam: false };
    }
    return {
        sql: ` AND ${alias}user_id IN (SELECT id FROM users WHERE org_id = $${paramIndex})`,
        usesParam: true,
    };
};

// `q` is anything with .query() - the pool, or a client inside a transaction
// (the capital-expense save creates expense + asset atomically).
const createAsset = async (q, asset) => {
    try {
        const { user_id, expense_id, description, category, asset_type, cost,
            currency, acquired_date, disposal_date, disposal_proceeds } = asset;
        const result = await q.query(
            `INSERT INTO assets (user_id, expense_id, description, category, asset_type, cost, currency, acquired_date, disposal_date, disposal_proceeds)
             VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, now()::date), $9, $10) RETURNING *`,
            [user_id, expense_id || null, description, category || null,
                asset_type || 'plant_machinery', cost, currency || 'EUR',
                acquired_date || null, disposal_date || null, disposal_proceeds ?? null]
        );
        logger.info('Asset created', { user_id, description });
        return result.rows[0];
    } catch (error) {
        logger.error('Error creating asset', { user_id: asset.user_id, error: error.message });
        throw error;
    }
};

const getAssetById = async (pool, id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [id, orgId] : [id];
        const result = await pool.query(`SELECT * FROM assets WHERE id = $1${org.sql}`, values);
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error fetching asset by ID', { id, error: error.message });
        throw error;
    }
};

// The whole org's register (the org is the business entity - members'
// purchases roll up), same join the accountant reads use.
const getAssetsByOrgId = async (pool, orgId) => {
    try {
        const result = await pool.query(
            `SELECT * FROM assets
             WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)
             ORDER BY acquired_date ASC, created_at ASC`,
            [orgId]
        );
        return result.rows;
    } catch (error) {
        logger.error('Error fetching assets by org ID', { orgId, error: error.message });
        throw error;
    }
};

// The asset a capital expense created, if any (org-scoped).
const getAssetByExpenseId = async (q, expenseId, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [expenseId, orgId] : [expenseId];
        const result = await q.query(`SELECT * FROM assets WHERE expense_id = $1${org.sql}`, values);
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error fetching asset by expense ID', { expenseId, error: error.message });
        throw error;
    }
};

// Partial update over a whitelist (same pattern as organisationModel.updateOrg).
const ASSET_UPDATABLE_FIELDS = ['description', 'category', 'asset_type', 'cost',
    'currency', 'acquired_date', 'disposal_date', 'disposal_proceeds'];

const updateAsset = async (q, id, fields, orgId) => {
    const keys = Object.keys(fields).filter(
        (k) => ASSET_UPDATABLE_FIELDS.includes(k) && fields[k] !== undefined
    );
    if (keys.length === 0) return null;

    const setClauses = keys.map((key, index) => `${key} = $${index + 2}`);
    setClauses.push('updated_at = now()');
    const org = orgPredicate('', orgId, keys.length + 2);
    const values = [id, ...keys.map((k) => fields[k])];
    if (org.usesParam) values.push(orgId);

    try {
        const result = await q.query(
            `UPDATE assets SET ${setClauses.join(', ')} WHERE id = $1${org.sql} RETURNING *`,
            values
        );
        if (result.rows.length > 0) {
            logger.info('Asset updated', { id });
            return result.rows[0];
        }
        logger.warn('Asset not found for update', { id });
        return null;
    } catch (error) {
        logger.error('Error updating asset', { id, error: error.message });
        throw error;
    }
};

const deleteAsset = async (pool, id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [id, orgId] : [id];
        const result = await pool.query(`DELETE FROM assets WHERE id = $1${org.sql}`, values);
        if (result.rowCount > 0) logger.info('Asset deleted', { id });
        return result.rowCount;
    } catch (error) {
        logger.error('Error deleting asset', { id, error: error.message });
        throw error;
    }
};

// Un-marking an expense as capital removes its register row (org-scoped).
const deleteAssetByExpenseId = async (q, expenseId, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [expenseId, orgId] : [expenseId];
        const result = await q.query(`DELETE FROM assets WHERE expense_id = $1${org.sql}`, values);
        return result.rowCount;
    } catch (error) {
        logger.error('Error deleting asset by expense ID', { expenseId, error: error.message });
        throw error;
    }
};

module.exports = {
    ASSET_UPDATABLE_FIELDS,
    createAsset,
    getAssetById,
    getAssetsByOrgId,
    getAssetByExpenseId,
    updateAsset,
    deleteAsset,
    deleteAssetByExpenseId,
};
