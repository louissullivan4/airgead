/* eslint-disable no-undef */
const sinon = require('sinon');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { expect } = require('@jest/globals');

const userController = require('../src/controllers/userController');
const userModel = require('../src/models/userModel');

describe('User Controller Functions', () => {
  let req, res, next;

  beforeEach(() => {
    req = { body: {}, params: {}, pool: {}, user: {} };
    res = { status: sinon.stub().returnsThis(), json: sinon.stub() };
    next = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
  });

  // Test createUser
  describe('createUser', () => {
    it('should return 400 if required fields are missing', async () => {
      req.body = { fname: 'John', email: 'john@example.com' };
      await userController.createUser(req, res);
      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'First name, surname, email, password, and date of birth are required.' })).toBe(true);
    });

    it('should return 400 if user already exists', async () => {
      req.body = {
        fname: 'John',
        sname: 'Doe',
        email: 'john@example.com',
        password: 'password123',
        date_of_birth: '1990-01-01',
      };
      sinon.stub(userModel, 'getUserByEmail').resolves({ id: 1 });
      await userController.createUser(req, res);
      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'User with this email already exists.' })).toBe(true);
    });

    it('should create a user and return 201', async () => {
      req.body = {
        fname: 'John',
        sname: 'Doe',
        email: 'john@example.com',
        password: 'password123',
        date_of_birth: '1990-01-01',
      };
      sinon.stub(userModel, 'getUserByEmail').resolves(null);
      sinon.stub(userModel, 'createUser').resolves({ id: 1, email: 'john@example.com' });
      sinon.stub(jwt, 'sign').returns('testtoken');
      await userController.createUser(req, res);
      expect(res.status.calledWith(201)).toBe(true);
      expect(res.json.calledWithMatch({ token: 'testtoken' })).toBe(true);
    });
  });

  // Test login
  describe('login', () => {
    it('should return 400 for missing email or password', async () => {
      req.body = { email: '', password: '' };
      await userController.login(req, res);
      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'Invalid email or password.' })).toBe(true);
    });

    it('should return 401 for invalid email', async () => {
      req.body = { email: 'nonexistent@example.com', password: 'password123' };
      sinon.stub(userModel, 'getUserByEmail').resolves(null);
      await userController.login(req, res);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'Invalid email or password.' })).toBe(true);
    });

    it('should return 401 for invalid password', async () => {
      req.body = { email: 'john@example.com', password: 'wrongpassword' };
      sinon.stub(userModel, 'getUserByEmail').resolves({ email: 'john@example.com', password_hash: 'correcthash' });
      sinon.stub(bcrypt, 'compare').resolves(false);
      await userController.login(req, res);
      expect(res.status.calledWith(401)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'Invalid email or password.' })).toBe(true);
    });

    it('should return 200 and a token for successful login', async () => {
      req.body = { email: 'john@example.com', password: 'password123' };
      sinon.stub(userModel, 'getUserByEmail').resolves({ id: 1, email: 'john@example.com', password_hash: 'hashedpassword' });
      sinon.stub(bcrypt, 'compare').resolves(true);
      sinon.stub(jwt, 'sign').returns('testtoken');
      await userController.login(req, res);
      expect(res.status.calledWith(200)).toBe(true);
      expect(res.json.calledWithMatch({ token: 'testtoken' })).toBe(true);
    });
  });

  // Test requestPasswordReset
  describe('requestPasswordReset', () => {
    it('should return 404 if user not found', async () => {
      req.body = { email: 'nonexistent@example.com' };
      sinon.stub(userModel, 'getUserByEmail').resolves(null);
      await userController.requestPasswordReset(req, res);
      expect(res.status.calledWith(404)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'User not found.' })).toBe(true);
    });

    it('should send password reset email and return 200', async () => {
      req.body = { email: 'john@example.com' };
      sinon.stub(userModel, 'getUserByEmail').resolves({ id: 1, email: 'john@example.com' });
      sinon.stub(jwt, 'sign').returns('testtoken');
      const sendMailStub = sinon.stub(nodemailer.createTransport(), 'sendMail').resolves(true);
      await userController.requestPasswordReset(req, res);
      expect(res.status.calledWith(200)).toBe(true);
      expect(sendMailStub.calledOnce).toBe(true);
    });
  });

  // Test inviteUser
  describe('inviteUser', () => {
    it('should return 400 if email is missing', async () => {
      req.body = { email: '' };
      await userController.inviteUser(req, res);
      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'Email is required.' })).toBe(true);
    });

    it('should return 400 if user already exists', async () => {
      req.body = { email: 'existing@example.com' };
      sinon.stub(userModel, 'getUserByEmail').resolves({ email: 'existing@example.com' });
      await userController.inviteUser(req, res);
      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledWithMatch({ error: 'User with this email already exists.' })).toBe(true);
    });

    it('should send invite email if user does not exist', async () => {
      req.body = { email: 'newuser@example.com' };
      sinon.stub(userModel, 'getUserByEmail').resolves(null);
      sinon.stub(jwt, 'sign').returns('inviteToken');
      const sendMailStub = sinon.stub(nodemailer.createTransport(), 'sendMail').resolves(true);
      await userController.inviteUser(req, res);
      expect(res.status.calledWith(200)).toBe(true);
      expect(sendMailStub.calledOnce).toBe(true);
    });
  });
});
