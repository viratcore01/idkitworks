import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { env } from './config/env';
import { prisma } from './config/prisma';

// Routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import postRoutes from './routes/post.routes';
import searchRoutes from './routes/search.routes';
import notificationRoutes from './routes/notification.routes';
import matchRoutes from './routes/match.routes';
import messageRoutes from './routes/message.routes';
import adminRoutes from './routes/admin.routes';

const app = express();
const httpServer = createServer(app);

// ── Trust proxy: correct client IPs behind Vercel/nginx/Cloudflare ──
app.set('trust proxy', 1);

// ── Security headers ──
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ── CORS (origin from env; no credentials on bare JWT headers, keep true for future cookies) ──
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));

// ── Body size cap: 100kb is plenty for JSON; kills multi-MB junk floods ──
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// ── Global API brake: every IP, 300 req/min ──
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});
app.use('/api', globalLimiter);

// ── Auth brake: 10 attempts / 15 min per IP (brute-force wall) ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 10 : 100, // dev shares one 127.0.0.1 bucket across browser+tests
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/refresh', authLimiter);

// Health check (unauthenticated, cheap, for uptime monitors + load balancers)
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    // DB down: still 200 for the LB but flagged — or flip to 503 if you prefer fail-fast
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

// ── Socket.IO: authenticated + membership-checked ──
export const io = new Server(httpServer, {
  cors: { origin: env.CLIENT_URL, credentials: true },
});

io.use((socket, next) => {
  // Handshake must carry a valid access token — no anonymous sockets.
  const token = (socket.handshake.auth?.token as string) || '';
  if (!token) return next(new Error('Authentication required'));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    (socket.data as { userId: string }).userId = payload.userId;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  const userId = (socket.data as { userId: string }).userId;

  // Join your personal room (auto-verified — token holds the id)
  socket.join(`user:${userId}`);

  // Join a conversation room ONLY if you are a member of it
  socket.on('join-conversation', async (conversationId: string) => {
    try {
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (member) socket.join(`conversation:${conversationId}`);
    } catch {
      /* ignore bad payloads */
    }
  });

  // Real-time message send: persists via the service so REST pollers see it too.
  socket.on('send-message', async (data: { conversationId: string; content: string }, ack?: (r: any) => void) => {
    try {
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
