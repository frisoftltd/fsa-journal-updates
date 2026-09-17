-- Backfills the Bitfunded Altcoin challenge (id resolved below from user_id/challenge_id
-- on existing trade id 49 — never hardcoded) with its full 58-position trade history.
-- The journal only had 17 of those 58 closed positions (everything logged from the point
-- the app existed) — a winner-weighted subset: 17 trades were +$773.83 at 62.5% win rate,
-- while Bitfunded's own Position History for the same challenge (2026-06-21 through
-- 2026-09-13) shows -$195.32 accumulated across all 58 at 39.7%. Every statistic, chart
-- and review insight scoped to this challenge was computed from that subset and was
-- wrong as a result. Source: bitfunded-altcoin-58-positions.csv, transcribed by hand from
-- Bitfunded's UI. The CSV's PnL column sums to -21.39 gross; Bitfunded's reported -195.32
-- accumulated is net of financing/trading fees this export doesn't itemize per-row (see
-- CLAUDE.md §11 for the full reconciliation note).
--
-- Matching (pair + direction + date + prices) was done ahead of writing this file and
-- found all 17 existing rows with no ambiguous or partial matches -- 41 rows need
-- inserting, 17 need updating. The pre-flight guard below re-checks that mapping against
-- whatever is live at migration time and stops before touching anything if it has
-- drifted.
--
-- R-multiple derivation (no per-trade stop-loss price exists for any of these, imported
-- or previously-journaled): the account's documented risk ladder (0.25% under $9,500,
-- 0.5% $9,500-$10,000, 1.0% above $10,000) does NOT reproduce the observed position
-- sizes -- replaying the balance from $10,000 shows risk staying near 1% through the
-- July/early-August drawdown while the ladder required 0.25%, a ~4x gap. Deriving R from
-- the ladder would understate the real losses by roughly that factor. Instead:
--   1. A loss is a full stop-out if 35 <= |pnl| <= 115 (this account's observed 1R band,
--      the same convention already used on the 17 pre-existing journaled rows). Those
--      get r_multiple = -1.00, risk_amount = |pnl|, r_multiple_source = 'recorded'.
--   2. Every other trade (wins, and losses that closed well inside that band -- this
--      account's manual/scratch exits, not stop-outs) gets risk_amount = the median
--      |pnl| of full stop-outs within a +/-7 day window of its time_in, and
--      r_multiple = pnl / that risk_unit, r_multiple_source = 'estimated'. 29 of the 58
--      rows land in each bucket. The full risk_unit series this produced is recorded in
--      the release notes for this version, not just here, so it can be sanity-checked
--      without reading SQL.
-- One loss (n=41 in the source CSV, ONDOUSDT, -6.67) closed inside the risk band but was
-- not called out in the original 9-item "scratch" list this migration was scoped
-- against -- the data disagrees with that list by one row. It is handled correctly by
-- rule 2 above regardless (resolves to a small fractional R, -0.14), so this is reported
-- here rather than special-cased.
--
-- Three defects fixed in the same pass (overwriting is otherwise limited to
-- entry_price/exit_price/time_in/time_out/pnl/result, since Bitfunded is authoritative
-- for those and the hand-typed originals differ by rounding, e.g. 511.15 vs 511.14):
--   - trade 59 (ADAUSDT): trade_date was 2026-08-17 but time_in was 2026-08-13; Bitfunded
--     shows open 2026-08-13 19:49:48 / close 2026-08-16 01:13:01 -- trade_date corrected
--     to match. Its r_multiple was also stuck at 0.00 on a winning trade; recomputed here.
--   - trade 77 (HYPEUSDT): was left `Open`; Bitfunded closed it 2026-09-05 21:19:45 at
--     86.00 for +112.05 -- result corrected to Win with the real exit.
--   - net_pnl is recomputed as the new pnl minus each row's EXISTING fees (fees
--     themselves are untouched -- not part of this reconciliation) so pnl and net_pnl
--     stay internally consistent after the price overwrite; not called out as a separate
--     defect in the original scoping but a necessary consequence of overwriting pnl.
--   - result is recomputed from the Bitfunded pnl sign for all 17 matched rows (not just
--     the two defects above), as a safety net against any other hand-typed sign mismatch
--     the pre-migration audit didn't catch -- none of the 58 positions are break-even, so
--     this is a safe Win/Loss recompute with no third case to preserve.
--
-- Preserved untouched on all 17 matched rows: trade_variables, emotion_tag, setup_grade,
-- the three note columns, fib_level, fsa_rules, strategy_id, screenshots, fees. Trade ids
-- do not change -- trade_variables has a foreign key on them (migration
-- 2026_09_13_0004).
--
-- Every inserted/updated row in this file gets source='import' (2026_09_17_0001 must run
-- first) and the r_multiple_source computed above. session, strategy_id, emotion_tag,
-- setup_grade, the three note columns, fib_level, fsa_rules, confidence, exec_score,
-- stop_loss, take_profit and lot_size are NULL on all 41 new rows -- none of this was
-- ever recorded for them and inventing it (session in particular, since no session
-- boundary is configured anywhere in this app) would misrepresent the data as observed
-- rather than backfilled. fees = 0 on new rows; Bitfunded reports fees only in aggregate,
-- not per position.
--
-- Idempotent by design, not just guarded: every INSERT is a
-- `SELECT ... WHERE NOT EXISTS` keyed on (user_id, challenge_id, pair, direction,
-- time_in), so re-running this file after a partial failure (this file contains DDL --
-- the guard temp tables -- so, per migrate.php, it does NOT run inside one wrapping
-- transaction; statements commit one at a time) skips whatever already landed instead of
-- duplicating it. The 17 UPDATEs are naturally idempotent (keyed on id).

