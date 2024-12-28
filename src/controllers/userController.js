
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
require('dotenv').config();
const userModel = require('../models/userModel');
const logger = require('../utils/logger');
const { uploadBase64Image } = require('../middlewares/imageUpload');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const gf = require('../utils/gf');

const jwtSecret = process.env.JWT_SECRET;
const frontendURL = process.env.FRONTEND_URL;

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

        const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, { expiresIn: '168h' });

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

const dashboardLogin = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        logger.warn('Missing email or password for login attempt.');
        return res.status(400).json({ error: 'Authentication requirements not fulfilled.' });
    }

    try {
        const user = await userModel.getUserByEmail(req.pool, email);
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

        const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, { expiresIn: '168h' });

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
        await userModel.updatePassword(req.pool, user.email, hashedPassword);

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

        const transporter = nodemailer.createTransport({
            service: "Gmail",
            host: "smtp.gmail.com",
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
            text: `You have been invited to create an account with EquiLedger. Click the link to create your account: ${inviteLink}`,
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                logger.error("Error sending email: ", error);
            } else {
                logger.info("Email sent: ", info.response);
            }
        });

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

module.exports = {
    createUser,
    getAllUsers,
    getUser,
    getUserByEmail,
    updateUser,
    deleteUser,
    login,
    signup,
    resetPassword,
    requestPasswordReset,
    inviteUser,
    dashboardLogin,
    getAssignedUsers
};