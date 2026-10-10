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
// ════════════════════════════════════════════════════════════════
// Tie-break audit — one small synthetic case per site in structure-gate1.js where two
// candles can share the exact same extreme value, each hand-verified against the real
// Pine source line-by-line (not against this engine's own prior output). v3.24.1 fixed
// one real bug here (hiSince/loSince); the other three sites were already correct and
// are covered here so a future change can't silently regress them.
//
// Every sequence below was constructed candle-by-candle and confirmed with the engine
// used purely as an arithmetic calculator (Wilder RMA by hand across many steps is
// impractical) -- the CHOICE of which index is "correct" comes from independently
// tracing Pine's own algorithm, not from whatever this engine happened to output.
// ════════════════════════════════════════════════════════════════
function mkCandle2(t, o, h, l, c) { return { t, o, h, l, c }; }

function runTieBreakTests() {
    console.log('[Tie-break audit]');

    // --- Case 1: start-phase HIGH tracking (`h > iHi`, Pine line 76) -- strict, a tie
    // must NOT move iHiBar forward. Candle 3 sets a new high (1010); candle 4 ties it
    // exactly and must be ignored; candle 5 crosses the threshold via a low that's set
    // LATER than the high, so the eventual confirm reports the HIGH swing -- its
    // swingIdx must be 3 (the first candle to reach 1010), not 4 (the tying repeat).
    {
        const seq = [
            mkCandle2(0, 1000, 1001, 999, 1000),
            mkCandle2(1, 1000, 1001, 999, 500),
            mkCandle2(2, 500, 1001, 999, 500),
            mkCandle2(3, 1000, 1010, 1000, 1005),
            mkCandle2(4, 1000, 1010, 1000, 1005), // ties candle 3's high exactly
            mkCandle2(5, 1000, 1005, 1, 500),
        ];
        const e = createGate1Engine({ atrLen: 3, atrMult: 1.0 });
        let swings = [];
        for (const c of seq) swings = swings.concat(e.push(c).newSwings);
        assert(swings.length === 1 && swings[0].type === 'H' && swings[0].swingIdx === 3,
            `start-phase high tie keeps the EARLIER candle (got ${JSON.stringify(swings)})`);
    }

    // --- Case 2: start-phase LOW tracking (`l < iLo`, Pine line 79) -- mirror of case 1.
    {
        const seq = [
            mkCandle2(0, 1000, 1001, 999, 1000),
            mkCandle2(1, 1000, 1001, 999, 500),
            mkCandle2(2, 500, 1001, 999, 500),
            mkCandle2(3, 1000, 1000, 990, 995),
            mkCandle2(4, 1000, 1000, 990, 995), // ties candle 3's low exactly
            mkCandle2(5, 1000, 2000, 995, 1500),
        ];
        const e = createGate1Engine({ atrLen: 3, atrMult: 1.0 });
        let swings = [];
        for (const c of seq) swings = swings.concat(e.push(c).newSwings);
        assert(swings.length === 1 && swings[0].type === 'L' && swings[0].swingIdx === 3,
            `start-phase low tie keeps the EARLIER candle (got ${JSON.stringify(swings)})`);
    }

    // --- Case 3: post-confirmation search (hiSince/loSince, Pine lines 26-46) -- the
    // bug v3.24.1 fixed. Candles 6 and 8 both reach high=15 within the post-confirmation
    // search window; Pine's own loop seeds from the CONFIRMING candle and scans
    // backward with strict replacement, so a tie keeps the LATER one (8).
    {
        const seq = [
            mkCandle2(0, 1000, 1001, 999, 1000),
            mkCandle2(1, 1000, 1001, 999, 500),
            mkCandle2(2, 500, 1001, 999, 500),
            mkCandle2(3, 1000, 1010, 1000, 1005),
            mkCandle2(4, 1000, 1010, 1000, 1005),
            mkCandle2(5, 1000, 1005, 1, 500),
            mkCandle2(6, 10, 15, 9, 12),     // tie candidate, EARLIER (high=15)
            mkCandle2(7, 12, 13, 10, 11),
            mkCandle2(8, 11, 15, 10, 12),    // tie candidate, LATER (high=15, same value)
            mkCandle2(9, 12, 13, 11, 12),
            mkCandle2(10, 12, 12.5, 11.5, 12),
            mkCandle2(11, 12, 12.3, 11.7, 12),
            mkCandle2(12, 12, 12.2, 11.8, 12),
            mkCandle2(13, 12, 12.1, 11.9, 12),
            mkCandle2(14, 12, 12.1, 11.9, 12),
            mkCandle2(15, 12, 12.1, 11.9, 12),
            mkCandle2(16, 12, 12.1, 11.9, 12), // confirms a low swing -> triggers hiSince(6,16) over the tie
            mkCandle2(17, 12, 12.1, 11, 12),
            mkCandle2(18, 12, 12, 5, 8),        // confirms the swing high -> reveals which candle hiSince picked
        ];
        const e = createGate1Engine({ atrLen: 3, atrMult: 1.0 });
        let swings = [];
        for (const c of seq) swings = swings.concat(e.push(c).newSwings);
        const tieSwing = swings.find(s => s.price === 15);
        assert(!!tieSwing && tieSwing.swingIdx === 8,
            `post-confirmation search tie keeps the LATER candle (got ${JSON.stringify(swings)})`);
    }

    // --- Case 4: start-phase, iHiBar === iLoBar (Pine's confirm block has no `else` for
    // this case, lines 83-98) -- an "outside" candle that's simultaneously the new
    // running high AND low confirms NOTHING even if the threshold is already crossed,
    // and keeps waiting until a later candle breaks the tie between the two bar indexes.
    {
        const seq = [
            mkCandle2(0, 1000, 1001, 999, 1000),
            mkCandle2(1, 1000, 1001, 999, 500),
            mkCandle2(2, 500, 1001, 999, 500),
            mkCandle2(3, 750, 2000, 1, 750),      // outside bar: iHiBar=iLoBar=3, threshold already crossed
            mkCandle2(4, 750, 760, 740, 750),     // quiet -- tie must still be unresolved
            mkCandle2(5, 740, 2500, 700, 2400),   // new high breaks the tie -> now confirms
        ];
        const e = createGate1Engine({ atrLen: 3, atrMult: 1.0 });
        const snaps = [];
        for (const c of seq) snaps.push(e.push(c));
        assert(snaps[3].newSwings.length === 0,
            `iHiBar===iLoBar confirms NOTHING even though the threshold is already crossed (got ${JSON.stringify(snaps[3].newSwings)})`);
        assert(snaps[4].newSwings.length === 0, 'still waiting one quiet bar later');
        assert(snaps[5].newSwings.length === 1 && snaps[5].newSwings[0].type === 'L' && snaps[5].newSwings[0].swingIdx === 3,
            `tie resolves once broken, crediting the original (earlier) candle 3 (got ${JSON.stringify(snaps[5].newSwings)})`);
    }
}

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
runTieBreakTests();
runFixtureTests();

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} (${pass} passed, ${fail} failed)`);
if (fail > 0) process.exitCode = 1;
