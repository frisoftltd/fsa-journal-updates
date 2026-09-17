-- Incident fix for 2026_09_17_0002 (v3.12.0). That migration's 41 INSERTs and 17 UPDATEs
-- all ran successfully; only its final post-verify guard failed, because live had drifted
-- further than the guard anticipated:
--
--   - Trade 80 (BNBUSDT, 2026-09-14) is a genuine trade logged after the 2026-09-16
--     snapshot §2's mapping was built from. It isn't part of the 58-position Bitfunded
--     CSV (which ends 2026-09-13) and needs no action — it just pushes the challenge's
--     total row count from 58 to 59 and its loss count from 35 to 36, which is exactly
--     why 0002's original guard (hardcoded at COUNT(*)=58 over every row for the
--     challenge) tripped even though nothing was wrong.
--   - Trade 79 (ZECUSDT Long, entered manually as 2026-09-13 06:05:00, pnl already -95.79)
--     is the SAME closed position as CSV row n=1 (Bitfunded's own time_in: 2026-09-13
--     06:05:09) — also logged after the snapshot, so it was never in the §2 id mapping
--     and 0002 had no way to know about it. 0002's duplicate guard for the 41 new inserts
--     matched on exact (pair, direction, time_in); a 9-second gap between a hand-typed
--     timestamp and Bitfunded's own defeated that check, so 0002 inserted a *second* row
--     for this same position instead of recognizing trade 79 as already covering it.
--
-- First attempt at a fix (shipped as v3.12.1) tried to mark 0002 'applied' directly from
-- inside this file. That does not work: migrate.php stops at the first failure in
-- filename order, 0002 sorts before this file, and 0002's own guard would keep failing
-- every run (it checked an exact whole-challenge COUNT(*)=58, which can never be true
-- again now that trade 80 legitimately exists) — so this file was never reached.
-- Corrected approach, shipped together in this release: 0002 itself was edited (it was
-- still status='failed' on live at the time, not checksum-locked — see CLAUDE.md §3A, "a
-- previously failed migration is retryable, content may have been fixed") so its guard is
-- scoped to source='import' instead of every row for the challenge. That makes 0002 pass
-- on its own merits, in its own file, in normal filename order, no renaming or manual
-- schema_migrations surgery required. This file no longer needs to (and must not) touch
-- schema_migrations itself — once 0002 legitimately passes, migrate.php's own
-- recordMigration() records it 'applied' with the correct checksum of the edited file;
-- writing a second, independent INSERT here with a hardcoded checksum would only be
-- correct for one exact byte-for-byte version of 0002 and would corrupt the tracking row
-- (and permanently block every later migration behind a false checksum mismatch) the
-- moment that assumption drifted.
--
-- This file: updates trade 79 to Bitfunded's own figures for CSV row n=1 (same treatment
-- as the original 17 matched rows got in 0002) and deletes the extra row 0002 inserted,
-- preserving trade 79's id and its 9 trade_variables rows. Guarded before any mutation
-- (fails loudly, changes nothing, if what's live no longer matches what was reported)
-- and self-auditing after (re-scans the whole challenge with a 5-minute tolerance window
-- instead of an exact timestamp, so a duplicate-check gap of this kind can't hide a second
-- undiscovered case).

SET @user_id := (SELECT user_id FROM trades WHERE id = 79);
SET @challenge_id := (SELECT challenge_id FROM trades WHERE id = 79);

-- Locate the row 0002 inserted for CSV n=1 by its known attributes rather than a guessed
-- id (auto_increment assignment for that INSERT depends on whatever else was written to
-- `trades` globally between the snapshot and the migration run, which this file has no
-- visibility into).
SET @dup_id := (
    SELECT id FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ZECUSDT' AND direction = 'Long'
    AND time_in = '2026-09-13 06:05:09' AND pnl = -95.79 AND source = 'import'
    LIMIT 1
);

CREATE TEMPORARY TABLE _bf_dup_guard_pre (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_dup_guard_pre (ok) VALUES (
    @dup_id IS NOT NULL AND @dup_id <> 79
    -- trade 79 is really ZECUSDT Long and really has the 9 trade_variables rows this
    -- file must not disturb
    AND (SELECT COUNT(*) FROM trades WHERE id = 79 AND pair = 'ZECUSDT' AND direction = 'Long') = 1
    AND (SELECT COUNT(*) FROM trade_variables WHERE trade_id = 79) = 9
    -- the row about to be deleted really is an empty import artifact, not something with
    -- its own recorded answers
    AND (SELECT COUNT(*) FROM trade_variables WHERE trade_id = @dup_id) = 0
    -- exactly these two rows exist in the 10-minute window around this position — not a
    -- third undiscovered copy
    AND (
        SELECT COUNT(*) FROM trades
        WHERE user_id = @user_id AND challenge_id = @challenge_id
        AND pair = 'ZECUSDT' AND direction = 'Long'
        AND time_in BETWEEN '2026-09-13 06:00:09' AND '2026-09-13 06:10:09'
    ) = 2
);
DROP TEMPORARY TABLE _bf_dup_guard_pre;

-- Repair the keeper first (trade 79) — same treatment CSV row n=1 got when 0002 wrote it
-- into the now-redundant duplicate: Bitfunded is authoritative for price/time/pnl/result.
UPDATE trades SET
    trade_date = '2026-09-13',
    entry_price = 1135.75,
    exit_price = 1081.63,
    time_in = '2026-09-13 06:05:09',
    time_out = '2026-09-13 11:31:43',
    pnl = -95.79,
    net_pnl = -95.79 - fees,
    r_multiple = -1.00,
    risk_amount = 95.79,
    result = 'Loss',
    source = 'import',
    r_multiple_source = 'recorded'
WHERE id = 79;

-- Then remove the artifact 0002 created. ON DELETE CASCADE would take trade_variables
-- with it if there were any, but the pre-guard above already confirmed there are none.
DELETE FROM trades WHERE id = @dup_id;

-- Tolerance audit: re-scan the whole challenge for any (pair, direction) pair whose
-- time_in is within 5 minutes of another trade's — the same class of near-duplicate that
-- let this one slip past 0002's exact-timestamp check. Zero expected after the fix above;
-- a nonzero result means there is at least one more undiscovered case and this file stops
-- before recording 0002 as settled, rather than papering over it.
CREATE TEMPORARY TABLE _bf_dup_audit (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_dup_audit (ok) VALUES (
    (
        SELECT COUNT(*) FROM trades a
        JOIN trades b ON b.user_id = a.user_id AND b.challenge_id = a.challenge_id
            AND b.pair = a.pair AND b.direction = a.direction AND b.id <> a.id
            AND ABS(TIMESTAMPDIFF(SECOND, a.time_in, b.time_in)) <= 300
        WHERE a.user_id = @user_id AND a.challenge_id = @challenge_id
    ) = 0
);
DROP TEMPORARY TABLE _bf_dup_audit;

-- Post-verify: expected end state per the incident report. (No schema_migrations write
-- here — see the header note. 0002 records its own 'applied' status the normal way, via
-- migrate.php's recordMigration(), once its corrected guard lets it pass.)
CREATE TEMPORARY TABLE _bf_dup_guard_post (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_dup_guard_post (ok) VALUES (
    (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id) = 59
    AND (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id AND result = 'Win') = 23
    AND (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id AND result = 'Loss') = 36
    AND (SELECT COUNT(*) FROM trade_variables) = 135
    AND (SELECT COUNT(*) FROM trade_variables WHERE trade_id = 79) = 9
    AND NOT EXISTS (SELECT 1 FROM trades WHERE id = @dup_id)
    AND (SELECT entry_price FROM trades WHERE id = 79) = 1135.75
);
DROP TEMPORARY TABLE _bf_dup_guard_post;
