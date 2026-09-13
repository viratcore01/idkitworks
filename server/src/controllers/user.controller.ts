import { Response } from 'express';
import { UserService } from '../services/user.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

const userService = new UserService();

export class UserController {
  async getProfile(req: AuthRequest, res: Response) {
    try {
      const profile = await userService.getPublicProfile(req.params.username as string, req.user!.id, req.user!.collegeId);
      if (!profile) return res.status(404).json({ error: 'User not found' });
      res.json(profile);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async getUserPosts(req: AuthRequest, res: Response) {
    try {
      const { limit, cursor, anonymous } = req.query;
      const result = await userService.getUserPosts(
        req.params.username as string,
        req.user!.id,
        limit ? parseInt(limit as string) : undefined,
        cursor as string,
        req.user!.collegeId,
        // Owner-only anonymous list: the service re-checks ownership, so a
        // forged ?anonymous=1 on someone else's profile just yields nothing.
        anonymous === '1' || anonymous === 'true',
      );
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async block(req: AuthRequest, res: Response) {
    try {
      await userService.block(req.user!.id, req.params.id as string);
      res.json({ message: 'User blocked' });
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async unblock(req: AuthRequest, res: Response) {
    try {
      await userService.unblock(req.user!.id, req.params.id as string);
      res.json({ message: 'User unblocked' });
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async getBlockedUsers(req: AuthRequest, res: Response) {
    try {
      const users = await userService.getBlockedUsers(req.user!.id);
      res.json(users);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async getColleges(_req: AuthRequest, res: Response) {
    try {
      const colleges = await userService.getAllColleges();
      res.json(colleges);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async getInterests(_req: AuthRequest, res: Response) {
    try {
      const interests = await userService.getAllInterests();
      res.json(interests);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }
}
