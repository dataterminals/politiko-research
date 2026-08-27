// ==UserScript==
// @name         Politiko — Quick Jump
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.5.0
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
 *   Reads:    JSON bodies of /api/* responses via HTTP TAP v1, the shared passive
 *             fetch/XHR tap — only the ones the game requested on its own, on pages
 *             you are actively viewing, and only on the paths named below. Every
 *             tool in this repo now shares one tap rather than installing its own,
 *             so a response is cloned and parsed once for all of them instead of
 *             once each, and a path nobody subscribed to is never read at all.
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

  const VERSION = '0.5.0';
  const TAG = '[pk-quick-jump]';
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

  const CFG = {
    HOTKEY: 'j',        // Alt+J toggles the panel
    PANEL_W: 400,
    FAB_SIZE: 38,   // must match FAB KIT's .pk-fab box
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
  ui.size ??= null;      // {w, h} once you have dragged the panel's corner

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

  // Corporations and factions are the only ID-bearing routes this tool learns from;
  // everything else the app fetches is none of its business and is never parsed.
  onApi(['/api/corporations', '/api/factions'], ({ url, data }) => dispatch(url, data));

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

  /**
   * Jump, and STAY OPEN.
   *
   * It used to close on every destination, which is right for the one-shot case and
   * wrong for the case the tool actually exists to serve: walking a set. Paging six
   * casinos meant six round trips through Alt+J and six retypings of the filter, and
   * the panel is draggable and resizable now, so "it is in the way" has an answer
   * that is not "it disappears". Esc, the × and Alt+J all still close it, and the
   * current row is marked, so the list doubles as your place in the walk.
   *
   * Everything below the toggle is unchanged: one client-side route change carrying
   * the router's own index forward, which is the same event a link press raises.
   */
  const jump = (href) => {
    if (!href) return;
    remember(href);
    if (href !== here()) {
      const st = history.state;
      const idx = (st && Number.isFinite(st.idx) ? st.idx : 0) + 1;
      history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', href);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }
    // Recents changed and so did the current row, so the list is now stale either
    // way — including on a jump to where you already are.
    paint();
    // The route change re-renders the game's tree, which can take the focus with it.
    // Getting it back is what makes a second jump a keystroke rather than a click.
    requestAnimationFrame(() => inputEl?.focus());
  };

  // ===========================================================================
  // PANEL KIT v2 — shared verbatim block.
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
    /* FAB KIT v4 — shared verbatim block.
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

       v4 widens the row to thirteen slots, for poll-watch and shop-watch, which
       is the whole of the change. Half the row is written out below because CSS
       cannot count the tools that happen to be installed, which means every slot
       the row gains costs a version bump and a pass over every copy — the price
       of the row being one row rather than each tool's guess at one.

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 13; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       a thirteenth tool does not shuffle the twelve buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. The eye
       leads because it is the mark of the set; the words are alphabetical after it:

         0  the eye  people-watch     7  SOCK  ws-watch
         1  ALGN     align-watch      8  TIME  time-watch
         2  GOV      gov-watch        9  WRLD  world-watch
         3  JUMP     quick-jump      10  XP    xp-watch
         4  MKT      market-watch    11  POLL  poll-watch
         5  RAID     raid-watch      12  SHOP  shop-watch
         6  SLP      sleeper-watch

       POLL and SHOP are on the end rather than sorted in among the others, and
       that is deliberate: the alphabet describes how the first eleven were handed
       out, not a sort to be re-run. Slots are fixed, so a tool that arrives later
       takes the next free number and nothing already on screen moves.

       Thirteen 38px buttons 8px apart is a 590px row, so it runs 295px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1470px the row is centred,
       and below that it stops sliding left rather than climb onto the nav.

       Three numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 295 (half the row). Nothing else in here is placement.

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
      left: calc(max(440px, 50% - 295px) + var(--pk-slot, 0) * 46px);
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
    .fab { --pk-slot: 3; z-index: 2147483000; }
    .panel {
      position: fixed; right: 12px; bottom: 202px; width: ${CFG.PANEL_W}px;
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
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 0 6px; }
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
    /* the route you are standing on — the panel stays open across a jump, so the
       list has to be able to say where you got to */
    .row.now { color: #fbbf24; }
    .row.now .lb::after { content: ' ·'; color: #52525b; }
    .row.now::before {
      content: ''; position: absolute; left: 0; width: 2px; height: 18px; background: #fbbf24;
    }
    .row { position: relative; }
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
  let panelDrag = null, fabDrag = null, panelResize = null, placed = false;
  let query = '', sel = 0, matches = [];
  let lastQuery = null;   // what the body was last built from — see renderBody()

  const mount = () => {
    if (host) return;
    host = el('div');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483000';
    document.documentElement.append(host);
    root = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS; root.append(style);

    fab = el('div', 'pk-fab fab', 'JUMP');
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
    hdEl.title = 'Drag to move · drag the bottom-right corner to resize · double-click to reset both';
    hdEl.append(el('b', null, 'Quick Jump'), covEl, el('span', 'sp'), close);

    findEl = el('div', 'find');
    inputEl = el('input');
    inputEl.type = 'text';
    // The panel outlives a jump now, so the line that tells you how to leave has
    // to be in front of you rather than in a README.
    inputEl.placeholder = 'filter — ↑↓ pick · Enter jumps (stays open) · Esc closes';
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
    panelResize = resizable(panelEl, (size) => { ui.size = size; saveUi(); },
      { drag: panelDrag, minW: 260, minH: 200 });
    // Double-click the header undoes both — the recovery path for a panel dragged
    // or resized into uselessness.
    hdEl.addEventListener('dblclick', () => {
      ui.panel = null; ui.size = null; saveUi();
      panelDrag.reset(); panelResize.reset(); placed = true;
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
    // `now` marks the route you are standing on. It earns its keep because the panel
    // no longer closes on a jump: without it, a list you are walking gives you no
    // sign of how far you have got.
    const cur = d.href === here();
    const r = el('div', `row${opts.selected ? ' sel' : ''}${cur ? ' now' : ''}`);
    if (cur) r.setAttribute('aria-current', 'page');
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
    // A repaint throws the list away and builds a new one, which starts at scroll
    // zero. Harmless when nothing is happening, ruinous while you are walking a long
    // list — and since a jump now repaints instead of closing, that is the normal
    // case. (people-watch 1.3.2, same fix.)
    //
    // Retyping the filter is the one case where the top IS the right place: a new
    // query is a new list, and holding the old offset would open it halfway down.
    const keptScroll = query === lastQuery ? bodyEl.scrollTop : 0;
    lastQuery = query;
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
      bodyEl.scrollTop = keptScroll;
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

    bodyEl.scrollTop = keptScroll;
  }

  function paint() {
    if (!root || !panelEl) return;
    panelEl.style.display = ui.open ? 'flex' : 'none';
    fab.classList.toggle('pk-open', ui.open);   // the button says which window is up —
    if (!ui.open) return;                       // above the return, so closing reaches it

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
    if (!placed) { placed = true; panelDrag.apply(ui.panel); panelResize.apply(ui.size); }
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
