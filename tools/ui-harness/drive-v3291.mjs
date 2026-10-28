// v3.29.1 — New/Edit Strategy modal redesign (toggle switch + selectable challenge
// tiles, replacing the misaligned "Applies to all challenges" checkbox + checkbox
// list). This is a pure front-end modal with no DB/PHP involvement at all (no new
// endpoint, no migration), so unlike every other driver in this directory it does NOT
// go through setup.js's "copy app/ + stub config.php/api.php + php -S" recipe — there's
// no backend behaviour to stub. Instead it builds a tiny standalone HTML page at run
// time, always reading the REAL current app/modals/strategy-builder-modal.php,
// app/js/strategies.js and app/css/style.css directly off disk so this can never drift
// out of sync with what actually ships (a static copy under this directory would).
//
// "Before" uses `git show HEAD:...` for the same three files, so the before/after
// screenshots are a true diff against the last committed (pre-redesign) state, not a
// hand-maintained snapshot.
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'out-v3291');
fs.mkdirSync(OUT_DIR, { recursive: true });

function gitShow(relPath) {
    return execSync(`git show HEAD:${relPath.replace(/\\/g, '/')}`, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function extractModalBlock(phpSource) {
    const start = phpSource.indexOf('<div class="modal-overlay" id="strategy-builder-modal">');
    const end = phpSource.indexOf('<!-- ══ STRATEGY VARIABLES EDITOR MODAL');
    if (start === -1 || end === -1) throw new Error('Could not locate the strategy-builder-modal block');
    return phpSource.slice(start, end).trim();
}

const DEMO_SCRIPT = `
let allChallenges = [
  {id:1,name:'TradeFI',prop_firm:'Bitfunded',challenge_phase:'Starter Two Step',default_strategy_id:null},
  {id:2,name:'15 Minutes Entry',prop_firm:'Bitfunded',challenge_phase:'Phase 1',default_strategy_id:null},
  {id:3,name:'Bitfunded Altcoin',prop_firm:'Bitfunded',challenge_phase:'Phase 1',default_strategy_id:null},
  {id:4,name:'hyrotrader trial',prop_firm:'Hyrotrader',challenge_phase:'Trial',default_strategy_id:null}
];
let _realChallenges = allChallenges;
async function api(action, method, data){ return {success:true}; }
function toast(){}
// escapeHtml normally lives in app.js, which this standalone harness doesn't load.
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function openEditDemo(){
  allChallenges = _realChallenges.map(c => ({...c})); // no default_strategy_id at risk
  openStrategyModal({id:5, name:'Signal-follow (YouTube)', applies_all_challenges:0, challenge_ids:[1]});
}
function openEditDefaultDemo(){
  // Challenge 2 (15 Minutes Entry) currently defaults to strategy 5 -- deselecting it
  // (it's not in challenge_ids below) should trigger the cleared-default notice.
  allChallenges = _realChallenges.map(c => c.id === 2 ? {...c, default_strategy_id: 5} : {...c});
  openStrategyModal({id:5, name:'Signal-follow (YouTube)', applies_all_challenges:0, challenge_ids:[1]});
}
function openEmptyChallengesDemo(){
  allChallenges = [];
  openStrategyModal();
  allChallenges = _realChallenges;
}
`;

function buildHtml({ cssPath, modalHtml, jsInline, withEmptyDemo }) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${cssPath}">
</head>
<body>
<div class="app">
  <div class="main" style="padding:24px;margin-left:0">
    <button class="btn btn-success" onclick="openStrategyModal()" id="open-new-btn">+ New Strategy</button>
    <button class="btn btn-ghost" onclick="openEditDemo()" id="open-edit-btn">Edit demo (scoped)</button>
    ${withEmptyDemo ? '<button class="btn btn-ghost" onclick="openEditDefaultDemo()" id="open-edit-default-btn">Edit demo (clears default)</button>' : ''}
    ${withEmptyDemo ? '<button class="btn btn-ghost" onclick="openEmptyChallengesDemo()" id="open-empty-btn">New (no challenges)</button>' : ''}
  </div>
</div>

${modalHtml}

<script>
${DEMO_SCRIPT}
</script>
<script>
${jsInline}
</script>
</body>
</html>
`;
}

let pass = 0, fail = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log(`  PASS: ${label}`); }
    else { fail++; console.log(`  FAIL: ${label} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// ── Build fixtures straight from real source (current working tree + last commit) ──
const oldModalPhp = gitShow('app/modals/strategy-builder-modal.php');
const oldJs = gitShow('app/js/strategies.js');
const oldCss = gitShow('app/css/style.css');
fs.writeFileSync(path.join(OUT_DIR, 'old_style.css'), oldCss);
fs.writeFileSync(path.join(OUT_DIR, 'before.html'), buildHtml({
    cssPath: 'old_style.css',
    modalHtml: extractModalBlock(oldModalPhp),
    jsInline: oldJs,
    withEmptyDemo: false,
}));

const newModalPhp = fs.readFileSync(path.join(REPO_ROOT, 'app', 'modals', 'strategy-builder-modal.php'), 'utf8');
const newJs = fs.readFileSync(path.join(REPO_ROOT, 'app', 'js', 'strategies.js'), 'utf8');
fs.copyFileSync(path.join(REPO_ROOT, 'app', 'css', 'style.css'), path.join(OUT_DIR, 'new_style.css'));
fs.writeFileSync(path.join(OUT_DIR, 'after.html'), buildHtml({
    cssPath: 'new_style.css',
    modalHtml: extractModalBlock(newModalPhp),
    jsInline: newJs,
    withEmptyDemo: true,
}));

const beforeUrl = 'file://' + path.join(OUT_DIR, 'before.html');
const afterUrl = 'file://' + path.join(OUT_DIR, 'after.html');

const browser = await chromium.launch();

// ── BEFORE screenshots (last committed, pre-redesign modal) ────────────────────────
{
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    await page.goto(beforeUrl);
    await page.click('#open-new-btn');
    await page.waitForTimeout(100);
    await page.click('#sb-applies-all'); // uncheck to reveal the misaligned checkbox list
    await page.screenshot({ path: path.join(OUT_DIR, 'before-1365-new.png') });
    await page.close();
}
{
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    await page.goto(beforeUrl);
    await page.click('#open-edit-btn');
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(OUT_DIR, 'before-360-edit.png') });
    await page.close();
}

