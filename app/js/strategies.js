
/**
 * FundedControl — Strategy Lab Module
 * Dynamic strategy builder: CRUD strategies + any number of custom variables each
 */
let allStrategies = [];
let currentVarRows = [];
// v3.29.1 — modal-session state for the redesigned New/Edit Strategy modal. Kept as
// plain module state (not re-read from the DOM on every change) so toggling "All
// challenges" off and back on restores the exact previous tile selection, per the brief.
let sbAppliesAll = true;
let sbSelectedChallengeIds = [];
let sbEditingId = null;

// v3.29.0 (req #7) — this list is never scoped to any challenge, by design: it shows
// every strategy the user has, each with its own real assignment, so the Lab is the one
// place you can see and change the whole picture at once. allChallenges is the same
// shared global challenges.js's own sidebar code populates -- kept fresh here too so a
// strategy card's assignment names and the modal's own checkbox list always match
// whatever challenges actually exist right now.
async function loadStrategies(){
    const [strategies, challenges] = await Promise.all([api('get_strategies'), api('get_challenges')]);
    allStrategies = strategies;
    allChallenges = challenges;

    const caption = document.getElementById('strategy-lab-active-caption');
    if(caption){
        const activeCh = (allChallenges||[]).find(c=>c.is_active==1);
        caption.textContent = activeCh
            ? `Active challenge in the sidebar: "${activeCh.name}". Assigning challenges to a strategy below is independent of that selection — it only controls where a strategy can be used, not what you're currently viewing.`
            : '';
    }

    const list = document.getElementById('strategies-list');
    if(!allStrategies.length){
        list.innerHTML = `<div class="card" style="text-align:center;padding:40px">
            <div class="empty-icon">🧪</div>
            <div style="color:var(--text3);margin-bottom:16px">No strategies yet. Create your first one!</div>
            <button class="btn btn-success" onclick="openStrategyModal()">+ Create Strategy</button>
        </div>`;
        return;
    }
    list.innerHTML = allStrategies.map(st => `<div class="card" style="margin-bottom:10px;${st.is_active==1?'':'opacity:0.6'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    ${st.is_active==1
                        ? '<span style="background:var(--green);color:#000;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:1px">Active</span>'
                        : '<span style="background:var(--text3);color:#000;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:1px">Inactive</span>'}
                    <span style="font-family:var(--font-head);font-size:13px;letter-spacing:0.5px">${st.name}</span>
                </div>
                <div style="font-size:12px;color:var(--text2)">${(st.variables||[]).filter(v=>v.is_active==1).length} active variable${(st.variables||[]).filter(v=>v.is_active==1).length===1?'':'s'}${(st.variables||[]).some(v=>v.is_active==0)?` (${(st.variables||[]).filter(v=>v.is_active==0).length} inactive)`:''}</div>
                <div style="font-size:12px;color:var(--text2);margin-top:4px">Used on: ${strategyChallengeChips(st)}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <button class="btn btn-ghost btn-sm" onclick="openVariablesModal(${st.id})" title="Edit Variables">⚙️ Variables</button>
                <button class="btn btn-ghost btn-sm" onclick="toggleStrategyActive(${st.id},${st.is_active==1?0:1})" title="${st.is_active==1?'Deactivate':'Activate'}">${st.is_active==1?'⏸':'▶️'}</button>
                <button class="btn btn-ghost btn-sm" onclick="editStrategy(${st.id})" title="Rename">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="deleteStrategy(${st.id})" title="Delete">🗑</button>
            </div>
        </div>
    </div>`).join('');
}

// v3.29.1 — same wording/chip styling as the modal's own summary line (req #9), one
// place this gets worded rather than two independently-maintained copies.
function strategyChallengeChips(st){
    if(st.applies_all_challenges == 1){
        return `<span class="badge" style="background:rgba(79,124,255,0.15);color:var(--blue2)">All challenges</span>`;
    }
    const names = (st.challenge_ids||[]).map(id => (allChallenges||[]).find(c=>c.id==id)?.name).filter(Boolean);
    if(!names.length){
        return `<span class="badge" style="background:rgba(255,179,71,0.15);color:var(--orange)">Not assigned — hidden until reassigned</span>`;
    }
    return names.map(n => `<span class="badge" style="background:rgba(79,124,255,0.1);color:var(--text2);margin-right:4px">${escapeHtml(n)}</span>`).join('');
}

