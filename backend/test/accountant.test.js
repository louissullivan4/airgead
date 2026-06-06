/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const { expect } = require('@jest/globals');

const organisationModel = require('../src/models/organisationModel');
const accountantController = require('../src/controllers/accountantController');
const accountantLinkModel = require('../src/models/accountantLinkModel');
const expenseModel = require('../src/models/expenseModel');
const userModel = require('../src/models/userModel');
const { requireOrgRole } = require('../src/middlewares/tenantScope');

const makeRes = () => ({
    status: sinon.stub().returnsThis(),
    json: sinon.stub(),
    send: sinon.stub(),
    setHeader: sinon.stub(),
    download: sinon.stub(),
});

// Fake pg client whose query() returns the right RETURNING rows by SQL, so
// createUserWithOrg's transaction runs end to end (mirrors organisation.test.js).
const makeClient = () => {
    const query = sinon.stub().callsFake((sql) => {
        if (/SELECT org_id FROM users/i.test(sql)) return Promise.resolve({ rows: [{ org_id: 'inviter-org' }] });
        if (/INSERT INTO organisations/i.test(sql)) return Promise.resolve({ rows: [{ id: 'client-org-1' }] });
        if (/INSERT INTO users/i.test(sql)) {
            return Promise.resolve({ rows: [{ id: 'user-1', email: 'c@x.ie', org_id: 'client-org-1', org_role: 'owner' }] });
        }
        return Promise.resolve({ rows: [] });
    });
    return { query, release: sinon.stub() };
};

const callMatching = (client, re) => client.query.getCalls().find((c) => re.test(c.args[0]));

describe('Phase 3 — accountant ↔ client provisioning (createUserWithOrg)', () => {
    afterEach(() => sinon.restore());

    it('client invite creates a SEPARATE org + an ACTIVE link, owner not member', async () => {
        const client = makeClient();
        const pool = { connect: sinon.stub().resolves(client) };

        await organisationModel.createUserWithOrg(pool, {
            mode: 'self',
            inviterId: null,
            accountantOrgId: 'acc-org',
            createdBy: 'acc-user',
            user: { fname: 'Cara', sname: 'Nolan', email: 'c@x.ie', currency: 'EUR', password: 'hash' },
        });

        // A brand-new org is created (not joined).
        expect(callMatching(client, /INSERT INTO organisations/i)).toBeTruthy();

        // The new user owns that org (org_role is the 22nd users-insert param).
        const userParams = callMatching(client, /INSERT INTO users/i).args[1];
        expect(userParams[20]).toBe('client-org-1'); // org_id
        expect(userParams[21]).toBe('owner');        // org_role

        // An active link is written from the practice to the new client org.
        const linkCall = callMatching(client, /INSERT INTO accountant_org_links/i);
        expect(linkCall).toBeTruthy();
        expect(linkCall.args[1]).toEqual(['acc-org', 'client-org-1', 'acc-user']);
    });

    it('member invite still joins the inviter\'s org and writes NO link', async () => {
        const client = makeClient();
        const pool = { connect: sinon.stub().resolves(client) };

        await organisationModel.createUserWithOrg(pool, {
            mode: 'invite',
            inviterId: 'inv-1',
            user: { fname: 'Niamh', sname: 'Doyle', email: 'n@x.ie', currency: 'EUR', password: 'hash' },
        });

        const userParams = callMatching(client, /INSERT INTO users/i).args[1];
        expect(userParams[20]).toBe('inviter-org'); // joined the inviter's org
        expect(userParams[21]).toBe('member');       // org_role
        expect(callMatching(client, /INSERT INTO organisations/i)).toBeFalsy();
        expect(callMatching(client, /INSERT INTO accountant_org_links/i)).toBeFalsy();
    });
});

