/**
 * FundedControl — Backtesting (Phase 1b, v3.20.0)
 * Session list, setup form, replay controls, order panel, challenge panel.
 *
 * Reuses js/chart.js's low-level candlestick/volume rendering (chartState, tvChart,
 * initTvChart(), resizeTvChart(), renderChartData(), updateLegendFromCandle()) rather
 * than duplicating it — this file owns session/order/replay orchestration and points
 * chart.js's own fetchCandles() at the session-scoped, no-lookahead-trimmed
 * get_backtest_candles endpoint via window.btFetchCandlesOverride.
 *
 * No-lookahead is enforced server-side (BacktestController::getCandles()) — this file
 * never has to hide anything on its own; it simply never receives future data to hide.
 */

let btActiveSessionId = null;
let btSession = null; // last full session payload from the server
let btDirection = 'Long';
let btAutoplayTimer = null;

// ── ENTRY POINT ──────────────────────────────────────────
async function loadBacktest() {
    if (btActiveSessionId) {
        // Returning to a session already open in this tab (e.g. via browser back) —
        // just resize, the data's still loaded.
        if (typeof resizeTvChart === 'function') resizeTvChart();
        return;
    }
    showBacktestView('list');
    await loadBacktestSessions();
}

function showBacktestView(view) {
    document.querySelectorAll('.bt-view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('bt-view-' + view);
    if (el) el.classList.add('active');
    if (view === 'list') {
        stopBtAutoplay();
        btActiveSessionId = null;
        loadBacktestSessions();
    }
    if (view === 'setup') populateBtSetupForm();
}

// ── SESSION LIST ─────────────────────────────────────────
async function loadBacktestSessions() {
    const tbody = document.getElementById('bt-sessions-tbody');
    const sessions = await api('get_backtest_sessions');
    if (!Array.isArray(sessions) || !sessions.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text3)">No sessions yet — start one above.</td></tr>';
        return;
    }
    tbody.innerHTML = sessions.map(s => `
        <tr style="cursor:pointer" onclick="openBacktestSession(${s.id})">
            <td>${s.blind_mode ? '🙈 Blind' : (s.symbol || '—')}</td>
            <td>${s.replay_timeframe}</td>
            <td>${btStatusBadge(s.status)}</td>
            <td class="${pnlCls(s.equity - s.starting_balance)}">${fmt(s.equity)}</td>
            <td>${s.status === 'passed' ? '✅ Target reached' : (s.status === 'failed' ? '❌ ' + (s.fail_reason || 'Failed') : (s.progress_to_target_pct !== null ? s.progress_to_target_pct + '% to target' : '—'))}</td>
            <td>${(s.created_at || '').slice(0, 10)}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openBacktestSession(${s.id})">${s.status === 'active' ? 'Resume' : 'Review'}</button></td>
        </tr>`).join('');
}
function btStatusBadge(status) {
    const map = { active: 'badge-long', passed: 'badge-win', failed: 'badge-loss' };
    return `<span class="badge ${map[status] || ''}">${status}</span>`;
}

