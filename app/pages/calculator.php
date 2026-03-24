
<!-- ── RISK CALCULATOR ── -->
<div class="page" id="page-calculator">
  <div style="max-width:800px;margin:0 auto">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card">
        <div class="card-title">Inputs</div>
        <div class="form-group" style="margin-bottom:14px"><label>1. Full Trading Balance ($)</label><input type="number" id="calc-balance" step="0.01" placeholder="e.g. 9446"></div>
        <div class="form-group" style="margin-bottom:14px"><label>2. Stop Loss (%)</label><input type="number" id="calc-sl-pct" step="0.01" placeholder="e.g. 1.61"></div>
        <div class="form-group" style="margin-bottom:14px"><label>3. Risk Level (%)</label><input type="number" id="calc-risk-pct" step="0.01" placeholder="e.g. 0.25"></div>
        <div class="form-group" style="margin-bottom:20px"><label>4. Leverage (x)</label><input type="number" id="calc-leverage" step="1" placeholder="e.g. 5"></div>
        <button class="btn btn-success" style="width:100%;padding:12px;font-size:14px" onclick="calcSimple()">Calculate</button>
      </div>
      <div class="card" id="calc-results" style="display:flex;flex-direction:column;justify-content:center">
        <div class="card-title">Calculation Results</div>
        <div id="calc-results-inner" style="color:var(--text3);text-align:center;padding:30px 0">Enter your values and click Calculate</div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-title">Risk Rules</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div style="background:var(--bg3);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Recovery Mode</div>
          <div style="font-family:var(--font-head);font-size:18px;color:var(--orange)">0.25%</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Below starting</div>
        </div>
        <div style="background:var(--bg3);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Normal Mode</div>
          <div style="font-family:var(--font-head);font-size:18px;color:var(--blue2)">0.50%</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">At starting balance</div>
        </div>
        <div style="background:var(--bg3);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Passing Mode</div>
          <div style="font-family:var(--font-head);font-size:18px;color:var(--green)">1.00%</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Above target</div>
        </div>
      </div>
      <div style="margin-top:12px;padding:10px;background:var(--bg3);border-radius:6px;font-size:12px;color:var(--text2);text-align:center">
        ⚠️ Max 2 trades/day &nbsp;|&nbsp; Stop if daily limit hit &nbsp;|&nbsp; Stop after 3 consecutive losses
      </div>
    </div>
  </div>
</div>
