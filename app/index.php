<?php
require_once 'includes/config.php';
require_once 'includes/emotion_states.php';
require_once 'includes/journal_taxonomy.php';
requireLogin();
$u = currentUser();

// v3.20.9 — cache-busting for local JS/CSS, tied to the deployed app version. Without
// this, a browser (or an intermediate proxy/CDN) can keep serving a stale cached copy of
// a JS/CSS file after Update Now replaces it on the server -- exactly the kind of stale-
// asset confusion that already masked whether a fix had actually landed once in this
// release series (see CLAUDE.md v3.20.9). version.json is written into this same
// directory by updater.php's own apply step (LOCAL_VERSION_FILE = __DIR__.'/version.json'
// in updater.php) -- read defensively since it won't exist in a fresh checkout that's
// never been through an Update Now.
$__assetVer = 'dev';
$__versionFile = __DIR__ . '/version.json';
if (is_file($__versionFile)) {
    $__versionData = json_decode((string) file_get_contents($__versionFile), true);
    if (is_array($__versionData) && !empty($__versionData['current_version'])) {
        $__assetVer = $__versionData['current_version'];
    }
}
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
<link rel="stylesheet" href="css/style.css?v=<?= urlencode($__assetVer) ?>">
<link rel="stylesheet" href="css/brand.css?v=<?= urlencode($__assetVer) ?>">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
<script>
// v3.19.2 — applied synchronously, before the sidebar ever paints, so a persisted
// "collapsed" preference from a prior session renders correctly on the very first
// frame instead of flashing full-width and then visibly collapsing (.sidebar/.main's
// own width/margin transitions would otherwise animate that flash on every page load).
if (localStorage.getItem('fc_sidebar_collapsed') === '1') document.body.classList.add('sidebar-collapsed');
</script>
<div class="app">

<!-- ══ SIDEBAR ══ -->
<aside class="sidebar">
  <div class="sidebar-logo">
    <img src="media/fc-logo.png" alt="FC" style="height:32px;width:auto;border-radius:6px">
    <div>
      <h1>FundedControl</h1>
      <p>Get Funded. Stay Funded.</p>
    </div>
    <button class="sidebar-collapse-btn" id="sidebar-collapse-btn" onclick="toggleSidebarCollapse()" title="Collapse sidebar">‹</button>
  </div>
  <!-- Nav and the pinned-looking bottom block share one scroll region (sidebar-scroll)
       so that on a short viewport the balance card/footer never eat fixed space that
       squeezes nav into an undiscoverable sliver — everything scrolls together and
       nothing below the fold is unreachable. On a tall viewport where it all fits,
       this is visually identical to the old separately-pinned layout (nothing to
       scroll either way). -->
  <div class="sidebar-scroll">
  <nav class="nav">
    <div class="nav-section">Main</div>
    <a href="#" data-page="dashboard" onclick="showPage('dashboard');return false;"><span class="icon">📊</span><span class="nav-label">Dashboard</span></a>
    <a href="#" data-page="trades" onclick="showPage('trades');return false;"><span class="icon">📋</span><span class="nav-label">Trade Log</span></a>
    <a href="#" data-page="reportcard" onclick="showPage('reportcard');return false;"><span class="icon">📝</span><span class="nav-label">Report Card</span><span id="reportcard-dot" style="display:none;width:8px;height:8px;border-radius:50%;background:var(--orange, #F59E0B);margin-left:auto"></span></a>
    <a href="#" data-page="stats" onclick="showPage('stats');return false;"><span class="icon">📈</span><span class="nav-label">Statistics</span></a>
    <a href="#" data-page="backtest" onclick="showPage('backtest');return false;"><span class="icon">🕯️</span><span class="nav-label">Backtesting</span></a>
    <a href="#" data-page="saved-backtests" class="nav-sub" onclick="showPage('saved-backtests');return false;"><span class="icon" style="font-size:12px">📂</span><span class="nav-label">Saved Backtests</span></a>
    <div class="nav-section">Tools</div>
    <a href="#" data-page="bfimport" onclick="showPage('bfimport');return false;"><span class="icon">📥</span><span class="nav-label">Import</span></a>
    <a href="#" data-page="calculator" onclick="showPage('calculator');return false;"><span class="icon">🧮</span><span class="nav-label">Risk Calculator</span></a>
    <a href="#" data-page="strategy" onclick="showPage('strategy');return false;"><span class="icon">🧪</span><span class="nav-label">Strategy Tester</span></a>
    <a href="#" data-page="strategies" onclick="showPage('strategies');return false;"><span class="icon">🧩</span><span class="nav-label">Strategies</span></a>
    <a href="#" data-page="leaderboard" onclick="showPage('leaderboard');return false;"><span class="icon">🏅</span><span class="nav-label">Leaderboard</span></a>
    <a href="#" data-page="review" onclick="showPage('review');return false;"><span class="icon">🧭</span><span class="nav-label">Review</span></a>
    <div class="nav-section">Account</div>
    <a href="#" data-page="profile" onclick="showPage('profile');return false;"><span class="icon">👤</span><span class="nav-label">Profile</span></a>
    <a href="#" data-page="challenges" onclick="showPage('challenges');return false;"><span class="icon">🏆</span><span class="nav-label">Challenges</span></a>
    <a href="logout.php"><span class="icon">🚪</span><span class="nav-label">Logout</span></a>
    <a href="updater.php" style="border-top:1px solid var(--border);color:var(--text3)" id="update-link"><span class="icon">🔄</span><span class="nav-label">Check Update</span> <span id="update-dot" style="display:none;width:8px;height:8px;border-radius:50%;background:var(--green);margin-left:auto"></span></a>
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
    <div class="sidebar-user" data-tooltip="<?= htmlspecialchars($u['display_name'] ?? $u['username']) ?>">
      <div class="avatar" id="sidebar-avatar" style="background:<?= htmlspecialchars($u['avatar_color'] ?? '#4f7cff') ?>"><?= strtoupper(substr($u['display_name'] ?? $u['username'], 0, 1)) ?></div>
      <div class="user-info">
        <div class="user-name" id="sidebar-username"><?= htmlspecialchars($u['display_name'] ?? $u['username']) ?></div>
        <div class="user-role" id="sidebar-prop"><?= htmlspecialchars($u['prop_firm'] ?? '') ?></div>
      </div>
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
      <button class="btn btn-primary btn-sm" id="topbar-trade-btn" onclick="openTradeModal()">+ Trade</button>
      <button class="btn btn-ghost btn-sm" onclick="exportPDF()">🖨 PDF</button>
    </div>
  </div>

  <?php
  // ── Load each page from its own file ──
  $pages = ['dashboard','trades','reportcard','stats','backtest','saved-backtests','bfimport','calculator','strategy','strategies','leaderboard','review','profile','challenges'];
  foreach ($pages as $p) {
      include "pages/{$p}.php";
  }
  ?>
