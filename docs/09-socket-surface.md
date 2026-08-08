# Socket surface

Measured **2026-08-07** by reading the client bundles captured on **2026-08-03**
(`artifacts/bundles/2026-08-03/`, 123 `.js` files, 126 entries). **Zero contact with
politiko.io** — nothing was fetched, no page was loaded, no endpoint was probed, and no
authenticated session was involved. Every claim below is a statement about *the client
code on disk*, which is a narrower thing than a statement about the server.

This closes the "completely uncharacterized" status that
[`00-recon-baseline.md`](00-recon-baseline.md) and
[`01-rules-envelope.md`](01-rules-envelope.md) both carry for `wss://politiko.io`.

**Byte offsets are locators into the 2026-08-03 snapshot only.** Chunk hashes change every
deploy; so does everything in this file. Re-read the client before trusting any of it.

## The correction to carry forward

`00-recon-baseline.md` describes **one** socket of unknown purpose. There are **two**, and
both are fully legible from the bundles:

| | `/ws/chat` | `/ws/market` |
|---|---|---|
| lives in | `index-AUYATDjW.js` (entry) | `StocksPage-Bb4cFQXE.js` (lazy chunk) |
| constructed at | byte 367844 | byte 664 |
| lifetime | **every authenticated route** | **only while on `/stocks`** |
| inbound types | 7 | 2 |
| outbound types | 3 | 3 |
| client keepalive | **none** | `ping` every 30 s |
| close on teardown | `close(1000, "client shutdown")` | `close()` → code 1005 |

Both hardcode the production origin — `` `wss://politiko.io` `` at `index` 352969 and
`StocksPage` 258. Neither derives it from `location.origin`. Nothing reads a socket off
`window`; both instances live in React refs inside closures.

### Lifetime is the load-bearing difference

**Measured.** `function Pl()` (the Comms dock) is defined at `index` 364781 and referenced
exactly once, at 379517, inside the layout component `K`. `K` is the layout element of the
authenticated route subtree, gated on a username being present, the account not being
fedded, and email being verified.

So `/ws/chat` opens on the **first authenticated in-game route** and stays open across
every subsequent navigation. It is *not* open on the landing page, `/login`, `/register`,
or the fedded/verify-email screens — so "opens at app boot" is wrong, and
"route-independent within the authenticated app" is right.

`/ws/market` is page-lived: the route element unmounts on navigation, which runs the
socket teardown. It also **gives up permanently** if no in-memory token exists at mount —
the initial connect is guarded on `o.getState().accessToken` being truthy and nothing
retries, so a momentarily-empty store means no market socket for that visit.

## `/ws/chat` — the protocol

### Inbound: seven cases, no default

All seven are contiguous in `index-AUYATDjW.js`. **Measured**, with the fields the client
reads off each:

| byte | `type` | fields the client reads |
|---|---|---|
| 366176 | `room_joined` | `room_id`, `kind`, `label`, `dm_target`, `dm_target_role`, `dm_target_is_insider` |
| 366689 | `history` | `room_id`, `messages[]` |
| 366839 | `message_ack` | `client_msg_id`, `message` |
| 367011 | `message` | `client_msg_id`, `message` |
| 367239 | `error` | `client_msg_id`, `error`, `scope` |
| 367601 | `presence` | `username`, `online` |
| 367708 | `dnd_updated` | `enabled` |

