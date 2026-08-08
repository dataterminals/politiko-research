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

  // ---------------------------------------------------------------------------
  // 1. Passive tap — observe responses the app requested on its own.
  //    This ADDS NO REQUESTS. It only reads what was already in flight.
  // ---------------------------------------------------------------------------
  const listeners = new Set();
  /** @param {(info: {url: string, status: number, data: any}) => void} fn */
  const onApiResponse = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      if (url.includes('/api/') && res.headers.get('content-type')?.includes('json')) {
        // clone so the app's own consumer still gets an unread body
        res.clone().json().then(
          (data) => listeners.forEach((fn) => { try { fn({ url, status: res.status, data }); } catch (e) { log('listener error', e); } }),
          () => {},
        );
      }
    } catch (e) { log('tap error', e); }
    return res;
  };

  // ===========================================================================
  // 2. WS TAP v1 — shared verbatim block. DELETE IT if your tool has no use for
  //    socket frames; keep it byte-identical if it does.
  //
  //    Same convention as PANEL KIT: copy as-is, and if you must change it, bump
  //    the version here and in every tool carrying a copy so they can be diffed.
  //
  //    The game opens two sockets of its own — /ws/chat on every authenticated
  //    route, /ws/market while you are on the stocks screen. Reading frames off
  //    them adds no request at all. See docs/09-socket-surface.md for the protocol
  //    and for why this block is shaped the way it is.
  //
  //    onSocketFrame(fn) -> unsubscribe
  //      fn receives a frozen plain record and nothing else:
  //        { id, kind, safeUrl, ev:'open'|'close', at, [code, wasClean] }
  //        { id, kind, safeUrl, ev:'frame', at, type, data }
  //      kind is 'chat' | 'market' | 'other'; id is an opaque per-connection
  //      counter, so a reconnect is distinguishable from the connection it replaced.
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
  //       or the connection URL. The URL carries an access token in its query
  //       string; this keeps origin + pathname and drops the rest whole, in the
  //       constructor, before anything else can read it. Allowlist, not denylist,
  //       so a future credential parameter is dropped automatically.
  //
  //    c) It holds no reference to any connection — not even a WeakMap. Reconnects
  //       leave nothing behind.
  //
  //    Ship it with tools/test-passive.js, which fails the build if a transmitting
  //    token ever reappears in the file.
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

    // Deep-copy into frozen plain data, replacing credential-looking VALUES on the
    // way — key names survive, so "does this frame carry a token field?" stays an
    // answerable question.
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
  // 4. PANEL KIT v1 — shared verbatim block.
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
  // 5. Boot
  // ---------------------------------------------------------------------------
  const boot = () => {
    log('ready');
    checkRoute();
    onApiResponse(({ url, data }) => log('api', url, data));
    onSocketFrame((rec) => log('ws', rec.kind, rec.ev, rec.type ?? ''));

    // Panel skeleton the kit expects: a fixed container, a header that drags it,
    // and a body you re-render. Persist {x,y} yourself — the kit only reports it.
    //
    //   const ui = JSON.parse(localStorage.getItem('pkxx:ui') || '{}');
    //   const drag = draggable(panel, header, (pos) => {
    //     Object.assign(ui, pos ?? { x: null, y: null });
    //     localStorage.setItem('pkxx:ui', JSON.stringify(ui));
    //   });
    //   drag.apply(ui);                                  // restore on mount
    //   header.addEventListener('dblclick', drag.reset); // back to the corner
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
