import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const controller = new UserController();

router.use(authMiddleware);

router.get('/colleges', (req, res) => controller.getColleges(req, res));
router.get('/interests', (req, res) => controller.getInterests(req, res));
router.get('/blocked', (req, res) => controller.getBlockedUsers(req, res));
router.get('/:username', (req, res) => controller.getProfile(req, res));
router.get('/:username/posts', (req, res) => controller.getUserPosts(req, res));
router.post('/:id/block', (req, res) => controller.block(req, res));
router.delete('/:id/block', (req, res) => controller.unblock(req, res));

export default router;
