import { prisma } from './prisma';

/**
 * R2 cost guard — the $0 enforcement layer.
 *
 * STRUCTURE: app_settings key `r2_cost_guard` holds one JSON document:
 * {
 *   "uploadsEnabled": true,          ← the kill switch (read on every upload)
 *   "lastCheckAt": "2026-09-23T…",   ← freshness: stale check = degraded mode
 *   "lastUsage": { "storageBytes": 0, "classA": 0, "classB": 0 },
 *   "lastError": "…", "lastErrorAt": "…"
 * }
 *
 * FAILURE PHILOSOPHY: the kill switch is a PAUSE (503), not data loss.
 * If the flag row is missing/unreadable, uploads stay ENABLED (fail open —
 * a missing row must never take uploads down), but /health/db reports
 * `costGuard: 'stale'` so the watchdog alerts and the checker can self-heal.
 */

export const COST_GUARD_KEY = 'r2_cost_guard';

export interface R2CostGuardDoc {
  uploadsEnabled: boolean;
  lastCheckAt?: string;
  lastUsage?: { storageBytes: number; classA: number; classB: number };
  lastError?: string;
  lastErrorAt?: string;
}

/** Read the upload kill switch. Fails OPEN (uploads stay on) on any error. */
export async function isUploadsEnabled(): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: COST_GUARD_KEY } });
    if (!row) return true; // no doc yet = guard not initialized = uploads on
    const doc = row.value as unknown as R2CostGuardDoc;
    return doc.uploadsEnabled !== false; // undefined = on
  } catch {
    return true; // fail open — the checker + /health/db surface real problems
  }
}

/** Read the whole guard document (undefined if absent). */
export async function readCostGuardDoc(): Promise<R2CostGuardDoc | undefined> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: COST_GUARD_KEY } });
    return row?.value as R2CostGuardDoc | undefined;
  } catch {
    return undefined;
  }
}

/** Upsert the whole guard document (used by the external checker cron). */
export async function writeCostGuardDoc(doc: R2CostGuardDoc): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: COST_GUARD_KEY },
    update: { value: doc as any },
    create: { key: COST_GUARD_KEY, value: doc as any },
  });
}

/** Boot log helper — shows the guard state without throwing. */
export async function logCostGuardState(): Promise<void> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: COST_GUARD_KEY } });
    const doc = row?.value as R2CostGuardDoc | undefined;
    const state =
      !doc
        ? 'not-initialized (uploads on)'
        : doc.uploadsEnabled
          ? `uploads=ON last-check=${doc.lastCheckAt || 'never'}`
          : `uploads=PAUSED since=${doc.lastErrorAt || doc.lastCheckAt || 'unknown'}`;
    console.log(`[cost-guard] ${state}`);
  } catch {
    /* never block boot */
  }
}
