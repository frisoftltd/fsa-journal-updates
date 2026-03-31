/**
 * FundedControl — Trades Module (v3.4.0)
 * Trade CRUD, multi-image slideshow, P&L validation, pairs, checklist
 */

// ── TRADE LOG ────────────────────────────────────────────
async function loadTrades() {
    const pair = document.getElementById('filter-pair')?.value||'';
    const result = document.getElementById('filter-result')?.value||'';
    const from = document.getElementById('filter-from')?.value||'';
    const to = document.getElementById('filter-to')?.value||'';
    let url = 'get_trades';
    const params=[];
    if(pair) params.push('pair='+pair);
    if(result) params.push('result='+result);
    if(from) params.push('from='+from);
    if(to) params.push('to='+to);
    if(params.length) url+='&'+params.join('&');
    allTrades = await api(url);
    renderTradesTable(allTrades);
}

async function loadPairs() {
    allPairs = await api('get_pairs');
    const selects = document.querySelectorAll('.pair-select');
    selects.forEach(sel => {
        const cur = sel.value;
        if(sel.id === 'filter-pair') {
            sel.innerHTML = '<option value="">All Pairs</option>' + 
                allPairs.map(p=>`<option value="${p.symbol}">${p.symbol}</option>`).join('');
        } else {
            sel.innerHTML = allPairs.map(p=>`<option value="${p.symbol}">${p.symbol}</option>`).join('');
        }
        if(cur) sel.value = cur;
    });
}

function renderTradesTable(trades) {
    const tbody=document.getElementById('trades-tbody');
    if(!trades.length){tbody.innerHTML='<tr><td colspan="16" class="empty"><div class="empty-icon">📋</div><p>No trades yet.</p></td></tr>';return;}
    tbody.innerHTML = trades.map((t,i)=>`<tr>
        <td style="white-space:nowrap">${t.trade_date}</td>
        <td><span class="badge" style="background:rgba(79,124,255,0.1);color:var(--blue2);font-size:10px">${t.session||'—'}</span></td>
        <td style="font-weight:600;color:var(--text)">${t.pair}</td>
        <td>${t.direction==='Long'?'<span class="badge badge-long">Long</span>':'<span class="badge badge-short">Short</span>'}</td>
        <td style="font-family:var(--font-head);font-size:11px">${t.entry_price?parseFloat(t.entry_price).toFixed(2):'—'}</td>
        <td style="font-family:var(--font-head);font-size:11px;color:var(--red2)">${t.stop_loss?parseFloat(t.stop_loss).toFixed(2):'—'}</td>
        <td style="font-family:var(--font-head);font-size:11px">${t.exit_price?parseFloat(t.exit_price).toFixed(2):'—'}</td>
        <td><span class="${pnlCls(t.pnl)}">${fmt(t.pnl)}</span></td>
        <td style="color:var(--orange);font-size:12px;font-family:var(--font-head)">${fmt(t.fees)}</td>
        <td><span class="${pnlCls(t.net_pnl)}">${fmt(t.net_pnl)}</span></td>
        <td style="font-family:var(--font-head);font-size:11px;color:${parseFloat(t.r_multiple)>=0?'var(--green)':'var(--red)'}">${t.r_multiple!==null?t.r_multiple+'R':'—'}</td>
        <td>${resultBadge(t.result)}</td>
        <td style="color:var(--purple);font-size:12px">${t.fib_level||'—'}</td>
        <td>${t.confidence?`<span class="badge badge-${(t.confidence||'').toLowerCase()}">${t.confidence}</span>`:'—'}</td>
        <td style="white-space:nowrap">
            <button class="btn btn-ghost btn-sm" onclick="viewTrade(${t.id})" title="View trade">👁</button>
            <button class="btn btn-ghost btn-sm" onclick="editTrade(${t.id})">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteTrade(${t.id})">🗑</button>
        </td>
    </tr>`).join('');
}

