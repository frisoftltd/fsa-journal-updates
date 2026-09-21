
/**
 * FundedControl — Auto Risk Calculator (v3.17.0)
 * Stop loss % is the only required input. Balance, risk %, margin-in-use and the trade-
 * limits status strip all come from CalculatorController (auto_risk_preview /
 * get_risk_status) — nothing here is hardcoded, and there is no Calculate button:
 * scheduleCalcUpdate() debounces a live recompute on every relevant input change.
 */

let _calcChallenges = [];

async function loadCalculator(){
    _calcChallenges = await api('get_challenges');
    const sel = document.getElementById('calc-challenge');
    sel.innerHTML = _calcChallenges.map(c => `<option value="${c.id}" ${c.is_active==1?'selected':''}>${c.name}</option>`).join('');

    const active = _calcChallenges.find(c => c.is_active == 1) || _calcChallenges[0];
    if (active && active.default_leverage !== null && active.default_leverage !== undefined) {
        document.getElementById('calc-leverage').value = active.default_leverage;
    }

    runCalcUpdate();
}

// Switching challenges resets the leverage field to that challenge's own default (only
// when the field is still whatever the previous challenge defaulted to left blank —
// simplest correct rule: always reset on switch, since a leverage typed for one
// challenge's margin requirements has no reason to carry over to a different one).
function onCalcChallengeChange(){
    const id = document.getElementById('calc-challenge').value;
    const ch = _calcChallenges.find(c => c.id == id);
    document.getElementById('calc-leverage').value = (ch && ch.default_leverage !== null && ch.default_leverage !== undefined) ? ch.default_leverage : '';
    scheduleCalcUpdate();
}

let _calcTimer = null;
function scheduleCalcUpdate(){
    clearTimeout(_calcTimer);
    _calcTimer = setTimeout(runCalcUpdate, 250);
}

function fmtNum(n){
    return parseFloat(n).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:2});
}

// null/undefined limit -> not tracked, no styling. At-or-past the limit -> red. Exactly
// one below -> amber. Only meaningful for the three count-based limits (trades today/
// week, losses today) — see renderCalcStatus() for how Daily P&L, a dollar figure, gets
// its own (separately documented) threshold-based styling instead.
function limitStyle(count, limit){
    if (limit === null || limit === undefined) return '';
    if (count >= limit) return 'color:var(--red);font-weight:700';
    if (count === limit - 1) return 'color:var(--orange)';
    return '';
}

function renderCalcStatus(status){
    const L = status.limits;
    const dayEl = document.getElementById('cs-trades-day');
    dayEl.textContent = `Today ${status.trades_today}/${L.max_trades_day ?? '—'}`;
    dayEl.style.cssText = limitStyle(status.trades_today, L.max_trades_day);

    const weekEl = document.getElementById('cs-trades-week');
    weekEl.textContent = `Week ${status.trades_week}/${L.max_trades_week ?? '—'}`;
    weekEl.style.cssText = limitStyle(status.trades_week, L.max_trades_week);

    const lossEl = document.getElementById('cs-losses-day');
    lossEl.textContent = `Losses today ${status.losses_today}/${L.max_losses_day ?? '—'}`;
    lossEl.style.cssText = limitStyle(status.losses_today, L.max_losses_day);

    // Daily P&L is a dollar figure, not a count, so "one below the limit" doesn't apply
    // literally — red once the loss reaches the configured daily_loss_usd threshold,
    // amber inside the last 20% of room before it. A derived interpretation, not a
    // formula the briefing specified; documented here and in CLAUDE.md for that reason.
    const pnlEl = document.getElementById('cs-daily-pnl');
    pnlEl.textContent = `Daily P&L ${fmt(status.daily_pnl)}`;
    let pnlStyle = '';
    if (L.daily_loss_usd !== null) {
        if (status.daily_pnl <= -L.daily_loss_usd) pnlStyle = 'color:var(--red);font-weight:700';
        else if (status.daily_pnl <= -0.8 * L.daily_loss_usd) pnlStyle = 'color:var(--orange)';
    }
    pnlEl.style.cssText = pnlStyle;

    const stopEl = document.getElementById('calc-status-stop');
    const normalEl = document.getElementById('calc-status-normal');
    if (status.stopped) {
        stopEl.textContent = `STOP — ${status.reason}`;
        stopEl.style.display = 'block';
        normalEl.style.display = 'none';
    } else {
        stopEl.style.display = 'none';
        normalEl.style.display = 'flex';
    }
}

