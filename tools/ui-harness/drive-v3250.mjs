/**
 * FundedControl v3.25.0 UI harness driver -- "FSA Gate 1 indicator settings in
 * Backtesting" (Inputs/Style/Visibility dialog, per-user persistence, gate1_atr_mult on
 * every order).
 *
 * Reuses sessions 20/27/28 unmodified from v3.24.0's own driver -- no new mock session id
 * needed, this release only adds get_gate1_settings/save_gate1_settings plus
 * gate1_atr_mult passthrough to the existing stateful mock (stubs/api.php).
 *
 * drive.mjs through drive-v3240.mjs are all untouched.
 *
 * Usage: node drive-v3250.mjs [screenshotDir]
 */
import { chromium } from 'playwright';
import { setupHarness } from './setup.js';
import { scan as scanDuplicateNames } from './scan-duplicate-names.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || path.join(__dirname, 'out-v3250');
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
    await page.waitForFunction(() => typeof gate1Snapshot !== 'undefined' && gate1Snapshot !== null);
    await page.waitForFunction(() => typeof gate1Settings !== 'undefined' && gate1Settings !== null);
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

    const harness = await setupHarness({ port: 8774 });
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
        // Verify 1 — dialog opens with its 3 tabs (Inputs/Style/Visibility),
        // screenshotted at 1366×768.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 1] settings dialog opens via the gear icon, 3 tabs, defaults shown');
        await openSession(page, 20);
        await page.click('#bt-gate1-settings-btn');
        await page.waitForSelector('#bt-gate1-settings-popover', { state: 'visible' });
        const defaultAtrMult = await page.evaluate(() => document.getElementById('g1-atrMult').value);
        assert(parseFloat(defaultAtrMult) === 2.0, `Inputs tab shows the default swing size 2.0 (got ${defaultAtrMult})`);
        await shot(page, 'verify1-dialog-inputs-tab');
        await page.click('.bt-draw-popover-tab[data-tab="style"]');
        const styleVisible = await page.evaluate(() => document.querySelector('.bt-draw-popover-tabpanel[data-tabpanel="style"]').classList.contains('active'));
        assert(styleVisible, 'Style tab becomes active on click');
        await shot(page, 'verify1-dialog-style-tab');
        await page.click('.bt-draw-popover-tab[data-tab="visibility"]');
        const visVisible = await page.evaluate(() => document.querySelector('.bt-draw-popover-tabpanel[data-tabpanel="visibility"]').classList.contains('active'));
        assert(visVisible, 'Visibility tab becomes active on click');
        await shot(page, 'verify1-dialog-visibility-tab');
        await page.click('#bt-gate1-settings-cancel');

        // ════════════════════════════════════════════════════════════════
        // Verify 2 — toggling display options (not swing size) never rebuilds the
        // engine: gate1Snapshot stays the exact SAME object reference (no rebuild), only
        // a change to atrMult produces a new one.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 2] display-only changes do not reset the engine');
        await page.evaluate(() => { window.__snapBefore = gate1Snapshot; window.__pushedCountBefore = gate1PushedTimes.length; });
        await page.click('#bt-gate1-settings-btn');
        await page.waitForSelector('#bt-gate1-settings-popover', { state: 'visible' });
        await page.click('#g1-showSwings'); // uncheck
        // Playwright's fill() rejects <input type=color> outright -- set the value directly.
        await page.evaluate(() => { document.getElementById('g1-bullColor').value = '#112233'; });
        await page.click('#bt-gate1-settings-ok');
        await page.waitForFunction(() => document.getElementById('bt-gate1-settings-popover').style.display === 'none');
        const sameEngineState = await page.evaluate(() => ({
            sameSnapshotRef: window.__snapBefore === gate1Snapshot,
            samePushedCount: window.__pushedCountBefore === gate1PushedTimes.length,
            showSwings: gate1Settings.showSwings,
            bullColor: gate1Settings.bullColor,
        }));
        assert(sameEngineState.sameSnapshotRef, 'gate1Snapshot is the SAME object reference after a display-only settings change (no rebuild)');
        assert(sameEngineState.samePushedCount, 'gate1PushedTimes length unchanged (no re-fetch/re-push happened)');
        assert(sameEngineState.showSwings === false, 'showSwings setting actually applied (got ' + sameEngineState.showSwings + ')');
        assert(sameEngineState.bullColor === '#112233', 'bullColor setting actually applied (got ' + sameEngineState.bullColor + ')');

        // Direct, isolated proof that showSwings=false actually suppresses drawing: call
        // the render function against a fake ctx that just counts draw calls, bypassing
        // the full canvas/redraw pipeline so this can't be confused by any other overlay.
        const drawCallsHidden = await page.evaluate(() => {
            let calls = 0;
            const fakeCtx = new Proxy({}, { get: () => (() => { calls++; }), set: () => true });
            btRenderGate1Overlay(fakeCtx);
            return calls;
        });
        // Re-enable showSwings (restore true display defaults except the colour) so the
        // next verify starts from a known-visible state.
        await page.evaluate(async () => {
            const s = JSON.parse(JSON.stringify(gate1Settings));
            s.showSwings = true;
            await btApplyGate1Settings(s);
        });
        const drawCallsVisible = await page.evaluate(() => {
            let calls = 0;
            const fakeCtx = new Proxy({}, { get: () => (() => { calls++; }), set: () => true });
            btRenderGate1Overlay(fakeCtx);
            return calls;
        });
        assert(drawCallsVisible > drawCallsHidden, `turning showSwings back on draws strictly more than with it off (hidden=${drawCallsHidden}, visible=${drawCallsVisible})`);

        // ════════════════════════════════════════════════════════════════
        // Verify 3 — Visibility: hiding the CURRENTLY DISPLAYED timeframe suppresses
        // every drawing call, but the badge still renders (with its own "4H" note
        // unaffected -- the badge is never timeframe-gated).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 3] hiding the current display timeframe suppresses drawings, badge unaffected');
        await page.evaluate(() => setBtDisplayTimeframe('1H'));
        await page.waitForFunction(() => btDisplayTimeframe === '1H');
        const before1H = await page.evaluate(() => {
            let calls = 0;
            const fakeCtx = new Proxy({}, { get: () => (() => { calls++; }), set: () => true });
            btRenderGate1Overlay(fakeCtx);
            return calls;
        });
        assert(before1H > 0, 'overlay draws something on 1H before hiding it (sanity check)');
        await page.evaluate(async () => {
            const s = JSON.parse(JSON.stringify(gate1Settings));
            s.visibility['1H'] = false;
            await btApplyGate1Settings(s);
        });
        const after1H = await page.evaluate(() => {
            let calls = 0;
            const fakeCtx = new Proxy({}, { get: () => (() => { calls++; }), set: () => true });
            btRenderGate1Overlay(fakeCtx);
            return calls;
        });
        assert(after1H === 0, `overlay draws NOTHING on 1H once hidden via Visibility (got ${after1H} draw calls)`);
        const badgeStillVisible = await page.evaluate(() => document.getElementById('bt-gate1-badge').style.display !== 'none');
        assert(badgeStillVisible, 'badge is still visible -- never timeframe-gated, only showBadge/the toolbar toggle hide it');
        await shot(page, 'verify3-hidden-on-1h-badge-visible');
        // Restore 1H visibility and go back to 4H for the rest of the run.
        await page.evaluate(async () => {
            const s = JSON.parse(JSON.stringify(gate1Settings));
            s.visibility['1H'] = true;
            await btApplyGate1Settings(s);
        });
        await page.evaluate(() => setBtDisplayTimeframe('4H'));

        // ════════════════════════════════════════════════════════════════
        // Verify 4 — settings persistence round trip: save_gate1_settings actually
        // writes server-side, and a FRESH client load (full page reload, clears every
        // bit of in-memory JS state) picks the saved value back up on the next session
        // open -- the same mechanism "survives logout/login" relies on (a per-user
        // server-side row, not anything kept in the browser).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 4] settings persist across a full page reload (survives what logout/login would too)');
        await page.evaluate(async () => {
            const s = JSON.parse(JSON.stringify(gate1Settings));
            s.labelSize = 'small';
            s.unclearColor = '#445566';
            await btApplyGate1Settings(s);
        });
        await page.reload();
        await page.waitForSelector('#page-backtest', { state: 'attached' });
        await openSession(page, 20);
        const reloadedSettings = await page.evaluate(() => ({ labelSize: gate1Settings.labelSize, unclearColor: gate1Settings.unclearColor }));
        assert(reloadedSettings.labelSize === 'small', `labelSize survived a full reload (got ${reloadedSettings.labelSize})`);
        assert(reloadedSettings.unclearColor === '#445566', `unclearColor survived a full reload (got ${reloadedSettings.unclearColor})`);
        // Reset back to coded defaults so the rest of this run isn't affected.
        await page.evaluate(async () => { await btApplyGate1Settings(JSON.parse(JSON.stringify(GATE1_SETTINGS_DEFAULTS))); });

        // ════════════════════════════════════════════════════════════════
        // Verify 5 — gate1_atr_mult is recorded on every order (market), and a limit
        // order carries it through to the resulting trade on fill.
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 5] market order records gate1_atr_mult');
        await page.evaluate(async () => {
            const s = JSON.parse(JSON.stringify(gate1Settings));
            s.atrMult = 3.0;
            await btApplyGate1Settings(s);
        });
        await page.click('button[onclick="btNewTradeClick()"]');
        await page.waitForSelector('#bt-ticket', { state: 'visible' });
        await page.fill('#bt-ticket-sl', '8600');
        await page.dispatchEvent('#bt-ticket-sl', 'change');
        const [placeRes] = await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_place_order')),
            page.click('#bt-ticket-place-btn'),
        ]);
        assert((await placeRes.json()).success, 'market order placed at swing size 3.0');
        await page.waitForFunction(() => btSession.open_positions.length >= 1);
        const marketPos = await page.evaluate(() => btSession.open_positions[btSession.open_positions.length - 1]);
        assert(marketPos.gate1_atr_mult === 3, `market order's own trade records gate1_atr_mult=3 (got ${marketPos.gate1_atr_mult})`);

        console.log('\n[Verify 5] limit order carries gate1_atr_mult through to the fill');
        await openSession(page, 27);
        await page.evaluate(async () => {
            const s = JSON.parse(JSON.stringify(gate1Settings));
            s.atrMult = 3.0;
            await btApplyGate1Settings(s);
        });
        const limitRes = await page.evaluate(async () => btApi('backtest_place_order', 'POST', {
            session_id: btActiveSessionId,
            client_bar_time: btSession.replay_cursor_ms,
            type: 'limit',
            direction: 'Long',
            limit_price: 8750,
            stop_loss: 8600,
            take_profit: null,
            leverage: 5,
            risk_pct: 1,
            gates_passed: null,
            gate1_auto_state: gate1Snapshot ? gate1Snapshot.state : null,
            gate1_agree: null,
            gate1_atr_mult: gate1Settings.atrMult,
        }));
        assert(limitRes && limitRes.success && limitRes.filled === false, 'limit order placed (pending) at swing size 3.0');
        await Promise.all([
            page.waitForResponse(res => res.url().includes('action=backtest_advance')),
            page.click('button[onclick="btAdvance()"]'),
        ]);
        await page.waitForFunction(() => btSession.open_positions.length >= 1);
        const limitFilledPos = await page.evaluate(() => btSession.open_positions[btSession.open_positions.length - 1]);
        assert(limitFilledPos.gate1_atr_mult === 3, `limit order's gate1_atr_mult carried through to the fill (got ${limitFilledPos.gate1_atr_mult})`);

        // ════════════════════════════════════════════════════════════════
        // Verify 6 — mid-replay swing-size change: 2.0 -> 3.0 -> 2.0 reproduces, at each
        // value, the exact same swings/events/snapshot a FRESH session opened directly
        // at that value would produce (not just "equal to itself" -- genuinely compared
        // against an independent fresh run, via a full reload + a save BEFORE opening).
        // ════════════════════════════════════════════════════════════════
        console.log('\n[Verify 6] mid-replay swing-size change 2.0 -> 3.0 -> 2.0 matches independent fresh runs at each value');
        await openSession(page, 28);
        await page.evaluate(async () => { await btApplyGate1Settings(JSON.parse(JSON.stringify(GATE1_SETTINGS_DEFAULTS))); }); // 2.0 baseline
        const snapA_2 = await page.evaluate(() => JSON.stringify({ swings: gate1Swings, events: gate1Events, snapshot: gate1Snapshot }));

        // Switch mid-replay to 3.0 (same session, no reload).
        await page.evaluate(async () => {
            const s = JSON.parse(JSON.stringify(gate1Settings));
            s.atrMult = 3.0;
            await btApplyGate1Settings(s);
        });
        const snapMidReplay_3 = await page.evaluate(() => JSON.stringify({ swings: gate1Swings, events: gate1Events, snapshot: gate1Snapshot }));
        assert(snapMidReplay_3 !== snapA_2, 'switching to 3.0 actually produces a different result than 2.0 (sanity check)');

        // Independent fresh run at 3.0: save 3.0 as the default, full page reload (wipes
        // all client state), then open the SAME session (server-side cursor is
        // unchanged) -- loadGate1Settings() picks up 3.0 before the very first
        // btRebuildGate1FromScratch() ever runs, so this is a genuinely fresh
        // construction at 3.0, not the same engine instance switched mid-flight.
        await page.reload();
        await page.waitForSelector('#page-backtest', { state: 'attached' });
        await openSession(page, 28);
        const snapFresh_3 = await page.evaluate(() => JSON.stringify({ swings: gate1Swings, events: gate1Events, snapshot: gate1Snapshot }));
        assert(snapMidReplay_3 === snapFresh_3, 'mid-replay switch to 3.0 is byte-identical to an independent fresh session opened directly at 3.0');

        // Switch back to 2.0 mid-replay and compare against the ORIGINAL 2.0 baseline
        // (snapA_2) -- completing the 2.0 -> 3.0 -> 2.0 cycle.
        await page.evaluate(async () => {
            const s = JSON.parse(JSON.stringify(gate1Settings));
            s.atrMult = 2.0;
            await btApplyGate1Settings(s);
        });
        const snapBack_2 = await page.evaluate(() => JSON.stringify({ swings: gate1Swings, events: gate1Events, snapshot: gate1Snapshot }));
        assert(snapBack_2 === snapA_2, 'switching back to 2.0 reproduces the ORIGINAL 2.0 baseline byte-for-byte (2.0 -> 3.0 -> 2.0 cycle)');
        await shot(page, 'verify6-swing-size-cycle-complete');

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
