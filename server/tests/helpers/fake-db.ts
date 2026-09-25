/**
 * In-memory fake for the Prisma delegates the auth system touches.
 *
 * Why a hand-rolled fake instead of a mock framework: the project ships zero
 * test dependencies, Prisma delegates are plain prototype methods (so they can
 * be shadowed in place), and a fake that actually stores rows lets the tests
 * assert real state transitions — "the OTP row now has usedAt set", "the
 * refresh token was rotated" — instead of asserting on call choreography.
 *
 * Supported (deliberately narrow, matching real call sites):
 *   where:  OR / AND / NOT, scalar equality, { equals, mode: 'insensitive' },
 *           { in / notIn }, { gt/gte/lt/lte }, { not }, null checks, Date compare,
 *           scalar-list { has / hasSome / hasEvery / isEmpty },
 *           relation { some / every / none } + to-one nesting
 *           (user.photos/receivedLikes/matchesA-B/blockedUsers-blockedBy,
 *           matchLike.sender, match.userAObj/userBObj)
 *   ops:    findFirst, findMany, findUnique, create, createMany, upsert,
 *           update, updateMany, delete, deleteMany, count
 *   misc:   orderBy, skip, take, select (top-level), include (explicit relation map)
 */

type Row = Record<string, any>;

/** Prisma filter operators — the presence of any one means "not a compound key". */
const FILTER_OPERATORS = new Set([
  'equals', 'in', 'not', 'notIn', 'gt', 'gte', 'lt', 'lte', 'mode', 'contains',
  'startsWith', 'endsWith', 'search', 'has', 'hasEvery', 'hasSome', 'isEmpty',
  'some', 'every', 'none', 'is', 'isNot',
]);

/**
 * `{ conversationId_userId: { conversationId, userId } }` → true.
 *
 * Prisma names compound uniques by joining the field names with "_", so the
 * underscore is the signal. Matching purely on "it's an object whose keys
 * aren't operators" also matched ordinary filters like `NOT: { id: 'x' }`,
 * hoisting them to the top level and matching every row instead of none.
 */
function isCompoundKey(key: string, value: any): boolean {
  if (!key.includes('_')) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => !FILTER_OPERATORS.has(k));
}

function cmp(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  return av > bv ? 1 : -1;
}

/**
 * Relation map for WHERE-filters the services actually use:
 *   to-many:  `photos: { some: {} }`, `receivedLikes: { none: { senderId } }`,
 *             `matchesA/B`, `blockedUsers/blockedBy: { none: ... }`
 *   to-one:   `sender: {...}` (matchLike), `userAObj/userBObj: {...}` (match)
 * Scalar-list ops (`relationshipGoals: { hasSome / isEmpty }`) are handled
 * generically for any array-valued field.
 */
type RelDef = { table: string; fk: string; single?: boolean };
const RELATIONS: Record<string, Record<string, RelDef>> = {
  user: {
    photos: { table: 'userPhoto', fk: 'userId' },
    receivedLikes: { table: 'matchLike', fk: 'receiverId' },
    matchesA: { table: 'match', fk: 'userA' },
    matchesB: { table: 'match', fk: 'userB' },
    blockedUsers: { table: 'block', fk: 'blockerId' },
    blockedBy: { table: 'block', fk: 'blockedId' },
  },
  matchLike: {
    sender: { table: 'user', fk: 'senderId', single: true },
  },
  match: {
    userAObj: { table: 'user', fk: 'userA', single: true },
    userBObj: { table: 'user', fk: 'userB', single: true },
  },
};

interface MatchCtx {
  db: FakeDb;
  model: string;
}

