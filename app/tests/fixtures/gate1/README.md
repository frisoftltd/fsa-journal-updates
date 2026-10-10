# FSA Gate 1 parity fixtures

Drop one `<SYMBOL>.json` per coin here, exported from the real TradingView Pine indicator
(`app/docs/reference/FSA_Structure_Gate1.pine` v4.2), Bybit 4H, ≥ 500 candles — per the
Gate 1 briefing's §7 (BTC, LIT, PUMP, LINK minimum).

`app/tests/gate1_parity.js` reads every `*.json` here automatically. With none present it
reports "no fixtures found — skipped" and exits 0 (not a failure).

Expected shape per file (this is this project's own reconstruction from the briefing's
prose, not yet confirmed against a real Pine export — if the real export format differs,
fix this schema and `gate1_parity.js`'s own reader together, not just one of them):

```json
{
  "symbol": "BTCUSDT",
  "candles": [{"t": 1690000000, "o": 29000.0, "h": 29150.0, "l": 28950.0, "c": 29100.0}],
  "swings": [{"type": "HH", "price": 29150.0, "swingIdx": 12, "confirmIdx": 18}],
  "events": [{"type": "BOS", "direction": "bullish", "level": 29150.0, "sourceSwingIdx": 12, "breakIdx": 20}],
  "finalState": 1
}
```

- `candles[].t` — open time, UTC **seconds** (not ms).
- `swings[]` — every confirmed swing in order; `type` is one of `H`/`HH`/`LH` (highs) or
  `L`/`HL`/`LL` (lows); `swingIdx`/`confirmIdx` are 0-based indexes into `candles`.
- `events[]` — every BOS/CHoCH in order; `direction` is `bullish`/`bearish`;
  `sourceSwingIdx`/`breakIdx` are 0-based indexes into `candles`.
- `finalState` — the engine's own `state` after the very last candle (`-2`/`-1`/`0`/`1`/`2`).

Prices are compared with 1e-9 relative tolerance; every other field must match exactly.