-- Guard: the 17 existing rows named in the CLAUDE.md briefing (§2 mapping) must still
-- exist, under a single user/challenge, with the pair unchanged from the 2026-09-16
-- mapping this migration was written against. If live has drifted (a row deleted,
-- re-paired, or moved to a different challenge since), this stops the whole file
-- before any UPDATE/INSERT runs — see the "Adding a migration" lesson in CLAUDE.md
-- §3A about guards belonging inside the migration file, not as tribal knowledge.
SET @user_id := (SELECT user_id FROM trades WHERE id = 49);
SET @challenge_id := (SELECT challenge_id FROM trades WHERE id = 49);

CREATE TEMPORARY TABLE _bf_guard_pre (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_guard_pre (ok) VALUES (
    (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id) >= 17
    AND (
        SELECT COUNT(*) FROM trades
        WHERE user_id = @user_id AND challenge_id = @challenge_id
        AND (
        (id=49 AND pair='ZECUSDT')
        OR (id=51 AND pair='ETHUSDT')
        OR (id=54 AND pair='INJUSDT')
        OR (id=57 AND pair='BNBUSDT')
        OR (id=58 AND pair='PUMPUSDT')
        OR (id=59 AND pair='ADAUSDT')
        OR (id=60 AND pair='BNBUSDT')
        OR (id=62 AND pair='ZECUSDT')
        OR (id=63 AND pair='LITUSDT')
        OR (id=65 AND pair='BNBUSDT')
        OR (id=66 AND pair='ZECUSDT')
        OR (id=71 AND pair='INJUSDT')
        OR (id=72 AND pair='PUMPUSDT')
        OR (id=73 AND pair='BNBUSDT')
        OR (id=74 AND pair='PUMPUSDT')
        OR (id=77 AND pair='HYPEUSDT')
        OR (id=78 AND pair='HYPEUSDT')
        )
    ) = 17
);
DROP TEMPORARY TABLE _bf_guard_pre;


-- ── UPDATE the 17 existing rows (Bitfunded is authoritative for prices/times/pnl) ──

-- trade id 49: ZECUSDT Long, CSV row n=25
UPDATE trades SET
    entry_price=511.14,
    exit_price=501.94,
    time_in='2026-08-10 08:57:30',
    time_out='2026-08-10 14:29:43',
    pnl=-54.12,
    net_pnl=-54.12 - fees,
    r_multiple=-1.0,
    risk_amount=54.12,
    result='Loss',
    source='import',
    r_multiple_source='recorded'
WHERE id=49;

-- trade id 51: ETHUSDT Short, CSV row n=24
UPDATE trades SET
    entry_price=1912.64,
    exit_price=1852.79,
    time_in='2026-08-10 14:42:47',
    time_out='2026-08-11 17:42:21',
    pnl=104.73,
    net_pnl=104.73 - fees,
    r_multiple=2.23,
    risk_amount=47.06,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=51;

-- trade id 54: INJUSDT Short, CSV row n=23
UPDATE trades SET
    entry_price=4.47,
    exit_price=4.59,
    time_in='2026-08-11 18:49:20',
    time_out='2026-08-11 22:40:33',
    pnl=-47.02,
    net_pnl=-47.02 - fees,
    r_multiple=-1.0,
    risk_amount=47.02,
    result='Loss',
    source='import',
    r_multiple_source='recorded'
WHERE id=54;

-- trade id 57: BNBUSDT Long, CSV row n=22
UPDATE trades SET
    entry_price=614.62,
    exit_price=606.73,
    time_in='2026-08-12 13:02:02',
    time_out='2026-08-13 17:30:33',
    pnl=-47.06,
    net_pnl=-47.06 - fees,
    r_multiple=-1.0,
    risk_amount=47.06,
    result='Loss',
    source='import',
    r_multiple_source='recorded'
WHERE id=57;

-- trade id 58: PUMPUSDT Long, CSV row n=19
UPDATE trades SET
    entry_price=0.00,
    exit_price=0.00,
    time_in='2026-08-13 05:20:55',
    time_out='2026-08-19 17:28:10',
    pnl=119.06,
    net_pnl=119.06 - fees,
    r_multiple=2.53,
    risk_amount=47.06,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=58;

-- trade id 59: ADAUSDT Short, CSV row n=21
UPDATE trades SET
    trade_date='2026-08-13',
    entry_price=0.18,
    exit_price=0.17,
    time_in='2026-08-13 19:49:48',
    time_out='2026-08-16 01:13:01',
    pnl=44.07,
    net_pnl=44.07 - fees,
    r_multiple=0.94,
    risk_amount=47.04,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=59;

-- trade id 60: BNBUSDT Long, CSV row n=18
UPDATE trades SET
    entry_price=605.77,
    exit_price=620.42,
    time_in='2026-08-17 06:03:10',
    time_out='2026-08-19 18:26:51',
    pnl=102.88,
    net_pnl=102.88 - fees,
    r_multiple=2.03,
    risk_amount=50.59,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=60;

-- trade id 62: ZECUSDT Long, CSV row n=15
UPDATE trades SET
    entry_price=558.73,
    exit_price=644.16,
    time_in='2026-08-20 10:00:04',
    time_out='2026-08-21 09:42:25',
    pnl=178.54,
    net_pnl=178.54 - fees,
    r_multiple=1.86,
    risk_amount=95.87,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=62;

-- trade id 63: LITUSDT Long, CSV row n=14
UPDATE trades SET
    entry_price=2.76,
    exit_price=3.22,
    time_in='2026-08-21 09:56:38',
    time_out='2026-08-22 04:33:51',
    pnl=234.8,
    net_pnl=234.8 - fees,
    r_multiple=2.45,
    risk_amount=95.87,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=63;

-- trade id 65: BNBUSDT Short, CSV row n=13
UPDATE trades SET
    entry_price=699.96,
    exit_price=714.04,
    time_in='2026-08-24 04:57:24',
    time_out='2026-08-24 17:21:54',
    pnl=-95.87,
    net_pnl=-95.87 - fees,
    r_multiple=-1.0,
    risk_amount=95.87,
    result='Loss',
    source='import',
    r_multiple_source='recorded'
WHERE id=65;

-- trade id 66: ZECUSDT Long, CSV row n=10
UPDATE trades SET
    entry_price=785.52,
    exit_price=884.71,
    time_in='2026-08-26 06:46:21',
    time_out='2026-08-30 18:56:45',
    pnl=232.09,
    net_pnl=232.09 - fees,
    r_multiple=2.33,
    risk_amount=99.59,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=66;

-- trade id 71: INJUSDT Short, CSV row n=11
UPDATE trades SET
    entry_price=5.32,
    exit_price=5.09,
    time_in='2026-08-28 07:08:36',
    time_out='2026-08-29 16:58:59',
    pnl=69.43,
    net_pnl=69.43 - fees,
    r_multiple=0.7,
    risk_amount=99.59,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=71;

-- trade id 72: PUMPUSDT Short, CSV row n=9
UPDATE trades SET
    entry_price=0.00,
    exit_price=0.00,
    time_in='2026-08-31 06:48:07',
    time_out='2026-09-01 02:15:58',
    pnl=-103.31,
    net_pnl=-103.31 - fees,
    r_multiple=-1.0,
    risk_amount=103.31,
    result='Loss',
    source='import',
    r_multiple_source='recorded'
WHERE id=72;

-- trade id 73: BNBUSDT Long, CSV row n=8
UPDATE trades SET
    entry_price=688.96,
    exit_price=689.52,
    time_in='2026-08-31 14:11:56',
    time_out='2026-09-01 09:37:55',
    pnl=4.23,
    net_pnl=4.23 - fees,
    r_multiple=0.04,
    risk_amount=102.42,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=73;

-- trade id 74: PUMPUSDT Short, CSV row n=6
UPDATE trades SET
    entry_price=0.00,
    exit_price=0.00,
    time_in='2026-09-01 10:40:54',
    time_out='2026-09-07 10:48:43',
    pnl=78.23,
    net_pnl=78.23 - fees,
    r_multiple=0.76,
    risk_amount=102.42,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=74;

-- trade id 77: HYPEUSDT Long, CSV row n=7
UPDATE trades SET
    entry_price=84.60,
    exit_price=86.00,
    time_in='2026-09-05 09:36:02',
    time_out='2026-09-05 21:19:45',
    pnl=112.05,
    net_pnl=112.05 - fees,
    r_multiple=1.1,
    risk_amount=102.16,
    result='Win',
    source='import',
    r_multiple_source='estimated'
WHERE id=77;

-- trade id 78: HYPEUSDT Long, CSV row n=5
UPDATE trades SET
    entry_price=87.36,
    exit_price=85.80,
    time_in='2026-09-07 11:19:29',
    time_out='2026-09-07 17:18:27',
    pnl=-101.53,
    net_pnl=-101.53 - fees,
    r_multiple=-1.0,
    risk_amount=101.53,
    result='Loss',
    source='import',
    r_multiple_source='recorded'
WHERE id=78;

-- ── INSERT the 41 missing rows (idempotent: safe to re-run after a partial failure) ──

-- CSV row n=1: ZECUSDT Long 2026-09-13 06:05:09
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-09-13', NULL, '2026-09-13 06:05:09', '2026-09-13 11:31:43', 'ZECUSDT', 'Long',
     1135.75, NULL, NULL, 1081.63, NULL, 95.79, 0,
     -95.79, -95.79, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ZECUSDT' AND direction = 'Long' AND time_in = '2026-09-13 06:05:09'
);

