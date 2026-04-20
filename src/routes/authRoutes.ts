import { Router } from 'express';
import { sendOtp, verifyOtp, me, logout, getAuthContext, lookupMobileByEmail } from '../controllers/authController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/lookup-mobile', lookupMobileByEmail);
router.get('/context', getAuthContext);
router.get('/me', requireAuth, me);
router.post('/logout', logout);

export default router;
