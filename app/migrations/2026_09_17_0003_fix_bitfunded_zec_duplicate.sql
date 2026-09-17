-- Incident fix for 2026_09_17_0002 (v3.12.0/v3.12.1). Original problem: 0002's duplicate
-- guard for the 41 new inserts matched on exact (pair, direction, time_in). Trade 79
-- (ZECUSDT Long), logged by hand at 2026-09-13 06:05:00 for the same closed position as
-- CSV row n=1 (Bitfunded's own time_in: 06:05:09), postdated the 2026-09-16 snapshot
-- §2's id mapping was built from, so 0002 had no way to recognize it — a 9-second gap
-- was enough to defeat the exact-match check, and 0002 inserted a second row for the
-- same position instead of recognizing trade 79 as already covering it.
--
-- v3.12.2 corrected 0002 in place (its guard was scoped to source='import' so a
-- legitimate unrelated trade like id 80 could never trip it again) and let it re-run.
-- On that run, live reported back as: 59 trades / 23W / 36L / sum(pnl) -120.08 for the
-- challenge, with only ONE ZECUSDT row in the 06:00:09-06:10:09 window, and it already
-- carrying Bitfunded's own figures (source='import') on id 79 — i.e. the target end
-- state was already reached, and this file's original pre-flight guard (which expected
-- to find exactly two rows in that window, the way it did after the very first
-- 2026-09-17 run) correctly failed, because that precondition was no longer true.
--
-- Note for whoever reads this later: 0002's own statements never target id 79 by name
-- (its 17-id UPDATE list is 49,51,54,57,58,59,60,62,63,65,66,71,72,73,74,77,78 — 79 is
-- not in it), so the mechanism that left id 79 already holding Bitfunded's figures on
-- this run is not fully reconstructable from the migration files alone; it is taken here
-- as an observed fact reported directly off live, not re-derived. Rather than assume any
-- particular history, this file now detects which of two states is actually live and
-- acts accordingly, so it is correct regardless of how that state was reached and safe
-- to run again on a fresh environment where the original duplicate-creation bug (still
-- present in 0002's exact-timestamp INSERT guard — only its post-verify guard was fixed)
-- could still reproduce:
--
--   - One ZECUSDT Long row in the window: already fixed. Asserts id 79 specifically
--     holds Bitfunded's figures and source='import' (the fact this file was asked to
--     confirm) rather than assuming it, then does nothing — the UPDATE/DELETE below
--     both become no-ops (their WHERE clauses require @already_fixed = 0).
--   - Two: the original incident. Identifies the keeper as whichever of the two rows
--     has trade_variables attached (9 of them) and the duplicate as whichever has none —
--     by attribute, not by assuming which id plays which role — then repairs the keeper
--     to Bitfunded's figures and deletes the duplicate, exactly as before.
--   - Anything else (0, or more than 2): fails loudly. That's not a state this incident
--     or its fix produces, so it means something this file doesn't know about needs a
--     human look before anything runs.
--
-- No schema_migrations write here (see 2026_09_17_0002's own history for why that's
-- wrong) — migrate.php's recordMigration() marks this file 'applied' the normal way once
-- it completes, whichever branch it took.

SET @user_id := (SELECT user_id FROM trades WHERE id = 79);
SET @challenge_id := (SELECT challenge_id FROM trades WHERE id = 79);

SET @zec_window_n := (
    SELECT COUNT(*) FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ZECUSDT' AND direction = 'Long'
    AND time_in BETWEEN '2026-09-13 06:00:09' AND '2026-09-13 06:10:09'
);

-- Already-fixed case: confirm it's really id 79, really holding Bitfunded's n=1 figures,
-- really marked source='import' — an assertion, not an assumption.
SET @already_fixed := (
    @zec_window_n = 1
    AND (
        SELECT COUNT(*) FROM trades
        WHERE id = 79 AND pair = 'ZECUSDT' AND direction = 'Long'
        AND entry_price = 1135.75 AND exit_price = 1081.63
        AND time_in = '2026-09-13 06:05:09' AND time_out = '2026-09-13 11:31:43'
        AND pnl = -95.79 AND source = 'import' AND r_multiple_source = 'recorded'
    ) = 1
);

-- Original-incident case: identify keeper/duplicate by trade_variables presence, not by
-- a hardcoded id (id 79 was the keeper last time this was observed, but this file no
-- longer relies on that holding true).
SET @keeper_id := (
    SELECT t.id FROM trades t
    WHERE t.user_id = @user_id AND t.challenge_id = @challenge_id
    AND t.pair = 'ZECUSDT' AND t.direction = 'Long'
    AND t.time_in BETWEEN '2026-09-13 06:00:09' AND '2026-09-13 06:10:09'
    AND (SELECT COUNT(*) FROM trade_variables tv WHERE tv.trade_id = t.id) = 9
    LIMIT 1
);
SET @dup_id := (
    SELECT t.id FROM trades t
    WHERE t.user_id = @user_id AND t.challenge_id = @challenge_id
    AND t.pair = 'ZECUSDT' AND t.direction = 'Long'
    AND t.time_in BETWEEN '2026-09-13 06:00:09' AND '2026-09-13 06:10:09'
    AND (SELECT COUNT(*) FROM trade_variables tv WHERE tv.trade_id = t.id) = 0
    LIMIT 1
);

CREATE TEMPORARY TABLE _bf_dup_guard_pre (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_dup_guard_pre (ok) VALUES (
    @already_fixed = 1
    OR (
        @zec_window_n = 2
        AND @keeper_id IS NOT NULL AND @dup_id IS NOT NULL AND @keeper_id <> @dup_id
    )
);
DROP TEMPORARY TABLE _bf_dup_guard_pre;

-- Repair the keeper — skipped as a no-op when @already_fixed = 1 (WHERE matches zero
-- rows either because @keeper_id is genuinely NULL in that branch, or because the
-- trailing "AND @already_fixed = 0" is false; either is sufficient on its own).
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
WHERE id = @keeper_id AND @already_fixed = 0;

-- Remove the duplicate — same no-op guarantee as above.
DELETE FROM trades WHERE id = @dup_id AND @already_fixed = 0;

-- Tolerance audit: re-scan the whole challenge for any (pair, direction) pair whose
-- time_in is within 5 minutes of another trade's — the same class of near-duplicate that
-- let this one slip past 0002's exact-timestamp check. Zero expected either way (already
-- fixed, or just fixed above); a nonzero result means at least one more undiscovered case
-- and this file stops rather than papering over it.
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

-- Post-verify: expected end state, true whichever branch above actually ran.
CREATE TEMPORARY TABLE _bf_dup_guard_post (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_dup_guard_post (ok) VALUES (
    (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id) = 59
    AND (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id AND result = 'Win') = 23
    AND (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id AND result = 'Loss') = 36
    AND ROUND((SELECT SUM(pnl) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id), 2) = -120.08
    AND (SELECT COUNT(*) FROM trade_variables) = 135
    AND (SELECT COUNT(*) FROM trade_variables WHERE trade_id = 79) = 9
    AND (SELECT COUNT(*) FROM trades WHERE id = 79 AND source = 'import' AND entry_price = 1135.75 AND exit_price = 1081.63) = 1
    -- @dup_id is NULL in the already-fixed branch (no window row has 0 trade_variables
    -- when there's only one row and it's the 9-variable keeper), so this is trivially
    -- true there and a real check in the fixed-this-run branch.
    AND NOT EXISTS (SELECT 1 FROM trades WHERE id = @dup_id)
);
DROP TEMPORARY TABLE _bf_dup_guard_post;
