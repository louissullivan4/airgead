const logger = require('../utils/logger');

// Phase 0 tenant scoping: expenses key on user_id only (no expenses.org_id yet —
// that denormalisation is a Phase 0.5 follow-up). We enforce isolation via the
// user -> org relationship: a row is in-scope when its user_id belongs to the
// caller's org. Pass orgId = null/undefined to bypass scoping (super_admin only).
//
// `orgClause(orgId, paramIndex)` returns the SQL fragment + whether a param was
// added, so callers can append the orgId to their values array.
const orgPredicate = (alias, orgId, paramIndex) => {
    if (orgId === null || orgId === undefined) {
        return { sql: '', usesParam: false };
    }
    return {
        sql: ` AND ${alias}user_id IN (SELECT id FROM users WHERE org_id = $${paramIndex})`,
        usesParam: true,
    };
};

// Core INSERT. `q` is anything with .query() — the pool, or a client inside a
// transaction (createExpensesWithAssets).
const insertExpense = async (q, expense) => {
    const { user_id, title, description, category, amount, currency, receipt_image_url,
        receipt_id, merchant_name, tax_amount, created_at } = expense;
    // created_at doubles as the transaction date (it drives display, sorting
    // and the tax-year report). COALESCE lets callers set it explicitly while
    // falling back to now() when omitted.
    const result = await q.query(
        `INSERT INTO expenses (user_id, title, description, category, amount, currency, receipt_image_url, receipt_id, merchant_name, tax_amount, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now())) RETURNING *`,
        [user_id, title, description, category, amount, currency, receipt_image_url,
            receipt_id || null, merchant_name || null, tax_amount ?? null, created_at || null]
    );
    return result.rows[0];
};

const createExpense = async (pool, expense) => {
    try {
        const row = await insertExpense(pool, expense);
        logger.info('Expense created successfully', { user_id: expense.user_id, title: expense.title });
        return row;
    } catch (error) {
        logger.error('Error creating expense', { user_id: expense.user_id, error: error });
        throw error;
    }
};

// Phase 5: create one or more expenses, each optionally with a linked
// asset-register row, in a SINGLE transaction — a multi-line receipt save (and
// the single capital-expense save) is all-or-nothing. `items` is
// [{ expense, asset: { description?, asset_type?, acquired_date? } | null }];
// the asset's cost/category/currency follow the expense line.
const createExpensesWithAssets = async (pool, items) => {
    // Lazy require avoids import-order coupling for a helper only this fn uses.
    const assetModel = require('./assetModel');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const created = [];
        for (const { expense, asset } of items) {
            const row = await insertExpense(client, expense);
            if (asset) {
                await assetModel.createAsset(client, {
                    user_id: row.user_id,
                    expense_id: row.id,
                    description: asset.description || row.title || row.merchant_name || 'Asset',
                    category: row.category,
                    asset_type: asset.asset_type,
                    cost: row.amount,
                    currency: row.currency,
                    acquired_date: asset.acquired_date || row.created_at || null,
                });
            }
            created.push(row);
        }
        await client.query('COMMIT');
        logger.info('Created %d expense(s) with %d asset(s)', created.length,
            items.filter((i) => i.asset).length);
        return created;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error creating expenses with assets', { error: error.message });
        throw error;
    } finally {
        client.release();
    }
};

// Phase 5: reads expose `is_capital` — true when an asset-register row is
// linked to the expense (that row's existence IS the capital marker; there is
// no flag column). EXISTS avoids join-duplication risk.
const IS_CAPITAL_SELECT =
    'SELECT expenses.*, EXISTS(SELECT 1 FROM assets a WHERE a.expense_id = expenses.id) AS is_capital FROM expenses';

const getExpensesByUserIdNoIncome = async (pool, user_id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [user_id, orgId] : [user_id];
        const result = await pool.query(
            `${IS_CAPITAL_SELECT} WHERE user_id = $1 AND category != 'income'${org.sql} ORDER BY updated_at DESC`,
            values
        );
        logger.info('Fetched expenses for user', { user_id });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by user ID', { user_id, error: error.message });
        throw error;
    }
};

