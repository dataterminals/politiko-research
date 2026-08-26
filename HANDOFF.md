# Handoff — 2026-08-07

Supersedes the 2026-07-28 scaffolding handoff. That one described a repo with nothing built
in it; this one describes seven shipped userscripts, a PWA, and a posture that went out and
came back.

## Where this stands

**Everything is passive again.** Two exceptions were taken on 2026-07-28 — a profile crawler
in people-watch and an order-execution seam in market-watch — and both were **deleted on
2026-08-07**, not disabled. Nothing in or around this repo originates a request to
politiko.io.

The reason is worth carrying forward, because it retired both: what the automation was
buying was *tedium relief, not reach*. A keypress bought the same thing. people-watch got a
next/previous walk along the roster; market-watch got an alert that sizes the trade and
hands you a shortcut to the stocks screen. `CLAUDE.md` hard rule 2 says this, and says to
reach for that shape first.

## Read these first

1. [`CLAUDE.md`](CLAUDE.md) — hard conduct rules. Not boilerplate; the penalties are real.
2. [`docs/01-rules-envelope.md`](docs/01-rules-envelope.md) — the scripting clause decoded,
   plus the record of the two exceptions and their retirement.
3. [`docs/00-recon-baseline.md`](docs/00-recon-baseline.md) — the stack, logged out.
4. Whichever `docs/0N-*-surface.md` covers what you are about to touch.

## The tools

**Every userscript ships from this repo, out of `userscripts/`.** people-watch and
market-watch used to have their own repositories and were folded back in on 2026-08-09;
if you find a reference to `politiko-people-watch` or `politiko-market-watch` anywhere,
it is stale.

| tool | version | |
|---|---|---|
| people-watch | 1.2.1 | |
| market-watch | 1.0.1 | |
| time-watch | 0.4.0 | |
| align-watch | 0.2.0 | |
| comms-move | 0.1.0 | |
| time-bridge | 0.1.0 | |
| ws-watch | 0.2.0 | *temporary instrument* |
| Time Wire (PWA) | — | ships from `PolitikoTimeWire` |

Install links and per-tool docs: [`userscripts/README.md`](userscripts/README.md).

**The one thing that will still trip you up:** `politiko-time-watch` looks like time-watch's
home and is not. It is a **frozen v0.1.0 snapshot** — its README says so and its `@updateURL`
deliberately points at the copy here, so an old install migrates itself. Don't edit the
script there.

Every script declares `@updateURL`/`@downloadURL`, so **shipping a fix means bumping
`@version`** — a manager only acts on an increase.

## What this session did

- **align-watch** (new) — your political compass on the home page. Alignment is served by
  exactly one endpoint and the home page never calls it, so the panel mirrors your last
  profile read, says how old it is, and projects pending actions as a bounded range.
- **comms-move** (new) — a drag bar on the game's Comms dock. No network code at all.
- **time-bridge** (new) — carries the clock anchor from the game to the Time Wire planner
  across origins, so the planner self-calibrates.
- **people-watch 1.2.0** — crawler deleted; roster walk (`[` / `]`); triangle button whose
  hit area is the triangle; clickable names; sortable columns + reverse; "active now";
  social-action counts; faction/corp grouping.
- **market-watch 1.0.0** — execution seam deleted; buy/sell rules now produce a sized alert
  with a jump to the stocks screen.
- **Time Wire** — auto-calibration from a link or the bridge, plus an anchor-age chip.
- **docs** — [`07-alignment-surface.md`](docs/07-alignment-surface.md),
  [`08-sleeper-surface.md`](docs/08-sleeper-surface.md), and a drift note in
  [`05-people-surface.md`](docs/05-people-surface.md).

## Conventions that will bite you

- **Every panel is draggable and resizable, and remembers both.** Copy `PANEL KIT v2` from
  [`userscripts/_template.user.js`](userscripts/_template.user.js) verbatim; if it changes,
  bump the version in every copy. `fit()` must run after any render that changes the size —
  a drag handle off-screen is unrecoverable — which is why `resizable()` takes the panel's
  `draggable()` and re-fits after every resize. The kit pins a panel to left/top before the
  grab: the browser's grabber only grows a box down and right, so a panel still on its CSS
  `right`/`bottom` corner grows away from the pointer. That bug shipped in xp-watch for six
  versions before v2 fixed it in the shared block.
- **`@grant none` is load-bearing** in every tool that taps `fetch`. Any other grant
  sandboxes `window`, the wrap lands on the sandbox, and the tap silently sees nothing.
  time-bridge is the exception *because* it taps nothing — which is exactly why the reading
  and the handover are separate files.
- **Never match a generated CSS class.** Chunk hashes and utility classes change every
  deploy. The game's authored classes (`ch-*` on the Comms dock, `prof-*` on profiles) are
  stable and safe; matching on visible text is safer still.
- **`git commit -F <file>`**, not `-m` — PowerShell mangles quoted `-m`.
- **Time Wire**: run `node scripts/stamp-sw.mjs` after touching the shell, or installed PWAs
  keep serving the cached version.
