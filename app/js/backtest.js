/**
 * FundedControl — Backtesting (v3.20.2 — reliable diagnostics + Saved Backtests split out)
 *
 * Two screens, exactly one visible at a time (showBacktestScreen()):
 *   'form'   — Screen A, new-session setup. Opens directly when the sidebar's
 *              "Backtesting" link is clicked — no session list first.
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
async function loadBacktest() {
    if (btActiveSessionId) {
        // Returning to an already-open session (e.g. browser back) — just resize.
        if (typeof resizeTvChart === 'function') resizeTvChart();
        return;
    }
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
async function onBtSetupPairChange() {
    const symbol = document.getElementById('bt-setup-symbol').value;
    const timeframe = document.getElementById('bt-setup-timeframe').value;
    const rangeEl = document.getElementById('bt-setup-date-range');
    if (!symbol) return;
    const symbols = await btApi('get_symbols');
    if (symbols && symbols.error) return; // already surfaced by populateBtSetupForm()
    const s = (Array.isArray(symbols) ? symbols : []).find(x => x.symbol === symbol);
    if (s && s.earliest_candle_ms) {
        rangeEl.textContent = `Data from ${new Date(s.earliest_candle_ms).toISOString().slice(0, 10)} onward (${timeframe})`;
        document.getElementById('bt-setup-start-date').min = new Date(s.earliest_candle_ms).toISOString().slice(0, 10);
    }
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
    showBacktestScreen('window');

    if (typeof initTvChart === 'function') initTvChart();
    window.btFetchCandlesOverride = (symbol, timeframe, before, limit) => btFetchCandles(before, limit);

    const ok = await refreshBtSession();
    if (!ok) return;
    await btLoadCandleWindow();
    if (typeof resizeTvChart === 'function') resizeTvChart();
}

async function btFetchCandles(before, limit) {
    let action = `get_backtest_candles&session_id=${btActiveSessionId}&limit=${limit || 500}`;
    if (before) action += `&before=${before}`;
    const res = await btApi(action);
    if (res && res.error) { toast('Failed to load candles — ' + res.error, 'error'); return []; }
    return (res && Array.isArray(res.candles)) ? res.candles : [];
}

async function btLoadCandleWindow() {
    const rows = await btFetchCandles(null, 500);
    chartState.candles = rows.map(r => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
    chartState.exhaustedOlder = rows.length < 500;
    chartState.symbol = btSession ? btSession.symbol : null;
    chartState.timeframe = btSession ? btSession.replay_timeframe : '1H';
    chartState.timezone = chartState.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    chartState.blindMode = !!(btSession && btSession.blind_mode);
    if (typeof renderChartData === 'function') renderChartData();
    if (tvChart) tvChart.timeScale().fitContent();
}

/** Returns true on success, false on failure (already shown to the user and bounced
 *  back to the session list) — callers use this to decide whether to keep going. */
async function refreshBtSession() {
    const s = await btApi(`get_backtest_session&id=${btActiveSessionId}`);
    if (!s || s.error) {
        toast('Failed to load session — ' + (s ? s.error : 'unknown error'), 'error');
        btActiveSessionId = null; // otherwise the next visit to Backtesting thinks a session is already open and skips straight back to this same broken screen
        document.body.classList.remove('backtest-active');
        showPage('saved-backtests');
        return false;
    }
    btSession = s;
    document.getElementById('bt-window-name').textContent = s.session_name || '(untitled)';
    document.getElementById('bt-replay-symbol').textContent = s.blind_mode ? '🙈 Blind Mode' : `${s.symbol} · ${s.replay_timeframe}`;
    renderChallengePanel(s);
    renderOpenPositions(s.open_positions || []);
    renderPendingOrders(s.pending_orders || []);
    renderBtOutcome(s);
    document.getElementById('bt-replay-status').textContent = s.status === 'active' ? '' : `Session ${s.status}`;
    return true;
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
    document.getElementById('bt-window-name').textContent = btSession.session_name || '(untitled)';
    document.getElementById('bt-replay-symbol').textContent = btSession.blind_mode ? '🙈 Blind Mode' : `${btSession.symbol} · ${btSession.replay_timeframe}`;
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

function toggleBtAutoplay() {
    const btn = document.getElementById('bt-play-btn');
    if (btAutoplayTimer) { stopBtAutoplay(); return; }
    const speed = parseFloat(document.getElementById('bt-replay-speed').value) || 0;
    if (speed <= 0) { toast('Choose a speed other than Manual to auto-play', 'error'); return; }
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
