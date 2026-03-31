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
        <div class="form-group"><label>Fib Level</label><select id="f-fib_level" name="fib_level"><option value="">—</option><option>0.236</option><option>0.382</option><option>0.5</option><option>0.618</option><option>0.705</option><option>0.786</option><option>Other</option></select></div>
        <div class="form-group"><label>FSA Rules</label><select id="f-fsa_rules" name="fsa_rules"><option value="">—</option><option>All 5</option><option>4 of 5</option><option>3 of 5</option><option>2 of 5</option></select></div>
        <div class="form-group"><label>Confidence</label><select id="f-confidence" name="confidence"><option value="">—</option><option>High</option><option>Medium</option><option>Low</option></select></div>
        <div class="form-group"><label>Exec Score (1-10)</label><input type="number" min="1" max="10" id="f-exec_score" name="exec_score"></div>
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
