import { Request, Response } from 'express';
import { MatchService } from '../services/match.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

const service = new MatchService();

const isCuidLike = (s: any) => typeof s === 'string' && s.length >= 20 && s.length <= 40;

/** Clamp a ?limit param into [min, max]; garbage/absent → undefined (service default). */
const clampLimit = (raw: unknown, min: number, max: number): number | undefined => {
  const n = parseInt(raw as string);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(n, min), max);
};

const clampPage = (raw: unknown): number => Math.max(parseInt(raw as string) || 0, 0);

export class MatchController {
  async discover(req: AuthRequest, res: Response) {
    try {
      const page = clampPage(req.query.page);
      const limit = clampLimit(req.query.limit, 1, 50);
      const result = await service.discover(req.user!.id, page, limit);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async like(req: AuthRequest, res: Response) {
    try {
      const { receiverId } = req.body;
      if (!isCuidLike(receiverId)) return res.status(400).json({ error: 'Invalid receiverId' });
      const result = await service.action(req.user!.id, receiverId, 'LIKE');
      res.json(result);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async pass(req: AuthRequest, res: Response) {
    try {
      const { receiverId } = req.body;
      if (!isCuidLike(receiverId)) return res.status(400).json({ error: 'Invalid receiverId' });
      const result = await service.action(req.user!.id, receiverId, 'PASS');
      res.json(result);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async getMatches(req: AuthRequest, res: Response) {
    try {
      const page = clampPage(req.query.page);
      const limit = clampLimit(req.query.limit, 1, 100);
      const result = await service.getMatches(req.user!.id, page, limit);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async unmatch(req: AuthRequest, res: Response) {
    try {
      const { matchId } = req.params;
      if (!isCuidLike(matchId)) return res.status(400).json({ error: 'Invalid matchId' });
      const result = await service.unmatch(req.user!.id, matchId as string);
      res.json(result);
    } catch (error: any) {
      // 404 by default (not 403): a foreign/gone match's existence is not
      // confirmable — same wall philosophy as cross-college content.
      sendError(res, error, error.status || 404);
    }
  }

  async getStats(req: AuthRequest, res: Response) {
    try {
      // PERF: the deck chip needs both halves — fetch in ONE parallel wave,
      // not two sequential awaits (each is 1-2 indexed queries).
      const [stats, likesYou] = await Promise.all([
        service.getStats(req.user!.id),
        service.likesYouCount(req.user!.id),
      ]);
      // Merge the "likes you" count so the deck chip is one request.
      res.json({ ...stats, ...likesYou });
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async likesYou(req: AuthRequest, res: Response) {
    try {
      const limit = clampLimit(req.query.limit, 1, 50);
      res.json(await service.likesYou(req.user!.id, limit));
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async rewind(req: AuthRequest, res: Response) {
    try {
      const result = await service.rewindLastPass(req.user!.id);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, error.status || 400);
    }
  }

  async updatePreference(req: AuthRequest, res: Response) {
    try {
      const pref = await service.updatePreference(req.user!.id, req.body);
      res.json(pref);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async getPreference(req: AuthRequest, res: Response) {
    try {
      const pref = await service.getPreference(req.user!.id);
      res.json(pref);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }
}

export { isCuidLike };
