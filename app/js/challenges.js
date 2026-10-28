
/**
 * FundedControl — Challenges Module (v3.0.0 Phase 2)
 * Challenge CRUD, switcher, sidebar updates
 */

async function loadChallenges(){
    allChallenges=await api('get_challenges');
    const list=document.getElementById('challenges-list');
    if(!allChallenges.length){
        list.innerHTML='<div class="card" style="text-align:center;padding:40px"><div style="font-size:40px;margin-bottom:12px">🏆</div><div style="color:var(--text3);margin-bottom:16px">No challenges yet. Create your first one!</div><button class="btn btn-success" onclick="openChallengeModal()">+ Create Challenge</button></div>';
        return;
    }
    list.innerHTML=allChallenges.map(ch=>{
        const statusColors={active:'var(--green)',completed:'var(--blue)',failed:'var(--red)'};
        const statusColor=statusColors[ch.status]||'var(--text3)';
        return `<div class="card" style="margin-bottom:10px;${ch.is_active==1?'border-color:var(--green)':''}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                        ${ch.is_active==1?'<span style="background:var(--green);color:#000;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:1px">Active</span>':''}
                        <span style="font-family:var(--font-head);font-size:13px;letter-spacing:0.5px">${ch.name}</span>
                    </div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text2)">
                        <span>${ch.prop_firm||'No firm'}</span>
                        <span style="color:${statusColor}">${ch.status}</span>
                        <span>${ch.challenge_phase}</span>
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center">
                    <div style="text-align:right;margin-right:8px">
                        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Balance</div>
                        <div style="font-family:var(--font-head);font-size:16px;color:var(--green)">$${parseFloat(ch.current_balance).toFixed(2)}</div>
                    </div>
                    ${ch.is_active==1?'':`<button class="btn btn-success btn-sm" onclick="switchChallengeById(${ch.id})" title="Switch to this challenge">✅ Activate</button>`}
                    <button class="btn btn-ghost btn-sm" onclick="editChallenge(${ch.id})" title="Edit">✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteChallenge(${ch.id})" title="Delete">🗑</button>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px">
                <div style="background:var(--bg3);padding:8px;border-radius:6px;text-align:center"><div style="font-size:9px;color:var(--text3);margin-bottom:2px">Starting</div><div style="font-family:var(--font-head);font-size:12px">$${parseFloat(ch.starting_balance).toFixed(0)}</div></div>
                <div style="background:var(--bg3);padding:8px;border-radius:6px;text-align:center"><div style="font-size:9px;color:var(--text3);margin-bottom:2px">Max DD</div><div style="font-family:var(--font-head);font-size:12px;color:var(--red)">${ch.max_drawdown_pct}%</div></div>
                <div style="background:var(--bg3);padding:8px;border-radius:6px;text-align:center"><div style="font-size:9px;color:var(--text3);margin-bottom:2px">Daily Limit</div><div style="font-family:var(--font-head);font-size:12px;color:var(--orange)">$${parseFloat(ch.daily_loss_limit).toFixed(0)}</div></div>
                <div style="background:var(--bg3);padding:8px;border-radius:6px;text-align:center"><div style="font-size:9px;color:var(--text3);margin-bottom:2px">Risk/Trade</div><div style="font-family:var(--font-head);font-size:12px;color:var(--blue2)">${ch.risk_per_trade_pct}%</div></div>
                <div style="background:var(--bg3);padding:8px;border-radius:6px;text-align:center"><div style="font-size:9px;color:var(--text3);margin-bottom:2px">Target</div><div style="font-family:var(--font-head);font-size:12px;color:var(--green)">${ch.profit_target_pct}%</div></div>
            </div>
        </div>`;
    }).join('');
}

function openChallengeModal(data=null){
    document.getElementById('ch-id').value=data?.id||'';
    document.getElementById('challenge-modal-title').textContent=data?'✏️ EDIT CHALLENGE':'🏆 NEW CHALLENGE';
    const fields=['name','prop_firm','challenge_phase','starting_balance','max_drawdown_pct','drawdown_type','daily_loss_limit','risk_per_trade_pct','profit_target_pct','default_leverage','status'];
    if(data){
        fields.forEach(k=>{ const el=document.getElementById('ch-'+k); if(el&&data[k]!==null) el.value=data[k]; });
    } else {
        document.getElementById('ch-name').value='';
        document.getElementById('ch-prop_firm').value='';
        document.getElementById('ch-challenge_phase').value='Phase 1';
        document.getElementById('ch-starting_balance').value='10000';
        document.getElementById('ch-max_drawdown_pct').value='10';
        document.getElementById('ch-drawdown_type').value='static';
        document.getElementById('ch-daily_loss_limit').value='500';
        document.getElementById('ch-risk_per_trade_pct').value='0.5';
        document.getElementById('ch-profit_target_pct').value='8';
        document.getElementById('ch-default_leverage').value='';
        document.getElementById('ch-status').value='active';
    }

    // v3.27.2 — the seed-ladder input (new challenge, one required tier) and the full
    // Risk Ladder editor (existing challenge) are mutually exclusive: a brand-new
    // challenge has no id to look tiers up against yet, and an existing one already has
    // whatever add() seeded it with, so the "type one % and we seed it" flow never
    // applies to it again.
    const seedWrap = document.getElementById('ch-seed-ladder-wrap');
    const editorWrap = document.getElementById('ch-ladder-editor-wrap');
    document.getElementById('ch-ladder-error').style.display = 'none';
    if (data) {
        seedWrap.style.display = 'none';
        editorWrap.style.display = 'block';
        loadLadderEditor(data.id);
    } else {
        seedWrap.style.display = 'block';
        editorWrap.style.display = 'none';
        document.getElementById('ch-seed-ladder-risk-pct').value = '';
        _ladderRows = [];
        _ladderChallengeId = null;
    }

    document.getElementById('challenge-modal').classList.add('open');
}

