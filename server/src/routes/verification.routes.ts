import { Router } from 'express';
import multer from 'multer';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { submitId, status, queue, reviewImage, decide } from '../controllers/verification.controller';

const router = Router();
// ID photos live in memory only — deleted from DB as soon as a decision lands
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// User flow
router.post('/id', authMiddleware, upload.single('id'), (req, res) => submitId(req, res));
router.get('/status', authMiddleware, (req, res) => status(req, res));

// Admin review queue
router.get('/queue', authMiddleware, adminMiddleware, (req, res) => queue(req, res));
router.get('/:id/image', authMiddleware, adminMiddleware, (req, res) => reviewImage(req, res));
router.patch('/:id/decide', authMiddleware, adminMiddleware, (req, res) => decide(req, res));

export default router;
