// ==UserScript==
// @name         Politiko — Shop Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.3.0
// @description  First light on the city shops. Records the store payloads the app already fetched when you walked into a shop, and reports every field the server sent that the client never renders — the cheap way to find out whether a restock time is on the wire. Also brackets a restock whenever a stock number goes up between two of your own visits. Passive; zero added requests.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/shop-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/shop-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * `@grant none` is load-bearing, not a leftover default. Under any other grant both
 * Tampermonkey and Violentmonkey hand the script a sandboxed `window`, so the fetch wrap
 * below patches the sandbox's fetch and the page's real traffic never passes through it —
 * the tap silently sees nothing and the panel just sits there saying "no readings".
 *
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON RESPONSE bodies of calls the game client itself made, on pages you are
 *             actively viewing. Never a request body, never a header, never a token.
 *
 *               GET  /api/city                     the buildings in the city you are
 *                                                  standing in: id, name, kind, blurb
 *               GET  /api/city/stores/{id}         a shop's buy list — every field the
 *                                                  server sends, which is the point
 *               GET  /api/city/stores/{id}/sell    what that shop will buy from you
 *               GET  /api/user/*                   ONE string is taken from these and
 *                                                  nothing else: current_location.name,
 *                                                  so a stored reading can say which
 *                                                  city it came from. No other user
 *                                                  field is read, kept, or rendered.
 *
 *             Only ARRAY payloads are consumed for the two store endpoints. That is a
 *             deliberate shape gate, not an accident: it is how this file consumes the
 *             listing a GET returns without ever consuming the result object a purchase
 *             returns, and it needs no sight of the request to do it.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. There is one `fetch` wrapper and
 *             it calls the original exactly once, to pass your own traffic through. No
 *             timer in this file touches the network. Nothing is scheduled, retried, or
 *             fired while you are elsewhere. The panel offers no jump button in 0.1.0
 *             because it has nothing yet worth jumping to.
 *
 *   Writes:   nothing to the game. This tool has never sent a POST. The buy and sell
 *             mutation shapes are deliberately absent from this file, and
 *             tools/test-shop-passive.js fails the build if they appear.
 *
 *   Storage:  localStorage keys prefixed `pksw:` — the field census, the store readings,
 *             the restock brackets built from them, and panel state
 *
 *   Alerts:   none. No notifications, no sound, nothing raised from an unfocused tab.
 *             This is not an oversight and it is not a gap to be filled later — see the
 *             note below.
 *
 *   Clipboard: written ONLY when you click "copy"
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 * The measurements behind every constant here: docs/15-shop-surface.md.
 *
 * WHY THIS TOOL DOES NOT DO WHAT WAS ASKED FOR
 *
 * It was asked for as a restock notifier. That cannot be built. Knowing a shop refilled
 * while you are not in it requires calling the store endpoint again (an added request
 * nobody initiated), about a page you are not viewing, to raise an alert in another
 * window. That is clauses 1, 2, 4 and 5 in a single feature, and the penalty is a ban on
 * the only account you have. docs/15-shop-surface.md has the full reasoning and the
 * cheaper thing to do instead, which is to ask for a `store_restock` key in Politiko's
 * own push preferences — the game already has push, and its vocabulary is four keys wide.
 *
 * WHAT IT DOES INSTEAD, AND THE HONEST LIMITATION
 *
 * The client has no concept of when a shop refills — no field it reads, no timer, no
 * countdown, measured across all 126 chunks of the 2026-08-03 bundle. But the client not
 * READING a field is not the server not SENDING one, and telling those apart costs one
 * shop visit. So the FIELDS tab is the whole of version 0.1.0: it lists every key the
 * server actually sent, marks the ones no code path in the game reads, and flags the
 * time-shaped ones. If `restocks_at` is on the wire, you will see it the first time you
 * open a shop, and the cadence question is over.
 *
 * If it is not, the STOCK tab is the slow path. A stock number that went UP between two
 * of your own readings brackets a restock — and a bracket is all it can ever be. This
 * tool cannot see a refill it was not looking at, so it never claims a restock happened
 * AT a time; it says it happened BETWEEN two readings and prints that window on the row.
 * A window three days wide is drawn three days wide, because it is.
 */

