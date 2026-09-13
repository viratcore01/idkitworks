import { Router } from 'express';
import multer from 'multer';
import { UserController } from '../controllers/user.controller';
import { uploadPhoto, deletePhoto, getPhoto } from '../controllers/photo.controller';
import { authMiddleware, collegeRequired, photoAuth } from '../middleware/auth';

const router = Router();
const controller = new UserController();

// Photos live in memory only — we store the bytes in Postgres ourselves
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Binary photo serving — must be registered BEFORE router.use(authMiddleware):
// <img> tags can't send headers, so this route authenticates via header OR ?t=
// (photoAuth). Same checks: live DB user, active account, same-college only.
router.get('/photos/:photoId', photoAuth, (req, res) => getPhoto(req, res));

router.use(authMiddleware);

// Meta endpoints: needed while picking a college during signup/setup, so no college gate here
router.get('/colleges', (req, res) => controller.getColleges(req, res));
router.get('/interests', (req, res) => controller.getInterests(req, res));
// Own block list: personal data, works regardless of college assignment state
router.get('/blocked', (req, res) => controller.getBlockedUsers(req, res));

// Own photo management: works regardless of college assignment state
// (profile pic slot 0 doubles as the avatar users set before matching)
router.post('/me/photos', authMiddleware, upload.single('photo'), (req, res) => uploadPhoto(req, res));
router.delete('/me/photos/:photoId', authMiddleware, (req, res) => deletePhoto(req, res));

// Main-app profile surface: strictly inside your college
router.get('/:username', collegeRequired, (req, res) => controller.getProfile(req, res));
router.get('/:username/posts', collegeRequired, (req, res) => controller.getUserPosts(req, res));
router.post('/:id/block', collegeRequired, (req, res) => controller.block(req, res));
router.delete('/:id/block', collegeRequired, (req, res) => controller.unblock(req, res));

export default router;
