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

const createExpense = async (pool, expense) => {
    try {
        const { user_id, title, description, category, amount, currency, receipt_image_url } = expense;
        const result = await pool.query(
            'INSERT INTO expenses (user_id, title, description, category, amount, currency, receipt_image_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [user_id, title, description, category, amount, currency, receipt_image_url]
        );
        logger.info('Expense created successfully', { user_id, title });
        return result.rows[0];
    } catch (error) {
        logger.error('Error creating expense', { user_id: expense.user_id, error: error });
        throw error;
    }
};

const getExpensesByUserIdNoIncome = async (pool, user_id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [user_id, orgId] : [user_id];
        const result = await pool.query(
            `SELECT * FROM expenses WHERE user_id = $1 AND category != 'income'${org.sql} ORDER BY updated_at DESC`,
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
            `SELECT * FROM expenses WHERE user_id = $1${org.sql} ORDER BY updated_at DESC`,
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


const getExpensesByUserIdAndYear = async (pool, user_id, year, orgId) => {
    try {
        const startDate = `${year}-01-01`;
        const endDate = `${parseInt(year) + 1}-01-01`;

        const org = orgPredicate('', orgId, 4);
        const query = `
            SELECT *
            FROM expenses
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
        const { title, description, category, amount, currency, receipt_image_url } = expense;
        const org = orgPredicate('', orgId, 8);
        const baseValues = [title, description, category, amount, currency, receipt_image_url, id];
        const values = org.usesParam ? [...baseValues, orgId] : baseValues;
        const result = await pool.query(
            `UPDATE expenses SET title = $1, description = $2, category = $3, amount = $4, currency = $5, receipt_image_url = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7${org.sql} RETURNING *`,
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
        const { title, description, category, amount, currency, receipt_image_url } = expense;
        if (!updateImage) {
            const org = orgPredicate('', orgId, 7);
            const baseValues = [title, description, category, amount, currency, id];
            const values = org.usesParam ? [...baseValues, orgId] : baseValues;
            const result = await pool.query(
                `UPDATE expenses SET title = $1, description = $2, category = $3, amount = $4, currency = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6${org.sql} RETURNING *`,
                values
            );
            return result.rows[0];
        } else {
            const org = orgPredicate('', orgId, 8);
            const baseValues = [title, description, category, amount, currency, receipt_image_url, id];
            const values = org.usesParam ? [...baseValues, orgId] : baseValues;
            const result = await pool.query(
                `UPDATE expenses SET title = $1, description = $2, category = $3, amount = $4, currency = $5, receipt_image_url = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7${org.sql} RETURNING *`,
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
    getExpensesByUserId,
    getExpenseByCategory,
    getExpenseById,
    updateExpense,
    deleteExpense,
    getExpensesByUserIdAndYear,
    getExpensesByUserIdNoIncome,
    partialUpdateExpense
};
