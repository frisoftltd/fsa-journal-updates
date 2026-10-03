<?php
/**
 * Standalone CLI test for updater.php's v3.22.10 fixes: backup-list sort order (by real
 * mtime, not the folder name string) and retention (keep the newest 20, with a realpath()
 * containment check and a hard exemption for the backup an update run just created).
 *
 * updater.php can't be require()'d directly in a dev sandbox -- its own first lines are
 * session_start()/require_once 'includes/config.php' (DB credentials, never in this repo)
 * /requireLogin(), and 'includes/config.php' genuinely does not exist here. Same problem
 * tools/ui-harness/setup.js already solved for the whole app: copy the real file into a
 * temp directory next to a minimal stub config, so the EXACT current source under test
 * runs unmodified, just with its one missing dependency satisfied. No $_GET['action'] is
 * ever set here, so updater.php's own API switch block (and the getDB()/real-login path
 * it would need) never executes -- only session_start()/requireLogin()/the function
 * declarations/the final HTML page do, and the HTML output is simply discarded.
 *
 * Usage: php tools/test-updater-backups.php
 */

$failures = [];
function assertTrue($cond, string $label) {
    global $failures;
    if ($cond) { echo "  PASS: $label\n"; return; }
    $failures[] = $label;
    echo "  FAIL: $label\n";
}

$repoRoot = dirname(__DIR__);
$realUpdater = $repoRoot . '/app/updater.php';
if (!is_file($realUpdater)) { fwrite(STDERR, "Cannot find app/updater.php from $repoRoot\n"); exit(1); }

$tmpRoot = sys_get_temp_dir() . '/fc-updater-test-' . uniqid();
mkdir($tmpRoot, 0755, true);
mkdir($tmpRoot . '/includes', 0755, true);
mkdir($tmpRoot . '/backups', 0755, true);
copy($realUpdater, $tmpRoot . '/updater.php');
file_put_contents($tmpRoot . '/includes/config.php', "<?php\nfunction requireLogin() {}\n");

// Load the real file's functions once, with no $_GET['action'] set (so its own API switch
// block, which calls exit(), never runs) and stdout discarded (the trailing HTML page).
$_GET = [];
ob_start();
chdir($tmpRoot);
include $tmpRoot . '/updater.php';
ob_end_clean();

if (!function_exists('getBackups') || !function_exists('pruneOldBackups') || !function_exists('deleteDirRecursive')) {
    fwrite(STDERR, "updater.php's own functions did not load -- aborting.\n");
    exit(1);
}

/** Creates $count fake backup_v* dirs under $tmpRoot/backups, each with an explicit mtime
 *  (not wall-clock creation order, which filesystem timestamp resolution could make
 *  flaky) from $mtimeFor(name, index). Wipes any existing dirs first so each phase starts
 *  clean. Returns the created names. */
function makeFakeBackups(string $backupsDir, int $count, callable $mtimeFor): array {
    foreach (glob($backupsDir . '/backup_*', GLOB_ONLYDIR) as $d) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($it as $item) { $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname()); }
        rmdir($d);
    }
    $names = [];
    for ($i = 0; $i < $count; $i++) {
        $name = sprintf('backup_v3.%d.%d_2026%02d%02d_%02d0000', 9 + ($i % 14), $i, (($i % 12) + 1), (($i % 27) + 1), $i % 24);
        $path = $backupsDir . '/' . $name;
        mkdir($path . '/app', 0755, true);
        file_put_contents($path . '/app/version.json', '{}'); // a little real content to delete, not just an empty dir
        file_put_contents($path . '/app/dummy.php', '<?php // fake backed-up file');
        touch($path, $mtimeFor($name, $i));
        $names[] = $name;
    }
    return $names;
}

$backupsDir = $tmpRoot . '/backups';

// ════════════════════════════════════════════════════════════════
// Phase 1 — sort order is by real mtime, newest first, NOT the folder name string.
// Deliberately gives the LEXICALLY LARGER name ('v3.9.x') an OLDER mtime than the
// lexically smaller one ('v3.22.x') -- the exact live symptom (v3.9.x showing above
// v3.22.x) only reproduces if the fix is genuinely sorting by mtime, not name.
// ════════════════════════════════════════════════════════════════
echo "\n[Phase 1] sort order follows mtime, not the name string\n";
foreach (glob($backupsDir . '/backup_*', GLOB_ONLYDIR) as $d) { rmdir($d); }
$oldNameNewMtime = 'backup_v3.9.0_20260101_000000';  // lexically "larger" (the live bug)
$newNameOldMtime = 'backup_v3.22.9_20260101_000000'; // lexically "smaller"
mkdir($backupsDir . '/' . $oldNameNewMtime);
mkdir($backupsDir . '/' . $newNameOldMtime);
touch($backupsDir . '/' . $oldNameNewMtime, strtotime('2026-10-01 00:00:00')); // NEWER mtime
touch($backupsDir . '/' . $newNameOldMtime, strtotime('2026-09-01 00:00:00')); // OLDER mtime
$sorted = array_keys(getBackups());
assertTrue($sorted[0] === $oldNameNewMtime, "the NEWER-mtime folder sorts first even though its name is lexically larger (got order: " . implode(', ', $sorted) . ")");
assertTrue($sorted[1] === $newNameOldMtime, "the OLDER-mtime folder sorts second despite a lexically smaller name");
foreach ($sorted as $n) { rmdir($backupsDir . '/' . $n); }