-- CSV row n=2: LITUSDT Long 2026-09-11 15:07:02
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-09-11', NULL, '2026-09-11 15:07:02', '2026-09-12 21:54:14', 'LITUSDT', 'Long',
     4.63, NULL, NULL, 4.20, NULL, 102.16, 0,
     -102.16, -102.16, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'LITUSDT' AND direction = 'Long' AND time_in = '2026-09-11 15:07:02'
);

-- CSV row n=3: TRXUSDT Short 2026-09-10 15:09:17
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-09-10', NULL, '2026-09-10 15:09:17', '2026-09-10 15:15:20', 'TRXUSDT', 'Short',
     0.33, NULL, NULL, 0.33, NULL, 101.53, 0,
     3.75, 3.75, 0.04, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'TRXUSDT' AND direction = 'Short' AND time_in = '2026-09-10 15:09:17'
);

-- CSV row n=4: XMRUSDT Long 2026-09-10 05:58:11
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-09-10', NULL, '2026-09-10 05:58:11', '2026-09-10 06:12:14', 'XMRUSDT', 'Long',
     515.59, NULL, NULL, 514.71, NULL, 101.53, 0,
     -3.18, -3.18, -0.03, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'XMRUSDT' AND direction = 'Long' AND time_in = '2026-09-10 05:58:11'
);

