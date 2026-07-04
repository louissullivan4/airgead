const express = require('express');
const sageController = require('../controllers/sageController');
const { requireSageEnabled } = require('../config/sage');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg, requireOrgRole, requireAccountantPractice } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

// Feature flag first: SAGE_ENABLED unset means none of these routes exist.
router.use(requireSageEnabled);
router.use(injectPool);

// The OAuth callback sits ABOVE the auth middleware - the browser arrives
// here straight from Sage with no app JWT. Its signed `state` is the auth.
router.get('/callback', sageController.callback);

router.use(authenticateToken, scopeToOrg);

router.get('/status', sageController.status);
// Managing the connection is owner-only, and only practices can link Sage.
router.post('/connect', requireOrgRole('owner'), requireAccountantPractice, sageController.connect);
router.delete('/connection', requireOrgRole('owner'), requireAccountantPractice, sageController.disconnect);

// Live Sage lookups for the export dialog (any accountant in the practice).
router.get('/businesses', requireAccountantPractice, sageController.listBusinesses);
router.get('/businesses/:businessId/bank-accounts', requireAccountantPractice, sageController.listBankAccounts);
router.get('/businesses/:businessId/ledger-accounts', requireAccountantPractice, sageController.listLedgerAccounts);
router.get('/businesses/:businessId/tax-rates', requireAccountantPractice, sageController.listTaxRates);

module.exports = router;
