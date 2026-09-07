# The blackjack surface — the six-deck table

Read **2026-09-03** off `artifacts/bundles/2026-09-03/CasinoBlackjackPage-BSYFJcI7.js`
(27,043 bytes) and `blackjackChips-CzMxhKc4.js`, with zero game contact. Everything below
is **measured from the shipped client** unless a line says otherwise. As always that
proves what the *client* expects, not what the server sends.

Prompted by a request for a tool that watches the table in whatever state it is in, tracks
the money in and out, and prices the chances, the strategy and the tactics. It became
`jack-watch`. Read [`18-casino-slots-surface.md`](18-casino-slots-surface.md) alongside
this: the two tables are wired the same way and the interesting part is where they differ.

**The whole casino is at most a month old, and there is only one of it.** Measured from the
two bundle pulls this repo holds: the 126-file set from **2026-08-03 contains no mention of
the word "casino" anywhere**, and the set from **2026-09-03 carries seven casino chunks** —
lobby, blackjack, slots, roulette, craps, poker, predictions. And the operator confirms only
one corporation runs one. Both facts turn up again below, because between them they explain
why hand ids are in the hundreds rather than the millions, and they retire an argument this
document made before either was known.

## The one difference that matters

The slots page hands you `theoretical_rtp_bps` and `house_edge_bps` and asks you to take
its word for the reel strips, which are server-side and unknowable. **Blackjack is the
exact mirror.** No RTP, no edge, no advertised number anywhere on the wire — but the
complete rule set is printed on the page, and blackjack under a stated rule set is a
solved game. So:

- on slots, the headline number is **stated and unverifiable**;
- on blackjack, the headline number is **unstated and exactly computable**.

That is the whole reason `jack-watch` carries a solver instead of a division.

## Getting there

```
/corporations/{id}/casino/blackjack
```

A backtick template literal in the router, like every other casino route
([`12-navigation-surface.md`](12-navigation-surface.md)). `current_city_access` gates it —
a casino is a building you stand in.

## The page is a canvas, again

`CasinoBlackjackPage` mounts a **Phaser game** (`p.Game`, `type: p.AUTO`, 900x680 desktop
/ 540x1060 below 639px) into a `<div aria-hidden="true">`. The felt, the cards, the chip
tray, the betting circle, HIT/STAND/DOUBLE/SPLIT, the result banner — all painted into a
`<canvas>`, none of it in the DOM.

Two things escape it:

1. **An `aria-live` mirror.** One `<p class="sr-only" aria-live="polite">` carrying the
   whole table as a sentence — `Dealer: <cards>. Hand 1: <cards>, value N, wager $X,
   <outcome>. Round status: <status>.` — or `No active blackjack hand.` It is built for a
   screen reader and it is the only DOM rendering of the cards that exists.
2. **The settlement receipt, in real HTML.** A `<section>` headed **"Last hand" /
   "Settlement receipt"** with four cells — Wager, Gross, Tax, Net profit — and the hand
   id in a `#`-prefixed chip.

Also DOM: the three header stat blocks (Table limit, Dealer, House reserve), the House
rules aside, and a footer strip carrying free reserve, increment, dealers and cash.

**Neither is what a tool should read**, for the same reason as slots: both are renderings
of payloads that carry strictly more. A scrape would give up the card-by-card record to
re-parse four numbers out of formatted strings.

## The four calls

All four are made by the client itself. The base is `https://politiko.io/api`, so the
client's `/corporations/{id}/…` are `/api/corporations/{id}/…` on the wire.

| Call | Query key | Cadence | Payload |
|---|---|---|---|
| `GET /api/corporations/{id}/casino/blackjack` | `['casino-blackjack', id]` | `refetchInterval: 15000` | the table config + `active_hand` |
| `GET /api/corporations/{id}/casino/blackjack/history` | `['casino-blackjack-history', id]` | `refetchInterval: 15000` | `{ hands: [...] }` |
| `POST …/blackjack/hands` | — | on DEAL | `{ hand }` |
| `POST …/blackjack/hands/{id}/actions` | — | on HIT/STAND/DOUBLE/SPLIT | `{ hand }` |

Both POSTs invalidate `['casino-blackjack']`, `['casino-blackjack-history']` and
`['casino-summary']`, and call the app's own balance refresher — so every action is
followed by a small burst of the client's own traffic.

**The 15-second refetch is again the whole reason a passive tool works.** Both GETs
re-fire on their own while the page is open, and `refetchOnWindowFocus` still holds (the
app sets no `defaultOptions`), so an alt-tab back re-fires both immediately.

### The config payload

Twelve fields, every one read by the client:

```
blackjack_min_bet    int    table floor
blackjack_max_bet    int    table ceiling
wager_increment      int    bets must be a multiple of this
player_cash          int    your cash, as of this poll
free_reserve         int    what the house can pay out of
reserve_balance      int    the reserve headline in the header block
dealer_capacity      int    how many dealers this casino employs
available_dealers    int    how many are free right now
current_city_access  bool   false -> "Travel to a city with an active venue"
operational          bool   the casino has a casino-type property
wagering_suspended   bool   unpaid regulatory fine
active_hand          obj    the hand in progress, or null
```

There is **no `house_edge_bps` and no RTP field** — not here, and not on
`GET /corporations/{id}/casino` either, whose only rate fields are `slots_rtp_bps`,
`poker_rake_bps` and `prediction_fee_bps`. Blackjack advertises nothing.

**The coverage rule, which the page only tells you about after you have stacked chips.**
`renderBetting` blocks the deal when `wager * 4 > free_reserve`. Four, not two: a round can
end up staking twice the opening wager across a split and twice again on a double after
it. So the largest wager the house will currently accept is
`floor(free_reserve / 4 / increment) * increment`, and it can bite well below
`blackjack_max_bet`. Nothing on the page states it as a number.

### The hand

Read off `setView`, `render`, `renderActions`, `renderResult` and the receipt block:

```
id              int     hand identity, and the only ordering key on the wire
status          str     'player_turn' | 'settled' (the client tests only these two)
outcome         str     round outcome; open vocabulary, see below
current_hand    int     index into player_hands whose turn it is
allowed_actions str[]   subset of hit | stand | double | split
dealer_cards    str[]   'hidden' for the hole card while you are still acting
player_hands    obj[]   one per hand after a split
opening_wager   int     what REPEAT BET would re-place
total_wager     int     staked across the whole round, splits and doubles included
gross_payout    int     returned before tax
tax_amount      int     withheld
net_payout      int     gross_payout - tax_amount, credited
```

