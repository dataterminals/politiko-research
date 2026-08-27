# 16 — What our own tools cost the client

**Started 2026-08-27.** Measured against the shipped files in `userscripts/`, not against
the game.

The question that produced this file: Politiko installed as a PWA on a phone runs
noticeably better than the same game on a desktop. The working theory was that the mobile
client is a lighter build.

**It is not.** There is no separate mobile client — same origin, same bundle, same React
tree. The layout component `K` in `index-AUYATDjW.js` mounts the desktop header, the
mobile header *and* the sidebar at every viewport width:

```js
jsx('div', { className: 'hidden md:block shrink-0', children: jsx(Wc, { right: jsx(G, {}) }) }),  // desktop header
jsx('div', { className: 'md:hidden sticky top-0 z-40 shrink-0', children: jsx($c, {}) }),          // mobile header
...
jsx(Hc, {}),   // aside className='hidden md:flex w-56 …'  — the sidebar
```

A single `@media (width>=48rem)` block — 4 334 bytes, the whole `md:` layer — decides
which of them paints. Thirteen chunks additionally branch in JS on a per-chunk copy of
shadcn's `useIsMobile` (`matchMedia('(max-width: 767px)')`, breakpoint 768). **Forcing the
mobile path changes what paints, not what runs.**

So the difference between the two devices is not the game. It is what we put on the
desktop: the phone runs bare Politiko, and the desktop runs Politiko plus fourteen
userscripts, ~650 KB of source, every one of them `@match https://politiko.io/*` at
`@run-at document-start`.

This file measures that.

## Finding 1 — eleven fetch wrappers, nine of them parsing everything (fixed)

Measured 2026-08-27, before the fix:

| | count |
|---|---|
| `window.fetch` wrappers installed | **11** |
| of those, cloning unconditionally | **~9** — `res.clone().json()` on every `/api/` JSON response, *before* checking whether the tool cared |
| `XMLHttpRequest.prototype` patches | **5** |
| of those, parsing synchronously | **5** — `JSON.parse(this.responseText)` on the main thread |

One `/api/user/status` body — which arrives every 10 s on every authenticated route — was
teed and parsed about nine times, and eight of those parses ended in a dispatch that
decided it did not want `/user/status`. The app also builds its QueryClient with **no
`defaultOptions`**, so TanStack v5's `refetchOnWindowFocus: true` holds and every alt-tab
back re-fires every mounted query at once — that multiplier landed on all of it
simultaneously.

Only two tools filtered before touching the body: `time-watch` (`isTimeURL`) and
`xp-watch` (`classify`).

**Fixed by `HTTP TAP v1`** (`userscripts/_template.user.js` §1) — one installer, one
clone, one parse, path-prefix fan-out, with the same first-copy-wins guard `WS TAP v2`
already had. A/B of the two architectures over an hour of modelled traffic (`/user/status`
10 s, `/user/money` 10 s, `/attributes` 10 s, `/effects` 5 s, `/time` 60 s, plus one focus
burst per minute; 36 responses/min):

| | old (11 wrappers) | HTTP TAP v1 | |
|---|---|---|---|
| body clones | 23 760 | 2 160 | **11.0× fewer** |
| JSON parses | 23 760 | 2 160 | **11.0× fewer** |
| delivered to tools | 3 120 | 3 120 | **identical** |
| wall ms | 402.8 | 92.2 | 4.4× faster |

**Read that last row honestly: 400 ms over an hour.** Real, and worth having, but it is not
what makes a game feel sluggish. The 11-deep stack was the most visible problem and it is
gone; it was not the whole gap. The rest of this file is where the remaining cost actually
sits.

### The floor is now `market-watch`

`market-watch` derives a series scope from whatever path a response arrived on and
harvests any numbers in it, so it subscribes `'*'` — legitimately, since narrowing it
would silently stop it charting endpoints it charts today. The consequence is that
**every** response is still parsed once for it. In the modelled traffic, 27 of 36
responses/min reach nobody but that `'*'`; without it those would cost nothing at all,
taking 2 160 parses to roughly 540. Whether that trade is worth making is a
market-watch design question, not a tap question.

## Finding 2 — one tool rebuilds a panel nobody is looking at

