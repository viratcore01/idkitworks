import { Response } from 'express';
import { MessageService } from '../services/message.service';
import { AuthRequest } from '../types';

const service = new MessageService();

export class MessageController {
  async getConversations(req: AuthRequest, res: Response) {
    try {
      const convos = await service.getConversations(req.user!.id);
      res.json(convos);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async createConversation(req: AuthRequest, res: Response) {
    try {
      const conv = await service.getOrCreateConversation(req.user!.id, req.body.userId);
      res.json(conv);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getMessages(req: AuthRequest, res: Response) {
    try {
      const { limit, cursor } = req.query;
      const result = await service.getMessages(
        req.params.conversationId as string,
        req.user!.id,
        limit ? parseInt(limit as string) : undefined,
        cursor as string,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async sendMessage(req: AuthRequest, res: Response) {
    try {
      const { content, mediaUrl } = req.body;
      const message = await service.sendMessage(
        req.params.conversationId as string,
        req.user!.id,
        content,
        mediaUrl,
      );
      res.status(201).json(message);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
