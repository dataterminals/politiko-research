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
| People Watch | 1.7.0 | [`people-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/people-watch.user.js) |
| Market Watch | 1.2.0 | [`market-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/market-watch.user.js) |
| Time Watch | 0.7.0 | [`time-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-watch.user.js) |
| Align Watch | 0.5.0 | [`align-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/align-watch.user.js) |
| Comms Move | 0.1.1 | [`comms-move.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/comms-move.user.js) |
| Time Bridge | 0.1.0 | [`time-bridge.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-bridge.user.js) |
| WS Watch | 0.6.0 | [`ws-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/ws-watch.user.js) |
| XP Watch | 0.5.0 | [`xp-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/xp-watch.user.js) |
| Raid Watch | 0.4.0 | [`raid-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/raid-watch.user.js) |
| Sleeper Watch | 0.4.0 | [`sleeper-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/sleeper-watch.user.js) |
| Quick Jump | 0.4.0 | [`quick-jump.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/quick-jump.user.js) |
| World Watch | 0.3.0 | [`world-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/world-watch.user.js) |
| Gov Watch | 0.2.0 | [`gov-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/gov-watch.user.js) |
| Poll Watch | 0.1.0 | [`poll-watch.user.js`](https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/poll-watch.user.js) |

`_template.user.js` is not installable — it's the skeleton the others were built from
(passive tap, SPA awareness, and the shared `PANEL KIT` and `FAB KIT` blocks).

All of them declare `@updateURL`/`@downloadURL` pointing back here, so **shipping a fix means
bumping `@version`** — a script manager only acts on an increase.

Panels drawn over the game are draggable **and resizable**, and remember both. `PANEL KIT`
is copied verbatim into each tool rather than pulled from anywhere at runtime, so every
script stays one auditable file.

Resize was XP Watch's local addition for six versions; `PANEL KIT v2` is that idea promoted
into the shared block, so every window in this directory now has it. Grab a panel's
**bottom-right corner**; **double-click its title bar** to put position *and* size back to
default, which is the recovery path for a panel dragged or resized into uselessness.

The kit's `resizable()` arms the browser's own grabber rather than shipping a second drag
implementation, and does three things around it that the local version did not:

- **Pins the panel to left/top before the grab.** The UA grabber only ever grows a box down
  and to the right, so a panel still sitting on its CSS `right`/`bottom` corner grew *away*
  from the pointer. That was live in XP Watch the whole time and is the bug that made this a
  kit change rather than a copy-paste.
- **Caps growth at the viewport, not at the panel's own `max-height: 74vh`** — that cap
  silently outranks a chosen height, so the panel stops growing while the pointer keeps going.
- **Ignores a ~zero viewport**, which is what a minimised window or a hidden tab reports.
  Capping against it would shrink the panel to nothing and the next save would make it
  permanent — the same trap `viewportUsable()` guards in the placement layers.

Two windows sit outside that: **Market Watch** keeps its own corner grips, because its panel
is pinned to its button and has to grow from whichever corner is free; and **Comms Move**
resizes nothing, because the window it moves is the game's Comms dock, and sizing that means
overriding the game's own collapse behaviour — a larger claim than "this tool only
repositions". `tools/test-placement.js` encodes both exceptions by name.

## The buttons

`FAB KIT v3` is the same idea applied to the toggle button — the one part of any of this a
player sees before they open anything. Install four of these tools and four buttons land on
your screen, so they are a set rather than each tool's own flourish: **one 38px square, one
three-or-four-letter word, all of them in one row.** (The row, and which button is which,
is the table further down.)

**People Watch is the one exception**, and it is grandfathered: it wears the eye of
providence, which has been its mark since 1.0. Everything else about it is the kit — same
square, same border, same behaviour. A second symbol button and the set stops reading as a
set, so the check in `tools/test-placement.js` names people-watch and nothing else.

Before the kit each tool had picked its own button: three different sizes, two different
shapes, and four emoji rendering at the mercy of whatever font the platform handed them. A
glyph at 15px is a coin toss, and four of them tell you nothing about which is which.

What each tool still owns is its slot in the row and its own **state colour** — Sleeper
Watch's button goes green when a meeting is open, Market Watch's goes red when a live order
is armed, WS Watch's goes green when a capture finishes. Those layer on top of the shared
box; nothing redraws it, and the test fails the build if anything tries.

**A button is filled while its own panel is open** — that is what v2 added. Every panel here
remembers whether it was open, so on a fresh tab several of them come back up at once, and
until now the row of buttons was the one thing that could not tell you which. You found out
by clicking one and watching it close.

The fill is the *only* thing the shared block claims for the open state, and that is
deliberate: a tool's state rule comes after it and wins on the border and the text, so an
open Sleeper Watch still reads green and an open Market Watch still reads red. Both still
read as open. It costs the state colour some contrast while that panel is up — red goes from
about 4.7:1 to 2.8:1 — and the darker fill that buys it back stops reading as filled at 38px
at all. Both were rendered against a stack of buttons before this one was picked.

**They all start in one row now, and that is what v3 added.** Until v3 each tool picked its
own corner, so eleven tools meant eleven buttons scattered down both edges of the screen in
an order nobody chose — finding the one you wanted meant remembering which corner that tool
had claimed. They now default to a single line across the band above the game's header rule,
which on any desktop layout is empty screen between the nav links and the account menu:

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| 👁 | `ALGN` | `GOV` | `JUMP` | `MKT` | `RAID` | `SLP` | `SOCK` | `TIME` | `WRLD` | `XP` |

The eye leads because it is the mark of the set; the words are alphabetical after it. Slots
are **fixed rather than packed**, which is the point — installing an eleventh tool does not
shuffle the ten buttons you already know by position, and a tool you do not have simply
leaves its slot empty.

The row is 498px wide (eleven 38px buttons, 8px apart) and centred on the window, with a
floor at 440px so it stops sliding left rather than climb onto the game's own nav links.
Above about 1380px it is centred; between roughly 1090 and 1380 it sits at the floor; below
about 1090 the last few buttons run under the account menu, and below 768 the game swaps in
a different header entirely. Drag them out of the row on a window that small — that is what
dragging is for.

**Every one of them still drags anywhere and remembers, and a stored position always wins.**
Which is also the one thing to know when this update lands: a button you have already
dragged somewhere stays there. **Double-click a button to send it back to its slot** — that
is the only way in, and it is worth doing once per tool to line the set up. (Double-clicking
a *panel's* title bar is the separate, older gesture that resets that panel's position and
size.) Six of the eleven had no double-click at all before v3; they do now.

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

**Alt+P**, or click the **eye** button, to open the panel. Drag either wherever you like;
they remember.

The header shows two numbers — `12/292 profiled · 40 known`:

- **known** — usernames it has seen on roster pages (the People tab)
- **profiled** — players it actually has data for

Only profiled players appear in the table. A username on its own gives it nothing to rank.

So the loop is:

1. **Open the People tab and page through it.** Every page is captured for free — that's
   `known` climbing, and it's what the walk below needs.
2. **Open profiles.** Each one you open is recorded permanently, at full precision.
3. **Walk it.** On any profile page the panel grows a walk bar:

   | control | does |
   |---|---|
   | `‹ [` | previous player in the walk order |
   | `] ›` | next player |
   | `next unseen ›` | skip ahead to someone with no profile yet |
   | `⋮ roster` / `⋮ list` | which order those keys follow — click it, or press `\` |
   | `⟳` | *list only* — re-take the walk's copy of the list |

   The `[` and `]` keys do the same thing without the panel open, so a pass is one
   keypress per player. They are ignored while you are typing, so chat still works.
   There are two orders to walk and they are for different jobs — see below.
4. **Read the table.** Sort **most idle**, set **≥7d idle**, tick **hide npc** and
   **hide online**. Player names are links — click one to jump straight there.

Each step is a normal navigation. The game fetches that profile exactly as it would if you
had clicked the player yourself, and the tap records what comes back.

## Two ways to walk

`⋮ roster` / `⋮ list` in the walk bar decides what `[` and `]` mean. `\` toggles it from the
keyboard, and the choice is remembered.

| | `⋮ roster` | `⋮ list` |
|---|---|---|
| the order | the game's own pagination | whatever the panel is showing: your sort, your filters, your grouping, top to bottom |
| who is in it | every username seen on a roster page | only players you have already profiled |
| what it's for | filling the ledger | working a shortlist you built |

Roster order is the default, and it is the one that gets the ledger filled — it is the only
order containing players you have never opened. List order is for afterwards: sort **most
idle**, group **by city**, tick **hide online**, and `]` walks you down the people in one
city who have not logged in for a week, in the order you are looking at them. The row you
are standing on is marked in the table and scrolled into view as you go.

`next unseen ›` always walks the roster, whichever way the toggle is set. The list holds no
unprofiled players by definition, so asking it for one is an empty question, and the control
that fills the ledger should not quietly stop working because you sorted the table.

### The list moves; your place does not

Sort by **freshest data** and every profile you open jumps to the top, which would make `]`
bounce between two names forever. Tick **hide online** and opening someone who is online
drops them out from under you, leaving the next keypress nothing to count from. Even **most
idle** drifts on its own, because idle time is measured against now.

So the walk takes a copy of the order and counts along the copy. It re-takes the copy when
you change a control that decides the order — a different sort, a filter, the grouping — or
when you step back into the list from roster order, because those are you asking for a
different list. Anything else that moves the table leaves your place alone, and `⟳` turns
yellow to say the table has moved on without you. Press it when you want those changes
folded in; ignore it and keep walking if you don't.

Nothing about this is stored: a walk does not outlive a reload.

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
bottom-right corner to resize it** — that sticks too, and since 0.3.0 it grows toward the
pointer from the corner it starts in rather than away from it. Double-click the panel's
title bar to put both the position and the size back to default. Sections: the latest
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

# Sleeper Watch

Keeps the sleeper-recruitment timers alive after you leave the page, and gives you one
click back to the lead when its window opens.

It is **fully passive**. It reads responses the game already made, on pages you are
actively viewing, and originates no requests of its own.

## The problem it exists for

You strike up a conversation. That sets an appointment about a day out, and the lead is
workable for **one hour** when it arrives. Miss the hour and the card reads `missed`, the
button never re-enables, and Drop is all that is left — everything you spent on that lead
is gone.

Three things make missing it the default rather than the exception:

- **The countdown exists on one screen only.** `next_meeting_at` arrives in
  `/api/actions/sleeper-recruitment` and in no other response anywhere in the client.
  Navigate away and it is not stale, it is *absent*.
- **The game will not remind you.** Its push notifications cover exactly four events —
  jail release, hospital release, hospitalisation, travel arrival. A sleeper meeting is
  not one of them.
- **There is no second chance.** Every other timer in Politiko just makes you wait longer.
  This one throws the thing away.

So the tool holds the timestamp for you, and that costs nothing: **`next_meeting_at` is an
absolute instant the server already handed you, so counting down to it needs no network at
all.** One visit to the recruitment screen is enough; the clock runs from there.

## What you get

**A strip, inside the page you are already looking at**, whenever there is something to do:

```
● MEETING WINDOW OPEN
  Ariel Voss · closes in 47m 12s            [go →]  [×]
