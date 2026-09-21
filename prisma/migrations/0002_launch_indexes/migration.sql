CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "posts_type_created_at_idx" ON "posts"("type", "created_at");
CREATE INDEX IF NOT EXISTS "posts_author_id_created_at_idx" ON "posts"("author_id", "created_at");
CREATE INDEX IF NOT EXISTS "comments_post_id_created_at_idx" ON "comments"("post_id", "created_at");
CREATE INDEX IF NOT EXISTS "post_likes_post_id_idx" ON "post_likes"("post_id");
CREATE INDEX IF NOT EXISTS "match_likes_receiver_id_action_created_at_idx" ON "match_likes"("receiver_id", "action", "created_at");
CREATE INDEX IF NOT EXISTS "conversation_members_user_id_idx" ON "conversation_members"("user_id");
