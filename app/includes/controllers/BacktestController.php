<?php
/**
 * FundedControl — Backtest Controller (Phase 1b, v3.20.0)
 * Handles: get_backtest_sessions, get_backtest_session, create_backtest_session,
 *          get_backtest_candles, backtest_advance, backtest_place_order,
 *          backtest_cancel_order, backtest_close_position
 *
 * No-lookahead is enforced here, server-side, on every read: get_backtest_candles()
 * never returns a candle later than the session's own replay_cursor_ms, regardless of
 * what a client asks for. The browser is never trusted to hide future data on its own.
 *
 * Equity/peak-equity are never stored columns — computeSessionState() derives both
 * live from the trades table every time, the same "don't trust a stored balance"
 * lesson challenges.current_balance's own removal (CLAUDE.md v3.13.0) already
 * established in this codebase. See migrations/2026_09_25_0001's own comment for why.
 *
 * Backtest trades write to the SAME `trades` table live trades use
 * (source='backtest', backtest_session_id=<this session>), per the briefing. Every
 * existing consumer of `trades` elsewhere in this app has been separately audited and
 * patched to exclude source='backtest' explicitly — this controller is the only one
 * that ever reads/writes backtest rows without that exclusion, because it's the one
 * place they're actually supposed to be read.
 */
require_once __DIR__ . '/../bybit_client.php';
require_once __DIR__ . '/../backtest_engine.php';

class BacktestController {
    private $db;
    private $uid;

    // Bybit's own standard taker fee, used as this app's default fee_rate_pct.
    const DEFAULT_FEE_RATE_PCT = 0.0550;
    // v3.20.9 — how many bars of real history the setup form defaults Start Date to
    // being *behind*, so a session created without touching the field still opens with
    // genuine lead-in chart context (js/backtest.js's BT_LEAD_IN_BARS uses the same
    // number for how much history it *requests* on chart load; keep both in sync if this
    // ever changes — see getSymbolRange()'s own docblock for why the default can't just
    // be the absolute earliest candle).
    const DEFAULT_LEAD_IN_BARS = 300;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    // ── SESSIONS ─────────────────────────────────────────────

    public function getSessions() {
        $s = $this->db->prepare("SELECT * FROM backtest_sessions WHERE user_id=? ORDER BY created_at DESC");
        $s->execute([$this->uid]);
        $sessions = $s->fetchAll();
        jsonResponse(array_map(function ($sess) {
            $state = $this->computeSessionState($sess);
            return $this->sessionSummary($sess, $state);
        }, $sessions));
    }

    public function getSession() {
        $id = validId($_GET['id'] ?? 0);
        if (!$id) jsonError('Invalid session id.');
        $session = $this->loadSession($id);

        $state = $this->computeSessionState($session);
        $out = $this->sessionSummary($session, $state);
        $out['open_positions'] = $state['open_positions'];
        $out['pending_orders'] = $this->getPendingOrders($id);
        jsonResponse($out);
    }

    /**
     * v3.20.6 — backs the setup form's Start Date prefill/min/max. Symbol-level
     * symbols.earliest_candle_ms (what ChartController::getSymbols() returns) isn't
     * enough here: it's not scoped to a timeframe, and it has no "latest" counterpart at
     * all, so the form previously had no source for either the correct per-timeframe
     * earliest date or a max bound. candle_sync (via backtestGetSyncState(), the same
     * function createSession() itself validates against) is the one place both numbers
     * actually live, per (symbol, timeframe).
     *
     * v3.20.9 — also returns default_start_time: DEFAULT_LEAD_IN_BARS candles after
     * earliest_open_time, not earliest_open_time itself. v3.20.6 defaulted the form to
     * the absolute earliest candle, and v3.20.8 added a 300-bar lead-in fetch on session
     * open — but the earliest candle that exists has, by definition, zero candles before
     * it, so a session anchored there can never have any lead-in no matter how correctly
     * the fetch logic runs (confirmed against the live deployed js/backtest.js directly,
     * not assumed — the v3.20.8 code was already there and already correct). The fix is
     * to stop defaulting to the pathological zero-lead-in point: default_start_time is
     * the real Nth candle counted from the earliest (LIMIT/OFFSET, immune to any gaps in
     * the series, not earliest_open_time + N*stepMs), or earliest_open_time itself if
     * fewer than DEFAULT_LEAD_IN_BARS candles exist at all for this pair. Leaving the
     * field blank still means the literal absolute earliest candle (createSession()'s own
     * documented v3.20.6 behavior, unchanged) — this only changes what the field is
     * *prefilled* with by default, a deliberate, narrower choice than also redefining
     * what a blank field means.
     */
    public function getSymbolRange() {
        $symbol = strtoupper(trim($_GET['symbol'] ?? ''));
        $timeframe = trim($_GET['timeframe'] ?? '');
        if (!in_array($timeframe, ['15m', '1H', '4H', '1D'], true)) jsonError('Invalid replay timeframe.');

        $sc = $this->db->prepare("SELECT symbol FROM symbols WHERE symbol=? AND enabled=1");
        $sc->execute([$symbol]);
        if (!$sc->fetch()) jsonError('Unknown or disabled symbol.');

        $sync = backtestGetSyncState($this->db, $symbol, $timeframe);
        $earliest = $sync['earliest_open_time'] !== null ? (int) $sync['earliest_open_time'] : null;
        $defaultStart = $earliest;
        if ($earliest !== null) {
            $nth = $this->db->prepare("SELECT open_time FROM candles WHERE symbol=? AND timeframe=? ORDER BY open_time ASC LIMIT 1 OFFSET ?");
            $nth->bindValue(1, $symbol);
            $nth->bindValue(2, $timeframe);
            $nth->bindValue(3, self::DEFAULT_LEAD_IN_BARS, PDO::PARAM_INT);
            $nth->execute();
            $nthOpenTime = $nth->fetchColumn();
            // fetchColumn() returns false, not null, when OFFSET exhausts the result set
            // (fewer than DEFAULT_LEAD_IN_BARS candles exist at all) -- $defaultStart
            // correctly stays at $earliest in that case, per the docblock above.
            if ($nthOpenTime !== false) $defaultStart = (int) $nthOpenTime;
        }
        jsonResponse([
            'earliest_open_time' => $earliest,
            'latest_open_time' => $sync['latest_open_time'] !== null ? (int) $sync['latest_open_time'] : null,
            'default_start_time' => $defaultStart,
        ]);
    }