// v3.29.1 — redesigned New/Edit Strategy modal: a toggle switch for "All challenges"
// plus a grid of selectable challenge tiles, replacing the old misaligned checkbox
// list. `data == null` (missing field, e.g. a strategy read before this release's own
// migration ran) is treated the same as applies_all_challenges=1 -- "every strategy
// that existed before this release keeps working everywhere" is the whole point of
// that migration's DEFAULT 1, so a genuinely missing field should read the same way,
// not default to the opposite (scoped/unchecked).
function openStrategyModal(data=null){
    document.getElementById('sb-id').value = data?.id || '';
    document.getElementById('strategy-builder-modal-title').textContent = data ? 'Edit strategy' : 'New strategy';
    document.getElementById('sb-name').value = data?.name || '';

    sbEditingId = data?.id || null;
    sbAppliesAll = data ? (data.applies_all_challenges == null ? true : data.applies_all_challenges == 1) : true;
    sbSelectedChallengeIds = (data?.challenge_ids || []).slice();

    renderStrategyChallengeGrid();
    refreshStrategyModalState();
    document.getElementById('strategy-builder-modal').classList.add('open');
    document.getElementById('sb-name').focus();
}

function closeStrategyModal(){
    document.getElementById('strategy-builder-modal').classList.remove('open');
}

function toggleStrategyAppliesAll(){
    sbAppliesAll = !sbAppliesAll;
    refreshStrategyModalState();
}

// One place that re-syncs every piece of the modal's UI (toggle, tile disabled state,
// summary line, save button, cleared-default notice) after anything changes -- avoids
// four call sites each remembering their own subset of what needs updating.
function refreshStrategyModalState(){
    const toggle = document.getElementById('sb-applies-all');
    toggle.setAttribute('aria-checked', sbAppliesAll ? 'true' : 'false');

    const grid = document.getElementById('sb-challenge-list');
    grid.classList.toggle('sb-grid-dimmed', sbAppliesAll);
    grid.querySelectorAll('.sb-challenge-tile').forEach(t => {
        const disabled = sbAppliesAll;
        t.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        t.tabIndex = disabled ? -1 : 0;
    });

    updateStrategySaveState();
    updateStrategyDefaultNotice();
}

// req #7 — the picker shows exactly the same challenge list every other dropdown in
// the app reads (get_challenges, unfiltered -- there's no archived/hidden concept
// anywhere else in this app either, so there's nothing extra to exclude here).
function renderStrategyChallengeGrid(){
    const grid = document.getElementById('sb-challenge-list');
    const emptyNote = document.getElementById('sb-challenge-empty');
    if(!allChallenges || !allChallenges.length){
        grid.innerHTML = '';
        grid.style.display = 'none';
        emptyNote.style.display = 'block';
        return;
    }
    emptyNote.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = allChallenges.map(c => {
        const checked = sbSelectedChallengeIds.includes(c.id);
        const meta = [c.prop_firm, c.challenge_phase].filter(Boolean).join(' · ');
        return `<div class="sb-challenge-tile" role="checkbox" aria-checked="${checked}" tabindex="0" data-id="${c.id}"
                     onclick="toggleStrategyChallengeTile(${c.id})" onkeydown="handleStrategyTileKeydown(event,${c.id})">
            <span class="sb-tile-check" aria-hidden="true">${checked ? '✓' : ''}</span>
            <span class="sb-tile-text">
                <span class="sb-tile-name">${escapeHtml(c.name)}</span>
                ${meta ? `<span class="sb-tile-meta">${escapeHtml(meta)}</span>` : ''}
            </span>
        </div>`;
    }).join('');
}

// Mutates the one affected tile's own attributes in place rather than re-rendering the
// whole grid — a full re-render replaces every tile's DOM node, which silently drops
// keyboard focus (confirmed via the harness: Space to toggle a tile off worked, but a
// second Space/Enter right after did nothing, because the node that keydown fired on
// no longer existed by the time it bubbled). req #3's "keyboard operable" requirement
// means toggling can never cost the tile its own focus.
function toggleStrategyChallengeTile(id){
    if(sbAppliesAll) return; // dimmed/disabled while "All challenges" is on
    const idx = sbSelectedChallengeIds.indexOf(id);
    const nowChecked = idx === -1;
    if(nowChecked) sbSelectedChallengeIds.push(id); else sbSelectedChallengeIds.splice(idx, 1);

    const tile = document.querySelector(`.sb-challenge-tile[data-id="${id}"]`);
    if(tile){
        tile.setAttribute('aria-checked', nowChecked ? 'true' : 'false');
        const checkEl = tile.querySelector('.sb-tile-check');
        if(checkEl) checkEl.textContent = nowChecked ? '✓' : '';
    }
    refreshStrategyModalState();
}

