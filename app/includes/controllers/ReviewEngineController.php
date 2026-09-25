
<?php
/**
 * FundedControl — Behavioral Review Engine (v3.9.0, Phase 1b Corrections)
 * Handles: get_review, get_review_periods
 * Deterministic PHP rules over real trade data. No external API calls.
 * Leaves ReviewController / weekly_reviews (manual review) untouched.
 *
 * v3.9.0 (v3.16.1 Part A) corrects three v3.8.0 rules against live-verified data
 * (EXIT_TARGET_SHORT rewritten to fire on stopped_short only — its prior "take-profits
 * paying 1R" claim traced to estimated-R rows and was wrong; RISK_LADDER_DRIFT's
 * tolerance widened +/-15% -> +/-20%), adds EXIT_NO_TARGET (the largest previously-
 * unreported finding, pushed first in the insights list) and a NO_ACTIVITY insight for
 * empty periods. See CLAUDE.md v3.16.1 for the full corrections list and why 'target_hit_
 * short' was renamed to 'target_hit_sub_gate'.
 *
 * v3.7.0 (v3.15.0 Phase 1) added three rule methods (ruleSizeSkew/ruleTierBreach/
 * ruleLadderDrift) and their supporting metrics over the new risk_ladder_tiers table and
 * trades.balance_at_entry/planned_risk_pct/actual_risk_pct/risk_deviation_pct/clean_rep
 * columns.
 *
 * v3.8.0 (v3.16.0 Phase 2) recalibrates those three (RISK_SIZE_SKEW threshold/severity,
 * RISK_TIER_BREACH's month-named message, RISK_LADDER_DRIFT's threshold/over-under split)
 * against real data, moves the ladder tier basis from balance_at_entry to the new
 * balance_at_day_start (start-of-day, not exact-entry-time — see computePhase2Metrics'
 * sibling migration comments for why), and adds fifteen more rule methods across
 * Repetition, Exit Quality, Edge (recorded/estimated split), Cost, and Geometry. A fourth
 * severity, 'info', is introduced for context that isn't a problem (see the $order map in
 * getReview()). Additive only — no existing rule method (Phase 0's 20 or Phase 1's 3) was
 * rewritten, only recalibrated where explicitly instructed.
 */
require_once __DIR__ . '/../emotion_states.php';

class ReviewEngineController {
    const MIN_RULE_ADHERENCE = 10;   // A1 good-check, each side
    const MIN_RULE_VOLUME    = 10;   // A1 watch-check, total tagged
    const MIN_GRADE          = 8;    // A2, each of A/C
    const MIN_VAR            = 8;    // A3, each variable value
    const MIN_RISK_CREEP     = 6;    // B1, total risk-priced trades
    const MIN_POST_LOSS      = 5;    // B3
    const MIN_REVENGE        = 3;    // C1, closed subset for win-rate claim
    const MIN_TILT           = 5;    // C2
    const MIN_MEDIAN_DAYS    = 10;   // C3, trading days to establish baseline
    const MIN_SESSION        = 8;    // C4, each session/hour bucket
    const MIN_EMOTION        = 5;    // D1, each emotion
    const MIN_NEG_STATE      = 10;   // D2, total tagged
    const MIN_SANITY         = 10;   // E1
    const MIN_PAIR           = 8;    // E2, each pair
    const MIN_SCRATCH        = 8;    // E3
    const MIN_TREND          = 10;   // E4, each period
    const MIN_CHALLENGE_RANK = 20;   // F3, each challenge
    const MIN_SIZE_SKEW      = 10;   // G1, resolved (exit_reason Take Profit/Stop Loss) trades
    const MIN_LADDER_DRIFT   = 10;   // G3, sized (actual_risk_pct not null) trades

    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    // ── ROUTES ───────────────────────────────────────────────

    public function listPeriods() {
        $type = $_GET['period_type'] ?? 'weekly';
        if (!in_array($type, ['daily','weekly','monthly','quarterly','yearly'], true)) jsonError('Invalid period_type');
        $challengeId = (isset($_GET['challenge_id']) && $_GET['challenge_id'] !== '') ? validId($_GET['challenge_id']) : null;

        // v3.20.0 — the else branch (no challenge filter at all, "All Combined" scope)
        // needs source != 'backtest' explicitly: with no challenge_id condition to
        // exclude a NULL-challenge backtest row by accident, nothing else here would.
        // The if branch is already safe -- challenge_id=? never matches a NULL row.
        if ($challengeId) {
            $s = $this->db->prepare("SELECT trade_date FROM trades WHERE user_id=? AND challenge_id=? ORDER BY trade_date ASC");
            $s->execute([$this->uid, $challengeId]);
        } else {
            $s = $this->db->prepare("SELECT trade_date FROM trades WHERE user_id=? AND source != 'backtest' ORDER BY trade_date ASC");
            $s->execute([$this->uid]);
        }
        $dates = $s->fetchAll(PDO::FETCH_COLUMN);

        $buckets = [];
        foreach ($dates as $d) {
            [$ps, $pe] = $this->periodBounds($type, $d);
            if (!isset($buckets[$ps])) $buckets[$ps] = ['period_start' => $ps, 'period_end' => $pe, 'trade_count' => 0];
            $buckets[$ps]['trade_count']++;
        }
        $list = array_values($buckets);
        usort($list, fn($a, $b) => strcmp($b['period_start'], $a['period_start']));

        jsonResponse(['period_type' => $type, 'periods' => $list]);
    }

    public function getReview() {
        $type = $_GET['period_type'] ?? 'weekly';
        if (!in_array($type, ['daily','weekly','monthly','quarterly','yearly'], true)) jsonError('Invalid period_type');
        $refDate = $_GET['period_start'] ?? date('Y-m-d');
        $challengeId = (isset($_GET['challenge_id']) && $_GET['challenge_id'] !== '') ? validId($_GET['challenge_id']) : null;

        [$periodStart, $periodEnd] = $this->periodBounds($type, $refDate);

        $challenge = null;
        if ($challengeId) {
            $cs = $this->db->prepare("SELECT * FROM challenges WHERE id=? AND user_id=?");
            $cs->execute([$challengeId, $this->uid]);
            $challenge = $cs->fetch();
            if (!$challenge) jsonError('Challenge not found');
            $challenge = enrichChallenge($this->db, $challenge);
        }

        $trades = $this->fetchTrades($challengeId, $periodStart, $periodEnd);
        $closed = array_values(array_filter($trades, fn($t) => in_array($t['result'], ['Win','Loss','Break Even'], true)));
        $metrics = $this->computeMetrics($closed, $trades);
        $sizeMetrics = $this->computeSizeIntegrityMetrics($closed, $trades, $challenge);
        $metrics = array_merge($metrics, $sizeMetrics);
        $phase2Metrics = $this->computePhase2Metrics($closed, $trades, $challenge, $sizeMetrics);
        $metrics = array_merge($metrics, $phase2Metrics);

        $scope = ['challenge_id' => $challengeId, 'label' => $challenge ? $challenge['name'] : 'All Combined'];

        if (count($trades) === 0) {
            // v3.16.1 A4: two daily reviews (Sep 17, 19) returned a blank panel with
            // nothing closed that day -- render an explicit NO_ACTIVITY insight instead
            // of an empty array, so the UI has something to show rather than nothing.
            $noActivity = [[
                'severity' => 'info', 'category' => 'repetition',
                'headline' => 'No trades closed.',
                'detail' => 'No trades closed. Nothing to review.',
                'recommendation' => '',
                'based_on_n' => 0, 'conclusive' => true,
            ]];
            $this->upsertReview($challengeId, $type, $periodStart, $periodEnd, json_encode($noActivity), json_encode($metrics));
            jsonResponse([
                'period' => ['type' => $type, 'start' => $periodStart, 'end' => $periodEnd],
                'scope' => $scope,
                'metrics' => $metrics,
                'insights' => $noActivity,
                'empty' => true,
            ]);
        }

        $challengeMap = $this->userChallengeMap();

        $insights = array_merge(
            // v3.16.1 A2: EXIT_NO_TARGET leads the panel -- pushed first so it sorts to
            // the top of the alert tier (stable sort, see the rule's own docblock).
            $this->ruleExitNoTarget($phase2Metrics),
            $this->ruleFullRuleVsCutCorner($closed),
            $this->ruleSetupGradeVsOutcome($closed),
            $this->ruleVariableAttribution($closed),
            $this->ruleRiskCreep($closed),
            $this->ruleOversizedTrades($closed, $challengeMap),
            $this->rulePostLossSizing($trades),
            $this->ruleRevengeTrades($trades),
            $this->ruleLossStreakTilt($closed),
            $this->ruleOvertrading($challengeId, $trades),
            $this->ruleTimeOfDayLeak($closed),
            $this->ruleEmotionOutcome($closed),
            $this->ruleNegativeStateFrequency($closed),
            $this->ruleNoteQuality($trades),
            $this->ruleWinrateExpectancySanity($closed),
            $this->ruleBestWorstPair($closed),
            $this->ruleBreakEvenRate($closed),
            $this->rulePeriodTrend($type, $periodStart, $challengeId, $closed),
            $challenge ? $this->ruleDrawdownProximity($challenge) : [],
            $challenge ? $this->ruleDailyLossLimitHits($closed, $challenge) : [],
            !$challenge ? $this->ruleAggressiveVsReserved($closed, $challengeMap) : [],
            $this->ruleSizeSkew($sizeMetrics),
            $challenge ? $this->ruleTierBreach($sizeMetrics, $challenge) : [],
            $this->ruleLadderDrift($sizeMetrics),
            $this->ruleNoCleanReps($phase2Metrics),
            $this->ruleTemplateExists($phase2Metrics),
            $this->ruleRepFields($phase2Metrics),
            $this->ruleNoDenominator(),
            $this->ruleExitTargetShort($phase2Metrics),
            $this->ruleExitQualityUnknown($phase2Metrics),
            $this->ruleExitValidHeld($phase2Metrics),
            $this->ruleEdgeRecordedOnly($phase2Metrics),
            $this->ruleEdgeUnproven($phase2Metrics),
            $this->ruleEdgeNegative($phase2Metrics),
            $this->ruleEdgeInterventionPositive($phase2Metrics),
            $this->ruleCostExceedsLoss($phase2Metrics),
            $this->ruleCostDrag($phase2Metrics),
            $this->ruleCostFlipped($phase2Metrics),
            $challenge ? $this->ruleGeoRatioDrift($phase2Metrics) : []
        );

        // 'info' added v3.16.0 -- a fourth severity for context that isn't a problem
        // (recorded/estimated disclosures, sample-size notices) and shouldn't compete
        // for attention with a real 'watch'/'alert' finding, but also isn't a 'good'.
        $order = ['alert' => 0, 'watch' => 1, 'info' => 2, 'good' => 3];
        usort($insights, fn($a, $b) => $order[$a['severity']] <=> $order[$b['severity']]);

        $this->upsertReview($challengeId, $type, $periodStart, $periodEnd, json_encode($insights), json_encode($metrics));

        jsonResponse([
            'period' => ['type' => $type, 'start' => $periodStart, 'end' => $periodEnd],
            'scope' => $scope,
            'metrics' => $metrics,
            'insights' => $insights,
        ]);
    }

    // ── PERIOD MATH ──────────────────────────────────────────

