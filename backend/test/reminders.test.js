/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const nodemailer = require('nodemailer');
const { expect } = require('@jest/globals');

const reminderJob = require('../src/services/billing/reminderJob');
const billingReminderModel = require('../src/models/billingReminderModel');
const organisationModel = require('../src/models/organisationModel');
const userModel = require('../src/models/userModel');
const accountantController = require('../src/controllers/accountantController');
const adminController = require('../src/controllers/adminController');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });
const DAY = 86_400_000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

afterEach(() => sinon.restore());

describe('reminderJob.runReminderSweep', () => {
    const stubMail = () => {
        const sendMail = sinon.stub().resolves({});
        sinon.stub(nodemailer, 'createTransport').returns({ sendMail });
        return sendMail;
    };
    const candidate = (overrides = {}) => ({
        id: 'org-1', name: 'Cara Nolan', owner_email: 'cara@x.ie', trial_ends_at: inDays(-1), ...overrides,
    });

    it('sends the current milestone once and logs it', async () => {
        sinon.stub(billingReminderModel, 'getReminderCandidates').resolves([candidate({ trial_ends_at: inDays(-1) })]);
        sinon.stub(billingReminderModel, 'wasSent').resolves(false);
        const record = sinon.stub(billingReminderModel, 'recordSent').resolves(true);
        const sendMail = stubMail();

        const result = await reminderJob.runReminderSweep({});

        expect(result).toEqual({ sent: 1, candidates: 1 });
        expect(sendMail.calledOnce).toBe(true);
        // Trial ended yesterday -> the "trial_expired" (pay-in-full) milestone.
        expect(record.firstCall.args).toEqual([{}, 'org-1', 'trial_expired']);
    });

    it('is idempotent: an already-sent milestone is skipped', async () => {
        sinon.stub(billingReminderModel, 'getReminderCandidates').resolves([candidate()]);
        sinon.stub(billingReminderModel, 'wasSent').resolves(true);
        const record = sinon.stub(billingReminderModel, 'recordSent');
        const sendMail = stubMail();

        const result = await reminderJob.runReminderSweep({});

        expect(result.sent).toBe(0);
        expect(sendMail.notCalled).toBe(true);
        expect(record.notCalled).toBe(true);
    });

    it('picks the most-advanced CROSSED milestone (T-7 five days out)', async () => {
        sinon.stub(billingReminderModel, 'getReminderCandidates').resolves([candidate({ trial_ends_at: inDays(5) })]);
        sinon.stub(billingReminderModel, 'wasSent').resolves(false);
        const record = sinon.stub(billingReminderModel, 'recordSent').resolves(true);
        stubMail();

        await reminderJob.runReminderSweep({});

        expect(record.firstCall.args[2]).toBe('trial_t7');
    });

    it('sends nothing when the trial end is still more than a week away', async () => {
        sinon.stub(billingReminderModel, 'getReminderCandidates').resolves([candidate({ trial_ends_at: inDays(10) })]);
        const wasSent = sinon.stub(billingReminderModel, 'wasSent');
        const sendMail = stubMail();

        const result = await reminderJob.runReminderSweep({});

        expect(result.sent).toBe(0);
        expect(wasSent.notCalled).toBe(true);
        expect(sendMail.notCalled).toBe(true);
    });

    it("a single org's mail failure does not stop the sweep", async () => {
        sinon.stub(billingReminderModel, 'getReminderCandidates').resolves([
            candidate({ id: 'org-a' }),
            candidate({ id: 'org-b' }),
        ]);
        sinon.stub(billingReminderModel, 'wasSent').resolves(false);
        sinon.stub(billingReminderModel, 'recordSent').resolves(true);
        const sendMail = sinon.stub();
        sendMail.onFirstCall().rejects(new Error('smtp down'));
        sendMail.onSecondCall().resolves({});
        sinon.stub(nodemailer, 'createTransport').returns({ sendMail });

        const result = await reminderJob.runReminderSweep({});
        expect(result).toEqual({ sent: 1, candidates: 2 });
    });
});

