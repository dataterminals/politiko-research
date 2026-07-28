# Stocks surface

Measured **2026-07-28**, from an authenticated session, by reading responses the app
fetched on its own while the stock market page was open in front of the player.
Evidence: the `market-watch` userscript's passive tap, panel capture. No requests were
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

- **URL scope resolved to `stocks`.** The tap strips `/api/` and `public`, so the request
  path is `/api/stocks` or `/api/stocks/<numeric>`. The exact path was not captured.
- **Symbols seen:** `PNRG`, `RCRD`, `SNTL`, `USTL`, `BRDL`, plus more above the panel's
  scroll position. 53 series were tracked in that session.
- **`instruments` is an object, not a top-level array.** The tap keeps a parent's scope
  when recursing into an array and only names a sub-scope for a nested *object* — the
  literal `stocks/instruments/…` prefix proves it was the latter.
- `float_shares`, `ipo_game_day` and `spread_bps` did not move across the observed
  window; `price`, `bid` and `ask` did.
- `ipo_game_day` read **1408** identically across every instrument.

## Inferred

- Roughly 8–9 listed instruments (53 series ≈ 6 fields each, plus the tax record and
  whatever sits above the scroll). Not counted directly.
- The per-symbol records are either a map keyed by symbol (`{instruments: {PNRG: {…}}}`)
  or a list nested one level down (`{instruments: {list: [{symbol: "PNRG", …}]}}`). Both
  produce the observed series names; the tap can't distinguish them. Reading one raw
  response body in DevTools settles it.
- A shared `ipo_game_day` across all instruments suggests the market was seeded in one
  batch at world start rather than growing by individual IPOs.
- `spread_bps` being static per instrument implies the spread is a fixed per-listing
  parameter, not a live function of order flow — so `bid`/`ask` are probably derived from
  `price` ± half the spread rather than being a real book.

## Still unknown

- The exact request path, and whether the page polls it or pushes over the WebSocket.
- **The order-placement endpoint, its payload, and the session auth scheme.** All three
  are required before `registerExecutor()` in
  [`../userscripts/market-watch.user.js`](../userscripts/market-watch.user.js) can be
  filled in. Hard rule 4 stands: these get answered by observing a real order placed by
  hand in DevTools, not by probing.
- A **cash / balance field**. Nothing matching one has appeared on any response the
  tap has seen, which is what currently blocks spend-an-amount position sizing. It may
  live on a player/account response rather than the stocks one.
- Whether `holdings` arrives on the same response as `instruments` or a separate one —
  both are under the `stocks` scope, so the tap can't tell them apart.
