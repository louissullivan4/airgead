/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const jwt = require('jsonwebtoken');
const { expect } = require('@jest/globals');

const adminController = require('../src/controllers/adminController');
const adminModel = require('../src/models/adminModel');
const userModel = require('../src/models/userModel');
const organisationModel = require('../src/models/organisationModel');
const userController = require('../src/controllers/userController');
const storage = require('../src/utils/storage');
const { requirePlatformRole } = require('../src/middlewares/tenantScope');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub() });

describe('Phase 4 — super-admin route guard', () => {
  afterEach(() => sinon.restore());

  it('403s a non-super_admin', () => {
    const req = { user: { platformRole: 'user' } };
    const res = makeRes();
    const next = sinon.stub();
    requirePlatformRole('super_admin')(req, res, next);
    expect(res.status.calledWith(403)).toBe(true);
    expect(next.notCalled).toBe(true);
  });

  it('passes a super_admin', () => {
    const req = { user: { platformRole: 'super_admin' } };
    const res = makeRes();
    const next = sinon.stub();
    requirePlatformRole('super_admin')(req, res, next);
    expect(next.calledOnce).toBe(true);
  });
});

describe('Phase 4 — platform invite', () => {
  afterEach(() => sinon.restore());

  const reqFor = (body) => ({ pool: {}, body, user: { userId: 'super', orgId: 'plat', platformRole: 'super_admin' } });

  it('accountant invite signs a platform token flagged as a practice', async () => {
    sinon.stub(userModel, 'getUserByEmail').resolves(null);
    const send = sinon.stub(userController, 'sendInviteEmail').resolves();
    const res = makeRes();

    await adminController.invite(reqFor({ email: 'a@x.ie', kind: 'accountant' }), res);

    expect(res.status.calledWith(200)).toBe(true);
    const link = send.firstCall.args[1];
    const token = link.split('token=')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.kind).toBe('platform');
    expect(decoded.is_accountant_practice).toBe(true);
    expect(decoded.email).toBe('a@x.ie');
  });

  it('regular user invite is not flagged as a practice', async () => {
    sinon.stub(userModel, 'getUserByEmail').resolves(null);
    const send = sinon.stub(userController, 'sendInviteEmail').resolves();
    const res = makeRes();

    await adminController.invite(reqFor({ email: 'u@x.ie', kind: 'user' }), res);

    const token = send.firstCall.args[1].split('token=')[1];
    expect(jwt.verify(token, process.env.JWT_SECRET).is_accountant_practice).toBe(false);
  });

  it('rejects an unknown kind', async () => {
    const res = makeRes();
    await adminController.invite(reqFor({ email: 'x@x.ie', kind: 'wat' }), res);
    expect(res.status.calledWith(400)).toBe(true);
  });
});

describe('Phase 4 — role/status guards (no self-targeting)', () => {
  afterEach(() => sinon.restore());

  it('refuses to change your own platform role', async () => {
    const req = { pool: {}, params: { id: 'me' }, body: { platformRole: 'user' }, user: { userId: 'me' } };
    const res = makeRes();
    const upd = sinon.stub(userModel, 'updateUserById').resolves({});
    await adminController.setUserPlatformRole(req, res);
    expect(res.status.calledWith(400)).toBe(true);
    expect(upd.notCalled).toBe(true);
  });

  it('refuses to suspend your own org', async () => {
    const req = { pool: {}, params: { id: 'plat' }, body: { status: 'suspended' }, user: { userId: 'super', orgId: 'plat' } };
    const res = makeRes();
    const upd = sinon.stub(organisationModel, 'updateOrg').resolves({});
    await adminController.setOrgStatus(req, res);
    expect(res.status.calledWith(400)).toBe(true);
    expect(upd.notCalled).toBe(true);
  });

  it('suspends another user via the model', async () => {
    const req = { pool: {}, params: { id: 'u2' }, body: { status: 'suspended' }, user: { userId: 'me' } };
    const res = makeRes();
    const upd = sinon.stub(userModel, 'updateUserById').resolves({ id: 'u2' });
    await adminController.setUserStatus(req, res);
    expect(upd.calledOnceWith(req.pool, 'u2', { account_status: 'suspended' })).toBe(true);
    expect(res.status.calledWith(200)).toBe(true);
  });
});

