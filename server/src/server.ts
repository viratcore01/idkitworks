import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { subscribe } from './config/bus';
import { STORAGE_DRIVER } from './config/storage';
import { logCostGuardState } from './config/cost-guard';
import { logMailTransport } from './utils/email';

// Routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import postRoutes from './routes/post.routes';
import searchRoutes from './routes/search.routes';
import notificationRoutes from './routes/notification.routes';
import matchRoutes from './routes/match.routes';
import messageRoutes from './routes/message.routes';
import adminRoutes from './routes/admin.routes';
import verificationRoutes from './routes/verification.routes';
import collegeRoutes from './routes/college.routes';

const app = express();
const httpServer = createServer(app);

// ── Trust proxy: correct client IPs behind Vercel/nginx/Cloudflare ──
app.set('trust proxy', 1);

// ── Security headers ──
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ── PERF: gzip every JSON response. College-list + feed + deck payloads are
// easily 100KB+ raw; on campus WiFi compression is worth hundreds of ms. ──
app.use(compression());

// ── CORS (origin from env; no credentials on bare JWT headers, keep true for future cookies) ──
// CLIENT_URL may hold ONE origin or a comma-separated list (prod domain +
// dev/preview domains). A single stale localhost here bricks the whole site
// for real browsers — curl tests can't catch it, only browsers enforce CORS.
const allowedOrigins = env.CLIENT_URL.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * A browser origin that isn't in CLIENT_URL is a DEPLOY CONFIGURATION problem,
 * not a server fault. It used to be thrown as a bare `Error`, which the central
 * handler classifies as 500 — so every affected browser saw "Something went
 * wrong", the failure was indistinguishable from a real outage in the logs,
 * and the one fact that fixes it (which origin was rejected) never surfaced.
 *
 * Now: 403 + the origin named in the server log, and a stable message the
 * client can show verbatim. Verified with a preview deployment URL that isn't
 * in CLIENT_URL — the browser gets 403 in ~1ms instead of a 500.
 */
function rejectOrigin(origin: string | undefined, cb: (err: any) => void) {
  const denied: any = new Error(`Blocked by CORS: ${origin || 'unknown origin'} is not an allowed origin`);
  denied.status = 403;
  denied.code = 'CORS_ORIGIN_DENIED';
  console.warn(`[cors] blocked origin "${origin}" — add it to CLIENT_URL to allow it`);
  cb(denied);
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return rejectOrigin(origin, cb);
    },
    credentials: true,
  }),
);

// ── Body size cap: 100kb is plenty for JSON; kills multi-MB junk floods ──
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// ── Real client IP for rate limiting behind Cloudflare + Nginx ──
// express-rate-limit keys on req.ip. Behind the CF → Nginx → Node chain with
// `trust proxy 1`, req.ip resolves to Cloudflare's EDGE IP — so every user
// shares one bucket and a single abusive client rate-limits the whole campus.
// Cloudflare sets cf-connecting-ip with the real client address on every
// proxied request; fall back to req.ip for direct local/dev traffic.
// Nginx MUST overwrite (not append) X-Forwarded-For and the origin should
// accept traffic only from Cloudflare IP ranges, otherwise this header is
// client-spoofable (see deploy/nginx/zoclo.conf).
const realClientIpKey = (req: express.Request): string => {
  const cf = req.headers['cf-connecting-ip'];
  const headerIp = Array.isArray(cf) ? cf[0] : cf;
  // Routed through ipKeyGenerator (IPv6 → /56 subnet): the library rejects
  // raw-IP keyGenerators at boot (ERR_ERL_KEY_GEN_IPV6) since a single IPv6
  // user owns a whole /64 and would otherwise get a fresh bucket per request.
  if (typeof headerIp === 'string' && headerIp.length > 0) return ipKeyGenerator(headerIp);
  return ipKeyGenerator(req.ip ?? 'unknown');
};

// ── Global API brake: every IP, 1000 req/min ──
// Sized for launch: carrier/campus NAT puts thousands of students behind a
// handful of public IPs, so per-IP budgets must assume whole-campuses of
// traffic. 1000/min (~16 rps) still stops scrapers while surviving NAT.
// NOTE: /api/health is explicitly skipped below — keep-alive pings and
// uptime monitors must NEVER consume this budget or get 429'd.
const globalLimiter = rateLimit({
  keyGenerator: realClientIpKey,
  windowMs: 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
  // Mounted at /api so req.path here is the sub-path ('/health', …).
  // /health/db stays limited on purpose — it burns a pool connection per hit.
  skip: (req) => req.path === '/health',
});
app.use('/api', globalLimiter);

// ── Brute-force wall for LOGIN: counts FAILURES only ──
// skipSuccessfulRequests is the campus-NAT fix: 300 students signing in from
// one IP never trip it (their attempts succeed), while a password-guessing
// script is still capped at 30 failures per 15 min. Refresh is deliberately
// NOT limited here — its traffic scales with legitimate active users (every
// session refreshes every ~15 min), and a stolen refresh token is already
// a signed secret checked against the DB.
const loginLimiter = rateLimit({
  keyGenerator: realClientIpKey,
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 30 : 300, // dev shares one 127.0.0.1 bucket across browser+tests
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed attempts. Try again in 15 minutes.' },
});
app.use('/api/auth/login', loginLimiter);

