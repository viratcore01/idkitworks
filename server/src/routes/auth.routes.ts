import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const controller = new AuthController();

router.post('/signup', (req, res) => controller.signup(req, res));
router.post('/check-email', (req, res) => controller.checkEmail(req, res));
router.post('/login', (req, res) => controller.login(req, res));
router.post('/google', (req, res) => controller.google(req, res));
router.post('/refresh', (req, res) => controller.refresh(req, res));
router.post('/logout', (req, res) => controller.logout(req, res));
router.get('/me', authMiddleware, (req, res) => controller.me(req, res));
router.patch('/me', authMiddleware, (req, res) => controller.updateProfile(req, res));
router.delete('/account', authMiddleware, (req, res) => controller.deleteAccount(req, res));
router.patch('/password', authMiddleware, (req, res) => controller.changePassword(req, res));
router.get('/me/completeness', authMiddleware, (req, res) => controller.completeness(req, res));

export default router;