function matchesWhere(row: Row, where: any, ctx?: MatchCtx): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return (cond as any[]).some((c) => matchesWhere(row, c, ctx));
    if (key === 'AND') return (cond as any[]).every((c) => matchesWhere(row, c, ctx));
    // NOT takes an object or an array (getMatches blocks out blocked exes with
    // a list): an array excludes the row when ANY clause matches.
    if (key === 'NOT') {
      return Array.isArray(cond)
        ? (cond as any[]).every((c) => !matchesWhere(row, c, ctx))
        : !matchesWhere(row, cond, ctx);
    }
    // Relation filters (only with a model context; without one they stay
    // non-matching, exactly like before this support existed).
    const rel = ctx && RELATIONS[ctx.model]?.[key];
    if (rel) {
      if (rel.single) {
        const target = ctx!.db.rows(rel.table).find((r) => r.id === row[rel.fk]) ?? null;
        if (!target) return false;
        return matchesWhere(target, cond, { db: ctx!.db, model: rel.table });
      }
      const related = ctx!.db.rows(rel.table).filter((r) => r[rel.fk] === row.id);
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('some' in cond) return related.some((r) => matchesWhere(r, cond.some, { db: ctx!.db, model: rel.table }));
        if ('every' in cond) return related.every((r) => matchesWhere(r, cond.every, { db: ctx!.db, model: rel.table }));
        if ('none' in cond) return !related.some((r) => matchesWhere(r, cond.none, { db: ctx!.db, model: rel.table }));
      }
      return false;
    }
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    if (typeof cond !== 'object') return value === cond;
    if (Array.isArray(cond)) return Array.isArray(value) && cond.every((v) => value.includes(v));
    // Scalar-list ops (e.g. relationshipGoals: { hasSome / isEmpty }).
    if (Array.isArray(value)) {
      if ('hasSome' in cond) return (cond.hasSome as any[]).some((v) => value.includes(v));
      if ('hasEvery' in cond) return (cond.hasEvery as any[]).every((v) => value.includes(v));
      if ('has' in cond) return value.includes(cond.has);
      if ('isEmpty' in cond) return (value.length === 0) === !!cond.isEmpty;
    }
    if ('equals' in cond) {
      if (cond.mode === 'insensitive' && typeof cond.equals === 'string') {
        return String(value ?? '').toLowerCase() === cond.equals.toLowerCase();
      }
      return value === cond.equals;
    }
    if ('in' in cond) return (cond.in as any[]).includes(value);
    if ('notIn' in cond) return !(cond.notIn as any[]).includes(value);
    if ('not' in cond) return value !== cond.not;
    // Range bounds compose conjunctively: { gte, lte } must satisfy BOTH.
    // (Checking only the first present operator silently turned every
    // age range into a lower bound — the deck's segregation looked broken.)
    if ('gt' in cond || 'gte' in cond || 'lt' in cond || 'lte' in cond) {
      if (value == null) return false;
      if ('gt' in cond && !(cmp(value, cond.gt) > 0)) return false;
      if ('gte' in cond && !(cmp(value, cond.gte) >= 0)) return false;
      if ('lt' in cond && !(cmp(value, cond.lt) < 0)) return false;
      if ('lte' in cond && !(cmp(value, cond.lte) <= 0)) return false;
      return true;
    }
    return false;
  });
}

function project(row: Row | null, select: any): Row | null {
  if (!row) return null;
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, val] of Object.entries(select)) {
    if (!val) continue;
    if (key === '_count') {
      out._count = row._count ?? { posts: 0 };
    } else if (typeof val === 'object') {
      out[key] = row[key] ?? null;
    } else {
      out[key] = row[key] ?? null;
    }
  }
  return out;
}

export interface FakeDbOptions {
  colleges?: Row[];
  users?: Row[];
  refreshTokens?: Row[];
  emailOtps?: Row[];
  interests?: Row[];
  userInterests?: Row[];
  userPhotos?: Row[];
  posts?: Row[];
  comments?: Row[];
  notifications?: Row[];
  reports?: Row[];
  blocks?: Row[];
  matchLikes?: Row[];
  matches?: Row[];
  messages?: Row[];
  conversationMembers?: Row[];
  conversations?: Row[];
  savedPosts?: Row[];
  postLikes?: Row[];
  matchPreferences?: Row[];
}

/** Model → the array holding its rows. Names are the Prisma delegate names. */
/**
 * Column defaults, mirroring prisma/schema.prisma. The real client fills these
 * in on INSERT; without them a created row would carry `undefined` for
 * isActive / verificationStatus / collegeEmailVerified, which reads as falsy
 * in the services and produces failures that have nothing to do with the code
 * under test.
 */
