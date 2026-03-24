
/**
 * FundedControl — Calculator Module (v3.0.0 Phase 2)
 * Risk calculator
 */

function loadCalculator(){
    const u=currentUser;
    const balEl=document.getElementById('calc-balance');
    if(balEl) balEl.value=u.account_balance||10000;
    const riskEl=document.getElementById('calc-risk-pct');
    if(riskEl) riskEl.value=u.risk_per_trade_pct||0.25;
}

function calcSimple(){
    const balance = parseFloat(document.getElementById('calc-balance').value||0);
    const slPct   = parseFloat(document.getElementById('calc-sl-pct').value||0);
    const riskPct = parseFloat(document.getElementById('calc-risk-pct').value||0);
    const leverage= parseFloat(document.getElementById('calc-leverage').value||1);
    if(!balance||!slPct||!riskPct){
        document.getElementById('calc-results-inner').innerHTML='<div style="color:var(--red)">Please fill all fields</div>';
        return;
    }
    const riskAmt     = balance * riskPct / 100;
    const positionSize= (riskAmt / (slPct / 100));
    const lotSize     = positionSize / balance * leverage;
    const marginUsed  = positionSize / leverage;
    document.getElementById('calc-results-inner').innerHTML = `
        <div style="margin-bottom:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Risk Amount</div><div style="font-family:var(--font-head);font-size:28px;color:var(--red)">$${riskAmt.toFixed(2)}</div></div>
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left">
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Position Size</div><div style="font-family:var(--font-head);font-size:20px;color:var(--green)">$${positionSize.toFixed(2)}</div></div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Lot Size</div><div style="font-family:var(--font-head);font-size:20px;color:var(--blue2)">${lotSize.toFixed(4)}</div></div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Margin Used</div><div style="font-family:var(--font-head);font-size:20px;color:var(--orange)">$${marginUsed.toFixed(2)}</div></div>
            <div style="background:var(--bg3);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Leverage</div><div style="font-family:var(--font-head);font-size:20px;color:var(--purple)">${leverage}x</div></div>
        </div>`;
}
