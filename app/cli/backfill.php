<?php
/**
 * FundedControl — Backtesting Phase 1a: Backfill CLI
 *
 * CLI-only (see backtestRequireCli() in bybit_client.php) — never reachable over HTTP.
 * Fetches every candle from a symbol's actual earliest available data (auto-detected,
 * never assumed) through "now," for one or every enabled symbol/timeframe, and upserts
 * them. Safe to interrupt and re-run at any time: it always resumes from
 * candle_sync.latest_open_time rather than re-walking history it already has, and every
 * write is an upsert keyed on (symbol, timeframe, open_time), so a re-fetched page can
 * never create a duplicate row.
 *
 * Usage (over SSH, from the site root):
 *   php cli/backfill.php                              # every enabled symbol, every timeframe
 *   php cli/backfill.php --symbol=BTCUSDT             # one symbol, every timeframe
 *   php cli/backfill.php --symbol=BTCUSDT --timeframe=1D
 *   php cli/backfill.php --from=2019-01-01            # override the default probe start (2020-01-01)
 *
 * See docs/backtesting-pipeline.md for the full runbook.
 */

require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../includes/bybit_client.php';
backtestRequireCli();

define('BACKTEST_LOG_FILE', dirname(__DIR__, 2) . '/backtesting-logs/backfill.log');
define('BACKTEST_DEFAULT_FROM', '2020-01-01');

$args = backtestCliArgs($argv);
$onlySymbol = isset($args['symbol']) ? strtoupper((string) $args['symbol']) : null;
$onlyTimeframe = $args['timeframe'] ?? null;
$fromDate = $args['from'] ?? BACKTEST_DEFAULT_FROM;
$fromMs = strtotime($fromDate . ' 00:00:00 UTC') * 1000;
if ($fromMs === false) {
    fwrite(STDERR, "Invalid --from date: $fromDate\n");
    exit(1);
}

$db = getDB();
$log = fn(string $m) => backtestLog(BACKTEST_LOG_FILE, $m);

try {
    $symbols = backtestActiveSymbols($db, $onlySymbol);
    $timeframes = backtestActiveTimeframes($onlyTimeframe);
} catch (InvalidArgumentException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

$log('=== Backfill run starting: symbols=' . implode(',', $symbols) . ' timeframes=' . implode(',', $timeframes) . ' from=' . $fromDate . ' ===');

foreach ($symbols as $symbol) {
    foreach ($timeframes as $timeframe) {
        $nowMs = (int) (microtime(true) * 1000);
        $stepMs = backtestTimeframeStepMs($timeframe);

        $sync = backtestGetSyncState($db, $symbol, $timeframe);
        $cursor = null;

        if ($sync['latest_open_time'] !== null) {
            $cursor = (int) $sync['latest_open_time'] + $stepMs;
            $log("[$symbol $timeframe] resuming from " . gmdate('Y-m-d H:i:s', (int) ($cursor / 1000)) . " UTC");
        } else {
            $log("[$symbol $timeframe] no prior sync — detecting earliest available candle from $fromDate...");
            try {
                $earliest = backtestFindEarliestOpenTime($symbol, $timeframe, $fromMs, $nowMs, $log);
            } catch (BybitApiException $e) {
                $log("[$symbol $timeframe] ERROR during earliest-candle detection: " . $e->getMessage() . " — skipping this pair for now, re-run to retry.");
                continue;
            }
            if ($earliest === null) {
                $log("[$symbol $timeframe] no data found anywhere in [$fromDate, now] — skipping.");
                continue;
            }
            $log("[$symbol $timeframe] earliest candle: " . gmdate('Y-m-d H:i:s', (int) ($earliest / 1000)) . " UTC");
            backtestUpdateSyncState($db, $symbol, $timeframe, $earliest, null);
            $cursor = $earliest;
        }

        $totalFetched = backtestSyncForward($db, $symbol, $timeframe, $cursor, $nowMs, $nowMs, $log);
        $log("[$symbol $timeframe] done — $totalFetched candles this run.");
    }

    // Roll the symbol-level earliest_candle_ms up from this symbol's own candle_sync
    // rows, now that at least one timeframe has (probably) been backfilled.
    $s = $db->prepare("SELECT MIN(earliest_open_time) AS earliest FROM candle_sync WHERE symbol=? AND earliest_open_time IS NOT NULL");
    $s->execute([$symbol]);
    $earliest = $s->fetchColumn();
    if ($earliest !== false && $earliest !== null) {
        $db->prepare("UPDATE symbols SET earliest_candle_ms=? WHERE symbol=?")->execute([$earliest, $symbol]);
    }
}

$log('=== Backfill run complete ===');
