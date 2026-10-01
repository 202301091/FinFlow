import { Router } from 'express';
import { createAccount, getAccounts } from '../controllers/account.controllers.js';
import { authenticateToken } from '../middleware/authmiddleware.js';
import { standardRateLimiter } from '../middleware/ratelimiter.middleware.js';
const router = Router();

// Protect all account routes with JWT authentication and standard rate limiting
router.use(authenticateToken, standardRateLimiter);

router.route('/')
    .get(getAccounts)
    .post(createAccount);

export { router as accountRouter };
export default router;
