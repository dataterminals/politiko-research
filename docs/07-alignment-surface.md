# Alignment surface — the compass, and what moves it

Measured **2026-08-07**, entirely from the client bundles already on disk from the
2026-08-03 `tools/fetch-bundles.ps1` run, plus the authenticated capture recorded in
[`05-people-surface.md`](05-people-surface.md). **Zero requests were made to politiko.io
in the course of writing this** — no endpoint was called, probed, or re-fetched. The
userscript built on it was verified against a local harness serving fabricated payloads
on `localhost`, never against the live game.

## The finding that shapes everything

`social_axis` appears in **exactly one** of the ~80 route chunks: `ProfilePage`. Nothing
else in the client reads or renders alignment — not the sidebar, not `HomePage`
(its `alignment` string belongs to media campaigns, an unrelated field).

So alignment is a **profile-only surface**. There is exactly one response that carries it,
and it is fetched only when a player profile is opened. Any home-page overlay is therefore
a *mirror of your last reading*, not a live figure — the live version would require
originating a request, which is the thing this repo doesn't do by default.

## Measured

### The payload

`GET /api/users/<name>` (July capture, 05-people-surface):

```
alignment  social_axis      number
           social_count     number
           economic_axis    number
           economic_count   number
```

`ProfilePage` renders `*_count` as literally `"<n> actions"`, which settles 05's open
question: **the counts are per-axis sample sizes, not vote tallies.**

### What ProfilePage fetches

Route `profile/:username`. The same three calls fire for your own profile as for anyone
else's — there is no separate self endpoint:

```
queryKey ['profile', name]           GET /api/users/{name}      ← carries alignment
queryKey ['profile-stats', name]     GET /api/users/{name}/stats
queryKey ['profile-holdings', name]  GET /api/users/{name}/holdings
```

### The compass, decompiled

The chart is a hand-rolled SVG, `viewBox 0 0 220 220`, plot box `16..204` (188 px):

```
clamp(v) = max(-3, min(3, v))
x = 16 + (clamp(economic) + 3) / 6 * 188      // −3 at left,  +3 at right
y = 16 + (3 − clamp(social))  / 6 * 188      // +3 at TOP,   −3 at bottom
```

| Position | Axis end | Label | Quadrant tint |
|---|---|---|---|
| top | social +3 | `AUTHORITY` | top-left `AUTH·LEFT` red |
| bottom | social −3 | `LIBERTY` | top-right `AUTH·RIGHT` blue |
| left | economic −3 | `L` | bottom-left `LIB·LEFT` green |
| right | economic +3 | `R` | bottom-right `LIB·RIGHT` amber |

Gridlines at ±1 and ±2; marker is a crosshair plus an r=8 ring and an r=3 dot. Axis values
print signed to one decimal (`e > 0 ? '+'+e.toFixed(1) : e.toFixed(1)`), so **the axes are
floats**, not integers — the −3…+3 scale is continuous, and the display rounds it.

### The −3…+3 name scale (in-bundle wiki, slug `alignment`)

| −3 | −2 | −1 | 0 | +1 | +2 | +3 |
|---|---|---|---|---|---|---|
| Communist | Progressive | Liberal | Moderate | Conservative | Republican | Far-Right |

**Notation clash worth knowing:** that table is written for entities carrying a *single*
left→right score — congress members, the President, cabinet, justices, and the 20 policy
axes. The player compass splits the same numeric range across two axes and names the
vertical one authority/liberty. So the words map cleanly onto a player's **economic** axis
and not onto the social one. Anything that stamps "Communist" on a social axis of −3 is
inventing a label the game never applies.

> **The shipped client disagrees with the shipped wiki — found 2026-08-26.**
> `GovernmentPage` carries its own word map for the same seven integers, and it is not the
> one above: **Tankie · Progressive · Moderate Left · Moderate · Moderate Right ·
> Conservative · Fascist**, with the short codes `L++ L+ Mod- Mod Mod+ R+ R++`. The
> renderer is what a player actually sees, so that is the list to print. It also has
> colours at **±4** that the word list has no entry for. See
> [`13-world-politics-surface.md`](13-world-politics-surface.md), which covers the same
> two axes for everything in the world that is not a player.

### How a player's alignment is computed

The wiki states, in prose, that a player's alignment is a **running average** of social and
economic positions, held per axis (it names the table `player_politics`), and that protest
participation and civil disobedience are what shift it.

That, plus the "N actions" render, is the whole model the client discloses: each axis is a
mean over `count` samples.

### The 20 issues and which axis they belong to

From `ActivismPage`'s own table — 13 social, 7 economic:

| social | economic |
|---|---|
| Free Speech · Police · Civil Rights · Immigration · Drugs · Abortion · Animal Research · Healthcare · LGBT Rights · Gun Control · Torture · Intelligence · Women's Rights | Corporations · Elections · Sweatshops · Military · Nuclear Power · Pollution · Taxes |

