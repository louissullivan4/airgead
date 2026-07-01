/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const { expect } = require('@jest/globals');

const assetModel = require('../src/models/assetModel');
const expenseModel = require('../src/models/expenseModel');
const assetController = require('../src/controllers/assetController');
const expenseController = require('../src/controllers/expenseController');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });

describe('assetModel tenant scoping (orgPredicate)', () => {
    afterEach(() => sinon.restore());

    it('getAssetById includes the user→org subquery and the org param', async () => {
        const pool = { query: sinon.stub().resolves({ rows: [] }) };
        await assetModel.getAssetById(pool, 'asset-1', 'org-A');
        const [sql, values] = pool.query.firstCall.args;
        expect(sql).toMatch(/user_id IN \(SELECT id FROM users WHERE org_id = \$2\)/);
        expect(values).toEqual(['asset-1', 'org-A']);
    });

    it('super_admin bypass (orgId null) omits the org predicate', async () => {
        const pool = { query: sinon.stub().resolves({ rows: [] }) };
        await assetModel.getAssetById(pool, 'asset-1', null);
        const [sql, values] = pool.query.firstCall.args;
        expect(sql).not.toMatch(/org_id/);
        expect(values).toEqual(['asset-1']);
    });

    it('deleteAsset is org-scoped', async () => {
        const pool = { query: sinon.stub().resolves({ rowCount: 0 }) };
        await assetModel.deleteAsset(pool, 'asset-1', 'org-A');
        const [sql, values] = pool.query.firstCall.args;
        expect(sql).toMatch(/DELETE FROM assets WHERE id = \$1 AND user_id IN/);
        expect(values).toEqual(['asset-1', 'org-A']);
    });

    it('updateAsset only touches whitelisted columns and stays org-scoped', async () => {
        const pool = { query: sinon.stub().resolves({ rows: [{ id: 'asset-1' }] }) };
        await assetModel.updateAsset(pool, 'asset-1', { cost: 900, nefarious: 'x' }, 'org-A');
        const [sql, values] = pool.query.firstCall.args;
        expect(sql).toMatch(/SET cost = \$2/);
        expect(sql).not.toMatch(/nefarious/);
        expect(values).toEqual(['asset-1', 900, 'org-A']);
    });
});

describe('createExpensesWithAssets (one transaction)', () => {
    afterEach(() => sinon.restore());

    const makeClient = () => ({
        query: sinon.stub().callsFake((sql) => {
            if (/INSERT INTO expenses/i.test(sql)) {
                return Promise.resolve({ rows: [{ id: 'exp-1', user_id: 'u1', title: 'Chainsaw', category: 'tools_equipment', amount: 400, currency: 'EUR', created_at: '2026-01-05' }] });
            }
            return Promise.resolve({ rows: [{}] });
        }),
        release: sinon.stub(),
    });

    it('writes the expense AND the asset inside BEGIN/COMMIT', async () => {
        const client = makeClient();
        const pool = { connect: sinon.stub().resolves(client) };

        const created = await expenseModel.createExpensesWithAssets(pool, [{
            expense: { user_id: 'u1', title: 'Chainsaw', category: 'tools_equipment', amount: 400, currency: 'EUR' },
            asset: { asset_type: 'plant_machinery' },
        }]);

        const sqls = client.query.getCalls().map((c) => c.args[0]);
        expect(sqls[0]).toBe('BEGIN');
        expect(sqls.some((s) => /INSERT INTO expenses/i.test(s))).toBe(true);
        expect(sqls.some((s) => /INSERT INTO assets/i.test(s))).toBe(true);
        expect(sqls[sqls.length - 1]).toBe('COMMIT');
        expect(created).toHaveLength(1);

        // the asset row inherits the expense's linkage + financials
        const assetCall = client.query.getCalls().find((c) => /INSERT INTO assets/i.test(c.args[0]));
        expect(assetCall.args[1][0]).toBe('u1');     // user_id
        expect(assetCall.args[1][1]).toBe('exp-1');  // expense_id
        expect(assetCall.args[1][5]).toBe(400);      // cost follows the amount
    });

    it('ROLLBACKs everything when any write fails', async () => {
        const client = {
            query: sinon.stub().callsFake((sql) => {
                if (/INSERT INTO assets/i.test(sql)) return Promise.reject(new Error('boom'));
                if (/INSERT INTO expenses/i.test(sql)) return Promise.resolve({ rows: [{ id: 'exp-1', user_id: 'u1', amount: 400 }] });
                return Promise.resolve({ rows: [] });
            }),
            release: sinon.stub(),
        };
        const pool = { connect: sinon.stub().resolves(client) };

        await expect(expenseModel.createExpensesWithAssets(pool, [{
            expense: { user_id: 'u1', title: 'X', category: 'tools_equipment', amount: 400, currency: 'EUR' },
            asset: { asset_type: 'plant_machinery' },
        }])).rejects.toThrow('boom');

        const sqls = client.query.getCalls().map((c) => c.args[0]);
        expect(sqls).toContain('ROLLBACK');
        expect(sqls).not.toContain('COMMIT');
        expect(client.release.calledOnce).toBe(true);
    });
});

