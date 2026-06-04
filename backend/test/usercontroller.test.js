/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { expect } = require('@jest/globals');

const userController = require('../src/controllers/userController');
const userModel = require('../src/models/userModel');

describe('User Controller Functions', () => {
  let req, res;

  beforeEach(() => {
    req = { body: {}, params: {}, query: {}, pool: {}, user: {}, headers: {} };
    res = { status: sinon.stub().returnsThis(), json: sinon.stub() };
  });

  afterEach(() => {
    sinon.restore();
  });

  // ---- createUser ---------------------------------------------------------
  describe('createUser', () => {
    it('should return 401 when no auth token is present', async () => {
      req.body = { fname: 'John', sname: 'Doe', email: 'john@example.com', password: 'pw' };
      await userController.createUser(req, res);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'Authentication token is required.' })).toBe(true);
    });

    it('should create a user and return 201 with a token', async () => {
      req.headers = { authorization: 'Bearer existing.token' };
      req.body = {
        fname: 'John',
        sname: 'Doe',
        email: 'john@example.com',
        password: 'password123',
        date_of_birth: '1990-01-01',
      };
      sinon.stub(userModel, 'isEmailUnique').resolves(true);
      sinon.stub(userModel, 'createUser').resolves({ id: 1, email: 'john@example.com', role: 'user' });
      sinon.stub(bcrypt, 'hash').resolves('hashed');
      sinon.stub(jwt, 'sign').returns('testtoken');
      await userController.createUser(req, res);
      // createUser delegates the response to an un-awaited image-upload callback;
      // let that microtask chain settle before asserting.
      await new Promise((resolve) => setImmediate(resolve));
      expect(res.status.calledWith(201)).toBe(true);
      expect(res.json.calledWithMatch({ token: 'testtoken' })).toBe(true);
    });
  });

  // ---- login --------------------------------------------------------------
  describe('login', () => {
    it('should return 400 for missing email or password', async () => {
      req.body = { email: '', password: '' };
      await userController.login(req, res);
      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'Invalid email or password.' })).toBe(true);
    });

    it('should return 401 for unknown email', async () => {
      req.body = { email: 'nope@example.com', password: 'password123' };
      sinon.stub(userModel, 'getUserPasswordByEmail').resolves(null);
      await userController.login(req, res);
      expect(res.status.calledWith(401)).toBe(true);
    });

    it('should return 401 for invalid password', async () => {
      req.body = { email: 'john@example.com', password: 'wrong' };
      sinon.stub(userModel, 'getUserPasswordByEmail').resolves({ id: 1, password_hash: 'hash' });
      sinon.stub(bcrypt, 'compare').resolves(false);
      await userController.login(req, res);
      expect(res.status.calledWith(401)).toBe(true);
    });

    it('should return 200 and a token with org claims for a valid login', async () => {
      req.body = { email: 'john@example.com', password: 'password123' };
      sinon.stub(userModel, 'getUserPasswordByEmail').resolves({
        id: 1, email: 'john@example.com', role: 'user', password_hash: 'hash',
        org_id: 'org-1', org_role: 'owner', platform_role: 'user',
      });
      sinon.stub(bcrypt, 'compare').resolves(true);
      const signStub = sinon.stub(jwt, 'sign').returns('testtoken');
      await userController.login(req, res);
      expect(res.status.calledWith(200)).toBe(true);
      expect(res.json.calledWithMatch({ token: 'testtoken' })).toBe(true);
      // org context must be part of the signed payload (Task 4)
      expect(signStub.firstCall.args[0]).toMatchObject({
        userId: 1, role: 'user', orgId: 'org-1', orgRole: 'owner', platformRole: 'user',
      });
    });
  });

  // ---- requestPasswordReset ----------------------------------------------
  describe('requestPasswordReset', () => {
    it('should return 404 if user not found', async () => {
      req.body = { email: 'nope@example.com' };
      sinon.stub(userModel, 'getUserByEmail').resolves(null);
      await userController.requestPasswordReset(req, res);
      expect(res.status.calledWith(404)).toBe(true);
    });

    it('should send a reset email and return 200', async () => {
      req.body = { email: 'john@example.com' };
      sinon.stub(userModel, 'getUserByEmail').resolves({ id: 1, email: 'john@example.com' });
      sinon.stub(jwt, 'sign').returns('resettoken');
      const sendMail = sinon.stub().resolves(true);
      sinon.stub(nodemailer, 'createTransport').returns({ sendMail });
      await userController.requestPasswordReset(req, res);
      expect(res.status.calledWith(200)).toBe(true);
      expect(sendMail.calledOnce).toBe(true);
    });
  });

  // ---- inviteUser ---------------------------------------------------------
  describe('inviteUser', () => {
    it('should return 400 if email is missing', async () => {
      req.body = { email: '' };
      await userController.inviteUser(req, res);
      expect(res.status.calledWith(400)).toBe(true);
    });

    it('should return 400 if user already exists', async () => {
      req.body = { email: 'existing@example.com' };
      sinon.stub(userModel, 'getUserByEmail').resolves({ email: 'existing@example.com' });
      await userController.inviteUser(req, res);
      expect(res.status.calledWith(400)).toBe(true);
    });

    it('should send an invite email and return 200 if the user does not exist', async () => {
      req.body = { email: 'newuser@example.com' };
      sinon.stub(userModel, 'getUserByEmail').resolves(null);
      sinon.stub(jwt, 'sign').returns('inviteToken');
      // inviteUser uses the callback form: sendMail(opts, cb)
      const sendMail = sinon.stub().callsArgWith(1, null, { response: 'ok' });
      sinon.stub(nodemailer, 'createTransport').returns({ sendMail });
      await userController.inviteUser(req, res);
      expect(res.status.calledWith(200)).toBe(true);
      expect(sendMail.calledOnce).toBe(true);
    });
  });
});
