/**
 * FundedControl — FSA Gate 1 engine self-test (v3.24.0).
 *
 * Plain Node/CommonJS -- no package.json in this repo sets "type":"module", so a plain
 * `.js` file here is CommonJS by Node's own default, matching tools/ui-harness/setup.js's
 * own convention (`.mjs` is reserved for files that deliberately opt into ESM). Requires
 * app/js/structure-gate1.js directly via the CommonJS export shim at the bottom of that
 * file (a no-op in the browser, where `module` is undefined).
 *
 * Run: `node app/tests/gate1_parity.js` (no DB, no network, no browser -- same "runs
 * standalone" convention as `php includes/backtest_engine.php`).
 */
const fs = require('fs');
const path = require('path');
const { createGate1Engine } = require('../js/structure-gate1.js');

let pass = 0, fail = 0;
function assert(cond, label) {
    if (cond) { pass++; return; }
    fail++;
    console.error(`FAIL: ${label}`);
}
function approxEqual(a, b, label, rel = 1e-9) {
    if (a === null && b === null) { pass++; return; }
    if (a === null || b === null) { fail++; console.error(`FAIL: ${label} (one side null: ${a} vs ${b})`); return; }
    const tol = Math.max(rel * Math.abs(b), 1e-9);
    assert(Math.abs(a - b) <= tol, `${label} (got ${a}, expected ${b})`);
}

// ════════════════════════════════════════════════════════════════
// Lookahead test — always runs, needs no fixture. A fresh engine fed candles 0..k must
// produce, at the moment candle k is pushed, EXACTLY the same snapshot a second, fresh
// engine produces for that same push when it goes on to candle N>k afterward. This is a
// structural proof of "incremental, no recompute, lookahead impossible by construction"
// (structure-gate1.js's own docblock), not a check against any external data.
// ════════════════════════════════════════════════════════════════
function mkCandle(t, o, h, l, c) { return { t, o, h, l, c }; }
function syntheticSeries(n) {
    const out = [];
    let price = 100;
    for (let i = 0; i < n; i++) {
        // Deterministic pseudo-random walk (fixed formula, not Math.random()) with
        // periodic larger swings so the zigzag/state machine actually exercises
        // multiple swings and at least one BOS/CHoCH over a few hundred candles.
        const delta = 2 * Math.sin(i / 7) + 1.5 * Math.sin(i / 2.3 + 1) + 0.5 * Math.sin(i * 1.9);
        const open = price;
        const close = Math.max(1, open + delta);
        const high = Math.max(open, close) + Math.abs(delta) * 0.4 + 0.3;
        const low = Math.min(open, close) - Math.abs(delta) * 0.4 - 0.3;
        out.push(mkCandle(i * 14400, open, high, low, close));
        price = close;
    }
    return out;
}
function runLookaheadTest() {
    console.log('[Lookahead test]');
    const candles = syntheticSeries(300);
    const k = 150;

    const shortRun = createGate1Engine({ atrLen: 14, atrMult: 2.0 });
    let shortSnapAtK = null;
    for (let i = 0; i <= k; i++) shortSnapAtK = shortRun.push(candles[i]);

    const longRun = createGate1Engine({ atrLen: 14, atrMult: 2.0 });
    let longSnapAtK = null;
    for (let i = 0; i < candles.length; i++) {
        const snap = longRun.push(candles[i]);
        if (i === k) longSnapAtK = snap;
    }

    assert(JSON.stringify(shortSnapAtK) === JSON.stringify(longSnapAtK),
        `snapshot at candle ${k} is identical whether or not the engine later sees candles ${k + 1}..${candles.length - 1}`);

    // Same proof at a second, independent point -- not just one lucky index.
    const k2 = 77;
    const shortRun2 = createGate1Engine({ atrLen: 14, atrMult: 2.0 });
    let snapAtK2a = null;
    for (let i = 0; i <= k2; i++) snapAtK2a = shortRun2.push(candles[i]);
    let snapAtK2b = null;
    const longRun2 = createGate1Engine({ atrLen: 14, atrMult: 2.0 });
    for (let i = 0; i < candles.length; i++) {
        const snap = longRun2.push(candles[i]);
        if (i === k2) snapAtK2b = snap;
    }
    assert(JSON.stringify(snapAtK2a) === JSON.stringify(snapAtK2b),
        `snapshot at candle ${k2} is identical whether or not the engine later sees candles ${k2 + 1}..${candles.length - 1}`);
}

