const logger = require('../utils/logger');

// Phase 3 accountant ↔ client links. An accountancy practice org is granted
// read+export access over a CLIENT's separate org via a row here - it never
// joins the client org. Access is gated everywhere on an *active* link.

// The single active link between a practice and one client org, or null.
const getActiveLink = async (pool, accountantOrgId, clientOrgId) => {
    try {
        const result = await pool.query(
            `SELECT * FROM accountant_org_links
             WHERE accountant_org_id = $1 AND client_org_id = $2 AND status = 'active'`,
            [accountantOrgId, clientOrgId]
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error fetching active accountant link', { accountantOrgId, clientOrgId, error: error.message });
        throw error;
    }
};

// The set of org ids a user may read: their own org plus the client orgs they
// have active links to. Ownership-aware: a firm OWNER (admin) sees every client
// of the firm; a MEMBER accountant sees only clients they invited
// (created_by = their userId). super_admin returns null = "all orgs" (mirrors
// the orgId=null bypass convention in expenseModel/receiptModel).
const getAccessibleOrgIds = async (pool, user) => {
    if (user && user.platformRole === 'super_admin') return null;
    const ownerScoped = user && user.orgRole !== 'owner';
    try {
        const result = await pool.query(
            `SELECT client_org_id FROM accountant_org_links
             WHERE accountant_org_id = $1 AND status = 'active'
             ${ownerScoped ? 'AND created_by = $2' : ''}`,
            ownerScoped ? [user.orgId, user.userId] : [user.orgId]
        );
        return [user.orgId, ...result.rows.map((r) => r.client_org_id)];
    } catch (error) {
        logger.error('Error fetching accessible org ids', { orgId: user && user.orgId, error: error.message });
        throw error;
    }
};

// Does the org carry the practice flag? (Drives who may send client invites and
// see the Clients workspace.)
const isAccountantPractice = async (pool, orgId) => {
    try {
        const result = await pool.query(
            'SELECT is_accountant_practice FROM organisations WHERE id = $1',
            [orgId]
        );
        return Boolean(result.rows[0] && result.rows[0].is_accountant_practice);
    } catch (error) {
        logger.error('Error checking accountant practice flag', { orgId, error: error.message });
        throw error;
    }
};

// Active-linked client orgs with this-tax-year summary stats. When
// accountantOrgId is null (super_admin) it spans every active link. When
// ownerUserId is set (a member accountant), it is narrowed to clients that user
// owns (created_by). The owning accountant's name is returned for the admin view.
// The tax year is the calendar year (Irish tax year). Aggregates key on the
// user -> org relationship, matching the orgPredicate pattern in expenseModel.
const getClientsWithStats = async (pool, accountantOrgId, year, ownerUserId) => {
    const startDate = `${year}-01-01`;
    const endDate = `${parseInt(year, 10) + 1}-01-01`;

    // Build the params/placeholders dynamically: optional accountant scope,
    // required date range, optional owner scope.
    const values = [];
    const conds = ["l.status = 'active'"];
    if (accountantOrgId !== null && accountantOrgId !== undefined) {
        values.push(accountantOrgId);
        conds.push(`l.accountant_org_id = $${values.length}`);
    }
    values.push(startDate);
    const startParam = `$${values.length}`;
    values.push(endDate);
    const endParam = `$${values.length}`;
    if (ownerUserId) {
        values.push(ownerUserId);
        conds.push(`l.created_by = $${values.length}`);
    }

    try {
        const result = await pool.query(
            `SELECT
                o.id,
                o.name,
                o.type,
                o.org_category,
                o.trial_ends_at,
                o.billing_status,
                l.created_by,
                NULLIF(TRIM(CONCAT(u.fname, ' ', u.sname)), '') AS owner_name,
                COALESCE(stats.txn_count, 0)      AS txn_count,
                COALESCE(stats.expense_total, 0)  AS expense_total,
                COALESCE(stats.income_total, 0)   AS income_total,
                stats.last_activity
             FROM accountant_org_links l
             JOIN organisations o ON o.id = l.client_org_id
             LEFT JOIN users u ON u.id = l.created_by
             LEFT JOIN LATERAL (
                SELECT
                    count(*)                                                  AS txn_count,
                    COALESCE(sum(amount) FILTER (WHERE category <> 'income'), 0) AS expense_total,
                    COALESCE(sum(amount) FILTER (WHERE category = 'income'), 0)  AS income_total,
                    max(created_at)                                           AS last_activity
                FROM expenses
                WHERE user_id IN (SELECT id FROM users WHERE org_id = l.client_org_id)
                  AND created_at >= ${startParam} AND created_at < ${endParam}
             ) stats ON true
             WHERE ${conds.join(' AND ')}
             ORDER BY o.name ASC`,
            values
        );
        logger.info('Fetched client stats for accountant', { accountantOrgId, ownerUserId, count: result.rows.length });
        return result.rows;
    } catch (error) {
        logger.error('Error fetching client stats', { accountantOrgId, error: error.message });
        throw error;
    }
};

// Revoke an accountant's access to a client org (idempotent-ish: returns the
// row, or null if no such link). Read endpoints then 403.
const revokeLink = async (pool, accountantOrgId, clientOrgId) => {
    try {
        const result = await pool.query(
            `UPDATE accountant_org_links
             SET status = 'revoked', updated_at = now()
             WHERE accountant_org_id = $1 AND client_org_id = $2
             RETURNING *`,
            [accountantOrgId, clientOrgId]
        );
        if (result.rows.length > 0) {
            logger.info('Revoked accountant link', { accountantOrgId, clientOrgId });
            return result.rows[0];
        }
        return null;
    } catch (error) {
        logger.error('Error revoking accountant link', { accountantOrgId, clientOrgId, error: error.message });
        throw error;
    }
};

// Reassign a client to a different accountant within the firm (admin-only,
// enforced in the controller/route). `created_by` doubles as the owning
// accountant, so reassignment simply updates it. Returns the row, or null.
const reassignLink = async (pool, accountantOrgId, clientOrgId, newOwnerUserId) => {
    try {
        const result = await pool.query(
            `UPDATE accountant_org_links
             SET created_by = $3, updated_at = now()
             WHERE accountant_org_id = $1 AND client_org_id = $2 AND status = 'active'
             RETURNING *`,
            [accountantOrgId, clientOrgId, newOwnerUserId]
        );
        if (result.rows.length > 0) {
            logger.info('Reassigned accountant link', { accountantOrgId, clientOrgId, newOwnerUserId });
            return result.rows[0];
        }
        return null;
    } catch (error) {
        logger.error('Error reassigning accountant link', { accountantOrgId, clientOrgId, error: error.message });
        throw error;
    }
};

module.exports = {
    getActiveLink,
    getAccessibleOrgIds,
    isAccountantPractice,
    getClientsWithStats,
    revokeLink,
    reassignLink,
};
