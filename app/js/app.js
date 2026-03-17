const API = 'includes/api.php';
let charts = {}, allTrades = [], allPairs = [], currentUser = {}, stratTrades = [], allReviews = [];

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
    return {responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8892b0',font:{size:11},boxWidth:12}}},scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}, ...extra};
}

// ── NAV ──────────────────────────────────────────────────
function showPage(id) {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav a').forEach(a=>a.classList.remove('active'));
    const pg = document.getElementById('page-'+id);
    if(pg) pg.classList.add('active');
    const lnk = document.querySelector(`[data-page="${id}"]`);
    if(lnk) lnk.classList.add('active');
    const titles={dashboard:'Dashboard',trades:'Trade Log',stats:'Statistics',review:'Weekly Review',strategy:'Strategy Tester',calculator:'Risk Calculator',settings:'Settings'};
    document.querySelector('.topbar h2').textContent = titles[id]||id;
    // close sidebar on mobile
    document.querySelector('.sidebar').classList.remove('open');
    if(id==='dashboard') loadDashboard();
    if(id==='trades') { loadPairs(); loadTrades(); }
    if(id==='stats') loadStats();
    if(id==='review') loadReviews();
    if(id==='strategy') loadStrategyTrades();
    if(id==='calculator') loadCalculator();
    if(id==='settings') loadSettings();
}

// ── ALERTS ───────────────────────────────────────────────
async function loadAlerts() {
    const alerts = await api('get_alerts');
    const bar = document.getElementById('alert-bar');
    if(!alerts.length){bar.innerHTML='';return;}
    bar.innerHTML = alerts.map(a=>`<div class="alert alert-${a.type}"><span>${a.icon}</span>${a.msg}</div>`).join('');
}

