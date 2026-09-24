/**
 * Diagnose outbound mail end-to-end, whichever transport is configured.
 *
 *   npm run ops:email-check                 → connect + authenticate only
 *   npm run ops:email-check -- --send       → also deliver one test message
 *   npm run ops:email-check -- --send --to=someone@ipec.org.in
 *
 * Unlike smtp-check (which talks raw SMTP), this exercises the SAME code path
 * the API uses at runtime — so a green result here means OTP sends work in
 * this environment. Prints which transport is active, because "Gmail API over
 * HTTPS" and "SMTP" behave completely differently behind a firewall.
 */
import dotenv from 'dotenv';
dotenv.config();

import { emailTransportName, isGmailApiConfigured, sendMail, verifyEmailTransport } from '../src/utils/email';

const argv = process.argv.slice(2);
const user = process.env.GMAIL_USER || '';
const to = argv.find((a) => a.startsWith('--to='))?.slice('--to='.length) || user;

function explain(err: any): void {
  console.error('   name         :', err?.name);
  console.error('   code         :', err?.code ?? '(none)');
  console.error('   httpStatus   :', err?.httpStatus ?? '(none)');
  console.error('   message      :', err?.message);
  const cause = err?.cause;
  if (cause) {
    console.error('   cause        :', cause?.code || cause?.httpStatus || '', String(cause?.message || '').slice(0, 300));
  }
}

async function main(): Promise<void> {
  const transport = emailTransportName();
  console.log('transport :', transport);
  console.log('from      :', user || '(GMAIL_USER not set)');
  console.log('recipient :', to || '(none — no --to and no GMAIL_USER)');
  console.log('NODE_ENV  :', process.env.NODE_ENV || '(unset → dev)');

  if (transport === 'none') {
    console.error('\n❌ No mail transport configured.');
    console.error('   Production → runs on Gmail API: set GMAIL_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN.');
    console.error('   Local      → SMTP also works: set GMAIL_USER + GMAIL_APP_PASSWORD.');
    console.error('   Mint the OAuth trio with:  npm run ops:gmail-auth');
    process.exit(1);
  }

  try {
    await verifyEmailTransport();
    console.log(`\n✅ ${transport} authenticated`);
  } catch (err) {
    console.error(`\n❌ ${transport} authentication failed (this is why OTP sends 502):`);
    explain(err);
    if (transport === 'smtp') {
      console.error('\n   Hint: many hosts (Render free tier) block outbound SMTP ports 25/465/587.');
      console.error('   Switch to the Gmail API:  npm run ops:gmail-auth');
    }
    process.exit(2);
  }

  if (!argv.includes('--send')) {
    console.log('(no mail sent — re-run with --send to deliver a test message)');
    return;
  }

  try {
    await sendMail({
      to,
      subject: 'Zoclo email check',
      text: 'If you can read this, outbound mail works.',
      html: '<p>If you can read this, outbound mail works.</p>',
    });
    console.log(`\n✅ Test mail accepted for ${to}`);
  } catch (err) {
    console.error('\n❌ send failed after a successful authentication:');
    explain(err);
    process.exit(3);
  }
}

main().catch((err) => {
  console.error('❌ unexpected failure:', err);
  process.exit(4);
});
