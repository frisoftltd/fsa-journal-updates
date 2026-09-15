-- Three-phase trade journal (v3.11.0): pre_entry / during / post_close. Replaces the
-- three prose fields on trades (note_saw, note_why, note_unsure), which asked the same
-- question twice and only ever captured a post-decision justification. Those columns are
-- kept, not dropped or migrated into this table — they answered a different question, and
-- moving their content here would misattribute it. See CLAUDE.md for the full design.
--
-- One row per trade per phase (UNIQUE KEY below) rather than one row per trade — the
-- during-position phase is expected to often not exist at all, and the absence of that
-- row is itself the signal (the trader never returned to the chart mid-trade). Nothing
-- here marks a phase "skipped" on purpose.
--
-- created_at/updated_at are load-bearing, not decoration: retrospective self-report of
-- emotion is unreliable (Fenton-O'Creevy et al., 2011), so knowing exactly when an entry
-- was written is how a future release can tell a live in-the-moment note from one written
-- after the fact. updated_at has no DEFAULT, so it stays NULL until the first edit —
-- NULL means "never edited since creation," not "unknown."
--
-- The FK with ON DELETE CASCADE is not optional. Its absence on trade_variables (fixed in
-- migration 2026_09_13_0004) is what let 95 rows silently orphan and took three releases
-- to repair — this table starts with the constraint already in place.
CREATE TABLE trade_journal (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trade_id INT NOT NULL,
    phase ENUM('pre_entry','during','post_close') NOT NULL,
    emotion_code VARCHAR(30) NULL,
    note TEXT NULL,
    exit_type VARCHAR(30) NULL,
    good_process TINYINT(1) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_trade_journal_trade_phase (trade_id, phase),
    CONSTRAINT fk_trade_journal_trade_id FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Q4 ("What have I done since entry?") is multi-select, up to 8 options per journal row.
-- Normalized child table, one row per selected action, matching the trade_variables EAV
-- convention already established in this codebase rather than inventing a delimited-
-- string or bitmask column. action_code values come from includes/journal_taxonomy.php —
-- codes are stored here, never display labels.
CREATE TABLE trade_journal_actions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    journal_id INT NOT NULL,
    action_code VARCHAR(30) NOT NULL,
    UNIQUE KEY uniq_journal_action (journal_id, action_code),
    CONSTRAINT fk_trade_journal_actions_journal_id FOREIGN KEY (journal_id) REFERENCES trade_journal(id) ON DELETE CASCADE
) ENGINE=InnoDB;
