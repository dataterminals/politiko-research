# World politics surface — five populations, one scale

Measured **2026-08-26**, entirely from the client bundles already on disk from the
2026-08-10 `tools/fetch-bundles.ps1` run. **Zero requests were made to politiko.io in the
course of writing this** — no endpoint was called, probed, or re-fetched, and no page was
opened. Everything below is what the *client expects*, read out of its own code; where a
real capture later contradicts a shape here, fix it and say so.

The userscript built on it was exercised against
[`userscripts/tools/harness/`](../userscripts/tools/harness/) with invented payloads on
`localhost`, never against the live game.

Companion to [`07-alignment-surface.md`](07-alignment-surface.md), which covers the same
two axes for **one player**. This file covers everything else that carries a number on
them.

## The finding that shapes everything

**The game has no world compass, and it has all the parts for one.**

`ProfilePage` draws a compass for a player and nothing else does — that was 07's finding
and it still holds. But the client also files **every one of its twenty political issues
under one of the same two axes** (`ActivismPage`, `cat: 'social' | 'economic'`), and five
different populations carry a signed −3..+3 number on those issues:

| population | what carries the number | where it arrives |
|---|---|---|
| the law | 20 policy axes | Government, and the faction lobbying screen |
| the public | opinion-poll blocs, per issue | a poll you paid for |
| the street | protest control meters, per issue | the protests screen, and the home page |
| the media | corporate campaigns, per issue, per city | **the home page** |
| the citizens | player alignments, both axes at once | any profile you open |

So a world compass is available without asking the server anything it was not already
going to say. The composition step — mean the social issues, mean the economic ones, plot
the pair — is **not** something the game ever does, and that is the honest seam in every
figure the tool prints.

## Measured

### `GET /api/government` — the law, both chambers, the court

`GovernmentPage`, `staleTime: 6e4`, fetched when you open the screen. Gated by a
`tier1_view_government` feature check.

```
president          { name, alignment, favorability, term_number }
house              [ { alignment, count } ]      aggregated by bucket, NOT per member
senate             [ { alignment, count } ]
supreme_court      [ { id, name, alignment } ]   per justice
policies           [ { policy_id, policy_name, axis, description } ]
next_congressional_election   string
next_presidential_election    string
```

`house` and `senate` arrive **pre-aggregated into alignment buckets with seat counts** —
there is no per-member row here and therefore no per-state legislature anywhere in this
payload. `description` is optional; the client prints *"No position set"* when it is
absent, so a policy can exist with an axis and no prose.

### The −3..+3 word scale — and it is not the one the wiki uses

`GovernmentPage` carries three maps keyed by the same integer:

| | −3 | −2 | −1 | 0 | +1 | +2 | +3 |
|---|---|---|---|---|---|---|---|
| word | Tankie | Progressive | Moderate Left | Moderate | Moderate Right | Conservative | Fascist |
| short | `L++` | `L+` | `Mod-` | `Mod` | `Mod+` | `R+` | `R++` |
| colour | `#1e3a8a` | `#60a5fa` | `#bfdbfe` | `#52525b` | `#fca5a5` | `#f87171` | `#EA0C0C` |

**This contradicts the in-bundle wiki table recorded in 07** (Communist / Progressive /
Liberal / Moderate / Conservative / Republican / Far-Right). Same numeric scale, different
words, in the same shipped client. The renderer is what a player sees, so anything that
prints a word should print these.

The colour map also has entries at **−4 and +4** that the word and short maps do not
(`#0000CD` — with a doubled `#`, so it is a dead value — and `#4c0519`). The lookup tries
the raw value before clamping, so the author expected values past ±3 to be possible for
*something*. Nothing in the bundle says what.

The policy bar is a 7-cell `grid-cols-7`, i.e. the −3..+3 axis rendered as seven cells
with the current one raised — the same shape `05-people-surface.md` noticed from the other
direction.

### The 20 issues, and the axis each belongs to

`ActivismPage`'s own table — the hinge everything else turns on. 13 social, 7 economic:

```
social    free-speech police-behavior civil-rights immigration drugs abortion
          animal-research healthcare lgbt-rights gun-control torture intelligence
          womens-rights
economic  corporations elections sweatshops military nuclear-power pollution taxes
```