```

It appears for an open window, for a new lead with no appointment yet, for a faction
sleeper whose cooldown is up, and — in amber — fifteen minutes before a window opens. Drag
it anywhere; it remembers. `×` dismisses that one event and nothing else, and a fresh
appointment brings it back.

**`go →` is the part that matters.** It navigates to the recruitment screen exactly as
clicking Actions → Recruit Sleepers would, then does two things the game cannot: it sets
the issue dropdown to **that lead's own issue**, and scrolls its card into view with an
outline.

That is not decoration. The page has **one** issue selector and every lead carries its own
`issue`, so with two leads on different issues the dropdown is wrong for at least one of
them — and a meeting can come back `lost`. The tool lines the shot up. **You press Talk
about issue**, in the game's own UI. Nothing here presses anything.

**And when you come back to the tab** it says once, plainly, what closed while you were
gone rather than leaving you to notice:

> ⚠ 1 window closed while you were away: Rae Okonkwo
> A missed lead cannot be re-opened — the action stays disabled and only Drop is left.

## The panel

**Alt+S**, or the `SLP` button. Drag either anywhere; they remember. The button turns green
with a count when something is actionable, amber when something is about to be.

| tab | what it shows |
|---|---|
| leads | every live lead, urgency-ordered — open and closing soonest first, then new, then waiting, then missed. Countdown, wall-clock window, meeting count, issue (hover for the clue), `go →` per row |
| sleepers | recruited sleepers with effect %, plus **advocate and embezzle cooldowns as countdowns** instead of the bare clock time the faction page prints |
| research | what the ledger can say about the two questions the client cannot answer |

The header carries `recruited/cap` and the energy cost per canvass, both straight from the
server's own response.

A window closing tonight shows a bare time; anything further out carries its day —
`opens Mon 09:35 PM`. An appointment set a day ahead lands near the hour it was made, so a
bare time on a 23-hour countdown reads as this evening, which is the exact misreading the
tool exists to prevent.

## The faction half

Recruiting a sleeper and *using* one are different pages, and the second sits behind the
`can_manage_sleepers` rank permission — so a player without that rank can run the whole
recruitment loop forever and never see the button that makes it pay. `advocate` generates
power, `embezzle` siphons cash, and each has its own cooldown.

The faction page renders those as `advocate ready 3:45:12 PM` — a bare local time, no date,
no countdown, and only on that page. Sleeper Watch counts them down beside the leads and
offers `faction →`, which navigates there and opens the Sleepers tab. That tab is local
component state with no URL, so there is no link to hand you instead.

If you have never seen a cooldown, the panel says which situation you are in rather than
showing an empty column.

## The research tab

Two of the surface's open questions are answerable by watching, and watching is free once
the leads are being tracked:

- **Does the issue have to match the clue?** Each lead renders a `clue` and an `issue`, and
  `meet` sends whichever issue *you* picked. The obvious reading is that the right issue
  advances the lead and the wrong one risks `outcome: 'lost'` — but the rule is server-side
  and nothing client-side confirms it. So every meeting records the issue that was showing
  in the selector against the issue the lead carries, and the tab counts match / differ /
  unknown with the lost rate for each. **Below 20 observations it says so and declines to
  mean anything.**
- **What ends a lead?** The poll returns the whole list, so a lead that stops appearing has
  ended. The tab buckets endings by the state the lead was last in — one that vanished
  mid-window most likely converted, one that vanished after expiring was pruned — with the
  average meeting count for each. The server never says which, so that state is the last
  one observed, not a verdict.

`copy digest` is the shareable output: counts only, no NPC names, no usernames.

## Console

```js
__pksw.leads()      // live leads with state and time left
__pksw.sleepers()   // recruited sleepers and their cooldowns
__pksw.issues()     // the issue-match digest
__pksw.endings()    // how leads ended
__pksw.ledger()     // every meeting and ending observed
__pksw.digest()     // the paste-ready summary, no names
__pksw.export()     // everything, as JSON
__pksw.clear()      // wipe it
```

## What it reads

Full disclosure is in the header comment at the top of
[`sleeper-watch.user.js`](sleeper-watch.user.js). In short: it reads three responses the
game already made, plus the value showing in the page's own issue dropdown at the moment a
meeting reply lands, stores everything under `pksw:` keys in your browser, and sends
nothing anywhere.

**No alert ever leaves the page.** No Notification API, no sound, no title flashing — the
strip is drawn inside the tab you are already looking at, and the clock stops entirely
while the tab is hidden. Because every countdown is recomputed from its absolute deadline
rather than decremented, resuming after any pause is correct without a request.

**Lead and sleeper records hold NPC display names, and the faction roster holds the
usernames of whoever recruited them.** That never leaves your browser and must not be
committed.

Surface notes, and what is field-reported rather than read out of the client:
[`docs/08-sleeper-surface.md`](../docs/08-sleeper-surface.md).

---

# Quick Jump

A launcher for the screens the sidebar cannot reach. **Alt+J.**

## The problem it solves

Politiko has **84 routes**. The sidebar has **20 entries**, and the `/settings/sidebar`
screen only reorders and hides those twenty — there is no way to add anything to it.

So a large part of the game is reachable only by remembering which page links to it. The
worst case is the casino, which is five screens deep and gets no link at all from the nav:

```
Corporations → (footer link) → Directory → page until you find it
             → its corp page → Enter casino → pick a game
