// ==UserScript==
// @name         Politiko — Bar Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.2.0
// @description  Time-to-full for Energy, Juice and HP — the one thing the game's own bars never say. Reads the attribute payload the client already fetched and projects it forward with the client's own arithmetic; adds zero requests. Alerts when a bar reaches a level you set, in the page by default, and optionally in the tab title, the favicon and a tone.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/bar-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/bar-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * `@grant none` is load-bearing, not a leftover default. Under any other grant both
 * Tampermonkey and Violentmonkey hand the script a sandboxed `window`, so the tap below
 * patches the sandbox's fetch and the page's real traffic never passes through it — the
 * tap silently sees nothing and the panel just sits there saying "no reading yet".
 *
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON RESPONSE bodies of two calls the game client itself makes, on every
 *             authenticated route, on pages you are actively viewing. Never a request
 *             body, never a header, never a token.
 *
 *               GET /api/attributes   the three bars: AttributeName, CurrentValue,
 *                                     MaxValue, BaseRegenRate, CustomRegenRate,
 *                                     LastUpdate. The sidebar asks for this every 10s.
 *               GET /api/effects      active effects, so a countdown can say when it is
 *                                     not to be trusted. Only effect_key, effect_type,
 *                                     target_key, value, modifier_type, expires_at and
 *                                     source_item_name are read; nothing else is kept.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. This file contains no call to
 *             fetch or XMLHttpRequest other than the shared tap's single pass-through of
 *             your own traffic. No timer here touches the network. Nothing is scheduled,
 *             retried, prefetched or refreshed, in the foreground or the background.
 *
 *             This is not a compromise in this tool's case, and that is worth being
 *             precise about: `CurrentValue` is the bar's value AT `LastUpdate`, and
 *             everything after it is computed locally from a server timestamp and a
 *             rate — by the game, not by us. A payload from twenty minutes ago yields
 *             exactly the same number as one from this second. There is nothing a
 *             request would buy. See docs/17-attribute-surface.md.
 *
 *   Writes:   nothing to the game. No POST, PUT, PATCH or DELETE shape appears in this
 *             file, and tools/test-bar-passive.js fails the build if one does.
 *
 *   Storage:  localStorage key `pkbw:ui` — panel geometry, which alert channels you
 *             switched on, and the per-bar levels you asked to be told about. No game
 *             data is persisted: every number in the panel comes from the payload
 *             currently in memory and is gone on reload.
 *
 *   Alerts:   FOUR channels, and only the first is on by default.
 *
 *               PAGE  (default ON)   the row lights up, the BARS button goes hot, and a
 *                                    line appears at the top of the panel. Nothing
 *                                    leaves the page you are looking at.
 *               TITLE (default OFF)  prefixes document.title, so the tab strip reads
 *                                    "[E] Politiko" while you are on another tab.
 *               ICON  (default OFF)  swaps the favicon for a coloured dot. Restored the
 *                                    moment the alert clears or the channel is switched
 *                                    off. Drawn as an inline SVG data URI — no canvas is
 *                                    used anywhere in this file, deliberately; see the
 *                                    note on X-CT-Canvas in docs/01-rules-envelope.md.
 *               SOUND (default OFF)  one short two-note tone, synthesised with WebAudio.
 *                                    No audio file is fetched from anywhere.
 *
 *             TITLE, ICON and SOUND can be perceived while this tab is not the one you
 *             are looking at, which is the reason they ship off and behind a switch each
 *             rather than as a default. The rules position on them is argued in full in
 *             docs/01-rules-envelope.md — briefly: this tool extracts nothing from an
 *             unfocused page, because there is nothing to extract. The client's own
 *             polling stops when the tab loses focus (measured), and the projection runs
 *             on a payload captured while you were looking at the page. What crosses the
 *             tab boundary is arithmetic, not data. That is a real distinction and not a
 *             comfortable one to lean on, so it was an explicit operator decision and it
 *             is written down as one.
 *
 *             There is deliberately NO desktop/OS notification, and adding one is not a
 *             gap to be filled later. That is the case docs/01-rules-envelope.md names
 *             outright, and the Notification API does not appear in this file at all.
 *             tools/test-bar-passive.js fails the build if it ever does.
 *
 *   Clipboard: never written.
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 * The measurements behind every constant here: docs/17-attribute-surface.md.
 *
 * WHY THIS TOOL EXISTS AT ALL, GIVEN THE GAME HAS BARS
 *
 * The sidebar shows `value / max`, a ten-pip meter, and a countdown. That countdown is
 * `ds()` — seconds to the NEXT WHOLE POINT — and the client takes the MAXIMUM of it
 * across all three bars and prints that one number on every row. So the game tells you
 * when something ticks, three times, about whichever bar is slowest. It never tells you
 * when a bar is FULL; nothing in the client computes that. Energy at 2/min sitting sixty
 * points short is fifty minutes from full and the sidebar says 0:30.
 *
 * That gap is the whole tool. Everything else here is furniture.
 *
 * WHY THE COUNTDOWN CAN LIE, AND WHAT IT DOES ABOUT IT
 *
 * /api/effects carries `regen_modifier` and `damage_over_time` rows, and radiation is
 * special-cased in the game's own renderer as "HP -1/min, regen paused". Whether the
 * server folds a modifier into CustomRegenRate before sending it is NOT measurable from
 * the client. So this tool does not model effects. It computes exactly what the game
 * computes — `CustomRegenRate ?? BaseRegenRate` — which means it agrees with the sidebar
 * by construction, and it NAMES any active effect that touches a bar next to the
 * countdown that effect might invalidate. A projection that quietly counts down to a
 * full HP bar while radiation drains it would be worse than no projection at all.
 */

