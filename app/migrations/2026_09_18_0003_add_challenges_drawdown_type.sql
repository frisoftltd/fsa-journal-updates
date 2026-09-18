-- v3.14.7: FundedControl's "Current Drawdown" was always peak-to-trough (measured from
-- the equity high-water mark), which is stricter than how this account's prop firm
-- actually judges it. Bitfunded's own dashboard reports Maximum Loss used against the
-- starting balance, not a trailing peak -- confirmed directly: it shows 264.82 used of a
-- 1,000 allowance, matching 10,000 - 9,735.17 (starting_balance - current_balance)
-- exactly, not any peak-relative figure.
--
-- drawdown_type lets each challenge say which convention its own prop firm actually
-- uses. 'static' (the default) measures from starting_balance -- the correct convention
-- for Bitfunded, and also what AlertController's MAX DRAWDOWN REACHED check and
-- ReviewEngineController::ruleDrawdownProximity() already independently compute (both
-- predate this column and were already unconditionally static). 'trailing' preserves the
-- old peak-to-trough behavior, for a firm whose rule genuinely is a high-water mark.
ALTER TABLE challenges
    ADD COLUMN drawdown_type ENUM('static','trailing') NOT NULL DEFAULT 'static' AFTER max_drawdown_pct;

-- Explicit, not just relying on the column default: challenge 6 (Bitfunded Altcoin) is
-- static because that's confirmed against Bitfunded's own dashboard above, not because it
-- happened to get whatever the default is. If the default is ever changed later, this
-- line keeps challenge 6 correct regardless.
UPDATE challenges SET drawdown_type = 'static' WHERE id = 6;
