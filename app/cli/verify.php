<?php
/**
 * FundedControl — Backtesting Phase 1a: Data Integrity Verify CLI
 *
 * CLI-only (see backtestRequireCli()) — never reachable over HTTP. Two checks, both
 * read-only (never writes to `candles` — repair.php is the only script that does):
 *
 *   1. Gap detection (always runs) — walks candle_sync's tracked [earliest, latest]
 *      range per symbol+timeframe and reports every missing open_time as a gap range.
 *      Uses backtestDetectGaps() (bybit_client.php), the same function repair.php reads
 *      to know what to refetch — one definition of "what's missing," not two.
 *
 *   2. Spot-check (opt-in via --spotcheck=N) — re-fetches N randomly chosen already-
 *      stored candles per symbol+timeframe straight from Bybit and compares OHLCV
 *      values against what's in the database, catching a class of defect gap detection
 *      structurally cannot: a row that exists at the right open_time but holds wrong
 *      values (a bad upsert, a since-corrected exchange revision, etc.).
 *
 * Usage:
 *   php cli/verify.php                              # gap report only, every symbol/timeframe
 *   php cli/verify.php --symbol=BTCUSDT
 *   php cli/verify.php --spotcheck=10               # + a 10-candle-per-pair value spot-check
 *
 * Exit code is 1 if any gap or spot-check mismatch was found (so this is safe to wire
 * into a monitoring/alerting cron later, in phase 1b or beyond), 0 if everything's clean.
 */

require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../includes/bybit_client.php';
backtestRequireCli();

define('BACKTEST_LOG_FILE', dirname(__DIR__, 2) . '/backtesting-logs/verify.log');
// Tolerance for the spot-check's numeric comparison — DECIMAL(20,10) storage vs. a
// freshly re-fetched string from Bybit should match exactly in the overwhelming
// majority of cases; a tiny epsilon absorbs only genuine floating-point noise from the
// PHP-side (float)-cast comparison itself, not real data drift.
const SPOTCHECK_EPSILON = 0.0000001;

$args = backtestCliArgs($argv);
$onlySymbol = isset($args['symbol']) ? strtoupper((string) $args['symbol']) : null;
$onlyTimeframe = $args['timeframe'] ?? null;
$spotcheckN = isset($args['spotcheck']) ? max(0, (int) $args['spotcheck']) : 0;

$db = getDB();
$log = fn(string $m) => backtestLog(BACKTEST_LOG_FILE, $m);

try {
    $symbols = backtestActiveSymbols($db, $onlySymbol);
    $timeframes = backtestActiveTimeframes($onlyTimeframe);
} catch (InvalidArgumentException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

$anyProblem = false;

foreach ($symbols as $symbol) {
    foreach ($timeframes as $timeframe) {
        $sync = backtestGetSyncState($db, $symbol, $timeframe);
        if ($sync['latest_open_time'] === null) {
            $log("[$symbol $timeframe] not backfilled yet — nothing to verify.");
            continue;
        }

        $gaps = backtestDetectGaps($db, $symbol, $timeframe);
        if (empty($gaps)) {
            $log("[$symbol $timeframe] clean — no gaps in [" . gmdate('Y-m-d', (int) ($sync['earliest_open_time'] / 1000)) . " .. " . gmdate('Y-m-d', (int) ($sync['latest_open_time'] / 1000)) . " UTC].");
        } else {
            $anyProblem = true;
            $stepMs = backtestTimeframeStepMs($timeframe);
            foreach ($gaps as [$gapStart, $gapEnd]) {
                $missingCount = (int) (($gapEnd - $gapStart) / $stepMs) + 1;
                $log("[$symbol $timeframe] GAP: " . gmdate('Y-m-d H:i:s', (int) ($gapStart / 1000)) . " .. " . gmdate('Y-m-d H:i:s', (int) ($gapEnd / 1000)) . " UTC ($missingCount candle" . ($missingCount === 1 ? '' : 's') . " missing)");
            }
        }

        if ($spotcheckN > 0) {
            $mismatches = backtestSpotCheck($db, $symbol, $timeframe, $spotcheckN, $log);
            if ($mismatches > 0) $anyProblem = true;
        }
    }
}

$log($anyProblem ? '=== Verify complete — problems found, see above ===' : '=== Verify complete — everything clean ===');
exit($anyProblem ? 1 : 0);

/**
 * Picks $n random already-stored open_times for $symbol/$timeframe, re-fetches each
 * individually from Bybit, and compares OHLCV. Logs every mismatch found (candle
 * removed/revised on Bybit's side, or a defect in what was originally stored) and
 * returns the mismatch count. A candle Bybit no longer returns at all for a spot-
 * checked open_time is logged distinctly from a value mismatch — the former can happen
 * legitimately for very old data on some exchanges, the latter should not happen at all.
 */
function backtestSpotCheck(PDO $db, string $symbol, string $timeframe, int $n, callable $log): int {
    $s = $db->prepare("SELECT open_time, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe=? ORDER BY RAND() LIMIT ?");
    $s->bindValue(1, $symbol);
    $s->bindValue(2, $timeframe);
    $s->bindValue(3, $n, PDO::PARAM_INT);
    $s->execute();
    $sample = $s->fetchAll();

    if (empty($sample)) {
        $log("[$symbol $timeframe] spot-check: no stored candles to sample.");
        return 0;
    }

    $stepMs = backtestTimeframeStepMs($timeframe);
    $mismatches = 0;

    foreach ($sample as $stored) {
        $openTime = (int) $stored['open_time'];
        try {
            $rows = bybitFetchKlines($symbol, $timeframe, $openTime, $openTime + $stepMs - 1, 5, $log);
        } catch (BybitApiException $e) {
            $log("[$symbol $timeframe] spot-check: ERROR re-fetching " . gmdate('Y-m-d H:i:s', (int) ($openTime / 1000)) . ": " . $e->getMessage());
            continue;
        }
        $fresh = null;
        foreach ($rows as $r) {
            if ($r['open_time'] === $openTime) { $fresh = $r; break; }
        }
        if ($fresh === null) {
            $mismatches++;
            $log("[$symbol $timeframe] spot-check MISMATCH: " . gmdate('Y-m-d H:i:s', (int) ($openTime / 1000)) . " is stored locally but Bybit no longer returns it.");
            continue;
        }

        $fields = ['open', 'high', 'low', 'close', 'volume'];
        $diffs = [];
        foreach ($fields as $f) {
            if (abs((float) $stored[$f] - (float) $fresh[$f]) > SPOTCHECK_EPSILON) {
                $diffs[] = "$f: stored={$stored[$f]} bybit={$fresh[$f]}";
            }
        }
        if ($diffs) {
            $mismatches++;
            $log("[$symbol $timeframe] spot-check MISMATCH at " . gmdate('Y-m-d H:i:s', (int) ($openTime / 1000)) . ": " . implode(', ', $diffs));
        }

        usleep(150000);
    }

    if ($mismatches === 0) {
        $log("[$symbol $timeframe] spot-check: {$n} candles sampled, all matched Bybit exactly.");
    }
    return $mismatches;
}