and per element of `player_hands`:

```
cards    str[]   e.g. ['AS', '10H']
wager    int     this hand's stake
outcome  str     rendered with .toUpperCase(), so the vocabulary is open
status   str     'resolved' is the only value the client tests
```

**Cards are rank-then-suit strings** — rank in `A 2 3 4 5 6 7 8 9 10 J Q K`, suit in
`S H D C`, plus the literal `'hidden'`. That is measured: the preloader builds a texture
key for every one of the 52 combinations, and the client's own totalling function slices
the suit off the end.

**The outcome vocabulary is open.** `'blackjack'` is the only value the client names;
everything else is uppercased and printed. A tool must display outcomes rather than switch
on them.

### The rules, as the client states them

The House rules aside, verbatim in six bullets, plus the header subtitle and two lines
painted on the felt:

| | |
|---|---|
| decks | **six** (the header subtitle: "Six-Deck Table") |
| blackjack pays | **3:2** (also painted across the felt) |
| dealer | **stands on soft 17** (the felt says "DEALER STANDS ON ALL 17") |
| splitting | **one split**; **double after split** allowed |
| split aces | **one card each** |
| hole card | **dealer peeks on ace or ten** |
| not offered | **no insurance, no surrender** |
| tax | "ordinary-income tax on positive round profit" |

That is a complete rule set. Every number `jack-watch` computes comes out of those eight
lines and nothing else.

**What the rules do not say, and a tool must not assume:** whether a ten on a split ace
pays 3:2 (it almost never does anywhere, and `jack-watch` assumes even money and says so
where it matters), whether doubling is restricted to certain totals (the server sends
`allowed_actions`, so the client never needs to know and neither do we), and the tax rate
or bracket, which is server-side exactly as it is for slots.

### Auto-play does not exist here

Slots ships its own auto-spin loop, which is what settled the automation question on that
surface. Blackjack ships nothing of the kind: every deal and every action is a button.
That removes the "the game already does it" argument and leaves the plain one —
`CLAUDE.md` hard rule 2 and [`01-rules-envelope.md`](01-rules-envelope.md). Automating a
deal would be a request not manually initiated by the user, on the only account there is,
to save a click. `jack-watch` originates nothing, and the paths and payload shapes that
would place a deal or an action are absent from the file rather than disabled;
`tools/test-jack-passive.js` fails the build if any of them appears.

Worth stating plainly, because blackjack is the surface where the temptation is real: a
solver that knows the right action and a button that presses it are one line apart, and
that line is the entire difference between a reader and a bot.

## What the client fetches and throws away

**The history array.** `GET …/blackjack/history` returns `{ hands: [...] }` and the page
reads exactly `hands[0]`. Every other element is fetched, parsed, cached by TanStack and
never rendered — the same free back-catalogue slots has, and the reason `jack-watch` has
history the moment you open it. Depth is not measurable from the bundle: the client passes
no page or limit parameter, so it is whatever the server defaults to.

**And this time the discards carry cards.** The client's fallback path
(`!active_hand && local?.status === 'player_turn' && history[0].id === local.id`) assigns a
*history element* into the view and renders it — `dealer_cards`, `player_hands`, the lot.
So unlike slots, where the bundle was silent on whether history carried `spins[]`, here the
client demonstrably **expects** history entries to carry the full card record. That is
still an expectation of the client and not a promise from the server, so a tool takes the
cards when they are there and says so when they are not.

### The catch, stated as a limit

**Nothing on this surface carries a timestamp** — not on the hand, not in history, not
anywhere the client reads, exactly as on slots, roulette and craps. A tool cannot say when
a hand was played; it can only say when it first saw it, and order by `id`. Every clock in
`jack-watch` is a local first-seen stamp and is labelled "seen".

## Expected value, and what is actually computable

Because the rule set is complete, the following are **exact arithmetic on the stated
rules** and need no observation at all:

- the dealer's final-total distribution from any up card, conditioned on the peek;
- the EV of standing, hitting, doubling and splitting on any hand;
- therefore the correct action, and the cost of any other one;
- therefore the house edge under perfect play.

`jack-watch` computes the last of those by summing over every initial deal:

```
house edge, perfect play, fresh six-deck shoe:  0.4593%
```

That figure is produced by the tool's own solver, not quoted from anywhere. It is
consistent with the published value for this rule set — six decks, S17, DAS, no
resplitting, no surrender, 3:2 — which is one of the checks `tools/test-jack-ev.js` makes,
along with reproducing the canonical basic-strategy table cell for cell and agreeing with a
four-million-round Monte Carlo on the dealer distribution.

**Two approximations are made, and both are named on screen rather than buried:**

1. The dealer's distribution is computed once against the shoe as it stands at your
   decision and held fixed while your own draws are enumerated. Recomputing it after each
   of your own cards would be exact. The difference is small; this tool does not measure
   it, so it is declared as an approximation rather than quantified.
2. A split is priced as twice the EV of one split hand against the composition with both
   pair cards removed. The two hands are actually dealt from a shoe each is depleting.

**And the same asymmetry slots has.** The edge is quoted on the round; the player is paid
net. `net_payout = gross_payout - tax_amount`, and the House rules say "ordinary-income tax
on positive round profit" — it lands on winning rounds and gives nothing back on losing
ones. So the effective edge is the computed edge **plus** a tax drag, and the drag is
measured, never modelled:

```
tax drag       = sum(tax_amount) / sum(total_wager)     two observed sums, no assumption
effective edge = computed edge + tax drag
realized edge  = -sum(net_payout - total_wager) / sum(total_wager)
```

Unlike slots, the structure lever cuts the other way. Tax there is assessed on aggregate
*session* profit, so how a run is split into sessions changes the bill; here it is assessed
per **round**, and a round is one hand. There is no netting to arrange. The only lever left
is how much is staked per round, which is what the planner prices.

## First measurements from live play — 2026-09-04

Everything above this line was read off the bundle. This section is the first thing on this
surface that was **measured at the table**: 51 rounds, ids 339–389, over 12.4 minutes,
$1,869,000 staked. Where it disagrees with something inferred from the client, it wins.

