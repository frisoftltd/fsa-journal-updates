/**
 * FundedControl — Backtesting Chart (Phase 1a)
 * TradingView Lightweight Charts, wired to ChartController.php's get_symbols/get_candles
 * (MySQL only — this file never talks to Bybit or any exchange). No replay engine,
 * drawing tools, or orders yet — that's phase 1b.
 *
 * Timezone handling: Lightweight Charts has no built-in timezone selector — it always
 * renders a numeric timestamp as if it were UTC. The standard workaround (used here) is
 * to feed the library a SHIFTED timestamp (true UTC seconds + the selected zone's own
 * UTC offset at that instant) so its own UTC-based rendering produces the correct local
 * wall-clock labels for that zone. The offset is computed per-candle via Intl's real
 * IANA timezone database (getTzOffsetSeconds()), not a single fixed constant, so a
 * loaded window that spans a DST transition still renders correctly on both sides of it.
 * Every value that leaves this file toward the API (symbol/timeframe/before) is always
 * the true, unshifted UTC ms — the shift only ever happens at the last step, building
 * the arrays handed to series.setData().
 */

const TV_COLORS = {
    upColor: '#26a69a', downColor: '#ef5350',
    background: '#131722', grid: '#1e222d', text: '#d1d4dc',
};

// A curated set, not the full ~500-zone IANA list — matches this app's own existing
// convention of a small fixed set for a timezone concern (see ReportCardController's
// REPORT_CARD_TZ) rather than a giant unfiltered dropdown nobody needs. The browser's
// own detected zone is always injected as the first/default option.
const TV_TIMEZONES = [
    ['UTC', 'UTC'],
    ['America/New_York', 'New York (ET)'],
    ['America/Chicago', 'Chicago (CT)'],
    ['America/Los_Angeles', 'Los Angeles (PT)'],
    ['Europe/London', 'London'],
    ['Europe/Berlin', 'Berlin / Paris (CET)'],
    ['Africa/Kigali', 'Kigali (CAT)'],
    ['Asia/Dubai', 'Dubai'],
    ['Asia/Kolkata', 'Mumbai (IST)'],
    ['Asia/Singapore', 'Singapore'],
    ['Asia/Tokyo', 'Tokyo'],
    ['Asia/Shanghai', 'Shanghai'],
    ['Australia/Sydney', 'Sydney'],
];

let tvChart = null, tvCandleSeries = null, tvVolumeSeries = null;
let chartState = {
    symbol: null,
    timeframe: '1H',
    timezone: null,
    symbols: [],
    candles: [],       // canonical, ascending, TRUE utc-ms {time,open,high,low,close,volume}
    loadingOlder: false,
    exhaustedOlder: false,
    tzFormatterCache: {},
};

// ── TIMEZONE MATH ────────────────────────────────────────
function getTzFormatter(tz) {
    if (!chartState.tzFormatterCache[tz]) {
        chartState.tzFormatterCache[tz] = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    }
    return chartState.tzFormatterCache[tz];
}
// Offset (seconds) of $tz relative to UTC at the instant $utcMs — computed per call, not
// a fixed constant, so it's correct on both sides of a DST transition.
function getTzOffsetSeconds(utcMs, tz) {
    const parts = getTzFormatter(tz).formatToParts(new Date(utcMs));
    const m = {};
    parts.forEach(p => { m[p.type] = p.value; });
    const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
    return Math.round((asUtc - utcMs) / 1000);
}
function toDisplaySeconds(utcMs, tz) {
    return Math.floor(utcMs / 1000) + getTzOffsetSeconds(utcMs, tz);
}
function fromDisplaySeconds(displaySec, tz) {
    // Inverse of toDisplaySeconds() — used when reading a visible-range boundary back
    // out of the chart (which only knows the shifted/display domain) to build an API
    // `before` param (which must be true UTC). One offset lookup is enough here: the
    // return value only feeds a "roughly this far back" pagination cursor, not anything
    // requiring exact precision, so a same-instant re-derivation of the DST offset
    // (using the display value as if it were already UTC, then correcting once) is
    // accurate to within one candle at worst, right at a DST boundary itself.
    const approxUtcMs = displaySec * 1000;
    return approxUtcMs - getTzOffsetSeconds(approxUtcMs, tz) * 1000;
}

// ── RENDERING ────────────────────────────────────────────
function candlesToSeriesData(candles, tz) {
    const bars = [], vols = [];
    for (const c of candles) {
        const t = toDisplaySeconds(c.time, tz);
        bars.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
        vols.push({
            time: t, value: c.volume,
            color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
        });
    }
    return { bars, vols };
}
function renderChartData() {
    const { bars, vols } = candlesToSeriesData(chartState.candles, chartState.timezone);
    tvCandleSeries.setData(bars);
    tvVolumeSeries.setData(vols);
    updateLegendFromCandle(chartState.candles[chartState.candles.length - 1] || null);
}

