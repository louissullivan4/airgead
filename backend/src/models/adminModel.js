const logger = require('../utils/logger');

// Phase 4 platform (super_admin) model: read-only overviews across every org and
// user, plus GDPR hard-delete cascades. Tax year = calendar year (Irish).

// Platform-wide counts + this-tax-year totals.
const getPlatformStats = async (pool, year) => {
    const startDate = `${year}-01-01`;
    const endDate = `${parseInt(year, 10) + 1}-01-01`;
    try {
        const result = await pool.query(
            `SELECT
                (SELECT count(*) FROM organisations)                                         AS orgs,
                (SELECT count(*) FROM users)                                                 AS users,
                (SELECT count(*) FROM organisations WHERE is_accountant_practice)            AS firms,
                (SELECT count(DISTINCT client_org_id) FROM accountant_org_links
                    WHERE status = 'active')                                                 AS clients,
                (SELECT count(*) FROM expenses WHERE created_at >= $1 AND created_at < $2)    AS txns,
                (SELECT COALESCE(sum(amount), 0) FROM expenses
                    WHERE category <> 'income' AND created_at >= $1 AND created_at < $2)      AS expense_total,
                (SELECT COALESCE(sum(amount), 0) FROM expenses
                    WHERE category = 'income' AND created_at >= $1 AND created_at < $2)       AS income_total`,
            [startDate, endDate]
        );
        return result.rows[0];
    } catch (error) {
        logger.error('Error fetching platform stats', { error: error.message });
        throw error;
    }
};

// Every organisation with this-tax-year stats + member count + lifecycle flags.
const getAllOrgsWithStats = async (pool, year) => {
    const startDate = `${year}-01-01`;
    const endDate = `${parseInt(year, 10) + 1}-01-01`;
    try {
        const result = await pool.query(
            `SELECT
                o.id, o.name, o.type, o.org_category, o.is_accountant_practice, o.status, o.created_at,
                (SELECT count(*) FROM users u WHERE u.org_id = o.id) AS member_count,
                COALESCE(s.txn_count, 0)     AS txn_count,
                COALESCE(s.expense_total, 0) AS expense_total,
                COALESCE(s.income_total, 0)  AS income_total,
                s.last_activity
             FROM organisations o
             LEFT JOIN LATERAL (
                SELECT
                    count(*)                                                    AS txn_count,
                    COALESCE(sum(amount) FILTER (WHERE category <> 'income'), 0) AS expense_total,
                    COALESCE(sum(amount) FILTER (WHERE category = 'income'), 0)  AS income_total,
                    max(created_at)                                             AS last_activity
                FROM expenses
                WHERE user_id IN (SELECT id FROM users WHERE org_id = o.id)
                  AND created_at >= $1 AND created_at < $2
             ) s ON true
             ORDER BY o.created_at DESC`,
            [startDate, endDate]
        );
        return result.rows;
    } catch (error) {
        logger.error('Error fetching all orgs', { error: error.message });
        throw error;
    }
};

// Every user with their org name + role/status fields.
const getAllUsersWithOrg = async (pool) => {
    try {
        const result = await pool.query(
            `SELECT
                u.id, u.fname, u.sname, u.email, u.role, u.org_role, u.platform_role,
                u.account_status, u.org_id, u.created_at, u.last_login,
                o.name AS org_name, o.is_accountant_practice
             FROM users u
             LEFT JOIN organisations o ON o.id = u.org_id
             ORDER BY u.created_at DESC`
        );
        return result.rows;
    } catch (error) {
        logger.error('Error fetching all users', { error: error.message });
        throw error;
    }
};

// Receipt/expense image object keys for a set of users (for storage cleanup
// after a delete). Runs on a transaction client.
const collectImagePaths = async (client, userIds) => {
    if (!userIds.length) return [];
    const r1 = await client.query(
        'SELECT image_object_path AS p FROM receipts WHERE user_id = ANY($1) AND image_object_path IS NOT NULL',
        [userIds]
    );
    const r2 = await client.query(
        'SELECT receipt_image_url AS p FROM expenses WHERE user_id = ANY($1) AND receipt_image_url IS NOT NULL',
        [userIds]
    );
    return [...r1.rows, ...r2.rows].map((x) => x.p);
};

// GDPR hard-delete of an entire org (account closure): erase the org, all its
// users, their expenses + receipts, and every link where the org is the
// accountant or the client. Returns the image object keys to remove from
// storage (done by the caller after commit). All DB work is one transaction.
const deleteOrgCascade = async (pool, orgId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const usersRes = await client.query('SELECT id FROM users WHERE org_id = $1', [orgId]);
        const userIds = usersRes.rows.map((r) => r.id);
        const imagePaths = await collectImagePaths(client, userIds);

        await client.query('DELETE FROM accountant_org_links WHERE accountant_org_id = $1 OR client_org_id = $1', [orgId]);
        if (userIds.length) {
            await client.query('DELETE FROM expenses WHERE user_id = ANY($1)', [userIds]);
            await client.query('DELETE FROM receipts WHERE user_id = ANY($1)', [userIds]);
            // Defensive: drop any inbound refs before removing the users.
            await client.query('UPDATE accountant_org_links SET created_by = NULL WHERE created_by = ANY($1)', [userIds]);
            await client.query('UPDATE users SET inviter_id = NULL WHERE inviter_id = ANY($1)', [userIds]);
        }
        await client.query('UPDATE organisations SET owner_account_id = NULL WHERE id = $1', [orgId]);
        await client.query('DELETE FROM users WHERE org_id = $1', [orgId]);
        await client.query('DELETE FROM organisations WHERE id = $1', [orgId]);

        await client.query('COMMIT');
        logger.info('Hard-deleted org (cascade)', { orgId, users: userIds.length });
        return imagePaths;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error hard-deleting org', { orgId, error: error.message });
        throw error;
    } finally {
        client.release();
    }
};

// GDPR hard-delete of an individual member: erase the user, their expenses +
// receipts, and NULL any link they owned (created_by) so the firm keeps access.
// (Org owners are handled via deleteOrgCascade by the controller.) Returns image
// object keys to remove from storage.
const deleteUserCascade = async (pool, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const imagePaths = await collectImagePaths(client, [userId]);

        await client.query('DELETE FROM expenses WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM receipts WHERE user_id = $1', [userId]);
        await client.query('UPDATE accountant_org_links SET created_by = NULL WHERE created_by = $1', [userId]);
        await client.query('UPDATE users SET inviter_id = NULL WHERE inviter_id = $1', [userId]);
        await client.query('UPDATE organisations SET owner_account_id = NULL WHERE owner_account_id = $1', [userId]);
        await client.query('DELETE FROM users WHERE id = $1', [userId]);

        await client.query('COMMIT');
        logger.info('Hard-deleted user (cascade)', { userId });
        return imagePaths;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error hard-deleting user', { userId, error: error.message });
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    getPlatformStats,
    getAllOrgsWithStats,
    getAllUsersWithOrg,
    deleteOrgCascade,
    deleteUserCascade,
};
