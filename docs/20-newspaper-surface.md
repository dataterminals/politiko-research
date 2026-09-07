# Newspaper surface — the government's own change log, on a 60-second poll

Measured **2026-09-04**, entirely from the client bundles already on disk from the
**2026-09-03** `tools/fetch-bundles.ps1` run. **Zero requests were made to politiko.io in
the course of writing this** — no endpoint was called, probed, or re-fetched, and no page
was opened. Everything below is what the *client expects*, read out of its own code; where
a real capture later contradicts a shape here, fix it and say so.

Third of a set. [`13-world-politics-surface.md`](13-world-politics-surface.md) measures the
government as a **position**; [`14-government-motion-surface.md`](14-government-motion-surface.md)
measures it as a **trajectory**. This file measures the **record** — what the game itself
publishes about a change after it has happened, with the numbers attached.

> **Not the landing page.** `00-recon-baseline.md` records that the marketing site's
> "Herald front page" is hardcoded demo content. Nothing in this file comes from it.

## The finding that shapes everything

**`GET /newspaper` is already being polled every 60 seconds, on every screen, by default —
and the client renders three headlines out of it.**

The sidebar carries a **Herald card**. Its component lives in the main index bundle, not in
`NewspaperPage`:

```js
function ac(){
  let {data:e=[]} = Ue({ queryKey:[`newspaper`],
                         queryFn:()=>R.get(`/newspaper`),
                         refetchInterval:6e4 }),
      t = e.slice(0,3)          // ← three headlines. The rest is dropped on the floor.
  …renders e.metadata.category and e.metadata.headline only
}
```

What `e` actually holds is the full Congressional Record: **per-chamber yea/nay counts for
every bill, the outcome including presidential veto, and signed per-issue alignment deltas
after an election.** The card shows a category and a headline. Everything numeric is
fetched, cached under `['newspaper']`, refreshed twice a minute, and never drawn.

Both 13 and 14 close on the same open question — *"What moves a policy axis, and how
fast"* — and list it as unmeasured. **This is the feed that answers it, and it has been
arriving on the sidebar the whole time.**

## Measured

### The card is on by default, and the operator owns the switch

Sidebar composition is a client-side list reconciled against `/user/config/sidebar`
(the same endpoint `07-alignment-surface.md` records):

```js
oc = [ {key:`game_time`,…,kind:`card`}, {key:`status`,…}, {key:`money`,…},
       {key:`attributes`,…}, {key:`herald`, label:`The Herald`, kind:`card`},
       {key:`home`,…,kind:`nav`}, … ]
sc = { visible: oc.filter(e=>e.key!==`contacts`).map(e=>e.key), hidden:[`contacts`] }
```

**Every key except `contacts` is visible in the default config**, so `herald` is on unless
the operator turned it off. Five cards exist and the Herald is one of them. A tool that
depends on this feed depends on a switch the player controls, and should say so rather
than assume.

### `GET /newspaper` — the front page

`refetchInterval: 6e4` in **two** places: the sidebar card above, and `NewspaperPage`'s
front-page section. Returns a flat **array**, not an envelope:

```
[ { id, gametime, metadata:{ … } } ]
```

The client groups by `gametime` into editions and sorts descending. Within an edition it
splits on `metadata.category`:

| category | renderer | what it carries |
|---|---|---|
| `Congress` | Congressional Record | the vote table |
| `Supreme Court` | Supreme Court Watch | precedent prose, retirements |
| `World` | World Report | flavour, with a `spin` |
| anything else | plain article | **`congress_alignment_swing`** |

### The vote table — the whole point of this file

```
metadata  headline  body
          house_yea  house_nay  senate_yea  senate_nay
          outcome
```

An entry with `house_yea == null` renders `body` as prose instead; the table only appears
when the counts are there. The outcome vocabulary, from the client's own map:

```js
k = e => !e || e===`dead in Congress` ? `Dead in Congress`
       : e===`signed`           ? `Signed by President`
       : e===`vetoed`           ? `Vetoed`
       : e===`veto overridden`  ? `Veto Overridden`
       : e                                    // unknown values pass through verbatim
```

Two things worth having in writing:

- **A missing `outcome` renders as "Dead in Congress."** Absence and failure are drawn
  identically, so a tool storing this should keep `null` distinct from the string.
- **The success test is two values**: `outcome === 'signed' || outcome === 'veto
  overridden'` picks the green footer; everything else is red. So the client already
  models a **veto step after both chambers** — a bill can clear Congress and still not
  become law. `14` records the president's `favorability` and its impeachment string but
  had no evidence the president acts on legislation. This is that evidence.

The counts are printed raw, and the wiki says a bill passes when *the weighted vote count*
exceeds the threshold. **So the printed tally and the deciding number are not the same
number**, and a raw majority is not a guarantee. Nothing in the client exposes the weights.

### `congress_alignment_swing` — the election, itemised

On the non-Congress / non-Court / non-World entries:

```js
function M({swing:e}){ return e?.length ? …e.map(e => <span><strong>{e.label}</strong>
                       {e.delta>0?`+${e.delta}`:e.delta}</span>) : null }
```

