const express = require('express');
const receiptController = require('../controllers/receiptController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// All receipt routes are authenticated and scoped to the caller's org.
router.use(authenticateToken, scopeToOrg);

router.post('/process', receiptController.processReceipt);
router.post('/:id/expenses', receiptController.createReceiptExpenses);
router.get('/:id/image-url', receiptController.getReceiptImageUrl);
router.get('/:id', receiptController.getReceipt);

module.exports = router;
