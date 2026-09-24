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
    // Supreme-only: the directory is curated. College moderators rule their
    // campus, but minting new organizations is a network-level act.
    if (req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only the supreme admin can add colleges' });
    }
    const { name, shortName, city, state, emailDomain } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'College name is required' });
    }
    if (name.length > 120 || (shortName && String(shortName).length > 24) || (city && String(city).length > 60) || (state && String(state).length > 60)) {
      return res.status(400).json({ error: 'One of the fields is too long' });
    }
    if (/[<>{}]|\$|script/i.test(String(name) + String(shortName || '') + String(city || '') + String(state || ''))) {
      return res.status(400).json({ error: 'College name contains invalid characters' });
    }
    // Official student-mail domain (e.g. "ipec.org.in") — this is what OTP
    // verification enforces. Required for any campus whose students must verify.
    let domain: string | undefined;
    if (emailDomain !== undefined && emailDomain !== null && String(emailDomain).trim() !== '') {
      domain = String(emailDomain).trim().toLowerCase();
      if (domain.length > 120 || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
        return res.status(400).json({ error: 'Email domain looks invalid (e.g. "ipec.org.in")' });
      }
    }
    const { college, created } = await service.createIfMissing({ name, shortName, city, state, emailDomain: domain });
    res.status(created ? 201 : 200).json(created ? college : { ...college, deduped: true });
  } catch (error: any) {
    sendError(res, error, error.status || 400);
  }
}
