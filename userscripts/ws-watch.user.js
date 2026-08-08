// ==UserScript==
// @name         Politiko — WS Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  Read-only observer for the two WebSockets the game itself opens (/ws/chat, /ws/market). Records which frame types arrive and what keys they carry, so the parts of the protocol the client silently ignores become visible. Opens no connection, transmits nothing, adds zero requests. Temporary measuring instrument — it tells you when it has nothing left to learn.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/ws-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/ws-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    frames arriving on the two WebSocket connections the game client opens
 *             on its own — wss://politiko.io/ws/chat and /ws/market. Nothing else.
 *   Opens:    no connection, ever. This script never constructs a socket, never
 *             transmits a frame, and never closes or reopens one the game owns.
 *   Requests: ZERO additional requests to politiko.io.
 *   Storage:  localStorage keys prefixed `pkws:` — the frame census (type names, key
 *             names, counts, timings), samples of UNRECOGNISED frames, and panel
 *             position. See "what is not stored" below.
 *   Alerts:   none. No desktop or tab alerts, no sound, no title changes. The panel
 *             redraws only while the tab is visible.
 *
 * HOW IT OBSERVES, precisely
 *
 *   It replaces `window.WebSocket` with a subclass of it, at document-start, before the
 *   game's bundle evaluates. The subclass registers its own 'message' listener in the
 *   constructor and does nothing else. Because it is a subclass:
 *     - `WebSocket.OPEN` and friends still resolve (the game reads them in six places;
 *       a plain function wrapper would break the game outright),
 *     - `this` is a genuine WebSocket, so the game's own transmissions are native and
 *       completely untouched — this script neither blocks, delays, nor alters them,
 *     - our listener is a peer of the game's handler, not a filter in front of it, so
 *       a fault here cannot break the game's chat.
 *
 *   Replacing a global constructor looks alarming, and should. So: the boundary is the
 *   closure below. Nothing outside it ever receives the socket object, the MessageEvent
 *   (whose .target is the socket), or the connection URL. The panel and the census see
 *   only frozen, JSON-derived plain objects.
 *
 * WHAT IS NOT STORED
 *
 *   - The connection URL carries an access token in its query string. This script keeps
 *     origin + pathname and discards query and fragment whole, at the point of
 *     construction, before anything else in the file can observe it. Allowlist, not
 *     denylist: a future credential-bearing parameter is dropped automatically.
 *   - No other player's name is written to storage. Chat bodies are never stored, and
 *     presence is recorded as counts, not as a list of who. The one exception is the
 *     sample kept for an UNRECOGNISED frame type — that is the entire point of the
 *     tool — which is credential-scrubbed and length-capped, and which you can clear
 *     with the "forget" button.
 *
 * WHY THIS EXISTS (and when to uninstall it)
 *
 *   Both of the game's frame handlers are switch statements with no `default` branch,
 *   so any message type the client does not recognise is discarded in total silence,
 *   and any field it does not read is invisible. The client's code therefore tells us
 *   what the client USES, not what the server SENDS. Reading more of the bundle cannot
 *   close that gap and probing endpoints is out — passive observation is the only
 *   instrument that measures it.
 *
 *   This is a temporary instrument, not a feature. It tracks the specific questions it
 *   was built to answer and says so in the panel when they are settled. When it reports
 *   "nothing left to learn", copy the findings out and uninstall it.
 *
 * Design rule for this repo: consume, don't request. This script must never originate
 * a network call to Politiko, never touch a page you aren't actively viewing, and never
 * raise an alert from an unfocused tab. See docs/01-rules-envelope.md and
 * docs/09-socket-surface.md.
 *
 * NOTE TO ANYONE EDITING THIS FILE
 *   `tools/test-passive.js` fails the build if this file contains any of a short list of
 *   transmitting tokens, ANYWHERE — including inside comments. That is deliberate: a
 *   whole-file check has no parser to fool. It is why the prose above says "transmits"
 *   rather than naming the method. Keep it that way.
 */

