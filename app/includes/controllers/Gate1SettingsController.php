<?php
/**
 * FundedControl — FSA Gate 1 Indicator Settings Controller (v3.25.0)
 * Handles: get_gate1_settings, save_gate1_settings
 *
 * Per-user settings for the FSA Gate 1 structure indicator's own Inputs/Style/Visibility
 * dialog (js/backtest.js::btOpenGate1Settings()) -- one row per (user, indicator) in
 * user_indicator_settings (2026_10_10_0003), `indicator` fixed to 'fsa_gate1' here. A
 * never-saved user gets DEFAULTS verbatim, never a partial/null shape — the client always
 * has a complete settings object to build the engine and dialog from.
 *
 * Only atrMult (createGate1Engine's own atrMult option) affects the engine itself — every
 * other field here is a pure display preference (js/backtest.js/js/backtest-drawings.js
 * read them, structure-gate1.js never does). Validated strictly: a malformed field is
 * rejected outright (jsonError), never silently coerced or dropped, since a saved default
 * is applied to every future session until changed again.
 */
class Gate1SettingsController {
    private $db;
    private $uid;

    const INDICATOR = 'fsa_gate1';
    const TIMEFRAMES = ['15m', '1H', '4H', '1D'];

    const DEFAULTS = [
        'atrMult' => 2.0,
        'showSwings' => true,
        'showBreaks' => true,
        'showLevels' => true,
        'showBadge' => true,
        'bullColor' => '#089981',
        'bearColor' => '#F23645',
        'unclearColor' => '#787B86',
        'labelSize' => 'normal',
        'visibility' => ['15m' => true, '1H' => true, '4H' => true, '1D' => true],
    ];

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function get() {
        $s = $this->db->prepare("SELECT settings_json FROM user_indicator_settings WHERE user_id=? AND indicator=?");
        $s->execute([$this->uid, self::INDICATOR]);
        $row = $s->fetch();
        if (!$row) { jsonResponse(self::DEFAULTS); return; }
        $saved = json_decode($row['settings_json'], true);
        jsonResponse(is_array($saved) ? $saved : self::DEFAULTS);
    }

    /** Swing size: 0.5–10.0 in 0.5 steps (a float that, doubled, is an integer — avoids
     *  float-modulo precision noise from a direct fmod() check). Colours: strict
     *  #RRGGBB. Booleans: must actually be bool, not a truthy string. Anything else in
     *  the payload, or a missing required field, rejects the whole save — a partial/
     *  malformed settings object is never written, since it becomes every future
     *  session's starting point. */
    private function validate(array $d): array {
        if (!isset($d['atrMult']) || !is_numeric($d['atrMult'])) jsonError('Swing size is required.');
        $atrMult = (float) $d['atrMult'];
        if ($atrMult < 0.5 || $atrMult > 10.0) jsonError('Swing size must be between 0.5 and 10.0.');
        $doubled = $atrMult * 2;
        if (abs($doubled - round($doubled)) > 1e-9) jsonError('Swing size must be in steps of 0.5.');
        $atrMult = round($atrMult, 1);

        foreach (['showSwings', 'showBreaks', 'showLevels', 'showBadge'] as $boolField) {
            if (!isset($d[$boolField]) || !is_bool($d[$boolField])) jsonError("$boolField must be true or false.");
        }

        foreach (['bullColor' => 'Bullish colour', 'bearColor' => 'Bearish colour', 'unclearColor' => 'Unclear colour'] as $colorField => $label) {
            $v = $d[$colorField] ?? null;
            if (!is_string($v) || !preg_match('/^#[0-9A-Fa-f]{6}$/', $v)) jsonError("$label must be a #RRGGBB colour.");
        }

        if (!isset($d['labelSize']) || !in_array($d['labelSize'], ['small', 'normal'], true)) {
            jsonError('Label size must be "small" or "normal".');
        }

        if (!isset($d['visibility']) || !is_array($d['visibility'])) jsonError('Visibility must be an object.');
        $visibility = [];
        foreach (self::TIMEFRAMES as $tf) {
            if (!isset($d['visibility'][$tf]) || !is_bool($d['visibility'][$tf])) {
                jsonError("Visibility.$tf must be true or false.");
            }
            $visibility[$tf] = $d['visibility'][$tf];
        }
        if (count($d['visibility']) !== count(self::TIMEFRAMES)) jsonError('Visibility has an unrecognised timeframe.');

        $known = ['atrMult', 'showSwings', 'showBreaks', 'showLevels', 'showBadge', 'bullColor', 'bearColor', 'unclearColor', 'labelSize', 'visibility'];
        foreach (array_keys($d) as $k) if (!in_array($k, $known, true)) jsonError("Unrecognised setting: $k");

        return [
            'atrMult' => $atrMult,
            'showSwings' => $d['showSwings'],
            'showBreaks' => $d['showBreaks'],
            'showLevels' => $d['showLevels'],
            'showBadge' => $d['showBadge'],
            'bullColor' => strtoupper($d['bullColor']),
            'bearColor' => strtoupper($d['bearColor']),
            'unclearColor' => strtoupper($d['unclearColor']),
            'labelSize' => $d['labelSize'],
            'visibility' => $visibility,
        ];
    }

    /** AS new / new.settings_json (MySQL 8.0.19+ row-alias syntax) — same non-deprecated
     *  ON DUPLICATE KEY UPDATE pattern as BacktestDrawingController::saveDefault(). */
    public function save() {
        $d = jsonInput();
        $settings = $this->validate(is_array($d) ? $d : []);

        $this->db->prepare(
            "INSERT INTO user_indicator_settings (user_id, indicator, settings_json) VALUES (?,?,?)
             AS new ON DUPLICATE KEY UPDATE settings_json = new.settings_json"
        )->execute([$this->uid, self::INDICATOR, json_encode($settings)]);

        jsonResponse(['success' => true, 'settings' => $settings]);
    }
}
