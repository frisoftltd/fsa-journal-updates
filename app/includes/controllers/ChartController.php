<?php
/**
 * FundedControl — Chart Controller (Backtesting Phase 1a)
 * Handles: get_symbols, get_candles
 *
 * Read-only, MySQL-only — never calls Bybit. Per the briefing, the browser and every
 * page request must only ever read candles that the CLI pipeline (app/cli/backfill.php,
 * update.php) already fetched and stored; this controller has no code path to reach the
 * network at all, so that boundary can't be crossed by accident here.
 */
class ChartController {
    private $db;

    const DEFAULT_LIMIT = 500;
    const MAX_LIMIT = 2000;

    public function __construct() {
        $this->db = getDB();
    }

    /** Symbol switcher's data source — every enabled symbol, database-driven per the
     *  briefing (never a hardcoded list anywhere in the frontend). */
    public function getSymbols() {
        $s = $this->db->query("SELECT symbol, display_name, earliest_candle_ms FROM symbols WHERE enabled=1 ORDER BY display_name");
        jsonResponse($s->fetchAll());
    }

    /**
     * One window of candles, ascending by open_time. `before` (UTC ms, exclusive) is
     * what powers "load older candles on scroll" — omit it for the initial, most-recent
     * window. `limit` defaults to 500 and is hard-capped at MAX_LIMIT regardless of what
     * a caller asks for, so a single request can never pull the full history the
     * briefing explicitly says never to load at once.
     *
     * `symbol`/`timeframe` are validated against the real symbols/timeframe set rather
     * than trusted as free-form input reaching a WHERE clause — prepared statements
     * already make this SQL-injection-safe, but an unknown symbol/timeframe should fail
     * loudly with a clear error, not silently return an empty window that looks like
     * "this symbol just has no data."
     */
    public function getCandles() {
        $symbol = strtoupper(trim($_GET['symbol'] ?? ''));
        $timeframe = trim($_GET['timeframe'] ?? '');
        $before = isset($_GET['before']) && $_GET['before'] !== '' ? (int) $_GET['before'] : null;
        $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : self::DEFAULT_LIMIT;
        $limit = max(1, min(self::MAX_LIMIT, $limit));

        if (!in_array($timeframe, ['15m', '1H', '4H', '1D'], true)) {
            jsonError('Invalid timeframe. Expected one of: 15m, 1H, 4H, 1D');
        }

        $sc = $this->db->prepare("SELECT symbol FROM symbols WHERE symbol=? AND enabled=1");
        $sc->execute([$symbol]);
        if (!$sc->fetch()) jsonError('Unknown or disabled symbol.');

        $params = [$symbol, $timeframe];
        $sql = "SELECT open_time, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe=?";
        if ($before !== null) {
            $sql .= " AND open_time < ?";
            $params[] = $before;
        }
        $sql .= " ORDER BY open_time DESC LIMIT ?";
        $params[] = $limit;

        $st = $this->db->prepare($sql);
        // Bind the LIMIT param explicitly as an int -- PDO treats every ?-bound value as
        // a string by default, and MySQL's LIMIT clause rejects a quoted string operand.
        foreach ($params as $i => $p) {
            $st->bindValue($i + 1, $p, $i === count($params) - 1 ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $st->execute();
        $rows = array_reverse($st->fetchAll()); // DESC-fetched for the LIMIT to take the most recent window, then reversed to ascending for the chart

        jsonResponse(array_map(function ($r) {
            return [
                'time'   => (int) $r['open_time'],
                'open'   => (float) $r['open'],
                'high'   => (float) $r['high'],
                'low'    => (float) $r['low'],
                'close'  => (float) $r['close'],
                'volume' => (float) $r['volume'],
            ];
        }, $rows));
    }
}
