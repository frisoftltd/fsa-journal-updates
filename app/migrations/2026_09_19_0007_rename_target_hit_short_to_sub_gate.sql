-- v3.16.1 A3(a): target_hit_short renamed to target_hit_sub_gate. 2.35R average across
-- these four trades is not a "short" outcome -- verified against live data it's the
-- account's best-performing bucket (+$665.62, the largest single contributor). The 2.5
-- target_r gate threshold is unchanged (gate 5 still requires >=3:1 structurally); only
-- the label changes, so it stops implying these trades were errors when they were the
-- opposite. Data-only rename -- both values fit VARCHAR(20), no schema change needed.
-- Idempotent by construction (the WHERE clause matches nothing on a second run).
UPDATE trades SET exit_quality = 'target_hit_sub_gate' WHERE challenge_id = 6 AND exit_quality = 'target_hit_short';