const COLUMN_DEFAULTS: Record<string, Row> = {
  user: {
    googleId: null,
    avatarUrl: null,
    avatarPhotoId: null,
    bio: null,
    collegeId: null,
    course: null,
    year: null,
    gender: 'UNKNOWN',
    dateOfBirth: null,
    isVerified: false,
    relationshipGoals: [],
    verificationStatus: 'UNVERIFIED',
    isActive: true,
    role: 'user',
    isFounder: false,
    moderatedCollegeId: null,
    collegeEmail: null,
    collegeEmailVerified: false,
    collegeEmailVerifiedAt: null,
    updatedAt: new Date(),
  },
  emailOtp: { attempts: 0, purpose: 'COLLEGE_EMAIL_VERIFY', usedAt: null },
  // The real client fills @defaults on INSERT (Match.status ACTIVE, …);
  // without them created rows carry `undefined` and read as filter misses.
  match: { status: 'ACTIVE' },
};

export class FakeDb {
  tables: Record<string, Row[]> = {};
  private seq = 0;

  constructor(seed: FakeDbOptions = {}) {
    const map: Record<string, keyof FakeDbOptions> = {
      college: 'colleges',
      user: 'users',
      refreshToken: 'refreshTokens',
      emailOtp: 'emailOtps',
      interest: 'interests',
      userInterest: 'userInterests',
      userPhoto: 'userPhotos',
      post: 'posts',
      comment: 'comments',
      notification: 'notifications',
      report: 'reports',
      block: 'blocks',
      matchLike: 'matchLikes',
      match: 'matches',
      message: 'messages',
      conversationMember: 'conversationMembers',
      conversation: 'conversations',
      savedPost: 'savedPosts',
      postLike: 'postLikes',
      matchPreference: 'matchPreferences',
    };
    for (const [model, key] of Object.entries(map)) {
      this.tables[model] = (seed[key] as Row[]) || [];
    }
  }

