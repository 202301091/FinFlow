import { Router } from 'express';
import { createUser, loginUser } from '../controllers/user.controllers.js';

const router = Router();

router.route('/register').post(createUser);
router.route('/login').post(loginUser);

export { router as userRouter };
export default router;
