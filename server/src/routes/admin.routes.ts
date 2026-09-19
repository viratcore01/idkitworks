import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const router = Router();
const controller = new AdminController();

router.use(authMiddleware);

// Public report creation
router.post('/reports', (req, res) => controller.createReport(req, res));

  // Admin-only routes
  router.get('/overview', adminMiddleware, (req, res) => controller.overview(req, res));
  router.get('/users', adminMiddleware, (req, res) => controller.listUsers(req, res));
  router.patch('/users/:id/role', adminMiddleware, (req, res) => controller.setRole(req, res));
  router.get('/content', adminMiddleware, (req, res) => controller.browseContent(req, res));
  router.get('/reports', adminMiddleware, (req, res) => controller.getReports(req, res));
router.patch('/reports/:id/resolve', adminMiddleware, (req, res) => controller.resolveReport(req, res));
router.delete('/content/:type/:id', adminMiddleware, (req, res) => controller.deleteContent(req, res));
router.post('/users/:id/ban', adminMiddleware, (req, res) => controller.banUser(req, res));
router.post('/users/:id/unban', adminMiddleware, (req, res) => controller.unbanUser(req, res));
router.get('/stats', adminMiddleware, (req, res) => controller.getStats(req, res));

export default router;
