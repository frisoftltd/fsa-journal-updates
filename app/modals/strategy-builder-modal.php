
<!-- ══ NEW / RENAME STRATEGY MODAL ══ -->
<div class="modal-overlay" id="strategy-builder-modal">
  <div class="modal" style="max-width:440px">
    <h3 id="strategy-builder-modal-title">🧪 NEW STRATEGY</h3>
    <input type="hidden" id="sb-id">
    <div class="form-group full"><label>Strategy Name</label><input type="text" id="sb-name" placeholder="e.g. ICT Concepts, Price Action, FSA"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('strategy-builder-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="saveStrategyMeta()">Save Strategy</button>
    </div>
  </div>
</div>

<!-- ══ STRATEGY VARIABLES EDITOR MODAL ══ -->
<div class="modal-overlay" id="strategy-vars-modal">
  <div class="modal" style="max-width:640px">
    <h3>⚙️ EDIT VARIABLES — <span id="sv-strategy-name"></span></h3>
    <input type="hidden" id="sv-strategy-id">
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Up to 5 custom variables to track on every trade for this strategy.</div>
    <div id="sv-rows"></div>
    <div style="margin:10px 0">
      <button class="btn btn-ghost btn-sm" id="sv-add-row-btn" onclick="addVariableRow()">+ Add Variable</button>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('strategy-vars-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="saveVariables()">Save Variables</button>
    </div>
  </div>
</div>
