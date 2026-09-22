import { Response } from 'express';
import { NotificationService } from '../services/notification.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

const service = new NotificationService();

export class NotificationController {
  async getNotifications(req: AuthRequest, res: Response) {
    try {
      const { limit, cursor } = req.query;
      const result = await service.getNotifications(
        req.user!.id,
        limit ? parseInt(limit as string) : undefined,
        cursor as string,
        req.user!.collegeId,
      );
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async markAllRead(req: AuthRequest, res: Response) {
    try {
      const result = await service.markAllRead(req.user!.id);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async markRead(req: AuthRequest, res: Response) {
    try {
      const result = await service.markRead(req.user!.id, req.params.id as string);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async getUnreadCount(req: AuthRequest, res: Response) {
    try {
      const result = await service.getUnreadCount(req.user!.id, req.user!.collegeId);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }
}
