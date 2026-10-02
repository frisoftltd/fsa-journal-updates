-- v3.22.3 Part C — once a position-tool drawing's "Place trade" actually places a real
-- order, the running trade display (full-width lines + box + P&L pill, drawn from
-- open_positions/pending_orders in the session response, per this release's own
-- "mandatory: comes from server state, not the ticket" rule) becomes the one on-chart
-- representation of that trade -- the original drawing's own box has to stop rendering,
-- or the chart shows the same trade twice. linked_trade_id/linked_order_id are how
-- js/backtest-drawings.js knows which drawings to suppress: set once, in the Place Trade
-- path (js/backtest.js::btSubmitTicket() -> btLinkDrawingToOrder()), never cleared again
-- -- a drawing that produced a real trade has been superseded by that trade's own actual
-- history (the trades/backtest_pending_orders rows), not just "temporarily hidden while
-- open."
--
-- Both nullable and independent (a drawing links to AT MOST one of a trade or a pending
-- order, never both at once -- a Limit order's own linked_order_id is cleared and
-- linked_trade_id set instead once BacktestController::evaluateBar() fills it, so the
-- two are mutually exclusive over a drawing's lifetime, not simultaneously meaningful).
-- FOREIGN KEY ... ON DELETE SET NULL on both: deleting the trade/order a drawing happens
-- to be linked to must never cascade into deleting the drawing itself, which is still a
-- real, user-drawn annotation independent of whatever became of the order it placed.
--
-- Guarded-ALTER pattern (CLAUDE.md §3A step 2a) -- MySQL 8.4 has no ADD COLUMN IF NOT
-- EXISTS.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_drawings' AND COLUMN_NAME = 'linked_trade_id'
);
SET @add_col_sql = IF(@col_exists = 0,
  'ALTER TABLE backtest_drawings ADD COLUMN linked_trade_id INT NULL AFTER settings',
  'SELECT 1'
);
PREPARE add_col_stmt FROM @add_col_sql;
EXECUTE add_col_stmt;
DEALLOCATE PREPARE add_col_stmt;

SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_drawings' AND COLUMN_NAME = 'linked_order_id'
);
SET @add_col_sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE backtest_drawings ADD COLUMN linked_order_id INT UNSIGNED NULL AFTER linked_trade_id',
  'SELECT 1'
);
PREPARE add_col_stmt2 FROM @add_col_sql2;
EXECUTE add_col_stmt2;
DEALLOCATE PREPARE add_col_stmt2;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_drawings' AND CONSTRAINT_NAME = 'fk_btdraw_trade'
);
SET @add_fk_sql = IF(@fk_exists = 0,
  'ALTER TABLE backtest_drawings ADD CONSTRAINT fk_btdraw_trade FOREIGN KEY (linked_trade_id) REFERENCES trades (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE add_fk_stmt FROM @add_fk_sql;
EXECUTE add_fk_stmt;
DEALLOCATE PREPARE add_fk_stmt;

SET @fk_exists2 = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_drawings' AND CONSTRAINT_NAME = 'fk_btdraw_order'
);
SET @add_fk_sql2 = IF(@fk_exists2 = 0,
  'ALTER TABLE backtest_drawings ADD CONSTRAINT fk_btdraw_order FOREIGN KEY (linked_order_id) REFERENCES backtest_pending_orders (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE add_fk_stmt2 FROM @add_fk_sql2;
EXECUTE add_fk_stmt2;
DEALLOCATE PREPARE add_fk_stmt2;
