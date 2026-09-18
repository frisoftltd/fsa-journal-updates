<?php
/**
 * FundedControl — Bitfunded Paste Parser (v3.14.4)
 * Pure parsing: no DB access, no side effects. Used by BitfundedImportController and by
 * the self-test at the bottom of this file (run standalone: `php bitfunded_parser.php`).
 *
 * The two Bitfunded tabs paste in genuinely different shapes and are parsed differently:
 *
 * - Transaction History (Box 2) IS a real HTML table, and copies as tab-separated rows,
 *   one row per line — standard browser behavior for copying a table into plain text.
 *   parseTransactionHistory() below still expects that shape.
 * - Position History (Box 1) is a CARD layout, not a table — each position copies as a
 *   block of lines, a label on one line and its value on the next (e.g. "Opening Time" /
 *   "2026-09-14 06:08:19"). A real paste has one column, not thirteen. v3.14.0 assumed
 *   Position History was an HTML table too, without checking against a real paste — every
 *   real paste was rejected with "expected 13 columns... found 1". parsePositionHistory()
 *   below is label-driven, not position-driven: a line matching "<SYMBOL> Perpetual"
 *   starts a new record, and every field is found by its own label rather than by a fixed
 *   line offset, since which optional lines (the "Close All" button, the exit-reason line)
 *   are present varies row to row. See CLAUDE.md v3.14.1 for the full verified format.
 *
 * Both parsers still fail loudly, naming the line and the reason, on anything that doesn't
 * fit — silent misses on hand-typed data are exactly what this importer exists to stop
 * reproducing on parsed data (see CLAUDE.md v3.14.0, "Why this exists").
 */

class BitfundedParseException extends Exception {}

/** Strip thousands separators, %, currency suffixes, +, whitespace; keep sign and decimal point. */
function bf_parse_num(string $raw, int $lineNo, string $field): float {
    $s = trim($raw);
    if ($s === '') throw new BitfundedParseException("Line $lineNo: $field is empty.");
    $cleaned = preg_replace('/[^0-9.\-]/', '', $s);
    if ($cleaned === '' || $cleaned === '-' || $cleaned === '.' || !is_numeric($cleaned)) {
        throw new BitfundedParseException("Line $lineNo: $field \"$raw\" is not a recognizable number.");
    }
    return (float) $cleaned;
}

/** Bitfunded's own datetime format, "YYYY-MM-DD HH:MM:SS". Strict — reformats via strtotime as a sanity parse, not a tolerant one. */
function bf_parse_datetime(string $raw, int $lineNo, string $field): string {
    $s = trim($raw);
    if ($s === '') throw new BitfundedParseException("Line $lineNo: $field is empty.");
    $ts = strtotime($s);
    if ($ts === false) {
        throw new BitfundedParseException("Line $lineNo: $field \"$raw\" is not a recognizable date/time.");
    }
    return date('Y-m-d H:i:s', $ts);
}

/**
 * Normalizes a line before any exact-text comparison (label matching, Long/Short,
 * "Close All", margin mode). A browser copy of a styled card routinely carries non-breaking
 * spaces (U+00A0), zero-width spaces (U+200B), and a BOM/zero-width-no-break-space
 * (U+FEFF) in place of, or alongside, plain spaces — PHP's trim() does not strip any of
 * these, so a label like "Realized PnL%" with a trailing NBSP survives trim() as
 * "realized pnl% " (note the trailing space) and silently fails exact match against the
 * known-label set, misclassifying it as the exit reason instead of a discarded label.
 * Collapsing all of these to a single plain space before trimming makes exact-text
 * comparisons resilient to that class of invisible-character artifact.
 */
function bf_clean_line(string $l): string {
    $l = preg_replace('/[\x{00A0}\x{200B}\x{FEFF}]/u', ' ', $l) ?? $l;
    $l = preg_replace('/\s+/u', ' ', $l) ?? $l;
    return trim($l);
}

/** Space-separated hex byte dump, for diagnostics only -- never used in a comparison. */
function bf_hex(string $s): string {
    return implode(' ', str_split(bin2hex($s), 2));
}