`ProtestPage` ships the same twenty with slightly different labels (`Police Behavior`
rather than `Police`), so anything matching on the label needs both spellings.

### The 20 policies, and how they line up

`GovernmentPage` names its twenty differently again:

```
Tax Structure · Abortion Rights · Animal Rights · Civil Rights · Healthcare · Drug Law
Free Speech · Gay Rights · Gun Control · Human Rights · Immigration · Police Regulation
Privacy Rights · Womens Rights · Corporate Law · Election Reform · Labor Laws
Military Spending · Nuclear Power · Pollution
```

Eighteen pair with an issue by their own words. The leftovers are `{Human Rights, Privacy
Rights}` against `{Torture, Intelligence}`, and the natural pairing is Human Rights↔Torture,
Privacy Rights↔Intelligence. **Both leftovers are social either way**, so a swapped guess
changes no axis figure — only which row a number is printed on. Counting confirms the
split: 13 social policies, 7 economic, exactly matching the issue table.

`Privacy Rights` is the same policy that seals profile location and the profile stats tab
(`05-people-surface.md`, `10-xp-surface.md`). It is a world policy axis with a visible
number, and it gates three separate surfaces.

### `POST /api/actions/poll` — the public, one issue at a time

`OpinionPollPage`. `GET /api/actions/poll/issues` returns `{ issues: string[] }` and
carries no data of its own — the numbers only come back from a poll you ran.

Four methods, and they differ in what the **response** contains, not only in accuracy:

| id | label | cost | shape |
|---|---|---|---|
| `street` | STREET POLL | 5 energy | three blocs |
| `online` | ONLINE SCRAPE | 5 energy | three blocs |
| `professional` | PROFESSIONAL FIRM | 5 energy + $500 | seven buckets + volatility |
| `focus_group` | FOCUS GROUP | 5 energy + $1,000 | seven buckets + persuasion angle |

```
issue          string           method       string
mood           "deadlocked" | "left-leaning" | "right-leaning" | "apathetic / persuadable"
left_bloc center right_bloc     percentages, cheap methods
far_left center_left slight_left neutral slight_right center_right far_right
                                percentages, exact methods
salience       "quiet" | "warm" | "hot" | "boiling"
volatility     "high" | "moderate" | "stable" | "unknown"
extreme_tag    string | null    best_target  string       persuasion_angle  string
cooldown_until string
```

The client's own test for which shape arrived is **`far_left === undefined`** — not the
method — so that is the test to use. Seven buckets on a −3..+3 scale is the same seven-cell
grid the policy bar draws.

### `GET /api/protests[?location_id=]` — the street

`ProtestPage` builds the URL from `/api/user/status`'s `current_location_id`, and falls
back to a bare `/api/protests` when there is no location. Rows:

```
id  issue  issue_id  meter  meter_rate  forecast_shift  end_ts
left_count right_count  left_power right_power
participants [ { username, side } ]   recent_events [ { event_type, … } ]
```

**`meter` is signed and negative is LEFT.** Measured from `protestShared`, which is
unambiguous about it in three places: the bar fills from `50 − meter/2` percent, the label
map returns `LEFT IS WINNING` for `meter < 0`, and the colours are blue below zero and red
above. Its own thresholds: `|meter| < 10` is `DEADLOCK`, `> 25` is Surging, `> 55` is
Dominating. `ProtestPage` calls a protest contested at `|meter| < 12` with both sides
non-empty — a different constant from the label map's 10, in the same bundle.

Two more pieces of the server's model, printed by the client and worth recording:

- **A protest's forecast moves `250000 · tanh(|meter| / 35)` citizens** (`l = 25e4`), and
  labels the result Marginal / Slight / Moderate / Strong at 15 / 40 / 70 % of that cap.
- **Confidence is `min(99, 50 + 49 · tanh(|meter| / 40))`**, floored at 35 in a stalemate.
- Power falls back to `count ** 0.75` when the server omits it, and the meter rate falls
  back to `0.002 · (rightPower − leftPower)`.

A dead constant `998e5` sits beside the 250k one, unused in the shipped module. If it is a
national population it would put a protest's ceiling at a quarter of a percent of it, but
nothing in the bundle says so and this is the kind of number worth *not* guessing at.

### `GET /api/protests/state-dominance` — the map

