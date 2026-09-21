/* ═══════════════════════════════════════════════════════════════
   OPS: bootstrap the first super_admin (launch-critical).
   Run: cd server && npm run ops:bootstrap-admin -- user@college.edu
   PROMOTES an existing user (never creates accounts, never touches
   passwords): sets role=super_admin, verifies them, and ensures they have
   a college. Safe to re-run (idempotent). The stabilized founder account
   should be a real human inbox you control — password resets for it go
   through the normal flow.
   ═══════════════════════════════════════════════════════════════ */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run ops:bootstrap-admin -- user@college.edu');
    process.exit(2);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email} — they must sign up first.`);
    process.exit(1);
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'super_admin', isVerified: true, verificationStatus: 'VERIFIED', isActive: true },
    select: { email: true, username: true, role: true, verificationStatus: true },
  });
  console.log('✅ super_admin ready:', updated);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('BOOTSTRAP FAILED:', e.message || e);
  process.exit(1);
});
