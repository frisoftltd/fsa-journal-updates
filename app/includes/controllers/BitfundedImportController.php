<?php
/**
 * FundedControl — Bitfunded Paste Importer (v3.16.1)
 * Handles: preview_bitfunded_import, confirm_bitfunded_import
 *
 * v3.16.1 (Phase 1b, B2): after each matched-row UPDATE or new-row INSERT, recomputes
 * actual_risk_pct/target_r/clean_rep/exit_quality via helpers.php::computeTradeRiskFields()
 * now that real fill data (entry_price, lot_size, exit_reason) exists. Never touches
 * stop_loss/take_profit — those stay exactly whatever the trader set pre-entry (v3.16.1
 * B1), or NULL for an unattended new import, same as before this release.
 *
 * Replaces thirteen migration files' worth of hand-typing with a page that parses
 * Bitfunded's own Position History (and, optionally, Transaction History for funding)
 * directly. See CLAUDE.md v3.14.0 for the full division-of-responsibility rationale —
 * this controller only ever writes execution fields (time_in, time_out, entry_price,
 * exit_price, lot_size, fees, pnl, net_pnl, result, exit_reason, source) and never
 * touches trade_variables, emotion_tag, setup_grade, the three note columns, stop_loss,
 * take_profit, strategy_id, screenshots, or a trade's id.
 *
 * v3.14.1 adds one narrow exception: for a MATCHED row only, if the existing trade
 * already has a stop_loss on file (set pre-entry, before this execution data ever
 * landed), r_multiple/risk_amount/r_multiple_source='recorded' are computed from that
 * stop against Bitfunded's own entry/exit and written alongside the execution fields —
 * see CLAUDE.md v3.14.1 for why this was a real, deliberately-flagged gap in v3.14.0.
 * A 'new' row is never given a stop_loss by this importer (stop_loss stays NULL, per the
 * division of responsibility above), so this never applies to inserts, and a matched row
 * with no stop_loss on file is left exactly as untouched as before — r_multiple/
 * risk_amount/r_multiple_source are simply omitted from that row's UPDATE.
 *
 * preview() and confirm() both re-parse the pasted text from the request on every call —
 * there is no server-side session cache of a prior preview. This keeps the two actions
 * stateless and guarantees confirm() always acts on exactly what's currently in the
 * textareas, not a preview computed against data that may have changed since.
 */
require_once __DIR__ . '/../bitfunded_parser.php';

class BitfundedImportController {
    const MATCH_WINDOW_SECONDS = 600; // +/-10 minutes, per CLAUDE.md v3.14.0 §4
    const PNL_MATCH_TOLERANCE = 0.01; // v3.14.4 -- see matchAll()

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
                $exitReasonForDb = $p['exit_reason'] !== '' ? $p['exit_reason'] : null;

