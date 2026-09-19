/* Demo data: set relationshipGoals on the seeded IPEC users so intent
   matching has something to chew on. Multi-select (schema: String[]).
   Idempotent. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const GOALS: Record<string, string[]> = {
  'priya@skola.app': ['RELATIONSHIP'],
  'arnav@skola.app': ['DATING'],
  'ishita@skola.app': ['HOOKUP'],
  'rohit@skola.app': ['CASUAL'],
};
async function main() {
  for (const [email, goals] of Object.entries(GOALS)) {
    const u = await prisma.user.update({ where: { email }, data: { relationshipGoals: goals } });
    console.log(`${u.username} -> ${goals.join(', ')}`);
  }
}
main().finally(() => prisma.$disconnect());
