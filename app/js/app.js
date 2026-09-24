/**
 * FundedControl — Core App Module (v3.0.0 Phase 2)
 * API helper, formatters, toast, nav router, init
 * All other logic lives in separate JS modules
 */
const API = 'includes/api.php';
let charts = {}, allTrades = [], allPairs = [], currentUser = {}, stratTrades = [], allReviews = [], allChallenges = [];

// ── HELPERS ──────────────────────────────────────────────
async function api(action, method='GET', data=null, isForm=false) {
    const opts = { method, headers: isForm ? {} : {'Content-Type':'application/json'} };
    if (data) opts.body = isForm ? data : JSON.stringify(data);
    const res = await fetch(`${API}?action=${action}`, opts);
    return res.json();
}
function fmt(n,prefix='$'){
    if(n===null||n===undefined||n==='') return '—';
    const v=parseFloat(n); return (v>=0?prefix:'-'+prefix)+Math.abs(v).toFixed(2);
}
function fmtPct(n){return parseFloat(n).toFixed(1)+'%';}
function fmtR(n){return parseFloat(n).toFixed(2)+'R';}
// Shared by dashboard.js and stats.js — both render get_stats() output and both need to
// disclose the challenge scope + open-trade exclusion, not leave it silent.
function renderScopeCaption(elId, s){
    const el=document.getElementById(elId);
    if(!el) return;
    const scope=s.scope||{};
    const parts=[];
    if(scope.challenge_name) parts.push(`Scoped to "${scope.challenge_name}"`);
    if(s.open_trades) parts.push(`${s.open_trades} open trade${s.open_trades>1?'s':''} excluded from Win Rate & Avg R`);
    el.textContent = parts.join(' · ');
}
function pnlCls(n){return parseFloat(n)>=0?'pnl-pos':'pnl-neg';}
function resultBadge(r){
    if(!r) return '—';
    const m={Win:'win',Loss:'loss','Break Even':'be'};
    return `<span class="badge badge-${m[r]||''}">${r}</span>`;
}
function toast(msg,type='success'){
    const t=document.getElementById('toast');
    t.textContent=msg; t.className=`toast ${type} show`;
    setTimeout(()=>t.className='toast',2800);
}
function destroyCharts(...keys){keys.forEach(k=>{if(charts[k]){charts[k].destroy();delete charts[k];}});}
function chartOpts(extra={}){
    return {responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#6C7A8D',font:{size:11,family:'Outfit'},boxWidth:12}}},scales:{x:{ticks:{color:'#6C7A8D',font:{size:10,family:'Outfit'}},grid:{color:'rgba(0,0,0,0.06)'}},y:{ticks:{color:'#6C7A8D',font:{size:10,family:'Outfit'}},grid:{color:'rgba(0,0,0,0.06)'}}}, ...extra};
}

// ── NAV ──────────────────────────────────────────────────
function showPage(id) {
    if(id==='settings') id='profile';
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav a').forEach(a=>a.classList.remove('active'));
    const pg = document.getElementById('page-'+id);
    if(pg) pg.classList.add('active');
    const lnk = document.querySelector(`[data-page="${id}"]`);
    if(lnk) lnk.classList.add('active');
    const titles={dashboard:'Dashboard',trades:'Trade Log',reportcard:'Report Card',stats:'Statistics',chart:'Chart',review:'Review',strategy:'Strategy Tester',strategies:'Strategy Lab',leaderboard:'Leaderboard',calculator:'Risk Calculator',profile:'Profile Settings',challenges:'Challenges',bfimport:'Import'};
    document.querySelector('.topbar h2').textContent = titles[id]||id;
    document.querySelector('.sidebar').classList.remove('open');
    // v3.19.2 — every "chart page should look/behave differently" rule (dark topbar,
    // full-bleed .main, no page padding — css/style.css's "BACKTESTING CHART" block)
    // keys off this one class, scoped to the chart page only; every other page is
    // completely unaffected since they never get it.
    document.body.classList.toggle('chart-active', id==='chart');
    if(id==='dashboard') loadDashboard();
    if(id==='trades') { loadPairs(); loadTrades(); }
    if(id==='reportcard') loadReportCard();
    if(id==='stats') loadStats();
    if(id==='chart') loadChart();
    if(id==='review') loadReviewEngine();
    if(id==='strategy') loadStrategyTrades();
    if(id==='strategies') loadStrategies();
    if(id==='leaderboard') loadLeaderboard();
    if(id==='calculator') loadCalculator();
    if(id==='profile') loadProfile();
    if(id==='challenges') loadChallenges();
    if(id==='bfimport') loadBfImport();
}

// ── SIDEBAR COLLAPSE (v3.19.2) ───────────────────────────
// WordPress-admin-style icon rail; css/style.css's body.sidebar-collapsed rules do all
// the actual visual work (width, hidden labels, hover tooltips) — this just flips the
// one class, persists the choice, and updates the toggle button's own tooltip text.
// Applies app-wide (every page uses the same .sidebar/.main), not just the chart page.
function toggleSidebarCollapse(){
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('fc_sidebar_collapsed', collapsed ? '1' : '0');
    const btn = document.getElementById('sidebar-collapse-btn');
    if(btn) btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

// ── PDF EXPORT ───────────────────────────────────────────
function exportPDF(){ window.print(); }

// ── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',async()=>{
    currentUser=await api('get_user')||{};
    updateSidebarFromUser();
    await refreshSidebarChallenges();

    document.getElementById('hamburger-btn')?.addEventListener('click',()=>{
        document.querySelector('.sidebar').classList.toggle('open');
    });
    // The collapsed class itself was already applied synchronously (see the inline
    // <script> right after <body>, before the sidebar ever paints) — this just syncs
    // the toggle button's own tooltip text to match on load.
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    if(collapseBtn && document.body.classList.contains('sidebar-collapsed')) collapseBtn.title = 'Expand sidebar';

    showPage('dashboard');
    // v3.17.1 — the topbar "+ Trade" button (#topbar-trade-btn) is present on every page,
    // not just Trades, so its STOP gate needs an initial check here rather than only ever
    // running from loadTrades(). refreshNewTradeGate() lives in js/trades.js.
    refreshNewTradeGate();
    // v3.18.0 — the sidebar's Report Card dot badge (draft after 20:00 local) needs an
    // initial check here too, same reasoning as refreshNewTradeGate() above: it's visible
    // from every page, not just when Report Card itself is open. Lives in js/report-card.js.
    refreshReportCardDot();
});
