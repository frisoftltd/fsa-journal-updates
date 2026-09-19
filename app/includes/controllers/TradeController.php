<?php
/**
 * FundedControl — Trade Controller (v3.4.0)
 * Handles: get_trades, add_trade, update_trade, delete_trade
 * All trades scoped to active challenge.
 * Supports up to 4 screenshots per trade with labels.
 */
require_once __DIR__ . '/../journal_taxonomy.php';

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
        $tv = $this->db->prepare("SELECT variable_id, value FROM trade_variables WHERE trade_id=?");
        // trade_journal: same embed-per-trade pattern as trade_variables above, not a
        // separate API call — the trade form needs this the moment it opens, same as
        // strategy variable answers do.
        //
        // Deliberately defensive: a missing/broken trade_journal table (migration not
        // yet applied, mid-deploy, etc.) must not take the whole Trade Log down with it.
        // A trade's core fields are far more load-bearing than its journal — degrade to
        // an empty trade_journal per trade rather than let get_trades fatal entirely.
        // Tried once, not once per trade: if it fails, every remaining trade in this
        // request just gets [] without repeating a query already known to fail.
        $journalAvailable = true;
        try {
            $tj = $this->db->prepare("SELECT id, phase, emotion_code, note, exit_type, good_process, created_at, updated_at FROM trade_journal WHERE trade_id=?");
            $tja = $this->db->prepare("SELECT action_code FROM trade_journal_actions WHERE journal_id=?");
        } catch (PDOException $e) {
            $journalAvailable = false;
        }

        foreach ($trades as &$t) {
            if (!empty($t['screenshots'])) {
                $t['screenshots_data'] = json_decode($t['screenshots'], true) ?: [];
            } else if (!empty($t['screenshot'])) {
                // Backward compat: single screenshot → array format
                $t['screenshots_data'] = [['file' => $t['screenshot'], 'label' => 'Chart']];
            } else {
                $t['screenshots_data'] = [];
            }
            $tv->execute([$t['id']]);
            $t['trade_variables'] = $tv->fetchAll();

            $t['trade_journal'] = [];
            if ($journalAvailable) {
                try {
                    $tj->execute([$t['id']]);
                    $journal = $tj->fetchAll();
                    foreach ($journal as &$j) {
                        if ($j['phase'] === 'during') {
                            $tja->execute([$j['id']]);
                            $j['actions'] = array_column($tja->fetchAll(), 'action_code');
                        }
                    }
                    unset($j);
                    $t['trade_journal'] = $journal;
                } catch (PDOException $e) {
                    $journalAvailable = false;
                }
            }
        }
        jsonResponse($trades);
    }

    public function add()    { $this->saveTrade(false); }
    public function update() { $this->saveTrade(true); }

    /**
     * v3.14.0 — execution fields (time_in, time_out, entry_price, exit_price, lot_size,
     * fees, pnl, net_pnl, r_multiple, risk_amount) are no longer part of this method at
     * all. They're populated exclusively by BitfundedImportController, which writes them
     * directly via its own INSERT/UPDATE scoped to exactly those columns. This form only
     * ever handles pre-entry fields (see CLAUDE.md v3.14.0's division-of-responsibility
     * table) — critically, that means editing a trade's strategy/gates/grade/notes can
     * never disturb execution data an import already landed on the row, because this
     * UPDATE's SET clause simply doesn't mention those columns anymore. Before this
     * change it did (unconditionally, every save), which would have silently zeroed out
     * an imported trade's prices/times/pnl/r_multiple the moment anyone edited its
     * pre-entry fields after import — caught while building the importer, not reported
     * as a live incident, but the same class of silent-clobber bug this whole release
     * exists to stop happening to execution data.
     */
    private function saveTrade($isUpdate) {
        $ch = getActiveChallenge();
        $chId = $ch['id'] ?? null;

        $isForm = !empty($_FILES) || !empty($_POST);
        $d = $isForm ? $_POST : jsonInput();

        // v3.16.1 B3 — "the whole intervention": 27 trades cost $1,150 because stop_loss/
        // take_profit were optional. Blocks, does not warn. Applies to add() and update()
        // alike (both funnel through here) — editing an existing trade that predates this
        // change (e.g. a bare Bitfunded import with no stop on file) now also requires
        // filling these in first. That is a deliberate consequence, not an oversight: see
        // CLAUDE.md v3.16.1 for the tradeoff this creates on historical rows.
        $stopVal = trim((string)($d['stop_loss'] ?? ''));
        $targetVal = trim((string)($d['take_profit'] ?? ''));
        if ($stopVal === '' || $targetVal === '' || !is_numeric($stopVal) || !is_numeric($targetVal)) {
            jsonError('Stop loss and take profit are required before a trade can be saved.');
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

        $cols = ['trade_date','session','pair','direction','stop_loss','take_profit','result','exec_score','notes','strategy_id','emotion_tag','setup_grade','note_saw','note_why','note_unsure'];

        if ($isUpdate) {
            $trade_id = validId($d['id'] ?? 0);
            if (!$trade_id) jsonError('Invalid trade ID');
            $update_vals = array_map(fn($k) => ($d[$k] ?? null) ?: null, $cols);
            $update_vals[] = $singleScreenshot;
            $update_vals[] = $screenshotsJson;
            $update_vals[] = $trade_id;
            $update_vals[] = $this->uid;
            $sets = implode(',', array_map(fn($c) => "$c=?", $cols));
            $sets .= ",screenshot=?,screenshots=?";
            $this->db->prepare("UPDATE trades SET $sets WHERE id=? AND user_id=?")->execute($update_vals);
            $finalTradeId = $trade_id;
        } else {
            $vals = array_map(fn($k) => ($d[$k] ?? null) ?: null, $cols);
            $vals = array_merge([$this->uid, $chId], $vals, [$singleScreenshot, $screenshotsJson]);
            $ph = implode(',', array_fill(0, count($cols) + 4, '?'));
            $allcols = implode(',', $cols) . ",screenshot,screenshots";
            $this->db->prepare("INSERT INTO trades (user_id,challenge_id,$allcols) VALUES (?,?,{$ph})")->execute($vals);
            $finalTradeId = $this->db->lastInsertId();
        }

        // Persist strategy variable values (delete-then-insert, scoped to this trade)
        $tradeVars = $d['trade_variables'] ?? [];
        if (is_string($tradeVars)) $tradeVars = json_decode($tradeVars, true) ?: [];
        if (is_array($tradeVars)) {
            $this->db->prepare("DELETE FROM trade_variables WHERE trade_id=?")->execute([$finalTradeId]);
            $insertVar = $this->db->prepare("INSERT INTO trade_variables (trade_id,variable_id,value) VALUES (?,?,?)");
            foreach ($tradeVars as $tv) {
                $variableId = validId($tv['variable_id'] ?? 0);
                if (!$variableId) continue;
                $value = $tv['value'] ?? null;
                if ($value === '') $value = null;
                $insertVar->execute([$finalTradeId, $variableId, $value]);
            }
        }

        $this->saveJournal($finalTradeId, $d['trade_journal'] ?? null);

        // v3.16.1 B1 — computed AFTER saveJournal() specifically so clean_rep's "a
        // pre-entry record exists" check sees the trade_journal row this same request
        // may have just written; computing it any earlier would miss a brand-new trade's
        // own first pre-entry journal entry. Degrades gracefully: entry_price/lot_size
        // are normally still null at this point (this form has had no execution inputs
        // since v3.14.0), so actual_risk_pct/target_r/exit_quality stay null here and
        // only become real once BitfundedImportController recomputes them from a real
        // fill (v3.16.1 B2) — balance_at_day_start/planned_risk_pct/clean_rep, which only
        // need trade_date/challenge_id/stop/target/journal, populate immediately.
        persistTradeRiskFields($this->db, $finalTradeId, computeTradeRiskFields($this->db, $finalTradeId));

        jsonResponse(['success' => true, 'id' => $finalTradeId]);
    }

    /**
     * Three-phase trade journal (v3.11.0): one row per trade per phase, upserted here in
     * the same request as the trade itself — same bundled-save pattern as trade_variables
     * above, so a new trade's journal entry can use the just-created trade id without a
     * second round trip.
     *
     * A phase with nothing answered is deleted rather than left as a stale empty row —
     * the ABSENCE of a 'during' row is the signal that the trader never returned to the
     * chart mid-trade; a phase must never be marked "skipped" instead.
     *
     * created_at is never touched here: it's excluded from the ON DUPLICATE KEY UPDATE
     * clause below, so MariaDB leaves it as originally set. updated_at needs no code at
     * all — its own ON UPDATE CURRENT_TIMESTAMP in the schema refreshes it automatically
     * whenever this UPDATE path actually runs.
     */
    private function saveJournal($tradeId, $entries) {
        if (is_string($entries)) $entries = json_decode($entries, true) ?: [];
        if (!is_array($entries)) return;

        $validPhases = ['pre_entry', 'during', 'post_close'];
        $validActionCodes = array_column(journalActions(), 'code');

        $upsert = $this->db->prepare(
            "INSERT INTO trade_journal (trade_id, phase, emotion_code, note, exit_type, good_process)
             VALUES (?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), emotion_code=VALUES(emotion_code), note=VALUES(note), exit_type=VALUES(exit_type), good_process=VALUES(good_process)"
        );
        $deleteEmpty = $this->db->prepare("DELETE FROM trade_journal WHERE trade_id=? AND phase=?");
        $deleteActions = $this->db->prepare("DELETE FROM trade_journal_actions WHERE journal_id=?");
        $insertAction = $this->db->prepare("INSERT INTO trade_journal_actions (journal_id, action_code) VALUES (?,?)");

        foreach ($entries as $entry) {
            if (!is_array($entry)) continue;
            $phase = $entry['phase'] ?? '';
            if (!in_array($phase, $validPhases, true)) continue;

            $emotionCode = trim((string)($entry['emotion_code'] ?? '')) ?: null;
            $note = trim((string)($entry['note'] ?? '')) ?: null;
            $exitType = $phase === 'post_close' ? (trim((string)($entry['exit_type'] ?? '')) ?: null) : null;
            $goodProcessRaw = $entry['good_process'] ?? null;
            $goodProcess = ($phase === 'post_close' && $goodProcessRaw !== null && $goodProcessRaw !== '')
                ? (int)!!$goodProcessRaw : null;
            $actions = ($phase === 'during' && is_array($entry['actions'] ?? null))
                ? array_values(array_unique(array_intersect($entry['actions'], $validActionCodes)))
                : [];

            $hasContent = $emotionCode !== null || $note !== null || $exitType !== null || $goodProcess !== null || !empty($actions);
            if (!$hasContent) {
                $deleteEmpty->execute([$tradeId, $phase]);
                continue;
            }

            $upsert->execute([$tradeId, $phase, $emotionCode, $note, $exitType, $goodProcess]);
            $journalId = $this->db->lastInsertId();

            if ($phase === 'during') {
                $deleteActions->execute([$journalId]);
                foreach ($actions as $code) $insertAction->execute([$journalId, $code]);
            }
        }
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
