
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
  <div id="stats-scope-caption" style="font-size:11px;color:var(--text3);margin-bottom:8px"></div>
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
      <!-- v3.14.7: Max Drawdown is always the historical worst peak-to-trough figure,
           labeled explicitly as such so it isn't read as "the number the prop firm judges
           you on right now" — that's Current Drawdown's job, and its own type (static from
           starting balance, or trailing from the equity peak) is shown alongside it. -->
      <div class="stat-row"><span class="stat-label">Max Drawdown <span style="color:var(--text3);font-weight:400">(historical worst)</span></span><span class="stat-val red" id="s-maxdd">—</span></div>
      <div class="stat-row"><span class="stat-label">Current Drawdown <span style="color:var(--text3);font-weight:400" id="s-curdd-type"></span></span><span class="stat-val" id="s-curdd">—</span></div>
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
      <div id="s-fib-footnote" style="font-size:10px;color:var(--text3);margin-top:6px"></div>
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
  <div class="card">
    <!-- v3.14.0: exit_reason comes from Bitfunded's own Position History label (Stop
         Loss / Manual Closing / etc.), populated by the Bitfunded importer, never
         hand-typed. Avg R / Total R are blank for a reason bucket with no r_multiple
         recorded on any of its trades, not zero — a missing R is not the same claim as
         a recorded zero. -->
    <div class="card-title">By Exit Reason</div>
    <table><thead><tr><th>Exit Reason</th><th>Trades</th><th>Avg R</th><th>Total R</th><th>Net P&amp;L</th></tr></thead>
    <tbody id="s-exit-reason-tbody"></tbody></table>
    <div id="s-exit-reason-footnote" style="font-size:10px;color:var(--text3);margin-top:6px"></div>
  </div>
  <div class="stats-grid" style="margin-top:14px">
    <div class="card">
      <!-- v3.15.0 Phase 1 (Size Integrity). dollars-per-R is computed over the resolved
           population only (exit_reason Take Profit/Stop Loss) -- a manually-closed
           trade's R isn't the R that was actually risked. UNAVAILABLE means the
           denominator behind that figure is zero, not that it's zero. -->
      <div class="card-title">Size Integrity — Dollars per R</div>
      <div class="stat-row"><span class="stat-label">$ / R — Winners</span><span class="stat-val green" id="si-dpr-winners">—</span></div>
      <div class="stat-row"><span class="stat-label">$ / R — Losers</span><span class="stat-val red" id="si-dpr-losers">—</span></div>
      <div class="stat-row"><span class="stat-label">Size Skew (losers ÷ winners)</span><span class="stat-val" id="si-skew">—</span></div>
      <div class="stat-row"><span class="stat-label">Resolved Trades</span><span class="stat-val" id="si-resolved-n">—</span></div>
      <div id="si-skew-note" style="font-size:11px;color:var(--text3);margin-top:4px"></div>
      <!-- v3.16.0: dollars-per-R is Σ$ ÷ ΣR (a P&L-weighted harmonic mean of risk), not
           AVG(risk_amount) -- one large trade dominates it the way it wouldn't dominate a
           simple average. Stated explicitly so this figure is never read against, or
           expected to match, an arithmetic-mean risk number elsewhere on this page. -->
      <div style="font-size:10px;color:var(--text3);margin-top:8px">$ / R is Σ dollars ÷ Σ R across the resolved population — a P&amp;L-weighted harmonic mean of risk, not an arithmetic average. Not comparable to AVG(risk_amount).</div>
    </div>
    <div class="card">
      <!-- Ladder figures use every sized trade (actual_risk_pct not null), open or
           closed -- a sizing decision is real the moment a trade opens, not just once
           it resolves. -->
      <div class="card-title">Size Integrity — Ladder Adherence</div>
      <div class="stat-row"><span class="stat-label">Ladder Adherence</span><span class="stat-val" id="si-adherence">—</span></div>
      <div class="stat-row"><span class="stat-label">Tier Breaches</span><span class="stat-val red" id="si-breaches">—</span></div>
      <div class="stat-row"><span class="stat-label">Worst Deviation</span><span class="stat-val" id="si-worst-dev">—</span></div>
      <div class="stat-row"><span class="stat-label">Sized Trades</span><span class="stat-val" id="si-sized-n">—</span></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="card-title">Size Integrity — Deviation by Month</div>
    <table><thead><tr><th>Month</th><th>Trades</th><th>Avg Deviation</th></tr></thead>
    <tbody id="si-month-tbody"></tbody></table>
    <div id="si-month-footnote" style="font-size:10px;color:var(--text3);margin-top:6px">Positive = sized larger than the ladder tier prescribed; negative = smaller.</div>
  </div>
</div>