    /**
     * Every challenge field is user-entered and fully custom (per the briefing — a
     * dropdown prefill on the frontend just copies numbers into these same inputs
     * before submit; nothing server-side ever reads challenges.* directly). The only
     * required linkage to real market data is symbol + replay_timeframe + a start date
     * that must land inside candle_sync's own recorded range for that pair.
     */
    public function createSession() {
        $d = jsonInput();

        $sessionName = trim((string) ($d['session_name'] ?? ''));
        if ($sessionName === '') jsonError('Session name is required.');
        if (strlen($sessionName) > 120) jsonError('Session name is too long (120 characters max).');

        $symbol = strtoupper(trim($d['symbol'] ?? ''));
        $timeframe = trim($d['replay_timeframe'] ?? '');
        if (!in_array($timeframe, ['15m', '1H', '4H', '1D'], true)) jsonError('Invalid replay timeframe.');

        $sc = $this->db->prepare("SELECT symbol FROM symbols WHERE symbol=? AND enabled=1");
        $sc->execute([$symbol]);
        if (!$sc->fetch()) jsonError('Unknown or disabled symbol.');

        $sync = backtestGetSyncState($this->db, $symbol, $timeframe);
        if ($sync['earliest_open_time'] === null) jsonError('This symbol/timeframe has not been backfilled yet.');

        // v3.20.6 fix: Start Date is optional -- an empty field means "start at the
        // earliest available candle," not an invalid date. Previously $startMs was left
        // null for a blank field and then rejected by the exact same range check used
        // for a real, out-of-range date, so leaving the field untouched (the common
        // case) always failed with a "must fall within ... history" error that made no
        // sense against nothing having been entered at all. The range check itself is
        // still required, unchanged, whenever a date actually IS given.
        $startDateRaw = trim((string) ($d['start_date'] ?? ''));
        if ($startDateRaw === '') {
            $startMs = (int) $sync['earliest_open_time'];
        } else {
            $startMs = strtotime($startDateRaw . ' 00:00:00 UTC') * 1000;
            if (!$startMs) jsonError('Invalid start date.');
            // v3.20.9 fix: this was comparing a UTC-midnight timestamp against
            // earliest_open_time/latest_open_time's own exact millisecond values, but a
            // real exchange candle's open_time is essentially never exactly midnight UTC
            // -- it opens whenever the underlying market/backfill actually starts, which
            // for BTCUSDT 1H is some specific hour on 2020-03-25, not 00:00:00 that day.
            // The setup form's own helper text and Start Date prefill are both calendar-
            // day truncations of that same timestamp (new Date(ms).toISOString().slice(0,
            // 10)) -- so the exact date the UI told the user to use (the earliest day
            // shown) was numerically *before* earliest_open_time and got rejected by its
            // own displayed lower bound. Confirmed by reading what the frontend actually
            // sends (a native <input type="date">'s .value is always plain YYYY-MM-DD,
            // never locale- or timezone-shaped -- that part of the original bug report
            // doesn't hold up) against what candle_sync actually stores, not assumed.
            // Comparing calendar days instead of raw milliseconds matches the granularity
            // a date picker can even express, and the snap-to-nearest-real-candle query
            // right below this block already resolves the sub-day gap correctly once a
            // valid calendar day is let through -- both bounds are inclusive, unchanged.
            $requestedDay = gmdate('Y-m-d', (int) ($startMs / 1000));
            $earliestDay = gmdate('Y-m-d', (int) ($sync['earliest_open_time'] / 1000));
            $latestDay = gmdate('Y-m-d', (int) ($sync['latest_open_time'] / 1000));
            if ($requestedDay < $earliestDay || $requestedDay > $latestDay) {
                jsonError("Start date must fall within this symbol/timeframe's available history ($earliestDay to $latestDay).");
            }
        }
        // Snap to the nearest real candle at/after the requested date — the user picks
        // a calendar day, not necessarily an exact bar timestamp.
        $firstBar = $this->db->prepare("SELECT open_time FROM candles WHERE symbol=? AND timeframe=? AND open_time >= ? ORDER BY open_time ASC LIMIT 1");
        $firstBar->execute([$symbol, $timeframe, $startMs]);
        $realStart = $firstBar->fetchColumn();
        if ($realStart === false) jsonError('No candle found at or after the requested start date.');

        $riskPct = num($d['risk_pct'] ?? 1);
        if ($riskPct <= 0 || $riskPct > 100) jsonError('Risk % must be between 0 and 100.');
        $feeRatePct = num($d['fee_rate_pct'] ?? self::DEFAULT_FEE_RATE_PCT);
        if ($feeRatePct < 0) jsonError('Fee rate cannot be negative.');
        $startingBalance = num($d['starting_balance'] ?? 0);
        if ($startingBalance <= 0) jsonError('Account size must be greater than 0.');
        $profitTargetPct = num($d['profit_target_pct'] ?? 0);
        $dailyDrawdownPct = num($d['daily_drawdown_pct'] ?? 0);
        $maxDrawdownPct = num($d['max_drawdown_pct'] ?? 0);
        if ($profitTargetPct <= 0 || $dailyDrawdownPct <= 0 || $maxDrawdownPct <= 0) {
            jsonError('Profit target %, daily drawdown % and max drawdown % must all be greater than 0.');
        }
        $drawdownType = in_array($d['drawdown_type'] ?? '', ['static', 'trailing'], true) ? $d['drawdown_type'] : 'static';
        $maxTradesPerDay = (isset($d['max_trades_per_day']) && $d['max_trades_per_day'] !== '') ? max(1, (int) $d['max_trades_per_day']) : null;
        $blindMode = !empty($d['blind_mode']) ? 1 : 0;

        // v3.20.11 — cursor_step_tf records which timeframe replay_cursor_ms's own bar
        // came from (see the migration's own comment for why this is needed at all). The
        // very first bar a session ever shows is always at the session's own
        // replay_timeframe -- adaptive stepping only takes it finer than that later, via
        // advance()/rewind() explicitly updating this column alongside the cursor.
        $this->db->prepare(
            "INSERT INTO backtest_sessions
                (user_id, session_name, symbol, replay_timeframe, start_time, replay_cursor_ms, cursor_step_tf, risk_pct, fee_rate_pct, blind_mode,
                 starting_balance, profit_target_pct, daily_drawdown_pct, max_drawdown_pct, drawdown_type, max_trades_per_day)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        )->execute([
            $this->uid, $sessionName, $symbol, $timeframe, (int) $realStart, (int) $realStart, $timeframe, $riskPct, $feeRatePct, $blindMode,
            $startingBalance, $profitTargetPct, $dailyDrawdownPct, $maxDrawdownPct, $drawdownType, $maxTradesPerDay,
        ]);

        jsonResponse(['success' => true, 'id' => (int) $this->db->lastInsertId()]);
    }

    // ── REPLAY DATA (no-lookahead) ───────────────────────────

