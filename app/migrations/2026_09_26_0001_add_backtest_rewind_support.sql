-- v3.20.10 — Backtesting: Prev Bar / rewind support.
--
-- trades.backtest_rewound marks a backtest trade that a rewind has undone. Never
-- deleted, per the briefing's own explicit requirement ("Undone trades are not silently
-- deleted... they remain in the session's trade log flagged as rewound, excluded from
-- equity and statistics") -- every trades query BacktestController uses for equity/
-- stats/simulation now adds "AND backtest_rewound=0"; the row itself survives untouched
-- for audit purposes. Only ever meaningful for source='backtest' rows (a manual/import
-- trade is never rewound), left nullable-as-zero rather than restricted to that source
-- at the schema level -- same convention as every other backtest-only column already on
-- this table (backtest_session_id), which also applies to every row regardless of
-- source and simply stays at its default for non-backtest ones.
--
-- backtest_sessions.rewind_count accumulates how many trade outcomes a rewind has ever
-- undone for that session (not how many times the button was clicked -- a step back that
-- undoes nothing doesn't increment it), so "repeatedly rewinding losing trades" is a
-- visible, auditable number rather than only inferable from the trades table directly.
--
-- Both ALTERs use the information_schema-check + PREPARE/EXECUTE pattern (CLAUDE.md
-- §3A step 2a, added after v3.20.3's MariaDB-only ADD COLUMN IF NOT EXISTS failure) --
-- MySQL 8.4 (the live database as of the 2026-09-24 Hetzner move) has no IF NOT EXISTS
-- clause for ADD COLUMN at all, and this file needs to be safely retryable like every
-- other migration in this project.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME = 'backtest_rewound'
);
SET @add_col_sql = IF(@col_exists = 0,
  'ALTER TABLE trades ADD COLUMN backtest_rewound TINYINT(1) NOT NULL DEFAULT 0 AFTER backtest_session_id',
  'SELECT 1'
);
PREPARE add_col_stmt FROM @add_col_sql;
EXECUTE add_col_stmt;
DEALLOCATE PREPARE add_col_stmt;

SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_sessions' AND COLUMN_NAME = 'rewind_count'
);
SET @add_col_sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE backtest_sessions ADD COLUMN rewind_count INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE add_col_stmt2 FROM @add_col_sql2;
EXECUTE add_col_stmt2;
DEALLOCATE PREPARE add_col_stmt2;
