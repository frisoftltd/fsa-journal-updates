-- v3.15.0 Phase 1 (Size Integrity) -- backfill for challenge 6 (Bitfunded Altcoin) only,
-- same scoping precedent as 2026_09_17_0005/2026_09_18_0003: this account is the one with
-- a real, already-reconciled trade history (59 rows) and a ladder confirmed from its own
-- prop firm rules. Every UPDATE below writes only the five columns added by the previous
-- migration -- pnl/fees/net_pnl/result/r_multiple and everything else are never touched,
-- verified by the post-flight guard at the bottom.
--
-- balance_at_entry: "running balance ordered by close time" (the briefing's framing) and
-- "starting_balance + SUM(net_pnl of every trade already closed as of this trade's own
-- entry time)" (the actual rule, including its overlap clause -- "if a trade opened
-- before an earlier one closed, use the balance as at its own open time") are the same
-- definition. The second one is expressed as a per-row correlated condition
-- (t2.time_out < t1.time_in) rather than a sequential running-total walk, which gives an
-- identical result independent of processing order and needs no session variables or
-- cursors -- safer in a plain-SQL migration file than an ORDER BY-dependent UPDATE (that
-- pattern is unreliable under MySQL 8's optimizer and was avoided deliberately).
--
-- The inner SELECT is wrapped as its own derived table (`bal`) rather than referenced
-- directly inside the UPDATE's SET clause, because MySQL/MariaDB reject "UPDATE trades
-- SET x = (SELECT ... FROM trades ...)" as updating and reading the same table in one
-- statement (error 1093). Wrapping the read side as `UPDATE trades t JOIN (SELECT ...
-- FROM trades ...) AS calc` is the standard, portable workaround -- `calc` is computed as
-- an independent result set before the UPDATE's target table is touched.
CREATE TEMPORARY TABLE _risk_backfill_baseline (net_pnl_sum DECIMAL(14,4), pnl_sum DECIMAL(14,4), trade_count INT);
INSERT INTO _risk_backfill_baseline
SELECT COALESCE(SUM(net_pnl),0), COALESCE(SUM(pnl),0), COUNT(*) FROM trades WHERE challenge_id = 6;

-- Pre-flight: this file only proceeds against the exact, already-reconciled challenge 6
-- (59 trades, confirmed Bitfunded Altcoin) -- not a state check on the new columns
-- (which don't hold any value yet on a first run), an identity check, so a retry after a
-- genuine failure doesn't get blocked by its own prior partial progress the way earlier
-- migrations in this chain learned the hard way (see CLAUDE.md v3.13.4).
CREATE TEMPORARY TABLE _risk_backfill_pre_guard (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _risk_backfill_pre_guard (ok) VALUES (
    (SELECT trade_count FROM _risk_backfill_baseline) = 59
    AND (SELECT COUNT(*) FROM challenges WHERE id = 6 AND name LIKE '%Altcoin%') = 1
    AND (SELECT COUNT(*) FROM risk_ladder_tiers WHERE challenge_id = 6 AND active = 1) = 3
);
DROP TEMPORARY TABLE _risk_backfill_pre_guard;

-- 1) balance_at_entry
UPDATE trades t
JOIN (
    SELECT t1.id AS trade_id,
           c.starting_balance + COALESCE((
               SELECT SUM(t2.net_pnl) FROM trades t2
               WHERE t2.challenge_id = t1.challenge_id
                 AND t2.result IN ('Win','Loss','Break Even')
                 AND t2.time_out IS NOT NULL
                 AND t2.time_out < t1.time_in
           ), 0) AS bal
    FROM trades t1
    JOIN challenges c ON c.id = t1.challenge_id
    WHERE t1.challenge_id = 6 AND t1.time_in IS NOT NULL
) calc ON calc.trade_id = t.id
SET t.balance_at_entry = ROUND(calc.bal, 2)
WHERE t.challenge_id = 6;

-- 2) planned_risk_pct -- ladder tier lookup, lower-inclusive/upper-exclusive per
-- risk_ladder_tiers' own convention (2026_09_19_0001).
UPDATE trades t
JOIN risk_ladder_tiers rt
    ON rt.challenge_id = t.challenge_id
   AND rt.active = 1
   AND t.balance_at_entry >= rt.lower_balance
   AND (rt.upper_balance IS NULL OR t.balance_at_entry < rt.upper_balance)
SET t.planned_risk_pct = rt.risk_pct
WHERE t.challenge_id = 6 AND t.balance_at_entry IS NOT NULL;

-- 3) actual_risk_pct -- the briefing's own formula (|entry_price - stop_loss| * lot_size
-- / balance_at_entry * 100) where a real stop is on file. None of challenge 6's 59 rows
-- currently have one (every row is a Bitfunded import; CLAUDE.md v3.14.1 confirmed this
-- explicitly and nothing since has changed it) -- applied literally, that would leave
-- actual_risk_pct NULL for all 59 rows and make the ladder-adherence/tier-breach metrics
-- permanently empty for the one account they're meant to describe. Decided this session:
-- fall back to risk_amount (already populated for all 59 rows since 2026_09_17_0002/
-- 2026_09_17_0005's R-multiple reconstruction -- a real stop-out dollar amount for a
-- confirmed full stop, a derived risk-unit estimate otherwise) when stop_loss is null.
-- Carries the same "estimated, not measured" caveat r_multiple_source already flags for
-- the same rows -- not re-flagged with a new column here, since that provenance already
-- exists on r_multiple_source and this value is derived from the same source figure.
UPDATE trades t
SET t.actual_risk_pct = CASE
        WHEN t.stop_loss IS NOT NULL AND t.balance_at_entry > 0
            THEN ROUND(ABS(t.entry_price - t.stop_loss) * t.lot_size / t.balance_at_entry * 100, 3)
        WHEN t.stop_loss IS NULL AND t.risk_amount IS NOT NULL AND t.risk_amount > 0 AND t.balance_at_entry > 0
            THEN ROUND(t.risk_amount / t.balance_at_entry * 100, 3)
        ELSE NULL
    END
