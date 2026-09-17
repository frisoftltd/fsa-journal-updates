-- Marks which rows in `trades` are hand-entered vs imported from a broker's own trade
-- history, and whether each row's r_multiple is a real recorded figure or a
-- reconstructed estimate. Driven by the Bitfunded Altcoin backfill
-- (2026_09_17_0002_import_bitfunded_altcoin_trades.sql): imported rows have no
-- stop-loss price on file, so their R is derived from observed full-size losses rather
-- than a recorded stop distance. Any statistic that presents R as fact needs to be able to
-- tell the difference between the two.
--
-- source has a DEFAULT so every existing row (and every future manual save, which never
-- sets this column — see TradeController::saveTrade) is implicitly 'manual' with no
-- backfill needed. r_multiple_source has no default and stays NULL for manual rows —
-- NULL means "provenance not tracked" (the pre-v3.12.0 norm), distinct from either
-- enum value.
--
-- Explicit utf8mb4/utf8mb4_general_ci per the CLAUDE.md migration checklist (added
-- v3.11.1 after 2026_09_15_0001 shipped two tables on the wrong charset by omitting
-- this) — ENUM column values are still strings and inherit the table's charset if left
-- unspecified, so state it here rather than trust what `trades` itself was created with.
ALTER TABLE trades
    ADD COLUMN source ENUM('manual','import') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'manual' AFTER r_multiple,
    ADD COLUMN r_multiple_source ENUM('recorded','estimated') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL AFTER source;
