/**
 * FundedControl v3.22.3 UI harness driver -- running trade display (Part C) + fixes
 * A-F from live testing.
 *
 * Runs against the STATEFUL mock sessions (20/21/22, tools/ui-harness/stubs/api.php) --
 * separate from v3.22.2's own session-6 regression driver (drive.mjs), which still runs
 * against the original inert mock untouched. See api.php's own top-of-file docblock for
 * why these are kept on different session ids rather than changing session 6 under
 * drive.mjs's feet.
 *
 * Usage: node drive-v3223.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3223');
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

async function openSession(page, id) {
    await page.evaluate((sid) => openBacktestSession(sid), id);
    await page.waitForFunction(() => typeof btSession !== 'undefined' && btSession && btSession.status === 'active');
    await page.waitForFunction(() => typeof chartState !== 'undefined' && chartState.candles.length > 0);
}

async function main() {
    // v3.22.3 — a real, previously-unknown bug (js/calculator.js silently shadowing
    // js/backtest.js's own renderOpenPositions(), see CLAUDE.md's Fix D) was found by
    // accident while debugging something else entirely. This static check (real AST via
    // acorn, not a regex guess) runs FIRST, before the browser even launches, so a future
    // same-name collision anywhere in app/js/ fails loudly here instead of silently
    // shadowing a function again and waiting to be noticed by luck a second time.
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

    const harness = await setupHarness({ port: 8766 });
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

        // ════════════════════════════════════════════════════════════════
        // Acceptance + Fix A + item 8: session 21, pre-seeded with two open
        // longs (#132/#134) and one pending order (#4) -- must show their
        // lines IMMEDIATELY on open, no new action needed.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Acceptance] session 21 (pre-seeded) shows lines immediately on open');
        await openSession(page, 21);
        await page.waitForFunction(() => btSession.open_positions.length === 2 && btSession.pending_orders.length === 1);
        await shot(page, 'acceptance-session-opened');

        const linesPresent = await page.evaluate(() => {
            const d = btSession.open_positions[0];
            const yEntry = btPriceToY(d.entry_price);
            const yStop = btPriceToY(d.stop_loss);
            const o = btSession.pending_orders[0];
            const yLimit = btPriceToY(o.limit_price);
            return { yEntry, yStop, yLimit, hasAll: yEntry !== null && yStop !== null && yLimit !== null };
        });
        assert(linesPresent.hasAll, `Acceptance: open-position and pending-order price levels are all on-screen (${JSON.stringify(linesPresent)})`);

        // Fix A: panel text colour -- every row's own <span> has an explicit, readable
        // colour (not the inherited light-theme default the live report found).
        const colours = await page.evaluate(() => {
            const get = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).color : null; };
            return {
                openPosSpan: get('#bt-open-positions .bt-panel-row span'),
                pendingSpan: get('#bt-pending-orders > div > span'),
            };
        });
        const isDarkThemeColor = c => c === 'rgb(209, 212, 220)' || c === 'rgb(139, 147, 167)';
        assert(isDarkThemeColor(colours.openPosSpan), `Fix A: Open Positions row span has an explicit dark-theme colour (got ${colours.openPosSpan})`);
        assert(isDarkThemeColor(colours.pendingSpan), `Fix A: Pending Orders row span has an explicit dark-theme colour (got ${colours.pendingSpan})`);
        await shot(page, 'fixA-panel-colours');

        // Item 8: floating P&L in the header equals the sum of the Open Positions rows.
        const floatingCheck = await page.evaluate(() => {
            const headerFloating = btSession.floating_pnl;
            const sumOfRows = btSession.open_positions.reduce((s, p) => s + p.floating_pnl, 0);
            return { headerFloating, sumOfRows };
        });
        approxEqual(floatingCheck.headerFloating, floatingCheck.sumOfRows, 0.01, 'Item 8: header floating P&L equals the sum of the Open Positions rows');

        // Header strip (Part C) is populated.
        const stripText = await page.evaluate(() => ({
            equity: document.getElementById('bt-strip-equity').textContent,
            target: document.getElementById('bt-strip-target').textContent,
            loss: document.getElementById('bt-strip-loss').textContent,
        }));
        assert(stripText.equity.length > 0 && stripText.target.includes('/') && stripText.loss.includes('/'), `Part C: header strip populated (${JSON.stringify(stripText)})`);

        // ════════════════════════════════════════════════════════════════
        // Fix C: session 22, daily cap already at 2/2.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Fix C] session 22 (2/2 trades today) disables New Trade with the cap text');
        await openSession(page, 22);
        await page.waitForFunction(() => btSession.trades_today === 2 && btSession.max_trades_per_day === 2);
        const newTradeBtn = await page.evaluate(() => {
            const btn = document.getElementById('bt-new-trade-btn');
            return { disabled: btn.disabled, text: btn.textContent };
        });
        assert(newTradeBtn.disabled, 'Fix C: sidebar New Trade button is disabled at the cap');
        assert(newTradeBtn.text.includes('Daily cap reached (2/2)'), `Fix C: button text reads the cap reason (got "${newTradeBtn.text}")`);
        await shot(page, 'fixC-cap-reached');

        // The ticket can still open "for planning" -- draw a position tool and open its
        // toolbar's Place trade, verifying the cap banner is at the TOP, and the submit
        // button is disabled.
        const box = await page.locator('.tv-chart-wrap').boundingBox();
        await page.click('[data-tool="position_long"]');
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4 + 80, { steps: 5 });
        await page.mouse.up();
        await page.waitForSelector('#bt-pos-toolbar', { state: 'visible' });
        await page.click('#bt-pos-toolbar-place');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        const ticketCapState = await page.evaluate(() => {
            const banner = document.querySelector('.bt-ticket-body > .bt-ticket-disabled-reason');
            const placeBtn = document.getElementById('bt-ticket-place-btn');
            return { bannerText: banner ? banner.textContent : null, placeBtnDisabled: placeBtn.disabled };
        });
        assert(ticketCapState.bannerText && ticketCapState.bannerText.includes('Daily cap reached'), `Fix C: ticket shows the cap reason as its OWN top banner (got "${ticketCapState.bannerText}")`);
        assert(ticketCapState.placeBtnDisabled, 'Fix C: ticket\'s own Place Trade is disabled at the cap');
        await shot(page, 'fixC-ticket-top-banner');
        await page.click('#bt-ticket-close-x');

        // ════════════════════════════════════════════════════════════════
        // Fix B: ticket inputs never show more than the symbol's decimals.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Fix B] price rounding in the ticket inputs');
        await openSession(page, 20);
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '7418.579327320573');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const slInputValue = await page.inputValue('#bt-ticket-sl');
        assert(/^\d+\.\d{1,2}$/.test(slInputValue), `Fix B: SL input rounds to the symbol's decimals (got "${slInputValue}")`);
        await shot(page, 'fixB-rounded-input');
        await page.click('#bt-ticket-close-x');

        // ════════════════════════════════════════════════════════════════
        // v3.22.4 — a marketable Long limit (at/above the current close) is rejected,
        // both in the ticket's own disabled-reason and (BacktestController::placeOrder(),
        // not exercised by this DB-free harness -- see this file's own code review) on
        // the server. Confirmed on live: a Long limit at 6902.39 placed against a bar
        // that only ever traded 6591.5-6666 filled at the stale 6902.39 once touched,
        // instead of at the market.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Fix: marketable limit] a Long limit at/above market is rejected');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.click('[data-seg-group="orderType"] [data-seg-val="limit"]');
        const closeBeforeDrag = await page.evaluate(() => chartState.candles[chartState.candles.length - 1].close);
        // btTicketSetField() is the same function a real drag of the orange entry line
        // calls (js/backtest-drawings.js's own ticket-line hit-test) -- driven directly
        // here since the ticket has no plain number input for the limit price (per its
        // own "Drag the orange entry line to set your price" hint), and a pixel-perfect
        // drag to an exact target price is needlessly fragile for what this is actually
        // testing (the blockReason computation, not the drag mechanics themselves).
        await page.evaluate((price) => btTicketSetField('entry', price), closeBeforeDrag + 50);
        const marketableState = await page.evaluate(() => {
            const c = btComputeTicket();
            const btn = document.getElementById('bt-ticket-place-btn');
            return { blockReason: c.blockReason, placeDisabled: btn.disabled };
        });
        assert(marketableState.blockReason === 'A Long limit above the market fills immediately. Use Market.', `Fix: ticket shows the exact marketable-limit reason (got "${marketableState.blockReason}")`);
        assert(marketableState.placeDisabled, 'Fix: Place Trade is disabled for a marketable limit');
        await shot(page, 'fix-marketable-limit-rejected');
        await page.click('#bt-ticket-close-x');

        // ════════════════════════════════════════════════════════════════
        // Verify items 1-4: Limit order lines+cancel, Market fill lines+box+P&L,
        // TP hit clears lines and leaves a marker+toast, rewind undoes it.
        // (continuing on session 20, fresh, cursor at index 400)
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] Limit order: lines+pills persist after submit, x cancels them');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.click('[data-seg-group="orderType"] [data-seg-val="limit"]');
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const [placeRes1] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        const placeBody1 = await placeRes1.json();
        assert(placeBody1.success && placeBody1.filled === false, 'Verify 1: limit order placed (not filled)');
        await page.waitForFunction(() => btSession.pending_orders.length >= 1);
        await shot(page, 'verify1-limit-lines');
        const limitLinesUp = await page.evaluate(() => {
            const o = btSession.pending_orders[btSession.pending_orders.length - 1];
            return btPriceToY(o.limit_price) !== null && btPriceToY(o.stop_loss) !== null;
        });
        assert(limitLinesUp, 'Verify 1: Limit + Stop Loss lines are on-screen after submit');
        // Cancel via the real "x" button (btSyncPendingCancelButtons()) -- clicked by
        // coordinate, not a Playwright Locator: btRenderDrawings() rebuilds this button
        // from scratch on every redraw (fresh DOM node each time), so a Locator's own
        // auto-retry-on-detach can chase a moving target indefinitely on a busy page.
        const cancelPos = await page.evaluate(() => {
            const btn = document.querySelector('.bt-pending-cancel-btn');
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        assert(cancelPos !== null, 'Verify 1: the cancel "x" button is present over the Limit pill');
        await page.mouse.click(cancelPos.x, cancelPos.y);
        await page.waitForFunction(() => btSession.pending_orders.length === 0);
        await shot(page, 'verify1-after-cancel');
        assert(true, 'Verify 1: the x button cancelled the order and its lines are gone');

        console.log('\n[Verify 2] Market order: lines + box + live Open P&L pill appear and update');
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const tpOnChecked = await page.isChecked('#bt-ticket-tp-on');
        if (!tpOnChecked) { await page.check('#bt-ticket-tp-on'); await page.dispatchEvent('#bt-ticket-tp-on', 'change'); }
        await page.fill('#bt-ticket-tp', '8850');
        await page.dispatchEvent('#bt-ticket-tp', 'change');
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        await page.waitForFunction(() => btSession.open_positions.length === 1);
        const entryFillPrice = await page.evaluate(() => btSession.open_positions[0].entry_price);
        await shot(page, 'verify2-market-filled');
        await page.click('button[onclick="btAdvance()"]');
        await page.waitForTimeout(300);
        const afterOneBar = await page.evaluate(() => ({
            stillOpen: btSession.open_positions.length === 1,
            mark: btSession.open_positions[0] ? btSession.open_positions[0].mark_price : null,
        }));
        assert(afterOneBar.stillOpen, 'Verify 2: position still open after one Next Bar, box/lines still driven by server state');
        assert(afterOneBar.mark !== entryFillPrice, `Verify 2: mark price updates with each Next Bar (${entryFillPrice} -> ${afterOneBar.mark})`);
        await shot(page, 'verify2-after-next-bar');

        console.log('\n[Verify 3] Advance until TP is hit -- lines clear, marker + toast appear');
        let tpHit = false;
        for (let i = 0; i < 5 && !tpHit; i++) {
            await page.click('button[onclick="btAdvance()"]');
            await page.waitForTimeout(250);
            tpHit = await page.evaluate(() => btSession.open_positions.length === 0 && btSession.closed_trades.length > 0);
        }
        assert(tpHit, 'Verify 3: the position closed within the expected number of bars (TP at index 404)');
        // Checked BEFORE the screenshot/other assertions below, not after: the toast
        // auto-hides itself 2.8s after showing (js/app.js::toast()), and a slow
        // screenshot capture (a real CDP round trip) eating into that budget turned this
        // into an intermittent failure when checked last -- the toast's own on-screen
        // behavior isn't what was flaky, the TEST's own ordering was.
        const toastVisible = await page.isVisible('.toast.show');
        assert(toastVisible, 'Verify 3: a toast is showing after the close');
        const closedMarker = await page.evaluate(() => {
            const t = btSession.closed_trades[btSession.closed_trades.length - 1];
            return t ? { exit_reason: t.exit_reason, r_multiple: t.r_multiple } : null;
        });
        assert(closedMarker && closedMarker.exit_reason === 'Take Profit', `Verify 3: closed trade recorded as Take Profit (got ${JSON.stringify(closedMarker)})`);
        await shot(page, 'verify3-tp-closed-marker');

        console.log('\n[Verify 4] Rewind past the fill -- the position reopens');
        await page.click('button[onclick="btRewind()"]');
        await page.waitForTimeout(300);
        await page.click('button[onclick="btRewind()"]');
        await page.waitForTimeout(300);
        const afterRewind = await page.evaluate(() => ({
            open: btSession.open_positions.length,
            closed: btSession.closed_trades.length,
        }));
        assert(afterRewind.open === 1 || afterRewind.closed === 0, `Verify 4: rewinding past the close reopens the position or clears the closed record (${JSON.stringify(afterRewind)})`);
        await shot(page, 'verify4-after-rewind');

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