```

That is not sloppy UI, it is the data model showing through: a casino is a **corporation
of type `casino`** that owns a casino property, and the floor is a room inside that
company. Quick Jump does not change that — it just remembers the way in.

## How to use it

**Alt+J** opens it, anywhere. Then either type, or click.

- Typing filters everything at once — `house` finds The House's floor and all five of its
  tables, `bank` finds the bank, `sleep` finds sleeper recruitment. **↑↓** moves, **Enter**
  jumps, **Esc** closes.
- **☆** pins a destination. Pinned rows sit at the top and get **Alt+1 … Alt+9**, so the
  casino you actually play at is one chord away from anywhere in the game.
- The **JUMP** button and the panel both drag and resize, and remember where you put them.

**Since 0.2.0 the panel stays open when you pick a destination.** It used to close on every
jump, which is right for a one-shot and wrong for the thing this tool exists to do: paging
six casinos meant six trips through Alt+J and six retypings of the filter. Now the filter
survives the jump, so a walk is **Enter, ↓, Enter, ↓, Enter** — and the row you are standing
on is marked, so the list doubles as your place in it. **Esc**, the **×** and **Alt+J** all
still close it, and the panel is resizable now, so "it is in the way" has an answer that is
not "it disappears".

Every jump is a client-side route change — the same thing that happens when you click a
link, with the walking removed.

## The casino block

Casinos get their own section, and each one shows **the gate next to the door**:

| | |
|---|---|
| `open to you · 2m ago` | you are standing in a venue city — the floor will let you in |
| `travel to Vegas / Reno · 12m ago` | it is real, you are in the wrong city, and those are the right ones |
| `wagering suspended · 4m ago` | outstanding regulatory fine; audits still open |
| `no venue — floor closed` | the corp has not acquired or leased a casino property |
| `gate unknown` | never opened its corp page, so there is nothing to report |

**The age is always shown, and it matters.** `current_city_access` is a snapshot from
whenever that corp's page last loaded. Travel afterwards and the reading is stale — the
script cannot know that without asking the server, which it will not do. An open gate read
an hour ago is shown amber rather than green for exactly this reason.

Without this, a shortcut to a casino would be worse than no shortcut: you would spend a
page load to be told to travel.

## How it learns

It knows the 53 fixed routes immediately. Everything with an ID in it — casinos,
corporations, factions — it learns from responses **the game already made** while you
played:

| you do this | it learns |
|---|---|
| page the corporation directory | every corp on that page, with its type — **this is the one that matters** |
| open any corp's page | that corp, and its casino summary if it has one |
| look at your own corp / faction | those |

One visit to the directory populates every casino in the world permanently. If the panel
is empty, that is the fix, and the footer says so with a button that goes there.

**It never fetches the directory for you.** That would be scraping a page you are not
viewing, which is the bright line in the scripting clause and is not worth crossing to save
one click.

## Craps is missing on purpose

`/corporations/:id/casino/craps` is a live route and `CasinoCrapsPage` ships, but the
lobby filters craps out of the only screen that would link to it. That is an operator
decision expressed in code, so this tool honours it — craps is never offered, even when
the server reports it live. `test-quick-jump-passive` fails the build if it reappears
anywhere but the denylist. Same reasoning for `/property/:id`, whose behaviour is
unverified: not shipped until somebody confirms it.

## What it reads

Full disclosure is in the header comment at the top of
[`quick-jump.user.js`](quick-jump.user.js). In short: it reads a handful of GET responses
the game already made, keeps names, IDs, types and venue cities under `pkqj:` keys in your
browser, and sends nothing anywhere. It originates **zero** requests, and never reads any
storage but its own.

The route table it is built from, and the measurements behind the casino block:
[`docs/12-navigation-surface.md`](../docs/12-navigation-surface.md).

---

# World Watch

The political compass, drawn for the world instead of for you — and then again for each
city.

## The idea in one paragraph

Politiko draws a compass on exactly one screen: your profile. But it also files **every one
of its twenty political issues under one of those same two axes** — 13 social, 7 economic —
and five completely different populations carry a signed −3..+3 number on those issues.
The law does, as twenty policy axes. The public does, as opinion-poll blocs. The street
does, as protest control meters. The media does, as corporate campaigns with a city and a
reach. And the citizens do, on both axes at once, every time you open somebody's profile.
So the world can be put on the game's own chart without asking the server for anything it
was not already going to send.

## What you get

Four tabs.

**WORLD** — the compass with up to five markers on it, one per population, plus a legend
giving each one's two axis figures, how many readings went into them, and how old the
freshest is. Click a glyph to hide that layer. Under it, **power**: the president, both
chambers and the court as seat-weighted left/right rulers, because a legislator carries a
single score and has no business being plotted as a point.

| | | reads |
|---|---|---|
| ◆ | the law | the 20 policy axes, from Government |
| ● | the public | opinion polls, one issue per poll you run |
| ▲ | the street | live protest meters, weighted by heads |
| ■ | the media | per-city campaigns, weighted by fans |
| ✕ | the citizens | profiles you opened — plus a dot per player |

**CITIES** — pick a city and the same chart is redrawn for it, with the national reading
behind each marker as a dashed ring, so the gap *is* that city's own politics. Below:
the walls (graffiti's own citywide L/R pulse), the state it sits in from the map the Travel
screen polls anyway, and the whole state table sorted by activity.

**ISSUES** — all twenty, in a table: what the law says, what the public thinks, what the
street is doing, what the media is pushing. This is where the axis figures come from, so it
is the tab to look at when a number surprises you.

**SOURCES** — every endpoint it reads, when each last arrived, a jump button to the screen
that would refresh it, and what is held locally with the caps on each.

## Where the numbers come from, and which half is ours

The split — which issue belongs to which axis — is **the game's**, read out of
`ActivismPage`'s own table. Averaging within an axis and plotting the pair is **ours**, and
the game never does it. The panel says so on the WORLD tab and prints the sample size
beside every figure, so a point built from two readings cannot pass for one built from
twenty.

Two things it deliberately refuses to do:

- **It will not average the five into one world number.** They disagree — that is the
  interesting part — and a sixth figure with no source would bury it.
- **It will not refresh.** Refreshing means asking, and asking is the line this repo does
  not cross. Every figure is as old as the last time you looked at the screen carrying it,
  and every row prints its own age.

## How it fills up

Nothing here needs a special trip. Each row fills from a screen you were going to open:

| open this | and you get |
|---|---|
| the home page | the media layer, and one placed protest |
| Government | all twenty policy axes, both chambers, the court |
| Travel | the city list, and the whole state map (it re-reads every 15 s while you sit there) |
| a protests screen | the street layer for that city |
| Graffiti | the walls of the city you are standing in |
| Opinion Polls | one issue's public opinion, per poll you pay for |
| anybody's profile | one more citizen |

When a layer has nothing yet, the panel says which screen would fill it and offers a button
that goes there — the same client-side navigation as clicking the game's own link, on your
click and never on a timer.

## The one thing that is currently blank on purpose

Citizens cannot be placed in a city. A profile only carries `location` while the **Privacy
Rights** policy leaves it unsealed, and as of the last field check it does not — for
anybody. Every profile you open still counts toward the world reading; only the city column
is empty, and the panel says it is empty by policy rather than by luck. If that policy ever
moves, the column fills on its own with no change to the tool.

## What it reads

Full disclosure is in the header comment at the top of
[`world-watch.user.js`](world-watch.user.js). In short: eleven GET/POST **responses** the
game already made — never a request body, never a header, never your token — stored under
`pkww:` keys in your browser, and nothing sent anywhere. It originates **zero** requests.

It does store other players' alignments, because a compass of the world is a compass of its
people and there is no other way to have one. What it keeps per player is exactly what the
profile screen already showed you: the name, two axis values, two sample counts, and when
you saw it. Nothing else from the profile is touched.

The measurements it is built on, and the line between what the game computes and what this
tool does: [`docs/13-world-politics-surface.md`](../docs/13-world-politics-surface.md).

---

# Gov Watch

World Watch draws the government as a position. This one draws it as a **trajectory**.

## The idea in one paragraph

The Government screen shows you where the law stands today and keeps no history at all —
open it twice a week apart and nothing tells you the second reading differs from the first.
But the client also says, on a completely different screen, that Congress runs on a
**monthly cycle**, and a game month is about **fourteen real hours** — so the government
moves roughly twice a day and the game never mentions it happened. Gov Watch records every
reading the app already made and reports what changed between two of them.

## What you get

Five tabs.

**MOTION** — the ledger, newest first, grouped by day. One row per thing that moved: a
policy axis, a justice, a seat, the president's approval, a lobbying job changing status, a
cycle rolling over. Filter by *the law* / *seats* / *executive*, or flip **live only** to
see just the changes caught as they happened.

**LAW** — all twenty policy axes as they stand, split by the axis the game files each under,
each with the seven-cell bar the Government screen draws, how far it has drifted since this
ledger first saw it, and how long it has held its current value. Hover a name for its
written position.

**SEATS** — the president with approval, both chambers, the court justice by justice, and
the next election dates.

**CYCLE** — the heartbeat: which cycle is next, how long a game month is, and — once the
tool has actually *witnessed* a rollover — a projection of the next boundary with the width
of that observation as its error bar. It also tells you, plainly, whether anything is
currently feeding it.

**SOURCES** — the three endpoints it reads, when each last arrived, what is held, and a
button to copy the ledger out as TSV.

## The bracket, which is the whole point

**This tool cannot see a change it was not looking at.** It compares consecutive readings,
and a reading only happens when the app fetches. So it never claims a change happened *at*
a time — only *between* two readings, and every row prints that window:

```
Healthcare            -1.0 → -2.0     L+ → Mod-
   between Aug 24, 09:12 and Aug 26, 02:43 · 2d 5h window