// req #3 — space or enter toggles the tile, same as a real checkbox would.
function handleStrategyTileKeydown(e, id){
    if(e.key === ' ' || e.key === 'Enter'){
        e.preventDefault();
        toggleStrategyChallengeTile(id);
    }
}

// req #5 — Save is disabled until a name is present and either All is on or at least
// one tile is selected; the reason is always stated in words next to the button, never
// left as a silently-disabled control.
function updateStrategySaveState(){
    const name = document.getElementById('sb-name').value.trim();
    const n = sbSelectedChallengeIds.length;
    const summaryEl = document.getElementById('sb-summary');
    const saveBtn = document.getElementById('sb-save-btn');
    const reasonEl = document.getElementById('sb-save-reason');

    const scopeValid = sbAppliesAll || n > 0;
    summaryEl.textContent = sbAppliesAll
        ? 'Used on: All challenges'
        : (n > 0 ? `Used on: ${n} challenge${n === 1 ? '' : 's'}` : 'Select at least one challenge, or turn on All challenges');
    summaryEl.classList.toggle('sb-summary-warn', !scopeValid);

    const nameValid = name.length > 0;
    saveBtn.disabled = !nameValid || !scopeValid;
    reasonEl.textContent = !nameValid
        ? 'Enter a strategy name to save.'
        : (!scopeValid ? 'Select at least one challenge, or turn on All challenges.' : '');
}

// req #6 — the Phase-0 follow-up check, surfaced before saving rather than only after:
// a challenge whose default_strategy_id already points at this strategy, but which is
// about to be dropped from its assignment set, will have that default cleared on save
// (StrategyBuilderController::clearInvalidDefaultStrategyPointers()). Named explicitly,
// shown only when it will actually happen -- never a generic "this might affect
// something" warning.
function updateStrategyDefaultNotice(){
    const notice = document.getElementById('sb-default-notice');
    if(!sbEditingId || sbAppliesAll){ notice.style.display = 'none'; return; }

    const affected = (allChallenges || []).filter(c => c.default_strategy_id == sbEditingId && !sbSelectedChallengeIds.includes(c.id));
    if(!affected.length){ notice.style.display = 'none'; return; }

    const names = affected.map(c => c.name).join(', ');
    notice.textContent = `Heads up: ${names} currently use${affected.length === 1 ? 's' : ''} this strategy as the Pre-Trade Checklist default. Saving will clear that, since this strategy won't be assigned there anymore.`;
    notice.style.display = 'block';
}

function editStrategy(id){
    const st = allStrategies.find(s=>s.id==id);
    if(st) openStrategyModal(st);
}

async function saveStrategyMeta(){
    const id = document.getElementById('sb-id').value;
    const name = document.getElementById('sb-name').value.trim();
    if(!name){ toast('Strategy name is required','error'); return; }
    if(!sbAppliesAll && sbSelectedChallengeIds.length === 0){ toast('Select at least one challenge, or turn on All challenges','error'); return; }
    const data = { name, applies_all_challenges: sbAppliesAll, challenge_ids: sbSelectedChallengeIds };
    if(id) data.id = id;
    const r = await api(id ? 'update_strategy' : 'add_strategy', 'POST', data);
    if(r.error){ toast(r.error,'error'); return; }
    toast(id ? 'Strategy updated!' : 'Strategy created! ✅');
    closeStrategyModal();
    loadStrategies();
}

async function toggleStrategyActive(id, nextState){
    const r = await api('update_strategy','POST',{id, is_active: nextState});
    if(r.error){ toast(r.error,'error'); return; }
    loadStrategies();
}

async function deleteStrategy(id){
    if(!confirm('Delete this strategy and all its variables? This cannot be undone.')) return;
    const r = await api('delete_strategy','POST',{id});
    if(r.error){ toast(r.error,'error'); return; }
    toast('Strategy deleted');
    loadStrategies();
}

// ── VARIABLES EDITOR ──────────────────────────────────────
function openVariablesModal(strategyId){
    const st = allStrategies.find(s=>s.id==strategyId);
    if(!st) return;
    document.getElementById('sv-strategy-id').value = st.id;
    document.getElementById('sv-strategy-name').textContent = st.name;
    currentVarRows = (st.variables||[]).map(v=>({
        id: v.id, label:v.label, input_type:v.input_type, options:v.options||'',
        role: v.role || 'gate', timeframe: v.timeframe || '', criteria: v.criteria || '',
        is_active: v.is_active==0 ? 0 : 1
    }));
    renderVariableRows();
    document.getElementById('strategy-vars-modal').classList.add('open');
}

