-- Extends strategy_variables with the gate/tag model: a variable is either
-- a mandatory pass/fail check ('gate') or an observed-only tag ('tag').
-- sort_order already provides sequencing, which is what "first NO ends the
-- analysis" needs, so it is left as-is.
--
-- role and is_active default to exactly the values the existing rows
-- (ids 11-15) should have, so ADD COLUMN's DEFAULT backfills every existing
-- row automatically -- no separate UPDATE statement is needed.
--
-- timeframe and criteria are left NULL for Acrob to fill in through the UI.
-- Seeding FSA rule content here would hardcode the exact thing this model
-- exists to make dynamic — deliberately not done.

ALTER TABLE strategy_variables
    ADD COLUMN role ENUM('gate','tag') NOT NULL DEFAULT 'gate' AFTER options,
    ADD COLUMN timeframe VARCHAR(10) NULL AFTER role,
    ADD COLUMN criteria TEXT NULL AFTER timeframe,
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER sort_order,
    ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER is_active;
