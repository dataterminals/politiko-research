# People surface

Measured **2026-07-28** from an authenticated session, by reading responses the app
fetched on its own while the player browsed the People tab and opened two profiles by
hand. Evidence: the throwaway `people-probe` passive tap, 330 captured `/api/*`
responses. No endpoint was probed — `/api/users/<name>` was observed because the player
clicked a player, which is the request the app itself sends.

This is the last measurement taken under the passive-only posture. What was built on top
of it is not passive; see the operator decision in
[`01-rules-envelope.md`](01-rules-envelope.md).

## Measured

### `GET /api/people?page=N` — the roster

```
envelope   locations_visible  boolean = false
           page               number = 1
           page_size          number = 10
           total              number = 292
           total_pages        number = 30
           people             array[10]

row        username           string
           status             string = "active"
           in_city            boolean = false
```

**Three fields per row, and none of them is activity.** This is the finding that shaped
everything downstream: the roster cannot be sorted by last-active because it does not
carry last-active, at any precision.

`status` is a false friend — it reads `"active"` for a player who has not logged in for
four days, so it is account standing (the counterpart values are presumably banned /
jailed / dead), not a liveness signal. It does not move when someone stops playing.

#### The row is wider than this capture — read off `PeoplePage` in the 2026-08-03 bundle on 2026-08-14

```
row        location_name      string        rendered as `location_name ?? "Unknown"`
```

The roster carries the **city name**, not just the `in_city` boolean. Both the name and
the `In city` badge sit behind one gate: `R = locations_visible ?? true`. The July capture
recorded `locations_visible: false`, which is why neither reached the transcript — the
client had them and rendered nothing.

That resolves the inferred item below in the useful direction. The mode where locations
are visible is not hypothetical; it is the client's **default when the field is absent**,
and it hands you ten cities per roster page instead of one per profile opened.

**`status` is a six-value enum**, and the client has held the full vocabulary all along —
three label maps keyed by it, read off `ProfilePage` in the same bundle:

| value | roster | profile | meaning |
|---|---|---|---|
| `active` | online | online | free to act, no sentence or detainment |
| `jailed` | jailed | detained | currently detained |
| `hospitalized` | hosp | hospitalized | in hospital |
| `in_combat` | combat | in combat | in an active combat session |
| `traveling` | travel | in transit | **travelling between locations** |
| `dead` | dead | deceased | deceased |

Only `"active"` was ever observed in the July capture, which is what made it look like a
one-value field. It is the counterpart to `location_name`: the name says where, `status`
says whether they are still there.

#### The roster takes filter parameters — same file, same date

`/api/people` is built by the client as:

```
page           number
in_city        "true"    when the In-city filter is ticked
jailed         "true"
hospitalized   "true"
q              string    free-text search — gated behind `insider === true`
```

#### Field check 2026-08-14: both location paths are shut

Measured in ordinary play, not probed. Opening profiles returns **no `location` field at
all** — the game's own stat box renders `UNAVAILABLE` over `[ signal lost ]`, which is
exactly `V.location ?? "UNAVAILABLE"` with `sub: V.location ? "visible" : "[ signal lost ]"`
falling through. people-watch 1.3.x recorded a city for zero of the profiles read.

So location visibility is server-side and currently off on both paths, and it is **a
world policy gate of the same family that seals the stats tab**. `GovernmentPage` carries
20 policies keyed by name — Tax Structure, Abortion Rights, Animal Rights, Civil Rights,
Healthcare, Drug Law, Free Speech, Gay Rights, Gun Control, Human Rights, Immigration,
Police Regulation, **Privacy Rights**, Womens Rights, Corporate Law, Election Reform,
Labor Laws, Military Spending, Nuclear Power, Pollution — each rendered on a 7-cell
`grid-cols-7`, i.e. the −3..+3 axis the compass uses.

**What is not knowable from the client:** the threshold. For stats and holdings the
sealed view prints its own requirement (`privacy rights axis {n} · requires 3`, and
`requires 2+`), and `privacy_rights_axis` appears in `ProfilePage` exactly twice — both
of those. Location has no such string: the server simply omits the field and, on the
roster, reports the outcome as the `locations_visible` boolean. So we can say location is
gated and currently shut; we cannot say at what value it opens, and finding out by
experiment is not available to us.

This answers **"whether the roster supports sort or filter parameters"** in Still unknown:
filters yes, sort no. Nothing here was probed — the parameter list was read out of the
client's own URL builder. Note what that means under the envelope: these are filters *the
game itself sends when you tick its checkboxes*, so they arrive for free while browsing.
Constructing one ourselves would be originating a request, which is a different thing.

### `GET /api/users/<name>` — a profile

Fires when you click a player. One request, one player.

```
username           string
role               string = "user"
is_insider         boolean
status             string = "active"
status_until       null
quip               null
created_at         string  "2026-07-24T05:13:05.489763Z"
race               string
sex                string
age                number
profile_picture_url null
marital_status     string
alignment          object{social_axis,social_count,economic_axis,economic_count}
combat_record      object{attacks_won,attacks_lost,mugs_won,times_mugged,
                          money_mugged,money_lost_to_mugs,hospitalizations_caused}
relationship       object{is_friend,is_enemy,blocked_by_you,blocked_by_them}
is_online          boolean
last_online        string  "2026-07-24T05:52:24.036874Z"
is_npc             boolean
rank_key           string = "punchbag"
rank_title         string
```

**The payload grew after this capture.** Read off `ProfilePage` in the 2026-08-03 bundle
on **2026-08-07**, the same response also carries membership and place:

```
faction_id         number | null      faction_rank  string   ("member", …)
faction_name       string | null      corp_role     string
corp_id            number | null      location      string
corp_name          string | null
```

