const logger = require('../utils/logger');

// The billing_reminders log (migration 015) backs the trial/payment reminder
// job. One row per (org, kind) makes every nudge idempotent - re-sending is a
// no-op via the UNIQUE(org_id, kind) constraint.

// Orgs that could be due a trial/payment reminder: a solo/business or a
// practice's CLIENT (never a practice - those are free), with no active paying
// subscription, whose trial deadline falls inside the reminder window
// (T-7 .. T+7, widened to 8 days each side so a missed run still catches the
// milestone). Suspended orgs and orgs without an owner email are excluded.
const getReminderCandidates = async (pool) => {
    try {
        const result = await pool.query(
            `SELECT
                o.id,
                o.name,
                o.trial_ends_at,
                u.email AS owner_email,
                u.fname AS owner_fname
             FROM organisations o
             JOIN users u ON u.id = o.owner_account_id
             WHERE o.is_accountant_practice = false
               AND o.practice_status IN ('none', 'rejected')
               AND o.billing_status IN ('none', 'canceled')
               AND o.status <> 'suspended'
               AND o.trial_ends_at IS NOT NULL
               AND o.trial_ends_at >= now() - interval '8 days'
               AND o.trial_ends_at <= now() + interval '8 days'`
        );
        return result.rows;
    } catch (error) {
        logger.error('Error fetching reminder candidates', { error: error.message });
        throw error;
    }
};

// Has this exact reminder milestone already gone out for this org?
const wasSent = async (pool, orgId, kind) => {
    try {
        const result = await pool.query(
            'SELECT 1 FROM billing_reminders WHERE org_id = $1 AND kind = $2',
            [orgId, kind]
        );
        return result.rowCount > 0;
    } catch (error) {
        logger.error('Error checking reminder log', { orgId, kind, error: error.message });
        throw error;
    }
};

// Record that a reminder milestone was sent. Idempotent: a duplicate (org, kind)
// is silently ignored. Returns true when a NEW row was written (i.e. this is the
// first send of that milestone), false when it already existed.
const recordSent = async (pool, orgId, kind) => {
    try {
        const result = await pool.query(
            `INSERT INTO billing_reminders (org_id, kind)
             VALUES ($1, $2)
             ON CONFLICT (org_id, kind) DO NOTHING
             RETURNING id`,
            [orgId, kind]
        );
        return result.rowCount > 0;
    } catch (error) {
        logger.error('Error recording reminder', { orgId, kind, error: error.message });
        throw error;
    }
};

module.exports = { getReminderCandidates, wasSent, recordSent };
