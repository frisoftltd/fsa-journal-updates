-- v3.29.0 — strategies become assignable to specific challenges, so the Strategy
-- dropdown (trade form, bulk "Set Strategy", Statistics/Dashboard filter) only ever
-- offers the right ones per challenge, and a TradeFI signal-follow trade can't be
-- mistagged as an FSA strategy or the reverse.
--
-- `applies_all_challenges` is explicit, not inferred from "zero assignment rows" --
-- inferring it would mean a strategy deliberately scoped to one challenge silently
-- becomes "all challenges" the moment that one challenge is deleted (strategy_challenges'
-- own ON DELETE CASCADE on challenge_id removes its last row). DEFAULT 1 on this ALTER
-- means every strategy that exists before this migration runs keeps working in every
-- challenge immediately, with zero rows written to strategy_challenges for any of them --
-- no trades.strategy_id is touched, no challenge's balance/drawdown figures are touched,
-- this is purely additive. A strategy only ever becomes flag=0 ("scoped") through a
-- future app action (StrategyBuilderController::update()), never by this migration.
--
-- "Valid for challenge X" going forward: applies_all_challenges=1, OR an explicit row in
-- strategy_challenges for (strategy_id, X). A scoped strategy whose every assigned
-- challenge is later deleted has zero rows AND flag=0 -- it matches neither condition for
-- any challenge, so it simply stops appearing anywhere until reassigned, exactly as
-- intended, with no extra code needed to detect that case.
--
-- Same information_schema-check + PREPARE/EXECUTE guarded-ALTER pattern as
-- 2026_10_10_0002 (CLAUDE.md §3A step 2a) -- MySQL 8.4 has no ADD COLUMN IF NOT EXISTS.

SET @col_exists1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'strategies' AND COLUMN_NAME = 'applies_all_challenges'
);
SET @add_col_sql1 = IF(@col_exists1 = 0,
  'ALTER TABLE strategies ADD COLUMN applies_all_challenges TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active',
  'SELECT 1'
);
PREPARE add_col_stmt1 FROM @add_col_sql1;
EXECUTE add_col_stmt1;
DEALLOCATE PREPARE add_col_stmt1;

CREATE TABLE IF NOT EXISTS strategy_challenges (
    id INT PRIMARY KEY AUTO_INCREMENT,
    strategy_id INT NOT NULL,
    challenge_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_strategy_challenge (strategy_id, challenge_id),
    CONSTRAINT fk_sc_strategy FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
    CONSTRAINT fk_sc_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Rollback (manual, not run by migrate.php): DROP TABLE strategy_challenges; then
-- ALTER TABLE strategies DROP COLUMN applies_all_challenges; -- safe in either order,
-- reverts every strategy to today's real behaviour (works in every challenge, no
-- exceptions) since nothing else in the schema references either object.