    private function periodBounds($type, $refDateStr) {
        $ref = new DateTime($refDateStr);
        switch ($type) {
            case 'daily':
                $start = clone $ref; $end = clone $ref;
                break;
            case 'weekly':
                $dow = (int)$ref->format('N');
                $start = (clone $ref)->modify('-' . ($dow - 1) . ' days');
                $end = (clone $start)->modify('+6 days');
                break;
            case 'monthly':
                $start = new DateTime($ref->format('Y-m-01'));
                $end = (clone $start)->modify('last day of this month');
                break;
            case 'quarterly':
                $qStartMonth = (int)(floor(((int)$ref->format('n') - 1) / 3) * 3 + 1);
                $start = new DateTime($ref->format('Y') . '-' . str_pad($qStartMonth, 2, '0', STR_PAD_LEFT) . '-01');
                $end = (clone $start)->modify('+2 months')->modify('last day of this month');
                break;
            case 'yearly':
            default:
                $start = new DateTime($ref->format('Y') . '-01-01');
                $end = new DateTime($ref->format('Y') . '-12-31');
                break;
        }
        return [$start->format('Y-m-d'), $end->format('Y-m-d')];
    }

    private function previousPeriodBounds($type, $periodStart) {
        $start = new DateTime($periodStart);
        switch ($type) {
            case 'daily': $ref = (clone $start)->modify('-1 day'); break;
            case 'weekly': $ref = (clone $start)->modify('-7 days'); break;
            case 'monthly': $ref = (clone $start)->modify('-1 month'); break;
            case 'quarterly': $ref = (clone $start)->modify('-3 months'); break;
            case 'yearly': default: $ref = (clone $start)->modify('-1 year'); break;
        }
        return $this->periodBounds($type, $ref->format('Y-m-d'));
    }

    // ── DATA FETCH ───────────────────────────────────────────

    private function fetchTrades($challengeId, $start, $end) {
        $cols = "id,trade_date,time_in,time_out,session,pair,direction,result,pnl,net_pnl,fees,r_multiple,r_multiple_source,risk_amount,strategy_id,emotion_tag,setup_grade,note_saw,note_why,note_unsure,fsa_rules,challenge_id,exit_reason,stop_loss,take_profit,balance_at_entry,planned_risk_pct,actual_risk_pct,risk_deviation_pct,clean_rep,target_r,exit_quality";
        // v3.20.0 — same reasoning as listPeriods() above: the else branch (no
        // challenge_id condition) needs source != 'backtest' explicitly.
        if ($challengeId) {
            $s = $this->db->prepare("SELECT $cols FROM trades WHERE user_id=? AND challenge_id=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date ASC, time_in ASC, id ASC");
            $s->execute([$this->uid, $challengeId, $start, $end]);
        } else {
            $s = $this->db->prepare("SELECT $cols FROM trades WHERE user_id=? AND source != 'backtest' AND trade_date BETWEEN ? AND ? ORDER BY trade_date ASC, time_in ASC, id ASC");
            $s->execute([$this->uid, $start, $end]);
        }
        return $s->fetchAll();
    }

    private function userChallengeMap() {
        $s = $this->db->prepare("SELECT id,name,daily_loss_limit,risk_per_trade_pct,starting_balance,funding_adjustment,max_drawdown_pct,max_loss_amt,profit_target_amt FROM challenges WHERE user_id=?");
        $s->execute([$this->uid]);
        $map = [];
        foreach ($s->fetchAll() as $c) $map[$c['id']] = enrichChallenge($this->db, $c);
        return $map;
    }

    // ── METRICS ──────────────────────────────────────────────

    private function computeMetrics($closed, $allTrades) {
        $n = count($closed);
        $wins = count(array_filter($closed, fn($t) => $t['result'] === 'Win'));
        $losses = count(array_filter($closed, fn($t) => $t['result'] === 'Loss'));
        $bes = $n - $wins - $losses;
        $rSum = 0.0; $winRSum = 0.0; $lossRSum = 0.0; $pnlSum = 0.0;
        foreach ($closed as $t) {
            $r = (float)($t['r_multiple'] ?? 0);
            $rSum += $r;
            $pnlSum += (float)($t['net_pnl'] ?? 0);
            if ($t['result'] === 'Win') $winRSum += $r;
            if ($t['result'] === 'Loss') $lossRSum += abs($r);
        }
        return [
            'trades_total' => count($allTrades),
            'trades_closed' => $n,
            'wins' => $wins, 'losses' => $losses, 'break_evens' => $bes,
            'win_rate' => $n > 0 ? round($wins / $n * 100, 1) : 0,
            'avg_r' => $n > 0 ? round($rSum / $n, 2) : 0,
            'expectancy_r' => $n > 0 ? round($rSum / $n, 2) : 0,
            'net_pnl' => round($pnlSum, 2),
            'avg_win_r' => $wins > 0 ? round($winRSum / $wins, 2) : 0,
            'avg_loss_r' => $losses > 0 ? round($lossRSum / $losses, 2) : 0,
            'r_estimated_pct' => $this->rEstimatedPct($closed),
        ];
    }

