<?php
/**
 * FundedControl — Trade Journal Taxonomy (v3.11.0)
 *
 * Single source of truth for the enumerated answers on trade_journal, other than
 * emotion (that stays in emotion_states.php — the nine states are shared across all
 * three journal phases, not journal-specific). trade_journal.emotion_code/exit_type/
 * action_code store the CODE columns defined here, never the label — labels may be
 * reworded freely, codes must not change once shipped.
 */

/** Q4 — "What have I done since entry?" (during phase, multi-select). */
function journalActions(): array {
    return [
        ['code' => 'left_alone',          'label' => 'Left it alone'],
        ['code' => 'stop_closer',         'label' => 'Moved stop closer'],
        ['code' => 'stop_wider',          'label' => 'Moved stop wider'],
        ['code' => 'moved_target',        'label' => 'Moved target'],
        ['code' => 'added_to_position',   'label' => 'Added to position'],
        ['code' => 'closed_part',         'label' => 'Closed part'],
        ['code' => 'watched_constantly',  'label' => 'Watched constantly'],
        ['code' => 'nearly_closed',       'label' => 'Nearly closed it'],
    ];
}

/** Q7 — "How did it end?" (post_close phase, single select). */
function journalExitTypes(): array {
    return [
        ['code' => 'hit_target',              'label' => 'Hit target'],
        ['code' => 'hit_stop',                'label' => 'Hit stop'],
        ['code' => 'closed_early_profit',     'label' => 'Closed early in profit'],
        ['code' => 'closed_early_loss',       'label' => 'Closed early in loss'],
        ['code' => 'stop_then_stopped_out',   'label' => 'Moved stop then stopped out'],
        ['code' => 'other_manual',            'label' => 'Other manual exit'],
    ];
}

function journalActionLabel(?string $code): ?string {
    if ($code === null || $code === '') return null;
    foreach (journalActions() as $a) if ($a['code'] === $code) return $a['label'];
    return $code; // unrecognized — show raw rather than hide
}

function journalExitTypeLabel(?string $code): ?string {
    if ($code === null || $code === '') return null;
    foreach (journalExitTypes() as $e) if ($e['code'] === $code) return $e['label'];
    return $code;
}