```

A row whose window is two days wide is drawn to look two days wide. A row caught on the
live feed says `seen live (15s window)` and is marked green. That distinction is the
difference between a measurement and a guess, and it is never omitted.

## Two feeds, two very different resolutions

| open this | what you get | how often |
|---|---|---|
| **Faction → Jobs** | the 20 axes, every congress member by seat, the cycle counter, lobbying status | **every 15 seconds**, on the app's own poll |
| **Government** | the same 20 axes *plus* their written positions, the chambers, the court, the president, election dates | only when you open it |

The faction Jobs tab is the only live feed of the law in the game — the app refetches it on
a fifteen-second interval by itself, so leaving it open is what turns this from a visit-to-
visit ledger into something that watches. It needs faction membership; without it, the tool
still works, just at visit resolution.

## Two things it knows that the game will not show you

**Fractional axes.** The client clamps policy values to −3..+3 but never rounds them, and
then every renderer tests equality against an integer. So an axis at `1.4` raises no cell —
the bar just renders flat — a justice at `1.4` is counted in no bucket, and `factionUtils`
labels anything fractional `R++`, meaning a seat at **−1.5 displays as the most right-wing
label there is**. This panel prints the raw number and flags the row.

**Chambers move more than the tallies say.** The Government screen buckets seats with wings
cut at ±2 and *moderate* spanning three buckets, so a seat sliding −1 → 0 changes no
displayed number at all. The per-member feed catches those, and the panel keeps the two
apart — the server's all-seat buckets tally the chamber, the roster only ever reports its
own size.

## What it will not do

- **Refresh.** Both feeds are polls the app makes on its own. A timer here that fetched
  anything would be the exact thing the scripting clause prohibits, and it would also make
  every "window" on the panel a lie.
- **Alert you.** No notifications, no sound, nothing from an unfocused tab. The `GOV` button
  picks up a highlight when there are changes you have not looked at, and that is all.
- **Touch a lobbying job.** It reads their *status*, because a lobbying job is a push on a
  policy axis and there is no other record of one — but it stores no username, no slot, and
  no committed resources, and the POST that creates one is deliberately not in the file.

## What it reads

Full disclosure is in the header comment at the top of
[`gov-watch.user.js`](gov-watch.user.js). In short: three GET **responses** the game already
made — `/api/government`, `/api/factions/{id}/jobs`, and `/api/user/status` for your name —
stored under `pkgw:` keys in your browser, and nothing sent anywhere. It originates **zero**
requests.

The measurements behind every constant, and which parts are inferred rather than measured
(the cycle being a *game* month is the big one):
[`docs/14-government-motion-surface.md`](../docs/14-government-motion-surface.md).

---

# Poll Watch

Files every opinion-poll memo you run, timestamped in real **and** game time, and keeps the
per-issue trend so you can see whether the population is actually moving.

It is **fully passive**. It reads the reply to a poll *you* paid for, at the moment it
arrives, and originates no requests of its own. There is no refresh button, because
refresh here means spending 5 energy of yours.

## The problem it solves

`POST /api/actions/poll` returns a one-shot memo. The game renders it, and the moment you
navigate away it is gone — there is no poll history screen. So the only way to compare
this week's reading on an issue against last week's is to screenshot the memo and write the
time on it yourself.

That matters more than it sounds, because the memo is the **only** surface that shows
public opinion. The government page shows `policies[].axis` — the law — and the two are
designed to diverge: Congress specifically picks bills where public opinion and current law
are misaligned. Media campaigns and activism are scored against the population, not the
statute, so a poll history is the only record of the thing that actually drives them.

## What it captures

Everything the memo carries, whichever method you paid for:

| field | street / online | professional / focus group |
|---|---|---|
| spread | `left_bloc` / `center` / `right_bloc` | all seven buckets, `far_left`…`far_right` |
| `mood`, `extreme_tag` | yes | yes |
| `volatility`, `salience`, `popularity` | — | yes |
| `best_target` | — | yes |
| `persuasion_angle` | — | focus group only |

plus the method, the real timestamp, and the game date — the last one lifted from the
`/api/time` response the sidebar polls anyway, so it costs nothing.

## The two derived numbers

Both are arithmetic on what arrived, not a model:

- **net** — `right% − left%`, on −100…+100. Defined for *both* memo shapes, which makes it
  the only series that stays comparable when you switch methods mid-campaign. The trend
  line and every delta use it.
- **lean** — the same spread weighted −3…+3 by bucket, so it lands on the scale the game's
  own policy axes use. Exact methods only. A street poll has nowhere to put the weights,
  and the panel prints `needs an exact method` rather than inventing a number.

Sides are always named (`R+22`, `L+1`, `even`) instead of shown as a bare sign, because a
signed number on a screen full of −3…+3 axes reads as the wrong scale.

## The panel

Three tabs, and it remembers which one you left it on.

- **latest** — the pinned issue's newest memo drawn the way the game draws it, plus the
  delta against your previous poll on that issue, a trend sparkline, and the cooldown
  counting down. Filled dots on the sparkline are professional or focus-group readings;
  hollow ones are street or online, and the panel says so rather than drawing a confident
  line through noisy points.
- **issues** — one row per issue you have polled: where it sits now, and how far it has
  moved since your first reading. Click a row to pin it. It also lists the issues you have
  never polled.
- **log** — every memo, newest first. Click one to jump to it.

`copy tsv` puts the whole history on the clipboard as a spreadsheet-ready table (23
columns, one row per memo, blanks where a cheap method returned nothing); `copy json` gives
the raw rows.

It shows on every page by default — it is a notebook, not a home-page mirror, and it is
useful open beside the corporation media tab while picking a document to spin. The **all
pages** button narrows it to the home page and Actions → Opinion Polls.

## What it will not do

Run a poll. A poll costs 5 energy plus $500 or $1,000 and sits behind a server cooldown,
and spending that on your behalf is exactly what this repo does not do — `test-poll-watch`
fails the build if anything in the file can originate a request, which is why its one
repeating timer (ageing `3m ago` and the cooldown) is safe whatever its period.

A memo is also a snapshot of the moment you bought it. Nothing refreshes, so a stale
reading stays visibly stale rather than quietly pretending to be current.
## What it reads

Full disclosure is in the header comment at the top of
[`poll-watch.user.js`](poll-watch.user.js). In short: the memo from a poll you ran, the
issue list the poll screen loads, and the `/api/time` responses the sidebar already makes.
Everything is kept under `pkpw:` keys in your browser, nothing is sent anywhere, and it
originates **zero** requests.

Every field it knows about was read off `OpinionPollPage` in the 2026-08-03 bundle pull,
not off the wire.

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
node userscripts/tools/test-sleeper.js
node userscripts/tools/test-sleeper-passive.js
node userscripts/tools/test-quick-jump.js
node userscripts/tools/test-quick-jump-passive.js
node userscripts/tools/test-world.js
node userscripts/tools/test-world-passive.js
node userscripts/tools/test-gov.js
node userscripts/tools/test-gov-passive.js
node userscripts/tools/test-poll-watch.js
```