// ── AFTER screenshots + interaction tests (real current source) ────────────────────
{
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    await page.goto(afterUrl);

    await page.click('#open-new-btn');
    await page.waitForTimeout(100);
    check('new strategy: All-challenges toggle defaults ON', await page.getAttribute('#sb-applies-all', 'aria-checked'), 'true');
    check('new strategy: tile grid dimmed while All is on',
        await page.evaluate(() => document.getElementById('sb-challenge-list').classList.contains('sb-grid-dimmed')), true);
    await page.screenshot({ path: path.join(OUT_DIR, 'after-1365-new.png') });

    check('new strategy, no name: Save disabled', await page.isDisabled('#sb-save-btn'), true);
    check('reason text shown for missing name', (await page.textContent('#sb-save-reason')).includes('name'), true);

    await page.fill('#sb-name', 'ICT Concepts');
    check('with a name and All on: Save enabled', await page.isDisabled('#sb-save-btn'), false);

    await page.click('#sb-applies-all'); // off
    check('All off, nothing selected: Save disabled', await page.isDisabled('#sb-save-btn'), true);
    check('reason text shown for no challenge selected', (await page.textContent('#sb-save-reason')).includes('challenge'), true);
    check('tile grid un-dimmed once All is off',
        await page.evaluate(() => document.getElementById('sb-challenge-list').classList.contains('sb-grid-dimmed')), false);

    const tileIds = await page.evaluate(() => Array.from(document.querySelectorAll('.sb-challenge-tile')).map(t => t.dataset.id));
    await page.click(`.sb-challenge-tile[data-id="${tileIds[0]}"]`);
    await page.click(`.sb-challenge-tile[data-id="${tileIds[1]}"]`);
    check('summary line after selecting 2 tiles', (await page.textContent('#sb-summary')).trim(), 'Used on: 2 challenges');
    check('2 tiles selected: Save enabled', await page.isDisabled('#sb-save-btn'), false);
    await page.screenshot({ path: path.join(OUT_DIR, 'after-1365-two-tiles.png') });

    await page.click('#sb-applies-all'); // on
    await page.click('#sb-applies-all'); // off again
    const selectedAfterRoundTrip = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.sb-challenge-tile[aria-checked="true"]')).map(t => t.dataset.id).sort());
    check('toggling All on then off restores the previous tile selection', selectedAfterRoundTrip, [...tileIds.slice(0, 2)].sort());

    // Keyboard-only: focus a tile, Space toggles it, a second toggle still works (regression
    // check for the "re-render drops focus" bug caught during development).
    await page.focus(`.sb-challenge-tile[data-id="${tileIds[0]}"]`);
    await page.keyboard.press('Space');
    check('keyboard Space toggles a focused tile off', await page.getAttribute(`.sb-challenge-tile[data-id="${tileIds[0]}"]`, 'aria-checked'), 'false');
    await page.keyboard.press('Enter');
    check('keyboard Enter toggles it back on (focus survived the first toggle)', await page.getAttribute(`.sb-challenge-tile[data-id="${tileIds[0]}"]`, 'aria-checked'), 'true');

    await page.focus('#sb-applies-all');
    await page.keyboard.press('Enter');
    check('keyboard Enter activates the All-challenges toggle button', await page.getAttribute('#sb-applies-all', 'aria-checked'), 'true');
    await page.click('#sb-applies-all'); // back off for the next checks

    await page.evaluate(() => closeStrategyModal());

    // Edit mode: pre-fills correctly from saved state (scoped to 1 challenge)
    await page.click('#open-edit-btn');
    await page.waitForTimeout(100);
    check('edit mode title', await page.textContent('#strategy-builder-modal-title'), 'Edit strategy');
    check('edit mode (scoped strategy): toggle OFF', await page.getAttribute('#sb-applies-all', 'aria-checked'), 'false');
    check('edit mode: name pre-filled', await page.inputValue('#sb-name'), 'Signal-follow (YouTube)');
    check('edit mode: pre-filled tile selection',
        await page.evaluate(() => Array.from(document.querySelectorAll('.sb-challenge-tile[aria-checked="true"]')).map(t => t.dataset.id)), ['1']);
    check('edit mode (challenge 1, no default pointer at risk): notice hidden', await page.isHidden('#sb-default-notice'), true);
    await page.evaluate(() => closeStrategyModal());

    // Edit mode: a challenge whose default_strategy_id points here, but isn't selected
    await page.click('#open-edit-default-btn');
    await page.waitForTimeout(100);
    check('edit mode (default pointer at risk): cleared-default notice shown', await page.isVisible('#sb-default-notice'), true);
    check('notice names the specific challenge', (await page.textContent('#sb-default-notice')).includes('15 Minutes Entry'), true);
    await page.screenshot({ path: path.join(OUT_DIR, 'after-1365-default-notice.png') });
    await page.evaluate(() => closeStrategyModal());

    // No challenges at all
    await page.click('#open-empty-btn');
    await page.waitForTimeout(100);
    check('zero challenges: empty-state message shown', await page.isVisible('#sb-challenge-empty'), true);
    check('zero challenges: tile grid hidden (not an empty scroll box)', await page.isHidden('#sb-challenge-list'), true);
    await page.evaluate(() => closeStrategyModal());

    await page.close();
}

// ── 360px (phone) screenshot + no-inner-scroll check ────────────────────────────────
{
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await page.goto(afterUrl);
    await page.click('#open-new-btn');
    await page.waitForTimeout(100);
    await page.fill('#sb-name', 'FSA 1H/15m Entry');
    await page.click('#sb-applies-all'); // off, to show the tile grid in one column
    await page.screenshot({ path: path.join(OUT_DIR, 'after-360-new.png') });

    check('360px viewport: tile grid collapses to 1 column',
        await page.evaluate(() => getComputedStyle(document.getElementById('sb-challenge-list')).gridTemplateColumns.split(' ').length), 1);
    check('tile grid itself has no independent scrollbar',
        await page.evaluate(() => getComputedStyle(document.getElementById('sb-challenge-list')).overflowY), 'visible');
    const footerBox = await page.evaluate(() => {
        const r = document.querySelector('.sb-modal-footer').getBoundingClientRect();
        return { bottom: r.bottom, viewportHeight: window.innerHeight };
    });
    check('sticky footer stays within the viewport', footerBox.bottom <= footerBox.viewportHeight, true);

    await page.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
if (fail > 0) process.exit(1);