    /**
     * The one rule this whole method exists to enforce: never return a candle whose
     * open_time is later than the session's own no-lookahead ceiling, no matter what a
     * client's `before`/`limit`/`timeframe` params ask for. The browser is never trusted
     * to hide future data on its own, on any timeframe.
     *
     * v3.20.11 — the ceiling is now `replay_cursor_ms + stepMs(cursor_step_tf)`, not
     * `+ stepMs(replay_timeframe)`. Adaptive stepping means the session's clock can move
     * in a FINER unit than its own nominal replay_timeframe whenever the user is viewing
     * a finer display timeframe (see advance()/rewind()'s resolveStepTimeframe()) —
     * cursor_step_tf records which resolution the most recently revealed bar actually
     * came from, and the ceiling has to be computed from THAT, not the session's fixed
     * label, or a finer step would either over-reveal (ceiling too generous) or
     * under-reveal (ceiling too tight) depending on which way the mismatch ran.
     *
     * Whether the CURRENTLY DISPLAYED timeframe's own bar (the one containing the
     * cursor) needs synthesizing is now a direct question — does the ceiling fall
     * strictly before that bar's own end? — rather than a proxy comparison between two
     * timeframes' durations (v3.20.10's `displayStepMs <= replayStepMs`), because
     * cursor_step_tf can now be finer than replay_timeframe while the display timeframe
     * sits anywhere relative to either of them. If the bar is only partially revealed,
     * it's synthesized from real, already-revealed 15m candles (the finest timeframe
     * this app tracks, always safe and always available wherever coarser data is) via
     * backtestAggregateCandles() — the stored series at the DISPLAY timeframe itself
     * would hold the real, complete FUTURE candle for that same window.
     */
    public function getCandles() {
        $id = validId($_GET['session_id'] ?? 0);
        if (!$id) jsonError('Invalid session id.');
        $session = $this->loadSession($id);

        $cursorStepMs = backtestTimeframeStepMs($session['cursor_step_tf']);
        // Exclusive `before` semantics -- +cursorStepMs makes the most recently revealed
        // bar itself includable.
        $ceiling = (int) $session['replay_cursor_ms'] + $cursorStepMs;

        $displayTf = trim($_GET['timeframe'] ?? '');
        if ($displayTf === '') $displayTf = $session['replay_timeframe'];
        if (!in_array($displayTf, ['15m', '1H', '4H', '1D'], true)) jsonError('Invalid display timeframe.');
        $displayStepMs = backtestTimeframeStepMs($displayTf);

        $limit = isset($_GET['limit']) ? max(1, min(2000, (int) $_GET['limit'])) : 500;
        $before = isset($_GET['before']) && $_GET['before'] !== '' ? (int) $_GET['before'] : null;

        // UTC-epoch-aligned start/end of the display-timeframe bar the cursor currently
        // sits inside (real exchange kline data is always epoch-aligned, e.g. 4H bars
        // open at 00:00/04:00/08:00 UTC etc. — never an arbitrary offset).
        $alignedStart = intdiv((int) $session['replay_cursor_ms'], $displayStepMs) * $displayStepMs;
        $barEnd = $alignedStart + $displayStepMs;
        $needsSynthesis = $ceiling < $barEnd;

        if (!$needsSynthesis) {
            $effectiveBefore = $before !== null ? min($before, $ceiling) : $ceiling;
            $rows = $this->fetchStoredCandles($session['symbol'], $displayTf, $effectiveBefore, $limit);
        } else {
            $olderCeiling = $before !== null ? min($before, $alignedStart) : $alignedStart;
            // The synthesized in-progress bar only belongs on the page that's actually
            // at the "live edge" of the replay -- a request paginating further back into
            // pure history ($before at or before $alignedStart) is asking for older,
            // fully-elapsed bars only, and gets exactly that with no synthetic bar
            // appended, exactly like every other page of this same scroll-back query.
            $includePartial = ($before === null || $before > $alignedStart);
            $olderLimit = $includePartial ? max(1, $limit - 1) : $limit;
            $rows = $this->fetchStoredCandles($session['symbol'], $displayTf, $olderCeiling, $olderLimit);

            if ($includePartial) {
                $elapsed = $this->db->prepare("SELECT open_time, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe='15m' AND open_time >= ? AND open_time < ? ORDER BY open_time ASC");
                $elapsed->bindValue(1, $session['symbol']);
                $elapsed->bindValue(2, $alignedStart, PDO::PARAM_INT);
                $elapsed->bindValue(3, $ceiling, PDO::PARAM_INT);
                $elapsed->execute();
                $partial = backtestAggregateCandles($elapsed->fetchAll());
                if ($partial !== null) $rows[] = $partial;
            }
        }

        jsonResponse([
            'candles' => array_map(fn($r) => [
                'time' => (int) $r['open_time'], 'open' => (float) $r['open'], 'high' => (float) $r['high'],
                'low' => (float) $r['low'], 'close' => (float) $r['close'], 'volume' => (float) $r['volume'],
            ], $rows),
            'replay_cursor_ms' => (int) $session['replay_cursor_ms'],
            'timeframe' => $displayTf,
        ]);
    }

    /** Real, stored candles at $timeframe strictly before $before, most-recent $limit of
     *  them, ascending. Shared by both branches of getCandles() -- the only difference
     *  between them is what $before/$limit/$timeframe are computed as. */
    private function fetchStoredCandles(string $symbol, string $timeframe, int $before, int $limit): array {
        $s = $this->db->prepare("SELECT open_time, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe=? AND open_time < ? ORDER BY open_time DESC LIMIT ?");
        $s->bindValue(1, $symbol);
        $s->bindValue(2, $timeframe);
        $s->bindValue(3, $before, PDO::PARAM_INT);
        $s->bindValue(4, $limit, PDO::PARAM_INT);
        $s->execute();
        return array_reverse($s->fetchAll());
    }

    // ── REPLAY ADVANCE ───────────────────────────────────────

    /**
     * v3.20.11 — resolves what ONE click of Next Bar/Prev Bar/Play actually advances by:
     * the FINER of (whatever the client says it's currently viewing, the session's own
     * fixed replay_timeframe). Viewing 15m while replaying a nominally 1H session steps
     * 15 minutes at a time (finer than the session's own label — the whole point of this
     * release: "the 4H candle must be seen developing, never appearing whole" applies
     * symmetrically to entry timing on a finer view too). Viewing 4H/1D while replaying
     * 1H still only steps 1H at a time — going COARSER than the session's own
     * replay_timeframe in one click was never a real feature to begin with (that's just
     * "view a bigger picture," handled entirely by getCandles()'s own display-timeframe
     * synthesis) and isn't how a prop-firm challenge's own timeframe is meant to be sped
     * past. No display timeframe given at all falls back to the session's own
     * replay_timeframe, matching pre-v3.20.11 behavior exactly.
     */
    private function resolveStepTimeframe(array $session, $requestedDisplayTf): string {
        $replayTf = $session['replay_timeframe'];
        $displayTf = trim((string) ($requestedDisplayTf ?? ''));
        if ($displayTf === '') return $replayTf;
        if (!in_array($displayTf, ['15m', '1H', '4H', '1D'], true)) jsonError('Invalid display timeframe.');
        return backtestTimeframeStepMs($displayTf) < backtestTimeframeStepMs($replayTf) ? $displayTf : $replayTf;
    }