`TravelPage`, `staleTime: 15e3` **and** `refetchInterval: 15e3`, so it re-arrives every
fifteen seconds for as long as you sit on the Travel screen. One row per US state:

```
state_fips        string | number   ANSI FIPS, sometimes unpadded
dominant_side     "left" | "right"
dominance_score   number 0..100
active_protests   number
total_count       number
is_contested      boolean
```

The client keys its own map by `String(state_fips).padStart(2, '0')`, colours a state
`#2563eb` for left and `#b91c1c` for right, and **paints nothing when `active_protests`
is 0** — `dominant_side` survives the last protest ending, so a side with no active
protest is a memory rather than a reading. Fill opacity is
`0.16 + 0.34·|score|/100 + 0.14·log10(total + active + 1)/log10(20001)`, which puts the
plausible ceiling on `total_count` somewhere around 20 000.

The map itself is drawn from **us-atlas** states and **world-atlas** countries `840`, `124`
and `484` — United States, Canada, Mexico — so the world is North America and the state
codes are the real ANSI ones.

### `GET /api/locations` — the cities, and the six the map can draw

`TravelPage`, `staleTime: Infinity`. Rows carry `{ id, key, name, kind }`, and the client
hardcodes a coordinate per **key**:

| key | lon, lat | state |
|---|---|---|
| `san-francisco` | −122.4194, 37.7749 | CA `06` |
| `portland` | −122.6765, 45.5231 | OR `41` |
| `washington-dc` | −77.0369, 38.9072 | DC `11` |
| `new-york` | −74.0060, 40.7128 | NY `36` |
| `austin` | −97.7431, 30.2672 | TX `48` |
| `tijuana` | −117.0382, 32.5149 | Mexico — no FIPS |

`kind` is `overseas` for Tijuana; the client gates the smuggling stash on it. The state
column is ours, not the client's: it is where those cities are, and the FIPS codes are the
ones the state map is keyed by.

**Six coordinates is not a claim that there are six cities.** The marker layer reduces the
`/api/locations` response against that table and **returns null for any key it has no
coordinate for** — so a seventh city would exist, be travelable, and simply not be drawn.
`03-script-ideas.md` twice rules out a scanner that "walks all 14 cities", and nothing here
contradicts that count; it only shows which six the map can draw. Read the list, never the
table — which is what `world-watch` does, learning cities from any response that names
one and attaching a state only where it recognises the key.

### `GET /api/actions/graffiti` — the walls of the city you are in

`GraffitiPage`. `{ city_name, locations: [ { key, name, left_count, right_count,
total_count, difficulty, … } ], … }`, plus a separate `/api/actions/graffiti/wire` event
tail. The page sums the walls itself and calls the result **"citywide pulse"** with an
L%/R% split, so a per-city left/right figure is the game's own arithmetic, not ours.

Walls carry a side and **no issue**, so this cannot be split across the two axes. It is a
single left/right number for a city and nothing more.

### `GET /api/home/media-campaigns` — the cheapest political data in the game

`HomePage`, `staleTime: 3e4`. Rows:

```
corporation_id  corporation_name  city_name  issue  alignment  fans
```

**A per-city, per-issue, signed alignment with a reach attached, on the screen you land on
after logging in.** It is the only source in this file that is both city-scoped and
axis-splittable, and it costs a page you were opening anyway.

`GET /api/home/active-protest` sits beside it (`staleTime: 15e3`) and returns one protest
as `{ id, issue, city_name }` — **no meter**, so it names and places a protest without
saying who is winning. Useful as a join: the home page supplies the city, the protests
screen supplies the meter, and they agree on `id`.

### `GET /api/factions/{id}/jobs` — the law, again

`FactionPage`'s lobbying panel, `refetchInterval: 15e3`. Carries `policies` with the same
`{ policy_name, axis }` shape as `/api/government`, plus:

```
congress_members [ { id, chamber, seat_number, alignment, incumbent } ]
```

**Per-member at last — and with no state or district.** `factionUtils` renders a member as
`"House {seat_number} · {word}"`, which is the whole identity a seat has. So there is no
route from a legislator to a place, and per-state representation is not computable from
this client.

### Profiles

