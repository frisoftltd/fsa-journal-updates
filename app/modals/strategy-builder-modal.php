
<!-- ══ NEW / EDIT STRATEGY MODAL (v3.29.1 redesign — chips/tiles, toggle switch) ══ -->
<div class="modal-overlay" id="strategy-builder-modal">
  <div class="modal sb-modal" style="max-width:480px">
    <h3 id="strategy-builder-modal-title">New strategy</h3>
    <div class="sb-modal-body">
      <input type="hidden" id="sb-id">
      <div class="form-group full">
        <label>Strategy Name</label>
        <input type="text" id="sb-name" placeholder="e.g. ICT Concepts, Price Action, FSA" oninput="updateStrategySaveState()">
      </div>

      <div class="sb-section">
        <div class="sb-section-title">Where is this strategy used?</div>
        <div class="sb-section-help">Pick the challenge accounts that use it. It will only appear on those accounts.</div>

        <div class="sb-toggle-row">
          <div class="sb-toggle-text">
            <div class="sb-toggle-label">All challenges</div>
            <div class="sb-toggle-desc">Available on every account, including future ones</div>
          </div>
          <button type="button" class="sb-toggle" id="sb-applies-all" role="switch" aria-checked="true"
                  aria-label="All challenges" onclick="toggleStrategyAppliesAll()">
            <span class="sb-toggle-knob"></span>
          </button>
        </div>

        <div class="sb-challenge-grid" id="sb-challenge-list"></div>
        <div class="sb-empty-note" id="sb-challenge-empty" style="display:none">Create a challenge first to scope this strategy.</div>
      </div>
    </div>

    <div class="sb-modal-footer">
      <div class="sb-default-notice" id="sb-default-notice" style="display:none"></div>
      <div class="sb-summary" id="sb-summary"></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="closeStrategyModal()">Cancel</button>
        <button class="btn btn-primary" id="sb-save-btn" onclick="saveStrategyMeta()">Save Strategy</button>
      </div>
      <div class="sb-save-reason" id="sb-save-reason"></div>
    </div>
  </div>
</div>

<!-- ══ STRATEGY VARIABLES EDITOR MODAL ══ -->
<div class="modal-overlay" id="strategy-vars-modal">
  <div class="modal" style="max-width:720px">
    <h3>⚙️ EDIT VARIABLES — <span id="sv-strategy-name"></span></h3>
    <input type="hidden" id="sv-strategy-id">
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Custom variables to track on every trade for this strategy. "Gate" variables are mandatory pass/fail checks; "Tag" variables are observed-only. Deactivate a variable to retire it without losing its trade history.</div>
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
