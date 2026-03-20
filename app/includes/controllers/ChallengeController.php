
<?php
/**
 * FundedControl — Challenge Controller
 * Handles: get_challenges, get_active, add, update, delete, switch
 */
class ChallengeController {
    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getAll() {
        $s = $this->db->prepare("SELECT * FROM challenges WHERE user_id=? ORDER BY is_active DESC, created_at DESC");
        $s->execute([$this->uid]);
        jsonResponse($s->fetchAll());
    }

    public function getActive() {
        $ch = getActiveChallenge();
        jsonResponse($ch ?: ['error' => 'No active challenge']);
    }

    public function add() {
        $d = jsonInput();
        if (empty($d['name'])) jsonError('Challenge name required');

        $existing = $this->db->prepare("SELECT COUNT(*) FROM challenges WHERE user_id=?");
        $existing->execute([$this->uid]);
        $count = intval($existing->fetchColumn());
        $make_active = ($count === 0 || !empty($d['set_active']));

        if ($make_active) {
            $this->db->prepare("UPDATE challenges SET is_active=0 WHERE user_id=?")->execute([$this->uid]);
        }

        $this->db->prepare("INSERT INTO challenges (user_id, name, prop_firm, challenge_phase, starting_balance, current_balance, max_drawdown_pct, daily_loss_limit, risk_per_trade_pct, profit_target_pct, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                $this->uid, trim($d['name']),
                $d['prop_firm'] ?? '', $d['challenge_phase'] ?? 'Phase 1',
                num($d['starting_balance'] ?? 10000), num($d['current_balance'] ?? $d['starting_balance'] ?? 10000),
                num($d['max_drawdown_pct'] ?? 10), num($d['daily_loss_limit'] ?? 500),
                num($d['risk_per_trade_pct'] ?? 0.5), num($d['profit_target_pct'] ?? 8),
                $make_active ? 1 : 0
            ]);
        jsonResponse(['success' => true, 'id' => $this->db->lastInsertId()]);
    }

    public function update() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid challenge ID');
        if (empty($d['name'])) jsonError('Challenge name required');

        $this->db->prepare("UPDATE challenges SET name=?, prop_firm=?, challenge_phase=?, starting_balance=?, current_balance=?, max_drawdown_pct=?, daily_loss_limit=?, risk_per_trade_pct=?, profit_target_pct=?, status=? WHERE id=? AND user_id=?")
            ->execute([
                trim($d['name']), $d['prop_firm'] ?? '', $d['challenge_phase'] ?? 'Phase 1',
                num($d['starting_balance'] ?? 10000), num($d['current_balance'] ?? 10000),
                num($d['max_drawdown_pct'] ?? 10), num($d['daily_loss_limit'] ?? 500),
                num($d['risk_per_trade_pct'] ?? 0.5), num($d['profit_target_pct'] ?? 8),
                $d['status'] ?? 'active', $id, $this->uid
            ]);
        jsonResponse(['success' => true]);
    }

    public function delete() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid challenge ID');

        $count = $this->db->prepare("SELECT COUNT(*) FROM challenges WHERE user_id=?");
        $count->execute([$this->uid]);
        if (intval($count->fetchColumn()) <= 1) jsonError('Cannot delete your only challenge');

        $ch = $this->db->prepare("SELECT is_active FROM challenges WHERE id=? AND user_id=?");
        $ch->execute([$id, $this->uid]);
        $row = $ch->fetch();
        if (!$row) jsonError('Challenge not found');
        $was_active = $row['is_active'] ?? 0;

        $this->db->prepare("DELETE FROM trades WHERE challenge_id=? AND user_id=?")->execute([$id, $this->uid]);
        $this->db->prepare("DELETE FROM challenges WHERE id=? AND user_id=?")->execute([$id, $this->uid]);

        if ($was_active) {
            $next = $this->db->prepare("SELECT id FROM challenges WHERE user_id=? ORDER BY created_at DESC LIMIT 1");
            $next->execute([$this->uid]);
            $nextId = $next->fetchColumn();
            if ($nextId) $this->db->prepare("UPDATE challenges SET is_active=1 WHERE id=?")->execute([$nextId]);
        }
        jsonResponse(['success' => true]);
    }

    public function switchTo() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid challenge ID');

        $ch = $this->db->prepare("SELECT id FROM challenges WHERE id=? AND user_id=?");
        $ch->execute([$id, $this->uid]);
        if (!$ch->fetch()) jsonError('Challenge not found');

        $this->db->prepare("UPDATE challenges SET is_active=0 WHERE user_id=?")->execute([$this->uid]);
        $this->db->prepare("UPDATE challenges SET is_active=1 WHERE id=? AND user_id=?")->execute([$id, $this->uid]);
        jsonResponse(['success' => true]);
    }
}
