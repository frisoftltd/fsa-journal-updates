
/**
 * FundedControl — Behavioral Review Engine Module (v3.6.0, Wave 3)
 * Deterministic AI-style nudges. Replaces the old manual weekly-review UI
 * (ReviewController / weekly_reviews are untouched on the backend).
 */
let reviewState = { periodType: 'weekly', periodStart: null, challengeId: '' };

function loadReviewEngine() {
    if (!reviewState.periodStart) reviewState.periodStart = new Date().toISOString().split('T')[0];
    populateReviewScopeSelect();
    fetchReview();
}

function populateReviewScopeSelect() {
    const sel = document.getElementById('rv-scope');
    if (!sel || sel.dataset.filled === '1') return;
    const opts = ['<option value="">All Combined</option>'];
    (allChallenges || []).forEach(ch => opts.push(`<option value="${ch.id}">${ch.name}</option>`));
    sel.innerHTML = opts.join('');
    if (allChallenges && allChallenges.length) {
        const active = allChallenges.find(c => c.is_active == 1);
        if (active) sel.value = active.id;
    }
    sel.dataset.filled = '1';
}

function reviewPeriodTypeChanged() {
    reviewState.periodType = document.getElementById('rv-period-type').value;
    fetchReview();
}

function reviewShiftPeriod(dir) {
    const d = new Date(reviewState.periodStart + 'T00:00:00');
    const map = { daily: 1, weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };
    d.setDate(d.getDate() + dir * (map[reviewState.periodType] || 7));
    reviewState.periodStart = d.toISOString().split('T')[0];
    fetchReview();
}

function reviewJumpToday() {
    reviewState.periodStart = new Date().toISOString().split('T')[0];
    fetchReview();
}

async function fetchReview() {
    document.getElementById('rv-period-type').value = reviewState.periodType;
    reviewState.challengeId = document.getElementById('rv-scope')?.value || '';

    let action = `get_review&period_type=${reviewState.periodType}&period_start=${reviewState.periodStart}`;
    if (reviewState.challengeId) action += `&challenge_id=${reviewState.challengeId}`;

    const data = await api(action);
    if (data.error) { toast(data.error, 'error'); return; }

    reviewState.periodStart = data.period.start;
    renderReviewPeriodLabel(data.period);
    renderReviewMetrics(data.metrics);
    renderReviewInsights(data);
}

function renderReviewPeriodLabel(period) {
    const el = document.getElementById('rv-period-label');
    el.textContent = period.start === period.end ? period.start : `${period.start} → ${period.end}`;
}

function renderReviewMetrics(m) {
    document.getElementById('rv-m-trades').textContent = m.trades_closed;
    document.getElementById('rv-m-winrate').textContent = m.trades_closed ? fmtPct(m.win_rate) : '—';
    const rEl = document.getElementById('rv-m-avgr');
    rEl.textContent = m.trades_closed ? fmtR(m.avg_r) : '—';
    rEl.className = 'kpi-val ' + (m.avg_r >= 0 ? 'green' : 'red');
    const eEl = document.getElementById('rv-m-expectancy');
    eEl.textContent = m.trades_closed ? fmtR(m.expectancy_r) : '—';
    eEl.className = 'kpi-val ' + (m.expectancy_r >= 0 ? 'green' : 'red');
    const pEl = document.getElementById('rv-m-pnl');
    pEl.textContent = m.trades_closed ? fmt(m.net_pnl) : '—';
    pEl.className = 'kpi-val ' + pnlCls(m.net_pnl);
}

const REVIEW_SEVERITY = {
    alert: { color: '#DC3545', bg: '#FDEAEA', label: 'ALERT' },
    watch: { color: '#F59E0B', bg: '#FEF3E2', label: 'WATCH' },
    good:  { color: '#0FA958', bg: '#E3F2E8', label: 'GOOD' },
};

function renderReviewInsights(data) {
    const c = document.getElementById('rv-insights');
    if (data.empty || !data.insights || !data.insights.length) {
        c.innerHTML = `<div class="card"><div class="empty">
            <div class="empty-icon">🧭</div>
            <p>${data.empty ? 'No trades logged in this period.' : 'No behavioral patterns detected yet — keep logging to unlock insights.'}</p>
        </div></div>`;
        return;
    }
    c.innerHTML = data.insights.map(i => {
        const s = REVIEW_SEVERITY[i.severity] || REVIEW_SEVERITY.watch;
        const tag = i.conclusive ? `based on ${i.based_on_n} trades · conclusive` : `based on ${i.based_on_n} trades · early signal`;
        return `<div class="card" style="margin-bottom:10px;border-left:3px solid ${s.color}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
                <div style="font-family:var(--font-head);font-size:13px;font-weight:600">${i.headline}</div>
                <span style="flex-shrink:0;background:${s.bg};color:${s.color};font-size:10px;font-weight:600;letter-spacing:0.5px;padding:3px 8px;border-radius:4px">${s.label}</span>
            </div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:8px">${i.detail}</div>
            ${i.recommendation ? `<div style="font-size:12px;color:var(--blue);margin-bottom:8px">→ ${i.recommendation}</div>` : ''}
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">${tag}</div>
        </div>`;
    }).join('');
}
