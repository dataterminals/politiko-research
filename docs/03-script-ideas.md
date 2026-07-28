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
- Market scanner that walks all 14 cities (pages you aren't viewing)
- Player/target database built by crawling profiles (same)
- Any action automation — auto-travel, auto-attack, auto-deal, auto-collect
- Anything touching the Cloudflare challenge
- Sniping/notification tooling that fires while you're in another tab

---

## Delivery format

Userscript first — Violentmonkey/Tampermonkey, single file, no build step, trivially
auditable by anyone (which matters for clause 6's disclosure requirement). A DevTools
snippet is fine for throwaway inspection. An extension is only worth it if we outgrow
the userscript sandbox, and it raises the disclosure bar. Note that the app is an
installable PWA — check whether userscripts run in the installed-standalone window, or
only in a normal tab.
</content>
