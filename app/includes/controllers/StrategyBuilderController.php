
<?php
/**
 * FundedControl — Strategy Builder Controller
 * Handles: get_strategies, add_strategy, update_strategy, delete_strategy, save_strategy_vars
 * User-defined strategies, each with any number of custom variables. Separate from
 * StrategyController (strategy_tests sandbox) — do not merge.
 */
class StrategyBuilderController {
    const MIN_RANKED_TRADES = 20;
    const MIN_SPLIT_TRADES = 8;

    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getAll() {
        $s = $this->db->prepare("SELECT * FROM strategies WHERE user_id=? ORDER BY created_at DESC");
        $s->execute([$this->uid]);
        $strategies = $s->fetchAll();

        $v = $this->db->prepare("SELECT id,strategy_id,label,input_type,options,role,timeframe,criteria,sort_order,is_active FROM strategy_variables WHERE strategy_id=? ORDER BY sort_order ASC, id ASC");
        foreach ($strategies as &$st) {
            $v->execute([$st['id']]);
            $st['variables'] = $v->fetchAll();
        }
        jsonResponse($strategies);
    }

    public function add() {
        $d = jsonInput();
        if (empty($d['name'])) jsonError('Strategy name required');
        $this->db->prepare("INSERT INTO strategies (user_id, name) VALUES (?, ?)")
            ->execute([$this->uid, trim($d['name'])]);
        jsonResponse(['success' => true, 'id' => $this->db->lastInsertId()]);
    }

    public function update() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid strategy ID');

        $owns = $this->db->prepare("SELECT id FROM strategies WHERE id=? AND user_id=?");
        $owns->execute([$id, $this->uid]);
        if (!$owns->fetch()) jsonError('Strategy not found');

        $name = array_key_exists('name', $d) ? trim($d['name']) : null;
        if ($name === '') $name = null;
        $is_active = array_key_exists('is_active', $d) ? (int)!!$d['is_active'] : null;

