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
     * v3.17.0 — trade-limits config (challenge_limits) plus today's/this-week's live
     * counts against it, and a single computed stop reason if any limit has been reached.
     * Backs both the calculator page's status strip and the "+ New Trade" button's own
     * gate on the Trades page — one source of truth for "can a new trade be logged right
     * now," not two independently-computed copies.
     *
     * A limit column that's NULL (no row at all, or an individual NULL column) is treated
     * as "not tracked" — it can never trigger a stop and is omitted from the amber/red
     * styling the frontend applies, same "absence of information is not a recorded zero"
     * convention as everywhere else limits/counts appear in this codebase.
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

        $ls = $db->prepare("SELECT max_trades_day, max_trades_week, max_losses_day, daily_loss_usd FROM challenge_limits WHERE challenge_id=?");
        $ls->execute([$challengeId]);
        $limits = $ls->fetch() ?: ['max_trades_day' => null, 'max_trades_week' => null, 'max_losses_day' => null, 'daily_loss_usd' => null];

        $today = date('Y-m-d');
        [$monday, $sunday] = weekBounds($today);

        $td = $db->prepare("SELECT COUNT(*) FROM trades WHERE challenge_id=? AND trade_date=?");
        $td->execute([$challengeId, $today]);
        $tradesToday = (int)$td->fetchColumn();

        $tw = $db->prepare("SELECT COUNT(*) FROM trades WHERE challenge_id=? AND trade_date BETWEEN ? AND ?");
        $tw->execute([$challengeId, $monday, $sunday]);
        $tradesWeek = (int)$tw->fetchColumn();

        $ld = $db->prepare("SELECT COUNT(*) FROM trades WHERE challenge_id=? AND result='Loss' AND trade_date=?");
        $ld->execute([$challengeId, $today]);
        $lossesToday = (int)$ld->fetchColumn();

        $pl = $db->prepare("SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id=? AND trade_date=?");
        $pl->execute([$challengeId, $today]);
        $dailyPnl = round((float)$pl->fetchColumn(), 2);

        // v3.17.0 — same tiers ladderTierForBalance() reads, exposed here so the
        // calculator page's Risk Rules panel can render them (replacing the three
        // hardcoded Recovery/Normal/Passing cards, which showed a ladder that didn't
        // match this challenge's real one) instead of a second endpoint just for this.
        $balanceToday = balanceAtDayStart($db, $challengeId, $today);
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

        // Checked in this order and the first breach found wins — trades-today is the
        // most immediate gate a trader hits, daily loss the most severe, so this reads as
        // "the most actionable reason first," not a strict severity ranking.
        $reason = null;
        if ($limits['max_trades_day'] !== null && $tradesToday >= (int)$limits['max_trades_day']) {
            $reason = "daily trade limit reached ({$tradesToday}/{$limits['max_trades_day']})";
        } elseif ($limits['max_trades_week'] !== null && $tradesWeek >= (int)$limits['max_trades_week']) {
            $reason = "weekly trade limit reached ({$tradesWeek}/{$limits['max_trades_week']})";
        } elseif ($limits['max_losses_day'] !== null && $lossesToday >= (int)$limits['max_losses_day']) {
            $reason = "daily loss-count limit reached ({$lossesToday}/{$limits['max_losses_day']})";
        } elseif ($limits['daily_loss_usd'] !== null && $dailyPnl <= -1 * (float)$limits['daily_loss_usd']) {
            $reason = 'daily loss limit reached ($' . number_format(abs($dailyPnl), 2) . ' / $' . number_format((float)$limits['daily_loss_usd'], 2) . ')';
        }

        jsonResponse([
            'challenge_id' => $challengeId,
            'balance_at_day_start' => $balanceToday,
            'ladder_tiers' => $tiers,
            'limits' => [
                'max_trades_day' => $limits['max_trades_day'] !== null ? (int)$limits['max_trades_day'] : null,
                'max_trades_week' => $limits['max_trades_week'] !== null ? (int)$limits['max_trades_week'] : null,
                'max_losses_day' => $limits['max_losses_day'] !== null ? (int)$limits['max_losses_day'] : null,
                'daily_loss_usd' => $limits['daily_loss_usd'] !== null ? (float)$limits['daily_loss_usd'] : null,
            ],
            'trades_today' => $tradesToday,
            'trades_week' => $tradesWeek,
            'losses_today' => $lossesToday,
            'daily_pnl' => $dailyPnl,
            'stopped' => $reason !== null,
            'reason' => $reason,
        ]);
    }
}
