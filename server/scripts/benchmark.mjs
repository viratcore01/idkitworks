/** Benchmark: time the hot service calls (feed, discover) against the live DB. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

// Pick a verified, active, college-assigned user with photos (deck + feed both work).
const user = await p.user.findFirst({
  where: { isActive: true, collegeId: { not: null }, verificationStatus: 'VERIFIED', photos: { some: {} } },
  select: { id: true, username: true },
});
if (!user) {
  console.log('no eligible user found');
  process.exit(0);
}
console.log(`benchmarking as ${user.username}`);

async function timeIt(label, fn, runs = 3) {
  await fn(); // warm-up (pool + query plan)
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    await fn();
    times.push(Date.now() - t);
  }
  console.log(`${label}: ${times.join(', ')} ms`);
}

// ── FEED (same shape as PostService.getFeed) ──
await timeIt('feed (20 posts)', async () => {
  const [viewer, blocks] = await Promise.all([
    p.user.findUnique({ where: { id: user.id }, select: { collegeId: true } }),
    p.block.findMany({ where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] }, select: { blockerId: true, blockedId: true } }),
  ]);
  const blockedIds = Array.from(new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== user.id)));
  return p.post.findMany({
    where: { deletedAt: null, author: { collegeId: viewer.collegeId, isActive: true }, ...(blockedIds.length && { authorId: { notIn: blockedIds } }) },
    take: 21,
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true, college: true, course: true, year: true } },
      _count: { select: { comments: { where: { deletedAt: null } }, likes: true } },
      likes: { where: { userId: user.id }, select: { userId: true } },
      saves: { where: { userId: user.id }, select: { userId: true } },
      comments: { where: { deletedAt: null, parentCommentId: null }, take: 3, orderBy: { createdAt: 'desc' }, select: { id: true, content: true, isAnonymous: true, createdAt: true, author: { select: { id: true, username: true, displayName: true, avatarUrl: true, avatarPhotoId: true } } } },
    },
  });
});

// ── DISCOVER data wave (same shape as MatchService.discover, parallel) ──
await timeIt('discover parallel wave', async () => {
  const viewer = await p.user.findUnique({ where: { id: user.id }, include: { matchPreference: true } });
  const [, viewerInterestRows, actioned, blocks, likedMeRows] = await Promise.all([
    p.userPhoto.count({ where: { userId: user.id } }),
    p.userInterest.findMany({ where: { userId: user.id }, select: { interestId: true } }),
    p.matchLike.findMany({ where: { senderId: user.id }, select: { receiverId: true, action: true, createdAt: true } }),
    p.block.findMany({ where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] }, select: { blockerId: true, blockedId: true } }),
    p.matchLike.findMany({ where: { receiverId: user.id, action: 'LIKE' }, select: { senderId: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  void viewerInterestRows; void actioned; void blocks; void likedMeRows;
  const likedIds = actioned.filter((a) => a.action === 'LIKE').map((a) => a.receiverId);
  return p.user.findMany({ where: { isActive: true, id: { notIn: [user.id, ...likedIds] }, collegeId: viewer.collegeId, photos: { some: {} } }, orderBy: { createdAt: 'desc' }, take: 20 });
});

// ── SEQUENTIAL (the OLD discover shape, for comparison) ──
await timeIt('discover OLD sequential', async () => {
  await p.userPhoto.count({ where: { userId: user.id } });
  await p.userInterest.findMany({ where: { userId: user.id }, select: { interestId: true } });
  await p.matchLike.findMany({ where: { senderId: user.id }, select: { receiverId: true, action: true, createdAt: true } });
  await p.block.findMany({ where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] }, select: { blockerId: true, blockedId: true } });
  await p.matchLike.findMany({ where: { receiverId: user.id, action: 'LIKE' }, select: { senderId: true }, orderBy: { createdAt: 'desc' } });
  const viewer = await p.user.findUnique({ where: { id: user.id }, select: { collegeId: true } });
  return p.user.findMany({ where: { isActive: true, id: { not: user.id }, collegeId: viewer.collegeId, photos: { some: {} } }, orderBy: { createdAt: 'desc' }, take: 20 });
}, 3);

await p.$disconnect();
