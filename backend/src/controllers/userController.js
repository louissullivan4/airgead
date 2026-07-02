
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
require('dotenv').config();
const userModel = require('../models/userModel');
const organisationModel = require('../models/organisationModel');
const seatSync = require('../services/billing/seatSync');
const logger = require('../utils/logger');
const { uploadBase64Image } = require('../middlewares/imageUpload');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const gf = require('../utils/gf');
const { BRAND } = require('../config/brand');
const { isSuperAdmin } = require('../middlewares/tenantScope');

const jwtSecret = process.env.JWT_SECRET;
const frontendURL = process.env.FRONTEND_URL;

// Shared invite email sender for both invite kinds (member + client). Keeps the
// Gmail transport config in one place. Throws on send failure so callers decide
// how to respond.
const sendInviteEmail = async (email, inviteLink) => {
    const transporter = nodemailer.createTransport({
        service: 'Gmail',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    const mailOptions = {
        from: process.env.EMAIL_USERNAME,
        to: email,
        subject: 'You have been invited to create an account!',
        text: `You have been invited to create an account with ${BRAND}. Click the link to create your account: ${inviteLink}`,
    };

    await transporter.sendMail(mailOptions);
};

// Phase 6 email verification. Self-serve signups must confirm their address
// via a signed 24h link; anyone who arrived through an invite token already
// proved the address (the invite landed in it) and is stamped at creation.
// Enforcement (the login block after the grace window) is skippable with
// REQUIRE_EMAIL_VERIFICATION=false for dev.
const VERIFY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const requireEmailVerification = () => process.env.REQUIRE_EMAIL_VERIFICATION !== 'false';

const sendVerificationEmail = async (email) => {
    const verifyToken = jwt.sign({ email, kind: 'verify' }, jwtSecret, { expiresIn: '24h' });
    // The link hits the BACKEND (which stamps and then bounces to the login
    // page), so it is built from the backend's public URL, not FRONTEND_URL.
    const backendBase = (process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, '');
    const verifyLink = `${backendBase}/users/verify-email?token=${verifyToken}`;

    const transporter = nodemailer.createTransport({
        service: 'Gmail',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    await transporter.sendMail({
        from: process.env.EMAIL_USERNAME,
        to: email,
        subject: `Verify your ${BRAND} email address`,
        text: `Welcome to ${BRAND}! Please confirm your email address by clicking this link (valid for 24 hours): ${verifyLink}\n\nIf the link expires, you can request a new one from the app.`,
    });
};

const createUser = async (req, res) => {
    try {
        const token = gf.extractToken(req);
        if (!token) {
            logger.error('Missing token for user creation.');
            return res.status(401).json({ error: 'Authentication token is required.' });
        }

        const userData = extractCreateUserData(req);

        await userModel.isEmailUnique(req.pool, userData.email);

        uploadBase64Image(req, res, async (err) => {
            if (err) {
                logger.error('Image upload error: %s', err.message);
                return res.status(400).json({ error: err.message });
            }

            userData.password = await gf.hashPassword(userData.password);
            userData.id_image_url = req.body.image;

            const newUser = await userModel.createUser(req.pool, userData);

            const newToken = gf.generateJwtToken(newUser);

            logger.info('User created successfully: %s', newUser.email);
            res.status(201).json(formatUserResponse(newUser, newToken));
        });
    } catch (error) {
        logger.error('Error creating user: %s', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

function extractCreateUserData(req) {
    const {
        fname,
        mname,
        sname,
        email,
        phone_number,
        date_of_birth,
        ppsno,
        address_line1,
        address_line2,
        city,
        county,
        country,
        tax_status,
        marital_status,
        postal_code,
        occupation,
        currency,
        password,
        inviter_id,
        image
    } = req.body;

    return {
        fname,
        mname,
        sname,
        email,
        phone_number,
        date_of_birth,
        ppsno,
        address_line1,
        address_line2,
        city,
        county,
        country,
        tax_status,
        marital_status,
        postal_code,
        occupation,
        currency,
        password,
        inviter_id,
        image,
        id_image_url : null,
        filename: `${uuidv4}_${fname.toLowerCase()}_${sname.toLowerCase()}_${moment().format('YYYY-MM-DD')}_id`,
    }
}

function formatUserResponse(user, token) {
    return {
        id: user.id,
        fname: user.fname,
        sname: user.sname,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        token: token,
    };
}


const getUser = async (req, res) => {
    const { id } = req.params;
    try {
        const user = await userModel.getUserById(req.pool, id);
        if (!user) {
            logger.warn('User not found with ID: %s', id);
            return res.status(404).json({ error: 'User not found.' });
        }
        if (!isSuperAdmin(req) && !(await userModel.isUserInOrg(req.pool, id, req.user.orgId))) {
            logger.warn('Cross-org user access attempt by %s for user %s', req.user.userId, id);
            return res.status(403).json({ error: 'Access denied. You do not have permission to access this user.' });
        }
        logger.info('Fetched user with ID: %s', id);
        res.status(200).json(user);
    } catch (error) {
        logger.error('Error retrieving user: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const getUserByEmail = async (req, res) => {
    const { email } = req.params;

    try {
        const user = await userModel.getUserByEmail(req.pool, email);
        if (!user) {
            logger.warn('User not found with email: %s', email);
            return res.status(404).json({ error: 'User not found.' });
        }
        if (!isSuperAdmin(req) && !(await userModel.isUserInOrg(req.pool, user.id, req.user.orgId))) {
            logger.warn('Cross-org user access attempt by %s for email %s', req.user.userId, email);
            return res.status(403).json({ error: 'Access denied. You do not have permission to access this user.' });
        }
        logger.info('Fetched user with email: %s', email);
        res.status(200).json(user);
    } catch (error) {
        logger.error('Error retrieving user by email: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const updateUser = async (req, res) => {
    const { id } = req.params;
    const updateFields = req.body;

    try {
      if (!isSuperAdmin(req) && !(await userModel.isUserInOrg(req.pool, id, req.user.orgId))) {
        logger.warn('Cross-org user update attempt by %s for user %s', req.user.userId, id);
        return res.status(403).json({ error: 'Access denied. You do not have permission to update this user.' });
      }
      const updatedUser = await userModel.updateUserById(req.pool, id, updateFields);
  
      if (!updatedUser) {
        logger.warn('User not found with ID: %s', id);
        return res.status(404).json({ error: 'User not found.' });
      }
  
      logger.info('Updated user with ID: %s', id);
      return res.status(200).json(updatedUser);
    } catch (error) {
      logger.error('Error updating user: %s', error.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  };

const deleteUser = async (req, res) => {
    const { email } = req.params;
    const currentUserId = req.user.userId;

    if (!email) {
        logger.warn('Missing email for deleting user.');
        return res.status(400).json({ error: 'Email is required.' });
    }

    try {
        const userToDelete = await userModel.getUserByEmail(req.pool, email);
        if (!userToDelete) {
            logger.warn('User not found for deletion with email: %s', email);
            return res.status(404).json({ error: 'User not found.' });
        }

        const currentUser = await userModel.getUserById(req.pool, currentUserId);

        if (currentUser.email !== email && !['admin', 'accountant'].includes(currentUser.role)) {
            logger.warn('Unauthorized delete attempt by user: %s for user email: %s', currentUser.email, email);
            return res.status(403).json({ error: 'Access denied. You do not have the required permissions.' });
        }

        await userModel.deleteUserByEmail(req.pool, email);

        logger.info('User deleted successfully: %s', email);
        res.status(200).json({ message: 'User deleted successfully.' });
    } catch (error) {
        logger.error('Error deleting user: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        logger.warn('Missing email or password for login attempt.');
        return res.status(400).json({ error: 'Invalid email or password.' });
    }

    try {
        const user = await userModel.getUserPasswordByEmail(req.pool, email);
        if (!user) {
            logger.warn('Invalid login attempt for email: %s', email);
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            logger.warn('Invalid password for email: %s', email);
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Phase 4: a suspended user, or a member of a suspended org, cannot log
        // in (super_admin suspends for e.g. non-payment; reactivation restores).
        if (user.account_status === 'suspended') {
            logger.warn('Login blocked for suspended user: %s', email);
            return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
        }
        const loginOrg = user.org_id ? await organisationModel.getOrgById(req.pool, user.org_id) : null;
        if (loginOrg && loginOrg.status === 'suspended') {
            logger.warn('Login blocked for suspended org: %s', loginOrg.id);
            return res.status(403).json({ error: 'This organisation has been suspended. Please contact support.' });
        }

        // Phase 6: self-serve accounts must verify their address, with a
        // 7-day grace window so day-one friction stays zero. Invite arrivals
        // were stamped verified at creation and never hit this.
        if (requireEmailVerification() && !user.email_verified_at) {
            const createdAt = user.created_at ? new Date(user.created_at).getTime() : NaN;
            // An unparseable/missing created_at counts as WITHIN grace -
            // missing data must never lock someone out of their books.
            const withinGrace = !Number.isFinite(createdAt) || Date.now() - createdAt <= VERIFY_GRACE_MS;
            if (!withinGrace) {
                logger.warn('Login blocked for unverified email: %s', email);
                return res.status(403).json({
                    error: 'Please verify your email address to continue - check your inbox for the link, or request a new one.',
                    code: 'email_unverified',
                });
            }
        }

        const token = gf.generateJwtToken(user);

        logger.info('User logged in successfully: ', {
            id: user.id,
            name: user.fname,
            email: user.email,
            role: user.role,
        });
        res.status(200).json({
            id: user.id,
            name: user.fname,
            email: user.email,
            role: user.role,
            token,
        });
    } catch (error) {
        logger.error('Error during login: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const signup = async (req, res) => {
    const { email, password, token } = req.body;

    if (token) {
        try {
            const decoded = jwt.verify(token, jwtSecret);
            if (decoded.email !== email) {
                return res.status(400).json({ error: 'Invalid invite token.' });
            }
        } catch (error) {
            logger.warn('Invalid invite token: %s', error.message);
            return res.status(400).json({ error: 'Invalid or expired invite token.' });
        }
    } else {
        logger.warn('Missing token for signing up a user: %o', req.body);
        return res.status(400).json({ error: 'Invalid or expired invite token' });
    }

    if (!email || !password) {
        logger.warn('Missing required fields for signing up a user: %o', req.body);
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const existingUser = await userModel.getUserByEmail(req.pool, email);
        if (existingUser) {
            logger.warn('Attempt to create a user with an existing email: %s', email);
            return res.status(400).json({ error: 'User with this email already exists.' });
        }
        res.status(201).json({
            email: email,
            password: password,
            token: token,
        });
    } catch (error) {
        logger.error('Error creating user: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// Phase 1 signup. Handles both self-serve (no token) and invite-based (token
// from the invite email) registration, provisioning org context so the issued
// JWT carries orgId and the account is immediately usable. Replaces the old
// `signup` stub which only validated an invite and never created a user.
const register = async (req, res) => {
    const { token, fname, sname, email, password, currency } = req.body;

    if (!fname || !sname || !email || !password || !currency) {
        return res.status(400).json({
            error: 'First name, surname, email, password and currency are required.',
        });
    }

    let mode = 'self';
    let inviterId = null;
    let accountantOrgId = null;
    let createdBy = null;
    if (token) {
        try {
            const decoded = jwt.verify(token, jwtSecret);
            if (decoded.email && decoded.email !== email) {
                return res.status(400).json({ error: 'Invite is for a different email address.' });
            }
            if (decoded.kind === 'client') {
                // Client invite: the invitee creates their OWN isolated org
                // (mode stays 'self'); we link it to the inviting practice so
                // the accountant gets read access without joining the org.
                accountantOrgId = decoded.accountant_org_id || null;
                createdBy = decoded.created_by || null;
            } else if (decoded.kind === 'platform') {
                // Super-admin platform invite: the invitee creates their OWN org
                // (mode stays 'self'). 'accountant' invites flag it as a firm.
                if (decoded.is_accountant_practice) {
                    req.body.organisation = { ...(req.body.organisation || {}), is_accountant_practice: true };
                }
            } else {
                // Member invite: join the inviter's existing org.
                inviterId = decoded.inviter_id || null;
                mode = 'invite';
            }
        } catch (error) {
            logger.warn('Invalid invite token on register: %s', error.message);
            return res.status(400).json({ error: 'Invalid or expired invite token.' });
        }
    }

    try {
        const unique = await userModel.isEmailUnique(req.pool, email);
        if (!unique) {
            return res.status(400).json({ error: 'User with this email already exists.' });
        }

        const passwordHash = await gf.hashPassword(password);
        // Arriving through ANY signed invite token proves the address (the
        // token reached that inbox); only genuinely self-serve signups need
        // the verification loop.
        const emailVerified = Boolean(token);
        const newUser = await organisationModel.createUserWithOrg(req.pool, {
            user: { ...req.body, password: passwordHash },
            mode,
            inviterId,
            accountantOrgId,
            createdBy,
            emailVerified,
        });

        if (!emailVerified && requireEmailVerification()) {
            // Best-effort: a mail hiccup must not fail the signup - the user
            // can resend from the banner, and the 7-day grace keeps them in.
            try {
                await sendVerificationEmail(email);
            } catch (mailError) {
                logger.warn('Verification email failed for %s: %s', email, mailError.message);
            }
        }

        // A new client seat changes what the inviting practice pays: sync its
        // Stripe quantity AFTER the signup transaction committed. Best-effort -
        // syncPracticeSeats never throws and no-ops when Stripe is unconfigured.
        if (accountantOrgId) {
            await seatSync.syncPracticeSeats(req.pool, accountantOrgId);
        }

        const newToken = gf.generateJwtToken(newUser);
        logger.info('Account registered: %s (%s)', email, mode);
        return res.status(201).json({
            id: newUser.id,
            name: newUser.fname,
            email: newUser.email,
            role: newUser.role,
            token: newToken,
        });
    } catch (error) {
        logger.error('Error during registration: %s', error.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

const dashboardLogin = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        logger.warn('Missing email or password for login attempt.');
        return res.status(400).json({ error: 'Authentication requirements not fulfilled.' });
    }

    try {
        const user = await userModel.getUserPasswordByEmail(req.pool, email);
        if (!user) {
            logger.warn('Invalid login attempt for email: %s', email);
            return res.status(401).json({ error: 'Authentication requirements not fulfilled.' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            logger.warn('Invalid password for email: %s', email);
            return res.status(401).json({ error: 'Authentication requirements not fulfilled.' });
        }

        let roles = ['admin', 'accountant']
        if (!roles.includes(user.role)) {
            logger.warn('User %s does not have correct role for dashboard. Please contact an admin.', email);
            return res.status(401).json({ error: 'Authentication requirements not fulfilled.' });
        }

        const token = gf.generateJwtToken(user);

        logger.info('User logged in successfully: %s', email);
        res.status(200).json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            token,
        });
    } catch (error) {
        logger.error('Error during login: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const requestPasswordReset = async (req, res) => {
    const { email } = req.body;

    try {
        const user = await userModel.getUserByEmail(req.pool, email);
        if (!user) {
            logger.warn('Password reset requested for non-existing user: %s', email);
            return res.status(404).json({ error: 'User not found.' });
        }

        const resetToken = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '1h' });

        const resetLink = `${frontendURL}/reset-password?token=${resetToken}`;
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASSWORD,
            },
        });
        const mailOptions = {
            from: process.env.EMAIL_USERNAME,
            to: email,
            subject: 'Password Reset',
            text: `You requested a password reset. Click the link to reset your password: ${resetLink}`,
        };
        
        await transporter.sendMail(mailOptions);

        logger.info('Password reset email sent to: %s', email);
        res.status(200).json({ message: 'Password reset email sent.' });
    } catch (error) {
        logger.error('Error requesting password reset: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        const decoded = jwt.verify(token, jwtSecret);
        const user = await userModel.getUserById(req.pool, decoded.userId);
        if (!user) {
            logger.warn('Password reset attempted for non-existing user: %s', decoded.userId);
            return res.status(404).json({ error: 'User not found.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await userModel.updateUserPassword(req.pool, user.email, hashedPassword);

        logger.info('Password reset successfully for user: %s', user.email);
        res.status(200).json({ message: 'Password reset successfully.' });
    } catch (error) {
        logger.error('Error resetting password: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const inviteUser = async (req, res) => {
    const { email, inviterId } = req.body;

    if (!email) {
        logger.error('Email is required for inviting a user.');
        return res.status(400).json({ error: 'Email is required.' });
    }

    try {
        const existingUser = await userModel.getUserByEmail(req.pool, email);
        if (existingUser) {
            logger.error('Invite attempted for existing user: %s', email);
            return res.status(400).json({ error: 'User with this email already exists.' });
        }

        const inviteToken = jwt.sign(
            { email, inviter_id: inviterId },
            jwtSecret,
            { expiresIn: '168h' }
        );

        const inviteLink = `${frontendURL}/signup?token=${inviteToken}`;

        await sendInviteEmail(email, inviteLink);

        logger.info('Invitation email sent to: %s', email);
        res.status(200).json({ message: 'Invitation email sent successfully.' });
    } catch (error) {
        logger.error('Error sending invitation: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const getAllUsers = async (req, res) => {
    try {
        const allUsers = { all_users: await userModel.getAllUsers(req.pool) };
        logger.info('Fetched all users.');
        res.status(200).json(allUsers);
    } catch (error) {
        logger.error('Error fetching users: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

const getAssignedUsers = async (req, res) => {
    const currentUserId = req.user.userId;
    try {
        const assignedUsers = await userModel.getUsersByInviterId(req.pool, currentUserId);
        logger.info('Fetched assigned users for accountant: %s', currentUserId);
        res.status(200).json(assignedUsers);
    } catch (error) {
        logger.error('Error fetching assigned users: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};


const sendSupportEmail = async (req, res) => {
    const { userEmail, issueType, issueDescription } = req.body;
  
    if (!userEmail || !issueType || !issueDescription) {
      logger.error('Email, Type and Issue are required for sending a support request.');
      return res.status(400).json({ error: 'User email is required.' });
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'Gmail',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: process.env.EMAIL_USERNAME,
          pass: process.env.EMAIL_PASSWORD,
        },
      });
  
      const mailOptions = {
        from: process.env.EMAIL_USERNAME,
        to: process.env.EMAIL_USERNAME, 
        subject: `Support Request from ${userEmail}`,
        text: `
        A user has requested support. Details below:

        From: ${userEmail}
        Issue Type: ${issueType}

        Issue Description:
        ${issueDescription}
        `,
      };
  
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          logger.error('Error sending support email:', error);
          return res.status(500).json({ error: 'Error sending support email.' });
        } else {
          logger.info('Support email sent:', info.response);
          return res.status(200).json({ message: 'Support request sent successfully.' });
        }
      });
    } catch (error) {
      logger.error('Error in sendSupportEmail:', error.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  };

// GET /users/verify-email?token= - the link from the verification email.
// A browser click, not an API call: respond with redirects to the login page
// (?verified=1 on success, ?verified=expired on a bad/old token so the page
// can offer a resend).
const verifyEmail = async (req, res) => {
    const { token } = req.query;
    const loginUrl = `${frontendURL || ''}/login`;
    try {
        const decoded = jwt.verify(token, jwtSecret);
        if (decoded.kind !== 'verify' || !decoded.email) {
            throw new Error('not a verification token');
        }
        await userModel.setEmailVerifiedByEmail(req.pool, decoded.email);
        logger.info('Email verified: %s', decoded.email);
        return res.redirect(`${loginUrl}?verified=1`);
    } catch (error) {
        logger.warn('Email verification failed: %s', error.message);
        return res.redirect(`${loginUrl}?verified=expired`);
    }
};

// POST /users/resend-verification { email } - strict-rate-limited in
// src/index.js. Answers identically whether or not the account exists (no
// user enumeration).
const resendVerification = async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    try {
        const user = await userModel.getUserByEmail(req.pool, email);
        if (user && !user.email_verified_at) {
            try {
                await sendVerificationEmail(email);
                logger.info('Verification email re-sent to %s', email);
            } catch (mailError) {
                logger.warn('Resend verification failed for %s: %s', email, mailError.message);
            }
        }
        return res.status(200).json({ message: 'If that address needs verification, a new link is on its way.' });
    } catch (error) {
        logger.error('Error resending verification: %s', error.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = {
    createUser,
    getAllUsers,
    getUser,
    getUserByEmail,
    updateUser,
    deleteUser,
    login,
    signup,
    register,
    resetPassword,
    requestPasswordReset,
    inviteUser,
    dashboardLogin,
    getAssignedUsers,
    sendSupportEmail,
    sendInviteEmail,
    verifyEmail,
    resendVerification,
};