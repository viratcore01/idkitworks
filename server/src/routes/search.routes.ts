import { Router } from 'express';
import { SearchController } from '../controllers/search.controller';
import { authMiddleware, collegeRequired, verificationRequired, passwordRequired } from '../middleware/auth';

const router = Router();
const controller = new SearchController();

// Discovering people is for verified students only.
router.get('/', authMiddleware, collegeRequired, verificationRequired, passwordRequired, (req, res) => controller.search(req, res));

export default router;
