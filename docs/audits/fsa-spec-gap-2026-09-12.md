# FSA Journal Spec vs. FundedControl — Gap Audit

**Date:** 2026-09-12
**FundedControl version audited:** v3.6.0 (release date 2026-09-01, per `version.json` at repo root), HEAD commit `bc6c36b` ("Add Behavioral Review Engine + AI nudges (v3.6.0, Wave 3)")
**Repo:** `frisoftltd/fsa-journal-updates`
**Scope:** read-only audit. No schema changes, migrations, form changes, version bump, or `version.json` edits were made.

> `CLAUDE.md` is stale and was **not** used as a source of fact. It states the current version is v3.3.0 and documents an `OnboardingController.php` and several `users` table columns (`strategy_rule1-5`, `min_rr_ratio`, `max_consecutive_losses`, `weekly_trade_limit`, `monthly_profit_target`) that were never actually built — confirmed by zero hits for any of them across the full `app/` tree and the entire `version.json` migration history. Every finding below is sourced from the current working tree and `git log --follow -p -- version.json`.

---

## 1. Verdict Table

| Area | Verdict | Justification |
|---|---|---|
| **Data capture** | **PARTIAL** | The Trade Log side is well covered — entry/stop/target, session, outcome, and a first-class populated `r_multiple` column all exist, plus FundedControl captures materially more than the spreadsheet (screenshots, 8-state emotion tag, A/B/C setup grade, guided micro-notes, strategy/challenge linkage). But R1–R6 has structurally nowhere to go (5-variable cap, no pass/fail concept), and the **Rejection Log has zero representation anywhere** — no table, column, flag, or endpoint. |
| **Strategy definition** | **MISSING** | The dynamic strategy system (`strategies`/`strategy_variables`/`trade_variables`) has no gate-vs-tag distinction, no evaluation logic that uses its own `sort_order` column to short-circuit, no numeric-parameter config, and a hard 5-variable cap (FSA needs 6 gates + 3 tags = 9). Worse: the only FSA-specific rule content still live and user-facing in the app (`app/modals/checklist-modal.php`) encodes the **superseded** 5-rule / AVWAP-mandatory / 0.618-0.705 definition — so the current 6-rule spec is encoded nowhere in the running app, and what *is* shown to users today is actively wrong. |
| **Dashboard** | **PARTIAL** | View 2 (Performance) is largely present, missing only a raw R sum. Views 3 (Tag attribution) and 4 (Session/instrument) have the right underlying primitives (a genuine YES/NO variable split; session/pair grouping) but surface win-rate/PnL only, never R — and View 3's 8-trade display threshold actively conflicts with the spec's 50-trade tag-promotion point. View 1 (Why am I not trading) is **completely missing** because it depends on the Rejection Log entity, which does not exist. |

---

## 2. Field Mapping

### 2a. Spreadsheet Trade Log → FundedControl

| Spreadsheet field | FundedControl equivalent | Status | Evidence |
|---|---|---|---|
| Date | `trades.trade_date` | EXISTS | `TradeController.php:105`; `modals/trade-modal.php:8` |
| Instrument | `trades.pair` (free-text via `pairs` table, not restricted to BTC/ETH/BNB/Other) | EXISTS, DIFFERENT SCOPE | `TradeController.php:105`; `PairController.php` |
| Direction | `trades.direction` (Long/Short) | EXISTS | `trade-modal.php:17` |
| Session | `trades.session` — user-picked dropdown (London/New York/Asia/Other) | EXISTS, DIFFERENT VALUES | `trade-modal.php:9` |
| R1–R6 (6 mandatory YES/NO) | No 6-slot structured field. Closest analogs: (a) `checklist-modal.php` — a 5-item, **never-persisted**, client-side-only checklist; (b) `strategy_variables`/`trade_variables` — capped at 5 variables per strategy | **MISSING** as structured, persisted, 6-gate data | `StrategyBuilderController.php:85` (hard cap "Maximum 5 variables per strategy"); `checklist-modal.php:5-9` |
| VALID? (derived) | Not computed anywhere | **MISSING** | no reference found in `TradeController.php`, `StrategyBuilderController.php`, or review code |
| Trigger type (Pin bar/Engulfing/Tweezer) | No column; text only exists as a checklist label string | **MISSING** | `checklist-modal.php:9` |
| AVWAP aligned | No column; text only exists as a checklist label string | **MISSING** | `checklist-modal.php:8` |
| Sweep present | No column, no text reference anywhere | **MISSING** | repo-wide grep, zero hits |
| Tweezer | No column, no text reference anywhere | **MISSING** | repo-wide grep, zero hits |
| Entry | `trades.entry_price` | EXISTS | `trade-modal.php:20`; `TradeController.php:57` |
| Stop | `trades.stop_loss` | EXISTS | `trade-modal.php:21`; `TradeController.php:58` |
| Target | `trades.take_profit` | EXISTS | `trade-modal.php:22` |
| Planned R (derived) | Computed transiently in `CalculatorController::calculate()` as `rr_ratio`, **never carried into the trade record** — the "fill from calculator" flow only copies entry/sl/tp/lot, not the ratio | EXISTS AS COMPUTATION ONLY, NOT PERSISTED | `CalculatorController.php:19`; `app/index.php:112-122` |
| Outcome (Win/Loss/BE/Open) | `trades.result` — string values `Win`/`Loss`/`Break Even`/`Open` | EXISTS | `trade-modal.php:28` |
| R achieved | `trades.r_multiple` — computed server-side and stored on every save | EXISTS | `TradeController.php:72-84,105-127` |
| Notes | `trades.notes` (freeform) plus three distinct guided micro-note fields | EXISTS, RICHER | `trade-modal.php:65-67,112`; v3.5.0 migrations `add_note_saw_to_trades` etc. |

