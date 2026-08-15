# Faction raid surface

Prompted by a real faction war against **RE:PUBLIC**, 2026-08-14.

**Read off the 2026-08-03 bundle on 2026-08-14. Nothing here is a measured payload yet.**
That distinction matters more in this file than in most: every field below is something
the *client* reads, which proves the client expects it, not that the server sends it.
`05-people-surface.md` has been burned twice by treating a client read as a measurement,
and once by treating a single capture as the whole shape. Treat this file as a map of
where to point a tap, not as a record of what came back.

The game's word is **raid**, not war. Nothing in the bundle uses "war" as a data term.

## The endpoints

### `GET /factions/{id}/raids?events_page=N&events_limit=5` — the live one

```
{ raids: [ … ], events: [ … ] }
```

**The client polls this every five seconds** (`refetchInterval: 5e3`) for as long as the
faction page is open, and the events half is paginated at five per page. That single fact
is the most useful thing in this document, and section *What this makes possible* below is
about it.

### `GET /factions/{id}/raids/{raidId}/report` — the post-mortem

Rendered by `FactionRaidReportPage`. Survives the raid, so a finished war is still
readable — this is the path to a complete record of the RE:PUBLIC fight.

### Write endpoints — listed so they are recognised, never called

```
POST /factions/{id}/raids/{raidId}/cease
POST /factions/{id}/raids/{raidId}/surrender           request one
POST /factions/{id}/raids/{raidId}/accept-surrender
POST /factions/{id}/raids/{raidId}/flag-override       impose your flag on them
```

Four buttons on the faction page, gated by four server-sent permission booleans. They are
recorded here for identification only. Rule 1 of the envelope: we consume, we do not
request, and a raid action is about as consequential a write as this game has.

## The raid object

```
id                      status              "active" | "surrender_requested" | …
attacker_faction_id     attacker_faction_name    defender_faction_name
attacker_score          defender_score
attacker_members        defender_members
attacker_power_taken    defender_power_taken
committed_power         committed_cash           cycle_month
created_at              last_scored_at           score_history[]
effective_flag_url      player_status
can_cease  can_request_surrender  can_accept_surrender  can_impose_flag
```

The client renders `last_scored_at` as **"last hit"** and `created_at` as **"started"**, so
scoring is event-driven rather than continuous — a raid accumulates score when someone
does something, and `last_scored_at` is when that last happened.

`committed_power` and `committed_cash` alongside `cycle_month` say a raid is **funded**:
something is staked up front, per game-month, and `*_power_taken` is what the other side
has stripped off you. That is an economy, not just a scoreboard, and it is the part of
this surface we understand least.

**`can_impose_flag` is the interesting one.** Winning does not merely end the raid — the
victor can overwrite the loser's `effective_flag_url` with their own. A faction flying
another faction's flag is a permanent, public, visible consequence, which makes it the
most legible piece of state in the whole surface. `PublicFactionPage` reads
`effective_flag_url`, so the outcome of a war is visible to anyone, logged out.

## `score_history` — the shape worth having

```
score_history: [ { created_at, attacker_score, defender_score }, … ]
```

Charted as a two-line time series. When the array is empty the client synthesises a
single point from the raid's current scores, which means **a short raid may carry no
history at all** and the curve you see is a fiction of one datum. Anything built on this
has to tell those apart.

## The event log

```
{ event_type, actor_username, target_username, created_at, score_delta, power_delta }
```

Rendered as `event_type.replaceAll('_', ' ')`, with `by {actor}` and `against {target}`
appended when present, and the deltas shown only when either is non-zero.

**The client does not enumerate `event_type`.** There is no label map, no colour map, no
switch — it prints whatever string arrives. So unlike `status` on a player, where the
vocabulary was sitting in the bundle all along, **the raid event vocabulary can only be
learned by watching one happen.** That is the single biggest gap in this document and the
clearest argument for a recorder.

Per-player attribution plus a score delta means the log answers "who actually did the
work", which no other surface in this game exposes.

## Members

The report carries both rosters with a per-player contribution:

```
user_id  username  is_online  rank_name  player_status  score
```

A per-player `score` inside a faction fight is the second activity-volume measure found
anywhere in this API — `alignment.social_count` was the first
([`05-people-surface.md`](05-people-surface.md)) — and this one is unambiguous about
effort rather than mere logins.

## Not public

`PublicFactionPage` fetches `/factions/{id}/public` and carries essentially no raid data.
Raids are authenticated and membership-scoped. The **outcome** leaks publicly through
`effective_flag_url`; the fight does not.

## What this makes possible

A five-second client poll is an unusually generous thing to find inside a
consume-don't-request envelope. While a member sits on the faction page during a live
raid, the game itself pulls the full raid state and the newest events every five seconds.
A passive tap records that stream at the client's own cadence and adds **zero** requests —
the same posture as every other tool here.

Two distinct captures, and they are worth different things:

1. **The finished RE:PUBLIC raid, from `/report`.** Available now, complete, and it does
   not decay — score history and the full event log for a war that actually happened.
   This is the one that answers "what are the event types".
2. **The next live raid, from the 5s poll.** Finer resolution than the server's own
   `score_history`, plus every event as it lands rather than five per page. This is the
   one that answers "how does scoring actually work".

Neither needs anything the game is not already fetching.

## Still unknown

- **The `event_type` vocabulary.** Not in the client. Observation only.
- **The full `status` enum.** `active` and `surrender_requested` are confirmed reads;
  the terminal states (ceased? surrendered? resolved?) are not, and `resolved` /
  `failed` / `locked` in the same bundle belong to faction *jobs*, not raids. Do not
  assume they carry over.
- **How scoring works.** What generates score, what `power_taken` costs the loser,
  whether `committed_power` is refunded, and what `cycle_month` bounds.
- **Whether a raid can be observed by a non-member.** Presumed no.
- **What the report says about a raid you were not in.** The endpoint is faction-scoped,
  so presumably nothing, but that is inference.
