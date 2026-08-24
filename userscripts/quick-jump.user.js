// ==UserScript==
// @name         Politiko — Quick Jump
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.1
// @description  A launcher for the 64 screens the sidebar cannot reach. Offers every parameterless route the game ships, and learns the ID-bearing ones — casinos above all — from responses the game already fetched while you played. Shows the casino's city gate next to the door so you never load a floor you cannot enter. Passive: zero added requests, and every jump is one you pressed a key for.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/quick-jump.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/quick-jump.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * `@grant none` is load-bearing. Under any other grant the script manager hands this
 * script a sandboxed `window`, the fetch wrap patches the sandbox's fetch, and the
 * page's real traffic never passes through it — the tap silently sees nothing.
 *
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON bodies of /api/* responses via a passive fetch/XHR tap — only the
 *             ones the game requested on its own, on pages you are actively viewing.
 *             Specifically:
 *               /api/corporations?page=N              the directory, when you page it
 *               /api/corporations/mine                your own corp
 *               /api/corporations/<id>                a corp page you opened
 *               /api/corporations/<id>/casino         that corp's casino summary
 *               /api/factions/mine, /api/factions/<id>/public
 *             It keeps names, IDs, corp type, venue cities and the casino's own
 *             open/closed flags. Nothing else from those payloads is stored.
 *             No DOM scraping.
 *
 *   Requests: ZERO. This script does not originate network calls to politiko.io.
 *
 *             Its whole job is to shorten a walk you were going to take, so it would be
 *             an easy file to spoil by "just prefetching the directory". It does not.
 *             Every casino it knows about is one whose row you already paged past.
 *             An empty panel means you have not been to the directory yet, and the fix
 *             is to go there once — not for this script to go there for you.
 *             tools/test-quick-jump-passive.js fails the build if an originating call, a
 *             timer that could become one, or a non-GET verb ever appears in this file.
 *
 *   Navigates: yes, and only when you press a key or click a row. A jump is one
 *             client-side route change — the same event the game's own links raise, and
 *             the same footing as the people-watch roster walk. Nothing is queued,
 *             scheduled, retried, or continued while you look at something else.
 *
 *   Sends:    nothing, to anyone, ever. No telemetry, no remote config, no export
 *             off-machine. Everything stays in this browser.
 *
 *   Storage:  localStorage keys prefixed `pkqj:` — learned corporations and casinos,
 *             your pins, recent jumps, and panel position. All local, all clearable
 *             from the panel. It never reads the game's own `auth` key or any other
 *             storage that is not its own.
 *
 *   Alerts:   none. No notifications, no title flashing, no sound.
 *
 *   Personal data: corporation and faction names, and the cities their venues are in.
 *             Public directory information. It never leaves this browser.
 *
 * See docs/12-navigation-surface.md for the route table this is built from, the casino
 * entry chain it shortens, and why craps is deliberately absent.
 */

