/**
 * FundedControl — Daily Report Card (v3.18.0)
 * Card view (header, mantras, dynamic session blocks + drag-reorder, free text, tickers,
 * AI review panel), History view (streak + alignment chart), Templates view (CRUD).
 *
 * Fixed CAT (UTC+2, no DST) offset for local<->UTC time conversion, matching
 * ReportCardController::REPORT_CARD_TZ — see that file's docblock for why this isn't a
 * per-user setting yet.
 */
const RC_TZ_OFFSET_MIN = 120;
let rcCard = null;
let rcCurrentDate = null;
let rcTemplates = [];

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function rcToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rcUtcToLocalHHMM(utcHms) {
    const [h, m] = utcHms.split(':').map(Number);
    let total = (h * 60 + m + RC_TZ_OFFSET_MIN) % 1440;
    if (total < 0) total += 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function rcLocalToUtcHHMMSS(localHm) {
    const [h, m] = (localHm || '00:00').split(':').map(Number);
    let total = (h * 60 + m - RC_TZ_OFFSET_MIN) % 1440;
    if (total < 0) total += 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

// ── VIEW SWITCH ──────────────────────────────────────────
function showRcView(view) {
    ['card', 'history', 'templates'].forEach(v => {
        document.getElementById('rc-view-' + v).classList.toggle('active', v === view);
        const tab = document.getElementById('rc-tab-' + v);
        tab.className = v === view ? 'btn btn-sm' : 'btn btn-ghost btn-sm';
    });
    if (view === 'history') loadRcHistory();
    if (view === 'templates') loadRcTemplates();
}

async function loadReportCard(date) {
    rcCurrentDate = date || rcToday();
    document.getElementById('rc-date-input').value = rcCurrentDate;
    rcCard = await api('get_report_card&date=' + rcCurrentDate);
    renderReportCard();
    await loadRcTemplates();
    loadRcReviews();
    refreshReportCardDot();
}
function rcShiftDay(delta) {
    const d = new Date(rcCurrentDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    loadReportCard(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

function renderReportCard() {
    const c = rcCard;
    document.getElementById('rc-date-label').textContent = 'Report Card — ' + c.card_date;
    document.getElementById('rc-status-badge').textContent = c.status;
    document.getElementById('rc-status-badge').className = 'badge ' + (c.status === 'complete' ? 'badge-win' : 'badge-medium');
    document.getElementById('rc-overall-grade').value = c.overall_grade || '';
    document.getElementById('rc-pnl').value = c.pnl ?? '';
    document.getElementById('rc-pnl-auto').value = c.pnl_auto != null ? fmt(c.pnl_auto) : '—';
    document.getElementById('rc-morning-temp').value = c.morning_temperature || '';
    document.getElementById('rc-sleep-quality').value = c.sleep_quality ?? '';
    document.getElementById('rc-primary-goal').value = c.primary_goal || '';
    document.getElementById('rc-learned').value = c.learned || '';
    document.getElementById('rc-changes-needed').value = c.changes_needed || '';
    document.getElementById('rc-easiest-money').value = c.easiest_money_trade || '';
    document.getElementById('rc-overview').value = c.overview || '';
    document.getElementById('rc-wins').value = c.wins || '';
    rcWarnGoal();

    // §7.4 handoff: a suggested_goal "used" from yesterday's review prefills today's card
    // if nothing has been typed yet — see rcUseSuggestedGoal() below.
    const goalKey = 'rc_suggested_goal_' + c.card_date;
    const stashedGoal = sessionStorage.getItem(goalKey);
    if (!c.primary_goal && stashedGoal) {
        document.getElementById('rc-primary-goal').value = stashedGoal;
        sessionStorage.removeItem(goalKey);
        saveReportCardHeader();
    }

    const guard = c.trade_count_guard;
    const guardBadge = document.getElementById('rc-guard-badge');
    if (guard && guard.exceeded) {
        guardBadge.style.display = 'inline-block';
        guardBadge.textContent = `⚠ ${guard.trades_today}/${guard.max_trades_day ?? '—'} today · ${guard.trades_week}/${guard.max_trades_week ?? '—'} week`;
    } else {
        guardBadge.style.display = 'none';
    }

    renderRcBlocks();
    renderRcMantras();
    renderRcTickers();

    const unassignedWrap = document.getElementById('rc-unassigned-wrap');
    if (c.unassigned_trades && c.unassigned_trades.length) {
        unassignedWrap.style.display = 'block';
        document.getElementById('rc-unassigned-list').innerHTML = c.unassigned_trades.map(t =>
            `${t.time_in ? t.time_in.slice(11, 16) : '—'} — ${t.pair} ${t.direction} — ${resultBadge(t.result)} ${t.net_pnl != null ? `<span class="${pnlCls(t.net_pnl)}">${fmt(t.net_pnl)}</span>` : ''}`
        ).join('<br>');
    } else {
        unassignedWrap.style.display = 'none';
    }
}

function rcWarnGoal() {
    const text = document.getElementById('rc-primary-goal').value;
    const looksLikeOutcome = /\$\s?\d|(?:\bmake\b|\bprofit\b|\bdon'?t lose\b|\bwin\b|\bwinning\b)/i.test(text);
    document.getElementById('rc-goal-warning').style.display = looksLikeOutcome ? 'block' : 'none';
}

async function saveReportCardHeader() {
    const payload = {
        card_date: rcCurrentDate,
        overall_grade: document.getElementById('rc-overall-grade').value,
        pnl: document.getElementById('rc-pnl').value,
        morning_temperature: document.getElementById('rc-morning-temp').value,
        sleep_quality: document.getElementById('rc-sleep-quality').value,
        primary_goal: document.getElementById('rc-primary-goal').value,
        learned: document.getElementById('rc-learned').value,
        changes_needed: document.getElementById('rc-changes-needed').value,
        easiest_money_trade: document.getElementById('rc-easiest-money').value,
        overview: document.getElementById('rc-overview').value,
        wins: document.getElementById('rc-wins').value,
    };
    rcCard = await api('save_report_card', 'POST', payload);
    renderReportCard();
}

// ── SESSION BLOCKS ───────────────────────────────────────
function renderRcBlocks() {
    const wrap = document.getElementById('rc-blocks-list');
    const blocks = rcCard.blocks || [];
    document.getElementById('rc-blocks-empty').style.display = blocks.length ? 'none' : 'block';
    const gradeBadge = g => g === 'F' ? 'badge-loss' : (g === 'A' || g === 'B' ? 'badge-win' : 'badge-be');
    wrap.innerHTML = blocks.map(b => `
        <div class="rc-block ${b.overlaps ? 'overlap' : ''}" draggable="true" data-id="${b.id}"
             ondragstart="rcBlockDragStart(event)" ondragover="rcBlockDragOver(event)" ondrop="rcBlockDrop(event)" ondragend="rcBlockDragEnd(event)">
          <div class="rc-block-head">
            <div>
              <span class="rc-block-time">${b.start_local}–${b.end_local}</span>
              <strong style="margin-left:8px">${escapeHtml(b.label)}</strong>
              ${b.market_session !== 'none' ? `<span class="badge badge-long" style="margin-left:6px">${b.market_session}</span>` : ''}
              ${b.grade ? `<span class="badge ${gradeBadge(b.grade)}" style="margin-left:6px">${b.grade}</span>` : ''}
              ${b.overlaps ? '<span class="rc-warn" style="margin-left:6px">⚠ overlaps another block</span>' : ''}
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" onclick="openRcBlockModal(${b.id})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="deleteRcBlock(${b.id})">✕</button>
            </div>
          </div>
          ${(b.sizing || b.playbook_only || b.in_my_favor || b.comments) ? `<div style="margin-top:6px;font-size:12px;color:var(--text2)">
              ${b.playbook_only ? '✅ Playbook only &nbsp; ' : ''}${b.in_my_favor ? '📈 In my favor &nbsp; ' : ''}${b.sizing ? `Sizing: ${escapeHtml(b.sizing)} &nbsp; ` : ''}${escapeHtml(b.comments || '')}
            </div>` : ''}
          ${(b.trades && b.trades.length) ? `<div class="rc-block-trades">${b.trades.map(t => `${t.time_in ? t.time_in.slice(11, 16) : ''} ${t.pair} ${t.direction} — ${t.result || 'Open'} ${t.net_pnl != null ? fmt(t.net_pnl) : ''}`).join('<br>')}</div>` : ''}
        </div>
    `).join('');
}

let rcDragId = null;
function rcBlockDragStart(e) { rcDragId = e.currentTarget.dataset.id; e.currentTarget.classList.add('dragging'); }
function rcBlockDragEnd(e) { e.currentTarget.classList.remove('dragging'); }
function rcBlockDragOver(e) { e.preventDefault(); }
function rcBlockDrop(e) {
    e.preventDefault();
    const targetEl = e.currentTarget;
    if (targetEl.dataset.id === rcDragId) return;
    const wrap = document.getElementById('rc-blocks-list');
    const dragEl = wrap.querySelector(`[data-id="${rcDragId}"]`);
    const rect = targetEl.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    wrap.insertBefore(dragEl, before ? targetEl : targetEl.nextSibling);
    const order = Array.from(wrap.children).map(el => el.dataset.id);
    api('reorder_report_card_blocks', 'POST', { card_id: rcCard.id, order });
}

function openRcBlockModal(id) {
    const b = id ? (rcCard.blocks || []).find(x => x.id === id) : null;
    document.getElementById('rc-block-modal-title').textContent = b ? '✏️ EDIT SESSION BLOCK' : '➕ ADD SESSION BLOCK';
    document.getElementById('rc-block-id').value = b ? b.id : '';
    document.getElementById('rc-block-label').value = b ? b.label : '';
    document.getElementById('rc-block-start').value = b ? rcUtcToLocalHHMM(b.start_utc) : '';
    document.getElementById('rc-block-end').value = b ? rcUtcToLocalHHMM(b.end_utc) : '';
    document.getElementById('rc-block-session').value = b ? b.market_session : 'none';
    document.getElementById('rc-block-grade').value = b ? (b.grade || '') : '';
    document.getElementById('rc-block-sizing').value = b ? (b.sizing || '') : '';
    document.getElementById('rc-block-playbook').checked = !!(b && b.playbook_only);
    document.getElementById('rc-block-favor').checked = !!(b && b.in_my_favor);
    document.getElementById('rc-block-comments').value = b ? (b.comments || '') : '';
    document.getElementById('rc-block-modal').classList.add('open');
}
function closeRcBlockModal() { document.getElementById('rc-block-modal').classList.remove('open'); }

async function saveRcBlock() {
    const id = document.getElementById('rc-block-id').value;
    const label = document.getElementById('rc-block-label').value.trim();
    if (!label) { toast('Block label is required', 'error'); return; }
    const start = document.getElementById('rc-block-start').value;
    const end = document.getElementById('rc-block-end').value;
    if (!start || !end) { toast('Start and end time are required', 'error'); return; }
    const payload = {
        label, start_utc: rcLocalToUtcHHMMSS(start), end_utc: rcLocalToUtcHHMMSS(end),
        market_session: document.getElementById('rc-block-session').value,
        grade: document.getElementById('rc-block-grade').value,
        sizing: document.getElementById('rc-block-sizing').value,
        playbook_only: document.getElementById('rc-block-playbook').checked,
        in_my_favor: document.getElementById('rc-block-favor').checked,
        comments: document.getElementById('rc-block-comments').value,
    };
    if (id) { payload.id = id; await api('update_report_card_block', 'POST', payload); }
    else { payload.card_id = rcCard.id; await api('add_report_card_block', 'POST', payload); }
    closeRcBlockModal();
    loadReportCard(rcCurrentDate);
}
async function deleteRcBlock(id) {
    if (!confirm('Delete this block?')) return;
    await api('delete_report_card_block', 'POST', { id });
    loadReportCard(rcCurrentDate);
}
function rcApplySelectedTemplate() {
    const sel = document.getElementById('rc-apply-template-select');
    const templateId = sel.value;
    if (!templateId) return;
    if (!confirm('Replace today\'s current blocks with this template\'s blocks?')) { sel.value = ''; return; }
    api('apply_report_card_template', 'POST', { card_id: rcCard.id, template_id: templateId }).then(() => {
        sel.value = '';
        loadReportCard(rcCurrentDate);
    });
}
function rcSaveBlocksAsTemplate() {
    const name = prompt('Save these blocks as a template named:');
    if (!name) return;
    api('save_report_card_blocks_as_template', 'POST', { card_id: rcCard.id, name }).then(r => {
        if (r.success === false) { toast(r.error || 'Failed', 'error'); return; }
        toast('Template saved', 'success');
        loadRcTemplates();
    });
}

// ── MANTRAS ──────────────────────────────────────────────
function renderRcMantras() {
    const wrap = document.getElementById('rc-mantras-list');
    const mantras = rcCard.mantras || [];
    wrap.innerHTML = mantras.map(m => `
        <div class="rc-mantra-item">
          <input type="checkbox" ${m.checked ? 'checked' : ''} onchange="toggleRcMantra(${m.id}, this.checked)">
          <span style="flex:1">${escapeHtml(m.text)}</span>
          <button class="btn btn-ghost btn-sm" onclick="deleteRcMantra(${m.id})">✕</button>
        </div>
    `).join('') || '<div style="color:var(--text3);font-size:12px">No standing reminders yet — add one below.</div>';
}
async function addRcMantra() {
    const input = document.getElementById('rc-new-mantra');
    const text = input.value.trim();
    if (!text) return;
    await api('add_report_card_mantra', 'POST', { text });
    input.value = '';
    loadReportCard(rcCurrentDate);
}
async function deleteRcMantra(id) {
    if (!confirm('Remove this reminder for good?')) return;
    await api('delete_report_card_mantra', 'POST', { id });
    loadReportCard(rcCurrentDate);
}
async function toggleRcMantra(id, checked) {
    await api('toggle_report_card_mantra_check', 'POST', { card_id: rcCard.id, mantra_id: id, checked });
}

// ── TICKERS ──────────────────────────────────────────────
function renderRcTickers() {
    const wrap = document.getElementById('rc-tickers-list');
    const uid = currentUser.id;
    const tks = rcCard.tickers || [];
    wrap.innerHTML = tks.map(t => `
        <div class="rc-ticker-row" data-id="${t.id}">
          <div class="form-grid-2">
            <div class="form-group"><label>Ticker</label><input type="text" value="${escapeHtml(t.ticker)}" onchange="updateRcTicker(${t.id},'ticker',this.value)"></div>
            <div class="form-group"><label>P&amp;L</label><input type="number" step="0.01" value="${t.pnl != null ? t.pnl : ''}" onchange="updateRcTicker(${t.id},'pnl',this.value)"></div>
            <div class="form-group full"><label>Trade Analysis</label><textarea rows="2" onchange="updateRcTicker(${t.id},'trade_analysis',this.value)">${escapeHtml(t.trade_analysis || '')}</textarea></div>
            <div class="form-group full"><label>Chart Notes</label><textarea rows="2" onchange="updateRcTicker(${t.id},'chart_notes',this.value)">${escapeHtml(t.chart_notes || '')}</textarea></div>
          </div>
          <div class="rc-ticker-imgs">
            ${(t.images || []).map(img => `<img src="media/uploads/${uid}/${img.file_path}" onclick="deleteRcTickerImage(${img.id})" title="Click to delete">`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
            <input type="file" accept="image/*" onchange="uploadRcTickerImage(${t.id}, this)">
            <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="deleteRcTicker(${t.id})">Delete Row</button>
          </div>
        </div>
    `).join('') || '<div style="color:var(--text3);font-size:12px">No tickers yet.</div>';
}
async function addRcTicker() {
    await api('add_report_card_ticker', 'POST', { card_id: rcCard.id, ticker: 'NEW' });
    loadReportCard(rcCurrentDate);
}
async function updateRcTicker(id, field, value) {
    const t = (rcCard.tickers || []).find(x => x.id === id);
    if (!t) return;
    const payload = { id, ticker: t.ticker, pnl: t.pnl, trade_analysis: t.trade_analysis, chart_notes: t.chart_notes };
    payload[field] = value;
    await api('update_report_card_ticker', 'POST', payload);
    t[field] = value;
}
async function deleteRcTicker(id) {
    if (!confirm('Delete this ticker row and its images?')) return;
    await api('delete_report_card_ticker', 'POST', { id });
    loadReportCard(rcCurrentDate);
}
async function uploadRcTickerImage(tickerId, input) {
    if (!input.files.length) return;
    const fd = new FormData();
    fd.append('ticker_id', tickerId);
    fd.append('image', input.files[0]);
    const res = await fetch('includes/api.php?action=upload_report_card_ticker_image', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success === false) { toast(data.error || 'Upload failed', 'error'); return; }
    loadReportCard(rcCurrentDate);
}
async function deleteRcTickerImage(id) {
    if (!confirm('Delete this image?')) return;
    await api('delete_report_card_ticker_image', 'POST', { id });
    loadReportCard(rcCurrentDate);
}

// ── AI REVIEW ────────────────────────────────────────────
async function loadRcReviews() {
    if (!rcCard) return;
    const list = await api('get_ai_reviews&card_id=' + rcCard.id);
    if (!list.length) { renderRcReviewPanel(null); return; }
    const full = await api('get_ai_review&id=' + list[0].id);
    renderRcReviewPanel(full);
}
async function runRcAiReview() {
    if (rcCard.status !== 'complete') { toast('Complete the card first — overall grade, primary goal, and every block graded', 'warning'); return; }
    const btn = document.getElementById('rc-run-review-btn');
    btn.disabled = true; btn.textContent = 'Running…';
    document.getElementById('rc-review-panel').innerHTML = '<div style="color:var(--text3);font-size:12px">Running…</div>';
    try {
        const review = await api('run_ai_review', 'POST', { card_id: rcCard.id });
        renderRcReviewPanel(review);
        toast(review.status === 'complete' ? 'AI Review complete' : ('AI Review failed: ' + (review.error_message || review.error || '')), review.status === 'complete' ? 'success' : 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Run AI Review';
    }
}
function renderRcReviewPanel(review) {
    const panel = document.getElementById('rc-review-panel');
    // A rejected request (e.g. the card wasn't actually complete) comes back as
    // jsonError()'s {error:"..."} shape, not a review row — render it the same way as a
    // failed run rather than falling through to the "complete" branch with undefined scores.
    if (review && review.error && !review.status) review = { status: 'failed', error_message: review.error };
    if (!review) {
        panel.innerHTML = '<div style="color:var(--text3);font-size:12px">No review yet. Complete the card (overall grade, primary goal, every block graded), then run one.</div>';
        return;
    }
    if (review.status === 'running' || review.status === 'pending') {
        panel.innerHTML = '<div style="color:var(--text3);font-size:12px">Running…</div>';
        return;
    }
    if (review.status === 'failed') {
        panel.innerHTML = `<div class="alert alert-danger">AI Review failed: ${escapeHtml(review.error_message || 'unknown error')}</div>
            <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="runRcAiReview()">Retry</button>`;
        return;
    }
    const typeLabels = { contradiction: '⚡ Contradiction', behavior_pattern: '📊 Behavior Pattern', thinking_pattern: '🧠 Thinking Pattern', strength: '✅ Strength', risk: '⚠ Risk' };
    const findingsHtml = (review.findings || []).map(f => `
        <div class="rc-finding sev-${f.severity}">
          <div class="rc-finding-title">${typeLabels[f.type] || f.type}: ${escapeHtml(f.title)}</div>
          ${f.detail ? `<div class="rc-finding-detail">${escapeHtml(f.detail)}</div>` : ''}
          ${!f.acknowledged ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="acknowledgeRcFinding(${f.id})">Acknowledge</button>` : '<span class="badge badge-win" style="margin-top:6px;display:inline-block">Acknowledged</span>'}
        </div>
    `).join('') || '<div style="color:var(--text3);font-size:12px">No findings.</div>';

    panel.innerHTML = `
        <div style="display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap">
          <div><div class="kpi-label">Alignment</div><div class="kpi-val">${review.alignment_score}</div></div>
          <div><div class="kpi-label">Discipline</div><div class="kpi-val">${review.discipline_score}</div></div>
        </div>
        ${review.summary ? `<p style="font-size:13px;color:var(--text2);margin-bottom:12px">${escapeHtml(review.summary)}</p>` : ''}
        ${review.one_change ? `<div class="alert alert-info">One change: ${escapeHtml(review.one_change)}</div>` : ''}
        ${review.suggested_goal ? `<div style="margin:10px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:12px;color:var(--text2)">Suggested goal for tomorrow: <em>${escapeHtml(review.suggested_goal)}</em></span>
              <button class="btn btn-ghost btn-sm" onclick="rcUseSuggestedGoal(this.dataset.goal)" data-goal="${escapeHtml(review.suggested_goal)}">Use as tomorrow's primary goal</button>
            </div>` : ''}
        ${findingsHtml}
    `;
}
function rcUseSuggestedGoal(text) {
    const d = new Date(rcCurrentDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const key = 'rc_suggested_goal_' + `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    sessionStorage.setItem(key, text);
    toast('Will prefill tomorrow\'s primary goal', 'success');
}
async function acknowledgeRcFinding(id) {
    await api('acknowledge_ai_finding', 'POST', { id });
    loadRcReviews();
}

// ── HISTORY ──────────────────────────────────────────────
async function loadRcHistory() {
    const data = await api('get_report_card_history&limit=60');
    document.getElementById('rc-history-streak').textContent = data.streak + (data.streak === 1 ? ' day' : ' days');
    const gradeBadge = g => g === 'F' ? 'badge-loss' : (g === 'A' || g === 'B' ? 'badge-win' : 'badge-be');
    document.getElementById('rc-history-body').innerHTML = data.cards.map(c => `
        <tr class="rc-history-row" onclick="rcOpenFromHistory('${c.card_date}')">
          <td>${c.card_date}</td>
          <td>${c.overall_grade ? `<span class="badge ${gradeBadge(c.overall_grade)}">${c.overall_grade}</span>` : '—'}</td>
          <td class="${c.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${c.pnl != null ? fmt(c.pnl) : '—'}</td>
          <td>${c.pnl_auto != null ? fmt(c.pnl_auto) : '—'}</td>
          <td>${c.block_count}</td>
          <td><span class="badge ${c.status === 'complete' ? 'badge-win' : 'badge-medium'}">${c.status}</span></td>
          <td>${c.alignment_score != null ? c.alignment_score : '—'}</td>
        </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text3)">No cards yet.</td></tr>';

    destroyCharts('rcAlignment');
    const chronological = [...data.cards].reverse().filter(c => c.alignment_score != null);
    charts.rcAlignment = new Chart(document.getElementById('rc-alignment-chart'), {
        type: 'line',
        data: { labels: chronological.map(c => c.card_date), datasets: [{ label: 'Alignment Score', data: chronological.map(c => c.alignment_score), borderColor: '#1A56DB', backgroundColor: 'rgba(26,86,219,0.1)', tension: 0.3, fill: true }] },
        options: chartOpts(),
    });
}
function rcOpenFromHistory(date) {
    showRcView('card');
    loadReportCard(date);
}

// ── TEMPLATES ────────────────────────────────────────────
async function loadRcTemplates() {
    rcTemplates = await api('get_report_card_templates');
    if (document.getElementById('rc-view-templates').classList.contains('active')) renderRcTemplatesList();
    const sel = document.getElementById('rc-apply-template-select');
    if (sel) sel.innerHTML = '<option value="">Load template…</option>' + rcTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}
function renderRcTemplatesList() {
    const wrap = document.getElementById('rc-templates-list');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    wrap.innerHTML = rcTemplates.map(t => `
        <div class="rc-block">
          <div class="rc-block-head">
            <div><strong>${escapeHtml(t.name)}</strong> ${t.is_default ? '<span class="badge badge-win" style="margin-left:6px">default</span>' : ''} ${t.weekday_default != null ? `<span class="badge badge-long" style="margin-left:6px">${days[t.weekday_default]}</span>` : ''}</div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" onclick="openRcTemplateModal(${t.id})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="deleteRcTemplate(${t.id})">Delete</button>
            </div>
          </div>
          <div style="margin-top:6px;font-size:12px;color:var(--text2)">${(t.blocks || []).map(b => `${escapeHtml(b.label)} ${rcUtcToLocalHHMM(b.start_utc)}–${rcUtcToLocalHHMM(b.end_utc)}`).join(' · ') || 'No blocks'}</div>
        </div>
    `).join('') || '<div style="color:var(--text3);font-size:12px">No templates yet.</div>';
}
async function deleteRcTemplate(id) {
    if (!confirm('Delete this template? Existing cards already using its blocks are unaffected.')) return;
    await api('delete_report_card_template', 'POST', { id });
    loadRcTemplates();
}
function openRcTemplateModal(id) {
    const t = id ? rcTemplates.find(x => x.id === id) : null;
    document.getElementById('rc-template-modal-title').textContent = t ? '✏️ EDIT TEMPLATE' : '➕ NEW TEMPLATE';
    document.getElementById('rc-template-id').value = t ? t.id : '';
    document.getElementById('rc-template-name').value = t ? t.name : '';
    document.getElementById('rc-template-weekday').value = (t && t.weekday_default != null) ? t.weekday_default : '';
    document.getElementById('rc-template-default').checked = !!(t && t.is_default);
    const rows = document.getElementById('rc-template-blocks');
    rows.innerHTML = '';
    (t && t.blocks || []).forEach(b => addRcTemplateBlockRow(b));
    document.getElementById('rc-template-modal').classList.add('open');
}
function closeRcTemplateModal() { document.getElementById('rc-template-modal').classList.remove('open'); }
function addRcTemplateBlockRow(b) {
    const rows = document.getElementById('rc-template-blocks');
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
    div.innerHTML = `
        <input type="text" placeholder="Label" style="flex:2" class="rc-tb-label" value="${b ? escapeHtml(b.label) : ''}">
        <input type="time" style="flex:1" class="rc-tb-start" value="${b ? rcUtcToLocalHHMM(b.start_utc) : ''}">
        <input type="time" style="flex:1" class="rc-tb-end" value="${b ? rcUtcToLocalHHMM(b.end_utc) : ''}">
        <select style="flex:1" class="rc-tb-session">
          <option value="none">None</option><option value="asia">Asia</option><option value="london">London</option><option value="newyork">NY</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()">✕</button>
    `;
    rows.appendChild(div);
    if (b) div.querySelector('.rc-tb-session').value = b.market_session;
}
function saveRcTemplate() {
    const id = document.getElementById('rc-template-id').value;
    const name = document.getElementById('rc-template-name').value.trim();
    if (!name) { toast('Template name is required', 'error'); return; }
    const weekday = document.getElementById('rc-template-weekday').value;
    const blocks = Array.from(document.getElementById('rc-template-blocks').children).map(row => ({
        label: row.querySelector('.rc-tb-label').value.trim(),
        start_utc: rcLocalToUtcHHMMSS(row.querySelector('.rc-tb-start').value),
        end_utc: rcLocalToUtcHHMMSS(row.querySelector('.rc-tb-end').value),
        market_session: row.querySelector('.rc-tb-session').value,
    })).filter(b => b.label);
    const payload = { name, weekday_default: weekday === '' ? '' : parseInt(weekday, 10), is_default: document.getElementById('rc-template-default').checked, blocks };
    if (id) payload.id = id;
    api(id ? 'update_report_card_template' : 'add_report_card_template', 'POST', payload).then(r => {
        if (r.success === false) { toast(r.error || 'Failed', 'error'); return; }
        closeRcTemplateModal();
        loadRcTemplates();
        toast('Template saved', 'success');
    });
}

// ── SIDEBAR DOT (rule: draft after 20:00 local) ─────────
async function refreshReportCardDot() {
    try {
        const c = rcCard && rcCard.card_date === rcToday() ? rcCard : await api('get_report_card&date=' + rcToday());
        const dot = document.getElementById('reportcard-dot');
        if (dot) dot.style.display = (new Date().getHours() >= 20 && c.status === 'draft') ? 'inline-block' : 'none';
    } catch (e) { /* non-critical UI affordance — a failed check just leaves the dot as-is */ }
}
