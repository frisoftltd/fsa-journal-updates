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
    refreshNewTradeGate();
}

// v3.17.0 — trade-limits gate for "+ New Trade". Single source of truth is
// CalculatorController::getRiskStatus() (get_risk_status) — the same endpoint the Risk
// Calculator page's status strip reads, so the button and the strip can never disagree
// about whether a new trade is currently allowed. window._riskStopReason is also checked
// inside openChecklist() itself, not just reflected in this button's disabled state, so
// the gate holds even if something else ever triggers that flow.
window._riskStopReason = null;
async function refreshNewTradeGate(){
    const btn = document.getElementById('new-trade-btn');
    if (!btn) return;
    let status;
    try { status = await api('get_risk_status'); } catch (e) { return; }
    if (!status || status.error) return;
    window._riskStopReason = status.stopped ? status.reason : null;
    if (status.stopped) {
        btn.disabled = true;
        btn.textContent = 'STOP — no trade';
        btn.title = 'STOP — no trade: ' + status.reason;
        btn.style.background = 'var(--red)';
    } else {
        btn.disabled = false;
        btn.textContent = '+ New Trade';
        btn.title = '';
        btn.style.background = '';
    }
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
    if(!trades.length){tbody.innerHTML='<tr><td colspan="13" class="empty"><div class="empty-icon">📋</div><p>No trades yet.</p></td></tr>';return;}
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
    window._lightboxImages = images;
    window._lightboxUid = uid;
    let imgHtml = '';

    if (images.length > 0) {
        imgHtml = `
            <div id="trade-slideshow" style="position:relative">
                <div id="slide-container">
                    ${images.map((img, idx) => `
                        <div class="slide" style="${idx > 0 ? 'display:none' : ''}" data-slide="${idx}">
                            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;text-align:center">${img.label || 'Chart'}</div>
                            <img src="media/uploads/${uid}/${img.file}" style="width:100%;max-height:350px;object-fit:contain;border-radius:8px;border:1px solid var(--border);cursor:zoom-in" onclick="openLightbox(${idx})" title="Click to zoom">
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
        window._lightboxImages = [{file: t.screenshot, label: 'Chart'}];
        imgHtml = `<img src="media/uploads/${uid}/${t.screenshot}" style="width:100%;max-height:350px;object-fit:contain;border-radius:8px;border:1px solid var(--border);cursor:zoom-in" onclick="openLightbox(0)" title="Click to zoom">`;
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
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Session</div><div>${t.session||'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Exec Score</div><div style="font-family:var(--font-head);font-size:16px;color:var(--gold)">${t.exec_score?t.exec_score+'/10':'—'}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Emotion</div><div>${t.emotion_tag?emotionLabel(t.emotion_tag):(t.trade_journal?.find(j=>j.phase==='pre_entry')?.emotion_code?emotionLabel(t.trade_journal.find(j=>j.phase==='pre_entry').emotion_code):'—')}</div></div>
                    <div style="background:var(--bg3);padding:12px;border-radius:8px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Exit Reason</div><div style="font-size:13px">${t.exit_reason||'—'}</div></div>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px">
                    <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('view-trade-modal').classList.remove('open')">Close</button>
                    <button class="btn btn-primary" style="flex:1" onclick="document.getElementById('view-trade-modal').classList.remove('open');editTrade(${t.id})">✏️ Edit Trade</button>
                </div>
            </div>
        </div>
        ${(t.note_saw||t.note_why||t.note_unsure)?`
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Legacy Pre-Trade Notes</div>
            ${t.note_saw?`<div style="margin-top:6px;font-size:12px;color:var(--text2)"><strong style="color:var(--text3)">What did I see?</strong><br>${t.note_saw}</div>`:''}
            ${t.note_why?`<div style="margin-top:6px;font-size:12px;color:var(--text2)"><strong style="color:var(--text3)">Why enter now?</strong><br>${t.note_why}</div>`:''}
            ${t.note_unsure?`<div style="margin-top:6px;font-size:12px;color:var(--text2)"><strong style="color:var(--text3)">What am I unsure about?</strong><br>${t.note_unsure}</div>`:''}
        </div>` : ''}
        ${t.trade_journal && t.trade_journal.length ? `
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Trade Journal</div>
            ${renderJournalView(t.trade_journal)}
        </div>` : ''}
        ${t.trade_checkins && t.trade_checkins.length ? `
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Check-In History (During Open Position)</div>
            <div style="display:flex;flex-direction:column;gap:6px">
                ${t.trade_checkins.map(c => {
                    const parts = [];
                    if (c.actions && c.actions.length) parts.push(c.actions.map(journalActionLabel).join(', '));
                    if (c.emotion_code) parts.push(emotionLabel(c.emotion_code));
                    if (c.tempted_text) parts.push(`"${c.tempted_text}"`);
                    return `<div style="font-size:12px;color:var(--text2)"><span style="font-family:var(--font-mono);color:var(--text3)">${formatCheckinTime(c.checked_at)}</span> — ${parts.join(' · ') || '<em>No details</em>'}</div>`;
                }).join('')}
            </div>
        </div>` : ''}
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

// ── LIGHTBOX ZOOM WITH NAVIGATION ──────────────────────────
window._lightboxImages = [];
window._lightboxUid = 1;
window._lightboxIdx = 0;

function openLightbox(idx) {
    window._lightboxIdx = idx;
    renderLightbox();
}

function renderLightbox() {
    const imgs = window._lightboxImages;
    const uid = window._lightboxUid;
    const idx = window._lightboxIdx;
    if (!imgs.length) return;

    const img = imgs[idx];
    const src = `media/uploads/${uid}/${img.file}`;
    const label = img.label || 'Chart';
    const hasMultiple = imgs.length > 1;

    // Remove existing
    const existing = document.getElementById('fc-lightbox');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'fc-lightbox';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div style="color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;font-family:var(--font-head)">${label}${hasMultiple ? ` &nbsp;·&nbsp; ${idx+1} / ${imgs.length}` : ''}</div>
        <div style="display:flex;align-items:center;gap:16px;max-width:95vw">
            ${hasMultiple ? `<button onclick="event.stopPropagation();lightboxNav(-1)" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:50%;width:48px;height:48px;color:#fff;font-size:22px;cursor:pointer;flex-shrink:0;transition:background 0.2s" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">←</button>` : ''}
            <img src="${src}" style="max-width:${hasMultiple?'80vw':'95vw'};max-height:80vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);cursor:pointer" onclick="event.stopPropagation();window.open('${src}','_blank')" title="Open full size in new tab">
            ${hasMultiple ? `<button onclick="event.stopPropagation();lightboxNav(1)" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:50%;width:48px;height:48px;color:#fff;font-size:22px;cursor:pointer;flex-shrink:0;transition:background 0.2s" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">→</button>` : ''}
        </div>
        ${hasMultiple ? `
            <div style="display:flex;gap:6px;margin-top:14px">
                ${imgs.map((im, i) => `<button onclick="event.stopPropagation();lightboxGoTo(${i})" style="padding:4px 12px;font-size:10px;border-radius:6px;border:1px solid ${i===idx?'rgba(26,86,219,0.8)':'rgba(255,255,255,0.15)'};background:${i===idx?'rgba(26,86,219,0.6)':'rgba(255,255,255,0.05)'};color:#fff;cursor:pointer;text-transform:uppercase;letter-spacing:0.5px;transition:all 0.2s">${im.label||'Chart'}</button>`).join('')}
            </div>
        ` : ''}
        <div style="color:#555;font-size:11px;margin-top:12px">Click image to open full size &nbsp;·&nbsp; Click background or press Esc to close${hasMultiple ? ' &nbsp;·&nbsp; ← → to navigate' : ''}</div>
    `;
    document.body.appendChild(overlay);

    // Keyboard navigation
    const keyHandler = (e) => {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); }
        if (e.key === 'ArrowLeft' && hasMultiple) lightboxNav(-1);
        if (e.key === 'ArrowRight' && hasMultiple) lightboxNav(1);
    };
    // Remove old handler if exists
    if (window._lightboxKeyHandler) document.removeEventListener('keydown', window._lightboxKeyHandler);
    window._lightboxKeyHandler = keyHandler;
    document.addEventListener('keydown', keyHandler);
}

function lightboxNav(dir) {
    const imgs = window._lightboxImages;
    window._lightboxIdx += dir;
    if (window._lightboxIdx >= imgs.length) window._lightboxIdx = 0;
    if (window._lightboxIdx < 0) window._lightboxIdx = imgs.length - 1;
    renderLightbox();
}

function lightboxGoTo(idx) {
    window._lightboxIdx = idx;
    renderLightbox();
}

// ── TRADE MODAL ─────────────────────────────────────────
function openTradeModal(data=null) {
    loadPairs();
    document.getElementById('trade-form').reset();
    document.getElementById('trade-id').value=data?.id||'';
    document.getElementById('screenshot-current').innerHTML='';
    // v3.16.4: this button previously always read "Save Trade" regardless of whether an
    // existing trade was being edited — a real bug, not cosmetic, since it gave no signal
    // that reopening trade 123 and clicking it would update that row rather than create
    // a new one.
    const saveBtn = document.getElementById('save-trade-btn');
    if (saveBtn) saveBtn.textContent = data ? 'Update Trade' : 'Save Trade';
    // Clear file inputs
    for (let i = 1; i <= 4; i++) {
        const inp = document.getElementById('f-screenshot_' + i);
        if (inp) inp.value = '';
        const prev = document.getElementById('preview-' + i);
        if (prev) prev.innerHTML = '';
    }
    document.getElementById('strategy-vars-fields').innerHTML='';
    populateStrategySelect(data);
    initJournalSections(data);
    renderExecutionSummary(data);
    if(data){
        const fields=['trade_date','session','pair','direction','stop_loss','take_profit','result','exec_score','notes','planned_margin'];
        fields.forEach(k=>{ const el=document.getElementById('f-'+k); if(el&&data[k]!==null&&data[k]!==undefined) el.value=data[k]; });
        selectGrade(data.setup_grade||null);
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
        selectGrade(null);
        // v3.17.0 — one-shot handoff from the Risk Calculator page: "Use in Trade Form"
        // stashes its computed margin_usd here, and only a brand-new trade ever picks it
        // up (an edit's own saved planned_margin, handled above, must never be clobbered
        // by a stale calculator session). Removed immediately so it can't leak into a
        // second, unrelated trade added later in the same session.
        const pendingMargin = sessionStorage.getItem('fc_pending_planned_margin');
        if (pendingMargin) {
            document.getElementById('f-planned_margin').value = pendingMargin;
            sessionStorage.removeItem('fc_pending_planned_margin');
        }
    }
    document.getElementById('trade-modal').classList.add('open');
    document.getElementById('f-planned-entry').value = '';
    document.getElementById('f-planned-lot').value = '';
    updateSizingPanel();
}

// v3.16.1 B4 — pre-trade sizing panel. Planned Entry/Planned Lot Size are read straight
// out of the DOM, never persisted (see the markup comment in trade-modal.php for why) —
// this function's only job is to keep the live preview in sync with whatever's currently
// typed. Debounced because it fires on every keystroke across five inputs.
let _sizingPanelTimer = null;
function updateSizingPanel(){
    clearTimeout(_sizingPanelTimer);
    _sizingPanelTimer = setTimeout(_runSizingPanel, 250);
}
async function _runSizingPanel(){
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const tradeDate = document.getElementById('f-trade_date').value;
    if (!tradeDate) return;

    const ch = await api('get_active_challenge');
    if (!ch || !ch.id) { set('sp-balance', '—'); return; }

    const stop = document.getElementById('f-stop_loss').value;
    const target = document.getElementById('f-take_profit').value;
    const entry = document.getElementById('f-planned-entry').value;
    const lot = document.getElementById('f-planned-lot').value;

    let r;
    try {
        r = await api('size_preview', 'POST', {
            challenge_id: ch.id, trade_date: tradeDate,
            stop, target, entry, lot_size: lot,
        });
    } catch (e) { return; }
    if (!r || r.error) return;

    set('sp-balance', r.balance_at_day_start != null ? fmt(r.balance_at_day_start) : '—');
    set('sp-tier', r.planned_risk_pct != null ? r.planned_risk_pct + '%' : '—');
    set('sp-prescribed', r.prescribed_risk_dollars != null ? fmt(r.prescribed_risk_dollars) : '—');
    set('sp-entered', r.entered_risk_dollars != null ? fmt(r.entered_risk_dollars) : '—');
    set('sp-deviation', r.deviation_pct != null ? (r.deviation_pct > 0 ? '+' : '') + r.deviation_pct + '%' : '—');
    set('sp-target-r', r.target_r != null ? r.target_r + ':1' : '—');

    const warnEl = document.getElementById('sizing-panel-warnings');
    if (warnEl) {
        warnEl.innerHTML = (r.warnings || []).map(w =>
            `<div style="font-size:11px;color:var(--orange);margin-top:4px">⚠️ ${w}</div>`
        ).join('');
    }
}

// v3.14.0 — execution fields (time_in/time_out/entry/exit/lot/fees/pnl/net_pnl/
// result/exit_reason) are written exclusively by the Bitfunded importer now, never by
// this form. Shown read-only once populated; hidden entirely for a trade that's still
// pre-entry-only, which is the normal state for a brand-new trade going forward.
function renderExecutionSummary(data){
    const wrap = document.getElementById('execution-summary');
    if (!data || !data.time_in) { wrap.style.display = 'none'; return; }
    const grid = document.getElementById('execution-summary-grid');
    const field = (label, val) => `<div style="background:var(--bg3);padding:8px;border-radius:6px"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">${label}</div><div style="font-family:var(--font-head);font-size:12px">${val ?? '—'}</div></div>`;
    grid.innerHTML = [
        field('Time In', data.time_in),
        field('Time Out', data.time_out),
        field('Entry', data.entry_price ? parseFloat(data.entry_price).toFixed(4) : '—'),
        field('Exit', data.exit_price ? parseFloat(data.exit_price).toFixed(4) : '—'),
        field('Lot Size', data.lot_size ?? '—'),
        field('Fees', data.fees != null ? fmt(data.fees) : '—'),
        field('PnL', data.pnl != null ? fmt(data.pnl) : '—'),
        field('Net PnL', data.net_pnl != null ? fmt(data.net_pnl) : '—'),
        field('Exit Reason', data.exit_reason || '—'),
        field('Source', data.source || 'manual'),
    ].join('');
    wrap.style.display = 'block';
}

// ── TRADE JOURNAL SECTIONS (collapse/reveal) ─────────────
function toggleJournalSection(phase){
    const body = document.getElementById('journal-body-'+phase);
    const chevron = document.getElementById('journal-chevron-'+phase);
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    chevron.textContent = open ? '▸' : '▾';
}

async function populateStrategySelect(data=null){
    allStrategies = await api('get_strategies');
    const sel = document.getElementById('f-strategy_id');
    sel.innerHTML = '<option value="">— none —</option>' + allStrategies.filter(s=>s.is_active==1).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');

    let selectedId = data?.strategy_id || '';
    if(!data){
        const ch = await api('get_active_challenge');
        if(ch && ch.default_strategy_id) selectedId = ch.default_strategy_id;
    }
    sel.value = selectedId || '';

    let prefillMap = null;
    if(data && Array.isArray(data.trade_variables)){
        prefillMap = {};
        data.trade_variables.forEach(tv=>{ prefillMap[tv.variable_id] = tv.value; });
    }
    renderStrategyVarFields(prefillMap);
}

function renderStrategyVarFields(prefillMap=null){
    const stId = document.getElementById('f-strategy_id').value;
    const wrap = document.getElementById('strategy-vars-fields');
    const st = allStrategies.find(s=>s.id==stId);
    const activeVars = st ? (st.variables||[]).filter(v=>v.is_active==1) : [];
    if(!activeVars.length){ wrap.innerHTML=''; return; }
    wrap.innerHTML = activeVars.map(v=>{
        const val = prefillMap ? (prefillMap[v.id] ?? '') : '';
        const fieldId = `f-var-${v.id}`;
        if(v.input_type==='checkbox'){
            // Three states, not two: unanswered must stay unanswered (blank, same as
            // scale/select below) rather than silently default to "No" — a tag the user
            // never looked at is not the same observation as one they confirmed absent.
            return `<div class="form-group"><label>${v.label}</label>
                <select id="${fieldId}" data-var-id="${v.id}">
                    <option value="" ${val!=='0'&&val!=='1'?'selected':''}>—</option>
                    <option value="0" ${val==='0'?'selected':''}>No</option>
                    <option value="1" ${val==='1'?'selected':''}>Yes</option>
                </select></div>`;
        }
        if(v.input_type==='scale'){
            return `<div class="form-group"><label>${v.label}</label>
                <select id="${fieldId}" data-var-id="${v.id}">
                    <option value="">—</option>
                    ${[1,2,3,4,5].map(n=>`<option value="${n}" ${String(val)===String(n)?'selected':''}>${n}</option>`).join('')}
                </select></div>`;
        }
        if(v.input_type==='select'){
            const opts=(v.options||'').split(',').map(o=>o.trim()).filter(Boolean);
            return `<div class="form-group"><label>${v.label}</label>
                <select id="${fieldId}" data-var-id="${v.id}">
                    <option value="">—</option>
                    ${opts.map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}
                </select></div>`;
        }
        return `<div class="form-group"><label>${v.label}</label><input type="text" id="${fieldId}" data-var-id="${v.id}" value="${(val||'').toString().replace(/"/g,'&quot;')}"></div>`;
    }).join('');
}

function collectTradeVariables(){
    const vars = [];
    document.querySelectorAll('#strategy-vars-fields [data-var-id]').forEach(el=>{
        vars.push({ variable_id: el.dataset.varId, value: el.value });
    });
    return vars;
}

// ── TRADE JOURNAL (v3.11.0) ──────────────────────────────
// Three phases (pre_entry/during/post_close), each with its own emotion grid instance
// (same window.EMOTION_STATES taxonomy, reused per phase rather than one global field —
// the emotion at entry, mid-trade, and at close are three different data points). Answers
// live in window._journalState rather than per-field hidden inputs, since the whole
// section is collected as one JSON blob (collectTradeJournal()) for the save request, not
// read back out of the form generically the way trade_date/pair/etc. are.
const JOURNAL_PHASES = ['pre_entry', 'during', 'post_close'];

function resetJournalState(){
    window._journalState = {
        pre_entry:  { emotion_code: null },
        during:     { emotion_code: null, actions: [] },
        post_close: { emotion_code: null, exit_type: null, good_process: null },
    };
}

// Called once per modal open. A brand-new trade only shows Pre-Entry — During/Post-Close
// don't apply yet, since the trade has no "during" or "after" until it exists — while
// editing an existing trade reveals all three (collapsed, prefilled from data.trade_journal
// if present). Nothing here ever marks a phase "skipped"; the During header is simply
// absent for a new trade because that phase hasn't happened yet, not hidden as a choice.
function initJournalSections(data){
    resetJournalState();
    JOURNAL_PHASES.forEach(phase=>{
        const body = document.getElementById('journal-body-'+phase);
        if (body) { body.style.display = 'none'; }
        const chevron = document.getElementById('journal-chevron-'+phase);
        if (chevron) chevron.textContent = '▸';
    });
    document.getElementById('journal-header-during').style.display = data ? 'flex' : 'none';
    document.getElementById('journal-header-post_close').style.display = data ? 'flex' : 'none';

    const byPhase = {};
    (data?.trade_journal || []).forEach(j => byPhase[j.phase] = j);

    renderEmotionGrid('pre_entry', byPhase.pre_entry?.emotion_code || null);
    document.getElementById('f-journal-note-pre_entry').value = byPhase.pre_entry?.note || '';
    // v3.16.4: pre-entry is locked once the trade has actually closed — it records what
    // was planned before entry, and TradeController::saveJournal() silently drops a
    // pre_entry submission server-side once closed regardless of what this sends, so this
    // is UX signal, not the enforcement point. 'Open'/blank/unset all still count as open.
    lockPreEntry(!!data && ['Win','Loss','Break Even'].includes(data.result));

    // v3.16.4: During's check-ins are append-only (trade_checkins), returned newest-first
    // by get_trades — [0] is the latest, which is what the form preloads. Saving with
    // these fields unchanged from the latest check-in creates no new row (see
    // TradeController::saveCheckin()); changing them and saving does.
    const checkins = data?.trade_checkins || [];
    const latestCheckin = checkins[0] || null;
    renderActionsGrid(latestCheckin?.actions || []);
    renderEmotionGrid('during', latestCheckin?.emotion_code || null);
    document.getElementById('f-journal-note-during').value = latestCheckin?.tempted_text || '';
    renderCheckinTimeline(checkins);

    renderExitTypeSelect(byPhase.post_close?.exit_type || null);
    renderEmotionGrid('post_close', byPhase.post_close?.emotion_code || null);
    document.querySelectorAll('.good-process-pill').forEach(b=>{ b.style.background=''; b.style.color=''; b.style.borderColor=''; });
    window._journalState.post_close.good_process = null;
    const gp = byPhase.post_close?.good_process;
    if (gp === 1 || gp === '1') toggleGoodProcess(1);
    else if (gp === 0 || gp === '0') toggleGoodProcess(0);
    document.getElementById('f-journal-note-post_close').value = byPhase.post_close?.note || '';
}

// v3.16.4 — visual/interactive lock only; TradeController::saveJournal() is the real
// enforcement point (a locked pre_entry submission is silently dropped server-side
// regardless of what gets sent). stop_loss/take_profit use readonly, never disabled —
// a disabled input is excluded from FormData entirely, and v3.16.1 B3 requires both of
// them on every save, including a closed trade's edits that have nothing to do with
// pre_entry (notes, strategy, post_close, a new check-in).
function lockPreEntry(locked){
    const badge = document.getElementById('journal-pre_entry-locked-badge');
    if (badge) badge.style.display = locked ? 'inline' : 'none';
    ['f-stop_loss','f-take_profit','f-journal-note-pre_entry'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.readOnly = locked;
    });
    document.querySelectorAll('#grade-grid .grade-pill, #emotion-grid-pre_entry .emotion-pill, #emotion-grid-pre_entry .emotion-info-btn, #emotion-clear-btn-pre_entry').forEach(b=>{
        b.disabled = locked;
        b.style.opacity = locked ? '0.6' : '';
        b.style.cursor = locked ? 'not-allowed' : '';
    });
}

function formatCheckinTime(ts){
    if (!ts) return '';
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

// v3.16.4 — read-only, newest-first history of every During check-in on this trade.
// Nothing here is editable: a previous check-in is never edited or deleted from this
// form (see CLAUDE.md v3.16.4) — this is a record of what was actually selected at each
// point in time, not a second edit surface for the same data.
function renderCheckinTimeline(checkins){
    const wrap = document.getElementById('checkin-timeline-wrap');
    const list = document.getElementById('checkin-timeline');
    if (!checkins || !checkins.length) { wrap.style.display = 'none'; list.innerHTML = ''; return; }
    list.innerHTML = checkins.map(c => {
        const parts = [];
        if (c.actions && c.actions.length) parts.push(c.actions.map(journalActionLabel).join(', '));
        if (c.emotion_code) parts.push(emotionLabel(c.emotion_code));
        if (c.tempted_text) parts.push(`"${c.tempted_text}"`);
        return `<div style="font-size:12px;color:var(--text2);padding:6px 8px;background:var(--bg3);border-radius:6px">
            <span style="font-family:var(--font-mono);color:var(--text3)">${formatCheckinTime(c.checked_at)}</span> — ${parts.join(' · ') || '<em>No details</em>'}
        </div>`;
    }).join('');
    wrap.style.display = 'block';
}

// Reads window._journalState plus the three free-text fields into the payload shape
// TradeController::saveJournal() expects. A phase with nothing filled in still gets
// submitted (as all-null/empty) — the backend deletes any existing row for an
// all-empty phase rather than the frontend deciding what "empty" means twice.
function collectTradeJournal(){
    const s = window._journalState;
    return [
        { phase: 'pre_entry',  emotion_code: s.pre_entry.emotion_code,  note: document.getElementById('f-journal-note-pre_entry')?.value || '' },
        { phase: 'during',     emotion_code: s.during.emotion_code,     note: document.getElementById('f-journal-note-during')?.value || '', actions: s.during.actions || [] },
        { phase: 'post_close', emotion_code: s.post_close.emotion_code, note: document.getElementById('f-journal-note-post_close')?.value || '', exit_type: s.post_close.exit_type, good_process: s.post_close.good_process },
    ];
}

function renderEmotionGrid(phase, selectedCode=null){
    const grid = document.getElementById('emotion-grid-'+phase);
    if (!grid) return;
    const states = window.EMOTION_STATES || [];
    grid.innerHTML = states.map(s=>`
        <span style="display:inline-flex;align-items:stretch">
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-code="${s.code}" onclick="toggleEmotionSelect('${phase}','${s.code}')" style="border-top-right-radius:0;border-bottom-right-radius:0;border-right:none">${s.label}</button>
            <button type="button" class="btn btn-ghost btn-sm emotion-info-btn" data-code="${s.code}" onclick="previewEmotion('${phase}','${s.code}')" title="What does '${s.label}' mean?" style="border-top-left-radius:0;border-bottom-left-radius:0;padding:0 9px;font-weight:700">ⓘ</button>
        </span>
    `).join('');

    const known = states.some(s=>s.code===selectedCode);
    // Preserve whatever was already stored (new code, legacy code, or nothing) until the
    // user actively changes it — only a tap should ever change this value.
    window._journalState[phase].emotion_code = selectedCode || null;
    highlightEmotionPill(phase, selectedCode);
    document.getElementById('emotion-description-'+phase).style.display = 'none';

    // A legacy (pre-v3.10.0, single-field) code won't match any pill above — surface it
    // rather than let the grid look empty/unanswered, and warn before it gets silently
    // overwritten. This can only appear on the pre_entry grid, since legacy trades only
    // ever had one emotion_tag value and no phase concept.
    const legacyNote = document.getElementById('emotion-legacy-note-'+phase);
    if (selectedCode && !known) {
        const legacyLabel = (window.LEGACY_EMOTION_LABELS||{})[selectedCode] || selectedCode;
        legacyNote.textContent = `Previously recorded: "${legacyLabel}" — a retired state, no longer selectable. Picking one below replaces it.`;
        legacyNote.style.display = 'block';
    } else {
        legacyNote.style.display = 'none';
    }
    toggleEmotionClearBtn(phase);
}

function highlightEmotionPill(phase, code){
    document.querySelectorAll('#emotion-grid-'+phase+' .emotion-pill').forEach(b=>{
        const active = !!code && b.dataset.code === code;
        b.style.background = active ? 'var(--blue)' : '';
        b.style.color = active ? '#fff' : '';
        b.style.borderColor = active ? 'var(--blue)' : '';
    });
}

// Tapping a pill's label selects it; tapping an already-selected pill's label again
// clears it — the selection must be clearable, an unanswered emotion is not the same
// as "settled" and must never default to anything.
function toggleEmotionSelect(phase, code){
    const cur = window._journalState[phase].emotion_code;
    const next = cur === code ? null : code;
    window._journalState[phase].emotion_code = next;
    highlightEmotionPill(phase, next);
    document.getElementById('emotion-legacy-note-'+phase).style.display = 'none';
    if (next) previewEmotion(phase, next); else document.getElementById('emotion-description-'+phase).style.display = 'none';
    toggleEmotionClearBtn(phase);
}

function clearEmotion(phase){
    window._journalState[phase].emotion_code = null;
    highlightEmotionPill(phase, null);
    document.getElementById('emotion-description-'+phase).style.display = 'none';
    document.getElementById('emotion-legacy-note-'+phase).style.display = 'none';
    toggleEmotionClearBtn(phase);
}

function toggleEmotionClearBtn(phase){
    const btn = document.getElementById('emotion-clear-btn-'+phase);
    if (btn) btn.style.display = window._journalState[phase].emotion_code ? 'inline-block' : 'none';
}

// Reveals a state's description WITHOUT selecting it — tapping "ⓘ" never touches the
// hidden field or the selected pill, so reading what a state means is fully non-committal.
function previewEmotion(phase, code){
    const s = (window.EMOTION_STATES||[]).find(x=>x.code===code);
    const panel = document.getElementById('emotion-description-'+phase);
    if (!s) { panel.style.display = 'none'; return; }
    panel.innerHTML = `<strong style="color:var(--text)">${s.label}</strong><br>${s.description}`;
    panel.style.display = 'block';
}

// Readable label for any emotion_tag/emotion_code value — current code, legacy code, or
// unrecognized. Mirrors includes/emotion_states.php::emotionLabel(), reading the same
// embedded data rather than a second hardcoded copy.
function emotionLabel(code){
    if (!code) return null;
    const s = (window.EMOTION_STATES||[]).find(x=>x.code===code);
    if (s) return s.label;
    const legacy = (window.LEGACY_EMOTION_LABELS||{})[code];
    return legacy || code;
}

// Mirrors includes/journal_taxonomy.php's journalActionLabel()/journalExitTypeLabel().
function journalActionLabel(code){
    const a = (window.JOURNAL_ACTIONS||[]).find(x=>x.code===code);
    return a ? a.label : code;
}
function journalExitTypeLabel(code){
    if (!code) return null;
    const t = (window.JOURNAL_EXIT_TYPES||[]).find(x=>x.code===code);
    return t ? t.label : code;
}

const JOURNAL_PHASE_LABELS = { pre_entry: 'Pre-Entry', during: 'During Open Position', post_close: 'After Close' };

// Read-only rendering of a trade's journal rows for viewTrade() — same phase order as
// the form, skips phases with no row (a missing 'during' row is the expected common case,
// not an error to explain away).
function renderJournalView(journalRows){
    const rows = (journalRows || []).slice().sort((a,b) => JOURNAL_PHASES.indexOf(a.phase) - JOURNAL_PHASES.indexOf(b.phase));
    if (!rows.length) return '';
    return rows.map(j => {
        const parts = [];
        if (j.emotion_code) parts.push(`<strong>Feeling:</strong> ${emotionLabel(j.emotion_code)}`);
        if (j.phase === 'during' && j.actions && j.actions.length) parts.push(`<strong>Actions:</strong> ${j.actions.map(journalActionLabel).join(', ')}`);
        if (j.phase === 'post_close' && j.exit_type) parts.push(`<strong>Exit:</strong> ${journalExitTypeLabel(j.exit_type)}`);
        if (j.phase === 'post_close' && (j.good_process === 1 || j.good_process === '1' || j.good_process === 0 || j.good_process === '0')) {
            parts.push(`<strong>Good process:</strong> ${(j.good_process==1||j.good_process=='1') ? 'Yes' : 'No'}`);
        }
        if (j.note) parts.push(`<em>${j.note}</em>`);
        const when = j.created_at ? new Date(j.created_at.replace(' ','T')).toLocaleString() : '';
        return `<div style="margin-top:8px;padding:10px 12px;background:var(--bg3);border-radius:8px;font-size:12px;color:var(--text2);line-height:1.6">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${JOURNAL_PHASE_LABELS[j.phase]||j.phase}${when?` · ${when}`:''}</div>
            ${parts.join('<br>')}
        </div>`;
    }).join('');
}

// ── Q4: "What have I done since entry?" — multi-select, during phase only ──
function renderActionsGrid(selectedCodes=[]){
    const grid = document.getElementById('actions-grid');
    if (!grid) return;
    const actions = window.JOURNAL_ACTIONS || [];
    grid.innerHTML = actions.map(a=>`<button type="button" class="btn btn-ghost btn-sm action-pill" data-code="${a.code}" onclick="toggleAction('${a.code}')">${a.label}</button>`).join('');
    window._journalState.during.actions = [...selectedCodes];
    highlightActionPills();
}

function highlightActionPills(){
    const selected = window._journalState.during.actions || [];
    document.querySelectorAll('.action-pill').forEach(b=>{
        const active = selected.includes(b.dataset.code);
        b.style.background = active ? 'var(--blue)' : '';
        b.style.color = active ? '#fff' : '';
        b.style.borderColor = active ? 'var(--blue)' : '';
    });
}

function toggleAction(code){
    const list = window._journalState.during.actions || (window._journalState.during.actions = []);
    const idx = list.indexOf(code);
    if (idx === -1) list.push(code); else list.splice(idx, 1);
    highlightActionPills();
}

// ── Q7: "How did it end?" — single select, post_close phase only ──
function renderExitTypeSelect(selectedCode=null){
    const sel = document.getElementById('f-exit_type');
    if (!sel) return;
    const types = window.JOURNAL_EXIT_TYPES || [];
    sel.innerHTML = '<option value="">— not recorded —</option>' + types.map(t=>`<option value="${t.code}" ${selectedCode===t.code?'selected':''}>${t.label}</option>`).join('');
    window._journalState.post_close.exit_type = selectedCode || null;
    sel.onchange = () => { window._journalState.post_close.exit_type = sel.value || null; };
}

// ── Q9: "Was this good process, regardless of outcome?" — Yes/No, post_close only ──
// Same clearable-toggle pattern as emotion/grade pills: tapping the already-selected
// answer clears it, since this is optional and must not default to anything either.
function toggleGoodProcess(val){
    const cur = window._journalState.post_close.good_process;
    const next = cur === val ? null : val;
    window._journalState.post_close.good_process = next;
    document.querySelectorAll('.good-process-pill').forEach(b=>{
        const active = next !== null && parseInt(b.dataset.value, 10) === next;
        b.style.background = active ? 'var(--blue)' : '';
        b.style.color = active ? '#fff' : '';
        b.style.borderColor = active ? 'var(--blue)' : '';
    });
}

function selectGrade(val){
    document.getElementById('f-setup_grade').value = val || '';
    document.querySelectorAll('.grade-pill').forEach(b=>{
        const active = !!val && b.dataset.value === val;
        b.style.background = active ? 'var(--blue)' : '';
        b.style.color = active ? '#fff' : '';
        b.style.borderColor = active ? 'var(--blue)' : '';
    });
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

    // v3.14.0: the P&L-vs-result cross-check that used to live here compared hand-typed
    // entry/exit/lot/fees against the chosen result — those fields no longer exist on
    // this form (execution is import-only now), so there's nothing left to cross-check
    // at save time. Any such mismatch would now show up in the Bitfunded importer's
    // preview/reconciliation step instead, against real broker data rather than
    // hand-typed prices.

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

    let r;
    if (hasFiles) {
        // Use FormData for file uploads
        const fd = new FormData(form);
        if(id) fd.set('id',id);
        if (id) {
            const t = allTrades.find(t => t.id == id);
            if (t && t.screenshots) fd.set('existing_screenshots', t.screenshots);
        }
        fd.set('trade_variables', JSON.stringify(collectTradeVariables()));
        fd.set('trade_journal', JSON.stringify(collectTradeJournal()));
        const resp = await fetch(`${API}?action=${id?'update_trade':'add_trade'}`,{method:'POST',body:fd});
        r = await resp.json();
    } else {
        // Use JSON for speed (no files)
        // emotion_tag/note_saw/note_why/note_unsure are deliberately not read here — the
        // three-phase trade_journal below replaced them on the form (the columns still
        // exist for historical trades, just nothing writes to them anymore).
        const data = {};
        ['trade_date','session','pair','direction','stop_loss','take_profit','result','exec_score','notes','strategy_id','setup_grade','planned_margin'].forEach(k=>{data[k]=document.getElementById('f-'+k)?.value||null;});
        data.trade_variables = collectTradeVariables();
        data.trade_journal = collectTradeJournal();
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

// ── PRE-TRADE CHECKLIST ───────────────────────────────────
// Renders from the active challenge's default strategy's 'gate' variables
// (criteria/timeframe/role/sort_order) — no hardcoded rule set here.
async function openChecklist(){
    if (window._riskStopReason) { toast('STOP — no trade: ' + window._riskStopReason, 'error'); return; }
    const wrap = document.getElementById('checklist-items');
    wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:4px 0 10px">Loading checklist…</div>';
    document.getElementById('checklist-popup').classList.add('open');

    const [ch, strategies] = await Promise.all([api('get_active_challenge'), api('get_strategies')]);
    const st = (ch && ch.default_strategy_id) ? strategies.find(s=>s.id==ch.default_strategy_id) : null;
    const gates = st ? (st.variables||[]).filter(v=>v.role==='gate' && v.is_active==1) : [];

    if(!gates.length){
        wrap.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:4px 0 10px">
            No pre-trade checklist is configured${st?` for ${st.name}`:''} yet. Set one up in Strategy Lab, or continue straight to logging the trade.
        </div>`;
    } else {
        wrap.innerHTML = gates.map(v=>`<div class="check-item" onclick="toggleCheck(this)"><input type="checkbox"><span class="check-text">${v.timeframe?`[${v.timeframe}] `:''}${(v.criteria||v.label).replace(/</g,'&lt;')}</span></div>`).join('');
    }
    updateCheckScore();
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
