<?php
session_start();
require_once 'includes/config.php';
requireLogin();
$u = currentUser();
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<title>FSA Trading Journal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
</head>
<body>
<div class="app">

<!-- ══════════════════════════════════════════════════════
     SIDEBAR
══════════════════════════════════════════════════════ -->
<aside class="sidebar">
  <div class="sidebar-logo">
    <h1>FSA JOURNAL</h1>
    <p>Professional Trading Journal</p>
  </div>
  <nav class="nav">
    <div class="nav-section">Main</div>
    <a href="#" data-page="dashboard" onclick="showPage('dashboard');return false;"><span class="icon">📊</span>Dashboard</a>
    <a href="#" data-page="trades" onclick="showPage('trades');return false;"><span class="icon">📋</span>Trade Log</a>
    <a href="#" data-page="stats" onclick="showPage('stats');return false;"><span class="icon">📈</span>Statistics</a>
    <div class="nav-section">Tools</div>
    <a href="#" data-page="calculator" onclick="showPage('calculator');return false;"><span class="icon">🧮</span>Risk Calculator</a>
    <a href="#" data-page="strategy" onclick="showPage('strategy');return false;"><span class="icon">🧪</span>Strategy Tester</a>
    <a href="#" data-page="review" onclick="showPage('review');return false;"><span class="icon">📝</span>Weekly Review</a>
    <div class="nav-section">Account</div>
    <a href="#" data-page="settings" onclick="showPage('settings');return false;"><span class="icon">⚙️</span>Settings</a>
    <a href="logout.php"><span class="icon">🚪</span>Logout</a>
    <a href="updater.php" style="margin-top:auto;border-top:1px solid var(--border);color:var(--text3)" id="update-link"><span class="icon">🔄</span>Check Update <span id="update-dot" style="display:none;width:8px;height:8px;border-radius:50%;background:var(--green);margin-left:auto"></span></a>
  </nav>
  <div class="sidebar-bottom">
    <div class="balance-card">
      <div class="balance-label">Account Balance</div>
      <div class="balance-val" id="sidebar-balance">$<?= number_format($u['account_balance'],2) ?></div>
      <div class="dd-bar"><div class="dd-fill" id="dd-fill" style="width:0%"></div></div>
      <div class="dd-label"><span id="dd-label">DD: 0%</span><span><?= $u['max_drawdown_pct'] ?>% max</span></div>
    </div>
    <div class="sidebar-user">
      <div class="avatar" id="sidebar-avatar" style="background:<?= htmlspecialchars($u['avatar_color']??'#4f7cff') ?>"><?= strtoupper(substr($u['display_name']??$u['username'],0,1)) ?></div>
      <div class="user-info">
        <div class="user-name" id="sidebar-username"><?= htmlspecialchars($u['display_name']??$u['username']) ?></div>
        <div class="user-role" id="sidebar-prop"><?= htmlspecialchars($u['prop_firm']??'BitFunded') ?></div>
      </div>
    </div>
  </div>
</aside>

<!-- ══════════════════════════════════════════════════════
     MAIN