// ── Signup brake: 50 accounts / 15 min per IP (all attempts count) ──
// Generous enough for a dorm flooding in on launch night; account-farming
// beyond this is still fenced off by college-email OTP verification.
const signupLimiter = rateLimit({
  keyGenerator: realClientIpKey,
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 50 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many signups from this network. Try again in 15 minutes.' },
});
app.use('/api/auth/signup', signupLimiter);

// ── Google token brake: each hit burns a JWKS fetch/verify + (on success)
// an account write. Counts FAILURES only (same campus-NAT reasoning as
// login): forged-token spray is capped, real dorm sign-ins never trip it.
const googleLimiter = rateLimit({
  keyGenerator: realClientIpKey,
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 60 : 300,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many Google attempts from this network. Try again in 15 minutes.' },
});
app.use('/api/auth/google', googleLimiter);

// ── Health checks ──
// GET /api/health: EXTREMELY lightweight, NO DB calls. Safe to ping every
// few minutes from cron-job.org / UptimeRobot / GitHub Actions to keep the
// Render free instance awake. Must stay <5ms and never touch Prisma.
// Also advertises which auth methods are configured — the client reads this
// to decide whether to render the Google button.
const bootTime = Date.now();
app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSec: Math.floor((Date.now() - bootTime) / 1000),
    auth: { google: !!env.GOOGLE_CLIENT_ID, googleClientId: env.GOOGLE_CLIENT_ID || undefined },
  });
});

// GET /api/health/db: deep check WITH a DB round-trip. Use for real
// monitoring/alerting only (not for keep-alive — it burns pool connections).
app.get('/api/health/db', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', database: 'reachable', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/colleges', collegeRoutes);

// ── Socket.IO: authenticated + membership-checked ──
export const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  },
});

io.use((socket, next) => {
  // Handshake must carry a valid access token — no anonymous sockets.
  // Photo tokens (?pt=, 30d) are scoped to <img> serving and rejected here.
  const token = (socket.handshake.auth?.token as string) || '';
  if (!token) return next(new Error('Authentication required'));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string; purpose?: string };
    if ((payload as any).purpose === 'photo') return next(new Error('Invalid token'));
    (socket.data as { userId: string }).userId = payload.userId;
    // Live ban check is done on connection (async) — see below.
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  const userId = (socket.data as { userId: string }).userId;
  // Live account check: a banned/deleted account's sockets are dropped even
  // if the 15-min access token hasn't expired yet. Also joins the college's
  // feed room so new posts push to everyone on campus instantly.
  // Verification is cached on the socket (mirrors verificationRequired:
  // VERIFIED or staff). A stale false is refreshed live on first use below,
  // so a user who verifies mid-connection is never muted until reconnect.
  prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, collegeId: true, verificationStatus: true, role: true },
  }).then((u) => {
    if (!u || !u.isActive) return socket.disconnect(true);
    (socket.data as any).verified = u.verificationStatus === 'VERIFIED' || u.role === 'admin' || u.role === 'super_admin';
    if (u.collegeId && (socket.data as any).verified) socket.join(`college:${u.collegeId}`);
  }).catch(() => {});

  // Stale-cache guard: cached false → one live re-read before refusing.
  // Zero extra queries in the common (verified) case.
  const ensureSocketVerified = async (): Promise<boolean> => {
    if ((socket.data as any).verified) return true;
    try {
      const live = await prisma.user.findUnique({
        where: { id: userId },
        select: { verificationStatus: true, role: true },
      });
      const ok = !!live && (live.verificationStatus === 'VERIFIED' || live.role === 'admin' || live.role === 'super_admin');
      if (ok) {
        (socket.data as any).verified = true;
        const full = await prisma.user.findUnique({ where: { id: userId }, select: { collegeId: true } });
        if (full?.collegeId) socket.join(`college:${full.collegeId}`);
      }
      return ok;
    } catch {
      return false;
    }
  };

  // Per-user message throttle: a burst of sends is spam or a buggy client.
  // 30 msgs / 10s is far above any real typing pace (WhatsApp-class clients
  // average <1 msg/s even in group chats).
  let sendTimestamps: number[] = [];

  // Join your personal room (auto-verified — token holds the id)
  socket.join(`user:${userId}`);

  // Join a conversation room ONLY if you are a member of it
  socket.on('join-conversation', async (conversationId: string) => {
    try {
      if (typeof conversationId !== 'string' || !conversationId) return;
      if (!(await ensureSocketVerified())) return;
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!member) return;
      // Block-aware: a block after joining must not keep the room open.
      const members = await prisma.conversationMember.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      const otherIds = members.map((m) => m.userId).filter((id) => id !== userId);
      if (otherIds.length) {
        const blocked = await prisma.block.findFirst({
          where: { OR: otherIds.flatMap((id) => [
            { blockerId: userId, blockedId: id },
            { blockerId: id, blockedId: userId },
          ]) },
        });
        if (blocked) return;
      }
      socket.join(`conversation:${conversationId}`);
    } catch {
      /* ignore bad payloads */
    }
  });

  // Real-time message send: persists via the service so REST pollers see it too.
  // Verified-only (mirrors message.routes): the REST path gates, so the
  // socket must too — membership alone is not proof of membership.
  socket.on('send-message', async (data: { conversationId: string; content: string }, ack?: (r: any) => void) => {
    try {
      if (!(await ensureSocketVerified())) return ack?.({ error: 'Verify your college email first' });
      const now = Date.now();
      sendTimestamps = sendTimestamps.filter((t) => now - t < 10_000);
      if (sendTimestamps.length >= 30) {
        return ack?.({ error: 'Sending too fast — slow down' });
      }
      sendTimestamps.push(now);

      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: data.conversationId, userId } },
      });
      if (!member) return ack?.({ error: 'Not a member of this conversation' });

      const content = String(data.content || '').slice(0, 2000).trim();
      if (!content) return ack?.({ error: 'Message cannot be empty' });

      const { MessageService } = await import('./services/message.service');
      const message = await new MessageService().sendMessage(data.conversationId, userId, content);
      io.to(`conversation:${data.conversationId}`).emit('new-message', message);
      ack?.({ ok: true, message });
    } catch {
      ack?.({ error: 'Could not send message' });
    }
  });

  socket.on('disconnect', () => {
    /* connection cleanup is automatic */
  });
});

