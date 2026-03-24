
<!-- ══ FSA PRE-TRADE CHECKLIST POPUP ══ -->
<div class="checklist-popup" id="checklist-popup">
  <h3>✅ FSA PRE-TRADE CHECKLIST</h3>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R1 — 4H context clear (bullish or bearish)</span></div>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R2 — Price at 0.618 or 0.705 Fib level on 1H</span></div>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R3 — S/R level confluences with Fib on 1H</span></div>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R4 — Price below AVWAP (short) / above AVWAP (long)</span></div>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R5 — Rejection candle CLOSED on 15M (pin bar / engulfing)</span></div>
  <div class="check-score" id="check-score" style="font-family:var(--font-head);font-size:24px;text-align:center;margin:12px 0">0/5</div>
  <div style="display:flex;gap:8px">
    <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('checklist-popup').classList.remove('open')">Cancel</button>
    <button class="btn btn-success" style="flex:1" onclick="proceedTrade()">Proceed to Trade →</button>
  </div>
</div>
<div id="checklist-overlay" onclick="document.getElementById('checklist-popup').classList.remove('open')" style="display:none;position:fixed;inset:0;z-index:290"></div>
