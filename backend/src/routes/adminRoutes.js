const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { requirePlatformRole } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// Platform-wide surface: super_admin only.
router.use(authenticateToken, requirePlatformRole('super_admin'));

router.get('/overview', adminController.getOverview);
router.get('/orgs', adminController.listOrgs);
router.get('/practice-applications', adminController.listPracticeApplications);
router.get('/users', adminController.listUsers);
router.post('/invite', adminController.invite);

router.patch('/users/:id/platform-role', adminController.setUserPlatformRole);
router.patch('/users/:id/status', adminController.setUserStatus);
router.delete('/users/:id', adminController.deleteUser);

router.patch('/orgs/:id/status', adminController.setOrgStatus);
router.patch('/orgs/:id/practice-approval', adminController.setPracticeApproval);
router.delete('/orgs/:id', adminController.deleteOrg);

module.exports = router;
