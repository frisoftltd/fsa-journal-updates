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

    /**
     * v3.17.0 — Auto Risk Calculator. Stop loss % is the only required input; every other
     * figure is either read from the active challenge / risk_ladder_tiers or derived from
     * trades already taken. Called live on every stop%/leverage/entry keystroke (debounced
     * client-side) — no Calculate button, per the briefing.
     *
     * Rounds at each step (risk_usd, then position_usd, then margin_usd), not once at the
     * end — verified against the briefing's own worked example (balance 9741.78, stop
     * 1.61%, leverage 5 → risk $97.42, position $6,050.93, margin $1,210.19): computing
     * position_usd from the unrounded risk_usd gives $6,051.11, not $6,050.93. Chained
     * rounding is what the worked numbers actually require, confirmed by hand before
     * writing this, not assumed.
     */
    public function autoRiskPreview() {
        $d = jsonInput();
        $db = getDB();

        $challengeId = validId($d['challenge_id'] ?? 0);
        if ($challengeId) {
            $cs = $db->prepare("SELECT * FROM challenges WHERE id=? AND user_id=?");
            $cs->execute([$challengeId, uid()]);
            $challenge = $cs->fetch();
            if (!$challenge) jsonError('Challenge not found.');
            $challenge = enrichChallenge($db, $challenge);
        } else {
            $challenge = getActiveChallenge();
            if (!$challenge) jsonError('No active challenge.');
            $challengeId = (int)$challenge['id'];
        }

        $stopPct = (isset($d['stop_pct']) && $d['stop_pct'] !== '') ? (float)$d['stop_pct'] : null;
        if ($stopPct === null || $stopPct <= 0) jsonError('Stop loss % is required and must be greater than 0.');

        $leverage = (isset($d['leverage']) && $d['leverage'] !== '') ? (float)$d['leverage'] : null;
        if ($leverage === null || $leverage <= 0) {
            $leverage = ($challenge['default_leverage'] ?? null) !== null ? (float)$challenge['default_leverage'] : null;
        }

        $entry = (isset($d['entry']) && $d['entry'] !== '') ? (float)$d['entry'] : null;

        $today = date('Y-m-d');
        $balance = balanceAtDayStart($db, $challengeId, $today);
        $riskPct = ladderTierForBalance($db, $challengeId, $balance);

        $riskUsd = $riskPct !== null ? round($balance * $riskPct / 100, 2) : null;
        $positionUsd = $riskUsd !== null ? round($riskUsd / ($stopPct / 100), 2) : null;
        $marginUsd = ($positionUsd !== null && $leverage) ? round($positionUsd / $leverage, 2) : null;
        $quantity = ($positionUsd !== null && $entry) ? round($positionUsd / $entry, 6) : null;

        $mi = $db->prepare("SELECT COALESCE(SUM(planned_margin),0) FROM trades WHERE challenge_id=? AND result='Open'");
        $mi->execute([$challengeId]);
        $marginInUse = round((float)$mi->fetchColumn(), 2);
        $availableMargin = round($balance - $marginInUse, 2);
        $marginOk = $marginUsd !== null ? ($marginUsd <= $availableMargin) : null;

        $failureBal = failureBalance($challenge);
        $roomUsd = round($balance - $failureBal, 2);
        $stopsToFail = ($riskUsd !== null && $riskUsd > 0) ? round($roomUsd / $riskUsd, 2) : null;

        jsonResponse([
            'challenge_id' => $challengeId,
            'balance' => $balance,
            'risk_pct' => $riskPct,
            'stop_pct' => $stopPct,
            'leverage' => $leverage,
            'entry' => $entry,
            'risk_usd' => $riskUsd,
            'position_usd' => $positionUsd,
            'margin_usd' => $marginUsd,
            'quantity' => $quantity,
            'margin_in_use' => $marginInUse,
            'available_margin' => $availableMargin,
            'margin_ok' => $marginOk,
            'failure_balance' => $failureBal,
            'room_usd' => $roomUsd,
            'stops_to_fail' => $stopsToFail,
        ]);
    }

    /**
     * v3.17.0/v3.17.1 — trade-limits config plus live counts (via helpers.php::
     * tradeLimitStatus(), shared with TradeController::saveTrade()'s server-side block),
     * the ladder tiers, and — new in v3.17.1 — margin_in_use/available_margin/
     * open_positions, so the calculator's "always visible during STOP" panel (balance,
     * margin in use, available margin, open-positions list, status strip) has everything
     * it needs from one call, independent of whether a stop % has even been typed yet.
     * Also backs the "+ New Trade"/"+ Trade" button gates on every page.
     */
    public function getRiskStatus() {
        $d = $_GET;
        $db = getDB();

        $challengeId = validId($d['challenge_id'] ?? 0);
        if ($challengeId) {
            $cs = $db->prepare("SELECT id FROM challenges WHERE id=? AND user_id=?");
            $cs->execute([$challengeId, uid()]);
            if (!$cs->fetch()) jsonError('Challenge not found.');
        } else {
            $ch = getActiveChallenge();
            if (!$ch) jsonError('No active challenge.');
            $challengeId = (int)$ch['id'];
        }

        $today = date('Y-m-d');
        $balanceToday = balanceAtDayStart($db, $challengeId, $today);

        // v3.17.0 — same tiers ladderTierForBalance() reads, exposed here so the
        // calculator page's Risk Rules panel can render them (replacing the three
        // hardcoded Recovery/Normal/Passing cards, which showed a ladder that didn't
        // match this challenge's real one) instead of a second endpoint just for this.
        $lt = $db->prepare("SELECT lower_balance, upper_balance, risk_pct FROM risk_ladder_tiers WHERE challenge_id=? AND active=1 ORDER BY lower_balance ASC");
        $lt->execute([$challengeId]);
        $tiers = array_map(function ($t) use ($balanceToday) {
            $lower = (float)$t['lower_balance'];
            $upper = $t['upper_balance'] !== null ? (float)$t['upper_balance'] : null;
            return [
                'lower_balance' => $lower,
                'upper_balance' => $upper,
                'risk_pct' => (float)$t['risk_pct'],
                'is_current' => $balanceToday >= $lower && ($upper === null || $balanceToday < $upper),
            ];
        }, $lt->fetchAll());

        // v3.17.1 — open positions + margin_in_use computed from the same result set:
        // margin_in_use is just planned_margin summed over exactly the rows the
        // open-positions list already needs to show. array_sum() treats a NULL
        // planned_margin as 0, matching the SQL COALESCE(SUM(...),0) convention used
        // for this same figure inside autoRiskPreview().
        $op = $db->prepare("SELECT id, pair, direction, trade_date, planned_margin FROM trades WHERE challenge_id=? AND result='Open' ORDER BY trade_date DESC, id DESC");
        $op->execute([$challengeId]);
        $openPositions = array_map(function ($t) {
            return [
                'id' => (int)$t['id'],
                'pair' => $t['pair'],
                'direction' => $t['direction'],
                'trade_date' => $t['trade_date'],
                'planned_margin' => $t['planned_margin'] !== null ? (float)$t['planned_margin'] : null,
            ];
        }, $op->fetchAll());
        $marginInUse = round(array_sum(array_column($openPositions, 'planned_margin')), 2);
        $availableMargin = round($balanceToday - $marginInUse, 2);

        $status = tradeLimitStatus($db, $challengeId);

        jsonResponse(array_merge($status, [
            'challenge_id' => $challengeId,
            'balance_at_day_start' => $balanceToday,
            'ladder_tiers' => $tiers,
            'open_positions' => $openPositions,
            'margin_in_use' => $marginInUse,
            'available_margin' => $availableMargin,
        ]));
    }
}
