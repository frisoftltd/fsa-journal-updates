<?php
/**
 * FundedControl — Daily Report Card AI Review Controller (v3.18.0)
 *
 * Builds the behaviour+thinking payload, calls the Anthropic Messages API with a forced
 * tool call (guarantees structured JSON back — no manual "hope it's valid JSON" parsing),
 * stores the result, and explodes it into report_card_ai_findings.
 *
 * Requires ANTHROPIC_API_KEY defined in includes/config.php (never committed to this
 * repo, same as every other secret — see CLAUDE.md §13 rule 4). If it isn't set, a run
 * fails loudly with status='failed' and a clear error_message; it never silently no-ops.
 *
 * Judgment call: §7.3 asks for this to "run as a background job... never block the page
 * request." This stack has no queue/worker infrastructure (shared Namecheap hosting, no
 * frameworks — see CLAUDE.md §1). Approximated here as a single synchronous request that
 * still passes through the pending -> running -> complete/failed states the schema
 * expects (so the status column and UI are meaningful even though nothing actually runs
 * concurrently), plus report_card_cron.php (site root, token-protected like migrate.php)
 * for the "optional nightly job" / "weekly review on a schedule" pieces — intended to be
 * hit by a cPanel Cron Job, since that's the only scheduling primitive this hosting
 * actually offers. A real job queue is a bigger infrastructure change than this briefing
 * scoped.
 */
class ReportCardAiController {
    private $db;

    const MODEL = 'claude-sonnet-5';
    const PROMPT_VERSION = 'v1';
    const API_URL = 'https://api.anthropic.com/v1/messages';
    const ANTHROPIC_VERSION = '2023-06-01';

    public function __construct() {
        $this->db = getDB();
    }

    // ══════════════════════════════════════════════════════════════════
    // SESSION-AUTHENTICATED ENDPOINTS
    // ══════════════════════════════════════════════════════════════════

    public function runReview() {
        $uid = uid();
        $d = jsonInput();
        $cardId = validId($d['card_id'] ?? 0);
        if (!$cardId) jsonError('Invalid card');
        $c = $this->db->prepare("SELECT * FROM report_cards WHERE id=? AND user_id=?");
        $c->execute([$cardId, $uid]);
        $card = $c->fetch();
        if (!$card) jsonError('Invalid card');
        // §7.3: manual button on a *complete* card only.
        if ($card['status'] !== 'complete') {
            jsonError('Run AI Review is only available once the card is complete — overall grade, primary goal, and every block grade filled in.');
        }
        jsonResponse($this->runFor($uid, 'daily', $card['card_date'], $card['card_date'], $cardId, (int)$card['challenge_id']));
    }

