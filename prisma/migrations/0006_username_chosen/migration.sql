-- Username moves to "Complete Your Profile" for every signup path.
-- New accounts (email + Google) are created with a generated placeholder
-- handle and username_chosen = false; the owner picks the real handle once
-- in profile setup, which locks it for life. Profile setup counts as
-- incomplete until the flag flips, so nobody finishes onboarding on a
-- placeholder. Existing rows chose their handle in the old wizard, so they
-- are backfilled true via the column default.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username_chosen" BOOLEAN NOT NULL DEFAULT true;