    /**
     * v3.20.11 — "Jump to Latest" is removed (a replay whose cursor is already the
     * latest visible point has nothing to jump to); this is Next Bar only now, always
     * exactly one step at whatever resolveStepTimeframe() resolves to for this click.
     * cursor_step_tf is updated alongside replay_cursor_ms every time, so
     * get_backtest_candles' own no-lookahead ceiling always knows which resolution the
     * bar just revealed actually came from (see that method's own docblock).
     */
    public function advance() {
        $d = jsonInput();
        $id = validId($d['session_id'] ?? 0);
        if (!$id) jsonError('Invalid session id.');
        $session = $this->loadSession($id);
        if ($session['status'] !== 'active') jsonError('This session is already ' . $session['status'] . ' — nothing further to replay.');

        $stepTf = $this->resolveStepTimeframe($session, $d['display_timeframe'] ?? null);

        $nextBar = $this->db->prepare("SELECT open_time, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe=? AND open_time > ? ORDER BY open_time ASC LIMIT 1");
        $nextBar->bindValue(1, $session['symbol']);
        $nextBar->bindValue(2, $stepTf);
        $nextBar->bindValue(3, (int) $session['replay_cursor_ms'], PDO::PARAM_INT);
        $nextBar->execute();
        $bar = $nextBar->fetch();

        if (!$bar) {
            jsonResponse(['success' => true, 'advanced' => 0, 'session' => $this->sessionSummary($session, $this->computeSessionState($session)), 'step_timeframe' => $stepTf]);
            return;
        }
        $bar['open_time'] = (int) $bar['open_time'];

        $events = $this->evaluateBar($session, $bar);

        $this->db->prepare("UPDATE backtest_sessions SET replay_cursor_ms=?, cursor_step_tf=? WHERE id=?")->execute([$bar['open_time'], $stepTf, $session['id']]);
        $session['replay_cursor_ms'] = $bar['open_time'];
        $session['cursor_step_tf'] = $stepTf;

        $state = $this->computeSessionState($session, $bar);
        if ($this->checkChallengeRules($session, $state, $bar)) {
            $session['status'] = 'failed';
        } elseif ($this->checkProfitTarget($session, $state, $bar)) {
            $session['status'] = 'passed';
        }

        $session = $this->loadSession($id); // re-read: status/fail/pass columns may have just changed
        $finalState = $this->computeSessionState($session, $bar);

        jsonResponse([
            'success' => true,
            'advanced' => 1,
            'last_bar_time' => $bar['open_time'],
            'events' => $events,
            'session' => $this->sessionSummary($session, $finalState),
            'open_positions' => $finalState['open_positions'],
            'step_timeframe' => $stepTf,
        ]);
    }

    /**
     * v3.20.10 — Prev Bar. Steps replay_cursor_ms back exactly one bar at
     * resolveStepTimeframe()'s own resolution (v3.20.11 — the same adaptive step
     * advance() uses; a display_timeframe finer than the session's replay_timeframe
     * steps back that finer amount, never coarser than replay_timeframe) and undoes
     * everything that happened strictly after the new cursor, so stale P&L can never
     * survive a rewind:
     *   - a trade OPENED after the new cursor never happened from this point of view —
     *     flagged backtest_rewound=1 (excluded from every equity/stats query in this
     *     controller), never deleted, per the requirement that it stay visible in the log.
     *   - a trade opened BEFORE the new cursor but closed AFTER it is reopened: its close
     *     is undone (result back to 'Open', exit fields cleared), its entry is left
     *     exactly as it was. Its fee is recomputed to entry-only via backtestFee() (a
     *     pure function of entry_price/lot_size/fee_rate_pct) rather than "subtracted"
     *     from the stored combined total — settleTrade() overwrites `fees` with
     *     entry+exit combined and there is no separate stored entry-only column, but the
     *     fee formula is deterministic, so recomputing it returns exactly what was
     *     originally charged at fill time.
     *   - a pending order PLACED after the new cursor never existed from this point of
     *     view either — deleted outright (unlike a trade, an order that never filled has
     *     no execution facts of its own worth preserving in a log).
     *   - a pending order that FILLED after the new cursor (i.e. its trade is one of the
     *     ones just flagged rewound) returns to status='pending', trade_id=NULL — the
     *     fill itself is exactly the kind of "thing that happened after the cursor" this
     *     whole method undoes.
     *   - session status/pass/fail rolls back to 'active' if the bar that set it is now
     *     after the new cursor.
     * rewind_count accumulates how many trade OUTCOMES were actually undone (fully
     * rewound + reopened-from-closed), not how many times this endpoint was called — a
     * step back into empty history doesn't move the count, so it stays a meaningful
     * measure of "how much has been erased," per the requirement.
     *
     * Two-phase confirm: with no {confirmed:true} in the body, this only ever COUNTS what
     * would be undone and reports it back without writing anything — the frontend uses
     * this to show "this will undo N trade(s)" before the user commits. A step back that
     * would undo nothing needs no confirmation and applies immediately.
     */
    public function rewind() {
        $d = jsonInput();
        $id = validId($d['session_id'] ?? 0);
        if (!$id) jsonError('Invalid session id.');
        $session = $this->loadSession($id);

        $stepTf = $this->resolveStepTimeframe($session, $d['display_timeframe'] ?? null);
        $stepMs = backtestTimeframeStepMs($stepTf);
        $newCursorMs = (int) $session['replay_cursor_ms'] - $stepMs;

        // Snap to a real candle at the step's own resolution, same "the cursor always
        // sits on a real bar" principle createSession() itself already uses — a rewind
        // must never leave the cursor on an arbitrary timestamp between two actual bars.
        $prevBar = $this->db->prepare("SELECT open_time FROM candles WHERE symbol=? AND timeframe=? AND open_time <= ? ORDER BY open_time DESC LIMIT 1");
        $prevBar->execute([$session['symbol'], $stepTf, $newCursorMs]);
        $realNewCursor = $prevBar->fetchColumn();
        if ($realNewCursor === false || (int) $realNewCursor < (int) $session['start_time']) {
            jsonError('Already at the start of this session — nothing to step back to.');
        }
        $realNewCursor = (int) $realNewCursor;
        $newCursorDt = gmdate('Y-m-d H:i:s', (int) ($realNewCursor / 1000));

        $openedAfter = $this->db->prepare("SELECT id FROM trades WHERE backtest_session_id=? AND source='backtest' AND backtest_rewound=0 AND time_in > ?");
        $openedAfter->execute([$id, $newCursorDt]);
        $openedAfterIds = array_map('intval', array_column($openedAfter->fetchAll(), 'id'));

        $reopen = $this->db->prepare("SELECT * FROM trades WHERE backtest_session_id=? AND source='backtest' AND backtest_rewound=0 AND time_in <= ? AND time_out IS NOT NULL AND time_out > ?");
        $reopen->execute([$id, $newCursorDt, $newCursorDt]);
        $reopenRows = $reopen->fetchAll();

        $affected = count($openedAfterIds) + count($reopenRows);
        if (empty($d['confirmed']) && $affected > 0) {
            jsonResponse(['confirm_required' => true, 'trades_affected' => $affected]);
            return;
        }

        if ($openedAfterIds) {
            $in = implode(',', array_fill(0, count($openedAfterIds), '?'));
            $this->db->prepare("UPDATE trades SET backtest_rewound=1 WHERE id IN ($in)")->execute($openedAfterIds);
            $this->db->prepare("UPDATE backtest_pending_orders SET status='pending', trade_id=NULL WHERE trade_id IN ($in)")->execute($openedAfterIds);
        }
        foreach ($reopenRows as $t) {
            $entryFee = round(backtestFee((float) $t['lot_size'], (float) $t['entry_price'], (float) $session['fee_rate_pct']), 4);
            $this->db->prepare(
                "UPDATE trades SET result='Open', exit_price=NULL, time_out=NULL, fees=?, pnl=NULL, net_pnl=NULL, exit_reason=NULL, r_multiple=NULL, r_multiple_source=NULL WHERE id=?"
            )->execute([$entryFee, $t['id']]);
        }
        $this->db->prepare("DELETE FROM backtest_pending_orders WHERE session_id=? AND placed_at_bar_time > ?")->execute([$id, $realNewCursor]);

        $clearFail = $session['fail_bar_time'] !== null && (int) $session['fail_bar_time'] > $realNewCursor;
        $clearPass = $session['passed_at_bar_time'] !== null && (int) $session['passed_at_bar_time'] > $realNewCursor;
        if ($clearFail || $clearPass) {
            $this->db->prepare(
                "UPDATE backtest_sessions SET status='active', fail_reason=NULL, fail_bar_time=NULL, fail_equity=NULL, passed_at_bar_time=NULL, passed_trading_days=NULL, passed_trade_count=NULL WHERE id=?"
            )->execute([$id]);
        }
        $this->db->prepare("UPDATE backtest_sessions SET replay_cursor_ms=?, cursor_step_tf=?, rewind_count = rewind_count + ? WHERE id=?")->execute([$realNewCursor, $stepTf, $affected, $id]);

        $session = $this->loadSession($id);
        $state = $this->computeSessionState($session);
        jsonResponse([
            'success' => true,
            'trades_rewound' => $affected,
            'session' => $this->sessionSummary($session, $state),
            'open_positions' => $state['open_positions'],
            'step_timeframe' => $stepTf,
        ]);
    }

