/**
 * FundedControl v3.22.7 UI harness driver -- "the position tool stays put as the
 * trade's visual." Verifies: a linked drawing is never hidden (pending/open/closed all
 * stay visible), the old auto-growing live box is gone (the drawing's own fixed width
 * IS the box), state colouring (dashed orange / solid blue / 40% faded), prices locked
 * while pending/open (box still movable/stretchable), and New Trade with nothing
 * drawn/selected still gets a real, linked, fixed-width box.
 *
 * Runs against the STATEFUL mock session 20 (fresh, tools/ui-harness/stubs/api.php).
 * drive.mjs, drive-v3223.mjs, drive-v3225.mjs and drive-v3226.mjs are all untouched
 * except for two small, clearly-marked updates where THEIR OWN subject matter was
 * directly superseded by this release (see each file's own v3.22.7 comment).
 *
 * Usage: node drive-v3227.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3227');
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

async function advanceBars(page, n) {
    for (let i = 0; i < n; i++) {
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_advance')),
            page.click('button[onclick="btAdvance()"]'),
        ]);
        await page.waitForTimeout(40);
    }
}

async function dragPositionTool(page, tool, dy) {
    await page.click(`[data-tool="${tool}"]`);
    const box = await page.locator('.tv-chart-wrap').boundingBox();
    const x = box.x + box.width * 0.35;
    const y = box.y + box.height * 0.4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 5 });
    await page.mouse.up();
}

async function installFillTextLog(page) {
    await page.evaluate(() => {
        window.__btFillTextLog = [];
        const proto = CanvasRenderingContext2D.prototype;
        if (!proto.__btFillTextPatchedV3227) {
            const orig = proto.fillText;
            proto.fillText = function (text, x, y, maxWidth) {
                window.__btFillTextLog.push(text);
                return maxWidth !== undefined ? orig.call(this, text, x, y, maxWidth) : orig.call(this, text, x, y);
            };
            proto.__btFillTextPatchedV3227 = true;
        }
    });
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

    const harness = await setupHarness({ port: 8770 });
    console.log(`Harness up at ${harness.baseUrl} (temp copy: ${harness.tmpDir})`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 760 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });
        await installFillTextLog(page);
        await openSession(page, 20);

        // ════════════════════════════════════════════════════════════════
        // Verify 1 — draw a position, place as Limit, box stays visible with a dashed
        // orange entry; fill it, same box, now blue entry + the Open P&L pill (once
        // we're also past Verify's own fill check further down).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] draw a Long, place as Limit -- box stays visible, dashed orange entry');
        await dragPositionTool(page, 'position_long', 90);
        await page.waitForFunction(() => typeof btDrawings !== 'undefined' && btDrawings.length > 0);
        const drawnBoxId = await page.evaluate(() => btDrawings[btDrawings.length - 1].id);
        await shot(page, 'verify1-drawn');

        await page.click('#bt-pos-toolbar-place');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.click('[data-seg-group="orderType"] [data-seg-val="limit"]');
        // Below the current close (a valid Long limit) and far enough from both price
        // and time that it won't be touched by Verify 2's own 20-advance run below --
        // computed by hand against stubs/api.php's own deterministic candle sequence
        // (index 400 close 8769.54; low first dips to/under 8740 at index 402).
        await page.evaluate(() => btTicketSetField('entry', 8740));
        await page.fill('#bt-ticket-sl', '8000');
        const tpOnA = await page.isChecked('#bt-ticket-tp-on');
        if (!tpOnA) { await page.check('#bt-ticket-tp-on'); await page.dispatchEvent('#bt-ticket-tp-on', 'change'); }
        await page.fill('#bt-ticket-tp', '9200');
        await page.dispatchEvent('#bt-ticket-tp', 'change');
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        await page.waitForSelector('#bt-ticket', { state: 'hidden' });

        const pendingState = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return { exists: !!d, linkState: typeof btLinkedState === 'function' ? btLinkedState(d) : null, linkedOrderId: d && d.linked_order_id };
        }, drawnBoxId);
        assert(pendingState.exists, 'the drawing still exists in btDrawings after placing (never deleted)');
        assert(pendingState.linkState === 'pending', `the drawing's own link state is 'pending' right after a Limit submit (got ${pendingState.linkState})`);
        const boxBeforeFill = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return { x1: btTimeToX(d.points[0].time), x2: btTimeToX(d.points[1].time), t0: d.points[0].time, t1: d.points[1].time };
        }, drawnBoxId);
        assert(boxBeforeFill.x1 !== null && boxBeforeFill.x2 !== null, 'box has real on-screen coordinates while pending');
        await shot(page, 'verify1-pending-dashed-orange');

        console.log('\n[Verify 1] advance until the limit fills -- same box, now open (blue entry + Open P&L pill)');
        await advanceBars(page, 2); // cursor 400 -> 402, low 8721.20 crosses the 8740 limit
        const openState = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return { linkState: btLinkedState(d), x1: btTimeToX(d.points[0].time), x2: btTimeToX(d.points[1].time), t0: d.points[0].time, t1: d.points[1].time };
        }, drawnBoxId);
        assert(openState.linkState === 'open', `the SAME drawing's link state becomes 'open' once the limit fills (got ${openState.linkState})`);
        // Pixel x shifts as the chart's own fixed-width replay window scrolls underneath
        // a fixed point (v3.20.10 -- "now" stays pinned, everything else moves left each
        // advance); the box's own TIME values and on-screen WIDTH are what must not
        // change, not its absolute pixel position.
        assert(openState.t0 === boxBeforeFill.t0 && openState.t1 === boxBeforeFill.t1,
            `it is still the SAME box, same time span, not a new/different one (before t=[${boxBeforeFill.t0},${boxBeforeFill.t1}], after t=[${openState.t0},${openState.t1}])`);
        await shot(page, 'verify1-open-solid-blue');

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — New Trade from the sidebar with nothing drawn/selected still gets
        // a real, linked, fixed 20-bar box (a SEPARATE trade from the one above).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] New Trade with nothing drawn/selected -- a real 20-bar box appears at the fill bar');
        await page.evaluate(() => { btSelectedDrawingId = null; });
        const drawingCountBefore = await page.evaluate(() => btDrawings.length);
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.click('[data-seg-group="orderType"] [data-seg-val="market"]');
        await page.fill('#bt-ticket-sl', '8600');
        const tpOnB = await page.isChecked('#bt-ticket-tp-on');
        if (!tpOnB) { await page.check('#bt-ticket-tp-on'); await page.dispatchEvent('#bt-ticket-tp-on', 'change'); }
        // From index 402 (current cursor): high first reaches 8850 at index 404 -- 2
        // advances away, computed by hand against the same deterministic sequence.
        await page.fill('#bt-ticket-tp', '8850');
        await page.dispatchEvent('#bt-ticket-tp', 'change');
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        await page.waitForFunction(() => btSession.open_positions.length === 2); // the limit fill above + this one
        const marketTradeId = await page.evaluate(() => btSession.open_positions.find(p => p.stop_loss === 8600).id);
        const autoCreated = await page.evaluate((tid) => {
            const d = btDrawings.find(x => x.linked_trade_id === tid);
            if (!d) return null;
            const stepSec = btStepSec();
            const widthBars = Math.round((d.points[1].time - d.points[0].time) / stepSec);
            return { found: true, widthBars, tool: d.tool };
        }, marketTradeId);
        assert(await page.evaluate((n) => btDrawings.length === n + 1, drawingCountBefore), 'exactly one new drawing was created for this trade');
        assert(autoCreated && autoCreated.found, 'a drawing was auto-created and linked to the new trade');
        assert(autoCreated && autoCreated.widthBars === 20, `the auto-created box is the default 20-bar width (got ${autoCreated && autoCreated.widthBars})`);
        await shot(page, 'verify4-auto-created-box');

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — close the market trade via TP: box fades (link state -> 'closed'),
        // the +R TP marker shows, and the box itself stays on the chart (never deleted).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] close via TP -- box fades, marker shows, box stays on the chart');
        const marketDrawingId = await page.evaluate((tid) => btDrawings.find(d => d.linked_trade_id === tid).id, marketTradeId);
        await advanceBars(page, 2); // cursor 402 -> 404, high 8853.38 crosses the 8850 TP
        const closedState = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return { exists: !!d, linkState: d ? btLinkedState(d) : null };
        }, marketDrawingId);
        assert(closedState.exists, 'the closed trade\'s own drawing is still in btDrawings -- never deleted on close');
        assert(closedState.linkState === 'closed', `its link state is 'closed' (got ${closedState.linkState})`);
        await page.evaluate(() => btRenderDrawings()); // one deterministic pass to sample fillText from
        const markerTexts = await page.evaluate(() => window.__btFillTextLog.filter(t => /R (TP|SL|Manual)/.test(t)));
        assert(markerTexts.some(t => /^\+.*R TP$/.test(t)), `a "+${'{R}'}R TP" exit marker is drawn (got ${JSON.stringify(markerTexts)})`);
        await shot(page, 'verify3-closed-faded-with-marker');

        // ════════════════════════════════════════════════════════════════
        // Verify 2 — 20 Next Bar steps: the FIRST (still-open) box's own left/right
        // edges do not move (4 advances already happened above; 16 more here).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2] 20 Next Bar steps total -- the open box\'s own edges do not move');
        await advanceBars(page, 16); // 4 (above) + 16 = 20 since the limit fill
        const boxAfter20 = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return { x1: btTimeToX(d.points[0].time), x2: btTimeToX(d.points[1].time), t0: d.points[0].time, t1: d.points[1].time, linkState: btLinkedState(d) };
        }, drawnBoxId);
        assert(boxAfter20.linkState === 'open', `the position is still open after 20 advances (got ${boxAfter20.linkState})`);
        // Same reasoning as the fill check above: compare TIME (exact) and on-screen
        // WIDTH (small tolerance for the chart's own sub-pixel bar-spacing rounding, see
        // drive-v3225.mjs's own identical note), never absolute pixel position -- the
        // replay window scrolls under a fixed point by design (v3.20.10).
        const widthBefore = openState.x2 - openState.x1, widthAfter = boxAfter20.x2 - boxAfter20.x1;
        assert(boxAfter20.t0 === openState.t0 && boxAfter20.t1 === openState.t1,
            `box's own time span is byte-identical after 20 Next Bar steps (before t=[${openState.t0},${openState.t1}], after t=[${boxAfter20.t0},${boxAfter20.t1}])`);
        assert(Math.abs(widthAfter - widthBefore) < 3,
            `box's on-screen width does not stretch across 20 Next Bar steps (before ${widthBefore}px, after ${widthAfter}px)`);
        await shot(page, 'verify2-edges-unchanged-after-20-bars');

        // ════════════════════════════════════════════════════════════════
        // Verify 5 — while open, entry/SL/TP can't be dragged (hit-test itself refuses
        // them); moving in time and stretching still work; the toolbar shows the lock.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 5] locked while open: entry/SL/TP un-draggable, move+stretch still work, lock icon shown');
        await page.evaluate((id) => { btSelectedDrawingId = id; btScheduleRedraw(); }, drawnBoxId);
        await page.waitForTimeout(100);
        const lockChecks = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
            const left = Math.min(x1, x2), right = Math.max(x1, x2);
            const cx = (left + right) / 2;
            const yEntry = btPriceToY(d.settings.entry), yStop = btPriceToY(d.settings.stop_loss), yTp = btPriceToY(d.settings.take_profit);
            return {
                entryHit: btHitTestOne(d, cx, yEntry),
                stopHit: btHitTestOne(d, cx, yStop),
                tpHit: btHitTestOne(d, cx, yTp),
                moveHit: btHitTestOne(d, cx, (yEntry + yStop) / 2),
            };
        }, drawnBoxId);
        assert(lockChecks.entryHit === 'move', `entry price handle is not grabbable while open -- the move zone covers it instead (got ${lockChecks.entryHit})`);
        assert(lockChecks.stopHit === 'move', `stop price handle is not grabbable while open (got ${lockChecks.stopHit})`);
        assert(lockChecks.tpHit === 'move', `take-profit handle is not grabbable while open (got ${lockChecks.tpHit})`);
        assert(lockChecks.moveHit === 'move', `the box body itself is still grabbable (for a time-only move) while open (got ${lockChecks.moveHit})`);

        // The toolbar: no Place Trade / R:R lock (already placed), a price-lock icon
        // shown, Delete disabled.
        await page.waitForSelector('#bt-pos-toolbar', { state: 'visible' });
        const toolbarState = await page.evaluate(() => ({
            hasPlace: !!document.getElementById('bt-pos-toolbar-place'),
            hasRRLock: !!document.getElementById('bt-pos-toolbar-lock'),
            hasPriceLock: !!document.getElementById('bt-pos-toolbar-pricelock'),
            deleteDisabled: document.getElementById('bt-pos-toolbar-delete').disabled,
        }));
        assert(!toolbarState.hasPlace, 'toolbar has no Place Trade button once already placed');
        assert(!toolbarState.hasRRLock, 'toolbar has no R:R lock toggle once already placed');
        assert(toolbarState.hasPriceLock, 'toolbar shows the price-lock icon while the trade is live');
        assert(toolbarState.deleteDisabled, 'toolbar\'s Delete is disabled while the trade is live');
        await shot(page, 'verify5-toolbar-locked');

        console.log('\n[Verify 5] moving the box in time still works; price is untouched by the move');
        const beforeMove = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return { t0: d.points[0].time, t1: d.points[1].time, entry: d.settings.entry, stop: d.settings.stop_loss };
        }, drawnBoxId);
        const overlayBox = await page.locator('#bt-draw-overlay').boundingBox();
        const moveX = overlayBox.x + (boxAfter20.x1 + boxAfter20.x2) / 2;
        const moveY = overlayBox.y + (await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return (btPriceToY(d.settings.entry) + btPriceToY(d.settings.stop_loss)) / 2;
        }, drawnBoxId));
        await page.mouse.move(moveX, moveY);
        await page.mouse.down();
        await page.mouse.move(moveX - 40, moveY, { steps: 5 }); // horizontal only
        await page.mouse.up();
        const afterMove = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return { t0: d.points[0].time, t1: d.points[1].time, entry: d.settings.entry, stop: d.settings.stop_loss };
        }, drawnBoxId);
        assert(afterMove.t0 !== beforeMove.t0 && afterMove.t1 !== beforeMove.t1, `the box moved in TIME (before ${beforeMove.t0}, after ${afterMove.t0})`);
        assert(afterMove.entry === beforeMove.entry && afterMove.stop === beforeMove.stop,
            `price (entry/stop) is UNCHANGED by the move -- the lock held even via the box's own drag (before entry=${beforeMove.entry}, after entry=${afterMove.entry})`);
        await shot(page, 'verify5-moved-in-time-price-locked');

        console.log('\n[Verify 5] stretching the right edge still works');
        const widthBeforeStretch = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return Math.round((d.points[1].time - d.points[0].time) / btStepSec());
        }, drawnBoxId);
        const edgeX = overlayBox.x + (await page.evaluate((id) => btTimeToX(btDrawings.find(x => x.id === id).points[1].time), drawnBoxId));
        const edgeY = overlayBox.y + (await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            const ys = [btPriceToY(d.settings.entry), btPriceToY(d.settings.stop_loss), btPriceToY(d.settings.take_profit)];
            return (Math.min(...ys) + Math.max(...ys)) / 2;
        }, drawnBoxId));
        await page.mouse.move(edgeX, edgeY);
        await page.mouse.down();
        await page.mouse.move(edgeX + 60, edgeY, { steps: 5 });
        await page.mouse.up();
        const widthAfterStretch = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return Math.round((d.points[1].time - d.points[0].time) / btStepSec());
        }, drawnBoxId);
        assert(widthAfterStretch > widthBeforeStretch, `dragging the right edge still stretches the box (before ${widthBeforeStretch} bars, after ${widthAfterStretch} bars)`);
        await shot(page, 'verify5-stretched');

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
