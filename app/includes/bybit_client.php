<?php
/**
 * FundedControl — Bybit v5 Kline Client (Backtesting Phase 1a)
 *
 * Pure-ish helper: HTTP fetch + parsing + upsert + gap detection, shared by every CLI
 * script in app/cli/ (backfill, update, verify, repair). No auth/session logic here —
 * this file is loaded by CLI scripts that run outside the web request lifecycle, not by
 * any controller. Mirrors bitfunded_parser.php's role in this codebase: one file, one
 * external data source, every consumer of that source goes through it rather than each
 * writing its own fetch/parse logic.
 *
 * Bybit v5 public market data needs no API key (per the briefing) — every request here
 * is anonymous, category=linear (USDT perpetuals).
 */

class BybitApiException extends Exception {}

/**
 * Guard used by every script in app/cli/ — this file's whole reason to be split out of
 * app/includes/controllers/ is that these operations must never be reachable over HTTP
 * (the briefing's own "must not be reachable from the web" requirement for the backfill
 * script, applied here uniformly to update/verify/repair too, since all four share the
 * same DB-mutating/rate-limit-consuming nature). This is defense at the code level —
 * see docs/backtesting-pipeline.md for the matching nginx-level `deny` recommendation,
 * since a code-level guard alone shouldn't be the only thing standing between the
 * public internet and a script that can make outbound Bybit requests and write candles.
 */
function backtestRequireCli(): void {
    if (PHP_SAPI !== 'cli') {
        http_response_code(403);
        echo "403 Forbidden — this script is CLI-only.\n";
        exit(1);
    }
}

/** Minimal --key=value / --flag argv parser shared by every CLI script — no getopt()
 *  quirks to work around, just enough for this pipeline's own small, fixed option set. */
function backtestCliArgs(array $argv): array {
    $out = [];
    foreach (array_slice($argv, 1) as $arg) {
        if (substr($arg, 0, 2) !== '--') continue;
        $body = substr($arg, 2);
        if (strpos($body, '=') !== false) {
            [$k, $v] = explode('=', $body, 2);
            $out[$k] = $v;
        } else {
            $out[$body] = true;
        }
    }
    return $out;
}

/** Every enabled symbol, or a single one if $onlySymbol is given (validated: must exist
 *  AND be enabled — the same "read the symbol list, don't hardcode it" rule the briefing
 *  applies to the chart's own switcher applies here too). */
function backtestActiveSymbols(PDO $db, ?string $onlySymbol = null): array {
    if ($onlySymbol !== null) {
        $s = $db->prepare("SELECT symbol FROM symbols WHERE symbol=? AND enabled=1");
        $s->execute([$onlySymbol]);
        $row = $s->fetch();
        if (!$row) throw new InvalidArgumentException("Symbol \"$onlySymbol\" is not in the symbols table (or is disabled).");
        return [$row['symbol']];
    }
    $s = $db->query("SELECT symbol FROM symbols WHERE enabled=1 ORDER BY symbol");
    return array_column($s->fetchAll(), 'symbol');
}

/** Every known timeframe, or a single one if $onlyTimeframe is given. */
function backtestActiveTimeframes(?string $onlyTimeframe = null): array {
    $all = array_keys(backtestTimeframes());
    if ($onlyTimeframe === null) return $all;
    if (!in_array($onlyTimeframe, $all, true)) {
        throw new InvalidArgumentException("Unknown timeframe \"$onlyTimeframe\" — expected one of: " . implode(', ', $all));
    }
    return [$onlyTimeframe];
}

/** Appends a timestamped line to a log file, creating its directory if needed. Every CLI
 *  script uses this alongside plain STDOUT progress printing — STDOUT is what an
 *  interactive SSH session sees live, the log file is what's still there afterward
 *  (including for the cron-invoked updater, which has no interactive session at all). */
function backtestLog(string $file, string $message): void {
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0750, true);
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $message . "\n";
    file_put_contents($file, $line, FILE_APPEND);
    echo $line;
}

/** Bybit's own interval codes, and each timeframe's step in milliseconds. Single source
 *  of truth — every script maps a timeframe string to Bybit's code or a step size
 *  through this array, never a second hardcoded copy. */
