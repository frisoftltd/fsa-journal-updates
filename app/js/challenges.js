
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
    const fields=['name','prop_firm','challenge_phase','starting_balance','current_balance','max_drawdown_pct','daily_loss_limit','risk_per_trade_pct','profit_target_pct','status'];
    if(data){
        fields.forEach(k=>{ const el=document.getElementById('ch-'+k); if(el&&data[k]!==null) el.value=data[k]; });
    } else {
        document.getElementById('ch-name').value='';
        document.getElementById('ch-prop_firm').value='';
        document.getElementById('ch-challenge_phase').value='Phase 1';
        document.getElementById('ch-starting_balance').value='10000';
        document.getElementById('ch-current_balance').value='10000';
        document.getElementById('ch-max_drawdown_pct').value='10';
        document.getElementById('ch-daily_loss_limit').value='500';
        document.getElementById('ch-risk_per_trade_pct').value='0.5';
        document.getElementById('ch-profit_target_pct').value='8';
        document.getElementById('ch-status').value='active';
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
    ['name','prop_firm','challenge_phase','starting_balance','current_balance','max_drawdown_pct','daily_loss_limit','risk_per_trade_pct','profit_target_pct','status'].forEach(k=>{
        data[k]=document.getElementById('ch-'+k)?.value||null;
    });
    if(!data.name){toast('Challenge name is required','error');return;}
    if(id) data.id=id;
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