function bf_split_line(string $line): array {
    // Tab-separated is the expected shape (browsers convert an HTML table's cells to
    // tabs on copy). If a line has no tabs at all but has runs of 2+ spaces, fall back
    // to that — some paste paths collapse tabs to spaces — but never fall back further
    // than that; a line that fits neither shape is a parse failure, not a guess.
    if (strpos($line, "\t") !== false) {
        return array_map('bf_clean_line', explode("\t", $line));
    }
    return array_values(array_filter(array_map('bf_clean_line', preg_split('/ {2,}/', $line))));
}

/**
 * Position History (Box 1). A CARD layout, not a table — see the file header. Each
 * position pastes as a block of lines starting with its contract line ("BNBUSDT
 * Perpetual") and running up to the next contract line (or end of paste). Verified
 * against a real two-position paste; see CLAUDE.md v3.14.1 for the sample block.
 *
 * A typical block, in the order Bitfunded renders it (order is NOT relied on below):
 *   BNBUSDT Perpetual / Long / 5X / Isolated / Close All / Stop Loss /
 *   Opening Time / 2026-09-14 06:08:19 / Average price / 723.41 USDT /
 *   Realized PnL / -98.68USDT / Liquidation Qty / 6.75 BNB /
 *   Liquidate Date / 2026-09-15 20:49:24 / Exit Price / 708.79USDT /
 *   Realized PnL% / -10.10% / Fee / -3.86690000 USDT
 *
 * Parsing is entirely label-driven, not position-driven, because two lines are known to
 * be optional and Bitfunded's exact label order isn't guaranteed to be stable release to
 * release:
 *   - "Close All" is a live-action button, not always present.
 *   - The exit-reason line ("Stop Loss", "Manual Closing", possibly others not seen yet)
 *     is an open set — never mapped to an enum, and may be absent entirely.
 * Contract line -> pair (the "<SYMBOL> Perpetual" pattern; SYMBOL is kept verbatim,
 * uppercased). Next line -> direction (Long/Short, required). Every other line in the
 * block is either a known label (its value is the line immediately after it), leverage
 * ("5X" — discarded), margin mode (Isolated/Cross — discarded), the literal "Close All"
 * (discarded), or — whatever single line is left over after all of those — the exit
 * reason. More than one leftover line is a parse failure (ambiguous), not a guess.
 *
 * Returns a list of associative rows:
 *   pair, direction, time_in, time_out, entry_price, exit_price, pnl, lot_size, fees, exit_reason
 *
 * Throws BitfundedParseException naming the exact line and reason on anything that
 * doesn't fit — including a paste from the wrong tab (Order History / Transaction
 * Details / Transaction History), which this rejects structurally: none of them contain
 * a "<SYMBOL> Perpetual" line followed by Long/Short.
 */
