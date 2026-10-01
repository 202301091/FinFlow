import { Router } from 'express';
import {
  transferMoney,
  getAllTransactions,
  getTransactionDetails,
} from '../controllers/transaction.controllers.js';
import { authenticateToken } from '../middleware/authmiddleware.js';
import { transferRateLimiter, standardRateLimiter } from '../middleware/ratelimiter.middleware.js';

const router = Router();

// Protect all transaction routes with JWT authentication
router.use(authenticateToken);

// Transfer funds endpoint (strict transfer rate limit)
router.post('/transfer', transferRateLimiter, transferMoney);

// General transaction endpoints (standard rate limit)
router.get('/', standardRateLimiter, getAllTransactions);
router.get('/:id', standardRateLimiter, getTransactionDetails);

export { router as transactionRouter };
export default router;
