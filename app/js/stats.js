
/**
 * FundedControl — Stats Module (v3.0.0 Phase 2)
 * Statistics page rendering
 */

async function loadStats(){
    const m=document.getElementById('stat-month')?.value||'';
    const y=document.getElementById('stat-year')?.value||'';
    const s=await api('get_stats'+(m&&y?`&month=${m}&year=${y}`:''));
    renderScopeCaption('stats-scope-caption', s);
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
    tbodyFn('s-fib-tbody',(s.by_fib||[]).map(r=>{
        const wr = r.trades>0?fmtPct(r.wins/r.trades*100):'0%';
        // Muted color alone reads as "real data, just deemphasized" — italic + a leading
        // "≈" (approximately/unreliable) makes a non-conclusive row visibly unlike a
        // normal percentage, matching the hatched-bar treatment on the dashboard chart.
        const winCell = r.conclusive
            ? wr
            : `<span style="color:var(--text3);font-style:italic" title="Early signal — based on ${r.based_on_n} trade${r.based_on_n===1?'':'s'}, not yet conclusive">≈ ${wr} *</span>`;
        return `<tr><td style="color:var(--purple)">${r.fib_level}</td><td>${r.trades}</td><td>${winCell}</td><td class="${pnlCls(r.pnl)}">${fmt(r.pnl)}</td></tr>`;
    }).join(''));
    const fibFootnote = document.getElementById('s-fib-footnote');
    if (fibFootnote) {
        const anyEarly = (s.by_fib||[]).some(r=>!r.conclusive);
        const cov = s.fib_coverage || {};
        const lines = [];
        if (anyEarly) lines.push('* early signal — fewer than 8 trades, not yet conclusive');
        if (cov.total) lines.push(`Recorded on ${cov.recorded} of ${cov.total} closed trades.`);
        fibFootnote.textContent = lines.join(' — ');
    }
    tbodyFn('s-pair-tbody',(s.by_pair||[]).map(r=>`<tr><td style="font-weight:600">${r.pair}</td><td>${r.trades}</td><td>${r.trades>0?fmtPct(r.wins/r.trades*100):'0%'}</td><td class="${pnlCls(r.pnl)}">${fmt(r.pnl)}</td></tr>`).join(''));
    tbodyFn('s-dir-tbody',(s.by_direction||[]).map(r=>`<tr><td>${r.direction==='Long'?'<span class="badge badge-long">Long</span>':'<span class="badge badge-short">Short</span>'}</td><td>${r.trades}</td><td>${r.trades>0?fmtPct(r.wins/r.trades*100):'0%'}</td><td class="${pnlCls(r.pnl)}">${fmt(r.pnl)}</td></tr>`).join(''));
}
