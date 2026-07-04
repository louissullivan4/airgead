/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const { expect } = require('@jest/globals');

const sageExportService = require('../src/services/sage/sageExportService');
const sageAuth = require('../src/services/sage/sageAuth');
const sageModel = require('../src/models/sageModel');
const expenseModel = require('../src/models/expenseModel');
const accountantLinkModel = require('../src/models/accountantLinkModel');
const taxSummaryService = require('../src/services/tax/taxSummaryService');
const sageController = require('../src/controllers/sageController');

const KEY = 'a'.repeat(64);

const SETTINGS = {
    sage_business_id: 'biz-1',
    bank_account_id: 'bank-1',
    expense_ledger_account_id: 'ledger-exp',
    income_ledger_account_id: 'ledger-inc',
    tax_rate_id: 'rate-1',
};

const expenseRow = (overrides = {}) => ({
    id: 'e1',
    title: 'Diesel',
    merchant_name: 'Circle K',
    category: 'fuel',
    amount: '84.30',
    tax_amount: '15.76',
    currency: 'EUR',
    created_at: '2026-03-14T09:30:00.000Z',
    ...overrides,
});

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });

const authedReq = (extra = {}) => ({
    pool: {},
    params: { clientOrgId: 'client-1' },
    query: {},
    body: {},
    user: { userId: 'u1', orgId: 'acc-org', orgRole: 'owner', platformRole: 'user' },
    ...extra,
});

const configureSage = () => {
    process.env.SAGE_CLIENT_ID = 'client-id';
    process.env.SAGE_CLIENT_SECRET = 'client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
};

const VALID_BODY = {
    year: 2026,
    businessId: 'biz-1',
    bankAccountId: 'bank-1',
    expenseLedgerAccountId: 'ledger-exp',
    incomeLedgerAccountId: 'ledger-inc',
};

afterEach(() => {
    sinon.restore();
    delete process.env.SAGE_ENABLED;
    delete process.env.SAGE_CLIENT_ID;
    delete process.env.SAGE_CLIENT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;
});

describe('payload mapping', () => {
    it('maps an expense row to a Sage other_payment', () => {
        const payload = sageExportService.buildOtherPaymentPayload(expenseRow(), SETTINGS);
        expect(payload).toEqual({
            other_payment: {
                transaction_type_id: 'OTHER_PAYMENT',
                bank_account_id: 'bank-1',
                date: '2026-03-14',
                total_amount: 84.3,
                reference: 'airgead:e1',
                payment_lines: [{
                    ledger_account_id: 'ledger-exp',
                    details: 'Diesel - Circle K',
                    total_amount: 84.3,
                    tax_rate_id: 'rate-1',
                    tax_amount: 15.76,
                }],
            },
        });
    });

    it('flags capital expenses in the line details', () => {
        const payload = sageExportService.buildOtherPaymentPayload(expenseRow(), SETTINGS, true);
        expect(payload.other_payment.payment_lines[0].details).toBe('Diesel - Circle K [Capital]');
    });

    it('maps an income row to an other_receipt on the income ledger', () => {
        const payload = sageExportService.buildOtherReceiptPayload(
            expenseRow({ id: 'i1', title: 'Livery fees', category: 'income', merchant_name: null }),
            SETTINGS
        );
        expect(payload.other_receipt.transaction_type_id).toBe('OTHER_RECEIPT');
        expect(payload.other_receipt.payment_lines[0].ledger_account_id).toBe('ledger-inc');
        expect(payload.other_receipt.payment_lines[0].details).toBe('Livery fees');
    });

    it('handles null tax/merchant, string numerics, and non-EUR currency', () => {
        const payload = sageExportService.buildOtherPaymentPayload(
            expenseRow({ merchant_name: null, tax_amount: null, amount: '12.005', currency: 'GBP' }),
            { ...SETTINGS, tax_rate_id: null }
        );
        const line = payload.other_payment.payment_lines[0];
        expect(payload.other_payment.total_amount).toBe(12.01);
        expect(line.tax_amount).toBe(0);
        expect(line.tax_rate_id).toBeUndefined();
        expect(line.details).toBe('Diesel (GBP)');
    });
});

