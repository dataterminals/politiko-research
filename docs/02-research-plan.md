# Research plan

Phased so that each phase's output decides whether the next one is worth doing. Nothing
here requires writing a shipping tool until Phase 4.

---

## Phase 0 — Answer the API question ⬅ **start here**

Everything downstream branches on this. The scripting rule sanctions tools that "rely on
data from our API," which strongly implies a player-facing API exists. Find out.

- [ ] Grep the downloaded route chunks for API path strings, base URLs, and any
      `api-key` / `token` / `Bearer` handling (`tools/fetch-bundles.ps1` fetches them)
- [ ] Look for a settings/developer screen in the chunk list or in-game once logged in
- [ ] Check the Discord and `/contact` for documented API access
- [ ] Determine: does an official API exist? Tokened? Rate-limited? Documented?

**Branch:** if yes → a whole class of legitimate out-of-page tooling opens up (history,
cross-session, aggregation). If no → the project is strictly a passive in-page overlay
project, which is still worth doing but much narrower. Write the answer at the top of
[`00-recon-baseline.md`](00-recon-baseline.md).

## Phase 1 — Map the client (no account needed)

- [ ] Download all `/assets/*.js` chunks locally; grep for endpoints, socket URL, event
      names, and message shapes
- [ ] Reconstruct the route table from the router config in the entry chunk
- [ ] Identify the TanStack Query setup: query keys, staleness, whether the cache is
      reachable from page context (a `QueryClient` on a module scope, a devtools hook, or
      a React fiber walk)
- [ ] Identify the WebSocket: URL, subprotocol, auth handshake, message envelope
- [ ] Note any client-side game math worth mirroring (catch rates, price curves, combat
      damage) — these are the things an overlay can compute *before* you commit an action

## Phase 2 — Characterize the authenticated session (real account, manual play)

Read-only. Human drives the browser; tooling only observes. No agent-driven clicks
(account-sharing rule).

- [ ] Auth mechanism: cookie vs header, refresh behavior, CSRF handling
- [ ] Per-page network profile: which endpoints each screen calls, what they return
- [ ] Which server responses carry **more data than the UI renders** — that gap is where
      passive overlays get their value
- [ ] WebSocket traffic during normal play: what actually arrives unprompted
- [ ] Where the UI forces avoidable clicks, math, or tab-switching (the real UX problem
      list — this is what the tools should fix)

## Phase 3 — Decide the tool set

Score every candidate in [`03-script-ideas.md`](03-script-ideas.md) on:
value to the player × frequency of use × zero-extra-request purity × build cost.
Pick 2–3. Resist building a suite.

## Phase 4 — Build

- [ ] Userscript (Violentmonkey/Tampermonkey) using `userscripts/_template.user.js`
- [ ] Passive tap layer first (fetch/WS/cache observation), UI second
- [ ] SPA-aware: React Router means no page loads — mount on route change, clean up after
- [ ] Survive rebuilds: chunk hashes change on every deploy, so **never** key off hashed
      filenames, and prefer semantic DOM anchors over generated class names
- [ ] Disclose all behavior in the script header (rules clause 6)

## Phase 5 — Validate and (maybe) share

- [ ] Confirm zero added requests: record a devtools HAR with the script on vs off and
      diff the request list. Ship that diff as proof.
- [ ] Re-read the rules page before any public release
- [ ] Ask staff before distributing to other players

---

## Standing risks

- **One account, no alts.** Every authenticated experiment risks the only account. Prefer
  observation over experimentation; never probe an endpoint just to see what it does.
- **Rebuild churn.** Hashed chunks + generated classnames mean any selector-based tool is
  a maintenance liability. Design for graceful failure, not brittle precision.
- **The game is small** (291 citizens at baseline). A tool that leaks an information
  advantage in a small world is more disruptive than the same tool in a large one. Prefer
  tools that improve *your own* legibility over ones that surveil others.
- **Exploit discovery.** If recon surfaces a real vulnerability: stop, don't test it
  against live state, report it through the bug bounty. Write nothing public first.