function editChallenge(id){
    const ch=allChallenges.find(c=>c.id==id);
    if(ch) openChallengeModal(ch);
}

async function saveChallenge(){
    const id=document.getElementById('ch-id').value;
    const data={};
    ['name','prop_firm','challenge_phase','starting_balance','max_drawdown_pct','drawdown_type','daily_loss_limit','risk_per_trade_pct','profit_target_pct','default_leverage','status'].forEach(k=>{
        data[k]=document.getElementById('ch-'+k)?.value||null;
    });
    if(!data.name){toast('Challenge name is required','error');return;}
    if(id){
        data.id=id;
    } else {
        // v3.27.2 — no hidden default: add_challenge rejects a missing/zero value
        // server-side too, but failing fast here with a clear message is friendlier
        // than a round trip just to find out the one required field was left blank.
        const seedPct = document.getElementById('ch-seed-ladder-risk-pct').value;
        if (!seedPct || parseFloat(seedPct) <= 0) {
            toast('Set the initial risk ladder % — it applies from $0 with no upper limit', 'error');
            return;
        }
        data.ladder_risk_pct = seedPct;
    }
    data.set_active=!id?true:false;
    const r=await api(id?'update_challenge':'add_challenge','POST',data);
    if(r.error){toast(r.error,'error');return;}
    toast(id?'Challenge updated!':'Challenge created! ✅');
    document.getElementById('challenge-modal').classList.remove('open');
    loadChallenges();
    await refreshSidebarChallenges();
    currentUser=await api('get_user');
    if(!id) showPage('dashboard');
}

// ── RISK LADDER EDITOR (v3.27.2) ────────────────────────────
// In-memory working copy of the challenge currently open in the modal's ladder editor.
// Each row only ever stores upper_balance/risk_pct — lower_balance is never typed, it's
// always derived from the previous row's upper (0 for row 0), which is what makes a gap
// or overlap impossible to create in this editor rather than just caught on save.
let _ladderRows = [];
let _ladderChallengeId = null;

async function loadLadderEditor(challengeId){
    _ladderChallengeId = challengeId;
    const r = await api('get_ladder_tiers&challenge_id=' + challengeId);
    if (r.error) { _ladderRows = []; renderLadderEditorRows(); return; }
    _ladderRows = (r.tiers || []).map(t => ({ upper_balance: t.upper_balance, risk_pct: t.risk_pct }));
    renderLadderEditorRows();
}

function renderLadderEditorRows(){
    const wrap = document.getElementById('ch-ladder-rows');
    if (!_ladderRows.length) {
        wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:6px 0">No tiers yet — click + Add Tier.</div>';
        return;
    }
    let lower = 0;
    wrap.innerHTML = _ladderRows.map((r, i) => {
        const rowLower = lower;
        const isLast = i === _ladderRows.length - 1;
        lower = isLast ? null : parseFloat(r.upper_balance || 0);
        return `<div style="display:grid;grid-template-columns:90px 1fr 90px 32px;gap:8px;align-items:center;margin-bottom:6px">
            <div style="font-family:var(--font-head);font-size:12px;color:var(--text3)">$${fmtNum(rowLower)}</div>
            ${isLast
                ? `<div style="font-size:12px;color:var(--text3)">and above (no limit)</div>`
                : `<input type="number" step="0.01" placeholder="upper $" value="${r.upper_balance ?? ''}" onchange="onLadderRowUpperChange(${i},this.value)" style="width:100%">`}
            <input type="number" step="0.01" placeholder="risk %" value="${r.risk_pct ?? ''}" oninput="onLadderRowRiskChange(${i},this.value)" style="width:100%">
            <button type="button" class="btn btn-ghost btn-sm" onclick="removeLadderTierRow(${i})" title="Remove">🗑</button>
        </div>`;
    }).join('');
}