### The tax is zero, and that was not the expectation

```
staked         $1,869,000
gross          $2,012,000
tax withheld   $0            <- on every one of 51 rounds, 23 of them winners
credited       $2,012,000
tax drag       0.0000%
```

`tax_amount` came back **0 on every round**, including a +$150,000 and two +$100,000
returns. The House rules aside says "ordinary-income tax on positive round profit", and
this document — reasoning by analogy from [`18-casino-slots-surface.md`](18-casino-slots-surface.md),
where the drag is real and material — treated the drag as a term that would need measuring
because it would be *there*. On this evidence it is not.

**Answered the same day, by the operator: the government has all but abolished income tax.**
So the zero is a reading of the current tax code and not a property of the blackjack table
— the first of the three readings this section originally offered, confirmed, and the other
two (blackjack is exempt; there is a bracket six figures does not reach) are dead.

That is a better answer than "no tax here" and a more demanding one, because it has a
tense. **The drag is a live political variable.** A budget that restores income tax makes
the effective edge move without anything about the table changing, and a ledger that spans
the change reports the blend of both regimes rather than either. `jack-watch` measures the
drag on every repaint so it follows the policy by construction, prints "nothing taxed yet"
rather than a bare `0.000%` so a zero cannot be read as a permanent property, and points at
LOG's "clear" as the way to ask about the rate you are actually playing under.

What matters for tooling is that the shape held up: `jack-watch` measures the drag rather
than modelling it, so it printed `0.000%` and an effective edge equal to the computed one,
instead of inventing a plausible-looking deduction. **A modelled rate would have been wrong
by its entire value here** — and would then have been wrong in the other direction the day
the budget passed.

### History does back-fill, and reaches before the tool existed

The session above arrived as 51 rounds with 51 distinct timestamps, which is the signature
of live observation — a history back-fill lands as a batch sharing one stamp. That looked
like it might mean the array was returning almost nothing.

**It does not.** Confirmed by the operator: on install the panel came up already holding
rounds from play that predated the script, and the 51 above start where they do because
LOG's "clear" was pressed. So `GET …/blackjack/history` **returns hands from before
anything was watching**, which is the same free back-catalogue slots has and the reason a
tool on this surface has a ledger the moment it is installed rather than only from then on.

The exact depth is still unmeasured. The client sends no page or limit parameter, so it is
whatever the server defaults to, and the one instrument that could read it — a fresh
install's first poll — has already fired here. It is recoverable, though: "clear" sets a
floor and deletes nothing, so those pre-install rounds are still in `pkbj:data` behind the
mark, and LOG's "all" brings them back with a count.

### Hand ids: open, and two arguments retracted

339 through 389 with **no gaps at all** across 51 consecutive rounds, and 311 through 335
before that. Then one gap: the mark set by LOG's "clear" was `#335`, and the next hand
actually played came back **#339**. So 336, 337 and 338 were allocated in the 72 seconds
between, and never appeared in this casino's history.

Two readings, and this section previously argued for the second on grounds that have since
been withdrawn. Both retractions are the operator's, and both matter:

**Retracted 1 — "those three are hands at a different corporation's casino."** There is only
one casino in the game. The explanation was not weak, it was impossible, and `jack-watch`'s
per-corporation ledger — correct as defensive generality — will only ever hold one corp.

**Retracted 2 — "339 is far too low for a counter shared by every hand a casino ever dealt."**
That assumed an established casino. It is not one: **there is no mention of the word
"casino" anywhere in the 126-file bundle set pulled 2026-08-03**, and seven casino chunks in
the set pulled 2026-09-03. The whole casino is **at most a month old**. Four hundred
blackjack hands game-wide over a few weeks is entirely ordinary, so the size argues for
nothing.

What is left is genuinely open:

- **the counter is the player's** — then those three are hands this tool did not see, which
  is easy enough: they fall in the window where the script was being installed.
- **the counter is the casino's, shared by everyone** — then those three belong to another
  player, and the 76 unbroken ids around them mean the only blackjack table in a young game
  was otherwise idle for a quarter of an hour. At 1 a.m. Eastern that is not much of a
  stretch either.

**The test that survives:** a second player installs `jack-watch` and compares hand ids over
the same evening. Interleaved and disjoint means one shared sequence; overlapping ranges
mean each player has their own. That is one friend and one paste, and it is the only
instrument left — no alt account, ever ([`01-rules-envelope.md`](01-rules-envelope.md)).

One thing this section got right and keeps: the guess made when the panel was built — that
ids are shared, so id differences would measure house traffic — came from invented harness
fixtures rather than data, and should never have been asserted. The design decision it was
used to justify is unchanged and right for a better reason: `jack-watch` counts the gap
between shoe breaks in **rounds its ledger holds**, because the *ledger* is what has holes in
it — hands from before you installed it, hands history had already dropped, hands the cap
pruned. The cadence being measured is a cadence of observations.

Nothing in `jack-watch` depends on the answer. It orders by id and measures shoe cadence in
rounds, and both hold under either reading — which is the whole reason the id question can
sit open in a document instead of blocking a build.

### The shoe question is answered: it turns over, and counting is dead

**81 rounds with cards, 447 cards, one player.** `shoeState()` run over them declares three
breaks, and the two that fall inside a single continuous sitting are what matter:

```
break at hand #339   — the sitting boundary, dropped as a floor rather than a gap
break at hand #364   — 25 rounds after the previous
break at hand #385   — 21 rounds after that
```

Against the simulated yardstick:

| | median gap | 5th–95th | observed 25 and 21 |
|---|---|---|---|
| reshuffles every round | 23 | 14–31 | **both inside** |
| persistent, cut at 50% | 30 | 23–37 | 25 inside, 21 below |
| persistent, cut at 75% | 43 | 41–46 | both far below |
| persistent, cut at 90% | 52 | 50–54 | both far below |

A seventh sighting is not a hint, it is arithmetic: a six-deck shoe holds exactly six of
each code, so a seventh **proves** a real reshuffle happened inside that window. Two windows
of 25 and 21 rounds — about 138 and 116 cards — mean the shoe is being replaced at least
that often. A shoe cut at three quarters deals 234 cards before it is replaced, which for a
lone player is 42-ish rounds. Nothing here is close to that.