-- CSV row n=12: INJUSDT Short 2026-08-28 07:01:53
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-28', NULL, '2026-08-28 07:01:53', '2026-08-28 07:07:50', 'INJUSDT', 'Short',
     5.32, NULL, NULL, 5.33, NULL, 99.59, 0,
     -1.88, -1.88, -0.02, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'INJUSDT' AND direction = 'Short' AND time_in = '2026-08-28 07:01:53'
);

-- CSV row n=16: BTCUSDT Long 2026-08-20 11:47:10
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-20', NULL, '2026-08-20 11:47:10', '2026-08-20 11:48:50', 'BTCUSDT', 'Long',
     71968.30, NULL, NULL, 71942.70, NULL, 95.87, 0,
     -0.43, -0.43, 0.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'BTCUSDT' AND direction = 'Long' AND time_in = '2026-08-20 11:47:10'
);

-- CSV row n=17: BTCUSDT Long 2026-08-20 11:42:45
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-20', NULL, '2026-08-20 11:42:45', '2026-08-20 11:43:04', 'BTCUSDT', 'Long',
     71962.10, NULL, NULL, 71984.10, NULL, 95.87, 0,
     0.74, 0.74, 0.01, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'BTCUSDT' AND direction = 'Long' AND time_in = '2026-08-20 11:42:45'
);

