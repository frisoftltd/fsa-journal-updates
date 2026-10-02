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

/** v3.22.3 Fix B — rounds a price to a believable number of decimals before it's stored
 *  or shown, same bucketed rule js/backtest.js::fmtPrice5() already uses for DISPLAY
 *  text (>=100 -> 2dp, >=1 -> 4dp, else 6dp) -- not a real per-symbol tick size (this app
 *  tracks none), same "don't invent precision this app can't back up" reasoning already
 *  applied to fee_rate_pct/liquidation elsewhere in this file. Applied to every
 *  user-entered price before it's written to backtest_pending_orders/trades (stop_loss,
 *  take_profit, limit_price) -- never to a market fill's entry_price, which already comes
 *  straight off a real candle's own close and needs no rounding of its own. */
function backtestRoundPrice(float $price): float {
    $abs = abs($price);
    $decimals = $abs >= 100 ? 2 : ($abs >= 1 ? 4 : 6);
    return round($price, $decimals);
}

/** v3.22.1 — margin required for a position: notional ÷ leverage. Returns the full
 *  notional (leverage has no effect) when leverage is 0 or less, a defensive floor —
 *  callers already validate leverage against a fixed allowed-values list before this is
 *  ever called in practice, same as backtestPositionSize()'s own zero-stop-distance
 *  floor above. */
function backtestMarginRequired(float $notional, float $leverage): float {
    return $leverage > 0 ? $notional / $leverage : $notional;
}

/**
 * v3.22.1 — a deliberately simplified estimated liquidation price: the price at which
 * the position's ENTIRE allocated margin is wiped out, ignoring maintenance-margin
 * buffers, funding, and fees (this app tracks none of a real exchange's maintenance-
 * margin schedule for any symbol, and modeling one without real data to calibrate
 * against would be inventing precision this app can't back up — the same reasoning
 * already applied to keeping fee_rate_pct a single flat number instead of guessing a
 * maker/taker split that turned out not to exist on this account either, see the
 * v3.22.0 calibration). A real exchange liquidates earlier than this estimate, never
 * later — this number is a conservative UPPER bound on how much room the position
 * actually has, appropriate for the one thing it's used for: flagging, before an order
 * is placed, that the stop can never realistically be reached because liquidation would
 * trigger first. Long: price has to FALL by 1/leverage of entry to wipe the margin.
 * Short: price has to RISE by the same fraction.
 */
function backtestLiquidationPrice(string $direction, float $entryPrice, float $leverage): float {
    if ($leverage <= 0) return $direction === 'Long' ? 0.0 : INF;
    $frac = 1 / $leverage;
    return $direction === 'Long' ? $entryPrice * (1 - $frac) : $entryPrice * (1 + $frac);
}

/** v3.22.1 — true when the estimated liquidation price sits BETWEEN entry and the stop,
 *  meaning price would reach liquidation before ever reaching the stop -- the stop can
 *  never realistically be hit. Long: both liquidation and stop are below entry;
 *  liquidation is "in the way" when it's ABOVE (closer to entry than) the stop. Short:
 *  both are above entry; liquidation is in the way when it's BELOW the stop. */
