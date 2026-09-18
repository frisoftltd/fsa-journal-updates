<?php
/**
 * FundedControl — Bitfunded Paste Importer (v3.14.0)
 * Handles: preview_bitfunded_import, confirm_bitfunded_import
 *
 * Replaces thirteen migration files' worth of hand-typing with a page that parses
 * Bitfunded's own Position History (and, optionally, Transaction History for funding)
 * directly. See CLAUDE.md v3.14.0 for the full division-of-responsibility rationale —
 * this controller only ever writes execution fields (time_in, time_out, entry_price,
 * exit_price, lot_size, fees, pnl, net_pnl, result, exit_reason, source) and never
 * touches trade_variables, emotion_tag, setup_grade, the three note columns, stop_loss,
 * take_profit, strategy_id, screenshots, or a trade's id.
 *
 * preview() and confirm() both re-parse the pasted text from the request on every call —
 * there is no server-side session cache of a prior preview. This keeps the two actions
 * stateless and guarantees confirm() always acts on exactly what's currently in the
 * textareas, not a preview computed against data that may have changed since.
 */
require_once __DIR__ . '/../bitfunded_parser.php';

class BitfundedImportController {
    const MATCH_WINDOW_SECONDS = 600; // +/-10 minutes, per CLAUDE.md v3.14.0 §4

    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function preview() {
        $d = jsonInput();
        [$challenge, $positions, $funding] = $this->parseRequest($d);

        $matches = $this->matchAll($challenge['id'], $positions);
        $counts = ['total' => 0, 'new' => 0, 'matched' => 0, 'attention' => 0];
        $rows = [];
        foreach ($positions as $i => $p) {
            $m = $matches[$i];
            $counts['total']++;
            $counts[$m['status']]++;
            $rows[] = [
                'line' => $p['line'], 'pair' => $p['pair'], 'direction' => $p['direction'],
                'time_in' => $p['time_in'], 'entry_price' => $p['entry_price'], 'pnl' => $p['pnl'],
                'fees' => $p['fees'], 'exit_reason' => $p['exit_reason'],
                'status' => $m['status'], 'trade_id' => $m['trade_id'] ?? null, 'reason' => $m['reason'] ?? null,
            ];
        }

        $reconciliation = $this->reconciliation($challenge, $positions, $matches, $funding, $d['manual_balance'] ?? null);

        jsonResponse([
            'success' => true,
            'challenge_id' => $challenge['id'],
            'counts' => $counts,
            'rows' => $rows,
            'funding' => $funding,
            'reconciliation' => $reconciliation,
        ]);
    }