### 2b. Spreadsheet Rejection Log → FundedControl

| Spreadsheet field | FundedControl equivalent | Status |
|---|---|---|
| Date / Instrument / Direction / Session / First NO / What happened after / Est. R missed / Notes | **No table, no columns, no endpoint, no status flag on `trades`, nothing soft-deleted, nothing repurposed.** | **MISSING — entity does not exist in any form** |

Confirmed by a repo-wide, case-insensitive search for `rejection`, `reject`, `skip`, `scan`, `watchlist`, `no_trade`, `missed`. Every hit is unrelated to this concept (updater file-skip logic, an unrelated "skip C-grade setups" comment, login "skip for legacy users"). No `result`/status enum value like `'Rejected'` or `'Skipped'` exists on `trades` (values are strictly `Win`/`Loss`/`Break Even`/`Open`). Do not read this as partial coverage under any framing — it is a hard zero.

### 2c. Reverse direction — FundedControl fields with no spreadsheet equivalent

| Field / table | Purpose | Evidence |
|---|---|---|
| `trades.screenshot` / `trades.screenshots` (JSON, up to 4 labeled images) | Chart screenshots per trade | `TradeController.php:86-201`; `trade-modal.php:70-111` |
| `trades.emotion_tag` (8-state tap-grid: calm/itchy/fomo/revenge/bored/overconfident/anxious/unsure) | Emotion tracking | `trade-modal.php:44-55`; migration `add_emotion_tag_to_trades` (v3.5.0) |
| `trades.setup_grade` (A/B/C) | Setup quality grading | `trade-modal.php:57-63`; migration `add_setup_grade_to_trades` (v3.5.0) |
| `trades.note_saw` / `note_why` / `note_unsure` | Three guided micro-note prompts, distinct from freeform `notes` | `trade-modal.php:65-67` |
| `trades.strategy_id` → `strategies`/`strategy_variables` | User-defined strategy assignment with up to 5 custom dynamic variables | `TradeController.php:105`; `StrategyBuilderController.php` |
| `trades.challenge_id` → `challenges` | Prop-firm challenge/account linkage (multi-account) | migration `add_challenge_id_to_trades` (v2.3.0) |
| `trades.risk_amount`, `trades.lot_size`; `CalculatorController` (`risk_pct`, balance-based sizing) | Risk % and position sizing | `CalculatorController.php` (whole file); **caveat:** `risk_amount` has no input field anywhere in `trade-modal.php` and is not copied by the "fill from calculator" flow (`index.php:112-122` copies entry/sl/tp/lot only) — it is in the schema and consumed by 4 Review Engine rules, but effectively always `NULL` in practice today |
| `trades.exec_score` (1–10) | Execution quality self-score | `trade-modal.php:29` |
| `ai_reviews` + `ReviewEngineController.php` | Automatic behavioral-review engine, 20 deterministic rule-methods (see §4.1) | v3.6.0, `version.json` |
| `strategies` / `strategy_variables` / `trade_variables` | Generic user-defined strategy rule-tracking system | v3.5.0 migrations |

