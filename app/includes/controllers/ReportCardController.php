<?php
/**
 * FundedControl — Daily Report Card Controller (v3.18.0)
 *
 * Card CRUD, dynamic session blocks (full CRUD + template copy-in), block templates,
 * standing mantras + daily check-off, ticker rows + chart images, journal integration
 * (trade attribution, P&L autofill, trade-count guard), history + streak.
 *
 * AI review lives in ReportCardAiController.php — a separate domain (data entry vs.
 * analysis), same split this codebase already uses for ReviewController/
 * ReviewEngineController.
 *
 * Judgment calls made building this against the build briefing, documented here rather
 * than silently assumed (same discipline as every other release in CLAUDE.md):
 *
 * 1. No per-user timezone exists anywhere in this schema (users.timezone was only ever a
 *    §14 wishlist column, never migrated — confirmed by grep, not assumed). The briefing
 *    itself names CAT (UTC+2) as the trader's zone. REPORT_CARD_TZ below is a fixed
 *    constant, not a per-user preference — a real gap if this app ever onboards a trader
 *    in a different zone, flagged here rather than silently built as if it were already
 *    a solved, general setting.
 * 2. "account_id" in the briefing is challenge_id here — see the migration file's own
 *    header for why.
 * 3. The briefing's routes (/report-card/{date} etc.) assume a client-side URL router.
 *    This app has none — index.php's showPage() swaps page visibility by id, no
 *    pushState anywhere. Implemented as one sidebar page with an internal view switch
 *    (card / history / templates) instead, matching every other page in this app.
 * 4. Trade-count guard reads challenge_limits (max_trades_day/max_trades_week), never a
 *    hardcoded 2/4 — this app's own v3.17.0 rule ("never hardcode a limit that's already
 *    data"). A challenge with no challenge_limits row simply shows no guard, same
 *    "NULL means not tracked" convention used everywhere else.
 */
class ReportCardController {
    private $db;
    private $uid;

    /** Fixed, not per-user — see class docblock note 1. */
    const REPORT_CARD_TZ = 'Africa/Kigali';
    const MAX_BLOCKS = 12;

    public function __construct() {
        $this->db = getDB();
        $this->uid = uid();
    }

    // ══════════════════════════════════════════════════════════════════
    // CARD
    // ══════════════════════════════════════════════════════════════════

    private function today(): string {
        return (new DateTime('now', new DateTimeZone(self::REPORT_CARD_TZ)))->format('Y-m-d');
    }

    /** The challenge a card is scoped to: the currently active one, or 0 ("no account selected") if none. */
    private function scopeChallengeId(): int {
        $ch = getActiveChallenge();
        return (int)($ch['id'] ?? 0);
    }

    public function getCard() {
        $date = $_GET['date'] ?? $this->today();
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) jsonError('Invalid date');
        $chId = $this->scopeChallengeId();

