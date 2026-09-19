import { Router } from 'express';
import { MatchController } from '../controllers/match.controller';
import { authMiddleware, collegeRequired, verificationRequired } from '../middleware/auth';

const router = Router();
const controller = new MatchController();

// PRODUCT RULE: matching is verified-students only — the deck, likes, passes, matches.
router.use(authMiddleware, collegeRequired, verificationRequired);

// Preferences before /:param-style routes
router.get('/preferences', (req, res) => controller.getPreference(req, res));
router.patch('/preferences', (req, res) => controller.updatePreference(req, res));
router.get('/stats', (req, res) => controller.getStats(req, res));
router.post('/rewind', (req, res) => controller.rewind(req, res));

router.get('/discover', (req, res) => controller.discover(req, res));
router.get('/likes-you', (req, res) => controller.likesYou(req, res));
router.post('/like', (req, res) => controller.like(req, res));
router.post('/pass', (req, res) => controller.pass(req, res));
router.get('/', (req, res) => controller.getMatches(req, res));
router.delete('/:matchId', (req, res) => controller.unmatch(req, res));

export default router;
