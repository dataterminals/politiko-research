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
 * passes through it — the tap silently sees nothing.
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

  // ---------------------------------------------------------------------------
  // 2. SPA lifecycle — React Router means no page loads. Re-mount on route change
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
  // 3. PANEL KIT v1 — shared verbatim block.
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
  // 4. Boot
  // ---------------------------------------------------------------------------
  const boot = () => {
    log('ready');
    checkRoute();
    onApiResponse(({ url, data }) => log('api', url, data));

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
