
<?php
/**
 * FundedControl — Strategy Builder Controller
 * Handles: get_strategies, add_strategy, update_strategy, delete_strategy, save_strategy_vars
 * User-defined strategies, each with up to 5 custom variables. Separate from
 * StrategyController (strategy_tests sandbox) — do not merge.
 */
class StrategyBuilderController {
    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getAll() {
        $s = $this->db->prepare("SELECT * FROM strategies WHERE user_id=? ORDER BY created_at DESC");
        $s->execute([$this->uid]);
        $strategies = $s->fetchAll();

        $v = $this->db->prepare("SELECT id,strategy_id,label,input_type,options,sort_order FROM strategy_variables WHERE strategy_id=? ORDER BY sort_order ASC, id ASC");
        foreach ($strategies as &$st) {
            $v->execute([$st['id']]);
            $st['variables'] = $v->fetchAll();
        }
        jsonResponse($strategies);
    }

    public function add() {
        $d = jsonInput();
        if (empty($d['name'])) jsonError('Strategy name required');
        $this->db->prepare("INSERT INTO strategies (user_id, name) VALUES (?, ?)")
            ->execute([$this->uid, trim($d['name'])]);
        jsonResponse(['success' => true, 'id' => $this->db->lastInsertId()]);
    }

    public function update() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid strategy ID');

        $owns = $this->db->prepare("SELECT id FROM strategies WHERE id=? AND user_id=?");
        $owns->execute([$id, $this->uid]);
        if (!$owns->fetch()) jsonError('Strategy not found');

        $name = array_key_exists('name', $d) ? trim($d['name']) : null;
        if ($name === '') $name = null;
        $is_active = array_key_exists('is_active', $d) ? (int)!!$d['is_active'] : null;

        $this->db->prepare("UPDATE strategies SET name=COALESCE(?,name), is_active=COALESCE(?,is_active) WHERE id=? AND user_id=?")
            ->execute([$name, $is_active, $id, $this->uid]);
        jsonResponse(['success' => true]);
    }

    public function delete() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid strategy ID');

        $owns = $this->db->prepare("SELECT id FROM strategies WHERE id=? AND user_id=?");
        $owns->execute([$id, $this->uid]);
        if (!$owns->fetch()) jsonError('Strategy not found');

        $this->db->prepare("DELETE FROM strategy_variables WHERE strategy_id=?")->execute([$id]);
        $this->db->prepare("DELETE FROM strategies WHERE id=? AND user_id=?")->execute([$id, $this->uid]);
        jsonResponse(['success' => true]);
    }

    public function saveVariables() {
        $d = jsonInput();
        $strategyId = validId($d['strategy_id'] ?? 0);
        if (!$strategyId) jsonError('Invalid strategy ID');

        $owns = $this->db->prepare("SELECT id FROM strategies WHERE id=? AND user_id=?");
        $owns->execute([$strategyId, $this->uid]);
        if (!$owns->fetch()) jsonError('Strategy not found');

        $variables = $d['variables'] ?? [];
        if (!is_array($variables)) jsonError('Invalid variables payload');
        if (count($variables) > 5) jsonError('Maximum 5 variables per strategy');

        $allowedTypes = ['checkbox', 'scale', 'select', 'text'];

        $this->db->prepare("DELETE FROM strategy_variables WHERE strategy_id=?")->execute([$strategyId]);

        $insert = $this->db->prepare("INSERT INTO strategy_variables (strategy_id,label,input_type,options,sort_order) VALUES (?,?,?,?,?)");
        $order = 0;
        foreach ($variables as $v) {
            $label = trim($v['label'] ?? '');
            if ($label === '') continue;
            $type = in_array($v['input_type'] ?? '', $allowedTypes, true) ? $v['input_type'] : 'checkbox';
            $options = $type === 'select' ? ($v['options'] ?? null) : null;
            $insert->execute([$strategyId, $label, $type, $options, $order]);
            $order++;
        }
        jsonResponse(['success' => true]);
    }
}
