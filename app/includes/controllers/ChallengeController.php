
<?php
/**
 * FundedControl — Challenge Controller
 * Handles: get_challenges, get_active, add, update, delete, switch,
 * get_ladder_tiers, save_ladder_tiers
 */
class ChallengeController {
    const MAX_SANE_RISK_PCT = 10.0; // v3.27.2 — a risk ladder tier above this is almost
    // certainly a typo (10% of balance on one trade is already reckless), not a real
    // intended value. Rejected outright, not clamped, so the typo gets caught, not saved.

    private $db;
    private $uid;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    public function getAll() {
        $s = $this->db->prepare("SELECT * FROM challenges WHERE user_id=? ORDER BY is_active DESC, created_at DESC");
        $s->execute([$this->uid]);
        jsonResponse(enrichChallenges($this->db, $s->fetchAll()));
    }

    public function getActive() {
        $ch = getActiveChallenge();
        jsonResponse($ch ?: ['error' => 'No active challenge']);
    }

    /**
     * v3.27.2 §Phase 2 — a new challenge used to get zero risk_ladder_tiers rows (the
     * ladder table was write-only via hand-run migrations before this release), which is
     * why CalculatorController::autoRiskPreview()/getRiskStatus() showed "—" and "No
     * ladder configured" for every challenge except 6. Now requires one real, typed
     * risk % — no hidden default — and seeds exactly one open-ended tier ($0+) with it,
     * same shape as any other single-tier ladder. Challenge insert + ladder insert are
     * one transaction: a challenge should never exist with zero tiers again.
     */
    public function add() {
        $d = jsonInput();
        if (empty($d['name'])) jsonError('Challenge name required');

        $ladderRiskPct = isset($d['ladder_risk_pct']) && $d['ladder_risk_pct'] !== '' ? (float)$d['ladder_risk_pct'] : null;
        if ($ladderRiskPct === null || $ladderRiskPct <= 0) {
            jsonError('Set the initial risk ladder % (applies from $0, no upper limit) — there is no default.');
        }
        if ($ladderRiskPct > self::MAX_SANE_RISK_PCT) {
            jsonError('Risk ladder % over ' . self::MAX_SANE_RISK_PCT . '% is not allowed — check for a typo.');
        }

        $existing = $this->db->prepare("SELECT COUNT(*) FROM challenges WHERE user_id=?");
        $existing->execute([$this->uid]);
        $count = intval($existing->fetchColumn());
        $make_active = ($count === 0 || !empty($d['set_active']));

        try {
            $this->db->beginTransaction();

            if ($make_active) {
                $this->db->prepare("UPDATE challenges SET is_active=0 WHERE user_id=?")->execute([$this->uid]);
            }

            $this->db->prepare("INSERT INTO challenges (user_id, name, prop_firm, challenge_phase, starting_balance, max_drawdown_pct, drawdown_type, daily_loss_limit, risk_per_trade_pct, profit_target_pct, default_leverage, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
                ->execute([
                    $this->uid, trim($d['name']),
                    $d['prop_firm'] ?? '', $d['challenge_phase'] ?? 'Phase 1',
                    num($d['starting_balance'] ?? 10000),
                    num($d['max_drawdown_pct'] ?? 10), $d['drawdown_type'] ?? 'static',
                    num($d['daily_loss_limit'] ?? 500),
                    num($d['risk_per_trade_pct'] ?? 0.5), num($d['profit_target_pct'] ?? 8),
                    (isset($d['default_leverage']) && $d['default_leverage'] !== '') ? num($d['default_leverage']) : null,
                    $make_active ? 1 : 0
                ]);
            $newId = (int)$this->db->lastInsertId();

            $this->db->prepare("INSERT INTO risk_ladder_tiers (challenge_id, lower_balance, upper_balance, risk_pct, active) VALUES (?, 0.00, NULL, ?, 1)")
                ->execute([$newId, round($ladderRiskPct, 3)]);

            $this->db->commit();
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            jsonError('Could not create challenge: ' . $e->getMessage());
        }

        jsonResponse(['success' => true, 'id' => $newId]);
    }

    public function update() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid challenge ID');
        if (empty($d['name'])) jsonError('Challenge name required');

        $this->db->prepare("UPDATE challenges SET name=?, prop_firm=?, challenge_phase=?, starting_balance=?, max_drawdown_pct=?, drawdown_type=?, daily_loss_limit=?, risk_per_trade_pct=?, profit_target_pct=?, default_leverage=?, status=? WHERE id=? AND user_id=?")
            ->execute([
                trim($d['name']), $d['prop_firm'] ?? '', $d['challenge_phase'] ?? 'Phase 1',
                num($d['starting_balance'] ?? 10000),
                num($d['max_drawdown_pct'] ?? 10), $d['drawdown_type'] ?? 'static',
                num($d['daily_loss_limit'] ?? 500),
                num($d['risk_per_trade_pct'] ?? 0.5), num($d['profit_target_pct'] ?? 8),
                (isset($d['default_leverage']) && $d['default_leverage'] !== '') ? num($d['default_leverage']) : null,
                $d['status'] ?? 'active', $id, $this->uid
            ]);
        jsonResponse(['success' => true]);
    }

