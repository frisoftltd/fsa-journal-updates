/**
 * FundedControl — Saved Backtests (v3.20.2)
 *
 * Split out of js/backtest.js's old Screen C into its own sidebar page. Uses btApi()/
 * escapeHtml()/btStatusBadge() from js/backtest.js (loaded first in index.php) rather
 * than duplicating them — this file only owns this page's own list/card rendering,
 * delete flow, and the empty/error/loading states.
 */

async function loadSavedBacktests() {
    const el = document.getElementById('sb-content');
    el.innerHTML = '<div class="sb-loading" style="color:var(--text3);padding:24px;text-align:center">Loading…</div>';

    const sessions = await btApi('get_backtest_sessions');

    if (sessions && sessions.error) {
        el.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'card';
        wrap.style.textAlign = 'center';
        wrap.style.padding = '32px 20px';
        const msg = document.createElement('div');
        msg.style.color = 'var(--red)';
        msg.style.marginBottom = '14px';
        msg.textContent = `Failed to load backtests — ${sessions.error}`;
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-primary btn-sm';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = loadSavedBacktests;
        wrap.appendChild(msg);
        wrap.appendChild(retryBtn);
        el.appendChild(wrap);
        return;
    }

    if (!Array.isArray(sessions) || !sessions.length) {
        el.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'card';
        wrap.style.textAlign = 'center';
        wrap.style.padding = '40px 20px';
        const msg = document.createElement('div');
        msg.style.color = 'var(--text3)';
        msg.style.marginBottom = '14px';
        msg.textContent = "No backtests yet.";
        const createBtn = document.createElement('button');
        createBtn.className = 'btn btn-primary';
        createBtn.textContent = 'Create your first backtest';
        createBtn.onclick = () => showPage('backtest');
        wrap.appendChild(msg);
        wrap.appendChild(createBtn);
        el.appendChild(wrap);
        return;
    }

    el.innerHTML = `<div class="sb-grid">${sessions.map(sbCardHtml).join('')}</div>`;
}

function sbCardHtml(s) {
    const progressPct = s.progress_to_target_pct === null ? null : Math.max(0, Math.min(100, s.progress_to_target_pct));
    const progressLabel = s.status === 'passed'
        ? '✅ Target reached'
        : (s.status === 'failed'
            ? '❌ ' + escapeHtml(s.fail_reason || 'Failed')
            : (progressPct !== null ? `${s.progress_to_target_pct}% to target` : '—'));
    const progressFillClass = s.status === 'failed' ? 'red' : 'green';

    return `
    <div class="sb-card">
        <div class="sb-card-head">
            <div class="sb-card-name">${escapeHtml(s.session_name || '(untitled)')}</div>
            ${btStatusBadge(s.status)}
        </div>
        <div class="sb-card-meta">
            <span>${s.blind_mode ? '🙈 Blind' : escapeHtml(s.symbol || '—')}</span>
            <span>${escapeHtml(s.replay_timeframe)}</span>
            <span>${(s.created_at || '').slice(0, 10)}</span>
        </div>
        <div class="sb-card-equity ${pnlCls(s.equity - s.starting_balance)}">${fmt(s.equity)}</div>
        <div class="sb-progress">
            <div class="sb-progress-bar"><div class="sb-progress-fill ${progressFillClass}" style="width:${progressPct !== null ? progressPct : 0}%"></div></div>
            <div class="sb-progress-label">${progressLabel}</div>
        </div>
        <div class="sb-card-actions">
            <button class="btn btn-primary btn-sm" style="flex:1" onclick="openBacktestFromList(${s.id})">${s.status === 'active' ? 'Resume' : 'Review'}</button>
            <button class="btn btn-ghost btn-sm" onclick="deleteBacktestSession(${s.id}, this)" title="Delete">🗑</button>
        </div>
    </div>`;
}

/** Navigates to the Backtesting page and opens this session in Screen B, in one call —
 *  v3.20.11: showPage('backtest', id) forwards id to loadBacktest(id), which opens that
 *  session directly instead of showing the form, and also persists it to the URL hash
 *  (#backtest:<id>) so a refresh lands back here. Previously this called showPage('backtest')
 *  and openBacktestSession(id) as two separate steps. */
function openBacktestFromList(id) {
    showPage('backtest', id);
}

async function deleteBacktestSession(id, btn) {
    if (!confirm('Delete this backtest? This also removes its simulated trades. This cannot be undone.')) return;
    btn.disabled = true;
    const res = await btApi('delete_backtest_session', 'POST', { id });
    if (res && res.error) {
        toast('Failed to delete — ' + res.error, 'error');
        btn.disabled = false;
        return;
    }
    // v3.20.5: btActiveSessionId (js/backtest.js, loaded before this file and sharing
    // its top-level scope) is a plain in-memory variable that outlives navigating away
    // from the replay window -- if the session just deleted is the one it still points
    // at, clear it immediately rather than leaving a stale reference sitting around
    // until something else happens to reset it.
    if (btActiveSessionId === id) {
        btActiveSessionId = null;
        btSession = null;
    }
    toast('Backtest deleted');
    loadSavedBacktests();
}
