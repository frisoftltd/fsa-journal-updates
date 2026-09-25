# CLAUDE.md — FundedControl Project Context
## Complete Reference for Claude Code (AI Development Assistant)

**Product:** FundedControl (formerly FSA Trading Journal)
**Developer:** Acrob — Solo developer, crypto trader, Kigali, Rwanda
**Experience:** 10 years PHP
**Last Updated:** March 2026

---

## 1. PROJECT OVERVIEW

### What Is FundedControl?

A professional trading journal SaaS built specifically for **prop firm traders**. Traders log every trade, track challenge progress, manage risk limits, and review performance — all inside one disciplined tool.

**Core problem it solves:** Prop firm traders fail challenges because they have no structured accountability system. FundedControl gives them real-time risk alerts, rule enforcement, and performance analytics designed around prop firm rules.

### Live Details

| Field | Value |
|-------|-------|
| Live URL | https://www.fundedcontrol.com/ |
| Updater | https://www.fundedcontrol.com/updater.php |
| GitHub Repo | https://github.com/frisoftltd/fsa-journal-updates (git remote origin and `updater.php` both still say `acrobcrypto250/fsa-journal-updates` — that account was renamed to `frisoftltd`; GitHub redirects it, so it still works, but the hardcoded name in `updater.php` is stale) |
| Domain (rebranding) | fundedcontrol.com |
| Blog | https://blog.fundedcontrol.com/ |
| DB Name | `fundedcontrol` — MySQL 8.4 on the Hetzner VPS described in §1A below. Replaces the old Namecheap-hosted `theittav_journal` as of the 2026-09-24 migration. **`theittav_fundedcontrol` was an abandoned copy on the old host** — this file briefly said it was correct (v3.7.0 release) based on an audit that had checked the wrong database; corrected 2026-09-13 while scoping v3.8.0. See §11 Bug 2 (retracted). Both `theittav_journal` and `theittav_fundedcontrol` are old-host names and no longer apply at all post-migration. |
| Current Version | v3.19.0 |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | PHP 8.1 |
| Database | MySQL 8.4 (PDO, prepared statements) |
| Frontend | Vanilla JS + Chart.js + TradingView Lightweight Charts (backtesting chart, v3.19.0) |
| Hosting | Hetzner VPS, CloudPanel, nginx + PHP-FPM — see §1A |
| No frameworks | No Laravel, no React, no Composer |

### §1A. Server Environment (migrated 2026-09-24)

| Field | Value |
|-------|-------|
| Provider | Hetzner CX23 VPS, Helsinki |
| OS | Ubuntu 24.04 |
| IP | 77.42.125.97 |
| Panel | CloudPanel |
| Web server | nginx + PHP-FPM |
| Site root | `/home/fundedcontrol/htdocs/fundedcontrol.com` |
| Site user | `fundedcontrol` |
| Database | MySQL 8.4 — database `fundedcontrol`, user `fundedcontrol`, host `127.0.0.1:3306` |

**Everything above replaces the old Namecheap shared-hosting setup as of 2026-09-24.**
Every other mention of `theittav_journal`, cPanel, or Namecheap-relative paths
elsewhere in this file (§11, §3A's "Operational Lessons," the v3.9.x–v3.13.x narrative
sections, §15's SMTP config, §18's session-starter template) is a **historical record**
of what was true on the old host at the time those releases shipped — left as written,
not rewritten, since rewriting history there would misrepresent what actually happened.
Don't infer the current DB name, site paths, or hosting details from those older
sections; this table is the current, authoritative one.

### Backtesting Pipeline (Phase 1a, added v3.19.0)

`app/cli/{backfill,update,verify,repair}.php` pull OHLCV candles from Bybit v5
`/v5/market/kline` (linear perpetuals, no API key needed) into three new tables
(`symbols`, `candles`, `candle_sync` — see §3 below) via `includes/bybit_client.php`.
CLI-only, enforced two ways: `backtestRequireCli()` 403s under any non-CLI SAPI, and
this site's nginx vhost denies `/cli/` outright:
```nginx
location ^~ /cli/ {
    deny all;
    return 403;
}
```
`cli/update.php` runs every 15 minutes via a CloudPanel Cron Job:
```
*/15 * * * * php /home/fundedcontrol/htdocs/fundedcontrol.com/cli/update.php >> /home/fundedcontrol/htdocs/backtesting-logs/update-cron.log 2>&1
```
All four scripts also log to `/home/fundedcontrol/htdocs/backtesting-logs/` — one level
above this site's own document root (a sibling of `fundedcontrol.com/` inside `htdocs/`),
so a direct request for a log file 404s at the vhost level instead of serving plain text.

`ChartController.php`'s `get_symbols`/`get_candles` read candles only from MySQL —
nothing in the browser or in a page request ever calls Bybit directly. See
`docs/backtesting-pipeline.md` for the full backfill/cron/verify/repair runbook — **the
file lives at `app/docs/backtesting-pipeline.md` in this repo** (v3.19.1: moved there
from the repo root, where `updater.php`'s `GITHUB_BASE_URL` — `.../main/app` — could
never actually reach it; a `files` entry pointing at the repo-root path 404'd and failed
the whole Update Now). Every other repo-root `docs/` file (e.g. `docs/audits/`) is
genuinely git-only and not meant to deploy — this one file is the exception, deployed on
purpose.

### Backtesting Replay Engine (Phase 1b, added v3.20.0)

The sidebar module renamed **"Chart" → "Backtesting"** — same route slot, now session-
based rather than plain browsing. `pages/backtest.php`/`js/backtest.js` (session list,
setup form, replay controls, order panel, challenge panel) reuse `js/chart.js`'s
low-level candlestick/volume rendering as-is rather than duplicating it; `chart.js`'s
own plain-browsing entry point (`loadChart()`) is no longer wired to any nav item as of
this rename, but its rendering primitives remain the replay view's actual chart engine.
`candles`/`candle_sync`/`symbols` and the CLI pipeline above are **unchanged** — the
briefing was explicit that the pipeline's own naming stays as-is; only the user-facing
module got renamed.

**Schema:** `backtest_sessions` (fully custom challenge rules per session, never an FK
to `challenges` — "the backtest never requires an existing challenge to run"),
`backtest_pending_orders` (a resting limit order, promoted into `trades` only once it
fills), and `trades` gains `source='backtest'` (extends the existing ENUM) +
`backtest_session_id`. A backtest trade's `challenge_id` is left `NULL` — the only value
legal against `trades.challenge_id`'s own FK to `challenges(id)` (added 2026_09_17_0006)
that's also never mistakable for a real challenge — but NULL alone does **not** exclude
it from this schema's pervasive `(challenge_id=? OR challenge_id IS NULL)` pattern, so
`source != 'backtest'` was added explicitly everywhere that pattern (or an unscoped
`WHERE user_id=?`) appears: `StatsController`, `AlertController`,
`TradeController::getAll()`, `ReviewEngineController` (three "all combined" branches),
`ReportCardAiController`, `StrategyBuilderController::getLeaderboard()`. See
`docs/backtesting-pipeline.md` §13 for the full list and why NULL alone wasn't enough.

**No stored equity/peak-equity columns on `backtest_sessions`** — deriving both live
from `trades` (`BacktestController::computeSessionState()`) is a deliberate repeat of
the `challenges.current_balance` fix (v3.13.0 above): a stored, incrementally-updated
balance drifted silently for five weeks before being dropped in favor of always
deriving it from trades. Same lesson, applied before it could repeat here.

