const express = require('express');
const organisationController = require('../controllers/organisationController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg, requireOrgRole } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// All organisation routes are authenticated and scoped to the caller's org.
router.use(authenticateToken, scopeToOrg);

router.get('/:id', organisationController.getOrganisation);
router.get('/:id/categories', organisationController.getCategories);
// Editing org profile / categories is owner-only.
router.patch('/:id', requireOrgRole('owner'), organisationController.updateOrganisation);

module.exports = router;
