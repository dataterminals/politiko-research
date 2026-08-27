# Candidate scripts

Unvetted idea pool. Nothing here is committed to — Phase 3 picks 2–3 winners.

**Purity** = how close to zero added network traffic (the safety metric from
[`01-rules-envelope.md`](01-rules-envelope.md)).
🟩 zero added requests · 🟨 needs the sanctioned API · 🟥 out of bounds, listed so we
don't re-propose it.

---

## 🟩 Passive overlays — the safe core

### Response-vs-render diff HUD
Tap `fetch` and surface fields the server sent but the UI never showed. Costs nothing,
and in most games this single technique produces more value than everything else
combined. **Build the tap first regardless of which tool ships** — every other idea
below rides on it.

### Pre-commit action calculator
Before you click smuggle / attack / hack, show expected value from data already on the
page: catch rate × cargo value, ammo burn vs target HP, trace timer vs command count.
The rules let you compute anything you like about a page you're looking at.

### Own-history ledger
Persist your own observed state locally (cash, energy, cooldowns, drug prices *as you
saw them*) and chart it. Purely your own footprint, no scraping — you only ever record
pages you personally loaded. Doubles as the data layer for everything else.

### Market memory
Same idea aimed at drug/market prices: annotate the market screen with "last time you
personally saw this city, weed was $131." Turns manual browsing into an accumulating
asset without a single extra request. Honest about staleness by design.

### Terminal helper
The hacking screen is a real command line with ~72 commands. An on-page reference,
history, and trace-budget counter — no automation, just stop making the player
memorize the manual.

### Game-clock calibrator — **shipped 2026-08-03** as `time-watch.user.js`
Passive tap on the `/api/time` responses the app already polls every 60 s. Records
`{realMs, gameSeconds, acceleration}`, shows the live game clock, measures the true
acceleration against its own baseline, and renders the month schedule / next-September
countdown in local time. Zero added requests. Findings that motivated it:
[`06-time-surface.md`](06-time-surface.md).

### Alignment mirror — **shipped 2026-08-07** as `align-watch.user.js`
The political compass only exists on `ProfilePage`, and the home page never fetches it, so
the panel mirrors the last `/api/users/<you>` response the app pulled when you opened your
own profile: the chart redrawn from the client's own constants, a change log with the trail
plotted, and — since alignment is a running average — what one more ±3 action would move.
Alignment-affecting actions submitted since the last reading are logged and projected as a
range. Zero added requests. Findings: [`07-alignment-surface.md`](07-alignment-surface.md).

