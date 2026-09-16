# Sleeper surface — recruitment, and what a sleeper is actually for

Measured **2026-08-07**, entirely from the client bundles already on disk from the
2026-08-03 `tools/fetch-bundles.ps1` run. **Zero requests were made to politiko.io** —
nothing was called, probed or re-fetched, and no recruitment was performed to produce this.
It is a read of `SleeperRecruitmentPage`, `FactionPage`, `factionUtils` and the in-bundle
wiki.

Written because the mechanic reads as inert from the inside: you canvass, you collect
names, and nothing visibly happens.

## The finding that explains that

**Recruiting a sleeper and using one are on different pages, and the second is behind a
faction rank permission.**

`SleeperRecruitmentPage` never does anything with a recruited sleeper. It lists them under
"Your Recruited Sleepers", labels every one of them `inactive`, and stops. The payoff lives
on `FactionPage`, behind `can_manage_sleepers`, where the panel says in its own words:

> advocate generates power · embezzle siphons cash · arrests siphon power

So a player without that rank permission can run the entire recruitment loop correctly,
forever, and never see the button that makes it pay. Nothing in the recruitment UI says so.

There is also **no wiki article for sleepers.** The complete in-bundle prose is one line in
the Actions article: *"Sleeper Recruitment — plant assets in political or corporate
institutions."* The opacity is real, not a reading failure.

## Measured

### Endpoints

```
GET  /api/actions/sleeper-recruitment                 refetchInterval 30s
     → { districts:[{ ...,sites:[{id,name,security_level,description,...}] }],
         issues:[], leads:[], sleepers:[],
         faction_name, location_name, window_minutes,
         recruited_count, sleeper_cap, energy_cost }

POST /api/actions/sleeper-recruitment/canvass         { site_id }
     → { flavor, found }            found > 0 is a hit; invalidates `attributes`

POST /api/actions/sleeper-recruitment/{id}/meet       { action, issue }
     → { flavor, outcome }          outcome === 'lost' loses the lead;
                                    invalidates `attributes` and `money`

POST /api/actions/sleeper-recruitment/{id}/drop       {}

GET  /api/factions/{id}/sleepers                      gated on can_manage_sleepers
POST /api/factions/{id}/sleepers/{sleeperId}/advocate {}
POST /api/factions/{id}/sleepers/{sleeperId}/embezzle {}
```

`action` is one of `strike_up_conversation` | `talk_issue` | `break_off`. Being in a faction
is required for the page to render at all — otherwise it reads "Join a faction to recruit
sleepers."

**Three corrections to the above, added 2026-08-23 from the same bundles.** The `attributes`
and `money` names are the *query keys the mutation invalidates*, not the price — the price
is `energy_cost`, which the server sends and the page prints in its own header as
`{recruited_count}/{sleeper_cap} recruited · {energy_cost} energy`. So there is a **cap on
recruited sleepers**, and the canvass price is known and server-set rather than fixed.

`break_off` is in the client's label map but **the client never sends it**. The Drop button
is wired to `POST …/drop`, and the only two values `meet` ever carries are
`strike_up_conversation` (when `status === 'lead'`) and `talk_issue` (otherwise). Whether
the server would accept `break_off` on `meet` is unknown and is not going to be tested.

The **Canvass button is disabled unless an issue is selected** — `disabled: !active ||
pending || site === '' || !issue` — even though the canvass body is `{ site_id }` alone and
the issue is never sent. A purely client-side gate, and a confusing one: it makes the issue
selector look like it belongs to canvassing when it belongs to meetings.

### The lead state machine

A lead carries `status`, `next_meeting_at`, `expires_at`, `meeting_count`, `site_name`,
`archetype_name`, `issue`, and `traits.clue`. The client derives four display states:

| state | condition | button | enabled |
|---|---|---|---|
| `new lead` | `status === 'lead'` | Strike up a conversation | yes |
| countdown | `status === 'meeting'` and `now < next_meeting_at` | Talk about issue | **no** |
| `1h window` | `now` is between `next_meeting_at` and `expires_at` | Talk about issue | yes |
| `missed` | past `expires_at` | Talk about issue | **no** — only Drop remains |

Striking up a conversation is what *sets the appointment*. From then on the lead is only
workable inside its window, and there is no way back from `missed`.

The action button is additionally disabled unless your own `status === 'active'` and an
issue is selected in the dropdown.

**Canvassing is not the follow-up.** Canvass only produces new leads; an existing lead is
worked from its own card on the same screen. The 30s refetch means a card left on screen
flips from countdown to open window on its own.

### The faction side