(() => {
  'use strict';

  const TAG = '[pk-ws-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = {
    census: 'pkws:census',
    ui: 'pkws:ui',
  };

  const load = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch { return fallback; }
  };
  const save = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('save failed', e); }
  };

  // The frame types the game's own handlers have a case for, read off the 2026-08-03
  // bundles (docs/09-socket-surface.md). Anything outside these lists is the interesting
  // thing: the client would drop it without a trace.
  const KNOWN = {
    chat: ['room_joined', 'history', 'message_ack', 'message', 'error', 'presence', 'dnd_updated'],
    market: ['quote', 'candle_update'],
  };

  // ===========================================================================
  // 1. WS TAP v1 — shared verbatim block.
  //
  //    Repo convention, same as PANEL KIT: copy this block into a new tool exactly
  //    as it stands. If you have to change it, bump the version here and in every
  //    tool carrying a copy, so the copies can be diffed.
  //
  //    onSocketFrame(fn) -> unsubscribe
  //      fn receives a frozen plain record and nothing else:
  //        { id, kind, safeUrl, ev, at }                     ev: 'open' | 'close'
  //        { id, kind, safeUrl, ev:'close', code, wasClean }
  //        { id, kind, safeUrl, ev:'frame', type, data }     data: frozen, scrubbed
  //      kind is 'chat' | 'market' | 'other', derived from the pathname.
  //      id is an opaque per-connection counter, so reconnects are distinguishable.
  //
  //    THE INVARIANT: nothing in this block hands out a socket, a MessageEvent, or a
  //    URL with a query string, and nothing in it transmits. It holds no reference to
  //    any connection — not even a WeakMap — so a reconnect leaves nothing behind.
  // ===========================================================================
  const WS_TAP_VERSION = 1;

  const subs = new Set();
  const onSocketFrame = (fn) => { subs.add(fn); return () => subs.delete(fn); };

  (() => {
    const Base = window.WebSocket;
    // Extend whatever is installed, so a chained wrapper from another extension
    // keeps working; and refuse to stack a second copy of ourselves.
    if (typeof Base !== 'function' || Base.__pkTapped) return;

    const SECRET = /(token|jwt|auth|bearer|secret|password|passwd|refresh|session|cookie|credential|apikey|api_key)/i;

    // Deep-copy into frozen plain data, replacing credential-looking values on the way.
    // Runs before anything is emitted, so a scrubbed value cannot reach a subscriber,
    // storage, or the panel even if the server starts sending one tomorrow.
    const clean = (v, d = 0) => {
      if (d > 6 || v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return Object.freeze(v.slice(0, 200).map((x) => clean(x, d + 1)));
      const o = {};
      for (const [k, val] of Object.entries(v)) o[k] = SECRET.test(k) ? '[redacted]' : clean(val, d + 1);
      return Object.freeze(o);
    };

    const emit = (rec) => {
      const frozen = Object.freeze(rec);
      for (const fn of subs) { try { fn(frozen); } catch (e) { log('subscriber error', e); } }
    };

    let seq = 0;

    class Tapped extends Base {
      constructor(url, protocols) {
        super(url, protocols); // the ONLY construction here, and it is the game's own

        // The raw URL must not survive this block: it carries the access token.
        let kind = 'other', safeUrl = '';
        try {
          const u = new URL(String(url), location.href);
          safeUrl = u.origin + u.pathname;     // allowlist; query + fragment dropped whole
          kind = u.pathname === '/ws/chat' ? 'chat'
            : u.pathname === '/ws/market' ? 'market' : 'other';
        } catch { /* an unparseable URL just stays 'other' with no safeUrl */ }

        const info = Object.freeze({ id: ++seq, kind, safeUrl });

        super.addEventListener('open', () => emit({ ...info, ev: 'open', at: Date.now() }));
        super.addEventListener('close', (e) => emit({
          ...info, ev: 'close', at: Date.now(), code: e.code, wasClean: e.wasClean,
        }));
        super.addEventListener('message', (e) => {
          if (typeof e.data !== 'string') return; // binary: skip rather than read a Blob
          let p;
          try { p = JSON.parse(e.data); } catch { return; }
          emit({
            ...info, ev: 'frame', at: Date.now(),
            type: (p && typeof p.type === 'string') ? p.type : null,
            data: clean(p),
          });
        });
      }
    }

    Object.defineProperty(Tapped, '__pkTapped', { value: true });
    window.WebSocket = Tapped;
    log('tap installed, WS TAP v' + WS_TAP_VERSION);
  })();

  // ---------------------------------------------------------------------------
  // 2. The census — what has been seen, and what is still unknown.
  // ---------------------------------------------------------------------------
  const SEED_WINDOW_MS = 10_000;  // "at connect" means within this of the open
  const SEED_BURST = 3;           // this many presence frames in the window = seeded
  const SEED_QUIET_RUNS = 3;      // this many quiet connects (with presence later) = not seeded
  const SWEEP_MS = 2 * 60 * 60 * 1000;  // observation before "no unknown types" means much
  const SWEEP_FRAMES = 500;
  const MAX_UNKNOWN_SAMPLES = 5;
  const SAMPLE_CHARS = 400;

  const blank = () => ({
    v: 1,
    startedAt: Date.now(),
    observedMs: 0,
    frames: 0,
    connects: 0,
    types: {},       // kind -> type -> { n, keys: {name: count}, firstAt, lastAt }
    unknown: {},     // kind -> type -> { n, firstAt, samples: [string] }
    quietRuns: 0,    // consecutive connects with no presence in the seed window
    seeded: null,    // true | false | null(undecided)
    seedEvidence: null,
    presenceTotal: 0,
    selfName: null,  // learned from message_ack (a receipt for your own message)
    selfInPresence: null,
    errorScopes: {},
  });

  let census = load(K.census, null);
  if (!census || census.v !== 1) census = blank();

  let dirty = false;
  const touch = () => { dirty = true; };
  setInterval(() => { if (dirty) { dirty = false; save(K.census, census); } }, 5000);
  window.addEventListener('pagehide', () => { if (dirty) save(K.census, census); });

  // Per-connection, in memory only — never persisted, never exposed. Holds plain
  // counters keyed by the tap's opaque id, never a socket.
  //
  // Named `conns`, not `live`: PANEL KIT v1 declares its own `live` and the kit is
  // copied verbatim by repo convention, so the name belongs to it.
  const conns = new Map();  // id -> { kind, openedAt, presenceInWindow, frames }

  const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

  const record = (rec) => {
    if (rec.ev === 'open') {
      census.connects++;
      conns.set(rec.id, { kind: rec.kind, openedAt: rec.at, presenceInWindow: 0, frames: 0 });
      touch();
      return;
    }
    if (rec.ev === 'close') {
      const c = conns.get(rec.id);
      if (c && c.kind === 'chat') settleSeed(c);
      conns.delete(rec.id);
      touch();
      return;
    }
    if (rec.ev !== 'frame') return;

    const conn = conns.get(rec.id);
    if (conn) conn.frames++;
    census.frames++;

    const kind = rec.kind;
    const type = rec.type ?? '(untyped)';
    const known = (KNOWN[kind] || []).includes(type);

    const bucket = known ? census.types : census.unknown;
    bucket[kind] = bucket[kind] || {};
    const entry = bucket[kind][type] = bucket[kind][type] || (known
      ? { n: 0, keys: {}, firstAt: rec.at, lastAt: rec.at }
      : { n: 0, firstAt: rec.at, samples: [] });
    entry.n++;
    entry.lastAt = rec.at;

    if (known) {
      // Only key NAMES are kept. This is the schema question — "does presence carry a
      // room_id?" — and it is answerable without retaining anyone's data.
      for (const k of Object.keys(rec.data || {})) bump(entry.keys, k);
      if (type === 'message' || type === 'message_ack') {
        const msg = rec.data?.message;
        if (msg && typeof msg === 'object') {
          for (const k of Object.keys(msg)) bump(entry.keys, 'message.' + k);
        }
      }
    } else if (entry.samples.length < MAX_UNKNOWN_SAMPLES) {
      // The whole reason the tool exists. Already credential-scrubbed by the tap.
      try { entry.samples.push(JSON.stringify(rec.data).slice(0, SAMPLE_CHARS)); } catch { /* unserialisable */ }
    }

    if (kind === 'chat') {
      if (type === 'presence') {
        census.presenceTotal++;
        if (conn && rec.at - conn.openedAt <= SEED_WINDOW_MS) conn.presenceInWindow++;
        const who = rec.data?.username;
        if (census.selfName && who === census.selfName) census.selfInPresence = true;
        if (conn) checkSeed(conn);
      }
      if (type === 'error') {
        const s = rec.data?.scope;
        if (typeof s === 'string') bump(census.errorScopes, s);
      }
      // A message_ack is the server's receipt for a message YOU transmitted, so its
      // sender is you. That is the only self-identifying read here, and it needs no
      // request to establish.
      if (type === 'message_ack' && !census.selfName) {
        const s = rec.data?.message?.sender;
        if (typeof s === 'string' && s) { census.selfName = s; touch(); }
      }
    }

    touch();
  };

  // A burst at connect settles the question immediately and positively.
  const checkSeed = (conn) => {
    if (census.seeded !== null) return;
    if (conn.presenceInWindow >= SEED_BURST) {
      census.seeded = true;
      census.seedEvidence = `${conn.presenceInWindow} presence frames within `
        + `${SEED_WINDOW_MS / 1000}s of a connect`;
      touch();
    }
  };

  // A quiet connect only counts as evidence AGAINST seeding once we know presence
  // works at all on this deploy — otherwise "no presence frames" just means "nobody
  // changed state", which is not the same claim.
  const settleSeed = (conn) => {
    if (census.seeded !== null) return;
    if (conn.presenceInWindow > 0) { census.quietRuns = 0; return; }
    if (census.presenceTotal === 0) return; // can't distinguish quiet from unseeded yet
    census.quietRuns++;
    if (census.quietRuns >= SEED_QUIET_RUNS) {
      census.seeded = false;
      census.seedEvidence = `${census.quietRuns} connects with no presence frame in the `
        + `first ${SEED_WINDOW_MS / 1000}s, on a session that saw ${census.presenceTotal} later`;
    }
  };

  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    // Only count time the tab was actually open and running.
    if (now - lastTick < 30_000) { census.observedMs += now - lastTick; touch(); }
    lastTick = now;
  }, 10_000);

  onSocketFrame(record);

  // ---------------------------------------------------------------------------
  // 3. The questions this instrument exists to answer.
  //    Each returns { state: 'open'|'done', text }. When every blocking question is
  //    done, the panel says so and the tool has served its purpose.
  // ---------------------------------------------------------------------------
  const keysOf = (kind, type) => Object.keys(census.types?.[kind]?.[type]?.keys || {});
  const countOf = (kind, type) => census.types?.[kind]?.[type]?.n || 0;
  const unknownList = () => Object.entries(census.unknown).flatMap(
    ([kind, m]) => Object.entries(m).map(([type, e]) => ({ kind, type, ...e })));

  const QUESTIONS = [
    {
      id: 'pfields', blocking: true,
      q: 'Does a presence frame carry more than username + online?',
      probe: () => {
        if (!countOf('chat', 'presence')) return { state: 'open', text: 'no presence frame seen yet' };
        const extra = keysOf('chat', 'presence').filter((k) => k !== 'type' && k !== 'username' && k !== 'online');
        return {
          state: 'done',
          text: extra.length ? `YES — also carries: ${extra.join(', ')}` : 'no — exactly type, username, online',
        };
      },
    },
    {
      id: 'seed', blocking: true,
      q: 'Does the server seed presence at connect, or only send deltas?',
      probe: () => {
        if (census.seeded === true) return { state: 'done', text: `SEEDED — ${census.seedEvidence}` };
        if (census.seeded === false) return { state: 'done', text: `DELTA-ONLY — ${census.seedEvidence}` };
        if (census.presenceTotal === 0) return { state: 'open', text: 'no presence frame seen yet' };
        return {
          state: 'open',
          text: `${census.quietRuns}/${SEED_QUIET_RUNS} quiet connects — reload the game a few times`,
        };
      },
    },
    {
      id: 'unknown', blocking: true,
      q: 'Any frame type the game silently ignores?',
      probe: () => {
        const u = unknownList();
        if (u.length) {
          return { state: 'done', text: `FOUND ${u.length}: ${u.map((x) => `${x.kind}/${x.type} ×${x.n}`).join(', ')}` };
        }
        if (census.observedMs >= SWEEP_MS && census.frames >= SWEEP_FRAMES) {
          return { state: 'done', text: `none in ${fmtDur(census.observedMs)} / ${census.frames} frames` };
        }
        return {
          state: 'open',
          text: `none yet — ${fmtDur(census.observedMs)}/${fmtDur(SWEEP_MS)}, ${census.frames}/${SWEEP_FRAMES} frames`,
        };
      },
    },
    {
      id: 'mfields', blocking: true,
      q: 'Does a market quote carry more than price / bid / ask?',
      probe: () => {
        if (!countOf('market', 'quote')) return { state: 'open', text: 'visit the stocks screen once' };
        const extra = keysOf('market', 'quote').filter(
          (k) => !['type', 'instrument_id', 'price', 'bid', 'ask'].includes(k));
        return {
          state: 'done',
          text: extra.length ? `YES — also carries: ${extra.join(', ')}` : 'no — nothing beyond the read fields',
        };
      },
    },
    {
      id: 'escope', blocking: false,
      q: 'What scope values can an error frame carry?',
      probe: () => {
        const s = Object.keys(census.errorScopes);
        return s.length
          ? { state: 'done', text: s.join(', ') }
          : { state: 'open', text: 'no error frame yet (rare — bonus, not blocking)' };
      },
    },
    {
      id: 'selfp', blocking: false,
      q: 'Does presence include your own username?',
      probe: () => {
        if (!census.selfName) return { state: 'open', text: 'send one chat message to identify yourself' };
        if (census.selfInPresence) return { state: 'done', text: 'YES — the header count is off by one' };
        return { state: 'open', text: `not so far (bonus, not blocking)` };
      },
    },
  ];

  const answers = () => QUESTIONS.map((q) => ({ ...q, ...q.probe() }));
  const retired = () => answers().every((a) => !a.blocking || a.state === 'done');

  // ---------------------------------------------------------------------------
  // 4. Panel
  // ---------------------------------------------------------------------------
  const fmtDur = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
  };

  const CSS = `
    /* Corner allocation across this repo's tools: time-watch owns top-left,
       align-watch bottom-left, and the game's own Comms dock is fixed bottom-right
       (right: 20px, bottom: 0, 320x420). That leaves top-right. Drag it anywhere;
       it remembers where you put it, including the button. */
    .pkws-fab { position: fixed; right: 12px; top: 12px; z-index: 2147482000;
      width: 34px; height: 34px; border-radius: 17px; border: 1px solid #3f3f46;
      background: #18181b; color: #e4e4e7; font-size: 15px; line-height: 32px;
      text-align: center; cursor: pointer; user-select: none; opacity: .85; }
    .pkws-fab:hover { opacity: 1; }
    .pkws-fab.pkws-done { border-color: #34d399; color: #34d399; }
    .pkws-panel { position: fixed; right: 12px; top: 52px; z-index: 2147482000;
      width: min(380px, calc(100vw - 24px)); max-height: 74vh;
      display: flex; flex-direction: column; border: 1px solid #3f3f46;
      border-radius: 8px; background: #09090bf2; color: #e4e4e7;
      font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .pkws-head { display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 7px 12px; border-bottom: 1px solid #27272a; user-select: none;
      font-size: 11px; color: #a1a1aa; text-transform: uppercase; letter-spacing: .08em; }
    .pkws-body { overflow: auto; padding: 10px 12px; }
    .pkws-panel h1 { font-size: 11px; margin: 10px 0 5px; color: #a1a1aa;
      text-transform: uppercase; letter-spacing: .08em; }
    .pkws-panel h1:first-child { margin-top: 0; }
    .pkws-row { display: flex; justify-content: space-between; gap: 8px; }
    .pkws-dim { color: #a1a1aa; }
    .pkws-quiet { color: #71717a; }
    .pkws-ok { color: #34d399; }
    .pkws-hl { color: #fbbf24; }
    .pkws-alert { color: #f87171; }
    .pkws-q { margin: 0 0 7px; padding-left: 15px; text-indent: -15px; }
    .pkws-q .pkws-mark { display: inline-block; width: 15px; text-indent: 0; }
    .pkws-a { display: block; padding-left: 15px; }
    .pkws-table { width: 100%; border-collapse: collapse; }
    .pkws-table td { padding: 1px 6px 1px 0; white-space: nowrap; vertical-align: top; }
    .pkws-table td.pkws-keys { white-space: normal; color: #71717a; }
    .pkws-note { margin-top: 10px; color: #71717a; font-size: 11px; }
    .pkws-retire { margin: 0 0 8px; padding: 7px 9px; border: 1px solid #34d399;
      border-radius: 6px; color: #34d399; }
    .pkws-btn { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
      border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 7px; cursor: pointer; }
    .pkws-sample { display: block; margin: 2px 0 0; padding: 4px 6px; background: #18181b;
      border-radius: 4px; color: #fbbf24; white-space: pre-wrap; word-break: break-all;
      font-size: 11px; }
  `;

  let panel = null, body = null, fab = null;
  let drag = null, fabDrag = null;
  const ui = load(K.ui, {});

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const render = () => {
    // Every tool here refuses to draw while hidden, which is also why nothing appears
    // in an automated preview pane until Document.prototype.hidden is overridden.
    if (!body || document.hidden) return;
    body.textContent = '';

    const as = answers();
    const done = retired();

    if (fab) {
      fab.classList.toggle('pkws-done', done);
      fab.title = done ? 'ws-watch: nothing left to learn' : 'ws-watch';
    }

    if (done) {
      const box = el('div', 'pkws-retire');
      box.append(el('div', null, 'Nothing left to learn.'));
      box.append(el('div', 'pkws-quiet',
        'Every blocking question is settled. Copy the findings out and uninstall ws-watch — '
        + 'then fold the answers into docs/09-socket-surface.md.'));
      body.append(box);
    }

    // --- what is connected right now ---
    body.append(el('h1', null, 'connections'));
    if (!conns.size) {
      body.append(el('div', 'pkws-quiet',
        census.connects ? 'nothing open right now' : 'no socket seen yet — are you logged in?'));
    } else {
      for (const [id, c] of conns) {
        const row = el('div', 'pkws-row');
        row.append(el('span', null, `#${id} ${c.kind}`));
        row.append(el('span', 'pkws-dim', `${c.frames} frames · up ${fmtDur(Date.now() - c.openedAt)}`));
        body.append(row);
      }
    }
    const tot = el('div', 'pkws-row pkws-quiet');
    tot.append(el('span', null, `${census.frames} frames / ${census.connects} connects`));
    tot.append(el('span', null, `observed ${fmtDur(census.observedMs)}`));
    body.append(tot);

    // --- the questions ---
    body.append(el('h1', null, 'what is still unknown'));
    for (const a of as) {
      const p = el('p', 'pkws-q');
      const mark = el('span', 'pkws-mark', a.state === 'done' ? '✓' : (a.blocking ? '·' : '○'));
      mark.classList.add(a.state === 'done' ? 'pkws-ok' : 'pkws-quiet');
      p.append(mark, el('span', a.state === 'done' ? null : 'pkws-dim', a.q));
      const ans = el('span', 'pkws-a ' + (a.state === 'done' ? 'pkws-hl' : 'pkws-quiet'), a.text);
      p.append(ans);
      body.append(p);
    }

    // --- unrecognised frames, pinned because they are the point ---
    const unk = unknownList();
    if (unk.length) {
      const h = el('h1', 'pkws-alert', 'UNRECOGNISED FRAME TYPES');
      body.append(h);
      for (const u of unk) {
        body.append(el('div', 'pkws-alert', `${u.kind}/${u.type} ×${u.n}`));
        for (const s of u.samples) body.append(el('code', 'pkws-sample', s));
      }
    }

    // --- the census ---
    body.append(el('h1', null, 'frame types seen'));
    const kinds = Object.keys(census.types);
    if (!kinds.length) {
      body.append(el('div', 'pkws-quiet', 'nothing yet'));
    } else {
      const t = el('table', 'pkws-table');
      for (const kind of kinds) {
        for (const [type, e] of Object.entries(census.types[kind]).sort((a, b) => b[1].n - a[1].n)) {
          const tr = document.createElement('tr');
          tr.append(el('td', null, `${kind}/${type}`));
          tr.append(el('td', 'pkws-dim', String(e.n)));
          tr.append(el('td', 'pkws-keys', Object.keys(e.keys).filter((k) => k !== 'type').join(' ')));
          t.append(tr);
        }
      }
      body.append(t);
    }

    body.append(el('div', 'pkws-note',
      'Reads frames the game already received. Opens nothing, transmits nothing, '
      + 'adds zero requests. Key names only — no chat bodies, no player names, except '
      + 'in an unrecognised-frame sample.'));

    if (drag) drag.fit();
  };

  // ===========================================================================
  // 5. PANEL KIT v1 — shared verbatim block.
  //
  //    Repo convention: every panel we ship is draggable and remembers where you
  //    put it. Copy this block into a new tool exactly as it stands. If you have
  //    to change it, bump the version in this header and in every tool carrying
  //    a copy, so the copies can be diffed. No build step, no @require, so each
  //    script stays a single auditable file (clause 6).
  //
  //    draggable(node, handle, onMove) -> { apply(pos), reset(), dragged() }
  //      node    the element that moves (must be position: fixed)
  //      handle  the grab area; buttons/inputs inside it stay clickable, unless
  //              the handle IS the control (a bare FAB drags from itself)
  //      onMove  called with {x, y} in viewport px, or null when reset
  //      dragged() is true if the last gesture actually moved — check it in a
  //              click handler so dragging a FAB doesn't also toggle it
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
    };
  };

  // ---------------------------------------------------------------------------
  // 6. Boot
  // ---------------------------------------------------------------------------
  const persistUi = (patch) => { Object.assign(ui, patch); save(K.ui, ui); };

  const mount = () => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    fab = el('button', 'pkws-fab', '◉');
    fab.title = 'ws-watch';
    document.body.append(fab);

    panel = el('div', 'pkws-panel');
    const head = el('div', 'pkws-head');
    head.append(el('span', null, 'ws-watch'));
    const btns = el('span');
    const forget = el('button', 'pkws-btn', 'forget');
    forget.title = 'discard everything recorded and start the census over';
    forget.addEventListener('click', () => {
      census = blank();
      save(K.census, census);
      render();
    });
    const hide = el('button', 'pkws-btn', '×');
    hide.style.marginLeft = '5px';
    hide.addEventListener('click', () => setOpen(false));
    btns.append(forget, hide);
    head.append(btns);

    body = el('div', 'pkws-body');
    panel.append(head, body);
    document.body.append(panel);

    drag = draggable(panel, head, (pos) => persistUi(pos ?? { x: null, y: null }));
    drag.apply(ui);
    head.addEventListener('dblclick', drag.reset);

    fabDrag = draggable(fab, fab, (pos) => persistUi({ fab: pos }));
    fabDrag.apply(ui.fab);
    fab.addEventListener('click', () => { if (!fabDrag.dragged()) setOpen(!ui.open); });

    setOpen(ui.open !== false);
    // A panel that mounted while the window was small can land with its handle off
    // screen, which is unrecoverable. fit() after the first paint, and after every
    // render that changes the height.
    requestAnimationFrame(() => { drag.fit(); fabDrag.fit(); });
  };

  const setOpen = (open) => {
    persistUi({ open });
    if (panel) panel.style.display = open ? 'flex' : 'none';
    if (open) render();
  };

  const boot = () => {
    mount();
    render();
    setInterval(render, 1000);
    document.addEventListener('visibilitychange', render);
    log('ready');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
