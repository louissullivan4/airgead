const logger = require('../utils/logger');

// Phase 2 tenant scoping: receipts key on user_id only (no receipts.org_id —
// mirrors the expenses denormalisation choice in expenseModel.js). We enforce
// isolation via the user -> org relationship: a row is in-scope when its user_id
// belongs to the caller's org. Pass orgId = null/undefined to bypass scoping
// (super_admin only).
//
// `orgPredicate(alias, orgId, paramIndex)` returns the SQL fragment + whether a
// param was added, so callers can append the orgId to their values array.
const orgPredicate = (alias, orgId, paramIndex) => {
    if (orgId === null || orgId === undefined) {
        return { sql: '', usesParam: false };
    }
    return {
        sql: ` AND ${alias}user_id IN (SELECT id FROM users WHERE org_id = $${paramIndex})`,
        usesParam: true,
    };
};

const createReceipt = async (pool, receipt) => {
    try {
        const {
            user_id,
            image_object_path,
            parsed_data,
            ocr_confidence,
            receipt_status,
            merchant_name,
            receipt_date,
            total_amount,
            tax_amount,
            currency,
        } = receipt;
        const result = await pool.query(
            `INSERT INTO receipts (
                user_id, image_object_path, parsed_data, ocr_confidence, receipt_status,
                merchant_name, receipt_date, total_amount, tax_amount, currency
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
                user_id,
                image_object_path,
                parsed_data,
                ocr_confidence,
                receipt_status || 'reviewed',
                merchant_name,
                receipt_date,
                total_amount,
                tax_amount,
                currency,
            ]
        );
        logger.info('Receipt created successfully', { user_id, id: result.rows[0].id });
        return result.rows[0];
    } catch (error) {
        logger.error('Error creating receipt', { user_id: receipt.user_id, error: error.message });
        throw error;
    }
};

const getReceiptById = async (pool, id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [id, orgId] : [id];
        const result = await pool.query(`SELECT * FROM receipts WHERE id = $1${org.sql}`, values);
        if (result.rows.length > 0) {
            logger.info('Receipt fetched successfully', { id });
            return result.rows[0];
        } else {
            logger.warn('Receipt not found', { id });
            return null;
        }
    } catch (error) {
        logger.error('Error fetching receipt by ID', { id, error: error.message });
        throw error;
    }
};

const getReceiptsByUserId = async (pool, user_id, orgId) => {
    try {
        const org = orgPredicate('', orgId, 2);
        const values = org.usesParam ? [user_id, orgId] : [user_id];
        const result = await pool.query(
            `SELECT * FROM receipts WHERE user_id = $1${org.sql} ORDER BY created_at DESC`,
            values
        );
        logger.info('Fetched receipts for user', { user_id });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching receipts by user ID', { user_id, error: error.message });
        throw error;
    }
};

const updateReceipt = async (pool, id, receipt, orgId) => {
    try {
        const {
            parsed_data,
            ocr_confidence,
            receipt_status,
            merchant_name,
            receipt_date,
            total_amount,
            tax_amount,
            currency,
        } = receipt;
        const org = orgPredicate('', orgId, 9);
        const baseValues = [
            parsed_data,
            ocr_confidence,
            receipt_status,
            merchant_name,
            receipt_date,
            total_amount,
            tax_amount,
            currency,
            id,
        ];
        const values = org.usesParam ? [...baseValues, orgId] : baseValues;
        const result = await pool.query(
            `UPDATE receipts SET
                parsed_data = $1, ocr_confidence = $2, receipt_status = $3, merchant_name = $4,
                receipt_date = $5, total_amount = $6, tax_amount = $7, currency = $8,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $9${org.sql} RETURNING *`,
            values
        );
        if (result.rows.length > 0) {
            logger.info('Receipt updated successfully', { id });
            return result.rows[0];
        } else {
            logger.warn('Receipt not found for update', { id });
            return null;
        }
    } catch (error) {
        logger.error('Error updating receipt', { id, error: error.message });
        throw error;
    }
};

module.exports = {
    createReceipt,
    getReceiptById,
    getReceiptsByUserId,
    updateReceipt,
};
