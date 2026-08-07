# Handoff — 2026-07-28

> **Partly superseded later the same day.** Two things below no longer hold: something
> *has* been built, and the "Claude must not play"
> trap has been narrowed — script-initiated market orders are now in scope by operator
> decision, though Claude still doesn't hand-drive the session. See `CLAUDE.md` hard
> rule 2, `docs/01-rules-envelope.md`, and `docs/04-stocks-surface.md`. The rest of this
> file is still accurate as a record of the scaffolding session.

Scaffolding session. Repo created, recon baseline captured, rules envelope established,
core technique validated. No account touched, nothing built yet.

## Read these first, in order

1. [`CLAUDE.md`](CLAUDE.md) — hard conduct rules. Not boilerplate; the penalties are real.
2. [`docs/01-rules-envelope.md`](docs/01-rules-envelope.md) — the scripting clause,
   decoded into a build/don't-build table. This is the design constraint.
3. [`docs/00-recon-baseline.md`](docs/00-recon-baseline.md) — everything measured so far.
4. [`docs/02-research-plan.md`](docs/02-research-plan.md) — phased plan, Phase 0 first.

## What this session did

- Recon of politiko.io logged out: stack, PWA surface, public API, routing behavior,
  service worker, and the full game surface enumerated from Vite chunk names
- Found and decoded the **Scripting Abuse** rule — Politiko explicitly permits user
  scripts under conditions, which defines the entire design space
- **Validated the passive `fetch` tap on the live client**: it captured all four
  `/api/public/*` responses the app issued during a client-side route change, adding zero
  requests of its own. Also confirmed React Router responds to `popstate`, so
  `pushState` + `popstate` produces a real route change with no page load — useful both
  for tooling and for inspection without losing injected state.
- Wrote the SPA-aware userscript skeleton around that verified tap
  ([`userscripts/_template.user.js`](userscripts/_template.user.js))
- Wrote [`tools/fetch-bundles.ps1`](tools/fetch-bundles.ps1), a one-shot crawler over the
  app's own static asset graph (entry chunk → lazy chunks) for local grepping

## Start here

**Phase 0: does a sanctioned player API exist?** The scripting rule permits tools that
"rely on data from our API," which implies something official. Everything branches on the
answer:

- **Yes** → out-of-page tooling with history and aggregation becomes legitimate; the
  project gets much bigger
- **No** → strictly passive in-page overlays; still worth doing, much narrower

How to find out, cheapest first:

```bash
pwsh ./tools/fetch-bundles.ps1
```

then grep the downloaded chunks for API paths, `Bearer`/`Authorization`/`api_key`
handling, and the WebSocket URL and handshake. The entry bundle alone yielded no `/api/`
strings, so they're in the route chunks or built from template literals. Also worth
checking the Discord and `/contact` for documented API access.

Second most valuable target: **characterize the WebSocket**. `wss://politiko.io` +
`new WebSocket` are in the bundle and nothing else is known. A socket the client already
holds open is the purest possible data source under the rules.

## Traps worth knowing

- **The landing page lies.** Its wire log, conflict map, Herald front page, and stat
  blocks ("312 active corps", "535 legislators") are hardcoded demo content. Live
  `/api/public/stats` says 291 citizens, 15 corps, 0 online. Never cite the landing page
  as data.
- **Every path returns 200.** The SPA catch-all serves `index.html` for anything —
  `/robots.txt` returned the app shell. Only `/api/*` gives honest 404s, and it does so
  in Go's `text/plain` default, which is how we know the backend is Go.
- **Chunk hashes change every deploy.** Never hardcode a hashed filename or a generated
  CSS class in anything meant to survive.
- **The game already owns notifications.** The service worker's only job is Web Push. Any
  "alert me when X" idea should use the game's own push, not a script — scripts are
  explicitly forbidden from alerting off unfocused pages.
- **No test account is possible.** Multi-accounting is aggressively enforced. All
  authenticated work happens on the one real account, at real risk.
- **Claude must not play.** The account-sharing rule covers "having someone initiate
  processes on your behalf." Agent-driven clicking of game actions is bannable. Inspect
  an already-open, human-driven page; don't drive it.

## Open questions

- Sanctioned API: exists? tokened? documented? rate limits?
- Does the internal `/api/*` count as "our API" for the clause, or only an official one?
  (Reading responses the client already fetched is safe either way — *originating* calls
  is the ambiguous case. Don't, until answered.)
- WebSocket protocol, auth handshake, and message envelope
- Auth scheme once logged in — cookie vs header, refresh, CSRF
- Which server responses carry more data than the UI renders (that gap is where passive
  overlays get their value)
- Is sharing tools with other players acceptable to staff? Distribution is a separate
  question from personal use.

## Suggested opening prompt for the next session

> Read CLAUDE.md, HANDOFF.md, and docs/ in H:\Github Repositories\politiko-research, then
> start Phase 0: run tools/fetch-bundles.ps1 and grep the client chunks to determine
> whether Politiko has a sanctioned player API, plus map the WebSocket and the internal
> API surface. Read-only, no account, no requests to game routes.
