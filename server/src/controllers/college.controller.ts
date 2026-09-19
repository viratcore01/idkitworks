import { Response } from 'express';
import { CollegeService } from '../services/college.service';
import { AuthRequest } from '../types';
import { sendError } from '../utils/http-error';

const service = new CollegeService();

/** GET /colleges?q= — public typeahead (needed on the signup screen, pre-auth). */
export async function searchColleges(req: AuthRequest, res: Response) {
  try {
    const q = String(req.query.q || '');
    const limit = parseInt(String(req.query.limit || '')) || 20;
    res.json(await service.search(q, limit));
  } catch (error: any) {
    sendError(res, error, 400);
  }
}

/**
 * POST /colleges — let a student add a college that's not in the directory.
 * Public (needed pre-signup), but strictly validated + rate-limited by the
 * global limiter; junk rows carry no user data and the ID check gates trust.
 */
export async function createCollege(req: AuthRequest, res: Response) {
  try {
    const { name, shortName, city, state } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'College name is required' });
    }
    if (name.length > 120 || (shortName && String(shortName).length > 24) || (city && String(city).length > 60) || (state && String(state).length > 60)) {
      return res.status(400).json({ error: 'One of the fields is too long' });
    }
    if (/[<>{}]|\$|script/i.test(String(name) + String(shortName || '') + String(city || '') + String(state || ''))) {
      return res.status(400).json({ error: 'College name contains invalid characters' });
    }
    const { college, created } = await service.createIfMissing({ name, shortName, city, state });
    res.status(created ? 201 : 200).json(created ? college : { ...college, deduped: true });
  } catch (error: any) {
    sendError(res, error, error.status || 400);
  }
}
