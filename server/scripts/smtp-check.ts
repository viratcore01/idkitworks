/**
 * Diagnose outbound mail (Gmail SMTP) without booting the API or the DB.
 *
 *   npx tsx scripts/smtp-check.ts            → connect + AUTH only (no mail sent)
 *   npx tsx scripts/smtp-check.ts --send     → also deliver one test message
 *   npx tsx scripts/smtp-check.ts --send --to=someone@ipec.org.in
 *
 * Creds come from server/.env (GMAIL_USER / GMAIL_APP_PASSWORD), exactly as
 * src/config/env.ts loads them. The password is never printed — only whether
 * it is present and its length, so a truncated/pasted-with-spaces value is
 * obvious at a glance.
 */
import dotenv from 'dotenv';
dotenv.config();

import nodemailer from 'nodemailer';

const argv = process.argv.slice(2);
const user = process.env.GMAIL_USER || '';
const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const to = argv.find((a) => a.startsWith('--to='))?.slice('--to='.length) || user;

function mask(v: string): string {
  if (!v) return '(missing)';
  return `len=${v.length} first=${JSON.stringify(v.slice(0, 2))} last=${JSON.stringify(v.slice(-2))}`;
}

function report(err: any): void {
  console.error('   name         :', err?.name);
  console.error('   code         :', err?.code ?? '(none)');
  console.error('   responseCode :', err?.responseCode ?? '(none)');
  console.error('   message      :', err?.message);
  if (err?.response) console.error('   response     :', String(err.response).replace(/\s+/g, ' ').slice(0, 400));
}

async function main(): Promise<void> {
  console.log('GMAIL_USER        :', user ? mask(user) : '(missing)');
  console.log('GMAIL_APP_PASSWORD:', mask(pass));
  console.log('NODE_ENV          :', process.env.NODE_ENV || '(unset → dev)');
  console.log('recipient         :', to || '(none — no --to and no GMAIL_USER)');

  if (!user || !pass) {
    console.error('\n❌ Credentials missing — dev would log the code, prod would 503.');
    process.exit(1);
  }

  // Same transport + timeouts as src/utils/email.ts so the result matches
  // what sendOtpEmail experiences in the running server.
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  try {
    await transporter.verify();
    console.log('\n✅ TCP + TLS + AUTH accepted by smtp.gmail.com');
  } catch (err) {
    console.error('\n❌ SMTP verify failed (this is why OTP sends 502):');
    report(err);
    process.exit(2);
  }

  if (!argv.includes('--send')) {
    console.log('(no mail sent — re-run with --send to deliver a test message)');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Zoclo" <${user}>`,
      to,
      subject: 'Zoclo SMTP test',
      text: 'If you can read this, outbound mail works.',
    });
    console.log(`\n✅ Test mail accepted for ${to} — id ${info.messageId}`);
  } catch (err) {
    console.error('\n❌ sendMail failed after a successful verify:');
    report(err);
    process.exit(3);
  }
}

main().catch((err) => {
  console.error('❌ unexpected failure:', err);
  process.exit(4);
});