describe('exportToSage orchestration', () => {
    beforeEach(() => {
        sinon.stub(sageExportService, 'sleep').resolves();
        sinon.stub(taxSummaryService, 'buildTaxSummary').resolves({ capitalExpenseIds: [] });
    });

    const run = () => sageExportService.exportToSage({}, {
        accountantOrgId: 'acc-org', clientOrgId: 'client-1', userId: 'u1', year: 2026, settings: SETTINGS,
    });

    it('splits income from expenses and records each success with its resource type', async () => {
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([
            expenseRow({ id: 'e1' }),
            expenseRow({ id: 'e2', title: 'Feed' }),
            expenseRow({ id: 'i1', title: 'Sales', category: 'income' }),
        ]);
        sinon.stub(sageModel, 'getExportedExpenseIds').resolves([]);
        const record = sinon.stub(sageModel, 'recordExportedExpense').resolves();
        const authed = sinon.stub(sageAuth, 'authedRequest').resolves({ id: 'sage-id' });

        const summary = await run();

        expect(summary).toEqual({ total: 3, created: 3, skipped: 0, failed: 0, failures: [] });
        const paths = authed.getCalls().map((c) => c.args[2].path);
        expect(paths.filter((p) => p === '/other_payments')).toHaveLength(2);
        expect(paths.filter((p) => p === '/other_receipts')).toHaveLength(1);
        // The practice org owns the connection, never the client.
        expect(authed.getCalls().every((c) => c.args[1] === 'acc-org')).toBe(true);
        const types = record.getCalls().map((c) => c.args[1].resourceType);
        expect(types.sort()).toEqual(['other_payment', 'other_payment', 'other_receipt']);
    });

    it('skips rows already exported to the same Sage business', async () => {
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([
            expenseRow({ id: 'e1' }),
            expenseRow({ id: 'e2' }),
        ]);
        sinon.stub(sageModel, 'getExportedExpenseIds').resolves(['e1']);
        sinon.stub(sageModel, 'recordExportedExpense').resolves();
        const authed = sinon.stub(sageAuth, 'authedRequest').resolves({ id: 'sage-id' });

        const summary = await run();

        expect(summary.skipped).toBe(1);
        expect(summary.created).toBe(1);
        expect(authed.calledOnce).toBe(true);
        expect(authed.firstCall.args[2].data.other_payment.reference).toBe('airgead:e2');
    });

    it('collects a single row failure and keeps going (no ledger record for it)', async () => {
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([
            expenseRow({ id: 'e1' }),
            expenseRow({ id: 'e2', title: 'Rejected' }),
            expenseRow({ id: 'e3' }),
        ]);
        sinon.stub(sageModel, 'getExportedExpenseIds').resolves([]);
        const record = sinon.stub(sageModel, 'recordExportedExpense').resolves();
        const authed = sinon.stub(sageAuth, 'authedRequest');
        authed.resolves({ id: 'sage-id' });
        authed.onSecondCall().rejects(Object.assign(new Error('Validation failed'), { status: 422 }));

        const summary = await run();

        expect(summary).toEqual(expect.objectContaining({ created: 2, failed: 1 }));
        expect(summary.failures).toEqual([{ expenseId: 'e2', title: 'Rejected', error: 'Validation failed' }]);
        expect(record.getCalls().map((c) => c.args[1].expenseId).sort()).toEqual(['e1', 'e3']);
    });

    it('a dead connection aborts the remaining rows', async () => {
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([
            expenseRow({ id: 'e1' }),
            expenseRow({ id: 'e2' }),
            expenseRow({ id: 'e3' }),
        ]);
        sinon.stub(sageModel, 'getExportedExpenseIds').resolves([]);
        sinon.stub(sageModel, 'recordExportedExpense').resolves();
        const authed = sinon.stub(sageAuth, 'authedRequest');
        authed.onFirstCall().resolves({ id: 'sage-id' });
        authed.onSecondCall().rejects(new sageAuth.SageReconnectError());

        await expect(run()).rejects.toBeInstanceOf(sageAuth.SageReconnectError);
        expect(authed.callCount).toBe(2);
    });

    it('a tax-summary failure is swallowed - the export just loses capital markers', async () => {
        taxSummaryService.buildTaxSummary.restore();
        sinon.stub(taxSummaryService, 'buildTaxSummary').rejects(new Error('summary broke'));
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([expenseRow()]);
        sinon.stub(sageModel, 'getExportedExpenseIds').resolves([]);
        sinon.stub(sageModel, 'recordExportedExpense').resolves();
        const authed = sinon.stub(sageAuth, 'authedRequest').resolves({ id: 'sage-id' });

        const summary = await run();

        expect(summary.created).toBe(1);
        expect(authed.firstCall.args[2].data.other_payment.payment_lines[0].details).not.toContain('[Capital]');
    });

    it('refuses a year larger than the per-run cap before posting anything', async () => {
        const rows = Array.from({ length: sageExportService.MAX_EXPORT_ROWS + 1 }, (_, i) =>
            expenseRow({ id: `e${i}` }));
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves(rows);
        const authed = sinon.stub(sageAuth, 'authedRequest');

        await expect(run()).rejects.toBeInstanceOf(sageExportService.SageExportTooLargeError);
        expect(authed.notCalled).toBe(true);
    });
});

