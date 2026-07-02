const express = require('express');
const assetController = require('../controllers/assetController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg } = require('../middlewares/tenantScope');
const { requireActiveSubscriptionForWrites } = require('../middlewares/billing');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// All asset-register routes are authenticated and scoped to the caller's org.
// Write verbs additionally require an active subscription (no-op until
// BILLING_ENFORCED); reads always pass.
router.use(authenticateToken, scopeToOrg, requireActiveSubscriptionForWrites);

router.get('/', assetController.listAssets);
router.post('/', assetController.createAsset);
router.patch('/:id', assetController.updateAsset);
router.delete('/:id', assetController.deleteAsset);

module.exports = router;
