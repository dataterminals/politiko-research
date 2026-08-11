# XP surface — stats, skills, and what awards them

Measured **2026-08-11** by reading the client bundles pulled **2026-08-10**
(`artifacts/bundles/2026-08-10/`, 139 files, ~4.7 MB — one manual
`tools/fetch-bundles.ps1` run by the operator). **Zero contact with politiko.io in the
course of this analysis** — nothing probed, nothing fetched beyond that one pull, no
authenticated session involved.

Every claim below is about *the client code on disk*. The ws-watch capture proved the wire
can be wider than the reader — twice — and nothing here escapes that caveat: "the client
reads no such field" never means "the server sends none".

**Byte offsets are locators into the 2026-08-10 snapshot only.** Chunk hashes change every
deploy; re-read the client before trusting any of this.

Motivation: a crew request (Discord, 2026-08-10) for **per-action XP** — the individual
gain from doing something, per skill it touched, explicitly *not* the home page's period
total. Proposal logged in [`03-script-ideas.md`](03-script-ideas.md).

## The correction to start with

The proposal's `/api/attributes` lead was wrong. **`/api/attributes` is not the skill
sheet** — it is the resource bars. Measured at `index-DDbc1H-W.js` 299418: rows carry
`AttributeID`, `AttributeName` (`energy` / `juice` / `hp`), `CurrentValue`, `MaxValue`,
`BaseRegenRate`, `CustomRegenRate`, `LastUpdate`, polled every 10 s, projected forward
client-side between polls. The `['attributes']` invalidation that
[`07-alignment-surface.md`](07-alignment-surface.md) recorded after disobedience refreshes
**energy/juice/hp**, nothing else. Skills never pass through this endpoint.

## Taxonomy — 6 stats, 31 skills (measured)

`ProfilePage-CgsJOvgc.js` 1599 hardcodes the two lists:

- **Core stats (6):** `heart`, `intelligence`, `wisdom`, `agility`, `strength`, `charisma`
- **Skills (31):** `art`, `axe`, `business`, `club`, `computers`, `disguise`, `dodge`,
  `driving`, `first_aid`, `heavy_weapons`, `knife`, `law`, `martial_arts`, `music`,
  `persuasion`, `pistol`, `psychology`, `religion`, `rifle`, `science`, `security`,
  `seduction`, `shotgun`, `smg`, `stealth`, `street_sense`, `sword`, `tailoring`,
  `teaching`, `throwing`, `writing`

`HomePage-DsHXphI9.js` 16167 groups the union of all 37 into six display categories
(Physical / Combat / Social / Criminal / Business / Knowledge — stats and skills mixed),
with an `Other` bucket for any key the server sends that the lists don't know. The in-bundle
wiki (`WikiArticlePage` ~20562) confirms the 6/31 split in prose and gives the roll model:
`outcome = roll(skill_value + attribute_adjustment)` vs. a difficulty threshold, server
authoritative.

**Values are fractional floats.** Profile renders them to 2 decimals; the train screen
renders gains to **4 decimals** (`TrainPage-B8hVHUIq.js` 496). Per-action gains are small
and fine-grained, so any tracker must store full precision and never round before diffing.

## Where your own values appear

Four endpoints carry own-character stat/skill numbers. Nothing else does — and notably
**nothing carries them live on any page a grind actually happens on.**

| endpoint | fires when | carries |
|---|---|---|
| `GET /api/users/{me}/stats` | own profile, **stats tab selected** (`ProfilePage` 21372, `enabled: tab === 'stats'`) | `{can_view, privacy_rights_axis, stats: {…all 37 keys…}}` — live values at fetch time |
| `GET /api/train` | train page | per-target `{kind: 'attribute'\|'skill', key, label, value, practice_gain, class_gain, description, class_description}` + envelope `{can_train, unavailable_reason, energy_cost, energy_current, energy_max, balance, class_cash_cost, daily_slots, heart, game_day, city_name, city_theme}` — the target list is **location-determined** (header renders the city and theme; fallback copy: "No city — only Heart is available", 3892) |
| `GET /api/user/progression` | home page ("Character Dossier", `HomePage` 20359) | `{stats_table: [{key, label, current, change}], net_worth: {current, change, percent_change}, snapshot_date, previous_date}` |
| `GET /api/education`, `/api/education/{track}` | education pages | course catalog with **declared** awards (below); no live stat values |

