# Stocks surface

Measured **2026-07-28**, from an authenticated session, by reading responses the app
fetched on its own while the stock market page was open in front of the player.
Evidence: a passive tap and panel capture. No requests were
originated, no endpoint was probed, no page the player wasn't viewing was touched.

This closes the biggest gap in [`00-recon-baseline.md`](00-recon-baseline.md), which was
taken logged-out and enumerated **no stock market at all** — the Vite chunk list has no
`StockPage`/`MarketPage`/`ExchangePage`. The feature exists; it just isn't reachable from
a logged-out bundle.

## Measured

Series the tap derived, and therefore the payload's shape:

```
stocks/instruments/<SYMBOL> :: ask
                            :: bid
                            :: price
                            :: spread_bps
                            :: float_shares
                            :: ipo_game_day
stocks/holdings/<SYMBOL>    :: shares
                            :: avg_cost
                            :: current_price
                            :: market_value
                            :: unrealized_pnl
stocks/tax                  :: owed
```

**Every symbol appears under both `instruments` and `holdings`** — confirmed
2026-07-28 from the panel. The two sides carry different fields: `instruments` is
the market's view of the listing, `holdings` is the player's position in it. Note
that the holdings price field is `current_price`, not `price`.

- ~~**URL scope resolved to `stocks`.** The tap strips `/api/` and `public`, so the request
  path is `/api/stocks` or `/api/stocks/<numeric>`. The exact path was not captured.~~

  **Captured 2026-08-26**, off the bundles rather than the wire, which is cheaper and did
  not need a session. There is no `/api/stocks/<numeric>` — instruments are addressed under
  a sub-collection, and the read surface is wider than one session showed:

  ```
  GET  /api/stocks/instruments                       the watchlist (HTTP-polled, 2 s)
  GET  /api/stocks/instruments/{id}/quote            single instrument
  GET  /api/stocks/instruments/{id}/candles?tf=&n=150 OHLCV history
  GET  /api/stocks/instruments/{id}/events           per-instrument event feed
  GET  /api/stocks/holdings                          your positions
  GET  /api/stocks/trades?limit={}                   your trade history
  GET  /api/stocks/tax                               tax owed
  ```

  This confirms the inference in the bullet below it — `instruments` really is an object
  keyed by symbol under a `stocks/instruments/…` prefix — and it means the shape the
  sampler recovered from response *scopes* was right without the path ever being seen.
  Note `/candles` is the only place OHLC lives over HTTP, matching what
  [`09-socket-surface.md`](09-socket-surface.md) says about `candle_update`.
- **Symbols seen:** `PNRG`, `RCRD`, `SNTL`, `USTL`, `BRDL`, plus more above the panel's
  scroll position. 53 series were tracked in that session.
- **`instruments` is an object, not a top-level array.** The tap keeps a parent's scope
  when recursing into an array and only names a sub-scope for a nested *object* — the
  literal `stocks/instruments/…` prefix proves it was the latter.
- `float_shares`, `ipo_game_day` and `spread_bps` did not move across the observed
  window; `price`, `bid` and `ask` did.
- `ipo_game_day` read **1408** identically across every instrument.

## The chart, and where your own fills sit on it

Read **2026-09-07** off `StocksPage-DkzFUOgF.js` in the 2026-08-26 bundle set. Nothing
was fetched and no session was needed; this is the client telling us what it draws.

**The chart is TradingView Lightweight Charts v5**, rendering to a canvas. The v5 API
gives it away — `chart.addSeries(CandlestickSeries, …)`, not v4's `addCandlestickSeries`.
Three consequences, in descending order of how annoying they are:

- **Series markers are not available.** v5 moved them out of the series API and into a
  plugin, and the bundle has been tree-shaken: `createSeriesMarkers` and `setMarkers`
  appear nowhere in it. Anything that wants to mark a point on this chart has to draw
  its own layer.
- **The coordinate functions are all present**: `timeToCoordinate`, `priceToCoordinate`,
  `coordinateToTime`, `logicalToCoordinate`, `createPriceLine`, `barsInLogicalRange`, and
  both `subscribeVisible*RangeChange` pairs. So a layer *can* be glued to the chart
  properly rather than guessed at.
- **`series.data()` exists**, which means the bars actually on screen can be read back
  rather than inferred from the last response — the two differ whenever the socket has
  advanced the live bar.

