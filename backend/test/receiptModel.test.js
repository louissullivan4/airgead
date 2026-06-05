/* eslint-disable no-undef */
const sinon = require('sinon');
const { expect } = require('@jest/globals');

const receiptModel = require('../src/models/receiptModel');
const expenseModel = require('../src/models/expenseModel');

// A fake pg pool whose query() we can inspect. Returns an empty result by default.
const makePool = (rows = []) => ({ query: sinon.stub().resolves({ rows, rowCount: rows.length }) });

describe('receiptModel / expenseModel org scoping', () => {
  afterEach(() => sinon.restore());

  describe('getReceiptById', () => {
    it('scopes to the org via the user -> org subquery when orgId is given', async () => {
      const pool = makePool([]);
      await receiptModel.getReceiptById(pool, 'receipt-1', 'org-A');

      const [sql, values] = pool.query.firstCall.args;
      expect(sql).toContain('user_id IN (SELECT id FROM users WHERE org_id = $2)');
      expect(values).toEqual(['receipt-1', 'org-A']);
    });

    it('does not scope when orgId is null (super_admin bypass)', async () => {
      const pool = makePool([]);
      await receiptModel.getReceiptById(pool, 'receipt-1', null);

      const [sql, values] = pool.query.firstCall.args;
      expect(sql).not.toContain('org_id');
      expect(values).toEqual(['receipt-1']);
    });

    it('returns null when the scoped query finds nothing', async () => {
      const pool = makePool([]);
      const result = await receiptModel.getReceiptById(pool, 'receipt-1', 'org-A');
      expect(result).toBeNull();
    });
  });

  describe('createReceipt', () => {
    it('defaults receipt_status to reviewed for the manual flow', async () => {
      const pool = makePool([{ id: 'r1' }]);
      await receiptModel.createReceipt(pool, {
        user_id: 'user-A',
        image_object_path: 'org_org-A/2026/r1.png',
      });

      const [, values] = pool.query.firstCall.args;
      // values: [user_id, image_object_path, parsed_data, ocr_confidence, receipt_status, ...]
      expect(values[1]).toBe('org_org-A/2026/r1.png');
      expect(values[4]).toBe('reviewed');
      expect(values[2]).toBeUndefined(); // parsed_data stays unset (dormant OCR)
    });
  });

  describe('getExpensesByReceiptId', () => {
    it('filters by receipt_id and stays org-scoped', async () => {
      const pool = makePool([{ id: 'e1', receipt_id: 'r1' }]);
      await expenseModel.getExpensesByReceiptId(pool, 'r1', 'org-A');

      const [sql, values] = pool.query.firstCall.args;
      expect(sql).toContain('WHERE receipt_id = $1');
      expect(sql).toContain('user_id IN (SELECT id FROM users WHERE org_id = $2)');
      expect(values).toEqual(['r1', 'org-A']);
    });
  });

  describe('createExpense with receipt linkage', () => {
    it('persists receipt_id, merchant_name and tax_amount', async () => {
      const pool = makePool([{ id: 'e1' }]);
      await expenseModel.createExpense(pool, {
        user_id: 'user-A',
        title: 'Coffee',
        category: 'meals',
        amount: 3.5,
        currency: 'EUR',
        receipt_id: 'r1',
        merchant_name: 'Cafe Nero',
        tax_amount: 0.5,
      });

      const [sql, values] = pool.query.firstCall.args;
      expect(sql).toContain('receipt_id');
      expect(sql).toContain('merchant_name');
      expect(sql).toContain('tax_amount');
      // appended in order after receipt_image_url ($7): receipt_id $8, merchant_name $9, tax_amount $10
      expect(values[7]).toBe('r1');
      expect(values[8]).toBe('Cafe Nero');
      expect(values[9]).toBe(0.5);
    });

    it('stores a null receipt_id for the skip-photo / manual path', async () => {
      const pool = makePool([{ id: 'e1' }]);
      await expenseModel.createExpense(pool, {
        user_id: 'user-A',
        title: 'Manual entry',
        category: 'office',
        amount: 12,
        currency: 'EUR',
      });

      const [, values] = pool.query.firstCall.args;
      expect(values[7]).toBeNull(); // receipt_id
      expect(values[8]).toBeNull(); // merchant_name
      expect(values[9]).toBeNull(); // tax_amount
    });
  });
});
