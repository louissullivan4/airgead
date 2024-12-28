require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const jwtSecret = process.env.JWT_SECRET;
const ExcelJS = require('exceljs');
const path = require('path');

function extractToken(req) {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }
    if (!token && req.query.token) {
        token = req.query.token;
    }
    return token;
}

function generateJwtToken(user) {
    return jwt.sign(
        { userId: user.id, role: user.role },
        jwtSecret,
        { expiresIn: '168h' }
    );
}

async function hashPassword(password) {
    return await bcrypt.hash(password, 10);
}

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

module.exports = {
    extractToken,
    generateJwtToken,
    hashPassword,
    generateExcel
};