import { Response } from 'express';
import { MatchService } from '../services/match.service';
import { AuthRequest } from '../types';

const service = new MatchService();

export class MatchController {
  async discover(req: AuthRequest, res: Response) {
    try {
      const users = await service.discover(req.user!.id);
      res.json(users);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async like(req: AuthRequest, res: Response) {
    try {
      const result = await service.like(req.user!.id, req.body.receiverId);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async pass(req: AuthRequest, res: Response) {
    try {
      const result = await service.pass(req.user!.id, req.body.receiverId);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getMatches(req: AuthRequest, res: Response) {
    try {
      const matches = await service.getMatches(req.user!.id);
      res.json(matches);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async updatePreference(req: AuthRequest, res: Response) {
    try {
      const pref = await service.updatePreference(req.user!.id, req.body);
      res.json(pref);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