`GET /api/factions/{id}/sleepers` returns rows carrying `effectiveness` (a percentage),
`recruiter_username`, `can_advocate_at` and `can_embezzle_at` — two independent cooldown
timestamps, re-evaluated by the UI on a 30s tick. The panel groups sleepers by recruiter and
displays faction power, sleeper count, **avg effect %**, and an "embezzled · 30d" figure
(rendered `—` in this build, so either unimplemented or not populated client-side).

### One client-side inconsistency

The open-window badge hardcodes the string `1h window`, while the chip beside it renders
`window ${window_minutes}m` from the server response. If the server ever sends anything
other than 60, the badge is wrong and the chip is right. Noted so nobody re-derives it.

## Inferred

- **The clue names the lead's issue.** Each lead renders `traits.clue` and `issue` as chips,
  and `meet` sends the issue *you* picked. The obvious reading is that talking about the
  right issue advances the lead and the wrong one risks `outcome: 'lost'`. The matching rule
  is server-side and unverified — but note the selector is **global while `issue` is
  per-lead**, so one setting cannot be correct for every lead in the list at once.
- **Repeated successful meetings convert a lead.** `meeting_count` is tracked and displayed;
  the threshold is not client-visible.
- **The site list is probably scoped to where you are.** The response carries
  `location_name` and the page falls back to `current_location.name`, which reads like a
  response about your current location rather than the world. If so, leads found in one city
  may only be workable from that city — a strong candidate for why windows get missed. Not
  verified; it would take a capture from two locations to settle.

## Still unknown

- What converts a lead to a sleeper: meeting count, an issue-match score, a stat check, or
  some combination.
- What sets `effectiveness`, and whether `archetype_name` or site type feeds it.
- Whether `advocate` / `embezzle` scale with `effectiveness`, and what the cooldowns are.
  (Half-answered 2026-09-16: embezzle *costs* effectiveness — see the last part of this
  file. What either one pays, and whether the payout scales, is still open.)
- What "arrests siphon power" means mechanically — presumably sleepers can be caught, but
  nothing client-side describes the risk or what triggers it.
- Whether meeting a lead requires being at its site, its district, or neither.
- Whether a `missed` lead is pruned server-side or lingers in the list.

---

# The timer is invisible everywhere except one screen

Added **2026-08-23**, from the 2026-08-10 bundles already on disk. Zero requests. Prompted
by the failure mode an operator actually hits: *you strike up a conversation, the meeting is
set about a day out, and by the time the hour arrives you have forgotten it existed.*

## Why that happens is structural

**`next_meeting_at` and `expires_at` arrive in exactly one response and nowhere else.** A
grep for `sleeper` across all 139 files in the bundle finds it in six: `SleeperRecruitmentPage`,
`FactionPage`, `ActionsPage` (the tile that links to it), `WikiArticlePage`, `factionUtils`,
and the entry chunk (the lazy-import and the route). None of the last four carries a lead —
they carry a link, a sentence, and a route. No global poll, no dashboard field, no socket
frame carries a lead's timing. `/api/actions/sleeper-recruitment`
is fetched only while that route is mounted. **Leave the page and the countdown stops
existing for you** — not stale, absent.

**The game will not remind you.** Push notification preferences in the entry chunk are a
four-key object and that is the whole set:

```js
{ jail_release:!1, hospital_release:!1, hospitalized:!1, travel_arrival:!1 }
```

There is no sleeper event, no meeting event, no faction event. The Web Push machinery is
real — `/push/vapid-public-key`, `/push/subscription`, a `sw.js` registration, a
`politiko_push_preferences` key — and a sleeper meeting is simply not one of the things it
can tell you about. This matters for the rules envelope too: the standing argument against
script-sourced notifications is partly *"the game already does this via Web Push"*, and for
this surface it demonstrably does not. The conclusion is unchanged — clause 4 stands on its
own — but the second half of the reasoning does not apply here.

**And the failure is one-way.** Past `expires_at` the card renders `missed`, the action
button stays disabled forever, and Drop is the only control left. Whatever the meetings cost
is gone.

## Measured, from `SleeperRecruitmentPage`

The badge is derived by two helpers, and they are worth reproducing exactly because any
tool that points at this surface has to agree with them:

```js
isPast = (t) => !t || new Date(t).getTime() <= Date.now()

canAct = (lead) => lead.status === 'lead'
  || (meet > 0 && exp > 0 && now >= meet && now <= exp)   // BOTH timestamps required
```

A lead carrying only one of the two timestamps is **never workable** — `canAct` needs both
to be truthy. The badge then reads: `new lead` → `1h window` → the countdown → `missed`.

The countdown formatter caps at hours:

