// ==UserScript==
// @name         Politiko — Comms Move
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  Adds a drag bar to the game's Comms dock so you can put it somewhere other than the bottom-right corner, and remembers where. Touches the DOM of the page you are on and nothing else — no network, no data, no storage beyond the position.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/comms-move.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/comms-move.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    the DOM of the page you are looking at, and only enough of it to find
 *             the Comms dock: the element with class `ch-overlay`. It does not read
 *             messages, names, or anything else inside the dock, and it installs no
 *             network tap of any kind — this script does not touch `fetch`.
 *   Sends:    nothing, to anyone
 *   Requests: ZERO. This script has no network code in it at all.
 *   Storage:  one localStorage key, `pkcm:pos` — the dock's position, or nothing
 *             if you have not moved it
 *   Alerts:   none
 *   Changes:  it inserts one drag bar above the dock and, once you drag it, sets
 *             inline left/top on the dock. Nothing the game renders is removed or
 *             rewritten, and no game behaviour is intercepted. Double-click the drag
 *             bar to hand every one of those styles back.
 *
 * This is the most conservative thing in the repo: presentation only, over a page you
 * manually loaded and are actively viewing. See docs/01-rules-envelope.md.
 *
 * ONE BEHAVIOUR CHANGE WORTH KNOWING: the game shifts the dock to the left edge on its
 * own while a store drawer is open (`body.store-drawer-open .ch-overlay`). An inline
 * position beats that rule, so once you park the dock it stops making way for the
 * drawer. Double-clicking the drag bar restores the game's own behaviour exactly.
 */

(() => {
  'use strict';

  const TAG = '[pk-comms-move]';
  const log = (...a) => console.debug(TAG, ...a);
  const KEY = 'pkcm:pos';

  // The dock's class names are hand-written in the game's own stylesheet, not generated
  // by the bundler, so unlike a chunk hash they are safe to match on:
  //   .ch-overlay   fixed, bottom: 0, right: 20px, width: 320px  ← the positioned box
  //     .ch-panel     the bordered dock itself, 420px tall (auto when collapsed)
  //       .ch-header  "Comms", 36px, click toggles collapsed
  const DOCK = '.ch-overlay';

  const readPos = () => {
    try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; }
    catch (e) { log('read fail', e); return null; }
  };
  const writePos = (p) => {
    try { p ? localStorage.setItem(KEY, JSON.stringify(p)) : localStorage.removeItem(KEY); }
    catch (e) { log('write fail', e); }
  };

  // ===========================================================================
  // PANEL KIT v1 — shared verbatim block, see userscripts/_template.user.js.
  // Every panel this repo ships is draggable and remembers where you put it.
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
  // ===================== end PANEL KIT v1 ====================================

  const CSS = `
    .pkcm-grip {
      display: flex; align-items: center; gap: 6px;
      height: 18px; padding: 0 8px;
      background: #111116; border: 1px solid #36363f; border-bottom: 0;
      color: #52525b; font: 500 9px/1 'Geist Mono', ui-monospace, monospace;
      letter-spacing: .18em; text-transform: uppercase;
      user-select: none; cursor: grab;
    }
    .pkcm-grip:hover { color: #a1a1aa; }
    .pkcm-grip .dots { letter-spacing: 0; font-size: 11px; }
    .pkcm-grip .hint { margin-left: auto; opacity: 0; transition: opacity .15s; }
    .pkcm-grip:hover .hint { opacity: 1; }
  `;

  let dock = null, grip = null, drag = null;

  const buildGrip = () => {
    const g = document.createElement('div');
    g.className = 'pkcm-grip';
    g.title = 'Drag to move the Comms dock · double-click to put it back';
    g.innerHTML = '<span class="dots">⠿</span><span>comms</span>'
      + '<span class="hint">double-click to reset</span>';
    return g;
  };

  /**
   * The dock is React-rendered: collapsing it, opening a DM, or changing route can
   * replace its children. Our grip is not one of React's nodes, so it survives most
   * re-renders — but if a reconcile ever drops it, put it back rather than leaving a
   * dock nobody can move.
   */
  const ensureGrip = () => {
    if (!dock || !grip) return;
    if (grip.parentNode === dock && dock.firstChild === grip) return;
    dock.insertBefore(grip, dock.firstChild);
    log('grip re-attached');
  };

  const attach = (el) => {
    if (dock === el) return;
    dock = el;

    // the dock animates `right`/`left` for the store drawer; that fights a drag
    dock.style.transition = 'none';

    grip = buildGrip();
    dock.insertBefore(grip, dock.firstChild);

    drag = draggable(dock, grip, (pos) => {
      writePos(pos);
      if (!pos) dock.style.transition = ''; // reset: hand the animation back too
      else dock.style.transition = 'none';
    });
    drag.apply(readPos());
    drag.fit();
    grip.addEventListener('dblclick', () => drag.reset());

    log('attached to the Comms dock');
  };

  // ---------------------------------------------------------------------------
  // Boot — the dock mounts whenever the chat client does, which is after login and
  // after the route settles, so watch for it rather than assuming it is there.
  // ---------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = CSS;

  const scan = () => {
    const el = document.querySelector(DOCK);
    if (el && el !== dock) { attach(el); return; }
    if (!el) return;
    ensureGrip();
    drag?.fit(); // expanding a collapsed dock makes it taller; keep the bar reachable
  };

  const boot = () => {
    document.documentElement.append(style);
    scan();
    // childList across the whole tree: the dock is mounted and unmounted by React,
    // and this is the only way to notice. Cheap — it does nothing until it matches.
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    log('watching for the Comms dock');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