(() => {
  'use strict';

  const TAG = '[pk-shop-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { data: 'pksw:data', ui: 'pksw:ui' };

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // ===========================================================================
  // 1. What the client reads, lifted from the bundle (2026-08-03 pull).
  //    docs/15-shop-surface.md carries the evidence line by line. This is the
  //    baseline the FIELDS tab diffs against: a key the server sends that is not
  //    in the matching set below has NO code path in the game that renders it.
  // ===========================================================================

  // BuildingPage destructures exactly these off a buy row before handing it to the
  // purchase modal, and CityPage exactly these off a building row. `stock` is nullable
  // and null means unlimited — the client renders an em dash and treats the ceiling as
  // 9999. `subcategory` is NOT here: the shop's own filter tabs are built from
  // `category` alone, which is why a shop cannot show you just the ammo.
  const KNOWN = {
    city: ['id', 'name', 'kind', 'description'],
    buy: ['item_def_id', 'name', 'category', 'rarity', 'description',
      'icon_image_path', 'buy_price', 'sell_price', 'stock'],
    sell: ['item_def_id', 'player_item_id', 'name', 'category', 'rarity', 'description',
      'icon_image_path', 'sell_price', 'qty'],
  };

  const LABEL = {
    city: 'GET /api/city',
    buy: 'GET /api/city/stores/{id}',
    sell: 'GET /api/city/stores/{id}/sell',
  };

  // The four building kinds CityPage has an icon and a label for. Anything else falls
  // back to a generic "Building" in the game, and here to its own name.
  const KINDS = { shop: 'Shop', clinic: 'Clinic', dump: 'Dump', cockpit: 'Palenque' };

  // A key worth stopping on. The whole question this version exists to answer is whether
  // the server volunteers a restock time, so anything time-shaped gets flagged rather
  // than buried in an alphabetical list of thirty field names.
  const TIMEISH = /restock|refill|replenish|refresh|reset|cooldown|expir|next|until|remaining|(^|_)(at|ts|time|date|seconds?|secs?|ms)($|_)/i;

  // Values that look like credentials never reach storage or the panel, on the same
  // allowlist-not-denylist principle as WS TAP. Nothing in a store payload should match
  // this; it costs nothing to be sure before writing to disk.
  const SECRET = /(token|jwt|auth|bearer|secret|password|passwd|refresh_token|session|cookie|credential|apikey|api_key)/i;

  // Bounds. A field census is tiny; readings are not, and this is somebody's browser.
  const MAX_READINGS = 40;   // per store — enough to bracket, not enough to be a log file
  const MAX_EVENTS = 400;  // restock brackets, newest first

  // ===========================================================================
  // 2. State
  // ===========================================================================

  const blank = () => ({
    // fields[endpointKey][keyName] = { n, first, last, type, sample }
    fields: { city: {}, buy: {}, sell: {} },
    // envelope[endpointKey] = 'array' | 'object' | …, what the top level actually was
    envelope: {},
    // stores[id] = { id, name, kind, city, readings: [{ t, items: {defId: {name, stock, price}} }] }
    stores: {},
    events: [],   // restock brackets, newest first
    seen: {},     // endpointKey -> last time a payload arrived
    readAt: 0,    // last time the panel was looked at, for the unseen badge
  });

  const data = Object.assign(blank(), readJSON(K.data, {}));
  for (const k of ['fields', 'envelope', 'stores', 'seen']) if (!data[k]) data[k] = {};
  for (const k of ['city', 'buy', 'sell']) if (!data.fields[k]) data.fields[k] = {};
  if (!Array.isArray(data.events)) data.events = [];

  const ui = Object.assign(
    { open: false, tab: 'fields', everywhere: true, x: null, y: null, size: undefined, fab: null },
    readJSON(K.ui, {}),
  );

  const save = () => writeJSON(K.data, data);
  const saveUI = () => writeJSON(K.ui, ui);

  // ===========================================================================
  // 3. Consuming a payload
  // ===========================================================================

  const pathOf = (u) => { try { return new URL(String(u), location.href).pathname; } catch { return ''; } };

  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

  // A short, safe rendition of a value, for the FIELDS tab. Long strings are cut, objects
  // are summarised rather than dumped, and a credential-looking key never gets here.
  const sampleOf = (v) => {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'string') return v.length > 48 ? `${v.slice(0, 45)}…` : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return `array(${v.length})`;
    if (typeof v === 'object') return `{${Object.keys(v).slice(0, 4).join(', ')}${Object.keys(v).length > 4 ? ', …' : ''}}`;
    return typeof v;
  };

  // Census one row against one endpoint's known set.
  const census = (key, row, now) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const bag = data.fields[key];
    for (const [k, v] of Object.entries(row)) {
      const rec = bag[k] || (bag[k] = { n: 0, first: now, last: 0, type: '', sample: '' });
      rec.n += 1;
      rec.last = now;
      const t = typeOf(v);
      if (!rec.type) rec.type = t;
      else if (rec.type !== t && !rec.type.includes(t)) rec.type = `${rec.type}|${t}`;
      // Keep the most informative sample seen: a non-null beats a null.
      if (SECRET.test(k)) rec.sample = '[redacted]';
      else if (v !== null && v !== undefined) rec.sample = sampleOf(v);
      else if (!rec.sample) rec.sample = sampleOf(v);
    }
  };

  const isNew = (key, name) => !KNOWN[key].includes(name);

  const newKeys = (key) => Object.keys(data.fields[key]).filter((n) => isNew(key, n)).sort();

  /** Any new key anywhere that looks like it carries a time. The headline. */
  const timeFinds = () => {
    const out = [];
    for (const key of ['buy', 'sell', 'city']) {
      for (const n of newKeys(key)) if (TIMEISH.test(n)) out.push({ key, name: n, ...data.fields[key][n] });
    }
    return out;
  };

  // --- stock readings, and the bracket ---------------------------------------

  let currentCity = null;   // the ONLY thing taken from a user payload

  const storeOf = (id) => data.stores[id] || (data.stores[id] = {
    id, name: null, kind: null, city: null, readings: [],
  });

  /** Fold a buy-list array into { defId: {name, stock, price} }. */
  const itemsOf = (rows) => {
    const out = {};
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const id = r.item_def_id;
      if (id == null) continue;
      out[String(id)] = {
        name: typeof r.name === 'string' ? r.name : String(id),
        // null is meaningful and is NOT zero: it is the game's unlimited.
        stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
        price: Number.isFinite(+r.buy_price) ? +r.buy_price : null,
        cat: typeof r.category === 'string' ? r.category : null,
      };
    }
    return out;
  };

  /**
   * Compare the new reading against the previous one for the same store and record a
   * bracket for every stock number that went UP. The window is the product: this tool
   * cannot know when the refill happened, only that it happened between these two times.
   */
  const bracket = (store, prev, cur) => {
    if (!prev) return;
    for (const [defId, now] of Object.entries(cur.items)) {
      const was = prev.items[defId];
      if (!was) {
        // Appeared between readings. Could be a restock of a sold-out line the server
        // drops from the list, could be a brand new item def. Recorded as its own kind
        // rather than folded into a restock it might not be.
        if (now.stock !== null && now.stock > 0) {
          data.events.unshift({
            kind: 'appeared', store: store.id, storeName: store.name, city: store.city,
            item: now.name, cat: now.cat, from: null, to: now.stock, t0: prev.t, t1: cur.t,
          });
        }
        continue;
      }
      if (was.stock === null || now.stock === null) {
        if (was.stock !== now.stock) {
          data.events.unshift({
            kind: 'model', store: store.id, storeName: store.name, city: store.city,
            item: now.name, cat: now.cat, from: was.stock, to: now.stock, t0: prev.t, t1: cur.t,
          });
        }
        continue;
      }
      if (now.stock > was.stock) {
        data.events.unshift({
          kind: 'restock', store: store.id, storeName: store.name, city: store.city,
          item: now.name, cat: now.cat, from: was.stock, to: now.stock, t0: prev.t, t1: cur.t,
        });
      }
    }
    if (data.events.length > MAX_EVENTS) data.events.length = MAX_EVENTS;
  };

  const consume = (path, payload) => {
    const now = Date.now();

    // The one user field this tool takes, and the only reason it looks at these at all.
    if (path.startsWith('/api/user/')) {
      const n = payload?.current_location?.name;
      if (typeof n === 'string' && n) currentCity = n;
      return;
    }

    if (path === '/api/city') {
      if (!Array.isArray(payload)) return;
      data.seen.city = now;
      for (const row of payload) {
        census('city', row, now);
        if (!row || row.id == null) continue;
        const s = storeOf(String(row.id));
        if (typeof row.name === 'string') s.name = row.name;
        if (typeof row.kind === 'string') s.kind = row.kind;
        if (currentCity) s.city = currentCity;
      }
      data.envelope.city = 'array';
      save();
      sync();
      return;
    }

    // /api/city/stores/{id} and /api/city/stores/{id}/sell
    const m = path.match(/^\/api\/city\/stores\/([^/]+)(\/sell)?$/);
    if (!m) return;
    const key = m[2] ? 'sell' : 'buy';

    // The shape gate. A listing is an array; a mutation's result object is not, and
    // this is how one is consumed without the other — no sight of the request needed.
    data.envelope[key] = typeOf(payload);
    if (!Array.isArray(payload)) return;

    data.seen[key] = now;
    for (const row of payload) census(key, row, now);

    if (key === 'buy') {
      const s = storeOf(String(m[1]));
      if (currentCity) s.city = currentCity;
      const reading = { t: now, items: itemsOf(payload) };
      bracket(s, s.readings[s.readings.length - 1], reading);
      s.readings.push(reading);
      if (s.readings.length > MAX_READINGS) s.readings.splice(0, s.readings.length - MAX_READINGS);
    }

    save();
    sync();
  };

  // ===========================================================================
  // 4. The tap. One wrapper, one passthrough, nothing else.
  // ===========================================================================

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const target = args[0];
    const url = typeof target === 'string' ? target : (target?.url ?? '');
    const p = origFetch.apply(this, args);
    try {
      const path = pathOf(url);
      if (!path.startsWith('/api/')) return p;
      return p.then((res) => {
        try {
          if (res.ok && res.headers.get('content-type')?.includes('json')) {
            // clone, so the app's own consumer still gets an unread body
            res.clone().json().then(
              (parsed) => { try { consume(path, parsed); } catch (e) { log('consume error', e); } },
              () => {},
            );
          }
        } catch (e) { log('tap error', e); }
        return res;
      });
    } catch (e) { log('tap error', e); }
    return p;
  };

  // ===========================================================================
  // 5. PANEL KIT v2 — shared verbatim block, see userscripts/_template.user.js.
  // Every panel this repo ships is draggable and resizable, and remembers both.
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
  // 6. Panel
  // ===========================================================================

  let root = null, panel = null, head = null, body = null, fab = null;
  let title = null, drag = null, fabDrag = null, resize = null;

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
    .pksw-fab { --pk-slot: 12; z-index: 2147482000; }
    .pksw-fab[data-find="1"] { border-color: #4ade80; color: #4ade80; }
    .pksw-panel { position: fixed; left: 12px; bottom: 202px; z-index: 2147482000;
      width: min(420px, calc(100vw - 24px)); max-height: min(80vh, 820px);
      display: flex; flex-direction: column;
      border: 1px solid #3f3f46; border-radius: 8px; background: #09090bf2; color: #e4e4e7;
      font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .pksw-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
      border-bottom: 1px solid #27272a; user-select: none; }
    .pksw-head h1 { flex: 1; font-size: 11px; margin: 0; color: #a1a1aa;
      text-transform: uppercase; letter-spacing: .08em; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .pksw-tabs { display: flex; gap: 0; border-bottom: 1px solid #27272a; }
    .pksw-tab { flex: 1; background: none; border: 0; border-bottom: 2px solid transparent;
      color: #71717a; font: inherit; font-size: 10px; letter-spacing: .1em;
      text-transform: uppercase; padding: 6px 2px; cursor: pointer; }
    .pksw-tab:hover { color: #d4d4d8; }
    .pksw-tab[data-on="1"] { color: #e4e4e7; border-bottom-color: #60a5fa; }
    .pksw-btn { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
      border-radius: 4px; font: inherit; font-size: 10.5px; padding: 1px 6px; cursor: pointer; }
    .pksw-btn:hover { background: #3f3f46; }
    .pksw-btn[data-on="1"] { border-color: #fbbf24; color: #fbbf24; }
    .pksw-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px; }
    .pksw-h2 { margin: 12px 0 5px; font-size: 10px; letter-spacing: .1em; color: #71717a;
      text-transform: uppercase; }
    .pksw-h2:first-child { margin-top: 0; }
    .pksw-dim { color: #a1a1aa; }
    .pksw-faint { color: #71717a; }
    .pksw-warn { color: #fbbf24; }
    .pksw-good { color: #4ade80; }
    .pksw-note { color: #71717a; font-size: 10.5px; line-height: 1.5; margin: 10px 0 0;
      border-top: 1px solid #27272a; padding-top: 8px; }
    .pksw-hit { border: 1px solid #4ade80; border-radius: 4px; padding: 7px 8px;
      margin: 0 0 9px; background: #052e1622; }
    .pksw-miss { border: 1px solid #27272a; border-radius: 4px; padding: 7px 8px;
      margin: 0 0 9px; color: #a1a1aa; }
    .pksw-tbl { width: 100%; border-collapse: collapse; }
    .pksw-tbl td { padding: 2px 0; vertical-align: baseline; }
    .pksw-tbl td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pksw-tbl td.k { padding-right: 8px; word-break: break-all; }
    .pksw-tbl tr[data-new="1"] td.k { color: #4ade80; }
    .pksw-tbl tr[data-time="1"] td.k { color: #fbbf24; font-weight: 700; }
    .pksw-ev { border-left: 2px solid #27272a; padding: 3px 0 3px 7px; margin: 0 0 4px; }
    .pksw-ev[data-kind="restock"] { border-left-color: #4ade80; }
    .pksw-ev[data-kind="appeared"] { border-left-color: #60a5fa; }
    .pksw-ev[data-kind="model"] { border-left-color: #fbbf24; }
    .pksw-ev .w { color: #52525b; font-size: 10px; }
    .pksw-store { border-top: 1px solid #27272a; padding-top: 7px; margin-top: 9px; }
    .pksw-store:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const dur = (ms) => {
    if (!Number.isFinite(ms)) return '—';
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  };

  const ago = (ms) => (ms ? `${dur(Date.now() - ms)} ago` : 'never');

  const clock = (ms) => {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  /** The bracket, printed as a window and never as a moment. */
  const windowOf = (e) => `${clock(e.t0)} → ${clock(e.t1)} · ${dur(e.t1 - e.t0)} wide`;

  const stockStr = (v) => (v === null || v === undefined ? '∞' : String(v));

  const unseen = () => data.events.filter((e) => e.t1 > (data.readAt || 0)).length;

  // ===========================================================================
  // 7. Tabs
  // ===========================================================================

  const TABS = [['fields', 'fields'], ['stock', 'stock'], ['sources', 'sources']];

  const renderFields = (out) => {
    const hits = timeFinds();
    const anyReading = data.seen.buy || data.seen.sell || data.seen.city;

    if (!anyReading) {
      const box = el('div', 'pksw-miss');
      box.append(el('div', '', 'No shop payload seen yet.'));
      box.append(el('div', 'pksw-faint',
        'Walk into any shop — City, then a building marked Shop. The app fetches its stock '
        + 'on its own and this tab fills in. Nothing here asks the game for anything.'));
      out.append(box);
      return;
    }

    // The headline, and the entire reason 0.1.0 exists.
    if (hits.length) {
      const box = el('div', 'pksw-hit');
      box.append(el('div', 'pksw-good', `${hits.length} time-shaped field${hits.length === 1 ? '' : 's'} the client never renders`));
      for (const h of hits) {
        const line = el('div', '', `${h.name} — ${h.sample}`);
        line.append(el('span', 'pksw-faint', `  (${LABEL[h.key]}, ${h.type})`));
        box.append(line);
      }
      box.append(el('div', 'pksw-faint',
        'If one of these is a restock time, the cadence question is answered and the STOCK '
        + 'tab is unnecessary. Worth writing up in docs/15-shop-surface.md.'));
      out.append(box);
    } else {
      const box = el('div', 'pksw-miss');
      box.append(el('div', '', 'No time-shaped field the client ignores — so far.'));
      box.append(el('div', 'pksw-faint',
        'That is the expected result: nothing in the 2026-08-03 bundle reads a restock '
        + 'time. It means the slow path — the STOCK tab — is the one that answers it.'));
      out.append(box);
    }

    for (const key of ['buy', 'sell', 'city']) {
      const bag = data.fields[key];
      const names = Object.keys(bag).sort();
      if (!names.length) continue;

      out.append(el('div', 'pksw-h2', `${LABEL[key]} · ${data.envelope[key] || '?'}`));

      const fresh = names.filter((n) => isNew(key, n));
      const head2 = el('div', 'pksw-faint',
        `${names.length} field${names.length === 1 ? '' : 's'} seen · `
        + `${fresh.length} the client never reads · last ${ago(data.seen[key])}`);
      out.append(head2);

      const tbl = el('table', 'pksw-tbl');
      // New first — they are the finding; known ones are the control group.
      for (const n of [...fresh, ...names.filter((x) => !isNew(key, x))]) {
        const rec = bag[n];
        const tr = el('tr');
        const nw = isNew(key, n);
        if (nw) tr.dataset.new = '1';
        if (nw && TIMEISH.test(n)) tr.dataset.time = '1';
        tr.append(el('td', 'k', n));
        tr.append(el('td', 'pksw-faint', rec.type));
        const s = el('td', 'pksw-dim', rec.sample);
        s.style.paddingLeft = '8px';
        tr.append(s);
        tbl.append(tr);
      }
      out.append(tbl);
    }

    out.append(el('p', 'pksw-note',
      'Green means the server sent it and no code path in the game renders it — measured '
      + 'against the read sets in docs/15-shop-surface.md, taken off the 2026-08-03 bundle. '
      + 'A green row is not a bug and not an exploit; it is a field the UI leaves on the '
      + 'floor. If one ever looks like it is not meant to be public, it stops here and goes '
      + 'to the bug bounty rather than into a panel.'));
  };

  const renderStock = (out) => {
    const shops = Object.values(data.stores)
      .filter((s) => s.readings.length)
      .sort((a, b) => (b.readings[b.readings.length - 1]?.t || 0) - (a.readings[a.readings.length - 1]?.t || 0));

    if (!shops.length) {
      out.append(el('div', 'pksw-miss', 'No stock readings yet. Open a shop.'));
      return;
    }

    const restocks = data.events.filter((e) => e.kind === 'restock');
    out.append(el('div', 'pksw-h2', 'brackets'));
    if (!restocks.length) {
      out.append(el('div', 'pksw-faint',
        'No restock seen yet. One shows up the first time a stock number is HIGHER than '
        + 'you last saw it — which needs two visits with a refill between them.'));
    }
    for (const e of data.events.slice(0, 40)) {
      const row = el('div', 'pksw-ev');
      row.dataset.kind = e.kind;
      const verb = e.kind === 'restock' ? 'restocked'
        : e.kind === 'appeared' ? 'appeared' : 'stock model changed';
      // `from` is null for two different reasons and they must not print the same. On a
      // restock or a model change null is the game's UNLIMITED; on an "appeared" the row
      // simply was not in the previous reading, and calling that ∞ says the opposite of
      // what happened.
      const from = e.kind === 'appeared' ? 'absent' : stockStr(e.from);
      row.append(el('div', '', `${e.item} — ${verb} ${from} → ${stockStr(e.to)}`));
      const w = el('div', 'w', `${e.storeName || `store ${e.store}`}${e.city ? ` · ${e.city}` : ''} · ${windowOf(e)}`);
      row.append(w);
      out.append(row);
    }

    out.append(el('div', 'pksw-h2', 'last reading per shop'));
    for (const s of shops) {
      const last = s.readings[s.readings.length - 1];
      const wrap = el('div', 'pksw-store');
      const h = el('div', '', `${s.name || `store ${s.id}`}${s.kind && KINDS[s.kind] ? ` · ${KINDS[s.kind]}` : ''}`);
      wrap.append(h);
      wrap.append(el('div', 'pksw-faint',
        `${s.city || 'city unknown'} · read ${ago(last.t)} · ${s.readings.length} reading${s.readings.length === 1 ? '' : 's'} kept`));

      const rows = Object.values(last.items)
        .sort((a, b) => {
          // Limited stock first — that is the thing that runs out.
          const al = a.stock === null ? 1 : 0, bl = b.stock === null ? 1 : 0;
          return al - bl || a.name.localeCompare(b.name);
        });
      const tbl = el('table', 'pksw-tbl');
      for (const it of rows) {
        const tr = el('tr');
        tr.append(el('td', 'k', it.name));
        tr.append(el('td', 'pksw-faint', it.cat || ''));
        tr.append(el('td', 'n pksw-dim', stockStr(it.stock)));
        tr.append(el('td', 'n pksw-faint', it.price == null ? '' : `$${it.price}`));
        tbl.append(tr);
      }
      wrap.append(tbl);
      out.append(wrap);
    }

    out.append(el('p', 'pksw-note',
      'Stock ∞ means the server sent null, which the game treats as unlimited. Every window '
      + 'above is a bracket, never a moment: this tool only sees a shop while you are '
      + 'standing in it, so it can say a refill happened BETWEEN two of your visits and '
      + 'nothing narrower. Two confounds worth knowing — selling something to a shop may '
      + 'raise its own buy stock, and a sold-out line the server drops from the list comes '
      + 'back as "appeared" rather than a restock.'));
  };

  const renderSources = (out) => {
    out.append(el('div', 'pksw-h2', 'what fills what'));
    const tbl = el('table', 'pksw-tbl');
    const rows = [
      ['city', 'building list — names and kinds for the shops in your city', 'walk into City'],
      ['buy', 'a shop\'s stock; the field census and every bracket', 'open a shop'],
      ['sell', 'what that shop buys; field census only', 'open a shop'],
    ];
    for (const [key, what, how] of rows) {
      const tr = el('tr');
      tr.append(el('td', 'k', LABEL[key].replace('GET /api/', '')));
      tr.append(el('td', 'pksw-faint', what));
      tr.append(el('td', 'n pksw-dim', data.seen[key] ? ago(data.seen[key]) : how));
      tbl.append(tr);
    }
    out.append(tbl);

    out.append(el('div', 'pksw-h2', 'what it will not do'));
    for (const line of [
      'Refresh anything. No timer here touches the network.',
      'Alert from an unfocused tab. There are no notifications at all.',
      'Reach a city you are not in. Stock is per shop and the client has no aggregate.',
      'Buy or sell. The mutation shapes are absent from the file, with a test that says so.',
    ]) out.append(el('div', 'pksw-faint', `· ${line}`));

    const copy = el('button', 'pksw-btn', 'copy field census');
    copy.style.marginTop = '9px';
    copy.addEventListener('click', () => {
      const lines = [];
      for (const key of ['buy', 'sell', 'city']) {
        for (const n of Object.keys(data.fields[key]).sort()) {
          const r = data.fields[key][n];
          lines.push([LABEL[key], n, isNew(key, n) ? 'NEW' : 'known', r.type, r.sample].join('\t'));
        }
      }
      navigator.clipboard.writeText(lines.join('\n')).then(
        () => { copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy field census'; }, 1500); },
        () => { copy.textContent = 'failed'; setTimeout(() => { copy.textContent = 'copy field census'; }, 1500); },
      );
    });
    out.append(copy);

    out.append(el('p', 'pksw-note',
      'This tool was asked for as a restock notifier and is deliberately not one. Background '
      + 'polling, an unfocused page and a raised alert are three separate prohibitions in the '
      + 'scripting clause, and the penalty is a ban. The thing actually worth doing is asking '
      + 'for a store_restock key in the game\'s own push preferences, which already carry '
      + 'jail_release, hospital_release, hospitalized and travel_arrival. See '
      + 'docs/15-shop-surface.md.'));
  };

  const render = () => {
    if (!body || document.hidden) return;
    body.textContent = '';
    const out = document.createDocumentFragment();
    if (ui.tab === 'stock') renderStock(out);
    else if (ui.tab === 'sources') renderSources(out);
    else renderFields(out);
    body.append(out);
    for (const b of panel.querySelectorAll('.pksw-tab')) b.dataset.on = b.dataset.tab === ui.tab ? '1' : '0';
  };

  // ===========================================================================
  // 8. Mount
  // ===========================================================================

  const onCity = () => ui.everywhere || /^\/city(\/|$)/.test(location.pathname);

  const sync = () => {
    if (!root) return;
    const show = onCity();
    root.style.display = show ? '' : 'none';
    panel.style.display = show && ui.open ? 'flex' : 'none';
    fab.setAttribute('aria-expanded', String(ui.open));
    fab.classList.toggle('pk-open', ui.open);   // the button says which window is up

    const finds = timeFinds().length;
    fab.dataset.find = !ui.open && finds ? '1' : '0';
    const n = unseen();
    fab.title = finds && !ui.open
      ? `Politiko Shop Watch — ${finds} time-shaped field the client never reads`
      : n && !ui.open
        ? `Politiko Shop Watch — ${n} stock change${n === 1 ? '' : 's'} you have not looked at`
        : 'Politiko Shop Watch (passive) — drag to move';

    const shops = Object.values(data.stores).filter((s) => s.readings.length).length;
    title.textContent = `shop watch${shops ? ` · ${shops} shop${shops === 1 ? '' : 's'}` : ''}`;

    if (show && ui.open) {
      if (n) { data.readAt = Date.now(); save(); }
      drag.apply(ui);
      resize.apply(ui.size);   // display:none has no geometry, so restore on show
      render();      // content decides the height…
      drag.fit();    // …so only now can we be sure the header is still reachable
      fabDrag?.fit();
    }
  };

  const mount = () => {
    if (root) return;
    root = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);

    fab = el('button', 'pk-fab pksw-fab', 'SHOP');
    fab.title = 'Politiko Shop Watch (passive) — drag to move';
    fab.addEventListener('click', () => {
      if (fabDrag.dragged()) return; // that gesture was a drag, not a click
      ui.open = !ui.open; saveUI(); sync();
    });
    root.append(fab);

    panel = el('div', 'pksw-panel');
    head = el('div', 'pksw-head');
    head.title = 'Drag to move · drag the bottom-right corner to resize · double-click to snap back';
    title = el('h1', '', 'shop watch');

    const pinBtn = el('button', 'pksw-btn', 'city only');
    pinBtn.title = 'Show this panel only on the City screens instead of everywhere';
    pinBtn.dataset.on = ui.everywhere ? '0' : '1';
    pinBtn.addEventListener('click', () => {
      ui.everywhere = !ui.everywhere; saveUI();
      pinBtn.dataset.on = ui.everywhere ? '0' : '1';
      sync();
    });

    const close = el('button', 'pksw-btn', '×');
    close.title = 'Hide (the SHOP button brings it back)';
    close.addEventListener('click', () => { ui.open = false; saveUI(); sync(); });

    head.append(title, pinBtn, close);

    const tabs = el('div', 'pksw-tabs');
    for (const [key, label] of TABS) {
      const b = el('button', 'pksw-tab', label);
      b.dataset.tab = key;
      b.dataset.on = ui.tab === key ? '1' : '0';
      b.addEventListener('click', () => { ui.tab = key; saveUI(); render(); });
      tabs.append(b);
    }

    body = el('div', 'pksw-body');
    panel.append(head, tabs, body);
    root.append(panel);
    document.documentElement.append(root);

    drag = draggable(panel, head, (pos) => { Object.assign(ui, pos ?? { x: null, y: null }); saveUI(); });
    resize = resizable(panel, (size) => { ui.size = size ?? undefined; saveUI(); },
      { drag, minW: 300, minH: 220 });
    // Double-click the header undoes both — the recovery path for a panel dragged
    // or resized into uselessness.
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

  // The app is a SPA, so a route change is a pushState rather than a navigation. Only
  // "city only" mode cares, but it cares immediately. Wrapping history here does not
  // navigate anything: it calls the original first and then looks at where we ended up.
  let lastPath = null;
  const checkRoute = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    sync();
  };
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) { const r = orig.apply(this, a); queueMicrotask(checkRoute); return r; };
  }
  window.addEventListener('popstate', checkRoute);

  // Every freshness figure in the panel ages, so it restates itself on a slow tick. This
  // timer draws and nothing else — it asks the game for nothing, which is what
  // tools/test-shop-passive.js pins. Visible tab only, and never while the pointer is
  // inside the panel: a redraw under the cursor loses a click.
  setInterval(() => { if (!document.hidden && ui.open && onCity() && !panel?.matches(':hover')) render(); }, 20_000);

  // Redrawn on becoming visible rather than while hidden: render() bails on
  // document.hidden, so a tab that was in the background catches up on focus.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

  const boot = () => {
    mount();
    checkRoute();
    log('ready — passive; zero added requests. docs/15-shop-surface.md');
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