// ── LEGEND ───────────────────────────────────────────────
function updateLegendFromCandle(c) {
    const el = document.getElementById('tv-legend');
    if (!el) return;
    if (!c) { el.innerHTML = ''; return; }
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: chartState.timezone, year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const chg = c.close - c.open;
    const chgPct = c.open !== 0 ? (chg / c.open * 100) : 0;
    const cls = chg >= 0 ? 'style="color:#26a69a"' : 'style="color:#ef5350"';
    el.innerHTML = `
        <div class="tv-legend-title">${chartState.symbol} &middot; ${chartState.timeframe}</div>
        <div>${dtf.format(new Date(c.time))}</div>
        <div>O <span ${cls}>${fmtPrice(c.open)}</span>
             H <span ${cls}>${fmtPrice(c.high)}</span>
             L <span ${cls}>${fmtPrice(c.low)}</span>
             C <span ${cls}>${fmtPrice(c.close)}</span></div>
        <div>Vol <span ${cls}>${fmtVol(c.volume)}</span>
             <span ${cls}>${chg >= 0 ? '+' : ''}${chgPct.toFixed(2)}%</span></div>`;
}
function fmtPrice(v) {
    if (v === null || v === undefined) return '—';
    const abs = Math.abs(v);
    const dp = abs >= 100 ? 2 : (abs >= 1 ? 4 : 6);
    return v.toFixed(dp);
}
function fmtVol(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
    return v.toFixed(2);
}

// ── DATA LOADING ─────────────────────────────────────────
async function fetchCandles(symbol, timeframe, before, limit) {
    let action = `get_candles&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit || 500}`;
    if (before) action += `&before=${before}`;
    const rows = await api(action);
    return Array.isArray(rows) ? rows : [];
}

async function loadInitialWindow(preserveAroundDisplaySec) {
    let before = null;
    if (preserveAroundDisplaySec) {
        before = fromDisplaySeconds(preserveAroundDisplaySec, chartState.timezone) + backtestStepMsFor(chartState.timeframe);
    }
    const rows = await fetchCandles(chartState.symbol, chartState.timeframe, before, 500);
    chartState.candles = rows.map(rowToCanonical);
    chartState.exhaustedOlder = rows.length < 500;
    renderChartData();
    if (!preserveAroundDisplaySec) tvChart.timeScale().fitContent();
}

async function loadOlderCandles() {
    if (chartState.loadingOlder || chartState.exhaustedOlder || !chartState.candles.length) return;
    chartState.loadingOlder = true;
    try {
        const earliest = chartState.candles[0].time;
        const rows = await fetchCandles(chartState.symbol, chartState.timeframe, earliest, 500);
        if (!rows.length) { chartState.exhaustedOlder = true; return; }

        const addedCount = rows.length;
        chartState.candles = rows.map(rowToCanonical).concat(chartState.candles);

        // Preserve scroll position across a prepend: Lightweight Charts' logical range
        // is a 0-based bar index into the series' current data array. Prepending N
        // older bars shifts every existing bar's index by +N, so the previously visible
        // window has to be shifted by the same amount or the view jumps.
        const prevRange = tvChart.timeScale().getVisibleLogicalRange();
        renderChartData();
        if (prevRange) {
            tvChart.timeScale().setVisibleLogicalRange({
                from: prevRange.from + addedCount,
                to: prevRange.to + addedCount,
            });
        }
    } finally {
        chartState.loadingOlder = false;
    }
}

function rowToCanonical(r) {
    return { time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume };
}
function backtestStepMsFor(tf) {
    return { '15m': 15 * 60 * 1000, '1H': 60 * 60 * 1000, '4H': 4 * 60 * 60 * 1000, '1D': 24 * 60 * 60 * 1000 }[tf];
}