Every suite slices the layer it covers straight out of the shipped script rather than
copying it, so the tests cannot drift from what installs.

Several are **fences** rather than behaviour tests — they read the shipped file and fail if
something that could originate a request has reappeared, because "we removed it" stays true
only until someone adds it back:

- `test-market-passive` fences market-watch's deleted order-execution seam.
- `test-passive` fences ws-watch, which replaces `window.WebSocket` and is therefore
  structurally one line away from being a bot. It also drives the tap's behaviour.
  **Added 2026-08-26:** it now fences the *credential* half too. The game's three sockets
  do not agree on where the access token goes — `/ws/chat` and `/ws/market` put it in the
  URL query, `/ws/casino/poker` puts it in the WebSocket subprotocol — so the fence checks
  both that a sentinel token planted in the subprotocol reaches no subscriber, *and* that
  it was still handed to the real constructor intact. Those are different properties and
  a tap needs both: dropping it would quietly break the game's poker table.
- `test-raid-passive` fences raid-watch, which reads a surface whose write endpoints
  surrender wars and impose flags. It fails on any mention of those paths, any non-GET
  verb, and any timer body that touches the network — the two ways to build a poll are
  `setInterval` and a `setTimeout` that re-arms, and both are barred.
- `test-sleeper-passive` fences sleeper-watch, which sits beside five write endpoints —
  canvass, meet, drop, advocate, embezzle — and whose whole product is a clock, so it
  cannot ban repeating timers the way the raid fence does. It asserts the stronger
  property instead: nothing anywhere in the file can originate a request, which makes any
  timer safe whatever its period. It also **caps `.click()` at two**, both named, because
  pressing the game's own Talk about issue button originates nothing itself — React does
  it for you — and would sail past every network check in the file.
