const express = require('express');
const reportController = require('../controllers/reportController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// Reports are authenticated and always about the caller's OWN org.
router.use(authenticateToken, scopeToOrg);

router.get('/tax-summary', reportController.getTaxSummary);

module.exports = router;