(() => {
  'use strict';

  const TAG = '[pk-bar-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { ui: 'pkbw:ui' };

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // ===========================================================================
  // 1. The projection, lifted from the client rather than rederived.
  //
  //    index-AUYATDjW.js 297609 in the 2026-08-03 pull. These are the game's own
  //    `ls`, `us` and `ds`, renamed and otherwise untouched — see
  //    docs/17-attribute-surface.md for the originals side by side.
  //
  //    Copying them is the point. The wiki quotes 6/2/3 per minute for HP, Energy
  //    and Juice, and reimplementing from that would produce a panel that
  //    disagrees with the sidebar the moment anything modifies a rate. Whatever
  //    the server does to `CustomRegenRate`, this arithmetic inherits it.
  // ===========================================================================

  const ORDER = { energy: 0, juice: 1, hp: 2 };          // the sidebar's own sort
  const LABEL = { energy: 'ENERGY', juice: 'JUICE', hp: 'HP' };
  const COLOR = { energy: '#fbbf24', juice: '#0ea5e9', hp: '#f43f5e' };  // the game's
  const MARK  = { energy: 'E', juice: 'J', hp: 'H' };    // one letter, for the tab title

  const anchorOf = (r) => new Date(r.LastUpdate).getTime();
  const rateOf = (r) => r.CustomRegenRate ?? r.BaseRegenRate;   // per MINUTE

  // us(): the value the bar shows right now.
  const valueAt = (r, t) => {
    if (r.CurrentValue >= r.MaxValue) return r.MaxValue;
    const rate = rateOf(r);
    if (!(rate > 0)) return r.CurrentValue;
    const mins = (t - anchorOf(r)) / 60000;
    return Math.min(r.CurrentValue + Math.floor(mins * rate), r.MaxValue);
  };

  // ds(): seconds until the next whole point lands. Null when it never will.
  const secsToNext = (r, t) => {
    if (r.CurrentValue >= r.MaxValue) return null;
    const rate = rateOf(r);
    if (!(rate > 0)) return null;
    const frac = ((t - anchorOf(r)) / 60000 * rate) % 1;
    return Math.max(0, (1 - frac) / rate * 60);
  };

  // NOT in the client — this is the number the game never computes.
  //
  // valueAt() reaches `target` when floor(elapsedMin * rate) >= target - CurrentValue.
  // The right side is a whole number, so that is just elapsedMin * rate >= need, and
  // the instant it happens is exactly LastUpdate + need/rate minutes. Solving it
  // rather than stepping to it means the answer is stable to the millisecond and does
  // not drift with how often the panel repaints.
  const secsToReach = (r, t, target) => {
    const want = Math.min(target, r.MaxValue);
    if (valueAt(r, t) >= want) return 0;
    const rate = rateOf(r);
    if (!(rate > 0)) return null;                     // paused, or draining: no ETA
    const need = want - r.CurrentValue;
    const at = anchorOf(r) + (need / rate) * 60000;
    return Math.max(0, (at - t) / 1000);
  };

  // m:ss under an hour, h:mm:ss over it. The game's own ps() only ever does the first,
  // because it is never asked about a span longer than one point.
  const clock = (secs) => {
    if (secs === null || !Number.isFinite(secs)) return '—';
    const s = Math.max(0, Math.round(secs));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
  };

  // An effect is worth showing next to a bar if it could plausibly change that bar's
  // arithmetic. Deliberately broad: a name printed beside a countdown costs the reader
  // a glance, and a rate change that was never mentioned costs them the countdown.
  const EFFECT_BARS = (e) => {
    const key = String(e.effect_key ?? '').toLowerCase();
    const target = String(e.target_key ?? '').toLowerCase();
    if (key === 'radiation') return ['hp'];                    // the game's own special case
    if (e.effect_type !== 'regen_modifier' && e.effect_type !== 'damage_over_time') return [];
    if (target === 'energy' || target === 'juice' || target === 'hp') return [target];
    return ['energy', 'juice', 'hp'];                          // untargeted: flag all three
  };

  const effectLabel = (e) => {
    if (String(e.effect_key ?? '').toLowerCase() === 'radiation') return 'radiation — regen paused';
    const name = e.source_item_name || e.effect_key || e.effect_type || 'effect';
    if (e.value == null) return String(name);
    const sign = e.value >= 0 ? '+' : '';
    const unit = e.modifier_type === 'percent' ? '%' : '';
    return `${name} ${sign}${e.value}${unit}`;
  };

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
  // ---------------------------------------------------------------------------
  const PANEL_W = 300;

  const CSS = `
    /* FAB KIT v6 — shared verbatim block.
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
       widened it to fourteen for bar-watch, and v6 widens it to fifteen for
       slot-watch. Half the row is written out below because CSS cannot count the
       tools that happen to be installed, which means every slot the row gains costs
       a version bump and a pass over every copy — the price of the row being one row
       rather than each tool's guess at one.

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 15; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       a fifteenth tool does not shuffle the fourteen buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. The eye
       leads because it is the mark of the set; the words are alphabetical after it:

         0  the eye  people-watch     8  TIME  time-watch
         1  ALGN     align-watch      9  WRLD  world-watch
         2  GOV      gov-watch       10  XP    xp-watch
         3  JUMP     quick-jump      11  POLL  poll-watch
         4  MKT      market-watch    12  SHOP  shop-watch
         5  RAID     raid-watch      13  BARS  bar-watch
         6  SLP      sleeper-watch   14  SLOT  slot-watch
         7  SOCK     ws-watch

       POLL, SHOP, BARS and SLOT are on the end rather than sorted in among the
       others, and that is deliberate: the alphabet describes how the first eleven
       were handed out, not a sort to be re-run. Slots are fixed, so a tool that
       arrives later takes the next free number and nothing already on screen moves.

       Fifteen 38px buttons 8px apart is a 682px row, so it runs 341px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1562px the row is centred,
       and below that it stops sliding left rather than climb onto the nav.

       Three numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 341 (half the row). Nothing else in here is placement.

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
      left: calc(max(440px, 50% - 341px) + var(--pk-slot, 0) * 46px);
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
    .pkbw-fab { --pk-slot: 13; z-index: 2147481900; }
    /* Hot: at least one bar has reached the level you asked about. The kit owns the
       FILL, so an open panel still reads as open underneath this. */
    .pkbw-fab[data-hot="1"] { border-color: #4ade80; color: #4ade80; }

    .pkbw-panel {
      position: fixed; top: 56px; right: 12px; z-index: 2147481899;
      box-sizing: border-box; width: ${PANEL_W}px; max-width: calc(100vw - 16px);
      display: none; flex-direction: column;
      background: #09090b; color: #e4e4e7;
      border: 1px solid #27272a; border-radius: 4px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      box-shadow: 0 10px 30px rgba(0,0,0,.55);
    }
    .pkbw-head {
      display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
      padding: 6px 8px; border-bottom: 1px solid #27272a; background: #111114;
      border-radius: 3px 3px 0 0;
    }
    .pkbw-head h1 {
      margin: 0; font-size: 10px; font-weight: 700; letter-spacing: .14em;
      text-transform: uppercase; color: #a1a1aa; flex: 1 1 auto;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pkbw-btn {
      flex: 0 0 auto; padding: 2px 6px; cursor: pointer;
      background: #18181b; color: #a1a1aa;
      border: 1px solid #3f3f46; border-radius: 2px;
      font: 700 9px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: .08em; text-transform: uppercase;
    }
    .pkbw-btn:hover { color: #fafafa; border-color: #71717a; }
    .pkbw-btn[data-on="1"] { color: #4ade80; border-color: #4ade80; }

    .pkbw-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px 8px 8px; }

    /* The alert line. Only ever present while something is actually at its level —
       an empty banner that is always there stops being read within a day. */
    .pkbw-hit {
      margin: 0 0 6px; padding: 4px 6px;
      border: 1px solid #4ade80; border-radius: 2px;
      background: rgba(74,222,128,.09); color: #86efac;
      font-size: 10.5px; letter-spacing: .04em;
      display: flex; align-items: center; gap: 6px;
    }
    .pkbw-hit span { flex: 1 1 auto; }

    .pkbw-row { padding: 5px 0; border-bottom: 1px solid #1c1c20; }
    .pkbw-row:last-child { border-bottom: 0; }
    .pkbw-top { display: flex; align-items: baseline; gap: 6px; }
    .pkbw-name { font-size: 10px; font-weight: 700; letter-spacing: .14em; color: #d4d4d8; }
    .pkbw-num { margin-left: auto; font-size: 11px; font-variant-numeric: tabular-nums; color: #a1a1aa; }
    .pkbw-num b { color: #fafafa; font-weight: 700; }

    /* The meter. Ten pips, skewed, same as the game's — a panel that draws its bars
       differently from the sidebar three inches away reads as a different game. */
    .pkbw-meter {
      position: relative; height: 13px; margin: 4px 0 3px;
      border-radius: 2px; overflow: hidden; background: #111118;
    }
    .pkbw-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; }
    .pkbw-pip { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px;
      background: #08080f; transform: skewX(-30deg); }

    .pkbw-eta {
      display: flex; gap: 8px; flex-wrap: wrap;
      font-size: 10px; font-variant-numeric: tabular-nums; color: #71717a;
    }
    .pkbw-eta b { color: #e4e4e7; font-weight: 700; }
    .pkbw-eta .full { color: #a1a1aa; }
    .pkbw-row[data-hit="1"] .pkbw-eta .full { color: #4ade80; }
    .pkbw-row[data-hit="1"] .pkbw-name { color: #4ade80; }

    /* A rate that is not the base rate is the single most load-bearing unknown in
       this tool (docs/17-attribute-surface.md), so it is called out rather than
       tucked away — seeing it move is how the open question gets answered. */
    .pkbw-rate { color: #52525b; }
    .pkbw-rate[data-custom="1"] { color: #38bdf8; }

    .pkbw-warn { margin-top: 2px; font-size: 10px; color: #fb7185; }

    .pkbw-set { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
    .pkbw-set label { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: #52525b; }
    .pkbw-set input {
      width: 52px; box-sizing: border-box; padding: 1px 4px;
      background: #111114; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 2px;
      font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-variant-numeric: tabular-nums;
    }
    .pkbw-set input:focus { outline: none; border-color: #71717a; }

    .pkbw-ch { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 2px;
      padding-top: 6px; border-top: 1px solid #1c1c20; }
    .pkbw-foot { margin-top: 4px; font-size: 9.5px; color: #3f3f46; line-height: 1.5; }
  `;

  // ---------------------------------------------------------------------------
  // 5. State.
  //
  //    `fired` is runtime only and is deliberately NOT persisted. It is seeded from
  //    the first payload after load without alerting, so opening the game with a full
  //    energy bar does not fire three alerts at you for a thing you can already see.
  //    After that a bar has to cross its level to fire again, and dropping back below
  //    is what re-arms it.
  // ---------------------------------------------------------------------------
  const DEFAULT_CH = { page: true, title: false, icon: false, sound: false };

  const ui = Object.assign(
    { open: false, targets: {}, ch: {} },
    readJSON(K.ui, {}),
  );
  ui.ch = Object.assign({}, DEFAULT_CH, ui.ch);
  ui.targets = Object.assign({}, ui.targets);
  const saveUI = () => writeJSON(K.ui, ui);

  const state = {
    rows: null,        // the last /api/attributes payload, as it arrived
    at: 0,             // when we saw it
    effects: [],       // the last /api/effects payload, filtered to what we read
    fired: {},         // name -> true while the bar is sitting at or above its level
    seeded: false,
  };

  // The level to be told about. Blank/absent means "full", which is what almost
  // everyone wants; a number means "tell me at N", which is what you want when the
  // thing you are waiting to afford costs N.
  const targetFor = (r) => {
    const raw = ui.targets[r.AttributeName?.toLowerCase?.()];
    const n = Number(raw);
    return (raw !== '' && raw != null && Number.isFinite(n) && n > 0)
      ? Math.min(n, r.MaxValue)
      : r.MaxValue;
  };

  const sorted = () => (state.rows ?? [])
    .filter((r) => r && typeof r.AttributeName === 'string')
    .slice()
    .sort((a, b) => (ORDER[a.AttributeName.toLowerCase()] ?? 99) - (ORDER[b.AttributeName.toLowerCase()] ?? 99));

  const effectsFor = (name) => state.effects.filter((e) => e.bars.includes(name));

  // ---------------------------------------------------------------------------
  // 6. The four alert channels.
  //
  //    Each one owns exactly two functions — raise and clear — and every clear is
  //    idempotent, because they are called from the tick, from the switches, and from
  //    pagehide. A channel that can only be raised is a channel that eventually
  //    leaves a permanent mark on the tab.
  // ---------------------------------------------------------------------------

  // --- TITLE -----------------------------------------------------------------
  // Measured: the app never writes document.title — there is no assignment to it in
  // any of the 126 chunks — so the base title is whatever index.html set and nothing
  // will fight us for it. The guard below still exists, because "no code writes it
  // today" is a fact about one deploy.
  let baseTitle = null;
  const titleRaise = (marks) => {
    if (!ui.ch.title) return;
    if (baseTitle === null) baseTitle = document.title;
    const want = `[${marks.join('')}] ${baseTitle}`;
    if (document.title !== want) document.title = want;
  };
  const titleClear = () => {
    if (baseTitle === null) return;
    if (document.title !== baseTitle) document.title = baseTitle;
    baseTitle = null;
  };

  // --- ICON ------------------------------------------------------------------
  // Inline SVG data URI, not a canvas. Drawing a favicon with a canvas would be a
  // perfectly ordinary thing to do and is NOT what X-CT-Canvas fingerprints, but
  // docs/01-rules-envelope.md puts canvas near the multi-account enforcement
  // mechanism, and a tool that never touches the API is not the place to spend the
  // reader's benefit of the doubt. No canvas appears in this file.
  const iconURI = (color) => 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
    + '<rect width="16" height="16" rx="3" fill="#09090b"/>'
    + `<circle cx="8" cy="8" r="4.5" fill="${color}"/></svg>`,
  );

  let iconSaved = null;   // [[link, originalHref], …], or a link we added ourselves
  const iconRaise = (color) => {
    if (!ui.ch.icon) return;
    if (!iconSaved) {
      const links = [...document.querySelectorAll('link[rel~="icon"]')];
      if (links.length) {
        iconSaved = links.map((l) => [l, l.getAttribute('href')]);
      } else {
        // Nothing to borrow: add one and remember that it is ours to remove.
        const l = document.createElement('link');
        l.rel = 'icon';
        document.head?.append(l);
        iconSaved = [[l, null]];
      }
    }
    const href = iconURI(color);
    for (const [l] of iconSaved) if (l.getAttribute('href') !== href) l.setAttribute('href', href);
  };
  const iconClear = () => {
    if (!iconSaved) return;
    for (const [l, href] of iconSaved) {
      if (href === null) l.remove();                 // ours: take it away again
      else l.setAttribute('href', href);
    }
    iconSaved = null;
  };

  // --- SOUND -----------------------------------------------------------------
  // Synthesised, so nothing is fetched from anywhere — not from politiko.io and not
  // from a CDN either. Two short notes; a single beep is easy to mistake for the OS.
  //
  // The context is built on the click that switches the channel on, because that is
  // the user gesture browsers require, and building it at load would leave a
  // suspended context that silently never plays.
  let audio = null;
  const soundArm = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      if (!audio) audio = new Ctx();
      if (audio.state === 'suspended') audio.resume();
      return true;
    } catch (e) { log('audio unavailable', e); return false; }
  };
  const soundPlay = () => {
    if (!ui.ch.sound || !audio || audio.state !== 'running') return;
    try {
      const now = audio.currentTime;
      for (const [i, hz] of [660, 880].entries()) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        const t0 = now + i * 0.14;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
        osc.connect(gain).connect(audio.destination);
        osc.start(t0);
        osc.stop(t0 + 0.14);
      }
    } catch (e) { log('tone failed', e); }
  };

  // ---------------------------------------------------------------------------
  // 7. DOM.
  // ---------------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let root = null, fab = null, panel = null, head = null, body = null;
  let drag = null, resize = null, fabDrag = null;
  let hitLine = null;
  const cells = new Map();   // AttributeName -> the refs paint() writes into

  // Built once per change in the SET of bars, not once per second. The countdown
  // repaints every second and the pointer is often inside the panel while it does;
  // replaceChildren() on that cadence loses clicks and blurs the input you are
  // typing a level into. So structure and numbers are separate jobs.
  const build = () => {
    const rows = sorted();
    const key = rows.map((r) => r.AttributeName).join(',');
    if (body.dataset.key === key) return;
    body.dataset.key = key;
    body.replaceChildren();
    cells.clear();

    hitLine = null;

    if (!rows.length) {
      body.append(el('p', 'pkbw-foot',
        'No reading yet. The sidebar asks for /api/attributes every 10 seconds on any '
        + 'authenticated page — this fills in as soon as one arrives.'));
      return;
    }

    for (const r of rows) {
      const name = r.AttributeName.toLowerCase();
      const row = el('div', 'pkbw-row');
      row.dataset.bar = name;

      const top = el('div', 'pkbw-top');
      const nm = el('span', 'pkbw-name', LABEL[name] ?? r.AttributeName.toUpperCase());
      const num = el('span', 'pkbw-num');
      top.append(nm, num);

      const meter = el('div', 'pkbw-meter');
      const fill = el('div', 'pkbw-fill');
      fill.style.background = COLOR[name] ?? '#888';
      meter.append(fill);
      for (let i = 1; i < 10; i++) {                    // the game's ten pips
        const pip = el('div', 'pkbw-pip');
        pip.style.left = `${i / 10 * 100}%`;
        meter.append(pip);
      }

      const eta = el('div', 'pkbw-eta');
      const full = el('span', 'full');
      const next = el('span');
      const rate = el('span', 'pkbw-rate');
      eta.append(full, next, rate);

      const warn = el('div', 'pkbw-warn');
      warn.style.display = 'none';

      const set = el('div', 'pkbw-set');
      const lab = el('label', '', 'tell me at');
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = '1';
      inp.placeholder = 'full';
      inp.value = ui.targets[name] ?? '';
      inp.title = 'Alert when this bar reaches this value. Blank means full.';
      // Typed, not committed on every keystroke: a half-typed "5" on the way to "50"
      // should not fire an alert at 5.
      const commit = () => {
        const v = inp.value.trim();
        if (v === '') delete ui.targets[name]; else ui.targets[name] = v;
        saveUI();
        state.fired[name] = false;    // a new level is a new question
        tick();
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('blur', commit);
      set.append(lab, inp);

      row.append(top, meter, eta, warn, set);
      body.append(row);
      cells.set(name, { row, num, fill, full, next, rate, warn, inp });
    }

    // The channel switches live under the bars rather than in the header: the header
    // is the drag handle and a row of controls in it is a row of places a drag does
    // not start.
    const ch = el('div', 'pkbw-ch');
    const CHANNELS = [
      ['page', 'PAGE', 'Light up this panel and the BARS button. Never leaves the page.'],
      ['title', 'TITLE', 'Prefix the browser tab title, so it reads from another tab.'],
      ['icon', 'ICON', 'Swap the favicon for a coloured dot while a bar is at its level.'],
      ['sound', 'SOUND', 'Play a short two-note tone once, when a bar reaches its level.'],
    ];
    for (const [k, word, why] of CHANNELS) {
      const b = el('button', 'pkbw-btn', word);
      b.dataset.on = ui.ch[k] ? '1' : '0';
      b.title = why + (k === 'page' ? '' : ' Off by default — see the header of this file.');
      b.addEventListener('click', () => {
        ui.ch[k] = !ui.ch[k];
        b.dataset.on = ui.ch[k] ? '1' : '0';
        // Switching a channel off has to undo whatever it already did to the tab.
        if (k === 'title' && !ui.ch.title) titleClear();
        if (k === 'icon' && !ui.ch.icon) iconClear();
        if (k === 'sound' && ui.ch.sound) soundArm();   // this click IS the gesture
        saveUI();
        tick();
      });
      ch.append(b);
    }
    body.append(ch);
    body.append(el('div', 'pkbw-foot',
      'Passive: reads /api/attributes and /api/effects as the game fetches them, and '
      + 'projects forward with the client’s own arithmetic. Adds no requests.'));
  };

  // Every second. Pure arithmetic on a payload already in memory.
  const paint = (now) => {
    const rows = sorted();
    const hits = [];

    for (const r of rows) {
      const name = r.AttributeName.toLowerCase();
      const c = cells.get(name);
      if (!c) continue;

      const v = valueAt(r, now);
      const target = targetFor(r);
      const hit = v >= target;
      if (hit) hits.push(name);

      c.num.replaceChildren(Object.assign(document.createElement('b'), { textContent: String(v) }));
      c.num.append(` / ${r.MaxValue}`);

      // Continuous, NOT the game's ten-pip quantisation — the one deliberate
      // divergence from the sidebar in this file. The game rounds the fill to the
      // nearest pip, so 98/100 draws as a full bar; this tool exists to tell "nearly
      // full" from "full", and a meter that cannot is working against it. The pips
      // stay as dividers so the two still read as the same object.
      c.fill.style.width = `${r.MaxValue > 0 ? Math.min(100, v / r.MaxValue * 100) : 0}%`;

      const eta = secsToReach(r, now, target);
      c.full.textContent = hit
        ? (target < r.MaxValue ? `AT ${target}` : 'FULL')
        : eta === null
          ? 'no ETA'                       // rate <= 0: the game shows nothing here either
          : `${target < r.MaxValue ? `${target} in` : 'full in'} ${clock(eta)}`;

      const nxt = secsToNext(r, now);
      c.next.textContent = nxt === null ? '' : `+1 ${clock(nxt)}`;

      const rate = rateOf(r);
      const custom = r.CustomRegenRate != null;
      c.rate.textContent = `${rate}/min${custom ? ' (custom)' : ''}`;
      c.rate.dataset.custom = custom ? '1' : '0';

      const fx = effectsFor(name);
      if (fx.length) {
        c.warn.style.display = '';
        c.warn.textContent = '⚠ ' + fx.map((e) => e.expires === null
          ? e.label
          : `${e.label}, ${clock((e.expires - now) / 1000)} left`).join(' · ');
      } else {
        c.warn.style.display = 'none';
        c.warn.textContent = '';
      }

      c.row.dataset.hit = hit ? '1' : '0';
      if (document.activeElement !== c.inp) c.inp.value = ui.targets[name] ?? '';
    }

    // The banner, created and destroyed rather than emptied, so an unread panel never
    // carries a stale one.
    const show = ui.ch.page && hits.length > 0;
    if (show) {
      if (!hitLine) {
        hitLine = el('div', 'pkbw-hit');
        hitLine.append(el('span'));
        body.prepend(hitLine);
      }
      hitLine.firstChild.textContent = hits.map((n) => LABEL[n] ?? n).join(' · ')
        + (hits.length > 1 ? ' are ready' : ' is ready');
    } else if (hitLine) {
      hitLine.remove();
      hitLine = null;
    }

    return hits;
  };

  // The heartbeat. Evaluates the alert state ALWAYS — that is the whole point of the
  // title and sound channels — and only repaints when there is a visible panel to
  // repaint. It asks the game for nothing; tools/test-bar-passive.js pins that.
  const tick = () => {
    const now = Date.now();
    const rows = sorted();

    // Alert state is computed from the projection whether or not the panel is open or
    // the tab is visible, so it is computed here rather than inside paint().
    const hits = [];
    for (const r of rows) {
      const name = r.AttributeName.toLowerCase();
      if (valueAt(r, now) >= targetFor(r)) hits.push(name);
    }

    // First payload after load seeds without firing: arriving to a full bar you can
    // already see is not news.
    if (!state.seeded && rows.length) {
      state.seeded = true;
      for (const n of hits) state.fired[n] = true;
    }

    let fresh = false;
    for (const r of rows) {
      const name = r.AttributeName.toLowerCase();
      const now_hit = hits.includes(name);
      if (now_hit && !state.fired[name]) { state.fired[name] = true; fresh = true; }
      if (!now_hit) state.fired[name] = false;      // dropped back: re-armed
    }

    if (hits.length) {
      titleRaise(hits.map((n) => MARK[n] ?? n[0].toUpperCase()));
      iconRaise(COLOR[hits[0]] ?? '#4ade80');
    } else {
      titleClear();
      iconClear();
    }
    if (fresh) soundPlay();

    if (fab) fab.dataset.hot = hits.length ? '1' : '0';

    if (ui.open && !document.hidden && panel) {
      build();
      paint(now);
    }
  };

  const sync = () => {
    if (!panel) return;
    panel.style.display = ui.open ? 'flex' : 'none';
    fab.classList.toggle('pk-open', ui.open);      // BEFORE the early return — FAB KIT
    if (!ui.open) return;
    drag.apply(ui);
    resize.apply(ui.size);       // display:none has no geometry, so restore on show
    build();
    paint(Date.now());           // content decides the height…
    drag.fit();                  // …so only now can the header be checked as reachable
    fabDrag?.fit();
  };

  const mount = () => {
    if (root) return;
    root = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);

    fab = el('button', 'pk-fab pkbw-fab', 'BARS');
    fab.title = 'Politiko Bar Watch (passive) — time to full for Energy, Juice and HP';
    fab.addEventListener('click', () => {
      if (fabDrag.dragged()) return;              // that gesture was a drag, not a click
      ui.open = !ui.open; saveUI(); sync();
    });
    root.append(fab);

    panel = el('div', 'pkbw-panel');
    head = el('div', 'pkbw-head');
    head.title = 'Drag to move · drag the bottom-right corner to resize · double-click to snap back';
    const title = el('h1', '', 'bar watch');

    const close = el('button', 'pkbw-btn', '×');
    close.title = 'Hide (the BARS button brings it back)';
    close.addEventListener('click', () => { ui.open = false; saveUI(); sync(); });
    head.append(title, close);

    body = el('div', 'pkbw-body');
    panel.append(head, body);
    root.append(panel);
    document.documentElement.append(root);

    drag = draggable(panel, head, (pos) => { Object.assign(ui, pos ?? { x: null, y: null }); saveUI(); });
    resize = resizable(panel, (size) => { ui.size = size ?? undefined; saveUI(); },
      { drag, minW: 240, minH: 200 });
    head.addEventListener('dblclick', () => { drag.reset(); resize.reset(); });

    fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUI(); });
    fabDrag.apply(ui.fab);
    fabDrag.fit();
    // Double-click puts it back in the row. reset() drops the stored position AND
    // clears the inline left/top, which is the only thing that lets the kit's rule
    // apply again — see FAB KIT v4.
    fab.addEventListener('dblclick', () => { ui.fab = null; saveUI(); fabDrag.reset(); });

    sync();
  };

  // ---------------------------------------------------------------------------
  // 8. Boot.
  // ---------------------------------------------------------------------------
  const boot = () => {
    mount();

    // The two paths this tool reads, named explicitly rather than '*' — the prefix
    // registry is what keeps the shared tap cheap for everyone else on it.
    onApi('/api/attributes', ({ data }) => {
      if (!Array.isArray(data)) return;      // shape gate: the GET returns an array
      state.rows = data;
      state.at = Date.now();
      tick();
    });

    onApi('/api/effects', ({ data }) => {
      if (!Array.isArray(data)) return;
      // Reduced to the four fields the panel prints, at the boundary. Nothing else
      // from an effect row is carried past this line.
      state.effects = data.map((e) => {
        const bars = EFFECT_BARS(e);
        if (!bars.length) return null;
        const t = e.expires_at ? new Date(e.expires_at).getTime() : NaN;
        return { bars, label: effectLabel(e), expires: Number.isFinite(t) ? t : null };
      }).filter(Boolean);
      tick();
    });

    // One second, matching the game's own bar clock. Arithmetic only.
    setInterval(tick, 1000);

    // A tab coming back to the front repaints immediately rather than waiting up to a
    // second, and a tab going away leaves the alert logic running — which is the
    // difference between the TITLE channel working and not.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

    // Never leave a mark on a tab we are done with.
    window.addEventListener('pagehide', () => { titleClear(); iconClear(); });

    tick();
    log('ready — passive; zero added requests. docs/17-attribute-surface.md');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