  rows(model: string): Row[] {
    if (!this.tables[model]) this.tables[model] = [];
    return this.tables[model];
  }

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }

  /**
   * Persist nested relation WRITES (`{ interests: { create: [...] } }`) and
   * strip them from the scalar patch. Both create and update go through this —
   * the update path is what `updateProfile` uses to replace interests, and
   * silently dropping it made the write look like a no-op.
   */
  applyNestedWrites(ownerId: string, data: Row): Row {
    const clean: Row = { ...data };
    const create = (clean.interests as any)?.create;
    if (create) {
      const list = Array.isArray(create) ? create : [create];
      for (const item of list) {
        this.rows('userInterest').push({ userId: ownerId, ...item, id: this.nextId('userInterest') });
      }
      delete clean.interests;
    }
    return clean;
  }

  /**
   * Build the final returned object: the projected scalars plus every relation
   * the caller asked for via `select` OR `include`, resolved from the row that
   * is actually stored (never from the projection, which may not carry ids).
   */
  finalize(model: string, row: Row | null, args: any = {}): Row | null {
    if (!row) return null;
    const out: Row = project(row, args?.select) ?? {};
    const requested = { ...(args?.select ?? {}), ...(args?.include ?? {}) };
    for (const [key, spec] of Object.entries(requested)) {
      if (!spec) continue;
      if (key === '_count') {
        out._count = { posts: this.rows('post').filter((p) => p.authorId === row.id).length };
      } else if (model === 'user' && key === 'college') {
        out.college = this.rows('college').find((c) => c.id === row.collegeId) ?? null;
      } else if (model === 'user' && key === 'interests') {
        out.interests = this.rows('userInterest')
          .filter((ui) => ui.userId === row.id)
          .map((ui) => ({
            ...ui,
            interest: this.rows('interest').find((i) => i.id === ui.interestId) ?? null,
          }));
      } else if (model === 'user' && key === 'photos') {
        out.photos = this.rows('userPhoto').filter((p) => p.userId === row.id);
      } else if (model === 'user' && key === 'matchPreference') {
        out.matchPreference = this.rows('matchPreference').find((m) => m.userId === row.id) ?? null;
      } else if (model === 'matchLike' && key === 'sender') {
        const target = this.rows('user').find((u) => u.id === row.senderId) ?? null;
        out.sender = target ? this.finalize('user', target, { select: (spec as any)?.select }) : null;
      } else if (model === 'match' && (key === 'userAObj' || key === 'userBObj')) {
        const idKey = key === 'userAObj' ? 'userA' : 'userB';
        const target = this.rows('user').find((u) => u.id === row[idKey]) ?? null;
        out[key] = target ? this.finalize('user', target, { select: (spec as any)?.select }) : null;
      } else if (key === 'user') {
        const nested = this.rows('user').find((u) => u.id === row.userId) ?? null;
        const nestedSelect = (spec as any)?.select;
        out.user = nestedSelect ? project(nested, nestedSelect) : nested;
      }
    }
    return out;
  }

  private applyOrderAndTake(rows: Row[], args: any): Row[] {
    let out = rows;
    const order = args?.orderBy;
    if (order) {
      const [field, dir] = Object.entries(order)[0] as [string, string];
      out = [...out].sort((a, b) => {
        const c = cmp(a[field], b[field]);
        return dir === 'desc' ? -c : c;
      });
    }
    if (typeof args?.skip === 'number' && args.skip > 0) out = out.slice(args.skip);
    if (typeof args?.take === 'number') out = out.slice(0, args.take);
    return out;
  }

  private uniqueWhere(model: string, args: any): any {
    const where = args?.where ?? {};
    // Flatten Prisma COMPOUND unique keys (e.g. {conversationId_userId: {…}})
    // into their parts — but never a filter operator. Driving the decision off
    // "is it an object?" silently unwrapped { lt: … } / { not: … } / { in: … }
    // into top-level keys that matched nothing, which would quietly disable the
    // very filters a test is asserting on.
    const out: Row = {};
    for (const [k, v] of Object.entries(where)) {
      if (isCompoundKey(k, v)) Object.assign(out, v as Row);
      else out[k] = v;
    }
    return out;
  }

  /** Build a delegate (findFirst/findMany/create/…) for one model. */
  delegate(model: string): Row {
    const db = this;
    const rows = () => db.rows(model);

    return {
      async findFirst(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        const hit = db.applyOrderAndTake(rows().filter((r) => matchesWhere(r, where, { db, model })), args)[0] ?? null;
        return db.finalize(model, hit, args);
      },

      async findMany(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        const list = db.applyOrderAndTake(rows().filter((r) => matchesWhere(r, where, { db, model })), args);
        return list.map((r) => db.finalize(model, r, args));
      },

      async findUnique(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        const hit = rows().find((r) => matchesWhere(r, where, { db, model })) ?? null;
        return db.finalize(model, hit, args);
      },

      async create(args: any = {}) {
        const data: Row = args.data ?? {};
        const id = data.id ?? db.nextId(model);
        const row: Row = {
          ...(COLUMN_DEFAULTS[model] ?? {}),
          id,
          createdAt: data.createdAt ?? new Date(),
          ...db.applyNestedWrites(id, data),
        };
        rows().push(row);
        return db.finalize(model, row, args);
      },

      async createMany(args: any = {}) {
        const items = Array.isArray(args.data) ? args.data : [args.data];
        for (const item of items) {
          rows().push({ ...(COLUMN_DEFAULTS[model] ?? {}), id: db.nextId(model), createdAt: new Date(), ...item });
        }
        return { count: items.length };
      },

      async upsert(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        const row = rows().find((r) => matchesWhere(r, where, { db, model }));
        if (row) {
          Object.assign(row, db.applyNestedWrites(row.id, args.update ?? {}));
          return db.finalize(model, row, args);
        }
        // Create path: unique scalars usually live in `where` (compound keys
        // flatten there), the rest in `create` — merge both, create wins.
        const base: Row = {};
        for (const [k, v] of Object.entries(where)) {
          if (typeof v !== 'object' || v instanceof Date) base[k] = v;
        }
        const data: Row = { ...(args.create ?? {}) };
        const id = data.id ?? (base as any).id ?? db.nextId(model);
        const fresh: Row = {
          ...(COLUMN_DEFAULTS[model] ?? {}),
          id,
          createdAt: data.createdAt ?? new Date(),
          ...base,
          ...db.applyNestedWrites(id, data),
        };
        rows().push(fresh);
        return db.finalize(model, fresh, args);
      },

      async update(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        const row = rows().find((r) => matchesWhere(r, where, { db, model }));
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        Object.assign(row, db.applyNestedWrites(row.id, args.data ?? {}));
        return db.finalize(model, row, args);
      },

      async updateMany(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        const hits = rows().filter((r) => matchesWhere(r, where, { db, model }));
        for (const row of hits) Object.assign(row, args.data ?? {});
        return { count: hits.length };
      },

      async delete(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        const idx = rows().findIndex((r) => matchesWhere(r, where, { db, model }));
        if (idx === -1) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        const [removed] = rows().splice(idx, 1);
        return removed;
      },

      async deleteMany(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        const table = rows();
        const keep = args?.where ? table.filter((r) => !matchesWhere(r, where, { db, model })) : [];
        const count = table.length - keep.length;
        table.length = 0;
        table.push(...keep);
        return { count };
      },

      async count(args: any = {}) {
        const where = db.uniqueWhere(model, args);
        return rows().filter((r) => matchesWhere(r, where, { db, model })).length;
      },
    };
  }
}

