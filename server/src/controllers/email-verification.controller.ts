import { Response } from 'express';
import { EmailVerificationService } from '../services/email-verification.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

const service = new EmailVerificationService();

/** POST /verification/college-email/send — send OTP to college email */
export async function sendCollegeEmailOtp(req: AuthRequest, res: Response) {
  try {
    const { collegeEmail } = req.body as { collegeEmail?: string };
    if (!collegeEmail || typeof collegeEmail !== 'string') {
      return res.status(400).json({ error: 'College email is required' });
    }
    const result = await service.sendOtp(req.user!.id, collegeEmail.trim().toLowerCase());
    res.status(202).json(result);
  } catch (error: any) {
    sendError(res, error, error.status || 400);
  }
}

/** POST /verification/college-email/verify — verify OTP */
export async function verifyCollegeEmailOtp(req: AuthRequest, res: Response) {
  try {
    const { code } = req.body as { code?: string };
    if (!code || typeof code !== 'string' || code.length !== 6) {
      return res.status(400).json({ error: 'Valid 6-digit OTP is required' });
    }
    const result = await service.verifyOtp(req.user!.id, code.trim());
    res.json(result);
  } catch (error: any) {
    sendError(res, error, error.status || 400);
  }
}

/** GET /verification/college-email/status — get verification status */
export async function collegeEmailStatus(req: AuthRequest, res: Response) {
  try {
    res.json(await service.getStatus(req.user!.id));
  } catch (error: any) {
    sendError(res, error, 400);
  }
}

/** POST /verification/college-email/resend — resend OTP */
export async function resendCollegeEmailOtp(req: AuthRequest, res: Response) {
  try {
    const result = await service.resendOtp(req.user!.id);
    res.status(202).json(result);
  } catch (error: any) {
    sendError(res, error, error.status || 400);
  }
}