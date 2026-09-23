
<!-- ══ REPORT CARD — SESSION BLOCK MODAL (v3.18.0) ══
     One form for add and edit. Times are entered in the fixed report-card timezone
     (Africa/Kigali, CAT/UTC+2 — see ReportCardController's own note on why this isn't a
     per-user setting yet) and converted to UTC in JS before the field is sent, since
     start_utc/end_utc are stored in UTC (build briefing §4.1 rule 10). -->
<div class="modal-overlay" id="rc-block-modal">
  <div class="modal" style="max-width:480px">
    <h3 id="rc-block-modal-title">➕ ADD SESSION BLOCK</h3>
    <input type="hidden" id="rc-block-id">
    <div class="form-grid-2">
      <div class="form-group full">
        <label>Label</label>
        <input type="text" id="rc-block-label" placeholder="e.g. London, Prep, Review" maxlength="80">
      </div>
      <div class="form-group">
        <label>Start (local)</label>
        <input type="time" id="rc-block-start">
      </div>
      <div class="form-group">
        <label>End (local)</label>
        <input type="time" id="rc-block-end">
      </div>
      <div class="form-group full">
        <label>Market Session</label>
        <select id="rc-block-session">
          <option value="none">None</option>
          <option value="asia">Asia</option>
          <option value="london">London</option>
          <option value="newyork">New York</option>
        </select>
      </div>
      <div class="section-divider"></div>
      <div class="form-group">
        <label>Grade</label>
        <select id="rc-block-grade">
          <option value="">—</option>
          <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option><option value="F">F</option>
        </select>
      </div>
      <div class="form-group">
        <label>Sizing</label>
        <input type="text" id="rc-block-sizing" placeholder="e.g. 1.0R" maxlength="40">
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0"><input type="checkbox" id="rc-block-playbook" style="width:auto"> Playbook only</label>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0"><input type="checkbox" id="rc-block-favor" style="width:auto"> Market in my favor</label>
      </div>
      <div class="form-group full">
        <label>Comments</label>
        <textarea id="rc-block-comments" rows="3"></textarea>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeRcBlockModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRcBlock()">Save Block</button>
    </div>
  </div>
</div>
