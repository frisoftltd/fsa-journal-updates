<!-- ══ TRADE MODAL ══ -->
<div class="modal-overlay" id="trade-modal">
  <div class="modal">
    <h3>📋 LOG TRADE</h3>
    <input type="hidden" id="trade-id">
    <form id="trade-form" enctype="multipart/form-data">
      <div class="form-grid">
        <div class="form-group"><label>Trade Date</label><input type="date" id="f-trade_date" name="trade_date" required></div>
        <div class="form-group"><label>Session</label><select id="f-session" name="session"><option>London</option><option>New York</option><option>Asia</option><option>Other</option></select></div>
        <div class="form-group"><label>Pair</label><select id="f-pair" name="pair" class="pair-select"></select></div>
        <div class="section-divider"></div>
        <div class="section-label">Time In</div>
        <div class="form-group"><label>Date In</label><input type="date" id="f-time_in_date" name="time_in_date"></div>
        <div class="form-group"><label>Time In</label><input type="time" id="f-time_in_time" name="time_in_time"></div>
        <div class="form-group"><label>Date Out</label><input type="date" id="f-time_out_date" name="time_out_date"></div>
        <div class="form-group"><label>Time Out</label><input type="time" id="f-time_out_time" name="time_out_time"></div>
        <div class="form-group"><label>Direction</label><select id="f-direction" name="direction"><option>Long</option><option>Short</option></select></div>
        <div class="section-divider"></div>
        <div class="section-label">Prices</div>
        <div class="form-group"><label>Entry Price</label><input type="number" step="0.0001" id="f-entry_price" name="entry_price"></div>
        <div class="form-group"><label>Stop Loss</label><input type="number" step="0.0001" id="f-stop_loss" name="stop_loss"></div>
        <div class="form-group"><label>Take Profit</label><input type="number" step="0.0001" id="f-take_profit" name="take_profit"></div>
        <div class="form-group"><label>Exit Price</label><input type="number" step="0.0001" id="f-exit_price" name="exit_price"></div>
        <div class="form-group"><label>Lot Size</label><input type="number" step="0.0001" id="f-lot_size" name="lot_size"></div>
        <div class="form-group"><label>Fees ($)</label><input type="number" step="0.01" id="f-fees" name="fees" value="0"></div>
        <div class="section-divider"></div>
        <div class="section-label">Outcome</div>
        <div class="form-group"><label>Result</label><select id="f-result" name="result"><option value="">—</option><option>Win</option><option>Loss</option><option>Break Even</option><option>Open</option></select></div>
        <div class="form-group"><label>Exec Score (1-10)</label><input type="number" min="1" max="10" id="f-exec_score" name="exec_score"></div>
        <div class="section-divider"></div>
        <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleStrategySection()">
          <span>Strategy &amp; Psychology</span>
          <span id="strategy-section-chevron" style="font-size:11px">▸</span>
        </div>
        <div class="form-group full" id="strategy-section-body" style="display:none">
          <div class="form-group">
            <label>Strategy</label>
            <select id="f-strategy_id" name="strategy_id" onchange="renderStrategyVarFields()">
              <option value="">— none —</option>
            </select>
          </div>
          <div id="strategy-vars-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px"></div>

          <label style="display:block;margin-top:12px">How am I feeling right now?</label>
          <div id="emotion-grid" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-value="calm" onclick="selectEmotion('calm')">Calm — waiting for setup</button>
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-value="itchy" onclick="selectEmotion('itchy')">Itchy — hard to wait</button>
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-value="fomo" onclick="selectEmotion('fomo')">FOMO — moving without me</button>
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-value="revenge" onclick="selectEmotion('revenge')">Revenge — make back a loss</button>
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-value="bored" onclick="selectEmotion('bored')">Bored — forcing action</button>
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-value="overconf" onclick="selectEmotion('overconf')">Overconfident — win streak</button>
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-value="anxious" onclick="selectEmotion('anxious')">Anxious — scared to enter</button>
            <button type="button" class="btn btn-ghost btn-sm emotion-pill" data-value="unsure" onclick="selectEmotion('unsure')">Unsure — not convinced</button>
          </div>
          <input type="hidden" id="f-emotion_tag" name="emotion_tag">

          <label style="display:block;margin-top:12px">Setup Quality (grade the SETUP, not the outcome)</label>
          <div id="grade-grid" style="display:flex;gap:6px;margin-top:4px">
            <button type="button" class="btn btn-ghost btn-sm grade-pill" data-value="A" onclick="selectGrade('A')">A</button>
            <button type="button" class="btn btn-ghost btn-sm grade-pill" data-value="B" onclick="selectGrade('B')">B</button>
            <button type="button" class="btn btn-ghost btn-sm grade-pill" data-value="C" onclick="selectGrade('C')">C</button>
          </div>
          <input type="hidden" id="f-setup_grade" name="setup_grade">

          <div style="margin-top:12px"><label>What did I see?</label><textarea id="f-note_saw" name="note_saw" rows="2"></textarea></div>
          <div style="margin-top:8px"><label>Why enter now?</label><textarea id="f-note_why" name="note_why" rows="2"></textarea></div>
          <div style="margin-top:8px"><label>What am I unsure about?</label><textarea id="f-note_unsure" name="note_unsure" rows="2"></textarea></div>
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
