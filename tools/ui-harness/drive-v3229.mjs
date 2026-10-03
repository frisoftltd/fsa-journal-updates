/**
 * FundedControl v3.22.9 UI harness driver -- "Rectangle drawing tool." Verifies: draw +
 * reload persists with normalised points (points[0] top-left), each of the 8 handles
 * changes only what it should (corners both axes, top/bottom price-only, left/right
 * time-only), dragging inside moves the whole box, axis pills only appear while selected,
 * the Style-tab settings (extend/middle line/background) actually change rendered pixels,
 * Cancel reverts, Coordinates-tab edits move the box, Save-as-default carries into a new
 * rectangle, and a rectangle never intercepts a click meant for a position tool drawn on
 * top of it.
 *
 * Runs against the STATEFUL mock session 20 (fresh, tools/ui-harness/stubs/api.php).
 * drive.mjs, drive-v3223.mjs, drive-v3225.mjs, drive-v3226.mjs, drive-v3227.mjs and
 * drive-v3228.mjs are all untouched.
 *
 * Usage: node drive-v3229.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3229');
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

/** Click-drag a tool from one fractional point of .tv-chart-wrap to another. */
async function dragDraw(page, tool, fx1, fy1, fx2, fy2) {
    await page.click(`[data-tool="${tool}"]`);
    const box = await page.locator('.tv-chart-wrap').boundingBox();
    await page.mouse.move(box.x + box.width * fx1, box.y + box.height * fy1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * fx2, box.y + box.height * fy2, { steps: 5 });
    await page.mouse.up();
}

async function dragPositionTool(page, tool, dy) {
    await page.click(`[data-tool="${tool}"]`);
    const box = await page.locator('.tv-chart-wrap').boundingBox();
    const x = box.x + box.width * 0.3;
    const y = box.y + box.height * 0.4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 5 });
    await page.mouse.up();
}

/** Pixel bounds (overlay-local, like every other drawing's own hit-test geometry) of a
 *  rectangle drawing's current points. */
async function rectBounds(page, id) {
    return page.evaluate((rid) => {
        const d = btDrawings.find(x => x.id === rid);
        const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
        const y1 = btPriceToY(d.points[0].price), y2 = btPriceToY(d.points[1].price);
        return {
            left: Math.min(x1, x2), right: Math.max(x1, x2),
            top: Math.min(y1, y2), bottom: Math.max(y1, y2),
            t0: d.points[0].time, t1: d.points[1].time, p0: d.points[0].price, p1: d.points[1].price,
        };
    }, id);
}

async function dragHandle(page, overlayBox, px, py, dx, dy) {
    await page.mouse.move(overlayBox.x + px, overlayBox.y + py);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + px + dx, overlayBox.y + py + dy, { steps: 5 });
    await page.mouse.up();
}

async function samplePixel(page, x, y) {
    return page.evaluate(({ x, y }) => {
        const ctx = document.getElementById('bt-draw-overlay').getContext('2d');
        const px = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return { r: px[0], g: px[1], b: px[2], a: px[3] };
    }, { x, y });
}