**Corrected 2026-08-27, same day.** The first version of this section claimed eight of
thirteen tools repaint while closed. That was a measurement error, and the error is worth
recording because it is an easy one to repeat: the audit grepped for `if (!ui.open)` and
concluded that anything without it was unguarded. **Four tools spell the guard
compoundly** — `if (!body || document.hidden || !ui.open) return;` — and two more use a
different proxy entirely. Grepping for one spelling of a condition is not an audit of the
condition.

The suite is in much better shape than that claim implied:

| tool | closed-panel guard | how | CSS |
|---|---|---|---|
| align-watch | yes | `!body \|\| document.hidden \|\| !ui.open` | 8.6 KB |
| gov-watch | yes | same | 9.5 KB |
| market-watch | yes | `!sk \|\| !ui.open` | 16.5 KB |
| people-watch | yes | `!ui.open` | — |
| poll-watch | yes | same as align | 10.2 KB |
| quick-jump | yes | `!ui.open` | 10.7 KB |
| raid-watch | yes | `!ui.open` | 9.2 KB |
| shop-watch | *effectively* | guard omits `ui.open`, but all three call sites gate | 9.8 KB |
| sleeper-watch | yes | `!ui.open` | 11.5 KB |
| time-watch | yes | `!ui.open` | 8.4 KB |
| world-watch | yes | same as align | 10.4 KB |
| **ws-watch** | **no** | `!body \|\| document.hidden` only | 9.3 KB |
| xp-watch | yes | `!panel \|\| panel.hidden`, and `panel.hidden = !open` | 8.8 KB |

The established house pattern, visible in five of them, is a deliberate split already:
**`sync()` keeps the button, badge and header live while closed; `render()` bails.** That
is the right design and it is mostly already in place.

**126.5 KB of CSS is injected at boot** across the suite — 559 rules — before the game's
own `index-KnpLxiB1.css` (183 KB) is even relevant. That figure stands.

So the remaining waste is one tool, not eight — `ws-watch`:

```js
const boot = () => { mount(); render(); setInterval(render, 1000); … };
```

and its render guards on the wrong thing —

```js
const render = () => {
  if (!body || document.hidden) return;
  body.textContent = '';
  …
```

`document.hidden` is false whenever the tab is fronted, so on a visible tab with the panel
**closed** it clears and rebuilds the entire census body once a second, forever. ws-watch
also describes itself as a temporary instrument that reports its own retirement; if the
socket census is finished, uninstalling it is free and beats fixing it.

Its render clears and rebuilds roughly **120 elements / 220 nodes every second**, and
because `retired()` is `answers().every(...)`, the seven question probes sweep the census
**twice per call** — fourteen sweeps a second. Over an idle hour that is 3 600 full
rebuilds of a panel nobody has opened.

### The shape of the fix — a split, not an early return

A blanket `return` above the body build would be wrong here, and ws-watch is the exact case
that shows why. Lines 983–986 inside `render()` are the **only** place its FAB state is
maintained:

```js
if (fab) {
  fab.classList.toggle('pkws-done', done);
  fab.title = done ? 'ws-watch: nothing left to learn' : 'ws-watch';
}
```

`pkws-done` is the "nothing left to learn — uninstall me" signal, and ws-watch is
explicitly a self-retiring instrument. Guard above that block and a closed ws-watch never
goes green, which defeats the whole reason it exists. So: **update the button always;
build the body only when open** — the same `sync()`/`render()` split the other tools use.

Three traps for whoever does it:

1. **`ui.open` is default-open in ws-watch** — `setOpen(ui.open !== false)`, so the stored
   value can be `undefined`. The test must be `ui.open === false`, not `!ui.open`, or a
   fresh install renders nothing.
2. **Use the compound spelling.** `test-placement.js:610-618` enforces the CLAUDE.md
   ordering rule with a whole-file character-offset comparison — it fails if
   `if (!ui.open) return` appears at a lower offset than the `pk-open` toggle. In ws-watch
   the toggle lives at :1397 inside `setOpen`, far below `render` at :974, so a bare guard
   would fail the test despite being correct. `!body || document.hidden || !ui.open` does
   not match that regex and is the house spelling anyway.
3. `if (drag) drag.fit();` must stay reachable — `tools/test-passive.js:97` asserts that
   literal exists.

Simpler option worth weighing first: ws-watch describes itself as a temporary instrument
that reports its own retirement. **If the socket census is finished, uninstalling it costs
nothing and beats fixing it.**

## Finding 3 — market-watch's panel repaint is broken, and has been

