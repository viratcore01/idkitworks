import { Router } from 'express';
import { PostController } from '../controllers/post.controller';
import { authMiddleware, collegeRequired, verificationRequired } from '../middleware/auth';

const router = Router();
const controller = new PostController();

// PRODUCT RULE: only moderator-verified students read or write the feed.
router.use(authMiddleware, collegeRequired, verificationRequired);

router.get('/', (req, res) => controller.getFeed(req, res));
router.post('/', (req, res) => controller.create(req, res));

// Saved/bookmarked posts — must be registered before /:id
router.get('/saved/list', (req, res) => controller.getSaved(req, res));

router.get('/:id', (req, res) => controller.getById(req, res));
router.patch('/:id', (req, res) => controller.update(req, res));
router.delete('/:id', (req, res) => controller.delete(req, res));

// Likes & saves
router.post('/:postId/like', (req, res) => controller.toggleLike(req, res));
router.post('/:postId/save', (req, res) => controller.toggleSave(req, res));

// Comments
router.get('/:postId/comments', (req, res) => controller.getComments(req, res));
router.post('/:postId/comments', (req, res) => controller.createComment(req, res));
router.patch('/comments/:id', (req, res) => controller.editComment(req, res));
router.delete('/comments/:id', (req, res) => controller.deleteComment(req, res));

export default router;
