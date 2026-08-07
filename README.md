# Politiko — Market Watch

A userscript for [Politiko](https://politiko.io) that records numeric series out of market
responses the game client already fetched, charts them in-page, and raises alerts when
something moves.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open [`market-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-market-watch/main/market-watch.user.js)
   and confirm the install prompt.

## What it does

- **Builds history.** The game shows you a number now; this keeps the series, so you can
  see where it came from.
- **Charts it in-page**, including sparklines beside the headline figures.
- **Alerts** on absolute thresholds, percentage moves, and rate-of-change — in-page only,
  and only while the tab is visible. Alerts raised while the tab is hidden are queued and
  shown when you come back.
- **Derived views** over the recorded history.

Everything is computed and stored locally in your browser.

## Buy and sell rules — what they actually do

A rule can carry a trade intent (*sell everything*, *buy $1000 worth*). **It will not place
the order.** Nothing in this script can, and there is no switch that changes that.

When such a rule fires you get an alert that has already done the arithmetic — sized against
your holdings as they stand that second, so a sell is capped at what you actually hold — and
a button. The button takes you to the stocks screen, selects the ticker, and fills in the
size. You place the trade, using the game's own controls.

That last hop is deliberate. Sizing a trade is arithmetic on data the game already sent you;
placing one is a request, and this script does not make requests.

## What it reads

Full disclosure — reads, storage, network, alerting — is in the header comment at the top
of [`market-watch.user.js`](market-watch.user.js). Read it before installing. In short: it
taps GET responses the app requested on its own, originates nothing, keeps everything in
local storage, and sends nothing anywhere.

## History

Versions up to 0.11.0 carried an order-execution seam: `registerExecutor()`, an arming
switch, a session cap, and a capture of the app's own write requests so the order shape
could be learned from a trade you placed by hand. Wiring it would have made this script
originate write requests, which Politiko's scripting clause prohibits under penalty of a
game ban. It shipped disabled and was never armed.

**As of 1.0.0 it is deleted** — the seam, the arming, the capture and the learned routes are
gone rather than switched off, and `tools/test-passive.js` fails the build if any of it
comes back.

## Tests

```bash
node tools/test-passive.js
node tools/test-harvest.js
node tools/test-sizing.js
node tools/test-views.js
```

`test-passive` is a fence around the one property this script now claims absolutely: it
reads the shipped file and fails if anything that could send a request has reappeared. The
disclosure block is a promise to whoever installs it, and "we removed it" stays true only
until someone adds it back.

The rest slice the relevant layer straight out of the shipped userscript rather than copying
it, so they cannot drift from the source.
