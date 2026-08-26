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

## Method disclosure

- Local grep and de-minification of bundles pulled once on 2026-08-03. No new pull.
- Zero requests to politiko.io: none authenticated, none public, none to `/api/*`.
- The userscript was exercised in a local page on `localhost:8177` with invented
  payloads — self-identification, own-profile readings, another player's profile
  (correctly ignored), a protest list, a disobedience POST and a protest join — plus
  synthetic pointer gestures for the drag behaviour. The live game was never opened.
