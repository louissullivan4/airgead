const expenseModel = require('../../models/expenseModel');
const assetModel = require('../../models/assetModel');
const organisationModel = require('../../models/organisationModel');
const { getTemplateFor } = require('../../config/categoryTemplates');
const { scheduleForYear } = require('./wearAndTear');
const { bucketise } = require('./form11');
const { vatSummary } = require('./vat');

// Assembles the year's full tax picture for one org. This single shape powers
// the trader's Tax summary page, the accountant's client Tax summary tab, and
// the extra sheets in the Excel export — one computation, three surfaces.
//
// Correctness rule that everything downstream leans on: an expense linked to an
// asset-register row is CAPITAL — excluded from the revenue category totals and
// Form 11 buckets (it is claimed through wear & tear instead), and totalled
// separately as capital expenditure.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNumber = (v) => Number(v) || 0;

// slug → label lookup across both sides of the org's category tree.
const buildLabelIndex = (tree) => {
    const labels = new Map();
    const walk = (nodes) =>
        (nodes || []).forEach((n) => {
            labels.set(n.slug, n.label);
            walk(n.children);
        });
    walk(tree && tree.expense);
    walk(tree && tree.income);
    return (slug) => labels.get(slug) || slug;
};

const buildTaxSummary = async (pool, orgId, year) => {
    const taxYear = parseInt(year, 10);

    const [org, expenses, assets] = await Promise.all([
        organisationModel.getOrgById(pool, orgId),
        expenseModel.getExpensesByOrgIdAndYear(pool, orgId, taxYear),
        assetModel.getAssetsByOrgId(pool, orgId),
    ]);
    if (!org) return null;

    const tree = org.categories || getTemplateFor(org.org_category);
    const labelOf = buildLabelIndex(tree);

    const capitalExpenseIds = new Set(
        assets.filter((a) => a.expense_id).map((a) => a.expense_id)
    );

    const incomeRows = [];
    const revenueRows = [];
    const capitalRows = [];
    for (const e of expenses) {
        if (e.category === 'income') incomeRows.push(e);
        else if (capitalExpenseIds.has(e.id)) capitalRows.push(e);
        else revenueRows.push(e);
    }

    const sum = (rows) => round2(rows.reduce((acc, e) => acc + toNumber(e.amount), 0));

    // Revenue expenses by category (descending) for the breakdown table.
    const byCategoryMap = new Map();
    for (const e of revenueRows) {
        const entry = byCategoryMap.get(e.category) || { slug: e.category, total: 0, count: 0 };
        entry.total = round2(entry.total + toNumber(e.amount));
        entry.count += 1;
        byCategoryMap.set(e.category, entry);
    }
    const byCategory = [...byCategoryMap.values()]
        .map((c) => ({ ...c, label: labelOf(c.slug) }))
        .sort((a, b) => b.total - a.total);

    const capitalAllowances = scheduleForYear(assets, taxYear);

    const income = sum(incomeRows);
    const revenueExpenses = sum(revenueRows);
    const wearAndTear = capitalAllowances.totals.allowance;

    return {
        year: taxYear,
        orgId: org.id,
        orgName: org.name,
        orgCategory: org.org_category,
        vatStatus: org.vat_status || 'not_registered',
        totals: {
            income,
            revenueExpenses,
            // Capital spend CAPTURED this year (the schedule also carries prior
            // years' assets still being written off).
            capitalExpenditure: sum(capitalRows),
            wearAndTear,
            // Honest label: profit before the adjustments only an accountant
            // makes (add-backs, losses forward, private-use splits…).
            netBeforeAdjustments: round2(income - revenueExpenses - wearAndTear),
        },
        counts: {
            transactions: expenses.length,
            income: incomeRows.length,
            revenue: revenueRows.length,
            capital: capitalRows.length,
            assets: assets.length,
        },
        byCategory,
        form11: bucketise(revenueRows, labelOf),
        capitalAllowances,
        vat: vatSummary({ vatStatus: org.vat_status, expenses, year: taxYear, tree }),
        // The export marks these transaction rows as capital.
        capitalExpenseIds: [...capitalExpenseIds],
    };
};

module.exports = { buildTaxSummary };
