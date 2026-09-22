-- Case-insensitive username uniqueness.
-- Postgres UNIQUE is case-sensitive, so Virat / virat / VIRAT could coexist as
-- three accounts despite the @unique on username. The app checks usernames
-- case-insensitively on every path, and this expression index is the
-- race-proof backstop (two same-second signups can't both slip through).
-- Verified zero LOWER(username) collision groups before shipping, so creation
-- cannot fail on existing data.
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_uidx" ON "users" (LOWER("username"));
