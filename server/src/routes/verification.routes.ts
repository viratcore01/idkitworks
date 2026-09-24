import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth';
import {
  sendCollegeEmailOtp,
  verifyCollegeEmailOtp,
  collegeEmailStatus,
  resendCollegeEmailOtp,
} from '../controllers/email-verification.controller';

const router = Router();

// SMTP-abuse brake: sending codes costs real email quota. The service already
// caps each USER at 3 sends / 10 min; this caps each IP so one actor with many
// accounts can't burn the company Gmail quota. Sized for campus NAT (dorms
// share IPs): 60 sends / 15 min is far above legitimate onboarding bursts.
const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many verification emails from this network. Try again in 15 minutes.' },
});

// College email verification flow (replaces photo ID verification)
router.post('/college-email/send', sendLimiter, authMiddleware, (req, res) => sendCollegeEmailOtp(req, res));
router.post('/college-email/verify', authMiddleware, (req, res) => verifyCollegeEmailOtp(req, res));
router.get('/college-email/status', authMiddleware, (req, res) => collegeEmailStatus(req, res));
router.post('/college-email/resend', sendLimiter, authMiddleware, (req, res) => resendCollegeEmailOtp(req, res));

export default router;