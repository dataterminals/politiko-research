# The rules envelope

Source: <https://politiko.io/rules> — sections **Scripting Abuse**, **Bug / Exploit
Abuse**, **Multiple Accounts**, **Account Sharing**. Read at the source; summarized here
in our own words so this repo doesn't carry a copy of their text.

Politiko is unusual in that it addresses user scripting **directly** rather than
banning it wholesale. That's the good news. The clause is also unusually specific, so
there is very little gray area to argue about.

## What the Scripting Abuse clause actually says

Scripts, extensions, and applications are permitted on two conditions — the tool draws
its data either from **Politiko's API**, or from **a page the user manually loaded and is
actively viewing**. In their words, tools must rely on data from the API or from
`"a page that you have manually loaded and are actively viewing"`.

Explicitly prohibited:

1. Additional **non-API requests** to Politiko
2. Scraping **pages not currently being viewed**
3. Any attempt to **bypass CAPTCHA** protections
4. Extracting data from **unfocused pages** in order to send it elsewhere, raise alerts,
   or draw attention to itself or another window
5. Any non-API request **not directly and manually initiated by the user**
6. Releasing software with **malicious or undisclosed functionality**

Penalty: game ban.

## Decoded: build / don't build

| | Verdict | Why |
|---|---|---|
| Read the DOM of the page you're on and overlay computed info | ✅ | Actively-viewed page, zero requests |
| Hook `window.fetch` / `XMLHttpRequest` and read responses the app *already* requested | ✅ | Adds no request at all; strictly a passive tap |
| Read the app's TanStack Query cache in memory | ✅ | Same — data the client already holds |
| Passively read frames on the WebSocket the client already opened | ✅ **(verified 2026-08-07)** | No new connection, no new request. The "confirm we don't *send* anything" condition is satisfiable **by construction and provable by test** — see [`09-socket-surface.md`](09-socket-surface.md). |
| Build against a documented/official Politiko API with a token | ✅ | Named as permitted — **but confirm such an API exists** |
| Reformat, re-sort, re-chart, annotate anything above | ✅ | Presentation only |
| Local persistence of what you saw (own history, own price log) | ✅ | Your own observations from pages you viewed |
| Background-poll `/api/...` for cooldowns while you're on another tab | ❌ | Extra requests, unfocused page, alerting |
| Prefetch or crawl routes to build a market/player index | ❌ | Pages you aren't viewing |
| ^ *departed from 2026-07-28, **retired 2026-08-07** — see note below* | | |
| Desktop/tab notifications sourced from a script | ❌ | "Draw attention to itself or another window" — and the game already does this via Web Push |
| Anything that touches the Cloudflare challenge | ❌ | CAPTCHA bypass, named directly |
| Automating game actions (auto-travel, auto-attack, auto-deal) | ❌ | Requests not manually initiated by the user |
| ^ *superseded in part by operator decision 2026-07-28 — see note below* | | |
| Publishing a tool with hidden behavior | ❌ | Named directly |

### Operator decisions, 2026-07-28 — and what became of them

The ❌ verdicts above still describe what Politiko's published clause says; that part of
this document is a record of *their* rules and stays accurate. What changed is *our*
posture, not theirs.

On 2026-07-28 some tooling was allowed outside the passive default, originating requests
rather than only consuming what the client already holds. The clause is unambiguous that
this is bannable, on the one account that exists. Those trades were made knowingly, with
the cost priced, as exceptions rather than a new default. The rule attached to them was:
*anything that removes the need to originate a request retires the exception, and is
cheaper than the risk being carried.*

**The profile crawl was retired on 2026-08-07 under exactly that rule.** `people-watch`
1.0.0 removes the arming system, the queue, the pacing and every request-originating line
— removed, not disabled. What replaced it costs nothing: a next/previous walk along the
roster, so filling the ledger is one keypress per player and every fetch is a navigation
the operator asked for. It turns out the thing the crawl was buying was not data the
passive surface couldn't reach, only the tedium of reaching it.

