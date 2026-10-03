/**
 * FundedControl v3.22.6 UI harness driver -- price-axis manual-scale regression (Bug 1)
 * + overlapping closed-trade marker pills (Bug 2).
 *
 * Runs against the STATEFUL mock sessions v3.22.3's drive-v3223.mjs established (20
 * fresh, 21 pre-seeded with two identical open longs #132/#134 sharing the same stop/
 * take-profit -- exactly what Bug 2's own live report described -- stubs/api.php).
 * drive.mjs, drive-v3223.mjs and drive-v3225.mjs are all left completely untouched.
 *
 * Usage: node drive-v3226.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3226');
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

// Same pattern drive-v3225.mjs already established -- waits for each advance's own round
// trip before firing the next, so a fast loop can't race backtest_advance's own async chain.
async function advanceBars(page, n) {
    for (let i = 0; i < n; i++) {
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_advance')),
            page.click('button[onclick="btAdvance()"]'),
        ]);
        await page.waitForTimeout(40);
    }
}

// v3.22.5's own technique: patch fillText() once to capture every canvas-drawn pill's
// TEXT -- extended here to also capture X/Y, since Bug 2's own verification needs to know
// WHERE each pill landed, not just what it says.
async function installFillTextLog(page) {
    await page.evaluate(() => {
        window.__btFillTextLog = [];
        const proto = CanvasRenderingContext2D.prototype;
        if (!proto.__btFillTextPatchedV3226) {
            const orig = proto.fillText;
            proto.fillText = function (text, x, y, maxWidth) {
                window.__btFillTextLog.push({ text, x, y });
                return maxWidth !== undefined ? orig.call(this, text, x, y, maxWidth) : orig.call(this, text, x, y);
            };
            proto.__btFillTextPatchedV3226 = true;
        }
    });
}
async function clearFillTextLog(page) { await page.evaluate(() => { window.__btFillTextLog = []; }); }

/** Drags the price axis itself (not a drawing, not the plot area) by `dy` pixels,
 *  starting from the vertical middle of the axis strip -- the one gesture Bug 1's whole
 *  regression is about. Coordinates are computed from #bt-draw-overlay's own bounding
 *  box, the same coordinate frame every hit-test in js/backtest-drawings.js already uses,
 *  and the price-scale width comes straight from the chart's own API rather than a
 *  guessed pixel count. */
async function dragPriceAxis(page, dy) {
    const overlayBox = await page.locator('#bt-draw-overlay').boundingBox();
    const priceScaleW = await page.evaluate(() => tvChart.priceScale('right').width());
    const x = overlayBox.x + overlayBox.width - priceScaleW / 2;
    const y = overlayBox.y + overlayBox.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const STEPS = 10;
    for (let i = 1; i <= STEPS; i++) {
        await page.mouse.move(x, y + dy * (i / STEPS));
    }
    await page.mouse.up();
}

async function getAutoScaleState(page) {
    return page.evaluate(() => ({
        autoScale: tvCandleSeries.priceScale().options().autoScale,
        manualFlag: typeof btUserPriceScaleManual !== 'undefined' ? btUserPriceScaleManual : null,
    }));
}

/** Whether `price` currently falls inside the visible, on-screen portion of the price
 *  axis -- the direct, numeric version of "is this level in view" rather than eyeballing
 *  a screenshot. */
