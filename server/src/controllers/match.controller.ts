import { Request, Response } from 'express';
import { MatchService } from '../services/match.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

const service = new MatchService();

const isCuidLike = (s: any) => typeof s === 'string' && s.length >= 20 && s.length <= 40;

export class MatchController {
  async discover(req: AuthRequest, res: Response) {
    try {
      const page = Math.max(parseInt(req.query.page as string) || 0, 0);
      const limit = parseInt(req.query.limit as string) || undefined;
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
      const page = Math.max(parseInt(req.query.page as string) || 0, 0);
      const limit = parseInt(req.query.limit as string) || undefined;
      const result = await service.getMatches(req.user!.id, page, limit);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }

  async unmatch(req: AuthRequest, res: Response) {
    try {
      const result = await service.unmatch(req.user!.id, req.params.matchId as string);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 403);
    }
  }

  async getStats(req: AuthRequest, res: Response) {
    try {
      const stats = await service.getStats(req.user!.id);
      // Merge the "likes you" count so the deck chip is one request.
      res.json({ ...stats, ...(await service.likesYouCount(req.user!.id)) });
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
