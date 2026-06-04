const express = require('express');
const expenseController = require('../controllers/expenseController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

router.use(injectPool);

router.get('/', authenticateToken, expenseController.getExpenses);
router.get('/users/:id', authenticateToken, expenseController.getExpensesByUserId);
router.get('/users/income/:id', authenticateToken, expenseController.getExpensesByUserIdNoIncome);
router.get('/:id', authenticateToken, expenseController.getExpenseById);
router.get('/users/:id/:year', authenticateToken, expenseController.getExpensesByUserIdAndYear);
router.get('/downloads/:id/:year', authenticateToken, expenseController.getExcelDownloadByUserIdAndYear);
router.post('/', authenticateToken, expenseController.createExpense);
router.put('/:id', authenticateToken, expenseController.updateExpense);
router.patch('/:id', authenticateToken, expenseController.partialUpdateExpense);
router.delete('/:id', authenticateToken, expenseController.deleteExpense);

module.exports = router;