    // ── ORDERS ───────────────────────────────────────────────

    public function placeOrder() {
        $d = jsonInput();
        $id = validId($d['session_id'] ?? 0);
        if (!$id) jsonError('Invalid session id.');
        $session = $this->loadSession($id);
        if ($session['status'] !== 'active') jsonError('This session is ' . $session['status'] . ' — no new orders can be placed.');

        // Blocks placing an order while viewing an earlier bar (view-only scrollback) —
        // the client must be looking at exactly the session's own current replay bar.
        $clientBarTime = isset($d['client_bar_time']) ? (int) $d['client_bar_time'] : null;
        if ($clientBarTime === null || $clientBarTime !== (int) $session['replay_cursor_ms']) {
            jsonError('You are viewing an earlier bar. Jump to the latest bar before placing an order.');
        }

        $type = in_array($d['type'] ?? '', ['market', 'limit'], true) ? $d['type'] : null;
        $direction = in_array($d['direction'] ?? '', ['Long', 'Short'], true) ? $d['direction'] : null;
        if (!$type || !$direction) jsonError('Order type and direction (Long/Short) are required.');

        $stopLoss = num($d['stop_loss'] ?? 0);
        if ($stopLoss <= 0) jsonError('Stop loss is required for every backtest order.');
        $takeProfit = (isset($d['take_profit']) && $d['take_profit'] !== '') ? num($d['take_profit']) : null;

        $state = $this->computeSessionState($session);
        $limits = $this->checkTradeLimits($session, $state, $session['replay_cursor_ms']);
        if ($limits['blocked']) jsonError($limits['reason']);

        $currentBar = $this->currentBar($session);
        if (!$currentBar) jsonError('No candle data at the current replay position.');

        if ($type === 'market') {
            $entryPrice = (float) $currentBar['close'];
            if ($direction === 'Long' && $stopLoss >= $entryPrice) jsonError('For a Long, stop loss must be below entry.');
            if ($direction === 'Short' && $stopLoss <= $entryPrice) jsonError('For a Short, stop loss must be above entry.');
            $this->fillPosition($session, $direction, $entryPrice, $stopLoss, $takeProfit, $state['equity'], $currentBar['open_time']);
            jsonResponse(['success' => true, 'filled' => true, 'entry_price' => $entryPrice]);
        } else {
            $limitPrice = num($d['limit_price'] ?? 0);
            if ($limitPrice <= 0) jsonError('Limit price is required for a limit order.');
            if ($direction === 'Long' && $stopLoss >= $limitPrice) jsonError('For a Long, stop loss must be below the limit price.');
            if ($direction === 'Short' && $stopLoss <= $limitPrice) jsonError('For a Short, stop loss must be above the limit price.');
            $this->db->prepare(
                "INSERT INTO backtest_pending_orders (session_id, direction, limit_price, stop_loss, take_profit, risk_pct, placed_at_bar_time)
                 VALUES (?,?,?,?,?,?,?)"
            )->execute([$session['id'], $direction, $limitPrice, $stopLoss, $takeProfit, $session['risk_pct'], $currentBar['open_time']]);
            jsonResponse(['success' => true, 'filled' => false, 'pending_order_id' => (int) $this->db->lastInsertId()]);
        }
    }

