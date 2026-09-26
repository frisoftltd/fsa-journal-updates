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
    fib_retracement: { color: '#f5a623', width: 1, style: 'solid', extend_right: true, reverse: false, show_price: true,
        levels: [
            { ratio: 0,     enabled: true, color: '#787b86' },
            { ratio: 0.382, enabled: true, color: '#f23645' },
            { ratio: 0.5,   enabled: true, color: '#f5a623' },
            { ratio: 0.618, enabled: true, color: '#4caf50' },
            { ratio: 0.786, enabled: true, color: '#089981' },
            { ratio: 1,     enabled: true, color: '#787b86' },
        ] },
    trend_line:      { color: '#2962ff', width: 2, style: 'solid', extend_left: false, extend_right: false, show_price_label: true, show_angle_label: false },
    horizontal_line: { color: '#2962ff', width: 1, style: 'solid' },
    horizontal_ray:  { color: '#2962ff', width: 1, style: 'solid' },
};

// ── OVERLAY SETUP ──────────────────────────────────────────
function btInitDrawOverlay() {
    const wrap = document.querySelector('.tv-chart-wrap');
    if (!wrap || btDrawOverlay) return;
    btDrawOverlay = document.createElement('canvas');
    btDrawOverlay.id = 'bt-draw-overlay';
    wrap.appendChild(btDrawOverlay);
    btDrawCtx = btDrawOverlay.getContext('2d');

    btDrawOverlay.addEventListener('mousedown', btOnDrawMouseDown);
    btDrawOverlay.addEventListener('mousemove', btOnDrawMouseMove);
    btDrawOverlay.addEventListener('mouseup', btOnDrawMouseUp);
    btDrawOverlay.addEventListener('dblclick', btOnDrawDblClick);
    btDrawOverlay.addEventListener('contextmenu', btOnDrawContextMenu);
    // mousemove on the WRAPPER (not the overlay) still fires regardless of the overlay's
    // own pointer-events state, since pointer-events:none only blocks events targeted AT
    // the overlay itself, not bubbling past it from an ancestor listener -- this is what
    // lets hover-based pointer-events toggling (btUpdateOverlayInteractivity()) work
    // without the overlay permanently blocking the chart's own native pan/zoom/crosshair.
    wrap.addEventListener('mousemove', btUpdateOverlayInteractivity);
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

/** Default state (nothing active, nothing selected): the overlay is transparent to the
 *  mouse so the chart's own native pan/zoom/crosshair work exactly as before this
 *  feature existed. It only captures the mouse when a tool is actively placing
 *  something, or when hovering within hit-test range of an existing drawing's line/
 *  handle -- otherwise every drag-to-pan gesture on the chart would be swallowed by an
 *  always-on-top overlay with nothing on it to interact with. */
function btUpdateOverlayInteractivity(e) {
    if (!btDrawOverlay) return;
    if (btActiveTool || btDrawInProgress || btDragState) {
        btDrawOverlay.style.pointerEvents = 'auto';
        return;
    }
    const rect = btDrawOverlay.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = btHitTest(mx, my);
    btDrawOverlay.style.pointerEvents = hit ? 'auto' : 'none';
}

// ── COORDINATE HELPERS ─────────────────────────────────────
function btTimeToX(time) {
    if (!tvChart) return null;
    const x = tvChart.timeScale().timeToCoordinate(time);
    return (x === null || x === undefined) ? null : x;
}
function btPriceToY(price) {
    if (!tvCandleSeries) return null;
    const y = tvCandleSeries.priceToCoordinate(price);
    return (y === null || y === undefined) ? null : y;
}
function btXToTime(x) {
    if (!tvChart) return null;
    return tvChart.timeScale().coordinateToTime(x);
}
function btYToPrice(y) {
    if (!tvCandleSeries) return null;
    return tvCandleSeries.coordinateToPrice(y);
}

/** Snap a raw price to the nearest OHLC value of the candle at/near the given display-
 *  domain time — "the user anchors wick to wick." Falls back to the raw price if no
 *  candle is close enough (e.g. clicking in empty space past the last bar). */
function btSnapPrice(time, rawPrice) {
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
    let best = candidates[0], bestDist = Math.abs(candidates[0] - rawPrice);
    for (const v of candidates) {
        const d = Math.abs(v - rawPrice);
        if (d < bestDist) { bestDist = d; best = v; }
    }
    return best;
}
function btSnapTimeToCandle(rawTime) {
    if (!chartState.candles.length) return rawTime;
    let nearest = null, nearestDist = Infinity;
    for (const c of chartState.candles) {
        const ct = toDisplaySeconds(c.time, chartState.timezone);
        const dist = Math.abs(ct - rawTime);
        if (dist < nearestDist) { nearestDist = dist; nearest = ct; }
    }
    return nearest === null ? rawTime : nearest;
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
async function btUpdateDrawing(id, patch) {
    const body = { id };
    if (patch.points) body.points = patch.points;
    if (patch.settings) body.settings = patch.settings;
    const res = await btApi('update_backtest_drawing', 'POST', body);
    if (res && res.error) { toast('Could not save changes — ' + res.error, 'error'); return; }
    const d = btDrawings.find(x => x.id === id);
    if (d) { if (patch.points) d.points = patch.points; if (patch.settings) Object.assign(d.settings, patch.settings); }
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
    price = btSnapPrice(time, price);
    return { time, price };
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
                btPlaceOrderFromDrawing(sel);
                return;
            }
        }
    }

    if (btActiveTool) {
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

    // Cursor mode -- select/drag an existing drawing.
    const hit = btHitTest(x, y);
    if (hit) {
        const startPoint = btPixelToPoint(x, y);
        btSelectedDrawingId = hit.drawing.id;
        btDragState = {
            drawingId: hit.drawing.id, handleIndex: hit.handleIndex, startPoint,
            startPoints: JSON.parse(JSON.stringify(hit.drawing.points)),
            startSettings: JSON.parse(JSON.stringify(hit.drawing.settings)),
        };
    } else {
        btSelectedDrawingId = null;
        btHideDrawSettingsPopover();
    }
    btScheduleRedraw();
}

