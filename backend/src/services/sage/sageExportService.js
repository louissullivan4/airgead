const expenseModel = require('../../models/expenseModel');
const sageModel = require('../../models/sageModel');
const sageAuth = require('./sageAuth');
const taxSummaryService = require('../tax/taxSummaryService');
const logger = require('../../utils/logger');

// Maps a client's expense rows onto Sage Business Cloud transactions and
// pushes them one at a time (Sage has no batch endpoint). Expenses become
// `other_payments` (an expense without a supplier invoice - no contact
// needed); income rows (category === 'income') become `other_receipts`.
// Idempotency: an expense already recorded in sage_exported_expenses for the
// target Sage business is skipped, so re-exports only send what's new.

// Sage allows ~100 requests/min and 2,500/day per company. 650ms between
// posts keeps us near 92/min; the row cap keeps one export inside the daily
// budget with room for lookups and retries.
const MAX_EXPORT_ROWS = 2000;
const POST_INTERVAL_MS = 650;

// Thrown when a year holds more rows than one export may send - the
// controller maps this to 422.
class SageExportTooLargeError extends Error {
    constructor(count) {
        super(`Export of ${count} transactions exceeds the per-run limit of ${MAX_EXPORT_ROWS} (Sage allows 2,500 API calls per day).`);
        this.name = 'SageExportTooLargeError';
        this.count = count;
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toIsoDate = (value) => new Date(value).toISOString().slice(0, 10);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Line description: "title - merchant", flagged when the expense sits on the
// asset register (capital items are claimed via wear & tear, not as revenue
// expenses - the accountant needs to see that in Sage) and carrying the
// original currency when it isn't EUR (v1 exports amounts as-is).
const lineDetails = (expense, isCapital) => {
    const parts = [expense.title, expense.merchant_name].filter(Boolean);
    let details = parts.join(' - ') || 'Expense';
    if (isCapital) details += ' [Capital]';
    if (expense.currency && expense.currency !== 'EUR') details += ` (${expense.currency})`;
    return details;
};

const buildLine = (expense, ledgerAccountId, settings, isCapital) => ({
    ledger_account_id: ledgerAccountId,
    details: lineDetails(expense, isCapital),
    total_amount: round2(expense.amount),
    ...(settings.tax_rate_id ? { tax_rate_id: settings.tax_rate_id } : {}),
    tax_amount: round2(expense.tax_amount),
});

// The `reference` carries our expense id so rows are traceable (and manually
// de-dupable) inside Sage.
const buildOtherPaymentPayload = (expense, settings, isCapital = false) => ({
    other_payment: {
        transaction_type_id: 'OTHER_PAYMENT',
        bank_account_id: settings.bank_account_id,
        date: toIsoDate(expense.created_at),
        total_amount: round2(expense.amount),
        reference: `airgead:${expense.id}`,
        payment_lines: [buildLine(expense, settings.expense_ledger_account_id, settings, isCapital)],
    },
});

const buildOtherReceiptPayload = (expense, settings) => ({
    other_receipt: {
        transaction_type_id: 'OTHER_RECEIPT',
        bank_account_id: settings.bank_account_id,
        date: toIsoDate(expense.created_at),
        total_amount: round2(expense.amount),
        reference: `airgead:${expense.id}`,
        payment_lines: [buildLine(expense, settings.income_ledger_account_id, settings, false)],
    },
});

// The orchestrator. Sequential and rate-paced; a single row failing is
// collected and the loop continues - only a dead connection
// (SageReconnectError) aborts the remainder, because every subsequent call
// would fail identically. The Sage connection always belongs to the PRACTICE
// org (accountantOrgId), never the client.
const exportToSage = async (pool, { accountantOrgId, clientOrgId, userId, year, settings }) => {
    const expenses = await expenseModel.getExpensesByOrgIdAndYear(pool, clientOrgId, year);
    const summary = { total: expenses.length, created: 0, skipped: 0, failed: 0, failures: [] };
    if (expenses.length === 0) return summary;
    if (expenses.length > MAX_EXPORT_ROWS) throw new SageExportTooLargeError(expenses.length);

    // Same best-effort capital marking as the zip/csv export path.
    const taxSummary = await taxSummaryService.buildTaxSummary(pool, clientOrgId, year).catch((err) => {
        logger.error('Tax summary failed during Sage export (continuing without): %s', err.message);
        return null;
    });
    const capitalIds = new Set((taxSummary && taxSummary.capitalExpenseIds) || []);

    const alreadyExported = new Set(
        await sageModel.getExportedExpenseIds(pool, expenses.map((e) => e.id), settings.sage_business_id)
    );

    let first = true;
    for (const expense of expenses) {
        if (alreadyExported.has(expense.id)) {
            summary.skipped += 1;
            continue;
        }
        if (!first) await module.exports.sleep(POST_INTERVAL_MS);
        first = false;

        const isIncome = expense.category === 'income';
        const resourceType = isIncome ? 'other_receipt' : 'other_payment';
        const payload = isIncome
            ? buildOtherReceiptPayload(expense, settings)
            : buildOtherPaymentPayload(expense, settings, capitalIds.has(expense.id));

        try {
            const created = await sageAuth.authedRequest(pool, accountantOrgId, {
                businessId: settings.sage_business_id,
                method: 'post',
                path: isIncome ? '/other_receipts' : '/other_payments',
                data: payload,
            });
            await sageModel.recordExportedExpense(pool, {
                expenseId: expense.id,
                sageBusinessId: settings.sage_business_id,
                resourceType,
                sageResourceId: (created && created.id) || 'unknown',
                accountantOrgId,
                exportedBy: userId,
            });
            summary.created += 1;
        } catch (error) {
            if (error instanceof sageAuth.SageReconnectError) throw error;
            logger.warn('Sage export row failed', { expenseId: expense.id, error: error.message });
            summary.failed += 1;
            summary.failures.push({ expenseId: expense.id, title: expense.title, error: error.message });
        }
    }

    logger.info('Sage export finished', { accountantOrgId, clientOrgId, year, ...summary, failures: undefined });
    return summary;
};

module.exports = {
    buildOtherPaymentPayload,
    buildOtherReceiptPayload,
    exportToSage,
    sleep,
    toIsoDate,
    MAX_EXPORT_ROWS,
    POST_INTERVAL_MS,
    SageExportTooLargeError,
};
