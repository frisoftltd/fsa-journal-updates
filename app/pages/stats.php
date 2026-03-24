
<!-- ── STATISTICS ── -->
<div class="page" id="page-stats">
  <div class="filter-bar" style="margin-bottom:14px">
    <select id="stat-month" style="max-width:130px">
      <option value="">All Months</option>
      <?php for($m=1;$m<=12;$m++) echo "<option value='$m'>".date('F',mktime(0,0,0,$m,1))."</option>"; ?>
    </select>
    <select id="stat-year" style="max-width:100px">
      <?php for($y=date('Y');$y>=2024;$y--) echo "<option value='$y'>$y</option>"; ?>
    </select>
    <button class="btn btn-primary btn-sm" onclick="loadStats()">Apply</button>
  </div>
  <div class="stats-grid" style="margin-bottom:14px">
    <div class="card">
      <div class="card-title">Overall Performance</div>
      <div class="stat-row"><span class="stat-label">Total Trades</span><span class="stat-val blue" id="s-total">—</span></div>
      <div class="stat-row"><span class="stat-label">Wins</span><span class="stat-val green" id="s-wins">—</span></div>
      <div class="stat-row"><span class="stat-label">Losses</span><span class="stat-val red" id="s-losses">—</span></div>
      <div class="stat-row"><span class="stat-label">Break Evens</span><span class="stat-val orange" id="s-be">—</span></div>
      <div class="stat-row"><span class="stat-label">Win Rate</span><span class="stat-val" id="s-wr">—</span></div>
      <div class="stat-row"><span class="stat-label">Profit Factor</span><span class="stat-val" id="s-pf">—</span></div>
      <div class="stat-row"><span class="stat-label">Avg R Multiple</span><span class="stat-val" id="s-avgr">—</span></div>
    </div>
    <div class="card">
      <div class="card-title">P&amp;L &amp; Fees</div>
      <div class="stat-row"><span class="stat-label">Gross P&amp;L</span><span class="stat-val" id="s-gross">—</span></div>
      <div class="stat-row"><span class="stat-label">Total Fees Paid</span><span class="stat-val red" id="s-fees">—</span></div>
      <div class="stat-row"><span class="stat-label">Net P&amp;L</span><span class="stat-val" id="s-netpnl">—</span></div>
      <div class="stat-row"><span class="stat-label">Avg Win</span><span class="stat-val green" id="s-avgwin">—</span></div>
      <div class="stat-row"><span class="stat-label">Avg Loss</span><span class="stat-val red" id="s-avgloss">—</span></div>
      <div class="stat-row"><span class="stat-label">Fees % of Gross</span><span class="stat-val" id="s-fee-pct">—</span></div>
      <div class="stat-row"><span id="s-fee-warning" style="font-size:12px">—</span></div>
    </div>
  </div>
  <div class="stats-grid" style="margin-bottom:14px">
    <div class="card">
      <div class="card-title">Drawdown &amp; Streak</div>
      <div class="stat-row"><span class="stat-label">Max Drawdown</span><span class="stat-val red" id="s-maxdd">—</span></div>
      <div class="stat-row"><span class="stat-label">Current Drawdown</span><span class="stat-val" id="s-curdd">—</span></div>
      <div class="stat-row"><span class="stat-label">Current Streak</span><span class="stat-val" id="s-streak-cur">—</span></div>
      <div class="stat-row"><span class="stat-label">Longest Win Streak</span><span class="stat-val green" id="s-streak-maxwin">—</span></div>
      <div class="stat-row"><span class="stat-label">Longest Loss Streak</span><span class="stat-val red" id="s-streak-maxloss">—</span></div>
    </div>
    <div class="card">
      <div class="card-title">By Session</div>
      <table><thead><tr><th>Session</th><th>Trades</th><th>Win%</th><th>Net P&amp;L</th></tr></thead>
      <tbody id="s-session-tbody"></tbody></table>
    </div>
  </div>
  <div class="stats-grid" style="margin-bottom:14px">
    <div class="card">
      <div class="card-title">By Fib Level</div>
      <table><thead><tr><th>Level</th><th>Trades</th><th>Win%</th><th>Net P&amp;L</th></tr></thead>
      <tbody id="s-fib-tbody"></tbody></table>
    </div>
    <div class="card">
      <div class="card-title">By Pair</div>
      <table><thead><tr><th>Pair</th><th>Trades</th><th>Win%</th><th>Net P&amp;L</th></tr></thead>
      <tbody id="s-pair-tbody"></tbody></table>
    </div>
  </div>
  <div class="card">
    <div class="card-title">By Direction</div>
    <table><thead><tr><th>Direction</th><th>Trades</th><th>Win%</th><th>Net P&amp;L</th></tr></thead>
    <tbody id="s-dir-tbody"></tbody></table>
  </div>
</div>