function btOnDrawMouseMove(e) {
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
    if (btDrawInProgress && btDrawInProgress.dragging) {
        const { x, y } = btMousePos(e);
        const pt = btPixelToPoint(x, y) || btDrawInProgress.previewPoint;
        const start = btDrawInProgress.points[0];
        // A mousedown+mouseup with no real drag (a plain accidental click) shouldn't
        // create a zero-size fib/position tool -- cancel instead of saving a degenerate
        // drawing nobody meant to place.
        if (start.time === pt.time && start.price === pt.price) {
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
    if (hit) { btSelectedDrawingId = hit.drawing.id; btShowDrawSettingsPopover(hit.drawing); btScheduleRedraw(); }
}
function btOnDrawContextMenu(e) {
    e.preventDefault();
    const { x, y } = btMousePos(e);
    const hit = btHitTest(x, y);
    if (hit) { btSelectedDrawingId = hit.drawing.id; btShowDrawSettingsPopover(hit.drawing, e.clientX, e.clientY); btScheduleRedraw(); }
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

async function btFinalizeNewDrawing(tool, points) {
    const settings = JSON.parse(JSON.stringify(BT_TOOL_DEFAULTS[tool] || {}));
    if (tool === 'position_long' || tool === 'position_short') {
        settings.entry = points[0].price;
        settings.stop_loss = points[1].price;
        settings.take_profit = btComputeTpFromRatio(tool, settings.entry, settings.stop_loss, settings.rr_ratio);
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
        const preview = { tool: btDrawInProgress.tool, points: [btDrawInProgress.points[0], btDrawInProgress.previewPoint], settings: JSON.parse(JSON.stringify(BT_TOOL_DEFAULTS[btDrawInProgress.tool] || {})) };
        if (preview.tool === 'position_long' || preview.tool === 'position_short') {
            preview.settings.entry = preview.points[0].price;
            preview.settings.stop_loss = preview.points[1].price;
            preview.settings.take_profit = btComputeTpFromRatio(preview.tool, preview.settings.entry, preview.settings.stop_loss, preview.settings.rr_ratio);
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
function btDrawFib(ctx, d, selected) {
    const p1 = btPointToPixel(d.points[0]), p2 = btPointToPixel(d.points[1]);
    if (!p1 || !p2) return;
    const s = d.settings;
    const price1 = d.points[0].price, price2 = d.points[1].price;
    const left = Math.min(p1.x, p2.x);
    const right = s.extend_right ? btDrawOverlay.width : Math.max(p1.x, p2.x);
    (s.levels || []).forEach(level => {
        if (!level.enabled) return;
        const ratio = s.reverse ? (1 - level.ratio) : level.ratio;
        const price = price1 + (price2 - price1) * ratio;
        const y = btPriceToY(price);
        if (y === null) return;
        ctx.strokeStyle = level.color; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        if (s.show_price !== false) {
            ctx.fillStyle = level.color; ctx.font = '10px monospace';
            ctx.fillText(`${level.ratio} — ${fmtPrice5(price)}`, right + 4, y + 3);
        }
    });
    if (selected) { btDrawHandle(ctx, p1.x, p1.y, s.color); btDrawHandle(ctx, p2.x, p2.y, s.color); }
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
function btShowDrawSettingsPopover(d, clientX, clientY) {
    let pop = document.getElementById('bt-draw-settings-popover');
    if (!pop) {
        pop = document.createElement('div');
        pop.id = 'bt-draw-settings-popover';
        pop.className = 'bt-draw-popover';
        document.body.appendChild(pop);
    }
    pop.innerHTML = btDrawSettingsHtml(d);
    pop.style.display = 'block';
    const rect = btDrawOverlay.getBoundingClientRect();
    const left = clientX !== undefined ? clientX : rect.left + rect.width / 2;
    const top = clientY !== undefined ? clientY : rect.top + rect.height / 2;
    // Keep the popover on-screen even when opened near the right/bottom edge of the chart.
    pop.style.left = Math.min(left, window.innerWidth - 260) + 'px';
    pop.style.top = Math.min(top, window.innerHeight - 300) + 'px';
    btWireDrawSettingsPopover(d);
}
function btHideDrawSettingsPopover() {
    const pop = document.getElementById('bt-draw-settings-popover');
    if (pop) pop.style.display = 'none';
}
function btDrawSettingsHtml(d) {
    const s = d.settings;
    const isLine = d.tool === 'trend_line' || d.tool === 'horizontal_line' || d.tool === 'horizontal_ray';
    const colorWidthStyle = (d.tool !== 'position_long' && d.tool !== 'position_short') ? `
        <label>Colour <input type="color" data-field="color" value="${s.color || '#2962ff'}"></label>
        ${isLine ? `<label>Width <input type="number" data-field="width" value="${s.width || 1}" min="1" max="6"></label>
        <label>Style <select data-field="style">
            <option value="solid" ${s.style === 'solid' ? 'selected' : ''}>Solid</option>
            <option value="dashed" ${s.style === 'dashed' ? 'selected' : ''}>Dashed</option>
            <option value="dotted" ${s.style === 'dotted' ? 'selected' : ''}>Dotted</option>
        </select></label>` : ''}` : '';

    let extra = '';
    if (d.tool === 'trend_line') {
        extra = `
            <label><input type="checkbox" data-field="extend_left" ${s.extend_left ? 'checked' : ''}> Extend left</label>
            <label><input type="checkbox" data-field="extend_right" ${s.extend_right ? 'checked' : ''}> Extend right</label>
            <label><input type="checkbox" data-field="show_price_label" ${s.show_price_label ? 'checked' : ''}> Price label</label>
            <label><input type="checkbox" data-field="show_angle_label" ${s.show_angle_label ? 'checked' : ''}> Angle label</label>`;
    } else if (d.tool === 'fib_retracement') {
        extra = `
            <label><input type="checkbox" data-field="extend_right" ${s.extend_right ? 'checked' : ''}> Extend right</label>
            <label><input type="checkbox" data-field="reverse" ${s.reverse ? 'checked' : ''}> Reverse</label>
            <label><input type="checkbox" data-field="show_price" ${s.show_price !== false ? 'checked' : ''}> Show price</label>
            <div class="bt-fib-levels">${(s.levels || []).map((l, i) => `
                <label><input type="checkbox" data-level="${i}" data-field="enabled" ${l.enabled ? 'checked' : ''}> ${l.ratio}
                <input type="color" data-level="${i}" data-field="color" value="${l.color}"></label>`).join('')}</div>`;
    } else if (d.tool === 'position_long' || d.tool === 'position_short') {
        extra = `
            <label>R:R ratio <input type="number" data-field="rr_ratio" value="${s.rr_ratio}" min="0.1" step="0.1"></label>
            <label><input type="checkbox" data-field="rr_locked" ${s.rr_locked ? 'checked' : ''}> Lock ratio</label>`;
    }
    return `<div class="bt-draw-popover-title">${escapeHtml(d.tool.replace(/_/g, ' '))}</div>
        ${colorWidthStyle}${extra}
        <div class="bt-draw-popover-actions">
            <button type="button" id="bt-draw-delete-btn" class="btn btn-ghost btn-sm">Delete</button>
            <button type="button" id="bt-draw-close-btn" class="btn btn-primary btn-sm">Done</button>
        </div>`;
}
function btWireDrawSettingsPopover(d) {
    const pop = document.getElementById('bt-draw-settings-popover');
    pop.querySelectorAll('[data-field]').forEach(input => {
        input.addEventListener('change', () => {
            const value = input.type === 'checkbox' ? input.checked : (input.type === 'number' ? parseFloat(input.value) : input.value);
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
        });
    });
    document.getElementById('bt-draw-delete-btn').onclick = () => btDeleteDrawing(d.id);
    document.getElementById('bt-draw-close-btn').onclick = () => btHideDrawSettingsPopover();
}
