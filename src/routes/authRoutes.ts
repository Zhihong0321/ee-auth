import { Router } from 'express';
import { sendOtp, verifyOtp, me, logout } from '../controllers/authController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.get('/me', requireAuth, me);
router.post('/logout', logout);

export default router;