async function priceIsInView(page, price) {
    return page.evaluate((p) => {
        const y = tvCandleSeries.priceToCoordinate(p);
        if (y === null || y === undefined || !isFinite(y)) return false;
        return y >= 0 && y <= btDrawOverlay.height;
    }, price);
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

    const harness = await setupHarness({ port: 8769 });
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

        // ════════════════════════════════════════════════════════════════
        // Verify 1+2 — session 20 (fresh): drag the axis, hold it through 20 Next Bar
        // steps + mouse moves, then both ways back to auto.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[setup] session 20 — place a market trade so there are real SL/TP levels to track');
        await openSession(page, 20);
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const tpOnChecked = await page.isChecked('#bt-ticket-tp-on');
        if (!tpOnChecked) { await page.check('#bt-ticket-tp-on'); await page.dispatchEvent('#bt-ticket-tp-on', 'change'); }
        await page.fill('#bt-ticket-tp', '8990');
        await page.dispatchEvent('#bt-ticket-tp', 'change');
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        await page.waitForSelector('#bt-ticket', { state: 'hidden' });
        const pos20 = await page.evaluate(() => btSession.open_positions[0]);
        assert(pos20 && pos20.stop_loss === 8600, `setup: trade placed with stop_loss=8600 (got ${pos20 && pos20.stop_loss})`);
        await shot(page, 'setup-trade-placed-auto');

        const beforeDrag = await getAutoScaleState(page);
        assert(beforeDrag.autoScale === true, 'before any drag, autoScale is on (the v3.22.5 nudge already put these levels in view)');

        console.log('\n[Verify 1] dragging the price axis engages a manual scale');
        await dragPriceAxis(page, 180);
        const afterDrag = await getAutoScaleState(page);
        assert(afterDrag.autoScale === false, `dragging the axis turns autoScale off (got ${afterDrag.autoScale})`);
        assert(afterDrag.manualFlag === true, `btUserPriceScaleManual is set once the axis is dragged (got ${afterDrag.manualFlag})`);
        await shot(page, 'verify1-axis-dragged-manual');

        console.log('\n[Verify 1] the manual scale survives 20 Next Bar steps + mouse moves');
        for (let i = 0; i < 20; i++) {
            await Promise.all([
                page.waitForResponse(res => res.url().includes('action=backtest_advance')),
                page.click('button[onclick="btAdvance()"]'),
            ]);
            // Mouse moves over the plot area are exactly the "every render pass" case
            // v3.22.5 Fix A's own unconditional nudge broke this on -- each one triggers
            // a redraw via btOnDrawMouseMove()'s hover-cursor branch.
            const chartBox = await page.locator('.tv-chart-wrap').boundingBox();
            await page.mouse.move(chartBox.x + chartBox.width * 0.3, chartBox.y + chartBox.height * (0.3 + 0.01 * (i % 5)));
            await page.waitForTimeout(25);
        }
        const afterHold = await getAutoScaleState(page);
        assert(afterHold.autoScale === false, `Bug 1 regression check: autoScale is STILL off after 20 advances + mouse moves (got ${afterHold.autoScale})`);
        assert(afterHold.manualFlag === true, 'btUserPriceScaleManual is still set after 20 advances + mouse moves');
        await shot(page, 'verify1-manual-scale-held-20-advances');

        console.log('\n[Verify 2] double-clicking the price axis resets to auto');
        const overlayBox = await page.locator('#bt-draw-overlay').boundingBox();
        const priceScaleW = await page.evaluate(() => tvChart.priceScale('right').width());
        const axisX = overlayBox.x + overlayBox.width - priceScaleW / 2;
        const axisY = overlayBox.y + overlayBox.height * 0.5;
        await page.mouse.dblclick(axisX, axisY);
        await page.waitForTimeout(100);
        const afterDblClick = await getAutoScaleState(page);
        assert(afterDblClick.autoScale === true, `double-clicking the axis re-enables autoScale (got ${afterDblClick.autoScale})`);
        assert(afterDblClick.manualFlag === false, 'btUserPriceScaleManual clears once auto is back on');
        const slInView1 = await priceIsInView(page, 8600);
        const tpInView1 = await priceIsInView(page, 8990);
        assert(slInView1, 'Stop Loss (8600) is back in view after double-click reset');
        assert(tpInView1, 'Take Profit (8990) is back in view after double-click reset');
        await shot(page, 'verify2-dblclick-reset-levels-in-view');

        console.log('\n[Verify 2] the "A" button also resets to auto, and is highlighted while on');
        const activeBeforeDrag = await page.evaluate(() => document.getElementById('bt-autoscale-toggle').classList.contains('active'));
        assert(activeBeforeDrag, 'the "A" button is highlighted while auto-scale is on');
        await dragPriceAxis(page, -180);
        const manualAgain = await getAutoScaleState(page);
        assert(manualAgain.autoScale === false, 'dragging again re-engages manual (setup for the "A" button check)');
        const activeWhileManual = await page.evaluate(() => document.getElementById('bt-autoscale-toggle').classList.contains('active'));
        assert(!activeWhileManual, 'the "A" button loses its highlight once the scale is manual');
        await shot(page, 'verify2-a-button-dim-while-manual');
        await page.click('#bt-autoscale-toggle');
        await page.waitForTimeout(100);
        const afterAButton = await getAutoScaleState(page);
        assert(afterAButton.autoScale === true, `clicking "A" re-enables autoScale (got ${afterAButton.autoScale})`);
        assert(afterAButton.manualFlag === false, 'btUserPriceScaleManual clears after clicking "A"');
        const activeAfterAButton = await page.evaluate(() => document.getElementById('bt-autoscale-toggle').classList.contains('active'));
        assert(activeAfterAButton, 'the "A" button is highlighted again immediately after clicking it');
        await shot(page, 'verify2-a-button-reset');

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — session 21 (pre-seeded): a NEW trade re-enables auto-scale once,
        // even over a manual scale.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[setup] session 21 — pre-seeded with two open longs + one pending order');
        await openSession(page, 21);
        await dragPriceAxis(page, 180);
        const manualOnSession21 = await getAutoScaleState(page);
        assert(manualOnSession21.autoScale === false, 'session 21: axis drag engages manual scale');
        await shot(page, 'verify3-session21-manual-before-new-trade');

        console.log('\n[Verify 3] placing a brand-new trade re-enables auto-scale once, over the manual scale');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        // A wide, deliberately-unreachable stop so this trade survives the 30-bar advance
        // run in Verify 4 below untouched -- it exists only to exercise the "new position
        // re-enables auto" override, not to interact with the same-bar-close scenario.
        // 500 points is comfortably outside mockPriceAtIndex()'s own total amplitude
        // (+-360 around its 8500 baseline, so this level is never reachable at all) while
        // staying well short of 5x leverage's own liquidation distance (~20% of entry) --
        // a wider stop here trips the ticket's OWN liquidation-before-stop guard instead
        // of placing the trade, confirmed by hand while writing this test.
        const entryNow = await page.evaluate(() => btComputeTicket().entry);
        await page.fill('#bt-ticket-sl', String(Math.round(entryNow - 500)));
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const tpOnChecked21 = await page.isChecked('#bt-ticket-tp-on');
        if (tpOnChecked21) { await page.uncheck('#bt-ticket-tp-on'); await page.dispatchEvent('#bt-ticket-tp-on', 'change'); }
        const newTradeEntry = await page.evaluate(() => btComputeTicket().entry);
        const newTradeStop = await page.evaluate(() => btTicket.stopLoss);
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        await page.waitForSelector('#bt-ticket', { state: 'hidden' });
        await page.waitForTimeout(100);
        const afterNewTrade = await getAutoScaleState(page);
        assert(afterNewTrade.autoScale === true, `Verify 3: a new trade re-enables auto-scale even over a manual scale (got ${afterNewTrade.autoScale})`);
        assert(afterNewTrade.manualFlag === false, 'Verify 3: btUserPriceScaleManual clears once the new trade forces the override');
        const entryInView = await priceIsInView(page, newTradeEntry);
        const stopInView = await priceIsInView(page, newTradeStop);
        assert(entryInView, `Verify 3: the new trade's own entry (${newTradeEntry}) is visible`);
        assert(stopInView, `Verify 3: the new trade's own stop (${newTradeStop}) is visible`);
        await shot(page, 'verify3-new-trade-forced-autoscale');

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — same session 21: trades #132/#134 share an identical stop/
        // take-profit and entry time; advancing to the bar where price first reaches
        // 8600 closes both on the SAME bar (confirmed by hand against stubs/api.php's
        // own deterministic mockPriceAtIndex() -- bar index 480's high, 8608.11, is the
        // first to cross the shared take-profit of 8600; neither stop (8000) nor that
        // take-profit is touched by any bar between index 450 and 479).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] advancing to the bar where #132/#134 close together (same time_out)');
        await clearFillTextLog(page);
        await advanceBars(page, 30);
        const closedPair = await page.evaluate(() => btSession.closed_trades.filter(t => t.id === 132 || t.id === 134));
        assert(closedPair.length === 2, `both #132 and #134 are closed (got ${closedPair.length})`);
        assert(closedPair.length === 2 && closedPair[0].time_out === closedPair[1].time_out,
            `Verify 4 setup: both closed on the exact same bar (time_out ${closedPair[0] && closedPair[0].time_out} vs ${closedPair[1] && closedPair[1].time_out})`);
        assert(closedPair.every(t => t.exit_reason === 'Take Profit' && t.exit_price === 8600),
            'Verify 4 setup: both closed via the shared 8600 take-profit, as computed by hand against the mock\'s own candle sequence');
        await shot(page, 'verify4-same-bar-close');

        // advanceBars() leaves one or more of its own btLoadCandleWindow()-scheduled
        // redraws still pending (rAF-coalesced, but 30 steps queue a fresh one each time),
        // so even a forced extra render here can land ahead of a leftover frame that fires
        // moments later — the fillText log ends up with the SAME (text,x,y) pill captured
        // more than once, not spurious extra pills at different spots. De-duplicating is
        // the right check: it directly asserts "exactly two DISTINCT, separated positions,
        // identical and stable across however many passes actually fired" rather than
        // fighting rAF timing to isolate a single pass.
        await clearFillTextLog(page);
        await page.evaluate(() => btRenderDrawings());
        const rawPills = await page.evaluate(() => window.__btFillTextLog
            .filter(e => /R (TP|SL|Manual)/.test(e.text))
            .map(e => ({ text: e.text, x: Math.round(e.x), y: Math.round(e.y) })));
        const seen = new Set();
        const pillTexts = rawPills.filter(p => {
            const key = `${p.text}|${p.x}|${p.y}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // Two trades, identical exit, identical direction -> identical natural pill
        // position before this fix. After it, exactly one pair of same-bar exit pills is
        // drawn, offset from each other by PILL_H(22) + GAP(4) = 26px vertically, never
        // at the same (or overlapping) position.
        assert(pillTexts.length === 2, `Bug 2: exactly two DISTINCT exit-reason pill positions for the shared-bar close (got ${pillTexts.length} unique of ${rawPills.length} raw: ${JSON.stringify(pillTexts)})`);
        if (pillTexts.length === 2) {
            const dy = Math.abs(pillTexts[0].y - pillTexts[1].y);
            assert(dy >= 20, `Bug 2: the two pills are vertically separated, not overlapping (got ${dy}px apart, expected ~26px)`);
            assert(pillTexts[0].x === pillTexts[1].x, 'Bug 2: both pills share the same bar (same x), confirming this is the same-bar overlap case, not two unrelated bars');
            for (const p of pillTexts) {
                assert(/^[+−-]?\d+\.\d{2}R (TP|SL|Manual)$/.test(p.text), `Bug 2: pill text is fully formed, not garbled (got "${p.text}")`);
            }
        }

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