describe('PATCH /expenses/:id capital tri-state (syncCapitalFlag)', () => {
    afterEach(() => sinon.restore());

    const baseReq = (body) => ({
        pool: {},
        params: { id: 'exp-1' },
        headers: { authorization: 'Bearer t' },
        body: { title: 'Chainsaw', category: 'tools_equipment', amount: 400, currency: 'EUR', ...body },
        user: { userId: 'u1', orgId: 'org-A', role: 'user', platformRole: 'user' },
    });
    const existing = { id: 'exp-1', user_id: 'u1', title: 'Chainsaw', category: 'tools_equipment', amount: 400, currency: 'EUR', created_at: '2026-01-05' };

    it('is_capital:false deletes the linked asset', async () => {
        sinon.stub(expenseModel, 'getExpenseById').resolves(existing);
        sinon.stub(expenseModel, 'partialUpdateExpense').resolves(existing);
        const del = sinon.stub(assetModel, 'deleteAssetByExpenseId').resolves(1);

        await expenseController.partialUpdateExpense(baseReq({ is_capital: false }), makeRes());

        expect(del.calledOnceWith(sinon.match.any, 'exp-1', 'org-A')).toBe(true);
    });

    it('is_capital:true creates the asset when none exists yet', async () => {
        sinon.stub(expenseModel, 'getExpenseById').resolves(existing);
        sinon.stub(expenseModel, 'partialUpdateExpense').resolves(existing);
        sinon.stub(assetModel, 'getAssetByExpenseId').resolves(null);
        const create = sinon.stub(assetModel, 'createAsset').resolves({ id: 'a1' });

        await expenseController.partialUpdateExpense(baseReq({ is_capital: true, asset_type: 'motor_vehicle' }), makeRes());

        expect(create.calledOnce).toBe(true);
        expect(create.firstCall.args[1]).toEqual(expect.objectContaining({
            expense_id: 'exp-1',
            asset_type: 'motor_vehicle',
            cost: 400,
        }));
    });

    it('is_capital:true updates the existing asset so it follows the expense', async () => {
        sinon.stub(expenseModel, 'getExpenseById').resolves(existing);
        sinon.stub(expenseModel, 'partialUpdateExpense').resolves({ ...existing, amount: 950 });
        sinon.stub(assetModel, 'getAssetByExpenseId').resolves({ id: 'a1', description: 'Chainsaw', asset_type: 'plant_machinery' });
        const update = sinon.stub(assetModel, 'updateAsset').resolves({ id: 'a1' });

        await expenseController.partialUpdateExpense(baseReq({ is_capital: true }), makeRes());

        expect(update.calledOnce).toBe(true);
        expect(update.firstCall.args[2]).toEqual(expect.objectContaining({ cost: 950 }));
    });

    it('omitted is_capital leaves the register alone', async () => {
        sinon.stub(expenseModel, 'getExpenseById').resolves(existing);
        sinon.stub(expenseModel, 'partialUpdateExpense').resolves(existing);
        const del = sinon.stub(assetModel, 'deleteAssetByExpenseId').resolves(1);
        const get = sinon.stub(assetModel, 'getAssetByExpenseId').resolves(null);

        await expenseController.partialUpdateExpense(baseReq({}), makeRes());

        expect(del.notCalled).toBe(true);
        expect(get.notCalled).toBe(true);
    });
});

describe('assetController validation + scoping', () => {
    afterEach(() => sinon.restore());

    const reqFor = (body = {}, params = {}, query = {}) => ({
        pool: {},
        body,
        params,
        query,
        user: { userId: 'u1', orgId: 'org-A', platformRole: 'user' },
    });

    it('GET /assets returns the register with a computed schedule for the year', async () => {
        sinon.stub(assetModel, 'getAssetsByOrgId').resolves([{
            id: 'a1', description: 'Tractor', asset_type: 'plant_machinery',
            cost: '8000', acquired_date: '2025-01-01',
        }]);
        const res = makeRes();
        await assetController.listAssets(reqFor({}, {}, { year: '2025' }), res);

        expect(res.status.calledWith(200)).toBe(true);
        const payload = res.json.firstCall.args[0];
        expect(payload.year).toBe(2025);
        expect(payload.schedule.rows[0].allowance).toBe(1000);
    });

    it('POST /assets rejects a bad asset_type / non-positive cost', async () => {
        const create = sinon.stub(assetModel, 'createAsset').resolves({});
        let res = makeRes();
        await assetController.createAsset(reqFor({ description: 'Car', cost: 9000, asset_type: 'yacht' }), res);
        expect(res.status.calledWith(400)).toBe(true);

        res = makeRes();
        await assetController.createAsset(reqFor({ description: 'Car', cost: 0 }), res);
        expect(res.status.calledWith(400)).toBe(true);

        expect(create.notCalled).toBe(true);
    });

    it('PATCH /assets/:id 404s when the row is out of the caller org (model returns null)', async () => {
        sinon.stub(assetModel, 'updateAsset').resolves(null);
        const res = makeRes();
        await assetController.updateAsset(reqFor({ cost: 500 }, { id: 'other-org-asset' }), res);
        expect(res.status.calledWith(404)).toBe(true);
    });
});