### World compass — **shipped 2026-08-26** as `world-watch.user.js`
The compass exists for a player and for nothing else, but the client files **all twenty of
its political issues under the same two axes**, and five different populations carry a
signed −3..+3 number on those issues: the law (20 policy axes), the public (opinion-poll
blocs), the street (protest control meters), the media (per-city corporate campaigns), and
the citizens (other players' own alignments). So the world can be plotted on the game's own
chart without asking the server for anything it was not already going to send — and the
same five split city by city, alongside the per-state map the Travel screen polls anyway.
Zero added requests; every row fills from a screen you were going to open, and the panel
names which screen fills which row. What it will not do is average the five into one
number: they disagree, and a sixth figure with no source is not an improvement. Findings:
[`13-world-politics-surface.md`](13-world-politics-surface.md).

### Government motion — **shipped 2026-08-26** as `gov-watch.user.js`
World Watch draws the government as a position; this draws it as a trajectory. The
Government screen keeps no history whatsoever — open it a week apart and nothing says the
second reading differs — while a *different* screen quietly reveals that Congress runs on a
**monthly cycle**, which at 52× real time is about **fourteen real hours**. So the law moves
roughly twice a day and the game never mentions that it did. The tool is a diff engine over
readings the operator's own navigation already produces (the xp-watch precedent), and its
whole product is the **bracket**: never "this changed at 14:02", always "this changed
between these two readings", with the window printed on every row and a four-day window
drawn to look four days wide. The find that makes it more than a visit log is that
`/api/factions/{id}/jobs` carries the same twenty policy axes plus every congress member on
a **`refetchInterval: 15e3` the app runs itself** — the only live feed of the law in the
game, free to read because it is already happening. What it refuses: refreshing anything
(the cadence is *known*, so it projects the next boundary and offers a button instead),
alerting from an unfocused tab, and storing anything about a lobbying job beyond its status.
Findings: [`14-government-motion-surface.md`](14-government-motion-surface.md).

### Time bridge — **shipped 2026-08-07** as `time-bridge.user.js`
Time Watch reads the clock; the [Time Wire](https://dataterminals.github.io/PolitikoTimeWire/)
planner wants that reading; they are different origins, so neither can reach the other's
storage. This runs on both and moves one string between them through the manager's own
script storage. No network code at all. It is also the reason `@grant none` is worth
guarding elsewhere: this script takes the grants it needs precisely *because* it taps
nothing, and keeping the two jobs in separate files is what lets each have what it needs.

### Comms mover — **shipped 2026-08-07** as `comms-move.user.js`
The game's Comms dock is fixed to the bottom-right (`.ch-overlay`, 320×420, z-index 9999)
and owns that corner outright, which is what every other panel has to plan around. This
adds a drag bar above it and remembers where you put it. The most conservative thing in the
repo: no network code at all, not even a tap — DOM of the page you're on, one localStorage
key. Its one side effect is disclosed in the header: an inline position beats the game's
own `body.store-drawer-open` rule, so a parked dock stops making way for the store drawer
until you double-click the bar to hand it back.

### Shop cadence — **first light shipped 2026-08-27** as `shop-watch` 0.1.0
A faction asked for a restock notifier; that is ruled out below and the reason is worth
reading. What survives the cut is the useful half. The client has **no concept of when a
shop refills** — no field, no timer, no countdown anywhere in 126 chunks — and `stock` is a
single nullable integer where null means unlimited. So the cadence is unknown *and* nobody
has to be asked for it: tap the `/city/stores/{id}` responses the operator's own shop
visits already produce, diff the stock per `item_def_id`, and a number that went **up**
brackets a restock. Same discipline as `gov-watch` — never "restocked at 14:02", always
"between these two readings", window printed on every row. Once brackets converge there is
nothing left to poll, because the next boundary is arithmetic: countdown plus a jump
button, in-page and visible-tab only. Test both clocks — a restock on the game month at 52×
is ~14 real hours, which would explain "bought out fast" better than any real-time
schedule. Cheapest step first: one shop visit says whether the server is sending a
`restocks_at` the client discards, which would make the inference apparatus unnecessary.
Findings: [`15-shop-surface.md`](15-shop-surface.md).

### Wire-feed filter
The live wire is firehose-shaped. Client-side filter/highlight on the events already
streaming into the page you're viewing (your faction, your city, your rivals). Purely a
view over data that already arrived.

### Legibility passes
Sticky cooldown/energy readouts, denser tables, keyboard nav, readable timestamps,
persistent column sorts. Unglamorous, high hit rate, near-zero risk.

### XP tracker — **shipped 2026-08-11** as `xp-watch.user.js`
Requested by a crew-mate on Discord (2026-08-10): the XP gained from **each individual
action**, per skill it touched — explicitly *not* the period total the home screen already
shows. Findings that shaped it: [`10-xp-surface.md`](10-xp-surface.md), measured from the
2026-08-10 bundle pull. The short version: values are fractional floats (train gains print
to 4 decimals); training is the **only** action whose response states its award
(`gain` / `after_value`); education awards are declared in the catalog and land silently on
completion; **no crime, combat, jail, or travel response carries any skill field the client
reads**, and the game's own UI cannot show a crime's skill gain at all (its live own-stats
query was deleted — two pages still invalidate the dead key). The proposal's
`/api/attributes` lead was wrong: that endpoint is the energy/juice/hp bars, not skills.

So the tool is a diff engine over readings the operator's own navigation produces
(profile stats tab, train page — both refetch on focus by the app's TanStack defaults),
attributing a window's residual to an action only when **exactly one** candidate sits in
it, and refusing to average ambiguous windows into per-action stats. It also stores
person-scrubbed raw samples of action responses, because the ws-watch precedent says the
wire is probably wider than the reader — if crime responses do carry discarded award
fields, the first grinding session surfaces them. Own-account data only, no alerts,
PANEL KIT v1, zero added requests.

---

## 🟨 Needs the sanctioned API (Phase 0 gates all of these)

- **Congress tracker** — bill calendar and vote history. **Partly delivered 2026-08-26**:
  "whip counts over time" no longer needs the API, because seat composition and every
  per-member alignment are both readable passively and `gov-watch` now tracks them. Bills
  and votes are still gated — they are not in the client at any endpoint, so there is
  nothing to consume. `result_metadata.winner_job_id` on a resolved lobbying job is the
  closest thing to a vote record, and it names a job rather than a faction.
- **Corp/industry analytics** — revenue trends from `/api/public/top-corps`, which is
  already public and unauthenticated
- **World dashboard** — a standalone page built only on `/api/public/*`; arguably fine
  today since those endpoints are public and manually invoked, but confirm first
- **Cross-session price history** — only legitimate with API sourcing, not scraping

## 🟥 Ruled out — do not revisit

- Background cooldown alerts (unfocused page + alerting + extra requests). The game's own
  Web Push already does this; use it.
- Market scanner that walks all 14 cities (pages you aren't viewing) — **still ruled
  out.** The people decision below does not generalize; it was priced for one roster.
- **Player/target database built by crawling profiles** — unruled-out 2026-07-28,
  **ruled back out 2026-08-07**, and the round trip is the useful part. `/api/people`
  carries no activity field at any precision and `last_online` exists only per-profile, so
  a least-active-first sort genuinely cannot be *filled* passively — which is what
  justified the crawl. But the ledger never needed the crawl, only the profiles, and those
  arrive free from profiles you open. `people-watch` 1.0.0 deletes the crawler and ships a
  next/previous walk instead: one keypress per player, every fetch a navigation the
  operator asked for. The exception was retired because it turned out to be buying
  tedium-relief, not reach.
- ~~Any action automation~~ — **no longer ruled out (2026-07-28).** Market execution is an
  accepted-risk build; see hard rule 2 in `CLAUDE.md`. Other action automation
  (auto-travel, auto-attack, auto-deal, auto-collect) stays unbuilt, but by choice now,
  not by policy.
- Anything touching the Cloudflare challenge
- Sniping/notification tooling that fires while you're in another tab
- **Shop restock notifier** — asked for by a faction-mate 2026-08-27 and ruled out the
  same day. It is the two entries above wearing a different hat: there is no restock event
  on any of the three sockets and none in `/user/status`, so observing a stock number
  change means calling `/city/stores/{id}` again (clauses 1 + 5), about a shop you are not
  looking at (clause 2), to raise an alert in another tab (clause 4). Three prohibitions,
  one feature. The **passive** half is fine and is proposed above as `shop-watch`; the
  notification half belongs in Politiko's own push preferences, which already exist and are
  four keys wide. Findings: [`15-shop-surface.md`](15-shop-surface.md).

---

## Delivery format

Userscript first — Tampermonkey (what this operator runs) or Violentmonkey, single file,
no build step, trivially auditable by anyone (which matters for clause 6's disclosure
requirement). A DevTools snippet is fine for throwaway inspection. An extension is only
worth it if we outgrow the userscript sandbox, and it raises the disclosure bar. Note that
the app is an installable PWA — check whether userscripts run in the installed-standalone
window, or only in a normal tab.

**`@grant none` is load-bearing, not a default.** Every tool here works by wrapping
`window.fetch` to read responses the app already asked for. Under any `@grant` other than
`none`, both managers hand the script a sandboxed `window`, so the wrap lands on the
sandbox's `fetch` and the page's real traffic never passes through it — the tap silently
sees nothing and the panel just sits there waiting. If a tool ever needs a `GM_*` API,
that trade has to be made deliberately.