```js
n = floor(secs/3600); r = floor(secs%3600/60)
return n > 0 ? `${n}h ${r}m` : `${r}m`
```

so a day-long wait renders as `24h 0m`, never as days. **The ~24h figure itself is
field-reported by the operator, not client-derived** — nothing in the bundle states the
interval; the server sets `next_meeting_at` and the client only formats it.

Sites carry two fields the earlier pass missed: `security_level` (rendered `Security N/100`)
and `description`. Neither is used for anything client-side beyond display, and whether
security feeds the canvass roll is not knowable from here.

## The faction side, and the same problem again

`FactionPage` tabs are `['Faction','Jobs','Armory','Properties','Sleepers','Controls']`, held
in `useState('Faction')` — **local component state with no URL**, so there is no link that
opens the Sleepers tab directly. The tab is filtered out of the array entirely unless your
rank has `can_manage_sleepers`, which is a stronger gate than hiding the contents: a player
without the rank cannot see that the tab exists. `/faction` is a `<Navigate replace>` to
`/factions/{id}`.

The two cooldowns render as a bare local clock time — `advocate ready 3:45:12 PM` — with no
date and no countdown, re-evaluated on a 30s tick. Same shape of forgettable as the leads,
one page further in.

## What was built from this

[`userscripts/sleeper-watch.user.js`](../userscripts/sleeper-watch.user.js). It records the
absolute timestamps off the poll that screen already makes, then counts them down on every
Politiko page from local arithmetic — **no request is needed to keep a countdown honest once
you hold the instant it ends.** When a window opens it shows an in-page strip with a button
that navigates back and pre-selects that lead's own issue, which the game's single global
selector cannot do for more than one lead at a time. It presses nothing.

It also answers two of the open questions below by observation rather than inference, since
both are free once the leads are being tracked: it pairs each meeting's `outcome` with the
issue that was showing in the selector when the reply landed, and it records the state a
lead was last in when it left the list.

---

# The appointment is press + 24 h, which is what makes the window yours

Measured **2026-09-16**, from sleeper-watch's own ledger and lead store in the bundle
`politiko-stores-2026-09-16_06-07-48.json`. No request was made to produce it: every
number below was already sitting in `pksw:ledger` and `pksw:leads` from ordinary play.

## Measured

**The meeting window opens exactly 24 h after you strike up the conversation, and lasts the
hour the header already advertises.** Pairing each `meet` ledger row carrying
`outcome: 'scheduled'` against that lead's `next_meeting_at`:

- **n = 40 presses. Every direct pair is `24.00 h`.** Not approximately — the minute and
  second match. (Rows reading 48 h or 72 h are the same lead re-paired against a *later*
  appointment, an artifact of matching on lead id rather than a different behaviour.)
- **Press hour == appointment hour in 37 of 40**, the three exceptions being those
  multi-day pairings.

So the appointment is not scheduled by the server in any sense the player has to accept.
**It is a mirror of the clock at the moment you press**, and the game offers no way to
choose it directly — which means the only control anyone has over when a window opens is
*when they press*, and that control is total.

## The finding that follows, and it is not about the game

Every one of those 40 presses landed between **10:14 PM and 1:08 AM Eastern** — the zone
`read-stores.js` buckets the bundle in, named because the next sentence rests on it —
median **11:23 PM**. Forty presses inside a band under three hours wide.

Combine that with the offset and the mechanism is self-replicating: **the hour you play is
the hour you are summoned back to.** Every appointment set inside that band reopens inside
that same band a day later, so the band never widens on its own — it can only be moved, by
pressing at a different hour.

Twelve leads have been lost inside it, in the four cohorts tabled below — every one of the
twelve, with no loss recorded anywhere outside it. *Why* the player was absent for those
particular hours is not something this bundle measures: a session's start and end are not
recorded anywhere, only the instants of presses. So the loop is the finding and the cause
is not. What matters is that the loop closes without anyone choosing it, and that one press
at a different hour opens it.

Every cohort on record, from each lead's own `expires_at` — the server's instant, never a
ledger `at`:

| cohort | window closed (ET) | hour | lost |
|---|---|---|---|
| Women's Rights ×3 | Aug 28, 12:30 AM | 00 | yes |
| Abortion ×3 | Sep 3, 12:38 AM | 00 | yes |
| LGBT Rights ×3 | Sep 14, 12:56 AM | 00 | yes |
| Civil Rights ×3 | Sep 15, 11:14 PM | 23 | yes |
| **12 lost** | | | |
| Civil Rights ×3 | Sep 17, 2:07 AM | 02 | *not yet due* |

