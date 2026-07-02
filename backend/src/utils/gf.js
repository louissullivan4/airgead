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
    // `role` is kept for backward compatibility this phase. Org context
    // (orgId/orgRole/platformRole) is added alongside it. orgId may be
    // undefined for accounts not yet backfilled - authMiddleware treats a
    // missing orgId on a presented token as "re-login required" (401).
    return jwt.sign(
        {
            userId: user.id,
            role: user.role,
            orgId: user.org_id,
            orgRole: user.org_role,
            platformRole: user.platform_role,
        },
        jwtSecret,
        { expiresIn: '168h' }
    );
}

async function hashPassword(password) {
    return await bcrypt.hash(password, 10);
}

// Excel export. `taxSummary` (optional, Phase 5) is the shape returned by
// services/tax/taxSummaryService.buildTaxSummary - when present it marks
// capital rows on the Expenses sheet and appends the tax-season sheets
// (Tax summary / Capital allowances / VAT) the accountant re-keys today.
const ASSET_TYPE_LABELS = {
    plant_machinery: 'Plant & machinery',
    motor_vehicle: 'Motor vehicle (car)',
};
const VAT_STATUS_LABELS = {
    not_registered: 'Not VAT registered',
    registered: 'VAT registered',
    flat_rate_farmer: 'Flat-rate farmer (unregistered)',
};

const generateExcel = async (expenses, imagesDir, filePath, taxSummary = null) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Expenses');
    const capitalIds = new Set((taxSummary && taxSummary.capitalExpenseIds) || []);

    worksheet.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Description', key: 'description', width: 50 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Merchant', key: 'merchant', width: 20 },
        { header: 'Tax', key: 'tax', width: 10 },
        { header: 'Capital', key: 'capital', width: 10 },
        { header: 'Receipt File', key: 'receipt_file', width: 26 },
        { header: 'Receipt Image', key: 'receipt_image', width: 20 },
    ];
    const IMAGE_COLUMN = 12; // keep in sync with the columns above

    worksheet.getRow(1).font = { bold: true };

    expenses.forEach(expense => {
        // Point at the copy shipped in the zip's images/ folder. Receipt
        // objects are private (signed-URL access only), so a raw storage URL
        // would be useless in a spreadsheet; legacy pre-Phase-2 rows that only
        // hold an old public URL fall back to showing it.
        const receiptFile = expense.local_image_path
            ? `images/${path.basename(expense.local_image_path)}`
            : (expense.receipt_image_url || '');
        worksheet.addRow({
            id: expense.id,
            title: expense.title,
            description: expense.description,
            category: expense.category,
            amount: expense.amount,
            currency: expense.currency,
            date: expense.created_at,
            merchant: expense.merchant_name || '',
            tax: expense.tax_amount ?? '',
            capital: capitalIds.has(expense.id) ? 'Yes' : '',
            receipt_file: receiptFile,
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

            worksheet.addImage(imageId, {
                tl: { col: IMAGE_COLUMN - 1, row: rowNumber - 1 },
                ext: { width: 100, height: 100 },
                editAs: 'oneCell',
            });

            worksheet.getRow(rowNumber).height = 80;
        }
    });

    if (taxSummary) {
        addTaxSummarySheet(workbook, taxSummary);
        addCapitalAllowancesSheet(workbook, taxSummary);
        addVatSheet(workbook, taxSummary);
    }

    await workbook.xlsx.writeFile(filePath);
};

