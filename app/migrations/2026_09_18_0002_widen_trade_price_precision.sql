-- v3.14.5: entry_price, exit_price, stop_loss, and take_profit were DECIMAL(14,4) -- four
-- decimal places, which floors out well inside this account's real price range. Confirmed
-- live: three PUMPUSDT trades are stored with entry_price 0.0000 right now because the
-- real price is a small fraction of a cent, below what four decimal places can represent
-- at all -- not a rounding error, an outright loss of the value. This is a defect
-- independent of the Bitfunded importer; it would zero any low-priced pair's price on a
-- manual entry too, and it makes any R multiple computed from a stop-loss on such a pair
-- meaningless (risk_per_unit = ABS(entry_price - stop_loss) is garbage once entry_price
-- itself is wrongly zero).
--
-- Widened to DECIMAL(20,10): ten decimal places comfortably covers this account's full
-- observed price range (0.0044 to 71,968 -- fractional-cent tokens at one end, BTCUSDT at
-- the other) without truncation, and twenty total digits leaves headroom on the integer
-- side for any pair traded in the future.
--
-- Widening a DECIMAL's precision/scale is a safe, data-preserving change -- a value that
-- fit in (14,4) always fits exactly in (20,10); nothing is truncated, rejected, or
-- reinterpreted. No pre-flight guard needed, unlike migrations that add a constraint an
-- existing row could violate. This does NOT recover the three PUMPUSDT rows already
-- stored as 0.0000 -- that precision was lost at write time under the old column type,
-- before this migration ever runs; those rows get their real price back only when
-- Bitfunded's own data is re-imported over them (source='import', per the BitfundedImport
-- Controller matching rule in CLAUDE.md v3.14.5), not from this schema change alone.
ALTER TABLE trades
    MODIFY COLUMN entry_price DECIMAL(20,10) NULL,
    MODIFY COLUMN exit_price  DECIMAL(20,10) NULL,
    MODIFY COLUMN stop_loss   DECIMAL(20,10) NULL,
    MODIFY COLUMN take_profit DECIMAL(20,10) NULL;
