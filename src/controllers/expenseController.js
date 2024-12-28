const expenseModel = require('../models/expenseModel');
const logger = require('../utils/logger');
const { uploadBase64Image } = require('../middlewares/imageUpload');
const { downloadImages, createZipArchive } = require('../middlewares/imageDownload');
const fs = require('fs-extra');
const path = require('path');
const gf = require('../utils/gf');

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
        image
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
        receipt_image_url: null
    }
}

const getExpenses = async (req, res) => {
    try {
        const pool = req.pool;
        const user_id = req.query?.user_id;
        const category = req.query?.category;
        let expenses;

        if (category) {
            expenses = await expenseModel.getExpenseByCategory(pool, user_id, category);
            logger.info('Expenses fetched by category: %s for user: %s', category, user_id);
        } else {
            expenses = await expenseModel.getExpensesByUserId(pool, user_id);
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
            const expenses = await expenseModel.getExpensesByUserId(pool, id);
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
            const expenses = await expenseModel.getExpensesByUserIdNoIncome(pool, id);
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
            const expenses = await expenseModel.getExpensesByUserIdAndYear(pool, user_id, year);
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

        const expense = await expenseModel.getExpenseById(pool, id);

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

        const expense = await expenseModel.getExpenseById(pool, id);

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
        });

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
        if (expenseData.image != null) {
            await uploadBase64Image(req, res, async (err) => {
                if (err) {
                    logger.error('Image upload error: %s', err.message);
                    return res.status(400).json({ error: err.message });
                }
                const newExpense = await expenseModel.partialUpdateExpense(req.pool, id, expenseData, true);
                logger.info('Expense updated successfully', newExpense);
                res.status(201).json(newExpense);
            });
        } else {
            const newExpense = await expenseModel.partialUpdateExpense(req.pool, id, expenseData, false);
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

        const expense = await expenseModel.getExpenseById(pool, id);

        if (!expense) {
            logger.warn('Expense not found with ID: %s', id);
            return res.status(404).json({ error: 'Expense not found.' });
        }

        if (expense.user_id !== user_id && !['admin', 'accountant'].includes(userRole)) {
            logger.warn('Unauthorized delete attempt by user: %s for expense ID: %s', user_id, id);
            return res.status(403).json({ error: 'Access denied. You do not have permission to delete this expense.' });
        }

        await expenseModel.deleteExpense(pool, id);
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
        await fs.ensureDir(imagesDir);

        const expenses = await expenseModel.getExpensesByUserIdAndYear(pool, userId, year);
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

module.exports = {
    createExpense,
    getExpenses,
    getExpenseById,
    updateExpense,
    deleteExpense,
    getExpensesByUserIdAndYear,
    getExpensesByUserId,
    getExcelDownloadByUserIdAndYear,
    partialUpdateExpense,
    getExpensesByUserIdNoIncome
};