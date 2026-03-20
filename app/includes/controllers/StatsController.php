
<?php
/**
 * FundedControl — Stats Controller
 * Handles: get_stats — all stats scoped to active challenge
 */
class StatsController {
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

        $stats = [];
        $stats['total_trades']  = $qv("SELECT COUNT(*) FROM trades $where", $p);
        $stats['wins']          = $qv("SELECT COUNT(*) FROM trades $where AND result='Win'", $p);
        $stats['losses']        = $qv("SELECT COUNT(*) FROM trades $where AND result='Loss'", $p);
        $stats['break_evens']   = $qv("SELECT COUNT(*) FROM trades $where AND result='Break Even'", $p);
        $stats['win_rate']      = $stats['total_trades'] > 0 ? round($stats['wins'] / $stats['total_trades'] * 100, 1) : 0;
        $stats['net_pnl']       = $qv("SELECT COALESCE(SUM(net_pnl),0) FROM trades $where", $p);
        $stats['gross_pnl']     = $qv("SELECT COALESCE(SUM(pnl),0) FROM trades $where", $p);
        $stats['total_fees']    = $qv("SELECT COALESCE(SUM(fees),0) FROM trades $where", $p);
        $stats['avg_win']       = $qv("SELECT COALESCE(AVG(net_pnl),0) FROM trades $where AND result='Win'", $p);
        $stats['avg_loss']      = $qv("SELECT COALESCE(AVG(net_pnl),0) FROM trades $where AND result='Loss'", $p);
        $stats['avg_r']         = $qv("SELECT COALESCE(AVG(r_multiple),0) FROM trades $where AND r_multiple IS NOT NULL", $p);

        $wins_sum = $qv("SELECT COALESCE(SUM(net_pnl),0) FROM trades $where AND result='Win'", $p);
        $loss_sum = abs($qv("SELECT COALESCE(SUM(net_pnl),0) FROM trades $where AND result='Loss'", $p));
        $stats['profit_factor'] = $loss_sum > 0 ? round($wins_sum / $loss_sum, 2) : 0;

        // Breakdowns
        $stats['by_session']   = $qa("SELECT session,COUNT(*) as trades,SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins,COALESCE(SUM(net_pnl),0) as pnl FROM trades $where AND session IS NOT NULL GROUP BY session", $p);
        $stats['by_fib']       = $qa("SELECT fib_level,COUNT(*) as trades,SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins,COALESCE(SUM(net_pnl),0) as pnl FROM trades $where AND fib_level IS NOT NULL GROUP BY fib_level ORDER BY fib_level", $p);
        $stats['by_pair']      = $qa("SELECT pair,COUNT(*) as trades,SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins,COALESCE(SUM(net_pnl),0) as pnl FROM trades $where AND pair IS NOT NULL GROUP BY pair", $p);
        $stats['by_direction'] = $qa("SELECT direction,COUNT(*) as trades,SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) as wins,COALESCE(SUM(net_pnl),0) as pnl FROM trades $where AND direction IS NOT NULL GROUP BY direction", $p);

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
}
