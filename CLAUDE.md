# CLAUDE.md — FundedControl Project Context
## Complete Reference for Claude Code (AI Development Assistant)

**Product:** FundedControl (formerly FSA Trading Journal)
**Developer:** Acrob — Solo developer, crypto trader, Kigali, Rwanda
**Experience:** 10 years PHP
**Last Updated:** 2026-10-12 (v3.26.1 — double-click on the replay chart no longer re-fits during an active session)

> **Per-release history lives in `docs/CHANGELOG-archive.md`**, not here. Every dated
> "what changed and why" writeup (v3.9.x through v3.22.10, plus some retired reference
> material) was moved there verbatim on 2026-10-03 to keep this file under 600 lines.
> This file only documents **current state** — what's true right now, not how it got
> that way. If you need the story behind a design decision, check the archive first.

## 1. PROJECT OVERVIEW

### What Is FundedControl?

A professional trading journal SaaS for **prop firm traders** — trade logging, challenge
progress tracking, risk-limit enforcement, and performance review in one disciplined tool.

**Core problem it solves:** prop firm traders fail challenges because they have no
structured accountability system. FundedControl gives them real-time risk alerts, rule
enforcement, and performance analytics designed around prop firm rules.

### Live Details

| Field | Value |
|-------|-------|
| Live URL | https://www.fundedcontrol.com/ |
| Updater | https://www.fundedcontrol.com/updater.php |
| GitHub Repo | https://github.com/frisoftltd/fsa-journal-updates (the old `acrobcrypto250` name is stale in `updater.php` and the git remote URL, but GitHub redirects it, so it still works) |
| DB Name | `fundedcontrol` — MySQL 8.4 on the Hetzner VPS in §1A below |
| Current Version | v3.26.1 (repo/tag version — not confirmed to match `updater.php`'s own `local_version` on live; see "Deploy & Release Workflow" below for why that gap can happen) |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | PHP 8.1 |
| Database | MySQL 8.4 (PDO, prepared statements) |
| Frontend | Vanilla JS + Chart.js + TradingView Lightweight Charts (backtesting chart) |
| Hosting | Hetzner VPS, CloudPanel, nginx + PHP-FPM — see §1A |
| No frameworks | No Laravel, no React, no Composer |

### §1A. Server Environment

| Field | Value |
|-------|-------|
| Provider | Hetzner CX23 VPS, Helsinki |
| OS | Ubuntu 24.04 |
| IP | 77.42.125.97 |
| Panel | CloudPanel |
| Web server | nginx + PHP-FPM |
| Site root | `/home/fundedcontrol/htdocs/fundedcontrol.com` |
| Site user | `fundedcontrol` |
| Database | **MySQL 8.4** (real MySQL, not MariaDB) — db `fundedcontrol`, user `fundedcontrol`, host `127.0.0.1:3306` |

**MySQL, not MariaDB, matters for every migration you write** — MariaDB-only conditional
DDL (`ADD COLUMN IF NOT EXISTS` and friends) errors outright on MySQL. See §3A below.

### Backtesting Pipeline

`app/cli/{backfill,update,verify,repair}.php` pull OHLCV candles from Bybit v5
`/v5/market/kline` into `symbols`/`candles`/`candle_sync` via `includes/bybit_client.php`.
CLI-only (`backtestRequireCli()` 403s any non-CLI SAPI; nginx also denies `/cli/`
outright). `cli/update.php` runs every 15 minutes via a CloudPanel Cron Job, logging to
`/home/fundedcontrol/htdocs/backtesting-logs/` (a sibling of this site's own document
root, so a direct request 404s). `ChartController.php` reads candles only from MySQL —
nothing in a page request calls Bybit directly. Full runbook:
`app/docs/backtesting-pipeline.md` (deployed on purpose, unlike every other repo-root
`docs/` file).

### Backtesting Replay Engine

Sidebar module **"Backtesting"** (`pages/backtest.php`/`js/backtest.js`) — session-based
replay, not plain browsing. Reuses `js/chart.js`'s candlestick/volume rendering.
`backtest_sessions` (fully custom challenge rules per session, never FK'd to
`challenges`), `backtest_pending_orders` (resting limit orders), `trades.source='backtest'`
+ `backtest_session_id`. A backtest trade's `challenge_id` is always `NULL`, so
`source != 'backtest'` is added explicitly everywhere the usual
`(challenge_id=? OR challenge_id IS NULL)` scoping pattern appears.

Equity/peak-equity are **always derived live from `trades`**
(`BacktestController::computeSessionState()`), never stored — same "derive, don't store"
rule as `challenges.current_balance` (dropped for the same reason, see archive v3.13.0).
`BacktestController::getCandles()` clamps every response to `replay_cursor_ms`
server-side — the browser is never trusted to hide future candles on its own. Pure
fill/P&L/drawdown math lives in `includes/backtest_engine.php`, self-tested via
`php includes/backtest_engine.php`.

The backtesting UI (order ticket, drawing tools, live trade display, price-axis
auto-scale) has gone through many fix releases — see the archive's v3.21.x–v3.22.10
entries for the full story if something there looks surprising. Drawing tools: 7 total —
`position_long`/`position_short`/`fib_retracement`/`trend_line`/`horizontal_line`/
`horizontal_ray`/`rectangle` (`BacktestDrawingController::TOOLS`), each rendered/hit-tested/
dragged in `js/backtest-drawings.js` on one shared `<canvas id="bt-draw-overlay">`.

**Risk ladder (v3.22.10).** When `use_flat_risk=0`, orders size from `sessionSummary()`'s
`ladder_risk_pct` — `backtestLadderTier()` (`backtest_engine.php`) against **start-of-day
equity** (closed equity at the current UTC day's first bar, floating P&L excluded), not
the instant's equity — a same-day loss can't flip the tier until the NEXT replay day. A
limit order's tier is fixed at placement via `ladderInfoAsOf()`, re-derived from
closed-trade history as of `placed_at_bar_time` rather than a new stored column. Never
blocks off-ladder — only records `trades.planned_risk_pct`/`actual_risk_pct`/
`balance_at_day_start`/`risk_deviation_pct` (reused v3.15/v3.16 columns).

**Gate checklist (v3.23.0).** `backtest_sessions.strategy_id` (nullable FK to
`strategies`, `ON DELETE SET NULL`) is optional — a session created without one behaves
exactly as every pre-v3.23.0 session does. When set and that strategy has active
`role='gate'` `strategy_variables`, `sessionSummary()` carries them as `gate_variables`
(`BacktestController::getActiveGateVariables()`, the same `role='gate' AND is_active=1`
filter the live journal's own `openChecklist()` uses client-side, moved server-side) and
the order ticket shows a pre-order checklist before submitting
(`js/backtest.js::btOpenChecklist()`/`btChecklistProceed()`, mirroring
`trades.js::openChecklist()`'s own checked/total score and override-confirm UX). The
trader's aggregate answer is recorded as `gates_passed` (TINYINT(1): 1 = every gate
checked, 0 = overridden, NULL = no checklist applicable) on `backtest_pending_orders` for
a limit order and carried to the `trades` row on fill, same carry-through convention as
`planned_risk_pct`. Never blocks a trade — this was the plumbing v3.24.0's own gate-1
structure indicator builds on.

**FSA Gate 1 structure indicator (v3.24.0).** `app/js/structure-gate1.js` — exact port of
`app/docs/reference/FSA_Structure_Gate1.pine` v4.2 (ATR(14) Wilder RMA, hidden zigzag,
swing labeling, the BOS/CHoCH `st`/`pendRef` state machine). Pure, incremental, no DOM:
`createGate1Engine({atrLen,atrMult}).push({t,o,h,l,c})` (t = UTC seconds) consumes exactly
one already-closed 4H candle per call — there is no "recompute over the full array" path,
so lookahead is impossible by construction. The feed (`js/backtest.js`,
`btRebuildGate1FromScratch()`/`btAdvanceGate1IfNeeded()`) reuses the existing
`get_backtest_candles` endpoint at `timeframe=4H` with `before` set to the start of the
4H bucket containing the replay cursor — this alone skips `getCandles()`'s own
still-forming-bar synthesis (`backtestAggregateCandles()`), so every candle the engine
ever sees is already real and closed; no new endpoint, no custom aggregation. 500-candle
warm-up on every session open/resume; a rewind does `reset()` then replays from the
warm-up start through the new cursor — it never patches swings/events in place. Rendered
on the existing `#bt-draw-overlay` canvas (`js/backtest-drawings.js::
btRenderGate1Overlay()`, reusing `btTimeToX`/`btPriceToY`) plus a real DOM badge
(`#bt-gate1-badge`) with the exact Pine badge text; toggleable (default on) from the draw
toolbar — the toggle only ever hides/shows rendering, the engine and order recording keep
running regardless. `gate1_auto_state` (the engine's `state`, -2..2) is sent on **every**
order unconditionally; `gate1_agree` (1/0) only when the v3.23.0 checklist actually opens
— it gets one extra, always-present "Gate 1 (Structure)" row pre-checked per state+
direction, which the trader can override, same non-enforcing `gates_passed` pattern.
Mandatory parity tests (`app/tests/gate1_parity.js`, fixtures in
`app/tests/fixtures/gate1/`) pass exactly against all 4 real Pine-exported fixtures
(BTC/LINK/LIT/PUMPFUN) as of v3.24.1 — a real tie-breaking bug in `hiSince`/`loSince`
(forward-scan-from-range-start instead of Pine's actual backward-scan-from-the-confirming-
candle) was caught and fixed by LINKUSDT's own fixture. Still outstanding: a live BTC 4H
side-by-side against the real TradingView chart (no browser access from this
environment).

**FSA Gate 1 settings dialog (v3.25.0).** Gear icon next to the toolbar toggle, or
double-click the badge — `js/backtest.js::btOpenGate1Settings()`, 3 tabs mirroring
`FSA_Structure_Gate1.pine`'s own inputs block (`docs/reference/...`, lines 14-21):
Inputs (swing size × ATR 14, 0.5–10 in 0.5 steps; show swings/breaks/levels/badge), Style
(bullish/bearish/unclear colour, label size), Visibility (which `Viewing` timeframe the
overlay draws on — the engine always runs on 4H regardless; the badge is never
timeframe-gated). `gate1Settings` is loaded once per session open
(`loadGate1Settings()`); only an `atrMult` change triggers a real rebuild
(`btRebuildGate1FromScratch()` — `createGate1Engine()`'s `atrMult` is fixed at
construction, so this always builds a fresh engine instance rather than calling the old
one's `reset()`), every other field just re-renders/redraws. Persisted server-side,
per-user, via a new table (`user_indicator_settings`, not `user_drawing_defaults` — see
that migration's own doc comment for why) and `Gate1SettingsController`
(`get_gate1_settings`/`save_gate1_settings`), which validates every field strictly and
refuses anything unrecognised — a saved default becomes every future session's starting
point. `structure-gate1.js` gained two read-only snapshot fields,
`protectedLevelBar`/`bosLevelBar` (bookkeeping only, no engine rule changed — mirrors
Pine's own continuously-replotted "protected level"/"BOS level" lines, lines 205-206, not
previously rendered at all before this release). New column `gate1_atr_mult`
(`trades`/`backtest_pending_orders`) carries the swing size through to a limit order's
fill exactly like `gate1_auto_state`/`gate1_agree` already do; existing rows stay `NULL`
(they were all run at the old hardcoded 2.0, but this is **not** backfilled) — the
Results/Saved-Backtests gate-1 agreement breakdown is grouped by `gate1_atr_mult` (a
`NULL` row groups under its own `'unset'`/"legacy" bucket) so a session with orders at
more than one swing size never reports one combined number blending them. Not yet
verified from this environment: the exact badge text at 3.0 vs 2.0 against a real BTC 4H
replay side-by-side with the real TradingView indicator (same standing limitation as
v3.24.0/v3.24.1), and a real browser login/logout settings-persistence round trip — the
harness's own proof (`drive-v3250.mjs`) is a full page reload against the mock, which
exercises the same server-round-trip mechanism but isn't a real login.

**Fixed-spacing replay chart + auto-follow (v3.26.0).** Fixes candle spacing changing
mid-replay. Root cause wasn't drift during a plain, hands-off Play/Next Bar (a direct
30-bar probe against the pre-fix code showed bar spacing already numerically stable
there) — it was that the per-step `setVisibleLogicalRange()` call (`btSetVisibleRange()`,
removed this release) had no notion of the trader having manually zoomed/panned, so the
very next step yanked the view straight back to the fixed window, which is what actually
reads as "stretching." `btApplyFixedTimeScaleOnce()` now sets `barSpacing`/`rightOffset`
as real `timeScale` options exactly once, on session open/resume/rewind/display-timeframe
switch (`btLoadCandleWindow()`'s new `resetView` param — `false`, the default, on a plain
`btAdvance()`); every step after that only ever calls `btScrollToLive()`
(`scrollToPosition(BT_RIGHT_MARGIN_BARS, …)` — confirmed directly against this exact
Lightweight Charts build that a POSITIVE value is "margin to the right of the latest bar"
and that `scrollPosition()`'s own zero is flush against the edge, NOT already offset by
`rightOffset`), and only while `btAutoFollow` is true. Panning/zooming the chart by hand
sets `btAutoFollow = false` (`btOnVisibleRangeChange()`, subscribed once — comparing
`scrollPosition()`/`barSpacing` against their own just-applied targets, same inference
technique `btMaybeNudgeAutoScale()` already established for the price axis); a step while
paused leaves the view untouched. The reintroduced "Jump to Latest" button
(`pages/backtest.php`, removed in v3.20.11 on since-invalidated reasoning) resumes it —
deliberately an instant `scrollToPosition(…, false)`, not animated: an animated scroll
fires the same range-change event on every in-between frame, each of which would
otherwise read as "not at the live edge" and re-pause auto-follow mid-animation, fighting
the button that's supposed to resume it. Also fixed in the same release: a resize-
ordering bug where `resizeTvChart()` ran AFTER the first fixed-spacing computation on
session open (so that computation could read a stale/transitional container width, then
the canvas resized afterward without re-fitting); a `toggleBtAutoplay()` race where two
overlapping `btAdvance()` calls under real latency could render an earlier window after a
later one; and `chart.js`'s own plain-browsing `loadOlderCandles()` pagination no longer
fires during an active backtest session, where it isn't replay-aware and could grow/
corrupt the fixed lead-in window. Investigated and confirmed already correct, no change
needed: drawing anchors (`{time, price}`, converted to pixels fresh every render via
`btTimeToX()`/`btPriceToY()`, never pixels, never clamped off-screen); future candles are
never in the dataset (`BacktestController::getCandles()`'s own `replay_cursor_ms` clamp);
the price axis's `autoscaleInfoProvider` already derives its natural range from
Lightweight Charts' own visible-bars computation. Not yet verified from this environment:
a real mouse-driven pan/zoom in an actual browser (the dev-time probes drove the
Lightweight Charts API directly, not real pointer events) and the full acceptance
scenario (BTCUSDT 1H at Apr 08 18:00, Play at 1x for 30 bars) against live data.

**Double-click re-fit fix (v3.26.1).** A real-browser Playwright re-verification of
v3.26.0 found a second trigger for the same "chart stretches" symptom that release's own
audit missed: `js/chart.js`'s `initTvChart()` wires `container.addEventListener('dblclick',
…)` unconditionally on `#tv-chart`, calling `fitContent()` — reachable during an active
backtest session (the container is shared), and never gated the way the file's
`subscribeVisibleLogicalRangeChange` handler already was. Fixed: the handler now checks
the same `window.btFetchCandlesOverride` signal and calls `btJumpToLatest()` instead
during an active session — restores the fixed bar spacing, resumes auto-follow, scrolls
to the live edge, never fits. Falls through to the original `fitContent()` otherwise.
Full audit of every other `fitContent()`/`setVisibleLogicalRange()`/`setVisibleRange()`
call site in `chart.js` (per the briefing): all of them — `loadInitialWindow()`'s own
`fitContent()`, `resetChartZoom()`, `onChartTimeframeChange()`'s `setVisibleRange()`
fallback, `onChartTimezoneChange()`'s `fitContent()` — belong to this file's own
standalone "Chart" page, which has had **zero** route/button/element wiring to reach it
since the v3.20.0 Chart→Backtesting rename (confirmed by tracing every caller, not
assumed — `resetChartZoom()` specifically has zero callers anywhere in the repo). No
change needed there. Verified via new `tools/ui-harness/drive-v3261.mjs` (real mouse
events): double-click on empty chart area is a no-op on spacing; double-click after a
manual pan acts exactly like Jump to Latest; double-click on an existing drawing still
opens its settings popover (pre-existing `btOnDrawDblClick()` `stopPropagation()`
precedence, untouched). The next, separate piece of the original briefing — letting the
trader scroll back through real history during replay without a tick discarding what's
already loaded — is deliberately **not** part of this release; see that section's own
notes once it ships.

## 2. ARCHITECTURE — MODULAR BACKEND

### The Core Principle

Every feature is an **independent PHP controller class**. The router maps API actions to
controller methods. Adding a feature = creating a new file + one line in `router.php`.
Zero edits to existing files.

### Request Flow

```
Browser (JS api() call)
    ↓
includes/api.php        ← 14-line thin wrapper
    ↓
includes/config.php     ← DB connection (NEVER in GitHub)
includes/helpers.php    ← Shared utility functions
    ↓ CSRF check + requireLogin()
includes/router.php     ← Maps action → [Controller, method]
    ↓
includes/controllers/   ← Independent controller class
    ↓
JSON Response → Browser
```

### File Structure

```
fundedcontrol.com/
├── index.php                    ← App shell: sidebar + page router
├── login.php / register.php / logout.php
├── updater.php                  ← GitHub auto-updater (DO NOT MODIFY)
├── version.json                 ← Version tracking
├── migrate.php                  ← Migration runner (§3A)
├── report_card_cron.php         ← Token-protected cron entry point
│
├── includes/
│   ├── config.php                ← ⛔ DB CREDENTIALS — NEVER IN GITHUB
│   ├── api.php                   ← Thin API entry (14 lines max)
│   ├── helpers.php                ← Shared functions
│   ├── router.php                 ← Action → controller routing
│   ├── emotion_states.php         ← Emotional state taxonomy (9 codes)
│   ├── journal_taxonomy.php       ← Trade journal action/exit-type codes
│   ├── bitfunded_parser.php       ← Bitfunded paste-import parsing (self-tested)
│   ├── bybit_client.php           ← Bybit kline client (self-tested)
│   ├── backtest_engine.php        ← Pure fill/P&L/drawdown math (self-tested)
│   └── controllers/               ← One class per feature domain
│
├── pages/        ← HTML only, no logic
├── modals/       ← Modal HTML only
├── js/           ← One file per page, plain global <script> tags (see "Current
│                   Conventions" below — a single shared global scope, not modules)
├── css/          ← style.css (layout, variables, components)
├── cli/          ← Bybit backfill/update/verify/repair, CLI-only
├── migrations/   ← Tracked SQL migrations (§3A)
├── media/uploads/{user_id}/
└── backups/      ← Auto-created by updater
```

Current controllers include `ProfileController`, `ChallengeController`,
`TradeController`, `StatsController`, `AlertController`, `CalculatorController`,
`PairController`, `ImportController`, `StrategyController`, `StrategyBuilderController`,
`ReviewController`, `ReviewEngineController`, `BitfundedImportController`,
`ReportCardController`, `ReportCardAiController`, `BacktestController`,
`BacktestDrawingController`, `Gate1SettingsController`, `ChartController`,
`OnboardingController`.

## 3. DATABASE SCHEMA (current)

Full column-by-column rationale (why each column exists, NULL-vs-zero conventions, every
backfill formula) lives in `docs/CHANGELOG-archive.md` — this is the structural reference
only. **When in doubt about what a `NULL` vs `0` vs an empty string means on a specific
column, check the archive before guessing** — this schema has a strong "NULL means never
recorded, 0 means measured and genuinely zero" convention that's been hard-won across
several incidents.

```sql
users: id, username, password, display_name, avatar_color, bio, email, email_verified,
  verification_token, created_at, onboarding_completed
  -- account_balance/starting_balance/max_drawdown_pct/daily_loss_limit/risk_per_trade_pct/
  -- prop_firm/challenge_phase are legacy; new data uses `challenges`.

challenges: id, user_id, name, prop_firm, challenge_phase, starting_balance,
  max_drawdown_pct, daily_loss_limit, risk_per_trade_pct, profit_target_pct,
  status, is_active, created_at, default_strategy_id, funding_adjustment,
  profit_target_amt, max_loss_amt, drawdown_type ('static'|'trailing'), default_leverage
  -- NO current_balance column — always derive via helpers.php::enrichChallenge():
  -- starting_balance + SUM(net_pnl closed trades) - funding_adjustment.
  -- profit_target_amt/max_loss_amt (currency) override the _pct columns when set.

trades: id, user_id, challenge_id, trade_date, session, time_in, time_out, pair,
  direction, entry_price, stop_loss, take_profit, exit_price, lot_size, risk_amount,
  fees, pnl, net_pnl, r_multiple, result, confidence, exec_score, fib_level, fsa_rules,
  notes, screenshot, screenshots (JSON, up to 4), strategy_id, emotion_tag, setup_grade,
  note_saw, note_why, note_unsure (legacy, superseded by trade_journal), source
  ('manual'|'import'), r_multiple_source ('recorded'|'estimated'), exit_reason,
  balance_at_entry, planned_risk_pct, actual_risk_pct, risk_deviation_pct, clean_rep,
  balance_at_day_start, target_r, exit_quality, planned_margin, funding, leverage
  -- entry_price/exit_price/stop_loss/take_profit are DECIMAL(20,10) (range 0.0044–71,968).
  -- net_pnl = pnl - fees - COALESCE(funding, 0).
  -- source/exit_reason/fees/funding are importer-only — TradeController::saveTrade()
  -- never sets them (division of responsibility: pre-entry fields come from the trade
  -- form, execution fields come from BitfundedImportController/backtest fills). The one
  -- exception is entry_price, readded to the manual form in v3.17.3 so the import
  -- matcher can find an open manually-logged row at all.

pairs: id, user_id, symbol, active
risk_ladder_tiers: id, challenge_id, lower_balance, upper_balance (NULL = "and above"),
  risk_pct, active, created_at — lookup is lower-inclusive, upper-exclusive.
challenge_limits: id, challenge_id, max_trades_day, max_trades_week, max_losses_day,
  daily_loss_usd, created_at — one row per challenge (UNIQUE), every column independently
  nullable ("not tracked", never a zero meaning "no trades allowed").
strategy_tests: legacy sandbox, separate from the Strategy Lab below. Do not merge.
strategies: id, user_id, name, is_active, created_at
strategy_variables: id, strategy_id, label, input_type (checkbox/scale/select/text),
  options, role ('gate'|'tag'), timeframe, criteria, sort_order, is_active, created_at
trade_variables: id, trade_id, variable_id, value — FK CASCADE from trades, FK RESTRICT
  to strategy_variables (deactivate, don't delete, a variable with existing answers).
trade_journal: id, trade_id, phase ('pre_entry'|'post_close'), emotion_code, note,
  exit_type, good_process, created_at, updated_at — UNIQUE (trade_id, phase). `during` is
  NOT written here anymore (see trade_checkins).
trade_journal_actions: id, journal_id, action_code — historical only, see trade_checkins.
trade_checkins: id, trade_id, checked_at (DATETIME(3)), emotion_code, tempted_text —
  APPEND-ONLY log of "During Open Position" check-ins, no UNIQUE on trade_id (that's the
  whole point — trade_journal's UNIQUE(trade_id,phase) silently overwrote prior During
  check-ins, which is why this is a separate table).
trade_checkin_actions: id, checkin_id, action_code — UNIQUE (checkin_id, action_code).
ai_reviews: id, user_id, challenge_id, period_type, period_start, period_end,
  insights_json, metrics_json, created_at
weekly_reviews: legacy manual review, superseded by ai_reviews for new usage.
daily_limits: user_id, log_date, daily_pnl, trades_count
schema_migrations: id, filename, checksum, applied_at, execution_ms, status, error_message
report_cards / report_card_blocks / report_card_templates / report_card_template_blocks /
  report_card_mantras / report_card_mantra_checks / report_card_tickers /
  report_card_ticker_images / report_card_ai_reviews / report_card_ai_findings —
  full column lists + the AI review payload/tool schema are in the archive (v3.18.0).
backtest_sessions / backtest_pending_orders / backtest_drawings / user_drawing_defaults /
  backtest_exit_time_repairs_log — see the Backtesting Replay Engine section above and
  the archive's v3.19.0–v3.22.10 entries for full column lists and design history.
user_indicator_settings: id, user_id, indicator, settings_json, updated_at —
  UNIQUE(user_id, indicator); FSA Gate 1's own Inputs/Style/Visibility dialog (v3.25.0)
  is the only indicator so far — see the Backtesting Replay Engine section above.
```

### Data Relationships

```
users (1) ──→ (many) challenges
challenges (1) ──→ (many) trades
challenges (many) ──→ (1) strategies              [default_strategy_id]
trades (many) ──→ (1) strategies                  [strategy_id]
strategies (1) ──→ (many) strategy_variables
strategy_variables (1) ──→ (many) trade_variables  [FK RESTRICT]
trades (1) ──→ (many) trade_variables / trade_checkins  [FK CASCADE]
trade_checkins (1) ──→ (many) trade_checkin_actions     [FK CASCADE]
users (1) ──→ (many) pairs / strategy_tests / weekly_reviews / ai_reviews
challenges (1) ──→ (many) risk_ladder_tiers; (1) challenge_limits
```

### Current Conventions (standing rules — always apply these)

- **Challenge Scoping Rule:** all trade queries need
  `WHERE user_id = ? AND (challenge_id = ? OR challenge_id IS NULL)`. Every
  dashboard/stats number is scoped to the *active* challenge, not the user's whole
  history — go through `StatsController::getStats()` for any new stats card so it
  inherits scoping + the "which challenge" caption automatically.
- **Closed-Trades-Only Rule:** any `r_multiple` or win-rate calculation excludes
  `Open` trades — filter `result IN ('Win','Loss','Break Even')`.
- **Emotional State Taxonomy:** `trades.emotion_tag` stores one of 9 codes (`settled`,
  `impatient`, `hesitant`, `chasing`, `hoping`, `wanting_out`, `greedy`, `invincible`,
  `vengeful`) from `includes/emotion_states.php::emotionStates()` — the single source of
  truth for codes/labels/descriptions. **Codes are permanent, labels are not** — never
  change a code once shipped. Legacy 8-state values are never rewritten; render them via
  `emotionLabel()`'s "(legacy)" fallback.
- **Three-Phase Trade Journal:** `pre_entry` (emotion, setup grade, "what would have to
  happen for me to be wrong?"), `during` (optional, goes to `trade_checkins` — its
  absence is itself data, no "skipped" marker), `post_close` (exit type, emotion,
  good-process). Codes (not labels) stored throughout, from
  `includes/journal_taxonomy.php` for journal-specific fields.
- **Execution data is importer-only.** `TradeController::saveTrade()` never sets
  `pnl`/`fees`/`time_in`/`time_out`/`exit_reason`/`r_multiple`/`risk_amount` —
  those come from `BitfundedImportController`/backtest fills only. The trade form
  captures pre-entry intent (strategy, stop/target, psychology); the importer captures
  what actually happened. `entry_price` is the one exception (v3.17.3).
- **`net_pnl`, never `pnl`, for any performance figure** (expectancy, win rate, profit
  factor) — `pnl` excludes fees/funding and overstates the edge.

## 3A. DATABASE MIGRATIONS

Migration files live in `app/migrations/`, plain `.sql`, one logical change per file.
`migrate.php` scans that directory, compares against a `schema_migrations` tracking
table it creates itself, and applies whatever is pending, in filename order. Every
applied/baselined file has its sha256 checksum recorded — editing an already-applied
file is detected and blocks the runner rather than silently re-running. **DDL commits
implicitly on both MySQL and MariaDB — there is no rollback.** Keep migrations small.

### Naming

`migrations/YYYY_MM_DD_NNNN_short_description.sql` — the filename is the sort order,
sequence number zero-padded and unique for that date.

### Adding a migration

1. Write the `.sql` file — plain SQL, statements separated by `;`, no PHP.
2. **Every `CREATE TABLE` must specify `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=
   utf8mb4_general_ci` explicitly.** Without it, a new table silently falls back to
   `latin1_swedish_ci` and mangles non-Latin1 text. Check this before every `CREATE
   TABLE`, not after (this exact mistake has shipped once already — see archive v3.11.1).
3. **Never write `ADD COLUMN IF NOT EXISTS`, `DROP COLUMN IF EXISTS`, `ADD INDEX IF NOT
   EXISTS`, or `DROP INDEX IF EXISTS`** — MariaDB-only, MySQL 8.4 rejects all of them
   with `ERROR 1064`. `CREATE TABLE IF NOT EXISTS` is fine (standard SQL). For a
   conditional `ALTER TABLE`, query `information_schema.COLUMNS` (`.STATISTICS` for an
   index, `.TABLE_CONSTRAINTS` for a constraint) for existence, then build and run the
   `ALTER` via `PREPARE`/`EXECUTE` only when missing — see any `2026_09_3*`/`2026_09_2*`
   guarded-ALTER migration for the working pattern.
4. Add its path to `version.json`'s `"files"` array
   (`{"path": "migrations/...sql", "critical": false}`) — if it's not in the manifest,
   `updater.php` never deploys it.
5. Bump `current_version`, commit, push, tag, release (see Deploy & Release Workflow
   below).
6. **Export the database before running `?mode=run` on live** — DDL can't be rolled back.
7. Deploy via the normal updater workflow, then hit `migrate.php?mode=run&token=...`.

### Running it

Token-protected via a constant in `includes/config.php` (never in this repo):
- `migrate.php?mode=status&token=...` — lists applied/pending, changes nothing (default).
- `migrate.php?mode=run&token=...` — applies pending, stops at the first failure.
- `migrate.php?mode=baseline&token=...` — records pending as applied **without running
  them** — only ever correct for a migration describing schema that already exists.
  Missing or wrong token → 403, logged via `error_log()`.

### Known operational traps (see archive for the full incidents)

- A `status='failed'` migration is retryable/editable by design — `migrate.php` sends it
  straight back to pending with no checksum check. An `applied`/`baselined` migration is
  checksum-locked. Know which state you're in before deciding whether editing a file is
  safe.
- A pre-flight guard in a retryable migration must accept **every** state the file can
  legitimately leave things in, not just "hasn't run yet" — a guard that only passes
  once will eventually block a real retry. This has recurred multiple times; write
  identity/integrity checks, not progress checks.
- `migrate.php`'s own DB connection needs `PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => true`
  (confirmed set in `config.php` as of v3.21.11) and every per-statement loop should use
  `$db->query()` + `closeCursor()`, never bare `$db->exec()` — an `EXECUTE` of a
  `SELECT`-shaped prepared statement (the guarded-ALTER no-op branch) can return a real
  resultset and leave the connection unable to run the next native prepared statement.
- A bulk-import/dedup migration needs `(pair, direction)` + a time window **and**
  `entry_price` **and** `pnl` matching before treating two rows as the same execution —
  time proximity alone produces false positives on normal fast re-entries.

## 4. API ENDPOINTS REFERENCE

JS calls the API via `api(action, method, data)` → `includes/api.php?action=...`
(GET params appended to the action string, e.g. `api('get_trades&pair=BTCUSDT')`).
File uploads go through `fetch()` directly with `FormData`.

| Domain | Key actions |
|--------|-------------|
| Profile | `get_user`, `update_profile`, `update_settings` |
| Challenges | `get_challenges`, `get_active_challenge`, `add_challenge`, `update_challenge`, `delete_challenge`, `switch_challenge` |
| Trades | `get_trades`, `add_trade`, `update_trade`, `delete_trade` |
| Stats / Alerts | `get_stats`, `get_alerts` |
| Calculator | `calculate_risk` (legacy, unused by current UI), `size_preview`, `auto_risk_preview`, `get_risk_status` |
| Pairs | `get_pairs`, `add_pair`, `delete_pair` |
| Import | `import_trades` (Excel, max 500), Bitfunded paste import via `BitfundedImportController` |
| Strategy | `get_strategy_trades`, `get_strategy_stats`, `add_strategy_trade`, `delete_strategy_trade` |
| Reviews | `get_reviews`, `save_review` (legacy); `ReviewEngineController` for the generated insights feed |
| Report Card | `get_report_card`, `save_report_card`, `get_report_card_history`, block/template/mantra/ticker CRUD, `run_ai_review`, `run_weekly_ai_review`, `get_ai_reviews`, `acknowledge_ai_finding` |
| Backtesting | `get_backtest_session`, `get_backtest_results` (metrics/trade-list for the Results page), `get_backtest_candles`, `backtest_advance`, `backtest_rewind`, `backtest_place_order`, `backtest_cancel_order`, `backtest_close_position`, drawing CRUD via `BacktestDrawingController`, `get_gate1_settings`/`save_gate1_settings` via `Gate1SettingsController` |

Full per-action method/controller/description table is in the archive if you need it —
this condensed version is enough to know which controller owns a given feature.

## 5. HELPER FUNCTIONS REFERENCE

### helpers.php
`csrfCheck()`, `num($val, $default)`, `validId($val)`, `safeMediaDir($uid)`,
`handleScreenshot($uid)`, `getActiveChallenge()`, `jsonInput()`, `jsonResponse($data)`,
`jsonError($msg)`, `enrichChallenge()`/`enrichChallenges()`, `computeTradeRiskFields()`,
`ladderTierForBalance()`, `tradeLimitStatus()`, `appTodayKigali()`, `staticDrawdownPct()`,
`failureBalance()`, `weekBounds()`.

### config.php (already exists, never edit)
`getDB()` (PDO connection), `uid()` (current user id from session), `currentUser()`
(full user row), `requireLogin()` (redirect if not authenticated).

## 6. HOW TO ADD A NEW FEATURE

Three steps, zero edits to existing files:

1. **Create controller** (`includes/controllers/FeatureController.php`) —
   `$db = getDB(); $uid = uid();` in the constructor, one public method per action,
   `jsonResponse([...])` to respond.
2. **Add one line to `router.php`**: `'action_name' => ['FeatureController', 'method'],`
3. **Call from JS**: `const data = await api('action_name');`

## 7. SECURITY RULES

| Feature | Implementation |
|---------|---------------|
| CSRF Protection | Origin/Referer validation via `csrfCheck()` |
| Input Validation | All numeric fields through `num()` |
| ID Validation | All IDs through `validId()` |
| Passwords | `password_hash()` + `password_verify()` |
| SQL Injection | Prepared statements with `?` everywhere |
| User Isolation | Every query includes `WHERE user_id=?` |
| File Uploads | 5MB limit, extension whitelist, MIME verification |
| Secure Filenames | `bin2hex(random_bytes(16))` |
| Import Limits | Max 500 trades per batch |
| Error Sanitization | No raw user input in error messages |
| Directory Traversal | `basename()` on all file paths |

## 8. BRAND & UI CONVENTIONS

Brand lives entirely in CSS variables (`css/style.css`) — **never hardcode a color**.

```css
--fc-bg:#FAFBFC; --fc-card:#FFFFFF; --fc-border:#E2E8F0; --fc-sidebar:#0B1D3A;
--fc-primary:#1A56DB; --fc-success:#0FA958; --fc-danger:#DC3545; --fc-warning:#F59E0B;
--fc-text:#0B1D3A; --fc-muted:#6C7A8D;
```

Off-white background, white cards, the sidebar is the **only** dark element. Green only
for profit/wins, red only for loss/danger — never decorative. Full type-scale detail
(font sizes, weights, letter-spacing per element) is in the archive if you're building a
new UI component from scratch; for everyday work just match whatever's already on the
page you're editing.

**Test viewport for any sidebar/layout change: 1366×590 minimum** (a real laptop's usable
height with browser chrome, not a bare 768px/600px headless screenshot — that only
exercises the mobile drawer branch, not the desktop-width-short-height one, and a real
regression shipped once from testing only the former). Also check 1366×768, 1920×1080,
375×600, and just above/below the 900px mobile-drawer breakpoint for anything that
touches that layout.

## 9. KNOWN ISSUES (current, unresolved)

1. **`MEDIA_BASE_DIR` constant bug** (`config.php`, not in this repo): defined using a
   bare `DIR` instead of `__DIR__`. Fix (apply by hand in CloudPanel, since `config.php`
   is never in GitHub): `define('MEDIA_BASE_DIR', __DIR__ . '/../media/uploads/');`
2. **`CalculatorController::calculate()`** (the `calculate_risk` action) is reachable by
   direct API call but nothing in the current UI exercises it — `sizePreview()` and
   `autoRiskPreview()` are separate, newer computations, not built on top of it. Don't
   assume manual testing of the Risk Calculator page exercises `calculate()`.

## 10. DEBUGGING GUIDE

**Backend error:** F12 → Network tab → find the failing API call → check Response. The
error names which controller to open (27–150 lines each).
**Frontend error:** F12 → Console tab → red error shows function name + file. Hard
refresh first (`Ctrl+Shift+R`) — a stale cached JS file is the single most common cause.

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Loading..." in sidebar | No challenges in DB | Create one via Challenges page |
| Function not defined | Browser cache | Hard refresh Ctrl+Shift+R |
| 500 error on API | PHP syntax error | Check cPanel/CloudPanel error log |
| Screenshots not saving | Permission issue | Set `media/uploads/` to 755 |
| "Unknown action" | Route not in router.php | Add route line |

## 11. DEVELOPMENT RULES (ABSOLUTE)

1. **Always give complete files** — never partial code snippets.
2. **Always bump version number** with every update.
3. **Always use the GitHub updater workflow** — never manual file replacement.
4. **`config.php` is NEVER in GitHub** — ever, under any circumstances.
5. **Never put logic in `api.php`** — it's a 14-line wrapper.
6. **Never put logic in `index.php`** — it's an HTML shell.
7. **One controller per domain** — never combine features.
8. **Shared functions go in `helpers.php`** — not duplicated.
9. **Database changes go through tracked migrations** (§3A) — never manual SQL.
10. **Brand lives in CSS variables** — never hardcode colors.
11. **Always test after deploy** — dashboard, add trade, challenges, profile, calculator.
12. **Never edit `updater.php`** — it's battle-tested.
13. **When a change is agreed, implement it and commit, tag, push, and release in the
    same turn** — do not stop to ask for confirmation. Finish the whole pipeline
    (commit → tag → push → GitHub Release) before ending the turn, not just the code
    change.
14. **Comments are 2 lines maximum.** History, rationale, and the "why" behind a
    decision go in the commit message, not inline in the code. Don't rewrite or expand
    an existing comment unless the code directly under it is changing in this same edit.
15. **Testing cadence:** during development, run only the `tools/ui-harness` suite for
    the feature you're actively touching. Run the **full** suite (every `drive*.mjs`
    driver) plus the duplicate-name scan **once, before release** — not after every
    small change.

## 12. TESTING — UI HARNESS

`tools/ui-harness/` is a DB-free, browser-driven Playwright harness for the Backtesting
UI (`js/backtest.js`/`js/backtest-drawings.js`) — never deployed (not in `version.json`'s
`files`, excluded via its own `.gitignore` for `node_modules/`, `out*/`,
`mock_state.json`). `setup.js` copies `app/` into a fresh OS temp dir, overlays a stub
`includes/config.php`/`includes/api.php` (mocking just enough of the API surface —
stateful for session ids 20/21/22, inert for session 6), vendors the two CDN chart libs
locally, and serves it via `php -S`.

**Drivers** (`drive.mjs`, `drive-v3223.mjs`, `drive-v3225.mjs`, `drive-v3226.mjs`, ...) —
one per release that touched this UI, each left in place and still passing after later
releases (never edit an old driver to "fix" it for new code — add a new one). Every
driver's first assertion is `scan-duplicate-names.mjs` (parses every `app/js/*.js` file's
top-level declarations via a real AST — every file is a plain global `<script>` tag
sharing one scope, so a same-named top-level function/variable in two files means the
second one silently wins, no error).

**Run a single suite** (during development, for the feature you're touching):
```
cd tools/ui-harness
timeout 300 node drive-v3226.mjs
```
**Run everything** (once, before release):
```
for f in drive*.mjs; do timeout 300 node "$f" || break; done
node scan-duplicate-names.mjs
```
Always run under a hard `timeout` — a hung browser/server should fail loudly, not hang
the session. `php -l` on every changed PHP file and `node --check` on every changed JS
file are cheap and worth running alongside the harness, every time.

## 13. DEPLOY & RELEASE WORKFLOW

### Folder structure GitHub expects

```
fsa-journal-updates/          ← Repo root
├── version.json              ← ALWAYS at repo root
└── app/                      ← ALL site files, mirroring the live site
    ├── index.php, login.php, includes/, pages/, modals/, js/, css/, migrations/, cli/
```
`includes/config.php` is **never** in this repo, under any circumstances.
`tools/ui-harness/` lives at the repo root (sibling of `app/`), never inside `app/`.

### version.json

```json
{
    "current_version": "3.3.1",
    "release_date": "2026-03-26",
    "changelog": ["One bullet per fix/feature, specific enough to act on"],
    "release_notes": "Deploy notes: schema changes, what to verify, anything unusual",
    "files": [
        {"path": "includes/controllers/TradeController.php", "critical": false}
    ],
    "db_migrations": []
}
```
- Version always bumped — never the same as previous.
- Only list files that **actually changed** — `updater.php`'s `apply` action downloads
  only what's listed, and does **not** replay older releases' own manifests. A file that
  changed only in a since-superseded release and was never repeated in a later manifest
  is silently never deployed if that release's Update Now click gets skipped — when in
  doubt about what state a live server is actually in, union every manifest since the
  last confirmed-good version rather than guessing. **This happened for real once**: a
  site updated straight from v3.23.0 to v3.24.1, got only v3.24.1's own one-file
  manifest, and silently skipped all of v3.24.0 — fixed by v3.24.2's cumulative
  manifest. `git diff --name-only <old-tag> <new-tag> -- app/` (excluding `app/tests/`
  and `app/docs/`) is the reliable way to build that union — don't reconstruct it from
  memory or from release notes prose.
- `critical: true` means "never auto-overwrite this file" (for something like
  `config.php`) — **not** "this file matters, make sure it deploys." Every real code
  change should be `critical: false`.
- `db_migrations` is the old inline mechanism (still executed by `updater.php`, no
  checksum, no ledger) — always include it, even empty; don't add new work to it, use
  the tracked runner (§3A) instead.

### Release checklist

1. Make the code change. Keep comments to 2 lines max (see Development Rule 14);
   explain the why in the commit message instead.
2. Run the harness suite for the feature you touched (§12).
3. Before tagging: run **every** harness driver + the duplicate-name scan, `php -l` and
   `node --check` on every changed file.
4. Bump `version.json`'s `current_version` + `files` array + `db_migrations` if a
   migration was added. Bump the "Current Version" line in this file too — it appears
   twice: the Live Details table near the top, and the session-starter template below.
5. If a migration was added, document it in `app/migrations/` per §3A and list it in
   `version.json`'s `files`.
6. Commit, tag (`vX.Y.Z`), push **both** `main` and the tag, in the same turn — do not
   stop to ask for confirmation (Development Rule 13).
7. Publish a GitHub release for the tag (`gh release create`), with screenshots if the
   change is visual.
8. Verify the push landed: `git ls-remote origin refs/heads/main refs/tags/vX.Y.Z` —
   both should point at the same commit.
9. If a migration shipped: after Acrob runs Update Now, back up the live DB, then hit
   `migrate.php?mode=run&token=...` — this step is Acrob's to trigger, not something to
   assume happened automatically.
10. Ask Acrob to confirm `updater.php` reports the new version as `local_version` — a
    repo/tag version bump doesn't guarantee the live server actually pulled it (see the
    manifest-union note above for why that can silently diverge).

### Claude Code session starter

```
Project: FundedControl — PHP 8.1 + MySQL 8.4 + Vanilla JS
Live URL: https://www.fundedcontrol.com/
Repo: https://github.com/frisoftltd/fsa-journal-updates
Current Version: v3.26.1
Server: Hetzner CX23 VPS (Helsinki), CloudPanel, nginx + PHP-FPM — see §1A
DB: fundedcontrol on 127.0.0.1:3306
CLAUDE.md is in the repo root — read it for full context; docs/CHANGELOG-archive.md
has the per-release history if you need it.

Task: [describe what you need]
```
GitHub access in this environment is an already-authenticated `gh` CLI — no token needs
pasting. If a fresh environment ever lacks that, `gh auth login` once is sufficient.

*FundedControl — Control Your Trading. Get Funded. Stay Funded.*
*Built by Acrob — a trader who's been in the red and came back disciplined.*
