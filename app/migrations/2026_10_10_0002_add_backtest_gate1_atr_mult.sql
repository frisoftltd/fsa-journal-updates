-- v3.25.0 — FSA Gate 1 indicator settings: the swing-size (ATR multiplier) actually used
-- to produce gate1_auto_state/gate1_agree on a given order, so a results breakdown can
-- never silently mix readings taken at different settings (e.g. 2.0 vs 3.0). NULL means
-- "recorded before this column existed" -- every such row was produced with the
-- then-hardcoded 2.0 multiplier, but this migration does NOT backfill that value; do not
-- assume/write 2.0 into existing rows without explicit approval (see the briefing).
--
-- Same information_schema-check + PREPARE/EXECUTE guarded-ALTER pattern as
-- 2026_10_10_0001 (CLAUDE.md §3A step 2a) -- MySQL 8.4 has no ADD COLUMN IF NOT EXISTS.
-- DECIMAL(4,2) comfortably covers the settings dialog's own 0.5-10.0 range in 0.5 steps.

SET @col_exists1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME = 'gate1_atr_mult'
);
SET @add_col_sql1 = IF(@col_exists1 = 0,
  'ALTER TABLE trades ADD COLUMN gate1_atr_mult DECIMAL(4,2) NULL AFTER gate1_agree',
  'SELECT 1'
);
PREPARE add_col_stmt1 FROM @add_col_sql1;
EXECUTE add_col_stmt1;
DEALLOCATE PREPARE add_col_stmt1;

SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_pending_orders' AND COLUMN_NAME = 'gate1_atr_mult'
);
SET @add_col_sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE backtest_pending_orders ADD COLUMN gate1_atr_mult DECIMAL(4,2) NULL AFTER gate1_agree',
  'SELECT 1'
);
PREPARE add_col_stmt2 FROM @add_col_sql2;
EXECUTE add_col_stmt2;
DEALLOCATE PREPARE add_col_stmt2;