-- CSV row n=20: BTCUSDT Short 2026-08-13 19:49:59
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-13', NULL, '2026-08-13 19:49:59', '2026-08-17 05:56:08', 'BTCUSDT', 'Short',
     63221.00, NULL, NULL, 63488.50, NULL, 47.04, 0,
     -6.42, -6.42, -0.14, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'BTCUSDT' AND direction = 'Short' AND time_in = '2026-08-13 19:49:59'
);

-- CSV row n=26: PUMPUSDT Long 2026-08-08 16:28:58
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-08', NULL, '2026-08-08 16:28:58', '2026-08-09 13:19:50', 'PUMPUSDT', 'Long',
     0.00, NULL, NULL, 0.00, NULL, 47.17, 0,
     91.07, 91.07, 1.93, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'PUMPUSDT' AND direction = 'Long' AND time_in = '2026-08-08 16:28:58'
);

-- CSV row n=27: HYPEUSDT Long 2026-08-06 18:50:38
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-06', NULL, '2026-08-06 18:50:38', '2026-08-07 19:21:43', 'HYPEUSDT', 'Long',
     56.19, NULL, NULL, 54.31, NULL, 47.28, 0,
     -47.28, -47.28, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-08-06 18:50:38'
);

-- CSV row n=28: SAGAUSDT Long 2026-08-07 05:15:14
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-07', NULL, '2026-08-07 05:15:14', '2026-08-07 05:16:56', 'SAGAUSDT', 'Long',
     0.01, NULL, NULL, 0.01, NULL, 44.24, 0,
     -44.24, -44.24, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'SAGAUSDT' AND direction = 'Long' AND time_in = '2026-08-07 05:15:14'
);

-- CSV row n=29: ONDOUSDT Long 2026-08-05 10:21:05
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-05', NULL, '2026-08-05 10:21:05', '2026-08-06 22:54:26', 'ONDOUSDT', 'Long',
     0.38, NULL, NULL, 0.36, NULL, 50.54, 0,
     -50.54, -50.54, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ONDOUSDT' AND direction = 'Long' AND time_in = '2026-08-05 10:21:05'
);

-- CSV row n=30: JUPUSDT Long 2026-08-05 17:07:26
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-05', NULL, '2026-08-05 17:07:26', '2026-08-06 10:14:43', 'JUPUSDT', 'Long',
     0.18, NULL, NULL, 0.18, NULL, 40.31, 0,
     -40.31, -40.31, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'JUPUSDT' AND direction = 'Long' AND time_in = '2026-08-05 17:07:26'
);

-- CSV row n=31: BNBUSDT Short 2026-08-01 12:17:13
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-01', NULL, '2026-08-01 12:17:13', '2026-08-05 02:35:33', 'BNBUSDT', 'Short',
     582.80, NULL, NULL, 600.27, NULL, 92.76, 0,
     -92.76, -92.76, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'BNBUSDT' AND direction = 'Short' AND time_in = '2026-08-01 12:17:13'
);

-- CSV row n=32: ONDOUSDT Long 2026-08-02 05:27:07
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-08-02', NULL, '2026-08-02 05:27:07', '2026-08-03 02:06:24', 'ONDOUSDT', 'Long',
     0.39, NULL, NULL, 0.37, NULL, 98.5, 0,
     -98.5, -98.5, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ONDOUSDT' AND direction = 'Long' AND time_in = '2026-08-02 05:27:07'
);