    /** ON DELETE CASCADE on both fk_bpo_session and fk_trades_backtest_session
     *  (2026_09_25_0001) means a plain delete here also removes this session's pending
     *  orders and its simulated trades rows -- nothing left behind to leak into a real
     *  challenge's trade log, and no separate cleanup query needed. */
    public function deleteSession() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid session id.');
        $this->loadSession($id); // 404s if it doesn't exist or isn't this user's
        $this->db->prepare("DELETE FROM backtest_sessions WHERE id=? AND user_id=?")->execute([$id, $this->uid]);
        jsonResponse(['success' => true]);
    }

    public function cancelOrder() {
        $d = jsonInput();
        $orderId = validId($d['order_id'] ?? 0);
        if (!$orderId) jsonError('Invalid order id.');
        $o = $this->db->prepare("SELECT bpo.id, bpo.status FROM backtest_pending_orders bpo JOIN backtest_sessions bs ON bs.id=bpo.session_id WHERE bpo.id=? AND bs.user_id=?");
        $o->execute([$orderId, $this->uid]);
        $row = $o->fetch();
        if (!$row) jsonError('Order not found.');
        if ($row['status'] !== 'pending') jsonError('Only a still-pending order can be cancelled.');
        $this->db->prepare("UPDATE backtest_pending_orders SET status='cancelled' WHERE id=?")->execute([$orderId]);
        jsonResponse(['success' => true]);
    }

    public function closePosition() {
        $d = jsonInput();
        $tradeId = validId($d['trade_id'] ?? 0);
        if (!$tradeId) jsonError('Invalid trade id.');
        $t = $this->db->prepare("SELECT * FROM trades WHERE id=? AND user_id=? AND source='backtest' AND backtest_rewound=0");
        $t->execute([$tradeId, $this->uid]);
        $trade = $t->fetch();
        if (!$trade) jsonError('Backtest trade not found.');
        if ($trade['result'] !== 'Open') jsonError('This position is already closed.');

        $session = $this->loadSession((int) $trade['backtest_session_id']);
        $currentBar = $this->currentBar($session);
        if (!$currentBar) jsonError('No candle data at the current replay position.');

        $this->settleTrade($trade, (float) $currentBar['close'], 'Manual Closing', (float) $session['fee_rate_pct']);
        jsonResponse(['success' => true]);
    }

    // ── INTERNALS ────────────────────────────────────────────

    private function loadSession(int $id): array {
        $s = $this->db->prepare("SELECT * FROM backtest_sessions WHERE id=? AND user_id=?");
        $s->execute([$id, $this->uid]);
        $row = $s->fetch();
        if (!$row) jsonError('Backtest session not found.');
        return $row;
    }

    /** The market-fill/close price at exactly the current cursor position. Always reads
     *  the 15m candle at that exact timestamp (v3.20.11) rather than
     *  $session['replay_timeframe'] or cursor_step_tf -- adaptive stepping means the
     *  cursor can now sit at a resolution finer than the session's own nominal
     *  replay_timeframe, and a query for e.g. a 1H candle at a 15m-aligned, non-hour
     *  timestamp (14:15) would simply find nothing. 15m candles exist everywhere
     *  coarser ones do and the cursor is always exactly on a real bar boundary of
     *  whichever resolution the last step used -- since every one of this app's four
     *  timeframes is a whole multiple of 15m, that boundary is always 15m-aligned too. */
    private function currentBar(array $session): ?array {
        $s = $this->db->prepare("SELECT open_time, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe='15m' AND open_time=?");
        $s->execute([$session['symbol'], $session['replay_cursor_ms']]);
        $row = $s->fetch();
        if (!$row) return null;
        $row['open_time'] = (int) $row['open_time'];
        foreach (['open', 'high', 'low', 'close', 'volume'] as $f) $row[$f] = (float) $row[$f];
        return $row;
    }

    private function getPendingOrders(int $sessionId): array {
        $s = $this->db->prepare("SELECT * FROM backtest_pending_orders WHERE session_id=? AND status='pending' ORDER BY placed_at_bar_time DESC");
        $s->execute([$sessionId]);
        return $s->fetchAll();
    }

    /**
     * One bar's worth of simulation: pending limit orders that just got touched fill
     * first (using their own limit_price as the fill — not the bar's open/close,
     * since a limit order fills exactly at its own price by definition), then every
     * currently-open position is checked for a stop-loss/take-profit touch on this
     * same bar. If a single bar's high/low range touches BOTH levels, stop-loss wins —
     * a deliberately conservative assumption (OHLC data alone cannot tell which was
     * touched first intrabar, and assuming the worse outcome never overstates a
     * backtest's performance the way assuming the better one could).
     */
    private function evaluateBar(array $session, array $bar): array {
        // PDO returns DECIMAL columns as strings by default -- PHP's <=/>= operators do
        // compare a numeric string against a float correctly, but casting explicitly
        // once here (rather than relying on that implicit conversion at every
        // comparison below) keeps every fill/SL/TP check unambiguous, matching how the
        // rest of this controller casts DB values explicitly everywhere else.
        $bar['open'] = (float) $bar['open'];
        $bar['high'] = (float) $bar['high'];
        $bar['low'] = (float) $bar['low'];
        $bar['close'] = (float) $bar['close'];

        $events = [];

        $pending = $this->getPendingOrders($session['id']);
        foreach ($pending as $order) {
            $touched = $order['direction'] === 'Long'
                ? $bar['low'] <= (float) $order['limit_price']
                : $bar['high'] >= (float) $order['limit_price'];
            if (!$touched) continue;

            $state = $this->computeSessionState($session, $bar);
            $tradeId = $this->fillPosition(
                $session, $order['direction'], (float) $order['limit_price'], (float) $order['stop_loss'],
                $order['take_profit'] !== null ? (float) $order['take_profit'] : null, $state['equity'], $bar['open_time']
            );
            $this->db->prepare("UPDATE backtest_pending_orders SET status='filled', trade_id=? WHERE id=?")->execute([$tradeId, $order['id']]);
            $events[] = ['type' => 'limit_filled', 'trade_id' => $tradeId, 'price' => (float) $order['limit_price']];
        }

        $open = $this->db->prepare("SELECT * FROM trades WHERE backtest_session_id=? AND source='backtest' AND backtest_rewound=0 AND result='Open'");
        $open->execute([$session['id']]);
        foreach ($open->fetchAll() as $trade) {
            $stop = (float) $trade['stop_loss'];
            $target = $trade['take_profit'] !== null ? (float) $trade['take_profit'] : null;

            $touch = backtestCheckSlTp($trade['direction'], $bar['high'], $bar['low'], $stop, $target);
            if ($touch === 'stop_loss') {
                $this->settleTrade($trade, $stop, 'Stop Loss', (float) $session['fee_rate_pct']);
                $events[] = ['type' => 'stop_loss', 'trade_id' => (int) $trade['id'], 'price' => $stop];
            } elseif ($touch === 'take_profit') {
                $this->settleTrade($trade, $target, 'Take Profit', (float) $session['fee_rate_pct']);
                $events[] = ['type' => 'take_profit', 'trade_id' => (int) $trade['id'], 'price' => $target];
            }
        }

        return $events;
    }

    /** Opens a new backtest position: sizes it from risk % of current equity against
     *  the stop distance, charges the entry-side fee, writes it into `trades` exactly
     *  like a live import would (source='backtest' instead of 'import'/'manual'). */
    private function fillPosition(array $session, string $direction, float $entryPrice, float $stopLoss, ?float $takeProfit, float $equity, int $barTime): int {
        $riskAmount = $equity * (float) $session['risk_pct'] / 100;
        $lotSize = backtestPositionSize($equity, (float) $session['risk_pct'], $entryPrice, $stopLoss);
        $entryFee = round(backtestFee($lotSize, $entryPrice, (float) $session['fee_rate_pct']), 4);
        $tradeDate = gmdate('Y-m-d', (int) ($barTime / 1000));
        $timeIn = gmdate('Y-m-d H:i:s', (int) ($barTime / 1000));

        $this->db->prepare(
            "INSERT INTO trades
                (user_id, challenge_id, trade_date, time_in, pair, direction, entry_price, stop_loss, take_profit,
                 lot_size, fees, result, source, backtest_session_id, risk_amount)
             VALUES (?,NULL,?,?,?,?,?,?,?,?,?,'Open','backtest',?,?)"
        )->execute([
            $this->uid, $tradeDate, $timeIn, $session['symbol'], $direction, $entryPrice, $stopLoss, $takeProfit,
            $lotSize, $entryFee, $session['id'], $riskAmount,
        ]);
        return (int) $this->db->lastInsertId();
    }

    /** Closes an open backtest position: applies the exit-side fee on top of whatever
     *  entry fee was already charged at fill time, computes gross/net P&L, and writes
     *  the resolved result — same net_pnl = pnl - fees formula this codebase already
     *  settled on for every other trade source (CLAUDE.md v3.18.1). */
    private function settleTrade(array $trade, float $exitPrice, string $exitReason, float $feeRatePct): void {
        $entry = (float) $trade['entry_price'];
        $lot = (float) $trade['lot_size'];
        $long = $trade['direction'] === 'Long';
        $pnl = round(backtestPnl($trade['direction'], $entry, $exitPrice, $lot), 4);
        $exitFee = round(backtestFee($lot, $exitPrice, $feeRatePct), 4);
        $totalFees = round((float) $trade['fees'] + $exitFee, 4);
        $net = round($pnl - $totalFees, 4);
        $result = $pnl > 0 ? 'Win' : ($pnl < 0 ? 'Loss' : 'Break Even');
        $riskPerUnit = abs($entry - (float) $trade['stop_loss']);
        $rMultiple = $riskPerUnit > 0 ? round(backtestPnl($trade['direction'], $entry, $exitPrice, 1) / $riskPerUnit, 4) : null;

        $this->db->prepare(
            "UPDATE trades SET time_out=?, exit_price=?, fees=?, pnl=?, net_pnl=?, result=?, exit_reason=?, r_multiple=?, r_multiple_source='recorded' WHERE id=?"
        )->execute([
            gmdate('Y-m-d H:i:s'), $exitPrice, $totalFees, $pnl, $net, $result, $exitReason, $rMultiple, $trade['id'],
        ]);
    }

    /**
     * Derives everything the challenge panel and the rule checks need, fresh, from
     * `trades` — no stored equity/peak_equity column to drift (see this file's own
     * header comment and the migration's matching one). $markBar, when given, is used
     * to mark still-open positions to market for floating P&L; when omitted, open
     * positions are marked at their own entry price (zero floating P&L) — used only by
     * getSessions()' list view, which doesn't need a live mark, just a summary.
     */
    private function computeSessionState(array $session, ?array $markBar = null): array {
        $closed = $this->db->prepare("SELECT trade_date, net_pnl FROM trades WHERE backtest_session_id=? AND source='backtest' AND backtest_rewound=0 AND result IN ('Win','Loss','Break Even') ORDER BY time_out ASC, id ASC");
        $closed->execute([$session['id']]);
        $closedRows = $closed->fetchAll();

        $starting = (float) $session['starting_balance'];
        $running = $starting;
        $peak = $starting;
        $tradingDays = [];
        foreach ($closedRows as $row) {
            $running += (float) $row['net_pnl'];
            if ($running > $peak) $peak = $running;
            if ($row['trade_date']) $tradingDays[$row['trade_date']] = true;
        }
        $closedEquity = $running;

        $open = $this->db->prepare("SELECT * FROM trades WHERE backtest_session_id=? AND source='backtest' AND backtest_rewound=0 AND result='Open'");
        $open->execute([$session['id']]);
        $openRows = $open->fetchAll();

        $floatingTotal = 0.0;
        $openPositions = [];
        foreach ($openRows as $t) {
            $mark = $markBar ? (float) $markBar['close'] : (float) $t['entry_price'];
            $long = $t['direction'] === 'Long';
            $gross = ($long ? ($mark - (float) $t['entry_price']) : ((float) $t['entry_price'] - $mark)) * (float) $t['lot_size'];
            $floating = round($gross - (float) $t['fees'], 4); // entry fee already paid; exit fee not yet known/charged
            $floatingTotal += $floating;
            $openPositions[] = [
                'id' => (int) $t['id'], 'direction' => $t['direction'], 'entry_price' => (float) $t['entry_price'],
                'stop_loss' => (float) $t['stop_loss'], 'take_profit' => $t['take_profit'] !== null ? (float) $t['take_profit'] : null,
                'lot_size' => (float) $t['lot_size'], 'floating_pnl' => $floating, 'mark_price' => $mark,
            ];
        }
        if ($peak < $closedEquity + $floatingTotal) $peak = $closedEquity + $floatingTotal;

        $todayDate = $markBar ? gmdate('Y-m-d', (int) ($markBar['open_time'] / 1000)) : gmdate('Y-m-d', (int) ($session['replay_cursor_ms'] / 1000));
        $tradesToday = $this->db->prepare("SELECT COUNT(*) FROM trades WHERE backtest_session_id=? AND source='backtest' AND backtest_rewound=0 AND trade_date=?");
        $tradesToday->execute([$session['id'], $todayDate]);

        // Today's own realised change (from $closedRows, already fetched above — no
        // second query needed) plus any current floating P&L, shared by both the
        // daily-drawdown rule check and the challenge panel's own display figure, so
        // the two can never disagree about what "today's loss" actually is.
        $todayRealised = 0.0;
        foreach ($closedRows as $row) {
            if ($row['trade_date'] === $todayDate) $todayRealised += (float) $row['net_pnl'];
        }
        $todayChange = round($todayRealised + $floatingTotal, 2);

        return [
            'equity' => round($closedEquity + $floatingTotal, 2),
            'closed_equity' => round($closedEquity, 2),
            'floating_pnl' => round($floatingTotal, 2),
            'peak_equity' => round($peak, 2),
            'open_positions' => $openPositions,
            'trading_days' => count($tradingDays),
            'trade_count' => count($closedRows),
            'trades_today' => (int) $tradesToday->fetchColumn(),
            'today_date' => $todayDate,
            'today_change' => $todayChange,
        ];
    }

    /** Daily trade-count cap — a soft BLOCK on new entries, not a session failure, per
     *  the briefing's own distinction ("max trades per day blocks further entries"
     *  versus "the session is marked FAILED" for a drawdown breach). */
    private function checkTradeLimits(array $session, array $state, $barTime): array {
        if ($session['max_trades_per_day'] !== null && $state['trades_today'] >= (int) $session['max_trades_per_day']) {
            return ['blocked' => true, 'reason' => "Daily trade limit reached ({$state['trades_today']}/{$session['max_trades_per_day']}) for " . $state['today_date'] . '.'];
        }
        return ['blocked' => false, 'reason' => null];
    }

    /**
     * Drawdown rules — checked against TOTAL equity (closed + floating), matching how
     * a real funded account is actually liquidated on unrealized loss, not just on a
     * closed trade. Daily drawdown compares today's own realised+floating change
     * against starting_balance; max drawdown compares the account's distance below
     * starting_balance (static) or below its own peak (trailing) — same static/
     * trailing distinction this codebase already uses for real challenges
     * (helpers.php::staticDrawdownPct()), just evaluated against this session's own
     * simulated equity instead of a live challenge's current_balance. Returns true and
     * marks the session failed the instant either rule is breached; false otherwise.
     */
    private function checkChallengeRules(array $session, array $state, array $bar): bool {
        $starting = (float) $session['starting_balance'];

        // Daily drawdown: today's own net change (closed same-day trades + any current
        // floating loss) against the day's own allowance. $state['today_change'] is
        // computed once in computeSessionState() and shared here and in
        // sessionSummary()'s own daily_drawdown_used_pct, so the rule check and the
        // challenge panel's display figure can never disagree about what "today's
        // loss" means.
        $todayChange = $state['today_change'];
        $dailyAllowance = $starting * (float) $session['daily_drawdown_pct'] / 100;
        if (-$todayChange >= $dailyAllowance) {
            $this->failSession($session, "Daily drawdown breached: -" . number_format(-$todayChange, 2) . " vs a " . $session['daily_drawdown_pct'] . "% allowance ($" . number_format($dailyAllowance, 2) . ").", $bar, $state['equity']);
            return true;
        }

        $maxAllowance = $starting * (float) $session['max_drawdown_pct'] / 100;
        $distance = backtestDrawdownDistance($session['drawdown_type'], $starting, $state['peak_equity'], $state['equity']);
        if ($distance >= $maxAllowance) {
            $basis = $session['drawdown_type'] === 'trailing' ? 'peak equity' : 'starting balance';
            $this->failSession($session, ucfirst($session['drawdown_type']) . " max drawdown breached: -" . number_format($distance, 2) . " below $basis vs a " . $session['max_drawdown_pct'] . "% allowance ($" . number_format($maxAllowance, 2) . ").", $bar, $state['equity']);
            return true;
        }
        return false;
    }

    private function checkProfitTarget(array $session, array $state, array $bar): bool {
        $starting = (float) $session['starting_balance'];
        $target = $starting * (1 + (float) $session['profit_target_pct'] / 100);
        if ($state['equity'] >= $target) {
            $this->db->prepare(
                "UPDATE backtest_sessions SET status='passed', passed_at_bar_time=?, passed_trading_days=?, passed_trade_count=? WHERE id=?"
            )->execute([$bar['open_time'], $state['trading_days'], $state['trade_count'], $session['id']]);
            return true;
        }
        return false;
    }

    private function failSession(array $session, string $reason, array $bar, float $equity): void {
        // A failed account stops trading — any still-open position is force-closed at
        // this same failing bar's price, same as a real prop firm liquidating on
        // breach, so the trade log and the recorded fail_equity agree with each other
        // (an open position left dangling would keep moving after the session is
        // already over, silently disagreeing with the frozen fail_equity snapshot).
        $open = $this->db->prepare("SELECT * FROM trades WHERE backtest_session_id=? AND source='backtest' AND backtest_rewound=0 AND result='Open'");
        $open->execute([$session['id']]);
        foreach ($open->fetchAll() as $trade) {
            $this->settleTrade($trade, (float) $bar['close'], 'Manual Closing', (float) $session['fee_rate_pct']);
        }
        $this->db->prepare(
            "UPDATE backtest_sessions SET status='failed', fail_reason=?, fail_bar_time=?, fail_equity=? WHERE id=?"
        )->execute([$reason, $bar['open_time'], round($equity, 2), $session['id']]);
    }

    private function sessionSummary(array $session, array $state): array {
        $starting = (float) $session['starting_balance'];
        return [
            'id' => (int) $session['id'],
            'session_name' => $session['session_name'],
            'symbol' => $session['blind_mode'] ? null : $session['symbol'],
            'blind_mode' => (bool) $session['blind_mode'],
            'replay_timeframe' => $session['replay_timeframe'],
            'status' => $session['status'],
            'risk_pct' => (float) $session['risk_pct'],
            'fee_rate_pct' => (float) $session['fee_rate_pct'],
            'starting_balance' => $starting,
            'profit_target_pct' => (float) $session['profit_target_pct'],
            'daily_drawdown_pct' => (float) $session['daily_drawdown_pct'],
            'max_drawdown_pct' => (float) $session['max_drawdown_pct'],
            'drawdown_type' => $session['drawdown_type'],
            'max_trades_per_day' => $session['max_trades_per_day'] !== null ? (int) $session['max_trades_per_day'] : null,
            'replay_cursor_ms' => (int) $session['replay_cursor_ms'],
            'start_time' => $session['blind_mode'] ? null : (int) $session['start_time'],
            'equity' => $state['equity'],
            'floating_pnl' => $state['floating_pnl'],
            'peak_equity' => $state['peak_equity'],
            'today_change' => $state['today_change'],
            'progress_to_target_pct' => $session['profit_target_pct'] > 0 ? round(($state['equity'] - $starting) / ($starting * (float) $session['profit_target_pct'] / 100) * 100, 1) : null,
            // Same today_change the daily-drawdown rule check itself uses (see
            // checkChallengeRules()) — the panel and the rule can never disagree.
            'daily_drawdown_used_pct' => $session['daily_drawdown_pct'] > 0 ? round(max(0, -$state['today_change']) / ($starting * (float) $session['daily_drawdown_pct'] / 100) * 100, 1) : null,
            // Distance basis matches drawdown_type exactly the way the rule check does
            // (starting balance for static, this session's own peak for trailing) —
            // previously always used starting balance regardless of type, which would
            // have understated how close a trailing session was to actually failing.
            'max_drawdown_used_pct' => $session['max_drawdown_pct'] > 0 ? round(backtestDrawdownDistance($session['drawdown_type'], $starting, $state['peak_equity'], $state['equity']) / ($starting * (float) $session['max_drawdown_pct'] / 100) * 100, 1) : null,
            'trades_today' => $state['trades_today'],
            'trade_count' => $state['trade_count'],
            'trading_days' => $state['trading_days'],
            'fail_reason' => $session['fail_reason'],
            'fail_bar_time' => $session['fail_bar_time'] !== null ? (int) $session['fail_bar_time'] : null,
            'fail_equity' => $session['fail_equity'] !== null ? (float) $session['fail_equity'] : null,
            'passed_at_bar_time' => $session['passed_at_bar_time'] !== null ? (int) $session['passed_at_bar_time'] : null,
            'passed_trading_days' => $session['passed_trading_days'] !== null ? (int) $session['passed_trading_days'] : null,
            'passed_trade_count' => $session['passed_trade_count'] !== null ? (int) $session['passed_trade_count'] : null,
            // v3.20.10 — how many trade outcomes a rewind has ever undone for this
            // session (see rewind()'s own docblock for exactly what counts). 0 for every
            // session created before this migration ran, correctly (the column defaults
            // to 0, and there is nothing to backfill — no rewind could have happened
            // before this feature existed).
            'rewind_count' => (int) ($session['rewind_count'] ?? 0),
            'created_at' => $session['created_at'],
        ];
    }
}