    public function confirm() {
        $d = jsonInput();
        [$challenge, $positions, $funding] = $this->parseRequest($d);

        $matches = $this->matchAll($challenge['id'], $positions);

        $inserted = 0; $updated = 0; $attention = 0;

        try {
            $this->db->beginTransaction();

            foreach ($positions as $i => $p) {
                $m = $matches[$i];
                if ($m['status'] === 'attention') { $attention++; continue; }

                $result = $p['pnl'] > 0 ? 'Win' : ($p['pnl'] < 0 ? 'Loss' : 'Break Even');
                $net = round($p['pnl'] - $p['fees'], 4);

                if ($m['status'] === 'matched') {
                    $this->db->prepare(
                        "UPDATE trades SET trade_date=?, time_in=?, time_out=?, entry_price=?, exit_price=?,
                            lot_size=?, fees=?, pnl=?, net_pnl=?, result=?, exit_reason=?, source='import'
                         WHERE id=? AND challenge_id=?"
                    )->execute([
                        substr($p['time_in'], 0, 10), $p['time_in'], $p['time_out'], $p['entry_price'], $p['exit_price'],
                        $p['lot_size'], $p['fees'], $p['pnl'], $net, $result, $p['exit_reason'],
                        $m['trade_id'], $challenge['id'],
                    ]);
                    $updated++;
                } else { // new
                    $this->db->prepare(
                        "INSERT INTO trades
                            (user_id, challenge_id, trade_date, session, time_in, time_out, pair, direction,
                             entry_price, stop_loss, take_profit, exit_price, lot_size, fees, pnl, net_pnl,
                             result, exit_reason, confidence, exec_score, fib_level, fsa_rules, notes,
                             strategy_id, emotion_tag, setup_grade, note_saw, note_why, note_unsure, source)
                         VALUES (?,?,?,NULL,?,?,?,?, ?,NULL,NULL,?,?,?,?,?, ?,?,NULL,NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL,NULL,NULL, 'import')"
                    )->execute([
                        $this->uid, $challenge['id'], substr($p['time_in'], 0, 10), $p['time_in'], $p['time_out'],
                        $p['pair'], $p['direction'],
                        $p['entry_price'], $p['exit_price'], $p['lot_size'], $p['fees'], $p['pnl'], $net,
                        $result, $p['exit_reason'],
                    ]);
                    $inserted++;
                }
            }

            if ($funding !== null) {
                $this->db->prepare("UPDATE challenges SET funding_adjustment=? WHERE id=? AND user_id=?")
                    ->execute([$funding['funding_total'], $challenge['id'], $this->uid]);
            }

            $this->db->commit();
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            jsonError('Import failed, nothing was written: ' . $e->getMessage());
        }

        jsonResponse([
            'success' => true,
            'inserted' => $inserted,
            'updated' => $updated,
            'skipped_attention' => $attention,
            'funding_updated' => $funding !== null,
        ]);
    }

    // ── SHARED ────────────────────────────────────────────────

    /** Validates the challenge, parses both boxes, returns [challenge, positions, funding|null]. Fails loudly on anything unrecognized — never partial-parses. */
    private function parseRequest($d): array {
        $challengeId = validId($d['challenge_id'] ?? 0);
        if (!$challengeId) jsonError('Select a challenge first.');
        $cs = $this->db->prepare("SELECT * FROM challenges WHERE id=? AND user_id=?");
        $cs->execute([$challengeId, $this->uid]);
        $challenge = $cs->fetch();
        if (!$challenge) jsonError('Challenge not found.');
        $challenge = enrichChallenge($this->db, $challenge);

        $positionsRaw = $d['position_history'] ?? '';
        if (trim($positionsRaw) === '') jsonError('Paste Bitfunded\'s Position History table into Box 1 first.');
        try {
            $positions = parsePositionHistory($positionsRaw);
        } catch (BitfundedParseException $e) {
            jsonError($e->getMessage());
        }

        $funding = null;
        $txRaw = $d['transaction_history'] ?? '';
        if (trim($txRaw) !== '') {
            try {
                $funding = parseTransactionHistory($txRaw);
            } catch (BitfundedParseException $e) {
                jsonError($e->getMessage());
            }
        }

        return [$challenge, $positions, $funding];
    }

