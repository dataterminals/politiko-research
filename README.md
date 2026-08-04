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

## Order execution

`registerExecutor()` is an attachment point for automatic order placement. It is **empty**,
and `AUTO_EXECUTE` is **false** — as shipped, this script places no orders and originates
no writes.

Registering an executor changes that, and changes what the script is. The disclosure block
at the top of the file explains what that means and must be rewritten before such a build
is shared with anyone.

## What it reads

Full disclosure — reads, storage, network, alerting — is in the header comment at the top
of [`market-watch.user.js`](market-watch.user.js). Read it before installing. In short: it
taps responses the app requested on its own, adds no requests in the shipped configuration,
keeps everything in local storage, and sends nothing anywhere.

## Tests

```bash
node tools/test-capture.js
node tools/test-harvest.js
node tools/test-orders.js
node tools/test-sizing.js
node tools/test-views.js
```

Each slices the relevant layer straight out of the shipped userscript rather than copying
it, so the tests cannot drift from the source.
