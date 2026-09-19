-- v3.16.0 Phase 2, item 3 -- tier basis moves from balance_at_entry (exact-time) to
-- balance_at_day_start (start-of-day). 27 of challenge 6's 59 trades sat within $250 of
-- the 9,500 ladder boundary; an at-entry basis let a trade's own tier flip mid-session
-- purely because an earlier SAME-DAY trade happened to close first -- a rule that moves
-- under the trader mid-session, not one they were actually held to going in.
-- balance_at_entry stays stored on the row (still a real, meaningful fact) -- it is
-- simply no longer the basis planned_risk_pct is computed from.
CREATE TEMPORARY TABLE _tier_rebase_baseline (net_pnl_sum DECIMAL(14,4), pnl_sum DECIMAL(14,4), trade_count INT);
INSERT INTO _tier_rebase_baseline
SELECT COALESCE(SUM(net_pnl),0), COALESCE(SUM(pnl),0), COUNT(*) FROM trades WHERE challenge_id = 6;

CREATE TEMPORARY TABLE _tier_rebase_pre_guard (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _tier_rebase_pre_guard (ok) VALUES (
    (SELECT trade_count FROM _tier_rebase_baseline) = 59
    AND (SELECT COUNT(*) FROM trades WHERE challenge_id = 6 AND balance_at_day_start IS NULL) = 0
    AND (SELECT COUNT(*) FROM risk_ladder_tiers WHERE challenge_id = 6 AND active = 1) = 3
);
DROP TEMPORARY TABLE _tier_rebase_pre_guard;

-- Reset first -- defensive, so a trade that somehow falls outside every tier band under
-- the new basis ends up NULL rather than silently keeping its stale at-entry value.
UPDATE trades SET planned_risk_pct = NULL WHERE challenge_id = 6;

UPDATE trades t
JOIN risk_ladder_tiers rt
    ON rt.challenge_id = t.challenge_id
   AND rt.active = 1
   AND t.balance_at_day_start >= rt.lower_balance
   AND (rt.upper_balance IS NULL OR t.balance_at_day_start < rt.upper_balance)
SET t.planned_risk_pct = rt.risk_pct
WHERE t.challenge_id = 6 AND t.balance_at_day_start IS NOT NULL;

-- risk_deviation_pct recomputed against the new planned_risk_pct. actual_risk_pct itself
-- is untouched -- it's a fact about what was actually risked, independent of which
-- balance basis judges it against the ladder.
UPDATE trades t
SET t.risk_deviation_pct = ROUND((t.actual_risk_pct / t.planned_risk_pct - 1) * 100, 2)
WHERE t.challenge_id = 6
  AND t.actual_risk_pct IS NOT NULL
  AND t.planned_risk_pct IS NOT NULL
  AND t.planned_risk_pct > 0;

-- Any row that didn't get a fresh planned_risk_pct (shouldn't happen -- the ladder's
-- three tiers span 0 to unbounded with no gaps -- but must not carry a stale deviation
-- computed against the old at-entry basis if it does).
UPDATE trades t
SET t.risk_deviation_pct = NULL
WHERE t.challenge_id = 6 AND (t.planned_risk_pct IS NULL OR t.actual_risk_pct IS NULL);

CREATE TEMPORARY TABLE _tier_rebase_post_guard (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _tier_rebase_post_guard (ok) VALUES (
    (SELECT COUNT(*) FROM trades WHERE challenge_id = 6) = (SELECT trade_count FROM _tier_rebase_baseline)
    AND ROUND((SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id = 6), 4) = ROUND((SELECT net_pnl_sum FROM _tier_rebase_baseline), 4)
    AND ROUND((SELECT COALESCE(SUM(pnl),0) FROM trades WHERE challenge_id = 6), 4) = ROUND((SELECT pnl_sum FROM _tier_rebase_baseline), 4)
);
DROP TEMPORARY TABLE _tier_rebase_post_guard;
DROP TEMPORARY TABLE _tier_rebase_baseline;
