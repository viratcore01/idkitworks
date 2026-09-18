import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@test.zoclo' } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) { console.log('nothing to clean'); return; }
  await prisma.notification.deleteMany({ where: { OR: [{ recipientId: { in: ids } }, { actorId: { in: ids } }] } });
  await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { conversation: { members: { some: { userId: { in: ids } } } } }] } });
  await prisma.conversation.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
  await prisma.match.deleteMany({ where: { OR: [{ userA: { in: ids } }, { userB: { in: ids } }] } });
  await prisma.matchLike.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } });
  await prisma.matchPreference.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userPhoto.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`removed ${del.count} leftover test users`);
}
main().finally(() => prisma.$disconnect());