**`market-watch`'s order-execution seam went the same day**, under the same rule and to the
same pattern: sizing a trade is arithmetic on data the game already sent, placing one is a
request, and the line belongs between them. A buy/sell rule now produces an alert with the
size worked out and a button to the stocks screen; the operator places the trade. The seam,
its arming switch and the write-capture that fed it are deleted, with a test that fails the
build if any of it returns.

**As of 2026-08-07 there are no outstanding departures.** Every tool in and around this repo
is back inside the passive envelope, and the two exceptions taken in July are both closed —
neither because the risk was reconsidered, but because in both cases the thing being bought
turned out to be tedium-relief that a keypress could supply instead.

The cheaper unlocks named in July are still the ones worth wanting — a server-side control
the UI already uses, or presence broadcast over the already-open WebSocket, which is ✅ in
the table above. ~~`wss://politiko.io` is still uncharacterized and remains the
highest-value thing left unexplored.~~

**Characterized 2026-08-07**, entirely from the bundles on disk with zero game contact.
~~There are two sockets~~ **three** (corrected 2026-08-26), and `/ws/chat` **does**
broadcast presence — so the cheaper unlock named in July exists and is inside the clause.
[`09-socket-surface.md`](09-socket-surface.md) has the protocol, the tap design, and the
conditions on it.

