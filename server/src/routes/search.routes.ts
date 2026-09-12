import { Router } from 'express';
import { SearchController } from '../controllers/search.controller';
import { authMiddleware, collegeRequired } from '../middleware/auth';

const router = Router();
const controller = new SearchController();

router.get('/', authMiddleware, collegeRequired, (req, res) => controller.search(req, res));

export default router;
