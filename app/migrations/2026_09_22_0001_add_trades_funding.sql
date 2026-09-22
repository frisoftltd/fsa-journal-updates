-- v3.17.3 Part 6 -- per-trade funding cost, derived by BitfundedImportController from
-- Transaction History's Open Position / Close Position rows (see helpers.php-adjacent
-- bitfunded_parser.php::bf_attribute_funding() and CLAUDE.md v3.17.3 for the full
-- derivation and its real-data verification).
--
-- NULL, not 0, is the default and stays the value for every row this migration doesn't
-- touch: NULL means "never measured" (no Transaction History was pasted for this trade,
-- or this trade's own Open/Close Position rows weren't in what was pasted), 0 means
-- "measured, and it was genuinely zero." Collapsing that distinction is the exact mistake
-- this whole release exists to stop making -- see CLAUDE.md v3.17.3.
--
-- No backfill. Every existing trade's net_pnl was computed as pnl - fees and is correct
-- as recorded; this column and its effect on net_pnl only apply to trades imported after
-- this migration runs. challenges.funding_adjustment (the pre-existing challenge-level
-- total) is untouched by this migration and by the release that introduces this column --
-- the two are deliberately separate, non-double-counted figures.
ALTER TABLE trades
    ADD COLUMN funding DECIMAL(12,4) NULL DEFAULT NULL AFTER fees;
