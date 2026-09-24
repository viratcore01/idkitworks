import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Outbound mail via the company Gmail account, for college-email OTP codes.
 *
 * WHY TWO TRANSPORTS
 * ------------------
 * Managed hosts block outbound SMTP. Render free web services cannot reach
 * ports 25, 465 or 587 at all, and Gmail SMTP needs 465 — so a nodemailer
 * send that works on a laptop dies in production as a connect timeout. A
 * longer timeout or an extra retry cannot fix a blocked port; the packets
 * never leave the box. Port 443 is never blocked, so production sends
 * through the Gmail REST API over HTTPS instead.
 *
 *   1. Gmail API (preferred) — GMAIL_OAUTH_CLIENT_ID / _CLIENT_SECRET /
 *      _REFRESH_TOKEN all set. HTTPS :443. Mint the refresh token with
 *      `npm run ops:gmail-auth`.
 *   2. SMTP + app password — GMAIL_USER + GMAIL_APP_PASSWORD. Fine locally
 *      and on any host with SMTP egress.
 *
 * Behavior with no credentials at all:
 *   - production → throws 503 (fail LOUD, never silently log a code the
 *     user cannot receive)
 *   - development → logs the code so local work still proceeds
 *
 * Send failures throw a 502 marked `expose` — the caller must NOT persist an
 * OTP the user will never receive, and the API's error handler passes the
 * user-actionable message through verbatim.
 */

let transporter: Transporter | null = null;

// One transient blip (socket reset, Gmail saying "421 try later", a 500 from
// the API) must not reach the user as "could not send" — the OTP row is only
// persisted AFTER a successful send, so a swallowed failure means a code that
// never exists.
const SEND_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 1200];
const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EPIPE', 'EDNS', 'EAI_AGAIN',
  'ECONNREFUSED', 'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
]);

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
// gmail.send is the narrowest scope that can deliver a message — it cannot
// read the inbox, list threads or change settings.
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const REQUEST_TIMEOUT_MS = 10_000;

export type MailBody = { to: string; subject: string; text: string; html: string };

/** True when all three OAuth values are present → use the HTTPS API. */
export function isGmailApiConfigured(): boolean {
  return !!(env.GMAIL_OAUTH_CLIENT_ID && env.GMAIL_OAUTH_CLIENT_SECRET && env.GMAIL_OAUTH_REFRESH_TOKEN);
}

export function isSmtpConfigured(): boolean {
  return !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
}

export function isEmailConfigured(): boolean {
  return isGmailApiConfigured() || isSmtpConfigured();
}

/** Human-readable transport name for diagnostics and startup logs. */
export function emailTransportName(): 'gmail-api' | 'smtp' | 'none' {
  if (isGmailApiConfigured()) return 'gmail-api';
  if (isSmtpConfigured()) return 'smtp';
  return 'none';
}

export { GMAIL_SEND_SCOPE };

// ── SMTP ────────────────────────────────────────────────────────────────────

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
      // Fail fast: a hanging SMTP handshake must surface as a 502 within
      // seconds, never leave the request (and the OTP row) dangling.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

/**
 * Transient = worth another try: socket-level blips and SMTP 4xx ("try again
 * later", greylisting, rate limits). 5xx is permanent — a bad app password
 * (535) or a policy rejection (550) would fail identically on every retry,
 * and an envelope error (EAUTH/EENVELOPE) means the address itself bounced.
 * responseCode is absent on network errors, hence the code fallback.
 */
function isTransientSmtp(err: any): boolean {
  const rc = Number(err?.responseCode);
  if (Number.isFinite(rc) && rc > 0) return rc >= 400 && rc < 500;
  return TRANSIENT_NET_CODES.has(networkCode(err));
}

// ── Gmail REST API (HTTPS) ──────────────────────────────────────────────────

