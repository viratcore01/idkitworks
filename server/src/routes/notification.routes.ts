import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authMiddleware, collegeRequired } from '../middleware/auth';

const router = Router();
const controller = new NotificationController();

router.use(authMiddleware, collegeRequired);

router.get('/', (req, res) => controller.getNotifications(req, res));
router.get('/unread-count', (req, res) => controller.getUnreadCount(req, res));
router.patch('/read', (req, res) => controller.markAllRead(req, res));

export default router;
