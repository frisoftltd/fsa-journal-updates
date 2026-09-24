-- FundedControl — Backtesting Phase 1a: candle data pipeline schema.
-- Three tables: symbols (which instruments this app tracks), candles (the OHLCV data
-- itself), candle_sync (per symbol+timeframe bookkeeping for the backfill/updater/verify
-- scripts). No FK from candles/candle_sync to symbols — `symbol` is stored as a plain
-- VARCHAR on both, the same convention this schema already uses for trades.pair (never
-- FK'd to pairs.symbol either): the backfill/updater CLI scripts are the only writers,
-- and they always read the symbol list from `symbols` first, so there is no path that
-- could write an orphaned symbol value. An FK here would only add a per-row check cost
-- on a high-write time-series table for no real correctness gain.

CREATE TABLE IF NOT EXISTS symbols (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  symbol             VARCHAR(20) NOT NULL COMMENT 'Bybit v5 linear perpetual symbol, e.g. BTCUSDT',
  display_name       VARCHAR(60) NOT NULL,
  enabled            TINYINT(1) NOT NULL DEFAULT 1,
  -- Coarse "how far back does this instrument go" fact for the chart/symbol switcher —
  -- NULL until the backfill script has run at least once for this symbol. This is
  -- distinct from candle_sync.earliest_open_time below, which is the operational,
  -- per-timeframe figure the backfill/verify/repair scripts actually key off; this
  -- column is set once at the end of a full per-symbol backfill as MIN(earliest) across
  -- that symbol's own candle_sync rows.
  earliest_candle_ms BIGINT DEFAULT NULL COMMENT 'earliest known open_time (UTC ms) across any timeframe',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_symbols_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- No surrogate id: nothing else ever needs to reference one candle row, and the natural
-- key (symbol, timeframe, open_time) is exactly both (a) what every upsert keys on, and
-- (b) what every read query filters/ranges on. Made the PRIMARY KEY rather than a
-- secondary UNIQUE index specifically so InnoDB clusters the table's physical storage in
-- this same order — that clustering IS the "index supporting range queries by (symbol,
-- timeframe, open_time)" the briefing separately asked for; a second, non-clustering
-- secondary index over the identical columns would only double write cost for zero
-- additional query benefit.
CREATE TABLE IF NOT EXISTS candles (
  symbol    VARCHAR(20) NOT NULL,
  timeframe ENUM('15m','1H','4H','1D') NOT NULL,
  -- Bybit's own kline `start` field: candle OPEN time, UTC milliseconds. Never the close
  -- time, and never adjusted for display timezone — that conversion happens client-side
  -- in js/chart.js only.
  open_time BIGINT NOT NULL,
  -- DECIMAL, not FLOAT, per the briefing. DECIMAL(20,10) matches the precision already
  -- established for trades.entry_price/exit_price (CLAUDE.md v3.14.5) for the identical
  -- reason: this account's real price range spans sub-cent altcoins to BTC's tens of
  -- thousands, and four decimal places was proven to silently truncate a sub-cent price
  -- to zero on that table — ten decimal places has headroom for any perp this pipeline
  -- will ever track.
  open      DECIMAL(20,10) NOT NULL,
  high      DECIMAL(20,10) NOT NULL,
  low       DECIMAL(20,10) NOT NULL,
  close     DECIMAL(20,10) NOT NULL,
  -- Base-asset volume, as Bybit reports it — fractional, hence DECIMAL not INT. 24,10
  -- gives headroom for a high-volume low-price asset without truncation.
  volume    DECIMAL(24,10) NOT NULL,
  PRIMARY KEY (symbol, timeframe, open_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- One row per symbol+timeframe. earliest/latest_open_time are the backfill/updater/
-- verify scripts' single source of truth for "what range is already stored" — the
-- backfill script resumes forward from latest_open_time rather than re-walking history
-- it already has, and verify.php's gap scan walks exactly [earliest_open_time,
-- latest_open_time] rather than guessing a range from MIN/MAX(candles.open_time) on
-- every run (cheap to query directly from the tracked row instead of scanning the
-- larger table). NULL earliest/latest means "never backfilled yet" — not a recorded
-- zero, same "absence of information" convention this codebase already uses everywhere
-- else (challenges.funding_adjustment, trades.funding, etc.).
CREATE TABLE IF NOT EXISTS candle_sync (
  symbol             VARCHAR(20) NOT NULL,
  timeframe          ENUM('15m','1H','4H','1D') NOT NULL,
  earliest_open_time BIGINT DEFAULT NULL,
  latest_open_time   BIGINT DEFAULT NULL,
  last_synced_at     DATETIME DEFAULT NULL,
  PRIMARY KEY (symbol, timeframe)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Seed the three Phase 1a symbols. Idempotent (safe to re-run / retry): a re-run only
-- refreshes display_name, never re-inserts or resets enabled/earliest_candle_ms.
INSERT INTO symbols (symbol, display_name, enabled) VALUES
  ('BTCUSDT', 'Bitcoin / USDT Perpetual', 1),
  ('ETHUSDT', 'Ethereum / USDT Perpetual', 1),
  ('BNBUSDT', 'BNB / USDT Perpetual', 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);