**And sharing cannot explain it away.** If other players drew from the same shoe you would
see a *fraction* of each shoe's cards, so a real reshuffle would take **more** of your
rounds to show up, not fewer. Observed breaks are early. Sharing pushes the wrong way.

So the honest conclusion, on this table on this evening: **the shoe turns over far too fast
to count, and the COUNTED composition is a fiction after about twenty rounds.** `jack-watch`
already defaulted to TABLE, which is the correct answer, and now says so out loud when the
measured gaps land in this band.

This does not generalise beyond what was measured — one player, one casino, one evening,
two informative gaps. What it does do is make the question cheap to re-ask anywhere else,
which is all the test was ever for.

### The dealer does not draw when you bust

Not stated anywhere in the client, and measured here for the first time: of **15 rounds
where every player hand busted, 12 show a dealer hand totalling under 17.** A dealer that
had played the hand out could never stop below 17 under S17. So once the round is already
decided the dealer turns the hole card over and stops.

Both halves matter for a passive tool. The hole card **is** revealed — settled hands in the
ledger carry zero `hidden` entries, so the count loses nothing to busted rounds — but the
draw does not happen, so a busted round puts fewer cards on the table.
`tools/sim-shoe-cadence.js` models this now; it moves cards-per-round from 5.56 to 5.46
against 5.52 observed, and shifts none of the conclusions.

### History depth: at least 25

The back-fill is visible in the ledger as a fingerprint — **25 rounds, ids 311–335, all
sharing the timestamp `00:49:51.080`**, which is the moment the tool first polled. Live play
after that carries its own stamp per round. So `GET …/blackjack/history` returned at least
25 hands in one response. Whether that is the server's cap or simply all that existed is
still unmeasured.

The three missing ids sit exactly between the back-fill and live play — 336, 337 and 338,
dealt in the 72 seconds between them, which is the window the script was being installed in.
They cannot be hands at another casino, because there is only one; see the id section above
for what is left of that question.

### The deal is fair, on every test the cards support

447 cards is enough to ask, and nothing here is out of place:

| test | result | |
|---|---|---|
| rank frequencies, 13 ranks | chi-square **13.53** on 12 df | 5% critical 21.03 |
| exact card codes, 52 of them | chi-square **65.21** on 51 df | 5% critical 68.67 |
| tens (10 J Q K) | 28.41% vs 30.77% expected | z = −1.08 |
| hi-lo running total over all 447 | **+21** | sd 18.5, z = 1.13 |

Every one passes, and all 52 codes appeared at least once. The code test is the least
comfortable at p ≈ 0.09, which at one test in four is what you would expect to see anyway.
**Nothing suggests the deal is anything but a fair six-deck shoe** — worth having measured
rather than assumed, and worth re-running on a bigger ledger before anyone says it louder.

The dealer also obeys its own stated rules. Across the **58 rounds it actually played out**
there is not one S17 violation — never standing under 17, never drawing after reaching a
standing total — and the 13 rounds it stopped short of are all rounds you had already busted.

### The decisions were sitting in the cards all along

`jack-watch` 0.4.0 built its decision ledger by inferring each action from two consecutive
states of a live hand. Run against these 81 rounds, that approach had captured **3
decisions. The cards in the same ledger hold 109.** Everything played before the tool was
installed, and everything it happened not to catch a transition for, was simply invisible.

A settled round does not need inferring. **The card list is in draw order** — not assumed:
across 81 rounds and 447 cards, no proper prefix of any hand, player or dealer, busts, which
could not happen under any other ordering. So the hand is walked and each step priced.

Three shapes carry no decision and have to be dropped before anything is priced, and the
first is the one that bites:

- **the dealer had a natural** — five of the 81, and the round was over before you could
  act. Every one of them replayed as a nonsense *"you stood on 8 against an ace"* until they
  were excluded;
- **you had a natural** — paid immediately;
- **the round was split** — which half took which card is not on the wire.

A double is unambiguous once splits are gone: it takes exactly one card, so twice the bet on
a three-card hand is a double and nothing else.

Over the 81 rounds that yields **109 decisions, 87.2% matching the solver, about $32,500 of
EV given up** — and a split that is worth stating carefully because it is one player and a
small sample:

```
before jack-watch (25 rounds)   12 departures
with jack-watch   (56 rounds)    3 departures
```

Whether that is the tool or a player warming up is not something 81 rounds can separate, and
it is recorded here as a number rather than a claim.

### Pace: the shoe experiment costs about ten minutes

Median 5.1 seconds between rounds, min 2.1, max 104. At that rate the forty clean rounds
that rule out per-round reshuffling is **roughly ten minutes of play**, not the half hour
this document first suggested.

### What the export could not answer, and now can

Two things were missing from `jack-watch` 0.2.0's LOG export and both showed up the first
time real rows were analysed:

- **no `opening_wager`**, so a $50,000 round is indistinguishable from a doubled $25,000
  one. The bet column in that session ran 1,000 / 2,000 / 11,000 / 22,000 / 25,000 / 50,000
  / 75,000 / 100,000, where every value bar 75,000 is exactly twice another — which is the
  signature of a double *and* the signature of a raise, and nothing in the export separates
  them. It is also the number the staking multiplier is computed from, so the multiplier
  could not be checked against the rows that produced it.
- **no cards**, which means the shoe question cannot be asked of an export at all. The
  sighting test is per exact code; without suits there is nothing to test.

0.3.0 exports `bet`, `staked`, the outcome, the dealer's cards and each player hand's cards.

### And the run was ordinary

+$143,000 over the session, which is a realized edge of −7.65% in the player's favour and
looks like a system. It is **0.5 standard deviations** above what the computed edge expects:
per-round sample deviation 0.95 units over 51 rounds, a cash deviation of $295,372 on the
amounts actually bet. Twenty-three wins, eight pushes, twenty losses; two naturals against
an expected 2.4.

Nothing in it suggests the table is mispriced. It is one good night inside the ordinary
weather of fifty-one rounds, and `jack-watch` 0.3.0 says so on the MONEY tab, because the
panel that shows you a five-figure win and no sense of scale is inviting the wrong
conclusion.

### The one press that cost real money — added 2026-09-06

