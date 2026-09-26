<?php
/**
 * FundedControl — Backtest Drawing Tools Controller (v3.21.0)
 * Handles: get_backtest_drawings, add_backtest_drawing, update_backtest_drawing,
 *          delete_backtest_drawing
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
 *     settings={levels:[{ratio,enabled,color},...], extend_right, reverse, show_price, color, width}
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

        $s = $this->db->prepare("SELECT id, tool, points, settings FROM backtest_drawings WHERE session_id=? ORDER BY id ASC");
        $s->execute([$sessionId]);
        jsonResponse(array_map(function ($r) {
            return [
                'id' => (int) $r['id'],
                'tool' => $r['tool'],
                'points' => json_decode($r['points'], true) ?? [],
                'settings' => json_decode($r['settings'], true) ?? [],
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
}
