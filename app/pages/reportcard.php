
<!-- ══ DAILY REPORT CARD (v3.18.0) ══
     One sidebar page, three internal views (Card / History / Templates) switched by JS —
     this app has no client-side URL router (index.php's showPage() only ever swaps page
     visibility by id, no pushState anywhere), so the build briefing's /report-card/{date}
     style routes are implemented as view state within this one page instead. See
     ReportCardController.php's class docblock for this and the other judgment calls made
     building this module. -->
<div class="page" id="page-reportcard">
  <div style="max-width:1000px;margin:0 auto">

    <div class="rc-tabs">
      <button class="btn btn-sm" id="rc-tab-card" onclick="showRcView('card')">📝 Card</button>
      <button class="btn btn-ghost btn-sm" id="rc-tab-history" onclick="showRcView('history')">📜 History</button>
      <button class="btn btn-ghost btn-sm" id="rc-tab-templates" onclick="showRcView('templates')">🗂 Templates</button>
    </div>

    <!-- ══════════════ CARD VIEW ══════════════ -->
    <div class="rc-view active" id="rc-view-card">

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">
          <span id="rc-date-label">Report Card</span>
          <span style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-ghost btn-sm" onclick="rcShiftDay(-1)">‹</button>
            <input type="date" id="rc-date-input" onchange="loadReportCard(this.value)" style="width:auto">
            <button class="btn btn-ghost btn-sm" onclick="rcShiftDay(1)">›</button>
            <button class="btn btn-ghost btn-sm" onclick="loadReportCard(rcToday())">Today</button>
          </span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <span class="badge" id="rc-status-badge">draft</span>
          <span class="badge badge-long" id="rc-streak-badge" style="display:none"></span>
          <span class="badge badge-medium" id="rc-guard-badge" style="display:none"></span>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>Overall Grade <span style="font-weight:400;text-transform:none;letter-spacing:0">— process, not P&amp;L</span></label>
            <select id="rc-overall-grade" onchange="saveReportCardHeader()">
              <option value="">—</option>
              <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option><option value="F">F</option>
            </select>
          </div>
          <div class="form-group">
            <label>P&amp;L (manual)</label>
            <input type="number" step="0.01" id="rc-pnl" onchange="saveReportCardHeader()">
          </div>
          <div class="form-group">
            <label>P&amp;L (auto, from journal)</label>
            <input type="text" id="rc-pnl-auto" disabled>
          </div>
          <div class="form-group">
            <label>Morning Temperature</label>
            <select id="rc-morning-temp" onchange="saveReportCardHeader()">
              <option value="">—</option>
              <option value="great">Great</option><option value="good">Good</option><option value="neutral">Neutral</option><option value="off">Off</option><option value="bad">Bad</option>
            </select>
          </div>
          <div class="form-group">
            <label>Sleep Quality (1–10)</label>
            <input type="number" min="1" max="10" id="rc-sleep-quality" onchange="saveReportCardHeader()">
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Primary Goal <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">one process goal only</span></div>
        <textarea id="rc-primary-goal" rows="2" placeholder="e.g. Only take A+ setups on the 15m trigger" oninput="rcWarnGoal()" onchange="saveReportCardHeader()"></textarea>
        <div class="rc-warn" id="rc-goal-warning" style="display:none">This reads like an outcome goal (a $ amount or "profit"/"win"), not a process goal. Grade reflects process, not P&amp;L.</div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Reminders &amp; Mantras</div>
        <div id="rc-mantras-list"></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input type="text" id="rc-new-mantra" placeholder="Add a standing reminder…" onkeydown="if(event.key==='Enter')addRcMantra()">
          <button class="btn btn-ghost btn-sm" onclick="addRcMantra()">Add</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">
          Session Breakdown
          <span style="display:flex;gap:6px">
            <select id="rc-apply-template-select" style="width:auto" onchange="rcApplySelectedTemplate()">
              <option value="">Load template…</option>
            </select>
            <button class="btn btn-ghost btn-sm" onclick="rcSaveBlocksAsTemplate()">Save as Template</button>
            <button class="btn btn-primary btn-sm" onclick="openRcBlockModal()">+ Add Block</button>
          </span>
        </div>
        <div id="rc-blocks-list"></div>
        <div id="rc-blocks-empty" class="empty" style="display:none;padding:20px">
          <div class="empty-icon">🗓</div>
          <div>No session blocks today — a blank day is a valid, savable card.</div>
        </div>
        <div id="rc-unassigned-wrap" style="display:none;margin-top:12px;padding:10px 12px;background:rgba(255,179,71,0.08);border:1px solid var(--orange);border-radius:var(--radius-sm)">
          <div style="font-size:11px;color:var(--orange);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">⚠ Unassigned Trades — outside every planned block</div>
          <div id="rc-unassigned-list" style="font-size:12px"></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">What I Learned</div>
        <textarea id="rc-learned" rows="3" onchange="saveReportCardHeader()"></textarea>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Changes I Need To Make <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">a forward action, not just a problem</span></div>
        <textarea id="rc-changes-needed" rows="3" placeholder="e.g. Wait for the 15m close before entering, instead of..." onchange="saveReportCardHeader()"></textarea>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Easiest Money Trade</div>
        <textarea id="rc-easiest-money" rows="2" onchange="saveReportCardHeader()"></textarea>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Overview</div>
        <textarea id="rc-overview" rows="3" onchange="saveReportCardHeader()"></textarea>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Wins</div>
        <textarea id="rc-wins" rows="2" onchange="saveReportCardHeader()"></textarea>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Ticker Analysis <button class="btn btn-primary btn-sm" onclick="addRcTicker()">+ Add Ticker</button></div>
        <div id="rc-tickers-list"></div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-title">
          AI Review
          <span style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="loadRcReviews()">↻ Refresh</button>
            <button class="btn btn-primary btn-sm" id="rc-run-review-btn" onclick="runRcAiReview()">Run AI Review</button>
          </span>
        </div>
        <div id="rc-review-panel">
          <div style="color:var(--text3);font-size:12px">No review yet. Complete the card (overall grade, primary goal, every block graded), then run one.</div>
        </div>
      </div>

    </div>

    <!-- ══════════════ HISTORY VIEW ══════════════ -->
    <div class="rc-view" id="rc-view-history">
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Streak <span id="rc-history-streak" style="color:var(--green)">0 days</span></div>
        <div class="chart-wrap"><canvas id="rc-alignment-chart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Report Card History</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Grade</th><th>P&amp;L</th><th>P&amp;L (auto)</th><th>Blocks</th><th>Status</th><th>Alignment</th></tr></thead>
            <tbody id="rc-history-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ══════════════ TEMPLATES VIEW ══════════════ -->
    <div class="rc-view" id="rc-view-templates">
      <div class="card">
        <div class="card-title">Session Templates <button class="btn btn-primary btn-sm" onclick="openRcTemplateModal()">+ New Template</button></div>
        <div id="rc-templates-list"></div>
      </div>
    </div>

  </div>
</div>
