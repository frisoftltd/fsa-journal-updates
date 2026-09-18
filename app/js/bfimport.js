/**
 * FundedControl — Bitfunded Paste Importer (v3.14.0)
 * Two paste boxes, preview (writes nothing), confirm (transaction, all-or-nothing).
 * preview() and confirm() both send whatever is currently in the two textareas — there
 * is no cached "last preview" on the server, so Confirm always acts on exactly what's
 * on screen, including any edits made after Preview ran.
 */

async function loadBfImport() {
    document.getElementById('bf-error').style.display = 'none';
    document.getElementById('bf-preview-result').style.display = 'none';
    document.getElementById('bf-confirm-result').style.display = 'none';
    document.getElementById('bf-confirm-btn').disabled = true;

    const sel = document.getElementById('bf-challenge-select');
    const challenges = allChallenges && allChallenges.length ? allChallenges : await api('get_challenges');
    allChallenges = challenges;
    sel.innerHTML = challenges.map(ch => `<option value="${ch.id}" ${ch.is_active == 1 ? 'selected' : ''}>${ch.name}</option>`).join('');
}

function bfShowError(msg) {
    document.getElementById('bf-preview-result').style.display = 'none';
    document.getElementById('bf-confirm-result').style.display = 'none';
    document.getElementById('bf-confirm-btn').disabled = true;
    const box = document.getElementById('bf-error');
    box.style.display = 'block';
    document.getElementById('bf-error-text').textContent = msg;
}

function bfPayload() {
    return {
        challenge_id: document.getElementById('bf-challenge-select').value,
        position_history: document.getElementById('bf-position-history').value,
        transaction_history: document.getElementById('bf-transaction-history').value,
        manual_balance: document.getElementById('bf-manual-balance').value,
    };
}

async function bfPreview() {
    document.getElementById('bf-error').style.display = 'none';
    const r = await api('preview_bitfunded_import', 'POST', bfPayload());
    if (r.error) { bfShowError(r.error); return; }

    window._bfLastPreview = r;

    const c = r.counts;
    document.getElementById('bf-summary').innerHTML =
        `Found ${c.total} position${c.total == 1 ? '' : 's'}<br>` +
        `<span style="color:var(--green)">${c.new} new</span> — will be added<br>` +
        `<span style="color:var(--blue2)">${c.matched} matched</span> — prices, fees and times will be updated<br>` +
        (c.attention ? `<span style="color:var(--orange)">${c.attention} needs attention</span> — will be skipped, resolve manually` : `<span style="color:var(--text3)">0 needs attention</span>`) +
        (r.funding ? `<br><br>Funding total: <strong>${fmt(-1 * r.funding.funding_total)}</strong> → challenge adjustment (${r.funding.row_count} transaction rows read)` : '');

    const rec = r.reconciliation;
    let recHtml = `Derived balance:   ${fmt(rec.derived_balance)}<br>`;
    recHtml += `Bitfunded balance: ${rec.bitfunded_balance !== null ? fmt(rec.bitfunded_balance) : '— (paste Transaction History or enter it manually)'}<br>`;
    if (rec.difference !== null) {
        recHtml += `Difference:        <span style="color:${rec.flagged ? 'var(--red)' : 'var(--green)'}">${fmt(rec.difference)}</span>`;
        if (rec.flagged) recHtml += ` <strong style="color:var(--red)">— over $1, check before confirming</strong>`;
    }
    document.getElementById('bf-reconciliation').innerHTML = recHtml;

    const attentionRows = r.rows.filter(row => row.status === 'attention');
    const attCard = document.getElementById('bf-attention-card');
    if (attentionRows.length) {
        attCard.style.display = 'block';
        document.getElementById('bf-attention-rows').innerHTML = attentionRows.map(row =>
            `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
                <strong>${row.pair} ${row.direction}</strong> — line ${row.line}, ${row.time_in}, entry ${row.entry_price}, pnl ${row.pnl}<br>
                <span style="color:var(--text3)">${row.reason || ''}</span>
             </div>`
        ).join('');
    } else {
        attCard.style.display = 'none';
    }

    document.getElementById('bf-preview-result').style.display = 'block';
    document.getElementById('bf-confirm-result').style.display = 'none';
    document.getElementById('bf-confirm-btn').disabled = false;
}

async function bfConfirm() {
    if (!confirm('Apply this import? Matched rows will be overwritten with Bitfunded\'s prices/times/fees; new rows will be added. This cannot be undone from this page.')) return;
    document.getElementById('bf-error').style.display = 'none';
    document.getElementById('bf-confirm-btn').disabled = true;

    const r = await api('confirm_bitfunded_import', 'POST', bfPayload());
    if (r.error) { bfShowError(r.error); return; }

    document.getElementById('bf-confirm-summary').innerHTML =
        `<span style="color:var(--green)">${r.inserted} inserted</span><br>` +
        `<span style="color:var(--blue2)">${r.updated} updated</span><br>` +
        (r.skipped_attention ? `<span style="color:var(--orange)">${r.skipped_attention} skipped (needs attention)</span><br>` : '') +
        (r.funding_updated ? `Funding adjustment updated.` : '');
    document.getElementById('bf-confirm-result').style.display = 'block';
    document.getElementById('bf-preview-result').style.display = 'none';

    loadDashboard();
}
