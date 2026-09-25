# Backtesting — Candle Pipeline (Phase 1a) & Replay Engine (Phase 1b)

**Phase 1a** (v3.19.x): Bybit v5 candle data into MySQL, plus a TradingView-styled
chart reading only from that MySQL data. **Phase 1b** (v3.20.0): renamed the module
from "Chart" to "Backtesting" and added session setup, a no-lookahead replay engine,
order simulation (market/limit, SL/TP, fees), and challenge-rule enforcement
(profit target / daily & max drawdown / max trades per day) on top of the same candle
data. Drawing tools and the FSA gate checklist are still out of scope — next phase.

**Not verified end-to-end in this session** — this environment has no live Bybit
network access, no MySQL instance, and no browser to click through, for either phase.
Every SQL statement and PHP function was written carefully against this codebase's own
conventions, and the pure, DB-free logic (timeframe math, gap detection, upsert
placeholder counts, position sizing, P&L/fee formulas, stop/target-touch detection,
drawdown distance) was unit-tested standalone — but the actual HTTP calls to Bybit, the
actual MySQL writes/reads, and the actual UI in a browser have not been run. Treat the
first real backfill, the first side-by-side chart comparison, and the first real
backtest session as the real tests, and report back anything that doesn't match this
doc.

## Files

```
-- Phase 1a (data pipeline) --
app/migrations/2026_09_24_0002_create_backtesting_tables.sql   -- symbols, candles, candle_sync + seed
app/includes/bybit_client.php                                   -- shared: fetch, upsert, gap detection, CLI helpers
app/includes/controllers/ChartController.php                    -- get_symbols / get_candles (MySQL only, plain browsing)
app/cli/backfill.php                                             -- one-time-per-symbol historical backfill
app/cli/update.php                                               -- incremental updater (cron, every 15 min)
app/cli/verify.php                                               -- gap report + optional spot-check
app/cli/repair.php                                               -- refetches reported gaps

-- Phase 1b (replay engine) --
app/migrations/2026_09_25_0001_create_backtest_tables.sql       -- backtest_sessions, backtest_pending_orders, trades ALTER
app/includes/backtest_engine.php                                 -- pure fill/P&L/fee/drawdown math (unit-tested standalone)
app/includes/controllers/BacktestController.php                  -- sessions, no-lookahead candles, advance, orders
app/pages/backtest.php, app/js/backtest.js                       -- session list / setup / replay UI
app/css/style.css                                                -- shared dark full-bleed layout + new panel styles
app/js/chart.js                                                  -- reused as the low-level rendering engine (see §9)
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

## 8. Plain candle browsing (`get_symbols`/`get_candles`)

`ChartController` still exists and is still MySQL-only — neither it, nor anything else
in the browser or in a page request, ever calls Bybit directly. It's no longer wired to
its own nav item (the sidebar's "Chart" entry was renamed to "Backtesting" in v3.20.0,
which owns the route now), but `get_symbols` is still called directly by the session
setup form, and the underlying rendering functions in `js/chart.js` (timezone handling,
legend, candlestick+volume series) are reused by the replay view — see §9.

- **Timezone:** defaults to the browser's own detected zone; the dropdown includes a
  small curated set of other zones (not the full IANA list). Lightweight Charts has no
  native timezone support, so this is implemented by shifting the timestamp fed to the
  library by the selected zone's real UTC offset at that instant (via `Intl`, so DST is
  handled correctly) — spot-check an hour that's known to be right on the edge of a DST
  change if you want to be extra sure, since that's the one edge case that couldn't be
  exercised without a real browser here.

## 9. Replay engine architecture

**Three screens (v3.20.1 rework), exactly one visible at a time**
(`js/backtest.js::showBacktestScreen()`):
- **Screen A** (`#bt-screen-form`) — new-backtest setup, including the required
  **Session Name** field. This is what the sidebar's "Backtesting" link opens directly
  — no session list first.
- **Screen B** (`#bt-screen-window`) — the actual replay: chart, controls, order panel,
  challenge panel. Creating a session goes straight here. Full-bleed and dark
  (`body.backtest-active`, toggled by `showBacktestScreen()` itself exactly when
  entering/leaving this one screen — not page-wide, so Screens A/C stay normal
  light-themed content like every other page).
