<?php
/**
 * FundedControl — Backtest Engine: pure fill/P&L/drawdown math (Phase 1b, v3.20.0)
 *
 * Every function here is pure (no DB, no session, no I/O) specifically so the
 * financially-consequential logic — position sizing, fill P&L, fee, stop/target-touch
 * detection, drawdown distance — can be unit-tested standalone (see the self-test at
 * the bottom of this file, same `php includes/backtest_engine.php` convention as
 * bitfunded_parser.php and bybit_client.php) without a live database. BacktestController
 * is the only caller — it owns the DB-touching orchestration (loading a session,
 * writing trades, advancing the replay cursor) and calls these for the arithmetic.
 */

/** risk_amount = equity * risk% ÷ 100; lot_size = risk_amount ÷ stop distance. Returns
 *  0 if the stop distance is 0 (an invalid order — callers already reject entry==stop
 *  before this is ever called; this is a defensive floor, not a case expected in
 *  practice). */
function backtestPositionSize(float $equity, float $riskPct, float $entryPrice, float $stopLoss): float {
    $riskAmount = $equity * $riskPct / 100;
    $stopDistance = abs($entryPrice - $stopLoss);
    return $stopDistance > 0 ? $riskAmount / $stopDistance : 0.0;
}

/** Gross P&L for one fill — signed by direction, no ABS() masking a wrong-side stop/
 *  target the way CalculatorController::calculate()'s legacy rr_ratio does (see
 *  CLAUDE.md v3.16.0 for that exact defect elsewhere in this codebase). */
function backtestPnl(string $direction, float $entryPrice, float $exitPrice, float $lotSize): float {
    return ($direction === 'Long' ? ($exitPrice - $entryPrice) : ($entryPrice - $exitPrice)) * $lotSize;
}

/** One side's fee — charged independently on entry and exit, per the briefing ("Fees
 *  applied per fill"), not once per round-trip. */
function backtestFee(float $lotSize, float $price, float $feeRatePct): float {
    return $lotSize * $price * $feeRatePct / 100;
}

/**
 * Whether a bar's high/low range touches this position's stop-loss and/or take-profit,
 * evaluated bar-by-bar exactly as the briefing specifies ("Fills evaluated bar by bar
 * on the replay timeframe (high/low touch)"). Returns 'stop_loss', 'take_profit', or
 * null (neither touched).
 *
 * If a single bar's range touches BOTH levels, 'stop_loss' wins — OHLC data alone
 * cannot tell which was actually touched first intrabar, and assuming the worse
 * outcome for the trader is the conservative choice: it can only ever understate a
 * backtest's performance, never flatter it. Checked stop-loss first for exactly this
 * reason, not as an arbitrary ordering.
 */
function backtestCheckSlTp(string $direction, float $barHigh, float $barLow, float $stopLoss, ?float $takeProfit): ?string {
    $long = $direction === 'Long';
    $slHit = $long ? $barLow <= $stopLoss : $barHigh >= $stopLoss;
    if ($slHit) return 'stop_loss';
    if ($takeProfit !== null) {
        $tpHit = $long ? $barHigh >= $takeProfit : $barLow <= $takeProfit;
        if ($tpHit) return 'take_profit';
    }
    return null;
}

/**
 * Distance currently used against the max-drawdown allowance — 'static' measures from
 * starting_balance (matches how most real prop firms, and this codebase's own
 * staticDrawdownPct(), judge a Maximum Loss rule); 'trailing' measures from the
 * session's own equity high-water mark reached so far. Never negative — a session in
 * profit relative to the relevant basis has used none of its drawdown budget, not a
 * negative amount of it.
 */
function backtestDrawdownDistance(string $drawdownType, float $startingBalance, float $peakEquity, float $equity): float {
    $basis = $drawdownType === 'trailing' ? $peakEquity : $startingBalance;
    return max(0.0, $basis - $equity);
}

/**
 * v3.20.10 — combines N ascending-by-open_time raw candle rows into ONE synthetic
 * candle spanning all of them (open of the first, close of the last, high/low across
 * all, volume summed). Backs the replay window's timeframe switcher: displaying a
 * higher timeframe than the session's own replay timeframe while a candle at that
 * coarser resolution is still "in progress" requires building its elapsed portion from
 * the finer, already-revealed replay-timeframe candles — the stored higher-timeframe
 * series holds the real, COMPLETE future candle for that same window, which would leak
 * lookahead if read directly while replay hasn't reached its close yet. Expects each row
 * to have open_time/open/high/low/close/volume (BacktestController's own raw DB row
 * shape, before the open_time->time API rename) — returns null for an empty input.
 */
function backtestAggregateCandles(array $rows): ?array {
    if (empty($rows)) return null;
    $high = -INF;
    $low = INF;
    $volume = 0.0;
    foreach ($rows as $r) {
        $high = max($high, (float) $r['high']);
        $low = min($low, (float) $r['low']);
        $volume += (float) $r['volume'];
    }
    return [
        'open_time' => (int) $rows[0]['open_time'],
        'open' => (float) $rows[0]['open'],
        'high' => $high,
        'low' => $low,
        'close' => (float) $rows[count($rows) - 1]['close'],
        'volume' => $volume,
    ];
}

// ── SELF-TEST ────────────────────────────────────────────────────────────
// Run standalone: `php includes/backtest_engine.php` — no DB, no network. Same
// convention as bitfunded_parser.php/bybit_client.php's own self-tests.
if (PHP_SAPI === 'cli' && basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    backtest_engine_self_test();
}

