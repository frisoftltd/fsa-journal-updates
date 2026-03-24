
<!-- ── DASHBOARD ── -->
<div class="page active" id="page-dashboard">
  <div class="alert-bar" id="alert-bar"></div>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Total Trades</div><div class="kpi-val blue" id="kpi-trades">—</div></div>
    <div class="kpi"><div class="kpi-label">Win Rate</div><div class="kpi-val" id="kpi-winrate">—</div></div>
    <div class="kpi"><div class="kpi-label">Net P&amp;L</div><div class="kpi-val" id="kpi-pnl">—</div></div>
    <div class="kpi"><div class="kpi-label">Total Fees</div><div class="kpi-val red" id="kpi-fees">—</div></div>
    <div class="kpi"><div class="kpi-label">Avg R</div><div class="kpi-val" id="kpi-r">—</div></div>
    <div class="kpi"><div class="kpi-label">Profit Factor</div><div class="kpi-val orange" id="kpi-pf">—</div></div>
  </div>
  <div style="display:flex;gap:10px;margin-bottom:14px">
    <div class="card" style="flex:1;padding:12px 16px">
      <div class="card-title" style="margin-bottom:6px">Current Streak</div>
      <div style="font-family:var(--font-head);font-size:20px" id="kpi-streak">—</div>
    </div>
    <div class="card" style="flex:3;padding:12px 16px">
      <div class="card-title" style="margin-bottom:6px">Performance Calendar</div>
      <div id="calendar-wrap" style="display:flex;flex-wrap:wrap;gap:8px"></div>
    </div>
  </div>
  <div class="charts-grid">
    <div class="card"><div class="card-title">Win / Loss Split</div><div class="chart-wrap"><canvas id="chart-donut"></canvas></div></div>
    <div class="card"><div class="card-title">Cumulative P&amp;L</div><div class="chart-wrap"><canvas id="chart-cumulative"></canvas></div></div>
  </div>
  <div class="charts-grid">
    <div class="card"><div class="card-title">Drawdown Curve</div><div class="chart-wrap"><canvas id="chart-drawdown"></canvas></div></div>
    <div class="card"><div class="card-title">P&amp;L Per Trade</div><div class="chart-wrap"><canvas id="chart-pnl"></canvas></div></div>
  </div>
  <div class="charts-grid">
    <div class="card"><div class="card-title">Win Rate by Fib Level</div><div class="chart-wrap"><canvas id="chart-fib"></canvas></div></div>
    <div class="card"><div class="card-title">P&amp;L by Session</div><div class="chart-wrap"><canvas id="chart-session"></canvas></div></div>
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="card-title">Best Trading Hours (GMT+2)</div>
    <div id="hours-heatmap" style="display:flex;flex-wrap:wrap;gap:4px;align-items:flex-end;padding:8px 0"></div>
  </div>
</div>
