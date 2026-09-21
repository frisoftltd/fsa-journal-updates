
<!-- ── AUTO RISK CALCULATOR (v3.17.0, amended v3.17.1) ──
     Stop loss % is the only required input — balance, risk %, and the margin/limit
     bookkeeping all come from the active challenge and trades already taken. No Calculate
     button: js/calculator.js recomputes live (debounced) on every input change via
     CalculatorController::autoRiskPreview()/getRiskStatus().

     v3.17.1 STOP-state amendment: balance, margin in use, available margin, the open-
     positions list, and the status strip stay visible even when a trade limit is
     reached — only the stop%-dependent sizing numbers (risk/position/margin/quantity)
     and "Use in Trade Form →" disappear, inside #calc-results-inner. Those five always-
     visible pieces live outside that container specifically so js/calculator.js never
     has to touch them when rendering a STOP state. -->
<div class="page" id="page-calculator">
  <div style="max-width:900px;margin:0 auto">

    <!-- Live status strip — replaces the old static "Max 2 trades/day | ..." notice bar.
         Every number here comes from CalculatorController::getRiskStatus(); nothing is
         hardcoded. Always visible, including during a STOP. -->
    <div class="card" id="calc-status-strip" style="margin-bottom:16px;padding:10px 14px">
      <div id="calc-status-normal" style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;font-family:var(--font-mono);align-items:center">
        <span id="cs-trades-day">Today —/—</span>
        <span id="cs-trades-week">Week —/—</span>
        <span id="cs-losses-day">Losses today —/—</span>
        <span id="cs-daily-pnl">Daily P&amp;L —</span>
      </div>
      <div id="calc-status-stop" style="display:none;color:var(--red);font-family:var(--font-head);font-size:13px;text-align:center;padding:4px 0"></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card">
        <div class="card-title">Inputs</div>
        <div class="form-group" style="margin-bottom:14px">
          <label>Challenge</label>
          <select id="calc-challenge" onchange="onCalcChallengeChange()" style="width:100%"></select>
        </div>
        <!-- Balance/Margin in Use/Available Margin — always visible, even during a
             trade-limits STOP (v3.17.1 §3). Risk % is stop%-independent too (ladder tier
             only needs balance), so it stays here rather than inside the STOP-hidden
             outputs card. -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
          <div>
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Balance (today, auto)</div>
            <div id="calc-balance-display" style="font-family:var(--font-head);font-size:16px">—</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Risk % (ladder, auto)</div>
            <div id="calc-risk-pct-display" style="font-family:var(--font-head);font-size:16px">—</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Margin in Use</div>
            <div id="calc-margin-in-use-display" style="font-family:var(--font-head);font-size:16px;color:var(--orange)">—</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Available Margin</div>
            <div id="calc-available-margin-display" style="font-family:var(--font-head);font-size:16px;color:var(--green)">—</div>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px"><label>Stop Loss (%) <span style="color:var(--red)">*</span></label><input type="number" id="calc-stop-pct" step="0.01" placeholder="e.g. 1.61" oninput="scheduleCalcUpdate()"></div>
        <div class="form-group" style="margin-bottom:14px"><label>Leverage (x)</label><input type="number" id="calc-leverage" step="0.01" placeholder="e.g. 5" oninput="scheduleCalcUpdate()"></div>
        <div class="form-group" style="margin-bottom:0"><label>Entry Price <span style="font-weight:400;color:var(--text3)">— optional, only for quantity</span></label><input type="number" id="calc-entry" step="0.0001" placeholder="optional" oninput="scheduleCalcUpdate()"></div>
      </div>
      <div class="card" id="calc-results" style="display:flex;flex-direction:column;justify-content:center">
        <div class="card-title">Live Outputs</div>
        <div id="calc-results-inner" style="color:var(--text3);text-align:center;padding:30px 0">Enter a stop loss % to see position sizing</div>
      </div>
    </div>

    <!-- Open Positions — always visible, including during a STOP (v3.17.1 §3). Each
         row's planned_margin is what margin_in_use above sums. -->
    <div class="card" style="margin-top:16px">
      <div class="card-title">Open Positions</div>
      <div id="calc-open-positions">
        <div style="color:var(--text3);font-size:12px;padding:8px 0">Loading…</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">Risk Rules</div>
      <div id="calc-ladder-tiers" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
        <div style="color:var(--text3);font-size:12px;padding:8px 0">Loading ladder…</div>
      </div>
    </div>

  </div>
</div>
