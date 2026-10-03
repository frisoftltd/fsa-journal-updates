/**
 * FundedControl — Backtest Results (v3.22.8)
 *
 * "Saved Backtests only offers Resume. There's no way to see how the strategy performed.
 * This page is the whole point of backtesting." Reuses btApi()/escapeHtml()/fmt()/
 * pnlCls()/fmtPrice5()/btStatusBadge() from js/app.js and js/backtest.js (both loaded
 * first) rather than duplicating them.
 *
 * Layout is deliberately column-based, not three separate tables: BR_METRIC_ROWS is the
 * one list of which metrics exist and how each formats, and brMetricTableHtml() renders
 * however many {label, block} columns it's given. Today that's Overall/Long/Short; the
 * v3.23.0 gate-checklist clean/not-clean split only needs a fourth column pushed onto
 * that array, not a rewrite of this table or the metrics it reads (which already come
 * back from the server in this same three-block shape — see backtest_engine.php's own
 * backtestMetricsBlock() doc comment).
 */
let brSessionId = null;
let brData = null;

async function loadBacktestResults(sessionId) {
    brSessionId = parseInt(sessionId, 10) || null;
    const el = document.getElementById('br-content');
    el.innerHTML = '<div class="sb-loading" style="color:var(--text3);padding:24px;text-align:center">Loading…</div>';
    if (!brSessionId) {
        el.innerHTML = '<div class="card" style="padding:24px">No backtest session specified.</div>';
        return;
    }

    const data = await btApi(`get_backtest_results&session_id=${brSessionId}`);
    if (!data || data.error) {
        el.innerHTML = `<div class="card" style="padding:32px 20px;text-align:center">
            <div style="color:var(--red);margin-bottom:14px">Failed to load results — ${escapeHtml(data ? data.error : 'unknown error')}</div>
            <button class="btn btn-primary btn-sm" onclick="loadBacktestResults(${brSessionId})">Retry</button>
        </div>`;
        return;
    }
    brData = data;
    el.innerHTML = brPageHtml(data);
    brRenderEquityChart(data.metrics.equity_curve, data.session.starting_balance);
}