Unrelated to any of the above, found while auditing. `refresh()` calls two functions that
**do not exist anywhere in the file**:

```js
paintHeader();
paintWarn();
paintArmBar();      // ← never defined
paintFabState();
paintObserved();
paintRules();
paintWrites();      // ← never defined
syncFormOptions();
updateQtyPreview();
```

`grep` returns exactly two hits for each — the call sites, no definitions — and both are
present in `HEAD` as well, so this is pre-existing, not a working-tree artifact.

`paintArmBar()` throws inside the `requestAnimationFrame` callback, so **everything after
it never runs**: `paintFabState`, `paintObserved`, `paintRules`, `paintWrites`,
`syncFormOptions`, `updateQtyPreview`. The observed-series list should therefore never
repaint after the skeleton is built. Needs confirming in a browser, but it reads as a hard
break of market-watch's main panel — and it would be invisible to the test suite, which
slices the engine rather than the paint layer.

## Finding 4 — startup cost is not the problem either

The obvious next suspect after the tap was the ~900 KB of source parsed and executed at
`document-start`. **Measured 2026-08-27, and it is not it.**

Benchmarked with `vm.Script` (which honours `--no-lazy`, unlike `new Function`), source
salted per iteration so V8's compilation cache misses — that is what a cold load actually
pays. 20 timed iterations per file after 3 warmups, median. Intel i5-12400, Node v24 / V8 13.6:

| | whole 15-script suite |
|---|---|
| cold parse floor (lazy) | **~17.7 ms** |
| cold full compile (`--no-lazy`, upper bound) | **~32.8 ms** |
| **warm reload (compilation cache hit)** | **~0.79 ms** |

The largest single tool, `market-watch` at 87 KB, is 1.4 ms lazy and 3.5 ms eager.

**~33 ms worst case, once, at `document-start`** — against a game bundle several times
larger paid on the same load. Even extrapolating 4–8× for a mid-range phone (inferred, not
measured) puts the cold worst case at ~130–260 ms. That is a one-time hit, not something
felt during play. Minifying would cut ~38% of bytes (275 KB of the 928 KB is comments,
78 KB is leading indentation) to save maybe 12 ms of a 33 ms one-time cost, which is not
worth losing the comments this repo is written around.

### Corrections to figures used earlier in this file

| stated earlier | measured |
|---|---|
| 13 shipped userscripts | **15** |
| ~650 KB total source | **928 KB** |
| 8 tools repaint while closed | **1** (see Finding 2) |

## Where that leaves it

Three suspects have now been measured and **none of them explains a sluggish-feeling game**:

1. the 11-deep tap — real, fixed, worth ~400 ms per *hour*
2. panel repaints while closed — one tool, `ws-watch`, at 1 Hz
3. startup compile — ~33 ms, once

What has **not** been measured, and is now the most plausible remaining candidate: **559
CSS rules injected into the game's own document**, which the browser must consider on every
style recalculation against a React tree that re-renders constantly. That is invisible to a
Node benchmark and needs a browser profile. Five tools scope their CSS inside a shadow root
(`market-watch`, `people-watch`, `quick-jump`, `raid-watch`, `sleeper-watch`) and pay far
less of this; the other eight inject into `document.head` and pay all of it.

Which is another way of saying the free measurement below still has not been run, and
everything here is a cost that exists rather than a cost that is proven to be *the* cost.

## Method note

The tap numbers are from an A/B harness over modelled traffic, not from a live session —
the delivered-record count is identical between the two architectures, which is what makes
it a fair comparison of cost rather than of behaviour. The CSS and guard figures are static
reads of the shipped files. **None of this has been confirmed against a real profile yet.**

The one measurement that would settle how much of the phone/desktop gap this all accounts
for costs nothing and has not been done: **disable every userscript, hard-reload, and play
for a minute.** Until that is run, everything here is a cost that exists, not a cost that
is proven to be the cost.

Two open questions worth closing at the same time:

- **Do userscripts run in an installed standalone PWA window on desktop?** Open since
  `docs/03-script-ideas.md:177-179` and never checked. If they do not, the installed PWA is
  already a clean fast Politiko and the two-window setup is free.
- **Does the sidebar widget config help?** `/settings/sidebar` hides widgets server-side and
  governs both the desktop sidebar and the mobile header. `CLAUDE.md` says reach for the
  operator's own switch first.