describe('Phase 3 — accountant client access control', () => {
    afterEach(() => sinon.restore());

    const reqFor = (clientOrgId, platformRole = 'user') => ({
        pool: {},
        params: { clientOrgId },
        query: {},
        user: { userId: 'acc-user', orgId: 'acc-org', platformRole },
    });

    it('returns the client\'s transactions when an active link exists', async () => {
        const req = reqFor('client-1');
        const res = makeRes();
        // Ownership-aware: the link must belong to the calling accountant.
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ id: 'link-1', status: 'active', created_by: 'acc-user' });
        const modelCall = sinon.stub(expenseModel, 'getExpensesByOrgId').resolves([{ id: 'e1' }]);

        await accountantController.getClientTransactions(req, res);

        expect(modelCall.calledOnceWith(req.pool, 'client-1')).toBe(true);
        expect(res.status.calledWith(200)).toBe(true);
    });

    it('returns 403 for an UNLINKED org and never reaches the data layer', async () => {
        const req = reqFor('client-x');
        const res = makeRes();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves(null);
        const modelCall = sinon.stub(expenseModel, 'getExpensesByOrgId').resolves([]);

        await accountantController.getClientTransactions(req, res);

        expect(res.status.calledWith(403)).toBe(true);
        expect(modelCall.notCalled).toBe(true);
    });

    it('returns 403 when the link is REVOKED (getActiveLink only returns active)', async () => {
        const req = reqFor('client-revoked');
        const res = makeRes();
        // A revoked row is filtered out by getActiveLink's status='active' clause.
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves(null);
        const modelCall = sinon.stub(expenseModel, 'getExpensesByOrgId').resolves([]);

        await accountantController.getClientTransactions(req, res);

        expect(res.status.calledWith(403)).toBe(true);
        expect(modelCall.notCalled).toBe(true);
    });

    it('assertClientAccess denies a solo user access to another org', async () => {
        const req = reqFor('someone-elses-org');
        const res = makeRes();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves(null);

        const allowed = await accountantController.assertClientAccess(req, res, 'someone-elses-org');

        expect(allowed).toBe(false);
        expect(res.status.calledWith(403)).toBe(true);
    });

    it('getAccessibleOrgIds for a solo (non-practice) user returns only their own org', async () => {
        const pool = { query: sinon.stub().resolves({ rows: [] }) };
        const ids = await accountantLinkModel.getAccessibleOrgIds(pool, { orgId: 'org-A', platformRole: 'user' });
        expect(ids).toEqual(['org-A']);
    });

    it('lets a super_admin through assertClientAccess without a link', async () => {
        const req = reqFor('any-org', 'super_admin');
        const res = makeRes();
        const link = sinon.stub(accountantLinkModel, 'getActiveLink').resolves(null);

        const allowed = await accountantController.assertClientAccess(req, res, 'any-org');

        expect(allowed).toBe(true);
        expect(link.notCalled).toBe(true);
    });
});

describe('Phase 3.1 — firm signup flag', () => {
    afterEach(() => sinon.restore());

    const orgInsertParams = (client) =>
        client.query.getCalls().find((c) => /INSERT INTO organisations/i.test(c.args[0])).args[1];

    it('flags is_accountant_practice=true and forces business type on firm signup', async () => {
        const client = makeClient();
        const pool = { connect: sinon.stub().resolves(client) };

        await organisationModel.createUserWithOrg(pool, {
            mode: 'self',
            inviterId: null,
            user: {
                fname: 'Áine', sname: 'Kelly', email: 'firm@x.ie', currency: 'EUR', password: 'hash',
                organisation: { name: 'Kelly & Co', is_accountant_practice: true },
            },
        });

        const params = orgInsertParams(client);
        expect(params[1]).toBe('business');   // type forced to business
        expect(params[7]).toBe(true);         // is_accountant_practice
    });

    it('leaves is_accountant_practice=false for an ordinary personal signup', async () => {
        const client = makeClient();
        const pool = { connect: sinon.stub().resolves(client) };

        await organisationModel.createUserWithOrg(pool, {
            mode: 'self',
            inviterId: null,
            user: { fname: 'Sam', sname: 'Quinn', email: 'p@x.ie', currency: 'EUR', password: 'hash' },
        });

        expect(orgInsertParams(client)[7]).toBe(false);
    });
});

