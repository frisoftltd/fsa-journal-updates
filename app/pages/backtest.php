
<!-- ── BACKTESTING (v3.20.2 — Saved Backtests split into its own page) ──
     Exactly one of these two is ever visible at a time (js/backtest.js::
     showBacktestScreen()), never stacked:
       #bt-screen-form   — Screen A: new-session form. This is what opens when the
                           sidebar's "Backtesting" link is clicked — no session list
                           first. Normal light-themed page content (cards/forms), same
                           design system as every other page.
       #bt-screen-window — Screen B: the actual replay — chart, controls, order panel,
                           challenge panel. Full-bleed and dark (like TradingView),
                           the one screen body.backtest-active applies to; see
                           css/style.css's "BACKTESTING" block for how that class
                           locks .main to the viewport and strips the page's own
                           padding — scoped to this screen only, not the whole module.
     Saved Backtests (formerly a third screen here) is now its own sidebar page —
     see pages/saved-backtests.php / js/saved-backtests.js. "View Backtests" navigates
     there via showPage('saved-backtests'), not a screen switch inside this page.
     All logic lives in js/backtest.js. The underlying candlestick+volume chart
     rendering (initTvChart/resizeTvChart/renderChartData/timezone handling) is reused
     from js/chart.js as-is. -->
<div class="page" id="page-backtest">

  <!-- ── SCREEN A: NEW BACKTEST ── -->
  <div class="bt-screen active" id="bt-screen-form">
    <div class="bt-form-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0;font-family:var(--font-head);font-size:20px">New Backtest</h2>
        <button class="btn btn-ghost btn-sm" onclick="showPage('saved-backtests')">View Backtests</button>
      </div>

      <div class="card form-section">
        <div class="card-title">Session</div>
        <div class="form-group" style="margin-bottom:0">
          <label>Session Name <span style="color:var(--red)">*</span></label>
          <input type="text" id="bt-setup-name" placeholder="e.g. FSA 1H BTC 10k test" maxlength="120">
        </div>
      </div>

      <div class="card form-section">
        <div class="card-title">Market &amp; Data</div>
        <div class="form-grid-2" style="margin-bottom:14px">
          <div class="form-group"><label>Symbol</label><select id="bt-setup-symbol" onchange="onBtSetupPairChange()"><option>Loading…</option></select></div>
          <div class="form-group"><label>Replay Timeframe</label>
            <select id="bt-setup-timeframe" onchange="onBtSetupPairChange()">
              <option value="15m">15m</option><option value="1H" selected>1H</option><option value="4H">4H</option><option value="1D">1D</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label>Start Date (optional — defaults a little into history so there's chart context; clear it for the very first candle)</label>
          <input type="date" id="bt-setup-start-date">
          <span id="bt-setup-date-range" style="font-size:11px;color:var(--text3)"></span>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label><input type="checkbox" id="bt-setup-blind" style="width:auto;margin-right:6px">Blind mode (hide symbol &amp; dates during replay)</label>
        </div>
      </div>

      <div class="card form-section">
        <div class="card-title">Risk</div>
        <div class="form-grid-2" style="margin-bottom:0">
          <div class="form-group"><label>Risk % per Trade</label><input type="number" id="bt-setup-risk-pct" value="1" step="0.1" min="0.01" max="100"></div>
          <div class="form-group"><label>Fee Rate % per Fill</label><input type="number" id="bt-setup-fee-rate" value="0.055" step="0.001" min="0"></div>
        </div>
      </div>

      <div class="card form-section">
        <div class="card-title">Challenge Rules — fully custom</div>
        <div class="form-group" style="margin-bottom:14px">
          <label>Prefill from an existing challenge (optional — every field below stays editable)</label>
          <select id="bt-setup-prefill" onchange="onBtPrefillChange()"><option value="">— Custom, don't prefill —</option></select>
        </div>
        <div class="form-grid-2" style="margin-bottom:14px">
          <div class="form-group"><label>Account Size ($)</label><input type="number" id="bt-setup-balance" value="10000" step="100" min="1"></div>
          <div class="form-group"><label>Profit Target (%)</label><input type="number" id="bt-setup-target" value="8" step="0.1" min="0.01"></div>
        </div>
        <div class="form-grid-2" style="margin-bottom:14px">
          <div class="form-group"><label>Daily Drawdown (%)</label><input type="number" id="bt-setup-daily-dd" value="5" step="0.1" min="0.01"></div>
          <div class="form-group"><label>Max Drawdown (%)</label><input type="number" id="bt-setup-max-dd" value="10" step="0.1" min="0.01"></div>
        </div>
        <div class="form-grid-2" style="margin-bottom:0">
          <div class="form-group"><label>Drawdown Type</label>
            <select id="bt-setup-dd-type"><option value="static">Static (from starting balance)</option><option value="trailing">Trailing (from equity peak)</option></select>
          </div>
          <div class="form-group"><label>Max Trades / Day (blank = no limit)</label><input type="number" id="bt-setup-max-trades" min="1"></div>
        </div>
      </div>

      <button class="btn btn-primary" style="width:100%" onclick="createBacktestSession()">Create Backtest</button>
      <div id="bt-setup-error" style="color:var(--red);font-size:12px;margin-top:8px"></div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px;text-align:center">Data: Bybit candles. Live fills come from BitFunded — wicks differ. Read results as indicative, not identical to live.</div>
    </div>
  </div>

  <!-- ── SCREEN B: THE BACKTEST WINDOW ── -->
  <div class="bt-screen" id="bt-screen-window">
    <div class="tv-controls-bar">
      <button class="btn btn-ghost btn-sm" onclick="showPage('saved-backtests')" title="View Backtests">☰ View Backtests</button>
      <span id="bt-window-name" style="color:#d1d4dc;font-family:var(--font-head);font-size:13px;font-weight:600"></span>
      <span id="bt-replay-symbol" style="color:#8b93a7;font-family:var(--font-mono, monospace);font-size:12px"></span>
      <!-- v3.20.10: the replay cursor's own timestamp, always visible -- required
           precisely because Prev Bar removes candles after the cursor from the chart;
           making the current position explicit here is what keeps that "visible rather
           than alarming" instead of just candles disappearing with no context. -->
      <span id="bt-cursor-time" style="color:#d1d4dc;font-family:var(--font-mono, monospace);font-size:12px;font-weight:600" title="Current replay position (UTC)"></span>
      <span style="color:#6b7280;font-size:11px" title="This is what actually steps forward/back -- independent of what timeframe you're viewing below">Replay <b id="bt-replay-clock-tf" style="color:#d1d4dc"></b></span>
      <div class="tf-group" id="bt-display-tf-group" title="Change what's displayed -- does not change the replay clock">
        <span style="color:#6b7280;font-size:11px;align-self:center">Viewing</span>
        <button class="btn btn-ghost btn-sm bt-display-tf-btn" data-tf="15m" onclick="setBtDisplayTimeframe('15m')">15m</button>
        <button class="btn btn-ghost btn-sm bt-display-tf-btn" data-tf="1H" onclick="setBtDisplayTimeframe('1H')">1H</button>
        <button class="btn btn-ghost btn-sm bt-display-tf-btn" data-tf="4H" onclick="setBtDisplayTimeframe('4H')">4H</button>
        <button class="btn btn-ghost btn-sm bt-display-tf-btn" data-tf="1D" onclick="setBtDisplayTimeframe('1D')">1D</button>
      </div>
      <div class="tf-group">
        <button class="btn btn-ghost btn-sm" onclick="btRewind()" title="Prev bar">◂ Prev Bar</button>
        <button class="btn btn-ghost btn-sm" onclick="btAdvance()" title="Next bar">Next Bar ▸</button>
        <!-- v3.20.11: "Jump to Latest" removed -- a replay whose cursor is already the
             latest visible point has nothing to jump to. -->
        <select id="bt-replay-speed" style="width:auto;min-width:70px" title="Auto-play speed">
          <option value="1" selected>1x</option><option value="2">2x</option><option value="5">5x</option><option value="10">10x</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="bt-play-btn" onclick="toggleBtAutoplay()">▶ Play</button>
        <!-- v3.20.11: the step size adapts to whichever timeframe is finer (viewed vs.
             session replay) -- always shown so a click's actual effect is never a
             surprise. Kept updated by setBtStepLabel() in js/backtest.js. -->
        <span id="bt-step-label" style="color:#6b7280;font-size:11px;align-self:center" title="What one click of Next Bar/Prev Bar actually advances by"></span>
      </div>
      <div id="bt-replay-status" style="color:#8b93a7;font-size:11px"></div>
      <div id="bt-replay-note" style="margin-left:auto;font-size:11px;color:#6b7280">Bybit data — indicative vs. live BitFunded fills</div>
    </div>

    <div class="bt-window-body">
      <div class="tv-chart-wrap">
        <div class="tv-legend" id="tv-legend"></div>
        <div id="tv-chart"></div>
      </div>

      <div class="bt-side-panel">
        <div class="bt-panel-block">
          <div class="bt-panel-title">Challenge</div>
          <div class="bt-meter"><span>Profit Target</span><div class="bt-meter-bar"><div id="bt-meter-target" class="bt-meter-fill green"></div></div><span id="bt-val-target">—</span></div>
          <div class="bt-meter"><span>Daily Drawdown</span><div class="bt-meter-bar"><div id="bt-meter-daily" class="bt-meter-fill red"></div></div><span id="bt-val-daily">—</span></div>
          <div class="bt-meter"><span>Max Drawdown</span><div class="bt-meter-bar"><div id="bt-meter-max" class="bt-meter-fill red"></div></div><span id="bt-val-max">—</span></div>
          <div class="bt-panel-row"><span>Trades today</span><span id="bt-val-trades-today">—</span></div>
          <div class="bt-panel-row"><span>Equity</span><span id="bt-val-equity">—</span></div>
          <!-- v3.20.10: rewind_count is never hidden -- "repeatedly rewinding losing
               trades is visible rather than hidden" is the explicit point of this row. -->
          <div class="bt-panel-row" id="bt-rewind-count-row" style="display:none"><span>Rewinds</span><span id="bt-val-rewind-count">0</span></div>
          <div id="bt-outcome-banner" style="display:none;margin-top:8px;padding:8px;border-radius:6px;font-size:12px"></div>
        </div>

        <div class="bt-panel-block">
          <div class="bt-panel-title">New Order</div>
          <div class="form-group" style="margin-bottom:8px">
            <select id="bt-order-type"><option value="market">Market</option><option value="limit">Limit</option></select>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button class="btn btn-sm bt-dir-btn" id="bt-dir-long" onclick="setBtDirection('Long')">Long</button>
            <button class="btn btn-sm bt-dir-btn" id="bt-dir-short" onclick="setBtDirection('Short')">Short</button>
          </div>
          <div class="form-group" id="bt-limit-price-group" style="display:none;margin-bottom:8px"><label>Limit Price</label><input type="number" id="bt-order-limit" step="any"></div>
          <div class="form-group" style="margin-bottom:8px"><label>Stop Loss</label><input type="number" id="bt-order-sl" step="any"></div>
          <div class="form-group" style="margin-bottom:10px"><label>Take Profit (optional)</label><input type="number" id="bt-order-tp" step="any"></div>
          <button class="btn btn-primary" style="width:100%" onclick="placeBtOrder()">Place Order</button>
          <div id="bt-order-error" style="color:var(--red);font-size:11px;margin-top:6px"></div>
        </div>

        <div class="bt-panel-block">
          <div class="bt-panel-title">Open Positions</div>
          <div id="bt-open-positions"><div style="color:#6b7280;font-size:12px">None</div></div>
        </div>

        <div class="bt-panel-block">
          <div class="bt-panel-title">Pending Orders</div>
          <div id="bt-pending-orders"><div style="color:#6b7280;font-size:12px">None</div></div>
        </div>
      </div>
    </div>
  </div>
</div>