    public function runWeeklyReview() {
        $uid = uid();
        $d = jsonInput();
        $end = $d['end_date'] ?? date('Y-m-d');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) jsonError('Invalid date');
        $start = (new DateTime($end))->modify('-6 days')->format('Y-m-d');
        $ch = getActiveChallenge();
        jsonResponse($this->runFor($uid, 'weekly', $start, $end, null, (int)($ch['id'] ?? 0)));
    }

    public function getReviews() {
        $uid = uid();
        $cardId = validId($_GET['card_id'] ?? 0);
        if ($cardId) {
            $o = $this->db->prepare("SELECT id FROM report_cards WHERE id=? AND user_id=?");
            $o->execute([$cardId, $uid]);
            if (!$o->fetchColumn()) jsonError('Invalid card');
            $s = $this->db->prepare(
                "SELECT id, scope, period_start, period_end, status, alignment_score, discipline_score, summary, one_change, suggested_goal, created_at, completed_at
                 FROM report_card_ai_reviews WHERE card_id=? ORDER BY created_at DESC"
            );
            $s->execute([$cardId]);
        } else {
            $scope = in_array($_GET['scope'] ?? '', ['daily', 'weekly', 'monthly'], true) ? $_GET['scope'] : 'weekly';
            $limit = min(52, max(1, (int)($_GET['limit'] ?? 12)));
            $s = $this->db->prepare(
                "SELECT id, scope, period_start, period_end, status, alignment_score, discipline_score, summary, one_change, suggested_goal, created_at, completed_at
                 FROM report_card_ai_reviews WHERE user_id=? AND scope=? ORDER BY created_at DESC LIMIT ?"
            );
            $s->bindValue(1, $uid, PDO::PARAM_INT);
            $s->bindValue(2, $scope, PDO::PARAM_STR);
            $s->bindValue(3, $limit, PDO::PARAM_INT);
            $s->execute();
        }
        jsonResponse($s->fetchAll());
    }

    public function getReview() {
        $uid = uid();
        $id = validId($_GET['id'] ?? 0);
        if (!$id) jsonError('Invalid review');
        $s = $this->db->prepare("SELECT * FROM report_card_ai_reviews WHERE id=? AND user_id=?");
        $s->execute([$id, $uid]);
        $review = $s->fetch();
        if (!$review) jsonError('Invalid review');
        jsonResponse($this->attachFindings($review));
    }

    public function acknowledgeFinding() {
        $uid = uid();
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid finding');
        $o = $this->db->prepare(
            "SELECT rcaf.id FROM report_card_ai_findings rcaf
             JOIN report_card_ai_reviews rcar ON rcar.id=rcaf.review_id
             WHERE rcaf.id=? AND rcar.user_id=?"
        );
        $o->execute([$id, $uid]);
        if (!$o->fetchColumn()) jsonError('Invalid finding');
        $this->db->prepare("UPDATE report_card_ai_findings SET acknowledged=1 WHERE id=?")->execute([$id]);
        jsonResponse(['success' => true]);
    }

    // ══════════════════════════════════════════════════════════════════
    // CORE — session-independent, callable from report_card_cron.php
    // ══════════════════════════════════════════════════════════════════

    /**
     * Runs one review end to end and returns it (with findings) regardless of outcome.
     * §7.3: re-running never overwrites — this always INSERTs a new row, so the history
     * of assessments stays intact even across repeated runs on the same card/period.
     */
    public function runFor(int $userId, string $scope, string $periodStart, string $periodEnd, ?int $cardId, int $challengeId): array {
        $this->db->prepare(
            "INSERT INTO report_card_ai_reviews (user_id, card_id, scope, period_start, period_end, status, model, prompt_version) VALUES (?,?,?,?,?,'running',?,?)"
        )->execute([$userId, $cardId, $scope, $periodStart, $periodEnd, self::MODEL, self::PROMPT_VERSION]);
        $reviewId = (int)$this->db->lastInsertId();

        try {
            $payload = $this->buildPayload($userId, $challengeId, $periodStart, $periodEnd);
            $system = $this->systemPrompt();
            $result = $this->callAnthropic($system, json_encode($payload));

            if (!$result['ok']) {
                $this->db->prepare("UPDATE report_card_ai_reviews SET status='failed', error_message=?, input_payload=? WHERE id=?")
                    ->execute([$result['error'], json_encode($payload), $reviewId]);
                return $this->reviewById($reviewId);
            }

            $out = $result['data'];
            $this->db->prepare(
                "UPDATE report_card_ai_reviews SET status='complete', model=?, input_payload=?, output_payload=?, alignment_score=?, discipline_score=?, summary=?, one_change=?, suggested_goal=?, input_tokens=?, output_tokens=?, completed_at=NOW() WHERE id=?"
            )->execute([
                $result['model'] ?: self::MODEL,
                json_encode($payload), json_encode($out),
                max(0, min(100, (int)($out['alignment_score'] ?? 0))),
                max(0, min(100, (int)($out['discipline_score'] ?? 0))),
                trim((string)($out['summary'] ?? '')) ?: null,
                trim((string)($out['one_change'] ?? '')) ?: null,
                trim((string)($out['suggested_goal'] ?? '')) ?: null,
                $result['input_tokens'], $result['output_tokens'], $reviewId,
            ]);
            $this->explodeFindings($reviewId, $out);
            return $this->reviewById($reviewId);
        } catch (Throwable $e) {
            $this->db->prepare("UPDATE report_card_ai_reviews SET status='failed', error_message=? WHERE id=?")
                ->execute([$e->getMessage(), $reviewId]);
            return $this->reviewById($reviewId);
        }
    }

    private function reviewById(int $reviewId): array {
        $s = $this->db->prepare("SELECT * FROM report_card_ai_reviews WHERE id=?");
        $s->execute([$reviewId]);
        return $this->attachFindings($s->fetch());
    }

    private function attachFindings(array $review): array {
        $review['output_payload'] = $review['output_payload'] ? json_decode($review['output_payload'], true) : null;
        // input_payload can be large (a week of trades + cards) and is an internal audit
        // trail, not something the card view renders — dropped from the response, still
        // in the DB for anyone who needs to inspect what was actually sent.
        unset($review['input_payload']);
        $f = $this->db->prepare("SELECT * FROM report_card_ai_findings WHERE review_id=? ORDER BY FIELD(severity,'high','medium','low'), id");
        $f->execute([$review['id']]);
        $findings = $f->fetchAll();
        foreach ($findings as &$fd) { $fd['evidence'] = $fd['evidence'] ? json_decode($fd['evidence'], true) : null; }
        unset($fd);
        $review['findings'] = $findings;
        return $review;
    }

    private function explodeFindings(int $reviewId, array $out): void {
        $ins = $this->db->prepare("INSERT INTO report_card_ai_findings (review_id, type, severity, title, detail, evidence) VALUES (?,?,?,?,?,?)");
        $map = [
            'contradictions' => 'contradiction', 'behavior_patterns' => 'behavior_pattern',
            'thinking_patterns' => 'thinking_pattern', 'strengths' => 'strength', 'risks' => 'risk',
        ];
        foreach ($map as $key => $type) {
            foreach (($out[$key] ?? []) as $item) {
                if (!is_array($item)) continue;
                $title = trim((string)($item['title'] ?? ''));
                if ($title === '') continue;
                $severity = in_array($item['severity'] ?? '', ['low', 'medium', 'high'], true)
                    ? $item['severity'] : ($type === 'strength' ? 'low' : 'medium');
                $ins->execute([
                    $reviewId, $type, $severity, substr($title, 0, 160),
                    trim((string)($item['detail'] ?? '')) ?: null,
                    isset($item['evidence']) ? json_encode($item['evidence']) : null,
                ]);
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // PAYLOAD BUILDER (§7.1) — behaviour (trades) + thinking (card) + context, one payload
    // ══════════════════════════════════════════════════════════════════

    private function buildPayload(int $userId, int $challengeId, string $periodStart, string $periodEnd): array {
        $cs = $this->db->prepare("SELECT * FROM report_cards WHERE user_id=? AND challenge_id=? AND card_date BETWEEN ? AND ? ORDER BY card_date");
        $cs->execute([$userId, $challengeId, $periodStart, $periodEnd]);
        $cards = $cs->fetchAll();

        $blocksByDate = [];
        $thinking = [];
        $bs = $this->db->prepare("SELECT * FROM report_card_blocks WHERE card_id=? ORDER BY sort_order");
        $ms = $this->db->prepare("SELECT m.text FROM report_card_mantra_checks c JOIN report_card_mantras m ON m.id=c.mantra_id WHERE c.card_id=?");
        foreach ($cards as $card) {
            $bs->execute([$card['id']]);
            $blocks = $bs->fetchAll();
            $withWindow = [];
            foreach ($blocks as $b) {
                $b['_window'] = reportCardBlockWindow($card['card_date'], $b['start_utc'], $b['end_utc']);
                $withWindow[] = $b;
            }
            $blocksByDate[$card['card_date']] = $withWindow;

            $ms->execute([$card['id']]);
            $thinking[] = [
                'date' => $card['card_date'],
                'status' => $card['status'],
                'primary_goal' => $card['primary_goal'],
                'overall_grade' => $card['overall_grade'],
                'morning_temperature' => $card['morning_temperature'],
                'sleep_quality' => $card['sleep_quality'] !== null ? (int)$card['sleep_quality'] : null,
                'mantras_checked' => array_column($ms->fetchAll(), 'text'),
                'blocks' => array_map(fn($b) => [
                    'label' => $b['label'], 'start_utc' => $b['start_utc'], 'end_utc' => $b['end_utc'],
                    'market_session' => $b['market_session'], 'grade' => $b['grade'],
                    'playbook_only' => (bool)$b['playbook_only'], 'sizing' => $b['sizing'],
                    'in_my_favor' => (bool)$b['in_my_favor'], 'comments' => $b['comments'],
                ], $blocks),
                'learned' => $card['learned'],
                'changes_needed' => $card['changes_needed'],
                'easiest_money_trade' => $card['easiest_money_trade'],
                'overview' => $card['overview'],
                'wins' => $card['wins'],
            ];
        }

        // v3.20.0 — source != 'backtest' required: a backtest trade's challenge_id is
        // NULL, which "OR challenge_id IS NULL" would otherwise fold into a real
        // period's AI review payload, judging live discipline against simulated trades.
        $ts = $this->db->prepare(
            "SELECT id, trade_date, pair, direction, time_in, time_out, session, risk_amount, actual_risk_pct,
                    planned_risk_pct, risk_deviation_pct, target_r, r_multiple, r_multiple_source, result,
                    exit_reason, exit_quality, net_pnl, stop_loss, take_profit
             FROM trades WHERE user_id=? AND (challenge_id=? OR challenge_id IS NULL) AND source != 'backtest' AND trade_date BETWEEN ? AND ?
             ORDER BY trade_date, time_in"
        );
        $ts->execute([$userId, $challengeId, $periodStart, $periodEnd]);
        $trades = $ts->fetchAll();

        // Gate score / 15m-trigger are strategy_variables answers in this schema, not
        // fixed columns (strategy checklists are user/strategy-defined — see CLAUDE.md's
        // Strategy Lab). Included generically as label->value per trade rather than this
        // controller guessing two specific field names that may not exist for every
        // trader's strategy.
        $tv = $this->db->prepare("SELECT sv.label, tv.value FROM trade_variables tv JOIN strategy_variables sv ON sv.id=tv.variable_id WHERE tv.trade_id=?");

        $behaviour = [];
        $prevTime = null;
        $prevResult = null;
        foreach ($trades as $t) {
            $blockLabel = 'unassigned';
            if ($t['time_in'] && isset($blocksByDate[$t['trade_date']])) {
                $tIn = new DateTime($t['time_in'], new DateTimeZone('UTC'));
                foreach ($blocksByDate[$t['trade_date']] as $b) {
                    if ($tIn >= $b['_window'][0] && $tIn < $b['_window'][1]) { $blockLabel = $b['label']; break; }
                }
            }
            $gapMinutes = ($prevTime && $t['time_in']) ? round((strtotime($t['time_in']) - strtotime($prevTime)) / 60, 1) : null;

            $tv->execute([$t['id']]);
            $vars = [];
            foreach ($tv->fetchAll() as $row) { $vars[$row['label']] = $row['value']; }

            $behaviour[] = [
                'trade_id' => (int)$t['id'], 'pair' => $t['pair'], 'direction' => $t['direction'],
                'time_in' => $t['time_in'], 'time_out' => $t['time_out'], 'session' => $t['session'],
                'block' => $blockLabel,
                'risk_amount' => $t['risk_amount'] !== null ? (float)$t['risk_amount'] : null,
                'actual_risk_pct' => $t['actual_risk_pct'] !== null ? (float)$t['actual_risk_pct'] : null,
                'planned_risk_pct' => $t['planned_risk_pct'] !== null ? (float)$t['planned_risk_pct'] : null,
                'risk_deviation_pct' => $t['risk_deviation_pct'] !== null ? (float)$t['risk_deviation_pct'] : null,
                'target_r' => $t['target_r'] !== null ? (float)$t['target_r'] : null,
                'r_multiple' => $t['r_multiple'] !== null ? (float)$t['r_multiple'] : null,
                'r_multiple_source' => $t['r_multiple_source'],
                'result' => $t['result'], 'exit_reason' => $t['exit_reason'], 'exit_quality' => $t['exit_quality'],
                'net_pnl' => $t['net_pnl'] !== null ? (float)$t['net_pnl'] : null,
                'has_stop_and_target_on_file' => $t['stop_loss'] !== null && $t['take_profit'] !== null,
                'minutes_since_previous_trade' => $gapMinutes,
                'followed_a_loss' => $prevResult === 'Loss',
                'strategy_variables' => $vars,
            ];
            if ($t['time_in']) $prevTime = $t['time_in'];
            $prevResult = $t['result'];
        }

        $tradesPerDay = [];
        foreach ($trades as $t) { $tradesPerDay[$t['trade_date']] = ($tradesPerDay[$t['trade_date']] ?? 0) + 1; }
        $limits = $challengeId > 0 ? tradeLimitStatus($this->db, $challengeId) : null;

        $derived = [
            'trade_count' => count($trades),
            'max_trades_in_one_day' => $tradesPerDay ? max($tradesPerDay) : 0,
            'daily_trade_limit' => $limits['limits']['max_trades_day'] ?? null,
            'weekly_trade_limit' => $limits['limits']['max_trades_week'] ?? null,
            'trades_outside_any_block' => count(array_filter($behaviour, fn($b) => $b['block'] === 'unassigned')),
        ];

        // Context (§7.1): previous 5 cards' one_change + still-open findings, so the
        // review can check whether yesterday's correction actually got applied.
        $prevCardsStmt = $this->db->prepare(
            "SELECT id, card_date FROM report_cards WHERE user_id=? AND challenge_id=? AND card_date < ? ORDER BY card_date DESC LIMIT 5"
        );
        $prevCardsStmt->execute([$userId, $challengeId, $periodStart]);
        $context = [];
        $oneChangeStmt = $this->db->prepare("SELECT one_change FROM report_card_ai_reviews WHERE card_id=? AND status='complete' ORDER BY created_at DESC LIMIT 1");
        foreach ($prevCardsStmt->fetchAll() as $pc) {
            $oneChangeStmt->execute([$pc['id']]);
            $context[] = ['date' => $pc['card_date'], 'one_change' => $oneChangeStmt->fetchColumn() ?: null];
        }

        $openFindings = $this->db->prepare(
            "SELECT f.id, f.type, f.severity, f.title FROM report_card_ai_findings f
             JOIN report_card_ai_reviews r ON r.id=f.review_id
             WHERE r.user_id=? AND f.acknowledged=0 AND r.created_at >= DATE_SUB(?, INTERVAL 60 DAY)
             ORDER BY f.created_at DESC LIMIT 20"
        );
        $openFindings->execute([$userId, $periodStart]);

        return [
            'period' => ['start' => $periodStart, 'end' => $periodEnd],
            'behaviour' => ['trades' => $behaviour, 'derived' => $derived],
            'thinking' => $thinking,
            'context' => ['previous_cards' => $context, 'open_findings' => $openFindings->fetchAll()],
        ];
    }

    // ══════════════════════════════════════════════════════════════════
    // ANTHROPIC CLIENT
    // ══════════════════════════════════════════════════════════════════

    /**
     * §7.2's rules, verbatim in spirit: judge process not P&L, cite evidence for every
     * claim, no encouragement filler, data wins over self-report and the conflict is
     * named rather than smoothed over.
     */
    private function systemPrompt(): string {
        return <<<PROMPT
You are the AI Review engine for a prop-firm trader's Daily Report Card. You are given one
JSON payload with two halves that must be read together, never separately: "behaviour"
(what the trades actually did — hard data) and "thinking" (what the trader wrote on the
card — self-report). Your entire purpose is to find where they disagree.

Rules:
- Judge process, not P&L. A profitable rule-break is a failure. A losing rule-follow is a
  success. Never praise a result that came from broken process, and never criticize a loss
  that came from a well-executed plan.
- Cite evidence for every claim you make — a trade_id, a block label/date, or the exact
  card field and text you are quoting. A claim with no evidence should not be made.
- No encouragement filler. Do not soften a real finding to be nice.
- If the self-report (thinking) and the data (behaviour) conflict, the data wins, and the
  conflict itself is what you report — name it explicitly as a contradiction.
- Specific contradiction patterns to actively check for: a stated goal like "A+ setups
  only" alongside trades whose strategy_variables show sub-standard gate answers; a block
  self-graded highly despite comments or behaviour indicating a broken rule; language like
  "stayed patient"/"waited" in the free text alongside trades minutes apart
  (minutes_since_previous_trade); actual_risk_pct or risk_deviation_pct showing size above
  the account's own ladder tier; trades in derived.trades_outside_any_block ("unassigned")
  on a day the card describes as planned; a card's one_change from a previous day not
  reflected in today's behaviour or thinking at all (check context.previous_cards).
- repeat_of should list the ids from context.open_findings that a new finding repeats —
  leave it empty if nothing repeats.
- Every one of contradictions/behavior_patterns/thinking_patterns/strengths/risks may be
  an empty array if you find nothing real to put there — do not invent content to fill a
  section.

Respond only by calling the submit_review tool.
PROMPT;
    }

    private function reviewTool(): array {
        $findingSchema = [
            'type' => 'object',
            'properties' => [
                'title' => ['type' => 'string'],
                'detail' => ['type' => 'string'],
                'severity' => ['type' => 'string', 'enum' => ['low', 'medium', 'high']],
                'evidence' => [
                    'type' => 'object',
                    'properties' => [
                        'trade_ids' => ['type' => 'array', 'items' => ['type' => 'integer']],
                        'block_labels' => ['type' => 'array', 'items' => ['type' => 'string']],
                        'quoted_field' => ['type' => 'string'],
                    ],
                ],
            ],
            'required' => ['title', 'detail'],
        ];
        return [
            'name' => 'submit_review',
            'description' => 'Submit the structured behaviour x thinking review.',
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'alignment_score' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 100, 'description' => 'How closely executed behaviour matched the stated primary goal and rules.'],
                    'discipline_score' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 100, 'description' => 'Rule adherence independent of outcome.'],
                    'contradictions' => ['type' => 'array', 'items' => $findingSchema],
                    'behavior_patterns' => ['type' => 'array', 'items' => $findingSchema],
                    'thinking_patterns' => ['type' => 'array', 'items' => $findingSchema],
                    'strengths' => ['type' => 'array', 'items' => $findingSchema],
                    'risks' => ['type' => 'array', 'items' => $findingSchema],
                    'summary' => ['type' => 'string'],
                    'one_change' => ['type' => 'string', 'description' => 'Exactly one change for the next session.'],
                    'suggested_goal' => ['type' => 'string', 'description' => "Proposed primary goal for tomorrow's card."],
                    'repeat_of' => ['type' => 'array', 'items' => ['type' => 'integer']],
                ],
                'required' => ['alignment_score', 'discipline_score', 'contradictions', 'behavior_patterns', 'thinking_patterns', 'strengths', 'risks', 'summary', 'one_change', 'suggested_goal'],
            ],
        ];
    }

    private function callAnthropic(string $system, string $userJson): array {
        if (!defined('ANTHROPIC_API_KEY') || ANTHROPIC_API_KEY === '') {
            return ['ok' => false, 'error' => 'ANTHROPIC_API_KEY is not configured in includes/config.php'];
        }
        $model = defined('REPORT_CARD_AI_MODEL') ? REPORT_CARD_AI_MODEL : self::MODEL;
        $body = [
            'model' => $model,
            'max_tokens' => 4096,
            'system' => $system,
            'messages' => [['role' => 'user', 'content' => $userJson]],
            'tools' => [$this->reviewTool()],
            'tool_choice' => ['type' => 'tool', 'name' => 'submit_review'],
        ];

        $ch = curl_init(self::API_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'x-api-key: ' . ANTHROPIC_API_KEY,
                'anthropic-version: ' . self::ANTHROPIC_VERSION,
                'content-type: application/json',
            ],
            CURLOPT_POSTFIELDS => json_encode($body),
            CURLOPT_TIMEOUT => 90,
        ]);
        $raw = curl_exec($ch);
        if ($raw === false) {
            $err = curl_error($ch);
            curl_close($ch);
            return ['ok' => false, 'error' => 'Request to Anthropic failed: ' . $err];
        }
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $resp = json_decode($raw, true);
        if ($httpCode !== 200 || !is_array($resp)) {
            $msg = $resp['error']['message'] ?? ('HTTP ' . $httpCode);
            return ['ok' => false, 'error' => 'Anthropic API error: ' . $msg];
        }

        $toolUse = null;
        foreach (($resp['content'] ?? []) as $block) {
            if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === 'submit_review') { $toolUse = $block; break; }
        }
        if (!$toolUse || !is_array($toolUse['input'] ?? null)) {
            return ['ok' => false, 'error' => 'Model did not return a structured review'];
        }

        return [
            'ok' => true,
            'data' => $toolUse['input'],
            'input_tokens' => $resp['usage']['input_tokens'] ?? null,
            'output_tokens' => $resp['usage']['output_tokens'] ?? null,
            'model' => $resp['model'] ?? null,
        ];
    }
}
