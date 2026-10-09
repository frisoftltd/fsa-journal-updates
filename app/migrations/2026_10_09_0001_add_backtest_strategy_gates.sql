-- v3.23.0 — Backtest gate checklist: an optional strategy on a backtest session, and a
-- single aggregate gates_passed flag recorded on the order/trade that resulted from the
-- pre-order checklist. NULL means "no strategy selected, or the strategy has no active
-- gate variables" (checklist not applicable) -- distinct from 0 ("trader overrode with at
-- least one gate unchecked"), same NULL-means-not-recorded convention as every other
-- nullable column in this schema (CLAUDE.md §3's "NULL means never recorded" rule).
--
-- All three ADD COLUMNs + the ADD CONSTRAINT use the information_schema-check +
-- PREPARE/EXECUTE pattern (CLAUDE.md §3A step 2a) -- MySQL 8.4 has no ADD COLUMN/ADD
-- CONSTRAINT IF NOT EXISTS clause at all. strategy_id's FK mirrors fk_trades_backtest_session
-- (2026_09_25_0001): ON DELETE SET NULL rather than CASCADE/RESTRICT -- deleting a strategy
-- should not delete or block deletion of backtest sessions/trades that merely referenced it
-- for its gate checklist (unlike trade_variables' FK RESTRICT to strategy_variables, where
-- the variable IS the recorded fact; here the strategy is just which checklist to render).

SET @col_exists1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_sessions' AND COLUMN_NAME = 'strategy_id'
);
SET @add_col_sql1 = IF(@col_exists1 = 0,
  'ALTER TABLE backtest_sessions ADD COLUMN strategy_id INT NULL AFTER max_trades_per_day',
  'SELECT 1'
);
PREPARE add_col_stmt1 FROM @add_col_sql1;
EXECUTE add_col_stmt1;
DEALLOCATE PREPARE add_col_stmt1;

SET @fk_exists1 = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_sessions' AND CONSTRAINT_NAME = 'fk_bts_strategy'
);
SET @add_fk_sql1 = IF(@fk_exists1 = 0,
  'ALTER TABLE backtest_sessions ADD CONSTRAINT fk_bts_strategy FOREIGN KEY (strategy_id) REFERENCES strategies (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE add_fk_stmt1 FROM @add_fk_sql1;
EXECUTE add_fk_stmt1;
DEALLOCATE PREPARE add_fk_stmt1;

SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_pending_orders' AND COLUMN_NAME = 'gates_passed'
);
SET @add_col_sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE backtest_pending_orders ADD COLUMN gates_passed TINYINT(1) NULL AFTER trade_id',
  'SELECT 1'
);
PREPARE add_col_stmt2 FROM @add_col_sql2;
EXECUTE add_col_stmt2;
DEALLOCATE PREPARE add_col_stmt2;

SET @col_exists3 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME = 'gates_passed'
);
SET @add_col_sql3 = IF(@col_exists3 = 0,
  'ALTER TABLE trades ADD COLUMN gates_passed TINYINT(1) NULL AFTER backtest_session_id',
  'SELECT 1'
);
PREPARE add_col_stmt3 FROM @add_col_sql3;
EXECUTE add_col_stmt3;
DEALLOCATE PREPARE add_col_stmt3;