// Upper changes the NEXT row's displayed lower balance, so this one re-renders (onchange,
// not oninput — fires on blur, not every keystroke, so typing isn't interrupted).
function onLadderRowUpperChange(i, val){
    _ladderRows[i].upper_balance = val === '' ? null : val;
    renderLadderEditorRows();
}
// Risk % never affects another row's display, so this updates the model without a
// re-render (oninput is safe here — no risk of losing focus/cursor mid-type).
function onLadderRowRiskChange(i, val){
    _ladderRows[i].risk_pct = val;
}

function addLadderTierRow(){
    _ladderRows.push({ upper_balance: null, risk_pct: '' });
    renderLadderEditorRows();
}

function removeLadderTierRow(i){
    _ladderRows.splice(i, 1);
    renderLadderEditorRows();
}

async function saveLadderTiers(){
    const errEl = document.getElementById('ch-ladder-error');
    errEl.style.display = 'none';
    let lower = 0;
    const tiers = _ladderRows.map((r, i) => {
        const isLast = i === _ladderRows.length - 1;
        const row = {
            lower_balance: lower,
            upper_balance: isLast ? null : (r.upper_balance === '' || r.upper_balance === null ? null : parseFloat(r.upper_balance)),
            risk_pct: r.risk_pct === '' ? null : parseFloat(r.risk_pct),
        };
        lower = row.upper_balance;
        return row;
    });
    const r = await api('save_ladder_tiers', 'POST', { challenge_id: _ladderChallengeId, tiers });
    if (r.error) { errEl.textContent = r.error; errEl.style.display = 'block'; return; }
    toast('Risk ladder saved! ✅');
    loadLadderEditor(_ladderChallengeId);
}

async function deleteChallenge(id){
    if(!confirm('Delete this challenge and ALL its trades? This cannot be undone.')) return;
    const r=await api('delete_challenge','POST',{id});
    if(r.error){toast(r.error,'error');return;}
    toast('Challenge deleted');
    loadChallenges();
    await refreshSidebarChallenges();
    currentUser=await api('get_user');
}

async function switchChallengeById(id){
    const r=await api('switch_challenge','POST',{id});
    if(r.error){toast(r.error,'error');return;}
    currentUser=await api('get_user');
    await refreshSidebarChallenges();
    toast('Switched challenge! ✅');
    loadChallenges();
    updateSidebarFromUser();
}

async function switchChallenge(id){
    if(!id) return;
    await switchChallengeById(id);
    showPage('dashboard');
}

function updateSidebarFromUser(){
    const u=currentUser;
    const av=document.getElementById('sidebar-avatar');
    if(av){av.style.background=u.avatar_color||'#4f7cff';av.textContent=(u.display_name||u.username||'U')[0].toUpperCase();}
    const un=document.getElementById('sidebar-username');
    if(un) un.textContent=u.display_name||u.username;
    const prop=document.getElementById('sidebar-prop');
    if(prop) prop.textContent=u.prop_firm||u.active_challenge_name||'';
    document.getElementById('sidebar-balance').textContent='$'+parseFloat(u.account_balance||10000).toFixed(2);

    // v3.28.0 — dd-fill/dd-label/dd-max-label used to only ever get set inside
    // dashboard.js::loadDashboard(), so a session that opened on any other page first
    // left them stuck on index.php's own literal "DD: 0%" placeholder. This function
    // already runs on every page load (app.js's DOMContentLoaded calls it right after
    // get_user resolves), so it's the one place guaranteed to run regardless of which
    // page loads first. u.dd_pct comes from the same staticDrawdownPct() helper
    // StatsController's own sidebar figure already used -- one formula, not a second copy.
    const ddPct = Math.min(100, parseFloat(u.dd_pct||0));
    const ddFill = document.getElementById('dd-fill');
    if(ddFill){
        ddFill.style.width = ddPct+'%';
        ddFill.style.background = ddPct>80?'var(--red)':ddPct>50?'var(--orange)':'var(--green)';
    }
    const ddLabel = document.getElementById('dd-label');
    if(ddLabel) ddLabel.textContent = `DD: ${ddPct.toFixed(1)}%`;
    const ddMax = document.getElementById('dd-max-label');
    if(ddMax) ddMax.textContent = `${u.max_drawdown_pct||10}% max`;
}

async function refreshSidebarChallenges(){
    const challenges=await api('get_challenges');
    allChallenges=challenges;
    const sel=document.getElementById('sidebar-challenge-select');
    if(!sel) return;
    sel.innerHTML=challenges.map(ch=>
        `<option value="${ch.id}" ${ch.is_active==1?'selected':''}>${ch.name}${ch.is_active==1?' ✅':''}</option>`
    ).join('');
}