// ── SETUP FORM ───────────────────────────────────────────
async function populateBtSetupForm() {
    document.getElementById('bt-setup-error').textContent = '';
    const symSel = document.getElementById('bt-setup-symbol');
    const symbols = await api('get_symbols');
    symSel.innerHTML = (symbols || []).map(s => `<option value="${s.symbol}">${s.display_name}</option>`).join('') || '<option>No symbols configured</option>';

    const prefillSel = document.getElementById('bt-setup-prefill');
    const challenges = await api('get_challenges');
    prefillSel.innerHTML = '<option value="">— Custom, don\'t prefill —</option>' +
        (challenges || []).map(c => `<option value='${JSON.stringify(c).replace(/'/g, "&#39;")}'>${c.name}</option>`).join('');

    await onBtSetupPairChange();
}
async function onBtSetupPairChange() {
    const symbol = document.getElementById('bt-setup-symbol').value;
    const timeframe = document.getElementById('bt-setup-timeframe').value;
    const rangeEl = document.getElementById('bt-setup-date-range');
    if (!symbol) return;
    // get_symbols already carries earliest_candle_ms; a per-timeframe exact bound isn't
    // exposed by a dedicated endpoint yet, so this is a coarse (whole-symbol) hint, not
    // an exact per-timeframe range -- createBacktestSession() is the real, authoritative
    // validation, this is just an upfront hint to avoid an obviously-out-of-range guess.
    const symbols = await api('get_symbols');
    const s = (symbols || []).find(x => x.symbol === symbol);
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
    const payload = {
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
    const res = await api('create_backtest_session', 'POST', payload);
    if (res && res.error) { errEl.textContent = res.error; return; }
    if (res && res.success) {
        toast('Session started');
        openBacktestSession(res.id);
    }
}

// ── REPLAY ───────────────────────────────────────────────
async function openBacktestSession(id) {
    btActiveSessionId = id;
    showBacktestView('replay');

    if (typeof initTvChart === 'function') initTvChart();
    window.btFetchCandlesOverride = (symbol, timeframe, before, limit) => btFetchCandles(before, limit);

    await refreshBtSession();
    await btLoadCandleWindow();
    if (typeof resizeTvChart === 'function') resizeTvChart();
}

async function btFetchCandles(before, limit) {
    let action = `get_backtest_candles&session_id=${btActiveSessionId}&limit=${limit || 500}`;
    if (before) action += `&before=${before}`;
    const res = await api(action);
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

async function refreshBtSession() {
    const s = await api(`get_backtest_session&id=${btActiveSessionId}`);
    if (!s || s.error) { toast(s ? s.error : 'Session not found', 'error'); showBacktestView('list'); return; }
    btSession = s;
    document.getElementById('bt-replay-symbol').textContent = s.blind_mode ? '🙈 Blind Mode' : `${s.symbol} · ${s.replay_timeframe}`;
    renderChallengePanel(s);
    renderOpenPositions(s.open_positions || []);
    renderPendingOrders(s.pending_orders || []);
    renderBtOutcome(s);
    document.getElementById('bt-replay-status').textContent = s.status === 'active' ? '' : `Session ${s.status}`;
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
        el.style.display = 'block'; el.style.background = 'rgba(0,212,160,0.12)'; el.style.color = 'var(--green)';
        el.textContent = `✅ PASSED — target reached in ${s.passed_trading_days} trading day(s), ${s.passed_trade_count} trade(s).`;
    } else if (s.status === 'failed') {
        el.style.display = 'block'; el.style.background = 'rgba(255,77,109,0.12)'; el.style.color = 'var(--red)';
        el.textContent = `❌ FAILED — ${s.fail_reason}`;
    } else {
        el.style.display = 'none';
    }
}

function renderOpenPositions(positions) {
    const el = document.getElementById('bt-open-positions');
    if (!positions.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px">None</div>'; return; }
    el.innerHTML = positions.map(p => `
        <div class="bt-panel-row" style="border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:6px">
            <span>${p.direction} @ ${fmtPrice5(p.entry_price)}</span>
            <span class="${pnlCls(p.floating_pnl)}">${fmt(p.floating_pnl)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:6px">
            <span>SL ${fmtPrice5(p.stop_loss)}${p.take_profit ? ' / TP ' + fmtPrice5(p.take_profit) : ''}</span>
            <button class="btn btn-ghost btn-sm" onclick="closeBtPosition(${p.id})">Close</button>
        </div>`).join('');
}
function renderPendingOrders(orders) {
    const el = document.getElementById('bt-pending-orders');
    if (!orders.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px">None</div>'; return; }
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
    const res = await api('backtest_advance', 'POST', { session_id: btActiveSessionId, jump_to_latest: !!jumpToLatest });
    if (!res || res.error) { toast(res ? res.error : 'Advance failed', 'error'); stopBtAutoplay(); return; }

    (res.events || []).forEach(ev => {
        const label = { limit_filled: 'Limit order filled', stop_loss: 'Stop loss hit', take_profit: 'Take profit hit' }[ev.type] || ev.type;
        toast(`${label} @ ${fmtPrice5(ev.price)}`);
    });

    btSession = res.session;
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
    document.getElementById('bt-dir-long').style.background = dir === 'Long' ? 'var(--green)' : 'var(--bg3)';
    document.getElementById('bt-dir-long').style.color = dir === 'Long' ? '#fff' : 'var(--text2)';
    document.getElementById('bt-dir-short').style.background = dir === 'Short' ? 'var(--red)' : 'var(--bg3)';
    document.getElementById('bt-dir-short').style.color = dir === 'Short' ? '#fff' : 'var(--text2)';
}
document.addEventListener('DOMContentLoaded', () => {
    const typeSel = document.getElementById('bt-order-type');
    typeSel?.addEventListener('change', () => {
        document.getElementById('bt-limit-price-group').style.display = typeSel.value === 'limit' ? 'flex' : 'none';
    });
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
    const res = await api('backtest_place_order', 'POST', payload);
    if (res && res.error) { errEl.textContent = res.error; return; }
    toast(res.filled ? `Filled @ ${fmtPrice5(res.entry_price)}` : 'Limit order placed');
    await refreshBtSession();
}
async function cancelBtOrder(orderId) {
    const res = await api('backtest_cancel_order', 'POST', { order_id: orderId });
    if (res && res.error) { toast(res.error, 'error'); return; }
    await refreshBtSession();
}
async function closeBtPosition(tradeId) {
    const res = await api('backtest_close_position', 'POST', { trade_id: tradeId });
    if (res && res.error) { toast(res.error, 'error'); return; }
    toast('Position closed');
    await refreshBtSession();
}