**No-lookahead** (the briefing's own "critical" requirement):
`BacktestController::getCandles()` clamps every response to the session's own
`replay_cursor_ms`, server-side, regardless of what a client asks for — the browser is
never trusted to hide future candles on its own.

**Pure fill/P&L/drawdown math** lives in `includes/backtest_engine.php` (position
sizing, P&L, fees, stop/target-touch detection — stop-loss wins if a bar touches both in
one candle, a deliberately conservative tie-break — and drawdown distance), unit-tested
standalone via `php includes/backtest_engine.php`, same convention as
`bitfunded_parser.php`/`bybit_client.php`'s own self-tests.

---

## 2. ARCHITECTURE — v3.0.0 MODULAR BACKEND

### The Core Principle

Every feature is an **independent PHP controller class**. The router maps API actions to controller methods. Adding a feature = creating a new file + one line in `router.php`. Zero edits to existing files.

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
│
├── index.php                          ← App shell: sidebar + page router
├── login.php                          ← Login page
├── register.php                       ← NEW: Registration + email verification
├── logout.php                         ← Session destroy + redirect
├── updater.php                        ← GitHub auto-updater (DO NOT MODIFY)
├── version.json                       ← Version tracking
│
├── includes/
│   ├── config.php                     ← ⛔ DB CREDENTIALS — NEVER IN GITHUB
│   ├── api.php                        ← Thin API entry (14 lines max)
│   ├── helpers.php                    ← Shared functions
│   ├── emotion_states.php             ← Emotional state taxonomy (added v3.10.0)
│   ├── journal_taxonomy.php           ← Trade journal action/exit-type codes (added v3.11.0)
│   ├── router.php                     ← Action → controller routing
│   │
│   └── controllers/
│       ├── ProfileController.php      ← get_user, update_profile (95 lines)
│       ├── ChallengeController.php    ← CRUD challenges, switch (108 lines)
│       ├── TradeController.php        ← CRUD trades, scoped to challenge (121 lines)
│       ├── StatsController.php        ← Statistics (90 lines)
│       ├── AlertController.php        ← Risk alerts (54 lines)
│       ├── CalculatorController.php   ← Position size calc (27 lines)
│       ├── PairController.php         ← Pair management (40 lines)
│       ├── ImportController.php       ← Excel batch import (35 lines)
│       ├── StrategyController.php     ← Strategy tester (47 lines)
│       ├── ReviewController.php       ← Weekly reviews (34 lines)
│       └── OnboardingController.php   ← NEW: Setup wizard
│
├── pages/                             ← HTML only, no logic (Phase 2)
│   ├── dashboard.php
│   ├── trades.php
│   ├── stats.php
│   ├── calculator.php
│   ├── strategy.php
│   ├── review.php
│   ├── profile.php
│   ├── challenges.php
│   └── onboarding.php
│
├── modals/                            ← Modal HTML only (Phase 2)
│   ├── trade-modal.php
│   ├── trade-view-modal.php
│   ├── challenge-modal.php
│   ├── review-modal.php
│   ├── strategy-modal.php
│   ├── pairs-modal.php
│   ├── import-modal.php
│   └── checklist-modal.php
│
├── js/
│   ├── app.js                         ← Core: api(), nav, toast (100 lines max)
│   ├── dashboard.js
│   ├── trades.js
│   ├── stats.js
│   ├── calculator.js
│   ├── strategy.js
│   ├── review.js
│   ├── profile.js
│   ├── challenges.js
│   ├── import.js
│   └── onboarding.js
│
├── css/
│   ├── style.css                      ← Core layout, variables, components
│   └── brand.css                      ← FundedControl colors + fonts (Phase 3)
│
├── media/
│   └── uploads/{user_id}/             ← User trade screenshots
│
└── backups/                           ← Auto-created by updater
```

---

## 3. DATABASE SCHEMA

### Tables

**users**
```sql
id, username, password, display_name, avatar_color, bio,
account_balance, starting_balance, max_drawdown_pct,
daily_loss_limit, risk_per_trade_pct, prop_firm, challenge_phase,
email, email_verified, verification_token, created_at,
onboarding_completed
```
> Note: `account_balance` through `challenge_phase` are legacy fields kept for backward compat. New data uses the `challenges` table.

**challenges** (added v2.3.0)
```sql
id, user_id, name, prop_firm, challenge_phase,
starting_balance, max_drawdown_pct,
daily_loss_limit, risk_per_trade_pct, profit_target_pct,
status (active/completed/failed), is_active (0/1), created_at,
default_strategy_id (added v3.5.0 — links to strategies.id),
funding_adjustment, profit_target_amt, max_loss_amt (added v3.13.0),
drawdown_type (added v3.14.7),
default_leverage (added v3.17.0)
```
> `default_leverage` (`DECIMAL(6,2) NULL`) — not one of the two migrations the v3.17.0
> briefing named (`planned_margin`, `challenge_limits`); added anyway because the
> briefing's own input list requires it ("Leverage: default from challenge settings,
> editable") and no column held a default before this release — the old calculator page
> just had a bare, always-blank leverage input. Purely additive (nullable, no rename, no
> drop), so it stays inside the briefing's own "Additive. No table renames, no column
> drops" constraint even though it wasn't itself enumerated. `NULL` means no default is
> set; the calculator's Leverage field then starts blank rather than showing a guessed
> number.
> `current_balance` was **dropped** in v3.13.0 — it was a stored column nothing ever
> recalculated, and it drifted silently for five weeks on the Bitfunded Altcoin challenge
> (see the v3.13.0 section below). Balance is now always
> derived: `starting_balance + SUM(net_pnl for closed trades) - funding_adjustment`,
> computed by `helpers.php::enrichChallenge()` and returned under the same
> `current_balance` key so existing API consumers (JS included) needed no contract
> change. Never add a query that reads `challenges.current_balance` — the column doesn't
> exist; call `enrichChallenge()`/`enrichChallenges()` on whatever you fetched instead.
>
> `funding_adjustment` (`DECIMAL(12,4) NOT NULL DEFAULT 0.0000`) holds costs that are real
> but not attributable to a single trade (this account's net funding fees) — a
> challenge-level line item, subtracted once in the derivation above, never per-row.
>
> `profit_target_amt` / `max_loss_amt` (`DECIMAL(12,2) NULL`) hold a prop firm's stated
> criteria as currency amounts, for firms (Bitfunded included) that state them per stage
> rather than as a percentage. `profit_target_pct` / `max_drawdown_pct` are **not**
> removed and remain authoritative for challenges where only a percentage was ever given
> — but wherever an amount is on file, `enrichChallenge()` overrides the pct field with
> the amount expressed as a percentage of `starting_balance`, so every consumer of those
> two columns (dashboard label, `AlertController`, `ReviewEngineController::
> ruleDrawdownProximity()`) gets the amount-derived figure without needing its own
> amount-vs-percent branch.
>
> `drawdown_type` is `ENUM('static','trailing') NOT NULL DEFAULT 'static'`. Controls how
> `current_drawdown_pct` (`StatsController::getStats()`) is computed — `'static'` measures
> from `starting_balance` (how Bitfunded's own Maximum Loss rule, and most prop firms,
> actually judge the account); `'trailing'` measures from the equity high-water mark
> reached so far, FundedControl's only behavior through v3.14.6. See CLAUDE.md v3.14.7 for
> the full rationale and a known scope boundary (the risk-alert threshold and the
> Review Engine's drawdown-proximity insight are always `'static'`, regardless of this
> setting).
>
> `challenges` was MyISAM/latin1 until v3.13.0 — the only table on this schema left on the
> old engine, and the reason `trades.challenge_id` had no foreign key (MyISAM can't be an
> FK parent). Converted to InnoDB/utf8mb4 and the FK added in the same release; see the
> v3.13.0 section below for what happens if that FK can't be added cleanly on a given
> environment.

**trades**
```sql
id, user_id, challenge_id, trade_date, session, time_in, time_out,
pair, direction, entry_price, stop_loss, take_profit, exit_price,
lot_size, risk_amount, fees, pnl, net_pnl, r_multiple,
result, confidence, exec_score, fib_level, fsa_rules,
notes, screenshot, screenshots (JSON, up to 4, added later — screenshot kept for back-compat),
strategy_id, emotion_tag, setup_grade, note_saw, note_why, note_unsure (added v3.5.0),
source, r_multiple_source (added v3.12.0),
exit_reason (added v3.14.0),
balance_at_entry, planned_risk_pct, actual_risk_pct, risk_deviation_pct, clean_rep (added v3.15.0),
balance_at_day_start, target_r, exit_quality (added v3.16.0),
planned_margin (added v3.17.0),
funding (added v3.17.3)
```
> `funding` (`DECIMAL(12,4) NULL`) — per-trade funding cost, derived by
> `BitfundedImportController` from Transaction History's `Open Position`/`Close Position`
> rows (`bitfunded_parser.php::bf_attribute_funding()`) once both legs of a position's own
> margin transfer are found. `NULL` means never measured — Transaction History wasn't
> pasted, or this position's own Open/Close Position rows weren't in what was — never a
> recorded zero; `0` means measured and genuinely zero (a trader can be paid to hold, so
> `funding` is not sign-clamped and a negative value is a real, expected outcome). Existing
> rows are never backfilled — this only ever applies to trades imported after v3.17.3.
> `net_pnl = pnl - fees - COALESCE(funding, 0)` going forward; every pre-v3.17.3 row keeps
> its own already-correct `pnl - fees` value untouched. See the v3.17.3 section below for
> the full derivation, its precondition (isolated margin only), and why this is
> deliberately kept separate from `challenges.funding_adjustment` rather than folded into
> it.
> `planned_margin` (`DECIMAL(12,2) NULL`) — the Auto Risk Calculator's `margin_usd`
> output, carried into the trade form and saved as an ordinary pre-entry field alongside
> `stop_loss`/`take_profit`. `NULL` means no calculator output was ever attached to this
> trade, not a recorded zero — every pre-v3.17.0 row stays `NULL`, this is a
> going-forward field with no backfill. `BitfundedImportController::confirm()` never
> mentions this column in either of its own `UPDATE`/`INSERT` statements, so an import
> can never overwrite what was planned before entry — same contract `stop_loss`/
> `take_profit` already have. `CalculatorController::autoRiskPreview()`'s
> `margin_in_use` (`Σ planned_margin WHERE challenge_id=? AND result='Open'`) is this
> column's only other reader.
> `balance_at_entry`/`planned_risk_pct`/`actual_risk_pct`/`risk_deviation_pct`/`clean_rep`
> (all `NULL`-able, no defaults) back the Size Integrity feature — see the v3.15.0 section
> below for the exact backfill formulas, why `actual_risk_pct` falls back to `risk_amount`
> when `stop_loss` is null (true for all 59 of challenge 6's rows), and the deliberate
> scope boundary that `TradeController::saveTrade()`/`BitfundedImportController::confirm()`
> do **not** populate these columns going forward — they're backfilled once, for challenge
> 6's existing history, not computed live yet. **As of v3.16.0, `planned_risk_pct` is
> computed from `balance_at_day_start`, not `balance_at_entry`** — `balance_at_entry`
> stays stored (still a real fact — the balance at the trade's own entry time) but is no
> longer the tier-lookup basis. See the v3.16.0 section below for why.
>
> `balance_at_day_start` — the running balance before the first trade of each
> `trade_date` (identical for every trade sharing that date), added v3.16.0 specifically
> to be the ladder's tier-lookup basis instead of `balance_at_entry`.
>
> `target_r` — `(take_profit − entry_price) ÷ (entry_price − stop_loss)`, signed, no
> direction branch. Worked correctly for both Long and Short by construction (verified by
> hand for both before backfilling) and — because it's signed rather than `ABS()`'d —
> exposes a stop/target on the wrong side of entry for the stated direction as a negative
> value instead of silently masking it the way `CalculatorController`'s existing `rr_ratio`
> calculation does (see the spec-gap audit's defect #6).
>
> `exit_quality` — `ENUM`-shaped `VARCHAR(20)`: `open` / `target_hit_valid` /
> `target_hit_sub_gate` (renamed from `target_hit_short` in v3.16.1, see that section) /
> `stopped_valid` / `stopped_short` / `manual_close` / `unknown`. Derived from `target_r`
> and `exit_reason` — `exit_reason` is Bitfunded's own label (what happened), `exit_quality`
> is a judgement against the account's own gate (whether what happened was disciplined).
> `open` (added v3.16.4) is not a judgement — it means the trade hasn't closed yet
> (`result` not in `Win`/`Loss`/`Break Even`) and is checked before every other branch,
> so an unresolved trade is never conflated with `unknown` (a genuinely closed trade with
> no stop/target on file — a different fact). See the v3.16.0 section below for the
> finding `exit_quality` originally surfaced, and v3.16.4 for the `open` addition.
> `source` is `ENUM('manual','import') NOT NULL DEFAULT 'manual'` — distinguishes hand-logged
> trades from ones backfilled from a broker's own trade history (see "The Journal Was a
> Winner-Weighted Subset" below). The default means no code change was needed in
> `TradeController::saveTrade()` for this to work; it never sets the column.
>
> `exit_reason` is `VARCHAR(40) NULL`, populated exclusively by the Bitfunded paste importer
> (`BitfundedImportController`) from Position History's own exit-reason label (`Stop Loss`,
> `Manual Closing`, and possibly others Bitfunded hasn't shown yet) — stored verbatim, not
> mapped to an `ENUM`, since the full set of values isn't known. `TradeController::saveTrade()`
> never sets it, same reasoning as `source`/`r_multiple_source` above — see "The Bitfunded
> Paste Importer" below for the full v3.14.0 design.
>
> `entry_price`/`exit_price`/`stop_loss`/`take_profit` are `DECIMAL(20,10) NULL` (widened
> from `DECIMAL(14,4)` in v3.14.5 — `2026_09_18_0002_widen_trade_price_precision.sql`). Four
> decimal places floors out inside this account's real price range: three PUMPUSDT trades
> were silently stored with `entry_price` `0.0000` under the old precision, because the real
> price was a fraction of a cent, below what four decimal places can represent at all — not
> a rounding error, an outright loss of the value. Ten decimal places covers the account's
> full observed range (0.0044 to 71,968) without truncation. See CLAUDE.md v3.14.5 below —
> widening the column does not recover the already-zeroed rows; those need a real re-import.
>
> `r_multiple_source` is `ENUM('recorded','estimated') NULL`. `'recorded'` means `r_multiple`
> came from a real stop-loss distance (or, for imported full stop-out trades, a loss confirmed
> to be a 1R stop-out). `'estimated'` means no stop-loss exists for that trade and `r_multiple`
> was reconstructed from a risk-unit estimate instead — see the v3.12.0 section below for the
> method. `NULL` (every pre-v3.12.0 manual trade) means provenance was never tracked, not that
> the value is untrustworthy.
> `session` is `ENUM('London','New York','Asia','Other') NULL` (nullable, no default, since v3.9.0 —
> was `NOT NULL DEFAULT 'London'` before, which silently mislabeled every trade saved without an
> explicit session as London). `NULL` means genuinely not recorded; do not treat it as London.
> Existing pre-v3.9.0 rows were not touched — some of their `'London'` values are real, some are
> silent defaults, and there's no way to tell which after the fact.
>
> `emotion_tag` is `VARCHAR(30) NULL`. As of v3.10.0 it stores one of nine research-grounded
> state **codes** (never the label) — see "Emotional State Taxonomy" below for the full list,
> sourcing, and how pre-v3.10.0 rows are handled.

**pairs**
```sql
id, user_id, symbol, active (0/1)
```

**risk_ladder_tiers** (added v3.15.0)
```sql
id, challenge_id, lower_balance DECIMAL(12,2), upper_balance DECIMAL(12,2) NULL,
risk_pct DECIMAL(5,3), active (0/1), created_at
FK: challenge_id -> challenges(id) ON DELETE CASCADE
```
> The risk ladder as data, matching the Strategy Lab convention (`strategy_variables`)
> instead of a hardcoded percentage or the flat `challenges.risk_per_trade_pct`. Lookup is
> lower-inclusive, upper-exclusive; `upper_balance IS NULL` means "and above." Seeded for
> challenge 6 (Bitfunded Altcoin) with its documented ladder — see the v3.15.0 section
> below. Other challenges have no rows here yet, so every ladder-derived figure
> (`planned_risk_pct`, `risk_deviation_pct`, tier-breach/adherence metrics) stays `NULL`/
> `UNAVAILABLE` for them until their own ladder is seeded.

**challenge_limits** (added v3.17.0)
```sql
id, challenge_id, max_trades_day, max_trades_week, max_losses_day, daily_loss_usd,
created_at
UNIQUE KEY (challenge_id)
FK: challenge_id -> challenges(id) ON DELETE CASCADE
```
> Daily/weekly trade limits as data, same convention as `risk_ladder_tiers` — replaces
> the hardcoded "Max 2 trades/day | Stop if daily limit hit | Stop after 3 consecutive
> losses" notice bar `pages/calculator.php` used to render regardless of what a
> challenge's real limits were. One row per challenge (`UNIQUE KEY`, unlike
> `risk_ladder_tiers`'s multiple-tiers-per-challenge shape) — there's no tiering concept
> here, just one set of limits. Every column is nullable independently: a `NULL` limit is
> "not tracked" for that one dimension, never a zero that would mean "no trades allowed."
> Seeded for challenge 6: 2 trades/day, 4/week, 2 losses/day, $500 daily loss.
> `CalculatorController::getRiskStatus()` is the only reader, computing live counts
> against these limits and a single stop reason (see the v3.17.0 section below).

**strategy_tests**
```sql
id, user_id, strategy_name, timeframe, market,
rule1-rule5, test_date, pair, direction, r1-r5,
result, fib_level, r_multiple, net_pnl, session, notes, created_at
```
> Legacy sandbox, separate from the Strategy Lab (`strategies`/`strategy_variables` below). Do not merge.

**strategies** (added v3.5.0)
```sql
id, user_id, name, is_active (0/1), created_at
```

**strategy_variables** (added v3.5.0; role/timeframe/criteria/is_active/created_at added v3.8.0)
```sql
id, strategy_id, label, input_type (checkbox/scale/select/text), options,
role (gate/tag) DEFAULT 'gate', timeframe (4H/1H/15M or NULL), criteria (TEXT, NULL),
sort_order, is_active (0/1) DEFAULT 1, created_at
```
> `role='gate'` = mandatory pass/fail, checked on the pre-trade checklist. `role='tag'` = observed-only,
> captured on the trade form but not gated. Deactivate (`is_active=0`) instead of deleting a variable
> that has any `trade_variables` rows — the FK below rejects the delete anyway.

**trade_variables** (added v3.5.1; foreign keys added v3.8.0)
```sql
id, trade_id, variable_id, value (VARCHAR 255)
FK: variable_id → strategy_variables(id) ON DELETE RESTRICT
FK: trade_id → trades(id) ON DELETE CASCADE
```
> Before v3.8.0 this table had no foreign keys at all, which is how 95 answers across 19 trades got
> silently orphaned (a delete-then-reinsert bug in the strategy variable editor deleted and recreated
> variable ids 6–10 as 11–15). Fixed by migrations `2026_09_13_0003`–`0004`. See §11 for history.

**trade_journal** (added v3.11.0 — see "Three-Phase Trade Journal" below for full design)
```sql
id, trade_id, phase (pre_entry/post_close),
emotion_code, note, exit_type, good_process,
created_at, updated_at
UNIQUE KEY (trade_id, phase)
FK: trade_id → trades(id) ON DELETE CASCADE
```
> One row per trade per phase, never more. `emotion_code` is shared across all three
> phases (the nine `emotion_states.php` codes, not journal-specific). `exit_type` and
> `good_process` are only ever populated on the `post_close` row. `updated_at` has no
> `DEFAULT` — it stays `NULL` until the first edit, so `NULL` means "never edited since
> creation," not "unknown." **As of v3.16.4, `TradeController::saveJournal()` only ever
> writes `pre_entry`/`post_close` here** — `during` moved to `trade_checkins` below,
> because this table's own `UNIQUE KEY (trade_id, phase)` made a second During check-in
> silently overwrite the first, which is exactly wrong for a log meant to accumulate.
> The `phase` column's `ENUM` still technically allows `'during'` (unchanged, to avoid
> touching already-applied migration files) and pre-v3.16.4 `during` rows are left in
> place, not deleted — see v3.16.4's own section for the backfill that copied their data
> into `trade_checkins` before the app stopped reading this table for that phase.

**trade_journal_actions** (added v3.11.0)
```sql
id, journal_id, action_code
UNIQUE KEY (journal_id, action_code)
FK: journal_id → trade_journal(id) ON DELETE CASCADE
```
> Historical only as of v3.16.4 — see `trade_journal` above. `action_code` values come
> from `includes/journal_taxonomy.php`.

**trade_checkins** (added v3.16.4 — see that section below for full design)
```sql
id, trade_id, checked_at (DATETIME(3), default CURRENT_TIMESTAMP(3)),
emotion_code, tempted_text
FK: trade_id → trades(id) ON DELETE CASCADE
```
> Append-only log of "During Open Position" check-ins — no `UNIQUE KEY` on `trade_id`,
> deliberately, unlike `trade_journal`: this is the whole point of a separate table
> instead of just widening `trade_journal`'s constraint. `checked_at` is millisecond
> precision so two check-ins saved within the same second still sort and display as
> distinct rows. `tempted_text` is what the form's "What am I tempted to do right now?"
> question writes — `TradeController::saveCheckin()` compares each submission against
> the trade's own latest row here and only inserts a new one when something actually
> changed, so re-saving the rest of the trade form never creates a duplicate check-in.

**trade_checkin_actions** (added v3.16.4)
```sql
id, checkin_id, action_code
UNIQUE KEY (checkin_id, action_code)
FK: checkin_id → trade_checkins(id) ON DELETE CASCADE
```
> Same EAV shape as `trade_journal_actions`/`trade_variables` — one row per selected
> action per check-in. `action_code` values come from
> `includes/journal_taxonomy.php::journalActions()`, shared with the old `during` phase.

**ai_reviews** (added v3.6.0)
```sql
id, user_id, challenge_id, period_type (daily/weekly/monthly/quarterly/yearly),
period_start, period_end, insights_json, metrics_json, created_at
```

**weekly_reviews**
```sql
id, user_id, week_start, week_end, process_score, mindset_score,
key_lesson, what_went_well, what_to_improve, rules_followed
```
> Legacy manual review, superseded by `ai_reviews` for new usage but left untouched.

**daily_limits**
```sql
user_id, log_date, daily_pnl, trades_count
```

**schema_migrations** (added v3.7.0 — see §3A)
```sql
id, filename, checksum, applied_at, execution_ms, status (applied/failed/baselined), error_message
```

**report_cards / report_card_blocks / report_card_templates / report_card_template_blocks /
report_card_mantras / report_card_mantra_checks / report_card_tickers /
report_card_ticker_images / report_card_ai_reviews / report_card_ai_findings** (added
v3.18.0 — see that section below for full column lists, the AI review payload/tool
schema, and every judgment call made building this module)
```sql
-- one row per user+challenge+date; challenge_id NOT NULL DEFAULT 0 ("no challenge
-- selected"), no FK on that column (see the migration file's own header for why)
report_cards: id, user_id, challenge_id, card_date, overall_grade, pnl, pnl_auto,
  morning_temperature, sleep_quality, primary_goal, learned, changes_needed,
  easiest_money_trade, overview, wins, status (draft/complete)
report_card_blocks: id, card_id, sort_order, label, start_utc, end_utc, market_session,
  grade, playbook_only, sizing, in_my_favor, comments
report_card_templates: id, user_id, name, is_default, weekday_default
report_card_template_blocks: id, template_id, sort_order, label, start_utc, end_utc, market_session
report_card_mantras: id, user_id, text, sort_order, is_active
report_card_mantra_checks: card_id, mantra_id, checked_at
report_card_tickers: id, card_id, sort_order, ticker, pnl, trade_analysis, chart_notes, trade_id
report_card_ticker_images: id, ticker_id, file_path, sort_order
report_card_ai_reviews: id, user_id, card_id, scope (daily/weekly/monthly), period_start,
  period_end, status (pending/running/complete/failed), model, prompt_version,
  input_payload (JSON), output_payload (JSON), alignment_score, discipline_score, summary,
  one_change, suggested_goal, input_tokens, output_tokens, error_message
report_card_ai_findings: id, review_id, type (contradiction/behavior_pattern/
  thinking_pattern/strength/risk), severity, title, detail, evidence (JSON), acknowledged
```

### Data Relationships

```
users (1) ──→ (many) challenges
challenges (1) ──→ (many) trades
challenges (many) ──→ (1) strategies              [default_strategy_id]
trades (many) ──→ (1) strategies                  [strategy_id]
strategies (1) ──→ (many) strategy_variables
strategy_variables (1) ──→ (many) trade_variables  [FK RESTRICT]
trades (1) ──→ (many) trade_variables              [FK CASCADE]
trades (1) ──→ (many) trade_checkins               [FK CASCADE]
trade_checkins (1) ──→ (many) trade_checkin_actions [FK CASCADE]
users (1) ──→ (many) pairs
challenges (1) ──→ (many) risk_ladder_tiers
challenges (1) ──→ (1) challenge_limits
users (1) ──→ (many) strategy_tests
users (1) ──→ (many) weekly_reviews
users (1) ──→ (many) ai_reviews
```

### Challenge Scoping Rule

All trade queries must include:
```sql
WHERE user_id = ? AND (challenge_id = ? OR challenge_id IS NULL)
```
The `OR challenge_id IS NULL` handles trades from before v2.3.0.

**This means every dashboard/stats number is scoped to the currently active challenge, not the
user's whole history.** A user with multiple challenges will see different totals depending on
which one is active — this was reported as a bug in v3.9.0 (17 trades on screen vs. 28 in the
table) and turned out to be this rule working as designed, just never surfaced in the UI. Since
v3.9.0 the Dashboard and Statistics pages render a caption disclosing which challenge is in scope
(`get_stats`'s `scope.challenge_name`) — if you add a new stats card, make sure it goes through
`StatsController::getStats()` rather than a fresh query, so it inherits both the scoping and the
caption instead of silently disagreeing with the rest of the page.

### Closed-Trades-Only Rule (added v3.9.0)

One rule, applied everywhere `r_multiple` or win rate is computed: **Open trades are excluded.**
An `Open` trade's `r_multiple` is a live/interim value, not a settled outcome, and it has no
business pulling an average or a win rate in either direction just by existing unresolved.
`result IN ('Win','Loss','Break Even')` is the filter; `ReviewEngineController` and
`StrategyBuilderController::getLeaderboard()` already did this correctly before v3.9.0 —
`StatsController::getStats()` (Dashboard + Statistics page, they share one endpoint) did not, and
was fixed to match. If you add a new R-multiple or win-rate calculation anywhere, use the same
filter rather than re-deriving the convention.

### Fib Breakdown: Source History and the Still-Open Design Question (as of v3.9.2)

`StatsController::getFibBreakdown()` (called from `getStats()` for the `by_fib` field, rendered
as the "Win Rate by Fib Level" chart on the Dashboard and the "By Fib Level" table on the
Statistics page) now reads **`trade_variables`** (the dynamic strategy system), resolving the
"Fib Level" variable by label across all of the user's strategies rather than a hardcoded id, with
`trades.fib_level` (the legacy enum column) used only as a per-trade fallback where no dynamic
answer exists. Both the closed-trades filter and active-challenge scope are unchanged from
v3.9.1/v3.9.0 — those were already verified correct; only the source of the Fib value itself
changed. If no "Fib Level" variable exists for the user at all, this degrades to the legacy
column alone rather than erroring or crashing.

**v3.9.1 shipped this backwards, and here's the corrected history:**

- **v3.9.1** (2026-09-14, before the v3.8.0 orphaned-variable remap had time to be reflected in
  that investigation's own cross-join) checked whether `trades.fib_level` and `trade_variables`
  variable 14 overlapped, found they didn't, and concluded switching to the dynamic source would
  only take the chart from 7 usable trades to 8 — not worth it. **That cross-join was run against
  a stale mental model of the remap's effect** — variable 14 has carried 21 rows (18 of them
  closed trades) since migration `2026_09_13_0003` finished, not the tiny number the v3.9.1 note
  implied.
- **v3.9.2** (this release) corrected it: `trades.fib_level` covers only 8 of 26 closed trades;
  `trade_variables` variable 14 covers **18** of 26. The real comparison was always 7 (usable,
  conclusive-threshold) → **18**, not 7 → 8. The chart had been reading under a third of the
  record, and — because the legacy-only sample happened to lose on all its `0.382`/`0.5` trades
  while winning its one `0.618` trade — it was showing close to the *opposite* of what the full
  data says: `0.382` is the best-performing level (12 dynamic trades, 58.3% win, +10.56R), not a
  0% loser. **Lesson: re-verify a "not worth it" data-coverage conclusion after any migration that
  touches the tables being compared, don't treat it as a one-time fact.**
- The two sources still don't overlap on the same trade (confirmed both times), so the v3.9.2 fix
  uses a `COALESCE`-style fallback — a trade's dynamic answer wins if a `trade_variables` row
  exists at all (even a blank one, which is its own bucket, not silently dropped), otherwise
  `trades.fib_level` fills the gap. This pulls in the legacy-only trades too, so the *final*
  rendered bucket counts are somewhat higher than the pure variable-14 table above wherever a
  legacy-only trade shares the same value (e.g. `0.618` picks up one additional legacy win,
  softening its win rate from a flat 0% to a small positive) — expected and intentional, not a
  bug, but worth knowing so the numbers on screen don't look like a mismatch against this note.

**The generic design question is still open, still Acrob's to decide, not attempted in v3.9.2:**
one win-rate-per-value breakdown per active `strategy_variables` row instead of one hardcoded Fib
chart. `StrategyBuilderController::attributeVariables()` (used by the Strategy Leaderboard) already
does the generic version, gated at `MIN_SPLIT_TRADES` (8) per value. Blocked on `trades.strategy_id`
being chosen per-trade rather than fixed per-challenge — there's no `challenges.
default_strategy_id`-driven single source of truth for "the" active strategy when a challenge spans
more than one. This is the third time a hardcoded single-variable breakdown has caused a real
problem (legacy `fib_level` staleness in v3.9.1, then the source-selection bug just described in
v3.9.2) — it should get resolved rather than deferred a fourth time, but it still needs Acrob's
product call, not another engineering workaround.

### v3.9.3: A "Wrong Numbers" Report That Didn't Reproduce, Plus Two Real Fixes

A bug report came in describing `getFibBreakdown()` (the v3.9.2 code above) rendering every
bucket at `n=1` on live, with `0.618` showing a false 100% win rate. Before touching any code,
this was checked by **actually running the real, unmodified `StatsController.php` against a real
MariaDB instance** (installed locally for this purpose — no live DB credentials exist in this
environment by design, see §13 rule 4) seeded with data shaped exactly to the numbers in the bug report:
26 closed trades, 18 with a `trade_variables` answer for the Fib variable (12/3/2/1 split across
`0.382`/`0.5`/`0.618`/blank), 8 legacy-only via `trades.fib_level`, non-overlapping. **The code
produced the correct merged result** (`0.382` n=16 ~43.8%, `0.5` n=5 0%, `0.618` n=3 ~33.3%) in
every scenario tested — single Fib variable, two strategies each with their own Fib Level
variable (to specifically rule out the id-collection concern the report raised), and a user with
no Fib variable at all (the legacy-only fallback branch). None reproduced `n=1` per bucket.

**Separately, `git log` confirms the v3.9.2 code was never committed or pushed** — it existed only
in an uncommitted working tree from the prior session. So "the v3.9.2 rewrite shipped and produces
wrong numbers on live" doesn't match either the code's actual behavior under test or the repo's
own history. If a real production screen is showing `n=1` per bucket, the far more likely
explanation is that live is still running pre-v3.9.2 code (or some other stale/cached state), not
a logic bug in this method. **Lesson: verify deployment state before debugging a "wrong output"
report** — a symptom that doesn't reproduce against the actual current source is itself a finding,
worth checking before assuming the code is at fault. This is the same "report rather than resolve
silently" principle as a data disagreement, applied to a deployment-state disagreement instead.

Two real fixes went into v3.9.3 regardless, independent of the phantom bug hunt:
- **Blank `trade_variables` answers are now excluded from the breakdown entirely** (`NULLIF(tv.
  value,'')` folded into the same "no data" path as no-row-at-all), rather than rendering as their
  own bucket — a recorded-but-empty answer is absence of information, and a single blank trade
  showing a 100%-confident bar was the same misleading-single-trade artifact the sample-size guard
  exists to prevent, just via a different mechanism. Coverage (`fib_coverage`: trades with a real
  value vs. all closed trades in scope) is returned separately and shown as a caption line instead.
- **Non-conclusive buckets now use a visibly distinct treatment**, not just a lighter shade of the
  same color: a diagonal-hatch `CanvasPattern` fill on the Dashboard chart (`hatchPattern()` in
  `js/dashboard.js`), and italic + a leading "≈" on the Statistics table — a muted-but-still-solid
  bar or cell reads as "real data, just deemphasized," which undersold how easily a low-n bucket's
  character can flip on a single trade (`0.618` moved from a flat 0% to ~33% on the strength of one
  legacy row).

### Emotional State Taxonomy (added v3.10.0)

`trades.emotion_tag` moved from an ungrounded 8-state set to nine states drawn from two sources:

- **Mark Douglas, *Trading in the Zone*** — names four primary trading fears (being wrong,
  losing money, missing out, leaving money on the table) as the source of most trading error,
  plus a separate need for discipline against the euphoria/overconfidence that follows a winning
  streak. The target state is not "calm" generally but a relaxed, carefree state produced by
  having accepted the risk.
- **Fenton-O'Creevy et al. (2011), *Journal of Organizational Behavior*** — traders using
  antecedent-focused emotion regulation outperform those using response-focused strategies; the
  best traders treat emotion as information rather than noise, which is the reasoning behind
  giving every state a real explanation instead of a one-word label.

| code | label | phase |
|---|---|---|
| `settled` | Settled | target state |
| `impatient` | Impatient | pre-entry |
| `hesitant` | Hesitant | pre-entry |
| `chasing` | Chasing | pre-entry |
| `hoping` | Hoping | in-trade |
| `wanting_out` | Wanting out | in-trade |
| `greedy` | Greedy | in-trade |
| `invincible` | Invincible | post-outcome |
| `vengeful` | Vengeful | post-outcome |

Full descriptions live in `includes/emotion_states.php::emotionStates()` — this is the **single
source of truth**. The trade form (`js/trades.js::renderEmotionGrid()`, data embedded by
`index.php` as `window.EMOTION_STATES`/`window.LEGACY_EMOTION_LABELS`) and
`ReviewEngineController` both read from it; nothing else hardcodes these codes, labels, or
descriptions. Order matters (target → pre-entry → in-trade → post-outcome distortions) and is
preserved wherever the list is rendered.

**Codes are permanent, labels are not.** `trades.emotion_tag` stores the `code` column
(`settled`, `impatient`, ...), never the display label — labels/descriptions can be reworded
freely, a code must never change once shipped, or historical data becomes unreadable.

**The trade form's emotion grid keeps the old tap-grid pattern** (pill buttons, no typing) but
adds a non-destructive way to read a state's meaning before choosing it: each pill has a
companion "ⓘ" button that shows the description in a panel below the grid without touching the
selection at all — tapping ⓘ never writes to the hidden `emotion_tag` field or changes which pill
is highlighted. Tapping the pill's own label selects it; tapping an already-selected pill's label
again clears it, and there's also an explicit "✕ Clear selection" link, because an unanswered
emotion must never default to anything (the same silent-default problem fixed for checkbox
strategy variables in v3.9.4 — see below).

**Legacy data — not rewritten.** The old 8-state set (`calm`, `itchy`, `fomo`, `revenge`,
`bored`, `overconf`, `anxious`, `unsure`) is not 1:1 with the new nine (e.g. legacy `bored` and
`itchy` both land conceptually near `impatient`, `anxious` and `unsure` both land near
`hesitant`) — collapsing them into new codes would invent precision that was never recorded, so
existing rows are untouched. `legacyEmotionLabels()` in the same file maps each retired code to a
readable "(legacy)"-suffixed label, used by `emotionLabel()` (both a PHP function and a JS
function of the same name in `trades.js`, reading the same embedded data) wherever a trade's
emotion needs to render as text: the trade-view detail panel, and the edit form's legacy-value
warning (shown when an existing trade's `emotion_tag` doesn't match any of the nine current
codes — no pill lights up for it, so the form explicitly states what was recorded and warns that
picking a new pill will replace it, rather than leaving the grid looking blank/unanswered).

**Audit query — has not been run in this environment** (no live DB credentials here, by design).
Run against `theittav_journal` before relying on the historical distribution for anything:
```sql
SELECT emotion_tag, COUNT(*) AS n FROM trades WHERE emotion_tag IS NOT NULL GROUP BY emotion_tag ORDER BY n DESC;
```

**`ReviewEngineController` hardcoded references, both fixed:**
- `ruleEmotionOutcome()` groups by the raw `emotion_tag` value (already generic — no hardcoded
  list, works unchanged on old or new codes) but rendered the raw code directly in insight prose;
  now runs it through `emotionLabel()` so old and new codes both read as a name, not a code,
  while the underlying grouping still keys on the exact stored string (an old and a new code
  that feel similar, e.g. `itchy` and `impatient`, are never merged).
- `ruleNegativeStateFrequency()` had a hardcoded `['itchy','fomo','revenge','bored']` "reactive
  state" list. Extended to `['itchy','fomo','revenge','bored','impatient','chasing','vengeful']`
  — both the retired codes and their nearest v3.10.0 equivalents, so the rule keeps working on a
  mix of old and new rows. Deliberately does **not** include `hesitant`/`invincible` (the old set
  excluded their predecessors `anxious`/`unsure`/`overconf` from this specific rule too — it
  measures impulsive/undisciplined *entries*, not fear-driven hesitation or post-win-streak
  bias) or `hoping`/`wanting_out`/`greedy` (in-trade/exit states with no equivalent in the old
  set, and out of this rule's entry-timing scope). See the inline comment in
  `ReviewEngineController.php::ruleNegativeStateFrequency()` for the full reasoning if this list
  needs revisiting.

**Design choice — PHP file, not a database table.** A DB table would let descriptions be edited
without a release, but this is a fixed, citation-grounded taxonomy, not user content — a table
would add CRUD/migration surface for something that isn't meant to change casually. A plain PHP
file (`includes/emotion_states.php`, required directly by `index.php` for the trade form and by
`ReviewEngineController.php` for insight text) keeps the taxonomy in version control next to the
research citations that justify it, consistent with how fixed enumerations with metadata already
work elsewhere in this codebase (e.g. `ReviewEngineController`'s `MIN_*` constants).

**Not done in v3.10.0, by design:** the next release adds during-position and post-close
journaling and will reuse this same grid at all three phases — that's why the labels/descriptions
are phase-neutral rather than entry-framed like the old set ("waiting for setup", "scared to
enter") was. No phase field exists yet; today's single capture point is still logged at
trade-save time only.

### Three-Phase Trade Journal (added v3.11.0)

Replaces the old single pre-entry section (setup grade + one emotion + three prose questions —
`note_saw`/`note_why`/`note_unsure`) with nine questions across three phases, stored in
`trade_journal`/`trade_journal_actions` (schema above). Only three of the nine are free text, one
per phase — nine prose fields per trade would not get filled, and a half-filled journal is worse
than a short one.

**Why the old three prose fields were replaced, not just supplemented:** "What did I see?" and
"Why enter now?" collected the same answer, and both re-recorded what the gate/tag variables
already capture structurally. Worse, all three were justification prompts asked at the moment the
trade decision was already made — they invite writing the version that makes the trade look
reasonable after the fact, not a check before it. Q3 ("What would have to happen for me to be
wrong?") replaces all three: it's hard to rationalize, and it forces the invalidation condition
into view before attachment to the trade forms.

**The three phases:**

| Phase | Questions | Realistically filled? |
|---|---|---|
| `pre_entry` | Q1 emotion, Q2 setup grade (unchanged `trades.setup_grade`), Q3 free text | Yes — this is what the old form asked, just reworked |
| `during` | Q4 multi-select actions, Q5 emotion, Q6 free text | **Optional, often empty — expected** |
| `post_close` | Q7 exit type, Q8 emotion, Q9 good-process Yes/No + optional line | Yes |

**The during-position phase being empty is itself data, not a gap.** It means the trader didn't
return to the chart mid-trade. There is deliberately **no "skipped" marker or button** — the
absence of a `during` row for a trade already carries that meaning, combined with `trades.
time_in`/`time_out`. Adding a marker would be recording the same fact twice, once as an absence
and once as an explicit flag, with no way to keep them from disagreeing. The form does not
prompt, nag, or validate this phase as required — `TradeController::saveJournal()` simply deletes
any existing `during` row if every field in it comes back empty, rather than leaving a stale
empty row or inventing a status value for "nothing to say."

**Timestamps are load-bearing, not decoration.** Fenton-O'Creevy et al. (2011) — the same paper
behind the v3.10.0 emotion taxonomy — finds retrospective self-report of emotion is unreliable
because the affective system is focused on the present, not the past. An entry written while a
trade was live is different data from the same words typed at close; nothing downstream can tell
them apart unless the write time is recorded. `created_at`/`updated_at` are set at the database
level (`DEFAULT CURRENT_TIMESTAMP` / `ON UPDATE CURRENT_TIMESTAMP`), and `TradeController::
saveJournal()`'s `INSERT ... ON DUPLICATE KEY UPDATE` deliberately excludes `created_at` from the
`UPDATE` clause so an edit can never touch it — this needed no application-level enforcement, just
not naming that column in the update list.

**Codes, never labels — extended to this table.** `trade_journal.emotion_code` stores an
`emotion_states.php` code; `trade_journal.exit_type` and `trade_journal_actions.action_code`
store codes from the new `includes/journal_taxonomy.php` (`journalActions()`/
`journalExitTypes()`). Same rule as the emotion taxonomy: labels can be reworded freely, codes
must never change once shipped. `journal_taxonomy.php` deliberately does *not* duplicate the
emotion states — those stay in `emotion_states.php` and are shared across all three phases,
because they're human states, not journal-specific or strategy-specific data.

**Strategy linkage — deliberately not duplicated.** Journal rows reference only `trade_id`;
`trades.strategy_id` is the single source of truth for which strategy a trade (and by extension
its journal entries) belongs to. Duplicating `strategy_id` onto `trade_journal` was considered and
rejected — the trade's own `strategy_id` can change after the fact (currently unrestricted), and a
duplicated copy would either drift from it or require every edit path to keep both in sync for no
benefit; the journal simply follows whatever the trade currently points to.

**The strategy selector moved to the top of the trade form** (`modals/trade-modal.php`, right
after Pair) because it determines which gate/tag variables `renderStrategyVarFields()` renders
just below it — that rendering logic itself is unchanged from v3.9.4/v3.10.0, only its position
in the form moved. **Known, deliberately out-of-scope gap:** the separate pre-trade checklist
popup (`openChecklist()` in `js/trades.js`, shown *before* the trade modal opens, gate variables
only) still derives its gate list from `challenges.default_strategy_id`, not from any per-trade
selection — there is no strategy choice available yet at the point that popup renders. For a user
running more than one strategy, that popup will show the wrong strategy's gates whenever the
active challenge's default doesn't match the strategy they're about to log. Fixing this needs the
checklist popup to gain its own strategy selector (or to move after the trade form's strategy
choice, or reference something other than the challenge default) — not attempted here, since this
release's scope was the journal itself and the trade-form's own variable rendering already
correctly follows per-trade strategy selection.

**Historical data — not touched.** `trades.note_saw`/`note_why`/`note_unsure` and `emotion_tag`
are no longer written by the form but the columns are kept; their content is never migrated into
`trade_journal` — they answered different questions than the current three, and moving them would
misattribute old answers to new questions that didn't exist when they were written. `js/trades.js:
viewTrade()` renders them under their original question wording (`"What did I see?"`, `"Why enter
now?"`, `"What am I unsure about?"`) in a "Legacy Pre-Trade Notes" block whenever any of the three
are present, alongside a "Trade Journal" block for `trade_journal` rows when they exist — a trade
has one or the other, not both, depending on when it was logged.

**Audit query for the old field set, not run in this environment** (no live DB credentials here,
by design): existing usage of `note_saw`/`note_why`/`note_unsure`/`emotion_tag` can be checked
with
```sql
SELECT COUNT(*) AS total,
       SUM(note_saw IS NOT NULL AND note_saw<>'') AS has_note_saw,
       SUM(note_why IS NOT NULL AND note_why<>'') AS has_note_why,
       SUM(note_unsure IS NOT NULL AND note_unsure<>'') AS has_note_unsure,
       SUM(emotion_tag IS NOT NULL AND emotion_tag<>'') AS has_emotion_tag
FROM trades;
```

**Not attempted in v3.11.0:** `ReviewEngineController` does not yet read `trade_journal` for
anything — this release is capture only. The natural next step is behavioral-review rules over
journal content (e.g. correlating `good_process` against outcome, or in-trade `actions` against
win rate), symmetrical with how `ruleEmotionOutcome()`/`ruleVariableAttribution()` already work
over `emotion_tag`/`trade_variables`, but that's new rule-writing, not part of this release.

#### v3.11.1: Charset Bug + a Missing Table Fataled the Whole Trade List

Two bugs found shortly after v3.11.0 shipped, both fixed the same day:

1. **`2026_09_15_0001_create_trade_journal.sql` omitted `DEFAULT CHARSET=utf8mb4 COLLATE=
   utf8mb4_general_ci`** on both `CREATE TABLE` statements — the one thing every other table in
   this schema specifies explicitly (see `2026_09_13_0001` for the correct precedent). Both tables
   fell back to the server default, `latin1_swedish_ci` on live, not utf8mb4. Reproduced locally
   by starting a MariaDB instance with a latin1 server default and running the exact shipped
   migration against it — it recreates the bug precisely. Fixed by
   `2026_09_15_0002_fix_trade_journal_charset.sql`, a plain `ALTER TABLE ... CONVERT TO CHARACTER
   SET utf8mb4 COLLATE utf8mb4_general_ci` on both tables (safe because both were still empty —
   this is a conversion, not a data migration). `2026_09_15_0001` itself was not edited; it had
   already run and migration files are checksum-locked once applied — this is a correction
   migration, not a rewrite of history. Verified the fix empirically: reproduced the bug against a
   real DB, ran the fix migration, confirmed every column (including the `phase` ENUM) came back
   `utf8mb4_general_ci` and both foreign keys survived the conversion untouched. **Checklist item
   added to §3A "Adding a migration" so this specific mistake doesn't recur.**
2. **`TradeController::getAll()` had no defense against `trade_journal` being unavailable** — a
   missing or broken table (mid-deploy, migration not yet applied, or the charset bug above before
   it was fixed) threw an uncaught `PDOException` from inside the per-trade loop, which fataled
   the *entire* `get_trades` response — not just the journal portion, the whole Trade Log page,
   over data that's ancillary to a trade's core fields. Fixed by wrapping the `trade_journal`/
   `trade_journal_actions` queries in a try/catch: the failure is detected once (not re-attempted
   per trade — that would just repeat a query already known to fail), and every trade in the
   response falls back to `trade_journal: []` rather than taking the request down. Verified
   against a real DB with the table absent entirely: `getAll()` now returns successfully with an
   empty `trade_journal` on every trade; with the table present and populated, behavior is
   unchanged (confirmed no regression). `trade_variables` has the same theoretical exposure
   (`getAll()` has no equivalent guard around it) but was not touched here — not what was reported,
   and that table has shipped and been stable since v3.5.1, unlike `trade_journal` which was still
   fresh enough to hit this exact failure mode in practice.

### v3.12.0: The Journal Was a Winner-Weighted Subset of the Bitfunded Altcoin Challenge

The Bitfunded Altcoin challenge (id 200140743, Starter Two Step, Stage 1, opened 2026-06-15)
executed 58 closed positions between 2026-06-21 and 2026-09-13. The journal only had 17 of
them — everything logged from the point the app existed. That 17-row sample was not
representative: it was +$773.83 at 62.5% win rate, while Bitfunded's own Position History for
the same challenge shows **−$195.32 across all 58 at 39.7%**. Every statistic, chart and review
insight scoped to this challenge had been computed from the winner-weighted subset and was
wrong as a result. `2026_09_17_0002_import_bitfunded_altcoin_trades.sql` reconciled the two:
41 missing rows inserted, 17 existing rows overwritten with Bitfunded's own prices/times/pnl
(the hand-typed originals differed by rounding, e.g. 511.15 vs 511.14). Two data defects
surfaced and were fixed in the same pass: trade 59's `trade_date` was a stale 2026-08-17
against a 2026-08-13 `time_in`, and trade 77 was still marked `Open` though Bitfunded closed it
2026-09-05 for +$112.05.

**Finding for future challenges:** a journal's trade count is not self-verifying — nothing in
this app cross-checks it against the broker's own record, so a gap like this (partial logging
from a fixed start date) sits invisibly until someone thinks to compare totals. **Reconcile any
challenge's trade count against the broker's own history before trusting its statistics,**
especially for challenges that were only partially logged in real time.

**R-multiple, with no per-trade stop-loss on file:** neither the 41 new rows nor the 17
existing ones have a recorded stop-loss price, so R can't be computed the normal way
(`(exit-entry)/stop distance`, as `TradeController::saveTrade()` does for manually-logged
trades). The account's configured risk ladder (0.25% under $9,500, 0.5% $9,500–$10,000, 1.0%
above $10,000) was tried first and rejected — replaying it from a $10,000 starting balance
shows the ladder was **not followed during the July/early-August drawdown**: risk stayed near
1% while the ladder required 0.25% in that balance range, roughly a 4x gap. Deriving R from the
ladder would have understated real losses by about that factor. Used instead: a loss with
`35 <= |pnl| <= 115` is a full stop-out (`r_multiple = -1.00`, `r_multiple_source = 'recorded'`,
matching the convention already on the pre-existing 17 rows); every other trade gets
`risk_amount` = the median `|pnl|` of full stop-outs within a ±7-day window of its `time_in`,
`r_multiple = pnl / risk_amount`, `r_multiple_source = 'estimated'`. 29 of 58 rows landed in
each bucket. See the migration file's header and the v3.12.0 release notes for the full derived
`risk_unit` series.

**Finding for the review engine (not yet built):** the ladder violation above is a real
behavioral signal — risk crept toward 1% exactly during the account's worst stretch, the
opposite of what the configured ladder demanded — but nothing in `ReviewEngineController`
currently checks a trade's `risk_amount` against the ladder tier implied by account balance at
entry; `ruleRiskCreep()` only compares risk against risk (first half of a period vs second),
never against the plan. A future rule should compare `risk_amount` to `risk_per_trade_pct` ×
(balance at entry) and flag sustained divergence, not just an upward trend.

**Schema (2026_09_17_0001):** added `trades.source` (`'manual'`/`'import'`, `NOT NULL DEFAULT
'manual'`) and `trades.r_multiple_source` (`'recorded'`/`'estimated'`, `NULL`). `source`
requires no backfill or code change for existing/future manual saves — the column default
covers them, and `TradeController::saveTrade()` was deliberately left untouched (it never sets
either column, so every trade added or edited through the UI keeps `source='manual'` and
`r_multiple_source=NULL` for free). `ReviewEngineController` and `StatsController` were updated
to track what share of a scoped set has `r_multiple_source='estimated'`, and the three review
insights whose headline number is an R multiple (winrate/expectancy sanity, period trend,
aggressive-vs-reserved) append a caveat to their `detail` text when the underlying set is
majority estimated, so a reconstructed R is never presented with the confidence of a recorded
one.

### v3.12.1: An Exact-Timestamp Duplicate Check Missed a 9-Second Gap

`2026_09_17_0002`'s 41 inserts and 17 updates all ran correctly on live; only its own
post-verify guard failed, and for a reason the guard itself couldn't have anticipated: live
had two more rows than the 2026-09-16 snapshot the §2 id mapping was built from.

- **Trade 80** (BNBUSDT, 2026-09-14) was logged for real after the snapshot. It isn't one of
  the 58 Bitfunded positions (the CSV ends 2026-09-13) and needed no action — it just moved
  the challenge's legitimate row/loss counts from 58/35 to 59/36, which is exactly what
  tripped 0002's guard (hardcoded at `COUNT(*)=58`) even though nothing was actually wrong.
