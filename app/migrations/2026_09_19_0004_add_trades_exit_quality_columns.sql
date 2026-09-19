-- v3.16.0 Phase 2. Three more nullable, no-default columns on trades -- same convention
-- as the five added in 2026_09_19_0002: NULL means "not yet derived," never a zero.
ALTER TABLE trades
    ADD COLUMN balance_at_day_start DECIMAL(12,2) NULL AFTER balance_at_entry,
    ADD COLUMN target_r             DECIMAL(6,2)  NULL AFTER risk_deviation_pct,
    ADD COLUMN exit_quality         VARCHAR(20)   NULL AFTER target_r;
