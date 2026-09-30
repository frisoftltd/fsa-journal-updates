/**
 * FundedControl Backtesting UI harness -- Playwright driver.
 *
 * Drives the v3.22.2 order-ticket fixes (Keep-3R recompute, sidebar "New Trade", the
 * drawing/ticket render sync, the toolbar/pill overlap, and the discoverability hint)
 * against a real Chromium instance, using tools/ui-harness/setup.js's DB-free temp copy
 * of app/. Screenshots land in the directory passed as argv[2] (default: ./out next to
 * this file). Prints PASS/FAIL per assertion and exits non-zero on any failure.
 *
 * Usage: node drive.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out');
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
function approxEqual(a, b, eps, msg) {
    assert(Math.abs(a - b) <= eps, `${msg} (got ${a}, expected ~${b})`);
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

async function main() {
    const harness = await setupHarness({ port: 8765 });
    console.log(`Harness up at ${harness.baseUrl} (temp copy: ${harness.tmpDir})`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 760 } });
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });
        await page.evaluate(() => openBacktestSession(6));
        await page.waitForFunction(() => typeof btSession !== 'undefined' && btSession && btSession.status === 'active');
        await page.waitForFunction(() => typeof chartState !== 'undefined' && chartState.candles.length > 0);
        await shot(page, 'session-open');

        // ── Fix 5: discoverability hint visible with nothing drawn ──
        console.log('\n[Fix 5] discoverability hint, nothing drawn yet');
        const hintVisible = await page.isVisible('#bt-no-drawing-hint');
        assert(hintVisible, 'hint is visible before any position tool is drawn');
        await shot(page, 'fix5-hint-visible');

        // ── Fix 2: New Trade with nothing drawn/selected ──
        console.log('\n[Fix 2] New Trade with nothing drawn opens the ticket on Market');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        const marketActive = await page.$eval('[data-seg-group="orderType"] [data-seg-val="market"]', el => el.classList.contains('active'));
        assert(marketActive, 'ticket opens on Market when nothing was drawn/selected');
        let reasonText = await page.textContent('.bt-ticket-disabled-reason').catch(() => null);
        assert((reasonText || '').includes('Enter a stop loss'), `disabled reason reads "Enter a stop loss" (got "${reasonText}")`);
        await shot(page, 'fix2-new-trade-empty-sl');
        await page.fill('#bt-ticket-sl', await page.evaluate(() => (btComputeTicket().entry * 0.98).toFixed(2)));
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const placeDisabledAfterSl = await page.getAttribute('#bt-ticket-place-btn', 'disabled');
        assert(placeDisabledAfterSl === null, 'Place Trade enabled once a stop loss is entered');
        await shot(page, 'fix2-new-trade-sl-filled');
        await page.click('#bt-ticket-close-x'); // Cancel -- don't submit this one

        // ── Draw a Long position tool for Fix 1/3/4 ──
        console.log('\n[setup] drawing a Long position tool');
        await dragPositionTool(page, 'position_long', 90);
        await page.waitForFunction(() => typeof btDrawings !== 'undefined' && btDrawings.length > 0);
        const hintHiddenAfterDraw = await page.isVisible('#bt-no-drawing-hint');
        assert(!hintHiddenAfterDraw, 'Fix 5: hint hides once a position tool exists');
        await shot(page, 'position-long-drawn');

        // btFinalizeNewDrawing() auto-selects a freshly-drawn position tool, so the
        // toolbar is already showing -- no extra click needed (and a click at a guessed
        // coordinate risks MISSING the box and deselecting it instead, per Fix 5's own
        // "clicking anywhere inside a position box selects it," which cuts both ways).
        const drawingInfo = await page.evaluate(() => {
            const d = btDrawings[btDrawings.length - 1];
            return { id: d.id, entry: d.settings.entry, stop_loss: d.settings.stop_loss, take_profit: d.settings.take_profit };
        });
        const box = await page.locator('.tv-chart-wrap').boundingBox();
        await page.waitForSelector('#bt-pos-toolbar', { state: 'visible' });
        await shot(page, 'fix4-long-toolbar');
        const overlapLong = await page.evaluate(() => {
            const toolbar = document.getElementById('bt-pos-toolbar').getBoundingClientRect();
            const d = btDrawings[btDrawings.length - 1];
            const bounds = d._btPillBounds;
            if (!bounds) return null;
            // bounds are canvas-local (overlay), toolbar rect is viewport -- both canvases
            // share the same top-left as .tv-chart-wrap, so offset by the overlay's own rect.
            const overlayRect = document.getElementById('bt-draw-overlay').getBoundingClientRect();
            const pillTopViewport = overlayRect.top + bounds.top;
            const pillBottomViewport = overlayRect.top + bounds.bottom;
            const overlaps = toolbar.bottom > pillTopViewport && toolbar.top < pillBottomViewport;
            return { overlaps, toolbar, pillTopViewport, pillBottomViewport };
        });
        assert(overlapLong && !overlapLong.overlaps, `Fix 4: toolbar does not overlap a pill for Long (${JSON.stringify(overlapLong)})`);

        // ── Fix 1 + Fix 3: open the ticket, force Limit, then switch to Market ──
        console.log('\n[Fix 1 + Fix 3] Keep-3R recompute + drawing/ticket sync on orderType switch');
        await page.click('#bt-pos-toolbar-place');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.click('[data-seg-group="orderType"] [data-seg-val="limit"]');
        const beforeSwitch = await page.evaluate(() => ({ ticket: { ...btTicket }, computed: btComputeTicket() }));
        assert(beforeSwitch.ticket.keep3R === true, 'Keep 3R is on by default');
        approxEqual(
            beforeSwitch.ticket.takeProfit,
            beforeSwitch.computed.entry + 3 * (beforeSwitch.computed.entry - beforeSwitch.ticket.stopLoss),
            0.01,
            'TP is 3R from entry/SL before switching order type'
        );
        await shot(page, 'fix1-before-market-switch');

        await page.click('[data-seg-group="orderType"] [data-seg-val="market"]');
        const afterSwitch = await page.evaluate(() => ({ ticket: { ...btTicket }, computed: btComputeTicket() }));
        const expectedTp = afterSwitch.computed.entry + 3 * (afterSwitch.computed.entry - afterSwitch.ticket.stopLoss);
        approxEqual(afterSwitch.ticket.takeProfit, expectedTp, 0.01, 'Fix 1: TP recomputed from the Market entry (not the stale Limit entry)');
        approxEqual(afterSwitch.computed.rr, 3.00, 0.01, 'Fix 1: RR reads 1:3.00 after switching to Market with Keep 3R on');
        await shot(page, 'fix1-after-market-switch');

        // Fix 3: the drawing's own pills should now read the ticket's Market entry/TP,
        // not the original drawn values.
        const pillsAfterSwitch = await page.evaluate(() => {
            const d = btDrawings.find(x => x.id === btTicket.sourceDrawingId);
            return d ? { entry: d.settings.entry, take_profit: d.settings.take_profit } : null;
        });
        assert(pillsAfterSwitch !== null, 'Fix 3: source drawing is resolvable while ticket is open');
        assert(
            Math.abs(pillsAfterSwitch.entry - drawingInfo.entry) < 1e-9 && Math.abs(pillsAfterSwitch.take_profit - drawingInfo.take_profit) < 1e-9,
            'Fix 3: d.settings itself is untouched while the ticket is open (render-only override)'
        );
        // The actual on-screen numbers come from btTicketRenderValues(), read directly:
        const renderVals = await page.evaluate(() => btTicketRenderValues());
        approxEqual(renderVals.entry, afterSwitch.computed.entry, 0.01, 'Fix 3: rendered pill entry matches the ticket\'s effective (Market) entry');
        approxEqual(renderVals.take_profit, afterSwitch.ticket.takeProfit, 0.01, 'Fix 3: rendered pill TP matches the ticket\'s TP');
        await shot(page, 'fix3-pills-match-ticket');

        // Cancel -- Fix 3 says this restores the drawing's saved values (it was never
        // mutated, so this just re-confirms nothing leaked into d.settings).
        await page.click('#bt-ticket-close-x');
        const afterCancel = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return d ? { entry: d.settings.entry, take_profit: d.settings.take_profit } : null;
        }, drawingInfo.id);
        assert(
            afterCancel && Math.abs(afterCancel.entry - drawingInfo.entry) < 1e-9 && Math.abs(afterCancel.take_profit - drawingInfo.take_profit) < 1e-9,
            'Fix 3: Cancel leaves the drawing at its original entry/TP'
        );
        await shot(page, 'fix3-after-cancel');
        // btCloseTicket() never touches btSelectedDrawingId (confirmed above -- the
        // toolbar reappeared after Cancel without a re-click), so it's still showing here.

        // ── Re-open, switch to Market, and submit -- verify the payload (Fix 1). ──
        console.log('\n[Fix 1 payload] submitting the ticket');
        await page.click('#bt-pos-toolbar-place');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.click('[data-seg-group="orderType"] [data-seg-val="market"]');
        const preSubmit = await page.evaluate(() => ({ ticket: { ...btTicket }, computed: btComputeTicket() }));

        const [response] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        const payload = (await response.json()).received;
        approxEqual(payload.take_profit, preSubmit.ticket.takeProfit, 0.01, 'Fix 1: submitted payload take_profit matches the recomputed 3R TP');
        assert(payload.type === 'market', 'submitted payload type is market');
        // The harness's own mock intentionally returns {error:'MOCK'} for this action (so
        // nothing ever looks like a real fill) -- btSubmitTicket() surfaces that via an
        // error toast and returns before reaching btCloseTicket()/btUpdateDrawing(), so
        // the ticket stays open here. That's the mock's documented behavior, not a bug.
        await page.waitForSelector('.toast.error.show', { state: 'visible' });
        await shot(page, 'fix1-payload-submitted-mock-error');

        // ── Fix 3 save-on-place: btSubmitTicket()'s post-success path (save via
        // btUpdateDrawing(), then close) is unreachable through the mock above by design
        // -- exercised here with btApi() monkey-patched for just this one call, so the
        // REAL committed code in btSubmitTicket() still runs end-to-end in the browser;
        // only the network response is faked, not any app logic. ──
        console.log('\n[Fix 3 save-on-place] forcing a successful response to exercise the post-submit save');
        await page.evaluate(() => {
            window.__origBtApi = btApi;
            btApi = async (action, method, data) => {
                if (action === 'backtest_place_order') return { filled: true, entry_price: btComputeTicket().entry };
                return window.__origBtApi(action, method, data);
            };
        });
        await page.click('#bt-ticket-place-btn');
        await page.waitForSelector('#bt-ticket', { state: 'hidden' });
        await page.evaluate(() => { btApi = window.__origBtApi; });

        const savedDrawing = await page.evaluate((id) => {
            const d = btDrawings.find(x => x.id === id);
            return d ? { entry: d.settings.entry, take_profit: d.settings.take_profit } : null;
        }, drawingInfo.id);
        approxEqual(savedDrawing.entry, preSubmit.computed.entry, 0.01, 'Fix 3: Place Trade saved the ticket\'s entry into the drawing');
        approxEqual(savedDrawing.take_profit, preSubmit.ticket.takeProfit, 0.01, 'Fix 3: Place Trade saved the ticket\'s TP into the drawing');
        await shot(page, 'fix3-saved-after-place');

        // ── Fix 4 for Short: draw one and check the toolbar again (auto-selected, same
        // as the Long case above -- no extra click). ──
        console.log('\n[Fix 4] Short position toolbar placement');
        await dragPositionTool(page, 'position_short', 90);
        await page.waitForFunction(() => btDrawings.length > 1);
        await page.waitForSelector('#bt-pos-toolbar', { state: 'visible' });
        await shot(page, 'fix4-short-toolbar');
        const overlapShort = await page.evaluate(() => {
            const toolbar = document.getElementById('bt-pos-toolbar').getBoundingClientRect();
            const d = btDrawings[btDrawings.length - 1];
            const bounds = d._btPillBounds;
            if (!bounds) return null;
            const overlayRect = document.getElementById('bt-draw-overlay').getBoundingClientRect();
            const pillTopViewport = overlayRect.top + bounds.top;
            const pillBottomViewport = overlayRect.top + bounds.bottom;
            const overlaps = toolbar.bottom > pillTopViewport && toolbar.top < pillBottomViewport;
            return { overlaps, toolbar, pillTopViewport, pillBottomViewport };
        });
        assert(overlapShort && !overlapShort.overlaps, `Fix 4: toolbar does not overlap a pill for Short (${JSON.stringify(overlapShort)})`);

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
