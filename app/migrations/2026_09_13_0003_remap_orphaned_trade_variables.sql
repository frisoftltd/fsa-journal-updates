-- Repairs the strategy_variables orphaning bug: ids 6-10 were deleted and
-- re-inserted as 11-15, detaching 95 trade_variables rows (19 trades x 5
-- variables) from their strategy_variables parent. The mapping is a clean
-- +5 offset, confirmed by matching value domains (checkbox/checkbox,
-- support-resistance string, fib level, candlestick pattern for each pair).
--
-- Guard: a session-scoped TEMPORARY table with a CHECK constraint that only
-- accepts the value 1. If the live counts don't match the snapshot this
-- migration was written against, the INSERT below fails with a real,
-- catchable constraint-violation error and the runner stops before the
-- UPDATE ever runs. No stored procedure needed, so the runner's plain
-- semicolon-delimited statement splitter handles this file correctly.

CREATE TEMPORARY TABLE _migration_guard (ok TINYINT NOT NULL CHECK (ok = 1));

INSERT INTO _migration_guard (ok) VALUES (
    (SELECT COUNT(*) FROM trade_variables WHERE variable_id BETWEEN 6 AND 10) = 95
    AND (SELECT COUNT(*) FROM trade_variables WHERE variable_id BETWEEN 11 AND 15) = 10
    AND (SELECT COUNT(*) FROM strategy_variables WHERE id IN (11,12,13,14,15)) = 5
    AND (SELECT COUNT(*) FROM strategy_variables) = 5
);

DROP TEMPORARY TABLE _migration_guard;

-- Remap: shift the orphaned answers onto their surviving parent ids.
UPDATE trade_variables
SET variable_id = variable_id + 5
WHERE variable_id BETWEEN 6 AND 10;

-- Post-verify: same technique, checked against the expected end state. If
-- this fails, the UPDATE above has already run (MariaDB autocommits DML
-- statement-by-statement here — there is no wrapping transaction to roll
-- back) — treat a failure at this step as "stop and inspect the data by
-- hand", not as "nothing happened".
CREATE TEMPORARY TABLE _migration_guard (ok TINYINT NOT NULL CHECK (ok = 1));

INSERT INTO _migration_guard (ok) VALUES (
    (SELECT COUNT(*) FROM trade_variables) = 105
    AND (SELECT COUNT(*) FROM trade_variables WHERE variable_id NOT BETWEEN 11 AND 15) = 0
    AND (SELECT COUNT(DISTINCT trade_id) FROM trade_variables) = 21
    AND (SELECT COUNT(*) FROM trade_variables tv LEFT JOIN strategy_variables sv ON sv.id = tv.variable_id WHERE sv.id IS NULL) = 0
);

DROP TEMPORARY TABLE _migration_guard;
