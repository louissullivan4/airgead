const expenseModel = require('../models/expenseModel');
const userModel = require('../models/userModel');
const logger = require('../utils/logger');
const { uploadBase64Image } = require('../middlewares/imageUpload');
const { getSignedUrl } = require('../utils/signedUrl');
const { downloadImages, createZipArchive } = require('../middlewares/imageDownload');
const { isSuperAdmin } = require('../middlewares/tenantScope');
const fs = require('fs-extra');
const path = require('path');
const gf = require('../utils/gf');

// Phase 0 tenant scoping. super_admin bypasses org scoping (null = unscoped);
// everyone else is restricted to expenses whose user_id is in their org.
const scopeOrgIdFor = (req) => (isSuperAdmin(req) ? null : req.user.orgId);

// Reject access to a target user's data when that user is not in the caller's
// org (and the caller is not a super_admin). Returns true if access is denied
// and a response has been sent.
const denyIfCrossOrg = async (req, res, targetUserId) => {
    if (isSuperAdmin(req)) return false;
    const inOrg = await userModel.isUserInOrg(req.pool, targetUserId, req.user.orgId);
    if (!inOrg) {
        logger.warn('Cross-org access attempt by user %s for target user %s', req.user.userId, targetUserId);
        res.status(403).json({ error: 'Access denied. You do not have permission to access this resource.' });
        return true;
    }
    return false;
};

const createExpense = async (req, res) => {
    try {
        const token = gf.extractToken(req);
        if (!token) {
            logger.error('Missing token for expense creation.');
            return res.status(401).json({ error: 'Authentication token is required.' });
        }

        const expenseData = extractExpenseData(req);

        await uploadBase64Image(req, res, async (err) => {
            if (err) {
                logger.error('Image upload error: %s', err.message);
                return res.status(400).json({ error: err.message });
            }

            expenseData.receipt_image_url = req.body.image;

            const newExpense = await expenseModel.createExpense(req.pool, expenseData);
            logger.info('Expense created successfully', newExpense);
            res.status(201).json(newExpense);
        });
    } catch (error) {
        logger.error('Database error while creating expense', error);
        res.status(500).json({ error: 'Failed to save expense to database.' });
    }
};

function extractExpenseData(req, res) {
    const user_id = (req.user ? req.user.userId : '').toString();
    const {
        title,
        description,
        category,
        amount,
        currency,
        image,
        date
    } = req.body;

    if (!user_id || !title || !category || !amount || !currency) {
        logger.warn('Invalid input data for creating expense: %o', req.body);
        return res.status(400).json({ error: 'User ID, Title, category, amount and currency are required.' });
    }

    return {
        user_id,
        title,
        description,
        category,
        amount,
        currency,
        image,
        // The transaction date chosen in the form maps to created_at. Omitted ->
        // the model defaults to now() (create) or keeps the existing value (edit).
        created_at: date || undefined,
        receipt_image_url: null
    }
}

