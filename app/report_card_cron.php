<?php
/**
 * FundedControl — Report Card AI Review Cron Entry (v3.18.0)
 *
 * Standalone, token-protected, same pattern as migrate.php — this hosting (Namecheap
 * shared cPanel, no frameworks, see CLAUDE.md §1) has no job queue, so "optional nightly
 * job" and "weekly review on a schedule" (build briefing §7.3) are implemented as a URL
 * meant to be hit by a cPanel Cron Job, not real background infrastructure.
 *
 * Access: requires ?token=... matching REPORT_CARD_CRON_TOKEN, defined in
 * includes/config.php (added by hand on the server — never committed to the repo).
 *
 * Modes (query string):
 *   ?mode=nightly (default) — for every user with a 'complete' card yesterday (server's
 *                              local date) that has no review yet, runs one daily review.
 *   ?mode=weekly            — for every user with at least one card in the last 7 days,
 *                              runs one weekly review (period_end = today).
 *
 * Suggested cPanel Cron Jobs:
 *   0 22 * * *  curl -s "https://www.fundedcontrol.com/report_card_cron.php?mode=nightly&token=..."
 *   5 22 * * 0  curl -s "https://www.fundedcontrol.com/report_card_cron.php?mode=weekly&token=..."
 */

require_once __DIR__ . '/includes/config.php';
require_once __DIR__ . '/includes/helpers.php';
require_once __DIR__ . '/includes/controllers/ReportCardAiController.php';

header('Content-Type: text/plain');

$token = $_GET['token'] ?? '';
$validToken = defined('REPORT_CARD_CRON_TOKEN') && REPORT_CARD_CRON_TOKEN !== '' && hash_equals((string) REPORT_CARD_CRON_TOKEN, (string) $token);
if (!$validToken) {
    error_log(sprintf('[report_card_cron.php] Rejected request: mode=%s ip=%s time=%s', $_GET['mode'] ?? 'nightly', $_SERVER['REMOTE_ADDR'] ?? 'unknown', date('c')));
    http_response_code(403);
    echo "403 Forbidden\n";
    exit;
}

$mode = in_array($_GET['mode'] ?? 'nightly', ['nightly', 'weekly'], true) ? $_GET['mode'] : 'nightly';
$db = getDB();
$ai = new ReportCardAiController();

/** Session-independent equivalent of helpers.php::getActiveChallenge() — that function reads uid() from the session, which doesn't exist here. */
function reportCardCronActiveChallengeId(PDO $db, int $userId): int {
    $s = $db->prepare("SELECT id FROM challenges WHERE user_id=? AND is_active=1 LIMIT 1");
    $s->execute([$userId]);
    return (int)($s->fetchColumn() ?: 0);
}

$ran = 0;
$failed = 0;

if ($mode === 'nightly') {
    $yesterday = date('Y-m-d', strtotime('-1 day'));
    $s = $db->prepare(
        "SELECT rc.id AS card_id, rc.user_id, rc.challenge_id, rc.card_date
         FROM report_cards rc
         WHERE rc.card_date = ? AND rc.status = 'complete'
           AND NOT EXISTS (SELECT 1 FROM report_card_ai_reviews r WHERE r.card_id = rc.id)"
    );
    $s->execute([$yesterday]);
    foreach ($s->fetchAll() as $row) {
        $result = $ai->runFor((int)$row['user_id'], 'daily', $row['card_date'], $row['card_date'], (int)$row['card_id'], (int)$row['challenge_id']);
        $result['status'] === 'complete' ? $ran++ : $failed++;
        echo "card {$row['card_id']} (user {$row['user_id']}): {$result['status']}\n";
    }
} else {
    $end = date('Y-m-d');
    $start = date('Y-m-d', strtotime('-6 days'));
    $s = $db->prepare("SELECT DISTINCT user_id FROM report_cards WHERE card_date BETWEEN ? AND ?");
    $s->execute([$start, $end]);
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $userId) {
        $chId = reportCardCronActiveChallengeId($db, (int)$userId);
        $result = $ai->runFor((int)$userId, 'weekly', $start, $end, null, $chId);
        $result['status'] === 'complete' ? $ran++ : $failed++;
        echo "user {$userId} weekly {$start}..{$end}: {$result['status']}\n";
    }
}

echo "\nDone. {$ran} complete, {$failed} failed.\n";
