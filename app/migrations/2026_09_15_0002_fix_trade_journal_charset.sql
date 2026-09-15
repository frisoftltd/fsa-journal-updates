-- 2026_09_15_0001 omitted DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci on both new
-- tables, unlike every other table in this schema (and unlike 2026_09_13_0001, which got
-- it right). Without an explicit charset, CREATE TABLE fell back to the server/schema
-- default, which is latin1_swedish_ci on live -- not utf8mb4, so any non-Latin1 character
-- typed into trade_journal.note (emoji, curly quotes from a pasted note, non-English
-- text) would have been silently mangled or rejected instead of stored correctly.
--
-- Both tables are still empty, so this is a plain conversion, not a data migration --
-- there is nothing to lose or reinterpret. CONVERT TO CHARACTER SET (not just MODIFY
-- COLUMN) updates the table's own default charset as well as every existing char/varchar/
-- text/enum column on it, so a future ADD COLUMN without an explicit charset also
-- inherits utf8mb4 rather than repeating this mistake.
--
-- 2026_09_15_0001 itself is not edited -- it already ran and is checksum-locked; this is
-- the correction, not a rewrite of history.
ALTER TABLE trade_journal CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE trade_journal_actions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
