# Navigation surface

Prompted by a plain question, 2026-08-23: *why does entering a casino take five screens?*

**Read off the 2026-08-10 bundle on 2026-08-23. Zero game contact.** Everything here is
recovered from `artifacts/bundles/2026-08-10/` — the route table, the sidebar definition
and the casino card are all literal client source. As always in this repo that proves what
the **client** does, not what the server sends: route paths and nav items are measured,
payload fields are the client's expectations and are marked where it matters.

## The question, answered

To gamble you go: **Corporations → (scroll to the footer link) → Directory → page until you
find the casino corp → its corp page → Enter casino → pick a game.**

Every one of those is a real URL. None of them except the first is reachable from the nav.

```
/corporations                       sidebar item "Corporations" — this is YOUR corp, not a list
/corporations/directory             linked only from a small footer link on the page above
/corporations/{id}                  the corp's public page
/corporations/{id}/casino           the lobby — the "Enter casino" button
/corporations/{id}/casino/{game}    the table
```

The chain is not a UI accident, it is the data model: a casino is a **corporation of type
`casino`** that has acquired a casino-type **property**, and the floor is a room inside
that corporation. The player-facing consequence is that a public amenity is filed under
somebody's company registration.

## The route table

**84 routes**, extracted from the router in the entry bundle. They are declared with
backtick template literals (``path:`corporations/:id/casino` ``), which is why a naive
`grep '"/casino'` finds nothing — the first pass at this surface missed the entire casino
tree that way. Grep for ``path:` `` instead.

**21 of the 84 take a parameter.** Those are the ones a launcher cannot hardcode:

```
city/:id                      combat/:id                    corporations/:id
corporations/:id/casino       corporations/:id/casino/blackjack
corporations/:id/casino/craps         corporations/:id/casino/poker
corporations/:id/casino/predictions   corporations/:id/casino/roulette
corporations/:id/casino/slots
education/:major              faction/:id                   factions/:id
factions/:id/raids/:raidId/report     forums/:boardId        forums/t/:threadId
profile/:username             property/:id                  protests/:id
trades/:id                    :slug
```

### A route is not its endpoint — noted 2026-08-26

Worth stating plainly, because a tool got it wrong: **the client route and the API path
that serves it are not the same string, and the difference is not systematic.** Opinion
polling answers on `/api/actions/poll` and lives at **`/actions/opinion-poll`**. Graffiti
happens to match (`/actions/graffiti` both ways); polling does not.

A link derived from an endpoint therefore fails silently — the navigation succeeds, the
router matches nothing, and the game renders its own not-found page. `world-watch` 0.2.1
sends every href it offers through one `ROUTE` table, and `tools/test-world.js` checks
that table against `quick-jump`'s `CATALOG`, which is this document's route list kept in
code. Any tool that links into the game should do the same rather than keeping a private
copy of these strings.

## The sidebar, and what it cannot do

The sidebar is a fixed array of **20 items** in the entry bundle, every one of them a
top-level path with no parameter:

```
home messages contacts faction corporations city actions train travel people
inventory trades job hospital jail education market stocks events government
```

There is a `/settings/sidebar` screen and a `GET /user/config/sidebar` endpoint behind it,
so sidebar layout is a real, server-persisted feature. **It only reorders and hides.** The
page's entire vocabulary is `Visible / Hidden / Empty / Reset` plus up and down arrows —
there is no "add a destination", and there could not be, because the config is keyed to
those 20 fixed keys.

So: **the game ships customisable navigation that cannot be pointed at 64 of its own 84
routes.** That is the gap, stated precisely. Not a missing feature — a feature whose domain
is smaller than the app.

Destinations with no nav entry at all, worth naming because most of them are places players
go repeatedly:

| | |
|---|---|
| `corporations/directory` | the only way to find any corporation |
| `corporations/:id/casino` + 6 games | the entire gambling surface |
| `property` · `estate-market` | housing, owned property, the market to buy more |
| `city/bank` · `city/cockfighting` | inside City, but not linked from the nav |
| `actions/*` (7 of them) | crime screens, one level under Actions |
| `factions/directory` · `factions/:id` | other people's factions |
| `market/players` | player auctions, distinct from `market` |
| `marriage` · `protests` · `forums` · `news` · `newspaper` · `wiki` | |
| `newspaper/*/manage` (3) · `forums/my-posts` | your own posted content |

## The casino card, measured from the client

`CorporationRoutePage` renders the entry button from `GET /corporations/{id}/casino`, query
key `['casino-summary', id]`, `staleTime: 15000`. Fields the client reads:

```
operational            bool     false → "must acquire or lease a casino property"
wagering_suspended     bool     true  → outstanding regulatory fine; audits still open
current_city_access    bool     THE GATE — see below
venues                 [{ property_id, location_name }]
games                  [{ key, status }]        status === "live"
available_dealers / dealer_capacity / reserve_balance
prediction_fee_bps / poker_rake_bps / slots_rtp_bps
```

### `current_city_access` is the whole story

The "Enter casino" button **only renders when `current_city_access` is true**. Otherwise
you get: *"Travel to one of this casino's venue cities to enter."*

A casino is not a website you visit, it is a building you stand in. `venues[]` lists the
cities it has a floor in, and you must be in one of them. This is the single most important
thing for any tool that offers a shortcut to a casino: **a jump to a casino you cannot
enter is worse than no jump at all**, because it costs a page load to be told no. Anything
that surfaces these doors must surface the gate with them.

### Craps ships but is hidden — leave it alone

`CasinoLobbyPage` builds its game grid as:

```js
games.filter(e => !new Set([`craps`]).has(e.key))
```

`/corporations/:id/casino/craps` is a live route, `CasinoCrapsPage` is a shipped 18 KB
chunk, and the lobby carries copy for it (*"Private Vegas dice"*, *"Take the dice"*). The
client filters it out of the only screen that would link to it.

That is an operator decision expressed in code. Whatever the reason — unfinished, staged,
withheld — a script that surfaced a door the game deliberately closed would be doing the one
thing this repo does not do. **Craps is excluded from anything we ship**, and the right way
to get it is to wait for the filter to come out. Recorded here so the exclusion is a
decision rather than an oversight.

## Where the IDs come from, without asking for them

A launcher that offers parameterised destinations needs their IDs. Every one below arrives
on its own, in a response to a request **the game already made**, on a page you were looking
at. Nothing here needs originating a single call.

| Response | Carries | Reaches |
|---|---|---|
| `GET /corporations?page=N` | `items[]: {id, name, type, location_name, is_active}`, `pages`, `total` | every corp you have paged past — **including `type: "casino"`** |
| `GET /corporations/mine` | your corp object, or null | your own corp |
| `GET /corporations/{id}` | that corp | wherever you have been |
| `GET /corporations/{id}/casino` | the summary above | venues, gate, live games |
| `GET /property/owned` | array of properties | your holdings |
| `GET /factions/mine` · `/factions/{id}/public` | faction objects | factions |
| `GET /user/status` | polled every 10 s on every authenticated page | a free heartbeat |

The directory is the important one. **Paging the corporation directory once populates the
casino list permanently** — the corp type is right there in the row. One visit to a screen
you were going to visit anyway is the entire acquisition cost.

`GET /user/status` at `refetchInterval: 10000` deserves its own note: it is the most
reliable recurring signal in the client, arriving unprompted on every authenticated route.
Useful as a liveness tell for any tap.

## Navigating from a script

React Router **7.18.2** (`window.__reactRouterVersion`). Its history layer listens to
`popstate` and keeps an index in `history.state.idx`:

```js
function u(){ return (history.state || {idx:null}).idx }
function d(){ let e = u(), t = e == null ? null : e - l; l = e; c({action:`POP`, …, delta:t}) }
```

So `pushState` plus a synthetic `popstate` is a client-side navigation, which is what
`people-watch` has been doing since 1.0.0 and it works. One improvement is available now
that the history source has been read: people-watch pushes `{}` as state, which erases
`idx` and makes `delta` null. Carrying the index forward instead —

```js
const idx = (Number.isFinite(history.state?.idx) ? history.state.idx : 0) + 1;
history.pushState({ usr: null, key: <random>, idx }, '', href);
window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
```

— keeps the router's bookkeeping consistent, so Back after a scripted jump behaves like
Back after a click. `quick-jump` does it this way; people-watch should adopt it next time
it is touched.

**This is navigation, not automation.** The user presses a key, one page loads, exactly as
if they had clicked a link — the same footing as the people-watch roster walk, and inside
the envelope for the same reason (`01-rules-envelope.md`, and the 2026-08-07 note on what
retired the two exceptions: a shortcut the operator presses).

## `property/:id` — a route we do not link

`property` and `property/:id` resolve to the **same component**, and `PropertyPage` never
generates a `/property/{id}` link itself — it renders holdings inline. So the parameterised
form exists but what it does with the id is unverified from the bundle alone.

Not shipped. `quick-jump` offers `/property` and `/estate-market`, which are known screens.
Confirming `/property/{id}` costs one navigation on a real account and can be done whenever
somebody is on that page anyway.

## What this justifies building

A launcher, and only a launcher. The design falls out of the findings above:

1. **64 routes have no nav entry** → offer the 53 parameterless ones statically, no
   learning needed. 33 of those 53 are unreachable from the sidebar.
2. **21 routes take an ID** → learn IDs passively from the table above; the directory pays
   for every casino in one visit.
3. **`current_city_access` gates the casino** → show the gate next to the door, always, with
   the venue cities and how stale the reading is.
4. **Craps is filtered by the client** → filter it too.
5. **The sidebar can only reorder 20 fixed keys** → pinning arbitrary destinations is the
   thing the game genuinely cannot do, so that is the feature.

Shipped as `userscripts/quick-jump.user.js`.
