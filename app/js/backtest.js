/**
 * FundedControl — Backtesting (v3.20.10 — Prev Bar/rewind, timeframe switch, stable chart)
 *
 * Two screens, exactly one visible at a time (showBacktestScreen()):
 *   'form'   — Screen A, new-session setup. ALWAYS what opens when the sidebar's
 *              "Backtesting" link is clicked, unconditionally — loadBacktest() no longer
 *              looks at btActiveSessionId to decide whether to skip straight back to an
 *              already-open session. That "convenience" (v3.20.1) was the whole bug:
 *              btActiveSessionId is a plain in-memory variable that outlives navigating
 *              away to Saved Backtests, so it kept pointing at a session even after that
 *              session was deleted, and every route back into this page (sidebar link,
 *              "+ New Backtest," "Create your first backtest" — all three just call
 *              showPage('backtest')) silently reopened the dead session's replay window
 *              instead of the form. Resuming a session is now only ever a deliberate
 *              action from Saved Backtests (openBacktestFromList()).
 *   'window' — Screen B, the actual replay (chart/controls/orders/challenge panel).
 *              Full-bleed + dark; body.backtest-active is toggled here, exactly when
 *              entering/leaving THIS screen — not page-wide.
 * Saved Backtests (formerly Screen C) is its own sidebar page as of v3.20.2 —
 * see pages/saved-backtests.php / js/saved-backtests.js. "View Backtests" buttons here
 * navigate there via showPage('saved-backtests'), not a screen switch inside this module.
 *
 * v3.20.2: v3.20.1's btApi() converted a thrown exception into a generic {error:...},
 * which stopped the infinite spinner but threw away exactly the information needed to
 * diagnose *why* the call failed (e.g. a PHP fatal from a migration that hasn't been run
 * on the current server yet reads as raw HTML/plain text, not JSON — res.json() throws,
 * and the old catch block only ever said "could not reach the server"). btApi() no longer
 * calls the shared api() helper at all: it does its own fetch(), always reads the body as
 * text first, and only then tries to parse it as JSON — so a failure surfaces the real
 * HTTP status and the server's actual response text, not a guess. escapeHtml()/
 * btStatusBadge() are also used by js/saved-backtests.js, loaded after this file.
 *
 * Reuses js/chart.js's low-level candlestick/volume rendering (chartState, tvChart,
 * initTvChart(), resizeTvChart(), renderChartData(), updateLegendFromCandle()) rather
 * than duplicating it — this file owns session/order/replay orchestration and points
 * chart.js's own fetchCandles() at the session-scoped, no-lookahead-trimmed
 * get_backtest_candles endpoint via window.btFetchCandlesOverride.
 */

let btActiveSessionId = null;
let btSession = null; // last full session payload from the server
let btDirection = 'Long';
let btAutoplayTimer = null;
// v3.20.10 — what's being DISPLAYED, independent of btSession.replay_timeframe (which
// is always what actually drives the clock — advance()/rewind() never read this). Reset
// to the session's own replay_timeframe every time a session is freshly opened/resumed
// (see refreshBtSession()'s isFirstLoad branch), then only ever changed by the user via
// setBtDisplayTimeframe().
let btDisplayTimeframe = null;

/** Every network/API call this module (and js/saved-backtests.js) makes goes through
 *  this — never a bare api() call. Always returns a plain object: either the server's
 *  own parsed JSON, or {error: "..."} carrying the real HTTP status and raw response
 *  body when the response wasn't parseable JSON at all (a PHP fatal, a redirect to
 *  login, a proxy error page). Nothing here ever throws — callers just check .error. */
async function btApi(action, method, data) {
    let res;
    try {
        const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
        if (data) opts.body = JSON.stringify(data);
        res = await fetch(`includes/api.php?action=${action}`, opts);
    } catch (e) {
        console.error('[backtest] network error:', action, e);
        return { error: 'Network error — the request never reached the server. Check your connection.' };
    }
    let text;
    try {
        text = await res.text();
    } catch (e) {
        return { error: `HTTP ${res.status} ${res.statusText} — could not read the response body.` };
    }
    let parsed;
    try {
        parsed = text === '' ? null : JSON.parse(text);
    } catch (e) {
        console.error('[backtest] non-JSON response:', action, res.status, text);
        // The single most useful diagnostic this file can show: exactly what the server
        // sent back, not a guess. A PHP fatal (e.g. a missing table because a migration
        // hasn't been run yet) or an auth redirect both land here.
        const snippet = text.slice(0, 300).replace(/\s+/g, ' ').trim();
        return { error: `HTTP ${res.status} ${res.statusText} — server did not return JSON. Response: "${snippet || '(empty)'}"` };
    }
    if (parsed === null || parsed === undefined) return { error: `HTTP ${res.status} ${res.statusText} — empty response from server.` };
    if (!res.ok && !parsed.error) return { error: `HTTP ${res.status} ${res.statusText}` };
    return parsed;
}