══════════════════════════════════════════════════════ -->
<main class="main">
  <div class="topbar">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="hamburger" id="hamburger-btn">☰</button>
      <h2>Dashboard</h2>
    </div>
    <div class="topbar-right">
      <span style="font-size:11px;color:var(--text3);display:none" id="today-info">Today: <span id="today-pnl" style="color:var(--green)">$0</span></span>
      <button class="btn btn-success btn-sm" onclick="openChecklist()">✅ Pre-Trade Check</button>
      <button class="btn btn-primary btn-sm" onclick="openTradeModal()">+ Trade</button>
      <button class="btn btn-ghost btn-sm" onclick="exportPDF()">🖨 PDF</button>
    </div>
  </div>

  <!-- ── DASHBOARD ── -->
  <div class="page active" id="page-dashboard">
    <div class="alert-bar" id="alert-bar"></div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Total Trades</div><div class="kpi-val blue" id="kpi-trades">—</div></div>
      <div class="kpi"><div class="kpi-label">Win Rate</div><div class="kpi-val" id="kpi-winrate">—</div></div>
      <div class="kpi"><div class="kpi-label">Net P&amp;L</div><div class="kpi-val" id="kpi-pnl">—</div></div>
      <div class="kpi"><div class="kpi-label">Total Fees</div><div class="kpi-val red" id="kpi-fees">—</div></div>
      <div class="kpi"><div class="kpi-label">Avg R</div><div class="kpi-val" id="kpi-r">—</div></div>
      <div class="kpi"><div class="kpi-label">Profit Factor</div><div class="kpi-val orange" id="kpi-pf">—</div></div>
    </div>
    <!-- Streak mini-card -->
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <div class="card" style="flex:1;padding:12px 16px">
        <div class="card-title" style="margin-bottom:6px">Current Streak</div>
        <div style="font-family:var(--font-head);font-size:20px" id="kpi-streak">—</div>
      </div>
      <div class="card" style="flex:3;padding:12px 16px">
        <div class="card-title" style="margin-bottom:6px">Performance Calendar</div>
        <div id="calendar-wrap" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>
    </div>
    <div class="charts-grid">
      <div class="card"><div class="card-title">Win / Loss Split</div><div class="chart-wrap"><canvas id="chart-donut"></canvas></div></div>
      <div class="card"><div class="card-title">Cumulative P&amp;L</div><div class="chart-wrap"><canvas id="chart-cumulative"></canvas></div></div>
    </div>
    <div class="charts-grid">
      <div class="card"><div class="card-title">Drawdown Curve</div><div class="chart-wrap"><canvas id="chart-drawdown"></canvas></div></div>
      <div class="card"><div class="card-title">P&amp;L Per Trade</div><div class="chart-wrap"><canvas id="chart-pnl"></canvas></div></div>
    </div>
    <div class="charts-grid">
      <div class="card"><div class="card-title">Win Rate by Fib Level</div><div class="chart-wrap"><canvas id="chart-fib"></canvas></div></div>
      <div class="card"><div class="card-title">P&amp;L by Session</div><div class="chart-wrap"><canvas id="chart-session"></canvas></div></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">Best Trading Hours (GMT+2)</div>
      <div id="hours-heatmap" style="display:flex;flex-wrap:wrap;gap:4px;align-items:flex-end;padding:8px 0"></div>
    </div>
  </div>

  <!-- ── TRADE LOG ── -->
  <div class="page" id="page-trades">
    <div class="filter-bar">
      <input type="text" placeholder="🔍 Search..." id="trade-search" oninput="filterTrades(this.value)" style="max-width:180px">
      <select id="filter-pair" class="pair-select" onchange="loadTrades()" style="max-width:140px"><option value="">All Pairs</option></select>
      <select id="filter-result" onchange="loadTrades()" style="max-width:130px"><option value="">All Results</option><option>Win</option><option>Loss</option><option>Break Even</option></select>
      <input type="date" id="filter-from" onchange="loadTrades()" title="From date">
      <input type="date" id="filter-to" onchange="loadTrades()" title="To date">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('filter-pair').value='';document.getElementById('filter-result').value='';document.getElementById('filter-from').value='';document.getElementById('filter-to').value='';loadTrades()">Clear</button>
      <div style="flex:1"></div>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('import-modal').classList.add('open')">📥 Import</button>
      <button class="btn btn-ghost btn-sm" onclick="openPairsModal()">⚙️ Pairs</button>
      <button class="btn btn-success" onclick="openChecklist()">+ New Trade</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>#</th><th>Date</th><th>Session</th><th>Pair</th><th>Dir</th>
            <th>Entry</th><th>SL</th><th>Exit</th>
            <th>Gross P&amp;L</th><th>Fees</th><th>Net P&amp;L</th><th>R</th>
            <th>Result</th><th>Fib</th><th>Conf</th><th>Chart</th><th>Action</th>
          </tr></thead>
          <tbody id="trades-tbody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ── STATISTICS ── -->
  <div class="page" id="page-stats">
    <div class="filter-bar" style="margin-bottom:14px">
      <select id="stat-month" style="max-width:130px">
        <option value="">All Months</option>
        <?php for($m=1;$m<=12;$m++) echo "<option value='$m'>".date('F',mktime(0,0,0,$m,1))."</option>"; ?>
      </select>
      <select id="stat-year" style="max-width:100px">
        <?php for($y=date('Y');$y>=2024;$y--) echo "<option value='$y'>$y</option>"; ?>
      </select>
      <button class="btn btn-primary btn-sm" onclick="loadStats()">Apply</button>
    </div>
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="card">
        <div class="card-title">Overall Performance</div>
        <div class="stat-row"><span class="stat-label">Total Trades</span><span class="stat-val blue" id="s-total">—</span></div>
        <div class="stat-row"><span class="stat-label">Wins</span><span class="stat-val green" id="s-wins">—</span></div>
        <div class="stat-row"><span class="stat-label">Losses</span><span class="stat-val red" id="s-losses">—</span></div>
        <div class="stat-row"><span class="stat-label">Break Evens</span><span class="stat-val orange" id="s-be">—</span></div>
        <div class="stat-row"><span class="stat-label">Win Rate</span><span class="stat-val" id="s-wr">—</span></div>
        <div class="stat-row"><span class="stat-label">Profit Factor</span><span class="stat-val" id="s-pf">—</span></div>
        <div class="stat-row"><span class="stat-label">Avg R Multiple</span><span class="stat-val" id="s-avgr">—</span></div>
      </div>
      <div class="card">
        <div class="card-title">P&amp;L &amp; Fees</div>
        <div class="stat-row"><span class="stat-label">Gross P&amp;L</span><span class="stat-val" id="s-gross">—</span></div>
        <div class="stat-row"><span class="stat-label">Total Fees Paid</span><span class="stat-val red" id="s-fees">—</span></div>
        <div class="stat-row"><span class="stat-label">Net P&amp;L</span><span class="stat-val" id="s-netpnl">—</span></div>
        <div class="stat-row"><span class="stat-label">Avg Win</span><span class="stat-val green" id="s-avgwin">—</span></div>
        <div class="stat-row"><span class="stat-label">Avg Loss</span><span class="stat-val red" id="s-avgloss">—</span></div>
        <div class="stat-row"><span class="stat-label">Fees % of Gross</span><span class="stat-val" id="s-fee-pct">—</span></div>
        <div class="stat-row"><span id="s-fee-warning" style="font-size:12px">—</span></div>
      </div>
    </div>
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="card">
        <div class="card-title">Drawdown &amp; Streak</div>
        <div class="stat-row"><span class="stat-label">Max Drawdown</span><span class="stat-val red" id="s-maxdd">—</span></div>
        <div class="stat-row"><span class="stat-label">Current Drawdown</span><span class="stat-val" id="s-curdd">—</span></div>
        <div class="stat-row"><span class="stat-label">Current Streak</span><span class="stat-val" id="s-streak-cur">—</span></div>
        <div class="stat-row"><span class="stat-label">Longest Win Streak</span><span class="stat-val green" id="s-streak-maxwin">—</span></div>
        <div class="stat-row"><span class="stat-label">Longest Loss Streak</span><span class="stat-val red" id="s-streak-maxloss">—</span></div>
      </div>
      <div class="card">
        <div class="card-title">By Session</div>
        <table><thead><tr><th>Session</th><th>Trades</th><th>Win%</th><th>Net P&amp;L</th></tr></thead>
        <tbody id="s-session-tbody"></tbody></table>
      </div>
    </div>
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="card">
        <div class="card-title">By Fib Level</div>
        <table><thead><tr><th>Level</th><th>Trades</th><th>Win%</th><th>Net P&amp;L</th></tr></thead>
        <tbody id="s-fib-tbody"></tbody></table>
      </div>
      <div class="card">
        <div class="card-title">By Pair</div>
        <table><thead><tr><th>Pair</th><th>Trades</th><th>Win%</th><th>Net P&amp;L</th></tr></thead>
        <tbody id="s-pair-tbody"></tbody></table>
      </div>
    </div>
    <div class="card">
      <div class="card-title">By Direction</div>
      <table><thead><tr><th>Direction</th><th>Trades</th><th>Win%</th><th>Net P&amp;L</th></tr></thead>
      <tbody id="s-dir-tbody"></tbody></table>
    </div>
  </div>

  <!-- ── RISK CALCULATOR ── -->
  <div class="page" id="page-calculator">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:900px">
      <div class="card">
        <div class="card-title">Position Size Calculator</div>
        <div class="form-group" style="margin-bottom:10px"><label>Account Balance ($)</label><input type="number" id="calc-balance" step="0.01" oninput="clearCalcResult()"></div>
        <div class="form-group" style="margin-bottom:10px"><label>Risk Per Trade (%)</label><input type="number" id="calc-risk-pct" step="0.01" oninput="clearCalcResult()"></div>
        <div class="form-group" style="margin-bottom:10px"><label>Entry Price</label><input type="number" id="calc-entry" step="0.01" placeholder="e.g. 73500" oninput="clearCalcResult()"></div>
        <div class="form-group" style="margin-bottom:10px"><label>Stop Loss Price</label><input type="number" id="calc-sl" step="0.01" placeholder="e.g. 72000" oninput="clearCalcResult()"></div>
        <div class="form-group" style="margin-bottom:16px"><label>Take Profit Price (optional)</label><input type="number" id="calc-tp" step="0.01" placeholder="e.g. 76500" oninput="clearCalcResult()"></div>
        <button class="btn btn-primary" style="width:100%" onclick="calcRisk()">Calculate Position Size</button>
        <button class="btn btn-success" style="width:100%;margin-top:8px" onclick="fillTradeFromCalc()">Use These Values in Trade Form</button>
      </div>
      <div>
        <div class="calc-result card" id="calc-results" style="display:none">
          <div class="card-title">📊 Calculation Results</div>
          <div class="calc-row"><span class="calc-label">Risk Amount ($)</span><span class="calc-val red" id="res-risk">—</span></div>
          <div class="calc-row"><span class="calc-label">Lot Size</span><span class="calc-val green" id="res-lot" style="font-size:22px">—</span></div>
          <div class="calc-row"><span class="calc-label">SL Distance (pts)</span><span class="calc-val" id="res-sl-dist">—</span></div>
          <div class="calc-row"><span class="calc-label">Risk / Reward</span><span class="calc-val" id="res-rr">—</span></div>
          <div class="calc-row"><span class="calc-label">Potential Profit</span><span class="calc-val green" id="res-profit">—</span></div>
        </div>
        <div class="card" style="margin-top:14px">
          <div class="card-title">FSA Risk Rules</div>
          <?php
          $u2 = currentUser();
          $balance = $u2['account_balance'];
          $rules = [
            ['Recovery Mode (<$10k)', '$'.number_format($balance*0.0025,2), '0.25%'],
            ['Normal ($10k)', '$'.number_format($balance*0.005,2), '0.5%'],
            ['Passing (>$10,200)', '$'.number_format($balance*0.01,2), '1.0%'],
          ];
          foreach($rules as $r): ?>
          <div class="stat-row">
            <span class="stat-label"><?= $r[0] ?></span>
            <span style="font-family:var(--font-head);font-size:13px;color:var(--green)"><?= $r[1] ?></span>
          </div>
          <?php endforeach; ?>
          <div style="margin-top:10px;padding:10px;background:var(--bg3);border-radius:6px;font-size:12px;color:var(--text2)">
            ⚠️ Max 2 trades/day &nbsp;|&nbsp; Stop if -$200/day &nbsp;|&nbsp; Stop after 3 consecutive losses
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── STRATEGY TESTER ── -->
  <div class="page" id="page-strategy">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div class="card" style="padding:12px 18px;display:inline-flex;gap:20px;align-items:center">
        <div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Tests</div><div style="font-family:var(--font-head);font-size:20px;color:var(--blue2)" id="st-total">0</div></div>
        <div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Win Rate</div><div style="font-family:var(--font-head);font-size:20px;color:var(--green)" id="st-wr">0%</div></div>
        <div><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Net P&amp;L</div><div style="font-family:var(--font-head);font-size:20px" id="st-pnl">$0</div></div>
      </div>
      <button class="btn btn-success" onclick="document.getElementById('strategy-modal').classList.add('open')">+ Log Test Trade</button>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Strategy</th><th>Pair</th><th>Dir</th><th>Rules</th><th>Score</th><th>Result</th><th>Fib</th><th>R</th><th>P&amp;L</th><th>Session</th><th>Notes</th><th></th></tr></thead>
      <tbody id="strategy-tbody"></tbody>
    </table></div></div>
  </div>

  <!-- ── WEEKLY REVIEW ── -->
  <div class="page" id="page-review">
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button class="btn btn-primary" onclick="openReviewModal()">+ New Review</button>
    </div>
    <div id="reviews-list"></div>
  </div>

  <!-- ── SETTINGS ── -->
  <div class="page" id="page-settings">
    <div style="max-width:700px">
      <div class="card" style="margin-bottom:14px">
        <div class="card-title">Account Settings</div>
        <div class="form-grid-2" style="gap:12px">
          <div class="form-group"><label>Display Name</label><input type="text" id="set-display_name"></div>
          <div class="form-group"><label>Prop Firm</label><input type="text" id="set-prop_firm"></div>
          <div class="form-group"><label>Challenge Phase</label><input type="text" id="set-challenge_phase"></div>
          <div class="form-group"><label>Avatar Color</label><input type="color" id="set-avatar_color" style="height:40px;cursor:pointer"></div>
          <div class="form-group"><label>Starting Balance ($)</label><input type="number" step="0.01" id="set-starting_balance"></div>
          <div class="form-group"><label>Current Balance ($)</label><input type="number" step="0.01" id="set-account_balance"></div>
          <div class="form-group"><label>Max Drawdown (%)</label><input type="number" step="0.1" id="set-max_drawdown_pct"></div>
          <div class="form-group"><label>Daily Loss Limit ($)</label><input type="number" step="0.01" id="set-daily_loss_limit"></div>
          <div class="form-group"><label>Default Risk Per Trade (%)</label><input type="number" step="0.01" id="set-risk_per_trade_pct"></div>
          <div class="form-group"><label>New Password (leave blank = no change)</label><input type="password" id="set-new-password" placeholder="••••••••"></div>
        </div>
        <div style="margin-top:16px"><button class="btn btn-primary" onclick="saveSettings()">Save Settings</button></div>
      </div>
    </div>
  </div>

