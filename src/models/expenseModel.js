const logger = require('../utils/logger');

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
        logger.error('Error creating expense', { user_id: expense.user_id, error: error.message });
        throw error;
    }
};

const getExpensesByUserId = async (pool, user_id) => {
    try {
        const result = await pool.query("SELECT * FROM expenses WHERE user_id = $1 AND category != 'income'", [user_id]);
        logger.info('Fetched expenses for user', { user_id });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by user ID', { user_id, error: error.message });
        throw error;
    }
};

const getExpenseById = async (pool, id) => {
    try {
        const result = await pool.query('SELECT * FROM expenses WHERE id = $1', [id]);
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

const getExpenseByCategory = async (pool, id, category) => {
    try {
        const result = await pool.query('SELECT * FROM expenses WHERE user_id = $1 AND category = $2', [id, category]);
        logger.info('Fetched expenses by category', { id, category });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by category', { id, category, error: error.message });
        throw error;
    }
};


const getExpensesByUserIdAndYear = async (pool, user_id, year) => {
    try {
        const startDate = `${year}-01-01`;
        const endDate = `${parseInt(year) + 1}-01-01`;

        const query = `
            SELECT *
            FROM expenses
            WHERE user_id = $1
              AND created_at >= $2
              AND created_at < $3
        `;
        const values = [user_id, startDate, endDate];
        const result = await pool.query(query, values);
        logger.info('Fetched expenses for user', { user_id, year });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching expenses by user ID and year', { user_id, year, error: error.message });
        throw error;
    }
};


const updateExpense = async (pool, id, expense) => {
    try {
        const { title, description, category, amount, currency, receipt_image_url } = expense;
        const result = await pool.query(
            'UPDATE expenses SET title = $1, description = $2, category = $3, amount = $4, currency = $5, receipt_image_url = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *',
            [title, description, category, amount, currency, receipt_image_url, id]
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

const deleteExpense = async (pool, id) => {
    try {
        const result = await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
        if (result.rowCount > 0) {
            logger.info('Expense deleted successfully', { id });
        } else {
            logger.warn('Expense not found for deletion', { id });
        }
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
    getExpensesByUserIdAndYear
};
