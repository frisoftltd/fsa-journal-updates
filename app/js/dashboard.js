
/**
 * FundedControl — Dashboard Module (v3.0.0 Phase 2)
 * KPIs, charts, calendar heatmap, hours heatmap
 */

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

    const set = (id,val,cls='')=>{const el=document.getElementById(id);if(el){el.textContent=val;if(cls)el.className='kpi-val '+cls;}};
    set('kpi-trades',s.total_trades,'blue');
    set('kpi-winrate',fmtPct(s.win_rate),s.win_rate>=50?'green':'red');
    set('kpi-pnl',fmt(s.net_pnl),parseFloat(s.net_pnl)>=0?'green':'red');
    set('kpi-fees',fmt(s.total_fees),'red');
    set('kpi-r',fmtR(s.avg_r),parseFloat(s.avg_r)>=0?'green':'red');
    set('kpi-pf',parseFloat(s.profit_factor).toFixed(2),'orange');

    const bal = parseFloat(u.account_balance||10000)+parseFloat(s.net_pnl||0);
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
        data:{labels:['Wins','Losses','Break Even'],datasets:[{data:[s.wins,s.losses,s.break_evens],backgroundColor:['#00d4a0','#ff4d6d','#ffb347'],borderWidth:0,hoverOffset:6}]},
        options:{...co,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:'#8892b0',padding:10,font:{size:11}}}}}
    });

    const cum=s.cumulative||[];
    charts.line = new Chart(document.getElementById('chart-cumulative'),{
        type:'line',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{label:'Cumulative P&L',data:cum.map(t=>t.cumulative),borderColor:'#4f7cff',backgroundColor:'rgba(79,124,255,0.08)',fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#4f7cff'}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    charts.drawdown = new Chart(document.getElementById('chart-drawdown'),{
        type:'line',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{label:'Drawdown %',data:cum.map(t=>-t.drawdown),borderColor:'#ff4d6d',backgroundColor:'rgba(255,77,109,0.07)',fill:true,tension:0.4,pointRadius:2}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>v+'%',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    charts.barPnl = new Chart(document.getElementById('chart-pnl'),{
        type:'bar',
        data:{labels:cum.map(t=>'T'+t.trade),datasets:[{data:cum.map(t=>t.net_pnl),backgroundColor:cum.map(t=>t.net_pnl>=0?'rgba(0,212,160,0.7)':'rgba(255,77,109,0.7)'),borderRadius:3}]},
        options:{...noLegend,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    const sess=s.by_session||[];
    charts.barSession = new Chart(document.getElementById('chart-session'),{
        type:'bar',
        data:{labels:sess.map(s=>s.session),datasets:[{label:'Net P&L',data:sess.map(s=>s.pnl),backgroundColor:['#4f7cff','#00d4a0','#9b6dff'],borderRadius:4}]},
        options:{...co,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>'$'+v,font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

    const fib=s.by_fib||[];
    charts.barFib = new Chart(document.getElementById('chart-fib'),{
        type:'bar',
        data:{labels:fib.map(f=>f.fib_level),datasets:[{label:'Win Rate %',data:fib.map(f=>f.trades>0?Math.round(f.wins/f.trades*100):0),backgroundColor:'rgba(155,109,255,0.7)',borderRadius:4}]},
        options:{...co,scales:{x:{ticks:{color:'#4a5580',font:{size:10}},grid:{color:'rgba(255,255,255,0.03)'}},y:{ticks:{color:'#4a5580',callback:v=>v+'%',font:{size:10}},max:100,grid:{color:'rgba(255,255,255,0.03)'}}}}
    });

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
