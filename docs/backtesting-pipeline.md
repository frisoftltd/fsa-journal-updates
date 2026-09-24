# Backtesting Phase 1a — Candle Pipeline & Chart

Built against the briefing: Bybit v5 candle data into MySQL, plus a TradingView-styled
chart reading only from that MySQL data. No replay engine, drawing tools, or orders yet
(phase 1b).

**Not verified end-to-end in this session** — this environment has no live Bybit
network access, no MySQL instance, and no browser to click through. Every SQL statement,
PHP function, and JS interaction below was written carefully against the documented
Bybit v5 contract and this codebase's own conventions, and the pure logic (timeframe
math, gap detection, closed-candle filtering, CLI arg parsing, upsert placeholder
counts) was unit-tested standalone — but the actual HTTP calls to Bybit, the actual
MySQL writes, and the actual chart rendering in a browser have not been run. Treat the
first real backfill run and the first side-by-side chart comparison as the real test,
and report back anything that doesn't match this doc so it can be fixed against real
data rather than reasoned about again in the abstract.

## Files

```
app/migrations/2026_09_24_0002_create_backtesting_tables.sql   -- symbols, candles, candle_sync + seed
app/includes/bybit_client.php                                   -- shared: fetch, upsert, gap detection, CLI helpers
app/includes/controllers/ChartController.php                    -- get_symbols / get_candles (MySQL only)
app/cli/backfill.php                                             -- one-time-per-symbol historical backfill
app/cli/update.php                                               -- incremental updater (cron, every 15 min)
app/cli/verify.php                                               -- gap report + optional spot-check
app/cli/repair.php                                               -- refetches reported gaps
app/pages/chart.php, app/js/chart.js, app/css/style.css          -- the chart page
```

## 1. Deploy and migrate

Deploy this release the normal way (GitHub updater → Update Now), then run the new
migration the normal way:

```
https://fundedcontrol.com/migrate.php?mode=status&token=...
https://fundedcontrol.com/migrate.php?mode=run&token=...
```

This creates `symbols` (seeded with BTCUSDT/ETHUSDT/BNBUSDT), `candles`, and
`candle_sync`. Confirm with `mode=status` that it shows `applied`.

## 2. Lock down the CLI scripts

`app/cli/*.php` refuse to run under any SAPI except `cli` (see `backtestRequireCli()`
in `bybit_client.php`) — a direct HTTP request to `/cli/backfill.php` gets a 403. That's
a code-level guard, not a substitute for blocking it at the web server too. Add this to
the site's nginx vhost (CloudPanel → your site → Vhost tab) and reload nginx:

```nginx
location ^~ /cli/ {
    deny all;
    return 403;
}
```

## 3. First backfill

Over SSH, from the site root (`/home/fundedcontrol/htdocs/fundedcontrol.com`):

```bash
php cli/backfill.php
```

With no arguments this backfills every enabled symbol × every timeframe (15m, 1H, 4H,
1D), from each symbol's actual earliest available candle (auto-detected — never assumed
to be 2020-01-01, even though that's the default probe start) through now. Expect this
to take a while for three symbols across four timeframes going back to 2020 — it's
paced (one request per ~150ms, plus backoff on any rate-limit response) rather than
hammering Bybit.

Progress prints to the terminal and appends to
`/home/fundedcontrol/htdocs/backtesting-logs/backfill.log` — **that log directory path
is one level up from `htdocs/fundedcontrol.com`, deliberately outside this site's own
document root** (so an accidental direct request for a log file 404s at the vhost level
instead of serving plain text). Verify this resolves to a real, writable location on
your actual CloudPanel layout before the first run — if your site's `htdocs` structure
differs from what's assumed here, adjust the `BACKTEST_LOG_FILE` `dirname(__DIR__, 2)`
line at the top of each `app/cli/*.php` file accordingly.

**Interrupted?** Just re-run the same command. `backfill.php` always resumes from
`candle_sync.latest_open_time` rather than re-walking history it already has, and every
write is an upsert keyed on `(symbol, timeframe, open_time)` — a re-fetched page can
never create a duplicate row.

Useful flags:

```bash
php cli/backfill.php --symbol=BTCUSDT                  # one symbol, every timeframe
php cli/backfill.php --symbol=BTCUSDT --timeframe=1D   # one symbol, one timeframe
php cli/backfill.php --from=2019-01-01                 # override the default 2020-01-01 probe start
```

## 4. Adding a symbol later

Per the briefing, this must never need a code change:

```sql
INSERT INTO symbols (symbol, display_name, enabled) VALUES ('SOLUSDT', 'Solana / USDT Perpetual', 1);
```

then:

```bash
php cli/backfill.php --symbol=SOLUSDT
```

