<?php
/**
 * FundedControl — Emotional State Taxonomy (v3.10.0, phase-split in v3.30.0)
 *
 * emotionStates() below is the ORIGINAL 9-state set: trades.emotion_tag's own taxonomy,
 * and (unchanged by v3.30.0, per the briefing) still exactly what the trade journal's
 * Before-Entry stage offers. Grounded in Mark Douglas ("Trading in the Zone") and
 * Fenton-O'Creevy et al. (2011, Journal of Organizational Behavior).
 *
 * v3.30.0 — While-open (trade_checkins.emotion_code) and After-close
 * (trade_journal.emotion_code, phase='post_close') used to render this SAME set too
 * (trade_journal/trade_checkins just reused emotionStates() for every phase — see the
 * old doc comment on journal_taxonomy.php, now corrected). That's wrong on its own
 * terms: how a trade feels with money still at risk is not the same set of states as
 * the reaction to a result. emotionStatesDuring()/emotionStatesPostClose() below are
 * each phase's own list; journalEmotionOptions($phase) is the one place that maps a
 * phase to its list, so a caller never has to know which function goes with which phase
 * string. A code must never change once shipped in ANY of these three lists, or
 * historical data on that phase's column becomes unreadable — labels/descriptions may
 * still be reworded freely. Nothing outside this file should hardcode a code/label/
 * description; read them from the functions here instead.
 */

function emotionStates(): array {
    return [
        ['code' => 'settled', 'label' => 'Settled', 'description' =>
            'Following the plan with no urge to act. Nothing to prove, nothing to chase. This is the state to aim for — not excitement, just the absence of pressure.'],
        ['code' => 'impatient', 'label' => 'Impatient', 'description' =>
            "Nothing qualifies yet, but I want to trade anyway. The urge is coming from boredom or from time spent waiting, not from the chart."],
        ['code' => 'hesitant', 'label' => 'Hesitant', 'description' =>
            "The setup meets every rule and I still don't want to pull the trigger. Usually fear of being wrong rather than a problem with the setup."],
        ['code' => 'chasing', 'label' => 'Chasing', 'description' =>
            "Price is moving without me and I don't want to be left behind. Entry location gets worse the longer this runs."],
        ['code' => 'hoping', 'label' => 'Hoping', 'description' =>
            "The trade is against me and I'm waiting for it to come back. Hope is what turns a planned loss into a bigger one."],
        ['code' => 'wanting_out', 'label' => 'Wanting out', 'description' =>
            "I want to close before the level I planned. Taking less than the setup offered, to stop the discomfort."],
        ['code' => 'greedy', 'label' => 'Greedy', 'description' =>
            "I want more than the plan gives. Moving the target or holding past it because it feels like there's more in it."],
        ['code' => 'invincible', 'label' => 'Invincible', 'description' =>
            "Recent wins make the rules feel optional. The most dangerous state, because it follows success rather than failure."],
        ['code' => 'vengeful', 'label' => 'Vengeful', 'description' =>
            "I want that loss back now. The next trade is about the last one rather than about the setup."],
    ];
}

/**
 * v3.30.0 — While Open (trade_checkins.emotion_code). What's happening in the head with
 * money still at risk, not what was planned (that's emotionStates() above) and not the
 * reaction to a result (that's emotionStatesPostClose() below). Brand-new codes, not
 * reused from emotionStates() even where a state sounds similar (e.g. "hoping_reversal"
 * here vs "hoping" above) — the two lists are allowed to diverge in wording over time
 * without one dragging the other's stored meaning along with it.
 */
function emotionStatesDuring(): array {
    return [
        ['code' => 'calm_trusting', 'label' => 'Calm, trusting the plan', 'description' =>
            "Following the plan while the trade is live. No urge to touch the stop, the target, or the size — just watching it play out."],
        ['code' => 'anxious_stop', 'label' => 'Anxious about the stop', 'description' =>
            "Watching the stop like it's about to get hit, even when price hasn't actually threatened it. The discomfort is about risk, not about what's actually happening."],
        ['code' => 'hoping_reversal', 'label' => 'Hoping it turns around', 'description' =>
            "Price is against me and I'm wishing it back rather than respecting the stop. Hope here is what turns a planned loss into a bigger one."],
        ['code' => 'greedy_add', 'label' => 'Greedy, want to add or move the target', 'description' =>
            "It's working and I want more than the plan allows — adding size or pushing the target further out because it feels like there's more in it."],
        ['code' => 'wanting_out_early', 'label' => 'Wanting out early', 'description' =>
            "I want to close before the level I planned, to stop the discomfort of still being in it — not because the setup has actually changed."],
        ['code' => 'tempted_move_stop', 'label' => 'Tempted to move the stop', 'description' =>
            "The urge to widen the stop so it doesn't get hit, rather than accept that the original risk was already the plan."],
        ['code' => 'checking_constantly', 'label' => 'Checking the chart constantly', 'description' =>
            "Refreshing the chart over and over instead of letting the trade breathe. Usually a sign the position is too big for comfort."],
        ['code' => 'bored_impatient', 'label' => 'Bored, impatient for it to finish', 'description' =>
            "Nothing is wrong, I just want it over. The trade is fine; my attention has moved on."],
        ['code' => 'fear_giving_back', 'label' => 'Fear of giving back profit', 'description' =>
            "The trade is in profit and every tick back feels like a loss, even though nothing has actually gone wrong with the plan."],
    ];
}

