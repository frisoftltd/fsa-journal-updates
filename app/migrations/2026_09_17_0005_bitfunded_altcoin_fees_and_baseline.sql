-- Bitfunded Altcoin (challenge id 6) fee backfill + baseline correction (v3.13.0).
-- Scope: challenge 6 only. Challenges 4 (TradeFi) and 5 (BTC) have the same two defects
-- (wrong starting_balance, missing per-trade fees) and are deliberately not touched here —
-- every statement below is scoped to challenge_id = 6 / id = 6.
--
-- Three things this file fixes, all documented in full in CLAUDE.md:
--   1. starting_balance was 9,274.00 — the account's equity on 2026-08-10 (when this
--      challenge record was created), not the real 10,000.00 every Bitfunded account
--      starts at. The v3.12.0 import extended the journal back to inception
--      (2026-06-21), so the baseline the whole challenge was scoped against was wrong
--      for five weeks of real trading history.
--   2. fees were 0 on 41 of 59 rows (2026_09_17_0002's import — Bitfunded's own Position
--      History doesn't publish per-position fees). The account's transaction log does,
--      and every fee timestamp matches a position open or close time to the second
--      (verified before this file was written, not re-verified here).
--   3. current_balance is no longer read from anywhere (dropped in
--      2026_09_17_0004) — this file does not set it; balance is derived by
--      includes/helpers.php::enrichChallenge() from starting_balance + realised net P&L
--      - funding_adjustment.
--
-- Funding fees (6.6369 net) are NOT split across the 59 trades below. The transaction
-- log labels funding entries "USDT", not by symbol, and several dates have multiple
-- funding entries sharing one timestamp while positions overlap in time — attributing
-- them to a specific trade would mean guessing. Applied once, at the challenge level, via
-- funding_adjustment.
--
-- Every UPDATE below matches on (challenge_id, pair, direction, time_in) rather than a
-- trade id, per the same reasoning 2026_09_17_0003 already had to learn: this account's
-- trade ids have shifted around across three prior migrations (imports, a duplicate
-- fix, a retry) and are not something a new migration file should trust blind. pnl,
-- r_multiple, r_multiple_source, result and every strategy/psychology field are
-- untouched — this file only ever sets fees and the net_pnl that follows from it.
--
-- net_pnl below is written as `pnl - <fee>`, referencing each row's own stored pnl
-- column, not a literal copied from bitfunded-altcoin-fees.csv. That CSV's own pnl
-- column sums to -120.07; live's actual trades.pnl sums to -120.08 — a one-cent gap
-- between two valid derivations of the same figure from Bitfunded's own reporting (see
-- CLAUDE.md v3.13.2), not a data error, and not something worth chasing to the specific
-- row. Referencing the column guarantees net_pnl is always (whatever pnl is actually
-- stored) minus its new fee, regardless of which side of that one-cent gap any
-- individual row falls on.
CREATE TEMPORARY TABLE _bf_fee_guard_pre (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_fee_guard_pre (ok) VALUES (
    (SELECT COUNT(*) FROM challenges WHERE id = 6 AND name LIKE '%Altcoin%') = 1
    AND (SELECT COUNT(*) FROM trades WHERE challenge_id = 6) = 59
    -- gross pnl must still be exactly what this file was written against -- if it
    -- isn't, something changed challenge 6's trades since and this file should not
    -- proceed blind. -120.08 confirmed against live, not the fees CSV's own -120.07
    -- (see the note above).
    AND ROUND((SELECT SUM(pnl) FROM trades WHERE challenge_id = 6), 2) = -120.08
    -- trade 80 must still be in its known-stale, hand-typed state before the timestamp
    -- fix below runs -- see the note above the fix itself.
    AND (SELECT COUNT(*) FROM trades WHERE id = 80 AND challenge_id = 6 AND pair = 'BNBUSDT' AND direction = 'Long' AND time_in = '2026-09-14 06:08:00') = 1
);
DROP TEMPORARY TABLE _bf_fee_guard_pre;

-- Baseline correction + challenge-level cost.
UPDATE challenges SET
    starting_balance = 10000.00,
    funding_adjustment = 6.6369,
    profit_target_amt = 800.00,
    max_loss_amt = 1000.00,
    daily_loss_limit = 500.00
WHERE id = 6;

-- Trade 80 (BNBUSDT, manual) carried a hand-typed time_in of 2026-09-14 06:08:00 against
-- Bitfunded's own 06:08:19 -- the same off-by-seconds pattern that caused the ZEC
-- duplicate in v3.12.x, this time silently missing the fee UPDATE's
-- (pair, direction, time_in) match key below instead of creating a second row. Corrected
-- to Bitfunded's exact time_in/time_out here, before the fee UPDATEs run, rather than
-- special-casing the n=80 UPDATE's WHERE clause to also accept the stale timestamp --
-- trade 80 should carry Bitfunded's own time either way, and this is the last row in the
-- challenge still carrying a hand-typed one.
UPDATE trades SET
    time_in = '2026-09-14 06:08:19',
    time_out = '2026-09-15 20:49:24'
WHERE id = 80 AND challenge_id = 6 AND pair = 'BNBUSDT' AND direction = 'Long';

-- Per-trade fees (59 rows, source: bitfunded-altcoin-fees.csv, verified against the
-- account's transaction log before this file was written).

-- CSV row n=1: ZECUSDT Long 2026-09-13 06:05:09
UPDATE trades SET
    fees = 1.5698,
    net_pnl = pnl - 1.5698
WHERE challenge_id = 6 AND pair = 'ZECUSDT' AND direction = 'Long' AND time_in = '2026-09-13 06:05:09';

-- CSV row n=2: LITUSDT Long 2026-09-11 15:07:02
UPDATE trades SET
    fees = 0.8382,
    net_pnl = pnl - 0.8382
WHERE challenge_id = 6 AND pair = 'LITUSDT' AND direction = 'Long' AND time_in = '2026-09-11 15:07:02';

-- CSV row n=3: TRXUSDT Short 2026-09-10 15:09:17
UPDATE trades SET
    fees = 9.5545,
    net_pnl = pnl - 9.5545
WHERE challenge_id = 6 AND pair = 'TRXUSDT' AND direction = 'Short' AND time_in = '2026-09-10 15:09:17';

-- CSV row n=4: XMRUSDT Long 2026-09-10 05:58:11
UPDATE trades SET
    fees = 1.4877,
    net_pnl = pnl - 1.4877
WHERE challenge_id = 6 AND pair = 'XMRUSDT' AND direction = 'Long' AND time_in = '2026-09-10 05:58:11';

-- CSV row n=5: HYPEUSDT Long 2026-09-07 11:19:29
UPDATE trades SET
    fees = 4.4952,
    net_pnl = pnl - 4.4952
WHERE challenge_id = 6 AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-09-07 11:19:29';

-- CSV row n=6: PUMPUSDT Short 2026-09-01 10:40:54
UPDATE trades SET
    fees = 0.9711,
    net_pnl = pnl - 0.9711
WHERE challenge_id = 6 AND pair = 'PUMPUSDT' AND direction = 'Short' AND time_in = '2026-09-01 10:40:54';

-- CSV row n=7: HYPEUSDT Long 2026-09-05 09:36:02
UPDATE trades SET
    fees = 5.4390,
    net_pnl = pnl - 5.4390
WHERE challenge_id = 6 AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-09-05 09:36:02';

-- CSV row n=8: BNBUSDT Long 2026-08-31 14:11:56
UPDATE trades SET
    fees = 4.2181,
    net_pnl = pnl - 4.2181
WHERE challenge_id = 6 AND pair = 'BNBUSDT' AND direction = 'Long' AND time_in = '2026-08-31 14:11:56';

-- CSV row n=9: PUMPUSDT Short 2026-08-31 06:48:07
UPDATE trades SET
    fees = 1.0641,
    net_pnl = pnl - 1.0641
WHERE challenge_id = 6 AND pair = 'PUMPUSDT' AND direction = 'Short' AND time_in = '2026-08-31 06:48:07';

-- CSV row n=10: ZECUSDT Long 2026-08-26 06:46:21
UPDATE trades SET
    fees = 1.5632,
    net_pnl = pnl - 1.5632
WHERE challenge_id = 6 AND pair = 'ZECUSDT' AND direction = 'Long' AND time_in = '2026-08-26 06:46:21';

-- CSV row n=11: INJUSDT Short 2026-08-28 07:08:36
UPDATE trades SET
    fees = 1.2918,
    net_pnl = pnl - 1.2918
WHERE challenge_id = 6 AND pair = 'INJUSDT' AND direction = 'Short' AND time_in = '2026-08-28 07:08:36';

-- CSV row n=12: INJUSDT Short 2026-08-28 07:01:53
UPDATE trades SET
    fees = 3.0844,
    net_pnl = pnl - 3.0844
WHERE challenge_id = 6 AND pair = 'INJUSDT' AND direction = 'Short' AND time_in = '2026-08-28 07:01:53';

-- CSV row n=13: BNBUSDT Short 2026-08-24 04:57:24
UPDATE trades SET
    fees = 3.8516,
    net_pnl = pnl - 3.8516
WHERE challenge_id = 6 AND pair = 'BNBUSDT' AND direction = 'Short' AND time_in = '2026-08-24 04:57:24';

-- CSV row n=14: LITUSDT Long 2026-08-21 09:56:38
UPDATE trades SET
    fees = 1.2409,
    net_pnl = pnl - 1.2409
WHERE challenge_id = 6 AND pair = 'LITUSDT' AND direction = 'Long' AND time_in = '2026-08-21 09:56:38';

-- CSV row n=15: ZECUSDT Long 2026-08-20 10:00:04
UPDATE trades SET
    fees = 1.0056,
    net_pnl = pnl - 1.0056
WHERE challenge_id = 6 AND pair = 'ZECUSDT' AND direction = 'Long' AND time_in = '2026-08-20 10:00:04';

-- CSV row n=16: BTCUSDT Long 2026-08-20 11:47:10
UPDATE trades SET
    fees = 0.9785,
    net_pnl = pnl - 0.9785
WHERE challenge_id = 6 AND pair = 'BTCUSDT' AND direction = 'Long' AND time_in = '2026-08-20 11:47:10';

-- CSV row n=17: BTCUSDT Long 2026-08-20 11:42:45
UPDATE trades SET
    fees = 1.9575,
    net_pnl = pnl - 1.9575
WHERE challenge_id = 6 AND pair = 'BTCUSDT' AND direction = 'Long' AND time_in = '2026-08-20 11:42:45';

-- CSV row n=18: BNBUSDT Long 2026-08-17 06:03:10
UPDATE trades SET
    fees = 3.4431,
    net_pnl = pnl - 3.4431
WHERE challenge_id = 6 AND pair = 'BNBUSDT' AND direction = 'Long' AND time_in = '2026-08-17 06:03:10';

-- CSV row n=19: PUMPUSDT Long 2026-08-13 05:20:55
UPDATE trades SET
    fees = 0.6374,
    net_pnl = pnl - 0.6374
WHERE challenge_id = 6 AND pair = 'PUMPUSDT' AND direction = 'Long' AND time_in = '2026-08-13 05:20:55';

-- CSV row n=20: BTCUSDT Short 2026-08-13 19:49:59
UPDATE trades SET
    fees = 1.2163,
    net_pnl = pnl - 1.2163
WHERE challenge_id = 6 AND pair = 'BTCUSDT' AND direction = 'Short' AND time_in = '2026-08-13 19:49:59';

-- CSV row n=21: ADAUSDT Short 2026-08-13 19:49:48
UPDATE trades SET
    fees = 1.2136,
    net_pnl = pnl - 1.2136
WHERE challenge_id = 6 AND pair = 'ADAUSDT' AND direction = 'Short' AND time_in = '2026-08-13 19:49:48';

-- CSV row n=22: BNBUSDT Long 2026-08-12 13:02:02
UPDATE trades SET
    fees = 2.9165,
    net_pnl = pnl - 2.9165
WHERE challenge_id = 6 AND pair = 'BNBUSDT' AND direction = 'Long' AND time_in = '2026-08-12 13:02:02';

-- CSV row n=23: INJUSDT Short 2026-08-11 18:49:20
UPDATE trades SET
    fees = 1.3706,
    net_pnl = pnl - 1.3706
WHERE challenge_id = 6 AND pair = 'INJUSDT' AND direction = 'Short' AND time_in = '2026-08-11 18:49:20';

-- CSV row n=24: ETHUSDT Short 2026-08-10 14:42:47
UPDATE trades SET
    fees = 2.6357,
    net_pnl = pnl - 2.6357
WHERE challenge_id = 6 AND pair = 'ETHUSDT' AND direction = 'Short' AND time_in = '2026-08-10 14:42:47';

-- CSV row n=25: ZECUSDT Long 2026-08-10 08:57:30
UPDATE trades SET
    fees = 2.3827,
    net_pnl = pnl - 2.3827
WHERE challenge_id = 6 AND pair = 'ZECUSDT' AND direction = 'Long' AND time_in = '2026-08-10 08:57:30';

-- CSV row n=26: PUMPUSDT Long 2026-08-08 16:28:58
UPDATE trades SET
    fees = 0.8558,
    net_pnl = pnl - 0.8558
WHERE challenge_id = 6 AND pair = 'PUMPUSDT' AND direction = 'Long' AND time_in = '2026-08-08 16:28:58';

-- CSV row n=27: HYPEUSDT Long 2026-08-06 18:50:38
UPDATE trades SET
    fees = 1.1094,
    net_pnl = pnl - 1.1094
WHERE challenge_id = 6 AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-08-06 18:50:38';

-- CSV row n=28: SAGAUSDT Long 2026-08-07 05:15:14
UPDATE trades SET
    fees = 1.5101,
    net_pnl = pnl - 1.5101
WHERE challenge_id = 6 AND pair = 'SAGAUSDT' AND direction = 'Long' AND time_in = '2026-08-07 05:15:14';

-- CSV row n=29: ONDOUSDT Long 2026-08-05 10:21:05
UPDATE trades SET
    fees = 0.6956,
    net_pnl = pnl - 0.6956
WHERE challenge_id = 6 AND pair = 'ONDOUSDT' AND direction = 'Long' AND time_in = '2026-08-05 10:21:05';

-- CSV row n=30: JUPUSDT Long 2026-08-05 17:07:26
UPDATE trades SET
    fees = 1.5876,
    net_pnl = pnl - 1.5876
WHERE challenge_id = 6 AND pair = 'JUPUSDT' AND direction = 'Long' AND time_in = '2026-08-05 17:07:26';

-- CSV row n=31: BNBUSDT Short 2026-08-01 12:17:13
UPDATE trades SET
    fees = 2.5127,
    net_pnl = pnl - 2.5127
WHERE challenge_id = 6 AND pair = 'BNBUSDT' AND direction = 'Short' AND time_in = '2026-08-01 12:17:13';

-- CSV row n=32: ONDOUSDT Long 2026-08-02 05:27:07
UPDATE trades SET
    fees = 1.7480,
    net_pnl = pnl - 1.7480
WHERE challenge_id = 6 AND pair = 'ONDOUSDT' AND direction = 'Long' AND time_in = '2026-08-02 05:27:07';

-- CSV row n=33: SOLUSDT Long 2026-07-28 18:12:54
UPDATE trades SET
    fees = 2.6244,
    net_pnl = pnl - 2.6244
WHERE challenge_id = 6 AND pair = 'SOLUSDT' AND direction = 'Long' AND time_in = '2026-07-28 18:12:54';

-- CSV row n=34: ZECUSDT Long 2026-07-30 07:28:42
UPDATE trades SET
    fees = 1.2468,
    net_pnl = pnl - 1.2468
WHERE challenge_id = 6 AND pair = 'ZECUSDT' AND direction = 'Long' AND time_in = '2026-07-30 07:28:42';

-- CSV row n=35: VIRTUALUSDT Short 2026-07-27 07:55:10
UPDATE trades SET
    fees = 1.9958,
    net_pnl = pnl - 1.9958
WHERE challenge_id = 6 AND pair = 'VIRTUALUSDT' AND direction = 'Short' AND time_in = '2026-07-27 07:55:10';

-- CSV row n=36: SOLUSDT Short 2026-07-21 19:56:52
UPDATE trades SET
    fees = 1.8455,
    net_pnl = pnl - 1.8455
WHERE challenge_id = 6 AND pair = 'SOLUSDT' AND direction = 'Short' AND time_in = '2026-07-21 19:56:52';

-- CSV row n=37: INJUSDT Long 2026-07-23 11:25:29
UPDATE trades SET
    fees = 1.5185,
    net_pnl = pnl - 1.5185
WHERE challenge_id = 6 AND pair = 'INJUSDT' AND direction = 'Long' AND time_in = '2026-07-23 11:25:29';

-- CSV row n=38: VIRTUALUSDT Short 2026-07-21 18:33:58
UPDATE trades SET
    fees = 1.0266,
    net_pnl = pnl - 1.0266
WHERE challenge_id = 6 AND pair = 'VIRTUALUSDT' AND direction = 'Short' AND time_in = '2026-07-21 18:33:58';

-- CSV row n=39: ETHUSDT Long 2026-07-18 07:01:56
UPDATE trades SET
    fees = 1.4653,
    net_pnl = pnl - 1.4653
WHERE challenge_id = 6 AND pair = 'ETHUSDT' AND direction = 'Long' AND time_in = '2026-07-18 07:01:56';

-- CSV row n=40: SOLUSDT Long 2026-07-14 16:26:20
UPDATE trades SET
    fees = 0.8124,
    net_pnl = pnl - 0.8124
WHERE challenge_id = 6 AND pair = 'SOLUSDT' AND direction = 'Long' AND time_in = '2026-07-14 16:26:20';

-- CSV row n=41: ONDOUSDT Short 2026-07-16 19:14:59
UPDATE trades SET
    fees = 1.0797,
    net_pnl = pnl - 1.0797
WHERE challenge_id = 6 AND pair = 'ONDOUSDT' AND direction = 'Short' AND time_in = '2026-07-16 19:14:59';

-- CSV row n=42: JUPUSDT Long 2026-07-14 15:24:10
UPDATE trades SET
    fees = 0.6563,
    net_pnl = pnl - 0.6563
WHERE challenge_id = 6 AND pair = 'JUPUSDT' AND direction = 'Long' AND time_in = '2026-07-14 15:24:10';

-- CSV row n=43: ETHUSDT Short 2026-07-13 05:56:20
UPDATE trades SET
    fees = 0.8583,
    net_pnl = pnl - 0.8583
WHERE challenge_id = 6 AND pair = 'ETHUSDT' AND direction = 'Short' AND time_in = '2026-07-13 05:56:20';

-- CSV row n=44: HYPEUSDT Long 2026-07-10 06:01:53
UPDATE trades SET
    fees = 1.9992,
    net_pnl = pnl - 1.9992
WHERE challenge_id = 6 AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-07-10 06:01:53';

-- CSV row n=45: SOLUSDT Long 2026-07-10 06:19:47
UPDATE trades SET
    fees = 1.5830,
    net_pnl = pnl - 1.5830
WHERE challenge_id = 6 AND pair = 'SOLUSDT' AND direction = 'Long' AND time_in = '2026-07-10 06:19:47';

-- CSV row n=46: ATOMUSDT Short 2026-07-05 05:38:22
UPDATE trades SET
    fees = 2.4442,
    net_pnl = pnl - 2.4442
WHERE challenge_id = 6 AND pair = 'ATOMUSDT' AND direction = 'Short' AND time_in = '2026-07-05 05:38:22';

-- CSV row n=47: INJUSDT Short 2026-07-05 05:49:41
UPDATE trades SET
    fees = 1.3324,
    net_pnl = pnl - 1.3324
WHERE challenge_id = 6 AND pair = 'INJUSDT' AND direction = 'Short' AND time_in = '2026-07-05 05:49:41';

-- CSV row n=48: VIRTUALUSDT Long 2026-07-05 09:53:57
UPDATE trades SET
    fees = 2.7345,
    net_pnl = pnl - 2.7345
WHERE challenge_id = 6 AND pair = 'VIRTUALUSDT' AND direction = 'Long' AND time_in = '2026-07-05 09:53:57';

-- CSV row n=49: ONDOUSDT Long 2026-07-03 21:27:38
UPDATE trades SET
    fees = 2.3277,
    net_pnl = pnl - 2.3277
WHERE challenge_id = 6 AND pair = 'ONDOUSDT' AND direction = 'Long' AND time_in = '2026-07-03 21:27:38';

-- CSV row n=50: VIRTUALUSDT Short 2026-07-02 09:21:27
UPDATE trades SET
    fees = 2.2627,
    net_pnl = pnl - 2.2627
WHERE challenge_id = 6 AND pair = 'VIRTUALUSDT' AND direction = 'Short' AND time_in = '2026-07-02 09:21:27';

-- CSV row n=51: ZECUSDT Short 2026-07-01 10:30:55
UPDATE trades SET
    fees = 1.6803,
    net_pnl = pnl - 1.6803
WHERE challenge_id = 6 AND pair = 'ZECUSDT' AND direction = 'Short' AND time_in = '2026-07-01 10:30:55';

-- CSV row n=52: HYPEUSDT Long 2026-07-01 05:35:10
UPDATE trades SET
    fees = 1.9846,
    net_pnl = pnl - 1.9846
WHERE challenge_id = 6 AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-07-01 05:35:10';

-- CSV row n=53: INJUSDT Short 2026-06-27 20:49:36
UPDATE trades SET
    fees = 1.1492,
    net_pnl = pnl - 1.1492
WHERE challenge_id = 6 AND pair = 'INJUSDT' AND direction = 'Short' AND time_in = '2026-06-27 20:49:36';

-- CSV row n=54: SOLUSDT Long 2026-06-26 16:18:28
UPDATE trades SET
    fees = 1.6993,
    net_pnl = pnl - 1.6993
WHERE challenge_id = 6 AND pair = 'SOLUSDT' AND direction = 'Long' AND time_in = '2026-06-26 16:18:28';

-- CSV row n=55: ZECUSDT Short 2026-06-25 11:03:15
UPDATE trades SET
    fees = 2.5059,
    net_pnl = pnl - 2.5059
WHERE challenge_id = 6 AND pair = 'ZECUSDT' AND direction = 'Short' AND time_in = '2026-06-25 11:03:15';

-- CSV row n=56: HYPEUSDT Long 2026-06-22 18:46:45
UPDATE trades SET
    fees = 1.0041,
    net_pnl = pnl - 1.0041
WHERE challenge_id = 6 AND pair = 'HYPEUSDT' AND direction = 'Long' AND time_in = '2026-06-22 18:46:45';

-- CSV row n=57: BTCUSDT Short 2026-06-21 10:28:46
UPDATE trades SET
    fees = 4.0173,
    net_pnl = pnl - 4.0173
WHERE challenge_id = 6 AND pair = 'BTCUSDT' AND direction = 'Short' AND time_in = '2026-06-21 10:28:46';

-- CSV row n=58: BTCUSDT Short 2026-06-21 10:14:18
UPDATE trades SET
    fees = 19.9487,
    net_pnl = pnl - 19.9487
WHERE challenge_id = 6 AND pair = 'BTCUSDT' AND direction = 'Short' AND time_in = '2026-06-21 10:14:18';

-- CSV row n=80: BNBUSDT Long 2026-09-14 06:08:19
UPDATE trades SET
    fees = 3.8669,
    net_pnl = pnl - 3.8669
WHERE challenge_id = 6 AND pair = 'BNBUSDT' AND direction = 'Long' AND time_in = '2026-09-14 06:08:19';


-- Post-verify: matches the §6 verification list this file was written against, corrected
-- for the one-cent gap noted above. -258.1959 = -120.08 - 138.1159. The resulting derived
-- balance (10000 - 258.1959 - 6.6369 = 9735.1672) is one cent off Bitfunded's own reported
-- 9735.1772 -- documented in CLAUDE.md v3.13.2 as a residual, not forced to match by
-- adjusting funding_adjustment or any fee to paper over it.
CREATE TEMPORARY TABLE _bf_fee_guard_post (ok TINYINT NOT NULL CHECK (ok = 1));
INSERT INTO _bf_fee_guard_post (ok) VALUES (
    (SELECT starting_balance FROM challenges WHERE id = 6) = 10000.00
    AND (SELECT funding_adjustment FROM challenges WHERE id = 6) = 6.6369
    AND (SELECT profit_target_amt FROM challenges WHERE id = 6) = 800.00
    AND (SELECT max_loss_amt FROM challenges WHERE id = 6) = 1000.00
    AND (SELECT daily_loss_limit FROM challenges WHERE id = 6) = 500.00
    AND (SELECT COUNT(*) FROM trades WHERE challenge_id = 6) = 59
    AND ROUND((SELECT SUM(fees) FROM trades WHERE challenge_id = 6), 4) = 138.1159
    AND ROUND((SELECT SUM(net_pnl) FROM trades WHERE challenge_id = 6), 4) = -258.1959
    -- pnl itself must be exactly unchanged by this file -- only fees/net_pnl move.
    AND ROUND((SELECT SUM(pnl) FROM trades WHERE challenge_id = 6), 2) = -120.08
    AND (SELECT COUNT(*) FROM trade_variables) = 135
);
DROP TEMPORARY TABLE _bf_fee_guard_post;