(() => {
  'use strict';

  const VERSION = '0.1.1';
  const TAG = '[pk-quick-jump]';
  const log = (...a) => console.debug(TAG, ...a);

  const CFG = {
    HOTKEY: 'j',        // Alt+J toggles the panel
    PANEL_W: 400,
    FAB_SIZE: 34,
    RECENT_MAX: 8,
    PIN_MAX: 9,         // Alt+1 .. Alt+9
    FRESH_MS: 5 * 60_000, // a gate reading older than this is called out as stale
  };

  // ===========================================================================
  // Storage — ours only, prefixed, and never anybody else's key
  // ===========================================================================
  const K = { places: 'pkqj:places', ui: 'pkqj:ui', recent: 'pkqj:recent' };

  const readJSON = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { log('save failed', k, e); } };

  let places = readJSON(K.places, null) || { corps: {}, casinos: {}, factions: {} };
  places.corps ??= {}; places.casinos ??= {}; places.factions ??= {};

  let ui = readJSON(K.ui, null) || {};
  ui.pins ??= [];          // array of hrefs, in order; Alt+1..9
  ui.open ??= false;
  ui.panel ??= null;
  ui.fab ??= null;

  let recent = readJSON(K.recent, null) || [];

  const savePlaces = () => writeJSON(K.places, places);
  const saveUi = () => writeJSON(K.ui, ui);
  const saveRecent = () => writeJSON(K.recent, recent);

  // ===========================================================================
  // The catalogue — every parameterless route the game ships.
  //
  // Lifted from the router in the entry bundle (docs/12-navigation-surface.md).
  // Auth, error and redirect routes are left out; they are not destinations.
  // Twenty of these have a sidebar entry. The rest are the reason this file exists.
  // ===========================================================================
  const CATALOG = [
    ['Corporations', [
      ['/corporations', 'My corporation'],
      ['/corporations/directory', 'Corporation directory', 'the only index of corps — and so of casinos'],
    ]],
    ['Property', [
      ['/property', 'Property & housing'],
      ['/estate-market', 'Estate market'],
    ]],
    ['City', [
      ['/city', 'City'],
      ['/city/bank', 'Bank'],
      ['/city/cockfighting', 'Cockfighting'],
      ['/travel', 'Travel'],
    ]],
    ['Crime', [
      ['/actions', 'Actions'],
      ['/actions/activism', 'Activism'],
      ['/actions/car-theft', 'Car theft'],
      ['/actions/donations', 'Donations'],
      ['/actions/drug-deal', 'Drug deal'],
      ['/actions/graffiti', 'Graffiti'],
      ['/actions/hacking', 'Hacking'],
      ['/actions/opinion-poll', 'Opinion poll'],
      ['/actions/sleeper-recruitment', 'Sleeper recruitment'],
    ]],
    ['Money', [
      ['/market', 'Market'],
      ['/market/players', 'Player auctions'],
      ['/stocks', 'Stocks'],
      ['/trades', 'Trades'],
      ['/job', 'Job'],
      ['/inventory', 'Inventory'],
    ]],
    ['People', [
      ['/people', 'People'],
      ['/contacts', 'Contacts'],
      ['/messages', 'Messages'],
      ['/faction', 'My faction'],
      ['/factions/directory', 'Faction directory'],
      ['/marriage', 'Marriage'],
      ['/protests', 'Protests'],
    ]],
    ['Press & board', [
      ['/news', 'News'],
      ['/newspaper', 'Newspaper'],
      ['/newspaper/post-classified-ad', 'Post classified ad'],
      ['/newspaper/classified-ads/manage', 'Manage classified ads'],
      ['/newspaper/post-job-listing', 'Post job listing'],
      ['/newspaper/job-listings/manage', 'Manage job listings'],
      ['/newspaper/post-personal', 'Post personal'],
      ['/newspaper/personals/manage', 'Manage personals'],
      ['/forums', 'Forums'],
      ['/forums/my-posts', 'My forum posts'],
      ['/wiki', 'Wiki'],
      ['/events', 'Events'],
    ]],
    ['Body & state', [
      ['/hospital', 'Hospital'],
      ['/jail', 'Jail'],
      ['/fedded', 'Fedded'],
      ['/train', 'Train'],
      ['/education', 'Education'],
    ]],
    ['Civic', [
      ['/government', 'Government'],
      ['/rules', 'Rules'],
      ['/contact', 'Contact staff'],
    ]],
    ['Session', [
      ['/', 'Home'],
      ['/settings', 'Settings'],
      ['/settings/sidebar', 'Sidebar layout', 'reorders the 20 built-in items'],
    ]],
  ];

  // The lobby filters craps out of the only screen that would link to it — that is an
  // operator decision expressed in code, and this file honours it rather than routing
  // around it. See docs/12-navigation-surface.md. Do not add it back without one.
  const HIDDEN_GAMES = new Set(['craps']);

  const GAME_LABEL = {
    blackjack: 'Blackjack',
    slots: 'Slots',
    roulette: 'Roulette',
    poker: 'Poker',
    predictions: 'Predictions',
  };

  // ===========================================================================
  // Ingest — everything below is a copy of a payload the game already received
  // ===========================================================================
  const now = () => Date.now();

  const ingestCorp = (c) => {
    if (!c || c.id == null) return false;
    const id = String(c.id);
    const prev = places.corps[id] || {};
    places.corps[id] = {
      id,
      name: c.name ?? prev.name ?? `Corp ${id}`,
      type: c.type ?? prev.type ?? null,
      location_name: c.location_name ?? prev.location_name ?? null,
      is_active: c.is_active ?? prev.is_active ?? true,
      seenAt: now(),
    };
    return true;
  };

  /** the casino summary — the venue list and, crucially, the city gate */
  const ingestCasino = (corpId, s) => {
    if (!s || typeof s !== 'object') return false;
    const id = String(corpId);
    places.casinos[id] = {
      operational: !!s.operational,
      wagering_suspended: !!s.wagering_suspended,
      current_city_access: !!s.current_city_access,
      venues: Array.isArray(s.venues)
        ? s.venues.slice(0, 20).map((v) => ({ property_id: v?.property_id ?? null, location_name: v?.location_name ?? null }))
        : [],
      games: Array.isArray(s.games)
        ? s.games.slice(0, 20).map((g) => ({ key: g?.key ?? null, status: g?.status ?? null })).filter((g) => g.key)
        : [],
      seenAt: now(),
    };
    // a corp we only ever met through its casino still deserves a name slot
    if (!places.corps[id]) ingestCorp({ id, type: 'casino' });
    return true;
  };

  const ingestFaction = (f) => {
    if (!f || f.id == null) return false;
    const id = String(f.id);
    places.factions[id] = { id, name: f.name ?? places.factions[id]?.name ?? `Faction ${id}`, seenAt: now() };
    return true;
  };

  // ===========================================================================
  // Passive tap — reads responses already in flight. Adds no requests itself.
  // ===========================================================================
  const route = (u) => {
    try { const x = new URL(u, location.origin); return x.pathname + x.search; }
    catch { return String(u); }
  };

  const R = {
    casino:   /^\/api\/corporations\/([^/?]+)\/casino(\?|$)/,
    corpMine: /^\/api\/corporations\/mine(\?|$)/,
    corpOne:  /^\/api\/corporations\/([^/?]+)(\?|$)/,
    corpDir:  /^\/api\/corporations(\?|$)/,
    factMine: /^\/api\/factions\/mine(\?|$)/,
    factOne:  /^\/api\/factions\/([^/?]+)\/public(\?|$)/,
  };

  const dispatch = (url, data) => {
    const p = route(url);
    let touched = false;
    let m;

    // order matters: /corporations/<id>/casino and /corporations/mine both also
    // satisfy the looser /corporations/<id> shape, so the specific tests come first
    if ((m = R.casino.exec(p))) {
      touched = ingestCasino(m[1], data);
    } else if (R.corpMine.test(p)) {
      touched = ingestCorp(data);
    } else if ((m = R.corpOne.exec(p))) {
      touched = ingestCorp({ ...(data || {}), id: data?.id ?? m[1] });
    } else if (R.corpDir.test(p)) {
      for (const c of data?.items || []) touched = ingestCorp(c) || touched;
    } else if (R.factMine.test(p)) {
      touched = ingestFaction(data?.faction ?? data);
    } else if ((m = R.factOne.exec(p))) {
      touched = ingestFaction({ ...(data?.faction ?? data ?? {}), id: (data?.faction ?? data)?.id ?? m[1] });
    }

    if (touched) { savePlaces(); paint(); }
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (url.includes('/api/') && (res.headers.get('content-type') || '').includes('json')) {
        res.clone().json().then((d) => dispatch(url, d), () => {});
      }
    } catch (e) { log('fetch tap', e); }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.__pkqjUrl = u;
    return origOpen.call(this, m, u, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        const u = this.__pkqjUrl || '';
        if (u.includes('/api/') && (this.getResponseHeader('content-type') || '').includes('json')) {
          dispatch(u, JSON.parse(this.responseText));
        }
      } catch { /* not json */ }
    });
    return origSend.apply(this, a);
  };

  // ===========================================================================
  // Jumping.
  //
  // React Router 7.18.2 keeps its position in `history.state.idx` and re-renders off
  // `popstate`. Pushing a state without an idx — which is what the first tool in this
  // repo to do this did — leaves the router computing a null delta, and Back after a
  // scripted jump then behaves unlike Back after a click. Carrying the index forward
  // costs one line and keeps the two indistinguishable, which is the point: this is a
  // link press with the walking removed, not a new way to move.
  // ===========================================================================
  const remember = (href) => {
    recent = [href, ...recent.filter((h) => h !== href)].slice(0, CFG.RECENT_MAX);
    saveRecent();
  };

  const here = () => location.pathname + location.search;

  const jump = (href) => {
    if (!href) return;
    remember(href);
    if (href === here()) { toggle(false); return; }
    const st = history.state;
    const idx = (st && Number.isFinite(st.idx) ? st.idx : 0) + 1;
    history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', href);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    toggle(false);
  };

  // ===========================================================================
  // PANEL KIT v1 — shared verbatim block.
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
  // ===========================================================================
  // Derived — what we know, shaped for the panel
  // ===========================================================================
  const fmtAge = (ms) => {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  /**
   * The gate, stated honestly. `current_city_access` is a snapshot of where you were
   * standing when that corp page last loaded — travel afterwards and it is wrong, and
   * this script has no way to know that without asking, which it will not do. So the
   * age is always shown next to it and never rounded away.
   */
  const gateOf = (corpId) => {
    const s = places.casinos[corpId];
    if (!s) return { tone: 'dim', text: 'gate unknown — open its corp page once' };
    if (!s.operational) return { tone: 'dim', text: 'no venue — floor closed' };
    const age = fmtAge(now() - s.seenAt);
    const stale = now() - s.seenAt > CFG.FRESH_MS;
    if (s.wagering_suspended) return { tone: 'neg', text: `wagering suspended · ${age}` };
    if (s.current_city_access) return { tone: stale ? 'warn' : 'pos', text: `open to you · ${age}` };
    const cities = s.venues.map((v) => v.location_name).filter(Boolean);
    return { tone: 'warn', text: `travel to ${cities.join(' / ') || 'a venue city'} · ${age}` };
  };

  const liveGames = (corpId) => {
    const s = places.casinos[corpId];
    if (!s || !s.games.length) return [];
    return s.games.filter((g) => g.status === 'live' && !HIDDEN_GAMES.has(g.key));
  };

  /**
   * A corp belongs in the casino block if the directory typed it `casino` — that holds
   * even before it has a floor, and "Awaiting a venue" is worth seeing — or if it has a
   * summary saying it is actually operating. What it must not take is the third case:
   * the corp page fetches `/casino` for every corporation it renders, so a summary can
   * turn up attached to a haulage company. A non-operational summary on an untyped corp
   * is that, and listing it would put a warehouse in the casino section.
   */
  const isCasino = (c) => c.type === 'casino' || !!places.casinos[c.id]?.operational;

  const casinoCorps = () => Object.values(places.corps)
    .filter(isCasino)
    .sort((a, b) => {
      const ao = places.casinos[a.id]?.current_city_access ? 0 : 1;
      const bo = places.casinos[b.id]?.current_city_access ? 0 : 1;
      return ao - bo || String(a.name).localeCompare(String(b.name));
    });

  // strictly the complement of casinoCorps — the two must partition, or a corp that
  // satisfies neither test disappears from the panel entirely
  const otherCorps = () => Object.values(places.corps)
    .filter((c) => !isCasino(c))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, 200);

  /** every jumpable thing, flat — the filter searches this and pins resolve against it */
  const allDestinations = () => {
    const out = [];
    for (const [group, items] of CATALOG) {
      for (const [href, label, note] of items) out.push({ href, label, group, note });
    }
    for (const c of casinoCorps()) {
      out.push({ href: `/corporations/${c.id}/casino`, label: `${c.name} · casino floor`, group: 'Casino' });
      for (const g of liveGames(c.id)) {
        out.push({
          href: `/corporations/${c.id}/casino/${g.key}`,
          label: `${c.name} · ${GAME_LABEL[g.key] ?? g.key}`,
          group: 'Casino',
        });
      }
    }
    for (const c of Object.values(places.corps)) {
      out.push({ href: `/corporations/${c.id}`, label: c.name, group: 'Corporations seen', note: c.type ?? undefined });
    }
    for (const f of Object.values(places.factions)) {
      out.push({ href: `/factions/${f.id}`, label: f.name, group: 'Factions seen' });
    }
    return out;
  };

  const labelFor = (href) => allDestinations().find((d) => d.href === href)?.label ?? href;

  const isPinned = (href) => ui.pins.includes(href);
  const togglePin = (href) => {
    if (isPinned(href)) ui.pins = ui.pins.filter((h) => h !== href);
    else if (ui.pins.length < CFG.PIN_MAX) ui.pins.push(href);
    saveUi(); paint();
  };

  // ===========================================================================
  // CSS
  // ===========================================================================
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .fab {
      position: fixed; right: 12px; bottom: 246px; width: ${CFG.FAB_SIZE}px; height: ${CFG.FAB_SIZE}px;
      z-index: 2147483000; display: grid; place-items: center; cursor: pointer;
      background: #18181b; color: #f4f4f5; border: 1px solid #3f3f46; border-radius: 3px;
      font-size: 11px; letter-spacing: .08em; user-select: none;
    }
    .fab:hover { border-color: #71717a; }
    .panel {
      position: fixed; right: 12px; bottom: 290px; width: ${CFG.PANEL_W}px;
      max-width: calc(100vw - 24px); max-height: 74vh; z-index: 2147483000;
      background: #09090b; color: #e4e4e7; border: 1px solid #27272a; border-radius: 4px;
      display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,.7);
      font-size: 12px;
    }
    .hd {
      display: flex; align-items: center; gap: 8px; padding: 7px 10px;
      background: #111116; border-bottom: 1px solid #27272a; cursor: grab; user-select: none;
    }
    .hd b { font-weight: 600; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
    .hd .sp { flex: 1; }
    .cov { font-size: 10px; color: #71717a; }
    .find { padding: 7px 10px; border-bottom: 1px solid #27272a; }
    .find input {
      width: 100%; background: #18181b; color: #e4e4e7; border: 1px solid #3f3f46;
      border-radius: 3px; padding: 4px 7px; font-size: 11px; outline: none;
    }
    .find input:focus { border-color: #71717a; }
    .body { overflow: auto; padding: 4px 0 6px; }
    .grp {
      padding: 8px 10px 3px; font-size: 9px; letter-spacing: .12em; text-transform: uppercase;
      color: #52525b;
    }
    .row {
      display: flex; align-items: center; gap: 7px; width: 100%; text-align: left;
      padding: 4px 10px; border: none; background: none; color: #d4d4d8;
      font-size: 11.5px; cursor: pointer; font-family: inherit;
    }
    .row:hover, .row.sel { background: #18181b; color: #f4f4f5; }
    .row .lb { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .nt { font-size: 9.5px; color: #52525b; white-space: nowrap; }
    .row .kbd {
      min-width: 15px; text-align: center; font-size: 9px; color: #71717a;
      border: 1px solid #3f3f46; border-radius: 2px; padding: 0 3px;
    }
    .row .pin {
      opacity: 0; font-size: 11px; color: #71717a; padding: 0 2px; cursor: pointer;
      background: none; border: none; font-family: inherit;
    }
    .row:hover .pin, .row.sel .pin, .row .pin.on { opacity: 1; }
    .row .pin.on { color: #fbbf24; }
    .cas { padding: 5px 10px 7px; border-bottom: 1px solid #101014; }
    .cas .top { display: flex; align-items: baseline; gap: 7px; }
    .cas .nm { font-size: 12px; color: #f4f4f5; font-weight: 600; flex: 1;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cas .gate { font-size: 9.5px; white-space: nowrap; }
    .cas .games { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
    .cas button.g {
      background: #18181b; color: #d4d4d8; border: 1px solid #3f3f46; border-radius: 3px;
      padding: 2px 7px; font-size: 10px; cursor: pointer; font-family: inherit;
    }
    .cas button.g:hover { border-color: #71717a; color: #f4f4f5; }
    .cas button.g.floor { border-color: #78350f; color: #fbbf24; }
    .cas button.g.floor:hover { border-color: #b45309; }
    .cas button.g.shut { color: #52525b; border-color: #27272a; }
    .note { padding: 6px 10px; border-top: 1px solid #27272a; font-size: 9.5px; color: #71717a; line-height: 1.5; }
    button.act {
      background: #18181b; color: #d4d4d8; border: 1px solid #3f3f46; border-radius: 3px;
      padding: 3px 8px; font-size: 10px; cursor: pointer; font-family: inherit;
    }
    button.act:hover { border-color: #71717a; }
    .dim { color: #71717a; } .pos { color: #4ade80; } .neg { color: #f87171; } .warn { color: #fbbf24; }
    .empty { padding: 16px 10px; text-align: center; color: #52525b; font-size: 11px; line-height: 1.6; }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ===========================================================================
  // Mount / paint
  // ===========================================================================
  let host = null, root = null, panelEl = null, bodyEl = null, fab = null;
  let hdEl = null, covEl = null, findEl = null, inputEl = null, noteEl = null;
  let panelDrag = null, fabDrag = null, placed = false;
  let query = '', sel = 0, matches = [];

  const mount = () => {
    if (host) return;
    host = el('div');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483000';
    document.documentElement.append(host);
    root = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS; root.append(style);

    fab = el('div', 'fab', 'JUMP');
    fab.title = 'Quick Jump (Alt+J) — drag to move, double-click to reset';
    root.append(fab);

    fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUi(); });
    fabDrag.apply(ui.fab);
    fab.addEventListener('click', () => { if (!fabDrag.dragged()) toggle(); });
    fab.addEventListener('dblclick', () => { ui.fab = null; saveUi(); fabDrag.reset(); });

    // The panel's CHROME is built exactly once, and the drag binds to that one header.
    //
    // It used to be rebuilt inside paint(), which quietly broke dragging: paint() begins
    // with replaceChildren(), so the header the kit was bound to got discarded on the
    // first repaint and every later one was a fresh, unbound node. The FAB is bound
    // separately just above and kept working, which is what made it read as a panel-only
    // quirk rather than a wiring bug.
    //
    // The filter input is the same problem one layer down, and was already half-known:
    // renderBody() exists precisely so typing does not go through paint() and drop the
    // caret. Building it once here means even a paint() mid-type leaves it alone.
    panelEl = el('div', 'panel');
    panelEl.style.display = 'none';

    hdEl = el('div', 'hd');
    covEl = el('span', 'cov');
    const close = el('button', 'act', '×');
    close.addEventListener('click', () => toggle(false));
    hdEl.append(el('b', null, 'Quick Jump'), covEl, el('span', 'sp'), close);

    findEl = el('div', 'find');
    inputEl = el('input');
    inputEl.type = 'text';
    inputEl.placeholder = 'filter — ↑↓ to pick, Enter to jump, Esc to close';
    inputEl.addEventListener('input', () => { query = inputEl.value; sel = 0; renderBody(); });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); toggle(false); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (matches[sel]) jump(matches[sel].href); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!matches.length) return;
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        renderBody();
        bodyEl?.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
      }
    });
    findEl.append(inputEl);

    bodyEl = el('div', 'body');
    noteEl = el('div', 'note');
    panelEl.append(hdEl, findEl, bodyEl, noteEl);
    root.append(panelEl);

    panelDrag = draggable(panelEl, hdEl, (pos) => { ui.panel = pos; saveUi(); });
    hdEl.addEventListener('dblclick', () => {
      ui.panel = null; saveUi(); panelDrag.reset(); placed = true;
    });
  };

  const toggle = (force) => {
    const next = force == null ? !ui.open : !!force;
    if (next && !ui.open) { query = ''; sel = 0; }
    ui.open = next;
    saveUi();
    paint();
    if (ui.open) inputEl?.focus();   // the input is a fixed node now, so no lookup needed
  };

  /**
   * One clickable destination line. It is a div rather than a button because it holds
   * a pin button, and an interactive control inside a <button> is invalid and behaves
   * unpredictably — the pin's click would fight the row's.
   */
  const mkRow = (d, opts = {}) => {
    const r = el('div', `row${opts.selected ? ' sel' : ''}`);
    r.setAttribute('role', 'button');
    r.tabIndex = -1;
    if (opts.kbd != null) r.append(el('span', 'kbd', String(opts.kbd)));
    r.append(el('span', 'lb', d.label));
    if (d.note) r.append(el('span', 'nt', d.note));
    if (opts.groupNote) r.append(el('span', 'nt', opts.groupNote));

    const pin = el('button', `pin${isPinned(d.href) ? ' on' : ''}`, isPinned(d.href) ? '★' : '☆');
    pin.title = isPinned(d.href) ? 'unpin' : `pin (Alt+1…${CFG.PIN_MAX})`;
    pin.addEventListener('click', (e) => { e.stopPropagation(); togglePin(d.href); });
    r.append(pin);

    r.addEventListener('click', () => jump(d.href));
    return r;
  };

  /** the casino block — a door and its gate, never one without the other */
  const renderCasinos = (body) => {
    const list = casinoCorps();
    if (!list.length) return false;
    body.append(el('div', 'grp', 'Casino'));
    for (const c of list) {
      const wrap = el('div', 'cas');
      const top = el('div', 'top');
      const nm = el('span', 'nm', c.name);
      if (c.is_active === false) nm.classList.add('dim');
      top.append(nm);
      const g = gateOf(c.id);
      top.append(el('span', `gate ${g.tone}`, g.text));
      wrap.append(top);

      const row = el('div', 'games');
      const s = places.casinos[c.id];
      const shut = !!(s && (!s.operational || s.wagering_suspended));

      const floor = el('button', `g floor${shut ? ' shut' : ''}`, 'Enter floor');
      floor.addEventListener('click', () => jump(`/corporations/${c.id}/casino`));
      row.append(floor);

      for (const game of liveGames(c.id)) {
        const b = el('button', 'g', GAME_LABEL[game.key] ?? game.key);
        b.addEventListener('click', () => jump(`/corporations/${c.id}/casino/${game.key}`));
        row.append(b);
      }

      const corp = el('button', 'g', 'Corp page');
      corp.addEventListener('click', () => jump(`/corporations/${c.id}`));
      row.append(corp);

      const floorHref = `/corporations/${c.id}/casino`;
      const pin = el('button', 'g', isPinned(floorHref) ? '★ pinned' : '☆ pin floor');
      pin.addEventListener('click', () => togglePin(floorHref));
      row.append(pin);

      wrap.append(row);
      body.append(wrap);
    }
    return true;
  };

  /**
   * The list itself. Filtering flattens everything into one ranked run; an empty
   * filter shows the sectioned view, pins and casinos first.
   */
  function renderBody() {
    if (!bodyEl) return;
    bodyEl.replaceChildren();
    const q = query.trim().toLowerCase();

    if (q) {
      // label hits before path hits, order otherwise preserved
      const all = allDestinations();
      const byLabel = all.filter((d) => d.label.toLowerCase().includes(q));
      const byPath = all.filter((d) => !d.label.toLowerCase().includes(q) && d.href.toLowerCase().includes(q));
      matches = [...byLabel, ...byPath];
      if (sel >= matches.length) sel = 0;
      if (!matches.length) {
        // "casino" is the likeliest first thing anybody types, and on a fresh install
        // it is also the one query guaranteed to return nothing — there is no static
        // casino route to match, only ones learned from the directory. A bare "nothing
        // matches" would read as "this tool does not do casinos", which is the opposite
        // of true, so the dead end has to say what to do about itself.
        const miss = el('div', 'empty', 'nothing matches');
        if (!casinoCorps().length && /cas|gam|slot|poker|blackjack|roulette|bet|predict/.test(q)) {
          miss.append(el('div', null, ' '));
          miss.append(el('div', null, 'casinos are corporations, and land here once you have paged the directory'));
          const go = el('button', 'act', 'open the corporation directory');
          go.style.marginTop = '8px';
          go.addEventListener('click', () => jump('/corporations/directory'));
          miss.append(go);
        }
        bodyEl.append(miss);
      } else {
        for (let i = 0; i < matches.length; i++) {
          bodyEl.append(mkRow(matches[i], { selected: i === sel, groupNote: matches[i].group }));
        }
      }
      return;
    }

    matches = [];

    if (ui.pins.length) {
      bodyEl.append(el('div', 'grp', `Pinned — Alt+1…${Math.min(ui.pins.length, CFG.PIN_MAX)}`));
      ui.pins.slice(0, CFG.PIN_MAX).forEach((href, i) => {
        bodyEl.append(mkRow({ href, label: labelFor(href) }, { kbd: i + 1 }));
      });
    }

    renderCasinos(bodyEl);

    if (recent.length) {
      bodyEl.append(el('div', 'grp', 'Recent'));
      for (const href of recent) bodyEl.append(mkRow({ href, label: labelFor(href) }));
    }

    for (const [group, items] of CATALOG) {
      bodyEl.append(el('div', 'grp', group));
      for (const [href, label, note] of items) bodyEl.append(mkRow({ href, label, note }));
    }

    const seen = otherCorps();
    if (seen.length) {
      bodyEl.append(el('div', 'grp', 'Corporations seen'));
      for (const c of seen) {
        bodyEl.append(mkRow({ href: `/corporations/${c.id}`, label: c.name, note: c.type ?? undefined }));
      }
    }
    const facs = Object.values(places.factions);
    if (facs.length) {
      bodyEl.append(el('div', 'grp', 'Factions seen'));
      for (const f of facs) bodyEl.append(mkRow({ href: `/factions/${f.id}`, label: f.name }));
    }
  }

  function paint() {
    if (!root || !panelEl) return;
    panelEl.style.display = ui.open ? 'flex' : 'none';
    if (!ui.open) return;

    const nCorps = Object.keys(places.corps).length;
    const nCas = casinoCorps().length;

    // header: refresh what it SAYS, never who it is
    covEl.textContent = `${nCas} casino${nCas === 1 ? '' : 's'} · ${nCorps} corp${nCorps === 1 ? '' : 's'} known`;

    // Assign only on a real difference. A paint() triggered by an ingest while you are
    // mid-word would otherwise rewrite the input and send the caret to the end.
    if (inputEl.value !== query) inputEl.value = query;

    renderBody();

    // footer
    const note = el('div');
    noteEl.replaceChildren(note);
    const bar = el('span');
    const mk = (label, fn) => { const b = el('button', 'act', label); b.style.marginRight = '4px'; b.addEventListener('click', fn); bar.append(b); return b; };
    mk('directory', () => jump('/corporations/directory'));
    mk('clear learned', () => {
      places = { corps: {}, casinos: {}, factions: {} };
      savePlaces(); paint();
    });
    note.append(bar);
    note.append(el('div', null,
      nCas
        ? 'passive · casinos come from directory rows you already paged past · the gate is whatever that corp page last told you, so travel makes it stale'
        : 'passive · no casinos learned yet — open the corporation directory once and every casino in it lands here'));

    // Restore the saved position the first time the panel is actually on screen — at
    // mount it is display:none, so the kit has no geometry to clamp or de-skew against.
    // After that only fit() runs: apply() would fight a drag in progress, since ui.panel
    // still holds the pre-drag position until the gesture ends.
    if (!placed) { placed = true; panelDrag.apply(ui.panel); }
    panelDrag.fit();
  }

  // ===========================================================================
  // Boot
  // ===========================================================================
  const typing = (t) => /^(input|textarea|select)$/i.test(t?.tagName || '') || t?.isContentEditable;

  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    // our own filter box lives in a shadow root, so e.target is the host — an Alt
    // chord is never something the game's chat box wants anyway
    if (typing(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === CFG.HOTKEY) { e.preventDefault(); toggle(); return; }
    if (/^[1-9]$/.test(e.key)) {
      const href = ui.pins[Number(e.key) - 1];
      if (href) { e.preventDefault(); jump(href); }
    }
  });

  const boot = () => {
    mount();
    paint();
    log(`ready ${VERSION} — passive · ${Object.keys(places.corps).length} corp(s), ${casinoCorps().length} casino(s) known`);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // console handle, same shape as the other tools in this repo
  window.__pkqj = {
    places: () => places,
    pins: () => ui.pins.slice(),
    recent: () => recent.slice(),
    destinations: () => allDestinations(),
    version: VERSION,
  };
})();
