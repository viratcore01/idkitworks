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
  try {
    await getTransporter().sendMail({
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
    });
  } catch (err: any) {
    const e: any = new Error('Could not send the verification email — try again in a minute');
    e.status = 502; e.code = 'EMAIL_SEND_FAILED'; e.expose = true;
    e.cause = err;
    throw e;
  }
}
