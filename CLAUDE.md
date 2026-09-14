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
| DB Name | `theittav_journal` on Namecheap shared hosting. **`theittav_fundedcontrol` is an abandoned copy** — this file briefly said `theittav_fundedcontrol` was correct (v3.7.0 release) based on an audit that had checked the wrong database; corrected 2026-09-13 while scoping v3.8.0. See §11 Bug 2 (retracted). |
| Current Version | v3.9.4 |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | PHP 8.1 |
| Database | MySQL (PDO, prepared statements) |
| Frontend | Vanilla JS + Chart.js |
| Hosting | Namecheap shared hosting (cPanel) |
| No frameworks | No Laravel, no React, no Composer |

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
starting_balance, current_balance, max_drawdown_pct,
daily_loss_limit, risk_per_trade_pct, profit_target_pct,
status (active/completed/failed), is_active (0/1), created_at,
default_strategy_id (added v3.5.0 — links to strategies.id)
```

**trades**
```sql
id, user_id, challenge_id, trade_date, session, time_in, time_out,
pair, direction, entry_price, stop_loss, take_profit, exit_price,
lot_size, risk_amount, fees, pnl, net_pnl, r_multiple,
result, confidence, exec_score, fib_level, fsa_rules,
notes, screenshot, screenshots (JSON, up to 4, added later — screenshot kept for back-compat),
strategy_id, emotion_tag, setup_grade, note_saw, note_why, note_unsure (added v3.5.0)
```
> `session` is `ENUM('London','New York','Asia','Other') NULL` (nullable, no default, since v3.9.0 —
> was `NOT NULL DEFAULT 'London'` before, which silently mislabeled every trade saved without an
> explicit session as London). `NULL` means genuinely not recorded; do not treat it as London.
> Existing pre-v3.9.0 rows were not touched — some of their `'London'` values are real, some are
> silent defaults, and there's no way to tell which after the fact.

**pairs**
```sql
id, user_id, symbol, active (0/1)
```

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

### Data Relationships

```
users (1) ──→ (many) challenges
challenges (1) ──→ (many) trades
challenges (many) ──→ (1) strategies              [default_strategy_id]
trades (many) ──→ (1) strategies                  [strategy_id]
strategies (1) ──→ (many) strategy_variables
strategy_variables (1) ──→ (many) trade_variables  [FK RESTRICT]
trades (1) ──→ (many) trade_variables              [FK CASCADE]
users (1) ──→ (many) pairs
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

---

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
2. Add its path to `version.json`'s `"files"` array (`{"path": "migrations/...sql", "critical": false}`) —
   if it's not in the manifest, `updater.php` will never deploy it to the server, full stop.
3. Bump `current_version`, commit, push, tag, release.
4. **Export the database before running `?mode=run` on live.** DDL can't be rolled back — a
   backup is the only undo.
5. Deploy via the normal updater workflow (Acrob runs `updater.php`), then hit
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
| `calculate_risk` | POST | CalculatorController | Position size calculator |
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

### Note: `calculate_risk` / `CalculatorController.php` is not wired to the UI

The Risk Calculator page (`pages/calculator.php`) calls `calcSimple()` (`js/calculator.js`), a
purely client-side, percentage-based calculation (balance/stop-loss %/risk %/leverage — no entry,
stop, or target prices, no direction). It never calls the API. `calculate_risk` →
`CalculatorController::calculate()` is still registered in `router.php` and reachable by a direct
API call, and as of v3.9.0 it validates that a stop/target sits on the correct side of entry for
the given direction — but nothing in the current UI exercises that code path. If a future release
wires a price-based calculator into the UI, it already has this validation; if not, don't assume
`CalculatorController.php` is being exercised by manual testing of the Risk Calculator page.

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
Project: FundedControl — PHP 8.1 + MySQL + Vanilla JS
Live URL: https://www.fundedcontrol.com/
Repo: https://github.com/frisoftltd/fsa-journal-updates
Current Version: v3.9.4
DB: theittav_journal on Namecheap shared hosting
CLAUDE.md is in the repo root — read it for full context.

GitHub Token: [paste token here]

Task: [describe what you need]
```

---

*FundedControl — Control Your Trading. Get Funded. Stay Funded.*
*Built by Acrob — a trader who's been in the red and came back disciplined.*
