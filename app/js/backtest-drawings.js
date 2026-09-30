/**
 * FundedControl — Backtest Drawing Tools (v3.21.0)
 *
 * Approach (researched before building, per the briefing's own instruction): a
 * transparent <canvas id="bt-draw-overlay"> absolutely positioned over #tv-chart,
 * NOT the Lightweight Charts v4.1 series-primitives/plugin API. Both were viable —
 * v4.1.3 (the pinned version) does support primitives — but primitives are a
 * rendering-only mechanism; dragging, hit-testing and click handling have to be built
 * by hand either way, so there's no interactivity benefit to attaching to the
 * primitives lifecycle. The overlay is simpler to reason about and keeps this file
 * fully decoupled from chart.js's own rendering internals.
 *
 * Anchoring: every point is stored as {time, price} in TRUE real-world terms — time is
 * chart.js's own display-shifted seconds (toDisplaySeconds()/fromDisplaySeconds(), the
 * same domain candlesToSeriesData() already feeds the chart), price is a real price
 * value. This is deliberately NOT Lightweight Charts' own "logical index" coordinate
 * system, which several reference plugin implementations use — logical index is a bar's
 * position in the CURRENTLY LOADED array, and btLoadCandleWindow() (js/backtest.js)
 * fully replaces that array on every single advance/rewind/timeframe-switch. A drawing
 * anchored by logical index would drift or vanish on the very next step. Anchoring by
 * real time+price survives all of that: on every redraw, each anchor is converted fresh
 * to a pixel position via tvChart.timeScale().timeToCoordinate(time) and
 * tvCandleSeries.priceToCoordinate(price) — both public, documented APIs independent of
 * primitives — so pan, zoom, a timeframe switch, or a completely different loaded window
 * all correctly reposition every drawing, or correctly leave it off-screen if its own
 * time genuinely isn't part of what's currently loaded.
 *
 * No lookahead implications, per the briefing: this file never reads or writes candle
 * data, never calls get_backtest_candles, and is never consulted by the replay/order/
 * challenge engine. It only ever calls backtest_place_order (the existing, unchanged
 * endpoint) when the user explicitly clicks "Place Order" on the position tool.
 */

// ── STATE ──────────────────────────────────────────────────
let btDrawOverlay = null, btDrawCtx = null;
let btDrawings = [];              // [{id, tool, points, settings}], loaded per session
let btActiveTool = null;          // null = cursor/select mode, else one of the tool names
let btDrawInProgress = null;      // the drawing currently being placed (not yet saved)
let btSelectedDrawingId = null;
let btDragState = null;           // {drawingId, handleIndex|'move', startPoints, startMouse}
let btMagnetEnabled = true;
let btDrawRaf = null;             // requestAnimationFrame handle, for throttled redraws
let btDrawingDefaults = {};       // {tool: settings}, this user's saved defaults — loaded once per session open (v3.21.12)

// Tools that currently expose "Save as default"/"Reset to default" in their settings
// panel (v3.21.12). Fib retracement only this release, per the briefing's own scope —
// btTemplateRowHtml()/btMergedToolDefaults() are already generic by tool, so adding
// another tool here later needs no further plumbing change.
const BT_TEMPLATE_TOOLS = ['fib_retracement'];

const BT_TOOL_DEFAULTS = {
    position_long:   { color: '#26a69a', rr_ratio: 3, rr_locked: true },
    position_short:  { color: '#ef5350', rr_ratio: 3, rr_locked: true },
    // v3.21.2: rebuilt to match the TradingView reference the ticket compared against.
    // `extend` replaces the old `extend_right` boolean (which defaulted true and drew
    // every level edge-to-edge across the whole canvas by default -- ticket item 2);
    // 'none' is now the default, matching "between its anchors, not stretched across the
    // whole chart." `show_trend_line` is the diagonal connector between the two raw
    // anchors, independent of the horizontal level lines and their own width/style.
    // `levels` includes TradingView's full standard ratio set so every one is available
    // from the settings dialog, but only the six the ticket named are enabled by default.
    fib_retracement: {
        show_trend_line: true, trend_color: '#787b86', trend_style: 'solid',
        width: 1, style: 'solid',
        extend: 'none', // 'none' | 'right' | 'both'
        reverse: false,
        show_prices: true, show_levels: true,
        levels_format: 'value', // 'value' | 'percent'
        label_h: 'right', label_v: 'middle', // 'left'/'right'; 'top'/'middle'/'bottom'
        font_size: 10,
        background: false, background_opacity: 0.1,
        levels: [
            { ratio: 0,     enabled: true,  color: '#787b86' },
            { ratio: 0.236, enabled: false, color: '#81c784' },
            { ratio: 0.382, enabled: true,  color: '#f23645' },
            { ratio: 0.5,   enabled: true,  color: '#f5a623' },
            { ratio: 0.618, enabled: true,  color: '#4caf50' },
            { ratio: 0.65,  enabled: false, color: '#26a69a' },
            { ratio: 0.786, enabled: true,  color: '#089981' },
            { ratio: 1,     enabled: true,  color: '#787b86' },
            { ratio: 1.272, enabled: false, color: '#7e57c2' },
            { ratio: 1.414, enabled: false, color: '#5c6bc0' },
            { ratio: 1.618, enabled: false, color: '#42a5f5' },
            { ratio: 2.618, enabled: false, color: '#29b6f6' },
            { ratio: 3.618, enabled: false, color: '#26c6da' },
            { ratio: 4.236, enabled: false, color: '#8d6e63' },
        ] },
    trend_line:      { color: '#2962ff', width: 2, style: 'solid', extend_left: false, extend_right: false, show_price_label: true, show_angle_label: false },
    horizontal_line: { color: '#2962ff', width: 1, style: 'solid' },
    horizontal_ray:  { color: '#2962ff', width: 1, style: 'solid' },
};

// ── OVERLAY SETUP ──────────────────────────────────────────
/**
 * v3.21.1 — REWRITTEN. The overlay is now PURELY a rendering canvas: pointer-events stays
 * 'none' permanently, and it is never itself an event target. v3.21.0's design toggled
 * pointer-events dynamically based on a SEPARATE mousemove-driven hover pre-check
 * (btUpdateOverlayInteractivity(), now removed) -- verified in an actual browser
 * (Playwright + a real Chromium instance, loading these exact files) to be a genuine
 * race condition: hovering exactly on a handle could still leave pointer-events at
 * 'none' at the instant the real mousedown fired, silently dropping the click through to
 * the chart's own canvas underneath instead of reaching this file's handlers at all --
 * this is what "dragging is unresponsive, takes many clicks and drags" actually was.
 *
 * Fixed architecture: listen on .tv-chart-wrap (an ancestor of both the overlay and the
 * chart's own inner canvas) with {capture: true}, so this file sees every mouse event
 * BEFORE Lightweight Charts' own internal listeners do (capture phase runs top-down,
 * before the bubble phase reaches whatever the chart itself is listening on). Every
 * handler decides synchronously, from the SAME event, whether it's relevant: if a tool
 * is active or an existing drawing is hit, call e.stopPropagation() so the chart's own
 * pan/zoom/crosshair handling never sees it; otherwise do nothing and let the event
 * continue completely normally. No separate hover state, no toggle, no race window.
 */
function btInitDrawOverlay() {
    const wrap = document.querySelector('.tv-chart-wrap');
    if (!wrap || btDrawOverlay) return;
    btDrawOverlay = document.createElement('canvas');
    btDrawOverlay.id = 'bt-draw-overlay';
    wrap.appendChild(btDrawOverlay);
    btDrawCtx = btDrawOverlay.getContext('2d');

    const opts = { capture: true };
    wrap.addEventListener('mousedown', btOnDrawMouseDown, opts);
    wrap.addEventListener('mousemove', btOnDrawMouseMove, opts);
    wrap.addEventListener('mouseup', btOnDrawMouseUp, opts);
    wrap.addEventListener('dblclick', btOnDrawDblClick, opts);
    wrap.addEventListener('contextmenu', btOnDrawContextMenu, opts);
    document.addEventListener('keydown', btOnDrawKeyDown);

    if (tvChart) {
        tvChart.timeScale().subscribeVisibleLogicalRangeChange(() => btScheduleRedraw());
    }

    // Same two resize triggers chart.js's own resizeTvChart() responds to (sidebar
    // collapse/expand, window resize) -- kept independent of chart.js itself rather than
    // editing that shared file for a backtest-only concern. Guarded by the btDrawOverlay
    // early-return above, so these are only ever attached once per page load.
    window.addEventListener('resize', () => btScheduleRedraw());
    const sidebarEl = document.querySelector('.sidebar');
    if (sidebarEl) {
        sidebarEl.addEventListener('transitionend', e => {
            if (e.propertyName === 'width') setTimeout(() => btScheduleRedraw(), 50);
        });
    }
}

function btResizeDrawOverlay() {
    if (!btDrawOverlay) return;
    const container = document.getElementById('tv-chart');
    if (!container) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (btDrawOverlay.width !== w || btDrawOverlay.height !== h) {
        btDrawOverlay.width = w;
        btDrawOverlay.height = h;
    }
    btScheduleRedraw();
}

function btScheduleRedraw() {
    if (btDrawRaf) return;
    btDrawRaf = requestAnimationFrame(() => { btDrawRaf = null; btRenderDrawings(); });
}

// v3.21.1: btUpdateOverlayInteractivity() removed -- see btInitDrawOverlay()'s own
// docblock for why the hover-based pointer-events toggle it implemented was a genuine,
// verified race condition, replaced by capture-phase listeners deciding synchronously.

// ── COORDINATE HELPERS ─────────────────────────────────────
// v3.21.4 — coordinateToTime()/timeToCoordinate() only ever resolve a REAL candle's own
// time; verified via Playwright that coordinateToTime(x) returns null for any x past the
// last loaded candle (e.g. the chart's own right-offset margin) even though
// coordinateToLogical(x) happily returns a valid, continuous logical index out there
// (barSpacing-based, works for any x on the pane). This is exactly why placement/dragging
// silently did nothing in that empty space: btPixelToPoint() requires a non-null time,
// and the direct time API can't ever produce one where no candle exists. Both directions
// now fall back to the logical-index scale, extrapolating a "projected" time from the
// nearest real edge candle using the timeframe's own fixed bar interval -- this app's
// candles are always evenly spaced by timeframe, so this is exact, not approximate, and
// deliberately symmetric (btTimeToX undoes exactly what btXToTime computed) so a
// drawing's own anchor round-trips through save/reload without drifting.
function btLastRealLogical() {
    return (chartState.candles && chartState.candles.length) ? chartState.candles.length - 1 : null;
}
function btStepSec() {
    return (backtestStepMsFor(chartState.timeframe) || 3600000) / 1000;
}
function btTimeToX(time) {
    if (!tvChart) return null;
    const ts = tvChart.timeScale();
    const direct = ts.timeToCoordinate(time);
    if (direct !== null && direct !== undefined) return direct;
    const lastIdx = btLastRealLogical();
    if (lastIdx === null) return null;
    const stepSec = btStepSec();
    const lastTime = toDisplaySeconds(chartState.candles[lastIdx].time, chartState.timezone);
    const firstTime = toDisplaySeconds(chartState.candles[0].time, chartState.timezone);
    // A projected anchor (beyond the last real candle, or before the first) isn't a real
    // data point, so timeToCoordinate can't resolve it -- reconstruct the same logical
    // index btXToTime would have produced when this time was first computed, then let
    // the chart's own logicalToCoordinate() (continuous, extrapolates via bar spacing)
    // place it on screen.
    let logical;
    if (time >= lastTime) logical = lastIdx + (time - lastTime) / stepSec;
    else if (time <= firstTime) logical = (time - firstTime) / stepSec;
    else return null; // inside the loaded range but not a real point -- a genuine gap, not ours to guess at
    const x = ts.logicalToCoordinate(logical);
    return (x === null || x === undefined) ? null : x;
}
function btPriceToY(price) {
    if (!tvCandleSeries) return null;
    const y = tvCandleSeries.priceToCoordinate(price);
    return (y === null || y === undefined) ? null : y;
}
function btXToTime(x) {
    if (!tvChart) return null;
    const ts = tvChart.timeScale();
    const direct = ts.coordinateToTime(x);
    if (direct !== null && direct !== undefined) return direct;
    const lastIdx = btLastRealLogical();
    if (lastIdx === null) return null;
    const logical = ts.coordinateToLogical(x);
    if (logical === null || logical === undefined) return null;
    const stepSec = btStepSec();
    if (logical > lastIdx) {
        const lastTime = toDisplaySeconds(chartState.candles[lastIdx].time, chartState.timezone);
        return Math.round(lastTime + (logical - lastIdx) * stepSec);
    }
    if (logical < 0) {
        const firstTime = toDisplaySeconds(chartState.candles[0].time, chartState.timezone);
        return Math.round(firstTime + logical * stepSec);
    }
    // Inside the loaded range's logical span but coordinateToTime still returned null --
    // would mean a genuine gap in the series; fall back to the nearest real candle rather
    // than dropping the point entirely.
    const idx = Math.max(0, Math.min(lastIdx, Math.round(logical)));
    return toDisplaySeconds(chartState.candles[idx].time, chartState.timezone);
}
function btYToPrice(y) {
    if (!tvCandleSeries) return null;
    return tvCandleSeries.coordinateToPrice(y);
}

