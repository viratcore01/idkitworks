/* Demo data: set relationshipGoal on the seeded IPEC users so intent
   matching has something to chew on. Idempotent. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const GOALS: Record<string, string> = {
  'priya@skola.app': 'RELATIONSHIP',
  'arnav@skola.app': 'DATING',
  'ishita@skola.app': 'HOOKUP',
  'rohit@skola.app': 'CASUAL',
};
async function main() {
  for (const [email, goal] of Object.entries(GOALS)) {
    const u = await prisma.user.update({ where: { email }, data: { relationshipGoal: goal } });
    console.log(`${u.username} -> ${goal}`);
  }
}
main().finally(() => prisma.$disconnect());
