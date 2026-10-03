-- v3.22.9 — Rectangle drawing tool (S/R zones and order blocks). Adds 'rectangle' to the
-- `tool` ENUM of both backtest_drawings and user_drawing_defaults (the latter so "Save as
-- default"/"Reset to default" works for this tool too, same v3.21.12 system fib already
-- uses). No new table/column -- points/settings are already generic JSON on both tables
-- (BacktestDrawingController.php's own docblock has rectangle's exact shape).
--
-- Guarded via information_schema.COLUMNS.COLUMN_TYPE (CLAUDE.md §3A step 2a) rather than
-- a plain MODIFY COLUMN -- MySQL has no "ALTER ... IF NOT EXISTS" for a column definition
-- change, and re-running a bare MODIFY on an already-migrated column is harmless but not
-- idempotent-by-default the way CREATE TABLE IF NOT EXISTS is; this guard makes a retry a
-- genuine no-op. COLUMN_TYPE LIKE '%rectangle%' is checked rather than re-deriving the
-- full enum list to compare against, since the only thing that can legitimately differ
-- between "pending" and "already applied" here is whether this one literal is present.

SET @bd_has_rect = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_drawings' AND COLUMN_NAME = 'tool'
    AND COLUMN_TYPE LIKE '%rectangle%'
);
SET @bd_sql = IF(@bd_has_rect = 0,
  "ALTER TABLE backtest_drawings MODIFY COLUMN tool ENUM('position_long','position_short','fib_retracement','trend_line','horizontal_line','horizontal_ray','rectangle') NOT NULL",
  'SELECT 1'
);
PREPARE bd_stmt FROM @bd_sql;
EXECUTE bd_stmt;
DEALLOCATE PREPARE bd_stmt;

SET @udd_has_rect = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_drawing_defaults' AND COLUMN_NAME = 'tool'
    AND COLUMN_TYPE LIKE '%rectangle%'
);
SET @udd_sql = IF(@udd_has_rect = 0,
  "ALTER TABLE user_drawing_defaults MODIFY COLUMN tool ENUM('position_long','position_short','fib_retracement','trend_line','horizontal_line','horizontal_ray','rectangle') NOT NULL",
  'SELECT 1'
);
PREPARE udd_stmt FROM @udd_sql;
EXECUTE udd_stmt;
DEALLOCATE PREPARE udd_stmt;