// "Tax summary" - the year's totals in the Form 11 shape the accountant
// re-keys every January.
function addTaxSummarySheet(workbook, summary) {
    const sheet = workbook.addWorksheet('Tax summary');
    sheet.columns = [
        { header: '', key: 'label', width: 48 },
        { header: '', key: 'value', width: 18 },
    ];

    const title = (text) => {
        const row = sheet.addRow({ label: text });
        row.font = { bold: true };
    };
    const line = (label, value) => sheet.addRow({ label, value });

    title(`${summary.orgName} - tax year ${summary.year}`);
    sheet.addRow({});
    line('Income', summary.totals.income);
    line('Allowable expenses (revenue)', summary.totals.revenueExpenses);
    line('Wear & tear allowance (capital)', summary.totals.wearAndTear);
    const net = sheet.addRow({
        label: 'Estimated profit before adjustments',
        value: summary.totals.netBeforeAdjustments,
    });
    net.font = { bold: true };

    sheet.addRow({});
    title('Form 11 - extracts from accounts (revenue expenses)');
    summary.form11.forEach((bucket) => line(bucket.label, bucket.total));

    sheet.addRow({});
    title('Capital');
    line('Capital expenditure captured this year', summary.totals.capitalExpenditure);
    line('Wear & tear claimed this year', summary.totals.wearAndTear);

    sheet.getColumn(2).numFmt = '#,##0.00';
}

// "Capital allowances" - the wear & tear schedule (12.5% straight-line over 8
// years; car cost cap already applied in `allowableCost`).
function addCapitalAllowancesSheet(workbook, summary) {
    const sheet = workbook.addWorksheet('Capital allowances');
    sheet.columns = [
        { header: 'Description', key: 'description', width: 34 },
        { header: 'Type', key: 'type', width: 20 },
        { header: 'Acquired', key: 'acquired', width: 12 },
        { header: 'Cost', key: 'cost', width: 12 },
        { header: 'Allowable cost', key: 'allowable', width: 14 },
        { header: 'Capped', key: 'capped', width: 8 },
        { header: 'Year', key: 'year', width: 10 },
        { header: 'Opening WDV', key: 'opening', width: 13 },
        { header: 'Allowance', key: 'allowance', width: 12 },
        { header: 'Closing WDV', key: 'closing', width: 13 },
        { header: 'Disposed', key: 'disposed', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };

    summary.capitalAllowances.rows.forEach((r) => {
        sheet.addRow({
            description: r.description,
            type: ASSET_TYPE_LABELS[r.assetType] || r.assetType,
            acquired: r.acquiredDate,
            cost: r.cost,
            allowable: r.allowableCost,
            capped: r.capped ? 'Yes' : '',
            year: `${r.yearIndex} of 8`,
            opening: r.openingWdv,
            allowance: r.allowance,
            closing: r.closingWdv,
            disposed: r.disposed ? 'Yes' : '',
        });
    });

    const totals = sheet.addRow({
        description: 'Total',
        cost: summary.capitalAllowances.totals.cost,
        allowance: summary.capitalAllowances.totals.allowance,
        closing: summary.capitalAllowances.totals.closingWdv,
    });
    totals.font = { bold: true };

    ['cost', 'allowable', 'opening', 'allowance', 'closing'].forEach((key) => {
        sheet.getColumn(key).numFmt = '#,##0.00';
    });
}

// "VAT" - the org's VAT position for the year.
function addVatSheet(workbook, summary) {
    const sheet = workbook.addWorksheet('VAT');
    sheet.columns = [
        { header: '', key: 'label', width: 48 },
        { header: '', key: 'value', width: 22 },
    ];
    const vat = summary.vat;
    const line = (label, value) => sheet.addRow({ label, value });

    const head = line('VAT status', VAT_STATUS_LABELS[vat.vatStatus] || vat.vatStatus);
    head.font = { bold: true };
    line('VAT captured on purchases', vat.vatOnPurchases);
    line('VAT captured on income', vat.vatOnIncome);
    line('Input VAT reclaimable via VAT returns', vat.inputVatReclaimable ? 'Yes' : 'No');
    if (vat.flatRateAddition != null) {
        line(`Flat-rate addition (${summary.year})`, `${(vat.flatRateAddition * 100).toFixed(1)}%`);
    }
    if (vat.vat58EligibleSpend > 0) {
        line('VAT 58 eligible spend (buildings, fencing, drainage)', vat.vat58EligibleSpend);
    }
}

module.exports = {
    extractToken,
    generateJwtToken,
    hashPassword,
    generateExcel
};