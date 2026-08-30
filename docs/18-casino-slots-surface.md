# The slots surface — Capitol Cash

Read **2026-08-30** off `artifacts/bundles/2026-08-26/CasinoSlotsPage-BuB5S5FZ.js` (30,847
bytes), with zero game contact. Everything below is **measured from the shipped client**
unless a line says otherwise. As always in this repo that proves what the *client*
expects, not what the server sends — the distinction matters more here than usual and is
called out where it bites.

Prompted by a request for a tool that tracks the "last session" receipt and graphs how
money moves through it. It became `slot-watch`; the design decisions it forced are in the
last two sections.

## Getting there

Five screens, per [`12-navigation-surface.md`](12-navigation-surface.md):

```
/corporations/{id}/casino/slots
```

The route is a backtick template literal in the router, which is why a naive grep for
`"/casino` finds nothing. `current_city_access` gates it — a casino is a building you
stand in, not a website you visit.

## The page is a canvas

This is the first thing that shapes any tool here, and it is unlike every other screen
this repo has looked at.

`CasinoSlotsPage` mounts a **Phaser game** (`p.Game`, `type: p.AUTO`, 960×920 desktop /
540×980 below 639px) into a `<div aria-hidden="true">`. The reels, the credits panel, the
BET/AUTO/SPIN controls, the RTP and jackpot readouts, the win lines — **all of it is
painted into a `<canvas>` and none of it is in the DOM**. There is no element to read, no
class to hook, no text node to observe.

Two things escape the canvas, and both matter:

1. **An `aria-live` mirror.** One `<p class="sr-only" aria-live="polite">` carries the
   whole receipt as a sentence:

   > `Last Capitol Cash session wagered $X, played N spins, returned $Y gross, withheld $Z
   > tax, and paid $W net.`

   …or `No Capitol Cash session played yet.` It is built for a screen reader and it is the
   only DOM rendering of the numbers that exists.

2. **The settlement receipt, in real HTML.** Below the canvas, a `<section>` headed
   **"Last session" / "Settlement receipt"** with four cells — Wager, Spins, Gross / Tax,
   Net result — plus the session id in a `#`-prefixed chip. This is the thing the request
   named, and it *is* scrapable.

Also DOM: the header stat blocks (Table limit, RTP / Edge, Maximum jackpot, Casino
reserve), the House rules aside, and the paytable `<details>`.

**Neither is what a tool should read.** Both are renderings of `sessions[0]`, and the
payload behind them carries strictly more — see the next two sections. A DOM scrape would
give up the whole per-spin record to re-parse four numbers out of formatted strings.

## The three calls

All three are made by the client itself. The base is `https://politiko.io/api`
(`index-Bietqk7D.js`), so the client's `/corporations/{id}/…` are `/api/corporations/{id}/…`
on the wire.

| Call | Query key | Cadence | Payload |
|---|---|---|---|
| `GET /api/corporations/{id}/casino/slots` | `['casino-slots', id]` | `refetchInterval: 15000` | the table config, below |
| `GET /api/corporations/{id}/casino/slots/history` | `['casino-slots-history', id]` | `refetchInterval: 15000` | `{ sessions: [...] }` |
| `POST /api/corporations/{id}/casino/slots/spins` | — | on SPIN | `{ session }` — the full receipt |

The POST also invalidates `['casino-summary', id]` and calls the app's own balance
refresher, so a spin is followed by a small burst of the client's own traffic.

**The 15-second refetch is the whole reason a passive tool works here.** Both GETs re-fire
on their own while the page is open, so a tap sees fresh state without originating
anything. TanStack's `refetchOnWindowFocus` default also holds (the app sets no
`defaultOptions`), so an alt-tab back re-fires both immediately.

### The config payload

Read off `setView` and the header blocks. Thirteen fields, every one of them read by the
client:

```
slots_min_bet          int    table floor
slots_max_bet          int    table ceiling
wager_increment        int    bets must be a multiple of this
player_cash            int    your cash, as of this poll
free_reserve           int    what the house can pay out of
max_coverable_wager    int    the house's per-wager ceiling — can bite below slots_max_bet
current_city_access    bool   false → "Travel to a city with an active venue"
operational            bool   the casino has a casino-type property
wagering_suspended     bool   unpaid regulatory fine
house_edge_bps         int    basis points, e.g. 400 = 4.00%
theoretical_rtp_bps    int    basis points, e.g. 9600 = 96.00%
reel_config_version    str    printed in the footer; the strips themselves are server-side
rules                  obj    { paytable: {sym: [m3,m4,m5]}, scatter: {n: {multiplier}} }
```

