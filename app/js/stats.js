
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
    set('s-netpnl',fmt(s.net_pnl));
    set('s-funding',fmt(-Math.abs(s.funding_adjustment||0)));
    set('s-net-after-funding',fmt(s.net_pnl_after_funding));
    set('s-avgwin',fmt(s.avg_win));
    set('s-avgloss',fmt(s.avg_loss)); set('s-avgr',fmtR(s.avg_r));
    set('s-pf',s.profit_factor);
    set('s-maxdd',s.max_drawdown_pct?.toFixed(2)+'%');
    set('s-curdd',s.current_drawdown_pct?.toFixed(2)+'%');
    set('s-curdd-type', s.drawdown_type==='trailing' ? '(trailing, from equity peak)' : '(static, from starting balance)');
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
    tbodyFn('s-exit-reason-tbody',(s.by_exit_reason||[]).map(r=>`<tr><td>${r.exit_reason}</td><td>${r.trades}</td><td style="color:${r.avg_r!==null&&parseFloat(r.avg_r)>=0?'var(--green)':'var(--red)'}">${r.avg_r!==null?fmtR(r.avg_r):'—'}</td><td style="color:${r.total_r!==null&&parseFloat(r.total_r)>=0?'var(--green)':'var(--red)'}">${r.total_r!==null?fmtR(r.total_r):'—'}</td><td class="${pnlCls(r.pnl)}">${fmt(r.pnl)}</td></tr>`).join(''));
    // v3.15.0 Phase 1, Step 0 finding: this table sums net_pnl per trade, which nets out
    // fees but structurally can't include the challenge-level funding fee (not a trades
    // column, never attributed to a single trade — see CLAUDE.md v3.14.0). Caption it so
    // the gap against Realised P&L doesn't look like a bug every time someone totals it.
    const exitFootnote = document.getElementById('s-exit-reason-footnote');
    if (exitFootnote) {
        const funding = s.exit_reason_excludes_funding || 0;
        exitFootnote.textContent = funding !== 0
            ? `Excludes a $${Math.abs(funding).toFixed(2)} challenge-level funding fee, applied once at the account level rather than per trade — true realised P&L is lower than this table's total by that amount.`
            : '';
    }

    // Size Integrity (v3.15.0 Phase 1)
    const NA = 'UNAVAILABLE';
    const si = s.size_integrity || {};
    set('si-dpr-winners', si.dollars_per_R_winners===NA||si.dollars_per_R_winners==null ? '—' : fmt(si.dollars_per_R_winners));
    set('si-dpr-losers', si.dollars_per_R_losers===NA||si.dollars_per_R_losers==null ? '—' : fmt(si.dollars_per_R_losers));
    set('si-skew', si.size_skew===NA||si.size_skew==null ? '—' : si.size_skew+'×');
    set('si-resolved-n', si.resolved_n ?? 0);
    set('si-adherence', si.ladder_adherence_rate===NA||si.ladder_adherence_rate==null ? '—' : fmtPct(si.ladder_adherence_rate));
    set('si-breaches', si.tier_breach_count===NA||si.tier_breach_count==null ? '—' : si.tier_breach_count);
    set('si-worst-dev', si.worst_deviation===NA||si.worst_deviation==null ? '—' : si.worst_deviation+'%');
    set('si-sized-n', si.sized_n ?? 0);

    const skewNote = document.getElementById('si-skew-note');
    if (skewNote) {
        if (si.size_skew !== NA && si.size_skew != null && si.size_skew > 1.15) {
            skewNote.textContent = `⚠️ Losers sized ${((si.size_skew-1)*100).toFixed(1)}% above winners.`;
            skewNote.style.color = 'var(--red)';
        } else if (si.size_skew !== NA && si.size_skew != null) {
            skewNote.textContent = '✅ Winners and losers sized consistently.';
            skewNote.style.color = 'var(--green)';
        } else {
            skewNote.textContent = `Needs 10 resolved trades minimum (has ${si.resolved_n||0}).`;
            skewNote.style.color = 'var(--text3)';
        }
    }

    const siMonthTbody = document.getElementById('si-month-tbody');
    if (siMonthTbody) {
        const months = si.deviation_by_month || [];
        siMonthTbody.innerHTML = months.length
            ? months.map(r=>`<tr><td>${r.month}</td><td>${r.n}</td><td style="color:${r.avg_deviation_pct>=0?'var(--red)':'var(--green)'}">${r.avg_deviation_pct>=0?'+':''}${r.avg_deviation_pct}%</td></tr>`).join('')
            : '<tr><td colspan="3" style="color:var(--text3)">No sized trades yet</td></tr>';
    }
}
