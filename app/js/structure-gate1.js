/**
 * FundedControl — FSA Structure (Gate 1) engine (v3.24.0)
 *
 * Exact port of app/docs/reference/FSA_Structure_Gate1.pine v4.2 — same ATR(14) Wilder
 * RMA, hidden zigzag (z/ext/extIdx), swing labeling, and st/pendRef state machine. Pure,
 * no DOM, no dependencies. Incremental and stateful by construction: push() consumes
 * exactly one new CLOSED candle per call and returns the snapshot as of that candle —
 * there is no "recompute over the full array" path, so a caller literally cannot feed it
 * a future candle by accident. Lookahead is the caller's responsibility only in the
 * sense of "don't call push() with a candle that hasn't closed yet" (js/backtest.js).
 *
 * One subtlety confirmed against the real Pine source rather than assumed: in the z===0
 * branch, the running iHi/iLo extremes update every candle regardless of whether ATR is
 * defined yet (Pine lines 76-81) -- only the iHi-iLo>=thr confirmation check itself is
 * gated on thr!==null (Pine line 82). Matters only for the first atrLen-1 candles.
 *
 * Candle shape: {t, o, h, l, c} -- t is open time in UTC SECONDS (not ms, not
 * display-shifted -- the caller converts for chart placement, this module never does).
 */