    /**
     * Matching rule (CLAUDE.md v3.14.0 §4): pair + direction + entry_price + pnl exactly,
     * with time_in within +/-10 minutes. A ±5-minute (pair, direction)-only window
     * produced a false positive during the manual migrations this importer replaces
     * (BTCUSDT Long re-entries 4.5 minutes apart, same symbol, different price and P&L —
     * not a duplicate) — entry_price and pnl are not optional narrowing, they're the
     * actual duplicate signature.
     *
     * Three outcomes per row, never a silent guess:
     *   'new'       — no candidate at all.
     *   'matched'   — exactly one exact candidate.
     *   'attention' — more than one exact candidate, or a near-match (same pair/direction/
     *                 time window, but entry_price or pnl differs) with zero exact
     *                 candidates. Nothing is written for these; the user decides.
     */
    private function matchAll($challengeId, array $positions): array {
        $out = [];
        foreach ($positions as $p) {
            $ts = strtotime($p['time_in']);
            $windowStart = date('Y-m-d H:i:s', $ts - self::MATCH_WINDOW_SECONDS);
            $windowEnd = date('Y-m-d H:i:s', $ts + self::MATCH_WINDOW_SECONDS);

            $exact = $this->db->prepare(
                "SELECT id FROM trades WHERE challenge_id=? AND pair=? AND direction=?
                 AND entry_price=? AND pnl=? AND time_in BETWEEN ? AND ?"
            );
            $exact->execute([$challengeId, $p['pair'], $p['direction'], $p['entry_price'], $p['pnl'], $windowStart, $windowEnd]);
            $exactRows = $exact->fetchAll();

            if (count($exactRows) === 1) {
                $out[] = ['status' => 'matched', 'trade_id' => (int)$exactRows[0]['id']];
                continue;
            }
            if (count($exactRows) > 1) {
                $out[] = ['status' => 'attention', 'reason' => count($exactRows) . ' existing trades match on pair/direction/price/pnl within the time window — cannot tell which one this is.'];
                continue;
            }

            $near = $this->db->prepare(
                "SELECT id, time_in, entry_price, pnl FROM trades WHERE challenge_id=? AND pair=? AND direction=?
                 AND time_in BETWEEN ? AND ? AND (entry_price<>? OR pnl<>?) LIMIT 1"
            );
            $near->execute([$challengeId, $p['pair'], $p['direction'], $windowStart, $windowEnd, $p['entry_price'], $p['pnl']]);
            $nearRow = $near->fetch();
            if ($nearRow) {
                $out[] = ['status' => 'attention', 'reason' =>
                    "close in time to an existing trade (id {$nearRow['id']}, {$nearRow['time_in']}, entry {$nearRow['entry_price']}, pnl {$nearRow['pnl']}) " .
                    "but entry_price/pnl don't match Bitfunded's ({$p['entry_price']}, {$p['pnl']}) exactly."];
                continue;
            }

            $out[] = ['status' => 'new'];
        }
        return $out;
    }

    /**
     * §6: derived balance projected AFTER this import would apply (new + matched rows;
     * 'attention' rows are never written and are excluded), compared against Bitfunded's
     * own reported balance. Flags anything over $1 — sub-cent residuals are expected (see
     * CLAUDE.md v3.13.x: the journal stores P&L at 4 decimals, Bitfunded displays 2).
     */
    private function reconciliation($challenge, array $positions, array $matches, $funding, $manualBalance) {
        $matchedIds = [];
        foreach ($matches as $m) if ($m['status'] === 'matched') $matchedIds[] = $m['trade_id'];

        if ($matchedIds) {
            $ph = implode(',', array_fill(0, count($matchedIds), '?'));
            $s = $this->db->prepare("SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id=? AND result IN ('Win','Loss','Break Even') AND id NOT IN ($ph)");
            $s->execute(array_merge([$challenge['id']], $matchedIds));
        } else {
            $s = $this->db->prepare("SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id=? AND result IN ('Win','Loss','Break Even')");
            $s->execute([$challenge['id']]);
        }
        $baseSum = (float)$s->fetchColumn();

        $importedSum = 0.0;
        foreach ($positions as $i => $p) {
            if ($matches[$i]['status'] === 'attention') continue;
            $importedSum += ($p['pnl'] - $p['fees']);
        }

        $fundingAdj = $funding !== null ? $funding['funding_total'] : (float)($challenge['funding_adjustment'] ?? 0);
        $derived = round((float)$challenge['starting_balance'] + $baseSum + $importedSum - $fundingAdj, 4);

        $bitfundedBalance = null;
        if ($funding !== null && $funding['latest_balance'] !== null) $bitfundedBalance = (float)$funding['latest_balance'];
        elseif ($manualBalance !== null && $manualBalance !== '') $bitfundedBalance = (float)$manualBalance;

        $difference = $bitfundedBalance !== null ? round($derived - $bitfundedBalance, 4) : null;

        return [
            'derived_balance' => $derived,
            'bitfunded_balance' => $bitfundedBalance,
            'difference' => $difference,
            'flagged' => $difference !== null && abs($difference) > 1.0,
        ];
    }
}