- `test-quick-jump-passive` fences quick-jump, the only tool here whose job is to *move
  you*. Rather than ban navigation it pins it: exactly one `pushState` site, reachable
  only from a handler you triggered, with no timer able to reach it — a jump that
  schedules the next jump is a crawler. It also fails if the tool ever prefetches the
  directory it depends on, or surfaces craps.
- `test-world-passive` fences world-watch, the widest reader here — eleven endpoints, one
  of them other people's profiles. Its own three temptations get their own checks: the
  panel lists rows it does not have yet, which is one line from "just fetch Government on
  boot"; every figure it prints is stale by design, which a refresh timer would quietly
  make false; and its disclosure block names eleven paths, which is only true on the day it
  is written. So the last block **reads the endpoints the code recognises and fails if the
  header does not name every one of them** — adding an endpoint means documenting it, or
  the build stops.
- `test-gov-passive` fences gov-watch, which is tempted twice over. It reads a screen you
  are usually *not* on, so every "no reading yet" line is one lazy edit from fetching
  Government on boot; and the other feed is a fifteen-second poll **the app makes**, which
  is exactly why the tool may read it and exactly why it must never make it itself. Its
  own additions to the usual checks: the cycle projection must drive a sentence and never
  a `setTimeout`; a stored lobbying job must contain no username, no slot and no committed
  cash; and the freshness map may only record the three declared paths — a blanket
  `seen[path] = now` looks harmless and would in fact keep a list of every route the app
  visited, `/api/users/<name>` included.
