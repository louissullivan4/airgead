const express = require('express');
const organisationController = require('../controllers/organisationController');
const accountantController = require('../controllers/accountantController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg, requireOrgRole, requireAccountantPractice } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// All organisation routes are authenticated and scoped to the caller's org.
router.use(authenticateToken, scopeToOrg);

router.get('/:id', organisationController.getOrganisation);
router.get('/:id/categories', organisationController.getCategories);
// Editing org profile / categories is owner-only.
router.patch('/:id', requireOrgRole('owner'), organisationController.updateOrganisation);

// Org-admin (owner) team management within their own org.
router.get('/:id/members', requireOrgRole('owner'), organisationController.getMembers);
router.post('/:id/invite-member', requireOrgRole('owner'), organisationController.inviteMember);

// Accountant practice → client invite (practice-only).
router.post('/:id/invite-client', requireAccountantPractice, accountantController.inviteClient);

module.exports = router;
