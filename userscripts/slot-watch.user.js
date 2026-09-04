// ==UserScript==
// @name         Politiko — Slot Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.2.0
// @description  Keeps the settlement receipts the Capitol Cash slot machine prints once and forgets, draws your bankroll against what the house edge says it should be, and prices a wager-by-autospin run before you place it. Reads only responses the game already fetched. Passive; zero added requests.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/slot-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/slot-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * `@grant none` is load-bearing, not a leftover default. Under any other grant both
 * Tampermonkey and Violentmonkey hand the script a sandboxed `window`, so the fetch wrap
 * below patches the sandbox's fetch and the page's real traffic never passes through it —
 * the tap silently sees nothing and the panel just sits there saying "no sessions yet".
 *
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON RESPONSE bodies of calls the game client itself made, on pages you are
 *             actively viewing. Never a request body, never a header, never a token.
 *
 *               GET  /api/corporations/{id}/casino/slots
 *                        the table config — bet limits, increment, your cash, the house's
 *                        stated RTP and edge, the reserve, and the reel config version
 *               GET  /api/corporations/{id}/casino/slots/history
 *                        { sessions: [...] } — the whole array. The game renders
 *                        sessions[0] and drops the rest; this keeps them
 *               …and the settlement receipt the game receives when you press SPIN.
 *
 *             That last one is a RESPONSE to a request YOU initiated by clicking, and it
 *             is recognised BY SHAPE rather than by path or method: any payload carrying
 *             all six receipt fields is a session. This file therefore contains no
 *             endpoint for placing a spin, reads neither the method nor the request body
 *             off a tap record, and literally cannot tell a GET from a POST. See
 *             docs/18-casino-slots-surface.md.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. There is one `fetch` wrapper and
 *             it calls the original exactly once, to pass your own traffic through.
 *             Nothing here is polled, scheduled, retried, or fired while you are
 *             elsewhere: everything it knows arrived because the game asked for it while
 *             you were looking at the page. There is exactly one timer in the file and it
 *             changes a button's label back from "copied" — it touches nothing else, and
 *             tools/test-slot-passive.js fails the build if a second one appears or if
 *             that one ever learns to reach the network.
 *
 *   Writes:   nothing to the game. This tool has never sent a POST and does not know how
 *             one would be shaped. The game already ships auto-spin — 10/25/50/100, in
 *             its own UI — so there is no tedium here for a script to remove and no
 *             argument for originating a spin. tools/test-slot-passive.js fails the build
 *             if the shape of one appears.
 *
 *   Storage:  localStorage keys prefixed `pksl:` — the session ledger, the table configs
 *             it was read against, your opening stake, the planner inputs, the mark that
 *             scopes the panel to one sitting, and panel state. Per spin it keeps four
 *             numbers (stake, return, balance after, and whether it was free) and
 *             discards the reel grid and the winning lines.
 *
 *   Alerts:   none. No notifications, no sound, no title or favicon writes, nothing
 *             raised from an unfocused tab. The panel is in-page and that is all.
 *
 *   Clipboard: written ONLY when you click "copy".
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 * Every constant and every field name here was measured off
 * artifacts/bundles/2026-08-26/CasinoSlotsPage-BuB5S5FZ.js — docs/18-casino-slots-surface.md
 * has it line by line.
 *
 * WHAT THIS CAN AND CANNOT TELL YOU
 *
 * Exact, and needing no observation at all: the server states its own `house_edge_bps`,
 * so the expected loss on a planned run is `wager × spins × edge`. Arithmetic, not a
 * model. So is "how many spins can I place if I never win again" — that is
 * `floor(bankroll / wager)` and nothing more.
 *
 * Measured, from your sessions only: realized RTP, and TAX DRAG. The second is the one
 * the page never shows you. RTP is quoted on GROSS, but you are paid NET, and the House
 * rules aside says tax is levied "on aggregate positive session profit" — it lands on
 * winning sessions and gives nothing back on losing ones. So what the machine actually
 * costs you is the advertised edge PLUS the tax drag, and the drag is a straight division
 * of two observed sums: total tax over total staked. No distribution is assumed for it.
 *
 * Estimated, and labelled as such wherever it is printed: the ±1 SD band on a planned
 * run. It is the sample deviation of YOUR observed per-spin returns, the sample count is
 * always on screen beside it, and it is drawn as a band and never as a probability. Slot
 * returns are heavy-tailed — a 150× line lives in the same distribution as a hundred
 * zeros — so a normal-shaped band understates the tail in both directions. That is why
 * this tool will not quote you a risk of ruin: it does not know one.
 *
 * Not available at all: WHEN anything happened. Nothing on this surface carries a
 * timestamp — not the session, not the spin, not anywhere the client reads. Every clock
 * in this panel is the local time this tool FIRST SAW the receipt, and is labelled
 * "seen". Order is by session id, which is the only ordering the wire gives.
 *
 * ONE SITTING, OR ALL OF THEM
 *
 * Every figure above is a sum over the ledger, and a night at the machine is invisible
 * inside a month of them. So LOG carries a "clear", and it starts the panel's figures at
 * your next session — which is the shape of the question you actually have when you sit
 * down: not "how have I done since I installed this", but "how is this run going".
 *
 * It sets a floor at the newest receipt held. It does not delete, and could not: the
 * history poll re-sends the whole array every fifteen seconds, so a clear that removed
 * rows would be silently undone by the next poll while you watched. A floor survives that
 * by construction, is reversible where a delete is not, and costs nothing — the ledger
 * sits intact behind it and "all" lifts it.
 *
 * Whichever is in force is named in the title bar and counted on the LOG tab, because a
 * panel quietly showing a subset of your own money is worse than one showing all of it.
 */

