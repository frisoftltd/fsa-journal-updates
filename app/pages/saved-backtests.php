<!-- ── SAVED BACKTESTS (v3.20.2 — split out of the Backtesting page into its own
     sidebar entry, directly under Backtesting) ──
     All logic lives in js/saved-backtests.js. loadSavedBacktests() is called from
     js/app.js::showPage() every time this page is opened, same pattern as every other
     page in the app. -->
<div class="page" id="page-saved-backtests">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <h2 style="margin:0;font-family:var(--font-head);font-size:20px">Saved Backtests</h2>
    <button class="btn btn-primary btn-sm" onclick="showPage('backtest')">+ New Backtest</button>
  </div>
  <div id="sb-content">
    <div class="sb-loading" style="color:var(--text3);padding:24px;text-align:center">Loading…</div>
  </div>
</div>