        $this->db->prepare("UPDATE strategies SET name=COALESCE(?,name), is_active=COALESCE(?,is_active) WHERE id=? AND user_id=?")
            ->execute([$name, $is_active, $id, $this->uid]);
        jsonResponse(['success' => true]);
    }

    public function delete() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid strategy ID');

        $owns = $this->db->prepare("SELECT id FROM strategies WHERE id=? AND user_id=?");
        $owns->execute([$id, $this->uid]);
        if (!$owns->fetch()) jsonError('Strategy not found');

        try {
            $this->db->prepare("DELETE FROM strategy_variables WHERE strategy_id=?")->execute([$id]);
            $this->db->prepare("DELETE FROM strategies WHERE id=? AND user_id=?")->execute([$id, $this->uid]);
        } catch (PDOException $e) {
            if ($this->isForeignKeyViolation($e)) {
                jsonError('This strategy has trade history recorded against its variables and cannot be deleted. Deactivate it instead.');
            }
            throw $e;
        }
        jsonResponse(['success' => true]);
    }

    /**
     * Non-destructive by design: existing variable ids are updated in place and
     * never change, so answers already recorded in trade_variables stay attached.
     * A variable dropped from the submitted list is deactivated if it has any
     * recorded answers, and only actually deleted if it was never used (the
     * trade_variables FK enforces this even if the pre-check below races).
     */
    public function saveVariables() {
        $d = jsonInput();
        $strategyId = validId($d['strategy_id'] ?? 0);
        if (!$strategyId) jsonError('Invalid strategy ID');

        $owns = $this->db->prepare("SELECT id FROM strategies WHERE id=? AND user_id=?");
        $owns->execute([$strategyId, $this->uid]);
        if (!$owns->fetch()) jsonError('Strategy not found');

        $variables = $d['variables'] ?? [];
        if (!is_array($variables)) jsonError('Invalid variables payload');

        $allowedTypes = ['checkbox', 'scale', 'select', 'text'];
        $allowedRoles = ['gate', 'tag'];

        $existingStmt = $this->db->prepare("SELECT id FROM strategy_variables WHERE strategy_id=?");
        $existingStmt->execute([$strategyId]);
        $existingIds = array_map('intval', array_column($existingStmt->fetchAll(), 'id'));

        $update = $this->db->prepare("UPDATE strategy_variables SET label=?, input_type=?, options=?, role=?, timeframe=?, criteria=?, sort_order=?, is_active=? WHERE id=? AND strategy_id=?");
        $insert = $this->db->prepare("INSERT INTO strategy_variables (strategy_id,label,input_type,options,role,timeframe,criteria,sort_order,is_active) VALUES (?,?,?,?,?,?,?,?,?)");

        $keepIds = [];
        $order = 0;
        foreach ($variables as $v) {
            $label = trim($v['label'] ?? '');
            if ($label === '') continue;
            $type = in_array($v['input_type'] ?? '', $allowedTypes, true) ? $v['input_type'] : 'checkbox';
            $options = $type === 'select' ? ($v['options'] ?? null) : null;
            $role = in_array($v['role'] ?? '', $allowedRoles, true) ? $v['role'] : 'gate';
            $timeframe = trim($v['timeframe'] ?? '') ?: null;
            $criteria = trim($v['criteria'] ?? '') ?: null;
            $isActive = array_key_exists('is_active', $v) ? (int)!!$v['is_active'] : 1;
            $id = validId($v['id'] ?? 0);

            if ($id && in_array($id, $existingIds, true)) {
                $update->execute([$label, $type, $options, $role, $timeframe, $criteria, $order, $isActive, $id, $strategyId]);
                $keepIds[] = $id;
            } else {
                $insert->execute([$strategyId, $label, $type, $options, $role, $timeframe, $criteria, $order, $isActive]);
                $keepIds[] = (int)$this->db->lastInsertId();
            }
            $order++;
        }

        $removedIds = array_diff($existingIds, $keepIds);
        if ($removedIds) {
            $checkTv = $this->db->prepare("SELECT COUNT(*) FROM trade_variables WHERE variable_id=?");
            $deactivate = $this->db->prepare("UPDATE strategy_variables SET is_active=0 WHERE id=?");
            $delete = $this->db->prepare("DELETE FROM strategy_variables WHERE id=?");
            foreach ($removedIds as $rid) {
                $checkTv->execute([$rid]);
                if ($checkTv->fetchColumn() > 0) {
                    $deactivate->execute([$rid]);
                    continue;
                }
                try {
                    $delete->execute([$rid]);
                } catch (PDOException $e) {
                    if ($this->isForeignKeyViolation($e)) {
                        $deactivate->execute([$rid]);
                    } else {
                        throw $e;
                    }
                }
            }
        }

        jsonResponse(['success' => true]);
    }

    private function isForeignKeyViolation(PDOException $e) {
        return ($e->errorInfo[1] ?? null) == 1451 || strpos($e->getMessage(), 'foreign key constraint') !== false;
    }

    /**
     * Automatic strategy leaderboard — real trades only (result IN Win/Loss/Break Even).
     * Sample-size guard: strategies with < MIN_RANKED_TRADES stay in the "gathering" bucket
     * and are never ranked. Variable attribution splits require >= MIN_SPLIT_TRADES per value.
     */
    public function getLeaderboard() {
        $s = $this->db->prepare("SELECT id, name FROM strategies WHERE user_id=? ORDER BY name ASC");
        $s->execute([$this->uid]);
        $strategies = $s->fetchAll();

        // v3.20.0 — defense in depth: backtest trades never set strategy_id (this
        // engine doesn't attribute a strategy to a backtest session), so this couldn't
        // actually match one today, but excluding source='backtest' explicitly means
        // that stays true even if a future release starts recording a strategy on
        // backtest trades, rather than depending on strategy_id staying NULL forever.
        $tradeStmt = $this->db->prepare("SELECT id, result, r_multiple, net_pnl, fsa_rules FROM trades WHERE user_id=? AND strategy_id=? AND source != 'backtest' AND result IN ('Win','Loss','Break Even')");
        $varStmt = $this->db->prepare("SELECT id, label, input_type, options FROM strategy_variables WHERE strategy_id=? ORDER BY sort_order ASC, id ASC");

        $ranked = [];
        $gathering = [];

        foreach ($strategies as $st) {
            $tradeStmt->execute([$this->uid, $st['id']]);
            $trades = $tradeStmt->fetchAll();
            $count = count($trades);

            if ($count < self::MIN_RANKED_TRADES) {
                $gathering[] = [
                    'strategy_id'  => (int)$st['id'],
                    'name'         => $st['name'],
                    'trade_count'  => $count,
                    'needed'       => self::MIN_RANKED_TRADES - $count,
                ];
                continue;
            }

            $wins = 0; $losses = 0; $breakEvens = 0;
            $grossWinPnl = 0.0; $grossLossPnl = 0.0;
            $winRSum = 0.0; $lossRSum = 0.0; $rSum = 0.0;
            $tradeResultMap = [];

            foreach ($trades as $t) {
                $rm = (float)($t['r_multiple'] ?? 0);
                $pnl = (float)($t['net_pnl'] ?? 0);
                $rSum += $rm;
                $tradeResultMap[$t['id']] = $t['result'];
                if ($t['result'] === 'Win') {
                    $wins++; $winRSum += $rm;
                    if ($pnl > 0) $grossWinPnl += $pnl;
                } elseif ($t['result'] === 'Loss') {
                    $losses++; $lossRSum += abs($rm);
                    if ($pnl < 0) $grossLossPnl += abs($pnl);
                } else {
                    $breakEvens++;
                }
            }

            $winRate  = $count > 0 ? $wins / $count : 0;
            $lossRate = $count > 0 ? $losses / $count : 0;
            $avgR     = $count > 0 ? $rSum / $count : 0;
            $avgWinR  = $wins > 0 ? $winRSum / $wins : 0;
            $avgLossR = $losses > 0 ? $lossRSum / $losses : 0;
            $profitFactor = $grossLossPnl > 0 ? round($grossWinPnl / $grossLossPnl, 2) : null;
            $expectancy = round(($winRate * $avgWinR) - ($lossRate * $avgLossR), 3);

            [$variableAttribution, $biggestDriver] = $this->attributeVariables($st['id'], $trades, $tradeResultMap, $varStmt);
            $legacyAdherence = $this->legacyFsaAdherence($trades);

            $ranked[] = [
                'strategy_id'      => (int)$st['id'],
                'name'             => $st['name'],
                'trade_count'      => $count,
                'wins'             => $wins,
                'losses'           => $losses,
                'break_evens'      => $breakEvens,
                'win_rate'         => round($winRate * 100, 1),
                'avg_r'            => round($avgR, 2),
                'profit_factor'    => $profitFactor,
                'expectancy_r'     => $expectancy,
                'variable_attribution' => $variableAttribution,
                'biggest_driver'   => $biggestDriver,
                'legacy_fsa_adherence' => $legacyAdherence,
            ];
        }

        usort($ranked, fn($a, $b) => $b['expectancy_r'] <=> $a['expectancy_r']);

        jsonResponse(['ranked' => $ranked, 'gathering' => $gathering, 'min_ranked_trades' => self::MIN_RANKED_TRADES, 'min_split_trades' => self::MIN_SPLIT_TRADES]);
    }

    /**
     * Split a ranked strategy's trades by each variable's recorded value and compute
     * win rate per value. A split is only reported when it has >= self::MIN_SPLIT_TRADES trades,
     * otherwise it is marked "not enough data" rather than presented as meaningful.
     */
    private function attributeVariables($strategyId, $trades, $tradeResultMap, $varStmt) {
        $varStmt->execute([$strategyId]);
        $variables = $varStmt->fetchAll();
        $tradeIds = array_column($trades, 'id');
        if (empty($variables) || empty($tradeIds)) return [[], null];

        $placeholders = implode(',', array_fill(0, count($tradeIds), '?'));
        $tv = $this->db->prepare("SELECT trade_id, variable_id, value FROM trade_variables WHERE trade_id IN ($placeholders)");
        $tv->execute($tradeIds);
        $tvRows = $tv->fetchAll();

        $byVariable = [];
        foreach ($tvRows as $row) {
            $val = $row['value'];
            if ($val === null || $val === '') $val = '(blank)';
            $byVariable[$row['variable_id']][$val]['total'] = ($byVariable[$row['variable_id']][$val]['total'] ?? 0) + 1;
            if (($tradeResultMap[$row['trade_id']] ?? '') === 'Win') {
                $byVariable[$row['variable_id']][$val]['wins'] = ($byVariable[$row['variable_id']][$val]['wins'] ?? 0) + 1;
            }
        }

        $attribution = [];
        $biggestDriver = null;
        $biggestSpread = -1;

        foreach ($variables as $v) {
            $groups = $byVariable[$v['id']] ?? [];
            $splits = [];
            $qualifyingRates = [];
            foreach ($groups as $val => $g) {
                $total = $g['total'];
                $enough = $total >= self::MIN_SPLIT_TRADES;
                $winRate = $enough ? round((($g['wins'] ?? 0) / $total) * 100, 1) : null;
                $splits[] = [
                    'value'          => $val,
                    'trade_count'    => $total,
                    'win_rate'       => $winRate,
                    'has_enough_data'=> $enough,
                ];
                if ($enough) $qualifyingRates[] = $winRate;
            }
            $meaningful = count($qualifyingRates) >= 2;
            $spread = $meaningful ? round(max($qualifyingRates) - min($qualifyingRates), 1) : null;

            $attribution[] = [
                'variable_id' => (int)$v['id'],
                'label'       => $v['label'],
                'input_type'  => $v['input_type'],
                'splits'      => $splits,
                'meaningful'  => $meaningful,
                'spread'      => $spread,
            ];

            if ($meaningful && $spread > $biggestSpread) {
                $biggestSpread = $spread;
                $biggestDriver = (int)$v['id'];
            }
        }

        return [$attribution, $biggestDriver];
    }

    /**
     * Legacy insight from the old fsa_rules COUNT field ("All 5" / "4 of 5" / ...).
     * This is adherence-count insight only — it cannot attribute to a specific rule
     * because the count doesn't record which rule was skipped.
     */
    private function legacyFsaAdherence($trades) {
        $groups = [];
        foreach ($trades as $t) {
            $val = $t['fsa_rules'];
            if ($val === null || $val === '') continue;
            $groups[$val]['total'] = ($groups[$val]['total'] ?? 0) + 1;
            if ($t['result'] === 'Win') $groups[$val]['wins'] = ($groups[$val]['wins'] ?? 0) + 1;
        }
        $out = [];
        foreach ($groups as $val => $g) {
            $enough = $g['total'] >= self::MIN_SPLIT_TRADES;
            $out[] = [
                'value'           => $val,
                'trade_count'     => $g['total'],
                'win_rate'        => $enough ? round((($g['wins'] ?? 0) / $g['total']) * 100, 1) : null,
                'has_enough_data' => $enough,
            ];
        }
        return $out;
    }
}
