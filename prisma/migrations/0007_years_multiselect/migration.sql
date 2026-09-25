-- Year dealbreaker goes multi-select: min_year (single floor) is replaced by
-- years (integer array, empty = any year). Existing floors are backfilled to
-- the equivalent set ([N..5]) so nobody's deck silently widens or narrows.
-- min_year is kept (back-compat), converted on write, never read as a filter.
ALTER TABLE "match_preferences" ADD COLUMN IF NOT EXISTS "years" INTEGER[] NOT NULL DEFAULT '{}';
UPDATE "match_preferences"
SET "years" = COALESCE(
  (SELECT array_agg(g ORDER BY g) FROM generate_series(
    GREATEST("min_year", 1),
    5
  ) AS g),
  '{}'
)
WHERE "min_year" IS NOT NULL;