- `test-poll-watch` fences poll-watch, which sits directly beside a write endpoint that
  spends 5 energy and up to $1,000 a call and is rate-limited by a server cooldown. Rather
  than ban its one repeating timer — `3m ago` and the cooldown both have to age — it holds
  the stronger property: nothing anywhere in the file can originate a request, so the timer
  is safe whatever its period. Its behaviour half drives the derivation and export layers
  sliced out of the shipped file, where the properties are all about not inventing data: a
  refused poll is an error body and must not become a data point, and `lean` must come back
  null for a street poll rather than as a confident-looking zero.

They have nothing else in common; market-watch's was named `test-passive.js` when it
lived in its own repository and was renamed on the way in.

`test-placement` also checks that **`PANEL KIT v2` is byte-identical across all eleven
copies**. The convention was written down in CLAUDE.md from the start and enforced by
nobody, which is how eleven hand-maintained copies of a drag implementation quietly
diverge. Now a mismatch fails the build and prints which files disagree. It slices the block
marker-to-marker rather than by line count, because v1 was 93 lines and v2 is not — a
hardcoded length stops covering the tail the moment the kit grows.

Alongside it: **every window this repo draws can be resized, and remembers it**, with the two
exceptions above listed by name so an omission has to be deliberate. And `resizable()` itself
is *driven* against a stub viewport rather than only grepped for, because its failure modes
are all states you would otherwise have to reproduce by hand — growing away from the pointer,
a `74vh` cap quietly outranking a chosen height, a restore reading back as a user gesture, a
minimise shrinking the panel to nothing.

