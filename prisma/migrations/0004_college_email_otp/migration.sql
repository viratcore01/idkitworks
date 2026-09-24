-- College-email OTP verification (replaces the photo-ID flow) + runtime app_settings.
-- Deployability: 0001/0002/0003 are untouched; this migration is the only delta
-- between origin/main and the OTP cutover, so `prisma migrate deploy` applies
-- cleanly on Supabase/Render instead of failing with a 0001 checksum mismatch.

-- 1. College email domain: the OTP gate enforces emailDomain === colleges.email_domain.
ALTER TABLE "colleges" ADD COLUMN IF NOT EXISTS "email_domain" TEXT;

-- 2. Runtime key/value settings (R2 cost-guard state, future feature flags).
CREATE TABLE IF NOT EXISTS "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- 3. Per-user college-email verification state (locked permanently once verified).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "college_email" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "college_email_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "college_email_verified_at" TIMESTAMP(3);

-- 4. Retire the photo-ID table: OTP replaces it end-to-end (routes, controllers,
-- services, admin queue). Users verified via the old flow keep their
-- verificationStatus; they complete OTP once to set college_email_verified.
DROP TABLE IF EXISTS "id_verifications";

-- 5. OTP codes: short-lived (10 min), single-use, attempt-counted.
CREATE TABLE IF NOT EXISTS "email_otps" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'COLLEGE_EMAIL_VERIFY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_college_email_key" ON "users"("college_email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_otps_user_id_purpose_idx" ON "email_otps"("user_id", "purpose");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_otps_expires_at_idx" ON "email_otps"("expires_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