function backtestTimeframes(): array {
    return [
        '15m' => ['interval' => '15', 'step_ms' => 15 * 60 * 1000],
        '1H'  => ['interval' => '60', 'step_ms' => 60 * 60 * 1000],
        '4H'  => ['interval' => '240', 'step_ms' => 4 * 60 * 60 * 1000],
        '1D'  => ['interval' => 'D', 'step_ms' => 24 * 60 * 60 * 1000],
    ];
}

function backtestTimeframeStepMs(string $timeframe): int {
    $tf = backtestTimeframes();
    if (!isset($tf[$timeframe])) {
        throw new InvalidArgumentException("Unknown timeframe \"$timeframe\" — expected one of: " . implode(', ', array_keys($tf)));
    }
    return $tf[$timeframe]['step_ms'];
}

/**
 * A candle at $openTimeMs for $timeframe is CLOSED once "now" has reached its close
 * time (open_time + step). Used by the incremental updater (and defensively by the
 * backfill script, in case a long-running backfill catches up to "now" mid-run) so the
 * still-forming candle is never written — per the briefing, "never store the currently
 * forming candle."
 */
function backtestCandleIsClosed(int $openTimeMs, string $timeframe, int $nowMs): bool {
    return ($openTimeMs + backtestTimeframeStepMs($timeframe)) <= $nowMs;
}

/**
 * One HTTP GET against Bybit v5 /v5/market/kline, with retry + exponential backoff on
 * transient failures (network error, HTTP 5xx, HTTP 429, or a Bybit retCode indicating
 * rate limiting). A non-transient failure (4xx other than 429, or a retCode that isn't
 * rate-limiting) throws immediately — retrying a genuinely bad request (e.g. an unknown
 * symbol) would just burn the same backoff budget for a result that can never succeed.
 *
 * Returns candles ascending by open_time, explicitly re-sorted here rather than trusted
 * from Bybit's own documented (descending/"reverse") order — sorting defensively costs
 * nothing and removes an entire class of bug if that ordering ever changes or varies by
 * endpoint version.
 *
 * $startMs/$endMs are both inclusive per Bybit's own contract. $limit is capped at 1000
 * (Bybit's own per-request maximum for this endpoint).
 */
function bybitFetchKlines(string $symbol, string $timeframe, int $startMs, int $endMs, int $limit = 1000, ?callable $log = null): array {
    $tf = backtestTimeframes();
    if (!isset($tf[$timeframe])) {
        throw new InvalidArgumentException("Unknown timeframe \"$timeframe\"");
    }
    $limit = max(1, min(1000, $limit));

    $url = 'https://api.bybit.com/v5/market/kline?' . http_build_query([
        'category' => 'linear',
        'symbol'   => $symbol,
        'interval' => $tf[$timeframe]['interval'],
        'start'    => $startMs,
        'end'      => $endMs,
        'limit'    => $limit,
    ]);

    $maxAttempts = 6;
    $backoffSeconds = 1;

    for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
            CURLOPT_USERAGENT      => 'FundedControl-Backtesting/1.0 (+https://fundedcontrol.com)',
        ]);
        $body = curl_exec($ch);
        $curlErrno = curl_errno($ch);
        $curlError = curl_error($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        // $reason set (not null) means "this attempt failed transiently, fall through
        // to the retry/backoff below"; every non-transient failure throws immediately
        // instead, so there's no separate flag to track alongside $reason.
        $reason = null;

        if ($curlErrno !== 0) {
            $reason = "cURL error ($curlErrno): $curlError";
        } elseif ($httpCode === 429 || $httpCode >= 500) {
            $reason = "HTTP $httpCode";
        } elseif ($httpCode !== 200) {
            throw new BybitApiException("Bybit request failed with HTTP $httpCode for $symbol $timeframe [$startMs,$endMs]: " . substr((string) $body, 0, 300));
        } else {
            $json = json_decode((string) $body, true);
            if (!is_array($json) || !array_key_exists('retCode', $json)) {
                $reason = 'Unparseable response body';
            } elseif ((int) $json['retCode'] !== 0) {
                // retCode 10006 / 10018 are Bybit's rate-limit codes; anything else is a
                // real error (bad symbol, bad params) that a retry cannot fix.
                if (in_array((int) $json['retCode'], [10006, 10018], true)) {
                    $reason = 'Bybit rate limit (retCode ' . $json['retCode'] . ')';
                } else {
                    throw new BybitApiException("Bybit API error for $symbol $timeframe: retCode {$json['retCode']} — " . ($json['retMsg'] ?? 'unknown'));
                }
            } else {
                $list = $json['result']['list'] ?? [];
                $rows = [];
                foreach ($list as $row) {
                    // Bybit kline row: [startTime, open, high, low, close, volume, turnover]
                    $rows[] = [
                        'open_time' => (int) $row[0],
                        'open'      => $row[1],
                        'high'      => $row[2],
                        'low'       => $row[3],
                        'close'     => $row[4],
                        'volume'    => $row[5],
                    ];
                }
                usort($rows, fn($a, $b) => $a['open_time'] <=> $b['open_time']);
                return $rows;
            }
        }

        if ($attempt === $maxAttempts) {
            throw new BybitApiException("Bybit request failed after $maxAttempts attempts for $symbol $timeframe [$startMs,$endMs]: $reason");
        }
        if ($log) $log("  retry $attempt/$maxAttempts after $reason — sleeping {$backoffSeconds}s");
        sleep($backoffSeconds);
        $backoffSeconds = min(60, $backoffSeconds * 2);
    }

    // Unreachable — the loop above always returns or throws — but keeps static analysis
    // and callers honest about the function's real return type.
    throw new BybitApiException("Bybit request exhausted retries for $symbol $timeframe [$startMs,$endMs]");
}

