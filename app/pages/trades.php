
<!-- ── TRADE LOG ── -->
<div class="page" id="page-trades">
  <div class="filter-bar">
    <input type="text" placeholder="🔍 Search..." id="trade-search" oninput="filterTrades(this.value)" style="max-width:180px">
    <select id="filter-pair" onchange="loadTrades()" class="pair-select" style="max-width:140px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:7px 12px;font-size:13px;outline:none">
      <option value="" selected>All Pairs</option>
    </select>
    <select id="filter-result" onchange="loadTrades()" style="max-width:130px"><option value="">All Results</option><option>Win</option><option>Loss</option><option>Break Even</option></select>
    <input type="date" id="filter-from" onchange="loadTrades()" title="From date">
    <input type="date" id="filter-to" onchange="loadTrades()" title="To date">
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('filter-pair').value='';document.getElementById('filter-result').value='';document.getElementById('filter-from').value='';document.getElementById('filter-to').value='';loadTrades()">Clear</button>
    <div style="flex:1"></div>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('import-modal').classList.add('open')">📥 Import</button>
    <button class="btn btn-ghost btn-sm" onclick="openPairsModal()">⚙️ Pairs</button>
    <button class="btn btn-success" id="new-trade-btn" onclick="openChecklist()">+ New Trade</button>
  </div>
  <!-- v3.28.0 — bulk "Set Strategy", scoped to whichever challenge the Trade Log is
       currently showing. Only visible/meaningful once at least one row is checked --
       the button stays disabled with a 0 count until then. -->
  <div class="filter-bar" id="bulk-strategy-bar" style="margin-top:-4px;margin-bottom:10px">
    <select id="bulk-strategy-select" style="max-width:220px"><option value="">— none —</option></select>
    <button class="btn btn-ghost btn-sm" id="bulk-set-strategy-btn" disabled onclick="bulkSetStrategy()">Set Strategy (0)</button>
  </div>
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th><input type="checkbox" id="trade-select-all" onchange="toggleSelectAllTrades(this)"></th>
          <th>Date</th><th>Session</th><th>Pair</th><th>Dir</th>
          <th>Entry</th><th>SL</th><th>Exit</th>
          <th>Gross P&amp;L</th><th>Fees</th><th>Funding</th><th>Net P&amp;L</th><th>R</th>
          <th>Result</th><th>Action</th>
        </tr></thead>
        <tbody id="trades-tbody"></tbody>
      </table>
    </div>
  </div>
</div>
