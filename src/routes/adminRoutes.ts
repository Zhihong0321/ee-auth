import { Router } from 'express';
import {
    renderDashboard,
    getOrigins,
    addOrigin,
    removeOrigin,
    getReferralAuthUrlsController,
    addReferralAuthUrl,
    removeReferralAuthUrl
} from '../controllers/adminController';
import { requireAuth } from '../middleware/authMiddleware';
import { Request, Response, NextFunction } from 'express';

const router = Router();

// Admin Middleware
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || !user.isAdmin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }
    next();
};

router.use(requireAuth);
router.use(requireAdmin);

router.get('/dashboard', renderDashboard);
router.get('/origins', getOrigins);
router.post('/origins', addOrigin);
router.delete('/origins', removeOrigin);
router.get('/referral-auth-urls', getReferralAuthUrlsController);
router.post('/referral-auth-urls', addReferralAuthUrl);
router.delete('/referral-auth-urls', removeReferralAuthUrl);

export default router;
