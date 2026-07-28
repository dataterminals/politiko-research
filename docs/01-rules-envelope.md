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
| Passively read frames on the WebSocket the client already opened | ✅ (verify) | No new connection, no new request. Confirm we don't *send* anything. |
| Build against a documented/official Politiko API with a token | ✅ | Named as permitted — **but confirm such an API exists** |
| Reformat, re-sort, re-chart, annotate anything above | ✅ | Presentation only |
| Local persistence of what you saw (own history, own price log) | ✅ | Your own observations from pages you viewed |
| Background-poll `/api/...` for cooldowns while you're on another tab | ❌ | Extra requests, unfocused page, alerting |
| Prefetch or crawl routes to build a market/player index | ❌ | Pages you aren't viewing |
| Desktop/tab notifications sourced from a script | ❌ | "Draw attention to itself or another window" — and the game already does this via Web Push |
| Anything that touches the Cloudflare challenge | ❌ | CAPTCHA bypass, named directly |
| Automating game actions (auto-travel, auto-attack, auto-deal) | ❌ | Requests not manually initiated by the user |
| ^ *superseded by operator decision 2026-07-28 for market execution only — see note below* | | |
| Publishing a tool with hidden behavior | ❌ | Named directly |

### Operator decision, 2026-07-28 — market execution

The ❌ verdicts above still describe what Politiko's published clause says; that part of
this document is a record of *their* rules and stays accurate. What changed is *our*
posture, not theirs: script-initiated market orders are now an accepted-risk build. The
clause is unambiguous that this is bannable (items 1 and 5, penalty: game ban), on the
one account that exists. That trade is made knowingly. Nothing else moved — the passive
core is still the default, and no other action automation is planned.

## Three more rules with teeth

- **Bug / exploit abuse** → account deletion. If recon turns up something exploitable,
  the correct move is to **report it** — they run a bug bounty. Do not test it against
  live state, do not sit on it, do not write it up publicly first.
- **Multiple accounts** → one account per person, aggressively enforced. So: no test
  alt, ever. All authenticated research happens on the single real account, which means
  research is conducted at real risk to that account — be conservative.
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
</content>