function parsePositionHistory(string $raw): array {
    $rawLines = preg_split('/\r\n|\r|\n/', $raw);
    $lines = [];
    foreach ($rawLines as $i => $l) {
        $clean = bf_clean_line($l);
        if ($clean === '') continue;
        // 'raw' is kept only for the ambiguous-leftover diagnostic below (v3.14.3) -- it's
        // the pre-bf_clean_line() text, so a hex dump of it can show whether a character
        // was stripped during cleaning or was never touched at all.
        $lines[] = ['n' => $i + 1, 'text' => $clean, 'raw' => $l];
    }
    if (empty($lines)) {
        throw new BitfundedParseException('Position History paste is empty. Copy each position\'s card from Bitfunded → Trader Hub → Position History and paste them in Box 1.');
    }

    $CONTRACT_RE = '/^([A-Za-z0-9]+)\s+Perpetual$/i';

    $starts = [];
    foreach ($lines as $idx => $entry) {
        if (preg_match($CONTRACT_RE, $entry['text'])) $starts[] = $idx;
    }
    if (empty($starts)) {
        throw new BitfundedParseException(
            'No position blocks found — no line reads "<SYMBOL> Perpetual". This does not look like ' .
            'Position History. Order History and Transaction History use different layouts and are not ' .
            'read by this box. Copy from Bitfunded → Trader Hub → Position History and paste each ' .
            'position\'s card block in Box 1.'
        );
    }

    // label (lowercased, exact line match) => target field key, or null to read-and-discard.
    $LABELS = [
        'opening time'    => 'time_in_raw',
        'average price'   => 'entry_price_raw',
        'realized pnl'    => 'pnl_raw',
        'liquidation qty' => 'lot_size_raw',
        'liquidate date'  => 'time_out_raw',
        'exit price'      => 'exit_price_raw',
        'realized pnl%'   => null,
        'fee'             => 'fee_raw',
    ];
    $DISPLAY = [
        'time_in_raw' => 'Opening Time', 'entry_price_raw' => 'Average price', 'pnl_raw' => 'Realized PnL',
        'lot_size_raw' => 'Liquidation Qty', 'time_out_raw' => 'Liquidate Date', 'exit_price_raw' => 'Exit Price',
        'fee_raw' => 'Fee',
    ];
    $REQUIRED = ['time_in_raw', 'entry_price_raw', 'pnl_raw', 'lot_size_raw', 'time_out_raw', 'exit_price_raw', 'fee_raw'];

    $rows = [];
    $total = count($lines);
    foreach ($starts as $s => $begin) {
        $end = ($s + 1 < count($starts)) ? $starts[$s + 1] : $total;
        $block = array_slice($lines, $begin, $end - $begin);
        $startLineNo = $block[0]['n'];

        $m = [];
        preg_match($CONTRACT_RE, $block[0]['text'], $m);
        $pair = strtoupper($m[1]);

        if (!isset($block[1])) {
            throw new BitfundedParseException("Line $startLineNo: \"{$block[0]['text']}\" has no direction line after it.");
        }
        $direction = ucfirst(strtolower($block[1]['text']));
        if ($direction !== 'Long' && $direction !== 'Short') {
            throw new BitfundedParseException("Line {$block[1]['n']}: expected Long or Short after \"{$block[0]['text']}\", found \"{$block[1]['text']}\".");
        }

        $values = [];
        $consumed = [0 => true, 1 => true];
        for ($i = 2; $i < count($block); $i++) {
            if (isset($consumed[$i])) continue;
            $key = strtolower($block[$i]['text']);
            if (!array_key_exists($key, $LABELS)) continue;
            if (!isset($block[$i + 1])) {
                throw new BitfundedParseException("Line {$block[$i]['n']}: \"{$block[$i]['text']}\" has no value line after it.");
            }
            $target = $LABELS[$key];
            $valueText = $block[$i + 1]['text'];
            $valueLineNo = $block[$i + 1]['n'];
            $consumed[$i] = true;
            $consumed[$i + 1] = true;

            // v3.14.4: a value and its unit can land on separate lines -- "Fee" / "-3.8669"
            // / "USDT" as three lines, not "Fee" / "-3.8669 USDT" as two. Confirmed against
            // a real paste (the orphaned "USDT" line was what actually collided with the
            // exit reason and produced the "more than one unrecognized line" error). If the
            // line right after the value is a bare unit token -- USDT, or the position's own
            // asset symbol, always plain uppercase letters and nothing else on the line --
            // fold it into the value instead of leaving it loose. Not specific to Fee: any
            // label's value can split this way depending on how Bitfunded renders that row.
            $unitIdx = $i + 2;
            if (isset($block[$unitIdx]) && !isset($consumed[$unitIdx])) {
                $unitText = $block[$unitIdx]['text'];
                if (preg_match('/^[A-Z]{2,10}$/', $unitText) && !array_key_exists(strtolower($unitText), $LABELS)) {
                    $valueText .= ' ' . $unitText;
                    $consumed[$unitIdx] = true;
                }
            }

            if ($target !== null) {
                $values[$target] = ['text' => $valueText, 'n' => $valueLineNo];
            }
            $i++;
        }

        // Whatever's left (not contract, direction, a label, or a label's value) is
        // leverage, margin mode, "Close All", or the exit reason — recognized by pattern
        // for the first three (a bounded, stable set); anything else left over is the
        // exit reason, since that set is open. See function doc above.
        $leftover = [];
        for ($i = 2; $i < count($block); $i++) {
            if (isset($consumed[$i])) continue;
            $text = $block[$i]['text'];
            if (preg_match('/^\d+(\.\d+)?x$/i', $text)) continue;      // leverage, e.g. "5X"
            if (preg_match('/^(isolated|cross)$/i', $text)) continue; // margin mode
            if (strcasecmp($text, 'Close All') === 0) continue;       // live-action button
            $leftover[] = $block[$i];
        }
        if (count($leftover) > 1) {
            $where = implode(', ', array_map(fn($l) => $l['n'], $leftover));
            // v3.14.3: two rounds of fixing this exact error from reasoning about plausible
            // causes (13-column assumption, then an explicit NBSP/ZWSP/BOM strip list) both
            // shipped without ever seeing the actual bytes on the unrecognized line. Show
            // them here instead of guessing again -- raw (pre-bf_clean_line) and cleaned
            // (post-bf_clean_line) text plus a hex dump of each, so the next failure is
            // self-diagnosing from one paste rather than another round of inference.
            $diag = array_map(function ($l) {
                return "  line {$l['n']}: \"{$l['text']}\"\n" .
                    "    raw:                  " . bf_hex($l['raw']) . "\n" .
                    "    after bf_clean_line(): \"{$l['text']}\" (hex: " . bf_hex($l['text']) . ")";
            }, $leftover);
            throw new BitfundedParseException(
                "Lines $where: more than one unrecognized line in the $pair block starting at line " .
                "$startLineNo — expected at most one, the exit reason.\n" . implode("\n", $diag)
            );
        }
        $exitReason = $leftover ? trim($leftover[0]['text']) : '';
        if (strlen($exitReason) > 40) {
            throw new BitfundedParseException("Line {$leftover[0]['n']}: exit reason \"$exitReason\" is longer than 40 characters — truncating would silently lose data, not applying it.");
        }

        foreach ($REQUIRED as $key) {
            if (!isset($values[$key])) {
                throw new BitfundedParseException("Line $startLineNo ($pair): missing \"{$DISPLAY[$key]}\" in this position's block.");
            }
        }

        $rows[] = [
            'line'        => $startLineNo,
            'pair'        => $pair,
            'direction'   => $direction,
            'time_in'     => bf_parse_datetime($values['time_in_raw']['text'], $values['time_in_raw']['n'], 'Opening Time'),
            'time_out'    => bf_parse_datetime($values['time_out_raw']['text'], $values['time_out_raw']['n'], 'Liquidate Date'),
            'entry_price' => bf_parse_num($values['entry_price_raw']['text'], $values['entry_price_raw']['n'], 'Average price'),
            'exit_price'  => bf_parse_num($values['exit_price_raw']['text'], $values['exit_price_raw']['n'], 'Exit Price'),
            'pnl'         => bf_parse_num($values['pnl_raw']['text'], $values['pnl_raw']['n'], 'Realized PnL'),
            'lot_size'    => bf_parse_num($values['lot_size_raw']['text'], $values['lot_size_raw']['n'], 'Liquidation Qty'),
            // Position History shows Fee as a negative (a cost); trades.fees is a
            // positive magnitude, subtracted explicitly in net_pnl = pnl - fees.
            'fees'        => abs(bf_parse_num($values['fee_raw']['text'], $values['fee_raw']['n'], 'Fee')),
            'exit_reason' => $exitReason,
        ];
    }

    return $rows;
}

