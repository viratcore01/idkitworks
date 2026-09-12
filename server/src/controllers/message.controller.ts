import { Response } from 'express';
import { MessageService } from '../services/message.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

const service = new MessageService();

export class MessageController {
  async getConversations(req: AuthRequest, res: Response) {
    try {
      const convos = await service.getConversations(req.user!.id, req.user!.collegeId);
      res.json(convos);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async createConversation(req: AuthRequest, res: Response) {
    try {
      const conv = await service.getOrCreateConversation(req.user!.id, req.body.userId);
      res.json(conv);
    } catch (error: any) {
      sendError(res, error, 400);
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
      sendError(res, error, 400);
    }
  }

  async sendMessage(req: AuthRequest, res: Response) {
    try {
      const { content, mediaUrl } = req.body;
      if (!content?.trim()) {
        return res.status(400).json({ error: 'Message cannot be empty' });
      }
      const message = await service.sendMessage(
        req.params.conversationId as string,
        req.user!.id,
        content,
        mediaUrl,
      );
      res.status(201).json(message);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async editMessage(req: AuthRequest, res: Response) {
    try {
      const { content } = req.body;
      const message = await service.editMessage(
        req.params.conversationId as string,
        req.params.messageId as string,
        req.user!.id,
        content,
      );
      res.json(message);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async deleteMessage(req: AuthRequest, res: Response) {
    try {
      const result = await service.deleteMessage(
        req.params.conversationId as string,
        req.params.messageId as string,
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }
}
