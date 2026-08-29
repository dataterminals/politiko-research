# Attribute surface — the three bars, and when they are actually full

Measured **2026-08-27** by reading the client bundles in `artifacts/bundles/2026-08-03/`
(126 files). **Zero contact with politiko.io in the course of this analysis** — nothing
probed, nothing fetched, no authenticated session involved.

Byte offsets are locators into the 2026-08-03 snapshot only. Chunk hashes change every
deploy; re-read the client before trusting any of them.

Motivation: a request for notifications when Energy, Juice and HP replenish. The short
answer is that the *data* for that is free — it is already in the client, and the
countdown is arithmetic on a payload that has already arrived. The long answer is that
the *alert* is the part with a rules question attached, and that lives in
[`01-rules-envelope.md`](01-rules-envelope.md) rather than here.

## `/api/attributes` is the bars, and it carries its own future

Corrects nothing — [`10-xp-surface.md`](10-xp-surface.md) already established that this
endpoint is the resource bars and not the skill sheet. What is new here is the projection.

`index-AUYATDjW.js` 297609 has the whole model in four functions, and they are worth
reading literally, because a tool that reimplements them from the wiki's stated rates
will disagree with the sidebar:

```js
ls(e) = e.CustomRegenRate ?? e.BaseRegenRate            // effective rate, per MINUTE

us(e,t)  = CurrentValue >= MaxValue ? MaxValue
         : rate <= 0 ? CurrentValue
         : min(CurrentValue + floor((t - LastUpdate)/60000 * rate), MaxValue)

ds(e,t)  = seconds until the NEXT whole point
         = (1 - ((t - LastUpdate)/60000 * rate % 1)) / rate * 60

fs(e,t,n) = whole points that will land within the next n seconds
```

A row is `{ AttributeID, AttributeName, CurrentValue, MaxValue, BaseRegenRate,
CustomRegenRate, LastUpdate }`, and `AttributeName` is one of `energy`, `juice`, `hp`.
The response is an array of those three. API base is `https://politiko.io/api` (259566),
so the path a tap matches is `/api/attributes`.

**The consequence that makes this whole tool possible: `CurrentValue` is the value *at*
`LastUpdate`, and everything after that is computed locally from a server timestamp and a
rate.** The client does not ask the server what the bar says now; it works it out. So a
payload that arrived twenty minutes ago still yields an exactly correct reading twenty
minutes later, and a countdown to full needs **no request at all** — not a new one, not
even a fresh one. This is the rare case where "consume, don't request" costs nothing: the
passive surface is not a degraded version of the polling one, it is identical to it.

The one thing that invalidates a held payload is *spending*, which resets `LastUpdate`.
You can only spend by acting in the client, and every action that spends invalidates
`['attributes']` (`ts.attributes`, 297609) — so a fresh payload arrives through the tap in
the same breath. There is no state in which a held reading is silently stale.

## Measured: the game never tells you when a bar will be FULL

`hs()` (298864) is the sidebar Attributes card. Per bar it draws the label, `value / max`,
a ten-pip meter, and then a countdown — and the countdown is this:

```js
a = bars.map(e => ds(e, now)).filter(x => x !== null);
o = a.length > 0 ? Math.max(...a) : null;      // ONE number, the max across all three
```

`o` is seconds to the next whole point, taken as the **maximum across the three bars**,
and the same `o` is then printed on *every* row, next to a per-bar `+N` of how many points
that bar gains inside that window.

Two things follow, and both are the reason this tool exists:

1. **Time-to-full is not displayed anywhere in the client.** Nothing computes it. Energy
   at 2/min sitting sixty points short is fifty minutes from full, and the sidebar
   says `0:30`.
2. **The countdown you can see is not per-bar.** It is the slowest of the three, printed
   three times. A bar that ticks faster than the slowest one is showing you a number about
   a different bar.

Neither is a bug — it is a next-tick readout doing its job. It is just not the question
"when is my energy full", and that question has no answer on screen.

## Measured: polling stops when the tab is unfocused

`refetchInterval: 1e4` on the attributes query, and the app sets no
`refetchIntervalInBackground` anywhere — the only occurrence in the bundle is TanStack's
own gate:

```js
(this.options.refetchIntervalInBackground || b.isFocused()) && this.#h()
```

So the 10-second poll **pauses the moment the tab loses focus** and resumes on return.

Worth stating plainly, because it cuts two ways:

- It removes any temptation to "fill the gap". There is no gap to fill. The projection is
  exact from a held payload, so a tool has nothing to gain from a request and therefore no
  reason to originate one.
