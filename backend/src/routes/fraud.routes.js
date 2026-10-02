import { Router } from 'express';
import {
  getFlaggedAlerts,
  resolveAlert,
  getMyFraudHistory,
} from '../controllers/fraud.controllers.js';
import { authenticateToken } from '../middleware/authmiddleware.js';
import { standardRateLimiter } from '../middleware/ratelimiter.middleware.js';

const router = Router();

// Protect all fraud routes with JWT authentication
router.use(authenticateToken);

// Manual inspection queue
router.get('/alerts', standardRateLimiter, getFlaggedAlerts);
router.patch('/alerts/:id/review', standardRateLimiter, resolveAlert);

// Personal fraud evaluation history
router.get('/my-history', standardRateLimiter, getMyFraudHistory);

export { router as fraudRouter };
export default router;