type TokenCache = { value: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

/** Error carrying the HTTP status so retry logic can classify it. */
function httpError(what: string, status: number, body: string): any {
  const e: any = new Error(`${what} failed (HTTP ${status}): ${body.slice(0, 300)}`);
  e.httpStatus = status;
  return e;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exchange the long-lived refresh token for a short-lived access token.
 * Cached in memory until ~1 min before expiry: one token covers every OTP
 * sent in an hour instead of one round-trip per email.
 */
async function getAccessToken(force = false): Promise<string> {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;

  const res = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_OAUTH_CLIENT_ID,
      client_secret: env.GMAIL_OAUTH_CLIENT_SECRET,
      refresh_token: env.GMAIL_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const raw = await res.text();
  if (!res.ok) {
    // invalid_grant (400) = the refresh token was revoked, expired or was
    // minted for another client — permanent, so it must not be retried into
    // a 30-second hang. 429/5xx are worth another attempt.
    const e: any = httpError('Google token refresh', res.status, raw);
    if (raw.includes('invalid_grant')) {
      e.code = 'GMAIL_INVALID_GRANT';
      // The expiry trap: an External consent screen left in "Testing" status
      // issues refresh tokens that die after 7 days. Mail works, then breaks
      // a week later with no code change — so name the fix explicitly.
      e.message =
        'Gmail refresh token rejected (invalid_grant): revoked, expired, or minted for a different client. ' +
        'A consent screen in "Testing" status expires refresh tokens every 7 days — set it to "In production", ' +
        'then re-mint with `npm run ops:gmail-auth`.';
    }
    throw e;
  }

  const json = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    const e: any = new Error('Google token refresh returned no access_token');
    e.code = 'GMAIL_INVALID_GRANT';
    throw e;
  }
  tokenCache = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(60, (json.expires_in || 3600) - 60) * 1000,
  };
  return tokenCache.value;
}

function base64Wrapped(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
}

/**
 * RFC 2822 message with a text and an HTML alternative, base64url-encoded as
 * the API's `raw` field. Hand-built instead of pulling in a MIME library:
 * one message shape, no new dependency.
 */
function buildRawMessage(body: MailBody): string {
  const boundary = `zoclo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const mime = [
    `From: "Zoclo" <${env.GMAIL_USER}>`,
    `To: ${body.to}`,
    `Subject: ${body.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Wrapped(body.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Wrapped(body.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

async function gmailApiSend(body: MailBody): Promise<void> {
  const raw = buildRawMessage(body);

  const post = async (token: string): Promise<Response> =>
    fetchWithTimeout(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

  let res = await post(await getAccessToken());
  // A cached token can expire (or be revoked) between calls; one forced
  // refresh distinguishes "stale token" from "not allowed to send".
  if (res.status === 401) {
    res = await post(await getAccessToken(true));
  }
  if (!res.ok) throw httpError('Gmail send', res.status, await res.text());
}

/**
 * Node's fetch reports every transport failure as `TypeError: fetch failed`
 * and hangs the real reason (ECONNRESET, ENOTFOUND, …) on `err.cause.code`.
 * Reading only `err.code` makes a genuine network blip look permanent, so a
 * retry that should have saved the send never happens.
 */
function networkCode(err: any): string {
  return String(err?.code || err?.cause?.code || '');
}

/**
 * Transient for the HTTPS path: fetch-level network failures, aborts (our own
 * 10s timeout) and 429/5xx. A 4xx (401 after a forced refresh, 403 scope or
 * quota, 400 malformed) is permanent — retrying only delays the same answer.
 */
function isTransientGmailApi(err: any): boolean {
  if (err?.code === 'GMAIL_INVALID_GRANT') return false;
  const status = Number(err?.httpStatus);
  if (Number.isFinite(status) && status > 0) return status === 429 || status >= 500;
  const name = String(err?.name || '');
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return TRANSIENT_NET_CODES.has(networkCode(err));
}

// ── Shared send path ────────────────────────────────────────────────────────

async function withRetry(
  transport: string,
  attemptSend: () => Promise<void>,
  isTransient: (err: any) => boolean,
): Promise<void> {
  let lastErr: any;
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    try {
      await attemptSend();
      return;
    } catch (err: any) {
      lastErr = err;
      if (attempt >= SEND_ATTEMPTS || !isTransient(err)) break;
      // Log the WHY (code/response) — without it a silent retry loop is
      // invisible in production logs. Credentials never appear in errors.
      console.warn(
        `[email] ${transport} send attempt ${attempt}/${SEND_ATTEMPTS} failed ` +
        `(${err?.code || err?.httpStatus || 'error'}) — retrying in ${RETRY_BACKOFF_MS[attempt - 1]}ms`,
      );
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1] ?? 1000));
    }
  }

  // A rejected refresh token is NOT a blip: retrying changes nothing until an
  // admin reconnects the account, so "try again in a minute" would be a lie
  // the user repeats forever. Say what is actually true, log what to fix.
  if (lastErr?.code === 'GMAIL_INVALID_GRANT') {
    console.error(`[email] ${lastErr.message}`);
    const e: any = new Error('Verification emails are unavailable right now. Please try again later.');
    e.status = 502; e.code = 'EMAIL_AUTH_FAILED'; e.expose = true;
    e.cause = lastErr;
    throw e;
  }

  const e: any = new Error(
    'Could not send the verification email — try again in a minute. ' +
    'If this keeps happening, the server\'s mail setup needs attention.',
  );
  e.status = 502; e.code = 'EMAIL_SEND_FAILED'; e.expose = true;
  e.cause = lastErr;
  throw e;
}

export async function sendOtpEmail(to: string, code: string, collegeName: string | null): Promise<void> {
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      const e: any = new Error('Email sending is not configured on this server');
      e.status = 503; e.code = 'EMAIL_NOT_CONFIGURED'; e.expose = true;
      throw e;
    }
    console.log(`[OTP] (dev fallback, no mail creds) code for ${to}: ${code}`);
    return;
  }

  const subject = `Your Zoclo verification code: ${code}`;
  const collegeLine = collegeName ? ` for ${collegeName}` : '';
  const body: MailBody = {
    to,
    subject,
    text:
      `Hi!\n\n` +
      `Your Zoclo student-verification code${collegeLine} is:\n\n` +
      `    ${code}\n\n` +
      `It expires in 10 minutes. If you didn't ask for this, ignore this email.\n\n` +
      `— Team Zoclo`,
    html:
      `<p>Hi!</p>` +
      `<p>Your Zoclo student-verification code${collegeLine ? ` for <b>${collegeName}</b>` : ''} is:</p>` +
      `<p style="font-size:28px;font-weight:bold;letter-spacing:8px;">${code}</p>` +
      `<p>It expires in 10 minutes. If you didn't ask for this, ignore this email.</p>` +
      `<p>— Team Zoclo</p>`,
  };

  return sendMail(body);
}