`maximum_jackpot` is **not** a field — the client computes it as
`slots_max_bet × (max(paytable) + max(scatter multiplier))`.

### The session receipt

Six fields are read off `sessions[0]` and rendered:

```
id              int   session identity, and the only ordering key on the wire
total_wager     int   cash staked across the session
spin_count      int   spins, free ones included
gross_payout    int   returned before tax
tax_amount      int   withheld
net_payout      int   gross_payout − tax_amount, credited
```

Two more are read off the POST response's `session` but never off history:

```
player_balance_before  int
player_balance_after   int
spins[]                the per-spin record, below
```

### The per-spin record

Read off `playSession` / `animateSpin` / `animateWins` / `renderResult`:

```
grid                  string[15]  symbol keys, indexed [row * 5 + reel], 3 rows × 5 reels
gross_payout          int         this spin's return
effective_wager       int         0 on a free spin — see below
player_balance_after  int         bankroll after THIS spin
line_wins             [{ line_id, count }]   line_id is 1-based into the 10 paylines
scatter_count         int         ballots on screen
free_spins_awarded    int
spin_type             'free' | (something else for a paid spin)
spin_index            int         printed as "FREE SPIN n"
```

`effective_wager` is the field that keeps the arithmetic honest: a free spin returns
payout against a zero stake, so `spin_count` is not a divisor and
`gross_payout / effective_wager` is only defined on paid spins. `renderResult` guards it
the same way (`e.effective_wager > 0 ? … : 0`).

### The rules, as the client states them

Ten fixed paylines, hardcoded in the bundle as row indices per reel:

```
[0,0,0,0,0]  [1,1,1,1,1]  [2,2,2,2,2]  [0,1,2,1,0]  [2,1,0,1,2]
[0,0,1,2,2]  [2,2,1,0,0]  [1,0,0,0,1]  [1,2,2,2,1]  [0,1,1,1,0]
```

Seventeen symbols, of which `pin` is wild and `ballot` is the scatter. `donor` renders
from `pac_check.webp`; every other key is its own file. The paytable printed in the
`<details>` (3× / 4× / 5×):

| Symbols | Multipliers |
|---|---|
| cherry · lemon · bell · bar · horseshoe | 2 / 5 / 15 |
| seven · briefcase · donor · champagne · classified · barrel | 5 / 15 / 50 |
| missile | 8 / 25 / 100 |
| donation · lindsay · gold_dome | 10 / 40 / 150 |
| **ballot** (scatter, 3/4/5) | **2 / 10 / 50** |

Plus: 8/12/20 retriggerable free spins, a 100-free-spin session cap, and *"no payout fee
or dealer requirement"*.

**The reel strips are not on the wire.** `reel_config_version` is a version string and
nothing else. So theoretical RTP is **not** independently derivable from what the client
holds — which is fine, because the server states it outright in `theoretical_rtp_bps`.
Any tool claiming to have *verified* the advertised RTP from the paytable would be lying;
the most that is available is a comparison of the stated number against realized results.

### Auto-spin is entirely client-side

`autoSpinCount` defaults to 10, choices are **10 / 25 / 50 / 100**, and the loop is a
400ms `delayedCall` between one session completing and the next `slots:spin-request`. Each
auto-spin is a separate POST. It stops on error, on an invalid wager, or on running out.

Worth stating plainly because it is a hazard rather than a feature for us: **the game
already ships the automation.** There is no tedium here for a script to remove, which
settles the question `docs/01-rules-envelope.md` asks of every proposal — a tool that
posted a spin would be adding nothing the operator cannot already get by clicking AUTO,
at the price of the only account. `slot-watch` originates nothing.

## Two things the client fetches and throws away

Both are pure gain for a passive tool, and both are why this surface was worth writing up.

**1. The history array.** `GET …/slots/history` returns `{ sessions: [...] }` and the page
reads exactly `sessions[0]`. Every other element is fetched, parsed, cached by TanStack,
and never rendered. A tap gets the whole back-catalogue on the first poll, for free, with
no request of its own — which is the seed data a graph needs and the reason the tool has
history the moment you open it rather than only from the moment you install it.

How deep it goes is **not measurable from the bundle**. The client passes no page or limit
parameter, so it is whatever the server defaults to. Any tool has to treat the depth as
unknown and observed rather than assumed.