function backtestLiquidationBeforeStop(string $direction, float $liquidationPrice, float $stopLoss): bool {
    return $direction === 'Long' ? $liquidationPrice > $stopLoss : $liquidationPrice < $stopLoss;
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
    // v3.22.1 — the calibrated 0.04% default (CLAUDE.md v3.22.0), round-trip. Verify
    // item 7's own exact wording: qty * price * 0.04% * 2 (entry + exit, same price for
    // both sides in this synthetic case). 6.4 units at 780 -> one side = 6.4*780*0.0004
    // = 1.9968; round trip = 3.9936.
    $entryFee = backtestFee(6.4, 780, 0.04);
    $exitFee = backtestFee(6.4, 780, 0.04);
    $check('fee: one side at calibrated 0.04%', $entryFee, 1.9968);
    $check('fee: round trip = qty*price*0.04%*2 (both sides same price)', $entryFee + $exitFee, 6.4 * 780 * 0.0004 * 2);
    // Real trade 123 shape from the live calibration (different entry/exit prices) —
    // matches CLAUDE.md's own hand-verification: (6.4*782.51 + 6.4*766.07) * 0.0004.
    $realEntryFee = backtestFee(6.4, 782.51, 0.04);
    $realExitFee = backtestFee(6.4, 766.07, 0.04);
    $check('fee: real trade 123 shape, entry+exit total ~= 3.9644 (matches CLAUDE.md)', $realEntryFee + $realExitFee, 3.9643648);

    // v3.22.1 — margin required: notional / leverage.
    $check('margin: 1000 notional / 5x = 200', backtestMarginRequired(1000, 5), 200.0);
    $check('margin: 1000 notional / 1x = 1000 (no leverage effect)', backtestMarginRequired(1000, 1), 1000.0);
    $check('margin: zero/negative leverage floors to full notional', backtestMarginRequired(1000, 0), 1000.0);

    // v3.22.1 — estimated liquidation price (entry * (1 -/+ 1/leverage)).
    $check('liq: Long 5x, entry 100 -> 100*(1-0.2)=80', backtestLiquidationPrice('Long', 100, 5), 80.0);
    $check('liq: Short 5x, entry 100 -> 100*(1+0.2)=120', backtestLiquidationPrice('Short', 100, 5), 120.0);
    $check('liq: Long 20x, entry 100 -> 100*(1-0.05)=95', backtestLiquidationPrice('Long', 100, 20), 95.0);
    $check('liq: zero leverage floors to 0 for Long', backtestLiquidationPrice('Long', 100, 0), 0.0);
    // INF vs INF: the shared $check() comparator subtracts the two values for its
    // tolerance check, and INF - INF is NAN in PHP (any comparison against NAN is
    // false) -- a direct identity check instead, not a $check()-through-tolerance one,
    // since this is the one case in this whole self-test where an exact special float
    // value, not an approximately-equal one, is actually what's being asserted.
    $liqShortZeroLev = backtestLiquidationPrice('Short', 100, 0);
    if ($liqShortZeroLev === INF) { $pass++; } else { $fail++; fwrite(STDERR, "FAIL: liq: zero leverage floors to INF for Short — got " . var_export($liqShortZeroLev, true) . "\n"); }

    // v3.22.1 — liquidation-before-stop: Long 20x puts liq (95) ABOVE a wider stop (90)
    // -> liquidation hits first, the stop could never realistically be reached. Long 5x
    // puts liq (80) safely BELOW the same stop (90) -> stop is reachable first, fine.
    $check('liq-before-stop: Long 20x, stop 90 (liq 95 > stop 90) -> blocked', backtestLiquidationBeforeStop('Long', 95, 90), true);
    $check('liq-before-stop: Long 5x, stop 90 (liq 80 < stop 90) -> fine', backtestLiquidationBeforeStop('Long', 80, 90), false);
    $check('liq-before-stop: Short 20x, stop 110 (liq 105 < stop 110) -> blocked', backtestLiquidationBeforeStop('Short', 105, 110), true);
    $check('liq-before-stop: Short 5x, stop 110 (liq 120 > stop 110) -> fine', backtestLiquidationBeforeStop('Short', 120, 110), false);

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

    // v3.22.3 Fix B — same bucketed rounding js/backtest.js::fmtPrice5()/btRoundPrice()
    // use: >=100 -> 2dp, >=1 -> 4dp, else 6dp. The exact live report's own raw values.
    $check('round price: >=100 -> 2dp (live report\'s own raw SL)', backtestRoundPrice(7418.579327320573), 7418.58);
    $check('round price: >=1 -> 4dp', backtestRoundPrice(6.283185307), 6.2832);
    $check('round price: <1 -> 6dp', backtestRoundPrice(0.0044123456), 0.004412);
    $check('round price: exactly 100 uses the >=100 bucket (2dp)', backtestRoundPrice(100.456), 100.46);

    fwrite(STDOUT, "backtest_engine.php self-test: $pass passed, $fail failed\n");
    if ($fail > 0) exit(1);
}
