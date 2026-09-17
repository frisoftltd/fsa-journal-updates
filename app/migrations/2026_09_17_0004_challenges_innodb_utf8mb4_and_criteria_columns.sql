-- challenges has been MyISAM/latin1 since before this schema had a migration history —
-- the only table left on the old engine, and the reason trades.challenge_id has never
-- had a foreign key (MyISAM doesn't support them; InnoDB tables can't reference a MyISAM
-- parent either). Converts it to InnoDB/utf8mb4 so a real FK can follow in a later file
-- (2026_09_17_0006 — kept separate and last in this batch so an unexpected orphaned
-- challenge_id doesn't block the engine/charset conversion or the data fixes below, which
-- don't depend on the FK existing).
--
-- Engine and charset are converted as two separate statements rather than one combined
-- ALTER, matching this codebase's preference for small, individually-diagnosable DDL
-- steps (see CLAUDE.md §3A) over one statement that could fail for either reason with a
-- single ambiguous error.
ALTER TABLE challenges ENGINE=InnoDB;
ALTER TABLE challenges CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- v3.13.0: challenges.current_balance was a stored column nothing ever recalculated —
-- see CLAUDE.md for the incident this produced (a $626 dashboard error and a drawdown
-- reading 0.0% against a real ~2.6%). It is dropped, not kept-and-rewritten: every call
-- site that used to read it now derives balance on the fly as
-- `starting_balance + SUM(net_pnl for closed trades) - funding_adjustment`
-- (see includes/helpers.php::enrichChallenge()), so there is no longer a column for
-- anything to silently drift out of sync with.
--
-- funding_adjustment: costs that are real (this account's -6.6369 net funding, see
-- 2026_09_17_0005) but not attributable to a single trade — a challenge-level line item,
-- not a per-row one.
--
-- profit_target_amt / max_loss_amt: some prop firms (Bitfunded among them) state challenge
-- criteria as currency amounts per stage, not percentages. The existing profit_target_pct /
-- max_drawdown_pct columns are NOT removed — they remain the only source of truth for
-- prop firms that genuinely state criteria as percentages — but wherever an amount is on
-- file it now takes precedence (see includes/helpers.php::enrichChallenge()).
-- (funding_adjustment/profit_target_amt/max_loss_amt are all numeric — CHARACTER SET/
-- COLLATE only apply to string columns, so the utf8mb4 checklist item above is satisfied
-- by the table-level CONVERT TO CHARACTER SET, not by anything on these column defs.)
ALTER TABLE challenges
    DROP COLUMN current_balance,
    ADD COLUMN funding_adjustment DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    ADD COLUMN profit_target_amt DECIMAL(12,2) NULL,
    ADD COLUMN max_loss_amt DECIMAL(12,2) NULL;
