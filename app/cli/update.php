<?php
/**
 * FundedControl — Backtesting Phase 1a: Incremental Updater CLI
 *
 * CLI-only (see backtestRequireCli()) — never reachable over HTTP. Intended to run every
 * 15 minutes via a CloudPanel Cron Job (see docs/backtesting-pipeline.md for the exact
 * crontab line). Appends only CLOSED candles for every enabled symbol/timeframe —
 * backtestSyncForward()'s own closed-candle filter (shared with backfill.php) is what
 * guarantees the currently-forming candle is never written, per the briefing.
 *
 * A symbol/timeframe with no candle_sync row yet (never backfilled) is skipped with a
 * loud warning, not silently cold-started from 2020 — that's backfill.php's job, run
 * once by hand, not something a 15-minute cron should ever attempt on its own.
 *
 * Usage (normally invoked by cron with no arguments):
 *   php cli/update.php
 *   php cli/update.php --symbol=BTCUSDT --timeframe=15m   # manual/debug run against one pair
 */

require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../includes/bybit_client.php';
backtestRequireCli();

define('BACKTEST_LOG_FILE', dirname(__DIR__, 2) . '/backtesting-logs/update.log');

$args = backtestCliArgs($argv);
$onlySymbol = isset($args['symbol']) ? strtoupper((string) $args['symbol']) : null;
$onlyTimeframe = $args['timeframe'] ?? null;

$db = getDB();
$log = fn(string $m) => backtestLog(BACKTEST_LOG_FILE, $m);

try {
    $symbols = backtestActiveSymbols($db, $onlySymbol);
    $timeframes = backtestActiveTimeframes($onlyTimeframe);
} catch (InvalidArgumentException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

$nowMs = (int) (microtime(true) * 1000);
$grandTotal = 0;

foreach ($symbols as $symbol) {
    foreach ($timeframes as $timeframe) {
        $sync = backtestGetSyncState($db, $symbol, $timeframe);
        if ($sync['latest_open_time'] === null) {
            $log("[$symbol $timeframe] no candle_sync row yet — run backfill.php for this pair first. Skipped.");
            continue;
        }

        $stepMs = backtestTimeframeStepMs($timeframe);
        $cursor = (int) $sync['latest_open_time'] + $stepMs;
        if ($cursor >= $nowMs) {
            // Already current as of the last run within this same closed-candle window
            // (routine — e.g. the 1D pair between updater runs, most of the day).
            continue;
        }

        $n = backtestSyncForward($db, $symbol, $timeframe, $cursor, $nowMs, $nowMs, $log);
        $grandTotal += $n;
    }
}

$log("=== Update run complete — $grandTotal candles added ===");
