<?php
/**
 * FundedControl — Shared Helper Functions
 * Used by all controllers. Never put business logic here.
 */

/**
 * CSRF Protection — validates Origin/Referer on form POSTs
 */
function csrfCheck() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') return;
    $content_type = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
    if (stripos($content_type, 'application/json') !== false) return;
    $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    $host    = $_SERVER['HTTP_HOST'] ?? '';
    $allowed = false;
    if ($origin && parse_url($origin, PHP_URL_HOST) === $host) $allowed = true;
    if (!$allowed && $referer && parse_url($referer, PHP_URL_HOST) === $host) $allowed = true;
    if (!$allowed) {
        http_response_code(403);
        echo json_encode(['error' => 'Request blocked — invalid origin']);
        exit;
    }
}

/**
 * Sanitize numeric input — always returns float
 */
function num($val, $default = 0) {
    if ($val === null || $val === '') return $default;
    return floatval($val);
}

/**
 * Validate ID — must be positive integer
 */
function validId($val) {
    return filter_var($val, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
}

/**
 * Get safe media directory for user uploads
 */
function safeMediaDir($user_id) {
    $dir = dirname(__DIR__) . '/media/uploads/' . intval($user_id) . '/';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    return $dir;
}

/**
 * Handle screenshot upload with size + MIME validation
 * Returns: filename on success, null if no file, false on error
 */
function handleScreenshot($uid) {
    if (empty($_FILES['screenshot']) || $_FILES['screenshot']['error'] !== UPLOAD_ERR_OK) return null;
    $file = $_FILES['screenshot'];
    if ($file['size'] > 5 * 1024 * 1024) return false;
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg','jpeg','png','gif','webp'])) return false;
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    if (!in_array($mime, ['image/jpeg','image/png','image/gif','image/webp'])) return false;
    $fn = 'trade_' . bin2hex(random_bytes(16)) . '.' . $ext;
    $media_dir = safeMediaDir($uid);
    if (move_uploaded_file($file['tmp_name'], $media_dir . $fn)) return $fn;
    return false;
}

/**
 * Get active challenge for current user
 */
function getActiveChallenge() {
    $db = getDB();
    $uid = uid();
    $s = $db->prepare("SELECT * FROM challenges WHERE user_id=? AND is_active=1 LIMIT 1");
    $s->execute([$uid]);
    $ch = $s->fetch() ?: null;
    return $ch ? enrichChallenge($db, $ch) : null;
}

/**
 * v3.13.0 — challenges.current_balance was a stored column nothing ever recalculated,
 * and it drifted silently for five weeks on the Bitfunded Altcoin challenge (see
 * CLAUDE.md). The column is gone; balance is derived here, every time, from
 * starting_balance + realised net P&L (closed trades only) - funding_adjustment, and
 * written back onto the array under the same 'current_balance' key so every existing
 * caller (PHP and the JSON API surface JS reads) keeps working unchanged.
 *
 * max_drawdown_pct / profit_target_pct are similarly overridden — as a percentage of
 * starting_balance — whenever max_loss_amt / profit_target_amt is on file. Some prop
 * firms (Bitfunded included) state challenge criteria as currency amounts per stage, not
 * percentages; where an amount is known it is the source of truth, not the stored pct
 * column (which stays as-is, and remains authoritative, for challenges/prop firms where
 * only a percentage was ever given).
 *
 * Call this on every challenge row before it reaches a controller response or a
 * review-engine calculation. Never read challenges.current_balance directly — there is
 * nothing left to read; the column was dropped in 2026_09_17_0004.
 */
function enrichChallenge($db, $challenge) {
    if (!$challenge) return $challenge;
    $starting = (float)($challenge['starting_balance'] ?? 0);
    $funding  = (float)($challenge['funding_adjustment'] ?? 0);
    $s = $db->prepare("SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id=? AND result IN ('Win','Loss','Break Even')");
    $s->execute([$challenge['id']]);
    $realised = (float)$s->fetchColumn();
    $challenge['current_balance'] = round($starting + $realised - $funding, 2);

    $maxLossAmt = $challenge['max_loss_amt'] ?? null;
    if ($starting > 0 && $maxLossAmt !== null && (float)$maxLossAmt > 0) {
        $challenge['max_drawdown_pct'] = round((float)$maxLossAmt / $starting * 100, 4);
    }
    $profitTargetAmt = $challenge['profit_target_amt'] ?? null;
    if ($starting > 0 && $profitTargetAmt !== null && (float)$profitTargetAmt > 0) {
        $challenge['profit_target_pct'] = round((float)$profitTargetAmt / $starting * 100, 4);
    }
    return $challenge;
}

/**
 * Apply enrichChallenge() to a list of challenge rows (ChallengeController::getAll(),
 * ReviewEngineController::userChallengeMap()) — same derivation, once per row.
 */
function enrichChallenges($db, array $challenges) {
    foreach ($challenges as &$c) $c = enrichChallenge($db, $c);
    unset($c);
    return $challenges;
}

/**
 * Read JSON POST body
 */
function jsonInput() {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

/**
 * Send JSON response and exit
 */
function jsonResponse($data) {
    echo json_encode($data);
    exit;
}

/**
 * Send error JSON response and exit
 */
function jsonError($msg, $code = 200) {
    if ($code !== 200) http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}
