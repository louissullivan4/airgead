/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const { expect } = require('@jest/globals');

const organisationModel = require('../src/models/organisationModel');
const expenseModel = require('../src/models/expenseModel');
const assetModel = require('../src/models/assetModel');
const accountantLinkModel = require('../src/models/accountantLinkModel');
const { buildTaxSummary } = require('../src/services/tax/taxSummaryService');
const reportController = require('../src/controllers/reportController');
const accountantController = require('../src/controllers/accountantController');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });

describe('buildTaxSummary', () => {
    afterEach(() => sinon.restore());

    const stubData = () => {
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-C', name: 'Galway Equine', org_category: 'sole_trader_equine',
            vat_status: 'flat_rate_farmer', categories: null,
        });
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([
            { id: 'i1', category: 'income', amount: '2000', tax_amount: null },
            { id: 'e1', category: 'feed_bedding', amount: '540', tax_amount: '62' },
            { id: 'e2', category: 'tack_equipment', amount: '8400', tax_amount: null }, // capital-linked
        ]);
        sinon.stub(assetModel, 'getAssetsByOrgId').resolves([
            { id: 'a1', expense_id: 'e2', description: 'Horsebox', asset_type: 'plant_machinery', cost: '8400', acquired_date: '2026-02-01' },
        ]);
    };

    it('excludes capital-linked expenses from revenue totals and claims them via wear & tear', async () => {
        stubData();
        const summary = await buildTaxSummary({}, 'org-C', 2026);

        expect(summary.totals.income).toBe(2000);
        expect(summary.totals.revenueExpenses).toBe(540);       // horsebox NOT here
        expect(summary.totals.capitalExpenditure).toBe(8400);   // …it is here
        expect(summary.totals.wearAndTear).toBe(1050);          // 8400 × 12.5%
        expect(summary.totals.netBeforeAdjustments).toBe(2000 - 540 - 1050);

        // form11 buckets are revenue-only too
        const all = summary.form11.reduce((s, b) => s + b.total, 0);
        expect(all).toBe(540);

        // labels resolved from the org's template (no stored tree)
        expect(summary.byCategory[0]).toEqual(expect.objectContaining({ slug: 'feed_bedding', label: 'Feed & Bedding' }));

        // VAT: flat-rate farmer with the 2026 fallback rate
        expect(summary.vat.flatRateAddition).toBe(0.051);
        expect(summary.capitalExpenseIds).toEqual(['e2']);
    });

    it('returns null for an unknown org (controller turns it into a 404)', async () => {
        sinon.stub(organisationModel, 'getOrgById').resolves(null);
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([]);
        sinon.stub(assetModel, 'getAssetsByOrgId').resolves([]);
        expect(await buildTaxSummary({}, 'nope', 2026)).toBeNull();
    });
});

describe('GET /reports/tax-summary (own org only)', () => {
    afterEach(() => sinon.restore());

    it("always reports on the TOKEN's org — a query param cannot redirect it", async () => {
        const getOrg = sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'org-A', name: 'Own Org', org_category: 'personal', vat_status: 'not_registered', categories: null,
        });
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([]);
        sinon.stub(assetModel, 'getAssetsByOrgId').resolves([]);

        const req = {
            pool: {},
            query: { year: '2026', orgId: 'org-B' }, // hostile extra param, ignored
            user: { userId: 'u1', orgId: 'org-A', platformRole: 'user' },
        };
        const res = makeRes();
        await reportController.getTaxSummary(req, res);

        expect(getOrg.calledWith(sinon.match.any, 'org-A')).toBe(true);
        expect(res.status.calledWith(200)).toBe(true);
    });
});

describe('GET /accountant/clients/:clientOrgId/tax-summary (link-gated)', () => {
    afterEach(() => sinon.restore());

    const reqFor = (clientOrgId, platformRole = 'user') => ({
        pool: {},
        params: { clientOrgId },
        query: { year: '2026' },
        user: { userId: 'acc-user', orgId: 'acc-org', orgRole: 'owner', platformRole },
    });

    it('403s an UNLINKED client and never reaches the data layer', async () => {
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves(null);
        const getOrg = sinon.stub(organisationModel, 'getOrgById').resolves({});
        const res = makeRes();

        await accountantController.getClientTaxSummary(reqFor('client-x'), res);

        expect(res.status.calledWith(403)).toBe(true);
        expect(getOrg.notCalled).toBe(true);
    });

    it('returns the summary for an actively linked client', async () => {
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ id: 'l1', status: 'active', created_by: 'acc-user' });
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'client-1', name: 'Client', org_category: 'retail', vat_status: 'registered', categories: null,
        });
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([]);
        sinon.stub(assetModel, 'getAssetsByOrgId').resolves([]);
        const res = makeRes();

        await accountantController.getClientTaxSummary(reqFor('client-1'), res);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.json.firstCall.args[0]).toEqual(expect.objectContaining({ orgId: 'client-1', year: 2026 }));
    });

    it('lets a super_admin through without a link', async () => {
        const linkCheck = sinon.stub(accountantLinkModel, 'getActiveLink').resolves(null);
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'any-org', name: 'Any', org_category: 'other', vat_status: 'not_registered', categories: null,
        });
        sinon.stub(expenseModel, 'getExpensesByOrgIdAndYear').resolves([]);
        sinon.stub(assetModel, 'getAssetsByOrgId').resolves([]);
        const res = makeRes();

        await accountantController.getClientTaxSummary(reqFor('any-org', 'super_admin'), res);

        expect(linkCheck.notCalled).toBe(true);
        expect(res.status.calledWith(200)).toBe(true);
    });
});
