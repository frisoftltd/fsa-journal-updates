-- v3.17.0 (Auto Risk Calculator) -- not one of the two migrations the briefing named
-- (planned_margin, challenge_limits), added anyway because the briefing's own input list
-- requires it: "Leverage: default from challenge settings, editable." No column on
-- `challenges` held a default leverage before this release -- pages/calculator.php's old,
-- now-deleted form just had a bare, always-blank leverage input with no source of a
-- default at all. This is additive only (a nullable column, no rename, no drop), so it
-- stays inside the "Additive. No table renames, no column drops." constraint the briefing
-- states up front, even though it wasn't itself one of the enumerated migrations.
-- NULL means "no default set for this challenge" -- the calculator then falls back to a
-- blank leverage input the user must fill in themselves, never a guessed number.
ALTER TABLE challenges
    ADD COLUMN default_leverage DECIMAL(6,2) NULL AFTER drawdown_type;
