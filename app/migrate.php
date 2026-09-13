<?php
/**
 * FundedControl — Migration Runner
 *
 * Applies plain-SQL files from migrations/ against the live database, tracked
 * in a schema_migrations table. Token-protected so it is not openly reachable.
 *
 * Modes (query string):
 *   ?mode=status    (default) — list applied / pending, changes nothing
 *   ?mode=run                 — apply pending migrations, stop at first failure
 *   ?mode=baseline             — record pending migrations as applied without running them
 *
 * Access: requires ?token=... matching the MIGRATE_TOKEN constant defined in
 * includes/config.php (added by hand on the server — never committed to the repo).
 */

require_once __DIR__ . '/includes/config.php';

define('MIGRATIONS_DIR', __DIR__ . '/migrations');

// ── ACCESS CONTROL ───────────────────────────────────────
$token = $_GET['token'] ?? '';
$validToken = defined('MIGRATE_TOKEN') && MIGRATE_TOKEN !== '' && hash_equals((string) MIGRATE_TOKEN, (string) $token);

if (!$validToken) {
    error_log(sprintf(
        '[migrate.php] Rejected request: mode=%s ip=%s time=%s',
        $_GET['mode'] ?? 'status',
        $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        date('c')
    ));
    http_response_code(403);
    header('Content-Type: text/plain');
    echo "403 Forbidden\n";
    exit;
}

$mode = $_GET['mode'] ?? 'status';
if (!in_array($mode, ['status', 'run', 'baseline'], true)) {
    $mode = 'status';
}

$db = getDB();