### The actions that carry a direction

```
GET  /api/disobedience/preview?issue_id=&site_key=&leaning=   → swing / jail / mob / difficulty
POST /api/disobedience        { issue_id, site_key, leaning }  costs 5 juice
POST /api/protests            { issue_id, stance, location_id } costs 50 energy
POST /api/protests/{id}/join  { side }
POST /api/actions/graffiti    { location_key, side, mode }
```

`side` is `left | right` in every chunk that sets it. The protest *organiser* picks a
`stance`, which the wiki describes as −3…+3 and non-zero; a *joiner* only picks a side.
`GET /api/protests?location_id=` already lists each protest's `issue_id`, so a join can be
attributed to an axis without asking the server anything extra.

Civil disobedience invalidates `['attributes', 'status']` on success — **not** the profile.
Nothing in the client refetches alignment after an action that changes it.

### `GET /disobedience/context` — the crowd, the clock, and one global skill

Read from the **2026-09-03** bundles rather than the 2026-08-03 pull this file opened with
(`ActivismPage-l1era8Zl.js`). The field readings are the operator's, **2026-09-06**, from a
screen they had open in normal play.

`ActivismPage` makes two queries, and the difference between their keys is the finding:

```
queryKey ['disobedience-context']            GET /api/disobedience/context
queryKey ['disobedience-preview', S, E, F]   GET /api/disobedience/preview?issue_id=&site_key=&leaning=
```

**The context key carries no issue, and neither does its URL.** It is fetched when the
screen mounts and never refetched when the issue selector moves. Four fields, all read by
the render:

```
mastery     number 0..100
sites       [ { key, name, ward, base_traffic, risk, risk_label, affinity } ]
game_hour   number 0..23
available   boolean
```

#### `mastery` is one number for the player, not one per issue

[`10-xp-surface.md`](10-xp-surface.md) records where `mastery` is read and its tier
vocabulary — **learning** below 35, **practiced** 35–59, **fluent** 60+ — but not its
scope. The scope is settled twice over: the query key above cannot vary by issue, and the
operator reports **68 / 100 on every issue tried** (2026-09-06). There is no boundary above
60, so past `fluent` the number is a smooth input with no tier left to reach.

The consequence is about the *other* query. `difficulty` is keyed on
`[issue, site, leaning]` and reads, in the screen's own words, *"on your skill, the public
mood, and the crowd."* With skill constant across issues, **every difficulty difference
between two issues at the same site and hour is mood and crowd with skill divided out** —
which makes the preview a free read on where the public is currently soft, and means
spreading effort across issues costs nothing in skill terms.

#### The foot-traffic curve, hardcoded in the render

```js
function p(e){ return e>=0&&e<=5 ? .25 : e>=6&&e<=8 ? .7 : e>=9&&e<=16 ? 1 : e>=17&&e<=21 ? 1.3 : .5 }
m = (base, hour) => Math.max(0, Math.min(1.3, base/100 * p(hour)))
h = t => t<.3 ? `sparse` : t<.6 ? `moderate` : t<.9 ? `busy` : `packed`
```

| game hour | multiplier |
|---|---|
| 00–05 | 0.25 |
| 06–08 | 0.70 |
| 09–16 | 1.00 |
| **17–21** | **1.30** |
| 22–23 | 0.50 |

A **5.2× spread** between the worst window and the best, on an action costing a flat 5
juice at every hour. The 1.3 appears twice — as the evening multiplier and as the clamp —
so a site at `base_traffic ≥ 100` sits at the ceiling from 09:00 and gains nothing from the
evening. The curve only pays on sites below that.

Against [`06-time-surface.md`](06-time-surface.md)'s 52.14×, a game hour is **≈ 69 real
seconds**, so the 17–21 window is about **5 m 45 s of real time, recurring every ≈ 27.6
minutes**.

**What the curve is not known to do is move `difficulty`.** The preview URL carries only
`issue_id`, `site_key` and `leaning` — no hour — so any crowd term is applied server-side
and is not readable from here. See *Still unknown*.

#### Site risk is a tier and a costume

Each site carries two risk fields and only one of them is a scale:

```
risk        "low" | "med" | "high" | "extreme"     drives the badge colour
risk_label  free text from the server              what the badge says
```

| `risk` | colour |
|---|---|
| `low` | `--cd-green` |
| `med` | `--cd-amber` |
| `high` | `--cd-rust` |
| `extreme` | `--cd-red` |