describe('POST /accountant/clients/:id/remind', () => {
    // super_admin bypasses the per-client link gate (assertClientAccess).
    const reqFor = () => ({
        pool: {},
        params: { clientOrgId: 'client-1' },
        user: { userId: 'admin', orgId: 'firm', orgRole: 'owner', platformRole: 'super_admin' },
    });
    const stubMail = () => {
        const sendMail = sinon.stub().resolves({});
        sinon.stub(nodemailer, 'createTransport').returns({ sendMail });
        return sendMail;
    };

    it('400s a client that already has an active subscription', async () => {
        sinon.stub(organisationModel, 'getOrgById').resolves({ id: 'client-1', billing_status: 'active' });
        const res = makeRes();
        await accountantController.remindClient(reqFor(), res);
        expect(res.status.calledWith(400)).toBe(true);
    });

    it('is idempotent per day: a second nudge the same day is a no-op', async () => {
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'client-1', name: 'Cara', billing_status: 'none', owner_account_id: 'owner-1', trial_ends_at: inDays(-2),
        });
        sinon.stub(userModel, 'getUserById').resolves({ id: 'owner-1', email: 'cara@x.ie' });
        sinon.stub(billingReminderModel, 'wasSent').resolves(true);
        const record = sinon.stub(billingReminderModel, 'recordSent');
        const sendMail = stubMail();
        const res = makeRes();

        await accountantController.remindClient(reqFor(), res);

        expect(res.status.calledWith(200)).toBe(true);
        expect(res.json.firstCall.args[0]).toEqual(expect.objectContaining({ alreadySent: true }));
        expect(sendMail.notCalled).toBe(true);
        expect(record.notCalled).toBe(true);
    });

    it('emails the client owner and records a per-day manual reminder', async () => {
        sinon.stub(organisationModel, 'getOrgById').resolves({
            id: 'client-1', name: 'Cara', billing_status: 'none', owner_account_id: 'owner-1', trial_ends_at: inDays(-2),
        });
        sinon.stub(userModel, 'getUserById').resolves({ id: 'owner-1', email: 'cara@x.ie' });
        sinon.stub(billingReminderModel, 'wasSent').resolves(false);
        const record = sinon.stub(billingReminderModel, 'recordSent').resolves(true);
        const sendMail = stubMail();
        const res = makeRes();

        await accountantController.remindClient(reqFor(), res);

        expect(sendMail.calledOnce).toBe(true);
        expect(res.status.calledWith(200)).toBe(true);
        const [, orgId, kind] = record.firstCall.args;
        expect(orgId).toBe('client-1');
        expect(kind).toMatch(/^manual_\d{4}-\d{2}-\d{2}$/);
    });
});

describe('PATCH /admin/orgs/:id/practice-approval', () => {
    const reqFor = (decision) => ({
        pool: {},
        params: { id: 'firm-1' },
        body: { decision },
        user: { userId: 'admin', orgId: 'admin-org', platformRole: 'super_admin' },
    });
    const stubMail = () => {
        const sendMail = sinon.stub().resolves({});
        sinon.stub(nodemailer, 'createTransport').returns({ sendMail });
        return sendMail;
    };

    it('400s an invalid decision', async () => {
        const res = makeRes();
        await adminController.setPracticeApproval(reqFor('maybe'), res);
        expect(res.status.calledWith(400)).toBe(true);
    });

    it('404s an unknown org', async () => {
        sinon.stub(organisationModel, 'getOrgById').resolves(null);
        const res = makeRes();
        await adminController.setPracticeApproval(reqFor('approved'), res);
        expect(res.status.calledWith(404)).toBe(true);
    });

    it('approves a practice and emails the owner', async () => {
        sinon.stub(organisationModel, 'getOrgById').resolves({ id: 'firm-1', name: 'Kelly & Co', owner_account_id: 'owner-1' });
        const setApproval = sinon.stub(organisationModel, 'setPracticeApproval')
            .resolves({ id: 'firm-1', practice_status: 'approved', is_accountant_practice: true });
        sinon.stub(userModel, 'getUserById').resolves({ id: 'owner-1', email: 'kelly@x.ie' });
        const sendMail = stubMail();
        const res = makeRes();

        await adminController.setPracticeApproval(reqFor('approved'), res);

        expect(setApproval.firstCall.args[2]).toEqual(expect.objectContaining({ approved: true, approverId: 'admin' }));
        expect(sendMail.calledOnce).toBe(true);
        expect(res.status.calledWith(200)).toBe(true);
    });

    it('rejects a practice (leaves the flag false)', async () => {
        sinon.stub(organisationModel, 'getOrgById').resolves({ id: 'firm-1', name: 'Kelly & Co', owner_account_id: 'owner-1' });
        const setApproval = sinon.stub(organisationModel, 'setPracticeApproval')
            .resolves({ id: 'firm-1', practice_status: 'rejected', is_accountant_practice: false });
        sinon.stub(userModel, 'getUserById').resolves({ id: 'owner-1', email: 'kelly@x.ie' });
        stubMail();
        const res = makeRes();

        await adminController.setPracticeApproval(reqFor('rejected'), res);

        expect(setApproval.firstCall.args[2]).toEqual(expect.objectContaining({ approved: false }));
        expect(res.status.calledWith(200)).toBe(true);
    });
});
