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
    $ch = $s->fetch() ?: null;
    return $ch ? enrichChallenge($db, $ch) : null;
}

/**
 * v3.18.1 — THE single balance formula for a challenge: `starting_balance + SUM(net_pnl
 * of closed trades[, strictly before $beforeDate if given]) - funding_adjustment`. Every
 * place in this codebase that needs "what does this account have" (enrichChallenge()'s
 * current_balance) or "what did it have at the start of some date" (balanceAtDayStart(),
 * below, is now a thin wrapper around this) must go through here — not a second,
 * independently-written copy of this sum.
 *
 * This closes two related incidents (see CLAUDE.md v3.18.1): before this,
 * balanceAtDayStart() duplicated this formula without the funding_adjustment term at
 * all (the Risk Calculator, its ladder-tier lookup, and the trade-limits status strip
 * were all funding-blind), and separately, BitfundedImportController::confirm() had
 * subtracted a matched trade's own attributed funding inside that trade's own net_pnl
 * *and* rolled the same funding into the challenge-level funding_adjustment total this
 * function subtracts — double-counting it. net_pnl is now always `pnl - fees` (see
 * BitfundedImportController), so funding is subtracted exactly once, here.
 *
 * $beforeDate === null means "as of right now" (every closed trade counts) —
 * enrichChallenge()'s job. A `Y-m-d` string means "balance before the first trade of
 * that date" — balanceAtDayStart()'s job. $excludeTradeId is a defensive pass-through
 * (kept from balanceAtDayStart()'s original signature) for a caller recomputing a
 * trade's own balance mid-save.
 */
function challengeBalance(PDO $db, int $challengeId, ?string $beforeDate = null, ?int $excludeTradeId = null): float {
    $cs = $db->prepare("SELECT starting_balance, funding_adjustment FROM challenges WHERE id=?");
    $cs->execute([$challengeId]);
    $ch = $cs->fetch();
    $starting = (float)($ch['starting_balance'] ?? 0);
    $funding  = (float)($ch['funding_adjustment'] ?? 0);

    $sql = "SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id=? AND result IN ('Win','Loss','Break Even')";
    $params = [$challengeId];
    if ($beforeDate !== null) { $sql .= " AND trade_date < ?"; $params[] = $beforeDate; }
    if ($excludeTradeId) { $sql .= " AND id <> ?"; $params[] = $excludeTradeId; }
    $s = $db->prepare($sql);
    $s->execute($params);
    $realised = (float)$s->fetchColumn();

    return round($starting + $realised - $funding, 2);
}

/**
 * v3.13.0 — challenges.current_balance was a stored column nothing ever recalculated,
 * and it drifted silently for five weeks on the Bitfunded Altcoin challenge (see
 * CLAUDE.md). The column is gone; balance is derived here, every time, via
 * challengeBalance() (v3.18.1 — previously an inline copy of that same formula), and
 * written back onto the array under the same 'current_balance' key so every existing
 * caller (PHP and the JSON API surface JS reads) keeps working unchanged.
 *
 * max_drawdown_pct / profit_target_pct are similarly overridden — as a percentage of
 * starting_balance — whenever max_loss_amt / profit_target_amt is on file. Some prop
 * firms (Bitfunded included) state challenge criteria as currency amounts per stage, not
 * percentages; where an amount is known it is the source of truth, not the stored pct
 * column (which stays as-is, and remains authoritative, for challenges/prop firms where
 * only a percentage was ever given).
 *
 * Call this on every challenge row before it reaches a controller response or a
 * review-engine calculation. Never read challenges.current_balance directly — there is
 * nothing left to read; the column was dropped in 2026_09_17_0004.
 */
function enrichChallenge($db, $challenge) {
    if (!$challenge) return $challenge;
    $challenge['current_balance'] = challengeBalance($db, (int)$challenge['id']);
    $starting = (float)($challenge['starting_balance'] ?? 0);

    $maxLossAmt = $challenge['max_loss_amt'] ?? null;
    if ($starting > 0 && $maxLossAmt !== null && (float)$maxLossAmt > 0) {
        $challenge['max_drawdown_pct'] = round((float)$maxLossAmt / $starting * 100, 4);
    }
    $profitTargetAmt = $challenge['profit_target_amt'] ?? null;
    if ($starting > 0 && $profitTargetAmt !== null && (float)$profitTargetAmt > 0) {
        $challenge['profit_target_pct'] = round((float)$profitTargetAmt / $starting * 100, 4);
    }
    return $challenge;
}

