
/**
 * FundedControl — Strategy Lab Module
 * Dynamic strategy builder: CRUD strategies + up to 5 custom variables each
 */
let allStrategies = [];
let currentVarRows = [];

async function loadStrategies(){
    allStrategies = await api('get_strategies');
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
                <div style="font-size:12px;color:var(--text2)">${(st.variables||[]).length}/5 variables</div>
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

function openStrategyModal(data=null){
    document.getElementById('sb-id').value = data?.id || '';
    document.getElementById('strategy-builder-modal-title').textContent = data ? '✏️ RENAME STRATEGY' : '🧪 NEW STRATEGY';
    document.getElementById('sb-name').value = data?.name || '';
    document.getElementById('strategy-builder-modal').classList.add('open');
}

function editStrategy(id){
    const st = allStrategies.find(s=>s.id==id);
    if(st) openStrategyModal(st);
}

async function saveStrategyMeta(){
    const id = document.getElementById('sb-id').value;
    const name = document.getElementById('sb-name').value.trim();
    if(!name){ toast('Strategy name is required','error'); return; }
    const data = { name };
    if(id) data.id = id;
    const r = await api(id ? 'update_strategy' : 'add_strategy', 'POST', data);
    if(r.error){ toast(r.error,'error'); return; }
    toast(id ? 'Strategy updated!' : 'Strategy created! ✅');
    document.getElementById('strategy-builder-modal').classList.remove('open');
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
    currentVarRows = (st.variables||[]).map(v=>({label:v.label, input_type:v.input_type, options:v.options||''}));
    renderVariableRows();
    document.getElementById('strategy-vars-modal').classList.add('open');
}

function renderVariableRows(){
    const wrap = document.getElementById('sv-rows');
    wrap.innerHTML = currentVarRows.map((v,i)=>`<div class="form-grid-2" style="gap:8px;align-items:end;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)">
        <div class="form-group"><label>Label</label><input type="text" value="${(v.label||'').replace(/"/g,'&quot;')}" oninput="updateVarRow(${i},'label',this.value)" placeholder="e.g. Confirmed 4H trend"></div>
        <div class="form-group"><label>Type</label><select onchange="updateVarRow(${i},'input_type',this.value)">
            <option value="checkbox" ${v.input_type==='checkbox'?'selected':''}>Checkbox</option>
            <option value="scale" ${v.input_type==='scale'?'selected':''}>1–5 Scale</option>
            <option value="select" ${v.input_type==='select'?'selected':''}>Dropdown</option>
            <option value="text" ${v.input_type==='text'?'selected':''}>Short text</option>
        </select></div>
        ${v.input_type==='select'?`<div class="form-group full"><label>Options (comma-separated)</label><input type="text" value="${(v.options||'').replace(/"/g,'&quot;')}" oninput="updateVarRow(${i},'options',this.value)" placeholder="e.g. London,New York,Tokyo"></div>`:''}
        <div class="form-group"><button class="btn btn-danger btn-sm" onclick="removeVariableRow(${i})">🗑 Remove</button></div>
    </div>`).join('');
    document.getElementById('sv-add-row-btn').disabled = currentVarRows.length >= 5;
}

function updateVarRow(i, key, val){
    currentVarRows[i][key] = val;
    if(key==='input_type') renderVariableRows();
}

function addVariableRow(){
    if(currentVarRows.length >= 5){ toast('Maximum 5 variables per strategy','error'); return; }
    currentVarRows.push({label:'', input_type:'checkbox', options:''});
    renderVariableRows();
}

function removeVariableRow(i){
    currentVarRows.splice(i,1);
    renderVariableRows();
}

async function saveVariables(){
    const strategyId = document.getElementById('sv-strategy-id').value;
    if(currentVarRows.length > 5){ toast('Maximum 5 variables per strategy','error'); return; }
    const variables = currentVarRows
        .filter(v=>v.label && v.label.trim() !== '')
        .map((v,i)=>({ label: v.label.trim(), input_type: v.input_type, options: v.input_type==='select' ? (v.options||'') : null, sort_order: i }));
    const r = await api('save_strategy_vars','POST',{ strategy_id: strategyId, variables });
    if(r.error){ toast(r.error,'error'); return; }
    toast('Variables saved! ✅');
    document.getElementById('strategy-vars-modal').classList.remove('open');
    loadStrategies();
}