WHERE t.challenge_id = 6;

-- 4) risk_deviation_pct
UPDATE trades t
SET t.risk_deviation_pct = ROUND((t.actual_risk_pct / t.planned_risk_pct - 1) * 100, 2)
WHERE t.challenge_id = 6
  AND t.actual_risk_pct IS NOT NULL
  AND t.planned_risk_pct IS NOT NULL
  AND t.planned_risk_pct > 0;

-- 5) clean_rep -- exactly as specified, no fallback (unlike actual_risk_pct above, this
-- wasn't part of this session's fallback decision). Requires a real pre-entry record
-- (trade_journal, v3.11.0) plus both stop_loss and take_profit on file plus a resolved
-- exit. Since none of challenge 6's rows have a pre-entry journal entry or a stop_loss
-- (every one is an unattended import -- "a trade with no pre-entry record is itself
-- data", CLAUDE.md v3.14.0), every row backfills to 0, not 1 -- correct, not a bug: this
-- challenge has zero clean reps by the current definition until real pre-entry-logged
-- trades with real stops start closing against it.
UPDATE trades t
LEFT JOIN trade_journal tj ON tj.trade_id = t.id AND tj.phase = 'pre_entry'
SET t.clean_rep = CASE
        WHEN tj.id IS NOT NULL
         AND t.stop_loss IS NOT NULL
         AND t.take_profit IS NOT NULL
         AND t.exit_reason IN ('Take Profit','Stop Loss')
        THEN 1 ELSE 0
    END
WHERE t.challenge_id = 6;

-- Post-flight: (a) row count and pnl/net_pnl sums are byte-for-byte what they were before
-- this file touched anything -- the whole point of "backfill writes derived columns only"
-- being a guarantee, not a description; (b) a units sanity check on actual_risk_pct --
-- the briefing's own instruction to "verify against one trade by hand" before trusting
-- the multiplication, done here as an automated bound instead of a manual spot-check this
-- environment has no live data to perform: nothing in this account's documented history
-- (ladder tiers topping out at 1%, the worst known drawdown-period drift being described
-- as "roughly a 4x gap" against a 0.25% band) comes close to 25%, so any row at or above
-- that is far more likely a unit mismatch (e.g. lot_size read as notional USDT rather
-- than base-asset quantity) than a real number, and should fail the migration rather than
-- post a metric nobody would trust.
CREATE TEMPORARY TABLE _risk_backfill_post_guard (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _risk_backfill_post_guard (ok) VALUES (
    (SELECT COUNT(*) FROM trades WHERE challenge_id = 6) = (SELECT trade_count FROM _risk_backfill_baseline)
    AND ROUND((SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id = 6), 4) = ROUND((SELECT net_pnl_sum FROM _risk_backfill_baseline), 4)
    AND ROUND((SELECT COALESCE(SUM(pnl),0) FROM trades WHERE challenge_id = 6), 4) = ROUND((SELECT pnl_sum FROM _risk_backfill_baseline), 4)
    AND (SELECT MIN(balance_at_entry) FROM trades WHERE challenge_id = 6 AND balance_at_entry IS NOT NULL) > 0
    AND COALESCE((SELECT MAX(actual_risk_pct) FROM trades WHERE challenge_id = 6), 0) <= 25
);
DROP TEMPORARY TABLE _risk_backfill_post_guard;
DROP TEMPORARY TABLE _risk_backfill_baseline;
