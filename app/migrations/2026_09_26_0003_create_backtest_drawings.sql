-- v3.21.0 — Backtesting drawing tools (position tool, fib retracement, trend line,
-- horizontal line/ray). One row per drawing, scoped to the session it was drawn on
-- (backtest_sessions.symbol is fixed per session, so scoping by session_id alone already
-- scopes by symbol too -- a separate symbol column would just be a copy of something
-- session_id already implies, with its own chance to drift out of sync).
--
-- points/settings are JSON rather than a fixed column per tool type: the four tools have
-- genuinely different shapes (a position tool needs a time span + three price levels and
-- an R:R lock state; a horizontal line needs one price and no time span at all; a fib
-- needs two anchors plus a configurable level list) and forcing them into one fixed set
-- of columns would mean most columns are NULL for most rows, with no real type safety
-- gained over JSON anyway (MySQL doesn't validate JSON *shape*, only that it's valid
-- JSON). See BacktestDrawingController.php's own docblock for exactly what each tool
-- stores in each column.
--
-- ON DELETE CASCADE on session_id matches every other backtest-owned table
-- (backtest_pending_orders, and trades.backtest_session_id) -- deleting a session
-- already removes everything that belongs only to it, drawings included.

CREATE TABLE IF NOT EXISTS backtest_drawings (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Signed, matching users.id (confirmed int(11) signed against live theittav_journal-
  -- turned-fundedcontrol DB during the v3.18.3 errno-150 fix) -- not repeating that
  -- mistake here, same precedent every other backtest table already follows.
  user_id     INT NOT NULL,
  session_id  INT UNSIGNED NOT NULL,
  tool        ENUM('position_long','position_short','fib_retracement','trend_line','horizontal_line','horizontal_ray') NOT NULL,
  points      JSON NOT NULL COMMENT 'array of {time, price?} anchor points -- shape and count depend on tool, see BacktestDrawingController.php',
  settings    JSON NOT NULL COMMENT 'colour/width/style plus tool-specific options (fib level list, R:R lock state, extend flags, ...)',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_session (session_id),
  CONSTRAINT fk_btdraw_session FOREIGN KEY (session_id) REFERENCES backtest_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
