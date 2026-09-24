
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
        // v3.18.1 — net_pnl is now always gross_pnl - total_fees (funding no longer nets
        // into it, see BitfundedImportController/helpers.php::challengeBalance()).
        // funding_adjustment is the account's one real funding figure, shown as its own
        // line rather than folded silently into Net P&L, so "Net after funding" is the
        // only place the two combine and it's labeled as doing so.
        $stats['funding_adjustment']  = round((float)($ch['funding_adjustment'] ?? 0), 2);
        $stats['net_pnl_after_funding'] = round((float)$stats['net_pnl'] - $stats['funding_adjustment'], 2);
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
        // v3.15.0 Phase 1, Step 0 finding: this breakdown sums net_pnl (fees already
        // netted per row) but structurally cannot reflect challenges.funding_adjustment --
        // funding isn't a trades column, and v3.14.0 deliberately never attributes it to
        // any single trade (dates with overlapping positions and shared funding
        // timestamps make that attribution a guess, not a fact). So this table's total
        // will always sit short of true realised P&L by exactly the funding amount.
        // Surfaced here so the UI can caption it instead of letting it look like a
        // discrepancy every time someone adds the rows by hand.
        $stats['exit_reason_excludes_funding'] = round((float)($ch['funding_adjustment'] ?? 0), 2);

        // Size Integrity (v3.15.0 Phase 1) -- whole scope (same $where as everything else
        // on this page, so a month/year filter narrows it the same way it narrows every
        // other breakdown here). See getSizeIntegrity() docblock for why dollars-per-R
        // uses the resolved-only population while the ladder figures use every sized
        // trade regardless of outcome.
        $stats['size_integrity'] = $this->getSizeIntegrity($where, $p, $closedFilter);

        // Cumulative P&L + drawdown
        $cum_trades = $qa("SELECT id,trade_date,net_pnl FROM trades $where ORDER BY trade_date,id", $p);
        $starting_bal = floatval($ch['starting_balance'] ?? 10000);
        $running = 0; $peak = 0; $cum = [];
        foreach ($cum_trades as $i => $t) {
            $running += $t['net_pnl'];
            if ($running > $peak) $peak = $running;
            // Always peak-to-trough here, regardless of drawdown_type -- this is what
            // "Max Drawdown" below reports as the account's historical worst, and that
            // figure doesn't change meaning based on which rule the prop firm actually
            // enforces (see CLAUDE.md v3.14.7).
            $dd = ($peak > 0 && $starting_bal > 0) ? (($peak - $running) / $starting_bal) * 100 : 0;
            $cum[] = ['trade' => $i + 1, 'net_pnl' => round($t['net_pnl'], 2), 'cumulative' => round($running, 2), 'drawdown' => round($dd, 2), 'date' => $t['trade_date']];
        }
        $stats['cumulative'] = $cum;
        // "Max Drawdown" -- the account's historical worst, peak-to-trough, always (never
        // affected by drawdown_type; see CLAUDE.md v3.14.7 for why this stays fixed while
        // Current Drawdown below does not). Label this clearly as historical/worst-case in
        // the UI, not as "the number the prop firm judges you on right now" -- that's
        // Current Drawdown's job.
        $stats['max_drawdown_pct'] = count($cum) > 0 ? max(array_column($cum, 'drawdown')) : 0;

        // "Current Drawdown" (CLAUDE.md v3.14.7): 'static' (default) -- distance below
        // starting_balance, matching how Bitfunded's own Maximum Loss rule judges this
        // account (confirmed against its dashboard: 264.82 used of a 1,000 allowance =
        // 10,000 - 9,735.17). 'trailing' -- distance below the equity high-water mark
        // reached so far (the old, only behavior through v3.14.6) -- a stricter measure,
        // correct only if the prop firm's own rule genuinely is trailing.
        $drawdownType = $ch['drawdown_type'] ?? 'static';
        $stats['drawdown_type'] = $drawdownType;
        $stats['current_drawdown_pct'] = $drawdownType === 'trailing'
            ? (count($cum) > 0 ? end($cum)['drawdown'] : 0)
            : round(staticDrawdownPct($ch), 2);

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
        // Sidebar "DD: X%" widget -- always static, same reasoning as AlertController's
        // identical threshold check (helpers.php::staticDrawdownPct()).
        $stats['dd_pct'] = staticDrawdownPct($ch);

        jsonResponse($stats);
    }

    /**
     * Size Integrity (v3.15.0 Phase 1). Dollars-per-R and size_skew are computed over the
     * RESOLVED population only (exit_reason IN ('Take Profit','Stop Loss')) -- a
     * manually-closed trade's R is not the R that was actually risked, so it can't inform
     * how much a winner vs. a loser was sized (same reasoning ReviewEngineController's
     * computeSizeIntegrityMetrics() uses). Ladder adherence / tier-breach / deviation
     * figures instead look at every trade in scope with a backfilled actual_risk_pct
     * (open or closed) -- a sizing decision is real the moment a trade opens.
     *
     * Every figure whose own denominator is 0 returns the literal string 'UNAVAILABLE',
     * never a silent 0 or null cast to a number by the frontend.
     */
    private function getSizeIntegrity($where, $p, $closedFilter) {
        $NA = 'UNAVAILABLE';

        $byResult = [];
        $stmt = $this->db->prepare(
            "SELECT result, COALESCE(SUM(net_pnl),0) AS dollars, COALESCE(SUM(r_multiple),0) AS r
             FROM trades $where AND $closedFilter AND exit_reason IN ('Take Profit','Stop Loss')
             GROUP BY result"
        );
        $stmt->execute($p);
        foreach ($stmt->fetchAll() as $row) $byResult[$row['result']] = $row;

        $rcStmt = $this->db->prepare("SELECT COUNT(*) FROM trades $where AND $closedFilter AND exit_reason IN ('Take Profit','Stop Loss')");
        $rcStmt->execute($p);
        $resolvedN = (int)$rcStmt->fetchColumn();

        $winDollars = (float)($byResult['Win']['dollars'] ?? 0);
        $winR       = (float)($byResult['Win']['r'] ?? 0);
        $lossDollars = abs((float)($byResult['Loss']['dollars'] ?? 0));
        $lossR       = abs((float)($byResult['Loss']['r'] ?? 0));

        $dprWinners = $winR > 0 ? round($winDollars / $winR, 2) : null;
        $dprLosers  = $lossR > 0 ? round($lossDollars / $lossR, 2) : null;
        $sizeSkew   = ($dprWinners !== null && $dprWinners > 0 && $dprLosers !== null) ? round($dprLosers / $dprWinners, 3) : null;

        // v3.16.1 A5: tolerance widened +/-15% -> +/-20%, matching
        // ReviewEngineController::computeSizeIntegrityMetrics() -- see that method's
        // docblock for why (71.2% post-rebase adherence sat 1.2 points from the 70%
        // RISK_LADDER_DRIFT threshold, flickering on single trades either way).
        $sizedStmt = $this->db->prepare(
            "SELECT COUNT(*) AS n,
                    SUM(CASE WHEN ABS(risk_deviation_pct) <= 20 THEN 1 ELSE 0 END) AS within_tol,
                    SUM(CASE WHEN planned_risk_pct IS NOT NULL AND actual_risk_pct > planned_risk_pct * 1.15 THEN 1 ELSE 0 END) AS breaches,
                    MAX(ABS(risk_deviation_pct)) AS worst
             FROM trades $where AND actual_risk_pct IS NOT NULL"
        );
        $sizedStmt->execute($p);
        $sizedRow = $sizedStmt->fetch();
        $sizedN = (int)($sizedRow['n'] ?? 0);
        $ladderAdherence = $sizedN > 0 ? round(((int)$sizedRow['within_tol']) / $sizedN * 100, 1) : null;
        $worstDeviation = ($sizedRow && $sizedRow['worst'] !== null) ? round((float)$sizedRow['worst'], 2) : null;

        $monthStmt = $this->db->prepare(
            "SELECT DATE_FORMAT(trade_date,'%Y-%m') AS month, COUNT(*) AS n, AVG(risk_deviation_pct) AS avg_dev
             FROM trades $where AND actual_risk_pct IS NOT NULL AND risk_deviation_pct IS NOT NULL
             GROUP BY DATE_FORMAT(trade_date,'%Y-%m') ORDER BY month ASC"
        );
        $monthStmt->execute($p);
        $deviationByMonth = array_map(
            fn($r) => ['month' => $r['month'], 'avg_deviation_pct' => round((float)$r['avg_dev'], 2), 'n' => (int)$r['n']],
            $monthStmt->fetchAll()
        );

        return [
            'dollars_per_R_winners' => $dprWinners ?? $NA,
            'dollars_per_R_losers'  => $dprLosers ?? $NA,
            'size_skew'             => $sizeSkew ?? $NA,
            'resolved_n'            => $resolvedN,
            'ladder_adherence_rate' => $ladderAdherence ?? $NA,
            'tier_breach_count'     => $sizedN > 0 ? (int)$sizedRow['breaches'] : $NA,
            'worst_deviation'       => $worstDeviation ?? $NA,
            'deviation_by_month'    => $deviationByMonth,
            'sized_n'               => $sizedN,
        ];
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