        $card = $this->findOrCreateCard($date, $chId);
        jsonResponse($this->buildCardPayload($card));
    }

    private function findOrCreateCard(string $date, int $chId): array {
        $s = $this->db->prepare("SELECT * FROM report_cards WHERE user_id=? AND challenge_id=? AND card_date=?");
        $s->execute([$this->uid, $chId, $date]);
        $card = $s->fetch();
        if ($card) return $card;

        $this->db->prepare("INSERT INTO report_cards (user_id, challenge_id, card_date) VALUES (?,?,?)")
            ->execute([$this->uid, $chId, $date]);
        $cardId = (int)$this->db->lastInsertId();

        // Rule 3 (§4.1): template selection order — weekday_default match, then
        // is_default, then blank (0 blocks is valid, rule 5). Blocks are copied, never
        // referenced (rule 1) — this INSERT is the only place a template's blocks ever
        // populate a card.
        $this->ensureDefaultTemplates();
        $dow = (int)(new DateTime($date))->format('w'); // 0=Sun..6=Sat, matches weekday_default
        $t = $this->db->prepare("SELECT id FROM report_card_templates WHERE user_id=? AND weekday_default=? LIMIT 1");
        $t->execute([$this->uid, $dow]);
        $templateId = $t->fetchColumn();
        if (!$templateId) {
            $t = $this->db->prepare("SELECT id FROM report_card_templates WHERE user_id=? AND is_default=1 LIMIT 1");
            $t->execute([$this->uid]);
            $templateId = $t->fetchColumn();
        }
        if ($templateId) $this->copyTemplateBlocksToCard((int)$templateId, $cardId);

        $s = $this->db->prepare("SELECT * FROM report_cards WHERE id=?");
        $s->execute([$cardId]);
        return $s->fetch();
    }

    private function copyTemplateBlocksToCard(int $templateId, int $cardId): void {
        $s = $this->db->prepare("SELECT sort_order, label, start_utc, end_utc, market_session FROM report_card_template_blocks WHERE template_id=? ORDER BY sort_order");
        $s->execute([$templateId]);
        $ins = $this->db->prepare("INSERT INTO report_card_blocks (card_id, sort_order, label, start_utc, end_utc, market_session) VALUES (?,?,?,?,?,?)");
        foreach ($s->fetchAll() as $b) {
            $ins->execute([$cardId, $b['sort_order'], $b['label'], $b['start_utc'], $b['end_utc'], $b['market_session']]);
        }
    }

    public function saveCard() {
        $d = jsonInput();
        $chId = $this->scopeChallengeId();
        $date = $d['card_date'] ?? $this->today();
        $card = $this->findOrCreateCard($date, $chId);

        $grade = in_array($d['overall_grade'] ?? null, ['A','B','C','D','F'], true) ? $d['overall_grade'] : null;
        $temp  = in_array($d['morning_temperature'] ?? null, ['great','good','neutral','off','bad'], true) ? $d['morning_temperature'] : null;
        $sleep = isset($d['sleep_quality']) && $d['sleep_quality'] !== '' ? max(1, min(10, (int)$d['sleep_quality'])) : null;
        $pnl   = isset($d['pnl']) && $d['pnl'] !== '' ? round((float)$d['pnl'], 2) : null;

        $this->db->prepare(
            "UPDATE report_cards SET overall_grade=?, pnl=?, morning_temperature=?, sleep_quality=?, primary_goal=?, learned=?, changes_needed=?, easiest_money_trade=?, overview=?, wins=? WHERE id=? AND user_id=?"
        )->execute([
            $grade, $pnl, $temp, $sleep,
            trim((string)($d['primary_goal'] ?? '')) ?: null,
            trim((string)($d['learned'] ?? '')) ?: null,
            trim((string)($d['changes_needed'] ?? '')) ?: null,
            trim((string)($d['easiest_money_trade'] ?? '')) ?: null,
            trim((string)($d['overview'] ?? '')) ?: null,
            trim((string)($d['wins'] ?? '')) ?: null,
            $card['id'], $this->uid,
        ]);

        $this->recomputeStatus((int)$card['id']);
        $s = $this->db->prepare("SELECT * FROM report_cards WHERE id=?");
        $s->execute([$card['id']]);
        jsonResponse($this->buildCardPayload($s->fetch()));
    }

    /**
     * Rule (§6): status flips to 'complete' when overall grade, primary goal, and every
     * block's own grade are filled. A zero-block card (rule 5) can still complete on
     * grade + goal alone — there's nothing else to require.
     */
    private function recomputeStatus(int $cardId): void {
        $s = $this->db->prepare("SELECT overall_grade, primary_goal FROM report_cards WHERE id=?");
        $s->execute([$cardId]);
        $c = $s->fetch();
        if (!$c) return;
        $ok = !empty($c['overall_grade']) && trim((string)$c['primary_goal']) !== '';
        if ($ok) {
            $b = $this->db->prepare("SELECT COUNT(*) FROM report_card_blocks WHERE card_id=? AND grade IS NULL");
            $b->execute([$cardId]);
            $ok = ((int)$b->fetchColumn()) === 0;
        }
        $this->db->prepare("UPDATE report_cards SET status=? WHERE id=?")->execute([$ok ? 'complete' : 'draft', $cardId]);
    }

    /**
     * Assembles the full card payload: header fields, blocks (+ overlap flags + attributed
     * trades), unassigned trades, mantras (+ today's check state), tickers (+ images),
     * live pnl_auto, and the trade-count guard. Everything a card view needs in one call —
     * same "embed everything a page needs" pattern TradeController::getAll() already uses
     * for trade_variables/trade_journal/trade_checkins.
     */
    private function buildCardPayload(array $card): array {
        $cardId = (int)$card['id'];
        $chId = (int)$card['challenge_id'];
        $date = $card['card_date'];

        // ── P&L autofill (§5): live SUM of closed trades for this date+challenge, never
        // stored — same "derive, don't store" principle as challenges.current_balance
        // (CLAUDE.md v3.13.0). pnl (manual override) and pnl_auto are both returned.
        $pnlAuto = null;
        if ($chId > 0) {
            $p = $this->db->prepare("SELECT COALESCE(SUM(net_pnl),0) FROM trades WHERE challenge_id=? AND trade_date=? AND result IN ('Win','Loss','Break Even')");
            $p->execute([$chId, $date]);
            $pnlAuto = round((float)$p->fetchColumn(), 2);
        }

        // ── Blocks + attribution ──
        $bs = $this->db->prepare("SELECT * FROM report_card_blocks WHERE card_id=? ORDER BY sort_order, id");
        $bs->execute([$cardId]);
        $blocks = $bs->fetchAll();

        $windows = [];
        foreach ($blocks as &$b) {
            $win = reportCardBlockWindow($date, $b['start_utc'], $b['end_utc']);
            // Cast to int explicitly: PDO returns column values as strings, but a PHP
            // array key that looks like a decimal integer is silently coerced to a real
            // int by the array itself — leaving $b['id'] as a string would make an
            // int-vs-string "===" comparison below never match, defeating the self-skip
            // and flagging every block as overlapping itself.
            $windows[(int)$b['id']] = $win;
            $b['window_start_utc'] = $win[0]->format('Y-m-d H:i:s');
            $b['window_end_utc'] = $win[1]->format('Y-m-d H:i:s');
            $b['start_local'] = $this->toLocalTime($win[0]);
            $b['end_local'] = $this->toLocalTime($win[1]);
            $b['trades'] = [];
        }
        unset($b);
        // Overlap warning (rule 7, non-blocking): flag every block that shares any time with another.
        foreach ($blocks as &$b) {
            $b['overlaps'] = false;
            $ownId = (int)$b['id'];
            foreach ($windows as $otherId => $otherWin) {
                if ($otherId === $ownId) continue;
                if ($windows[$ownId][0] < $otherWin[1] && $otherWin[0] < $windows[$ownId][1]) { $b['overlaps'] = true; break; }
            }
        }
        unset($b);

        $unassigned = [];
        if ($chId > 0) {
            $ts = $this->db->prepare("SELECT id, pair, direction, time_in, time_out, result, net_pnl FROM trades WHERE challenge_id=? AND trade_date=? AND time_in IS NOT NULL ORDER BY time_in");
            $ts->execute([$chId, $date]);
            $trades = $ts->fetchAll();
            foreach ($trades as $t) {
                $tIn = new DateTime($t['time_in'], new DateTimeZone('UTC'));
                $matched = false;
                foreach ($blocks as &$b) {
                    if ($tIn >= $windows[$b['id']][0] && $tIn < $windows[$b['id']][1]) {
                        $b['trades'][] = $t;
                        $matched = true;
                    }
                }
                unset($b);
                // A trade matching no block is itself the signal of unplanned trading (§5)
                // — never silently dropped.
                if (!$matched) $unassigned[] = $t;
            }
        }

        // ── Trade-count guard (§5, judgment call 4 above: reads challenge_limits, never hardcoded) ──
        $guard = null;
        if ($chId > 0) {
            $status = tradeLimitStatus($this->db, $chId);
            $guard = [
                'trades_today' => $status['trades_today'],
                'trades_week' => $status['trades_week'],
                'max_trades_day' => $status['limits']['max_trades_day'],
                'max_trades_week' => $status['limits']['max_trades_week'],
                'exceeded' => ($status['limits']['max_trades_day'] !== null && $status['trades_today'] > $status['limits']['max_trades_day'])
                           || ($status['limits']['max_trades_week'] !== null && $status['trades_week'] > $status['limits']['max_trades_week']),
            ];
        }

        // ── Mantras (standing, user-level) + today's check-off ──
        $ms = $this->db->prepare("SELECT id, text, sort_order FROM report_card_mantras WHERE user_id=? AND is_active=1 ORDER BY sort_order, id");
        $ms->execute([$this->uid]);
        $mantras = $ms->fetchAll();
        $cs = $this->db->prepare("SELECT mantra_id FROM report_card_mantra_checks WHERE card_id=?");
        $cs->execute([$cardId]);
        $checked = array_column($cs->fetchAll(), 'mantra_id');
        foreach ($mantras as &$m) { $m['checked'] = in_array($m['id'], $checked); }
        unset($m);

        // ── Tickers + images ──
        $tks = $this->db->prepare("SELECT * FROM report_card_tickers WHERE card_id=? ORDER BY sort_order, id");
        $tks->execute([$cardId]);
        $tickers = $tks->fetchAll();
        $imgs = $this->db->prepare("SELECT id, file_path, sort_order FROM report_card_ticker_images WHERE ticker_id=? ORDER BY sort_order, id");
        foreach ($tickers as &$tk) {
            $imgs->execute([$tk['id']]);
            $tk['images'] = $imgs->fetchAll();
        }
        unset($tk);

        $card['pnl_auto'] = $pnlAuto;
        $card['blocks'] = $blocks;
        $card['unassigned_trades'] = $unassigned;
        $card['trade_count_guard'] = $guard;
        $card['mantras'] = $mantras;
        $card['tickers'] = $tickers;
        $card['timezone'] = self::REPORT_CARD_TZ;
        return $card;
    }

    private function toLocalTime(DateTime $utc): string {
        $local = clone $utc;
        $local->setTimezone(new DateTimeZone(self::REPORT_CARD_TZ));
        return $local->format('H:i');
    }

    private function ownsCard(int $cardId): bool {
        $s = $this->db->prepare("SELECT COUNT(*) FROM report_cards WHERE id=? AND user_id=?");
        $s->execute([$cardId, $this->uid]);
        return (int)$s->fetchColumn() > 0;
    }

    // ══════════════════════════════════════════════════════════════════
    // BLOCKS — full CRUD, drag-reorder, at any point including mid-session (rule 2)
    // ══════════════════════════════════════════════════════════════════

    public function addBlock() {
        $d = jsonInput();
        $cardId = validId($d['card_id'] ?? 0);
        if (!$cardId || !$this->ownsCard($cardId)) jsonError('Invalid card');

        $cnt = $this->db->prepare("SELECT COUNT(*) FROM report_card_blocks WHERE card_id=?");
        $cnt->execute([$cardId]);
        if ((int)$cnt->fetchColumn() >= self::MAX_BLOCKS) jsonError('A card can hold at most ' . self::MAX_BLOCKS . ' blocks');

        [$label, $start, $end, $session] = $this->validBlockFields($d);

        $ord = $this->db->prepare("SELECT COALESCE(MAX(sort_order),-1)+1 FROM report_card_blocks WHERE card_id=?");
        $ord->execute([$cardId]);
        $sortOrder = (int)$ord->fetchColumn();

        $this->db->prepare("INSERT INTO report_card_blocks (card_id, sort_order, label, start_utc, end_utc, market_session) VALUES (?,?,?,?,?,?)")
            ->execute([$cardId, $sortOrder, $label, $start, $end, $session]);
        $this->recomputeStatus($cardId);
        jsonResponse(['success' => true, 'id' => (int)$this->db->lastInsertId()]);
    }

    public function updateBlock() {
        $d = jsonInput();
        $blockId = validId($d['id'] ?? 0);
        if (!$blockId) jsonError('Invalid block');
        $b = $this->db->prepare("SELECT rcb.card_id FROM report_card_blocks rcb JOIN report_cards rc ON rc.id=rcb.card_id WHERE rcb.id=? AND rc.user_id=?");
        $b->execute([$blockId, $this->uid]);
        $cardId = $b->fetchColumn();
        if (!$cardId) jsonError('Invalid block');

        [$label, $start, $end, $session] = $this->validBlockFields($d);
        $grade = in_array($d['grade'] ?? null, ['A','B','C','D','F'], true) ? $d['grade'] : null;
        $sizing = trim((string)($d['sizing'] ?? '')) ?: null;
        $comments = trim((string)($d['comments'] ?? '')) ?: null;
        $playbookOnly = !empty($d['playbook_only']) ? 1 : 0;
        $inMyFavor = !empty($d['in_my_favor']) ? 1 : 0;

        $this->db->prepare(
            "UPDATE report_card_blocks SET label=?, start_utc=?, end_utc=?, market_session=?, grade=?, playbook_only=?, sizing=?, in_my_favor=?, comments=? WHERE id=?"
        )->execute([$label, $start, $end, $session, $grade, $playbookOnly, $sizing, $inMyFavor, $comments, $blockId]);
        $this->recomputeStatus((int)$cardId);
        jsonResponse(['success' => true]);
    }

    public function deleteBlock() {
        $d = jsonInput();
        $blockId = validId($d['id'] ?? 0);
        if (!$blockId) jsonError('Invalid block');
        $b = $this->db->prepare("SELECT rcb.card_id FROM report_card_blocks rcb JOIN report_cards rc ON rc.id=rcb.card_id WHERE rcb.id=? AND rc.user_id=?");
        $b->execute([$blockId, $this->uid]);
        $cardId = $b->fetchColumn();
        if (!$cardId) jsonError('Invalid block');
        $this->db->prepare("DELETE FROM report_card_blocks WHERE id=?")->execute([$blockId]);
        $this->recomputeStatus((int)$cardId);
        jsonResponse(['success' => true]);
    }

    public function reorderBlocks() {
        $d = jsonInput();
        $cardId = validId($d['card_id'] ?? 0);
        $order = $d['order'] ?? [];
        if (!$cardId || !$this->ownsCard($cardId) || !is_array($order)) jsonError('Invalid request');
        $upd = $this->db->prepare("UPDATE report_card_blocks SET sort_order=? WHERE id=? AND card_id=?");
        foreach (array_values($order) as $i => $blockId) {
            $upd->execute([$i, validId($blockId) ?: 0, $cardId]);
        }
        jsonResponse(['success' => true]);
    }

    private function validBlockFields(array $d): array {
        $label = trim((string)($d['label'] ?? ''));
        if ($label === '') jsonError('Block label is required');
        $label = substr($label, 0, 80);
        $start = $d['start_utc'] ?? '';
        $end = $d['end_utc'] ?? '';
        if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $start) || !preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $end)) {
            jsonError('Start/end time must be HH:MM');
        }
        $session = in_array($d['market_session'] ?? 'none', ['asia','london','newyork','none'], true) ? $d['market_session'] : 'none';
        return [$label, $start, $end, $session];
    }

    // ══════════════════════════════════════════════════════════════════
    // TEMPLATES
    // ══════════════════════════════════════════════════════════════════

    /** Seeds the five reference templates (§4.2) once, the first time a user's template list is ever needed. Idempotent — only runs when the user has zero templates. */
    private function ensureDefaultTemplates(): void {
        $c = $this->db->prepare("SELECT COUNT(*) FROM report_card_templates WHERE user_id=?");
        $c->execute([$this->uid]);
        if ((int)$c->fetchColumn() > 0) return;

        // CAT (UTC+2, fixed) times converted to UTC by hand. "Light day"'s Review block has
        // no stated time in the briefing (just "Single window 14:00-16:00 . Review") —
        // placed immediately after the window, a judgment call, not a quoted spec.
        $seed = [
            ['Full day', 1, null, [
                ['Prep', '06:00', '07:00', 'none'],
                ['London', '07:00', '11:00', 'london'],
                ['NY open', '12:00', '15:00', 'newyork'],
                ['Review', '19:00', '19:30', 'none'],
            ]],
            ['London only', 0, null, [
                ['Prep', '06:00', '07:00', 'none'],
                ['London', '07:00', '11:00', 'london'],
                ['Review', '11:00', '11:30', 'none'],
            ]],
            ['NY only', 0, null, [
                ['Prep', '11:00', '12:00', 'none'],
                ['NY', '12:00', '16:00', 'newyork'],
                ['Review', '16:00', '16:30', 'none'],
            ]],
            ['Light day', 0, null, [
                ['Single window', '12:00', '14:00', 'none'],
                ['Review', '14:00', '14:30', 'none'],
            ]],
            ['No-trade day', 0, null, [
                ['Review only', '18:00', '18:30', 'none'],
            ]],
        ];

        $insT = $this->db->prepare("INSERT INTO report_card_templates (user_id, name, is_default, weekday_default) VALUES (?,?,?,?)");
        $insB = $this->db->prepare("INSERT INTO report_card_template_blocks (template_id, sort_order, label, start_utc, end_utc, market_session) VALUES (?,?,?,?,?,?)");
        foreach ($seed as [$name, $isDefault, $weekday, $blocks]) {
            $insT->execute([$this->uid, $name, $isDefault, $weekday]);
            $tid = $this->db->lastInsertId();
            foreach ($blocks as $i => [$label, $start, $end, $session]) {
                $insB->execute([$tid, $i, $label, $start, $end, $session]);
            }
        }
    }

    public function getTemplates() {
        $this->ensureDefaultTemplates();
        $s = $this->db->prepare("SELECT * FROM report_card_templates WHERE user_id=? ORDER BY is_default DESC, name");
        $s->execute([$this->uid]);
        $templates = $s->fetchAll();
        $bs = $this->db->prepare("SELECT id, sort_order, label, start_utc, end_utc, market_session FROM report_card_template_blocks WHERE template_id=? ORDER BY sort_order");
        foreach ($templates as &$t) {
            $bs->execute([$t['id']]);
            $t['blocks'] = $bs->fetchAll();
        }
        unset($t);
        jsonResponse($templates);
    }

    public function addTemplate() {
        $d = jsonInput();
        $name = trim((string)($d['name'] ?? ''));
        if ($name === '') jsonError('Template name is required');
        $isDefault = !empty($d['is_default']) ? 1 : 0;
        $weekday = isset($d['weekday_default']) && $d['weekday_default'] !== '' ? max(0, min(6, (int)$d['weekday_default'])) : null;
        if ($isDefault) $this->db->prepare("UPDATE report_card_templates SET is_default=0 WHERE user_id=?")->execute([$this->uid]);
        $this->db->prepare("INSERT INTO report_card_templates (user_id, name, is_default, weekday_default) VALUES (?,?,?,?)")
            ->execute([$this->uid, substr($name, 0, 80), $isDefault, $weekday]);
        $tid = (int)$this->db->lastInsertId();

        if (isset($d['blocks']) && is_array($d['blocks'])) {
            $ins = $this->db->prepare("INSERT INTO report_card_template_blocks (template_id, sort_order, label, start_utc, end_utc, market_session) VALUES (?,?,?,?,?,?)");
            foreach (array_values($d['blocks']) as $i => $b) {
                [$label, $start, $end, $session] = $this->validBlockFields($b);
                $ins->execute([$tid, $i, $label, $start, $end, $session]);
            }
        }
        jsonResponse(['success' => true, 'id' => $tid]);
    }

    public function updateTemplate() {
        $d = jsonInput();
        $tid = validId($d['id'] ?? 0);
        if (!$tid) jsonError('Invalid template');
        $o = $this->db->prepare("SELECT id FROM report_card_templates WHERE id=? AND user_id=?");
        $o->execute([$tid, $this->uid]);
        if (!$o->fetchColumn()) jsonError('Invalid template');

        $name = trim((string)($d['name'] ?? ''));
        if ($name === '') jsonError('Template name is required');
        $isDefault = !empty($d['is_default']) ? 1 : 0;
        $weekday = isset($d['weekday_default']) && $d['weekday_default'] !== '' ? max(0, min(6, (int)$d['weekday_default'])) : null;
        if ($isDefault) $this->db->prepare("UPDATE report_card_templates SET is_default=0 WHERE user_id=?")->execute([$this->uid]);
        $this->db->prepare("UPDATE report_card_templates SET name=?, is_default=?, weekday_default=? WHERE id=?")
            ->execute([substr($name, 0, 80), $isDefault, $weekday, $tid]);

        if (isset($d['blocks']) && is_array($d['blocks'])) {
            $this->db->prepare("DELETE FROM report_card_template_blocks WHERE template_id=?")->execute([$tid]);
            $ins = $this->db->prepare("INSERT INTO report_card_template_blocks (template_id, sort_order, label, start_utc, end_utc, market_session) VALUES (?,?,?,?,?,?)");
            foreach (array_values($d['blocks']) as $i => $b) {
                [$label, $start, $end, $session] = $this->validBlockFields($b);
                $ins->execute([$tid, $i, $label, $start, $end, $session]);
            }
        }
        jsonResponse(['success' => true]);
    }

    /**
     * Rule 2 (§4.1): deleting a template alters no existing card — cards only ever hold a
     * copy of a template's blocks, made once at creation time (copyTemplateBlocksToCard()
     * above). This DELETE has nothing in report_card_blocks to cascade into for that
     * reason; only report_card_template_blocks (a template's own rows) cascades.
     */
    public function deleteTemplate() {
        $d = jsonInput();
        $tid = validId($d['id'] ?? 0);
        if (!$tid) jsonError('Invalid template');
        $this->db->prepare("DELETE FROM report_card_templates WHERE id=? AND user_id=?")->execute([$tid, $this->uid]);
        jsonResponse(['success' => true]);
    }

    public function applyTemplate() {
        $d = jsonInput();
        $cardId = validId($d['card_id'] ?? 0);
        $templateId = validId($d['template_id'] ?? 0);
        if (!$cardId || !$this->ownsCard($cardId) || !$templateId) jsonError('Invalid request');
        $o = $this->db->prepare("SELECT id FROM report_card_templates WHERE id=? AND user_id=?");
        $o->execute([$templateId, $this->uid]);
        if (!$o->fetchColumn()) jsonError('Invalid template');

        // Replaces the card's current blocks outright — the explicit, deliberate action of
        // picking a different template mid-day, distinct from the automatic one-time
        // copy-in at card creation.
        $this->db->prepare("DELETE FROM report_card_blocks WHERE card_id=?")->execute([$cardId]);
        $this->copyTemplateBlocksToCard($templateId, $cardId);
        $this->recomputeStatus((int)$cardId);
        jsonResponse(['success' => true]);
    }

    /** Rule 4 (§4.1): "Save these blocks as a template" from any card. */
    public function saveBlocksAsTemplate() {
        $d = jsonInput();
        $cardId = validId($d['card_id'] ?? 0);
        $name = trim((string)($d['name'] ?? ''));
        if (!$cardId || !$this->ownsCard($cardId) || $name === '') jsonError('Invalid request');

        $this->db->prepare("INSERT INTO report_card_templates (user_id, name, is_default, weekday_default) VALUES (?,?,0,NULL)")
            ->execute([$this->uid, substr($name, 0, 80)]);
        $tid = $this->db->lastInsertId();

        $bs = $this->db->prepare("SELECT sort_order, label, start_utc, end_utc, market_session FROM report_card_blocks WHERE card_id=? ORDER BY sort_order");
        $bs->execute([$cardId]);
        $ins = $this->db->prepare("INSERT INTO report_card_template_blocks (template_id, sort_order, label, start_utc, end_utc, market_session) VALUES (?,?,?,?,?,?)");
        foreach ($bs->fetchAll() as $b) {
            $ins->execute([$tid, $b['sort_order'], $b['label'], $b['start_utc'], $b['end_utc'], $b['market_session']]);
        }
        jsonResponse(['success' => true, 'id' => (int)$tid]);
    }

    // ══════════════════════════════════════════════════════════════════
    // MANTRAS — standing user-level list, checked off daily
    // ══════════════════════════════════════════════════════════════════

    public function getMantras() {
        $s = $this->db->prepare("SELECT * FROM report_card_mantras WHERE user_id=? ORDER BY sort_order, id");
        $s->execute([$this->uid]);
        jsonResponse($s->fetchAll());
    }

    public function addMantra() {
        $d = jsonInput();
        $text = trim((string)($d['text'] ?? ''));
        if ($text === '') jsonError('Mantra text is required');
        $ord = $this->db->prepare("SELECT COALESCE(MAX(sort_order),-1)+1 FROM report_card_mantras WHERE user_id=?");
        $ord->execute([$this->uid]);
        $this->db->prepare("INSERT INTO report_card_mantras (user_id, text, sort_order) VALUES (?,?,?)")
            ->execute([$this->uid, substr($text, 0, 255), (int)$ord->fetchColumn()]);
        jsonResponse(['success' => true, 'id' => (int)$this->db->lastInsertId()]);
    }

    public function updateMantra() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid mantra');
        $text = trim((string)($d['text'] ?? ''));
        if ($text === '') jsonError('Mantra text is required');
        $isActive = array_key_exists('is_active', $d) ? (!empty($d['is_active']) ? 1 : 0) : 1;
        $this->db->prepare("UPDATE report_card_mantras SET text=?, is_active=? WHERE id=? AND user_id=?")
            ->execute([substr($text, 0, 255), $isActive, $id, $this->uid]);
        jsonResponse(['success' => true]);
    }

    public function deleteMantra() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid mantra');
        $this->db->prepare("DELETE FROM report_card_mantras WHERE id=? AND user_id=?")->execute([$id, $this->uid]);
        jsonResponse(['success' => true]);
    }

    public function toggleMantraCheck() {
        $d = jsonInput();
        $cardId = validId($d['card_id'] ?? 0);
        $mantraId = validId($d['mantra_id'] ?? 0);
        if (!$cardId || !$this->ownsCard($cardId) || !$mantraId) jsonError('Invalid request');
        $o = $this->db->prepare("SELECT id FROM report_card_mantras WHERE id=? AND user_id=?");
        $o->execute([$mantraId, $this->uid]);
        if (!$o->fetchColumn()) jsonError('Invalid mantra');

        if (!empty($d['checked'])) {
            $this->db->prepare("INSERT IGNORE INTO report_card_mantra_checks (card_id, mantra_id) VALUES (?,?)")->execute([$cardId, $mantraId]);
        } else {
            $this->db->prepare("DELETE FROM report_card_mantra_checks WHERE card_id=? AND mantra_id=?")->execute([$cardId, $mantraId]);
        }
        jsonResponse(['success' => true]);
    }

    // ══════════════════════════════════════════════════════════════════
    // TICKERS — repeatable rows + chart images
    // ══════════════════════════════════════════════════════════════════

    public function addTicker() {
        $d = jsonInput();
        $cardId = validId($d['card_id'] ?? 0);
        if (!$cardId || !$this->ownsCard($cardId)) jsonError('Invalid card');
        $ticker = trim((string)($d['ticker'] ?? ''));
        if ($ticker === '') jsonError('Ticker is required');
        $tradeId = validId($d['trade_id'] ?? 0) ?: null;
        if ($tradeId) {
            $o = $this->db->prepare("SELECT id FROM trades WHERE id=? AND user_id=?");
            $o->execute([$tradeId, $this->uid]);
            if (!$o->fetchColumn()) $tradeId = null;
        }
        $ord = $this->db->prepare("SELECT COALESCE(MAX(sort_order),-1)+1 FROM report_card_tickers WHERE card_id=?");
        $ord->execute([$cardId]);
        $this->db->prepare("INSERT INTO report_card_tickers (card_id, sort_order, ticker, pnl, trade_analysis, chart_notes, trade_id) VALUES (?,?,?,?,?,?,?)")
            ->execute([
                $cardId, (int)$ord->fetchColumn(), substr($ticker, 0, 30),
                isset($d['pnl']) && $d['pnl'] !== '' ? round((float)$d['pnl'], 2) : null,
                trim((string)($d['trade_analysis'] ?? '')) ?: null,
                trim((string)($d['chart_notes'] ?? '')) ?: null,
                $tradeId,
            ]);
        jsonResponse(['success' => true, 'id' => (int)$this->db->lastInsertId()]);
    }

    public function updateTicker() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid ticker row');
        $o = $this->db->prepare("SELECT rct.id FROM report_card_tickers rct JOIN report_cards rc ON rc.id=rct.card_id WHERE rct.id=? AND rc.user_id=?");
        $o->execute([$id, $this->uid]);
        if (!$o->fetchColumn()) jsonError('Invalid ticker row');

        $ticker = trim((string)($d['ticker'] ?? ''));
        if ($ticker === '') jsonError('Ticker is required');
        $this->db->prepare("UPDATE report_card_tickers SET ticker=?, pnl=?, trade_analysis=?, chart_notes=? WHERE id=?")
            ->execute([
                substr($ticker, 0, 30),
                isset($d['pnl']) && $d['pnl'] !== '' ? round((float)$d['pnl'], 2) : null,
                trim((string)($d['trade_analysis'] ?? '')) ?: null,
                trim((string)($d['chart_notes'] ?? '')) ?: null,
                $id,
            ]);
        jsonResponse(['success' => true]);
    }

    public function deleteTicker() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid ticker row');
        $o = $this->db->prepare("SELECT rct.id FROM report_card_tickers rct JOIN report_cards rc ON rc.id=rct.card_id WHERE rct.id=? AND rc.user_id=?");
        $o->execute([$id, $this->uid]);
        if (!$o->fetchColumn()) jsonError('Invalid ticker row');
        // Images are deleted from disk here — the FK cascade removes the DB rows but never touches media/.
        $imgs = $this->db->prepare("SELECT file_path FROM report_card_ticker_images WHERE ticker_id=?");
        $imgs->execute([$id]);
        $dir = safeMediaDir($this->uid);
        foreach ($imgs->fetchAll() as $img) {
            $p = $dir . basename($img['file_path']);
            if (file_exists($p)) @unlink($p);
        }
        $this->db->prepare("DELETE FROM report_card_tickers WHERE id=?")->execute([$id]);
        jsonResponse(['success' => true]);
    }

    public function uploadTickerImage() {
        $tickerId = validId($_POST['ticker_id'] ?? 0);
        if (!$tickerId) jsonError('Invalid ticker row');
        $o = $this->db->prepare("SELECT rct.id FROM report_card_tickers rct JOIN report_cards rc ON rc.id=rct.card_id WHERE rct.id=? AND rc.user_id=?");
        $o->execute([$tickerId, $this->uid]);
        if (!$o->fetchColumn()) jsonError('Invalid ticker row');

        if (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) jsonError('No image uploaded');
        $file = $_FILES['image'];
        if ($file['size'] > 5 * 1024 * 1024) jsonError('Image exceeds 5MB limit');
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp'];
        if (!isset($allowed[$mime])) jsonError('Not a valid image');
        $fn = 'reportcard_' . bin2hex(random_bytes(16)) . '.' . $allowed[$mime];
        if (!move_uploaded_file($file['tmp_name'], safeMediaDir($this->uid) . $fn)) jsonError('Failed to save image');

        $ord = $this->db->prepare("SELECT COALESCE(MAX(sort_order),-1)+1 FROM report_card_ticker_images WHERE ticker_id=?");
        $ord->execute([$tickerId]);
        $this->db->prepare("INSERT INTO report_card_ticker_images (ticker_id, file_path, sort_order) VALUES (?,?,?)")
            ->execute([$tickerId, $fn, (int)$ord->fetchColumn()]);
        jsonResponse(['success' => true, 'id' => (int)$this->db->lastInsertId(), 'file_path' => $fn]);
    }

    public function deleteTickerImage() {
        $d = jsonInput();
        $id = validId($d['id'] ?? 0);
        if (!$id) jsonError('Invalid image');
        $o = $this->db->prepare(
            "SELECT rcti.file_path FROM report_card_ticker_images rcti
             JOIN report_card_tickers rct ON rct.id=rcti.ticker_id
             JOIN report_cards rc ON rc.id=rct.card_id
             WHERE rcti.id=? AND rc.user_id=?"
        );
        $o->execute([$id, $this->uid]);
        $path = $o->fetchColumn();
        if (!$path) jsonError('Invalid image');
        $p = safeMediaDir($this->uid) . basename($path);
        if (file_exists($p)) @unlink($p);
        $this->db->prepare("DELETE FROM report_card_ticker_images WHERE id=?")->execute([$id]);
        jsonResponse(['success' => true]);
    }

    // ══════════════════════════════════════════════════════════════════
    // HISTORY + STREAK
    // ══════════════════════════════════════════════════════════════════

    public function getHistory() {
        $chId = $this->scopeChallengeId();
        $limit = min(200, max(1, (int)($_GET['limit'] ?? 60)));
        // pnl_auto is never written to report_cards.pnl_auto — like buildCardPayload()
        // above, it's always derived live from trades ("derive, don't store," the same
        // principle challenges.current_balance is built on — see CLAUDE.md v3.13.0).
        // Reading the stored column here would always return NULL; this correlated
        // subquery is the same SUM(net_pnl) computation buildCardPayload() runs, scoped
        // per history row instead of per single card.
        $s = $this->db->prepare(
            "SELECT rc.id, rc.card_date, rc.overall_grade, rc.pnl, rc.status,
                    (SELECT COALESCE(SUM(t.net_pnl),0) FROM trades t WHERE t.challenge_id=rc.challenge_id AND t.trade_date=rc.card_date AND t.result IN ('Win','Loss','Break Even')) AS pnl_auto,
                    (SELECT COUNT(*) FROM report_card_blocks b WHERE b.card_id=rc.id) AS block_count,
                    (SELECT alignment_score FROM report_card_ai_reviews r WHERE r.card_id=rc.id AND r.status='complete' ORDER BY r.created_at DESC LIMIT 1) AS alignment_score
             FROM report_cards rc WHERE rc.user_id=? AND rc.challenge_id=? ORDER BY rc.card_date DESC LIMIT ?"
        );
        $s->bindValue(1, $this->uid, PDO::PARAM_INT);
        $s->bindValue(2, $chId, PDO::PARAM_INT);
        $s->bindValue(3, $limit, PDO::PARAM_INT);
        $s->execute();
        jsonResponse(['cards' => $s->fetchAll(), 'streak' => $this->computeStreak($chId)]);
    }

    /**
     * Consecutive-day streak of 'complete' cards ("don't break the chain," §2), walking
     * backwards from today. If today's card isn't complete yet (the common case — the
     * trading day may still be open), the walk starts from yesterday instead, so an
     * in-progress today doesn't zero out an otherwise-intact streak. Not a quoted spec —
     * the briefing names the feature but not this exact edge-case rule; documented here as
     * the judgment call it is.
     */
    private function computeStreak(int $chId): int {
        $s = $this->db->prepare("SELECT card_date FROM report_cards WHERE user_id=? AND challenge_id=? AND status='complete' ORDER BY card_date DESC");
        $s->execute([$this->uid, $chId]);
        $complete = array_flip($s->fetchAll(PDO::FETCH_COLUMN));

        $d = new DateTime($this->today());
        if (!isset($complete[$d->format('Y-m-d')])) $d->modify('-1 day');
        $streak = 0;
        while (isset($complete[$d->format('Y-m-d')])) {
            $streak++;
            $d->modify('-1 day');
        }
        return $streak;
    }
}
