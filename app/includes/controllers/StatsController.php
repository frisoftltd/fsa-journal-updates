
<?php
/**
 * FundedControl — Stats Controller
 * Handles: get_stats — all stats scoped to active challenge
 */
class StatsController {
    // Same sample-size floor StrategyBuilderController::MIN_SPLIT_TRADES uses for its
    // per-value win-rate splits — a bucket's win rate isn't shown as settled until it
    // clears this. Fields below (conclusive/based_on_n) match the vocabulary already
    // used by ReviewEngineController::insight() and rendered by js/review.js, rather
    // than inventing a second "early signal" convention for the same concept.
    const MIN_BREAKDOWN_SAMPLE = 8;

    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getStats() {
        $ch = getActiveChallenge();
        $chId = $ch['id'] ?? 0;
        $month = $_GET['month'] ?? null;
        $year  = $_GET['year']  ?? null;
        $where = "WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL)";
        $p = [$this->uid, $chId];
        if ($month && $year) { $where .= " AND MONTH(trade_date)=? AND YEAR(trade_date)=?"; $p[] = intval($month); $p[] = intval($year); }

        $qv = function($sql, $p) { $s = $this->db->prepare($sql); $s->execute($p); return $s->fetchColumn(); };
        $qa = function($sql, $p) { $s = $this->db->prepare($sql); $s->execute($p); return $s->fetchAll(); };

        // Closed trades only (Win/Loss/Break Even) is the one rule for realised R and win
        // rate across this whole controller — Open trades haven't resolved yet and would
        // otherwise dilute both just by existing. Applied uniformly below, not per-query.
        $closedFilter = "result IN ('Win','Loss','Break Even')";

        $stats = [];
        $stats['total_trades']  = $qv("SELECT COUNT(*) FROM trades $where", $p);
        $stats['wins']          = $qv("SELECT COUNT(*) FROM trades $where AND result='Win'", $p);
        $stats['losses']        = $qv("SELECT COUNT(*) FROM trades $where AND result='Loss'", $p);
        $stats['break_evens']   = $qv("SELECT COUNT(*) FROM trades $where AND result='Break Even'", $p);
        $stats['open_trades']   = $qv("SELECT COUNT(*) FROM trades $where AND result='Open'", $p);
        $stats['closed_trades'] = $stats['wins'] + $stats['losses'] + $stats['break_evens'];
        $stats['win_rate']      = $stats['closed_trades'] > 0 ? round($stats['wins'] / $stats['closed_trades'] * 100, 1) : 0;
        $stats['net_pnl']       = $qv("SELECT COALESCE(SUM(net_pnl),0) FROM trades $where", $p);
        $stats['gross_pnl']     = $qv("SELECT COALESCE(SUM(pnl),0) FROM trades $where", $p);
        $stats['total_fees']    = $qv("SELECT COALESCE(SUM(fees),0) FROM trades $where", $p);
        $stats['avg_win']       = $qv("SELECT COALESCE(AVG(net_pnl),0) FROM trades $where AND result='Win'", $p);
        $stats['avg_loss']      = $qv("SELECT COALESCE(AVG(net_pnl),0) FROM trades $where AND result='Loss'", $p);
        $stats['avg_r']         = $qv("SELECT COALESCE(AVG(r_multiple),0) FROM trades $where AND $closedFilter", $p);
        // Imported rows (see 2026_09_17_0002) have no recorded stop-loss, so their
        // r_multiple is a reconstructed risk-unit estimate, not a fact — surfaced here so
        // avg_r can be captioned in the UI rather than presented with false precision.
        // NULL r_multiple_source (every pre-v3.12.0 manual trade) is not estimated.
        $stats['r_estimated_pct'] = $qv("SELECT COALESCE(AVG(CASE WHEN r_multiple_source='estimated' THEN 100.0 ELSE 0 END),0) FROM trades $where AND $closedFilter", $p);

        $wins_sum = $qv("SELECT COALESCE(SUM(net_pnl),0) FROM trades $where AND result='Win'", $p);
        $loss_sum = abs($qv("SELECT COALESCE(SUM(net_pnl),0) FROM trades $where AND result='Loss'", $p));
        $stats['profit_factor'] = $loss_sum > 0 ? round($wins_sum / $loss_sum, 2) : 0;

        // Which challenge these numbers are scoped to, and how many open trades were
        // excluded from win rate/avg R — surfaced in the UI as a caption, not left silent.
        $stats['scope'] = ['challenge_id' => $chId ?: null, 'challenge_name' => $ch['name'] ?? null];

        // Breakdowns — closed trades only, same convention as win_rate/avg_r above.
        $stats['by_session']   = $qa("SELECT session,COUNT(*) as trades,SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins,COALESCE(SUM(net_pnl),0) as pnl FROM trades $where AND session IS NOT NULL AND $closedFilter GROUP BY session", $p);
        $fib = $this->getFibBreakdown($where, $p, $closedFilter);
        $stats['by_fib']       = $fib['buckets'];
        $stats['fib_coverage'] = $fib['coverage'];
        $stats['by_pair']      = $qa("SELECT pair,COUNT(*) as trades,SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins,COALESCE(SUM(net_pnl),0) as pnl FROM trades $where AND pair IS NOT NULL AND $closedFilter GROUP BY pair", $p);
        $stats['by_direction'] = $qa("SELECT direction,COUNT(*) as trades,SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins,COALESCE(SUM(net_pnl),0) as pnl FROM trades $where AND direction IS NOT NULL AND $closedFilter GROUP BY direction", $p);
        // exit_reason (added v3.14.0, populated by the Bitfunded importer from Position
        // History's own exit-reason label — Stop Loss / Manual Closing / etc., stored
        // verbatim, not mapped to an enum). AVG/SUM(r_multiple) silently skip rows with
        // no r_multiple recorded (SQL's normal NULL handling) rather than treating a
        // missing R as zero, which would understate every bucket that has one.
        $stats['by_exit_reason'] = $qa("SELECT exit_reason,COUNT(*) as trades,AVG(r_multiple) as avg_r,SUM(r_multiple) as total_r,COALESCE(SUM(net_pnl),0) as pnl FROM trades $where AND exit_reason IS NOT NULL AND $closedFilter GROUP BY exit_reason", $p);

        // Cumulative P&L + drawdown
        $cum_trades = $qa("SELECT id,trade_date,net_pnl FROM trades $where ORDER BY trade_date,id", $p);
        $starting_bal = floatval($ch['starting_balance'] ?? 10000);
        $running = 0; $peak = 0; $cum = [];
        foreach ($cum_trades as $i => $t) {
            $running += $t['net_pnl'];
            if ($running > $peak) $peak = $running;
            $dd = ($peak > 0 && $starting_bal > 0) ? (($peak - $running) / $starting_bal) * 100 : 0;
            $cum[] = ['trade' => $i + 1, 'net_pnl' => round($t['net_pnl'], 2), 'cumulative' => round($running, 2), 'drawdown' => round($dd, 2), 'date' => $t['trade_date']];
        }
        $stats['cumulative']           = $cum;
        $stats['max_drawdown_pct']     = count($cum) > 0 ? max(array_column($cum, 'drawdown')) : 0;
        $stats['current_drawdown_pct'] = count($cum) > 0 ? end($cum)['drawdown'] : 0;

        // Streak
        $chWhere = "WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL)";
        $all_results = $qa("SELECT result FROM trades $chWhere AND result IN ('Win','Loss') ORDER BY trade_date,id", [$this->uid, $chId]);
        $max_win = 0; $max_loss = 0; $tmp = 0; $tmp_type = '';
        foreach ($all_results as $t) {
            if ($t['result'] === $tmp_type) { $tmp++; } else { $tmp = 1; $tmp_type = $t['result']; }
            if ($tmp_type === 'Win' && $tmp > $max_win) $max_win = $tmp;
            if ($tmp_type === 'Loss' && $tmp > $max_loss) $max_loss = $tmp;
        }
        $last = end($all_results);
        $stats['streak'] = ['current' => $last ? $tmp : 0, 'type' => $last ? $last['result'] : '', 'max_win' => $max_win, 'max_loss' => $max_loss];

        // Hours + calendar
        $stats['by_hour']   = $qa("SELECT HOUR(time_in) as hour, COUNT(*) as trades, SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins, COALESCE(SUM(net_pnl),0) as pnl FROM trades $chWhere AND time_in IS NOT NULL GROUP BY HOUR(time_in) ORDER BY hour", [$this->uid, $chId]);
        $stats['calendar']  = $qa("SELECT trade_date, COALESCE(SUM(net_pnl),0) as pnl, COUNT(*) as trades FROM trades $chWhere GROUP BY trade_date ORDER BY trade_date", [$this->uid, $chId]);

        // Daily loss check
        $today_pnl = $qv("SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL) AND trade_date=CURDATE()", [$this->uid, $chId]);
        $daily_limit = floatval($ch['daily_loss_limit'] ?? 500);
        $stats['today_pnl'] = $today_pnl;
        $stats['daily_limit_pct'] = $daily_limit > 0 ? abs(min(0, $today_pnl)) / $daily_limit * 100 : 0;
        $stats['dd_pct'] = ($starting_bal > 0)
            ? abs(min(0, floatval($ch['current_balance'] ?? $starting_bal) - $starting_bal)) / $starting_bal * 100 : 0;

        jsonResponse($stats);
    }

