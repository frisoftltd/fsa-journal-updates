/**
 * FundedControl — Dashboard Module (v3.0.0 Phase 2)
 * KPIs, charts, calendar heatmap, hours heatmap
 */

// ── PATTERNS ─────────────────────────────────────────────
// Diagonal-hatch CanvasPattern for "not enough data yet" chart bars — Chart.js accepts a
// CanvasPattern anywhere a backgroundColor is valid, so this needs no plugin.
function hatchPattern(strokeColor) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 8); ctx.lineTo(8, 0);
    ctx.moveTo(-2, 2); ctx.lineTo(2, -2);
    ctx.moveTo(6, 10); ctx.lineTo(10, 6);
    ctx.stroke();
    return ctx.createPattern(c, 'repeat');
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

    renderScopeCaption('dash-scope-caption', s);
    const set = (id,val,cls='')=>{const el=document.getElementById(id);if(el){el.textContent=val;if(cls)el.className='kpi-val '+cls;}};
    set('kpi-trades',s.total_trades,'blue');
    set('kpi-winrate',fmtPct(s.win_rate),s.win_rate>=50?'green':'red');
    set('kpi-pnl',fmt(s.net_pnl),parseFloat(s.net_pnl)>=0?'green':'red');
    set('kpi-fees',fmt(s.total_fees),'red');
    set('kpi-r',fmtR(s.avg_r),parseFloat(s.avg_r)>=0?'green':'red');
    set('kpi-pf',parseFloat(s.profit_factor).toFixed(2),'orange');

    // u.account_balance is already the fully-derived current balance (starting_balance +
    // realised net P&L - funding_adjustment, computed server-side in
    // helpers.php::enrichChallenge()) — adding s.net_pnl again here used to double-count
    // every closed trade's result on top of an already-correct number (part of the
    // $626 dashboard error described in CLAUDE.md v3.13.0).
    const bal = parseFloat(u.account_balance||10000);
    document.getElementById('sidebar-balance').textContent = '$'+bal.toFixed(2);

    const ddPct = Math.min(100, parseFloat(s.dd_pct||0));
    const ddFill = document.getElementById('dd-fill');
    if(ddFill){
        ddFill.style.width = ddPct+'%';
        ddFill.style.background = ddPct>80?'var(--red)':ddPct>50?'var(--orange)':'var(--green)';
    }
    const ddLabel = document.getElementById('dd-label');
    if(ddLabel) ddLabel.textContent = `DD: ${ddPct.toFixed(1)}%`;
    const ddMax = document.getElementById('dd-max-label');
    if(ddMax) ddMax.textContent = `${u.max_drawdown_pct||10}% max`;

    const str = s.streak||{};
    const strEl = document.getElementById('kpi-streak');
    if(strEl) strEl.textContent = str.current ? `${str.current} ${str.type}${str.current>1?'s':''}` : '—';

    destroyCharts('donut','line','barPnl','barFib','barSession','drawdown');
    const co = chartOpts();
    const noLegend = {...co, plugins:{legend:{display:false}}};

    charts.donut = new Chart(document.getElementById('chart-donut'),{
        type:'doughnut',
        data:{labels:['Wins','Losses','Break Even'],datasets:[{data:[s.wins,s.losses,s.break_evens],backgroundColor:['#0FA958','#DC3545','#F59E0B'],borderWidth:0,hoverOffset:6}]},
        options:{...co,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:'#6C7A8D',padding:10,font:{size:11}}}}}
    });

    const cum=s.cumulative||[];
    charts.line = new Chart(document.getElementById('chart-cumulative'),{
        type:'line',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{label:'Cumulative P&L',data:cum.map(t=>t.cumulative),borderColor:'#1A56DB',backgroundColor:'rgba(26,86,219,0.08)',fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#1A56DB'}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#6C7A8D',font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}},y:{ticks:{color:'#6C7A8D',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}}}}
    });

    charts.drawdown = new Chart(document.getElementById('chart-drawdown'),{
        type:'line',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{label:'Drawdown %',data:cum.map(t=>-t.drawdown),borderColor:'#DC3545',backgroundColor:'rgba(220,53,69,0.08)',fill:true,tension:0.4,pointRadius:2}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#6C7A8D',font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}},y:{ticks:{color:'#6C7A8D',callback:v=>v+'%',font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}}}}
    });

    charts.barPnl = new Chart(document.getElementById('chart-pnl'),{
        type:'bar',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{data:cum.map(t=>t.net_pnl),backgroundColor:cum.map(t=>t.net_pnl>=0?'rgba(15,169,88,0.7)':'rgba(220,53,69,0.7)'),borderRadius:3}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#6C7A8D',font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}},y:{ticks:{color:'#6C7A8D',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}}}}
    });

    const sess=s.by_session||[];
    charts.barSession = new Chart(document.getElementById('chart-session'),{
        type:'bar',
        data:{labels:sess.map(s=>s.session),datasets:[{label:'Net P&L',data:sess.map(s=>s.pnl),backgroundColor:['#1A56DB','#0FA958','#7C3AED'],borderRadius:4}]},
        options:{...co,scales:{x:{ticks:{color:'#6C7A8D',font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}},y:{ticks:{color:'#6C7A8D',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}}}}
    });

    const fib=s.by_fib||[];
    charts.barFib = new Chart(document.getElementById('chart-fib'),{
        type:'bar',
        data:{
            labels:fib.map(f=>`${f.fib_level} (n=${f.based_on_n ?? f.trades})`),
            datasets:[{
                label:'Win Rate %',
                data:fib.map(f=>f.trades>0?Math.round(f.wins/f.trades*100):0),
                // Early-signal buckets (same conclusive/based_on_n convention as
                // ReviewEngineController::insight()) get a hatch pattern instead of a
                // solid fill — a lighter shade of the same purple still reads as "real
                // data, just dimmer"; a bucket whose character can flip on one trade
                // needs to look visibly unlike a normal bar, not just paler.
                backgroundColor:fib.map(f=>f.conclusive?'rgba(124,58,237,0.75)':hatchPattern('rgba(124,58,237,0.55)')),
                borderColor:fib.map(f=>f.conclusive?'rgba(124,58,237,0.75)':'rgba(124,58,237,0.55)'),
                borderWidth:fib.map(f=>f.conclusive?0:1),
                borderRadius:4
            }]
        },
        options:{...co,plugins:{...co.plugins,tooltip:{callbacks:{label:ctx=>{
            const f=fib[ctx.dataIndex];
            const n=f.based_on_n ?? f.trades;
            return `Win Rate: ${ctx.parsed.y}% (n=${n}${f.conclusive?'':', early signal — not yet conclusive'})`;
        }}}},scales:{x:{ticks:{color:'#6C7A8D',font:{size:10}},grid:{color:'rgba(0,0,0,0.06)'}},y:{ticks:{color:'#6C7A8D',callback:v=>v+'%',font:{size:10}},max:100,grid:{color:'rgba(0,0,0,0.06)'}}}}
    });
    const fibFootnote = document.getElementById('chart-fib-footnote');
    if (fibFootnote) {
        const anyEarly = fib.some(f=>!f.conclusive);
        const cov = s.fib_coverage || {};
        const lines = [];
        if (anyEarly) lines.push('Hatched bars are early signal — fewer than 8 trades, not yet conclusive.');
        if (cov.total) lines.push(`Recorded on ${cov.recorded} of ${cov.total} closed trades.`);
        fibFootnote.textContent = lines.join(' ');
    }

    renderCalendar(s.calendar||[]);
    renderHoursHeatmap(s.by_hour||[]);
}

// ── CALENDAR HEATMAP ─────────────────────────────────────
function renderCalendar(data) {
    const wrap = document.getElementById('calendar-wrap');
    if(!wrap) return;
    const map = {};
    data.forEach(d=>{ map[d.trade_date]={pnl:parseFloat(d.pnl),trades:d.trades}; });
    const maxAbs = Math.max(...data.map(d=>Math.abs(parseFloat(d.pnl))),1);
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
            let bg = '#E2E8F0';
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
        const color = info.pnl>0?'rgba(15,169,88,0.5)':info.pnl<0?'rgba(220,53,69,0.5)':'rgba(0,0,0,0.06)';
        const label = h===0?'12a':h<12?h+'a':h===12?'12p':(h-12)+'p';
        return `<div class="heatmap-col">
            <div class="heatmap-bar" style="height:${height}px;background:${color}" title="${h}:00 — ${info.trades} trades, P&L: ${fmt(info.pnl)}"></div>
            <div class="heatmap-label">${label}</div>
        </div>`;
    }).join('');
}