The chart component is keyed `` `${symbol}-${timeframe}` ``, so changing either
**remounts it** and disposes the old chart object. It holds the chart and the series in
React refs and exposes neither, so reaching them means walking the fiber tree from the
container element (React 19.2.6; `__reactFiber$…` confirmed present in `index-*.js`).
The container carries the library's own `tv-lightweight-charts` class, which appears in
`StocksPage` **and nowhere else** — checked across both the 2026-08-10 and 2026-08-26
bundle sets.

### Timeframes and how much real time they cover

`Wi = ['4h', '1d', '1w']`, always `n=150`, and `bucket_secs` comes back on the response
(the client defaults to `86400` if it is missing). Buckets are **game** time, so at
acceleration 52.14 ([`06-time-surface.md`](06-time-surface.md)):

| tf | bucket | 150 bars = | ≈ real time |
|---|---|---|---|
| `4h` | 4 game hours | 25 game days | **11.5 hours** |
| `1d` | 1 game day | 150 game days | **2.9 days** |
| `1w` | 7 game days | 1050 game days ≈ 2.9 game years | **20 days** |

This is arithmetic on `n=150` × bucket, not a measurement — the server returns whatever
history it has, which is at most back to `ipo_game_day`. Worth noting because the widest
window is nearly three real weeks, not the one week it is easy to assume from the `1w`
label, and the *narrowest* is under half a real day.

### The trade record

`GET /api/stocks/trades?limit=25[&before=<cursor>]`, paged, `{ trades: [...],
next_cursor }`. It is behind the stocks page's **`history` tab**, which is not the
default (`positions` is) — so under consume-don't-request it is only observable after
the player has opened that tab.

```
trades[] :: id                one per fill; stable, usable as a dedupe key
         :: game_day          integer, absolute — rendered as "D<game_day>"
         :: symbol
         :: trade_type        buy | sell | short_open | short_cover
                              | margin_open | margin_close
                              | margin_liquidation | short_liquidation
         :: shares
         :: price_per_share
         :: total_cash
         :: realized_pnl      null on an opening trade
```

**`game_day * 86400` is a game-second in the chart's own x-axis space.** That is the
load-bearing claim and it is worth stating plainly, because nothing in either payload
says so:

- the chart's `bucket_start` is decoded by the client with `year = floor(s/31_536_000)+1`,
  i.e. it is absolute game-seconds from world origin;
- `ipo_game_day: 1408` decoded through that same calendar gives **Nov 14, Y4**, which is
  what this document already recorded from the other direction.

Two fields, two derivations, one date. It is not a wire capture, but it is as close as
the bundles get, and `userscripts/tools/test-market-chart.js` re-derives that date from
the userscript's own decoder so the two cannot drift apart silently.

The resolution mismatch that follows from it is worth writing down: a fill is dated to a
whole game day, so on `1w` and `1d` it lands on exactly one bar, but on `4h` a game day
is **six** bars and the honest mark is a band, not a line.

### Two corrections to what was inferred above

- **`holdings` is a list, not a symbol-keyed map.** `{ holdings: [...] }`, and the page
  matches rows with `L.find(h => h.instrument_id === D)`. Rows also carry
  `short_position_id` and `margin_position_id`, which is how the page tells a long from a
  short from a margin buy on the same instrument.
- **The candles and quote paths take the TICKER, not a numeric id.** In the client `E` is
  the symbol and `D` is the id, and it is `E` that goes into the URL:
  `` `/stocks/instruments/${E}/candles?tf=${i}&n=150` ``. So those responses are
  self-identifying, and nothing needs a symbol→id map to read them. Orders still go by
  `instrument_id` — see below — so both are real and they are not interchangeable.

### And the cash field this document said was missing

`GET /api/user/money`, fetched by StocksPage under the query key `sidebar-money`. Listed
here because "a cash / balance field" is named under *Still unknown* below as the thing
blocking spend-an-amount sizing. Not yet read on the wire, so its shape is still unknown
— only its existence and its path are established.

## The order endpoint

Captured **2026-07-28** from a buy the player placed by hand, via the userscript's
passive write tap. Not probed — this is the request the app itself sent.

```
POST /api/stocks/buy    { "instrument_id": 10, "shares": 92, "idempotency_key": "…" }
POST /api/stocks/sell   { "instrument_id": 10, "shares": 1,  "idempotency_key": "…" }
```

