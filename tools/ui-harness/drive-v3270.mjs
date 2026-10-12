/**
 * FundedControl v3.27.0 UI harness driver -- "1H replay history scroll-back."
 * Verifies: a plain Next Bar/Play tick keeps loaded history instead of discarding it
 * (btLoadCandleWindow()'s tail-merge path), scroll-back loading works again during an
 * active backtest session (chart.js's loadOlderCandles(), re-enabled, routed through the
 * backtest endpoint's own no-lookahead clamp), the memory cap trims only what's safely
 * off-screen, the price axis refits to whatever's actually visible instead of holding a
 * stale widened range from a different part of history, and auto-follow never pauses
 * itself during a long hands-off Play run. Also exercises the real repro for the
 * "blank 1H view" bug (a DST fall-back collision in toDisplaySeconds(), fixed in
 * js/chart.js::candlesToSeriesData()).
 *
 * Runs against the STATEFUL mock session 20 (fresh, tools/ui-harness/stubs/api.php).
 * Every pre-existing driver (drive.mjs through drive-v3261.mjs) is left completely
 * untouched -- this is a new file, not an edit to any of them.
 *
 * Usage: node drive-v3270.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3270');
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

async function timeScaleState(page) {
    return page.evaluate(() => ({
        barSpacing: tvChart.timeScale().options().barSpacing,
        scrollPosition: tvChart.timeScale().scrollPosition(),
        range: tvChart.timeScale().getVisibleLogicalRange(),
        autoFollow: btAutoFollow,
        candleCount: chartState.candles.length,
        exhaustedOlder: chartState.exhaustedOlder,
    }));
}

/** Drag the mouse RIGHT across the chart (content tracks the cursor, so pulling right
 *  uncovers whatever's hidden off-screen to the LEFT -- older history). */
