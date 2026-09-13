
<?php
/**
 * FundedControl — Import Controller
 * Handles: import_trades — imports to active challenge
 */
class ImportController {
    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function import() {
        $ch = getActiveChallenge();
        $chId = $ch['id'] ?? null;
        $d = jsonInput();
        $trades = $d['trades'] ?? [];

        if (count($trades) > 500) jsonError('Import limit is 500 trades per batch');

        $count = 0;
        foreach ($trades as $t) {
            if (empty($t['trade_date']) || empty($t['pair']) || empty($t['direction'])) continue;
            $pnl  = num($t['pnl'] ?? 0);
            $fees = num($t['fees'] ?? 0);
            $net  = $pnl - $fees;
            $this->db->prepare("INSERT INTO trades (user_id,challenge_id,trade_date,session,pair,direction,entry_price,stop_loss,take_profit,exit_price,lot_size,pnl,fees,net_pnl,r_multiple,result,confidence,exec_score,fib_level,fsa_rules,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
                ->execute([$this->uid, $chId, $t['trade_date'], !empty($t['session']) ? $t['session'] : null, $t['pair'], $t['direction'], $t['entry_price'] ?? null, $t['stop_loss'] ?? null, $t['take_profit'] ?? null, $t['exit_price'] ?? null, $t['lot_size'] ?? null, $pnl, $fees, $net, num($t['r_multiple'] ?? 0), $t['result'] ?? null, $t['confidence'] ?? null, $t['exec_score'] ?? null, $t['fib_level'] ?? null, $t['fsa_rules'] ?? null, $t['notes'] ?? null]);
            $count++;
        }
        jsonResponse(['success' => true, 'imported' => $count]);
    }
}
