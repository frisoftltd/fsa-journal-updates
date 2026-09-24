
<!-- ── BACKTESTING CHART (Phase 1a) ──
     Candlestick + volume chart styled to match TradingView, reading only from this
     app's own MySQL candle store via get_symbols/get_candles (ChartController.php) —
     never calls Bybit from the browser. Symbol list and timeframe/timezone switchers
     are wired up in js/chart.js; this file is markup + layout only, per this app's own
     "pages/ = HTML only, no logic" convention. -->
<div class="page" id="page-chart">
  <div class="card" style="margin-bottom:14px;padding:12px 14px">
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end">
      <div class="form-group" style="min-width:220px;flex:0 0 auto">
        <label>Symbol</label>
        <select id="chart-symbol" onchange="onChartSymbolChange()"><option>Loading...</option></select>
      </div>
      <div class="form-group" style="flex:0 0 auto">
        <label>Timeframe</label>
        <div id="chart-tf-switcher" style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm tf-btn" data-tf="15m" onclick="onChartTimeframeChange('15m')">15m</button>
          <button class="btn btn-ghost btn-sm tf-btn" data-tf="1H" onclick="onChartTimeframeChange('1H')">1H</button>
          <button class="btn btn-ghost btn-sm tf-btn" data-tf="4H" onclick="onChartTimeframeChange('4H')">4H</button>
          <button class="btn btn-ghost btn-sm tf-btn" data-tf="1D" onclick="onChartTimeframeChange('1D')">1D</button>
        </div>
      </div>
      <div class="form-group" style="min-width:220px;flex:0 0 auto">
        <label>Timezone</label>
        <select id="chart-timezone" onchange="onChartTimezoneChange()"></select>
      </div>
      <div class="form-group" style="flex:0 0 auto">
        <label>&nbsp;</label>
        <button class="btn btn-ghost btn-sm" onclick="resetChartZoom()" title="Double-click the chart to do the same">Reset Zoom</button>
      </div>
      <div style="margin-left:auto;font-size:11px;color:var(--text3);align-self:center" id="chart-earliest-note"></div>
    </div>
  </div>

  <!-- Deliberately dark regardless of the app's own light theme (css/brand.css) — this
       is the one place in the app meant to visually match TradingView's own chart pane,
       the same way an embedded TradingView widget looks when dropped into a lighter
       dashboard. Colors are set inline by Lightweight Charts itself (js/chart.js); the
       wrapper's own dark background/border here is just so there's no light gap visible
       around the canvas before the library finishes laying out. -->
  <div class="tv-chart-wrap">
    <div class="tv-legend" id="tv-legend"></div>
    <div id="tv-chart"></div>
  </div>
</div>