A second ledger, 41 rounds on corporation 30, read straight out of `pkbj:data`. Net
**−$449,208** on $2,802,208 staked, which is a realized edge of −16.0% and looks like a
disaster. It is **0.84 standard deviations** below what the computed edge expects
(−$11,378 at 0.4593% on $2,477,208 of opening bets; one sd on this run is about
$519,000). Fourteen wins, four pushes, twenty-three losses, one natural. Ordinary weather
again, in the other direction.

The decisions are the interesting half. Replayed from the cards — dropping the split, two
dealer naturals and one player natural, as `replayHand` does — **51 of 52 matched the
maximum**. The single deviation:

| hand | cards | dealer | played | maximum | bet |
|------|-------|--------|--------|---------|-----|
| 617 | `5C 6D` (11) | `10S` | stand | double | $100,000 |

Priced against a fresh six-deck shoe: double +0.180, hit +0.119, **stand −0.540**. The gap
from the best button to the pressed one is **0.720 units, about $72,000** — six times the
entire expected house take of the session, given up on one press. Everything else in the
ledger is variance; this is not.

### Why the cost of a press is printed and not tiered

`jack-watch` 0.6.0 puts that number in HAND, next to the recommendation, and marks the
worst button in the action table. It was going to escalate a colour above a threshold, and
that was measured before it shipped, over **every opening deal weighted by how often it is
dealt**:

| statistic | loud ≥ 0.6 | middle | quiet < 0.15 |
|-----------|-----------|--------|--------------|
| best-to-worst | **45.7%** | 53.9% | 0.5% |
| second-best-to-worst | 24.2% | 62.4% | 13.5% |

Weighted quantiles of best-to-worst: p50 0.561, p75 0.843, **p90 2.021**, p95 2.360.

Two things kill the idea. Best-to-worst fires on nearly half of all hands, and the jump
between p75 and p90 is **pat hands** — the top decile is not close calls, it is "you could
hit this twenty", which nobody does. Raising the line to make loud rare therefore makes it
fire *only* on the hands that are never misplayed. And the obvious fix fails from the other
end: second-best-to-worst puts hand 617, the most expensive press in the ledger, at roughly
the 80th percentile — unremarkable.

Neither statistic isolates the hands people actually get wrong, and on reflection neither
can: **whether a button is tempting is a property of the player, not of the cards**, and
nothing on this surface sees the player. So the loudness is structural instead of
conditional — the worst press is named every time, in dollars, and the digits carry the
alarm. $720 does not need red to read as small.

### The blind spot the flat export could not show — added 2026-09-06

Reviewing what the ledger actually retains turned up a hole that had been there since the
decision replay was written, and it is not a small one.

**`replayHand` refuses splits outright.** Which half of a split took which card is not on
the wire, so the walk cannot be done and the round is dropped. That is the correct
behaviour — guessing would be worse — but the consequence had never been stated: a split
round contributes **zero** decisions, and in an export that only records decisions it is
indistinguishable from a round played perfectly. The decision rate reads as though those
rounds went fine. Nobody looked at them.

Splits are also where the expensive mistakes live, which makes this the worst possible
place for a silent absence.

Three shapes are excluded, not one — a dealer natural, your own natural, and a split — and
only the split is a real blind spot. The two naturals are rounds where there was genuinely
nothing to decide. So as of 0.7.0 the gate is `replayNote`, which returns the **reason**
rather than a bare refusal, and `replayHand` runs on it rather than keeping its own copy of
the list. The export prints the reason per round. An absence that names itself is a
finding; an absence that does not is a lie by omission.

### Why the second export button is JSON and not more columns

The obvious response to "keep more" is a wider TSV. It does not work, and the reason is
structural rather than a matter of taste.

A split round holds two hands. Each has its own cards, its own stake and its own outcome.
A flat row has one cell per column, so the existing export joins the hands with a pipe and
drops the per-half money on the floor — at **any** width. Adding columns cannot fix a
one-to-many relationship; it can only pick a fixed number of halves and hope.

A double after a split is the cleanest demonstration, and it is legal at this table. The
two halves then carry different stakes — one at twice the other — and there is no flat
row that says so.

So `copy` keeps doing exactly what it did, because a flat table is genuinely the right
shape for eyeballing a run in a spreadsheet, and **`copy+`** emits JSON for the nested
questions. Three things live only in the second one:

| | why it cannot be a column |
|---|---|
| both halves of a split, with stakes and outcomes | one-to-many |
| `allowed`, the menu the server offered | a list, and the replay only ever *assumed* one |
| `no_decisions`, the reason a round has none | it did not exist before 0.7.0 |

The second of those is worth its own line. The replay **synthesises** the action menu from
the rules — hit and stand always, double on the first decision, split on a pair — and
nothing has ever compared that to what the table really offered. A double the house would
not have covered would be scored as a mistake that was never available to make. The store
has had the real `allowed` array all along; nothing was reading it. Exporting both is what
makes the check possible, and it is the sort of thing that only turns up when you ask what
is being thrown away.

### Watching, the second time — added 2026-09-06

0.4.0 watched play and stored what it concluded. 0.5.0 deleted that, and the measurement
that killed it is the most useful thing in this file: over the same 81 rounds, watching had
caught **3** decisions where replaying the stored cards caught **109**. A watcher only ever
sees the hands it happened to be running for; the cards are already sitting in the history
the moment you look.

That verdict stands, and 0.8.0 does not reopen it. The decisions on screen are still
replayed from the cards, and nothing stored may become a second answer to that question.

But the retreat was total where it only needed to be specific, and two questions went with
it that the cards genuinely cannot answer:

**When.** Nothing on this surface carries a timestamp. Every date in the ledger is when the
tool first *read* a round, which is why the LOG column is labelled "seen" and not "played".
How long a decision took is not recoverable from a settled round at any effort.

**What happened inside a split.** Which half took which card is not on the wire once the
round settles — this is the same fact that makes `replayHand` refuse splits. It is, however,
plainly visible *while it happens*: every response carries the whole hand as it then stood,
so the halves are separable one sighting at a time and never again afterwards.

So the trail records **state with a clock, and no conclusion whatsoever**. That distinction
is the entire design and it is what makes this compatible with the 0.5.0 deletion rather
than a reversal of it: a stored *answer* can disagree with the replay, and a stored *fact
about the table at 12:04:03* cannot — it can only date one. No action is named, no EV is
attached, nothing is scored. `tools/test-jack-passive.js` fails the build if a judgement
word appears inside a trail entry.

