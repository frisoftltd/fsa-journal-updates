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
    if (res && res.error) console.warn('[backtest-drawings] could not load drawings:', res.error);
    btScheduleRedraw();
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
    return !!(btActiveTool || btDrawInProgress || btDragState);
}

function btOnDrawMouseDown(e) {
    if (e.button !== 0) return; // left click only -- right click is contextmenu (settings)
    const { x, y } = btMousePos(e);

    // A click on the position tool's own "Place Order" button, drawn during the last
    // render -- checked before the general hit-test since the button sits on top of
    // (and would otherwise be indistinguishable from) the entry/stop/tp level lines.
    if (btSelectedDrawingId) {
        const sel = btDrawings.find(d => d.id === btSelectedDrawingId);
        if (sel && sel._placeOrderBtnRect) {
            const r = sel._placeOrderBtnRect;
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                e.stopPropagation();
                btPlaceOrderFromDrawing(sel);
                return;
            }
        }
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
        const deltaEntry = newPoint.price - dragState.startSettings.entry;
        d.settings.entry = newPoint.price;
        d.settings.stop_loss = dragState.startSettings.stop_loss + deltaEntry;
        d.settings.take_profit = d.settings.rr_locked
            ? btComputeTpFromRatio(d.tool, d.settings.entry, d.settings.stop_loss, d.settings.rr_ratio)
            : dragState.startSettings.take_profit + deltaEntry;
    } else if (dragState.handleIndex === 'stop') {
        d.settings.stop_loss = newPoint.price;
        if (d.settings.rr_locked) {
            d.settings.take_profit = btComputeTpFromRatio(d.tool, d.settings.entry, d.settings.stop_loss, d.settings.rr_ratio);
        }
    } else if (dragState.handleIndex === 'tp') {
        d.settings.take_profit = newPoint.price;
        d.settings.rr_locked = false;
        const dist = Math.abs(d.settings.entry - d.settings.stop_loss);
        d.settings.rr_ratio = dist > 0 ? +(Math.abs(d.settings.take_profit - d.settings.entry) / dist).toFixed(2) : 0;
    }
}