---

## 3. Strategy System Findings

### 3.1 Current schema

**`strategies`** (v3.5.0, `b4922b3`): `id, user_id, name, is_active, created_at`.

**`strategy_variables`** (v3.5.0): `id, strategy_id, label VARCHAR(100), input_type ENUM('checkbox','scale','select','text'), options VARCHAR(255)` (plain comma-separated string, not JSON), `sort_order TINYINT`. Confirmed live: `StrategyBuilderController.php:26,91`.

**`trade_variables`** (v3.5.0): `id, trade_id, variable_id, value VARCHAR(255)` — plain key-value pair, no type enforcement, **no foreign key** on `variable_id` (see §3.2 versioning).

**`strategy_tests`** (older "Strategy Tester" sandbox, not in any `version.json` migration — predates migration tracking, reconstructed from the live INSERT): `user_id, strategy_name, timeframe, market, rule1-rule5, test_date, pair, direction, r1-r5 (Y/N text), result, fib_level, r_multiple, net_pnl, session, notes`. **Not dead code** — routes `get_strategy_trades`/`get_strategy_stats`/`add_strategy_trade`/`delete_strategy_trade` are live in `router.php:40-43`, and the "Strategy Tester" nav item, page, and modal all still render (`app/index.php:39,88`).

### 3.2 Answers

- **Gate vs. tag:** No such distinction exists. `strategy_variables` has no `is_gate`/`is_mandatory`/`required` column — `input_type` only encodes UI widget kind (checkbox/scale/select/text), not pass/fail semantics. Every variable is treated identically as a recorded/analyzed value in the leaderboard's `attributeVariables()` (`StrategyBuilderController.php:194-254`). A repo-wide grep for `is_gate|is_mandatory|required_flag` returns one irrelevant hit (a prose AI-nudge suggestion string in `ReviewEngineController.php:513`).
- **Ordering:** `strategy_variables.sort_order` exists and is respected for display (`ORDER BY sort_order ASC, id ASC`, `StrategyBuilderController.php:26,115`; set from array index on save in `js/strategies.js:128`). But nothing *evaluates* variables in that order — there is no short-circuit loop anywhere in `TradeController.php` or `StrategyBuilderController.php`. "First NO ends the analysis" is not expressible today because there is no failure concept to stop on (see gate-vs-tag above).
- **Attributes:** timeframe — no column anywhere on `strategy_variables` (the legacy `strategy_tests` table has a free-text, non-enum `timeframe` VARCHAR, e.g. `"1H/15M"` typed by the user, on an unrelated table). Data type — `input_type` gives boolean-ish/quasi-numeric/enum/text but no true numeric type. Allowed values — `options` is a raw comma-separated string, not structured JSON. Required flag — does not exist.
- **Numeric parameters — where they'd live today:**

  | Parameter | Finding |
  |---|---|
  | Min R:R (3.0) | Does not exist anywhere. `CalculatorController.php:19` computes `rr_ratio` for display only, never compared against a threshold. |
  | Valid Fib levels (0.382/0.5/0.618) | Not a config field. Only appears as a `<select>` dropdown in `strategy-modal.php:35` that mixes current levels (0.382, 0.5, 0.618) with superseded ones (0.705, 0.786) with no logic differentiating valid from invalid choices. |
  | Min prior S/R reactions (2) | Does not exist — no candle/zone-reaction counting logic anywhere. |
  | Pin bar wick-to-body ratio (2) | Does not exist — no candle-geometry logic in the codebase at all. |
  | Max consecutive losses before stand-down (2) | **Hardcoded to 3, not 2** — `AlertController.php:47-60` alerts on 3 consecutive losses; `pages/calculator.php:39` also hardcodes "Stop after 3 consecutive losses" in UI copy. No config field exists to change this number. |
  | Daily loss limit | Real, generic config field — `challenges.daily_loss_limit` (flat dollar amount, not FSA-specific), used in `AlertController.php:30,38-39`, `ReviewEngineController.php:438-439,810`. |
  | Risk tiers by balance (<$9,500=0.25% / $9,500–10,000=0.5% / >$10,000=1.0%) | Does not exist — `challenges.risk_per_trade_pct` is a single flat percentage with no bracket logic. |