/**
 * Pages forward from $cursorMs up to (not including) $untilMs, fetching/filtering/
 * upserting one page (1000 candles' worth of time) at a time and advancing
 * candle_sync.latest_open_time after each successful page (only ever upward — see
 * backtestUpdateSyncState()'s own CASE logic — so this is safe to call with an $untilMs
 * below the already-tracked latest without corrupting that bookkeeping). Shared by:
 *   - backfill.php (after it determines a starting cursor, detecting the earliest
 *     candle on a first run) and update.php (which only ever resumes from an existing
 *     candle_sync row) — both pass $untilMs === $nowMs, i.e. "page all the way to now."
 *   - repair.php — pages only up to one gap's own end ($untilMs = gap end + one step),
 *     while still passing the REAL current time as $nowMs so the closed-candle filter's
 *     semantics stay correct regardless of how far in the past the gap is.
 * Centralizing this loop means all three scripts apply the identical closed-candle
 * filter and the identical "advance past an empty window rather than loop forever"
 * rule — two copies of this exact loop drifting apart on either of those would be the
 * kind of silent behavioral split this codebase has been bitten by before whenever the
 * same computation was written out twice (see helpers.php's own challengeBalance()
 * docblock for a recent, concrete instance of that lesson).
 *
 * Returns the number of candles written this call. Stops (without throwing) on the
 * first unrecoverable Bybit error, logging it — the caller's next scheduled run (cron,
 * or a manual re-run) resumes from wherever candle_sync was last successfully advanced
 * to, per this whole pipeline's resumable-by-design contract.
 */
