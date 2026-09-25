import { Router } from 'express';
import { MessageController } from '../controllers/message.controller';
import { authMiddleware, collegeRequired, verificationRequired, passwordRequired } from '../middleware/auth';

const router = Router();
const controller = new MessageController();

// PRODUCT RULE: chatting is verified-students only (both sides of a chat are).
router.use(authMiddleware, collegeRequired, verificationRequired, passwordRequired);

router.get('/conversations', (req, res) => controller.getConversations(req, res));
router.post('/conversation', (req, res) => controller.createConversation(req, res));
router.get('/:conversationId', (req, res) => controller.getMessages(req, res));
router.post('/:conversationId', (req, res) => controller.sendMessage(req, res));
router.patch('/:conversationId/messages/:messageId', (req, res) => controller.editMessage(req, res));
router.delete('/:conversationId/messages/:messageId', (req, res) => controller.deleteMessage(req, res));

export default router;
