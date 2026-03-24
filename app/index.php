<?php
require_once 'includes/config.php';
requireLogin();
$u = currentUser();
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<title>FundedControl — Professional Trading Journal</title>
<link rel="icon" type="image/x-icon" href="favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="favicon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
<link rel="stylesheet" href="css/brand.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
</head>
<body>
<div class="app">

<!-- ══ SIDEBAR ══ -->
<aside class="sidebar">
  <div class="sidebar-logo">
    <img src="media/fc-logo.png" alt="FC" style="height:32px;width:auto;border-radius:6px">
    <div>
      <h1>FundedControl</h1>
      <p>Get Funded. Stay Funded.</p>
    </div>
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
    <a href="#" data-page="profile" onclick="showPage('profile');return false;"><span class="icon">👤</span>Profile</a>
    <a href="#" data-page="challenges" onclick="showPage('challenges');return false;"><span class="icon">🏆</span>Challenges</a>
    <a href="logout.php"><span class="icon">🚪</span>Logout</a>
    <a href="updater.php" style="margin-top:auto;border-top:1px solid var(--border);color:var(--text3)" id="update-link"><span class="icon">🔄</span>Check Update <span id="update-dot" style="display:none;width:8px;height:8px;border-radius:50%;background:var(--green);margin-left:auto"></span></a>
  </nav>
  <div class="sidebar-bottom">
    <!-- Challenge Switcher -->
    <div id="challenge-switcher" style="margin-bottom:8px">
      <select id="sidebar-challenge-select" onchange="switchChallenge(this.value)" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:7px 10px;font-size:11px;font-family:var(--font-body);cursor:pointer;outline:none">
        <option>Loading...</option>
      </select>
    </div>
    <div class="balance-card">
      <div class="balance-label">Account Balance</div>
      <div class="balance-val" id="sidebar-balance">$<?= number_format($u['account_balance'] ?? 10000, 2) ?></div>
      <div class="dd-bar"><div class="dd-fill" id="dd-fill" style="width:0%"></div></div>
      <div class="dd-label"><span id="dd-label">DD: 0%</span><span id="dd-max-label"><?= $u['max_drawdown_pct'] ?? 10 ?>% max</span></div>
    </div>
    <div class="sidebar-user">
      <div class="avatar" id="sidebar-avatar" style="background:<?= htmlspecialchars($u['avatar_color'] ?? '#4f7cff') ?>"><?= strtoupper(substr($u['display_name'] ?? $u['username'], 0, 1)) ?></div>
      <div class="user-info">
        <div class="user-name" id="sidebar-username"><?= htmlspecialchars($u['display_name'] ?? $u['username']) ?></div>
        <div class="user-role" id="sidebar-prop"><?= htmlspecialchars($u['prop_firm'] ?? '') ?></div>
      </div>
    </div>
  </div>
</aside>

<!-- ══ MAIN CONTENT ══ -->
<main class="main">
  <div class="topbar">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="hamburger" id="hamburger-btn">☰</button>
      <h2>Dashboard</h2>
    </div>
    <div class="topbar-right">
      <span style="font-size:11px;color:var(--text3);display:none" id="today-info">Today: <span id="today-pnl" style="color:var(--green)">$0</span></span>
      <button class="btn btn-primary btn-sm" onclick="openTradeModal()">+ Trade</button>
      <button class="btn btn-ghost btn-sm" onclick="exportPDF()">🖨 PDF</button>
    </div>
  </div>

  <?php
  // ── Load each page from its own file ──
  $pages = ['dashboard','trades','stats','calculator','strategy','review','profile','challenges'];
  foreach ($pages as $p) {
      include "pages/{$p}.php";
  }
  ?>
</main>
</div>

<?php
// ── Load each modal from its own file ──
$modals = ['checklist-modal','trade-modal','trade-view-modal','review-modal','strategy-modal','pairs-modal','import-modal','challenge-modal'];
foreach ($modals as $m) {
    include "modals/{$m}.php";
}
?>

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
document.querySelectorAll('.modal-overlay').forEach(el=>{
    el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});
});
</script>

<!-- ══ JS MODULES ══ -->
<script src="js/app.js"></script>
<script src="js/dashboard.js"></script>
<script src="js/trades.js"></script>
<script src="js/stats.js"></script>
<script src="js/calculator.js"></script>
<script src="js/strategy.js"></script>
<script src="js/review.js"></script>
<script src="js/profile.js"></script>
<script src="js/challenges.js"></script>
<script src="js/import.js"></script>
</body>
</html>
