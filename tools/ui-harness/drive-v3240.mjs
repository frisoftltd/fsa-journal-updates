/**
 * FundedControl v3.24.0 UI harness driver -- "FSA Gate 1 structure indicator in
 * Backtesting."
 *
 * Runs against the STATEFUL mock, one new session id added for this release (28, a
 * 'gated_overflow' strategy with 18 generic gate variables -- 19 rows total once the
 * engine's own dedicated row is added -- specifically to force the §0 checklist-overflow
 * case). Sessions 20/26/27 are reused unmodified from v3.23.0's own driver for the
 * gate1_auto_state/gate1_agree checks.
 *
 * drive.mjs through drive-v3230.mjs are all untouched.
 *
 * Usage: node drive-v3240.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3240');
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
    // Gate 1's own warm-up fetch is a separate round trip from the candle window itself
    // (js/backtest.js::btRebuildGate1FromScratch()) -- wait for it explicitly rather than
    // assuming it's done by the time the two waits above resolve.
    await page.waitForFunction(() => typeof gate1Snapshot !== 'undefined' && gate1Snapshot !== null);
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

    const harness = await setupHarness({ port: 8773 });
    console.log(`Harness up at ${harness.baseUrl} (temp copy: ${harness.tmpDir})`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });
    page.on('dialog', d => d.accept());

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });

        // ════════════════════════════════════════════════════════════════
        // Verify 0 — checklist overflow fix, at 1366×768 and 1920×1080. Session 28's
        // strategy has 8 generic gate variables + the engine's own dedicated row = 9.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 0] checklist overflow fix at 1366×768');
        await openSession(page, 28);
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        await page.click('#bt-ticket-place-btn');
        await page.waitForSelector('#bt-checklist-popup.open', { state: 'visible' });
        const itemCount = await page.evaluate(() => document.querySelectorAll('#bt-checklist-items .check-item').length);
        assert(itemCount === 19, `checklist has 19 rows -- 1 Gate 1 + 18 generic (got ${itemCount})`);
        const overflow1366 = await page.evaluate(() => {
            const wrap = document.getElementById('bt-checklist-items');
            return wrap.scrollHeight > wrap.clientHeight;
        });
        assert(overflow1366, 'items list actually overflows its own box at 1366×768 (the case this fix targets)');
        const btn1366 = await page.locator('text=Proceed to Order').boundingBox();
        assert(btn1366 && btn1366.y >= 0 && (btn1366.y + btn1366.height) <= 768, `Proceed button fully inside the 768px-tall viewport (got y=${btn1366 && btn1366.y}, bottom=${btn1366 && (btn1366.y + btn1366.height)})`);
        await shot(page, 'verify0-overflow-1366x768');

        console.log('\n[Verify 0] checklist overflow fix at 1920×1080');
        await page.setViewportSize({ width: 1920, height: 1080 });
        const btn1920 = await page.locator('text=Proceed to Order').boundingBox();
        assert(btn1920 && btn1920.y >= 0 && (btn1920.y + btn1920.height) <= 1080, `Proceed button fully inside the 1080px-tall viewport (got y=${btn1920 && btn1920.y}, bottom=${btn1920 && (btn1920.y + btn1920.height)})`);
        await shot(page, 'verify0-overflow-1920x1080');
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.click('#bt-checklist-popup .btn-ghost'); // Cancel -- this submission was only a layout probe

        // ════════════════════════════════════════════════════════════════
        // Verify 1 — the chart badge renders the exact Pine head text after warm-up.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] Gate 1 badge renders after warm-up');
        const badgeText = await page.evaluate(() => document.getElementById('bt-gate1-badge').innerText);
        assert(/^GATE 1: (BULLISH — longs only|BEARISH — shorts only|UNCLEAR — NO TRADE)/.test(badgeText), `badge shows an exact Pine head text (got "${badgeText.split('\n')[0]}")`);
        const badgeVisible1 = await page.evaluate(() => document.getElementById('bt-gate1-badge').style.display !== 'none');
        assert(badgeVisible1, 'badge is visible by default (toggle on)');

        console.log('\n[Verify 1] toolbar toggle hides/shows the badge, engine keeps running regardless');
        await page.click('#bt-gate1-toggle-btn');
        const badgeHidden = await page.evaluate(() => document.getElementById('bt-gate1-badge').style.display === 'none');
        assert(badgeHidden, 'toggling off hides the badge');
        const snapshotStillThere = await page.evaluate(() => gate1Snapshot !== null);
        assert(snapshotStillThere, 'the engine snapshot itself is untouched by the visibility toggle');
        await page.click('#bt-gate1-toggle-btn');
        const badgeShownAgain = await page.evaluate(() => document.getElementById('bt-gate1-badge').style.display !== 'none');
        assert(badgeShownAgain, 'toggling back on shows the badge again');
        await shot(page, 'verify1-badge-and-toggle');

        // ════════════════════════════════════════════════════════════════
        // Verify 2 — gate1_auto_state is recorded on EVERY order, even a strategy-less
        // session (20) that never shows any checklist at all.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2] gate1_auto_state always recorded, even with no checklist');
        await openSession(page, 20);
        const expectedAutoState = await page.evaluate(() => gate1Snapshot.state);
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const [placeRes20] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        assert((await placeRes20.json()).success, 'order placed on a strategy-less session with no checklist detour');
        await page.waitForFunction(() => btSession.open_positions.length >= 1);
        const pos20 = await page.evaluate(() => btSession.open_positions[btSession.open_positions.length - 1]);
        assert(pos20.gate1_auto_state === expectedAutoState, `gate1_auto_state matches the engine's own state at order time (got ${pos20 && pos20.gate1_auto_state}, expected ${expectedAutoState})`);
        assert(pos20.gates_passed === null || pos20.gates_passed === undefined, 'gates_passed stays null (no strategy)');
        assert(pos20.gate1_agree === null || pos20.gate1_agree === undefined, 'gate1_agree stays null (no checklist shown, nothing for the trader to confirm against)');

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — the checklist's dedicated Gate 1 row pre-fills correctly and
        // gate1_agree reflects whether the trader kept or overrode that suggestion.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] Gate 1 row pre-fill + gate1_agree=1 when kept as suggested');
        await openSession(page, 26);
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        await page.click('#bt-ticket-place-btn');
        await page.waitForSelector('#bt-checklist-popup.open', { state: 'visible' });
        const gate1RowState = await page.evaluate(() => ({
            checked: document.getElementById('bt-gate1-check-item').classList.contains('checked'),
            expected: btGate1AutoChecked(btTicket.direction),
        }));
        assert(gate1RowState.checked === gate1RowState.expected, `Gate 1 row pre-fills to the auto-suggested state (got ${gate1RowState.checked}, expected ${gate1RowState.expected})`);
        // Check the 2 generic gates too (gates_passed=1 path) -- leave the Gate 1 row AS
        // pre-filled, so gate1_agree should land as 1.
        await page.locator('#bt-checklist-items .check-item').nth(1).locator('.check-item-row').click();
        await page.locator('#bt-checklist-items .check-item').nth(2).locator('.check-item-row').click();
        const [placeRes26a] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('text=Proceed to Order'),
        ]);
        assert((await placeRes26a.json()).success, 'order placed from session 26 (kept Gate 1 suggestion)');
        await page.waitForFunction(() => btSession.open_positions.length >= 1);
        const pos26a = await page.evaluate(() => btSession.open_positions[0]);
        assert(pos26a.gate1_agree === 1, `gate1_agree=1 when the trader kept the auto-fill suggestion (got ${pos26a && pos26a.gate1_agree})`);
        await shot(page, 'verify3-gate1-agree-1');

        console.log('\n[Verify 3] gate1_agree=0 when the trader overrides the Gate 1 row');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        await page.click('#bt-ticket-place-btn');
        await page.waitForSelector('#bt-checklist-popup.open', { state: 'visible' });
        // Flip the Gate 1 row away from whatever it was pre-filled to -- the trader
        // explicitly disagreeing with the indicator.
        await page.locator('#bt-gate1-check-item .check-item-row').click();
        const [placeRes26b] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('text=Proceed to Order'), // other 2 gates left unchecked -> triggers the override confirm(), auto-accepted
        ]);
        assert((await placeRes26b.json()).success, 'order placed from session 26 (overrode Gate 1 suggestion)');
        await page.waitForFunction(() => btSession.open_positions.length >= 2);
        const pos26b = await page.evaluate(() => btSession.open_positions[btSession.open_positions.length - 1]);
        assert(pos26b.gate1_agree === 0, `gate1_agree=0 when the trader overrode the Gate 1 row (got ${pos26b && pos26b.gate1_agree})`);

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — rewind rebuilds the engine from the warm-up start (reset+replay),
        // not a patch -- the exact same swings/events/snapshot come back at the same
        // cursor position, byte for byte.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] rewind rebuilds to byte-identical swings/events/snapshot');
        await openSession(page, 28);
        const before = await page.evaluate(() => JSON.stringify({ swings: gate1Swings, events: gate1Events, snapshot: gate1Snapshot }));
        for (let i = 0; i < 3; i++) {
            await Promise.all([
                page.waitForResponse(res => res.url().includes('action=backtest_advance')),
                page.click('button[onclick="btAdvance()"]'),
            ]);
        }
        for (let i = 0; i < 3; i++) {
            await Promise.all([
                page.waitForResponse(res => res.url().includes('action=backtest_rewind')),
                page.click('button[onclick="btRewind()"]'),
            ]);
        }
        await page.waitForFunction(() => typeof gate1Snapshot !== 'undefined' && gate1Snapshot !== null);
        const after = await page.evaluate(() => JSON.stringify({ swings: gate1Swings, events: gate1Events, snapshot: gate1Snapshot }));
        assert(before === after, 'swings/events/snapshot after advance+rewind back to the same cursor are byte-identical to before (reset+replay, never patched)');
        await shot(page, 'verify4-rewind-rebuild');

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