`ProfilePage` renders each as a stat box linking to `/factions/{id}` and
`/corporations/{id}`. None of it appears in the July capture above, so either the fields
were added or they were null for both sampled players and dropped from the recording —
the bundle proves the client expects them, not that the server always sends them.

This is the second drift found in this file (see the endpoint note below), and the reason
matters more than the fields: a payload recorded once is a snapshot, and anything built on
it should re-read the client rather than trust the transcript.

**`last_online` is an exact ISO timestamp with microsecond precision.** The "N days" the
UI shows is client-side rounding, not the limit of what the server sends. Anything built
on this can be strictly more precise than the game's own display.

**`created_at` vs `last_online` is a sharper signal than idle time.** One sampled account
was created at `05:13` and last seen at `05:52` — thirty-nine minutes of play, then gone.
Another registered sixteen days before its last login. The UI renders both as "4 days"
and cannot distinguish them. The gap between the two fields is a free never-engaged
detector, and it costs nothing extra to compute.

### Observed authenticated API surface

Every distinct endpoint the client called during one session, normalized:

```
GET /api/user/{name}            GET /api/time
GET /api/user/{name}/sidebar    GET /api/chat/settings
GET /api/users/{name}           GET /api/notifications/counts
GET /api/people                 GET /api/subscription
GET /api/attributes             GET /api/newspaper
GET /api/effects                GET /api/stocks/tax
GET /api/combat/active
```

Note the singular/plural split: `/api/user/{name}` and `/api/user/{name}/sidebar` serve
your own session; `/api/users/{name}` is another player. This is the first authenticated
surface recorded anywhere in this repo —
[`00-recon-baseline.md`](00-recon-baseline.md) was taken logged out and covers only the
four `/api/public/*` endpoints.

`GET /api/user/status` also carries `updated_at` at microsecond precision, which is what
first suggested the backend emits exact times everywhere rather than pre-rounded ones.

## Inferred

- ~~**`status` is an enum**, but only `"active"` was ever observed.~~ **Answered
  2026-08-14** — six values, read off the client's own label maps. See the table above.
- ~~**`locations_visible: false` implies a mode where it is true.**~~ **Answered
  2026-08-14** — it is the client's default when the field is absent, and it reveals a
  `location_name` per row. What flips it server-side is still unknown, and still not
  worth probing for.
- `page_size` is fixed at 10 in every observed call. Whether the endpoint honours a
  larger value is unknown and was not tested — that would be probing.
- `rank_key: "punchbag"` on both sampled players suggests it is the entry rank, and that
  `rank_key` is a stable machine value paired with the display-only `rank_title`.

## Still unknown

- ~~**Whether the roster supports sort or filter parameters.**~~ **Answered 2026-08-14** —
  it takes `in_city`, `jailed`, `hospitalized` and an insider-gated `q`, but **no sort
  parameter**, so ranking by last-active still has to be built locally. See above.
- **At what value the Privacy Rights axis opens locations.** Narrowed 2026-08-14 to "a
  world policy axis, currently shut on both paths" — but unlike stats (`requires 3`) and
  holdings (`requires 2+`), the client never prints a threshold for location, so the
  number is not readable from the bundle. Watching the Government page across a policy
  change is the only honest way to learn it, and it costs nothing but patience.
- **Whether location and the stats seal move together.** Both are Privacy Rights and both
  are shut, so a single policy move may open the city column and the stat sheet at once —
  which would make this the second tool waiting on the same vote. See
  [`10-xp-surface.md`](10-xp-surface.md).
- ~~**Whether the WebSocket carries presence.**~~ **Answered 2026-08-07 — it does.**
  `/ws/chat` pushes `{type:"presence", username, online}`, measured on the wire.

  **Whether the server *seeds* it at connect is still open**, and an earlier version of
  this note said otherwise. `ws-watch` reported "SEEDED", but its rule — three frames
  within 10 s of a connect — cannot tell a seed from clustered transitions, and the
  session that produced it was deliberately reload-heavy because the tool asked for that.
  If seeding holds, a passive observer gets the **roster** rather than only the edges,
  which is the version of this tool that stays inside the clause. It is not proven.
  See [`09-socket-surface.md`](09-socket-surface.md).

  Four things to carry into any build:
  - The frame carries **exactly** `username` and `online`. No timestamp — so a tap yields
    the *client's* receive instant, not a server one. No `room_id` either, which was the
    one field that would have refuted the app-wide scope reading.
  - **It includes your own username**, and the client applies no self-filter, so the
    game's `● N` is off by one.
  - The client's set is **never cleared**, so the badge over-counts across a long session.
    A tool must track connection epochs itself.
  - **"Online" means holding a `/ws/chat` connection** — closer to "has the game open"
    than to "is playing". Broader and faster than a polled `is_online`, but **noisier and
    harder to segment**: no timestamp, no way to separate a seed from a transition, and
    it counts you.

  For *faction-scoped* presence the public `/factions/{id}/public`, polled at 5 s with
  `members[].is_online`, remains simply better. See
  [`09-socket-surface.md`](09-socket-surface.md).
- ~~What `alignment.social_axis` / `economic_axis` range over, and whether `*_count` is a
  vote tally or a sample size.~~ **Answered 2026-08-07** from the client bundles: the axes
  are floats clamped to −3…+3 for display, and `*_count` is a per-axis **sample size** —
  the client renders it as "N actions" and the wiki calls the axis a running average. See
  [`07-alignment-surface.md`](07-alignment-surface.md).
- Whether `/api/users/<name>` is rate-limited, and what it returns for a deleted or
  banned account. The crawler stops dead on the first non-2xx rather than finding out
  by pushing.
