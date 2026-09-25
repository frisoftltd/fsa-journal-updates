-- Backtesting Phase 1b: replay engine, challenge simulation, orders (v3.20.0).
--
-- Design note on trades.challenge_id for a backtest trade: it is left NULL, never a
-- sentinel value like 0. trades.challenge_id already carries a real FOREIGN KEY to
-- challenges(id) (added in 2026_09_17_0006) -- unlike report_cards.challenge_id, which
-- was deliberately built WITHOUT an FK specifically so it could use 0 as a sentinel.
-- challenges.id is AUTO_INCREMENT starting at 1, so a FK-constrained column can never
-- legally hold 0 for a row that isn't a real challenge -- inserting one would be
-- rejected outright. NULL is the only value that is simultaneously FK-safe (a FOREIGN
-- KEY only validates non-NULL values) and never mistakable for a real challenge id.
-- The tradeoff: this schema's pervasive "(challenge_id=? OR challenge_id IS NULL)"
-- pattern already treats a NULL challenge_id as "belongs to every challenge" (legacy
-- pre-v2.3.0 trades) -- so NULL alone does NOT protect a backtest trade from leaking
-- into a real challenge's scoped views. The actual protection is trades.source =
-- 'backtest' (below), which every existing consumer of the trades table has been
-- explicitly audited and patched to exclude -- see this release's own notes for the
-- full list of files touched. NULL is chosen for FK-legality; source='backtest' is
-- chosen for exclusion. Two different jobs, not redundant.

