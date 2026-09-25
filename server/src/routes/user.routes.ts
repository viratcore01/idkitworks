import { Router } from 'express';
import multer from 'multer';
import { UserController } from '../controllers/user.controller';
import { uploadPhoto, deletePhoto, getPhoto, issuePhotoToken } from '../controllers/photo.controller';
import { authMiddleware, collegeRequired, verificationRequired, passwordRequired, photoAuth } from '../middleware/auth';

const router = Router();
const controller = new UserController();

// Photos live in memory only — we store the bytes in Postgres ourselves
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Binary photo serving — must be registered BEFORE router.use(authMiddleware):
// <img> tags can't send headers, so this route authenticates via header OR the
// long-lived ?pt= photo token (photoAuth). Same checks: live DB user, active
// account, same-college only.
router.get('/photos/:photoId', photoAuth, (req, res) => getPhoto(req, res));

router.use(authMiddleware);

// Long-lived token for <img> URLs — the client fetches this after login and
// embeds it on every photo URL (see GET /users/photos/:photoId?pt=...).
router.get('/photo-token', authMiddleware, (req, res) => issuePhotoToken(req, res));

// Meta endpoints: needed while picking a college during signup/setup, so no college gate here
router.get('/colleges', (req, res) => controller.getColleges(req, res));
router.get('/interests', (req, res) => controller.getInterests(req, res));
// Own block list: personal data, works regardless of college assignment state
router.get('/blocked', (req, res) => controller.getBlockedUsers(req, res));

// Own photo management: works regardless of college assignment state
// (profile pic slot 0 doubles as the avatar users set before matching)
router.post('/me/photos', authMiddleware, upload.single('photo'), (req, res) => uploadPhoto(req, res));
router.delete('/me/photos/:photoId', authMiddleware, (req, res) => deletePhoto(req, res));

// Main-app profile surface: strictly inside your college AND verified.
// An unverified session proves nothing (college is merely claimed), so
// profile browsing stays closed until OTP/Google verification lands.
// Funnel-safe: setup uses /auth/me + /me/photos + /interests (all open above).
router.get('/:username', collegeRequired, verificationRequired, passwordRequired, (req, res) => controller.getProfile(req, res));
router.get('/:username/posts', collegeRequired, verificationRequired, passwordRequired, (req, res) => controller.getUserPosts(req, res));
router.post('/:id/block', collegeRequired, verificationRequired, passwordRequired, (req, res) => controller.block(req, res));
router.delete('/:id/block', collegeRequired, verificationRequired, passwordRequired, (req, res) => controller.unblock(req, res));

export default router;