describe('POST /accountant/clients/:clientOrgId/sage-export', () => {
    it('403s an UNLINKED client and never starts the export', async () => {
        configureSage();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves(null);
        const exportStub = sinon.stub(sageExportService, 'exportToSage');
        const res = makeRes();
        await sageController.exportClientToSage(authedReq({ body: VALID_BODY }), res);
        expect(res.status.calledWith(403)).toBe(true);
        expect(exportStub.notCalled).toBe(true);
    });

    it("403s a member accountant on another member's client", async () => {
        configureSage();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ created_by: 'someone-else' });
        const exportStub = sinon.stub(sageExportService, 'exportToSage');
        const res = makeRes();
        const req = authedReq({ body: VALID_BODY });
        req.user.orgRole = 'member';
        await sageController.exportClientToSage(req, res);
        expect(res.status.calledWith(403)).toBe(true);
        expect(exportStub.notCalled).toBe(true);
    });

    it('502s when Sage is unconfigured, before any DB work', async () => {
        const gate = sinon.stub(accountantLinkModel, 'getActiveLink');
        const res = makeRes();
        await sageController.exportClientToSage(authedReq({ body: VALID_BODY }), res);
        expect(res.status.calledWith(502)).toBe(true);
        expect(gate.notCalled).toBe(true);
    });

    it('400s when required mapping fields are missing', async () => {
        configureSage();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ created_by: 'u1' });
        const res = makeRes();
        await sageController.exportClientToSage(authedReq({ body: { year: 2026 } }), res);
        expect(res.status.calledWith(400)).toBe(true);
    });

    it('409s with sage_not_connected when the practice has no connection', async () => {
        configureSage();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ created_by: 'u1' });
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves(null);
        const res = makeRes();
        await sageController.exportClientToSage(authedReq({ body: VALID_BODY }), res);
        expect(res.status.calledWith(409)).toBe(true);
        expect(res.json.firstCall.args[0].code).toBe('sage_not_connected');
    });

    it('happy path: remembers the mapping for the practice+client and returns the summary', async () => {
        configureSage();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ created_by: 'u1' });
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves({ status: 'active' });
        const upsert = sinon.stub(sageModel, 'upsertExportSettings').resolves(SETTINGS);
        const summary = { total: 2, created: 2, skipped: 0, failed: 0, failures: [] };
        const exportStub = sinon.stub(sageExportService, 'exportToSage').resolves(summary);
        const res = makeRes();
        await sageController.exportClientToSage(authedReq({ body: { ...VALID_BODY, taxRateId: 'rate-1' } }), res);

        expect(upsert.firstCall.args[1]).toEqual(expect.objectContaining({
            accountantOrgId: 'acc-org',
            clientOrgId: 'client-1',
            sageBusinessId: 'biz-1',
            taxRateId: 'rate-1',
            updatedBy: 'u1',
        }));
        expect(exportStub.firstCall.args[1]).toEqual(expect.objectContaining({
            accountantOrgId: 'acc-org', clientOrgId: 'client-1', year: 2026, settings: SETTINGS,
        }));
        expect(res.status.calledWith(200)).toBe(true);
        expect(res.json.firstCall.args[0]).toEqual(summary);
    });

    it('maps a reconnect failure to 409 sage_reconnect_required', async () => {
        configureSage();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ created_by: 'u1' });
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves({ status: 'expired' });
        sinon.stub(sageModel, 'upsertExportSettings').resolves(SETTINGS);
        sinon.stub(sageExportService, 'exportToSage').rejects(new sageAuth.SageReconnectError());
        const res = makeRes();
        await sageController.exportClientToSage(authedReq({ body: VALID_BODY }), res);
        expect(res.status.calledWith(409)).toBe(true);
        expect(res.json.firstCall.args[0].code).toBe('sage_reconnect_required');
    });

    it('maps a too-large year to 422', async () => {
        configureSage();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ created_by: 'u1' });
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves({ status: 'active' });
        sinon.stub(sageModel, 'upsertExportSettings').resolves(SETTINGS);
        sinon.stub(sageExportService, 'exportToSage').rejects(new sageExportService.SageExportTooLargeError(3000));
        const res = makeRes();
        await sageController.exportClientToSage(authedReq({ body: VALID_BODY }), res);
        expect(res.status.calledWith(422)).toBe(true);
    });
});

describe('GET /accountant/clients/:clientOrgId/sage-settings', () => {
    it('enforces the client link gate', async () => {
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves(null);
        const settings = sinon.stub(sageModel, 'getExportSettings');
        const res = makeRes();
        await sageController.getClientSageSettings(authedReq(), res);
        expect(res.status.calledWith(403)).toBe(true);
        expect(settings.notCalled).toBe(true);
    });

    it('returns the remembered mapping and connection state', async () => {
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ created_by: 'u1' });
        sinon.stub(sageModel, 'getExportSettings').resolves(SETTINGS);
        sinon.stub(sageModel, 'getConnectionByOrgId').resolves({ status: 'active' });
        const res = makeRes();
        await sageController.getClientSageSettings(authedReq(), res);
        expect(res.json.firstCall.args[0]).toEqual({ settings: SETTINGS, connected: true });
    });
});
