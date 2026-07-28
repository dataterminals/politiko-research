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

Recon only, logged out, no account touched. Known so far:

- Vite + React + React Router SPA, TanStack Query, ~80 lazy route chunks whose names leak
  the entire game surface (combat, hacking, smuggling, corps, factions, marriage, jail…)
- Go backend behind Cloudflare; JSON API under `/api/`, four public endpoints open
- The "PWA" is an install shim plus **Web Push** — the service worker has no fetch
  handler and no offline cache
- A **WebSocket** (`wss://politiko.io`) exists in the bundle and is completely
  uncharacterized — the most interesting unexplored surface
- The landing page's live-looking stats are hardcoded marketing content; only
  `/api/public/*` is real

Full detail with evidence: [`docs/00-recon-baseline.md`](docs/00-recon-baseline.md).

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
userscripts/          _template.user.js — passive-tap skeleton, SPA-aware
artifacts/            gitignored: downloaded bundles, HARs, captures
CLAUDE.md             working rules for agent sessions
```

## Conduct

One account, no alts, no automation, no probing endpoints to see what they do, exploits
get reported rather than tested, and nothing from an authenticated session goes in git.
The rules are in [`CLAUDE.md`](CLAUDE.md) and they're there because the penalties are
real.
</content>
