-- v3.22.1 — order ticket: leverage has to survive from order placement through to a
-- filled trade, on both paths a backtest order can take.
--
-- backtest_pending_orders.leverage: a Limit order can sit pending for many bars before
-- it fills; the leverage chosen in the ticket at PLACEMENT time has to be remembered
-- until then, exactly the same reason this table already has its own `risk_pct` column
-- separate from backtest_sessions.risk_pct (2026_09_25_0001) -- the trade that's
-- eventually created has to size/margin itself from what was actually chosen when the
-- order was placed, not whatever the session's own defaults happen to be by the time it
-- fills. NOT NULL DEFAULT 5, matching backtest_sessions.default_leverage's own default
-- and the same "a backtest order always needs a concrete leverage" reasoning from that
-- migration's own doc comment -- there's no meaningful "not set" state to protect with
-- NULL here either.
--
-- trades.leverage: NULLable, unlike the pending-orders column above -- every existing
-- row on this table (every manual/import/pre-this-release-backtest trade) genuinely has
-- no leverage concept at all, so NULL correctly means "not applicable," not "unknown."
-- Only a backtest trade filled from this release forward ever has this column set.
-- margin_used deliberately has NO new column -- trades.planned_margin (v3.17.0) is
-- reused for this, per the original v3.22.0 briefing's own "reuse existing trades
-- columns wherever they already exist" instruction (§3, unchanged by this ticket): it
-- already means exactly "the margin committed to this position," just previously only
-- ever populated by the live Auto Risk Calculator's pre-trade panel. A backtest trade
-- populating the same column with the same meaning is not a repurposing, just a second
-- writer.
--
-- Both use the information_schema-check + PREPARE/EXECUTE guarded-ALTER pattern
-- (CLAUDE.md §3A step 2a) -- MySQL 8.4 has no ADD COLUMN IF NOT EXISTS clause.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_pending_orders' AND COLUMN_NAME = 'leverage'
);
SET @add_col_sql = IF(@col_exists = 0,
  'ALTER TABLE backtest_pending_orders ADD COLUMN leverage TINYINT UNSIGNED NOT NULL DEFAULT 5 AFTER risk_pct',
  'SELECT 1'
);
PREPARE add_col_stmt FROM @add_col_sql;
EXECUTE add_col_stmt;
DEALLOCATE PREPARE add_col_stmt;

SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME = 'leverage'
);
SET @add_col_sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE trades ADD COLUMN leverage TINYINT UNSIGNED NULL AFTER backtest_rewound',
  'SELECT 1'
);
PREPARE add_col_stmt2 FROM @add_col_sql2;
EXECUTE add_col_stmt2;
DEALLOCATE PREPARE add_col_stmt2;
