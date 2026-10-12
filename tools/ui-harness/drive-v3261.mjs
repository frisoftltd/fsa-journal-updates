/**
 * FundedControl v3.26.1 UI harness driver -- double-click on the replay chart must never
 * call fitContent() during an active backtest session (chart.js's own dblclick handler
 * was a second, separate trigger for the exact "chart stretches" bug v3.26.0 fixed for
 * Play/Next Bar/Rewind, missed by that release's own audit since it isn't part of the
 * step path). A double-click now does what Jump to Latest does instead: restore the
 * fixed bar spacing, resume auto-follow, scroll to the live edge, no fit.
 *
 * Runs against the STATEFUL mock session 20 (fresh, tools/ui-harness/stubs/api.php).
 * Every pre-existing driver (drive.mjs through drive-v3250.mjs) is left completely
 * untouched -- this is a new file, not an edit to any of them.
 *
 * Usage: node drive-v3261.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3261');
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

async function timeScaleState(page) {
    return page.evaluate(() => ({
        barSpacing: tvChart.timeScale().options().barSpacing,
        scrollPosition: tvChart.timeScale().scrollPosition(),
        range: tvChart.timeScale().getVisibleLogicalRange(),
        autoFollow: btAutoFollow,
        jumpBtnVisible: document.getElementById('bt-jump-latest-btn').style.display !== 'none',
    }));
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

    const harness = await setupHarness({ port: 8771 });
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
        await openSession(page, 20);
        await advanceBars(page, 5); // land somewhere mid-replay, not just the fresh-open position
        await page.waitForTimeout(100);

        // ════════════════════════════════════════════════════════════════
        // Verify 1 — a real double-click on empty chart area during an active session
        // does NOT call fitContent(): bar spacing is unchanged, auto-follow stays true,
        // no candle compression.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] double-click on the chart during an active session never calls fitContent()');
        const before = await timeScaleState(page);
        await shot(page, 'before-dblclick');
        const box = await page.locator('#tv-chart').boundingBox();
        await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
        await page.waitForTimeout(200);
        const after = await timeScaleState(page);
        await shot(page, 'after-dblclick-on-empty-area');
        assert(after.barSpacing === before.barSpacing,
            `bar spacing unchanged by the double-click (before ${before.barSpacing}, after ${after.barSpacing})`);
        assert(after.autoFollow === true,
            `auto-follow is true after the double-click (got ${after.autoFollow})`);
        assert(after.jumpBtnVisible === false,
            `Jump to Latest button is hidden -- the double-click already did its job (visible=${after.jumpBtnVisible})`);
        assert(Math.abs(after.scrollPosition - 20) < 0.01,
            `scroll position is at the live edge (BT_RIGHT_MARGIN_BARS=20), not compressed to fit everything (got ${after.scrollPosition})`);

        // ════════════════════════════════════════════════════════════════
        // Verify 2 — double-click RESTORES the live edge when the trader had panned
        // away first (the exact "does what Jump to Latest does" requirement).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2] double-click after a manual pan restores the fixed spacing + live edge (acts as Jump to Latest)');
        const chartBox = await page.locator('#tv-chart').boundingBox();
        const cy = chartBox.y + chartBox.height * 0.5;
        await page.mouse.move(chartBox.x + chartBox.width * 0.7, cy);
        await page.mouse.down();
        for (let i = 1; i <= 6; i++) {
            await page.mouse.move(chartBox.x + chartBox.width * (0.7 - 0.4 * i / 6), cy, { steps: 1 });
            await page.waitForTimeout(15);
        }
        await page.mouse.up();
        await page.waitForTimeout(150);
        const panned = await timeScaleState(page);
        assert(panned.autoFollow === false, `manual pan paused auto-follow first, as a precondition (got ${panned.autoFollow})`);
        await shot(page, 'after-manual-pan');

        await page.mouse.dblclick(chartBox.x + chartBox.width * 0.5, cy);
        await page.waitForTimeout(200);
        const resumed = await timeScaleState(page);
        await shot(page, 'after-dblclick-resumes');
        assert(resumed.autoFollow === true, `double-click resumed auto-follow after a manual pan (got ${resumed.autoFollow})`);
        assert(resumed.barSpacing === before.barSpacing, `bar spacing restored to the session's own fixed value (expected ${before.barSpacing}, got ${resumed.barSpacing})`);
        assert(Math.abs(resumed.scrollPosition - 20) < 0.01, `scroll position restored to the live edge (got ${resumed.scrollPosition})`);
        assert(resumed.jumpBtnVisible === false, `Jump to Latest button hides again once the double-click did the same job (visible=${resumed.jumpBtnVisible})`);

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — double-clicking an actual DRAWING still opens its settings
        // popover and does NOT trigger the Jump-to-Latest path (pre-existing
        // btOnDrawDblClick() stopPropagation() behavior, backtest-drawings.js, must be
        // untouched by this release).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] double-clicking an existing drawing still opens its settings popover (unaffected regression check)');
        await page.click('[data-tool="rectangle"]');
        const wrapBox = await page.locator('.tv-chart-wrap').boundingBox();
        await page.mouse.move(wrapBox.x + wrapBox.width * 0.3, wrapBox.y + wrapBox.height * 0.3);
        await page.mouse.down();
        await page.mouse.move(wrapBox.x + wrapBox.width * 0.45, wrapBox.y + wrapBox.height * 0.45, { steps: 5 });
        await page.mouse.up();
        await page.waitForFunction(() => btDrawings.some(d => d.tool === 'rectangle'));
        await page.click('[data-tool=""]');
        const rectCenter = await page.evaluate(() => {
            const d = btDrawings.find(x => x.tool === 'rectangle');
            const x1 = btTimeToX(d.points[0].time), x2 = btTimeToX(d.points[1].time);
            const y1 = btPriceToY(d.points[0].price), y2 = btPriceToY(d.points[1].price);
            const wrap = document.querySelector('.tv-chart-wrap').getBoundingClientRect();
            return { x: wrap.x + (x1 + x2) / 2, y: wrap.y + (y1 + y2) / 2 };
        });
        const beforeDrawingDblClick = await timeScaleState(page);
        await page.mouse.dblclick(rectCenter.x, rectCenter.y);
        await page.waitForTimeout(150);
        const popoverVisible = await page.evaluate(() => {
            const p = document.getElementById('bt-draw-settings-popover');
            return !!p && p.style.display !== 'none' && p.style.display !== '';
        });
        const afterDrawingDblClick = await timeScaleState(page);
        assert(popoverVisible, 'double-clicking the rectangle drawing opened its settings popover');
        assert(afterDrawingDblClick.barSpacing === beforeDrawingDblClick.barSpacing,
            `double-clicking a drawing does not touch bar spacing either way (before ${beforeDrawingDblClick.barSpacing}, after ${afterDrawingDblClick.barSpacing})`);
        await shot(page, 'dblclick-on-drawing-opens-settings');

    } finally {
        await browser.close();
        await harness.stop();
    }

    console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILURE(S)\n${failures.map(f => ' - ' + f).join('\n')}`);
    process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
