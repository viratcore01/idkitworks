import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware, collegeRequired } from '../middleware/auth';

const router = Router();
const controller = new UserController();

router.use(authMiddleware);

// Meta endpoints: needed while picking a college during signup/setup, so no college gate here
router.get('/colleges', (req, res) => controller.getColleges(req, res));
router.get('/interests', (req, res) => controller.getInterests(req, res));
// Own block list: personal data, works regardless of college assignment state
router.get('/blocked', (req, res) => controller.getBlockedUsers(req, res));

// Main-app profile surface: strictly inside your college
router.get('/:username', collegeRequired, (req, res) => controller.getProfile(req, res));
router.get('/:username/posts', collegeRequired, (req, res) => controller.getUserPosts(req, res));
router.post('/:id/block', collegeRequired, (req, res) => controller.block(req, res));
router.delete('/:id/block', collegeRequired, (req, res) => controller.unblock(req, res));

export default router;