const getExpensesByUserId = async (pool, user_id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [user_id, orgId] : [user_id];
        const result = await pool.query(
            `${IS_CAPITAL_SELECT} WHERE user_id = $1${org.sql} ORDER BY updated_at DESC`,
            values
        );
        logger.info('Fetched expenses for user', { user_id });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by user ID', { user_id, error: error.message });
        throw error;
    }
};

const getExpenseById = async (pool, id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [id, orgId] : [id];
        const result = await pool.query(`SELECT * FROM expenses WHERE id = $1${org.sql}`, values);
        if (result.rows.length > 0) {
            logger.info('Expense fetched successfully', { id });
            return result.rows[0];
        } else {
            logger.warn('Expense not found', { id });
            return null;
        }
    } catch (error) {
        logger.error('Error fetching expense by ID', { id, error: error.message });
        throw error;
    }
};

const getExpenseByCategory = async (pool, id, category, orgId) => {
    try {
        const org = orgPredicate('', orgId, 3);
        const values = org.usesParam ? [id, category, orgId] : [id, category];
        const result = await pool.query(
            `SELECT * FROM expenses WHERE user_id = $1 AND category = $2${org.sql}`,
            values
        );
        logger.info('Fetched expenses by category', { id, category });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by category', { id, category, error: error.message });
        throw error;
    }
};


// All expense line items captured from a single receipt, org-scoped. Used by the
// receipt detail endpoint (GET /receipts/:id) to return a receipt + its lines.
const getExpensesByReceiptId = async (pool, receiptId, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [receiptId, orgId] : [receiptId];
        const result = await pool.query(
            `SELECT * FROM expenses WHERE receipt_id = $1${org.sql} ORDER BY created_at ASC`,
            values
        );
        logger.info('Fetched expenses by receipt ID', { receiptId });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by receipt ID', { receiptId, error: error.message });
        throw error;
    }
};


// Phase 3 org-level reads. A client org may have several members, so the
// accountant workspace needs all of an org's line items (not one user's). These
// scope on the user -> org relationship, the same join the orgPredicate uses.
const getExpensesByOrgId = async (pool, orgId) => {
    try {
        const result = await pool.query(
            `${IS_CAPITAL_SELECT}
             WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)
             ORDER BY updated_at DESC`,
            [orgId]
        );
        logger.info('Fetched expenses for org', { orgId });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by org ID', { orgId, error: error.message });
        throw error;
    }
};

const getExpensesByOrgIdAndYear = async (pool, orgId, year) => {
    try {
        const startDate = `${year}-01-01`;
        const endDate = `${parseInt(year, 10) + 1}-01-01`;
        const result = await pool.query(
            `${IS_CAPITAL_SELECT}
             WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)
               AND created_at >= $2 AND created_at < $3
             ORDER BY updated_at DESC`,
            [orgId, startDate, endDate]
        );
        logger.info('Fetched expenses for org and year', { orgId, year });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by org ID and year', { orgId, year, error: error.message });
        throw error;
    }
};

const getExpensesByUserIdAndYear = async (pool, user_id, year, orgId) => {
    try {
        const startDate = `${year}-01-01`;
        const endDate = `${parseInt(year) + 1}-01-01`;

        const org = orgPredicate('', orgId, 4);
        const query = `
            ${IS_CAPITAL_SELECT}
            WHERE user_id = $1
              AND created_at >= $2
              AND created_at < $3${org.sql}
        `;
        const values = org.usesParam ? [user_id, startDate, endDate, orgId] : [user_id, startDate, endDate];
        const result = await pool.query(query, values);
        logger.info('Fetched expenses for user', { user_id, year });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by user ID and year', { user_id, year, error: error.message });
        throw error;
    }
};