// ════════════════════════════════════════════════════════════════
// Fixture parity test — reads every *.json in app/tests/fixtures/gate1/. Expected shape
// (my own reconstruction from the briefing, not yet confirmed against a real Pine
// export): {symbol, candles:[{t,o,h,l,c}], swings:[{type,price,swingIdx,confirmIdx}],
// events:[{type,direction,level,sourceSwingIdx,breakIdx}], finalState}. No fixtures
// present is reported, not failed -- this is an input only the trader can supply.
// ════════════════════════════════════════════════════════════════
function runFixtureTests() {
    const dir = path.join(__dirname, 'fixtures', 'gate1');
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (e) { /* directory missing is fine */ }

    if (!files.length) {
        console.log('[Fixture parity test] no fixtures found in app/tests/fixtures/gate1/ — skipped (not a failure)');
        return;
    }

    for (const file of files) {
        console.log(`[Fixture parity test] ${file}`);
        const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const engine = createGate1Engine({ atrLen: 14, atrMult: 2.0 });
        const allSwings = [], allEvents = [];
        let lastSnap = null;
        for (const c of fixture.candles) {
            lastSnap = engine.push(c);
            allSwings.push(...lastSnap.newSwings);
            allEvents.push(...lastSnap.newEvents);
        }

        assert(allSwings.length === fixture.swings.length,
            `${file}: swing count (got ${allSwings.length}, expected ${fixture.swings.length})`);
        const swingN = Math.min(allSwings.length, fixture.swings.length);
        for (let i = 0; i < swingN; i++) {
            const got = allSwings[i], exp = fixture.swings[i];
            assert(got.type === exp.type, `${file}: swing[${i}] type (got ${got.type}, expected ${exp.type})`);
            approxEqual(got.price, exp.price, `${file}: swing[${i}] price`);
            assert(got.swingIdx === exp.swingIdx, `${file}: swing[${i}] swingIdx (got ${got.swingIdx}, expected ${exp.swingIdx})`);
            assert(got.confirmIdx === exp.confirmIdx, `${file}: swing[${i}] confirmIdx (got ${got.confirmIdx}, expected ${exp.confirmIdx})`);
        }

        assert(allEvents.length === fixture.events.length,
            `${file}: event count (got ${allEvents.length}, expected ${fixture.events.length})`);
        const eventN = Math.min(allEvents.length, fixture.events.length);
        for (let i = 0; i < eventN; i++) {
            const got = allEvents[i], exp = fixture.events[i];
            assert(got.type === exp.type, `${file}: event[${i}] type (got ${got.type}, expected ${exp.type})`);
            assert(got.direction === exp.direction, `${file}: event[${i}] direction (got ${got.direction}, expected ${exp.direction})`);
            approxEqual(got.level, exp.level, `${file}: event[${i}] level`);
            assert(got.sourceSwingIdx === exp.sourceSwingIdx, `${file}: event[${i}] sourceSwingIdx`);
            assert(got.breakCandleIdx === exp.breakIdx, `${file}: event[${i}] breakIdx`);
        }

        if (lastSnap) assert(lastSnap.state === fixture.finalState, `${file}: final badge state (got ${lastSnap.state}, expected ${fixture.finalState})`);
    }
}

runLookaheadTest();
runFixtureTests();

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} (${pass} passed, ${fail} failed)`);
if (fail > 0) process.exitCode = 1;