- **Screen C** (`#bt-screen-list`) — saved backtests (name, symbol, timeframe, status,
  equity, progress). Reached via "View Backtests" inside Screen B (or a shortcut on
  Screen A); clicking a row reopens it in Screen B.

**v3.20.1 also fixed a real bug:** the symbol dropdown and session list could get stuck
on "Loading…" forever with nothing visible to the user. Root cause: no error handling
anywhere in `backtest.js` — `api()`'s own `res.json()` throws on a non-JSON response
(e.g. a PHP fatal error from a missing table), and an uncaught exception inside an
`await` silently aborts the rest of that function. The most likely concrete trigger:
`get_backtest_sessions` requires `backtest_sessions` to exist, i.e. **the v3.20.0
migration must actually be applied** before Screen C (or session creation) can work at
all — if you're seeing this again, check that first. Every API call in `backtest.js` now
goes through `btApi()`, which normalizes both a thrown exception and an application-level
`{error}` response into the same shape, so every screen shows a visible "Failed to load
…" message instead of hanging.

`js/chart.js`'s low-level rendering (`initTvChart()`, `resizeTvChart()`,
`renderChartData()`, `updateLegendFromCandle()`, the whole `chartState` object) is
reused as-is for the replay view — `js/backtest.js` points `chartState.symbol`/
`timeframe`/`candles`/`blindMode` at the active session's own data and calls the same
rendering functions, rather than duplicating a second candlestick chart implementation.
The one hook added for this: `window.btFetchCandlesOverride`, which — when
`backtest.js` sets it — redirects `chart.js`'s own `fetchCandles()` (used by both the
initial load and the existing scroll-back-to-load-older-candles logic) to
`get_backtest_candles` instead of the plain `get_candles`. Scrolling back during a
replay is view-only and reuses this exact mechanism; it never moves the session's own
replay cursor.

## 10. No-lookahead (the one rule this whole engine exists to enforce)

`BacktestController::getCandles()` clamps every response to
`session.replay_cursor_ms + one interval`, server-side, regardless of what a client's
`before`/`limit` params ask for — the browser is never trusted to hide future candles
on its own. `BacktestController::advance()` is the only thing that ever moves
`replay_cursor_ms` forward, one bar (or a capped batch, for "jump to latest") at a time,
persisting the new cursor to `backtest_sessions` after each bar so a session can be
closed mid-replay and resumed exactly where it left off.

**No-lookahead test, not run in this environment:** truncate `candles` (or just query
with `open_time <= N`) for a symbol/timeframe at some bar N, confirm
`get_backtest_candles` for a session whose `replay_cursor_ms = N` returns exactly that
same set, and confirm a live replay that has advanced to bar N produces the identical
fills up to that point. This is the check the briefing's own "Definition of done" names
explicitly — it needs a real database and hasn't been run here.

## 11. Order simulation

Every position is sized from `risk% × current equity ÷ stop distance`
(`backtestPositionSize()`, `includes/backtest_engine.php`) and fees are charged
independently on entry and exit (`backtestFee()`). Market orders fill at the current
bar's close; limit orders sit in `backtest_pending_orders` until a later bar's high/low
touches the limit price. Every open position's stop-loss and take-profit are checked
bar-by-bar against that bar's own high/low (`backtestCheckSlTp()`) — **if a single bar's
range touches both levels, stop-loss wins**, a deliberately conservative assumption
since OHLC data alone can't say which was actually touched first intrabar, and assuming
the worse outcome can only ever understate a backtest's performance, never flatter it.

Run `php includes/backtest_engine.php` (no DB, no network) to exercise the position
sizing, P&L, fee, and stop/target-touch formulas standalone — 21 assertions, including
every direction/touch-combination and the SL-wins-on-both-touched tie-break.

## 12. Challenge simulation

