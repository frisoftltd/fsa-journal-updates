<?php
/**
 * FundedControl — Alert Controller (v3.4.4)
 * Handles: get_alerts — uses active challenge settings
 * Fixed: consecutive losses message depends on whether they happened today or across days
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

        // $ch already comes from getActiveChallenge(), which derives current_balance and
        // (when max_loss_amt is on file, as it now is for Bitfunded Altcoin) an
        // amount-based max_drawdown_pct — see helpers.php::enrichChallenge(). Reading
        // these two columns here needs no further amount-preference logic of its own.
        $starting_bal = floatval($ch['starting_balance'] ?? 10000);
        $daily_limit  = floatval($ch['daily_loss_limit'] ?? 500);
        $max_dd_pct   = floatval($ch['max_drawdown_pct'] ?? 10);

        // Always static (helpers.php::staticDrawdownPct()), regardless of the challenge's
        // own drawdown_type (added v3.14.7) — this threshold protects the account against
        // its actual Maximum Loss rule, which for every prop firm seen in this codebase so
        // far (Bitfunded included) is measured from starting_balance, not a trailing peak.
        $dd_pct = staticDrawdownPct($ch);
        $daily_pct = ($daily_limit > 0)
            ? abs(min(0, $today)) / $daily_limit * 100 : 0;

        if ($daily_pct >= 100)    $alerts[] = ['type' => 'danger',  'icon' => '🛑', 'msg' => 'DAILY LOSS LIMIT REACHED — STOP TRADING TODAY'];
        elseif ($daily_pct >= 80) $alerts[] = ['type' => 'warning', 'icon' => '⚠️', 'msg' => 'At ' . round($daily_pct) . '% of daily loss limit — be careful'];

        if ($dd_pct >= $max_dd_pct)           $alerts[] = ['type' => 'danger',  'icon' => '💀', 'msg' => 'MAX DRAWDOWN REACHED — Account at risk'];
        elseif ($dd_pct >= $max_dd_pct * 0.8) $alerts[] = ['type' => 'warning', 'icon' => '⚠️', 'msg' => 'Drawdown at ' . round($dd_pct, 1) . '% — approaching limit of ' . $max_dd_pct . '%'];

        if ($tc >= 2) $alerts[] = ['type' => 'info', 'icon' => 'ℹ️', 'msg' => 'You have taken ' . $tc . ' trades today — max recommended is 2'];

        // Consecutive losses — TODAY only, as of v3.17.1. The non-same-day "🚨 3
        // consecutive losses — review your setups before the next trade" warning (this
        // controller's original v3.4.4 behavior) is deleted, not replaced: the
        // calculator's live status strip (Losses today X/Y, driven by
        // challenge_limits — see CLAUDE.md v3.17.0) is now the one place trade-limit
        // signals live. The same-day 🛑 danger banner below is a different, more urgent
        // signal (an active losing streak right now, not a lookback across days) and was
        // not named in the v3.17.1 briefing, so it's kept.
        $last3 = $this->db->prepare("SELECT result, trade_date FROM trades WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL) AND result IN ('Win','Loss') ORDER BY trade_date DESC, id DESC LIMIT 3");
        $last3->execute([$this->uid, $chId]);
        $r3 = $last3->fetchAll();
        if (count($r3) >= 3 && $r3[0]['result'] === 'Loss' && $r3[1]['result'] === 'Loss' && $r3[2]['result'] === 'Loss') {
            $todayDate = date('Y-m-d');
            $allToday = ($r3[0]['trade_date'] === $todayDate && $r3[1]['trade_date'] === $todayDate && $r3[2]['trade_date'] === $todayDate);
            if ($allToday) {
                $alerts[] = ['type' => 'danger', 'icon' => '🛑', 'msg' => '3 consecutive losses TODAY — stop trading, protect your account'];
            }
        }

        jsonResponse($alerts);
    }
}
