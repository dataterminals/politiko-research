# Opinion motion surface — what moves a poll, how fast, and what moves it back

Measured **2026-09-10 → 2026-09-12**, entirely from normal play: focus-group polls the
operator ran by hand (5 energy + $1,000 each), the responses to her own disobedience actions
as `xp-watch` recorded them, and the last-online stamps `people-watch` keeps. Every number
below was read out of the tools' own stores through
[`tools/collect-stores.js`](../tools/collect-stores.js). **Zero requests were made to
measure anything** — no endpoint was called that the game did not call for an action the
operator chose to take.

Companion to [`13-world-politics-surface.md`](13-world-politics-surface.md), which measures
the public as a **position**, and [`14-government-motion-surface.md`](14-government-motion-surface.md),
which measures the government as a **trajectory**. This file measures the public as a
trajectory: which actions move a poll, by how much per action, what moves it back, and how
to tell from a poll alone that somebody else has been at it.

Faction names appear below because the game shows them to anyone. Player usernames do not.

## The finding that shapes everything

**The public moves per action, measurably; the law follows the public on every issue where
anybody has worked it; and on a captured issue the middle is re-taken by hand overnight.**

Three consequences, each measured below. The contest is action volume, not money. The
*centre* is the instrument — a leftward leaning is discounted and a failed action pushes
the other way. And a centrist action reaches the middle of a distribution but not its far
end, so a captured issue has a floor that no amount of centrist work moves.

## Measured

### The poll is deterministic and the buckets are integers

Pollution polled twice 19 minutes apart, untouched: identical to the digit. LGBT Rights
polled 42 minutes apart and then 11.5 hours apart, untouched: identical to the digit. There
is no sampling noise in a focus-group poll. **Any change between two polls is real**, and a
one-point change is a one-point change.

A poll carries seven percentage buckets on the −3..+3 scale (`far_left` … `far_right`),
`mood`, `salience` (a word) with `popularity` (a number, capped at 1000), `volatility`,
`extreme` (null or `"radical fringe active"`), a `best` target and a persuasion `angle`,
and a `cooldown` — the shape 13 recorded. The mean used below is the bucket-weighted mean
of −3..+3 over the buckets that sum to ~98.

### The law tracks the public, both ways

Eight issues polled 2026-09-11, against the policy axis they file under:

| issue | law | public mean | far right | far left | fringe flag |
|---|---|---|---|---|---|
| Intelligence (Privacy Rights) | +3 | 2.89 | 93% | 1% | active |
| Police Behavior | +2 | 2.92 | 91% | 0% | active |
| Elections (Election Reform) | +3 | 2.60 | 77% | 0% | active |
| Civil Rights | +3 | 2.49 | 72% | 0% | active |
| LGBT Rights | +1 | 0.19 | 2% | 0% | — |
| Abortion | 0 | 0.16 | 0% | 0% | — |
| Pollution | 0 | 0.19 | 0% | 0% | — |
| Women's Rights | −1 | −1.36 | 0% | 0% | — |

Every issue whose law is far right has a public that is far right; every issue whose law is
near zero has a public near zero; the one issue whose law is left has a public entirely
left of centre. **`"radical fringe active"` is set on exactly the four captured issues and
on none of the others**, including the fully-left one. Whether the flag means "an extreme
bucket is large" or "an extreme actor is working this now" is not separable from these
eight; either way it costs five energy per issue to read.

### Centrist dose-response

Three brackets on LGBT Rights and one on Civil Rights, each a poll, a run of disobedience
actions at leaning *centre*, and a poll. Successes are the responses with `success: true`.

| issue | window (UTC) | actions (ok) | buckets before → after | mean moved | per success |
|---|---|---|---|---|---|
| LGBT | 09-10 20:08 → 09-11 04:10 | 104 (92) | neutral 58→67, slight-right 37→29 | −0.086 | −0.0009 |
| LGBT | 09-11 04:10 → 19:50 | 113 (97) | neutral 67→83, slight-right 29→13 | −0.163 | −0.0017 |
| Civil Rights | 09-11 21:57 → 23:45 | 33 (27) | neutral 12→18, centre-right 14→8, **far-right 72→72** | −0.12 | −0.0044 |

