# Install links

Paste-ready list of every installable tool in this directory. **Generated** — run
`node userscripts/tools/make-install-list.js` after any version bump or new tool
rather than editing this file, and push before you post: these are
`raw.githubusercontent.com` links, so they serve whatever is on `origin/main`.

Tools are listed in the order their buttons sit on screen, left to right.

## How to install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Click a raw link below and confirm the install prompt.
3. Reload politiko.io. Buttons land in one row above the header rule; drag any of
   them anywhere, double-click one to send it home.

Each script declares `@updateURL`, so fixes arrive on your script manager's own
update check — no reinstall.

> [!WARNING]
> Held out of the paste blocks below — these links do not serve current code yet:
> - **People Watch 1.10.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Align Watch 0.6.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Gov Watch 0.3.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Quick Jump 0.6.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Market Watch 1.4.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Raid Watch 0.6.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Sleeper Watch 0.6.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **WS Watch 0.7.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Time Watch 0.8.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **World Watch 0.4.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **XP Watch 0.6.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Poll Watch 0.3.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Shop Watch 0.2.0** — local file differs from `origin/main`; the raw link serves the older version.
> - **Bar Watch 0.1.0** — committed locally but not on `origin/main`; the raw link 404s.
>
> Push, re-run the generator, then post.

## Discord paste

Discord's message limit is 2000 characters, so this is split into one message. Copy each block and post it.

**Message 1 of 1** — 691 characters

```
## Politiko userscripts — install links

**Comms Move** · adds a drag bar to the game's Comms dock so you can move it
<https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/comms-move.user.js>

**Time Bridge** · hands Time Watch's clock anchor to the Time Wire planner
<https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-bridge.user.js>

Install Tampermonkey first, then click a link and confirm the prompt. Every one of these is passive: it reads what the game already sent your browser and originates no requests of its own. Source for all of them: <https://github.com/dataterminals/politiko-research/tree/main/userscripts>
```

## Full list

| slot | button | tool | version | what it does | raw link |
|---|---|---|---|---|---|
| 0 | (eye) | People Watch | 1.10.0 | who you've seen: last-online, city, rank, least-active first | [`people-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/people-watch.user.js) |
| 1 | `ALGN` | Align Watch | 0.6.0 | your political compass on the home page, with a change log | [`align-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/align-watch.user.js) |
| 2 | `GOV` | Gov Watch | 0.3.0 | change ledger for the government: what moved between readings | [`gov-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/gov-watch.user.js) |
| 3 | `JUMP` | Quick Jump | 0.6.0 | launcher for the 64 screens the sidebar can't reach | [`quick-jump.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/quick-jump.user.js) |
| 4 | `MKT` | Market Watch | 1.4.0 | charts market series locally and fires threshold alerts | [`market-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/market-watch.user.js) |
| 5 | `RAID` | Raid Watch | 0.6.0 | records faction raids, their event log and post-mortems | [`raid-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/raid-watch.user.js) |
| 6 | `SLP` | Sleeper Watch | 0.6.0 | keeps sleeper-recruitment timers running after you leave | [`sleeper-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/sleeper-watch.user.js) |
| 7 | `SOCK` | WS Watch | 0.7.0 | read-only observer for the three sockets the game opens | [`ws-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/ws-watch.user.js) |
| 8 | `TIME` | Time Watch | 0.8.0 | real to game clock, month schedule, next-September countdown | [`time-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-watch.user.js) |
| 9 | `WRLD` | World Watch | 0.4.0 | plots law, opinion, street, media and citizens on one compass | [`world-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/world-watch.user.js) |
| 10 | `XP` | XP Watch | 0.6.0 | ledger of your own stat and skill changes, action by action | [`xp-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/xp-watch.user.js) |
| 11 | `POLL` | Poll Watch | 0.3.0 | keeps every opinion-poll memo, with bloc spread and trends | [`poll-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/poll-watch.user.js) |
| 12 | `SHOP` | Shop Watch | 0.2.0 | shop fields the UI never shows, and brackets every restock | [`shop-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/shop-watch.user.js) |
| 13 | `BARS` | Bar Watch | 0.1.0 | time to full for Energy, Juice and HP, with alerts you set | [`bar-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/bar-watch.user.js) |
| — | — | Comms Move | 0.1.1 | adds a drag bar to the game's Comms dock so you can move it | [`comms-move.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/comms-move.user.js) |
| — | — | Time Bridge | 0.1.0 | hands Time Watch's clock anchor to the Time Wire planner | [`time-bridge.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-bridge.user.js) |

`_template.user.js` is not installable — it is the skeleton the others were built
from, and the home of the shared `PANEL KIT` and `FAB KIT` blocks.

Slots are fixed rather than packed: a tool you do not have leaves its slot empty, and
installing a new one never shuffles the buttons you already know by position.
