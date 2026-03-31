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
    return $s->fetch() ?: null;
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
