
<?php
/**
 * FundedControl — Alert Controller
 * Handles: get_alerts — uses active challenge settings
 */
class AlertController {
    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getAlerts() {
        $ch = getActiveChallenge();
        $chId = $ch['id'] ?? 0;
        $alerts = [];

        $stmt = $this->db->prepare("SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL) AND trade_date=CURDATE()");
        $stmt->execute([$this->uid, $chId]);
        $today = floatval($stmt->fetchColumn());

        $stmt2 = $this->db->prepare("SELECT COUNT(*) FROM trades WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL) AND trade_date=CURDATE()");
        $stmt2->execute([$this->uid, $chId]);
        $tc = intval($stmt2->fetchColumn());

        $starting_bal = floatval($ch['starting_balance'] ?? 10000);
        $daily_limit  = floatval($ch['daily_loss_limit'] ?? 500);
        $max_dd_pct   = floatval($ch['max_drawdown_pct'] ?? 10);

        $dd_pct = ($starting_bal > 0)
            ? abs(min(0, floatval($ch['current_balance'] ?? $starting_bal) - $starting_bal)) / $starting_bal * 100 : 0;
        $daily_pct = ($daily_limit > 0)
            ? abs(min(0, $today)) / $daily_limit * 100 : 0;

        if ($daily_pct >= 100)    $alerts[] = ['type' => 'danger',  'icon' => '🛑', 'msg' => 'DAILY LOSS LIMIT REACHED — STOP TRADING TODAY'];
        elseif ($daily_pct >= 80) $alerts[] = ['type' => 'warning', 'icon' => '⚠️', 'msg' => 'At ' . round($daily_pct) . '% of daily loss limit — be careful'];

        if ($dd_pct >= $max_dd_pct)           $alerts[] = ['type' => 'danger',  'icon' => '💀', 'msg' => 'MAX DRAWDOWN REACHED — Account at risk'];
        elseif ($dd_pct >= $max_dd_pct * 0.8) $alerts[] = ['type' => 'warning', 'icon' => '⚠️', 'msg' => 'Drawdown at ' . round($dd_pct, 1) . '% — approaching limit of ' . $max_dd_pct . '%'];

        if ($tc >= 2) $alerts[] = ['type' => 'info', 'icon' => 'ℹ️', 'msg' => 'You have taken ' . $tc . ' trades today — max recommended is 2'];

        // Consecutive losses
        $last3 = $this->db->prepare("SELECT result FROM trades WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL) AND result IN ('Win','Loss') ORDER BY trade_date DESC, id DESC LIMIT 3");
        $last3->execute([$this->uid, $chId]);
        $r3 = $last3->fetchAll();
        if (count($r3) >= 3 && array_sum(array_map(fn($r) => $r['result'] === 'Loss' ? 1 : 0, $r3)) >= 3)
            $alerts[] = ['type' => 'danger', 'icon' => '🚨', 'msg' => '3 consecutive losses — consider stopping for the day'];

        jsonResponse($alerts);
    }
}
