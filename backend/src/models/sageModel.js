const logger = require('../utils/logger');

// All SQL for the Sage integration (migration 012): the per-practice OAuth
// connection, the remembered per-client export settings, and the idempotency
// ledger of already-exported expenses. Token columns hold tokenCrypto payloads,
// never plaintext.

const getConnectionByOrgId = async (pool, orgId) => {
    try {
        const result = await pool.query('SELECT * FROM sage_connections WHERE org_id = $1', [orgId]);
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error fetching sage connection', { orgId, error: error.message });
        throw error;
    }
};

const upsertConnection = async (pool, { orgId, connectedBy, accessTokenEncrypted, refreshTokenEncrypted, accessTokenExpiresAt, refreshTokenExpiresAt }) => {
    try {
        const result = await pool.query(
            `INSERT INTO sage_connections
                (org_id, connected_by, access_token_encrypted, refresh_token_encrypted, access_token_expires_at, refresh_token_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (org_id) DO UPDATE SET
                connected_by = EXCLUDED.connected_by,
                access_token_encrypted = EXCLUDED.access_token_encrypted,
                refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
                access_token_expires_at = EXCLUDED.access_token_expires_at,
                refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
                status = 'active',
                updated_at = now()
             RETURNING *`,
            [orgId, connectedBy, accessTokenEncrypted, refreshTokenEncrypted, accessTokenExpiresAt, refreshTokenExpiresAt]
        );
        return result.rows[0];
    } catch (error) {
        logger.error('Error upserting sage connection', { orgId, error: error.message });
        throw error;
    }
};

const deleteConnection = async (pool, orgId) => {
    try {
        await pool.query('DELETE FROM sage_connections WHERE org_id = $1', [orgId]);
    } catch (error) {
        logger.error('Error deleting sage connection', { orgId, error: error.message });
        throw error;
    }
};

// A dead refresh token (rotated away / 31 days idle / revoked at Sage). The
// row is kept so the UI can show "reconnect needed" rather than "never linked".
const markConnectionExpired = async (pool, orgId) => {
    try {
        await pool.query("UPDATE sage_connections SET status = 'expired', updated_at = now() WHERE org_id = $1", [orgId]);
    } catch (error) {
        logger.error('Error marking sage connection expired', { orgId, error: error.message });
        throw error;
    }
};

// Transaction-scoped pair used by sageAuth's serialized refresh. Both take a
// checked-out client (inside BEGIN/COMMIT), not the pool.
const lockConnection = async (client, orgId) => {
    const result = await client.query('SELECT * FROM sage_connections WHERE org_id = $1 FOR UPDATE', [orgId]);
    return result.rows[0] || null;
};

const updateConnectionTokens = async (client, orgId, { accessTokenEncrypted, refreshTokenEncrypted, accessTokenExpiresAt, refreshTokenExpiresAt }) => {
    await client.query(
        `UPDATE sage_connections SET
            access_token_encrypted = $2,
            refresh_token_encrypted = $3,
            access_token_expires_at = $4,
            refresh_token_expires_at = $5,
            status = 'active',
            updated_at = now()
         WHERE org_id = $1`,
        [orgId, accessTokenEncrypted, refreshTokenEncrypted, accessTokenExpiresAt, refreshTokenExpiresAt]
    );
};

const getExportSettings = async (pool, accountantOrgId, clientOrgId) => {
    try {
        const result = await pool.query(
            'SELECT * FROM sage_export_settings WHERE accountant_org_id = $1 AND client_org_id = $2',
            [accountantOrgId, clientOrgId]
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error fetching sage export settings', { accountantOrgId, clientOrgId, error: error.message });
        throw error;
    }
};

const upsertExportSettings = async (pool, { accountantOrgId, clientOrgId, sageBusinessId, sageBusinessName, bankAccountId, bankAccountName, expenseLedgerAccountId, expenseLedgerAccountName, incomeLedgerAccountId, incomeLedgerAccountName, taxRateId, updatedBy }) => {
    try {
        const result = await pool.query(
            `INSERT INTO sage_export_settings
                (accountant_org_id, client_org_id, sage_business_id, sage_business_name,
                 bank_account_id, bank_account_name, expense_ledger_account_id, expense_ledger_account_name,
                 income_ledger_account_id, income_ledger_account_name, tax_rate_id, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (accountant_org_id, client_org_id) DO UPDATE SET
                sage_business_id = EXCLUDED.sage_business_id,
                sage_business_name = EXCLUDED.sage_business_name,
                bank_account_id = EXCLUDED.bank_account_id,
                bank_account_name = EXCLUDED.bank_account_name,
                expense_ledger_account_id = EXCLUDED.expense_ledger_account_id,
                expense_ledger_account_name = EXCLUDED.expense_ledger_account_name,
                income_ledger_account_id = EXCLUDED.income_ledger_account_id,
                income_ledger_account_name = EXCLUDED.income_ledger_account_name,
                tax_rate_id = EXCLUDED.tax_rate_id,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
             RETURNING *`,
            [accountantOrgId, clientOrgId, sageBusinessId, sageBusinessName,
                bankAccountId, bankAccountName, expenseLedgerAccountId, expenseLedgerAccountName,
                incomeLedgerAccountId, incomeLedgerAccountName, taxRateId, updatedBy]
        );
        return result.rows[0];
    } catch (error) {
        logger.error('Error upserting sage export settings', { accountantOrgId, clientOrgId, error: error.message });
        throw error;
    }
};

// Which of these expenses are already in the given Sage business? (Idempotency
// skip-set for re-exports.)
const getExportedExpenseIds = async (pool, expenseIds, sageBusinessId) => {
    if (!expenseIds || expenseIds.length === 0) return [];
    try {
        const result = await pool.query(
            'SELECT expense_id FROM sage_exported_expenses WHERE expense_id = ANY($1) AND sage_business_id = $2',
            [expenseIds, sageBusinessId]
        );
        return result.rows.map((r) => r.expense_id);
    } catch (error) {
        logger.error('Error fetching exported expense ids', { sageBusinessId, error: error.message });
        throw error;
    }
};

const recordExportedExpense = async (pool, { expenseId, sageBusinessId, resourceType, sageResourceId, accountantOrgId, exportedBy }) => {
    try {
        await pool.query(
            `INSERT INTO sage_exported_expenses
                (expense_id, sage_business_id, sage_resource_type, sage_resource_id, accountant_org_id, exported_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (expense_id, sage_business_id) DO NOTHING`,
            [expenseId, sageBusinessId, resourceType, sageResourceId, accountantOrgId, exportedBy]
        );
    } catch (error) {
        logger.error('Error recording exported expense', { expenseId, sageBusinessId, error: error.message });
        throw error;
    }
};

module.exports = {
    getConnectionByOrgId,
    upsertConnection,
    deleteConnection,
    markConnectionExpired,
    lockConnection,
    updateConnectionTokens,
    getExportSettings,
    upsertExportSettings,
    getExportedExpenseIds,
    recordExportedExpense,
};
