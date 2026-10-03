/**
 * FundedControl v3.22.8 UI harness driver -- "Backtest session results and statistics."
 * Verifies the new Results page end to end against a hand-computed 10-trade fixture
 * (plus 2 rewound trades that must be excluded) -- stubs/api.php::mockResultsTrades(),
 * the exact same set backtest_engine.php's own self-test hand-verifies, session id 23.
 *
 * Runs against the STATEFUL mock. drive.mjs, drive-v3223.mjs, drive-v3225.mjs,
 * drive-v3226.mjs and drive-v3227.mjs are all untouched.
 *
 * Usage: node drive-v3228.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3228');
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
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 900 }, acceptDownloads: true });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });

        // ════════════════════════════════════════════════════════════════
        // Verify 1 + 2 — the raw get_backtest_results payload: metrics match the hand
        // calculation (the exact numbers backtest_engine.php's own self-test already
        // proved correct against this identical fixture), and the two rewound trades
        // are excluded.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1+2] get_backtest_results: hand-computed metrics, rewound trades excluded');
        const data = await page.evaluate(() => btApi('get_backtest_results&session_id=23'));
        assert(data && !data.error, `get_backtest_results returned successfully (got ${data && data.error})`);
        const o = data.metrics.overall;
        assert(data.trades.length === 10, `exactly 10 trades returned, the 2 rewound ones excluded (got ${data.trades.length})`);
        assert(!data.trades.some(t => t.r_multiple === 5.0), 'neither rewound trade (R=+5.0, a value no real trade in this fixture has) leaked into the trade list');
        assert(o.n === 10, `overall n = 10 (got ${o.n})`);
        assert(o.wins === 5 && o.losses === 4 && o.breakevens === 1, `5 wins / 4 losses / 1 breakeven (got ${o.wins}/${o.losses}/${o.breakevens})`);
        approxEqual(o.win_rate, 0.5, 0.0001, 'win rate = 5/10');
        approxEqual(o.total_r, 5.5, 0.0001, 'total R = 5.5');
        approxEqual(o.avg_r, 0.55, 0.0001, 'average R = 0.55');
        approxEqual(o.expectancy_r, o.avg_r, 0.0001, 'expectancy R equals average R exactly');
        approxEqual(o.avg_win_r, 1.9, 0.0001, 'avg win R = 1.9 (9.5/5)');
        approxEqual(o.avg_loss_r, -1.0, 0.0001, 'avg loss R = -1.0');
        approxEqual(o.profit_factor, 950 / 404, 0.0001, 'profit factor = 950/404');
        approxEqual(o.net_usd, 545, 0.0001, 'net $ = 545');
        approxEqual(o.total_fees, 10, 0.0001, 'total fees = 10');
        assert(o.longest_win_streak === 2 && o.longest_loss_streak === 2, `longest win/loss streaks = 2/2 (got ${o.longest_win_streak}/${o.longest_loss_streak})`);
        approxEqual(o.max_drawdown_usd, 203, 0.0001, 'max drawdown $ = 203');
        approxEqual(o.max_drawdown_pct, 202 / 10350 * 100, 0.0001, 'max drawdown % = 202/10350*100 (NOT the same point as the dollar max)');
        assert(data.metrics.long.n === 7 && data.metrics.short.n === 3, `Long/Short split = 7/3 (got ${data.metrics.long.n}/${data.metrics.short.n})`);
        assert(data.metrics.equity_curve.length === 10, `equity curve has one point per trade (got ${data.metrics.equity_curve.length})`);

        // The PHP self-test itself, run standalone, must also pass -- confirms the exact
        // same backtest_engine.php this page's own server route calls is self-consistent,
        // not just that this one fixture happens to produce the right numbers.
        console.log('\n[Verify 1] backtest_engine.php self-test');
        const { execSync } = await import('child_process');
        try {
            const out = execSync('php includes/backtest_engine.php', { cwd: harness.tmpDir, encoding: 'utf8' });
            assert(/self-test: \d+ passed, 0 failed/.test(out), `self-test reports 0 failed (output: ${out.trim()})`);
        } catch (e) {
            assert(false, `self-test exited non-zero: ${e.stdout || e.message}`);
        }

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — the Saved Backtests card shows a Results button and the
        // n/win-rate/expectancy summary line.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] Saved Backtests card: Results button + summary line');
        await page.evaluate(() => showPage('saved-backtests'));
        await page.waitForSelector('.sb-card', { state: 'visible' });
        const cardText = await page.locator('.sb-card').first().innerText();
        assert(/Results/.test(cardText), `card has a "Results" action (text: ${JSON.stringify(cardText)})`);
        assert(/10 trades/.test(cardText), 'card summary line shows the trade count (10 trades)');
        assert(/50%/.test(cardText), 'card summary line shows the win rate (50%)');
        assert(/\+0\.55R/.test(cardText), 'card summary line shows the expectancy (+0.55R)');
        await shot(page, 'verify3-card-results-and-summary');

        // ════════════════════════════════════════════════════════════════
        // Results page itself: header, tiles, metric table (3 columns), equity chart,
        // trade list — all panels render.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] Results page renders all panels');
        await page.click('.sb-card .btn-ghost:has-text("Results")');
        await page.waitForSelector('#page-backtest-results.active', { state: 'attached' });
        await page.waitForSelector('.br-header', { state: 'visible' });
        await page.waitForFunction(() => document.querySelectorAll('.br-tile').length > 0);
        const panels = await page.evaluate(() => ({
            tileCount: document.querySelectorAll('.br-tile').length,
            metricTableRows: document.querySelectorAll('.br-metric-table tbody tr').length,
            metricTableCols: document.querySelectorAll('.br-metric-table thead th').length,
            hasChartCanvas: !!document.getElementById('br-equity-chart'),
            tradeRows: document.querySelectorAll('.br-trade-table tbody tr').length,
        }));
        assert(panels.tileCount === 6, `6 stat tiles rendered (got ${panels.tileCount})`);
        assert(panels.metricTableRows === 18, `metric table has all 18 rows (got ${panels.metricTableRows})`);
        assert(panels.metricTableCols === 4, `metric table has 4 header cells -- blank + Overall/Long/Short (got ${panels.metricTableCols})`);
        assert(panels.hasChartCanvas, 'equity curve chart canvas is present');
        assert(panels.tradeRows === 10, `trade list has exactly 10 rows (got ${panels.tradeRows})`);
        await shot(page, 'results-page-all-panels');

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — EARLY SIGNAL banner at n < 30 (this fixture has n=10).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] EARLY SIGNAL banner shows at n < 30');
        const bannerText = await page.locator('.br-sample-banner').innerText();
        assert(bannerText === 'EARLY SIGNAL — 10 of 30 trades', `banner reads the exact required text (got "${bannerText}")`);
        assert(await page.locator('.br-sample-early').isVisible(), 'banner uses the "early" style, not the "positive expectancy" one');
        await shot(page, 'verify4-early-signal-banner');

        // ════════════════════════════════════════════════════════════════
        // Verify 5 — Download CSV: one row per trade, real browser download event, not
        // just a function-return-value check.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 5] Download CSV produces one row per trade');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('button:has-text("Download CSV")'),
        ]);
        const csvPath = await download.path();
        const csvText = fs.readFileSync(csvPath, 'utf8');
        const lines = csvText.trim().split('\n');
        assert(lines.length === 11, `CSV has 1 header row + 10 trade rows (got ${lines.length})`);
        assert(/^time_in,time_out,direction/.test(lines[0]), `CSV header row is well-formed (got "${lines[0]}")`);
        assert(download.suggestedFilename() === 'backtest-23-trades.csv', `CSV filename names the session (got "${download.suggestedFilename()}")`);

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
