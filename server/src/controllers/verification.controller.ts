import { Response } from 'express';
import { VerificationService } from '../services/verification.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';
import { isSuperAdmin, moderationScope } from '../middleware/auth';

const service = new VerificationService();

/** POST /verification/id — multipart "id" field. Runs the auto chain. */
export async function submitId(req: AuthRequest, res: Response) {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No photo provided' });
    const result = await service.submit(req.user!.id, { buffer: file.buffer, mimetype: file.mimetype, size: file.size });
    res.status(202).json(result);
  } catch (error: any) {
    sendError(res, error, error.status || 400);
  }
}

/** GET /verification/status */
export async function status(req: AuthRequest, res: Response) {
  try {
    res.json(await service.status(req.user!.id));
  } catch (error: any) {
    sendError(res, error, 400);
  }
}

/** Admin: review queue */
export async function queue(req: AuthRequest, res: Response) {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 0, 0);
    const result = await service.reviewQueue(
      moderationScope(req.user), isSuperAdmin(req.user), page,
      undefined, req.query.collegeId as string,
    );
    res.json(result);
  } catch (error: any) {
    sendError(res, error, 400);
  }
}

/** Admin: the ID image for a pending review */
export async function reviewImage(req: AuthRequest, res: Response) {
  try {
    const img = await service.reviewImage(req.params.id as string, moderationScope(req.user), isSuperAdmin(req.user));
    if (!img) return res.status(404).json({ error: 'Image not available' });
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'no-store'); // privacy: never cache ID photos
    res.send(img.data);
  } catch (error: any) {
    sendError(res, error, 400);
  }
}

/** Admin: approve / reject */
export async function decide(req: AuthRequest, res: Response) {
  try {
    const approve = req.body?.approve === true;
    const result = await service.humanDecision(req.params.id as string, req.user!.id, approve, moderationScope(req.user), isSuperAdmin(req.user));
    // Audit: every ID decision is attributable (admin, student, campus).
    try {
      const { AdminService } = await import('../services/admin.service');
      await new AdminService().log(
        req.user!.id, approve ? 'verify:approve' : 'verify:reject',
        'USER', (result as any).userId, (result as any).collegeId,
      );
    } catch { /* audit is best-effort */ }
    res.json(result);
  } catch (error: any) {
    sendError(res, error, error.status || 400);
  }
}

/** Admin: bulk ID decisions (max 50) — clears a spam wave in one tap. */
export async function bulkDecide(req: AuthRequest, res: Response) {
  try {
    const ids: string[] = [...new Set(((req.body?.ids || []) as any[]).filter(Boolean))].slice(0, 50);
    const approve = req.body?.approve === true;
    if (!ids.length) return res.status(400).json({ error: 'No verifications selected' });
    const ok: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        const r: any = await service.humanDecision(id as string, req.user!.id, approve, moderationScope(req.user), isSuperAdmin(req.user));
        ok.push(id);
        try {
          const { AdminService } = await import('../services/admin.service');
          await new AdminService().log(req.user!.id, approve ? 'verify:approve' : 'verify:reject', 'USER', r.userId, r.collegeId);
        } catch { /* audit best-effort */ }
      } catch (e: any) {
        failed.push({ id: id as string, error: e?.message || 'Failed' });
      }
    }
    res.json({ ok, failed });
  } catch (error: any) {
    sendError(res, error, error.status || 400);
  }
}


