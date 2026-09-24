#!/usr/bin/env bash
# STEP 1 — Dump Zoclo's public schema from Supabase.
# Run from ANY machine with pg_dump ≥ 14 and network access to Supabase.
#
# Usage:
#   DIRECT_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' ./migrate-1-dump.sh
#
# IMPORTANT:
# - Use the DIRECT (db.<ref>.supabase.co) host, NOT the pooler host — the
#   pooler can't run pg_dump's catalog sessions reliably.
# - --schema=public only: Supabase's auth/storage/realtime schemas are
#   Supabase-internal and must NOT land on your VM.
# - No CREATE EXTENSION needed on the target: verified all 3 migrations use
#   Prisma-generated UUIDs client-side; no pgcrypto/uuid-ossp references.
set -euo pipefail

: "${DIRECT_URL:?Set DIRECT_URL to the Supabase DIRECT connection string}"
OUT="${1:-zoclo.dump}"

echo "→ Dumping public schema from Supabase → ${OUT}"
pg_dump "${DIRECT_URL}" \
  --format=custom \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file "${OUT}"

echo "→ Archive contents (sanity: should list ~21 tables + _prisma_migrations):"
pg_restore --list "${OUT}" | grep -E 'TABLE|SEQUENCE' | head -40 || true
echo "✅ Dump written: ${OUT}"
echo "Next: scp ${OUT} ubuntu@<vm>:/tmp/ && run migrate-2-restore.sh on the VM."
