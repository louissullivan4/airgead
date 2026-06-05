const { v4: uuidv4 } = require('uuid');
const receiptModel = require('../models/receiptModel');
const expenseModel = require('../models/expenseModel');
const logger = require('../utils/logger');
const storage = require('../utils/storage');
const { getSignedUrl } = require('../utils/signedUrl');
const { cleanReceipt } = require('../utils/receiptCleanup');
const { getOcrProvider } = require('../services/ocr');
const { isSuperAdmin } = require('../middlewares/tenantScope');

// Phase 0/2 tenant scoping. super_admin bypasses org scoping (null = unscoped);
// everyone else is restricted to receipts whose user_id is in their org. The
// org predicate lives in the models, so passing the org id is all that's needed.
const scopeOrgIdFor = (req) => (isSuperAdmin(req) ? null : req.user.orgId);

// Decode a base64 image data URI (same convention as imageUpload.js) into a
// raw buffer. Returns null if the payload isn't a valid data URI.
const decodeDataUri = (dataUri) => {
    if (typeof dataUri !== 'string') return null;
    const matches = dataUri.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) return null;
    return Buffer.from(matches[2], 'base64');
};

// POST /receipts/process
// Accepts the raw captured image, cleans it (crop[deferred] -> binarise),
// optionally runs OCR (DORMANT — only if OCR_PROVIDER !== 'none'), stores the
// binarised PNG privately, creates a receipts row, and returns { receiptId,
// signedUrl, parsedData, ocrConfidence }. With OCR disabled this is just
// clean + store + return.
const processReceipt = async (req, res) => {
    try {
        const userId = (req.user ? req.user.userId : '').toString();
        const orgId = req.user && req.user.orgId;
        if (!userId || !orgId) {
            return res.status(401).json({ error: 'Authentication is required.' });
        }

        const inputBuffer = decodeDataUri(req.body.image);
        if (!inputBuffer) {
            return res.status(400).json({ error: 'Invalid image format. Please provide a valid Base64-encoded image.' });
        }

        // capture -> [crop: deferred] -> binarise
        const { binarisedBuffer } = await cleanReceipt(inputBuffer);

        // store: private object key under the Phase 0 tenant scheme.
        const receiptId = uuidv4();
        const year = new Date().getFullYear();
        const objectPath = `org_${orgId}/${year}/${receiptId}.png`;
        await storage.putObject(objectPath, binarisedBuffer, 'image/png');

        // OCR branch — DORMANT. getOcrProvider() returns null while
        // OCR_PROVIDER=none, so nothing here runs today. Flipping the env var
        // later activates auto-fill with no code change: the receipt is created
        // 'pending' (awaiting user confirmation) and carries the parsed data.
        let parsedData = null;
        let ocrConfidence = null;
        let receiptStatus = 'reviewed';
        const merchantFields = {};
        const ocr = getOcrProvider();
        if (ocr) {
            const result = await ocr.extract(binarisedBuffer);
            parsedData = result;
            ocrConfidence = result.fieldConfidence
                ? Object.values(result.fieldConfidence).reduce((a, b) => a + b, 0) /
                  Object.values(result.fieldConfidence).length
                : null;
            receiptStatus = 'pending';
            merchantFields.merchant_name = result.merchant ?? null;
            merchantFields.receipt_date = result.date ?? null;
            merchantFields.total_amount = result.total ?? null;
            merchantFields.tax_amount = result.tax ?? null;
            merchantFields.currency = result.currency ?? null;
        }

        const receipt = await receiptModel.createReceipt(req.pool, {
            user_id: userId,
            image_object_path: objectPath,
            parsed_data: parsedData,
            ocr_confidence: ocrConfidence,
            receipt_status: receiptStatus,
            ...merchantFields,
        });

        const signedUrl = await getSignedUrl(objectPath);
        logger.info('Receipt processed and stored', { receiptId: receipt.id, objectPath });
        res.status(201).json({
            receiptId: receipt.id,
            signedUrl,
            parsedData,
            ocrConfidence,
            receiptStatus,
        });
    } catch (error) {
        logger.error('Error processing receipt: %s', error.message);
        res.status(500).json({ error: 'Failed to process receipt.' });
    }
};

// POST /receipts/:id/expenses
// Creates one or more expense line items linked to a receipt. Body is either an
// array of items or { items: [...] }. The receipt must be visible to the caller.
const createReceiptExpenses = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = (req.user ? req.user.userId : '').toString();
        const scopeOrgId = scopeOrgIdFor(req);

        const receipt = await receiptModel.getReceiptById(req.pool, id, scopeOrgId);
        if (!receipt) {
            return res.status(404).json({ error: 'Receipt not found.' });
        }

        const items = Array.isArray(req.body) ? req.body : req.body.items;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'At least one line item is required.' });
        }

        // Validate before writing anything.
        for (const item of items) {
            if (item.amount === undefined || item.amount === null || !item.category) {
                return res.status(400).json({ error: 'Each line item requires a category and amount.' });
            }
        }

        const created = [];
        for (const item of items) {
            const expense = await expenseModel.createExpense(req.pool, {
                user_id: userId,
                title: item.title || receipt.merchant_name || null,
                description: item.description ?? null,
                category: item.category,
                amount: item.amount,
                currency: item.currency || receipt.currency || 'EUR',
                receipt_image_url: null, // image lives on the receipt; fetched via image-url
                receipt_id: receipt.id,
                merchant_name: item.merchant_name || receipt.merchant_name || null,
                tax_amount: item.tax_amount ?? null,
            });
            created.push(expense);
        }

        logger.info('Created %d line item(s) for receipt %s', created.length, receipt.id);
        res.status(201).json(created);
    } catch (error) {
        logger.error('Error creating receipt line items: %s', error.message);
        res.status(500).json({ error: 'Failed to create line items.' });
    }
};

// GET /receipts/:id/image-url — fresh short-lived signed URL for the receipt image.
const getReceiptImageUrl = async (req, res) => {
    try {
        const { id } = req.params;
        const receipt = await receiptModel.getReceiptById(req.pool, id, scopeOrgIdFor(req));
        if (!receipt) {
            return res.status(404).json({ error: 'Receipt not found.' });
        }
        if (!receipt.image_object_path) {
            return res.status(404).json({ error: 'This receipt has no image.' });
        }
        const url = await getSignedUrl(receipt.image_object_path);
        res.status(200).json({ url });
    } catch (error) {
        logger.error('Error generating receipt image URL: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// GET /receipts/:id — receipt plus its linked expense line items.
const getReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const scopeOrgId = scopeOrgIdFor(req);
        const receipt = await receiptModel.getReceiptById(req.pool, id, scopeOrgId);
        if (!receipt) {
            return res.status(404).json({ error: 'Receipt not found.' });
        }
        const expenses = await expenseModel.getExpensesByReceiptId(req.pool, id, scopeOrgId);
        res.status(200).json({ ...receipt, expenses });
    } catch (error) {
        logger.error('Error fetching receipt: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = {
    processReceipt,
    createReceiptExpenses,
    getReceiptImageUrl,
    getReceipt,
};
