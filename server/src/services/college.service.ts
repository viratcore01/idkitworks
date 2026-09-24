import { prisma } from '../config/prisma';
import { COLLEGE_SEED, normalizeCollegeName } from '../config/college-directory';

/**
 * College directory service.
 * - Seed: idempotent, runs at boot; adds any missing curated colleges and
 *   backfills email domains on existing rows that lack one.
 * - Search: typeahead against name + shortName, ranked (exact shortName >
 *   shortName prefix > name prefix > name contains), capped at 20 rows.
 * - Create: users may add a college that isn't in the directory; the
 *   college-email OTP verification step is the real trust gate, not this list.
 */
export class CollegeService {
  /**
   * Insert curated colleges that don't exist yet. Safe to run on every boot.
   * FAST by design: one read for the whole directory, in-memory diff, batched
   * writes — the old row-by-row version paid 400+ sequential round-trips on
   * every cold boot and raced every request served in between.
   */
  async seedDirectory(): Promise<{ added: number; total: number }> {
    const existing = await prisma.college.findMany({ select: { name: true, shortName: true } });
    const names = new Set(existing.map((c) => c.name));
    const shorts = new Set(existing.map((c) => c.shortName).filter(Boolean) as string[]);
    const norms = new Set(existing.map((c) => normalizeCollegeName(c.name)));
    const missing = COLLEGE_SEED.filter(
      (c) => !names.has(c.name) && !(c.shortName && shorts.has(c.shortName)) && !norms.has(normalizeCollegeName(c.name)),
    );
    let added = 0;
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50).map((c) => ({
        name: c.name,
        shortName: c.shortName,
        city: c.city,
        state: c.state,
        emailDomain: c.emailDomain,
      }));
      try {
        const r = await prisma.college.createMany({ data: chunk });
        added += r.count;
      } catch {
        // Chunk raced another instance (or a user row): insert one by one,
        // skipping rows that lost the race.
        for (const row of chunk) {
          try {
            await prisma.college.create({ data: row });
            added++;
          } catch { /* lost the race — the row exists, which is the goal */ }
        }
      }
    }
    // Backfill: existing rows created before email domains existed get
    // theirs from the seed. Skips rows that already have a domain and
    // seeds without one — idempotent, runs every boot.
    let backfilled = 0;
    const wantDomain = new Map(
      COLLEGE_SEED.filter((c) => c.emailDomain).map((c) => [c.name, c.emailDomain!] as const),
    );
    if (wantDomain.size) {
      const lacking = await prisma.college.findMany({
        where: { name: { in: [...wantDomain.keys()] }, emailDomain: null },
        select: { name: true },
      });
      for (const row of lacking) {
        try {
          await prisma.college.update({
            where: { name: row.name },
            data: { emailDomain: wantDomain.get(row.name)! },
          });
          backfilled++;
        } catch { /* raced another instance — the domain landed, which is the goal */ }
      }
    }
    const total = await prisma.college.count();
    return { added: added + backfilled, total };
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

    const scored = rows.map((c) => {
      const sn = (c.shortName || '').toLowerCase();
      const nm = c.name.toLowerCase();
      // Word-boundary matches outrank raw substrings: "christ" should find
      // Christ University before Christian Medical College.
      const wordHit = (s: string) => s.split(/[^a-z0-9]+/).some((w) => w.startsWith(lower));
      let score = 4;
      if (sn && sn === lower) score = 0;
      else if (sn && sn.startsWith(lower)) score = 1;
      else if (nm.startsWith(lower)) score = 2;
      else if (wordHit(nm)) score = 2.5;
      else if (nm.includes(lower)) score = 3;
      else if (c.city?.toLowerCase().startsWith(lower)) score = 3.5;
      return { c, score };
    });

    // Real-data-outranks-junk tiebreak: among equal text scores, campuses
    // with actual students come first. A generic junk row ("IIT" with no
    // city, zero users) can never outrank the real IITs people study in.
    const counts = await prisma.user.groupBy({
      by: ['collegeId'],
      _count: { collegeId: true },
      where: { collegeId: { in: scored.map((s) => s.c.id) } },
    });
    const usersOf = new Map(counts.map((g) => [g.collegeId, g._count.collegeId]));

    return this.dedupe(
      scored
        .sort(
          (a, b) =>
            a.score - b.score ||
            (usersOf.get(b.c.id) || 0) - (usersOf.get(a.c.id) || 0) ||
            (a.c.city ? 0 : 1) - (b.c.city ? 0 : 1) ||
            a.c.name.localeCompare(b.c.name),
        )
        .slice(0, Math.min(Math.max(limit, 1), 25))
        .map((x) => x.c),
    );
  }

  /** Find-or-create by name (used when a student's college isn't listed). */
  async createIfMissing(input: { name: string; shortName?: string; city?: string; state?: string; emailDomain?: string }) {
    const name = input.name.trim().slice(0, 120);
    if (name.length < 4) {
      const e: any = new Error('College name is too short'); e.status = 400; throw e;
    }
    const norm = normalizeCollegeName(name);
    const existing = await prisma.college.findFirst({ where: { name } });
    if (existing) return { college: existing, created: false };

    // Also block case/format duplicates
    const all = await prisma.college.findMany({ select: { id: true, name: true } });
    const dup = all.find((c) => normalizeCollegeName(c.name) === norm);
    if (dup) {
      const row = await prisma.college.findUnique({ where: { id: dup.id } });
      return { college: row!, created: false };
    }

    // Guard against generic junk ("IIT", "College", "ABC") squatting the
    // directory: a new name must either carry a city or be specific enough
    // (4+ words or an existing-style long name). Curated seeds bypass this.
    const words = name.split(/\s+/).filter(Boolean);
    if (!input.city && words.length < 3 && name.length < 20) {
      const e: any = new Error('Add your city with the college name (e.g. "IIT Delhi, New Delhi") so students find the right campus');
      e.status = 400;
      throw e;
    }

    const college = await prisma.college.create({
      data: {
        name,
        shortName: input.shortName?.trim().slice(0, 24) || undefined,
        city: input.city?.trim().slice(0, 60) || undefined,
        state: input.state?.trim().slice(0, 60) || undefined,
        emailDomain: input.emailDomain?.trim().toLowerCase() || undefined,
      },
    }).catch((err: any) => {
      // Simultaneous duplicate creates: the unique index wins, loser reads it.
      if (err?.code !== 'P2002') throw err;
      return null;
    });
    if (!college) {
      const row = await prisma.college.findFirst({ where: { name } });
      return { college: row!, created: false };
    }
    return { college, created: true };
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
