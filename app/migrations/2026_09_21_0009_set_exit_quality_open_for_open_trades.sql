-- v3.16.4 -- computeTradeRiskFields() (helpers.php) previously left an unresolved trade's
-- exit_quality at 'unknown' -- the same value a genuinely closed trade with no stop/target
-- on file gets. Those are two different facts ("this trade hasn't closed yet" vs "this
-- trade closed but we can't judge its exit"), collapsed into one label. helpers.php now
-- derives 'open' for any trade whose result is not in ('Win','Loss','Break Even') -- the
-- same closed-trades-only convention already used everywhere else in this codebase (see
-- CLAUDE.md's "Closed-Trades-Only Rule", v3.9.0). This is a one-time backfill for every
-- currently-open trade so existing rows match what the app would compute for them right
-- now; going forward TradeController::saveTrade() computes this live on every save.
-- Idempotent: re-running only ever re-asserts the same value on the same rows.
-- result IS NULL is included explicitly: SQL's NOT IN evaluates to NULL (not TRUE) for a
-- NULL left-hand side, so a bare "result NOT IN (...)" would silently skip every
-- brand-new trade whose result was never picked (TradeController::saveTrade() stores an
-- unselected result as NULL, not '', via its `?: null` normalization) -- exactly the
-- trades this migration exists to catch.
UPDATE trades
SET exit_quality = 'open'
WHERE result IS NULL OR result NOT IN ('Win','Loss','Break Even');