Both sides were captured from real trades. **The body shape is identical** — only the
path differs, so one executor covers both with the side selecting the route.

**There are four more, read off the bundles 2026-08-26 and never captured on the wire:**
`POST /api/stocks/short`, `POST /api/stocks/cover`, `POST /api/stocks/margin/close` and
`POST /api/stocks/tax/pay`. Bodies unknown — they are listed for completeness of the
surface, not as anything to build on, and nothing in this repo places an order anyway
(the execution seam was deleted 2026-08-07; see
[`01-rules-envelope.md`](01-rules-envelope.md)). Their existence does say the game has
**short selling and margin**, which no doc here had recorded.

Three things follow from this:

- **Orders are addressed by `instrument_id`, not by ticker.** Nothing in the price
  series carries it — the sampler uses `symbol` as the identity and skips `*_id`
  fields — so the symbol→id mapping has to be captured separately, which the script
  now does at harvest time.
- **The id must be the *instrument's*.** A holdings record plausibly carries its own
  id in a different space, and sending that would trade the wrong stock. The script
  records provenance and refuses to place an order on an id it isn't sure about.
- **`idempotency_key` is `<epoch_ms>-<11 chars base36>`**, generated per attempt.

`sell` was guessable from `buy`, and was deliberately left unwired until a real sell
was seen anyway — the guess turning out correct doesn't make guessing the method.
Route learning stays live regardless, since paths move between deploys: a route
observed on the wire overrides the baked-in default.

Auth was not captured and is not replayed: requests go out with same-origin
credentials, so a cookie session carries itself. If it turns out to be header-based
the executor returns 401 and says so rather than reading the token.

## Inferred

- Roughly 8–9 listed instruments (53 series ≈ 6 fields each, plus the tax record and
  whatever sits above the scroll). Not counted directly.
- The per-symbol records are either a map keyed by symbol (`{instruments: {PNRG: {…}}}`)
  or a list nested one level down (`{instruments: {list: [{symbol: "PNRG", …}]}}`). Both
  produce the observed series names; the tap can't distinguish them. Reading one raw
  response body in DevTools settles it.
- A shared `ipo_game_day` across all instruments suggests the market was seeded in one
  batch at world start rather than growing by individual IPOs.
  *Refined 2026-08-03:* the batch part holds, the world-start part doesn't — decoding
  1408 through the game calendar ([`06-time-surface.md`](06-time-surface.md)) puts the
  IPO at Nov 14, Y4 ≈ real 2026-07-08, about four weeks after world start.
- `spread_bps` being static per instrument implies the spread is a fixed per-listing
  parameter, not a live function of order flow — so `bid`/`ask` are probably derived from
  `price` ± half the spread rather than being a real book.

## Still unknown

- The exact request path, and whether the page polls it or pushes over the WebSocket.
- **Whether `instrument_id` and a holding's `id` share a space.** Assumed not, and the
  script refuses to place orders on an unconfirmed id rather than find out the
  expensive way.
- **What the order response returns**, and whether a rejected order (insufficient
  funds, insufficient shares, market closed) comes back as a non-2xx or as a 200 with
  an error body. Only the request side has been captured; the executor currently
  treats any 2xx as filled.
- ~~A **cash / balance field**. Nothing matching one has appeared on any response the
  tap has seen, which is what currently blocks spend-an-amount position sizing. It may
  live on a player/account response rather than the stocks one.~~

  **Located 2026-09-07**, and the guess was right — it is on an account response, not a
  stocks one: `GET /api/user/money`. Its shape has still not been read, so sizing is
  unblocked in principle and not in practice.
- ~~Whether `holdings` arrives on the same response as `instruments` or a separate one —
  both are under the `stocks` scope, so the tap can't tell them apart.~~
  **Separate**, and separately fetched: `stocks-instruments` polls every 2 s,
  `stocks-holdings` does not poll at all.
- **Whether `game_day` on a trade is really the absolute day.** Everything above rests on
  it and the evidence is two independent derivations agreeing on one date, which is
  strong but is not a capture. The cheap confirmation costs nothing and needs no request:
  open the History tab next to a chart and check that a fill's `D<n>` falls inside the
  `D<from> – D<to>` the chart covers. `market-watch` prints both for exactly this reason,
  and refuses to draw a mark for a fill dated later than the newest bar rather than put
  one somewhere it cannot defend.