- It means anything that fires while you are away is firing off arithmetic done on a
  payload captured while you were *looking at the page*. That distinction is the whole of
  the rules question, and it is argued in
  [`01-rules-envelope.md`](01-rules-envelope.md).

## Measured: there is no push preference for a full bar

`index-AUYATDjW.js` 262856 — the default preference object is the complete vocabulary:

```js
Hi = { jail_release:!1, hospital_release:!1, hospitalized:!1, travel_arrival:!1 }
```

and the settings UI lists exactly those four, with copy: "Jail release / When your
sentence countdown ends", "Hospital release / When your recovery countdown ends", "Has
been hospitalized", "Travel arrival". Preferences round-trip through `GET
/push/subscription`, `PUT /push/subscriptions/preferences`, `POST /push/subscriptions`,
keyed by endpoint, and cache to `localStorage['politiko_push_preferences']`.

So the move [`01-rules-envelope.md`](01-rules-envelope.md) recommends first — reach for the
server-side switch the game already ships — **has no switch to reach for here.** Four keys,
none of them a bar. That is a measurement, not an assumption, and it is the thing worth
asking staff for: a `bars_full` key, or three of them, in Politiko's own push vocabulary
would make this tool's second and third alert channels unnecessary, which is exactly the
outcome the rules envelope says to prefer. The `/contact` ticket system added on 2026-08-26
is the place to ask, and it is a cheap thing to append to the sanctioned-API question that
file has been holding since July.

## `/api/effects` qualifies the countdown, and has to

`refetchInterval: 5e3` on `['player-effects']`, so it arrives more often than the bars do,
on every authenticated route. Rows carry `{ id, effect_key, effect_type, target_key, value,
modifier_type, expires_at, source_item_name, cooldown_cap_seconds }`.

`effect_type` is a closed set of four, from the colour map at `Oc`:

```js
{ cooldown: amber, stat_modifier: sky, regen_modifier: emerald, damage_over_time: rose }
```

Two of those four bear directly on a fill projection — `regen_modifier` and
`damage_over_time` — and one effect is special-cased in the renderer by key:

```js
e.effect_key === 'radiation' ? 'HP -1/min · regen paused' : …
```

**This is why the tool flags rather than folds.** Under radiation, HP is falling and regen
is off. A projection that just ran the arithmetic would draw a confident countdown to a
full HP bar that is never going to arrive, which is worse than drawing nothing.

The honest position, and the one `bar-watch` takes:

- **Measured:** the effective rate the client uses is `CustomRegenRate ?? BaseRegenRate`.
  Using that exact expression means the tool agrees with the sidebar by construction, in
  every case, including the ones below.
- **Inferred, not measured:** that the server folds an active `regen_modifier` into
  `CustomRegenRate` before sending it. The shape strongly suggests it — a nullable
  "custom" rate beside a "base" one is what a server-computed effective rate looks like —
  but nothing in the client proves it, and the client never applies a modifier itself.
- **Therefore:** the tool never applies a modifier either. It computes exactly what the
  game computes, and separately *names* any active effect that touches a bar, with its
  `expires_at`, next to the countdown that effect might invalidate. If regen is paused the
  rate is `<= 0`, the game's own `ds()` returns null, and the panel says which effect took
  the countdown away instead of showing a bare dash.

`Dc` — the drug keyword list (`drug`, `weed`, `testosterone`, `estrogen`, `opium`,
`morphine`, `fentanyl`, `cocaine`, `beer`, `whiskey`, `vodka`) — is only an icon selector,
not a rate model. Recorded so nobody later mistakes it for one.

## What is NOT known

- **Whether `CustomRegenRate` already includes effect modifiers** (above). Answerable from
  one observation the operator will make anyway — take a regen-modifying item and watch
  whether the number in the panel's rate column moves. The tool prints the rate it used and
  which field it came from, precisely so that observation is free.
- **Whether `MaxValue` ever changes mid-session** (levelling, an item, a perk). The tool
  re-reads it from every payload rather than caching it, so it does not need to know.
- **Whether the server sends fields on an attribute row the client does not read.** The
  seven it reads are listed above; nobody has looked at a live payload. `shop-watch`'s
  FIELDS tab exists because exactly that gap turned out to matter for stores, and the same
  census would be cheap here. Not built in 0.1.0.
- **What `AttributeID` is for.** It is used as a React key and nothing else.
- **Whether hospitalisation or jail changes regen.** `/api/user/status` carries
  `active | traveling | hospitalized | jailed | in_combat | fleeing | dead` with a
  `status_until`, and the route gate `hc` decides which screens each status can reach.
  Nothing links status to a regen rate in the client, but the server may. Not read by
  `bar-watch` in 0.1.0.
