
<!-- ── BACKTESTING (Phase 1b, v3.20.0) ──
     Renamed from "Chart" (Phase 1a) — the module is now about running/reviewing
     backtest sessions, not just passive candle viewing. Three internal views, same
     "one page per sidebar item, JS-toggled views inside it" pattern Report Card already
     uses (this app has no client-side router — see CLAUDE.md v3.18.0 for why):
       #bt-view-list   — session list, pass/fail outcomes, "+ New Session"
       #bt-view-setup  — session setup form (symbol/timeframe/start date/risk/fees/
                         blind mode + fully-custom challenge rules, optional prefill)
       #bt-view-replay — the actual replay: chart, controls, order panel, challenge panel
     All logic lives in js/backtest.js. The underlying candlestick+volume chart
     rendering (initTvChart/resizeTvChart/renderChartData/timezone handling) is reused
     from js/chart.js as-is — Phase 1a's own plain-browsing entry points (loadChart(),
     the symbol/timezone switchers on that old page) are no longer wired to any nav
     item now that this page owns the "Chart" route, but the lower-level rendering
     functions they were built on are exactly what this page's replay view calls into. -->
<div class="page" id="page-backtest">

  <!-- ── SESSION LIST ── -->
  <div class="bt-view active" id="bt-view-list">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:12px;color:var(--text3)">Data: Bybit candles (BTCUSDT/ETHUSDT/BNBUSDT). Live fills come from BitFunded — wicks differ. Read results as indicative, not identical to live.</div>
      <button class="btn btn-primary btn-sm" onclick="showBacktestView('setup')">+ New Session</button>
    </div>
    <div class="card">
      <div class="card-title">Sessions</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Symbol</th><th>Timeframe</th><th>Status</th><th>Equity</th><th>Progress</th><th>Created</th><th></th></tr></thead>
          <tbody id="bt-sessions-tbody"><tr><td colspan="7" style="color:var(--text3)">Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ── SESSION SETUP ── -->
  <div class="bt-view" id="bt-view-setup">
    <div class="card" style="max-width:640px;margin:0 auto">
      <div class="card-title">New Backtest Session <button class="btn btn-ghost btn-sm" onclick="showBacktestView('list')">← Back</button></div>

      <div class="form-grid-2" style="margin-bottom:14px">
        <div class="form-group"><label>Symbol</label><select id="bt-setup-symbol" onchange="onBtSetupPairChange()"><option>Loading...</option></select></div>
        <div class="form-group"><label>Replay Timeframe</label>
          <select id="bt-setup-timeframe" onchange="onBtSetupPairChange()">
            <option value="15m">15m</option><option value="1H" selected>1H</option><option value="4H">4H</option><option value="1D">1D</option>
          </select>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:14px">
        <label>Start Date</label>
        <input type="date" id="bt-setup-start-date">
        <span id="bt-setup-date-range" style="font-size:11px;color:var(--text3)"></span>
      </div>
      <div class="form-grid-2" style="margin-bottom:14px">
        <div class="form-group"><label>Risk % per Trade</label><input type="number" id="bt-setup-risk-pct" value="1" step="0.1" min="0.01" max="100"></div>
        <div class="form-group"><label>Fee Rate % per Fill</label><input type="number" id="bt-setup-fee-rate" value="0.055" step="0.001" min="0"></div>
      </div>
      <div class="form-group" style="margin-bottom:18px">
        <label><input type="checkbox" id="bt-setup-blind" style="width:auto;margin-right:6px">Blind mode (hide symbol &amp; dates during replay)</label>
      </div>

      <div class="card-title" style="margin-top:4px">Challenge Rules — fully custom</div>
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
      <div class="form-grid-2" style="margin-bottom:18px">
        <div class="form-group"><label>Drawdown Type</label>
          <select id="bt-setup-dd-type"><option value="static">Static (from starting balance)</option><option value="trailing">Trailing (from equity peak)</option></select>
        </div>
        <div class="form-group"><label>Max Trades / Day (blank = no limit)</label><input type="number" id="bt-setup-max-trades" min="1"></div>
      </div>

      <button class="btn btn-primary" style="width:100%" onclick="createBacktestSession()">Start Session</button>
      <div id="bt-setup-error" style="color:var(--red);font-size:12px;margin-top:8px"></div>
    </div>
  </div>

  <!-- ── REPLAY ── -->
  <div class="bt-view" id="bt-view-replay">
    <div class="tv-controls-bar">
      <button class="btn btn-ghost btn-sm" onclick="showBacktestView('list')" title="Back to session list">←</button>
      <span id="bt-replay-symbol" style="color:#d1d4dc;font-family:var(--font-mono, monospace);font-size:12px"></span>
      <div class="tf-group">
        <button class="btn btn-ghost btn-sm" onclick="btAdvance(false)" title="Next bar">Next Bar ▸</button>
        <button class="btn btn-ghost btn-sm" onclick="btAdvance(true)" title="Jump to the latest available bar">Jump to Latest ▸▸</button>
        <select id="bt-replay-speed" style="width:auto;min-width:90px" title="Auto-play speed">
          <option value="0">Manual</option><option value="1">1x</option><option value="2">2x</option><option value="5">5x</option><option value="10">10x</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="bt-play-btn" onclick="toggleBtAutoplay()">▶ Play</button>
      </div>
      <div id="bt-replay-status" style="color:#8b93a7;font-size:11px"></div>
      <div id="bt-replay-note" style="margin-left:auto;font-size:11px;color:#6b7280">Bybit data — indicative vs. live BitFunded fills</div>
    </div>

    <div style="display:flex;flex:1;min-height:0">
      <div class="tv-chart-wrap" style="flex:1">
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
          <div id="bt-outcome-banner" style="display:none;margin-top:8px;padding:8px;border-radius:6px;font-size:12px"></div>
        </div>

        <div class="bt-panel-block">
          <div class="bt-panel-title">New Order</div>
          <div class="form-group" style="margin-bottom:8px">
            <select id="bt-order-type" style="width:100%"><option value="market">Market</option><option value="limit">Limit</option></select>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button class="btn btn-sm" id="bt-dir-long" style="flex:1;background:var(--green);color:#fff" onclick="setBtDirection('Long')">Long</button>
            <button class="btn btn-sm" id="bt-dir-short" style="flex:1;background:var(--bg3);color:var(--text2)" onclick="setBtDirection('Short')">Short</button>
          </div>
          <div class="form-group" id="bt-limit-price-group" style="display:none;margin-bottom:8px"><label>Limit Price</label><input type="number" id="bt-order-limit" step="any"></div>
          <div class="form-group" style="margin-bottom:8px"><label>Stop Loss</label><input type="number" id="bt-order-sl" step="any"></div>
          <div class="form-group" style="margin-bottom:10px"><label>Take Profit (optional)</label><input type="number" id="bt-order-tp" step="any"></div>
          <button class="btn btn-primary" style="width:100%" onclick="placeBtOrder()">Place Order</button>
          <div id="bt-order-error" style="color:var(--red);font-size:11px;margin-top:6px"></div>
        </div>

        <div class="bt-panel-block">
          <div class="bt-panel-title">Open Positions</div>
          <div id="bt-open-positions"><div style="color:var(--text3);font-size:12px">None</div></div>
        </div>

        <div class="bt-panel-block">
          <div class="bt-panel-title">Pending Orders</div>
          <div id="bt-pending-orders"><div style="color:var(--text3);font-size:12px">None</div></div>
        </div>
      </div>
    </div>
  </div>
</div>
