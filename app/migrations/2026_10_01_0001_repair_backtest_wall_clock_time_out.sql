-- v3.22.3 Fix E — settleTrade() wrote wall-clock gmdate('Y-m-d H:i:s') for time_out
-- instead of the replay bar's own time, for every backtest trade closed before this
-- release shipped (see BacktestController.php's own updated docblock). This broke
-- rewind() outright: it reopens trades WHERE time_in <= cursor AND time_out > cursor --
-- with time_out stuck at "now" (2026) for every one of these rows, ANY rewind to a
-- cursor before the moment this migration runs satisfies that condition for every
-- already-closed trade opened before the new cursor, not just the ones actually closed
-- after it, silently reopening the trader's entire closed trade history on the very
-- first rewind.
--
-- One-off repair for existing rows: set time_out to the earliest candle, at the trade's
-- own session's replay_timeframe, on/after time_in whose [low,high] range actually
-- contains the recorded exit_price -- the same touch condition backtestCheckSlTp() uses
-- live (direction-agnostic here since exit_price alone doesn't say whether it was the
-- stop or the target, and a price touch is a price touch either way), just run backward
-- against history instead of forward during replay. Falls back to time_in itself when no
-- such candle is found (a manual/forced close at a price between two bars' exact touch
-- windows, or missing candle data for that symbol/timeframe/range) -- keeps time_in <=
-- time_out well-defined either way, which is all rewind's own comparison needs.
--
-- Scoped to source='backtest' AND time_out > NOW() - INTERVAL 1 YEAR, per the briefing --
-- a backtest trade's time_out should only ever be some bar from the session's own
-- replayed history (2020-era data in every observed case so far), so anything within the
-- last year is recognizable wall-clock-bug output, not a legitimately recent bar.
--
-- Logged to a small PERMANENT audit table (not a TEMPORARY one -- the point is a durable
-- record of exactly what changed, same "never silently discard a fact" reasoning behind
-- trades.backtest_rewound existing as a flag instead of a DELETE in the first place).
-- Re-running this file after a partial failure (DDL already committed, the INSERT or
-- UPDATE below didn't finish) re-logs already-repaired rows -- harmless (the UPDATE just
-- re-sets the same value), and acceptable for a one-off repair rather than adding
-- dedup logic this file will only ever run once in practice.

CREATE TABLE IF NOT EXISTS backtest_exit_time_repairs_log (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  trade_id     INT NOT NULL,
  old_time_out DATETIME NOT NULL,
  new_time_out DATETIME NOT NULL,
  repaired_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trade (trade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO backtest_exit_time_repairs_log (trade_id, old_time_out, new_time_out)
SELECT t.id, t.time_out,
  COALESCE(
    (SELECT MIN(FROM_UNIXTIME(c.open_time / 1000))
     FROM candles c
     JOIN backtest_sessions s ON s.id = t.backtest_session_id
     WHERE c.symbol = s.symbol
       AND c.timeframe = s.replay_timeframe
       AND c.open_time >= UNIX_TIMESTAMP(t.time_in) * 1000
       AND c.low <= t.exit_price AND c.high >= t.exit_price
    ),
    t.time_in
  )
FROM trades t
WHERE t.source = 'backtest'
  AND t.backtest_session_id IS NOT NULL
  AND t.time_out IS NOT NULL
  AND t.exit_price IS NOT NULL
  AND t.time_out > (NOW() - INTERVAL 1 YEAR);

UPDATE trades t
JOIN backtest_exit_time_repairs_log l ON l.trade_id = t.id
SET t.time_out = l.new_time_out
WHERE t.source = 'backtest'
  AND t.time_out > (NOW() - INTERVAL 1 YEAR);
