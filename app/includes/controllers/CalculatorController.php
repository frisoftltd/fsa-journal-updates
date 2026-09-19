<?php
/**
 * FundedControl — Calculator Controller
 * Handles: calculate_risk
 */
class CalculatorController {
    public function calculate() {
        $d = jsonInput();
        $ch = getActiveChallenge();
        $balance   = num($d['balance'] ?? $ch['current_balance'] ?? 10000);
        $risk_pct  = num($d['risk_pct'] ?? $ch['risk_per_trade_pct'] ?? 0.5);
        $entry     = num($d['entry'] ?? 0);
        $sl        = num($d['sl'] ?? 0);
        $tp        = num($d['tp'] ?? 0);
        $direction = $d['direction'] ?? '';

        if ($entry <= 0 || $sl <= 0 || $entry == $sl) jsonError('Invalid prices');
        if (!in_array($direction, ['Long', 'Short'], true)) jsonError('Direction (Long or Short) is required');

        // A stop/target on the wrong side of entry is not a valid trade, however the ABS()
        // legs below would still turn it into a plausible-looking positive R. Reject it
        // instead of silently computing a number.
        if ($direction === 'Long') {
            if ($sl >= $entry) jsonError('For a Long, stop loss must be below entry');
            if ($tp > 0 && $tp <= $entry) jsonError('For a Long, target must be above entry');
        } else {
            if ($sl <= $entry) jsonError('For a Short, stop loss must be above entry');
            if ($tp > 0 && $tp >= $entry) jsonError('For a Short, target must be below entry');
        }

        $risk_amt = $balance * $risk_pct / 100;
        $sl_dist  = abs($entry - $sl);
        $lot_size = $risk_amt / $sl_dist;
        $rr = ($tp > 0 && $sl_dist > 0) ? abs($tp - $entry) / $sl_dist : 0;
        $potential_profit = $tp > 0 ? $lot_size * abs($tp - $entry) : 0;
        jsonResponse([
            'risk_amount' => round($risk_amt, 2), 'lot_size' => round($lot_size, 4),
            'sl_distance' => round($sl_dist, 2), 'rr_ratio' => round($rr, 2),
            'potential_profit' => round($potential_profit, 2), 'risk_pct' => $risk_pct
        ]);
    }

    /**
     * v3.16.1 (Phase 1b, B4) — the pre-trade sizing panel's backend. Entry price and lot
     * size here are deliberately NOT persisted to trades.entry_price/lot_size — this form
     * has had no execution-fact inputs since v3.14.0 ("execution data should never be
     * typed"), and B1/B3 don't reopen that: stop_loss/take_profit are the only fields
     * that become required and persisted pre-entry. What's typed into this panel is a
     * planning aid only, read once for this response and discarded — the real
     * entry_price/lot_size a trade ends up with still come exclusively from
     * BitfundedImportController once the position actually closes.
     *
     * Ladder tier always comes from risk_ladder_tiers WHERE active=1 (via
     * helpers.php::ladderTierForBalance()) — never a hardcoded percentage, same
     * requirement B1 states for the persisted computation.
     */
    public function sizePreview() {
        $d = jsonInput();
        $db = getDB();
        $challengeId = validId($d['challenge_id'] ?? 0);
        if (!$challengeId) jsonError('Select a challenge first.');
        $cs = $db->prepare("SELECT id FROM challenges WHERE id=? AND user_id=?");
        $cs->execute([$challengeId, uid()]);
        if (!$cs->fetch()) jsonError('Challenge not found.');

        $tradeDate = trim((string)($d['trade_date'] ?? '')) ?: date('Y-m-d');
        $entry  = (isset($d['entry'])  && $d['entry']  !== '') ? (float)$d['entry']  : null;
        $stop   = (isset($d['stop'])   && $d['stop']   !== '') ? (float)$d['stop']   : null;
        $target = (isset($d['target']) && $d['target'] !== '') ? (float)$d['target'] : null;
        $lot    = (isset($d['lot_size']) && $d['lot_size'] !== '') ? (float)$d['lot_size'] : null;

        $balanceAtDayStart = balanceAtDayStart($db, $challengeId, $tradeDate);
        $plannedRiskPct = ladderTierForBalance($db, $challengeId, $balanceAtDayStart);
        $prescribedRiskDollars = $plannedRiskPct !== null ? round($balanceAtDayStart * $plannedRiskPct / 100, 2) : null;

        $enteredRiskDollars = null; $deviationPct = null; $targetR = null;
        if ($entry !== null && $stop !== null && $entry != $stop) {
            if ($lot !== null) {
                $enteredRiskDollars = round(abs($entry - $stop) * $lot, 2);
                if ($plannedRiskPct !== null && $plannedRiskPct > 0 && $balanceAtDayStart > 0) {
                    $enteredRiskPct = $enteredRiskDollars / $balanceAtDayStart * 100;
                    $deviationPct = round(($enteredRiskPct / $plannedRiskPct - 1) * 100, 2);
                }
            }
            if ($target !== null) {
                $targetR = round(($target - $entry) / ($entry - $stop), 2);
            }
        }

        // Two inline, non-blocking warnings (B4) — they inform, they don't prevent save.
        // The hard, blocking rule is stop_loss/take_profit's own required-field check in
        // TradeController::saveTrade() (B3), which this panel has nothing to do with.
        $warnings = [];
        if ($deviationPct !== null && abs($deviationPct) > 20) {
            $warnings[] = 'This is ' . round(abs($deviationPct), 1) . '% ' . ($deviationPct > 0 ? 'over' : 'under') . ' your ladder tier.';
        }
        if ($targetR !== null && $targetR < 3.0) {
            $warnings[] = "Target is {$targetR}:1. Gate 5 requires 3:1.";
        }

        jsonResponse([
            'balance_at_day_start' => $balanceAtDayStart,
            'planned_risk_pct' => $plannedRiskPct,
            'prescribed_risk_dollars' => $prescribedRiskDollars,
            'entered_risk_dollars' => $enteredRiskDollars,
            'deviation_pct' => $deviationPct,
            'target_r' => $targetR,
            'warnings' => $warnings,
        ]);
    }
}
