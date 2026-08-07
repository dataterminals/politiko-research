Devman note: Please don't ban me I made very sure to stay within the EULA/TOS and this repository exists so that other people can make >>non rule-breaking<< companion apps for the game <3 

# politiko-research

Research into browser-runtime tooling — userscripts, overlays, passive data taps — for
**[Politiko](https://politiko.io)**, a live browser/PWA political-crime MMO.

Not a mod project. Politiko is someone else's running service with real players in a
single shared world, so this is research first: understand the client, understand the
rules, and only then decide what's worth building.

## What Politiko is

A persistent single-world browser MMO where crime and American politics are the same
system. Congress, the Senate, a president and nine justices all run on a real calendar
while players commit crimes, form corporations, buy legislators, run drugs across
districts, hack banks from an in-game command line, and organize protests that shift
policy axes. Everything compounds; the game prints its own newspaper about what you did.
Installable PWA, no client, free to play.

At baseline measurement it had **291 citizens and 15 active corps** — a small, new world.

## The one thing that shapes everything

Politiko's rules address user scripting **directly**, and the clause is specific enough
to design against. Paraphrased: tools are allowed when they draw on Politiko's API or on
**a page you manually loaded and are actively viewing**. Forbidden: extra non-API
requests, scraping pages you aren't looking at, CAPTCHA bypass, pulling data out of
unfocused tabs to alert or notify, and shipping undisclosed functionality.

That produces the design principle this repo runs on:

> **Consume, don't request.**

Read what already arrived — the DOM in front of you, the responses the app itself
fetched, the client's query cache, the socket it already opened. A tool that adds zero
bytes of traffic to Politiko can't cross the line. Full breakdown in
[`docs/01-rules-envelope.md`](docs/01-rules-envelope.md).

**Validated 2026-07-28:** a `fetch` tap installed on the live client captured all four of
the app's own `/api/public/*` responses during a client-side route change, adding no
requests. The core technique works.

## Where things stand

Recon logged out, plus one measured pass over an authenticated screen. Known so far:

- Vite + React + React Router SPA, TanStack Query, ~80 lazy route chunks whose names leak
  the entire game surface (combat, hacking, smuggling, corps, factions, marriage, jail…)
- Go backend behind Cloudflare; JSON API under `/api/`, four public endpoints open
- The "PWA" is an install shim plus **Web Push** — the service worker has no fetch
  handler and no offline cache
- A **WebSocket** (`wss://politiko.io`) exists in the bundle and is completely
  uncharacterized — the most interesting unexplored surface
- The landing page's live-looking stats are hardcoded marketing content; only
  `/api/public/*` is real

- A **stock market** exists that the logged-out chunk list gives no sign of:
  `stocks/instruments/<SYMBOL>` carrying `bid`/`ask`/`price`/`spread_bps`/`float_shares`/
  `ipo_game_day`, read passively off the player's own open page

- The **people roster** is paginated ten at a time (292 players, 30 pages) and carries
  only `username` / `status` / `in_city` — no activity field at any precision. Last-online
  lives on the per-player profile as an exact microsecond timestamp, which the UI rounds
  to whole days

- **Political alignment is a profile-only surface.** `social_axis` appears in exactly one
  of the ~80 route chunks; no other screen — the home page included — fetches or renders
  it. Each axis is a running average over a per-axis action count, so a new action's
  influence decays as `1/(n+1)`

Full detail with evidence: [`docs/00-recon-baseline.md`](docs/00-recon-baseline.md),
[`docs/04-stocks-surface.md`](docs/04-stocks-surface.md),
[`docs/05-people-surface.md`](docs/05-people-surface.md) and
[`docs/07-alignment-surface.md`](docs/07-alignment-surface.md).

## Next

Phase 0 is a single question that branches the whole project: **does a sanctioned player
API exist?** The scripting rule implies one. If it does, out-of-page tooling with history
and aggregation becomes legitimate. If not, this stays a passive in-page overlay project.

Plan: [`docs/02-research-plan.md`](docs/02-research-plan.md) ·
Ideas: [`docs/03-script-ideas.md`](docs/03-script-ideas.md) ·
Picking up cold: [`HANDOFF.md`](HANDOFF.md)

## Layout

```
docs/                 numbered findings and plans
tools/                fetch-bundles.ps1 — one-shot static-asset pull for local grepping
userscripts/          _template.user.js — passive-tap skeleton, SPA-aware, PANEL KIT
                      time-watch.user.js  — game-clock calibrator
                      align-watch.user.js — your political compass on the home page
                      comms-move.user.js  — makes the game's Comms dock draggable
artifacts/            gitignored: downloaded bundles, HARs, captures
CLAUDE.md             working rules for agent sessions
```

Larger tools that came out of this research live in their own repositories; this one keeps
the findings, the rules analysis, the skeleton they were built on, and the small passive
overlays.

Panels drawn over the game are draggable and remember where you put them — the shared
`PANEL KIT` block in the template is copied verbatim into each tool rather than pulled
from anywhere at runtime, so every script stays a single file you can read end to end.

## Conduct

One account, no alts, no probing endpoints to see what they do, exploits get reported
rather than tested, and nothing from an authenticated session goes in git. The rules are
in [`CLAUDE.md`](CLAUDE.md) and they're there because the penalties are real.

**Changed 2026-07-28, largely undone 2026-08-07.** The passive-only posture briefly admitted
deliberate exceptions, where tooling originates requests rather than only consuming what the
client already holds. Politiko's scripting clause is unambiguous that this is bannable, and
each exception was taken knowingly with the cost priced.

Both were **retired on 2026-08-07**. `people-watch` 1.0.0 deletes its profile crawler in
favour of a keyboard walk along the roster; `market-watch` 1.0.0 deletes its order-execution
seam in favour of an alert that sizes the trade and hands you a shortcut to the stocks
screen. In each case every fetch is now a navigation the operator asked for, and the repo is
back to originating nothing.

Reasoning and mitigations are in
[`docs/01-rules-envelope.md`](docs/01-rules-envelope.md); that file still describes
Politiko's published rules accurately, because it's a record of theirs, not ours. The
passive core remains the default — anything that departs from it ships disarmed, arming is
explicit and expiring, and each tool states in its own disclosure block exactly what it
originates.
