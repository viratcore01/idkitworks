import { Response } from 'express';
import { UserService } from '../services/user.service';
import { AuthRequest } from '../types';

const userService = new UserService();

export class UserController {
  async getProfile(req: AuthRequest, res: Response) {
    try {
      const profile = await userService.getPublicProfile(req.params.username as string, req.user!.id);
      if (!profile) return res.status(404).json({ error: 'User not found' });
      res.json(profile);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getUserPosts(req: AuthRequest, res: Response) {
    try {
      const { limit, cursor } = req.query;
      const result = await userService.getUserPosts(
        req.params.username as string,
        req.user!.id,
        limit ? parseInt(limit as string) : undefined,
        cursor as string,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async block(req: AuthRequest, res: Response) {
    try {
      await userService.block(req.user!.id, req.params.id as string);
      res.json({ message: 'User blocked' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async unblock(req: AuthRequest, res: Response) {
    try {
      await userService.unblock(req.user!.id, req.params.id as string);
      res.json({ message: 'User unblocked' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getBlockedUsers(req: AuthRequest, res: Response) {
    try {
      const users = await userService.getBlockedUsers(req.user!.id);
      res.json(users);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getColleges(_req: AuthRequest, res: Response) {
    try {
      const colleges = await userService.getAllColleges();
      res.json(colleges);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getInterests(_req: AuthRequest, res: Response) {
    try {
      const interests = await userService.getAllInterests();
      res.json(interests);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
