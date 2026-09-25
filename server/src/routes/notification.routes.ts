import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authMiddleware, collegeRequired, verificationRequired, passwordRequired } from '../middleware/auth';

const router = Router();
const controller = new NotificationController();

// Verified-only: the OTP unlock flow reads /verification status + socket
// pings, never this inbox — so gating here costs the funnel nothing while
// keeping unverified (college merely claimed) sessions out of the inbox.
router.use(authMiddleware, collegeRequired, verificationRequired, passwordRequired);

router.get('/', (req, res) => controller.getNotifications(req, res));
router.get('/unread-count', (req, res) => controller.getUnreadCount(req, res));
// Blanket clear. Declared before '/:id/read' so the literal segment wins.
router.patch('/read', (req, res) => controller.markAllRead(req, res));
// Per-notification read, fired when the reader actually opens one.
router.patch('/:id/read', (req, res) => controller.markRead(req, res));

export default router;