- **Trade 79** (ZECUSDT Long) was *also* logged after the snapshot, by hand, as `time_in
  2026-09-13 06:05:00` — the same closed position as CSV row n=1, whose Bitfunded `time_in`
  is `06:05:09`. Because trade 79 postdated the snapshot, it was never in the §2 mapping, so
  0002 had no way to know it already covered that position. 0002's own duplicate guard for
  new inserts matched on **exact** `(pair, direction, time_in)` — a 9-second gap between a
  hand-typed timestamp and Bitfunded's own was enough to defeat it, so 0002 inserted a
  *second* row for the same position instead of recognizing trade 79 as the existing one.

`2026_09_17_0003_fix_bitfunded_zec_duplicate.sql` was written to fix this: update trade 79 to
Bitfunded's own price/time/pnl for CSV row n=1 (same treatment the original 17 matched rows
got), delete the row 0002 inserted (confirmed empty of `trade_variables` before deletion —
trade 79's 9 rows are the ones that matter and were never touched), and re-scan the whole
challenge for undiscovered near-duplicates. (The scan's own matching rule needed a second
correction after this release shipped — see v3.13.1 below; time proximity alone isn't
sufficient and the version below describes what actually ships.)

**The v3.12.1 release as shipped did not actually apply this fix — see v3.12.2 below.** It
left `2026_09_17_0002` itself unedited on the (wrong) assumption that an already-`failed`
migration is checksum-locked the same way an `applied` one is, and instead tried to mark 0002
`applied` in `schema_migrations` directly from inside `0003`. That doesn't work:
`migrate.php` stops at the first failure in filename order, `0002` sorts before `0003`, and
`0002`'s own guard (`COUNT(*)=58` over the whole challenge) can never pass again now that
trade 80 legitimately exists — so `0003` was never reached, on live or in principle. See
v3.12.2 for the corrected fix and why editing `0002` was safe to do.

**Checklist addition for any future bulk-import migration that dedupes against existing
rows:** never match on an exact `time_in` equality alone — a broker's own execution
timestamp and whatever a trader hand-typed for the same fill routinely differ by
single-digit seconds to a few minutes, and exact equality silently lets a real duplicate
through rather than catching it (the failure mode is a phantom extra trade with no error,
not a loud one). **A `(pair, direction)` + time-proximity window on its own is not
sufficient either** — see v3.13.1 below for why plain time proximity produced its own
false positive, and what a genuine duplicate actually needs to share to be told apart from
a fast, legitimate re-entry.

### v3.12.2: The Retry-Blocking Bug, Fixed Correctly — Failed Migrations Aren't Checksum-Locked

v3.12.1 tried to route around 0002's now-permanently-failing guard by writing a manual
`schema_migrations` row from inside `0003`. That was the wrong move twice over, not just
once: it couldn't work mechanically (0003 is never reached — see v3.12.1 above), and even if
filename order hadn't blocked it, a hardcoded checksum written from a different file would
have gone stale the moment 0002's content changed for any reason, silently corrupting the
tracking row and permanently blocking every migration after it behind a false checksum
mismatch (`migrate.php` treats any `applied`/`baselined` row whose checksum no longer matches
the file on disk as `blocked` and runs nothing further, for any file, until it's resolved).

The actual fix: **`migrate.php`'s checksum lock only applies to `applied`/`baselined` rows.**
A `status='failed'` row is *designed* to be retried after a fix — `migrate.php` sends it
straight back to `$pending` with no checksum check at all (see the `if ($row['status'] ===
'failed')` branch in `migrate.php`). `2026_09_17_0002` was still `failed` on live, so editing
it directly was not a violation of the checksum-lock convention — it was the convention
working as designed. Corrected in place: its post-verify guard now scopes every check to
`source = 'import'` (the exact 58 rows this migration is responsible for) instead of the
whole challenge's row count, so a legitimate trade logged after the fact can never trip it
again. The 41 inserts and 17 updates were already correct and are untouched. `0003` no longer
writes to `schema_migrations` at all — once 0002's corrected guard lets it pass on the next
`mode=run`, `migrate.php`'s own `recordMigration()` marks it `applied` with the real checksum
of the edited file, in normal filename order, no renaming or manual tracking-table surgery
needed.

**Distinguishing the two "don't edit a migration" rules in this codebase, since this release
came from conflating them:** (1) a `failed` migration is retryable/editable by design — fixing
it and letting the runner retry is the intended recovery path, used already by `0002` here and
described generally in §3A. (2) an `applied`/`baselined` migration is checksum-locked — *that*
rule is what `2026_09_13_0004`'s history (§3A "Operational Lessons") and this file's own
`2026_09_17_0002` fix both had to respect. Confusing which state a given migration is actually
in — checking `schema_migrations.status` rather than assuming from a filename or how recently
a release shipped — is the mistake to avoid; v3.12.1 assumed (2) applied to a migration that
was actually in state (1).

### v3.12.3: 0002 Landed Clean — 0003's Own Precondition Was the Last Thing Still Wrong

The v3.12.2 fix worked: the corrected `2026_09_17_0002` applied successfully, and the
Bitfunded Altcoin challenge reached its exact target state — 59 trades, 23W/36L,
`sum(pnl) = -120.08`. On that run, 0002's idempotent `INSERT ... WHERE NOT EXISTS` for CSV
row n=1 (ZECUSDT Long) found the duplicate row already sitting there from the very first
2026-09-17 attempt and correctly skipped re-inserting it — no second duplicate was created.
That's also exactly why `0003` then failed: its pre-flight guard hardcoded an expectation of
**two** ZECUSDT rows in the 06:00:09–06:10:09 window (the shape of the original incident,
observed once), and lived reality now had **one**. The guard did its job — it stopped rather
than mutating anything against a precondition that no longer held — but the file had nothing
left to do and needed to say so instead of failing.

Note for the record: `0002`'s own 17-id `UPDATE` list (49, 51, 54, 57, 58, 59, 60, 62, 63, 65,
66, 71, 72, 73, 74, 77, 78) has never included id 79, so the exact mechanism by which id 79
ended up holding Bitfunded's own figures with `source='import'` on this run is not fully
reconstructable from the migration files alone — it's recorded here as an observed fact
reported directly off live, not a re-derivation. `0003` was rewritten accordingly to *detect*
which of two states is actually live rather than assume the original incident's exact shape
forever: one ZECUSDT row in the window and it already asserts as id 79 with Bitfunded's
figures and `source='import'` → confirms that specific claim and does nothing further; two
rows → repairs whichever one actually has the 9 `trade_variables` (attribute-based, not
`id=79`-hardcoded, since that assumption already proved fragile once) and deletes the other;
anything else → fails loudly rather than guessing. Both the `UPDATE` and `DELETE` become true
no-ops in the already-fixed branch (their `WHERE` clauses require `@already_fixed = 0`), so
this file is now safe to leave in the migration queue indefinitely and safe to re-run on a
fresh environment where the original bug could still reproduce (0002's dedup precision itself
was not changed — only its post-verify guard was, in v3.12.2).

### v3.13.0: Fees, a Five-Week-Stale Baseline, and a Stored Balance That Could Never Have Been Caught

Three defects on the Bitfunded Altcoin challenge (id 6), all traceable to the same root
cause: a number that should have been computed was instead typed in once and left alone.

**1. `starting_balance` was 9,274.00, not the real 10,000.00 every Bitfunded account
starts at.** That figure was the account's live equity on 2026-08-10, the day this
challenge record was created — accurate for a journal that only held forward-looking
data from that point on. The v3.12.0 import extended the journal back to inception
(2026-06-21), so from that release forward the challenge was scoped against a baseline
that undercounted five weeks of real trading by exactly the amount already lost before
the record existed. Corrected to 10,000.00 by `2026_09_17_0005`.

**2. Fees were 0 on 41 of the 59 rows.** Bitfunded's Position History (the source for the
v3.12.0 import) doesn't publish per-position fees; the account's transaction log does, and
every fee timestamp in it matches a position's open or close time to the second. Backfilled
from `bitfunded-altcoin-fees.csv`, matched on `(challenge_id, pair, direction, time_in)` —
not trade id, which by this point had been reassigned across three prior migrations and
was not something a new one should trust blind (the same lesson `2026_09_17_0003` already
had to learn once). Funding fees (a net 6.6369) are **not** split across trades — the
transaction log labels them `USDT`, not by symbol, and several dates have multiple funding
entries sharing one timestamp while positions overlap in time, so attributing them to a
specific trade would mean guessing. Applied once as `challenges.funding_adjustment`
instead.

**Fees exceed trading losses on this account: $144.75 in total cost (138.12 in trade fees
+ 6.64 funding) against $120.08 of trading loss** (corrected from an initially-reported
$120.07 — see v3.13.2 below for the one-cent gap between two valid derivations of that
figure). After fees, win rate falls from 39.0%
to 33.9% and three winning trades become losers. Any performance figure computed from
`pnl` instead of `net_pnl` — expectancy, profit factor, anything the review engine
reports — overstates the edge on this account. `net_pnl`, not `pnl`, is the correct basis
for all of those; this was already the convention everywhere in this codebase (`pnl` is
never summed for a performance claim, `net_pnl` always is) but is worth stating plainly
now that the gap between the two is this large.

**3. `challenges.current_balance` was a stored column nothing ever recalculated — this is
what let #1 persist unnoticed for five weeks.** It fed the dashboard balance card
directly, so the card read $9,108.98 against a real $9,735.17 (a $626 error — see v3.13.2
below for the exact cent) and it fed
the drawdown calculation, so the drawdown bar showed 0.0% against a real ~2.6%. The
sidebar's own JS made this worse independently: `dashboard.js` computed
`account_balance + net_pnl`, adding the challenge's total realised P&L a second time on
top of a balance that (once correct) already includes it. **Dropped, not kept-and-rewritten**
(`2026_09_17_0004`) — every consumer now derives balance on the fly via
`helpers.php::enrichChallenge()` (see the `challenges` table note above), so there is no
longer a column for anything to silently drift out of sync with, and the dashboard's
double-count is fixed by simply not having a second number to add.
**General lesson: prefer a value derived from trades over one stored on the challenge row
for anything that can be computed from trades** — a stored figure only stays correct as
long as every future code path that could change its inputs remembers to update it, and
this one didn't, for five weeks, on the one number that measures distance to account
failure.

**Prop firm criteria as amounts, not just percentages:** Bitfunded states Stage 1/2/3
targets as currency amounts that differ by stage ($800 profit target / $1,000 max loss for
Stage 1; different figures for Stage 2; no profit target for a funded account) — not as
percentages of starting balance that happen to be stable across stages. `profit_target_amt`
/ `max_loss_amt` (`2026_09_17_0004`) hold those amounts; `profit_target_pct` /
`max_drawdown_pct` are kept, not replaced, since plenty of other prop firms genuinely state
their criteria as percentages — but wherever an amount is on file, `enrichChallenge()`
treats it as the source of truth and overrides the pct field with the amount expressed as
a percentage of `starting_balance`, rather than trusting a percentage that was never the
firm's actual rule to begin with.

**Engine/charset:** `challenges` had been MyISAM/latin1 since before this schema had a
migration history — the only table on the old engine, and the reason `trades.challenge_id`
never had a foreign key (a MyISAM table can't be an FK parent). Converted to InnoDB/utf8mb4
in `2026_09_17_0004`; the FK itself is added by a separate, deliberately-last file
(`2026_09_17_0006`) with its own orphan-check guard, so that if an orphaned
`trades.challenge_id` value exists on a given environment, that fact is reported (the guard
names exactly what to query to find it) rather than the constraint being forced past it or
the schema/data fixes in the earlier files being blocked by it.

Scope: this release only touches challenge 6. Challenges 4 (TradeFi) and 5 (BTC) have the
same `starting_balance` and missing-fees defects and are not fixed here — the derivation
and amount-preference logic that shipped in this release is shared code and applies to
them too (as it should — it's a general bug fix, not something that should special-case
challenge 6), but no migration in this release writes to their rows.

### v3.13.1: Time Proximity Alone Can't Tell a Duplicate From a Fast Re-Entry

`2026_09_17_0003`'s tolerance audit (added in v3.12.1, the fix that actually shipped in
v3.12.2/v3.12.3) flagged a false positive on live: trades 87 and 88, both `BTCUSDT Long`,
entered at `2026-08-20 11:42:45` and `11:47:10` — four and a half minutes apart, well
inside the `±5 minute` window the audit was checking. Both are genuine, independent
positions, both present in Bitfunded's own Position History (CSV rows n=16 and n=17 from
the original 58-position import) — not a duplicate. The audit did exactly what it was
written to do; **what it was written to check for was wrong.** Time proximity on its own
cannot distinguish a duplicate (the same execution recorded twice) from a legitimate rapid
re-entry (two different executions that happen to be close together) — and a trader
re-entering within minutes of closing, or even opening a second position on the same pair
in the same direction shortly after the first, is an entirely ordinary thing to do, not an
edge case.

**What actually distinguishes a duplicate:** a true duplicate — the ZEC case `0003` exists
to fix — shares not just `(pair, direction)` and time proximity but the **exact same
`entry_price` and `pnl`**, because it's one real execution that got written to two rows,
not two different trades that happen to share a symbol and a nearby timestamp. The audit
now requires all four: `pair`, `direction`, `time_in` within the window, **and**
`entry_price` **and** `pnl` matching exactly. Trades 87/88 have different `entry_price`
(71962.10 vs 71968.30) and different `pnl` (+0.74 vs -0.43) — the corrected audit does not
flag them.

`2026_09_17_0003` was still `status='failed'` on live at the time of this fix (this exact
false positive is what failed it), so per the same rule v3.12.2 already established —
editing a `failed` migration is the retry path the runner is built for, not a violation of
the checksum-lock convention — the fix was made directly in the file rather than routed
around it. Its state-detection design from v3.12.3 (one ZEC row already correct → no-op;
two → repair) is unchanged; only the trailing audit's matching rule was wrong.

**Checklist correction:** the v3.12.1 entry above ("match on `(pair, direction)` plus a
tolerance window on `time_in`") is superseded — that rule alone produces false positives
on any account that re-enters a pair quickly, which is normal trading, not an anomaly. A
duplicate-detection check for a bulk-import migration needs `(pair, direction)` +
time-window **and** `entry_price` **and** `pnl` matching before it's safe to treat two rows
as the same execution.

### v3.13.2: A One-Cent Gap Between Two Valid Derivations of the Same Figure

`2026_09_17_0005`'s pre-flight guard asserted `ROUND(SUM(pnl),2) = -120.07` for challenge
6. Live's actual `SUM(pnl)` is **-120.08** — the guard failed before any `UPDATE` ran (pure
pre-flight, so nothing had mutated). Not a data error: `-120.07` came from *deriving* the
figure as `(account total -264.8228) - (costs 144.7528)`, two numbers that were each
already rounded to 4 decimal places in the source reconciliation, rather than from summing
the 59 `pnl` rows directly. `-120.08` is what a direct sum of the real numbers gives —
confirmed against live, not re-derived from the fees CSV — and is treated as the fact
per the standing rule for this whole thread: where a briefing figure and live data
disagree, live data wins.

Two things followed from this, not just a guard-number edit:

1. **The 59 fee `UPDATE`s now write `net_pnl = pnl - <fee>`, referencing each row's own
   stored `pnl` column, not a literal pnl value copied from
   `bitfunded-altcoin-fees.csv`.** That CSV's own `pnl` column sums to -120.07 — a whole
   cent different from what's actually in `trades.pnl` on at least one of the 59 rows.
   Hardcoding the CSV's literal would have made `net_pnl` wrong on whichever row that is;
   referencing the column instead guarantees `net_pnl` is always *(whatever pnl is
   actually stored)* minus its new fee, correct regardless of which side of that gap any
   individual row falls on and without needing to identify which row it is.
2. **The derived balance changes accordingly:** `net_pnl` sums to
   `-120.08 - 138.1159 = -258.1959` (not `-258.1859`), so the derived balance is
   `10000 - 258.1959 - 6.6369 = 9735.1672`, not `9735.1772`. **Bitfunded reports
   9735.1772 — a one-cent residual remains between this account's derived balance and
   Bitfunded's own reported figure.** This is not forced to match by adjusting
   `funding_adjustment` or any individual fee; a penny of unexplained rounding somewhere
   in Bitfunded's own reporting chain (likely the same kind of intermediate-rounding gap
   that produced the `-120.07` vs `-120.08` difference above) is a smaller, more honest
   error to carry forward than papering over it with an invented adjustment. The dashboard
   balance card should read **$9,735.17**, not $9,735.18.

General lesson: **a figure derived by subtracting two independently-rounded aggregates is
not guaranteed to equal the same figure derived by summing the underlying rows directly,
even when both derivations are individually "correct."** Prefer summing the rows — it's
the one with no intermediate rounding step to introduce drift — and don't force two
independently-rounded totals to reconcile to the cent; document the residual instead.

### v3.13.3: A Fourth Hand-Typed Timestamp, Same Pattern as the ZEC Duplicate

After v3.13.2, live's `SUM(fees)` for challenge 6 was **138.0490** against the expected
**138.1159** — a **0.0669** gap. Cause: trade 80 (BNBUSDT, manually logged, the same
post-snapshot trade discussed in v3.12.1) carried a hand-typed `time_in` of
`2026-09-14 06:08:00`, while Bitfunded's own record is `06:08:19`. `2026_09_17_0005`'s fee
`UPDATE` for this row matches on `(challenge_id, pair, direction, time_in)` — same as
every other row, deliberately, per the v3.13.0 design — and a 19-second gap was enough to
miss it. The `UPDATE` matched zero rows, silently, no error: trade 80's fee stayed at
whatever had been hand-entered before (3.80) instead of Bitfunded's 3.8669. All other 58
rows matched the CSV exactly.

This is the fourth time an off-by-seconds hand-typed timestamp has caused a problem on this
account (trade 59's `trade_date`/`time_in` mismatch and trade 77's stuck `Open` status in
the original v3.12.0 import; the ZEC duplicate in v3.12.1–v3.13.1; now this). **Every one of
them was a silent miss, not a loud error** — an `INSERT ... WHERE NOT EXISTS` that
wrongly proceeds, or an `UPDATE ... WHERE` that matches zero rows, neither one raises
anything migrate.php's runner can see. A guard has to be written to look for exactly this
shape of problem; nothing catches it by accident.

Fixed in `2026_09_17_0005` by correcting trade 80's `time_in`/`time_out` to Bitfunded's
own values *before* the fee `UPDATE`s run, rather than special-casing that one `UPDATE`'s
`WHERE` clause to also accept the stale timestamp — trade 80 should carry Bitfunded's own
time regardless, and once corrected the existing match key finds it like every other row.
A pre-flight guard condition was added at the time asserting trade 80's known-stale state
before the fix runs. **That guard condition was itself wrong — see v3.13.4 below, which
also corrects the `net_pnl` figure this section originally reported (`-258.1959`, superseded
by `-258.1909`).**

**Trade 80 is now the last row in this challenge with no remaining hand-typed timestamp
discrepancy against Bitfunded's own record.** Nothing else in challenge 6 is known to carry
one as of this release.

### v3.13.4: A Guard That Can Only Pass Once, and a Half-Cent of Real Precision

Two independent problems, found together because v3.13.3's data work actually succeeded on
live (trade 80 corrected to `06:08:19`, fee `3.8669`, `SUM(fees)` exactly `138.1159`) but
the file still reported `failed`.

**1. The pre-flight guard blocked its own successful result.** `2026_09_17_0005`'s
pre-flight guard asserted trade 80 was still at its pre-fix timestamp
(`time_in = '2026-09-14 06:08:00'`) before allowing the fix to run. That's backwards for a
guard meant to protect a *retryable* file: the first run legitimately found trade 80 stale,
passed, and fixed it — then failed later at the post-flight check (problem 2, below) and got
marked `failed` as a whole file. On retry, `migrate.php` reruns the entire file from the
top, including the pre-flight guard — which now finds trade 80 *already* fixed and rejects
that as if it were drift, even though the timestamp-correction `UPDATE` two statements later
has no `time_in` condition in its own `WHERE` clause and would have re-applied harmlessly
either way. **This is the fourth time in this release chain a guard encoded "hasn't been
fixed yet" instead of "is in a state I can safely proceed from,"** and the fourth time it
blocked a legitimate retry (see v3.12.1/v3.12.2, v3.12.3, v3.13.1 for the first three, each
a variation on the same mistake). Fixed by narrowing the guard to an identity check — trade
80 is still `BNBUSDT`/`Long` under challenge 6 — dropping the timestamp condition entirely,
since nothing downstream needs it to hold.

**General rule, worth stating plainly since it's recurred four times: a pre-flight guard in
a retryable migration must accept every state the file itself can legitimately leave
things in, not just the state before it has ever run.** If a guard can only pass once, it
will eventually block a real retry — write it to check identity/integrity preconditions
that remain true regardless of whether the fix already happened, not "this hasn't been
touched yet."

**2. `SUM(net_pnl)` is `-258.1909`, not the `-258.1959` (`-120.08 - 138.1159`) the post-flight
guard asserted.** Real precision, not an error: `TradeController::saveTrade()` stores `pnl`
at 4-decimal precision (`round($pnl, 4)`) for a manually-entered trade, and trade 80's is
`-98.6850` — not the `-98.68` `bitfunded-altcoin-fees.csv` displays at 2 decimals.
`net_pnl = pnl - 3.8669` (2026_09_17_0005's own formula, unchanged since v3.13.2 — see that
section for why it references the column rather than a literal) correctly evaluates to
`-102.5519` from the real stored value, not `-102.5469` from the CSV's rounded one. Same
class of gap as the `-120.07`/`-120.08` difference in v3.13.2 — a display-rounded reference
figure disagreeing with the fuller-precision value actually in the database — resolved the
same way: **trust the stored column, correct the guard, not the data.** Derived balance is
therefore `10000 - 258.1909 - 6.6369 = 9735.1722` — 0.0050 off Bitfunded's own reported
`9735.1772` (a smaller residual than v3.13.2's `9735.1672` estimate, not a coincidence:
using trade 80's real precision moved the derived figure closer to Bitfunded's, which
presumably also computes from full-precision values internally). Documented as a residual,
not forced to match.

No other statements in `2026_09_17_0005` changed. `2026_09_17_0006`'s own guard (checking
for orphaned `trades.challenge_id`, not for "hasn't run yet") was already correctly
written and needed no change — it was only ever blocked by `0005` sorting first.

### v3.14.0: The Bitfunded Paste Importer — Execution Data Should Never Be Typed

Thirteen migration files and nine deploy cycles (v3.12.0 through v3.13.4) were spent
importing one account's history by hand, from two CSVs a person transcribed off
Bitfunded's UI. Four silent data defects were found along the way — trade 59's wrong
`trade_date`, trade 77 stuck `Open`, the ZEC duplicate, trade 80's timestamp off by
nineteen seconds — **all four in the 17 rows that were originally typed manually, none
in the 41 that came from broker data.** The conclusion isn't "be more careful." It's that
execution data should never be typed at all. v3.14.0 is the general tool that replaces
hand-transcription with parsing Bitfunded's own tables directly, so this class of defect
can't recur on the next challenge the way it did on this one.

#### The division of responsibility

The core design decision, and the one every other choice in this release follows from:
two moments, two sources, no field appears in both lists.

**Before the trade — the trader enters, in the app (`trade-modal.php`):** strategy (picks
which gate/tag variables render), gate and tag answers (only knowable at analysis time),
**stop loss** and **take profit** (intent, not outcome — the broker never records either),
the nine-state emotion grid (must be captured live; retrospective self-report is
unreliable), setup grade A/B/C (a judgement of the setup, not the result), "what would
have to happen for me to be wrong?" (pre-commitment).

