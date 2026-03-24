
<!-- ══ REVIEW MODAL ══ -->
<div class="modal-overlay" id="review-modal">
  <div class="modal">
    <h3>📝 WEEKLY REVIEW</h3>
    <input type="hidden" id="review-id">
    <form id="review-form">
    <div class="form-grid">
      <div class="form-group"><label>Week Start</label><input type="date" id="r-week_start"></div>
      <div class="form-group"><label>Week End</label><input type="date" id="r-week_end"></div>
      <div class="form-group"><label>Process Score (1-10)</label><input type="number" min="1" max="10" id="r-process_score"></div>
      <div class="form-group"><label>Mindset Score (1-10)</label><input type="number" min="1" max="10" id="r-mindset_score"></div>
      <div class="form-group full"><label>Key Lesson This Week</label><textarea id="r-key_lesson" rows="2"></textarea></div>
      <div class="form-group full"><label>What Went Well</label><textarea id="r-what_went_well" rows="2"></textarea></div>
      <div class="form-group full"><label>What To Improve</label><textarea id="r-what_to_improve" rows="2"></textarea></div>
      <div class="form-group full"><label>Rules Followed</label><textarea id="r-rules_followed" rows="2"></textarea></div>
    </div>
    </form>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('review-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="saveReview()">Save Review</button>
    </div>
  </div>
</div>
