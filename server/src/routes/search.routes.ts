import { Router } from 'express';
import { SearchController } from '../controllers/search.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const controller = new SearchController();

router.get('/', authMiddleware, (req, res) => controller.search(req, res));

export default router;