The switch has **no `default` branch**, and the handler is
`t.onmessage=e=>{try{k(JSON.parse(e.data))}catch{}}` — so an unrecognized type is
discarded in total silence, as is a malformed frame. This matters more than it looks; see
[What the bundles structurally cannot tell us](#what-the-bundles-structurally-cannot-tell-us).

`kind` on `room_joined` is the room vocabulary: `global`, `faction`, `corporation`,
`direct`. The client learns its faction/corp room ids *only* from these frames, and infers
"you have no faction" from the **absence** of a `room_joined` of that kind — the tab
renders disabled when the id is null.

`history` carries no `has_more` that the client reads; it synthesises
`hasMore = messages.length >= 50`, which pins the server page size at 50.

### Outbound: three types, six send sites

**Measured.** Six `.send(` call sites in the entry bundle, constructing eight frames of
three distinct types. For a passive tool this list is the **must-never-emit denylist**, so
it is enumerated exhaustively rather than summarized:

| `.send(` at | path | frame |
|---|---|---|
| 365934 | `chat:open-dm` window listener | `{type:"join", room:"direct", target}` |
| 367948 | `onopen` | `{type:"join", room:"global"}` |
| 368000 | `onopen` | `{type:"join", room:"faction"}` |
| 368053 | `onopen` | `{type:"join", room:"corporation"}` |
| 368166 | `onopen`, per open DM | `{type:"join", room:"direct", target}` |
| 368686 | helper `j`, gated on `OPEN` | `{type:"message", room_id, body, client_msg_id}` (368830)<br>`{type:"join", room:"direct", target}` (369184)<br>`{type:"dnd", enabled}` (369316) |

Note the shape: **five of six sends bypass the gated helper.** Any reasoning that treats
`j` as the single funnel is working from a wrong model.

**There is no client keepalive on this socket** — no `setInterval`, no `ping`. The market
socket has one. So a heartbeat is not a house pattern, and whatever keeps `/ws/chat` alive
is either server-side or the message traffic itself.

### `chat:open-dm` — a dangling inbound control hook

**Measured.** `window.addEventListener("chat:open-dm", …)` at 366054 (removed at 366103).
The handler reads `e.detail.target` and, if the socket is open, **immediately sends a
`join` frame**.

**Nothing in the shipped client ever dispatches it.** `grep` over all 123 chunks returns
exactly those two occurrences, and `new CustomEvent` appears nowhere related.

This is the most tool-relevant single fact in the whole surface, and it **cuts against
casual use.** It looks like a free page-level API — one `dispatchEvent` and the game opens
a DM for you. But the handler's first act is to put a frame on the wire. Under hard rule 1
that is originating traffic, and the fact that the game provides no dispatcher of its own
means a script would be the only caller in existence.

**Verdict: denylist, and treat any future use as an explicit operator decision rather than
a default.** Recorded here because it will look tempting to the next person who reads this
file, and the reason it is off the table should be written down next to it.

### Chat REST, for completeness

Two paths, both `GET`, both inside `Pl`:

```
GET /chat/settings                              → { dnd_non_friends }
GET /chat/rooms/{id}/history?before_id={id}     → { messages, has_more }
```

There is **no POST/PUT/PATCH anywhere under `/chat`** — DND can only be written over the
socket. `/messages/*` is a different system (in-game mail, `MessagesPage`), not chat.

## `/ws/market` — the protocol

**Measured.** Inbound: two cases, `quote` and `candle_update`, no default branch. Quotes
are stored keyed by `instrument_id`; candles by `` `${instrument_id}:${timeframe}` ``. The
reducer stores the **whole message object**, so any field the server adds is retained but
invisible to static analysis.

Properties actually read off a quote anywhere in the bundle: **`price`, `bid`, `ask`** —
`bid`/`ask` only at the selected-instrument detail panel.

Outbound: four `.send(` sites (794, 927, 1634, 1800), three types — `ping` (30 s
interval), `subscribe`, `unsubscribe`. There is no bulk-subscribe form; `onopen` replays
the pending set one frame at a time.

**The page subscribes to at most one instrument at a time** — a single effect keyed on the
selected instrument id. The watchlist itself is HTTP-polled (`/stocks/instruments`, 2 s),
not socketed. So socket volume is bounded by one instrument's tick rate.

Reconnect: `onerror` only calls `close()`, routing every failure through `onclose`, which
backs off 1000 ms doubling to a 30 000 ms cap. **Neither socket's reconnect loop is
unconditional or infinite** — both schedule a retry only from the `onclose` of a socket
that was successfully constructed, so a reconnect that yields no token ends the loop
permanently for that mount.

## Presence — the finding this thread was ranked for

**`/ws/chat` carries presence.** This is the thing
[`05-people-surface.md`](05-people-surface.md) listed as unknown and
[`01-rules-envelope.md`](01-rules-envelope.md) named as the cheap unlock worth wanting.

### Measured

```js
// index-AUYATDjW.js @ 367601
case`presence`:{ let e=t.username, n=t.online;
  _(t=>{ let r=new Set(t); return n?r.add(e):r.delete(e), r }); break }
```

- The frame the client consumes carries exactly **`username` and `online`**.
- The backing store is `[g,_]=(0,M.useState)(new Set)` at **365036** — the `new Set` at
  365047 **takes no argument**. It starts **empty**.
- `_` is called from **exactly one place in the entire component**: that case. There is no
  seeding, no bulk load, and **no reset on disconnect**.
- The Set is **flat** — one global set of usernames, with no per-room partitioning.
- It is consumed at exactly two places, both room-agnostic: `be=g.size` for the Comms
  header badge, and `g.has(dmTarget ?? label)` for the per-DM online dot.
- The header badge renders as `● N`, and **is hidden entirely when the count is zero**
  (`be>0 && …`).

### Three consequences worth stating plainly

**1. It is delta-only on the client.** The client accumulates transitions from connect
time forward. Whether the *server* replays a burst of `presence` frames on join — which
would make it a de-facto roster — is **not determinable from the bundles**.

**2. The obvious free test is weaker than it looks, and asymmetric.** I initially thought
the operator could just watch the badge on a fresh load. That works in one direction only:

- badge appears within seconds showing **N > 1**, before any human activity → **strong
  evidence of a burst seed**.
- badge **absent or creeping up one at a time** → **ambiguous**. It is indistinguishable
  from a genuinely quiet server, because zero hides the badge and an unseeded DM row
  renders the *same grey dot* as a genuinely-offline partner. Both failure modes are
  silent.

So the observation is free and worth making, but it can only confirm seeding, never rule
it out.

**3. The count drifts upward and never self-corrects.** Nothing clears the Set — not a
close, not a reconnect. Anyone who goes offline during a backoff gap is never removed, and
the entry persists for the life of the component mount. **The game's own `● N` badge
over-counts over a long session.** That is a bug in the client, not in our reading of it,
and any tool that reports a population number inherits it unless it tracks connection
epochs itself.

### Inferred, and how strongly

**Presence approximates every player currently holding a `/ws/chat` connection**
(*moderate-to-high*). The support is structural, not a claim about the wire: the client
unions everything into one flat Set with no room dimension, and uses that same Set for DM
partners — who need share neither faction nor corporation. So the feed must cover
arbitrary usernames, not just co-members.

The argument that "the frame has no room field" is **not** available here, and earlier
drafts of this analysis leaned on it wrongly. The client destructuring two properties says
nothing about what else is on the wire. A `room_id` on the frame would immediately
downgrade this to "the union of my rooms".

**Presence is a strictly better liveness signal than `is_online`** (*high*), because it is
an edge rather than a poll — but it carries no timestamp that the client reads, so a tap
yields `(local_receive_time, username, bool)`, not a server-authoritative instant.

### A second liveness channel on the same socket

Inbound `message` frames carry `sender`, which is a username — the renderer navigates to
`/profile/{sender}` with it. Anyone who speaks is provably online, with a `sent_at`. A tap
that records only `presence` throws this away for free.

### Adjacent REST presence oracles, which are sometimes better

Worth knowing before building anything socket-based:

- **`/factions/{id}/public` is polled every 5 s and renders `members[].is_online`** — and
  it is a *public* endpoint. For faction-scoped presence this beats the socket outright.
- `/factions/mine` polls at 15 s with the same field.
- Outside `ProfilePage`, `is_online` appears in four files across six render sites
  (`ContactsPage`, `FactionPage`, `FactionRaidReportPage`, `PublicFactionPage`).
- **`last_online` exists only on the profile payload** — nowhere else in the 123 chunks.
  Backfilling session history stays a per-user profile read.

## What the bundles structurally cannot tell us

This is the section that matters most for deciding what to build, and it is the reason a
passive tap has value that no amount of further bundle reading can substitute for.

**Neither switch has a `default` branch.** Both handlers silently discard anything they
don't recognize. Therefore:

- **The client's case list is what the client *uses*, not what the server *sends*.** An
  entire message type could arrive on every connection and leave zero trace in the bundle.
- **The field list per case is what the client *reads*, not what the frame *carries*.**
  `presence` is destructured for two properties. A timestamp, a room id, a role, a DND
  flag — any of them could be on the wire right now.

Both gaps close the moment a read-only observer logs one raw frame, and **neither closes
by any other means available to us**: server source and API docs we do not have, and
probing is out under hard rule 4.

That is the actual argument for the tap. Not "presence would be nice" — presence is
already half-visible in polled REST. It is that **the socket is the only surface where
what we can see and what exists differ, and a passive read is the only instrument that
measures the difference.**

## The read-only tap — verdict and conditions

> **Built 2026-08-07.** `WS TAP v1` lives in
> [`userscripts/_template.user.js`](../userscripts/_template.user.js) as a shared verbatim
> block alongside `PANEL KIT v1`, and ships in
> [`userscripts/ws-watch.user.js`](../userscripts/ws-watch.user.js) 0.1.0 behind
> [`userscripts/tools/test-passive.js`](../userscripts/tools/test-passive.js).
>
> Verified against a local harness with a real WebSocket server: the tap observed all 14
> server frames, the server logged **exactly the 3 frames the stub app transmitted and
> nothing else**, and the sentinel token — confirmed present on the handshake — appeared
> nowhere in the record stream, the panel, or storage. Subclassing was exercised against
> the genuine platform `WebSocket`, which is the one thing unit tests cannot establish.
>
> Every condition below is enforced by the fence test rather than by discipline.

**Verdict: safe to build, under the conditions below.** This is the strongest ✅ in the
`01-rules-envelope.md` table, not a marginal one: the socket is the app's own, opened by
the app, on a page the operator manually loaded and is actively viewing, and a constructor
subclass adds exactly zero connections and zero bytes to politiko.io.

The condition `01-rules-envelope.md:37` reserved judgement on — *"confirm we don't send
anything"* — is satisfiable **by construction and provable by test**, which is the bar it
was asking for.

### Mechanism: subclass the constructor

**Measured constraint:** the app assigns `.onopen`/`.onmessage`/`.onclose`/`.onerror` as
**properties** and never calls `addEventListener` on a socket. So listener interception
has nothing to intercept.

**Measured constraint:** the app reads `WebSocket.OPEN` at **six** sites (`index` 365909,
368660, 370210; `StocksPage` 777, 1609, 1775). A plain function wrapper loses the static
and **breaks the game instantly**.

`class Tapped extends window.WebSocket` satisfies both: statics resolve through the
prototype chain, `this` is a real socket so the app's sends are native and unmodified, and
registering our own `addEventListener` in the constructor makes us a *peer* of the app's
handler rather than sitting in front of it — we cannot drop a frame and cannot break their
dispatch by throwing.

Both construction sites resolve `WebSocket` from the global at call time (no module-level
alias anywhere in the set), so a `document-start` wrap catches every construction
including reconnects and the lazily-loaded market socket.

### The four things that must never cross the boundary

1. **The socket** — it has `.send`.
2. **The `MessageEvent`** — `event.target` is the socket.
3. **The URL with its query** — see below.
4. **The app's parsed object** — parse a separate copy from the string.

Nothing a consumer plausibly wants requires any of them. Presence, quotes, message bodies
and room ids all live in frame bodies.

### The token is in the URL

**Measured.** Both sockets are `wss://politiko.io/ws/{chat,market}?token=<access token>`.
Any wrapper sees it, twice — as argument 0 and as `this.url`.

The rule is **allowlist, not denylist**: in the constructor, parse and keep only
`origin + pathname`, dropping query and fragment whole. That way a future
credential-bearing parameter is dropped by construction rather than by pattern-match. The
raw string must not survive that block — not on the instance, not in a WeakMap, not in a
log line.

Frame bodies need the same treatment separately: scrub credential-looking keys *before*
anything is frozen, stored, or rendered.

This is a tap-safety constraint, not a claim about the game's security posture. The token
is equally in `localStorage` under `auth`, so "we never touched the URL" is not by itself
a claim that the token is unreachable, and any disclosure should not overclaim.

### Conditions

1. `@grant none`, `@run-at document-start`, `@match https://politiko.io/*`, one auditable
   file, no `@require`. **`@grant none` matters more here than for the fetch tap**: under
   any other grant the wrap lands on the sandbox and the tap silently sees nothing — and
   because a socket can be legitimately quiet for minutes, a broken tap and an idle tap
   look identical for a long time. Ship a liveness counter so a persistent zero is visible.
2. Subclass only. No `Proxy`, no prototype patching, no override of `send` or `close` —
   **not even to count them.** Counting belongs in the harness.
3. Allowlist URL redaction in the constructor; credential-key scrub on bodies before any
   freeze, storage, or render.
4. A static fence in the spirit of `politiko-market-watch/tools/test-passive.js`: slice the
   file after the metadata block and fail the build if it contains `.send(`,
   `new WebSocket`, `fetch(`, `XMLHttpRequest`, `sendBeacon`, `EventSource`, or
   `Notification`, or if `super(` appears more than once. A correct tap contains **zero**
   of those strings, which makes the invariant unusually strong.
5. **Never close, never reopen, never originate a connection** — including when the socket
   looks stuck. Both sockets self-heal; a late wrap self-heals too, because chat reconnects
   on every natural close and market is rebuilt on every entry to `/stocks`.
6. Render coalesced and only while visible. No notifications, no title changes, no sound —
   the clause names attention-raising from unfocused windows directly, and the game already
   owns that channel via Web Push.
7. Disclosure written for a suspicious reader. A userscript that replaces
   `window.WebSocket` looks alarming to someone who does not know it is read-only, and
   clause 6 is the one with teeth. Say plainly: observes frames on the two connections the
   game itself opens, opens none, sends none, adds zero requests, discards the query string
   before anything reads it, and names the fence test.

**The honest risk statement:** this tool is structurally one line away from being a bot.
The design's entire job is to make that line impossible to write without editing the wrap
itself — which is exactly where the fence test is pointed.

### If the wrap loses the race, do nothing

The sockets are in React refs in closures, not on `window`. The only reach is a
`__reactFiber` walk, and the build is React **19.2.6** with **per-load randomized fiber
keys** (`__reactFiber$` + `Math.random().toString(36).slice(2)`), so there is no fixed
property name to walk to. It would also hand back a live socket with `.send` — the exact
object this design refuses to hold. Wait for the next reconnect instead.

## Open questions

Ordered by what they would unlock. The first four are answered by a read-only tap logging
frames during normal play, and by nothing else available to us.

**1–6 are tracked by `ws-watch`.** It reports each in its panel and prints "nothing left
to learn" once the four **blocking** ones (1, 2, 3, 6) are settled. 4 and 5 are marked
*bonus* and do not hold retirement up: 4 needs an `error` frame and 5 needs you to have
sent a chat message, and neither is guaranteed to happen in a given session.
**7–9 are not tracked, and won't be:** 7 needs long observation and judgement, 8 should be
asked rather than tested, and 9 needs a file we never downloaded.

1. **Does the server burst-seed `presence` on connect?** *(blocking)* Decides whether an
   observer gets the online roster or only edges. Count `presence` frames in the first
   ~10 s after `/ws/chat` opens, before any human activity. Needs **several reloads** —
   one quiet connect proves nothing, per the asymmetry noted above.
2. **Does the `presence` frame carry fields the client discards** — `room_id`, timestamp,
   role, DND? *(blocking)* A `room_id` would downgrade the scope answer immediately.
3. **Does either socket emit types the client has no case for?** *(blocking)* Zero hits
   across all 123 chunks for `typing`, `pong`, `room_left`, `kicked`, `system_message`,
   `rate_limit`, `slow_mode` — but the client couldn't show them even if they existed.
4. **What `scope` values can an `error` frame carry?** *(bonus)* Only `join` appears in
   the bundle.
5. **Does presence include your own username?** *(bonus)* The client applies no
   self-filter, so if the server echoes you the header count is off by one. ws-watch
   learns your name from a `message_ack` — the receipt for a message you sent — so this
   one needs you to say something in chat.
6. **Does a market `quote` carry more than `price` / `bid` / `ask`?** *(blocking)* The
   reducer stores the whole message object, so unread fields leave no trace in the
   bundle. Same question for `candle_update`. Needs **one visit to the stocks screen**.
7. **How long does the server hold someone "online" after an ungraceful disconnect?**
   Bounds how far a presence-derived "active now" can be trusted. Answerable only by long
   passive observation.
8. **Is presence suppressed for DND users** — does DND double as invisibility? **Do not
   test this by toggling DND and asking a friend to watch.** That is a two-account
   experiment in spirit. Ask the operator.
9. **Does `/sw.js` open any transport of its own?** It was never downloaded. A page-level
   wrap could not see it regardless. Would need one file added to a future manual
   `fetch-bundles.ps1` run.

## Notes to route privately, not publish

Two observations sit outside this document's purpose and should go to the operator through
`/contact` or the bug bounty rather than into a public repo, per hard rule 5. Neither was
tested and neither is described operationally here:

- The access token travels in the WebSocket handshake **query string**, which means it
  transits the request line. Whether that is retained anywhere is the operator's business.
- There is an apparent **token-rotation race** in the client's auth persistence: two
  writers to the same `localStorage` key that do not know about each other. This is
  *inferred* from minified code, not reproduced, and may well be wrong — it is flagged as
  "worth a look", not reported as a defect.