Two things in the shape. On LGBT the flow was one step: slight-right into neutral. On
Civil Rights it was **two steps in one jump** — six points left centre-right and arrived at
neutral, with slight-right staying at zero throughout — so per success the mean moved
three to four times as far. And on Civil Rights **the far-right bucket did not move at
all** while the bucket beside it drained by six.

The `people_moved` field on a successful centrist response was 508,633 (LGBT) and 505,415
(Civil Rights). The population these are a fraction of is not published; see *Still unknown*.

### The leftward discount, and two controls that isolate it

| issue | window (UTC) | actions (ok) | leaning | buckets before → after | mean moved | per success |
|---|---|---|---|---|---|---|
| LGBT | 09-11 19:50 → 22:48 | 45 (37) | −1 (slight left) | neutral 83→79, slight-left 0→2, slight-right 13→14 | −0.008 | −0.0002 |

`people_moved` on a successful leftward response was 506,498 — the same reach as a centrist
one. The first reading was that somebody had pushed right in the same three hours: the
clock had four RE:PUBLIC members active in the window. Two controls ruled that out:

- **42 minutes, no actions of ours on LGBT**, with the faction's most active member sighted
  in the window: poll identical.
- **11.5 hours overnight, no actions of ours on LGBT**, with that member sighted three times
  across the night: poll identical.

So nobody moved LGBT and nothing drifted. **A leaning of −1 converts about a quarter as
much per effective person as centre does**, after the failure penalty below is accounted
for. The operator's own compass moved as if each leftward success counted ≈ 0.6 of a step,
which is consistent with the preview's "64 % swing" being *the fraction of the leaning that
lands*, not a success chance.

### A failed action pushes the public the other way, at half strength

Two disobedience response bodies from the same bar, same site, same leaning:

```
success: true    people_moved:  505415
success: false   people_moved: -252708
```

So the net per action is roughly `p · 506k − (1 − p) · 253k`: about 407k at the boardwalk's
87 % success, about 233k at the 64 % the leftward preview offered, and **negative below
about 33 % success**. A burst at a low success rate moves the public against you.

### The burst, and why the stop rate outranks the swing

From `xp-watch`'s event ledger (1,308 disobedience events, 2026-08-27 → 09-11): actions come
in bursts of median 24, p90 33, max 37, fired seconds apart, then a rest of 40–80 minutes.
The juice bar reads max 167 with 5 per action — a full bar is exactly 33 actions, and juice
is the binding constraint. A jail or a hospital ends the burst with juice unspent, which is
the real cost: at the operator's usual settings the stop rate is 2.4 % (31 jailings in 1,308,
zero hospitalisations) and a full bar gets through. At a preview reading of 26 % mob the
expected run before a stop is under four actions. **Keep mob plus jail under about five
percent per action, or the burst economics collapse.** The centrist preview on Civil Rights
at the Pier 39 boardwalk read 87 % success, 1 % jail, 0 % mob.

### Reach: the centre does not touch +3

Across a 33-action centrist bar on Civil Rights, centre-right drained from 14 to 8 and
neutral rose from 12 to 18 while far-right stayed at 72. Working hypothesis (inferred, see
below): a centrist action moves people within about two steps straight to neutral and
cannot reach a bucket three steps away. If that holds, the centrist floor on a captured
issue is a mean of about 2.2 once centre-right is empty, with the far-right bloc untouched.

### The ladder test: +1 does not reach +3 either (added 2026-09-12 13:06 UTC)

The reach hypothesis predicted that a +1 leaning would pull +3 down two steps the way
centre pulled +2 to 0. One bar at slight right on Civil Rights, 26 actions and 25
successes at a 92 % preview, jailed on the 26th:

| | 12:51 UTC | 13:06 UTC |
|---|---|---|
| neutral | 8 | 4 |
| slight right | 10 | 14 |
| centre right | 8 | 8 |
| far right | 72 | 72 |
| mean | 2.47 | 2.51 |

Only the neutral bucket moved, one step, to the leaning. Far right held at 72. **Centre
right held too** — the people one step to the *right* of the leaning did not come down to
it. So a rightward action never moves anyone leftward, even by one step, and combined
with centre moving +2 → 0 but never +3, **the ±3 bucket is out of reach of every leaning**.
Whatever put 72 % of this public at far right, disobedience cannot take them off it; it
only ever trades the middle. The jailing carried `jailed_until` nineteen minutes after the
action — shorter than a bar's refill, so a jail costs the unspent juice and nothing more.