// ── DASHBOARD ────────────────────────────────────────────
async function loadDashboard() {
    await loadAlerts();
    const s = await api('get_stats');
    const u = currentUser;

    // KPIs
    const set = (id,val,cls='')=>{const el=document.getElementById(id);if(el){el.textContent=val;if(cls)el.className='kpi-val '+cls;}};
    set('kpi-trades',s.total_trades,'blue');
    set('kpi-winrate',fmtPct(s.win_rate),s.win_rate>=50?'green':'red');
    set('kpi-pnl',fmt(s.net_pnl),parseFloat(s.net_pnl)>=0?'green':'red');
    set('kpi-fees',fmt(s.total_fees),'red');
    set('kpi-r',fmtR(s.avg_r),parseFloat(s.avg_r)>=0?'green':'red');
    set('kpi-pf',parseFloat(s.profit_factor).toFixed(2),'orange');

    // Balance
    const bal = parseFloat(u.account_balance||9446)+parseFloat(s.net_pnl||0);
    document.getElementById('sidebar-balance').textContent = '$'+bal.toFixed(2);

    // Drawdown bar
    const ddPct = Math.min(100, parseFloat(s.dd_pct||0));
    const ddFill = document.getElementById('dd-fill');
    if(ddFill){
        ddFill.style.width = ddPct+'%';
        ddFill.style.background = ddPct>80?'var(--red)':ddPct>50?'var(--orange)':'var(--green)';
    }
    const ddLabel = document.getElementById('dd-label');
    if(ddLabel) ddLabel.textContent = `DD: ${ddPct.toFixed(1)}% / ${u.max_drawdown_pct||10}%`;

    // Streak
    const str = s.streak||{};
    const strEl = document.getElementById('kpi-streak');
    if(strEl) strEl.textContent = str.current ? `${str.current} ${str.type}${str.current>1?'s':''}` : '—';

    destroyCharts('donut','line','barPnl','barFib','barSession','drawdown');

    const co = chartOpts();
    const noLegend = {...co, plugins:{legend:{display:false}}};

    // Donut
    charts.donut = new Chart(document.getElementById('chart-donut'),{
        type:'doughnut',
        data:{labels:['Wins','Losses','Break Even'],datasets:[{data:[s.wins,s.losses,s.break_evens],backgroundColor:['#00d4a0','#ff4d6d','#ffb347'],borderWidth:0,hoverOffset:6}]},
        options:{...co,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:'#8892b0',padding:10,font:{size:11}}}}}
    });

    // Cumulative P&L
    const cum=s.cumulative||[];
    charts.line = new Chart(document.getElementById('chart-cumulative'),{
        type:'line',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{label:'Cumulative P&L',data:cum.map(t=>t.cumulative),borderColor:'#4f7cff',backgroundColor:'rgba(79,124,255,0.08)',fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#4f7cff'}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    // Drawdown curve
    charts.drawdown = new Chart(document.getElementById('chart-drawdown'),{
        type:'line',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{label:'Drawdown %',data:cum.map(t=>-t.drawdown),borderColor:'#ff4d6d',backgroundColor:'rgba(255,77,109,0.07)',fill:true,tension:0.4,pointRadius:2}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>v+'%',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    // P&L per trade
    charts.barPnl = new Chart(document.getElementById('chart-pnl'),{
        type:'bar',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{data:cum.map(t=>t.net_pnl),backgroundColor:cum.map(t=>t.net_pnl>=0?'rgba(0,212,160,0.7)':'rgba(255,77,109,0.7)'),borderRadius:3}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    // Session P&L
    const sess=s.by_session||[];
    charts.barSession = new Chart(document.getElementById('chart-session'),{
        type:'bar',
        data:{labels:sess.map(s=>s.session),datasets:[{label:'Net P&L',data:sess.map(s=>s.pnl),backgroundColor:['#4f7cff','#00d4a0','#9b6dff'],borderRadius:4}]},
        options:{...co,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    // Fib win rate
    const fib=s.by_fib||[];
    charts.barFib = new Chart(document.getElementById('chart-fib'),{
        type:'bar',
        data:{labels:fib.map(f=>f.fib_level),datasets:[{label:'Win Rate %',data:fib.map(f=>f.trades>0?Math.round(f.wins/f.trades*100):0),backgroundColor:'rgba(155,109,255,0.7)',borderRadius:4}]},
        options:{...co,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>v+'%',font:{size:10}},max:100,grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    // Calendar heatmap
    renderCalendar(s.calendar||[]);
    // Hours heatmap
    renderHoursHeatmap(s.by_hour||[]);
}

// ── CALENDAR HEATMAP ─────────────────────────────────────
function renderCalendar(data) {
    const wrap = document.getElementById('calendar-wrap');
    if(!wrap) return;
    const map = {};
    data.forEach(d=>{ map[d.trade_date]={pnl:parseFloat(d.pnl),trades:d.trades}; });
    const maxAbs = Math.max(...data.map(d=>Math.abs(parseFloat(d.pnl))),1);

    // last 3 months
    const months = [];
    const now = new Date();
    for(let i=2;i>=0;i--){
        const d = new Date(now.getFullYear(),now.getMonth()-i,1);
        months.push({year:d.getFullYear(),month:d.getMonth()});
    }
    wrap.innerHTML = months.map(({year,month})=>{
        const mName = new Date(year,month,1).toLocaleString('default',{month:'short',year:'numeric'});
        const days = new Date(year,month+1,0).getDate();
        const firstDay = new Date(year,month,1).getDay();
        let cells = '<div style="display:grid;grid-template-columns:repeat(7,22px);gap:3px">';
        for(let i=0;i<firstDay;i++) cells+='<div></div>';
        for(let d=1;d<=days;d++){
            const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const info = map[key];
            let bg = '#1a2035';
            if(info){
                const intensity = Math.min(1,Math.abs(info.pnl)/maxAbs);
                const r = info.pnl>=0?0:255, g=info.pnl>=0?212:77;
                bg = `rgba(${r},${g},${info.pnl>=0?160:109},${0.2+intensity*0.7})`;
            }
            const tip = info?`${key}: ${fmt(info.pnl)} (${info.trades} trade${info.trades>1?'s':''})`:`${key}: No trades`;
            cells+=`<div class="cal-day" style="background:${bg}" title="${tip}"><span class="cal-tooltip">${tip}</span></div>`;
        }
        cells+='</div>';
        return `<div style="margin-right:16px"><div class="cal-month-label">${mName}</div>${cells}</div>`;
    }).join('');
}

// ── HOURS HEATMAP ─────────────────────────────────────────
function renderHoursHeatmap(data) {
    const wrap = document.getElementById('hours-heatmap');
    if(!wrap) return;
    const byHour = {};
    for(let h=0;h<24;h++) byHour[h]={trades:0,wins:0,pnl:0};
    data.forEach(d=>{ byHour[d.hour]={trades:parseInt(d.trades),wins:parseInt(d.wins),pnl:parseFloat(d.pnl)}; });
    const maxPnl = Math.max(...Object.values(byHour).map(h=>Math.abs(h.pnl)),1);
    wrap.innerHTML = Array.from({length:24},(_,h)=>{
        const info=byHour[h];
        const height = info.trades>0?Math.max(12,Math.abs(info.pnl)/maxPnl*80):4;
        const color = info.pnl>0?'rgba(0,212,160,0.7)':info.pnl<0?'rgba(255,77,109,0.7)':'rgba(74,85,128,0.3)';
        const label = h===0?'12a':h<12?h+'a':h===12?'12p':(h-12)+'p';
        return `<div class="heatmap-col">
            <div class="heatmap-bar" style="height:${height}px;background:${color}" title="${h}:00 — ${info.trades} trades, P&L: ${fmt(info.pnl)}"></div>
            <div class="heatmap-label">${label}</div>
        </div>`;
    }).join('');
}

// ── TRADE LOG ────────────────────────────────────────────
async function loadTrades() {
    const pair = document.getElementById('filter-pair')?.value||'';
    const result = document.getElementById('filter-result')?.value||'';
    const from = document.getElementById('filter-from')?.value||'';
    const to = document.getElementById('filter-to')?.value||'';
    let url = 'get_trades';
    const params=[];
    if(pair) params.push('pair='+pair);
    if(result) params.push('result='+result);
    if(from) params.push('from='+from);
    if(to) params.push('to='+to);
    if(params.length) url+='&'+params.join('&');
    allTrades = await api(url);
    renderTradesTable(allTrades);
}

async function loadPairs() {
    allPairs = await api('get_pairs');
    const selects = document.querySelectorAll('.pair-select');
    selects.forEach(sel => {
        const cur = sel.value;
        // For filter dropdowns keep All Pairs option
        if(sel.id === 'filter-pair') {
            sel.innerHTML = '<option value="">All Pairs</option>' + 
                allPairs.map(p=>`<option value="${p.symbol}">${p.symbol}</option>`).join('');
        } else {
            sel.innerHTML = allPairs.map(p=>`<option value="${p.symbol}">${p.symbol}</option>`).join('');
        }
        if(cur) sel.value = cur;
    });
}

function renderTradesTable(trades) {
    const tbody=document.getElementById('trades-tbody');
    if(!trades.length){tbody.innerHTML='<tr><td colspan="17" class="empty"><div class="empty-icon">📋</div><p>No trades yet.</p></td></tr>';return;}
    tbody.innerHTML = trades.map(t=>`<tr>
        <td style="color:var(--text3);font-size:11px">#${t.id}</td>
        <td style="white-space:nowrap">${t.trade_date}</td>
        <td><span class="badge" style="background:rgba(79,124,255,0.1);color:var(--blue2);font-size:10px">${t.session||'—'}</span></td>
        <td style="font-weight:600;color:var(--text)">${t.pair}</td>
        <td>${t.direction==='Long'?'<span class="badge badge-long">Long</span>':'<span class="badge badge-short">Short</span>'}</td>
        <td style="font-family:var(--font-head);font-size:11px">${t.entry_price?parseFloat(t.entry_price).toFixed(2):'—'}</td>
        <td style="font-family:var(--font-head);font-size:11px;color:var(--red2)">${t.stop_loss?parseFloat(t.stop_loss).toFixed(2):'—'}</td>
        <td style="font-family:var(--font-head);font-size:11px">${t.exit_price?parseFloat(t.exit_price).toFixed(2):'—'}</td>
        <td><span class="${pnlCls(t.pnl)}">${fmt(t.pnl)}</span></td>
        <td style="color:var(--orange);font-size:12px;font-family:var(--font-head)">${fmt(t.fees)}</td>
        <td><span class="${pnlCls(t.net_pnl)}">${fmt(t.net_pnl)}</span></td>
        <td style="font-family:var(--font-head);font-size:11px;color:${parseFloat(t.r_multiple)>=0?'var(--green)':'var(--red)'}">${t.r_multiple!==null?t.r_multiple+'R':'—'}</td>
        <td>${resultBadge(t.result)}</td>
        <td style="color:var(--purple);font-size:12px">${t.fib_level||'—'}</td>
        <td>${t.confidence?`<span class="badge badge-${(t.confidence||'').toLowerCase()}">${t.confidence}</span>`:'—'}</td>
        <td>${t.screenshot?`<img src="media/uploads/${t.user_id||1}/${t.screenshot}" class="screenshot-preview" onclick="viewTrade(${t.id})" style="width:40px;height:30px;cursor:pointer" title="Click to view trade">`:'—'}</td>
        <td style="white-space:nowrap">
            <button class="btn btn-ghost btn-sm" onclick="viewTrade(${t.id})" title="View trade details">👁</button>
            <button class="btn btn-ghost btn-sm" onclick="editTrade(${t.id})">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteTrade(${t.id})" style="margin-left:3px">🗑</button>
        </td>
    </tr>`).join('');
}

function viewTrade(id) {
    const t = allTrades.find(t=>t.id==id);
    if(!t) return;
    const u = currentUser;
    const uid = u?.id || 1;
    const imgHtml = t.screenshot
        ? `<img src="media/uploads/${uid}/${t.screenshot}" style="width:100%;max-height:400px;object-fit:contain;border-radius:8px;border:1px solid var(--border);cursor:pointer" onclick="window.open(this.src,'_blank')" title="Click to open full size">`
        : `<div style="height:200px;display:flex;align-items:center;justify-content:center;background:var(--bg3);border-radius:8px;color:var(--text3)">No chart screenshot</div>`;

    document.getElementById('view-trade-content').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
            <div>
                ${imgHtml}
                ${t.notes?`<div style="margin-top:12px;padding:12px;background:var(--bg3);border-radius:8px;font-size:13px;color:var(--text2);line-height:1.6"><strong style="color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:1px">Notes</strong><br>${t.notes}</div>`:''}
            </div>
            <div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Date</div>
                        <div style="font-family:var(--font-head);font-size:13px">${t.trade_date}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Pair</div>
                        <div style="font-family:var(--font-head);font-size:13px;color:var(--blue2)">${t.pair}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Direction</div>
                        <div>${t.direction==='Long'?'<span class="badge badge-long">Long</span>':'<span class="badge badge-short">Short</span>'}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Result</div>
                        <div>${resultBadge(t.result)}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Entry</div>
                        <div style="font-family:var(--font-head);font-size:13px">${t.entry_price?parseFloat(t.entry_price).toFixed(2):'—'}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Stop Loss</div>
                        <div style="font-family:var(--font-head);font-size:13px;color:var(--red)">${t.stop_loss?parseFloat(t.stop_loss).toFixed(2):'—'}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Take Profit</div>
                        <div style="font-family:var(--font-head);font-size:13px;color:var(--green)">${t.take_profit?parseFloat(t.take_profit).toFixed(2):'—'}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Exit Price</div>
                        <div style="font-family:var(--font-head);font-size:13px">${t.exit_price?parseFloat(t.exit_price).toFixed(2):'—'}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Net P&L</div>
                        <div class="${pnlCls(t.net_pnl)}" style="font-size:18px">${fmt(t.net_pnl)}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">R Multiple</div>
                        <div style="font-family:var(--font-head);font-size:16px;color:${parseFloat(t.r_multiple||0)>=0?'var(--green)':'var(--red)'}">${t.r_multiple}R</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Fib Level</div>
                        <div style="color:var(--purple);font-weight:600">${t.fib_level||'—'}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">FSA Rules</div>
                        <div style="color:${t.fsa_rules==='All 5'?'var(--green)':'var(--orange)'};font-weight:600">${t.fsa_rules||'—'}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Session</div>
                        <div>${t.session||'—'}</div>
                    </div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Exec Score</div>
                        <div style="font-family:var(--font-head);font-size:16px;color:var(--gold)">${t.exec_score?t.exec_score+'/10':'—'}</div>
                    </div>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px">
                    <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('view-trade-modal').classList.remove('open')">Close</button>
                    <button class="btn btn-primary" style="flex:1" onclick="document.getElementById('view-trade-modal').classList.remove('open');editTrade(${t.id})">✏️ Edit Trade</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('view-trade-title').textContent = `Trade #${t.id} — ${t.pair} ${t.direction} — ${t.trade_date}`;
    document.getElementById('view-trade-modal').classList.add('open');
}

function viewScreenshot(url){
    window.open(url,'_blank');
}

function openTradeModal(data=null) {
    loadPairs();
    document.getElementById('trade-form').reset();
    document.getElementById('trade-id').value=data?.id||'';
    document.getElementById('screenshot-current').innerHTML='';
    if(data){
        const fields=['trade_date','session','pair','direction','entry_price','stop_loss','take_profit','exit_price','lot_size','fees','result','confidence','exec_score','fib_level','fsa_rules','notes'];
        fields.forEach(k=>{ const el=document.getElementById('f-'+k); if(el&&data[k]!==null&&data[k]!==undefined) el.value=data[k]; });
        // Handle datetime fields
        if(data.time_in) { const d=data.time_in.replace(' ','T'); const parts=d.split('T'); document.getElementById('f-time_in_date').value=parts[0]; document.getElementById('f-time_in_time').value=parts[1]?.substring(0,5)||''; }
        if(data.time_out) { const d=data.time_out.replace(' ','T'); const parts=d.split('T'); document.getElementById('f-time_out_date').value=parts[0]; document.getElementById('f-time_out_time').value=parts[1]?.substring(0,5)||''; }
        if(data.screenshot) document.getElementById('screenshot-current').innerHTML=`<img src="uploads/screenshots/${data.screenshot}" style="max-width:100%;max-height:100px;border-radius:6px;margin-top:6px">`;
    } else {
        const today=new Date().toISOString().split('T')[0];
        document.getElementById('f-trade_date').value=today;
        document.getElementById('f-time_in_date').value=today;
        document.getElementById('f-time_out_date').value=today;
    }
    document.getElementById('trade-modal').classList.add('open');
}

async function editTrade(id){ const t=allTrades.find(t=>t.id==id); if(t) openTradeModal(t); }

async function deleteTrade(id){
    if(!confirm('Delete this trade?')) return;
    await api('delete_trade','POST',{id});
    toast('Trade deleted'); loadTrades(); loadDashboard();
}

async function saveTrade() {
    const id=document.getElementById('trade-id').value;
    const form=document.getElementById('trade-form');
    const fd=new FormData(form);

    // Build datetime strings
    const tin_d=document.getElementById('f-time_in_date').value;
    const tin_t=document.getElementById('f-time_in_time').value;
    const tout_d=document.getElementById('f-time_out_date').value;
    const tout_t=document.getElementById('f-time_out_time').value;
    if(tin_d&&tin_t) fd.set('time_in',tin_d+' '+tin_t+':00');
    if(tout_d&&tout_t) fd.set('time_out',tout_d+' '+tout_t+':00');
    if(id) fd.set('id',id);

    // Use FormData for file upload
    const hasFile=document.getElementById('f-screenshot').files.length>0;
    if(hasFile) {
        const resp=await fetch(`${API}?action=${id?'update_trade':'add_trade'}`,{method:'POST',body:fd});
        const r=await resp.json();
        if(r.error){toast(r.error,'error');return;}
    } else {
        const data={};
        ['trade_date','session','pair','direction','entry_price','stop_loss','take_profit','exit_price','lot_size','fees','result','confidence','exec_score','fib_level','fsa_rules','notes'].forEach(k=>{data[k]=document.getElementById('f-'+k)?.value||null;});
        data.time_in=tin_d&&tin_t?tin_d+' '+tin_t+':00':null;
        data.time_out=tout_d&&tout_t?tout_d+' '+tout_t+':00':null;
        if(id) data.id=id;
        const r=await api(id?'update_trade':'add_trade','POST',data);
        if(r.error){toast(r.error,'error');return;}
    }
    toast(id?'Trade updated!':'Trade added! ✅');
    document.getElementById('trade-modal').classList.remove('open');
    loadTrades(); loadDashboard();
}

// ── RISK CALCULATOR ──────────────────────────────────────
function loadCalculator(){
    const u=currentUser;
    const balEl=document.getElementById('calc-balance');
    if(balEl) balEl.value=u.account_balance||10000;
    const riskEl=document.getElementById('calc-risk-pct');
    if(riskEl) riskEl.value=u.risk_per_trade_pct||0.25;
}

function calcSimple(){
    const balance = parseFloat(document.getElementById('calc-balance').value||0);
    const slPct   = parseFloat(document.getElementById('calc-sl-pct').value||0);
    const riskPct = parseFloat(document.getElementById('calc-risk-pct').value||0);
    const leverage= parseFloat(document.getElementById('calc-leverage').value||1);

    if(!balance||!slPct||!riskPct){
        document.getElementById('calc-results-inner').innerHTML='<div style="color:var(--red)">Please fill all fields</div>';
        return;
    }

    const riskAmt     = balance * riskPct / 100;
    const positionSize= (riskAmt / (slPct / 100));
    const lotSize     = positionSize / balance * leverage;
    const marginUsed  = positionSize / leverage;

    document.getElementById('calc-results-inner').innerHTML = `
        <div style="margin-bottom:12px">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Risk Amount</div>
            <div style="font-family:var(--font-head);font-size:28px;color:var(--red)">$${riskAmt.toFixed(2)}</div>
        </div>
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left">
            <div style="background:var(--bg3);border-radius:8px;padding:12px">
                <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Position Size</div>
                <div style="font-family:var(--font-head);font-size:20px;color:var(--green)">$${positionSize.toFixed(2)}</div>
            </div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px">
                <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Lot Size</div>
                <div style="font-family:var(--font-head);font-size:20px;color:var(--blue2)">${lotSize.toFixed(4)}</div>
            </div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px">
                <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Margin Used</div>
                <div style="font-family:var(--font-head);font-size:20px;color:var(--orange)">$${marginUsed.toFixed(2)}</div>
            </div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px">
                <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Leverage</div>
                <div style="font-family:var(--font-head);font-size:20px;color:var(--purple)">${leverage}x</div>
            </div>
        </div>
    `;
}

// ── FSA CHECKLIST ─────────────────────────────────────────
function openChecklist(){
    const items=document.querySelectorAll('.check-item');
    items.forEach(i=>{ i.classList.remove('checked'); i.querySelector('input').checked=false; });
    updateCheckScore();
    document.getElementById('checklist-popup').classList.add('open');
}

function toggleCheck(el){
    el.classList.toggle('checked');
    el.querySelector('input').checked=el.classList.contains('checked');
    updateCheckScore();
}

function updateCheckScore(){
    const total=document.querySelectorAll('.check-item').length;
    const checked=document.querySelectorAll('.check-item.checked').length;
    const scoreEl=document.getElementById('check-score');
    scoreEl.textContent=checked+'/'+total;
    scoreEl.style.color=checked===total?'var(--green)':checked>=3?'var(--orange)':'var(--red)';
}

function proceedTrade(){
    const checked=document.querySelectorAll('.check-item.checked').length;
    const total=document.querySelectorAll('.check-item').length;
    if(checked<total){if(!confirm(`Only ${checked}/${total} rules met. Take trade anyway?`)) return;}
    document.getElementById('checklist-popup').classList.remove('open');
    openTradeModal();
}

// ── STATS ────────────────────────────────────────────────
async function loadStats(){
    const m=document.getElementById('stat-month')?.value||'';
    const y=document.getElementById('stat-year')?.value||'';
    const s=await api('get_stats'+(m&&y?`&month=${m}&year=${y}`:''));

    const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
    set('s-total',s.total_trades); set('s-wins',s.wins); set('s-losses',s.losses);
    set('s-be',s.break_evens); set('s-wr',fmtPct(s.win_rate));
    set('s-gross',fmt(s.gross_pnl)); set('s-fees',fmt(s.total_fees));
    set('s-netpnl',fmt(s.net_pnl)); set('s-avgwin',fmt(s.avg_win));
    set('s-avgloss',fmt(s.avg_loss)); set('s-avgr',fmtR(s.avg_r));
    set('s-pf',s.profit_factor);
    set('s-maxdd',s.max_drawdown_pct?.toFixed(2)+'%');
    set('s-curdd',s.current_drawdown_pct?.toFixed(2)+'%');

    const str=s.streak||{};
    set('s-streak-cur',(str.current||0)+' '+(str.type||''));
    set('s-streak-maxwin',str.max_win||0);
    set('s-streak-maxloss',str.max_loss||0);

    const feePct=s.gross_pnl!=0?Math.abs(s.total_fees/s.gross_pnl*100).toFixed(1):0;
    set('s-fee-pct',feePct+'%');
    const warn=document.getElementById('s-fee-warning');
    if(warn){warn.textContent=feePct>10?'⚠️ Fees eating >10% of gross P&L — review lot size':'✅ Fees acceptable';warn.style.color=feePct>10?'var(--red)':'var(--green)';}

    const tbodyFn=(id,rows)=>{const el=document.getElementById(id);if(el)el.innerHTML=rows||'<tr><td colspan="4" style="color:var(--text3)">No data</td></tr>';};
    tbodyFn('s-session-tbody',(s.by_session||[]).map(r=>`<tr><td>${r.session}</td><td>${r.trades}</td><td>${r.trades>0?fmtPct(r.wins/r.trades*100):'0%'}</td><td class="${pnlCls(r.pnl)}">${fmt(r.pnl)}</td></tr>`).join(''));
    tbodyFn('s-fib-tbody',(s.by_fib||[]).map(r=>`<tr><td style="color:var(--purple)">${r.fib_level}</td><td>${r.trades}</td><td>${r.trades>0?fmtPct(r.wins/r.trades*100):'0%'}</td><td class="${pnlCls(r.pnl)}">${fmt(r.pnl)}</td></tr>`).join(''));
    tbodyFn('s-pair-tbody',(s.by_pair||[]).map(r=>`<tr><td style="font-weight:600">${r.pair}</td><td>${r.trades}</td><td>${r.trades>0?fmtPct(r.wins/r.trades*100):'0%'}</td><td class="${pnlCls(r.pnl)}">${fmt(r.pnl)}</td></tr>`).join(''));
    tbodyFn('s-dir-tbody',(s.by_direction||[]).map(r=>`<tr><td>${r.direction==='Long'?'<span class="badge badge-long">Long</span>':'<span class="badge badge-short">Short</span>'}</td><td>${r.trades}</td><td>${r.trades>0?fmtPct(r.wins/r.trades*100):'0%'}</td><td class="${pnlCls(r.pnl)}">${fmt(r.pnl)}</td></tr>`).join(''));
}

// ── WEEKLY REVIEW ────────────────────────────────────────
async function loadReviews(){
    allReviews=await api('get_reviews');
    const c=document.getElementById('reviews-list');
    if(!allReviews.length){c.innerHTML='<div class="empty"><div class="empty-icon">📝</div><p>No reviews yet.</p></div>';return;}
    c.innerHTML=allReviews.map(r=>`<div class="review-card">
        <div class="review-header">
            <span class="review-week">${r.week_start} → ${r.week_end}</span>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <span style="font-size:11px;color:var(--text3)">Process <span style="color:var(--gold)">${r.process_score}/10</span></span>
                <span style="font-size:11px;color:var(--text3)">Mindset <span style="color:var(--purple)">${r.mindset_score}/10</span></span>
                <button class="btn btn-ghost btn-sm" onclick="editReview(${r.id})">Edit</button>
            </div>
        </div>
        ${r.key_lesson?`<div style="font-size:12px;color:var(--text2);margin-bottom:8px"><span style="color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:1px">Key Lesson: </span>${r.key_lesson}</div>`:''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${r.what_went_well?`<div style="font-size:12px"><div style="color:var(--green);font-size:10px;text-transform:uppercase;margin-bottom:3px">✅ Went Well</div>${r.what_went_well}</div>`:''}
            ${r.what_to_improve?`<div style="font-size:12px"><div style="color:var(--orange);font-size:10px;text-transform:uppercase;margin-bottom:3px">📈 Improve</div>${r.what_to_improve}</div>`:''}
        </div>
    </div>`).join('');
}

function openReviewModal(data=null){
    document.getElementById('review-form').reset();
    document.getElementById('review-id').value=data?.id||'';
    if(data){
        ['week_start','week_end','process_score','mindset_score','key_lesson','what_went_well','what_to_improve','rules_followed'].forEach(k=>{
            const el=document.getElementById('r-'+k); if(el&&data[k]) el.value=data[k];
        });
    } else {
        const now=new Date();
        const mon=new Date(now); mon.setDate(now.getDate()-now.getDay()+1);
        const sun=new Date(mon); sun.setDate(mon.getDate()+6);
        document.getElementById('r-week_start').value=mon.toISOString().split('T')[0];
        document.getElementById('r-week_end').value=sun.toISOString().split('T')[0];
    }
    document.getElementById('review-modal').classList.add('open');
}

async function editReview(id){ const r=allReviews.find(r=>r.id==id); if(r) openReviewModal(r); }

async function saveReview(){
    const id=document.getElementById('review-id').value;
    const data={id:id||null};
    ['week_start','week_end','process_score','mindset_score','key_lesson','what_went_well','what_to_improve','rules_followed'].forEach(k=>{ data[k]=document.getElementById('r-'+k)?.value||null; });
    await api('save_review','POST',data);
    toast('Review saved!');
    document.getElementById('review-modal').classList.remove('open');
    loadReviews();
}

// ── STRATEGY TESTER ──────────────────────────────────────
async function loadStrategyTrades(){
    stratTrades=await api('get_strategy_trades');
    const stats=await api('get_strategy_stats');
    document.getElementById('st-total').textContent=stats.total;
    document.getElementById('st-wr').textContent=fmtPct(stats.win_rate||0);
    document.getElementById('st-pnl').textContent=fmt(stats.net_pnl||0);
    const tbody=document.getElementById('strategy-tbody');
    if(!stratTrades.length){tbody.innerHTML='<tr><td colspan="12"><div class="empty"><div class="empty-icon">🧪</div><p>No tests yet</p></div></td></tr>';return;}
    tbody.innerHTML=stratTrades.map(t=>{
        const rules=[t.r1,t.r2,t.r3,t.r4,t.r5].filter(r=>r==='Y').length;
        return `<tr>
            <td style="font-size:11px">${t.strategy_name||'—'}</td>
            <td>${t.pair||'—'}</td>
            <td>${t.direction==='Long'?'<span class="badge badge-long">Long</span>':'<span class="badge badge-short">Short</span>'}</td>
            <td>${['r1','r2','r3','r4','r5'].map((r,i)=>`<span style="padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;background:${t[r]==='Y'?'rgba(0,212,160,0.2)':'rgba(255,77,109,0.2)'};color:${t[r]==='Y'?'var(--green)':'var(--red)'}">R${i+1}</span>`).join(' ')}</td>
            <td style="font-size:11px;color:${rules===5?'var(--green)':'var(--orange)'}">${rules}/5${rules===5?' ✅':''}</td>
            <td>${resultBadge(t.result)}</td>
            <td style="color:var(--purple)">${t.fib_level||'—'}</td>
            <td style="font-family:var(--font-head);font-size:11px;color:${parseFloat(t.r_multiple||0)>=0?'var(--green)':'var(--red)'}">${t.r_multiple?t.r_multiple+'R':'—'}</td>
            <td><span class="${pnlCls(t.net_pnl||0)}">${fmt(t.net_pnl||0)}</span></td>
            <td>${t.session||'—'}</td>
            <td style="font-size:11px;color:var(--text3);max-width:120px;overflow:hidden;text-overflow:ellipsis">${t.notes||'—'}</td>
            <td><button class="btn btn-danger btn-sm" onclick="deleteStratTrade(${t.id})">🗑</button></td>
        </tr>`;
    }).join('');
}

async function deleteStratTrade(id){if(!confirm('Delete?'))return;await api('delete_strategy_trade','POST',{id});toast('Deleted');loadStrategyTrades();}

async function saveStratTrade(){
    const data={};
    ['strategy_name','timeframe','market','rule1','rule2','rule3','rule4','rule5','pair','direction','r1','r2','r3','r4','r5','result','fib_level','r_multiple','net_pnl','session','notes'].forEach(k=>{ data[k]=document.getElementById('st-'+k)?.value||null; });
    await api('add_strategy_trade','POST',data);
    toast('Test saved! ✅');
    document.getElementById('strategy-modal').classList.remove('open');
    loadStrategyTrades();
}

// ── PAIRS MANAGEMENT ─────────────────────────────────────
async function openPairsModal(){
    const pairs=await api('get_pairs');
    document.getElementById('pairs-list').innerHTML=pairs.map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:600">${p.symbol}</span><button class="btn btn-danger btn-sm" onclick="deletePair(${p.id})">Remove</button></div>`).join('');
    document.getElementById('pairs-modal').classList.add('open');
}

async function addPair(){
    const sym=document.getElementById('new-pair-input').value.trim();
    if(!sym) return;
    const r=await api('add_pair','POST',{symbol:sym});
    if(r.error){toast(r.error,'error');return;}
    toast(sym+' added!');
    document.getElementById('new-pair-input').value='';
    openPairsModal(); loadPairs();
}

async function deletePair(id){
    await api('delete_pair','POST',{id});
    toast('Pair removed'); openPairsModal(); loadPairs();
}

// ── SETTINGS ─────────────────────────────────────────────
async function loadSettings(){
    const u=await api('get_user');
    currentUser=u;
    const fields=['display_name','account_balance','starting_balance','max_drawdown_pct','daily_loss_limit','risk_per_trade_pct','prop_firm','challenge_phase','avatar_color'];
    fields.forEach(k=>{ const el=document.getElementById('set-'+k); if(el&&u[k]!==null) el.value=u[k]; });
}

async function saveSettings(){
    const data={};
    ['display_name','account_balance','starting_balance','max_drawdown_pct','daily_loss_limit','risk_per_trade_pct','prop_firm','challenge_phase','avatar_color'].forEach(k=>{ data[k]=document.getElementById('set-'+k)?.value||null; });
    const np=document.getElementById('set-new-password')?.value;
    if(np) data.new_password=np;
    await api('update_settings','POST',data);
    currentUser={...currentUser,...data};
    // update avatar
    const av=document.getElementById('sidebar-avatar');
    if(av){av.style.background=data.avatar_color;av.textContent=(data.display_name||'U')[0].toUpperCase();}
    toast('Settings saved! ✅');
}

// ── IMPORT FROM EXCEL ─────────────────────────────────────
async function importExcel(){
    const file=document.getElementById('import-file').files[0];
    if(!file){toast('Select a file first','warning');return;}

    const reader=new FileReader();
    reader.onload=async e=>{
        try {
            // Read workbook
            const wb = XLSX.read(e.target.result, {type:'binary', cellDates:false, raw:true});

            // Find Trade Log sheet
            const sheetName = wb.SheetNames.find(n=>n.includes('Trade'))||wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];

            // Read as array of arrays (raw — no header detection)
            const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

            // Find header row (the row that contains 'Date' and 'Pair')
            let headerRowIdx = -1;
            let headerMap = {};
            for(let i=0; i<rows.length; i++){
                const row = rows[i];
                const hasDate = row.some(c=>String(c).trim()==='Date');
                const hasPair = row.some(c=>String(c).trim()==='Pair');
                if(hasDate && hasPair){
                    headerRowIdx = i;
                    row.forEach((cell,idx)=>{ if(cell) headerMap[String(cell).trim()] = idx; });
                    break;
                }
            }

            if(headerRowIdx === -1){
                toast('Cannot find header row with Date and Pair columns','error');
                return;
            }

            // Helper to get cell value by column name
            const get = (row, name) => {
                const idx = headerMap[name];
                return idx !== undefined ? row[idx] : '';
            };

            // Parse date from various formats
            const parseDate = (val) => {
                if(!val && val!==0) return '';
                const s = String(val).trim();
                if(!s || s==='') return '';
                // Excel serial number (e.g. 46467) — numbers between 40000-50000
                const num = parseFloat(s);
                if(!isNaN(num) && num > 40000 && num < 60000) {
                    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
                    return d.toISOString().split('T')[0];
                }
                // dd/mm/yyyy
                if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
                    const [dd,mm,yyyy] = s.split('/');
                    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
                }
                // yyyy-mm-dd
                if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
                // Any other date string
                const d = new Date(s);
                if(!isNaN(d)) return d.toISOString().split('T')[0];
                return '';
            };

            // Build trades from data rows
            const trades = [];
            for(let i = headerRowIdx+1; i < rows.length; i++){
                const row = rows[i];
                const pair = String(get(row,'Pair')||'').trim();
                const dateRaw = get(row,'Date');
                if(!pair || !dateRaw) continue; // skip empty rows

                const trade_date = parseDate(dateRaw);
                if(!trade_date) continue;

                trades.push({
                    trade_date,
                    session:     String(get(row,'Session')||'London'),
                    pair,
                    direction:   String(get(row,'Direction')||'Long'),
                    entry_price: get(row,'Entry')||'',
                    stop_loss:   get(row,'Stop Loss')||'',
                    take_profit: get(row,'Take Profit')||'',
                    exit_price:  get(row,'Exit Price')||'',
                    lot_size:    get(row,'Lot Size')||'',
                    pnl:         get(row,'P&L $')||0,
                    fees:        get(row,'Fees $')||0,
                    r_multiple:  get(row,'R Multiple')||0,
                    result:      String(get(row,'Result')||''),
                    confidence:  String(get(row,'Confidence')||''),
                    exec_score:  get(row,'Exec Score')||'',
                    fib_level:   String(get(row,'Fib Level')||''),
                    fsa_rules:   String(get(row,'FSA Rules')||''),
                    notes:       String(get(row,'Notes')||'')
                });
            }

            if(!trades.length){
                toast('No valid trades found — check your file has Date and Pair columns','error');
                return;
            }

            const r = await api('import_trades','POST',{trades});
            toast(`Imported ${r.imported} trades! ✅`);
            document.getElementById('import-modal').classList.remove('open');
            loadTrades(); loadDashboard();

        } catch(err){
            toast('Error: '+err.message,'error');
            console.error(err);
        }
    };
    reader.readAsBinaryString(file);
}

// ── PDF EXPORT ───────────────────────────────────────────
function exportPDF(){
    window.print();
}

// ── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',async()=>{
    currentUser=await api('get_user')||{};
    const av=document.getElementById('sidebar-avatar');
    if(av){av.style.background=currentUser.avatar_color||'#4f7cff';av.textContent=(currentUser.display_name||currentUser.username||'U')[0].toUpperCase();}
    const un=document.getElementById('sidebar-username');
    if(un) un.textContent=currentUser.display_name||currentUser.username;
    const prop=document.getElementById('sidebar-prop');
    if(prop) prop.textContent=currentUser.prop_firm||'BitFunded';

    // Hamburger
    document.getElementById('hamburger-btn')?.addEventListener('click',()=>{
        document.querySelector('.sidebar').classList.toggle('open');
    });

    showPage('dashboard');
});
