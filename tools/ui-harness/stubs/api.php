<?php
/**
 * UI harness stub for includes/api.php -- replaces the real router/controller stack
 * entirely (no DB in this harness at all). Covers the Backtesting order-ticket AND
 * running-trade-display flows, plus the handful of actions every page fires
 * unconditionally from js/app.js's DOMContentLoaded handler, so that startup sequence
 * doesn't throw and abort before _restoreFromHash() ever runs.
 *
 * v3.22.3 — now STATEFUL for sessions 20/21/22 (mockSessionConfig() below), so the new
 * running-trade display can be verified end-to-end: a real Place Trade, a real Next Bar
 * advancing the mock's own cursor and checking SL/TP touches, a real rewind undoing them.
 * State lives in mock_state.json, written next to this file inside the harness's own
 * temp copy of app/ -- a fresh copy every run (setup.js), so state always starts clean.
 * Session 6 is UNCHANGED from v3.22.2 (inert placeOrder, no state file) --
 * tools/ui-harness/drive.mjs (the v3.22.2 regression driver) still runs against it
 * exactly as before; the new v3.22.3 scenarios live on their own session ids specifically
 * so extending this mock could never silently break that existing coverage.
 *
 * Extend this file's $ACTION dispatch as future UI releases need more of the app mocked
 * -- this harness is meant to be reused (see CLAUDE.md's v3.22.1/v3.22.2/v3.22.3
 * sections), not rebuilt per release.
 */
header('Content-Type: application/json');

function out($data) { echo json_encode($data); exit; }

const TIMEFRAME_STEP_MS = ['15m' => 900000, '1H' => 3600000, '4H' => 14400000, '1D' => 86400000];

// ════════════════════════════════════════════════════════════════════════════
// LEGACY (v3.22.2) — session 6, inert placeOrder, unchanged
// ════════════════════════════════════════════════════════════════════════════

const MOCK_SESSION_ID = 6;
// Fixed instant so every run is deterministic -- 2025-06-01T00:00:00Z.
const MOCK_REPLAY_CURSOR_MS = 1748736000000;

function mockSessionSummary(): array {
    return [
        'id' => MOCK_SESSION_ID,
        'session_name' => 'UI Harness Session',
        'symbol' => 'BTCUSDT',
        'blind_mode' => false,
        'replay_timeframe' => '1H',
        'status' => 'active',
        'risk_pct' => 1.0,
        'fee_rate_pct' => 0.04,
        'default_leverage' => 5,
        'risk_ladder' => [
            ['lower_pct' => 0, 'upper_pct' => 100, 'risk_pct' => 1.0],
            ['lower_pct' => 100, 'upper_pct' => null, 'risk_pct' => 0.5],
        ],
        'use_flat_risk' => true,
        'starting_balance' => 10000.0,
        'profit_target_pct' => 10.0,
        'daily_drawdown_pct' => 5.0,
        'max_drawdown_pct' => 10.0,
        'drawdown_type' => 'static',
        'max_trades_per_day' => null,
        'replay_cursor_ms' => MOCK_REPLAY_CURSOR_MS,
        'start_time' => MOCK_REPLAY_CURSOR_MS - 400 * 3600 * 1000,
        'equity' => 10000.0,
        'floating_pnl' => 0.0,
        'peak_equity' => 10000.0,
        'today_change' => 0.0,
        'progress_to_target_pct' => 0.0,
        'daily_drawdown_used_pct' => 0.0,
        'max_drawdown_used_pct' => 0.0,
        'trades_today' => 0,
        'trade_count' => 0,
        'trading_days' => 0,
        'fail_reason' => null,
        'fail_bar_time' => null,
        'fail_equity' => null,
        'passed_at_bar_time' => null,
        'passed_trading_days' => null,
        'passed_trade_count' => null,
        'rewind_count' => 0,
        'created_at' => gmdate('c'),
    ];
}

/** A deterministic synthetic random walk (fixed seed, same every run/request -- this
 *  mock has no persistence between requests, so "deterministic" is the only way repeat
 *  requests for the same window return consistent-looking data). $beforeMs, when given,
 *  is the exclusive upper bound (older-candle pagination); otherwise the walk ends
 *  exactly at MOCK_REPLAY_CURSOR_MS, matching the real API's own "last candle is the
 *  replay cursor" contract. */