// Pixel-space cutoff for "close enough to a wick to snap to it" -- see btSnapPrice()'s
// own doc comment for why this has to be a pixel distance, not a price distance.
const BT_MAGNET_SNAP_PX = 10;

/** Snap a raw price to the nearest OHLC value of the candle at/near the given display-
 *  domain time — "the user anchors wick to wick." Falls back to the raw price if no
 *  candle is close enough in time (e.g. clicking in empty space past the last bar), OR
 *  if a candle was found but the cursor's own y position isn't actually near any of its
 *  four wick prices on screen.
 *
 *  That second check is load-bearing, not defensive. Time-snapping only depends on x, so
 *  every y position along one purely-vertical drag (the natural "drag to set risk"
 *  gesture) resolves to the SAME candle. Before this fix, price snapping had no distance
 *  cutoff of its own -- once a candle was picked, the raw price ALWAYS snapped to
 *  whichever of its 4 OHLC values was nearest, no matter how far away the cursor actually
 *  was. That collapses a whole vertical drag onto at most 4 possible price outcomes, and
 *  verified via Playwright: two different drag endpoints in the same bar's column, both
 *  priced well outside that candle's real range, both silently snapped to the exact same
 *  wick value -- indistinguishable from the entry===TP/R:R=0 corruption this ticket was
 *  filed over. The cutoff is in pixels, not price, because a price-unit tolerance would
 *  be wrong by orders of magnitude across this app's own price range (0.0044 to 71,968,
 *  per CLAUDE.md's v3.14.5 note) -- a fixed pixel radius means "visually near the wick,"
 *  which is what magnet snapping is supposed to mean regardless of the instrument. */
function btSnapPrice(time, rawPrice, y) {
    if (!btMagnetEnabled || !chartState.candles.length) return rawPrice;
    let nearest = null, nearestDist = Infinity;
    for (const c of chartState.candles) {
        const ct = toDisplaySeconds(c.time, chartState.timezone);
        const dist = Math.abs(ct - time);
        if (dist < nearestDist) { nearestDist = dist; nearest = c; }
    }
    // Half a bar's own width, in display-seconds, is the cutoff for "close enough to
    // snap to this candle at all" -- beyond that the cursor is nearer some other bar.
    const stepSec = (backtestStepMsFor(chartState.timeframe) || 3600000) / 1000;
    if (!nearest || nearestDist > stepSec) return rawPrice;
    const candidates = [nearest.open, nearest.high, nearest.low, nearest.close];
    let best = null, bestPxDist = Infinity;
    for (const v of candidates) {
        const py = btPriceToY(v);
        if (py === null) continue;
        const d = Math.abs(py - y);
        if (d < bestPxDist) { bestPxDist = d; best = v; }
    }
    if (best === null || bestPxDist > BT_MAGNET_SNAP_PX) return rawPrice;
    return best;
}
/** v3.21.4 — previously searched for and snapped to the single nearest REAL candle with
 *  no distance cutoff at all, unconditionally. That's exactly what silently undid
 *  btXToTime()'s new empty-space extrapolation: any projected time past the last candle
 *  is, by definition, always "nearest" to that same last candle, so every anchor placed
 *  in the empty space got dragged straight back onto it. Rewritten to round to the
 *  nearest bar-interval boundary via the same logical-index math btXToTime() uses,
 *  instead of a nearest-candle search -- this app's candles are always evenly spaced by
 *  timeframe, so for an in-range time this produces the exact same real candle as before
 *  (bar-alignment is unchanged for on-chart placement), while a time beyond either edge
 *  now rounds to the nearest projected bar instead of collapsing onto the edge candle. */
function btSnapTimeToCandle(rawTime) {
    const lastIdx = btLastRealLogical();
    if (lastIdx === null) return rawTime;
    const stepSec = btStepSec();
    const firstTime = toDisplaySeconds(chartState.candles[0].time, chartState.timezone);
    const lastTime = toDisplaySeconds(chartState.candles[lastIdx].time, chartState.timezone);
    const logical = Math.round((rawTime - firstTime) / stepSec);
    if (logical >= 0 && logical <= lastIdx) return toDisplaySeconds(chartState.candles[logical].time, chartState.timezone);
    if (logical > lastIdx) return Math.round(lastTime + (logical - lastIdx) * stepSec);
    return Math.round(firstTime + logical * stepSec);
}

// ── PERSISTENCE ────────────────────────────────────────────
async function loadBtDrawings() {
    if (!btActiveSessionId) return;
    const res = await btApi(`get_backtest_drawings&session_id=${btActiveSessionId}`);
    btDrawings = (res && !res.error && Array.isArray(res)) ? res : [];
    if (res && res.error) {
        console.warn('[backtest-drawings] could not load drawings:', res.error);
        toast('Could not load drawings — ' + res.error, 'error');
    }
    // v3.21.13 — repairs any position drawing saved with the pre-fix bug (stop/TP on the
    // wrong side of entry, e.g. a Short's stop below entry instead of above). Runs once
    // per load; btNormalizePositionSides() mutates d.settings in place and returns true
    // only when it actually changed something, so an already-correct drawing (every
    // Long, and any Short drawn after this fix ships) triggers no save at all.
    for (const d of btDrawings) {
        if ((d.tool === 'position_long' || d.tool === 'position_short') && btNormalizePositionSides(d.tool, d.settings)) {
            await btUpdateDrawing(d.id, { settings: d.settings });
        }
    }
    btScheduleRedraw();
}
/** This user's saved per-tool defaults — user-scoped, not session-scoped, but loaded
 *  once per session open (alongside loadBtDrawings()) rather than once ever, so a
 *  default saved/reset from a settings panel takes effect on every session opened after
 *  that without needing a page reload in between. Failure degrades to "no saved
 *  defaults" (every tool falls back to BT_TOOL_DEFAULTS alone via btMergedToolDefaults())
 *  rather than blocking the session from opening at all. */
async function loadBtDrawingDefaults() {
    const res = await btApi('get_drawing_defaults');
    if (res && res.error) {
        console.warn('[backtest-drawings] could not load drawing defaults:', res.error);
        toast('Could not load drawing defaults — ' + res.error, 'error');
        btDrawingDefaults = {};
        return;
    }
    btDrawingDefaults = (res && typeof res === 'object' && !Array.isArray(res)) ? res : {};
}
/** Deep-merges this user's saved default (if any) over the code's own BT_TOOL_DEFAULTS
 *  for a tool. The saved default wins field-by-field, but any field the code defines
 *  that the saved default predates (added to BT_TOOL_DEFAULTS after the user last saved)
 *  still comes through from the code default rather than being silently dropped.
 *
 *  `levels` (fib only) is merged by `ratio`, not array index — a saved default is just
 *  the settings object as it existed at save time, so a ratio added to BT_TOOL_DEFAULTS
 *  later has to be matched by its own value to appear at all, not by array position
 *  (which could point at an entirely different ratio between the two arrays). A ratio
 *  that only exists in the saved default (removed from the code since) is deliberately
 *  dropped, not resurrected — the code's own ratio list is authoritative for which levels
 *  exist at all; the saved default only ever overrides enabled/color per ratio. */
function btMergedToolDefaults(tool) {
    const codeDefault = BT_TOOL_DEFAULTS[tool] || {};
    const saved = btDrawingDefaults[tool];
    if (!saved) return JSON.parse(JSON.stringify(codeDefault));
    const merged = Object.assign(JSON.parse(JSON.stringify(codeDefault)), JSON.parse(JSON.stringify(saved)));
    if (Array.isArray(codeDefault.levels)) {
        merged.levels = codeDefault.levels.map(codeLevel => {
            const savedLevel = (saved.levels || []).find(l => l.ratio === codeLevel.ratio);
            return savedLevel ? Object.assign({}, codeLevel, savedLevel) : Object.assign({}, codeLevel);
        });
    }
    return merged;
}
/** Saves this drawing's CURRENT settings as this user's default for its tool. Never
 *  touches the drawing itself (no id/session_id in the request) — only the separate
 *  per-user/per-tool row, per the briefing's own "existing drawings are never modified"
 *  constraint. */
async function btSaveDrawingDefault(d) {
    const res = await btApi('save_drawing_default', 'POST', { tool: d.tool, settings: d.settings });
    if (res && res.error) { toast('Could not save default — ' + res.error, 'error'); return; }
    btDrawingDefaults[d.tool] = JSON.parse(JSON.stringify(d.settings));
    toast('Saved as default for ' + d.tool.replace(/_/g, ' '));
}
/** Deletes the saved default for a tool. Never touches any existing drawing, including
 *  the one whose settings panel this was clicked from — resetting the default only
 *  changes what the NEXT new drawing of this tool starts with. */
async function btResetDrawingDefault(tool) {
    const res = await btApi('reset_drawing_default', 'POST', { tool });
    if (res && res.error) { toast('Could not reset default — ' + res.error, 'error'); return; }
    delete btDrawingDefaults[tool];
    toast('Reset to code default for ' + tool.replace(/_/g, ' '));
}
async function btSaveNewDrawing(tool, points, settings) {
    const res = await btApi('add_backtest_drawing', 'POST', { session_id: btActiveSessionId, tool, points, settings });
    if (res && res.error) { toast('Could not save drawing — ' + res.error, 'error'); return null; }
    const drawing = { id: res.id, tool, points, settings };
    btDrawings.push(drawing);
    return drawing;
}
// v3.21.6 — the settings panel fires a save on every individual field change (colour
// pickers and the opacity slider fire on 'input' too, for live preview -- see
// btWireDrawSettingsPopover), so a few seconds of adjusting several fib settings can
// issue a dozen-plus overlapping requests for the same drawing. Investigated this ticket's
// "settings don't persist" report end to end first (full round trip verified against a
// simulated backend: payload includes settings, the server write is unconditional and
// correctly scoped, a fresh reload restores both settings and geometry, and even 40+
// rapid overlapping saves under artificial network jitter didn't reproduce loss in this
// environment) -- couldn't force a failure, but concurrent requests with no ordering
// guarantee is a genuine, textbook risk regardless: if an EARLIER request's response
// happens to reach the server after a LATER one on a real network, its older payload
// wins the final write, silently reverting whatever the later request had just saved.
// Serializing per-drawing closes that risk outright rather than leaving it to chance.
const btDrawingSaveQueue = {}; // id -> Promise chain, one link per queued save
async function btUpdateDrawing(id, patch) {
    const d = btDrawings.find(x => x.id === id);
    if (d) { if (patch.points) d.points = patch.points; if (patch.settings) Object.assign(d.settings, patch.settings); }
    const prior = btDrawingSaveQueue[id] || Promise.resolve();
    const thisSave = prior.then(async () => {
        if (!d) return;
        // Re-read d.points/d.settings now, not at queue time -- by the time this save's
        // turn comes, it always transmits whatever is truly current, so a burst of rapid
        // edits collapses into however many requests actually fire, each one correct.
        const res = await btApi('update_backtest_drawing', 'POST', { id, points: d.points, settings: d.settings });
        if (res && res.error) toast('Could not save changes — ' + res.error, 'error');
    });
    btDrawingSaveQueue[id] = thisSave;
    await thisSave;
}
async function btDeleteDrawing(id) {
    const res = await btApi('delete_backtest_drawing', 'POST', { id });
    if (res && res.error) { toast('Could not delete — ' + res.error, 'error'); return; }
    btDrawings = btDrawings.filter(d => d.id !== id);
    if (btSelectedDrawingId === id) btSelectedDrawingId = null;
    btHideDrawSettingsPopover();
    btScheduleRedraw();
}