// ── ENTRY POINT ──────────────────────────────────────────
/** v3.20.5: this used to trust a stale btActiveSessionId and silently resume whatever
 *  session it still pointed at -- including one that had just been deleted, since
 *  nothing clears btActiveSessionId on navigating away from the replay window to Saved
 *  Backtests (only entering Screen A or a failed session load ever did). That's exactly
 *  what let a deleted session's replay window keep reopening from the sidebar link, from
 *  "+ New Backtest," and from "Create your first backtest" -- all three just call
 *  showPage('backtest'), which calls this. Per this release's own requirement, the
 *  sidebar's Backtesting link always opens the New Backtest form; resuming a session is
 *  a deliberate action taken only from Saved Backtests (openBacktestFromList()), never
 *  implicit here. showBacktestScreen('form') itself resets btActiveSessionId to null as
 *  a side effect, so this can never leave a stale reference behind either. */
async function loadBacktest() {
    showBacktestScreen('form');
}

function showBacktestScreen(screen) {
    document.querySelectorAll('.bt-screen').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('bt-screen-' + screen);
    if (el) el.classList.add('active');

    // body.backtest-active drives the dark full-bleed layout (css/style.css's
    // "BACKTESTING" block) -- scoped to exactly this screen, not the whole module, so
    // Screen A stays a normal light-themed page like everywhere else in the app.
    document.body.classList.toggle('backtest-active', screen === 'window');

    if (screen === 'form') { stopBtAutoplay(); btActiveSessionId = null; populateBtSetupForm(); }
    if (screen === 'window' && typeof resizeTvChart === 'function') {
        // The chart container only has its real, final size once this screen is
        // actually visible (display:flex was just applied above) -- resize now rather
        // than trusting whatever size was computed while it was display:none.
        setTimeout(resizeTvChart, 0);
    }
}

function btStatusBadge(status) {
    const map = { active: 'badge-long', passed: 'badge-win', failed: 'badge-loss' };
    const label = { active: 'running', passed: 'passed', failed: 'failed' }[status] || status;
    return `<span class="badge ${map[status] || ''}">${label}</span>`;
}
function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

// ── SETUP FORM (Screen A) ────────────────────────────────
async function populateBtSetupForm() {
    document.getElementById('bt-setup-error').textContent = '';
    const symSel = document.getElementById('bt-setup-symbol');
    symSel.innerHTML = '<option>Loading…</option>';

    const symbols = await btApi('get_symbols');
    if (symbols && symbols.error) {
        symSel.innerHTML = '<option>Failed to load symbols</option>';
        const errEl = document.getElementById('bt-setup-error');
        errEl.innerHTML = '';
        errEl.appendChild(document.createTextNode(`Failed to load symbols — ${symbols.error} `));
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-ghost btn-sm';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = populateBtSetupForm;
        errEl.appendChild(retryBtn);
        return;
    }
    symSel.innerHTML = (Array.isArray(symbols) && symbols.length)
        ? symbols.map(s => `<option value="${s.symbol}">${escapeHtml(s.display_name)}</option>`).join('')
        : '<option>No symbols configured</option>';

    const prefillSel = document.getElementById('bt-setup-prefill');
    const challenges = await btApi('get_challenges');
    if (challenges && !challenges.error && Array.isArray(challenges)) {
        prefillSel.innerHTML = '<option value="">— Custom, don\'t prefill —</option>' +
            challenges.map(c => `<option value='${JSON.stringify(c).replace(/'/g, "&#39;")}'>${escapeHtml(c.name)}</option>`).join('');
    } else if (challenges && challenges.error) {
        // Non-fatal for this form -- the prefill dropdown is a convenience, not a
        // requirement ("the backtest never requires an existing challenge to run").
        prefillSel.innerHTML = '<option value="">— Custom, don\'t prefill —</option>';
        console.warn('[backtest] could not load challenges for prefill:', challenges.error);
    }

    await onBtSetupPairChange();
}
/**
 * v3.20.6: Start Date is optional -- leaving it blank means "start at the absolute
 * earliest available candle" (BacktestController::createSession() honours this
 * server-side, unchanged by v3.20.9). min/max are set to the real available range so an
 * out-of-range date can't be picked in the UI to begin with. Uses
 * get_backtest_symbol_range (candle_sync, scoped to this exact symbol+timeframe pair)
 * rather than get_symbols' own earliest_candle_ms, which is symbol-level only (not
 * per-timeframe) and has no "latest" counterpart at all.
 *
 * v3.20.9: the field now PREFILLS to range.default_start_time, not earliest_open_time.
 * Defaulting to the absolute earliest candle meant every session created without
 * touching this field opened with zero lead-in history by definition -- v3.20.8's
 * 300-bar lead-in fetch was already correctly deployed and correctly implemented, it
 * simply had nothing before the very first candle to fetch. default_start_time
 * (BacktestController::getSymbolRange()) is DEFAULT_LEAD_IN_BARS candles into history
 * instead, so a session created with the default prefill actually has that history
 * behind it. The "Data from ... onward" helper line still reports the true earliest
 * date (min stays there too) -- a user who deliberately wants to start at the very
 * beginning can still type/pick it, or clear the field entirely.
 */