/**
 * Apply enrichChallenge() to a list of challenge rows (ChallengeController::getAll(),
 * ReviewEngineController::userChallengeMap()) — same derivation, once per row.
 */
function enrichChallenges($db, array $challenges) {
    foreach ($challenges as &$c) $c = enrichChallenge($db, $c);
    unset($c);
    return $challenges;
}

/**
 * "Static" drawdown (added v3.14.7): distance below starting_balance, floored at 0 —
 * how most prop firms, Bitfunded included, actually judge a Maximum Loss rule. Confirmed
 * against Bitfunded's own dashboard: it reports 264.82 used of a 1,000 allowance,
 * matching 10,000 - 9,735.17 (starting_balance - current_balance) exactly — not a
 * peak-relative figure. This is the default for challenges.drawdown_type and the single
 * shared implementation for every consumer that measures drawdown against the starting
 * balance rather than an equity high-water mark: AlertController's MAX DRAWDOWN REACHED
 * threshold, StatsController's sidebar dd_pct, StatsController's current_drawdown_pct
 * when drawdown_type='static', and ReviewEngineController::ruleDrawdownProximity() — one
 * formula to get right, not four copies to keep in sync by hand (they used to be four
 * near-identical inline copies; unified here in the same release that added the setting).
 *
 * $challenge must already be enrichChallenge()'d — reads current_balance, never
 * challenges.current_balance directly (that column doesn't exist, see enrichChallenge()
 * above). Not rounded — callers already round at their own display precision.
 */
function staticDrawdownPct(array $challenge): float {
    $starting = (float)($challenge['starting_balance'] ?? 0);
    if ($starting <= 0) return 0.0;
    $current = (float)($challenge['current_balance'] ?? $starting);
    return abs(min(0, $current - $starting)) / $starting * 100;
}

/**
 * v3.17.0 (Auto Risk Calculator) — the account balance at which this challenge fails its
 * Maximum Loss rule. $challenge must already be enrichChallenge()'d: max_drawdown_pct is
 * read post-enrichment specifically so a challenge whose criteria are stated as a currency
 * amount (max_loss_amt, e.g. Bitfunded's $1,000-per-stage rule) is honored via the same
 * amount-to-percentage conversion enrichChallenge() already does for every other consumer
 * of max_drawdown_pct — this function does not re-read max_loss_amt itself, to avoid a
 * second, independently-maintained copy of that preference rule.
 */
function failureBalance(array $challenge): float {
    $starting = (float)($challenge['starting_balance'] ?? 0);
    $maxDrawdownPct = (float)($challenge['max_drawdown_pct'] ?? 0);
    return round($starting * (1 - $maxDrawdownPct / 100), 2);
}

/**
 * v3.17.0 (Auto Risk Calculator) — [Monday, Sunday] of the week containing $date
 * (Y-m-d), inclusive on both ends. PHP's 'N' format (ISO-8601 day-of-week, 1=Monday,
 * 7=Sunday) makes this a plain offset rather than a special-cased "what if today is
 * Sunday" branch.
 */
function weekBounds(string $date): array {
    $d = new DateTime($date);
    $dow = (int)$d->format('N');
    $monday = (clone $d)->modify('-' . ($dow - 1) . ' days')->format('Y-m-d');
    $sunday = (clone $d)->modify('+' . (7 - $dow) . ' days')->format('Y-m-d');
    return [$monday, $sunday];
}

/**
 * v3.17.1 — live trade-limit counts (today's trades, this week's trades, today's losses,
 * today's net P&L) against challenge_limits, plus a single STOP reason if any configured
 * limit has been reached. Extracted from CalculatorController::getRiskStatus() (v3.17.0)
 * so TradeController::saveTrade() can enforce the exact same rule server-side, rather
 * than a second, independently-maintained copy of the four-condition check — one place
 * that decides "can a new trade be logged right now," the same principle as
 * ladderTierForBalance() being the one place that reads the ladder.
 *
 * A limit column that's NULL (no challenge_limits row at all, or an individual NULL
 * column) is "not tracked" — it can never trigger a stop, same "absence of information
 * is not a recorded zero" convention as everywhere else limits appear in this codebase.
 *
 * Checked in order, first breach wins: daily trades, weekly trades, daily losses, daily
 * loss $ — "the most actionable reason first," not a claimed severity ranking, since
 * neither the v3.17.0 nor v3.17.1 briefing specified what happens when more than one
 * limit is breached at once.
 */
