import { Router } from 'express';
import {
  transferMoney,
  getAllTransactions,
  getTransactionDetails,
} from '../controllers/transaction.controllers.js';
import { authenticateToken } from '../middleware/authmiddleware.js';

const router = Router();

// Protect all transaction routes with JWT authentication
router.use(authenticateToken);

// Transfer funds endpoint
router.post('/transfer', transferMoney);

// Get paginated transaction history
router.get('/', getAllTransactions);

// Get transaction details by ID (sender or receiver only)
router.get('/:id', getTransactionDetails);

export { router as transactionRouter };
export default router;
