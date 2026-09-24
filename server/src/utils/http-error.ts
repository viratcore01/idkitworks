import type { Response } from 'express';

/**
 * Single choke point for error responses from controllers.
 * - Prisma validation errors  -> 400 "Invalid request" (never leak engine text/paths)
 * - Prisma known errors       -> mapped (P2025 -> 404, P2002 -> 409)
 * - Any other Prisma/internal -> 500 "Something went wrong" (logged server-side)
 * - App errors                -> use error.status or the fallback status, message passes through
 */
export function sendError(res: Response, error: any, fallbackStatus = 400): void {
  const name = String(error?.name || error?.constructor?.name || '');
  const code = String(error?.code || '');
  const raw = String(error?.message || '');

  if (name.includes('PrismaClientValidationError')) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  if (code === 'P2025') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (code === 'P2002') {
    res.status(409).json({ error: 'Already exists' });
    return;
  }
  if (code === 'P2003') {
    res.status(400).json({ error: 'Invalid reference' });
    return;
  }
  if (name.includes('PrismaClient')) {
    console.error('[prisma]', raw.slice(0, 500));
    res.status(500).json({ error: 'Something went wrong' });
    return;
  }

  const status = error?.status || fallbackStatus;
  if (status >= 500) {
    console.error('[error]', status, raw.slice(0, 500));
    // Operational errors explicitly marked safe (missing email config,
    // failed send, unconfigured OAuth) travel verbatim — they are
    // user-actionable and contain no internals. Everything else stays hidden.
    if (error?.expose) {
      res.status(status).json({ error: raw || 'Bad request', ...(code ? { code } : {}) });
      return;
    }
    res.status(500).json({ error: 'Something went wrong' });
    return;
  }
  // App-level codes travel to the client (e.g. EMAIL_TYPO carries a suggestion)
  if (code === 'EMAIL_TYPO' || code === 'EMAIL_INVALID') {
    res.status(status).json({ error: raw, code, suggestion: error?.suggestion });
    return;
  }
  // Machine-readable safety codes the client branches on (verification gate,
  // blocked walls, photo gates) — safe to expose, never sensitive.
  if (code === 'BLOCKED' || code === 'VERIFICATION_REQUIRED' || code === 'PROFILE_PHOTO_REQUIRED' || code === 'COLLEGE_REQUIRED') {
    res.status(status).json({ error: raw, code });
    return;
  }
  res.status(status).json({ error: raw || 'Bad request' });
}
