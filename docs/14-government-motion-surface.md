# Government motion surface — what moves, how fast, and who gets to watch

Measured **2026-08-26**, entirely from the client bundles already on disk from the
2026-08-10 `tools/fetch-bundles.ps1` run. **Zero requests were made to politiko.io in the
course of writing this** — no endpoint was called, probed, or re-fetched, and no page was
opened. Everything below is what the *client expects*, read out of its own code; where a
real capture later contradicts a shape here, fix it and say so.

Companion to [`13-world-politics-surface.md`](13-world-politics-surface.md), which measures
the government as a **position**. This file measures it as a **trajectory**: which fields
can change, where a change becomes visible, and how long you have to be looking.

> **2026-09-17.** A second pass, from a game year of the Herald's Record rather than from
> bundles, is at [*A game year of the Record*](#a-game-year-of-the-record-added-2026-09-17).
> It answers two of the questions this file listed as unknown and changes the practical
> conclusion: **Congress signed nothing in a game year, and the only door that opens is the
> ballot at an election.**

## The finding that shapes everything

**The government has a heartbeat, and the client names it — but only on the lobbying
screen.**

`FactionPage`'s jobs tab renders a header card reading `next cycle · Month {N}`, and locks
a lobbying job with *"Locked for monthly Congress cycle {cycle_month}. Resources are
committed."* So policy does not drift continuously. It resolves in **discrete monthly
steps**, and a job is bound to the cycle it was locked into.

`GovernmentPage` — the screen actually called Government — says none of this. It has no
cycle, no countdown, and no history. It draws the current position and nothing else.

That gap is the whole opportunity. The cadence is knowable, the position is readable, and
nothing in the shipped client ever puts the two together.

## Measured

### The two feeds carry the same law at very different rates

| | `GET /api/government` | `GET /api/factions/{id}/jobs` |
|---|---|---|
| where | Government screen | Faction → Jobs tab |
| refresh | `staleTime: 6e4`, **no `refetchInterval`** | **`refetchInterval: 15e3`** |
| gated by | **nothing** — see below | faction membership |
| 20 policy axes | ✅ with `description` | ✅ name + axis only |
| congress | **buckets only** — `[{alignment, count}]` | **per member** — see below |
| president / court / elections | ✅ | ✗ |
| cycle | ✗ | ✅ `next_cycle_month` |

Both were read straight out of the bundles:

```
GovernmentPage    queryKey:['government']  queryFn:()=>f.get('/government')  staleTime:6e4
FactionPage       queryKey:['faction-jobs', r.id]
                  queryFn:()=>a.get(`/factions/${r.id}/jobs`)  refetchInterval:15e3
```

> **Correction, 2026-09-04.** The "gated by" row used to say `GET /api/government` was
> behind a `tier1_view_government` **feature check**. It is not. That identifier is passed
> to `useMissions`' ack effect, which fires **`POST /api/missions/tier1_view_government/ack`**
> when the screen mounts — no gate, and a write rather than a read. So **opening the
> Government screen POSTs**, which is worth knowing before anyone describes a jump button
> as GET-only. Traced in [`20-newspaper-surface.md`](20-newspaper-surface.md).

**The faction jobs feed is the only live feed of the law in the game.** Sit on that tab and
the twenty policy axes re-arrive every fifteen seconds, along with every congress member's
alignment — at zero added cost, because the app polls it on its own. The Government screen,
by contrast, refetches only when you open it.

### `GET /api/factions/{id}/jobs` — the fields 13 did not record

13 recorded `policies` and `congress_members` from this payload. Three more sit at the top
level, and one of them is the cadence:

```
next_cycle_month      rendered as "Month {N}" — the cycle a lock lands in
election_reform_axis  the Election Reform policy value, broken out on its own card
jobs                  [ … ]   see the lifecycle below
```

`election_reform_axis` is the same number that appears in `policies` under
`Election Reform`, promoted to a headline stat beside faction power and treasury. The
client gives no reason; that it sits in the lobbying header alongside the cycle is the only
hint that it governs lobbying itself.

### The lobbying job lifecycle — a policy push, observable end to end

```
id                  target_policy_name   direction  "left" | "right"
status              "draft" | "recruiting" | "locked" | "resolved" | "failed" | "cancelled"
chamber             target_member_id     cycle_month
committed_power     committed_cash
slots               [ { role_key, assigned_user_id, assigned_username,
                        contribution_snapshot: { score } } ]
result_metadata     { outcome, score, winner_job_id }
```

The POST that creates one is `{ policy_name, direction, chamber, target_member_id, power,
cash }`. **This repo never sends it** — the shape is recorded because the *response* to
someone else's action arrives in the same payload we already read.

`result_metadata.winner_job_id` is the interesting one: it names a **different job** as the
winner, so multiple factions push the same policy in the same cycle and one of them takes
it. The client prints the winner's id and no more — you cannot see whose it was.

A job's status transitions are the closest thing in the client to a legislative record.
`draft`/`recruiting` are editable, `locked` commits resources to `cycle_month`, and
`resolved`/`failed` carry `result_metadata`. All of it arrives on the 15-second poll.

### `GovernmentPage`'s own arithmetic, worth copying rather than re-deriving

Chamber sizes and majorities are hardcoded in the render, not served:

| chamber | seats | majority |
|---|---|---|
| House | 435 | 218 |
| Senate | 100 | 51 |

The left / moderate / right tallies are computed client-side from the buckets, and the
thresholds are **not** symmetric around a single cut:

```
left   alignment <= -2        right  alignment >= 2        moderate  -1 <= alignment <= 1
```

So "moderate" is three buckets wide and each wing is two. A seat moving −2 → −1 leaves the
left tally and joins the moderate one; the same seat moving −1 → 0 changes no tally at all.
**Bucket counts are a lossy view of a chamber's motion**, and the per-member feed is the
only way to see the moves the tallies swallow.

### The president, and the threshold the client will tell you about

```
president { name, alignment, favorability, term_number }
```

`favorability` is a percentage and the render colours it: **amber below 25, rose below 10**.
Below 10 it prints an extra line — *"Impeachment proceedings imminent"*. That string is in
the shipped bundle, so an impeachment mechanic exists and 10 % is its visible trigger.

Nothing says how fast favorability moves, or what moves it.

### A third word-scale, in the same client

13 recorded that `GovernmentPage` contradicts the in-bundle wiki table from 07. There is now
a **third** vocabulary — `factionUtils`:

| | −3 | −2 | −1 | 0 | +1 | +2 | +3 |
|---|---|---|---|---|---|---|---|
| 07 · wiki table | Communist | Progressive | Liberal | Moderate | Conservative | Republican | Far-Right |
| 13 · `GovernmentPage` short | `L++` | `L+` | `Mod-` | `Mod` | `Mod+` | `R+` | `R++` |
| **`factionUtils` short** | `L++` | `L+` | **`L`** | **`C`** | **`R`** | `R+` | `R++` |

Same numbers, three spellings, one shipped client. `factionUtils` renders a seat as
`"House {seat_number} · {short}"`, which remains the entire identity a seat has — no state,
no district, as 13 recorded.

### Fractional axes are invisible in the game and mis-rendered in one place

`GovernmentPage` clamps and **does not round**:

```js
function L(e){ return Math.max(-3, Math.min(3, e)) }
```

Every consumer keys off that. Three consequences, all read from the render code:

- **The policy bar.** It raises the cell where `Math.abs(cell - L(axis)) === 0`. A policy at
  `1.4` equals no integer, so **no cell is raised** — the bar renders flat. A flat policy bar
  is therefore a *tell* that the axis is fractional, not a bug in your eyes.
- **The court tally.** It counts justices by `L(alignment) === bucket`, so a fractional
  justice is counted in no bucket and silently vanishes from the footer row.
- **`factionUtils` is worse.** Its short label is a `===` chain with a trailing else:
  `e<=-3?'L++': e===-2?'L+': e===-1?'L': e===0?'C': e===1?'R': e===2?'R+': 'R++'`. A member
  at **−1.5 renders as `R++`** — the chain falls through every equality test and lands on the
  far-right label. A left-wing seat displayed as the most right-wing one available.

Whether the server ever sends a fractional axis is still unmeasured (13's open question, and
it stays open). But if it does, the game cannot draw it, and one screen draws it backwards.
**A tool that prints the raw number sees motion the client is structurally unable to show.**

### Nothing about government crosses the socket

`09-socket-surface.md` records no government, congress, policy, election or cycle event, and
a grep of the 2026-08-10 bundles for those strings against socket handling finds nothing.
There is no push channel for the law. **Every observation is a poll the app already makes**,
which is exactly why this is buildable passively and also why it can never be complete.

### The cadence, in real time

From [`06-time-surface.md`](06-time-surface.md): the game runs at ~52.14× real time, a game
month is 30 game days, and

> **1 game month ≈ 13 h 48 m 32 s of real time.**

If `next_cycle_month` counts game months — and *"Month {N}"* beside a game that has its own
`Month D, YN` calendar is the natural reading — then **Congress resolves roughly twice per
real day**, and a lock made now lands within about fourteen hours.

---

## A game year of the Record (added 2026-09-17)

Everything above was read out of client bundles. Everything from here down was read out of
`gov-watch`'s own store — the Herald's front page and the Government screen as the operator's
normal navigation filled them — exported with [`tools/collect-stores.js`](../tools/collect-stores.js)
and analysed offline. **Still zero requests**: no endpoint was called to write this, and the
2026-09-04 note above about the Government screen POSTing its mission ack stands — every
reading below came from a screen she opened for her own reasons.

The store now holds **59 Herald entries spanning Jan 11 Y15 → Feb 16 Y16**, which is 2026-09-09
23:08 ET → 2026-09-17 15:14 ET: a little over one game year, continuous. That is the first
dataset in this repo big enough to answer *how a law actually changes*, and the answer is not
the one this file assumed.

### Congress passes almost nothing, and the two exceptions are the same bill

Of the **26 Congress entries**:

| outcome | n |
|---|---|
| dead in Congress | 20 |
| vetoed | 4 |
| **veto overridden** | **2** |
| signed | **0** |

The two that passed are both *"Lower Corporate Tax Rates"*, and both survived only by
overriding the president:

| printed | move | House | Senate |
|---|---|---|---|
| Sep 14, 6:12 PM ET | Corporate Law −1 → 0 | 423–12 | 95–5 |
| Sep 15, 9:49 PM ET | Corporate Law 0 → +1 | 367–68 | 83–17 |

**Nothing in a game year was signed into law by a president.** A raw majority is worth
nothing — *Protect our Borders* carried 261–174 / 57–43 and was vetoed twice — and an
override needs something like 95 %. This is the weighted count [`20`](20-newspaper-surface.md)
warned about, seen from the other side: the bar is not "a majority", it is "a supermajority
large enough that the executive does not matter".

> **Correction.** [`21-opinion-motion-surface.md`](21-opinion-motion-surface.md) said
> *"this Congress passes bills toward the centre and kills bills away from it"*, read off
> raw majorities before gov-watch stored outcomes. It is wrong, and corrected there too.
> Direction predicts nothing. Of 26 entries, 14 pointed toward the centre and 12 away, and
> one of each passed — both of them the same rightward bill on its two steps.

### The veto is the real check, and the right removes presidents

Five presidents sit in the store's succession events: Bartell → Hickle → Mertz → Bechtelar →
**Bayer**. Favourability decays steadily — Bechtelar's ran 50 → 42 → 26 → 10 — and at **10**,
with `crossed: ["amber"]` recorded by gov-watch's own threshold, the Herald printed:

> **President Bechtelar Removed From Office** — 329–106 / 74–26, *convicted*.
> Jun 21 Y15 ≈ **Sep 13, 12:46 AM ET**.

The same edition carries two of his vetoes. He had blocked three rightward bills; the chamber
removed him, and then overrode his successor twice inside 36 hours to take Corporate Law from
−1 to +1. **This answers "what impeachment does at <10 %"**, which this file listed as
unknown: the string ships because the mechanic does, and the threshold is real.

His successor, **President Bayer, is alignment −1** — the most left-leaning president in the
record — and is already at **favour 26 and falling** (34 → 26 in the bracket 09-15 11:26Z →
09-17 14:27Z). What moves favourability is still unknown; that it decays, and where it ends,
is now measured twice.

### The ballot is the only door that opens

At the **Nov 1 Y15 election — Tue 2026-09-15, 12:36 PM ET** — the Herald printed four
`Election` entries, and two of them did in one afternoon what Congress had failed to do all
year:

| measure | ballot | the policy it moved |
|---|---|---|
| Protect our Borders | **Passes by Ballot** | Immigration 1 → 2 |
| Expand Law Enforcement | **Passes by Ballot** | Police Regulation 2 → 3 |
| Promote Racial Equality | Fails by Ballot | — |
| Protect LGBT Rights | Fails by Ballot | — |

Both passes are attributable rather than adjacent: *Protect our Borders* had been vetoed twice
and *Expand Law Enforcement* had died in Congress twice, and the matching policy moves land in
the bracket 09-15 11:27Z → 09-17 14:27Z, which opens five hours before the ballot and is the
first reading after it. Nothing else in the store moves those two axes.

So the answer to **"what moves a policy axis besides lobbying"**, listed as unknown above, is:
a veto override, or a ballot measure at an election. The ballot is the cheaper of the two by a
wide margin — it needs no supermajority and no president.

Elections run **Tuesdays at 12:36 PM ET**. The congressional cycle is **biennial in game
years**: a stored `election` event moved the label *November Y14 → November Y16* in the bracket
09-08 23:59Z → 09-10 17:37Z, so Sep 15's was a ballot-only off-year and **Nov Y16 — Tue
2026-09-22, 12:36 PM ET — is congress and president together**.

### Seats move at elections, and the chamber is polarising

The Nov Y14 election lands in that same bracket, and so does the one `chamber` event in the
store:

| | left | centre | right |
|---|---|---|---|
| House, before | 22 | 244 | 169 |
| House, after | 12 | 229 | **194** |
| Senate, before | 9 | 66 | 25 |
| Senate, after | 5 | 55 | **40** |

That answers **"whether seats change outside elections"** in one direction — they change *at*
one, by 25 House seats — but not the other: the chamber has kept moving since, with 293
`member` events on record and no second `chamber` event, and it now reads

| chamber | −3 | −2 | −1 | 0 | +1 | +2 | +3 | seats |
|---|---|---|---|---|---|---|---|---|
| House | 2 | 10 | 56 | 106 | 67 | 12 | **182** | 435 |
| Senate | 4 | 1 | 12 | 26 | 17 | 5 | **35** | 100 |

The centre has collapsed from 229 to 106 while **both** wings grew — left 12 → 68 as well as
right 194 → 261. **42 % of the House now sits at +3.** Bucket deltas understate chamber motion
(noted above), so treat 25 seats as a floor on what the election did.

One consequence is visible in the Record itself. *Protect LGBT Rights* comes up repeatedly, and
its yes-vote is falling as the chamber sorts: **241–194 → 228–207 → 216–219** over four real
days. The bill that could not pass with a 47-vote majority now cannot pass without one.

### The court moves law, and the legislature takes it straight back

Two `Supreme Court` entries, *United States v. Upton* and *United States v. Farrell, Corp.*,
print Jun 1 Y15 ≈ **2026-09-12, 3:34 PM ET** — inside the bracket 09-11 04:06Z → 09-12 19:07Z
that caught **Corporate Law 0 → −1**, and no bill in the whole Record moves corporate law
leftward. The court remains the only explanation, which upgrades
[`13`](13-world-politics-surface.md)'s open question but does not close it: gov-watch keeps no
prose for those two (they predate 0.7.0), so the attribution is timing, not text.

It bought three days. The two overrides above took the same axis to +1 by Sep 15. **A court win
is worth 72 hours against a chamber that wants it back** — and the court is the one institution
the right does not hold: five left, three centre, one right.

## Inferred

Everything here is ours. None of it is something the client does.

- **`cycle_month` is a game month.** Rendered as `Month {N}` with no year and no real date,
  in a client whose only other calendar is the game's. Real-calendar months would make a
  lobbying job take a real month to resolve, which sits badly with a game that runs a year
  per real week. **Not measured** — a single field observation settles it, and until then
  every countdown this produces is a projection with its assumption printed next to it.
- **A change's timestamp is a window, not a moment.** Two readings bracket a change; the
  change happened somewhere between them. Reporting the later reading's clock as *the* time
  of the change would be a fabrication. Report the bracket.
- **Bucket deltas understate chamber motion.** Given the −2/+2 cut, seats can move without
  moving a tally. So a bucket diff is a floor on what happened, never the whole of it.
- **The winner of a cycle is unknowable.** `winner_job_id` is an id with no owner attached,
  and we will not go looking for one.

Added 2026-09-17, from the Record:

- **Impeachment is favourability-triggered, not scheduled.** One conviction, at exactly the
  10 % the client's own string names. One data point, and the alternative — that a player or a
  faction files it and the threshold is coincidence — is not excluded by anything in the store.
- **The ballot is decided by the per-issue public.** Both passing measures were rightward on
  issues whose polls read 2.9 and right-dominant; both failures were leftward, and one of them
  failed on a public that was **83 % neutral**. The rival reading — that the ballot simply
  follows the same right-wing supermajority Congress does, and direction alone decides it —
  fits all four outcomes just as well. **The discriminator is Women's Rights**, whose public is
  genuinely left at −1.38 while *Promote Gender Equality* dies in Congress 9–426 and 12–423. If
  that ever reaches a ballot and passes, the ballot is the public. Until then, treat "move the
  public, win the ballot" as the *hypothesis a campaign is betting on*, not as measured.
- **What reaches the ballot is unknown, and salience is the obvious suspect.** Three of the four
  measures were on issues being polled and worked at the time, two of them at popularity 1000.
  Nothing in any payload says how the slate is chosen.

## What this makes buildable

A **change ledger for the government** — a diff engine over readings the operator's own
navigation already produces, on the xp-watch precedent. Every field above is stored on each
reading; consecutive readings are compared; each difference becomes a dated row saying what
moved, by how much, and **between which two observations**.

Two feeds, two resolutions, one ledger:

- **Faction → Jobs open:** 15-second resolution on the twenty axes, every congress member,
  and the cycle counter. This is as close to "as it happens" as the game permits.
- **Anything else:** visit-to-visit resolution. Open Government, get a bracket since last
  time you opened it.

What it must not do, and the reasons are the repo's hard rules rather than taste:

- **Refresh anything.** The tool's own gap list is one line away from "just fetch
  `/api/government` on boot", which converts a passive reader into a scraper of a page the
  operator is not viewing — clause 2 and clause 5 together. The cadence is *known*, so the
  honest move is a countdown plus a jump button: one keypress, inside the clause.
- **Alert from an unfocused tab.** Ruled out in `03-script-ideas.md` and not reopened here.
  In-panel highlighting while the tab is visible is the whole of it.
- **Claim a change happened at a time.** Every row carries its bracket, and a row whose
  bracket is a week wide has to look a week wide.

## Still unknown

- **Whether `cycle_month` is a game month.** The one measurement that would make every
  countdown here real rather than projected. **Now checkable without a capture** — the
  Herald's masthead computes `Edition No. = floor(gametime / 2592000) + 1`, a game-month
  index off a server timestamp, and it sits on a sidebar card. Read it against this
  screen's `next_cycle_month` and subtract; see
  [`20-newspaper-surface.md`](20-newspaper-surface.md).
- ~~**What moves a policy axis besides lobbying.**~~ Answered 2026-09-17: a **veto override**
  and a **ballot measure**, both attributable, both above. A court ruling is the standing
  third candidate and is still timing-only. What remains open is protest `forecast_shift`,
  which (13) claims moves an axis and which **nothing has ever observed** — no protest and no
  media campaign has been seen since world-watch shipped — and the relationship between a
  resolved lobbying job's `score` and the size of a move, which is printed nowhere.
- **Whether axes are integers.** Unchanged from 13 — but now with three specific render
  symptoms that would make a fractional value visible if one ever arrives. A game year of
  readings has produced only integers.
- **What moves presidential favorability.** Still no feed, no history, no formula — but the
  *shape* is now measured twice: it decays, in steps of 8–16 between readings, across two
  presidencies, and conviction follows at 10. Whether anything a player does touches it is
  the open half, and it matters more than it did, because the only left-leaning president on
  record is at 26 and sliding.
- ~~**What impeachment does at <10 %.**~~ Answered 2026-09-17: it removes the president,
  329–106 / 74–26. See above.
- **Whether seats change outside elections.** Half answered: they change *at* one, by 25 House
  seats. But the chamber has moved much further since with no second `chamber` event and 293
  `member` events, and nothing says whether that is members being replaced or a seat's
  alignment drifting under the same member.
- **How the ballot slate is chosen**, and **what decides a ballot measure** — the two questions
  the Nov Y16 election is about to answer either way. See *Inferred*.
- **What `result_metadata.score` is measured in**, and whether it is comparable between
  cycles.

## Method disclosure

- Local grep and de-minification of bundles pulled once on 2026-08-10. No new pull, no page
  opened, no endpoint called.
- Zero requests to politiko.io: none authenticated, none public, none to `/api/*`.
- No lobbying job was created, locked, or cancelled. The POST shapes above are recorded from
  the client's own mutation definitions, not from having sent one.

For the 2026-09-17 pass:

- Every reading came from `gov-watch`'s store — the Government screen and the Herald's front
  page, filled by the operator's own navigation during normal play. No screen was opened to
  write this file, and no lobbying job was locked to produce a policy move.
- Stores were exported with [`tools/collect-stores.js`](../tools/collect-stores.js) from a
  static-file tab that never boots the app, and read with
  [`tools/read-stores.js`](../tools/read-stores.js) and one-off Node scripts. Zero requests
  to politiko.io.
- Herald entries carry game seconds, not a real timestamp. Every ET time above is computed
  from one `time-watch` sample `{t, gs, accel}` and is therefore as good as that sample —
  accurate to seconds here, but a conversion, not a reading. Spot-check: the impeachment
  edition converts to 2026-09-13 04:46Z.
- Congress members and justices are named because the game prints them to every player. No
  player username appears in this file.
