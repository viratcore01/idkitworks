-- Drop the avatar-color fallback: avatars are now either an uploaded photo
-- (avatarPhotoId / avatarUrl) or the initial-letter placeholder. No data
-- worth keeping — clients never sent a color worth preserving.

ALTER TABLE "users" DROP COLUMN IF EXISTS "avatar_color";
