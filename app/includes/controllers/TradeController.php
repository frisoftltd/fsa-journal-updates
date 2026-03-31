<?php
/**
 * FundedControl — Trade Controller (v3.4.0)
 * Handles: get_trades, add_trade, update_trade, delete_trade
 * All trades scoped to active challenge.
 * Supports up to 4 screenshots per trade with labels.
 */
class TradeController {
    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getAll() {
        $ch = getActiveChallenge();
        $chId = $ch['id'] ?? 0;
        $where = "WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL)";
        $params = [$this->uid, $chId];
        if (!empty($_GET['pair']))   { $where .= " AND pair=?";       $params[] = $_GET['pair']; }
        if (!empty($_GET['result'])) { $where .= " AND result=?";     $params[] = $_GET['result']; }
        if (!empty($_GET['from']))   { $where .= " AND trade_date>=?"; $params[] = $_GET['from']; }
        if (!empty($_GET['to']))     { $where .= " AND trade_date<=?"; $params[] = $_GET['to']; }
        $s = $this->db->prepare("SELECT * FROM trades $where ORDER BY trade_date DESC, id DESC");
        $s->execute($params);
        $trades = $s->fetchAll();

        // Parse screenshots JSON for frontend
        foreach ($trades as &$t) {
            if (!empty($t['screenshots'])) {
                $t['screenshots_data'] = json_decode($t['screenshots'], true) ?: [];
            } else if (!empty($t['screenshot'])) {
                // Backward compat: single screenshot → array format
                $t['screenshots_data'] = [['file' => $t['screenshot'], 'label' => 'Chart']];
            } else {
                $t['screenshots_data'] = [];
            }
        }
        jsonResponse($trades);
    }

    public function add()    { $this->saveTrade(false); }
    public function update() { $this->saveTrade(true); }

    private function saveTrade($isUpdate) {
        $ch = getActiveChallenge();
        $chId = $ch['id'] ?? null;

        $isForm = !empty($_FILES) || !empty($_POST);
        $d = $isForm ? $_POST : jsonInput();

        $entry_price = num($d['entry_price'] ?? null, null);
        $stop_loss   = num($d['stop_loss'] ?? null, null);
        $exit_price  = num($d['exit_price'] ?? null, null);
        $lot_size    = num($d['lot_size'] ?? null, null);
        $fees        = num($d['fees'] ?? 0);

        // Calculate P&L
        $pnl = 0;
        if ($exit_price && $entry_price && $lot_size) {
            $pnl = ($d['direction'] ?? '') === 'Long'
                ? ($exit_price - $entry_price) * $lot_size
                : ($entry_price - $exit_price) * $lot_size;
        }
        $net = $pnl - $fees;

        // Calculate R-multiple
        $r = 0;
        if ($entry_price && $stop_loss && $entry_price != $stop_loss) {
            $sld = abs($entry_price - $stop_loss);
            if (($d['result'] ?? '') === 'Loss') $r = -1;
            elseif (($d['result'] ?? '') === 'Break Even') $r = 0;
            elseif ($exit_price) {
                $r = ($d['direction'] ?? '') === 'Long'
                    ? ($exit_price - $entry_price) / $sld
                    : ($entry_price - $exit_price) / $sld;
                $r = round($r, 2);
            }
        }

        // Handle multiple screenshots (up to 4, max 1MB each)
        $screenshotsJson = null;
        $singleScreenshot = null;
        $newImages = $this->handleMultipleScreenshots($d);

        if ($newImages !== null) {
            // New images uploaded
            $screenshotsJson = json_encode($newImages);
            $singleScreenshot = !empty($newImages) ? $newImages[0]['file'] : null;
        } elseif ($isUpdate) {
            // Keep existing screenshots if no new ones uploaded
            $existingData = $d['existing_screenshots'] ?? null;
            if ($existingData) {
                $screenshotsJson = $existingData;
                $existing = json_decode($existingData, true);
                $singleScreenshot = !empty($existing) ? $existing[0]['file'] : null;
            }
        }

        $cols = ['trade_date','session','time_in','time_out','pair','direction','entry_price','stop_loss','take_profit','exit_price','lot_size','risk_amount','fees','result','confidence','exec_score','fib_level','fsa_rules','notes'];

        if ($isUpdate) {
            $trade_id = validId($d['id'] ?? 0);
            if (!$trade_id) jsonError('Invalid trade ID');
            $update_vals = array_map(fn($k) => ($d[$k] ?? null) ?: null, $cols);
            $update_vals[] = round($pnl, 4);
            $update_vals[] = round($net, 4);
            $update_vals[] = $r;
            $update_vals[] = $singleScreenshot;
            $update_vals[] = $screenshotsJson;
            $update_vals[] = $trade_id;
            $update_vals[] = $this->uid;
            $sets = implode(',', array_map(fn($c) => "$c=?", $cols));
            $sets .= ",pnl=?,net_pnl=?,r_multiple=?,screenshot=?,screenshots=?";
            $this->db->prepare("UPDATE trades SET $sets WHERE id=? AND user_id=?")->execute($update_vals);
        } else {
            $vals = array_map(fn($k) => ($d[$k] ?? null) ?: null, $cols);
            $vals = array_merge([$this->uid, $chId], $vals, [round($pnl, 4), round($net, 4), $r, $singleScreenshot, $screenshotsJson]);
            $ph = implode(',', array_fill(0, count($cols) + 5, '?'));
            $allcols = implode(',', $cols) . ",pnl,net_pnl,r_multiple,screenshot,screenshots";
            $this->db->prepare("INSERT INTO trades (user_id,challenge_id,$allcols) VALUES (?,?,{$ph})")->execute($vals);
        }

        // Update daily limits
        $dl_date = $d['trade_date'] ?? date('Y-m-d');
        $this->db->prepare("INSERT INTO daily_limits (user_id,log_date,daily_pnl,trades_count) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE daily_pnl=daily_pnl+?,trades_count=trades_count+1")
            ->execute([$this->uid, $dl_date, round($net, 4), round($net, 4)]);

        jsonResponse(['success' => true, 'id' => $this->db->lastInsertId()]);
    }