(() => {
  'use strict';

  const TAG = '[pk-slot-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { data: 'pksl:data', ui: 'pksl:ui' };

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // ===========================================================================
  // 1. THE ENGINE — every number this panel prints, and nothing that draws one.
  //
  //    tools/test-slot-ev.js slices this section out between the two markers
  //    below and drives it against known inputs, so it must stay free of the DOM,
  //    of storage, and of anything it cannot be handed as an argument.
  //
  //    The one rule the whole section is built around: a measurement and a model
  //    are different things and are never mixed in one number. Anything derived
  //    only from what the server stated is exact. Anything derived from what was
  //    observed carries its sample size. Nothing here produces a probability.
  // ===========================================================================
  // >>> ENGINE START
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // basis points, the unit the server quotes RTP and edge in: 9600 -> 0.96
  const bpsRate = (v) => (num(v) === null ? null : v / 10000);

  // The six fields the settlement receipt is made of, and the whole of how this
  // tool recognises a session. Matching on shape rather than on a path is what
  // lets it consume the receipt you get for pressing SPIN without this file ever
  // containing the endpoint that would place one.
  const RECEIPT = ['id', 'total_wager', 'spin_count', 'gross_payout', 'tax_amount', 'net_payout'];
  const isReceipt = (o) => !!o && typeof o === 'object' && !Array.isArray(o)
    && RECEIPT.every((k) => num(o[k]) !== null);

  // A session's P&L is what was CREDITED minus what was staked. gross_payout is not
  // it — the tax comes out in between, and that gap is most of the point of this
  // tool. net_payout is the server's own number and is used rather than re-derived.
  const netOf = (s) => s.net_payout - s.total_wager;

  // Four numbers per spin are kept and the rest is dropped: the reel grid is fifteen
  // strings that no arithmetic here needs, and it is most of the payload's weight.
  const slimSpin = (sp) => ({
    w: num(sp.effective_wager) ?? 0,          // 0 on a free spin — see spinReturns
    g: num(sp.gross_payout) ?? 0,
    b: num(sp.player_balance_after),
    f: sp.spin_type === 'free',
  });

  const slimSession = (s) => {
    const out = {};
    for (const k of RECEIPT) out[k] = s[k];
    if (num(s.player_balance_before) !== null) out.player_balance_before = s.player_balance_before;
    if (num(s.player_balance_after) !== null) out.player_balance_after = s.player_balance_after;
    if (Array.isArray(s.spins) && s.spins.length) out.spins = s.spins.map(slimSpin);
    return out;
  };

  // The same session arrives twice by two different routes: once as the receipt for
  // the spin you just placed, which carries spins[] and both balances, and again in
  // the history array, which is not known to carry either (docs/18). A later sighting
  // must therefore never be allowed to delete what an earlier one knew.
  const mergeSession = (old, next) => {
    if (!old) return next;
    const out = { ...old, ...next };
    if (!Array.isArray(next.spins) && Array.isArray(old.spins)) out.spins = old.spins;
    for (const k of ['player_balance_before', 'player_balance_after']) {
      if (num(next[k]) === null && num(old[k]) !== null) out[k] = old[k];
    }
    out.seen = old.seen;              // first seen is first seen; it never moves
    return out;
  };

  // A sitting is a SLICE of the ledger, never a shorter ledger. "Clear the panel" puts a
  // floor under it and every figure the panel prints is computed over what is left; the
  // receipts below the floor are still held, still counted on screen, and still one click
  // from coming back.
  //
  // A floor rather than a delete, for a reason that is about this surface rather than
  // about taste: the game re-fetches the whole history array every fifteen seconds, and
  // ingest is shape-driven and cannot tell a re-sighting from a new receipt. Deleting rows
  // would therefore undo itself on the next poll, in front of you, with no error. Nothing
  // below is defensive about that — it simply never arises.
  const above = (list, floor) => (num(floor) === null ? list : list.filter((s) => s.id > floor));

  const rollup = (list) => {
    let n = 0, spins = 0, wagered = 0, gross = 0, tax = 0, credited = 0, wins = 0, taxed = 0;
    for (const s of list) {
      n++;
      spins += num(s.spin_count) ?? 0;
      wagered += s.total_wager;
      gross += s.gross_payout;
      tax += s.tax_amount;
      credited += s.net_payout;
      if (netOf(s) > 0) wins++;
      if (s.tax_amount > 0) taxed++;
    }
    const net = credited - wagered;
    return {
      n, spins, wagered, gross, tax, credited, net, wins, taxed,
      // Every rate below divides by what was actually staked, so every one of them
      // is a measurement of what happened and none of them is a projection.
      realizedRTP: wagered ? gross / wagered : null,
      taxDrag: wagered ? tax / wagered : null,
      realizedEdge: wagered ? -net / wagered : null,
      winRate: n ? wins / n : null,
      // The client renders gross and tax as separate fields and never checks that
      // they reconcile with net. If they ever stop reconciling, every figure in this
      // panel is built on a wrong assumption and it should say so rather than print.
      reconciles: gross - tax === credited,
    };
  };

  const mean = (xs) => (xs && xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const stdev = (xs) => {
    if (!xs || xs.length < 2) return null;      // one sample has no spread
    const m = mean(xs);
    const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
    return Math.sqrt(v);
  };

  // Per-unit return, from paid spins only. A free spin pays out against a zero stake,
  // so it has no per-unit return at all — folding it in as a zero would drag the
  // sample down, and dividing by it is a division by zero.
  const spinReturns = (sessions) => {
    const out = [];
    for (const s of sessions) {
      if (!Array.isArray(s.spins)) continue;
      for (const sp of s.spins) {
        const w = num(sp.w), g = num(sp.g);
        if (w === null || g === null || w <= 0) continue;
        out.push(g / w);
      }
    }
    return out;
  };

  // The planner. `edge` is the server's own house_edge_bps as a rate, so expLoss is
  // exact. `drag` is measured from your own sessions, so anything using it is marked
  // as such by the caller. `sd` is a sample deviation and is only ever a band.
  const plan = ({ wager, spins, edge, drag, bankroll, sd, sdN }) => {
    const w = num(wager), n = num(spins);
    if (w === null || n === null || w <= 0 || n <= 0) return null;
    const staked = w * n;
    const e = num(edge);
    const d = num(drag) ?? 0;
    const eff = e === null ? null : e + d;
    const bank = num(bankroll);
    const s = num(sd);
    return {
      staked,
      // exact, from the server's own number
      expLoss: e === null ? null : staked * e,
      expReturn: e === null ? null : staked * (1 - e),
      // the same run, once the measured tax drag is added to the stated edge
      effEdge: eff,
      expLossEff: eff === null ? null : staked * eff,
      expAfter: (bank === null || eff === null) ? null : bank - staked * eff,
      // exact, and the only bankroll claim here that assumes nothing whatsoever
      cover: bank === null ? null : Math.floor(bank / w),
      coversRun: bank === null ? null : Math.floor(bank / w) >= n,
      // estimated: 1 SD of the sum of n independent per-spin returns, in cash
      band: s === null ? null : w * Math.sqrt(n) * s,
      bandN: num(sdN) ?? 0,
    };
  };

  // Two ways to draw the same money, and neither is ever inferred from the other.
  //
  // Per SESSION works from the receipt totals, which every session has, so it always
  // draws. Per SPIN needs spins[] and a starting balance, which only the receipt for
  // a spin you placed is known to carry — so it returns null rather than guess, and
  // the panel falls back rather than drawing a line it made up.
  //
  // The expected series is the stake less what the edge says the run costs, so the
  // gap between the two lines is the whole of the luck.
  const curveBySession = (sessions, start, eff) => {
    const s0 = num(start);
    if (s0 === null) return null;
    const pts = [{ i: 0, actual: s0, expected: s0, label: 'start' }];
    let bal = s0, staked = 0;
    sessions.forEach((s, k) => {
      bal += netOf(s);
      staked += s.total_wager;
      pts.push({
        i: k + 1,
        actual: bal,
        expected: eff === null ? null : s0 - staked * eff,
        label: '#' + s.id,
      });
    });
    return pts;
  };

  const curveBySpin = (s, eff) => {
    if (!s || !Array.isArray(s.spins) || !s.spins.length) return null;
    const s0 = num(s.player_balance_before);
    if (s0 === null) return null;
    const pts = [{ i: 0, actual: s0, expected: s0, label: 'start' }];
    let staked = 0;
    for (let k = 0; k < s.spins.length; k++) {
      const sp = s.spins[k];
      const bal = num(sp.b);
      if (bal === null) return null;            // a gap in the curve is not a curve
      staked += num(sp.w) ?? 0;
      pts.push({
        i: k + 1,
        actual: bal,
        expected: eff === null ? null : s0 - staked * eff,
        label: String(k + 1),
      });
    }
    return pts;
  };

  // The drawing surface for a curve: the y range both series have to share, padded so
  // a flat line is not drawn on the frame. Kept here rather than in the renderer
  // because it is arithmetic and the renderer is not.
  const extent = (pts) => {
    const vals = [];
    for (const p of pts) {
      if (num(p.actual) !== null) vals.push(p.actual);
      if (num(p.expected) !== null) vals.push(p.expected);
    }
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) { const pad = Math.max(1, Math.abs(hi) * 0.02); lo -= pad; hi += pad; }
    else { const pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
    return { lo, hi };
  };
  // <<< ENGINE END

  // ===========================================================================
  // 2. HTTP TAP v1 — shared verbatim block, see userscripts/_template.user.js.
  //    This ADDS NO REQUESTS. It only reads what the app already had in flight.
  // ===========================================================================
  const HTTP_TAP_VERSION = 1;

  const onApi = (() => {
    const KEY = '__pkHttpTap';
    const found = window[KEY];
    if (found && typeof found.subscribe === 'function') return found.subscribe;

    // An array, not a Set, for a reason that is about this repo rather than about
    // data structures: the passive fences are deliberately blunt text searches, and
    // several of them ban `.delete(` outright as an HTTP verb. A Set's own remove
    // method reads exactly like one. This block lands in every tool, so it must not
    // spend any tool's fence budget on a false positive.
    const subs = [];

    const tapPathOf = (u) => { try { return new URL(String(u), location.href).pathname; } catch { return ''; } };

    // Which subscribers want this path. An empty result means the body is never
    // read at all — no clone, no parse.
    const wanting = (p) => {
      const out = [];
      for (const s of subs) {
        if (s.prefixes === null || s.prefixes.some((x) => p.startsWith(x))) out.push(s);
      }
      return out;
    };

    // Freeze in place rather than copying: one traversal beats nine parses, and
    // the isFrozen check both stops the recursion and makes a second call cheap.
    const freeze = (v) => {
      if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
      Object.freeze(v);
      for (const k of Object.keys(v)) freeze(v[k]);
      return v;
    };

    const deliver = (want, rec) => {
      const frozen = Object.freeze(rec);
      for (const s of want) { try { s.fn(frozen); } catch (e) { log('subscriber error', e); } }
    };

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const target = args[0];
      const init = args[1];
      const url = typeof target === 'string' ? target : (target?.url ?? '');
      // String bodies only. A Request is never read — draining it would break the
      // app's own send, and it is not ours to consume.
      const body = typeof init?.body === 'string' ? init.body : null;
      const method = String(
        init?.method ?? (target && typeof target === 'object' ? target.method : null) ?? 'GET',
      ).toUpperCase();

      const res = await origFetch.apply(this, args);
      try {
        const path = tapPathOf(url);
        if (path.startsWith('/api/')) {
          const want = wanting(path);
          if (want.length) {
            const rec = { url, path, method, status: res.status, ok: res.ok, body };
            if ((res.headers.get('content-type') || '').includes('json')) {
              // clone so the app's own consumer still gets an unread body
              res.clone().json().then(
                (data) => deliver(want, { ...rec, data: freeze(data) }),
                () => deliver(want, { ...rec, data: null }),
              );
            } else {
              // Not JSON: still a fact worth reporting — a tool that watches for a
              // failed action needs the status even when there is no body to read.
              deliver(want, { ...rec, data: null });
            }
          }
        }
      } catch (e) { log('tap error', e); }
      return res;
    };

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__pkTapUrl = url;
      this.__pkTapMethod = String(method || 'GET').toUpperCase();
      return origOpen.call(this, method, url, ...rest);
    };

    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...a) {
      this.addEventListener('load', () => {
        try {
          const url = this.__pkTapUrl || '';
          const path = tapPathOf(url);
          if (!path.startsWith('/api/')) return;
          const want = wanting(path);
          if (!want.length) return; // the JSON.parse below is the expensive one
          const rec = {
            url, path, method: this.__pkTapMethod || 'GET',
            status: this.status, ok: this.status >= 200 && this.status < 300, body: null,
          };
          if (!(this.getResponseHeader('content-type') || '').includes('json')) {
            deliver(want, { ...rec, data: null });
            return;
          }
          // responseType 'json' hands back an already-parsed object and makes
          // responseText throw; anything text-shaped still needs parsing. That object
          // belongs to the app, which may well mutate it, so it is copied before it is
          // frozen — the freeze is ours to impose on subscribers, not on the game.
          let data;
          try {
            const raw = (this.responseType === '' || this.responseType === 'text')
              ? this.responseText : this.response;
            data = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw));
          } catch { return; }
          if (data === null || typeof data !== 'object') return;
          deliver(want, { ...rec, data: freeze(data) });
        } catch (e) { log('xhr tap error', e); }
      });
      return origSend.apply(this, a);
    };

    const api = Object.freeze({
      version: HTTP_TAP_VERSION,
      subscribe: (prefix, fn) => {
        const prefixes = prefix === '*' ? null : (Array.isArray(prefix) ? prefix.slice() : [prefix]);
        const s = { prefixes, fn };
        subs.push(s);
        return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
      },
    });
    Object.defineProperty(window, KEY, { value: api, configurable: true });
    log('tap installed, HTTP TAP v' + HTTP_TAP_VERSION);
    return api.subscribe;
  })();

  // ===========================================================================
  // 3. PANEL KIT v2 — shared verbatim block, see userscripts/_template.user.js.
  // ===========================================================================
  const draggable = (node, handle, onMove) => {
    const EDGE = 44; // px of the element that must stay reachable on screen
    let sx = 0, sy = 0, ox = 0, oy = 0, live = false, moved = false;
    let skew = null; // gap between the border box and what left/top actually set

    const place = (x, y) => {
      const w = node.offsetWidth, h = node.offsetHeight;
      const p = w && h ? {
        x: Math.min(Math.max(x, EDGE - w), window.innerWidth - EDGE),
        y: Math.min(Math.max(y, 0), window.innerHeight - Math.min(EDGE, h)),
      } : { x, y }; // hidden element: no geometry to clamp against, fix it on show
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
      // `left` positions the MARGIN edge, but every measurement here is the
      // border box. If the host page styles our element with a margin, each grab
      // drifts by that much and compounds. Measure the gap once, then cancel it.
      if (skew === null && w && h) {
        const seen = node.getBoundingClientRect();
        skew = { x: seen.left - p.x, y: seen.top - p.y };
      }
      if (skew && (skew.x || skew.y)) {
        node.style.left = `${p.x - skew.x}px`;
        node.style.top = `${p.y - skew.y}px`;
      }
      return p;
    };

    const down = (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      // a control inside the handle keeps its click; the handle itself still drags
      if (ev.target !== handle && ev.target.closest?.('button,input,select,textarea,a,[data-nodrag]')) return;
      const r = node.getBoundingClientRect();
      place(r.left, r.top); // convert whatever CSS anchoring it had into left/top
      sx = ev.clientX; sy = ev.clientY; ox = r.left; oy = r.top;
      live = true; moved = false;
      try { handle.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
      ev.preventDefault();
    };

    const move = (ev) => {
      if (!live) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return; // tremor isn't a drag
      moved = true;
      place(ox + dx, oy + dy);
    };

    const up = (ev) => {
      if (!live) return;
      live = false;
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
      if (!moved) return;
      const r = node.getBoundingClientRect();
      onMove({ x: r.left, y: r.top });
    };

    handle.style.touchAction = 'none'; // don't scroll the game while dragging
    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);

    // Never strand the panel: a short window, a rotation, or a panel that grew
    // taller than the space its CSS corner left it can all put the drag handle
    // off-screen, and then there is no way to get it back.
    const fit = () => {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const x = Math.min(Math.max(r.left, EDGE - r.width), window.innerWidth - EDGE);
      const y = Math.min(Math.max(r.top, 0), window.innerHeight - Math.min(EDGE, r.height));
      if (Math.abs(x - r.left) < 0.5 && Math.abs(y - r.top) < 0.5) return false;
      onMove(place(x, y));
      return true;
    };
    window.addEventListener('resize', fit);

    return {
      apply: (pos) => {
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
        place(pos.x, pos.y);
        return true;
      },
      reset: () => {
        node.style.left = node.style.top = node.style.right = node.style.bottom = '';
        onMove(null);
      },
      dragged: () => moved,
      fit, // call after mounting and after any render that changes the size

      // Convert whatever CSS corner the element is anchored to into explicit
      // left/top, without moving it. The browser's own resize grabber only grows a
      // box right and down, so a panel still hanging off `right`/`bottom` grows
      // away from the pointer; resizable() pins it the moment the grab starts.
      pin: () => {
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) return false; // hidden: nothing to measure
        place(r.left, r.top);
        return true;
      },
    };
  };

  // ---------------------------------------------------------------------------
  //    resizable(node, onSize, opts) -> { apply(size), reset(), sized() }
  //      node    the element that resizes (the same one draggable() moves)
  //      onSize  called with {w, h} as CSS lengths, or null when reset
  //      opts    { minW, minH, drag } — pass the draggable() for this same node so
  //              a resize can re-pin and re-clamp it
  //
  //    The browser's own grabber does the dragging. There is deliberately no second
  //    drag implementation here to keep in step with the one above: all this block
  //    does is arm the grabber, keep it pointing the right way, and remember the
  //    result. The grabber writes inline width/height, so inline values that differ
  //    from what we last wrote can only have come from the user — content re-renders
  //    never write them, which is what keeps auto-sizing intact until the first
  //    deliberate resize.
  // ---------------------------------------------------------------------------
  const resizable = (node, onSize, opts = {}) => {
    const GRAB = 18;                  // the corner the UA's grabber occupies
    const drag = opts.drag || null;
    let mine = null;                  // the last size WE wrote

    // A viewport this small is a hidden tab or a minimised window rather than a
    // real layout — the same trap the placement layers guard against. Capping
    // against it would shrink the panel to nothing and the next report would make
    // that permanent, so treat it as no information.
    const usable = () => window.innerWidth > 120 && window.innerHeight > 120;

    const floor = () => ({
      w: Math.min(opts.minW || 220, Math.max(80, window.innerWidth - 16)),
      h: Math.min(opts.minH || 140, Math.max(80, window.innerHeight - 16)),
    });

    // Cap growth at the viewport rather than at whatever vh the panel's own CSS
    // picked: a `max-height: 74vh` silently fights a chosen height, so the panel
    // stops growing while the pointer keeps going and then jumps on the way back.
    // Only ever applied once a size has actually been chosen, so an untouched
    // panel keeps its stylesheet's sizing exactly as written.
    const cap = () => {
      if (!usable()) return;
      const f = floor();
      node.style.minWidth = `${f.w}px`;
      node.style.minHeight = `${f.h}px`;
      node.style.maxWidth = `${Math.max(f.w, window.innerWidth - 16)}px`;
      node.style.maxHeight = `${Math.max(f.h, window.innerHeight - 16)}px`;
    };

    node.style.resize = 'both';
    node.style.overflow = 'hidden'; // `resize` is inert while overflow is visible

    const report = () => {
      const w = node.style.width, h = node.style.height;
      if (!w && !h) return;                             // never resized: still auto
      if (mine && mine.w === w && mine.h === h) return; // our own restore, not a gesture
      mine = { w, h };
      onSize(mine);
      if (drag) drag.fit(); // a taller panel can push its own handle off-screen
    };

    // Capture phase: the panel's own handlers must not be able to swallow the grab.
    // Nothing is preventDefault()ed — the UA still runs the resize itself.
    node.addEventListener('pointerdown', (ev) => {
      const r = node.getBoundingClientRect();
      if (ev.clientX < r.right - GRAB || ev.clientY < r.bottom - GRAB) return;
      cap();
      if (drag) drag.pin();
    }, true);

    // Two ways in, because neither alone is sufficient. ResizeObserver is the
    // precise one but it is delivered on the rendering lifecycle, so a page that is
    // not compositing never gets the callback. pointerup is the backstop: the
    // grabber is a pointer gesture, so releasing it always lands here. report() is
    // idempotent, so both firing costs nothing.
    if (typeof ResizeObserver === 'function') new ResizeObserver(report).observe(node);
    node.addEventListener('pointerup', report);
    window.addEventListener('resize', () => { if (mine) cap(); });

    return {
      apply: (size) => {
        if (!size || !size.w || !size.h) return false;
        mine = { w: String(size.w), h: String(size.h) };
        node.style.width = mine.w;
        node.style.height = mine.h;
        cap();
        if (drag) drag.pin(); // a restored size wants the same anchoring a grab does
        return true;
      },
      reset: () => {
        mine = null;
        node.style.width = node.style.height = '';
        node.style.minWidth = node.style.minHeight = '';
        node.style.maxWidth = node.style.maxHeight = '';
        onSize(null);
      },
      sized: () => !!mine,
    };
  };

  // ---------------------------------------------------------------------------
  // 4. Stylesheet.
  //
  //    PANEL_W is what the panel asks for, not what it usually gets. These windows
  //    get parked in the strip between the game's sidebar and its content, so the
  //    typical width is a couple of hundred pixels and everything below has to
  //    survive that: the chart is an SVG that scales, the stat grid reflows to one
  //    column, and the control bar wraps rather than scrolls.
  // ---------------------------------------------------------------------------
  const PANEL_W = 380;

  const CSS = `
    /* FAB KIT v7 — shared verbatim block.
       Same rule as PANEL KIT: copy it in as it stands, and if it has to change,
       bump the version here and in every tool carrying a copy, so the copies can
       be diffed. Several of these tools are on screen at once, and buttons that
       each picked their own shape read as several unrelated add-ons rather than
       one set of tools. A 15px glyph is also a coin toss across fonts and
       platforms, and four of them tell you nothing about which is which. So the
       box is fixed here and only the word inside it belongs to the tool: three
       or four letters, upper case, no emoji.

       v2 adds .pk-open: the button is filled while its own panel is open. A dozen
       of these can sit on one screen and every panel remembers whether it was open,
       so the row of buttons was the one thing that could not tell you which
       windows you already had — you found that out by clicking one and closing it.

       v3 makes that row literal. Until now every tool picked its own corner, and
       eleven tools meant eleven buttons scattered down both edges of the screen in
       an order nobody chose: you hunted for the one you wanted. They now default
       to one row, side by side, in the band above the game's header rule — the
       header is 52px tall (py-3 either side of a 28px nav link) and the button is
       38, so top: 7 centres it there, and on any desktop layout that band is empty
       screen between the nav links and the account menu.

       v4 widened the row to thirteen slots, for poll-watch and shop-watch; v5
       widened it to fourteen for bar-watch, v6 to fifteen for slot-watch, and v7 to
       sixteen for jack-watch. Half the row is written out below because CSS cannot
       count the tools that happen to be installed, which means every slot the row
       gains costs a version bump and a pass over every copy — the price of the row
       being one row rather than each tool's guess at one.

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 16; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       a sixteenth tool does not shuffle the fifteen buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. The eye
       leads because it is the mark of the set; the words are alphabetical after it:

         0  the eye  people-watch     8  TIME  time-watch
         1  ALGN     align-watch      9  WRLD  world-watch
         2  GOV      gov-watch       10  XP    xp-watch
         3  JUMP     quick-jump      11  POLL  poll-watch
         4  MKT      market-watch    12  SHOP  shop-watch
         5  RAID     raid-watch      13  BARS  bar-watch
         6  SLP      sleeper-watch   14  SLOT  slot-watch
         7  SOCK     ws-watch        15  JACK  jack-watch

       POLL, SHOP, BARS, SLOT and JACK are on the end rather than sorted in among
       the others, and that is deliberate: the alphabet describes how the first
       eleven were handed out, not a sort to be re-run. Slots are fixed, so a tool
       that arrives later takes the next free number and nothing already on screen

       Sixteen 38px buttons 8px apart is a 728px row, so it runs 364px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1608px the row is centred,
       and below that it stops sliding left rather than climb onto the nav.

       Three numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 364 (half the row). Nothing else in here is placement.

       (No backticks anywhere in here, incidentally. This block is pasted INSIDE a
       template literal in every tool that carries it, and one backtick in a comment
       ends the literal and takes the rest of the file with it.)

       The FILL is the open channel, and it is the one property the kit keeps for
       itself. A tool's state rule comes after this block at the same specificity
       and therefore wins on border-color and color: an open sleeper-watch
       still reads green, an open market-watch still reads red, and both still read
       as open. Put the open state in either of those two properties instead and a
       tool's state colour erases it without a word. Hover does not outrank it
       either — open is a state; a pointer passing over is not.

       The fill is one palette step, #18181b to #3f3f46, and it does cost a state
       colour some contrast while that panel is open: market-watch's red goes from
       about 4.7:1 to 2.8:1. One step less (#27272a) buys that back, and at 38px it
       stops reading as filled at all — the border ends up doing the work alone.
       Both were rendered against a stack before this one was picked.

       What this block deliberately leaves to the tool, because it IS the tool's:
         - its slot in the row, and its z-index: --pk-slot / z-index
         - state colour and badges layered on top (.hot, .live, .pkws-done)
       The tool's own rule goes AFTER this block: same specificity, later wins.
       An inset is no longer among them — a tool that sets top/left/right/bottom
       has quietly left the row, and tools/test-placement.js fails that build.

       Tools that also do their own placement maths keep CFG.FAB_SIZE in step
       with the 38px below; tools/test-placement.js fails the build if one drifts.
       They also have to compute this row themselves, because an inline left/top
       outranks any rule here. Two do: market-watch and people-watch.

       people-watch is the one exception to the word. It wears the eye of
       providence, which is its mark and predates this block; the svg rule sizes
       that inside the same square as everyone else's letters. */
    .pk-fab {
      box-sizing: border-box; width: 38px; height: 38px; padding: 0;
      /* The home row. --pk-slot is the tool's; the three numbers are the kit's. */
      position: fixed; top: 7px;
      left: calc(max(440px, 50% - 364px) + var(--pk-slot, 0) * 46px);
      display: grid; place-items: center;
      background: #18181b; color: #e4e4e7;
      border: 1px solid #3f3f46; border-radius: 3px;
      font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: .08em; text-align: center;
      cursor: pointer; user-select: none; touch-action: none;
    }
    .pk-fab:hover { border-color: #71717a; color: #fafafa; }
    .pk-fab.dragging { cursor: grabbing; border-color: #52525b; }
    /* Open, and last: neither hover nor a drag may un-fill it. */
    .pk-fab.pk-open { background: #3f3f46; border-color: #a1a1aa; color: #fafafa; }
    .pk-fab svg { width: 24px; height: 24px; display: block; }
    .pksl-fab { --pk-slot: 14; z-index: 2147481900; }
    .pksl-fab.up { border-color: #15803d; color: #4ade80; }
    .pksl-fab.down { border-color: #b91c1c; color: #f87171; }

    .pksl-panel {
      position: fixed; left: 12px; top: 96px; z-index: 2147481900;
      width: ${PANEL_W}px; max-width: calc(100vw - 24px); max-height: 78vh;
      display: none; flex-direction: column;
      box-sizing: border-box; background: #09090b; color: #e4e4e7;
      border: 1px solid #27272a; border-radius: 4px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      box-shadow: 0 10px 34px rgba(0,0,0,.6);
    }
    .pksl-hd {
      display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
      padding: 7px 9px; border-bottom: 1px solid #27272a; background: #111113;
      border-radius: 3px 3px 0 0; cursor: grab; user-select: none;
    }
    .pksl-ttl { font-weight: 700; letter-spacing: .1em; font-size: 10px; color: #a1a1aa; }
    .pksl-sub { font-size: 10px; color: #52525b; margin-left: auto;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pksl-x { background: none; border: 0; color: #52525b; cursor: pointer;
              font: inherit; padding: 0 2px; flex: 0 0 auto; }
    .pksl-x:hover { color: #e4e4e7; }

    .pksl-tabs { display: flex; flex: 0 0 auto; border-bottom: 1px solid #27272a; }
    .pksl-tab { flex: 1 1 0; background: none; border: 0; border-bottom: 2px solid transparent;
                color: #52525b; cursor: pointer; padding: 5px 2px;
                font: 700 9px/1 ui-monospace, monospace; letter-spacing: .12em; }
    .pksl-tab:hover { color: #a1a1aa; }
    .pksl-tab.on { color: #e4e4e7; border-bottom-color: #a1a1aa; }

    .pksl-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 9px; }
    .pksl-empty { color: #52525b; font-size: 11px; padding: 6px 2px; }

    /* auto-fit, so the grid is one column in a margin and three in a wide panel */
    .pksl-stats { display: grid; gap: 6px; margin-bottom: 9px;
                  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); }
    .pksl-stat { border: 1px solid #1f1f23; border-radius: 3px; padding: 5px 7px;
                 background: #0d0d10; min-width: 0; }
    .pksl-k { display: block; font-size: 8px; letter-spacing: .14em; color: #52525b;
              text-transform: uppercase; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
    .pksl-v { display: block; margin-top: 2px; font-size: 13px; color: #d4d4d8;
              overflow-wrap: anywhere; }
    .pksl-v.up { color: #4ade80; } .pksl-v.down { color: #f87171; }
    .pksl-v.est { color: #a1a1aa; }
    .pksl-n { font-size: 9px; color: #52525b; }

    .pksl-chart { border: 1px solid #1f1f23; border-radius: 3px; background: #0d0d10;
                  padding: 6px 7px 5px; margin-bottom: 9px; }
    .pksl-chart svg { display: block; width: 100%; height: auto; }
    .pksl-axis { display: flex; justify-content: space-between; gap: 8px;
                 font-size: 9px; color: #52525b; }
    .pksl-axis span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pksl-legend { display: flex; flex-wrap: wrap; gap: 4px 11px; font-size: 9px;
                   color: #71717a; margin-bottom: 4px; }
    .pksl-swatch { display: inline-block; width: 14px; height: 0;
                   border-top: 2px solid currentColor; vertical-align: middle;
                   margin-right: 4px; }
    .pksl-you { color: #60a5fa; } .pksl-exp { color: #a1a1aa; }

    .pksl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
                margin-bottom: 9px; }
    .pksl-btn { background: #18181b; color: #a1a1aa; border: 1px solid #3f3f46;
                border-radius: 3px; padding: 3px 7px; cursor: pointer;
                font: 10px/1.3 ui-monospace, monospace; }
    .pksl-btn:hover { border-color: #71717a; color: #e4e4e7; }
    .pksl-btn.on { background: #27272a; color: #fafafa; border-color: #71717a; }
    .pksl-btn:disabled { opacity: .4; cursor: default; }
    /* 11ch, not 8: the spinner arrows eat two and a six-figure bankroll is normal, so
       a narrower box silently clips the number it exists to show. */
    .pksl-in { background: #0d0d10; color: #e4e4e7; border: 1px solid #3f3f46;
               border-radius: 3px; padding: 3px 5px; width: 11ch; min-width: 0;
               font: 11px ui-monospace, monospace; }
    .pksl-lbl { font-size: 9px; letter-spacing: .1em; color: #52525b;
                text-transform: uppercase; }

    /* A fixed table layout is the load-bearing half of the table rule in CLAUDE.md, and
       it is here for the reason that file gives: auto layout will not make a column
       narrower than its content at any price, so six columns of currency in a 240px
       margin push the table wider than the panel and you scroll sideways to read column
       one. Fixed layout truncates instead, every cell carries its full value in a title,
       and the widths below sum to 100 so nothing is left to distribute. This table does
       NOT carry people-watch's draggable column dividers — see userscripts/README.md.

       (No backticks in here. This block is inside a template literal, and one backtick
       in a comment ends the literal and takes the rest of the file with it — which is
       exactly what it did on the first draft of this very comment.) */
    .pksl-tbl { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 10.5px; }
    .pksl-tbl th { text-align: right; font-weight: 500; color: #52525b; font-size: 8px;
                   letter-spacing: .1em; text-transform: uppercase; padding: 0 0 4px 6px;
                   border-bottom: 1px solid #27272a; }
    .pksl-tbl th:first-child, .pksl-tbl td:first-child { text-align: left; padding-left: 0; }
    .pksl-tbl td { text-align: right; padding: 3px 0 3px 6px; color: #a1a1aa;
                   border-bottom: 1px solid #141417; }
    .pksl-tbl th, .pksl-tbl td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pksl-tbl col.c-id { width: 17%; } .pksl-tbl col.c-sp { width: 11%; }
    .pksl-tbl col.c-st { width: 19%; } .pksl-tbl col.c-tx { width: 15%; }
    .pksl-tbl col.c-nt { width: 19%; } .pksl-tbl col.c-sn { width: 19%; }
    .pksl-tbl td.up { color: #4ade80; } .pksl-tbl td.down { color: #f87171; }
    .pksl-tbl tr.live td:first-child { color: #60a5fa; }

    .pksl-note { font-size: 9.5px; line-height: 1.5; color: #52525b; margin-top: 8px;
                 border-top: 1px solid #1f1f23; padding-top: 7px; }
    .pksl-warn { font-size: 10px; color: #fbbf24; border: 1px solid #78350f;
                 background: #1c1207; border-radius: 3px; padding: 5px 7px;
                 margin-bottom: 9px; }
    /* Deliberately not the warn colour. A mark is a thing you chose, not a fault — but it
       changes what every number below it means, so it is a standing line rather than a
       footnote, and the bar down its left edge is what makes it read as one at a glance. */
    .pksl-scope { font-size: 9.5px; line-height: 1.5; color: #71717a;
                  border: 1px solid #1f1f23; border-left: 2px solid #3f3f46;
                  background: #0d0d10; border-radius: 3px; padding: 4px 7px;
                  margin-bottom: 9px; }
  `;

  // ---------------------------------------------------------------------------
  // 5. State.
  //
  //    Kept per casino corporation, because the numbers are per TABLE: two casinos
  //    can quote different RTP, different limits and different reserves, and rolling
  //    their receipts into one ledger would produce an average of two machines that
  //    describes neither.
  // ---------------------------------------------------------------------------
  const MAX_SESSIONS = 400;    // receipts kept per table
  const MAX_DEEP = 40;         // of those, how many keep their per-spin record

  const data = readJSON(K.data, null) || { corps: {} };
  if (!data.corps || typeof data.corps !== 'object') data.corps = {};

  const ui = readJSON(K.ui, null) || {};
  if (typeof ui.open !== 'boolean') ui.open = false;
  if (!['MONEY', 'PLAN', 'LOG'].includes(ui.tab)) ui.tab = 'MONEY';
  if (!['SPIN', 'SESSION'].includes(ui.axis)) ui.axis = 'SESSION';
  if (!ui.stake || typeof ui.stake !== 'object') ui.stake = {};
  if (!ui.planner || typeof ui.planner !== 'object') ui.planner = {};
  // corp id -> the session id the panel's figures start above. Per table, like everything
  // else here: you can be mid-run at one machine and looking at the whole history of
  // another, and one shared floor would make each of those a lie about the other.
  if (!ui.mark || typeof ui.mark !== 'object') ui.mark = {};

  const saveData = () => writeJSON(K.data, data);
  const saveUI = () => writeJSON(K.ui, ui);

  let active = null;           // corp id of the table currently in view, as a string

  const corp = (id) => {
    if (!data.corps[id]) data.corps[id] = { cfg: null, sessions: {} };
    const c = data.corps[id];
    if (!c.sessions || typeof c.sessions !== 'object') c.sessions = {};
    return c;
  };

  const known = () => Object.keys(data.corps).sort((a, b) => Number(a) - Number(b));

  // Newest first, which is the order the game's own history arrives in and the order
  // the log reads in. id is the only ordering the wire gives — see docs/18.
  const sessionsOf = (id) => {
    const c = data.corps[id];
    if (!c) return [];
    return Object.values(c.sessions).sort((a, b) => b.id - a.id);
  };

  const prune = (c) => {
    const all = Object.values(c.sessions).sort((a, b) => b.id - a.id);
    if (all.length > MAX_SESSIONS) {
      for (const s of all.slice(MAX_SESSIONS)) delete c.sessions[s.id];
    }
    // The per-spin record is what makes a receipt heavy, and it is only wanted for
    // the recent ones — the curve is drawn from the latest session and the return
    // sample saturates long before the ledger does.
    all.slice(MAX_DEEP).forEach((s) => { if (s.spins) delete s.spins; });
  };

  // ---------------------------------------------------------------------------
  // 6. Ingest.
  //
  //    Everything here is shape-driven. The tap hands over a path and a parsed
  //    body; this reads the corporation id out of the path and then decides what
  //    the payload IS by looking at it. It never reads the method and never reads
  //    the request, which is why it cannot tell a GET from a POST and why the
  //    endpoint that places a spin is not in this file.
  // ---------------------------------------------------------------------------
  const CORP_PATH = /^\/api\/corporations\/(\d+)\//;

  // The config payload, recognised by the two fields nothing else on this surface
  // has: a table has bet limits and a stated RTP.
  const isConfig = (d) => !!d && typeof d === 'object'
    && num(d.slots_min_bet) !== null && num(d.theoretical_rtp_bps) !== null;

  let dirty = false;
  let pending = 0;

  const repaint = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; render(); });
  };

  const takeSession = (c, raw, at) => {
    const slim = slimSession(raw);
    const prev = c.sessions[slim.id];
    slim.seen = prev ? prev.seen : at;
    c.sessions[slim.id] = mergeSession(prev, slim);
    return !prev;
  };

  const consume = ({ path, data: payload }) => {
    const m = CORP_PATH.exec(path || '');
    if (!m || !payload || typeof payload !== 'object') return;
    const id = m[1];
    const at = Date.now();
    let touched = false;

    if (isConfig(payload)) {
      const c = corp(id);
      c.cfg = {
        min: payload.slots_min_bet,
        max: payload.slots_max_bet,
        step: num(payload.wager_increment) ?? 1,
        cash: num(payload.player_cash),
        rtpBps: payload.theoretical_rtp_bps,
        edgeBps: num(payload.house_edge_bps),
        reserve: num(payload.free_reserve),
        coverable: num(payload.max_coverable_wager),
        access: payload.current_city_access === true,
        live: payload.operational === true,
        suspended: payload.wagering_suspended === true,
        version: typeof payload.reel_config_version === 'string' ? payload.reel_config_version : null,
        at,
      };
      active = id;
      touched = true;
    }

    // The history array, which the game fetches whole and renders one element of.
    if (Array.isArray(payload.sessions)) {
      const c = corp(id);
      let added = 0;
      for (const s of payload.sessions) if (isReceipt(s)) { if (takeSession(c, s, at)) added++; }
      if (payload.sessions.length) { active = id; touched = true; }
      if (added) log('history', id, '+' + added);
    }

    // A single receipt, however it arrived. `payload.session` is the shape the game
    // gets back for a spin; a bare receipt is accepted too so this does not depend
    // on the envelope staying the way it is.
    const one = isReceipt(payload.session) ? payload.session : (isReceipt(payload) ? payload : null);
    if (one) {
      const c = corp(id);
      takeSession(c, one, at);
      active = id;
      touched = true;
      log('receipt', id, '#' + one.id, 'net', netOf(one));
    }

    if (!touched) return;
    prune(corp(id));
    dirty = true;
    saveData();
    repaint();
  };

  // ---------------------------------------------------------------------------
  // 7. Formatting.
  // ---------------------------------------------------------------------------
  const money = (v) => (num(v) === null ? '—' : '$' + Math.round(v).toLocaleString());
  const signed = (v) => (num(v) === null ? '—'
    : (v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(v)).toLocaleString());
  const pct = (r, dp) => (num(r) === null ? '—' : (r * 100).toFixed(dp == null ? 2 : dp) + '%');
  // 24-hour, because the column this lands in is the first one a narrow panel truncates
  // and " AM" is three characters that carry nothing the digits do not.
  const clock = (t) => (num(t) === null ? '—'
    : new Date(t).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }));
  const compact = (v) => {
    if (num(v) === null) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    return String(Math.round(v));
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const svgEl = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  };

  // ---------------------------------------------------------------------------
  // 8. The chart.
  //
  //    A fixed viewBox scaled to whatever width the panel has, with
  //    non-scaling-stroke so the lines stay 1px however narrow it gets, and with
  //    every label in HTML outside the SVG so no text is ever scaled down with it.
  //    That is what makes this readable in a 200px margin.
  // ---------------------------------------------------------------------------
  const VB = { w: 320, h: 118, pad: 3 };

  const drawChart = (pts) => {
    const box = el('div', 'pksl-chart');
    const ext = pts && pts.length > 1 ? extent(pts) : null;
    if (!ext) {
      box.append(el('div', 'pksl-empty', 'not enough of a run to draw yet'));
      return box;
    }

    const legend = el('div', 'pksl-legend');
    for (const [cls, word] of [['pksl-you', 'your money'], ['pksl-exp', 'expected']]) {
      const s = el('span', cls);
      s.append(el('i', 'pksl-swatch'), document.createTextNode(word));
      legend.append(s);
    }
    box.append(legend);

    const { w, h, pad } = VB;
    const x = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2);
    const y = (v) => pad + (1 - (v - ext.lo) / (ext.hi - ext.lo)) * (h - pad * 2);

    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', role: 'img' });
    svg.setAttribute('aria-label', 'bankroll against expectation');

    // the opening stake, so "am I up or down on where I started" is one glance
    const start = pts[0].actual;
    if (start >= ext.lo && start <= ext.hi) {
      svg.append(svgEl('line', {
        x1: pad, x2: w - pad, y1: y(start), y2: y(start),
        stroke: '#3f3f46', 'stroke-width': 1, 'stroke-dasharray': '2 3',
        'vector-effect': 'non-scaling-stroke',
      }));
    }

    const path = (key, colour, dash) => {
      const d = [];
      let open = false;
      for (const p of pts) {
        const v = num(p[key]);
        if (v === null) { open = false; continue; }
        d.push(`${open ? 'L' : 'M'}${x(p.i).toFixed(2)} ${y(v).toFixed(2)}`);
        open = true;
      }
      if (d.length < 2) return;
      const n = svgEl('path', {
        d: d.join(' '), fill: 'none', stroke: colour, 'stroke-width': dash ? 1 : 1.5,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
      });
      if (dash) n.setAttribute('stroke-dasharray', '3 3');
      svg.append(n);
    };

    path('expected', '#a1a1aa', true);
    path('actual', '#60a5fa', false);
    box.append(svg);

    const axis = el('div', 'pksl-axis');
    axis.append(
      el('span', null, `${compact(ext.lo)} – ${compact(ext.hi)}`),
      el('span', null, `${pts[0].label} → ${pts[pts.length - 1].label}`),
    );
    box.append(axis);
    return box;
  };

  // ---------------------------------------------------------------------------
  // 9. The panel.
  // ---------------------------------------------------------------------------
  const style = el('style');
  style.textContent = CSS;

  const fab = el('button', 'pk-fab pksl-fab', 'SLOT');
  fab.title = 'Slot Watch — bankroll and EV for Capitol Cash (drag to move, double-click to reset)';

  const panel = el('div', 'pksl-panel');
  const head = el('div', 'pksl-hd');
  const title = el('span', 'pksl-ttl', 'SLOT WATCH');
  const subtitle = el('span', 'pksl-sub', '');
  const close = el('button', 'pksl-x', '×');
  head.append(title, subtitle, close);

  const tabs = el('div', 'pksl-tabs');
  const tabBtn = {};
  for (const name of ['MONEY', 'PLAN', 'LOG']) {
    const b = el('button', 'pksl-tab', name);
    b.addEventListener('click', () => { ui.tab = name; saveUI(); render(); });
    tabBtn[name] = b;
    tabs.append(b);
  }

  const body = el('div', 'pksl-body');
  panel.append(head, tabs, body);

  const drag = draggable(panel, head, (pos) => {
    Object.assign(ui, pos ?? { x: null, y: null });
    saveUI();
  });
  const size = resizable(panel, (s) => { ui.size = s; saveUI(); }, { drag, minW: 250, minH: 190 });
  head.addEventListener('dblclick', () => { drag.reset(); size.reset(); });

  const fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUI(); });
  fabDrag.apply(ui.fab);
  fab.addEventListener('click', () => {
    if (fabDrag.dragged()) return;
    ui.open = !ui.open;
    saveUI();
    render();
  });
  fab.addEventListener('dblclick', () => { ui.fab = null; saveUI(); fabDrag.reset(); });
  close.addEventListener('click', () => { ui.open = false; saveUI(); render(); });

  // ---------------------------------------------------------------------------
  // 10. What the panel is looking at.
  //
  //     The stake is the one number this tool cannot observe: "what did you have
  //     when you started" has no field on the wire. It is seeded from the oldest
  //     evidence available and is editable, because a seed is a guess and the
  //     operator knows.
  // ---------------------------------------------------------------------------
  const view = () => {
    const id = active && data.corps[active] ? active : known()[known().length - 1];
    if (!id) return null;
    const c = data.corps[id];
    const held = sessionsOf(id);          // newest first, everything this table has given up
    // One place applies the mark, and everything downstream — the rollup, the curve, the
    // per-spin sample, the log, the button's colour — is computed from `list` alone. That
    // is the whole of why the scoping cannot half-apply: there is no second list.
    const floor = num(ui.mark[id]);
    const list = above(held, floor);
    const asc = list.slice().reverse();   // oldest first, which is how money moves
    const roll = rollup(list);
    const cfg = c.cfg || {};
    const edge = bpsRate(cfg.edgeBps);
    const rtp = bpsRate(cfg.rtpBps);
    const drag2 = roll.taxDrag;

    // Where the curve starts. Two ways to seed it, and the order matters.
    //
    // The good one is arithmetic on two exact numbers: the table reports your cash on
    // every poll, and the ledger knows what these sessions did to it, so the balance
    // before the oldest one is cash minus that. It anchors the curve so its right-hand
    // end IS your cash rather than something near it.
    //
    // The fallback is for before any config has been seen. A receipt for a spin you
    // placed carries the balance before THAT session — which is not the start of the
    // curve unless it happens to be the oldest one held, so the nets of everything
    // older have to be walked back off it. Taking it as-is puts the end of the run at
    // the start of the chart, which draws a plausible and completely wrong line.
    let seed = null, seedSrc = null;
    if (num(cfg.cash) !== null) { seed = cfg.cash - roll.net; seedSrc = 'from your cash'; }
    if (seed === null) {
      let back = 0;
      for (const s of asc) {
        if (num(s.player_balance_before) !== null) { seed = s.player_balance_before - back; seedSrc = 'walked back'; break; }
        back += netOf(s);
      }
    }
    const manual = num(ui.stake[id]) !== null;
    const stake = manual ? ui.stake[id] : seed;

    const returns = spinReturns(list);
    return {
      id, cfg, list, asc, roll, edge, rtp, stake, seed, manual,
      // What the mark is doing, in the three forms the panel needs to say it: where the
      // floor is, how much is behind it, and the id a fresh mark would be set to.
      floor, held: held.length, hidden: held.length - list.length,
      newest: held.length ? held[0].id : null,
      stakeNote: stake === null ? 'not set' : (manual ? 'yours' : seedSrc),
      effEdge: edge === null ? null : edge + (drag2 ?? 0),
      sd: stdev(returns), sdN: returns.length, avgReturn: mean(returns),
      now: num(cfg.cash) !== null ? cfg.cash : (stake === null ? null : stake + roll.net),
    };
  };

  // ---------------------------------------------------------------------------
  // 11. Tabs.
  // ---------------------------------------------------------------------------
  const stat = (grid, key, value, cls, note) => {
    const box = el('div', 'pksl-stat');
    box.append(el('span', 'pksl-k', key));
    box.append(el('span', 'pksl-v' + (cls ? ' ' + cls : ''), value));
    if (note) box.append(el('span', 'pksl-n', note));
    grid.append(box);
    return box;
  };

  const renderMoney = (v) => {
    if (!v.roll.reconciles && v.roll.n) {
      body.append(el('div', 'pksl-warn',
        'gross − tax does not equal net on these receipts. Every figure below assumes it '
        + 'does, so treat them as unreliable and check docs/18-casino-slots-surface.md.'));
    }

    const bar = el('div', 'pksl-bar');
    bar.append(el('span', 'pksl-lbl', 'stake'));
    const stakeIn = el('input', 'pksl-in');
    stakeIn.type = 'number';
    stakeIn.value = v.stake == null ? '' : String(Math.round(v.stake));
    stakeIn.placeholder = v.seed == null ? 'set' : String(Math.round(v.seed));
    stakeIn.title = 'what you had when you sat down — nothing on the wire says, so this is yours to set';
    const commit = () => {
      const n = Number(stakeIn.value);
      if (stakeIn.value === '' || !Number.isFinite(n)) delete ui.stake[v.id];
      else ui.stake[v.id] = n;
      saveUI(); render();
    };
    stakeIn.addEventListener('change', commit);
    stakeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    bar.append(stakeIn);

    const auto = el('button', 'pksl-btn', 'auto');
    auto.title = 'back to the earliest balance these receipts know about';
    auto.disabled = v.seed == null;
    auto.addEventListener('click', () => { delete ui.stake[v.id]; saveUI(); render(); });
    bar.append(auto);

    for (const mode of ['SESSION', 'SPIN']) {
      const b = el('button', 'pksl-btn' + (ui.axis === mode ? ' on' : ''), mode.toLowerCase());
      b.title = mode === 'SPIN'
        ? 'the latest session that kept its per-spin record'
        : 'one point per session, over the whole ledger';
      b.addEventListener('click', () => { ui.axis = mode; saveUI(); render(); });
      bar.append(b);
    }
    body.append(bar);

    // SPIN is only offered honestly: if no receipt kept its per-spin record the
    // panel says so and draws the session curve rather than inventing one.
    let pts = null, fellBack = false;
    if (ui.axis === 'SPIN') {
      for (const s of v.list) { pts = curveBySpin(s, v.effEdge); if (pts) break; }
      if (!pts) fellBack = true;
    }
    if (!pts) pts = curveBySession(v.asc, v.stake, v.effEdge);

    body.append(drawChart(pts || []));
    if (fellBack) {
      body.append(el('div', 'pksl-empty',
        'no per-spin record held yet — spin once with this panel open. Showing sessions.'));
    }

    const g = el('div', 'pksl-stats');
    const net = v.roll.net;
    stat(g, 'now', money(v.now), null, 'stake ' + v.stakeNote);
    stat(g, 'net', signed(net), net > 0 ? 'up' : net < 0 ? 'down' : null,
      `${v.roll.n} session${v.roll.n === 1 ? '' : 's'}`
      + (v.floor === null ? '' : ` since #${v.floor}`));
    stat(g, 'staked', money(v.roll.wagered), null, `${v.roll.spins} spins`);
    stat(g, 'returned', money(v.roll.credited), null, 'after tax');
    stat(g, 'tax paid', money(v.roll.tax), v.roll.tax > 0 ? 'down' : null,
      `${v.roll.taxed}/${v.roll.n} taxed`);
    stat(g, 'realized rtp', pct(v.roll.realizedRTP), null, 'measured, gross');
    stat(g, 'stated rtp', pct(v.rtp), null, v.cfg.version ? 'cfg ' + v.cfg.version : 'from the table');
    stat(g, 'stated edge', pct(v.edge), null, 'exact');
    stat(g, 'tax drag', pct(v.roll.taxDrag), v.roll.taxDrag > 0 ? 'down' : null, 'measured');
    stat(g, 'effective edge', pct(v.effEdge), 'est', 'stated + drag');
    body.append(g);

    body.append(el('div', 'pksl-note',
      'The dashed line is your stake less what the effective edge says the run costs; the gap '
      + 'between the two lines is luck. Stated RTP is quoted on GROSS, but you are paid NET — '
      + 'tax is levied on aggregate positive session profit, so it lands on winning sessions '
      + 'and returns nothing on losing ones. Tax drag is measured from your own receipts, not '
      + 'modelled. Times in the log are when this tool first SAW a receipt: nothing on this '
      + 'surface carries a timestamp.'));
  };

  const renderPlan = (v) => {
    const cfg = v.cfg;
    const step = num(cfg.step) ?? 1;
    const p = ui.planner;
    if (num(p.wager) === null) p.wager = num(cfg.min) ?? step;
    if (num(p.spins) === null) p.spins = 10;

    const bar = el('div', 'pksl-bar');
    bar.append(el('span', 'pksl-lbl', 'wager'));
    const wIn = el('input', 'pksl-in');
    wIn.type = 'number';
    wIn.value = String(p.wager);
    if (num(cfg.min) !== null) { wIn.min = String(cfg.min); wIn.step = String(step); }
    wIn.addEventListener('change', () => { p.wager = Number(wIn.value) || 0; saveUI(); render(); });
    bar.append(wIn);
    for (const [word, val] of [['min', cfg.min], ['max', num(cfg.coverable) !== null && num(cfg.max) !== null ? Math.min(cfg.max, cfg.coverable) : cfg.max]]) {
      const b = el('button', 'pksl-btn', word);
      b.disabled = num(val) === null;
      b.addEventListener('click', () => {
        p.wager = Math.floor(val / step) * step; saveUI(); render();
      });
      bar.append(b);
    }
    body.append(bar);

    const bar2 = el('div', 'pksl-bar');
    bar2.append(el('span', 'pksl-lbl', 'spins'));
    const sIn = el('input', 'pksl-in');
    sIn.type = 'number';
    sIn.min = '1';
    sIn.value = String(p.spins);
    sIn.addEventListener('change', () => { p.spins = Math.max(1, Number(sIn.value) || 1); saveUI(); render(); });
    bar2.append(sIn);
    // the game's own auto-spin choices, so the planner prices the run you can actually press
    for (const n of [10, 25, 50, 100]) {
      const b = el('button', 'pksl-btn' + (p.spins === n ? ' on' : ''), String(n));
      b.title = 'an auto-spin run of ' + n;
      b.addEventListener('click', () => { p.spins = n; saveUI(); render(); });
      bar2.append(b);
    }
    body.append(bar2);

    const r = plan({
      wager: p.wager, spins: p.spins, edge: v.edge, drag: v.roll.taxDrag,
      bankroll: v.now, sd: v.sd, sdN: v.sdN,
    });

    if (!r) {
      body.append(el('div', 'pksl-empty', 'set a wager and a spin count.'));
      return;
    }

    const g = el('div', 'pksl-stats');
    stat(g, 'staked', money(r.staked), null, `${p.spins} × ${money(p.wager)}`);
    stat(g, 'expected loss', signed(r.expLoss === null ? null : -r.expLoss),
      r.expLoss ? 'down' : null, 'exact, stated edge');
    // With no receipts there is no drag to add, and the line would otherwise read as
    // "after tax: nothing" — which is a claim about the tax rather than about the
    // sample. Say which it is.
    const drag = v.roll.taxDrag;
    stat(g, '…after tax drag', signed(r.expLossEff === null ? null : -r.expLossEff),
      r.expLossEff ? 'down' : null,
      drag === null ? 'no tax seen yet' : `est · ${pct(r.effEdge)}`);
    stat(g, 'bankroll after', money(r.expAfter), 'est', 'expected');
    stat(g, 'covers', r.cover === null ? '—' : r.cover + ' spins',
      r.coversRun === false ? 'down' : null, 'if you never win');
    stat(g, '± 1 sd', r.band === null ? '—' : '±' + money(r.band), 'est',
      r.bandN < 30 ? `only ${r.bandN} spins sampled` : `${r.bandN} spins sampled`);
    body.append(g);

    if (r.coversRun === false) {
      body.append(el('div', 'pksl-warn',
        `A dry run of ${p.spins} spins at ${money(p.wager)} costs ${money(r.staked)} and you `
        + `have ${money(v.now)} — the run can end early. That is arithmetic, not a forecast.`));
    }

    const notes = [
      'Expected loss is exact: the table states its own house edge and this multiplies it by '
      + 'what you would stake. Nothing about it is estimated.',
      'The tax line adds YOUR measured tax drag to that stated edge. Tax is charged on '
      + 'aggregate positive session profit, so a single long auto-spin run nets winning spins '
      + 'against losing ones before it is assessed and a string of short sessions does not. '
      + 'That is the one part of this you control.',
      'The band is one sample deviation of your own per-spin returns, scaled by √spins. It is '
      + 'not a probability and this panel will not quote you one: slot returns are heavy-tailed, '
      + 'so a normal-shaped band understates the tail in both directions.',
      '"Covers" is the only bankroll figure here that assumes nothing at all — it is your cash '
      + 'divided by the wager.',
    ];
    if (v.sdN < 30) {
      notes.push(`The band is drawn from ${v.sdN} paid spin${v.sdN === 1 ? '' : 's'}. That is far `
        + 'too few to mean anything; it is shown so it can be watched, not used.');
    }
    body.append(el('div', 'pksl-note', notes.join(' ')));
  };

  const renderLog = (v) => {
    // Nothing held at all is a different state from everything held behind a mark, and it
    // gets a different screen: the second one still needs its way back.
    if (!v.held) {
      body.append(el('div', 'pksl-empty',
        'no receipts yet. Open a Capitol Cash table — the history the game fetches on arrival '
        + 'lands here on its own, without this tool asking for anything.'));
      return;
    }

    const bar = el('div', 'pksl-bar');
    const copy = el('button', 'pksl-btn', 'copy');
    copy.title = v.floor === null
      ? 'the ledger as TSV, to the clipboard'
      : 'this run as TSV, to the clipboard — the rows behind the mark are not included';
    copy.addEventListener('click', () => {
      const rows = [['id', 'spins', 'wager', 'gross', 'tax', 'net', 'seen'].join('\t')];
      for (const s of v.list) {
        rows.push([s.id, s.spin_count, s.total_wager, s.gross_payout, s.tax_amount,
          netOf(s), new Date(s.seen).toISOString()].join('\t'));
      }
      navigator.clipboard?.writeText(rows.join('\n')).then(
        () => { copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy'; }, 1200); },
        () => { copy.textContent = 'failed'; },
      );
    });
    bar.append(copy);

    // Starting a new sitting. Two clicks, because it changes every number in the panel —
    // and armed in the button rather than on a timer: this file is allowed exactly one
    // timer (tools/test-slot-passive.js) and it belongs to "copied". The arm therefore
    // lives in the DOM node and dies with it, which any repaint does — including the one
    // the table's own fifteen-second poll causes. That is a short window to confirm in,
    // and it is the right way round: an armed destructive-looking button that survives you
    // walking away is worse than one you press twice.
    const clear = el('button', 'pksl-btn', 'clear');
    clear.title = 'start the figures at your next session — for when you sit down to a new run.'
      + ' Nothing is deleted: the receipts stay held behind a mark and "all" brings them back.'
      + ' Your stake goes back to being read off your cash.';
    clear.addEventListener('click', () => {
      if (clear.dataset.on !== '1') {
        clear.dataset.on = '1';
        clear.classList.add('on');
        clear.textContent = 'clear?';
        return;
      }
      ui.mark[v.id] = v.newest;
      // The stake is "what you had when you sat down", so a new sitting invalidates the
      // old answer. Dropping the override re-seeds it from your cash, which after a clear
      // is exactly the number wanted — and it stays editable, as it was before.
      delete ui.stake[v.id];
      saveUI();
      render();
    });
    bar.append(clear);

    if (v.floor !== null) {
      const all = el('button', 'pksl-btn', 'all');
      all.title = `back to every receipt held at this table — ${v.hidden} behind the mark at #${v.floor}`;
      all.addEventListener('click', () => { delete ui.mark[v.id]; saveUI(); render(); });
      bar.append(all);
    }

    bar.append(el('span', 'pksl-lbl', v.floor === null
      ? `${v.held} held · ${MAX_SESSIONS} max`
      : `${v.list.length} of ${v.held} · ${v.hidden} behind #${v.floor}`));
    body.append(bar);

    if (!v.list.length) {
      body.append(el('div', 'pksl-empty',
        `cleared at #${v.floor}. The ${v.hidden} receipt${v.hidden === 1 ? '' : 's'} held here `
        + 'before that are still held — "all" brings them back — and the next session you play '
        + 'lands in an empty ledger.'));
      return;
    }

    const t = el('table', 'pksl-tbl');
    const cg = el('colgroup');
    for (const c of ['c-id', 'c-sp', 'c-st', 'c-tx', 'c-nt', 'c-sn']) cg.append(el('col', c));
    t.append(cg);
    const hr = el('tr');
    for (const h of ['session', 'spins', 'staked', 'tax', 'net', 'seen']) hr.append(el('th', null, h));
    const thead = el('thead');
    thead.append(hr);
    t.append(thead);
    const tb = el('tbody');
    for (const s of v.list) {
      const tr = el('tr');
      if (s.spins) tr.className = 'live';
      const n = netOf(s);
      const cells = [
        [null, '#' + s.id],
        [null, String(s.spin_count)],
        [null, money(s.total_wager)],
        [null, s.tax_amount ? money(s.tax_amount) : '—'],
        [n > 0 ? 'up' : n < 0 ? 'down' : null, signed(n)],
        [null, clock(s.seen)],
      ];
      for (const [cls, text] of cells) {
        const td = el('td', cls, text);
        // Fixed layout truncates, so the full value has to stay reachable on hover.
        td.title = text;
        tr.append(td);
      }
      tb.append(tr);
    }
    t.append(tb);
    body.append(t);
    body.append(el('div', 'pksl-note',
      'A blue session id means its per-spin record is still held — those are the ones the SPIN '
      + `chart can draw, and only the newest ${MAX_DEEP} keep it. "Seen" is when this tool first `
      + 'read the receipt, not when it was played: nothing on this surface carries a timestamp.'));
  };

  // ---------------------------------------------------------------------------
  // 12. Render.
  // ---------------------------------------------------------------------------
  function render() {
    // The one place the panel's display is written, so the button's own state is
    // set here too and above the early return — a closed panel must not leave a
    // lit button behind it.
    panel.style.display = ui.open ? 'flex' : 'none';
    fab.classList.toggle('pk-open', ui.open);

    const v = view();
    const n = v ? v.roll.net : 0;
    fab.classList.toggle('up', !!v && v.roll.n > 0 && n > 0);
    fab.classList.toggle('down', !!v && v.roll.n > 0 && n < 0);
    fab.title = v && v.roll.n
      ? `Slot Watch — ${signed(n)} over ${v.roll.n} session${v.roll.n === 1 ? '' : 's'}`
        + (v.floor === null ? '' : ` since #${v.floor}`)
      : 'Slot Watch — bankroll and EV for Capitol Cash';

    if (!ui.open) return;

    for (const name in tabBtn) tabBtn[name].classList.toggle('on', ui.tab === name);
    body.replaceChildren();

    if (!v) {
      subtitle.textContent = '';
      body.append(el('div', 'pksl-empty',
        'nothing seen yet. Walk into a casino and open Capitol Cash — the table config and the '
        + 'session history the game fetches on arrival land here by themselves. This tool asks '
        + 'politiko.io for nothing.'));
      drag.fit();
      return;
    }

    const tables = known();
    const where = tables.length > 1 ? `table ${v.id} of ${tables.length}` : `table ${v.id}`;
    // The title bar is the one line on screen from every tab, so it is where the scope
    // goes. A panel showing a subset of your own money has to say so somewhere you cannot
    // scroll past.
    subtitle.textContent = v.floor === null ? where : `${where} · from #${v.floor}`;

    if (v.cfg.suspended) {
      body.append(el('div', 'pksl-warn', 'This casino has an unpaid regulatory fine — wagering is suspended.'));
    } else if (v.cfg.live === false) {
      body.append(el('div', 'pksl-warn', 'This casino has no casino-type property; the table is not operational.'));
    } else if (v.cfg.access === false) {
      body.append(el('div', 'pksl-warn', 'You are not in a city with one of this casino\'s venues.'));
    }

    // Said once, above whichever tab is up, rather than three times inside them: PLAN's
    // drag and its band are measured off the same slice as MONEY's headline, so a mark
    // scopes that tab too and it would be the easiest one to read as lifetime.
    if (v.floor !== null) {
      body.append(el('div', 'pksl-scope',
        `Showing this run only — ${v.roll.n} session${v.roll.n === 1 ? '' : 's'} after `
        + `#${v.floor}, with ${v.hidden} held behind it. LOG's "all" brings them back.`));
    }

    if (ui.tab === 'MONEY') renderMoney(v);
    else if (ui.tab === 'PLAN') renderPlan(v);
    else renderLog(v);

    drag.fit();       // a taller body must never push the drag handle off screen
  }

  // ---------------------------------------------------------------------------
  // 13. SPA lifecycle. React Router means no page loads, so the only way to know
  //     which table is in front of you is to watch the path.
  // ---------------------------------------------------------------------------
  const ROUTE = /^\/corporations\/(\d+)\/casino\/slots\b/;

  let lastPath = null;
  const checkRoute = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    const m = ROUTE.exec(lastPath);
    if (m) { active = m[1]; repaint(); }
  };

  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) { const r = orig.apply(this, a); queueMicrotask(checkRoute); return r; };
  }
  window.addEventListener('popstate', checkRoute);

  // ---------------------------------------------------------------------------
  // 14. Boot.
  // ---------------------------------------------------------------------------
  const boot = () => {
    document.head.append(style);
    document.body.append(fab, panel);

    // A hidden element has no geometry, so a stored size is applied on first open
    // rather than at mount — otherwise the clamp has nothing to measure against.
    let restored = false;
    const restore = () => {
      if (restored || !ui.open) return;
      restored = true;
      drag.apply(ui);
      size.apply(ui.size);
      drag.fit();
    };
    fab.addEventListener('click', restore);
    if (ui.open) queueMicrotask(restore);

    // The whole of this tool's contact with the network: it asks the shared tap for
    // one path prefix and reads what the game already brought back.
    onApi('/api/corporations/', consume);

    checkRoute();
    render();
    log('ready, ledger holds', known().reduce((a, id) => a + sessionsOf(id).length, 0), 'receipt(s)');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