const updateExpense = async (pool, id, expense, orgId) => {
    try {
        const { title, description, category, amount, currency, receipt_image_url,
            merchant_name, tax_amount } = expense;
        const org = orgPredicate('', orgId, 10);
        const baseValues = [title, description, category, amount, currency, receipt_image_url,
            merchant_name ?? null, tax_amount ?? null, id];
        const values = org.usesParam ? [...baseValues, orgId] : baseValues;
        const result = await pool.query(
            `UPDATE expenses SET title = $1, description = $2, category = $3, amount = $4, currency = $5, receipt_image_url = $6, merchant_name = $7, tax_amount = $8, updated_at = CURRENT_TIMESTAMP WHERE id = $9${org.sql} RETURNING *`,
            values
        );
        if (result.rows.length > 0) {
            logger.info('Expense updated successfully', { id });
            return result.rows[0];
        } else {
            logger.warn('Expense not found for update', { id });
            return null;
        }
    } catch (error) {
        logger.error('Error updating expense', { id, error: error.message });
        throw error;
    }
};

const partialUpdateExpense = async (pool, id, expense, updateImage, orgId) => {
    try {
        const { title, description, category, amount, currency, receipt_image_url,
            merchant_name, tax_amount, created_at } = expense;
        // merchant_name/tax_amount/created_at use COALESCE so a PATCH that omits
        // them (e.g. legacy single-expense edits) preserves the existing values
        // instead of nulling them. created_at doubles as the transaction date.
        if (!updateImage) {
            const org = orgPredicate('', orgId, 10);
            const baseValues = [title, description, category, amount, currency,
                merchant_name ?? null, tax_amount ?? null, created_at || null, id];
            const values = org.usesParam ? [...baseValues, orgId] : baseValues;
            const result = await pool.query(
                `UPDATE expenses SET title = $1, description = $2, category = $3, amount = $4, currency = $5, merchant_name = COALESCE($6, merchant_name), tax_amount = COALESCE($7, tax_amount), created_at = COALESCE($8::timestamptz, created_at), updated_at = CURRENT_TIMESTAMP WHERE id = $9${org.sql} RETURNING *`,
                values
            );
            return result.rows[0];
        } else {
            const org = orgPredicate('', orgId, 11);
            const baseValues = [title, description, category, amount, currency, receipt_image_url,
                merchant_name ?? null, tax_amount ?? null, created_at || null, id];
            const values = org.usesParam ? [...baseValues, orgId] : baseValues;
            const result = await pool.query(
                `UPDATE expenses SET title = $1, description = $2, category = $3, amount = $4, currency = $5, receipt_image_url = $6, merchant_name = COALESCE($7, merchant_name), tax_amount = COALESCE($8, tax_amount), created_at = COALESCE($9::timestamptz, created_at), updated_at = CURRENT_TIMESTAMP WHERE id = $10${org.sql} RETURNING *`,
                values
            );
            return result.rows[0];
        }
    } catch (error) {
        logger.error('Error updating expense', { user_id: expense.user_id, error: error });
        throw error;
    }
};


const deleteExpense = async (pool, id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [id, orgId] : [id];
        const result = await pool.query(`DELETE FROM expenses WHERE id = $1${org.sql}`, values);
        if (result.rowCount > 0) {
            logger.info('Expense deleted successfully', { id });
        } else {
            logger.warn('Expense not found for deletion', { id });
        }
        return result.rowCount;
    } catch (error) {
        logger.error('Error deleting expense', { id, error: error.message });
        throw error;
    }
};

module.exports = {
    createExpense,
    createExpensesWithAssets,
    getExpensesByUserId,
    getExpenseByCategory,
    getExpenseById,
    updateExpense,
    deleteExpense,
    getExpensesByUserIdAndYear,
    getExpensesByUserIdNoIncome,
    getExpensesByReceiptId,
    getExpensesByOrgId,
    getExpensesByOrgIdAndYear,
    partialUpdateExpense
};