// ── Domain events → Socket.IO rooms (REST gets realtime push too) ──
subscribe('message:new', ({ conversationId, message, recipientIds = [] }: any) => {
  if (conversationId) io.to(`conversation:${conversationId}`).emit('new-message', message);
  for (const uid of recipientIds) io.to(`user:${uid}`).emit('message-notify', { conversationId });
});
subscribe('message:updated', ({ conversationId }: any) => {
  if (conversationId) io.to(`conversation:${conversationId}`).emit('message-updated', { conversationId });
});
subscribe('match:new', ({ userIds = [] }: any) => {
  for (const uid of userIds) io.to(`user:${uid}`).emit('match-new', {});
});
subscribe('notification:new', ({ userIds = [] }: any) => {
  for (const uid of userIds) io.to(`user:${uid}`).emit('notification-new', {});
});
// LIVE FEED: a new post pings everyone's feed page — clients refetch the
// (already cached) feed once instead of polling blindly every 30s.
subscribe('feed:new', ({ collegeId }: any) => {
  if (collegeId) io.to(`college:${collegeId}`).emit('feed-new', { collegeId });
});

// ── 404 for unknown API routes ──
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Central error handler: NEVER leak stack traces / Prisma internals ──
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || err?.statusCode || 500;
  // Log server-side with context; respond with a sanitized body
  console.error('[error]', status, err?.message || 'Unhandled error');
  let message = err?.message || 'Bad request';
  // Prisma engine errors embed absolute paths/schema internals — never ship them.
  if (/prisma|node_modules|Invalid `|C:\\|\/home\/|\/Users\//i.test(message)) {
    message = status >= 500 ? 'Something went wrong' : 'Invalid request';
  }
  if (status >= 500) message = 'Something went wrong';
  res.status(status).json({ error: message });
});

// Start server
import { CollegeService } from './services/college.service';
new CollegeService().seedDirectory().then(({ added, total }) => {
  if (added > 0) console.log(`🎓 College directory seeded: +${added} (${total} total)`);
}).catch((e) => console.error('[college-seed]', e.message));

// ── Launch guardrail: log the effective DB pool size at boot ──
// The pooler is the #1 launch-day killer (free tier: 15 sessions). The pool
// size is owned by DATABASE_CONNECTION_LIMIT (see config/prisma.ts), NOT by
// URL params — those are overwritten at boot. Keep instances × limit well
// under the pooler size with headroom left for scripts/monitors.
try {
  console.log(`[db] pool limit=${process.env.DATABASE_CONNECTION_LIMIT || 10} timeout=${process.env.DATABASE_POOL_TIMEOUT || 20}s heartbeat=${process.env.DATABASE_HEARTBEAT_SEC || 60}s · NODE_ENV=${process.env.NODE_ENV || 'development'}`);
  console.log(`[storage] driver=${STORAGE_DRIVER}`);
} catch { /* never block boot on a log line */ }
logCostGuardState().catch(() => {});

// Warm the pool now (grabs sessions while they're free) — boot continues regardless.
import { warmPool } from './config/prisma';
warmPool().catch(() => {});

httpServer.listen(env.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${env.PORT}`);
  console.log(`📡 Socket.IO ready`);
  logMailTransport();
});

// ── Crash resilience: log and keep serving where possible ──
process.on('unhandledRejection', (reason: any) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[uncaughtException]', err.message, err.stack);
  // Give in-flight requests a moment, then exit — the process manager restarts us.
  setTimeout(() => process.exit(1), 1000);
});

// ── Graceful shutdown: finish in-flight work, close DB cleanly ──
async function shutdown(signal: string) {
  console.log(`[${signal}] shutting down...`);
  httpServer.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Hard stop after 10s no matter what
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
