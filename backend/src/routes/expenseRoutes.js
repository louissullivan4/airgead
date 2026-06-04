const express = require('express');
const expenseController = require('../controllers/expenseController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);
// All expense routes are authenticated and scoped to the caller's org.
router.use(authenticateToken, scopeToOrg);

router.get('/', expenseController.getExpenses);
router.get('/users/:id', expenseController.getExpensesByUserId);
router.get('/users/income/:id', expenseController.getExpensesByUserIdNoIncome);
router.get('/:id', expenseController.getExpenseById);
router.get('/:id/receipt-url', expenseController.getReceiptUrl);
router.get('/users/:id/:year', expenseController.getExpensesByUserIdAndYear);
router.get('/downloads/:id/:year', expenseController.getExcelDownloadByUserIdAndYear);
router.post('/', expenseController.createExpense);
router.put('/:id', expenseController.updateExpense);
router.patch('/:id', expenseController.partialUpdateExpense);
router.delete('/:id', expenseController.deleteExpense);

module.exports = router;
