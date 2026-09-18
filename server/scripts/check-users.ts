/**
 * One-off DB inspector: list all users and their roles.
 * Read-only. Run:  npx tsx scripts/check-users.ts   (from repo root)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      role: true,
      isActive: true,
      verificationStatus: true,
      college: { select: { shortName: true, name: true } },
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!users.length) {
    console.log('No users found in the database.');
    return;
  }

  console.log(`Found ${users.length} user(s):\n`);
  for (const u of users) {
    console.log(
      [
        `email:    ${u.email}`,
        `username: ${u.username}`,
        `name:     ${u.displayName}`,
        `role:     ${u.role}`,
        `active:   ${u.isActive}`,
        `verified: ${u.verificationStatus}`,
        `college:  ${u.college?.shortName || u.college?.name || '—'}`,
        `created:  ${u.createdAt.toISOString()}`,
        '',
      ].join('\n')
    );
  }

  const admins = users.filter((u) => u.role !== 'user');
  console.log(
    admins.length
      ? `⭐ Admin account(s): ${admins.map((a) => a.email).join(', ')}`
      : '⚠️  No admin/super_admin accounts exist yet.'
  );
}

main()
  .catch((e) => {
    console.error('DB check failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