/**
 * Install the fake over a real PrismaClient instance's delegates.
 *
 * Prisma delegates are plain prototype methods, so assigning own properties
 * shadows them. The instance is never connected in tests (DATABASE_URL points
 * at an unreachable host — see helpers/env.ts), so a call that escapes the fake
 * fails loudly instead of touching a real database.
 */
export function install(db: FakeDb, prisma: any): void {
  const models = [
    'college', 'user', 'refreshToken', 'emailOtp', 'interest', 'userInterest', 'userPhoto',
    'post', 'comment', 'notification', 'report', 'block', 'matchLike', 'match',
    'message', 'conversationMember', 'conversation', 'savedPost', 'postLike',
    'matchPreference',
  ];
  for (const model of models) {
    if (!prisma[model]) {
      try {
        prisma[model] = {};
      } catch {
        /* read-only delegate — the assigns below still work if it's writable */
      }
    }
    Object.assign(prisma[model], db.delegate(model));
  }
  prisma.$transaction = async (arg: any, _opts?: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg);
  prisma.$connect = async () => undefined;
  prisma.$disconnect = async () => undefined;
}

/** Deterministic user factory with sane auth defaults. */
export function makeUser(over: Partial<Row> = {}): Row {
  return {
    id: over.id ?? 'user-1',
    email: 'student@ipec.org.in',
    passwordHash: '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7tAUFnOnV0Co7f3OSJ8X6VzX2rZC0Ny',
    googleId: null,
    username: 'student',
    displayName: 'Test Student',
    // Pre-existing accounts chose their handle in the old wizard (mirrors the
    // migration 0006 backfill); tests for fresh signups opt out explicitly.
    usernameChosen: true,
    avatarUrl: null,
    avatarPhotoId: null,
    bio: null,
    collegeId: 'college-1',
    course: null,
    year: null,
    gender: 'UNKNOWN',
    dateOfBirth: null,
    isVerified: false,
    relationshipGoals: [],
    verificationStatus: 'UNVERIFIED',
    isActive: true,
    role: 'user',
    isFounder: false,
    moderatedCollegeId: null,
    collegeEmail: null,
    collegeEmailVerified: false,
    collegeEmailVerifiedAt: null,
    // Fresh by default: "stale abandoned signup" tests opt into an old date
    // explicitly, so nothing else silently lands inside the 7-day purge window.
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

export function makeCollege(over: Partial<Row> = {}): Row {
  return {
    id: 'college-1',
    name: 'Ideal Institute of Technology',
    shortName: 'IIT',
    city: 'Coimbatore',
    state: 'TN',
    logoUrl: null,
    emailDomain: 'ipec.org.in',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

/** Assert a rejected promise carries an HTTP status (and optionally a code). */
export async function rejectsWithStatus(
  fn: () => Promise<any>,
  status: number,
  code?: string,
): Promise<any> {
  try {
    await fn();
  } catch (err: any) {
    const actual = err?.status;
    if (actual !== status) {
      throw new Error(`Expected status ${status} but got ${actual} (${err?.message})`);
    }
    if (code && err?.code !== code) {
      throw new Error(`Expected code ${code} but got ${err?.code} (${err?.message})`);
    }
    return err;
  }
  throw new Error(`Expected rejection with status ${status}, but the call resolved`);
}
