-- v3.15.0 Phase 1 (Size Integrity). Five nullable, no-default columns -- a NULL here
-- means "not yet derived", never a silent zero. Backfilled for challenge 6 by the next
-- migration; every other challenge gets the columns but stays NULL until it has its own
-- risk_ladder_tiers rows (planned_risk_pct/risk_deviation_pct depend on a ladder existing).
ALTER TABLE trades
    ADD COLUMN balance_at_entry   DECIMAL(12,2) NULL AFTER risk_amount,
    ADD COLUMN planned_risk_pct   DECIMAL(5,3)  NULL AFTER balance_at_entry,
    ADD COLUMN actual_risk_pct    DECIMAL(5,3)  NULL AFTER planned_risk_pct,
    ADD COLUMN risk_deviation_pct DECIMAL(6,2)  NULL AFTER actual_risk_pct,
    ADD COLUMN clean_rep          TINYINT(1)    NULL AFTER risk_deviation_pct;
