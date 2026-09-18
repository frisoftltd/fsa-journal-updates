<!-- ══ TRADE MODAL ══ -->
<div class="modal-overlay" id="trade-modal">
  <div class="modal">
    <h3>📋 LOG TRADE</h3>
    <input type="hidden" id="trade-id">
    <form id="trade-form" enctype="multipart/form-data">
      <div class="form-grid">
        <div class="form-group"><label>Trade Date</label><input type="date" id="f-trade_date" name="trade_date" required></div>
        <div class="form-group"><label>Session</label><select id="f-session" name="session"><option value="">— Not recorded —</option><option>London</option><option>New York</option><option>Asia</option><option>Other</option></select></div>
        <div class="form-group"><label>Pair</label><select id="f-pair" name="pair" class="pair-select"></select></div>
        <!-- Strategy sits early, not buried below prices/outcome, because it determines
             which gate/tag variables render just below it — picking it late meant picking
             it after already having answered questions that depend on the choice. -->
        <div class="form-group">
          <label>Strategy</label>
          <select id="f-strategy_id" name="strategy_id" onchange="renderStrategyVarFields()">
            <option value="">— none —</option>
          </select>
        </div>
        <div class="form-group full" id="strategy-vars-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"></div>
        <div class="form-group"><label>Direction</label><select id="f-direction" name="direction"><option>Long</option><option>Short</option></select></div>
        <!-- v3.14.0: date in, time in, date out, time out, entry price, exit price, lot
             size and fees are gone from manual entry — execution never belongs in this
             form again, it's written exclusively by the Bitfunded importer once a
             position closes (see CLAUDE.md v3.14.0's division-of-responsibility table).
             Stop loss and take profit are intent, not outcome, so they stay here — moved
             up next to Pre-Entry Journal below, since that's the moment they're actually
             knowable. A brand-new trade is now routinely saved with none of the fields
             this section used to require. -->
        <div class="section-divider"></div>
        <div class="section-label">Outcome</div>
        <div class="form-group"><label>Result</label><select id="f-result" name="result"><option value="">—</option><option>Win</option><option>Loss</option><option>Break Even</option><option>Open</option></select></div>
        <div class="form-group"><label>Exec Score (1-10)</label><input type="number" min="1" max="10" id="f-exec_score" name="exec_score"></div>
        <!-- Execution — read only, populated once the Bitfunded importer has matched this
             trade to a closed position. Hidden entirely until then (see
             renderExecutionSummary() in trades.js): a pre-entry-only trade has nothing to
             show here yet, and that absence is itself the normal case now, not a gap to
             explain away. -->
        <div class="form-group full" id="execution-summary" style="display:none">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Execution (from Bitfunded — read only)</div>
          <div id="execution-summary-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px"></div>
        </div>
        <!-- ═══ THREE-PHASE TRADE JOURNAL (v3.11.0) ═══
             Replaces the old single "Strategy & Psychology" section and its three
             justification-prompt textareas (note_saw/note_why/note_unsure), which asked
             the same question twice and were only ever answered after the decision was
             already made. trades.emotion_tag and the three note_* columns are kept for
             historical trades (see trade-view-modal / viewTrade()) but no longer written
             by this form — CLAUDE.md has the full design rationale.

             Pills/options render from window.EMOTION_STATES, window.JOURNAL_ACTIONS,
             window.JOURNAL_EXIT_TYPES (includes/emotion_states.php and
             includes/journal_taxonomy.php via index.php) — nothing here hardcodes a code
             or label. js/trades.js's renderEmotionGrid()/renderActionsGrid()/
             renderExitTypeSelect() are all parameterized by phase, not copy-pasted three
             times, and write into window._journalState rather than per-field hidden
             inputs, since this section's answers are collected as one JSON blob
             (collectTradeJournal()) rather than read as flat form fields.

             The During section (and Post-Close, for a trade that doesn't exist yet) is
             hidden entirely — not just collapsed — when adding a brand-new trade; JS
             reveals all three when editing an existing one. Nothing here marks a phase
             "skipped" — an absent phase section for a new trade is a lifecycle fact
             (the trade doesn't have a "during" yet), not a UI choice to hide data. -->

        <div class="section-divider"></div>
        <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleJournalSection('pre_entry')">
          <span>Pre-Entry Journal</span>
          <span id="journal-chevron-pre_entry" style="font-size:11px">▸</span>
        </div>
        <div class="form-group full" id="journal-body-pre_entry" style="display:none">
          <!-- v3.14.0: stop loss / take profit moved here from the old "Prices" section —
               intent, not outcome (the broker never records either), so they belong with
               the rest of what's knowable before entry, not next to execution data that
               no longer lives in this form at all. -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div class="form-group"><label>Stop Loss</label><input type="number" step="0.0001" id="f-stop_loss" name="stop_loss"></div>
            <div class="form-group"><label>Take Profit</label><input type="number" step="0.0001" id="f-take_profit" name="take_profit"></div>
          </div>
          <label style="display:block">Setup Quality (grade the SETUP, not the outcome)</label>
          <div id="grade-grid" style="display:flex;gap:6px;margin-top:4px">
            <button type="button" class="btn btn-ghost btn-sm grade-pill" data-value="A" onclick="selectGrade('A')">A</button>
            <button type="button" class="btn btn-ghost btn-sm grade-pill" data-value="B" onclick="selectGrade('B')">B</button>
            <button type="button" class="btn btn-ghost btn-sm grade-pill" data-value="C" onclick="selectGrade('C')">C</button>
          </div>
          <input type="hidden" id="f-setup_grade" name="setup_grade">

          <label style="display:block;margin-top:12px">How am I feeling right now?</label>
          <div id="emotion-grid-pre_entry" class="emotion-grid"></div>
          <div id="emotion-description-pre_entry" class="emotion-desc-panel" style="display:none"></div>
          <div id="emotion-legacy-note-pre_entry" class="emotion-legacy-note" style="display:none"></div>
          <button type="button" id="emotion-clear-btn-pre_entry" onclick="clearEmotion('pre_entry')" class="emotion-clear-link" style="display:none">✕ Clear selection</button>

          <div style="margin-top:12px"><label>What would have to happen for me to be wrong?</label><textarea id="f-journal-note-pre_entry" rows="2"></textarea></div>
        </div>

        <div class="section-divider"></div>
        <div class="section-label" id="journal-header-during" style="display:none;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleJournalSection('during')">
          <span>During Open Position <span style="font-weight:400;color:var(--text3);text-transform:none;letter-spacing:0">— optional, only if you came back to check</span></span>
          <span id="journal-chevron-during" style="font-size:11px">▸</span>
        </div>
        <div class="form-group full" id="journal-body-during" style="display:none">
          <label style="display:block">What have I done since entry?</label>
          <div id="actions-grid" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px"></div>

          <label style="display:block;margin-top:12px">How am I feeling while it's open?</label>
          <div id="emotion-grid-during" class="emotion-grid"></div>
          <div id="emotion-description-during" class="emotion-desc-panel" style="display:none"></div>
          <div id="emotion-legacy-note-during" class="emotion-legacy-note" style="display:none"></div>
          <button type="button" id="emotion-clear-btn-during" onclick="clearEmotion('during')" class="emotion-clear-link" style="display:none">✕ Clear selection</button>

          <div style="margin-top:12px"><label>What am I tempted to do right now?</label><textarea id="f-journal-note-during" rows="2"></textarea></div>
        </div>

        <div class="section-divider"></div>
        <div class="section-label" id="journal-header-post_close" style="display:none;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleJournalSection('post_close')">
          <span>After Close</span>
          <span id="journal-chevron-post_close" style="font-size:11px">▸</span>
        </div>
        <div class="form-group full" id="journal-body-post_close" style="display:none">
          <label style="display:block">How did it end?</label>
          <select id="f-exit_type" style="margin-top:4px"></select>

          <label style="display:block;margin-top:12px">How am I feeling now it's closed?</label>
          <div id="emotion-grid-post_close" class="emotion-grid"></div>
          <div id="emotion-description-post_close" class="emotion-desc-panel" style="display:none"></div>
          <div id="emotion-legacy-note-post_close" class="emotion-legacy-note" style="display:none"></div>
          <button type="button" id="emotion-clear-btn-post_close" onclick="clearEmotion('post_close')" class="emotion-clear-link" style="display:none">✕ Clear selection</button>

          <label style="display:block;margin-top:12px">Was this good process, regardless of outcome?</label>
          <div style="display:flex;gap:6px;margin-top:4px">
            <button type="button" class="btn btn-ghost btn-sm good-process-pill" data-value="1" onclick="toggleGoodProcess(1)">Yes</button>
            <button type="button" class="btn btn-ghost btn-sm good-process-pill" data-value="0" onclick="toggleGoodProcess(0)">No</button>
          </div>
          <input type="text" id="f-journal-note-post_close" placeholder="Optional — one line on why" style="margin-top:8px;width:100%">
        </div>
        <div class="section-divider"></div>
        <div class="section-label">Chart Screenshots (max 4, 1MB each)</div>
        <div class="form-group full" id="screenshots-area">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
                <select name="label_1" id="f-label_1" style="flex:1;padding:4px 8px;font-size:11px;background:var(--card);border:1px solid var(--border);border-radius:4px;color:var(--text)">
                  <option value="4H">4H Context</option><option value="1H">1H Setup</option><option value="15M">15M Entry</option><option value="Entry">Entry</option><option value="Exit">Exit</option><option value="Other">Other</option>
                </select>
              </div>
              <input type="file" name="screenshot_1" id="f-screenshot_1" accept="image/*" style="font-size:11px;width:100%">
              <div id="preview-1" style="margin-top:4px"></div>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
                <select name="label_2" id="f-label_2" style="flex:1;padding:4px 8px;font-size:11px;background:var(--card);border:1px solid var(--border);border-radius:4px;color:var(--text)">
                  <option value="4H">4H Context</option><option value="1H" selected>1H Setup</option><option value="15M">15M Entry</option><option value="Entry">Entry</option><option value="Exit">Exit</option><option value="Other">Other</option>
                </select>
              </div>
              <input type="file" name="screenshot_2" id="f-screenshot_2" accept="image/*" style="font-size:11px;width:100%">
              <div id="preview-2" style="margin-top:4px"></div>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
                <select name="label_3" id="f-label_3" style="flex:1;padding:4px 8px;font-size:11px;background:var(--card);border:1px solid var(--border);border-radius:4px;color:var(--text)">
                  <option value="4H">4H Context</option><option value="1H">1H Setup</option><option value="15M" selected>15M Entry</option><option value="Entry">Entry</option><option value="Exit">Exit</option><option value="Other">Other</option>
                </select>
              </div>
              <input type="file" name="screenshot_3" id="f-screenshot_3" accept="image/*" style="font-size:11px;width:100%">
              <div id="preview-3" style="margin-top:4px"></div>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
                <select name="label_4" id="f-label_4" style="flex:1;padding:4px 8px;font-size:11px;background:var(--card);border:1px solid var(--border);border-radius:4px;color:var(--text)">
                  <option value="4H">4H Context</option><option value="1H">1H Setup</option><option value="15M">15M Entry</option><option value="Entry" selected>Entry</option><option value="Exit">Exit</option><option value="Other">Other</option>
                </select>
              </div>
              <input type="file" name="screenshot_4" id="f-screenshot_4" accept="image/*" style="font-size:11px;width:100%">
              <div id="preview-4" style="margin-top:4px"></div>
            </div>
          </div>
          <div id="screenshot-current" style="margin-top:8px"></div>
        </div>
        <div class="form-group full"><label>Notes</label><textarea id="f-notes" name="notes" rows="2"></textarea></div>
      </div>
    </form>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('trade-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="saveTrade()">Save Trade</button>
    </div>
  </div>
</div>
