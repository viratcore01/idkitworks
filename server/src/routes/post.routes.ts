import { Router } from 'express';
import { PostController } from '../controllers/post.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const controller = new PostController();

router.use(authMiddleware);

router.get('/', (req, res) => controller.getFeed(req, res));
router.post('/', (req, res) => controller.create(req, res));
router.get('/:id', (req, res) => controller.getById(req, res));
router.patch('/:id', (req, res) => controller.update(req, res));
router.delete('/:id', (req, res) => controller.delete(req, res));

// Likes
router.post('/:postId/like', (req, res) => controller.toggleLike(req, res));

// Comments
router.get('/:postId/comments', (req, res) => controller.getComments(req, res));
router.post('/:postId/comments', (req, res) => controller.createComment(req, res));
router.delete('/comments/:id', (req, res) => controller.deleteComment(req, res));

export default router;
