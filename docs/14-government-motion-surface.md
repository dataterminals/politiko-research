# Government motion surface — what moves, how fast, and who gets to watch

Measured **2026-08-26**, entirely from the client bundles already on disk from the
2026-08-10 `tools/fetch-bundles.ps1` run. **Zero requests were made to politiko.io in the
course of writing this** — no endpoint was called, probed, or re-fetched, and no page was
opened. Everything below is what the *client expects*, read out of its own code; where a
real capture later contradicts a shape here, fix it and say so.

Companion to [`13-world-politics-surface.md`](13-world-politics-surface.md), which measures
the government as a **position**. This file measures it as a **trajectory**: which fields
can change, where a change becomes visible, and how long you have to be looking.

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
| gated by | `tier1_view_government` feature check | faction membership |
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
  countdown here real rather than projected.
- **What moves a policy axis besides lobbying.** Protest `forecast_shift` claims to (13);
  bills are not in this client at all; the relationship between a resolved job's `score` and
  the size of the axis move is not printed anywhere.
- **Whether axes are integers.** Unchanged from 13 — but now with three specific render
  symptoms that would make a fractional value visible if one ever arrives.
- **What moves presidential favorability, and how fast.** No feed, no history, no formula.
- **What impeachment does at <10 %.** The string ships; the mechanic is not in the client.
- **Whether seats change outside elections.** `incumbent` is a per-member boolean, which
  implies seats can be open — but nothing says whether a seat's alignment can move without
  the member changing.
- **What `result_metadata.score` is measured in**, and whether it is comparable between
  cycles.

## Method disclosure

- Local grep and de-minification of bundles pulled once on 2026-08-10. No new pull, no page
  opened, no endpoint called.
- Zero requests to politiko.io: none authenticated, none public, none to `/api/*`.
- No lobbying job was created, locked, or cancelled. The POST shapes above are recorded from
  the client's own mutation definitions, not from having sent one.