function renderVariableRows(){
    const wrap = document.getElementById('sv-rows');
    wrap.innerHTML = currentVarRows.map((v,i)=>`<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;${v.is_active?'':'opacity:0.55'}">
        <div class="form-grid-2" style="gap:8px;align-items:end">
            <div class="form-group"><label>Label</label><input type="text" value="${(v.label||'').replace(/"/g,'&quot;')}" oninput="updateVarRow(${i},'label',this.value)" placeholder="e.g. Confirmed 4H trend"></div>
            <div class="form-group"><label>Type</label><select onchange="updateVarRow(${i},'input_type',this.value)">
                <option value="checkbox" ${v.input_type==='checkbox'?'selected':''}>Yes/No</option>
                <option value="scale" ${v.input_type==='scale'?'selected':''}>1–5 Scale</option>
                <option value="select" ${v.input_type==='select'?'selected':''}>Dropdown</option>
                <option value="text" ${v.input_type==='text'?'selected':''}>Short text</option>
            </select></div>
            ${v.input_type==='select'?`<div class="form-group full"><label>Options (comma-separated)</label><input type="text" value="${(v.options||'').replace(/"/g,'&quot;')}" oninput="updateVarRow(${i},'options',this.value)" placeholder="e.g. London,New York,Tokyo"></div>`:''}
            <div class="form-group"><label>Role</label><select onchange="updateVarRow(${i},'role',this.value)">
                <option value="gate" ${v.role==='gate'?'selected':''}>Gate — mandatory pass/fail</option>
                <option value="tag" ${v.role==='tag'?'selected':''}>Tag — observed only</option>
            </select></div>
            <div class="form-group"><label>Timeframe</label><select onchange="updateVarRow(${i},'timeframe',this.value)">
                <option value="" ${!v.timeframe?'selected':''}>—</option>
                <option value="4H" ${v.timeframe==='4H'?'selected':''}>4H</option>
                <option value="1H" ${v.timeframe==='1H'?'selected':''}>1H</option>
                <option value="15M" ${v.timeframe==='15M'?'selected':''}>15M</option>
            </select></div>
            <div class="form-group full"><label>Criteria (shown to you on the pre-trade checklist)</label><textarea rows="2" oninput="updateVarRow(${i},'criteria',this.value)" placeholder="e.g. Price at 0.618 or 0.705 Fib level on 1H">${(v.criteria||'').replace(/</g,'&lt;')}</textarea></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)">
                <input type="checkbox" ${v.is_active?'checked':''} onchange="updateVarRow(${i},'is_active',this.checked?1:0)"> Active
            </label>
            <button class="btn btn-danger btn-sm" onclick="removeVariableRow(${i})">🗑 Remove</button>
        </div>
    </div>`).join('');
}

function updateVarRow(i, key, val){
    currentVarRows[i][key] = val;
    if(key==='input_type') renderVariableRows();
}

function addVariableRow(){
    currentVarRows.push({id:null, label:'', input_type:'checkbox', options:'', role:'gate', timeframe:'', criteria:'', is_active:1});
    renderVariableRows();
}

function removeVariableRow(i){
    if(!confirm('Remove this variable? If it has recorded trade history it will be deactivated instead of deleted.')) return;
    currentVarRows.splice(i,1);
    renderVariableRows();
}

async function saveVariables(){
    const strategyId = document.getElementById('sv-strategy-id').value;
    const variables = currentVarRows
        .filter(v=>v.label && v.label.trim() !== '')
        .map((v,i)=>({
            id: v.id || null,
            label: v.label.trim(),
            input_type: v.input_type,
            options: v.input_type==='select' ? (v.options||'') : null,
            role: v.role || 'gate',
            timeframe: v.timeframe || null,
            criteria: v.criteria || null,
            is_active: v.is_active ? 1 : 0,
            sort_order: i
        }));
    const r = await api('save_strategy_vars','POST',{ strategy_id: strategyId, variables });
    if(r.error){ toast(r.error,'error'); return; }
    toast('Variables saved! ✅');
    document.getElementById('strategy-vars-modal').classList.remove('open');
    loadStrategies();
}
