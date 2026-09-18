-- v3.14.0: the Bitfunded paste importer captures Position History's exit-reason label
-- (Stop Loss / Manual Closing / and possibly others — Bitfunded's own set is not
-- enumerated anywhere the app can read, so it is stored as given rather than mapped to
-- an ENUM). This is what lets the Statistics page break down realised payoff by how a
-- position actually ended, rather than treating every close the same way — see the
-- exit_reason breakdown on the Statistics page (StatsController::getStats()) and
-- CLAUDE.md v3.14.0 for why that breakdown matters for this account specifically (a
-- realised payoff of 1.49 against an FSA rule minimum of 1:3 could mean targets set too
-- close, or positions closed early — the exit_reason split is what starts to answer
-- which).
--
-- Explicit utf8mb4/utf8mb4_general_ci per the CLAUDE.md checklist (added v3.11.1 after
-- 2026_09_15_0001 shipped two tables on the wrong charset by omitting this).
ALTER TABLE trades
    ADD COLUMN exit_reason VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL AFTER result;