// v3.17.1 §3 — always rendered, including during a STOP: this is exactly what
// margin_in_use above sums, so a trader can see WHY available margin is what it is, not
// just the total. No positions -> a plain "no open positions" line, not an empty card.
function renderOpenPositions(positions){
    const wrap = document.getElementById('calc-open-positions');
    if (!positions || !positions.length) {
        wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:8px 0">No open positions.</div>';
        return;
    }
    wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">` + positions.map(p => {
        const dirColor = p.direction === 'Long' ? 'var(--green)' : 'var(--red)';
        const margin = p.planned_margin != null ? '$' + p.planned_margin.toFixed(2) : '—';
        return `<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg3);border-radius:6px;padding:8px 12px;font-size:12px">
            <span><span style="color:${dirColor};font-weight:600">${p.direction}</span> ${p.pair} <span style="color:var(--text3)">— ${p.trade_date}</span></span>
            <span style="font-family:var(--font-head)">${margin}</span>
        </div>`;
    }).join('') + `</div>`;
}

// Replaces the three hardcoded Recovery/Normal/Passing cards — those showed a ladder that
// didn't match this challenge's real one (see CLAUDE.md v3.17.0). Rendered straight from
// risk_ladder_tiers via get_risk_status; the current tier (matching today's balance) is
// highlighted, nothing else is inferred.
function renderLadderTiers(tiers){
    const wrap = document.getElementById('calc-ladder-tiers');
    if (!tiers || !tiers.length) {
        wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:8px 0">No ladder configured for this challenge yet.</div>';
        return;
    }
    wrap.innerHTML = tiers.map(t => {
        const range = t.upper_balance === null ? `$${fmtNum(t.lower_balance)}+` : `$${fmtNum(t.lower_balance)}–$${fmtNum(t.upper_balance)}`;
        return `<div style="background:${t.is_current?'var(--blue)':'var(--bg3)'};color:${t.is_current?'#fff':'var(--text)'};border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;opacity:0.85">${range}</div>
            <div style="font-family:var(--font-head);font-size:18px">${t.risk_pct}%</div>
            ${t.is_current ? '<div style="font-size:10px;margin-top:4px;opacity:0.9">← Current tier</div>' : ''}
        </div>`;
    }).join('');
}

function renderCalcOutputs(r){
    const el = document.getElementById('calc-results-inner');
    if (!r) {
        el.innerHTML = '<div style="color:var(--text3);text-align:center;padding:30px 0">Enter a stop loss % to see position sizing</div>';
        return;
    }
    if (r.margin_ok === false) {
        el.innerHTML = `<div style="color:var(--red);font-family:var(--font-head);font-size:16px;text-align:center;padding:20px 0">
            STOP — not enough margin
            <div style="font-size:12px;color:var(--text3);font-family:var(--font-body);margin-top:6px">Needed $${r.margin_usd.toFixed(2)} vs. available $${r.available_margin.toFixed(2)}</div>
        </div>`;
        return;
    }
    el.innerHTML = `
        <div style="margin-bottom:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Risk</div><div style="font-family:var(--font-head);font-size:28px;color:var(--red)">${r.risk_usd!=null?'$'+r.risk_usd.toFixed(2):'—'}</div></div>
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left">
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Position</div><div style="font-family:var(--font-head);font-size:20px;color:var(--green)">${r.position_usd!=null?'$'+r.position_usd.toFixed(2):'—'}</div></div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Margin</div><div style="font-family:var(--font-head);font-size:20px;color:var(--orange)">${r.margin_usd!=null?'$'+r.margin_usd.toFixed(2):'—'}</div></div>
            ${r.quantity!=null?`<div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Quantity</div><div style="font-family:var(--font-head);font-size:20px;color:var(--blue2)">${r.quantity}</div></div>`:''}
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Available Margin</div><div style="font-family:var(--font-head);font-size:20px">$${r.available_margin.toFixed(2)}</div></div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Room to Fail</div><div style="font-family:var(--font-head);font-size:20px">$${r.room_usd.toFixed(2)}</div></div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Stops to Fail</div><div style="font-family:var(--font-head);font-size:20px;color:var(--purple)">${r.stops_to_fail!=null?r.stops_to_fail:'—'}</div></div>
        </div>
        ${r.margin_usd!=null?`<button class="btn btn-success" style="width:100%;margin-top:14px" onclick="useCalcMarginInTradeForm(${r.margin_usd})">Use in Trade Form →</button>`:''}
    `;
}

