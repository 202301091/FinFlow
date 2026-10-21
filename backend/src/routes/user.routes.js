import { Router } from 'express';
import {
  createUser,
  sendRegistrationOtp,
  loginUser,
  setTransactionPin,
  getPinStatus,
  requestPasswordResetOtp,
  verifyResetOtp,
  resetPassword,
} from '../controllers/user.controllers.js';
import {
  registerRateLimiter,
  loginRateLimiter,
  forgotPasswordRateLimiter,
  standardRateLimiter,
} from '../middleware/ratelimiter.middleware.js';
import { authenticateToken } from '../middleware/authmiddleware.js';

const router = Router();

// Registration with Email Ownership Verification OTP
router.route('/send-registration-otp').post(registerRateLimiter, sendRegistrationOtp);
router.route('/register').post(registerRateLimiter, createUser);
router.route('/login').post(loginRateLimiter, loginUser);

// Password Reset Flow (OTP-based)
router.route('/forgot-password').post(forgotPasswordRateLimiter, requestPasswordResetOtp);
router.route('/verify-reset-otp').post(forgotPasswordRateLimiter, verifyResetOtp);
router.route('/reset-password').post(forgotPasswordRateLimiter, resetPassword);

// Transaction PIN configuration and status check
router.route('/set-pin').post(authenticateToken, standardRateLimiter, setTransactionPin);
router.route('/pin-status').get(authenticateToken, standardRateLimiter, getPinStatus);

export { router as userRouter };
export default router;