Three properties came out of building it, and the third was found by running it rather
than by reading it:

| property | why |
|---|---|
| a round nobody watched gets **no** trail — absent, not empty | anything off the history poll was played before the page was open; a timestamp would be manufactured from the moment the tab loaded, and a fabricated latency is indistinguishable from a real one once it is in a file |
| it logs the **sighting**, never the merged round | `mergeHand` keeps the longest card list it has ever seen, which is correct for the ledger; fed the merge, a poll re-sending an older view of a live round yields an entry pairing the newest cards with the older status — a state that never existed at any instant |
| capped at 16 per round, dropped past the most recent 120 rounds | the store is shared with fifteen other tools, and an unbounded list here surfaces as a quota failure in one of them |

The middle one is worth keeping because the wrong version is the one that reads better:
`merged` is in scope, it is what the ledger uses two lines later, and it looks like the
obvious argument. It is pinned by a fence for exactly that reason.

### A third of the trail was the poll waving at itself — added 2026-09-06

An 83-round export off the live table found the defect that 0.8.0's harness run could not.
**Every settled round carried a duplicate trail entry**, roughly 90ms after the real one and
identical in every card and every stake.

The cause is a field nobody had reason to look at. The server reports `current_hand` as the
number of hands **completed** once a round settles — 1 on an ordinary hand, 2 on a split —
while the history poll re-sends that same finished round with 0. `trailSig` included `cur`,
so those are two different signatures, so the "append only on change" rule dutifully
appended. The rule was working. The premise was wrong: `cur` is not a state of play once
the round is over.

The fix is not to drop `cur` from the signature — during play it is the only thing that
says which half of a split is live, and a split that moves from one half to the other with
no card yet dealt is a real transition. The fix is that **a settled round has stopped
unfolding**, so nothing after the first settled sighting is recorded at all. That also
disposes of the general case: the poll re-sends a settled round for as long as it stays in
the history array, which is indefinitely.

Two things worth keeping from how this was found. The bug needed a *live* session — the
harness fires each fixture once, so a duplicate that only appears when the same finished
round arrives twice by two different routes could not show up there. And the export was
what surfaced it, which is the argument for the export: the panel showed nothing wrong,
because a panel does not draw its own storage.

### The export is a file, because it was always going to be

`copy+` writes to the clipboard, and on a real session that is fifteen to fifty kilobytes
of JSON. A clipboard is a poor pipe for that: the content has to be pasted somewhere to
exist at all, and the somewhere is usually a chat box that was not built to hold it.

So LOG has a third button, **save**, which writes the same bundle to a file through the
browser's own download path — a Blob built in the page, exactly as
[`tools/collect-stores.js`](../tools/collect-stores.js) does it. Nothing is transmitted and
no destination is named. `copy` stays for a quick look at a handful of rounds, `copy+` for
pasting a small export, and `save` for a session anyone actually intends to analyse.

One implementation note that is a fence talking rather than taste: the object URL is
released on the *next* save rather than on a timer. A second `setTimeout` is the obvious
way and `tools/test-jack-passive.js` counts the timers in this file, because a tool that
reaches for a schedule twice is one edit from repainting on one, and a repaint on a
schedule is the first half of alerting from a tab nobody is looking at. At most one object
URL is ever outstanding and it dies with the tab regardless.

### `active_hand` was the wrong name twice over — added 2026-09-06

The export called the round's hand pointer `active_hand`, and 0.8.2 renames it to
`current_hand`. Two separate things were wrong with the old name, and only one of them was
the obvious one.

**It collides with a real field that means something else.** The table config already
carries an `active_hand` — the hand in progress, or `null` between rounds — and it is
recorded as such further up this document. Reusing that name for a hand *index* in an
export means a reader who knows the surface is actively misled rather than merely
uninformed.

**And it is not an active hand once the round is over.** The server's `current_hand` is an
index into `hands[]` while you are still playing, and the number of hands **completed**
afterwards: 1 on an ordinary round, 2 on a split. At settle it routinely points one past
the end of the array it looks like it indexes.

The fix is to report the server's own field under the server's own name, uninterpreted, and
to say in the bundle's own `limits` what it means in each of the two states. Renaming it to
something self-describing was the other option and it is worse: every candidate
(`hand_index`, `hands_completed`) is accurate in one state and a lie in the other, and a
field that is silently wrong half the time is harder to catch than one that tells you to
read the note.

This is also the field behind the duplicate-entry bug two sections up — it flipping from 1
to 0 between the settle and the next poll is what made two identical settled sightings look
like two different states. It is worth one paragraph of documentation on that basis alone.

The bundle's `version` goes from 1 to 2 with it. A rename is exactly the change a reader
cannot detect by inspection, because an old file and a new one are both valid JSON with a
plausible field in it; the number is what says which one is in your hand.

### The panel priced every decision and never mentioned the bet — added 2026-09-06

A 109-round session on corporation 30, exported and analysed, made the case better than any
argument could have. Three numbers from it:

| | |
|---|---|
| decisions matching the maximum | **128 of 129** |
| result against expectation | **−0.49 SD** — ordinary weather |
| bankroll, start to trough | **$416,755 → $51,755**, an **88% drawdown** |

Nothing was wrong with the play and nothing was wrong with the luck. What happened was
three bets, at **43%, 48% and 52%** of everything on hand. All three lost: −$600,000 across
three hands out of 109. The panel priced every one of those hands' decisions to three
decimal places and said not one word about the size of the wager riding on them.

Two related findings from the same export, both worth keeping:

**The one misplay cost more than the casino did.** Round 911, a hard 10 against a dealer 8
on a $200,000 bet, **stood** — standing on 10 is never correct, since the hand cannot bust.
Double +0.294 against stand −0.513 is 0.807 units, **$161,365**, against an expected house
take of **$23,701** for the entire session. One press was 6.8x the edge. The trail says it
took **8.7 seconds**, seven times the median decision, so it was deliberation rather than a
misclick — which is the first thing the 0.8.0 timing data has said that the cards could not.