function btComputeTpFromRatio(tool, entry, stop, ratio) {
    const dist = Math.abs(entry - stop);
    return tool === 'position_long' ? entry + dist * ratio : entry - dist * ratio;
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
    const settings = JSON.parse(JSON.stringify(BT_TOOL_DEFAULTS[tool] || {}));
    if (tool === 'position_long' || tool === 'position_short') {
        settings.entry = points[0].price;
        settings.stop_loss = points[1].price;
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

/** Reuses the existing, unchanged backtest_place_order endpoint -- this is what makes
 *  "blocked while the cursor isn't at the latest bar" and "blocked at the daily trade
 *  cap" work for free: both checks already live in BacktestController::placeOrder()
 *  (client_bar_time validation, checkTradeLimits()), and this sends exactly the same
 *  shape of request the manual New Order panel does. Entry at (or within 0.05% of) the
 *  current bar's close submits as a market order; anywhere else submits as a limit order
 *  at the tool's own entry price -- the position tool's entry is draggable to any price,
 *  which only makes sense as "enter here later" once it's away from the current price. */
async function btPlaceOrderFromDrawing(d) {
    if (!btSession || btSession.status !== 'active') { toast('Session is not active.', 'error'); return; }
    const direction = d.tool === 'position_long' ? 'Long' : 'Short';
    const lastCandle = chartState.candles[chartState.candles.length - 1];
    const nearMarket = lastCandle && Math.abs(d.settings.entry - lastCandle.close) / lastCandle.close < 0.0005;
    const payload = {
        session_id: btActiveSessionId,
        client_bar_time: btSession.replay_cursor_ms,
        type: nearMarket ? 'market' : 'limit',
        direction,
        stop_loss: d.settings.stop_loss,
        take_profit: d.settings.take_profit,
    };
    if (!nearMarket) payload.limit_price = d.settings.entry;
    const res = await btApi('backtest_place_order', 'POST', payload);
    if (res && res.error) { toast(res.error, 'error'); return; }
    toast(res.filled ? `Filled @ ${fmtPrice5(res.entry_price)}` : 'Limit order placed');
    // "the tool converts to a live position marker" -- the real trade is now tracked by
    // the replay engine itself; renderOpenPositions() (js/backtest.js) already shows it.
    await btDeleteDrawing(d.id);
    await refreshBtSession();
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
        const preview = { tool: btDrawInProgress.tool, points: previewPoints, settings: JSON.parse(JSON.stringify(BT_TOOL_DEFAULTS[btDrawInProgress.tool] || {})) };
        if (isPosition) {
            // Same fixed span used at finalize time (btFinalizeNewDrawing) -- shown live
            // while dragging so the preview never misleadingly renders a near-zero-width
            // box that the saved drawing won't actually have.
            preview.settings.entry = previewPoints[0].price;
            preview.settings.stop_loss = previewPoints[1].price;
            preview.settings.take_profit = btComputeTpFromRatio(preview.tool, preview.settings.entry, preview.settings.stop_loss, preview.settings.rr_ratio);
            const spanMs = (backtestStepMsFor(chartState.timeframe) || 3600000) * BT_POSITION_TOOL_SPAN_BARS;
            preview.points = [{ time: previewPoints[0].time }, { time: previewPoints[0].time + spanMs / 1000 }];
        }
        btDrawOne(ctx, preview, false, true);
    }
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
function btDrawPosition(ctx, d, selected) {
    const s = d.settings;
    const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
    if (x1 === null || x2 === null) return;
    const left = Math.min(x1, x2), right = Math.max(x1, x2);
    const yEntry = btPriceToY(s.entry), yStop = btPriceToY(s.stop_loss), yTp = btPriceToY(s.take_profit);
    if (yEntry === null || yStop === null || yTp === null) return;

    ctx.fillStyle = 'rgba(239,83,80,0.18)';
    ctx.fillRect(left, Math.min(yEntry, yStop), right - left, Math.abs(yStop - yEntry));
    ctx.fillStyle = 'rgba(38,166,154,0.18)';
    ctx.fillRect(left, Math.min(yEntry, yTp), right - left, Math.abs(yTp - yEntry));

    const line = (y, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); };
    line(yEntry, '#d1d4dc'); line(yStop, '#ef5350'); line(yTp, '#26a69a');

    const equity = btSession ? btSession.equity : 0;
    const riskPct = btSession ? btSession.risk_pct : 1;
    const riskUsd = equity * riskPct / 100;
    const stopDist = Math.abs(s.entry - s.stop_loss);
    const size = stopDist > 0 ? riskUsd / stopDist : 0;
    const rr = stopDist > 0 ? (Math.abs(s.take_profit - s.entry) / stopDist).toFixed(2) : '—';

    ctx.font = '11px monospace'; ctx.fillStyle = '#d1d4dc';
    [
        `Entry ${fmtPrice5(s.entry)}`,
        `SL ${fmtPrice5(s.stop_loss)}  TP ${fmtPrice5(s.take_profit)}`,
        `R:R ${rr}${s.rr_locked ? ' (locked)' : ''}`,
        `Risk $${riskUsd.toFixed(2)} (${riskPct}%)`,
        `Size ${size.toFixed(4)}`,
    ].forEach((line2, i) => ctx.fillText(line2, right + 6, yEntry - 20 + i * 13));

    if (selected) {
        btDrawHandle(ctx, left, yEntry, '#d1d4dc');
        btDrawHandle(ctx, left, yStop, '#ef5350');
        btDrawHandle(ctx, left, yTp, '#26a69a');
        btDrawPlaceOrderButton(ctx, d, left, yEntry);
    } else {
        d._placeOrderBtnRect = null;
    }
}
function btDrawPlaceOrderButton(ctx, d, left, yEntry) {
    const w = 90, h = 22, x = left + 4, y = yEntry + 10;
    d._placeOrderBtnRect = { x, y, w, h };
    ctx.fillStyle = d.tool === 'position_long' ? '#26a69a' : '#ef5350';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(d.tool === 'position_long' ? 'Place Long' : 'Place Short', x + w / 2, y + h / 2 + 4);
    ctx.textAlign = 'left';
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
            ${colorWidthStyle}${extra}
            <div class="bt-draw-popover-actions">
                <button type="button" id="bt-draw-delete-btn" class="btn btn-ghost btn-sm">Delete</button>
                <button type="button" id="bt-draw-close-btn" class="btn btn-primary btn-sm">Done</button>
            </div>
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
}
