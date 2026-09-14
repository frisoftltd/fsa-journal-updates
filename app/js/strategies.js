
/**
 * FundedControl — Strategy Lab Module
 * Dynamic strategy builder: CRUD strategies + any number of custom variables each
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
                <div style="font-size:12px;color:var(--text2)">${(st.variables||[]).filter(v=>v.is_active==1).length} active variable${(st.variables||[]).filter(v=>v.is_active==1).length===1?'':'s'}${(st.variables||[]).some(v=>v.is_active==0)?` (${(st.variables||[]).filter(v=>v.is_active==0).length} inactive)`:''}</div>
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