/**
 * Transaction History (Box 2, optional). Tab-separated: Type, Transaction, Amount, Time, Balance.
 * Only two things are taken from it: the sum of Amount where Type = 'Funding Fee', and the
 * most recent Balance value. Everything else in the tab is read only far enough to validate
 * shape and is otherwise ignored — this is not a general transaction importer.
 *
 * Returns ['funding_total' => float, 'latest_balance' => float|null, 'row_count' => int].
 * funding_total is the sum of raw Amount values for funding rows, negated so it's ready to
 * write directly into challenges.funding_adjustment (see CLAUDE.md v3.14.0: a negative
 * Amount there is money leaving the account — a cost — and funding_adjustment is a positive
 * magnitude subtracted in the balance formula, so the sign must flip once here, not per row
 * elsewhere).
 */
function parseTransactionHistory(string $raw): array {
    $rawLines = preg_split('/\r\n|\r|\n/', $raw);
    $lines = [];
    foreach ($rawLines as $i => $l) {
        if (trim($l) === '') continue;
        $lines[] = ['n' => $i + 1, 'text' => $l];
    }
    if (empty($lines)) {
        throw new BitfundedParseException('Transaction History paste is empty.');
    }

    $EXPECTED_COLS = 5;
    $headerSkipped = false;
    $fundingSum = 0.0;
    $latestBalance = null;
    $latestTs = null;
    $rowCount = 0;

    foreach ($lines as $entry) {
        $lineNo = $entry['n'];
        $cells = bf_split_line($entry['text']);

        if (!$headerSkipped && count($cells) >= 2 && strcasecmp(trim($cells[0]), 'Type') === 0) {
            $headerSkipped = true;
            continue;
        }

        if (count($cells) !== $EXPECTED_COLS) {
            throw new BitfundedParseException(
                "Line $lineNo: expected $EXPECTED_COLS columns (Type, Transaction, Amount, Time, Balance) " .
                "but found " . count($cells) . ". This does not look like Transaction History — Order History " .
                "and Transaction Details use a different layout and are not read by this importer. Copy from " .
                "Bitfunded → Trader Hub → Transaction History and paste that table in Box 2."
            );
        }

        [$type, , $amountRaw, $timeRaw, $balanceRaw] = $cells;
        $type = trim($type);
        $rowCount++;

        $amount = bf_parse_num($amountRaw, $lineNo, 'Amount');
        if (strcasecmp($type, 'Funding Fee') === 0) {
            $fundingSum += $amount;
        }

        $balance = bf_parse_num($balanceRaw, $lineNo, 'Balance');
        $ts = strtotime(trim($timeRaw));
        if ($ts === false) {
            throw new BitfundedParseException("Line $lineNo: Time \"$timeRaw\" is not a recognizable date/time.");
        }
        if ($latestTs === null || $ts > $latestTs) {
            $latestTs = $ts;
            $latestBalance = $balance;
        }
    }

    if ($rowCount === 0) {
        throw new BitfundedParseException('No transaction rows found after the header — paste looks empty or header-only.');
    }

    return [
        'funding_total'  => round(-1 * $fundingSum, 4),
        'latest_balance' => $latestBalance,
        'row_count'      => $rowCount,
    ];
}

