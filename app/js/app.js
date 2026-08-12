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
    const titles={dashboard:'Dashboard',trades:'Trade Log',stats:'Statistics',review:'Weekly Review',strategy:'Strategy Tester',strategies:'Strategy Lab',calculator:'Risk Calculator',profile:'Profile Settings',challenges:'Challenges'};
    document.querySelector('.topbar h2').textContent = titles[id]||id;
    document.querySelector('.sidebar').classList.remove('open');
    if(id==='dashboard') loadDashboard();
    if(id==='trades') { loadPairs(); loadTrades(); }
    if(id==='stats') loadStats();
    if(id==='review') loadReviews();
    if(id==='strategy') loadStrategyTrades();
    if(id==='strategies') loadStrategies();
    if(id==='calculator') loadCalculator();
    if(id==='profile') loadProfile();
    if(id==='challenges') loadChallenges();
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

    showPage('dashboard');
});