Labels observed in San Francisco, 2026-09-06, on `sf-01`…`sf-05`: **PRIVATE** (Embarcadero
Plaza · Financial), **STATE** (Civic Center Steps · Civic Center), **PATROL** (Mission
Underpass · The Mission), **COPS** (Tenderloin Corner · Tenderloin), **MALL SEC** (Pier 39
Boardwalk · Waterfront). Five sites, one ward each. **The label is flavour and the tier is
the field** — anything ranking sites by danger reads `risk`, never the word on the badge.

#### `affinity` — the one per-issue thing in an issue-independent payload

```js
n = e.affinity.includes(S)      // S is the selected issue id
```

A site carries a **list of issue ids it is friendly to**, delivered up front for every
issue — which is why the context fetch never needs the selected one. When the selected
issue is in the list the row prints **`friendly`** *in place of* the traffic word, so a
friendly site's `sparse`/`busy`/`packed` reading is not shown at all and has to be computed
from `base_traffic` if it is wanted.

**None of San Francisco's five sites was friendly to Women's Rights** on 2026-09-06 — all
five printed a traffic word. That is one issue in one city on one day, not a claim that SF
has no friendly sites.

#### The preview's two numbers are one number

Correcting the shape recorded above: `swing` and `difficulty` are not independent.
Measured across two field readings at the same issue, site and hour, differing only in
leaning — Women's Rights at Pier 39 Boardwalk, 16:00, 2026-09-06:

| leaning | difficulty | `swing` | jail | mob |
|---|---|---|---|---|
| center-left (−2) | 0.10 | 90 % | 3 % | 0 % |
| hard left (−3) | 0.14 | 86 % | 4 % | 0 % |

`swing === round((1 − difficulty) × 100)` in both. The screen renders the pair twice and
**in opposite directions** — the bar's width is `difficulty × 100` while the label beside
it is the complement — so a nearly-empty bar reading *"trivial · 90 % swing"* is an easy
action, and a **longer bar is a harder one**.

`swing` is therefore a **probability of success, not a size of effect**. Nothing on the
screen previews magnitude; `people_moved` arrives only on the response, and it is signed —
[`10-xp-surface.md`](10-xp-surface.md) records the payload, and the render tags a negative
value `· backfire`.

#### The leaning selector names a cost the numbers do not carry

The seven stances render their own prose, and it is written in terms of visibility:

| leaning | text |
|---|---|
| −3 | *"Hard left. Maximum swing, maximum heat. **The watchlist notices.**"* |
| −2 | *"Center-left. Earnest, organized, on-message."* |
| −1 | *"Slight left. Cautious framing — **keeps you off the radar**."* |
| 0 | *"Neutral. A measured line. Narrow swing, **low visibility**."* |
| +1 | *"Slight right. Order-first framing. Quiet…"* |

Read against the table above it: moving −2 → −3 costs **four points of success probability
and one point of jail risk**. `jail` is the arrest roll and that is the whole of what the
preview prices. **"The watchlist" carries no number anywhere in the client** — so the
flavour text describes a consequence the preview does not model, and anything reporting the
preview's percentages as the cost of a stance is under-reporting it.

### Session identity, free of charge

`GET /api/user/status` is polled every 10 real seconds (`refetchInterval: 1e4`) and carries
`username`, `status`, and `current_location_id`. That is a zero-cost way for a passive tool
to know who you are.

### API client shape

Base is `https://politiko.io/api`; every call goes through `fetch()` with
`Authorization: Bearer <token>` read from the `auth` localStorage key, plus `X-CT-*`
fingerprint headers (timezone, screen, language, platform, canvas). A `window.fetch` tap
therefore sees everything, and no tool has any business touching the `auth` key.

### Drift since the July capture

05-people-surface recorded `/api/user/{name}` and `/api/user/{name}/sidebar`. Neither is in
the 2026-08-03 bundle, which instead has `/user/money`, `/user/config/sidebar`, and
`/user/status`. The own-session surface was reshaped between the two dates — worth
remembering before trusting any endpoint list in this repo as current.

## Inferred

- **Marginal impact.** If the running average is an unweighted mean, one more action at
  stance `s` moves an axis from `a` to `(a·n + s)/(n + 1)`. Consequence: influence decays
  as `1/(n+1)`, so an axis with 47 samples barely moves, and a fresh character's alignment
  is volatile. This is the single most useful thing to know before spending juice, and it
  is a guess about the server from one sentence of wiki prose.
- **Counts increment per action, per axis.** Implied by separate counts and by the "N
  actions" label; never observed incrementing.
- **Magnitude of a `left`/`right` action is unknown.** The payload carries no number, so
  its effect can only be bounded (|s| between 1 and 3).
- **Whether graffiti moves personal alignment at all.** It takes a `side`, but the wiki
  names only protests and civil disobedience.
- **Whether a busted action still counts.** Disobedience can return `jailed` /
  `hospitalized` / `people_moved: 0`; whether the server still records the stance is
  unknown.
