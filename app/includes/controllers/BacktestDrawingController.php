<?php
/**
 * FundedControl — Backtest Drawing Tools Controller (v3.21.0)
 * Handles: get_backtest_drawings, add_backtest_drawing, update_backtest_drawing,
 *          delete_backtest_drawing
 *
 * v3.21.12 also handles: get_drawing_defaults, save_drawing_default,
 * reset_drawing_default — per-user, per-tool saved settings ("Save as default"/"Reset
 * to default" on the fib retracement tool's settings panel this release). These read/
 * write user_drawing_defaults, a separate table keyed on (user_id, tool) only — no
 * session_id, since a default belongs to the user across every session, not one replay.
 * Ownership here is direct (user_id IS the owner, no session to resolve through, unlike
 * backtest_drawings below), so these three methods scope every query to $this->uid
 * themselves rather than via assertOwnedSession().
 *
 * Pure CRUD over backtest_drawings — no simulation logic, no lookahead implications.
 * Drawings are user annotations only and are never read by BacktestController's own
 * replay/order/challenge-rule engine, exactly per the briefing's own constraint.
 * Ownership is always checked through the parent session (backtest_sessions.user_id),
 * the same pattern BacktestController itself uses, rather than trusting a drawing's own
 * user_id column blindly.
 *
 * points/settings are stored as JSON text — MySQL's native JSON column type validates
 * well-formedness but not shape, and this controller doesn't validate tool-specific
 * shape beyond "is it a non-empty array" either. The shape contract lives entirely with
 * js/backtest-drawings.js, which both writes and reads it; malformed tool-specific data
 * would only ever break that one drawing's own rendering, never anything server-side.
 * Each tool's own shape, for reference:
 *   position_long / position_short — points=[{time},{time}] (the drawn horizontal span);
 *     settings={entry, stop_loss, take_profit, rr_locked, rr_ratio, color}
 *   fib_retracement — points=[{time,price},{time,price}] (the two swing anchors);
 *     settings={levels:[{ratio,enabled,color},...], show_trend_line, trend_color,
 *       trend_style, width, style, extend ('none'/'right'/'both'), reverse, show_prices,
 *       show_levels, levels_format ('value'/'percent'), label_h ('left'/'right'),
 *       label_v ('top'/'middle'/'bottom'), font_size, background, background_opacity}
 *       (v3.21.2 — replaces the v3.21.0 shape's extend_right/show_price/color fields;
 *       this controller never validates tool-specific shape either way, so no migration
 *       was needed for the rename)
 *   trend_line — points=[{time,price},{time,price}];
 *     settings={color, width, style, extend_left, extend_right, show_price_label, show_angle_label}
 *   horizontal_line / horizontal_ray — points=[{time,price}] (one anchor — a ray starts
 *     there and extends right; a line's own time is otherwise unused, decorative only);
 *     settings={color, width, style}
 */
class BacktestDrawingController {
    private $db;
    private $uid;

    const TOOLS = ['position_long', 'position_short', 'fib_retracement', 'trend_line', 'horizontal_line', 'horizontal_ray'];

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    private function assertOwnedSession(int $sessionId): void {
        $s = $this->db->prepare("SELECT id FROM backtest_sessions WHERE id=? AND user_id=?");
        $s->execute([$sessionId, $this->uid]);
        if (!$s->fetch()) jsonError('Backtest session not found.');
    }

    public function getAll() {
        $sessionId = validId($_GET['session_id'] ?? 0);
        if (!$sessionId) jsonError('Invalid session id.');
        $this->assertOwnedSession($sessionId);

        $s = $this->db->prepare("SELECT id, tool, points, settings, linked_trade_id, linked_order_id FROM backtest_drawings WHERE session_id=? ORDER BY id ASC");
        $s->execute([$sessionId]);
        jsonResponse(array_map(function ($r) {
            return [
                'id' => (int) $r['id'],
                'tool' => $r['tool'],
                'points' => json_decode($r['points'], true) ?? [],
                'settings' => json_decode($r['settings'], true) ?? [],
                // v3.22.3 Part C — js/backtest-drawings.js suppresses this drawing's own
                // box/pills whenever either is set: the running trade display (drawn
                // from the session's own open_positions/pending_orders) is the one
                // on-chart representation of a drawing that actually placed an order.
                'linked_trade_id' => $r['linked_trade_id'] !== null ? (int) $r['linked_trade_id'] : null,
                'linked_order_id' => $r['linked_order_id'] !== null ? (int) $r['linked_order_id'] : null,
            ];
        }, $s->fetchAll()));
    }

    public function add() {
        $d = jsonInput();
        $sessionId = validId($d['session_id'] ?? 0);
        if (!$sessionId) jsonError('Invalid session id.');
        $this->assertOwnedSession($sessionId);

        $tool = trim((string) ($d['tool'] ?? ''));
        if (!in_array($tool, self::TOOLS, true)) jsonError('Invalid tool.');
        $points = $d['points'] ?? null;
        if (!is_array($points) || empty($points)) jsonError('A drawing needs at least one anchor point.');
        $settings = $d['settings'] ?? [];
        if (!is_array($settings)) jsonError('Invalid settings.');

        $this->db->prepare(
            "INSERT INTO backtest_drawings (user_id, session_id, tool, points, settings) VALUES (?,?,?,?,?)"
        )->execute([$this->uid, $sessionId, $tool, json_encode($points), json_encode($settings)]);

        jsonResponse(['success' => true, 'id' => (int) $this->db->lastInsertId()]);
    }

