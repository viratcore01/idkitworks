/** One-off: add the hot-path posts feed index (userPhotos index already exists in schema). */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
await p.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS posts_feed_idx ON posts (author_id, created_at DESC)');
await p.$executeRawUnsafe('DROP INDEX IF EXISTS user_photos_user_slot_idx'); // duplicate of schema's user_id,slot index
const idx = await p.$queryRawUnsafe(
  "SELECT indexname FROM pg_indexes WHERE tablename IN ('posts','user_photos') ORDER BY tablename, indexname",
);
console.log(idx.map((r) => r.indexname).join('\n'));
await p.$disconnect();