// ── TOOLBAR ────────────────────────────────────────────────
const BT_DRAG_TOOLS = ['fib_retracement', 'position_long', 'position_short'];
const BT_TWO_CLICK_TOOLS = ['trend_line'];
const BT_SINGLE_CLICK_TOOLS = ['horizontal_line', 'horizontal_ray'];

function btSelectTool(tool) {
    btActiveTool = (btActiveTool === tool) ? null : tool;
    btDrawInProgress = null;
    btSelectedDrawingId = null;
    btHideDrawSettingsPopover();
    setBtActiveToolButton();
    btScheduleRedraw();
}
function setBtActiveToolButton() {
    // dataset.tool is always a string (HTML data-* attributes never read back as null) --
    // compared against (btActiveTool || '') so the cursor button (data-tool="") correctly
    // shows active when btActiveTool is null, not just when it's literally the empty string.
    document.querySelectorAll('.bt-tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === (btActiveTool || '')));
    if (btDrawOverlay) btDrawOverlay.style.cursor = btActiveTool ? 'crosshair' : 'default';
}
function btToggleMagnet() {
    btMagnetEnabled = !btMagnetEnabled;
    document.getElementById('bt-magnet-btn')?.classList.toggle('active', btMagnetEnabled);
}
function btDeleteSelected() {
    if (btSelectedDrawingId) btDeleteDrawing(btSelectedDrawingId);
}

// ── MOUSE / KEYBOARD ───────────────────────────────────────
function btMousePos(e) {
    const rect = btDrawOverlay.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
/** Raw pixel -> {time, price}, snapped to the nearest candle when magnet is on. Returns
 *  null if the position is off the time/price scale entirely (nothing to anchor to). */
function btPixelToPoint(x, y) {
    let time = btXToTime(x);
    let price = btYToPrice(y);
    if (time === null || price === null || time === undefined || price === undefined) return null;
    time = btSnapTimeToCandle(time);
    price = btSnapPrice(time, price, y);
    return { time, price };
}

/** Only ever true while this file is actually claiming the gesture (a tool is active, a
 *  drawing is being dragged, or one was just hit) -- checked by every handler before
 *  calling e.stopPropagation(), so a click on genuinely empty chart space is always left
 *  completely alone for the chart's own native pan/zoom/crosshair to handle. */
function btIsCapturingInput() {
    return !!(btActiveTool || btDrawInProgress || btDragState || btTicketDragField);
}

// v3.22.1 — which ticket line ('entry'|'stopLoss'|'takeProfit') is currently being
// dragged, or null. A separate state var from btDragState (drawing drags) deliberately
// -- the ticket's lines are not backtest_drawings rows, they're a plain rendering of
// js/backtest.js's own btTicket state object, so they need their own drag tracking
// rather than being folded into the drawing-drag machinery that assumes a real
// drawing id to look up.
let btTicketDragField = null;

/** Full-width horizontal hit-test against the order ticket's own entry/stop/TP lines --
 *  X doesn't matter (the lines span the whole canvas), only Y proximity, same
 *  BT_LINE_HIT_TOLERANCE every other line-hit-test in this file already uses. Returns
 *  null immediately when no ticket is open, so every caller of this function adds zero
 *  behavior change for the overwhelming common case (no ticket open) without needing
 *  its own guard. The Entry line only hit-tests at all for a Limit order -- a Market
 *  order's entry always tracks the live close (see js/backtest.js::btComputeTicket())
 *  and isn't meant to be dragged, per the briefing. */
function btTicketLineHitTest(x, y) {
    if (!btTicket) return null;
    const c = btComputeTicket();
    const yStop = btPriceToY(btTicket.stopLoss);
    if (yStop !== null && Math.abs(y - yStop) <= BT_LINE_HIT_TOLERANCE) return 'stopLoss';
    if (btTicket.takeProfit !== null) {
        const yTp = btPriceToY(btTicket.takeProfit);
        if (yTp !== null && Math.abs(y - yTp) <= BT_LINE_HIT_TOLERANCE) return 'takeProfit';
    }
    if (btTicket.orderType === 'limit') {
        const yEntry = btPriceToY(c.entry);
        if (yEntry !== null && Math.abs(y - yEntry) <= BT_LINE_HIT_TOLERANCE) return 'entry';
    }
    return null;
}

function btOnDrawMouseDown(e) {
    if (e.button !== 0) return; // left click only -- right click is contextmenu (settings)
    const { x, y } = btMousePos(e);

    // v3.22.1 — the order ticket's own lines take priority over everything else while
    // open: the trader is actively configuring an order, not drawing or panning.
    // btTicketLineHitTest() returns null immediately when no ticket is open, so this
    // adds zero behavior change the overwhelming majority of the time.
    const ticketHit = btTicketLineHitTest(x, y);
    if (ticketHit) {
        e.stopPropagation();
        btTicketDragField = ticketHit;
        return;
    }

    if (btActiveTool) {
        e.stopPropagation(); // a tool is active -- every click while placing belongs to it, never to chart panning
        const pt = btPixelToPoint(x, y);
        if (!pt) return;

        if (BT_SINGLE_CLICK_TOOLS.includes(btActiveTool)) {
            btFinalizeNewDrawing(btActiveTool, [pt]);
            return;
        }
        if (BT_TWO_CLICK_TOOLS.includes(btActiveTool)) {
            if (!btDrawInProgress) {
                btDrawInProgress = { tool: btActiveTool, points: [pt], previewPoint: pt };
            } else {
                btFinalizeNewDrawing(btDrawInProgress.tool, [btDrawInProgress.points[0], pt]);
                btDrawInProgress = null;
            }
            btScheduleRedraw();
            return;
        }
        if (BT_DRAG_TOOLS.includes(btActiveTool)) {
            btDrawInProgress = { tool: btActiveTool, points: [pt], previewPoint: pt, dragging: true };
            btScheduleRedraw();
            return;
        }
        return;
    }

    // Cursor mode -- select/drag an existing drawing. Hit-testing runs on THIS SAME
    // mousedown event, synchronously -- no separate hover pre-check, no race window.
    const hit = btHitTest(x, y);
    if (hit) {
        e.stopPropagation(); // claiming this drag -- the chart must not also start panning from the same mousedown
        const startPoint = btPixelToPoint(x, y);
        btSelectedDrawingId = hit.drawing.id;
        btDragState = {
            drawingId: hit.drawing.id, handleIndex: hit.handleIndex, startPoint,
            startPoints: JSON.parse(JSON.stringify(hit.drawing.points)),
            startSettings: JSON.parse(JSON.stringify(hit.drawing.settings)),
        };
    } else {
        // Nothing hit -- deliberately do NOT stopPropagation here. This click is left
        // completely alone so the chart's own pan-drag starts normally underneath.
        btSelectedDrawingId = null;
        btHideDrawSettingsPopover();
    }
    btScheduleRedraw();
}

function btOnDrawMouseMove(e) {
    if (btTicketDragField) {
        e.stopPropagation();
        const { y } = btMousePos(e);
        const price = btYToPrice(y);
        // v3.21.13's own side-clamp is applied inside btTicketSetField()
        // (js/backtest.js) itself, not here — same single-state-object/single-render
        // pattern this whole ticket feature uses throughout.
        if (price !== null) btTicketSetField(btTicketDragField, price);
        return;
    }
    if (!btDrawInProgress && !btDragState) return; // nothing of ours in progress -- let the chart's own crosshair/pan handle this move untouched
    e.stopPropagation();
    const { x, y } = btMousePos(e);
    if (btDrawInProgress) {
        const pt = btPixelToPoint(x, y);
        if (pt) btDrawInProgress.previewPoint = pt;
        btScheduleRedraw();
        return;
    }
    if (btDragState) {
        const pt = btPixelToPoint(x, y);
        if (pt) btApplyDrag(btDragState, pt);
        btScheduleRedraw();
    }
}

function btOnDrawMouseUp(e) {
    if (btTicketDragField) {
        e.stopPropagation();
        btTicketDragField = null; // the field's own value is already committed live, on every move -- nothing left to finalize here
        return;
    }
    if (!btDrawInProgress && !btDragState) return;
    e.stopPropagation();
    if (btDrawInProgress && btDrawInProgress.dragging) {
        const { x, y } = btMousePos(e);
        const pt = btPixelToPoint(x, y) || btDrawInProgress.previewPoint;
        const start = btDrawInProgress.points[0];
        // A mousedown+mouseup with (near-)no real drag -- a plain accidental click, or a
        // shaky retry on top of a drawing that already exists -- shouldn't create a
        // stacked, visually-indistinguishable duplicate. v3.21.2: widened from an exact
        // time+price equality check to a real on-screen pixel-distance threshold, since
        // an exact match almost never happens with a real mouse (magnet snapping aside)
        // -- a near-zero but non-exact drag was passing this guard and saving a
        // degenerate drawing anyway, which is the most likely source of "multiple fib
        // objects appear stacked" reported against v3.21.1.
        const startPx = btPointToPixel(start), endPx = btPointToPixel(pt);
        const pxDist = (startPx && endPx) ? Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y) : Infinity;
        if (pxDist < BT_HANDLE_RADIUS) {
            btDrawInProgress = null;
            btScheduleRedraw();
            return;
        }
        btFinalizeNewDrawing(btDrawInProgress.tool, [start, pt]);
        btDrawInProgress = null;
        return;
    }
    if (btDragState) {
        const d = btDrawings.find(x2 => x2.id === btDragState.drawingId);
        if (d) btUpdateDrawing(d.id, { points: d.points, settings: d.settings });
        btDragState = null;
    }
}

function btOnDrawDblClick(e) {
    const { x, y } = btMousePos(e);
    const hit = btHitTest(x, y);
    if (hit) {
        e.stopPropagation(); // don't also let chart.js's own dblclick-to-fitContent() fire
        btSelectedDrawingId = hit.drawing.id;
        btShowDrawSettingsPopover(hit.drawing, e.clientX, e.clientY);
        btScheduleRedraw();
    }
}
function btOnDrawContextMenu(e) {
    const { x, y } = btMousePos(e);
    const hit = btHitTest(x, y);
    if (hit) {
        e.preventDefault();
        e.stopPropagation();
        btSelectedDrawingId = hit.drawing.id;
        btShowDrawSettingsPopover(hit.drawing, e.clientX, e.clientY);
        btScheduleRedraw();
    }
}
function btOnDrawKeyDown(e) {
    if (!btActiveSessionId) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return; // don't hijack typing in the settings popover or elsewhere
    if (e.key === 'Delete' || e.key === 'Backspace') {
        btDeleteSelected();
    } else if (e.key === 'Escape') {
        btActiveTool = null; btDrawInProgress = null; btSelectedDrawingId = null;
        setBtActiveToolButton(); btHideDrawSettingsPopover(); btScheduleRedraw();
    }
}

/**
 * v3.21.0 — R:R lock: dragging entry shifts entry+stop together (preserving the exact
 * risk distance) and, if locked, recomputes TP from the ratio; dragging stop alone
 * changes the risk distance and, if locked, recomputes TP from the new distance;
 * dragging TP directly always unlocks the ratio and shows whatever ratio results.
 */
function btApplyDrag(dragState, newPoint) {
    const d = btDrawings.find(x => x.id === dragState.drawingId);
    if (!d || !dragState.startPoint) return;
    const dt = newPoint.time - dragState.startPoint.time;
    const dp = newPoint.price - dragState.startPoint.price;

    if (dragState.handleIndex === 'move') {
        d.points = dragState.startPoints.map(p => ({
            time: p.time + dt,
            ...(p.price !== undefined ? { price: p.price + dp } : {}),
        }));
        if (d.tool === 'position_long' || d.tool === 'position_short') {
            d.settings.entry = dragState.startSettings.entry + dp;
            d.settings.stop_loss = dragState.startSettings.stop_loss + dp;
            d.settings.take_profit = dragState.startSettings.take_profit + dp;
        }
        return;
    }
    if (typeof dragState.handleIndex === 'number') {
        d.points = dragState.startPoints.map((p, i) => i === dragState.handleIndex ? newPoint : p);
        return;
    }
    if (dragState.handleIndex === 'entry') {
        const isLong = d.tool === 'position_long';
        const deltaEntry = newPoint.price - dragState.startSettings.entry;
        d.settings.entry = newPoint.price;
        // v3.21.13 — shifting stop/tp by the same delta as entry preserves their original
        // distance and side, so this can't newly cross entry on its own; still clamped
        // defensively (btPositionMinDist is recomputed against the NEW entry, so a very
        // large entry move to a tiny price still keeps a valid minimum gap either way).
        const minDist = btPositionMinDist(d.settings.entry);
        d.settings.stop_loss = btClampPositionSide(d.settings.entry, dragState.startSettings.stop_loss + deltaEntry, !isLong, minDist);
        d.settings.take_profit = d.settings.rr_locked
            ? btComputeTpFromRatio(d.tool, d.settings.entry, d.settings.stop_loss, d.settings.rr_ratio)
            : btClampPositionSide(d.settings.entry, dragState.startSettings.take_profit + deltaEntry, isLong, minDist);
    } else if (dragState.handleIndex === 'stop') {
        const isLong = d.tool === 'position_long';
        const minDist = btPositionMinDist(d.settings.entry);
        // v3.21.13 — clamped to the correct side of entry: Long's stop must stay below
        // entry (wantAbove=false), Short's must stay above (wantAbove=true) — dragging
        // past entry stops the handle at the boundary instead of crossing to the wrong
        // side, which is what produced the live SL-below-entry Short this release fixes.
        d.settings.stop_loss = btClampPositionSide(d.settings.entry, newPoint.price, !isLong, minDist);
        if (d.settings.rr_locked) {
            d.settings.take_profit = btComputeTpFromRatio(d.tool, d.settings.entry, d.settings.stop_loss, d.settings.rr_ratio);
        }
    } else if (dragState.handleIndex === 'tp') {
        const isLong = d.tool === 'position_long';
        const minDist = btPositionMinDist(d.settings.entry);
        // Long's TP must stay above entry (wantAbove=true), Short's must stay below.
        d.settings.take_profit = btClampPositionSide(d.settings.entry, newPoint.price, isLong, minDist);
        d.settings.rr_locked = false;
        const dist = Math.abs(d.settings.entry - d.settings.stop_loss);
        d.settings.rr_ratio = dist > 0 ? +(Math.abs(d.settings.take_profit - d.settings.entry) / dist).toFixed(2) : 0;
    }
}

function btComputeTpFromRatio(tool, entry, stop, ratio) {
    const dist = Math.abs(entry - stop);
    return tool === 'position_long' ? entry + dist * ratio : entry - dist * ratio;
}

// v3.21.13 — the position tool never checked which side of entry the stop/TP should be
// on: btFinalizeNewDrawing() took the drag end's raw price as stop_loss regardless of
// direction, so a Short dragged DOWN produced a stop BELOW entry (should be above) and,
// via btComputeTpFromRatio()'s own Math.abs, a TP also below entry (should be above the
// stop, below entry is right for TP on a short -- but the stop being below entry too is
// what broke it: BacktestController::placeOrder() lines 550-558 reject exactly this
// shape with "For a Short, stop loss must be above entry."). Same defect in the live
// drag preview (mirrored the saved-drawing path exactly, since v3.21.12 made both call
// the same merge helper). Long was never affected -- dragging down already put the stop
// below entry, which happens to be correct for a Long.
//
// No real tick-size concept exists anywhere in this app -- prices span 0.0044 to 71,968
// on this account alone (CLAUDE.md's v3.14.5 note) -- so "1 tick" from the ticket's own
// instruction is interpreted as 0.01% of entry, the same relative-tolerance approach
// this codebase already uses everywhere a fixed absolute epsilon would be wrong by
// orders of magnitude across that range (e.g. btSnapPrice()'s own pixel-based cutoff).
// Floored at Number.EPSILON purely so entry=0 (never a real price, but not worth a
// crash) can't make minDist itself zero.
function btPositionMinDist(entry) {
    return Math.max(Math.abs(entry) * 0.0001, Number.EPSILON);
}

/** Clamps `price` to the correct side of `entry` for one handle, at least `minDist` away
 *  -- used while dragging, so a handle that's dragged past entry (or too close to it)
 *  STOPS at the boundary rather than jumping to the opposite side. `wantAbove` says which
 *  side is correct for the handle being clamped (true = must be > entry, false = must be
 *  < entry) -- callers pass the right side for their own handle+direction combination;
 *  this function has no opinion about which handle or which tool it's clamping for. */
function btClampPositionSide(entry, price, wantAbove, minDist) {
    return wantAbove ? Math.max(price, entry + minDist) : Math.min(price, entry - minDist);
}

/** Repairs a position drawing's settings in place so stop_loss/take_profit land on the
 *  correct side of entry for the tool (Long: stop < entry < tp; Short: tp < entry <
 *  stop), each at least btPositionMinDist(entry) away. A stop/TP on the wrong side is
 *  MIRRORED across entry (preserving its original distance from entry, per the ticket's
 *  own "stop = entry ± |entry − stop|"), not clamped to the minimum -- mirroring is for
 *  repairing an already-saved bad drawing (loadBtDrawings(), where there's no "boundary"
 *  the user is dragging toward, just wrong data to fix), whereas the drag-time clamp in
 *  btApplyDrag() uses btClampPositionSide() instead, deliberately, so a live drag stops
 *  at the boundary rather than teleporting the handle to the opposite side mid-drag.
 *  Returns true iff anything was actually changed, so callers (loadBtDrawings()) only
 *  issue a save when a repair genuinely happened. */
function btNormalizePositionSides(tool, s) {
    const entry = s.entry;
    const isLong = tool === 'position_long';
    const minDist = btPositionMinDist(entry);
    let changed = false;

    const stopWrongSide = isLong ? (s.stop_loss >= entry) : (s.stop_loss <= entry);
    if (stopWrongSide) {
        const mirrored = isLong ? entry - Math.abs(entry - s.stop_loss) : entry + Math.abs(entry - s.stop_loss);
        s.stop_loss = mirrored;
        changed = true;
    }
    if (Math.abs(entry - s.stop_loss) < minDist) {
        s.stop_loss = isLong ? entry - minDist : entry + minDist;
        changed = true;
    }

    const tpWrongSide = isLong ? (s.take_profit <= entry) : (s.take_profit >= entry);
    if (tpWrongSide) {
        const mirrored = isLong ? entry + Math.abs(entry - s.take_profit) : entry - Math.abs(entry - s.take_profit);
        s.take_profit = mirrored;
        changed = true;
    }
    if (Math.abs(entry - s.take_profit) < minDist) {
        s.take_profit = isLong ? entry + minDist : entry - minDist;
        changed = true;
    }

    return changed;
}

// v3.21.1 — a real trader drags a position tool mostly VERTICALLY (the whole point is
// setting price levels; the horizontal span is incidental) -- verified in an actual
// browser that this collapses points[0].time and points[1].time to the same value,
// which gives the drawn box (and therefore its own hit-test region: left===right, zero
// width) NO area at all to ever be clicked again. This is what "many clicks and drags"
// actually was, and is the same underlying defect that made a follow-up drag attempt
// land on a near-zero-size box, producing the reported entry===take_profit/R:R=0 case.
// The box's horizontal span is now always this fixed number of bars from the entry
// point, completely independent of how far sideways the drag happened to go.
const BT_POSITION_TOOL_SPAN_BARS = 20;

async function btFinalizeNewDrawing(tool, points) {
    // v3.21.12 — merged with this user's saved per-tool default (btMergedToolDefaults()),
    // not the code default alone, so a customised fib (or any future opted-in tool)
    // starts from what the trader actually saved, matching the TradingView behaviour the
    // ticket named. Falls back to the plain code default when nothing's been saved.
    const settings = btMergedToolDefaults(tool);
    if (tool === 'position_long' || tool === 'position_short') {
        settings.entry = points[0].price;
        // v3.21.13 — the drag end sets the stop DISTANCE, never its side: the stop
        // always lands on the correct side for the tool (below entry for a Long, above
        // for a Short) regardless of which way the user actually dragged. Previously
        // this took points[1].price as the stop verbatim, so dragging a Short DOWN (the
        // natural gesture, same as a Long) put the stop below entry — wrong for a Short,
        // and rejected outright by BacktestController::placeOrder()'s own direction
        // check ("For a Short, stop loss must be above entry.").
        const isLong = tool === 'position_long';
        const minDist = btPositionMinDist(settings.entry);
        const stopDist = Math.max(Math.abs(points[1].price - points[0].price), minDist);
        settings.stop_loss = isLong ? settings.entry - stopDist : settings.entry + stopDist;
        settings.take_profit = btComputeTpFromRatio(tool, settings.entry, settings.stop_loss, settings.rr_ratio);
        const spanMs = (backtestStepMsFor(chartState.timeframe) || 3600000) * BT_POSITION_TOOL_SPAN_BARS;
        points = [{ time: points[0].time }, { time: points[0].time + spanMs / 1000 }];
    }
    const drawing = await btSaveNewDrawing(tool, points, settings);
    btActiveTool = null;
    setBtActiveToolButton();
    if (drawing) btSelectedDrawingId = drawing.id;
    btScheduleRedraw();
}

/** v3.22.1 — "Place trade" (the selection toolbar's own primary button, Part B1) now
 *  OPENS THE TICKET instead of submitting directly — one-click submit with no
 *  confirmation is exactly the behavior this whole release replaces. The drawing itself
 *  is left untouched here; it's neither deleted nor yet linked to anything (that's
 *  v3.22.3's linked_trade_id). Market-vs-Limit default (entry within 0.05% of the
 *  current close) is computed inside js/backtest.js::btOpenTicket() itself from
 *  whatever entry this drawing already has — not duplicated here. */
function btOpenTicketFromDrawing(d) {
    if (!btSession || btSession.status !== 'active') { toast('Session is not active.', 'error'); return; }
    btOpenTicket({
        sourceDrawingId: d.id,
        direction: d.tool === 'position_long' ? 'Long' : 'Short',
        entry: d.settings.entry,
        stopLoss: d.settings.stop_loss,
        takeProfit: d.settings.take_profit,
    });
}

/**
 * v3.22.1 Part B3 — full-width entry/stop/TP lines for the open order ticket, drawn on
 * THIS SAME overlay canvas (not Lightweight Charts' native createPriceLine()) because
 * native price lines have no drag support at all in this app's pinned chart version —
 * this file's own original v3.21.0 architecture note already made exactly this call for
 * every other drawing tool, for the same reason. Reuses btDrawPill() (Part A) for the
 * near-right-edge pill labels. Entry line colour/style/label switch on order type
 * (orange dashed "Limit {price}" vs. blue solid "Entry {price}"); Stop is always red
 * dashed, TP always green dashed, both labelled with their net-of-fee dollar amount —
 * same riskUsdNet/rewardUsdNet js/backtest.js::btComputeTicket() already computes for
 * the ticket panel itself, so the on-chart pill and the panel's own numbers can never
 * disagree.
 */
function btDrawTicketLines(ctx) {
    if (!btTicket || !btDrawOverlay) return;
    const c = btComputeTicket();
    const w = btDrawOverlay.width;
    const pillX = Math.max(60, w - 70);

    const drawLine = (price, color, dashed) => {
        const y = btPriceToY(price);
        if (y === null) return null;
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.setLineDash([]);
        return y;
    };

    const entryColor = btTicket.orderType === 'limit' ? '#f59e0b' : '#2962ff';
    const yEntry = drawLine(c.entry, entryColor, btTicket.orderType === 'limit');
    if (yEntry !== null) {
        const label = btTicket.orderType === 'limit' ? `Limit ${fmtPrice5(c.entry)}` : `Entry ${fmtPrice5(c.entry)}`;
        btDrawPill(ctx, pillX, yEntry, label, entryColor);
    }

    const yStop = drawLine(btTicket.stopLoss, '#ef5350', true);
    if (yStop !== null) btDrawPill(ctx, pillX, yStop, `Stop Loss −$${c.riskUsdNet.toFixed(2)}`, '#ef5350');

    if (btTicket.takeProfit !== null) {
        const yTp = drawLine(btTicket.takeProfit, '#26a69a', true);
        if (yTp !== null && c.rewardUsdNet !== null) btDrawPill(ctx, pillX, yTp, `Take Profit +$${c.rewardUsdNet.toFixed(2)}`, '#26a69a');
    }
}

// v3.22.1 Part B1 — the floating selection toolbar's own state. btToolbarOffset is a
// lightweight, non-persisted manual-drag adjustment (see btWirePositionToolbar()'s own
// doc comment for why this doesn't need the settings popover's remembered-position
// treatment) — reset the moment a different drawing becomes selected.
let btToolbarOffset = { dx: 0, dy: 0 };
let btToolbarBuiltForId = null;

/**
 * v3.22.1 Part B1 — replaces the old canvas-drawn "Place Order" button
 * (btDrawPlaceOrderButton(), removed this release) with a real, positioned DOM element:
 * drag handle, colour, settings, Place trade (primary), Lock, Delete, left to right per
 * the briefing. Shown only while a position_long/position_short drawing is selected and
 * nothing else is capturing the gesture (a drag or an open ticket both hide it —
 * showing a clickable toolbar mid-drag would be a confusing, easy-to-mis-click target).
 * Called every redraw (btRenderDrawings()'s own tail call) but only rebuilds its inner
 * HTML when the SELECTED DRAWING actually changes — btToolbarBuiltForId is what makes
 * every other call a cheap reposition-only pass, not a full DOM rebuild every frame.
 */
function btPositionSelectionToolbar() {
    const el = document.getElementById('bt-pos-toolbar');
    if (!el) return;
    const d = btSelectedDrawingId ? btDrawings.find(x => x.id === btSelectedDrawingId) : null;
    const isPosition = d && (d.tool === 'position_long' || d.tool === 'position_short');
    if (!isPosition || btDragState || btTicketDragField || btDrawInProgress) {
        el.style.display = 'none';
        btToolbarBuiltForId = null;
        return;
    }

    if (btToolbarBuiltForId !== d.id) {
        btToolbarOffset = { dx: 0, dy: 0 };
        el.innerHTML = btPositionToolbarHtml(d);
        btWirePositionToolbar(d);
        btToolbarBuiltForId = d.id;
    } else {
        // Same drawing still selected -- just refresh the two bits of toolbar state
        // that can change without the selection itself changing (the lock state via
        // drag, the colour via the settings popover), without losing an in-progress
        // colour-picker interaction (document.activeElement check).
        const lockBtn = el.querySelector('[data-toolbar-lock]');
        if (lockBtn) lockBtn.classList.toggle('active', !!d.settings.rr_locked);
        const colorInput = document.getElementById('bt-pos-toolbar-color');
        if (colorInput && document.activeElement !== colorInput) colorInput.value = d.settings.color || '#26a69a';
    }
    el.style.display = 'flex';

    const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
    if (x1 === null || x2 === null) { el.style.display = 'none'; return; }
    const cx = (x1 + x2) / 2;
    const ys = [btPriceToY(d.settings.entry), btPriceToY(d.settings.stop_loss), btPriceToY(d.settings.take_profit)].filter(y => y !== null);
    const topY = ys.length ? Math.min(...ys) : 0;

    const toolbarW = el.offsetWidth || 180, toolbarH = el.offsetHeight || 32;
    let left = cx - toolbarW / 2 + btToolbarOffset.dx;
    let top = topY - toolbarH - 10 + btToolbarOffset.dy;
    const maxW = btDrawOverlay ? btDrawOverlay.width : 9999;
    left = Math.max(4, Math.min(left, maxW - toolbarW - 4));
    top = Math.max(4, top);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
}

/** Original, hand-drawn glyphs (24x24 viewBox, stroke-based) matching this file's own
 *  existing v3.21.1 toolbar icon set — no tracing of any reference tool's artwork,
 *  same convention that toolbar's own docblock already establishes. */
function btPositionToolbarHtml(d) {
    const locked = !!d.settings.rr_locked;
    return `
        <span class="bt-pos-toolbar-handle" id="bt-pos-toolbar-handle" title="Move toolbar">
            <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
        </span>
        <div class="bt-pos-toolbar-sep"></div>
        <input type="color" id="bt-pos-toolbar-color" value="${d.settings.color || '#26a69a'}" title="Colour">
        <button type="button" id="bt-pos-toolbar-settings" title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4M6.3 17.7l1.4-1.4m8.6-8.6l1.4-1.4"/></svg>
        </button>
        <div class="bt-pos-toolbar-sep"></div>
        <button type="button" class="bt-pos-toolbar-place" id="bt-pos-toolbar-place">Place trade</button>
        <div class="bt-pos-toolbar-sep"></div>
        <button type="button" id="bt-pos-toolbar-lock" data-toolbar-lock class="${locked ? 'active' : ''}" title="Lock R:R ratio">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1"/>${locked ? '<path d="M8 11V7a4 4 0 0 1 8 0v4"/>' : '<path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>'}</svg>
        </button>
        <button type="button" id="bt-pos-toolbar-delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>`;
}

function btWirePositionToolbar(d) {
    const colorInput = document.getElementById('bt-pos-toolbar-color');
    if (colorInput) colorInput.oninput = () => {
        d.settings.color = colorInput.value;
        btUpdateDrawing(d.id, { settings: d.settings });
        btScheduleRedraw();
    };
    const settingsBtn = document.getElementById('bt-pos-toolbar-settings');
    if (settingsBtn) settingsBtn.onclick = (e) => btShowDrawSettingsPopover(d, e.clientX, e.clientY);
    const placeBtn = document.getElementById('bt-pos-toolbar-place');
    if (placeBtn) placeBtn.onclick = () => btOpenTicketFromDrawing(d);
    const lockBtn = document.getElementById('bt-pos-toolbar-lock');
    if (lockBtn) lockBtn.onclick = () => {
        d.settings.rr_locked = !d.settings.rr_locked;
        if (d.settings.rr_locked) d.settings.take_profit = btComputeTpFromRatio(d.tool, d.settings.entry, d.settings.stop_loss, d.settings.rr_ratio);
        btUpdateDrawing(d.id, { settings: d.settings });
        btScheduleRedraw();
    };
    const deleteBtn = document.getElementById('bt-pos-toolbar-delete');
    if (deleteBtn) deleteBtn.onclick = () => btDeleteDrawing(d.id);

    // Drag handle: moves the toolbar only, for as long as THIS drawing stays selected
    // (btToolbarOffset resets in btPositionSelectionToolbar() the moment the selection
    // changes). Deliberately not persisted to localStorage/the server the way the
    // settings popover's own position is (v3.21.4) — a toolbar that only exists while
    // one specific drawing is selected has nothing meaningful to remember the position
    // FOR once that selection ends; this is a same-session convenience, not a
    // preference.
    const handle = document.getElementById('bt-pos-toolbar-handle');
    if (handle) {
        handle.onmousedown = (e) => {
            e.preventDefault(); e.stopPropagation();
            const startX = e.clientX, startY = e.clientY;
            const startOffset = { dx: btToolbarOffset.dx, dy: btToolbarOffset.dy };
            const onMove = (ev) => {
                btToolbarOffset = { dx: startOffset.dx + (ev.clientX - startX), dy: startOffset.dy + (ev.clientY - startY) };
                btPositionSelectionToolbar();
            };
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }
}

// ── HIT-TESTING ────────────────────────────────────────────
const BT_HANDLE_RADIUS = 7;
const BT_LINE_HIT_TOLERANCE = 5;

function btPointToPixel(p) {
    const x = btTimeToX(p.time);
    if (x === null) return null;
    if (p.price === undefined) return { x, y: null };
    const y = btPriceToY(p.price);
    if (y === null) return null;
    return { x, y };
}
function btDistToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function btHitTest(x, y) {
    for (let i = btDrawings.length - 1; i >= 0; i--) {
        const handleIndex = btHitTestOne(btDrawings[i], x, y);
        if (handleIndex !== null) return { drawing: btDrawings[i], handleIndex };
    }
    return null;
}
function btHitTestOne(d, x, y) {
    if (d.tool === 'trend_line' || d.tool === 'fib_retracement') {
        const p1 = btPointToPixel(d.points[0]), p2 = btPointToPixel(d.points[1]);
        if (!p1 || !p2) return null;
        if (Math.hypot(x - p1.x, y - p1.y) <= BT_HANDLE_RADIUS) return 0;
        if (Math.hypot(x - p2.x, y - p2.y) <= BT_HANDLE_RADIUS) return 1;
        if (btDistToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= BT_LINE_HIT_TOLERANCE) return 'move';
        return null;
    }
    if (d.tool === 'horizontal_line' || d.tool === 'horizontal_ray') {
        const py = btPriceToY(d.points[0].price);
        const px = btTimeToX(d.points[0].time);
        if (py === null) return null;
        if (d.tool === 'horizontal_ray' && px !== null && Math.hypot(x - px, y - py) <= BT_HANDLE_RADIUS) return 0;
        if (Math.abs(y - py) <= BT_LINE_HIT_TOLERANCE) return 'move';
        return null;
    }
    if (d.tool === 'position_long' || d.tool === 'position_short') {
        const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
        if (x1 === null || x2 === null) return null;
        const left = Math.min(x1, x2), right = Math.max(x1, x2);
        if (x < left || x > right) return null;
        const yEntry = btPriceToY(d.settings.entry), yStop = btPriceToY(d.settings.stop_loss), yTp = btPriceToY(d.settings.take_profit);
        if (yEntry !== null && Math.abs(y - yEntry) <= BT_LINE_HIT_TOLERANCE) return 'entry';
        if (yStop !== null && Math.abs(y - yStop) <= BT_LINE_HIT_TOLERANCE) return 'stop';
        if (yTp !== null && Math.abs(y - yTp) <= BT_LINE_HIT_TOLERANCE) return 'tp';
        if (yEntry !== null && yStop !== null && yTp !== null) {
            const top = Math.min(yEntry, yStop, yTp), bottom = Math.max(yEntry, yStop, yTp);
            if (y >= top && y <= bottom) return 'move';
        }
        return null;
    }
    return null;
}

// ── RENDERING ──────────────────────────────────────────────
function btRenderDrawings() {
    if (!btDrawOverlay || !btDrawCtx) return;
    btResizeDrawOverlay();
    const ctx = btDrawCtx;
    ctx.clearRect(0, 0, btDrawOverlay.width, btDrawOverlay.height);

    for (const d of btDrawings) btDrawOne(ctx, d, d.id === btSelectedDrawingId, false);

    if (btDrawInProgress) {
        const isPosition = btDrawInProgress.tool === 'position_long' || btDrawInProgress.tool === 'position_short';
        const previewPoints = [btDrawInProgress.points[0], btDrawInProgress.previewPoint];
        // v3.21.12 — same merged (code default + saved user default) settings as
        // btFinalizeNewDrawing() uses, so the preview never shows something different from
        // what actually gets saved a moment later.
        const preview = { tool: btDrawInProgress.tool, points: previewPoints, settings: btMergedToolDefaults(btDrawInProgress.tool) };
        if (isPosition) {
            // Same fixed span used at finalize time (btFinalizeNewDrawing) -- shown live
            // while dragging so the preview never misleadingly renders a near-zero-width
            // box that the saved drawing won't actually have.
            // v3.21.13 — same drag-end-is-a-distance-not-a-side treatment as
            // btFinalizeNewDrawing(), so the preview always matches what actually gets
            // saved a moment later, including for a Short.
            preview.settings.entry = previewPoints[0].price;
            const isLong = preview.tool === 'position_long';
            const minDist = btPositionMinDist(preview.settings.entry);
            const stopDist = Math.max(Math.abs(previewPoints[1].price - previewPoints[0].price), minDist);
            preview.settings.stop_loss = isLong ? preview.settings.entry - stopDist : preview.settings.entry + stopDist;
            preview.settings.take_profit = btComputeTpFromRatio(preview.tool, preview.settings.entry, preview.settings.stop_loss, preview.settings.rr_ratio);
            const spanMs = (backtestStepMsFor(chartState.timeframe) || 3600000) * BT_POSITION_TOOL_SPAN_BARS;
            preview.points = [{ time: previewPoints[0].time }, { time: previewPoints[0].time + spanMs / 1000 }];
        }
        btDrawOne(ctx, preview, false, true);
    }

    // v3.22.1 — the order ticket's own full-width lines (Part B3) and the floating
    // selection toolbar (Part B1) are both real, separate rendering passes: the lines
    // are canvas-drawn (same overlay, same coordinate system as every drawing tool,
    // which is what makes them draggable at all — Lightweight Charts' native
    // createPriceLine() has no drag support), the toolbar is a real DOM element
    // positioned to match. Both no-op immediately when their own state (btTicket /
    // btSelectedDrawingId) is empty, so neither changes anything when the ticket is
    // closed and nothing is selected — the overwhelming common case.
    btDrawTicketLines(ctx);
    btPositionSelectionToolbar();
}
function btDrawOne(ctx, d, selected, isPreview) {
    ctx.save();
    ctx.globalAlpha = isPreview ? 0.65 : 1;
    if (d.tool === 'trend_line') btDrawTrendLine(ctx, d, selected);
    else if (d.tool === 'horizontal_line') btDrawHLine(ctx, d, selected, false);
    else if (d.tool === 'horizontal_ray') btDrawHLine(ctx, d, selected, true);
    else if (d.tool === 'fib_retracement') btDrawFib(ctx, d, selected);
    else if (d.tool === 'position_long' || d.tool === 'position_short') btDrawPosition(ctx, d, selected);
    ctx.restore();
}
function btLineDash(style) { return style === 'dashed' ? [6, 4] : style === 'dotted' ? [1, 3] : []; }
function btDrawHandle(ctx, x, y, color) {
    ctx.beginPath(); ctx.arc(x, y, BT_HANDLE_RADIUS - 2, 0, Math.PI * 2);
    ctx.fillStyle = '#131722'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
}
function btDrawPriceLabel(ctx, x, y, price, color) {
    const label = fmtPrice5(price);
    ctx.font = '11px monospace';
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = color; ctx.fillRect(x + 6, y - 8, w, 16);
    ctx.fillStyle = '#0b1220'; ctx.fillText(label, x + 10, y + 4);
}
/** Extends a two-point line to the canvas edges by projecting along its own slope --
 *  needed for "extend left"/"extend right" on the trend line tool. */
function btExtendLine(p1, p2, extendLeft, extendRight, canvasWidth) {
    let a = p1, b = p2;
    const slope = (p2.y - p1.y) / ((p2.x - p1.x) || 1e-6);
    if (extendLeft) a = { x: 0, y: p1.y + slope * (0 - p1.x) };
    if (extendRight) b = { x: canvasWidth, y: p1.y + slope * (canvasWidth - p1.x) };
    return [a, b];
}

function btDrawTrendLine(ctx, d, selected) {
    const p1 = btPointToPixel(d.points[0]), p2 = btPointToPixel(d.points[1]);
    if (!p1 || !p2) return;
    const s = d.settings;
    const [a, b] = btExtendLine(p1, p2, s.extend_left, s.extend_right, btDrawOverlay.width);
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(btLineDash(s.style));
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    if (s.show_price_label) btDrawPriceLabel(ctx, p2.x, p2.y, d.points[1].price, s.color);
    if (s.show_angle_label) {
        const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI).toFixed(1);
        ctx.fillStyle = s.color; ctx.font = '11px sans-serif';
        ctx.fillText(`${angle}°`, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 6);
    }
    if (selected) { btDrawHandle(ctx, p1.x, p1.y, s.color); btDrawHandle(ctx, p2.x, p2.y, s.color); }
}
function btDrawHLine(ctx, d, selected, isRay) {
    const p = btPointToPixel(d.points[0]);
    if (!p || p.y === null) return;
    const s = d.settings;
    const x1 = isRay ? p.x : 0;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1; ctx.setLineDash(btLineDash(s.style));
    ctx.beginPath(); ctx.moveTo(x1, p.y); ctx.lineTo(btDrawOverlay.width, p.y); ctx.stroke();
    ctx.setLineDash([]);
    btDrawPriceLabel(ctx, btDrawOverlay.width - 66, p.y, d.points[0].price, s.color);
    if (selected) btDrawHandle(ctx, isRay ? p.x : btDrawOverlay.width / 2, p.y, s.color);
}
/** Hex ("#rrggbb") -> "rgba(r,g,b,a)". Fib background shading is the only caller —
 *  every other fill/stroke color in this file is used opaque. */
function btHexToRgba(hex, alpha) {
    const h = (hex || '#787b86').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
}

/** v3.21.2 rewrite. Three defects the ticket reported were all traced to this one
 *  function (or its settings) and are called out inline below:
 *   1. Labels jammed against the price axis -- v3.21.1's own fix anchored them at the
 *      overlay CANVAS's edge, which is wider than the actual chart plot area (Lightweight
 *      Charts reserves real pixel width for the right price scale). Now clamped to
 *      tvChart.priceScale('right').width() before the canvas edge, so a label can never
 *      overlap the axis.
 *   2. Drawn edge-to-edge instead of between anchors -- `extend_right` defaulted true.
 *      Replaced with `extend` ('none'/'right'/'both'), defaulting to 'none'.
 *   3. Settings dialog rebuilt separately (btDrawSettingsHtml) to match the ticket's
 *      TradingView-modelled spec; this function renders every one of those new fields
 *      (trend line, per-level colour, levels format, label position, font size,
 *      background shading). */
function btDrawFib(ctx, d, selected) {
    const p1 = btPointToPixel(d.points[0]), p2 = btPointToPixel(d.points[1]);
    if (!p1 || !p2) return;
    const s = d.settings;
    const price1 = d.points[0].price, price2 = d.points[1].price;
    const anchorLeft = Math.min(p1.x, p2.x), anchorRight = Math.max(p1.x, p2.x);
    const extendRight = s.extend === 'right' || s.extend === 'both';
    const extendLeft = s.extend === 'both';
    const lineLeft = extendLeft ? 0 : anchorLeft;
    const lineRight = extendRight ? btDrawOverlay.width : anchorRight;

    // The real plot-area boundary -- price scale panel width is real pixels the overlay
    // canvas's own bounding box includes but the chart's plot area does not draw into.
    const priceScaleW = (typeof tvChart !== 'undefined' && tvChart) ? (tvChart.priceScale('right').width() || 0) : 0;
    const plotRight = Math.max(anchorLeft, btDrawOverlay.width - priceScaleW);

    if (s.show_trend_line) {
        ctx.strokeStyle = s.trend_color || '#787b86'; ctx.lineWidth = 1;
        ctx.setLineDash(btLineDash(s.trend_style || 'solid'));
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.setLineDash([]);
    }

    // v3.21.5 — 0% conventionally anchors to the SECOND point placed (where the drag
    // ended -- the most recent price extreme, which a retracement measures FROM) and
    // 100% to the FIRST (the origin of the move); Reverse flips this to the opposite
    // pairing. Previously 0% anchored to the FIRST point unconditionally when
    // reverse=false, which is why a low-to-high draw (first click low, second click high)
    // came out "inverted from what the user expects": 0% landed at the low and 100% at
    // the high, the opposite of the standard reading ("price retraced X% down from the
    // recent high"). reverse itself already defaulted to false in the stored settings --
    // the bug was in this formula's own direction, not the checkbox's default value.
    const levelY = level => {
        const ratio = s.reverse ? level.ratio : (1 - level.ratio);
        const price = price1 + (price2 - price1) * ratio;
        return { price, y: btPriceToY(price) };
    };

    if (s.background) {
        const enabled = (s.levels || []).filter(l => l.enabled).slice().sort((a, b) => a.ratio - b.ratio);
        for (let i = 0; i < enabled.length - 1; i++) {
            const a = levelY(enabled[i]), b = levelY(enabled[i + 1]);
            if (a.y === null || b.y === null) continue;
            ctx.fillStyle = btHexToRgba(enabled[i].color, s.background_opacity ?? 0.1);
            ctx.fillRect(lineLeft, Math.min(a.y, b.y), lineRight - lineLeft, Math.abs(b.y - a.y));
        }
    }

    (s.levels || []).forEach(level => {
        if (!level.enabled) return;
        const { price, y } = levelY(level);
        if (y === null) return;

        // v3.21.5 — the level LINE always renders when a level is enabled; Prices/Levels
        // below only ever affect the TEXT label. Previously show_levels also hid the line
        // itself, conflating two different things the ticket explicitly separated:
        // "Levels controls whether the ratio shows, Prices controls whether the price
        // shows, and the two are independent" -- a label toggle, not a line toggle.
        ctx.strokeStyle = level.color; ctx.lineWidth = s.width || 1; ctx.setLineDash(btLineDash(s.style));
        ctx.beginPath(); ctx.moveTo(lineLeft, y); ctx.lineTo(lineRight, y); ctx.stroke();
        ctx.setLineDash([]);

        // Independent truth table, per the ticket: both on -> one combined label with
        // clear spacing (a single fillText call, never two overlapping ones); only Levels
        // -> ratio alone; only Prices -> price alone (previously this branch rendered
        // NOTHING at all, since the whole label was gated on show_prices even when Levels
        // was the one actually on -- "Prices off, Levels on: the label disappears
        // entirely" from the ticket); both off -> no label.
        const ratioText = s.levels_format === 'percent' ? `${(level.ratio * 100).toFixed(1)}%` : `${level.ratio}`;
        const priceText = fmtPrice5(price);
        const showRatio = s.show_levels !== false, showPrice = s.show_prices !== false;
        let label = null;
        if (showRatio && showPrice) label = `${ratioText} — ${priceText}`;
        else if (showRatio) label = ratioText;
        else if (showPrice) label = priceText;

        if (label !== null) {
            ctx.fillStyle = level.color;
            ctx.font = `${s.font_size || 10}px monospace`;
            const vOffset = s.label_v === 'top' ? -6 : s.label_v === 'bottom' ? 12 : 3;
            // v3.21.6 — labels were anchored right at the line's own end and aligned so
            // the text grew back OVER the line (e.g. label_h='right' used textAlign='right'
            // with x near lineRight, putting the text's own body across the last stretch
            // of the line itself -- exactly "0.618 6799.39 sitting on the line" from the
            // ticket). Flipped: the label now starts just PAST the line's end, on the
            // chosen side, and grows AWAY from the line -- textAlign is the opposite of
            // what it was, since growing away from a right-side anchor means left-aligned
            // text, and growing away from a left-side anchor means right-aligned text.
            const gap = 6, edgeMargin = 4;
            const textWidth = ctx.measureText(label).width;
            let x;
            if (s.label_h === 'left') {
                ctx.textAlign = 'right';
                x = Math.max(lineLeft - gap, edgeMargin + textWidth);
            } else {
                ctx.textAlign = 'left';
                x = Math.min(lineRight + gap, plotRight - edgeMargin - textWidth);
            }
            ctx.fillText(label, x, y + vOffset);
        }
    });
    if (selected) { btDrawHandle(ctx, p1.x, p1.y, s.trend_color || '#787b86'); btDrawHandle(ctx, p2.x, p2.y, s.trend_color || '#787b86'); }
}
/** Rounded-rect path, used by btDrawPill() below and nowhere else — a small, self-
 *  contained helper rather than relying on ctx.roundRect() (Chrome 99+ only; this app
 *  makes no assumption about a specific minimum Chrome version elsewhere, so a manual
 *  arcTo-based path is the safer default). */
function btRoundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
/** v3.22.1 — the pill label primitive Part A's Stop/Centre/Target labels and Part B3's
 *  ticket-line labels both use: a filled, rounded rectangle centred at (cx, cy), white
 *  text, one line or several (stacked, fixed line height). Returns the drawn rect so a
 *  caller can hit-test against it later if needed (not currently used for that, but
 *  kept for parity with btDrawPlaceOrderButton()'s old _placeOrderBtnRect pattern). */
function btDrawPill(ctx, cx, cy, lines, bgColor) {
    const arr = Array.isArray(lines) ? lines : [lines];
    ctx.font = '11px monospace';
    const lineH = 14, padX = 8, padY = 5;
    const textW = Math.max(...arr.map(l => ctx.measureText(l).width));
    const w = textW + padX * 2, h = arr.length * lineH + padY * 2 - 2;
    const x = cx - w / 2, y = cy - h / 2;
    btRoundRectPath(ctx, x, y, w, h, Math.min(5, h / 2));
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    arr.forEach((l, i) => ctx.fillText(l, cx, y + padY + lineH * (i + 1) - 3));
    ctx.textAlign = 'left';
    return { x, y, w, h };
}

/**
 * v3.22.1 rewrite — Part A of the order-ticket briefing. Replaces the old plain
 * monospace text block (Entry/SL TP/R:R/Risk/Size stacked to the right of the box) with
 * three pill labels: Stop (red, on the stop edge, outside the box), Centre (on the
 * entry line — neutral grey until a real trade is linked, v3.22.3's linked_trade_id;
 * red/teal by floating P&L once it is), Target (teal, on the TP edge, outside the box).
 * All three are centred HORIZONTALLY on the box, per the spec table.
 *
 * Amounts (Stop's risk $, Target's reward $) are net of the round-trip fee — entry fee
 * plus the exit fee AT THAT LEVEL'S OWN PRICE (the stop's exit fee for the Stop pill's
 * Amount, the target's own exit fee for the Target pill's Amount; these differ slightly
 * since fee is charged on fill price, not a single shared number) — same formula
 * js/backtest.js's own btComputeTicket() uses for riskUsdNet/rewardUsdNet, so a drawing's
 * own preview pills and the eventual order ticket never disagree about what "Amount"
 * means. Sizing itself still comes from the session's flat risk_pct (btSession.risk_pct)
 * — a plain drawing has no leverage/risk chosen yet; that only exists once "Place trade"
 * opens the real ticket (v3.22.1 Part B), which is free to size differently.
 */
function btDrawPosition(ctx, d, selected) {
    const s = d.settings;
    const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
    if (x1 === null || x2 === null) return;
    const left = Math.min(x1, x2), right = Math.max(x1, x2);
    const cx = (left + right) / 2;
    const yEntry = btPriceToY(s.entry), yStop = btPriceToY(s.stop_loss), yTp = btPriceToY(s.take_profit);
    if (yEntry === null || yStop === null || yTp === null) return;

    // v3.21.13 — the red (entry↔stop) and teal (entry↔TP) fills already share the same
    // 0.18 alpha; no change needed here. What made a broken Short look "pale greyish-red
    // instead of solid red" was never the alpha — it was the two zones OVERLAPPING (stop
    // and TP both below entry), so the fills painted on top of each other. Once the
    // geometry fix above keeps stop and TP on opposite sides of entry, these two
    // non-overlapping fillRect calls render as solid colour on their own, unchanged.
    ctx.fillStyle = 'rgba(239,83,80,0.18)';
    ctx.fillRect(left, Math.min(yEntry, yStop), right - left, Math.abs(yStop - yEntry));
    ctx.fillStyle = 'rgba(38,166,154,0.18)';
    ctx.fillRect(left, Math.min(yEntry, yTp), right - left, Math.abs(yTp - yEntry));

    const line = (y, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); };
    line(yEntry, '#d1d4dc'); line(yStop, '#ef5350'); line(yTp, '#26a69a');

    const equity = btSession ? btSession.equity : 0;
    const riskPct = btSession ? btSession.risk_pct : 1;
    const feeRatePct = btSession ? btSession.fee_rate_pct : 0;
    const grossRiskUsd = equity * riskPct / 100;
    const stopDist = Math.abs(s.entry - s.stop_loss);
    const tpDist = Math.abs(s.take_profit - s.entry);
    const size = stopDist > 0 ? grossRiskUsd / stopDist : 0;
    const entryFee = (typeof btCalcFee === 'function') ? btCalcFee(size, s.entry, feeRatePct) : 0;
    const exitFeeAtStop = (typeof btCalcFee === 'function') ? btCalcFee(size, s.stop_loss, feeRatePct) : 0;
    const exitFeeAtTp = (typeof btCalcFee === 'function') ? btCalcFee(size, s.take_profit, feeRatePct) : 0;
    const riskUsdNet = grossRiskUsd + entryFee + exitFeeAtStop;
    const rewardUsdNet = tpDist * size - (entryFee + exitFeeAtTp);
    const rr = stopDist > 0 ? (tpDist / stopDist).toFixed(2) : '—';
    const stopPct = s.entry !== 0 ? (stopDist / Math.abs(s.entry) * 100).toFixed(2) : '0.00';
    const tpPct = s.entry !== 0 ? (tpDist / Math.abs(s.entry) * 100).toFixed(2) : '0.00';

    // "Outside the box" — offset further away from entry than the level itself, on
    // whichever side of entry that level already sits (works for both Long and Short
    // without a direction branch: the sign of (yLevel - yEntry) already encodes which
    // way is "away").
    const stopPillY = yStop + Math.sign(yStop - yEntry || 1) * 16;
    const tpPillY = yTp + Math.sign(yTp - yEntry || -1) * 16;
    btDrawPill(ctx, cx, stopPillY, `Stop: ${fmtPrice5(s.stop_loss)}, ${stopDist.toFixed(2)} pts (${stopPct}%), Amount: $${riskUsdNet.toFixed(2)}`, '#ef5350');
    btDrawPill(ctx, cx, tpPillY, `Target: ${fmtPrice5(s.take_profit)}, ${tpDist.toFixed(2)} pts (${tpPct}%), Amount: $${rewardUsdNet.toFixed(2)}`, '#26a69a');
    // Centre pill: neutral grey until a real trade is linked (v3.22.3's
    // linked_trade_id) — d._linkedTrade doesn't exist yet in this release, so this
    // always takes the neutral branch today; the floating-P&L branch is wired in
    // structurally now so v3.22.3 only has to set d._linkedTrade, not touch this
    // function again.
    const linked = d._linkedTrade || null;
    const centreColor = !linked ? '#4b5563' : (linked.floating_pnl < 0 ? '#ef5350' : '#26a69a');
    const centreLines = linked
        ? [`Open P&L: ${linked.floating_pnl >= 0 ? '+' : ''}${fmt(linked.floating_pnl)}, Qty: ${linked.lot_size}`, `Entry: ${fmtPrice5(s.entry)}, RR 1:${rr}`]
        : [`Entry: ${fmtPrice5(s.entry)}, RR 1:${rr}${s.rr_locked ? ' (locked)' : ''}`];
    btDrawPill(ctx, cx, yEntry, centreLines, centreColor);

    if (selected) {
        btDrawHandle(ctx, left, yEntry, '#d1d4dc');
        btDrawHandle(ctx, left, yStop, '#ef5350');
        btDrawHandle(ctx, left, yTp, '#26a69a');
        // x-axis time pills — the box's own start/end times, small blue pills, shown
        // only while selected (per the spec's own "when the tool is selected").
        // HH:MM is deliberately compact -- there's no room for a full date on the
        // time axis, and the date itself is already visible via the chart's own
        // crosshair/legend elsewhere.
        const axisY = ctx.canvas.height - 10;
        ctx.font = '10px monospace';
        const fmtAxisTime = t => new Date(t * 1000).toISOString().slice(11, 16);
        if (x1 !== null) btDrawPill(ctx, x1, axisY, fmtAxisTime(d.points[0].time), '#2962ff');
        if (x2 !== null) btDrawPill(ctx, x2, axisY, fmtAxisTime(d.points[1].time), '#2962ff');
    }
}

