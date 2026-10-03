<!-- ── BACKTEST RESULTS (v3.22.8) ──
     A dedicated page, not a js/backtest.js screen -- its URL hash (#backtest-results:<id>)
     needs its own #page-<name> element for js/app.js::_restoreFromHash() to resolve, the
     same reason Saved Backtests was split out into its own page in v3.20.2. No sidebar
     nav link (reached via the "Results" button on a Saved Backtests card, or the
     "Results" link in the replay screen's own top bar) -- showPage() doesn't require one.
     All logic lives in js/backtest-results.js. -->
<div class="page" id="page-backtest-results">
  <div id="br-content">
    <div class="sb-loading" style="color:var(--text3);padding:24px;text-align:center">Loading…</div>
  </div>
</div>
