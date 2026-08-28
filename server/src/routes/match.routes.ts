import { Router } from 'express';
import { MatchController } from '../controllers/match.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const controller = new MatchController();

router.use(authMiddleware);

router.get('/discover', (req, res) => controller.discover(req, res));
router.post('/like', (req, res) => controller.like(req, res));
router.post('/pass', (req, res) => controller.pass(req, res));
router.get('/', (req, res) => controller.getMatches(req, res));
router.patch('/preferences', (req, res) => controller.updatePreference(req, res));

export default router;