### Leftward, two steps out: −2 moves one step, not two (added 2026-09-12 13:38 UTC)

The ratchet predicted a −2 leaning would do leftward what centre did rightward on Civil
Rights: pull a neutral bucket two steps in one jump. One bar at −2 on LGBT, 23 actions (3 at
Embarcadero Plaza, 20 at Pier 39), about 16 successes:

| | 11:03 UTC | 13:38 UTC |
|---|---|---|
| centre left | 0 | 2 |
| slight left | 2 | 0 |
| neutral | 79 | 79 |
| slight right | 14 | 13 |
| far right | 2 | 2 |
| mean | 0.186 | 0.156 |

The two points at slight left moved one step into centre left. **Neutral did not drain at
all**, with 79 % of the public sitting two steps from the leaning. Leftward bars on this
public have now yielded two or three points each at both −1 and −2, against nine to sixteen
for centre. At integer resolution with buckets this small, a per-success discount and a
one-step reach for non-centre leanings are not separable; the price is the same either
way, about four times the cost per point that centring the issue was.

### Site and crowd set the stop rate, never the reach (added 2026-09-12)

Every `people_moved` body on record, across leaning, issue, site and crowd:

| site | authority | crowd | leaning | issue | per success |
|---|---|---|---|---|---|
| Pier 39 | mall security | packed | centre | LGBT | 508,633 |
| Pier 39 | mall security | packed | −1 | LGBT | 506,498 |
| Pier 39 | mall security | packed | centre | Civil Rights | 505,415 |
| Pier 39 | mall security | packed | +1 | Civil Rights | 506,498 |
| Embarcadero Plaza | private | packed | −2 | LGBT | 505,415 |
| Pier 39 | mall security | **sparse** | −2 | LGBT | 504,332 |

Half a percent of spread across all of it. The preview for −2 on LGBT at five sites read a
success rate of 68–71 % everywhere and a stop rate from 8 % (mall security) to 55 % (the
state): **the leaning sets the success rate, the site's authority sets the stop rate, and
neither the site nor the crowd changes how many people a success moves.** A riskier site
buys nothing, and a bar can be fired whenever it is full.

The failure penalty is written by the server itself: a failed action's body records
`direction: "R"` against a leftward leaning, and `people_moved: −252,708`. A hospitalisation
(`hospitalized_until` 28 minutes after the action) still moved its 505,415 — a stop ends
the burst, not the action — and the operator could heal out of it early. Jail ran 19
minutes on the one timed occasion and up to about 30 in her experience; both are shorter
than a bar's refill, so a stop costs a pause and never the juice.

### Two activity tells, read off the poll alone

**Volatility.** LGBT read `stable` on every poll until the drag began to bite, then
`moderate` on the next two; Civil Rights flipped `stable → moderate` on the poll immediately
after a bar. Overnight, untouched, both went back to `stable`. So `moderate` means *acted
on within the last few hours* — and its absence proves nothing about last night.

**Popularity decays when nobody acts, and a re-raise shows.** It is the more reliable of the
two: a 23-action −2 bar on LGBT re-raised popularity from 780 to the cap while volatility
stayed `stable`, so a small bar can move one tell without the other. LGBT sat at the cap of 1000
after the drag and read 780 after 11.5 untouched hours: about 19 per hour. Civil Rights was
at 1000 after the operator's bar; 13 hours later, untouched by her, it read **830** — higher
than the 780 that 13 hours of decay would leave. Something re-raised it roughly nine hours
before the poll, around 04:00 UTC. Two points define this curve so far; see *Still unknown*.

### The overnight re-take

Civil Rights, zero actions of ours between the two polls:

| | 09-11 23:45 UTC | 09-12 12:51 UTC |
|---|---|---|
| neutral | 18 | 8 |
| slight right | 0 | 10 |
| centre right | 8 | 8 |
| far right | 72 | 72 |
| mean | 2.37 | 2.47 |

Ten points moved from neutral to slight right, one step, overnight — the bar's gain undone
and four points more — while nothing else moved. The clock's last-online stamp for the
faction's most active member that night: **05:04 UTC**, which is where the popularity curve
puts the re-raise.

### The preview is a free mood read