</main>
</div>

<!-- ══════════════════════════════════════════════════════
     FSA PRE-TRADE CHECKLIST POPUP
══════════════════════════════════════════════════════ -->
<div class="checklist-popup" id="checklist-popup">
  <h3>✅ FSA PRE-TRADE CHECKLIST</h3>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R1 — 4H context clear (bullish or bearish)</span></div>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R2 — Price at 0.618 or 0.705 Fib level on 1H</span></div>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R3 — S/R level confluences with Fib on 1H</span></div>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R4 — Price below AVWAP (short) / above AVWAP (long)</span></div>
  <div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">R5 — Rejection candle CLOSED on 15M (pin bar / engulfing)</span></div>
  <div class="check-score" id="check-score" style="font-family:var(--font-head);font-size:24px;text-align:center;margin:12px 0">0/5</div>
  <div style="display:flex;gap:8px">
    <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('checklist-popup').classList.remove('open')">Cancel</button>
    <button class="btn btn-success" style="flex:1" onclick="proceedTrade()">Proceed to Trade →</button>
  </div>
</div>
<div id="checklist-overlay" onclick="document.getElementById('checklist-popup').classList.remove('open')" style="display:none;position:fixed;inset:0;z-index:290" class="checklist-popup open" id="checklist-popup"></div>