-- CSV row n=33: SOLUSDT Long 2026-07-28 18:12:54
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-28', NULL, '2026-07-28 18:12:54', '2026-08-01 19:30:23', 'SOLUSDT', 'Long',
     74.16, NULL, NULL, 71.97, NULL, 98.33, 0,
     -98.33, -98.33, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'SOLUSDT' AND direction = 'Long' AND time_in = '2026-07-28 18:12:54'
);

-- CSV row n=34: ZECUSDT Long 2026-07-30 07:28:42
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-30', NULL, '2026-07-30 07:28:42', '2026-08-01 18:59:51', 'ZECUSDT', 'Long',
     472.66, NULL, NULL, 471.92, NULL, 92.76, 0,
     -2.44, -2.44, -0.03, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ZECUSDT' AND direction = 'Long' AND time_in = '2026-07-30 07:28:42'
);

-- CSV row n=35: VIRTUALUSDT Short 2026-07-27 07:55:10
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-27', NULL, '2026-07-27 07:55:10', '2026-07-28 00:40:41', 'VIRTUALUSDT', 'Short',
     0.60, NULL, NULL, 0.57, NULL, 98.33, 0,
     99.36, 99.36, 1.01, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'VIRTUALUSDT' AND direction = 'Short' AND time_in = '2026-07-27 07:55:10'
);

-- CSV row n=36: SOLUSDT Short 2026-07-21 19:56:52
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-21', NULL, '2026-07-21 19:56:52', '2026-07-24 15:05:37', 'SOLUSDT', 'Short',
     77.66, NULL, NULL, 74.62, NULL, 98.33, 0,
     92.11, 92.11, 0.94, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'SOLUSDT' AND direction = 'Short' AND time_in = '2026-07-21 19:56:52'
);

-- CSV row n=37: INJUSDT Long 2026-07-23 11:25:29
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-23', NULL, '2026-07-23 11:25:29', '2026-07-24 07:18:08', 'INJUSDT', 'Long',
     5.18, NULL, NULL, 5.43, NULL, 98.33, 0,
     86.92, 86.92, 0.88, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'INJUSDT' AND direction = 'Long' AND time_in = '2026-07-23 11:25:29'
);

-- CSV row n=38: VIRTUALUSDT Short 2026-07-21 18:33:58
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-21', NULL, '2026-07-21 18:33:58', '2026-07-23 11:27:58', 'VIRTUALUSDT', 'Short',
     0.66, NULL, NULL, 0.61, NULL, 98.33, 0,
     92.55, 92.55, 0.94, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'VIRTUALUSDT' AND direction = 'Short' AND time_in = '2026-07-21 18:33:58'
);

-- CSV row n=39: ETHUSDT Long 2026-07-18 07:01:56
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-18', NULL, '2026-07-18 07:01:56', '2026-07-21 18:06:03', 'ETHUSDT', 'Long',
     1843.41, NULL, NULL, 1933.39, NULL, 45.2, 0,
     87.28, 87.28, 1.93, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ETHUSDT' AND direction = 'Long' AND time_in = '2026-07-18 07:01:56'
);

-- CSV row n=40: SOLUSDT Long 2026-07-14 16:26:20
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-14', NULL, '2026-07-14 16:26:20', '2026-07-17 15:11:48', 'SOLUSDT', 'Long',
     76.89, NULL, NULL, 73.56, NULL, 44.95, 0,
     -44.95, -44.95, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'SOLUSDT' AND direction = 'Long' AND time_in = '2026-07-14 16:26:20'
);

-- CSV row n=41: ONDOUSDT Short 2026-07-16 19:14:59
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-16', NULL, '2026-07-16 19:14:59', '2026-07-17 13:25:31', 'ONDOUSDT', 'Short',
     0.38, NULL, NULL, 0.38, NULL, 48.79, 0,
     -6.67, -6.67, -0.14, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ONDOUSDT' AND direction = 'Short' AND time_in = '2026-07-16 19:14:59'
);

-- CSV row n=42: JUPUSDT Long 2026-07-14 15:24:10
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-14', NULL, '2026-07-14 15:24:10', '2026-07-17 00:40:31', 'JUPUSDT', 'Long',
     0.20, NULL, NULL, 0.19, NULL, 48.79, 0,
     -48.79, -48.79, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'JUPUSDT' AND direction = 'Long' AND time_in = '2026-07-14 15:24:10'
);