async function onBtSetupPairChange() {
    const symbol = document.getElementById('bt-setup-symbol').value;
    const timeframe = document.getElementById('bt-setup-timeframe').value;
    const rangeEl = document.getElementById('bt-setup-date-range');
    const dateInput = document.getElementById('bt-setup-start-date');
    if (!symbol) return;
    const range = await btApi(`get_backtest_symbol_range&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
    if (!range || range.error || range.earliest_open_time === null) {
        rangeEl.textContent = range && range.error ? '' : 'Not backfilled yet for this timeframe.';
        return;
    }
    const earliest = new Date(range.earliest_open_time).toISOString().slice(0, 10);
    rangeEl.textContent = `Data from ${earliest} onward (${timeframe})`;
    dateInput.min = earliest;
    dateInput.max = range.latest_open_time !== null ? new Date(range.latest_open_time).toISOString().slice(0, 10) : '';
    const defaultStartMs = (range.default_start_time !== null && range.default_start_time !== undefined) ? range.default_start_time : range.earliest_open_time;
    dateInput.value = new Date(defaultStartMs).toISOString().slice(0, 10);
}
function onBtPrefillChange() {
    const raw = document.getElementById('bt-setup-prefill').value;
    if (!raw) return;
    let ch; try { ch = JSON.parse(raw); } catch (e) { return; }
    if (ch.starting_balance) document.getElementById('bt-setup-balance').value = ch.starting_balance;
    if (ch.profit_target_pct) document.getElementById('bt-setup-target').value = ch.profit_target_pct;
    if (ch.daily_loss_limit && ch.starting_balance) document.getElementById('bt-setup-daily-dd').value = (ch.daily_loss_limit / ch.starting_balance * 100).toFixed(2);
    if (ch.max_drawdown_pct) document.getElementById('bt-setup-max-dd').value = ch.max_drawdown_pct;
    if (ch.drawdown_type) document.getElementById('bt-setup-dd-type').value = ch.drawdown_type;
    // Every field stays editable afterward (per the briefing) — this only ever copies
    // values in once, on selection; nothing here re-links the session to this challenge.
}
async function createBacktestSession() {
    const errEl = document.getElementById('bt-setup-error');
    errEl.textContent = '';
    const name = document.getElementById('bt-setup-name').value.trim();
    if (!name) { errEl.textContent = 'Session name is required.'; return; }
    const payload = {
        session_name: name,
        symbol: document.getElementById('bt-setup-symbol').value,
        replay_timeframe: document.getElementById('bt-setup-timeframe').value,
        start_date: document.getElementById('bt-setup-start-date').value,
        risk_pct: document.getElementById('bt-setup-risk-pct').value,
        fee_rate_pct: document.getElementById('bt-setup-fee-rate').value,
        blind_mode: document.getElementById('bt-setup-blind').checked,
        starting_balance: document.getElementById('bt-setup-balance').value,
        profit_target_pct: document.getElementById('bt-setup-target').value,
        daily_drawdown_pct: document.getElementById('bt-setup-daily-dd').value,
        max_drawdown_pct: document.getElementById('bt-setup-max-dd').value,
        drawdown_type: document.getElementById('bt-setup-dd-type').value,
        max_trades_per_day: document.getElementById('bt-setup-max-trades').value || null,
    };
    const res = await btApi('create_backtest_session', 'POST', payload);
    if (res && res.error) { errEl.textContent = res.error; return; }
    if (res && res.success) {
        toast('Backtest created');
        openBacktestSession(res.id);
    }
}

// ── REPLAY (Screen B) ────────────────────────────────────
async function openBacktestSession(id) {
    btActiveSessionId = id;
    // Reset for this session -- refreshBtSession() sets it to the session's own
    // replay_timeframe once it knows what that is. Also drops any stable price range
    // left over from whatever was viewed before, so a freshly opened/resumed session
    // starts from a clean natural fit rather than inheriting an unrelated one.
    btDisplayTimeframe = null;
    btResetPriceRangeStabilizer();
    showBacktestScreen('window');

    if (typeof initTvChart === 'function') initTvChart();
    btInstallPriceRangeStabilizer();
    window.btFetchCandlesOverride = (symbol, timeframe, before, limit) => btFetchCandles(before, limit);

    const ok = await refreshBtSession();
    if (!ok) return;
    await btLoadCandleWindow();
    if (typeof resizeTvChart === 'function') resizeTvChart();
}

// v3.20.8 — a replay session opening with zero lead-in showed one candle stretched to
// fill the whole pane: Lightweight Charts' price scale and fitContent() both autoscale
// to whatever's actually loaded, and with a single bar that's the bar's own high/low
// filling 100% of the vertical axis and its own one time-slot filling 100% of the
// horizontal one. TradingView's own bar replay always opens with real history behind the
// replay point so gate 1/2 structure is visible immediately -- BT_LEAD_IN_BARS is that
// same idea, explicit and tunable rather than an incidental reuse of the general
// load-older-on-scroll page size (still 500, unrelated, in loadOlderCandles()/chart.js).
const BT_LEAD_IN_BARS = 300;
// How many of the loaded bars are actually zoomed to on open/resume/advance/rewind -- a
// fixed, reasonable "typical chart" width instead of fitContent()'s "cram everything
// into view," which looks fine at 300 bars but would still look wrong (tiny, cramped) if
// left as the default zoom, and looks broken at 1-2 bars for exactly the reason above.
const BT_INITIAL_VISIBLE_BARS = 100;
// v3.20.10 — empty bars of room to the right of the replay cursor, TradingView-replay
// style: the cursor sits left-of-center in its window, not pinned at the right edge.
const BT_RIGHT_MARGIN_BARS = 20;

async function btFetchCandles(before, limit) {
    const tf = btDisplayTimeframe || (btSession ? btSession.replay_timeframe : '1H');
    let action = `get_backtest_candles&session_id=${btActiveSessionId}&timeframe=${encodeURIComponent(tf)}&limit=${limit || (BT_LEAD_IN_BARS + 1)}`;
    if (before) action += `&before=${before}`;
    const res = await btApi(action);
    if (res && res.error) { toast('Failed to load candles — ' + res.error, 'error'); return []; }
    return (res && Array.isArray(res.candles)) ? res.candles : [];
}

/**
 * Runs on session open, resume, after every advance/rewind, and on a display-timeframe
 * switch -- one shared path, so lead-in behavior and the stable visible range are
 * automatically consistent everywhere a fresh window is loaded rather than only at
 * session-creation time. get_backtest_candles' own no-lookahead clamp
 * (BacktestController::getCandles()'s replayCeiling) is untouched and still applies to
 * every call here regardless of how many bars are requested or what timeframe is
 * displayed -- this only changes how much HISTORY is requested, never what's allowed
 * after the replay point.
 *
 * If the session's start date has fewer than BT_LEAD_IN_BARS candles behind it (e.g. it
 * starts at the very earliest bar this symbol/timeframe has at all), the server simply
 * returns however many actually exist -- no error, per the requirement -- and
 * exhaustedOlder correctly ends up true so loadOlderCandles() doesn't waste a request
 * trying to fetch history that was never there.
 */
async function btLoadCandleWindow() {
    const rows = await btFetchCandles(null, BT_LEAD_IN_BARS + 1);
    chartState.candles = rows.map(r => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
    chartState.exhaustedOlder = rows.length < (BT_LEAD_IN_BARS + 1);
    chartState.symbol = btSession ? btSession.symbol : null;
    chartState.timeframe = btDisplayTimeframe || (btSession ? btSession.replay_timeframe : '1H');
    chartState.timezone = chartState.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    chartState.blindMode = !!(btSession && btSession.blind_mode);
    if (typeof renderChartData === 'function') renderChartData();
    btSetVisibleRange();
}

/**
 * v3.20.10: fixed-width logical range with room to the right of the cursor, recomputed
 * fresh from the CURRENT candle count every time this runs. Since btFetchCandles()
 * always asks for "the most recent BT_LEAD_IN_BARS+1 candles ending at the cursor," the
 * last loaded bar is always the cursor itself regardless of how far replay has advanced
 * -- so recomputing this range from chartState.candles.length on every call is
 * mathematically identical to shifting the same fixed-width window forward/back by
 * however many bars actually changed, without needing to track a delta explicitly. This
 * is what keeps the visible bar count constant and the cursor's own screen position
 * consistent while stepping, per the requirement -- replacing fitContent()'s "cram
 * everything into view" (v3.20.8) with a real fixed zoom level, now also shifted off the
 * right edge instead of pinned to it. Deliberately requested even when fewer bars are
 * actually loaded (from/to can extend past the real data) -- Lightweight Charts renders
 * the real bars at normal width with empty space filling the rest, rather than
 * stretching sparse data to fill the pane.
 */
function btSetVisibleRange() {
    if (!tvChart) return;
    const total = chartState.candles.length;
    if (!total) return;
    const leftBars = BT_INITIAL_VISIBLE_BARS - BT_RIGHT_MARGIN_BARS;
    tvChart.timeScale().setVisibleLogicalRange({ from: total - leftBars, to: total + BT_RIGHT_MARGIN_BARS });
}

/**
 * v3.20.10 — stops the vertical "bounce" on every step. Lightweight Charts' default
 * price-scale behavior re-fits to whatever's visible every time the data or visible
 * range changes even slightly, which is what made the price axis wobble bar-to-bar. This
 * installs a custom autoscaleInfoProvider on the candle series: it starts from the
 * library's own natural computed range (padded a little), then only ever WIDENS that
 * stored range when a new bar's price would actually fall outside it -- never re-tightens
 * to a fresh fit on a step where the range happens to be narrower, which is exactly what
 * "keep the visible price range stable... only adjust when price would leave the visible
 * range" asks for. Widening (not snapping to a new tight fit) is the closest this
 * library's public API gets to "shift smoothly rather than snapping" for the price axis.
 * Reset (btResetPriceRangeStabilizer()) on a fresh session open/resume and on a display-
 * timeframe switch, since a genuinely new dataset should start from a clean natural fit.
 */
let btPriceRangeState = null;
function btInstallPriceRangeStabilizer() {
    if (!tvCandleSeries) return;
    tvCandleSeries.applyOptions({
        autoscaleInfoProvider: (original) => {
            const res = original();
            if (!res || !res.priceRange) return res;
            const natural = res.priceRange;
            const pad = Math.max((natural.maxValue - natural.minValue) * 0.08, Math.abs(natural.maxValue) * 0.001, 0.0001);
            if (!btPriceRangeState) {
                btPriceRangeState = { minValue: natural.minValue - pad, maxValue: natural.maxValue + pad };
            } else {
                if (natural.minValue < btPriceRangeState.minValue) btPriceRangeState.minValue = natural.minValue - pad;
                if (natural.maxValue > btPriceRangeState.maxValue) btPriceRangeState.maxValue = natural.maxValue + pad;
            }
            return { priceRange: btPriceRangeState };
        },
    });
}
function btResetPriceRangeStabilizer() {
    btPriceRangeState = null;
}

// ── DISPLAY TIMEFRAME SWITCHER ────────────────────────────
/** Changes only what's DISPLAYED -- btSession.replay_timeframe (the clock) is untouched;
 *  advance()/rewind() never read btDisplayTimeframe at all. The same replay timestamp is
 *  preserved automatically: btFetchCandles(null, ...) always asks for "the most recent
 *  N candles ending at the current cursor," regardless of which timeframe that request is
 *  for, so switching timeframes re-fetches lead-in history at the new resolution ending
 *  at exactly the same instant. */
async function setBtDisplayTimeframe(tf) {
    if (!btSession || tf === btDisplayTimeframe) return;
    btDisplayTimeframe = tf;
    setActiveBtDisplayTfButton();
    btResetPriceRangeStabilizer();
    await btLoadCandleWindow();
    if (typeof resizeTvChart === 'function') resizeTvChart();
}
function setActiveBtDisplayTfButton() {
    document.querySelectorAll('.bt-display-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === btDisplayTimeframe));
}

/** Returns true on success, false on failure (already shown to the user and bounced
 *  back to the New Backtest form) — callers use this to decide whether to keep going.
 *  v3.20.5: a deleted-or-never-existed session id must never render a phantom replay
 *  screen. showBacktestScreen('form') (not a page navigation) is deliberate here — this
 *  only ever runs while #page-backtest is already the visible page (every caller either
 *  got here via openBacktestSession(), which is only ever invoked after showPage('backtest')
 *  has already run), so switching screens in place is correct and also resets
 *  btActiveSessionId to null as a side effect, same as every other path into Screen A. */
async function refreshBtSession() {
    const s = await btApi(`get_backtest_session&id=${btActiveSessionId}`);
    if (!s || s.error) {
        toast('Failed to load session — ' + (s ? s.error : 'unknown error'), 'error');
        showBacktestScreen('form');
        return false;
    }
    // A fresh open/resume (not a mid-session refresh after placing/cancelling an order)
    // -- reset the display timeframe to the session's own replay timeframe so each
    // session starts viewing at its native resolution by default.
    const isFirstLoad = !btSession || btSession.id !== s.id;
    btSession = s;
    if (isFirstLoad) btDisplayTimeframe = s.replay_timeframe;
    renderBtHeader(s);
    setActiveBtDisplayTfButton();
    renderChallengePanel(s);
    renderOpenPositions(s.open_positions || []);
    renderPendingOrders(s.pending_orders || []);
    renderBtOutcome(s);
    document.getElementById('bt-replay-status').textContent = s.status === 'active' ? '' : `Session ${s.status}`;
    return true;
}

/** Shared by refreshBtSession(), btAdvance() and btRewind() -- three separate call sites
 *  as of v3.20.10, all needing the exact same header fields kept in sync. */
function renderBtHeader(s) {
    document.getElementById('bt-window-name').textContent = s.session_name || '(untitled)';
    document.getElementById('bt-replay-symbol').textContent = s.blind_mode ? '🙈 Blind Mode' : `${s.symbol} · ${s.replay_timeframe}`;
    document.getElementById('bt-replay-clock-tf').textContent = s.replay_timeframe;
    document.getElementById('bt-cursor-time').textContent = fmtCursorTime(s.replay_cursor_ms);
    // "The session records a rewind count, so repeatedly rewinding losing trades is
    // visible rather than hidden" -- shown only once it's actually non-zero, so a
    // never-rewound session doesn't carry a distracting "Rewinds: 0" row all the time.
    if (s.rewind_count > 0) {
        document.getElementById('bt-rewind-count-row').style.display = 'flex';
        document.getElementById('bt-val-rewind-count').textContent = s.rewind_count;
    }
}
/** UTC, explicitly labelled -- the replay cursor is fundamentally a UTC timestamp
 *  server-side (candles.open_time, backtest_sessions.replay_cursor_ms), and converting
 *  it to a locally-formatted time here would be a second, unrelated timezone concern.
 *  Shown even in blind mode, deliberately: blind mode otherwise hides "which date" (see
 *  updateLegendFromCandle()'s dateLine) to avoid hindsight bias, but this ticket asks for
 *  the cursor timestamp "prominently in the controls bar at all times," specifically so a
 *  Prev Bar step (which removes candles from the chart) is visible/traceable rather than
 *  alarming. Flagged here as a deliberate exception, not an oversight, in case blind-mode
 *  purity is ever prioritized over rewind-safety visibility for this one element. */
function fmtCursorTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function renderChallengePanel(s) {
    const setMeter = (fillId, valId, pct, text) => {
        const fill = document.getElementById(fillId);
        if (fill) fill.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
        document.getElementById(valId).textContent = text;
    };
    setMeter('bt-meter-target', 'bt-val-target', s.progress_to_target_pct, (s.progress_to_target_pct ?? '—') + '%');
    setMeter('bt-meter-daily', 'bt-val-daily', s.daily_drawdown_used_pct, (s.daily_drawdown_used_pct ?? 0) + '% used');
    setMeter('bt-meter-max', 'bt-val-max', s.max_drawdown_used_pct, (s.max_drawdown_used_pct ?? 0) + '% used');
    document.getElementById('bt-val-trades-today').textContent = s.max_trades_per_day ? `${s.trades_today}/${s.max_trades_per_day}` : s.trades_today;
    document.getElementById('bt-val-equity').textContent = fmt(s.equity) + (s.floating_pnl ? ` (${s.floating_pnl >= 0 ? '+' : ''}${fmt(s.floating_pnl)} floating)` : '');
}

function renderBtOutcome(s) {
    const el = document.getElementById('bt-outcome-banner');
    if (s.status === 'passed') {
        el.style.display = 'block'; el.style.background = 'rgba(38,166,154,0.15)'; el.style.color = '#26a69a';
        el.textContent = `✅ PASSED — target reached in ${s.passed_trading_days} trading day(s), ${s.passed_trade_count} trade(s).`;
    } else if (s.status === 'failed') {
        el.style.display = 'block'; el.style.background = 'rgba(239,83,80,0.15)'; el.style.color = '#ef5350';
        el.textContent = `❌ FAILED — ${s.fail_reason}`;
    } else {
        el.style.display = 'none';
    }
}

function renderOpenPositions(positions) {
    const el = document.getElementById('bt-open-positions');
    if (!positions.length) { el.innerHTML = '<div style="color:#6b7280;font-size:12px">None</div>'; return; }
    el.innerHTML = positions.map(p => `
        <div class="bt-panel-row" style="border-bottom:1px solid #232733;padding-bottom:6px;margin-bottom:6px">
            <span>${p.direction} @ ${fmtPrice5(p.entry_price)}</span>
            <span class="${pnlCls(p.floating_pnl)}">${fmt(p.floating_pnl)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#8b93a7;margin-bottom:6px">
            <span>SL ${fmtPrice5(p.stop_loss)}${p.take_profit ? ' / TP ' + fmtPrice5(p.take_profit) : ''}</span>
            <button class="btn btn-ghost btn-sm" onclick="closeBtPosition(${p.id})">Close</button>
        </div>`).join('');
}
function renderPendingOrders(orders) {
    const el = document.getElementById('bt-pending-orders');
    if (!orders.length) { el.innerHTML = '<div style="color:#6b7280;font-size:12px">None</div>'; return; }
    el.innerHTML = orders.map(o => `
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
            <span>${o.direction} limit @ ${fmtPrice5(o.limit_price)}</span>
            <button class="btn btn-ghost btn-sm" onclick="cancelBtOrder(${o.id})">Cancel</button>
        </div>`).join('');
}
function fmtPrice5(v) { const n = parseFloat(v); return isNaN(n) ? '—' : n.toFixed(Math.abs(n) >= 100 ? 2 : (Math.abs(n) >= 1 ? 4 : 6)); }

// ── ADVANCE ──────────────────────────────────────────────
async function btAdvance(jumpToLatest) {
    if (!btActiveSessionId || !btSession || btSession.status !== 'active') return;
    const res = await btApi('backtest_advance', 'POST', { session_id: btActiveSessionId, jump_to_latest: !!jumpToLatest });
    if (!res || res.error) { toast('Advance failed — ' + (res ? res.error : 'unknown error'), 'error'); stopBtAutoplay(); return; }

    (res.events || []).forEach(ev => {
        const label = { limit_filled: 'Limit order filled', stop_loss: 'Stop loss hit', take_profit: 'Take profit hit' }[ev.type] || ev.type;
        toast(`${label} @ ${fmtPrice5(ev.price)}`);
    });

    btSession = res.session;
    renderBtHeader(btSession);
    renderChallengePanel(btSession);
    renderOpenPositions(res.open_positions || []);
    renderBtOutcome(btSession);
    if (btSession.status !== 'active') { stopBtAutoplay(); document.getElementById('bt-replay-status').textContent = `Session ${btSession.status}`; }

    await btLoadCandleWindow();

    if (jumpToLatest && res.more_available) {
        // Safety-capped batch (BacktestController::MAX_JUMP_BARS) -- more history to
        // catch up on than one request processes; continue automatically rather than
        // requiring the user to click again for what looks like one action to them.
        setTimeout(() => btAdvance(true), 50);
    }
}

/**
 * v3.20.10 — Prev Bar. Two-phase confirm: the first call (no {confirmed:true}) only ever
 * COUNTS what would be undone server-side and reports it back without writing anything;
 * a step that would undo one or more trades shows a confirm() naming exactly how many
 * before re-calling with confirmed:true. A step into empty history that undoes nothing
 * never prompts. btLoadCandleWindow() re-fetches the window from scratch afterward, which
 * naturally trims any candle after the new (earlier) cursor with no extra client-side
 * logic needed -- the same no-lookahead clamp every other load already goes through.
 */
async function btRewind() {
    if (!btActiveSessionId || !btSession || btSession.status !== 'active') return;
    let res = await btApi('backtest_rewind', 'POST', { session_id: btActiveSessionId });
    if (res && res.error) { toast('Rewind failed — ' + res.error, 'error'); return; }
    if (res && res.confirm_required) {
        const n = res.trades_affected;
        const proceed = confirm(`Stepping back will undo ${n} trade${n === 1 ? '' : 's'} -- ${n === 1 ? 'its outcome' : 'their outcomes'} will be removed from equity and stats (kept in the log, flagged as rewound). Continue?`);
        if (!proceed) return;
        res = await btApi('backtest_rewind', 'POST', { session_id: btActiveSessionId, confirmed: true });
        if (res && res.error) { toast('Rewind failed — ' + res.error, 'error'); return; }
    }
    if (!res || !res.success) return;
    if (res.trades_rewound > 0) toast(`Rewound — ${res.trades_rewound} trade${res.trades_rewound === 1 ? '' : 's'} undone`);

    btSession = res.session;
    renderBtHeader(btSession);
    renderChallengePanel(btSession);
    renderOpenPositions(res.open_positions || []);
    renderBtOutcome(btSession);
    document.getElementById('bt-replay-status').textContent = btSession.status === 'active' ? '' : `Session ${btSession.status}`;

    await btLoadCandleWindow();
}

function toggleBtAutoplay() {
    const btn = document.getElementById('bt-play-btn');
    if (btAutoplayTimer) { stopBtAutoplay(); return; }
    // "Manual" is no longer an option in the speed dropdown (v3.20.10) -- Play always
    // works now; the || 1 fallback is defensive only (the dropdown can't actually submit
    // an empty/zero value any more), not a real Manual-mode case to route around.
    const speed = parseFloat(document.getElementById('bt-replay-speed').value) || 1;
    btn.textContent = '⏸ Pause';
    const intervalMs = Math.max(150, 1500 / speed);
    btAutoplayTimer = setInterval(() => {
        if (!btSession || btSession.status !== 'active') { stopBtAutoplay(); return; }
        btAdvance(false);
    }, intervalMs);
}
function stopBtAutoplay() {
    if (btAutoplayTimer) { clearInterval(btAutoplayTimer); btAutoplayTimer = null; }
    const btn = document.getElementById('bt-play-btn');
    if (btn) btn.textContent = '▶ Play';
}

// ── ORDERS ───────────────────────────────────────────────
function setBtDirection(dir) {
    btDirection = dir;
    document.getElementById('bt-dir-long').classList.toggle('active-long', dir === 'Long');
    document.getElementById('bt-dir-short').classList.toggle('active-short', dir === 'Short');
}
document.addEventListener('DOMContentLoaded', () => {
    const typeSel = document.getElementById('bt-order-type');
    typeSel?.addEventListener('change', () => {
        document.getElementById('bt-limit-price-group').style.display = typeSel.value === 'limit' ? 'flex' : 'none';
    });
    setBtDirection('Long');
});

async function placeBtOrder() {
    const errEl = document.getElementById('bt-order-error');
    errEl.textContent = '';
    if (!btSession || btSession.status !== 'active') { errEl.textContent = 'Session is not active.'; return; }
    const payload = {
        session_id: btActiveSessionId,
        client_bar_time: btSession.replay_cursor_ms, // server rejects if this isn't exactly the session's own current bar -- "jump to latest" first
        type: document.getElementById('bt-order-type').value,
        direction: btDirection,
        stop_loss: document.getElementById('bt-order-sl').value,
        take_profit: document.getElementById('bt-order-tp').value || null,
        limit_price: document.getElementById('bt-order-limit').value,
    };
    const res = await btApi('backtest_place_order', 'POST', payload);
    if (res && res.error) { errEl.textContent = res.error; return; }
    toast(res.filled ? `Filled @ ${fmtPrice5(res.entry_price)}` : 'Limit order placed');
    await refreshBtSession();
}
async function cancelBtOrder(orderId) {
    const res = await btApi('backtest_cancel_order', 'POST', { order_id: orderId });
    if (res && res.error) { toast(res.error, 'error'); return; }
    await refreshBtSession();
}
async function closeBtPosition(tradeId) {
    const res = await btApi('backtest_close_position', 'POST', { trade_id: tradeId });
    if (res && res.error) { toast(res.error, 'error'); return; }
    toast('Position closed');
    await refreshBtSession();
}
