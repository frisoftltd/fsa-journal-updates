
<?php
/**
 * FundedControl — Behavioral Review Engine (v3.6.0, Wave 3)
 * Handles: get_review, get_review_periods
 * Deterministic PHP rules over real trade data. No external API calls.
 * Leaves ReviewController / weekly_reviews (manual review) untouched.
 */
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

        if ($challengeId) {
            $s = $this->db->prepare("SELECT trade_date FROM trades WHERE user_id=? AND challenge_id=? ORDER BY trade_date ASC");
            $s->execute([$this->uid, $challengeId]);
        } else {
            $s = $this->db->prepare("SELECT trade_date FROM trades WHERE user_id=? ORDER BY trade_date ASC");
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
        }

        $trades = $this->fetchTrades($challengeId, $periodStart, $periodEnd);
        $closed = array_values(array_filter($trades, fn($t) => in_array($t['result'], ['Win','Loss','Break Even'], true)));
        $metrics = $this->computeMetrics($closed, $trades);

        $scope = ['challenge_id' => $challengeId, 'label' => $challenge ? $challenge['name'] : 'All Combined'];

        if (count($trades) === 0) {
            $this->upsertReview($challengeId, $type, $periodStart, $periodEnd, json_encode([]), json_encode($metrics));
            jsonResponse([
                'period' => ['type' => $type, 'start' => $periodStart, 'end' => $periodEnd],
                'scope' => $scope,
                'metrics' => $metrics,
                'insights' => [],
                'empty' => true,
            ]);
        }

        $challengeMap = $this->userChallengeMap();

        $insights = array_merge(
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
            !$challenge ? $this->ruleAggressiveVsReserved($closed, $challengeMap) : []
        );

        $order = ['alert' => 0, 'watch' => 1, 'good' => 2];
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
        $cols = "id,trade_date,time_in,time_out,session,pair,direction,result,net_pnl,r_multiple,risk_amount,strategy_id,emotion_tag,setup_grade,note_saw,note_why,note_unsure,fsa_rules,challenge_id";
        if ($challengeId) {
            $s = $this->db->prepare("SELECT $cols FROM trades WHERE user_id=? AND challenge_id=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date ASC, time_in ASC, id ASC");
            $s->execute([$this->uid, $challengeId, $start, $end]);
        } else {
            $s = $this->db->prepare("SELECT $cols FROM trades WHERE user_id=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date ASC, time_in ASC, id ASC");
            $s->execute([$this->uid, $start, $end]);
        }
        return $s->fetchAll();
    }

    private function userChallengeMap() {
        $s = $this->db->prepare("SELECT id,name,daily_loss_limit,risk_per_trade_pct,starting_balance,current_balance,max_drawdown_pct FROM challenges WHERE user_id=?");
        $s->execute([$this->uid]);
        $map = [];
        foreach ($s->fetchAll() as $c) $map[$c['id']] = $c;
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
        ];
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
        if ($challengeId) {
            $s = $this->db->prepare("SELECT trade_date, COUNT(*) c FROM trades WHERE user_id=? AND challenge_id=? GROUP BY trade_date");
            $s->execute([$this->uid, $challengeId]);
        } else {
            $s = $this->db->prepare("SELECT trade_date, COUNT(*) c FROM trades WHERE user_id=? GROUP BY trade_date");
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
        if ($worstKey !== null) {
            $w = $qualifying[$worstKey];
            if (($overall - $w['win_rate'] >= 15) && ($w['n'] / $totalTagged > 0.15)) {
                $out[] = $this->insight('alert', 'psychology',
                    "Trades tagged '$worstKey' are your most costly state.",
                    "'$worstKey' wins {$w['win_rate']}% vs $overall% overall, across {$w['n']} trades.",
                    "Add a rule: no entry while feeling '$worstKey' — walk away instead.",
                    $w['n'], self::MIN_EMOTION * 2);
            }
        }
        if ($bestKey !== null && $bestKey !== $worstKey) {
            $b = $qualifying[$bestKey];
            if ($b['win_rate'] - $overall >= 10) {
                $out[] = $this->insight('good', 'psychology',
                    "You perform best when '$bestKey'.",
                    "'$bestKey' wins {$b['win_rate']}% vs $overall% overall, across {$b['n']} trades.",
                    "Build a pre-trade routine that gets you into the '$bestKey' state before entry.",
                    $b['n'], self::MIN_EMOTION * 2);
            }
        }
        return $out;
    }

    private function ruleNegativeStateFrequency($closed) {
        $tagged = array_values(array_filter($closed, fn($t) => $t['emotion_tag'] !== null && $t['emotion_tag'] !== ''));
        if (!$tagged) return [];
        $negative = ['itchy','fomo','revenge','bored'];
        $negN = count(array_filter($tagged, fn($t) => in_array($t['emotion_tag'], $negative, true)));
        $pct = round($negN / count($tagged) * 100, 1);
        if ($pct > 40) {
            return [$this->insight('watch', 'psychology',
                "$pct% of your entries come from a reactive state, not patience.",
                "$negN of " . count($tagged) . " emotion-tagged trades were itchy, FOMO, revenge, or bored.",
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
                'Win rate ' . $winRate . '% but avg loss ' . round($avgLossR, 2) . 'R vs avg win ' . round($avgWinR, 2) . 'R — net expectancy is negative.',
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
            'detail' => "This period: {$curWin}% win, " . round($curR, 2) . "R avg. Prior period: {$prevWin}% win, " . round($prevR, 2) . "R avg.",
            'recommendation' => $dir === 'declining' ? 'Slow down and revisit what changed since the last period.' : 'Keep doing what\'s working.',
            'based_on_n' => min($curN, $prevN), 'conclusive' => true,
        ]];
    }

    // ── F. CHALLENGE-SPECIFIC ───────────────────────────────

    private function ruleDrawdownProximity($challenge) {
        $starting = (float)($challenge['starting_balance'] ?? 0);
        $current = (float)($challenge['current_balance'] ?? $starting);
        $maxDd = (float)($challenge['max_drawdown_pct'] ?? 0);
        if ($starting <= 0 || $maxDd <= 0) return [];
        $currentDd = max(0, ($starting - $current) / $starting * 100);
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
            'detail' => "'{$t['name']}': expectancy " . ($t['expectancy_r'] >= 0 ? '+' : '') . "{$t['expectancy_r']}R over {$t['n']} trades. '{$b['name']}': " . ($b['expectancy_r'] >= 0 ? '+' : '') . "{$b['expectancy_r']}R over {$b['n']} trades.",
            'recommendation' => "Lean into whatever '{$t['name']}' is doing differently — sizing, setup selection, or pace.",
            'based_on_n' => $t['n'] + $b['n'], 'conclusive' => true,
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
