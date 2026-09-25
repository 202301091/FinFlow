import { Router } from 'express';
import { createAccount, getAccounts } from '../controllers/account.controllers.js';
import { authenticateToken } from '../middleware/authmiddleware.js';

const router = Router();

// Protect all account routes with JWT authentication middleware
router.use(authenticateToken);

router.route('/')
    .get(getAccounts)
    .post(createAccount);

export { router as accountRouter };
export default router;
