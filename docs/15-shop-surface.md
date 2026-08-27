# Shop surface — and the restock alert that cannot be built

Prompted by a faction request, 2026-08-27: *notify me when the city shops refresh — it's
the only place to get ammo and it gets bought out fast.*

**Read off `artifacts/bundles/2026-08-03/` on 2026-08-27. Zero game contact.** Note that
other docs in this folder cite a `2026-08-10` pull; `artifacts/` is gitignored and only the
08-03 pull survives on this machine, so everything below is measured against that. As
always, this proves what the **client** does, not what the server sends — payload fields
are the client's expectations and are marked where it matters.

## The answer up front

**The tool as requested cannot be built inside the scripting clause, and it is not a close
call.** It is the same shape as two things already on this repo's 🟥 list
([`03-script-ideas.md`](03-script-ideas.md)) and it fails the clause on three separate
counts at once. The detail is in [Three walls](#three-walls) below.

**What can be built is a different tool with the same purpose**, following the `gov-watch`
precedent exactly: learn the restock cadence passively from readings the operator's own
visits already produce, then *project* the next one and count down to it. That design is in
[What is buildable](#what-is-buildable).

**And the cheapest fix is not a script at all.** The game ships a complete Web Push
pipeline whose preference set is four keys wide and does not include stock. A fifth key is
a feature request, and this is precisely the case hard rule 2 tells us to reach for first.
See [The switch that should exist](#the-switch-that-should-exist).

## What a shop is, measured

The City tab is `CityPage`, and its list comes from one call:

```
GET /city        query key ['city-buildings']     → [{ id, name, kind, description }]
```

`kind` is one of four the client has icons and labels for — `shop`, `clinic`, `dump`,
`cockpit` — with an unknown `kind` falling back to a generic "Building". A shop is a row in
that list, and its door is `/city/{id}`, rendered by `BuildingPage`.

`BuildingPage` makes exactly four reads and two writes:

```
GET  /city                       ['city-buildings']   to resolve the building's name
GET  /city/stores/{id}           ['store-buy',  id]   the buy list
GET  /city/stores/{id}/sell      ['store-sell', id]   what it will buy from you
GET  /user/money                                      your balance
POST /city/stores/{id}/buy       { item_def_id, qty }
POST /city/stores/{id}/sell      { player_item_id, qty }
```

### The buy row, and the one field that matters

Fields the client reads off a `/city/stores/{id}` row:

```
item_def_id   name   category   rarity   description   icon_image_path
buy_price     sell_price        stock
```

**`stock` is nullable, and null means unlimited.** The client branches on it in three
places and renders `—` when it is null, a bare integer otherwise. The buy modal reads the
same field as a purchase ceiling: `e.stock == null ? 9999 : e.stock`, then clamps the
quantity picker to `min(affordable, that, 99)`.

So a limited-stock item is exactly the case the faction is complaining about, and the game
models it with a single integer and no other state.

### There is no restock field. Anywhere.

A grep across all 126 chunks for `restock`, `replenish`, `re-stock`, `stock_refresh`,
`next_stock` and `inventory_reset` returns **one hit, and it is the word "replenishes" in a
wiki paragraph about energy**. There is no `restocks_at`, no `next_restock`, no cadence
constant, no countdown component, no cooldown pill.

**Measured:** the client has no concept of when a shop refills. It renders the number the
server sent and nothing else.

**Not measured, and worth being precise about:** this does *not* prove the server omits a
restock timestamp. It proves no code path reads one. The distinction is the whole basis of
the response-vs-render technique this repo already uses, and it is the single cheapest
thing to check — see [First light](#first-light-one-visit-settles-it).

### The store list has no `subcategory`

Ammo is defined in the wiki as **`category: material`, `subcategory: ammo`**, carrying
`metadata_json.ammo_type`. `ItemsPage` filters your inventory on exactly that
(`t.subcategory === 'ammo'`).

The **store** payload's read set has `category` but no `subcategory` — `BuildingPage`
builds its filter tabs as `new Set(rows.map(r => r.category))`, so in a shop the operator
gets a "material" tab that mixes ammo with construction supplies and weapon parts. Again:
the client not reading it is not the server not sending it. If `subcategory` is on the
wire, an ammo-only view is free and the game does not offer one.

### `stock` is per-store, and the sell list is separate

`['store-buy', id]` and `['store-sell', id]` are distinct query keys against distinct
endpoints, both invalidated after either mutation. Nothing in the client aggregates stores,
and there is no all-cities stock endpoint. **Knowing what a shop in another city holds
requires being in that city** — the same wall `market-watch` hit, and the reason the
14-city market scanner stayed 🟥.

## Three walls

The request is "notify me when the shops refresh." Decomposed, each half is independently
out of bounds, and the joint is worse than either.

**Wall 1 — knowing requires asking.** There is no restock event on any socket. The three
sockets are characterized in [`09-socket-surface.md`](09-socket-surface.md): `/ws/chat`
(7 inbound types, all chat and presence), `/ws/market` (`quote`, `candle_update`, stocks
only, and only while you are on `/stocks`), and `/ws/casino/poker`. **None carries item,
store or stock traffic.** `GET /user/status`, the free 10-second heartbeat on every
authenticated page, carries no store field either. So the only way to observe a stock
number changing is to call `/city/stores/{id}` again — which is an additional non-API
request that the user did not manually initiate. **Clauses 1 and 5.**

**Wall 2 — a shop you are not looking at is a page you are not viewing.** The permitted
surface is "a page that you have manually loaded and are actively viewing." A background
stock check is scraping a page not currently being viewed. **Clause 2.**

**Wall 3 — the notification is the named prohibition.** Clause 4 bans extracting data from
unfocused pages "in order to send it elsewhere, **raise alerts, or draw attention to itself
or another window**." A desktop notification that fires while the operator is in another
tab is that sentence's worked example.

None of these is a gray area to be argued down, and the penalty is a game ban on the only
account that exists (hard rule 3). This repo has already ruled this out twice, under two
names — *"Background cooldown alerts (unfocused page + alerting + extra requests)"* and
*"Sniping/notification tooling that fires while you're in another tab."* This request is
the same object arriving a third time, and the answer does not change because ammo is
scarce.

### The precedent that says what to do instead

Hard rule 2 is explicit about the move here, and it has been exercised twice. Both July
exceptions — the profile crawl and the market order seam — were retired on 2026-08-07 on
the finding that **what the automation bought was tedium, and a shortcut the operator
presses bought it just as well.** Sizing a trade is arithmetic on data already sent;
placing one is a request; the line goes between them.

The same cut runs through this request. *Knowing when to go* is arithmetic. *Going* is a
navigation the operator performs. A tool that does the first and hands the second to a
button is inside the clause; a tool that does both is a bot.

## The switch that should exist

The game already has the entire notification pipeline, server-side, and this is the
strongest argument available for asking rather than building.

**Measured from `index-AUYATDjW.js`:**

```js
var Hi = { jail_release: !1, hospital_release: !1, hospitalized: !1, travel_arrival: !1 },
    Ui = `politiko_push_preferences`;
```

Four keys, all defaulting off, cached in `localStorage` under `politiko_push_preferences`.
Support is gated on `serviceWorker in navigator && PushManager in window && Notification in
window`, the worker registers from `/sw.js`, the VAPID key comes from `GET
/push/vapid-public-key`, and `SettingsPage` renders the toggles under a "Notifications"
card. Mobile browsers that are not installed as a PWA are refused with *"Install the PWA to
enable mobile push notifications."*

So: **Politiko has real push, and its vocabulary is jail, hospital, hospitalization and
travel arrival.** Stock is not in it.

That is a five-word feature request — `store_restock`, defaulting off, alongside the four —
and it is the [`auto-accept` pattern](01-rules-envelope.md) exactly: the same build that
added the support desk also shipped `GET`/`PUT /api/jail/legal-offers/auto-accept`, a
server-side toggle for a thing a script would otherwise be tempted to automate. The
operator gets the notification, the client originates nothing extra, and nobody is running
a bot.

**And the answer path is now good.** `/contact` became a threaded support desk in the
2026-08-26 build. This is worth attaching to the sanctioned-API question already queued
there rather than sending on its own — one ticket, and the restock request is the concrete
example that makes the abstract question answerable.

## What is buildable

`shop-watch`, and the design falls out of the findings above rather than out of the
request.

The premise it rests on: **the restock cadence is currently unknown, and it is knowable
without asking the server anything.** `gov-watch` established the pattern on a harder case
— it recovered that Congress runs a monthly cycle, about fourteen real hours at 52×, from a
screen that keeps no history at all.

### 1. Passive tap, no new reads

Wrap `fetch` (`@grant none`, load-bearing — see `03-script-ideas.md`) and keep every
`/city/stores/{id}` and `/city/stores/{id}/sell` response the app fetches when the operator
opens a shop. Also keep `/city` so store ids get names and cities.

Zero added requests. Every reading is the operator walking into a shop they were going to
walk into.

### 2. Restock detection by diff, with a bracket

Between two readings of the same store, for each `item_def_id`:

| `stock` moved | means |
|---|---|
| **up** | a restock happened **in this window** |
| down | somebody bought some (possibly you) |
| unchanged | no information |
| null → number, or number → null | the item's stock model changed; log, don't infer |

The bracket is the product, and it is `gov-watch`'s discipline verbatim: **never "restocked
at 14:02", always "restocked between these two readings"**, with the window printed on
every row and a six-hour window drawn to look six hours wide. A tool that prints a
timestamp it cannot know is worse than one that prints nothing.

### 3. Cadence inference, and the honesty about it

Collect brackets. If restocks land on a boundary, tight brackets will converge on it. Test
both clocks — **real time and game time** — because `time-watch` already has the game clock
and its acceleration measured ([`06-time-surface.md`](06-time-surface.md)), and a restock on
the *game* month at 52× is roughly fourteen real hours, which would explain "bought out
super fast" better than any real-time schedule would.

The tool states which hypothesis fits and how much evidence it has, and it says
**"unknown"** until the brackets actually converge. A confident countdown built on four
observations is the failure mode to design against.

### 4. Once known: project, count down, and hand over a button

This is the whole payoff and the entire departure from what was asked. With a cadence in
hand there is **nothing left to poll**: the next boundary is arithmetic. The panel shows
the countdown, the last-seen stock per item with its age, and a jump button to
`/city/{id}` — the same client-side route change `quick-jump` performs, fetching only at
the moment the operator clicks.

Alerting stays **in-page and visible-tab only**, matching every other tool in this repo.
No `Notification`, no sound, no title-bar poke, no redraw while hidden. If the countdown
hits zero while the operator is in another tab, they find that out when they come back —
and that is the cost of staying inside the clause, stated plainly in the panel rather than
engineered around.

### 5. What it refuses

- **Any refresh of anything.** The countdown never re-reads a store to check itself.
- **Any cross-city reach.** Stock is per-store and the client has no aggregate; the panel
  shows the cities you have actually been in, with the age of each reading.
- **Any purchase.** There is a `POST /city/stores/{id}/buy` and its shape is deliberately
  absent from the file, with a test that fails the build if it appears — the `market-watch`
  fence, for the same reason.
- **Alerting from an unfocused tab.** Named here so it is a decision, not an omission.

### First light: one visit settles it

Before any of the above, the tap answers the cheap question. Open one shop with the panel
recording and diff the raw `/city/stores/{id}` body against the field list in
[The buy row](#the-buy-row-and-the-one-field-that-matters). If the server is sending a
`restocks_at` the client throws away, **the entire cadence-inference apparatus is
unnecessary** and the tool is a countdown over a number the game already told us.

That is one navigation to a screen the operator visits anyway, and it is worth doing before
writing step 3.

### Placement

Slot **12**, word **`SHOP`**, per FAB KIT v4. Note this breaks the alphabetical run
(`SHOP` would sort between `RAID` and `SLP`) and that is correct: the kit's rule is that
slots are **fixed rather than packed**, so a new tool never shuffles buttons already on
screen. Alphabetical ordering described how the first eleven were assigned; it does not
outrank stability afterward.

**Resolved 2026-08-27, and this section originally said slot 11.** The caveat it raised —
that `poll-watch` drew its own button at `left: 12px; top: 56px` with a `◔` glyph, declared
no slot, and so sat outside both the row and the one-symbol exception — turned out to be
the answer rather than a footnote to it. `poll-watch` was the older claim on the next free
number, so it took **11** (word `POLL`) and `shop-watch` moved to 12.

That is also what took the kit to v4: eleven slots became thirteen, and half the row went
from 249px to 295px. Half the row is a literal in the CSS because CSS cannot count the
tools installed, so **every slot the row gains costs a version bump and a pass over every
copy** — budget for that when the fourteenth tool arrives. `tools/test-placement.js`
derives the expected half from the number of tools on disk, so it fails the build rather
than letting the row quietly stop being centred.

## Summary for the faction

- The shop is `GET /city/stores/{id}`; stock is one nullable integer; **null means
  unlimited**.
- **The client has no idea when a shop refills** — no field, no timer, no countdown.
- A background notifier needs extra requests, an unfocused page, and an alert. That is
  three prohibitions at once and a ban on the only account any of us has.
- The game *does* have push. It covers jail, hospital, hospitalization and travel. **Asking
  for a fifth key is the highest-value move available and costs nothing.**
- Meanwhile a passive tool can learn the cadence from ordinary shop visits and count down
  to the next one — which, if the cadence is regular, gets the faction most of what it
  wanted without anyone risking an account.