describe('Phase 3.1 — per-accountant ownership', () => {
    afterEach(() => sinon.restore());

    const reqFor = (overrides) => ({
        pool: {},
        params: { clientOrgId: 'client-1' },
        query: {},
        body: {},
        user: { userId: 'me', orgId: 'firm', orgRole: 'member', platformRole: 'user', ...overrides },
    });

    it('listClients scopes a member to their own clients (ownerUserId set)', async () => {
        const req = reqFor({ orgRole: 'member' });
        const res = makeRes();
        const stats = sinon.stub(accountantLinkModel, 'getClientsWithStats').resolves([]);

        await accountantController.listClients(req, res);

        const [, accountantOrgId, , ownerUserId] = stats.firstCall.args;
        expect(accountantOrgId).toBe('firm');
        expect(ownerUserId).toBe('me');
    });

    it('listClients lets the admin (owner) see all clients (ownerUserId null)', async () => {
        const req = reqFor({ orgRole: 'owner' });
        const res = makeRes();
        const stats = sinon.stub(accountantLinkModel, 'getClientsWithStats').resolves([]);

        await accountantController.listClients(req, res);

        expect(stats.firstCall.args[3]).toBe(null);
    });

    it('assertClientAccess denies a member another accountant\'s client', async () => {
        const req = reqFor({ orgRole: 'member', userId: 'me' });
        const res = makeRes();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ id: 'l', created_by: 'colleague' });

        const allowed = await accountantController.assertClientAccess(req, res, 'client-1');

        expect(allowed).toBe(false);
        expect(res.status.calledWith(403)).toBe(true);
    });

    it('assertClientAccess allows a member their own client', async () => {
        const req = reqFor({ orgRole: 'member', userId: 'me' });
        const res = makeRes();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ id: 'l', created_by: 'me' });

        expect(await accountantController.assertClientAccess(req, res, 'client-1')).toBe(true);
    });

    it('assertClientAccess allows the admin any firm client', async () => {
        const req = reqFor({ orgRole: 'owner', userId: 'admin' });
        const res = makeRes();
        sinon.stub(accountantLinkModel, 'getActiveLink').resolves({ id: 'l', created_by: 'someone-else' });

        expect(await accountantController.assertClientAccess(req, res, 'client-1')).toBe(true);
    });
});

describe('Phase 3.1 — client reassignment', () => {
    afterEach(() => sinon.restore());

    const reqFor = (overrides) => ({
        pool: {},
        params: { clientOrgId: 'client-1' },
        body: { accountantUserId: 'u2' },
        user: { userId: 'admin', orgId: 'firm', orgRole: 'owner', platformRole: 'user', ...overrides },
    });

    it('admin reassigns to a firm member', async () => {
        const req = reqFor();
        const res = makeRes();
        sinon.stub(userModel, 'isUserInOrg').resolves(true);
        const reassign = sinon.stub(accountantLinkModel, 'reassignLink').resolves({ id: 'l', created_by: 'u2' });

        await accountantController.reassignClient(req, res);

        expect(reassign.calledOnceWith(req.pool, 'firm', 'client-1', 'u2')).toBe(true);
        expect(res.status.calledWith(200)).toBe(true);
    });

    it('rejects reassigning to someone outside the firm', async () => {
        const req = reqFor();
        const res = makeRes();
        sinon.stub(userModel, 'isUserInOrg').resolves(false);
        const reassign = sinon.stub(accountantLinkModel, 'reassignLink').resolves(null);

        await accountantController.reassignClient(req, res);

        expect(res.status.calledWith(400)).toBe(true);
        expect(reassign.notCalled).toBe(true);
    });

    it('route guard blocks a member accountant from reassigning', () => {
        const req = { user: { orgRole: 'member', platformRole: 'user' } };
        const res = makeRes();
        const next = sinon.stub();

        requireOrgRole('owner')(req, res, next);

        expect(res.status.calledWith(403)).toBe(true);
        expect(next.notCalled).toBe(true);
    });
});