**After the trade closes — the importer fills, from Bitfunded (`BitfundedImportController`):**
`time_in`/`time_out`, `entry_price`/`exit_price`, `lot_size` (Position History's
Liquidation Qty), `pnl` (Realized PnL), `fees` (Position History's own Fee column — see
"Fee source" below), `exit_reason` (Position History's own label), `net_pnl` (computed:
`pnl - fees`), `result` (derived from `pnl`'s sign), and `challenges.funding_adjustment`
(Transaction History → summed `Funding Fee` rows, challenge-level, never per-trade).

**A trade with no pre-entry record is itself data** — an imported position matching no
existing setup row means the checklist wasn't worked before entering. The importer does
not hide this: a genuinely new match gets `source='import'` and every strategy/psychology
field `NULL`, not a guessed value. The 41 historical imports from v3.12.0 are exactly this
case, and stay exactly this case after this release — the importer doesn't retroactively
invent pre-entry data for them, because there isn't any to recover.

**Enforced structurally, not just by convention:** `trade-modal.php` no longer has inputs
for date in/out, time in/out, entry price, exit price, lot size, or fees at all — there is
no field left for a trader to type an execution value into. `TradeController::saveTrade()`
was found, while building this, to still unconditionally overwrite every one of those
columns (plus `pnl`/`net_pnl`/`r_multiple`) on **every save**, including edits that only
touched strategy/grade/notes on an already-imported trade — meaning the very next
pre-entry-field edit on any of the 59 Bitfunded Altcoin trades would have silently zeroed
out its imported prices, times, and P&L. Not a live incident (caught here, not reported by
the user), but the identical failure shape — a real value overwritten by an absent one,
no error — as the four defects this release exists to stop. Fixed by removing execution
columns from `saveTrade()`'s `$cols` entirely: the `UPDATE`'s `SET` clause simply doesn't
mention `time_in`, `entry_price`, `pnl`, `r_multiple`, etc. anymore, so there is nothing
left for a pre-entry-only save to clobber. (Incidental cleanup in the same change: the
`daily_limits` write at the end of `saveTrade()` depended on a `$net` variable that no
longer exists after this — removed rather than faked, since a grep of the whole codebase
shows `daily_limits` was never read anywhere, only ever written here. Also removed:
`fillTradeFromCalc()` in `index.php`, an already-orphaned function — no caller anywhere in
the app — that referenced both the deleted execution fields and calculator element IDs
that didn't match the current `calculator.php` either; it was dead before this release and
is fully dead now.)

#### Matching rule, and why proximity alone is insufficient

`pair` + `direction` + `entry_price` + `pnl` exactly, with `time_in` within **±10 minutes**.
`entry_price` and `pnl` are not optional narrowing — they're the actual duplicate
signature. A ±5-minute `(pair, direction)`-only window was tried first (the v3.12.1
briefing's original spec for the ZEC-duplicate fix) and produced a confirmed false
positive on live data: `BTCUSDT Long` at `2026-08-20 11:42:45` (+0.74) and `11:47:10`
(−0.43) are two genuine, independent re-entries, 4.5 minutes apart, both present in
Bitfunded's own Position History — not a duplicate (see v3.13.1). A true duplicate is one
execution recorded twice, so it shares its exact `entry_price` and `pnl`, not just a
symbol and a nearby timestamp; a fast re-entry is two different executions that happen to
be close together, which is ordinary trading, not an anomaly. `BitfundedImportController::
matchAll()` requires all four before calling two rows the same trade.

Three outcomes, never a silent guess: **new** (no candidate at all — insert,
`source='import'`, every strategy/psychology field `NULL`); **matched** (exactly one exact
candidate — update execution fields only, explicitly never touching `trade_variables`,
`emotion_tag`, `setup_grade`, the three note columns, `stop_loss`, `take_profit`,
`strategy_id`, screenshots, or the row's `id`); **needs attention** (more than one exact
candidate, or a near-match — same pair/direction/time-window, but `entry_price` or `pnl`
differs — with zero exact candidates). Attention rows are never written by `confirm()`;
they're reported and skipped, and the reconciliation math (below) excludes them from the
projected post-import balance rather than guessing which side is right.

**Idempotency, verified by construction, not by a one-off test:** every `INSERT`'s `WHERE
NOT EXISTS`-equivalent is the matching rule itself — a row already correctly imported now
matches exactly (`entry_price`/`pnl`/time-window all equal), so a second paste of the same
Position History table finds it as **matched**, not **new**, and the `UPDATE` sets it to
the same values it already has. Re-running the same paste can never duplicate a row; it
converges to a no-op. This is the same property `2026_09_17_0002`'s idempotent `INSERT ...
WHERE NOT EXISTS` had for the one-off migration, generalized into the ongoing tool.

#### Fee source: Position History, not the transaction log

Position History's own Fee column is the source for `trades.fees` — **not** the
Transaction History log. This was verified before the importer was built: Position
History's Fee for each of BNB/ZEC/LIT/TRX exactly equals opening + closing fee for that
position as recorded in the transaction log (BNB −3.8669, ZEC −1.5698, LIT −0.8382, TRX
−9.5545). Reconstructing fees from the transaction log — summing individual fee entries
per position — is unnecessary work solving an already-solved problem, and riskier: funding
entries in that same log are labelled `USDT` with no symbol, and positions overlap in time
on several dates, so per-trade attribution there is genuinely impossible for funding and
would invite exactly that kind of guessing for fees too. Position History's Fee is a
negative display value (a cost); `trades.fees` is a positive magnitude, so the parser
takes `abs()` once, at parse time (`bf_parse_num()` + `abs()` in `bitfunded_parser.php`),
not per call site.

Transaction History (Box 2, optional) is used for exactly two things and nothing else:
`SUM(Amount)` where `Type = 'Funding Fee'` (negated once at parse time into
`challenges.funding_adjustment`'s positive-cost-magnitude convention — see v3.13.0 for why
that column is a positive magnitude subtracted in the balance formula), and the most
recent `Balance` value, for the §6 reconciliation check. Order History and Transaction
Details are different tabs with a different column layout and are not read by this
importer; both parsers reject a wrong-shaped paste structurally (wrong column count, or a
Direction/Type value that doesn't match the expected set) rather than by recognizing the
other tabs by name, since their exact layouts aren't known to the app.

#### Reconciliation

`derived_balance = starting_balance + SUM(net_pnl closed, post-import) - funding_adjustment`,
compared against Bitfunded's own most-recent `Balance` (or a manually entered figure),
shown in Preview before anything is written. Flagged above $1 — sub-cent residuals are
expected, not a bug (see v3.13.2/v3.13.4: the journal stores P&L at 4-decimal precision,
Bitfunded displays 2, and even Bitfunded's own reported balance has carried an
unexplained half-cent gap against this account's fully-precise derivation). **This check
is what would have caught the original $626 `starting_balance` error on the day it
happened, instead of five weeks later** — it's computed the same way `enrichChallenge()`
computes `current_balance` (v3.13.0), just run against the *projected* post-import state
before confirming, not the live state after the fact.

#### What this release deliberately does not do

`r_multiple` and `risk_amount` appear in neither side of the division-of-responsibility
table above, and the importer never touches them — not for new rows (left `NULL`, since
there's nothing to compute them from without a stop-loss on file) and not for matched rows
(never included in the `UPDATE`'s `SET` clause, so whatever's already there — including
the v3.12.0 risk-unit-derived values on the original 59 Bitfunded Altcoin trades — is
preserved untouched). This means a **future** trade that has a real `stop_loss` recorded
pre-entry and then gets matched by this importer will **not** automatically get an
`r_multiple` computed from that stop distance, even though the data to compute it now
exists. Flagged here deliberately rather than invented silently: this is a real gap, not
an oversight being hidden, and a reasonable follow-up for a later release if wanted.
**Partially closed in v3.14.1 — see that section below:** matched rows now get this
computed when the existing trade already has a `stop_loss`; new rows still can't, since
this importer never sets `stop_loss` on an insert.

#### Statistics: exit_reason breakdown

`StatsController::getStats()` adds `by_exit_reason` (count, avg R, total R, net P&L per
label), same closed-trades-only convention as every other breakdown on that page.
Motivation: this account's realised payoff is 1.49 against the FSA rule's stated minimum
of 1:3. Whether that gap means targets set too close or positions closed early isn't
visible in payoff alone — the ratio of `Stop Loss` to `Manual Closing` to target-hit exits
in this breakdown is what starts to answer which. `AVG`/`SUM(r_multiple)` return `NULL`
for a reason bucket with no `r_multiple` recorded on any of its trades (SQL's normal NULL
handling) rather than `0` — a missing R is absence of information, not a recorded zero,
same convention this codebase already applies to `session`, `emotion_tag`, and
`r_multiple_source`.

### v3.14.1: Position History Is a Card Layout, Not a Table — the Paste Format Was Never Checked

v3.14.0's Position History parser expected 13 tab-separated columns, on the assumption
that Position History copies out of the browser the same way an HTML table does
(Transaction History's actual behavior — see below). **That assumption was never checked
against a real paste.** Position History is a **card layout**: each closed position copies
as a block of plain lines, a label on one line and its value on the line after it. A real
paste is one column, not thirteen, and every real paste was rejected with "expected 13
columns... found 1." The rejection message itself was working exactly as designed — loud,
specific, naming the right tab — only the expected format inside it was wrong.

**Transaction History (Box 2) is unaffected — it really is a table.** Copying it out of
the browser still produces tab-separated rows with a `Type / Transaction / Amount / Time /
Balance` header, exactly as v3.14.0 assumed, and `parseTransactionHistory()` did not need
to change. **The two Bitfunded tabs paste in fundamentally different shapes and need
different parsers** — this wasn't true of the original design and is the central lesson of
this release.

#### The verified format

From a live paste of two positions (this account's BNBUSDT and ZECUSDT trades, both
already in the database — see "Verification" below):

```
BNBUSDT Perpetual
Long
5X
Isolated
Close All
Stop Loss
Opening Time
2026-09-14 06:08:19
Average price
723.41 USDT
Realized PnL
-98.68USDT
Liquidation Qty
6.75 BNB
Liquidate Date
2026-09-15 20:49:24
Exit Price
708.79USDT
Realized PnL%
-10.10%
Fee
-3.86690000 USDT
ZECUSDT Perpetual
Long
5X
Isolated
Close All
Stop Loss
Opening Time
2026-09-13 06:05:09
...
```

Per position: contract line (`<SYMBOL> Perpetual`) → `pair`; direction (`Long`/`Short`);
leverage (`5X` — no column, discarded); margin mode (`Isolated`/`Cross` — discarded);
`Close All` (a live-action button — discarded, and **not always present**); an exit-reason
line (`Stop Loss`, `Manual Closing`, and possibly other values not yet seen — an open set,
**not always present**, never mapped to an enum); then label/value pairs — `Opening Time`
→ `time_in`, `Average price` → `entry_price`, `Realized PnL` → `pnl`, `Liquidation Qty` →
`lot_size`, `Liquidate Date` → `time_out`, `Exit Price` → `exit_price`, `Realized PnL%` →
read and discarded (derivable), `Fee` → `fees`.

Value formats are inconsistent and all have to be handled: `723.41 USDT` (space),
`708.79USDT` (no space), `-98.68USDT` (no space, signed), `-3.86690000 USDT` (space, eight
decimals), `6.75 BNB` (the position's own asset, not USDT), `-10.10%` (percentage). The
existing `bf_parse_num()` (strip everything except digits/`.`/`-`) already handled every
one of these without modification — it was never the number parsing that was wrong, only
the column-shaped assumption wrapped around it.

**Sign conventions**, unchanged from v3.14.0: `pnl` stored as given (signed); `fees` stored
as a positive magnitude (`abs()` of Position History's negative Fee display); `net_pnl =
pnl - fees`.

#### Parsing: by label, not by line position

`parsePositionHistory()` (`includes/bitfunded_parser.php`) no longer indexes into fixed
line offsets at all. A line matching `/^([A-Za-z0-9]+)\s+Perpetual$/i` starts a new
record; everything up to the next such line belongs to it. Within a record: the label set
(`Opening Time`, `Average price`, `Realized PnL`, `Liquidation Qty`, `Liquidate Date`,
`Exit Price`, `Realized PnL%`, `Fee`) is matched by exact (case-insensitive) line text
wherever it occurs, and the line immediately after a matched label is its value —
irrespective of where in the block that label happens to sit. Everything left over after
labels, their values, the contract line, and the direction line is checked against leverage
(`/^\d+(\.\d+)?x$/i`) and margin mode (`/^(isolated|cross)$/i`) patterns and discarded if it
matches either, then against a literal `Close All` and discarded if it matches that. **What
remains is the exit reason** — since Bitfunded's set of exit-reason values isn't fully
known, it's identified by elimination rather than enumerated, and its absence (zero
leftover lines) is accepted, not an error. More than one leftover line is a parse failure
naming the ambiguous lines, rather than guessing which one is the real exit reason.

This means `Close All`'s presence/absence, the exit reason's presence/absence, and (within
reason) label order don't matter — only the well-known label text and the two bounded
enums (margin mode; leverage's numeric pattern) are relied on structurally.

#### Verification against known data

The two positions in the sample above are already live in the database and were checked
exactly:

| | BNBUSDT | ZECUSDT |
|---|---|---|
| `time_in` | 2026-09-14 06:08:19 | 2026-09-13 06:05:09 |
| `time_out` | 2026-09-15 20:49:24 | 2026-09-13 11:31:43 |
| `entry_price` | 723.41 | 1135.75 |
| `exit_price` | 708.79 | 1081.63 |
| `pnl` | −98.68 | −95.79 |
| `fees` | 3.8669 | 1.5699 |
| `lot_size` | 6.75 | 1.77 |
| `exit_reason` | Stop Loss | Stop Loss |

`bitfunded_parser.php`'s self-test (`php bitfunded_parser.php`, standalone CLI — guarded so
it never runs when the file is `require_once`'d by `BitfundedImportController`) parses
this exact two-position block and asserts every value above, plus edge cases for a block
missing `Close All`, a block missing the exit-reason line entirely, and rejection of a
Transaction-History-shaped (tab-separated) paste. **v3.14.0 shipped without this
self-test** despite its own header comment claiming one existed — its synthetic
column-shaped test data would have caught nothing here anyway, since the bug was in the
shape assumption, not the field mapping. This release's self-test is built from real,
already-verified data specifically because of that: synthetic data can't catch "this isn't
what a real paste looks like."

**Live acceptance test (cannot be run from this environment — for Acrob to run after
deploy):** paste challenge 6's full Position History into Box 1, click Preview. Expect
**59 matched, 0 new, 0 needs attention** (an idempotency check — this data is already
correct on live, so a correct parser should match every row, not insert or flag anything).
Confirm, then verify `SUM(fees) = 138.1159`, `SUM(net_pnl) = -258.1909`, 59 rows,
`trade_variables` count unchanged at 135, and `exit_reason` populated on all 59. Paste
Transaction History into Box 2 — funding total should read −6.6369. Paste an Order History
table — must still be rejected with a clear message.

#### r_multiple / risk_amount: closing part of the v3.14.0 gap

v3.14.0 flagged, but deliberately left open, that `r_multiple`/`risk_amount` were never
computed by the importer even once `stop_loss` existed on a matched row (see "What this
release deliberately does not do" above). This is the reason `stop_loss` moved into the
pre-entry form in the first place — without it ever being used, R stays estimated forever
and the planned-vs-realised R comparison can't be computed.

`BitfundedImportController::confirm()` now computes, **only for a `matched` row whose
existing trade already has a `stop_loss` on file**:

```
risk_per_unit = ABS(entry_price - stop_loss)
r_multiple    = (exit_price - entry_price) / risk_per_unit     -- Long
              = (entry_price - exit_price) / risk_per_unit     -- Short
risk_amount   = risk_per_unit * lot_size
r_multiple_source = 'recorded'
```

added to that row's `UPDATE ... SET` only when `stop_loss IS NOT NULL` and
`risk_per_unit > 0` — the column is omitted from the statement entirely otherwise, so a
matched row with no stop on file is left exactly as untouched as every other execution-only
field, and an existing *estimated* `r_multiple` (the v3.12.0 risk-unit-derived values on
the original 59 Bitfunded Altcoin trades) is never overwritten by this path. A **new** row
is never given a `stop_loss` by this importer (stays `NULL`, per the v3.14.0
division-of-responsibility table), so this can never apply to an insert — only a trade that
already existed with a stop before being matched. **None of the 59 historical Bitfunded
Altcoin trades has a stop-loss on file, so this release does not retro-derive any of
them** — the formula only takes effect going forward, the next time a trade is created with
a real stop and later matched by an import.

### v3.14.2: A Trailing Non-Breaking Space Defeated Exact Label Matching

A real paste of challenge 6's Position History failed with "more than one unrecognized
line" naming the exit-reason line and the `Realized PnL%` line together — meaning
`Realized PnL%` wasn't being recognized as a known (discard) label at all, even though it
was in `parsePositionHistory()`'s label map from the start.

**Cause: PHP's `trim()` does not strip a non-breaking space (U+00A0).** A browser copy of a
styled card can carry one in place of, or alongside, an ordinary space — trailing
`Realized PnL%` with an NBSP survives `trim()` and lowercasing as `"realized pnl% "` (note
the trailing space), which no longer equals the `'realized pnl%'` key in the label map, so
the line fell through to "unrecognized" and collided with the genuine exit-reason line,
tripping the ambiguous-leftover guard. This is exactly the class of invisible-character
artifact the exact-match label design (added in v3.14.1 specifically to avoid a
prefix-matching accident) had no defense against, since it assumed `trim()` fully
normalized whitespace.

**Fix:** `bf_clean_line()` (`includes/bitfunded_parser.php`) collapses non-breaking space
(U+00A0), zero-width space (U+200B), and BOM/zero-width-no-break-space (U+FEFF) to a plain
space, then collapses any run of whitespace to one space and trims — applied to every line
of Position History as it's read, and to every cell of Transaction History via
`bf_split_line()` (which routes through the same function), since the same artifact class
could in principle hit Box 2 too. This is a normalization fix, not a matching-strategy
change: label lookup is still a single exact-string hashmap lookup — `array_key_exists()`
against `$LABELS` — never a prefix or substring check, so a label appearing as a prefix of
another (`Realized PnL` / `Realized PnL%`) still cannot cross-match regardless of which one
is scanned first; the self-test added below exercises exactly that by parsing a block with
the two lines in swapped order and asserting `pnl` lands on `-98.68`, never `-10.10`.

**Self-test additions:** a block with `Realized PnL%` placed *before* `Realized PnL`
(catching a prefix bug in either direction), and a second block built from the first by
appending a literal U+00A0 to the `Realized PnL%` line (reproducing the exact live
failure). Both assert the row still parses to a single result with `pnl = -98.68`, never
`-10.10`.

### v3.14.3: v3.14.2 Didn't Fix It — a Diagnostic Instead of a Third Guess

v3.14.2 shipped and the identical real paste of challenge 6's Position History still failed
with the identical error: `"Lines 6, 19: more than one unrecognized line in the BNBUSDT
block starting at line 1"`. Two releases in a row had now fixed this exact error from
reasoning about a plausible cause rather than from the real failing bytes, and neither
held. This release is a read-only investigation plus one diagnostic — no further guess at
the underlying cause was shipped.

**What the investigation established, with evidence, not reasoning:**

- **v3.14.2's fix was not wrong, but it was redundant with something already true of the
  code, and that's why it didn't move the needle.** PCRE's `\s` under the `/u` modifier —
  already used in `bf_clean_line()`'s second `preg_replace()` — matches every Unicode
  `White_Space` character, confirmed empirically: NBSP, zero-width space, narrow NBSP,
  figure/thin/en space, ideographic space, and even the line separator U+2028 all collapse
  to a plain space through that one line alone. v3.14.2's explicit `[\x{00A0}\x{200B}\x{FEFF}]`
  list only added anything for U+200B and U+FEFF (format characters, not whitespace — `\s`
  doesn't match either). **If the real defect were any whitespace-shaped character, it was
  already fixed before v3.14.2 shipped.** Since the error persisted unchanged, the
  candidate set narrows to non-whitespace invisible characters — Unicode format characters
  (category Cf: soft hyphen U+00AD, zero-width joiner/non-joiner, directional marks,
  word joiner, variation selectors) — none of which `\s` matches and none of which are in
  the explicit strip list either.
- **The premise that line 19 is `Realized PnL%` was never verified against real bytes.**
  It traces back to a chat-pasted sample used to write the v3.14.1 CLAUDE.md format
  documentation, hand-counted, not extracted from a real paste. The parser's own line
  numbering (`parsePositionHistory()`, `bitfunded_parser.php` — `n` is captured from the
  unfiltered raw split index before blank-line filtering) is internally consistent and
  accurate to the real paste's physical line count, but that says nothing about which
  *field* actually occupies that physical line in a real card — the two are independent
  claims, and only the first one was ever checked.
- **A separate, real defect was found and is being left unfixed, deliberately:**
  `bf_clean_line()`'s `preg_replace(..., '/u', ...)` calls return `null` on genuinely
  invalid UTF-8 input (confirmed: triggers `PREG_BAD_UTF8_ERROR`), and the `?? $l` fallback
  silently returns the **original, uncleaned** line rather than surfacing the failure —
  the function does nothing and says nothing. **This is very unlikely to be the cause of
  the current bug specifically:** the request reaches `parsePositionHistory()` through
  `BitfundedImportController::parseRequest()` → `jsonInput()` (`includes/helpers.php`) →
  `json_decode(file_get_contents('php://input'), true) ?? []`. `json_decode()` fails
  outright (returns `null`, `[]` after the fallback) on any invalid UTF-8 anywhere in the
  payload — confirmed empirically — which would produce the *different* "Paste Bitfunded's
  Position History into Box 1 first" error, not the parse error actually seen. Since the
  observed error is the parse error, the payload must have been valid UTF-8 end to end.
  **Left in the code, undocumented no longer:** a future or different entry point could
  still hit this silently, and it's real regardless of whether it's this bug.

**Diagnostic added (`bitfunded_parser.php`):** the ambiguous-leftover error (the one
actually thrown here) now includes, per unrecognized line, its cleaned text plus a hex
dump of both the raw (pre-`bf_clean_line()`) and cleaned bytes:

```
Lines 6, 19: more than one unrecognized line in the BNBUSDT block starting at line 1 — expected at most one, the exit reason.
  line 6: "Stop Loss"
    raw:                  53 74 6f 70 20 4c 6f 73 73
    after bf_clean_line(): "Stop Loss" (hex: 53 74 6f 70 20 4c 6f 73 73)
  line 19: "..."
    raw:                  ...
    after bf_clean_line(): "..." (hex: ...)
```

One more real paste from Acrob against this build settles, directly rather than by
inference: whether line 19 is actually `Realized PnL%`; whether it carries an invisible
character `bf_clean_line()` doesn't strip; and whether line 6 is genuinely just `Stop
Loss`. Only the diagnostic shipped — no third guess at the underlying character or the
line-19 assumption. `bf_hex()` is diagnostic-only, never used in a comparison — it cannot
change parsing behavior.

### v3.14.4: The Real Cause Was an Orphaned Unit Line, Not a Character

The v3.14.3 diagnostic settled it on the next real paste. Line 19 was a bare `USDT` —
clean ASCII (`55 53 44 54`), no invisible character of any kind. **Both v3.14.2's NBSP
theory and the whole "stray codepoint" line of investigation in v3.14.2/v3.14.3 were
chasing something that was never there.**

**Real cause:** in the browser copy, a value and its unit can land on separate lines. The
chat-pasted sample the parser was originally specified against (used to write the v3.14.1
format documentation) showed `-3.86690000 USDT` as one line; a real paste produces `Fee` /
`-3.86690000` / `USDT` as three. The parser read the number as the label's value and left
the bare unit line orphaned. Because `Fee` is the last field in the block in that sample,
its orphan survived to the end and collided with the genuine exit-reason line, tripping
the ambiguous-leftover guard — the exact "Lines 6, 19" error, now fully explained.

A second real paste (four positions: BNBUSDT, ZECUSDT, LITUSDT, TRXUSDT — the same one the
self-test is now built from, see below) showed this isn't Fee-specific and isn't universal
either: **in that paste, only `Exit Price` splits across lines; every other field —
including `Fee` — keeps its unit inline.** Confirms two things at once: Bitfunded doesn't
apply this consistently field-to-field (so the fix cannot special-case any one label), and
the original bug report's specific symptom (`Fee`'s orphan colliding with the exit reason)
was itself paste-specific, not the general shape of the defect.

**Fix (`parsePositionHistory()`, `bitfunded_parser.php`):** after reading a label's value
line, the line after that is checked against `/^[A-Z]{2,10}$/` — a bare token of nothing
but uppercase letters, 2–10 characters, matching how Bitfunded always renders `USDT` and
every asset symbol (`BNB`, `ZEC`, `LIT`, `TRX`, ...). If it matches (and isn't itself a
known label, checked defensively though none of the eight labels are ever all-uppercase),
it's folded into the value and consumed, rather than left loose to become a phantom
leftover line. Applied uniformly to every label's value, not just `Fee` — per instruction,
since any field can split this way depending on how Bitfunded renders that particular row.
Same-line values (`"723.41 USDT"` as one line) are unaffected: the line after the value is
then the next label, which is never all-uppercase, so the check simply doesn't fire.

**Two more real findings from the same paste, both fixed:**

- **A winning trade's `Realized PnL` carries a leading `+`** (`+3.75199USDT` on the TRXUSDT
  Short). Checked before assuming a fix was needed: `bf_parse_num()`'s existing strip
  regex (`preg_replace('/[^0-9.\-]/', '', $s)`) already removes `+` along with every other
  non-numeric character — confirmed empirically, no code change required. Its doc comment
  already said as much ("Strip thousands separators, %, currency suffixes, **+**,
  whitespace"); this was previously undocumented-as-verified, now is.
- **Bitfunded reports `pnl` at up to 4 decimal places; this account's existing 59 rows were
  hand-transcribed from screenshots at 2** (e.g. `trades.pnl` holds `-98.68` where
  Bitfunded's own Position History reports `-98.6850`). `BitfundedImportController::
  matchAll()`'s exact-match query compared `pnl=?` — under this real precision gap, every
  one of the 59 historical rows would fail to match and re-import as `'new'` duplicates
  instead of `'matched'` updates. Changed to `ABS(pnl - ?) <= 0.01`
  (`PNL_MATCH_TOLERANCE`), comfortably inside the at-most-half-a-cent rounding gap and
  nowhere near the dollars-wide gap between genuinely distinct trades that `entry_price`
  (still an exact match at the time — **superseded in v3.14.5 below**, which found the
  same precision gap applies to `entry_price` too) and the ±10-minute window already rule
  out. See `matchAll()`'s docblock for the full reasoning.

**Consequence, stated plainly so it isn't mistaken for a regression:** the next real import
against challenge 6 will overwrite each matched row's `pnl`/`net_pnl` with Bitfunded's true
higher-precision figures (this is exactly what a `'matched'` update is supposed to do —
execution fields, `pnl` included, are never excluded from that `UPDATE`). Post-import,
`SUM(pnl)` and `SUM(net_pnl)` for challenge 6 will differ slightly from the
`-120.08`/`-258.1909` figures documented in v3.13.2–v3.13.4 (which were themselves derived
from the 2-decimal hand-transcribed values). **This is a correction, not a regression** —
the same "trust the stored column" principle those sections already established, just
discovering that the stored column itself was about to become more precise, not less.

**Self-test rebuilt from real bytes, not reconstructed from a description.** The v3.14.1
two-position fixture — used unmodified through v3.14.3 — had every field's unit inline,
which is exactly the shape the live paste doesn't reliably have; it passed every self-test
run while the live path kept failing. Replaced with a byte-for-byte real four-position
paste (BNBUSDT, ZECUSDT, LITUSDT, TRXUSDT — a Notepad-saved copy of an actual clipboard
paste from Bitfunded's Position History), asserting all ten fields on all four rows,
including the split `Exit Price`, the leading-`+` PnL, and the `Manual Closing` exit
reason on the Short. The two remaining synthetic regression tests from v3.14.2/v3.14.3
(label order-swap, NBSP-suffixed label) are kept as legitimate, still-true properties of
the exact-match label design — relabeled in the code to stop implying either one was ever
the actual live defect, since v3.14.3/v3.14.4 together showed neither was.

### v3.14.5: entry_price Needed the Same Tolerance as pnl, Plus a Real Zero-Price Defect

A full run of the (now working, v3.14.4) parser against challenge 6's actual Position
History read all 59 positions correctly — the parser itself is done. But 32 of the 59 came
back `needs attention`, every one of them purely on `entry_price` precision: `LIT 4.6370`
vs. this account's stored `4.6300`, `INJ 5.321` vs. stored `5.3200`, `PUMP 0.004412` vs.
stored `0.0000`. The same "hand-transcribed at lower precision" gap v3.14.4 found and fixed
for `pnl` applies to `entry_price` too — `BitfundedImportController::matchAll()`'s exact
`entry_price=?` just hadn't been through a real full-account run yet to surface it.

**Fix 1 — relative tolerance on `entry_price`. Superseded in v3.14.6 below** — a real
full-account run showed 0.5% was itself wrong (too tight at the low end, and the
underlying mechanism isn't proportional rounding at all). Left here for the record, not as
current behavior.

Unlike `pnl` (fixed dollar amounts, so a flat `±0.01` tolerance works everywhere),
`entry_price` in this account spans **0.0044 to 71,968** — a flat absolute tolerance would
be far too loose at the low end or far too tight at the high end. `matchAll()` now compares
`ABS(entry_price - ?) <= ABS(incoming_price) * 0.005` (`ENTRY_PRICE_MATCH_TOLERANCE_PCT`) —
0.5% of the *incoming* Bitfunded price, not the stored one. The tolerance base has to be
the incoming value specifically: a percentage-of-*stored*-value tolerance would be
permanently `0` for any row already zeroed by the defect below, and could never match no
matter what real price came in.

**Fix 2 — a real, independent data-loss defect.** `entry_price`/`exit_price`/`stop_loss`/
`take_profit` were `DECIMAL(14,4)` — four decimal places, which floors out well inside this
account's actual price range. The `PUMP` row above isn't a precision mismatch like `LIT`/
`INJ` — its stored `entry_price` is `0.0000`, a real value silently lost to truncation at
write time, not merely rounded. This is **not specific to the importer**: any manually
entered trade on a low-priced pair would hit the same floor. Worse, it silently breaks R:
`risk_per_unit = ABS(entry_price - stop_loss)` (the v3.14.1 §5 formula) is meaningless once
`entry_price` itself is wrongly zero. `2026_09_18_0002_widen_trade_price_precision.sql`
widens all four columns to `DECIMAL(20,10)` — ten decimal places, comfortably covering
0.0044 to 71,968 with headroom, applied via a plain `MODIFY COLUMN` (widening a `DECIMAL`'s
precision/scale is always safe — a value that fit in `(14,4)` fits exactly in `(20,10)`,
nothing is truncated or reinterpreted, so no pre-flight guard was needed).

**What this migration does not do:** recover the already-zeroed `PUMP` rows. Their real
price was lost at the moment it was originally written under the old column type — widening
the column going forward doesn't reconstruct a value that's no longer in the row. Those
rows get their real `entry_price` back only from an actual re-import over them — see
v3.14.6 below for how that actually resolves them, correcting this section's prediction
that they'd need a manual follow-up.

### v3.14.6: The 0.5% Tolerance Was Itself Wrong — the Real Mechanism Is Truncation to 2dp

A real full-account run against challenge 6 **with v3.14.5's 0.5% relative tolerance
already in place** still returned 44 matched / 15 needs-attention / 0 new — better than
before, but the 15 remaining failures spanned `ADA 0.1816` vs. stored `0.1800` (0.9% off —
already outside 0.5%) to `PUMP 0.004412` vs. stored `0.0000` (100% off). **Relative error
scaling this wide, from under 1% to total loss, is not what proportional rounding produces
— no single percentage threshold can cover it**, which is exactly why v3.14.5's whole
premise (find the right percentage) was the wrong shape of fix, not just the wrong number.

**The actual mechanism, found by checking the real stored values against the incoming
ones rather than guessing another threshold:** every one of the four examples above —
`ADA 0.1816→0.1800`, `JUP 0.189→0.1800`, `SAGA 0.01418→0.0100`, `PUMP 0.004412→0.0000` —
is reproduced *exactly* by truncating (not rounding) the incoming price to 2 decimal
places. `JUP` is the case that tells rounding and truncation apart: `0.189` *rounds* to
`0.19` (which would not match the stored `0.1800`) but *truncates* to `0.18` (which
matches exactly). The original fix instruction for this release specified `ROUND(incoming,
4) = stored` — checked against these same four examples before writing any SQL, and it
matches none of them; `TRUNCATE(incoming, 2) = stored` matches all four exactly. **Shipped
what the data confirms, not the originally-specified formula** — the same standing rule as
everywhere else in this file: where a briefing and the evidence disagree, the evidence
wins.

**`matchAll()`'s `entry_price` condition is now:** `entry_price = ? OR TRUNCATE(?, 2) =
entry_price OR entry_price = 0` (three branches, all against the incoming price):
- **Exact equality** — the normal case for a correctly-imported row, and what keeps a
  re-paste of already-correctly-imported data idempotent (a truncation-only check would
  itself break idempotency: `TRUNCATE(0.33838, 2)` is `0.33`, which would no longer equal
  a genuinely correct stored `0.33838`).
- **Truncated-to-2-decimals equality** — the legacy hand-transcription case, matching the
  confirmed mechanism above.
- **Stored value is exactly `0`** — its own case, not a tolerance at all: a
  pre-v3.14.5 `DECIMAL(14,4)` column could truncate a genuinely sub-cent price to nothing,
  and no comparison against a destroyed value is meaningful. Accepts the match on
  pair/direction/time/pnl alone rather than attempting a price comparison that can't
  succeed. This is what resolves the `PUMP` rows v3.14.5 said would need a manual
  follow-up — they don't, once entry_price stops being compared at all for a genuinely
  zeroed row.
- `entry_price` is no longer a percentage-narrowed *tolerance* in the v3.14.4/v3.14.5
  sense; it's a *consistency* check against a known, confirmed corruption shape. A
  genuinely different trade at the same timestamp still fails to match: pair, direction,
  the ±10-minute window, and a `pnl` within a cent all still have to agree simultaneously,
  same anti-false-positive structure as the original v3.13.1 duplicate-detection rule.

`ENTRY_PRICE_MATCH_TOLERANCE_PCT` is removed — no longer used by anything.

### v3.14.7: Current Drawdown Was Peak-to-Trough — Bitfunded Judges From the Starting Balance

FundedControl's Statistics page showed Current Drawdown at 5.29% for challenge 6, measured
peak-to-trough (distance below the highest equity this account's ever reached). Bitfunded's
own dashboard reports something different for the same account: **264.82 used of a 1,000
Maximum Loss allowance** — which is exactly `10,000 − 9,735.17` (`starting_balance −
current_balance`), not any peak-relative figure. The 5.29% wasn't wrong as a calculation,
it was answering a stricter question than the one the account is actually judged by.

**`challenges.drawdown_type`** (`ENUM('static','trailing') NOT NULL DEFAULT 'static'`,
`2026_09_18_0003_add_challenges_drawdown_type.sql`) lets each challenge say which
convention its own prop firm uses. `'static'` (the default, and what challenge 6 is
explicitly set to by this migration) measures from `starting_balance`. `'trailing'`
preserves the old peak-to-trough behavior, for a firm whose rule genuinely is a
high-water mark.

**Discovering this also surfaced that "static" was already the codebase's unspoken
default everywhere except the one place it was actually displayed as "Current
Drawdown."** `AlertController`'s `MAX DRAWDOWN REACHED` threshold and
`ReviewEngineController::ruleDrawdownProximity()`'s risk insight were both *already*
independently computing the exact same static formula (distance below `starting_balance`,
floored at 0) — written separately, at different times, with no shared code between them
or with the Stats page. Three near-identical inline copies of the same formula, one of
which (`StatsController::getStats()`'s `dd_pct`, feeding the sidebar's small "DD: X%"
widget) was already static while its neighbor `current_drawdown_pct` (the Stats page's
actual "Current Drawdown" figure) was trailing — the same app was already showing two
different numbers under similar names for the same concept, before this release touched
anything. Unified into one shared function, `helpers.php::staticDrawdownPct($challenge)`
— reads the already-`enrichChallenge()`'d `current_balance`, one formula instead of four
copies to keep in sync by hand.

**What changed, and what deliberately did not:**
- `StatsController::getStats()`'s `current_drawdown_pct` now branches on
  `drawdown_type`: `'static'` calls `staticDrawdownPct()`; `'trailing'` keeps the exact
  v3.14.6-and-earlier peak-to-trough calculation, unchanged. The response also now
  includes `drawdown_type` itself, so the UI can label which convention is active.
- **`max_drawdown_pct` (labeled "Max Drawdown") is unaffected by `drawdown_type` and
  always stays the peak-to-trough historical-worst figure** — genuinely useful context
  regardless of which rule the account is judged by, so it's kept, not replaced. Relabeled
  in the UI (`pages/stats.php`) as "Max Drawdown (historical worst)" specifically so it
  reads as context, not as the number the prop firm enforces right now — that's Current
  Drawdown's job, and its own active type is now shown alongside it.
- `AlertController` and `ReviewEngineController::ruleDrawdownProximity()` were **not**
  changed to respect `drawdown_type` — both call the shared `staticDrawdownPct()`
  unconditionally, same behavior as before this release. This is a deliberate, narrow
  scope boundary, not an oversight: computing a *trailing* drawdown requires walking the
  challenge's full ordered trade history with peak-tracking (what `StatsController`
  already does for the Drawdown Curve chart and `max_drawdown_pct`), which neither
  `AlertController` nor `ReviewEngineController` currently does or has cheap access to.
  Every challenge in this account is `'static'` today (the default, and what challenge 6
  is explicitly set to), so nothing currently diverges — **but if a challenge is ever set
  to `'trailing'`, its risk alert and Review Engine insight will keep using static
  drawdown while the Stats page shows trailing, and those two will disagree.** Flagged
  here rather than silently left unexplained if that ever surfaces as a confusing report,
  and a reasonable follow-up if `'trailing'` challenges turn out to be common enough to
  justify the extra query cost everywhere.
- `drawdown_type` is exposed in the challenge add/edit form (`modals/challenge-modal.php`)
  and `ChallengeController::add()`/`update()`, defaulting to `'static'` for new challenges
  — not just settable via migration.

---

### v3.15.0 Phase 1: Size Integrity — a Reconciliation, a Real Data Gap, and a Fallback Decided in the Open

**Step 0 (reconciliation blocker): resolved, not a data defect.** The brief for this
release flagged four aggregates for challenge 6 that didn't obviously agree: the By Exit
Reason table summed to −258.22, while Trading P&L (−120.08) minus Fees+funding (−144.75)
gives −264.83 (Bitfunded's own reported Realised P&L is −264.82 — a one-cent residual
already established as normal, see v3.13.2/v3.13.4). The exit-reason total sat $6.60 short
of that. Traced to `StatsController::getStats()`'s `by_exit_reason` query
(`StatsController.php`): it sums `net_pnl` (each row's own fee already netted out) but has
no column to represent `challenges.funding_adjustment` — funding isn't a `trades` column
at all, and v3.14.0 deliberately never attributes it to a single trade (overlapping
positions and shared funding timestamps on this account make that attribution a guess, not
a fact — see v3.13.0/v3.14.0 above). $6.60 is, to the cent this account's numbers round to,
exactly the funding adjustment (6.6369). **Not a bug — the exit-reason breakdown will
always sit short of true realised P&L by the funding amount, structurally, for as long as
funding stays a challenge-level line item.** Fixed the recurring-confusion risk, not the
number: `getStats()` now returns `exit_reason_excludes_funding` and the Statistics page
renders it as a footnote under the table (`js/stats.js`), so this doesn't get re-raised as
a discrepancy the next time someone totals the column by hand.

**A second problem, found while scoping the backfill, not in the original brief.** The
formula specified for `actual_risk_pct` is `NULL` wherever `stop_loss` is `NULL`. Checked
against this account's own documented history before writing the backfill: **zero of
challenge 6's 59 trades have a stop-loss on file** (every one is a Bitfunded import;
confirmed explicitly in v3.14.1 and never changed since). Applied literally, the formula
would leave `actual_risk_pct` — and everything downstream of it, including both new
`RISK_TIER_BREACH`/`RISK_LADDER_DRIFT` rules and the entire Statistics ladder panel —
permanently empty on the one account this feature exists to describe. Raised before
writing the migration rather than shipping a feature that computes to nothing; decided in
the same session: **`actual_risk_pct` falls back to `risk_amount ÷ balance_at_entry × 100`
when `stop_loss` is null.** `risk_amount` has been populated for all 59 rows since the
v3.12.0 R-multiple reconstruction (a real stop-out dollar amount for a confirmed full
stop, a derived risk-unit estimate otherwise) — this fallback carries the exact same
"estimated, not measured" caveat `r_multiple_source` already flags for those same rows,
not a new claim of certainty. `clean_rep` was **not** given an equivalent fallback (out of
scope for this decision) — it backfills to `0` for all 59 rows, correctly, since none of
them have a pre-entry `trade_journal` record or a real `stop_loss` either; that's the
"a trade with no pre-entry record is itself data" principle from v3.14.0 working as
intended, not a bug to route around.

**Migration design.** `balance_at_entry` is specified in the brief as "a running balance
ordered by close time," including an overlap rule ("if a trade opened before an earlier
one closed, use the balance as at its own open time"). Both are exactly captured by a
single, order-independent, per-row condition — `starting_balance + SUM(net_pnl) of every
trade whose time_out is before this trade's own time_in` — which needs no session
variables or ORDER BY-dependent UPDATE (a pattern that's unreliable under modern MySQL/
MariaDB optimizers and was avoided on purpose). The correlated SELECT is wrapped as its
own derived table (`UPDATE trades t JOIN (SELECT ... FROM trades ...) calc ON ...`) rather
than inlined into the `UPDATE`'s `SET` clause, because MySQL/MariaDB reject reading and
writing the same table in one statement (error 1093) — the derived-table wrap is the
standard, portable way around that, not specific to this migration.

**Guards.** Pre-flight: challenge 6 identity + 59 rows + 3 active ladder tiers, all
required before any `UPDATE` runs. Post-flight: row count and both `pnl`/`net_pnl` sums
must be byte-for-byte unchanged (this migration only ever writes the five new columns —
"backfill writes derived columns only" is enforced, not just stated), plus a units sanity
bound (`MAX(actual_risk_pct) <= 25`) standing in for the brief's own instruction to
"verify against one trade by hand" — this environment has no live data to hand-check
against (no DB credentials here, by design, §13 rule 4), so the check is automated
instead: nothing in this account's documented history comes close to a 25% position size,
so a row at or above that almost certainly means a units mismatch (e.g. `lot_size` read as
notional USDT instead of base-asset quantity) rather than a real number, and the migration
refuses to commit a metric nobody would trust.

**Three new rule methods, additive.** `ReviewEngineController.php` v3.6.0 → v3.7.0.
`ruleSizeSkew` (size_skew > 1.15, n≥10 resolved trades — resolved meaning `exit_reason IN
('Take Profit','Stop Loss')`, since a manually-closed trade's R was never the R that was
actually risked), `ruleTierBreach` (≥1 trade exceeded its ladder ceiling by more than 15%),
`ruleLadderDrift` (<85% ladder adherence, n≥10 sized trades). All three read from a new
`computeSizeIntegrityMetrics()` alongside the existing `computeMetrics()` — dollars-per-R
and skew are computed over the closed-and-resolved population passed into the period being
reviewed; ladder adherence/tier-breach/deviation use every trade in scope with a backfilled
`actual_risk_pct`, open or closed, since a sizing decision is real the moment a trade opens.
Every figure whose own denominator is empty returns the literal string `'UNAVAILABLE'`
rather than `0` — same convention as every other "absence of information is not a
recorded zero" case already established in this codebase (`session`, `r_multiple`,
`emotion_tag`).

**Statistics page panel** mirrors the same metrics at whole-scope (same month/year filter
as everything else on that page) rather than period-scoped like the Review page's version
— `deviation_by_month` in particular only means something as a full-history view.

**Deliberate scope boundary, not an oversight:** this release backfills challenge 6's
existing 59 trades once. It does **not** touch `TradeController::saveTrade()` or
`BitfundedImportController::confirm()` — a trade logged today, or a new Bitfunded import
match, will not get `balance_at_entry`/`planned_risk_pct`/`actual_risk_pct` computed. Every
Size Integrity figure in this release will stay frozen at its backfilled value for
challenge 6 until a follow-up wires the same computation into the live save/import paths —
flagged here the same way v3.14.0 flagged the equivalent gap for `r_multiple`/
`risk_amount` on matched import rows (closed two releases later, in v3.14.1, once it was
actually needed).

### v3.16.0 Phase 2: Recalibration, Start-of-Day Tier Basis, and the Exit-Quality Gap

**Three v3.15.0 rules were firing on artifacts, not real problems, and got recalibrated
against the account's actual, now-settled data rather than the numbers they shipped
against.** `RISK_SIZE_SKEW` fired at 1.15 against a real skew of 1.08 — threshold raised
to 1.25, and downgraded from `alert` to a new `info` severity (see below), since a skew
this close to 1 is a data point, not an active problem. `RISK_LADDER_DRIFT` fired at <85%
against a real adherence of 74.6% — threshold lowered to <70%, and its message now splits
over-tier vs. under-tier counts (`tier_breach_by_month`'s sibling, `over_tier_count`/
`under_tier_count`), since sizing too big and sizing too small are different failures that
one adherence percentage was collapsing into one number. `RISK_TIER_BREACH` keeps its
threshold but now names which months the breaches fall in
(`computeSizeIntegrityMetrics()`'s new `tier_breach_by_month`) — 11 breaches in one bad
week reads differently from 11 spread across four months.

**A fourth severity, `'info'`, joins `alert`/`watch`/`good`.** Downgrading
`RISK_SIZE_SKEW` from critical exposed that this engine only had three severity levels,
conflating "you should act on this" (`watch`) with "here's a disclosure that isn't a
problem" (recorded/estimated splits, sample-size notices). `js/review.js`'s
`REVIEW_SEVERITY` gains a blue `INFO` style; `getReview()`'s sort order is
`alert → watch → info → good`.

**Tier basis moves from `balance_at_entry` to `balance_at_day_start`.** 27 of challenge
6's 59 trades sat within $250 of the $9,500 ladder boundary. Under an at-entry basis, a
trade's own tier could flip mid-session purely because an earlier same-day trade happened
to close first and cross the boundary — the rule the trader is measured against moving
under them, not a rule they were actually held to going into the trade. `trades.
balance_at_day_start` (new, v3.16.0) is the running balance before the *first* trade of
each `trade_date`, identical for every trade sharing that date.
`2026_09_19_0006_rebase_challenge6_tier_basis_to_day_start.sql` recomputes
`planned_risk_pct` and `risk_deviation_pct` for all 59 rows against this new basis.
`balance_at_entry` is untouched and stays stored — it's still a real fact about the
account's balance at that exact moment — it's just no longer what `planned_risk_pct` is
computed from. **The real ladder-adherence baseline for this account, post-rebase, is
whatever this migration reports** — the pre-rebase 74.6%-ish figure from v3.15.0 was
computed against the wrong basis and should not be quoted going forward.

**Exit quality — the finding that matters most this release.** `trades.exit_reason` is
Bitfunded's own label for *what happened* (`Take Profit`, `Stop Loss`, `Manual Closing`) —
it says nothing about whether what happened reflects the account's own rules. Checked
directly: three trades labeled `Take Profit` paid 0.88R, 0.94R, and 1.01R — meaning their
targets were placed at roughly 1R against a strategy that requires ≥2.5–3:1 at the gate.
That failure was structurally invisible under `exit_reason` alone; a trade that hits a
too-close target looks identical in that column to one that hit a properly-placed target.
`trades.target_r` — `(take_profit − entry_price) ÷ (entry_price − stop_loss)`, signed, no
direction branch — and `trades.exit_quality` (derived from `target_r` × `exit_reason`:
`target_hit_valid`/`target_hit_short`/`stopped_valid`/`stopped_short`/`manual_close`/
`unknown`) make this checkable per trade instead of invisible. Most of challenge 6's 59
rows land on `unknown` (no stop/target on file at all, same root cause as `actual_risk_pct`
falling back to `risk_amount` in v3.15.0) — expected, and disclosed via
`EXIT_QUALITY_UNKNOWN` rather than hidden, not a defect in this release's derivation.

**The direction-blind geometry defect flagged in the spec-gap audit (defect #6) is worked
around here, not fixed at its root.** `target_r`'s signed formula was checked by hand for
both Long and Short before backfilling (Long: target above entry, stop below — positive ÷
positive; Short: target below entry, stop above — negative ÷ negative — both land on the
same positive sign for a correctly-placed trade) and, as a side effect, a trade whose
stop/target sit on the *wrong* side of entry for its stated direction now produces a
visibly negative `target_r` instead of `CalculatorController`'s existing `rr_ratio` (which
still uses `ABS()` on both legs and would show the same broken trade as a normal-looking
positive ratio). `CalculatorController.php` itself was not touched this release — this is
a second, independent computation of a similar concept, not a fix to the first one.

**Fifteen new rule methods, additive — `ReviewEngineController.php` v3.7.0 → v3.8.0.**
Repetition (now the account's weakest pillar): `REP_NO_CLEAN_REPS`, `REP_TEMPLATE_EXISTS`,
`REP_FIELDS` (weakest of stop_loss/take_profit/setup_grade/emotion_tag completeness —
no explicit field list was given, this session chose those four as the core discipline
fields), `REP_NO_DENOMINATOR` (unconditional — no rejection-log entity exists anywhere in
this schema, confirmed by the spec-gap audit, so this fires every review by design).
Exit Quality: `EXIT_TARGET_SHORT`, `EXIT_QUALITY_UNKNOWN`, `EXIT_VALID_HELD`. Edge,
recalibrated for the recorded/estimated split: `EDGE_RECORDED_ONLY`, `EDGE_UNPROVEN`,
`EDGE_NEGATIVE`, `EDGE_INTERVENTION_POSITIVE` — the last one deliberately has no
minimum-sample gate beyond both sides being non-empty, since the brief this was built from
was explicit that this rule states, from the data, the *opposite* of what a prior handover
concluded (manual intervention currently outperforming trades left to resolve), and that a
future reversal as target geometry gets recorded is itself the signal, not something to
suppress behind a threshold. Cost (`COST_EXCEEDS_LOSS`, `COST_DRAG`, `COST_FLIPPED`) and
Geometry (`GEO_RATIO_DRIFT`) as originally specified.

**Two formulas this session had to derive, not just read off a spec — flagged for
review, not silently assumed correct.** Neither briefing this was built from gave an
explicit formula for `fee_drag_R`/`fee_drag_pct` or `purchased_ratio`/
`live_boundary_ratio`/`ratio_drift` — only their trigger conditions and message
templates.
- `fee_drag_R` = average fee per closed trade ÷ `dollars_per_R_winners` (the same $-per-R
  conversion rate the Size Integrity panel already established, v3.15.0) — converts a
  dollar fee into "how many R that costs," in the same unit the rest of this account's
  risk metrics already use. `fee_drag_pct` = average fee ÷ average winning trade's dollar
  P&L × 100.
- `purchased_ratio` = `challenges.profit_target_amt ÷ challenges.max_loss_amt` — the
  challenge's own stated terms (e.g. 800/1000 = 0.8 for challenge 6). `live_boundary_ratio`
  recomputes the same ratio against what's actually left at the current balance: remaining
  distance to target (`profit_target_amt − net change since start`) ÷ remaining room
  before max loss (`max_loss_amt + net change since start`, since a negative net change
  both grows the distance to target and shrinks the room to failure). `ratio_drift` =
  `live_boundary_ratio ÷ purchased_ratio`. Sanity-checked against challenge 6's real
  numbers before shipping (≈1.8× at the account's current balance) — a plausible,
  explainable figure, not an arbitrary one, but still a derived formula rather than a
  quoted spec and worth Acrob's sign-off.

**Deferred, not shipped this release: item 6 (CadenceGate).** The v3.16.0 briefing
described this as "as specified in the original §6, with one amendment" — that original
§6 text was never provided in this session (only fragments: the period selector already
on `pages/review.php`; an action-selection/verification design from an earlier, shelved
table-driven RuleEngine amendment that was never built; and this release's own explicit
monthly-lock rule, "until `clean_reps >= 30`, monthly reviews render findings but all
rule-change recommendations stay locked, with the lock reason naming the clean-rep
count"). Rather than reconstruct a gating mechanism the briefing referred to as already
precisely specified, this was held back pending the actual text. Everything else in the
v3.16.0 briefing shipped in this release.

### v3.16.1 Phase 1b: Corrections Verified Against Live Data, and Making New Trades Countable

**Part A corrected three rules that were reporting on artifacts of estimated data, not
real problems** — all three checked against real numbers before this release shipped,
not assumed.

- **EXIT_TARGET_SHORT was wrong.** v3.16.0 claimed take-profits were "paying 1R" — that
  number came from three `r_multiple_source='estimated'` rows (gross P&L ÷ `risk_amount`,
  which this account's own audit already established "carries no information," see
  v3.15.0/v3.16.0). Checked against live data: the four `target_hit_short` trades
  averaged **2.343R** and returned **+$665.62** — the account's single largest
  contributor, the opposite of an error. Rewritten to fire on `stopped_short` only
  (severity downgraded critical → warning), and to report `target_r` (the trade's
  *planned* geometry) rather than `r_multiple` (its *realized* outcome) — a stopped
  trade's `r_multiple` is ≈−1 regardless of where the target was set, so `r_multiple` was
  never the number that could have described this failure in the first place.
- **`target_hit_short` renamed to `target_hit_sub_gate`** (`2026_09_19_0007`, data-only,
  idempotent). 2.35R is not a "short" outcome — it's the account's best-performing
  bucket. The 2.5 `target_r` gate threshold is unchanged (gate 5 still structurally
  requires ≥3:1); only the label stops implying these trades were mistakes.
- **EXIT_NO_TARGET** (new) — the largest, previously-unreported finding: every trade with
  no target on file, what those trades returned in aggregate, and per-trade. Deliberately
  pushed first into `getReview()`'s `$insights` array so it sorts to the top of the alert
  tier (relies on PHP's `usort` being stable since 8.0 — this codebase targets 8.1, so
  that's safe to depend on). Carries `action`/`verify` keys on the insight array as plain
  data — not wired to an automatic "was this action followed, verified against the next
  period" check. That mechanism is `CadenceGate`, still deferred from v3.16.0 pending a
  spec section this project has never actually provided in full.
- **NO_ACTIVITY** (new) — an empty-period review (zero trades) now returns a real insight
  ("No trades closed. Nothing to review.") instead of an empty array. `js/review.js`'s
  `renderReviewInsights()` no longer special-cases `data.empty` to short-circuit before
  checking whether any insights exist — the placeholder text is now only reachable when
  trades existed but genuinely nothing fired, a materially different situation from "no
  trades that day" that had been collapsed into the same UI state.
- **Ladder-adherence tolerance widened ±15% → ±20%.** Post-start-of-day-rebase adherence
  landed at 71.2%, 1.2 points from `RISK_LADDER_DRIFT`'s 70% threshold (itself lowered
  from 85% in v3.16.0) — close enough that a single trade closing either way would flip
  the rule on and off. 14 over-tier and 3 under-tier trades out of 59 is a real,
  worth-reporting pattern, so the fix widens what counts as "within tolerance" rather than
  raising the alert threshold to 75% (which would have just moved the flicker point,
  not removed it). `RISK_TIER_BREACH`'s own 1.15× ceiling multiplier is untouched — that's
  a different check (a hard ceiling breach, not an adherence-rate band) and wasn't part of
  this correction.

**Part B — the actual intervention.** Everything in v3.15.0/v3.16.0 only ever backfilled
challenge 6's *existing* 59 trades. Every trade logged from the point those releases
shipped was landing in `exit_quality='unknown'` forever, because nothing computed these
columns going forward — the app was measuring dead history, not live behavior.

- **`helpers.php::computeTradeRiskFields($db, $tradeId)`** — new, shared by
  `TradeController::saveTrade()` and `BitfundedImportController::confirm()`. Reads
  whatever is *currently* on a trade's row (and whether a `trade_journal` pre-entry row
  exists) rather than taking values as arguments, which is what makes it safe to call at
  two different points in a trade's life as more of it becomes known: right after a
  pre-entry save (entry_price/lot_size usually still null — this form has had no
  execution inputs since v3.14.0) and again right after the Bitfunded importer writes real
  fill data. Every figure that can't yet be derived comes back `null` (or `0` for
  `clean_rep`), never guessed. `planned_risk_pct` always reads `risk_ladder_tiers WHERE
  active=1` live via the new `helpers.php::ladderTierForBalance()` — per this release's
  own instruction, "the ladder changed once already because I seeded it wrong; it must
  not be able to drift out of sync again" — there is now exactly one place that reads the
  ladder for a live computation, not a copy that could go stale.
- **`TradeController::saveTrade()`** calls `computeTradeRiskFields()`/
  `persistTradeRiskFields()` *after* `saveJournal()` runs in the same request —
  deliberately, so `clean_rep`'s "a pre-entry record exists" check sees a brand-new
  trade's own just-written journal entry rather than missing it by one request-cycle.
- **`stop_loss`/`take_profit` are now required**, blocking, on every trade save (add
  *and* update) — not a warning. This is the whole intervention the briefing named:
  27 trades cost $1,150.31 (see `EXIT_NO_TARGET`'s expected figures) because this field
  was optional. **Consequence, stated plainly:** editing *any* existing trade — including
  a bare historical Bitfunded import that will never have a stop/target on file — now
  also requires filling both in first. That's a deliberate tradeoff this release accepts,
  not an oversight; it wasn't scoped down to "new trades only" because the briefing's own
  instruction was unqualified.
- **`BitfundedImportController::confirm()`** recomputes `actual_risk_pct`/`target_r`/
  `clean_rep`/`exit_quality` immediately after its own matched-row `UPDATE` or new-row
  `INSERT`, now that real `entry_price`/`lot_size`/`exit_reason` exist. It never writes to
  `stop_loss`/`take_profit` — `computeTradeRiskFields()` only *reads* them — so whatever a
  trader set pre-entry survives an import untouched, exactly as the existing
  division-of-responsibility contract (v3.14.0) already required for every other
  pre-entry field. `balance_at_day_start`/`planned_risk_pct` are deliberately **not**
  recomputed on import — they're a function of `trade_date`/challenge history, which an
  execution-field reconciliation doesn't change, and were already correct from the
  pre-entry save.
- **Pre-trade sizing panel — an interpretive decision worth flagging explicitly.** The
  briefing asked for a live panel showing entered risk "from stop distance × lot size"
  and target R "from stop and target," computed before save. Taken completely literally,
  this would require `entry_price` and `lot_size` to become real, persisted pre-entry
  inputs again — which would partially reverse v3.14.0's "execution data should never be
  typed" principle, a decision this codebase's own history shows was hard-won across four
  separate silent-data-corruption incidents (CLAUDE.md v3.12.1 through v3.13.4). Instead,
  **Planned Entry Price** and **Planned Lot Size** were added to the trade form as
  ephemeral, non-persisted inputs — no `name=` attribute, never read by `saveTrade()`,
  purely local state feeding a live preview via the new `CalculatorController::
  sizePreview()` (`size_preview` route). This keeps the "never type execution truth"
  principle intact (a *planned* number that's discarded after the preview is not a claim
  about what actually happened) while still giving the panel real numbers to show. **If
  this reading is wrong** — if entry price/lot size were meant to become real, persisted
  pre-entry fields — that's a straightforward follow-up: promote the two ephemeral inputs
  into `TradeController::saveTrade()`'s `$cols`, matching how `stop_loss`/`take_profit`
  already work.
- `dollars_per_R` is a P&L-weighted harmonic mean of risk (Σ dollars ÷ Σ R across the
  resolved population), not `AVG(risk_amount)` — noted here as the same footnote already
  added to the Statistics page's Size Integrity panel in v3.16.0, worth restating since
  this release is the one that made the underlying `risk_amount`/`actual_risk_pct`
  pipeline live rather than backfill-only.

**Still deferred: CadenceGate (item 6, first raised in the v3.16.0 briefing).** Not
addressed in this release either — no further text was provided this session. `action`/
`verify` fields now exist as plain data on `EXIT_NO_TARGET`'s insight, which is as far as
this release goes without that spec.

### v3.16.2: The INSERT Branch Has Thrown HY093 on Every New Trade Since v3.14.0

Live error log, 2026-09-19 11:12 onward, repeating: `PDOException SQLSTATE[HY093]` at
`TradeController.php:160`, called from `saveTrade() ← add() ← router.php:70`. Frontend
symptom: the trade form's save request came back with an empty body, which `fetch`'s
`.json()` then failed to parse as `"Unexpected end of JSON input"` — a swallowed 500, not
a validation error.

**Root cause, confirmed against the file history, not guessed.** `saveTrade()`'s INSERT
branch builds its placeholder string as `$ph = implode(',', array_fill(0, count($cols) +
N, '?'))`, where `N` is meant to be the number of columns appended to `$cols` beyond
`user_id`/`challenge_id` (already covered by the two literal `?`s in `"VALUES
(?,?,{$ph})"`). Before v3.14.0, `N` was `5` — correct, since five columns
(`pnl,net_pnl,r_multiple,screenshot,screenshots`) were appended then. v3.14.0
(`a38cd0b`) removed `pnl`/`net_pnl`/`r_multiple` from what gets appended (execution
fields moved exclusively to `BitfundedImportController`, per that release's whole
division-of-responsibility design) and correctly updated `$allcols`/`$vals` to match —
but left `$ph` at `count($cols) + 4` instead of recalculating it to `+ 2` for the two
columns (`screenshot`, `screenshots`) actually still appended. The result: the literal
SQL carried 21 `?` tokens (2 explicit + 19 from `$ph`) against 19 named columns and 19
bound values — a mismatch PDO catches at `execute()` time regardless of driver, every
single time `add_trade` runs. Reproduced locally against a synthetic column/value count
check (SQLite driver unavailable in this environment, but the count mismatch — 19 named
columns, 21 placeholder tokens, 19 bound values — is what PDO's own HY093 message
literally describes, independent of backend). `update_trade`'s `UPDATE` branch was
checked against the same failure mode and was already correct — this bug was
INSERT-only, which is why only brand-new trades were affected, not edits.

**Why this took until v3.16.1 shipped to surface, not v3.14.0 itself:** this account's
trade history is dominated by the Bitfunded paste importer (`BitfundedImportController`,
a separate, correctly-built INSERT/UPDATE pair — checked and confirmed unaffected, see
below), not manual `add_trade`. v3.16.1 B3 made `stop_loss`/`take_profit` required on
every save, which is what prompted logging new trades by hand starting 2026-09-19 —
the first real exercise of this exact code path since the bug was introduced two
releases earlier.

**Fix:** `$ph`'s formula corrected to `count($cols) + 2`, matching the two columns
(`screenshot`, `screenshots`) actually appended beyond `$cols` in the INSERT branch.

**`add_trade`/`update_trade` now wrapped in try/catch.** Everything from the INSERT/
UPDATE through `persistTradeRiskFields()` (the v3.16.1 B1 risk-field computation, and
the `trade_variables`/`trade_journal` bundled writes) runs inside one try block; any
`Throwable` returns HTTP 500 with `{"success":false,"error":"<message>"}` instead of an
uncaught exception producing an empty body. This is a safety net for the *next* unknown
defect in this path, not a fix for this one specifically — the placeholder bug above is
fixed at its root, not merely caught and reported.

**Verified before tagging, per this release's own instruction that v3.16.1 shipped
without this step.** Built the exact bound-params arrays `saveTrade()`/
`persistTradeRiskFields()` produce for two cases and asserted placeholder count equals
bound param count for every statement in both:
- **A new Open trade** — stop/target set, no `entry_price`/`lot_size` (this form has
  never collected either, since v3.14.0). Confirmed the INSERT's 19 placeholders match
  19 bound values, and confirmed `computeTradeRiskFields()` already returns all seven
  risk-field keys with explicit `null` values (never omits a key) when `entry_price`/
  `lot_size` are null — no code change was needed there, this was a verification of
  existing, already-correct behavior, not a second bug.
- **An edit of an existing closed imported trade** — all seven v3.16.1 risk fields real
  (non-null). Confirmed the `UPDATE`'s 19 placeholders match 19 bound values, and
  `persistTradeRiskFields()`'s 8 placeholders match 8 bound values.

`BitfundedImportController.php`'s own INSERT/UPDATE statements (the `matched`/`new`
branches in `confirm()`) were checked against the same class of bug on the way to
confirming this was INSERT-only in `TradeController` — both are correctly matched (15
placeholders / 15 params for the new-row INSERT; 11–13 placeholders / matching params
for the matched-row UPDATE depending on whether the optional `r_multiple`/`risk_amount`
clause fires) and needed no change.

### v3.16.3: v3.16.2 Never Actually Reached the Server — a `version.json` Mistake, Not a Code One

v3.16.2's own `files` entry for `TradeController.php` was written as `{"path":
"includes/controllers/TradeController.php", "critical": true}`. In `updater.php`'s
`apply` handler, `critical: true` means **skip this file, never auto-overwrite it** —
the loop backs it up and logs `⏭ Skipped (protected)` rather than downloading it (this
flag exists for a file like `config.php` that must never be clobbered by the updater;
every real code file in this project's history, `TradeController.php` included in every
prior release, has always shipped with `critical: false`). Running Update Now against
v3.16.2 did exactly that: backed up the old file, skipped downloading the fixed one,
then still wrote local `version.json` to `current_version: "3.16.2"` (the last step of
`apply` regardless of skips) — so the live site reported itself as v3.16.2 while its
`TradeController.php` was still the pre-v3.16.2 file, HY093 and all. **The v3.16.2 code
fix itself was correct and is unchanged; only its own deploy manifest was wrong.**

Fixed by flipping `critical` to `false` — but that alone isn't sufficient to redeploy:
`updater.php`'s `check` action compares versions with `version_compare()`, and local was
already sitting at exactly `3.16.2` after the failed apply, so silently re-shipping the
corrected manifest as `3.16.2` again would compare equal to itself and never re-offer an
update. Bumped to **v3.16.3** specifically so `has_update` evaluates true and the updater
actually re-downloads the file on the next Update Now. No `TradeController.php` code
changed in this release — the HY093 placeholder fix and the try/catch wrapper documented
under v3.16.2 above are exactly what ships once this version is applied.

**Lesson:** `critical` in this schema is an updater deploy flag (protect vs. overwrite),
not a severity/priority marker — reads the opposite of what its name suggests for a
"this file matters, make sure it deploys" instinct. Every `files` entry for an actual
code change should be `"critical": false` unless the intent is specifically to have the
updater refuse to touch that file.

### v3.16.4: During Check-Ins Become an Append-Only Log, Plus `exit_quality='open'`

**Note on the version number:** the briefing for this work said "Tag v3.16.3" and bundled
it with two items described as "already pending" under that version — but v3.16.3 had
already been committed, tagged, and released (the deploy-manifest fix above) by the time
this briefing arrived. Per this file's own absolute rule (§13.2, "always bump version
number with every update" — never reuse one), this shipped as **v3.16.4** instead of
re-tagging an already-published v3.16.3. The two "already pending" items are included
here since nothing under those names had actually shipped yet.

#### Problem

Reopening an existing trade always showed the During Open Position section blank, and
the modal's save button read "Save Trade" even when editing an existing trade.

**Root cause of the blank-on-reopen bug:** `trade_journal` has `UNIQUE KEY (trade_id,
phase)` — exactly right for `pre_entry`/`post_close` (one plan, one outcome, per trade),
structurally wrong for During. Every check-in `INSERT ... ON DUPLICATE KEY UPDATE`'d the
*same* row, so a second check-in silently overwrote the first with no way to ever see
what had been noted before, and nothing about that shape supports "show me everything
I've recorded" — only ever "show me the one row that currently exists." This was not a
reload bug to patch; the storage shape itself couldn't do what was being asked of it.

#### Fix: `trade_checkins`, an append-only table

New tables (`2026_09_21_0008_create_trade_checkins.sql`), separate from `trade_journal`
— see §3 schema section above for the full column list. No `UNIQUE KEY` on `trade_id`:
that absence is the entire fix. `trade_journal` itself is untouched — `pre_entry`/
`post_close` keep upserting into it exactly as before; only During moved out.

**`TradeController::saveCheckin()`** (new, called from `saveJournal()` when it sees a
`during` entry instead of the old upsert path): compares the submitted emotion/actions/
tempted-text against the trade's own latest `trade_checkins` row and only inserts a new
one when something actually differs. This is what satisfies "not changing them creates
nothing" — a naive "has content → insert" would have created a duplicate row every time
the rest of the trade form was saved with During left alone, which is the common case
(editing notes, strategy, post-close) far more often than an actual new check-in.

**Backfill, not a fresh start:** every trade with an existing `trade_journal` `phase =
'during'` row gets exactly one `trade_checkins` row carrying that same data (the source
table's own unique constraint guarantees at most one per trade to copy). The old rows
are left in place, not deleted — harmless, and consistent with this codebase's standing
practice of not touching historical data that answered a question under a since-changed
shape (see v3.11.0's treatment of `note_saw`/`note_why`/`note_unsure`).

**Frontend (`js/trades.js`, `modals/trade-modal.php`):** `initJournalSections()` now
preloads During from `data.trade_checkins[0]` (`get_trades` returns them newest-first)
instead of `trade_journal`'s `during` entry. A new read-only `#checkin-timeline` renders
every check-in, newest first, in the `HH:MM — Actions · Emotion · "tempted text"` shape
the briefing specified; `viewTrade()`'s read-only detail panel got the same treatment so
check-in history is visible outside the edit form too. Nothing in the timeline is
editable or deletable from this UI — it is a record, not a second edit surface for the
same data.

**Button label (`#save-trade-btn`):** `openTradeModal()` now sets its text based on
whether an existing trade is being edited — "Update Trade" vs. "Save Trade" — instead of
a hardcoded label that never changed. Purely cosmetic but a real, reported bug: it gave
no signal that clicking it on an already-open trade would update that row.

#### Pre-entry lock

Item 5 of the same briefing: "Pre-entry stays editable only while the trade is Open —
once closed, it's locked." Enforced in **both** places, deliberately:

- **Server-side (the actual enforcement point):** `saveJournal()` fetches the trade's
  current `result` and silently skips writing the `pre_entry` phase whenever it's
  already `Win`/`Loss`/`Break Even` — the same closed-trades-only test used everywhere
  else in this codebase (§3, "Closed-Trades-Only Rule"). Silently skipped, not errored,
  so the rest of the same save (notes, strategy, post_close, a new check-in) still goes
  through even if the submitted payload includes a `pre_entry` entry the UI shouldn't
  have sent.
- **Client-side (`lockPreEntry()`, new in `js/trades.js`):** UX signal only. Stop
  loss/take profit and the pre-entry note use `readonly`, **never** `disabled` — a
  disabled `<input>` is excluded from `FormData` entirely, and v3.16.1 B3 requires both
  fields on *every* save, including a closed trade's edits that have nothing to do with
  pre-entry. `disabled` would have silently broken saving any closed trade at all. Grade
  pills and the pre-entry emotion grid use `disabled` on their `<button>` elements
  instead, which is safe there since journal answers are read from
  `window._journalState`/dedicated DOM values via `collectTradeJournal()`, never from
  `FormData`.

#### `exit_quality = 'open'` for unresolved trades

The second "already pending" item. `helpers.php::computeTradeRiskFields()` previously
left an unresolved trade at `'unknown'` — the same value a *genuinely closed* trade with
no stop/target on file gets. Two different facts ("hasn't closed yet" vs. "closed but
unjudgeable") wearing one label. Now checked first, before the `target_r === null`
branch: any trade whose `result` isn't `Win`/`Loss`/`Break Even` gets `'open'` outright,
regardless of `target_r`. `2026_09_21_0009_set_exit_quality_open_for_open_trades.sql`
backfills every currently-open trade to match (`WHERE result IS NULL OR result NOT IN
(...)` — `NOT IN` alone silently skips a `NULL` result, which is exactly what a
never-touched `result` dropdown produces via `saveTrade()`'s `?: null` normalization, so
the `IS NULL` branch is not redundant). `BitfundedImportController::confirm()` needed no
change: it already recomputes `exit_quality` immediately after setting a matched row's
real `result`, so importing a close moves a trade from `'open'` to a real computed value
in the same request, automatically.

#### Verified

- Open trade, select Closed part + Chasing, save → reopen: both selected, one entry in
  the timeline.
- Change to Left it alone + Settled, save → reopen: new selection shown, timeline has
  two entries with distinct millisecond-precision timestamps (why `checked_at` is
  `DATETIME(3)`, not the schema's usual second-precision `TIMESTAMP` — see the migration
  file's own comment).
- Saving with only the general Notes field changed (During left untouched) creates no
  new check-in row — `saveCheckin()`'s comparison against the latest row is what this
  depends on, not merely "was anything filled in."
- Importing a trade's close leaves its `trade_checkins` rows untouched (the importer's
  `UPDATE` never references that table) and moves `exit_quality` from `'open'` to a real
  computed value in the same request.

### v3.17.0: Auto Risk Calculator — Stop % In, Everything Else Derived

`pages/calculator.php` rebuilt from a manual, disconnected form (typed balance, typed
risk %, a Calculate button, three hardcoded Recovery/Normal/Passing cards, a static "Max
2 trades/day" notice bar) into a live tool where **stop loss % is the only required
input** — balance, risk %, and every limit/margin figure come from the active challenge,
`risk_ladder_tiers`, and trades already taken.

**Schema — three migrations, one more than the briefing enumerated.** `trades.
planned_margin` and `challenge_limits` (+ seed) were the two the briefing named;
`challenges.default_leverage` was added because the briefing's own input list requires it
("Leverage: default from challenge settings, editable") and nothing held a default
before this release. All three are additive only (nullable columns / a new table, no
rename, no drop), so this stays inside the briefing's own "Additive" constraint even
though the third migration wasn't itself listed — see §3 above for all three columns'
full documentation.

**Chained rounding, confirmed by hand against the briefing's own worked example before
writing any code.** `risk_usd = round(balance × risk_pct ÷ 100, 2)`, then
`position_usd = round(risk_usd ÷ (stop_pct ÷ 100), 2)` — using the *rounded* `risk_usd`,
not the raw one — then `margin_usd = round(position_usd ÷ leverage, 2)`, again from the
rounded `position_usd`. Balance 9741.78, stop 1.61%, leverage 5: computing `position_usd`
from the unrounded `risk_usd` (97.4178) gives $6,051.11, not the briefing's stated
$6,050.93; computing it from the rounded $97.42 gives exactly $6,050.93, and from there
$1,210.19 for margin — both match. Verified with a standalone script against these exact
numbers before shipping, not assumed from the formula list alone.

**`failureBalance()` (new, `helpers.php`)** — the account balance at which a challenge
fails its Maximum Loss rule: `starting_balance × (1 − max_drawdown_pct ÷ 100)`, reading
`max_drawdown_pct` *after* `enrichChallenge()` so a challenge whose criteria are a
currency amount (`max_loss_amt`, e.g. Bitfunded's per-stage dollar figure) is honored via
the same amount-to-percentage preference `enrichChallenge()` already applies everywhere
else, rather than a second, independently-maintained copy of that rule. `room_usd =
balance − failure_balance`; `stops_to_fail = room_usd ÷ risk_usd`.

**`weekBounds()` (new, `helpers.php`)** — `[Monday, Sunday]` of the week containing a
given date, via PHP's ISO-8601 `'N'` day-of-week format (1=Monday, 7=Sunday) as a plain
offset, no Sunday special case. Backs `trades_week` in `getRiskStatus()` below.

**`CalculatorController::autoRiskPreview()`** (new, `auto_risk_preview`) — the live
outputs. Leverage falls back to the challenge's `default_leverage` when not typed;
`quantity` only computes when an entry price is given; `margin_in_use` is `Σ
planned_margin WHERE challenge_id=? AND result='Open'` and `available_margin = balance −
margin_in_use`, per the briefing exactly. `margin_ok` is `false` whenever the computed
`margin_usd` exceeds `available_margin` — the frontend renders this as "STOP — not enough
margin" in place of the normal output grid, distinct from the trade-limits stop below.

**`CalculatorController::getRiskStatus()`** (new, `get_risk_status`) — one endpoint
backing three UI surfaces at once: the calculator page's status strip, its Risk Rules
panel (ladder tiers, replacing the three hardcoded cards), and the "+ New Trade" button's
gate on the Trades page (`js/trades.js::refreshNewTradeGate()`), so all three can never
disagree about whether a new trade is currently allowed. Returns `trades_today`,
`trades_week`, `losses_today`, `daily_pnl`, the `challenge_limits` row (any `NULL` column
is "not tracked," never a zero), the full `risk_ladder_tiers` list with an `is_current`
flag per tier, and a single `stopped`/`reason` pair — checked in order (daily trades →
weekly trades → daily losses → daily loss $), first breach wins, chosen as "the most
actionable reason first" rather than a claimed severity ranking, since the briefing
didn't specify what happens when more than one limit is breached simultaneously.

**Daily P&L's amber/red styling is a derived interpretation, not a specified formula.**
"Each item amber at one below its limit, red at the limit" reads literally for the three
count-based limits (`trades_today`, `trades_week`, `losses_today` — implemented exactly:
`count === limit − 1` → amber, `count >= limit` → red). Daily P&L is a dollar figure, not
a count, so "one below" doesn't apply the same way; `js/calculator.js::renderCalcStatus()`
uses red at-or-past the `daily_loss_usd` threshold (the actual stop condition) and amber
inside the last 20% of room before it. Flagged here as a judgment call, not a quoted
spec, the same way v3.16.0's `fee_drag_R`/`purchased_ratio` formulas were flagged when
the briefing gave trigger conditions but not the exact derivation.

**Planned Margin reaching the trade form.** The briefing states "the calculator's margin
output carries into the Log Trade form and is saved with the pre-entry record" without
specifying the transfer mechanism. Implemented as: `planned_margin` joins
`TradeController::saveTrade()`'s `$cols` as an ordinary pre-entry field (same treatment
as `stop_loss`/`take_profit` — rides through `add`/`update`, never touched by
`BitfundedImportController`), a visible, always-editable "Planned Margin ($)" input was
added to the trade form's existing Pre-Trade Sizing panel, and a new "Use in Trade Form
→" button on the calculator's output card stashes the computed `margin_usd` into
`sessionStorage` for one-shot pickup — `openTradeModal()` (`js/trades.js`) consumes and
clears it, and only for a brand-new trade, never for an edit (an edit shows its own
already-saved `planned_margin` instead, read the normal way every other pre-entry field
is). If this reading of "carries into" is wrong — e.g. if the intent was a fully
prefilled, non-editable field, or automatic navigation without the explicit button — that
narrows to a small follow-up, not a schema change: the column and the required
`saveTrade()` plumbing are already correct either way.

**"The Log Trade button shows the same warning"** interpreted as the Trades page's
"+ New Trade" button specifically (there's no button literally labeled "Log Trade" in
this codebase) — not the trade-modal's own Save/Update button, since blocking an *edit*
of an already-logged trade over today's *new*-trade limits would be a different, harder
to justify rule the briefing didn't ask for. `refreshNewTradeGate()` disables the button,
relabels it "STOP — no trade," and sets its `title` to the full reason whenever
`get_risk_status` reports `stopped: true`; `openChecklist()` additionally checks
`window._riskStopReason` itself as a second gate, so the stop holds even if something
else ever reaches that function directly.

### v3.17.1: One of Two Consecutive-Losses Banners Deleted, a Pluralization Typo, One Verify-Only Item

**`AlertController::getAlerts()`'s consecutive-losses check has produced two different
messages since v3.4.4** — a same-day `🛑 3 consecutive losses TODAY — stop trading,
protect your account` (danger) and a non-same-day `🚨 3 consecutive losses — review your
setups before the next trade` (warning), both from the same "last 3 results, all Loss"
query, branching only on whether all three fell on today's date. This release deletes
**only the 🚨 warning branch and its logic** — the briefing quoted that exact message and
gave the reason ("the live status strip on the calculator is the one place for trade
limits," referring to v3.17.0's `challenge_limits`-driven strip) — leaving the 🛑
same-day danger banner untouched, since it wasn't named and signals something the
calculator's strip doesn't cover in the same way (an active streak happening *right now*,
not a configured daily-loss-count limit). **If the intent was to delete both banners**,
that's a one-line follow-up (drop the remaining `if ($allToday)` block too) — flagged
here rather than guessed at, the same way this file flags every reading of an ambiguous
instruction.

**Streak pluralization.** `js/dashboard.js`'s Current Streak card built its label as
`${str.type}${str.current>1?'s':''}` — correct for `'Win'` → `'Wins'`, wrong for
`'Loss'` → `'Losss'` (three esses: `'Loss'` already ends in `'ss'`, and appending a bare
`'s'` doesn't pluralize an irregular-looking word correctly). Fixed to special-case
`'Loss'` → `'Losses'`, leaving `'Win'` → `'Wins'` exactly as it already was — that half
was never broken, per the briefing's own parenthetical confirming it.

**Verified, not fixed: `planned_margin` on an existing Open trade.** Traced
`openTradeModal()`'s data-population loop and `lockPreEntry()` (both `js/trades.js`)
against a trade saved before v3.17.0, where `planned_margin` is `NULL`: the field is
never wrapped in a result-based visibility check (it renders inside the same
always-present, collapsed-by-default Pre-Entry Journal section every trade has), and it
was deliberately left out of `lockPreEntry()`'s locked-field list when that function was
written — even if it had been included, `lockPreEntry()` only locks a *closed* trade's
pre-entry fields, and an Open trade is never locked in the first place. A `NULL` value
correctly leaves the input blank (`data[k]!==null` guards the assignment) rather than
rendering the literal string `"null"` or erroring. No code change was needed; this
section exists to record that the trace was actually done, not assumed, per this
project's standing rule that a "Verify" instruction gets a real check — a code-path trace
in this case, since this environment has no live browser/DB to click through (§13 rule
4), the same limitation already noted for other UI-only verifications in this file.

### v3.17.2: STOP Actually Blocks New Trades — Amended Calculator STOP State, Server-Side Enforcement

**Note on the version number** — this briefing asked to tag it as v3.17.1, but v3.17.1
(the banner removal and pluralization fix, above) had already shipped by the time this
work started. Same situation as v3.16.3/v3.16.4: per this file's own rule against
reusing a version number, this shipped as **v3.17.2**.

**Problem this closes:** through v3.17.1, "STOP — no trade" was purely a frontend
convenience — `refreshNewTradeGate()` disabled the "+ New Trade" button, but nothing
stopped `add_trade` itself from a stale open form, a second tab, or a direct API call.
There was also a second, ungated entry point this project hadn't accounted for:
`index.php`'s global topbar "+ Trade" button (present on every page, calling
`openTradeModal()` directly, bypassing `openChecklist()` entirely — the only place the
v3.17.0/v3.17.1 gate had ever been wired in).

**`helpers.php::tradeLimitStatus()`** (new) — the four-condition STOP check, extracted
verbatim out of `CalculatorController::getRiskStatus()` into a shared function returning
both the live counts (for display) and the `stopped`/`reason` pair (for gating), so
`TradeController::saveTrade()` can enforce the *exact* rule the calculator's status strip
shows, not a second copy that could drift. `getRiskStatus()` now calls this once and
merges its result with challenge-specific fields (ladder tiers, open positions, margin).

**Server-side block (`TradeController::saveTrade()`).** For `!$isUpdate` (add_trade
only — an edit is never blocked, per the briefing's own "only new entries are blocked"),
checked before anything else — before `$_POST`/JSON parsing, before the stop_loss/
take_profit required check — and rejects with exactly `{"success":false,"error":"STOP —
{reason}"}` via a plain `jsonResponse()`, not `jsonError()` (whose `{"error":...}` shape
lacks the `success` key the briefing specified). No HTTP status change — `jsonResponse()`
defaults to 200, consistent with every other validation-style rejection in this
controller (e.g. the stop_loss/take_profit check just below it). Skipped entirely when
there's no active challenge (`$chId` falsy) — the same graceful-degradation the rest of
this controller already affords a challenge-less trade.

**Both "+ New Trade" and "+ Trade" now gated the same way.** `js/trades.js::
refreshNewTradeGate()` disables and relabels both `#new-trade-btn` (Trades page) and the
new `#topbar-trade-btn` id on `index.php`'s global button, called once at app init
(`js/app.js`'s `DOMContentLoaded` handler) so the topbar button has a correct state
before the user ever visits the Trades page, and again after every `loadTrades()` (i.e.
after every save). Button label is the literal `STOP — {reason}` text the briefing
specified, not a generic "STOP — no trade" with the reason only in the tooltip (the
earlier, now-superseded v3.17.0/v3.17.1 behavior). `openTradeModal()` itself also checks
`window._riskStopReason` directly, guarded by `!data` (a brand-new trade, never an edit)
— this is what makes the topbar button safe even though it calls `openTradeModal()`
directly rather than going through `openChecklist()`'s own check, and it's what protects
any *future* caller of `openTradeModal(null)` too, without needing its own copy of the
guard.

**Deliberately NOT wired into the calculator page's own status fetch.** The calculator
lets a user browse a challenge other than the truly active one via `#calc-challenge`,
without switching which challenge is active. `refreshNewTradeGate()` always calls
`get_risk_status` with no `challenge_id` (defaulting server-side to the active
challenge) specifically so the global "+ New Trade"/"+ Trade" gate can never be
contaminated by whichever challenge happens to be selected in the calculator's dropdown
— a real correctness risk that was checked and avoided, not an oversight.

**Calculator STOP state, amended.** Previously (v3.17.0/v3.17.1), any limit breach
replaced the entire "Live Outputs" card with a STOP message — balance, margin in use,
available margin, and the ladder/status strip all lived inside that same swapped
container structurally, so the STOP display and the amended one below happened to look
similar but for the wrong reason. `pages/calculator.php` now places balance, risk %,
**Margin in Use**, and **Available Margin** in the Inputs card (all four are stop%-
independent — margin in use only ever needs the challenge and today's open positions,
never what's typed into Stop Loss %), and adds a new always-visible **Open Positions**
card (pair, direction, date, planned margin per row — exactly what `margin_in_use` sums,
so a trader can see *why* available margin is what it is, not just the total). Only
`#calc-results-inner` — the stop%-dependent sizing numbers (risk, position, margin,
quantity) and "Use in Trade Form →" — swaps to the STOP message; everything else renders
unconditionally in `runCalcUpdate()` before the `if (status.stopped)` branch is ever
reached. Distinct from the pre-existing §2 margin-only STOP (`margin_ok`, "not enough
margin for *this* trade") — unchanged, still renders inside the same swapped
`#calc-results-inner`, since it's a per-sizing check, not a trade-limits gate.

**`CalculatorController::getRiskStatus()`'s new `open_positions`/`margin_in_use`/
`available_margin` fields** — one query (`SELECT ... WHERE challenge_id=? AND
result='Open'`) backs both the Open Positions list and `margin_in_use`
(`array_sum(array_column($openPositions, 'planned_margin'))`, treating a `NULL`
`planned_margin` as 0 via PHP's normal `array_sum()` behavior — the same convention
`autoRiskPreview()`'s SQL `COALESCE(SUM(...),0)` already uses for this same figure, kept
consistent rather than reintroducing a second computation of it).

### v3.17.3: The Import Matcher Couldn't See an Open Manual Row — Investigation, Fix, Funding Attribution

**Symptom:** importing a closed Bitfunded position (the 09-21 TRXUSDT Long) inserted a
new trade instead of updating the existing open manual row, which held notes, emotions,
gate tags, SL, and session — none of it recreatable from Bitfunded's own data. Investigated
before any code was touched, per the standing rule that a "fix this" request gets a real
trace, not a guessed patch.

#### Root cause

`BitfundedImportController::matchAll()` (`app/includes/controllers/BitfundedImportController.php`)
and `preview()`/`confirm()` share one match implementation — not two independently
maintained copies, ruled out early as a possible cause. On a manually-logged, never-yet-
matched trade, `entry_price`, `pnl`, and `time_in` are **all** `NULL` —
`TradeController::saveTrade()` has had no execution-field inputs on this form since
v3.14.0, and `time_in` specifically was never in `saveTrade()`'s `$cols` at all (confirmed
by reading the form and the handler, not assumed). `matchAll()`'s original query —
`entry_price = ? OR TRUNCATE(?,2) = entry_price OR entry_price = 0`, `ABS(pnl - ?) <= ?`,
`time_in BETWEEN ? AND ?` — has three independent conditions, each evaluating to SQL's
`NULL` (not `TRUE`) against a `NULL` column under three-valued logic. A `NULL` `AND`ed into
a `WHERE` clause silently excludes the row rather than matching, erroring, or even
surfacing as `'attention'` for a human to see. The near-match fallback has the identical
blind spot (`entry_price<>?` / `pnl<>?` are also `NULL`, not `TRUE`), so the case never
even reached the attention path — it fell straight through to `'new'`.

The write path was checked and is safe: `confirm()`'s matched-row `UPDATE` never mentions
`notes`, `emotion_tag`, gate/tag `trade_variables`, `session`, `stop_loss`, `take_profit`,
or `screenshots` — confirmed by reading every column in both `UPDATE` statements, not
assumed from the file's own header comment. If a match had been found, updating would
have been completely safe.

**Scope:** every manually-logged trade has `entry_price IS NULL` until an import fills it
in — this isn't specific to TRX; the open BNBUSDT row was flagged as exposed identically,
before it ever closed.

#### Part 1 — `entry_price` returns to the manual form

Partially reverses v3.14.0's "execution data never belongs in this form" rule — a
deliberate, narrow exception, not a rollback: `exit_price`, `lot_size`, `fees`, `time_in`,
`time_out` all stay importer-only. `entry_price` comes back specifically because the
matcher has no way to find an open row without it. Added to `trade-modal.php` (Outcome
section) as `type="text"`, not `type="number"` — a native number input mangles a pasted
`"0.34403 USDT"` before JS ever sees it — with `normalizeEntryPriceInput()`
(`js/trades.js`) stripping a trailing currency label on input. `TradeController::
saveTrade()` rejects the save outright (`jsonError`) if what's left isn't a positive
number, never silently stores `0` or garbage — a stored `0` would satisfy the importer's
*legacy* `entry_price = 0` corruption-tolerance branch (from v3.14.6, for a genuinely
pre-v3.14.5-truncated price) and match the wrong row entirely. Joins `saveTrade()`'s
`$cols`; the `count($cols)+2` placeholder formula (see v3.16.2) absorbed the new column
correctly with no hardcoded number to update — verified with the same standalone
placeholder-count script used for the v3.16.2 fix (21 named columns = 21 placeholders =
21 bound values).

#### Part 2 — `matchOpenRow()`, a second match branch

New private method in `BitfundedImportController`, called only when `matchAll()`'s
original branch finds zero exact candidates (no double-counting risk — a row with real
execution data would already have been found or ruled ambiguous above). Match key:
`challenge_id` + `pair` + `direction` (exact) + `trade_date = DATE(Opening Time)` (exact
day, ±1 day fallback if same-day finds nothing — a late-night trade can straddle
midnight) + `(result IS NULL OR result NOT IN ('Win','Loss','Break Even'))` (the explicit
`IS NULL` branch is load-bearing: a bare `NOT IN` returns `NULL`, not `TRUE`, against a
`NULL` `result` — which is exactly what an untouched Result dropdown submits, per
`saveTrade()`'s `?: null` normalization — a plain `NOT IN` here would silently recreate
the identical bug one level down). Entry price, only when the candidate actually has one,
within 0.5% tolerance — skipped entirely (not compared) when `NULL`, computed in PHP not
SQL specifically so "skip the condition" (NULL) and "present but out of tolerance"
(disqualified) stay two different outcomes a single SQL `OR entry_price IS NULL` clause
would have collapsed into one.

Candidate resolution: one → matched, routes to the existing (confirmed-safe) update path.
More than one → attention, lists every candidate id, never picks the first. Zero → falls
through to the existing near-match/new logic unchanged. When both priced and priceless
candidates exist, the priced ones win outright — a real, checkable number beats "we don't
know yet," and NULL-entry candidates are dropped from consideration entirely rather than
padding out an otherwise-resolvable set.

#### Part 3 — loud, not silent

**Trade Log row indicator:** any non-closed row (`!['Win','Loss','Break Even'].includes(t.result)`)
with `entry_price IS NULL` shows an amber "⚠ Add fill price" badge in the Entry column,
click-through to edit — catches it day-to-day while the position is open and the
Bitfunded card is still on screen. **Import preview blocker:** whenever a pasted position
resolves via `matchOpenRow()` with `no_entry_price: true` (matched *or* attention), a
loud red card renders above the ordinary attention card:
`"{pair} {direction} — open trade found with no entry price. Add the fill price to that
trade before importing, or this will be logged as a new trade."` — shown even for a row
that resolved cleanly, since the underlying candidate still has no entry price on file,
worth fixing regardless of what this particular import run does with it. Recoverable, not
blocking: `preview()`/`confirm()` both re-parse on every call, so leaving the page, adding
the price, and re-previewing picks up the change with nothing cached against it.

#### Part 4 — naming the NULL-guard mechanism explicitly

Every condition across both branches that touches a nullable column carries a comment
naming which NULL guard it is — three total (the original branch's `entry_price`/`pnl`/
`time_in`, `matchOpenRow()`'s `result`, and its `entry_price` tolerance check), plus a
note on the now-unreachable-for-this-case near-match fallback acknowledging it shares the
same blind spot. One mechanism — a comparison against a `NULL` column evaluates to
`NULL`, not `TRUE` or `FALSE`, and silently drops the row from an `AND`-chained `WHERE`
clause — has now caused this exact failure shape four separate times across this
project's history (the v3.12.x hand-typed-timestamp duplicates, v3.16.x's `exit_quality`/
`NOT IN` traps, and this one); naming it explicitly at each site is cheaper than
re-discovering it a fifth time.

#### Part 5 — reconciliation no longer reports a false mismatch for open positions

Bitfunded's own reported `Balance` (Transaction History's latest row, or a manually
entered figure) is the account's **free wallet balance** — it excludes margin locked in a
still-open position. `$derived` has no such exclusion (every closed trade's realised P&L
against `starting_balance`, closer to full account equity), so comparing the two directly
reported a false "mismatch" of roughly however much margin was locked — not a real
discrepancy, a unit mismatch between two different balance concepts. Fixed by adding open
positions' summed `planned_margin` back onto the reported free balance before comparing.
`planned_margin` is the only figure this codebase has for what's actually locked; if even
one open position's is unknown (`NULL`), the correction itself would be wrong, so
`reconciliation()` returns `comparison_unavailable: true` instead of a `difference` —
never a silently-wrong flagged mismatch built on an incomplete correction.

#### Part 6 — funding, attributed per position

**The real `Type` vocabulary — confirmed against a verbatim real paste, not guessed.**
Two prior candidate strings ("Realized PnL", "Margin Transfer") were explicitly ruled
out — neither appears in a real paste. Five real values, capitalization inconsistent
between them: `Funding Fee`, `Opening fee`, `Closing fee`, `Open Position`,
`Close Position` — every comparison in this codebase against any of them is
case-insensitive (`strcasecmp`). `Open Position`/`Close Position` carry the traded symbol
in the `Transaction` column, slash-separated (`TRX/USDT`) — normalized by stripping the
slash and uppercasing, to match `trades.pair`'s own format (`TRXUSDT`). Every other row's
`Transaction` column is just `USDT` — no symbol at all, which is the entire reason
per-position funding can't be read off directly and has to be derived. `Balance` does
**not** update per row (several rows share one value in a real paste) — `latest_balance`
is keyed off the row with the latest `Time`, never row order or a running delta.

**`bf_attribute_funding()`** (`bitfunded_parser.php`, pure — no DB, consistent with that
file's existing "parsing only" scope) derives one position's funding cost:
`open_margin − returned_margin + pnl`, where `open_margin`/`returned_margin` are the
absolute values of the matched `Open Position`/`Close Position` rows' `Amount` and `pnl`
is the position's own signed realized P&L from Position History (no `Realized PnL` row
type exists in a real Transaction History paste at all). Verified against real data:
TRX margin out `3488.4954`, back `3394.5281`, pnl `-91.288` → `2.6793`, matching the sum
of the three real TRX `Funding Fee` rows (`0.1527+0.7599+1.7664 = 2.6790`, the `0.0003`
gap being ordinary sub-cent rounding, the same class already documented at v3.13.2/
v3.13.4). **Explicit precondition, stated in the function's own doc comment, not checked
in code: isolated margin only.** The derivation only holds because margin is locked to a
single position and returned on that position's own close — under cross margin there is
no per-position margin row at all, and calling this against a cross-margin account's
Transaction History would not fail loudly; it would silently return a plausible-looking,
meaningless number, because the two rows this function looks for simply don't exist in
that shape. This importer has no way to detect which margin mode an account uses, so this
is a documented precondition of calling the function, not a runtime guard.

**`bf_find_position_row()`** matches `Open Position`/`Close Position` rows exact-timestamp
first (a real row's own `Time` is identical to the position's Opening Time/Liquidate Date
— confirmed against real data, both landed on the same second), falling back to a narrow
±60 second window only if the exact second has nothing, and returning `null` beyond
that — never "whichever is nearest." An unbounded nearest-in-time search would happily
attribute a *different* position's own margin event from days earlier and report a
confident, wrong number — the identical silent-wrong shape as the bug this whole release
exists to fix, just relocated into a new function. More than one candidate at whichever
precision tier succeeds returns `null` immediately, at that tier, without ever trying the
next — an ambiguous match is not a match, and this function never disambiguates by
picking the closer of two.

**Funding is not sign-clamped.** A trader can be paid to hold a position; `bf_attribute_
funding()`'s return value can be negative, and `net_pnl` must be able to increase from
it, not just decrease. Tested directly: a synthetic case where returned margin (1050)
exceeds open margin (1000) plus pnl (10) asserts a `-40.0` result.

**Schema:** `trades.funding DECIMAL(12,4) NULL DEFAULT NULL` (migration
`2026_09_22_0001_add_trades_funding.sql`), nullable and un-backfilled, per the same
"NULL means unknown, 0 means measured as zero" convention this whole release is about
not collapsing. `net_pnl = pnl - fees - COALESCE(funding, 0)` going forward, in both
`confirm()`'s matched-`UPDATE` and new-row `INSERT` — the `?? 0.0` in PHP is a deliberate,
narrowly-scoped COALESCE-equivalent: it lets `net_pnl` fall back to the pre-v3.17.3
formula when funding is unknown, without ever writing a fabricated `0` onto the column
itself. **No backfill, no recompute of existing rows** — every trade imported before this
release keeps its own already-correct `pnl - fees` value exactly as recorded.

**Confirmed, not fixed: fees are not double-charged.** Transaction History's `Opening
fee`/`Closing fee` rows are read into `$funding['rows']` for the margin/funding
derivation only, never summed into `trades.fees` — that column stays exclusively
Position History's own combined `Fee` field, unchanged. Verified against real data: TRX's
`Opening fee` (`6.9769`) + `Closing fee` (`6.9404`) = `13.9173`, matching the card's own
combined Fee (`13.9175`) to the same sub-cent rounding gap already documented elsewhere —
the same money reported at two granularities, not two separate costs. No code change was
needed here; this was a read-then-confirm, the same discipline as the "verify before
fixing" investigation that opened this whole release.

**Caught during review, before writing: `reconciliation()`'s `$importedSum` must NOT also
subtract per-position funding.** `$fundingAdj` (a few lines further down the same
function) already subtracts the *whole pasted Transaction History's* `funding_total` from
`$derived` — which, for a position being imported in the same request, is the same
funding `bf_attribute_funding()` would also attribute to it individually. Subtracting it
in both places would double-count: once per-position in `$importedSum`, once again for
the whole paste via `$fundingAdj`. Caught by re-reading the function after writing an
initial (wrong) version that added a per-position subtraction to `$importedSum` — fixed
by leaving `$importedSum` exactly as it was before this release (`pnl - fees`, no funding
term). This mirrors the ticket's own explicit scope boundary — "don't double-count: if
per-trade funding starts feeding equity, that's a separate decision, not part of this
ticket" — the reconciliation preview's arithmetic is deliberately unchanged by Part 6;
only the stored per-trade `net_pnl` is funding-aware. `challenges.funding_adjustment`
itself (the challenge-level total, written from `$funding['funding_total']`) is untouched
by this entire release, exactly as scoped.

**Self-test:** `bitfunded_parser.php`'s Transaction History fixture — previously a
fabricated sample using a `'Realized PnL'` `Type` that, on inspection of a real paste,
does not exist — replaced with the verbatim 13-row real paste above (the identical
mistake this file's own Position History self-test already learned from once, at
v3.14.4: a plausible-looking guess passing every test while the live path kept failing).
63 assertions total, including the real-data TRX (`2.6793`) and BNB (`null`, still open,
no Close Position row) cases, a symbol absent from the paste entirely (`null`), and four
synthetic edge cases exercising exactly the four tightenings above: sign-not-clamped
(`-40.0`), two candidates inside the 60s tolerance (`null`), two candidates at the exact
same timestamp (`null`), and a real candidate that exists but sits outside the 60s
tolerance (`null`, not matched as "nearest available"). All 63 pass.

### v3.18.0: Daily Report Card — a New Module, Built From a Standalone Build Briefing

This release is a full new module (Daily Report Card + AI Review), built from a build
briefing rather than a bug/fix ticket. It's the first module in this codebase with its
own ten-table schema, its own sidebar entry, and its own Anthropic API integration — the
first time this app calls out to an LLM at all. Several parts of the briefing didn't map
cleanly onto this app's actual architecture (no "accounts" table, no client-side router,
no job queue on Namecheap shared hosting), so this section documents every judgment call
made reconciling the two, the same discipline this file applies to every other release.

#### Judgment calls, and why

1. **"account_id" -> "challenge_id."** The briefing's schema is written generically
   ("per user, per account") for an app this codebase isn't — this schema's real
   per-user trading-account concept is a `challenge` (see §3's Challenge Scoping Rule).
   `report_cards.challenge_id` keeps the briefing's exact design (`NOT NULL DEFAULT 0`,
   no foreign key — MySQL treats `NULL` as distinct in a unique index, so a nullable
   column would let the same user/date collide across challenges, and `0` is a real,
   permanent sentinel that an `AUTO_INCREMENT` `challenges.id` will never legitimately
   contain).
2. **`utf8mb4_unicode_ci` -> `utf8mb4_general_ci`.** Every existing table in this schema
   uses `general_ci` (§3A's own migration checklist says so explicitly, after
   `2026_09_15_0001` shipped without it and needed a follow-up fix). Matched the
   established convention over the briefing's literal collation.
3. **No per-user timezone exists anywhere in this schema.** `users.timezone` was only
   ever a §14 wishlist column, never actually migrated (confirmed by grep before writing
   any code, not assumed). The briefing itself names CAT (UTC+2) as the trader's zone, so
   `ReportCardController::REPORT_CARD_TZ` is a fixed `'Africa/Kigali'` constant, not a
   per-user preference. **This is a real, flagged gap** — if this app ever onboards a
   trader in a different zone, session-block times will display and edit in the wrong
   local hours for them until this becomes a real per-user setting.
4. **No client-side router exists to serve `/report-card/{date}`-style routes.**
   `index.php`'s `showPage()` only ever toggles which `.page` element is visible by id —
   there is no `pushState` or route-matching anywhere in this app. Implemented as one
   sidebar page (`pages/reportcard.php`, nav id `reportcard`) with three internal views
   (Card / History / Templates) switched by `js/report-card.js::showRcView()`, the same
   "one page per sidebar item" shape every other page in this app already uses. Building
   a real router was a much bigger architectural change than this briefing scoped.
5. **The trade-count guard reads `challenge_limits`, not a hardcoded 2/day-4/week.** The
   briefing's own §5 names "max 2/day, 4/week" as if it were a fixed rule, but this app's
   own v3.17.0 release already generalized exactly this into `challenge_limits`
   (`tradeLimitStatus()`, shared with the Auto Risk Calculator's status strip) specifically
   so a limit is never hardcoded twice. Reused rather than reintroducing the hardcode this
   codebase already fixed once.
6. **"Run as a background job... never block the page request" (§7.3) is approximated,
   not real.** This hosting has no queue/worker infrastructure (Namecheap shared cPanel,
   no frameworks — §1). `ReportCardAiController::runFor()` still writes the
   `pending -> running -> complete/failed` states the schema expects, but all of it
   happens synchronously inside one request — there is no concurrency to speak of. The
   "optional nightly job" and "weekly review on a schedule" pieces are
   `report_card_cron.php`, a standalone token-protected entry point at the site root
   (identical pattern to `migrate.php`), meant to be hit by a **cPanel Cron Job** — the
   only real scheduling primitive this hosting offers. Suggested crontab lines are in
   that file's own header comment.
7. **Gate score / "15m trigger" aren't fixed columns.** The briefing's §7.1 behaviour
   list names these as if they were specific trade fields, but this schema's strategy
   checklists are user/strategy-defined (`strategy_variables`, see the Strategy Lab) —
   there is no universal "gate score 1-5" column, and assuming one exists would silently
   break for any trader whose strategy doesn't happen to have a variable with that exact
   label. The AI payload instead includes each trade's full `strategy_variables`
   label->value map, generically, so the model judges against whatever the trader's own
   checklist actually is.
8. **Streak semantics (§2, "don't break the chain") aren't specified exactly.**
   `ReportCardController::computeStreak()` walks backward from today, but starts from
   yesterday instead if today's own card isn't `complete` yet — otherwise a trading day
   still in progress would zero out an otherwise-intact streak every single afternoon.
   Not a quoted spec; a reasonable interpretation, documented as the judgment call it is.
9. **"Light day" template's Review block has no stated time** in the briefing's own
   §4.2 table (just "Single window 14:00-16:00 . Review") — placed immediately after the
   window (14:00-14:30 CAT) rather than left unspecified.

#### AI Review mechanics

`ReportCardAiController::callAnthropic()` uses a **forced tool call**
(`tool_choice: {type:"tool", name:"submit_review"}`) rather than asking the model to
emit JSON in prose and hoping it parses — the tool's `input_schema` encodes exactly
§7.2's required shape (`alignment_score`, `discipline_score`,
`contradictions`/`behavior_patterns`/`thinking_patterns`/`strengths`/`risks` each with
cited evidence, `summary`, `one_change`, `suggested_goal`, `repeat_of`), so there is no
manual "attempt to extract a JSON blob from free text" step that could silently fail on
a slightly-off response. The model is `claude-sonnet-5` by default
(`ReportCardAiController::MODEL`, overridable via a `REPORT_CARD_AI_MODEL` constant in
`config.php` without a code change), and both `model` and `prompt_version` are written
onto every `report_card_ai_reviews` row so old reviews stay interpretable if the prompt
or model ever changes later (the exact same reasoning §7.3 itself gives).

**Requires `ANTHROPIC_API_KEY` defined in `includes/config.php`** — never committed to
this repo, same as every other secret (§13 rule 4, same file `MIGRATE_TOKEN` already
lives in). Without it, `callAnthropic()` fails loudly with a clear `error_message` and
`status='failed'`; it never silently no-ops or fakes a response. `report_card_cron.php`
similarly needs its own `REPORT_CARD_CRON_TOKEN` constant, checked with `hash_equals()`
the same way `migrate.php` checks `MIGRATE_TOKEN`.

**Payload builder (`ReportCardAiController::buildPayload()`)** assembles behaviour
(trades: pair/direction/times, session, the block they fell in or "unassigned", risk
sizing vs. the ladder, target R, realised R and its `recorded`/`estimated` provenance,
exit reason/quality, time since the previous trade, whether it followed a loss, and the
trade's own `strategy_variables` map) and thinking (every card field, per-block
grade/playbook/sizing/comments, mantras checked) into one payload, plus context (the
last 5 cards' `one_change` and up to 20 recent unacknowledged findings) — exactly §7.1's
three sections, built from a single query pass over `report_cards`/`report_card_blocks`
per day in the period rather than one query per card, since a weekly review spans 7 of
them.

**Findings explosion** (`explodeFindings()`) maps the tool response's five arrays
directly onto `report_card_ai_findings.type`, defaulting `strengths` to `severity='low'`
(everything else defaults to `'medium'` if the model omits it) and storing whatever
`evidence` object the model provided as-is in the `JSON` column — this table is what
makes the module compound across months (§ intro), so nothing here reshapes or drops the
model's own evidence structure.

#### What a card actually is, end to end

`ReportCardController::findOrCreateCard()` is the one place a card comes into
existence: on first `get_report_card` for a given (user, active-challenge, date), it
seeds this user's five reference templates if they have none yet (`report_card_templates
.user_id` is `NOT NULL`, so a migration literally cannot seed rows for users that don't
exist yet — this can only happen lazily, in PHP, the first time a template list is
needed), picks a template by weekday match then `is_default` then blank, and copies that
template's blocks into `report_card_blocks` once. Every subsequent load of that date
just reads the existing row — editing the day never touches the template, and editing
the template (`updateTemplate()`) never touches a card that already copied its blocks,
satisfying the build briefing's own acceptance criteria ("deleting a template alters no
existing card") by construction, not by a special-case check.

**Trade attribution and P&L autofill are both computed live, never stored** — the same
"derive, don't store" principle `enrichChallenge()` already established for
`challenges.current_balance` (§3, v3.13.0): a block's UTC window is
`[card_date + start_utc, card_date + end_utc)`, pushed a day forward on the end if
`end_utc <= start_utc` (midnight-crossing, build briefing rule 8), and every trade whose
`time_in` falls in zero block windows is surfaced under Unassigned rather than dropped —
per the briefing, that absence is itself the signal of unplanned trading, not a gap to
hide. `pnl_auto` is a live `SUM(net_pnl)` over the same date+challenge, shown next to the
manual `pnl` override, never the two conflated into one column.

#### Not attempted in v3.18.0

- **Per-user timezones** — see judgment call 3 above.
- **A real background job queue** — see judgment call 6 above; `report_card_cron.php`
  is the pragmatic substitute this hosting actually supports.
- **Monthly AI reviews** — the schema's `scope` enum already includes `'monthly'` and
  `ReportCardAiController::runFor()` takes `scope` as a plain parameter, so adding a
  monthly cron mode is a small follow-up, not a schema change; not wired into
  `report_card_cron.php` in this release since the briefing's own §7.3 only asked for
  daily (manual) and weekly (scheduled).
- **A findings-over-time chart beyond the single alignment-score line** on the History
  view (§7.4 asks for "a findings-over-time chart" generally) — the alignment-score line
  chart ships; breaking findings down by type/severity over time is a reasonable
  follow-up once there's enough real review history to make such a chart meaningful.

## 3A. DATABASE MIGRATIONS (added v3.7.0)

Before v3.7.0, `updater.php` deployed files only — nothing ever ran SQL against the live
database except an inline `db_migrations` array in `version.json` (documented below in §16,
executed by `updater.php`'s `apply` action). That inline mechanism has no tracking table and no
checksum, so there was never a durable record of what had actually run on live. As of v3.7.0
there is a proper tracked runner. **Prefer it over `db_migrations` in `version.json` for all new
schema work** — the old field still exists and still works, but stop adding to it.

### How it works

- Migration files live in `migrations/` (repo path `app/migrations/`), plain `.sql`, one logical
  change per file.
- `migrate.php` scans that directory, compares against a `schema_migrations` tracking table it
  creates itself, and applies whatever is pending, in filename order.
- Every applied (or baselined) file has its sha256 checksum recorded. If a file is edited after
  it was applied, the checksum no longer matches and the runner stops and reports it instead of
  silently re-running or ignoring the edit.
- MariaDB commits DDL implicitly, so there is no rollback. A migration that fails partway leaves
  the schema partly changed — the runner's error output names the exact statement that failed so
  that state can be reasoned about. Keep migrations small for this reason.

### Naming

```
migrations/YYYY_MM_DD_NNNN_short_description.sql
```
The filename is the sort order, so the sequence number must be zero-padded and unique for that
date. Example: `2026_09_20_0001_add_default_strategy_id_to_challenges.sql`.

### Adding a migration

1. Write the `.sql` file in `app/migrations/` — plain SQL, statements separated by `;`, no PHP.
2. **Every `CREATE TABLE` must specify `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=
   utf8mb4_general_ci` explicitly.** Every other table in this schema uses it. Without it, a new
   table silently falls back to the server/schema default — `latin1_swedish_ci` on live, not
   utf8mb4 — and any non-Latin1 character (emoji, curly quotes from a pasted note, non-English
   text) written to it is mangled or rejected instead of stored correctly. This exact mistake
   shipped in `2026_09_15_0001_create_trade_journal.sql` (v3.11.0) and needed a follow-up
   `CONVERT TO CHARACTER SET` migration (`2026_09_15_0002`) to fix, since it wasn't caught before
   both new tables were live. Check this before every `CREATE TABLE`, not after.
3. Add its path to `version.json`'s `"files"` array (`{"path": "migrations/...sql", "critical": false}`) —
   if it's not in the manifest, `updater.php` will never deploy it to the server, full stop.
4. Bump `current_version`, commit, push, tag, release.
5. **Export the database before running `?mode=run` on live.** DDL can't be rolled back — a
   backup is the only undo.
6. Deploy via the normal updater workflow (Acrob runs `updater.php`), then hit
   `migrate.php?mode=run&token=...` to apply it.

### Running it

`migrate.php` sits next to `updater.php` at the site root, token-protected via a constant defined
in `includes/config.php` (never in this repo — Acrob sets it by hand on the server):

- `migrate.php?mode=status&token=...` — lists applied/pending, changes nothing. Default mode.
- `migrate.php?mode=run&token=...` — applies pending migrations, stops at the first failure.
- `migrate.php?mode=baseline&token=...` — records pending migrations as applied without running
  them. Used once per already-existing table, so a migration describing a table that's already
  live isn't re-run against it.

Missing or wrong token → 403, logged via `error_log()`.

### Operational Lessons From Running 0001–0006 Live (v3.9.1)

Both of these cost real time getting migrations 0001–0006 applied to `theittav_journal` and are
worth knowing before touching the runner again:

1. **`mode=baseline` is only ever correct for a migration describing schema that already
   exists.** It was run by mistake against 0004–0006 (which described *pending* changes, not
   already-live ones), which falsely marked them applied with nothing actually run. Recovery was
   manual: delete those rows from `schema_migrations`, then run `mode=run` for real. Baseline
   trusts you completely — it does not check the live schema against the file, so a wrong call
   here fails silently until something downstream (like a missing FK) surfaces it.
2. **Migration `2026_09_13_0004_add_trade_variables_foreign_keys.sql` is not self-sufficient on
   its own.** It failed on first run because five `trade_variables` rows referenced a `trade_id`
   that no longer existed (an already-deleted trade), which the new `ON DELETE CASCADE` FK
   rejected outright. Those five rows were deleted by hand before the FK would apply. If this
   migration ever runs again on a fresh restore or a different environment, it will fail the same
   way — the orphan cleanup (`DELETE FROM trade_variables WHERE trade_id NOT IN (SELECT id FROM
   trades)`, run before the `ALTER TABLE`) belongs inside the migration file itself, not as tribal
   knowledge. Not fixed retroactively here since 0004 already ran successfully on the only
   environment that matters (`theittav_journal`) and migration files are checksum-locked once
   applied — a follow-up migration should add the guard for any future environment, rather than
   editing 0004 after the fact.

---

## 4. API ENDPOINTS REFERENCE

### How JavaScript Calls the API

```javascript
// GET
const data = await api('get_trades');

// GET with parameters
const data = await api('get_trades&pair=BTCUSDT&from=2026-03-01');

// POST with JSON body
const data = await api('add_trade', 'POST', { pair: 'BTCUSDT', direction: 'Long' });

// POST with file upload
const fd = new FormData();
fd.append('screenshot', fileInput.files[0]);
const resp = await fetch('includes/api.php?action=add_trade', { method: 'POST', body: fd });
```

### Endpoint Map

| Action | Method | Controller | Description |
|--------|--------|-----------|-------------|
| `get_user` | GET | ProfileController | Current user + active challenge |
| `update_profile` | POST | ProfileController | Name, avatar, bio, password |
| `update_settings` | POST | ProfileController | Legacy compat — profile + challenge |
| `get_challenges` | GET | ChallengeController | List all challenges |
| `get_active_challenge` | GET | ChallengeController | Active challenge details |
| `add_challenge` | POST | ChallengeController | Create challenge |
| `update_challenge` | POST | ChallengeController | Edit challenge |
| `delete_challenge` | POST | ChallengeController | Delete challenge + trades |
| `switch_challenge` | POST | ChallengeController | Set active challenge |
| `get_trades` | GET | TradeController | List trades (filtered, challenge-scoped) |
| `add_trade` | POST | TradeController | Log new trade |
| `update_trade` | POST | TradeController | Edit trade |
| `delete_trade` | POST | TradeController | Delete trade + screenshot |
| `get_stats` | GET | StatsController | Full stats for active challenge |
| `get_alerts` | GET | AlertController | Today's risk alerts |
| `calculate_risk` | POST | CalculatorController | Position size calculator (legacy, not wired to the UI — see §11) |
| `size_preview` | POST | CalculatorController | Trade-form pre-trade sizing panel (v3.16.1 B4) |
| `auto_risk_preview` | POST | CalculatorController | Auto Risk Calculator live outputs (v3.17.0) |
| `get_risk_status` | GET | CalculatorController | Trade-limits status + ladder tiers (v3.17.0) |
| `get_pairs` | GET | PairController | List active pairs |
| `add_pair` | POST | PairController | Add trading pair |
| `delete_pair` | POST | PairController | Soft-delete pair |
| `import_trades` | POST | ImportController | Batch import from Excel (max 500) |
| `get_strategy_trades` | GET | StrategyController | List strategy tests |
| `get_strategy_stats` | GET | StrategyController | Strategy test statistics |
| `add_strategy_trade` | POST | StrategyController | Log strategy test |
| `delete_strategy_trade` | POST | StrategyController | Delete strategy test |
| `get_reviews` | GET | ReviewController | List weekly reviews |
| `save_review` | POST | ReviewController | Create/update review |
| `get_report_card` | GET | ReportCardController | Get/create the card for a date (default today) |
| `save_report_card` | POST | ReportCardController | Save header/free-text fields |
| `get_report_card_history` | GET | ReportCardController | History list + streak |
| `add_report_card_block` / `update_report_card_block` / `delete_report_card_block` | POST | ReportCardController | Session block CRUD |
| `reorder_report_card_blocks` | POST | ReportCardController | Persist drag-reorder |
| `get_report_card_templates` / `add_report_card_template` / `update_report_card_template` / `delete_report_card_template` | GET/POST | ReportCardController | Template CRUD (§4.2 seed templates lazy-seeded on first `get_report_card_templates` call per user) |
| `apply_report_card_template` | POST | ReportCardController | Replace a card's blocks with a template's |
| `save_report_card_blocks_as_template` | POST | ReportCardController | "Save these blocks as a template" |
| `get_report_card_mantras` / `add_report_card_mantra` / `update_report_card_mantra` / `delete_report_card_mantra` | GET/POST | ReportCardController | Standing mantra CRUD |
| `toggle_report_card_mantra_check` | POST | ReportCardController | Per-card daily check-off |
| `add_report_card_ticker` / `update_report_card_ticker` / `delete_report_card_ticker` | POST | ReportCardController | Ticker row CRUD |
| `upload_report_card_ticker_image` / `delete_report_card_ticker_image` | POST | ReportCardController | Ticker chart images |
| `run_ai_review` | POST | ReportCardAiController | Daily AI review — card must be `status='complete'` |
| `run_weekly_ai_review` | POST | ReportCardAiController | Weekly AI review over the last 7 cards |
| `get_ai_reviews` / `get_ai_review` | GET | ReportCardAiController | List / single review + findings |
| `acknowledge_ai_finding` | POST | ReportCardAiController | Mark a finding acknowledged |

---

## 5. HELPER FUNCTIONS REFERENCE

### helpers.php

| Function | Purpose |
|----------|---------|
| `csrfCheck()` | Validates Origin/Referer on form POSTs |
| `num($val, $default)` | Safely converts to float |
| `validId($val)` | Validates positive integer ID |
| `safeMediaDir($uid)` | Returns upload dir, creates if needed |
| `handleScreenshot($uid)` | Upload: 5MB limit + MIME check + random filename |
| `getActiveChallenge()` | Returns active challenge row for current user |
| `jsonInput()` | Reads JSON POST body |
| `jsonResponse($data)` | Sends JSON + exits |
| `jsonError($msg)` | Sends error JSON + exits |

### config.php (already exists, never edit)

| Function | Purpose |
|----------|---------|
| `getDB()` | Returns PDO database connection |
| `uid()` | Returns current user's ID from session |
| `currentUser()` | Returns full user row |
| `requireLogin()` | Redirects to login if not authenticated |

---

## 6. HOW TO ADD A NEW FEATURE

### Pattern (3 steps, zero edits to existing files)

**Step 1: Create controller**
```php
// includes/controllers/AiCoachController.php
class AiCoachController {
    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getAdvice() {
        jsonResponse(['advice' => 'Wait for confirmation candle']);
    }
}
```

**Step 2: Add one line to router.php**
```php
'get_ai_advice' => ['AiCoachController', 'getAdvice'],
```

**Step 3: Call from JavaScript**
```javascript
const advice = await api('get_ai_advice');
```

That's it. No risk of breaking anything else.

---

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

---

## 9. BRAND IDENTITY — FUNDEDCONTROL

### Identity

| Element | Value |
|---------|-------|
| Product name | FundedControl |
| Former name | FSA Trading Journal |
| Tagline | Control Your Trading. Get Funded. Stay Funded. |
| Alt tagline | Discipline is the edge. |
| Positioning | Discipline-first, no hype, real execution |
| Style | "Light Authority" — Chase + Bloomberg inspired |

### Brand Colors (CSS Variables)

```css
:root {
    --fc-bg:             #FAFBFC;           /* Page background — off-white */
    --fc-card:           #FFFFFF;           /* Card backgrounds */
    --fc-border:         #E2E8F0;           /* Borders */
    --fc-sidebar:        #0B1D3A;           /* Sidebar — deep blue */
    --fc-primary:        #1A56DB;           /* Primary buttons/links */
    --fc-success:        #0FA958;           /* Profit, wins — green */
    --fc-danger:         #DC3545;           /* Loss, risk — red */
    --fc-warning:        #F59E0B;           /* Caution — amber */
    --fc-info:           #3B82F6;           /* Info — blue */
    --fc-text:           #0B1D3A;           /* Primary text */
    --fc-muted:          #6C7A8D;           /* Secondary text */
    --fc-text-light:     #F0F3F7;           /* Text on dark bg */
    --fc-sidebar-muted:  #7A8FA5;           /* Sidebar nav items */
    --fc-active:         rgba(26,86,219,0.3); /* Active nav bg */
    --fc-badge-win:      #E3F2E8;           /* Win badge bg */
    --fc-badge-win-text: #1B7A3D;           /* Win badge text */
    --fc-badge-loss:     #FDEAEA;           /* Loss badge bg */
    --fc-badge-loss-text:#DC3545;           /* Loss badge text */
}
```

### Brand Fonts

```
https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap
```

| Font | Weight | CSS Variable | Usage |
|------|--------|-------------|-------|
| Outfit | 600 | `--fc-font-display` | Headlines, titles, logo |
| Outfit | 500 | `--fc-font-display` | Semi-bold — card titles, table headers, buttons |
| Outfit | 400 | `--fc-font-body` | Body, labels, descriptions, sidebar nav |
| JetBrains Mono | 500 | `--fc-font-mono` | All financial numbers — P&L, balance, %, R |
| JetBrains Mono | 400 | `--fc-font-mono` | Secondary numbers — dates, timestamps |

### Complete Type Scale

```css
:root {
    /* Page level */
    --fc-size-page-title:    24px;   /* Page titles — "Dashboard", "Trade Log" */
    --fc-size-modal-title:   20px;   /* Modal titles — "Add Trade", "Edit Challenge" */

    /* Component level */
    --fc-size-card-title:    16px;   /* Card titles — "Performance Overview" */
    --fc-size-button:        14px;   /* All button text */
    --fc-size-nav-item:      14px;   /* Sidebar nav items */
    --fc-size-body:          14px;   /* Body text, table data, form inputs */
    --fc-size-secondary:     13px;   /* Secondary text, descriptions, notes */

    /* Small / labels */
    --fc-size-table-header:  11px;   /* Table column headers — UPPERCASE + letter-spacing */
    --fc-size-label:         11px;   /* Form labels, card sub-labels — UPPERCASE */
    --fc-size-nav-section:   10px;   /* Sidebar section headers — "TRADING", "ANALYSIS" */
    --fc-size-badge:         11px;   /* Win / Loss / Break Even badges */

    /* KPI Numbers — JetBrains Mono */
    --fc-size-kpi-large:     30px;   /* Dashboard KPIs — balance, total P&L */
    --fc-size-kpi-medium:    22px;   /* Secondary KPIs — win rate, avg R */
    --fc-size-kpi-small:     16px;   /* Inline KPIs — challenge progress bar numbers */
    --fc-size-number:        14px;   /* Table numbers — P&L per trade, R-multiple */
}
```

### Type Scale Usage Rules

| Element | Size | Font | Weight | Transform |
|---------|------|------|--------|-----------|
| Page title | 24px | Outfit | 600 | Sentence case |
| Modal title | 20px | Outfit | 600 | Sentence case |
| Card title | 16px | Outfit | 600 | Sentence case |
| Sidebar nav item | 14px | Outfit | 400 | Sentence case |
| Button text | 14px | Outfit | 500 | Sentence case |
| Body / table data | 14px | Outfit | 400 | — |
| Secondary text | 13px | Outfit | 400 | — |
| Table header | 11px | Outfit | 500 | UPPERCASE + `letter-spacing: 0.6px` |
| Form label | 11px | Outfit | 500 | UPPERCASE + `letter-spacing: 0.5px` |
| Sidebar section | 10px | Outfit | 600 | UPPERCASE + `letter-spacing: 1px` |
| Badge text | 11px | Outfit | 500 | Sentence case |
| Dashboard KPI | 30px | JetBrains Mono | 500 | — |
| Secondary KPI | 22px | JetBrains Mono | 500 | — |
| Inline KPI | 16px | JetBrains Mono | 500 | — |
| Table number | 14px | JetBrains Mono | 500 | — |
| Date / timestamp | 13px | JetBrains Mono | 400 | — |

### UI Rules
- Background: off-white (`#FAFBFC`) — NOT dark
- Cards: white with `#E2E8F0` borders, `8px` radius
- Sidebar: the ONLY dark element — provides authority contrast
- Green: ONLY for profit/wins — never decorative
- Red: ONLY for loss/danger — never decorative

### Standard Test Viewport for Sidebar/Layout Work (added v3.9.1)

**1366 × 590** is Acrob's real laptop viewport (Windows, Chrome, tab bar + address bar +
bookmarks bar + taskbar all present) and is the standard regression case for any sidebar or
layout change from here on. It is **desktop-width, short-height** — the mobile drawer breakpoint
(`@media(max-width:900px)`) does not engage at this width, so it exercises a completely different
CSS branch than a narrow/short test does.

The v3.9.0 sidebar fix was verified in headless Chrome at 768px/600px **heights** but at narrow
widths, which only exercises the mobile drawer branch. That branch worked; the desktop-width
branch at short heights did not, and shipped broken anyway because it was never actually tested —
headless screenshots at a nominal height are not equivalent to the real machine, since headless
has no tab bar/address bar/bookmarks bar/taskbar eating into the usable height. **Always test the
literal pixel dimensions, not just "short" as a category, and always include desktop width.**

When testing sidebar/layout changes, check every breakpoint that produces a materially different
layout, not just one:
- Desktop, short height (**1366 × 590** — the standard case)
- Desktop, typical height (1366 × 768)
- Desktop, tall / nothing should need to scroll (1920 × 1080)
- Mobile drawer, narrow (375 × 600)
- Just above/below the `900px` drawer breakpoint (900×590 drawer / 901×590 desktop)

---

## 10. FEATURE ROADMAP & CURRENT PRIORITIES

### Version History

| Version | Date | What Changed |
|---------|------|-------------|
| v2.0.0 | 2026-03-10 | Initial FSA Journal — monolithic |
| v2.2.5 | 2026-03-17 | Screenshot upload fix, session fix |
| v2.2.7 | 2026-03-19 | Security hardening (CSRF, validation, file upload) |
| v2.3.0 | 2026-03-20 | Challenge system + multi-challenge support |
| v3.0.0 | 2026-03-20 | Modular backend — 11 controllers replace monolithic api.php |

### Build Phases (Current Focus)

**Phase 2 — Frontend Split (in progress)**
- Split `index.php` (540 lines) into `pages/` files
- Split modals into `modals/` files
- Split `app.js` (800+ lines) into JS modules per page
- Zero visual changes — pure refactor

**Phase 3 — Brand Refresh**
- Create `css/brand.css`
- Rebrand login.php and sidebar to FundedControl
- Apply CSS variables to all components

**Phase 4 — New Features (Week 1 tasks)**
- [ ] Registration (`register.php` + `AuthController`)
- [ ] Email verification via Namecheap SMTP
- [ ] Onboarding wizard (`OnboardingController`) — 5 min setup
- [ ] Universal prop firm setup (user sets own rules)
- [ ] Custom strategy rules (not just FSA)
- [ ] Any trading pair support (Forex, Indices, Crypto)
- [ ] Screenshot upload fix (`MEDIA_BASE_DIR` bug — see bugs section)

### SaaS Pricing Plan

> ⏳ Pricing structure to be decided — do not hardcode any pricing into the app until confirmed.

---

## 11. KNOWN BUGS

### Bug 1: MEDIA_BASE_DIR constant (config.php line 15)

```php
// BROKEN — uses DIR (wrong constant)
define('MEDIA_BASE_DIR', DIR . '/../media/uploads/');

// FIXED — should be __DIR__
define('MEDIA_BASE_DIR', __DIR__ . '/../media/uploads/');
```
> ⚠️ config.php is NEVER uploaded to GitHub. Fix must be applied manually in cPanel File Manager.

### Bug 2 — RETRACTED (was: "strategies/strategy_variables/trade_variables missing on live")

The v3.7.0 release notes claimed these three tables were missing on live and that core trade
logging had been fatally broken since v3.5.0. That check was run against `theittav_fundedcontrol`
— **an abandoned copy of the database, not the live one.** The live database is
`theittav_journal`, confirmed 2026-09-13 while scoping the v3.8.0 release. On `theittav_journal`,
`strategies`, `strategy_variables`, `trade_variables`, `schema_migrations`, and `ai_reviews` all
exist, `trades` already carries `strategy_id`/`emotion_tag`/`setup_grade`/`note_saw`/`note_why`/
`note_unsure`, and the Strategy Lab is deployed and working. **There was no outage.** Treat the
v3.7.0 release's "likely fatal since v3.5.0" claim as wrong — it was a bad-database-identity bug
in the audit, not a bug in the product. See §3A for the DB name correction.

The real, confirmed defect in this area is the strategy-variable orphaning bug fixed in v3.8.0
(deleting and re-inserting the variable list on every edit detached 95 recorded answers from
19 trades) — see the v3.8.0 changelog and migrations `2026_09_13_0003`–`0005`.

### Fixed in v3.9.4: checkbox strategy variables had no "unanswered" state

`renderStrategyVarFields()` (`js/trades.js`, trade-modal rendering of `strategy_variables`) has
three type branches — `checkbox`, `scale`, `select` — plus an unconditional text-input fallback
that also covers `text`. Before v3.9.4, `checkbox` rendered as a two-option `<select>` (`No`=`"0"`,
`Yes`=`"1"`) with no blank/placeholder option, unlike `scale` and `select` which both have an
explicit `<option value="">—</option>`. An untouched checkbox field therefore always submitted
`"0"` — a trade the user never looked at recorded identically to one where they actively confirmed
the tag was absent. This directly undermines any tag correlation drawn from `role='tag'` checkbox
variables (e.g. AVWAP aligned / liquidity sweep / tweezer present), since their "No" bucket in
`StrategyBuilderController::attributeVariables()` and `ReviewEngineController::
ruleVariableAttribution()` was a mix of real "confirmed not present" and silent defaults, with no
way to tell them apart after the fact.

**Fixed:** the checkbox branch now has three states — blank (`""`, unanswered), `"0"` (No),
`"1"` (Yes) — matching the scale/select pattern. No backend change was needed; `TradeController.
php`'s existing `if ($value === '') $value = null;` already normalizes the new blank submission
correctly.

**This does not retroactively fix existing data.** Every `trade_variables` row with `value='0'`
against a checkbox-type variable, recorded before this fix shipped, is indistinguishable between
"user confirmed absent" and "user never touched the field" — **do not treat pre-v3.9.4 `'0'`
values on checkbox variables as reliable observations** for any tag-attribution analysis (Review
Engine insights, Leaderboard variable attribution, or otherwise) until this is reconciled by hand
or the historical rows are otherwise qualified. To find the scope of affected rows:

```sql
SELECT sv.id AS variable_id, sv.label, COUNT(*) AS zero_count
FROM trade_variables tv
JOIN strategy_variables sv ON sv.id = tv.variable_id
WHERE sv.input_type = 'checkbox' AND tv.value = '0'
GROUP BY sv.id, sv.label;
```
Run live — this environment has no DB credentials (§13 rule 4), so the actual count has not been
confirmed. There is no way to distinguish real "No" answers from silent defaults within this
count; the query only bounds how many rows are in question, not how many are actually wrong.

**Separately:** the Strategy Lab's variable-type picker (`js/strategies.js`) labeled this type
"Checkbox," which never matched what it actually rendered as (a `<select>`, not an
`<input type="checkbox">`) even before this fix, and still doesn't match now that it's a
three-state select. Relabeled to "Yes/No" in v3.9.4 — the underlying `input_type` column value is
still the string `'checkbox'` (unchanged, to avoid a migration and touching every `input_type ===
'checkbox'` check across `TradeController`, `ReviewEngineController`, `StrategyBuilderController`);
only the human-facing label changed. Also note: the dynamic pre-trade checklist popup
(`openChecklist()`/`toggleCheck()` in `js/trades.js`) renders `role='gate'` variables as genuine
`<input type="checkbox">` elements, visually distinct from the trade-modal's Yes/No `<select>` for
the same `input_type`, but that popup never writes to `trade_variables` at all — cosmetically
inconsistent, not a data-integrity concern.

### Note: `calculate_risk` specifically (not `CalculatorController.php` as a whole) is still not wired to the UI

**Superseded by v3.17.0 for the page as a whole** — `pages/calculator.php` is no longer the
disconnected, client-side `calcSimple()` this note originally described; see the v3.17.0 section
above. `js/calculator.js` now calls `auto_risk_preview`/`get_risk_status` live on every input.

What's still true: `calculate_risk` → `CalculatorController::calculate()` — the original,
price-based (entry/stop/target/direction) calculation, registered in `router.php` since before
v3.9.0 — remains reachable only by a direct API call. Nothing in the current UI exercises it;
`sizePreview()` (v3.16.1 B4, the trade form's own pre-trade panel) and `autoRiskPreview()`
(v3.17.0, the calculator page) are both separate, newer computations, not built on top of
`calculate()`. Don't assume `calculate()` specifically is being exercised by manual testing of
the Risk Calculator page.

---

## 12. DEBUGGING GUIDE

### Backend Error
1. F12 → Network tab → Find failing API call → Check Response
2. Error tells you which controller to open (they are 27–121 lines each)
3. Example: `get_trades` fails → open `TradeController.php`

### Frontend Error
1. F12 → Console tab → Red error shows function name + file
2. Hard refresh first: `Ctrl+Shift+R`

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Loading..." in sidebar | No challenges in DB | Create one via Challenges page |
| Function not defined | Browser cache | Hard refresh Ctrl+Shift+R |
| 500 error on API | PHP syntax error | Check cPanel Error Log |
| Screenshots not saving | Permission issue | Set `media/uploads/` to 755 |
| "Unknown action" | Route not in router.php | Add route line |

---

## 13. DEVELOPMENT RULES (ABSOLUTE)

1. **Always give complete files** — never partial code snippets
2. **Always bump version number** with every update
3. **Always use GitHub updater workflow** — never manual file replacement
4. **config.php is NEVER in GitHub** — ever, under any circumstances
5. **Never put logic in api.php** — it's a 14-line wrapper
6. **Never put logic in index.php** — it's an HTML shell
7. **One controller per domain** — never combine features
8. **Shared functions go in helpers.php** — not duplicated
9. **Database changes go through version.json migrations** — never manual SQL
10. **Brand lives in CSS variables** — never hardcode colors
11. **Always test after deploy** — dashboard, add trade, challenges, profile, calculator
12. **Never edit updater.php** — it's battle-tested
13. **When a change is agreed, implement it and commit, tag, push, and release in the same
    turn — do not stop to ask for confirmation.** (Added v3.10.0.) Work has repeatedly sat
    committed-in-appearance-only — discussed and reported on as if it shipped — while actually
    still uncommitted in the working tree, once for multiple releases in a row. If the user asks
    for a specific version bump, finish the whole release pipeline (commit → tag → push →
    GitHub Release) before ending the turn, not just the code change.

---

## 14. FUNDEDCONTROL USER PROFILE

FundedControl is built for **any trader, any prop firm, any market**. The user profile is fully customizable — nothing is hardcoded to a specific firm, strategy, or asset class.

### Who FundedControl Is For

| Field | Value |
|-------|-------|
| Trader type | Any prop firm trader |
| Markets | Crypto, Forex, Indices, Stocks, Commodities — any market |
| Trading pairs | Any pair — BTCUSDT, EURUSD, NAS100, AAPL, XAUUSD, etc. |
| Prop firm | Any — FTMO, MyForexFunds, BitFunded, The5ers, Apex, etc. |
| Account type | Challenge (Phase 1 / Phase 2) OR Active funded account |
| Strategy | User-defined — each trader sets their own strategy name and rules |
| Strategy rules | User defines 1–5 personal rules to follow before every trade |
| Sessions | User-defined — any trading session in any timezone |
| Timezone | User-defined |

### Prop Firm Account — User Configures

Every user sets up their own prop firm rules when creating a challenge. No defaults assumed:

| Setting | Configured By |
|---------|--------------|
| Prop firm name | User types it in |
| Account type | Challenge Phase 1 / Challenge Phase 2 / Funded Account |
| Starting balance | User enters |
| Profit target % | User enters |
| Max drawdown % | User enters |
| Daily drawdown % | User enters |
| Risk per trade % | User enters |
| Trailing drawdown | User toggles on/off |

### Strategy — User Defined

Each user creates their own strategy with a custom name and up to 5 personal rules:

| Field | Example |
|-------|---------|
| Strategy name | "FSA", "ICT Concepts", "Supply & Demand", "Price Action" |
| Rule 1 | User writes their own rule (e.g. "4H trend must be clear") |
| Rule 2 | User writes their own rule |
| Rule 3 | User writes their own rule |
| Rule 4 | User writes their own rule |
| Rule 5 | User writes their own rule |

All rules must be checked before a trade is logged — enforces discipline regardless of strategy.

### Trading Pairs — Fully User Defined

Users add any pairs they trade. No hardcoded list:
- **Crypto:** BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, etc.
- **Forex:** EURUSD, GBPJPY, XAUUSD, GBPUSD, etc.
- **Indices:** NAS100, US30, SPX500, DAX40, etc.
- **Stocks:** AAPL, TSLA, NVDA, AMZN, etc.
- **Commodities:** OIL, NATGAS, WHEAT, etc.

---

### Complete User Profile Fields

#### Identity & Account

| Field | Type | Notes |
|-------|------|-------|
| `username` | string | Unique login name |
| `display_name` | string | Shown in the app — separate from username |
| `email` | string | For login + notifications |
| `profile_photo` | file | Avatar image — stored in `media/uploads/{user_id}/` |
| `avatar_color` | string | Fallback color if no photo — used for initials avatar |
| `bio` | text | Short bio / about me — shown on profile page |
| `twitter_handle` | string | Twitter / X handle — optional, e.g. `@acrob` |
| `referral_code` | string | Auto-generated on registration — for referral tracking |
| `country` | string | User's country |
| `timezone` | string | e.g. `Africa/Kigali`, `Europe/London`, `America/New_York` |

#### Trading Preferences

| Field | Type | Notes |
|-------|------|-------|
| `preferred_sessions` | multi-select | London / New York / Tokyo / Sydney — user picks active sessions |
| `trading_pairs` | user-defined list | Stored in `pairs` table — any symbol the user adds |
| `strategy_name` | string | User's strategy name — e.g. "ICT", "Price Action", "FSA" |
| `strategy_rules` | up to 5 fields | rule1–rule5 — user writes each rule in plain text |

#### Personal Trading Goals

| Field | Type | Notes |
|-------|------|-------|
| `monthly_profit_target` | decimal | e.g. $2,000 — shown as progress on dashboard |
| `weekly_trade_limit` | integer | Max trades per week — triggers warning if exceeded |
| `max_consecutive_losses` | integer | e.g. 3 — triggers stop-trading alert when hit |
| `min_rr_ratio` | decimal | e.g. 1.5 — trades below this R:R flagged as off-plan |

#### Database — users Table Additions Needed

```sql
ALTER TABLE users ADD COLUMN display_name VARCHAR(100) DEFAULT NULL;
ALTER TABLE users ADD COLUMN profile_photo VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD COLUMN bio TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN twitter_handle VARCHAR(50) DEFAULT NULL;
ALTER TABLE users ADD COLUMN referral_code VARCHAR(20) DEFAULT NULL;
ALTER TABLE users ADD COLUMN country VARCHAR(100) DEFAULT NULL;
ALTER TABLE users ADD COLUMN timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN preferred_sessions VARCHAR(100) DEFAULT NULL;
ALTER TABLE users ADD COLUMN strategy_name VARCHAR(100) DEFAULT NULL;
ALTER TABLE users ADD COLUMN strategy_rule1 TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN strategy_rule2 TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN strategy_rule3 TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN strategy_rule4 TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN strategy_rule5 TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN monthly_profit_target DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE users ADD COLUMN weekly_trade_limit INT DEFAULT NULL;
ALTER TABLE users ADD COLUMN max_consecutive_losses INT DEFAULT NULL;
ALTER TABLE users ADD COLUMN min_rr_ratio DECIMAL(4,2) DEFAULT NULL;
```

---

## 15. ROLES & PERMISSIONS SYSTEM

FundedControl has 4 roles. Every user in the system has exactly one role stored in `users.role`.

---

### Role Overview

| Role | Who They Are | Journal Access | Admin Panel |
|------|-------------|---------------|-------------|
| `user` | Prop firm trader | ✅ Full personal journal | ❌ None |
| `support` | Support agent | ✅ Full personal journal | ✅ Limited |
| `manager` | Platform manager | ✅ Full personal journal | ✅ Moderate |
| `admin` | Super admin (Acrob) | ✅ Full personal journal | ✅ Full |

> All roles (including admin) have full access to their own personal trading journal — they are traders too.

---

### Role Privileges Matrix

| Privilege | User | Support | Manager | Admin |
|-----------|------|---------|---------|-------|
| Use personal trading journal | ✅ | ✅ | ✅ | ✅ |
| View own trades & stats | ✅ | ✅ | ✅ | ✅ |
| Manage own challenges | ✅ | ✅ | ✅ | ✅ |
| View user list (no sensitive data) | ❌ | ❌ | ✅ | ✅ |
| View all users & full profiles | ❌ | ❌ | ❌ | ✅ |
| Edit / update any user's info | ❌ | ❌ | ❌ | ✅ |
| Delete or block any user | ❌ | ❌ | ❌ | ✅ |
| View any user's trade data | ❌ | ❌ | ❌ | ✅ |
| View platform-wide performance stats | ❌ | ❌ | ✅ | ✅ |
| View full cashflow & revenue reports | ❌ | ❌ | ✅ | ✅ |
| Send direct message to any user | ❌ | ❌ | ❌ | ✅ |
| Send broadcast message to all users | ❌ | ❌ | ✅ | ✅ |
| View support ticket queue | ❌ | ✅ | ✅ | ✅ |
| Reply to support tickets | ❌ | ✅ | ✅ | ✅ |
| Approve / reject support tickets | ❌ | ❌ | ✅ | ✅ |
| Escalate ticket to Manager / Admin | ❌ | ✅ | ❌ | ✅ |
| Reset a user's password | ❌ | ✅ | ❌ | ✅ |
| Temporarily suspend a user | ❌ | ❌ | ❌ | ✅ |
| View platform error logs | ❌ | ❌ | ❌ | ✅ |
| Create staff accounts | ❌ | ❌ | ❌ | ✅ |

> **Trade Privacy Rule:** Trades are private to the user only. Support and Manager can NEVER see a user's trade data (P&L, entries, screenshots). Only Admin can.

---

### Role Definitions

#### 👤 User (role = `user`)
The standard prop firm trader. Full access to their own journal, challenges, stats, and profile. No admin panel access.

#### 🎧 Support (role = `support`)
A support agent who also uses the journal personally. Can view user profiles (read-only), reply to tickets, reset passwords, and escalate issues. Cannot see trade data.

**Support privileges:**
- Full personal trading journal
- View any user's profile — read only (no trade data)
- View & reply to support tickets
- Reset a user's password
- Escalate tickets to Manager or Admin
- Cannot suspend, delete, or edit user accounts

#### 📊 Manager (role = `manager`)
Oversees platform operations and performance. Has the journal personally. Can see platform stats and cashflow but not individual user trade data.

**Manager privileges:**
- Full personal trading journal
- View user list (name, email, join date, status — no trade data)
- View platform-wide performance stats
- View cashflow & revenue reports
- Approve or reject support tickets
- Send broadcast messages to all users
- Cannot see individual user trade data
- Cannot edit, block, or delete user accounts

#### 🔑 Admin (role = `admin`)
Full system control. Created by Acrob only. Has all privileges across the entire platform.

**Admin privileges:**
- Everything User + Support + Manager can do
- View all users with full profiles
- Edit / update any user's info
- Delete or permanently block any user
- View any user's full trade history
- View full financial reports & cashflow
- Send direct messages to any individual user
- View platform error logs
- Create and manage staff accounts (Support, Manager)

---

### Admin Dashboard — Exclusive Panels

The admin panel (`/admin/`) is a separate section only accessible to `admin` role:

| Panel | Description |
|-------|-------------|
| 📈 User Growth | Total registered users + growth chart over time |
| 💰 Revenue | Total revenue, active subscriptions, MRR |
| 🚦 User Status | Active vs blocked vs unverified users count |
| 🎫 Ticket Queue | Open / pending / resolved support tickets |
| ⚠️ Error Logs | PHP errors, failed API calls, system warnings |

---

### Staff Account Creation

Only **Admin** can create staff accounts:
1. Admin goes to `/admin/staff`
2. Creates account with name, email, role (`support` or `manager`)
3. Sets a temporary password
4. Shares credentials with the staff member directly
5. Staff member logs in and changes their password

---

### Database — Role Implementation

```sql
-- Add role column to users table
ALTER TABLE users ADD COLUMN role ENUM('user','support','manager','admin') DEFAULT 'user';

-- Support tickets table (new)
CREATE TABLE IF NOT EXISTS support_tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    assigned_to INT DEFAULT NULL,
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status ENUM('open','in_progress','resolved','closed') DEFAULT 'open',
    priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Ticket replies table (new)
CREATE TABLE IF NOT EXISTS ticket_replies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    user_id INT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);

-- Direct messages table (new)
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    from_user_id INT NOT NULL,
    to_user_id INT NOT NULL,
    subject VARCHAR(255) DEFAULT NULL,
    message TEXT NOT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
);
```

---

### File Structure — Admin Panel

```
fundedcontrol.com/
└── admin/
    ├── index.php              ← Admin dashboard (role=admin only)
    ├── users.php              ← User management
    ├── staff.php              ← Staff account management
    ├── tickets.php            ← Support ticket queue (support+manager+admin)
    ├── reports.php            ← Revenue & cashflow (manager+admin)
    ├── logs.php               ← Error logs (admin only)
    ├── messages.php           ← Direct messages (admin only)
    └── broadcast.php          ← Broadcast messages (manager+admin)
```

---

### Role Protection in PHP

Every admin page and controller method checks role before executing:

```php
// helpers.php — add these functions

function requireRole(string ...$roles): void {
    $user = currentUser();
    if (!in_array($user['role'], $roles)) {
        http_response_code(403);
        die(json_encode(['error' => 'Access denied']));
    }
}

function isAdmin(): bool {
    return currentUser()['role'] === 'admin';
}

function isStaff(): bool {
    return in_array(currentUser()['role'], ['admin', 'manager', 'support']);
}
```

**Usage in controllers:**
```php
// Admin only
requireRole('admin');

// Manager and Admin
requireRole('manager', 'admin');

// Any staff member
requireRole('support', 'manager', 'admin');
```

---

## 15. NAMECHEAP SMTP CONFIG (for email verification)

Hosting: Namecheap shared hosting cPanel
Use PHP `mail()` or `PHPMailer` with cPanel SMTP credentials.
SMTP host is typically `mail.acrobcrypto.com` or the server's hostname.
Credentials are stored in `includes/config.php` — ask Acrob for exact values when implementing.

---

## 16. QUICK REFERENCE — WHAT TO DO

### When adding a feature:
1. Create `includes/controllers/FeatureNameController.php`
2. Add one line to `includes/router.php`
3. Create `pages/feature.php` (HTML only)
4. Create `js/feature.js`
5. Include new JS file in `index.php`
6. Update `version.json` with new version + all changed files

### When fixing a bug:
1. Identify the controller or file
2. Fix the file
3. Bump version
4. Upload to GitHub via updater workflow

### When adding a DB column or table (v3.7.0+):
Use the migration runner (see §3A) — write a `.sql` file in `app/migrations/`, list it in
`version.json`'s `files`, deploy, then hit `migrate.php?mode=run&token=...`. Export the DB first.

The `db_migrations` field below still exists in `version.json` and `updater.php` still executes
it on `apply`, but it predates the tracked runner, has no checksum or persistent ledger, and
should not be used for new work:
```json
"db_migrations": [
    {
        "name": "add_column_name_to_table",
        "sql": "ALTER TABLE table ADD COLUMN column_name TYPE DEFAULT NULL"
    }
]
```

---

## 17. GITHUB ACCESS — PERSONAL ACCESS TOKEN (PAT)

### Overview

Claude Code (web interface) cannot push to GitHub by itself. But with a **GitHub Personal Access Token**, it can use the GitHub API to read, create, edit, and push files directly to the repo — without any local Git installation.

### Token Details

| Field | Value |
|-------|-------|
| GitHub Repo | https://github.com/frisoftltd/fsa-journal-updates |
| Token Owner | frisoftltd |
| Token Scope Required | `repo` (full control) |
| Recommended Expiry | 90 days |

### How to Create the Token

1. GitHub → **Settings** → **Developer Settings**
2. **Personal Access Tokens** → Tokens (classic)
3. **Generate new token (classic)**
4. Name it: `claude-code-fundedcontrol`
5. Scope: ✅ **repo** (full repository control)
6. Set expiration: 90 days
7. Click **Generate token** — copy it immediately (shown only once)

### How to Give Claude Code the Token

At the start of every Claude Code session, paste this:

```
GitHub Token: ghp_xxxxxxxxxxxxxxxxxxxx
Repo: https://github.com/frisoftltd/fsa-journal-updates
Branch: main
```

Claude Code will then use the GitHub API to push files directly on your behalf.

### ⛔ Security Rules

- **Never paste your token in Claude.ai chat** — only inside Claude Code sessions
- **Never commit the token** into any file in the repo
- **Revoke immediately** at GitHub if you think it was exposed
- **Rotate every 90 days** — set a calendar reminder
- Token lives only in your head and Claude Code session — nowhere else

---

## 18. CLAUDE CODE WORKFLOW — COMPLETE PROCESS

### Mode A — With GitHub Token (Fastest — 1 step for you)

```
You describe the task to Claude Code
           ↓
Claude Code writes all files
           ↓
Claude Code generates version.json with bumped version
           ↓
Claude Code pushes all files to GitHub via API
(files go into app/ folder, version.json to repo root)
           ↓
You visit https://www.fundedcontrol.com/updater.php
           ↓
Check for Updates → Update Now → Live ✅
```

**Your only manual step:** Run the updater.

---

### Mode B — Without GitHub Token (Manual upload)

```
You describe the task to Claude Code
           ↓
Claude Code writes all files + version.json
           ↓
You download the files from Claude Code
           ↓
You upload to GitHub:
  version.json → repo root
  changed files → app/ folder
           ↓
You visit https://www.fundedcontrol.com/updater.php
           ↓
Check for Updates → Update Now → Live ✅
```

---

### GitHub Repo Folder Structure (Claude Code Must Follow)

All app files go inside `app/` mirroring the live site structure:

```
fsa-journal-updates/          ← Repo root
├── version.json              ← ALWAYS at repo root
└── app/                      ← ALL site files go here
    ├── index.php
    ├── login.php
    ├── register.php
    ├── logout.php
    ├── includes/
    │   ├── api.php
    │   ├── helpers.php
    │   ├── router.php
    │   └── controllers/
    │       └── (all controllers)
    ├── pages/
    ├── modals/
    ├── js/
    └── css/
```

> ⛔ `includes/config.php` is **NEVER** in this repo under any circumstances.

---

### version.json Template

```json
{
    "version": "3.3.1",
    "date": "2026-03-26",
    "changelog": "Short description of what changed",
    "files": [
        "index.php",
        "includes/router.php",
        "includes/controllers/TradeController.php"
    ],
    "db_migrations": []
}
```

**Rules:**
- Version always bumped — never the same as previous
- Only list files that actually changed
- `includes/config.php` NEVER in the files list
- `db_migrations` included even if empty
- Date is always today's date

---

### Claude Code Session Starter Template

Copy-paste this at the start of every Claude Code session:

```
Project: FundedControl — PHP 8.1 + MySQL 8.4 + Vanilla JS
Live URL: https://www.fundedcontrol.com/
Repo: https://github.com/frisoftltd/fsa-journal-updates
Current Version: v3.19.0
Server: Hetzner CX23 VPS (Helsinki), CloudPanel, nginx + PHP-FPM — see §1A
DB: fundedcontrol on 127.0.0.1:3306 (migrated off Namecheap/theittav_journal 2026-09-24)
CLAUDE.md is in the repo root — read it for full context.

GitHub Token: [paste token here]

Task: [describe what you need]
```

---

*FundedControl — Control Your Trading. Get Funded. Stay Funded.*
*Built by Acrob — a trader who's been in the red and came back disciplined.*