`GET /api/disobedience/preview?issue_id=&site_key=&leaning=` returns swing, jail, mob and
difficulty for one issue, one site, one leaning. Difficulty "depends on your skill, the
public mood, and the crowd" (07). Skill is one number across every issue and the crowd is
the same for two leanings at one site in one game hour, so **a change in the difficulty of
two leanings relative to each other, same site, same hour, is the public moving** — a
cheaper detector than a poll, readable every time the page is open. Field-observed
2026-09-11: neutral and centre-left had read equal, then centre-left went harder again.

### What it costs the operator's own compass

From `align-watch`'s 66 readings: the social axis carries ~5,200 samples at a mean of
−0.011, built as a deliberate neutral base. The first 45 leftward actions moved it to
−0.016 — roughly 0.011 per hundred actions at −1. The economic axis carries 842 samples
and moved 0.071 → 0.172 in a week, so it shows the same work about six times faster.

## Inferred

Everything here is ours. None of it is something the client says.

- **Reach.** Centre moved +2 → 0 in one jump and left +3 alone; +1 moved 0 → +1 and left both
  +2 and +3 alone. The rule that fits all three bars: a success moves people *in the
  direction of the leaning*, up to the leaning, never back toward it from the far side —
  and the ±3 buckets do not move for any leaning. Whether ±3 is locked outright or merely
  out of reach is the same thing in practice: disobedience trades the middle only.
- **The overnight push is a +1 leaning by RE:PUBLIC.** It fits the one-step shape *and* the
  popularity re-raise *and* the sighting. Contagion drift toward the dominant bloc fits the
  shape only, and LGBT — whose dominant bloc is neutral — showed no drift at all.
- **"64 % swing" is the fraction of the leaning that lands.** The compass moved as if so.
  The preview's number for centre was not recorded; it may be the same field at 100 %.
- **Popularity decay is about linear at ~19/h from the cap.** Two points.
- **The fringe flag marks the four issues one faction has worked.** Correlation across eight
  polls; a +3 issue with a small far-right bucket and the flag set would settle its meaning.

## What this makes buildable

All of it from stores the tools already keep, zero added requests:

- **poll-watch: brackets and the decay curve.** Print the mean and the bucket deltas between
  consecutive polls of an issue; fit popularity decay across untouched intervals and flag a
  re-raise — *"acted on since your last poll, by someone"* — as the durable activity tell.
- **poll-watch × xp-watch: net people moved per bar.** Successes and failures from the
  response bodies, so a bar reports what it did to the public before the next poll does.
- **read-stores: an opinion-motion section** carrying the brackets, per-success rates and
  decay anomalies, so a strategy conversation opens on the current price of each issue.

What none of them may do: refresh a poll, or run one. A poll is a paid action the operator
takes; every number here was hers to take, and the tools only remember what came back.

## Still unknown

- **The population.** `people_moved` is 506k per success; a bar of 27 successes moved six
  points of the Civil Rights public and 97 successes moved sixteen points of LGBT's, which
  do not fit one population size with any simple rule. Whether people already at the
  leaning are "moved" and wasted, and whether the population differs per issue, are open.
- ~~**Whether +1 pulls +3.**~~ Answered the same day: it does not, and neither does it pull
  +2 down. See *The ladder test*. What remains unknown is what, if anything, moves a ±3
  bucket — a protest's `forecast_shift`, a media campaign, the law itself, or nothing.
- **The decay curve past two points**, and whether it is linear, exponential, or issue-dependent.
- **Whether elections follow the public.** The Nov Y16 election (~2026-09-22) is the test; the
  Herald publishes `congress_alignment_swing` after it (20).
- **What `popularity` measures**, beyond "attention, capped, decaying".
- **Who works Women's Rights left**, and whether protests or media campaigns move a poll at
  all — no protest or campaign has been observed since world-watch shipped.

## Method disclosure

- Every poll was a `POST /api/actions/poll` the operator chose to run in normal play; every
  disobedience action was hers. The tools recorded the responses passively.
- Stores were exported with `tools/collect-stores.js` from a static-file tab and read with
  `tools/read-stores.js` and one-off Node scripts against the bundle. No request was made
  to politiko.io to measure anything, and no page was opened for this file's sake.
- Other players' data used: faction membership and last-online stamps, which the game shows
  to anyone under the current Privacy Rights setting. No username is reproduced here.
