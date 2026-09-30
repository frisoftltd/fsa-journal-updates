/**
 * FundedControl Backtesting UI harness -- setup.
 *
 * Copies app/ into a fresh OS temp directory, overlays this harness's own stubs
 * (includes/config.php, includes/api.php, router.php), vendors the two CDN chart
 * libraries locally (this package's own npm dependencies -- lightweight-charts@4.1.3,
 * chart.js@4.4.0) and points index.php's two <script> tags at them, then starts PHP's
 * built-in server against the copy.
 *
 * Never touches the real app/ directory. Exits nothing on its own when required as a
 * module (see drive.mjs); run directly (`node setup.js`) to leave the server running
 * for manual poking.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const HARNESS_DIR = __dirname;
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..');
const APP_SRC = path.join(REPO_ROOT, 'app');

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name), d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function patchIndexPhp(tmpDir) {
    const file = path.join(tmpDir, 'index.php');
    let html = fs.readFileSync(file, 'utf8');
    const replacements = [
        ['https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js', '/vendor/chart.umd.js'],
        ['https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js', '/vendor/lightweight-charts.standalone.production.js'],
    ];
    for (const [from, to] of replacements) {
        if (!html.includes(from)) throw new Error(`setup.js: expected CDN tag not found in index.php -- ${from}`);
        html = html.split(from).join(to);
    }
    fs.writeFileSync(file, html);
}

/** Waits for the PHP dev server to actually accept connections before returning --
 *  spawn() resolves as soon as the process starts, not once it's listening. */
function waitForServer(baseUrl, timeoutMs = 10000) {
    const http = require('http');
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tryOnce = () => {
            const req = http.get(baseUrl + '/', res => { res.resume(); resolve(); });
            req.on('error', () => {
                if (Date.now() > deadline) return reject(new Error('PHP server did not come up in time'));
                setTimeout(tryOnce, 150);
            });
        };
        tryOnce();
    });
}

async function setupHarness({ port = 8765 } = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bt-harness-'));
    copyDir(APP_SRC, tmpDir);

    fs.copyFileSync(path.join(HARNESS_DIR, 'stubs', 'config.php'), path.join(tmpDir, 'includes', 'config.php'));
    fs.copyFileSync(path.join(HARNESS_DIR, 'stubs', 'api.php'), path.join(tmpDir, 'includes', 'api.php'));
    fs.copyFileSync(path.join(HARNESS_DIR, 'router.php'), path.join(tmpDir, 'router.php'));

    const vendorDir = path.join(tmpDir, 'vendor');
    fs.mkdirSync(vendorDir, { recursive: true });
    fs.copyFileSync(
        path.join(HARNESS_DIR, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
        path.join(vendorDir, 'chart.umd.js')
    );
    fs.copyFileSync(
        path.join(HARNESS_DIR, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
        path.join(vendorDir, 'lightweight-charts.standalone.production.js')
    );

    patchIndexPhp(tmpDir);

    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = spawn('php', ['-S', `127.0.0.1:${port}`, 'router.php'], { cwd: tmpDir, stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    try {
        await waitForServer(baseUrl);
    } catch (e) {
        proc.kill();
        throw new Error(`${e.message}\nphp -S stderr:\n${stderr}`);
    }

    return {
        proc,
        tmpDir,
        baseUrl,
        // async, and tolerant of cleanup failure -- on Windows, php -S can hold the temp
        // dir's files open for a moment after the process is signalled, which turns an
        // immediate rmSync into EPERM. Waiting for the actual 'exit' event (not just
        // issuing kill()) avoids that in the common case; a stray leftover temp dir on
        // the rare case it doesn't is harmless (OS temp, cleaned up eventually by the OS
        // itself) and shouldn't fail an otherwise-successful test run.
        async stop() {
            await new Promise(resolve => {
                proc.once('exit', resolve);
                proc.kill();
                setTimeout(resolve, 2000); // don't hang forever if the process ignores the signal
            });
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); }
            catch (e) { console.warn(`[ui-harness] could not remove temp dir ${tmpDir}: ${e.message}`); }
        },
    };
}

module.exports = { setupHarness };

if (require.main === module) {
    setupHarness({}).then(({ tmpDir, baseUrl }) => {
        console.log(`Harness running at ${baseUrl}`);
        console.log(`App copy at ${tmpDir}`);
        console.log('Ctrl+C to stop.');
    }).catch(e => { console.error(e); process.exit(1); });
}