It shows up in the chart's symbol switcher (`get_symbols` reads `enabled=1` rows live)
and in the cron updater's next run automatically.

## 5. The incremental updater (cron)

`php cli/update.php` tops up every enabled symbol/timeframe with newly-closed candles
since each one's own `candle_sync.latest_open_time`. It **never** stores the currently-
forming candle (`backtestCandleIsClosed()` filters it out) and **skips** any
symbol/timeframe with no `candle_sync` row yet (i.e. never backfilled) rather than
cold-starting a 2020-01-01 backfill inside a 15-minute cron tick.

Register it in **CloudPanel → your site → Cron Jobs** (or `crontab -e` as the site's
system user), every 15 minutes:

```
*/15 * * * * php /home/fundedcontrol/htdocs/fundedcontrol.com/cli/update.php >> /home/fundedcontrol/htdocs/backtesting-logs/update-cron.log 2>&1
```

(The script already logs to `backtesting-logs/update.log` on its own — the crontab
redirect above just also catches anything printed to stderr/a PHP fatal that the
script's own logger wouldn't see, e.g. a config.php DB connection failure.)

## 6. Verifying data integrity

```bash
php cli/verify.php                       # gap report, every symbol/timeframe
php cli/verify.php --symbol=BTCUSDT
php cli/verify.php --spotcheck=10        # + re-fetch 10 random stored candles per pair and diff values
```

Exit code is `1` if any gap or spot-check mismatch was found, `0` if everything's
clean — safe to wire into monitoring later. A "clean" report means: every expected
candle between the tracked earliest and latest open_time for that symbol+timeframe is
present (gap check), and — when `--spotcheck` is used — a random sample of stored
candles matches what Bybit currently returns for those same timestamps (value check).

**Definition of done, from the briefing:** run this after the first full backfill and
confirm a clean gap report for all three symbols × all four timeframes before treating
phase 1a as complete.

## 7. Repairing gaps

```bash
php cli/repair.php                       # every symbol/timeframe
php cli/repair.php --symbol=BTCUSDT --timeframe=15m
```

Re-detects gaps the same way `verify.php` reports them and refetches exactly those
ranges. Re-verifies afterward and reports anything still missing — if a gap survives a
repair pass, Bybit itself has no data for that range (exchange downtime, or a
pre-listing range that earliest-detection got slightly wrong), and it won't retry that
same unfillable range forever.

## 8. The chart

Sidebar → **Chart** (behind the existing session auth, same as every other page). Data
loads from `get_symbols`/`get_candles` — both MySQL-only; neither one, nor anything else
in the browser or in a page request, ever calls Bybit directly, per the briefing.

- **Comparison check:** open the same symbol/timeframe here and on Bybit's own BTCUSDT
  perpetual chart on TradingView side by side. Wicks and bodies should line up exactly —
  if they don't, check first whether `candle_sync`/`candles` for that pair actually have
  a clean `verify.php` report before suspecting the chart rendering itself.
- **Timezone:** defaults to the browser's own detected zone; the dropdown includes a
  small curated set of other zones (not the full IANA list). Lightweight Charts has no
  native timezone support, so this is implemented by shifting the timestamp fed to the
  library by the selected zone's real UTC offset at that instant (via `Intl`, so DST is
  handled correctly) — spot-check an hour that's known to be right on the edge of a DST
  change if you want to be extra sure, since that's the one edge case that couldn't be
  exercised without a real browser here.
- **Scrolling back** fetches older candles on demand (never the full history at once,
  per the briefing) once the visible window nears the start of what's currently loaded.

## Judgment calls made, not literally specified in the briefing

- `candles` has no surrogate `id` — its natural key `(symbol, timeframe, open_time)` is
  the `PRIMARY KEY`, which gives both the required UNIQUE constraint and the
  range-query-supporting index from one construct, InnoDB-clustered in exactly the order
  every read/write already needs.
- `candles.symbol`/`candle_sync.symbol` are plain `VARCHAR`, not FK'd to `symbols` —
  matches this codebase's own existing `trades.pair` (never FK'd to `pairs.symbol`
  either); the CLI scripts are the only writers and always read the symbol list from
  `symbols` first, so there's no path that could write an orphaned value.
- `symbols.earliest_candle_ms` (one value per symbol) is a coarse convenience figure
  rolled up from `candle_sync`'s own per-timeframe earliest values after a backfill —
  the operational source of truth for the pipeline itself is always `candle_sync`.
- Row-alias `INSERT ... AS new ON DUPLICATE KEY UPDATE` syntax (MySQL 8.0.19+/8.4) is
  used instead of the deprecated `VALUES()` function in `ON DUPLICATE KEY UPDATE`.
