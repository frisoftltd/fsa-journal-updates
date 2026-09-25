-- v3.20.1 — adds the required "Session name" field from the reworked setup screen
-- (e.g. "FSA 1H BTC 10k test"). A new migration, not an edit to
-- 2026_09_25_0001_create_backtest_tables.sql -- that file already shipped in the
-- tagged v3.20.0 release, and per this project's own standing rule (CLAUDE.md
-- v3.12.2: an applied migration is checksum-locked, only a confirmed-failed/never-run
-- one is safe to edit), there's no way to know from here whether it's already been
-- applied on live. Treating it as immutable and adding this column separately is the
-- same pattern every other post-release schema correction in this project has used.
--
-- NOT NULL DEFAULT '' rather than a hard NOT NULL with no default: "required" is
-- enforced at the application layer (BacktestController::createSession() rejects a
-- blank name), the same way every other required-but-free-text field in this schema
-- works (e.g. challenges.name). A DB-level empty-string default just means this ADD
-- COLUMN works unconditionally whether or not any backtest_sessions rows already exist,
-- without forcing a value for rows that predate this migration.
ALTER TABLE backtest_sessions
  ADD COLUMN IF NOT EXISTS session_name VARCHAR(120) NOT NULL DEFAULT '' AFTER user_id;