function backtestSyncForward(PDO $db, string $symbol, string $timeframe, int $cursorMs, int $untilMs, int $nowMs, callable $log): int {
    $stepMs = backtestTimeframeStepMs($timeframe);
    // v3.19.3 fix: this was `$stepMs * 1000`, an inclusive [cursorMs, cursorMs +
    // 1000*stepMs] window spanning 1001 candle slots (cursorMs, cursorMs+step, ...,
    // cursorMs+1000*step) requested with limit=1000. Bybit's start/end are both
    // inclusive, so a window meant to hold exactly `limit` candles has to span
    // `limit - 1` steps, not `limit` steps -- the one-slot overshoot forced Bybit to
    // drop a candle to fit the limit every time a page was actually full, and it
    // dropped it from the window's own start: the candle at exactly `cursorMs` itself,
    // which is always the very next candle after the previous page's last stored one
    // (cursorMs is set to lastOpenTime + stepMs below). That's exactly the reported
    // symptom -- a single-candle gap landing precisely at every page boundary.
    $pageWindowMs = $stepMs * 999;
    $total = 0;

    while ($cursorMs < $untilMs) {
        $windowEnd = min($cursorMs + $pageWindowMs, $untilMs);
        try {
            $rows = bybitFetchKlines($symbol, $timeframe, $cursorMs, $windowEnd, 1000, $log);
        } catch (BybitApiException $e) {
            $log("[$symbol $timeframe] ERROR fetching page starting " . gmdate('Y-m-d H:i:s', (int) ($cursorMs / 1000)) . ": " . $e->getMessage() . " — stopping, next run resumes from the last successful page.");
            break;
        }

        // Never store the currently-forming candle — only reachable when $untilMs is
        // itself "now" (backfill/update's own call shape) and the final page's window
        // extends into it; a no-op filter for repair.php's historical gap ranges, which
        // are always safely in the past relative to the real $nowMs passed in.
        $rows = array_values(array_filter($rows, fn($r) => backtestCandleIsClosed($r['open_time'], $timeframe, $nowMs)));

        if (empty($rows)) {
            $cursorMs = $windowEnd; // nothing in this window — advance past it, don't loop forever
            continue;
        }

        $n = backtestUpsertCandles($db, $symbol, $timeframe, $rows);
        $lastOpenTime = end($rows)['open_time'];
        backtestUpdateSyncState($db, $symbol, $timeframe, null, $lastOpenTime);
        $total += $n;
        $log("[$symbol $timeframe] +{$n} candles, through " . gmdate('Y-m-d H:i:s', (int) ($lastOpenTime / 1000)) . " UTC");

        $cursorMs = $lastOpenTime + $stepMs;
        usleep(150000); // 150ms courteous pacing between successful requests
    }

    return $total;
}

/**
 * Batched upsert — one multi-row INSERT ... ON DUPLICATE KEY UPDATE per call, keyed on
 * the (symbol, timeframe, open_time) primary key. This is what makes both the backfill
 * script and the incremental updater safe to re-run over an already-stored range: a
 * re-fetched candle just overwrites itself with (should be) the same values, never
 * duplicating a row. Returns the number of rows in $candles (not MySQL's own affected-
 * rows count, which double-counts an UPDATE branch under ON DUPLICATE KEY — the caller
 * wants "how many candles did I just process," not that MySQL-specific quirk).
 */
function backtestUpsertCandles(PDO $db, string $symbol, string $timeframe, array $candles): int {
    if (empty($candles)) return 0;

    $placeholders = [];
    $params = [];
    foreach ($candles as $c) {
        // 8 columns (symbol, timeframe, open_time, open, high, low, close, volume) -> 8
        // placeholders. Counted explicitly here, not assumed, per this codebase's own
        // history with exactly this class of bug (CLAUDE.md v3.16.2 — a placeholder
        // count silently drifting from the bound-value count is an HY093 on every call).
        $placeholders[] = '(?,?,?,?,?,?,?,?)';
        array_push($params, $symbol, $timeframe, $c['open_time'], $c['open'], $c['high'], $c['low'], $c['close']);
        $params[] = $c['volume'];
    }
    // MySQL 8.4 target -- uses the row-alias ON DUPLICATE KEY UPDATE syntax (8.0.19+),
    // not VALUES(), which is deprecated as of 8.0.20. v3.19.1: re-checked against the
    // ambiguous-column bug found in backtestUpdateSyncState()'s otherwise-identical
    // pattern -- every reference here is already qualified (`new.col`), with no bare
    // column name anywhere in the UPDATE clause, so this statement doesn't carry the
    // same defect. Confirmed by inspection, not by executing it against a live
    // MySQL 8.4 instance (none available in this environment) -- the first real
    // backfill run is still this statement's actual first test.
    $sql = "INSERT INTO candles (symbol, timeframe, open_time, open, high, low, close, volume) VALUES "
        . implode(',', $placeholders)
        . " AS new ON DUPLICATE KEY UPDATE open=new.open, high=new.high, low=new.low, close=new.close, volume=new.volume";
    $db->prepare($sql)->execute($params);
    return count($candles);
}