- **The evening window is worth timing around.** Rests entirely on the crowd being an input
  to `difficulty`, which the screen claims in prose (*"and the crowd"*) and which no reading
  has confirmed. If `p(hour)` only drives the sparse/busy/packed word, the 5.2x spread is
  decoration and the window buys nothing.
- **What "maximum swing" buys.** The stance prose promises magnitude and the preview prices
  only probability, so the -2 -> -3 trade is four points of success for an unknown premium.
  The only route to it is logging `people_moved` against `leaning` at a fixed issue, site
  and hour — actions the operator is taking anyway.
- **`risk` and `jail` are related but not measured as such.** A tier per site and an arrest
  percentage per preview are two different numbers, and nothing joins them. Pier 39
  (`MALL SEC`) previewed 3-4 % jail; whether that is its tier or its crowd is not separable
  from one site.

## What this makes buildable

[`userscripts/align-watch.user.js`](../userscripts/align-watch.user.js) — the compass on the
home page, redrawn from the constants above, from the last `/api/users/<you>` response the
app fetched because you opened your own profile. It adds no requests. It also:

- keeps a change log of your own readings (localStorage `pkaw:`), so drift is visible
  over sessions and the trail is drawn on the chart;
- logs alignment-affecting actions you submit between readings, attributes each to an axis
  via the issue table, and draws the projected landing zone as a **range** (|s| = 1…3),
  clearly marked inferred;
- prints, per axis, what one more ±3 action would do at your current sample size.

Its honest limitation, stated in the panel itself: the number is as fresh as your last
profile visit. Only two things would make it live, and both are outside the passive default
— originating a request, or the WebSocket turning out to push profile updates.

## Still unknown

- The stored precision and true range of the axes (display clamps to ±3 and rounds to 1 dp;
  the server may hold more).
- Whether the mean is unweighted, or whether recent actions count for more.
- Whether anything other than protests, disobedience and graffiti moves it — opinion polls,
  donations, voting, bill sponsorship.
- Whether player alignment *gates* anything, or is purely cosmetic for players. Every
  mechanical effect the wiki describes (vote weight, veto behaviour, extremist bonuses)
  belongs to NPCs and policy axes.
- What `/api/users/{name}/stats` carries — it was never captured.
- Whether `alignment` is ever `null` for another player (ProfilePage renders "not
  disclosed" for a falsy value, so a privacy setting probably exists).
- **Whether `p(hour)` reaches `difficulty`, or only the traffic label.** The cheapest open
  question in this file: hold issue, site and leaning still, let the game clock roll from
  16:00 to 17:00, and read the same preview twice. The app fetches it on its own while the
  selectors sit, so the check adds no request and spends no juice.
- **What the watchlist is** — a player-visible surface, an enforcement counter, or prose.
  `ActivismPage`'s -3 stance is its only occurrence in the client outside `StocksPage`,
  where the same word means the instruments list and is unrelated. **It is not the `fedded`
  system**: that is `FeddedPage` + `GET /fed/appeal`, whose own copy reads *"Federal
  Detention / Custody"*, *"All game systems locked until release"* and *"Awaiting review by
  a moderator"* — staff moderation wearing game fiction, with `fedded`, `fedded_until`,
  `fedded_permanent` and `fedded_reason` on the session object. Two systems that both sound
  like law enforcement, and conflating them would misprice both.
- **The range of `base_traffic`**, and whether any site sits at or above the 1.3 clamp where
  the evening multiplier stops paying.
- **Which sites are friendly to which issues.** `affinity` is delivered for every issue at
  once, so one reading of `/disobedience/context` in a city enumerates the whole map for
  that city — but it is per city, and only the six drawable cities in
  [`13-world-politics-surface.md`](13-world-politics-surface.md) are even known by name.

## Method disclosure

- Local grep and de-minification of bundles pulled once on 2026-08-03. No new pull.
- **2026-09-06 addition:** local grep of `ActivismPage-l1era8Zl.js` from the **2026-09-03**
  pull already on disk — the same run `20-newspaper-surface.md` was written from. No new
  pull, no page opened, no endpoint called.
- The 2026-09-06 field readings — `mastery` 68/100 across issues, the five San Francisco
  sites with their wards and badges, and the two preview rows — are the **operator's own
  screen during normal play**, supplied as screenshots. The previews are ones the app
  fetches itself as the selectors sit; no action was committed to produce them, and no
  request originated here.
- Zero requests to politiko.io: none authenticated, none public, none to `/api/*`.
- The userscript was exercised in a local page on `localhost:8177` with invented
  payloads — self-identification, own-profile readings, another player's profile
  (correctly ignored), a protest list, a disobedience POST and a protest join — plus
  synthetic pointer gestures for the drag behaviour. The live game was never opened.
