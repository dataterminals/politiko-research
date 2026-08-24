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

## Method disclosure

Local grep and de-minification of bundles pulled once on 2026-08-03, extended 2026-08-23
against the 2026-08-10 pull. No new pull, no requests of any kind, no in-game recruitment
performed to test any of it.