/** Reads (or lazily creates) a symbol+timeframe's candle_sync row. Never returns null —
 *  a symbol+timeframe with no prior sync reads back as all-NULL earliest/latest, which
 *  every caller already treats as "never backfilled" rather than a special case. */
function backtestGetSyncState(PDO $db, string $symbol, string $timeframe): array {
    $s = $db->prepare("SELECT earliest_open_time, latest_open_time, last_synced_at FROM candle_sync WHERE symbol=? AND timeframe=?");
    $s->execute([$symbol, $timeframe]);
    $row = $s->fetch();
    if ($row) return $row;
    return ['earliest_open_time' => null, 'latest_open_time' => null, 'last_synced_at' => null];
}

/** Upserts candle_sync's own tracking row. $earliest/$latest are each only written when
 *  non-null AND (for $earliest) lower than what's already stored / (for $latest) higher
 *  than what's already stored — a repair run touching an isolated gap in the middle of
 *  an already-wide range must never accidentally narrow the recorded range. */
function backtestUpdateSyncState(PDO $db, string $symbol, string $timeframe, ?int $earliest, ?int $latest): void {
    // v3.19.1 fix: once a row alias (`AS new`) is present, MySQL 8.4 requires EVERY
    // column reference in the UPDATE clause to be qualified -- `new.col` for the row
    // being inserted, `candle_sync.col` for the existing stored row. A bare, unqualified
    // `col` (what this originally said, modeled on the old VALUES()-based convention
    // where an unqualified name unambiguously meant "the current row") is genuinely
    // ambiguous once the alias exists, not just deprecated -- confirmed against the
    // live PDOException this fixes: "1052 Column 'earliest_open_time' in field list is
    // ambiguous," thrown on the very first backfill write. The LHS assignment targets
    // (`earliest_open_time =`, etc.) are unaffected -- those are always the bare target
    // table's own column name, never the alias, in both MySQL 5.7's and 8.4's syntax.
    $db->prepare(
        "INSERT INTO candle_sync (symbol, timeframe, earliest_open_time, latest_open_time, last_synced_at)
         VALUES (?, ?, ?, ?, NOW())
         AS new
         ON DUPLICATE KEY UPDATE
            earliest_open_time = CASE WHEN new.earliest_open_time IS NOT NULL
                AND (candle_sync.earliest_open_time IS NULL OR new.earliest_open_time < candle_sync.earliest_open_time)
                THEN new.earliest_open_time ELSE candle_sync.earliest_open_time END,
            latest_open_time = CASE WHEN new.latest_open_time IS NOT NULL
                AND (candle_sync.latest_open_time IS NULL OR new.latest_open_time > candle_sync.latest_open_time)
                THEN new.latest_open_time ELSE candle_sync.latest_open_time END,
            last_synced_at = NOW()"
    )->execute([$symbol, $timeframe, $earliest, $latest]);
}

/**
 * Probes forward from $probeFromMs to find the first candle Bybit actually has for a
 * symbol+timeframe — needed because a symbol can list well after the pipeline's default
 * 2020-01-01 start, and the briefing requires detecting that rather than failing.
 * Each probe window is exactly one full page (1000 candles) wide, so a symbol listed
 * years after $probeFromMs still resolves in a handful of requests, not thousands.
 * Returns null only if the symbol has no data anywhere in [$probeFromMs, $nowMs] — every
 * caller treats that as "nothing to backfill yet," not an error.
 */
