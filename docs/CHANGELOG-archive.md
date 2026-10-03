# FundedControl — Release History Archive

Moved out of `CLAUDE.md` on 2026-10-03 (housekeeping pass, no app behavior change) to keep
that file under 600 lines and focused on current-state reference. Everything below is kept
**verbatim** from the pre-split `CLAUDE.md` — nothing was reworded or summarized, so any
version number, line number, or cross-reference ("see the vX.Y.Z section below/above") still
points to real content, just in this file instead of that one.

Two parts:
1. **Per-release history** — every dated "what changed and why" writeup, in original order.
2. **Other retired reference material** — content that was never release-history but also
   isn't needed for day-to-day development per the current `CLAUDE.md`'s own scope (brand
   type-scale detail, an aspirational user-profile/roles-and-permissions spec that was never
   built, the old Namecheap SMTP config superseded by the 2026-09-24 Hetzner migration, the
   GitHub PAT workflow superseded by an already-authenticated `gh` CLI, and the verbose
   Mode A/B deploy-workflow writeup superseded by the condensed version now in `CLAUDE.md`).
   Preserved here rather than deleted so nothing is silently lost.

`CLAUDE.md` itself has the current-state reference: project overview, architecture, database
schema, migration rules, API/helper reference, conventions, harness usage, and the release
checklist.

---

## Part 1 — Per-Release History

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

**Documentation gap, flagged rather than silently left implicit:** the backtesting
pipeline/replay engine (v3.19.0–v3.20.11) and the backtest drawing-tools series
(v3.21.0–v3.21.6) shipped between this section and the next without their own CLAUDE.md
write-ups — this file's version-history narrative jumps from v3.18.0 straight to v3.21.7
below. The `§1` Backtesting subsections above (Pipeline, Replay Engine) do describe the
*current* state of that work, just not release-by-release the way every other feature in
this file is documented. Not backfilled here since it's out of scope for this ticket —
noted so a future session doesn't assume the jump means nothing shipped in between.

### v3.21.7: Risk Calculator Silently Excluded Today's Own Closed Trades

**Symptom:** after closing a trade, the Auto Risk Calculator's balance and every dollar
figure derived from it didn't move, while the sidebar balance updated correctly for the
same challenge. Reported with exact figures (challenge "Bitfunded Altcoin"): sidebar
$9,364.71, calculator "Balance (today, auto)" $9,418.04 — and $9,418.04 minus that day's
real −$53.34 net P&L lands on $9,364.70/71, meaning the calculator wasn't reading a
different (stale/cached) number, it was reading the *same* underlying data through a
`WHERE` clause that excludes today.

**Root cause.** `CalculatorController::autoRiskPreview()`/`::getRiskStatus()`
(`includes/controllers/CalculatorController.php`) computed their displayed balance via
`balanceAtDayStart($db, $challengeId, date('Y-m-d'))` → `helpers.php::challengeBalance()`
with `trade_date < $today` — a real, deliberate function, added in v3.16.0 specifically so
the **risk ladder's own tier** can't flip mid-session just because an earlier trade closed
first the same day (see that section above). The bug: this same start-of-day figure was
*also* reused as the trader-facing "Balance (today, auto)" label and as the basis for
`risk_usd`/`position_usd`/`margin_usd`/`available_margin`/`room_usd`/`stops_to_fail` — none
of which have any reason to lag behind today's own trades. The sidebar was never wrong;
it's fed by the same `challengeBalance()` via `enrichChallenge()` (`helpers.php:145`) with
no date filter at all, i.e. the true live balance.

**Fix — split, not removed.** `balanceAtDayStart()` now feeds *only* `ladderTierForBalance()`
and the ladder tiers' own `is_current` flag — exactly its original, correct purpose,
unchanged. A second value, `challengeBalance($db, $challengeId)` (live, no date arg — the
same call `enrichChallenge()` makes), now backs every dollar figure and the displayed
balance. Both `autoRiskPreview()` and `getRiskStatus()` return `balance` (live) alongside
`balance_at_day_start` (tier basis only) so the frontend can show both without conflating
them. `pages/calculator.php`/`js/calculator.js` relabel the primary figure "Balance
(current)" with a small "Start of day (tier basis)" line underneath, so the ladder's own
stability mechanism (the reason a second, deliberately-lagging number exists at all) stays
visible instead of silently disappearing into one ambiguous label.

**Verified by hand**, not against a live database (unreachable from the environment this
fix was built in): with the reported $9,418.04 start-of-day balance and −$53.34 today, the
live balance re-derives to $9,364.70–71 — the one-cent spread is a rounding residual from
re-adding two already-*displayed*, independently-rounded figures, the same class of gap
already documented for this account's own numbers (see v3.13.2's "−120.07 vs −120.08"
above) — the live controller always derives both values fresh from the same unrounded
`SUM(net_pnl)`, so this residual doesn't occur in the running app. `risk_usd` at the 0.5%
tier now computes as 0.5% of $9,364.71 ($46.82) instead of 0.5% of the stale $9,418.04
($47.09).

**Investigated, not carried into this fix (separate ticket, v3.21.8):** `date('Y-m-d')` in
this same code path (and in `tradeLimitStatus()`) resolves in the server's own default PHP
timezone, which has no explicit `date_default_timezone_set()` anywhere in this app and may
not match the trader's real day boundary (Kigali, UTC+2, no DST) — `ReportCardController`
already solved exactly this for itself with a fixed `Africa/Kigali` constant (see v3.18.0
above) but nothing else in the app reuses it.

### v3.21.8: One Shared "Today," Instead of Every Caller Guessing the Server's Timezone

