import { Response } from 'express';
import { SearchService } from '../services/search.service';
import { AuthRequest } from '../types';

const searchService = new SearchService();

export class SearchController {
  async search(req: AuthRequest, res: Response) {
    try {
      const q = req.query.q as string;
      const result = await searchService.search(q, req.user!.id);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
