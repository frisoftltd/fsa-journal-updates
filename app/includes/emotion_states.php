<?php
/**
 * FundedControl — Emotional State Taxonomy (v3.10.0)
 *
 * Single source of truth for trades.emotion_tag: code, label, description, order.
 * Grounded in Mark Douglas ("Trading in the Zone") and Fenton-O'Creevy et al. (2011,
 * Journal of Organizational Behavior). Order runs target state -> pre-entry distortions
 * -> in-trade distortions -> post-outcome distortions; keep this order in the UI.
 *
 * trades.emotion_tag stores the CODE, never the label — labels/descriptions may be
 * reworded freely, but a code must never change once shipped, or historical data becomes
 * unreadable. Nothing outside this file should hardcode these codes/labels/descriptions;
 * read them from emotionStates()/legacyEmotionLabels()/emotionLabel() instead.
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
 * Readable label for any emotion_tag value: current code, legacy code, or unrecognized.
 * Returns null only for a genuinely empty/unanswered value.
 */
function emotionLabel(?string $code): ?string {
    if ($code === null || $code === '') return null;
    foreach (emotionStates() as $s) {
        if ($s['code'] === $code) return $s['label'];
    }
    $legacy = legacyEmotionLabels();
    if (isset($legacy[$code])) return $legacy[$code];
    return $code; // unrecognized — show the raw value rather than hide it
}
