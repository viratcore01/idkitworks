import { Response } from 'express';
import { SearchService } from '../services/search.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

const searchService = new SearchService();

export class SearchController {
  async search(req: AuthRequest, res: Response) {
    try {
      const q = req.query.q as string;
      const result = await searchService.search(q, req.user!.id, req.user!.collegeId);
      res.json(result);
    } catch (error: any) {
      sendError(res, error, 400);
    }
  }
}