`GET /api/users/<name>` carries `alignment { social_axis, social_count, economic_axis,
economic_count }` for **anyone**, not only you — that is 07's measurement and it is what
makes a citizen sample possible at all. It also carries `privacy_rights_axis`, the world
policy value, even on a sealed view.

`location` on a profile is sealed behind Privacy Rights and, as of the 2026-08-14 field
check in `05-people-surface.md`, arrives for nobody. So citizens can be counted but not
placed, today.

## Inferred

Everything in this section is ours. None of it is something the client does.

- **Composing an axis.** Mean the −3..+3 values of the social issues for the social axis,
  and the economic ones for the economic axis. The *filing* is the game's; the mean is
  ours. It assumes issues are equally weighted within an axis, which the game has never
  said, and which its own `salience` field quietly argues against.
- **Where the poll buckets sit.** Seven named buckets across −3..+3 land on the integers.
  The coarse three are read as the midpoints of the thirds they cover (−2, 0, +2). A left
  bloc is *everything* left of centre, so its centroid is a guess about a distribution
  nobody publishes.
- **Rescaling the meter.** `meter/100 · 3` maps a protest's control onto the compass. Both
  ranges are symmetric and the target is the compass, so it is the only obvious mapping —
  but "a protest at 62 % control" and "an axis at −1.86" are not the same kind of number.
- **Weighting.** Protests are weighted by heads, campaigns by fans, policies and polls one
  apiece. Defensible, and arbitrary: fans and heads are not comparable units, and the tool
  never mixes them into one figure for that reason.
- **`right` is positive on the social axis too.** This is the same assumption `align-watch`
  already makes when it projects a `left`/`right` protest action onto a player's social
  axis. On the player compass +social is `AUTHORITY`, and "the right-wing side of an
  abortion protest" is not self-evidently the authoritarian one. The arithmetic is
  consistent with the rest of the repo; the semantics are an open question.
- **City → state.** Real-world geography, applied to a hardcoded list of six cities. A
  seventh city would need a line, and would get one rather than a guess.

## What this makes buildable

[`userscripts/world-watch.user.js`](../userscripts/world-watch.user.js) — the compass
redrawn from `ProfilePage`'s own constants with a marker per population instead of one for
a player, plus the same breakdown per city, the 20-issue table the axes are built from,
and a per-endpoint freshness list. Zero added requests; every row fills from a screen you
were going to open anyway, and the panel says which screen fills which row.

Two things it deliberately does not do:

- **Plot a single "world" point.** Five populations disagree, and averaging them would
  invent a sixth number with no source. They are drawn together and left apart.
- **Refresh.** Nothing here re-reads anything. Every figure is as old as the last time the
  operator looked at the screen carrying it, and each row prints its own age.

## Still unknown

- **What lives at ±4.** The colour map has entries the word map does not.
- **Whether policy axes are integers.** Every renderer treats them as one of seven cells,
  but nothing clamps or rounds on the way in, so a fractional axis would render at the
  nearest cell and print unrounded. Player axes are known floats (07).
- **What the server means by `dominance_score`.** It is 0..100 and it drives an opacity;
  whether it is a share of participants, of power, or of something else is not readable.
- **Whether `total_count` on the state map counts protests, participants, or actions.** The
  opacity formula's `log10(20001)` implies a ceiling around 20 000, which is two orders of
  magnitude above the player population — so it is probably not people.
- **Whether opinion polls are national.** The POST body is `{ issue, method }` with no
  location, so they read as country-wide, but a server that quietly scoped them to your
  current city would look identical from here.
- **What moves a policy axis, and how fast.** Bills and protest forecasts both claim to;
  neither is measured.
- **Whether NPC citizens carry alignment.** Profiles have `is_npc`, and if NPCs have
  compass positions the citizen sample is really two populations wearing one hat.

## Method disclosure

- Local grep and de-minification of bundles pulled once on 2026-08-10. No new pull, no
  page opened, no endpoint called.
- Zero requests to politiko.io: none authenticated, none public, none to `/api/*`.
- The userscript was exercised on `localhost:8146` against
  `userscripts/tools/harness/fixtures.js`, whose payloads are invented from the shapes
  above. The harness replaces `fetch`, `WebSocket` and `XMLHttpRequest` with inert stubs
  before the tool loads, so nothing in that session could have reached the game.
