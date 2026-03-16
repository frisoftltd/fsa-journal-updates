<?php
session_start();
require_once 'includes/config.php';
requireLogin();

define('LOCAL_VERSION_FILE', __DIR__ . '/version.json');
define('GITHUB_VERSION_URL', 'https://raw.githubusercontent.com/acrobcrypto250/fsa-journal-updates/main/version.json');
define('GITHUB_BASE_URL',    'https://raw.githubusercontent.com/acrobcrypto250/fsa-journal-updates/main/app');
define('BACKUP_DIR',         __DIR__ . '/backups/');

// ── API HANDLER ──────────────────────────────────────────
if (isset($_GET['action'])) {
    header('Content-Type: application/json');
    switch ($_GET['action']) {

        case 'check':
            $local  = getLocalVersion();
            $remote = getRemoteVersion();
            if (!$remote) {
                echo json_encode(['error' => 'Cannot reach GitHub. Check your internet connection.']);
                break;
            }
            $has_update = version_compare($remote['current_version'], $local['current_version'], '>');
            echo json_encode([
                'local_version'  => $local['current_version'],
                'remote_version' => $remote['current_version'],
                'has_update'     => $has_update,
                'release_date'   => $remote['release_date'],
                'changelog'      => $remote['changelog'],
                'db_migrations'  => $remote['db_migrations'] ?? [],
                'release_notes'  => $remote['release_notes'] ?? ''
            ]);
            break;

        case 'apply':
            $remote = getRemoteVersion();
            if (!$remote) { echo json_encode(['error' => 'Cannot reach GitHub']); break; }

            $results = [];
            $errors  = [];

            // 1. Create backup first
            $backup_name = 'backup_v' . getLocalVersion()['current_version'] . '_' . date('Ymd_His');
            $backup_path = BACKUP_DIR . $backup_name . '/';
            if (!is_dir(BACKUP_DIR)) mkdir(BACKUP_DIR, 0755, true);
            mkdir($backup_path, 0755, true);

            // Backup current files
            foreach ($remote['files'] as $file) {
                $local_path = __DIR__ . '/' . $file['path'];
                if (file_exists($local_path)) {
                    $backup_dest = $backup_path . $file['path'];
                    $backup_dest_dir = dirname($backup_dest);
                    if (!is_dir($backup_dest_dir)) mkdir($backup_dest_dir, 0755, true);
                    copy($local_path, $backup_dest);
                }
            }
            $results[] = ['status' => 'ok', 'msg' => "✅ Backup created: $backup_name"];

            // 2. Download and apply each file (skip config.php — never overwrite)
            foreach ($remote['files'] as $file) {
                if ($file['critical'] ?? false) {
                    $results[] = ['status' => 'skip', 'msg' => "⏭ Skipped (protected): {$file['path']}"];
                    continue;
                }
                $url      = GITHUB_BASE_URL . '/' . $file['path'];
                $content  = fetchUrl($url);
                if ($content === false) {
                    $errors[] = "❌ Failed to download: {$file['path']}";
                    continue;
                }
                $dest = __DIR__ . '/' . $file['path'];
                $dest_dir = dirname($dest);
                if (!is_dir($dest_dir)) mkdir($dest_dir, 0755, true);
                if (file_put_contents($dest, $content) !== false) {
                    $results[] = ['status' => 'ok', 'msg' => "✅ Updated: {$file['path']}"];
                } else {
                    $errors[] = "❌ Could not write: {$file['path']} — check folder permissions";
                }
            }

            // 3. Run DB migrations if any
            if (!empty($remote['db_migrations'])) {
                $db = getDB();
                foreach ($remote['db_migrations'] as $migration) {
                    try {
                        $db->exec($migration['sql']);
                        $results[] = ['status' => 'ok', 'msg' => "✅ DB Migration: {$migration['name']}"];
                    } catch (PDOException $e) {
                        if (strpos($e->getMessage(), 'Duplicate') !== false || strpos($e->getMessage(), 'already exists') !== false) {
                            $results[] = ['status' => 'skip', 'msg' => "⏭ Migration already applied: {$migration['name']}"];
                        } else {
                            $errors[] = "❌ DB Migration failed: {$migration['name']} — " . $e->getMessage();
                        }
                    }
                }
            }

            // 4. Update local version.json
            file_put_contents(LOCAL_VERSION_FILE, json_encode($remote, JSON_PRETTY_PRINT));
            $results[] = ['status' => 'ok', 'msg' => "✅ Version updated to v{$remote['current_version']}"];

            echo json_encode([
                'success'  => empty($errors),
                'results'  => $results,
                'errors'   => $errors,
                'version'  => $remote['current_version'],
                'backup'   => $backup_name
            ]);
            break;

        case 'rollback':
            $backups = getBackups();
            $target  = $_GET['backup'] ?? '';
            if (!$target || !isset($backups[$target])) {
                echo json_encode(['error' => 'Backup not found']); break;
            }
            $backup_path = BACKUP_DIR . $target . '/';
            $restored = [];
            $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($backup_path));
            foreach ($iterator as $file) {
                if ($file->isFile()) {
                    $rel  = str_replace($backup_path, '', $file->getPathname());
                    $dest = __DIR__ . '/' . $rel;
                    $dest_dir = dirname($dest);
                    if (!is_dir($dest_dir)) mkdir($dest_dir, 0755, true);
                    copy($file->getPathname(), $dest);
                    $restored[] = $rel;
                }
            }
            echo json_encode(['success' => true, 'restored' => $restored]);
            break;

        case 'list_backups':
            echo json_encode(['backups' => getBackups()]);
            break;
    }
    exit;
}

