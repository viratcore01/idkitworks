/**
 * Cloudflare R2 usage checker — the kill-switch cron.
 *
 * Queries Cloudflare's GraphQL Analytics API for month-to-date R2 usage,
 * compares against the free-tier caps, and PAUSES uploads (writes
 * app_settings.r2_cost_guard.uploadsEnabled=false) before overage can happen.
 * Sends a Telegram alert on any trip. The API reads the same flag in
 * photo.controller.uploadPhoto and returns 503 until the flag is flipped back.
 *
 * TOKEN REQUIREMENT (verified live 2026-09-23): the bucket-scoped object token
 * used by the app CANNOT read analytics ("not authorized for that account").
 * Create a SECOND token: dash.cloudflare.com → My Profile → API Tokens →
 * Create Token → "Read all resources" (or Account.Analytics:Read scoped to
 * the account). Put it in server/.env as CF_API_TOKEN_ANALYTICS.
 *
 * RUN:  npx tsx scripts/check-r2-usage.ts           (once, to test)
 */
// CRON — every 15 min (the */15 form is fine inside a line comment):
//   */15 * * * * cd /srv/zoclo/server && npx tsx scripts/check-r2-usage.ts >> /var/log/zoclo-r2-guard.log 2>&1
// Intervals: 15 min is plenty — Class B (reads) is the fastest-moving cap
// (10M/month ≈ 230k/day), and the guard pauses only NEW uploads, which is
// exactly the growth vector. The checker itself never touches R2.
import fs from 'fs';
import path from 'path';

// ── env (server/.env) ────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..', '..');
const envFile = path.join(ROOT, 'server', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '').trim();
  }
}

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const API_TOKEN = process.env.CF_API_TOKEN_ANALYTICS || '';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || '';

// ── free caps (Cloudflare R2 always-free) ────────────────────
const CAPS = {
  storageBytes: 10 * 1024 ** 3, // 10 GB-month average
  classA: 1_000_000, // writes/lists per month
  classB: 10_000_000, // reads per month
};
const PAUSE = {
  storageBytes: Number(process.env.R2_USAGE_PAUSE_STORAGE || 0.8),
  classA: Number(process.env.R2_USAGE_PAUSE_CLASS_A || 0.8),
  classB: Number(process.env.R2_USAGE_PAUSE_CLASS_B || 0.8),
}; // fractions of the free caps at which new uploads pause (default 80%)

// ── GraphQL: storage is a GAUGE (max, not sum — verified against the API);
// ops are per-actionType request sums for the period. ────────────────────
const QUERY = `
query ($account: String!, $since: Date!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      storage: r2StorageAdaptiveGroups(
        limit: 1, filter: { date_geq: $since }
      ) { max { payloadSize objectCount } }
      ops: r2OperationsAdaptiveGroups(
        limit: 10, filter: { date_geq: $since }
      ) { sum { requests } dimensions { actionType } }
    }
  }
}`;

interface Usage {
  storageBytes: number;
  classA: number;
  classB: number;
}

async function fetchUsage(): Promise<Usage> {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10);

  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { account: ACCOUNT_ID, since } }),
  });
  const json: any = await res.json();
  if (json.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);

  const acc = json.data?.viewer?.accounts?.[0];
  if (!acc) throw new Error('No account data returned — check token scope / accountTag');

  const storageBytes = acc.storage?.max?.payloadSize ?? 0;
  let classA = 0;
  let classB = 0;
  for (const row of acc.ops ?? []) {
    const a: string = row.dimensions?.actionType ?? '';
    const n: number = row.sum?.requests ?? 0;
    const isClassA = [
      'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateBucket',
      'ListObjects', 'ListBuckets', 'GetBucketInfo', 'HeadBucket',
    ].includes(a);
    if (isClassA) classA += n;
    else classB += n;
  }
  return { storageBytes, classA, classB };
}

async function telegram(msg: string): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    console.log('[telegram] not configured — message suppressed:', msg);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg }),
    });
  } catch (e: any) {
    console.error('[telegram] send failed:', e?.message || e); // alerting must never crash the checker
  }
}

async function main(): Promise<void> {
  if (!ACCOUNT_ID || !API_TOKEN) {
    console.error('Missing R2_ACCOUNT_ID or CF_API_TOKEN_ANALYTICS — refusing to run.');
    process.exit(1);
  }

  const { prisma } = await import('../src/config/prisma');
  const { writeCostGuardDoc } = await import('../src/config/cost-guard');

  const usage = await fetchUsage();
  const overStorage = usage.storageBytes >= CAPS.storageBytes * PAUSE.storageBytes;
  const overA = usage.classA >= CAPS.classA * PAUSE.classA;
  const overB = usage.classB >= CAPS.classB * PAUSE.classB;
  const shouldPause = overStorage || overA || overB;

  await writeCostGuardDoc({
    uploadsEnabled: !shouldPause,
    lastCheckAt: new Date().toISOString(),
    lastUsage: usage,
  });

  const pct = (v: number, cap: number) => `${((v / cap) * 100).toFixed(1)}%`;
  console.log(
    `[r2-guard] storage ${pct(usage.storageBytes, CAPS.storageBytes)} · ` +
      `ClassA ${pct(usage.classA, CAPS.classA)} · ClassB ${pct(usage.classB, CAPS.classB)} · ` +
      `uploads ${shouldPause ? 'PAUSED' : 'ok'}`
  );

  if (shouldPause) {
    await telegram(
      `🛑 Zoclo R2 guard: uploads PAUSED — ` +
        `${overStorage ? `storage ${pct(usage.storageBytes, CAPS.storageBytes)} ` : ''}` +
        `${overA ? `ClassA ${pct(usage.classA, CAPS.classA)} ` : ''}` +
        `${overB ? `ClassB ${pct(usage.classB, CAPS.classB)}` : ''}`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[r2-guard] check failed:', e?.message || e);
  // Record the failure so /health/db can flag staleness (see cost-guard.ts).
  try {
    const { prisma } = await import('../src/config/prisma');
    const { readCostGuardDoc, writeCostGuardDoc } = await import('../src/config/cost-guard');
    const prev = await readCostGuardDoc();
    await writeCostGuardDoc({
      ...prev,
      uploadsEnabled: prev?.uploadsEnabled !== false, // never pause due to a checker failure
      lastError: e?.message || String(e),
      lastErrorAt: new Date().toISOString(),
    });
    await prisma.$disconnect();
    // Deduped alert: first failure ever, or none in the last 6h — a dead
    // token/network shouldn't spam Telegram every 15 min. /health/db also
    // exposes lastError+stale for the watchdog to alert on.
    const lastAlert = Date.parse(prev?.lastErrorAt || '') || 0;
    if (!prev?.lastError || Date.now() - lastAlert > 6 * 3600 * 1000) {
      await telegram(
        `⚠️ Zoclo R2 guard: usage check FAILED — uploads stay ` +
          `${prev?.uploadsEnabled === false ? 'PAUSED' : 'enabled'}: ` +
          `${e?.message || e}`,
      );
    }
  } catch { /* nothing more we can do */ }
  process.exit(1);
});
