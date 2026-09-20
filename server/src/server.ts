import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { subscribe } from './config/bus';

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
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);

// ── Body size cap: 100kb is plenty for JSON; kills multi-MB junk floods ──
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// ── Global API brake: every IP, 600 req/min ──
// Sized for a college campus: hundreds of students share one public IP via
// campus WiFi/NAT, so per-IP budgets must assume whole-classroom traffic.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
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
// beyond this is still fenced off by student-ID verification.
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 50 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many signups from this network. Try again in 15 minutes.' },
});
app.use('/api/auth/signup', signupLimiter);

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
  prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, collegeId: true } }).then((u) => {
    if (!u || !u.isActive) return socket.disconnect(true);
    if (u.collegeId) socket.join(`college:${u.collegeId}`);
  }).catch(() => {});

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
  socket.on('send-message', async (data: { conversationId: string; content: string }, ack?: (r: any) => void) => {
    try {
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

httpServer.listen(env.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${env.PORT}`);
  console.log(`📡 Socket.IO ready`);
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
