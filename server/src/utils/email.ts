import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Outbound mail via the company Gmail account (SMTP + app password).
 *
 * Setup (one time, ~2 min):
 *   1. Sign in to the company Google account and enable 2-Step Verification.
 *   2. Create an App Password: Google Account → Security → 2-Step Verification
 *      → App passwords → name it "Zoclo API" → copy the 16-letter code.
 *   3. Set GMAIL_USER + GMAIL_APP_PASSWORD in server/.env (never commit them).
 *
 * Behavior:
 *   - Creds present → sends for real (thrown errors propagate: the caller
 *     must NOT persist an OTP the user will never receive).
 *   - Creds missing + production → throws 503 (fail LOUD, never silently
 *     log a code the user can't receive).
 *   - Creds missing + dev → logs the code so local development still works.
 */

let transporter: Transporter | null = null;

// One transient blip (socket reset, Gmail saying "421 try later") must not
// reach the user as "could not send" — the OTP row is only persisted AFTER a
// successful send, so a swallowed failure means a code that never exists.
const SEND_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 1200];
const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EPIPE', 'EDNS', 'EAI_AGAIN',
]);

/**
 * Transient = worth another try: socket-level blips and SMTP 4xx ("try again
 * later", greylisting, rate limits). 5xx is permanent — bad app password
 * (535) or a policy rejection (550) would fail identically on every retry,
 * and an envelope error (EAUTH/EENVELOPE) means the address itself bounced.
 * responseCode is absent on network errors, hence the code fallback.
 */
function isTransient(err: any): boolean {
  const rc = Number(err?.responseCode);
  if (Number.isFinite(rc) && rc > 0) return rc >= 400 && rc < 500;
  return TRANSIENT_NET_CODES.has(String(err?.code || ''));
}

export function isEmailConfigured(): boolean {
  return !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
      // Fail fast in production: a hanging SMTP handshake must surface as a
      // 502 within seconds, never leave the request (and the OTP row) dangling.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

export async function sendOtpEmail(to: string, code: string, collegeName: string | null): Promise<void> {
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      const e: any = new Error('Email sending is not configured on this server');
      e.status = 503; e.code = 'EMAIL_NOT_CONFIGURED'; e.expose = true;
      throw e;
    }
    console.log(`[OTP] (dev fallback, no SMTP creds) code for ${to}: ${code}`);
    return;
  }

  const collegeLine = collegeName ? ` for ${collegeName}` : '';
  const mail = {
    from: `"Zoclo" <${env.GMAIL_USER}>`,
    to,
    subject: `Your Zoclo verification code: ${code}`,
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

  let lastErr: any;
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    try {
      await getTransporter().sendMail(mail);
      return;
    } catch (err: any) {
      lastErr = err;
      const retry = attempt < SEND_ATTEMPTS && isTransient(err);
      if (!retry) break;
      // Log the WHY (code/response) — without it a silent retry loop is
      // invisible in production logs. nodemailer keeps auth out of errors.
      console.warn(
        `[email] OTP send attempt ${attempt}/${SEND_ATTEMPTS} failed ` +
        `(${err?.code || ''}${err?.responseCode ? ` ${err.responseCode}` : ''}) — retrying in ${RETRY_BACKOFF_MS[attempt - 1]}ms`,
      );
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1] ?? 1000));
    }
  }

  const e: any = new Error('Could not send the verification email — try again in a minute');
  e.status = 502; e.code = 'EMAIL_SEND_FAILED'; e.expose = true;
  e.cause = lastErr;
  throw e;
}
