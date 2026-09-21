-- v3.17.0 (Auto Risk Calculator) -- daily/weekly trade limits as data, matching the
-- risk_ladder_tiers convention (2026_09_19_0001) rather than hardcoding "Max 2 trades/day"
-- into pages/calculator.php the way the notice bar this release deletes did. One row per
-- challenge (UNIQUE KEY below) -- unlike risk_ladder_tiers, there's no tiering concept
-- here, just one set of limits per challenge.
--
-- All four columns are nullable: a challenge with no row here (or a NULL column within
-- one) simply has no limit on that dimension -- CalculatorController::getRiskStatus()
-- treats a NULL limit as "not tracked," never as zero (the same "absence of information
-- is not a recorded zero" convention this codebase already applies to session,
-- r_multiple, emotion_tag, and now this).
CREATE TABLE challenge_limits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    challenge_id INT NOT NULL,
    max_trades_day INT NULL,
    max_trades_week INT NULL,
    max_losses_day INT NULL,
    daily_loss_usd DECIMAL(12,2) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_challenge_limits_challenge (challenge_id),
    CONSTRAINT fk_challenge_limits_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Seed challenge 6 (Bitfunded Altcoin) with the limits given in the briefing: 2 trades/day,
-- 4 trades/week, 2 losses/day, $500 daily loss. Idempotent -- the UNIQUE KEY above means a
-- second INSERT for challenge 6 fails outright rather than duplicating, so this is safe to
-- leave in the migration queue and re-run against a fresh environment.
INSERT INTO challenge_limits (challenge_id, max_trades_day, max_trades_week, max_losses_day, daily_loss_usd)
SELECT 6, 2, 4, 2, 500.00
WHERE NOT EXISTS (SELECT 1 FROM challenge_limits WHERE challenge_id = 6);