/**
 * v3.30.0 — After Close (trade_journal.emotion_code, phase='post_close'). The reaction
 * to the result, once it's final — a different moment from either of the two lists
 * above, and historically the one where the urge to act on a feeling is strongest.
 */
function emotionStatesPostClose(): array {
    return [
        ['code' => 'accepting_plan', 'label' => 'Accepting, it was the plan', 'description' =>
            "The result is what it is. The trade followed the plan, win or lose, and there's nothing to relitigate."],
        ['code' => 'relieved', 'label' => 'Relieved', 'description' =>
            "Glad it's over, more because the uncertainty is gone than because of how it actually went."],
        ['code' => 'satisfied_process', 'label' => 'Satisfied, followed the plan', 'description' =>
            "Good process, regardless of outcome — every rule was followed and that's what this feeling is about, not the P&L."],
        ['code' => 'frustrated_angry', 'label' => 'Frustrated or angry', 'description' =>
            "The result stings and it shows. Worth naming before the next decision, since this is exactly the state that leads to the next one being reactive."],
        ['code' => 'revenge_urge', 'label' => 'Urge to revenge trade', 'description' =>
            "I want that loss back right now. The next trade is about this one, not about a setup."],
        ['code' => 'regret_early', 'label' => 'Regret, closed too early', 'description' =>
            "It kept running after I got out. The exit was early relative to the plan, not wrong relative to what was known at the time."],
        ['code' => 'regret_late', 'label' => 'Regret, held too long', 'description' =>
            "I saw the reason to get out and didn't take it. The plan said something, I waited anyway."],
        ['code' => 'overconfident_win', 'label' => 'Overconfident after a win', 'description' =>
            "This win makes the next setup feel like a formality. The most dangerous state after a result, because it follows success, not failure."],
        ['code' => 'flat_numb', 'label' => 'Flat or numb', 'description' =>
            "No real reaction either way. Worth noticing on its own, since an outcome that should matter and doesn't can be its own signal."],
        ['code' => 'eager_rebound', 'label' => 'Eager to jump back in right away', 'description' =>
            "Wanting the next trade immediately, win or lose, rather than waiting for the next real setup."],
    ];
}

/**
 * v3.30.0 — the one place a phase string maps to its own option list. 'during' reads
 * oddly next to trade_journal's own phase enum (which no longer has a 'during' value —
 * see CLAUDE.md's Three-Phase Trade Journal convention) but it's the value
 * js/trades.js has always used for this phase's DOM ids/state keys, so it's kept here
 * rather than introduced as a second name for the same thing.
 */
function journalEmotionOptions(string $phase): array {
    switch ($phase) {
        case 'during':     return emotionStatesDuring();
        case 'post_close': return emotionStatesPostClose();
        case 'pre_entry':
        default:           return emotionStates();
    }
}

/**
 * Retired 8-state set (pre-v3.10.0). Never offered as a selectable option — lookup only,
 * so historical trades still render a readable label instead of a raw code or blank.
 * The old and new sets are not 1:1 (e.g. "Bored" and "Itchy" both land near "Impatient")
 * — do not use this map to silently rewrite trades.emotion_tag to a new code.
 */
function legacyEmotionLabels(): array {
    return [
        'calm'     => 'Calm (legacy)',
        'itchy'    => 'Itchy (legacy)',
        'fomo'     => 'FOMO (legacy)',
        'revenge'  => 'Revenge (legacy)',
        'bored'    => 'Bored (legacy)',
        'overconf' => 'Overconfident (legacy)',
        'anxious'  => 'Anxious (legacy)',
        'unsure'   => 'Unsure (legacy)',
    ];
}

/**
 * v3.30.0 — every code any of the three phase lists has ever offered, in one flat list.
 * The one place that resolves "is this stored code still current for THIS phase, or did
 * it come from a different phase/era" — e.g. a During check-in saved before this release
 * could hold 'vengeful' (it rendered emotionStates() back then same as every phase did),
 * which isn't in emotionStatesDuring() any more but must still show a real label rather
 * than the raw code. Order matters for emotionLabel()'s lookup below only in that a code
 * must be unique across all three lists — it is, by construction (new phases got brand
 * new code strings specifically so this merge is never ambiguous).
 */
function allEmotionCodes(): array {
    return array_merge(emotionStates(), emotionStatesDuring(), emotionStatesPostClose());
}

/**
 * Readable label for any emotion_tag/emotion_code value from any phase or era: current
 * code (any of the three phase lists), legacy code, or unrecognized. Returns null only
 * for a genuinely empty/unanswered value.
 */
function emotionLabel(?string $code): ?string {
    if ($code === null || $code === '') return null;
    foreach (allEmotionCodes() as $s) {
        if ($s['code'] === $code) return $s['label'];
    }
    $legacy = legacyEmotionLabels();
    if (isset($legacy[$code])) return $legacy[$code];
    return $code; // unrecognized — show the raw value rather than hide it
}