~~**`/user/progression` is snapshot data.**~~ **Half wrong — corrected 2026-08-11 by
field measurement.** The card's "Assessed {snapshot_date}" framing misled this read:
**`current` is LIVE** (proven by a +1.18 persuasion gain matching while the assessment
dates stood still — see the verdict section below), and only **`change`** is
period-to-period snapshot data. So the dossier is the game's one live full-width sheet,
and the crew's "not the period total" requirement is satisfied by diffing it. Cycle
cadence is per-account and still unknown.

`stats` on the profile payload is privacy-gated for *other* players — the sealed view
prints "privacy rights axis · requires 3" (`ProfilePage` 3110), so reading someone else's
sheet depends on a policy axis. Whether `can_view` is unconditionally true for your own
profile is inferred (very likely) rather than measured.

> **Field report, 2026-08-11 — the inference above did not survive its first day.** A
> crew-mate on the live game could not view his *own* stat sheet; the operator's read is
> that the live stats tab is **unfinished** ("that stats setup on the home is temporary —
> I assume it'll probably go into the stats tab"). So `/users/{me}/stats` cannot be
> relied on as the primary reading source yet, and the home dossier may be a placeholder
> that later moves into the tab — expect drift here. **The train page is the working live
> sheet**: its targets carry `value` per key, on a finished screen. Whether its target
> list covers all 37 keys is still open (question 2), and now matters more.
> `xp-watch` 0.1.1 surfaces a sealed/empty own-sheet response in its panel instead of
> silently recording nothing, and points its guidance at the train page.

## What awards skills, as the client sees it

### Training — the one direct, response-carried award (measured)

`POST /api/train {mode: 'practice'|'class', target_key}` → the response carries
**`{mode, target_label, gain, after_value}`**, rendered as *"Practice — Strength: gained
+N. New value: V."* (`TrainPage` 5225). This is the only place in the entire client where
an action's response states the XP it awarded.

Context from the `GET`: practice is free (energy only), class costs cash at an estimated
1.5× gain; per-target `practice_gain` / `class_gain` are server-predicted amounts, so
predicted-vs-actual is checkable from one tap. Training is gated by `daily_slots` per
window, and the page prints *"Train Heart to improve future gains (Heart N/999)"* — so
**`heart` scales training gains** and caps at 999. On success the page invalidates
`train`, `attributes`, `money` — and `user-stats`, on which see below.

### Education — declared, catalog-carried awards (measured)

Courses complete over time ("Completes {completion_label}"), and the catalog declares each
course's award up front: `stat_rewards: [{key, amount}]`, `modifier_rewards:
[{key, percent, description}]` (`EducationPage` 12857). There is **no completion
response** — a finished course just shows `completed: true` on the next education fetch.
So education XP is knowable to a passive tool, but the *moment* of award is only
observable as a diff between education reads. The wiki claims education is the only way to
raise stats — the train page refutes that, so the wiki article has drifted; trust neither
over the client.

### Everything else — silent (measured absence, client-side)

A full sweep of every `.post/.put/.patch/.delete` call site in all 139 chunks: **no crime,
combat, jail, travel, or job response carries any skill field the client reads.**

- Car theft (`/actions/car-theft/start|choice|resolve-timeout`) reads `stage`, `message`,
  `reward{name}`, `auto_equipped`, `status_until`, `complete`, `jailed`, `abandoned`,
  `combat_session_id`, `combatant`, `alarm_on` — no skill anything.
- Graffiti result (`GraffitiPage` 9326): `mode`, `arrested`, `hospitalized`,
  `attacker_status`, `deface_cleared`, `paint_landed`.
- `deal-drugs` / `scope-buyers`, `poll`, `donations`, `disobedience`,
  `sleeper-recruitment`, `terminal/exec` (hacking), `combat/{id}/action|resolve`,
  `jail/*`, `hospital/discharge`, `travel`, `jobs/*`: none read a gain of any kind.

Yet the crew *observes* these awarding — practiced skills rise from crimes, `street_sense`
rises from jail time. So either awards are entirely server-side with no client trace, or
action responses carry award fields the client silently discards. **Statically
unanswerable, and exactly the ws-watch situation:** both times a passive capture ran, the
wire turned out wider than the reader. One grinding session with a response tap settles
it.

### The dead query key (measured; archaeology)

`TrainPage` 2916 and `TravelPage-Cae365Ml.js` 7282 both invalidate `['user-stats']` after
their mutations. **Nothing in the entire client defines that query** — the string `stats`
appears zero times in the entry bundle. So the client once had a live own-stats query and
it was removed; the invalidations are fossils. Two things follow:

- Travel bothering to invalidate it on arrival is a hint that **travel awarded something**
  (driving, presumably) when the query existed. Inferred, weak.
- The game's own UI **cannot currently show you a skill change from a crime at all.** The
  request this doc serves isn't asking to duplicate a UI feature — the feature doesn't
  exist.

## When a passive tap gets a fresh reading

The app constructs its QueryClient with **no `defaultOptions`**, so TanStack v5 defaults
hold: `staleTime: 0`, `refetchOnMount: true`, **`refetchOnWindowFocus: true`**.
Consequences, all measured from the query definitions:

- On the **profile stats tab**, the sheet refetches on every mount *and every time the
  window regains focus* while mounted. Same for `/train` on the train page. These are the
  app's own requests, fired by its own defaults — a tap just reads them.
- `GET /api/user/status` polls every 10 s app-wide (`index` 314600) with `{username,
  status, current_location_id}` — identity for free, plus status transitions
  (`active` → `jailed` → …) at 10 s resolution, which is what lets a jail stint be
  bracketed. `/combat/active` polls at 5 s; `/attributes` and `/user/money` at 10 s.
- **After a crime POST, nothing skill-bearing refetches.** Grinding produces zero skill
  reads on its own. The only fresh readings are the ones the operator's navigation
  produces.

## What this makes buildable

`xp-watch` ([`userscripts/xp-watch.user.js`](../userscripts/xp-watch.user.js)): a passive
ledger of skill **readings** (profile-stats / train responses as they arrive) and
**action events** (crime/train/education responses as they arrive), with a delta engine
between consecutive readings:

- window contains one train award → subtract its measured `gain`; explained.
- window contains an education completion → subtract its declared `amount`; explained.
- residual delta + **exactly one** candidate action in the window → attributed to it,
  and honest per-action numbers accumulate.
- residual + zero candidates → passive (labelled with jail/travel status if the status
  poll saw one).
- residual + two or more candidates → **ambiguous, kept as a window, never averaged into
  per-action stats.** Guessing here would poison the numbers the tool exists to produce.

The workflow that makes windows unambiguous is the same shape the crawler retirement
established (`01-rules-envelope.md`): **the operator's keypress is the instrument.**
Open your own profile's stats tab before and after a grind block — or between single
actions when you want a clean per-action measurement — and every one of those fetches is
a navigation the game performs for you. Alt-tabbing back to a mounted stats tab does it
too, courtesy of `refetchOnWindowFocus`. The tool never asks for any of it; it diffs what
arrives.

Its instrument function, and the reason to run it beyond the crew's dashboard: it stores
**person-scrubbed raw samples of action responses**, so if the server *does* send award
fields the client discards, the first real grinding session surfaces them — at which
point per-action XP stops needing the diff engine at all for those actions.

## Field data, 2026-08-11 — the first copy-report from a live account

A crew-mate's xp-watch 0.1.2 report from his train page, plus channel chatter around it.
This is **measured live-server data** — one account, one moment — and it reshapes several
inferences:

```
train targets: 7 · heart 81 · slots/window 1
  agility = 78.19  practice +0.3159  class +0.4739
  dodge = 9.38  practice +0.3614  class +0.5421
  driving = 1.00  practice +0.3931  class +0.5897
  heart = 81.00  practice +0.3153  class +0.473
  music = 1.00  practice +0.3931  class +0.5897
  persuasion = 4.99  practice +0.3741  class +0.5612
  tailoring = 1.00  practice +0.3931  class +0.5897
profile stats tab: no issue recorded
home dossier assessed: 2026-08-11 (prev 2026-07-27)
```

- **`/train` serves a subset, not the full sheet.** 7 targets of 37 (2 stats + 5 skills)
  for this account — and crucially **no stealth and no street_sense**, the crime skills
  the tracker exists for. ~~Another crew-mate's train page offered `whip`, an
  off-taxonomy key — third instance of server vocabulary outrunning the client.~~
  **Withdrawn 2026-08-11, same hour, by the operator:** "whip" is the `role_key` of a
  slot in a **faction lobbying job** (the crew-mate was asking which *skill* the slot
  runs on, to class-train for it) — not a train target, not a skill key. The withdrawal
  also takes the second sample with it: with one report, **whether the subset is
  per-player or a shared per-window rotation is unmeasured.** A second copy-report from a
  different account in the same window distinguishes the two.
- **Class mode is exactly 1.5× practice.** All five target pairs give 1.500 to 4-dp
  rounding. Question 7 closed.
- **Practice gain decreases as the target's value rises** — +0.3931 at value 1.00 down
  to +0.3153 at 81. Same-value targets get identical gains, so gain is a function of
  (current value, heart), not of the target's identity. Curve unfit; more reports will
  trace it.
- **`slots/window 1`** for this account (heart 81), and the operator reports windows
  clear on a ~12-hour cadence. Whether slot count scales with anything is open.
- **The dossier's assessment dates are real-world dates** — `2026-08-11 (prev
  2026-07-27)`, a 15-day gap, assessed the same day as the reading. Not obviously
  periodic; could be deploy-driven.
- **The broken stats tab left no trace in the tap** — no sealed, no empty. Since the tap
  read only `res.ok` JSON, the likely failure mode is an HTTP error status, which 0.1.2
  could not see. 0.1.3 records the status code for exactly this endpoint, so one more
  visit to the broken tab measures it.

The coverage consequence, stated plainly: **right now, crime skills have no live reading
source at all** — not the stats tab (broken), not `/train` (absent from the subset). The
only candidate left is the home dossier's `stats_table`, which makes the live-vs-snapshot
question decisive; 0.1.3's report auto-compares dossier values against the ledger's live
readings so the verdict falls out of normal play.

### The second report — the operator's own account, same window (2026-08-11)

```
train targets: 7 · heart 6.6501 · slots/window 1
  heart 6.65 (+0.3433/+0.5149) · heavy_weapons 1.00 · law 1.00 · psychology 1.00
  rifle 5.22 (+0.3476) · teaching 1.00 · wisdom 1.00      (value-1.00 rows: +0.3661/+0.5491)
home dossier assessed: 2026-08-11 (prev 2026-08-10) · 37 keys
dossier vs live: 7/7 match
```

- ~~**The `/train` subset is per-player after all** — two same-window reports with
  disjoint sets except `heart`.~~ **Withdrawn a second time, 2026-08-11 — the subset is
  per-LOCATION.** The operator stated the game rule outright ("different skills are
  available to train based on whatever location you're in"), and the client corroborates
  it on re-reading: the `/train` envelope carries **`city_name` and `city_theme`**
  (rendered as the page header, `TrainPage` 3672), and the no-city fallback copy is
  literally *"No city — only Heart is available"* (3892) — which both proves the
  location rule and explains `heart` appearing in every sample: it is the no-city
  baseline target. The two reports' disjoint sets reflect two different cities, not two
  players. `city_theme` is the likely selector mechanism. This claim has now been wrong
  twice in one day in two different directions; the durable lesson is that n=2 field
  samples support nothing.
- **Gain scales with heart, confirmed directionally.** Same value 1.00, two hearts:
  +0.3931 at heart 81 vs +0.3661 at heart 6.65. Curve still unfit (two points).
- **The dossier carries all 37 keys** — full-coverage confirmed — and its cadence
  differs per account: operator `prev 2026-08-10` (daily-looking) vs crew-mate
  `prev 2026-07-27` (15 days). Both assessed today. Event-driven or activity-gated?
- **`dossier vs live: 7/7 match` is promising but not yet the verdict.** The account was
  assessed *today* and gained nothing since (jailed), so live and snapshot-as-of-today
  are indistinguishable in this sample. Decisive form: one training, then home, then the
  report — a post-gain match can only mean live.
- Envelope `heart` arrives at 4-dp (`6.6501`) while target rows render 2-dp — the
  envelope is the higher-precision source.
- **Operator-reported, unmeasured:** heavy jail time and frequent civil disobedience
  have built a large `street_sense` stat on this account. The client states no such
  link anywhere (`ActivismPage` copy is all flavor — checked), so use-based training of
  street_sense via jail *and disobedience* is field knowledge the game never discloses.
  ~~Notably, the operator's train subset is mostly untouched skills while the
  heavily-used street_sense is absent — compatible with "the train page offers what use
  doesn't cover."~~ Superseded within the hour: the subset is **location-based** (see
  above), so the absence of crime skills from both samples describes the two sampled
  cities, not a use-complement rule. The actionable version: **some city may train
  stealth or street_sense** — xp-watch 0.1.4 stamps every report with `city_name` /
  `city_theme`, so the crew's copy-reports build the city→trainable-skills map as they
  travel.

### The verdict: `/user/progression.current` is LIVE (2026-08-11)

Third field report, same account as the first, ~26 minutes later, after a stint of
persuasion training and civil disobedience:

```
train targets: 7 @ San Francisco (West Coast Elite · Advanced Mobility & Culture)
  agility 78.61 (was 78.19)   persuasion 6.17 (was 4.99)   heart 81 (unchanged)
home dossier assessed: 2026-08-11 (prev 2026-07-27) · 37 keys      ← both dates UNCHANGED
dossier vs live: 7/7 match
```

**The comparison is now decisive.** Between the two reports the account gained **+1.18
persuasion and +0.42 agility**, while the dossier's `snapshot_date` and `previous_date`
did not move. A stale snapshot would necessarily have disagreed with the train page by
those amounts; the dossier matched 7/7 anyway. Therefore `current` tracks live values and
is **not** as-of-assessment. Only the `change` column is period data.

Consequences, all good:

- **The home page is a live, full-width (37-key) sheet, refetched on every visit and
  every window refocus.** It supersedes both the broken stats tab and the city-limited
  train page as the primary reading source.
- **Crime skills are covered.** `stealth` and `street_sense` have a live source again
  without waiting for the devs or traveling to the right city.
- The workflow collapses to the cheapest possible loop: **glance home → act → glance
  home.** One action in that window yields exact per-action XP across every skill it
  touched.

`xp-watch` 0.2.0 promotes the dossier to a reading source accordingly.

### The crew's first live measurements, and the tool's first real limitation

From the same session (paraphrased from chat): persuasion and art farmed via civil
disobedience with "yuge gains"; the tool "works from what I see"; and then the
observation that matters — *"I don't think it's logging all of the stats that are being
affected."*

That is **expected behaviour of 0.1.x, not a bug**, and it is exactly what the promotion
above fixes. Before 0.2.0 the only live readings came from the train page, so a
disobedience that moved persuasion *and* art *and* street_sense could only ever show the
subset the current city happened to train — one skill of three, in this account's case.
Reading the dossier closes it: after 0.2.0 a home-sandwiched action reports **every** key
that moved.

Worth stating for the next reader: the report the user found insufficient was correct
about what it had measured. The failure was **coverage of the reading source**, not
attribution — and the user's report of it arrived before any amount of local testing
would have surfaced it, because no local harness knows which skills a disobedience
actually touches.

### The second field lesson: an open measurement looks identical to a broken tool

Same session, after 0.2.0: the crew-mate cleared his ledger, ran three graffiti attempts
(all failed, one bust, ending hospitalized), opened the panel and saw
`graffiti 3 · bust:1 · none attributed` — and reasonably concluded either the tool was
broken or that failed graffiti awards nothing. **Neither.** He had taken no reading after
the attempts, so the window was still open; the phrase "none attributed" described the
tool's state and read as a claim about the game.

The design lesson, worth carrying to any diff-based instrument: **a pending measurement
must announce itself.** 0.2.1 shows a standing note — *"3 actions not measured yet …
click home ↻ to take one now"* — and the per-endpoint cell distinguishes
**"not measured yet"** from **"no measured gain"**. Same data, opposite meanings.

His mechanical hypothesis remains untested and is worth testing: **does a failed action
award skill XP at all?** Sandwich single attempts and compare success against bust —
which the tool now supports directly, since it already tallies outcomes per endpoint.

### What is the `change` column? (open, instrumented 2026-08-11)

The dossier's little green arrows. Operator hypothesis: they may be **unlabelled gains
over an in-game year**. Worth taking seriously — the card's own framing already misled
this document once about `current`, so "since the previous assessment" is a caption, not
a measurement.

The hypothesis has a sharp prediction, because **one game year is one real week**
(acceleration 52.14 ≈ 365/7, [`06-time-surface.md`](06-time-surface.md)). So "over a game
year" means "over the last 7 real days" — a rolling week.

What the two sampled reports say so far, which is *not* supportive but not fatal either:

| account | `snapshot_date` | `previous_date` | gap |
|---|---|---|---|
| crew-mate | 2026-08-11 | 2026-07-27 | 15 real days ≈ **2.1 game years** |
| operator | 2026-08-11 | 2026-08-10 | 1 real day ≈ **0.14 game years** |

Neither gap is one game year, and they differ from each other, so the *dates* are not on a
game-year cadence — they look event- or visit-driven ("Snapshot pending next cycle").
But the dates could be describing the net-worth panel while the per-stat `change` is
computed over an entirely different window. **No `change` value has ever been compared
against a known gain.** That is the actual gap.

**`xp-watch` 0.2.3 runs the discriminator automatically.** Two dossier reads that bracket
a measured gain distinguish:

- **RUNNING** — `change` moved by the same amount as `current`: it is a running total
  against some baseline. Then the question becomes *which* baseline, and the rolling-week
  version predicts a further signature nothing else produces: **a gain must eventually
  drop back out of `change` about 7 real days later.** Watch one number across a week.
- **FROZEN** — `change` ignored the gain: it is period-to-period data fixed at assessment
  time, the caption is honest, and the game-year reading is dead.

The verdict prints in the copy-report along with the raw `change` values, so a single
paste after any gain settles the first half.

### The wire, measured at last — and `mastery` (2026-08-11)

The first report carrying sampled action-response keys. **These are the real payloads**,
and they settle the question this whole document was built around.

```
/disobedience     direction flavor hospitalized hospitalized_until jailed jailed_until
                  mastery people_moved success
/actions/graffiti arrested breakdown{arrest_chance, difficulty, mob_chance, roll} flavor
                  hospitalized issue juice_spent location{…} mode people_moved side
                  spray_can_spent success
```

Three consequences, in order of importance:

**1. `mastery` exists on the disobedience response, and no bundle read could have found
it.** The client's `ActivismPage` never renders it. It is the only skill-progression-shaped
field on any action response in this repo's history, and it is the leading candidate for
the direct per-action award the tracker was built to approximate. **Its value was already
being stored** (the sample scrubber only strips person-shaped and credential-shaped keys,
and `mastery` is neither) — but 0.2.3's report printed key names only, so the number never
made it out. **0.2.4 prints numeric and boolean values in the digest**, so the next paste
carries `mastery=…` and its relationship to the measured persuasion gain becomes
checkable. If it *is* the award, per-action XP stops needing the diff engine for
disobedience.

**2. Both payloads carry a plain `success` boolean — and the bundle-derived outcome
classifier was wrong.** `paint_landed` / `deface_cleared` looked like response fields in
`GraffitiPage` but are **animation keys selected from `mode`**; they never matched
anything on the wire. Corrected in 0.2.4, which now records `success` alongside the bust
kind (`fail+hospitalized`, `success+jailed`) rather than collapsing them — because "does a
failed action still award XP?" needs failure and punishment as separate facts.

**3. `graffiti.breakdown` carries the dice.** `roll`, `difficulty`, `arrest_chance`,
`mob_chance` — the server tells the client its own probabilities and the realised roll, and
the client renders none of it. That is squarely the *pre-commit action calculator* from
[`03-script-ideas.md`](03-script-ideas.md), and it means the calculator would not need to
infer odds at all: they arrive with every attempt. Recorded here, not built.

Also on the wire: `juice_spent`, `spray_can_spent` (consumable accounting), `people_moved`,
`direction`, `issue`, `side`, `mode`, and a `location` object carrying
`difficulty`, `lean`, `left_count`, `right_count`, `total_count`, `deface_available.L/R`,
`risk_label`.

### `change` is RUNNING — the arrows track live gains (2026-08-11)

Measured, from the operator's fourth report: persuasion `current` +0.0100 and `change`
+0.0100 between two dossier reads, with the assessment dates unchanged. **The `change`
column is a running total against a baseline, not a value frozen at assessment time.** The
operator's in-game-year hypothesis therefore survives its first test; the caption
("since the previous assessment") also survives. Distinguishing them needs the baseline.

Sampled values at that moment, with `previous_date` = the day before:

```
street_sense +13.01 · persuasion +10.43 · heart +1.0401 · art +0.92
stealth +0.35 · charisma +0.103 · business +0.10 · agility +0.0118
```

**A Fermi check that leans toward the ~1-day baseline, and is not proof.** Heart's +1.0401
is ≈3 practice sessions at this account's current +0.3433, and the account has **1 slot per
~12 h window** — so ~3 sessions is ~1.5 days of training, not 7. That fits a
previous-assessment baseline and fits a rolling game year only if the account trained
heart three times in a week and not otherwise. The operator would know which; the tool
cannot.

**The decisive test is free and needs no console.** Both readings are of the same quantity
under two hypotheses that diverge the moment the assessment date rolls over:

- **Baseline at `previous_date`** → when `snapshot_date` advances, every `change` **resets
  toward zero** and starts accumulating again.
- **Rolling game year (7 real days)** → no reset ever; old gains simply **drop out** as
  they age past a week, so a number can fall while you gain nothing.

Copy a report today and another after the date rolls; the `change values:` line answers it.

### Faction training jobs — the third award surface (measured in-bundle, 2026-08-11)

Chasing the "whip" correction through `FactionPage-C7LZV8QP.js` turned up a system the
write sweep had logged but never read: **faction jobs**, two types (`lobbying`,
`training`), on the faction page's Jobs tab.

- **Training jobs**: `POST /factions/{id}/jobs {job_type: 'training', target_key}`, and
  the target selector is the client's **full 37-key list** (offset ~78900) — attributes
  and skills both, **crime skills included**. Four slots: `teacher`, `student_1..3`
  (77500). So a faction can train what `/train`'s personal subset does not offer.
- **Resolved jobs declare their awards.** The result render prints `teacher gain +N` and
  per-student `@username +gain`, 4-dp (85543, 86062), off `result_metadata` — which
  arrives on the **`GET /factions/{id}/jobs`** response the app fetches whenever a member
  views the Jobs tab. Declared, measured award data, readable passively — the same
  quality as the train POST, one hop later.
- Creating/joining/resolving these jobs **invalidates `['train']`** (78108), so faction
  training interacts with the personal training system — slots, cooldowns, or gains;
  which of those is unmeasured.
- **Lobbying slots carry `role_key` only** (`whip`, etc., 72416) plus a
  `contribution_snapshot.score`. The client nowhere maps a role to a skill, so "which
  skill does the whip slot run on" is **not answerable statically** — server-side only,
  or discoverable by comparing contribution scores against known sheets.

xp-watch coverage implication: none of `/factions/*` is in the router's allowlist, so a
faction training gain currently lands as an unexplained **passive** delta and a lobbying
resolve is invisible. The 0.1.4 candidate: ingest the faction-jobs GET — training-job
results as declared award events (education-style), plus scrubbed samples of the payload
to map `result_metadata` and lobbying outcomes properly.

## Open questions

1. ~~**Do crime responses carry award fields the client discards?**~~ **Partly answered
   2026-08-11: `/disobedience` carries `mastery`**, which the client never renders —
   found by the sampler, invisible to every bundle read. **What remains: is `mastery` the
   XP award, and does anything equivalent ride the other actions?** `/actions/graffiti`
   carries no award-shaped field at all, so if `mastery` is one, it is not universal. The
   next paste carries its value (0.2.4 prints numbers), which is what makes it checkable
   against the measured gain.
1b. **Does a failed action award skill XP?** A crew-mate's three failed graffiti showed no
   gain, but that reading was confounded (see the second field lesson). Now directly
   testable: `success` is on the wire and 0.2.4 records it per attempt, split from the
   punishment (`fail+hospitalized` ≠ `fail`), so the outcome tally sits beside the
   attributed XP in the panel.
2. ~~**Does `/train`'s target list cover all 37 keys, or a trainable subset?**~~
   **Answered 2026-08-11: a subset** — 7 targets of 37 on the one sampled account, no
   crime skills among them. ~~And per-player, with an off-taxonomy `whip` on another
   account~~ — withdrawn the same hour; the "second sample" was a faction lobbying slot's
   `role_key`, not a train target. Successor questions: **what selects the subset**
   (per-player vs shared rotation — a second same-window report distinguishes), and
   whether **faction training jobs** (which can target all 37) are the intended
   complement.
3. ~~**Is `stats_table.current` live or as-of-snapshot?**~~ **Answered 2026-08-11: LIVE**
   — see the verdict section. Two successors, both instrumented in 0.2.3 and neither
   cosmetic: **what is the `change` column** (running total vs frozen period data — one
   paste after any gain settles it; if running, whether its window is a rolling game year
   = 7 real days), and **what drives the assessment cadence** (per-account; one account
   daily, another 15 days).
4. ~~**Is `can_view` always true for your own stats?**~~ **Falsified in the field,
   2026-08-11, within hours of asking** — a crew-mate could not view his own sheet on the
   live game; the stats tab is unfinished. What the sealed/empty response actually
   carries (a `can_view: false`? an empty `stats`? an error status the tap never sees?)
   is still unmeasured — xp-watch 0.1.1 records which of the first two it is when it
   arrives.
5. **How does `heart` scale training gains?** `practice_gain` predictions at two
   different heart values would bound it.
6. **Does jail tick `street_sense` continuously or per event?** Sheet readings before and
   after a jail stint (status poll brackets it) give the total; resolution needs repeat
   observations.
7. ~~**Is class mode's "1.5×" exact?**~~ **Answered 2026-08-11: yes** — 1.500 across all
   five sampled targets, to the 4-dp rounding the payload carries.

## Method disclosure

Local reads of the 2026-08-10 bundle snapshot only; grep and hand de-minification. Zero
requests to politiko.io. No authenticated data touched. The only live-game contact in this
work was the operator's manual `fetch-bundles.ps1` run that produced the snapshot.