function brSignedR(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`; }
function brFmtDate(ms) { return ms ? new Date(ms).toISOString().slice(0, 10) : '—'; }
function brFmtDateTime(ms) { return ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—'; }

// One row per metric; `fmt(value, block)` gets the metric's own value for that column
// PLUS the whole block (needed by win_rate, which also shows its Wilson interval).
const BR_METRIC_ROWS = [
    { key: 'n', label: 'Trades', fmt: v => v },
    { key: 'wins', label: 'Wins', fmt: v => v },
    { key: 'losses', label: 'Losses', fmt: v => v },
    { key: 'breakevens', label: 'Break-evens', fmt: v => v },
    { key: 'win_rate', label: 'Win rate (95% CI)', fmt: (v, b) => v === null ? '—' :
        `${(v * 100).toFixed(1)}% (${(b.win_rate_wilson_lower * 100).toFixed(0)}–${(b.win_rate_wilson_upper * 100).toFixed(0)}%)` },
    { key: 'avg_r', label: 'Average R', fmt: v => v === null ? '—' : brSignedR(v) },
    { key: 'expectancy_r', label: 'Expectancy R / trade', fmt: v => v === null ? '—' : brSignedR(v) },
    { key: 'total_r', label: 'Total R', fmt: v => v === null ? '—' : brSignedR(v) },
    { key: 'profit_factor', label: 'Profit factor', fmt: v => v === null ? '—' : v.toFixed(2) },
    { key: 'avg_win_r', label: 'Avg win R', fmt: v => v === null ? '—' : brSignedR(v) },
    { key: 'avg_loss_r', label: 'Avg loss R', fmt: v => v === null ? '—' : brSignedR(v) },
    { key: 'net_usd', label: 'Net $', fmt: v => fmt(v) },
    { key: 'total_fees', label: 'Total fees', fmt: v => fmt(v) },
    { key: 'fees_pct_of_gross', label: 'Fees % of gross', fmt: v => v === null ? '—' : v.toFixed(1) + '%' },
    { key: 'longest_win_streak', label: 'Longest win streak', fmt: v => v },
    { key: 'longest_loss_streak', label: 'Longest loss streak', fmt: v => v },
    { key: 'max_drawdown_usd', label: 'Max drawdown $', fmt: v => fmt(v) },
    { key: 'max_drawdown_pct', label: 'Max drawdown %', fmt: v => v.toFixed(1) + '%' },
];

function brMetricTableHtml(columns) {
    const head = columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
    const body = BR_METRIC_ROWS.map(r => {
        const cells = columns.map(c => `<td>${r.fmt(c.block[r.key], c.block)}</td>`).join('');
        return `<tr><td class="br-metric-label">${escapeHtml(r.label)}</td>${cells}</tr>`;
    }).join('');
    return `<div class="card" style="padding:0;overflow-x:auto">
        <table class="br-metric-table"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>`;
}

function brStatTilesHtml(overall) {
    const tiles = [
        ['Trades', overall.n],
        ['Win rate', overall.win_rate === null ? '—' : (overall.win_rate * 100).toFixed(1) + '%'],
        ['Expectancy R', overall.expectancy_r === null ? '—' : brSignedR(overall.expectancy_r)],
        ['Profit factor', overall.profit_factor === null ? '—' : overall.profit_factor.toFixed(2)],
        ['Net $', fmt(overall.net_usd)],
        ['Max DD', `${fmt(overall.max_drawdown_usd)} (${overall.max_drawdown_pct.toFixed(1)}%)`],
    ];
    return `<div class="br-tiles">${tiles.map(([label, val]) => `
        <div class="br-tile"><div class="br-tile-label">${label}</div><div class="br-tile-value">${val}</div></div>`).join('')}</div>`;
}

/** "Below 30 closed trades, the header must read EARLY SIGNAL — {n} of 30 trades. At 30
 *  or more with expectancy > 0, show Positive expectancy on this sample. Otherwise
 *  nothing extra." Exactly those three states, checked in that order. */
function brSampleBannerHtml(overall) {
    if (overall.n < 30) return `<div class="br-sample-banner br-sample-early">EARLY SIGNAL — ${overall.n} of 30 trades</div>`;
    if (overall.expectancy_r !== null && overall.expectancy_r > 0) return `<div class="br-sample-banner br-sample-positive">Positive expectancy on this sample</div>`;
    return '';
}

function brHeaderHtml(session, overall) {
    const dateRange = session.start_time ? `${brFmtDate(session.start_time)} → ${brFmtDate(session.replay_cursor_ms)}` : '—';
    return `
    <div class="br-header">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div>
                <h2 style="margin:0 0 4px;font-family:var(--font-head);font-size:20px">${escapeHtml(session.session_name || '(untitled)')}</h2>
                <div class="br-header-meta">
                    <span>${session.symbol ? escapeHtml(session.symbol) : '🙈 Blind'}</span>
                    <span>${escapeHtml(session.replay_timeframe)}</span>
                    <span>${dateRange}</span>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
                ${btStatusBadge(session.status)}
                <button class="btn btn-ghost btn-sm" onclick="brDownloadCsv()">⬇ Download CSV</button>
            </div>
        </div>
        ${brSampleBannerHtml(overall)}
    </div>`;
}

function brTradeListHtml(trades) {
    if (!trades.length) return '<div class="card" style="padding:16px;color:var(--text3)">No closed trades yet.</div>';
    const rows = trades.map(t => `
        <tr>
            <td>${brFmtDateTime(t.time_in)}</td>
            <td>${brFmtDateTime(t.time_out)}</td>
            <td>${escapeHtml(t.direction)}</td>
            <td>${fmtPrice5(t.entry_price)}</td>
            <td>${fmtPrice5(t.stop_loss)}</td>
            <td>${t.take_profit !== null ? fmtPrice5(t.take_profit) : '—'}</td>
            <td>${t.exit_price !== null ? fmtPrice5(t.exit_price) : '—'}</td>
            <td>${escapeHtml(t.exit_reason || '—')}</td>
            <td class="${t.r_multiple !== null ? pnlCls(t.r_multiple) : ''}">${t.r_multiple !== null ? brSignedR(t.r_multiple) : '—'}</td>
            <td class="${pnlCls(t.net_pnl)}">${fmt(t.net_pnl)}</td>
            <td>${t.duration_bars !== null ? t.duration_bars : '—'}</td>
        </tr>`).join('');
    return `<div class="card" style="padding:0;overflow-x:auto">
        <table class="br-trade-table">
            <thead><tr><th>In</th><th>Out</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP</th><th>Exit</th><th>Reason</th><th>R</th><th>Net $</th><th>Bars</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function brPageHtml(data) {
    const { session, metrics, trades } = data;
    const columns = [
        { label: 'Overall', block: metrics.overall },
        { label: 'Long', block: metrics.long },
        { label: 'Short', block: metrics.short },
    ];
    return `
        ${brHeaderHtml(session, metrics.overall)}
        ${brStatTilesHtml(metrics.overall)}
        <div class="br-panel-title">Metrics</div>
        ${brMetricTableHtml(columns)}
        <div class="br-panel-title">Equity Curve</div>
        <div class="card" style="padding:14px"><div style="height:260px"><canvas id="br-equity-chart"></canvas></div></div>
        <div class="br-panel-title">Trades (${trades.length})</div>
        ${brTradeListHtml(trades)}
    `;
}

function brRenderEquityChart(curve, startingBalance) {
    destroyCharts('brEquity');
    const canvas = document.getElementById('br-equity-chart');
    if (!canvas) return;
    const labels = ['Start', ...curve.map((_, i) => 'T' + (i + 1))];
    const equitySeries = [startingBalance, ...curve.map(p => p.equity_usd)];
    const rSeries = [0, ...curve.map(p => p.cumulative_r)];
    const co = chartOpts();
    charts.brEquity = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Equity $', data: equitySeries, borderColor: '#1A56DB', backgroundColor: 'rgba(26,86,219,0.08)', fill: true, tension: 0.3, pointRadius: 2, yAxisID: 'y' },
                { label: 'Cumulative R', data: rSeries, borderColor: '#0FA958', borderDash: [4, 3], fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y1' },
            ],
        },
        options: {
            ...co,
            scales: {
                x: co.scales.x,
                y: { position: 'left', ticks: { color: '#6C7A8D', callback: v => '$' + v, font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.06)' } },
                y1: { position: 'right', ticks: { color: '#6C7A8D', callback: v => v + 'R', font: { size: 10 } }, grid: { drawOnChartArea: false } },
            },
        },
    });
}

/** "A Download CSV button for the trade list" — one row per trade, client-side, no
 *  server round trip (brData is already the full payload this page rendered from). */
function brDownloadCsv() {
    if (!brData) return;
    const headers = ['time_in', 'time_out', 'direction', 'entry_price', 'stop_loss', 'take_profit', 'exit_price', 'exit_reason', 'r_multiple', 'net_pnl', 'duration_bars'];
    const lines = [headers.join(',')];
    brData.trades.forEach(t => {
        lines.push(headers.map(h => {
            let v = t[h];
            if ((h === 'time_in' || h === 'time_out') && v !== null) v = new Date(v).toISOString();
            if (v === null || v === undefined) v = '';
            const s = String(v);
            return s.includes(',') ? `"${s}"` : s;
        }).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest-${brSessionId}-trades.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
