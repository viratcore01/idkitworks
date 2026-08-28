import { Response } from 'express';
import { NotificationService } from '../services/notification.service';
import { AuthRequest } from '../types';

const service = new NotificationService();

export class NotificationController {
  async getNotifications(req: AuthRequest, res: Response) {
    try {
      const { limit, cursor } = req.query;
      const result = await service.getNotifications(
        req.user!.id,
        limit ? parseInt(limit as string) : undefined,
        cursor as string,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async markAllRead(req: AuthRequest, res: Response) {
    try {
      const result = await service.markAllRead(req.user!.id);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getUnreadCount(req: AuthRequest, res: Response) {
    try {
      const result = await service.getUnreadCount(req.user!.id);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
