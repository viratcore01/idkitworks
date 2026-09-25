import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const controller = new AuthController();

router.post('/signup', (req, res) => controller.signup(req, res));
router.post('/check-email', (req, res) => controller.checkEmail(req, res));
// Public on purpose: the wizard must know a handle is free BEFORE it spends an
// OTP on it. Rate-limited in server.ts; answers are advisory (see the service).
router.get('/username-available', (req, res) => controller.usernameAvailable(req, res));
router.post('/login', (req, res) => controller.login(req, res));
router.post('/google', (req, res) => controller.google(req, res));
router.post('/refresh', (req, res) => controller.refresh(req, res));
router.post('/logout', (req, res) => controller.logout(req, res));
router.get('/me', authMiddleware, (req, res) => controller.me(req, res));
router.patch('/me', authMiddleware, (req, res) => controller.updateProfile(req, res));
router.delete('/account', authMiddleware, (req, res) => controller.deleteAccount(req, res));
router.patch('/password', authMiddleware, (req, res) => controller.changePassword(req, res));
// Forgotten password (unauthenticated by design — the user cannot sign in).
router.post('/password/forgot', (req, res) => controller.forgotPassword(req, res));
router.post('/password/reset', (req, res) => controller.resetPassword(req, res));
router.post('/password/set-via-google', authMiddleware, (req, res) => controller.setPasswordViaGoogle(req, res));
router.post('/password/set-initial', authMiddleware, (req, res) => controller.setInitialPassword(req, res));
router.get('/me/completeness', authMiddleware, (req, res) => controller.completeness(req, res));

export default router;