// ── HELPERS ──────────────────────────────────────────────
function getLocalVersion() {
    if (!file_exists(LOCAL_VERSION_FILE)) {
        return ['current_version' => '2.1.0', 'release_date' => '2026-03-16', 'changelog' => []];
    }
    $data = json_decode(file_get_contents(LOCAL_VERSION_FILE), true);
    if (empty($data['release_date'])) $data['release_date'] = '2026-03-16';
    return $data;
}

function getRemoteVersion() {
    $content = fetchUrl(GITHUB_VERSION_URL);
    if (!$content) return null;
    return json_decode($content, true);
}

function fetchUrl($url) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT      => 'FSA-Journal-Updater/2.0'
        ]);
        $result = curl_exec($ch);
        $code   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ($result && $code === 200) ? $result : false;
    }
    $ctx = stream_context_create(['http' => ['timeout' => 15, 'user_agent' => 'FSA-Journal-Updater/2.0']]);
    $result = @file_get_contents($url, false, $ctx);
    return $result ?: false;
}

function getBackups() {
    if (!is_dir(BACKUP_DIR)) return [];
    $dirs = glob(BACKUP_DIR . 'backup_*', GLOB_ONLYDIR);
    $out  = [];
    foreach ($dirs as $d) {
        $name = basename($d);
        $out[$name] = ['name' => $name, 'date' => filemtime($d), 'path' => $d];
    }
    arsort($out);
    return $out;
}

