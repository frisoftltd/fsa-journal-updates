-- v3.15.0 Phase 1 (Size Integrity): the risk ladder as data, matching the Strategy Lab
-- convention (strategy_variables) rather than the hardcoded 3-consecutive-losses-style
-- constants already scattered through AlertController.php/pages/calculator.php. A
-- challenge can carry more than one tier row; lookup is lower-inclusive, upper-exclusive,
-- upper_balance NULL meaning "and above".
CREATE TABLE IF NOT EXISTS risk_ladder_tiers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    challenge_id INT NOT NULL,
    lower_balance DECIMAL(12,2) NOT NULL,
    upper_balance DECIMAL(12,2) NULL,
    risk_pct DECIMAL(5,3) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_challenge_active (challenge_id, active),
    CONSTRAINT fk_risk_ladder_tiers_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Seed challenge 6 (Bitfunded Altcoin) with its real, already-documented ladder (see
-- CLAUDE.md v3.12.0: "0.25% under $9,500, 0.5% $9,500-$10,000, 1.0% above $10,000" --
-- the same ladder that was found NOT to have been followed during the July/early-August
-- drawdown, which is what this whole feature exists to surface). Idempotent: only inserts
-- if challenge 6 has no active tiers yet, so re-running this file (or a future baseline)
-- can't duplicate rows.
INSERT INTO risk_ladder_tiers (challenge_id, lower_balance, upper_balance, risk_pct, active)
SELECT * FROM (
    SELECT 6, 0.00, 9500.00, 0.250, 1
    UNION ALL SELECT 6, 9500.00, 10000.00, 0.500, 1
    UNION ALL SELECT 6, 10000.00, NULL, 1.000, 1
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM risk_ladder_tiers WHERE challenge_id = 6 AND active = 1);
