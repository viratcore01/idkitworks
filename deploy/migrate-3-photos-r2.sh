#!/usr/bin/env bash
# STEP 3 — Sync photo objects Supabase Storage → Cloudflare R2.
# Keys are PRESERVED (<userId>/<photoId>), so NO bulk UPDATE of user_photos is
# needed — the DB stores relative storage paths and serving signs per-request
# (verified: photo.controller.getPhoto + config/storage.ts).
#
# One-time rclone setup (run interactively first):
#
#   rclone config  # then:
#   n) name: supabase-remote
#      type: s3
#      provider: Other
#      access_key_id / secret: Supabase Storage S3 gateway keys
#        (Supabase → Storage → Settings → S3 access keys)
#      endpoint: https://<ref>.supabase.co/storage/v1/s3
#      region: ap-south-1 (or your project's region)
#   n) name: r2-remote
#      type: s3
#      provider: Cloudflare
#      access_key_id / secret: R2 API token (R2 → Manage API tokens)
#      endpoint: https://<account-id>.r2.cloudflarestorage.com
#      region: auto
#
# Usage:
#   BUCKET=user-photos ./migrate-3-photos-r2.sh            # real sync
#   BUCKET=user-photos DRY_RUN=1 ./migrate-3-photos-r2.sh  # preview
set -euo pipefail

: "${BUCKET:?Set BUCKET to the storage bucket name (e.g. user-photos)}"

SRC="supabase-remote:${BUCKET}"
DST="r2-remote:${BUCKET}"

echo "→ Object count (source):"
rclone lsf "${SRC}" --recursive --files-only --format p | tail -1 || true
rclone size "${SRC}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "→ DRY RUN — no writes. Removing flag when output looks right."
  rclone sync --dry-run --checksum "${SRC}" "${DST}"
else
  echo "→ Syncing (checksum-verified, resumable, safe to re-run):"
  rclone sync --checksum --progress "${SRC}" "${DST}"
fi

echo
echo "✅ Objects synced. Verification checklist (do these on STAGING before cutover):"
echo "  [ ] avatar renders from R2 (302 → signed R2 URL, 200 on the object)"
echo "  [ ] photo carousel renders for all 4 slots"
echo "  [ ] ID-verification upload works and admin queue shows the image"
echo "  [ ] signed-URL expiry: sign one, wait/force past PHOTO_URL_TTL_SEC,"
echo "      confirm the OLD URL 403s and a refresh gets a NEW signed URL"
echo "  [ ] STORAGE_DRIVER=r2 is set in the app env BEFORE testing (boot log"
echo "      must print [storage] driver=r2)"
echo
echo "Rollback: app env without STORAGE_DRIVER/R2_* vars → driver falls back to"
echo "supabase (objects still there until you close the project — keep it 7 days)."
