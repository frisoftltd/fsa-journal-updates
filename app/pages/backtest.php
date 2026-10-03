
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
        <div class="card-title">Risk &amp; Leverage</div>
        <div class="form-grid-2" style="margin-bottom:14px">
          <div class="form-group"><label>Fee Rate % per Fill (entry &amp; exit)</label><input type="number" id="bt-setup-fee-rate" value="0.04" step="0.001" min="0"></div>
          <div class="form-group"><label>Default Leverage</label>
            <select id="bt-setup-leverage">
              <option value="1">1×</option><option value="2">2×</option><option value="3">3×</option>
              <option value="5" selected>5×</option><option value="10">10×</option><option value="20">20×</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label><input type="checkbox" id="bt-setup-flat-risk" style="width:auto;margin-right:6px" onchange="onBtFlatRiskToggle()">Flat risk % per trade (skip the ladder below)</label>
        </div>
        <div class="form-group" id="bt-setup-flat-risk-row" style="margin-bottom:14px">
          <label>Risk % per Trade</label><input type="number" id="bt-setup-risk-pct" value="1" step="0.1" min="0.01" max="100">
        </div>
        <div id="bt-setup-ladder-wrap">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label style="margin:0">Risk Ladder (% of starting balance → % risk per trade)</label>
            <button type="button" class="btn btn-ghost btn-sm" id="bt-setup-ladder-prefill-btn" onclick="onBtLadderPrefill()" disabled>Prefill from challenge</button>
          </div>
          <div id="bt-setup-ladder-rows"></div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Tiers are % of THIS session's own starting balance below — not absolute dollars, since starting balance varies per session. Top tier's upper bound is always "and above."</div>
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
      <!-- v3.22.3 Part C — "header strip, always visible on the replay screen": these
           read straight off sessionSummary()'s own fields (renderBtHeaderStrip(),
           js/backtest.js), the same figures the sidebar's Challenge panel already shows
           -- this is a second, more prominent place for them, not a second source of
           truth for what they say. "Trades" (v3.22.5 Fix D) is this session's own
           trades_today/max_trades_per_day -- deliberately the ONLY trade-limit figure
           shown on this screen; the topbar's own live-challenge STOP banner is
           suppressed here on purpose, see refreshNewTradeGate()'s own comment. -->
      <div class="tf-group" id="bt-header-strip" style="gap:12px">
        <span style="color:#6b7280;font-size:11px">Equity <b id="bt-strip-equity" style="color:#d1d4dc"></b></span>
        <!-- v3.22.10 — only shown for a session with an active (non-flat) risk ladder,
             toggled by renderBtHeaderStrip() from sessionSummary()'s own ladder_risk_pct. -->
        <span id="bt-strip-tier-wrap" style="color:#6b7280;font-size:11px;display:none">Tier <b id="bt-strip-tier" style="color:#d1d4dc"></b></span>
        <span style="color:#6b7280;font-size:11px">Target <b id="bt-strip-target" style="color:#d1d4dc"></b></span>
        <span style="color:#6b7280;font-size:11px">Loss <b id="bt-strip-loss" style="color:#d1d4dc"></b></span>
        <span style="color:#6b7280;font-size:11px">Trades <b id="bt-strip-trades" style="color:#d1d4dc"></b></span>
      </div>
      <!-- v3.22.8 — opens the same Results page a Saved Backtests card's own "Results"
           button does, for the session currently open here. -->
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="if (btActiveSessionId) showPage('backtest-results', btActiveSessionId)">📊 Results</button>
      <div id="bt-replay-note" style="font-size:11px;color:#6b7280">Bybit data — indicative vs. live BitFunded fills</div>
    </div>

    <div class="bt-window-body">
      <!-- v3.21.0 — drawing tools. #bt-draw-overlay itself (the transparent canvas all
           drawings render/interact on) is created by js/backtest-drawings.js::
           btInitDrawOverlay() and appended into .tv-chart-wrap at runtime, not in this
           markup -- it needs a real <canvas> sized from #tv-chart's own live dimensions,
           which don't exist yet at page-load time. -->
      <!-- v3.21.1: hand-authored, original line-icon set (24x24 viewBox, 2px round-cap
           stroke) replacing the emoji/text placeholders -- matches the visual weight of
           a Lucide/Tabler-style toolbar (consistent sizing, stroke-only glyphs) without
           tracing either library's or TradingView's own artwork; every path here was
           drawn from scratch for this ticket. -->
      <div class="bt-draw-toolbar" id="bt-draw-toolbar" title="Drawing tools">
        <button class="bt-tool-btn" data-tool="" onclick="btSelectTool(null)" title="Cursor">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 8-6 2-2 6z"/></svg>
        </button>
        <div class="bt-draw-toolbar-sep"></div>
        <button class="bt-tool-btn" data-tool="position_long" onclick="btSelectTool('position_long')" title="Long Position">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>
        </button>
        <button class="bt-tool-btn" data-tool="position_short" onclick="btSelectTool('position_short')" title="Short Position">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/></svg>
        </button>
        <button class="bt-tool-btn" data-tool="fib_retracement" onclick="btSelectTool('fib_retracement')" title="Fibonacci Retracement">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="4" x2="9" y2="4"/><line x1="3" y1="10" x2="15" y2="10"/><line x1="3" y1="16" x2="21" y2="16"/><line x1="3" y1="4" x2="21" y2="20"/></svg>
        </button>
        <button class="bt-tool-btn" data-tool="trend_line" onclick="btSelectTool('trend_line')" title="Trend Line">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/><line x1="5" y1="19" x2="19" y2="5"/><circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none"/></svg>
        </button>
        <!-- v3.22.9 — S/R zones and order blocks. Own hand-drawn glyph, same convention
             as every other icon in this toolbar (24x24, stroke-only, no traced artwork). -->
        <button class="bt-tool-btn" data-tool="rectangle" onclick="btSelectTool('rectangle')" title="Rectangle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>
        </button>
        <button class="bt-tool-btn" data-tool="horizontal_line" onclick="btSelectTool('horizontal_line')" title="Horizontal Line">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="20" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>
        </button>
        <button class="bt-tool-btn" data-tool="horizontal_ray" onclick="btSelectTool('horizontal_ray')" title="Horizontal Ray">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="19" y2="12"/><path d="M15 8l4 4-4 4"/></svg>
        </button>
        <div class="bt-draw-toolbar-sep"></div>
        <button class="bt-util-btn active" id="bt-magnet-btn" onclick="btToggleMagnet()" title="Magnet — snap to candle open/high/low/close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v7a7 7 0 0 0 14 0V4"/><line x1="5" y1="4" x2="9" y2="4"/><line x1="15" y1="4" x2="19" y2="4"/><line x1="5" y1="8" x2="9" y2="8"/><line x1="15" y1="8" x2="19" y2="8"/></svg>
        </button>
        <button class="bt-util-btn" onclick="btDeleteSelected()" title="Delete selected (Del)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </div>
      <div class="tv-chart-wrap">
        <div class="tv-legend" id="tv-legend"></div>
        <div id="tv-chart"></div>
        <!-- v3.22.1 — order ticket, built entirely by js/backtest.js::btTicketHtml() /
             btRenderTicket() on open, same "rebuild the inner HTML on each relevant
             state change" convention js/backtest-drawings.js already uses for the
             settings popover (btDrawSettingsHtml()). Lives inside .tv-chart-wrap
             (position:relative) so it docks against the chart, not the page, and the
             chart stays visible while it's open, per the briefing. -->
        <div id="bt-ticket" class="bt-ticket" style="display:none"></div>
        <!-- v3.22.1 — the floating selection toolbar (replaces the old canvas-drawn
             "Place Long/Short" button). Positioned each redraw by
             js/backtest-drawings.js::btPositionSelectionToolbar(), just above whichever
             position-tool box is currently selected. -->
        <div id="bt-pos-toolbar" class="bt-pos-toolbar" style="display:none"></div>
        <!-- v3.22.9 — rectangle's own floating selection toolbar (colour/settings/delete
             only — no Place trade/lock, per the briefing). Positioned each redraw by
             js/backtest-drawings.js::btRectSelectionToolbar(), just above whichever
             rectangle is currently selected. -->
        <div id="bt-rect-toolbar" class="bt-pos-toolbar" style="display:none"></div>
        <!-- v3.22.3 Part C — one small real "✕" button per pending limit order,
             positioned over its own Limit pill by js/backtest-drawings.js::
             btSyncPendingCancelButtons() every redraw -- a real DOM click target over a
             canvas-drawn pill, same "real DOM over hand-rolled canvas hit-testing"
             convention the selection toolbar (v3.22.1 Part B1) already established. -->
        <div id="bt-pending-cancel-buttons"></div>
        <!-- v3.22.5 Fix A safety net — one real, clickable element per level pinned to
             the top/bottom edge because it's scrolled off-screen (user zoomed/dragged the
             price axis away from auto-scale), positioned over its own canvas-drawn pill
             by js/backtest-drawings.js::btSyncEdgePinnedButtons() every redraw -- same
             "real DOM over hand-rolled canvas hit-testing" convention as the two
             containers just above. Clicking re-enables price-axis auto-scale, which shows
             the level immediately since the stabilizer's own stored range already widens
             to include every level registered here. -->
        <div id="bt-edge-pinned-buttons"></div>
        <!-- v3.22.6 Bug 1 — manual "go back to auto-scale" control, bottom-right corner
             of the chart. Highlighted while auto-scale is actually on
             (js/backtest-drawings.js::btSyncAutoScaleToggleButton(), every render pass);
             clicking it always re-enables auto and clears btUserPriceScaleManual
             (js/backtest.js::btReenableAutoScale()) — the second of the two explicit
             "ways back to auto," alongside double-clicking the axis itself. -->
        <button id="bt-autoscale-toggle" class="bt-autoscale-toggle" onclick="btReenableAutoScale()" title="Re-enable auto price-scale">A</button>
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
          <!-- v3.22.2 Fix 2 — this panel is no longer a second way to fill in an order;
               it never validated anything itself (all real validation lives in the
               ticket's own disabled-button reason, js/backtest.js::btComputeTicket()).
               "New Trade" always opens the ticket -- see js/backtest.js::
               btNewTradeClick() for the three-step prefill priority (selected position
               tool, else the most recent not-yet-linked position drawing, else a bare
               Market ticket from the direction toggle below). -->
          <div class="bt-panel-title">New Trade</div>
          <div id="bt-no-drawing-hint" style="display:none;font-size:11px;color:#9ca3af;margin-bottom:8px">Draw a Long/Short position on the chart, or click New Trade.</div>
          <div style="display:flex;gap:6px;margin-bottom:10px">
            <button class="btn btn-sm bt-dir-btn" id="bt-dir-long" onclick="setBtDirection('Long')">Long</button>
            <button class="btn btn-sm bt-dir-btn" id="bt-dir-short" onclick="setBtDirection('Short')">Short</button>
          </div>
          <button class="btn btn-primary" style="width:100%" id="bt-new-trade-btn" onclick="btNewTradeClick()">New Trade</button>
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
