-- v3.16.0 Phase 2 -- target_r, balance_at_day_start, exit_quality for challenge 6's 59
-- trades. Same scoping precedent as every migration in this account's history
-- (v3.13.0, 2026_09_19_0003): challenge 6 only, other challenges get the columns but stay
-- NULL until they get the same treatment.
CREATE TEMPORARY TABLE _phase2_baseline (net_pnl_sum DECIMAL(14,4), pnl_sum DECIMAL(14,4), trade_count INT);
INSERT INTO _phase2_baseline
SELECT COALESCE(SUM(net_pnl),0), COALESCE(SUM(pnl),0), COUNT(*) FROM trades WHERE challenge_id = 6;

CREATE TEMPORARY TABLE _phase2_pre_guard (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _phase2_pre_guard (ok) VALUES (
    (SELECT trade_count FROM _phase2_baseline) = 59
    AND (SELECT COUNT(*) FROM challenges WHERE id = 6 AND name LIKE '%Altcoin%') = 1
);
DROP TEMPORARY TABLE _phase2_pre_guard;

-- 1) target_r -- signed for direction: (take_profit - entry_price) / (entry_price -
-- stop_loss) is correct for both Long and Short without a direction branch (worked
-- through by hand for both cases before writing this): a Long has target above entry and
-- stop below (positive / positive); a Short has target below entry and stop above
-- (negative / negative) -- both land on the same positive R:R sign. A trade whose
-- stop/target sit on the wrong side of entry for its stated direction (the "direction-
-- blind risk geometry" defect flagged in CLAUDE.md's spec-gap audit) produces a negative
-- target_r instead of being silently masked by ABS() -- that's a feature of using the
-- signed formula, not a bug to guard against.
UPDATE trades
SET target_r = ROUND((take_profit - entry_price) / (entry_price - stop_loss), 2)
WHERE challenge_id = 6
  AND entry_price IS NOT NULL AND stop_loss IS NOT NULL AND take_profit IS NOT NULL
  AND entry_price <> stop_loss;

-- 2) balance_at_day_start -- the running balance before the FIRST trade of each
-- trade_date, identical for every trade sharing that date (deliberately keyed on
-- trade_date < trade_date, not time_in < time_in -- this is a coarser, date-level basis
-- than balance_at_entry's exact-time basis, which is the whole point: it removes the
-- mid-session tier flip that balance_at_entry produces when a prior same-day trade's
-- outcome crosses a ladder boundary).
UPDATE trades t
JOIN (
    SELECT t1.id AS trade_id,
           c.starting_balance + COALESCE((
               SELECT SUM(t2.net_pnl) FROM trades t2
               WHERE t2.challenge_id = t1.challenge_id
                 AND t2.result IN ('Win','Loss','Break Even')
                 AND t2.trade_date < t1.trade_date
           ), 0) AS bal
    FROM trades t1
    JOIN challenges c ON c.id = t1.challenge_id
    WHERE t1.challenge_id = 6
) calc ON calc.trade_id = t.id
SET t.balance_at_day_start = ROUND(calc.bal, 2)
WHERE t.challenge_id = 6;

-- 3) exit_quality -- manual_close checked first regardless of target_r's nullness (a
-- manual close is its own category whether or not a target happens to be on file); then
-- unknown for every remaining row with no target_r; then the four TP/SL x valid/short
-- combinations. 2.5 is the exact threshold given, not the 3:1 gate figure quoted in
-- prose alongside it -- the condition table is what's authoritative here.
UPDATE trades
SET exit_quality = CASE
        WHEN exit_reason = 'Manual Closing' THEN 'manual_close'
        WHEN target_r IS NULL THEN 'unknown'
        WHEN exit_reason = 'Take Profit' AND target_r >= 2.5 THEN 'target_hit_valid'
        WHEN exit_reason = 'Take Profit' AND target_r <  2.5 THEN 'target_hit_short'
        WHEN exit_reason = 'Stop Loss'   AND target_r >= 2.5 THEN 'stopped_valid'
        WHEN exit_reason = 'Stop Loss'   AND target_r <  2.5 THEN 'stopped_short'
        ELSE 'unknown'
    END
WHERE challenge_id = 6;

CREATE TEMPORARY TABLE _phase2_post_guard (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _phase2_post_guard (ok) VALUES (
    (SELECT COUNT(*) FROM trades WHERE challenge_id = 6) = (SELECT trade_count FROM _phase2_baseline)
    AND ROUND((SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id = 6), 4) = ROUND((SELECT net_pnl_sum FROM _phase2_baseline), 4)
    AND ROUND((SELECT COALESCE(SUM(pnl),0) FROM trades WHERE challenge_id = 6), 4) = ROUND((SELECT pnl_sum FROM _phase2_baseline), 4)
);
DROP TEMPORARY TABLE _phase2_post_guard;
DROP TEMPORARY TABLE _phase2_baseline;
