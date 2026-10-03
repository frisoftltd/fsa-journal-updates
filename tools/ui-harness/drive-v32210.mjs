/**
 * FundedControl v3.22.10 UI harness driver -- "Risk ladder in the backtest engine."
 * Verifies: tier lookup from start-of-day equity (not mid-day equity), the tier holding
 * steady until the NEXT replay day even after a same-day loss, the ticket's own prefill/
 * tier display/off-ladder note, the trade row's planned/actual/deviation fields, and that
 * a flat-risk session shows no tier and behaves exactly as before this release.
 *
 * Runs against stateful mock sessions 24 and 25 (both scenario='ladder',
 * tools/ui-harness/stubs/api.php) for the active-ladder checks, and session 20 (flat,
 * unchanged) for the "must not change" check. drive.mjs, drive-v3223.mjs,
 * drive-v3225.mjs, drive-v3226.mjs, drive-v3227.mjs, drive-v3228.mjs and drive-v3229.mjs
 * are all untouched.
 *
 * Usage: node drive-v32210.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v32210');
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

async function advanceBars(page, n) {
    for (let i = 0; i < n; i++) {
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_advance')),
            page.click('button[onclick="btAdvance()"]'),
        ]);
        await page.waitForTimeout(30);
    }
}

async function openNewTradeTicket(page) {
    await page.click('button[onclick="btNewTradeClick()"]');
    await page.waitForSelector('#bt-ticket', { state: 'visible' });
}

async function submitTicket(page, { stopLoss, riskPct }) {
    await page.fill('#bt-ticket-sl', String(stopLoss));
    await page.dispatchEvent('#bt-ticket-sl', 'change');
    if (riskPct !== undefined) {
        await page.fill('#bt-ticket-risk-value', String(riskPct));
        await page.dispatchEvent('#bt-ticket-risk-value', 'change');
    }
    const [resp] = await Promise.all([
        page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
        page.click('#bt-ticket-place-btn'),
    ]);
    // btSubmitTicket() keeps going after this response resolves -- creating/linking the
    // position's own drawing, then refreshBtSession() -- and btSession.open_positions
    // only reflects the fill once ALL of that finishes. Waiting for the ticket to close
    // (the very last line of btSubmitTicket(), after refreshBtSession()) is the one
    // observable signal that the whole chain is actually done.
    if (resp.ok()) await page.waitForSelector('#bt-ticket', { state: 'hidden' });
    return resp;
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

    console.log('\n[Static] backtest_engine.php self-test (includes v3.22.10 ladder-tier cases)');
    try {
        const out = execSync('php includes/backtest_engine.php', { cwd: harness.tmpDir, encoding: 'utf8' });
        assert(/self-test: \d+ passed, 0 failed/.test(out), `self-test reports 0 failed (output: ${out.trim()})`);
    } catch (e) {
        assert(false, `self-test exited non-zero: ${e.stdout || e.message}`);
    }

    const browser = await chromium.launch();
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1365, height: 820 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text()); });

    try {
        await page.goto(harness.baseUrl + '/');
        await page.waitForSelector('#page-backtest', { state: 'attached' });

        // ════════════════════════════════════════════════════════════════
        // Verify 1 — equity $10,000: tier 1.0%, ticket prefills 1.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] fresh ladder session: tier 1.0% at 100% equity, ticket prefills 1');
        await openSession(page, 24);
        const s1 = await page.evaluate(() => ({ useFlat: btSession.use_flat_risk, ladder: btSession.ladder_risk_pct, sod: btSession.start_of_day_equity }));
        assert(s1.useFlat === false, 'session 24 has an active (non-flat) ladder');
        approxEqual(s1.ladder, 1.0, 0.001, 'ladder tier at 100% starting equity is 1.0%');
        approxEqual(s1.sod, 10000, 0.01, 'start-of-day equity is the full starting balance before any trade');

        const tierBadge = await page.evaluate(() => ({ display: document.getElementById('bt-strip-tier-wrap').style.display, text: document.getElementById('bt-strip-tier').textContent }));
        assert(tierBadge.display !== 'none', 'header strip shows the Tier badge for an active-ladder session');
        assert(tierBadge.text === '1%', `header strip reads "1%" (got "${tierBadge.text}")`);

        await openNewTradeTicket(page);
        const riskPrefill = await page.$eval('#bt-ticket-risk-value', el => el.value);
        assert(parseFloat(riskPrefill) === 1, `ticket's own risk field prefills from the ladder tier, 1 (got ${riskPrefill})`);
        const tierLine = await page.evaluate(() => document.getElementById('bt-ticket').innerText);
        assert(/Tier 1% · start-of-day equity \$10,?000(\.00)? \(100\.0%\)/.test(tierLine), `ticket shows the tier/start-of-day line (got: ${JSON.stringify(tierLine)})`);
        await shot(page, 'verify1-tier-1pct-ticket-prefill');
        await page.click('#bt-ticket-close-x');

        // ════════════════════════════════════════════════════════════════
        // Verify 2 — a same-day loss drops equity into the 92.5-95% band; the tier STAYS
        // at 1.0% until the next replay day, then becomes 0.5%.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2] same-day loss -- tier holds at 1.0% until the next day, then becomes 0.5%');
        await openNewTradeTicket(page);
        const entry1 = await page.evaluate(() => btComputeTicket().entry);
        const resp1 = await submitTicket(page, { stopLoss: entry1 - 1000, riskPct: 10 });
        assert(resp1.ok(), 'market order placed (risk 10%, stop 1000 away -> lot size ~1.0 against the $10,000 balance)');
        const tradeId1 = await page.evaluate(() => btSession.open_positions[0].id);
        const lotSize1 = await page.evaluate(() => btSession.open_positions[0].lot_size);
        approxEqual(lotSize1, 1.0, 0.01, 'lot size reflects REAL risk-based sizing for this ladder session (equity*risk%/stopDistance), not a flat display estimate');

        await advanceBars(page, 46); // index 400 -> 446, a known ~617-point dip in the mock's deterministic candle sequence
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_close_position')),
            page.evaluate((id) => closeBtPosition(id), tradeId1),
        ]);
        const afterCloseSameDay = await page.evaluate(() => ({ ladder: btSession.ladder_risk_pct, equity: btSession.equity }));
        assert(afterCloseSameDay.equity < 9500, `equity actually dropped below the 95% tier boundary (got ${afterCloseSameDay.equity})`);
        approxEqual(afterCloseSameDay.ladder, 1.0, 0.001, `tier STAYS at 1.0% immediately after the loss -- still the same replay day (equity ${afterCloseSameDay.equity})`);
        await shot(page, 'verify2-same-day-tier-unchanged');

        await advanceBars(page, 10); // index 446 -> 456, crosses 2020-01-20T00:00:00Z
        const afterMidnight = await page.evaluate(() => ({ ladder: btSession.ladder_risk_pct, sod: btSession.start_of_day_equity }));
        approxEqual(afterMidnight.sod, afterCloseSameDay.equity, 0.01, "next day's start-of-day equity is exactly yesterday's closing equity");
        approxEqual(afterMidnight.ladder, 0.5, 0.001, `tier becomes 0.5% once the NEXT replay day starts (start-of-day equity ${afterMidnight.sod}, ${(afterMidnight.sod / 100).toFixed(2)}%)`);
        const tierBadge2 = await page.evaluate(() => document.getElementById('bt-strip-tier').textContent);
        assert(tierBadge2 === '0.5%', `header strip updates to "0.5%" (got "${tierBadge2}")`);
        await shot(page, 'verify2-next-day-tier-0.5pct');

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — typing 1% while the tier is 0.5%: amber note, and the trade row
        // records planned_risk_pct 0.5 / actual_risk_pct 1 / risk_deviation_pct 100.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] off-ladder: typed 1% while tier is 0.5% -- amber note + exact deviation recorded');
        await openNewTradeTicket(page);
        const riskPrefill2 = await page.$eval('#bt-ticket-risk-value', el => el.value);
        assert(parseFloat(riskPrefill2) === 0.5, `ticket now prefills from the NEW 0.5% tier (got ${riskPrefill2})`);
        const entry2 = await page.evaluate(() => btComputeTicket().entry);
        await page.fill('#bt-ticket-sl', String(entry2 - 100));
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        await page.fill('#bt-ticket-risk-value', '1');
        await page.dispatchEvent('#bt-ticket-risk-value', 'change');
        const amberText = await page.evaluate(() => document.querySelector('.bt-ticket-note.amber')?.textContent || '');
        assert(/Off-ladder/.test(amberText) && /0\.5%/.test(amberText), `amber off-ladder note shows the 0.5% tier vs the typed 1% (got "${amberText}")`);
        await shot(page, 'verify4-off-ladder-amber-note');

        const [resp2] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        assert(resp2.ok(), 'off-ladder trade is NOT blocked -- it places successfully');
        if (resp2.ok()) await page.waitForSelector('#bt-ticket', { state: 'hidden' });
        const offLadderTrade = await page.evaluate(() => btSession.open_positions.find(p => p.actual_risk_pct === 1));
        assert(!!offLadderTrade, 'the off-ladder trade is present in open_positions');
        approxEqual(offLadderTrade.planned_risk_pct, 0.5, 0.001, 'trade row: planned_risk_pct = 0.5 (the ladder tier at placement)');
        approxEqual(offLadderTrade.actual_risk_pct, 1, 0.001, 'trade row: actual_risk_pct = 1 (what the trader typed)');
        approxEqual(offLadderTrade.risk_deviation_pct, 100, 0.01, 'trade row: risk_deviation_pct = (1-0.5)/0.5*100 = 100');

        // ════════════════════════════════════════════════════════════════
        // Verify 3 (session 25, isolated) — a bigger same-shape loss drops start-of-day
        // equity below 92.5% once the next day starts -> tier 0.25%.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] a deeper loss drops the NEXT day below 92.5% -- tier becomes 0.25%');
        await openSession(page, 25);
        await openNewTradeTicket(page);
        const entry3 = await page.evaluate(() => btComputeTicket().entry);
        const resp3 = await submitTicket(page, { stopLoss: entry3 - 1000, riskPct: 15 });
        assert(resp3.ok(), 'market order placed (risk 15%, stop 1000 away -> a bigger loss on the same dip)');
        const tradeId3 = await page.evaluate(() => btSession.open_positions[0].id);
        await advanceBars(page, 46); // same 400 -> 446 dip as Verify 2
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_close_position')),
            page.evaluate((id) => closeBtPosition(id), tradeId3),
        ]);
        await advanceBars(page, 10); // cross into the next replay day
        const s25 = await page.evaluate(() => ({ ladder: btSession.ladder_risk_pct, sod: btSession.start_of_day_equity, equity: btSession.equity }));
        assert(s25.sod < 9250, `start-of-day equity for the new day is below the 92.5% boundary (got ${s25.sod})`);
        approxEqual(s25.ladder, 0.25, 0.001, `tier is 0.25% below 92.5% start-of-day equity (sod=${s25.sod}, ${(s25.sod / 100).toFixed(2)}%)`);
        await shot(page, 'verify3-below-92.5pct-tier-0.25pct');

        // ════════════════════════════════════════════════════════════════
        // Verify 5 — a flat-risk session shows no tier and behaves exactly as before.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 5] flat-risk session (20): no tier, no change in behaviour');
        await openSession(page, 20);
        const flatState = await page.evaluate(() => ({ useFlat: btSession.use_flat_risk, ladder: btSession.ladder_risk_pct }));
        assert(flatState.useFlat === true, 'session 20 is flat-risk');
        assert(flatState.ladder === null, `ladder_risk_pct is null for a flat session (got ${flatState.ladder})`);
        const flatTierBadge = await page.evaluate(() => document.getElementById('bt-strip-tier-wrap').style.display);
        assert(flatTierBadge === 'none', 'header strip shows no Tier badge for a flat-risk session');
        await openNewTradeTicket(page);
        const flatTicketText = await page.evaluate(() => document.getElementById('bt-ticket').innerText);
        assert(!/Tier \d/.test(flatTicketText), 'ticket shows no "Tier X%" line for a flat-risk session');
        await shot(page, 'verify5-flat-session-no-tier');

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