- **Derived validity:** No equivalent of `VALID?` exists. `TradeController::saveTrade()` (`TradeController.php:50-152`) persists `trade_variables` verbatim with zero evaluation, no aggregate flag written back.
- **Versioning — worse than "silent rewrite," it's silent orphaning:** `StrategyBuilderController::saveVariables()` (`StrategyBuilderController.php:74-102`) always `DELETE`s all rows for a strategy then re-`INSERT`s the full set from scratch, assigning **fresh AUTO_INCREMENT ids every save**, even for a one-label edit (`js/strategies.js:123-134` always POSTs the entire variable array). Since `trade_variables.variable_id` has no FK constraint, any historical `trade_variables` row written before an edit now points to a `variable_id` that no longer exists. The leaderboard's `attributeVariables()` joins against *currently existing* variable ids (`StrategyBuilderController.php:219`), so orphaned rows silently vanish from attribution — no error, no warning. **This is a live data-integrity bug today**, independent of the FSA project, that will directly undermine any "review at 30/50, then promote/adjust" workflow unless fixed.

### 3.3 Old-definition and old-numbering trace table

The audit resolves the briefing's conflict explicitly: **the current 6-rule spec (§2.1 of the briefing) is encoded nowhere in the running application.** What exists instead:

| File | Line | Quote / content | Old or Current | Assessment |
|---|---|---|---|---|
| `app/modals/checklist-modal.php` | 4 | `FSA PRE-TRADE CHECKLIST` header | — | Live, wired popup — triggered from `pages/trades.php:16` via `openChecklist()` in `js/trades.js:474` on every "+ New Trade" click. |
| `app/modals/checklist-modal.php` | 6 | `R2 — Price at 0.618 or 0.705 Fib level on 1H` | **OLD** | Uses the superseded 0.618/0.705 pair, not current 0.382/0.5/0.618. |
| `app/modals/checklist-modal.php` | 8 | `R4 — Price below AVWAP (short) / above AVWAP (long)` | **OLD — smoking gun** | AVWAP encoded as a **mandatory gate at position R4**, exactly the superseded scheme. Directly contradicts the current spec where AVWAP is a non-gating tag reviewed at 50 trades. |
| `app/modals/checklist-modal.php` | 9 | `R5 — Rejection candle CLOSED on 15M (pin bar / engulfing)` | **OLD** | In the current 6-rule scheme this content is R4; here it's pushed to R5 by the AVWAP insertion, and the checklist stops at 5 items (never reaches risk geometry/account state at all). |
| `app/modals/checklist-modal.php` | 10 | `0/5` score display | **OLD** | Denominator of 5, consistent with the old rule count, not the current 6. |
| `app/modals/strategy-modal.php` | 35 | Fib dropdown: `0.382, 0.5, 0.618, 0.705, 0.786` | **MIXED** | Old and current levels co-mingled in the same UI with no validation logic behind any of them. |
| `app/modals/strategy-modal.php` / `js/strategy.js` | 7,13-17 / 20 | Generic `rule1-rule5`/`r1-r5` scaffolding, FSA-flavored default labels | Generic scaffolding, not FSA-numbering-specific | This is the CLAUDE.md-documented generic "up to 5 user-defined rules" sandbox (`strategy_tests`), distinct from the FSA-specific checklist above — defaults are FSA-flavored placeholder text but don't reference AVWAP or 0.618/0.705 as mandatory. |
| `app/includes/controllers/StrategyBuilderController.php` | 257-280 | `legacyFsaAdherence()` — comment explicitly says "Legacy insight from the old fsa_rules COUNT field" | Legacy, self-aware | Degrades gracefully; code already knows this is legacy and is not misrepresenting it as current. |
| `app/js/leaderboard.js` | 66 | `"Legacy FSA Rules Adherence (count only — cannot attribute to a specific rule)"` | Legacy, self-aware | Same — correctly labeled, no confusion risk with the current 6-rule scheme. |

**Zero-hit categories, explicitly confirmed absent:**
- No actual gapped `R5`/`R6`/`R7` FSA-specific numbering scheme (i.e., nothing that skips R4 or numbers risk-geometry/account-state as R6/R7) exists anywhere — the only `rule5`/`r5`-shaped hits are the generic 5-slot `strategy_tests` scaffolding, unrelated to FSA-specific gapped numbering.
- `0.705` never appears independently of `0.618` — confirms it's strictly a leftover of the old Fib pair.
- No seed data, default strategy templates, or PDF/report generator exist anywhere in the repo.

