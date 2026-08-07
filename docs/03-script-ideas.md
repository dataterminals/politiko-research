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

### Wire-feed filter
The live wire is firehose-shaped. Client-side filter/highlight on the events already
streaming into the page you're viewing (your faction, your city, your rivals). Purely a
view over data that already arrived.

### Legibility passes
Sticky cooldown/energy readouts, denser tables, keyboard nav, readable timestamps,
persistent column sorts. Unglamorous, high hit rate, near-zero risk.

---

## 🟨 Needs the sanctioned API (Phase 0 gates all of these)

- **Congress tracker** — bill calendar, vote history, whip counts over time
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
- ~~Player/target database built by crawling profiles~~ — **no longer ruled out
  (2026-07-28).** Built and shipped separately. `/api/people` carries no
  activity field at any precision and `last_online` exists only per-profile, so a
  least-active-first sort is unreachable passively. Accepted-risk operator decision, cost
  priced in [`01-rules-envelope.md`](01-rules-envelope.md); the crawl is disarmed by
  default, paced, foreground-only, expiring, and stops dead on the first non-2xx.
  **Retire it** if the WebSocket turns out to carry presence, or if the roster exposes a
  server-side sort.
- ~~Any action automation~~ — **no longer ruled out (2026-07-28).** Market execution is an
  accepted-risk build; see hard rule 2 in `CLAUDE.md`. Other action automation
  (auto-travel, auto-attack, auto-deal, auto-collect) stays unbuilt, but by choice now,
  not by policy.
- Anything touching the Cloudflare challenge
- Sniping/notification tooling that fires while you're in another tab

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
