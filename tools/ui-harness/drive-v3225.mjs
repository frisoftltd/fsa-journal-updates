/**
 * FundedControl v3.22.5 UI harness driver -- "In-trade view and position-tool handling."
 * Runs the briefing's own 7-item verify checklist against the STATEFUL mock sessions
 * v3.22.3's drive-v3223.mjs already established (20/21/22, stubs/api.php) -- that driver
 * and session 6's drive.mjs are both left completely untouched; this file only adds new
 * scenarios on top of the same mock, reusing session 20 end-to-end so a single open
 * position can carry through Fixes A/B/C/E/F without re-placing a trade for each.
 *
 * Usage: node drive-v3225.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3225');
fs.mkdirSync(OUT_DIR, { recursive: true });

let shotN = 0;
async function shot(page, name) {
    shotN += 1;
    const file = path.join(OUT_DIR, `${String(shotN).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  [screenshot] ${file}`);
}

const failures = [];
function assert(cond, msg) {
    if (cond) { console.log(`  PASS: ${msg}`); }
    else { console.log(`  FAIL: ${msg}`); failures.push(msg); }
}

async function openSession(page, id) {
    await page.evaluate((sid) => openBacktestSession(sid), id);
    await page.waitForFunction(() => typeof btSession !== 'undefined' && btSession && btSession.status === 'active');
    await page.waitForFunction(() => typeof chartState !== 'undefined' && chartState.candles.length > 0);
}

// v3.22.5 — waits for each advance's own round trip before firing the next click.
// Without this, two clicks fired faster than a single advance's async chain resolves can
// race (confirmed empirically while writing this driver: a plain click+fixed-timeout
// loop silently lost advances under load, landing on the wrong cursor index and breaking
// Fix C's own precisely-engineered scenario below).
async function advanceBars(page, n) {
    for (let i = 0; i < n; i++) {
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_advance')),
            page.click('button[onclick="btAdvance()"]'),
        ]);
        await page.waitForTimeout(40);
    }
}

// v3.22.5 — fillText() interception is how this driver reads canvas-drawn pill TEXT
// (the sign of an R-multiple, the exact "arrow + name + price + amount" pinned-pill
// format) without any DOM text node to query a selector against -- every pill in this
// file is drawn with ctx.fillText(), so patching the one prototype method once, before
// any backtest screen renders, captures every string this app ever draws to any canvas.
async function installFillTextLog(page) {
    await page.evaluate(() => {
        window.__btFillTextLog = [];
        const proto = CanvasRenderingContext2D.prototype;
        if (!proto.__btFillTextPatched) {
            const orig = proto.fillText;
            proto.fillText = function (text, x, y, maxWidth) {
                window.__btFillTextLog.push(text);
                return maxWidth !== undefined ? orig.call(this, text, x, y, maxWidth) : orig.call(this, text, x, y);
            };
            proto.__btFillTextPatched = true;
        }
    });
}
async function clearFillTextLog(page) { await page.evaluate(() => { window.__btFillTextLog = []; }); }
async function getFillTextLog(page) { return page.evaluate(() => window.__btFillTextLog.slice()); }

async function main() {
    console.log('\n[Verify 7] duplicate-name scan across app/js/');
    const { duplicates, parseErrors } = scanDuplicateNames();
    for (const e of parseErrors) { console.log(`  FAIL: ${e.file} failed to parse: ${e.error}`); failures.push(`duplicate-name scan: ${e.file} failed to parse`); }
    if (duplicates.length === 0) {
        console.log('  PASS: no cross-file top-level name duplicates in app/js/');
    } else {
        for (const { name, occurrences } of duplicates) {
            const where = occurrences.map(o => `${o.file}:${o.line}`).join(', ');
            console.log(`  FAIL: "${name}" declared at top level in more than one file (${where})`);
            failures.push(`duplicate-name scan: "${name}" declared in ${occurrences.length} files (${where})`);
        }
    }

    const harness = await setupHarness({ port: 8768 });
    console.log(`Harness up at ${harness.baseUrl} (temp copy: ${harness.tmpDir})`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 760 } });
    page.setDefaultTimeout(15000); // hard cap on every action/wait below -- no open-ended hangs
    page.setDefaultNavigationTimeout(30000); // hard cap on every goto
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });
        await installFillTextLog(page);

        // ════════════════════════════════════════════════════════════════
        // Verify 1 / Fix A — Long with TP far above the loaded range: all three lines
        // visible immediately, no scrolling; the off-screen safety net (pinned pill +
        // click-to-fit) verified directly.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1 / Fix A] Long with a far TP -- all 3 lines visible immediately');
        await openSession(page, 20);
        await shot(page, 'fixA-before-trade');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8400');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        if (!(await page.isChecked('#bt-ticket-tp-on'))) {
            await page.check('#bt-ticket-tp-on');
            await page.dispatchEvent('#bt-ticket-tp-on', 'change');
        }
        // Confirmed on live (the bug this fix exists for): a TP set well above the
        // recently-loaded candles' own range (this mock's own loaded window sits roughly
        // 8400-8900, see mockPriceAtIndex()'s own amplitude) used to scroll off-screen the
        // instant the trade opened.
        await page.fill('#bt-ticket-tp', '9800');
        await page.dispatchEvent('#bt-ticket-tp', 'change');
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        await page.waitForFunction(() => btSession.open_positions.length === 1);
        await page.waitForTimeout(100);
        const levelsVisible = await page.evaluate(() => {
            const p = btSession.open_positions[0];
            const h = document.getElementById('bt-draw-overlay').height;
            const yEntry = btPriceToY(p.entry_price), yStop = btPriceToY(p.stop_loss), yTp = btPriceToY(p.take_profit);
            const within = y => y !== null && y >= 0 && y <= h;
            return { yEntry, yStop, yTp, h, allVisible: within(yEntry) && within(yStop) && within(yTp) };
        });
        assert(levelsVisible.allVisible, `Fix A: entry/SL/far-TP all land inside the visible plot immediately, no scroll needed (${JSON.stringify(levelsVisible)})`);
        await shot(page, 'fixA-after-trade-all-visible');

        console.log('\n[Fix A safety net] pinned edge pill + click-to-fit');
        await clearFillTextLog(page);
        const edgePinResult = await page.evaluate(() => {
            btEdgePinnedPills = [];
            const h = document.getElementById('bt-draw-overlay').height;
            const ctx = document.getElementById('bt-draw-overlay').getContext('2d');
            // Simulate a level whose y has scrolled 500px above the visible plot -- the
            // exact shape a user's own manual price-axis zoom/drag produces.
            const returnedY = btDrawLevelPill(ctx, 100, -500, h, 'Take Profit 7790.00', 'Take Profit', 7790.00, '+$286.19', '#26a69a');
            const pinned = btEdgePinnedPills.length ? btEdgePinnedPills[btEdgePinnedPills.length - 1] : null;
            return { returnedY, pinned };
        });
        const pinnedLog = await getFillTextLog(page);
        assert(edgePinResult.returnedY === 20, `Fix A: an off-screen level is pinned at the top margin (got y=${edgePinResult.returnedY})`);
        assert(edgePinResult.pinned && edgePinResult.pinned.price === 7790.00, `Fix A: the pinned level is registered as a real click target (${JSON.stringify(edgePinResult.pinned)})`);
        assert(pinnedLog.some(t => t.includes('▲') && t.includes('Take Profit') && t.includes('7790.00') && t.includes('+$286.19')),
            `Fix A: pinned-pill text is "arrow + name + price + amount" per the briefing's own example (log: ${JSON.stringify(pinnedLog)})`);
        await shot(page, 'fixA-edge-pinned-pill');

        const fitResult = await page.evaluate((price) => {
            tvCandleSeries.priceScale().applyOptions({ autoScale: false });
            btFitPriceAxisToLevel(price);
            return tvCandleSeries.priceScale().options().autoScale;
        }, 7790.00);
        assert(fitResult === true, 'Fix A: clicking the pinned pill re-enables price-axis auto-scale (the stored range already includes every registered level)');

        // ════════════════════════════════════════════════════════════════
        // Verify 2 / Fix B — SUPERSEDED by v3.22.7: the fill-bar-to-cursor box this
        // block tested is gone by design (the linked drawing is the trade's fixed-width
        // box now, never growing) — asserting the old "grows with Next Bar" behavior
        // here would assert something now false on purpose. Updated to check real
        // pixels are present at the LINKED DRAWING's own (fixed) span, and that the
        // width genuinely does NOT change across Next Bar steps — drive-v3227.mjs
        // covers this fully; this just keeps drive-v3225.mjs honest about current
        // behavior rather than silently dropping the assertion.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2 / Fix B] linked drawing is a fixed-width box: real pixels present, width does NOT grow with Next Bar');
        const samplePixel = async () => page.evaluate(() => {
            const p = btSession.open_positions[0];
            const d = btDrawings.find(dw => dw.linked_trade_id === p.id);
            const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
            const yEntry = btPriceToY(p.entry_price), yStop = btPriceToY(p.stop_loss);
            const sx = Math.round((x1 + x2) / 2), sy = Math.round((yEntry + yStop) / 2);
            const ctx = document.getElementById('bt-draw-overlay').getContext('2d');
            const px = ctx.getImageData(sx, sy, 1, 1).data;
            return { width: Math.abs(x2 - x1), sx, sy, r: px[0], g: px[1], b: px[2], a: px[3] };
        });
        const isRedFill = px => px.a > 10 && px.r > 180 && px.g < 150 && px.b < 150;
        await shot(page, 'fixB-before-advance');
        const boxBefore = await samplePixel();
        assert(isRedFill(boxBefore), `Fix B: the linked drawing's own box fill is present between entry/stop, read directly off the canvas (${JSON.stringify(boxBefore)})`);
        await advanceBars(page, 1); // cursor 400 -> 401
        const boxAfterFirst = await samplePixel();
        await shot(page, 'fixB-after-first-advance');
        await advanceBars(page, 1); // cursor 401 -> 402
        const boxAfterSecond = await samplePixel();
        // Sub-pixel tolerance, not exact equality: logicalToCoordinate()'s own bar-
        // spacing math can shift a fixed TIME span by a fraction of a pixel as the
        // visible window scrolls underneath it -- real, but not the "stretches with the
        // candles" bug this checks for (which moved the width by tens of pixels per bar).
        const widthDrift = Math.max(Math.abs(boxAfterFirst.width - boxBefore.width), Math.abs(boxAfterSecond.width - boxBefore.width));
        assert(widthDrift < 3, `Fix B (v3.22.7): the box's own on-screen width stays fixed across Next Bar (${boxBefore.width} -> ${boxAfterFirst.width} -> ${boxAfterSecond.width}, drift ${widthDrift}px)`);
        assert(isRedFill(boxAfterSecond), `Fix B: box fill pixel is still present after advancing (${JSON.stringify(boxAfterSecond)})`);
        await shot(page, 'fixB-after-second-advance-box-fixed-width');

        // ════════════════════════════════════════════════════════════════
        // Verify 3 / Fix C — a small POSITIVE gross price move whose fee-adjusted P&L is
        // NEGATIVE must never render a positive or zero-signed R. Engineered against the
        // mock's own deterministic price curve (stubs/api.php::mockPriceAtIndex()): entry
        // is fixed at close(400)=8769.535136 (unrounded), and close(411)=8772.424064 is
        // the nearest index whose gross (+1.4445) sits inside the entry fee (1.7539) --
        // net -0.3094, which even rounds to the EXACT "0.00" shape the live bug's own
        // "+0.00R" report showed (confirmed by hand via `php stubs/api.php 400 415`
        // before writing this, not guessed).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3 / Fix C] a small positive gross move whose net P&L is negative never shows a positive/zero-signed R');
        await advanceBars(page, 9); // cursor 402 -> 411
        await page.waitForTimeout(100);
        await clearFillTextLog(page);
        await page.evaluate(() => { if (typeof btRenderDrawings === 'function') btRenderDrawings(); });
        const pnlLog = await getFillTextLog(page);
        const pnlLine = pnlLog.find(t => t.includes('Open P&L:'));
        const floatingPnl = await page.evaluate(() => btSession.open_positions[0].floating_pnl);
        assert(floatingPnl < 0, `Fix C setup: the engineered scenario produces a negative floating P&L (got ${floatingPnl})`);
        assert(!!pnlLine, `Fix C: the Open P&L pill text was captured off the canvas (full log: ${JSON.stringify(pnlLog)})`);
        assert(pnlLine && !pnlLine.includes('+0.00R') && !pnlLine.includes('(+'), `Fix C: a negative P&L never shows a positive-signed R (got "${pnlLine}")`);
        assert(pnlLine && pnlLine.includes('−'), `Fix C: a negative P&L shows the minus sign on R (got "${pnlLine}")`);
        await shot(page, 'fixC-negative-pnl-negative-r');

        // ════════════════════════════════════════════════════════════════
        // Verify 4 / Fix D — the backtest replay screen hides the live challenge's own
        // STOP banner and shows only this session's own trade count; every other page
        // keeps showing the live banner exactly as before.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4 / Fix D] backtest screen hides the live challenge banner; shows only its own trade count');
        // get_risk_status's real mock always returns {stopped:false} -- patching the one
        // call under test (same standing convention drive-v3223.mjs's own ticket-field
        // monkey-patch already uses) rather than extending the shared mock for one check.
        await page.evaluate(() => {
            window.__realApi = window.api;
            window.api = async (action, ...rest) => {
                if (String(action).startsWith('get_risk_status')) return { stopped: true, reason: 'weekly trade limit reached (4/4)' };
                return window.__realApi(action, ...rest);
            };
        });
        await page.evaluate(() => refreshNewTradeGate());
        await page.waitForTimeout(50);
        const onBacktestScreen = await page.evaluate(() => ({
            text: document.getElementById('topbar-trade-btn').textContent,
            bodyHasClass: document.body.classList.contains('backtest-active'),
            tradesStrip: document.getElementById('bt-strip-trades').textContent,
        }));
        assert(onBacktestScreen.bodyHasClass, 'Fix D setup: still on the backtest replay screen (body.backtest-active)');
        assert(!onBacktestScreen.text.includes('STOP'), `Fix D: topbar button does NOT show the live challenge's STOP banner on the backtest screen (got "${onBacktestScreen.text}")`);
        assert(onBacktestScreen.tradesStrip.length > 0, `Fix D: header strip shows this session's own trade count instead (got "${onBacktestScreen.tradesStrip}")`);
        await shot(page, 'fixD-backtest-screen-no-banner');

        // Toggling the class directly (rather than the full showBacktestScreen('form') /
        // showPage() navigation) is a deliberate, surgical choice, not a shortcut: Fix D's
        // own mechanism (refreshNewTradeGate(), js/trades.js) keys off exactly this one
        // class, and the full navigation path pulls in setup-form/dashboard data loading
        // this DB-free mock doesn't model at all (unrelated 404s/errors from endpoints
        // like get_symbols/get_pairs) -- this is the same "test the mechanism directly"
        // choice drive-v3223.mjs already makes for the ticket's own field updates.
        await page.evaluate(() => document.body.classList.remove('backtest-active'));
        await page.evaluate(() => refreshNewTradeGate());
        await page.waitForTimeout(50);
        const offBacktestScreen = await page.evaluate(() => ({
            text: document.getElementById('topbar-trade-btn').textContent,
            bodyHasClass: document.body.classList.contains('backtest-active'),
        }));
        assert(!offBacktestScreen.bodyHasClass, 'Fix D: left the backtest replay screen');
        assert(offBacktestScreen.text.includes('STOP'), `Fix D: the SAME stopped state shows the normal STOP banner on every other page (got "${offBacktestScreen.text}")`);
        await shot(page, 'fixD-other-page-shows-banner');

        await page.evaluate(() => { window.api = window.__realApi; document.body.classList.add('backtest-active'); });

        // ════════════════════════════════════════════════════════════════
        // Verify 5 / Fix E — dragging a position tool produces no long task over 16ms;
        // with magnet off, the drag follows the cursor exactly.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 5a / Fix E] dragging a position tool across 50 bars produces no long task over 16ms');
        await page.evaluate(() => {
            window.__btLongTasks = [];
            try {
                const po = new PerformanceObserver(list => { for (const e of list.getEntries()) window.__btLongTasks.push(e.duration); });
                po.observe({ entryTypes: ['longtask'] });
                window.__btLongTaskSupported = true;
            } catch (e) { window.__btLongTaskSupported = false; }
        });
        // v3.22.5 — created near the LEFT edge of the chart (not centred), deliberately:
        // the mouse listeners this whole file's drag machinery relies on are capture-
        // phase on .tv-chart-wrap itself (this file's own original architecture note),
        // so a drag that wanders the cursor PAST that element's own edge stops receiving
        // move/up events entirely (confirmed empirically while writing this test --
        // starting from the box's own centre left no room for a rightward 50-bar drag
        // before running off the chart, which silently orphaned btDragState and lost the
        // selection for every assertion after it). Leaving a wide margin on the right is
        // what the real Fix E behaviour needs room to be exercised against, not a
        // workaround for a bug in the fix itself.
        const chartBox = await page.locator('.tv-chart-wrap').boundingBox();
        await page.click('[data-tool="position_long"]');
        await page.mouse.move(chartBox.x + chartBox.width * 0.08, chartBox.y + chartBox.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(chartBox.x + chartBox.width * 0.08, chartBox.y + chartBox.height * 0.5 + 100, { steps: 5 });
        await page.mouse.up();
        await page.waitForFunction(() => btDrawings.length > 0 && btSelectedDrawingId !== null);
        await shot(page, 'fixE-before-drag');

        // Starts the drag from the box's own CENTRE (time and price both), landing
        // squarely in the "move" hit zone -- not an edge/entry/stop/tp handle, which
        // would drag only one dimension and isn't what "dragging a box" means here.
        const dragSetup = await page.evaluate(() => {
            const d = btDrawings.find(x => x.id === btSelectedDrawingId);
            const stepSec = btStepSec();
            const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
            const centerX = (x1 + x2) / 2;
            const pxPerBar = (btTimeToX(d.points[0].time + 50 * stepSec) - x1) / 50;
            const yEntry = btPriceToY(d.settings.entry), yStop = btPriceToY(d.settings.stop_loss);
            const centerY = (yEntry + yStop) / 2;
            const rect = document.getElementById('bt-draw-overlay').getBoundingClientRect();
            return { centerX, centerY, pxPerBar, rectLeft: rect.left, rectTop: rect.top };
        });
        assert(dragSetup.centerX !== null && dragSetup.pxPerBar !== null && isFinite(dragSetup.pxPerBar), `Fix E setup: the drag start/distance resolve to real on-screen coordinates (${JSON.stringify(dragSetup)})`);
        const startClientX = dragSetup.rectLeft + dragSetup.centerX, startClientY = dragSetup.rectTop + dragSetup.centerY;
        const rawEndClientX = startClientX + dragSetup.pxPerBar * 50;
        const maxClientX = chartBox.x + chartBox.width - 15; // stay inside .tv-chart-wrap the whole drag -- see the note above
        const endClientX = Math.min(rawEndClientX, maxClientX);
        assert(endClientX > startClientX + 50, `Fix E setup: there is enough room inside the chart to drag a meaningful distance (start=${startClientX}, end=${endClientX}, chart right edge=${chartBox.x + chartBox.width})`);

        await page.mouse.move(startClientX, startClientY);
        await page.mouse.down();
        const DRAG_STEPS = 60; // many discrete native mousemove events -- exactly what btScheduleMoveFrame()'s coalescing is for
        for (let i = 1; i <= DRAG_STEPS; i++) {
            await page.mouse.move(startClientX + (endClientX - startClientX) * (i / DRAG_STEPS), startClientY);
        }
        await page.mouse.up();
        await page.waitForTimeout(250); // let any queued PerformanceObserver callback flush
        await shot(page, 'fixE-after-drag-50-bars');

        const perf = await page.evaluate(() => ({ supported: window.__btLongTaskSupported, tasks: window.__btLongTasks || [] }));
        if (!perf.supported) {
            console.log('  [skip] PerformanceObserver longtask entries unsupported in this browser -- cannot assert durations directly');
        } else {
            const over = perf.tasks.filter(d => d > 16);
            assert(over.length === 0, `Fix E: dragging across 50 bars produced no long task over 16ms (durations: ${JSON.stringify(perf.tasks)})`);
        }

        console.log('\n[Verify 5b / Fix E] with magnet off, the drag follows the cursor exactly (no snapping mid-drag or on release)');
        // Drives btApplyDrag()/btPixelToPointContinuous() directly rather than a second
        // pixel-perfect mouse drag -- this is a precise NUMERIC comparison (does the
        // applied price match a raw, unsnapped conversion to the exact decimal), and a
        // real synthetic drag's own few-millisecond round trip between computing a target
        // pixel and the event actually landing is enough jitter to occasionally miss a
        // handle by a pixel, which would test mouse-event timing, not Fix E's own logic.
        // Same "drive the mechanism directly" choice this file already made for Fix A's
        // btDrawLevelPill()/btFitPriceAxisToLevel(), and the same one drive-v3223.mjs's
        // own btTicketSetField() calls make for the order ticket's lines.
        await page.evaluate(() => { if (btMagnetEnabled) btToggleMagnet(); });
        const continuousDragResult = await page.evaluate(() => {
            const d = btDrawings.find(x => x.id === btSelectedDrawingId);
            const left = Math.min(btTimeToX(d.points[0].time), btTimeToX(d.points[1].time));
            const yEntryStart = btPriceToY(d.settings.entry);
            // Mirrors btOnDrawMouseDown()'s own 'entry'-handle mousedown exactly (v3.22.5
            // Fix E: startPoint uses the continuous conversion for a position tool).
            const dragState = {
                drawingId: d.id, handleIndex: 'entry',
                startPoint: btPixelToPointContinuous(left, yEntryStart),
                startPoints: JSON.parse(JSON.stringify(d.points)),
                startSettings: JSON.parse(JSON.stringify(d.settings)),
            };
            const targetY = yEntryStart + 23.4; // deliberately not bar/wick-aligned
            // Mirrors btProcessPendingMove()'s own continuous-for-a-position-tool path.
            btApplyDrag(dragState, btPixelToPointContinuous(left, targetY));
            const midEntry = d.settings.entry;
            const expectedContinuous = btYToPrice(targetY);
            // btOnDrawMouseUp()'s own final re-snap is gated on btMagnetEnabled, already
            // confirmed off above -- nothing further would touch d.settings.entry on a
            // real release, so re-checking after a second identical btApplyDrag() call
            // (standing in for "release lands on the same point the last move did",
            // which is exactly what happens with no mouse movement between move and up)
            // confirms "no snap on release either" without needing a second real event.
            btApplyDrag(dragState, btPixelToPointContinuous(left, targetY));
            const afterReleaseEntry = d.settings.entry;
            return { midEntry, afterReleaseEntry, expectedContinuous };
        });
        assert(Math.abs(continuousDragResult.midEntry - continuousDragResult.expectedContinuous) < 0.0001,
            `Fix E: with magnet off, mid-drag entry price follows the cursor exactly, no snapping (actual=${continuousDragResult.midEntry}, expected=${continuousDragResult.expectedContinuous})`);
        assert(Math.abs(continuousDragResult.afterReleaseEntry - continuousDragResult.expectedContinuous) < 0.0001,
            `Fix E: with magnet off, the release point also matches the cursor exactly -- no snap-on-release either (got ${continuousDragResult.afterReleaseEntry}, expected ${continuousDragResult.expectedContinuous})`);
        await shot(page, 'fixE-magnet-off-continuous-drag');

        // ════════════════════════════════════════════════════════════════
        // Verify 6 / Fix F — drag the left/right edge handles: box stretches/shrinks,
        // holds the 3-bar minimum, and the resized width is part of what actually gets
        // saved (this harness has no DB -- "keeps width after a real reload" needs a
        // live/DB-backed check; this confirms the width is in the save payload, which is
        // exactly what a real reload reads back from).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 6 / Fix F] drag the left/right edge handles: stretch/shrink, 3-bar minimum, width is saved');
        await page.evaluate(() => { if (!btMagnetEnabled) btToggleMagnet(); }); // restore magnet on, the app's own default
        await page.evaluate(() => {
            window.__btEdgeHandlePos = function (side) {
                const d = btDrawings.find(x => x.id === btSelectedDrawingId);
                const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
                const left = Math.min(x1, x2), right = Math.max(x1, x2);
                const yEntry = btPriceToY(d.settings.entry), yStop = btPriceToY(d.settings.stop_loss);
                const yTp = d.settings.take_profit !== null ? btPriceToY(d.settings.take_profit) : null;
                const ys = [yEntry, yStop, yTp].filter(v => v !== null);
                const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
                const rect = document.getElementById('bt-draw-overlay').getBoundingClientRect();
                return { clientX: rect.left + (side === 'left' ? left : right), clientY: rect.top + centerY };
            };
        });

        const rightPos = await page.evaluate(() => window.__btEdgeHandlePos('right'));
        await page.mouse.move(rightPos.clientX, rightPos.clientY);
        await page.waitForTimeout(60);
        const hoverCursor = await page.evaluate(() => document.getElementById('bt-draw-overlay').style.cursor);
        assert(hoverCursor === 'ew-resize', `Fix F: cursor becomes ew-resize while hovering the right edge handle (got "${hoverCursor}")`);

        const beforeStretch = await page.evaluate(() => {
            const d = btDrawings.find(x => x.id === btSelectedDrawingId);
            return { points: JSON.parse(JSON.stringify(d.points)), settings: JSON.parse(JSON.stringify(d.settings)) };
        });
        const [stretchSaveReq] = await Promise.all([
            page.waitForRequest(req => req.url().includes('action=update_backtest_drawing')),
            (async () => {
                await page.mouse.move(rightPos.clientX, rightPos.clientY);
                await page.mouse.down();
                await page.mouse.move(rightPos.clientX + 80, rightPos.clientY, { steps: 6 });
                await page.mouse.up();
            })(),
        ]);
        await page.waitForTimeout(80);
        const afterStretch = await page.evaluate(() => {
            const d = btDrawings.find(x => x.id === btSelectedDrawingId);
            return { points: d.points, settings: d.settings };
        });
        assert(afterStretch.points[1].time > beforeStretch.points[1].time, `Fix F: dragging the right handle rightward increases points[1].time (${beforeStretch.points[1].time} -> ${afterStretch.points[1].time})`);
        assert(afterStretch.points[0].time === beforeStretch.points[0].time, 'Fix F: the left edge (points[0].time) is untouched by a right-handle drag');
        assert(afterStretch.settings.entry === beforeStretch.settings.entry && afterStretch.settings.stop_loss === beforeStretch.settings.stop_loss,
            'Fix F: prices (entry/stop) are unchanged by an edge-resize drag');
        const savedBody = stretchSaveReq.postDataJSON();
        assert(savedBody && savedBody.points && savedBody.points[1].time === afterStretch.points[1].time,
            `Fix F: the stretched width is part of the actual save payload sent to update_backtest_drawing (${JSON.stringify(savedBody && savedBody.points)})`);
        await shot(page, 'fixF-after-stretch-right');

        const rightPos2 = await page.evaluate(() => window.__btEdgeHandlePos('right'));
        const leftPos2 = await page.evaluate(() => window.__btEdgeHandlePos('left'));
        await page.mouse.move(rightPos2.clientX, rightPos2.clientY);
        await page.mouse.down();
        await page.mouse.move(leftPos2.clientX - 300, rightPos2.clientY, { steps: 8 }); // drag far PAST the left edge
        await page.mouse.up();
        await page.waitForTimeout(80);
        const minWidthResult = await page.evaluate(() => {
            const d = btDrawings.find(x => x.id === btSelectedDrawingId);
            const bars = Math.round((d.points[1].time - d.points[0].time) / btStepSec());
            return { bars, points: d.points };
        });
        assert(minWidthResult.bars === 3, `Fix F: dragging the right handle past the left edge holds the minimum width of 3 bars (got ${minWidthResult.bars} bars)`);
        await shot(page, 'fixF-min-width-floor');

    } finally {
        await browser.close();
        await harness.stop();
    }

    console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILURE(S)`}`);
    if (failures.length) {
        for (const f of failures) console.log(' - ' + f);
        process.exitCode = 1;
    }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