// ── SETTINGS POPOVER (right-click, or double-click, on a drawing) ──
// v3.21.4 — the settings panel is now a floating, draggable window instead of a fixed-
// position popover. "Remembered position" only ever means a position the user actually
// dragged it to (persisted to localStorage so it survives a reload); until that happens,
// every open computes a fresh default beside whichever drawing was clicked, per the
// ticket's own "don't cover the tool being edited by default" requirement. Once dragged,
// that choice sticks for every future drawing's settings too, same as most desktop apps
// remembering a dialog's last position regardless of what triggered it. Documented here
// as the resolution to what would otherwise be two competing requirements.
const BT_DRAW_POPOVER_POS_KEY = 'fc_bt_draw_popover_pos';
let btDrawPopoverPos = undefined; // undefined = not loaded yet; null = loaded, none saved

function btLoadPopoverPos() {
    if (btDrawPopoverPos !== undefined) return btDrawPopoverPos;
    btDrawPopoverPos = null;
    try {
        const raw = localStorage.getItem(BT_DRAW_POPOVER_POS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.left === 'number' && typeof parsed.top === 'number') btDrawPopoverPos = parsed;
        }
    } catch (e) { /* localStorage unavailable or corrupt value -- fall back to computing a default */ }
    return btDrawPopoverPos;
}
function btSavePopoverPos(left, top) {
    btDrawPopoverPos = { left, top };
    try { localStorage.setItem(BT_DRAW_POPOVER_POS_KEY, JSON.stringify(btDrawPopoverPos)); } catch (e) { /* ignore -- position just won't persist across reloads */ }
}