// ── CHART INIT ───────────────────────────────────────────
function initTvChart() {
    if (tvChart) return;
    const container = document.getElementById('tv-chart');

    tvChart = LightweightCharts.createChart(container, {
        layout: { background: { color: TV_COLORS.background }, textColor: TV_COLORS.text },
        grid: {
            vertLines: { color: TV_COLORS.grid },
            horzLines: { color: TV_COLORS.grid },
        },
        rightPriceScale: { visible: true, borderColor: TV_COLORS.grid },
        timeScale: { visible: true, borderColor: TV_COLORS.grid, timeVisible: true, secondsVisible: false },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { labelVisible: true },
            horzLine: { labelVisible: true },
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        autoSize: true,
    });

    tvCandleSeries = tvChart.addCandlestickSeries({
        upColor: TV_COLORS.upColor, downColor: TV_COLORS.downColor,
        borderUpColor: TV_COLORS.upColor, borderDownColor: TV_COLORS.downColor,
        wickUpColor: TV_COLORS.upColor, wickDownColor: TV_COLORS.downColor,
    });

    // Volume rendered as a compressed band at the bottom of this same pane (its own
    // price scale, margined to the bottom 20%) — the standard Lightweight Charts
    // technique for "volume histogram in a bottom pane" without needing a second,
    // separately-scrolled chart pane.
    tvVolumeSeries = tvChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'tv-volume',
    });
    tvChart.priceScale('tv-volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    tvChart.subscribeCrosshairMove(param => {
        if (!param || !param.time) {
            updateLegendFromCandle(chartState.candles[chartState.candles.length - 1] || null);
            return;
        }
        const bar = param.seriesData.get(tvCandleSeries);
        const vol = param.seriesData.get(tvVolumeSeries);
        if (!bar) return;
        updateLegendFromCandle({
            time: fromDisplaySeconds(param.time, chartState.timezone),
            open: bar.open, high: bar.high, low: bar.low, close: bar.close,
            volume: vol ? vol.value : 0,
        });
    });

    tvChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (!range) return;
        if (range.from < 10) loadOlderCandles();
    });

    container.addEventListener('dblclick', () => tvChart.timeScale().fitContent());
}

function resetChartZoom() {
    if (tvChart) tvChart.timeScale().fitContent();
}

// ── SWITCHERS ────────────────────────────────────────────
async function populateSymbolSwitcher() {
    const sel = document.getElementById('chart-symbol');
    const symbols = await api('get_symbols');
    chartState.symbols = Array.isArray(symbols) ? symbols : [];
    sel.innerHTML = chartState.symbols.map(s => `<option value="${s.symbol}">${s.display_name}</option>`).join('') || '<option>No symbols configured</option>';
    if (!chartState.symbol && chartState.symbols.length) chartState.symbol = chartState.symbols[0].symbol;
    if (chartState.symbol) sel.value = chartState.symbol;
    updateEarliestNote();
}
function updateEarliestNote() {
    const note = document.getElementById('chart-earliest-note');
    if (!note) return;
    const s = chartState.symbols.find(s => s.symbol === chartState.symbol);
    if (s && s.earliest_candle_ms) {
        const d = new Date(s.earliest_candle_ms);
        note.textContent = `Data from ${d.toISOString().slice(0, 10)}`;
    } else {
        note.textContent = '';
    }
}
function populateTimezoneSwitcher() {
    const sel = document.getElementById('chart-timezone');
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    chartState.timezone = browserTz;
    const zones = [[browserTz, `${browserTz} (local)`]].concat(TV_TIMEZONES.filter(([tz]) => tz !== browserTz));
    sel.innerHTML = zones.map(([tz, label]) => `<option value="${tz}">${label}</option>`).join('');
    sel.value = browserTz;
}
function setActiveTfButton(tf) {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
}

async function onChartSymbolChange() {
    chartState.symbol = document.getElementById('chart-symbol').value;
    updateEarliestNote();
    chartState.exhaustedOlder = false;
    await loadInitialWindow(null);
}
async function onChartTimeframeChange(tf) {
    if (tf === chartState.timeframe) return;
    // Capture the currently-visible window (in display-domain seconds) before swapping
    // timeframes, so the new timeframe's data loads centered on roughly the same
    // calendar window instead of always snapping back to "most recent."
    let anchor = null;
    if (tvChart) {
        const vr = tvChart.timeScale().getVisibleRange();
        if (vr && vr.to) anchor = vr.to;
    }
    chartState.timeframe = tf;
    chartState.exhaustedOlder = false;
    setActiveTfButton(tf);
    await loadInitialWindow(anchor);
    if (anchor) {
        const vr = tvChart.timeScale().getVisibleRange();
        // Best-effort: re-apply the same display window; if the new timeframe's data
        // doesn't cover it exactly, Lightweight Charts clamps to what's actually loaded.
        try { tvChart.timeScale().setVisibleRange({ from: anchor - 3600 * 24 * 30, to: anchor }); } catch (e) {}
    }
}
async function onChartTimezoneChange() {
    chartState.timezone = document.getElementById('chart-timezone').value;
    renderChartData();
    tvChart.timeScale().fitContent();
}

// ── PAGE ENTRY POINT (called from js/app.js's showPage()) ─
let chartInitialized = false;
async function loadChart() {
    if (typeof LightweightCharts === 'undefined') {
        const el = document.getElementById('tv-chart');
        if (el) el.innerHTML = '<div style="color:#ef5350;padding:20px;font-family:monospace">Lightweight Charts failed to load (check network/CDN access).</div>';
        return;
    }
    if (chartInitialized) return;
    chartInitialized = true;

    populateTimezoneSwitcher();
    initTvChart();
    await populateSymbolSwitcher();
    setActiveTfButton(chartState.timeframe);
    if (chartState.symbol) await loadInitialWindow(null);
}
