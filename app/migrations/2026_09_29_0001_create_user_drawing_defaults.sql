-- v3.21.12 — per-user, per-tool saved drawing defaults ("Save as default" / "Reset to
-- default" on the fib retracement tool's settings panel this release; the table and
-- controller are generic by `tool` so another tool can reuse the same row shape later
-- with no further migration, per the briefing's own instruction).
--
-- One row per (user, tool) -- UNIQUE KEY enforces this, and
-- BacktestDrawingController::saveDefault()'s own
-- "INSERT ... AS new ON DUPLICATE KEY UPDATE settings = new.settings" is what "Save as
-- default" actually runs, so saving a second time for the same tool overwrites the prior
-- default in place rather than accumulating rows.
--
-- `settings` is JSON, same convention as backtest_drawings.settings, but this table only
-- ever holds a tool's settings object -- never points/geometry -- since a default is
-- "what a brand-new drawing of this tool should start with," not a drawing of its own.
-- `tool` reuses the exact ENUM literal from 2026_09_26_0003_create_backtest_drawings.sql.
--
-- Unlike backtest_drawings.user_id (no FK -- ownership there is resolved through the
-- parent session's own FK to users, per that controller's own doc comment), this table
-- has no session to resolve through -- user_id is the row's only owner, so it gets a
-- direct FK to users(id) here, same precedent as backtest_sessions.user_id.
--
-- CREATE TABLE IF NOT EXISTS only -- brand-new table, no MariaDB-only conditional-DDL
-- clause needed (CLAUDE.md §3A step 2a).
CREATE TABLE IF NOT EXISTS user_drawing_defaults (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Signed, matching users.id (confirmed int(11) signed against live theittav_journal-
  -- turned-fundedcontrol DB during the v3.18.3 errno-150 fix) -- same precedent every
  -- other user-owned backtest table already follows.
  user_id    INT NOT NULL,
  tool       ENUM('position_long','position_short','fib_retracement','trend_line','horizontal_line','horizontal_ray') NOT NULL,
  settings   JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_tool (user_id, tool),
  CONSTRAINT fk_udd_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