`[{ label, delta }]` — a **signed delta per label**, rendered with an explicit `+` on
positives. This is the only place in the entire client where a *change* in the government's
alignment is published as a number rather than inferred by diffing two readings. `14`'s
change-ledger design exists precisely because nothing published deltas. Something does.

What the labels are is not readable from the bundle — the component prints whatever
arrives. Chambers, parties, and issues are all plausible.

### The calendar, and a December that runs to the 35th

```js
y = 31536e3   // 365 game-days — a game year, in game-seconds
b =  2592e3   //  30 game-days — a game month
x =    86400  //   1 game day

S = t => `${months[Math.min(Math.floor((t%y)/b),11)]} ${Math.floor((t%y - m*b)/x)+1}, Year ${Math.floor(t/y)+1}`
C = t => Math.floor(t/b) + 1        // "Edition No. N"
```

`gametime` on an entry is **game-seconds since epoch**, and the constants match
[`06-time-surface.md`](06-time-surface.md) exactly (30-day months, 365-day year, 52.14×).

Two consequences:

- **`Math.min(…, 11)` clamps the month but nothing clamps the day.** Twelve 30-day months
  cover 360 of 365 days, so the last five days of every game year render as
  **"December 31, 32, 33, 34, 35."** Reproduced from the arithmetic, not observed on
  screen — but it needs no server behaviour to happen.
- **Edition No. is a game-month index.** `06` already records the newspaper as one edition
  per game month from the wiki; this is the client computing the same thing from a
  timestamp. See *Inferred* for what it might be worth against `next_cycle_month`.

### `GET /newspaper/local` — the city desk

`refetchInterval: 6e4`. A composed front page for the city you are standing in:

```
edition   { paper, motto, domain, edition_no, display_date, is_carryover }
location  { name, … }
articles  [ { id, kind, section, headline, subhead, body, byline, art_key } ]
```

`kind` selects the layout — `lead` (three-column with drop cap), `brief`, `pullquote`;
the client falls back to `articles[0]` when no `lead` is present. `art_key` picks one of
three inline SVG engravings (`factory`, `badge`, and a crowd default) — decoration, not
data. `section` is free text printed as a kicker.

**`is_carryover` is the honest field here.** When true the masthead prints *"Latest
available issue"* instead of the motto, so a local edition can be stale and says so. A
reader that ignores it will happily timestamp last month's paper as today's.

The whole section fails gracefully to *"Local desk unavailable from your current
location"* — so it is location-scoped, and `13`'s six drawable cities are the likely
ceiling on how many papers exist.

### `GET /newspaper/bounties` — and a location leak

`refetchInterval: 15e3`, paged: `?page=N`.

```
bounties [ { id, target_username, amount, remaining_count, total_count,
             anonymous, placed_by, target_status, target_location,
             claim_blocked_reason, can_claim } ]
total  total_pages  minimum_amount  open_bounties_placed  max_open_bounties_per_player
```

**`target_location` prints the target's current city.** `05-people-surface.md`'s 2026-08-14
field check found profile `location` sealed behind the Privacy Rights policy axis and
arriving for nobody; `13` records the same. A bounty listing prints it anyway, for an
arbitrary player, alongside `target_status`. Whether that is a deliberate exception or an
oversight is not ours to decide — but per **hard rule 5** it is worth noting that this is
a *disclosure asymmetry in a shipped screen*, not something a tool would have to reach for,
and nothing here probes it further.

The cost arithmetic is client-side and hardcoded:

```js
fee   = Math.ceil(amount/2)
anon  = anonymous ? Math.ceil(amount/2) : 0
total = (amount + fee + anon) * count
```

A **50 % listing fee, doubled to 100 % for anonymity.** Claiming POSTs
`/newspaper/bounties/{id}/claim` and routes to `/combat/{session_id}`.

This repo sends neither POST. Both shapes are recorded from the client's own mutation
definitions.

### The three classified sections

All `refetchInterval: 3e4`, all thin:

| endpoint | key | row |
|---|---|---|
| `/newspaper/job-listings` | `listings` | `{ id, corporation_id, corp_name, position_name, body }` |
| `/newspaper/classified-ads` | `ads` | `{ id, body, posted_by }` |
| `/newspaper/personals` | `personals` | `{ id, body, posted_by }` |

Player-authored text with an author link, and a `manage` / `post` route pair each
(`12-navigation-surface.md` already lists the three `newspaper/*/manage` routes).

### `GET /news` is not the Herald

`NewsPage` is a 2 KB file fetching `/news` with **no polling** and returning
`{ entries: [{ id, headline, summary, body, author, created_at }] }`. `created_at` is a
**real** date, formatted with `toLocaleDateString`. This is developer patch-notes. It
shares a word with the Herald and nothing else; do not join them.

### Opening these pages POSTs — and 13 has this wrong

`NewspaperPage` and `GovernmentPage` both do this on mount:

```js
NewspaperPage   f(`tier1_read_newspaper`)      // f from useMissions
GovernmentPage  x(`tier1_view_government`)     // x from useMissions
```

That hook is **not a feature check**. `useMissions` exports three things, and this is the
third:

