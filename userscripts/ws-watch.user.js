// ==UserScript==
// @name         Politiko — WS Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.8.0
// @description  Read-only observer for the three WebSockets the game itself opens (/ws/chat, /ws/market, /ws/casino/poker). Records which frame types arrive, what keys they carry, how often they arrive, and the values of four named server fields (a closed allowlist — no usernames, no message bodies). Opens no connection, transmits nothing, adds zero requests. Temporary measuring instrument — it tells you when it has nothing left to learn.
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
 *   Reads:    frames arriving on the three WebSocket connections the game client opens
 *             on its own — wss://politiko.io/ws/chat, /ws/market, and /ws/casino/poker.
 *             Nothing else.
 *   Opens:    no connection, ever. This script never constructs a socket, never
 *             transmits a frame, and never closes or reopens one the game owns.
 *   Requests: ZERO additional requests to politiko.io.
 *   Storage:  localStorage keys prefixed `pkws:` — the frame census (type names, key
 *             names, counts, timings, inter-arrival histogram), samples of UNRECOGNISED
 *             frames, the four allowlisted values below, and panel position.
 *             See "what is not stored" below.
 *
 * VALUES RECORDED — a closed allowlist of four, added in 0.2.0
 *
 *   quote.game_time              server game-clock stamp (number or string)
 *   candle_update.bucket_start   OHLCV bar boundary
 *   candle_update.timeframe      which bar ("1m", "5m", …)
 *   presence.online              the boolean only, as a COUNT of true vs false
 *
 *   Everything else stays key-names-only, exactly as in 0.1.x. The allowlist is
 *   enforced structurally: a single table maps (frame type -> field name -> how to
 *   record it), and a field absent from that table has no code path that can store
 *   its value. It is not a filter applied by discipline at each call site.
 *
 *   Why these four, and why now. 0.1.x recorded shapes only, which was right for
 *   "what types and fields exist" and useless for three questions it raised:
 *   whether the server seeds presence at connect (needs true-vs-false), whether
 *   quote.game_time agrees with the game clock (needs the number), and what
 *   bucket_start actually is. See docs/09-socket-surface.md.
 *
 *   presence.online is the one that touches another person. It is stored as two
 *   integers per connection window — how many online:true and how many online:false —
 *   and never alongside a username. The tool therefore cannot say WHO is online,
 *   only HOW MANY edges of each kind arrived. That is enough to tell a roster seed
 *   from ordinary churn, which is the whole reason it is here.
 *   Alerts:   none. No desktop or tab alerts, no sound, no title changes. The panel
 *             redraws only while the tab is visible.
 *   Clipboard: written ONLY when you click "copy findings", and only with the report
 *             shown in the panel plus the stored census. Nothing is copied on its own.
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
 *   - The access token, which the game puts in two different places depending on the
 *     socket. On /ws/chat and /ws/market it is a query parameter on the connection
 *     URL: this script keeps origin + pathname and discards query and fragment whole,
 *     at the point of construction, before anything else in the file can observe it.
 *     Allowlist, not denylist, so a future credential-bearing parameter is dropped
 *     automatically. On /ws/casino/poker it is not in the URL at all — it rides in the
 *     constructor's second argument as an `auth.<token>` subprotocol. That argument is
 *     forwarded to the real constructor and never read, so there is no code path that
 *     could store it. Both facts are fenced by tools/test-passive.js.
 *   - No other player's name is written to storage. Chat bodies are never stored.
 *     Presence is counts, never a list of who. `username` is not on the allowlist and
 *     there is no code path that records it.
 *   - UNRECOGNISED frame types are sampled whole, because "what does this carry?" is
 *     the entire point of the tool. Those samples are credential-scrubbed, length-
 *     capped, and — new in 0.2.0 — person-scrubbed: a key like `username` or `body`
 *     keeps its NAME but its value becomes a type marker such as `<string>`. So the
 *     sample still tells you an unknown frame carries a username; it does not tell
 *     you, or anyone you show it to, whose. Clear them any time with "forget".
 *   - Your OWN username is held in memory and written to storage under `selfName`,
 *     learned from a message_ack (the server's receipt for a message you sent). It is
 *     used to tell your own presence echo apart from other players'.
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
  // 1. WS TAP v2 — shared verbatim block.
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
  //      kind is 'chat' | 'market' | 'casino' | 'other', derived from the pathname.
  //      id is an opaque per-connection counter, so reconnects are distinguishable.
  //
  //    THE INVARIANT: nothing in this block hands out a socket, a MessageEvent, a
  //    URL with a query string, or the `protocols` argument, and nothing in it
  //    transmits. It holds no reference to any connection — not even a WeakMap — so
  //    a reconnect leaves nothing behind.
  //
  //    v2 (2026-08-26) added the casino kind and the `protocols` rule. The token is
  //    not always in the URL: /ws/casino/poker authenticates with an `auth.<token>`
  //    subprotocol, so "redact the query string" is not on its own a sufficient
  //    account of what this block must not keep. See docs/09-socket-surface.md.
  // ===========================================================================
  const WS_TAP_VERSION = 2;

  const subs = new Set();
  const onSocketFrame = (fn) => { subs.add(fn); return () => subs.delete(fn); };

  (() => {
    const Base = window.WebSocket;
    // Extend whatever is installed, so a chained wrapper from another extension
    // keeps working; and refuse to stack a second copy of ourselves.
    if (typeof Base !== 'function' || Base.__pkTapped) return;

    const SECRET = /(token|jwt|auth|bearer|secret|password|passwd|refresh|session|cookie|credential|apikey|api_key)/i;

    // Deep-copy into frozen plain data, replacing credential-looking VALUES on the
    // way — key names survive, so "does this frame carry a token field?" stays an
    // answerable question. Runs before anything is emitted, so a scrubbed value
    // cannot reach a subscriber, storage, or a panel even if the server starts
    // sending one tomorrow.
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

        // Neither argument may survive this block; both carry a token, in different
        // places. `protocols` is not read below — forwarding it to the base
        // constructor above is the whole of its handling, which is why no token can
        // leak through it. (Written without naming that call, because the static
        // fence in tools/test-passive.js counts occurrences of the literal text.)
        let kind = 'other', safeUrl = '';
        try {
          const u = new URL(String(url), location.href);
          safeUrl = u.origin + u.pathname;     // allowlist; query + fragment dropped whole
          kind = u.pathname === '/ws/chat' ? 'chat'
            : u.pathname === '/ws/market' ? 'market'
              : u.pathname.startsWith('/ws/casino/') ? 'casino' : 'other';
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
  const SWEEP_MS = 2 * 60 * 60 * 1000;  // observation before "no unknown types" means much
  const SWEEP_FRAMES = 500;
  const MAX_UNKNOWN_SAMPLES = 5;
  const SAMPLE_CHARS = 400;
  const MAX_WINDOWS = 40;         // connection windows retained
  const MAX_CLOCK = 60;           // (localMs, game_time) pairs retained
  const MAX_BUCKETS = 12;         // distinct bucket_start values kept per timeframe

  // -------------------------------------------------------------------------
  // THE VALUE ALLOWLIST.
  //
  // 0.1.x recorded key names and never values, which kept chat bodies and other
  // players' names out of storage by construction. 0.2.0 needs four specific
  // values to answer questions that shapes alone cannot (docs/09). This table is
  // how that stays honest: it is the ONLY place a value can be recorded, and a
  // field that is not in it has no code path that stores it.
  //
  //   'clock'   keep the value with a local receive time, for rate arithmetic
  //   'tally'   count distinct values, never associate them with anything
  //   'bucket'  keep a bounded set of distinct values, to test quantization
  //   'edge'    count true vs false ONLY — never store what it was about
  //
  // Deliberately absent, and must stay absent: username, sender, body, label,
  // dm_target, room_id, instrument_id, kind, error. If you add to this table,
  // update the disclosure header in the same edit — clause 6 is not optional.
  // -------------------------------------------------------------------------
  const VALUES = {
    quote: { game_time: 'clock' },
    candle_update: { bucket_start: 'bucket', timeframe: 'tally' },
    presence: { online: 'edge' },
  };

  const blank = () => ({
    v: 2,
    startedAt: Date.now(),
    observedMs: 0,
    frames: 0,
    connects: 0,
    types: {},       // kind -> type -> { n, keys: {name: count}, firstAt, lastAt }
    unknown: {},     // kind -> type -> { n, firstAt, samples: [string] }
    arrivals: {},    // "kind/type" -> { n, lastAt, buckets: {label: count} }
    windows: [],     // per connection: { kind, at, ms, frames, on, off, self, closed }
    clock: [],       // quote.game_time: { t: localMs, g: value }
    clockType: null, // typeof the first game_time seen
    buckets: {},     // timeframe -> [distinct bucket_start values]
    timeframes: {},  // timeframe -> count
    presenceTotal: 0,
    presenceOn: 0,   // online:true  edges, all-time
    presenceOff: 0,  // online:false edges, all-time
    selfName: null,  // learned from message_ack (a receipt for your own message)
    selfInPresence: null,
    errorScopes: {},
    valuesFrom: Date.now(), // when value recording began — earlier counts predate it
  });

  // v1 -> v2. The counts and unrecognised-frame samples from a v1 census are the
  // expensive part; throwing them away to add fields would be silly. Everything
  // new starts empty, and `valuesFrom` marks the boundary so nobody reads a value
  // series as covering the whole of `frames`.
  const migrate = (old) => {
    const c = blank();
    c.startedAt = old.startedAt ?? c.startedAt;
    c.observedMs = old.observedMs ?? 0;
    c.frames = old.frames ?? 0;
    c.connects = old.connects ?? 0;
    c.types = old.types ?? {};
    c.unknown = old.unknown ?? {};
    c.presenceTotal = old.presenceTotal ?? 0;
    c.selfName = old.selfName ?? null;
    c.selfInPresence = old.selfInPresence ?? null;
    c.errorScopes = old.errorScopes ?? {};
    c.migratedFrom = old.v ?? 1;
    // NOT carried: `seeded` / `seedEvidence`. The v1 detector could not tell a
    // server seed from transitions landing near a connect, so its verdict was not
    // evidence. Starting that question over is the point of this version.
    return c;
  };

  let census = load(K.census, null);
  if (census && census.v === 1) census = migrate(census);
  if (!census || census.v !== 2) census = blank();

  let dirty = false;
  const touch = () => { dirty = true; };
  setInterval(() => { if (dirty) { dirty = false; save(K.census, census); } }, 5000);
  window.addEventListener('pagehide', () => { if (dirty) save(K.census, census); });

  // Per-connection, in memory only — never persisted, never exposed. Holds plain
  // counters keyed by the tap's opaque id, never a socket.
  //
  // Named `conns`, not `live`: PANEL KIT v2 declares its own `live` and the kit is
  // copied verbatim by repo convention, so the name belongs to it.
  const conns = new Map();  // id -> { kind, openedAt, frames, w: <window> }

  const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

  // Person-identifying keys. An UNRECOGNISED frame is stored whole, because its whole
  // point is "what does this carry?" — but that is also the one path where another
  // player's name could reach storage, and it did in testing (a `typing` frame the
  // game has no case for carried a username).
  //
  // The fix keeps the discovery and drops the person: the key survives and the value
  // becomes a type marker, so the sample still answers "typing carries username and
  // room_id" without recording who was typing. Values that are not person-shaped —
  // instrument_id, ttl_ms, level — are untouched, and those are the ones worth reading.
  const PERSONAL = /^(username|user|sender|recipient|target|dm_target|name|display_name|nick|body|text|message|content|label|title|email|avatar|quip)$/i;
  const personScrub = (v, d = 0) => {
    if (d > 6 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => personScrub(x, d + 1));
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      o[k] = PERSONAL.test(k) && val !== null && typeof val !== 'object'
        ? `<${typeof val}>`
        : personScrub(val, d + 1);
    }
    return o;
  };

  // Inter-arrival histogram. 0.1.x kept only firstAt/lastAt per type, which is why
  // the first capture's rates had to be reconstructed by hand — badly, as it turned
  // out. Buckets rather than raw timestamps keeps the census bounded.
  const GAPS = [
    [1000, '<1s'], [5000, '1-5s'], [15_000, '5-15s'],
    [60_000, '15-60s'], [300_000, '1-5m'], [Infinity, '>5m'],
  ];
  const noteArrival = (key, at) => {
    const a = census.arrivals[key] = census.arrivals[key] || { n: 0, lastAt: null, buckets: {} };
    if (a.lastAt !== null) {
      const gap = at - a.lastAt;
      for (const [lim, label] of GAPS) { if (gap < lim) { bump(a.buckets, label); break; } }
    }
    a.lastAt = at;
    a.n++;
  };

  // The ONLY function that writes a server value into the census. Everything it can
  // do is named in VALUES; a field absent from that table returns before touching
  // anything. `username` is not in the table and there is no branch that could take
  // one — the 'edge' mode deliberately receives the boolean alone.
  const recordValue = (type, field, value, at) => {
    const mode = VALUES[type]?.[field];
    if (!mode) return;
    if (mode === 'clock') {
      if (census.clockType === null) census.clockType = typeof value;
      if (typeof value !== 'number' && typeof value !== 'string') return;
      // The frame's arrival time, not "whenever this reducer ran" — the two can
      // differ by a render, and this pairing is the whole basis of the rate.
      census.clock.push({ t: at, g: value });
      if (census.clock.length > MAX_CLOCK) census.clock.shift();
      return;
    }
    if (mode === 'tally') {
      if (typeof value === 'string' || typeof value === 'number') bump(census.timeframes, String(value));
      return;
    }
    if (mode === 'bucket') {
      return; // handled by recordBucket, which needs the paired timeframe
    }
    if (mode === 'edge') {
      if (value === true) census.presenceOn++;
      else if (value === false) census.presenceOff++;
    }
  };

  // bucket_start is only meaningful next to its timeframe, so it is the one
  // allowlisted field written from a pair rather than alone.
  const recordBucket = (tf, start) => {
    if (VALUES.candle_update?.bucket_start !== 'bucket') return;
    if (typeof start !== 'number' && typeof start !== 'string') return;
    const key = String(tf ?? '?');
    const arr = census.buckets[key] = census.buckets[key] || [];
    if (!arr.includes(start)) {
      arr.push(start);
      if (arr.length > MAX_BUCKETS) arr.shift();
    }
  };

  const record = (rec) => {
    if (rec.ev === 'open') {
      census.connects++;
      conns.set(rec.id, { kind: rec.kind, openedAt: rec.at, frames: 0, w: null });
      // One window per connection, so a seed burst can be told from ordinary churn
      // by its true/false composition rather than by its size alone.
      const w = { kind: rec.kind, at: rec.at, ms: 0, frames: 0, on: 0, off: 0, self: false, closed: false };
      census.windows.push(w);
      if (census.windows.length > MAX_WINDOWS) census.windows.shift();
      conns.get(rec.id).w = w;
      touch();
      return;
    }
    if (rec.ev === 'close') {
      const c = conns.get(rec.id);
      if (c?.w) { c.w.closed = true; c.w.ms = rec.at - c.openedAt; }
      conns.delete(rec.id);
      touch();
      return;
    }
    if (rec.ev !== 'frame') return;

    const conn = conns.get(rec.id);
    if (conn) conn.frames++;
    census.frames++;
    noteArrival(`${rec.kind}/${rec.type ?? '(untyped)'}`, rec.at);

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
      // The whole reason the tool exists: an unrecognised type's sample is the only
      // way to learn what it carries. Already credential-scrubbed by the tap, and
      // person-scrubbed here — see personScrub for why the value is dropped but the
      // key and its type are kept.
      try {
        entry.samples.push(JSON.stringify(personScrub(rec.data)).slice(0, SAMPLE_CHARS));
      } catch { /* unserialisable */ }
    }

    // Allowlisted values. Everything below routes through recordValue/recordBucket.
    if (type === 'quote') recordValue('quote', 'game_time', rec.data?.game_time, rec.at);
    if (type === 'candle_update') {
      recordValue('candle_update', 'timeframe', rec.data?.timeframe, rec.at);
      recordBucket(rec.data?.timeframe, rec.data?.bucket_start);
    }

    if (kind === 'chat') {
      if (type === 'presence') {
        census.presenceTotal++;
        const on = rec.data?.online;
        recordValue('presence', 'online', on, rec.at);
        // `who` is compared and then discarded. It is never stored, never counted
        // per-user, and never leaves this block — the only thing that survives is
        // the boolean `self` on the window.
        const who = rec.data?.username;
        const isSelf = !!census.selfName && who === census.selfName;
        if (isSelf) census.selfInPresence = true;
        if (conn?.w && rec.at - conn.openedAt <= SEED_WINDOW_MS) {
          conn.w.frames++;
          if (on === true) conn.w.on++;
          else if (on === false) conn.w.off++;
          if (isSelf) conn.w.self = true;
        }
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

  // ---- the seeding verdict, rebuilt for 0.2.0 -----------------------------
  //
  // 0.1.x asked "were there >= 3 presence frames within 10s of a connect?" and
  // called yes a seed. That was wrong twice over: three ordinary transitions
  // landing near a connect look identical, and the panel told the operator to
  // reload repeatedly — which is exactly what produces clustered transitions. The
  // detector measured the instruction.
  //
  // With `online` on the allowlist there is a real discriminator. A roster seed is
  // the server saying who IS here: every frame in it should be online:true. Churn
  // is a mix. So the signature is composition, not size, and one clean window is
  // worth more than any number of ambiguous ones.
  //
  // A window is only judged once its 10s have actually elapsed.
  const ripe = (w) => w.closed || (Date.now() - w.at) > SEED_WINDOW_MS;
  const chatWindows = () => census.windows.filter((w) => w.kind === 'chat' && ripe(w));

  const seedVerdict = () => {
    const ws = chatWindows();
    if (!ws.length) return { state: 'open', text: 'no chat connection observed yet' };

    const seedLike = ws.filter((w) => w.on >= 2 && w.off === 0);
    const mixed = ws.filter((w) => w.off > 0);
    const quiet = ws.filter((w) => w.frames === 0);

    if (seedLike.length >= 2) {
      const sizes = seedLike.map((w) => w.on);
      const withSelf = seedLike.filter((w) => w.self).length;
      return {
        state: 'done',
        text: `SEEDED — ${seedLike.length} connects opened with an all-online burst `
          + `(sizes ${sizes.join(', ')}), no offline edge among them`
          + (withSelf ? `; ${withSelf} included you` : ''),
      };
    }
    if (quiet.length >= 3 && census.presenceTotal > 0) {
      return {
        state: 'done',
        text: `NOT SEEDED — ${quiet.length} connects opened with no presence frame at all, `
          + `on a session that saw ${census.presenceTotal} elsewhere`,
      };
    }
    const parts = [`${ws.length} chat connects`];
    if (seedLike.length) parts.push(`${seedLike.length} all-online (need 2)`);
    if (mixed.length) parts.push(`${mixed.length} mixed — not a seed`);
    if (quiet.length) parts.push(`${quiet.length} silent (need 3)`);
    return { state: 'open', text: parts.join(' · ') };
  };

  // ---- the game-clock rate, from quote.game_time --------------------------
  //
  // Two (localMs, game_time) pairs give game-seconds per real second directly.
  // docs/06 puts the game clock at ~52.14 from /api/time; this is an independent
  // handle on the same number that costs no request. A wildly different figure
  // means game_time is not what it looks like.
  const clockRate = () => {
    const s = (census.clock || []).filter((x) => typeof x.g === 'number');
    if (s.length < 2) return null;
    const a = s[0], b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt < 30) return null;   // too short a baseline to mean anything
    return { rate: (b.g - a.g) / dt, span: dt, n: s.length };
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
      probe: seedVerdict,
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
      id: 'clock', blocking: true,
      q: 'What is quote.game_time, and does it run at the game clock rate?',
      probe: () => {
        if (census.clockType === null) return { state: 'open', text: 'visit the stocks screen (needs 2 quotes, 30s apart)' };
        if (census.clockType !== 'number') {
          return { state: 'done', text: `it is a ${census.clockType}, not a number — arithmetic is off the table` };
        }
        const r = clockRate();
        if (!r) {
          const n = (census.clock || []).length;
          return { state: 'open', text: `${n} sample${n === 1 ? '' : 's'} — need 2 spanning 30s+ on the stocks screen` };
        }
        // docs/06 has the game clock at ~52.14 game-seconds per real second.
        const near = Math.abs(r.rate - 52.14) < 2;
        return {
          state: 'done',
          text: `${r.rate.toFixed(2)} game-sec/real-sec over ${Math.round(r.span)}s `
            + `(${r.n} samples) — ${near ? 'matches the ~52.14 in docs/06' : 'does NOT match ~52.14; worth a look'}`,
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

  // A findings report, ready to paste into docs/09-socket-surface.md. The whole point of
  // this tool is the handover at the end of its life, so that step should not need a
  // console incantation.
  const report = () => {
    const L = [];
    L.push(`# ws-watch findings — ${new Date().toISOString()}`);
    L.push('');
    L.push(`${census.frames} frames · ${census.connects} connections · observed ${fmtDur(census.observedMs)}`);
    L.push(retired() ? 'Every blocking question is settled.' : 'Still accumulating.');
    L.push('');
    L.push('## Questions');
    for (const a of answers()) {
      L.push(`- [${a.state === 'done' ? 'x' : ' '}] ${a.q}${a.blocking ? '' : '  (bonus)'}`);
      L.push(`      ${a.text}`);
    }

    const unk = unknownList();
    L.push('');
    L.push('## Frame types the client has no case for');
    if (!unk.length) L.push('(none seen)');
    for (const u of unk) {
      L.push(`### ${u.kind}/${u.type} ×${u.n}`);
      for (const s of u.samples) L.push(`    ${s}`);
    }

    L.push('');
    L.push('## Frame shapes seen (key names only)');
    for (const kind of Object.keys(census.types)) {
      for (const [type, e] of Object.entries(census.types[kind]).sort((a, b) => b[1].n - a[1].n)) {
        const keys = Object.keys(e.keys).filter((k) => k !== 'type').sort();
        L.push(`- ${kind}/${type} ×${e.n} — ${keys.join(' ')}`);
      }
    }

    L.push('');
    L.push('## Inter-arrival (gap between consecutive frames of a type)');
    const arr = Object.entries(census.arrivals).sort((a, b) => b[1].n - a[1].n);
    if (!arr.length) L.push('(nothing yet)');
    for (const [key, a] of arr) {
      const b = Object.entries(a.buckets).map(([k, v]) => `${k}:${v}`).join(' ');
      L.push(`- ${key} ×${a.n} — ${b || '(single frame, no gap)'}`);
    }

    L.push('');
    L.push('## Connection windows (first 10s of each connection)');
    L.push('Seed signature is all-online with no offline edge. A mix is ordinary churn.');
    const ws = census.windows.filter((w) => w.kind === 'chat');
    if (!ws.length) L.push('(no chat connection recorded)');
    for (const w of ws) {
      L.push(`- chat +${Math.round((w.at - census.startedAt) / 1000)}s — `
        + `presence ${w.frames} (online ${w.on}, offline ${w.off})`
        + `${w.self ? ', included you' : ''}${w.closed ? '' : ', still open'}`);
    }
    L.push(`all-time presence edges: online ${census.presenceOn}, offline ${census.presenceOff}`
      + ` (of ${census.presenceTotal} frames; values only recorded from 0.2.0 onward)`);

    L.push('');
    L.push('## quote.game_time');
    if (!census.clock?.length) {
      L.push(`(no samples — type seen: ${census.clockType ?? 'none'})`);
    } else {
      const r = clockRate();
      L.push(`type: ${census.clockType}, ${census.clock.length} samples retained`);
      L.push(r ? `implied rate: ${r.rate.toFixed(3)} game-sec per real-sec over ${Math.round(r.span)}s`
        : 'baseline too short for a rate (need 2 samples 30s+ apart)');
      L.push('```');
      for (const c of census.clock) L.push(`${new Date(c.t).toISOString()}  ${c.g}`);
      L.push('```');
    }

    L.push('');
    L.push('## candle_update timeframes and bucket_start');
    const tf = Object.entries(census.timeframes);
    L.push(tf.length ? tf.map(([k, v]) => `${k} ×${v}`).join(', ') : '(none seen)');
    for (const [k, v] of Object.entries(census.buckets)) {
      L.push(`- ${k}: ${v.join(', ')}`);
    }

    L.push('');
    L.push('## Raw census');
    L.push('```json');
    L.push(JSON.stringify(census, null, 1));
    L.push('```');
    return L.join('\n');
  };

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
    /* Slot 7 of the kit's home row. Corner allocation used to live here — this
       tool owned top-right, because time-watch had top-left, align-watch had
       bottom-left, and the game's own Comms dock is fixed bottom-right
       (right: 20px, bottom: 0, 320x420). FAB KIT v3 ended the negotiation: every
       button starts in the row above the game's header rule, and the dock corner
       is nobody's. Drag it anywhere; it remembers, and double-clicking it here
       gives the slot back. */
    .pkws-fab { --pk-slot: 7; z-index: 2147482000; }
    .pkws-fab.pkws-done { border-color: #34d399; color: #34d399; }
    .pkws-panel { position: fixed; right: 12px; top: 52px; z-index: 2147482000;
      width: min(380px, calc(100vw - 24px)); max-height: 74vh;
      display: flex; flex-direction: column; border: 1px solid #3f3f46;
      border-radius: 8px; background: #09090bf2; color: #e4e4e7;
      font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .pkws-head { display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 7px 12px; border-bottom: 1px solid #27272a; user-select: none;
      font-size: 11px; color: #a1a1aa; text-transform: uppercase; letter-spacing: .08em; }
    .pkws-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 12px; }
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
  let drag = null, fabDrag = null, resize = null;
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

    // --- connection windows: the seeding evidence, shown rather than summarised ---
    const cw = census.windows.filter((w) => w.kind === 'chat');
    if (cw.length) {
      body.append(el('h1', null, 'chat connects — first 10s'));
      const t = el('table', 'pkws-table');
      for (const w of cw.slice(-8)) {
        const tr = document.createElement('tr');
        tr.append(el('td', null, `+${fmtDur(w.at - census.startedAt)}`));
        tr.append(el('td', w.off === 0 && w.on >= 2 ? 'pkws-ok' : 'pkws-dim',
          w.frames ? `${w.on} on / ${w.off} off` : 'silent'));
        tr.append(el('td', 'pkws-quiet', w.self ? 'incl. you' : ''));
        t.append(tr);
      }
      body.append(t);
      body.append(el('div', 'pkws-quiet',
        `all-time edges: ${census.presenceOn} online / ${census.presenceOff} offline`));
    }

    // --- the clock samples ---
    if (census.clockType !== null) {
      body.append(el('h1', null, 'quote.game_time'));
      const r = clockRate();
      body.append(el('div', null, r
        ? `${r.rate.toFixed(2)} game-sec/real-sec (${r.n} samples, ${Math.round(r.span)}s)`
        : `${(census.clock || []).length} sample(s), type ${census.clockType} — need 2 spanning 30s+`));
    }

    body.append(el('div', 'pkws-note',
      'Reads frames the game already received. Opens nothing, transmits nothing, '
      + 'adds zero requests. Records key names, counts and timings, plus four named '
      + 'values (game_time, bucket_start, timeframe, and online as a true/false count). '
      + 'Never a username, never a message body — except in an unrecognised-frame sample.'));

    if (drag) drag.fit();
  };

  // ===========================================================================
  // 5. PANEL KIT v2 — shared verbatim block.
  //
  //    Repo convention: every panel we ship is draggable and resizable, and
  //    remembers both. Copy this block into a new tool exactly as it stands. If
  //    you have to change it, bump the version in this header and in every tool
  //    carrying a copy, so the copies can be diffed. No build step, no @require,
  //    so each script stays a single auditable file (clause 6).
  //
  //    draggable(node, handle, onMove) -> { apply(pos), reset(), dragged() }
  //      node    the element that moves (must be position: fixed)
  //      handle  the grab area; buttons/inputs inside it stay clickable, unless
  //              the handle IS the control (a bare FAB drags from itself)
  //      onMove  called with {x, y} in viewport px, or null when reset
  //      dragged() is true if the last gesture actually moved — check it in a
  //              click handler so dragging a FAB doesn't also toggle it
  //      pin() converts a CSS-corner anchor into left/top without moving the
  //              element — resizable() needs that, see below
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
  // 6. Boot
  // ---------------------------------------------------------------------------
  const persistUi = (patch) => { Object.assign(ui, patch); save(K.ui, ui); };

  const mount = () => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    fab = el('button', 'pk-fab pkws-fab', 'SOCK');
    fab.title = 'ws-watch';
    document.body.append(fab);

    panel = el('div', 'pkws-panel');
    const head = el('div', 'pkws-head');
    head.append(el('span', null, 'ws-watch'));
    const btns = el('span');

    const copy = el('button', 'pkws-btn', 'copy findings');
    copy.title = 'copy a pasteable report of everything recorded so far';
    copy.addEventListener('click', () => {
      const text = report();
      const done = () => { copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy findings'; }, 1500); };
      const failed = () => { copy.textContent = 'copy failed'; setTimeout(() => { copy.textContent = 'copy findings'; }, 1500); };
      try {
        navigator.clipboard.writeText(text).then(done, failed);
      } catch { failed(); }
    });

    const forget = el('button', 'pkws-btn', 'forget');
    forget.style.marginLeft = '5px';
    // Destructive and adjacent to the copy button, so make it a two-step.
    let armed = false;
    forget.title = 'discard everything recorded and start the census over';
    forget.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        forget.textContent = 'sure?';
        setTimeout(() => { armed = false; forget.textContent = 'forget'; }, 3000);
        return;
      }
      armed = false;
      forget.textContent = 'forget';
      census = blank();
      save(K.census, census);
      render();
    });
    const hide = el('button', 'pkws-btn', '×');
    hide.style.marginLeft = '5px';
    hide.addEventListener('click', () => setOpen(false));
    btns.append(copy, forget, hide);
    head.append(btns);

    body = el('div', 'pkws-body');
    panel.append(head, body);
    document.body.append(panel);

    drag = draggable(panel, head, (pos) => persistUi(pos ?? { x: null, y: null }));
    drag.apply(ui);
    resize = resizable(panel, (size) => persistUi({ size: size ?? undefined }),
      { drag, minW: 280, minH: 160 });
    // Double-click the header undoes both — the recovery path for a panel dragged
    // or resized into uselessness.
    head.addEventListener('dblclick', () => { drag.reset(); resize.reset(); });

    fabDrag = draggable(fab, fab, (pos) => persistUi({ fab: pos }));
    fabDrag.apply(ui.fab);
    fab.addEventListener('click', () => { if (!fabDrag.dragged()) setOpen(!ui.open); });
    // Double-click puts it back in the row. reset() drops the stored position AND
    // clears the inline left/top, which is the only thing that lets the kit's rule
    // apply again — see FAB KIT v4.
    fab.addEventListener('dblclick', () => { persistUi({ fab: null }); fabDrag.reset(); });

    setOpen(ui.open !== false);
    // A panel that mounted while the window was small can land with its handle off
    // screen, which is unrecoverable. fit() after the first paint, and after every
    // render that changes the height.
    requestAnimationFrame(() => { drag.fit(); fabDrag.fit(); });
  };

  const setOpen = (open) => {
    persistUi({ open });
    if (panel) panel.style.display = open ? 'flex' : 'none';
    if (fab) fab.classList.toggle('pk-open', open);   // the button says which window is up
    // display:none has no geometry for the kit to measure, so the stored size is
    // restored here rather than at mount.
    if (open) { resize.apply(ui.size); render(); }
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
