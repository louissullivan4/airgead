const expenseModel = require('../models/expenseModel');
const logger = require('../utils/logger');
const { uploadFile, uploadToCloudinary } = require('../middlewares/imageUpload');
const { downloadImages, createZipArchive } = require('../middlewares/imageDownload');
const ExcelJS = require('exceljs');
const fs = require('fs-extra');
const path = require('path');

const createExpense = async (req, res) => {
    uploadFile('receipt_image')(req, res, async (err) => {
        if (err) {
            logger.error('Image upload error: %s', err.message);
            return res.status(400).json({ error: err.message });
        }

        if (req.file) {
            uploadToCloudinary(req, res, async (cloudinaryErr) => {
                if (cloudinaryErr) {
                    return res.status(500).json({ error: cloudinaryErr.message });
                }
                await proceedWithExpenseCreation(req, res);
            });
        } else {
            await proceedWithExpenseCreation(req, res);
        }
    });
};

async function proceedWithExpenseCreation(req, res) {
    const user_id = (req.user ? req.user.userId : '').toString();
    const { title, description, category, amount, currency } = req.body;
    const receipt_image_url = req.file ? req.file.path : null;

    if (!user_id || !title || !category || !amount || !currency) {
        logger.warn('Invalid input data for creating expense: %o', req.body);
        return res.status(400).json({ error: 'User ID, Title, category, amount, and currency are required.' });
    }

    const newExpense = {
        user_id,
        title,
        description,
        category,
        amount,
        currency,
        receipt_image_url,
    };

    try {
        const newExpenseAdded = await expenseModel.createExpense(req.pool, newExpense);
        logger.info('Expense created successfully: %o', newExpenseAdded);
        res.status(201).json(newExpenseAdded);
    } catch (dbErr) {
        logger.error('Database error while creating expense: %s', dbErr.message);
        res.status(500).json({ error: 'Failed to save expense to database.' });
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

        await generateExcel(expenses, imagesDir, excelFilePath);

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
    getExcelDownloadByUserIdAndYear
};

const generateExcel = async (expenses, imagesDir, filePath) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Expenses');

    worksheet.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Description', key: 'description', width: 50 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Receipt Image URL', key: 'receipt_image_url', width: 15 },
        { header: 'Receipt Image', key: 'receipt_image', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true };

    expenses.forEach(expense => {
        worksheet.addRow({
            id: expense.id,
            title: expense.title,
            description: expense.description,
            category: expense.category,
            amount: expense.amount,
            currency: expense.currency,
            date: expense.created_at,
            receipt_image_url: expense.receipt_image_url,
            receipt_image: '',
        });
    });

    expenses.forEach((expense, index) => {
        if (expense.local_image_path) {
            const imageId = workbook.addImage({
                filename: expense.local_image_path,
                extension: path.extname(expense.local_image_path).substring(1),
            });

            const rowNumber = index + 2;
            const columnNumber = 9;

            worksheet.addImage(imageId, {
                tl: { col: columnNumber - 1, row: rowNumber - 1 },
                ext: { width: 100, height: 100 },
                editAs: 'oneCell',
            });

            worksheet.getRow(rowNumber).height = 80;
        }
    });

    worksheet.getColumn(8).width = 20;

    await workbook.xlsx.writeFile(filePath);
};