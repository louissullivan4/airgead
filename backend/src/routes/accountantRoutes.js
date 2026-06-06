const express = require('express');
const accountantController = require('../controllers/accountantController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg, requireOrgRole } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// All accountant routes are authenticated and scoped to the caller's org. The
// per-client link check (assertClientAccess) runs inside each handler.
router.use(authenticateToken, scopeToOrg);

router.get('/clients', accountantController.listClients);
router.get('/clients/:clientOrgId/transactions', accountantController.getClientTransactions);
router.get('/clients/:clientOrgId/export', accountantController.exportClient);
router.delete('/clients/:clientOrgId/link', accountantController.revokeClient);
// Reassign a client to another accountant — firm admin (owner) only.
router.patch('/clients/:clientOrgId/assign', requireOrgRole('owner'), accountantController.reassignClient);

module.exports = router;