function backtest_engine_self_test(): void {
    $pass = 0; $fail = 0;
    $check = function (string $label, $actual, $expected) use (&$pass, &$fail) {
        $ok = is_float($expected) ? (is_numeric($actual) && abs($actual - $expected) < 0.0001) : ($actual === $expected);
        if ($ok) { $pass++; return; }
        $fail++;
        fwrite(STDERR, "FAIL: $label — expected " . var_export($expected, true) . ", got " . var_export($actual, true) . "\n");
    };

    // Position sizing: $10,000 equity, 1% risk = $100 risk. Entry 100, stop 98 -> stop
    // distance 2 -> lot size 50.
    $check('position size: 1% of 10000 / 2-point stop = 50', backtestPositionSize(10000, 1, 100, 98), 50.0);
    $check('position size: zero stop distance floors to 0, not a division error', backtestPositionSize(10000, 1, 100, 100), 0.0);

    // P&L, both directions, both signs.
    $check('Long P&L, winning: (110-100)*50', backtestPnl('Long', 100, 110, 50), 500.0);
    $check('Long P&L, losing: (95-100)*50', backtestPnl('Long', 100, 95, 50), -250.0);
    $check('Short P&L, winning: (100-90)*50', backtestPnl('Short', 100, 90, 50), 500.0);
    $check('Short P&L, losing: (100-105)*50', backtestPnl('Short', 100, 105, 50), -250.0);

    // Fees: 50 units at 100 price, 0.055% -> 50*100*0.055/100 = 2.75.
    $check('fee: 50 * 100 * 0.055%', backtestFee(50, 100, 0.055), 2.75);

    // SL/TP touch detection — every combination for both directions.
    $check('Long: neither touched', backtestCheckSlTp('Long', 105, 99, 95, 110), null);
    $check('Long: SL only (low pierces stop)', backtestCheckSlTp('Long', 103, 94, 95, 110), 'stop_loss');
    $check('Long: TP only (high pierces target)', backtestCheckSlTp('Long', 111, 99, 95, 110), 'take_profit');
    $check('Long: BOTH touched in one bar -> stop-loss wins (conservative)', backtestCheckSlTp('Long', 111, 94, 95, 110), 'stop_loss');
    $check('Long: no take-profit set, SL only checked', backtestCheckSlTp('Long', 103, 94, 95, null), 'stop_loss');
    $check('Long: no take-profit set, nothing touched', backtestCheckSlTp('Long', 103, 99, 95, null), null);

    $check('Short: neither touched', backtestCheckSlTp('Short', 101, 95, 105, 90), null);
    $check('Short: SL only (high pierces stop)', backtestCheckSlTp('Short', 106, 99, 105, 90), 'stop_loss');
    $check('Short: TP only (low pierces target)', backtestCheckSlTp('Short', 101, 89, 105, 90), 'take_profit');
    $check('Short: BOTH touched in one bar -> stop-loss wins', backtestCheckSlTp('Short', 106, 89, 105, 90), 'stop_loss');

    // Drawdown distance — static vs trailing.
    $check('static distance: starting 10000, equity 9500 -> 500 used', backtestDrawdownDistance('static', 10000, 10800, 9500), 500.0);
    $check('trailing distance: peak 10800, equity 9500 -> 1300 used (from peak, not starting)', backtestDrawdownDistance('trailing', 10000, 10800, 9500), 1300.0);
    $check('distance never negative: equity above basis -> 0 used, not negative', backtestDrawdownDistance('static', 10000, 10000, 10500), 0.0);
    $check('static distance ignores peak entirely: same equity, different peak -> same distance', backtestDrawdownDistance('static', 10000, 15000, 9500), 500.0);

    // Candle aggregation — three 1H bars folding into one partial 4H bar.
    $check('aggregate: empty input -> null', backtestAggregateCandles([]), null);
    $threeHourBars = [
        ['open_time' => 1000, 'open' => 100, 'high' => 105, 'low' => 98, 'close' => 102, 'volume' => 10],
        ['open_time' => 2000, 'open' => 102, 'high' => 110, 'low' => 101, 'close' => 108, 'volume' => 20],
        ['open_time' => 3000, 'open' => 108, 'high' => 109, 'low' => 95, 'close' => 97, 'volume' => 15],
    ];
    $agg = backtestAggregateCandles($threeHourBars);
    $check('aggregate: open_time = first bar\'s', $agg['open_time'], 1000);
    $check('aggregate: open = first bar\'s open', $agg['open'], 100.0);
    $check('aggregate: close = last bar\'s close', $agg['close'], 97.0);
    $check('aggregate: high = max across all bars', $agg['high'], 110.0);
    $check('aggregate: low = min across all bars', $agg['low'], 95.0);
    $check('aggregate: volume = sum across all bars', $agg['volume'], 45.0);
    $oneBar = backtestAggregateCandles([['open_time' => 5000, 'open' => 50, 'high' => 55, 'low' => 48, 'close' => 52, 'volume' => 5]]);
    $check('aggregate: a single bar aggregates to itself', $oneBar, ['open_time' => 5000, 'open' => 50.0, 'high' => 55.0, 'low' => 48.0, 'close' => 52.0, 'volume' => 5.0]);

    fwrite(STDOUT, "backtest_engine.php self-test: $pass passed, $fail failed\n");
    if ($fail > 0) exit(1);
}
