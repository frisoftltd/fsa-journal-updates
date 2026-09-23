
<!-- ══ REPORT CARD — TEMPLATE MODAL (v3.18.0) ══
     Add/edit a template's name, weekday default, is_default flag, and its own block list.
     Editing a template never rewrites any existing card (build briefing §4.1 rule 1/2) —
     these blocks are only ever copied into a card at creation time or on an explicit
     "Apply" from the Templates view. -->
<div class="modal-overlay" id="rc-template-modal">
  <div class="modal" style="max-width:560px">
    <h3 id="rc-template-modal-title">➕ NEW TEMPLATE</h3>
    <input type="hidden" id="rc-template-id">
    <div class="form-grid-2">
      <div class="form-group full">
        <label>Name</label>
        <input type="text" id="rc-template-name" maxlength="80">
      </div>
      <div class="form-group">
        <label>Weekday Default</label>
        <select id="rc-template-weekday">
          <option value="">None</option>
          <option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option>
          <option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option>
        </select>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;margin-top:20px"><input type="checkbox" id="rc-template-default" style="width:auto"> Use as my default template</label>
      </div>
    </div>
    <div class="section-label" style="margin-top:14px">Blocks</div>
    <div id="rc-template-blocks" style="margin-top:8px"></div>
    <button class="btn btn-ghost btn-sm" onclick="addRcTemplateBlockRow()">+ Add Block Row</button>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeRcTemplateModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRcTemplate()">Save Template</button>
    </div>
  </div>
</div>
