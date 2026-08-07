# Recon baseline

Measured **2026-07-28**, logged out, from the live site. No account, no authenticated
calls. Everything below came from the landing page, the public JSON endpoints, the
service worker, and the entry JS bundle.

## Stack

| Layer | Finding | Evidence |
|---|---|---|
| Client | React SPA, React Router, TanStack Query | `__reactRouterVersion` global; `QueryClientProvider-*.js` chunk |
| Build | Vite, hashed chunks under `/assets/` | `assets/index-Dig5eBDC.js` + ~80 lazy chunks |
| Entry size | ~397 KB (unminified length of entry chunk) | measured |
| Backend | almost certainly **Go** | unknown `/api/*` paths return `404 page not found` in `text/plain` — the Go `net/http` default |
| Edge | Cloudflare (JSD challenge platform, RUM beacon) | `/cdn-cgi/challenge-platform/...`, `/cdn-cgi/rum` |
| Analytics | Cloudflare Insights + Twitter/X ads pixel; first-party attribution | `beacon.min.js`, `static.ads-twitter.com/uwt.js`, `POST /api/attrib/visit`, `POST /api/attrib/event` |
| Fonts | Google Fonts + self-hosted Geist woff2 | `<link>` preconnect |

## PWA surface

`/manifest.webmanifest` — `display: standalone`, theme `#09090b`, maskable 192/512 icons.
Installable, but **not offline-capable**.

`/sw.js` is ~60 lines and does exactly three things:

- `skipWaiting` + `clients.claim`
- handles `push` events → `showNotification`
- handles `pushsubscriptionchange` → re-subscribes with the same VAPID key and PUTs the
  new endpoint back to the API

**There is no fetch handler and no precache.** So: the "PWA" is an install shim plus
**Web Push**. This matters — the game already owns the "notify me when my cooldown is up"
channel natively, which is the exact thing a script is forbidden from doing by scraping.

## Routing

Unknown paths return the SPA shell (`/robots.txt` served `index.html`, 200, `text/html`).
So a 200 means nothing about whether a route exists — only `/api/*` gives honest 404s.

## Known API surface (unauthenticated)

```
GET  /api/public/stats          → live world counters
GET  /api/public/government     → president / chamber composition
GET  /api/public/top-corps      → revenue leaderboard
GET  /api/public/drug-markets   → per-city price + heat
POST /api/attrib/visit          → first-party attribution
POST /api/attrib/event          → first-party attribution
```

Sample `stats` payload (snake_case JSON):

```json
{"citizens":291,"online_now":0,"game_year":7,"game_day":298,
 "active_corps":15,"bills_passed":3,"bills_killed":89,
 "president_name":"President Hoppe"}
```

Not found: `/api/`, `/api/me`, `/api/openapi.json` — all real 404s. No OpenAPI doc at the
obvious paths.

### Landing-page numbers are partly decorative

The marketing page shows "312 active corps", "535 legislators", "147 events". Live
`/api/public/stats` says **291 citizens, 15 active corps, 0 online**. The wire log,
conflict map, and Herald front page on the landing page are **hardcoded demo content**,
not live data. Don't build anything off the landing page — it lies. Only `/api/public/*`
is real.

Implication: this is a **small, new world** (Y7 D298 is in-game time, not age). Population
is low enough that any tool's value is analytical, not competitive.

## Real-time channel

The entry bundle contains both `wss://politiko.io` and `new WebSocket`. So there is a
live socket, presumably for the wire feed / combat / chat. **Not yet characterized** —
protocol, auth handshake, and message shape are all unknown. This is the single most
interesting unexplored surface, because a socket the client already holds open is a
zero-extra-request data source.

No `EventSource` or `socket.io` strings — looks like a raw WebSocket.

## Game surface, enumerated from chunk names

Vite names lazy chunks after their source module, so the route list leaks for free:

**Crime / action:** `CombatPage` `HackingPage` `DrugDealPage` `CarTheftPage`
`GraffitiPage` `SmugglingPage`(implied) `ActionsPage` `JailPage` `HospitalPage`
**Politics:** `GovernmentPage` `OpinionPollPage` `DonationsPage` `ActivismPage`
**Economy:** `CorporationsPage` `CorporationDirectoryPage` `CorpDirectory`
`PropertyPage` `propertyDisplay` `ItemsPage`
**Social:** `FactionPage` `FactionStatusFeed` `NoFaction` `factionUtils` `MarriagePage`
`ProfilePage` `SleeperRecruitmentPage`
**Content:** `NewspaperPage` `NewsPage` `EventsPage`
**Classifieds:** `PostJobListingPage` `JobListingManagerPage` `PostClassifiedAdPage`
`ClassifiedAdManagerPage` `PostPersonalPage` `PersonalManagerPage`
**Auth:** `LoginPage` `RegisterPage` `OAuthButtons` `OAuthCallbackPage`
`OAuthCompletePage` `ForgotPasswordPage` `ResetPasswordPage`
**Other:** `TravelPage` `useMissions` `NotFoundPage`

`useMissions` being a shared hook (not a page) suggests a mission/quest system threaded
through multiple screens.

## What wasn't found yet

- API path strings did **not** regex out of the entry bundle — they live in the route
  chunks, or are assembled from template literals. Pull the chunks and grep them
  (`tools/fetch-bundles.ps1`).
- Auth scheme unknown. Cookies seen logged-out are only `pk_vid` (visitor id) and
  `_twpid` (Twitter pixel). Session token shape TBD — cookie vs `Authorization` header.
- `localStorage` was **empty** logged-out; the app stores nothing client-side pre-auth.
  Session storage only holds attribution dedupe flags (`pk_visit_sent`, `pk_evt_landing_view`).
- Whether an *official* player-facing API (the one the rules sanction) exists separately
  from the internal `/api/*` the SPA calls. **This is the key unknown.**
