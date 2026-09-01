
<!-- ── BEHAVIORAL REVIEW ── -->
<div class="page" id="page-review">
  <div style="max-width:1000px">
    <div style="margin-bottom:14px">
      <div style="font-family:var(--font-head);font-size:13px;letter-spacing:1px">REVIEW</div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px">Automatic behavioral insights from your real trades. Every insight states its sample size — thin data is labelled an early signal, not a fact.</div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="form-group" style="margin:0">
          <label>Period</label>
          <select id="rv-period-type" onchange="reviewPeriodTypeChanged()" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:7px 10px;font-size:12px;font-family:var(--font-body);outline:none">
            <option value="daily">Daily</option>
            <option value="weekly" selected>Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label>Scope</label>
          <select id="rv-scope" onchange="loadReviewEngine()" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:7px 10px;font-size:12px;font-family:var(--font-body);outline:none;min-width:180px">
            <option value="">All Combined</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
          <button class="btn btn-ghost btn-sm" onclick="reviewShiftPeriod(-1)">‹ Prev</button>
          <span id="rv-period-label" style="font-family:var(--font-mono);font-size:12px;color:var(--text3);min-width:150px;text-align:center;display:inline-block">—</span>
          <button class="btn btn-ghost btn-sm" onclick="reviewShiftPeriod(1)">Next ›</button>
          <button class="btn btn-primary btn-sm" onclick="reviewJumpToday()">Today</button>
        </div>
      </div>
    </div>

    <div class="kpi-grid" id="rv-metrics" style="grid-template-columns:repeat(5,1fr)">
      <div class="kpi"><div class="kpi-label">Trades</div><div class="kpi-val" id="rv-m-trades">—</div></div>
      <div class="kpi"><div class="kpi-label">Win Rate</div><div class="kpi-val" id="rv-m-winrate">—</div></div>
      <div class="kpi"><div class="kpi-label">Avg R</div><div class="kpi-val" id="rv-m-avgr">—</div></div>
      <div class="kpi"><div class="kpi-label">Expectancy</div><div class="kpi-val" id="rv-m-expectancy">—</div></div>
      <div class="kpi"><div class="kpi-label">Net P&amp;L</div><div class="kpi-val" id="rv-m-pnl">—</div></div>
    </div>

    <div id="rv-insights"></div>
  </div>
</div>
