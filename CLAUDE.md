# politiko-research — working rules

Research repo for browser-runtime tooling (userscripts) for **Politiko**
(<https://politiko.io>), a live browser/PWA political-crime MMO run by someone else.

Read [`docs/01-rules-envelope.md`](docs/01-rules-envelope.md) before proposing anything.
It is not boilerplate — Politiko has an explicit scripting clause that draws a sharp,
enforceable line, and it is the main design constraint on this whole project.

## Hard rules

1. **Consume, don't request.** Tools read data that already arrived — the DOM of the page
   being viewed, responses the app itself fetched, the client's query cache, the socket
   the client already opened. A tool that adds zero requests to politiko.io cannot
   violate the scripting clause. Treat any design that needs a new request as requiring
   an explicit decision, not a default.
2. **Automation is the operator's call, and the answer is currently no.** Script-initiated
   game actions were in scope from 2026-07-28; as of **2026-08-07 nothing ships one** —
   both exceptions were deleted rather than disabled (`docs/01-rules-envelope.md`).
   Before proposing another, note what retired these two: in both cases the thing the
   automation bought was tedium, and a shortcut the operator presses bought it just as
   well. **Reach for that first.** A sized alert with a jump button, or a next/previous
   walk, costs one keypress and stays inside the clause; price the ban risk properly
   before concluding a request is genuinely needed. Separately and unchanged: Claude does
   not hand-drive the live session — no clicking through the UI on the user's behalf.
   Claude builds and inspects; the human runs the tool.
3. **One account, no alts.** Multi-accounting is aggressively enforced and there is no
   test account. Every authenticated experiment risks the only account. Prefer observing
   normal play over probing.
4. **Never probe an endpoint to see what it does.** If it wasn't called by the app during
   normal use, we don't call it.
5. **Exploits → report, don't test.** If something exploitable surfaces, stop, write it
   up privately, and route it to the bug bounty. Nothing public first.
6. **Disclose everything** in any script shipped — reads, writes, storage, network.
   Undisclosed functionality is explicitly bannable.

## Recon conduct

- Read-only browsing of public pages is fine.
- `tools/fetch-bundles.ps1` is a manually-initiated, one-shot static-asset pull. Never
  automate it, schedule it, or point it at game routes.
- Analyze downloaded bundles locally rather than poking the live site.
- Anything from an authenticated session (tokens, cookies, HARs, personal data) stays out
  of git — see `.gitignore`.

## Layout

```
docs/     numbered findings + plan; 00 recon, 01 rules, 02 plan, 03 ideas,
          04 stocks, 05 people, 06 time, 07 alignment, 08 sleepers, 09 sockets,
          10 xp, 11 faction raids, 12 navigation, 13 world politics,
          14 government motion, 15 shops, 16 client cost, 17 attributes,
          18 casino slots, 19 casino blackjack, 20 newspaper,
          21 opinion motion
tools/    recon helpers; collect-stores.js (export half: the tools' own stores → one
          gitignored JSON in artifacts/) and read-stores.js (the brief a strategy
          conversation starts from — run it before talking strategy)
userscripts/  _template.user.js — passive-tap skeleton + WS TAP + PANEL KIT;
              people-watch, market-watch, time-watch, align-watch, comms-move,
              time-bridge, ws-watch, xp-watch, raid-watch, sleeper-watch,
              quick-jump, world-watch, gov-watch, poll-watch, shop-watch, bar-watch,
              slot-watch, jack-watch;
              README.md
              documents them; tools/ holds their tests, and tools/harness/ has two
              benches with fetch/WebSocket/XHR stubbed out, so no UI work needs the
              live game: index.html renders one panel against canned payloads, and
              row.html loads every tool at once and measures where each button
              landed — the only place the shared home row exists. Every userscript
              ships from here — no separate repos
artifacts/    gitignored: downloaded bundles, HARs, captures
```

## Conventions

- Findings go in `docs/`, dated, with the evidence that produced them. Distinguish
  **measured** from **inferred** — the recon baseline already flags which is which.
- The landing page's stat blocks are hardcoded marketing content. Only `/api/public/*`
  reflects the real world state. Don't cite the landing page as data.
- Chunk hashes change every deploy — never hardcode a hashed filename or a generated CSS
  class in anything meant to last.
- **Any on-screen panel must be movable and resizable.** If a tool draws UI over the game,
  that UI is draggable and remembers where it was put — including the floating toggle
  button, not just the panel — and any panel (not the button) is resizable and remembers
  that too. Copy the `PANEL KIT v3` block from
  [`userscripts/_template.user.js`](userscripts/_template.user.js) verbatim instead of
  writing a new drag or resize implementation; if the block changes, bump its version in
  every copy so the copies can be diffed. Hand `resizable()` the panel's `draggable()`, and
  double-click the title bar must undo both. It also has to survive a short window: a panel
  whose drag handle ends up off-screen cannot be recovered, so `fit()` runs after every
  render, and after every resize. **One** window is outside this on purpose and is named in
  `tools/test-placement.js`: comms-move resizes nothing (the window it moves is the game's
  Comms dock). market-watch used to be the second, keeping its own corner grips because its
  panel was pinned to its button — and the real cost of that was not the grips, it was that
  the panel could not be moved at all, only followed a button you moved. It joined the kit
  at 1.8.0. Where a panel is tethered to something by default, the tether is the *default*
  and the first drag of the header ends it: park it, save `ui.panel`, and stop re-placing it
  on every render — otherwise the next response to land shoves it back.
- **Panels live in the margins. Design for narrow.** In practice these windows get parked in
  the empty strip between the game's sidebar and its content, or between the content and the
  right edge of the window — not over the play area, because a panel that covers the game is
  a panel you close. Those strips are a few hundred pixels wide. So a panel is at its
  *typical* size when it is far narrower than the `PANEL_W` its stylesheet asks for, and
  everything in it should still be readable and reachable there: no fixed-width row that
  forces a horizontal scrollbar to read column one, no control bar that wraps into four
  lines, nothing important pinned to the right edge. Where a panel shows a table, this is
  what earns the reader a way to decide the column widths themselves — see below.
- **A table in a panel has resizable columns.** Drag the divider in a column heading to
  set a width, double-click that divider to size the column to the widest text in it,
  double-click the panel's title bar to hand every column back to automatic. Widths are
  remembered like every other piece of panel geometry. This is not decoration: in a margin
  the table is always wider than the panel, and *which* column gets the space is a judgement
  that changes with the job — the same reason the panel is resizable rather than sized by
  us. people-watch is the reference implementation and the only carrier today. Two things
  in it are load-bearing rather than taste, both measured in `tools/harness/` and fenced in
  `tools/test-people.js`: the table needs `table-layout: fixed` (auto layout will not put a
  column narrower than its content at any price, which is the one thing a margin needs), and
  a fixed layout needs one extra column declared with no width to absorb the slack (it
  shares spare width over *every* column otherwise, so a panel wider than the total silently
  inflates all of them and none is the width it was dragged to). Once a table can be wider
  than its body, a repaint has to restore **both** scroll axes, not just `scrollTop`.
  slot-watch and jack-watch take the first of those two and not the dividers: fixed layout
  with declared widths that sum to 100, so their narrow numeric columns truncate with an
  ellipsis and the table can never be wider than the panel. That is the floor — **a table
  may ship without draggable dividers, but not without fixed layout**, because the
  horizontal scrollbar is the failure and the dividers are the refinement.
- **Every toggle button is the same button.** One 38px square, one three- or four-letter
  word — `ALGN`, `MKT`, `RAID`, `SLOT`. Install four tools and four of these land on one
  screen, so the box is not the tool's to pick; copy the `FAB KIT v9` block from
  [`userscripts/_template.user.js`](userscripts/_template.user.js) verbatim, same
  bump-the-version rule as PANEL KIT. What a tool still owns is its slot in the row, its
  z-index, and its state colours, layered on top. No emoji — a 15px glyph is a coin toss
  across fonts, and four of them tell you nothing about which is which. people-watch is the
  one exception and is grandfathered: the eye of providence is its mark. `test-placement.js`
  hashes the copies and names that exception, so a second symbol button fails the build.
- **Every button starts in the same row.** `FAB KIT v9` places them: one line across the
  band above the game's header rule, one slot each, declared as `--pk-slot: N` in the
  tool's own rule and *nothing else about position* — an inset in a tool's rule silently
  leaves the row and fails the build. Slots are fixed rather than packed, so a new tool
  never shuffles the buttons already on screen; the eye leads, and after it the row is
  grouped by what the tools are *for* — yours, then where you go, then your faction, then
  the world, then the instruments (see the block for the table). v8 re-dealt those once, on
  the operator's instruction; **that is over — a seventeenth tool takes slot 16** rather
  than sorting itself in.
  **Adding a slot is a version bump, not a one-line edit**: half the row is a literal in
  the CSS because CSS cannot count the tools installed, so a new tool means a new kit
  version, a pass over every copy, and the JS row in the two self-placing tools.
  `test-placement.js` derives the expected half from the number of tools on disk and fails
  the build rather than let the row quietly stop being centred — that is how v3's eleven
  slots became v4's thirteen, v4's thirteen became v5's fourteen, v5's fourteen became
  v6's fifteen, and v6's fifteen became v7's sixteen. Since v9 that half is *two* derived
  numbers, because the row has two shapes; both come off the same tool count.
  **Below the game's own breakpoint the row folds, and it is the kit that decides that,
  not the tool.** Under `max-width: 767px` — Tailwind's `md:` and the `useIsMobile` every
  chunk carries, i.e. the pixel the game itself changes layout on — the desktop header is
  not on screen and the mobile one has no empty band in it: hamburger and wordmark left,
  your vitals across the middle, the account menu right. So the row leaves the band and
  becomes two lines of eight parked under that header, right-aligned. A tool declares the
  same `--pk-slot` and nothing else; the fold is four custom properties the media query
  re-answers, so it follows the window with no script running. Two consequences: slots
  0-7 are the first line and 8-15 the second, and the row now fits at every width from
  376px up, which retires v8's "under 744 it cannot be a row" as a stated limit.
  The regime is the one place `window.innerWidth` is the *right* width to read: a media
  query includes the classic scrollbar, so asking `matchMedia` is what keeps the fold and
  the game's own layout flipping on the same pixel. Everything inside a regime is still
  measured against the containing block.
  Two things about the row are not width and are easy to undo by accident. **The row yields
  the nav floor before it yields the window edge**: past the edge, the clamp that keeps a
  button reachable pulls every stray one to the *same pixel* and saves it there, which is
  worse than sitting over the game's chrome. And **the row is measured against the
  containing block, never `window.innerWidth`** — a fixed element's percentages exclude the
  scrollbar and `innerWidth` includes it, so the two are half a scrollbar apart, which is
  most of an 8px gap. A tool that positions its own button — market-watch, people-watch —
  carries the same arithmetic in JS, because an inline `left/top` outranks the rule; but it
  only *writes* one for a button the user has actually dragged, and hands an untouched
  button back to the stylesheet, which is what makes the row survive a resize, a zoom, or a
  scrollbar appearing. `test-placement.js` reads both copies and fails on a drift.
  **Double-click is the only way back into the row**, so every button needs the `dblclick`
  that clears the stored position *and* calls `reset()` — it must **forget**, never store
  the current row, or the button is pinned to the window it was reset in.
- **A button says when its own panel is open.** `fab.classList.toggle('pk-open', ui.open)`
  at the single place your tool writes the panel's display, above any `if (!ui.open)
  return` — below it, the class is only ever added and a closed panel leaves a lit button
  behind. Always `toggle()` with the second argument: `className =` drops `pk-fab` and
  takes the whole box with it, and a bare `add()` needs a `remove()` somewhere else to
  agree with it. The kit owns the **fill** and nothing else, so a tool's state colour
  still reads through an open button. `test-placement.js` checks all three.
- **An alert that leaves the page is a decision, not a feature.** In-page is free — a lit
  button, a banner, a row that changes colour — and every tool may do it. Anything a
  player can perceive while looking at another tab (`document.title`, the favicon, sound,
  and since 2026-09-11 an OS notification) ships **off, behind its own switch**, is
  disclosed by name and default in the header, and needs a written operator decision in
  `docs/01-rules-envelope.md` before it is built. **There are exactly two carriers and
  they are named there**: `bar-watch` (a bar reaching its level) and `poll-watch` (the
  opinion-poll cooldown expiring). A desktop notification is the case clause 4 pictures,
  so that decision was taken on the operator's explicit instruction with the ban risk
  priced, **not** derived from the earlier title/favicon/sound one — do not extend it to a
  third tool or a third event without going back for another. Everywhere else the
  `Notification` API stays absent — not disabled, not flagged, absent, with a fence test
  saying so — and `serviceWorker`, `pushManager` and `showNotification` stay absent
  **everywhere, including the two carriers**, because a push subscription is a request.
  Before proposing any of this, check whether the game's own Web Push covers it: the
  vocabulary is four keys (`jail_release`, `hospital_release`, `hospitalized`,
  `travel_arrival`), and asking staff for a fifth is always cheaper than shipping a
  channel — a `bars_full` key retires a channel we currently carry risk for. Permission is
  per origin and shared with the game's own push, so a switch asks only when
  `Notification.permission` is still `default`: a **Block** on our prompt turns off
  Politiko's push too. Whatever writes to the tab must put it back — when the alert
  clears, when the switch goes off, and on `pagehide`.
- Windows box: `git commit -F <file>` rather than `-m` (PowerShell mangles quoted `-m`).
  `.gitattributes` handles the CRLF situation.