`backtest_sessions` has **no stored equity or peak-equity column** — deriving both live
from `trades` every time (`BacktestController::computeSessionState()`) is a deliberate
repeat of the exact fix `challenges.current_balance` needed in this codebase already
(CLAUDE.md v3.13.0: a stored, incrementally-updated balance drifted silently for five
weeks before being dropped in favour of always deriving it). Daily and max drawdown are
both checked against **total equity** (realised + floating P&L of any still-open
position), matching how a real funded account is actually liquidated on unrealized
loss, not just on a closed trade — the moment either is breached, the session is marked
`failed`, any still-open position is force-closed at that same bar's price, and the
reason/bar/equity are frozen permanently. The profit target check is the mirror case for
`passed`, recording how many distinct trading days and how many trades it took. Max
trades per day is a soft **block** on new order placement, not a failure, per the
briefing's own distinction between the two.

## 13. Trade log isolation — the audit this release did, and why it mattered

Backtest trades write into the **same** `trades` table live trades use
(`source='backtest'`, `backtest_session_id=<session>`, `challenge_id=NULL` — the only
value that's both legal against `trades.challenge_id`'s existing foreign key to
`challenges(id)` and never mistakable for a real challenge's id; see
`migrations/2026_09_25_0001`'s own header comment for the full reasoning). Every
existing reader of `trades` in this app was checked and, where needed, patched to add
`AND source != 'backtest'` explicitly — NULL alone does **not** protect a real
challenge's scoped views, because this schema's pervasive
`(challenge_id=? OR challenge_id IS NULL)` pattern already treats a NULL-challenge row
as "belongs to every challenge" (the legacy pre-v2.3.0 case). Files patched:
`StatsController.php` (`$where`/`$chWhere`/`today_pnl`), `AlertController.php` (all
three trades queries), `TradeController::getAll()`, `ReviewEngineController.php`
(`listPeriods()`, `fetchTrades()`, `ruleOvertrading()`'s own "all combined" branches),
`ReportCardAiController.php`, and `StrategyBuilderController::getLeaderboard()`
(defense-in-depth — backtest trades never set `strategy_id` today, but excluded
explicitly rather than relying on that staying true forever). `helpers.php`'s
`challengeBalance()`/`balanceAtDayStart()`/`tradeLimitStatus()` needed **no** change —
they already scope with a bare `challenge_id=?` (never `OR challenge_id IS NULL`), which
a NULL-challenge backtest row can never match regardless of what real challenge id is
bound.

**Verify this explicitly, per the briefing** — with real data: create a backtest
session, place and close a trade, then confirm the Trade Log, Dashboard, Statistics, and
Review Engine pages for the real active challenge show no change at all from before the
backtest trade existed.

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

**Phase 1b additions:**

- `backtest_sessions` has no distinct `'paused'` status — "a session can be paused and
  resumed" is satisfied by `replay_cursor_ms` alone being persisted after every
  advance/order; leaving the page is the pause, reopening the session is the resume,
  with nothing server-side that needs to distinguish "being played right now" from
  "sitting idle mid-way." `status` is `active`/`passed`/`failed`.
- A pending limit order gets its own table (`backtest_pending_orders`), not a row in
  `trades` — an order that hasn't filled yet has no execution facts at all
  (`entry_price`, `time_in`, etc. would all be meaningless), and `trades`' many existing
  readers already assume a row means a real, already-known execution — matching the
  same division-of-responsibility principle `BitfundedImportController` already
  established for pre-entry vs. execution fields.
- Drawdown rules are checked against total equity (closed + floating), not just closed
  P&L — a real funded account is liquidated on unrealized loss too, not only when a
  position is manually closed. Not explicitly stated in the briefing either way; chosen
  as the more realistic simulation.
- "Jump to latest" is capped at `BacktestController::MAX_JUMP_BARS` (2000) bars per
  request and the client re-calls automatically if more remain — keeps one request
  bounded on a 2 vCPU/4GB box regardless of how far behind "now" a session's cursor has
  fallen, rather than trying to simulate an unbounded number of bars synchronously in
  one PHP request.
- "Fully custom" challenge rules (per the briefing) means `backtest_sessions` stores its
  own copy of every rule at creation time — never a foreign key to `challenges`. The
  setup form's prefill dropdown only ever copies numbers into the same editable inputs;
  nothing links a session back to the challenge it was prefilled from, so editing that
  challenge later can never retroactively change an already-running or already-graded
  session.