function createGate1Engine(opts) {
    const atrLen = (opts && opts.atrLen) || 14;
    const atrMult = (opts && opts.atrMult) || 2.0;

    let history, idx, trSum, atr;
    let z, ext, extIdx, iHi, iHiBar, iLo, iLoBar;
    let lastH, prevH, lastHBar, hBroken;
    let lastL, prevL, lastLBar, lBroken;
    let st, pendRef, pendRefBar;

    function initState() {
        history = [];
        idx = -1;
        trSum = 0;
        atr = null;
        z = 0; ext = null; extIdx = null; iHi = null; iHiBar = null; iLo = null; iLoBar = null;
        lastH = null; prevH = null; lastHBar = null; hBroken = true;
        lastL = null; prevL = null; lastLBar = null; lBroken = true;
        st = 0; pendRef = null; pendRefBar = null;
    }
    initState();

    // Pine's hiSince(fromBar)/loSince(fromBar): scans fromBar..bar_index INCLUSIVE (the
    // current candle's own high/low is a valid candidate for the new tracked extreme).
    function loSince(fromIdx, toIdx) {
        let v = history[fromIdx].l, b = fromIdx;
        for (let i = fromIdx + 1; i <= toIdx; i++) {
            if (history[i].l < v) { v = history[i].l; b = i; }
        }
        return [v, b];
    }
    function hiSince(fromIdx, toIdx) {
        let v = history[fromIdx].h, b = fromIdx;
        for (let i = fromIdx + 1; i <= toIdx; i++) {
            if (history[i].h > v) { v = history[i].h; b = i; }
        }
        return [v, b];
    }

    function mkEvent(type, direction, level, sourceIdx, breakIdx) {
        return { type, direction, level, sourceSwingIdx: sourceIdx, breakCandleIdx: breakIdx };
    }

    function push(candle) {
        idx++;
        history.push(candle);
        const h = candle.h, l = candle.l, c = candle.c;

        // 1) ATR(14), Wilder RMA -- TradingView-compatible seeding (simple average of
        // the first atrLen TR values, then the standard RMA recurrence).
        let tr;
        if (idx === 0) {
            tr = h - l;
        } else {
            const prevClose = history[idx - 1].c;
            tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
        }
        if (idx < atrLen - 1) {
            trSum += tr;
        } else if (idx === atrLen - 1) {
            trSum += tr;
            atr = trSum / atrLen;
        } else {
            atr = (atr * (atrLen - 1) + tr) / atrLen;
        }
        const thr = atr !== null ? atrMult * atr : null;

        // 2) Hidden zigzag (swing detection) -- exact mirror of Pine's z===0/+1/-1 branches.
        let newHigh = false, newLow = false;
        if (z === 0) {
            if (iHi === null || h > iHi) { iHi = h; iHiBar = idx; }
            if (iLo === null || l < iLo) { iLo = l; iLoBar = idx; }
            if (thr !== null && (iHi - iLo) >= thr) {
                if (iHiBar < iLoBar) {
                    prevH = lastH; lastH = iHi; lastHBar = iHiBar; newHigh = true;
                    z = -1; ext = iLo; extIdx = iLoBar;
                } else if (iLoBar < iHiBar) {
                    prevL = lastL; lastL = iLo; lastLBar = iLoBar; newLow = true;
                    z = 1; ext = iHi; extIdx = iHiBar;
                }
            }
        } else if (z === 1) {
            if (h > ext) {
                ext = h; extIdx = idx;
            } else if (thr !== null && ((ext - l) >= thr || (lastL !== null && l < lastL))) {
                prevH = lastH; lastH = ext; lastHBar = extIdx; newHigh = true;
                z = -1;
                const [v, b] = loSince(extIdx + 1, idx);
                ext = v; extIdx = b;
            }
        } else {
            if (l < ext) {
                ext = l; extIdx = idx;
            } else if (thr !== null && ((h - ext) >= thr || (lastH !== null && h > lastH))) {
                prevL = lastL; lastL = ext; lastLBar = extIdx; newLow = true;
                z = 1;
                const [v, b] = hiSince(extIdx + 1, idx);
                ext = v; extIdx = b;
            }
        }

        if (newHigh) hBroken = false;
        if (newLow) lBroken = false;

        // 3) Gate 1 state machine (closed candles only -- the caller never pushes a
        // still-forming candle, so every push() here is implicitly "on close").
        if (st === 2 && newHigh && pendRef === null) { pendRef = lastH; pendRefBar = lastHBar; }
        if (st === -2 && newLow && pendRef === null) { pendRef = lastL; pendRefBar = lastLBar; }

        const brUp = lastH !== null && !hBroken && c > lastH;
        const brDn = lastL !== null && !lBroken && c < lastL;

        const newEvents = [];
        if (st === 1) {
            if (brDn) { newEvents.push(mkEvent('CHoCH', 'bearish', lastL, lastLBar, idx)); st = -2; pendRef = null; pendRefBar = null; }
            else if (brUp) { newEvents.push(mkEvent('BOS', 'bullish', lastH, lastHBar, idx)); }
        } else if (st === -1) {
            if (brUp) { newEvents.push(mkEvent('CHoCH', 'bullish', lastH, lastHBar, idx)); st = 2; pendRef = null; pendRefBar = null; }
            else if (brDn) { newEvents.push(mkEvent('BOS', 'bearish', lastL, lastLBar, idx)); }
        } else if (st === 2) {
            if (pendRef !== null && c > pendRef) { newEvents.push(mkEvent('BOS', 'bullish', pendRef, pendRefBar, idx)); st = 1; pendRef = null; pendRefBar = null; }
            else if (brDn) { newEvents.push(mkEvent('CHoCH', 'bearish', lastL, lastLBar, idx)); st = -2; pendRef = null; pendRefBar = null; }
        } else if (st === -2) {
            if (pendRef !== null && c < pendRef) { newEvents.push(mkEvent('BOS', 'bearish', pendRef, pendRefBar, idx)); st = -1; pendRef = null; pendRefBar = null; }
            else if (brUp) { newEvents.push(mkEvent('CHoCH', 'bullish', lastH, lastHBar, idx)); st = 2; pendRef = null; pendRefBar = null; }
        } else {
            if (brUp) { newEvents.push(mkEvent('CHoCH', 'bullish', lastH, lastHBar, idx)); st = 2; }
            else if (brDn) { newEvents.push(mkEvent('CHoCH', 'bearish', lastL, lastLBar, idx)); st = -2; }
        }

        if (brUp) hBroken = true;
        if (brDn) lBroken = true;

        const newSwings = [];
        if (newHigh) {
            newSwings.push({ type: prevH === null ? 'H' : (lastH > prevH ? 'HH' : 'LH'), price: lastH, swingIdx: lastHBar, confirmIdx: idx });
        }
        if (newLow) {
            newSwings.push({ type: prevL === null ? 'L' : (lastL > prevL ? 'HL' : 'LL'), price: lastL, swingIdx: lastLBar, confirmIdx: idx });
        }

        const protectedLevel = st > 0 ? lastL : st < 0 ? lastH : null;
        const bosLevel = Math.abs(st) === 2 ? pendRef : st === 1 ? (hBroken ? null : lastH) : st === -1 ? (lBroken ? null : lastL) : null;

        return {
            state: st,
            protectedLevel,
            bosLevel,
            lastSwingHigh: lastH,
            lastSwingLow: lastL,
            newSwings,
            newEvents,
        };
    }

    return { push, reset: initState };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createGate1Engine };
}
