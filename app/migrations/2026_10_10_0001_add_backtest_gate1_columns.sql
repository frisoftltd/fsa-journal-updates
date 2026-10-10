-- v3.24.0 — FSA Gate 1 structure indicator: the engine's own reading (gate1_auto_state,
-- -2..2, mirroring structure-gate1.js's `state`) and whether the trader's own checklist
-- answer for the dedicated Gate 1 row matched it (gate1_agree, 1/0). Recorded, never
-- enforced -- the indicator's manual validation isn't finished yet (see the briefing's
-- own §7). NULL semantics mirror gates_passed exactly (2026_10_09_0001):
-- gate1_auto_state is NULL only if the client never ran the engine at all (an older,
-- unpatched client); gate1_agree is NULL whenever no checklist opened to capture a
-- trader answer to compare against (no strategy_id, or a strategy with no active gate
-- variables) -- same "NULL means never recorded" convention as every other nullable
-- column in this schema.
--
-- All four ADD COLUMNs use the information_schema-check + PREPARE/EXECUTE pattern
-- (CLAUDE.md §3A step 2a) -- MySQL 8.4 has no ADD COLUMN IF NOT EXISTS clause at all.

SET @col_exists1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME = 'gate1_auto_state'
);
SET @add_col_sql1 = IF(@col_exists1 = 0,
  'ALTER TABLE trades ADD COLUMN gate1_auto_state TINYINT NULL AFTER gates_passed',
  'SELECT 1'
);
PREPARE add_col_stmt1 FROM @add_col_sql1;
EXECUTE add_col_stmt1;
DEALLOCATE PREPARE add_col_stmt1;

SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME = 'gate1_agree'
);
SET @add_col_sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE trades ADD COLUMN gate1_agree TINYINT(1) NULL AFTER gate1_auto_state',
  'SELECT 1'
);
PREPARE add_col_stmt2 FROM @add_col_sql2;
EXECUTE add_col_stmt2;
DEALLOCATE PREPARE add_col_stmt2;

SET @col_exists3 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_pending_orders' AND COLUMN_NAME = 'gate1_auto_state'
);
SET @add_col_sql3 = IF(@col_exists3 = 0,
  'ALTER TABLE backtest_pending_orders ADD COLUMN gate1_auto_state TINYINT NULL AFTER gates_passed',
  'SELECT 1'
);
PREPARE add_col_stmt3 FROM @add_col_sql3;
EXECUTE add_col_stmt3;
DEALLOCATE PREPARE add_col_stmt3;

SET @col_exists4 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_pending_orders' AND COLUMN_NAME = 'gate1_agree'
);
SET @add_col_sql4 = IF(@col_exists4 = 0,
  'ALTER TABLE backtest_pending_orders ADD COLUMN gate1_agree TINYINT(1) NULL AFTER gate1_auto_state',
  'SELECT 1'
);
PREPARE add_col_stmt4 FROM @add_col_sql4;
EXECUTE add_col_stmt4;
DEALLOCATE PREPARE add_col_stmt4;
