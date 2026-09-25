import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';
import { checkEmail } from '../utils/email-validation';
import { googleAuth } from '../services/google-auth.service';

const authService = new AuthService();

export class AuthController {
  /** Funnel start: college + identity, no password (set post-verification). */
  async signup(req: Request, res: Response) {
    try {
      const { collegeId, email, username, displayName } = req.body;
      const result = await authService.signup({ collegeId, email, username, displayName });
      res.status(201).json(result);
    } catch (error: any) {
      const status = error.status || (error.message.includes('already') ? 409 : 400);
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
      // Funnel college (signup wizard): the server auto-verifies ONLY when the
      // Google email's domain matches the college. Absent = legacy login path.
      const collegeId = typeof req.body?.collegeId === 'string' && req.body.collegeId
        ? req.body.collegeId
        : undefined;
      const result = await googleAuth(idToken, collegeId);
      res.json(result);
    } catch (error: any) {
      // Verification failures are the client's fault → 401; config/env issues → their status
      sendError(res, error, error.status || 401);
    }
  }

  /** Funnel step: first password, gated on verified college email + no password yet. */
  async setInitialPassword(req: AuthRequest, res: Response) {
    try {
      const { newPassword } = req.body;
      await authService.setInitialPassword(req.user!.id, newPassword);
      res.json({ message: 'Password set' });
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /**
   * Forgotten password, step 1: mail a reset code.
   * 202 + a generic body for every input (see AuthService.requestPasswordReset).
   */
  async forgotPassword(req: Request, res: Response) {
    try {
      const { identifier, email } = req.body ?? {};
      const result = await authService.requestPasswordReset(String(identifier ?? email ?? ''));
      res.status(202).json(result);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  /** Forgotten password, step 2: redeem the code and set a new password. */
  async resetPassword(req: Request, res: Response) {
    try {
      const { identifier, email, code, newPassword } = req.body ?? {};
      await authService.resetPassword(identifier ?? email, code, newPassword);
      res.json({ reset: true, message: 'Password updated — sign in with your new password.' });
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async login(req: Request, res: Response) {
    try {
      // `identifier` is email-or-username; legacy `email` still accepted so
      // older clients and scripts keep working unchanged.
      const { identifier, email, password } = req.body;
      const result = await authService.login(identifier ?? email, password);
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
