<?php
/**
 * FundedControl — Backtesting Phase 1a: Gap Repair CLI
 *
 * CLI-only (see backtestRequireCli()) — never reachable over HTTP. Re-detects gaps the
 * same way verify.php reports them (backtestDetectGaps(), bybit_client.php — one
 * definition of "what's missing," read by both scripts) and refetches each gap range
 * via the same backtestSyncForward() loop backfill.php/update.php use, bounded to just
 * that gap rather than paging all the way to "now."
 *
 * Re-verifies after repairing and reports what's left. A gap that still can't be filled
 * after a repair pass means Bybit itself has no data for that range (an exchange-side
 * halt, or a range predating the instrument's real listing that earliest-detection
 * mis-attributed) — reported explicitly as such, not retried forever.
 *
 * Usage:
 *   php cli/repair.php                       # every enabled symbol/timeframe
 *   php cli/repair.php --symbol=BTCUSDT --timeframe=15m
 */

require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../includes/bybit_client.php';
backtestRequireCli();

define('BACKTEST_LOG_FILE', dirname(__DIR__, 2) . '/backtesting-logs/repair.log');

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
$stillBroken = false;

foreach ($symbols as $symbol) {
    foreach ($timeframes as $timeframe) {
        $stepMs = backtestTimeframeStepMs($timeframe);
        $gaps = backtestDetectGaps($db, $symbol, $timeframe);

        if (empty($gaps)) {
            $log("[$symbol $timeframe] no gaps to repair.");
            continue;
        }

        foreach ($gaps as [$gapStart, $gapEnd]) {
            $log("[$symbol $timeframe] repairing " . gmdate('Y-m-d H:i:s', (int) ($gapStart / 1000)) . " .. " . gmdate('Y-m-d H:i:s', (int) ($gapEnd / 1000)) . " UTC...");
            backtestSyncForward($db, $symbol, $timeframe, $gapStart, $gapEnd + $stepMs, $nowMs, $log);
        }

        $remaining = backtestDetectGaps($db, $symbol, $timeframe);
        if (empty($remaining)) {
            $log("[$symbol $timeframe] repair complete — clean.");
        } else {
            $stillBroken = true;
            foreach ($remaining as [$rStart, $rEnd]) {
                $log("[$symbol $timeframe] STILL MISSING after repair: " . gmdate('Y-m-d H:i:s', (int) ($rStart / 1000)) . " .. " . gmdate('Y-m-d H:i:s', (int) ($rEnd / 1000)) . " UTC — Bybit itself may have no data for this range (exchange downtime, or a pre-listing range); not retried automatically.");
            }
        }
    }
}

$log($stillBroken ? '=== Repair complete — some gaps remain, see above ===' : '=== Repair complete — everything clean ===');
exit($stillBroken ? 1 : 0);
