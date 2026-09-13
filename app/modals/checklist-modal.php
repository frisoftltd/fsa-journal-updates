
<!-- ══ PRE-TRADE CHECKLIST POPUP ══ -->
<!-- Rendered from the active strategy's 'gate' variables by openChecklist() in trades.js — no hardcoded rule set. -->
<div class="checklist-popup" id="checklist-popup">
  <h3>✅ PRE-TRADE CHECKLIST</h3>
  <div id="checklist-items"></div>
  <div class="check-score" id="check-score" style="font-family:var(--font-head);font-size:24px;text-align:center;margin:12px 0">0/0</div>
  <div style="display:flex;gap:8px">
    <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('checklist-popup').classList.remove('open')">Cancel</button>
    <button class="btn btn-success" style="flex:1" onclick="proceedTrade()">Proceed to Trade →</button>
  </div>
</div>
<div id="checklist-overlay" onclick="document.getElementById('checklist-popup').classList.remove('open')" style="display:none;position:fixed;inset:0;z-index:290"></div>
