-- trades.session was NOT NULL DEFAULT 'London', so any trade saved without an explicit
-- session silently recorded as London, inflating that bucket in every session breakdown.
-- Removing the DEFAULT and allowing NULL makes "not recorded" distinguishable from a
-- genuine London trade going forward.
--
-- Existing rows are NOT touched. We cannot know which of the existing London rows were
-- genuinely London and which were silently defaulted, so retroactively changing values
-- would just trade one guess for another. This only changes what happens for trades
-- saved from now on.
ALTER TABLE trades MODIFY COLUMN session ENUM('London','New York','Asia','Other') NULL DEFAULT NULL;
