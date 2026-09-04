// ==UserScript==
// @name         Politiko — <TOOL NAME>
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  <one line — state plainly what it reads and what it shows; clause 6 requires full disclosure>
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/<NAME>.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/<NAME>.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * `@grant none` above is load-bearing, not a leftover default. Under any other grant
 * both Tampermonkey and Violentmonkey hand the script a sandboxed `window`, so the
 * fetch wrap below patches the sandbox's fetch and the page's real traffic never
 * passes through it — the tap silently sees nothing. The same applies to the
 * WebSocket wrap, and bites harder there: a socket can be legitimately quiet for
 * minutes, so a broken tap and an idle one look identical for a long time. Give any
 * socket tool a visible frame counter so a persistent zero is the tell.
 *
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    <what, from where — DOM of the page you are viewing / responses the app
 *             already requested / the client's own query cache>
 *   Sends:    nothing, to anyone
 *   Requests: ZERO additional requests to politiko.io
 *   Storage:  <localStorage keys, or "none">
 *
 * Design rule for this repo: consume, don't request. This script must never originate
 * a network call to Politiko, never touch a page you aren't actively viewing, and never
 * raise an alert from an unfocused tab. See docs/01-rules-envelope.md.
 */

(() => {
  'use strict';

  const TAG = '[politiko-tool]';
  const log = (...a) => console.debug(TAG, ...a);

  // ===========================================================================
  // 1. HTTP TAP v1 — shared verbatim block. Copy it as-is into any tool that
  //    reads API responses, and if you must change it, bump the version here and
  //    in every tool carrying a copy so they can be diffed. Same convention as
  //    PANEL KIT and FAB KIT, and tools/test-placement.js md5s the copies.
  //
  //    This ADDS NO REQUESTS. It only reads what the app already had in flight.
  //
  //    onApi(prefix, fn) -> unsubscribe
  //      prefix is a pathname prefix ('/api/government'), an array of them, or
  //      the string '*' for every API response. fn receives a frozen record:
  //        { url, path, method, status, ok, body, data }
  //      `url` is the request URL untouched, so a tool that needs `?page=3` can
  //      still read it; `path` is the pathname alone, which is what prefixes
  //      match against. `data` is the parsed JSON body, or null if the response
  //      was not JSON. `body` is the REQUEST body and only ever a string.
  //
  //    WHY THIS IS A SHARED BLOCK AND NOT A PRIVATE WRAPPER PER TOOL:
  //
  //    Eleven tools each installing their own window.fetch wrapper is eleven
  //    nested layers on every response, and nine of them cloned and parsed every
  //    /api/ body before checking whether they wanted it — so one /user/status,
  //    which arrives every 10s on every authenticated route, was teed and parsed
  //    nine times to be discarded eight. The app is built with no QueryClient
  //    defaultOptions, so TanStack's refetchOnWindowFocus default holds and every
  //    alt-tab back re-fires every mounted query at once; that multiplier landed
  //    on all of it simultaneously. One tap, one clone, one parse, delivered only
  //    to the tools that asked for the path.
  //
  //    FOUR THINGS THAT ARE NOT STYLE CHOICES:
  //
  //    a) First copy wins. Load order between userscripts is not guaranteed by
  //       any manager, so every copy must be able to be the installer and every
  //       other copy must find the one already there. A half-migrated install —
  //       some tools on the block, some still carrying a private wrapper — is
  //       exactly as correct as before, just less improved, which is what makes
  //       the migration safe to do a tool at a time.
  //
  //    b) Nothing is cloned or parsed until a subscriber has asked for the path.
  //       The prefix registry is the entire point; a '*' subscriber opts back
  //       into the old cost and should be rare.
  //
  //    c) The parsed body is frozen once and the SAME object is handed to every
  //       subscriber. Nine private parses used to make mutation harmless; sharing
  //       does not, so the freeze is what keeps one tool from editing another
  //       tool's view of a response. Unlike WS TAP's clean(), nothing here is
  //       truncated or redacted: these payloads are already consumed whole by the
  //       tools today, and a depth cap would silently change what they see.
  //
  //    d) The request is never touched. A Request object is not drained — only an
  //       already-materialised string body is carried, which is the constraint
  //       align-watch and poll-watch held privately before this block existed.
  //       The tap does not retry, does not re-issue, and originates nothing.
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
  // 2. WS TAP v2 — shared verbatim block. DELETE IT if your tool has no use for
  //    socket frames; keep it byte-identical if it does.
  //
  //    Same convention as PANEL KIT: copy as-is, and if you must change it, bump
  //    the version here and in every tool carrying a copy so they can be diffed.
  //
  //    The game opens three sockets of its own — /ws/chat on every authenticated
  //    route, /ws/market while you are on the stocks screen, and /ws/casino/poker
  //    while you are sat at a poker table. Reading frames off them adds no request
  //    at all. See docs/09-socket-surface.md for the protocol and for why this
  //    block is shaped the way it is.
  //
  //    onSocketFrame(fn) -> unsubscribe
  //      fn receives a frozen plain record and nothing else:
  //        { id, kind, safeUrl, ev:'open'|'close', at, [code, wasClean] }
  //        { id, kind, safeUrl, ev:'frame', at, type, data }
  //      kind is 'chat' | 'market' | 'casino' | 'other'; id is an opaque
  //      per-connection counter, so a reconnect is distinguishable from the
  //      connection it replaced.
  //
  //    THREE THINGS THAT ARE NOT STYLE CHOICES:
  //
  //    a) It is a SUBCLASS, not a function wrapper or a Proxy. The game reads
  //       `WebSocket.OPEN` in six places; a plain function loses the static and
  //       breaks the game outright. The game also assigns .onmessage as a property
  //       rather than calling addEventListener, so there is nothing to intercept —
  //       we register as a peer instead, which also means a fault here cannot break
  //       the game's chat.
  //
  //    b) Nothing hands out a socket, a MessageEvent (its .target is the socket),
  //       or EITHER constructor argument. Both of them carry credentials, and not
  //       in the same place: /ws/chat and /ws/market put the access token in the
  //       URL query string, while /ws/casino/poker puts it in `protocols`, as an
  //       `auth.<token>` entry. The URL is cut to origin + pathname in the
  //       constructor before anything else can read it — allowlist, not denylist,
  //       so a future credential parameter is dropped automatically. `protocols`
  //       is never read at all: it is forwarded to the base constructor and other-
  //       wise untouched, which is the only handling that stays correct if a fourth
  //       socket invents a fourth place to put a token. Note the fence in
  //       tools/test-passive.js counts the literal text of that call, so do not
  //       name it in prose here either.
  //
  //    c) It holds no reference to any connection — not even a WeakMap. Reconnects
  //       leave nothing behind.
  //
  //    Ship it with tools/test-passive.js, which fails the build if a transmitting
  //    token ever reappears in the file.
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
  // 3. SPA lifecycle — React Router means no page loads. Re-mount on route change
  //    and always clean up after yourself.
  // ---------------------------------------------------------------------------
  let lastPath = null;
  let teardown = () => {};

  const onRoute = (path) => {
    log('route', path);
    teardown();
    teardown = () => {};

    // if (path.startsWith('/market')) teardown = mountMarketOverlay();
  };

  const checkRoute = () => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      onRoute(lastPath);
    }
  };

  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) { const r = orig.apply(this, a); queueMicrotask(checkRoute); return r; };
  }
  window.addEventListener('popstate', checkRoute);

  // ===========================================================================
  // 4. PANEL KIT v2 — shared verbatim block.
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

  // ===========================================================================
  // 5. FAB KIT v7 — shared verbatim block.
  //
  //    The toggle button, and the one piece of this repo a player sees before
  //    they open anything. Sixteen tools can be on screen at once, so the button
  //    is a set piece rather than each tool's own flourish: paste FAB_CSS into your
  //    stylesheet as it stands, put `pk-fab` on the element, and put ONE three-
  //    or four-letter word inside it. Same rule as PANEL KIT — if the block has
  //    to change, bump the version in this header and in every tool carrying a
  //    copy, so the copies can be diffed. tools/test-placement.js hashes them.
  //
  //    v3 also decides WHERE the button starts, which used to be the tool's own
  //    business and was the last thing keeping the set from reading as a set:
  //    every button now defaults to one slot of one row across the band above the
  //    game's header rule. Your rule declares `--pk-slot` and nothing else about
  //    position — see the block for the slot table and the three numbers that
  //    place the row.
  //
  //    v4 widened that row from eleven slots to thirteen, v5 widened it to
  //    fourteen for bar-watch, v6 to fifteen for slot-watch, and v7 to sixteen for
  //    jack-watch. Half the row is a number CSS cannot count for itself, so it is
  //    written out — and a version bump is what adding a slot costs, every time.
  //    Read the third number in the block as the row's declared CAPACITY rather
  //    than a tally of what is installed: a tool you do not have leaves its slot
  //    empty and the row stays where it is.
  //
  //    The button also has to say whether ITS window is the one already open, so
  //    wire `pk-open` at the single place your tool writes the panel's display —
  //    `fab.classList.toggle('pk-open', ui.open)`, above any `if (!ui.open)
  //    return`, so closing still reaches it. toggle() with the second argument,
  //    never `className =`: rebuilding the className drops `pk-fab` and takes
  //    the whole box with it. test-placement.js checks for both.
  //
  //    Pick the word the way you would pick a stock ticker: ALGN, MKT, RAID,
  //    SLP, JUMP, SOCK, TIME, WRLD, XP, POLL, SHOP, BARS, SLOT, JACK. No emoji —
  //    a 15px glyph is a coin toss across fonts and platforms, and four of them
  //    tell you nothing about which is which. people-watch is the single
  //    exception, and it is grandfathered: the eye of providence is its mark,
  //    and `.pk-fab svg` sizes it inside the same square as everyone else's
  //    letters.
  //
  //    Your rule goes AFTER the block, same specificity, and carries only what
  //    is actually yours: your slot in the row, your z-index, and any state
  //    colour. No inset — top/left/right/bottom belong to the kit now, and
  //    test-placement.js fails the build if a tool takes one back.
  //
  //      .pkxx-fab { --pk-slot: 16; z-index: 2147482000; }
  //
  //    Tools that also do their own placement maths (defaultFabPos, clampFab)
  //    keep CFG.FAB_SIZE at 38 to match the box below, and have to compute the
  //    same row in JS — the kit's CSS never gets a say once something writes
  //    left/top inline. test-placement.js checks the two against each other.
  // ===========================================================================
  const FAB_CSS = `
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
  `;

  // ---------------------------------------------------------------------------
  // 6. Boot
  // ---------------------------------------------------------------------------
  const boot = () => {
    log('ready');
    checkRoute();
    // Ask for the paths this tool actually reads, never '*' unless it genuinely
    // needs every response — the prefix is what keeps the shared tap cheap.
    onApi(['/api/user/status', '/api/time'], ({ path, data }) => log('api', path, data));
    onSocketFrame((rec) => log('ws', rec.kind, rec.ev, rec.type ?? ''));

    // The button: one element, class `pk-fab`, one word. draggable() takes it as
    // both node and handle — a bare FAB drags from itself — and dragged() is what
    // stops a drag from also toggling the panel.
    //
    //   const fab = document.createElement('button');
    //   fab.className = 'pk-fab';        // plus your own class, for the slot
    //   fab.textContent = 'WORD';
    //   const fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; save(); });
    //   fabDrag.apply(ui.fab);
    //   fab.addEventListener('click', () => { if (!fabDrag.dragged()) toggle(); });
    //   fab.addEventListener('dblclick', () => { ui.fab = null; save(); fabDrag.reset(); });
    //
    // That last line is not optional. reset() drops the stored position and clears
    // the inline left/top, which is the only thing that lets the CSS rule — and so
    // the home row — apply again; without it a button dragged somewhere awkward has
    // no way back, and the row is only ever true on a fresh profile.
    //
    // …and wherever that toggle writes the panel's display, say so on the button
    // in the same breath, so the two can never disagree:
    //
    //   const sync = () => {
    //     panel.style.display = ui.open ? 'flex' : 'none';
    //     fab.classList.toggle('pk-open', ui.open);   // BEFORE any early return
    //     if (!ui.open) return;
    //     …
    //   };
    //
    // Panel skeleton the kit expects: a fixed container, a header that drags it,
    // and a body you re-render. The body wants `flex: 1 1 auto; min-height: 0` so a
    // chosen height fills instead of leaving dead space under the content. Persist
    // {x,y} and {w,h} yourself — the kit only reports them.
    //
    //   const ui = JSON.parse(localStorage.getItem('pkxx:ui') || '{}');
    //   const drag = draggable(panel, header, (pos) => {
    //     Object.assign(ui, pos ?? { x: null, y: null });
    //     localStorage.setItem('pkxx:ui', JSON.stringify(ui));
    //   });
    //   const size = resizable(panel, (s) => {
    //     ui.size = s;
    //     localStorage.setItem('pkxx:ui', JSON.stringify(ui));
    //   }, { drag, minW: 260, minH: 160 });   // pass `drag` or a grown panel can
    //                                         // push its own handle off screen
    //   drag.apply(ui);                       // restore on mount — or, if the panel
    //   size.apply(ui.size);                  // starts hidden, on first show:
    //                                         // display:none has no geometry
    //   header.addEventListener('dblclick', () => { drag.reset(); size.reset(); });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