                if ($m['status'] === 'matched') {
                    $sql = "UPDATE trades SET trade_date=?, time_in=?, time_out=?, entry_price=?, exit_price=?,
                            lot_size=?, fees=?, pnl=?, net_pnl=?, result=?, exit_reason=?, source='import'";
                    $params = [
                        substr($p['time_in'], 0, 10), $p['time_in'], $p['time_out'], $p['entry_price'], $p['exit_price'],
                        $p['lot_size'], $p['fees'], $p['pnl'], $net, $result, $exitReasonForDb,
                    ];

                    // §5: R is measurable, not estimated, once a real stop_loss exists —
                    // only ever computed here when the existing row already carries one;
                    // never invented, never overwriting an estimated value that has none.
                    if ($m['stop_loss'] !== null) {
                        $riskPerUnit = abs($p['entry_price'] - $m['stop_loss']);
                        if ($riskPerUnit > 0) {
                            $rMultiple = $p['direction'] === 'Short'
                                ? ($p['entry_price'] - $p['exit_price']) / $riskPerUnit
                                : ($p['exit_price'] - $p['entry_price']) / $riskPerUnit;
                            $riskAmount = round($riskPerUnit * $p['lot_size'], 4);
                            $sql .= ", r_multiple=?, risk_amount=?, r_multiple_source='recorded'";
                            $params[] = round($rMultiple, 4);
                            $params[] = $riskAmount;
                        }
                    }

                    $sql .= " WHERE id=? AND challenge_id=?";
                    $params[] = $m['trade_id'];
                    $params[] = $challenge['id'];
                    $this->db->prepare($sql)->execute($params);
                    $updated++;

                    // v3.16.1 B2: recompute actual_risk_pct/target_r/clean_rep/
                    // exit_quality now that real fill data (entry_price, lot_size,
                    // exit_reason) just landed. Never touches stop_loss/take_profit
                    // themselves — computeTradeRiskFields() only reads them, so whatever
                    // was set pre-entry (v3.16.1 B1) stays exactly as the trader left it.
                    // balance_at_day_start/planned_risk_pct are NOT recomputed here on
                    // purpose: they're a function of trade_date/challenge history, which
                    // this UPDATE doesn't change, and were already correct from the
                    // pre-entry save.
                    $riskFields = computeTradeRiskFields($this->db, $m['trade_id']);
                    $this->db->prepare(
                        "UPDATE trades SET actual_risk_pct=?, target_r=?, clean_rep=?, exit_quality=? WHERE id=?"
                    )->execute([
                        $riskFields['actual_risk_pct'], $riskFields['target_r'],
                        $riskFields['clean_rep'], $riskFields['exit_quality'], $m['trade_id'],
                    ]);
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
                        $result, $exitReasonForDb,
                    ]);
                    $newTradeId = (int)$this->db->lastInsertId();
                    // v3.16.1 B2: a brand-new import has no pre-entry data (stop_loss/
                    // take_profit stay NULL by this importer's own design), so
                    // actual_risk_pct/target_r/clean_rep resolve to null/null/0 here --
                    // but balance_at_day_start/planned_risk_pct and exit_quality
                    // ('unknown', since target_r is null) are real, useful facts even for
                    // an unattended import, and this is what lets EXIT_NO_TARGET count it
                    // correctly without waiting for a future edit to trigger the compute.
                    $riskFields = computeTradeRiskFields($this->db, $newTradeId);
                    persistTradeRiskFields($this->db, $newTradeId, $riskFields);
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
        if (trim($positionsRaw) === '') jsonError('Paste Bitfunded\'s Position History into Box 1 first.');
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
     * Matching rule (CLAUDE.md v3.14.0 §4, revised v3.14.4/v3.14.5/v3.14.6): pair +
     * direction exactly, entry_price consistent with the known corruption pattern (see
     * below), pnl within +/-0.01, time_in within +/-10 minutes. A ±5-minute (pair,
     * direction)-only window produced a false positive during the manual migrations this
     * importer replaces (BTCUSDT Long re-entries 4.5 minutes apart, same symbol, different
     * price and P&L — not a duplicate) — entry_price and pnl are not optional narrowing,
     * they're the actual duplicate signature.
     *
     * pnl is a tolerance, not an equality, because Bitfunded reports it at up to 4 decimal
     * places and this account's existing rows were hand-transcribed from screenshots at 2
     * (e.g. stored -98.68 against Bitfunded's real -98.6850) — an exact match would reject
     * every one of the 59 historical rows. 0.01 is comfortably inside that rounding gap
     * (at most half a cent) and nowhere near the dollars-wide gap between genuine distinct
     * trades that pair/direction/time-window already rule out.
     *
     * entry_price v3.14.5's 0.5% relative tolerance was itself wrong, confirmed against a
     * real full-account run: a full paste of challenge 6 with it in place still flagged 15
     * rows 'needs attention' purely on entry_price, spanning 0.9% off (ADA 0.1816 vs stored
     * 0.1800) to 100% off (PUMP 0.004412 vs stored 0.0000) — no single percentage covers
     * that range, because it isn't rounding error at all. Checking the actual stored values
     * against the incoming ones shows the real mechanism precisely: every historical
     * discrepancy is explained by TRUNCATING (not rounding — confirmed by JUP: 0.189
     * truncates to 0.18, matching the stored 0.1800, but *rounds* to 0.19, which would not)
     * the incoming price to exactly 2 decimal places. `entry_price` now matches if it's
     * either exactly equal to the incoming price (the normal case, and what keeps a
     * re-paste of already-correctly-imported rows idempotent) or equal to the incoming
     * price truncated to 2 decimals (the legacy hand-transcription case) — or if the
     * stored value is exactly 0, which is its own case: the pre-v3.14.5 DECIMAL(14,4)
     * column could truncate a genuinely sub-cent price to nothing, and no comparison
     * against a destroyed value can ever be meaningful, so a stored 0 accepts the match on
     * pair/direction/time/pnl alone rather than being compared at all.
     *
     * Three outcomes per row, never a silent guess:
     *   'new'       — no candidate at all.
     *   'matched'   — exactly one candidate consistent with the rule above.
     *   'attention' — more than one such candidate, or a near-match (same pair/direction/
     *                 time window, but entry_price or pnl doesn't fit) with zero exact
     *                 candidates. Nothing is written for these; the user decides.
     */
    private function matchAll($challengeId, array $positions): array {
        $out = [];
        foreach ($positions as $p) {
            $ts = strtotime($p['time_in']);
            $windowStart = date('Y-m-d H:i:s', $ts - self::MATCH_WINDOW_SECONDS);
            $windowEnd = date('Y-m-d H:i:s', $ts + self::MATCH_WINDOW_SECONDS);

            $exact = $this->db->prepare(
                "SELECT id, stop_loss FROM trades WHERE challenge_id=? AND pair=? AND direction=?
                 AND (entry_price = ? OR TRUNCATE(?, 2) = entry_price OR entry_price = 0)
                 AND ABS(pnl - ?) <= ? AND time_in BETWEEN ? AND ?"
            );
            $exact->execute([
                $challengeId, $p['pair'], $p['direction'],
                $p['entry_price'], $p['entry_price'],
                $p['pnl'], self::PNL_MATCH_TOLERANCE,
                $windowStart, $windowEnd,
            ]);
            $exactRows = $exact->fetchAll();

            if (count($exactRows) === 1) {
                $out[] = [
                    'status' => 'matched',
                    'trade_id' => (int)$exactRows[0]['id'],
                    'stop_loss' => $exactRows[0]['stop_loss'] !== null ? (float)$exactRows[0]['stop_loss'] : null,
                ];
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