/**
 * Deliver one message on whichever transport is configured, with retries.
 * Shared by the OTP path and the ops diagnostic so they cannot drift apart.
 */
export async function sendMail(body: MailBody): Promise<void> {
  if (!isGmailApiConfigured() && !isSmtpConfigured()) {
    throw new Error('No email transport configured');
  }

  if (isGmailApiConfigured()) {
    return withRetry('gmail-api', () => gmailApiSend(body), isTransientGmailApi);
  }

  return withRetry(
    'smtp',
    async () => {
      await getTransporter().sendMail({
        from: `"Zoclo" <${env.GMAIL_USER}>`,
        to: body.to,
        subject: body.subject,
        text: body.text,
        html: body.html,
      });
    },
    isTransientSmtp,
  );
}

/**
 * One line at boot naming the active mail transport. Production on SMTP is a
 * red flag: managed hosts block outbound SMTP, so every OTP send would sit in
 * a connect timeout and surface as a 502 — see the file header.
 */
export function logMailTransport(): void {
  switch (emailTransportName()) {
    case 'gmail-api':
      console.log('✉️  Email transport: Gmail API (HTTPS)');
      return;
    case 'smtp':
      if (process.env.NODE_ENV === 'production') {
        console.warn(
          '⚠️  Email transport: SMTP — hosts like Render block outbound ports 25/465/587. ' +
          'If OTP sends fail here, run `npm run ops:gmail-auth` and set GMAIL_OAUTH_* .',
        );
      } else {
        console.log('✉️  Email transport: SMTP (app password)');
      }
      return;
    default:
      console.warn('⚠️  Email transport: none — dev logs the OTP code, production returns 503.');
  }
}

/** Used by the ops scripts: a one-off connectivity + auth check. */
export async function verifyEmailTransport(): Promise<void> {
  if (isGmailApiConfigured()) {
    await getAccessToken(true);
    return;
  }
  if (isSmtpConfigured()) {
    await getTransporter().verify();
    return;
  }
  throw new Error('No email transport configured');
}