function btShowDrawSettingsPopover(d, clientX, clientY) {
    let pop = document.getElementById('bt-draw-settings-popover');
    if (!pop) {
        pop = document.createElement('div');
        pop.id = 'bt-draw-settings-popover';
        pop.className = 'bt-draw-popover';
        document.body.appendChild(pop);
    }
    pop.innerHTML = btDrawSettingsHtml(d);
    // Measure the ACTUAL rendered size before placing it on screen -- the previous
    // version clamped against a guessed ~300px height, which was already wrong for the
    // fib settings dialog (v3.21.2, easily 500+px of real content) and is exactly what
    // "opens pinned low, gets clipped by the viewport" was describing. Positioned
    // off-screen for one synchronous layout pass so nothing visibly jumps.
    pop.style.left = '-9999px'; pop.style.top = '-9999px'; pop.style.display = 'flex';
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const margin = 8;

    const remembered = btLoadPopoverPos();
    let left, top;
    if (remembered) {
        left = remembered.left;
        top = remembered.top;
    } else {
        // Beside the drawing, not on top of it: open to the right of the click point with
        // a small gap, or to the left if there isn't room on the right.
        const overlayRect = btDrawOverlay ? btDrawOverlay.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const anchorX = clientX !== undefined ? clientX : overlayRect.left + overlayRect.width / 2;
        const anchorY = clientY !== undefined ? clientY : overlayRect.top + overlayRect.height / 2;
        const gap = 16;
        left = (anchorX + gap + w <= window.innerWidth - margin) ? anchorX + gap : anchorX - gap - w;
        top = anchorY - h / 2;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    btWireDrawSettingsPopover(d);
    btWireDrawPopoverDrag(pop);
}
/** Drag-by-header, clamped to the viewport on every move (not just at drop) so the panel
 *  can never be dragged fully or partly off-screen. The final position is only persisted
 *  on mouseup, not on every move, to avoid hammering localStorage mid-drag. */
function btWireDrawPopoverDrag(pop) {
    const header = document.getElementById('bt-draw-popover-header');
    if (!header) return;
    header.onmousedown = (e) => {
        if (e.target.closest('#bt-draw-popover-close-x')) return;
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const startRect = pop.getBoundingClientRect();
        const w = startRect.width, h = startRect.height, margin = 8;
        const onMove = (ev) => {
            const left = Math.max(margin, Math.min(startRect.left + (ev.clientX - startX), window.innerWidth - w - margin));
            const top = Math.max(margin, Math.min(startRect.top + (ev.clientY - startY), window.innerHeight - h - margin));
            pop.style.left = left + 'px';
            pop.style.top = top + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const finalRect = pop.getBoundingClientRect();
            btSavePopoverPos(finalRect.left, finalRect.top);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };
    const closeBtn = document.getElementById('bt-draw-popover-close-x');
    if (closeBtn) closeBtn.onclick = () => btHideDrawSettingsPopover();
}
function btHideDrawSettingsPopover() {
    const pop = document.getElementById('bt-draw-settings-popover');
    if (pop) pop.style.display = 'none';
}
function btStyleSelect(field, current) {
    return `<select data-field="${field}">
        <option value="solid" ${current === 'solid' ? 'selected' : ''}>Solid</option>
        <option value="dashed" ${current === 'dashed' ? 'selected' : ''}>Dashed</option>
        <option value="dotted" ${current === 'dotted' ? 'selected' : ''}>Dotted</option>
    </select>`;
}
function btDrawSettingsHtml(d) {
    const s = d.settings;
    const isLine = d.tool === 'trend_line' || d.tool === 'horizontal_line' || d.tool === 'horizontal_ray';
    const colorWidthStyle = (d.tool !== 'position_long' && d.tool !== 'position_short' && d.tool !== 'fib_retracement') ? `
        <label>Colour <input type="color" data-field="color" value="${s.color || '#2962ff'}"></label>
        ${isLine ? `<label>Width <input type="number" data-field="width" value="${s.width || 1}" min="1" max="6"></label>
        <label>Style ${btStyleSelect('style', s.style)}</label>` : ''}` : '';

    let extra = '';
    if (d.tool === 'trend_line') {
        extra = `
            <label><input type="checkbox" data-field="extend_left" ${s.extend_left ? 'checked' : ''}> Extend left</label>
            <label><input type="checkbox" data-field="extend_right" ${s.extend_right ? 'checked' : ''}> Extend right</label>
            <label><input type="checkbox" data-field="show_price_label" ${s.show_price_label ? 'checked' : ''}> Price label</label>
            <label><input type="checkbox" data-field="show_angle_label" ${s.show_angle_label ? 'checked' : ''}> Angle label</label>`;
    } else if (d.tool === 'fib_retracement') {
        // v3.21.2 — modelled directly on the TradingView reference the ticket compared
        // against: trend line (its own colour/style, independent of the level lines),
        // levels line width/style, an Extend mode (replacing the old extend_right
        // boolean), Prices/Levels/format/label-position/font-size toggles, background
        // shading with its own opacity, Reverse, then the full per-level checkbox+colour
        // list (only the ticket's named six checked by default; the rest available).
        extra = `
            <label><input type="checkbox" data-field="show_trend_line" ${s.show_trend_line ? 'checked' : ''}> Trend line</label>
            <label>Trend colour <input type="color" data-field="trend_color" value="${s.trend_color || '#787b86'}"></label>
            <label>Trend style ${btStyleSelect('trend_style', s.trend_style || 'solid')}</label>
            <label>Levels width <input type="number" data-field="width" value="${s.width || 1}" min="1" max="6"></label>
            <label>Levels style ${btStyleSelect('style', s.style || 'solid')}</label>
            <label>Extend <select data-field="extend">
                <option value="none" ${(!s.extend || s.extend === 'none') ? 'selected' : ''}>Don't extend</option>
                <option value="right" ${s.extend === 'right' ? 'selected' : ''}>Extend right</option>
                <option value="both" ${s.extend === 'both' ? 'selected' : ''}>Extend both</option>
            </select></label>
            <label><input type="checkbox" data-field="show_prices" ${s.show_prices !== false ? 'checked' : ''}> Prices</label>
            <label><input type="checkbox" data-field="show_levels" ${s.show_levels !== false ? 'checked' : ''}> Levels</label>
            <label>Levels format <select data-field="levels_format">
                <option value="value" ${s.levels_format !== 'percent' ? 'selected' : ''}>Values</option>
                <option value="percent" ${s.levels_format === 'percent' ? 'selected' : ''}>Percent</option>
            </select></label>
            <label>Label side <select data-field="label_h">
                <option value="right" ${s.label_h !== 'left' ? 'selected' : ''}>Right</option>
                <option value="left" ${s.label_h === 'left' ? 'selected' : ''}>Left</option>
            </select></label>
            <label>Label position <select data-field="label_v">
                <option value="top" ${s.label_v === 'top' ? 'selected' : ''}>Top</option>
                <option value="middle" ${(!s.label_v || s.label_v === 'middle') ? 'selected' : ''}>Middle</option>
                <option value="bottom" ${s.label_v === 'bottom' ? 'selected' : ''}>Bottom</option>
            </select></label>
            <label>Font size <input type="number" data-field="font_size" value="${s.font_size || 10}" min="8" max="20"></label>
            <label><input type="checkbox" data-field="background" ${s.background ? 'checked' : ''}> Background</label>
            <label>Opacity <input type="range" data-field="background_opacity" value="${s.background_opacity ?? 0.1}" min="0" max="1" step="0.05"></label>
            <label><input type="checkbox" data-field="reverse" ${s.reverse ? 'checked' : ''}> Reverse</label>
            <div class="bt-fib-levels">${(s.levels || []).map((l, i) => `
                <label><input type="checkbox" data-level="${i}" data-field="enabled" ${l.enabled ? 'checked' : ''}> ${l.ratio}
                <input type="color" data-level="${i}" data-field="color" value="${l.color}"></label>`).join('')}</div>`;
    } else if (d.tool === 'position_long' || d.tool === 'position_short') {
        extra = `
            <label>R:R ratio <input type="number" data-field="rr_ratio" value="${s.rr_ratio}" min="0.1" step="0.1"></label>
            <label><input type="checkbox" data-field="rr_locked" ${s.rr_locked ? 'checked' : ''}> Lock ratio</label>`;
    }
    return `<div class="bt-draw-popover-header" id="bt-draw-popover-header">
            <span class="bt-draw-popover-header-title">${escapeHtml(d.tool.replace(/_/g, ' '))}</span>
            <button type="button" id="bt-draw-popover-close-x" class="bt-draw-popover-close-x" title="Close">✕</button>
        </div>
        <div class="bt-draw-popover-body">
            ${btTemplateRowHtml(d.tool)}
            ${colorWidthStyle}${extra}
            <div class="bt-draw-popover-actions">
                <button type="button" id="bt-draw-delete-btn" class="btn btn-ghost btn-sm">Delete</button>
                <button type="button" id="bt-draw-close-btn" class="btn btn-primary btn-sm">Done</button>
            </div>
        </div>`;
}
/** "Save as default"/"Reset to default" row — only for tools in BT_TEMPLATE_TOOLS (fib
 *  only this release). Generic by tool so opting another tool in later is a one-line
 *  change to that list, not new HTML/wiring. */
function btTemplateRowHtml(tool) {
    if (!BT_TEMPLATE_TOOLS.includes(tool)) return '';
    return `<div class="bt-draw-popover-template-row">
        <button type="button" id="bt-draw-save-default-btn" class="btn btn-ghost btn-sm">Save as default</button>
        <button type="button" id="bt-draw-reset-default-btn" class="btn btn-ghost btn-sm">Reset to default</button>
    </div>`;
}
function btWireDrawSettingsPopover(d) {
    const pop = document.getElementById('bt-draw-settings-popover');
    pop.querySelectorAll('[data-field]').forEach(input => {
        // 'input' fires continuously while dragging a range/color control -- "Changes
        // apply live" (the ticket's own settings-dialog requirement) needs that, not just
        // the 'change' event a <select>/checkbox/number field already fires on commit.
        // Both listeners share one handler; re-applying the same value on the trailing
        // 'change' is harmless.
        const handler = () => {
            const value = input.type === 'checkbox' ? input.checked : ((input.type === 'number' || input.type === 'range') ? parseFloat(input.value) : input.value);
            if (input.dataset.level !== undefined) {
                d.settings.levels[+input.dataset.level][input.dataset.field] = value;
            } else {
                d.settings[input.dataset.field] = value;
                if ((input.dataset.field === 'rr_locked' && value) || (input.dataset.field === 'rr_ratio' && d.settings.rr_locked)) {
                    d.settings.take_profit = btComputeTpFromRatio(d.tool, d.settings.entry, d.settings.stop_loss, d.settings.rr_ratio);
                }
            }
            btUpdateDrawing(d.id, { points: d.points, settings: d.settings });
            btScheduleRedraw();
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    });
    document.getElementById('bt-draw-delete-btn').onclick = () => btDeleteDrawing(d.id);
    document.getElementById('bt-draw-close-btn').onclick = () => btHideDrawSettingsPopover();

    // v3.21.12 — only present when btTemplateRowHtml(d.tool) actually rendered the row.
    const saveDefaultBtn = document.getElementById('bt-draw-save-default-btn');
    if (saveDefaultBtn) saveDefaultBtn.onclick = () => btSaveDrawingDefault(d);
    const resetDefaultBtn = document.getElementById('bt-draw-reset-default-btn');
    if (resetDefaultBtn) resetDefaultBtn.onclick = () => btResetDrawingDefault(d.tool);
}
