import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authMiddleware, collegeRequired } from '../middleware/auth';

const router = Router();
const controller = new NotificationController();

// NOTE: deliberately NO verificationRequired here — a pending user must still
// receive the "you're verified!" notification that unlocks their account.

router.get('/', (req, res) => controller.getNotifications(req, res));
router.get('/unread-count', (req, res) => controller.getUnreadCount(req, res));
router.patch('/read', (req, res) => controller.markAllRead(req, res));

export default router;