function tradeLimitStatus(PDO $db, int $challengeId): array {
    $ls = $db->prepare("SELECT max_trades_day, max_trades_week, max_losses_day, daily_loss_usd FROM challenge_limits WHERE challenge_id=?");
    $ls->execute([$challengeId]);
    $limits = $ls->fetch() ?: ['max_trades_day' => null, 'max_trades_week' => null, 'max_losses_day' => null, 'daily_loss_usd' => null];

    $today = date('Y-m-d');
    [$monday, $sunday] = weekBounds($today);

    $td = $db->prepare("SELECT COUNT(*) FROM trades WHERE challenge_id=? AND trade_date=?");
    $td->execute([$challengeId, $today]);
    $tradesToday = (int)$td->fetchColumn();

    $tw = $db->prepare("SELECT COUNT(*) FROM trades WHERE challenge_id=? AND trade_date BETWEEN ? AND ?");
    $tw->execute([$challengeId, $monday, $sunday]);
    $tradesWeek = (int)$tw->fetchColumn();

    $ld = $db->prepare("SELECT COUNT(*) FROM trades WHERE challenge_id=? AND result='Loss' AND trade_date=?");
    $ld->execute([$challengeId, $today]);
    $lossesToday = (int)$ld->fetchColumn();

    $pl = $db->prepare("SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id=? AND trade_date=?");
    $pl->execute([$challengeId, $today]);
    $dailyPnl = round((float)$pl->fetchColumn(), 2);

    $reason = null;
    if ($limits['max_trades_day'] !== null && $tradesToday >= (int)$limits['max_trades_day']) {
        $reason = "daily trade limit reached ({$tradesToday}/{$limits['max_trades_day']})";
    } elseif ($limits['max_trades_week'] !== null && $tradesWeek >= (int)$limits['max_trades_week']) {
        $reason = "weekly trade limit reached ({$tradesWeek}/{$limits['max_trades_week']})";
    } elseif ($limits['max_losses_day'] !== null && $lossesToday >= (int)$limits['max_losses_day']) {
        $reason = "daily loss-count limit reached ({$lossesToday}/{$limits['max_losses_day']})";
    } elseif ($limits['daily_loss_usd'] !== null && $dailyPnl <= -1 * (float)$limits['daily_loss_usd']) {
        $reason = 'daily loss limit reached ($' . number_format(abs($dailyPnl), 2) . ' / $' . number_format((float)$limits['daily_loss_usd'], 2) . ')';
    }

    return [
        'limits' => [
            'max_trades_day' => $limits['max_trades_day'] !== null ? (int)$limits['max_trades_day'] : null,
            'max_trades_week' => $limits['max_trades_week'] !== null ? (int)$limits['max_trades_week'] : null,
            'max_losses_day' => $limits['max_losses_day'] !== null ? (int)$limits['max_losses_day'] : null,
            'daily_loss_usd' => $limits['daily_loss_usd'] !== null ? (float)$limits['daily_loss_usd'] : null,
        ],
        'trades_today' => $tradesToday,
        'trades_week' => $tradesWeek,
        'losses_today' => $lossesToday,
        'daily_pnl' => $dailyPnl,
        'stopped' => $reason !== null,
        'reason' => $reason,
    ];
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

/**
 * v3.16.1 (Phase 1b) — balance before the first trade of $tradeDate. As of v3.18.1 this
 * is a thin wrapper around challengeBalance() (see above) rather than its own copy of
 * the formula — the pre-v3.18.1 version summed starting_balance + net_pnl only, with no
 * funding_adjustment term at all, which is why the Risk Calculator's "Balance (today,
 * auto)", its Available Margin, the trade-limits status strip, and the ladder-tier
 * lookup (all of which read this function, directly or via computeTradeRiskFields())
 * were funding-blind. See CLAUDE.md v3.18.1.
 *
 * Shared by computeTradeRiskFields() below and CalculatorController::sizePreview() (the
 * B4 pre-trade sizing panel) so both read the exact same definition rather than two
 * independently-written copies of the same sum drifting apart over time.
 */
function balanceAtDayStart(PDO $db, int $challengeId, string $tradeDate, ?int $excludeTradeId = null): float {
    return challengeBalance($db, $challengeId, $tradeDate, $excludeTradeId);
}

/**
 * v3.16.1 (Phase 1b) — ladder tier for a given balance. Always reads risk_ladder_tiers
 * WHERE active=1 live; never a hardcoded percentage. Per the B1 briefing: "The ladder
 * changed once already because I seeded it wrong; it must not be able to drift out of
 * sync again" — every consumer of the ladder (this function, ReviewEngineController's
 * own getLadderTiers()/ladderLookup(), the migrations) reads the same table, so a
 * correction to risk_ladder_tiers takes effect everywhere the next time each is called,
 * with nothing left to independently update by hand.
 */
function ladderTierForBalance(PDO $db, int $challengeId, float $balance): ?float {
    $s = $db->prepare("SELECT lower_balance, upper_balance, risk_pct FROM risk_ladder_tiers WHERE challenge_id=? AND active=1 ORDER BY lower_balance ASC");
    $s->execute([$challengeId]);
    foreach ($s->fetchAll() as $tier) {
        $lower = (float)$tier['lower_balance'];
        $upper = $tier['upper_balance'] !== null ? (float)$tier['upper_balance'] : null;
        if ($balance >= $lower && ($upper === null || $balance < $upper)) return (float)$tier['risk_pct'];
    }
    return null;
}

/**
 * v3.16.1 (Phase 1b, B1/B2) — computes the seven Size-Integrity / Exit-Quality columns
 * for one trade, reading whatever is CURRENTLY on the row (and in trade_journal) rather
 * than taking values as arguments. This is what makes it safe to call from both
 * TradeController::saveTrade() (right after a pre-entry insert/update, where entry_price/
 * lot_size are usually still null — this form has had no execution inputs since v3.14.0)
 * and BitfundedImportController::confirm() (right after its own execution-field UPDATE,
 * where entry_price/lot_size/exit_reason just became real) — same function, same
 * definitions, called at two different points in a trade's life as more of its data
 * becomes known. Every figure that can't yet be derived from what's on the row comes back
 * null (or 0 for clean_rep), never guessed — degrading gracefully is the point, not an
 * edge case to special-case around.
 *
 * clean_rep additionally requires a trade_journal row with phase='pre_entry' to exist —
 * queried fresh here rather than trusted from a caller-supplied flag, so this always
 * reflects whatever was actually just persisted, regardless of call order.
 */
function computeTradeRiskFields(PDO $db, int $tradeId): array {
    $out = [
        'balance_at_day_start' => null, 'planned_risk_pct' => null, 'actual_risk_pct' => null,
        'risk_deviation_pct' => null, 'target_r' => null, 'clean_rep' => 0, 'exit_quality' => null,
    ];

    $s = $db->prepare("SELECT challenge_id, trade_date, entry_price, stop_loss, take_profit, lot_size, exit_reason, result FROM trades WHERE id=?");
    $s->execute([$tradeId]);
    $t = $s->fetch();
    if (!$t || !$t['challenge_id'] || !$t['trade_date']) return $out;

    $challengeId = (int)$t['challenge_id'];
    $balanceAtDayStart = balanceAtDayStart($db, $challengeId, $t['trade_date'], $tradeId);
    $out['balance_at_day_start'] = $balanceAtDayStart;

    $planned = ladderTierForBalance($db, $challengeId, $balanceAtDayStart);
    $out['planned_risk_pct'] = $planned;

    $entry = $t['entry_price']; $stop = $t['stop_loss']; $target = $t['take_profit']; $lot = $t['lot_size'];

    if ($entry !== null && $stop !== null && $lot !== null && $balanceAtDayStart > 0) {
        $out['actual_risk_pct'] = round(abs((float)$entry - (float)$stop) * (float)$lot / $balanceAtDayStart * 100, 3);
    }
    if ($out['actual_risk_pct'] !== null && $planned !== null && $planned > 0) {
        $out['risk_deviation_pct'] = round(($out['actual_risk_pct'] / $planned - 1) * 100, 2);
    }
    // Signed, no direction branch — see CLAUDE.md v3.16.0 for why this is correct for
    // both Long and Short by construction and exposes (rather than masks) a stop/target
    // on the wrong side of entry as a negative value.
    if ($entry !== null && $stop !== null && $target !== null && (float)$entry != (float)$stop) {
        $out['target_r'] = round(((float)$target - (float)$entry) / ((float)$entry - (float)$stop), 2);
    }

    $pj = $db->prepare("SELECT COUNT(*) FROM trade_journal WHERE trade_id=? AND phase='pre_entry'");
    $pj->execute([$tradeId]);
    $hasPreEntry = (int)$pj->fetchColumn() > 0;

    $exitReason = $t['exit_reason'];
    $out['clean_rep'] = ($hasPreEntry && $stop !== null && $target !== null && in_array($exitReason, ['Take Profit', 'Stop Loss'], true)) ? 1 : 0;

    // v3.16.1 A3(a): 'target_hit_sub_gate' (renamed from 'target_hit_short' — see
    // 2026_09_19_0007) for a Take Profit exit whose target_r sits below the 2.5 gate.
    //
    // v3.16.4: an unresolved trade (result not yet Win/Loss/Break Even — the same
    // closed-trades-only test used everywhere else in this codebase) gets 'open', checked
    // first and before target_r's null check specifically. Before this, a trade that
    // hadn't closed yet and a trade that HAD closed but had no stop/target on file both
    // landed on the same 'unknown' — two different facts wearing one label. 'open' is not
    // a judgement (there's nothing to judge yet); it only ever means "ask again once this
    // closes."
    if (!in_array($t['result'], ['Win', 'Loss', 'Break Even'], true)) {
        $out['exit_quality'] = 'open';
    } elseif ($exitReason === 'Manual Closing') {
        $out['exit_quality'] = 'manual_close';
    } elseif ($out['target_r'] === null) {
        $out['exit_quality'] = 'unknown';
    } elseif ($exitReason === 'Take Profit') {
        $out['exit_quality'] = $out['target_r'] >= 2.5 ? 'target_hit_valid' : 'target_hit_sub_gate';
    } elseif ($exitReason === 'Stop Loss') {
        $out['exit_quality'] = $out['target_r'] >= 2.5 ? 'stopped_valid' : 'stopped_short';
    } else {
        $out['exit_quality'] = 'unknown';
    }

    return $out;
}

/**
 * Report Card (v3.18.0) — [startUtcDateTime, endUtcDateTime) for a session block on
 * $date. Handles midnight-crossing (build briefing §4.1 rule 8): end <= start means the
 * block's end belongs to the next calendar day, not a zero/negative-length window.
 * Shared by ReportCardController (single-day card view) and ReportCardAiController
 * (multi-day AI review payload) — one definition of "which UTC instant does this block
 * actually span," not two copies that could drift.
 */
function reportCardBlockWindow(string $date, string $startUtc, string $endUtc): array {
    $start = new DateTime("$date $startUtc", new DateTimeZone('UTC'));
    $end = new DateTime("$date $endUtc", new DateTimeZone('UTC'));
    if ($end <= $start) $end->modify('+1 day');
    return [$start, $end];
}

/** Writes computeTradeRiskFields()'s output onto the row. Separate from the compute step so a caller can inspect the values (e.g. for a response) before/without persisting, though every current caller persists immediately. */
function persistTradeRiskFields(PDO $db, int $tradeId, array $fields): void {
    $db->prepare(
        "UPDATE trades SET balance_at_day_start=?, planned_risk_pct=?, actual_risk_pct=?, risk_deviation_pct=?, target_r=?, clean_rep=?, exit_quality=? WHERE id=?"
    )->execute([
        $fields['balance_at_day_start'], $fields['planned_risk_pct'], $fields['actual_risk_pct'],
        $fields['risk_deviation_pct'], $fields['target_r'], $fields['clean_rep'], $fields['exit_quality'],
        $tradeId,
    ]);
}
