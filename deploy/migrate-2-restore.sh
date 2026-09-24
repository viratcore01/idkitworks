#!/usr/bin/env bash
# STEP 2 — Restore the dump into the VM's self-hosted Postgres, then verify.
# Run ON THE VM (dump file already scp'd to /tmp/zoclo.dump).
#
# Usage:
#   ./migrate-2-restore.sh /tmp/zoclo.dump
#
# PREREQS: Postgres 16 container up, DB `zoclo` + role `zoclo` created, app
#          .env still pointing at Supabase (cutover happens LATER).
set -euo pipefail

DUMP="${1:?Usage: migrate-2-restore.sh /tmp/zoclo.dump}"
PG_CONTAINER="${PG_CONTAINER:-zoclo-postgres}"
PG_USER="${PG_USER:-zoclo}"
PG_DB="${PG_DB:-zoclo}"

echo "→ Restoring ${DUMP} into ${PG_DB} (this streams bytea photos if present — can take a while)"
docker exec -i "${PG_CONTAINER}" pg_restore \
  -U "${PG_USER}" -d "${PG_DB}" \
  --clean --if-exists --no-owner \
  < "${DUMP}"

# pg_restore exits non-zero on ANY error, including harmless ones that happen
# when the target isn't pristine (role/string conflicts). Print them, and let
# a human eyeball that they're all "already exists"-class, before counting rows.
echo "→ (If pg_restore printed errors above, they must all be 'already exists'-class — otherwise STOP.)"

echo "→ Row counts (target):"
docker exec -i "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" \
  < "$(dirname "$0")/sql/row-count-verify.sql"

echo
echo "NOW run the same SQL against Supabase and DIFF THE OUTPUTS:"
echo "  psql \"\$DIRECT_URL\" -f deploy/sql/row-count-verify.sql"
echo "Counts must match exactly (see SQL header for the two known-safe deltas)."
echo "After counts match: proceed to staging deploy. Do NOT flip DATABASE_URL yet."