function backtestFindEarliestOpenTime(string $symbol, string $timeframe, int $probeFromMs, int $nowMs, ?callable $log = null): ?int {
    // v3.19.3 fix: same fencepost error as backtestSyncForward() (see its own comment)
    // -- an inclusive [cursor, cursor + 1000*stepMs] window is 1001 candle slots for a
    // limit=1000 request. Found and fixed proactively while tracking down the reported
    // page-boundary gaps: this function shares the identical formula, so any symbol
    // whose very first probe window actually contained >=1001 real candles (true for
    // every symbol traded continuously since well before its own probe start) would
    // have had its recorded earliest_open_time land one interval LATE, silently
    // dropping that symbol+timeframe's true first candle before candle_sync ever knew
    // to expect it. Not separately reported (verify.php's own gap-walk should already
    // flag this as a [earliest,earliest] gap once earliest_open_time is corrected by a
    // fresh backfill, same as any other detected gap), but it's the same defect in the
    // same file and needed the same fix.
    $stepMs = backtestTimeframeStepMs($timeframe);
    $windowMs = $stepMs * 999;
    $cursor = $probeFromMs;

    while ($cursor < $nowMs) {
        $windowEnd = min($cursor + $windowMs, $nowMs);
        $rows = bybitFetchKlines($symbol, $timeframe, $cursor, $windowEnd, 1000, $log);
        if (!empty($rows)) {
            return $rows[0]['open_time'];
        }
        $cursor = $windowEnd;
        usleep(150000); // 150ms pacing between probe requests — see bybitFetchKlines()'s own header for why this isn't a hard rate limit, just courteous spacing
    }
    return null;
}

/**
 * Gap detection for one symbol+timeframe, over [earliest_open_time, latest_open_time]
 * as recorded in candle_sync — not a fresh MIN/MAX(candles.open_time) scan, since
 * candle_sync IS the tracked, authoritative range (see its own table comment in the
 * migration). Walks the actual stored open_time values once, in order, and reports
 * every place the gap between two consecutive rows is wider than one step — including
 * a gap of exactly one missing candle. Returns a list of [gap_start_ms, gap_end_ms]
 * pairs, each an inclusive range of MISSING open_times (i.e. the range repair.php should
 * refetch), or an empty array if the range is clean. Returns an empty array (not an
 * error) when there's nothing tracked yet — nothing to verify before a first backfill.
 */
function backtestDetectGaps(PDO $db, string $symbol, string $timeframe): array {
    $sync = backtestGetSyncState($db, $symbol, $timeframe);
    if ($sync['earliest_open_time'] === null || $sync['latest_open_time'] === null) return [];

    $stepMs = backtestTimeframeStepMs($timeframe);
    $s = $db->prepare("SELECT open_time FROM candles WHERE symbol=? AND timeframe=? AND open_time BETWEEN ? AND ? ORDER BY open_time ASC");
    $s->execute([$symbol, $timeframe, $sync['earliest_open_time'], $sync['latest_open_time']]);
    $times = array_map('intval', array_column($s->fetchAll(), 'open_time'));

    $gaps = [];
    $expected = (int) $sync['earliest_open_time'];
    foreach ($times as $t) {
        if ($t > $expected) {
            $gaps[] = [$expected, $t - $stepMs];
        }
        $expected = $t + $stepMs;
    }
    // A gap running all the way to the tracked latest_open_time (e.g. every row from
    // some point onward is missing) wouldn't be caught by the loop above, since there's
    // no "next" row to notice it against — checked explicitly here.
    if ($expected <= (int) $sync['latest_open_time']) {
        $gaps[] = [$expected, (int) $sync['latest_open_time']];
    }
    return $gaps;
}

// ── SELF-TEST ────────────────────────────────────────────────────────────
// Run standalone: `php includes/bybit_client.php` (no DB, no network — same convention
// as bitfunded_parser.php's own self-test at the bottom of that file). Not executed
// when this file is require_once'd by the CLI scripts.
if (PHP_SAPI === 'cli' && basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    backtest_self_test();
}

