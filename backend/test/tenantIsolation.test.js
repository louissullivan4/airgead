/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const jwt = require('jsonwebtoken');
const { expect } = require('@jest/globals');

const expenseController = require('../src/controllers/expenseController');
const expenseModel = require('../src/models/expenseModel');
const userModel = require('../src/models/userModel');
const { authenticateToken } = require('../src/middlewares/authMiddleware');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub(), sendStatus: sinon.stub() });

describe('Tenant isolation', () => {
  afterEach(() => sinon.restore());

  // (a) user A cannot read user B's expenses when B is in another org
  describe('cross-org expense access', () => {
    it('returns 403 when the target user is not in the caller org', async () => {
      const req = {
        pool: {},
        params: { id: 'user-B' },
        user: { userId: 'user-A', orgId: 'org-A', role: 'user', platformRole: 'user' },
      };
      const res = makeRes();
      const inOrg = sinon.stub(userModel, 'isUserInOrg').resolves(false);
      const modelCall = sinon.stub(expenseModel, 'getExpensesByUserId').resolves([]);

      await expenseController.getExpensesByUserId(req, res);

      expect(inOrg.calledOnceWith(req.pool, 'user-B', 'org-A')).toBe(true);
      expect(res.status.calledWith(403)).toBe(true);
      expect(modelCall.notCalled).toBe(true); // never reached the data layer
    });

    it('allows access and scopes to the org when the target user is in the caller org', async () => {
      const req = {
        pool: {},
        params: { id: 'user-B' },
        user: { userId: 'user-A', orgId: 'org-A', role: 'accountant', platformRole: 'user' },
      };
      const res = makeRes();
      sinon.stub(userModel, 'isUserInOrg').resolves(true);
      const modelCall = sinon.stub(expenseModel, 'getExpensesByUserId').resolves([{ id: 1 }]);

      await expenseController.getExpensesByUserId(req, res);

      // org id is passed through to the model so the query stays scoped
      expect(modelCall.calledOnceWith(req.pool, 'user-B', 'org-A')).toBe(true);
      expect(res.status.calledWith(200)).toBe(true);
    });

    it('lets a super_admin bypass org scoping (orgId = null)', async () => {
      const req = {
        pool: {},
        params: { id: 'user-B' },
        user: { userId: 'admin', orgId: 'org-A', role: 'admin', platformRole: 'super_admin' },
      };
      const res = makeRes();
      const inOrg = sinon.stub(userModel, 'isUserInOrg').resolves(false);
      const modelCall = sinon.stub(expenseModel, 'getExpensesByUserId').resolves([]);

      await expenseController.getExpensesByUserId(req, res);

      expect(inOrg.notCalled).toBe(true);             // membership check skipped
      expect(modelCall.calledOnceWith(req.pool, 'user-B', null)).toBe(true); // unscoped
      expect(res.status.calledWith(200)).toBe(true);
    });

    it('returns 404 when an expense id is not visible to the caller org', async () => {
      const req = {
        pool: {},
        params: { id: 'exp-1' },
        user: { userId: 'user-A', orgId: 'org-A', role: 'user', platformRole: 'user' },
      };
      const res = makeRes();
      // org-scoped query finds nothing -> null
      sinon.stub(expenseModel, 'getExpenseById').resolves(null);

      await expenseController.getExpenseById(req, res);

      expect(res.status.calledWith(404)).toBe(true);
    });
  });

  // (b) a token without orgId must force re-login (401), never crash
  describe('authenticateToken with a pre-Phase-0 token', () => {
    it('returns 401 when the token carries no orgId', () => {
      const legacyToken = jwt.sign({ userId: 1, role: 'user' }, process.env.JWT_SECRET);
      const req = { headers: { authorization: `Bearer ${legacyToken}` } };
      const res = makeRes();
      const next = sinon.stub();

      authenticateToken(req, res, next);

      expect(res.status.calledWith(401)).toBe(true);
      expect(next.notCalled).toBe(true);
    });

    it('calls next when the token carries an orgId', () => {
      const goodToken = jwt.sign({ userId: 1, role: 'user', orgId: 'org-A' }, process.env.JWT_SECRET);
      const req = { headers: { authorization: `Bearer ${goodToken}` } };
      const res = makeRes();
      const next = sinon.stub();

      authenticateToken(req, res, next);

      expect(next.calledOnce).toBe(true);
      expect(req.user.orgId).toBe('org-A');
    });
  });

  // (c) suspension is enforced per request (not just at login), so a
  // suspended account/org can't ride out its existing 7-day token
  describe('authenticateToken suspension check', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const makeReq = () => ({
      pool: {},
      headers: {
        authorization: `Bearer ${jwt.sign({ userId: 'u1', role: 'user', orgId: 'org-A' }, process.env.JWT_SECRET)}`,
      },
    });

    it('403s a suspended user mid-session', async () => {
      sinon.stub(userModel, 'getAccountStatuses').resolves({ account_status: 'suspended', org_status: 'active' });
      const req = makeReq();
      const res = makeRes();
      const next = sinon.stub();

      authenticateToken(req, res, next);
      await flush();

      expect(res.status.calledWith(403)).toBe(true);
      expect(next.notCalled).toBe(true);
    });

    it('403s a member of a suspended org mid-session', async () => {
      sinon.stub(userModel, 'getAccountStatuses').resolves({ account_status: 'active', org_status: 'suspended' });
      const req = makeReq();
      const res = makeRes();
      const next = sinon.stub();

      authenticateToken(req, res, next);
      await flush();

      expect(res.status.calledWith(403)).toBe(true);
      expect(next.notCalled).toBe(true);
    });

    it('401s when the account no longer exists (deleted mid-session)', async () => {
      sinon.stub(userModel, 'getAccountStatuses').resolves(null);
      const req = makeReq();
      const res = makeRes();
      const next = sinon.stub();

      authenticateToken(req, res, next);
      await flush();

      expect(res.status.calledWith(401)).toBe(true);
      expect(next.notCalled).toBe(true);
    });

    it('passes an active user through', async () => {
      sinon.stub(userModel, 'getAccountStatuses').resolves({ account_status: 'active', org_status: 'active' });
      const req = makeReq();
      const res = makeRes();
      const next = sinon.stub();

      authenticateToken(req, res, next);
      await flush();

      expect(next.calledOnce).toBe(true);
    });

    it('fails open when the status query errors', async () => {
      sinon.stub(userModel, 'getAccountStatuses').rejects(new Error('db down'));
      const req = makeReq();
      const res = makeRes();
      const next = sinon.stub();

      authenticateToken(req, res, next);
      await flush();

      expect(next.calledOnce).toBe(true);
    });
  });
});