// ── TRACKING TABLE ───────────────────────────────────────
$db->exec("
    CREATE TABLE IF NOT EXISTS schema_migrations (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        filename     VARCHAR(255) NOT NULL UNIQUE,
        checksum     CHAR(64) NOT NULL,
        applied_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        execution_ms INT NULL,
        status       ENUM('applied','failed','baselined') NOT NULL DEFAULT 'applied',
        error_message TEXT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
");

// ── SCAN MIGRATIONS DIR ──────────────────────────────────
$files = glob(MIGRATIONS_DIR . '/*.sql') ?: [];
sort($files, SORT_STRING);

$rowsByFile = [];
$stmt = $db->query("SELECT * FROM schema_migrations");
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $rowsByFile[$row['filename']] = $row;
}

$mismatches = []; // filename => [expected, actual]
$pending    = []; // filename => full path
$settled    = []; // filename => row (applied/baselined, checksum ok)

foreach ($files as $path) {
    $filename = basename($path);
    $checksum = hash('sha256', file_get_contents($path));
    $row = $rowsByFile[$filename] ?? null;

    if ($row === null) {
        $pending[$filename] = $path;
        continue;
    }

    if ($row['status'] === 'failed') {
        // A previously failed migration is retryable — content may have been fixed.
        $pending[$filename] = $path;
        continue;
    }

    // status is 'applied' or 'baselined' — checksum must still match.
    if (!hash_equals($row['checksum'], $checksum)) {
        $mismatches[$filename] = ['expected' => $row['checksum'], 'actual' => $checksum];
        continue;
    }

    $settled[$filename] = $row;
}

// A checksum mismatch means live and repo have diverged. Never apply or
// baseline anything while that's true — only 'status' may proceed to report it.
$blocked = !empty($mismatches);

$report = [
    'mode'       => $mode,
    'blocked'    => $blocked,
    'mismatches' => $mismatches,
    'settled'    => $settled,
    'pending'    => array_keys($pending),
    'results'    => [], // per-file outcome when mode=run or mode=baseline
];

if ($mode === 'baseline' && !$blocked) {
    foreach ($pending as $filename => $path) {
        $checksum = hash('sha256', file_get_contents($path));
        recordMigration($db, $filename, $checksum, 'baselined', null, null);
        $report['results'][] = ['filename' => $filename, 'status' => 'baselined'];
    }
} elseif ($mode === 'run' && !$blocked) {
    foreach ($pending as $filename => $path) {
        $sql = file_get_contents($path);
        $statements = splitSqlStatements($sql);
        $checksum = hash('sha256', $sql);

        $isDml = !containsDdl($statements);
        $start = microtime(true);
        $failedStatement = null;
        $errorMessage = null;

        try {
            if ($isDml) {
                $db->beginTransaction();
            }
            foreach ($statements as $i => $statement) {
                try {
                    $db->exec($statement);
                } catch (PDOException $e) {
                    $failedStatement = ['index' => $i + 1, 'sql' => $statement];
                    $errorMessage = $e->getMessage();
                    throw $e;
                }
            }
            if ($isDml) {
                $db->commit();
            }
        } catch (PDOException $e) {
            if ($isDml && $db->inTransaction()) {
                $db->rollBack();
            }
            $executionMs = (int) round((microtime(true) - $start) * 1000);
            recordMigration($db, $filename, $checksum, 'failed', $executionMs, $errorMessage);
            $report['results'][] = [
                'filename'   => $filename,
                'status'     => 'failed',
                'statement'  => $failedStatement,
                'error'      => $errorMessage,
            ];
            // Stop at the first failure. Nothing further is applied.
            break;
        }

        $executionMs = (int) round((microtime(true) - $start) * 1000);
        recordMigration($db, $filename, $checksum, 'applied', $executionMs, null);
        $report['results'][] = ['filename' => $filename, 'status' => 'applied', 'execution_ms' => $executionMs];
    }
}

renderReport($report);
exit;

// ── HELPERS ──────────────────────────────────────────────

function recordMigration(PDO $db, string $filename, string $checksum, string $status, ?int $executionMs, ?string $errorMessage): void
{
    $stmt = $db->prepare("
        INSERT INTO schema_migrations (filename, checksum, execution_ms, status, error_message)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            checksum = VALUES(checksum),
            applied_at = CURRENT_TIMESTAMP,
            execution_ms = VALUES(execution_ms),
            status = VALUES(status),
            error_message = VALUES(error_message)
    ");
    $stmt->execute([$filename, $checksum, $executionMs, $status, $errorMessage]);
}

/**
 * Splits a SQL file into individual statements on ';', respecting single quotes,
 * double quotes, and backtick-quoted identifiers so semicolons inside them are
 * not treated as statement terminators. Strips -- and # line comments.
 */
function splitSqlStatements(string $sql): array
{
    $statements = [];
    $current = '';
    $len = strlen($sql);
    $inString = null; // one of "'", '"', '`', or null

    for ($i = 0; $i < $len; $i++) {
        $char = $sql[$i];

        if ($inString !== null) {
            $current .= $char;
            if ($char === $inString && ($sql[$i - 1] ?? '') !== '\\') {
                $inString = null;
            }
            continue;
        }

        if ($char === "'" || $char === '"' || $char === '`') {
            $inString = $char;
            $current .= $char;
            continue;
        }

        // Line comments: -- or #
        if (($char === '-' && ($sql[$i + 1] ?? '') === '-') || $char === '#') {
            while ($i < $len && $sql[$i] !== "\n") {
                $i++;
            }
            continue;
        }

        if ($char === ';') {
            $trimmed = trim($current);
            if ($trimmed !== '') {
                $statements[] = $trimmed;
            }
            $current = '';
            continue;
        }

        $current .= $char;
    }

    $trimmed = trim($current);
    if ($trimmed !== '') {
        $statements[] = $trimmed;
    }

    return $statements;
}

function containsDdl(array $statements): bool
{
    foreach ($statements as $statement) {
        if (preg_match('/^\s*(CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i', $statement)) {
            return true;
        }
    }
    return false;
}

function renderReport(array $report): void
{
    header('Content-Type: text/html; charset=utf-8');
    $mode = htmlspecialchars($report['mode']);
    ?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FundedControl — Migration Runner</title>
<style>
body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#0B1D3A;color:#F0F3F7;padding:24px;max-width:900px;margin:0 auto}
h1{font-size:18px;margin-bottom:4px}
.mode{color:#7A8FA5;font-size:13px;margin-bottom:20px}
.card{background:#132849;border:1px solid #244066;border-radius:8px;padding:16px;margin-bottom:16px}
.card h2{font-size:14px;margin:0 0 10px}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1c3559;font-size:13px}
.row:last-child{border-bottom:none}
.ok{color:#0FA958}
.fail{color:#DC3545}
.warn{color:#F59E0B}
.muted{color:#7A8FA5}
pre{white-space:pre-wrap;word-break:break-word;background:#0B1D3A;border:1px solid #244066;padding:10px;border-radius:6px;font-size:12px;color:#F0F3F7}
code{background:#0B1D3A;padding:2px 6px;border-radius:4px;font-size:12px;color:#F59E0B}
</style>
</head>
<body>
<h1>FundedControl — Migration Runner</h1>
<div class="mode">mode=<?= $mode ?></div>

<?php if ($report['blocked']): ?>
<div class="card" style="border-color:#DC3545">
    <h2 class="fail">⛔ Checksum mismatch — stopped</h2>
    <p class="muted" style="font-size:13px">An applied or baselined migration file no longer matches what was recorded. Live and repo have diverged. Nothing was run.</p>
    <?php foreach ($report['mismatches'] as $filename => $diff): ?>
        <div class="row">
            <span><?= htmlspecialchars($filename) ?></span>
            <span class="fail">expected <?= substr($diff['expected'], 0, 12) ?>… got <?= substr($diff['actual'], 0, 12) ?>…</span>
        </div>
    <?php endforeach; ?>
</div>
<?php endif; ?>

<?php if (!empty($report['results'])): ?>
<div class="card">
    <h2>Run results</h2>
    <?php foreach ($report['results'] as $r): ?>
        <div class="row">
            <span><?= htmlspecialchars($r['filename']) ?></span>
            <span class="<?= $r['status'] === 'applied' ? 'ok' : ($r['status'] === 'baselined' ? 'ok' : 'fail') ?>">
                <?= htmlspecialchars($r['status']) ?><?= isset($r['execution_ms']) ? ' (' . $r['execution_ms'] . 'ms)' : '' ?>
            </span>
        </div>
        <?php if ($r['status'] === 'failed'): ?>
            <pre>Statement #<?= $r['statement']['index'] ?? '?' ?>:
<?= htmlspecialchars($r['statement']['sql'] ?? '') ?>

Error: <?= htmlspecialchars($r['error']) ?></pre>
        <?php endif; ?>
    <?php endforeach; ?>
</div>
<?php endif; ?>

<div class="card">
    <h2>Applied / baselined (<?= count($report['settled']) ?>)</h2>
    <?php if (empty($report['settled'])): ?>
        <div class="muted" style="font-size:13px">None yet.</div>
    <?php else: foreach ($report['settled'] as $filename => $row): ?>
        <div class="row">
            <span><?= htmlspecialchars($filename) ?></span>
            <span class="muted"><?= htmlspecialchars($row['status']) ?> — <?= htmlspecialchars($row['applied_at']) ?></span>
        </div>
    <?php endforeach; endif; ?>
</div>

<div class="card">
    <h2>Pending (<?= count($report['pending']) ?>)</h2>
    <?php if (empty($report['pending'])): ?>
        <div class="muted" style="font-size:13px">Nothing pending.</div>
    <?php else: foreach ($report['pending'] as $filename): ?>
        <div class="row"><span><?= htmlspecialchars($filename) ?></span><span class="warn">pending</span></div>
    <?php endforeach; endif; ?>
</div>

<div class="card muted" style="font-size:12px">
    <code>?mode=status</code> lists only, changes nothing &middot;
    <code>?mode=run</code> applies pending migrations &middot;
    <code>?mode=baseline</code> records pending migrations as applied without running them.
    Always export the database before <code>?mode=run</code> on live.
</div>

</body>
</html>
<?php
}
