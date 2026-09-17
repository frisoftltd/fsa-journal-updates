-- Incident fix for 2026_09_17_0002 (v3.12.0). That migration's 41 INSERTs and 17 UPDATEs
-- all ran successfully; only its final post-verify guard failed, because live had drifted
-- further than the guard anticipated:
--
--   - Trade 80 (BNBUSDT, 2026-09-14) is a genuine trade logged after the 2026-09-16
--     snapshot §2's mapping was built from. It isn't part of the 58-position Bitfunded
--     CSV (which ends 2026-09-13) and needs no action — it just pushes the challenge's
--     total row count from 58 to 59 and its loss count from 35 to 36, which is exactly
--     why 0002's guard (hardcoded at COUNT(*)=58) tripped even though nothing was wrong.
--   - Trade 79 (ZECUSDT Long, entered manually as 2026-09-13 06:05:00, pnl already -95.79)
--     is the SAME closed position as CSV row n=1 (Bitfunded's own time_in: 2026-09-13
--     06:05:09) — also logged after the snapshot, so it was never in the §2 id mapping
--     and 0002 had no way to know about it. 0002's duplicate guard for the 41 new inserts
--     matched on exact (pair, direction, time_in); a 9-second gap between a hand-typed
--     timestamp and Bitfunded's own defeated that check, so 0002 inserted a *second* row
--     for this same position instead of recognizing trade 79 as already covering it.
--
-- Net effect before this file: 60 rows for the challenge (59 real positions + 1
-- duplicate), trade 79 still carrying its original hand-typed time_in/prices, and
-- 2026_09_17_0002 marked 'failed' in schema_migrations even though its data changes were
-- correct and must not be re-attempted (see the recovery note near the bottom).
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

-- Recovery: mark 2026_09_17_0002 as applied instead of failed. Its data changes were
-- correct — only its own COUNT(*)=58 guard was stale, tripped by trade 80 (a legitimate
-- row it never claimed to account for) — so it must not be allowed to run a second time;
-- retrying it would re-run all 41 INSERTs (harmless, each is already idempotent) and all
-- 17 UPDATEs (harmless, idempotent by id) but its final guard would still fail forever now
-- that the challenge legitimately has 59 rows, not 58. Same INSERT ... ON DUPLICATE KEY
-- UPDATE shape migrate.php's own recordMigration() uses, so this is indistinguishable from
-- a normal successful run once applied. The checksum below is the sha256 of the exact file
-- already deployed and applied on 2026-09-17 — 2026_09_17_0002 itself is not edited by
-- this file or any other, per the checksum-lock convention in CLAUDE.md §3A.
INSERT INTO schema_migrations (filename, checksum, execution_ms, status, error_message)
VALUES (
    '2026_09_17_0002_import_bitfunded_altcoin_trades.sql',
    '7025c415e1a933b6032e5ba170ab8805947a5365f9e33171fcab6e0dc7b7ec21',
    NULL, 'applied', NULL
)
ON DUPLICATE KEY UPDATE
    checksum = VALUES(checksum),
    applied_at = CURRENT_TIMESTAMP,
    status = VALUES(status),
    error_message = VALUES(error_message);

-- Post-verify: expected end state per the incident report.
CREATE TEMPORARY TABLE _bf_dup_guard_post (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_dup_guard_post (ok) VALUES (
    (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id) = 59
    AND (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id AND result = 'Win') = 23
    AND (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id AND result = 'Loss') = 36
    AND (SELECT COUNT(*) FROM trade_variables) = 135
    AND (SELECT COUNT(*) FROM trade_variables WHERE trade_id = 79) = 9
    AND NOT EXISTS (SELECT 1 FROM trades WHERE id = @dup_id)
    AND (SELECT entry_price FROM trades WHERE id = 79) = 1135.75
    AND (
        SELECT status FROM schema_migrations
        WHERE filename = '2026_09_17_0002_import_bitfunded_altcoin_trades.sql'
        AND checksum = '7025c415e1a933b6032e5ba170ab8805947a5365f9e33171fcab6e0dc7b7ec21'
    ) = 'applied'
);
DROP TEMPORARY TABLE _bf_dup_guard_post;