**Synthesis:** Two independently-maintained, still-live UI surfaces disagree with the spec in the briefing. `checklist-modal.php` (last touched by commit `f7eef8e`, five months before the Strategy Lab work and never revisited) is a verbatim snapshot of the old 5-rule/AVWAP-mandatory/0.618-0.705 scheme and is shown to every user on every new trade — but it writes nothing to the database (a `confirm()` dialog only), so it is stale *content* with no data-integrity consequence, purely a user-trust/consistency problem. The generic Strategy Lab (`strategies`/`strategy_variables`/`trade_variables`) — the architecturally current system — has **no FSA-specific content at all**, old or new; it's fully generic. The current 6-rule FSA table this audit was asked to check against needs to be built from nothing; it cannot be "migrated" from an existing encoding because none exists.

---

## 4. Dashboard Coverage

| View | Name | Status | File | Endpoint | Query / computation | Notes |
|---|---|---|---|---|---|---|
| 1 | Why am I not trading | **MISSING** | — | none exists | — | Depends entirely on the Rejection Log entity (§2b), which does not exist. No proxy is proposed. |
| 2 | Performance | **PARTIAL** | `StatsController.php` | `get_stats` (`router.php:28`) | `StatsController.php:29-39`: wins/losses/BE counts, `win_rate = wins/total_trades*100`, `AVG(r_multiple)` as `avg_r` (duplicated in `ReviewEngineController::computeMetrics:202-226` as `expectancy_r`) | Wins/losses/BE/win-rate/expectancy(=avg R) all present. **No raw `SUM(r_multiple)` ("total R") exists anywhere** — only averages. Trivial addition. |
| 3 | Tag attribution | **PARTIAL** | `StrategyBuilderController.php` (leaderboard); `ReviewEngineController.php` (behavioral review) | `get_leaderboard` (`router.php:56`); `get_review` (`router.php:48`) | `attributeVariables()` (`StrategyBuilderController.php:194-254`) and `ruleVariableAttribution()` (`ReviewEngineController.php:316-407`) both do a genuine per-value YES/NO split, but compute **win-rate only** — never total-R or avg-R per side | See §4.2 for the threshold conflict finding. AVWAP/sweep/tweezer have no built-in tag catalog — they'd have to be defined as trader-created `strategy_variables`. |
| 4 | Where the money comes from | **PARTIAL** | `StatsController.php` (`by_session`, `by_pair`); `ReviewEngineController.php` (extremes only) | `get_stats` (`router.php:28`) | `StatsController.php:46,48`: `GROUP BY session` / `GROUP BY pair`, aggregating `COUNT(*)`, win count, and `SUM(net_pnl)` — **currency only, no R** | `ReviewEngineController::groupStats()` (line 228) *does* compute `avg_r` per session/pair internally (used by `ruleTimeOfDayLeak`/`ruleBestWorstPair`), but only ever surfaces the single best/worst extreme, never a full breakdown table. |

### 4.1 Behavioral Review Engine — rule enumeration (`ReviewEngineController.php`)

20 rule-methods, invoked from `getReview()` (lines 99-120), consistent with the "20+ deterministic behavior rules" changelog claim:

| # | Rule (method) | Line | Category | Overlaps view |
|---|---|---|---|---|
| 1 | `ruleFullRuleVsCutCorner` | 262 | discipline | — |
| 2 | `ruleSetupGradeVsOutcome` | 293 | discipline | — |
| 3 | `ruleVariableAttribution` | 316 | strategy | **View 3** — near-duplicate of `StrategyBuilderController::attributeVariables`; same 8-trade floor, win-rate only |
| 4 | `ruleRiskCreep` | 411 | risk | — |
| 5 | `ruleOversizedTrades` | 431 | risk | — |
| 6 | `rulePostLossSizing` | 455 | risk | — |
| 7 | `ruleRevengeTrades` | 483 | psychology | — |
| 8 | `ruleLossStreakTilt` | 517 | psychology | — |
| 9 | `ruleOvertrading` | 536 | discipline | — |
| 10 | `ruleTimeOfDayLeak` | 566 | timing | **View 4** — computes per-session avg_r/win_rate internally, surfaces only best-vs-worst extreme |
| 11 | `ruleEmotionOutcome` | 601 | psychology | — |
| 12 | `ruleNegativeStateFrequency` | 640 | psychology | — |
| 13 | `ruleNoteQuality` | 656 | discipline | — |
| 14 | `ruleWinrateExpectancySanity` | 685 | consistency | **View 2** — same expectancy primitive |
| 15 | `ruleBestWorstPair` | 704 | consistency | **View 4** — computes avg_r per pair internally, surfaces via `pnl` ranking, only 2 extremes |
| 16 | `ruleBreakEvenRate` | 733 | consistency | **View 2** — BE rate already computed here and in StatsController |
| 17 | `rulePeriodTrend` | 748 | consistency | **View 2** — period-over-period avg-R, same primitive as expectancy |
| 18 | `ruleDrawdownProximity` | 791 | risk | — |
| 19 | `ruleDailyLossLimitHits` | 809 | risk | — |
| 20 | `ruleAggressiveVsReserved` | 832 | consistency | — |