    public function delete() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid challenge ID');

        $count = $this->db->prepare("SELECT COUNT(*) FROM challenges WHERE user_id=?");
        $count->execute([$this->uid]);
        if (intval($count->fetchColumn()) <= 1) jsonError('Cannot delete your only challenge');

        $ch = $this->db->prepare("SELECT is_active FROM challenges WHERE id=? AND user_id=?");
        $ch->execute([$id, $this->uid]);
        $row = $ch->fetch();
        if (!$row) jsonError('Challenge not found');
        $was_active = $row['is_active'] ?? 0;

        $this->db->prepare("DELETE FROM trades WHERE challenge_id=? AND user_id=?")->execute([$id, $this->uid]);
        $this->db->prepare("DELETE FROM challenges WHERE id=? AND user_id=?")->execute([$id, $this->uid]);

        if ($was_active) {
            $next = $this->db->prepare("SELECT id FROM challenges WHERE user_id=? ORDER BY created_at DESC LIMIT 1");
            $next->execute([$this->uid]);
            $nextId = $next->fetchColumn();
            if ($nextId) $this->db->prepare("UPDATE challenges SET is_active=1 WHERE id=?")->execute([$nextId]);
        }
        jsonResponse(['success' => true]);
    }

    public function switchTo() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid challenge ID');

        $ch = $this->db->prepare("SELECT id FROM challenges WHERE id=? AND user_id=?");
        $ch->execute([$id, $this->uid]);
        if (!$ch->fetch()) jsonError('Challenge not found');

        $this->db->prepare("UPDATE challenges SET is_active=0 WHERE user_id=?")->execute([$this->uid]);
        $this->db->prepare("UPDATE challenges SET is_active=1 WHERE id=? AND user_id=?")->execute([$id, $this->uid]);
        jsonResponse(['success' => true]);
    }

    /**
     * v3.27.2 — read-only, for the Edit Challenge → Risk Ladder editor to load its
     * current state. Same WHERE challenge_id=? AND active=1 key every other ladder
     * consumer (helpers.php::ladderTierForBalance(), CalculatorController::
     * getRiskStatus()) reads — one source of truth, no separate "editor's own copy."
     */
    public function getLadder() {
        $d = $_GET;
        $challengeId = validId($d['challenge_id'] ?? 0);
        if (!$challengeId) jsonError('Select a challenge first.');
        $cs = $this->db->prepare("SELECT id FROM challenges WHERE id=? AND user_id=?");
        $cs->execute([$challengeId, $this->uid]);
        if (!$cs->fetch()) jsonError('Challenge not found.');

        $s = $this->db->prepare("SELECT lower_balance, upper_balance, risk_pct FROM risk_ladder_tiers WHERE challenge_id=? AND active=1 ORDER BY lower_balance ASC");
        $s->execute([$challengeId]);
        jsonResponse(['tiers' => array_map(function ($t) {
            return [
                'lower_balance' => (float)$t['lower_balance'],
                'upper_balance' => $t['upper_balance'] !== null ? (float)$t['upper_balance'] : null,
                'risk_pct' => (float)$t['risk_pct'],
            ];
        }, $s->fetchAll())]);
    }

    /**
     * v3.27.2 — replaces a challenge's active ladder. Same history pattern challenge 6's
     * own rows 1-3 already established by hand (2026_09_19_0001): the previous active
     * rows are deactivated, never deleted or edited in place, so a past tier a trade was
     * actually sized against stays on record. An empty $tiers array is a deliberate,
     * valid "clear the ladder back to unconfigured" save, not an error — the trader can
     * always re-add tiers later; this does not fall back to any default risk %.
     *
     * Does NOT touch any other challenge's tiers, and never backfills a ladder onto a
     * challenge the caller didn't explicitly ask to change — the only way challenge 6's
     * $9,250/$9,500 history or any other challenge's rows get touched is a direct call
     * naming that challenge_id.
     */
    public function saveLadder() {
        $d = jsonInput();
        $challengeId = validId($d['challenge_id'] ?? 0);
        if (!$challengeId) jsonError('Select a challenge first.');
        $cs = $this->db->prepare("SELECT id FROM challenges WHERE id=? AND user_id=?");
        $cs->execute([$challengeId, $this->uid]);
        if (!$cs->fetch()) jsonError('Challenge not found.');

        $tiers = is_array($d['tiers'] ?? null) ? $d['tiers'] : [];
        [$ok, $error, $normalized] = $this->validateLadderTiers($tiers);
        if (!$ok) jsonError($error);

        try {
            $this->db->beginTransaction();
            $this->db->prepare("UPDATE risk_ladder_tiers SET active=0 WHERE challenge_id=? AND active=1")->execute([$challengeId]);
            if ($normalized) {
                $ins = $this->db->prepare("INSERT INTO risk_ladder_tiers (challenge_id, lower_balance, upper_balance, risk_pct, active) VALUES (?,?,?,?,1)");
                foreach ($normalized as $t) {
                    $ins->execute([$challengeId, $t['lower_balance'], $t['upper_balance'], $t['risk_pct']]);
                }
            }
            $this->db->commit();
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            jsonError('Could not save ladder: ' . $e->getMessage());
        }

        jsonResponse(['success' => true, 'tier_count' => count($normalized)]);
    }

    /**
     * v3.27.2 — shared by add() (one forced tier) and saveLadder() (any number). Rules,
     * per the briefing: no gaps, no overlaps, the first tier starts at exactly $0, only
     * the LAST tier may be open-ended (upper_balance NULL), and risk_pct must be a real,
     * sane per-trade number (0 < pct <= MAX_SANE_RISK_PCT). "No gaps, no overlaps" is
     * enforced as one exact-equality check (each tier's lower must equal the previous
     * tier's upper) rather than a >=/<= pair — equality rejects both a gap (lower >
     * previous upper) and an overlap (lower < previous upper) with the same rule, no
     * separate case for each. Returns [true, null, normalized-and-sorted-tiers] or
     * [false, message, []] — never partially validates or saves a subset.
     */
    private function validateLadderTiers(array $tiers): array {
        if (empty($tiers)) return [true, null, []];

        $t = [];
        foreach ($tiers as $raw) {
            $lower = isset($raw['lower_balance']) && $raw['lower_balance'] !== '' ? round((float)$raw['lower_balance'], 2) : null;
            $upperRaw = $raw['upper_balance'] ?? null;
            $upper = ($upperRaw === null || $upperRaw === '') ? null : round((float)$upperRaw, 2);
            $riskPct = isset($raw['risk_pct']) && $raw['risk_pct'] !== '' ? round((float)$raw['risk_pct'], 3) : null;
            if ($lower === null || $riskPct === null) return [false, 'Every tier needs a lower balance and a risk %.', []];
            $t[] = ['lower_balance' => $lower, 'upper_balance' => $upper, 'risk_pct' => $riskPct];
        }

        usort($t, fn($a, $b) => $a['lower_balance'] <=> $b['lower_balance']);

        foreach ($t as $i => $row) {
            if ($row['lower_balance'] < 0) return [false, 'A tier\'s lower balance can\'t be negative.', []];
            if ($row['risk_pct'] <= 0 || $row['risk_pct'] > self::MAX_SANE_RISK_PCT) {
                return [false, "Tier risk % must be greater than 0 and no more than " . self::MAX_SANE_RISK_PCT . "% (got {$row['risk_pct']}%).", []];
            }
            if ($row['upper_balance'] !== null && $row['upper_balance'] <= $row['lower_balance']) {
                return [false, 'Each tier\'s upper balance must be greater than its lower balance.', []];
            }
            if ($i === 0 && $row['lower_balance'] !== 0.0) {
                return [false, 'The first tier must start at $0.', []];
            }
            if ($i === count($t) - 1 && $row['upper_balance'] !== null) {
                return [false, 'The last tier must have no upper limit (it covers "and above").', []];
            }
            if ($i > 0) {
                $prevUpper = $t[$i - 1]['upper_balance'];
                if ($prevUpper === null) {
                    return [false, 'Only the last tier may have no upper limit — an earlier tier is open-ended.', []];
                }
                if (abs($row['lower_balance'] - $prevUpper) > 0.001) {
                    return [false, "Tiers must be continuous: tier " . ($i + 1) . " starts at \${$row['lower_balance']} but the previous tier ends at \${$prevUpper} (gap or overlap).", []];
                }
            }
        }

        return [true, null, $t];
    }
}
