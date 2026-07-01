const express = require('express');
const assetController = require('../controllers/assetController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// All asset-register routes are authenticated and scoped to the caller's org.
router.use(authenticateToken, scopeToOrg);

router.get('/', assetController.listAssets);
router.post('/', assetController.createAsset);
router.patch('/:id', assetController.updateAsset);
router.delete('/:id', assetController.deleteAsset);

module.exports = router;