**Duplication risk:** rules #3, #10, #15, #17 already compute, internally, almost exactly the aggregates Views 3 and 4 want. Building the FSA dashboard as a separate feature instead of exposing the *full* group tables these rules already build internally (not just their alert-worthy extremes) would create two parallel implementations of "split trades by X, compute rate/R per bucket."

### 4.2 Leaderboard YES/NO split — direct answers

- **Thresholds, verified in code, not assumed from stale docs:** `StrategyBuilderController.php:10-11` — `const MIN_RANKED_TRADES = 20;`, `const MIN_SPLIT_TRADES = 8;`, used at lines 125 and 225.
- **Genuine two-sided split, not YES-only:** `attributeVariables()` (lines 194-254) groups by whatever values were recorded and computes win-rate independently per value bucket clearing the 8-trade floor, then reports the spread between qualifying buckets. Confirmed via the matching yes/no key logic in `ReviewEngineController::ruleVariableAttribution` (lines 368-372). But the split is **win-rate only** — never total-R or avg-R per side, which is what the spec's View 3 explicitly wants.
- **Direct conflict with the spec's 50-trade promotion point:** the leaderboard surfaces a "biggest driver ⭐" badge as soon as **8 trades** exist per side (`js/leaderboard.js:56-59`, no additional gating), with no representation anywhere of a 50-trade confirmation threshold. A trader could see this badge at 8-16 total trades and treat a tag as confirmed well before the spec's intended review point.

### 4.3 Render-location recommendation

| View | Recommendation |
|---|---|
| 1. Why am I not trading | New page + new controller, fed by a new Rejection Log entity (does not exist yet — see Gap G1) |
| 2. Performance | Extend existing `pages/stats.php` / `pages/dashboard.php` — just add a `total_r` (SUM) field to `StatsController::getStats` |
| 3. Tag attribution | Extend the existing Strategy Leaderboard (`pages/leaderboard.php` + `StrategyBuilderController::attributeVariables`) rather than build new — add total-R/avg-R per split value, and add a separate 50-trade "confirmed" threshold distinct from the 8-trade "enough to display" threshold |
| 4. Where the money comes from | Extend existing Stats page (`by_session`/`by_pair`) — add `SUM`/`AVG(r_multiple)` to the existing `GROUP BY` queries; no new page needed |

---

## 5. Defect Carry-over Table

