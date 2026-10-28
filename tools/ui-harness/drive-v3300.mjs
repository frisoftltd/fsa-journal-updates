// v3.30.0 — separate feeling option lists for "While the trade is open" and "After
// close" (previously both reused the same 9-state Before-Entry list — see CLAUDE.md).
// Pure front-end + one PHP function call, no DB involved: like drive-v3291.mjs this
// needs no setup.js stub server. Globals (window.EMOTION_STATES_PRE_ENTRY/_DURING/
// _POST_CLOSE/ALL_EMOTION_CODES/LEGACY_EMOTION_LABELS/JOURNAL_ACTIONS/
// JOURNAL_EXIT_TYPES) are produced by actually invoking the real
// includes/emotion_states.php/journal_taxonomy.php functions via `php -r` — exactly
// what index.php does per-request — rather than a hand-maintained copy, so this can't
// silently drift from what ships. The modal markup is extracted from the real current
// app/modals/trade-modal.php at run time for the same reason.
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const APP_ROOT = path.join(REPO_ROOT, 'app');
const OUT_DIR = path.join(__dirname, 'out-v3300');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Written to a temp .php file and run as `php file.php` rather than `php -r '...'` --
// execSync on win32 goes through cmd.exe, which doesn't honor single-quote shell
// quoting the way bash does, so an inline -r snippet gets mangled.
const dumpScriptPath = path.join(OUT_DIR, '_dump_emotion_data.php');
fs.writeFileSync(dumpScriptPath, `<?php
require "includes/emotion_states.php";
require "includes/journal_taxonomy.php";
echo json_encode([
    "pre" => emotionStates(), "during" => emotionStatesDuring(), "post" => emotionStatesPostClose(),
    "all" => allEmotionCodes(), "legacy" => legacyEmotionLabels(),
    "actions" => journalActions(), "exitTypes" => journalExitTypes(),
]);
`);
const phpData = JSON.parse(execSync(`php "${dumpScriptPath}"`, { cwd: APP_ROOT, encoding: 'utf8' }));

function extractJournalBlock(phpSource) {
    const start = phpSource.indexOf('<!-- ═══ THREE-PHASE TRADE JOURNAL');
    const end = phpSource.indexOf('<div class="section-label">Chart Screenshots');
    if (start === -1 || end === -1) throw new Error('Could not locate the three-phase journal block');
    return phpSource.slice(start, end);
}

const modalPhp = fs.readFileSync(path.join(APP_ROOT, 'modals', 'trade-modal.php'), 'utf8');
const journalBlock = extractJournalBlock(modalPhp);
const tradesJs = fs.readFileSync(path.join(APP_ROOT, 'js', 'trades.js'), 'utf8');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${path.join(APP_ROOT, 'css', 'style.css').replace(/\\/g, '/')}">
<style>body{max-width:640px;margin:0 auto;padding:24px}</style>
</head>
<body>
<div class="app"><div class="main" style="margin-left:0;padding:0">
<form id="trade-form">
${journalBlock}
</form>
</div></div>

<script>
window.EMOTION_STATES_PRE_ENTRY = ${JSON.stringify(phpData.pre)};
window.EMOTION_STATES_DURING = ${JSON.stringify(phpData.during)};
window.EMOTION_STATES_POST_CLOSE = ${JSON.stringify(phpData.post)};
window.ALL_EMOTION_CODES = ${JSON.stringify(phpData.all)};
window.LEGACY_EMOTION_LABELS = ${JSON.stringify(phpData.legacy)};
window.JOURNAL_ACTIONS = ${JSON.stringify(phpData.actions)};
window.JOURNAL_EXIT_TYPES = ${JSON.stringify(phpData.exitTypes)};
async function api(){ return {success:true}; }
function toast(){}
function updateSizingPanel(){}
</script>
<script>
${tradesJs}
</script>
<script>
// initJournalSections() needs a 'data' shape matching get_trades' per-trade row.
window.openForPhase0Demo = function(){
    resetJournalState();
    initJournalSections(null); // brand-new trade: During/Post-Close hidden
    document.getElementById('journal-body-pre_entry').style.display = 'block';
};
window.openForEditDemo = function(trade){
    resetJournalState();
    initJournalSections(trade);
    ['pre_entry','during','post_close'].forEach(p => {
        const body = document.getElementById('journal-body-'+p);
        if (body) body.style.display = 'block';
    });
};
</script>
</body>
</html>
`;

const fixturePath = path.join(OUT_DIR, 'fixture.html');
fs.writeFileSync(fixturePath, html);
const url = 'file://' + fixturePath;

let pass = 0, fail = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log(`  PASS: ${label}`); }
    else { fail++; console.log(`  FAIL: ${label} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 1400 } });
await page.goto(url);

// ── Brand-new trade: only Pre-Entry, still the original 9-state shared list ────────
await page.evaluate(() => window.openForPhase0Demo());
const preCodes = await page.evaluate(() => Array.from(document.querySelectorAll('#emotion-grid-pre_entry .emotion-pill')).map(b => b.dataset.code));
check('Pre-Entry still offers exactly the original 9 shared codes, unchanged',
    preCodes, ['settled','impatient','hesitant','chasing','hoping','wanting_out','greedy','invincible','vengeful']);
await page.screenshot({ path: path.join(OUT_DIR, '01-pre-entry-unchanged.png') });