// ── VIEW TRADE WITH SLIDESHOW ────────────────────────────
function viewTrade(id) {
    const t = allTrades.find(t=>t.id==id);
    if(!t) return;
    const u = currentUser;
    const uid = u?.id || t.user_id || 1;

    // Build slideshow from screenshots_data or fallback to single screenshot
    const images = t.screenshots_data || [];
    let imgHtml = '';

    if (images.length > 0) {
        imgHtml = `
            <div id="trade-slideshow" style="position:relative">
                <div id="slide-container">
                    ${images.map((img, idx) => `
                        <div class="slide" style="${idx > 0 ? 'display:none' : ''}" data-slide="${idx}">
                            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;text-align:center">${img.label || 'Chart'}</div>
                            <img src="media/uploads/${uid}/${img.file}" style="width:100%;max-height:350px;object-fit:contain;border-radius:8px;border:1px solid var(--border);cursor:zoom-in" onclick="openLightbox('media/uploads/${uid}/${img.file}','${img.label||'Chart'}')" title="Click to zoom">
                        </div>
                    `).join('')}
                </div>
                ${images.length > 1 ? `
                    <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:8px">
                        <button onclick="slideNav(-1)" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:4px 12px;cursor:pointer;color:var(--text);font-size:16px">←</button>
                        <span id="slide-counter" style="font-size:11px;color:var(--text3);font-family:var(--font-head)">1 / ${images.length}</span>
                        <button onclick="slideNav(1)" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:4px 12px;cursor:pointer;color:var(--text);font-size:16px">→</button>
                    </div>
                    <div style="display:flex;justify-content:center;gap:4px;margin-top:6px">
                        ${images.map((img, idx) => `<button onclick="goToSlide(${idx})" style="padding:2px 8px;font-size:9px;border-radius:4px;border:1px solid var(--border);background:${idx===0?'var(--blue)':'var(--bg3)'};color:${idx===0?'#fff':'var(--text3)'};cursor:pointer;text-transform:uppercase;letter-spacing:0.5px" class="slide-tab" data-tab="${idx}">${img.label || 'Chart'}</button>`).join('')}
                    </div>
                ` : ''}
            </div>`;
    } else if (t.screenshot) {
        // Backward compat: single screenshot
        imgHtml = `<img src="media/uploads/${uid}/${t.screenshot}" style="width:100%;max-height:350px;object-fit:contain;border-radius:8px;border:1px solid var(--border);cursor:zoom-in" onclick="openLightbox(this.src,'Chart')" title="Click to zoom">`;
    } else {
        imgHtml = `<div style="height:120px;display:flex;align-items:center;justify-content:center;background:var(--bg3);border-radius:8px;color:var(--text3);font-size:13px">📷 No chart screenshots uploaded</div>`;
    }

    document.getElementById('view-trade-content').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
            <div>
                ${imgHtml}
                ${t.notes?`<div style="margin-top:12px;padding:12px;background:var(--bg3);border-radius:8px;font-size:13px;color:var(--text2);line-height:1.6"><strong style="color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:1px">Notes</strong><br>${t.notes}</div>`:''}
            </div>
            <div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Date</div><div style="font-family:var(--font-head);font-size:13px">${t.trade_date}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Pair</div><div style="font-family:var(--font-head);font-size:13px;color:var(--blue2)">${t.pair}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Direction</div><div>${t.direction==='Long'?'<span class="badge badge-long">Long</span>':'<span class="badge badge-short">Short</span>'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Result</div><div>${resultBadge(t.result)}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Entry</div><div style="font-family:var(--font-head);font-size:13px">${t.entry_price?parseFloat(t.entry_price).toFixed(2):'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Stop Loss</div><div style="font-family:var(--font-head);font-size:13px;color:var(--red)">${t.stop_loss?parseFloat(t.stop_loss).toFixed(2):'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Take Profit</div><div style="font-family:var(--font-head);font-size:13px;color:var(--green)">${t.take_profit?parseFloat(t.take_profit).toFixed(2):'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Exit</div><div style="font-family:var(--font-head);font-size:13px">${t.exit_price?parseFloat(t.exit_price).toFixed(2):'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Net P&L</div><div class="${pnlCls(t.net_pnl)}" style="font-size:18px">${fmt(t.net_pnl)}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">R Multiple</div><div style="font-family:var(--font-head);font-size:16px;color:${parseFloat(t.r_multiple||0)>=0?'var(--green)':'var(--red)'}">${t.r_multiple}R</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Fib Level</div><div style="color:var(--purple);font-weight:600">${t.fib_level||'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">FSA Rules</div><div style="color:${t.fsa_rules==='All 5'?'var(--green)':'var(--orange)'};font-weight:600">${t.fsa_rules||'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Session</div><div>${t.session||'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Exec Score</div><div style="font-family:var(--font-head);font-size:16px;color:var(--gold)">${t.exec_score?t.exec_score+'/10':'—'}</div></div>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px">
                    <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('view-trade-modal').classList.remove('open')">Close</button>
                    <button class="btn btn-primary" style="flex:1" onclick="document.getElementById('view-trade-modal').classList.remove('open');editTrade(${t.id})">✏️ Edit Trade</button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('view-trade-title').textContent = `Trade #${t.id} — ${t.pair} ${t.direction} — ${t.trade_date}`;
    document.getElementById('view-trade-modal').classList.add('open');

    // Reset slideshow to first slide
    window._currentSlide = 0;
}

// ── SLIDESHOW NAVIGATION ──────────────────────────────────
window._currentSlide = 0;
function slideNav(dir) {
    const slides = document.querySelectorAll('#slide-container .slide');
    if (!slides.length) return;
    window._currentSlide += dir;
    if (window._currentSlide >= slides.length) window._currentSlide = 0;
    if (window._currentSlide < 0) window._currentSlide = slides.length - 1;
    goToSlide(window._currentSlide);
}
function goToSlide(idx) {
    const slides = document.querySelectorAll('#slide-container .slide');
    const tabs = document.querySelectorAll('.slide-tab');
    slides.forEach((s, i) => s.style.display = i === idx ? '' : 'none');
    tabs.forEach((t, i) => {
        t.style.background = i === idx ? 'var(--blue)' : 'var(--bg3)';
        t.style.color = i === idx ? '#fff' : 'var(--text3)';
    });
    const counter = document.getElementById('slide-counter');
    if (counter) counter.textContent = (idx + 1) + ' / ' + slides.length;
    window._currentSlide = idx;
}

// ── LIGHTBOX ZOOM ─────────────────────────────────────────
function openLightbox(src, label) {
    // Remove existing lightbox if any
    const existing = document.getElementById('fc-lightbox');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'fc-lightbox';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:zoom-out;padding:20px';
    overlay.onclick = () => overlay.remove();
    overlay.innerHTML = `
        <div style="color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;font-family:var(--font-head)">${label}</div>
        <img src="${src}" style="max-width:95vw;max-height:85vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5)" onclick="event.stopPropagation();window.open('${src}','_blank')">
        <div style="color:#666;font-size:11px;margin-top:12px">Click image to open full size • Click background to close</div>
    `;
    document.body.appendChild(overlay);

    // Close on Escape key
    const closeOnEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', closeOnEsc); } };
    document.addEventListener('keydown', closeOnEsc);
}

// ── TRADE MODAL ─────────────────────────────────────────
function openTradeModal(data=null) {
    loadPairs();
    document.getElementById('trade-form').reset();
    document.getElementById('trade-id').value=data?.id||'';
    document.getElementById('screenshot-current').innerHTML='';
    // Clear file inputs
    for (let i = 1; i <= 4; i++) {
        const inp = document.getElementById('f-screenshot_' + i);
        if (inp) inp.value = '';
        const prev = document.getElementById('preview-' + i);
        if (prev) prev.innerHTML = '';
    }
    if(data){
        const fields=['trade_date','session','pair','direction','entry_price','stop_loss','take_profit','exit_price','lot_size','fees','result','confidence','exec_score','fib_level','fsa_rules','notes'];
        fields.forEach(k=>{ const el=document.getElementById('f-'+k); if(el&&data[k]!==null&&data[k]!==undefined) el.value=data[k]; });
        if(data.time_in) { const d=data.time_in.replace(' ','T'); const parts=d.split('T'); document.getElementById('f-time_in_date').value=parts[0]; document.getElementById('f-time_in_time').value=parts[1]?.substring(0,5)||''; }
        if(data.time_out) { const d=data.time_out.replace(' ','T'); const parts=d.split('T'); document.getElementById('f-time_out_date').value=parts[0]; document.getElementById('f-time_out_time').value=parts[1]?.substring(0,5)||''; }
        // Show existing screenshots
        const images = data.screenshots_data || [];
        if (images.length > 0) {
            const uid = currentUser?.id || data.user_id || 1;
            document.getElementById('screenshot-current').innerHTML = '<div style="font-size:10px;color:var(--text3);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">Current Screenshots</div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                images.map(img => `<div style="position:relative"><img src="media/uploads/${uid}/${img.file}" style="height:60px;border-radius:6px;border:1px solid var(--border)"><div style="font-size:9px;color:var(--text3);text-align:center;margin-top:2px">${img.label}</div></div>`).join('') +
                '</div><div style="font-size:11px;color:var(--text3);margin-top:6px">Upload new images to replace, or leave empty to keep current.</div>';
        } else if (data.screenshot) {
            const uid = currentUser?.id || data.user_id || 1;
            document.getElementById('screenshot-current').innerHTML=`<img src="media/uploads/${uid}/${data.screenshot}" style="max-width:100%;max-height:80px;border-radius:6px;margin-top:6px">`;
        }
    } else {
        const today=new Date().toISOString().split('T')[0];
        document.getElementById('f-trade_date').value=today;
        document.getElementById('f-time_in_date').value=today;
        document.getElementById('f-time_out_date').value=today;
    }
    document.getElementById('trade-modal').classList.add('open');
}

async function editTrade(id){ const t=allTrades.find(t=>t.id==id); if(t) openTradeModal(t); }

async function deleteTrade(id){
    if(!confirm('Delete this trade?')) return;
    await api('delete_trade','POST',{id});
    toast('Trade deleted'); loadTrades(); loadDashboard();
}

async function saveTrade() {
    const id=document.getElementById('trade-id').value;
    const form=document.getElementById('trade-form');

    // ── P&L vs Result validation ──
    const result = document.getElementById('f-result')?.value || '';
    const entry = parseFloat(document.getElementById('f-entry_price')?.value || 0);
    const exit_p = parseFloat(document.getElementById('f-exit_price')?.value || 0);
    const direction = document.getElementById('f-direction')?.value || 'Long';
    const lot = parseFloat(document.getElementById('f-lot_size')?.value || 0);
    const fees = parseFloat(document.getElementById('f-fees')?.value || 0);

    if (result && entry && exit_p && lot) {
        const rawPnl = direction === 'Long' ? (exit_p - entry) * lot : (entry - exit_p) * lot;
        const netPnl = rawPnl - fees;

        if (result === 'Loss' && netPnl > 0) {
            toast('Result is "Loss" but P&L is positive ($' + netPnl.toFixed(2) + '). Check your prices or result.', 'error');
            return;
        }
        if (result === 'Win' && netPnl < 0) {
            toast('Result is "Win" but P&L is negative (-$' + Math.abs(netPnl).toFixed(2) + '). Check your prices or result.', 'error');
            return;
        }
        if (result === 'Break Even' && netPnl < 0) {
            toast('Result is "Break Even" but P&L is negative (-$' + Math.abs(netPnl).toFixed(2) + '). Check your prices.', 'error');
            return;
        }
    }

    // ── File size validation (1MB per image) ──
    for (let i = 1; i <= 4; i++) {
        const inp = document.getElementById('f-screenshot_' + i);
        if (inp && inp.files.length > 0) {
            if (inp.files[0].size > 1048576) {
                toast(`Screenshot ${i} exceeds 1MB limit (${(inp.files[0].size / 1048576).toFixed(1)}MB). Compress the image.`, 'error');
                return;
            }
        }
    }

    // ── Check if any files are attached ──
    let hasFiles = false;
    for (let i = 1; i <= 4; i++) {
        const inp = document.getElementById('f-screenshot_' + i);
        if (inp && inp.files.length > 0) { hasFiles = true; break; }
    }

    const tin_d=document.getElementById('f-time_in_date').value;
    const tin_t=document.getElementById('f-time_in_time').value;
    const tout_d=document.getElementById('f-time_out_date').value;
    const tout_t=document.getElementById('f-time_out_time').value;

    let r;
    if (hasFiles) {
        // Use FormData for file uploads
        const fd = new FormData(form);
        if(tin_d&&tin_t) fd.set('time_in',tin_d+' '+tin_t+':00');
        if(tout_d&&tout_t) fd.set('time_out',tout_d+' '+tout_t+':00');
        if(id) fd.set('id',id);
        if (id) {
            const t = allTrades.find(t => t.id == id);
            if (t && t.screenshots) fd.set('existing_screenshots', t.screenshots);
        }
        const resp = await fetch(`${API}?action=${id?'update_trade':'add_trade'}`,{method:'POST',body:fd});
        r = await resp.json();
    } else {
        // Use JSON for speed (no files)
        const data = {};
        ['trade_date','session','pair','direction','entry_price','stop_loss','take_profit','exit_price','lot_size','fees','result','confidence','exec_score','fib_level','fsa_rules','notes'].forEach(k=>{data[k]=document.getElementById('f-'+k)?.value||null;});
        data.time_in=tin_d&&tin_t?tin_d+' '+tin_t+':00':null;
        data.time_out=tout_d&&tout_t?tout_d+' '+tout_t+':00':null;
        if(id) {
            data.id=id;
            const t = allTrades.find(t => t.id == id);
            if (t && t.screenshots) data.existing_screenshots = t.screenshots;
        }
        // Pass labels even without files
        for (let i = 1; i <= 4; i++) {
            const lbl = document.getElementById('f-label_' + i);
            if (lbl) data['label_' + i] = lbl.value;
        }
        r = await api(id?'update_trade':'add_trade','POST',data);
    }
    if(r.error){toast(r.error,'error');return;}

    toast(id?'Trade updated!':'Trade added! ✅');
    document.getElementById('trade-modal').classList.remove('open');
    loadTrades(); loadDashboard();
}

// ── FSA CHECKLIST ─────────────────────────────────────────
function openChecklist(){
    const items=document.querySelectorAll('.check-item');
    items.forEach(i=>{ i.classList.remove('checked'); i.querySelector('input').checked=false; });
    updateCheckScore();
    document.getElementById('checklist-popup').classList.add('open');
}
function toggleCheck(el){
    el.classList.toggle('checked');
    el.querySelector('input').checked=el.classList.contains('checked');
    updateCheckScore();
}
function updateCheckScore(){
    const total=document.querySelectorAll('.check-item').length;
    const checked=document.querySelectorAll('.check-item.checked').length;
    const scoreEl=document.getElementById('check-score');
    scoreEl.textContent=checked+'/'+total;
    scoreEl.style.color=checked===total?'var(--green)':checked>=3?'var(--orange)':'var(--red)';
}
function proceedTrade(){
    const checked=document.querySelectorAll('.check-item.checked').length;
    const total=document.querySelectorAll('.check-item').length;
    if(checked<total){if(!confirm(`Only ${checked}/${total} rules met. Take trade anyway?`)) return;}
    document.getElementById('checklist-popup').classList.remove('open');
    openTradeModal();
}

// ── PAIRS MANAGEMENT ─────────────────────────────────────
async function openPairsModal(){
    const pairs=await api('get_pairs');
    document.getElementById('pairs-list').innerHTML=pairs.map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:600">${p.symbol}</span><button class="btn btn-danger btn-sm" onclick="deletePair(${p.id})">Remove</button></div>`).join('');
    document.getElementById('pairs-modal').classList.add('open');
}
async function addPair(){
    const sym=document.getElementById('new-pair-input').value.trim();
    if(!sym) return;
    const r=await api('add_pair','POST',{symbol:sym});
    if(r.error){toast(r.error,'error');return;}
    toast(sym+' added!');
    document.getElementById('new-pair-input').value='';
    openPairsModal(); loadPairs();
}
async function deletePair(id){
    await api('delete_pair','POST',{id});
    toast('Pair removed'); openPairsModal(); loadPairs();
}
