const express = require('express');
const userController = require('../controllers/userController');
const { authenticateToken, authoriseRole } = require('../middlewares/authMiddleware');
const router = express.Router();

router.post('/', userController.createUser);

router.get('/', authenticateToken, authoriseRole(['admin', 'accountant']), userController.getAllUsers);

router.get('/accountant/users', authenticateToken, authoriseRole(['admin', 'accountant']), userController.getAssignedUsers);

// Email-verification link target + resend. Registered BEFORE '/:id' so the
// static path wins; both are unauthenticated by design (the link arrives in
// an email; resend is strict-rate-limited in src/index.js).
router.get('/verify-email', userController.verifyEmail);
router.post('/resend-verification', userController.resendVerification);

router.get('/:id', authenticateToken, userController.getUser);

router.get('/email/:email', authenticateToken, userController.getUserByEmail);

router.patch('/:id', authenticateToken, userController.updateUser)

router.delete('/email/:email', authenticateToken, userController.deleteUser);

router.post('/login', userController.login);

router.post('/signup', userController.signup);

router.post('/register', userController.register);

router.post('/dashboard-login', userController.dashboardLogin);

router.post('/invite', authenticateToken, authoriseRole(['admin', 'accountant']), userController.inviteUser);

router.post('/request-password-reset', userController.requestPasswordReset);
router.post('/reset-password', userController.resetPassword);

router.post('/support', userController.sendSupportEmail)

module.exports = router;