async function main() {
    console.log('[Static] duplicate-name scan across app/js/');
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

    const harness = await setupHarness({ port: 8772 });
    console.log(`Harness up at ${harness.baseUrl} (temp copy: ${harness.tmpDir})`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 820 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });
        await openSession(page, 20);

        // ════════════════════════════════════════════════════════════════
        // Verify 1 — draw a rectangle, points normalised (points[0] top-left), and after
        // a real reload it renders identically.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] draw a rectangle -- saved with normalised points[0]=top-left');
        await dragDraw(page, 'rectangle', 0.25, 0.25, 0.55, 0.55);
        await page.waitForFunction(() => typeof btDrawings !== 'undefined' && btDrawings.some(d => d.tool === 'rectangle'));
        const rect1 = await page.evaluate(() => {
            const d = btDrawings.find(x => x.tool === 'rectangle');
            return { id: d.id, t0: d.points[0].time, t1: d.points[1].time, p0: d.points[0].price, p1: d.points[1].price };
        });
        assert(rect1.t0 < rect1.t1, `points[0].time is the EARLIER time (top-left), points[1].time the later one (t0=${rect1.t0}, t1=${rect1.t1})`);
        assert(rect1.p0 > rect1.p1, `points[0].price is the HIGHER price (top-left), points[1].price the lower one (p0=${rect1.p0}, p1=${rect1.p1})`);
        await shot(page, 'verify1-drawn');

        console.log('\n[Verify 1] reload the page -- same rectangle, same points, renders identically');
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });
        await openSession(page, 20);
        const rect1Reloaded = await page.evaluate((rid) => {
            const d = btDrawings.find(x => x.id === rid);
            if (!d) return null;
            return { tool: d.tool, t0: d.points[0].time, t1: d.points[1].time, p0: d.points[0].price, p1: d.points[1].price };
        }, rect1.id);
        assert(!!rect1Reloaded, 'the same drawing id is still present after a real page reload');
        assert(rect1Reloaded && rect1Reloaded.tool === 'rectangle', 'reloaded drawing is still tool=rectangle');
        assert(rect1Reloaded && rect1Reloaded.t0 === rect1.t0 && rect1Reloaded.t1 === rect1.t1 && rect1Reloaded.p0 === rect1.p0 && rect1Reloaded.p1 === rect1.p1,
            `reloaded points are byte-identical to what was saved (before ${JSON.stringify(rect1)}, after ${JSON.stringify(rect1Reloaded)})`);
        await shot(page, 'verify1-reloaded');

        // ════════════════════════════════════════════════════════════════
        // Verify 2 — each of the 8 handles changes only what it should; dragging inside
        // moves the whole box. Select it first (handles only register while selected).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2] select, then hit-test every one of the 8 handles directly');
        await page.evaluate((rid) => { btSelectedDrawingId = rid; btScheduleRedraw(); }, rect1.id);
        await page.waitForTimeout(80);
        const b = await rectBounds(page, rect1.id);
        const midX = (b.left + b.right) / 2, midY = (b.top + b.bottom) / 2;
        const hitAt = async (hx, hy) => page.evaluate(({ rid, hx, hy }) => {
            const d = btDrawings.find(x => x.id === rid);
            return btHitTestOne(d, hx, hy);
        }, { rid: rect1.id, hx, hy });
        assert(await hitAt(b.left, b.top) === 'rect-tl', 'top-left corner hit-tests as rect-tl');
        assert(await hitAt(b.right, b.top) === 'rect-tr', 'top-right corner hit-tests as rect-tr');
        assert(await hitAt(b.left, b.bottom) === 'rect-bl', 'bottom-left corner hit-tests as rect-bl');
        assert(await hitAt(b.right, b.bottom) === 'rect-br', 'bottom-right corner hit-tests as rect-br');
        assert(await hitAt(midX, b.top) === 'rect-top', 'top-edge midpoint hit-tests as rect-top');
        assert(await hitAt(midX, b.bottom) === 'rect-bottom', 'bottom-edge midpoint hit-tests as rect-bottom');
        assert(await hitAt(b.left, midY) === 'rect-left', 'left-edge midpoint hit-tests as rect-left');
        assert(await hitAt(b.right, midY) === 'rect-right', 'right-edge midpoint hit-tests as rect-right');
        assert(await hitAt(midX, midY) === 'move', 'clicking well inside the box (no handle nearby) hit-tests as move');

        console.log('\n[Verify 2] real drags: corner changes both axes, top/bottom price-only, left/right time-only');
        const overlayBox = await page.locator('#bt-draw-overlay').boundingBox();

        const beforeCorner = await rectBounds(page, rect1.id);
        await dragHandle(page, overlayBox, beforeCorner.right, beforeCorner.bottom, 25, 20);
        const afterCorner = await rectBounds(page, rect1.id);
        assert(afterCorner.t1 !== beforeCorner.t1, `dragging the bottom-right CORNER changed its time (before ${beforeCorner.t1}, after ${afterCorner.t1})`);
        assert(afterCorner.p1 !== beforeCorner.p1, `dragging the bottom-right CORNER changed its price (before ${beforeCorner.p1}, after ${afterCorner.p1})`);

        const beforeTop = await rectBounds(page, rect1.id);
        const topMidX = (beforeTop.left + beforeTop.right) / 2;
        await dragHandle(page, overlayBox, topMidX, beforeTop.top, 0, -15);
        const afterTop = await rectBounds(page, rect1.id);
        assert(afterTop.p0 !== beforeTop.p0, `dragging the TOP edge handle changed the top price (before ${beforeTop.p0}, after ${afterTop.p0})`);
        assert(afterTop.t0 === beforeTop.t0 && afterTop.t1 === beforeTop.t1, `dragging the TOP edge handle left BOTH time endpoints unchanged (price-only) (before [${beforeTop.t0},${beforeTop.t1}], after [${afterTop.t0},${afterTop.t1}])`);

        const beforeLeft = await rectBounds(page, rect1.id);
        const leftMidY = (beforeLeft.top + beforeLeft.bottom) / 2;
        await dragHandle(page, overlayBox, beforeLeft.left, leftMidY, -20, 0);
        const afterLeft = await rectBounds(page, rect1.id);
        assert(afterLeft.t0 !== beforeLeft.t0, `dragging the LEFT edge handle changed the left time (before ${beforeLeft.t0}, after ${afterLeft.t0})`);
        assert(afterLeft.p0 === beforeLeft.p0 && afterLeft.p1 === beforeLeft.p1, `dragging the LEFT edge handle left BOTH price endpoints unchanged (time-only) (before [${beforeLeft.p0},${beforeLeft.p1}], after [${afterLeft.p0},${afterLeft.p1}])`);

        console.log('\n[Verify 2] dragging inside moves the whole box (both points shift by the same delta)');
        const beforeMove = await rectBounds(page, rect1.id);
        const moveMidX = (beforeMove.left + beforeMove.right) / 2, moveMidY = (beforeMove.top + beforeMove.bottom) / 2;
        await dragHandle(page, overlayBox, moveMidX, moveMidY, 30, -25);
        const afterMove = await rectBounds(page, rect1.id);
        const dt0 = afterMove.t0 - beforeMove.t0, dt1 = afterMove.t1 - beforeMove.t1;
        const dp0 = afterMove.p0 - beforeMove.p0, dp1 = afterMove.p1 - beforeMove.p1;
        assert(dt0 !== 0 && dt0 === dt1, `moving the box shifts BOTH time endpoints by the SAME amount (dt0=${dt0}, dt1=${dt1})`);
        assert(dp0 !== 0 && Math.abs(dp0 - dp1) < 1e-6, `moving the box shifts BOTH price endpoints by the SAME amount (dp0=${dp0}, dp1=${dp1})`);
        await shot(page, 'verify2-after-handle-drags');

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — price/time axis pills render only while selected.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] axis pills (price + time) appear only while selected');
        await page.evaluate(() => {
            window.__btFillTextLog = [];
            const proto = CanvasRenderingContext2D.prototype;
            if (!proto.__btFillTextPatchedV3229) {
                const orig = proto.fillText;
                proto.fillText = function (text, x, y, maxWidth) {
                    window.__btFillTextLog.push(text);
                    return maxWidth !== undefined ? orig.call(this, text, x, y, maxWidth) : orig.call(this, text, x, y);
                };
                proto.__btFillTextPatchedV3229 = true;
            }
        });
        await page.evaluate((rid) => { btSelectedDrawingId = rid; window.__btFillTextLog = []; btRenderDrawings(); }, rect1.id);
        const textsSelected = await page.evaluate(() => window.__btFillTextLog.slice());
        await page.evaluate(() => { btSelectedDrawingId = null; window.__btFillTextLog = []; btRenderDrawings(); });
        const textsDeselected = await page.evaluate(() => window.__btFillTextLog.slice());
        const timePillRe = /^\d{2}:\d{2}$/;
        const pricePillRe = /^\d+\.\d{2,6}$/;
        assert(textsSelected.some(t => timePillRe.test(t)), `a time-axis pill (HH:MM) is drawn while selected (got ${JSON.stringify(textsSelected)})`);
        assert(textsSelected.some(t => pricePillRe.test(t)), `a price-axis pill is drawn while selected (got ${JSON.stringify(textsSelected)})`);
        assert(!textsDeselected.some(t => timePillRe.test(t)), `no time-axis pill is drawn once deselected (got ${JSON.stringify(textsDeselected)})`);
        assert(!textsDeselected.some(t => pricePillRe.test(t)), `no price-axis pill is drawn once deselected (got ${JSON.stringify(textsDeselected)})`);

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — settings: extend right reaches the chart's right edge, middle line
        // draws at mid-price, background off removes the fill, Cancel reverts.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] settings panel -- extend / middle line / background / Cancel');
        await page.evaluate((rid) => { btSelectedDrawingId = rid; btScheduleRedraw(); }, rect1.id);
        await page.waitForTimeout(80);
        const bNow = await rectBounds(page, rect1.id);
        const sampleY = Math.round((bNow.top + bNow.bottom) / 2);
        const insideX = Math.round((bNow.left + bNow.right) / 2);

        await page.evaluate((rid) => { const d = btDrawings.find(x => x.id === rid); btShowDrawSettingsPopover(d, 250, 250); }, rect1.id);
        await page.waitForSelector('#bt-draw-settings-popover', { state: 'visible' });
        await shot(page, 'verify4-panel-open');

        const canvasW = await page.evaluate(() => document.getElementById('bt-draw-overlay').width);
        const beforeExtendPx = await samplePixel(page, canvasW - 3, sampleY);
        await page.selectOption('[data-field="extend"]', 'right');
        await page.waitForTimeout(60);
        const afterExtendPx = await samplePixel(page, canvasW - 3, sampleY);
        assert(afterExtendPx.a > beforeExtendPx.a || (afterExtendPx.r !== beforeExtendPx.r || afterExtendPx.g !== beforeExtendPx.g || afterExtendPx.b !== beforeExtendPx.b),
            `Extend Right: the right edge of the canvas now shows the rectangle's own fill/border (before ${JSON.stringify(beforeExtendPx)}, after ${JSON.stringify(afterExtendPx)})`);

        await page.check('[data-field="middle_line"]');
        await page.dispatchEvent('[data-field="middle_line"]', 'change');
        await page.waitForTimeout(60);
        const midLinePixels = [];
        for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
            midLinePixels.push(await samplePixel(page, Math.round(bNow.left + (bNow.right - bNow.left) * fx), sampleY));
        }
        const isBluish = px => px.a > 10 && px.b > 150 && px.b > px.r;
        assert(midLinePixels.some(isBluish), `Middle line: at least one sample along the box's mid-price row shows the middle-line colour (dashed, so not every sample will) (${JSON.stringify(midLinePixels)})`);

        const insideYAwayFromMid = Math.round(bNow.top + (bNow.bottom - bNow.top) * 0.2); // away from both border and the new middle line
        const bgOnPx = await samplePixel(page, insideX, insideYAwayFromMid);
        assert(bgOnPx.a > 0, `Background on: interior fill is present before turning it off (${JSON.stringify(bgOnPx)})`);
        await page.uncheck('[data-field="background"]');
        await page.dispatchEvent('[data-field="background"]', 'change');
        await page.waitForTimeout(60);
        const bgOffPx = await samplePixel(page, insideX, insideYAwayFromMid);
        assert(bgOffPx.a === 0, `Background off: interior fill is gone (${JSON.stringify(bgOffPx)})`);
        await shot(page, 'verify4-extend-middleline-nobg');

        console.log('\n[Verify 4] Cancel reverts every live-preview change made above');
        await page.click('#bt-rect-cancel-btn');
        await page.waitForSelector('#bt-draw-settings-popover', { state: 'hidden' });
        const revertedSettings = await page.evaluate((rid) => {
            const d = btDrawings.find(x => x.id === rid);
            return { extend: d.settings.extend, middle_line: d.settings.middle_line, background: d.settings.background };
        }, rect1.id);
        assert(revertedSettings.extend === 'none', `Cancel reverted extend back to 'none' (got ${revertedSettings.extend})`);
        assert(revertedSettings.middle_line === false, `Cancel reverted middle_line back to false (got ${revertedSettings.middle_line})`);
        assert(revertedSettings.background === true, `Cancel reverted background back to true (got ${revertedSettings.background})`);

        // ════════════════════════════════════════════════════════════════
        // Verify 4 (Coordinates tab) — editing Price 1/Time 1 moves the box; OK persists.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] Coordinates tab: editing Price 1 moves the box; OK saves it');
        await page.evaluate((rid) => { const d = btDrawings.find(x => x.id === rid); btShowDrawSettingsPopover(d, 250, 250); }, rect1.id);
        await page.waitForSelector('#bt-draw-settings-popover', { state: 'visible' });
        await page.click('.bt-draw-popover-tab[data-tab="coords"]');
        const beforeCoordEdit = await rectBounds(page, rect1.id);
        const newPrice1 = beforeCoordEdit.p0 + 100;
        await page.fill('[data-coord="0-price"]', String(newPrice1));
        await page.dispatchEvent('[data-coord="0-price"]', 'change');
        await page.waitForTimeout(60);
        const afterCoordEdit = await page.evaluate((rid) => btDrawings.find(x => x.id === rid).points[0].price, rect1.id);
        assert(Math.abs(afterCoordEdit - newPrice1) < 1e-6, `editing Price 1 live-updates the drawing's own top price (expected ${newPrice1}, got ${afterCoordEdit})`);
        const [updateResp] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=update_backtest_drawing')),
            page.click('#bt-rect-ok-btn'),
        ]);
        assert(updateResp.ok(), 'OK persists the coordinate edit via update_backtest_drawing');
        await shot(page, 'verify4-coordinates-edited');

        // ════════════════════════════════════════════════════════════════
        // Verify 5 — Save as default, then a NEW rectangle uses the saved style.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 5] Save as default -- a newly drawn rectangle picks up the saved border colour');
        await page.evaluate((rid) => { const d = btDrawings.find(x => x.id === rid); d.settings.border_color = '#ff00aa'; d.settings.background = false; btShowDrawSettingsPopover(d, 250, 250); }, rect1.id);
        await page.waitForSelector('#bt-draw-settings-popover', { state: 'visible' });
        await page.click('#bt-rect-template-btn');
        await page.waitForSelector('#bt-rect-template-menu.open');
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=save_drawing_default')),
            page.click('#bt-rect-template-save'),
        ]);
        await page.click('#bt-rect-ok-btn');
        await page.waitForSelector('#bt-draw-settings-popover', { state: 'hidden' });

        await dragDraw(page, 'rectangle', 0.1, 0.65, 0.2, 0.75);
        await page.waitForFunction(() => btDrawings.filter(d => d.tool === 'rectangle').length === 2);
        const newRectSettings = await page.evaluate(() => {
            const rects = btDrawings.filter(d => d.tool === 'rectangle');
            const d = rects[rects.length - 1];
            return { border_color: d.settings.border_color, background: d.settings.background };
        });
        assert(newRectSettings.border_color === '#ff00aa', `a new rectangle starts from the saved default border colour (got ${newRectSettings.border_color})`);
        assert(newRectSettings.background === false, `a new rectangle starts from the saved default background toggle (got ${newRectSettings.background})`);
        await shot(page, 'verify5-new-rectangle-uses-default');

        // ════════════════════════════════════════════════════════════════
        // Verify 6 — a rectangle never blocks clicking a position tool drawn under it.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 6] a rectangle drawn over a position tool never intercepts a click meant for it');
        await page.evaluate(() => { btSelectedDrawingId = null; });
        await dragPositionTool(page, 'position_long', 90);
        await page.waitForFunction(() => btDrawings.some(d => d.tool === 'position_long'));
        const posId = await page.evaluate(() => btDrawings.find(d => d.tool === 'position_long').id);
        const posBoundsFn = async () => page.evaluate((pid) => {
            const d = btDrawings.find(x => x.id === pid);
            const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
            const yEntry = btPriceToY(d.settings.entry), yStop = btPriceToY(d.settings.stop_loss), yTp = btPriceToY(d.settings.take_profit);
            return { left: Math.min(x1, x2), right: Math.max(x1, x2), yEntry, top: Math.min(yEntry, yStop, yTp), bottom: Math.max(yEntry, yStop, yTp) };
        }, posId);
        const pb = await posBoundsFn();

        // Draw a rectangle covering the position's entry line (the point this test
        // clicks). Bounded around yEntry rather than the full entry/stop/TP span --
        // the default 3:1 R:R can put the take-profit line well outside the visible
        // chart area, which would drag the mouse off .tv-chart-wrap entirely and never
        // register as a draw at all.
        // Selecting a tool clears btSelectedDrawingId and schedules a redraw that hides
        // the now-stale position toolbar (btPositionSelectionToolbar) -- waited for here
        // so the drag's own start point (just above the entry line, where that toolbar
        // used to float) isn't swallowed by a still-visible toolbar DOM element underneath it.
        const chartWrapBox = await page.locator('.tv-chart-wrap').boundingBox();
        await page.click('[data-tool="rectangle"]');
        await page.waitForFunction(() => { const el = document.getElementById('bt-pos-toolbar'); return !el || el.style.display === 'none'; });
        const covTop = pb.yEntry - 40, covBottom = pb.yEntry + 40;
        await page.mouse.move(chartWrapBox.x + pb.left - 40, chartWrapBox.y + covTop);
        await page.mouse.down();
        await page.mouse.move(chartWrapBox.x + pb.right + 40, chartWrapBox.y + covBottom, { steps: 5 });
        await page.mouse.up();
        await page.waitForFunction(() => btDrawings.filter(d => d.tool === 'rectangle').length === 3);
        const coveringRectId = await page.evaluate(() => {
            const rects = btDrawings.filter(d => d.tool === 'rectangle');
            return rects[rects.length - 1].id;
        });
        await shot(page, 'verify6-rectangle-over-position');

        const overlayBox2 = await page.locator('#bt-draw-overlay').boundingBox();
        await page.evaluate(() => { btSelectedDrawingId = null; btScheduleRedraw(); });
        await page.waitForTimeout(60);
        await page.mouse.click(overlayBox2.x + (pb.left + pb.right) / 2, overlayBox2.y + pb.yEntry);
        await page.waitForTimeout(60);
        const selectedAfterClickOnPosition = await page.evaluate(() => btSelectedDrawingId);
        assert(selectedAfterClickOnPosition === posId, `clicking the position tool's own entry line selects the POSITION, not the rectangle drawn over it (got drawing id ${selectedAfterClickOnPosition}, expected ${posId})`);

        // A click in the covering rectangle's own area that is NOT over the position must
        // still select the rectangle -- it's deprioritised, not unclickable. x is outside
        // the position's own [left,right] span by 25px but still inside the covering
        // rectangle's wider span (pb.left-40 .. pb.right+40); y is the entry line's own
        // row, safely inside both the covering rectangle's bounds and the chart area.
        await page.mouse.click(overlayBox2.x + pb.left - 25, overlayBox2.y + pb.yEntry);
        await page.waitForTimeout(60);
        const selectedAfterClickOnRectOnly = await page.evaluate(() => btSelectedDrawingId);
        assert(selectedAfterClickOnRectOnly === coveringRectId, `clicking the rectangle where it does NOT overlap the position still selects the rectangle (got ${selectedAfterClickOnRectOnly}, expected ${coveringRectId})`);

        // The order ticket's own lines take priority over a rectangle drawn across the
        // whole chart too -- structurally guaranteed (btTicketLineHitTest runs before any
        // drawing hit-test at all), checked here directly against the live ticket.
        await page.click('[data-tool=""]'); // cursor
        await page.evaluate((pid) => {
            const d = btDrawings.find(x => x.id === pid);
            btOpenTicketFromDrawing(d);
        }, posId);
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        const ticketLineHit = await page.evaluate(() => {
            const y = btPriceToY(btTicket.stopLoss);
            return btTicketLineHitTest(100, y);
        });
        assert(ticketLineHit === 'stopLoss', `the open ticket's own Stop Loss line still hit-tests correctly with a rectangle covering the whole chart (got ${ticketLineHit})`);
        await shot(page, 'verify6-ticket-line-priority');

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
