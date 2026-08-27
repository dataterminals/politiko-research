# Handoff — 2026-08-26

Supersedes the 2026-08-07 handoff, which described seven tools and is now behind by six
more, two shared kits and a socket. Its posture section was still right, and is kept below.

## Where this stands

**Everything is passive.** Nothing in or around this repo originates a request to
politiko.io. Two exceptions were taken on 2026-07-28 — a profile crawler in people-watch and
an order-execution seam in market-watch — and both were **deleted on 2026-08-07**, not
disabled.

The reason is worth carrying forward, because it retired both: what the automation was
buying was *tedium relief, not reach*. A keypress bought the same thing. people-watch got a
next/previous walk along the roster; market-watch got an alert that sizes the trade and
hands you a shortcut to the stocks screen. `CLAUDE.md` hard rule 2 says this, and says to
reach for that shape first.

**The game agrees with that, as of 2026-08-26.** It shipped
`PUT /api/jail/legal-offers/auto-accept` — an auto-accept switch, server-side, for exactly
the sort of tedium a script would be tempted to automate. When something looks automatable,
ask first whether the game has, or would add, a switch for it. That is the cheapest unlock
there is and it carries no ban risk at all.

## Read these first

1. [`CLAUDE.md`](CLAUDE.md) — hard conduct rules. Not boilerplate; the penalties are real.
2. [`docs/01-rules-envelope.md`](docs/01-rules-envelope.md) — the scripting clause decoded,
   the record of the two exceptions and their retirement, and how multi-accounting is
   actually enforced (fingerprint headers on every request — don't go near them).
3. [`docs/00-recon-baseline.md`](docs/00-recon-baseline.md) — the stack, logged out, plus
   the 2026-08-26 re-read at the end.
4. Whichever `docs/0N-*-surface.md` covers what you are about to touch.

## The tools

**Every userscript ships from this repo, out of `userscripts/`.** people-watch and
market-watch used to have their own repositories and were folded back in on 2026-08-09;
if you find a reference to `politiko-people-watch` or `politiko-market-watch` anywhere,
it is stale.

| tool | version | |
|---|---|---|
| people-watch | 1.6.0 | |
| market-watch | 1.1.0 | |
| time-watch | 0.6.0 | |
| align-watch | 0.4.1 | |
| xp-watch | 0.4.0 | |
| raid-watch | 0.3.0 | |
| sleeper-watch | 0.3.1 | |
| quick-jump | 0.3.0 | |
| world-watch | 0.2.1 | |
| gov-watch | 0.1.0 | |
| comms-move | 0.1.1 | |
| time-bridge | 0.1.0 | |
| ws-watch | 0.5.0 | *temporary instrument* |
| Time Wire (PWA) | — | ships from `PolitikoTimeWire` |

**This table goes stale faster than anything else in the repo — it did exactly that between
2026-08-07 and 2026-08-26, drifting six tools and every version number.**
[`userscripts/README.md`](userscripts/README.md) carries the same table next to the install
links and is the one that gets updated. If the two disagree, believe the README, then fix
this one.

**The one thing that will still trip you up:** `politiko-time-watch` looks like time-watch's
home and is not. It is a **frozen v0.1.0 snapshot** — its README says so and its `@updateURL`
deliberately points at the copy here, so an old install migrates itself. Don't edit the
script there.

Every script declares `@updateURL`/`@downloadURL`, so **shipping a fix means bumping
`@version`** — a manager only acts on an increase.

## The shared blocks

Three of them, all copied verbatim rather than imported, so every tool stays one auditable
file. Same rule for all three: **copy as-is; if you must change it, bump its version in
every copy so the copies can be diffed.**

| block | version | where |
|---|---|---|
| `PANEL KIT` | v2 | every tool that draws a window |
| `FAB KIT` | v3 | every tool with a toggle button |
| `WS TAP` | v2 | `_template`, `ws-watch` |

`tools/test-placement.js` hashes the FAB KIT copies, so a tool that quietly forks the button
fails the build. It also names the two deliberate exceptions — market-watch's own corner
grips, and comms-move resizing nothing.

**`FAB KIT` went to v3 on 2026-08-26.** v3 takes the last thing a tool still chose about its
button — where it starts — and puts all eleven in one row across the band above the game's
header rule, one `--pk-slot` each. A tool's own rule may no longer carry an inset, and the
two tools that place their own button (market-watch, people-watch) carry the same row in JS
because an inline `left/top` outranks any rule; the test reads the CSS and both JS copies and
fails on a drift. Six buttons had no double-click-to-home at all before this, which is the
only way back into the row once a button has been dragged — they all have it now.

**`WS TAP` went to v2 on 2026-08-26** and the reason generalizes: see the next section.

## What the 2026-08-26 session did

A staleness sweep — fresh bundle pull, diffed against the 2026-08-10 set, every doc claim
and every tool's tapped endpoints checked against it. Zero game contact beyond the static
asset fetch.

**The find: there is a third socket, and it authenticates differently.**
`/ws/casino/poker`, opened by the poker page, was already in the 2026-08-10 bundles — new to
us, not to the game. Five places in the repo said "two sockets".

The count was the smaller half. **Its access token is not in the URL** — it rides in the
WebSocket subprotocol argument, `['politiko-poker', 'auth.<token>']`. Every safety rule this
repo had written about socket taps was phrased as "redact the query string", which was a
complete-sounding rule that was complete only for the two sockets we knew about. A tap
author following it in good faith who logged `protocols` for debugging would have written an
access token to `localStorage`.

`WS TAP v2` fixes it the way that generalizes: **`protocols` is forwarded to the base
constructor and never read**, so there is no code path to audit, and a fourth socket
inventing a fourth hiding place would still be handled correctly on the day it ships.
`tools/test-passive.js` fences both halves — that a sentinel token in `protocols` reaches no
subscriber, *and* that it was still passed through intact, because a tap that dropped it
would silently break the game's poker table.

ws-watch was already safe by construction (it never touched the argument) but its disclosure
said "the two WebSockets", which under clause 6 is the kind of inaccuracy that matters.

**Also corrected:** the socket count in [`docs/01`](docs/01-rules-envelope.md) and
[`docs/09`](docs/09-socket-surface.md); [`docs/05`](docs/05-people-surface.md)'s dead
`/api/user/{name}` rows, which [`docs/07`](docs/07-alignment-surface.md) had caught on
2026-08-07 but recorded *there* rather than in the list people read;
[`docs/04`](docs/04-stocks-surface.md)'s unresolved stocks path, now measured; and
[`docs/00`](docs/00-recon-baseline.md), which gained the build delta and a pointer to
[`docs/12`](docs/12-navigation-surface.md) for the route table it can no longer supply.

**What the sweep found still true**, which is the more useful half: the rules text is
byte-identical between builds, so the whole envelope stands; the route table is exactly as
docs/12 recorded it; the `ch-*` and `prof-*` authored classes are unchanged; and every
endpoint all 13 tools tap still exists.

## Conventions that will bite you

- **Every panel is draggable and resizable, and remembers both.** Copy `PANEL KIT v2` from
  [`userscripts/_template.user.js`](userscripts/_template.user.js) verbatim. `fit()` must run
  after any render that changes the size — a drag handle off-screen is unrecoverable — which
  is why `resizable()` takes the panel's `draggable()` and re-fits after every resize. The
  kit pins a panel to left/top before the grab: the browser's grabber only grows a box down
  and right, so a panel still on its CSS `right`/`bottom` corner grows away from the pointer.
  That bug shipped in xp-watch for six versions before v2 fixed it in the shared block.
- **Every toggle button is the same button** — `FAB KIT v2`, one 38 px square, a three- or
  four-letter word, no emoji. Install four tools and four of these land on one screen, so the
  box is not the tool's to pick. people-watch's eye is grandfathered and is named as an
  exception in the test. v2 also fills the button while its own panel is open
  (`classList.toggle('pk-open', ui.open)`, above the paint function's early return). The kit
  claims the fill and nothing else, so a tool's state colour still reads through it.
- **`@grant none` is load-bearing** in every tool that taps `fetch`. Any other grant
  sandboxes `window`, the wrap lands on the sandbox, and the tap silently sees nothing.
  time-bridge is the exception *because* it taps nothing — which is exactly why the reading
  and the handover are separate files.
- **Never match a generated CSS class.** Chunk hashes and utility classes change every
  deploy. The game's authored classes (`ch-*` on the Comms dock, `prof-*` on profiles) are
  stable — verified unchanged again on 2026-08-26 — and matching on visible text is safer
  still.
- **A route is not its endpoint.** `/api/actions/poll` is served at `/actions/opinion-poll`.
  A link derived from an endpoint fails silently: the navigation succeeds and the router
  matches nothing. world-watch 0.2.1 shipped that bug; see [`docs/12`](docs/12-navigation-surface.md).
- **`git commit -F <file>`**, not `-m` — PowerShell mangles quoted `-m`.
- **Time Wire**: run `node scripts/stamp-sw.mjs` after touching the shell, or installed PWAs
  keep serving the cached version.
- **Tests slice their layer out of the shipped file** rather than copying it, so they cannot
  drift. `test-market-passive.js` is a fence: it fails if anything that could send a request
  reappears. `test-passive.js` is the same idea for ws-watch — the two are unrelated, which
  is why market-watch's was renamed when it moved in.
- **The `super(` fence counts occurrences in the whole file, comments included.** Writing
  `super()` in a prose comment fails the build. Say "the base constructor" instead. This
  costs ten minutes if you don't know it.

## Reading the bundles without fooling yourself

`tools/fetch-bundles.ps1`, run **by hand**, one shot, never scheduled. Then:

- **Normalize before diffing.** 122 of 137 chunks changed hash between 2026-08-10 and
  2026-08-26 and only **12 files actually differed** — a hash cascades into every chunk that
  imports a changed one. Strip `-<8 char hash>` out of asset references inside the file
  contents, then compare.
- **A missing call site is not a deleted endpoint.** `/api/actions/donations` looked deleted;
  the page had been refactored so the path lives in a config object read as
  `.get(n.endpoint)`. Grep for the path string before believing a disappearance.
- **API paths don't regex out of the entry chunk.** They are rooted (`/users/{id}`) and
  passed to a helper that prepends `https://politiko.io/api`. Grep call sites — `.get(\`/…\`)`
  and friends — not `/api/`.
- **Routes are backtick template literals.** ``grep 'path:`'``. A naive `grep '"/casino'`
  finds nothing and misses the entire casino tree; that happened once already.

## How things get verified (nothing touches the live game)

`userscripts/tools/harness/` is a browser bench that renders a panel against canned payloads
with `fetch`/`WebSocket`/`XHR` stubbed out, so no panel work needs the live game. The bundles
in `artifacts/` answer "what does the client do"; the harness answers "does our code do the
right thing with it".

Four things cost real time and will again:

- **`document.hidden` is `true` in the Browser pane.** Every tool here correctly refuses to
  render or alert while hidden, so nothing appears and it looks broken. Override
  `Document.prototype.hidden` / `visibilityState` in the test.
- **A `history.pushState` kills the eval context** — the tool reports "target navigated" and
  the results are lost. Stub `pushState` to a recorder when testing navigation.
- **Panel open/closed state persists**, so `fab.click()` may *close* the panel and every
  subsequent read is a stale DOM. Assert the state, don't assume it.
- **Synthetic clicks don't behave like real ones** — a ctrl+click dispatched by script
  navigates the current tab instead of opening a new one. Block navigation during tests
  rather than trusting modifier behaviour.

`.claude/launch.json` has a `panel-harness` entry for the bench.

## Open threads, most valuable first

1. **Does a sanctioned player API exist?** Phase 0, still unanswered, still branches the
   whole project. **The 2026-08-26 sweep found no sign of one in the client** — no api-key,
   rate-limit or developer-token string anywhere, only a "Developer News" feed.

   **But the way to ask got better.** `/contact` became a threaded support desk with staff
   replies and a record you can cite later. Ask three things at once: whether a documented
   player API exists, whether the internal `/api/*` counts as "our API" for the clause, and
   what their stance is on distributing tools to other players. One answer would close more
   of [`docs/01`](docs/01-rules-envelope.md) than anything else available. This is an
   operator action — a human loads the page and writes the ticket.
2. **Run ws-watch again, or retire it.** It has been at "needs ordinary play" since
   2026-08-07: at least two chat connects (no deliberate reloading — that was the confound),
   one stint on the stocks screen with two quotes 30 s apart, and a DM to a nonexistent
   username to provoke an `error` frame. It is a *temporary instrument*; the intent was
   always to delete it once it stops learning, and it now reports its own retirement.
   `/ws/casino/poker` frames have never been observed by anything — but see the verdict in
   [`docs/09`](docs/09-socket-surface.md): that socket is the one with money on its outbound
   half and nothing should be built on it.
3. **Sleeper unknowns** ([`docs/08`](docs/08-sleeper-surface.md)) — what converts a lead,
   what sets `effectiveness`, and whether meeting a lead requires being at its site. One
   cheap test: the issue selector is global while `issue` is per-lead, so one setting cannot
   be right for a mixed list of leads.
4. **Alignment unknowns** ([`docs/07`](docs/07-alignment-surface.md)) — the magnitude of a
   `left`/`right` action, and whether graffiti counts at all.
5. **`/api/users/{name}/stats` and `/holdings` have never been captured.** ProfilePage
   fetches both; people-watch's tap ignores them. Both still exist as of 2026-08-26.
6. **Three surfaces the docs have never covered**, all confirmed present 2026-08-26: the
   casino tree beyond poker, the forum/wiki trees, and short selling and margin
   (`/api/stocks/{short,cover,margin/close}` exist and no doc mentions them).

## Traps worth knowing (still true)

- **The landing page lies.** Its wire log, conflict map and stat blocks are hardcoded demo
  content. Only `/api/public/*` is real.
- **Every path returns 200.** The SPA catch-all serves `index.html` for anything; only
  `/api/*` gives honest 404s, in Go's `text/plain` default.
- **No test account is possible.** Multi-accounting is aggressively enforced, and
  [`docs/01`](docs/01-rules-envelope.md) now records *how* — a canvas fingerprint and four
  other `X-CT-*` headers on every single API call. All authenticated work happens on the one
  real account, at real risk. Never touch those headers.
- **Claude must not play.** The account-sharing rule covers "having someone initiate
  processes on your behalf". Inspect an already-open, human-driven page; don't drive it.
- Some players have deliberately offensive usernames. They are rows in a table.

## Suggested opening prompt

> Read CLAUDE.md and HANDOFF.md in D:\Github Repositories\politiko-research, plus whichever
> docs/0N-*-surface.md covers what we're touching. Everything is passive — nothing
> originates requests — and I'd like to keep it that way. \<what you want\>