| # | Design defect (from the spreadsheet) | Assessment | Evidence |
|---|---|---|---|
| 1 | **Gapped rule numbering** (R1,R2,R3,R5,R6,R7 in the sheet) | **AVOIDS the specific gap pattern** — no gapped R5/R6/R7 FSA scheme found anywhere in the app. But **has nothing to preserve either**: the live `checklist-modal.php` uses clean R1-R5 numbering that encodes the *old superseded* definition (AVWAP baked in as R4). It isn't gapped, but it's wrong, and needs the same from-scratch R1-R6 rebuild regardless. | §3.3 |
| 2 | **Two-tier rejection logging** must be supported (one-tap tally for R1-R3, full record from R4+) | **Would need to be built from nothing** — no rejection entity of either tier exists. Architecturally feasible: `checklist-modal.php`'s tap-to-toggle pattern (`toggleCheck()`/`updateCheckScore()` in `js/trades.js`) is directly reusable for a one-tap tally UI; the full `trade-modal.php` form is a reasonable model for a heavier R4+ record. Nothing blocks a two-tier design; nothing provides it today. | §2b, §3.3 |
| 3 | **Orphan field** — a captured field with no consumer is worthless | **Already has this exact failure mode today** — `trades.confidence` is written by `ImportController.php` (import path only) but has zero read references anywhere in the app: no display, no query, no analytics. It is a live, current precedent of exactly this problem, independent of any new build. | Data-capture audit, Q2 |
| 4 | **No scan denominator** — rejection counts alone can't distinguish "rules too tight" from "didn't look" | **Would inherit** — no entity anywhere records scanning/analysis activity independent of trades taken, and this is a strict superset of gap #1: even building the full Rejection Log doesn't solve it unless every scan (including ones that don't even reach a rule failure worth logging) produces at least a count. This needs explicit product design, not code. | §2b, §6 (G1) |
| 5 | **Pending state invisible** ("Too early to tell" silently under-sums outcome splits) | **Already has a live version of this bug today, in a different form** — `trades.result` supports `'Open'`, and `StatsController.php:29,33` computes `win_rate = wins / total_trades` where `total_trades = COUNT(*)` of *all* trades including unresolved `'Open'` ones, silently diluting win rate with no separate "resolved-only" metric. Same root defect (an unresolved state distorting an aggregate) is live in production today, independent of the Rejection Log. | `StatsController.php:29,33` (read directly) |
| 6 | **Direction-blind risk geometry** (`ABS()` on both legs lets an inverted stop still show 3.0R) | **Already has this exact bug today** — `CalculatorController.php:19`: `$rr = ($tp > 0 && $sl_dist > 0) ? abs($tp - $entry) / $sl_dist : 0;` uses absolute value on both legs, identical to the spreadsheet's flaw. No code anywhere (`TradeController.php` or `CalculatorController.php`) validates that stop/target sit on the correct side of entry for the stated `direction`. | `CalculatorController.php:19` (read directly) |
| 7 | **BE handling unstated** (sheet silently excludes BE from win-rate denominator, undocumented) | **Different mechanism, same category of problem** — FundedControl does *not* exclude BE; the same `StatsController.php:29,33` denominator (`total_trades = COUNT(*)` of all trades) includes Break Even trades too, so BE trades count against win rate as if partial losses, and this is undocumented anywhere in the API response or UI (no separate "win rate excluding BE" metric, no label explaining what's in the denominator). | `StatsController.php:29,33` (read directly) |

---

## 6. Ranked Gap List

| Rank | Gap | Files / tables touched | Size | Blocks |
|---|---|---|---|---|
| G1 | Rejection/skipped-setup entity does not exist | New table (e.g. `rejections`), new controller, new modal/page, `router.php` | **Large** | Dashboard View 1; defect carry-over #2 (two-tier); defect carry-over #4 (scan denominator) |
| G2 | `checklist-modal.php` shows the OLD, superseded FSA definition live to every user today | `app/modals/checklist-modal.php`, `app/js/trades.js` | **Small** | Nothing else structurally, but it's an active, user-facing correctness bug independent of any roadmap timing — writes nothing to DB, so the fix is content-only |
| G3 | No gate-vs-tag distinction in `strategy_variables` | `strategy_variables` (new column), `StrategyBuilderController.php`, leaderboard aggregation | **Medium** | Correct R1-R6 modeling; derived VALID? (G5) |
| G4 | Hard 5-variable cap blocks 6 gates + 3 tags (needs ≥9 slots) | `StrategyBuilderController.php:85`, `js/strategies.js:113,125` | **Small** | Any attempt to model the full FSA rule set in the current Strategy Lab |
| G5 | No ordering-driven short-circuit evaluation ("first NO ends it") despite `sort_order` existing | `TradeController.php`, `StrategyBuilderController.php` | **Medium** | Derived VALID? (G6); auto-populating a rejection's "First NO" field |
| G6 | No derived `VALID?` equivalent | `trades` (new computed field or on-read logic), `TradeController.php` | **Small-Medium** | Blocked by G3 + G5 |
| G7 | Destructive strategy-variable edits silently orphan historical `trade_variables` (no FK, no versioning) — **live data-integrity bug today**, not FSA-specific | `StrategyBuilderController::saveVariables()`, `trade_variables` (no FK), `strategy_variables` | **Large** | Reliable review-point history at the 30-rejection/50-trade marks; any trustworthy tag-promotion audit trail |
| G8 | No numeric-parameter config surface (min R:R, valid Fib levels, min S/R reactions, pin-bar ratio, max consecutive losses, risk tiers by balance) | `strategies` (new config), `AlertController.php:47-60`, `CalculatorController.php`, `strategy-modal.php:35` | **Medium-Large** | Any future automated compliance checking (not blocking manual YES/NO logging) |
| G9 | Dashboard View 3 win-rate-only split + 8-vs-50-trade threshold conflict | `StrategyBuilderController.php:194-254`, `ReviewEngineController.php:316-407`, `js/leaderboard.js` | **Small-Medium** | Trustworthy tag-promotion decisions |
| G10 | Dashboard View 4 is currency-only, not R | `StatsController.php:46,48` | **Small** | — |
| G11 | Dashboard View 2 missing a raw total-R sum | `StatsController.php` | **Trivial** | — |
| G12 | Direction-blind risk calculator (defect #6) — independent, already-live bug | `CalculatorController.php:19` | **Small** | — |
| G13 | Win-rate denominator silently includes unresolved (`Open`) and breakeven trades, undocumented (defects #5 and #7) — independent, already-live bug | `StatsController.php:29,33` | **Small** | — |

G1 is the dominant blocker: it gates the entire "why am I not trading" half of the spec (View 1) and two of the seven design-defect requirements. G7 is the highest-severity *hidden* item — it's not in the spec at all, but it's already corrupting leaderboard attribution today for any strategy that's been edited, and it will directly undermine the spec's own 30/50-trade review-point mechanism if not fixed first.

---

## 7. Open Questions for Acrob

Code cannot answer these — no guesses have been filled in:

1. **Live DB column types.** No `CREATE TABLE trades` statement exists anywhere in `version.json` history (the table predates migration tracking). Whether `result`, `session`, `direction`, `pair` are true SQL `ENUM`s or `VARCHAR`s with only app-level validation cannot be determined from source — needs a `SHOW CREATE TABLE trades` against the production `theittav_journal` database.
2. **Historical `risk_amount` data.** Current code never writes it (no input field, not copied from the calculator), so it should be uniformly `NULL` — but whether any rows have non-null values from an earlier form version can't be checked from source.
3. **The 55 legacy trades** referenced in the v3.5.2 changelog (commit `b5c453f`) still carry `fsa_rules`/`fib_level`/`confidence` values under the old scheme. Whether that data is still meaningful enough to warrant a migration/backfill decision, or can be left untouched as historical record, is a product call, not a code question.
4. **Was `checklist-modal.php`'s stale content (G2) known?** Whether Acrob intended to update it as part of a later Strategy Lab wave and simply hasn't gotten to it yet, or missed it entirely, changes whether this is a same-day content fix or needs wording sign-off before shipping.
5. **Should AVWAP-aligned / liquidity-sweep / tweezer become fixed system-level tag columns** (like `emotion_tag`/`setup_grade` today), or remain fully trader-defined `strategy_variables`? The current architecture only supports the latter, and that choice determines whether G3/G4/G9 are solved generically or with FSA-specific schema.
6. **Should `session` values be constrained to exactly Asia/London/NY** (per spec) or keep the current London/New York/Asia/Other four-option set? And where should session boundary times and timezone be defined — nothing exists today (confirmed: no timezone/session-boundary logic anywhere in the codebase).
7. **Should the two-tier rejection system (G1) reuse the existing `trade_variables`-style structure**, or be an intentionally separate, simpler schema? This determines whether G1 and G3/G4/G5 should be designed together as one system or kept parallel.
8. **Should "scan denominator" tracking (defect #4) be automatic** (e.g., a lightweight per-chart-view counter) **or manual** (every scan gets at minimum a one-tap log entry)? Not a question code can resolve.
9. **Should the G7 data-integrity bug (destructive variable-edit orphaning) be fixed as a standalone bug fix now**, independent of the FSA project timeline, given it is silently corrupting leaderboard attribution today for any strategy a user has already edited?
10. **Are the risk tiers by account balance** (<$9,500/$9,500-10,000/>$10,000) meant to be FSA-strategy-specific configuration, or a generalization of the existing flat `challenges.risk_per_trade_pct` available to every strategy? No per-balance-bracket concept exists anywhere in the current system.