function mockCandles(int $limit, ?int $beforeMs, string $timeframe): array {
    $stepMs = TIMEFRAME_STEP_MS[$timeframe] ?? 3600000;
    $endMs = $beforeMs !== null ? ($beforeMs - $stepMs) : MOCK_REPLAY_CURSOR_MS;

    mt_srand(42);
    $price = 8500.0;
    $candles = [];
    for ($i = $limit - 1; $i >= 0; $i--) {
        $open = $price;
        $delta = (mt_rand(-100, 100) / 100) * ($open * 0.004);
        $close = max(1.0, $open + $delta);
        $high = max($open, $close) + abs($delta) * 0.3;
        $low = min($open, $close) - abs($delta) * 0.3;
        $candles[] = [
            'time' => (int) ($endMs - $i * $stepMs),
            'open' => round($open, 2),
            'high' => round($high, 2),
            'low' => round($low, 2),
            'close' => round($close, 2),
            'volume' => mt_rand(10, 500),
        ];
        $price = $close;
    }
    return $candles;
}

// ════════════════════════════════════════════════════════════════════════════
// v3.22.3 — STATEFUL mock for sessions 20 (fresh/place+advance+rewind), 21
// (pre-seeded open positions + pending order), 22 (daily cap reached)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A smooth, fully deterministic, O(1) price curve: any bar's price is a pure function of
 * its own absolute index from the session's origin, independent of which request/window
 * asked for it. The legacy mockCandles() above reseeds mt_rand() at the START of every
 * single request and walks forward from index 0 of THAT request's own window -- fine
 * when nothing needs two different requests to agree about "bar #N's price" (session 6
 * never does), but get_backtest_candles() and backtest_advance() now both have to
 * describe the exact same bar identically for a stateful session, which a per-request
 * random walk can't guarantee. A sine composite is also easy to reason about by hand
 * when picking an SL/TP a specific future bar is guaranteed to touch (see
 * mockSessionConfig()'s own scenarios below) -- found by running this exact function via
 * `php stubs/api.php <from> <to>` (see the CLI block at the bottom of this file) rather
 * than guessed.
 */
function mockPriceAtIndex(int $index): float {
    return 8500.0
        + 250 * sin($index / 15)
        + 80 * sin($index / 4.3 + 1.1)
        + 30 * sin($index * 1.7);
}
function mockCandleAtIndex(int $index, int $originMs, int $stepMs): array {
    $close = mockPriceAtIndex($index);
    $open = mockPriceAtIndex($index - 1);
    $high = max($open, $close) + 15 + 10 * abs(sin($index * 3.3));
    $low = min($open, $close) - 15 - 10 * abs(sin($index * 5.1));
    return [
        'time' => $originMs + $index * $stepMs,
        'open' => round($open, 2), 'high' => round($high, 2), 'low' => round($low, 2), 'close' => round($close, 2),
        'volume' => 100 + ($index % 50) * 5,
    ];
}

const MOCK_ORIGIN_MS = 1577836800000; // 2020-01-01T00:00:00Z -- arbitrary fixed origin

/** Static per-scenario config. cursor_index/start_index are in bars (1H), picked by
 *  inspecting mockPriceAtIndex()'s own output (see this file's CLI mode) so each
 *  scenario's SL/TP values below are guaranteed to behave as described, not guessed. */
function mockSessionConfig(int $id): ?array {
    switch ($id) {
        // Fresh session: nothing open yet. Entry at index 400 (close 8769.54); TP 8850 is
        // first touched by index 404's high (8853.38) -- exactly 4 Next Bar clicks away.
        // SL 8600 is never approached in that window (lowest low 401-404 is ~8721).
        case 20: return ['symbol' => 'BTCUSDT', 'timeframe' => '1H', 'start_index' => 380, 'cursor_index' => 400, 'scenario' => 'fresh'];
        // Pre-seeded: two open longs + one pending limit, exactly like the live report's
        // own #132/#134/#4 -- verifies the "appears immediately on open, no new action"
        // acceptance criterion.
        case 21: return ['symbol' => 'BTCUSDT', 'timeframe' => '1H', 'start_index' => 380, 'cursor_index' => 450, 'scenario' => 'preseeded'];
        // Daily cap already reached (2/2) -- Fix C.
        case 22: return ['symbol' => 'BTCUSDT', 'timeframe' => '1H', 'start_index' => 380, 'cursor_index' => 400, 'scenario' => 'capped'];
        // v3.22.8 — Results page: 10 real closed trades (the exact hand-verified set
        // from backtest_engine.php's own self-test) + 2 rewound ones that must be
        // excluded. See mockResultsTrades() below for the full, hand-computed shape.
        case 23: return ['symbol' => 'BTCUSDT', 'timeframe' => '1H', 'start_index' => 380, 'cursor_index' => 500, 'scenario' => 'results'];
        default: return null;
    }
}

/** v3.22.8 — the Results page's own fixture: the EXACT 10-trade set
 *  backtest_engine.php's own self-test hand-verifies (see that file's "10 hand-
 *  constructed trades" comment) — reusing it here means drive-v3228.mjs's own
 *  assertions can cite the identical hand-computed numbers already proven correct by
 *  the PHP self-test, not a second, independently-derived set. Two further trades (11,
 *  12) are marked rewound and must never appear in get_backtest_results' own output —
 *  each is a large win that would be impossible to miss in the aggregates if wrongly
 *  included (n=12 not 10, total R=15.5 not 5.5, win rate 7/12 not 5/10). */
function mockResultsTrades(): array {
    $base = 1577836800000; // 2020-01-01T00:00:00Z
    $hour = 3600000;
    $mk = function (int $i, string $dir, string $result, float $r, float $net, float $entry, float $stop, ?float $tp, float $exit, string $reason, bool $rewound = false) use ($base, $hour) {
        return [
            'id' => 100 + $i, 'direction' => $dir, 'result' => $result, 'r_multiple' => $r,
            'net_pnl' => $net, 'fees' => 1.0, 'pnl' => $net + 1.0,
            'entry_price' => $entry, 'stop_loss' => $stop, 'take_profit' => $tp, 'exit_price' => $exit,
            'time_in' => $base + ($i * 10) * $hour, 'time_out' => $base + ($i * 10 + 4) * $hour,
            'exit_reason' => $reason, 'backtest_rewound' => $rewound,
        ];
    };
    return [
        $mk(1, 'Long', 'Win', 2.0, 200, 100, 95, 110, 110, 'Take Profit'),
        $mk(2, 'Long', 'Win', 1.5, 150, 100, 95, 107.5, 107.5, 'Take Profit'),
        $mk(3, 'Short', 'Loss', -1.0, -101, 100, 105, 90, 105, 'Stop Loss'),
        $mk(4, 'Long', 'Loss', -1.0, -101, 100, 95, 115, 95, 'Stop Loss'),
        $mk(5, 'Long', 'Win', 3.0, 300, 100, 95, 115, 115, 'Take Profit'),
        $mk(6, 'Short', 'Win', 1.0, 100, 100, 105, 90, 90, 'Take Profit'),
        $mk(7, 'Long', 'Loss', -1.0, -101, 100, 95, 115, 95, 'Stop Loss'),
        $mk(8, 'Short', 'Loss', -1.0, -101, 100, 105, 90, 105, 'Stop Loss'),
        $mk(9, 'Long', 'Break Even', 0.0, -1, 100, 95, 115, 100, 'Manual Closing'),
        $mk(10, 'Long', 'Win', 2.0, 200, 100, 95, 110, 110, 'Take Profit'),
        $mk(11, 'Long', 'Win', 5.0, 500, 100, 90, 150, 150, 'Take Profit', true),
        $mk(12, 'Short', 'Win', 5.0, 500, 100, 110, 50, 50, 'Take Profit', true),
    ];
}

// One state file per harness run -- the temp app copy it lives in (setup.js) is fresh
// every time, so state always starts clean with no reset step needed here.
function mockStatePath(): string { return __DIR__ . '/mock_state.json'; }

function loadMockStateStore(): array {
    $f = mockStatePath();
    if (!is_file($f)) return [];
    $raw = file_get_contents($f);
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}
function saveMockStateStore(array $store): void {
    file_put_contents(mockStatePath(), json_encode($store), LOCK_EX);
}

function initMockSessionState(int $id, array $cfg): array {
    $stepMs = TIMEFRAME_STEP_MS[$cfg['timeframe']];
    $st = [
        'symbol' => $cfg['symbol'], 'timeframe' => $cfg['timeframe'],
        'origin_ms' => MOCK_ORIGIN_MS, 'step_ms' => $stepMs,
        'cursor_index' => $cfg['cursor_index'],
        'equity' => 10000.0, 'starting_balance' => 10000.0,
        'trades_today' => 0, 'max_trades_per_day' => null,
        'open_positions' => [], 'pending_orders' => [], 'closed_trades' => [],
        'next_id' => 1000, 'rewind_count' => 0,
    ];
    if ($cfg['scenario'] === 'preseeded') {
        $entryIdx = 440;
        $entryMs = MOCK_ORIGIN_MS + $entryIdx * $stepMs;
        $st['open_positions'] = [
            ['id' => 132, 'direction' => 'Long', 'entry_price' => 8310.48, 'stop_loss' => 8000.0, 'take_profit' => 8600.0, 'lot_size' => 0.8693, 'fees_paid' => 3.4137, 'leverage' => 5, 'time_in' => $entryMs],
            ['id' => 134, 'direction' => 'Long', 'entry_price' => 8310.48, 'stop_loss' => 8000.0, 'take_profit' => 8600.0, 'lot_size' => 0.8696, 'fees_paid' => 3.4149, 'leverage' => 5, 'time_in' => $entryMs],
        ];
        $st['pending_orders'] = [
            ['id' => 4, 'direction' => 'Long', 'limit_price' => 8100.0, 'stop_loss' => 7900.0, 'take_profit' => 8400.0, 'risk_pct' => 1.0, 'leverage' => 5, 'placed_at_bar_time' => $entryMs],
        ];
        $st['trades_today'] = 2;
        $st['next_id'] = 1000;
    } elseif ($cfg['scenario'] === 'capped') {
        $st['trades_today'] = 2;
        $st['max_trades_per_day'] = 2;
    }
    return $st;
}

function getMockSessionState(int $id): ?array {
    $cfg = mockSessionConfig($id);
    if (!$cfg) return null;
    $store = loadMockStateStore();
    if (!isset($store[$id])) {
        $store[$id] = initMockSessionState($id, $cfg);
        saveMockStateStore($store);
    }
    return $store[$id];
}
function putMockSessionState(int $id, array $st): void {
    $store = loadMockStateStore();
    $store[$id] = $st;
    saveMockStateStore($store);
}

/** Mirrors BacktestController::computeSessionState()'s own shape closely enough for this
 *  mock's purposes: marks open positions to the CURRENT cursor bar's close (never null/
 *  entry -- this mock has no v3.22.1-era bug to reproduce), sums closed trades'
 *  recorded net_pnl for the realised side of equity. */
function mockComputeSessionState(array $st): array {
    $markClose = mockPriceAtIndex($st['cursor_index']);
    $floatingTotal = 0.0;
    $openOut = [];
    foreach ($st['open_positions'] as $p) {
        $isLong = $p['direction'] === 'Long';
        $gross = ($isLong ? ($markClose - $p['entry_price']) : ($p['entry_price'] - $markClose)) * $p['lot_size'];
        $floating = round($gross - $p['fees_paid'], 4);
        $floatingTotal += $floating;
        $openOut[] = $p + ['floating_pnl' => $floating, 'mark_price' => $markClose];
    }
    $closedSum = array_sum(array_column($st['closed_trades'], 'net_pnl'));
    $equity = round($st['starting_balance'] + $closedSum + $floatingTotal, 2);
    return ['equity' => $equity, 'floating_pnl' => round($floatingTotal, 2), 'open_positions' => $openOut, 'mark_close' => $markClose];
}

function mockSessionResponse(int $id, array $st): array {
    $computed = mockComputeSessionState($st);
    $cursorMs = $st['origin_ms'] + $st['cursor_index'] * $st['step_ms'];
    return [
        'id' => $id, 'session_name' => 'UI Harness Stateful Session ' . $id,
        'symbol' => $st['symbol'], 'blind_mode' => false, 'replay_timeframe' => $st['timeframe'],
        'status' => 'active', 'risk_pct' => 1.0, 'fee_rate_pct' => 0.04, 'default_leverage' => 5,
        'risk_ladder' => [['lower_pct' => 0, 'upper_pct' => null, 'risk_pct' => 1.0]], 'use_flat_risk' => true,
        'starting_balance' => $st['starting_balance'], 'profit_target_pct' => 10.0,
        'daily_drawdown_pct' => 5.0, 'max_drawdown_pct' => 10.0, 'drawdown_type' => 'static',
        'max_trades_per_day' => $st['max_trades_per_day'],
        'replay_cursor_ms' => $cursorMs, 'start_time' => $st['origin_ms'],
        'equity' => $computed['equity'], 'floating_pnl' => $computed['floating_pnl'], 'peak_equity' => max($st['starting_balance'], $computed['equity']),
        'today_change' => $computed['equity'] - $st['starting_balance'],
        'progress_to_target_pct' => round(($computed['equity'] - $st['starting_balance']) / ($st['starting_balance'] * 0.10) * 100, 1),
        'daily_drawdown_used_pct' => 0.0, 'max_drawdown_used_pct' => 0.0,
        'trades_today' => $st['trades_today'], 'trade_count' => count($st['closed_trades']), 'trading_days' => 1,
        'fail_reason' => null, 'fail_bar_time' => null, 'fail_equity' => null,
        'passed_at_bar_time' => null, 'passed_trading_days' => null, 'passed_trade_count' => null,
        'rewind_count' => $st['rewind_count'], 'created_at' => gmdate('c'),
        'open_positions' => $computed['open_positions'],
        'pending_orders' => $st['pending_orders'],
        'closed_trades' => $st['closed_trades'],
    ];
}

/** backtest_advance's mock: moves the cursor forward one bar, fills any pending order
 *  whose limit was touched by the new bar's range, closes any open position whose SL/TP
 *  was touched (SL wins if both, same conservative rule BacktestController's own
 *  backtestCheckSlTp() uses), and returns the same event shape the real advance() does
 *  so the client's existing toast logic needs no mock-specific branches. */
function mockAdvance(int $id, array $st): array {
    $st['cursor_index'] += 1;
    $bar = mockCandleAtIndex($st['cursor_index'], $st['origin_ms'], $st['step_ms']);
    $events = [];

    $stillPending = [];
    foreach ($st['pending_orders'] as $o) {
        $touched = $o['direction'] === 'Long' ? $bar['low'] <= $o['limit_price'] : $bar['high'] >= $o['limit_price'];
        if (!$touched) { $stillPending[] = $o; continue; }
        $lotSize = 0.5; // fixed, display-only estimate -- this mock doesn't reproduce real position sizing
        $tradeId = $st['next_id']++;
        $st['open_positions'][] = [
            'id' => $tradeId, 'direction' => $o['direction'], 'entry_price' => $o['limit_price'],
            'stop_loss' => $o['stop_loss'], 'take_profit' => $o['take_profit'], 'lot_size' => $lotSize,
            'fees_paid' => round($lotSize * $o['limit_price'] * 0.0004, 4), 'leverage' => $o['leverage'], 'time_in' => $bar['time'],
        ];
        $st['trades_today']++;
        $events[] = ['type' => 'limit_filled', 'trade_id' => $tradeId, 'order_id' => $o['id'], 'price' => $o['limit_price'], 'lot_size' => $lotSize, 'direction' => $o['direction']];
    }
    $st['pending_orders'] = $stillPending;

    $stillOpen = [];
    foreach ($st['open_positions'] as $p) {
        $isLong = $p['direction'] === 'Long';
        $slHit = $isLong ? $bar['low'] <= $p['stop_loss'] : $bar['high'] >= $p['stop_loss'];
        $tpHit = !$slHit && $p['take_profit'] !== null && ($isLong ? $bar['high'] >= $p['take_profit'] : $bar['low'] <= $p['take_profit']);
        if (!$slHit && !$tpHit) { $stillOpen[] = $p; continue; }
        $exitPrice = $slHit ? $p['stop_loss'] : $p['take_profit'];
        $gross = ($isLong ? ($exitPrice - $p['entry_price']) : ($p['entry_price'] - $exitPrice)) * $p['lot_size'];
        $exitFee = round($p['lot_size'] * $exitPrice * 0.0004, 4);
        $net = round($gross - $p['fees_paid'] - $exitFee, 4);
        $riskPerUnit = abs($p['entry_price'] - $p['stop_loss']);
        $rMultiple = $riskPerUnit > 0 ? round((($isLong ? ($exitPrice - $p['entry_price']) : ($p['entry_price'] - $exitPrice))) / $riskPerUnit, 4) : null;
        $st['closed_trades'][] = [
            'id' => $p['id'], 'direction' => $p['direction'], 'entry_price' => $p['entry_price'], 'exit_price' => $exitPrice,
            'time_in' => $p['time_in'], 'time_out' => $bar['time'], 'r_multiple' => $rMultiple,
            'exit_reason' => $slHit ? 'Stop Loss' : 'Take Profit', 'net_pnl' => $net,
        ];
        $events[] = ['type' => $slHit ? 'stop_loss' : 'take_profit', 'trade_id' => $p['id'], 'price' => $exitPrice, 'net_pnl' => $net, 'r_multiple' => $rMultiple];
    }
    $st['open_positions'] = $stillOpen;

    return ['state' => $st, 'events' => $events, 'bar' => $bar];
}

/** backtest_rewind's mock: steps the cursor back one bar and undoes everything that
 *  happened strictly after the new cursor, same three cases the real rewind() handles --
 *  a position opened after the new cursor is removed outright (never existed from here);
 *  one closed after the new cursor is reopened (its close undone); a pending order
 *  placed after the new cursor is restored to pending. Simplified: since this mock only
 *  ever advances one bar at a time in the harness's own test flow, "after the new cursor"
 *  here just means "at exactly the bar being rewound past," not a general undo-to-any-
 *  point implementation -- sufficient for verifying the CLIENT renders a rewind
 *  correctly, which is what tools/ui-harness exists to test; the real multi-step rewind
 *  logic lives in, and is tested against, BacktestController.php itself. */
function mockRewind(array $st): array {
    $newCursorIndex = $st['cursor_index'] - 1;
    $newCursorMs = $st['origin_ms'] + $newCursorIndex * $st['step_ms'];

    $reopened = 0;
    $stillClosed = [];
    foreach ($st['closed_trades'] as $t) {
        if ($t['time_out'] > $newCursorMs && $t['time_in'] <= $newCursorMs) {
            $st['open_positions'][] = [
                'id' => $t['id'], 'direction' => $t['direction'], 'entry_price' => $t['entry_price'],
                'stop_loss' => null, 'take_profit' => null, 'lot_size' => 0.5, 'fees_paid' => 0,
                'leverage' => 5, 'time_in' => $t['time_in'],
            ];
            $reopened++;
        } elseif ($t['time_in'] > $newCursorMs) {
            $reopened++; // opened after the new cursor too -- just drop it (never existed)
        } else {
            $stillClosed[] = $t;
        }
    }
    $st['closed_trades'] = $stillClosed;
    $st['cursor_index'] = $newCursorIndex;
    $st['rewind_count'] += $reopened;
    return $st;
}

// ════════════════════════════════════════════════════════════════════════════
// Dispatch (web). CLI mode (`php api.php <fromIndex> <toIndex>`) exits before any of
// this runs -- prints the deterministic candle sequence so SL/TP values for a scenario
// in mockSessionConfig() above can be picked by hand, not guessed.
// ════════════════════════════════════════════════════════════════════════════

if (PHP_SAPI === 'cli' && basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    $from = isset($argv[1]) ? (int) $argv[1] : 395;
    $to = isset($argv[2]) ? (int) $argv[2] : 410;
    for ($i = $from; $i <= $to; $i++) {
        $c = mockCandleAtIndex($i, 0, 3600000);
        printf("i=%d  O=%.2f H=%.2f L=%.2f C=%.2f\n", $i, $c['open'], $c['high'], $c['low'], $c['close']);
    }
    exit(0);
}

$action = $_GET['action'] ?? '';
$body = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
}
$sessionIdParam = (int) ($_GET['id'] ?? $_GET['session_id'] ?? ($body['session_id'] ?? 0));
$statefulCfg = $sessionIdParam ? mockSessionConfig($sessionIdParam) : null;

