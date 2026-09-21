-- v3.17.0 (Auto Risk Calculator). Nullable, no default -- same convention as every other
-- pre-entry planning column on this table (balance_at_day_start, target_r, ...): NULL
-- means "no calculator output was ever attached to this trade," never a recorded zero.
--
-- Written exclusively by TradeController::saveTrade() as an ordinary pre-entry field,
-- alongside stop_loss/take_profit -- added to $cols there, not to a separate code path.
-- BitfundedImportController::confirm() never mentions this column in either of its own
-- UPDATE/INSERT statements (same as it already never touches stop_loss/take_profit), so
-- an import can never clobber whatever was planned before entry. Existing rows stay NULL
-- -- this is a going-forward field, not backfilled from anything, since nothing before
-- this release ever computed a margin figure to backfill it with.
ALTER TABLE trades
    ADD COLUMN planned_margin DECIMAL(12,2) NULL AFTER exit_quality;