```js
function d(e){ useEffect(()=>{ e && i.post(`/missions/${e}/ack`,{})… },[e,t]) }
```

**It fires `POST /api/missions/{key}/ack`.** So `13`'s line — *"Gated by a
`tier1_view_government` feature check"* — is wrong on both halves: nothing is gated, and it
is a write, not a check. Corrected in `13` with a pointer here.

Consequence worth carrying: **navigating to Government or the Newspaper causes a POST.**
The app does it, not us, and an operator pressing `gov-watch`'s jump button is still the
operator taking an action — but "this tool only causes GETs" would be false if anyone
wrote it, and now nobody will.

### Nothing crosses the socket

`09-socket-surface.md` records no newspaper, Herald, congress, bill or edition event, and
the current bundle adds none. **Every observation here is a poll the app already makes** —
which is what makes this passive, and also why it can never be complete.

## Inferred

Everything in this section is ours. None of it is something the client does.

- **Edition No. and `next_cycle_month` are the same counter.** `14` infers the Congress
  cycle is a game month and calls that its single most load-bearing unmeasured claim. The
  Herald computes `Edition No. = floor(gametime / 2592000) + 1` from a server timestamp,
  and `06` records one edition and one bill session per game month. **If both are true the
  two numbers should differ by a constant** — so the measurement `14` has been waiting for
  is *reading the sidebar and the faction jobs header on the same screen and subtracting*.
  Zero requests, one look. Recorded as the check, not as the result.
- **An edition boundary is a Congress resolution.** Entries group by `gametime` and the
  Congress category carries the vote. A new `gametime` appearing in the array is therefore
  the cheapest possible detector that a cycle has resolved — cheaper than watching
  `next_cycle_month` roll over, because it arrives on every screen rather than on the
  faction tab.
- **`spin` has at least two values and the client reads one.** The test is
  `spin === 'liberal' ? blue ◀ : rose ▶`, an equality with a trailing else — the same
  shape as `factionUtils`'s label chain in `14`, and with the same failure mode. Any value
  that is not the string `liberal` renders as its opposite. `conservative` is the obvious
  guess and is a guess.
- **The printed tally is not the deciding number.** Stated above; repeated here because a
  ledger that stores yea/nay and calls it the margin will be wrong about close votes in a
  chamber with extremists in it.

## What this makes buildable

**`herald-watch`** — a ledger of the Congressional Record, built the way `gov-watch` and
`xp-watch` are built: read the response the app already fetched, store it, diff it, print
the history the game refuses to keep.

What it would carry that no screen does:

- **Every bill, forever**, with both chambers' counts, the outcome, the edition, and the
  game date. The front page keeps what the server sends; there is no archive and no search.
- **A pass-rate table per policy axis** — which issues come to a vote, how often, and how
  they die. That is the empirical answer to *"what moves a policy axis"*, accumulated
  rather than derived.
- **`congress_alignment_swing` kept across elections**, which is the only published
  measure of whether a campaign of activism did anything.
- **A margin column** — `218 − house_yea` and `51 − senate_yea` — so "close" and
  "hopeless" stop looking alike.

It costs **zero added requests**: the sidebar card is fetching this every 60 seconds
already. If the operator has the Herald card hidden the tool has no feed, and it must say
so in the panel rather than silently showing an empty ledger.

Constraints it inherits, not negotiable:

- **No refresh.** The 60-second poll is the app's; the tool never originates one, and the
  panel prints each row's age instead.
- **Every row is a bracket.** Same rule as `14`. A tool that only sees the array cannot
  know when inside the last 60 seconds an entry appeared, and must not print a time as
  though it does.
- **The panel is the standard one.** `PANEL KIT v2`, `FAB KIT` slot, fixed table layout —
  a bill table is exactly the wide-in-a-narrow-margin case the convention exists for.

## Still unknown

- **What `congress_alignment_swing`'s labels are.** Chambers, parties, issues — the
  component prints whatever arrives and the bundle names nothing.
- **How many entries `/newspaper` returns, and whether it is capped or windowed.** The
  client slices three for the card and renders all of them on the page, with no paging
  control. A server that returns only the current edition and one that returns a year look
  identical from here.
- **Whether `/newspaper` is enforced server-side.** The mission ack is not a gate, and no
  other check appears; whether the endpoint itself is open is not knowable without calling
  it, which we do not do.
- **The weights.** A bill passes on weighted votes and only raw counts are published.
- **What the non-`liberal` `spin` value is.**
- **Whether local editions exist for all cities or only some**, and what drives
  `is_carryover`.
- **Whether the December 31–35 overflow is visible in play.** It is five game days a year,
  about 2¼ real hours a week, and needs someone looking at the masthead in that window.

## Method disclosure

- Local grep and de-minification of bundles pulled once on 2026-09-03. No new pull, no page
  opened, no endpoint called.
- Zero requests to politiko.io: none authenticated, none public, none to `/api/*`.
- No bounty was placed or claimed, no listing, ad or personal was posted. Those POST shapes
  are recorded from the client's own mutation definitions.
- No userscript was written or run against anything for this file.
