/* One-off: clear all PASS rows from the deck-testing admin so the loop chain
   starts fresh. SAFE — passes are opinions, not content. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const admin = await prisma.user.findUnique({ where: { email: 'virat@skola.app' } });
  if (!admin) throw new Error('admin not found');
  const del = await prisma.matchLike.deleteMany({ where: { senderId: admin.id, action: 'PASS' } });
  console.log(`cleared ${del.count} PASS rows for ${admin.email}`);
}
main().finally(() => prisma.$disconnect());
