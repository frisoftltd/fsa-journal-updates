
<!-- ── BACKTESTING CHART (Phase 1a; full-bleed layout v3.19.2) ──
     Candlestick + volume chart styled to match TradingView, reading only from this
     app's own MySQL candle store via get_symbols/get_candles (ChartController.php) —
     never calls Bybit from the browser. Symbol list and timeframe/timezone switchers
     are wired up in js/chart.js; this file is markup + layout only, per this app's own
     "pages/ = HTML only, no logic" convention.

     Full-bleed: #page-chart has no padding of its own here (js/app.js sets
     body.chart-active while this page is showing, which is what removes .page's normal
     20px/24px padding and locks .main to exactly the viewport height — see
     css/style.css's "BACKTESTING CHART" block). The controls bar and chart pane below
     are the only two children, stacked in a flex column that fills 100% of that space:
     the controls bar is flex-shrink:0 (its own intrinsic height), the chart wrap is
     flex:1 (everything else). -->
<div class="page" id="page-chart">
  <div class="tv-controls-bar">
    <select id="chart-symbol" onchange="onChartSymbolChange()"><option>Loading...</option></select>
    <div class="tf-group" id="chart-tf-switcher">
      <button class="btn btn-ghost btn-sm tf-btn" data-tf="15m" onclick="onChartTimeframeChange('15m')">15m</button>
      <button class="btn btn-ghost btn-sm tf-btn" data-tf="1H" onclick="onChartTimeframeChange('1H')">1H</button>
      <button class="btn btn-ghost btn-sm tf-btn" data-tf="4H" onclick="onChartTimeframeChange('4H')">4H</button>
      <button class="btn btn-ghost btn-sm tf-btn" data-tf="1D" onclick="onChartTimeframeChange('1D')">1D</button>
    </div>
    <select id="chart-timezone" onchange="onChartTimezoneChange()" title="Timezone"></select>
    <button class="btn btn-ghost btn-sm" onclick="resetChartZoom()" title="Double-click the chart to do the same">Reset Zoom</button>
    <div id="chart-earliest-note"></div>
  </div>

  <!-- Deliberately dark regardless of the app's own light theme (css/brand.css) — this
       is the one place in the app meant to visually match TradingView's own chart pane,
       the same way an embedded TradingView widget looks when dropped into a lighter
       dashboard. Colors are set inline by Lightweight Charts itself (js/chart.js); the
       wrapper's own dark background here is just so there's no light gap visible around
       the canvas before the library finishes laying out. -->
  <div class="tv-chart-wrap">
    <div class="tv-legend" id="tv-legend"></div>
    <div id="tv-chart"></div>
  </div>
</div>