    /**
     * "Win Rate by Fib Level" breakdown — sourced from trade_variables, not the legacy
     * trades.fib_level column, since as of v3.9.2 the dynamic strategy system carries the
     * real Fib answers (18 of 26 closed trades) while the legacy column only covers 8, and
     * the two never overlap (confirmed live 2026-09-14, post the v3.8.0 remap — see
     * CLAUDE.md for why the pre-remap v3.9.1 investigation got this wrong).
     *
     * The variable is resolved by label ("Fib Level"), not a hardcoded id — a strategy
     * edit/rename must not silently break this the way v3.9.1 found trades.fib_level had.
     * A user can have more than one strategy with its own Fib Level variable (different
     * ids), so every matching id across all of this user's strategies is included. If none
     * exists, the breakdown degrades to the legacy column alone rather than erroring.
     *
     * Per trade: the dynamic answer wins if a trade_variables row exists with a non-blank
     * value; trades.fib_level is the fallback for trades with no dynamic answer at all,
     * which is exactly the legacy-only trade set (confirmed non-overlapping). A recorded
     * but blank answer is treated the same as no row at all — "asked, left blank" is
     * absence of information, not a category, and must not render as its own bucket (a
     * single blank trade rendering as a 100%-confident bar was exactly the artifact the
     * sample-size guard exists to prevent, just via a different mechanism). Total coverage
     * (trades that DID resolve to a value vs. all closed trades in scope) is returned
     * separately so that can be stated as a line under the chart instead.
     */
    private function getFibBreakdown($where, $p, $closedFilter) {
        $varStmt = $this->db->prepare(
            "SELECT sv.id FROM strategy_variables sv
             JOIN strategies s ON s.id = sv.strategy_id
             WHERE s.user_id = ? AND LOWER(sv.label) = 'fib level'"
        );
        $varStmt->execute([$this->uid]);
        $fibVarIds = array_map('intval', array_column($varStmt->fetchAll(), 'id'));

        if ($fibVarIds) {
            $ph = implode(',', array_fill(0, count($fibVarIds), '?'));
            // NULLIF(tv.value,'') folds a blank-string answer into NULL so it's excluded by
            // the same "IS NOT NULL" filter as a trade with no row at all — one filter, one
            // meaning of absence, not two.
            $fibExpr = "CASE WHEN tv.trade_id IS NOT NULL THEN NULLIF(tv.value,'') ELSE trades.fib_level END";
            // GROUP BY / ORDER BY / the coverage query below all repeat this CASE rather
            // than referencing the "fib_level" alias — that alias name collides with the
            // real trades.fib_level column used inside the same CASE, and leaning on
            // engine-specific alias-vs-column resolution there isn't worth the risk when
            // repeating the expression is cheap and unambiguous everywhere.
            $sql = "SELECT
                        $fibExpr AS fib_level,
                        COUNT(*) AS trades,
                        SUM(CASE WHEN trades.result='Win' THEN 1 ELSE 0 END) AS wins,
                        COALESCE(SUM(trades.net_pnl),0) AS pnl
                    FROM trades
                    LEFT JOIN trade_variables tv ON tv.trade_id = trades.id AND tv.variable_id IN ($ph)
                    $where AND $closedFilter AND $fibExpr IS NOT NULL
                    GROUP BY $fibExpr ORDER BY $fibExpr";
            // Placeholder order must match the SQL text: the IN(...) in the JOIN clause
            // is written before $where's placeholders, so fibVarIds goes first here too —
            // PDO binds positionally, not by array key.
            $params = array_merge($fibVarIds, $p);

            $coverageSql = "SELECT COUNT(*) AS total, SUM(CASE WHEN $fibExpr IS NOT NULL THEN 1 ELSE 0 END) AS covered
                             FROM trades
                             LEFT JOIN trade_variables tv ON tv.trade_id = trades.id AND tv.variable_id IN ($ph)
                             $where AND $closedFilter";
            $covStmt = $this->db->prepare($coverageSql);
            $covStmt->execute($params);
            $cov = $covStmt->fetch();
            $coverage = ['recorded' => (int)($cov['covered'] ?? 0), 'total' => (int)($cov['total'] ?? 0)];
        } else {
            $sql = "SELECT fib_level, COUNT(*) as trades, SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins, COALESCE(SUM(net_pnl),0) as pnl
                    FROM trades $where AND fib_level IS NOT NULL AND $closedFilter
                    GROUP BY fib_level ORDER BY fib_level";
            $params = $p;

            $covStmt = $this->db->prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN fib_level IS NOT NULL THEN 1 ELSE 0 END) AS covered FROM trades $where AND $closedFilter");
            $covStmt->execute($p);
            $cov = $covStmt->fetch();
            $coverage = ['recorded' => (int)($cov['covered'] ?? 0), 'total' => (int)($cov['total'] ?? 0)];
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        foreach ($rows as &$row) {
            $row['based_on_n'] = (int)$row['trades'];
            $row['conclusive'] = $row['based_on_n'] >= self::MIN_BREAKDOWN_SAMPLE;
        }
        unset($row);

        return ['buckets' => $rows, 'coverage' => $coverage];
    }
}