    /** Used both for dragging a handle (updates points) and for the settings popover
     *  (updates settings) — either or both keys may be present; only what's given is
     *  written, so a points-only drag never has to resend the full settings object. */
    public function update() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid drawing id.');
        $row = $this->db->prepare("SELECT bd.id FROM backtest_drawings bd JOIN backtest_sessions bs ON bs.id=bd.session_id WHERE bd.id=? AND bs.user_id=?");
        $row->execute([$id, $this->uid]);
        if (!$row->fetch()) jsonError('Drawing not found.');

        $sets = [];
        $params = [];
        if (isset($d['points'])) {
            if (!is_array($d['points']) || empty($d['points'])) jsonError('Invalid points.');
            $sets[] = 'points=?';
            $params[] = json_encode($d['points']);
        }
        if (isset($d['settings'])) {
            if (!is_array($d['settings'])) jsonError('Invalid settings.');
            $sets[] = 'settings=?';
            $params[] = json_encode($d['settings']);
        }
        // v3.22.3 Part C — set once in the Place Trade path (js/backtest.js::
        // btLinkDrawingToOrder()), never cleared back to null again by this endpoint;
        // array_key_exists (not isset) so an explicit `null` -- the limit-order-fills-
        // into-a-trade case, which clears linked_order_id while setting linked_trade_id
        // in the SAME call -- is still honoured, not silently skipped the way isset()
        // would treat it.
        if (array_key_exists('linked_trade_id', $d)) {
            $sets[] = 'linked_trade_id=?';
            $params[] = $d['linked_trade_id'] !== null ? validId($d['linked_trade_id']) : null;
        }
        if (array_key_exists('linked_order_id', $d)) {
            $sets[] = 'linked_order_id=?';
            $params[] = $d['linked_order_id'] !== null ? validId($d['linked_order_id']) : null;
        }
        if (!$sets) jsonError('Nothing to update.');
        $params[] = $id;
        $this->db->prepare('UPDATE backtest_drawings SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        jsonResponse(['success' => true]);
    }

    public function delete() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid drawing id.');
        $row = $this->db->prepare("SELECT bd.id FROM backtest_drawings bd JOIN backtest_sessions bs ON bs.id=bd.session_id WHERE bd.id=? AND bs.user_id=?");
        $row->execute([$id, $this->uid]);
        if (!$row->fetch()) jsonError('Drawing not found.');
        $this->db->prepare("DELETE FROM backtest_drawings WHERE id=?")->execute([$id]);
        jsonResponse(['success' => true]);
    }

    /** {tool: settings} for every tool this user has ever saved a default for — omits
     *  any tool with no saved row entirely, rather than a null/empty placeholder, so the
     *  frontend's own merge (BT_TOOL_DEFAULTS[tool] deep-merged with this) can tell
     *  "never saved" apart from "saved as empty" by simple key presence. */
    public function getDefaults() {
        $s = $this->db->prepare("SELECT tool, settings FROM user_drawing_defaults WHERE user_id=?");
        $s->execute([$this->uid]);
        $out = [];
        foreach ($s->fetchAll() as $r) {
            $out[$r['tool']] = json_decode($r['settings'], true) ?? [];
        }
        jsonResponse($out);
    }

    /** Writes this user's default settings for one tool. Never touches backtest_drawings
     *  — an existing drawing is never modified by saving a default, per the briefing's own
     *  constraint. AS new / new.settings (MySQL 8.0.19+ row-alias syntax, confirmed
     *  supported on this project's live MySQL 8.4 host) is the non-deprecated replacement
     *  for the old VALUES() function inside ON DUPLICATE KEY UPDATE. */
    public function saveDefault() {
        $d = jsonInput();
        $tool = trim((string) ($d['tool'] ?? ''));
        if (!in_array($tool, self::TOOLS, true)) jsonError('Invalid tool.');
        $settings = $d['settings'] ?? null;
        if (!is_array($settings) || empty($settings)) jsonError('Invalid settings.');

        $this->db->prepare(
            "INSERT INTO user_drawing_defaults (user_id, tool, settings) VALUES (?,?,?)
             AS new ON DUPLICATE KEY UPDATE settings = new.settings"
        )->execute([$this->uid, $tool, json_encode($settings)]);

        jsonResponse(['success' => true]);
    }

    /** Deletes this user's saved default for one tool. A no-op, not an error, when no
     *  default was saved for it — "reset to the code default" is correct either way, and
     *  the row simply not existing yet is not a failure worth surfacing. Never touches
     *  backtest_drawings — no existing drawing is affected. */
    public function resetDefault() {
        $d = jsonInput();
        $tool = trim((string) ($d['tool'] ?? ''));
        if (!in_array($tool, self::TOOLS, true)) jsonError('Invalid tool.');
        $this->db->prepare("DELETE FROM user_drawing_defaults WHERE user_id=? AND tool=?")->execute([$this->uid, $tool]);
        jsonResponse(['success' => true]);
    }
}