switch ($action) {
    case 'get_backtest_session':
        if ($statefulCfg) { out(mockSessionResponse($sessionIdParam, getMockSessionState($sessionIdParam))); }
        $out = mockSessionSummary();
        $out['open_positions'] = [];
        $out['pending_orders'] = [];
        $out['closed_trades'] = [];
        out($out);

    case 'get_backtest_results':
        // v3.22.8 — real backtest_engine.php functions, same temp-copy directory as this
        // stub (setup.js copies the whole app/ tree) -- this mock doesn't reimplement the
        // metrics math, it feeds the real thing a known fixture.
        require_once __DIR__ . '/backtest_engine.php';
        $all = mockResultsTrades();
        $trades = array_values(array_filter($all, fn($t) => !$t['backtest_rewound']));
        $startingBalance = 10000.0;
        $metrics = backtestResultsMetrics($trades, $startingBalance);
        $stepMs = 3600000; // 1H, matches this fixture's own timeframe
        $tradeList = array_map(function ($t) use ($stepMs) {
            $t['duration_bars'] = (int) round(($t['time_out'] - $t['time_in']) / $stepMs);
            unset($t['backtest_rewound']);
            return $t;
        }, $trades);
        out([
            'session' => [
                'id' => $sessionIdParam, 'session_name' => 'UI Harness Results Session',
                'symbol' => 'BTCUSDT', 'replay_timeframe' => '1H', 'status' => 'passed',
                'start_time' => 1577836800000, 'replay_cursor_ms' => 1577836800000 + 130 * 3600000,
                'starting_balance' => $startingBalance,
            ],
            'metrics' => $metrics,
            'trades' => $tradeList,
        ]);

    case 'get_backtest_sessions':
        // v3.22.8 — the Saved Backtests list, carrying the same results_summary field
        // the real BacktestController::getSessions() computes per session.
        require_once __DIR__ . '/backtest_engine.php';
        $all = mockResultsTrades();
        $trades = array_values(array_filter($all, fn($t) => !$t['backtest_rewound']));
        $block = backtestMetricsBlock($trades, 10000.0);
        out([[
            'id' => 23, 'session_name' => 'UI Harness Results Session', 'symbol' => 'BTCUSDT',
            'blind_mode' => false, 'replay_timeframe' => '1H', 'status' => 'passed',
            'starting_balance' => 10000.0, 'equity' => 10000.0 + $block['net_usd'], 'created_at' => '2020-01-01 00:00:00',
            'progress_to_target_pct' => null, 'fail_reason' => null,
            'results_summary' => ['trade_count' => $block['n'], 'win_rate' => $block['win_rate'], 'expectancy_r' => $block['expectancy_r']],
        ]]);

    case 'get_backtest_candles':
        $limit = (int) ($_GET['limit'] ?? 301);
        $timeframe = (string) ($_GET['timeframe'] ?? '1H');
        $before = isset($_GET['before']) ? (int) $_GET['before'] : null;
        if ($statefulCfg) {
            $st = getMockSessionState($sessionIdParam);
            $stepMs = TIMEFRAME_STEP_MS[$timeframe] ?? $st['step_ms'];
            $ceilingIndex = $before !== null ? intdiv($before - $st['origin_ms'], $stepMs) - 1 : $st['cursor_index'];
            // v3.22.3 — a real floor on history (unlike mockPriceAtIndex()/
            // mockCandleAtIndex(), which are happy to answer for any index, positive or
            // negative, forever): js/chart.js::loadOlderCandles() keeps paging further
            // back until a response comes back SHORTER than it asked for
            // (chartState.exhaustedOlder), and a mock with infinite history in both
            // directions never tells it to stop -- every symbol's real candle history
            // has a genuine earliest bar in production too, so this isn't just a test
            // workaround, it's closer to the real contract than "infinite" was.
            $floorIndex = -500;
            $startIndex = max($floorIndex, $ceilingIndex - $limit + 1);
            $rows = [];
            for ($i = $startIndex; $i <= $ceilingIndex; $i++) {
                $rows[] = mockCandleAtIndex($i, $st['origin_ms'], $stepMs);
            }
            out(['candles' => $rows]);
        }
        out(['candles' => mockCandles($limit, $before, $timeframe)]);

    case 'get_backtest_drawings':
        out([]);

    case 'get_drawing_defaults':
        out((object) []); // {} not [] -- loadBtDrawingDefaults() requires a real object

    case 'add_backtest_drawing':
        out(['success' => true, 'id' => random_int(1000, 999999)]);

    case 'update_backtest_drawing':
    case 'delete_backtest_drawing':
    case 'save_drawing_default':
    case 'reset_drawing_default':
        out(['success' => true]);

    case 'backtest_place_order':
        if ($statefulCfg) {
            $st = getMockSessionState($sessionIdParam);
            $direction = $body['direction'] ?? 'Long';
            $stopLoss = (float) ($body['stop_loss'] ?? 0);
            $takeProfit = isset($body['take_profit']) && $body['take_profit'] !== null ? (float) $body['take_profit'] : null;
            $cursorMs = $st['origin_ms'] + $st['cursor_index'] * $st['step_ms'];
            $lotSize = 0.5;
            if (($body['type'] ?? 'market') === 'market') {
                $entryPrice = mockPriceAtIndex($st['cursor_index']);
                $tradeId = $st['next_id']++;
                $st['open_positions'][] = [
                    'id' => $tradeId, 'direction' => $direction, 'entry_price' => $entryPrice, 'stop_loss' => $stopLoss,
                    'take_profit' => $takeProfit, 'lot_size' => $lotSize, 'fees_paid' => round($lotSize * $entryPrice * 0.0004, 4),
                    'leverage' => (int) ($body['leverage'] ?? 5), 'time_in' => $cursorMs,
                ];
                $st['trades_today']++;
                putMockSessionState($sessionIdParam, $st);
                out(['success' => true, 'filled' => true, 'entry_price' => $entryPrice, 'lot_size' => $lotSize, 'direction' => $direction, 'trade_id' => $tradeId]);
            } else {
                $limitPrice = (float) ($body['limit_price'] ?? 0);
                $orderId = $st['next_id']++;
                $st['pending_orders'][] = [
                    'id' => $orderId, 'direction' => $direction, 'limit_price' => $limitPrice, 'stop_loss' => $stopLoss,
                    'take_profit' => $takeProfit, 'risk_pct' => (float) ($body['risk_pct'] ?? 1), 'leverage' => (int) ($body['leverage'] ?? 5),
                    'placed_at_bar_time' => $cursorMs,
                ];
                putMockSessionState($sessionIdParam, $st);
                out(['success' => true, 'filled' => false, 'pending_order_id' => $orderId]);
            }
        }
        // Legacy session 6 — never actually fills, returns the received payload
        // alongside the error so a driver can assert on exactly what was submitted.
        out(['error' => 'MOCK', 'received' => $body]);

    case 'backtest_advance':
        if ($statefulCfg) {
            $st = getMockSessionState($sessionIdParam);
            $result = mockAdvance($sessionIdParam, $st);
            putMockSessionState($sessionIdParam, $result['state']);
            $resp = mockSessionResponse($sessionIdParam, $result['state']);
            out([
                'success' => true, 'advanced' => 1, 'last_bar_time' => $result['bar']['time'], 'events' => $result['events'],
                'session' => $resp, 'open_positions' => $resp['open_positions'], 'pending_orders' => $resp['pending_orders'],
                'closed_trades' => $resp['closed_trades'], 'step_timeframe' => $st['timeframe'],
            ]);
        }
        out(['error' => 'advance not mocked for this session']);

    case 'backtest_rewind':
        if ($statefulCfg) {
            $st = getMockSessionState($sessionIdParam);
            $st = mockRewind($st);
            putMockSessionState($sessionIdParam, $st);
            $resp = mockSessionResponse($sessionIdParam, $st);
            out([
                'success' => true, 'trades_rewound' => 1,
                'session' => $resp, 'open_positions' => $resp['open_positions'], 'pending_orders' => $resp['pending_orders'],
                'closed_trades' => $resp['closed_trades'], 'step_timeframe' => $st['timeframe'],
            ]);
        }
        out(['error' => 'rewind not mocked for this session']);

    case 'backtest_cancel_order':
        $orderId = (int) ($body['order_id'] ?? 0);
        foreach (array_keys(mockSessionConfigsWithState()) as $sid) {
            $st = getMockSessionState($sid);
            if (!$st) continue;
            $before = count($st['pending_orders']);
            $st['pending_orders'] = array_values(array_filter($st['pending_orders'], fn($o) => $o['id'] !== $orderId));
            if (count($st['pending_orders']) !== $before) { putMockSessionState($sid, $st); break; }
        }
        out(['success' => true]);

    case 'backtest_close_position':
        $tradeId = (int) ($body['trade_id'] ?? 0);
        foreach (array_keys(mockSessionConfigsWithState()) as $sid) {
            $st = getMockSessionState($sid);
            if (!$st) continue;
            $idx = null;
            foreach ($st['open_positions'] as $i => $p) if ($p['id'] === $tradeId) { $idx = $i; break; }
            if ($idx === null) continue;
            $p = $st['open_positions'][$idx];
            $exitPrice = mockPriceAtIndex($st['cursor_index']);
            $isLong = $p['direction'] === 'Long';
            $gross = ($isLong ? ($exitPrice - $p['entry_price']) : ($p['entry_price'] - $exitPrice)) * $p['lot_size'];
            $net = round($gross - $p['fees_paid'], 4);
            $cursorMs = $st['origin_ms'] + $st['cursor_index'] * $st['step_ms'];
            $riskPerUnit = $p['stop_loss'] ? abs($p['entry_price'] - $p['stop_loss']) : 0;
            $rMultiple = $riskPerUnit > 0 ? round((($isLong ? ($exitPrice - $p['entry_price']) : ($p['entry_price'] - $exitPrice))) / $riskPerUnit, 4) : null;
            $st['closed_trades'][] = ['id' => $p['id'], 'direction' => $p['direction'], 'entry_price' => $p['entry_price'], 'exit_price' => $exitPrice, 'time_in' => $p['time_in'], 'time_out' => $cursorMs, 'r_multiple' => $rMultiple, 'exit_reason' => 'Manual Closing', 'net_pnl' => $net];
            array_splice($st['open_positions'], $idx, 1);
            putMockSessionState($sid, $st);
            out(['success' => true, 'net_pnl' => $net, 'r_multiple' => $rMultiple]);
        }
        out(['success' => true]);

    // ── Called unconditionally by js/app.js's DOMContentLoaded, on every page ──
    case 'get_user':
        out(['id' => 1, 'username' => 'test', 'display_name' => 'Test User', 'account_balance' => 10000]);

    case 'get_challenges':
        out([]); // refreshSidebarChallenges() calls .map() directly -- must be an array

    case 'get_risk_status':
        out(['stopped' => false]);

    default:
        out((object) []);
}

/** Every stateful session id this mock knows about -- cancel/close need to find which
 *  one owns a given order/trade id without the client telling them (cancelBtOrder()/
 *  closeBtPosition() only ever send the order/trade id, same as the real endpoints). */
function mockSessionConfigsWithState(): array {
    return [20 => true, 21 => true, 22 => true];
}
