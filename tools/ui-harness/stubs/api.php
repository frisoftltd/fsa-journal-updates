<?php
/**
 * UI harness stub for includes/api.php -- replaces the real router/controller stack
 * entirely (no DB in this harness at all). Covers exactly the actions the Backtesting
 * order-ticket flow needs (per this harness's own recipe), plus the handful of actions
 * every page fires unconditionally from js/app.js's DOMContentLoaded handler, so that
 * startup sequence doesn't throw and abort before _restoreFromHash() ever runs.
 *
 * Extend this file's $ACTION dispatch as future UI releases need more of the app mocked
 * -- this harness is meant to be reused (see CLAUDE.md's v3.22.1/v3.22.2 sections), not
 * rebuilt per release.
 */
header('Content-Type: application/json');

const MOCK_SESSION_ID = 6;
// Fixed instant so every run is deterministic -- 2025-06-01T00:00:00Z.
const MOCK_REPLAY_CURSOR_MS = 1748736000000;

function out($data) { echo json_encode($data); exit; }

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
    $stepMs = [
        '15m' => 15 * 60 * 1000,
        '1H' => 60 * 60 * 1000,
        '4H' => 4 * 60 * 60 * 1000,
        '1D' => 24 * 60 * 60 * 1000,
    ][$timeframe] ?? 3600 * 1000;
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

$action = $_GET['action'] ?? '';
$body = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
}

switch ($action) {
    // ── Backtesting: the six actions the order-ticket flow actually needs ──
    case 'get_backtest_session':
        $out = mockSessionSummary();
        $out['open_positions'] = [];
        $out['pending_orders'] = [];
        out($out);

    case 'get_backtest_candles':
        $limit = (int) ($_GET['limit'] ?? 301);
        $timeframe = (string) ($_GET['timeframe'] ?? '1H');
        $before = isset($_GET['before']) ? (int) $_GET['before'] : null;
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

    // Never actually fills -- returns the received payload alongside the error so a
    // Playwright driver can assert on exactly what the ticket submitted without needing
    // a separate log file / IPC channel (the app itself only ever checks res.error).
    case 'backtest_place_order':
        out(['error' => 'MOCK', 'received' => $body]);

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