- **Tests slice their layer out of the shipped file** rather than copying it, so they cannot
  drift. `userscripts/tools/test-market-passive.js` is a fence: it fails if anything that
  could send a request reappears. `test-passive.js` is the same idea for ws-watch — the two
  are unrelated, which is why market-watch's was renamed when it moved in.

## How things get verified (nothing touches the live game)

Everything this session was verified against a **local harness**: a throwaway static server
in the scratchpad serving fake-payload HTML pages that load the real userscript, driven in
the Browser pane. The bundles in `artifacts/` answer "what does the client do"; the harness
answers "does our code do the right thing with it".

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

Add a temporary `userscript-harness` entry to `.claude/launch.json` for the server, and put
the file back afterwards.

## Open threads, most valuable first

1. ~~**`wss://politiko.io` is still completely uncharacterized.**~~ **Done 2026-08-07** —
   [`docs/09-socket-surface.md`](docs/09-socket-surface.md), read entirely off the
   2026-08-03 bundles with zero game contact. Two sockets, not one: `/ws/chat` (every
   authenticated route) and `/ws/market` (only on `/stocks`). **`/ws/chat` carries
   presence**, so the people-watch unlock exists and is inside the clause.
   The read-only tap is **built and verified**: `WS TAP v1` in
   [`_template.user.js`](userscripts/_template.user.js), shipped in
   [`ws-watch`](userscripts/ws-watch.user.js) 0.1.0 behind
   [`tools/test-passive.js`](userscripts/tools/test-passive.js).
   **What is left is running it.** ws-watch is a *temporary instrument*, not a feature —
   see the next item.
2. ~~**Run ws-watch, then delete it.**~~ **Run 2026-08-07** — 125 frames, 8 connections,
   ~20 min, folded into [`docs/09`](docs/09-socket-surface.md).

   **Solidly measured:** `market/subscribed` ×14 and `market/unsubscribed` ×11 exist and
   are silently discarded — 25 frames no bundle read could have revealed, and the concrete
   vindication of building the tap. `quote` carries a `game_time` the client never reads.
   `presence` carries exactly `username` + `online`, including your own.

   **Two things the first write-up got wrong, both now corrected in the docs.** An
   adversarial re-derivation caught them; read
   [`docs/09` → Limits of the instrument](docs/09-socket-surface.md) before trusting any
   further ws-watch output.
   - **"Presence is SEEDED" is not established.** The detector cannot tell a server seed
     from clustered transitions, and the panel's own "reload a few times" instruction is
     what produces clusters. It measured what it told the operator to do.
   - **`quote.game_time` is a *worse* clock than `/api/time`, not better.** Session-wide
     the poll supplies ~4× the anchors, quotes are event-driven rather than periodic, and
     the market socket only exists on `/stocks`. `docs/06` carries the corrected numbers.

   **ws-watch 0.2.0 (2026-08-08) closes the instrument's own gaps.** A closed four-field
   value allowlist, a seeding test based on true/false composition rather than burst size,
   a per-type inter-arrival histogram, person-scrubbed unknown samples, and a `game_time`
   rate check against the ~52.14 in `docs/06`. The reload instruction is gone — it was
   manufacturing the clusters the old detector looked for. 136 assertions.

   **What it needs from the operator:** ordinary play with at least two chat connects (no
   deliberate reloading — that was the confound), one stint on the stocks screen with two
   quotes 30 s apart, and, for the last bonus question, a DM to a nonexistent username to
   provoke an `error` frame.

3. **Does a sanctioned player API exist?** Phase 0, still unanswered, still branches the
   whole project.
3. **Sleeper unknowns** ([`docs/08`](docs/08-sleeper-surface.md)) — what converts a lead,
   what sets `effectiveness`, and whether meeting a lead requires being at its site. One
   cheap test: the issue selector is global while `issue` is per-lead, so one setting cannot
   be right for a mixed list of leads.
4. **Alignment unknowns** ([`docs/07`](docs/07-alignment-surface.md)) — the magnitude of a
   `left`/`right` action, and whether graffiti counts at all.
5. **`/api/users/{name}/stats` and `/holdings` have never been captured.** ProfilePage fetches
   both; people-watch's tap ignores them. They may carry more than the profile does.
6. **`docs/05` has drifted twice.** Re-read the client before trusting any endpoint list in
   this repo as current.

## Traps worth knowing (still true)

- **The landing page lies.** Its wire log, conflict map and stat blocks are hardcoded demo
  content. Only `/api/public/*` is real.
- **Every path returns 200.** The SPA catch-all serves `index.html` for anything; only
  `/api/*` gives honest 404s, in Go's `text/plain` default.
- **No test account is possible.** Multi-accounting is aggressively enforced. All
  authenticated work happens on the one real account, at real risk.
- **Claude must not play.** The account-sharing rule covers "having someone initiate
  processes on your behalf". Inspect an already-open, human-driven page; don't drive it.
- Some players have deliberately offensive usernames. They are rows in a table.

## Suggested opening prompt

> Read CLAUDE.md and HANDOFF.md in H:\Github Repositories\politiko-research, plus whichever
> docs/0N-*-surface.md covers what we're touching. Everything is passive — nothing
> originates requests — and I'd like to keep it that way. \<what you want\>
