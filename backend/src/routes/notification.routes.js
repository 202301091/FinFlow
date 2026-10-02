import { Router } from 'express';
import {
  streamNotifications,
  getNotifications,
  markRead,
  markAllRead,
} from '../controllers/notification.controllers.js';
import { authenticateToken } from '../middleware/authmiddleware.js';
import { standardRateLimiter } from '../middleware/ratelimiter.middleware.js';

const router = Router();

// Protect all notification routes with JWT authentication
router.use(authenticateToken);

// Real-time Server-Sent Events stream (no standard rate limiter so connection remains open indefinitely)
router.get('/stream', streamNotifications);

// REST notification management
router.get('/', standardRateLimiter, getNotifications);
router.patch('/read-all', standardRateLimiter, markAllRead);
router.patch('/:id/read', standardRateLimiter, markRead);

export { router as notificationRouter };
export default router;
