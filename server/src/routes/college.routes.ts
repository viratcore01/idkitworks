import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { CollegeService } from '../services/college.service';
import { createCollege } from '../controllers/college.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const service = new CollegeService();

// Adding colleges is public (pre-signup) but writes to a shared directory —
// 20 additions / 15 min per IP stops farming while a real classroom sails through.
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many new colleges from this network. Try again later.' },
});

// Search is public: the signup/onboarding screens need it before a token exists.
// It only ever returns college names — no user data.
router.get('/', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=300'); // directory changes rarely
    const q = String(req.query.q || '');
    const limit = parseInt(String(req.query.limit || '')) || 20;
    res.json(await service.search(q, limit));
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Search failed' });
  }
});

// Students may add a missing college. Public on purpose: it's needed during
// signup, before an account exists. Rows are inert (no user data), heavily
// validated, deduped, and the student-ID verification is the real trust gate.
router.post('/', createLimiter, (req, res) => createCollege(req as any, res));

export default router;