CREATE TABLE IF NOT EXISTS backtest_sessions (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Signed, matching users.id (confirmed int(11) signed against live theittav_journal-
  -- turned-fundedcontrol DB during the v3.18.3 errno-150 fix) -- not repeating that
  -- mistake here.
  user_id             INT NOT NULL,
  symbol              VARCHAR(20) NOT NULL COMMENT 'plain value, not FK''d -- same convention as candles.symbol/candle_sync.symbol',
  replay_timeframe    ENUM('15m','1H','4H','1D') NOT NULL,

  -- Setup, fixed for the life of the session.
  start_time          BIGINT NOT NULL COMMENT 'first replay bar''s open_time, UTC ms',
  replay_cursor_ms     BIGINT NOT NULL COMMENT 'the last bar the trader has seen -- persisted so a session can pause and resume exactly where it left off',
  risk_pct            DECIMAL(5,3) NOT NULL DEFAULT 1.000,
  fee_rate_pct        DECIMAL(6,4) NOT NULL DEFAULT 0.0550 COMMENT 'percent per fill (Bybit standard taker default); charged on both entry and exit independently',
  blind_mode          TINYINT(1) NOT NULL DEFAULT 0,

  -- Challenge simulation -- fully custom, never a foreign key to challenges(id): "the
  -- backtest never requires an existing challenge to run" (briefing). A convenience
  -- prefill just copies numbers in at creation time; nothing here points back at the
  -- source challenge afterward, and editing a real challenge later can never retroactively
  -- change an already-running or already-graded session's own rules.
  starting_balance    DECIMAL(14,2) NOT NULL,
  profit_target_pct   DECIMAL(6,3) NOT NULL,
  daily_drawdown_pct  DECIMAL(6,3) NOT NULL,
  max_drawdown_pct    DECIMAL(6,3) NOT NULL,
  drawdown_type       ENUM('static','trailing') NOT NULL DEFAULT 'static',
  max_trades_per_day  INT UNSIGNED NULL COMMENT 'NULL = not tracked, never a recorded zero (same convention as challenge_limits)',

  -- Deliberately NO stored equity/peak_equity columns. challenges.current_balance was
  -- exactly this shape once -- a stored figure incrementally bumped on every trade --
  -- and it drifted silently out of sync for five weeks before being dropped entirely in
  -- 2026_09_17_0004 in favour of always deriving it from trades (see
  -- helpers.php::enrichChallenge()/challengeBalance()). Applying that same lesson here
  -- before it has the chance to repeat: BacktestController::computeSessionState()
  -- derives both current equity (starting_balance + SUM(net_pnl) of this session's own
  -- closed trades) and peak equity (a walk-forward high-water mark over those same
  -- trades in time order) fresh on every read, from the one place that's already
  -- authoritative -- the trades table itself. fail_equity below is different in kind:
  -- a frozen historical fact recorded once at the moment a session actually failed,
  -- never recomputed afterward, same as fail_bar_time/fail_reason.

  -- No distinct 'paused' state -- "a session can be paused and resumed" (briefing) is
  -- satisfied by replay_cursor_ms alone being persisted after every advance/order
  -- action: leaving the page IS the pause, reopening the session IS the resume, with
  -- nothing server-side that needs to distinguish "actively being played right now"
  -- from "sitting idle mid-way." 'active' covers both.
  status              ENUM('active','passed','failed') NOT NULL DEFAULT 'active',
  fail_reason         VARCHAR(255) NULL,
  fail_bar_time       BIGINT NULL COMMENT 'the exact bar (open_time, UTC ms) the failing rule was breached on',
  fail_equity         DECIMAL(14,2) NULL,
  passed_at_bar_time  BIGINT NULL,
  passed_trading_days INT UNSIGNED NULL,
  passed_trade_count  INT UNSIGNED NULL,

  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_status (user_id, status),
  CONSTRAINT fk_bts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Extends the existing trades table so backtest trades write to the SAME journal
-- table live trades use, distinguished by source='backtest' + backtest_session_id --
-- per the briefing's own instruction, not a second parallel trades table. Widening an
-- ENUM (adding a value, keeping the existing ones and default) is always safe on
-- existing data; no backfill needed since every current row is already 'manual' or
-- 'import'. backtest_session_id is UNSIGNED matching backtest_sessions.id -- both sides
-- are new, under this migration's own control, so there is no legacy-table signedness
-- mismatch to worry about here (unlike trades.challenge_id's own history).
--
-- Split into three statements, each individually safe to retry (CLAUDE.md v3.12.2/
-- v3.18.3: a migration must accept every state it can legitimately leave things in, not
-- just the state before it has ever run -- DDL auto-commits per statement, so a retry
-- after a later statement in this file fails must not choke on an earlier one that
-- already succeeded). MODIFY COLUMN re-applying an identical definition is already a
-- no-op. ADD COLUMN IF NOT EXISTS is NOT used here (v3.20.3 fix) -- that clause is
-- MariaDB-only; MySQL (8.0 and 8.4 both) has no such syntax and errors on it outright
-- (ERROR 1064). This shipped against MariaDB on the old shared host and was never
-- actually exercised against MySQL until the 2026-09-24 Hetzner move, which is exactly
-- when it failed -- see CLAUDE.md's migration-authoring rules and the v3.20.3 section
-- for the general audit. The column and the FK just below it now use the same
-- information_schema-check + PREPARE/EXECUTE pattern, which works identically on both.
ALTER TABLE trades
  MODIFY COLUMN source ENUM('manual','import','backtest') NOT NULL DEFAULT 'manual';

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME = 'backtest_session_id'
);
SET @add_col_sql = IF(@col_exists = 0,
  'ALTER TABLE trades ADD COLUMN backtest_session_id INT UNSIGNED NULL AFTER source',
  'SELECT 1'
);
PREPARE add_col_stmt FROM @add_col_sql;
EXECUTE add_col_stmt;
DEALLOCATE PREPARE add_col_stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND CONSTRAINT_NAME = 'fk_trades_backtest_session'
);
SET @add_fk_sql = IF(@fk_exists = 0,
  'ALTER TABLE trades ADD CONSTRAINT fk_trades_backtest_session FOREIGN KEY (backtest_session_id) REFERENCES backtest_sessions (id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE add_fk_stmt FROM @add_fk_sql;
EXECUTE add_fk_stmt;
DEALLOCATE PREPARE add_fk_stmt;

-- A resting limit order the replay hasn't reached yet. Deliberately its own table, not
-- a 'pending' row in trades -- an order that has never filled has no execution facts
-- at all (no entry_price, no time_in), and teaching every one of trades' many existing
-- readers a new "this row might not have really happened yet" case would be a far
-- larger and riskier change than giving pending orders a home of their own, promoted
-- into trades only once they actually fill (matching the exact BitfundedImportController
-- division-of-responsibility principle already established in this codebase: a real
-- trades row means a real, already-known execution fact).
CREATE TABLE IF NOT EXISTS backtest_pending_orders (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id         INT UNSIGNED NOT NULL,
  direction          ENUM('Long','Short') NOT NULL,
  limit_price        DECIMAL(20,10) NOT NULL,
  stop_loss          DECIMAL(20,10) NOT NULL,
  take_profit        DECIMAL(20,10) NULL,
  risk_pct           DECIMAL(5,3) NOT NULL,
  placed_at_bar_time BIGINT NOT NULL,
  status             ENUM('pending','filled','cancelled') NOT NULL DEFAULT 'pending',
  -- Signed, matching trades.id (same confirmed-signed precedent as user_id above --
  -- 2026_09_21_0008_create_trade_checkins.sql's trade_id INT NOT NULL REFERENCES
  -- trades(id) is the working example this follows).
  trade_id           INT NULL COMMENT 'set once filled -- the resulting trades.id',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_session_status (session_id, status),
  CONSTRAINT fk_bpo_session FOREIGN KEY (session_id) REFERENCES backtest_sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_bpo_trade FOREIGN KEY (trade_id) REFERENCES trades (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
