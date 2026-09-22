
<!-- ── BITFUNDED PASTE IMPORTER (v3.14.1) ── -->
<div class="page" id="page-bfimport">
  <div style="max-width:900px;margin:0 auto">
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">1. Challenge</div>
      <div class="form-group"><label>Import into</label><select id="bf-challenge-select" style="width:100%"></select></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">2. Position History — required</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:10px">
        Bitfunded → <strong>Trader Hub</strong> → <strong>Position History</strong> tab. This is a list of cards, not a
        table — select all the closed-position cards you want, copy, and paste below. Each card is closed-position
        data — prices, times, P&amp;L, fees, exit reason.
      </div>
      <textarea id="bf-position-history" rows="8" placeholder="Paste the Position History cards here…" style="width:100%;font-family:var(--font-mono, monospace);font-size:11px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px;resize:vertical"></textarea>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">3. Transaction History — optional, for funding</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:10px">
        Bitfunded → <strong>Trader Hub</strong> → <strong>Transaction History</strong> tab. Only <code>Funding Fee</code> rows and the
        most recent <code>Balance</code> are used — everything else is read only far enough to check it's the right table.
        <strong style="color:var(--orange)">Order History and Transaction Details are different tabs and are not used</strong> — pasting
        either here will be rejected with an explanation, not silently accepted.
      </div>
      <textarea id="bf-transaction-history" rows="6" placeholder="Paste the Transaction History table here… (optional)" style="width:100%;font-family:var(--font-mono, monospace);font-size:11px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px;resize:vertical"></textarea>
      <div class="form-group" style="margin-top:10px"><label>Or enter Bitfunded's current balance manually</label><input type="number" step="0.01" id="bf-manual-balance" placeholder="Only used if Transaction History isn't pasted"></div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:16px">
      <button class="btn btn-primary" style="flex:1" onclick="bfPreview()">Preview</button>
      <button class="btn btn-success" style="flex:1" id="bf-confirm-btn" onclick="bfConfirm()" disabled>Confirm Import</button>
    </div>

    <div id="bf-error" class="card" style="display:none;border-color:var(--red);margin-bottom:16px">
      <div style="color:var(--red);font-size:13px;line-height:1.6" id="bf-error-text"></div>
    </div>

    <div id="bf-preview-result" style="display:none">
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Preview — writes nothing</div>
        <div id="bf-summary" style="font-size:13px;line-height:2;font-family:var(--font-mono,monospace)"></div>
        <div id="bf-reconciliation" style="margin-top:12px;padding:12px;background:var(--bg3);border-radius:8px;font-size:12px;font-family:var(--font-mono,monospace);line-height:1.8"></div>
      </div>
      <!-- v3.17.3 — loud on purpose: this is the exact failure mode the whole importer
           fix exists to stop (see CLAUDE.md v3.17.3). Rendered above the ordinary
           attention card, in red rather than amber, and shown even when the row resolved
           to a clean single match — the underlying candidate still has no entry price on
           file, which is worth fixing now regardless of what this particular import run
           does with it. -->
      <div class="card" id="bf-no-entry-price-card" style="display:none;margin-bottom:16px;border-color:var(--red)">
        <div class="card-title" style="color:var(--red)">⚠ Open trade(s) with no entry price</div>
        <div id="bf-no-entry-price-rows" style="font-size:12px;line-height:1.8;color:var(--text)"></div>
      </div>
      <div class="card" id="bf-attention-card" style="display:none;margin-bottom:16px;border-color:var(--orange)">
        <div class="card-title" style="color:var(--orange)">Needs attention — not imported unless resolved</div>
        <div id="bf-attention-rows" style="font-size:12px;line-height:1.8"></div>
      </div>
    </div>

    <div id="bf-confirm-result" class="card" style="display:none">
      <div class="card-title">Import complete</div>
      <div id="bf-confirm-summary" style="font-size:13px;line-height:2;font-family:var(--font-mono,monospace)"></div>
      <button class="btn btn-primary" style="margin-top:10px" onclick="showPage('trades')">Go to Trade Log →</button>
    </div>
  </div>
</div>
