/**
 * FundedControl v3.23.0 UI harness driver -- "Backtest gate checklist" (strategy_id on
 * sessions + a pre-order checklist drawn from the session's strategy's active gate
 * variables, recorded as trades.gates_passed/backtest_pending_orders.gates_passed).
 *
 * Runs against the STATEFUL mock, two new session ids added for this release:
 *   26 -- 'gated' scenario, market-order checked/overridden cases
 *   27 -- 'gated' scenario, fresh/separate session for the limit-order carry-to-fill case
 * Session 20 (fresh, no strategy) is reused unmodified to confirm a strategy-less session
 * still submits with zero extra clicks, exactly as every pre-v3.23.0 session does.
 *
 * drive.mjs, drive-v3223.mjs, drive-v3225.mjs, drive-v3226.mjs, drive-v3227.mjs,
 * drive-v3228.mjs and drive-v3229.mjs are all untouched.
 *
 * Usage: node drive-v3230.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3230');
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
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 900 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });
    // Every override-confirmation dialog in this driver is meant to be accepted
    // (btChecklistProceed()'s own confirm() -- mirrors trades.js::proceedTrade()) --
    // a real trader clicking through, not an unexpected prompt.
    page.on('dialog', d => d.accept());

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });

        // ════════════════════════════════════════════════════════════════
        // Verify 1 — session 26 (gated): the ticket shows the checklist, and checking
        // every gate stores gates_passed=1 on the filled market order.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] gated session: checklist shown, all checked -> gates_passed=1');
        await openSession(page, 26);
        assert((await page.evaluate(() => btSession.gate_variables.length)) === 2, 'session 26 carries 2 active gate variables');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');

        let placeOrderCalls = 0;
        page.on('request', req => { if (req.url().includes('action=backtest_place_order')) placeOrderCalls++; });

        await page.click('#bt-ticket-place-btn');
        await page.waitForSelector('#bt-checklist-popup.open', { state: 'visible' });
        assert(placeOrderCalls === 0, 'Place Trade opens the checklist first -- no order submitted yet');
        // v3.24.0 note (explicit, briefed exception to "never edit an old driver" --
        // CLAUDE.md §12): the checklist now always prepends one extra Gate 1 engine row
        // on top of this session's own 2 strategy gate variables, 3 total -- an
        // intentional behavior change from that release's own approved spec, not a
        // regression. Only the item counts/indices below changed; every other
        // assertion in this file is untouched.
        assert((await page.textContent('#bt-check-score')) === '0/3', 'checklist starts at 0/3 (Gate 1 row + 2 strategy gates)');
        await shot(page, 'verify1-checklist-opened');

        const items = page.locator('#bt-checklist-items .check-item');
        await items.nth(0).click();
        await items.nth(1).click();
        await items.nth(2).click();
        assert((await page.textContent('#bt-check-score')) === '3/3', 'all checked -> 3/3');

        const [placeRes1] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('text=Proceed to Order'),
        ]);
        const body1 = await placeRes1.json();
        assert(body1.success && body1.filled === true, 'Verify 1: market order filled after Proceed');
        await page.waitForFunction(() => btSession.open_positions.length >= 1);
        const pos1 = await page.evaluate(() => btSession.open_positions[0]);
        assert(pos1.gates_passed === 1, `Verify 1: filled trade has gates_passed=1 (got ${pos1 && pos1.gates_passed})`);
        await shot(page, 'verify1-filled-gates-passed-1');

        // ════════════════════════════════════════════════════════════════
        // Verify 2 — same session, a second order with one gate left unchecked:
        // override confirm, gates_passed=0.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2] gated session: one unchecked + override -> gates_passed=0');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        await page.click('#bt-ticket-place-btn');
        await page.waitForSelector('#bt-checklist-popup.open', { state: 'visible' });
        await page.locator('#bt-checklist-items .check-item').nth(0).click(); // only 1 of 3 (v3.24.0: now includes the Gate 1 row)
        assert((await page.textContent('#bt-check-score')) === '1/3', 'one checked -> 1/3');

        const [placeRes2] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('text=Proceed to Order'), // triggers confirm(), auto-accepted above
        ]);
        const body2 = await placeRes2.json();
        assert(body2.success && body2.filled === true, 'Verify 2: market order filled after override confirm');
        await page.waitForFunction(() => btSession.open_positions.length >= 2);
        const pos2 = await page.evaluate(() => btSession.open_positions[btSession.open_positions.length - 1]);
        assert(pos2.gates_passed === 0, `Verify 2: overridden trade has gates_passed=0 (got ${pos2 && pos2.gates_passed})`);
        await shot(page, 'verify2-filled-gates-passed-0');

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — a strategy-less session (20, fresh) never shows the checklist and
        // submits in one click, exactly like every pre-v3.23.0 session.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] strategy-less session: no checklist, gates_passed stays null');
        await openSession(page, 20);
        assert((await page.evaluate(() => btSession.strategy_id)) === null, 'session 20 has no strategy_id');
        assert((await page.evaluate(() => btSession.gate_variables.length)) === 0, 'session 20 has no gate variables');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const [placeRes3] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        const body3 = await placeRes3.json();
        assert(body3.success && body3.filled === true, 'Verify 3: one-click submit, no checklist detour');
        const checklistOpenAfter = await page.evaluate(() => document.getElementById('bt-checklist-popup').classList.contains('open'));
        assert(!checklistOpenAfter, 'Verify 3: checklist popup never opened for this session');
        await page.waitForFunction(() => btSession.open_positions.length >= 1);
        const pos3 = await page.evaluate(() => btSession.open_positions[btSession.open_positions.length - 1]);
        assert(pos3.gates_passed === null || pos3.gates_passed === undefined, `Verify 3: gates_passed stays null/absent (got ${pos3 && pos3.gates_passed})`);
        await shot(page, 'verify3-no-checklist');

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — a limit order's checklist answer carries to the trade on fill
        // (session 27, fresh/separate from 26's own market-order narrative).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] gated session, limit order: gates_passed carries pending -> filled');
        await openSession(page, 27);
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.click('[data-seg-group="orderType"] [data-seg-val="limit"]');
        // v3.22.4's own technique (drive-v3223.mjs): btTicketSetField('entry', price) is
        // the same function a real drag of the orange entry line calls -- the ticket has
        // no plain number input for the limit price. 8750 is below index 400's close
        // (~8769.54, a valid non-marketable Long limit) and above index 401's low
        // (8743.52, hand-checked via this file's own `php stubs/api.php 399 408` CLI
        // mode), so it fills on the very next Next Bar click.
        await page.evaluate(() => btTicketSetField('entry', 8750));
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        await page.click('#bt-ticket-place-btn');
        await page.waitForSelector('#bt-checklist-popup.open', { state: 'visible' });
        // v3.24.0 (explicit, briefed exception to "never edit an old driver" -- see the
        // Verify 1 comment above): 3 items now, not 2 -- check all of them for
        // gates_passed=1 to still hold.
        await page.locator('#bt-checklist-items .check-item').nth(0).click();
        await page.locator('#bt-checklist-items .check-item').nth(1).click();
        await page.locator('#bt-checklist-items .check-item').nth(2).click();
        const [placeRes4] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('text=Proceed to Order'),
        ]);
        const body4 = await placeRes4.json();
        assert(body4.success && body4.filled === false, 'Verify 4: limit order placed, not filled yet');
        await page.waitForFunction(() => btSession.pending_orders.length >= 1);
        const pending4 = await page.evaluate(() => btSession.pending_orders[0]);
        assert(pending4.gates_passed === 1, `Verify 4: pending order carries gates_passed=1 (got ${pending4 && pending4.gates_passed})`);

        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_advance')),
            page.click('button[onclick="btAdvance()"]'),
        ]);
        await page.waitForFunction(() => btSession.open_positions.length >= 1 && btSession.pending_orders.length === 0);
        const filled4 = await page.evaluate(() => btSession.open_positions[0]);
        assert(filled4.gates_passed === 1, `Verify 4: filled trade carries gates_passed=1 from the pending order (got ${filled4 && filled4.gates_passed})`);
        await shot(page, 'verify4-limit-carry-to-fill');

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
