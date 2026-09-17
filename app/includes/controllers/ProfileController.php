
<?php
/**
 * FundedControl — Profile Controller
 * Handles: get_user, update_profile, update_settings (backward compat)
 */
class ProfileController {
    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getUser() {
        $u = currentUser();
        $ch = getActiveChallenge();
        jsonResponse([
            'id'                  => $u['id'],
            'username'            => $u['username'],
            'display_name'        => $u['display_name'],
            'avatar_color'        => $u['avatar_color'],
            'bio'                 => $u['bio'] ?? '',
            'account_balance'     => $ch['current_balance'] ?? $u['account_balance'] ?? 10000,
            'starting_balance'    => $ch['starting_balance'] ?? $u['starting_balance'] ?? 10000,
            'max_drawdown_pct'    => $ch['max_drawdown_pct'] ?? $u['max_drawdown_pct'] ?? 10,
            'daily_loss_limit'    => $ch['daily_loss_limit'] ?? $u['daily_loss_limit'] ?? 500,
            'risk_per_trade_pct'  => $ch['risk_per_trade_pct'] ?? $u['risk_per_trade_pct'] ?? 0.5,
            'prop_firm'           => $ch['prop_firm'] ?? $u['prop_firm'] ?? '',
            'challenge_phase'     => $ch['challenge_phase'] ?? $u['challenge_phase'] ?? '',
            'profit_target_pct'   => $ch['profit_target_pct'] ?? 8,
            'active_challenge_id' => $ch['id'] ?? null,
            'active_challenge_name' => $ch['name'] ?? 'Default',
            'password'            => $u['password'] ?? '',
        ]);
    }

    public function updateProfile() {
        $d = jsonInput();
        if (!$d) jsonError('Invalid request');

        if (!empty($d['new_password'])) {
            if (empty($d['current_password'])) jsonError('Current password required');
            $u = currentUser();
            if (!password_verify($d['current_password'], $u['password'])) jsonError('Current password is incorrect');
        }

        $this->db->prepare("UPDATE users SET display_name=?, avatar_color=?, bio=? WHERE id=?")
            ->execute([$d['display_name'] ?? null, $d['avatar_color'] ?? '#4f7cff', $d['bio'] ?? '', $this->uid]);

        if (!empty($d['new_password'])) {
            $this->db->prepare("UPDATE users SET password=? WHERE id=?")
                ->execute([password_hash($d['new_password'], PASSWORD_DEFAULT), $this->uid]);
        }
        jsonResponse(['success' => true]);
    }

    /**
     * Backward compatible — updates both profile and active challenge
     */
    public function updateSettings() {
        $d = jsonInput();
        if (!$d) jsonError('Invalid request');

        if (!empty($d['new_password'])) {
            if (empty($d['current_password'])) jsonError('Current password required');
            $u = currentUser();
            if (!password_verify($d['current_password'], $u['password'])) jsonError('Current password is incorrect');
        }

        $this->db->prepare("UPDATE users SET display_name=?, avatar_color=?, bio=? WHERE id=?")
            ->execute([$d['display_name'] ?? null, $d['avatar_color'] ?? '#4f7cff', $d['bio'] ?? '', $this->uid]);

        if (!empty($d['new_password'])) {
            $this->db->prepare("UPDATE users SET password=? WHERE id=?")
                ->execute([password_hash($d['new_password'], PASSWORD_DEFAULT), $this->uid]);
        }

        $ch = getActiveChallenge();
        if ($ch) {
            // account_balance is no longer accepted here — current_balance was dropped in
            // 2026_09_17_0004 and is now always derived from trades (see
            // helpers.php::enrichChallenge()). A value submitted for it is silently
            // ignored rather than written anywhere, the same way a legacy client
            // submitting a field this API no longer has would be.
            $this->db->prepare("UPDATE challenges SET prop_firm=?, challenge_phase=?, starting_balance=?, max_drawdown_pct=?, daily_loss_limit=?, risk_per_trade_pct=? WHERE id=? AND user_id=?")
                ->execute([
                    $d['prop_firm'] ?? $ch['prop_firm'],
                    $d['challenge_phase'] ?? $ch['challenge_phase'],
                    num($d['starting_balance'] ?? $ch['starting_balance']),
                    num($d['max_drawdown_pct'] ?? $ch['max_drawdown_pct']),
                    num($d['daily_loss_limit'] ?? $ch['daily_loss_limit']),
                    num($d['risk_per_trade_pct'] ?? $ch['risk_per_trade_pct']),
                    $ch['id'], $this->uid
                ]);
        }
        jsonResponse(['success' => true]);
    }
}
