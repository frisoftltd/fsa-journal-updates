
<!-- ══ CHALLENGE MODAL ══ -->
<div class="modal-overlay" id="challenge-modal">
  <div class="modal" style="max-width:560px">
    <h3 id="challenge-modal-title">🏆 NEW CHALLENGE</h3>
    <input type="hidden" id="ch-id">
    <div class="form-grid-2" style="gap:12px">
      <div class="form-group full"><label>Challenge Name</label><input type="text" id="ch-name" placeholder="e.g. BitFunded $10K Phase 1"></div>
      <div class="form-group"><label>Prop Firm</label><input type="text" id="ch-prop_firm" placeholder="e.g. BitFunded, FTMO, MyForexFunds"></div>
      <div class="form-group"><label>Phase</label><select id="ch-challenge_phase"><option>Phase 1</option><option>Phase 2</option><option>Funded</option><option>Free Trial</option><option>Personal</option></select></div>
      <div class="form-group"><label>Starting Balance ($)</label><input type="number" step="0.01" id="ch-starting_balance" value="10000"></div>
      <!-- Current Balance is no longer a form input (v3.13.0) — it's always derived from
           starting_balance + realised net P&L, never hand-entered, so editing it here
           could never have done anything but drift out of sync with the real number. -->
      <div class="form-group"><label>Max Drawdown (%)</label><input type="number" step="0.1" id="ch-max_drawdown_pct" value="10"></div>
      <!-- Drawdown Type (v3.14.7): which convention this prop firm's Maximum Loss rule
           actually uses. Static (default) measures from starting_balance — confirmed
           correct for Bitfunded against its own dashboard. Trailing measures from the
           equity high-water mark, for a firm whose rule genuinely works that way. -->
      <div class="form-group"><label>Drawdown Type</label><select id="ch-drawdown_type"><option value="static">Static (from starting balance)</option><option value="trailing">Trailing (from equity peak)</option></select></div>
      <div class="form-group"><label>Daily Loss Limit ($)</label><input type="number" step="0.01" id="ch-daily_loss_limit" value="500"></div>
      <div class="form-group"><label>Risk Per Trade (%)</label><input type="number" step="0.01" id="ch-risk_per_trade_pct" value="0.5"></div>
      <div class="form-group"><label>Profit Target (%)</label><input type="number" step="0.1" id="ch-profit_target_pct" value="8"></div>
      <!-- v3.17.0: the Auto Risk Calculator's Leverage input defaults to this and stays
           editable there — this is a default, not a hard cap, so it's left NULL/blank
           (never a guessed number) until a value is actually set here. -->
      <div class="form-group"><label>Default Leverage (x)</label><input type="number" step="0.01" id="ch-default_leverage" placeholder="e.g. 5"></div>
      <div class="form-group"><label>Status</label><select id="ch-status"><option value="active">Active</option><option value="completed">Completed</option><option value="failed">Failed</option></select></div>
    </div>

    <!-- v3.27.2 — shown only for a brand-new challenge (no ch-id yet). There is no
         default here on purpose: Risk Calculator showed "—" for every challenge except 6
         because nothing ever wrote a risk_ladder_tiers row for a new challenge. This one
         required field seeds exactly one open-ended ($0+) tier at save time
         (ChallengeController::add()) — more tiers can be added afterward from the Risk
         Ladder editor below, once the challenge exists. -->
    <div class="form-group full" id="ch-seed-ladder-wrap" style="margin-top:4px">
      <label>Initial Risk Ladder — Risk % <span style="color:var(--red)">*</span></label>
      <input type="number" id="ch-seed-ladder-risk-pct" step="0.01" placeholder="e.g. 0.5">
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Applies from $0 with no upper limit — no default, you must type a value. Add more tiers later from Edit Challenge → Risk Ladder.</div>
    </div>

    <!-- v3.27.2 — shown only when editing an existing challenge (ch-id set). Reads/
         writes risk_ladder_tiers directly via get_ladder_tiers/save_ladder_tiers,
         deliberately decoupled from Save Challenge above — a mistake in one can't block
         the other, and you can fix just the ladder without resubmitting every other
         field. Saving replaces the active tiers and keeps the previous ones as active=0
         history, same pattern as challenge 6's own rows 1-3. -->
    <div id="ch-ladder-editor-wrap" style="display:none;margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label style="margin:0">Risk Ladder</label>
        <button type="button" class="btn btn-ghost btn-sm" onclick="addLadderTierRow()">+ Add Tier</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Each tier's lower balance is set automatically from the one before it, so there's no gap or overlap to create by hand. Only the last tier can be open-ended.</div>
      <div id="ch-ladder-rows"></div>
      <div id="ch-ladder-error" style="color:var(--red);font-size:12px;margin-top:8px;display:none"></div>
      <button type="button" class="btn btn-primary btn-sm" style="margin-top:10px" onclick="saveLadderTiers()">💾 Save Ladder</button>
    </div>

    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('challenge-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="saveChallenge()">Save Challenge</button>
    </div>
  </div>
</div>
