import { prisma } from '../config/prisma';
import { COLLEGE_SEED, normalizeCollegeName } from '../config/college-directory';

/**
 * College directory service.
 * - Seed: idempotent, runs at boot; adds any missing curated colleges.
 * - Search: typeahead against name + shortName, ranked (exact shortName >
 *   shortName prefix > name prefix > name contains), capped at 20 rows.
 * - Create: users may add a college that isn't in the directory; the student
 *   ID verification step is the real trust gate, not this list.
 */
export class CollegeService {
  /** Insert curated colleges that don't exist yet. Safe to run on every boot. */
  async seedDirectory(): Promise<{ added: number; total: number }> {
    let added = 0;
    for (const c of COLLEGE_SEED) {
      const exists = await prisma.college.findFirst({
        where: {
          OR: [{ name: c.name }, { shortName: c.shortName || undefined }],
        },
        select: { id: true },
      });
      if (!exists) {
        await prisma.college.create({ data: { name: c.name, shortName: c.shortName, city: c.city, state: c.state } });
        added++;
      }
    }
    const total = await prisma.college.count();
    return { added, total };
  }

  /** Typeahead search over name + shortName, best matches first. */
  async search(q: string, limit = 20) {
    const query = q.trim().slice(0, 80);
    if (!query) {
      // Popular defaults when the box is empty: biggest names first
      const defaults = await prisma.college.findMany({
        where: { OR: [{ shortName: { in: ['IIT Delhi', 'IIT Bombay', 'BITS Pilani', 'VIT Vellore', 'SRM', 'DTU', 'NSUT', 'DU'] } }, { name: { contains: 'Indian Institute of Technology' } }] },
        orderBy: { name: 'asc' },
        take: Math.min(limit, 20),
      });
      return this.dedupe(defaults);
    }

    const lower = query.toLowerCase();
    const rows = await prisma.college.findMany({
      where: {
        OR: [
          { shortName: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { city: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 200, // fetch a pool, then rank in memory — small table, cheap
    });

    const scored = rows
      .map((c) => {
        const sn = (c.shortName || '').toLowerCase();
        const nm = c.name.toLowerCase();
        let score = 4;
        if (sn && sn === lower) score = 0;
        else if (sn && sn.startsWith(lower)) score = 1;
        else if (nm.startsWith(lower)) score = 2;
        else if (nm.includes(lower)) score = 3;
        else if (c.city?.toLowerCase().startsWith(lower)) score = 3.5;
        return { c, score };
      })
      .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
      .slice(0, Math.min(Math.max(limit, 1), 25))
      .map((x) => x.c);

    return this.dedupe(scored);
  }

  /** Find-or-create by name (used when a student's college isn't listed). */
  async createIfMissing(input: { name: string; shortName?: string; city?: string; state?: string }) {
    const name = input.name.trim().slice(0, 120);
    if (name.length < 4) {
      const e: any = new Error('College name is too short'); e.status = 400; throw e;
    }
    const norm = normalizeCollegeName(name);
    const existing = await prisma.college.findFirst({ where: { name } });
    if (existing) return existing;

    // Also block case/format duplicates
    const all = await prisma.college.findMany({ select: { id: true, name: true } });
    const dup = all.find((c) => normalizeCollegeName(c.name) === norm);
    if (dup) return dup;

    return prisma.college.create({
      data: {
        name,
        shortName: input.shortName?.trim().slice(0, 24) || undefined,
        city: input.city?.trim().slice(0, 60) || undefined,
        state: input.state?.trim().slice(0, 60) || undefined,
      },
    });
  }

  private dedupe(rows: { id: string; name: string; shortName: string | null; city: string | null; state: string | null }[]) {
    const seen = new Set<string>();
    return rows.filter((c) => {
      const key = normalizeCollegeName(c.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
