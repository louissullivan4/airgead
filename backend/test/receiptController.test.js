/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
delete process.env.OCR_PROVIDER; // ensure OCR is disabled (default) for these tests

const sinon = require('sinon');
const sharp = require('sharp');
const { expect } = require('@jest/globals');

const receiptController = require('../src/controllers/receiptController');
const receiptModel = require('../src/models/receiptModel');
const expenseModel = require('../src/models/expenseModel');
const storage = require('../src/utils/storage');
const MockOcrProvider = require('../src/services/ocr/MockOcrProvider');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });

const makeDataUri = async () => {
    const png = await sharp({
        create: { width: 32, height: 48, channels: 3, background: { r: 220, g: 220, b: 220 } },
    }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
};

describe('receiptController', () => {
    afterEach(() => sinon.restore());

    describe('POST /receipts/process (OCR disabled)', () => {
        it('cleans + stores the image and creates a receipt without invoking any OCR provider', async () => {
            const dataUri = await makeDataUri();
            const putObject = sinon.stub(storage, 'putObject').resolves();
            sinon.stub(storage, 'getSignedUrl').resolves('http://signed/url');
            const createReceipt = sinon.stub(receiptModel, 'createReceipt').resolves({ id: 'receipt-1' });
            const ocrSpy = sinon.spy(MockOcrProvider.prototype, 'extract');

            const req = {
                pool: {},
                body: { image: dataUri },
                user: { userId: 'user-A', orgId: 'org-A', platformRole: 'user' },
            };
            const res = makeRes();

            await receiptController.processReceipt(req, res);

            // stored under the Phase 0 tenant key scheme, as a legible JPEG
            expect(putObject.calledOnce).toBe(true);
            const [objectPath, , contentType] = putObject.firstCall.args;
            expect(objectPath).toMatch(/^org_org-A\/\d{4}\/[0-9a-f-]+\.jpg$/);
            expect(contentType).toBe('image/jpeg');

            // receipt created in the manual 'reviewed' state with no parsed data
            const created = createReceipt.firstCall.args[1];
            expect(created.receipt_status).toBe('reviewed');
            expect(created.parsed_data).toBeNull();
            expect(created.image_object_path).toBe(objectPath);

            // OCR never ran
            expect(ocrSpy.notCalled).toBe(true);

            expect(res.status.calledWith(201)).toBe(true);
            expect(res.json.firstCall.args[0]).toEqual(
                expect.objectContaining({ receiptId: 'receipt-1', signedUrl: 'http://signed/url', parsedData: null }),
            );
        });

        it('rejects a non-image payload with 400', async () => {
            const req = {
                pool: {},
                body: { image: 'not-a-data-uri' },
                user: { userId: 'user-A', orgId: 'org-A', platformRole: 'user' },
            };
            const res = makeRes();
            await receiptController.processReceipt(req, res);
            expect(res.status.calledWith(400)).toBe(true);
        });
    });

    describe('POST /receipts/:id/expenses', () => {
        it('creates one expense per line item, all linked to the same receipt_id, in ONE transactional call', async () => {
            sinon.stub(receiptModel, 'getReceiptById').resolves({
                id: 'receipt-1', merchant_name: 'Cafe', currency: 'EUR',
            });
            const createBatch = sinon.stub(expenseModel, 'createExpensesWithAssets')
                .callsFake((pool, items) => Promise.resolve(items.map((i, n) => ({ id: `x${n}`, ...i.expense }))));

            const req = {
                pool: {},
                params: { id: 'receipt-1' },
                body: { items: [
                    { category: 'meals', amount: 3.6 },
                    { category: 'meals', amount: 10.8, description: 'Lunch' },
                ] },
                user: { userId: 'user-A', orgId: 'org-A', platformRole: 'user' },
            };
            const res = makeRes();

            await receiptController.createReceiptExpenses(req, res);

            expect(createBatch.calledOnce).toBe(true);
            const items = createBatch.firstCall.args[1];
            expect(items).toHaveLength(2);
            expect(items[0].expense.receipt_id).toBe('receipt-1');
            expect(items[1].expense.receipt_id).toBe('receipt-1');
            // no capital markers -> no asset payloads
            expect(items[0].asset).toBeNull();
            expect(items[1].asset).toBeNull();
            expect(res.status.calledWith(201)).toBe(true);
            expect(res.json.firstCall.args[0]).toHaveLength(2);
        });

        it('passes a sanitised asset payload for a capital line item', async () => {
            sinon.stub(receiptModel, 'getReceiptById').resolves({
                id: 'receipt-1', merchant_name: 'Agri Stores', currency: 'EUR', receipt_date: '2026-02-01',
            });
            const createBatch = sinon.stub(expenseModel, 'createExpensesWithAssets')
                .callsFake((pool, items) => Promise.resolve(items.map((i, n) => ({ id: `x${n}`, ...i.expense }))));

            const req = {
                pool: {},
                params: { id: 'receipt-1' },
                body: { items: [
                    { category: 'machinery_purchase', amount: 5200, is_capital: true, asset_type: 'bogus-type' },
                ] },
                user: { userId: 'user-A', orgId: 'org-A', platformRole: 'user' },
            };
            const res = makeRes();

            await receiptController.createReceiptExpenses(req, res);

            const items = createBatch.firstCall.args[1];
            expect(items[0].asset).toEqual(expect.objectContaining({
                asset_type: 'plant_machinery',       // bogus value sanitised, never trusted raw
                acquired_date: '2026-02-01',         // falls back to the receipt date
            }));
            expect(res.status.calledWith(201)).toBe(true);
        });

        it('returns 404 when the receipt is not visible to the caller org', async () => {
            // out-of-org receipt -> org-scoped lookup returns null
            sinon.stub(receiptModel, 'getReceiptById').resolves(null);
            const createBatch = sinon.stub(expenseModel, 'createExpensesWithAssets').resolves([]);

            const req = {
                pool: {},
                params: { id: 'receipt-of-other-org' },
                body: { items: [{ category: 'meals', amount: 3.6 }] },
                user: { userId: 'user-A', orgId: 'org-A', platformRole: 'user' },
            };
            const res = makeRes();

            await receiptController.createReceiptExpenses(req, res);

            expect(res.status.calledWith(404)).toBe(true);
            expect(createBatch.notCalled).toBe(true);
        });

        it('rejects an item missing category/amount with 400', async () => {
            sinon.stub(receiptModel, 'getReceiptById').resolves({ id: 'receipt-1' });
            const createBatch = sinon.stub(expenseModel, 'createExpensesWithAssets').resolves([]);

            const req = {
                pool: {},
                params: { id: 'receipt-1' },
                body: { items: [{ amount: 3.6 }] }, // no category
                user: { userId: 'user-A', orgId: 'org-A', platformRole: 'user' },
            };
            const res = makeRes();

            await receiptController.createReceiptExpenses(req, res);

            expect(res.status.calledWith(400)).toBe(true);
            expect(createBatch.notCalled).toBe(true);
        });
    });

    describe('GET /receipts/:id tenant isolation', () => {
        it('passes the caller org id to the scoped lookup and 404s when not found', async () => {
            const getReceiptById = sinon.stub(receiptModel, 'getReceiptById').resolves(null);

            const req = {
                pool: {},
                params: { id: 'receipt-1' },
                user: { userId: 'user-A', orgId: 'org-A', platformRole: 'user' },
            };
            const res = makeRes();

            await receiptController.getReceipt(req, res);

            expect(getReceiptById.calledOnceWith(req.pool, 'receipt-1', 'org-A')).toBe(true);
            expect(res.status.calledWith(404)).toBe(true);
        });

        it('lets a super_admin bypass org scoping (orgId = null)', async () => {
            const getReceiptById = sinon.stub(receiptModel, 'getReceiptById').resolves({ id: 'receipt-1' });
            sinon.stub(expenseModel, 'getExpensesByReceiptId').resolves([]);

            const req = {
                pool: {},
                params: { id: 'receipt-1' },
                user: { userId: 'admin', orgId: 'org-A', platformRole: 'super_admin' },
            };
            const res = makeRes();

            await receiptController.getReceipt(req, res);

            expect(getReceiptById.calledOnceWith(req.pool, 'receipt-1', null)).toBe(true);
            expect(res.status.calledWith(200)).toBe(true);
        });
    });
});
