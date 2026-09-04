# Time surface — how game time maps to real time

Measured **2026-08-03**; the registration-month rule corrected **2026-09-03** (see
[Registration months](#registration-months-specifically)). Sources, in evidence order: (a) the client bundles pulled once via
`tools/fetch-bundles.ps1` (static assets only), (b) the wiki articles that ship *inside*
those bundles as static content, (c) a small number of manually-initiated, UTC-timestamped
reads of `GET /api/public/stats` — the same public, unauthenticated endpoint
[`00-recon-baseline.md`](00-recon-baseline.md) was built on. No authenticated calls were
made, no endpoint was probed, nothing was automated or left running. `/api/time` itself
was **never called** — everything about it below comes from the client code that consumes
it and from the July session records in
[`05-people-surface.md`](05-people-surface.md).

## The clock, decompiled (measured)

The sidebar clock in the entry chunk (`index-AUYATDjW.js`) is the authoritative consumer.
Reconstructed and de-minified:

```
GET /api/time                        // TanStack queryKey ['game-time'],
  → { datetime: "HH:MM Month D, YN", //   refetched every 60 real seconds
      acceleration: <number> }       // game-seconds per real second

parse(datetime):  gs = (Y-1)*31_536_000 + monthIdx*2_592_000
                     + (D-1)*86_400 + H*3_600 + M*60
render(gs):       year  = floor(gs / 31_536_000) + 1
                  month = min(floor((gs % 31_536_000) / 2_592_000), 11)
                  day   = floor(remainder / 86_400) + 1
tick:             every real second, gs += acceleration   // fallback 52.14
```

Three structural facts fall straight out of the constants:

- **The game year is 365 game days** (`31_536_000` game-seconds).
- **Months are 30 game days** (`2_592_000`) — but the render step clamps the month index
  at 11, so **December is 35 game days long** (days 331–365 of the year all render as
  December 1–35). Eleven 30-day months plus one 35-day December.
- **Game time advances `acceleration`× real time.** The client's offline fallback is
  `52.14`; the live value arrives on every `/api/time` response. `365/7 = 52.142857…`,
  so 52.14 is almost certainly a rounding of "one game year per real week" (see
  *Open questions*).

The same calendar math appears in `HomePage` (a formatter that turns an *absolute* game
day into `"Month D, YN"` — confirming year = `floor(absDay/365)+1`) and in `StocksPage`,
whose candle chart keys buckets by `bucket_start` in raw **game-seconds** and formats
them with identical constants. (`StocksPage`'s copy skips the `min(…, 11)` clamp, so a
candle in the December overflow days would format with an undefined month name —
client-only cosmetic bug, noted here so nobody re-discovers it.)

The in-bundle wiki (the wiki is static content compiled into `WikiArticlePage`) states
the design intent in prose: game time *"moves at 52× real time"* and *"one real week
equals roughly one game year."*

### Unit conversion table (at acceleration 52.14)

| Game unit | Real time |
|---|---|
| 1 game minute | 1.151 s |
| 1 game hour | 1 min 9.0 s |
| 1 game day | 27 min 37.1 s |
| 1 game month (30 d) | 13 h 48 m 32 s |
| December (35 d) | 16 h 6 m 38 s |
| 1 game year (365 d) | 7 real days + 33 s |

At exactly `365/7` the year is exactly 7 real days; at exactly `52.14` it creeps 33
seconds past the week per year. Which one the server runs is the main open question.

## Anchors (measured)

All requests were single manual `GET /api/public/stats` calls, stamped against UTC on
this machine. The machine's clock turned out **not** to be NTP-synced (`w32tm` source:
Local CMOS Clock); measured against the `Date` headers of three independent hosts it
runs 4.7 ± 0.7 s behind true UTC — negligible at the precision below, but recorded here
because every timestamp in this table carries it. Request round-trip ~1 s:

| # | Real time (UTC) | Response |
|---|---|---|
| A1 | 2026-07-28, time-of-day not recorded | `game_year 7, game_day 298` (from 00-recon-baseline) |
| A2 | 2026-08-03 16:40:37 | `game_year 8, game_day 251` |
| T3 | 2026-08-03 16:48:42 | `game_year 8, game_day 251` |
| T4 | 2026-08-03 16:58:31 | `game_year 8, game_day 252` |
| T5 | 2026-08-03 17:21:16 | `game_year 8, game_day 252` (headers captured) |

T5 also recorded response headers: `CF-Cache-Status: DYNAMIC` — the endpoint is not
edge-cached, so none of these brackets are skewed by CDN staleness — and a server
`Date` 4.4–5.4 s ahead of the local clock, matching the local-offset measurement below.

### A second clock field — `quote.game_time`, found 2026-08-07

Live socket capture shows every `/ws/market` **`quote` frame carries a `game_time`
field** that the game client never reads (5 of 5 frames). `candle_update` does **not**
carry it. See [`09-socket-surface.md`](09-socket-surface.md).

> **Correction, same day.** This section first claimed `game_time` was "a strictly better
> anchor source" arriving "continuously… against a ~60 s poll". **That was wrong, and
> wrong in the direction of the thing being advocated.** Measured over the same session,
> `/api/time` supplies about **four times as many anchors** as `quote` does. The numbers
> are below. Recording it here rather than quietly deleting it, because the failure mode
> — finding an unread field and reaching for a use before measuring its rate — is the one
> worth not repeating.

**Measured rates**, from the 2026-08-07 census:

| | value |
|---|---|
| `quote` frames | 5, spanning 122.3 s |
| mean gap between quotes | **~30.6 s** |
| `/api/time` polls over the same 20 m 40 s session | **~20** |
| `quote` frames over that session | **5** |
| ratio | **the poll wins ~4:1** |
| share of session with any market frame at all | **13.6%** |

Four things sink it as a primary anchor:

1. **Coverage.** `/api/time` polls on every authenticated route. The market socket exists
   only on `/stocks`. In this session all market traffic finished inside the first three
   minutes; the remaining 85% of the window had none.
2. **It is event-driven, not a heartbeat.** 14 subscriptions produced only 5 quotes, and
   there is a 45.6 s stretch with a live subscription and no quote at all. Quotes track
   *market activity on the selected instrument* — the worst possible cadence for a clock.
3. **Error bracketing.** An HTTP poll's local send and receive times bracket the server
   value to within one round trip. A pushed frame gives a receive time only: one-sided,
   with unbounded latency.
4. **Baseline.** The poll's window here was ~10× longer, and drift-rate error falls with
   baseline length.

**`candle_update` does not help either.** It looks denser at ~8.7 s, but it is exactly
3 × `quote` in both readings with an identical `firstAt` to the millisecond — one quote
and three candles (one per timeframe) emitted per price event. It contributes **no
additional distinct time instants**, and carries no `game_time`.

**Where it could still earn its keep:** as a *supplementary* cross-check while the
operator is on `/stocks` (+24% anchors, versus −76% if it replaced the poll), for spotting
a poll/socket disagreement inside ~30 s instead of ~60 s, and for labelling price data in
game time. Framing it as a replacement is a net loss.

**Still unverified, and not verifiable with the current tool.** `ws-watch` 0.1.1 records
key *names* and never values, so **no `game_time` value was ever captured** — its unit,
precision and agreement with `/api/time` are all still unknown. That needs the 0.2.0
value-recording change described in
[`09-socket-surface.md`](09-socket-surface.md#limits-of-the-instrument).

`bucket_start` on `candle_update` may be the more interesting field: if it is floor-
quantized to its `timeframe`, the first frame carrying a new value marks a boundary
crossing, which is a better anchor *shape* than a mid-interval sample. That depends on
candles firing at rollover even with zero volume, which nothing has tested.

Cross-checks:

- **A1→A2 span:** (365−298) + 251 = 318 game days. At 52.14× that is 6 d 2 h 22 m;
  propagating the final phase back places A1 within 2026-07-28 **14:06–14:33 UTC**
  (~10:20 AM EDT) — a perfectly plausible recon hour. The July and August anchors are
  mutually consistent; the rate has not changed between deploys.
- **World age:** Y8 D252 ≈ 2,807 game days ≈ 53.8 real days → the world epoch
  (00:00 Jan 1 Y1) falls on ≈ **2026-06-10 21:20 UTC**. Consistent with "small, new
  world" from recon, and with a sampled player's `created_at` of 2026-07-24 (game year 7).
- **`ipo_game_day: 1408`** (from [`04-stocks-surface.md`](04-stocks-surface.md)) is an
  *absolute* game-day count → Nov 14, Y4 ≈ real 2026-07-08. So the stock market was
  seeded ~4 weeks after world start, in one batch — which refines 04's inference
  ("seeded at world start") to "seeded mid-world, in one batch."

### Phase — when the day ticks

`game_day` increments every 27 m 37 s. Bracketing the tick with the samples above pins
the start instant of game-day 252 (Y8) to **2026-08-03 16:53:39–16:58:31 UTC**
(T4 gives the upper bound directly; T5 still reading 252 at 17:21:16 pushes the lower
bound to 17:21:16 − 27 m 37 s. Net: a **±2.4 min** window, midpoint 16:56:05). Everything below carries that ±2.5 min, plus one structural
ambiguity: whether `stats.game_day` is 1-based (like every rendered date) or 0-based
(like the internal math). The two readings shift all real-world times below by exactly
one game day (27.6 min). The tables assume **1-based**; if 0-based, subtract 27 m 37 s.
The first passive `/api/time` capture (see *Closing the gaps*) resolves both the phase
and the basis to the second, because its `datetime` carries game hours and minutes.

## The mapping, in one formula

With `E` = real-UTC instant of game zero (00:00 Jan 1 Y1) and `a` = acceleration:

```
real(gs)  =  E + gs/a          gs(real)  =  (real − E) × a
```

Current best fit (1-based reading, a = 52.14):
**E ≈ 2026-06-10 21:20:06 UTC ± 2.4 min** (0-based reading: 20:52:29).
A Y-M-D-h-m game date converts to `gs` with the parse formula above.

## The weekly calendar (derived)

Because a game year is one real week (±33 s), every game date recurs at a fixed
real-world weekday and time. Anchored on the current phase estimate (Year 8; times
drift ≤33 s/week if acceleration is exactly 52.14, zero if it is 365/7):

| Game month starts | UTC | US Eastern (EDT) |
|---|---|---|
| January 1 | Wed 21:23 | Wed 5:23 PM |
| February 1 | Thu 11:12 | Thu 7:12 AM |
| March 1 | Fri 01:01 | Thu 9:01 PM |
| April 1 | Fri 14:49 | Fri 10:49 AM |
| May 1 | Sat 04:38 | Sat 12:38 AM |
| June 1 | Sat 18:26 | Sat 2:26 PM |
| July 1 | Sun 08:15 | Sun 4:15 AM |
| August 1 | Sun 22:03 | Sun 6:03 PM |
| **September 1** | **Mon 11:52** | **Mon 7:52 AM** |
| October 1 | Tue 01:40 | Mon 9:40 PM |
| November 1 | Tue 15:29 | Tue 11:29 AM |
| December 1 | Wed 05:17 | Wed 1:17 AM |

(±2.4 min phase, −27.6 min if `game_day` turns out 0-based. After the US falls back to
EST on 2026-11-01 every Eastern label moves one hour earlier — the UTC schedule is the
stable one.)

### Registration months, specifically

- **College registration opens twice a game year — January *and* September.** Each is a
  whole month on the schedule above, so each is a ~13 h 48 m real-time *window*, not a
  moment:

| Window | Opens (UTC) | Opens (Eastern, EDT) | Closes (Eastern, EDT) |
|---|---|---|---|
| **January** | Wed 21:23 | **Wed 5:23 PM** | Thu 7:12 AM |
| **September** | Mon 11:52 | **Mon 7:52 AM** | Mon 9:40 PM |

- **The two windows sit on different weekdays and at opposite ends of the day**, which is
  the planning consequence. For a US Eastern crew, September is the "wake up around 7 AM
  to enroll" one; January is a Wednesday *evening* that needs no alarm at all. And
  because there are two, **missing one costs four or eight game months (~2¼ or ~4½ real
  days), not a whole game year.**
- Registration is gated server-side: `GET /api/education` returns `registration_open`
  (plus `game_month_name`/`game_year`), and the Education page just renders the flag. The
  bundle contains **no** month logic for it — *which* months open is a server rule,
  operator-observed, not client-visible. That is exactly why this entry was wrong until
  2026-09-03: there is nothing in the client to read it off, so the list of months is only
  ever as good as what play has actually shown. Whether a window opens exactly at 00:00
  game time on the 1st, and whether it runs the whole month, is still unmeasured.
- Course durations are quoted in game months (13 h 48 m real each); completion is
  granted by a background job when the completion game-month arrives (wiki).

### Other calendar-scheduled events (from the in-bundle wiki)

| Event | Game schedule | Real cadence |
|---|---|---|
| Congressional bill session | once per game month | every ~13 h 49 m |
| Newspaper edition | one per game month | every ~13 h 49 m |
| Supreme Court appointments | each June, on vacancy | Sat afternoon (ET), weekly |
| Elections | November, each game year | Tue ~11:29 AM → Wed ~1:17 AM ET, weekly |
| Congressional term | 2 game years | 2 real weeks |
| Presidential term | 4 game years | **4 real weeks** |

The dual-clock design, explicitly: the political/economic calendar runs on game time,
but **HP/Energy/Juice regen (6/2/3 per minute), Insider billing, and cooldown-style
timers run on real time**. Only the calendar is accelerated.

## Timezones — how it works

There is **one global game clock**, server-authoritative (`/api/time` sends the same
`datetime` to everyone; opinion is not per-player, and nothing about time is
per-timezone). Your timezone changes only the *label* your wall clock puts on the fixed
UTC instants above. Practical consequences:

- Every player on Earth sees a registration window open at the same moment — Wed 21:23
  UTC in January, Mon 11:52 UTC in September. What differs is whether that moment is
  breakfast or bedtime, and the two windows answer that differently for the same person:

| Zone (offset) | January opens | September opens |
|---|---|---|
| US Pacific (PDT, −7) | Wed 2:23 PM | Mon 4:52 AM |
| US Central (CDT, −5) | Wed 4:23 PM | Mon 6:52 AM |
| **US Eastern (EDT, −4)** | **Wed 5:23 PM** | **Mon 7:52 AM** |
| UTC | Wed 9:23 PM | Mon 11:52 AM |
| UK (BST, +1) | Wed 10:23 PM | Mon 12:52 PM |
| Central Europe (CEST, +2) | Wed 11:23 PM | Mon 1:52 PM |
| India (IST, +5:30) | Thu 2:53 AM | Mon 5:22 PM |
| Japan (JST, +9) | Thu 6:23 AM | Mon 8:52 PM |
| Sydney (AEST, +10) | Thu 7:23 AM | Mon 9:52 PM |

- **DST moves your label, not the event.** When the US falls back (2026-11-01), the same
  two windows become Wed 4:23 PM and Mon 6:52 AM Eastern. European and Australian DST
  changes on their own dates likewise shift only those players' labels.
- If the server's acceleration is exactly 52.14 rather than 365/7, the whole weekly
  pattern also creeps 33 s later per week (≈ 29 min/year) — slow enough to ignore for
  planning, fast enough to eventually notice. The tap (below) settles it.

## Closing the gaps

`userscripts/time-watch.user.js` (new, passive, zero-added-requests) reads the
`/api/time` responses the app already polls every 60 s, and:

- records `{realMs, gameSeconds, acceleration}` samples (localStorage `pktw:`),
- displays the live game clock, the acceleration the server actually sends, an
  independently *measured* acceleration once its own baseline spans ≥30 min,
- renders this doc's month table for the viewer's local timezone, with a
  next-registration countdown that names the window after it too,
- and will expose any server-side re-anchoring (maintenance, deploys) as a residual jump.

One capture resolves the ±2.4 min phase and the day-basis ambiguity; a day of casual
play resolves the 52.14-vs-365/7 question to four decimal places.

The findings above also ship as a standalone planner —
[**Politiko Time Wire**](https://dataterminals.github.io/PolitikoTimeWire/)
([repo](https://github.com/dataterminals/PolitikoTimeWire)), an offline PWA carrying this
document's calibration as its built-in anchor. It renders the month schedule in any
timezone, exports the calendar as `.ics`, and accepts the `PKT1|…` codes the userscript
emits, so a single in-game capture re-anchors every copy the group is running. It talks to
Politiko not at all — it is arithmetic over a clock reading, so it sits outside the
scripting clause entirely.

**Auto-calibration, 2026-08-07.** The exact anchor was rarely the one actually in use,
because getting it there meant going to fetch it: open the game, copy a code, come back,
paste. `time-bridge.user.js` closes that loop. Time Watch and the planner are different
origins, so neither can read the other's storage; the bridge runs on both and moves the
newest `PKT1|…` string between them through the manager's own script storage. The planner
also accepts `?pkt1=` / `#pkt1=` on load, which makes an anchor shareable as a link, and
strips the parameter afterwards so a stale anchor cannot get bookmarked. Any route only
takes an anchor strictly newer than the one already held.

Note what this does *not* do. The obvious-looking alternative — having the planner poll
`/api/public/stats` itself — is worse on three counts, and the reasoning is worth keeping:
it would make a page that currently sits outside the scripting clause start originating
automated requests to politiko.io; it is cross-origin from `github.io` and would need CORS
the endpoint has no reason to send; and `stats` carries only `game_day`, so it would anchor
to ±27.6 min where `/api/time` carries game minutes. The passive reading the client already
makes is both safer and strictly more precise than anything the planner could fetch itself.

## Still unknown

- Exact `acceleration` value the server sends (52.14 vs 365/7 vs something else).
- Whether `stats.game_day` is 0- or 1-based (27.6 min offset on everything above).
- Registration's exact open/close within January and September (server-side; observe,
  don't probe). The two-month rule itself is operator-observed, not measured here.
- Whether the game clock has ever been re-anchored (deploys/maintenance). The A1↔A2
  consistency says not between Jul 28 and Aug 3.
- Whether the WebSocket pushes time ticks (would make even the 60 s poll observable
  passively at finer grain). Still uncharacterized.

## Method disclosure

- One manual run of `tools/fetch-bundles.ps1` on 2026-08-03 (125 static assets; also
  fixed a latent PowerShell 5.1 parse bug in the script — two em dashes that
  Windows-1252 decoding turns into a stray curly quote).
- Four manual `GET /api/public/stats` reads today (A2–T5 in the anchor table; A1 is the
  July recon baseline's own measurement). Public, unauthenticated, the endpoint recon
  already established; no loop, no schedule.
- Zero authenticated requests, zero calls to `/api/time` or any other endpoint, zero
  requests originated by any script. The Time Watch userscript is a passive tap only.