function backtest_self_test(): void {
    $pass = 0; $fail = 0;
    $check = function (string $label, $actual, $expected) use (&$pass, &$fail) {
        if ($actual === $expected) { $pass++; return; }
        $fail++;
        fwrite(STDERR, "FAIL: $label — expected " . var_export($expected, true) . ", got " . var_export($actual, true) . "\n");
    };

    $check('15m step', backtestTimeframeStepMs('15m'), 15 * 60 * 1000);
    $check('1H step', backtestTimeframeStepMs('1H'), 60 * 60 * 1000);
    $check('4H step', backtestTimeframeStepMs('4H'), 4 * 60 * 60 * 1000);
    $check('1D step', backtestTimeframeStepMs('1D'), 24 * 60 * 60 * 1000);

    $open = 1700000000000;
    $step = backtestTimeframeStepMs('15m');
    $check('candle exactly at its own close time is closed', backtestCandleIsClosed($open, '15m', $open + $step), true);
    $check('candle one ms before its close time is not yet closed', backtestCandleIsClosed($open, '15m', $open + $step - 1), false);

    $args = backtestCliArgs(['backfill.php', '--symbol=BTCUSDT', '--timeframe=15m', '--dry-run']);
    $check('parses --key=value', $args['symbol'] ?? null, 'BTCUSDT');
    $check('parses bare flag', $args['dry-run'] ?? null, true);

    // v3.19.3 — the actual regression test: simulate a Bybit-like data source and a
    // multi-page fetch loop shaped exactly like backtestSyncForward()'s real one
    // (same window-width formula, same cursor-advance-by-one-step rule), and assert
    // the union of pages contains every expected open_time with no gap at the seams.
    // $fakeBybit below replicates the real defect's actual mechanism: given an
    // inclusive [start,end] window containing more than $limit real candles, an
    // exchange kline API returns only the LATEST $limit of them, silently dropping
    // candles from the window's own start -- exactly what happened when the window was
    // sized for 1001 slots against a limit of 1000.
    $fakeBybit = function (array $allTimes, int $startMs, int $endMs, int $limit): array {
        $matches = array_values(array_filter($allTimes, fn($t) => $t >= $startMs && $t <= $endMs));
        return count($matches) > $limit ? array_slice($matches, -$limit) : $matches;
    };
    $pageForward = function (array $allTimes, int $earliest, int $nowMs, int $stepMs, int $pageWindowMs) use ($fakeBybit): array {
        $cursor = $earliest;
        $collected = [];
        while ($cursor < $nowMs) {
            $windowEnd = min($cursor + $pageWindowMs, $nowMs);
            $page = $fakeBybit($allTimes, $cursor, $windowEnd, 1000);
            if (empty($page)) { $cursor = $windowEnd; continue; }
            foreach ($page as $t) $collected[$t] = true;
            $cursor = end($page) + $stepMs; // same "last_open_time + one interval" rule as backtestSyncForward()
        }
        return $collected;
    };

    $stepMs = backtestTimeframeStepMs('15m');
    $earliest = 1700000000000;
    $totalCandles = 2500; // spans multiple 1000-candle pages, forcing real page boundaries
    $allTimes = [];
    for ($i = 0; $i < $totalCandles; $i++) $allTimes[] = $earliest + $i * $stepMs;
    $nowMs = end($allTimes) + $stepMs; // one step past the last candle's open time, so it counts as closed

    $fixedWindowMs = $stepMs * 999; // the corrected formula (1000 inclusive slots, matching limit exactly)
    $collectedFixed = $pageForward($allTimes, $earliest, $nowMs, $stepMs, $fixedWindowMs);
    $check('fixed formula: union of pages has exactly the expected candle count', count($collectedFixed), $totalCandles);
    $missingFixed = array_values(array_filter($allTimes, fn($t) => !isset($collectedFixed[$t])));
    $check('fixed formula: every single expected open_time is present, none missing at any seam', $missingFixed, []);

    // Regression guard: prove this test actually exercises the bug class being fixed,
    // not just a formula that happens to always pass regardless of window width. The
    // OLD, buggy width (*1000, one slot too many for an inclusive range against a
    // limit of 1000) must demonstrably drop candles against the exact same synthetic
    // data and fake API.
    $buggyWindowMs = $stepMs * 1000;
    $collectedBuggy = $pageForward($allTimes, $earliest, $nowMs, $stepMs, $buggyWindowMs);
    $check('sanity: the old (buggy) window formula DOES drop candles at page seams against this same data', count($collectedBuggy) < $totalCandles, true);

    fwrite(STDOUT, "bybit_client.php self-test: $pass passed, $fail failed\n");
    if ($fail > 0) exit(1);
}