**Busting is not the problem, though it feels like it.** Actual busts 14, expected 14.84
when the true bust chance is summed over each of the 59 hits from the composition: **−0.31
SD**. The feeling tracks a different denominator — you only hit in 50 of 108 rounds, and
28% of those blew up — plus the fact that busts are the loud losses. Of 51 losses only 14
were busts; the other 37 were the dealer quietly beating you, nearly three times as many.

### What the exposure readout refuses to do

`exposure()` prints the bet as a fraction of bankroll, the worst case the rules permit, and
how many more bets that size the cash covers. It will not grow two things, and both
refusals are load-bearing enough to be fenced.

**No risk of ruin, and no probability of anything.** slot-watch already refuses one and the
argument applies harder here: the per-round payouts run from −2 to +4, a natural pays 1.5
and a split with both halves doubled swings four units, so nothing about the distribution is
normal. A percentage hung on it would be least trustworthy in exactly the tail somebody
would consult it for. "Cash covers N more bets this size" is division and assumes nothing at
all.

**No recommended bet.** At a 0.4593% disadvantage the stake that maximises a bankroll is
zero. Every positive number this could print would be advice the arithmetic does not
support, so it reports what is at risk and lets the figure be the argument — the same
reasoning that made the press cost a printed number rather than a colour.

The worst case is the part that is easy to omit and is the whole point. **The opening bet is
not the exposure**: one split is allowed and doubling after it is, so a round can stake four
times what you put up. On round 988 that is a $200,000 opener against a $800,000 ceiling —
**210% of the bankroll**. The multiplier measured across real play is about 1.1, which is
precisely why nobody has the ceiling in mind while sizing a bet.

### A fixed bet is not a fixed risk — added 2026-09-07

The session that emptied the account is the clearest thing in this document, because
nothing in it was played badly. **42 decisions, zero deviations, $0 of EV given up** across
38 rounds. The luck was poor — a 31.6% win rate against roughly 43% expected, 12 wins to 24
losses, **−1.63 SD** — but the mechanism that turned a bad run into a bust was neither.

The bet stayed at **$5,000** while the bankroll fell from $31,755 to $6,755:

| round | bet | bankroll | bet as % | cash covers |
|-------|-----|----------|----------|-------------|
| 1044 | 5,000 | 31,755 | 15.7% | 5 |
| 1048 | 5,000 | 26,755 | 18.7% | 4 |
| 1049 | 5,000 | 21,755 | 23.0% | 3 |
| 1050 | 5,000 | 16,755 | 29.8% | 2 |
| 1051 | 5,000 | 11,755 | 42.5% | 1 |
| 1052 | 5,000 | 6,755 | **74.0%** | **0** |

**No decision to take more risk was ever made.** Exposure went from a sixth of the roll to
three quarters of it by standing still. That is the whole finding: holding a bet constant
while the bankroll shrinks *is* escalation, and it is the kind that never presents itself as
a choice — there is no moment where anyone decides to do it.

The bet was scaled down twice, 5,000 to 1,000 and then 1,000 to 100. Both times **after**
`covers` had already reached zero. The instinct was right and arrived one round late, twice.

Expected loss over those 38 rounds was **$390**. The realized loss was **$31,700** — 81x
expected, and still only 1.63 SD, because the variance dwarfs the edge at every stake.

### The between-rounds reading was wrong half the time

Found by the same export, in code that was one hour old. `exposure()` computed the bankroll
as `cash + bet` unconditionally, on the reasoning that a stake is money already out of your
cash. That is true **only while the hand is live**.

Between rounds the round has settled and cash already reflects it, so adding the bet back
counts it twice. It happened to look right after a **loss** — cash plus the lost stake
really is what you had a moment ago — and was wrong after a **win**, where the winnings are
already in cash and the stake goes on top. A reading correct on half the rounds is worse
than one that is plainly one thing or the other, because nothing about it looks wrong.

0.9.1 takes a `live` flag and asks the question that belongs to each state. Live, it stays
retrospective: what fraction of the bankroll it came from is riding. Between rounds it
becomes the forward-looking one, which is the only version still actionable — **bet that
again and what fraction of what you have is it?** A session ending at $55 with a last bet
of $100 now reads **181.8% of your cash**, and means it: you cannot place that bet. The old
reading called it 64.5% of a bankroll that no longer existed.

`covers` never depended on the flag and was right throughout. It is the number that counted
5, 4, 3, 2, 1, 0 through the bust while the percentage beside it was arguing with itself.

### The answer was always in the wrong place — added 2026-09-07

The recommendation has been correct since 0.1.0 and badly placed for just as long. A panel
lives in a margin, because a panel over the play area is a panel you close (CLAUDE.md). So
reading it costs a look at the cards, a look at the margin, a look back, and then a press —
three fixations per decision, several hundred times a night.

0.10.0 puts the answer **on the control you are about to press**. With the `guide` switch on,
the button to press is outlined in green and the worst press is dimmed and dashed in red.

**Where the line is, because this is the closest this file has come to it.**

Locating the game's buttons is reading the DOM of a page you are actively viewing, which
[`01-rules-envelope.md`](01-rules-envelope.md) scores ✅ on its very first row. Changing how
they look is the same modification `comms-move` already makes to the Comms dock. Neither
adds a request.

**Pressing one would be a script-initiated game action**, and it would not matter that React
builds the request rather than us — that is precisely the hole `test-sleeper-passive.js`
exists to close, in its own words a synthetic click *"slips past every network check in this
file"*. So the tool now knows exactly where every action button is and cannot press one:
no `.click()` on anything it finds, no synthesised mouse, pointer or keyboard event, nothing
driven through focus or `requestSubmit`. The single `.click()` in the file is the export
anchor. The fence counts them and fails the build on a second.

Four smaller decisions, each of which could have gone wrong quietly:

**Matched on words, not classes.** A generated class name is a hash that changes every
deploy. The matcher is an exact set — `HIT`, `STAND`, `STAY`, `DOUBLE`, `DOUBLEDOWN`,
`SPLIT`, and a couple of variants. A prefix match looked tidier and was caught by its own
test claiming *"doubles"*: a miss costs a highlight that does not appear, which the panel
reports as a count you can look at, while a false positive costs a highlight on the wrong
control, which is confidently wrong. Narrow and diagnosable beats loose.