The last row is **not** part of the twelve and must not be added to it — at the time of
writing its window is still a day away. It was pressed at 1:07 AM, *before* the offset was
measured, so its hour was not chosen either; it is the old pattern's last cohort, not the
new one's first. What makes it worth listing is that 02 falls just outside the band all
twelve losses sit in, which makes it an accident that happens to test the band. Its outcome
belongs in this file once it is known, whichever way it goes.

**The lever is free.** Because the window is a copy of the press, moving the press moves
the window — one for one, to the minute. Pressing an hour into a session rather than on the
way out of it buys that whole session's remaining length as slack, every day, forever,
for no energy and no extra action. Which hour is the good one is the player's to know and
not this file's to guess; the only claim here is that **the choice exists and is exact**.

Same action, same energy, same clause. The difference is entirely in the hour it was taken.

This is worth stating plainly because the expensive answers were all reached for first: a
title flash, a sound, a desktop notification, a fifth Web Push key from staff. None of them
were needed. The mechanic was already controllable and nobody had measured the offset.

## Inferred

- **The 24 h offset is probably fixed rather than derived.** Forty pairs at exactly
  `24.00 h` across five separate cohorts and three weeks is hard to produce from a formula
  with any input in it, but nothing client-side states the constant, so it is observation
  and not a read of the rule.
- **Nothing suggests the offset can be influenced.** No field in the recruitment response
  looks like a scheduling parameter, and the UI offers no choice. If some stat or faction
  perk shortens it, no evidence here would show it.

## Still unknown

- Whether the offset changes with faction rank, sleeper cap, or anything else. One account
  cannot answer this, and `docs/01-rules-envelope.md` rules out acquiring a second.
- Whether an unattended window costs the lead immediately at `expires_at`, or whether the
  server prunes later — `missed` is what the client renders, but the pruning that removes
  it from the list has only ever been observed on a subsequent poll.

## What was built from this

sleeper-watch **0.10.0** puts the number in front of the decision: the leads tab shows what
a press *right now* would schedule, live, and — where its own record supports it — how many
windows have already been lost in that hour. Local arithmetic on the clock; zero requests.

## Method disclosure

Local grep and de-minification of bundles pulled once on 2026-08-03, extended 2026-08-23
against the 2026-08-10 pull. No new pull, no requests of any kind, no in-game recruitment
performed to test any of it.

The 2026-09-16 section above is a different method and should be read as such: it is a
statistical read of one player's own stored observations, produced by ordinary play, not a
read of the client's code. The 24 h offset is therefore **measured behaviour, not a quoted
rule** — the client never states it.
---

# Embezzle is a price list, not an action

Recorded **2026-09-16**, from the operator's own play. **Not measured here** — nothing in
the bundles prices either faction action, and no embezzle was performed to find out. It is
in this file because it settled a design question, and a design question answered off the
record is one nobody can re-check.

**Embezzling pays a few thousand dollars, and takes it out of the sleeper's own
effectiveness.** The sleeper stays recruited and stays listed; it is permanently worse at
the thing it was recruited for. `advocate` has no such cost — it generates faction power on
its own cooldown and leaves the asset alone.

So the two timestamps on a faction sleeper row are not two halves of one decision.
`can_advocate_at` is a thing to do when it comes up. `can_embezzle_at` is an offer, the
answer is standing, and the answer is no.

That is also why the faction panel's own line — *advocate generates power · embezzle
siphons cash · arrests siphon power* — is not the whole sentence. It names what each one
gives and omits what one of them charges.

## What was built from this

sleeper-watch **0.10.0** stops announcing it. An embezzle cooldown reaching zero no longer
raises the strip and no longer counts toward the `SLP` button, and the strip's faction
event says `SLEEPER CAN ADVOCATE` rather than `SLEEPER READY`, because only one of the two
was ever worth interrupting for. The cooldown is still read, still stored, and still
counted down in the Sleepers tab — the reading is free, it costs no request, and the
questions below are still open. What went away is the interruption, not the number.

## Still unknown

- **The actual numbers.** "A couple of thousand" and "it goes down" is a player's reading of
  playing, not a measured pair. The faction panel's own `embezzled · 30d` figure renders
  `—` in this build, so the client does not show the payout either.
- **Whether the effectiveness cost is per use, scales with the payout, or recovers.** If it
  recovers, the standing answer above is a default rather than a rule. Nothing observed
  says it does, and watching one is free: `effectiveness` is already stored per sleeper by
  sleeper-watch, so a before/after pair would fall out of ordinary play if an embezzle ever
  happened.
- Whether `advocate` scales with `effectiveness` — unchanged from the 2026-08-07 part above,
  and now the more interesting half of that question, since it is the side with no cost.
