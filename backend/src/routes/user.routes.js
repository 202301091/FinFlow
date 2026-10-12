import { Router } from 'express';
import {
  createUser,
  loginUser,
  setTransactionPin,
  getPinStatus,
} from '../controllers/user.controllers.js';
import {
  registerRateLimiter,
  loginRateLimiter,
  standardRateLimiter,
} from '../middleware/ratelimiter.middleware.js';
import { authenticateToken } from '../middleware/authmiddleware.js';

const router = Router();

router.route('/register').post(registerRateLimiter, createUser);
router.route('/login').post(loginRateLimiter, loginUser);

// Transaction PIN configuration and status check
router.route('/set-pin').post(authenticateToken, standardRateLimiter, setTransactionPin);
router.route('/pin-status').get(authenticateToken, standardRateLimiter, getPinStatus);

export { router as userRouter };
export default router;
