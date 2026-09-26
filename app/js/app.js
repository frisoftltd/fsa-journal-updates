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
// v3.20.11 — `param` carries a sub-identifier for a page that needs one to fully
// restore, currently only Backtesting's own open session id (#backtest:42). Every other
// page ignores it. Called both from onclick handlers (no param) and from URL-hash
// restoration (see _restoreFromHash() below), which is what makes a refresh or a copied
// link land back on the exact same session, not just the same page.
function showPage(id, param) {
    if(id==='settings') id='profile';
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav a').forEach(a=>a.classList.remove('active'));
    const pg = document.getElementById('page-'+id);
    if(pg) pg.classList.add('active');
    const lnk = document.querySelector(`[data-page="${id}"]`);
    if(lnk) lnk.classList.add('active');
    const titles={dashboard:'Dashboard',trades:'Trade Log',reportcard:'Report Card',stats:'Statistics',backtest:'Backtesting','saved-backtests':'Saved Backtests',review:'Review',strategy:'Strategy Tester',strategies:'Strategy Lab',leaderboard:'Leaderboard',calculator:'Risk Calculator',profile:'Profile Settings',challenges:'Challenges',bfimport:'Import'};
    document.querySelector('.topbar h2').textContent = titles[id]||id;
    document.querySelector('.sidebar').classList.remove('open');
    // v3.20.1 — body.backtest-active (dark topbar, full-bleed .main, no page padding —
    // css/style.css's "BACKTESTING" block) is no longer tied to the Backtesting PAGE as
    // a whole: Screens A (new-session form) and C (saved backtests) are normal
    // light-themed content like every other page. Only Screen B (the actual replay
    // window) is dark/full-bleed, so js/backtest.js::showBacktestScreen() toggles this
    // class itself, exactly when entering/leaving that one screen — not here.
    if(id!=='backtest') document.body.classList.remove('backtest-active');
    _setUrlHash(id, param);
    if(id==='dashboard') loadDashboard();
    if(id==='trades') { loadPairs(); loadTrades(); }
    if(id==='reportcard') loadReportCard();
    if(id==='stats') loadStats();
    if(id==='backtest') loadBacktest(param);
    if(id==='saved-backtests') loadSavedBacktests();
    if(id==='review') loadReviewEngine();
    if(id==='strategy') loadStrategyTrades();
    if(id==='strategies') loadStrategies();
    if(id==='leaderboard') loadLeaderboard();
    if(id==='calculator') loadCalculator();
    if(id==='profile') loadProfile();
    if(id==='challenges') loadChallenges();
    if(id==='bfimport') loadBfImport();
}

// ── URL-BASED PAGE PERSISTENCE (v3.20.11) ─────────────────
// Minimal hash router, no server-side routing changes: #<page> or #<page>:<param>. Every
// showPage() call writes the hash; a refresh, a copied link, or the browser's own back/
// forward button all restore the same place via _restoreFromHash(). App-wide, not just
// Backtesting -- the param slot exists only because Backtesting's replay window needs
// one; every other page just uses the bare #<page> form.
function _setUrlHash(page, param) {
    const target = '#' + page + (param ? ':' + param : '');
    if (location.hash === target) return; // avoid pushing a no-op history entry
    location.hash = target;
}
function _parseUrlHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return null;
    const i = raw.indexOf(':');
    return i === -1 ? { page: raw, param: null } : { page: raw.slice(0, i), param: raw.slice(i + 1) };
}
function _restoreFromHash() {
    const parsed = _parseUrlHash();
    const page = (parsed && document.getElementById('page-' + parsed.page)) ? parsed.page : 'dashboard';
    showPage(page, parsed ? parsed.param : null);
}
// Fires on the browser's back/forward buttons -- and also on location.hash assignments
// we make ourselves inside showPage(), which is why this checks whether anything is
// actually different before re-running a whole page load: without that check, every
// single in-app navigation would trigger a second, redundant showPage() call a moment
// later (setting the hash always fires 'hashchange', regardless of who set it).
window.addEventListener('hashchange', () => {
    const parsed = _parseUrlHash();
    const targetPage = (parsed && document.getElementById('page-' + parsed.page)) ? parsed.page : 'dashboard';
    const targetParam = parsed ? parsed.param : null;
    const activeLink = document.querySelector('.nav a.active');
    const currentPage = activeLink ? activeLink.dataset.page : null;
    const alreadyThere = targetPage === currentPage &&
        (targetPage !== 'backtest' || String(typeof btActiveSessionId !== 'undefined' ? (btActiveSessionId || '') : '') === String(targetParam || ''));
    if (alreadyThere) return;
    showPage(targetPage, targetParam);
});

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

    // v3.20.11 — restore whatever page (and, for Backtesting, session) the URL hash
    // says, instead of always landing on the dashboard. A fresh visit with no hash at
    // all falls through to 'dashboard' inside _restoreFromHash() itself.
    _restoreFromHash();
    // v3.17.1 — the topbar "+ Trade" button (#topbar-trade-btn) is present on every page,
    // not just Trades, so its STOP gate needs an initial check here rather than only ever
    // running from loadTrades(). refreshNewTradeGate() lives in js/trades.js.
    refreshNewTradeGate();
    // v3.18.0 — the sidebar's Report Card dot badge (draft after 20:00 local) needs an
    // initial check here too, same reasoning as refreshNewTradeGate() above: it's visible
    // from every page, not just when Report Card itself is open. Lives in js/report-card.js.
    refreshReportCardDot();
});
