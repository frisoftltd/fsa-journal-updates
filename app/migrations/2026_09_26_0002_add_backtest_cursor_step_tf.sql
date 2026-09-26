-- v3.20.11 — Adaptive replay stepping: the step size (and therefore what "the current
-- bar" even means) can now be FINER than the session's own replay_timeframe whenever the
-- user is viewing a finer display timeframe (e.g. stepping in 15m increments while
-- replaying a nominally 1H session). backtest_sessions.replay_cursor_ms keeps its
-- existing meaning unchanged (the open_time of the most recently revealed bar) -- this
-- column adds the one piece of context that was missing to interpret it correctly:
-- WHICH timeframe that bar actually came from. Without it, get_backtest_candles' own
-- no-lookahead ceiling (replay_cursor_ms + one step) has no way to know whether "one
-- step" means the session's nominal replay timeframe or whatever finer resolution the
-- last click actually used -- guessing wrong either over-reveals future data or
-- under-reveals data the user already legitimately advanced past.
--
-- Backfilled to replay_timeframe for every existing row, not a fixed literal default:
-- every session created before this feature existed could only ever have stepped at its
-- own replay_timeframe's resolution, since finer stepping didn't exist yet -- that value
-- is the objectively correct one for all of them, not an approximation. Added nullable
-- first specifically so a flat column-level DEFAULT (which would be wrong for every
-- session whose replay_timeframe isn't that one literal value) is never needed, then
-- backfilled, then locked to NOT NULL once every row has a real value.
--
-- The ADD COLUMN uses the information_schema-check + PREPARE/EXECUTE pattern (MySQL
-- 8.4-safe, not the MariaDB-only IF NOT EXISTS clause -- see CLAUDE.md v3.20.3). The
-- UPDATE and MODIFY COLUMN below don't need that treatment: UPDATE ... WHERE ... IS NULL
-- is naturally idempotent, and MODIFY COLUMN re-applying an identical definition is
-- already a safe no-op (same precedent as this file's own MODIFY COLUMN source ENUM(...)
-- in 2026_09_25_0001).

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_sessions' AND COLUMN_NAME = 'cursor_step_tf'
);
SET @add_col_sql = IF(@col_exists = 0,
  "ALTER TABLE backtest_sessions ADD COLUMN cursor_step_tf ENUM('15m','1H','4H','1D') NULL AFTER replay_cursor_ms",
  'SELECT 1'
);
PREPARE add_col_stmt FROM @add_col_sql;
EXECUTE add_col_stmt;
DEALLOCATE PREPARE add_col_stmt;

UPDATE backtest_sessions SET cursor_step_tf = replay_timeframe WHERE cursor_step_tf IS NULL;

ALTER TABLE backtest_sessions
  MODIFY COLUMN cursor_step_tf ENUM('15m','1H','4H','1D') NOT NULL;