// v3.17.0 — hands the computed margin_usd off to the trade form as a one-shot
// sessionStorage value; openTradeModal() (js/trades.js) picks it up for a brand-new trade
// only, never for an edit. Navigates straight to a fresh Add Trade — the user already
// sized this deliberately here, so re-running the pre-trade checklist gate adds a step
// without adding information the gate itself would ever reject on.
function useCalcMarginInTradeForm(marginUsd){
    sessionStorage.setItem('fc_pending_planned_margin', marginUsd.toFixed(2));
    showPage('trades');
    openTradeModal();
}

async function runCalcUpdate(){
    const challengeId = document.getElementById('calc-challenge').value;
    if (!challengeId) return;

    const status = await api('get_risk_status&challenge_id=' + challengeId);
    if (!status || status.error) return;

    // v3.17.1 §3 — these five stay visible in every state, STOP included: status strip,
    // ladder tiers/Risk Rules panel, balance, risk %, margin in use, available margin,
    // and the open-positions list. Nothing below this point touches any of them again.
    renderCalcStatus(status);
    renderLadderTiers(status.ladder_tiers);
    renderOpenPositions(status.open_positions);
    document.getElementById('calc-balance-display').textContent = '$' + status.balance_at_day_start.toFixed(2);
    document.getElementById('calc-margin-in-use-display').textContent = '$' + status.margin_in_use.toFixed(2);
    document.getElementById('calc-available-margin-display').textContent = '$' + status.available_margin.toFixed(2);
    const currentTier = (status.ladder_tiers || []).find(t => t.is_current);
    document.getElementById('calc-risk-pct-display').textContent = currentTier ? currentTier.risk_pct + '%' : '—';

    // §3/§5: any limit reached hides only the stop%-dependent sizing numbers (risk,
    // position, margin, quantity) and "Use in Trade Form →" — everything rendered above
    // this point stays visible. Distinct from the §2 margin-only STOP (rendered inside
    // renderCalcOutputs() via margin_ok): a trade-limits stop is about whether a NEW
    // trade can be logged at all today, not about this specific trade's sizing.
    if (status.stopped) {
        document.getElementById('calc-results-inner').innerHTML =
            `<div style="color:var(--red);font-family:var(--font-head);font-size:14px;text-align:center;padding:30px 0">STOP — ${status.reason}</div>`;
        return;
    }

    const stopPct = document.getElementById('calc-stop-pct').value;
    if (!stopPct || parseFloat(stopPct) <= 0) {
        renderCalcOutputs(null);
        return;
    }

    const leverage = document.getElementById('calc-leverage').value;
    const entry = document.getElementById('calc-entry').value;
    const r = await api('auto_risk_preview', 'POST', { challenge_id: challengeId, stop_pct: stopPct, leverage, entry });
    if (!r || r.error) { renderCalcOutputs(null); return; }
    renderCalcOutputs(r);
}
