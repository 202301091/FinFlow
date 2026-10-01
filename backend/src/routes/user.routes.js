import { Router } from 'express';
import { createUser, loginUser } from '../controllers/user.controllers.js';
import { registerRateLimiter, loginRateLimiter } from '../middleware/ratelimiter.middleware.js';

const router = Router();

router.route('/register').post(registerRateLimiter, createUser);
router.route('/login').post(loginRateLimiter, loginUser);

export { router as userRouter };
export default router;
