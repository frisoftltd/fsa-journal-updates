-- v3.16.4 -- During-position check-ins become an append-only log, not a single upserted
-- trade_journal row. trade_journal's UNIQUE KEY (trade_id, phase) is exactly right for
-- pre_entry/post_close (one plan, one outcome, per trade) but was structurally wrong for
-- "During Open Position": every save overwrote the same row, so a trader who checked in
-- twice on the same open trade had the second check-in silently replace the first, with
-- no way to ever see what they'd noted the first time. That upsert-into-a-unique-row
-- shape is not touched here -- pre_entry/post_close keep using trade_journal exactly as
-- before. This is a new, separate, append-only table for During only.
--
-- checked_at is DATETIME(3), not the table's usual TIMESTAMP -- two check-ins on the same
-- trade inside the same second (routine during interactive testing, and not impossible
-- for a fast-fingered real save-then-resave) must still sort and display as genuinely
-- different rows; second-resolution TIMESTAMP can't guarantee that, millisecond can.
--
-- No UNIQUE KEY on trade_id: that's the entire point of this table over trade_journal.
CREATE TABLE trade_checkins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trade_id INT NOT NULL,
    checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    emotion_code VARCHAR(30) NULL,
    tempted_text TEXT NULL,
    CONSTRAINT fk_trade_checkins_trade_id FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Same EAV shape as trade_journal_actions (v3.11.0) and trade_variables before it -- one
-- row per selected action per check-in, action_code values from
-- includes/journal_taxonomy.php::journalActions(), never a delimited string or bitmask.
CREATE TABLE trade_checkin_actions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    checkin_id INT NOT NULL,
    action_code VARCHAR(30) NOT NULL,
    UNIQUE KEY uniq_checkin_action (checkin_id, action_code),
    CONSTRAINT fk_trade_checkin_actions_checkin_id FOREIGN KEY (checkin_id) REFERENCES trade_checkins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Backfill: every trade that already has a trade_journal 'during' row (the old, single-
-- row mechanism) gets exactly one trade_checkins row carrying that same data, so nobody's
-- already-saved During selections disappear the moment the app stops reading trade_journal
-- for this phase. Safe to re-run: trade_journal's own UNIQUE KEY (trade_id, phase) means
-- at most one 'during' row per trade exists to begin with, and the NOT EXISTS guard stops
-- a second backfill pass from duplicating it if this migration is ever retried after a
-- partial failure.
INSERT INTO trade_checkins (trade_id, checked_at, emotion_code, tempted_text)
SELECT tj.trade_id, COALESCE(tj.updated_at, tj.created_at), tj.emotion_code, tj.note
FROM trade_journal tj
WHERE tj.phase = 'during'
  AND NOT EXISTS (SELECT 1 FROM trade_checkins tc WHERE tc.trade_id = tj.trade_id);

-- The join back to trade_checkins on trade_id alone is safe here specifically because the
-- INSERT above guarantees at most one trade_checkins row per trade at this point in the
-- file -- this is a one-time backfill, not the ongoing multi-row shape the app uses after.
INSERT INTO trade_checkin_actions (checkin_id, action_code)
SELECT tc.id, tja.action_code
FROM trade_journal tj
JOIN trade_journal_actions tja ON tja.journal_id = tj.id
JOIN trade_checkins tc ON tc.trade_id = tj.trade_id
WHERE tj.phase = 'during'
  AND NOT EXISTS (SELECT 1 FROM trade_checkin_actions x WHERE x.checkin_id = tc.id AND x.action_code = tja.action_code);
