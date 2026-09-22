import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';
import { checkEmail } from '../utils/email-validation';
import { googleAuth } from '../services/google-auth.service';

const authService = new AuthService();

export class AuthController {
  async signup(req: Request, res: Response) {
    try {
      const { email, password, username, displayName, collegeId, course, year, avatarUrl, bio, interestIds } = req.body;
      const result = await authService.signup({
        email, password, username, displayName, collegeId, course, year, avatarUrl, bio, interestIds,
      });
      res.status(201).json(result);
    } catch (error: any) {
      const status = error.message.includes('already') ? 409 : 400;
      sendError(res, error, status);
    }
  }

  async checkEmail(req: Request, res: Response) {
    try {
      const result = checkEmail(String(req.body?.email || ''));
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async google(req: Request, res: Response) {
    try {
      const idToken = String(req.body?.credential || '');
      if (!idToken) {
        const e: any = new Error('Missing Google credential'); e.status = 400; throw e;
      }
      const result = await googleAuth(idToken);
      res.json(result);
    } catch (error: any) {
      // Verification failures are the client's fault → 401; config/env issues → their status
      sendError(res, error, error.status || 401);
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 401);
    }
  }

  async refresh(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refresh(refreshToken);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 401);
    }
  }

  async logout(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;
      await authService.logout(refreshToken);
      res.json({ message: 'Logged out' });
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async changePassword(req: AuthRequest, res: Response) {
    try {
      const { currentPassword, newPassword } = req.body;
      await authService.changePassword(req.user!.id, currentPassword, newPassword);
      res.json({ message: 'Password changed. Please log in again on all devices.' });
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async setPasswordViaGoogle(req: AuthRequest, res: Response) {
    try {
      const { credential, newPassword } = req.body;
      await authService.setPasswordViaGoogle(req.user!.id, String(credential || ''), newPassword);
      res.json({ message: 'Password set. Please log in again on all devices.' });
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async deleteAccount(req: AuthRequest, res: Response) {
    try {
      await authService.deleteAccount(req.user!.id);
      res.json({ message: 'Account permanently deleted' });
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async me(req: AuthRequest, res: Response) {
    try {
      const user = await authService.getMe(req.user!.id);
      res.json(user);
    } catch (error: any) {
      sendError(res, error, 404);
    }
  }

  async updateProfile(req: AuthRequest, res: Response) {
    try {
      const user = await authService.updateProfile(req.user!.id, req.body);
      res.json(user);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async completeness(req: AuthRequest, res: Response) {
    try {
      const result = await authService.getProfileCompleteness(req.user!.id);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }
}