<!-- ══════════════════════════════════════════════════════
     TRADE MODAL
══════════════════════════════════════════════════════ -->
<div class="modal-overlay" id="trade-modal">
  <div class="modal">
    <h3>📋 LOG TRADE</h3>
    <input type="hidden" id="trade-id">
    <form id="trade-form" enctype="multipart/form-data">
      <div class="form-grid">
        <div class="form-group"><label>Trade Date</label><input type="date" id="f-trade_date" name="trade_date" required></div>
        <div class="form-group"><label>Session</label><select id="f-session" name="session"><option>London</option><option>New York</option><option>Asia</option><option>Other</option></select></div>
        <div class="form-group"><label>Pair</label><select id="f-pair" name="pair" class="pair-select"></select></div>

        <div class="section-divider"></div>
        <div class="section-label">Time In</div>
        <div class="form-group"><label>Date In</label><input type="date" id="f-time_in_date" name="time_in_date"></div>
        <div class="form-group"><label>Time In</label><input type="time" id="f-time_in_time" name="time_in_time"></div>
        <div class="form-group"><label>Date Out</label><input type="date" id="f-time_out_date" name="time_out_date"></div>
        <div class="form-group"><label>Time Out</label><input type="time" id="f-time_out_time" name="time_out_time"></div>
        <div class="form-group"><label>Direction</label><select id="f-direction" name="direction"><option>Long</option><option>Short</option></select></div>

        <div class="section-divider"></div>
        <div class="section-label">Prices</div>
        <div class="form-group"><label>Entry Price</label><input type="number" step="0.0001" id="f-entry_price" name="entry_price"></div>
        <div class="form-group"><label>Stop Loss</label><input type="number" step="0.0001" id="f-stop_loss" name="stop_loss"></div>
        <div class="form-group"><label>Take Profit</label><input type="number" step="0.0001" id="f-take_profit" name="take_profit"></div>
        <div class="form-group"><label>Exit Price</label><input type="number" step="0.0001" id="f-exit_price" name="exit_price"></div>
        <div class="form-group"><label>Lot Size</label><input type="number" step="0.0001" id="f-lot_size" name="lot_size"></div>
        <div class="form-group"><label>Fees ($)</label><input type="number" step="0.01" id="f-fees" name="fees" value="0"></div>

        <div class="section-divider"></div>
        <div class="section-label">Outcome</div>
        <div class="form-group"><label>Result</label><select id="f-result" name="result"><option value="">—</option><option>Win</option><option>Loss</option><option>Break Even</option><option>Open</option></select></div>
        <div class="form-group"><label>Fib Level</label><select id="f-fib_level" name="fib_level"><option value="">—</option><option>0.236</option><option>0.382</option><option>0.5</option><option>0.618</option><option>0.705</option><option>0.786</option><option>Other</option></select></div>
        <div class="form-group"><label>FSA Rules</label><select id="f-fsa_rules" name="fsa_rules"><option value="">—</option><option>All 5</option><option>4 of 5</option><option>3 of 5</option><option>2 of 5</option></select></div>
        <div class="form-group"><label>Confidence</label><select id="f-confidence" name="confidence"><option value="">—</option><option>High</option><option>Medium</option><option>Low</option></select></div>
        <div class="form-group"><label>Exec Score (1-10)</label><input type="number" min="1" max="10" id="f-exec_score" name="exec_score"></div>

        <div class="section-divider"></div>
        <div class="section-label">Chart Screenshot</div>
        <div class="form-group full">
          <label>Upload Chart Screenshot</label>
          <input type="file" id="f-screenshot" name="screenshot" accept="image/*" style="padding:6px">
          <div id="screenshot-current"></div>
        </div>
        <div class="form-group full"><label>Notes</label><textarea id="f-notes" name="notes" rows="2"></textarea></div>
      </div>
    </form>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('trade-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="saveTrade()">Save Trade</button>
    </div>
  </div>
</div>

<!-- Screenshot viewer -->
<div class="modal-overlay" id="screenshot-modal" onclick="this.classList.remove('open')">
  <img id="screenshot-img" src="" class="screenshot-full">
</div>

<!-- ══════════════════════════════════════════════════════
     REVIEW MODAL
══════════════════════════════════════════════════════ -->
<div class="modal-overlay" id="review-modal">
  <div class="modal">
    <h3>📝 WEEKLY REVIEW</h3>
    <input type="hidden" id="review-id">
    <div class="form-grid">
      <div class="form-group"><label>Week Start</label><input type="date" id="r-week_start"></div>
      <div class="form-group"><label>Week End</label><input type="date" id="r-week_end"></div>
      <div class="form-group"><label>Process Score (1-10)</label><input type="number" min="1" max="10" id="r-process_score"></div>
      <div class="form-group"><label>Mindset Score (1-10)</label><input type="number" min="1" max="10" id="r-mindset_score"></div>
      <div class="form-group full"><label>Key Lesson This Week</label><textarea id="r-key_lesson" rows="2"></textarea></div>
      <div class="form-group full"><label>What Went Well</label><textarea id="r-what_went_well" rows="2"></textarea></div>
      <div class="form-group full"><label>What To Improve</label><textarea id="r-what_to_improve" rows="2"></textarea></div>
      <div class="form-group full"><label>Rules Followed</label><textarea id="r-rules_followed" rows="2"></textarea></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('review-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="saveReview()">Save Review</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════
     STRATEGY MODAL
══════════════════════════════════════════════════════ -->
<div class="modal-overlay" id="strategy-modal">
  <div class="modal">
    <h3>🧪 LOG STRATEGY TEST TRADE</h3>
    <div class="form-grid">
      <div class="form-group"><label>Strategy Name</label><input type="text" id="st-strategy_name" value="Fib + FVG + S/R"></div>
      <div class="form-group"><label>Timeframe</label><input type="text" id="st-timeframe" value="1H/15M"></div>
      <div class="form-group"><label>Market</label><input type="text" id="st-market" value="BTCUSD"></div>
      <div class="form-group full" style="background:var(--bg3);padding:12px;border-radius:8px">
        <label style="color:var(--purple);margin-bottom:8px;display:block">Rules</label>
        <div class="form-grid">
          <div class="form-group"><label>R1</label><input type="text" id="st-rule1" value="Clear Trend"></div>
          <div class="form-group"><label>R2</label><input type="text" id="st-rule2" value="Fib Level"></div>
          <div class="form-group"><label>R3</label><input type="text" id="st-rule3" value="FVG Present"></div>
          <div class="form-group"><label>R4</label><input type="text" id="st-rule4" value="Candle Confirmation"></div>
          <div class="form-group"><label>R5</label><input type="text" id="st-rule5" value="At S/R Level"></div>
        </div>
      </div>
      <div class="form-group"><label>Pair</label><select id="st-pair" class="pair-select"></select></div>
      <div class="form-group"><label>Direction</label><select id="st-direction"><option>Long</option><option>Short</option></select></div>
      <div class="form-group"><label>Session</label><select id="st-session"><option>London</option><option>New York</option><option>Asia</option></select></div>
      <div class="form-group full" style="background:var(--bg3);padding:12px;border-radius:8px">
        <label style="color:var(--text3);margin-bottom:8px;display:block">Rules Met (Y/N)</label>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
          <?php foreach([1,2,3,4,5] as $r): ?>
          <div><div style="font-size:10px;color:var(--text3);margin-bottom:3px;text-align:center">R<?= $r ?></div>
          <select id="st-r<?= $r ?>" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:7px;font-size:13px">
            <option value="N">N</option><option value="Y">Y</option>
          </select></div>
          <?php endforeach; ?>
        </div>
      </div>
      <div class="form-group"><label>Result</label><select id="st-result"><option value="">—</option><option>Win</option><option>Loss</option><option>Break Even</option></select></div>
      <div class="form-group"><label>Fib Level</label><select id="st-fib_level"><option value="">—</option><option>0.382</option><option>0.5</option><option>0.618</option><option>0.705</option><option>0.786</option></select></div>
      <div class="form-group"><label>R Multiple</label><input type="number" step="0.01" id="st-r_multiple"></div>
      <div class="form-group"><label>Net P&amp;L ($)</label><input type="number" step="0.01" id="st-net_pnl"></div>
      <div class="form-group full"><label>Notes</label><textarea id="st-notes" rows="2"></textarea></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('strategy-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="saveStratTrade()">Save Test</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════
     PAIRS MODAL
══════════════════════════════════════════════════════ -->
<div class="modal-overlay" id="pairs-modal">
  <div class="modal" style="max-width:400px">
    <h3>⚙️ MANAGE PAIRS</h3>
    <div id="pairs-list" style="margin-bottom:14px"></div>
    <div style="display:flex;gap:8px">
      <input type="text" id="new-pair-input" placeholder="e.g. SOLUSDT" style="flex:1" onkeydown="if(event.key==='Enter')addPair()">
      <button class="btn btn-success" onclick="addPair()">Add</button>
    </div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="document.getElementById('pairs-modal').classList.remove('open')">Close</button></div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════
     IMPORT MODAL
══════════════════════════════════════════════════════ -->
<div class="modal-overlay" id="import-modal">
  <div class="modal" style="max-width:460px">
    <h3>📥 IMPORT FROM EXCEL</h3>
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">Upload your FSA Trading Journal Excel file. The app will read the Trade Log sheet and import all trades.</p>
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:var(--text3)">
      <strong style="color:var(--text2)">Expected columns:</strong> Date, Session, Pair, Direction, Entry, Stop Loss, Take Profit, Exit Price, Lot Size, P&L $, Fees $, R Multiple, Result, Confidence, Fib Level, Notes
    </div>
    <div class="form-group"><label>Select Excel File (.xlsx)</label><input type="file" id="import-file" accept=".xlsx,.xls,.csv" style="padding:8px"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('import-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="importExcel()">Import Trades</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
function filterTrades(q) {
    const f=allTrades.filter(t=>Object.values(t).some(v=>v&&String(v).toLowerCase().includes(q.toLowerCase())));
    renderTradesTable(f);
}
function clearCalcResult(){document.getElementById('calc-results').style.display='none';}
function fillTradeFromCalc(){
    const lot=document.getElementById('res-lot').textContent;
    const entry=document.getElementById('calc-entry').value;
    const sl=document.getElementById('calc-sl').value;
    const tp=document.getElementById('calc-tp').value;
    document.getElementById('f-entry_price').value=entry;
    document.getElementById('f-stop_loss').value=sl;
    document.getElementById('f-take_profit').value=tp;
    document.getElementById('f-lot_size').value=lot;
    showPage('trades');
    setTimeout(()=>openTradeModal(),100);
}
// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(el=>{
    el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});
});
</script>
<script src="js/app.js"></script>
</body>
</html>