-- CSV row n=43: ETHUSDT Short 2026-07-13 05:56:20
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-13', NULL, '2026-07-13 05:56:20', '2026-07-14 14:56:57', 'ETHUSDT', 'Short',
     1780.38, NULL, NULL, 1857.00, NULL, 45.2, 0,
     -45.2, -45.2, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ETHUSDT' AND direction = 'Short' AND time_in = '2026-07-13 05:56:20'
);

-- CSV row n=44: HYPEUSDT Long 2026-07-10 06:01:53
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-10', NULL, '2026-07-10 06:01:53', '2026-07-13 06:37:37', 'HYPEUSDT', 'Long',
     68.40, NULL, NULL, 65.60, NULL, 104.57, 0,
     -104.57, -104.57, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-07-10 06:01:53'
);

-- CSV row n=45: SOLUSDT Long 2026-07-10 06:19:47
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-10', NULL, '2026-07-10 06:19:47', '2026-07-13 05:19:24', 'SOLUSDT', 'Long',
     79.07, NULL, NULL, 75.53, NULL, 90.62, 0,
     -90.62, -90.62, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'SOLUSDT' AND direction = 'Long' AND time_in = '2026-07-10 06:19:47'
);

-- CSV row n=46: ATOMUSDT Short 2026-07-05 05:38:22
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-05', NULL, '2026-07-05 05:38:22', '2026-07-06 23:00:37', 'ATOMUSDT', 'Short',
     1.56, NULL, NULL, 1.62, NULL, 103.57, 0,
     -103.57, -103.57, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ATOMUSDT' AND direction = 'Short' AND time_in = '2026-07-05 05:38:22'
);

-- CSV row n=47: INJUSDT Short 2026-07-05 05:49:41
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-05', NULL, '2026-07-05 05:49:41', '2026-07-06 20:28:07', 'INJUSDT', 'Short',
     4.71, NULL, NULL, 4.98, NULL, 91.91, 0,
     -91.91, -91.91, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'INJUSDT' AND direction = 'Short' AND time_in = '2026-07-05 05:49:41'
);

-- CSV row n=48: VIRTUALUSDT Long 2026-07-05 09:53:57
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-05', NULL, '2026-07-05 09:53:57', '2026-07-06 07:30:04', 'VIRTUALUSDT', 'Long',
     0.56, NULL, NULL, 0.55, NULL, 93.18, 0,
     -93.18, -93.18, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'VIRTUALUSDT' AND direction = 'Long' AND time_in = '2026-07-05 09:53:57'
);

-- CSV row n=49: ONDOUSDT Long 2026-07-03 21:27:38
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-03', NULL, '2026-07-03 21:27:38', '2026-07-05 11:39:39', 'ONDOUSDT', 'Long',
     0.33, NULL, NULL, 0.32, NULL, 108.03, 0,
     -108.03, -108.03, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ONDOUSDT' AND direction = 'Long' AND time_in = '2026-07-03 21:27:38'
);

-- CSV row n=50: VIRTUALUSDT Short 2026-07-02 09:21:27
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-02', NULL, '2026-07-02 09:21:27', '2026-07-02 12:31:12', 'VIRTUALUSDT', 'Short',
     0.54, NULL, NULL, 0.56, NULL, 87.22, 0,
     -87.22, -87.22, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'VIRTUALUSDT' AND direction = 'Short' AND time_in = '2026-07-02 09:21:27'
);

-- CSV row n=51: ZECUSDT Short 2026-07-01 10:30:55
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-01', NULL, '2026-07-01 10:30:55', '2026-07-01 16:20:05', 'ZECUSDT', 'Short',
     397.22, NULL, NULL, 415.37, NULL, 93.8, 0,
     -93.8, -93.8, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ZECUSDT' AND direction = 'Short' AND time_in = '2026-07-01 10:30:55'
);

-- CSV row n=52: HYPEUSDT Long 2026-07-01 05:35:10
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-07-01', NULL, '2026-07-01 05:35:10', '2026-07-01 12:46:28', 'HYPEUSDT', 'Long',
     65.28, NULL, NULL, 62.59, NULL, 104.44, 0,
     -104.44, -104.44, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-07-01 05:35:10'
);

