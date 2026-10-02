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
 *  showPage('backtest') with NO session id, which calls this. Per that release's own
 *  requirement, the sidebar's Backtesting link always opens the New Backtest form.
 *
 *  v3.20.11: `sessionId`, when given, opens straight to that session instead -- this is
 *  what restoring a #backtest:<id> URL hash on page load/refresh uses (see
 *  js/app.js::_restoreFromHash()), and what openBacktestFromList() (Saved Backtests)
 *  now uses too, via showPage('backtest', id) instead of its own separate two-call
 *  sequence. Both are still deliberate, explicit resumes (a real URL the user landed on,
 *  or a real click on a specific saved session) -- the sidebar link itself never passes
 *  an id, so clicking it plainly still always shows the form, unchanged from v3.20.5. */
async function loadBacktest(sessionId) {
    if (sessionId) { openBacktestSession(parseInt(sessionId, 10)); return; }
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

    // v3.20.11 — drop the session id from the URL hash the moment there's no longer a
    // specific session open, so a refresh at this point lands back on the plain form
    // instead of trying to reopen whatever was last viewed (which may have just failed
    // to load, or been abandoned deliberately).
    if (screen === 'form' && typeof _setUrlHash === 'function') _setUrlHash('backtest', null);

    if (screen === 'form') {
        stopBtAutoplay(); btActiveSessionId = null; populateBtSetupForm();
        // v3.21.0 — leaving a session's replay window: drop its drawing-tool state so
        // the next session opened doesn't inherit a still-selected tool or selection.
        // The drawings array itself is fully replaced by loadBtDrawings() on the next
        // open anyway, but the active tool/selection are separate, longer-lived state.
        if (typeof btActiveTool !== 'undefined') {
            btActiveTool = null; btDrawInProgress = null; btSelectedDrawingId = null; btDragState = null;
            if (typeof setBtActiveToolButton === 'function') setBtActiveToolButton();
            if (typeof btHideDrawSettingsPopover === 'function') btHideDrawSettingsPopover();
        }
    }
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
// escapeHtml() moved to js/app.js (v3.22.3) -- was independently duplicated here and in
// js/report-card.js (whose own regex-based version, the more complete of the two, was
// the only one ever actually running for either file -- see app.js's own comment).

// ── SETUP FORM (Screen A) ────────────────────────────────
// v3.22.0 — risk ladder default, mirroring BacktestController::DEFAULT_RISK_LADDER
// (PHP) exactly: >=95% starting balance -> 1.0% risk, 92.5-95% -> 0.5%, <92.5% -> 0.25%.
// Percentages of THIS SESSION's own starting_balance, not absolute dollars -- see the
// 2026_09_30_0001 migration's own doc comment for why a %-based ladder is the only
// representation that stays meaningful across sessions with different starting balances.
const BT_DEFAULT_RISK_LADDER = [
    { lower_pct: 0,    upper_pct: 92.5, risk_pct: 0.25 },
    { lower_pct: 92.5, upper_pct: 95,   risk_pct: 0.5 },
    { lower_pct: 95,   upper_pct: null, risk_pct: 1.0 },
];
// Mirrors BacktestController::ALLOWED_LEVERAGES (PHP) exactly — the setup form's
// leverage <select> options and the order ticket's own dropdown (v3.22.1) are both
// built from this same list.
const BT_ALLOWED_LEVERAGES = [1, 2, 3, 5, 10, 20];
/** Renders exactly 3 editable rows -- the ladder is always exactly 3 tiers, matching the
 *  server's own validateRiskLadder() (BacktestController.php), which rejects anything
 *  else and falls back to the coded default. The last row's Upper input is always
 *  disabled/blank ("and above") -- the top tier never has an upper bound, structurally,
 *  not just by convention. */
function btRenderLadderRows(tiers) {
    const wrap = document.getElementById('bt-setup-ladder-rows');
    wrap.innerHTML = tiers.map((t, i) => {
        const isLast = i === tiers.length - 1;
        return `<div class="form-grid-2" data-ladder-row="${i}" style="margin-bottom:6px;gap:8px;grid-template-columns:1fr 1fr 1fr">
            <input type="number" class="bt-ladder-lower" value="${t.lower_pct}" step="0.1" min="0" max="100" title="Lower bound (% of starting balance)">
            <input type="number" class="bt-ladder-upper" value="${t.upper_pct === null || t.upper_pct === undefined ? '' : t.upper_pct}" step="0.1" min="0" max="100" placeholder="and above" ${isLast ? 'disabled' : ''} title="Upper bound, blank/disabled = and above">
            <input type="number" class="bt-ladder-risk" value="${t.risk_pct}" step="0.01" min="0.01" max="100" title="Risk % at this tier">
        </div>`;
    }).join('');
}
/** Reads whatever is currently in the 3 rows back into the same {lower_pct, upper_pct,
 *  risk_pct} shape btRenderLadderRows() renders from — the last row's upper_pct is
 *  always sent as null regardless of its (disabled) input value, matching the render
 *  side exactly. */
function btReadLadderRows() {
    const rows = Array.from(document.querySelectorAll('#bt-setup-ladder-rows [data-ladder-row]'));
    return rows.map((row, i) => {
        const isLast = i === rows.length - 1;
        const upperRaw = row.querySelector('.bt-ladder-upper').value;
        return {
            lower_pct: parseFloat(row.querySelector('.bt-ladder-lower').value),
            upper_pct: (isLast || upperRaw === '') ? null : parseFloat(upperRaw),
            risk_pct: parseFloat(row.querySelector('.bt-ladder-risk').value),
        };
    });
}
/** Flat risk % and the tiered ladder are mutually exclusive DISPLAYS, not mutually
 *  exclusive DATA — both stay in the DOM (never removed/disabled) so toggling back and
 *  forth doesn't lose whatever the trader already typed into either one. createBacktest
 *  Session() always reads and sends both; the server decides which one is actually
 *  authoritative from use_flat_risk. Unchecked (the HTML default) means the ladder is
 *  active for a brand-new session -- per the briefing, the ladder is the new default
 *  behavior, flat is the explicit opt-back-to-old-behavior toggle. */
function onBtFlatRiskToggle() {
    const flat = document.getElementById('bt-setup-flat-risk').checked;
    document.getElementById('bt-setup-flat-risk-row').style.display = flat ? '' : 'none';
    document.getElementById('bt-setup-ladder-wrap').style.display = flat ? 'none' : '';
}
/** Converts the selected challenge's OWN live risk_ladder_tiers (absolute dollar
 *  bounds, get_risk_status's own ladder_tiers field) into % of that same challenge's
 *  starting_balance, then renders them into the 3 ladder rows -- same conversion
 *  principle onBtPrefillChange() already uses for daily_loss_limit -> daily_drawdown_pct
 *  a few lines below. Every field stays editable afterward, same as every other prefill
 *  in this form. get_risk_status accepts challenge_id directly (CalculatorController::
 *  getRiskStatus()) -- no new backend endpoint was needed for this. */
async function onBtLadderPrefill() {
    const raw = document.getElementById('bt-setup-prefill').value;
    if (!raw) return;
    let ch; try { ch = JSON.parse(raw); } catch (e) { return; }
    if (!ch.id || !ch.starting_balance) return;
    const res = await btApi(`get_risk_status&challenge_id=${ch.id}`);
    if (res && res.error) { toast('Could not load that challenge\'s risk ladder — ' + res.error, 'error'); return; }
    const liveTiers = Array.isArray(res.ladder_tiers) ? res.ladder_tiers : [];
    if (!liveTiers.length) { toast('That challenge has no risk ladder configured.', 'error'); return; }
    const converted = liveTiers.map(t => ({
        lower_pct: +(t.lower_balance / ch.starting_balance * 100).toFixed(2),
        upper_pct: t.upper_balance !== null ? +(t.upper_balance / ch.starting_balance * 100).toFixed(2) : null,
        risk_pct: t.risk_pct,
    }));
    // The server's own validateRiskLadder() requires exactly 3 tiers or it silently
    // falls back to the coded default -- a live challenge's ladder could in principle
    // have a different count (risk_ladder_tiers has no such constraint), so this is
    // checked here, with a clear message, rather than letting a real prefill silently
    // turn into the coded default with no explanation.
    if (converted.length !== 3) { toast(`That challenge's ladder has ${converted.length} tiers — this form needs exactly 3. Not prefilled.`, 'error'); return; }
    btRenderLadderRows(converted);
    toast('Ladder prefilled from ' + ch.name);
}

async function populateBtSetupForm() {
    document.getElementById('bt-setup-error').textContent = '';
    btRenderLadderRows(BT_DEFAULT_RISK_LADDER);
    onBtFlatRiskToggle(); // sets initial flat-row/ladder-wrap visibility to match the checkbox's own (unchecked -> ladder) default state
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
    // v3.22.0 — the ladder's own "Prefill from challenge" button (a separate action,
    // since a challenge's ladder is fetched via its own API call rather than already
    // being embedded in this dropdown's JSON like the other fields below) only makes
    // sense once a real challenge is selected -- kept in sync with this dropdown on
    // every change, including back to "— Custom —", so it can't stay stuck enabled
    // after the selection is cleared.
    document.getElementById('bt-setup-ladder-prefill-btn').disabled = !raw;
    if (!raw) return;
    let ch; try { ch = JSON.parse(raw); } catch (e) { return; }
    if (ch.starting_balance) document.getElementById('bt-setup-balance').value = ch.starting_balance;
    if (ch.profit_target_pct) document.getElementById('bt-setup-target').value = ch.profit_target_pct;
    if (ch.daily_loss_limit && ch.starting_balance) document.getElementById('bt-setup-daily-dd').value = (ch.daily_loss_limit / ch.starting_balance * 100).toFixed(2);
    if (ch.max_drawdown_pct) document.getElementById('bt-setup-max-dd').value = ch.max_drawdown_pct;
    if (ch.drawdown_type) document.getElementById('bt-setup-dd-type').value = ch.drawdown_type;
    // v3.22.0 — only applied when the challenge's own default_leverage is both set and
    // one of the six values this form's dropdown actually offers; BT_ALLOWED_LEVERAGES
    // mirrors BacktestController::ALLOWED_LEVERAGES (PHP) exactly.
    if (ch.default_leverage && BT_ALLOWED_LEVERAGES.includes(Math.round(ch.default_leverage))) {
        document.getElementById('bt-setup-leverage').value = String(Math.round(ch.default_leverage));
    }
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
        // v3.22.0 — both the flat risk_pct above and the tiered risk_ladder below are
        // always sent together, regardless of which one is currently displayed
        // (onBtFlatRiskToggle() only hides the other, never removes/disables it) — the
        // server decides which is authoritative from use_flat_risk, so switching the
        // toggle back and forth in this form before submitting never loses either value.
        default_leverage: document.getElementById('bt-setup-leverage').value,
        use_flat_risk: document.getElementById('bt-setup-flat-risk').checked,
        risk_ladder: btReadLadderRows(),
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
    // v3.20.11 — set optimistically; if the session turns out not to load,
    // refreshBtSession()'s failure path calls showBacktestScreen('form'), which itself
    // resets the hash back to the plain '#backtest' -- so this self-corrects either way.
    if (typeof _setUrlHash === 'function') _setUrlHash('backtest', id);
    // Reset for this session -- refreshBtSession() sets it to the session's own
    // replay_timeframe once it knows what that is. Also drops any stable price range
    // left over from whatever was viewed before, so a freshly opened/resumed session
    // starts from a clean natural fit rather than inheriting an unrelated one.
    btDisplayTimeframe = null;
    btResetPriceRangeStabilizer();
    showBacktestScreen('window');

    if (typeof initTvChart === 'function') initTvChart();
    btInstallPriceRangeStabilizer();
    if (typeof btInitDrawOverlay === 'function') btInitDrawOverlay();
    window.btFetchCandlesOverride = (symbol, timeframe, before, limit) => btFetchCandles(before, limit);

    const ok = await refreshBtSession();
    if (!ok) return;
    await btLoadCandleWindow();
    if (typeof resizeTvChart === 'function') resizeTvChart();
    // v3.21.0 — drawings are scoped per session; load them once the session itself is
    // confirmed to exist (refreshBtSession() already returned true above).
    // v3.21.12 — this user's saved per-tool drawing defaults are user-scoped, not
    // session-scoped, but are (re)loaded here too, once per session open, so a default
    // saved or reset from a settings panel takes effect on the very next session opened
    // rather than requiring a page reload.
    if (typeof loadBtDrawingDefaults === 'function') await loadBtDrawingDefaults();
    if (typeof loadBtDrawings === 'function') await loadBtDrawings();
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
    // v3.21.0 — drawings are anchored to real time+price, not pixels or a bar's logical
    // index into this array, so a full replace of chartState.candles (which is exactly
    // what just happened) doesn't itself invalidate anything -- this just repaints them
    // at their current, correctly-recomputed screen positions against the new window.
    if (typeof btScheduleRedraw === 'function') btScheduleRedraw();
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
    setBtStepLabel();
    btResetPriceRangeStabilizer();
    await btLoadCandleWindow();
    if (typeof resizeTvChart === 'function') resizeTvChart();
}
function setActiveBtDisplayTfButton() {
    document.querySelectorAll('.bt-display-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === btDisplayTimeframe));
}
/**
 * v3.20.11 — client-side mirror of BacktestController::resolveStepTimeframe(): the step
 * size is the FINER of (viewed timeframe, session's own replay timeframe). Purely for
 * the visible "Step: X" label ("the user always knows what one click does") -- the
 * server always computes its own copy independently from the same two inputs sent on
 * every advance/rewind call and is the only one that actually enforces it.
 * backtestStepMsFor() is chart.js's own existing helper, loaded before this file.
 */
function setBtStepLabel() {
    const el = document.getElementById('bt-step-label');
    if (!el || !btSession) return;
    const replayTf = btSession.replay_timeframe;
    const viewTf = btDisplayTimeframe || replayTf;
    const stepTf = backtestStepMsFor(viewTf) < backtestStepMsFor(replayTf) ? viewTf : replayTf;
    el.textContent = `Step: ${stepTf}`;
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
    renderBtOpenPositions(s.open_positions || []);
    renderPendingOrders(s.pending_orders || []);
    renderBtOutcome(s);
    renderBtHeaderStrip(s);
    btUpdateNewTradeCapUI();
    document.getElementById('bt-replay-status').textContent = s.status === 'active' ? '' : `Session ${s.status}`;
    if (typeof btScheduleRedraw === 'function') btScheduleRedraw(); // v3.22.3 Part C -- pending/open lines come from btSession, not the ticket
    return true;
}

/** Shared by refreshBtSession(), btAdvance() and btRewind() -- three separate call sites
 *  as of v3.20.10, all needing the exact same header fields kept in sync. */
function renderBtHeader(s) {
    document.getElementById('bt-window-name').textContent = s.session_name || '(untitled)';
    document.getElementById('bt-replay-symbol').textContent = s.blind_mode ? '🙈 Blind Mode' : `${s.symbol} · ${s.replay_timeframe}`;
    document.getElementById('bt-replay-clock-tf').textContent = s.replay_timeframe;
    document.getElementById('bt-cursor-time').textContent = fmtCursorTime(s.replay_cursor_ms);
    setBtStepLabel();
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

/** v3.22.3 Part C — the controls-bar header strip, always visible on the replay screen
 *  (unlike the sidebar's Challenge panel, which a trader could in principle scroll past).
 *  Same three sessionSummary() fields the sidebar panel already reads -- never a second
 *  computation of any of them. */
function renderBtHeaderStrip(s) {
    const eqEl = document.getElementById('bt-strip-equity');
    if (!eqEl) return; // not on this screen yet (e.g. called before showBacktestScreen('window'))
    eqEl.textContent = fmt(s.equity);
    document.getElementById('bt-strip-target').textContent = `${s.progress_to_target_pct ?? '—'}% / ${s.profit_target_pct}%`;
    document.getElementById('bt-strip-loss').textContent = `${s.max_drawdown_used_pct ?? 0}% / ${s.max_drawdown_pct}%`;
}

/** v3.22.3 Fix C — "the sidebar New Trade button and the toolbar Place trade button are
 *  disabled... The ticket can still open from a position tool for planning": the sidebar
 *  button is this release's main one-click entry point and is fully disabled (with the
 *  cap reason as its own label) once the cap is hit -- there's nothing to plan from a
 *  blank ticket a session-level gate already refuses to submit. The toolbar's own "Place
 *  trade" (opened from an already-drawn position tool, i.e. a plan the trader already
 *  built) stays clickable per that explicit carve-out -- it only gets a tooltip here;
 *  disabling the ticket's actual submit button once it's open is btComputeTicket()'s own
 *  capReached/capReason (shown as a banner at the TOP of the ticket, not buried at the
 *  bottom with every other reason, per this same fix). Called from every place btSession
 *  changes (js/backtest-drawings.js's btPositionSelectionToolbar() reads the same two
 *  fields directly when it (re)builds the toolbar, so a selection made after the cap was
 *  already reached starts correctly labelled without this function needing to reach into
 *  that file's own DOM). */
function btUpdateNewTradeCapUI() {
    if (!btSession) return;
    const capped = !!(btSession.max_trades_per_day && btSession.trades_today >= btSession.max_trades_per_day);
    const btn = document.getElementById('bt-new-trade-btn');
    if (btn) {
        btn.disabled = capped;
        btn.textContent = capped ? `Daily cap reached (${btSession.trades_today}/${btSession.max_trades_per_day}): advance to the next day` : 'New Trade';
    }
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

// v3.22.3 Fix D (re-opened) — RENAMED from renderOpenPositions(), found while verifying
// Fix D in the browser harness, not by inspection: js/calculator.js ALSO declares a
// global function named renderOpenPositions(positions) (a completely different feature
// -- the Auto Risk Calculator's own open-margin-positions list, targeting
// #calc-open-positions). Both files load as plain global <script> tags in the SAME
// scope, and calculator.js loads AFTER this file in index.php's own module list -- a
// later plain `function` declaration in the same global scope silently REPLACES an
// earlier one of the same name, with no error, no warning. The practical effect: every
// call to renderOpenPositions() anywhere in this app -- including every one of THIS
// file's own three call sites -- was actually running calculator.js's version, which
// writes into a DIFFERENT element and never touches #bt-open-positions at all. That left
// this panel's own original static "None" markup (pages/backtest.php) on screen FOREVER,
// regardless of what open_positions data the server returned -- compounding, and
// possibly the dominant cause of, the exact "Open Positions says None" symptom Fix D's
// own investigation (the advance()-no-bar-branch missing key, and the null-markBar fee-
// only floating figure) was chasing. Renamed instead of touching calculator.js, which
// has every right to its own name for its own unrelated feature -- this file was the one
// with an avoidable collision (every other render function in this file is already
// prefixed renderBt*; this one, alone, wasn't).
//
// v3.22.3 Fix A — every text node in these two rows now also has an EXPLICIT dark-theme
// colour (#d1d4dc primary, #8b93a7 muted), not one inherited from a parent class/style.
// The live report: the Pending Orders row showed only its "Cancel" button -- the <span>
// next to it had no colour of its own at all, so it fell through to this light-themed
// app's own default body text colour, unreadable against the dark sidebar panel
// (.bt-side-panel). This function's own spans happened to inherit a correct colour from
// their parent elements (.bt-panel-row's own CSS, and the second row's own inline
// color:#8b93a7) and were never actually broken on screen for THAT reason -- made
// explicit here anyway, per the fix's own instruction, so neither row's readability
// depends on a parent element keeping a color rule it doesn't visibly need for itself.
function renderBtOpenPositions(positions) {
    const el = document.getElementById('bt-open-positions');
    if (!positions.length) { el.innerHTML = '<div style="color:#6b7280;font-size:12px">None</div>'; return; }
    el.innerHTML = positions.map(p => `
        <div class="bt-panel-row" style="border-bottom:1px solid #232733;padding-bottom:6px;margin-bottom:6px">
            <span style="color:#d1d4dc">${p.direction} @ ${fmtPrice5(p.entry_price)}</span>
            <span class="${pnlCls(p.floating_pnl)}">${fmt(p.floating_pnl)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#8b93a7;margin-bottom:6px">
            <span style="color:#8b93a7">SL ${fmtPrice5(p.stop_loss)}${p.take_profit ? ' / TP ' + fmtPrice5(p.take_profit) : ''}</span>
            <button class="btn btn-ghost btn-sm" onclick="closeBtPosition(${p.id})">Close</button>
        </div>`).join('');
}
function renderPendingOrders(orders) {
    const el = document.getElementById('bt-pending-orders');
    if (!orders.length) { el.innerHTML = '<div style="color:#6b7280;font-size:12px">None</div>'; return; }
    el.innerHTML = orders.map(o => `
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;color:#d1d4dc">
            <span style="color:#d1d4dc">${o.direction} limit @ ${fmtPrice5(o.limit_price)}</span>
            <button class="btn btn-ghost btn-sm" onclick="cancelBtOrder(${o.id})">Cancel</button>
        </div>`).join('');
}
function fmtPrice5(v) { const n = parseFloat(v); return isNaN(n) ? '—' : n.toFixed(Math.abs(n) >= 100 ? 2 : (Math.abs(n) >= 1 ? 4 : 6)); }
/** v3.22.3 Fix B — the NUMBER counterpart to fmtPrice5() above (same bucketed decimal
 *  rule: >=100 -> 2dp, >=1 -> 4dp, else 6dp), for the two places a rounded STRING isn't
 *  enough: the ticket's own number inputs (value=...) and the submitted payload, both of
 *  which need a real rounded number, not display text. Mirrors
 *  backtest_engine.php::backtestRoundPrice() exactly -- kept as two copies, not one
 *  network round trip, same "duplicate the pure math for live, no-round-trip preview"
 *  convention every other engine function in this file already follows. btTicket's own
 *  stored entry/stopLoss/takeProfit are NEVER rounded through this -- only a rendered
 *  input value or the final payload is, so RR/sizing math upstream of either still runs
 *  against full precision. */
function btRoundPrice(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return n;
    const decimals = Math.abs(n) >= 100 ? 2 : (Math.abs(n) >= 1 ? 4 : 6);
    return parseFloat(n.toFixed(decimals));
}

// ── ADVANCE ──────────────────────────────────────────────
/**
 * v3.20.11 — "Jump to Latest" is gone; this is Next Bar only now, always exactly one
 * adaptive step. Sends display_timeframe on every call so the server's own
 * resolveStepTimeframe() (BacktestController.php) agrees with whatever
 * setBtStepLabel()/the client independently computed for display — same formula, same
 * inputs, on both sides.
 */
async function btAdvance() {
    if (!btActiveSessionId || !btSession || btSession.status !== 'active') return;
    const res = await btApi('backtest_advance', 'POST', { session_id: btActiveSessionId, display_timeframe: btDisplayTimeframe });
    if (!res || res.error) { toast('Advance failed — ' + (res ? res.error : 'unknown error'), 'error'); stopBtAutoplay(); return; }

    // v3.22.3 Part C — a stop_loss/take_profit event is a CLOSE: "Trade closed:
    // {+/-$} ({R})", per the briefing, using the exact net_pnl/r_multiple settleTrade()
    // itself just computed (BacktestController::evaluateBar()'s own event payload), not
    // a client-side re-derivation. A limit fill isn't a close, so it keeps its own
    // simpler "filled @ price" wording.
    (res.events || []).forEach(ev => {
        if (ev.type === 'stop_loss' || ev.type === 'take_profit') {
            const rTxt = ev.r_multiple !== null && ev.r_multiple !== undefined ? ` (${ev.r_multiple >= 0 ? '+' : ''}${ev.r_multiple.toFixed(2)}R)` : '';
            toast(`Trade closed: ${fmt(ev.net_pnl)}${rTxt}`, ev.net_pnl >= 0 ? 'success' : 'error');
        } else if (ev.type === 'limit_filled') {
            toast(`${ev.direction} ${ev.lot_size.toFixed(4)} ${btBaseAsset(btSession.symbol)} filled @ ${fmtPrice5(ev.price)}`);
            // v3.22.3 Part C — a drawing linked to this pending order (linked_order_id)
            // now has a real trade instead: flip the link over so btDrawLiveTrades()
            // keeps suppressing this drawing's own box under the open-position lines,
            // not back under the (now filled, no longer pending) order's old lines.
            const linkedDrawing = typeof btDrawings !== 'undefined' ? btDrawings.find(d => d.linked_order_id === ev.order_id) : null;
            if (linkedDrawing) btLinkDrawingToOrder(linkedDrawing.id, { trade_id: ev.trade_id });
        }
    });

    btSession = res.session;
    btSession.open_positions = res.open_positions || [];
    btSession.pending_orders = res.pending_orders || [];
    btSession.closed_trades = res.closed_trades || [];
    renderBtHeader(btSession);
    renderChallengePanel(btSession);
    renderBtOpenPositions(btSession.open_positions);
    renderPendingOrders(btSession.pending_orders);
    renderBtOutcome(btSession);
    renderBtHeaderStrip(btSession);
    btUpdateNewTradeCapUI();
    if (btSession.status !== 'active') { stopBtAutoplay(); document.getElementById('bt-replay-status').textContent = `Session ${btSession.status}`; }

    await btLoadCandleWindow(); // already schedules its own redraw
}

/**
 * v3.20.10 — Prev Bar. Two-phase confirm: the first call (no {confirmed:true}) only ever
 * COUNTS what would be undone server-side and reports it back without writing anything;
 * a step that would undo one or more trades shows a confirm() naming exactly how many
 * before re-calling with confirmed:true. A step into empty history that undoes nothing
 * never prompts. btLoadCandleWindow() re-fetches the window from scratch afterward, which
 * naturally trims any candle after the new (earlier) cursor with no extra client-side
 * logic needed -- the same no-lookahead clamp every other load already goes through.
 * v3.20.11: also sends display_timeframe, so a rewind steps back by the same adaptive
 * amount Next Bar would have stepped forward by.
 */
async function btRewind() {
    if (!btActiveSessionId || !btSession || btSession.status !== 'active') return;
    let res = await btApi('backtest_rewind', 'POST', { session_id: btActiveSessionId, display_timeframe: btDisplayTimeframe });
    if (res && res.error) { toast('Rewind failed — ' + res.error, 'error'); return; }
    if (res && res.confirm_required) {
        const n = res.trades_affected;
        const proceed = confirm(`Stepping back will undo ${n} trade${n === 1 ? '' : 's'} -- ${n === 1 ? 'its outcome' : 'their outcomes'} will be removed from equity and stats (kept in the log, flagged as rewound). Continue?`);
        if (!proceed) return;
        res = await btApi('backtest_rewind', 'POST', { session_id: btActiveSessionId, display_timeframe: btDisplayTimeframe, confirmed: true });
        if (res && res.error) { toast('Rewind failed — ' + res.error, 'error'); return; }
    }
    if (!res || !res.success) return;
    if (res.trades_rewound > 0) toast(`Rewound — ${res.trades_rewound} trade${res.trades_rewound === 1 ? '' : 's'} undone`);

    btSession = res.session;
    btSession.open_positions = res.open_positions || [];
    btSession.pending_orders = res.pending_orders || [];
    btSession.closed_trades = res.closed_trades || [];
    renderBtHeader(btSession);
    renderChallengePanel(btSession);
    renderBtOpenPositions(btSession.open_positions);
    renderPendingOrders(btSession.pending_orders);
    renderBtOutcome(btSession);
    renderBtHeaderStrip(btSession);
    btUpdateNewTradeCapUI();
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
        btAdvance();
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
    setBtDirection('Long');
});

/** v3.22.2 Fix 2 — the sidebar's "New Trade" button ALWAYS opens the ticket now (it used
 *  to refuse with "Stop loss is required." when its own now-removed SL field was empty,
 *  which read as the ticket itself being broken). All validation lives in the ticket's
 *  own disabled-button reason (btComputeTicket()'s blockReason) -- this function does
 *  none itself beyond "is there a session."
 *
 *  Prefill priority, per the briefing:
 *   1. the selected position tool (btSelectedDrawingId, from js/backtest-drawings.js)
 *   2. otherwise the most recent position-tool drawing in this session with no trade
 *      linked yet (d._linkedTrade -- always unset in this release, since linking a
 *      drawing to a live trade is v3.22.3's linked_trade_id; checked anyway so this
 *      still does the right thing once that ships without touching this function again)
 *   3. otherwise a bare Market ticket at the current close, direction from the sidebar's
 *      own Long/Short toggle, SL left empty for the trader to fill in on the ticket. */
function btNewTradeClick() {
    if (!btSession || btSession.status !== 'active') { toast('Session is not active.', 'error'); return; }
    const isPositionTool = d => d.tool === 'position_long' || d.tool === 'position_short';
    let source = btSelectedDrawingId ? btDrawings.find(d => d.id === btSelectedDrawingId && isPositionTool(d)) : null;
    if (!source) {
        const candidates = btDrawings.filter(d => isPositionTool(d) && !d._linkedTrade);
        source = candidates.length ? candidates[candidates.length - 1] : null;
    }
    if (source) {
        btOpenTicketFromDrawing(source);
    } else {
        btOpenTicket({ sourceDrawingId: null, direction: btDirection, orderType: 'market', stopLoss: 0 });
    }
}

// ── ORDER TICKET (v3.22.1) ──────────────────────────────────
// Replaces the old one-click "Place Long/Short" submit. Opened either from a position
// tool's own floating toolbar (js/backtest-drawings.js::btOpenTicketFromDrawing(), which
// calls btOpenTicket() below with sourceDrawingId set) or from the sidebar's "New Trade"
// button (btNewTradeClick() above, sourceDrawingId null unless a drawing was prefilled
// from). Nothing is sent to the server until
// the trader clicks Place Trade — every field here is local state until then.
//
// Single source of truth: btTicket itself. Both the panel's own number inputs AND the
// on-chart entry/stop/TP lines (js/backtest-drawings.js's own rendering) are pure,
// derived views of this one object — typing in the panel or dragging a line both just
// mutate btTicket and call btRenderTicket(), which re-renders both. No separate
// "sync" step and no feedback-loop risk, the same single-state-object pattern
// btDrawings/d.settings already uses throughout the drawing-tools file.
let btTicket = null; // null = closed

// Mirrors backtest_engine.php's pure functions exactly (same formulas, same names minus
// the bt-engine prefix collision) — duplicated deliberately, not shared over a network
// round trip, matching how btComputeTpFromRatio()/btApplyDrag() in backtest-drawings.js
// already duplicate server-side math for live, no-round-trip preview. BacktestController
// ::checkMarginAndLiquidation()/fillPosition() remain the actual source of truth at
// submit time — this is preview-only.
function btCalcPositionSize(equity, riskPct, entry, stop) {
    const dist = Math.abs(entry - stop);
    return dist > 0 ? (equity * riskPct / 100) / dist : 0;
}
function btCalcFee(lotSize, price, feeRatePct) { return lotSize * price * feeRatePct / 100; }
function btCalcMarginRequired(notional, leverage) { return leverage > 0 ? notional / leverage : notional; }
function btCalcLiquidationPrice(direction, entry, leverage) {
    if (leverage <= 0) return direction === 'Long' ? 0 : Infinity;
    const frac = 1 / leverage;
    return direction === 'Long' ? entry * (1 - frac) : entry * (1 + frac);
}
function btCalcLiquidationBeforeStop(direction, liqPrice, stop) {
    return direction === 'Long' ? liqPrice > stop : liqPrice < stop;
}
/** Mirrors helpers.php::ladderTierForBalance() — lower-inclusive, upper-exclusive, a
 *  null upper_pct means "and above." Operates on % of starting balance (the session's
 *  own risk_ladder shape, v3.22.0), not absolute dollars. Returns null if no tier
 *  matches (shouldn't happen with a well-formed 3-tier ladder covering 0-100+, but this
 *  is preview-only math, not something to let throw). */
function btLadderTierForEquityPct(session, equityPct) {
    const tiers = Array.isArray(session.risk_ladder) ? session.risk_ladder : [];
    for (const t of tiers) {
        if (equityPct >= t.lower_pct && (t.upper_pct === null || t.upper_pct === undefined || equityPct < t.upper_pct)) return t;
    }
    return null;
}

/** sourceDrawingId: the backtest_drawings.id this ticket was opened from (position tool
 *  "Place trade"), or null when opened from the sidebar panel. init: {direction,
 *  orderType, entry, stopLoss, takeProfit} — entry is only meaningful for orderType
 *  'limit'; a 'market' ticket always recomputes entry from the current bar's close on
 *  every render (see btComputeTicket()), matching "switching to Market sets entry to
 *  the current price" from the briefing. */
function btOpenTicket(init) {
    if (!btSession) return;
    const lastCandle = chartState.candles[chartState.candles.length - 1];
    const closePrice = lastCandle ? lastCandle.close : (init.entry || 0);
    // Default: Limit if the tool's/panel's own entry is more than 0.05% from the
    // current close, otherwise Market -- per the briefing. init.orderType, when given
    // explicitly (the sidebar panel always sends one), overrides this default.
    let orderType = init.orderType;
    if (!orderType) {
        const refEntry = init.entry || closePrice;
        const pctFromClose = closePrice > 0 ? Math.abs(refEntry - closePrice) / closePrice * 100 : 0;
        orderType = pctFromClose > 0.05 ? 'limit' : 'market';
    }
    btTicket = {
        sourceDrawingId: init.sourceDrawingId || null,
        direction: init.direction === 'Short' ? 'Short' : 'Long',
        orderType,
        // For a fresh Limit ticket with no real entry yet, default to the last close --
        // the trader adjusts from there (per the hint text "Drag the orange entry line
        // to set your price").
        entry: (init.entry && init.entry > 0) ? init.entry : closePrice,
        stopLoss: init.stopLoss || 0,
        takeProfit: (init.takeProfit !== undefined && init.takeProfit !== null) ? init.takeProfit : null,
        keep3R: true,
        riskMode: '%',
        // Prefilled from the session's flat risk_pct always, per the briefing ("Until
        // [v3.22.2] lands, use flat risk") -- the ladder tier is looked up separately,
        // for the off-ladder comparison only, not as the prefilled value.
        riskValue: btSession.risk_pct,
        leverage: btSession.default_leverage,
    };
    btTicketApplyKeep3R(); // ticket-open is one of the five Keep-3R recompute paths (v3.22.2 Fix 1)
    btRenderTicket();
}
function btCloseTicket() {
    btTicket = null;
    const el = document.getElementById('bt-ticket');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    if (typeof btScheduleRedraw === 'function') btScheduleRedraw(); // clears the on-chart ticket lines, drawn only while btTicket is truthy
}
/** v3.22.2 — the ONE place "what is entry, right now" is computed for the ticket's own
 *  interaction code (as opposed to btComputeTicket()'s own local copy of the same
 *  formula, kept separate since that function already had its own well-tested shape
 *  before this fix and touching it wasn't necessary to fix the bug). For a Limit
 *  ticket, entry is whatever was typed/dragged. For Market, it's ALWAYS the live
 *  close, never the possibly-stale btTicket.entry a previous orderType switch happened
 *  to snapshot — this is the root cause Fix 1 exists for: switching to Market copied
 *  the close into btTicket.entry ONCE, at switch time, and every recompute after that
 *  (including Keep 3R) kept reading that now-stale snapshot instead of the live price. */
function btTicketEffectiveEntry() {
    if (!btTicket) return 0;
    if (btTicket.orderType !== 'market') return btTicket.entry;
    const lastCandle = chartState.candles[chartState.candles.length - 1];
    return lastCandle ? lastCandle.close : btTicket.entry;
}
/** v3.22.2 Fix 1 — the ONE place TP is recomputed from the 3R ratio. Called from every
 *  path that can change the effective entry, the stop, or the direction while Keep 3R
 *  is checked: opening the ticket, switching orderType (Limit<->Market — the bug this
 *  fix exists for: switching to Market moved the effective entry but nothing recomputed
 *  TP against it, so a 3R take-profit silently stopped being 3R), switching direction,
 *  and every stop-loss change whether typed or dragged. Does nothing when Keep 3R is
 *  off or there's no take-profit to keep at all — checked once, here, rather than
 *  duplicated at every call site (the whole point of this fix: one function, called from
 *  everywhere, not five copies of the same recompute that can individually go stale). */
function btTicketApplyKeep3R() {
    if (!btTicket || !btTicket.keep3R || btTicket.takeProfit === null) return;
    const entry = btTicketEffectiveEntry();
    btTicket.takeProfit = btComputeTpFromRatio(btTicket.direction === 'Long' ? 'position_long' : 'position_short', entry, btTicket.stopLoss, 3);
}
/** Two-way sync entry point for a ticket-line drag (js/backtest-drawings.js). field is
 *  'entry'|'stopLoss'|'takeProfit'. Applies the exact same v3.21.13 side-clamp/mirror
 *  rules a position-tool drawing's own handles already use, via the shared
 *  btPositionMinDist()/btClampPositionSide() helpers — a ticket's stop/TP can no more
 *  cross entry than a drawing's can. Clamps against btTicketEffectiveEntry(), not
 *  btTicket.entry directly, so a stop/TP drag on a MARKET ticket clamps against the
 *  live price, not a stale snapshot — same v3.22.2 fix as btTicketApplyKeep3R() above. */
function btTicketSetField(field, price) {
    if (!btTicket) return;
    const isLong = btTicket.direction === 'Long';
    const entry = btTicketEffectiveEntry();
    if (field === 'entry') {
        if (btTicket.orderType !== 'limit') return; // entry is only draggable for Limit, per the briefing
        btTicket.entry = price;
        btTicketApplyKeep3R();
    } else if (field === 'stopLoss') {
        const minDist = btPositionMinDist(entry);
        btTicket.stopLoss = btClampPositionSide(entry, price, !isLong, minDist);
        btTicketApplyKeep3R();
    } else if (field === 'takeProfit') {
        const minDist = btPositionMinDist(entry);
        btTicket.takeProfit = btClampPositionSide(entry, price, isLong, minDist);
        btTicket.keep3R = false; // dragging TP directly always unlocks 3R, same rule a drawing's own tp handle already follows
    }
    btRenderTicket();
}

/** All the ticket's derived numbers, computed fresh every render — nothing here is
 *  stored, matching this whole app's "derive, don't store a stale copy" convention
 *  (CLAUDE.md v3.13.0/v3.20.0). entry is recomputed from the live close on every call
 *  for a Market order, never read from btTicket.entry directly — "Market recalculation"
 *  from the briefing: entry always tracks the current price for a Market ticket. */
function btComputeTicket() {
    const t = btTicket;
    const lastCandle = chartState.candles[chartState.candles.length - 1];
    const entry = t.orderType === 'market' ? (lastCandle ? lastCandle.close : t.entry) : t.entry;
    const equity = btSession.equity;
    const feeRatePct = btSession.fee_rate_pct;

    const riskUsdInput = t.riskMode === '$' ? t.riskValue : (equity * t.riskValue / 100);
    const riskPctEffective = equity > 0 ? riskUsdInput / equity * 100 : 0;
    const lotSize = btCalcPositionSize(equity, riskPctEffective, entry, t.stopLoss);
    const notional = lotSize * entry;
    const marginRequired = btCalcMarginRequired(notional, t.leverage);
    const openPositions = (btSession.open_positions || []);
    const marginInUse = openPositions.reduce((sum, p) => sum + (p.planned_margin || 0), 0);
    const availableMargin = equity - marginInUse;
    const liquidationPrice = btCalcLiquidationPrice(t.direction, entry, t.leverage);
    const liquidationBeforeStop = btCalcLiquidationBeforeStop(t.direction, liquidationPrice, t.stopLoss);
    const entryFee = btCalcFee(lotSize, entry, feeRatePct);
    const exitFee = btCalcFee(lotSize, t.takeProfit !== null ? t.takeProfit : entry, feeRatePct);
    const totalFees = entryFee + exitFee;
    const stopDist = Math.abs(entry - t.stopLoss);
    const rr = (stopDist > 0 && t.takeProfit !== null) ? Math.abs(t.takeProfit - entry) / stopDist : null;
    // Amounts shown on the pills/ticket are net of the round-trip fee, per Part A's own
    // spec ("Both are net of the round-trip fee"). riskUsdNet still uses the entry fee
    // (already committed the moment the position opens) plus the exit fee AT THE STOP
    // price specifically (the fee actually paid if the stop is what closes the trade) --
    // not the same exitFee computed above at the TP price, which is what's paid if TP
    // closes it instead.
    const exitFeeAtStop = btCalcFee(lotSize, t.stopLoss, feeRatePct);
    const riskUsdNet = riskUsdInput + entryFee + exitFeeAtStop;
    const rewardUsdNet = t.takeProfit !== null ? Math.abs(t.takeProfit - entry) * lotSize - (entryFee + exitFee) : null;

    const ladderTier = !btSession.use_flat_risk ? btLadderTierForEquityPct(btSession, equity / btSession.starting_balance * 100) : null;
    const offLadder = ladderTier !== null && Math.abs(riskPctEffective - ladderTier.risk_pct) > 0.001;

    // Blocking rules — mirrors BacktestController::placeOrder()'s own checks so the
    // ticket's disabled reason is never a surprise once "Place Trade" is actually
    // clicked. The cursor/latest-bar check has no local equivalent to verify against
    // here (it's a server-side-only fact about the replay cursor at submit time) and is
    // therefore never blocked client-side — same reasoning BacktestController.php
    // itself already has to re-check it at submit regardless.
    // v3.22.3 Fix C — the daily trade cap is checked FIRST, not last: a trader who's
    // already at the cap can't place a trade no matter how the rest of the ticket is
    // filled in, so this is the one blockReason that also gets its own banner at the TOP
    // of the ticket (btTicketHtml()) instead of only the shared reason line at the
    // bottom -- the live report was someone building out an entire ticket (SL, TP,
    // risk, leverage) only to find out at the very end, after clicking Place Trade, that
    // none of it mattered. The ticket still OPENS for planning either way (per the
    // briefing) -- this only ever disables the submit button, never the ticket itself.
    const capReached = !!(btSession.max_trades_per_day && btSession.trades_today >= btSession.max_trades_per_day);
    const capReason = capReached ? `Daily cap reached (${btSession.trades_today}/${btSession.max_trades_per_day}): advance to the next day.` : null;

    let blockReason = capReason;
    // v3.22.2 Fix 2 — a New Trade ticket opened with no source drawing starts with
    // stopLoss 0 (rendered as an empty field, per the briefing's "SL empty" default),
    // which the side-of-entry checks below don't actually catch (0 is a valid "below
    // entry" value for a Long). Checked first (after the cap), and explicitly, so the
    // disabled reason reads "Enter a stop loss" rather than silently letting a
    // zero-stop ticket through.
    if (!blockReason && !t.stopLoss) blockReason = 'Enter a stop loss.';
    else if (!blockReason && t.direction === 'Long' && t.stopLoss >= entry) blockReason = 'For a Long, stop loss must be below entry.';
    else if (!blockReason && t.direction === 'Short' && t.stopLoss <= entry) blockReason = 'For a Short, stop loss must be above entry.';
    else if (!blockReason && marginRequired > availableMargin) blockReason = `Margin required (${fmt(marginRequired)}) exceeds available margin (${fmt(Math.max(0, availableMargin))}).`;
    else if (!blockReason && liquidationBeforeStop) blockReason = `At ${t.leverage}x leverage, liquidation (~${fmtPrice5(liquidationPrice)}) would hit before your stop.`;

    return {
        entry, lotSize, notional, marginRequired, availableMargin, liquidationPrice, liquidationBeforeStop,
        entryFee, exitFee, totalFees, rr, riskUsdInput, riskUsdNet, rewardUsdNet, riskPctEffective,
        ladderTier, offLadder, blockReason, capReached, capReason,
    };
}

/** v3.22.2 Fix 3 — the shape js/backtest-drawings.js::btDrawPosition() needs to render
 *  the source drawing's box/pills from the OPEN TICKET's own values instead of the
 *  drawing's last-saved settings (or, with no source drawing, a temporary standalone
 *  box) -- built from the identical btComputeTicket() the ticket panel and on-chart
 *  ticket lines already read, so all three can never disagree. Returns null when no
 *  ticket is open. */
function btTicketRenderValues() {
    if (!btTicket) return null;
    const c = btComputeTicket();
    return {
        tool: btTicket.direction === 'Long' ? 'position_long' : 'position_short',
        entry: c.entry,
        stop_loss: btTicket.stopLoss,
        take_profit: btTicket.takeProfit,
        riskUsdNet: c.riskUsdNet,
        rewardUsdNet: c.rewardUsdNet,
        lotSize: c.lotSize,
    };
}

function btRenderTicket() {
    if (!btTicket) return;
    const c = btComputeTicket();
    const el = document.getElementById('bt-ticket');
    el.style.display = 'flex';
    el.innerHTML = btTicketHtml(btTicket, c);
    btWireTicket(c);
    // Redraws the on-chart entry/stop/TP lines from this same, just-rendered state —
    // btDrawTicketLines() (js/backtest-drawings.js) reads btTicket directly, so this is
    // just a repaint trigger, not a second copy of the geometry.
    if (typeof btScheduleRedraw === 'function') btScheduleRedraw();
}

function btTicketHtml(t, c) {
    const segBtn = (group, val, label, extra) => `<button type="button" class="${t[group] === val ? 'active' : ''}" data-seg-group="${group}" data-seg-val="${val}">${label}</button>${extra || ''}`;
    return `
        <div class="bt-ticket-header">
            <span class="bt-ticket-header-title">New Trade</span>
            <button type="button" class="bt-ticket-close" id="bt-ticket-close-x" title="Cancel">✕</button>
        </div>
        <div class="bt-ticket-body">
            ${c.capReached ? `<div class="bt-ticket-disabled-reason" style="margin-bottom:10px">${escapeHtml(c.capReason)}</div>` : ''}
            <div class="bt-ticket-row">
                <div class="bt-ticket-seg" data-seg-group="direction">
                    ${segBtn('direction', 'Long', 'Long')}${segBtn('direction', 'Short', 'Short')}
                </div>
            </div>
            <div class="bt-ticket-row">
                <div class="bt-ticket-seg" data-seg-group="orderType">
                    ${segBtn('orderType', 'market', 'Market')}${segBtn('orderType', 'limit', 'Limit')}
                </div>
                ${t.orderType === 'limit' ? '<div class="bt-ticket-hint">Drag the orange entry line to set your price</div>' : ''}
            </div>
            <div class="bt-ticket-row">
                <div class="bt-ticket-toggle-row"><input type="checkbox" checked disabled><label style="margin:0;text-transform:none;font-size:12px;color:#d1d4dc">Stop Loss (required)</label></div>
                <div class="bt-ticket-field-row">
                    <input type="number" id="bt-ticket-sl" step="any" value="${t.stopLoss ? btRoundPrice(t.stopLoss) : ''}">
                    <span class="bt-ticket-unit-badge">PRICE</span>
                </div>
            </div>
            <div class="bt-ticket-row">
                <div class="bt-ticket-toggle-row"><input type="checkbox" id="bt-ticket-tp-on" ${t.takeProfit !== null ? 'checked' : ''}><label style="margin:0;text-transform:none;font-size:12px;color:#d1d4dc">Take Profit</label></div>
                <div class="bt-ticket-field-row" style="margin-bottom:6px">
                    <input type="number" id="bt-ticket-tp" step="any" value="${t.takeProfit !== null ? btRoundPrice(t.takeProfit) : ''}" ${t.takeProfit === null ? 'disabled' : ''}>
                    <span class="bt-ticket-unit-badge">PRICE</span>
                </div>
                <div class="bt-ticket-toggle-row"><input type="checkbox" id="bt-ticket-keep3r" ${t.keep3R ? 'checked' : ''}><label style="margin:0;text-transform:none;font-size:12px;color:#d1d4dc">Keep 3R (gate 5)</label></div>
            </div>
            <div class="bt-ticket-row">
                <label>Risk</label>
                <div class="bt-ticket-field-row">
                    <div class="bt-ticket-switch">
                        <button type="button" data-risk-mode="%" class="${t.riskMode === '%' ? 'active' : ''}">%</button>
                        <button type="button" data-risk-mode="$" class="${t.riskMode === '$' ? 'active' : ''}">$</button>
                    </div>
                    <input type="number" id="bt-ticket-risk-value" step="any" value="${t.riskValue}">
                    <span class="bt-ticket-unit-badge">= ${fmt(c.riskUsdInput)}</span>
                </div>
                ${c.offLadder ? `<div class="bt-ticket-note amber">⚠ Off-ladder — ladder tier is ${c.ladderTier.risk_pct}% here, you're at ${c.riskPctEffective.toFixed(2)}%. Recorded as planned_risk_pct either way.</div>` : ''}
            </div>
            <div class="bt-ticket-row">
                <label>Leverage</label>
                <select id="bt-ticket-leverage">
                    ${BT_ALLOWED_LEVERAGES.map(l => `<option value="${l}" ${t.leverage === l ? 'selected' : ''}>${l}×</option>`).join('')}
                </select>
                <div class="bt-ticket-computed"><span>Margin required</span><b>${fmt(c.marginRequired)}</b></div>
                <div class="bt-ticket-computed"><span>Available margin</span><b>${fmt(c.availableMargin)}</b></div>
                <div class="bt-ticket-computed"><span>Est. liquidation</span><b>${fmtPrice5(c.liquidationPrice)}</b></div>
                <div class="bt-ticket-note">Leverage changes margin, not risk.</div>
            </div>
            <div class="bt-ticket-row">
                <div class="bt-ticket-computed"><span>Lot Size</span><b>${c.lotSize.toFixed(4)}</b></div>
                <div class="bt-ticket-computed"><span>RR</span><b>${c.rr !== null ? '1:' + c.rr.toFixed(2) : '—'}</b></div>
            </div>
            <div class="bt-ticket-row">
                <div class="bt-ticket-computed"><span>Est. entry fee</span><b>${fmt(c.entryFee)}</b></div>
                <div class="bt-ticket-computed"><span>Est. exit fee</span><b>${fmt(c.exitFee)}</b></div>
                <div class="bt-ticket-computed"><span>Total fees</span><b>${fmt(c.totalFees)}</b></div>
            </div>
            ${(c.blockReason && !c.capReached) ? `<div class="bt-ticket-disabled-reason">${escapeHtml(c.blockReason)}</div>` : ''}
        </div>
        <div class="bt-ticket-actions">
            <button type="button" class="btn btn-ghost" id="bt-ticket-cancel-btn">Cancel</button>
            <button type="button" class="btn btn-primary" id="bt-ticket-place-btn" ${c.blockReason ? 'disabled' : ''}>Place Trade</button>
        </div>`;
}

function btWireTicket(c) {
    document.getElementById('bt-ticket-close-x').onclick = btCloseTicket;
    document.getElementById('bt-ticket-cancel-btn').onclick = btCloseTicket;

    document.querySelectorAll('#bt-ticket [data-seg-group]').forEach(seg => {
        seg.querySelectorAll('button[data-seg-val]').forEach(btn => {
            btn.onclick = () => {
                const group = btn.dataset.segGroup, val = btn.dataset.segVal;
                if (group === 'direction' && val !== btTicket.direction) {
                    // Switching Long<->Short mirrors SL/TP across entry, per the briefing --
                    // reuses the exact same repair helper a drawing's own load-time fix
                    // uses (v3.21.13), applied here to the ticket's own plain state object.
                    const fakeSettings = { entry: c.entry, stop_loss: btTicket.stopLoss, take_profit: btTicket.takeProfit !== null ? btTicket.takeProfit : c.entry };
                    btNormalizePositionSides(val === 'Long' ? 'position_long' : 'position_short', fakeSettings);
                    btTicket.direction = val;
                    btTicket.stopLoss = fakeSettings.stop_loss;
                    if (btTicket.takeProfit !== null) btTicket.takeProfit = fakeSettings.take_profit;
                } else if (group === 'orderType') {
                    btTicket.orderType = val;
                    if (val === 'market') btTicket.entry = c.entry; // snaps to current price immediately, not just on next render
                } else {
                    btTicket[group] = val;
                }
                // orderType and direction are two of the five Keep-3R recompute paths
                // (v3.22.2 Fix 1) -- covers both branches above in one call rather than
                // duplicating the recompute in each.
                btTicketApplyKeep3R();
                btRenderTicket();
            };
        });
    });

    document.querySelectorAll('#bt-ticket [data-risk-mode]').forEach(btn => {
        btn.onclick = () => { btTicket.riskMode = btn.dataset.riskMode; btRenderTicket(); };
    });

    document.getElementById('bt-ticket-sl').addEventListener('change', e => {
        btTicketSetField('stopLoss', parseFloat(e.target.value) || 0);
    });
    document.getElementById('bt-ticket-tp-on').addEventListener('change', e => {
        btTicket.takeProfit = e.target.checked ? btComputeTpFromRatio(btTicket.direction === 'Long' ? 'position_long' : 'position_short', c.entry, btTicket.stopLoss, 3) : null;
        btRenderTicket();
    });
    const tpInput = document.getElementById('bt-ticket-tp');
    if (tpInput && !tpInput.disabled) {
        tpInput.addEventListener('change', e => btTicketSetField('takeProfit', parseFloat(e.target.value) || 0));
    }
    document.getElementById('bt-ticket-keep3r').addEventListener('change', e => {
        btTicket.keep3R = e.target.checked;
        btTicketApplyKeep3R();
        btRenderTicket();
    });
    document.getElementById('bt-ticket-risk-value').addEventListener('change', e => {
        btTicket.riskValue = parseFloat(e.target.value) || 0;
        btRenderTicket();
    });
    document.getElementById('bt-ticket-leverage').addEventListener('change', e => {
        btTicket.leverage = parseInt(e.target.value, 10);
        btRenderTicket();
    });

    document.getElementById('bt-ticket-place-btn').onclick = btSubmitTicket;
}

/** Strips the quote asset off a Bybit linear-perp symbol for a plain "0.87 BTC"-style
 *  toast (v3.22.3 Fix F) -- a small, fixed list rather than a real instrument-metadata
 *  lookup (this app has none), same "don't invent precision/data this app can't back up"
 *  reasoning already applied to fee_rate_pct/liquidation elsewhere in this file. Falls
 *  back to the symbol as-is if none of these match. */
function btBaseAsset(symbol) {
    const s = String(symbol || '');
    for (const quote of ['USDT', 'USDC', 'BUSD', 'USD']) {
        if (s.endsWith(quote) && s.length > quote.length) return s.slice(0, -quote.length);
    }
    return s;
}

async function btSubmitTicket() {
    if (!btTicket || !btSession) return;
    const c = btComputeTicket();
    if (c.blockReason) return; // button is disabled for this, but guard directly too
    // v3.22.3 Fix F — disabled for the whole round trip, not just visually blocked by
    // c.blockReason: a double-click (or a slow first response the browser silently
    // retries) submitted the SAME ticket twice on live with nothing on screen to say the
    // first one had already gone through, placing two identical market orders on one
    // bar. Re-enabled only on an error response -- a success closes the ticket outright,
    // so there is no longer a button to re-enable.
    const placeBtn = document.getElementById('bt-ticket-place-btn');
    if (placeBtn) placeBtn.disabled = true;
    // v3.22.3 Fix B — rounded here too (not just the server's own defensive round in
    // placeOrder()), so what actually gets SUBMITTED already matches what the ticket's
    // own inputs just showed -- btTicket.stopLoss/takeProfit themselves stay full
    // precision (the RR/sizing math above, c, already ran against them), only the
    // payload's own copies are rounded.
    const payload = {
        session_id: btActiveSessionId,
        client_bar_time: btSession.replay_cursor_ms,
        type: btTicket.orderType,
        direction: btTicket.direction,
        stop_loss: btRoundPrice(btTicket.stopLoss),
        take_profit: btTicket.takeProfit !== null ? btRoundPrice(btTicket.takeProfit) : null,
        leverage: btTicket.leverage,
        risk_pct: c.riskPctEffective,
    };
    if (btTicket.orderType === 'limit') payload.limit_price = btRoundPrice(btTicket.entry);
    const res = await btApi('backtest_place_order', 'POST', payload);
    if (res && res.error) { toast(res.error, 'error'); if (placeBtn) placeBtn.disabled = false; return; }
    // v3.22.3 Fix F — "Long 0.87 BTC filled @ 7140" / "Limit order placed @ x", per the
    // briefing, using the server's own lot_size (res.lot_size) rather than re-deriving it
    // client-side -- the ticket's own preview lot size (c.lotSize) is computed against
    // THIS render's equity/risk snapshot, which is not necessarily byte-identical to
    // whatever the server actually sized the fill against a moment later.
    toast(res.filled
        ? `${res.direction} ${res.lot_size.toFixed(4)} ${btBaseAsset(btSession.symbol)} filled @ ${fmtPrice5(res.entry_price)}`
        : `Limit order placed @ ${fmtPrice5(payload.limit_price)}`);
    // v3.22.2 Fix 3 — the source drawing (if any) is saved with the ticket's own final
    // values before closing, so what's left on the chart after Place Trade matches what
    // was actually submitted, not whatever the drawing happened to say before the ticket
    // was opened.
    if (btTicket.sourceDrawingId) {
        await btUpdateDrawing(btTicket.sourceDrawingId, { settings: { entry: c.entry, stop_loss: btTicket.stopLoss, take_profit: btTicket.takeProfit } });
        // v3.22.3 Part C — links the drawing to whatever this order became, so the live
        // server-state lines (btSession.open_positions/pending_orders) take over as the
        // one on-chart representation of this trade and the original drawing's own box
        // never shows a second, duplicate one alongside it.
        await btLinkDrawingToOrder(btTicket.sourceDrawingId, res.filled ? { trade_id: res.trade_id } : { order_id: res.pending_order_id });
    }
    btCloseTicket();
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
