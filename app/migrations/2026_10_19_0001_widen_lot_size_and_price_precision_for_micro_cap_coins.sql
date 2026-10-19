-- v3.27.1: Bitfunded import failed on a PEPEUSDT position with
-- SQLSTATE[22003] "Numeric value out of range: 1264 ... column 'lot_size'" --
-- confirmed cause: lot_size's current precision has too few integer digits to hold a
-- micro-cap coin's quantity (tens of billions of units at a leveraged position size),
-- not a parser or import-logic defect -- BitfundedImportController passes lot_size
-- straight through from bf_parse_num() with no rounding/truncation of its own (verified
-- against includes/bitfunded_parser.php and includes/controllers/
-- BitfundedImportController.php directly). Widened to DECIMAL(24,8): 16 integer digits
-- comfortably covers any realistic position size (tens of billions is 11 digits) with
-- 8 decimal places for a fractional lot on a normal-priced pair, matching the
-- "widen headroom generously" precedent this table's own price columns already set
-- (2026_09_18_0002).
--
-- entry_price/exit_price/stop_loss/take_profit are also widened here, from the
-- DECIMAL(20,10) that same 2026_09_18_0002 migration set, to DECIMAL(20,12) -- not
-- because this specific PEPEUSDT trade's exit price (0.0000037719, exactly 10 decimal
-- digits) overflows 10 decimals, but because the NEXT micro-cap pair easily could: a
-- price one order of magnitude smaller needs an 11th or 12th decimal place to avoid the
-- exact silent-zero/silent-rounding failure CLAUDE.md's v3.14.5 entry already documents
-- for PUMPUSDT. Same safe, data-preserving widening as before -- a value that fits in
-- (20,10) always fits exactly in (20,12); nothing here is truncated, rejected, or
-- reinterpreted.
--
-- fees/pnl/net_pnl/risk_amount are deliberately NOT touched: they're account-currency
-- (USDT) amounts, bounded by realistic account/position dollar sizes, not by a coin's
-- raw unit count or sub-cent price -- nothing about this incident suggests they're
-- undersized, and widening a column that isn't the problem is scope creep on a change
-- that otherwise has zero behavioral side effects.
--
-- No pre-flight guard needed, same reasoning as 2026_09_18_0002: widening a DECIMAL's
-- precision/scale never rejects or reinterprets a value that already fit in the
-- narrower column, so this is safe to run unconditionally and safe to re-run if retried
-- after an unrelated failure earlier in a batch.
ALTER TABLE trades
    MODIFY COLUMN lot_size    DECIMAL(24,8) NULL,
    MODIFY COLUMN entry_price DECIMAL(20,12) NULL,
    MODIFY COLUMN exit_price  DECIMAL(20,12) NULL,
    MODIFY COLUMN stop_loss   DECIMAL(20,12) NULL,
    MODIFY COLUMN take_profit DECIMAL(20,12) NULL;
