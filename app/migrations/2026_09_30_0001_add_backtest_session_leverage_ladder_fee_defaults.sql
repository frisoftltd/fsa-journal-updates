-- v3.22.0 — Backtest realism, part 1: session-setup schema for leverage, a per-session
-- risk ladder, and a calibrated fee default. See CLAUDE.md's v3.22.0 section for the
-- full history — the original briefing also specified funding simulation (a
-- funding_rates table, a Bybit backfill/cron, maker/taker fee split); all of that was
-- dropped from scope entirely after §0's live calibration (below) came back with a
-- single flat fee and no maker/taker distinction. This file has no funding-related
-- columns anywhere, deliberately — do not add any without a new, separate briefing.
--
-- default_leverage: the order ticket's leverage dropdown (1x/2x/3x/5x/10x/20x, shipping
-- in v3.22.1) defaults to this session-level value; the ticket itself can always
-- override it per order (leverage is never stored back to the session from an order).
-- NOT NULL DEFAULT 5 -- unlike challenges.default_leverage (nullable, "no default set"
-- is a real, meaningful state there since the live calculator's own leverage field
-- predates that column), every backtest order needs a concrete leverage to compute
-- margin/liquidation, so there's no meaningful "not set" state here to protect with
-- NULL. 5x is simply the mid-point of the six offered values, not a specially
-- significant number.
--
-- risk_ladder_json / use_flat_risk: three editable tiers stored as % OF THE SESSION'S
-- OWN starting_balance -- not absolute dollars, unlike the live risk_ladder_tiers table.
-- A backtest's starting balance is arbitrary and chosen per session, so a
-- %-of-starting-balance tier is the only representation that stays meaningful across
-- every session; this mirrors how the setup form's own "Prefill from challenge" already
-- converts an absolute challenge figure (daily_loss_limit) into a % at prefill time
-- (see js/backtest.js::onBtPrefillChange()). Kept as a JSON column, not a child table
-- like the live risk_ladder_tiers -- always exactly 3 tiers, always replaced as one
-- whole unit from the setup form, never queried or edited row-by-row the way the live
-- ladder is. Same "MySQL validates well-formedness, not shape" contract
-- backtest_drawings.settings/points already establishes -- the shape contract lives
-- with BacktestController.php / js/backtest.js, not the schema.
--
-- use_flat_risk defaults to 1 (flat) specifically so every EXISTING session -- which has
-- always used the single risk_pct column and nothing else -- keeps behaving exactly as
-- before, with zero engine change, the moment this migration runs (CLAUDE.md's own "old
-- sessions keep working, NULL-safe defaults for every new column" rule, §6 of the
-- briefing this was built from). The setup form's own default UI state for a brand-new
-- session is free to default the toggle to tiered instead -- that's an application-layer
-- choice made explicitly at createSession() time (v3.22.0), not a schema-level one.
--
-- fee_rate_pct's DEFAULT changes from Bybit's generic 0.0550 (this app's original,
-- unvalidated guess, dated back to when this column was first added) to the calibrated,
-- live-verified rate: 0.0400%, from 64 real Bitfunded fills on challenge 6
-- (source='import') where min=max=avg to four decimal places -- confirmed by hand
-- against trade 123's own recorded fee: (6.4x782.51 + 6.4x766.07) x 0.0004 = 3.964,
-- matching the recorded 3.9644. A MODIFY COLUMN default change never touches
-- already-stored values -- every existing session keeps whatever fee_rate_pct it
-- already has; only a brand-new session's own default changes.
--
-- All three ADD COLUMNs use the information_schema-check + PREPARE/EXECUTE pattern
-- (CLAUDE.md §3A step 2a) -- MySQL 8.4 has no ADD COLUMN IF NOT EXISTS clause at all.
-- The trailing MODIFY COLUMN needs no such guard -- re-applying an identical column
-- definition is already a safe no-op (same precedent as 2026_09_25_0001's `source` ENUM
-- MODIFY and 2026_09_26_0002's `cursor_step_tf` MODIFY).

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_sessions' AND COLUMN_NAME = 'default_leverage'
);
SET @add_col_sql = IF(@col_exists = 0,
  'ALTER TABLE backtest_sessions ADD COLUMN default_leverage TINYINT UNSIGNED NOT NULL DEFAULT 5 AFTER fee_rate_pct',
  'SELECT 1'
);
PREPARE add_col_stmt FROM @add_col_sql;
EXECUTE add_col_stmt;
DEALLOCATE PREPARE add_col_stmt;

SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_sessions' AND COLUMN_NAME = 'risk_ladder_json'
);
SET @add_col_sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE backtest_sessions ADD COLUMN risk_ladder_json JSON NULL AFTER default_leverage',
  'SELECT 1'
);
PREPARE add_col_stmt2 FROM @add_col_sql2;
EXECUTE add_col_stmt2;
DEALLOCATE PREPARE add_col_stmt2;

SET @col_exists3 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backtest_sessions' AND COLUMN_NAME = 'use_flat_risk'
);
SET @add_col_sql3 = IF(@col_exists3 = 0,
  'ALTER TABLE backtest_sessions ADD COLUMN use_flat_risk TINYINT(1) NOT NULL DEFAULT 1 AFTER risk_ladder_json',
  'SELECT 1'
);
PREPARE add_col_stmt3 FROM @add_col_sql3;
EXECUTE add_col_stmt3;
DEALLOCATE PREPARE add_col_stmt3;

ALTER TABLE backtest_sessions
  MODIFY COLUMN fee_rate_pct DECIMAL(6,4) NOT NULL DEFAULT 0.0400 COMMENT 'percent per fill, charged on entry and exit separately -- calibrated 2026-09-30 from 64 real Bitfunded fills on challenge 6 (source=import): flat 0.0400%, no maker/taker split, min=max=avg to 4 decimals';
