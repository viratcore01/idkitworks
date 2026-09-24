-- Row-count verification: run against BOTH the Supabase source and the VM
-- target, then diff the outputs line by line. Counts must match exactly
-- (except known-safe deltas, see bottom).
--
-- Supabase (source):  psql "<DIRECT_URL>" -f row-count-verify.sql
-- VM (target):        docker exec -i zoclo-postgres psql -U zoclo -d zoclo < row-count-verify.sql

SELECT 'users'            AS tbl, count(*) FROM users
UNION ALL SELECT 'colleges',          count(*) FROM colleges
UNION ALL SELECT 'posts',             count(*) FROM posts
UNION ALL SELECT 'comments',          count(*) FROM comments
UNION ALL SELECT 'post_likes',        count(*) FROM post_likes
UNION ALL SELECT 'saved_posts',       count(*) FROM saved_posts
UNION ALL SELECT 'user_photos',       count(*) FROM user_photos
UNION ALL SELECT 'match_likes',       count(*) FROM match_likes
UNION ALL SELECT 'matches',           count(*) FROM matches
UNION ALL SELECT 'match_preferences', count(*) FROM match_preferences
UNION ALL SELECT 'conversations',     count(*) FROM conversations
UNION ALL SELECT 'conversation_members', count(*) FROM conversation_members
UNION ALL SELECT 'messages',          count(*) FROM messages
UNION ALL SELECT 'notifications',     count(*) FROM notifications
UNION ALL SELECT 'reports',           count(*) FROM reports
UNION ALL SELECT 'blocks',            count(*) FROM blocks
UNION ALL SELECT 'interests',         count(*) FROM interests
UNION ALL SELECT 'user_interests',    count(*) FROM user_interests
UNION ALL SELECT 'refresh_tokens',    count(*) FROM refresh_tokens
UNION ALL SELECT 'id_verifications',  count(*) FROM id_verifications
UNION ALL SELECT 'moderation_logs',   count(*) FROM moderation_logs
ORDER BY tbl;

-- Storage-split sanity (target must match source):
--   rows with storagePath (served from R2) vs rows with legacy bytes:
SELECT 'photos:storage-backed' AS chk, count(*) FROM user_photos WHERE storage_path IS NOT NULL
UNION ALL SELECT 'photos:legacy-bytes', count(*) FROM user_photos WHERE storage_path IS NULL;

-- KNOWN-SAFE DELTAS (document, don't chase):
-- refresh_tokens: rows expired between dump and restore differ — sessions
--   re-login anyway; if the delta is large, investigate.
-- _prisma_migrations: comes over in the dump; boot-time `prisma migrate deploy`
--   should report no pending migrations (verify in PM2 logs).