// ── Separate option lists per stage (req: different lists, each 9/10 items) ────────
const duringTrade = {
    id: 1, result: 'Open',
    trade_journal: [],
    trade_checkins: [],
};
await page.evaluate((t) => window.openForEditDemo(t), duringTrade);
const duringCodes = await page.evaluate(() => Array.from(document.querySelectorAll('#emotion-grid-during .emotion-pill')).map(b => b.dataset.code));
const postCodes = await page.evaluate(() => Array.from(document.querySelectorAll('#emotion-grid-post_close .emotion-pill')).map(b => b.dataset.code));
check('While-open list has the 9 new codes, in order',
    duringCodes, ['calm_trusting','anxious_stop','hoping_reversal','greedy_add','wanting_out_early','tempted_move_stop','checking_constantly','bored_impatient','fear_giving_back']);
check('After-close list has the 10 new codes, in order',
    postCodes, ['accepting_plan','relieved','satisfied_process','frustrated_angry','revenge_urge','regret_early','regret_late','overconfident_win','flat_numb','eager_rebound']);
check('While-open and After-close lists are disjoint from each other',
    duringCodes.some(c => postCodes.includes(c)), false);
check('While-open list is disjoint from the old shared/Pre-Entry list (no silent reuse)',
    duringCodes.some(c => preCodes.includes(c)), false);
check('After-close list is disjoint from the old shared/Pre-Entry list (no silent reuse)',
    postCodes.some(c => preCodes.includes(c)), false);
// openForEditDemo() already reveals all three phase bodies -- cropped shots of each
// section individually, since a full-page shot of all three at once is less useful for
// a visual before/after comparison of "the two lists are actually different."
await page.locator('#journal-body-during').screenshot({ path: path.join(OUT_DIR, '02-while-open-empty.png') });
await page.locator('#journal-body-post_close').screenshot({ path: path.join(OUT_DIR, '03-after-close-empty.png') });

// ── Info icon + one-line explanation per chip, each stage ──────────────────────────
await page.click('.emotion-info-btn[data-code="frustrated_angry"]');
const postDesc = await page.textContent('#emotion-description-post_close');
check('After-close info icon shows a real one-line explanation', postDesc.includes('reactive'), true);

// ── Old value saved under an old (pre-this-release) phase list still displays ──────
// Simulates a During check-in saved BEFORE v3.30.0, when During rendered the old
// shared 9-state list -- 'vengeful' was a real selectable During option back then.
const legacyDuringTrade = {
    id: 2, result: 'Win',
    trade_journal: [{ phase: 'post_close', emotion_code: 'invincible', note: '', exit_type: null, good_process: null, created_at: '2026-01-01 00:00:00' }],
    trade_checkins: [{ id: 9, checked_at: '2026-01-01 00:00:00', emotion_code: 'vengeful', tempted_text: null, actions: [] }],
};
await page.evaluate((t) => window.openForEditDemo(t), legacyDuringTrade);
const duringSelected = await page.evaluate(() => {
    const el = document.querySelector('#emotion-grid-during .emotion-pill[style*="background"]');
    return el ? el.dataset.code : null;
});
check('an old-list During value ("vengeful") still shows, pre-selected, as an extra chip', duringSelected, 'vengeful');
const duringExtraInGrid = await page.evaluate(() => !!document.querySelector('#emotion-grid-during .emotion-pill[data-code="vengeful"]'));
check('the extra chip is a real pill in the grid (not just a text note)', duringExtraInGrid, true);
const duringNote = await page.textContent('#emotion-legacy-note-during');
check('the note names it as being from an older list', duringNote.includes('older list'), true);
const postSelected = await page.evaluate(() => {
    const el = document.querySelector('#emotion-grid-post_close .emotion-pill[style*="background"]');
    return el ? el.dataset.code : null;
});
check('a current-list After-close value ("invincible", from the old shared list) also shows as an extra chip', postSelected, 'invincible');
await page.screenshot({ path: path.join(OUT_DIR, '04-old-values-shown.png') });

// Still resolves a label via the view-panel code path (emotionLabel()), not just the
// edit-form grid -- this is what the read-only Trade Journal / Check-In History panels
// use.
const label = await page.evaluate(() => emotionLabel('vengeful'));
check('emotionLabel() still resolves an old-list code to its real label', label, 'Vengeful');

// Picking a different option replaces the extra chip's selection, and the note clears.
await page.click('.emotion-pill[data-code="fear_giving_back"]');
const noteHiddenAfterReplace = await page.isHidden('#emotion-legacy-note-during');
check('selecting a current option clears the "older list" note', noteHiddenAfterReplace, true);

// ── Saving a new value and reopening shows it selected (round trip through the form's
// own in-memory state, collectTradeJournal() -> the shape saveJournal() expects) ──────
await page.evaluate((t) => window.openForEditDemo(t), legacyDuringTrade);
await page.click('.emotion-pill[data-code="relieved"]'); // After-close: pick a brand-new option
const collected = await page.evaluate(() => collectTradeJournal());
const postEntry = collected.find(e => e.phase === 'post_close');
check('collectTradeJournal() carries the newly selected After-close code', postEntry.emotion_code, 'relieved');

// Re-render as if reopening the trade with that value now persisted.
const reopened = {
    id: 2, result: 'Win',
    trade_journal: [{ phase: 'post_close', emotion_code: 'relieved', note: '', exit_type: null, good_process: null, created_at: '2026-01-02 00:00:00' }],
    trade_checkins: [],
};
await page.evaluate((t) => window.openForEditDemo(t), reopened);
const reopenedSelected = await page.evaluate(() => {
    const el = document.querySelector('#emotion-grid-post_close .emotion-pill[style*="background"]');
    return el ? el.dataset.code : null;
});
check('reopening the trade shows the newly saved After-close code selected', reopenedSelected, 'relieved');
await page.screenshot({ path: path.join(OUT_DIR, '05-new-value-round-trip.png') });

await page.close();
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
if (fail > 0) process.exit(1);