    /**
     * Size Integrity metrics (v3.7.0 / v3.15.0 Phase 1). Winners/losers for dollars-per-R
     * and size_skew are drawn from the RESOLVED population only (exit_reason IN
     * ('Take Profit','Stop Loss')) — a manually-closed trade's R is not the R that was
     * actually risked, so it can't inform how much a winner vs. a loser was sized. Ladder
     * metrics (adherence/tier-breach/deviation) instead use every trade in scope with a
     * backfilled actual_risk_pct ($allTrades, not $closed) — a sizing decision is real the
     * moment the trade is opened, whether or not it's resolved yet.
     *
     * Every figure that can't be computed (its own n = 0, or no challenge in scope for the
     * ladder-lookup figures) returns the literal string 'UNAVAILABLE', never a silent 0 —
     * a rule reading one of these tokens is expected to refuse to fire rather than render
     * "UNAVAILABLE" into a sentence (see ruleSizeSkew/ruleTierBreach/ruleLadderDrift below,
     * each of which checks its own gating figure before firing).
     */
    private function computeSizeIntegrityMetrics($closed, $allTrades, $challenge) {
        $NA = 'UNAVAILABLE';
        $resolved = array_values(array_filter($closed, fn($t) => in_array($t['exit_reason'] ?? null, ['Take Profit', 'Stop Loss'], true)));
        $winners = array_values(array_filter($resolved, fn($t) => $t['result'] === 'Win'));
        $losers  = array_values(array_filter($resolved, fn($t) => $t['result'] === 'Loss'));

        $winDollars = array_sum(array_map(fn($t) => (float)($t['net_pnl'] ?? 0), $winners));
        $winR       = array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $winners));
        $lossDollars = abs(array_sum(array_map(fn($t) => (float)($t['net_pnl'] ?? 0), $losers)));
        $lossR       = abs(array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $losers)));

        $dprWinners = $winR > 0 ? round($winDollars / $winR, 2) : null;
        $dprLosers  = $lossR > 0 ? round($lossDollars / $lossR, 2) : null;
        $sizeSkew   = ($dprWinners !== null && $dprWinners > 0 && $dprLosers !== null) ? round($dprLosers / $dprWinners, 3) : null;

        $totalR = round(array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $resolved)), 2);
        $totalDollars = round(array_sum(array_map(fn($t) => (float)($t['net_pnl'] ?? 0), $resolved)), 2);

        // Sized trades: any trade in scope (open or closed) with a backfilled actual_risk_pct.
        $sized = array_values(array_filter($allTrades, fn($t) => $t['actual_risk_pct'] !== null));
        $sizedN = count($sized);
        // v3.16.1 A5: tolerance widened from +/-15% to +/-20%. Post-rebase adherence was
        // 71.2% against RISK_LADDER_DRIFT's 70% threshold -- 1.2 points of margin, which
        // would flicker the rule on and off on a single trade either way. 14 over-tier
        // and 3 under-tier out of 59 is a real, worth-reporting pattern rather than
        // noise, so the tolerance widens (stops flagging a marginal ~16-19% deviation as
        // "outside tolerance") rather than raising RISK_LADDER_DRIFT's own 70% threshold.
        $withinTolerance = count(array_filter($sized, fn($t) => abs((float)$t['risk_deviation_pct']) <= 20));
        $ladderAdherence = $sizedN > 0 ? round($withinTolerance / $sizedN * 100, 1) : null;

        // v3.16.0: a bare breach count reads the same whether it's 11 breaches in one
        // week or spread across four months -- so the breach set is also broken out by
        // month for RISK_TIER_BREACH's message.
        $breachedTrades = array_values(array_filter($sized, function ($t) {
            if ($t['planned_risk_pct'] === null) return false;
            return (float)$t['actual_risk_pct'] > (float)$t['planned_risk_pct'] * 1.15;
        }));
        $breachCount = count($breachedTrades);
        $breachByMonth = [];
        foreach ($breachedTrades as $t) {
            if (empty($t['trade_date'])) continue;
            $m = substr($t['trade_date'], 0, 7);
            $breachByMonth[$m] = ($breachByMonth[$m] ?? 0) + 1;
        }
        ksort($breachByMonth);

        $deviations = array_map(fn($t) => abs((float)$t['risk_deviation_pct']), array_values(array_filter($sized, fn($t) => $t['risk_deviation_pct'] !== null)));
        $worstDeviation = $deviations ? round(max($deviations), 2) : null;

        // v3.16.0: oversizing and undersizing are different failures (one burns the
        // account faster than planned, the other under-uses an edge that's actually
        // there) -- RISK_LADDER_DRIFT's message now splits them instead of reporting one
        // adherence number.
        $overTierCount  = count(array_filter($sized, fn($t) => $t['risk_deviation_pct'] !== null && (float)$t['risk_deviation_pct'] > 20));
        $underTierCount = count(array_filter($sized, fn($t) => $t['risk_deviation_pct'] !== null && (float)$t['risk_deviation_pct'] < -20));

        $byMonth = [];
        foreach ($sized as $t) {
            if ($t['risk_deviation_pct'] === null || empty($t['trade_date'])) continue;
            $m = substr($t['trade_date'], 0, 7);
            if (!isset($byMonth[$m])) $byMonth[$m] = ['n' => 0, 'sum' => 0.0];
            $byMonth[$m]['n']++;
            $byMonth[$m]['sum'] += (float)$t['risk_deviation_pct'];
        }
        $deviationByMonth = [];
        foreach ($byMonth as $m => $v) $deviationByMonth[] = ['month' => $m, 'avg_deviation_pct' => round($v['sum'] / $v['n'], 2), 'n' => $v['n']];
        usort($deviationByMonth, fn($a, $b) => strcmp($a['month'], $b['month']));

        // current_tier_pct / consecutive_stops_to_failure need a specific challenge's
        // ladder and live balance — UNAVAILABLE for "All Combined" scope, where there is
        // no single ladder to look up against.
        $currentTierPct = null; $consecutiveStopsToFailure = null;
        if ($challenge) {
            $tiers = $this->getLadderTiers($challenge['id']);
            $currentBalance = (float)($challenge['current_balance'] ?? 0);
            $currentTierPct = $this->ladderLookup($tiers, $currentBalance);
            $maxDd = (float)($challenge['max_drawdown_pct'] ?? 0);
            $starting = (float)($challenge['starting_balance'] ?? 0);
            if ($currentTierPct !== null && $currentTierPct > 0 && $maxDd > 0 && $starting > 0) {
                $usedDollars = $starting * staticDrawdownPct($challenge) / 100;
                $allowanceDollars = $starting * $maxDd / 100;
                $remainingRoom = max(0, $allowanceDollars - $usedDollars);
                $riskDollarsAtCurrentTier = $currentBalance * $currentTierPct / 100;
                $consecutiveStopsToFailure = $riskDollarsAtCurrentTier > 0 ? round($remainingRoom / $riskDollarsAtCurrentTier, 1) : null;
            }
        }

        return [
            'dollars_per_R_winners' => $dprWinners ?? $NA,
            'dollars_per_R_losers'  => $dprLosers ?? $NA,
            'size_skew'             => $sizeSkew ?? $NA,
            'resolved_n'            => count($resolved),
            'total_R'               => $totalR,
            'total_dollars'         => $totalDollars,
            'ladder_adherence_rate' => $ladderAdherence ?? $NA,
            'tier_breach_count'     => $sizedN > 0 ? $breachCount : $NA,
            'tier_breach_by_month'  => $breachByMonth,
            'worst_deviation'       => $worstDeviation ?? $NA,
            'deviation_by_month'    => $deviationByMonth,
            'over_tier_count'       => $sizedN > 0 ? $overTierCount : $NA,
            'under_tier_count'      => $sizedN > 0 ? $underTierCount : $NA,
            'sized_n'               => $sizedN,
            'current_tier_pct'      => $currentTierPct ?? $NA,
            'consecutive_stops_to_failure' => $consecutiveStopsToFailure ?? $NA,
        ];
    }

    private function getLadderTiers($challengeId) {
        $s = $this->db->prepare("SELECT lower_balance, upper_balance, risk_pct FROM risk_ladder_tiers WHERE challenge_id=? AND active=1 ORDER BY lower_balance ASC");
        $s->execute([$challengeId]);
        return $s->fetchAll();
    }

    private function ladderLookup($tiers, $balance) {
        foreach ($tiers as $t) {
            $lower = (float)$t['lower_balance'];
            $upper = $t['upper_balance'] !== null ? (float)$t['upper_balance'] : null;
            if ($balance >= $lower && ($upper === null || $balance < $upper)) return (float)$t['risk_pct'];
        }
        return null;
    }

    /** "2026-07" -> "July 2026", for the month-named breach lists added in v3.16.0. */
    private function monthLabel($ym) {
        $d = DateTime::createFromFormat('Y-m-d', "$ym-01");
        return $d ? $d->format('F Y') : $ym;
    }

    /**
     * v3.16.0 Phase 2 metrics: Repetition, Exit Quality, Edge (recorded/estimated split),
     * Cost, and Geometry. Every figure with an empty denominator returns 'UNAVAILABLE',
     * same convention as computeSizeIntegrityMetrics().
     *
     * fee_drag_R / fee_drag_pct and purchased_ratio / live_boundary_ratio / ratio_drift
     * are not given explicit formulas anywhere in the briefings this was built from —
     * only their conditions and message templates. Derived here, documented in CLAUDE.md
     * v3.16.0: fee_drag_R converts the average fee into the same $-per-R unit
     * dollars_per_R_winners already uses elsewhere on this account (how many R a typical
     * fee costs); fee_drag_pct is the average fee as a % of the average winning trade;
     * purchased_ratio is profit_target_amt ÷ max_loss_amt at the challenge's own stated
     * terms; live_boundary_ratio is the same ratio recomputed against what's actually
     * left — remaining distance to target ÷ remaining room before max loss — at the
     * account's current balance.
     */
    private function computePhase2Metrics($closed, $allTrades, $challenge, $sizeMetrics) {
        $NA = 'UNAVAILABLE';
        $totalN = count($allTrades);

        // ── Repetition ───────────────────────────────────────
        $cleanRepTrades = array_values(array_filter($allTrades, fn($t) => (int)($t['clean_rep'] ?? 0) === 1));
        $cleanReps = count($cleanRepTrades);
        $cleanRepIds = $cleanRepTrades ? implode(', ', array_map(fn($t) => '#' . $t['id'], $cleanRepTrades)) : '';

        $fieldLabels = ['stop_loss' => 'Stop Loss', 'take_profit' => 'Take Profit', 'setup_grade' => 'Setup Grade', 'emotion_tag' => 'Emotion Tag'];
        $fieldCompleteness = [];
        foreach ($fieldLabels as $col => $label) {
            $filled = count(array_filter($allTrades, fn($t) => isset($t[$col]) && $t[$col] !== null && $t[$col] !== ''));
            $fieldCompleteness[$label] = $totalN > 0 ? round($filled / $totalN * 100, 1) : 0.0;
        }
        $weakestField = null; $weakestFieldPct = null;
        if ($fieldCompleteness) {
            asort($fieldCompleteness);
            $weakestField = array_key_first($fieldCompleteness);
            $weakestFieldPct = $fieldCompleteness[$weakestField];
        }

        // ── Exit Quality ─────────────────────────────────────
        // v3.16.1 A3(a): 'target_hit_short' renamed to 'target_hit_sub_gate' -- 2.35R
        // average is not a "short" outcome, it's the account's best-performing bucket
        // (+$665.62, the largest single contributor). The 2.5 gate threshold is
        // unchanged (gate 5 still requires >=3:1 structurally) but the label no longer
        // implies these trades were errors, because verified against live data they were
        // the opposite. See 2026_09_1?_000?_rename_target_hit_short.sql.
        $targetHitValid   = array_values(array_filter($closed, fn($t) => ($t['exit_quality'] ?? null) === 'target_hit_valid'));
        $targetHitSubGate = array_values(array_filter($closed, fn($t) => ($t['exit_quality'] ?? null) === 'target_hit_sub_gate'));
        $stoppedShort     = array_values(array_filter($closed, fn($t) => ($t['exit_quality'] ?? null) === 'stopped_short'));
        $unknownExitClosed = array_values(array_filter($closed, fn($t) => ($t['exit_quality'] ?? null) === null || ($t['exit_quality'] ?? null) === 'unknown'));
        $unknownExitAll    = array_values(array_filter($allTrades, fn($t) => ($t['exit_quality'] ?? null) === null || ($t['exit_quality'] ?? null) === 'unknown'));

        // A1: EXIT_TARGET_SHORT now fires on stopped_short ONLY. The prior version
        // (v3.16.0) also folded in target_hit_sub_gate and claimed "targets placed at
        // ~1R" -- that number came from three estimated-R rows (gross P&L / risk_amount,
        // which "carries no information" per this account's own estimated-R audit) and
        // was wrong: the four target_hit_sub_gate trades actually averaged 2.343R and
        // returned +$665.62. avg_stopped_short_target_r is target_r (planned geometry),
        // not r_multiple (realized outcome) -- a stopped trade's r_multiple is ~-1
        // regardless of what the target was aimed at; target_r is the number that
        // describes the mistake.
        $stoppedShortN = count($stoppedShort);
        $avgStoppedShortTargetR = $stoppedShortN > 0 ? round(array_sum(array_map(fn($t) => (float)($t['target_r'] ?? 0), $stoppedShort)) / $stoppedShortN, 2) : null;

        // A2: EXIT_NO_TARGET -- the largest, previously-unreported finding. unknown_n/
        // unknown_pnl/unknown_per_trade are computed over $closed (a trade with no final
        // P&L can't contribute to a dollar figure), while unknown_pct keeps the $allTrades
        // denominator EXIT_QUALITY_UNKNOWN already used, so an open trade still counts
        // against "how much of the account's activity has unknown geometry" even though
        // it can't yet contribute a dollar amount.
        $unknownN = count($unknownExitClosed);
        $unknownPnl = round(array_sum(array_map(fn($t) => (float)($t['net_pnl'] ?? 0), $unknownExitClosed)), 2);
        $unknownPerTrade = $unknownN > 0 ? round($unknownPnl / $unknownN, 2) : null;
        $unknownPct = $totalN > 0 ? round(count($unknownExitAll) / $totalN * 100, 1) : 0.0;

        $validN = count($targetHitValid);
        $avgValidR = $validN > 0 ? round(array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $targetHitValid)) / $validN, 2) : null;

        // ── Edge (recorded vs. estimated R) ───────────────────
        $recorded  = array_values(array_filter($closed, fn($t) => ($t['r_multiple_source'] ?? null) !== 'estimated'));
        $estimated = array_values(array_filter($closed, fn($t) => ($t['r_multiple_source'] ?? null) === 'estimated'));
        $recordedN = count($recorded); $estimatedN = count($estimated);
        $expectancyRecordedR = $recordedN > 0 ? round(array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $recorded)) / $recordedN, 2) : null;
        $pnlPerTrade = $recordedN > 0 ? round(array_sum(array_map(fn($t) => (float)($t['net_pnl'] ?? 0), $recorded)) / $recordedN, 2) : null;

        $resolvedForEdge = array_values(array_filter($closed, fn($t) => in_array($t['exit_reason'] ?? null, ['Take Profit', 'Stop Loss'], true)));
        $manualForEdge   = array_values(array_filter($closed, fn($t) => ($t['exit_reason'] ?? null) === 'Manual Closing'));
        $resolvedEdgeN = count($resolvedForEdge); $intervenedN = count($manualForEdge);
        $avgPnlResolved = $resolvedEdgeN > 0 ? round(array_sum(array_map(fn($t) => (float)($t['net_pnl'] ?? 0), $resolvedForEdge)) / $resolvedEdgeN, 2) : null;
        $avgPnlManual   = $intervenedN > 0 ? round(array_sum(array_map(fn($t) => (float)($t['net_pnl'] ?? 0), $manualForEdge)) / $intervenedN, 2) : null;

        // ── Cost ───────────────────────────────────────────────
        $totalFeesTrades = round(array_sum(array_map(fn($t) => (float)($t['fees'] ?? 0), $closed)), 2);
        $fundingAdj = $challenge ? round((float)($challenge['funding_adjustment'] ?? 0), 2) : 0.0;
        $totalFees = round($totalFeesTrades + $fundingAdj, 2);
        $tradingPnl = round(array_sum(array_map(fn($t) => (float)($t['pnl'] ?? 0), $closed)), 2);
        $tradingPnlAbs = abs($tradingPnl);

        $avgFeePerTrade = count($closed) > 0 ? ($totalFeesTrades / count($closed)) : null;
        $dprWinners = is_numeric($sizeMetrics['dollars_per_R_winners'] ?? null) ? (float)$sizeMetrics['dollars_per_R_winners'] : null;
        $feeDragR = ($avgFeePerTrade !== null && $dprWinners !== null && $dprWinners > 0) ? round($avgFeePerTrade / $dprWinners, 3) : null;

        $winsForDrag = array_values(array_filter($closed, fn($t) => $t['result'] === 'Win'));
        $avgWinDollars = $winsForDrag ? array_sum(array_map(fn($t) => (float)($t['net_pnl'] ?? 0), $winsForDrag)) / count($winsForDrag) : null;
        $feeDragPct = ($avgFeePerTrade !== null && $avgWinDollars !== null && $avgWinDollars > 0) ? round($avgFeePerTrade / $avgWinDollars * 100, 1) : null;

        $tradesFlipped = count(array_filter($closed, fn($t) => (float)($t['pnl'] ?? 0) > 0 && (float)($t['net_pnl'] ?? 0) < 0));

        // ── Geometry ─────────────────────────────────────────
        $purchasedRatio = null; $liveBoundaryRatio = null; $ratioDrift = null;
        if ($challenge) {
            $target = (float)($challenge['profit_target_amt'] ?? 0);
            $maxLoss = (float)($challenge['max_loss_amt'] ?? 0);
            if ($target > 0 && $maxLoss > 0) {
                $purchasedRatio = round($target / $maxLoss, 3);
                $netChange = (float)($challenge['current_balance'] ?? 0) - (float)($challenge['starting_balance'] ?? 0);
                $remainingToTarget = $target - $netChange;
                $remainingToFailure = $maxLoss + $netChange;
                if ($remainingToFailure > 0 && $purchasedRatio > 0) {
                    $liveBoundaryRatio = round($remainingToTarget / $remainingToFailure, 3);
                    $ratioDrift = round($liveBoundaryRatio / $purchasedRatio, 3);
                }
            }
        }

        return [
            // Repetition
            'clean_reps' => $cleanReps, 'total_n' => $totalN, 'clean_rep_ids' => $cleanRepIds,
            'field_completeness' => $weakestFieldPct ?? $NA, 'weakest_field' => $weakestField ?? $NA, 'weakest_field_pct' => $weakestFieldPct ?? $NA,
            // Exit Quality
            'stopped_short_n' => $stoppedShortN, 'avg_stopped_short_target_r' => $avgStoppedShortTargetR ?? $NA,
            'target_hit_sub_gate_n' => count($targetHitSubGate),
            'unknown_n' => $unknownN, 'unknown_pnl' => $unknownPnl, 'unknown_per_trade' => $unknownPerTrade ?? $NA,
            'unknown_pct' => $unknownPct, 'valid_n' => $validN, 'avg_valid_r' => $avgValidR ?? $NA,
            // Edge
            'recorded_n' => $recordedN, 'estimated_n' => $estimatedN,
            'expectancy_recorded_R' => $expectancyRecordedR ?? $NA, 'pnl_per_trade' => $pnlPerTrade ?? $NA,
            'avg_pnl_resolved' => $avgPnlResolved ?? $NA, 'avg_pnl_manual' => $avgPnlManual ?? $NA,
            'resolved_n' => $resolvedEdgeN, 'intervened_n' => $intervenedN,
            // Cost
            'total_fees' => $totalFees, 'trading_pnl' => $tradingPnl, 'trading_pnl_abs' => $tradingPnlAbs,
            'fee_drag_R' => $feeDragR ?? $NA, 'fee_drag_pct' => $feeDragPct ?? $NA, 'trades_flipped' => $tradesFlipped,
            // Geometry
            'purchased_ratio' => $purchasedRatio ?? $NA, 'live_boundary_ratio' => $liveBoundaryRatio ?? $NA, 'ratio_drift' => $ratioDrift ?? $NA,
        ];
    }

    /**
     * % of a closed-trade set whose r_multiple is reconstructed rather than recorded
     * (see 2026_09_17_0002_import_bitfunded_altcoin_trades.sql — imported rows have no
     * stop-loss price on file, so their R is a risk-unit estimate, not a fact). NULL
     * r_multiple_source (every pre-v3.12.0 manually-logged trade) counts as recorded —
     * this column only exists to flag reconstruction, not to cast doubt on the default.
     */
    private function rEstimatedPct($trades) {
        $n = count($trades);
        if ($n === 0) return 0;
        $estimated = count(array_filter($trades, fn($t) => ($t['r_multiple_source'] ?? null) === 'estimated'));
        return round($estimated / $n * 100, 1);
    }

    /**
     * Appended to an insight's detail text when its R-based claim rests on a set that's
     * majority reconstructed R — so an estimated figure is never read as confidently as a
     * recorded one (CLAUDE.md v3.12.0: "no r_multiple_source='estimated' row presented
     * anywhere as a confident figure"). Below 50% estimated, the recorded majority carries
     * the claim and no caveat is added.
     */
    private function rCaveat($trades) {
        $pct = $this->rEstimatedPct($trades);
        if ($pct < 50) return '';
        return " ({$pct}% of these R multiples are reconstructed from risk-unit estimates, not a recorded stop-loss — treat as directional, not exact.)";
    }

    private function groupStats($trades, callable $keyFn) {
        $groups = [];
        foreach ($trades as $t) {
            $k = $keyFn($t);
            if ($k === null || $k === '') continue;
            if (!isset($groups[$k])) $groups[$k] = ['n' => 0, 'wins' => 0, 'rsum' => 0.0, 'pnl' => 0.0];
            $groups[$k]['n']++;
            if ($t['result'] === 'Win') $groups[$k]['wins']++;
            $groups[$k]['rsum'] += (float)($t['r_multiple'] ?? 0);
            $groups[$k]['pnl'] += (float)($t['net_pnl'] ?? 0);
        }
        foreach ($groups as &$g) {
            $g['win_rate'] = $g['n'] > 0 ? round($g['wins'] / $g['n'] * 100, 1) : 0;
            $g['avg_r'] = $g['n'] > 0 ? round($g['rsum'] / $g['n'], 2) : 0;
            $g['pnl'] = round($g['pnl'], 2);
        }
        return $groups;
    }

    private function insight($severity, $category, $headline, $detail, $recommendation, $n, $min) {
        $conclusive = $n >= $min;
        if (!$conclusive) {
            $headline = "Early signal: $headline";
            $detail .= " (Early signal — only $n trades, not yet conclusive. Keep logging to confirm.)";
        }
        return [
            'severity' => $severity, 'category' => $category,
            'headline' => $headline, 'detail' => $detail, 'recommendation' => $recommendation,
            'based_on_n' => $n, 'conclusive' => $conclusive,
        ];
    }

    // ── A. DISCIPLINE / RULE ADHERENCE ──────────────────────

    private function ruleFullRuleVsCutCorner($closed) {
        $out = [];
        $tagged = array_values(array_filter($closed, fn($t) => $t['fsa_rules'] !== null && $t['fsa_rules'] !== ''));
        if (!$tagged) return $out;
        $all5 = array_values(array_filter($tagged, fn($t) => $t['fsa_rules'] === 'All 5'));
        $cut = array_values(array_filter($tagged, fn($t) => $t['fsa_rules'] !== 'All 5'));
        $allN = count($all5); $cutN = count($cut);

        if ($allN > 0 && $cutN > 0) {
            $allWin = round(count(array_filter($all5, fn($t) => $t['result'] === 'Win')) / $allN * 100, 1);
            $cutWin = round(count(array_filter($cut, fn($t) => $t['result'] === 'Win')) / $cutN * 100, 1);
            if ($allWin - $cutWin >= 15) {
                $out[] = $this->insight('good', 'discipline',
                    'Following all rules is measurably working.',
                    "Trades marked 'All 5' win $allWin% vs $cutWin% when a rule was cut.",
                    'Keep enforcing full-checklist discipline before entry.',
                    $allN + $cutN, self::MIN_RULE_ADHERENCE * 2);
            }
        }
        $totalTagged = count($tagged);
        if ($totalTagged > 0 && $cutN / $totalTagged >= 0.3) {
            $pct = round($cutN / $totalTagged * 100, 1);
            $out[] = $this->insight('watch', 'discipline',
                "You cut at least one rule on $pct% of trades.",
                "$cutN of $totalTagged rule-tagged trades were not 'All 5'.",
                'Tighten pre-entry checklist enforcement.',
                $totalTagged, self::MIN_RULE_VOLUME);
        }
        return $out;
    }

    private function ruleSetupGradeVsOutcome($closed) {
        $graded = array_values(array_filter($closed, fn($t) => $t['setup_grade'] !== null && $t['setup_grade'] !== ''));
        $a = array_values(array_filter($graded, fn($t) => $t['setup_grade'] === 'A'));
        $c = array_values(array_filter($graded, fn($t) => $t['setup_grade'] === 'C'));
        if (!$a || !$c) return [];
        $aN = count($a); $cN = count($c);
        $aWin = round(count(array_filter($a, fn($t) => $t['result'] === 'Win')) / $aN * 100, 1);
        $cWin = round(count(array_filter($c, fn($t) => $t['result'] === 'Win')) / $cN * 100, 1);
        $n = $aN + $cN;
        if ($aWin <= $cWin) {
            return [$this->insight('alert', 'discipline',
                'Your setup grading may be off.',
                "A-graded setups win $aWin% vs C-graded at $cWin% — A isn't outperforming C.",
                'Re-examine what makes you call a setup "A" — the grading criteria may not track real edge.',
                $n, self::MIN_GRADE * 2)];
        }
        return [$this->insight('good', 'discipline',
            'Your setup grading has edge.',
            "A-setups win $aWin% vs C-setups $cWin%.",
            'Trust your A-grade filter — consider skipping C-grade setups entirely.',
            $n, self::MIN_GRADE * 2)];
    }

    private function ruleVariableAttribution($closed) {
        $counts = [];
        foreach ($closed as $t) {
            if (!empty($t['strategy_id'])) $counts[$t['strategy_id']] = ($counts[$t['strategy_id']] ?? 0) + 1;
        }
        if (!$counts) return [];
        arsort($counts);
        $strategyId = array_key_first($counts);
        $strategyTrades = array_values(array_filter($closed, fn($t) => $t['strategy_id'] == $strategyId));
        $tradeIds = array_column($strategyTrades, 'id');
        if (!$tradeIds) return [];

        $vs = $this->db->prepare("SELECT id,label,input_type FROM strategy_variables WHERE strategy_id=? ORDER BY sort_order ASC, id ASC");
        $vs->execute([$strategyId]);
        $variables = $vs->fetchAll();
        if (!$variables) return [];

        $placeholders = implode(',', array_fill(0, count($tradeIds), '?'));
        $tv = $this->db->prepare("SELECT trade_id,variable_id,value FROM trade_variables WHERE trade_id IN ($placeholders)");
        $tv->execute($tradeIds);
        $tvRows = $tv->fetchAll();

        $resultMap = [];
        foreach ($strategyTrades as $t) $resultMap[$t['id']] = $t['result'];

        $byVar = [];
        foreach ($tvRows as $row) {
            $val = ($row['value'] === null || $row['value'] === '') ? '(blank)' : $row['value'];
            $byVar[$row['variable_id']][$val]['total'] = ($byVar[$row['variable_id']][$val]['total'] ?? 0) + 1;
            if (($resultMap[$row['trade_id']] ?? '') === 'Win') {
                $byVar[$row['variable_id']][$val]['wins'] = ($byVar[$row['variable_id']][$val]['wins'] ?? 0) + 1;
            }
        }

        $out = [];
        $biggestDriver = null; $biggestSpread = -1; $biggestVarLabel = null; $biggestWinVal = null; $biggestWinRate = null;

        foreach ($variables as $v) {
            $groups = $byVar[$v['id']] ?? [];
            $qualifying = [];
            foreach ($groups as $val => $g) {
                if ($g['total'] >= self::MIN_VAR) {
                    $rate = round((($g['wins'] ?? 0) / $g['total']) * 100, 1);
                    $qualifying[$val] = ['rate' => $rate, 'n' => $g['total']];
                }
            }
            if (count($qualifying) < 2) continue;
            $rates = array_column($qualifying, 'rate');
            $spread = max($rates) - min($rates);

            // presence-correlates-with-lower-win-rate check (checkbox variables)
            if ($v['input_type'] === 'checkbox') {
                $yesKeys = array_intersect(array_keys($qualifying), ['yes','Yes','true','True','1','checked']);
                $noKeys = array_intersect(array_keys($qualifying), ['no','No','false','False','0','(blank)']);
                if ($yesKeys && $noKeys) {
                    $yesRate = $qualifying[reset($yesKeys)]['rate'];
                    $noRate = $qualifying[reset($noKeys)]['rate'];
                    if ($noRate - $yesRate >= 15) {
                        $n = $qualifying[reset($yesKeys)]['n'] + $qualifying[reset($noKeys)]['n'];
                        $out[] = $this->insight('alert', 'strategy',
                            "'{$v['label']}' correlates with a lower win rate when present.",
                            "Present: $yesRate% win. Absent: $noRate% win — a " . round($noRate - $yesRate, 1) . "pt drop.",
                            "Re-examine why '{$v['label']}' is hurting outcomes instead of helping.",
                            $n, self::MIN_VAR * 2);
                    }
                }
            }

            if ($spread > $biggestSpread) {
                $biggestSpread = $spread;
                $biggestDriver = $v['id'];
                $biggestVarLabel = $v['label'];
                $topVal = null;
                foreach ($qualifying as $val => $stat) {
                    if ($topVal === null || $stat['rate'] > $qualifying[$topVal]['rate']) $topVal = $val;
                }
                $biggestWinVal = $topVal;
                $biggestWinRate = $qualifying[$topVal]['rate'];
                $biggestN = array_sum(array_column($qualifying, 'n'));
            }
        }

        if ($biggestDriver !== null && $biggestSpread >= 15) {
            $out[] = $this->insight('good', 'strategy',
                "Biggest driver: '{$biggestVarLabel}'.",
                "'{$biggestVarLabel}' = {$biggestWinVal} wins {$biggestWinRate}% — the largest win-rate spread of any tracked variable ({$biggestSpread}pt).",
                "Make '{$biggestVarLabel} = {$biggestWinVal}' a hard requirement before entry.",
                $biggestN ?? self::MIN_VAR, self::MIN_VAR * 2);
        }

        return $out;
    }

    // ── B. RISK BEHAVIOR ─────────────────────────────────────

    private function ruleRiskCreep($closed) {
        $withRisk = array_values(array_filter($closed, fn($t) => $t['risk_amount'] !== null && $t['risk_amount'] !== ''));
        if (count($withRisk) < 4) return [];
        $half = intdiv(count($withRisk), 2);
        $first = array_slice($withRisk, 0, $half);
        $second = array_slice($withRisk, $half);
        $avg1 = array_sum(array_column($first, 'risk_amount')) / count($first);
        $avg2 = array_sum(array_column($second, 'risk_amount')) / count($second);
        if ($avg1 <= 0) return [];
        $pctUp = ($avg2 - $avg1) / $avg1 * 100;
        if ($pctUp > 25) {
            return [$this->insight('alert', 'risk',
                'Your position sizing is drifting up — risk creep.',
                'Avg risk per trade was $' . round($avg1, 2) . ' in the first half of the period vs $' . round($avg2, 2) . ' in the second half (+' . round($pctUp, 1) . '%).',
                'Re-anchor position size to your plan, not your recent results.',
                count($withRisk), self::MIN_RISK_CREEP)];
        }
        return [];
    }

    private function ruleOversizedTrades($closed, $challengeMap) {
        $flagged = [];
        foreach ($closed as $t) {
            if ($t['risk_amount'] === null || $t['risk_amount'] === '' || empty($t['challenge_id'])) continue;
            $ch = $challengeMap[$t['challenge_id']] ?? null;
            if (!$ch) continue;
            $risk = (float)$t['risk_amount'];
            $dailyLimit = (float)($ch['daily_loss_limit'] ?? 0);
            $threshold = ((float)($ch['risk_per_trade_pct'] ?? 0) / 100) * (float)($ch['starting_balance'] ?? 0) * 1.5;
            if (($dailyLimit > 0 && $risk > $dailyLimit) || ($threshold > 0 && $risk > $threshold)) {
                $flagged[] = $t['trade_date'];
            }
        }
        if (!$flagged) return [];
        $dates = implode(', ', array_slice(array_unique($flagged), 0, 6));
        return [[
            'severity' => 'alert', 'category' => 'risk',
            'headline' => count($flagged) . ' trade(s) sized well above plan.',
            'detail' => "Risk exceeded the daily loss limit or 1.5x planned risk-per-trade on: $dates.",
            'recommendation' => 'Recalculate position size from stop distance before every entry — do not size from conviction.',
            'based_on_n' => count($flagged), 'conclusive' => true,
        ]];
    }

    private function rulePostLossSizing($trades) {
        $withRisk = array_values(array_filter($trades, fn($t) => $t['risk_amount'] !== null && $t['risk_amount'] !== ''));
        if (count($withRisk) < 2) return [];
        $postLoss = []; $baseline = [];
        for ($i = 1; $i < count($withRisk); $i++) {
            if ($withRisk[$i - 1]['result'] === 'Loss') {
                $postLoss[] = (float)$withRisk[$i]['risk_amount'];
            } else {
                $baseline[] = (float)$withRisk[$i]['risk_amount'];
            }
        }
        if (count($postLoss) < 1 || !$baseline) return [];
        $avgPost = array_sum($postLoss) / count($postLoss);
        $avgBase = array_sum($baseline) / count($baseline);
        if ($avgBase <= 0) return [];
        $pctUp = ($avgPost - $avgBase) / $avgBase * 100;
        if ($pctUp > 25) {
            return [$this->insight('alert', 'risk',
                'You size UP after losses — classic revenge risk.',
                'Avg risk on the trade right after a loss is $' . round($avgPost, 2) . ' vs a baseline of $' . round($avgBase, 2) . ' (+' . round($pctUp, 1) . '%).',
                'Set a hard rule: risk size never changes based on the last result.',
                count($postLoss), self::MIN_POST_LOSS)];
        }
        return [];
    }

    // ── C. REVENGE / TILT / TIMING ──────────────────────────

    private function ruleRevengeTrades($trades) {
        $byDay = [];
        foreach ($trades as $t) {
            if (empty($t['time_in'])) continue;
            $byDay[$t['trade_date']][] = $t;
        }
        $revenge = [];
        foreach ($byDay as $date => $dayTrades) {
            usort($dayTrades, fn($a, $b) => strcmp($a['time_in'], $b['time_in']));
            for ($i = 1; $i < count($dayTrades); $i++) {
                $prev = $dayTrades[$i - 1];
                $curr = $dayTrades[$i];
                if ($prev['result'] !== 'Loss' || empty($prev['time_out'])) continue;
                $prevOut = strtotime($date . ' ' . $prev['time_out']);
                $currIn = strtotime($date . ' ' . $curr['time_in']);
                if ($prevOut === false || $currIn === false) continue;
                $diffMin = ($currIn - $prevOut) / 60;
                if ($diffMin >= 0 && $diffMin <= 30) $revenge[] = $curr;
            }
        }
        if (!$revenge) return [];
        $closedRevenge = array_values(array_filter($revenge, fn($t) => in_array($t['result'], ['Win','Loss','Break Even'], true)));
        $winN = count(array_filter($closedRevenge, fn($t) => $t['result'] === 'Win'));
        $winRate = $closedRevenge ? round($winN / count($closedRevenge) * 100, 1) : null;
        $detail = $winRate !== null
            ? "You took " . count($revenge) . " revenge trade(s) (entered within 30 min of a loss). Their win rate: $winRate%."
            : "You took " . count($revenge) . " revenge trade(s) (entered within 30 min of a loss); none are closed yet.";
        return [$this->insight('alert', 'psychology',
            'You took ' . count($revenge) . ' revenge trade(s).',
            $detail,
            'Enforce a mandatory cooldown timer after any loss before the next entry.',
            count($closedRevenge), self::MIN_REVENGE)];
    }

    private function ruleLossStreakTilt($closed) {
        $tiltZone = []; $baseline = []; $streak = 0;
        foreach ($closed as $t) {
            if ($streak >= 3) $tiltZone[] = $t; else $baseline[] = $t;
            $streak = ($t['result'] === 'Loss') ? $streak + 1 : 0;
        }
        if (count($tiltZone) < 1 || !$baseline) return [];
        $tiltWin = round(count(array_filter($tiltZone, fn($t) => $t['result'] === 'Win')) / count($tiltZone) * 100, 1);
        $baseWin = round(count(array_filter($baseline, fn($t) => $t['result'] === 'Win')) / count($baseline) * 100, 1);
        if ($tiltWin >= $baseWin) return [];
        $drop = $baseWin - $tiltWin;
        $severity = $drop >= 15 ? 'alert' : 'watch';
        return [$this->insight($severity, 'psychology',
            'Trades taken during a 3+ loss streak underperform.',
            "Win rate during/after a loss streak of 3+: $tiltWin% vs $baseWin% baseline.",
            'Consider a hard stop after 3 consecutive losses for the rest of the day.',
            count($tiltZone), self::MIN_TILT)];
    }

    private function ruleOvertrading($challengeId, $periodTrades) {
        // v3.20.0 — same reasoning as listPeriods()/fetchTrades() above.
        if ($challengeId) {
            $s = $this->db->prepare("SELECT trade_date, COUNT(*) c FROM trades WHERE user_id=? AND challenge_id=? GROUP BY trade_date");
            $s->execute([$this->uid, $challengeId]);
        } else {
            $s = $this->db->prepare("SELECT trade_date, COUNT(*) c FROM trades WHERE user_id=? AND source != 'backtest' GROUP BY trade_date");
            $s->execute([$this->uid]);
        }
        $allDays = $s->fetchAll();
        if (count($allDays) < self::MIN_MEDIAN_DAYS) return [];
        $counts = array_map('intval', array_column($allDays, 'c'));
        sort($counts);
        $mid = intdiv(count($counts), 2);
        $median = (count($counts) % 2 === 0) ? ($counts[$mid - 1] + $counts[$mid]) / 2 : $counts[$mid];
        if ($median <= 0) return [];

        $periodByDay = [];
        foreach ($periodTrades as $t) $periodByDay[$t['trade_date']] = ($periodByDay[$t['trade_date']] ?? 0) + 1;
        $flaggedDays = array_filter($periodByDay, fn($c) => $c >= $median * 2);
        if (!$flaggedDays) return [];

        return [[
            'severity' => 'alert', 'category' => 'discipline',
            'headline' => count($flaggedDays) . ' day(s) this period you traded 2x your normal volume.',
            'detail' => 'Your all-time median is ' . $median . ' trades/day. Days over 2x that: ' . implode(', ', array_keys($flaggedDays)) . '.',
            'recommendation' => 'Overtrading tends to follow emotion, not setups — set a hard daily trade cap.',
            'based_on_n' => array_sum($flaggedDays), 'conclusive' => true,
        ]];
    }

    private function ruleTimeOfDayLeak($closed) {
        $out = [];
        $bySession = $this->groupStats($closed, fn($t) => $t['session']);
        $out = array_merge($out, $this->leakFromGroups($bySession, 'session'));

        $byHour = $this->groupStats($closed, function ($t) {
            if (empty($t['time_in'])) return null;
            $ts = strtotime($t['trade_date'] . ' ' . $t['time_in']);
            return $ts === false ? null : date('G:00', $ts);
        });
        $out = array_merge($out, $this->leakFromGroups($byHour, 'hour'));
        return $out;
    }

    private function leakFromGroups($groups, $label) {
        $qualifying = array_filter($groups, fn($g) => $g['n'] >= self::MIN_SESSION);
        if (count($qualifying) < 2) return [];
        $best = null; $worst = null;
        foreach ($qualifying as $key => $g) {
            if ($best === null || $g['win_rate'] > $qualifying[$best]['win_rate']) $best = $key;
            if ($worst === null || $g['win_rate'] < $qualifying[$worst]['win_rate']) $worst = $key;
        }
        if ($best === $worst) return [];
        $gap = $qualifying[$best]['win_rate'] - $qualifying[$worst]['win_rate'];
        if ($gap < 15) return [];
        $n = $qualifying[$best]['n'] + $qualifying[$worst]['n'];
        return [$this->insight('watch', 'timing',
            "Your $worst $label trades underperform your $best $label trades.",
            "$worst wins {$qualifying[$worst]['win_rate']}% vs $best at {$qualifying[$best]['win_rate']}%.",
            "Consider cutting or reducing size during the $worst window.",
            $n, self::MIN_SESSION * 2)];
    }

    // ── D. PSYCHOLOGY ────────────────────────────────────────

    private function ruleEmotionOutcome($closed) {
        $tagged = array_values(array_filter($closed, fn($t) => $t['emotion_tag'] !== null && $t['emotion_tag'] !== ''));
        if (!$tagged) return [];
        $groups = $this->groupStats($tagged, fn($t) => $t['emotion_tag']);
        $overall = round(count(array_filter($tagged, fn($t) => $t['result'] === 'Win')) / count($tagged) * 100, 1);
        $totalTagged = count($tagged);

        $qualifying = array_filter($groups, fn($g) => $g['n'] >= self::MIN_EMOTION);
        if (!$qualifying) return [];

        $out = [];
        $worstKey = null; $bestKey = null;
        foreach ($qualifying as $key => $g) {
            if ($worstKey === null || $g['win_rate'] < $qualifying[$worstKey]['win_rate']) $worstKey = $key;
            if ($bestKey === null || $g['win_rate'] > $qualifying[$bestKey]['win_rate']) $bestKey = $key;
        }
        // Groups are keyed by the raw emotion_tag code (old or new set, never mixed
        // together — groupStats groups by exact string) so an old and new code that
        // feel similar (e.g. legacy 'itchy' and current 'impatient') are never silently
        // merged. emotionLabel() only affects how the code reads in the insight text.
        if ($worstKey !== null) {
            $w = $qualifying[$worstKey];
            $worstLabel = emotionLabel($worstKey);
            if (($overall - $w['win_rate'] >= 15) && ($w['n'] / $totalTagged > 0.15)) {
                $out[] = $this->insight('alert', 'psychology',
                    "Trades tagged '$worstLabel' are your most costly state.",
                    "'$worstLabel' wins {$w['win_rate']}% vs $overall% overall, across {$w['n']} trades.",
                    "Add a rule: no entry while feeling '$worstLabel' — walk away instead.",
                    $w['n'], self::MIN_EMOTION * 2);
            }
        }
        if ($bestKey !== null && $bestKey !== $worstKey) {
            $b = $qualifying[$bestKey];
            $bestLabel = emotionLabel($bestKey);
            if ($b['win_rate'] - $overall >= 10) {
                $out[] = $this->insight('good', 'psychology',
                    "You perform best when '$bestLabel'.",
                    "'$bestLabel' wins {$b['win_rate']}% vs $overall% overall, across {$b['n']} trades.",
                    "Build a pre-trade routine that gets you into the '$bestLabel' state before entry.",
                    $b['n'], self::MIN_EMOTION * 2);
            }
        }
        return $out;
    }

    private function ruleNegativeStateFrequency($closed) {
        $tagged = array_values(array_filter($closed, fn($t) => $t['emotion_tag'] !== null && $t['emotion_tag'] !== ''));
        if (!$tagged) return [];
        // "Reactive" here means an impulsive/undisciplined ENTRY, the same scope the
        // original (pre-v3.10.0) rule measured — it deliberately excluded the old
        // 'anxious'/'unsure' (fear-driven hesitation, opposite character) and 'overconf'
        // (a separate concern), so their v3.10.0 successors ('hesitant', 'invincible')
        // stay excluded here too. 'hoping'/'wanting_out'/'greedy' are in-trade/exit
        // states with no entry-reactivity equivalent in the old set — out of scope for
        // this rule, not silently folded in. Both the retired codes and their current
        // equivalents are included so this keeps working on a mix of old and new rows.
        $negative = ['itchy','fomo','revenge','bored', 'impatient','chasing','vengeful'];
        $negN = count(array_filter($tagged, fn($t) => in_array($t['emotion_tag'], $negative, true)));
        $pct = round($negN / count($tagged) * 100, 1);
        if ($pct > 40) {
            return [$this->insight('watch', 'psychology',
                "$pct% of your entries come from a reactive state, not patience.",
                "$negN of " . count($tagged) . " emotion-tagged trades were impatient, chasing, vengeful, or their legacy equivalents.",
                'Pause and name the emotion before you click — if it\'s reactive, skip the trade.',
                count($tagged), self::MIN_NEG_STATE)];
        }
        return [];
    }

    private function ruleNoteQuality($trades) {
        $withTime = array_values(array_filter($trades, fn($t) => !empty($t['time_in']) || !empty($t['trade_date'])));
        usort($withTime, fn($a, $b) => strcmp($a['trade_date'] . ($a['time_in'] ?? ''), $b['trade_date'] . ($b['time_in'] ?? '')));
        $last5 = array_slice($withTime, -5);
        if (count($last5) < 5) return [];

        $blank = fn($t) => empty(trim((string)($t['note_saw'] ?? ''))) && empty(trim((string)($t['note_why'] ?? '')));
        $allBlank = true;
        foreach ($last5 as $t) if (!$blank($t)) { $allBlank = false; break; }

        $sawVals = array_map(fn($t) => trim((string)($t['note_saw'] ?? '')), $last5);
        $whyVals = array_map(fn($t) => trim((string)($t['note_why'] ?? '')), $last5);
        $allSameSaw = $sawVals[0] !== '' && count(array_unique($sawVals)) === 1;
        $allSameWhy = $whyVals[0] !== '' && count(array_unique($whyVals)) === 1;

        if ($allBlank || $allSameSaw || $allSameWhy) {
            return [[
                'severity' => 'watch', 'category' => 'discipline',
                'headline' => 'Your last 5 notes are blank or repeated.',
                'detail' => 'Journaling on autopilot — the review is only as honest as the notes behind it.',
                'recommendation' => 'Write one real sentence for "what did I see" and "why" on every trade, even winners.',
                'based_on_n' => 5, 'conclusive' => true,
            ]];
        }
        return [];
    }

    // ── E. CONSISTENCY / OUTCOME QUALITY ────────────────────

    private function ruleWinrateExpectancySanity($closed) {
        $n = count($closed);
        if ($n < self::MIN_SANITY) return [];
        $wins = count(array_filter($closed, fn($t) => $t['result'] === 'Win'));
        $winRate = round($wins / $n * 100, 1);
        $avgWinR = $wins > 0 ? array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), array_filter($closed, fn($t) => $t['result'] === 'Win'))) / $wins : 0;
        $losses = $n - $wins - count(array_filter($closed, fn($t) => $t['result'] === 'Break Even'));
        $avgLossR = $losses > 0 ? array_sum(array_map(fn($t) => abs((float)($t['r_multiple'] ?? 0)), array_filter($closed, fn($t) => $t['result'] === 'Loss'))) / $losses : 0;
        $avgR = array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $closed)) / $n;
        if ($winRate >= 50 && $avgR < 0) {
            return [$this->insight('alert', 'consistency',
                'You win often but your losers are too big.',
                'Win rate ' . $winRate . '% but avg loss ' . round($avgLossR, 2) . 'R vs avg win ' . round($avgWinR, 2) . 'R — net expectancy is negative.' . $this->rCaveat($closed),
                'Cut losers faster or widen targets — your risk:reward is inverted relative to your win rate.',
                $n, self::MIN_SANITY)];
        }
        return [];
    }

    private function ruleBestWorstPair($closed) {
        $byPair = $this->groupStats($closed, fn($t) => $t['pair']);
        $qualifying = array_filter($byPair, fn($g) => $g['n'] >= self::MIN_PAIR);
        if (!$qualifying) return [];
        $out = [];
        $best = null; $worst = null;
        foreach ($qualifying as $key => $g) {
            if ($best === null || $g['pnl'] > $qualifying[$best]['pnl']) $best = $key;
            if ($worst === null || $g['pnl'] < $qualifying[$worst]['pnl']) $worst = $key;
        }
        if ($best !== null && $qualifying[$best]['pnl'] > 0) {
            $g = $qualifying[$best];
            $out[] = $this->insight('good', 'consistency',
                "$best is your strongest pair.",
                "$best: {$g['win_rate']}% win rate, net $" . $g['pnl'] . ' over ' . $g['n'] . ' trades.',
                "Consider allocating more size/focus to $best setups.",
                $g['n'], self::MIN_PAIR * 2);
        }
        if ($worst !== null && $worst !== $best && $qualifying[$worst]['pnl'] < 0) {
            $g = $qualifying[$worst];
            $out[] = $this->insight('watch', 'consistency',
                "$worst is dragging on your results.",
                "$worst: {$g['win_rate']}% win rate, net $" . $g['pnl'] . ' over ' . $g['n'] . ' trades.',
                "Review whether $worst fits your edge, or cut it.",
                $g['n'], self::MIN_PAIR * 2);
        }
        return $out;
    }

    private function ruleBreakEvenRate($closed) {
        $n = count($closed);
        if ($n === 0) return [];
        $bes = count(array_filter($closed, fn($t) => $t['result'] === 'Break Even'));
        $pct = round($bes / $n * 100, 1);
        if ($pct > 25) {
            return [$this->insight('watch', 'consistency',
                'A quarter or more of your trades scratch.',
                "$bes of $n trades ($pct%) closed at break even.",
                'Possible hesitation or premature exits — review whether you\'re giving trades room to work.',
                $n, self::MIN_SCRATCH)];
        }
        return [];
    }

    private function rulePeriodTrend($type, $periodStart, $challengeId, $closed) {
        [$prevStart, $prevEnd] = $this->previousPeriodBounds($type, $periodStart);
        $prevTrades = $this->fetchTrades($challengeId, $prevStart, $prevEnd);
        $prevClosed = array_values(array_filter($prevTrades, fn($t) => in_array($t['result'], ['Win','Loss','Break Even'], true)));

        $curN = count($closed); $prevN = count($prevClosed);
        if ($curN === 0 || $prevN === 0) return [];

        $curR = array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $closed)) / $curN;
        $prevR = array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $prevClosed)) / $prevN;
        $curWin = round(count(array_filter($closed, fn($t) => $t['result'] === 'Win')) / $curN * 100, 1);
        $prevWin = round(count(array_filter($prevClosed, fn($t) => $t['result'] === 'Win')) / $prevN * 100, 1);
        $delta = round($curR - $prevR, 2);

        $conclusive = $curN >= self::MIN_TREND && $prevN >= self::MIN_TREND;
        if (!$conclusive) {
            return [[
                'severity' => 'watch', 'category' => 'consistency',
                'headline' => 'Not enough data to confirm a trend yet.',
                'detail' => "This period: $curN closed trades ({$curWin}% win, " . round($curR, 2) . "R). Prior period: $prevN closed trades. Need " . self::MIN_TREND . "+ in both to compare reliably.",
                'recommendation' => 'Keep logging — trend detection needs a larger sample on both sides.',
                'based_on_n' => min($curN, $prevN), 'conclusive' => false,
            ]];
        }

        if ($delta > 0.15) {
            $severity = 'good'; $dir = 'improving';
        } elseif ($delta < -0.15) {
            $severity = 'alert'; $dir = 'declining';
        } else {
            $severity = 'watch'; $dir = 'flat';
        }
        return [[
            'severity' => $severity, 'category' => 'consistency',
            'headline' => "Performance is $dir vs the previous period.",
            'detail' => "This period: {$curWin}% win, " . round($curR, 2) . "R avg. Prior period: {$prevWin}% win, " . round($prevR, 2) . "R avg." . $this->rCaveat(array_merge($closed, $prevClosed)),
            'recommendation' => $dir === 'declining' ? 'Slow down and revisit what changed since the last period.' : 'Keep doing what\'s working.',
            'based_on_n' => min($curN, $prevN), 'conclusive' => true,
        ]];
    }

    // ── F. CHALLENGE-SPECIFIC ───────────────────────────────

    private function ruleDrawdownProximity($challenge) {
        $starting = (float)($challenge['starting_balance'] ?? 0);
        $maxDd = (float)($challenge['max_drawdown_pct'] ?? 0);
        if ($starting <= 0 || $maxDd <= 0) return [];
        // Always static (helpers.php::staticDrawdownPct()) -- same reasoning as
        // AlertController's identical check, unaffected by the challenge's own
        // drawdown_type (added v3.14.7). See CLAUDE.md v3.14.7 for the known scope
        // boundary this leaves: a challenge explicitly set to 'trailing' would see this
        // insight diverge from the Stats page's Current Drawdown.
        $currentDd = staticDrawdownPct($challenge);
        if ($maxDd - $currentDd <= 2) {
            return [[
                'severity' => 'alert', 'category' => 'risk',
                'headline' => "You're close to the max drawdown line — protect the account.",
                'detail' => 'Current drawdown ' . round($currentDd, 1) . '% vs a ' . $maxDd . '% limit.',
                'recommendation' => 'Cut position size or pause trading until the account recovers a buffer.',
                'based_on_n' => 1, 'conclusive' => true,
            ]];
        }
        return [];
    }

    private function ruleDailyLossLimitHits($closed, $challenge) {
        $limit = (float)($challenge['daily_loss_limit'] ?? 0);
        if ($limit <= 0) return [];
        $byDay = [];
        foreach ($closed as $t) $byDay[$t['trade_date']] = ($byDay[$t['trade_date']] ?? 0) + (float)($t['net_pnl'] ?? 0);
        $exceeded = 0; $approached = 0;
        foreach ($byDay as $pnl) {
            if ($pnl >= 0) continue;
            $ratio = abs($pnl) / $limit;
            if ($ratio >= 1) $exceeded++;
            elseif ($ratio >= 0.9) $approached++;
        }
        if ($exceeded === 0 && $approached === 0) return [];
        $severity = $exceeded > 0 ? 'alert' : 'watch';
        return [[
            'severity' => $severity, 'category' => 'risk',
            'headline' => ($exceeded + $approached) . ' day(s) hit or approached your daily loss limit.',
            'detail' => "$exceeded day(s) exceeded the \$$limit daily limit, $approached day(s) came within 10%.",
            'recommendation' => 'Enforce a hard stop-trading rule the moment the daily limit is hit.',
            'based_on_n' => $exceeded + $approached, 'conclusive' => true,
        ]];
    }

    private function ruleAggressiveVsReserved($closed, $challengeMap) {
        $byChallenge = [];
        foreach ($closed as $t) {
            if (empty($t['challenge_id'])) continue;
            $byChallenge[$t['challenge_id']][] = $t;
        }
        if (count($byChallenge) < 2) return [];

        $stats = [];
        foreach ($byChallenge as $chId => $chTrades) {
            $n = count($chTrades);
            if ($n < self::MIN_CHALLENGE_RANK) continue;
            $wins = count(array_filter($chTrades, fn($t) => $t['result'] === 'Win'));
            $avgR = array_sum(array_map(fn($t) => (float)($t['r_multiple'] ?? 0), $chTrades)) / $n;
            $stats[$chId] = [
                'name' => $challengeMap[$chId]['name'] ?? "Challenge #$chId",
                'n' => $n, 'win_rate' => round($wins / $n * 100, 1), 'expectancy_r' => round($avgR, 2),
            ];
        }
        if (count($stats) < 2) return [];

        uasort($stats, fn($a, $b) => $b['expectancy_r'] <=> $a['expectancy_r']);
        $top = array_key_first($stats);
        $bottom = array_key_last($stats);
        $t = $stats[$top]; $b = $stats[$bottom];
        if ($top === $bottom) return [];

        return [[
            'severity' => 'good', 'category' => 'consistency',
            'headline' => "Your '{$t['name']}' style is winning.",
            'detail' => "'{$t['name']}': expectancy " . ($t['expectancy_r'] >= 0 ? '+' : '') . "{$t['expectancy_r']}R over {$t['n']} trades. '{$b['name']}': " . ($b['expectancy_r'] >= 0 ? '+' : '') . "{$b['expectancy_r']}R over {$b['n']} trades." . $this->rCaveat(array_merge($byChallenge[$top], $byChallenge[$bottom])),
            'recommendation' => "Lean into whatever '{$t['name']}' is doing differently — sizing, setup selection, or pace.",
            'based_on_n' => $t['n'] + $b['n'], 'conclusive' => true,
        ]];
    }

    // ── G. SIZE INTEGRITY (v3.7.0 / v3.15.0 Phase 1) ────────

    /**
     * v3.16.0 recalibration: 1.15 fired on artifact-level skew (1.08 in practice, once
     * the start-of-day tier rebase and exit-quality work landed) -- raised to 1.25 and
     * downgraded from 'alert' to 'info'. This is still worth surfacing (size skew is a
     * real, checkable number) but it is no longer treated as an active problem on this
     * account's actual data; it reads as a below-threshold data point, not a red banner.
     */
    private function ruleSizeSkew($size) {
        if ($size['size_skew'] === 'UNAVAILABLE' || $size['resolved_n'] < self::MIN_SIZE_SKEW) return [];
        if ($size['size_skew'] <= 1.25) return [];
        $skewPct = round(($size['size_skew'] - 1) * 100, 1);
        return [[
            'severity' => 'info', 'category' => 'risk',
            'headline' => 'Losers are sized bigger than winners.',
            'detail' => "Losers sized {$skewPct}% above winners — \$" . number_format($size['dollars_per_R_losers'], 2)
                . " per R on losses against \$" . number_format($size['dollars_per_R_winners'], 2) . " on wins, across {$size['resolved_n']} resolved trades. Net "
                . ($size['total_R'] >= 0 ? '+' : '') . "{$size['total_R']}R is " . ($size['total_R'] >= 0 ? 'positive' : 'negative') . "; net \$"
                . number_format($size['total_dollars'], 2) . " is " . ($size['total_dollars'] >= 0 ? 'positive too' : 'not') . '.',
            'recommendation' => "Size losers the same as winners — the setup isn't producing this gap, position sizing on losing trades is.",
            'based_on_n' => $size['resolved_n'], 'conclusive' => true,
        ]];
    }

    private function ruleTierBreach($size, $challenge) {
        if ($size['tier_breach_count'] === 'UNAVAILABLE' || $size['tier_breach_count'] < 1) return [];
        $balance = number_format((float)($challenge['current_balance'] ?? 0), 2);
        $tierPct = $size['current_tier_pct'] === 'UNAVAILABLE' ? '?' : $size['current_tier_pct'];
        // v3.16.0: name which months carried the breaches -- 11 spread over 4 months
        // reads as a persistent pattern; 11 in one week reads as a single bad stretch.
        $months = $size['tier_breach_by_month'] ?? [];
        $monthsText = $months
            ? implode(', ', array_map(fn($m, $n) => $this->monthLabel($m) . " ({$n})", array_keys($months), array_values($months)))
            : 'month unknown';
        return [[
            'severity' => 'alert', 'category' => 'risk',
            'headline' => "{$size['tier_breach_count']} trade(s) breached the risk ladder.",
            'detail' => "{$size['tier_breach_count']} trade(s) exceeded the ladder ceiling for their balance band: {$monthsText}. At \${$balance} the ladder prescribes {$tierPct}%.",
            'recommendation' => 'Size to the ladder tier for your balance at entry — check the tier before sizing, not after.',
            'based_on_n' => $size['sized_n'], 'conclusive' => true,
        ]];
    }

    /**
     * v3.16.0 recalibration: <85% fired at 74.6% (the account's actual, start-of-day-
     * rebased baseline) -- raised the trigger to <70 so this baseline itself doesn't read
     * as a violation. Also splits the miss into over-tier (sized bigger than the ladder
     * allowed — burns the account faster than planned) vs. under-tier (sized smaller —
     * under-uses an edge that's actually there) — two different failures that a single
     * adherence percentage collapsed into one number.
     */
    private function ruleLadderDrift($size) {
        if ($size['ladder_adherence_rate'] === 'UNAVAILABLE' || $size['sized_n'] < self::MIN_LADDER_DRIFT) return [];
        if ($size['ladder_adherence_rate'] >= 70) return [];
        $worst = $size['worst_deviation'] === 'UNAVAILABLE' ? '?' : $size['worst_deviation'];
        $over = $size['over_tier_count'] === 'UNAVAILABLE' ? 0 : $size['over_tier_count'];
        $under = $size['under_tier_count'] === 'UNAVAILABLE' ? 0 : $size['under_tier_count'];
        return [[
            'severity' => 'watch', 'category' => 'risk',
            'headline' => 'Ladder adherence is slipping.',
            'detail' => "Ladder held on {$size['ladder_adherence_rate']}% of {$size['sized_n']} sized trades — {$over} sized over tier, {$under} sized under tier. Worst deviation {$worst}%.",
            'recommendation' => 'Recheck position size against the ladder tier before every entry, not just when balance is trending down.',
            'based_on_n' => $size['sized_n'], 'conclusive' => true,
        ]];
    }

    // ── H. REPETITION (v3.8.0 / v3.16.0 Phase 2) ────────────

    private function ruleNoCleanReps($p2) {
        if ($p2['clean_reps'] >= 10) return [];
        return [[
            'severity' => 'alert', 'category' => 'repetition',
            'headline' => 'Almost nothing on file is a clean repetition.',
            'detail' => "{$p2['clean_reps']} of {$p2['total_n']} trades have stop, target and a resolved exit on file. Everything else is an outcome without a plan attached, and cannot be used to test the system.",
            'recommendation' => 'Set stop and target before every entry and let the exit resolve on its own — that is what turns a trade into a usable data point.',
            'based_on_n' => $p2['total_n'], 'conclusive' => true,
        ]];
    }

    private function ruleTemplateExists($p2) {
        if ($p2['clean_reps'] < 1) return [];
        return [[
            'severity' => 'good', 'category' => 'repetition',
            'headline' => "{$p2['clean_reps']} trade(s) recorded complete.",
            'detail' => "{$p2['clean_reps']} trade(s) recorded complete: {$p2['clean_rep_ids']}. Whatever produced those is the process to repeat.",
            'recommendation' => 'Look at exactly what was different about these trades — strategy, checklist, or timing — and repeat it deliberately.',
            'based_on_n' => $p2['clean_reps'], 'conclusive' => true,
        ]];
    }

    private function ruleRepFields($p2) {
        if ($p2['field_completeness'] === 'UNAVAILABLE' || $p2['field_completeness'] >= 70) return [];
        return [[
            'severity' => 'watch', 'category' => 'repetition',
            'headline' => "{$p2['weakest_field']} is the weakest-recorded field.",
            'detail' => "{$p2['weakest_field']} recorded on {$p2['weakest_field_pct']}% of eligible trades.",
            'recommendation' => "Make {$p2['weakest_field']} a required field before a trade can be saved.",
            'based_on_n' => $p2['total_n'], 'conclusive' => true,
        ]];
    }

    /** Always fires -- no rejection/scan-denominator entity exists anywhere in this schema. */
    private function ruleNoDenominator() {
        return [[
            'severity' => 'info', 'category' => 'repetition',
            'headline' => 'Setups passed on are unrecorded.',
            'detail' => 'No rejection log. Setups passed on are unrecorded, so trade frequency cannot be explained by what got rejected.',
            'recommendation' => 'Log a one-line entry for a setup you looked at and passed on, even without the full trade form.',
            'based_on_n' => 0, 'conclusive' => true,
        ]];
    }

    // ── I. EXIT QUALITY (v3.8.0 / v3.16.0 Phase 2, corrected v3.9.0 / v3.16.1) ──

    /**
     * v3.16.1 A2: the largest, previously-unreported finding on this account, and
     * deliberately the first rule pushed into getReview()'s $insights merge so it sorts
     * to the top of the alert tier (PHP's usort is stable as of 8.0, and this engine
     * targets 8.1). Carries 'action'/'verify' as plain informational fields on the
     * insight -- not wired to an automatic next-period verification check, since that
     * mechanism (CadenceGate) was explicitly deferred out of v3.16.0 pending a spec this
     * session was never given. The UI can render them as-is; nothing computes
     * "honoured/broken" against them yet.
     */
    private function ruleExitNoTarget($p2) {
        if ($p2['unknown_n'] < 1) return [];
        return [[
            'severity' => 'alert', 'category' => 'edge',
            'headline' => "{$p2['unknown_n']} of {$p2['total_n']} trades have no target on file.",
            'detail' => "{$p2['unknown_n']} of {$p2['total_n']} trades have no target on file. Those trades returned \$" . number_format($p2['unknown_pnl'], 2) . " — \$" . number_format($p2['unknown_per_trade'], 2) . " each. Every trade with a recorded target is either profitable or losing a controlled 1R.",
            'recommendation' => 'Record stop and target before entry on every trade.',
            'action' => 'Record stop and target before entry on every trade.',
            'verify' => 'unknown_n_new_period = 0',
            'based_on_n' => $p2['unknown_n'], 'conclusive' => true,
        ]];
    }

    /**
     * v3.16.1 A1: rewritten to fire on stopped_short only. The v3.16.0 version also
     * counted target_hit_sub_gate (then-named target_hit_short) trades toward this rule
     * and claimed take-profits were "paying 1R" -- verified against live data and found
     * wrong: those four trades averaged 2.343R and returned +$665.62, the account's
     * largest single contributor. That claim traced to three estimated-R rows (gross P&L
     * / risk_amount), which carries no information about actual target placement. This
     * version only ever looks at stopped_short trades and reports target_r (the planned
     * geometry), never r_multiple, for exactly that reason.
     */
    private function ruleExitTargetShort($p2) {
        if ($p2['stopped_short_n'] < 1) return [];
        $avgTargetR = $p2['avg_stopped_short_target_r'] === 'UNAVAILABLE' ? '?' : $p2['avg_stopped_short_target_r'];
        return [[
            'severity' => 'watch', 'category' => 'edge',
            'headline' => "{$p2['stopped_short_n']} stopped-out trade(s) had a sub-1:1 target.",
            'detail' => "{$p2['stopped_short_n']} trade(s) had a target below 1:1 relative to stop ({$avgTargetR} average). Gate 5 requires structural target ≥ 3:1.",
            'recommendation' => 'Set targets at or above the 3:1 gate before entry, independent of whether the trade ultimately stops out.',
            'based_on_n' => $p2['stopped_short_n'], 'conclusive' => true,
        ]];
    }

    private function ruleExitQualityUnknown($p2) {
        if ($p2['unknown_pct'] <= 50) return [];
        return [[
            'severity' => 'watch', 'category' => 'edge',
            'headline' => 'Target geometry is unknown on most trades.',
            'detail' => "Target geometry unknown on {$p2['unknown_pct']}% of trades. Exit discipline cannot be measured on rows without a recorded target.",
            'recommendation' => 'Record entry, stop and target on every trade going forward — this is the gap phase 1b closes going forward, not retroactively.',
            'based_on_n' => $p2['total_n'], 'conclusive' => true,
        ]];
    }

    private function ruleExitValidHeld($p2) {
        if ($p2['valid_n'] < 3) return [];
        $avgValid = $p2['avg_valid_r'] === 'UNAVAILABLE' ? '?' : $p2['avg_valid_r'];
        return [[
            'severity' => 'good', 'category' => 'edge',
            'headline' => "{$p2['valid_n']} trades reached a target set at or above the gate.",
            'detail' => "{$p2['valid_n']} trades reached a target set at or above the gate, averaging {$avgValid}R.",
            'recommendation' => 'This is the target geometry to standardize on — stop shortening targets to close trades faster.',
            'based_on_n' => $p2['valid_n'], 'conclusive' => true,
        ]];
    }

    // ── J. EDGE — RECORDED / ESTIMATED SPLIT (v3.8.0 / v3.16.0 Phase 2) ──

    private function ruleEdgeRecordedOnly($p2) {
        if ($p2['estimated_n'] < 1) return [];
        return [[
            'severity' => 'info', 'category' => 'edge',
            'headline' => 'Expectancy excludes estimated-R rows.',
            'detail' => "Expectancy computed on {$p2['recorded_n']} trades with recorded R. {$p2['estimated_n']} estimated rows excluded — their R is derived from P&L and adds nothing.",
            'recommendation' => "",
            'based_on_n' => $p2['recorded_n'], 'conclusive' => true,
        ]];
    }

    private function ruleEdgeUnproven($p2) {
        if ($p2['recorded_n'] >= 40) return [];
        return [[
            'severity' => 'info', 'category' => 'edge',
            'headline' => 'Not enough recorded-R trades to call an edge.',
            'detail' => "{$p2['recorded_n']} trades with recorded R. Below 40, no expectancy estimate is load-bearing.",
            'recommendation' => 'Keep logging real stops so recorded R accumulates — an estimated row never counts toward this.',
            'based_on_n' => $p2['recorded_n'], 'conclusive' => false,
        ]];
    }

    private function ruleEdgeNegative($p2) {
        if ($p2['expectancy_recorded_R'] === 'UNAVAILABLE' || $p2['recorded_n'] < 25) return [];
        if ($p2['expectancy_recorded_R'] >= -0.05) return [];
        return [[
            'severity' => 'watch', 'category' => 'edge',
            'headline' => 'The strategy is not yet profitable on recorded R alone.',
            'detail' => "{$p2['recorded_n']} recorded trades at {$p2['expectancy_recorded_R']}R, \$" . number_format($p2['pnl_per_trade'], 2) . ' per trade.',
            'recommendation' => 'Do not scale size until recorded-R expectancy turns positive over a larger sample.',
            'based_on_n' => $p2['recorded_n'], 'conclusive' => true,
        ]];
    }

    /**
     * The rule the brief calls out as the one it most wants on screen: it states, from
     * the data, the opposite of the "the rules work, intervention hurts" reading a prior
     * handover concluded. Deliberately has no minimum-n gate beyond both sides being
     * non-empty (computePhase2Metrics guarantees avg_pnl_resolved/avg_pnl_manual are only
     * non-'UNAVAILABLE' when their own count is > 0) -- if this stops being true as target
     * geometry gets recorded (see EXIT_TARGET_SHORT/EXIT_QUALITY_UNKNOWN above), that
     * reversal is itself the signal, not a reason to add a threshold that would hide it.
     */
    private function ruleEdgeInterventionPositive($p2) {
        if ($p2['avg_pnl_resolved'] === 'UNAVAILABLE' || $p2['avg_pnl_manual'] === 'UNAVAILABLE') return [];
        if (!($p2['avg_pnl_manual'] > $p2['avg_pnl_resolved'])) return [];
        return [[
            'severity' => 'alert', 'category' => 'edge',
            'headline' => 'Manual intervention is currently outperforming the rules.',
            'detail' => 'Trades left to resolve: $' . number_format($p2['avg_pnl_resolved'], 2) . " each across {$p2['resolved_n']}. Trades closed manually: \$" . number_format($p2['avg_pnl_manual'], 2) . " each across {$p2['intervened_n']}. Intervention is currently outperforming the rules.",
            'recommendation' => 'Investigate what the manual closes are doing differently before assuming discipline means leaving every trade to resolve on its own.',
            'based_on_n' => $p2['resolved_n'] + $p2['intervened_n'], 'conclusive' => true,
        ]];
    }

    // ── K. COST (v3.8.0 / v3.16.0 Phase 2, as originally specified) ──

    private function ruleCostExceedsLoss($p2) {
        if (!($p2['total_fees'] > $p2['trading_pnl_abs'])) return [];
        return [[
            'severity' => 'alert', 'category' => 'cost',
            'headline' => 'Fees and funding exceed the trading loss itself.',
            'detail' => '$' . number_format($p2['total_fees'], 2) . ' in fees and funding against $' . number_format($p2['trading_pnl_abs'], 2) . ' of trading loss. Costs are the larger number.',
            'recommendation' => 'Reduce trade frequency or fee tier before anything else — costs are currently the dominant loss driver, not the setup.',
            'based_on_n' => 1, 'conclusive' => true,
        ]];
    }

    private function ruleCostDrag($p2) {
        if ($p2['fee_drag_R'] === 'UNAVAILABLE' || $p2['fee_drag_R'] <= 0.04) return [];
        $dragPct = $p2['fee_drag_pct'] === 'UNAVAILABLE' ? '?' : $p2['fee_drag_pct'];
        return [[
            'severity' => 'watch', 'category' => 'cost',
            'headline' => 'Fees are a meaningful drag per trade.',
            'detail' => "{$p2['fee_drag_R']}R per trade in fees — {$dragPct}% of a typical winner.",
            'recommendation' => 'Check whether lot size or trade frequency can come down without changing the setup.',
            'based_on_n' => 1, 'conclusive' => true,
        ]];
    }

    private function ruleCostFlipped($p2) {
        if ($p2['trades_flipped'] < 1) return [];
        return [[
            'severity' => 'info', 'category' => 'cost',
            'headline' => "{$p2['trades_flipped']} trade(s) turned into a loss after fees.",
            'detail' => "{$p2['trades_flipped']} trade(s) gross-positive, net-negative after fees.",
            'recommendation' => '',
            'based_on_n' => $p2['trades_flipped'], 'conclusive' => true,
        ]];
    }

    // ── L. GEOMETRY (v3.8.0 / v3.16.0 Phase 2, as originally specified) ──

    private function ruleGeoRatioDrift($p2) {
        if ($p2['ratio_drift'] === 'UNAVAILABLE' || $p2['ratio_drift'] <= 1.3) return [];
        return [[
            'severity' => 'watch', 'category' => 'risk',
            'headline' => 'The path to target is harder than the challenge you bought.',
            'detail' => "Purchased at {$p2['purchased_ratio']}:1. Now {$p2['live_boundary_ratio']}:1 — {$p2['ratio_drift']}× harder than the challenge you bought.",
            'recommendation' => "Treat the remaining distance to target as the real target — don't anchor to the original profit goal as if nothing has changed.",
            'based_on_n' => 1, 'conclusive' => true,
        ]];
    }

    // ── PERSISTENCE ──────────────────────────────────────────

    private function upsertReview($challengeId, $type, $start, $end, $insightsJson, $metricsJson) {
        if ($challengeId) {
            $s = $this->db->prepare("SELECT id FROM ai_reviews WHERE user_id=? AND challenge_id=? AND period_type=? AND period_start=?");
            $s->execute([$this->uid, $challengeId, $type, $start]);
        } else {
            $s = $this->db->prepare("SELECT id FROM ai_reviews WHERE user_id=? AND challenge_id IS NULL AND period_type=? AND period_start=?");
            $s->execute([$this->uid, $type, $start]);
        }
        $existing = $s->fetch();
        if ($existing) {
            $this->db->prepare("UPDATE ai_reviews SET period_end=?, insights_json=?, metrics_json=? WHERE id=?")
                ->execute([$end, $insightsJson, $metricsJson, $existing['id']]);
        } else {
            $this->db->prepare("INSERT INTO ai_reviews (user_id,challenge_id,period_type,period_start,period_end,insights_json,metrics_json) VALUES (?,?,?,?,?,?,?)")
                ->execute([$this->uid, $challengeId, $type, $start, $end, $insightsJson, $metricsJson]);
        }
    }
}
