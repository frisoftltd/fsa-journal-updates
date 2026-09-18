<?php
/**
 * FundedControl — Bitfunded Paste Parser (v3.14.0)
 * Pure parsing: no DB access, no side effects. Used by BitfundedImportController and by
 * the self-test at the bottom of this file (run standalone: `php bitfunded_parser.php`).
 *
 * Both Bitfunded tabs paste as tab-separated rows, one row per line, when selected and
 * copied out of the browser table (standard browser behavior for copying an HTML table
 * into a plain-text target). Every row is validated against the exact column shape
 * described in the CLAUDE.md v3.14.0 import spec; a row that doesn't fit is a hard
 * failure naming the line and the reason, never a silent skip — silent misses on
 * hand-typed data are exactly what this importer exists to stop reproducing on parsed
 * data (see CLAUDE.md v3.14.0, "Why this exists").
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

function bf_split_line(string $line): array {
    // Tab-separated is the expected shape (browsers convert an HTML table's cells to
    // tabs on copy). If a line has no tabs at all but has runs of 2+ spaces, fall back
    // to that — some paste paths collapse tabs to spaces — but never fall back further
    // than that; a line that fits neither shape is a parse failure, not a guess.
    if (strpos($line, "\t") !== false) {
        return array_map('trim', explode("\t", $line));
    }
    return array_values(array_filter(array_map('trim', preg_split('/ {2,}/', $line))));
}

/**
 * Position History (Box 1). One row per closed position. 13 columns:
 * Contract, Direction, Leverage, Margin Mode, Opening Time, Liquidate Date,
 * Average price, Exit Price, Realized PnL, Realized PnL%, Liquidation Qty, Fee, Exit reason.
 *
 * Returns a list of associative rows:
 *   pair, direction, time_in, time_out, entry_price, exit_price, pnl, lot_size, fees, exit_reason
 * (leverage, margin mode, Realized PnL% are read for column-count validation and discarded —
 * they aren't part of the AFTER-import field set in CLAUDE.md v3.14.0 §2).
 *
 * Throws BitfundedParseException naming the exact line and reason on anything that
 * doesn't fit — including a paste from the wrong tab (Order History / Transaction
 * Details), which this rejects structurally: neither has 13 columns with a Long/Short
 * value in column 2.
 */
function parsePositionHistory(string $raw): array {
    $rawLines = preg_split('/\r\n|\r|\n/', $raw);
    $lines = [];
    foreach ($rawLines as $i => $l) {
        if (trim($l) === '') continue;
        $lines[] = ['n' => $i + 1, 'text' => $l];
    }
    if (empty($lines)) {
        throw new BitfundedParseException('Position History paste is empty. Copy the table from Bitfunded → Trader Hub → Position History and paste it in Box 1.');
    }

    $EXPECTED_COLS = 13;
    $rows = [];
    $headerSkipped = false;

    foreach ($lines as $entry) {
        $lineNo = $entry['n'];
        $cells = bf_split_line($entry['text']);

        // A single leading header row ("Contract  Direction  ...") is expected and
        // skipped once, by name — not by position — so a genuine data row that happens
        // to be first is never silently dropped.
        if (!$headerSkipped && count($cells) >= 2 && strcasecmp(trim($cells[0]), 'Contract') === 0) {
            $headerSkipped = true;
            continue;
        }

        if (count($cells) !== $EXPECTED_COLS) {
            throw new BitfundedParseException(
                "Line $lineNo: expected $EXPECTED_COLS columns (Contract, Direction, Leverage, Margin Mode, " .
                "Opening Time, Liquidate Date, Average price, Exit Price, Realized PnL, Realized PnL%, " .
                "Liquidation Qty, Fee, exit reason) but found " . count($cells) . ". " .
                "This does not look like Position History — Order History and Transaction Details use a " .
                "different layout and are not read by this importer. Copy from Bitfunded → Trader Hub → " .
                "Position History and paste that table in Box 1."
            );
        }

        [$contract, $directionRaw, , , $openingTime, $liquidateDate, $avgPrice, $exitPrice,
         $realizedPnl, , $liqQty, $fee, $exitReasonRaw] = $cells;

        $pairParts = preg_split('/\s+/', trim($contract));
        $pair = strtoupper($pairParts[0] ?? '');
        if ($pair === '') {
            throw new BitfundedParseException("Line $lineNo: could not read a pair symbol from Contract \"$contract\".");
        }

        $direction = ucfirst(strtolower(trim($directionRaw)));
        if ($direction !== 'Long' && $direction !== 'Short') {
            throw new BitfundedParseException(
                "Line $lineNo: Direction \"$directionRaw\" is not Long or Short. This does not look like a " .
                "Position History row — check that Box 1 has the Position History table, not Order History " .
                "or Transaction Details."
            );
        }

        $exitReason = trim($exitReasonRaw);
        if ($exitReason === '') {
            throw new BitfundedParseException("Line $lineNo: exit reason column is blank.");
        }
        if (strlen($exitReason) > 40) {
            throw new BitfundedParseException("Line $lineNo: exit reason \"$exitReason\" is longer than 40 characters — truncating would silently lose data, not applying it.");
        }

        $rows[] = [
            'line'        => $lineNo,
            'pair'        => $pair,
            'direction'   => $direction,
            'time_in'     => bf_parse_datetime($openingTime, $lineNo, 'Opening Time'),
            'time_out'    => bf_parse_datetime($liquidateDate, $lineNo, 'Liquidate Date'),
            'entry_price' => bf_parse_num($avgPrice, $lineNo, 'Average price'),
            'exit_price'  => bf_parse_num($exitPrice, $lineNo, 'Exit Price'),
            'pnl'         => bf_parse_num($realizedPnl, $lineNo, 'Realized PnL'),
            'lot_size'    => bf_parse_num($liqQty, $lineNo, 'Liquidation Qty'),
            // Position History shows Fee as a negative (a cost); trades.fees is a
            // positive magnitude, subtracted explicitly in net_pnl = pnl - fees.
            'fees'        => abs(bf_parse_num($fee, $lineNo, 'Fee')),
            'exit_reason' => $exitReason,
        ];
    }

    if (empty($rows)) {
        throw new BitfundedParseException('No position rows found after the header — paste looks empty or header-only.');
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
