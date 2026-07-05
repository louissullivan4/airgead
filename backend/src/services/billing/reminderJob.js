const cron = require('node-cron');
const logger = require('../../utils/logger');
const { isBillingEnforced } = require('../../config/tiers');
const { sendEmail } = require('../../utils/email');
const { BRAND } = require('../../config/brand');
const reminderModel = require('../../models/billingReminderModel');

// Trial / payment reminders. A daily sweep nudges trialing client & solo orgs as
// their 14-day trial deadline approaches and after it lapses ("subscribe to keep
// going" - the pay-in-full ask). Practices are free and never appear here.
//
// Idempotency lives in billing_reminders (one row per org+kind). Each run sends
// at most ONE email per org: the MOST-ADVANCED milestone whose time has passed
// and that hasn't been sent yet. That makes the job robust to a missed day (it
// simply sends the current milestone, without backfilling skipped ones) and can
// never double-send.

const DAY_MS = 86_400_000;
const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

// Reminder milestones for a given trial end, in chronological order. The last
// one whose `at` is in the past is the org's current milestone.
const milestonesFor = (endMs) => [
    { kind: 'trial_t7', at: endMs - 7 * DAY_MS },
    { kind: 'trial_t3', at: endMs - 3 * DAY_MS },
    { kind: 'trial_t1', at: endMs - 1 * DAY_MS },
    { kind: 'trial_expired', at: endMs },
    { kind: 'post_trial_3', at: endMs + 3 * DAY_MS },
    { kind: 'post_trial_7', at: endMs + 7 * DAY_MS },
];

// Human copy per reminder kind. `daysLeft` is whole days until the trial ends
// (0 once expired), used only in the approaching-trial wording.
const reminderCopy = (kind, { daysLeft }) => {
    const dl = Math.max(0, daysLeft);
    const dayWord = dl === 1 ? '1 day' : `${dl} days`;
    switch (kind) {
        case 'trial_t7':
        case 'trial_t3':
        case 'trial_t1':
            return {
                subject: `Your ${BRAND} free trial ends in ${dayWord}`,
                heading: `${dayWord} left on your free trial`,
                paragraphs: [
                    `Your ${BRAND} free trial ends in ${dayWord}.`,
                    'Subscribe now to keep adding records without interruption - everything you have entered stays exactly as it is.',
                ],
                ctaLabel: 'Subscribe now',
                textLead: `Your ${BRAND} free trial ends in ${dayWord}. Subscribe to keep adding records: `,
            };
        case 'trial_expired':
            return {
                subject: `Your ${BRAND} free trial has ended`,
                heading: 'Your free trial has ended',
                paragraphs: [
                    `Your ${BRAND} free trial has ended. Your records are safe and always viewable, but adding new ones is paused until you subscribe.`,
                    'Subscribe now to pick up right where you left off.',
                ],
                ctaLabel: 'Subscribe to continue',
                textLead: `Your ${BRAND} free trial has ended. Subscribe to keep adding records: `,
            };
        case 'post_trial_3':
        case 'post_trial_7':
        default:
            return {
                subject: `Keep your ${BRAND} records going`,
                heading: 'Ready when you are',
                paragraphs: [
                    `Your ${BRAND} account is waiting. Your records are safe and viewable - subscribe whenever you're ready to start adding new ones again.`,
                ],
                ctaLabel: 'Subscribe',
                textLead: `Your ${BRAND} records are waiting. Subscribe to keep adding new ones: `,
            };
    }
};

// Send one reminder email to an org's owner. `org` carries owner_email, name and
// trial_ends_at (as returned by getReminderCandidates or a getOrgById + owner
// lookup). Throws on send failure so the caller decides whether to record it.
const sendReminderEmail = async (org, kind) => {
    const daysLeft = org.trial_ends_at
        ? Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / DAY_MS)
        : 0;
    const copy = reminderCopy(kind, { daysLeft });
    const url = `${frontendUrl()}/settings`;
    await sendEmail({
        to: org.owner_email,
        subject: copy.subject,
        heading: copy.heading,
        paragraphs: copy.paragraphs,
        cta: { label: copy.ctaLabel, url },
        footerNote: `You received this because your ${BRAND} organisation is on a free trial.`,
        text: `${copy.textLead}${url}`,
    });
};

// Scan all candidate orgs and send each its current, unsent milestone. Returns
// { sent, candidates } for logging/tests. Never throws for a single bad send -
// one org's mail failure must not stop the sweep.
const runReminderSweep = async (pool) => {
    const candidates = await reminderModel.getReminderCandidates(pool);
    let sent = 0;
    for (const org of candidates) {
        const endMs = new Date(org.trial_ends_at).getTime();
        if (!Number.isFinite(endMs)) continue;
        const crossed = milestonesFor(endMs).filter((m) => Date.now() >= m.at);
        const current = crossed[crossed.length - 1];
        if (!current) continue; // trial end is still more than a week away
        if (await reminderModel.wasSent(pool, org.id, current.kind)) continue;
        try {
            await sendReminderEmail(org, current.kind);
            await reminderModel.recordSent(pool, org.id, current.kind);
            sent += 1;
        } catch (err) {
            logger.warn('Reminder send failed for org %s (%s): %s', org.id, current.kind, err.message);
        }
    }
    logger.info('Reminder sweep complete: %d sent / %d candidates', sent, candidates.length);
    return { sent, candidates: candidates.length };
};

// Schedule the daily sweep (09:00 server time). Reminders only make sense once
// billing is enforced, so the sweep no-ops while BILLING_ENFORCED is off -
// nobody is nagged pre-GA. Returns the cron task (so callers can stop it).
const startReminderCron = (pool) => {
    const task = cron.schedule('0 9 * * *', async () => {
        if (!isBillingEnforced()) return;
        try {
            await runReminderSweep(pool);
        } catch (err) {
            logger.error('Reminder cron failed: %s', err.message);
        }
    });
    logger.info('Billing reminder cron scheduled (daily 09:00)');
    return task;
};

module.exports = { runReminderSweep, sendReminderEmail, reminderCopy, milestonesFor, startReminderCron };