const getExpenses = async (req, res) => {
    try {
        const pool = req.pool;
        const user_id = req.query?.user_id;
        const category = req.query?.category;
        let expenses;

        if (user_id && await denyIfCrossOrg(req, res, user_id)) return;
        const scopeOrgId = scopeOrgIdFor(req);

        if (category) {
            expenses = await expenseModel.getExpenseByCategory(pool, user_id, category, scopeOrgId);
            logger.info('Expenses fetched by category: %s for user: %s', category, user_id);
        } else {
            expenses = await expenseModel.getExpensesByUserId(pool, user_id, scopeOrgId);
            logger.info('Expenses fetched for user: %s', user_id);
        }
        res.status(200).json(expenses);
    } catch (error) {
        logger.error('Error fetching expenses: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const getExpensesByUserId = async (req, res) => {
    try {
        const pool = req.pool;
        const id = req.params.id;
        if (id) {
            if (await denyIfCrossOrg(req, res, id)) return;
            const expenses = await expenseModel.getExpensesByUserId(pool, id, scopeOrgIdFor(req));
            logger.info('Expenses fetched for user: %s', id);
            res.status(200).json(expenses);
        } else {
            logger.error('User ID is required.');
            res.status(401).json({ error: 'User ID is required.' });
        }
    } catch (error) {
        logger.error('Error fetching expenses: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};


const getExpensesByUserIdNoIncome = async (req, res) => {
    try {
        const pool = req.pool;
        const id = req.params.id;
        if (id) {
            if (await denyIfCrossOrg(req, res, id)) return;
            const expenses = await expenseModel.getExpensesByUserIdNoIncome(pool, id, scopeOrgIdFor(req));
            logger.info('Expenses fetched for user: %s', id);
            res.status(200).json(expenses);
        } else {
            logger.error('User ID is required.');
            res.status(401).json({ error: 'User ID is required.' });
        }
    } catch (error) {
        logger.error('Error fetching expenses: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const getExpensesByUserIdAndYear = async (req, res) => {
    try {
        const pool = req.pool;
        const user_id = req.params.id;
        const year = req.params.year;

        if (user_id && year) {
            if (await denyIfCrossOrg(req, res, user_id)) return;
            const expenses = await expenseModel.getExpensesByUserIdAndYear(pool, user_id, year, scopeOrgIdFor(req));
            logger.info('Expenses fetched for user: %s', user_id);
            res.status(200).json(expenses);
        } else {
            logger.error('User ID and Year is required.');
            res.status(401).json({ error: 'User ID and Year is required.' });
        }

    } catch (error) {
        logger.error('Error fetching expenses: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const getExpenseById = async (req, res) => {
    try {
        const pool = req.pool;
        const { id } = req.params;
        const user_id = req.user.userId;
        const userRole = req.user.role;

        const expense = await expenseModel.getExpenseById(pool, id, scopeOrgIdFor(req));

        if (!expense) {
            logger.warn('Expense not found with ID: %s', id);
            return res.status(404).json({ error: 'Expense not found.' });
        }

        if (expense.user_id !== user_id && !['admin', 'accountant'].includes(userRole)) {
            logger.warn('Unauthorized access attempt by user: %s for expense ID: %s', user_id, id);
            return res.status(403).json({ error: 'Access denied. You do not have permission to view this expense.' });
        }

        logger.info('Expense fetched with ID: %s by user: %s', id, user_id);
        res.status(200).json(expense);
    } catch (error) {
        logger.error('Error fetching expense by ID: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const updateExpense = async (req, res) => {
    try {
        const pool = req.pool;
        const { id } = req.params;
        const user_id = req.user.userId;
        const userRole = req.user.role;
        const { title, description, category, amount, currency, receipt_image_url } = req.body;
        const scopeOrgId = scopeOrgIdFor(req);

        const expense = await expenseModel.getExpenseById(pool, id, scopeOrgId);

        if (!expense) {
            logger.warn('Expense not found with ID: %s', id);
            return res.status(404).json({ error: 'Expense not found.' });
        }

        if (expense.user_id !== user_id && !['admin', 'accountant'].includes(userRole)) {
            logger.warn('Unauthorized update attempt by user: %s for expense ID: %s', user_id, id);
            return res.status(403).json({ error: 'Access denied. You do not have permission to update this expense.' });
        }

        const updatedExpense = await expenseModel.updateExpense(pool, id, {
            title,
            description,
            category,
            amount,
            currency,
            receipt_image_url,
        }, scopeOrgId);

        logger.info('Expense updated successfully with ID: %s', id);
        res.status(200).json(updatedExpense);
    } catch (error) {
        logger.error('Error updating expense: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const partialUpdateExpense = async (req, res) => {
    const { id } = req.params;
    try {
        const token = gf.extractToken(req);
        if (!token) {
            logger.error('Missing token for expense creation.');
            return res.status(401).json({ error: 'Authentication token is required.' });
        }

        const expenseData = extractExpenseData(req);
        const scopeOrgId = scopeOrgIdFor(req);

        // Verify the target expense is in scope and owned by the caller (or an
        // admin/accountant) before mutating — mirrors updateExpense/deleteExpense.
        const existing = await expenseModel.getExpenseById(req.pool, id, scopeOrgId);
        if (!existing) {
            logger.warn('Expense not found with ID: %s', id);
            return res.status(404).json({ error: 'Expense not found.' });
        }
        if (existing.user_id !== req.user.userId && !['admin', 'accountant'].includes(req.user.role)) {
            logger.warn('Unauthorized patch attempt by user: %s for expense ID: %s', req.user.userId, id);
            return res.status(403).json({ error: 'Access denied. You do not have permission to update this expense.' });
        }

        if (expenseData.image != null) {
            await uploadBase64Image(req, res, async (err) => {
                if (err) {
                    logger.error('Image upload error: %s', err.message);
                    return res.status(400).json({ error: err.message });
                }
                const newExpense = await expenseModel.partialUpdateExpense(req.pool, id, expenseData, true, scopeOrgId);
                logger.info('Expense updated successfully', newExpense);
                res.status(201).json(newExpense);
            });
        } else {
            const newExpense = await expenseModel.partialUpdateExpense(req.pool, id, expenseData, false, scopeOrgId);
            logger.info('Expense updated successfully', newExpense);
            res.status(201).json(newExpense);
        }
    } catch (error) {
        logger.error('Database error while creating expense', error);
        res.status(500).json({ error: 'Failed to save expense to database.' });
    }
};

const deleteExpense = async (req, res) => {
    try {
        const pool = req.pool;
        const { id } = req.params;
        const user_id = req.user.userId;
        const userRole = req.user.role;
        const scopeOrgId = scopeOrgIdFor(req);

        const expense = await expenseModel.getExpenseById(pool, id, scopeOrgId);

        if (!expense) {
            logger.warn('Expense not found with ID: %s', id);
            return res.status(404).json({ error: 'Expense not found.' });
        }

        if (expense.user_id !== user_id && !['admin', 'accountant'].includes(userRole)) {
            logger.warn('Unauthorized delete attempt by user: %s for expense ID: %s', user_id, id);
            return res.status(403).json({ error: 'Access denied. You do not have permission to delete this expense.' });
        }

        await expenseModel.deleteExpense(pool, id, scopeOrgId);
        logger.info('Expense deleted successfully with ID: %s', id);
        res.status(200).json({ message: 'Expense deleted successfully.' });
    } catch (error) {
        logger.error('Error deleting expense: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const getExcelDownloadByUserIdAndYear = async (req, res) => {
    const pool = req.pool;
    const userId = req.params.id;
    const year = req.params.year;

    const timestamp = Date.now();
    const tempDir = path.join(__dirname, '..', 'temp', `download_${userId}_${year}_${timestamp}`);
    const imagesDir = path.join(tempDir, 'images');
    const excelFilePath = path.join(tempDir, `expenses_${userId}_${year}_${timestamp}.xlsx`);
    const zipFilePath = path.join(tempDir, `expenses_${userId}_${year}_${timestamp}.zip`);

    try {
        if (await denyIfCrossOrg(req, res, userId)) return;

        await fs.ensureDir(imagesDir);

        const expenses = await expenseModel.getExpensesByUserIdAndYear(pool, userId, year, scopeOrgIdFor(req));
        if (expenses.length === 0) {
            return res.status(404).json({ message: 'No expenses found for the given user and year.' });
        }

        await downloadImages(expenses, imagesDir);

        await gf.generateExcel(expenses, imagesDir, excelFilePath);

        await createZipArchive([excelFilePath, imagesDir], zipFilePath);

        res.download(zipFilePath, `expenses_${year}.zip`, async (err) => {
            if (err) {
                logger.error('Error sending ZIP file:', err.message);
                res.status(500).json({ error: 'Failed to download the file.' });
            }

            await fs.remove(tempDir);
        });

    } catch (error) {
        logger.error('Error generating download:', error.message);
        await fs.remove(tempDir);
        res.status(500).json({ error: 'An error occurred while generating the download.' });
    }
};

// Task 6: return a short-lived signed URL for an expense's receipt object.
// Org-scoped: only returns a URL if the expense is visible to the caller.
const getReceiptUrl = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.userId;
        const userRole = req.user.role;

        const expense = await expenseModel.getExpenseById(req.pool, id, scopeOrgIdFor(req));
        if (!expense) {
            return res.status(404).json({ error: 'Expense not found.' });
        }
        if (expense.user_id !== user_id && !['admin', 'accountant'].includes(userRole)) {
            return res.status(403).json({ error: 'Access denied. You do not have permission to access this receipt.' });
        }
        if (!expense.receipt_image_url) {
            return res.status(404).json({ error: 'This expense has no receipt.' });
        }

        const url = await getSignedUrl(expense.receipt_image_url);
        res.status(200).json({ url });
    } catch (error) {
        logger.error('Error generating receipt signed URL: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = {
    createExpense,
    getExpenses,
    getExpenseById,
    getReceiptUrl,
    updateExpense,
    deleteExpense,
    getExpensesByUserIdAndYear,
    getExpensesByUserId,
    getExcelDownloadByUserIdAndYear,
    partialUpdateExpense,
    getExpensesByUserIdNoIncome
};