</main>
</div>

<?php
// ── Load each modal from its own file ──
$modals = ['checklist-modal','trade-modal','trade-view-modal','review-modal','strategy-modal','strategy-builder-modal','pairs-modal','import-modal','challenge-modal','report-card-block-modal','report-card-template-modal'];
foreach ($modals as $m) {
    include "modals/{$m}.php";
}
?>

<div class="toast" id="toast"></div>

<script>
// Single source of truth for emotion codes/labels/descriptions lives in
// includes/emotion_states.php — trades.js reads this, it never hardcodes the list.
window.EMOTION_STATES = <?= json_encode(emotionStates()) ?>;
window.LEGACY_EMOTION_LABELS = <?= json_encode(legacyEmotionLabels()) ?>;
// Same single-source-of-truth pattern for the trade journal's other enumerated answers —
// includes/journal_taxonomy.php, never hardcoded in trades.js.
window.JOURNAL_ACTIONS = <?= json_encode(journalActions()) ?>;
window.JOURNAL_EXIT_TYPES = <?= json_encode(journalExitTypes()) ?>;
function filterTrades(q) {
    const f=allTrades.filter(t=>Object.values(t).some(v=>v&&String(v).toLowerCase().includes(q.toLowerCase())));
    renderTradesTable(f);
}
function clearCalcResult(){document.getElementById('calc-results').style.display='none';}
document.querySelectorAll('.modal-overlay').forEach(el=>{
    el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});
});
</script>

<!-- ══ JS MODULES ══ -->
<?php foreach ([
    'app', 'dashboard', 'trades', 'report-card', 'stats', 'chart', 'backtest',
    'saved-backtests', 'calculator', 'strategy', 'strategies', 'leaderboard',
    'review', 'profile', 'challenges', 'import', 'bfimport',
] as $__jsModule): ?>
<script src="js/<?= $__jsModule ?>.js?v=<?= urlencode($__assetVer) ?>"></script>
<?php endforeach; ?>
</body>
</html>