The third, `/ws/casino/poker`, changes nothing about the verdicts in the table above —
reading frames off a connection the client already opened is ✅ whichever connection it is.
It matters here for one reason: **it carries its access token in the WebSocket subprotocol
rather than the URL query string**, so "we redact the URL" stopped being a complete account
of what a tap keeps. That is a disclosure-accuracy problem, and clause 6 is the clause with
teeth. `WS TAP v2` and its fence test are the fix; see
[`09-socket-surface.md`](09-socket-surface.md#the-token-is-in-the-url--on-two-of-three-sockets).

One thing that surface turned up belongs in this file rather than that one. The chat
component registers `window.addEventListener("chat:open-dm", …)`, whose handler's first
act is to **put a `join` frame on the wire** — and nothing in the shipped client ever
dispatches that event. It reads like a free page-level API and it is not one: using it
would make a script the only caller in existence of a path that originates traffic. It is
on the denylist, and any future use is an explicit operator decision, not a default.

## Three more rules with teeth

- **Bug / exploit abuse** → account deletion. If recon turns up something exploitable,
  the correct move is to **report it** — they run a bug bounty. Do not test it against
  live state, do not sit on it, do not write it up publicly first.
- **Multiple accounts** → one account per person, aggressively enforced. So: no test
  alt, ever. All authenticated research happens on the single real account, which means
  research is conducted at real risk to that account — be conservative.

  **And now the mechanism, promoted here 2026-08-26 from
  [`07-alignment-surface.md`](07-alignment-surface.md) where it was buried.** Every call
  the client makes to `/api/*` carries five fingerprint headers — `X-CT-TZ`, `X-CT-Screen`,
  `X-CT-Lang`, `X-CT-Platform` and **`X-CT-Canvas`**, a canvas fingerprint. They are built
  once and cached in `localStorage`. "Aggressively enforced" is therefore not a figure of
  speech about staff vigilance: the client hands the server a device identity on every
  request, and that is what the rule is enforced with.

  Two consequences worth having written down. **A tool must never touch these headers** —
  altering, suppressing or randomizing them is indistinguishable from evading multi-account
  detection, whatever the intent, and it would be an undisclosed function besides. And a
  passive `fetch` tap will *see* them, which is fine, but they belong in the same bucket as
  the token: not stored, not rendered, not logged.

  **The storage key, and the hazard it creates — measured 2026-08-27.** The five signals
  are built by one function and cached whole under **`localStorage['device_signals']`**,
  which is read back on every later call and only recomputed if the key is missing. So the
  fingerprint is frozen at whatever the machine looked like the first time the game ran,
  and the key belongs beside `auth` on the never-touch list: **clearing or rewriting
  `device_signals` forces a recompute under whatever conditions happen to be current.**

  That matters because of what `X-CT-Screen` actually reads:

  ```js
  screen: vi(() => `${window.screen.width}x${window.screen.height}x${window.devicePixelRatio||1}`)
  ```

  `window.screen` and `devicePixelRatio` — the physical monitor, **not** the viewport.
  DevTools device emulation overrides exactly those three values. So the obvious way to
  look at the game's mobile layout on a desktop is the one way that can rewrite the
  fingerprint, and it only takes a cleared key to do it. Nothing about the intent
  distinguishes that from the evasion this clause is enforced against.

  The safe route to the same view is the boring one: narrow the window below 768px, or
  shim `matchMedia` and rewrite the `@media` rules, neither of which `device_signals`
  reads. Recorded here because the hazard is entirely non-obvious from the rules text —
  it looks like a browser feature, not a scripting question.
- **Account sharing** → nobody else operates the account. Relevant here: an agent
  driving the session counts as "having someone initiate processes on your behalf."
  **Claude must not click through game actions.** Read-only inspection of an
  already-open, human-driven page only.

## The design principle this produces

**Consume, don't request.**

The whole permitted surface is *already-arrived data*: the DOM in front of you, the
responses the app fetched for that page, the query cache, the open socket. A tool that
adds exactly zero bytes of network traffic to Politiko cannot violate clauses 1, 2, 4, or
5, and is the safest thing to build. Every idea in
[`03-script-ideas.md`](03-script-ideas.md) is scored against that.

Its natural limit: you can only know what you have looked at. Any feature that wants
world-wide or historical coverage needs either the sanctioned API or patient
manual browsing. That constraint is the interesting part of the design problem.

## Open legal/scope questions

- Does a **sanctioned player API** exist (docs, tokens, rate limits) separate from the
  internal `/api/*` the SPA calls? The clause's wording implies one. If it does, it's the
  single highest-value unlock in this whole project.
- Does the internal `/api/*` count as "our API" for the purposes of the clause? Reading a
  response the client already fetched is safe regardless. Us *originating* a call to
  `/api/*` is the ambiguous case — **do not do it** until answered.
- Is there a public stance on sharing tools with other players? Distribution is separate
  from personal use, and clause 6 governs it.
- Best-effort answer path: ask staff via `/contact` or the Discord before building
  anything that depends on the answer.

### The answer path got better — 2026-08-26

`/contact` was a fire-and-forget form. As of the 2026-08-26 build it is a **support desk
with threaded tickets**: `GET /api/user/contact-submissions` lists yours, `GET
…/{id}` opens one, `POST …/{id}/messages` replies into it, and the UI carries states
"Staff replied", "Needs staff" and "Closed". So a question to staff is now a conversation
with a record, rather than a message into a void that you cannot cite later.

That matters more here than a new screen normally would, because **the sanctioned-API
question above has been the project's oldest open item since 2026-07-28 and it is the one
that branches everything.** The reason it stayed open was partly that there was no good way
to ask it and be sure of getting an answer back. There is now.

Two notes before using it. It is an ordinary authenticated game screen the operator loads
by hand — nothing about the ticket system changes hard rule 1, and no tool should call
these endpoints. And the question is worth drafting carefully rather than firing off: ask
whether a documented player API exists, whether the internal `/api/*` counts as "our API"
for the clause, and what their stance is on distributing tools to other players. Those are
the three unknowns, they are cheap to ask together, and a single answer to all three would
close more of this file than anything else available.

**A cheap corroboration for the "server-side control" preference.** The same build added
`GET`/`PUT /api/jail/legal-offers/auto-accept` — an **auto-accept toggle the game ships
itself**, server-side, for a thing a script would otherwise be tempted to automate. It is a
worked example of the pattern this file has recommended since July and of why reaching for
it first is right: the operator gets the automation, the client originates nothing extra,
and nobody is running a bot. When some future tedium looks automatable, the first question
is whether the game already has, or would add, a switch for it.