// ── SELF-TEST ────────────────────────────────────────────────────────────
// Run standalone: `php bitfunded_parser.php`. Not executed when this file is required by
// BitfundedImportController — guarded on being the directly-invoked CLI script.
if (PHP_SAPI === 'cli' && basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    bf_self_test();
}

function bf_self_test(): void {
    $pass = 0; $fail = 0;
    $check = function (string $label, $actual, $expected) use (&$pass, &$fail) {
        $ok = is_float($expected) ? (is_numeric($actual) && abs($actual - $expected) < 0.00005) : ($actual === $expected);
        if ($ok) { $pass++; return; }
        $fail++;
        fwrite(STDERR, "FAIL: $label — expected " . var_export($expected, true) . ", got " . var_export($actual, true) . "\n");
    };

    // Real four-position paste (v3.14.4), byte-for-byte from a Notepad-saved copy of an
    // actual Bitfunded Position History clipboard paste -- not typed, not reconstructed
    // from a chat-pasted sample. This replaces the v3.14.1 two-position fixture, which was
    // close enough to pass every prior self-test while the live path kept failing: it had
    // every field's unit inline, and the real paste doesn't. Here, Exit Price genuinely
    // splits across two lines ("708.79" / "USDT") on every one of the four positions while
    // every other field keeps its unit inline -- exactly the shape that produced "Lines 6,
    // 19: more than one unrecognized line" on live, now exercised directly rather than
    // inferred. TRXUSDT additionally covers a Short position, a leading '+' on a winning
    // trade's Realized PnL, and a "Manual Closing" exit reason (not "Stop Loss").
    $paste = <<<'TXT'
BNBUSDT Perpetual
Long
5X
Isolated
Close All
Stop Loss
Opening Time
2026-09-14 06:08:19
Average price
723.41 USDT
Realized PnL
-98.68USDT
Liquidation Qty
6.75 BNB
Liquidate Date
2026-09-15 20:49:24
Exit Price
708.79
USDT
Realized PnL%
-10.10%
Fee
-3.86690000 USDT
ZECUSDT Perpetual
Long
5X
Isolated
Close All
Stop Loss
Opening Time
2026-09-13 06:05:09
Average price
1135.75 USDT
Realized PnL
-95.79USDT
Liquidation Qty
1.77 ZEC
Liquidate Date
2026-09-13 11:31:43
Exit Price
1081.63
USDT
Realized PnL%
-23.82%
Fee
-1.56990000 USDT
LITUSDT Perpetual
Long
5X
Isolated
Close All
Stop Loss
Opening Time
2026-09-11 15:07:02
Average price
4.6370 USDT
Realized PnL
-102.1657USDT
Liquidation Qty
237 LIT
Liquidate Date
2026-09-12 21:54:14
Exit Price
4.2060
USDT
Realized PnL%
-46.48%
Fee
-0.83830000 USDT
TRXUSDT Perpetual
Short
5X
Isolated
Close All
Manual Closing
Opening Time
2026-09-10 15:09:17
Average price
0.33838 USDT
Realized PnL
+3.75199USDT
Liquidation Qty
35300 TRX
Liquidate Date
2026-09-10 15:15:20
Exit Price
0.33828
USDT
Realized PnL%
+0.15%
Fee
-9.55450000 USDT
TXT;

    try {
        $rows = parsePositionHistory($paste);
        $check('row count', count($rows), 4);
        if (count($rows) === 4) {
            [$bnb, $zec, $lit, $trx] = $rows;
            $check('BNB pair', $bnb['pair'], 'BNBUSDT');
            $check('BNB direction', $bnb['direction'], 'Long');
            $check('BNB time_in', $bnb['time_in'], '2026-09-14 06:08:19');
            $check('BNB time_out', $bnb['time_out'], '2026-09-15 20:49:24');
            $check('BNB entry_price', $bnb['entry_price'], 723.41);
            $check('BNB exit_price (split across two lines)', $bnb['exit_price'], 708.79);
            $check('BNB pnl', $bnb['pnl'], -98.68);
            $check('BNB lot_size', $bnb['lot_size'], 6.75);
            $check('BNB fees', $bnb['fees'], 3.8669);
            $check('BNB exit_reason', $bnb['exit_reason'], 'Stop Loss');

            $check('ZEC pair', $zec['pair'], 'ZECUSDT');
            $check('ZEC direction', $zec['direction'], 'Long');
            $check('ZEC time_in', $zec['time_in'], '2026-09-13 06:05:09');
            $check('ZEC time_out', $zec['time_out'], '2026-09-13 11:31:43');
            $check('ZEC entry_price', $zec['entry_price'], 1135.75);
            $check('ZEC exit_price (split across two lines)', $zec['exit_price'], 1081.63);
            $check('ZEC pnl', $zec['pnl'], -95.79);
            $check('ZEC lot_size', $zec['lot_size'], 1.77);
            $check('ZEC fees', $zec['fees'], 1.5699);
            $check('ZEC exit_reason', $zec['exit_reason'], 'Stop Loss');

            $check('LIT pair', $lit['pair'], 'LITUSDT');
            $check('LIT direction', $lit['direction'], 'Long');
            $check('LIT time_in', $lit['time_in'], '2026-09-11 15:07:02');
            $check('LIT time_out', $lit['time_out'], '2026-09-12 21:54:14');
            $check('LIT entry_price', $lit['entry_price'], 4.637);
            $check('LIT exit_price (split across two lines)', $lit['exit_price'], 4.206);
            $check('LIT pnl', $lit['pnl'], -102.1657);
            $check('LIT lot_size (unit is the asset symbol, not USDT)', $lit['lot_size'], 237.0);
            $check('LIT fees', $lit['fees'], 0.8383);
            $check('LIT exit_reason', $lit['exit_reason'], 'Stop Loss');

            $check('TRX pair', $trx['pair'], 'TRXUSDT');
            $check('TRX direction (Short)', $trx['direction'], 'Short');
            $check('TRX time_in', $trx['time_in'], '2026-09-10 15:09:17');
            $check('TRX time_out', $trx['time_out'], '2026-09-10 15:15:20');
            $check('TRX entry_price', $trx['entry_price'], 0.33838);
            $check('TRX exit_price (split across two lines)', $trx['exit_price'], 0.33828);
            $check('TRX pnl is +3.75199, not -3.75199 (leading + on a winning trade)', $trx['pnl'], 3.75199);
            $check('TRX lot_size', $trx['lot_size'], 35300.0);
            $check('TRX fees', $trx['fees'], 9.5545);
            $check('TRX exit_reason (Manual Closing, not Stop Loss)', $trx['exit_reason'], 'Manual Closing');
        }
    } catch (BitfundedParseException $e) {
        $fail++;
        fwrite(STDERR, "FAIL: real four-position paste threw: " . $e->getMessage() . "\n");
    }

    // These two are legitimate, still-true properties of the exact-match label design
    // (added v3.14.1, unrelated to the real cause found in v3.14.4 -- the actual bug was
    // an orphaned unit line, not a stray character or a prefix collision). Kept because
    // they still pin real current behavior, not because either one turned out to be the
    // live defect.
    $pnlPercentOrderSwapped = <<<'TXT'
BNBUSDT Perpetual
Long
5X
Isolated
Close All
Stop Loss
Opening Time
2026-09-14 06:08:19
Average price
723.41 USDT
Realized PnL%
-10.10%
Realized PnL
-98.68USDT
Liquidation Qty
6.75 BNB
Liquidate Date
2026-09-15 20:49:24
Exit Price
708.79USDT
Fee
-3.86690000 USDT
TXT;
    try {
        $rows = parsePositionHistory($pnlPercentOrderSwapped);
        $check('PnL%-before-PnL row count', count($rows), 1);
        $check('PnL%-before-PnL pnl is -98.68, not -10.10', $rows[0]['pnl'] ?? null, -98.68);
        $check('PnL%-before-PnL exit_reason', $rows[0]['exit_reason'] ?? null, 'Stop Loss');
    } catch (BitfundedParseException $e) {
        $fail++;
        fwrite(STDERR, "FAIL: block with Realized PnL% before Realized PnL threw: " . $e->getMessage() . "\n");
    }

    // A trailing non-breaking space (U+00A0) on a label line was v3.14.2's theory for the
    // real failure -- shown in v3.14.3/v3.14.4 not to have been the actual cause (line 19
    // was a bare "USDT", clean ASCII, no invisible character at all). Kept as a real,
    // still-true property: bf_clean_line()'s whitespace normalization does work correctly
    // for this character, it just wasn't what live was hitting.
    $nbspLabel = str_replace('Realized PnL%', "Realized PnL%\u{00A0}", $pnlPercentOrderSwapped);
    try {
        $rows = parsePositionHistory($nbspLabel);
        $check('NBSP-suffixed label row count', count($rows), 1);
        $check('NBSP-suffixed label pnl', $rows[0]['pnl'] ?? null, -98.68);
    } catch (BitfundedParseException $e) {
        $fail++;
        fwrite(STDERR, "FAIL: block with a non-breaking space on the Realized PnL% line threw: " . $e->getMessage() . "\n");
    }

    // Edge case: "Close All" is a live-action button, not always present -- a block
    // missing it must still parse, with the exit reason still found. Exit Price is written
    // split across two lines here (matching the real paste's actual shape, confirmed
    // v3.14.4 -- not the inline guess this block used before) so this case also exercises
    // the value/unit-split fix, not just the missing-button case.
    $noCloseAll = <<<'TXT'
BNBUSDT Perpetual
Long
5X
Isolated
Stop Loss
Opening Time
2026-09-14 06:08:19
Average price
723.41 USDT
Realized PnL
-98.68USDT
Liquidation Qty
6.75 BNB
Liquidate Date
2026-09-15 20:49:24
Exit Price
708.79
USDT
Fee
-3.86690000 USDT
TXT;
    try {
        $rows = parsePositionHistory($noCloseAll);
        $check('no-Close-All row count', count($rows), 1);
        $check('no-Close-All exit_price (still split)', $rows[0]['exit_price'] ?? null, 708.79);
        $check('no-Close-All exit_reason', $rows[0]['exit_reason'] ?? null, 'Stop Loss');
    } catch (BitfundedParseException $e) {
        $fail++;
        fwrite(STDERR, "FAIL: block without Close All threw: " . $e->getMessage() . "\n");
    }

    // Edge case: the exit-reason line itself is an open set and may be absent entirely --
    // must not be required. Same split-Exit-Price shape as above.
    $noExitReason = <<<'TXT'
BNBUSDT Perpetual
Long
5X
Isolated
Close All
Opening Time
2026-09-14 06:08:19
Average price
723.41 USDT
Realized PnL
-98.68USDT
Liquidation Qty
6.75 BNB
Liquidate Date
2026-09-15 20:49:24
Exit Price
708.79
USDT
Fee
-3.86690000 USDT
TXT;
    try {
        $rows = parsePositionHistory($noExitReason);
        $check('no-exit-reason row count', count($rows), 1);
        $check('no-exit-reason exit_price (still split)', $rows[0]['exit_price'] ?? null, 708.79);
        $check('no-exit-reason exit_reason', $rows[0]['exit_reason'] ?? null, '');
    } catch (BitfundedParseException $e) {
        $fail++;
        fwrite(STDERR, "FAIL: block without exit reason threw: " . $e->getMessage() . "\n");
    }

    // A Transaction History paste (a real tab-separated table) must be rejected by
    // parsePositionHistory() structurally, not silently misread as one column.
    try {
        parsePositionHistory("Type\tTransaction\tAmount\tTime\tBalance\nFunding Fee\tFunding\t-1.23\t2026-09-14 00:00:00\t1000.00");
        $fail++;
        fwrite(STDERR, "FAIL: a Transaction History paste was accepted by parsePositionHistory()\n");
    } catch (BitfundedParseException $e) {
        $pass++;
    }

    // Transaction History parser: still a real table, sanity-checked against a small
    // real-shaped paste (mixed decimal precision, as Bitfunded actually displays it).
    $tx = <<<'TXT'
Type	Transaction	Amount	Time	Balance
Funding Fee	Funding	-1.2345	2026-09-14 00:00:00	9800.0000
Funding Fee	Funding	-5.4024	2026-09-15 00:00:00	9750.0000
Realized PnL	Position	-98.68	2026-09-15 20:49:24	9735.1722
TXT;
    try {
        $result = parseTransactionHistory($tx);
        $check('funding_total', $result['funding_total'], 6.6369);
        $check('latest_balance', $result['latest_balance'], 9735.1722);
        $check('row_count', $result['row_count'], 3);
    } catch (BitfundedParseException $e) {
        $fail++;
        fwrite(STDERR, "FAIL: Transaction History parse threw: " . $e->getMessage() . "\n");
    }

    fwrite(STDOUT, "bitfunded_parser.php self-test: $pass passed, $fail failed\n");
    if ($fail > 0) exit(1);
}