describe('Phase 4 — GDPR delete', () => {
  afterEach(() => sinon.restore());

  it('deletes a plain member via deleteUserCascade and cleans images', async () => {
    const req = {
      pool: { query: sinon.stub().resolves({ rows: [] }) }, // owns no org
      params: { id: 'member-1' },
      user: { userId: 'super', orgId: 'plat' },
    };
    const res = makeRes();
    sinon.stub(userModel, 'getUserById').resolves({ id: 'member-1' });
    const cascade = sinon.stub(adminModel, 'deleteUserCascade').resolves(['org_x/2026/a.jpg']);
    const del = sinon.stub(storage, 'deleteObject').resolves();

    await adminController.deleteUser(req, res);

    expect(cascade.calledOnceWith(req.pool, 'member-1')).toBe(true);
    expect(del.calledWith('org_x/2026/a.jpg')).toBe(true);
    expect(res.status.calledWith(200)).toBe(true);
  });

  it('409s when the user owns an org with other members', async () => {
    const req = {
      pool: { query: sinon.stub() },
      params: { id: 'owner-1' },
      user: { userId: 'super', orgId: 'plat' },
    };
    // 1st query: owned orgs; 2nd: member count
    req.pool.query.onCall(0).resolves({ rows: [{ id: 'org-1' }] });
    req.pool.query.onCall(1).resolves({ rows: [{ n: 3 }] });
    const res = makeRes();
    sinon.stub(userModel, 'getUserById').resolves({ id: 'owner-1' });
    const orgCascade = sinon.stub(adminModel, 'deleteOrgCascade').resolves([]);

    await adminController.deleteUser(req, res);

    expect(res.status.calledWith(409)).toBe(true);
    expect(orgCascade.notCalled).toBe(true);
  });

  it('deletes a sole-owner user by cascading their org', async () => {
    const req = {
      pool: { query: sinon.stub() },
      params: { id: 'solo-1' },
      user: { userId: 'super', orgId: 'plat' },
    };
    req.pool.query.onCall(0).resolves({ rows: [{ id: 'org-solo' }] });
    req.pool.query.onCall(1).resolves({ rows: [{ n: 1 }] });
    const res = makeRes();
    sinon.stub(userModel, 'getUserById').resolves({ id: 'solo-1' });
    const orgCascade = sinon.stub(adminModel, 'deleteOrgCascade').resolves([]);
    sinon.stub(storage, 'deleteObject').resolves();

    await adminController.deleteUser(req, res);

    expect(orgCascade.calledOnceWith(req.pool, 'org-solo')).toBe(true);
    expect(res.status.calledWith(200)).toBe(true);
  });

  it('refuses to delete your own org', async () => {
    const req = { pool: {}, params: { id: 'plat' }, user: { userId: 'super', orgId: 'plat' } };
    const res = makeRes();
    const orgCascade = sinon.stub(adminModel, 'deleteOrgCascade').resolves([]);
    await adminController.deleteOrg(req, res);
    expect(res.status.calledWith(400)).toBe(true);
    expect(orgCascade.notCalled).toBe(true);
  });
});

describe('Phase 4 — login blocks suspended accounts', () => {
  afterEach(() => sinon.restore());

  const bcrypt = require('bcrypt');

  it('rejects a suspended user', async () => {
    const req = { pool: {}, body: { email: 's@x.ie', password: 'pw' } };
    const res = makeRes();
    sinon.stub(userModel, 'getUserPasswordByEmail').resolves({
      id: 'u', email: 's@x.ie', password_hash: 'h', account_status: 'suspended', org_id: 'o',
    });
    sinon.stub(bcrypt, 'compare').resolves(true);
    await userController.login(req, res);
    expect(res.status.calledWith(403)).toBe(true);
  });

  it('rejects a user whose org is suspended', async () => {
    const req = { pool: {}, body: { email: 'a@x.ie', password: 'pw' } };
    const res = makeRes();
    sinon.stub(userModel, 'getUserPasswordByEmail').resolves({
      id: 'u', email: 'a@x.ie', password_hash: 'h', account_status: 'active', org_id: 'o',
    });
    sinon.stub(bcrypt, 'compare').resolves(true);
    sinon.stub(organisationModel, 'getOrgById').resolves({ id: 'o', status: 'suspended' });
    await userController.login(req, res);
    expect(res.status.calledWith(403)).toBe(true);
  });
});
