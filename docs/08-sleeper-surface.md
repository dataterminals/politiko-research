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
     → { districts:[{ ...,sites:[{id,name,...}] }], issues:[], leads:[], sleepers:[],
         faction_name, location_name, window_minutes }

POST /api/actions/sleeper-recruitment/canvass         { site_id }
     → { flavor, found }            found > 0 is a hit; costs `attributes`

POST /api/actions/sleeper-recruitment/{id}/meet       { action, issue }
     → { flavor, outcome }          outcome === 'lost' loses the lead;
                                    costs `attributes` and `money`

POST /api/actions/sleeper-recruitment/{id}/drop       {}

GET  /api/factions/{id}/sleepers                      gated on can_manage_sleepers
POST /api/factions/{id}/sleepers/{sleeperId}/advocate {}
POST /api/factions/{id}/sleepers/{sleeperId}/embezzle {}
```

`action` is one of `strike_up_conversation` | `talk_issue` | `break_off`. Being in a faction
is required for the page to render at all — otherwise it reads "Join a faction to recruit
sleepers."

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

## Method disclosure

Local grep and de-minification of bundles pulled once on 2026-08-03. No new pull, no
requests of any kind, no in-game recruitment performed to test any of it.