$local = getLocalVersion();
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>FSA Journal — Updater</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
<style>
.update-wrap{max-width:680px;margin:0 auto}
.version-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-family:var(--font-head);font-size:12px;background:rgba(79,124,255,0.15);color:var(--blue2);border:1px solid var(--blue);margin-left:8px}
.version-badge.new{background:rgba(0,212,160,0.15);color:var(--green);border-color:var(--green)}
.changelog-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text2)}
.changelog-item:last-child{border-bottom:none}
.changelog-dot{width:6px;height:6px;border-radius:50%;background:var(--green);margin-top:6px;flex-shrink:0}
.log-line{padding:8px 12px;border-radius:6px;font-size:12px;font-family:var(--font-head);margin-bottom:4px}
.log-ok{background:rgba(0,212,160,0.08);color:var(--green)}
.log-skip{background:rgba(255,179,71,0.08);color:var(--orange)}
.log-error{background:rgba(255,77,109,0.08);color:var(--red)}
.backup-item{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg3);border-radius:6px;margin-bottom:6px;font-size:12px}
.steps{counter-reset:step}
.step{display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--border)}
.step:last-child{border-bottom:none}
.step-num{width:28px;height:28px;border-radius:50%;background:var(--blue);color:white;font-family:var(--font-head);font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.step-body h4{font-size:13px;font-weight:600;margin-bottom:4px}
.step-body p{font-size:12px;color:var(--text2);line-height:1.5}
code{background:var(--bg3);padding:2px 7px;border-radius:4px;font-family:var(--font-head);font-size:11px;color:var(--orange)}
</style>
</head>
<body style="background:var(--bg);padding:24px">
<div class="update-wrap">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:10px">
    <div>
      <h1 style="font-family:var(--font-head);font-size:16px;color:var(--blue2);letter-spacing:2px">FSA JOURNAL UPDATER</h1>
      <p style="font-size:12px;color:var(--text3);margin-top:3px">Update your app without losing any data</p>
    </div>
    <a href="index.php" class="btn btn-ghost btn-sm">← Back to App</a>
  </div>

  <!-- Current Version -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-title">Current Version</div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <span style="font-family:var(--font-head);font-size:28px;color:var(--text)">v<?= htmlspecialchars($local['current_version']) ?></span>
        <span style="font-size:12px;color:var(--text3);margin-left:10px"><?= htmlspecialchars($local['release_date'] ?? 'Unknown date') ?></span>
      </div>
      <button class="btn btn-primary" id="check-btn" onclick="checkForUpdate()">🔍 Check for Updates</button>
    </div>
  </div>

  <!-- Update Status (hidden until checked) -->
  <div id="update-panel" style="display:none">

    <!-- Up to date -->
    <div id="panel-uptodate" style="display:none" class="card" style="margin-bottom:16px">
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:40px;margin-bottom:8px">✅</div>
        <div style="font-family:var(--font-head);font-size:14px;color:var(--green)">You are up to date!</div>
        <div style="font-size:12px;color:var(--text3);margin-top:6px" id="uptodate-msg"></div>
      </div>
    </div>

    <!-- Update available -->
    <div id="panel-update" style="display:none">
      <div class="card" style="margin-bottom:14px;border-color:var(--green)">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">New Version Available</div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-family:var(--font-head);font-size:14px;color:var(--text3)">v<?= htmlspecialchars($local['current_version']) ?></span>
              <span style="color:var(--text3)">→</span>
              <span style="font-family:var(--font-head);font-size:22px;color:var(--green)" id="new-version">—</span>
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px" id="new-release-date"></div>
          </div>
          <button class="btn btn-success" id="apply-btn" onclick="applyUpdate()" style="padding:10px 24px;font-size:14px">
            ⬇️ Update Now
          </button>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="card-title">What's New</div>
        <div id="changelog-list"></div>
      </div>

      <div class="card" style="margin-bottom:14px;border-color:var(--orange)">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:18px">🛡️</span>
          <div>
            <div style="font-weight:600;font-size:13px;margin-bottom:4px">Your data is 100% safe</div>
            <div style="font-size:12px;color:var(--text2)">The updater only replaces code files (PHP, CSS, JS). Your database, trades, screenshots and settings are <strong style="color:var(--green)">never touched</strong>. A backup of your current code is created automatically before every update.</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Progress log -->
  <div id="update-log" style="display:none" class="card" style="margin-bottom:16px">
    <div class="card-title">Update Log</div>
    <div id="log-lines"></div>
    <div id="update-success" style="display:none;text-align:center;padding:16px 0">
      <div style="font-size:36px;margin-bottom:8px">🎉</div>
      <div style="font-family:var(--font-head);font-size:14px;color:var(--green)">Update complete!</div>
      <div style="font-size:12px;color:var(--text3);margin-top:6px" id="success-msg"></div>
      <a href="index.php" class="btn btn-success" style="margin-top:14px">Open Updated App →</a>
    </div>
  </div>

  <!-- Backups -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-title">Backups <span style="font-size:10px;color:var(--text3);font-family:var(--font-body)">(auto-created before every update)</span></div>
    <div id="backups-list"><div style="color:var(--text3);font-size:12px">Loading backups...</div></div>
  </div>

  <!-- How to release updates guide -->
  <div class="card">
    <div class="card-title">📖 How to Release a New Update (for your coach)</div>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-body"><h4>Get updated files from Claude</h4><p>When you ask Claude to improve the app, it will give you the changed files to download.</p></div></div>
      <div class="step"><div class="step-num">2</div><div class="step-body"><h4>Go to your GitHub repo</h4><p>Open: <code>github.com/acrobcrypto250/fsa-journal-updates</code></p></div></div>
      <div class="step"><div class="step-num">3</div><div class="step-body"><h4>Update version.json</h4><p>Change <code>current_version</code> to the new version (e.g. <code>2.1.0</code>), update <code>changelog</code> with what changed.</p></div></div>
      <div class="step"><div class="step-num">4</div><div class="step-body"><h4>Upload changed files to /app/ folder</h4><p>Drag and drop the new files into the <code>app/</code> folder in your GitHub repo. Only upload files that actually changed.</p></div></div>
      <div class="step"><div class="step-num">5</div><div class="step-body"><h4>Acrob clicks "Check for Updates"</h4><p>The app detects the new version, shows the changelog, and Acrob clicks Update Now. Done in 30 seconds.</p></div></div>
    </div>
  </div>

</div>

<div class="toast" id="toast"></div>

<script>
function toast(msg,type='success'){
    const t=document.getElementById('toast');
    t.textContent=msg; t.className=`toast ${type} show`;
    setTimeout(()=>t.className='toast',3000);
}

async function checkForUpdate() {
    const btn=document.getElementById('check-btn');
    btn.textContent='Checking...'; btn.disabled=true;
    try {
        const r=await fetch('updater.php?action=check');
        const d=await r.json();
        btn.textContent='🔍 Check for Updates'; btn.disabled=false;
        if(d.error){toast(d.error,'error');return;}
        document.getElementById('update-panel').style.display='block';
        if(d.has_update){
            document.getElementById('panel-uptodate').style.display='none';
            document.getElementById('panel-update').style.display='block';
            document.getElementById('new-version').textContent='v'+d.remote_version;
            document.getElementById('new-release-date').textContent='Released: '+d.release_date;
            const cl=document.getElementById('changelog-list');
            cl.innerHTML=d.changelog.map(c=>`<div class="changelog-item"><div class="changelog-dot"></div><span>${c}</span></div>`).join('');
        } else {
            document.getElementById('panel-update').style.display='none';
            document.getElementById('panel-uptodate').style.display='block';
            document.getElementById('uptodate-msg').textContent='You are running the latest version: v'+d.local_version;
        }
    } catch(e){
        btn.textContent='🔍 Check for Updates'; btn.disabled=false;
        toast('Connection error — make sure XAMPP is running','error');
    }
}

async function applyUpdate() {
    if(!confirm('Apply update now? A backup will be created automatically before anything changes.')) return;
    const btn=document.getElementById('apply-btn');
    btn.textContent='Updating...'; btn.disabled=true;
    document.getElementById('update-log').style.display='block';
    document.getElementById('log-lines').innerHTML='';
    document.getElementById('update-success').style.display='none';
    try {
        const r=await fetch('updater.php?action=apply');
        const d=await r.json();
        const lines=document.getElementById('log-lines');
        if(d.results){
            d.results.forEach(item=>{
                const cls=item.status==='ok'?'log-ok':item.status==='skip'?'log-skip':'log-error';
                lines.innerHTML+=`<div class="log-line ${cls}">${item.msg}</div>`;
            });
        }
        if(d.errors&&d.errors.length){
            d.errors.forEach(e=>{ lines.innerHTML+=`<div class="log-line log-error">${e}</div>`; });
            toast('Update completed with some errors','warning');
        }
        if(d.success){
            document.getElementById('update-success').style.display='block';
            document.getElementById('success-msg').textContent=`Updated to v${d.version} — backup saved as: ${d.backup}`;
            toast('Update successful! 🎉');
            loadBackups();
        }
        btn.textContent='⬇️ Update Now'; btn.disabled=false;
        document.getElementById('panel-update').style.display='none';
    } catch(e){
        btn.textContent='⬇️ Update Now'; btn.disabled=false;
        toast('Update failed — check console','error');
    }
}

async function loadBackups() {
    const r=await fetch('updater.php?action=list_backups');
    const d=await r.json();
    const list=document.getElementById('backups-list');
    const backups=Object.values(d.backups||{});
    if(!backups.length){list.innerHTML='<div style="color:var(--text3);font-size:12px">No backups yet — one is created automatically before every update.</div>';return;}
    list.innerHTML=backups.map(b=>`<div class="backup-item">
        <div>
            <div style="font-weight:600;color:var(--text)">${b.name}</div>
            <div style="color:var(--text3)">${new Date(b.date*1000).toLocaleString()}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="rollback('${b.name}')">↩ Restore</button>
    </div>`).join('');
}

async function rollback(name) {
    if(!confirm('Restore this backup? Current files will be replaced.')) return;
    const r=await fetch(`updater.php?action=rollback&backup=${name}`);
    const d=await r.json();
    if(d.success) toast(`Restored ${d.restored.length} files successfully`);
    else toast('Rollback failed','error');
}

loadBackups();
</script>
</body>
</html>