**Re-applied by MutationObserver, never a clock.** React re-renders the button row on every
state change and would wipe the class within milliseconds. An observer is idle until the
page itself changes — the same argument `comms-move` makes for watching the dock — and this
file is allowed exactly one timer, which is the one that puts a button's label back.

**Outline and box-shadow only.** Both paint outside the box and take part in no layout, so a
marked button is the same size and in the same place as an unmarked one. Measured rather
than asserted: same height, same top, to within half a pixel. Anything touching the metrics
would shift the table's controls under the cursor, which is worse than being hard to see.

**Off by default, and it says what it found.** It restyles controls this tool does not own,
which is not something to discover by surprise. And a guide that silently matches nothing is
worse than no guide, because the absence of a highlight would read as meaning something — so
the panel prints how many action buttons it can actually see.

## Counting, and the honest treatment of it

Six decks and a card-by-card record is the setup for a running count, and the count
arithmetic is trivial. The question that decides whether it means anything is **whether the
shoe persists between hands**, and:

**Nothing on this surface says.** There is no shoe, penetration, discard, cut-card or
remaining-cards field anywhere in the bundle — the six decks are a text label in the header
and nothing else. The reshuffle cadence is server-side and unstated.

**Measured 2026-09-04 and answered: it turns over roughly every 21 to 25 rounds, which is
the reshuffle-every-round band and far short of any real penetration.** See the live-play
section above. What follows is the reasoning that got there, and it stands whatever a
different table turns out to do.

It is, however, **measurable**, and one-sidedly so. Cards carry suits, so there are 52
distinct codes and a six-deck shoe holds exactly six of each. **The seventh sighting of any
one code proves a reshuffle happened.** That test can prove a reshuffle; it can never prove
persistence, and it is slow — you see roughly five to eight cards a round, so it takes tens
of rounds to say anything at all.

Three further limits belong next to any count on this surface, and `jack-watch` prints
them:

1. **You only see your own table.** Your cards and the dealer's are all that is ever on the
   wire. If any other player draws from the same shoe, the count is wrong by everything you
   did not see, and the client gives no way to know whether one does.
2. **The hole card is `'hidden'` while you act**, so a card that is in play is not yet in
   your count. A round that ends before the reveal never contributes it at all.
3. **A count is a proxy; the composition is the thing.** `jack-watch` does not convert a
   count into an index deviation. It re-solves the hand against the observed remaining
   composition directly, which is strictly better and needs no index table — the count is
   printed because it is the familiar handle, not because anything is derived from it.

So the tool ships the count, shows the evidence about the shoe beside it, and defaults its
solver to the composition that is correct if the server reshuffles per hand: fresh shoe
minus the cards on the table. Switching to the counted composition is one deliberate click,
and the assumption it takes on is named next to the switch.

### A break is not the measurement — added 2026-09-04

The first version of this section, and of `jack-watch`'s COUNT tab, read a break as
evidence *against* a persistent shoe. **That reading is wrong**, and it is worth writing
down why because it is the obvious mistake to make.

The tool keeps counting across a reshuffle it has no way to see. So a perfectly persistent
six-deck shoe trips the seven-of-a-code test too — the seventh sighting just arrives after
a real shuffle rather than instead of one. **Every shoe policy breaks this test eventually.**
What separates them is how far apart the breaks land, and how *regularly*.

Simulated with `tools/sim-shoe-cadence.js`, which deals real cards out of a real 312-card
shoe and plays them with this tool's own solver — 2,000 sessions of 300 rounds per row, at
**5.56 cards seen per round**:

| what the table is doing | first break (5/50/95) | gap between breaks (5/50/95) | 40 clean rounds |
|---|---|---|---|
| reshuffles every round | 15 / **24** / 32 | 14 / **23** / 30 | 0.0% |
| persistent shoe, cut at 50% | 29 / 33 / 38 | 22 / 29 / 36 | 1.1% |
| persistent shoe, cut at 75% | 42 / 44 / 46 | 40 / **43** / 45 | 99.9% |
| persistent shoe, cut at 90% | 50 / 52 / 54 | 49 / 51 / 53 | 100.0% |

Three things come out of that, and all three changed the tool:

1. **"Tens of rounds" was right but useless as guidance.** The number is about 24. A table
   that reshuffles every round trips the test on coincidence alone by round 32 in 95% of
   sessions, so the question is answerable in half an hour of play rather than in weeks.
2. **The spread is the discriminating half, not the middle.** A coincidence lands raggedly
   — a 16-round band at per-round reshuffling. A real shuffle cycle lands like clockwork —
   a 5-round band at three-quarter penetration. The two medians (23 and 43) are a factor
   of two apart; the two *shapes* are unmistakable.
3. **The one-sided test has a usable other side after all.** Forty rounds with no break is
   still not proof of anything — but it is something per-round reshuffling essentially
   never produces. `jack-watch` now says so in the unproved branch, in exactly those terms.

So the panel measures and prints the **gap in rounds** between breaks, with its range. It
is counted in rounds and not in hand ids on purpose: ids are shared with every other player
at that casino, so an id difference measures the house's traffic rather than your play.

Two assumptions ride under the whole table and neither is checkable from the client: that
the shoe you draw from is yours alone, and that the dealer's hole card turns over even when
you bust. Sharing a shoe means seeing a fraction of the cards drawn from it, which pushes
every break later without changing what the spread says.

## What this means for a tool

Everything `jack-watch` needs arrives on its own, on a page you are looking at, on a
15-second refetch the client already runs. The tool:

- reads the two GET payloads and the two POST **responses**, and **never a request** — it
  reads neither `method` nor the request body off a tap record, so it cannot tell a GET
  from a POST and cannot learn either mutation's payload shape. Same shape gate
  `slot-watch` and `shop-watch` use;
- never names the hands or actions paths. It subscribes to `/api/corporations/` and
  recognises payloads by shape, so the strings needed to deal a hand or send an action are
  not in the file;
- originates nothing, stores everything under its own `pkbj:` prefix, and stamps hands with
  local first-seen times because the wire carries none;
- computes rather than quotes, and keeps what it computed from the stated rules, what it
  measured from your hands, and what it estimated in three separate boxes, everywhere it
  prints.

`tools/test-jack-passive.js` fails the build on any of that regressing;
`tools/test-jack-ev.js` drives the solver against the canonical table, the published edge
for this rule set, and a Monte Carlo.