    /**
     * Handle up to 4 screenshot uploads
     * Returns array of [{file, label}] or null if no uploads
     */
    private function handleMultipleScreenshots($d) {
        $images = [];
        $hasAnyUpload = false;
        $mediaDir = safeMediaDir($this->uid);

        for ($i = 1; $i <= 4; $i++) {
            $fileKey = "screenshot_$i";
            $labelKey = "label_$i";

            if (isset($_FILES[$fileKey]) && $_FILES[$fileKey]['error'] === UPLOAD_ERR_OK && $_FILES[$fileKey]['size'] > 0) {
                $file = $_FILES[$fileKey];

                // Validate size (1MB max)
                if ($file['size'] > 1048576) {
                    jsonError("Screenshot $i exceeds 1MB limit (" . round($file['size'] / 1048576, 1) . "MB)");
                }

                // Validate MIME type
                $finfo = finfo_open(FILEINFO_MIME_TYPE);
                $mime = finfo_file($finfo, $file['tmp_name']);
                finfo_close($finfo);
                $allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                if (!in_array($mime, $allowed)) {
                    jsonError("Screenshot $i is not a valid image");
                }

                // Generate secure filename
                $ext = pathinfo($file['name'], PATHINFO_EXTENSION) ?: 'png';
                $ext = strtolower($ext);
                if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) $ext = 'png';
                $filename = 'trade_' . time() . '_' . bin2hex(random_bytes(8)) . '.' . $ext;

                // Save file
                if (!move_uploaded_file($file['tmp_name'], $mediaDir . $filename)) {
                    jsonError("Failed to save screenshot $i");
                }

                $label = $d[$labelKey] ?? 'Chart';
                $images[] = ['file' => $filename, 'label' => $label];
                $hasAnyUpload = true;
            }
        }

        return $hasAnyUpload ? $images : null;
    }

    public function delete() {
        $d = jsonInput();
        $trade_id = validId($d['id'] ?? 0);
        if (!$trade_id) jsonError('Invalid trade ID');

        // Delete all associated screenshots
        $s = $this->db->prepare("SELECT screenshot, screenshots FROM trades WHERE id=? AND user_id=?");
        $s->execute([$trade_id, $this->uid]);
        $t = $s->fetch();
        if ($t) {
            $mediaDir = safeMediaDir($this->uid);
            // Delete multi-screenshots
            if (!empty($t['screenshots'])) {
                $imgs = json_decode($t['screenshots'], true) ?: [];
                foreach ($imgs as $img) {
                    $filepath = $mediaDir . basename($img['file']);
                    if (file_exists($filepath)) unlink($filepath);
                }
            }
            // Delete single screenshot (backward compat)
            if (!empty($t['screenshot'])) {
                $filepath = $mediaDir . basename($t['screenshot']);
                if (file_exists($filepath)) @unlink($filepath);
            }
        }
        $this->db->prepare("DELETE FROM trades WHERE id=? AND user_id=?")->execute([$trade_id, $this->uid]);
        jsonResponse(['success' => true]);
    }
}