// ════════════════════════════════════════════════════════════════
// Phase 2 — retention keeps exactly the newest 20 of ~30, deletes the rest.
// ════════════════════════════════════════════════════════════════
echo "\n[Phase 2] retention keeps the newest 20 of 30, deletes the other 10\n";
$base = strtotime('2026-01-01 00:00:00');
$names = makeFakeBackups($backupsDir, 30, fn($name, $i) => $base + $i * 3600); // index 29 = newest
$expectedKept = array_slice(array_reverse($names), 0, 20); // newest 20 by construction
$removed = pruneOldBackups(20, '');
$remaining = array_keys(getBackups());
assertTrue(count($removed) === 10, "exactly 10 backups were removed (got " . count($removed) . ")");
assertTrue(count($remaining) === 20, "exactly 20 backups remain (got " . count($remaining) . ")");
sort($remaining); sort($expectedKept);
assertTrue($remaining === $expectedKept, "the 20 that remain are exactly the 20 newest by mtime, not by name/glob order");
foreach ($remaining as $n) { $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($backupsDir . '/' . $n, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($it as $item) { $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname()); } rmdir($backupsDir . '/' . $n); }

// ════════════════════════════════════════════════════════════════
// Phase 3 — the backup an update run JUST created is never deleted, even in the
// pathological case its own mtime would otherwise rank it dead last.
// ════════════════════════════════════════════════════════════════
echo "\n[Phase 3] the just-created backup survives even if its own mtime ranks it last\n";
$names = makeFakeBackups($backupsDir, 30, fn($name, $i) => $base + $i * 3600);
$justCreated = $names[0]; // given the OLDEST mtime of the batch by construction (index 0 => $base)
$removedWithExemption = pruneOldBackups(20, $justCreated);
$remainingWithExemption = array_keys(getBackups());
assertTrue(in_array($justCreated, $remainingWithExemption, true), "the just-created backup ($justCreated) survived despite ranking last by mtime");
assertTrue(!in_array($justCreated, $removedWithExemption, true), "the just-created backup is never reported as removed");
assertTrue(count($remainingWithExemption) === 21, "21 remain: the 20 naturally newest plus the one exempted survivor (got " . count($remainingWithExemption) . ")");
foreach ($remainingWithExemption as $n) { $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($backupsDir . '/' . $n, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($it as $item) { $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname()); } rmdir($backupsDir . '/' . $n); }

// ════════════════════════════════════════════════════════════════
// Phase 4 — realpath() containment: a symlink inside BACKUP_DIR pointing OUTSIDE it is
// refused, never deleted, even though getBackups()'s own glob() would otherwise list it.
// Skipped gracefully if this host/user can't create symlinks (e.g. no privilege on
// Windows) -- the other phases already cover the primary sort/retention behaviour.
// ════════════════════════════════════════════════════════════════
echo "\n[Phase 4] realpath() containment refuses a symlink pointing outside BACKUP_DIR\n";
$outsideTarget = $tmpRoot . '/outside-target';
mkdir($outsideTarget, 0755, true);
file_put_contents($outsideTarget . '/sentinel.txt', 'must survive');
$symlinkName = 'backup_v9.9.9_evil';
$symlinkPath = $backupsDir . '/' . $symlinkName;
$canSymlink = @symlink($outsideTarget, $symlinkPath);
if (!$canSymlink) {
    echo "  SKIP: this host/user cannot create symlinks -- containment check still present in code, just not exercised here.\n";
} else {
    touch($symlinkPath, $base + 999999); // make it look like the newest -- still inside the "to delete" range if rank-based alone
    $names2 = makeFakeBackups($backupsDir, 25, fn($name, $i) => $base + $i * 3600); // 25 real + 1 symlink = 26 candidates, keep 20 -> 6 would be pruned by rank
    $removed2 = pruneOldBackups(20, '');
    assertTrue(!in_array($symlinkName, $removed2, true), "the symlink is never reported as removed, regardless of its rank");
    assertTrue(is_dir($outsideTarget) && file_exists($outsideTarget . '/sentinel.txt'), "the real target OUTSIDE BACKUP_DIR still exists untouched");
    @unlink($symlinkPath);
    foreach (glob($backupsDir . '/backup_*', GLOB_ONLYDIR) as $d) { $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($it as $item) { $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname()); } rmdir($d); }
}

// ── cleanup ──
function rrmdir(string $dir): void {
    if (!is_dir($dir)) return;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $item) { $item->isLink() ? unlink($item->getPathname()) : ($item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname())); }
    rmdir($dir);
}
rrmdir($tmpRoot);

echo "\n" . (empty($failures) ? 'ALL PASS' : count($failures) . ' FAILURE(S)') . "\n";
if ($failures) { foreach ($failures as $f) echo " - $f\n"; exit(1); }
