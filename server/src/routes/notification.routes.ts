import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authMiddleware, collegeRequired } from '../middleware/auth';

const router = Router();
const controller = new NotificationController();

// NOTE: deliberately NO verificationRequired here — a pending user must still
// receive the "you're verified!" notification that unlocks their account.
// But auth is MANDATORY: without req.user these handlers crash with
// "Cannot read properties of undefined (reading 'id')" — i.e. the whole
// notifications surface 400s for everyone.
router.use(authMiddleware, collegeRequired);

router.get('/', (req, res) => controller.getNotifications(req, res));
router.get('/unread-count', (req, res) => controller.getUnreadCount(req, res));
router.patch('/read', (req, res) => controller.markAllRead(req, res));

export default router;