`test-people` covers people-watch's walk layer — where a keypress sends you, which order it
follows, and which players `next unseen` is allowed to skip — plus the derived metrics. An
off-by-one in the walk means silently missing a player on a list you are stepping through by
hand.

The list-order walk is pinned down harder than the roster one, because the roster is a fixed
order and the list is not: it re-sorts as profiles land and as time passes. So the suite
drives the table out from under a walk in progress and asserts the keypress still means "the
row below the one I am on" — and separately that the walk order is the *painted* order,
grouping and row cap included, rather than something that merely agrees with it by hand.

`test-placement` covers the panel placement layer against a synthetic viewport: the button
stays on screen and clear of the game's Comms dock, and the panel stays fully visible from
whichever corner the button was dragged into.

`test-world` covers world-watch's filing and its ingest, in that order of importance. The
filing first, because everything the panel prints is a mean over issues split by axis, so a
single mis-filed issue moves the compass for a reason nobody can see: it checks all twenty
against both names the client ships for them, and that the split really is 13 and 7. Then
the ingest, by feeding real payload shapes through the same `consume()` the tap calls —
which is what catches the ones that read as correct. A protest the home page names but has
no meter for must not plot as a perfect deadlock. A re-read of the home page must not stack
a second copy of the campaigns already there. A state whose last protest ended has no lean
rather than a stale winner. And the assertion that pays for itself: the lean is computed
from the **stored** record, not the wire row, because the first version of that function
took the wire shape and every state on the map drew a blank in a way that looked deliberate.

`test-gov` covers gov-watch's diff engine, and almost all of it is about the **bracket** —
the claim that a change happened between two particular times, which is the tool's entire
product. There are two silent ways to break it, and both are checked. Narrowing it: stamping
a change with `now` turns a week-old shift into breaking news. Widening it: forgetting to
advance the confirmed-at clock on a reading that *agreed* means the next real change is
bracketed back to first sighting, so a fifteen-second window gets reported as a four-day
one. Beyond that it pins the cases where an event should *not* fire — a first reading is a
baseline and not twenty changes; a feed that omits a field has not cleared it, or every
jobs poll would read as the entire supreme court resigning; a new president is one
succession row rather than four separate collapses. Writing it turned up two real bugs: the
ledger was labelling policy events with their internal store key, which silently killed the
LAW tab's drift column, and the freshness map was recording *every* API path the app
touched — putting other players' usernames in storage as a side effect of a timestamp.

---

## The bench

`tools/harness/` renders a real panel against canned payloads, in a real browser, with no
game anywhere near it.

```bash
python -m http.server 8146 --directory userscripts
```

Then open <http://localhost:8146/tools/harness/>. There is also a `panel-harness` entry in
`.claude/launch.json` if you drive this from Claude Code.

Pick a tool, click its fixtures, and the panel fills in as if you had been playing. A
`?tool=` parameter switches tools; fixtures live in
[`tools/harness/fixtures.js`](tools/harness/fixtures.js), keyed by script basename, and
adding a tool means adding an entry.

**Why it exists.** Every tool here draws a panel over a live game we are told to be careful
with — one account, no alts, and every authenticated page view spends real risk. Rendering a
panel used to mean loading politiko.io and playing until the state you wanted showed up.
Now it means clicking a button.

**It cannot reach the network.** `fetch`, `WebSocket` and `XMLHttpRequest` are replaced with
inert stubs *before* the tool script is injected, so a tool running on the bench cannot
contact politiko.io even if it tried. That is the point rather than a convenience — a bench
you have to trust is worth less than one that is incapable.

It also **logs every attempt in red**: a fetch with no fixture, an XHR, or a `send()` on a
socket. So the bench doubles as a live check on the property every disclosure block in this
repo claims, which is the one thing the static fences cannot observe — they read the file,
this watches it run.

The unit tests and the fences still do the real work; the bench catches what they
structurally cannot. Writing quick-jump it found three: nested `<button>` elements, a
re-render that reset the filter caret on every keystroke, and a first-run search for
"casino" that returned a bare "nothing matches" — the one query a new user is most likely
to type. Its fixtures are also the right home for edge cases worth *seeing*: firing a
casino body at a haulage corp is one click, and the panel either lists a warehouse under
Casino or it does not.
