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

- **`status` is an enum**, but only `"active"` was ever observed across ~50 sampled rows
  and two profiles. The other values are guesses from the game's own vocabulary.
- **`locations_visible: false` implies a mode where it is true** — some condition, item,
  or rank that reveals player locations on the roster. Nothing was probed to find out.
- `page_size` is fixed at 10 in every observed call. Whether the endpoint honours a
  larger value is unknown and was not tested — that would be probing.
- `rank_key: "punchbag"` on both sampled players suggests it is the entry rank, and that
  `rank_key` is a stable machine value paired with the display-only `rank_title`.

## Still unknown

- **Whether the roster supports sort or filter parameters.** The UI may expose controls
  that would make the whole build unnecessary. Worth looking at before anything else.
- **Whether the WebSocket carries presence.** If it broadcasts online/offline events for
  other players, activity data could be accumulated with zero requests — which is the
  version of this tool that would have stayed inside the clause. `wss://politiko.io`
  remains completely uncharacterized.
- What `alignment.social_axis` / `economic_axis` range over, and whether `*_count` is a
  vote tally or a sample size.
- Whether `/api/users/<name>` is rate-limited, and what it returns for a deleted or
  banned account. The crawler stops dead on the first non-2xx rather than finding out
  by pushing.