-- CSV row n=53: INJUSDT Short 2026-06-27 20:49:36
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-06-27', NULL, '2026-06-27 20:49:36', '2026-06-30 22:35:51', 'INJUSDT', 'Short',
     4.79, NULL, NULL, 4.67, NULL, 90.51, 0,
     35.96, 35.96, 0.4, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'INJUSDT' AND direction = 'Short' AND time_in = '2026-06-27 20:49:36'
);

-- CSV row n=54: SOLUSDT Long 2026-06-26 16:18:28
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-06-26', NULL, '2026-06-26 16:18:28', '2026-06-29 21:03:19', 'SOLUSDT', 'Long',
     71.06, NULL, NULL, 75.44, NULL, 87.22, 0,
     127.01, 127.01, 1.46, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'SOLUSDT' AND direction = 'Long' AND time_in = '2026-06-26 16:18:28'
);

-- CSV row n=55: ZECUSDT Short 2026-06-25 11:03:15
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-06-25', NULL, '2026-06-25 11:03:15', '2026-06-25 15:54:04', 'ZECUSDT', 'Short',
     416.34, NULL, NULL, 386.83, NULL, 87.22, 0,
     230.17, 230.17, 2.64, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'ZECUSDT' AND direction = 'Short' AND time_in = '2026-06-25 11:03:15'
);

-- CSV row n=56: HYPEUSDT Long 2026-06-22 18:46:45
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-06-22', NULL, '2026-06-22 18:46:45', '2026-06-23 08:07:27', 'HYPEUSDT', 'Long',
     67.33, NULL, NULL, 64.79, NULL, 48.4, 0,
     -48.4, -48.4, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-06-22 18:46:45'
);

-- CSV row n=57: BTCUSDT Short 2026-06-21 10:28:46
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-06-21', NULL, '2026-06-21 10:28:46', '2026-06-22 03:26:18', 'BTCUSDT', 'Short',
     64030.90, NULL, NULL, 64731.80, NULL, 54.67, 0,
     -54.67, -54.67, -1.0, 'Loss', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'recorded'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'BTCUSDT' AND direction = 'Short' AND time_in = '2026-06-21 10:28:46'
);

-- CSV row n=58: BTCUSDT Short 2026-06-21 10:14:18
INSERT INTO trades
    (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
     entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount, fees,
     pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
     notes, screenshot, screenshots, strategy_id, emotion_tag, setup_grade,
     note_saw, note_why, note_unsure, source, r_multiple_source)
SELECT @user_id, @challenge_id, '2026-06-21', NULL, '2026-06-21 10:14:18', '2026-06-21 10:16:38', 'BTCUSDT', 'Short',
     64116.60, NULL, NULL, 64088.90, NULL, 51.53, 0,
     10.77, 10.77, 0.21, 'Win', NULL, NULL, NULL, NULL,
     'Imported from Bitfunded Position History (2026-09-17).', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, 'import', 'estimated'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = @user_id AND challenge_id = @challenge_id
    AND pair = 'BTCUSDT' AND direction = 'Short' AND time_in = '2026-06-21 10:14:18'
);

-- Post-verify: full reconciliation against Bitfunded's Position History (58 closed
-- positions, 2026-06-21 to 2026-09-13). If this fails, the UPDATE/INSERT statements
-- above already ran (no wrapping transaction once DDL — the guard tables above — is
-- present in this file) -- treat a failure here as "stop and inspect the data by
-- hand", not as "nothing happened", same convention as migration 2026_09_13_0003.
CREATE TEMPORARY TABLE _bf_guard_post (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_guard_post (ok) VALUES (
    (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id) = 58
    AND (SELECT COUNT(*) FROM (
            SELECT pair, direction, time_in FROM trades
            WHERE user_id = @user_id AND challenge_id = @challenge_id
            GROUP BY pair, direction, time_in HAVING COUNT(*) > 1
         ) dupes) = 0
    AND ROUND((SELECT SUM(pnl) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id), 2) = -21.39
    AND (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id AND result = 'Win') = 23
    AND (SELECT COUNT(*) FROM trades WHERE user_id = @user_id AND challenge_id = @challenge_id AND result = 'Loss') = 35
    AND (SELECT result FROM trades WHERE id = 77) = 'Win'
    AND (SELECT trade_date FROM trades WHERE id = 59) = '2026-08-13'
);
DROP TEMPORARY TABLE _bf_guard_post;
