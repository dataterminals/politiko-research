# userscripts

Every browser-runtime tool in this project ships from this directory. Each one is a single
file you can read end to end, and each one states in its own header comment exactly what it
reads, stores, and sends — Politiko's scripting clause makes undisclosed functionality
bannable, so the disclosure block is the contract.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open the raw link for the tool you want and confirm the install prompt.

| tool | version | raw link |
|---|---|---|
| People Watch | 1.3.1 | [`people-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/people-watch.user.js) |
| Market Watch | 1.0.1 | [`market-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/market-watch.user.js) |
| Time Watch | 0.4.0 | [`time-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-watch.user.js) |
| Align Watch | 0.2.0 | [`align-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/align-watch.user.js) |
| Comms Move | 0.1.0 | [`comms-move.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/comms-move.user.js) |
| Time Bridge | 0.1.0 | [`time-bridge.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-bridge.user.js) |
| WS Watch | 0.2.0 | [`ws-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/ws-watch.user.js) |
| XP Watch | 0.2.7 | [`xp-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/xp-watch.user.js) |
| Raid Watch | 0.1.0 | [`raid-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/raid-watch.user.js) |

`_template.user.js` is not installable — it's the skeleton the others were built from
(passive tap, SPA awareness, the shared `PANEL KIT` block).

All of them declare `@updateURL`/`@downloadURL` pointing back here, so **shipping a fix means
bumping `@version`** — a script manager only acts on an increase.

Panels drawn over the game are draggable and remember where you put them. `PANEL KIT` is
copied verbatim into each tool rather than pulled from anywhere at runtime, so every script
stays one auditable file.

XP Watch's panel is also **resizable**, which is a local addition sitting *around* its
verbatim `PANEL KIT v1` block rather than a change to it — changing the kit means bumping
its version in all seven copies. If resizing proves worth having everywhere, that is the
`PANEL KIT v2` candidate; the local implementation is deliberately small (a CSS
`resize: both`, plus persistence and a double-click reset) so it ports cleanly.

---

# People Watch

Builds a local ledger of the players you look at — last-online times, ranks, combat records —
and sorts it least-active-first.

It is **fully passive**. It reads responses the game already made, on pages you are actively
viewing, and originates no requests of its own.

## What it's for

The game rounds "last seen" to whole days in the UI, but the API sends exact timestamps.
This keeps the exact values and ranks by them, so you can tell six days idle from six hours.

It also computes something the UI can't show at all: the gap between `created_at` and
`last_online`. Someone who played for 39 minutes and quit, and someone who played for three
weeks and then stopped, both render as "4 days" in game. A `◦` next to a name means their
entire account lifetime was under two hours — they never really engaged.

## How to use it

**Alt+P**, or click the triangle button, to open the panel. Drag either wherever you like;
they remember.

The header shows two numbers — `12/292 profiled · 40 known`:

- **known** — usernames it has seen on roster pages (the People tab)
- **profiled** — players it actually has data for

Only profiled players appear in the table. A username on its own gives it nothing to rank.

So the loop is:

1. **Open the People tab and page through it.** Every page is captured for free — that's
   `known` climbing, and it's what the walk below needs.
2. **Open profiles.** Each one you open is recorded permanently, at full precision.
3. **Walk the roster.** On any profile page the panel grows a walk bar:

   | control | does |
   |---|---|
   | `‹ [` | previous player in the roster |
   | `] ›` | next player |
   | `next unseen ›` | skip ahead to someone with no profile yet |

   The `[` and `]` keys do the same thing without the panel open, so a pass through the
   roster is one keypress per player. They are ignored while you are typing, so chat
   still works.
4. **Read the table.** Sort **most idle**, set **≥7d idle**, tick **hide npc** and
   **hide online**. Player names are links — click one to jump straight there.

Each step is a normal navigation. The game fetches that profile exactly as it would if you
had clicked the player yourself, and the tap records what comes back.

## The table

| column | what it is |
|---|---|
| player | name, `◦` if they never engaged; click to open |
| idle | time since last online — exact, not the game's rounding |
| city | where they were, and whether they still are — see below |
| social | social-issue actions they have logged; hover for the economic count too |
| rank | their `rank_key` |
| W-L | attacks won–lost, so "worst record" finds people who lose |
| seen | how stale *your* copy of their profile is |

### City, and the ⇢ mark

Sort by it, or **group by city** to see the roster laid out by where everyone is.

A city arrives from either of two places the game already sends, whichever is fresher:

- **the profile you open** — `location`, one player at a time, same as every other
  profile field
- **roster pages** — `location_name`, **ten at a time, for free**, but only while the
  server is showing locations (`locations_visible`)

### ⚠ Both are sealed right now (field-checked 2026-08-14)

**Profiles return no `location` at all**, and the game's own profile screen says so — the
location box reads `UNAVAILABLE` over `[ signal lost ]`. The roster's
`locations_visible` was `false` when the surface was first measured in July.

This is a **world government policy gate**, not a bug and not something the tool can work
around. Politiko has 20 policies on a −3..+3 axis, one of which is **Privacy Rights** —
the same family of gate that seals the profile stats tab, where the client spells out its
thresholds (`requires 3` for stats, `requires 2+` for holdings). For location the server
just omits the field rather than announcing a threshold, so **the exact number it opens at
is not knowable from the client** — only that it is currently shut. Check the Government
page for where the Privacy Rights axis actually sits.

The column is therefore built and correct but blank, and the panel's footer says which
situation you are in rather than pretending browsing will fix it:

| footer | means |
|---|---|
| `cities: none yet` | you haven't opened a profile or loaded a roster page |
| `cities: sealed — N profile(s) read, none carried one` | you looked; the server sent nothing |
| `cities: N recorded · roster is showing them` | the fast path is open — page People |
| `cities: N recorded · roster is hiding them` | profiles only, one at a time |

If the axis moves, the column fills in on its own with no change to the script.

The mark matters. `status` distinguishes six states, one of which is `traveling`, and the
roster restates it on every page you turn:

| cell | means |
|---|---|
| `Miami` | in Miami as of the reading — hover for how old that is |
| `Miami ⇢` | **in transit.** Miami is where they *left from*, not where they are |
| `⇢ in transit` | travelling, and no city has ever been recorded for them |
| `—` | no city recorded — open their profile, or page the roster |

A traveller keeps their last city for grouping, because that's the only bucket the ledger
can honestly put them in — but the row never prints a bare name that would read as
current. Same rule as **active now**: the panel doesn't assert what it can't support.

**Social actions** come from `alignment.social_count` — the same number the profile screen
prints as "N actions" beside the compass. It is the only measure of activity *volume* the
API exposes anywhere, so "most social actions" is the closest thing to sorting by who is
actually playing the political game rather than merely logging in. `—` means you have not
observed that player since this existed, which is not the same as zero and does not sort
like it.

**Grouping** buckets the list by faction or corporation, largest group first, with anyone
whose membership you have not recorded last. Membership arrives with the profile, so the
same rule applies: open a profile and it fills in.

**Click any header to sort by it; click it again to flip the order.** The dropdown does the
same thing and stays in sync with the headers, and the button beside it reverses whatever is
currently selected. Each sort's natural order matches its label — "most idle" puts the most
idle first, "name" goes A→Z — and reversing flips that, which is why one toggle works across
columns that don't share a direction.

### "Active now", and what it can honestly tell you

There is no presence feed. `is_online` is a claim about *this moment* taken from an
observation made whenever you last opened that profile, so it decays: someone marked online
three days ago is just someone who was online once.

The **active now** sort ranks by how much the ledger can actually support:

1. seen online, and seen within the last five minutes
2. seen online, but a while ago — no evidence about now
3. not flagged online, but their `last_online` is within minutes
4. everything else, most recent first

Only the first tier is shown as a green **● online** in the idle column. The second tier
sorts high but still displays plain idle time, because claiming otherwise would be inventing
a fact. If you want this to mean something, walk the roster first — the readings are only as
current as your last pass.

## Console

```js
__pkpw.unseen()    // usernames known but not yet profiled
__pkpw.rows()      // the table, as data
__pkpw.export()    // the whole ledger as JSON
__pkpw.clear()     // wipe it
```

## What it reads

Full disclosure — reads, storage, network — is in the header comment at the top of
[`people-watch.user.js`](people-watch.user.js). In short: it reads `/api/people` and
`/api/users/<name>` responses the game itself requested, stores them under `pkpw:` keys in
your browser, and sends nothing anywhere.

**The ledger holds other players' public profile data.** It never leaves your browser and
must not be committed anywhere.

## History

Versions up to 0.4.0 shipped an opt-in crawler that originated paced requests to fill the
ledger automatically. Politiko's scripting clause prohibits that and the penalty is a game
ban; it was carried as a knowingly accepted risk.

**It is gone as of 1.0.0** — the arming system, the queue, the pacing and every
request-originating line were removed rather than disabled. The walk replaces it, and the
walk is just you pressing a key.

---

# Market Watch

Records numeric series out of market responses the game client already fetched, charts them
in-page, and raises alerts when something moves.

## What it does

- **Builds history.** The game shows you a number now; this keeps the series, so you can
  see where it came from.
- **Charts it in-page**, including sparklines beside the headline figures.
- **Alerts** on absolute thresholds, percentage moves, and rate-of-change — in-page only,
  and only while the tab is visible. Alerts raised while the tab is hidden are queued and
  shown when you come back.
- **Derived views** over the recorded history.

Everything is computed and stored locally in your browser.

## Buy and sell rules — what they actually do

A rule can carry a trade intent (*sell everything*, *buy $1000 worth*). **It will not place
the order.** Nothing in this script can, and there is no switch that changes that.

When such a rule fires you get an alert that has already done the arithmetic — sized against
your holdings as they stand that second, so a sell is capped at what you actually hold — and
a button. The button takes you to the stocks screen, selects the ticker, and fills in the
size. You place the trade, using the game's own controls.

That last hop is deliberate. Sizing a trade is arithmetic on data the game already sent you;
placing one is a request, and this script does not make requests.

## What it reads

Full disclosure — reads, storage, network, alerting — is in the header comment at the top
of [`market-watch.user.js`](market-watch.user.js). Read it before installing. In short: it
taps GET responses the app requested on its own, originates nothing, keeps everything in
local storage, and sends nothing anywhere.

## History

Versions up to 0.11.0 carried an order-execution seam: `registerExecutor()`, an arming
switch, a session cap, and a capture of the app's own write requests so the order shape
could be learned from a trade you placed by hand. Wiring it would have made this script
originate write requests, which Politiko's scripting clause prohibits under penalty of a
game ban. It shipped disabled and was never armed.

**As of 1.0.0 it is deleted** — the seam, the arming, the capture and the learned routes are
gone rather than switched off, and `tools/test-market-passive.js` fails the build if any of
it comes back.

---

# XP Watch

Tracks what your stats and skills actually gained, action by action where the data honestly
allows it. Built for one request: *"how much XP I'm receiving from different actions in
whatever skills it's affecting — the individual gain from doing something"* — not the
period totals the home page's dossier shows.

It is **fully passive**. It reads responses the game already made, on pages you are
actively viewing, and originates no requests of its own.

## The one thing to understand before using it

The game refreshes no skill data after a crime — its own UI cannot show you what a car
theft trained (the client's live own-stats query was deleted; see
[`docs/10-xp-surface.md`](../docs/10-xp-surface.md)). So the tool works by diffing
readings, and readings only arrive where you navigate:

- **HOME — the one that matters.** The dossier carries **all 37 stats and skills, live**
  (field-verified 2026-08-11), refetched every time you land on home and every time the
  window regains focus while you're there. This is the primary source.
- **the TRAIN page** — live values, but only for what your **current city** trains
  (target lists are location-based; a no-city location offers Heart alone).
- **your own profile → STATS tab** — same mechanism, but currently **sealed for
  everyone, including on your own profile**. That's a government policy gate, not a bug:
  a stat sheet needs the world's privacy Rights axis at **3** (holdings need 2+), and it
  sits at **0**. The panel says so, with the live number, if you hit it. You don't need
  this page — home covers everything it would.

So the workflow is a **sandwich**: glance at home, do the thing, glance at home. Every
one of those fetches is a navigation the game performs because you asked for that page;
the panel just diffs what arrives.

## What a delta gets labelled

| label | meaning |
|---|---|
| `train` | measured — the train response states its own `gain`, exact to 4 decimals |
| `education` | a course completion's declared reward, matched to the catalog |
| an endpoint | **exactly one** action sat in the window between two readings — honest per-action XP, and the per-action averages are built only from these |
| `passive` | no action in the window; labelled `jailed`/`traveling` when the status poll saw one (street sense ticks in jail) |
| `ambiguous ×N` | N actions in the window. Kept and shown, **never averaged into per-action stats** — grind blocks between two distant readings land here, which is correct |

**Grinding one action type in a block is a valid measurement**, not a spoiled one. If
every action between two readings is the same one, the total belongs to it and the
per-attempt figure is total ÷ N — shown as `disobedience ×3 (avg)`. Only *mixing*
different actions in a window costs you the split, and that shows as `ambiguous`.

That's how the first number this tool ever measured came out of ordinary play: **+0.02
persuasion and +0.02 street sense per civil disobedience.**

Want one attempt pinned exactly? home → one theft → back to home — one navigation per
measurement, same spirit as People Watch's roster walk. Because the dossier is
full-width, a single sandwiched action reports **every** skill it moved, not just the
ones your city happens to train.

**copy report** (no console needed) produces a paste-ready summary for the crew: the
train targets your current city offers with values and predicted gains, **stamped with
the city and theme** — paste one from each city and the crew maps which city trains
what — plus sheet status and a key-name digest of sampled action responses. It carries no
username and no values from those samples.

## The panel

**Alt+X**, or the `XP` button. Drag either anywhere; they remember. **Drag the panel's
bottom-right corner to resize it** — that sticks too. Double-click the panel's title bar
to put both the position and the size back to default. Sections: the latest
deltas with their labels, per-skill session/all-time totals with last-known values, and
per-action-endpoint attempts / outcomes / measured-XP-per-attempt.

Buttons: **home ↻** (takes a reading — same client-side navigation as clicking Home in
the game's nav), export (JSON), **copy report** (paste-ready diagnostic — train targets
with values and predicted gains stamped with your city, sheet status, and a key-name
digest of sampled action responses; no username, no sample values), copy tsv (delta
history), clear.

If you take actions without a reading after them, the panel says so — *"3 actions not
measured yet"* — because a gain only becomes a number once a reading closes the window.
Nothing is lost; click **home ↻** and it resolves.

## What are the home page's little green arrows?

Nobody knows yet, and the tool is now running the experiment. The dossier's `change`
column is captioned as "since the last assessment", but that caption is doing no work —
the same card's framing already misled us once about whether its numbers were live.

So after any gain, two visits to home tell you which it is, printed in **copy report**:

- **RUNNING** — the arrow moved by exactly what you gained, so it's a running total
  against some baseline. If that baseline is a rolling in-game year — one game year is
  exactly one real week — then a gain should silently *drop out* of the arrow about seven
  real days later. Watch one number for a week and you'll know.
- **FROZEN** — the arrow ignored your gain, so it really is period data and the caption
  was honest.

## The second job: finding out what crime responses really carry

No crime response contains any skill field **the client reads** — but both previous
passive captures (see ws-watch) found the wire wider than the reader, and so did this one.
The tool keeps up to 3 scrubbed samples per action endpoint, and **copy report** prints
their field names with numeric and boolean values (strings and objects stay names-only,
since that's where usernames and flavour text live).

That already paid off. Real payloads seen 2026-08-11:

- **`/disobedience` carries `mastery`** — the same 0–100 score the activism screen shows
  you ("your mastery N / 100", *learning* under 35, *practiced* 35–59, *fluent* 60+). The
  game shows the number but never the **rate**, so the panel tracks attempts between
  increments and tells you roughly how many more actions stand between you and *fluent*.
- **Both carry a plain `success` boolean**, so failed attempts are now recorded as such
  (`fail+hospitalized` is distinct from `fail`) — which makes "does failing still pay
  XP?" a question you can just read off the actions table.
- **`/actions/graffiti` carries a `breakdown`** with `roll`, `difficulty`,
  `arrest_chance` and `mob_chance` — the server hands the client its own odds and the
  realised dice roll, and the game shows you none of it.

## Console

```js
__pkxw.export()    // everything, as JSON
__pkxw.deltas()    // the delta rows
__pkxw.samples()   // raw action-response samples (scrubbed)
__pkxw.ledger()    // full state
__pkxw.clear()     // wipe it
```

## What it reads

Full disclosure — reads, storage, network — is in the header comment at the top of
[`xp-watch.user.js`](xp-watch.user.js). In short: it reads your own
`/api/users/<you>/stats`, `/api/train`, `/api/education*`, `/api/user/status`,
`/api/user/progression` responses and the responses of actions you submit, stores your
own numbers under `pkxp:` keys in your browser, ignores other players' data entirely,
and sends nothing anywhere.

---

# Raid Watch

Records faction raids — the score curve, the event log, and who actually did the work.

It is **fully passive**, and here that claim carries more weight than usual: the raid
surface has four write endpoints sitting directly beside the two reads (`cease`,
`surrender`, `accept-surrender`, `flag-override`). **This script cannot call any of them.**
There is no arming switch and no seam where one could be added quietly;
`tools/test-raid-passive.js` fails the build if any of those paths, any non-GET verb, or
any self-rearming timer ever appears in the file.

## Why this one is unusually cheap

The faction page **polls its own raid list every five seconds** while you have it open —
`/api/factions/<id>/raids?events_page=N&events_limit=5`, `refetchInterval: 5e3`. That is
the game fetching, not us. Sitting on that page during a raid hands the tap a live feed of
the whole fight at five-second resolution, for free.

So there is nothing to *do*. Open the faction page and leave it open. The panel fills in.

## What it's for

The client renders `event_type.replaceAll('_', ' ')` and has **no label map, no colour map,
no switch** — it prints whatever string the server sends. So unlike the player `status`
enum, which was sitting in the bundle all along, **the raid event vocabulary cannot be read
out of the client at all.** It can only be learned by watching raids happen.

The **event types** tab is that tally: every distinct `event_type` seen, how often, the
score and power it moved, how many of them actually scored, and how many different players
produced it. That table is the research output.

## The panel

**Alt+R**, or the `RAID` button. Drag either anywhere; they remember.

| tab | what it shows |
|---|---|
| event types | the vocabulary, with counts and summed deltas — the point of the tool |
| log | every deduplicated event, newest first, with actor and target |
| curve | two-line score chart for one raid, plus its power and commitment figures |
| who | per-player contribution, ranked by score, from event attribution |
| raids | every raid seen, its status, and whether a report was captured |

## Two captures, worth different things

- **A finished raid, from its report page.** `/raids/<id>/report` survives the raid and
  carries the server's own `score_history` — authoritative, and it does not decay. This is
  what answers *what are the event types*.
- **A live raid, from the 5s poll.** Finer than the server's history, and every event as it
  lands rather than five per page. This is what answers *how does scoring work*.

The curve says which one it is drawing. A **sampled** curve is only as dense as the time you
had the page open; a **report** curve is the server's own. And one reading is never drawn as
a line — the game itself synthesises a single point when it has no history, and a
one-point "curve" is a fiction worth naming.

## Score samples are changes, not polls

A sample is appended only when a score actually moves. Recording one per poll would bury
twelve identical points a minute and turn the curve into a clock.

## Console

```js
__pkrw.types()     // the event-type digest
__pkrw.who()       // per-player contribution
__pkrw.events()    // the deduplicated log
__pkrw.raids()     // raids with their score samples
__pkrw.digest()    // the paste-ready summary, no usernames
__pkrw.export()    // everything, as JSON
__pkrw.clear()     // wipe it
```

## What it reads

Full disclosure is in the header comment at the top of
[`raid-watch.user.js`](raid-watch.user.js). In short: it reads two GET responses the game
already made, stores them under `pkrw:` keys in your browser, and sends nothing anywhere.

**The event log and member rosters hold other players' usernames and their contribution to
a fight.** That never leaves your browser and must not be committed. `copy digest` is the
shareable output and carries **no usernames** by construction — vocabulary and totals only.

Surface notes and what was inferred rather than measured:
[`docs/11-faction-raid-surface.md`](../docs/11-faction-raid-surface.md).

---

## Tests

Run from the repository root:

```bash
node userscripts/tools/test-people.js
node userscripts/tools/test-placement.js
node userscripts/tools/test-market-passive.js
node userscripts/tools/test-harvest.js
node userscripts/tools/test-sizing.js
node userscripts/tools/test-views.js
node userscripts/tools/test-passive.js
node userscripts/tools/test-bridge.js
node userscripts/tools/test-xp.js
node userscripts/tools/test-raid.js
node userscripts/tools/test-raid-passive.js
```

Every suite slices the layer it covers straight out of the shipped script rather than
copying it, so the tests cannot drift from what installs.

Two of them are **fences** rather than behaviour tests — they read the shipped file and fail
if something that could originate a request has reappeared, because "we removed it" stays
true only until someone adds it back:

- `test-market-passive` fences market-watch's deleted order-execution seam.
- `test-passive` fences ws-watch, which replaces `window.WebSocket` and is therefore
  structurally one line away from being a bot. It also drives the tap's behaviour.
- `test-raid-passive` fences raid-watch, which reads a surface whose write endpoints
  surrender wars and impose flags. It fails on any mention of those paths, any non-GET
  verb, and any timer body that touches the network — the two ways to build a poll are
  `setInterval` and a `setTimeout` that re-arms, and both are barred.

They have nothing else in common; market-watch's was named `test-passive.js` when it
lived in its own repository and was renamed on the way in.

`test-placement` also checks that **`PANEL KIT v1` is byte-identical across all eight
copies**. The convention was written down in CLAUDE.md from the start and enforced by
nobody, which is how seven hand-maintained copies of a drag implementation quietly
diverge. Now a mismatch fails the build and prints which files disagree.

`test-people` covers people-watch's walk layer — where a keypress sends you, and which
players `next unseen` is allowed to skip — plus the derived metrics. An off-by-one in the
walk means silently missing a player on a list you are stepping through by hand.

`test-placement` covers the panel placement layer against a synthetic viewport: the button
stays on screen and clear of the game's Comms dock, and the panel stays fully visible from
whichever corner the button was dragged into.