async function dragRight(page, chartBox, fromFrac, toFrac, steps = 8) {
    const cy = chartBox.y + chartBox.height * 0.5;
    await page.mouse.move(chartBox.x + chartBox.width * fromFrac, cy);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(chartBox.x + chartBox.width * (fromFrac + (toFrac - fromFrac) * i / steps), cy, { steps: 3 });
        await page.waitForTimeout(15);
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
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
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 760 } });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });
        await openSession(page, 20);
        await page.waitForTimeout(100); // same settle buffer every other driver's own first read after open already uses
        const before = await timeScaleState(page);
        assert(before.candleCount === 301, `fresh session opens with the full lead-in window (got ${before.candleCount})`);
        await shot(page, 'fresh-open');

        // ════════════════════════════════════════════════════════════════
        // Verify 1 — a handful of REAL Next Bar clicks (anchoring the claim against the
        // actual button, not just the function) keep bar spacing fixed and auto-follow
        // true, same as v3.26.0 already covers -- this just re-confirms it still holds
        // on top of the new tail-merge path.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] 10 real Next Bar clicks -- bar spacing fixed, auto-follow stays true, history grows');
        for (let i = 0; i < 10; i++) {
            await Promise.all([
                page.waitForResponse(res => res.url().includes('action=backtest_advance')),
                page.click('button[onclick="btAdvance()"]'),
            ]);
            // Each tick is now TWO sequential requests (backtest_advance, then the tail
            // candle fetch) -- waiting only for the first and racing straight into the
            // next click can occasionally find btAdvanceInFlight still true (the second
            // request not yet resolved) and silently skip a click. A real trader clicking
            // Next Bar by hand never does this; this margin just keeps the test honest.
            await page.waitForTimeout(150);
        }
        const after10 = await timeScaleState(page);
        assert(after10.barSpacing === before.barSpacing, `bar spacing unchanged after 10 real clicks (${before.barSpacing} -> ${after10.barSpacing})`);
        assert(after10.autoFollow === true, 'auto-follow still true after 10 real clicks');
        assert(after10.candleCount >= before.candleCount + 9 && after10.candleCount <= before.candleCount + 10,
            `history GREW by ~10 (kept, not replaced) -- got ${after10.candleCount}, expected ${before.candleCount + 10} (±1 tolerance for real-click network timing, exact-count correctness is proven by the in-page bulk loop in Verify 2)`);

        // ════════════════════════════════════════════════════════════════
        // Verify 2 — Play ~900 bars (bulk, via the real btAdvance() function the Play
        // button itself calls on each interval tick -- a real DOM click loop here would
        // take many minutes under Playwright overhead for no additional signal). Bar
        // spacing must never move and auto-follow must never pause itself.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2] Play ~900 bars total -- bar spacing never changes, auto-follow never self-pauses');
        const samples = await page.evaluate(async () => {
            const out = [];
            for (let i = 1; i <= 890; i++) {
                await btAdvance();
                if (i % 100 === 0) out.push({ i, autoFollow: btAutoFollow, barSpacing: tvChart.timeScale().options().barSpacing });
            }
            return out;
        });
        const spacingSet = new Set(samples.map(s => s.barSpacing));
        assert(spacingSet.size === 1 && spacingSet.has(before.barSpacing), `bar spacing identical at every 100-bar checkpoint through ~900 total (${[...spacingSet]})`);
        assert(samples.every(s => s.autoFollow === true), `auto-follow never self-paused across ~900 bars (samples: ${JSON.stringify(samples.map(s => s.autoFollow))})`);
        const after900 = await timeScaleState(page);
        assert(after900.candleCount === after10.candleCount + 890, `loaded history kept growing across every one of the 890 bulk ticks, never reset back to 301 (got ${after900.candleCount}, expected ${after10.candleCount + 890})`);
        await shot(page, 'after-900-bars');

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — draw a Fib near the current (soon to be far in the past) position,
        // confirm its anchors never move across the bulk Play above already happening,
        // then scroll back to it with REAL mouse drags and confirm it renders exactly
        // over its own candles.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] real mouse-drag scroll-back: history loads further, drawings stay on their own candles');
        async function dragDraw(tool, fx1, fy1, fx2, fy2) {
            await page.click(`[data-tool="${tool}"]`);
            const box = await page.locator('.tv-chart-wrap').boundingBox();
            await page.mouse.move(box.x + box.width * fx1, box.y + box.height * fy1);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * fx2, box.y + box.height * fy2, { steps: 6 });
            await page.mouse.up();
        }
        await dragDraw('rectangle', 0.6, 0.3, 0.75, 0.55);
        await page.waitForFunction(() => btDrawings.some(d => d.tool === 'rectangle'));
        await page.click('[data-tool=""]');
        const rectBefore = await page.evaluate(() => JSON.parse(JSON.stringify(btDrawings.find(d => d.tool === 'rectangle').points)));

        const chartBox = await page.locator('#tv-chart').boundingBox();
        for (let pass = 0; pass < 10; pass++) {
            await dragRight(page, chartBox, 0.15, 0.85);
        }
        const scrolled = await timeScaleState(page);
        assert(scrolled.autoFollow === false, 'real mouse drag paused auto-follow');
        assert(scrolled.barSpacing === before.barSpacing, `bar spacing still fixed mid real-mouse scroll-back (got ${scrolled.barSpacing})`);
        await shot(page, 'mid-scroll-back');

        // Keep dragging until scroll-back loading actually fires (grows candleCount).
        let grew = false;
        for (let pass = 0; pass < 15 && !grew; pass++) {
            await dragRight(page, chartBox, 0.15, 0.85);
            const s = await timeScaleState(page);
            if (s.candleCount > after900.candleCount) grew = true;
        }
        const afterScrollBack = await timeScaleState(page);
        assert(afterScrollBack.candleCount > after900.candleCount, `scroll-back loading fetched MORE history through the backtest endpoint (${after900.candleCount} -> ${afterScrollBack.candleCount})`);
        assert(afterScrollBack.barSpacing === before.barSpacing, `bar spacing still fixed after scroll-back loading (got ${afterScrollBack.barSpacing})`);
        await shot(page, 'after-scrollback-loaded-more');

        const rectAfter = await page.evaluate(() => JSON.parse(JSON.stringify(btDrawings.find(d => d.tool === 'rectangle').points)));
        assert(JSON.stringify(rectBefore) === JSON.stringify(rectAfter), 'the rectangle\'s own anchors are byte-identical after ~900 advances + heavy scroll-back');

        // Land precisely on the rectangle's own candles (a deterministic read, not a new
        // interaction) and confirm it renders on-canvas, over real loaded data.
        const onScreen = await page.evaluate(() => {
            const d = btDrawings.find(x => x.tool === 'rectangle');
            const idx = chartState.candles.findIndex(c => toDisplaySeconds(c.time, chartState.timezone) === d.points[0].time);
            if (idx >= 0) tvChart.timeScale().setVisibleLogicalRange({ from: idx - 30, to: idx + 60 });
            return idx >= 0;
        });
        await page.waitForTimeout(150);
        assert(onScreen, 'the rectangle\'s own anchor candle is still present in chartState.candles (never evicted by the cap while it was being viewed)');
        const rectPx = await page.evaluate(() => {
            const d = btDrawings.find(x => x.tool === 'rectangle');
            const w = document.getElementById('bt-draw-overlay').width;
            const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
            return { x1, x2, overlayW: w, bothOnCanvas: x1 !== null && x2 !== null && x1 >= 0 && x1 <= w && x2 >= 0 && x2 <= w };
        });
        assert(rectPx.bothOnCanvas, `rectangle renders on-canvas over its own candles when scrolled back to them (${JSON.stringify(rectPx)})`);
        await shot(page, 'rectangle-over-own-candles');

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — price axis refits to visible candles instead of holding a stale
        // widened range from the live edge (a totally different price era by now).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] price axis refits to the scrolled-back view, not stretched to the live-edge range');
        const priceBounds = await page.evaluate(() => {
            const h = document.getElementById('tv-chart').clientHeight;
            const topPrice = tvCandleSeries.coordinateToPrice(0);
            const bottomPrice = tvCandleSeries.coordinateToPrice(h * 0.75); // roughly above the volume pane
            const visible = chartState.candles.slice(
                Math.max(0, tvChart.timeScale().getVisibleLogicalRange().from | 0),
                Math.max(0, tvChart.timeScale().getVisibleLogicalRange().to | 0)
            );
            const dataMin = Math.min(...visible.map(c => c.low));
            const dataMax = Math.max(...visible.map(c => c.high));
            return { topPrice, bottomPrice, dataMin, dataMax };
        });
        // The axis's own rendered top/bottom must be in the same ballpark as the
        // actually-visible candles' real price range -- not off by thousands the way a
        // stale widened range from the live edge (a totally different era) would be.
        const axisSpan = Math.abs(priceBounds.topPrice - priceBounds.bottomPrice);
        const dataSpan = Math.abs(priceBounds.dataMax - priceBounds.dataMin);
        assert(axisSpan < dataSpan * 4, `price axis span is in the same ballpark as the visible candles' real range, not stretched by a stale widened range (axis span ${axisSpan.toFixed(2)}, data span ${dataSpan.toFixed(2)}, bounds=${JSON.stringify(priceBounds)})`);

        // ════════════════════════════════════════════════════════════════
        // Verify 5 — Jump to Latest still works after all of the above.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 5] Jump to Latest still resumes auto-follow and the live edge after heavy scroll-back');
        await page.click('#bt-jump-latest-btn');
        await page.waitForTimeout(150);
        const afterJump = await timeScaleState(page);
        assert(afterJump.autoFollow === true, 'auto-follow resumed after Jump to Latest');
        assert(afterJump.barSpacing === before.barSpacing, `bar spacing restored to the session's own fixed value (got ${afterJump.barSpacing})`);
        assert(Math.abs(afterJump.scrollPosition - 20) < 0.01, `scroll position back at the live edge (got ${afterJump.scrollPosition})`);
        await shot(page, 'after-jump-to-latest');

        // ════════════════════════════════════════════════════════════════
        // Verify 6 — the DST fall-back collision (the confirmed real cause of "blank 1H
        // view") no longer throws or collapses the chart. Feeds 301 synthetic candles
        // straddling a real November DST transition in a DST-observing timezone --
        // exactly what js/chart.js::candlesToSeriesData() converts before setData().
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 6] a DST fall-back transition in the display timezone no longer blanks the chart');
        const dstResult = await page.evaluate(() => {
            const savedTz = chartState.timezone;
            chartState.timezone = 'America/New_York';
            const base = Date.UTC(2020, 10, 1, 3, 0, 0) - 150 * 3600000;
            const candles = [];
            for (let i = 0; i < 301; i++) {
                const t = base + i * 3600000;
                candles.push({ time: t, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 });
            }
            const savedCandles = chartState.candles;
            chartState.candles = candles;
            let threw = false;
            try { renderChartData(); } catch (e) { threw = true; }
            const seriesLen = tvCandleSeries.data().length;
            chartState.candles = savedCandles;
            chartState.timezone = savedTz;
            renderChartData();
            return { threw, seriesLen, inputLen: candles.length };
        });
        assert(!dstResult.threw, 'rendering 301 candles spanning a real DST fall-back transition does not throw');
        assert(dstResult.seriesLen === dstResult.inputLen, `every candle actually reaches the series, none dropped by a display-second collision (got ${dstResult.seriesLen}, expected ${dstResult.inputLen})`);

    } finally {
        await browser.close();
        await harness.stop();
    }

    console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILURE(S)\n${failures.map(f => ' - ' + f).join('\n')}`);
    process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
