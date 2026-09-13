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
| DB Name | `theittav_fundedcontrol` on Namecheap shared hosting (confirmed live 2026-09-13; this file previously said `theittav_journal` — stale) |
| Current Version | v3.7.0 |

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
status (active/completed/failed), is_active (0/1), created_at
```

**trades**
```sql
id, user_id, challenge_id, trade_date, session, time_in, time_out,
pair, direction, entry_price, stop_loss, take_profit, exit_price,
lot_size, risk_amount, fees, pnl, net_pnl, r_multiple,
result, confidence, exec_score, fib_level, fsa_rules,
notes, screenshot
```

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

**weekly_reviews**
```sql
id, user_id, week_start, week_end, process_score, mindset_score,
key_lesson, what_went_well, what_to_improve, rules_followed
```

**daily_limits**
```sql
user_id, log_date, daily_pnl, trades_count
```

### Data Relationships

```
users (1) ──→ (many) challenges
challenges (1) ──→ (many) trades
users (1) ──→ (many) pairs
users (1) ──→ (many) strategy_tests
users (1) ──→ (many) weekly_reviews
```

### Challenge Scoping Rule

All trade queries must include:
```sql
WHERE user_id = ? AND (challenge_id = ? OR challenge_id IS NULL)
```
The `OR challenge_id IS NULL` handles trades from before v2.3.0.

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

### Bug 2: `strategies`, `strategy_variables`, `trade_variables` tables don't exist on live (confirmed 2026-09-13)

v3.5.0, v3.5.1, and v3.6.0 all shipped code assuming these tables exist (plus `trades.strategy_id`,
`emotion_tag`, `setup_grade`, `note_saw`, `note_why`, `note_unsure` and
`challenges.default_strategy_id`). The `db_migrations` in each version's `version.json` that would
have created them were never actually applied on live. This is not a soft-degrade bug:

- `TradeController::saveTrade()` (`includes/controllers/TradeController.php`) writes
  `strategy_id`, `emotion_tag`, `setup_grade`, `note_saw`, `note_why`, `note_unsure` on **every**
  `add_trade` / `update_trade` call, with no try/catch. PDO defaults to `ERRMODE_EXCEPTION` as of
  PHP 8.1, so every trade save throws an uncaught `PDOException` — this is a fatal error, not a
  degraded experience.
- `TradeController::getAll()` queries `trade_variables` unconditionally — every `get_trades` call
  (dashboard, trade list) fatals the same way.
- `StrategyBuilderController` and `ReviewEngineController` query `strategies`, `strategy_variables`,
  and `trade_variables` directly — every Strategy Lab and Review Engine action fatals too.

In short: core trade logging has likely been fatally broken on live since v3.5.0
(2026-08-12) — over a month as of this writing. This is release-2 scope (creating the three
tables + the `trades`/`challenges` columns), but it changes that release's priority from "new
feature" to "fix a live outage." See the migration runner in §3A — release 2 should ship these as
tracked migrations, then use `migrate.php?mode=baseline` for the seven tables that already exist
on live.

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
Current Version: v3.7.0
DB: theittav_fundedcontrol on Namecheap shared hosting
CLAUDE.md is in the repo root — read it for full context.

GitHub Token: [paste token here]

Task: [describe what you need]
```

---

*FundedControl — Control Your Trading. Get Funded. Stay Funded.*
*Built by Acrob — a trader who's been in the red and came back disciplined.*