Closes the gap flagged at the end of v3.21.7 above. `tradeLimitStatus()`
(`includes/helpers.php`) and three call sites in `CalculatorController.php`
(`autoRiskPreview()`, `getRiskStatus()`, and `sizePreview()`'s `trade_date` fallback) all
computed "today" via a bare `date('Y-m-d')` — the server's default PHP timezone, never
explicitly set anywhere in this app, and not guaranteed to match the trader's real day
boundary (Africa/Kigali, UTC+2, no DST). `ReportCardController::today()` had already
solved exactly this for its own module with a fixed `Africa/Kigali` constant (v3.18.0)
— nothing else in the app reused it, so the risk ladder's start-of-day balance and the
trade-limit counts could roll to a new "today" at the wrong instant relative to the
trader's own clock.

**Fix:** `helpers.php::appTodayKigali()` — the identical `DateTime`/timezone construction
`ReportCardController::today()` already used, extracted to one place.
`ReportCardController::today()` now delegates to it (verified by hand: byte-identical
output before and after — this is a pure refactor, that module's own behavior is
unchanged, per instruction). All four call sites named above now use the shared helper.

**Verified this has real effect, not just a refactor:** simulated `2026-09-27 23:30 UTC`
(`= 2026-09-28 01:30` in Kigali, already the next calendar day there) — a bare
`date('Y-m-d')` under a UTC server default returns `2026-09-27` at that instant, while
`appTodayKigali()` correctly returns `2026-09-28`. That's the exact failure mode this
closes: a trade closed just after midnight Kigali time landing on the wrong side of
"today" for the ladder basis and the trade-limit counts. Did not confirm what the live
server's actual default PHP timezone is (no VPS access from this environment) — this fix
makes the app's own "today" correct regardless of what that turns out to be.

### v3.21.9: `updater.php` Doesn't Replay History — a Cumulative Manifest, and Why One Was Needed

**Symptom:** after v3.21.7/v3.21.8 reportedly reached production, the Calculator showed a
split result — available margin read the correct live balance, but the "Balance" field
still showed the old value under the old "Balance (today, auto)" label. The repo was
confirmed correct for both `pages/calculator.php` and `js/calculator.js` (the label and
the JS field both read exactly as v3.21.7 shipped them), and cache-busting was confirmed
working (`calculator` is in `index.php`'s versioned `$__jsModule` list) — so the gap
wasn't in the source or the browser cache. It was in how the update actually got applied.

**Root cause: `updater.php`'s `apply` action does not replay version history.** It fetches
whichever `version.json` is current at GitHub HEAD and downloads only the files listed in
*that one manifest's own* `files` array (`foreach ($remote['files'] as $file)`), then jumps
`local_version` straight to the remote's. There is no per-version replay. Every release in
this project has followed the "only list files that changed in this specific release"
convention (stated in this file's own §18 template) — correct in isolation, but only safe
if Update Now is clicked once per release, in order, never skipped. v3.21.7's manifest
listed `pages/calculator.php`/`js/calculator.js`; v3.21.8's did not, because neither file
changed in v3.21.8 itself. A server whose Update Now click landed on v3.21.8 without a
separate, earlier click having already applied v3.21.7 would download
`CalculatorController.php` (listed in *both* manifests) but never the other two — exactly
the split symptom observed. This is a real, structural gap, not specific to the
Calculator: **any file that changed only in a now-superseded, skipped release, and was
never repeated in a later one, is silently never deployed no matter how many later updates
run.**

**Audit performed before shipping this release.** The live server's own `local_version`
(visible on `updater.php`'s own page) was not confirmed at the time this was scoped — a
real gap in the diagnostic, flagged rather than guessed past. In its absence, `v3.20.3`
was used as the conservative floor: the last version this file's own "Current Version"
header had actually recorded before it went stale for the entire v3.20.5–v3.21.6 series
(corrected in v3.21.7, above). Every manifest from `v3.20.5` through `v3.21.8` was read
directly from git (`git show <tag>:version.json`), and their `files` arrays unioned,
tracking which release first introduced each path. That union was independently
cross-checked against a plain `git diff --stat v3.20.3 HEAD` — if a file had ever been
touched but its manifest entry omitted by mistake, this would have caught it as a
mismatch. **The two lists matched exactly: 20 files, no gaps, no extras** — every
manifest's own bookkeeping was correct in isolation; the only defect was that no single
Update Now click had ever combined them.

**This release's `files` array is that full 20-file union, deliberately, not a diff of
what changed since v3.21.8.** Re-downloading a file whose content is already current on
the server is a harmless no-op; the risk being guarded against is the opposite one — an
intermediate release's file never landing at all. If the live server's true
`local_version` turns out to be later than `v3.20.3` (i.e. some of this range was, in
fact, already correctly applied), this manifest simply re-confirms those files rather than
skipping anything that still needed it — safe either way, given the uncertainty about
where the server actually was.

**Not done here:** `updater.php` itself was not touched (explicit instruction — see the
separate proposal for making it robust against skipped releases, drafted the same session
but not code, pending its own decision). This release also does not confirm what the
live server's `local_version` actually is post-deploy; that still needs a real `Check
Update` click against `updater.php` to close the loop.

### v3.21.10: `migrate.php`'s Own Unbuffered-Cursor Bug, Plus a Related Rollback-Path Defect

**Symptom, from the live error log:** two separate `mode=run` attempts against the four
still-pending backtest migrations (`2026_09_25_0002` through `2026_09_26_0003`) both
fataled with an uncaught `PDOException SQLSTATE[HY000]`, error 2014, "Cannot execute
queries while other unbuffered queries are active" — once inside `recordMigration()`'s
`PDOStatement->execute()` (`migrate.php:182`), once inside `PDO->rollBack()`
(`migrate.php:145`), on two different attempts.

**Root cause.** `migrate.php`'s `$stmt = $db->query("SELECT * FROM schema_migrations")`
(the tracking-table read done once, unconditionally, before any mode branches) was never
`closeCursor()`'d. `fetchAll()` drains the row data into PHP arrays, but the cursor itself
stayed marked active on the connection for the rest of the request — the textbook trigger
for MySQL error 2014. Every statement inside the `mode=run` loop runs via plain
`$db->exec($statement)`, which tolerated the stale cursor (dozens of `CREATE`/`ALTER`/
`SET`/`PREPARE`/`EXECUTE` statements all ran fine first) — the first thing in the whole
request that isn't a plain `exec()` is `recordMigration()`'s own `$db->prepare(...)->
execute(...)`, a genuine native prepared statement, and that's exactly where the first
log entry died. `PDO::rollBack()` is a transaction-control call on the same connection and
hit the identical stale cursor on the second attempt. **Fix:** one line, `$stmt->
closeCursor();` immediately after the `fetchAll()` loop.

**A second, independent bug, found while checking whether `rollBack()` itself was safe.**
`containsDdl()` decided whether a migration needed `beginTransaction()`/`commit()`/
`rollBack()` at all by checking each *split statement's own leading token* for `CREATE|
ALTER|DROP|RENAME|TRUNCATE`. That check structurally cannot see a DDL keyword that only
exists **inside a quoted string handed to `PREPARE`** — which is exactly the shape of
every conditional `ALTER TABLE` in this project since the `information_schema`-check +
`PREPARE`/`EXECUTE` pattern became the standing convention (v3.20.3, §3A step 2a). Two of
the four pending files (`2026_09_25_0002_add_backtest_session_name.sql`,
`2026_09_26_0001_add_backtest_rewind_support.sql`) are built *entirely* from that pattern
— every statement is `SET`/`PREPARE`/`EXECUTE`/`DEALLOCATE`, with no bare `ALTER TABLE ...`
statement anywhere — so both were misclassified as pure DML, wrongly wrapped in a
transaction that protects nothing (MySQL DDL auto-commits regardless of the wrapper), and
that's precisely what put `rollBack()` on the failure path in the second log entry above.
**Fix:** `containsDdl()` now scans the whole comment-stripped migration text (all split
statements joined, unanchored keyword search) instead of anchoring to each statement's own
prefix. **Verified against all 38 existing migration files with a standalone script before
shipping:** only the two files named above flip from DML to DDL under the new check; every
other file — including the three other pending ones, which already contained a literal
`ALTER`/`CREATE` statement — classifies identically to before.

**Resolving item 4 from the original investigation (was rollback leaving migrations
half-applied?):** no, not for these files specifically, and not because of anything in this
fix. MySQL's implicit commit on every DDL statement already meant the transaction wrapper
around a DDL-containing migration protected nothing, wrapper-bug or not — this file's own
§3A has documented that exact limitation since v3.7.0 ("DDL commits implicitly... there is
no rollback"). The real cost of the crash was diagnostic, not data-corruption: the uncaught
exception skipped `recordMigration()` and `renderReport()` entirely, so no `failed` row was
ever written to `schema_migrations` and the operator got a blank 500 instead of a report
naming the failing statement. Both bugs fixed here remove that crash; they don't change
what was already true about DDL migrations not being transactional.

**Two items flagged, not fixed here — `includes/config.php` is never committed to this
repo (§13 rule 4), so neither is checkable or editable from this environment. Acrob is
checking both directly on the server:**

1. **Is `PDO::MYSQL_ATTR_USE_BUFFERED_QUERY` explicitly disabled?** PDO's own default for
   this driver is buffered (`true`) — the 2014 error is only reproducible at all if
   something in `config.php`'s PDO constructor options explicitly set this to `false`
   (plausibly for the candles pipeline's large `SELECT`s). Grep for it:
   ```
   grep -n "MYSQL_ATTR_USE_BUFFERED_QUERY" includes/config.php
   ```
   The `migrate.php` fix above works regardless of what this is set to — but if it's
   explicitly `false`, every other `$db->query()` call anywhere in this app that's ever
   left un-`closeCursor()`'d carries the same latent 2014 risk, not just this file.
2. **Is `PDO::ATTR_PERSISTENT` set to `true`?** Flagged as an open risk for any *future*
   migration that's genuinely DML-only (not DDL): on a normal, non-persistent connection, a
   fatal PHP error tears down the DB connection, and MySQL auto-rolls-back any transaction
   still open on disconnect — so even a failed, uncaught `rollBack()` doesn't leave a real
   DML transaction dangling. A persistent connection would survive the PHP-level crash and
   could leave that transaction open on the MySQL side across requests. Grep for it:
   ```
   grep -n "ATTR_PERSISTENT" includes/config.php
   ```
   Report both results back so this section can be closed out with a confirmed answer
   instead of an open question.

**Shipped this release:** the `closeCursor()` fix and the broadened `containsDdl()` in
`migrate.php` only. No database was touched and `mode=run` was not executed as part of this
turn, per instruction — the four migrations still pending on live should now apply cleanly
the next time `mode=run` is triggered, but that action itself is still Acrob's to take.

### v3.21.11: A Second, Independent Unbuffered-Cursor Leak — the Guarded-ALTER Pattern's Own No-Op Branch

**v3.21.10 wasn't sufficient.** After deploying it, `mode=status` loaded cleanly, but
`mode=run` against the same four pending backtest migrations hit the identical
`SQLSTATE[HY000]` 2014 error again — same call (`recordMigration()`'s `execute()`), just
shifted a few lines by the earlier fix. This meant a second, separate leak existed
somewhere between the now-closed `schema_migrations` cursor and `recordMigration()` itself
— per Acrob's own instruction, this was traced as a full audit of every DB call on that
path this time, not another single-line guess.

**Every call in the `mode=run` path was checked against whether it can return a
resultset:** `CREATE TABLE`/`ALTER TABLE` (DDL, no resultset), `SET @x = (SELECT ...)`
(evaluated server-side, MySQL sends an OK packet, never a resultset, regardless of what
the subquery selects), `PREPARE`/`DEALLOCATE PREPARE` (OK packet), `UPDATE` (affected-row
count only), `recordMigration()`'s own `INSERT ... ON DUPLICATE KEY UPDATE` (DML, no
resultset). All safe. **One shape wasn't: `EXECUTE stmt`.** Every guarded-ALTER migration
in this project (the `information_schema`-check + `PREPARE`/`EXECUTE` pattern, standing
convention since v3.20.3) writes its no-op fallback as a literal `'SELECT 1'`:
```sql
SET @add_col_sql = IF(@col_exists = 0, 'ALTER TABLE ... ADD COLUMN ...', 'SELECT 1');
PREPARE add_col_stmt FROM @add_col_sql;
EXECUTE add_col_stmt;
```
When the guard finds the column **already exists** — true on any retry of a migration
that partially applied before an earlier crash, which is exactly the state all four
pending files were in — `EXECUTE add_col_stmt` runs a genuine `SELECT 1` and the server
returns a real one-row resultset. The per-statement loop ran every statement through
`$db->exec($statement)` (`migrate.php`'s old line 137), and `PDO::exec()` returns only an
`int|false` — there is no statement handle to call `closeCursor()` on, so a statement that
unexpectedly returns rows has no way to be drained through that call. The result: an
unread resultset left on the connection, surfaced only at the next operation that requires
the connection idle — `recordMigration()`, again, for a completely different reason than
v3.21.10's fix addressed.

**Fix:** the per-statement loop now runs `$s = $db->query($statement); $s->
closeCursor();` instead of `$db->exec($statement)`. `query()` always returns a real
`PDOStatement` regardless of whether the statement it ran happens to return rows, so
`closeCursor()` immediately after it is unconditionally safe and guards every statement
shape in this loop — DDL, `SET`, `PREPARE`, `EXECUTE` (no-op or real), `DEALLOCATE`,
`UPDATE` — uniformly, including any future statement shape a migration might use, without
needing to special-case "is this the one that might return rows."

**Not verified against the live MySQL 8.4 instance from this environment** (no DB access
here) — the diagnosis is inferred from PDO/MySQL protocol semantics (an `EXECUTE` of a
`SELECT`-shaped prepared statement is the only call in the entire path capable of
returning a resultset) plus the fact that it exactly explains why the crash recurred at
the same call site after the first, different leak was already closed. Flagged plainly
rather than overstated, consistent with this file's own standing practice for anything
this environment can't directly confirm.

**`PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => true` is being set directly in `includes/
config.php` on the server, as the primary fix** — a connection-level setting that makes
this entire class of bug (an unread/unclosed result blocking the next native prepared
statement) structurally impossible for every query in the app, not just these two call
sites. This release's `migrate.php` change is defense in depth, not a substitute: it
closes the two specific leaks found across v3.21.10/v3.21.11 even if buffered mode is ever
off for any reason, but a third, undiscovered leak elsewhere in the app would still need
the connection-level fix to be safe. The two open items from v3.21.10 (confirming
`MYSQL_ATTR_USE_BUFFERED_QUERY` and `ATTR_PERSISTENT` in `config.php`) are being resolved
by this same server-side change — once confirmed, update those two bullets in the v3.21.10
section above rather than leaving them as open questions indefinitely.

### v3.21.12: Backtesting Drawing Tools — Per-User "Save as Default" for the Fib Tool

**Problem.** Every new fib retracement was built purely from the hardcoded
`BT_TOOL_DEFAULTS.fib_retracement` object in `js/backtest-drawings.js` — a trader's
customised levels/colours lived only on the one drawing they were set on. Delete that
drawing, or draw a new one, and the customisation is gone; the trader expects TradingView
behaviour, where a new fib starts from a saved template. Confirmed on live before
building anything: saving/editing/deleting an individual drawing all worked correctly
(200s throughout, no errors) — this was a missing feature, not a bug in the existing CRUD.

**Schema (`2026_09_29_0001_create_user_drawing_defaults.sql`):** `user_drawing_defaults`
— one row per `(user_id, tool)` (`UNIQUE KEY uq_user_tool`), `tool` reusing
`backtest_drawings.tool`'s exact ENUM literal, `settings` JSON holding a settings object
only (never points/geometry — a default is "what a brand-new drawing should start with,"
not a drawing of its own). Unlike `backtest_drawings.user_id` (no FK — ownership there
resolves through the parent session's own FK to `users`, per that controller's own doc
comment), this table has no session to resolve through, so `user_id` gets a direct FK to
`users(id) ON DELETE CASCADE`, the same precedent `backtest_sessions.user_id` already
uses. `CREATE TABLE IF NOT EXISTS` only — a brand-new table needs no guarded-ALTER
pattern.

**Controller (`BacktestDrawingController`):** three new methods, all scoped to
`uid()` — `getDefaults()` (`{tool: settings}` for this user, omitting any tool with no
saved row rather than a null placeholder), `saveDefault()` (`INSERT ... AS new ON
DUPLICATE KEY UPDATE settings = new.settings` — MySQL 8.0.19+ row-alias syntax,
deliberately not the older `VALUES()` function MySQL 8.0.20+ deprecates; confirmed this
project's live database is real MySQL 8.4, not MariaDB, per §1A, so this syntax is safe
to rely on), `resetDefault()` (a plain `DELETE`, a no-op rather than an error when no
default was ever saved for that tool). Neither `saveDefault()` nor `resetDefault()`
references `backtest_drawings` at all — structurally incapable of touching an existing
drawing, satisfying the briefing's own "existing drawings are never modified" constraint
by construction rather than by a runtime check.

**Frontend (`js/backtest-drawings.js`):** `loadBtDrawingDefaults()` loads this user's
saved defaults once per session open (`openBacktestSession()`, `js/backtest.js`,
alongside the existing `loadBtDrawings()`) — user-scoped, not session-scoped, but reloaded
per session open anyway so a save/reset takes effect on the next session opened without
needing a page reload. `btMergedToolDefaults(tool)` deep-merges the code's own
`BT_TOOL_DEFAULTS[tool]` with the saved default (saved values win field-by-field; any
field the code defines that predates the saved default still comes through, never
silently dropped) — fib's `levels` array is merged **by `ratio`, not array index**,
specifically so a ratio added to `BT_TOOL_DEFAULTS` after a user last saved their default
still appears for them, and a ratio that only exists in an old saved default (removed from
the code since) is deliberately not resurrected. Both `btFinalizeNewDrawing()` (what
actually gets saved) and the in-progress drag preview (`btRenderDrawings()`) call the same
merge function, so the preview can never show something different from what the save
actually produces.

**UI:** a Template row (`btTemplateRowHtml()`) with "Save as default"/"Reset to default"
buttons, added to the fib settings panel only, gated by a `BT_TEMPLATE_TOOLS` list —
generic by tool by design (per the briefing's own instruction), so opting another tool in
later is a one-line addition to that list, not new plumbing. Both buttons toast on
success or error (`btSaveDrawingDefault()`/`btResetDrawingDefault()`).

**Also fixed:** `loadBtDrawings()` previously only logged a load failure to
`console.warn` — a real "why is nothing showing" gap for anyone not watching devtools.
Now also shows a toast, matching every other failure path in this file.

**Verified (code-level trace, not a live browser session — no browser/DB access from
this environment, same standing limitation as every other UI-only verification in this
file):**
1. `saveDefault()`'s `INSERT ... AS new ON DUPLICATE KEY UPDATE` writes exactly one row
   per `(user_id, tool)`, confirmed against the `UNIQUE KEY`.
2. `btFinalizeNewDrawing()` and the preview in `btRenderDrawings()` both call
   `btMergedToolDefaults(tool)` — traced both call sites to confirm neither still
   references the old bare `BT_TOOL_DEFAULTS[tool]`.
3. `loadBtDrawingDefaults()` runs on every `openBacktestSession()`, including a resumed
   session after a reload (`js/app.js`'s hash-restore path calls the same function) — a
   saved default is not session-local, so it survives a reload by construction.
4. `resetDefault()`'s `DELETE FROM user_drawing_defaults WHERE user_id=? AND tool=?` has
   no reference to `backtest_drawings` anywhere in the method — an existing fib is
   structurally unreachable from this code path.
5. `getDefaults()`'s query is `WHERE user_id=?` (`$this->uid`, from the session) — a
   second user has no row at all and `btMergedToolDefaults()` falls back to the pure code
   default when `btDrawingDefaults[tool]` is undefined.

Acrob still needs to click through the actual five-step verification list in a real
browser against live once this deploys and its migration runs — this trace confirms the
code does what it's supposed to, not that it renders/behaves correctly on screen.

### v3.21.13: Position Tool Never Checked Which Side of Entry SL/TP Belonged On

**Symptom, confirmed from a live screenshot:** a Short showed **Entry 6883.40 · SL
6330.28 · TP 5305.40** — both below entry, when a Short's stop must sit *above* entry
(the position loses money as price rises, so the stop that closes it out is above, not
below). The Long tool was never affected — dragging down already puts the stop below
entry, which happens to be correct for a Long, so the missing side-check never surfaced
there.

**Root cause.** `btFinalizeNewDrawing()` took the drag end's raw price as `stop_loss`
verbatim, with no check of which side of entry it landed on. Dragging a Short **down**
— the natural gesture, the same motion a Long tool is dragged — put the stop below
entry: wrong for a Short. `btComputeTpFromRatio()`'s own `Math.abs` then computed a TP
that was *also* below entry, which happens to be the *correct* side for a Short's TP —
so the visible defect was specifically the stop, not the TP. The live drag preview had
the identical bug (it mirrored the same math, unconditionally, since v3.21.12 made both
paths call one shared settings function). `btApplyDrag()`'s `stop`/`tp` drag handles,
and the `entry` handle with the R:R lock off, accepted any price with no side check
either, so an existing drawing's handles could be dragged across entry to the wrong side
just as easily as a brand-new one could be created wrong.

**This geometry was never silently wrong on the server** — `BacktestController::
placeOrder()` (lines 550–558) already rejects it outright (`"For a Short, stop loss must
be above entry."`), so "Place Order" from a broken Short always failed; the bug was
confined to the drawing tool's own client-side geometry, never reached a real trade.

**Fix, four call sites:**
1. **Creation (`btFinalizeNewDrawing()`) and the live preview** now treat the drag
   end's distance from entry as the stop *distance*, never its side — `stopDist =
   Math.abs(dragEnd - entry)`, then `stop = isLong ? entry - stopDist : entry +
   stopDist`. Dragging a Short up or down now produces the identical, correct geometry
   either way, matching how the Long tool already behaved.
2. **`btApplyDrag()`**'s `stop` and `tp` handles are now clamped to the correct side of
   entry via a new `btClampPositionSide(entry, price, wantAbove, minDist)` — dragging
   past entry **stops the handle at the boundary** rather than letting it cross to the
   wrong side. The `entry` handle (which shifts stop/TP by the same delta, so it can't
   newly cross on its own) got the same clamp defensively, recomputed against the new
   entry position.
3. **Minimum distance is 0.01% of entry**, via `btPositionMinDist(entry)` — this app has
   no real tick-size concept anywhere (prices span 0.0044 to 71,968 on this account
   alone, per the v3.14.5 note above), so a fixed absolute tick would be wrong by orders
   of magnitude across that range. A percentage-of-entry floor is the same relative-
   tolerance approach this codebase already uses for exactly that reason (e.g.
   `btSnapPrice()`'s own pixel-based, not price-based, cutoff).
4. **Repair on load (`btNormalizePositionSides(tool, settings)`, new).** *Mirrors* — not
   clamps — a wrong-side stop/TP across entry, preserving its original distance
   (`entry ± |entry − original|`), then enforces the minimum distance. Mirroring, not
   clamping, is deliberate here: this function repairs already-saved bad data where
   there's no drag boundary to stop at, only a wrong number to fix; `btApplyDrag()`'s
   clamp is for the live-drag case, where teleporting the handle to the opposite side
   mid-drag would be a worse UX than stopping it at the boundary. `loadBtDrawings()` now
   runs this on every `position_long`/`position_short` drawing and saves the fix once,
   only if something actually changed — this is what repairs the already-broken live
   Short with no manual data edit, the next time its session is opened.

**Verified against the exact live values from the bug report**, via a standalone Node
script (not a browser — no browser/DB access from this environment): mirroring
`entry=6883.40, stop_loss=6330.28` for a Short produces `stop_loss ≈ 7436.52`
(`6883.40 + |6883.40 − 6330.28|`), matching the ticket's own expected "~7436.5." The
existing `take_profit=5305.40` is already on the correct side (below entry, correct for
a Short) and is left untouched by the repair — confirmed the helper reports it
unmodified. A parallel check confirmed an already-correct Long (`stop < entry < tp`)
reports `changed = false` from the same function, so no already-good drawing gets an
unnecessary save. Also verified: creating a Short by dragging either up or down from the
same entry produces identical `stop`/`tp` values (geometry no longer depends on drag
direction), and the drag-clamp math stops each handle on the correct side of entry for
both Long and Short, mirrored correctly in both directions.

**Colours (`btDrawPosition()`) needed no change.** The red (entry↔stop) and teal
(entry↔TP) fills already used the same `0.18` alpha on both sides — the "pale greyish-
red" look reported on the broken Short was the two zones **overlapping** (both below
entry), not an alpha mismatch. Once the geometry fix keeps them on opposite sides of
entry, the same two `fillRect()` calls render solid on their own.

**Not touched:** no PHP, no migration — `js/backtest-drawings.js` only, per the
briefing's own scope. `php -l` doesn't apply (no PHP changed); `node --check
js/backtest-drawings.js` passed.

### v3.22.0: Backtest Realism, Part 1 — Calibrated Fee Default, Leverage, Risk Ladder Schema

First release of a multi-part series (v3.22.0–v3.22.3) making backtests behave like a
real Bitfunded trade — same sizing rule, same costs — so backtest results can be trusted
to decide whether live trading resumes. **A separate, earlier gate-checklist/R-results
briefing was renumbered to v3.23.0** during scoping — this series' own order ticket
(v3.22.1) is where that gate checklist will eventually plug in, but it is not part of
this series.

**Delivery split into four releases, not one, given how many subtle bugs this project
has already found in much smaller backtest UI changes** (see v3.20.10's rewind, v3.21.0's
drawing-tool hit-testing races, v3.21.13's position-tool side-of-entry bug) — the user's
own choice, confirmed before any code was written:
- **v3.22.0** (this release) — schema + session-setup fields.
- **v3.22.1** — order ticket UI, replacing one-click Place Long/Short.
- **v3.22.2** — risk-ladder engine (start-of-day equity tier lookup, wired into fills).
- **v3.22.3** — running-trade chart display (live lines/zones, linked drawing hide/show,
  rewind-safe).

**Funding was dropped from the entire series, after §0's own live calibration.** The
original briefing specified a `funding_rates` table, a Bybit `GET /v5/market/funding/
history` backfill/cron, maker/taker fee differentiation, and a funding-simulation mode —
all removed once the calibration query (below) came back with a single flat fee and no
maker/taker split at all: there was nothing left for a funding rate to be calibrated
*against* either, on this account. **No `funding_rates` table, no funding backfill/cron,
no funding field anywhere in this series — do not resurrect any of it without a new,
separate briefing.** The original plan's `v3.22.4` (fees/funding engine) is gone; its one
surviving piece — the flat-fee charging check — folds into v3.22.1 instead.

#### §0 calibration (live data, not guessed)

This environment has no live DB credentials (§13 rule 4) — the calibration SQL was run
by Acrob directly against live challenge 6 and the raw results pasted back, per this
project's standing pattern for exactly this situation (the same one already used for the
v3.9.4/v3.10.0/v3.11.0 audit queries documented elsewhere in this file).

**Result: a flat 0.0400% fee per fill, identical across all 64 real Bitfunded fills on
challenge 6 (`source='import'`)** — `min = max = avg` to four decimal places, meaning
there is no maker/taker distinction on this account at all; a Limit order costs exactly
the same as a Market order. Hand-verified against trade 123's own recorded fee:
`(6.4×782.51 + 6.4×766.07) × 0.0004 = 3.964`, matching the stored `3.9644` to the cent
(the small residual is the same class of sub-cent rounding gap already documented at
v3.13.2/v3.13.4 — not a discrepancy worth chasing further).

**This single flat number replaced what would otherwise have been three separate pieces
of the original briefing** — the fee default (§2), the maker/taker fee split (§1/§5), and
the funding-proxy comparison (§0's own second half, against Bybit's historical funding
rates) — since a flat, un-split fee with no funding to calibrate meant two of those three
questions simply had no answer to find, and the third (the fee default) had one number,
not two.

#### Schema (`2026_09_30_0001_add_backtest_session_leverage_ladder_fee_defaults.sql`)

Three new `backtest_sessions` columns via the standard guarded-ALTER pattern (§3A step
2a), plus one bare `MODIFY COLUMN` (always safe/idempotent, same precedent as
`2026_09_25_0001`'s `source` ENUM modify and `2026_09_26_0002`'s `cursor_step_tf`
modify):

- **`default_leverage`** `TINYINT UNSIGNED NOT NULL DEFAULT 5` — the order ticket's
  leverage dropdown (v3.22.1: 1×/2×/3×/5×/10×/20×) defaults to this per session, and can
  always be overridden per order; leverage is never written back to the session from an
  order. `NOT NULL DEFAULT 5` (not nullable like `challenges.default_leverage`) because
  every backtest order needs a *concrete* leverage to compute margin/liquidation — there
  is no meaningful "not set" state to protect with `NULL` here, unlike the live
  calculator's own leverage field, which predates any leverage concept existing at all.
- **`risk_ladder_json`** `JSON NULL` — three tiers, stored as **% of the session's own
  `starting_balance`**, not absolute dollars like the live `risk_ladder_tiers` table. A
  backtest's starting balance is arbitrary and chosen per session, so a
  %-of-starting-balance tier is the only representation that stays meaningful across
  every session — this mirrors how the setup form's own existing "Prefill from
  challenge" already converts `daily_loss_limit` (an absolute dollar figure) into a % at
  prefill time. Kept as JSON, not a child table like the live ladder — always exactly 3
  tiers, always replaced as one whole unit from the setup form, never edited row-by-row.
  Same "MySQL validates well-formedness, not shape" contract `backtest_drawings.
  settings`/`points` already carries — the shape lives in `BacktestController.php`/
  `js/backtest.js`, not the schema.
- **`use_flat_risk`** `TINYINT(1) NOT NULL DEFAULT 1` — defaults to flat (`1`)
  specifically so every **existing** session, which has only ever used the single
  `risk_pct` column, keeps behaving exactly as before with zero engine change the moment
  this migration runs (§6's "old sessions keep working, NULL-safe defaults" rule). A
  **brand-new** session's own setup-form default is tiered instead (the checkbox defaults
  unchecked) — that's an explicit application-layer choice made at `createSession()`
  time, not something the schema's own `DEFAULT` clause decides.

#### Controller (`BacktestController.php`)

`DEFAULT_FEE_RATE_PCT` changed from `0.0550` (Bybit's generic, never-validated original
guess) to `0.0400` (the calibrated value above) — affects only a brand-new session's own
default; an existing session's already-stored `fee_rate_pct` is completely untouched,
both by this constant and by the migration's `MODIFY COLUMN`, which only ever changes
what a *future* insert defaults to.

New `ALLOWED_LEVERAGES` (`[1,2,3,5,10,20]`) and `DEFAULT_RISK_LADDER` (the coded
`≥95%→1.0% / 92.5–95%→0.5% / <92.5%→0.25%` ladder) constants, and a new
`validateRiskLadder()` — falls back to `DEFAULT_RISK_LADDER` on anything missing or
structurally wrong (not exactly 3 tiers, a missing `lower_pct`/`risk_pct` key, an
out-of-range value) rather than rejecting the request outright, the same treatment
`drawdown_type` already gets a few lines below in the same method, for the same reason:
these are optional setup fields, not measurements where a silent default would
misrepresent a real fact (contrast `trades.session`/`r_multiple`, where `NULL`-means-
unknown is the rule specifically *because* a wrong guess there would misrepresent
something that actually happened). `createSession()`'s handling of a missing
`use_flat_risk` key defaults to `1` (flat), matching the DB column's own default — the
setup form itself always sends an explicit value either way, so this branch only matters
for a malformed or direct API call. `sessionSummary()` returns all three new fields for
every session, decoding `risk_ladder_json` back to `DEFAULT_RISK_LADDER` when `NULL`
(every pre-migration session) so the response always carries a well-shaped ladder array
rather than `null`, even though that session's `use_flat_risk=1` means nothing currently
reads it.

Verified with a standalone PHP script (replicating `validateRiskLadder()`'s exact logic,
outside the class since it needs no DB): a `null` payload, a valid custom 3-tier ladder, a
wrong tier count, a tier missing `risk_pct`, a zero `risk_pct` (invalid — must be `>0`),
and an out-of-range `upper_pct` (`150`) — all six cases resolved exactly as designed (the
five invalid shapes all fall back to `DEFAULT_RISK_LADDER`; the valid custom ladder passes
through with its values preserved, including a `null` top-tier `upper_pct`).

#### Frontend (`pages/backtest.php` / `js/backtest.js`)

New Backtest form gains: a Default Leverage `<select>` (the six `BT_ALLOWED_LEVERAGES`
values, mirroring the PHP constant exactly); a "Flat risk % per trade" checkbox
(`onBtFlatRiskToggle()`) that only ever toggles which of the flat-%-input / 3-ladder-rows
is *visible* — both stay in the DOM and are always both submitted on create, so switching
the toggle back and forth before submitting can never lose either value, the server alone
decides which is authoritative via `use_flat_risk`; and a "Prefill from challenge" button
on the ladder (`onBtLadderPrefill()`) that calls the *existing* `get_risk_status`
endpoint (`CalculatorController::getRiskStatus()`, which already accepts an optional
`challenge_id` param — no new backend route was needed) and converts the challenge's own
absolute-dollar `ladder_tiers` into % of that challenge's `starting_balance`, the same
conversion principle the existing daily-drawdown prefill already uses one function up.
Rejects (with a clear toast, not a silent fallback to the coded default) a live ladder
that doesn't have exactly 3 tiers — `risk_ladder_tiers` has no such constraint at the live
-challenge level, so this is a real, if unlikely, case worth a real message rather than
quietly substituting the coded default with no explanation. The "Prefill from challenge"
*ladder* button is kept in sync with the existing challenge dropdown on every change
(including back to "— Custom —"), so it can't get stuck enabled after the selection is
cleared.

Verified with a standalone Node script replicating the render→read round trip (confirms
`btRenderLadderRows()` → `btReadLadderRows()` reproduces the exact input ladder, `null`
top-tier `upper_pct` included) and the dollar→percent conversion math (a
challenge-6-shaped live ladder — 0/9250/9500 dollar bounds on a $10,000 starting balance —
converts to exactly 0/92.5/95%, matching `DEFAULT_RISK_LADDER`'s own coded values, as
expected since that coded default was itself modeled on challenge 6's live ladder).

`php -l` (both PHP files) and `node --check js/backtest.js` all pass.

#### Not done in this release (deliberately — see the delivery split above)

The order ticket (leverage dropdown wired to a real order, margin/liquidation display,
blocking rules), the risk-ladder engine actually looking up a tier during a fill, and the
running-trade chart display are all v3.22.1–v3.22.3. This release only adds the schema
and the setup-form fields to capture the session-level configuration those later releases
will read.

### v3.22.1: Backtest Realism, Part 2 — Order Ticket, Draggable Lines, Position-Tool Pill Labels

A follow-up briefing replaced §1 (order ticket) and §4 (running trade display) of the
original v3.22.0 spec with a much more detailed interaction design, modelled on a
commercial backtesting tool's screenshots the user supplied — built here in
FundedControl's own dark style, no branding/wording copied beyond generic trading labels.
§4 became "Part C," explicitly **v3.22.3**, not this release. The original v3.22.4
(fees/funding engine) is gone entirely — funding was already dropped in v3.22.0; this
release absorbs the one surviving piece, confirming the fee-charging math.

**Order of work, as specified:** this release is Parts A and B (the ticket, the
draggable lines, the fee-charging confirmation). v3.22.2 (risk-ladder engine) is
unchanged in scope. Part C (the live open-trade display) is v3.22.3.

#### Part A — position-tool pill labels

`btDrawPosition()` (`js/backtest-drawings.js`) rewritten: the old plain monospace text
block (Entry/SL TP/R:R/Risk/Size, stacked to the right of the box) is replaced by three
pill labels via a new `btDrawPill()` primitive (rounded rect, filled, white text —
manual `arcTo()`-based rounding rather than `ctx.roundRect()`, since this app makes no
assumption about a minimum Chrome version elsewhere):
- **Stop** (red, outside the box on the stop edge): `Stop: {price}, {dist} pts ({pct}%),
  Amount: ${riskUsd}`.
- **Centre** (on the entry line): `Entry: {price}, RR 1:{rr}` — neutral grey (`#4b5563`)
  today; the code checks `d._linkedTrade` for a floating-P&L-coloured, two-line
  "Open P&L.../Entry..." variant, but nothing sets that property yet since linking a
  drawing to a live trade is v3.22.3's `linked_trade_id`. Wired in structurally now so
  v3.22.3 only has to set one property, not touch this function again.
- **Target** (teal, outside the box on the TP edge): `Target: {price}, {dist} pts
  ({pct}%), Amount: ${rewardUsd}`.

Both dollar Amounts are **net of the round-trip fee** — entry fee plus the exit fee AT
THAT LEVEL'S OWN PRICE (the stop's own exit fee for the Stop pill, the target's own for
the Target pill; these differ slightly since fee is charged on fill price, not one
shared number) — the exact same formula `js/backtest.js::btComputeTicket()`'s own
`riskUsdNet`/`rewardUsdNet` uses, so a drawing's preview pills and the eventual ticket
can never disagree about what "Amount" means. Sizing still comes from the session's flat
`risk_pct` (a plain drawing has no leverage/risk chosen yet — that only exists once
"Place trade" opens the real ticket, which is free to size differently).

**x-axis time pills** — small blue pills at the box's own start/end times, shown only
while the tool is selected, positioned near the bottom of the overlay canvas (which
covers the chart's own time axis, same as everywhere else this file positions things
relative to the chart).

**The red/teal fill colours needed no change** (confirmed, not assumed) — both already
shared the same `0.18` alpha; nothing about "Amount" pills changes that.

#### Part B1 — floating selection toolbar

The old canvas-drawn "Place Order" button (`btDrawPlaceOrderButton()`, and its own
`_placeOrderBtnRect` hit-test inside `btOnDrawMouseDown()`) is **removed entirely**,
replaced by a real DOM element (`#bt-pos-toolbar`, `pages/backtest.php`) positioned each
redraw by `btPositionSelectionToolbar()`. Real DOM means real hover/click targets
instead of hand-rolled canvas hit-testing — six controls, left to right per the
briefing: drag handle, colour (`<input type=color>`, reusing the settings popover's own
pattern rather than a button+icon), settings (opens the existing popover), **Place
trade** (primary, green-outlined — the one button styled like an actual button rather
than an icon), R:R lock toggle, delete. Icons are original, hand-drawn (24×24 stroke
paths matching this file's own existing v3.21.1 toolbar set) — no tracing of the
reference tool's artwork.

Only rebuilds its inner HTML when the **selected drawing** changes
(`btToolbarBuiltForId`) — every other redraw is a cheap reposition-only pass. Hidden
whenever nothing capturing-worthy is selected, or while a drag/ticket-line-drag is in
progress (showing a clickable toolbar mid-drag would be a confusing, easy-to-mis-click
target). The drag handle repositions the toolbar via `btToolbarOffset`, a same-session,
non-persisted adjustment reset the moment a different drawing is selected — deliberately
**not** given the settings popover's own remembered-position treatment (v3.21.4): a
toolbar that only exists while one specific drawing is selected has nothing meaningful to
remember the position *for* once that selection ends.

#### Part B2 — the order ticket

Clicking "Place trade," or the sidebar's own "New Trade" panel button (`placeBtOrder()`,
renamed in spirit — the button's `onclick=` wasn't touched — from submitting directly to
opening the ticket prefilled from its fields), opens `btOpenTicket()`
(`js/backtest.js`), which renders `#bt-ticket` — a **docked** panel at the left of the
chart (`position:absolute` inside `.tv-chart-wrap`, not a centred modal), so the chart
stays visible while it's open, per the briefing.

**Single source of truth: `btTicket` itself.** Both the panel's own number inputs and
the on-chart entry/stop/TP lines (Part B3) are pure, derived renderings of this one plain
object — typing in the panel or dragging a line both just mutate `btTicket` and call
`btRenderTicket()`, which re-renders both. No separate "sync" step, no feedback-loop
risk — the identical single-state-object pattern `btDrawings`/`d.settings` already uses
throughout this file, applied to a second kind of state object.

**Fields, exactly the nine rows specified:**
1. Long/Short segmented toggle. Switching mirrors SL/TP across entry via the *existing*
   `btNormalizePositionSides()` (v3.21.13) — applied to the ticket's own plain state via
   a small translation object, not a second copy of the mirror logic.
2. Market/Limit segmented toggle, defaulting per the 0.05%-of-close rule computed inside
   `btOpenTicket()` itself. Limit shows the hint "Drag the orange entry line to set your
   price." Switching to Market snaps `entry` to the current close immediately (not just
   on the next render).
3. Stop Loss: always on, disabled (required, per Phase 1b rules) — a checkbox rendered
   `checked disabled` rather than omitted, so the row still visually communicates "this
   is on" instead of just not existing.
4. Take Profit: on/off checkbox, price input, and "Keep 3R" (checked by default) —
   recalculates TP live from entry/SL via `btComputeTpFromRatio()` whenever either
   changes while checked; unchecked the moment TP is dragged or typed directly, same
   rule a drawing's own TP handle already follows (v3.21.0). No "+" for multiple
   take-profits, per the briefing's own explicit "out of scope."
5. Risk: a %/$ switch, a value field, and a live `= $X`. Prefilled from the session's
   flat `risk_pct` always (per the briefing: "Until [v3.22.2] lands, use flat risk") —
   the ladder tier is looked up **separately**, purely for comparison: `btLadderTierFor
   EquityPct()` (mirrors `helpers.php::ladderTierForBalance()`'s own lower-inclusive/
   upper-exclusive/null-means-and-above logic, verified against five boundary cases with
   a standalone script) checks the entered risk against the session's own
   `risk_ladder`, and shows an amber "Off-ladder" note when they differ — `risk_amount`
   is recorded as planned either way, matching the live Size Integrity feature's own
   convention (v3.15.0) of never hiding an off-plan value, just flagging it.
6. Leverage dropdown (the session's own `default_leverage`, editable per order) with
   live margin required / available margin / estimated liquidation price, and the note
   "Leverage changes margin, not risk" — literally true by construction: leverage never
   enters `btCalcPositionSize()`'s own formula at all, only `btCalcMarginRequired()`'s.
7. Lot Size (computed) and a live RR badge.
8. Est. entry fee + exit fee = total, at the session's `fee_rate_pct`.
9. Cancel / Place Trade — disabled, with the reason shown, for: a wrong-side stop,
   margin required exceeding available margin, an estimated liquidation price that would
   trigger before the stop, or the session's own daily trade cap. (The cursor-not-at-
   latest-bar rule has **no client-side equivalent check** — it's a fact about the
   server's own replay cursor at submit time, not something to duplicate/guess
   client-side; `BacktestController::placeOrder()` already re-validates every one of
   these regardless, so nothing here is trusted blind.)

**Market recalculation, verified by construction:** `btComputeTicket()` always reads
`entry` from the live close for a Market ticket, never from `btTicket.entry` directly —
so lot size/RR/TP-amount recompute on every render without any special-case "did the
price change" branch. With Keep 3R checked, TP is recomputed from the *current* entry
via `btComputeTpFromRatio(..., 3)` on every render too, so RR reads exactly `1:3.00`
regardless of how far entry has moved; unchecked, TP stays wherever it was last set and
RR reads whatever that produces against the new entry (the briefing's own "for example,
3.09" example).

#### Part B3 — full-width draggable price lines

**Deliberately NOT `Lightweight Charts`' native `createPriceLine()`**, despite the
briefing naming that API — the pinned chart version (v4.1.3, per this file's own v3.21.0
architecture note) has **no drag support for a price line at all**; every other drawing
tool in this file already made the identical call (canvas overlay, not primitives) for
exactly this reason. `btDrawTicketLines()` draws all three lines on the *same* overlay
canvas every drawing tool already renders on, reusing `btDrawPill()` (Part A) for the
near-right-edge labels: orange dashed "Limit {price}" / blue solid "Entry {price}" (order
type), red dashed "Stop Loss −${riskUsd}", green dashed "Take Profit +${rewardUsd}" — the
dollar figures are the identical `riskUsdNet`/`rewardUsdNet` the ticket panel itself
shows, computed once by `btComputeTicket()` and read by both renderers.

**Hit-testing integrated into the existing capture-phase handlers** (`btOnDrawMouseDown/
Move/Up`, v3.21.1's own architecture), not a parallel event-listener set: a new
`btTicketLineHitTest()` is checked **first**, before the active-tool/cursor-mode logic,
but returns `null` immediately whenever no ticket is open — every existing drawing-tool
interaction path is unchanged when the ticket is closed, which is the overwhelming
majority of the time. A hit sets `btTicketDragField` (a new, separate state var from
`btDragState` — the ticket's lines aren't `backtest_drawings` rows, so they have no
drawing id to look up through the existing drag machinery); mousemove converts the
cursor's Y to a price via the existing `btYToPrice()` and calls `js/backtest.js::
btTicketSetField(field, price)`, which applies the *exact same* v3.21.13
`btPositionMinDist()`/`btClampPositionSide()` clamp a drawing's own stop/TP handles
already use — a ticket's lines can no more cross entry than a drawing's can. The Entry
line only hit-tests at all when `orderType === 'limit'`, per the briefing.

#### Part B4 — fee charging, confirmed not changed

Checked before writing anything: `fillPosition()` already charges `backtestFee(lotSize,
entryPrice, feeRatePct)` on entry, `settleTrade()` already charges the same on exit, both
added to `trades.fees`, and `net_pnl = pnl - fees` is what equity is actually derived
from — this is **already exactly what the briefing asked for**, unchanged from when it
first shipped (v3.20.0). Per the briefing's own instruction ("if it already does exactly
this, add the standalone test and leave the code unchanged"), only a test was added:
`backtest_engine.php`'s self-test now asserts the calibrated 0.04% round-trip
(`6.4×780×0.0004×2`) and the real trade-123 shape from the v3.22.0 calibration
(`entryFee + exitFee ≈ 3.9644`, matching CLAUDE.md's own hand-verified figure to four
decimal places) — 44 assertions total, all passing.

#### Schema (`2026_09_30_0002_add_backtest_order_leverage.sql`)

Two columns, both via the guarded-ALTER pattern: `backtest_pending_orders.leverage`
(`TINYINT UNSIGNED NOT NULL DEFAULT 5` — a Limit order remembers the leverage chosen at
placement time until it fills, same reason that table already has its own `risk_pct`
column separate from the session's), `trades.leverage` (nullable — only a backtest trade
filled from this release forward ever sets it; every other row on this table has no
leverage concept at all, so `NULL` correctly means "not applicable"). **Margin used is
NOT a new column** — `trades.planned_margin` (v3.17.0) is reused, per the *original*
v3.22.0 briefing's own "reuse existing trades columns wherever they already exist"
instruction (§3, unchanged by this ticket) — a backtest trade populating the same column
with the same meaning ("margin committed to this position") is a second writer, not a
repurposing.

#### Controller (`BacktestController.php`) and engine (`backtest_engine.php`)

Two new pure functions: `backtestMarginRequired(notional, leverage)` (`notional ÷
leverage`), and `backtestLiquidationPrice()`/`backtestLiquidationBeforeStop()` — a
**deliberately simplified** "full allocated margin wiped out" liquidation estimate
(`entry × (1 ∓ 1/leverage)`), ignoring maintenance-margin buffers, funding, and fees: this
app tracks no real exchange's maintenance-margin schedule for any symbol, and modelling
one without real data to calibrate against would be inventing precision this app can't
back up — the identical reasoning that already kept `fee_rate_pct` a single flat number
instead of a guessed maker/taker split that turned out not to exist either (v3.22.0). A
real exchange liquidates earlier than this estimate, never later, so it's a conservative
upper bound appropriate for the one thing it's used for: flagging, before an order is
placed, that the stop can never realistically be reached.

`placeOrder()`/`fillPosition()` now take `leverage`/`risk_pct` as explicit parameters
(falling back to the session's own defaults when the request omits or invalidates
either — same "sane default for an optional field" treatment `drawdown_type` already
gets in `createSession()`), and a new `checkMarginAndLiquidation()` enforces both new
blocking rules **server-side**, not just as a ticket-side convenience — this app's own
standing practice (e.g. v3.17.2's whole point) is that a real validation rule is never
client-only. The pending-order fill path (`evaluateBar()`) now passes through the
**order's own** stored `risk_pct`/`leverage` at fill time, not the session's current
defaults — a Limit order can sit pending for many bars, during which the session's
defaults are no longer necessarily what it was sized against.

**A subtlety the standalone verification below exists specifically to catch:** margin
sufficiency and liquidation-before-stop are two *independent* failure modes — a highly
leveraged order can have plenty of available margin (leverage lowers margin *required*)
while still being structurally unsafe (leverage also moves the estimated liquidation
price closer to entry). Verified directly: at 60× leverage on a $10,000/1%-risk/2-point-
stop example, margin required is only $83 (comfortably within budget) while the
estimated liquidation price (98.33) sits *inside* the stop distance — `checkMarginAndLiq
uidation()` catches this via the *second*, separate check, not the margin one.

#### Verification performed, and what still needs a real browser

**Verified via standalone PHP/Node scripts** (no DB, no browser — this environment has
neither): every new pure function (fee, margin, liquidation price, liquidation-before-
stop) cross-checked between its PHP (`backtest_engine.php`) and JS (`js/backtest.js`)
implementations, producing byte-identical numbers on both sides for the same inputs;
`btLadderTierForEquityPct()` against five boundary cases (lower-inclusive, upper-
exclusive, null-upper-is-and-above); `btNormalizePositionSides()` applied to a direction
switch (Long→Short→Long round-trips losslessly back to the original stop/TP); the
render→read shape every ticket field passes through. `php -l` on all three PHP files,
`node --check` on both JS files, and `php includes/backtest_engine.php`'s full 44-
assertion self-test all pass.

**NOT verified — needs a real browser click-through, per the briefing's own eight-item
list:** the ticket actually opening and rendering correctly from both entry points; the
pill labels' on-screen position/legibility; the floating toolbar's positioning,
drag-handle behavior, and six buttons' actual click targets; the ticket lines' real
drag feel and the two-way sync's visual correctness; the Keep-3R checkbox's live
recompute while dragging; the disabled-Place-Trade reason actually rendering
legibly; and — critically — whether `checkMarginAndLiquidation()`'s new blocking rules
ever produce a false positive against real session data once a real margin-in-use
figure exists (untested against a live session with actual open positions, since this
environment can't create one). Acrob still needs to run the eight-item verify list from
the briefing against a live deploy before this is trusted the way the rest of this file's
verified-in-a-real-browser sections are.

### v3.22.2: Backtest Realism, Part 2 Fixes — Keep-3R Recompute, New Trade, Ticket/Drawing Sync, Toolbar Overlap

A fix release for v3.22.1's own bugs, found by actually running v3.22.1 in a real
browser (headless Chromium via a new harness, see below) — not new scope. Confirms the
browser-verification gap flagged at the end of v3.22.1 was real: every bug here was
found by clicking through, not by reading the code.

**Fix 1 (real calculation bug, gate 5):** Keep 3R wasn't recomputing TP when the
*effective* entry changed — switching a ticket from Limit to Market moved the entry used
for margin/lot-size/RR everywhere else, but TP stayed wherever it was computed at ticket-
open time, so a "3R" take-profit silently stopped being 3R the moment the trader switched
order types. Root cause: `js/backtest.js`'s own market-entry formula was duplicated
inline at each call site instead of centralized, so ticket-open and the orderType switch
never re-ran it. Fixed with two new small functions — `btTicketEffectiveEntry()` (the
one place "what is entry right now" is computed: the live close for Market, the typed/
dragged price for Limit) and `btTicketApplyKeep3R()` (the one place TP gets recomputed
from it) — called from every path that can move effective entry, stop, or direction while
Keep 3R is checked: ticket open, the orderType toggle, the direction toggle, a stop-loss
edit (typed or dragged), and an entry-line drag. Verified in the browser: entry 8602.59/
stop 8545.04 (Limit) → switch to Market (close 8580.94) → TP recomputes to 8688.64, RR
reads exactly 1:3.00, and the submitted `backtest_place_order` payload's `take_profit`
matches.

**Fix 2:** the sidebar panel's own "Open Ticket" button wrongly refused with "Stop loss
is required." when its own SL field was empty, reading as the ticket itself being broken.
Renamed **New Trade**, and it now always opens the ticket (`btNewTradeClick()`), prefilled
in priority order: the selected position tool, else the most recent position-tool drawing
with no linked trade yet (`d._linkedTrade`, structurally still unset until v3.22.3), else
a bare Market ticket at the current close with the sidebar's own direction toggle and SL
empty. All validation now lives only in the ticket's own disabled-button reason — a
missing stop is a new, explicit `blockReason` check in `btComputeTicket()` ("Enter a stop
loss.", since a zero/empty stop doesn't trip the existing wrong-side-of-entry checks).
The sidebar's own SL/TP/Limit-price inputs (and the order-type select) are removed
entirely — one way to enter a trade, not two.

**Fix 3:** while a ticket is open, the box/pills it was opened from kept showing the
drawing's stale, pre-ticket numbers — after switching to Market above, the chart still
said Entry 8761/Target 9049 while the ticket and its own on-chart lines already said
8819/9281, i.e. the trader could see two different trades on screen at once.
`btDrawPosition()` (`js/backtest-drawings.js`) now accepts an optional `override` —
`js/backtest.js::btTicketRenderValues()`, built from the exact same `btComputeTicket()`
the ticket panel itself renders from — and renders the linked drawing's box/pills from
that instead of `d.settings` whenever `btTicket.sourceDrawingId === d.id`. `d.settings`
itself is never touched while the ticket is open, so Cancel needs no revert logic at all
— it already shows the original values the instant the override stops applying. A ticket
opened with no source drawing (New Trade with nothing selected) draws a temporary,
unselectable box from the ticket's values instead, anchored at the current replay bar
(same `BT_POSITION_TOOL_SPAN_BARS` span a real drawing gets) — **caught in browser
verification, not code review:** the anchor is `chartState.candles[].time` (raw UTC ms
from the API) run through `toDisplaySeconds()` first — using the raw ms value directly,
which every real drawing's own `points[].time` never does, would have placed the box
wildly off-chart. Place Trade now saves the ticket's final entry/SL/TP into the source
drawing via the existing `btUpdateDrawing()` before closing.

**Fix 4:** the floating selection toolbar was positioned `topY − toolbarH − 10` measured
from the topmost entry/stop/TP *line*, but the Stop/Target pills are drawn *offset
outside* their line (Part A's own "outside the box" placement) — so the toolbar sat on
top of the Target pill (Long) or Stop pill (Short) whenever the pill's own height pushed
it above where the toolbar assumed the top of the box was. `btDrawPosition()` now tracks
the actual on-screen bounding box of whichever pills it draws each frame
(`d._btPillBounds`), and the toolbar measures from that instead; if that would place it
above the chart area, it flips to below the lowest pill. Verified for both Long and Short
in the browser via exact pixel-rectangle overlap checks (not just eyeballing
screenshots), zero overlap both times.

**Fix 5:** a one-line hint ("Draw a Long/Short position on the chart, or click New
Trade.") now shows in the sidebar whenever the session has no position-tool drawing at
all (`btUpdateNoDrawingHint()`, called on session load and after every drawing add/
delete). Clicking inside a position box to select it already worked and needed no change.

**A real, previously-unknown bug found *while building the browser harness itself*, not
part of the original five-item list:** the order ticket (`#bt-ticket`) and the floating
toolbar (`#bt-pos-toolbar`) are real DOM widgets that live *inside* `.tv-chart-wrap`
(so they dock against the chart, per the v3.22.1 architecture) — but the drawing tools'
own capture-phase `mousedown` listener is attached to that same `.tv-chart-wrap`, so it
saw every click inside the ticket and toolbar too, hit-tested them against canvas
coordinates, found no drawing there, and silently deselected whatever was selected. In
practice: closing the ticket (even via Cancel) cleared `btSelectedDrawingId`, so the
floating toolbar never came back for a drawing that was clearly still on screen — the
only way to get "Place trade" back was to click the box again. Fixed with one guard,
`btEventIsOnDrawingSurface(e)` (`!e.target.closest('#bt-ticket, #bt-pos-toolbar')`),
checked first in `btOnDrawMouseDown`/`btOnDrawDblClick`/`btOnDrawContextMenu` — mousemove/
mouseup need no change, since they only ever act on state a guarded mousedown could have
set in the first place. This is exactly the kind of bug the browser-verification gap
flagged at the end of v3.22.1 was warning about: invisible to code review, obvious the
first time a real click sequence (open ticket → Cancel → try to reopen) ran in a real
browser.

**New: `tools/ui-harness/`** — a reusable, DB-free Playwright+PHP harness (outside
`app/`, never deployed — not in `version.json`'s `files` array). `setup.js` copies `app/`
into a fresh OS temp dir per run, overlays a stub `includes/config.php`
(`requireLogin()`/`currentUser()` only) and a stub `includes/api.php` (mocks exactly the
six backtest actions this flow needs, plus `get_user`/`get_challenges`/`get_risk_status`
so `js/app.js`'s own `DOMContentLoaded` startup sequence doesn't throw before the page
ever settles), vendors `lightweight-charts@4.1.3`/`chart.js@4.4.0` locally (this
package's own npm dependencies) in place of the two CDN `<script>` tags, and serves it
via `php -S` behind a one-file router. `drive.mjs` drives it with real Chromium,
asserting on live page state (`btTicket`/`btComputeTicket()`/`btDrawings` read directly
via `page.evaluate()`, not just DOM text) and saving a numbered screenshot after every
step. `backtest_place_order` always returns `{error:'MOCK', received:<payload>}` — real
enough to verify exactly what a ticket submitted, deliberately inert so nothing looks
like a real fill; the one test that needs to see the *post-success* path
(`btUpdateDrawing()` + close) monkey-patches the page's own `btApi()` for that single
call instead of changing the PHP mock, so the real committed `btSubmitTicket()` code
still runs end-to-end in the browser. **Use this for every UI release in this project
from now on**, per the instruction that created it — no more shipping chart/canvas UI
changes verified only by standalone math scripts.

**Verified in the browser, all passing:** the Fix 1 repro exactly (TP 9281, RR 1:3.00,
matching submitted payload); New Trade opening empty-SL on Market with the "Enter a stop
loss" reason, enabling once a stop is typed; the drawing/ticket pill sync during a Limit→
Market switch and Cancel correctly reverting it; save-into-drawing on a successful Place
Trade; zero toolbar/pill overlap for both Long and Short; the discoverability hint
appearing/disappearing with drawing count. `php -l` and `node --check` clean on every
changed file.

### v3.22.3: Live Trade Display (Part C) + Fixes From Live Testing

**Renumbering:** Part C of the original v3.22.1 briefing (the running-trade chart
display) is now **v3.22.3**, not v3.22.3-later-in-sequence as earlier planned — moved
forward because the trader literally can't backtest without it (placing a trade and
having every line vanish makes the tool unusable, not just rough). The risk-ladder engine
moves to **v3.22.4**.

This release is two things at once: Part C itself (new scope, finally built), and six
fixes (A–F) from the trader's own first real session on v3.22.2, several of which turned
out to be more interesting than they first looked.

#### Part C — the running trade display

**Pending limit order** (from submit until fill or cancel): full-width orange dashed
`Limit {price}`, red dashed `Stop Loss −${risk}`, green dashed `Take Profit +${reward}`,
each with a pill — same visual language the order ticket's own lines already used
(v3.22.1 Part B3), just drawn from a different data source (see "mandatory" below). A
real DOM "✕" button (`#bt-pending-cancel-buttons`, `btSyncPendingCancelButtons()`) sits
over the Limit pill, positioned every redraw — same "real DOM over hand-rolled canvas
hit-testing" convention the floating selection toolbar established in v3.22.1 Part B1.
Clicking it calls the existing `cancelBtOrder()`. Not draggable once submitted — modifying
a resting order is explicitly out of scope.

**Open position** (from fill until close): solid blue `Entry {fill price}`, red dashed
SL, green dashed TP, each with its own $ pill; a position box from the fill bar to the
current replay cursor (red for SL↔entry, teal for entry↔TP), redrawn every advance since
its right edge always tracks "now"; a centre pill, `Open P&L: {±$} ({±R}) · Qty {size}`,
net of the entry fee already paid (`floating_pnl`, never re-derived — the exact figure
`computeSessionState()` already produces for the header/Open Positions panel), red below
zero, teal otherwise.

**Hiding the linked drawing:** `backtest_drawings.linked_trade_id`/`linked_order_id`
(new, migration `2026_10_01_0002`, both nullable, both `ON DELETE SET NULL` so deleting
the trade/order a drawing produced never cascades into deleting the annotation itself) —
set once, in the Place Trade path (`js/backtest.js::btSubmitTicket()` →
`btLinkDrawingToOrder()`, `js/backtest-drawings.js`), never cleared back to null. A
linked drawing's own box/pills are never rendered (`btRenderDrawings()`'s main loop) and
never hit-testable (`btHitTest()`) again — superseded permanently by the running trade
display, not just hidden while the order/position is active. A limit order that later
fills flips its drawing from `linked_order_id` to `linked_trade_id`
(`btAdvance()`'s own `limit_filled` event handler, which now carries the pending order's
own id specifically for this lookup).

**Mandatory, verified by construction:** every one of these lines is drawn from
`btSession.open_positions`/`btSession.pending_orders` (`btDrawLiveTrades()`,
`js/backtest-drawings.js`), **never from `btTicket`** — called unconditionally on every
`btRenderDrawings()` pass, unlike `btDrawTicketLines()` (which only draws while a ticket
is open). This is the literal fix for "after Place Trade, every line disappears": the
old ticket-lines-only rendering had nothing to show once the ticket closed. Because the
source is session state, not ticket state, the lines correctly reappear after a page
reload/session reopen (`refreshBtSession()`), after Next Bar/Play (`btAdvance()`), and
after a rewind (`btRewind()`) with no special-case code for any of the three — all three
now also carry `pending_orders`/`closed_trades` alongside `open_positions`, which they
didn't fully before this release (see Fix D below).

**On close:** lines are removed automatically (the position/order no longer appears in
session state). A faint, permanent marker is left instead
(`btDrawClosedTradeMarkers()`, reading a new `btSession.closed_trades` field, server-side
`BacktestController::getRecentClosedTrades()`, capped at 50 most recent, excluding
rewound rows): a small triangle at the entry bar, another at the exit bar, and a pill —
`+3.00R TP` / `−1.00R SL` / `{R} Manual`. A toast fires on the same event:
`Trade closed: {+/−$} ({R})` (`btAdvance()`'s own `stop_loss`/`take_profit` event
branch, using `net_pnl`/`r_multiple` `settleTrade()` itself just computed — not a
client-side re-derivation). This marker rendering is **only as correct as its
`time_out`**, which is exactly what Fix E below repairs.

**Header strip** (`.tv-chart-wrap`'s own controls bar, always visible on the replay
screen, not just the sidebar's Challenge panel): `Equity $x` / `Target {progress}% /
{target}%` / `Loss {max_dd_used}% / {max_drawdown_pct}%`, all three straight off
`sessionSummary()`'s own fields (`renderBtHeaderStrip()`) — never a second computation.

**Rewind:** no special-case code needed — `open_positions`/`pending_orders`/
`closed_trades` are recomputed fresh from the trades table on every `getSession()`/
`advance()`/`rewind()` call, the same "derive, don't store" rule this whole controller
already lives by, so a rewound session's response is automatically correct and the
running trade display just reflects whatever comes back.

#### Fix A — panel text colour

Every text node in the Open Positions and Pending Orders rows now has an explicit
dark-theme colour (`#d1d4dc` primary, `#8b93a7` muted) instead of relying on inherited
colour from a parent class/style. The live report: the Pending Orders row showed only
its "Cancel" button, because its own `<span>` had no colour at all and fell through to
this (light-themed, by default) app's own body text colour against the dark sidebar
panel.

#### Fix D (re-opened) — the real story, found in two layers

The briefing asked to investigate first and wait for live data before fixing. The
trader's own paste (session 6, trades 132/134, pending order #4) confirmed the hypothesis
exactly: `−$6.83 = −(3.4137 + 3.4149)`, the two positions' entry fees with nothing else —
proof `computeSessionState()` was marking each open position to its OWN entry price
(zero gross P&L) instead of the current bar's close. Root cause:

1. **`getSession()` never passed a `$markBar`** to `computeSessionState()`, so every
   open position priced itself at entry (`$mark = $markBar ? ... : $t['entry_price']`)
   — fixed by passing `$this->currentBar($session)`.
2. **`currentBar()` hardcoded `timeframe='15m'`** for the fill/mark/close price,
   regardless of what resolution the cursor had actually last moved at
   (`cursor_step_tf`) — this is *also* why the live fill price (7140) matched neither
   the ticket's displayed entry (7166, the last 1H close) nor anything the trader
   actually saw: the market order filled against the exact-cursor **15-minute**
   sub-candle's close, not the 1-hour bar the chart/ticket were both showing. Fixed by
   querying `cursor_step_tf` instead of a hardcoded finer resolution — now the fill
   price and the ticket's own "entry = current close" preview can never disagree, so no
   "Fills at next bar open (est. X)" label was needed; the mismatch is gone at the root,
   not just relabelled.
3. **`advance()`'s own "no more bars to replay" branch omitted `open_positions`/
   `pending_orders` from its response entirely.** `renderBtOpenPositions(res.open_positions
   || [])` on the client treats a missing key exactly like an empty list — once replay
   reached the end of available history (every subsequent Next Bar/Play tick after that
   hits this branch), the Open Positions panel was silently wiped even though the
   session's own two open longs were still open. This is the live report's literal
   symptom reproduced exactly: equity's own floating figure stayed correct (computed
   inside the `session` object this same branch DID return), while the separate
   `open_positions` key the panel reads from was simply absent.
4. **A fourth, previously-unknown layer, found only by the browser harness itself, not
   by inspection:** `js/calculator.js` *also* declares a global function named
   `renderOpenPositions(positions)` — the Auto Risk Calculator's own open-margin-
   positions list (v3.17.1 §3), writing into a completely different element
   (`#calc-open-positions`). Both files load as plain global `<script>` tags in the same
   scope, and `calculator.js` loads *after* `js/backtest.js` in `index.php`'s own module
   list — a later plain `function` declaration of the same name in the same global scope
   silently **replaces** an earlier one, no error, no warning. Every call to
   `renderOpenPositions()` anywhere in the app — including all three of this file's own
   call sites — was actually running `calculator.js`'s version the entire time, which
   never touched `#bt-open-positions` at all. That left the panel's own static "None"
   markup (`pages/backtest.php`) on screen *regardless of what the server returned*,
   compounding (and quite possibly dominating) issues #1–3 above. Fixed by renaming this
   file's own function to `renderBtOpenPositions()` — every other render function in
   this file already carried a `renderBt*` prefix; this one, alone, didn't, which is
   exactly how it collided. `calculator.js` is untouched — it has every right to its own
   name for its own unrelated feature.

With all four fixed, `open_positions` and `floating_pnl` were *already* guaranteed to
agree (both built in one pass over the same `$openRows` query in
`computeSessionState()` — there was never a second, divergent row set, only a wrong mark
price and, separately, a client-side rendering collision that had nothing to do with
which rows were included).

#### Fix B — price rounding

Every user-entered price is now rounded to a believable number of decimals (`>=100` →
2dp, `>=1` → 4dp, else 6dp — the exact bucketing `fmtPrice5()` already used for display
text, now also applied as a real number via a new `btRoundPrice()`/`backtestRoundPrice()`
pair) before it's shown in a ticket input, used in a pill, or submitted — not a per-
symbol tick size (this app tracks none), same "don't invent precision this app can't
back up" reasoning already applied to `fee_rate_pct`/liquidation elsewhere in this file.
Applied server-side too (`placeOrder()`), defensively, so an older/unpatched client (or
any other caller) can't store a raw 15-decimal price regardless of what the UI sends.
`btTicket.stopLoss`/`.takeProfit`/`.entry` themselves are never rounded — only a
rendered input's `value` and the final submitted payload are, so RR/sizing math upstream
still runs against full precision.

#### Fix C — trade cap shown up front

The sidebar's **New Trade** button is fully disabled at the cap, its own label replaced
with `Daily cap reached (2/2): advance to the next day.` The toolbar's **Place trade**
stays clickable — "the ticket can still open from a position tool for planning" is an
explicit carve-out in the briefing — getting only a tooltip explaining why submission
will still be blocked. The ticket itself shows the cap reason as its own banner at the
**top** of the ticket body (not mixed in with every other blocking reason at the
bottom), and the cap check now runs *first* in `btComputeTicket()`'s own blockReason
chain — a trader already at the cap finds out before building anything, not after.

#### Fix F — double submit

Two identical market orders went in on the same bar because nothing on screen confirmed
the first one had already gone through. **Place Trade is now disabled for the whole
round trip** (re-enabled only on an error — success closes the ticket outright). On
success: `Long 0.87 BTC filled @ 7140` / `Limit order placed @ x`
(`fillPosition()`/`evaluateBar()` now return/carry `lot_size` specifically for this).
**Server-side**, the actual enforcement: a second order with identical direction,
stop-loss, take-profit, and session, placed within 5 wall-clock seconds
(`created_at`), is rejected outright with "Duplicate order ignored." — the client-side
disable is only the first line of defence, same standing practice this controller
already applies to margin/liquidation.

#### Fix E (critical) — wall-clock `time_out`

`settleTrade()` wrote `gmdate('Y-m-d H:i:s')` — literally "now," 2026-09-30, for *every*
backtest trade ever closed — instead of the replay bar that actually closed it (2020-
era, for this account's own sessions). Consequence: `rewind()` reopens trades `WHERE
time_in <= cursor AND time_out > cursor` — with every closed trade's `time_out` stuck in
2026, **any rewind reopened the trader's entire closed-trade history** opened before the
new cursor, not just the ones actually closed after it. Fixed two ways:

1. `settleTrade()` now takes the exit bar's own time as an explicit parameter (and
   returns `[net_pnl, r_multiple]`, used by Fix F's toast and Part C's marker) — the
   touching bar for an SL/TP fill (`evaluateBar()`), the current cursor's bar for a
   manual close (`closePosition()`), the failing bar for a forced close
   (`failSession()`). All three call sites updated.
2. **Data-repair migration** (`2026_10_01_0001`) for existing rows (`source='backtest'
   AND time_out > NOW() - INTERVAL 1 YEAR`): sets `time_out` to the earliest candle, at
   the trade's own session's `replay_timeframe`, on/after `time_in` whose `[low,high]`
   range actually contains the recorded `exit_price`. Falls back to `time_in` itself when
   no such candle is found. Logged to a new permanent `backtest_exit_time_repairs_log`
   table (trade id, old/new `time_out`, timestamp) — not a `TEMPORARY` one, since the
   whole point is a durable record of exactly what changed, same "never silently discard
   a fact" reasoning behind `backtest_rewound` existing as a flag instead of a `DELETE`
   in the first place.

   **Repair-logic correction (found on live, v3.22.4):** this migration's own match
   condition (`c.low <= exit_price AND c.high >= exit_price` — a plain RANGE check, "is
   exit_price anywhere between this candle's low and high") is **not** the same rule
   `backtestCheckSlTp()` actually uses live, despite this section originally claiming
   so. The real engine triggers **directionally**: a Long's stop-loss is hit by
   `low <= stop` (only the low matters), its take-profit by `high >= target` (only the
   high matters) — mirrored for a Short (`high >= stop`, `low <= target`). A plain range
   check is a strictly WEAKER condition that a candle can satisfy without ever actually
   triggering either exit in the direction that matters — e.g. a candle whose low sits
   below a Long's stop-loss price purely by coincidence, with the close back above it and
   nothing about this candle being the real touch, still passes `low <= exit <= high` and
   gets selected as "the" repair candle. **Trade #126 was repaired to the wrong candle by
   this migration and was corrected by hand on live** (to 2020-03-27 17:00) after the
   discrepancy was found. Because migration files are checksum-locked once applied
   (§3A), `2026_10_01_0001` itself is not edited — this note exists so it's never copied
   as a working example. **Any future repair of this shape must match directionally**,
   not by range: for a trade whose `exit_reason` is known, test only the side that
   reason implies (`'Stop Loss'` → the stop's own low/high rule above; `'Take Profit'` →
   the target's own rule); for a manual close, fall back to the plain range check only
   as a last resort, since a manual close has no "which side touched" fact to test
   directionally at all.

   **Audited on live, 2026-10-02 (v3.22.4):** every row `2026_10_01_0001` actually
   touched was re-checked against the directional rule above. Only three rows matched
   the migration's own scope at all — **#126, #130, #131**. #130 and #131 give the
   *same* repaired `time_out` under the directional rule as the original range-based
   one, because price moved continuously through the exit level on the candle the range
   check happened to pick — there was no ambiguous/coincidental low-or-high in either
   case for the range check to have gotten wrong. **#126 is the only one that actually
   differed**, already corrected by hand (above) before this audit confirmed it was the
   only one. Nothing else is outstanding — `backtest_exit_time_repairs_log` is trusted
   as-is for this account; no follow-up repair migration is needed.

#### `tools/ui-harness/` — extended, not rebuilt

**Now stateful** for three new session ids (20/21/22 — session 6 and v3.22.2's own
`drive.mjs` are completely untouched, still running against the original inert mock):
`backtest_advance`/`backtest_rewind`/`backtest_place_order`/`backtest_cancel_order`/
`backtest_close_position` all read and mutate a small JSON state file written inside the
harness's own temp copy of `app/` (fresh every run). Candle generation switched, for
these sessions only, from the legacy mock's per-request random walk (which reseeded on
every single call and could describe the same bar differently depending on what window
asked for it — fine when nothing needed two requests to agree, not fine once `advance()`
and `get_backtest_candles()` both have to describe the identical bar) to a smooth,
deterministic, O(1) sine composite (`mockPriceAtIndex()`) — any bar's price is a pure
function of its own absolute index, inspectable via `php stubs/api.php <from> <to>` to
hand-pick SL/TP values a specific future bar is guaranteed to touch, rather than guessed.
A real history floor was added (`-500` bars) so `js/chart.js::loadOlderCandles()` can
actually exhaust and stop paging — the legacy mock's infinite-both-directions candle
supply, combined with this release's own "load more, schedule a redraw" pattern, was
enough to keep a `.bt-pending-cancel-btn` click target perpetually rebuilding under
Playwright for 30 seconds before this fix.

New driver `drive-v3223.mjs` (21 assertions, all passing): the acceptance criterion
exactly (open a pre-seeded session, two open longs + one pending order show their lines
immediately, no action needed); Fix A's panel colours; Fix B's rounded ticket input;
Fix C's cap banner/button states, both sidebar and ticket; and the full Verify 1–4 flow
end to end against the real client code — place a Limit order, see its lines, cancel it
via the real "✕" button; place a Market order, see Entry/SL/TP lines + box + a live
Open P&L pill that updates across Next Bar; advance until the pre-computed TP bar hits,
see the lines clear and a `+0.47R TP` marker plus a `Trade closed: $36.71 (+0.47R)`
toast; rewind past the close and see the position come back. `php -l`, `node --check`,
and `backtest_engine.php`'s self-test (48 assertions, 4 new for `backtestRoundPrice()`)
all clean.

#### Pre-release audit: a duplicate-name scan across all of `app/js/`

Before releasing, asked explicitly: list every function/global variable declared at the
top level in more than one `app/js/*.js` file, the same bug shape as Fix D's own
`renderOpenPositions()` collision — every one of these 18 files is a plain, non-module
`<script>` tag sharing ONE global scope on every page (`index.php`'s own module list
loads all of them unconditionally; this is a single-page app, not per-page bundles), so
two same-named top-level declarations is never two independent things that happen to
share a name — it's the LAST `<script>` tag's version silently replacing the first, no
error, no warning.

New `tools/ui-harness/scan-duplicate-names.mjs`: parses every file with a real AST
(`acorn`, not a regex guess) and walks only each `Program`'s top-level body — a name
declared inside a function/block/IIFE never touches the shared scope and isn't flagged.
Found exactly one more: **`escapeHtml(s)`**, independently declared in both
`js/backtest.js` (a DOM `textContent`→`innerHTML` trick, which doesn't reliably escape
quotes) and `js/report-card.js` (an explicit `&<>"'` regex replace — the more complete of
the two). `report-card.js` loads after `backtest.js`, so its version was the only one
ever actually running for *either* file's own call sites — `backtest.js`'s own
implementation had never executed in this app's history. Fixed the same way as
`renderOpenPositions()`/`renderBtOpenPositions()`, just "merge to one copy" instead of
"rename," since this really is the same utility twice, not two different things that
happened to collide: moved the more complete implementation to `js/app.js` (this file's
existing home for shared helpers — `fmt()`, `toast()`, `pnlCls()`), removed from both old
homes. The scan now runs as the **first** assertion in both harness drivers
(`drive.mjs`, `drive-v3223.mjs`) — a future collision anywhere in `app/js/` fails loudly
before the browser even launches, not by accident during an unrelated test months later.

**A second real bug found while re-verifying after the `escapeHtml` fix, not by
inspection:** `js/app.js::toast()` never cancelled its own previous hide timer —
`tools/ui-harness/drive-v3223.mjs`'s own Verify 3 (toast after a TP close) started
failing intermittently, roughly one run in three. Root cause: two toasts shown within
2.8 seconds of each other (e.g. an order-placed toast quickly followed by a trade-closed
toast across a couple of Next Bar clicks) raced their own `setTimeout`s — the first
toast's hide timer was never cleared, so it could fire *after* a second toast had already
reset `className` to `show`, hiding the second toast's message early at an unpredictable
point in its own lifetime instead of after it. This is a real bug on live too, not just
in the harness — any two real toasts fired close together have always been able to clip
each other this way. Fixed with one `let toastTimer` + a `clearTimeout()` before arming a
new one, so only the most recent toast's own hide is ever pending.

**Known boundary, stated plainly:** the harness's `mockRewind()` is a deliberately
simplified one-step undo (sufficient to verify the *client* renders a rewind correctly,
which is this harness's actual job) — it does not re-implement
`BacktestController::rewind()`'s own multi-step, multi-case undo logic, and the "rewind
to after its exit, it stays closed" half of Fix E's own acceptance criterion is verified
by code review of the real `rewind()`/`settleTrade()` fix, not by this harness (same "no
DB in this environment" limitation that applies throughout this project's history).

### v3.22.4: Marketable-Limit Fill Bug (Found on Live)

**Renumbering:** the risk-ladder engine, previously slated as v3.22.4, is now
**v3.22.5**. No schema change this release — `db_migrations` empty, deploy is Update Now
+ a hard refresh, nothing else.

Confirmed on live: a resting limit order that becomes **marketable** (price moves
through it before it's ever touched normally) filled at its own stale limit price
instead of at the market. Trade #126 / order #1, session 6, BTCUSDT 1H: a Long limit at
6902.39 sat pending while the market was well below it; the 2020-03-27 16:00–17:00 bar
traded 6591.5–6666 — `evaluateBar()`'s own touch check (`low <= limit_price`) is `true`
the instant price rises through the limit from below, regardless of how far below the
limit the bar's own range actually was, and `fillPosition()` filled at the limit
verbatim (6902.39) rather than anywhere near where the market actually traded.

**Fix 1 — rejected at placement.** `placeOrder()`: a Long limit at or above the current
close, or a Short at or below it, is rejected outright — `"A Long limit above the market
fills immediately. Use Market."` (mirrored for Short). Mirrored exactly in
`btComputeTicket()`'s own blockReason chain, so the ticket shows the same reason and
disables Place Trade before the trader ever submits. Wiring this client-side mirror
surfaced a real UX regression before release: switching the ticket's own Market→Limit
toggle left `entry` sitting exactly at the current close (wherever it already was while
Market) — which is *always* "marketable" by the new `>=`/`<=` rule, meaning the
rejection would have shown on every single Market→Limit switch, not just when the
trader actually dragged the limit through the market. Fixed at the root: the toggle now
offsets the limit a small distance to the correct side of the market when switching to
Limit (same 0.05% threshold `btOpenTicket()`'s own Market/Limit auto-detect already
uses for "near the market"), rather than loosening the new validation.

**Fix 2 — engine safety net, `backtestLimitFillPrice()`.** This placement-time check
can't catch every case: an order that was genuinely below the market when placed can
still have the market gap straight through it (and the limit) before the next bar even
opens. For that case, the fill price is now whichever is BETTER for the trader of the
limit or the bar's own open — `min(limit, open)` for a Long, `max(limit, open)` for a
Short — matching how a real exchange fills a marketable order at the best available
price, not a stale number. 4 new self-test cases (marketable and not, both directions).

**Fix 3 — fill-and-stop on the same bar, `backtestCheckSameBarFillTouch()`.** A position
that fills mid-bar (via the safety net above) didn't exist for that bar's entire
duration, so naively reusing `backtestCheckSlTp()`'s full-bar-range check against it can
close a trade against a level it was never actually exposed to before it opened.
**Revised once before release** after a self-review caught a serious flaw in the first
version: a stop that ends up on the WRONG SIDE of a gap-driven fill (stop no longer
below entry for a Long — e.g. limit 100 / stop 95, fills at 90 after a gap) was simply
left unchecked for that bar, deferred to normal evaluation later. That's wrong, not
just incomplete: left alone, the next bar's low reaching the now-meaningless 95 "hits
the stop" there, recording a **+5 gain** with `exit_reason='Stop Loss'` — turning a
stop-loss into a profit purely because nothing ever re-examined whether the stored stop
price still meant anything once the trade actually opened on the wrong side of it.
**Corrected rule:** a wrong-side stop is not deferred — it triggers *immediately*, on
the fill bar, **at the fill price itself** (not the stale stop price, which has no
directional meaning to exit at): `exit_reason='Stop Loss'`, R approximately 0 before
fees, never carried to a later bar. A target on the wrong side of a gap-driven fill is
*not* force-closed the same way — there's no "already breached" fact for a target the
way there is for a stop, so a trade just continues normally toward it. The function's
own return shape changed from a plain reason string to `[reason, exitPrice]` specifically
so the wrong-side-stop case can report an exit price that's neither the stored stop nor
target. 8 self-test cases, including the exact caught-before-release scenario by its own
numbers. **`backtest_engine.php`'s self-test: 60 assertions, all passing.**

**Harness:** one new browser assertion (`drive-v3223.mjs`) — the ticket shows the exact
marketable-limit rejection text and disables Place Trade, driven via
`btTicketSetField('entry', ...)` directly (the ticket has no plain number input for a
limit price; this exercises the same blockReason computation a real drag would). The
engine-level fill-price and same-bar-touch rules are PHP self-test coverage, not browser
coverage — there's no UI surface for "fill price computation" in isolation to drive
through a page.

### v3.22.5: In-Trade View and Position-Tool Handling — Six Fixes From a Real Session

**Renumbering:** the risk-ladder engine, previously slated as v3.22.5, is now **v3.22.6**.
Session 6, 2 Oct 2026 — the trader's first real session actually placing and holding
trades since v3.22.4 — surfaced six separate problems at once, all fixed in this release.

#### Fix A — the price-range stabilizer never looked at trade levels

**Symptom:** a Long's TP, set well above the recently-loaded candles' own range, had no
line at all once the trade was open — "disappears once in a trade." Confirmed two
separate, compounding causes, not one:

1. **`btInstallPriceRangeStabilizer()`'s stored range (v3.20.10) only ever unioned in the
   loaded CANDLES' own prices** — never the open positions/pending orders/open ticket
   actually drawn on the same chart. A TP set far outside the candle window's own natural
   range scrolled off-screen the instant the trade opened, regardless of how far the
   trader had or hadn't manually zoomed.
2. **An open position's own Take Profit never had a full-width LINE drawn at all** —
   confirmed by reading `btDrawLiveTrades()` against its own pending-orders block just
   above, which already draws all three lines (Limit/Stop/TP); the open-positions block
   only ever called `btPriceToY()` for TP (box-fill math) and a pill, never
   `btDrawFullWidthLine()`. This is the direct, proximate cause of "TP line disappears" —
   even on-screen, no line was ever there once a position actually opened.

**Fix, three parts:**
- **`btCollectTradeLevels()`** (new, `js/backtest.js`) returns every open position's and
  pending order's own entry/stop/take-profit, plus the open ticket's own (via
  `btTicketEffectiveEntry()`), as a flat array. `btInstallPriceRangeStabilizer()`'s
  provider now unions these into the stored range — each with its own ~3% padding,
  applied only when a level actually falls outside the candle-derived range — alongside
  the existing 8% candle padding, unchanged for the candle-only case. Still strictly
  widen-only: a level (like the candle range before it) can only ever push
  `btPriceRangeState`'s min/max further out, never pull it back in.
- **A real, independent bug found while testing this fix**, not specified by the
  briefing: Lightweight Charts only re-invokes a series' own `autoscaleInfoProvider` when
  it decides the price scale needs recomputing — a data change, a visible-range change,
  or a resize. Placing a trade or opening a ticket changes none of those, so the stored
  range stayed locked at whatever it was computed from *before* the trade existed until
  some unrelated later redraw happened to trigger one. `btRenderDrawings()`
  (`js/backtest-drawings.js`) now calls `tvCandleSeries.priceScale().applyOptions({
  autoScale: true })` on every render pass — forcing a recompute every time this file's
  own redraw already runs, which is what makes a newly-opened trade's levels appear
  immediately instead of on the next unrelated chart interaction. Confirmed empirically
  via this release's own harness: without this nudge, a far TP stayed off-screen
  immediately after a fill.
- **The missing TP line for open positions** is fixed by routing it through
  `btDrawFullWidthLine()` like Entry/Stop already do, matching the pending-orders block.

**Safety net — "if a level still ends up off-screen (user zoomed tight), pin its pill to
the top/bottom edge."** `btDrawLevelPill()` (new) draws a level's normal pill when its own
y falls inside `[20, h-20]`; outside that margin, it instead pins a pill reading
`{▲/▼} {name} {price} {amount}` (e.g. `▲ Take Profit 7790.00 +$286.19`, per the briefing's
own example — the normal on-screen Stop/TP pills never show their own price, only the
dollar amount, so the pinned version adds it back since the line itself can't be seen to
read it off) to the clamped edge, and registers a click target in `btEdgePinnedPills`.
`btSyncEdgePinnedButtons()` turns these into real, transparent DOM buttons positioned over
each pinned pill (`#bt-edge-pinned-buttons`, `pages/backtest.php`) — same "real DOM over
hand-rolled canvas hit-testing" convention `btSyncPendingCancelButtons()` already
established. Clicking one calls `btFitPriceAxisToLevel()`, which simply re-enables
`autoScale: true` — sufficient on its own, since the stabilizer's stored range already
includes every level registered here; the only reason one is ever off-screen is a
user-driven manual zoom/drag of the price axis away from auto-scale.

**A second, real bug found building this fix's own harness coverage, not specified by the
briefing:** `btOpenTicket()`'s own `stopLoss: init.stopLoss || 0` leaves a freshly-opened
ticket's stop at the placeholder `0` until the trader types a real one. `btCollectTradeLevels()`
unconditionally including `btTicket.stopLoss` meant simply *opening* a ticket — before
ever typing a stop — unioned in a level of `0`, permanently widening the stored range to
include it (widen-only, so this could never un-happen for the rest of the session) the
moment any render fired in between. Fixed by skipping `btTicket.stopLoss` when it's falsy
(`0`), the same "not yet set" treatment `takeProfit`'s own `!== null` check already uses.

**Candle levels still call `btResetPriceRangeStabilizer()`** on a fresh session open/
resume and a display-timeframe switch, unchanged from v3.20.10; this release adds two
more call sites, both "a trade closed" — `btAdvance()`'s own stop-loss/take-profit event
branch, and `closeBtPosition()` — per the briefing's own instruction, so a closed trade's
levels don't keep padding the range forever once they're no longer relevant.

#### Fix B — no position box while in a trade

Root cause: the box-fill rectangle (`btDrawLiveTrades()`) requires `yEntry`/`yStop` to be
non-null, which Fix A's range extension now guarantees for a level still within the
stabilizer's union — the live screenshot showing no box at all was the same off-screen
symptom as Fix A's TP line, not a second, separate bug. Verified directly rather than by
screenshot alone, per the briefing's own explicit instruction: a new harness assertion
(`drive-v3225.mjs`) reads the fill-bar-to-cursor box's own pixel data off
`#bt-draw-overlay` via `getImageData()` at a point between the entry/stop lines, asserting
the real drawn RGBA (`rgba(239,83,80,0.18)`) is present — then advances a bar and confirms
the box's own on-screen width (not `xNow` alone, which the replay window's own fixed-width
design keeps pinned at a constant screen position every step — it's the fill bar's `xFill`
that moves left as the window shifts underneath it) grew and the pixel is still present.

#### Fix C — Open P&L pill could show a positive/zero-signed R against a negative dollar amount

Confirmed on live: `-$3.42 (+0.00R)` — a negative dollar figure next to a positive-looking
R. Root cause: the R formula was gross, price-only (`(mark-entry)/(entry-SL)`), which can
disagree in *sign* with the net (fee-inclusive) dollar P&L specifically near breakeven,
once fees eat a small favourable gross price move into a net loss. Confirmed not a
rounding artifact (`(-0.003).toFixed(2)` is `"-0.00"`, not `"0.00"` — a negative sign
survives `toFixed` all the way down). Fixed by deriving R from the same net figures
(`p.floating_pnl / riskUsd`) the Stop Loss pill in the same function already computes —
sign-consistent with the displayed dollar figure by construction, not just for this one
reported case. The sign prefix is now three explicit branches (positive/negative/exactly
zero), replacing the old `>= 0 ? '+' : ''` that silently treated a positive-or-zero gross R
the same way. Verified in this release's own harness against a scenario engineered from
the deterministic mock price curve (a small *positive* gross move whose entry fee still
makes the net loss) — the rendered pill text is asserted to never contain `+0.00R` and to
show the minus sign whenever `floating_pnl < 0`.

#### Fix D — the live challenge's STOP banner showed on the backtest screen

Confirmed on live: the topbar's "+ Trade" button showed `STOP — weekly trade limit reached
(4/4)` while a backtest session was open — the *live* challenge's own gate
(`refreshNewTradeGate()`, `js/trades.js`), which has nothing to do with the backtest
session's own limits and just confused the trader. `window._riskStopReason` itself is left
accurate (still the real guard `openTradeModal()`/`openChecklist()` check for an actual
live-challenge save) — only the always-visible topbar button's own label/disabled styling
is suppressed while `body.backtest-active` is set; `showBacktestScreen()` re-runs
`refreshNewTradeGate()` on every screen transition so this doesn't wait for an unrelated
refresh to catch up. In its place, the header strip (`#bt-strip-trades`,
`renderBtHeaderStrip()`) gains a fourth figure — this session's own
`trades_today`/`max_trades_per_day` from `sessionSummary()` — the only trade-limit figure
shown on the backtest screen. Every other page is completely unaffected; verified in the
harness by patching `get_risk_status` to report `stopped: true` and checking the topbar
button's text both on the backtest screen (no STOP) and after leaving it (STOP, as before).

#### Fix E — position-tool drag was jumpy, and dragged with magnet off should follow the cursor exactly

Two separate performance/behaviour problems in the same drag pipeline, both confirmed by
reading the code before fixing anything:

1. `btMousePos()` called `getBoundingClientRect()` on every single mousemove event — a
   real layout read inside the hottest loop in this file.
2. `btPixelToPoint()` called `btSnapTimeToCandle()` **unconditionally, regardless of the
   magnet toggle** (unlike `btSnapPrice()`, which already checked it), and `btSnapPrice()`
   itself does an O(n) linear scan over every loaded candle — both running on *every*
   native mousemove event, not once per rendered frame. Magnet was on in the trader's own
   screenshots; unconditional time-snapping plus magnet-on price-snapping's own per-event
   candle scan is the likely cause of the reported jumpiness.

**Fix, per the briefing's own four requirements:**
- **Render from `requestAnimationFrame`, one redraw per frame.** `btOnDrawMouseMove()` no
  longer computes anything — it only records the latest `{clientX, clientY}` and schedules
  (at most) one `requestAnimationFrame` callback (`btScheduleMoveFrame()`). However many
  native mousemove events fire before the next frame, `btProcessPendingMove()` reads only
  the latest one, coalescing all of them into exactly one state update and one render —
  distinct from the pre-existing `btScheduleRedraw()`/`btDrawRaf`, which only ever
  throttled the *render*, not the *state computation* feeding it.
- **No layout reads beyond one cached read at drag start.** `btDragRect` is captured once,
  in `btOnDrawMouseDown()`, at the exact moment every gesture starts (regardless of
  whether it becomes a drag), and `btMousePos()` prefers it over a fresh query. Cleared by
  `btEndDrag()` at the end of every gesture.
- **Continuous while dragging; snap only on release, only when magnet is on.**
  `btPixelToPointContinuous()` (new) skips both `btSnapTimeToCandle()` and
  `btSnapPrice()` entirely — used by the move loop and, for a position tool specifically,
  by the creation-drag preview and finalize too. At release
  (`btOnDrawMouseUp()`), a position tool's own point is `btPixelToPoint()` (full snap)
  when magnet is on, or stays continuous when it's off. Every *other* tool (fib/
  trend-line/horizontal) is untouched — still always-snapped during its own move loop and
  at release, exactly as before; this release was not asked to change their feel.
- **Target: no long task over 16ms dragging across 50 bars.** Verified directly via the
  `PerformanceObserver` Long Tasks API in this release's own harness — a real,
  60-discrete-mousemove-event drag across 50 bars' worth of pixels records zero entries
  over 16ms.

**A real bug caught building this fix, not shipped:** `btOnDrawMouseDown()`'s own
cursor-mode handler computed `dragState.startPoint` via the old, always-snapped
`btPixelToPoint()` even for a position tool, while the move loop now computes `newPoint`
via the continuous variant — mixing a *snapped* baseline with *continuous* in-flight
points injected a phantom offset equal to whatever the snap moved the baseline by, visible
even on a drag that never actually changed the cursor's own price at all. Caught by the
harness's own exact-value comparison (a mid-drag entry that should have equalled the raw
continuous conversion came back wildly different), not by inspection. Fixed by using
`btPixelToPointContinuous()` for `startPoint` too, whenever the hit drawing is a position
tool — matching the move loop's own choice exactly.

#### Fix F — position tool had no way to resize its own width

New: two edge handles, vertical centre of the box's own left/right edges, shown only while
selected (so an edge isn't accidentally grabbed instead of a different drawing, or the
box's own "move" zone, while just clicking around). Hit-tested in `btHitTestOne()` *before*
the `x < left || x > right` bounds check — the handle itself sits exactly on the edge,
which that check would otherwise exclude. Dragging the left handle moves only
`points[0].time`; the right handle, only `points[1].time` — `points[0]` is always the
box's own earlier/left time by construction (`btFinalizeNewDrawing()` never creates the
reverse), so there's no need to re-derive which point is visually left. Minimum width 3
bars, enforced by clamping the dragged time against the *other*, fixed edge's own time
(`btStepSec() * 3`); prices are never touched by either handle. Cursor becomes
`ew-resize` on hover (`btUpdateHoverCursor()`, new — a plain hit-test against the
currently-selected drawing only, run on a mousemove when no drag is in progress, not part
of Fix E's own hot-path concerns). New drawings keep the existing default width
(`BT_POSITION_TOOL_SPAN_BARS`, 20 bars) unless the trader drags horizontally more than 3
bars while first drawing the box, in which case that dragged width is used instead
(`btPositionCreationSpanMs()`, new, shared by the creation finalize step and its own live
preview so the preview can never show a width different from what mouseup actually saves)
— the floor at 3 bars means the near-zero-width-box defect `BT_POSITION_TOOL_SPAN_BARS`
was originally introduced to prevent (v3.21.2) is still exactly as impossible as before.
Width is saved in `points` exactly as it already was — no schema change.

#### `tools/ui-harness/` — new driver, `drive-v3225.mjs`

A new driver file, not an extension of `drive-v3223.mjs` (left completely untouched, same
as `drive.mjs`/session 6 before it) — reuses the same stateful mock sessions
(20/21/22, `stubs/api.php`) end to end on session 20 so one open position carries through
Fixes A/B/C/E/F without re-placing a trade for each. Runs the briefing's own 7-item verify
checklist, with a before/after screenshot for every fix. Notable techniques, reusable for
future canvas-heavy releases: patching `CanvasRenderingContext2D.prototype.fillText` once,
globally, to capture every pill's drawn text (there is no DOM text node for a canvas-drawn
string to query a selector against) — used to assert the R-multiple's sign (Fix C) and the
pinned pill's exact `arrow + name + price + amount` format (Fix A); reading `getImageData()`
directly off `#bt-draw-overlay` to assert a fill colour is actually present, not just
visible in a screenshot (Fix B, the briefing's own explicit "a screenshot alone isn't
enough" instruction); the `PerformanceObserver` Long Tasks API for Fix E's own performance
target. A precise *numeric* comparison (Fix E's continuous-vs-snapped check) is driven
directly through `btApplyDrag()`/`btPixelToPointContinuous()` rather than a second
pixel-perfect mouse drag — a real synthetic drag's own few-millisecond round trip between
computing a target pixel and the event actually landing is enough jitter to occasionally
miss a handle by a pixel, which would test mouse-event timing, not Fix E's own logic; same
"drive the mechanism directly" choice already made for Fix A's own
`btDrawLevelPill()`/`btFitPriceAxisToLevel()`, and the one `drive-v3223.mjs` already makes
for the order ticket's own lines via `btTicketSetField()`.

**Not done in this release:** the actual "drag the price axis with a mouse to zoom in
tight" gesture from Fix A's own verify item 1 is left for a real browser click-through —
Lightweight Charts v4.1.3's price-axis drag-to-zoom is a real mouse gesture with no direct
public API to simulate deterministically, and the safety-net *mechanism* itself (pin +
click-to-fit) is fully verified directly, which is what this harness can actually test
without flakiness.

No PHP changed this release, no migration — `php -l`/`node --check` clean on every changed
file, duplicate-name scan clean, and `drive.mjs`/`drive-v3223.mjs` both still pass
unmodified.

### v3.22.6: Price-Axis Manual-Scale Regression (Bug 1) + Overlapping Same-Bar Markers (Bug 2)

**Renumbering:** the risk-ladder engine, previously slated as v3.22.6, is now **v3.22.7**.

#### Bug 1 — a regression from v3.22.5 itself

**Trader report, live:** dragging the right-hand price axis to expand or compress it did
nothing — the axis snapped straight back to auto every time.

**Root cause.** v3.22.5 Fix A's own nudge
(`tvCandleSeries.priceScale().applyOptions({autoScale:true})`) ran **unconditionally, on
every render pass** (`btRenderDrawings()`, `js/backtest-drawings.js`) — and a render pass
fires on every mousemove and every redraw, not just when a trade/order actually changes.
Dragging the axis turns `autoScale` off, exactly as Lightweight Charts intends; the very
next render pass forced it straight back on, so a manual scale could never survive even
one frame. The fix this release exists to close was real (a far TP needs to appear the
instant a trade opens) — the mechanism it shipped with was simply too blunt.

**Fix — a tracked signature, not an unconditional nudge.** `js/backtest.js::
btTradeLevelsSignatureParts()` builds a sorted, order-independent signature string from
every open position's and pending order's own id+entry+stop+take-profit, plus the open
ticket's own entry/stop/take-profit (the ticket has no stable id of its own — deliberately
excluded from the separate `ids` list used for the override rule below, since opening a
*ticket* is not an "opening" in the sense that rule means). `btMaybeNudgeAutoScale()`
(replacing the old unconditional call, still invoked once per render pass from
`btRenderDrawings()`) only re-applies `autoScale:true` when this signature actually
changed since the last pass — a trade opened/closed, an order placed/filled/cancelled, the
ticket opened/edited, or a level dragged — never on a plain redraw.

**Respecting a manual scale.** This codebase never sets `autoScale` to `false` anywhere —
the only two things that can are the trader dragging the axis, or Lightweight Charts
itself. Observing `false` is therefore always a real, user-driven manual scale, whether it
just started or is still in effect from an earlier drag; `btMaybeNudgeAutoScale()` sets
`btUserPriceScaleManual = true` the moment it sees this, and stops nudging from then on —
**except** a brand-new open position or pending order (detected by an id appearing that
wasn't in the previous signature) still forces one re-enable regardless, because "levels
always in view on entry" is the v3.22.5 requirement and a manual scale shouldn't be able to
hide a trade the moment it opens. Closing a trade, cancelling an order, or editing the
ticket while manual does **not** force an override — there's no new level that needs
forcing into view, so the trader's own zoom choice is left alone.

**Two ways back to auto, both explicit.** Double-clicking the axis is Lightweight Charts'
own native reset — confirmed the capture-phase listeners on `.tv-chart-wrap` don't swallow
it (see the listener hardening below); `btMaybeNudgeAutoScale()` recognizes the resulting
`autoScale:true` on the next pass and clears `btUserPriceScaleManual` to match reality. A
new bottom-right **"A"** toggle (`#bt-autoscale-toggle`, `pages/backtest.php`) does the same
thing on click (`js/backtest.js::btReenableAutoScale()` — the one function that flips the
option AND clears the manual flag together, also used by the v3.22.5 edge-pinned-pill
safety net, `btFitPriceAxisToLevel()`, so neither path can disagree about whether the scale
is still "manual" afterward) and is highlighted (`js/backtest-drawings.js::
btSyncAutoScaleToggleButton()`, every render pass) exactly while auto-scale is actually on.

**Listener hardening (checked, and a latent gap closed).** `btEventInPlotArea(x, y)`
(`js/backtest-drawings.js`) computes the plot area's own bounds from the chart's own APIs
(`tvChart.priceScale('right').width()`, `tvChart.timeScale().height()`) and is checked
first, before any hit-testing, in `btOnDrawMouseDown`/`btOnDrawDblClick`/
`btOnDrawContextMenu` — an event over either axis strip is never ours, full stop. This was
checked rather than assumed necessary, and it did find a real latent gap:
`horizontal_line`/`horizontal_ray`'s own hit-test is **deliberately x-unbounded** (the
whole point of a "ray"/"line" spanning the full chart width) — a mousedown or dblclick
landing on that drawing's own Y, anywhere along `.tv-chart-wrap`'s width, including
directly over the price axis, could have claimed the event and `stopPropagation()`'d it
before Lightweight Charts ever saw the gesture. Closed by construction now, not just for
the reported regression.

#### Bug 2 — overlapping same-bar closed-trade markers

**Symptom:** two trades closing on the same bar (the duplicate longs #132/#134, the same
pair already seen in v3.22.3/v3.22.5's own test fixtures) drew their `-1.00R SL`-style exit
pills at the identical spot — identical exit price, identical direction, so identical
natural position — and the second one's text rendered directly over the first's, reading
as a garbled "00R SL".

**Fix.** `btDrawClosedTradeMarkers()` (`js/backtest-drawings.js`) now groups
`btSession.closed_trades` by their exact `time_out` value before drawing anything —
`settleTrade()` stores `time_out` as the **closing bar's own time** (CLAUDE.md v3.22.3 Fix
E), so two trades genuinely closed on the same bar always share the identical value here,
and two trades on different bars can never collide into the same group from this key
alone. Within a group, exit pills are sorted by their natural vertical position and stacked
top-to-bottom, only pushing a lower one further down when it would otherwise overlap the
pill above it (never moves one upward, never touches a different bar's own group) — a
single trade closing on a bar renders pixel-identical to before this fix. The gap is a flat
4px, matching `btDrawPill()`'s own fixed single-line height (22px) exactly, so two stacked
pills always land exactly 26px apart.

#### Verification

New harness driver `tools/ui-harness/drive-v3226.mjs` (30 assertions, all passing) against
the existing stateful mock sessions (20 fresh, 21 pre-seeded with the real #132/#134
shape) — `drive.mjs`, `drive-v3223.mjs` and `drive-v3225.mjs` are all untouched and still
pass. Closes the one gap v3.22.5's own harness explicitly flagged as "left for a real
browser click-through" — a **real Playwright mouse drag** on the price axis (computed from
`tvChart.priceScale('right').width()`, not a guessed pixel count), held through 20 Next Bar
steps interspersed with real mouse moves over the plot area (the exact "every render pass"
case Bug 1's own regression depended on), both the double-click and "A"-button resets
confirmed via `tvCandleSeries.priceScale().options().autoScale` directly (not inferred from
a screenshot), a brand-new trade placed while manually scaled confirming the one-time
override, and — for Bug 2 — a direct canvas pixel-position check via a `fillText()`
prototype patch (capturing text **and** x/y, extending v3.22.5's own text-only version)
confirming the two same-bar pills land exactly 26px apart, never overlapping, with fully
formed (non-garbled) text. One test-writing lesson worth recording: a forced extra render
pass immediately after `advanceBars()` can still land ahead of a leftover
`btLoadCandleWindow()`-scheduled frame queued moments earlier — de-duplicating captured
`(text,x,y)` tuples rather than asserting a raw count is what makes this assertion robust
regardless of exactly how many render passes actually fired, while still catching a real
overlap (which would produce distinct, *not* identical, duplicate positions).

No PHP changed this release, no migration — `php -l`/`node --check` clean on every changed
file, duplicate-name scan clean.

### v3.22.7: The Position Tool Stays Put as the Trade's Visual

**Renumbering:** session results/statistics is now **v3.22.8**, the risk-ladder engine
(previously slated as v3.22.7) is now **v3.22.9**, and the gate checklist is **v3.23.0**.

**Trader report, live (session 6):**

1. **After Place Trade, the position tool disappears.** It reappears only when the order
   fills or is hit. Cause: v3.22.3 hid the linked drawing while its order or trade
   existed (`linked_order_id`/`linked_trade_id`) and drew a separate live box instead.
2. **"The candlesticks are going along with the risk:reward tool."** The live box grew
   from the fill bar to the current cursor on every Next Bar, so the box stretched with
   the candles. The trader wanted the reference-tool behaviour instead: the box they
   drew stays exactly where and how wide they drew it.

#### The fix

**Never hide a linked drawing.** `btRenderDrawings()`'s and `btHitTest()`'s own
`if (d.linked_trade_id || d.linked_order_id) continue;` suppressions (v3.22.3) are gone
— the trader's own drawing stays visible and selectable the whole time: before, while
pending, while open, and after close.

**The auto-growing live box is gone.** `btDrawLiveTrades()`'s own fill-to-cursor
`fillRect()` box (the `xFill`/`xNow` computation, confirmed on live as exactly what grew
every Next Bar) is removed entirely. The linked drawing *is* the trade's box now, fixed
at the width the trader drew it (still stretchable via the v3.22.5 edge handles). The
full-width Entry/SL/TP lines + $ pills and the pending-order "×" cancel, both computed
from real session data (fees paid, lot size, floating P&L) rather than a drawing's own
session-risk_pct estimate, are unchanged — only the box itself moved ownership. The
Open P&L pill is still drawn by `btDrawLiveTrades()` (so it keeps reading real session
data), just repositioned to the centre of the *linked drawing's own* box span instead of
the old growing `xFill`-to-`xNow` midpoint.

**One function answers "what state is this drawing's order/trade in," everywhere.**
`btLinkedState(d)` (`js/backtest-drawings.js`) returns `'pending'`/`'open'`/`'closed'`/
`null` by checking THIS render's own live session state — never trusting a stale id's
mere presence. A cancelled order leaves `linked_order_id` sitting unused on the drawing
(`cancelBtOrder()` was not changed to clear it), which correctly falls through to `null`
here rather than a false `'pending'` — the drawing becomes free again, exactly as if it
had never been submitted. `btDrawPosition()`, `btHitTestOne()`, `btApplyDrag()`, and the
toolbar all call this one function rather than keeping their own copies.

**State colouring (`btDrawPosition()`).** Pending: normal opacity, dashed orange entry
edge. Open: solid blue entry edge. Closed: the whole box (fills, lines, any pills) faded
via `ctx.globalAlpha *= 0.4` — the exit marker (`btDrawClosedTradeMarkers()`, unchanged)
carries the outcome, so nothing else needs to. Once linked (any of the three states),
the box's own Stop/Target/Centre estimate pills (the v3.22.1 Part A design, sized from
`btSession.risk_pct`) are suppressed entirely — `btDrawLiveTrades()`'s real-data pills
already cover that ground, and showing both would show two different numbers for the
same thing. `d._btPillBounds` (which the floating toolbar positions itself from) falls
back to the three lines' own extent when no pills are drawn, so the toolbar still has
something sane to measure from once linked.

**Prices locked while live.** `btHitTestOne()` refuses to return `'entry'`/`'stop'`/
`'tp'` for a drawing whose `btLinkedState()` is `'pending'` or `'open'` — the box's
`'move'`/`'edge-left'`/`'edge-right'` handles are untouched, so the box can still move in
time and stretch. **A real, independent bug caught while building this, not shipped
separately:** the box's own `'move'` drag (dragging inside the box body) shifted BOTH
time and price together (`btApplyDrag()`'s `dp` delta applied to `d.settings.entry`/
`stop_loss`/`take_profit`) — moving a locked box this way would have silently dragged
its price too, the exact thing the lock exists to prevent. Fixed by skipping the price
shift specifically when locked; the box still slides freely in time via the same drag.

**Toolbar.** Once a drawing is linked (any state), "Place Trade" and the R:R-lock toggle
are dropped entirely (re-submitting from an already-placed box doesn't make sense,
whether it's live or already closed) rather than shown disabled. A new price-lock icon
(`#bt-pos-toolbar-pricelock`, a plain indicator, nothing to click) shows only while
`isLive` (pending/open). Delete is disabled while live, enabled again once closed (a
closed trade's box is just an annotation at that point — the exit marker, not the box,
is what independently carries the historical record). `btToolbarBuiltForLinkState` (new,
alongside the existing `btToolbarBuiltForId`) forces a full toolbar rebuild on a
pending→open→closed transition, not just a drawing-id change — otherwise the cheap
"same drawing, just reposition" path would have kept showing a stale Place Trade button
after a fill.

**New Trade with nothing drawn/selected.** `btCreateLinkedPositionDrawing()` (new,
`js/backtest-drawings.js`) creates a real drawing — same fixed 20-bar width every
freshly-drawn position tool gets, anchored at the fill bar — and `btSubmitTicket()` now
calls it whenever `btTicket.sourceDrawingId` is empty, linking the result exactly like an
existing drawing would be. Every trade has a box now, not just ones started from a
hand-drawn tool.

**Existing linked drawings in the live DB simply become visible again.** No migration —
this is purely a client-side rendering/hit-testing change.

#### Two real, independent bugs found and fixed while implementing this

1. **`btNewTradeClick()`'s fallback search for a reusable drawing checked
   `!d._linkedTrade`** — a property nothing in this codebase ever actually set (confirmed
   while removing its one dead reference inside `btDrawPosition()`, left over from a
   v3.22.1 comment that said as much: "`d._linkedTrade` doesn't exist yet in this
   release"). Since `undefined` is always falsy, `!d._linkedTrade` was always `true` —
   this fallback matched *every* position drawing, including ones already linked to a
   live order. A second New Trade click could have hijacked an already-placed trade's
   own box, overwriting its link. Both of `btNewTradeClick()`'s lookup paths (the
   selected drawing, and the fallback search over all drawings) now use the real
   `btLinkedState(d)` check. `btOpenTicketFromDrawing()` itself gained the same guard as
   a third, defense-in-depth layer, consistent with this codebase's own standing practice
   of guarding at the function itself, not just its call sites.
2. **`btSubmitTicket()` closed the order ticket's UI before its own session refresh
   completed** — `btCloseTicket()` ran before `await refreshBtSession()`, so anything
   reading `btSession.open_positions` immediately after the ticket visually closed was
   racing this function's own in-flight refresh. Pre-existing before this release; this
   release's own extra await (creating the new auto-linked drawing, item above) added
   just enough latency to make the race reproducible in practice, caught by this
   release's own harness. Fixed at the root — `refreshBtSession()` now runs before
   `btCloseTicket()`, not after — rather than papered over with an arbitrary delay.

#### Verification

New harness driver `tools/ui-harness/drive-v3227.mjs` (26 assertions, all passing)
against the stateful mock session 20: a Limit order's box staying byte-identical (same
`points[].time`) across its own fill; New Trade's own 20-bar auto-creation confirmed by
width; a TP close fading the box (`btLinkedState` → `'closed'`) while it stays in
`btDrawings`; 20 Next Bar steps leaving the open box's own time span exact and its
on-screen width within a few sub-pixel-rounding px (never the tens-of-pixels-per-bar
drift the old growing box had); the lock itself proven directly via `btHitTestOne()`
rather than a pixel-perfect mouse drag (same "drive the mechanism directly" choice this
project's own harness has used since v3.22.5); and a real mouse-driven move + edge-drag
confirming the box still slides in time and stretches while locked, with price
confirmed byte-unchanged by the move.

`drive.mjs` and `drive-v3226.mjs` pass unmodified. `drive-v3223.mjs` and
`drive-v3225.mjs` each needed one small, clearly-commented update where their own PRIOR
subject matter was directly superseded by this release, not a regression in what those
releases actually shipped: `drive-v3223.mjs`'s own Verify 2 now explicitly switches the
ticket to Market (its cancelled Verify 1 limit order leaves a real, reusable drawing
behind now, which New Trade correctly — per the bug fix above — offers back, exactly the
documented "else, the most recent drawing with no trade yet" priority, just not what that
one step wanted to test); `drive-v3225.mjs`'s own Fix B block, which existed specifically
to assert the old box "grows with Next Bar," now asserts the opposite (fixed width) since
asserting the old behaviour would mean asserting something this release makes false on
purpose.

No PHP changed this release, no migration — `php -l`/`node --check` clean on every changed
file, duplicate-name scan clean.

---

## Part 2 — Other Retired Reference Material

### Brand Identity — Full Type Scale Detail

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
