-- FundedControl — v3.18.1 data repair
-- Fixes: BitfundedImportController::confirm() (pre-v3.18.1) computed a matched/new
-- trade's net_pnl as `pnl - fees - COALESCE(funding, 0)`, where `funding` is that one
-- trade's own attributed slice of the account's Funding Fee history
-- (bf_attribute_funding(), bitfunded_parser.php). In the same request, confirm() also
-- writes `challenges.funding_adjustment` to the WHOLE pasted Transaction History's
-- Funding Fee total — which structurally already includes that trade's own funding as a
-- subset. helpers.php::enrichChallenge()/challengeBalance() then subtracts
-- funding_adjustment a second time on top of a net_pnl sum that already had it baked in
-- — double-counting every row this UPDATE targets. See CLAUDE.md v3.18.1 for the full
-- diagnosis (this is the ~$1.60-per-BNBUSDT-trade gap between the app's reported balance
-- and Bitfunded's own).
--
-- Fix shipped in code (BitfundedImportController::confirm()): net_pnl is now always
-- `pnl - fees`, full stop. trades.funding is kept as a display-only, informational
-- column — it no longer feeds net_pnl, and was never read by any balance/P&L sum
-- anywhere else in this codebase. challenges.funding_adjustment is untouched by this
-- file and by the code fix — its current value is already correct (it was never the
-- broken side of this bug); only the affected trades' own net_pnl needs correcting here.
--
-- ⚠ BACK UP THE trades TABLE BEFORE RUNNING THE UPDATE BELOW.
--   mysqldump -u <user> -p theittav_journal trades > trades_backup_2026_09_24.sql
--   (DDL/DML here can't be rolled back — same standing rule as every other migration in
--   this project, see CLAUDE.md §3A.)
--
-- This is plain SQL for manual execution (no live DB credentials exist in this
-- environment to run it here) — it is NOT wired into migrate.php/version.json. Run the
-- SELECT first, eyeball the rows, then run the UPDATE. Both are idempotent: a trade
-- whose net_pnl is already `pnl - fees` will never match the WHERE clause, so this is
-- safe to re-run (e.g. after a future import affects new rows) without re-checking by
-- hand every time.

-- ── Step 1: PREVIEW — every trade whose stored net_pnl disagrees with pnl - fees by
-- more than a cent. Expect this to return exactly the trades that had a non-null
-- `funding` value written by a pre-v3.18.1 import (their diff should equal their own
-- `funding` value, to the cent). Run this first and inspect the output before Step 3.
SELECT
    id, challenge_id, pair, direction, trade_date,
    pnl, fees, funding, net_pnl,
    ROUND(pnl - fees, 4) AS correct_net_pnl,
    ROUND(net_pnl - (pnl - fees), 4) AS diff
FROM trades
WHERE ABS(net_pnl - (pnl - fees)) > 0.01
ORDER BY challenge_id, trade_date, id;

-- ── Step 2: back up the trades table now, using the mysqldump command above, if you
-- have not already.

-- ── Step 3: REPAIR — recompute net_pnl as pnl - fees for exactly the rows Step 1
-- flagged. Does not touch pnl, fees, funding, or any other column — trades.funding is
-- left in place as the display-only figure it now is. Does not touch
-- challenges.funding_adjustment (already correct — not part of this bug).
UPDATE trades
SET net_pnl = ROUND(pnl - fees, 4)
WHERE ABS(net_pnl - (pnl - fees)) > 0.01;

-- ── Step 4: VERIFY — should return zero rows.
SELECT COUNT(*) AS still_mismatched
FROM trades
WHERE ABS(net_pnl - (pnl - fees)) > 0.01;
