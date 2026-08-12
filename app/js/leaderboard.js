
/**
 * FundedControl — Strategy Leaderboard Module
 * Automatic ranking from real trades only. Sample-size guard: strategies
 * under the server's minimum trade count render in the "gathering" bucket.
 */
let leaderboardData = { ranked: [], gathering: [], min_ranked_trades: 20, min_split_trades: 8 };

async function loadLeaderboard(){
    leaderboardData = await api('get_leaderboard');
    renderLeaderboard();
}

function renderLeaderboard(){
    const tbody = document.getElementById('leaderboard-tbody');
    const ranked = leaderboardData.ranked || [];
    if(!ranked.length){
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="empty-icon">🏆</div><p>No ranked strategies yet — need ${leaderboardData.min_ranked_trades}+ real trades per strategy.</p></div></td></tr>`;
    } else {
        tbody.innerHTML = ranked.map((r,i)=>`
            <tr>
                <td style="font-family:var(--font-head);font-size:12px">${i===0?'🥇 ':''}${r.name}</td>
                <td>${r.trade_count}</td>
                <td style="color:var(--green)">${r.win_rate}%</td>
                <td style="font-family:var(--font-mono);color:${r.avg_r>=0?'var(--green)':'var(--red)'}">${r.avg_r}R</td>
                <td style="font-family:var(--font-mono)">${r.profit_factor===null?(r.wins>0?'∞':'—'):r.profit_factor}</td>
                <td style="font-family:var(--font-mono);font-weight:600;color:${r.expectancy_r>=0?'var(--green)':'var(--red)'}">${r.expectancy_r}R</td>
                <td><button class="btn btn-ghost btn-sm" onclick="toggleLeaderboardDetail(${r.strategy_id})">Details</button></td>
            </tr>
            <tr id="lb-detail-${r.strategy_id}" style="display:none"><td colspan="7">${renderLeaderboardDetail(r)}</td></tr>
        `).join('');
    }

    const gWrap = document.getElementById('leaderboard-gathering');
    const gathering = leaderboardData.gathering || [];
    if(!gathering.length){ gWrap.innerHTML=''; return; }
    gWrap.innerHTML = `<div class="card">
        <div class="card-title">Still Gathering Data</div>
        ${gathering.map(g=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <span>${g.name}</span>
            <span style="font-size:12px;color:var(--text3)">${g.trade_count}/${leaderboardData.min_ranked_trades} trades — ${g.needed} more until ranked</span>
        </div>`).join('')}
    </div>`;
}

function renderLeaderboardDetail(r){
    const driverVar = r.biggest_driver ? (r.variable_attribution||[]).find(v=>v.variable_id===r.biggest_driver) : null;
    const driverNote = driverVar
        ? `<div style="margin-bottom:10px;font-size:12px;color:var(--blue)">⭐ Biggest driver: <strong>${driverVar.label}</strong></div>`
        : `<div style="margin-bottom:10px;font-size:12px;color:var(--text3)">No variable shows a meaningful win-rate spread yet (needs ≥ ${leaderboardData.min_split_trades} trades per value).</div>`;

    const varsHtml = (r.variable_attribution||[]).map(v=>`
        <div style="margin-bottom:10px">
            <div style="font-size:12px;font-weight:600;margin-bottom:4px">${v.label}${r.biggest_driver===v.variable_id?' ⭐':''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${v.splits.map(s=>`<div style="background:var(--bg3);border-radius:6px;padding:6px 10px;font-size:11px">
                    <div style="color:var(--text3)">${s.value} (${s.trade_count})</div>
                    <div style="font-family:var(--font-mono);font-weight:600">${s.has_enough_data?s.win_rate+'%':'not enough data'}</div>
                </div>`).join('')}
            </div>
        </div>
    `).join('') || '<div style="font-size:12px;color:var(--text3)">This strategy has no custom variables yet.</div>';

    const legacyHtml = (r.legacy_fsa_adherence||[]).length ? `
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">
            <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Legacy FSA Rules Adherence (count only — cannot attribute to a specific rule)</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${r.legacy_fsa_adherence.map(g=>`<div style="background:var(--bg3);border-radius:6px;padding:6px 10px;font-size:11px">
                    <div style="color:var(--text3)">${g.value} (${g.trade_count})</div>
                    <div style="font-family:var(--font-mono);font-weight:600">${g.has_enough_data?g.win_rate+'%':'not enough data'}</div>
                </div>`).join('')}
            </div>
        </div>` : '';

    return `<div style="padding:14px;background:var(--bg3);border-radius:8px">
        ${driverNote}
        ${varsHtml}
        ${legacyHtml}
    </div>`;
}

function toggleLeaderboardDetail(strategyId){
    const row = document.getElementById('lb-detail-'+strategyId);
    if(!row) return;
    row.style.display = row.style.display==='none' ? '' : 'none';
}
