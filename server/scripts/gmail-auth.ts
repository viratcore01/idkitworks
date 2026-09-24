/**
 * Mint a Gmail API refresh token for the OTP sender — run this ONCE, locally.
 *
 *   npm run ops:gmail-auth               (interactive: opens the browser)
 *   npm run ops:gmail-auth -- --dry-run  (print the consent URL only)
 *
 * Why this exists: managed hosts (Render and friends) block outbound SMTP, so
 * production sends OTP mail through the Gmail REST API over HTTPS instead. That
 * needs an OAuth refresh token; this script walks you through getting one.
 *
 * Prereqs (https://console.cloud.google.com, project 650769239333):
 *   1. APIs & Services → Library → enable "Gmail API".
 *   2. OAuth consent screen → add the scope .../auth/gmail.send and add your
 *      Gmail address as a "Test user".
 *      ⚠️  Set publishing status to "In production". An External consent
 *      screen left in "Testing" issues refresh tokens that EXPIRE AFTER
 *      7 DAYS — email works, then silently dies a week later.
 *   3. Put the client ID + secret in server/.env (this client reuses the
 *      Google Sign-In one; its registered redirect URI
 *      http://localhost:5173/login is what this script listens on).
 *
 * On success the refresh token is appended to server/.env AND printed, then
 * verify delivery with:  npm run ops:email-check -- --send
 *
 * The script requests ONLY gmail.send — it can send mail as the account and
 * nothing else (no inbox access).
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

import { GMAIL_SEND_SCOPE } from '../src/utils/email';

// Google rejects any redirect_uri that is not registered verbatim on the
// OAuth client ("redirect_uri_mismatch"), so listen on the one this client
// already has: the app's localhost login route.
const REDIRECT_PORT = 5173;
const REDIRECT_PATH = '/login';
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`;
const ENV_PATH = path.resolve(__dirname, '..', '.env');

const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || '';
const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || '';
const account = process.env.GMAIL_USER || '';

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, () => { /* if it fails the URL is printed anyway */ });
}

async function exchangeCode(code: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Token exchange failed (HTTP ${res.status}): ${raw.slice(0, 400)}`);
  const json = JSON.parse(raw) as { refresh_token?: string };
  if (!json.refresh_token) {
    throw new Error(
      'No refresh_token in the response. Revoke this app at ' +
      'https://myaccount.google.com/permissions and run again — Google only ' +
      'returns a refresh token the first time an account consents.',
    );
  }
  return json.refresh_token;
}

/** Append or replace KEY=VALUE in server/.env, returning whether it existed. */
function upsertEnvVar(key: string, value: string): void {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  const next = re.test(raw) ? raw.replace(re, line) : `${raw.replace(/\s*$/, '\n')}${line}\n`;
  fs.writeFileSync(ENV_PATH, next, 'utf8');
}

function main(): void {
  if (!clientId || !clientSecret) {
    console.error('❌ Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET in server/.env first.');
    console.error('   See the header of this file for the Google Cloud steps.');
    console.error(`   Sender       : ${account || '(set GMAIL_USER)'}`);
    console.error(`   Redirect URI : ${REDIRECT_URI}  ← must be registered on that OAuth client`);
    process.exit(1);
  }

  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: GMAIL_SEND_SCOPE,
      access_type: 'offline',
      prompt: 'consent', // forces a refresh_token even on a repeat consent
    }).toString();

  // --dry-run prints the consent URL and the config it would use, without
  // listening or opening a browser — lets you confirm the client ID and the
  // registered redirect URI before a real run.
  if (process.argv.includes('--dry-run')) {
    console.log('client_id    :', clientId);
    console.log('sender       :', account || '(GMAIL_USER not set)');
    console.log('redirect_uri :', REDIRECT_URI);
    console.log('scope        :', GMAIL_SEND_SCOPE);
    console.log('\nConsent URL:\n' + authUrl + '\n');
    return;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', REDIRECT_URI);
    if (url.pathname !== REDIRECT_PATH) {
      res.writeHead(404).end('Not found');
      return;
    }

    const err = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (err || !code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Authorization failed — check the terminal.');
      console.error(`\n❌ Google returned: ${err || 'no code'}`);
      server.close();
      process.exit(2);
    }

    try {
      const refreshToken = await exchangeCode(code);
      upsertEnvVar('GMAIL_OAUTH_REFRESH_TOKEN', refreshToken);
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Done — return to your terminal.');
      console.log('\n✅ Refresh token minted and written to server/.env\n');
      console.log('Add the OAuth trio to your host\'s environment variables too (Render dashboard):');
      console.log('  GMAIL_USER, GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN');
      console.log('\nThen verify with:  npm run ops:email-check -- --send\n');
      server.close();
      process.exit(0);
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Token exchange failed — check the terminal.');
      console.error(`\n❌ ${e?.message || e}`);
      server.close();
      process.exit(3);
    }
  });

  server.listen(REDIRECT_PORT, () => {
    console.log('Opening Google consent — if nothing happens, paste this URL:\n');
    console.log(`  ${authUrl}\n`);
    console.log(`Waiting for the redirect on ${REDIRECT_URI} …`);
    openBrowser(authUrl);
  });

  server.on('error', (e: any) => {
    if (e?.code === 'EADDRINUSE') {
      console.error(`❌ Port ${REDIRECT_PORT} is busy (the Vite dev server?). Stop it and re-run.`);
    } else {
      console.error('❌', e);
    }
    process.exit(4);
  });
}

main();