**2. The per-spin record.** The POST response's `spins[]` drives the reel animation and is
then dropped — `currentSpin` keeps only the last one. Nothing renders the sequence. Each
element carries `player_balance_after`, so a session's spins *are* a bankroll curve
already; nobody draws it.

### The catch, stated as a limit rather than an assumption

**History entries are not known to carry `spins[]`.** The client only ever reads `spins`
off the POST response, never off a history element, so the bundle is silent on whether
history is deep or shallow. A tool must handle both: use the per-spin curve when it is
there, fall back to the four session totals when it is not, and never render a per-spin
line it inferred.

**Nothing on this surface carries a timestamp.** No `created_at`, no `played_at`, no game
day — not on the session, not on the spin, not anywhere in the payloads the client reads,
and the same is true of the roulette and craps receipts next door. So a tool cannot say
*when* a session happened; it can only say when it first *saw* it, and order by `id`.
Every clock in `slot-watch` is a local first-seen stamp and is labelled as one.

## Expected value, and the part the advertised number leaves out

The server hands the client both `theoretical_rtp_bps` and `house_edge_bps`, so the
headline is exact and needs no modelling:

```
E[gross] = wager × RTP
expected loss = wager × edge
```

For a planned run of `n` spins at wager `w`, expected loss is `n × w × edge`. That is
arithmetic on numbers the server sent, and it is the one EV claim available that does not
need a single observation.

**But RTP is quoted on gross, and the player is not paid gross.** The House rules aside
says it in as many words: *"tax on aggregate positive session profit"*. The credited
amount is `net_payout = gross_payout − tax_amount`, and a session's actual P&L is
`net_payout − total_wager`.

So the player's effective return is strictly worse than the advertised RTP, by an amount
that is:

- **asymmetric** — tax lands on winning sessions only, and never gives anything back on
  losing ones;
- **structure-dependent** — it is levied on *aggregate session* profit, so the same
  hundred spins taxed as one session and as ten sessions do not pay the same tax. Long
  auto-spin runs net winning spins against losing ones before tax is assessed; short
  sessions cannot. **This is the one lever the player actually controls**, and it is
  invisible on a page that only ever shows you the last receipt.
- **not derivable from the bundle** — the rate and any bracket are server-side. Nothing in
  the client states them.

The honest treatment, and the one `slot-watch` implements: **measure it, don't model it.**

```
tax drag      = Σ tax_amount / Σ total_wager        pure measurement, no assumption
effective edge = advertised edge + tax drag
realized RTP   = Σ gross_payout / Σ total_wager     what actually happened to you
realized net   = Σ (net_payout − total_wager)
```

`tax drag` is a straight division of two observed sums and needs no distributional
assumption at all. `effective edge` is the number the page never shows and the one that
answers "what is this actually costing me."

### Variance, and what cannot be claimed

Expected loss is exact; **spread is not**. Per-paid-spin return `r = gross_payout /
effective_wager` can be sampled from observed spins, and its sample SD scales the
uncertainty on a run as `w × √n × sd(r)`. Two limits have to be printed alongside it or it
is worse than nothing:

1. **It is empirical, from your spins only** — with a handful of samples it means nothing,
   and the sample count belongs on screen next to it.
2. **Slot returns are heavy-tailed.** A 150× line and a 50× scatter live in the same
   distribution as a hundred zeros. A normal-shaped ±1 SD band **understates tail risk in
   both directions**, and the tail is most of the point of a slot machine. So a band may
   be drawn as a band; a probability of ruin may not be quoted from it.

The one exactly-true bankroll statement available is the trivial one, and it is the one
worth putting on screen: **`floor(bankroll / wager)` is how many spins you can place if
you never win again.** No distribution, no sample, no assumption.

## What this means for a tool

Everything `slot-watch` needs arrives on its own, on a page you are looking at, on a
15-second refetch the client already runs. The tool:

- reads the two GET payloads and the POST **response**, and **never the request** — it
  reads neither `method` nor the request body off a tap record, so it cannot tell a GET
  from a POST and cannot learn the spin payload shape. That is a shape gate, the same
  idiom `shop-watch` uses to consume a store listing without consuming a purchase result;
- never names the spins path. It subscribes to `/api/corporations/` and recognises
  payloads by shape, so the string that would be needed to post a spin is not in the file;
- originates nothing, stores everything under its own `pksl:` prefix, and stamps sessions
  with local first-seen times because the wire carries none;
- draws the bankroll curve the client already has the data for and drops.

`tools/test-slot-passive.js` fails the build on any of that regressing —
`tools/test-slot-ev.js` drives the arithmetic above against known inputs.
