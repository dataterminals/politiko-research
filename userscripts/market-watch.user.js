// ==UserScript==
// @name         Politiko — Market Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      1.9.0
// @description  Marks where your own trades sit on the game's stock chart, and records numeric series out of market/API responses the app already fetched. Fully passive — it places no orders and originates no requests; a buy/sell rule hands you a sized shortcut to the stocks screen instead.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/market-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/market-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON bodies of GET /api/* responses the app requested on its own, via a
 *             passive fetch/XHR tap. No polling, no prefetch. Request bodies are not
 *             read at all.
 *
 *             ALSO, and this is new in 1.6.0: the stock chart on the page you are
 *             looking at. To draw a mark on that chart the script has to know where
 *             the chart puts things, so it reads the page's own chart object — the
 *             TradingView Lightweight Charts instance StocksPage creates — by walking
 *             React's fiber tree down from the chart's container element, and it
 *             measures that container's canvas with getBoundingClientRect(). It calls
 *             only read methods on what it finds: timeToCoordinate, priceToCoordinate,
 *             data(), and the two subscribe/unsubscribe pairs it needs to redraw when
 *             you pan or zoom. It never calls setData, applyOptions, remove, or
 *             anything else that would change the chart you are looking at.
 *   Requests: ZERO. This script does not originate network calls to politiko.io, and
 *             has no code path that could.
 *   Sends:    nothing, to anyone, ever. No telemetry, no remote config.
 *   Draws:    an overlay layer pinned over the game's chart, inside this script's own
 *             shadow root — not injected into the app's DOM. Pointer events are off on
 *             every node in it, so the chart underneath still pans, zooms and shows its
 *             crosshair exactly as it did. Both marks are switchable and the switches
 *             persist. Nothing is drawn while their switches are off.
 *   Storage:  localStorage keys prefixed `pkmw:` — observed price history, watch rules,
 *             your own trade history as the game reported it, and panel settings. All
 *             local. Clearable from the panel.
 *   Alerts:   in-page only, and only while the tab is visible. Alerts raised while
 *             hidden are queued and shown on return. No Notification API, no title
 *             flashing, no sound while backgrounded.
 *   Acts:     a buy/sell rule produces an alert with a button. The button navigates to
 *             the stocks screen — the same client-side route change as clicking Stocks
 *             yourself — and then best-effort selects the ticker and fills in the size,
 *             which is DOM interaction on the page you are now looking at. It stops
 *             there. The game's own confirm is the only thing that places an order and
 *             you press it. Nothing is automated, queued, or retried.
 *
 * HISTORY, stated plainly because the file used to say otherwise: versions up to 0.11.0
 * carried an order-execution seam — `registerExecutor()`, an arming switch, a session
 * cap, and a capture of the app's own write requests to learn the order shape from a
 * trade you placed by hand. Wiring it would have made this script originate write
 * requests to politiko.io, which the scripting clause prohibits under penalty of a game
 * ban. It shipped disabled and was never armed. As of 1.0.0 it is deleted outright —
 * the seam, the arming, the capture and the routes are gone, not switched off.
 */

(() => {
  'use strict';

  const TAG = '[pkmw]';
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
  // Config
  // ===========================================================================
  const CFG = {
    MAX_POINTS_PER_SERIES: 300,   // ring buffer depth
    MAX_SERIES: 400,              // total tracked series::field pairs
    MAX_TRADES: 600,              // your own fills, kept newest-first
    MAX_CANDLE_SETS: 24,          // symbol×timeframe candle sets held in memory
    REBIND_MS: 1_000,             // how often to look for a chart that has remounted
    MIN_SAMPLE_GAP_MS: 60_000,    // re-record an unchanged value at most this often
    SAVE_DEBOUNCE_MS: 2_000,
    DEFAULT_COOLDOWN_MS: 15 * 60_000,
    HOTKEY: 'm',                  // Alt+M toggles the panel
    PANEL_W: 430,
    PANEL_MIN_W: 240,
    PANEL_MIN_H: 160,
    FAB_SIZE: 38,   // must match FAB KIT's .pk-fab box
    EDGE: 8,                      // keep this much gap from the viewport edge
  };

  // h:null means "take whatever vertical room there is" — that's what makes
  // `sidebar` and `tall` dock properly instead of floating at a fixed height.
  // Width, height. A null height means "as tall as the room allows" — resolved
  // against the viewport when the button is pressed, because PANEL KIT's
  // resizable() takes real lengths and a preset that stays null cannot be one.
  const SIZE_PRESETS = [
    ['sidebar', 280, null],
    ['compact', 430, 380],
    ['tall', 430, null],
    ['wide', 640, 520],
  ];

  const K = { hist: 'pkmw:hist', rules: 'pkmw:rules', ui: 'pkmw:ui', ids: 'pkmw:ids',
    trades: 'pkmw:trades' };

  // ===========================================================================
  // Utils
  // ===========================================================================
  const now = () => Date.now();
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  const fmtNum = (v) =>
    Math.abs(v) >= 10000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : Number(v.toFixed(2)).toString();

  const fmtAgo = (t) => {
    const s = Math.max(0, (now() - t) / 1000);
    if (s < 60) return `${s | 0}s`;
    if (s < 3600) return `${(s / 60) | 0}m`;
    if (s < 86400) return `${(s / 3600) | 0}h`;
    return `${(s / 86400) | 0}d`;
  };

  const WINDOWS = [
    ['1m', 60_000], ['5m', 300_000], ['15m', 900_000],
    ['1h', 3_600_000], ['6h', 21_600_000], ['24h', 86_400_000],
  ];
  const winLabel = (ms) => (WINDOWS.find(([, v]) => v === ms) || [`${(ms / 60000) | 0}m`])[0];

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  /** el('div', 'cls', 'text') */
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };

  // ===========================================================================
  // Store — observed history, keyed "<series>::<field>" -> [[t, v], ...]
  // ===========================================================================
  const hist = readJSON(K.hist, {});
  let rules = readJSON(K.rules, []);
  const ui = Object.assign(
    { open: false, sound: true, deltaWin: 3_600_000, filter: '', expanded: {}, hidden: {},
      fab: null, panel: null, size: null, sizeBar: false,
      // Chart marks. Both draw over the game's own chart and both default on —
      // they are the point of the tool now, and one click turns either off.
      mark: true, costLine: true },
    readJSON(K.ui, {}),
  );

  // symbol-series -> the numeric key the API uses for it. Orders are addressed by
  // instrument_id, not by ticker, and SKIP_FIELD deliberately keeps *_id out of
  // the price series — so the mapping has to be kept on the side.
  const entityIds = new Map(Object.entries(readJSON(K.ids, {})));
  const saveIds = () => writeJSON(K.ids, Object.fromEntries(entityIds));

  let saveTimer = null;
  const saveSoon = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; prune(); writeJSON(K.hist, hist); }, CFG.SAVE_DEBOUNCE_MS);
  };
  const saveRules = () => writeJSON(K.rules, rules);
  const saveUI = () => writeJSON(K.ui, ui);

  function prune() {
    const keys = Object.keys(hist);
    if (keys.length <= CFG.MAX_SERIES) return;
    keys
      .map((k) => [k, hist[k].length ? hist[k][hist[k].length - 1][0] : 0])
      .sort((a, b) => a[1] - b[1])
      .slice(0, keys.length - CFG.MAX_SERIES)
      .forEach(([k]) => delete hist[k]);
  }

  /**
   * True when a series belongs to a hidden group AND no live rule depends on it.
   * Hidden groups stop consuming the history budget, but a group you've muted
   * can't silently kill a rule you left running on it.
   */
  function muted(series) {
    if (!ui.hidden[splitSeries(series)[0]]) return false;
    return !rules.some((r) => r.enabled && r.series === series);
  }

  /** Append a sample, deduping unchanged values inside MIN_SAMPLE_GAP_MS. */
  function record(series, field, value, t = now()) {
    if (muted(series)) return null;
    const key = `${series}::${field}`;
    let arr = hist[key];
    if (!arr) arr = hist[key] = [];

    const last = arr[arr.length - 1];
    if (last) {
      if (last[1] === value && t - last[0] < CFG.MIN_SAMPLE_GAP_MS) return null;
      if (t - last[0] < 250) return null; // same render pass, ignore
    }

    arr.push([t, value]);
    if (arr.length > CFG.MAX_POINTS_PER_SERIES) arr.splice(0, arr.length - CFG.MAX_POINTS_PER_SERIES);
    saveSoon();
    return { key, series, field, value, t, prev: last ? last[1] : null };
  }

  /** Value at or before (now - windowMs); falls back to the oldest point held. */
  function baselineAt(key, windowMs) {
    const arr = hist[key];
    if (!arr || !arr.length) return null;
    const cutoff = now() - windowMs;
    let chosen = null;
    for (const p of arr) { if (p[0] <= cutoff) chosen = p; else break; }
    return chosen || arr[0];
  }

  const latest = (key) => {
    const arr = hist[key];
    return arr && arr.length ? arr[arr.length - 1] : null;
  };

  function deltaPct(key, windowMs) {
    const last = latest(key);
    if (!last) return null;
    const base = baselineAt(key, windowMs);
    if (!base || base === last || !(base[1] > 0)) return null;
    return ((last[1] - base[1]) / base[1]) * 100;
  }

  /** A field that has never moved across every point we hold — metadata, not a price. */
  function isStatic(key) {
    const a = hist[key];
    if (!a || a.length < 3) return false;
    return a.every((p) => p[1] === a[0][1]);
  }

  // ===========================================================================
  // Sampler — turn an arbitrary API payload into (series, field, number) tuples
  //
  // Schema-agnostic on purpose: this learns whatever numeric fields arrive and
  // self-populates the panel. Works for arrays of records, keyed maps, and flat
  // objects alike.
  // ===========================================================================
  const ID_KEYS = ['symbol', 'ticker', 'code', 'city', 'name', 'slug', 'company',
    'corp', 'corporation', 'stock', 'title', 'label', 'key'];
  const SKIP_FIELD = /(^|_)id$|_at$|^created|^updated|timestamp|version|^page$|^limit$|^offset$|^total_pages$/i;

  /** @returns {[key: string, label: string] | null} */
  function identityOf(obj) {
    for (const k of ID_KEYS) if (typeof obj[k] === 'string' && obj[k].trim()) return [k, obj[k].trim()];
    for (const k of ID_KEYS) if (isNum(obj[k])) return [k, String(obj[k])];
    if (isNum(obj.id)) return ['id', `#${obj.id}`];
    return null;
  }

  function scopeOf(url) {
    try {
      const segs = new URL(url, location.origin).pathname.split('/').filter(Boolean);
      const i = segs.indexOf('api');
      const rest = i >= 0 ? segs.slice(i + 1) : segs;
      const named = rest.filter((s) => !/^\d+$/.test(s) && s !== 'public');
      return named.join('/') || 'api';
    } catch { return 'api'; }
  }

  function harvest(obj, scope, out, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 5) return;

    // An array is a list of peers: each element keeps the parent's scope and
    // is expected to carry its own identity.
    if (Array.isArray(obj)) {
      for (const item of obj) harvest(item, scope, out, depth + 1);
      return;
    }

    const ident = identityOf(obj);
    const self = ident ? `${scope}/${ident[1]}` : scope;
    const idKey = ident ? ident[0] : null;

    // Remember this entity's numeric key while we can still see it next to the
    // ticker. Orders need it and the series data never carries it.
    //
    // `sure` tracks whether this is definitely the *instrument* id. A field
    // literally named instrument_id is unambiguous; a bare `id` only is when it
    // came off the instruments list. A holding almost certainly has its own id in
    // a different space, and sending that as instrument_id would trade the wrong
    // stock — so an unsure id is recorded but never used to place an order.
    if (ident) {
      const rec = isNum(obj.instrument_id) ? { id: obj.instrument_id, sure: true }
        : isNum(obj.id) ? { id: obj.id, sure: /instrument/i.test(scope) }
          : null;
      const had = entityIds.get(self);
      if (rec && (!had || had.id !== rec.id || had.sure !== rec.sure)) {
        entityIds.set(self, rec);
        saveIds();
      }
    }

    for (const [k, v] of Object.entries(obj)) {
      if (isNum(v) && k !== idKey && !SKIP_FIELD.test(k)) out.push([self, k, v]);
    }

    // Recurse. A nested *object* names a sub-scope ({markets:{riga:{...}}} ->
    // "scope/markets/riga"); a nested *array* is just a collection, so it keeps
    // this object's scope ({data:[...]} -> "scope").
    for (const [k, v] of Object.entries(obj)) {
      if (!v || typeof v !== 'object') continue;
      harvest(v, Array.isArray(v) ? self : `${self}/${k}`, out, depth + 1);
    }
  }

  function ingest(url, data) {
    const scope = scopeOf(url);
    const out = [];
    try { harvest(data, scope, out); } catch (e) { return log('harvest error', e); }
    if (!out.length) return;

    const events = [];
    for (const [series, field, value] of out) {
      const ev = record(series, field, value);
      if (ev) events.push(ev);
    }
    if (events.length) {
      for (const ev of events) evaluate(ev);
      refresh();
    }
  }

  // ===========================================================================
  // Passive tap — reads responses already in flight. Adds no requests.
  // ===========================================================================
  // The one honest '*' in this repo: market-watch derives a series scope from whatever
  // path a response arrived on and harvests any numbers in it, so narrowing the
  // subscription would silently stop it charting endpoints it charts today. It still
  // costs one clone and one parse for everyone rather than one each.
  // Two paths are read by the ledger below and deliberately NOT charted:
  //
  //   /stocks/trades      the sampler turns your own fills into a "price" series —
  //                       stocks/trades/PNRG :: price_per_share, wandering between
  //                       whatever you last paid — which looks exactly like a quote
  //                       and is not one. Charting your fills as a market price is
  //                       worse than not charting them.
  //   .../candles         a 150-bar OHLCV array collapses to one row per response,
  //                       so the series is whichever bar the walk happened to end
  //                       on. It has no meaning at all.
  //
  // Everything else still goes through the '*' harvest untouched. `holdings` and
  // `instruments` in particular stay charted: those ARE series, and position
  // sizing reads holdings out of the same store.
  const NOT_A_SERIES = (path) => path === '/api/stocks/trades' || CANDLES_RE.test(path);

  onApi('*', ({ url, path, method, data }) => {
    if (!NOT_A_SERIES(path)) ingest(url, data);
    if (method !== 'GET' || !data) return;
    let touched = false;
    if (path === '/api/stocks/trades') touched = absorbTrades(data);
    else if (path === '/api/stocks/holdings') touched = absorbHoldings(data);
    else if (CANDLES_RE.test(path)) touched = absorbCandles(url, path, data);
    if (touched) { drawSoon(); refresh(); }
  });

  // ===========================================================================
  // Stock ledger — the three stock responses this tool reads for their SHAPE
  // rather than for the numbers in them.
  //
  // The sampler above already harvests every number here into a time series, and
  // that is the wrong representation for this job: a mark on a chart needs a
  // trade's game day and a candle's bucket boundary, which are facts about single
  // records, not about how a value moved. So these three keep the record.
  //
  // Nothing here originates a request. Each response arrives only when the player
  // is looking at the screen that asks for it, and `trades` in particular sits
  // behind the stocks page's `history` tab — so until that tab has been opened
  // once, this tool holds no trades and says so rather than guessing at one.
  // ===========================================================================
  // >>> ENGINE START
  // Lifted verbatim by userscripts/tools/test-market-chart.js. Everything between
  // these two markers is pure: no DOM, no storage, no clock, nothing it was not
  // handed. Keep it that way — this is the arithmetic that decides where a mark
  // lands, and it is the part that has to be checkable without the game.
  //
  // The one thing it borrows from outside is `isNum`, from Utils; the test declares
  // its own copy in the preamble.
  const GAME_DAY_SECS = 86_400;
  const GAME_YEAR_SECS = 31_536_000;
  const GAME_MONTH_SECS = 2_592_000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * Game-seconds -> the calendar the game renders. Same three constants the app
   * uses; see docs/06-time-surface.md.
   *
   * One deliberate difference: the month index is clamped at 11, so the five
   * overflow days (a game year is 365 days but twelve 30-day months is 360) read
   * as December 31-35. The game's own chart formatter skips that clamp and prints
   * `undefined` for them. We are not copying the bug — and the number we lead with
   * is the raw game day anyway, which is exactly what the game's history table
   * shows, so the two can always be checked against each other.
   */
  function gameDate(sec) {
    const year = Math.floor(sec / GAME_YEAR_SECS) + 1;
    const inYear = sec % GAME_YEAR_SECS;
    const month = Math.min(Math.floor(inYear / GAME_MONTH_SECS), 11);
    const day = Math.floor((inYear - month * GAME_MONTH_SECS) / GAME_DAY_SECS) + 1;
    return `Yr${year} ${MONTHS[month]} ${day}`;
  }

  /**
   * Bucket width in game-seconds, taken from the bars themselves. The response
   * carries `bucket_secs`, but bars read back off a live chart do not, and the
   * median gap survives a hole in the series where a mean would not.
   */
  function bucketOf(bars) {
    if (!bars || bars.length < 2) return GAME_DAY_SECS;
    const gaps = [];
    for (let i = 1; i < bars.length; i++) {
      const g = bars[i].time - bars[i - 1].time;
      if (g > 0) gaps.push(g);
    }
    if (!gaps.length) return GAME_DAY_SECS;
    gaps.sort((a, b) => a - b);
    return gaps[gaps.length >> 1];
  }

  // `margin_open` is a purchase that happens to be financed, so it counts. Opening
  // a short does not: that is a sale, and marking it as a buy would misstate which
  // way you are facing on the position.
  const BUY_TYPES = new Set(['buy', 'margin_open']);

  /** Newest purchase out of an already-sorted list. */
  const pickLastBuy = (list) => list.find((t) => BUY_TYPES.has(t.trade_type)) || null;

  /**
   * Where a fill sits among a chart's bars.
   *
   * A trade carries `game_day` and nothing finer, so it covers the whole span
   * [day*86400, (day+1)*86400). Which bars that touches depends on the timeframe:
   *
   *   1w   a bar is seven days  -> one bar, and the day is finer than the bar
   *   1d   a bar is the day     -> exactly one bar
   *   4h   six bars per day     -> six bars, and the mark has to be a band
   *
   * Returns bar indexes, or one of the three "not on this chart" shapes. The
   * `impossible` case is the one that matters: a fill later than the newest bar
   * cannot be a fill we placed badly, it means `game_day` is not the absolute day
   * we read it as — so it refuses to draw rather than put a mark somewhere it
   * cannot defend.
   */
  function placeTrade(trade, bars, bucketSecs) {
    if (!bars || bars.length < 2 || !isNum(trade.game_day)) return null;
    const start = trade.game_day * GAME_DAY_SECS;
    const end = start + GAME_DAY_SECS;
    const first = bars[0].time;
    const last = bars[bars.length - 1].time + bucketSecs;

    if (start >= last + GAME_DAY_SECS) return { impossible: true };
    if (end <= first) return { before: true, days: Math.round((first - end) / GAME_DAY_SECS) };
    if (start >= last) return { after: true, days: Math.round((start - last) / GAME_DAY_SECS) };

    const idxAt = (sec) => {
      let lo = 0, hi = bars.length - 1, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].time <= sec) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };
    const from = idxAt(Math.max(start, first));
    const to = idxAt(Math.min(end - 1, last - 1));
    return { from, to, exact: from === to, span: to - from + 1 };
  }

  /**
   * Is the chart on screen showing the symbol we think it is?
   *
   * Bar TIMES cannot answer this — every instrument on one timeframe shares the
   * same bucket boundaries, so PNRG and RCRD look identical by time. Closes can:
   * find a settled bar (never the last one, which the socket is still updating)
   * that both the chart and our own candle set hold, and compare it.
   *
   * Returns true / false / null for "no shared bar to compare yet". Only true
   * draws a trade mark, because the failure this guards against — a PNRG fill
   * marked on an RCRD chart — is worse than drawing nothing at all.
   */
  function sameSymbol(chartBars, setBars) {
    if (!setBars || !chartBars || chartBars.length < 2) return null;
    const byTime = new Map(setBars.map((b) => [b.time, b]));
    for (let i = chartBars.length - 2; i >= 0 && i >= chartBars.length - 8; i--) {
      const mine = byTime.get(chartBars[i].time);
      if (!mine) continue;
      return Math.abs(mine.close - chartBars[i].close) < 1e-6;
    }
    return null;
  }
  // <<< ENGINE END

  const trades = readJSON(K.trades, {});          // id -> record
  const saveTrades = () => writeJSON(K.trades, trades);

  // Candles are deliberately NOT persisted. They are large, they are stale within
  // minutes, and the only thing that wants them is a chart that is on screen now.
  const candleSets = new Map();   // `${SYMBOL}:${tf}` -> { symbol, tf, bars, bucketSecs, at }
  const positions = new Map();    // SYMBOL -> { shares, avgCost, price, pnl, at }
  let chartView = null;           // { symbol, tf } — the last candle set the app asked for

  const CANDLES_RE = /^\/api\/stocks\/instruments\/[^/]+\/candles$/;

  // The fields a trade record carries, read off the bundle 2026-09-07. `game_day`
  // is the one this tool is really after: it is a whole absolute game day, the
  // same count `bucket_start / 86400` gives, which is what lets a fill be placed
  // against a candle at all.
  const TRADE_FIELDS = ['id', 'game_day', 'symbol', 'trade_type', 'shares',
    'price_per_share', 'total_cash', 'realized_pnl'];

  function absorbTrades(data) {
    const list = Array.isArray(data.trades) ? data.trades : Array.isArray(data) ? data : null;
    if (!list) return false;
    let added = 0;
    for (const t of list) {
      if (!t || t.id == null || !isNum(t.game_day)) continue;
      const key = String(t.id);
      if (trades[key]) continue;
      const rec = { seenAt: now() };
      for (const f of TRADE_FIELDS) if (t[f] !== undefined) rec[f] = t[f];
      trades[key] = rec;
      added++;
    }
    if (!added) return false;
    const keys = Object.keys(trades);
    if (keys.length > CFG.MAX_TRADES) {
      keys.sort((a, b) => (trades[b].game_day - trades[a].game_day) || (Number(b) - Number(a)));
      for (const k of keys.slice(CFG.MAX_TRADES)) delete trades[k];
    }
    saveTrades();
    return true;
  }

  function absorbHoldings(data) {
    const list = Array.isArray(data.holdings) ? data.holdings : Array.isArray(data) ? data : null;
    if (!list) return false;
    for (const h of list) {
      if (!h || typeof h.symbol !== 'string') continue;
      positions.set(h.symbol.toUpperCase(), {
        shares: isNum(h.shares) ? h.shares : null,
        avgCost: isNum(h.avg_cost) ? h.avg_cost : null,
        price: isNum(h.current_price) ? h.current_price : null,
        pnl: isNum(h.unrealized_pnl) ? h.unrealized_pnl : null,
        at: now(),
      });
    }
    return true;
  }

  function absorbCandles(url, path, data) {
    if (!Array.isArray(data.candles)) return false;
    // The path segment is the TICKER, not a numeric id — StocksPage builds this
    // URL from the symbol and looks the id up separately. That is what makes the
    // response self-identifying, and why nothing here needs a symbol→id map.
    const symbol = decodeURIComponent(path.split('/')[4] || '').toUpperCase();
    let tf = '';
    try { tf = new URL(url, location.origin).searchParams.get('tf') || ''; } catch { /* keep '' */ }

    const bars = data.candles
      .filter((c) => c && isNum(c.bucket_start) && isNum(c.close))
      .map((c) => ({ time: c.bucket_start, open: c.open, high: c.high, low: c.low, close: c.close }))
      .sort((a, b) => a.time - b.time);
    if (bars.length < 2) return false;

    candleSets.set(`${symbol}:${tf}`, {
      symbol, tf, bars, at: now(),
      bucketSecs: isNum(data.bucket_secs) ? data.bucket_secs : bucketOf(bars),
    });
    // A candles fetch is the app announcing which stock and timeframe the chart is
    // about to show: the chart component is keyed on exactly that pair, so it
    // remounts with it. Steadier than reading the header text, and it costs nothing.
    chartView = { symbol, tf };
    while (candleSets.size > CFG.MAX_CANDLE_SETS) {
      candleSets.delete(candleSets.keys().next().value);
    }
    return true;
  }

  /** Your fills for one symbol, newest game day first. */
  function tradesFor(symbol) {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return [];
    return Object.values(trades)
      .filter((t) => String(t.symbol || '').toUpperCase() === sym)
      .sort((a, b) => (b.game_day - a.game_day) || (Number(b.id) - Number(a.id)));
  }

  const lastBuyFor = (symbol) => pickLastBuy(tradesFor(symbol));

  // ===========================================================================
  // Rules
  //
  //   { id, series, field, op, value, windowMs, cooldownMs, action, enabled,
  //     lastFiredAt }
  //
  // ops:  above / below            — absolute level
  //       pctUp / pctDown          — % move vs the value `windowMs` ago
  //       absUp / absDown          — absolute move vs the value `windowMs` ago
  //       rateUp / rateDown        — units per minute across the window
  // ===========================================================================
  const OPS = {
    above:    { label: 'rises to / above',    unit: '',     needsWindow: false },
    below:    { label: 'falls to / below',    unit: '',     needsWindow: false },
    pctUp:    { label: 'gains at least',      unit: '%',    needsWindow: true },
    pctDown:  { label: 'drops at least',      unit: '%',    needsWindow: true },
    absUp:    { label: 'gains at least',      unit: '',     needsWindow: true },
    absDown:  { label: 'drops at least',      unit: '',     needsWindow: true },
    rateUp:   { label: 'rising faster than',  unit: '/min', needsWindow: true },
    rateDown: { label: 'falling faster than', unit: '/min', needsWindow: true },
  };

  function testRule(rule, ev) {
    const v = ev.value;
    if (rule.op === 'above') return v >= rule.value ? { v } : null;
    if (rule.op === 'below') return v <= rule.value ? { v } : null;

    const base = baselineAt(ev.key, rule.windowMs);
    if (!base) return null;
    const b = base[1];
    const dt = Math.max(1 / 60, (ev.t - base[0]) / 60_000); // minutes, floored at 1s
    const delta = v - b;

    switch (rule.op) {
      case 'pctUp':    return b > 0 && (delta / b) * 100 >= rule.value ? { v, b, pct: (delta / b) * 100 } : null;
      case 'pctDown':  return b > 0 && (-delta / b) * 100 >= rule.value ? { v, b, pct: (delta / b) * 100 } : null;
      case 'absUp':    return delta >= rule.value ? { v, b, delta } : null;
      case 'absDown':  return -delta >= rule.value ? { v, b, delta } : null;
      case 'rateUp':   return delta / dt >= rule.value ? { v, b, rate: delta / dt } : null;
      case 'rateDown': return -delta / dt >= rule.value ? { v, b, rate: delta / dt } : null;
      default: return null;
    }
  }

  function evaluate(ev) {
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (rule.series !== ev.series || rule.field !== ev.field) continue;
      if (rule.lastFiredAt && now() - rule.lastFiredAt < rule.cooldownMs) continue;

      const hit = testRule(rule, ev);
      if (!hit) continue;

      rule.lastFiredAt = now();
      saveRules();
      fire(rule, ev, hit);
    }
  }

  function describe(rule, ev, hit) {
    const o = OPS[rule.op];
    const head = `${shortSeries(rule.series)} · ${rule.field}`;
    let body;
    if (rule.op === 'above' || rule.op === 'below') {
      body = `${o.label} ${fmtNum(rule.value)} — now ${fmtNum(hit.v)}`;
    } else if (hit.pct !== undefined) {
      body = `${hit.pct >= 0 ? '+' : ''}${hit.pct.toFixed(2)}% over ${winLabel(rule.windowMs)} (${fmtNum(hit.b)} → ${fmtNum(hit.v)})`;
    } else if (hit.rate !== undefined) {
      body = `${hit.rate >= 0 ? '+' : ''}${fmtNum(hit.rate)}/min over ${winLabel(rule.windowMs)} (now ${fmtNum(hit.v)})`;
    } else {
      body = `${hit.delta >= 0 ? '+' : ''}${fmtNum(hit.delta)} over ${winLabel(rule.windowMs)} (${fmtNum(hit.b)} → ${fmtNum(hit.v)})`;
    }
    return { head, body };
  }

  // ===========================================================================
  // Firing — a rule produces an alert, and at most a shortcut.
  //
  // Nothing here places an order. A buy/sell rule works out the size at the moment
  // it fires (which is the point of resolving late — a sell is clamped to what the
  // holdings series says you actually hold) and offers a button that takes you to
  // the stocks screen with the instrument picked and the number filled in. The
  // game's own confirm is the only thing that trades, and you press it.
  // ===========================================================================
  function fire(rule, ev, hit) {
    const d = describe(rule, ev, hit);
    if (rule.action === 'notify') { toast('alert', d.head, d.body); return; }

    const side = rule.action === 'sell' ? 'sell' : 'buy';
    const sym = shortSeries(rule.series);
    const price = priceFor(rule.series, ev.value);
    const { shares, why } = resolveQty(rule, price);

    if (shares === null) {
      toast('warn', `${side.toUpperCase()} SIGNAL — ${sym}`,
        `${d.body}\nNo size worked out: ${why}.`);
      return;
    }

    toast('alert', `${side.toUpperCase()} SIGNAL — ${sym}`,
      `${d.body}\n${side} ${fmtNum(shares)} sh — ${why}`, [{
        label: `${side} ${fmtNum(shares)} sh →`,
        title: `open the stocks screen with ${sym} selected and ${fmtNum(shares)} filled in. `
          + 'This places no order — you confirm the trade in the game.',
        run: () => jumpToTrade(rule.series, shares),
      }]);
  }

  /**
   * The same client-side navigation as clicking Stocks yourself, followed by a
   * best-effort attempt to save you the scrolling: select the ticker, fill the size.
   * It sends nothing. Every part after the navigation is optional — if the markup
   * has moved since this was written you are still on the right screen, and the
   * number is still sitting in the alert.
   */
  function jumpToTrade(series, shares) {
    const sym = shortSeries(series);
    if (location.pathname !== '/stocks') {
      history.pushState({}, '', '/stocks');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    let tries = 0;
    const tick = () => {
      if (++tries > 20) return;                       // ~3s, then give up quietly
      let done = false;
      try { done = selectSymbol(sym) && fillQty(shares); } catch { /* best effort */ }
      if (!done) setTimeout(tick, 150);
    };
    setTimeout(tick, 150);
  }

  /**
   * Click the ticker. Matches on the symbol's own text rather than any class name,
   * because generated classes change every deploy — and only on a leaf whose entire
   * text IS the symbol, so this can never land on a Buy or Sell button.
   *
   * The click goes on the leaf, not the row around it. A click bubbles up, so a
   * handler on the row still sees it; going the other way does not, and a handler
   * bound to the cell would be missed entirely.
   */
  function selectSymbol(sym) {
    const leaf = [...document.querySelectorAll('span,div,td,b,strong,p,a,button')]
      .find((n) => !n.children.length && n.textContent.trim() === sym && n.offsetParent !== null);
    if (!leaf) return false;
    leaf.click();
    return true;
  }

  /** React ignores a plain .value assignment, so go through the native setter. */
  function fillQty(shares) {
    if (!(shares > 0)) return true;
    const input = [...document.querySelectorAll('input')].find((i) => i.offsetParent !== null
      && (i.type === 'number' || /qty|quantity|share|amount/i.test(`${i.name}${i.id}${i.placeholder}`)));
    if (!input) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, String(shares));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /** Current price for sizing: the series' headline field, not whatever tripped the rule. */
  function priceFor(series, fallback) {
    const fields = seriesIndex().get(series) || [];
    if (!fields.length) return fallback;
    const l = latest(`${series}::${headlineField(series, fields)}`);
    return l ? l[1] : fallback;
  }

  // ===========================================================================
  // Alerts — in-page only, and only while visible.
  // ===========================================================================
  const pending = [];

  function toast(kind, head, body, actions) {
    if (document.visibilityState !== 'visible') { pending.push([kind, head, body, actions]); return; }
    paintToast(kind, head, body, actions);
    if (ui.sound && kind !== 'ok') beep(kind === 'err' ? 220 : 880);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const queued = pending.splice(0);
    if (!queued.length) return;
    if (queued.length <= 3) queued.forEach((a) => paintToast(...a));
    else paintToast('alert', `${queued.length} alerts while you were away`,
      queued.map(([, h, b]) => `• ${h} — ${b.split('\n')[0]}`).join('\n'));
  });

  let audioCtx = null;
  function beep(freq) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') return; // needs a user gesture; skip silently
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.36);
    } catch { /* no audio, no problem */ }
  }

  // ===========================================================================
  // Derived views
  // ===========================================================================
  /** Headline field preference — first match wins, statics excluded. */
  const HEADLINE = ['price', 'last', 'value', 'close', 'mid', 'mark', 'rate',
    'ask', 'bid', 'amount', 'owed', 'balance'];

  function seriesIndex() {
    const idx = new Map();
    for (const key of Object.keys(hist)) {
      const i = key.lastIndexOf('::');
      const s = key.slice(0, i), f = key.slice(i + 2);
      if (!idx.has(s)) idx.set(s, []);
      idx.get(s).push(f);
    }
    return idx;
  }

  const splitSeries = (s) => {
    const i = s.lastIndexOf('/');
    return i < 0 ? ['', s] : [s.slice(0, i), s.slice(i + 1)];
  };
  const shortSeries = (s) => splitSeries(s)[1] || s;

  /** Map<groupPath, [{ series, entity, fields }]>, biggest group first. */
  function groupsOf() {
    const groups = new Map();
    for (const [s, fields] of seriesIndex()) {
      const [g, entity] = splitSeries(s);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ series: s, entity, fields: fields.slice().sort() });
    }
    for (const list of groups.values()) list.sort((a, b) => a.entity.localeCompare(b.entity));
    return new Map([...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])));
  }

  function headlineField(series, fields) {
    const live = fields.filter((f) => !isStatic(`${series}::${f}`));
    const pool = live.length ? live : fields;
    for (const h of HEADLINE) if (pool.includes(h)) return h;
    // Substring pass, so current_price / last_price / mid_price resolve to a
    // price instead of falling through to whatever happens to sort first.
    for (const h of HEADLINE) {
      const hit = pool.find((f) => f.includes(h));
      if (hit) return hit;
    }
    return pool[0];
  }

  // ---------------------------------------------------------------------------
  // Position sizing — "how many shares" resolved against what you actually hold.
  //
  // Field names are guessed from a preference list rather than hardcoded to
  // Politiko's schema, and every guess is overridable per rule, because the only
  // holdings field confirmed so far is `current_price`.
  // ---------------------------------------------------------------------------
  const HOLDING_GROUPS = ['holding', 'portfolio', 'position', 'owned', 'inventory'];
  const QTY_FIELDS = ['shares', 'quantity', 'qty', 'units', 'owned', 'held', 'position', 'count'];
  const CASH_FIELDS = ['cash', 'balance', 'money', 'funds', 'available', 'wallet', 'liquid'];

  // Position fields stay prominent even while they sit still. `shares` reading 1
  // for an hour means you hold one share, not that the field is immutable the
  // way ipo_game_day is — and it's the field sizing reads, so greying it out
  // hides the most important number on the row.
  const NEVER_DEMOTE = new Set([...QTY_FIELDS, 'avg_cost', 'cost_basis', 'book_cost',
    'unrealized_pnl', 'realized_pnl', 'market_value']);

  /** Visually de-emphasise a field: unchanged so far AND not position state. */
  const demoted = (series, field) =>
    isStatic(`${series}::${field}`) && !NEVER_DEMOTE.has(field);

  /** The holdings-side series for the same symbol, if one has been observed. */
  function holdingSeriesFor(series) {
    const sym = shortSeries(series);
    const [ownGroup] = splitSeries(series);
    if (HOLDING_GROUPS.some((h) => ownGroup.toLowerCase().includes(h))) return series;
    for (const s of seriesIndex().keys()) {
      if (s === series || shortSeries(s) !== sym) continue;
      const [g] = splitSeries(s);
      if (HOLDING_GROUPS.some((h) => g.toLowerCase().includes(h))) return s;
    }
    return null;
  }

  /** @returns {{ qty: number, source: string } | null} */
  function heldShares(series, fieldOverride) {
    const hs = holdingSeriesFor(series) || series;
    const fields = seriesIndex().get(hs) || [];
    const candidates = fieldOverride ? [fieldOverride] : QTY_FIELDS;
    for (const f of candidates) {
      if (!fields.includes(f)) continue;
      const l = latest(`${hs}::${f}`);
      if (l) return { qty: l[1], source: `${hs}::${f}` };
    }
    return null;
  }

  /** @returns {{ cash: number, source: string } | null} */
  function cashAvailable() {
    for (const [s, fields] of seriesIndex()) {
      for (const f of CASH_FIELDS) {
        if (!fields.includes(f)) continue;
        const l = latest(`${s}::${f}`);
        if (l) return { cash: l[1], source: `${s}::${f}` };
      }
    }
    return null;
  }

  /**
   * Turn a rule's quantity spec into a concrete share count, at fire time.
   * Never returns more than is held for a sell — the clamp is the whole point
   * of resolving late rather than storing a fixed number.
   * @returns {{ shares: number|null, why: string }}
   */
  function resolveQty(rule, price) {
    const q = rule.qty;
    if (!q || !q.mode) return { shares: null, why: 'no quantity set on this rule' };
    if (q.mode !== 'all' && !Number.isFinite(q.value)) return { shares: null, why: 'enter a size' };
    const selling = rule.action === 'sell';
    const held = heldShares(rule.series, q.field);

    const clamp = (n) => {
      if (!selling || !held) return { n, note: '' };
      if (n > held.qty) return { n: held.qty, note: ` (capped at ${fmtNum(held.qty)} held)` };
      return { n, note: '' };
    };

    switch (q.mode) {
      case 'shares': {
        const { n, note } = clamp(q.value);
        // The clamp is the safety net; say so out loud when there's nothing to
        // clamp against, rather than implying a check that didn't happen.
        const unverified = selling && !held ? ' — holding UNVERIFIED, no share count observed' : '';
        return { shares: n, why: `${fmtNum(n)} shares${note}${unverified}` };
      }
      case 'all': {
        if (!held) return { shares: null, why: 'holdings not observed yet — open the portfolio screen once' };
        return { shares: held.qty, why: `all ${fmtNum(held.qty)} held (${held.source})` };
      }
      case 'pctHeld': {
        if (!held) return { shares: null, why: 'holdings not observed yet — open the portfolio screen once' };
        const n = Math.floor((held.qty * q.value) / 100);
        if (n < 1) return { shares: null, why: `${q.value}% of ${fmtNum(held.qty)} held rounds to zero` };
        return { shares: n, why: `${q.value}% of ${fmtNum(held.qty)} held` };
      }
      case 'cash': {
        if (!(price > 0)) return { shares: null, why: 'no current price to size against' };
        let n = Math.floor(q.value / price);
        let note = `${fmtNum(q.value)} at ${fmtNum(price)}`;
        const cash = cashAvailable();
        if (cash && cash.cash < q.value) {
          n = Math.floor(cash.cash / price);
          note += ` (limited to ${fmtNum(cash.cash)} available)`;
        }
        if (n < 1) return { shares: null, why: `${note} buys less than one share` };
        const c = clamp(n);
        return { shares: c.n, why: `${note}${c.note}` };
      }
      default:
        return { shares: null, why: `unknown quantity mode "${q.mode}"` };
    }
  }

  const QTY_MODES = {
    pctHeld: { label: '% of holding', unit: '%', needsValue: true },
    shares:  { label: 'exactly N shares', unit: 'sh', needsValue: true },
    all:     { label: 'everything held', unit: '', needsValue: false },
    cash:    { label: 'spend amount', unit: '$', needsValue: true },
  };

  /** One-line human summary of a rule's sizing, for the rules list. */
  function qtyLabel(rule) {
    const q = rule.qty;
    if (!q || !q.mode) return '';
    const m = QTY_MODES[q.mode];
    if (!m) return '';
    return m.needsValue ? `${fmtNum(q.value)}${m.unit}` : m.label;
  }

  function sparkline(key) {
    const arr = hist[key] || [];
    const pts = arr.slice(-40);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sk');
    svg.setAttribute('viewBox', '0 0 50 15');
    svg.setAttribute('preserveAspectRatio', 'none');
    if (pts.length < 2) return svg;

    const vs = pts.map((p) => p[1]);
    const min = Math.min(...vs), max = Math.max(...vs);
    const span = (max - min) || 1;
    const d = pts.map((p, i) =>
      `${((i / (pts.length - 1)) * 50).toFixed(1)},${(14 - ((p[1] - min) / span) * 13).toFixed(1)}`).join(' ');

    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points', d);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.setAttribute('stroke', vs[vs.length - 1] >= vs[0] ? '#22c55e' : '#ef4444');
    svg.append(line);
    return svg;
  }

  // PANEL KIT v3 — shared verbatim block, see userscripts/_template.user.js.
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
    // A hidden tab and a minimised window both report a ~zero viewport. Clamping
    // against that pins the element into the top-left corner — and then onMove()
    // SAVES it, so the stored position is (-44, -38) forever after and the element
    // has permanently left wherever it belonged. Five of sixteen buttons landed
    // there the first time tools/harness/row.html ran. Treat a viewport that small
    // as no information, the same as the placement layer already does.
    const usable = () => window.innerWidth > 120 && window.innerHeight > 120;

    const fit = () => {
      if (!usable()) return false;
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
  // ===================== end PANEL KIT v3 ====================================

  // ===========================================================================
  // UI — shadow DOM so the app's stylesheet (and its hashed classes) can't
  // reach us and we can't reach it.
  // ===========================================================================
  let root = null, $panel = null, $toasts = null, $fab = null;
  let panelDrag = null, panelResize = null;
  let sk = null;          // skeleton refs, built exactly once
  let dirty = false;      // a refresh was suppressed while the user was busy

  const CSS = `
    :host { all: initial; }
    /* Squared off throughout — nothing in this panel gets a rounded corner. */
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; border-radius: 0; }
    .wrap { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
    .toasts { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 8px; width: 340px; }
    .toast { pointer-events: auto; background: #09090b; color: #e4e4e7; border: 1px solid #27272a;
             border-left-width: 3px; padding: 10px 12px; font-size: 12px;
             box-shadow: 0 8px 24px rgba(0,0,0,.5); animation: in .18s ease-out; }
    .toast h4 { margin: 0 0 4px; font-size: 12px; font-weight: 600; letter-spacing: .01em; }
    .toast p { margin: 0; color: #a1a1aa; white-space: pre-wrap; line-height: 1.45; }
    .toast .tacts { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .toast .tacts button { border-color: #52525b; color: #e4e4e7; }
    .toast .tacts button:hover { border-color: #a1a1aa; background: #27272a; }
    .toast.alert { border-left-color: #22c55e; }
    .toast.warn  { border-left-color: #f59e0b; }
    .toast.err   { border-left-color: #ef4444; }
    .toast.ok    { border-left-color: #3b82f6; }
    .toast button { float: right; background: none; border: 0; color: #52525b; cursor: pointer; font-size: 14px; line-height: 1; }
    @keyframes in { from { opacity: 0; transform: translateY(-6px); } }

    /* FAB KIT v9 — shared verbatim block.
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

       v8 is the first version that changes what the row DOES rather than how wide
       it is, because on a real screen the row was not one row. Two faults, both
       found by tools/harness/row.html, which loads every shipped tool at once and
       measures the buttons instead of reading them as text:

         1. The row ran off the right-hand edge below about 1200px. The floor at
            440 held it clear of the game's nav, nothing held it clear of the
            window, and PANEL KIT's fit() then clamped every button past the edge
            to the SAME pixel and saved it. Four buttons on one square, and the
            save made it permanent. So the row now yields: it prefers to be
            centred, it will not sit left of the nav, but it gives up the nav floor
            before it gives up the edge. Overlapping the game's chrome is a thing
            you can see and click around; a stack of buttons is not.
         2. In the centred half, 50% here and window.innerWidth / 2 in the two
            tools that place their own button are not the same number. A fixed
            element's percentages resolve against the initial containing block,
            which EXCLUDES the classic scrollbar; innerWidth includes it. Half a
            scrollbar — 7.5px on this box — is most of the 8px gap, so the eye and
            MKT each sat all but touching the button to their right. The JS half of
            the row now reads document.documentElement.clientWidth, which is that
            same containing block. test-placement.js fails a copy that reaches for
            innerWidth instead.

       v9 is the second, and it takes on what v8 left as a stated limit: below
       744px of containing block the row is simply wider than the window, so it ran
       off the edge and fit() stacked it exactly as it used to at 1200. v8 called
       that a phone and moved on. It is not only a phone — it is any window the
       game has put into its MOBILE layout, which on a desktop is a half-screen
       pane, a snapped window, or a zoom level. The operator runs the game at 150%
       on half a tablet, where 125% is already past the breakpoint.

       And in that layout the band this row was built for does not exist. The
       desktop header (hidden md:block) is a wordmark, five nav links and an
       account menu, with empty screen in the middle. The mobile header (md:hidden,
       h-12) is a hamburger and the wordmark on the left, a flex-1 horizontally
       scrollable strip of your own vitals filling the middle, and the username and
       its caret pinned right. There is no gap to borrow: a row sliding left to stay
       on screen lands on the account menu, and its far end does not stay on screen
       anyway.

       So under the breakpoint the row leaves the band and FOLDS — two lines of
       eight, parked directly under the mobile header, right-aligned to the same
       8px edge. Four numbers do that, and each is a measurement rather than a
       taste:

         767  the game's own breakpoint. Tailwind's md: is width >= 48rem, and
              every chunk that branches in JS uses shadcn's useIsMobile, which is
              matchMedia('(max-width: 767px)'). Asking the same question the same
              way is the point: the fold and the layout it is folding for can never
              disagree about which one is on screen.
          55  where the mobile header ends. h-12 is 48px and its border-b is one
              more, and then the same ~6px of air the desktop band leaves above the
              button.
           8  half the row, which is the number 364 is half of, counted in buttons
              instead of pixels. It moves with the tool count exactly as 364 and
              736 do: a seventeenth tool means nine and eight, a new version, and a
              pass over every copy.
         368  the fold block: 8 * 46 - 8 = 360 wide, plus the 8px it keeps off the
              right edge — the same shape as the 736 above it.

       One subtlety worth stating, because it looks like the v8 bug and is its
       mirror image: a media query's width INCLUDES the classic scrollbar (Media
       Queries 4 says so, which is why the game's md: and this fold flip on the
       same pixel), while a percentage inside the rule EXCLUDES it. Two different
       widths in one rule, deliberately — the regime is chosen against the window,
       and the arithmetic inside it is done against the containing block. The two
       tools that compute this row in JS therefore ask matchMedia which regime they
       are in and documentElement.clientWidth where to sit, and test-placement.js
       fails a copy that mixes the two up.

       With both regimes the row now fits at every width worth having: at or above
       the breakpoint the one-line row needs 744 and the narrowest containing block
       up there is about 751, and below it the fold needs 376. Under 376 the tail
       overhangs again, and that IS a phone.

       What the fold covers is the strip of page directly under the mobile header,
       and, when there is one, the live-combat banner that renders there. Named
       rather than solved: a narrow screen has no free band, every one of these
       buttons drags, and double-click still brings one home.

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 16; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       a sixteenth tool does not shuffle the fifteen buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. v8 is the
       one deliberate exception to that: the operator asked for the row to be dealt
       again by what the tools are FOR, rather than by the alphabet that recorded
       the order they were written in. It is a re-deal, not a sort to be re-run —
       from here the fixed-slot rule resumes, and a seventeenth tool takes slot 16.

         0  the eye  people-watch     yours: the ledger, and your own numbers
         1  ALGN     align-watch
         2  XP       xp-watch
         3  BARS     bar-watch
         4  JUMP     quick-jump       where you go, and what you do when you get there
         5  JACK     jack-watch
         6  SLOT     slot-watch
         7  MKT      market-watch
         8  SHOP     shop-watch
         9  RAID     raid-watch       your faction
        10  SLP      sleeper-watch
        11  WRLD     world-watch      the world
        12  GOV      gov-watch
        13  POLL     poll-watch
        14  TIME     time-watch       instruments
        15  SOCK     ws-watch

       The eye still leads, because it is the mark of the set. ALGN and XP sit
       together because they are both your own character read back to you; JUMP is
       the launcher that reaches the casinos, so JACK and SLOT follow it; SOCK is
       last because it is the one tool that is meant to be uninstalled.

       The fold splits that list down the middle, which is worth knowing before
       anything is renumbered: slots 0-7 are the first line and 8-15 the second, so
       the grouping above is also what each line of the fold means.

       Sixteen 38px buttons 8px apart is a 728px row, so it runs 364px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1608px the row is centred,
       and below that it stops sliding left rather than climb onto the nav. Below
       about 1174px it starts sliding left again, because from there the far end of
       the row would be off the edge, and that outranks the nav.

       Six numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 364 (half the row), 736 (the whole row plus the 8px it
       keeps off the right edge), and the fold's 55 and 368. Nothing else in here
       is placement.

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
      /* The home row, in four variables so the fold below can move it without
         restating it. --pk-slot is the tool's; the rest of this is the kit's.
         Read --pk-start insides out: centre the row, but not left of the nav
         (440), and not so far right that its far end leaves the window
         (736 = 728 + 8) — that inner min is what stops fit() stacking the tail. */
      --pk-line: 0;
      --pk-col: var(--pk-slot, 0);
      --pk-band: 7px;
      --pk-start: max(8px, min(max(440px, 50% - 364px), 100% - 736px));
      position: fixed;
      top: calc(var(--pk-band) + var(--pk-line) * 46px);
      left: calc(var(--pk-start) + var(--pk-col) * 46px);
      display: grid; place-items: center;
      background: #18181b; color: #e4e4e7;
      border: 1px solid #3f3f46; border-radius: 3px;
      font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: .08em; text-align: center;
      cursor: pointer; user-select: none; touch-action: none;
    }
    /* v9, the fold: the same four variables with different answers. Under the
       game's own breakpoint the row leaves a header band it does not fit in and
       becomes two lines of eight, under the mobile header, right-aligned to the
       same edge. clamp() rather than mod(): the line is 0 up to slot 8 and 1 from
       there, which is the whole of a fold of two, and it asks nothing of the engine
       that has not worked for years. Both lines still resolve their x against a
       percentage, so the block follows the window with no script running. */
    @media (max-width: 767px) {
      .pk-fab {
        --pk-line: clamp(0, calc(var(--pk-slot, 0) - 7), 1);
        --pk-col: calc(var(--pk-slot, 0) - var(--pk-line) * 8);
        --pk-band: 55px;
        --pk-start: max(8px, 100% - 368px);
      }
    }
    .pk-fab:hover { border-color: #71717a; color: #fafafa; }
    .pk-fab.dragging { cursor: grabbing; border-color: #52525b; }
    /* Open, and last: neither hover nor a drag may un-fill it. */
    .pk-fab.pk-open { background: #3f3f46; border-color: #a1a1aa; color: #fafafa; }
    .pk-fab svg { width: 24px; height: 24px; display: block; }
    /* Slot 4 of the kit's home row, declared here for the same reason every other
       tool declares one — except that placeFab() writes left/top inline on mount,
       so what the slot actually buys is the paint between append and placement:
       the button appears in the row instead of jumping into it. defaultFabPos()
       computes the same row in JS; test-placement.js holds the two together.
       Absolute rather than fixed because it lives inside .wrap, which is itself
       fixed at inset: 0 — the box works out identical either way. The shadow is
       its own: market-watch floats over the stocks screen, not flat page chrome. */
    .fab { --pk-slot: 7; pointer-events: auto; position: absolute;
           cursor: grab; box-shadow: 0 4px 14px rgba(0,0,0,.45); }
    .fab.dragging { cursor: grabbing; border-color: #52525b; box-shadow: 0 6px 20px rgba(0,0,0,.6); }
    /* A live-armed session should be obvious without opening the panel. */
    .fab.live { border-color: #ef4444; color: #ef4444; box-shadow: 0 0 0 1px #ef4444, 0 4px 14px rgba(0,0,0,.45); }
    section.live .warnbox { background: #1a0f0f; border-color: #7f1d1d; color: #fca5a5; }

    .armbar { flex: 0 0 auto; display: flex; gap: 6px; align-items: center;
              padding: 6px 12px; border-bottom: 1px solid #18181b; }
    .armbar .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: #52525b; }
    .armbar .st { margin-left: auto; font-size: 10px; color: #3f3f46; text-align: right; }
    .armbar select { width: auto; flex: 0 0 auto; }
    .armbar.live { background: #180d0d; border-bottom-color: #7f1d1d; }
    .armbar.live .st { color: #fca5a5; }
    .seg button.on.live-on { background: #7f1d1d; color: #fecaca; }
    .seg button.pending { background: #7c2d12; color: #fdba74; }

    /* Wraps, because five buttons and a readout do not fit across a panel parked in
       a margin — and un-wrapped the last of them went under the edge rather than
       under the one before it. */
    .sizes { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
             padding: 6px 12px; border-bottom: 1px solid #18181b; }
    .sizes button.on { border-color: #52525b; color: #e4e4e7; }
    .sizes .dim { margin-left: auto; color: #3f3f46; font-size: 10px;
                  font-variant-numeric: tabular-nums; }

    /* position: fixed, not absolute. It is inside .wrap, which is itself fixed at
       inset 0 and sets no containing block, so the two resolve to the same box —
       but PANEL KIT's draggable() measures against the viewport and writes
       left/top, so the element it moves has to be anchored to the viewport in its
       own right rather than by coincidence of its parent. */
    .panel { pointer-events: auto; position: fixed; bottom: 66px; right: 16px;
             width: min(${CFG.PANEL_W}px, calc(100vw - ${CFG.EDGE * 2}px));
             max-height: 74vh; display: flex; flex-direction: column; background: #09090b;
             color: #e4e4e7; border: 1px solid #27272a; font-size: 12px;
             box-shadow: 0 16px 48px rgba(0,0,0,.6); }
    .panel > .scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
    /* The drag handle. cursor comes from the kit; this is the affordance that says
       the strip is grabbable before the pointer is over it. */
    header { flex: 0 0 auto; border-bottom: 1px solid #27272a; padding: 9px 12px;
             display: flex; align-items: center; gap: 8px; user-select: none; }
    header b { font-size: 12px; font-weight: 600; }
    header .sp { flex: 1; }
    header .cnt { color: #52525b; font-size: 11px; }
    section { padding: 10px 12px; border-bottom: 1px solid #18181b; }
    section:last-child { border-bottom: 0; }
    h5 { margin: 0 0 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #52525b; }
    .muted { color: #52525b; }
    button.mini { background: #18181b; border: 1px solid #27272a; color: #a1a1aa;
                  padding: 2px 7px; cursor: pointer; font-size: 11px; }
    button.mini:hover { border-color: #3f3f46; color: #e4e4e7; }
    button.mini.danger:hover { border-color: #ef4444; color: #ef4444; }
    .up { color: #22c55e; } .dn { color: #ef4444; } .flat { color: #3f3f46; }

    .rule { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-top: 1px solid #18181b; }
    .rule:first-of-type { border-top: 0; }
    .rule .txt { flex: 1; line-height: 1.35; }
    .rule .txt em { font-style: normal; color: #71717a; }
    .badge { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; padding: 1px 5px;
             border: 1px solid currentColor; }
    .badge.notify { color: #3b82f6; } .badge.buy { color: #22c55e; } .badge.sell { color: #f59e0b; }

    form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    form .full { grid-column: 1 / -1; }
    input, select { width: 100%; background: #18181b; border: 1px solid #27272a; color: #e4e4e7;
                    padding: 4px 6px; font-size: 11px; }
    input:focus, select:focus { outline: 1px solid #3f3f46; }
    .warnbox { background: #1c1410; border: 1px solid #7c2d12; color: #fdba74;
               padding: 7px 9px; line-height: 1.45; }

    .toolbar { flex: 0 0 auto; display: flex; gap: 6px; align-items: center; padding: 7px 12px;
               border-bottom: 1px solid #18181b; }
    .toolbar input { flex: 1; }
    .seg { display: flex; border: 1px solid #27272a; overflow: hidden; flex: 0 0 auto; }
    .seg button { background: none; border: 0; color: #52525b; padding: 3px 6px; cursor: pointer;
                  font-size: 10px; font-variant-numeric: tabular-nums; }
    .seg button.on { background: #27272a; color: #e4e4e7; }

    .grp { padding: 9px 12px 5px; }
    .grp h6 { margin: 0 0 3px; font-size: 10px; font-weight: 500; color: #3f3f46;
              letter-spacing: .04em; display: flex; gap: 6px; align-items: center; }
    .grp h6 .sp { flex: 1; }
    .grp h6 button { visibility: hidden; }
    .grp:hover h6 button { visibility: visible; }
    .muted-grp { display: flex; align-items: center; gap: 6px; padding: 3px 0; color: #3f3f46; }
    .muted-grp .sp { flex: 1; }
    .row { display: flex; align-items: center; gap: 7px; padding: 4px 0;
           border-top: 1px solid #131316; cursor: pointer; }
    .row:hover { background: #0d0d10; }
    /* Every column here shrinks except the two that carry the numbers. Parked in a
       margin the panel is ~280px, and with all five basis widths frozen the row
       added up to more than that — so the `+` on the end was pushed past the edge
       and clipped away by .scroll, on every row, with nothing to say it was there.
       The symbol truncates (it already has the ellipsis for it) and the sparkline
       squeezes; the price and the delta keep their width, because a number that
       has been trimmed is worse than no number. */
    .row .sym { flex: 0 1 78px; min-width: 32px; color: #e4e4e7; font-weight: 500;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .px  { flex: 1 1 auto; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
    .row .dt  { flex: 0 0 50px; text-align: right; font-variant-numeric: tabular-nums; font-size: 11px; }
    .row .sk  { flex: 0 1 50px; min-width: 0; height: 15px; display: block; }
    .row .chev { flex: 0 0 9px; color: #3f3f46; font-size: 9px; }
    .sub { padding: 2px 0 6px 8px; border-top: 1px solid #131316; }
    .sub .f { display: flex; gap: 8px; padding: 2px 0; align-items: center; }
    .sub .f .n { flex: 1; color: #71717a; }
    .sub .f .v { font-variant-numeric: tabular-nums; color: #a1a1aa; }
    .sub .f.stat .n, .sub .f.stat .v { color: #3f3f46; }
    .sub .f.stat .n::after { content: ' · unchanged'; font-size: 9px; }
    .empty { color: #52525b; padding: 4px 0; line-height: 1.5; }

    .wr { display: flex; gap: 6px; align-items: center; padding: 4px 0; border-top: 1px solid #18181b; }
    .wr .m { color: #f59e0b; font-weight: 600; font-size: 10px; letter-spacing: .04em; }
    .wr .p { flex: 1; color: #a1a1aa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wr .st { color: #52525b; font-variant-numeric: tabular-nums; font-size: 10px; }
    .wb { margin: 0 0 7px; padding: 5px 7px; background: #0d0d10; border: 1px solid #18181b;
          color: #71717a; font: 10px/1.45 ui-monospace, SFMono-Regular, monospace;
          white-space: pre-wrap; word-break: break-all; max-height: 88px; overflow: auto; }

    .qty { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
           padding: 7px; border: 1px dashed #27272a; }
    .qty .lbl { grid-column: 1 / -1; font-size: 10px; text-transform: uppercase;
                letter-spacing: .07em; color: #52525b; }
    .qty .prev { grid-column: 1 / -1; color: #71717a; line-height: 1.4; }
    .qty .prev.ok { color: #22c55e; }
    .qty .prev.no { color: #f59e0b; }

    /* ---- chart overlay ---------------------------------------------------
       A layer pinned over the game's own candle chart, living in THIS shadow
       root rather than inside the app's DOM — React never sees it, so React
       can never reconcile it away, and we never have to guess whether a node
       we appended to somebody else's subtree survived a re-render.

       pointer-events is off on the layer and inherited by everything in it.
       That is load-bearing: the chart underneath still pans, zooms and tracks
       its crosshair, and a mark can never eat a click meant for the game.

       Each mark carries a colour class and every part of it paints in
       currentColor, so a mark is one class away from being a different mark.
       #09090b behind the labels is the chart's own background, read off the
       bundle — a label reads as part of the chart rather than on top of it.

       No z-index. .wrap already lifts this whole shadow root above the game, and
       inside it the overlay must be the BOTTOM layer — it is appended before the
       panel, the toasts and the button, so DOM order alone puts all three above
       it. Give it a positive z-index instead and it wins against those siblings,
       and a dashed price line ends up drawn straight across the panel's own text. */
    .ovl { position: fixed; pointer-events: none; overflow: hidden; contain: strict; }
    .ovl > div { position: absolute; }
    .ovl .vl { top: 0; bottom: 0; width: 1px;
               background: repeating-linear-gradient(to bottom, currentColor 0 3px, transparent 3px 6px); }
    .ovl .hl { left: 0; right: 0; height: 1px;
               background: repeating-linear-gradient(to right, currentColor 0 3px, transparent 3px 6px); }
    .ovl .bd { top: 0; bottom: 0; background: currentColor; opacity: .12; }
    .ovl .dot { width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; background: currentColor;
                transform: rotate(45deg); }
    .ovl .tag { padding: 2px 5px; background: #09090b; border: 1px solid currentColor;
                font: 600 10px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                letter-spacing: .04em; white-space: nowrap; }
    .ovl .buy  { color: #10b981; }   /* the game's own up colour */
    .ovl .sell { color: #f43f5e; }   /* ...and its down colour */
    .ovl .cost { color: #f59e0b; }

    /* ---- "on the chart" section ------------------------------------------
       Built for the narrow case first: this panel is parked in the strip
       beside the game, so every row wraps rather than scrolls sideways and
       nothing is pinned to the right edge. */
    .cw { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline;
          padding: 3px 0; border-top: 1px solid #131316; line-height: 1.45; }
    .cw:first-of-type { border-top: 0; }
    .cw .k { flex: 0 0 auto; min-width: 56px; color: #52525b; font-size: 10px;
             text-transform: uppercase; letter-spacing: .06em; }
    .cw .v { flex: 1 1 auto; min-width: 0; color: #d4d4d8;
             font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .cw .v .q { color: #71717a; }
    .cw.head .v { color: #e4e4e7; font-weight: 600; }
    .pill { flex: 0 0 auto; font-size: 9px; text-transform: uppercase; letter-spacing: .06em;
            padding: 1px 5px; border: 1px solid currentColor; }
    .pill.on   { color: #22c55e; }
    .pill.off  { color: #52525b; }
    .pill.warn { color: #f59e0b; }
    .marks { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 7px; }
    .marks button.on { border-color: #52525b; color: #e4e4e7; }
    .marks button .sw { color: #52525b; }
    .marks button.on .sw { color: #22c55e; }
    /* The fallback chart. Rects only, no strokes that a non-uniform scale would
       smear — the one line that needs to stay 1px asks for it by name. */
    .fb { width: 100%; height: 96px; display: block; margin-top: 7px;
          background: #09090b; border: 1px solid #18181b; }
  `;

  // ===========================================================================
  // Chart bridge — borrow the page's own chart, read-only
  //
  // StocksPage renders its candles with TradingView Lightweight Charts v5 into a
  // canvas. A canvas cannot be annotated by adding elements to it, and v5 dropped
  // series markers (the bundle has been tree-shaken, so `createSeriesMarkers` is
  // not even present) — so the mark is our own layer, positioned with the chart's
  // own coordinate functions. That means holding the chart object.
  //
  // The chart object lives in a React ref inside the chart component and is not
  // exposed anywhere, so it is reached by walking the fiber tree up from the
  // container element. Two things keep that from being as brittle as it sounds:
  //
  //   a) Nothing is matched by NAME. Minified builds rename every binding and
  //      reorder hooks freely, so what is matched is behaviour — a ref whose
  //      current value answers to timeScale() is the chart, one that answers to
  //      priceToCoordinate() is the series. Renaming cannot break that; removing
  //      the methods would, and that is a library change, not a build change.
  //   b) Every step is optional. No chart found, no overlay, and the panel says so
  //      and draws the same thing itself. Nothing else in the tool depends on it.
  //
  // What we call on it: timeScale(), timeToCoordinate(), priceToCoordinate(),
  // data(), and two subscribe/unsubscribe pairs. Every one of those is a read.
  // setData, applyOptions, update and remove are never called and must never be —
  // this tool is a spectator at somebody else's chart.
  // ===========================================================================
  const CHART_SEL = '.tv-lightweight-charts';   // the class the library puts on its own container

  let $ovl = null;        // the overlay layer, in our shadow root
  let bound = null;       // { chart, series, host, off: [] }
  let testChart = null;   // set only by the bench, via the disclosed debug handle

  const fiberOf = (node) => {
    for (const k of Object.keys(node)) if (k.startsWith('__reactFiber$')) return node[k];
    return null;
  };

  /** Every ref object hanging off one fiber's hook chain. */
  function refsOn(fiber) {
    const out = [];
    let h = fiber.memoizedState;
    for (let i = 0; h && i < 40; i++, h = h.next) {
      const m = h.memoizedState;
      if (m && typeof m === 'object' && 'current' in m) out.push(m.current);
    }
    return out;
  }

  const isChart = (o) => !!o && typeof o.timeScale === 'function' && typeof o.applyOptions === 'function';
  const isSeries = (o) => !!o && typeof o.priceToCoordinate === 'function' && typeof o.data === 'function';

  function findChart() {
    // Only StocksPage carries this class — checked against the 2026-08-10 and
    // 2026-08-26 bundle sets, where it appears in StocksPage and nowhere else.
    // If that ever stops being true, sameSymbol() below is what catches it.
    const host = document.querySelector(CHART_SEL);
    const anchor = host && host.parentElement;   // the library's div is not React's; its parent is
    if (!anchor) return null;
    let chart = null, series = null, fiber = fiberOf(anchor);
    for (let hop = 0; fiber && hop < 12 && !(chart && series); hop++, fiber = fiber.return) {
      for (const c of refsOn(fiber)) {
        if (!chart && isChart(c)) chart = c;
        if (!series && isSeries(c)) series = c;
      }
    }
    return chart && series ? { chart, series, host } : null;
  }

  function unbind() {
    if (!bound) return;
    for (const off of bound.off) { try { off(); } catch { /* the chart may already be gone */ } }
    bound = null;
  }

  /**
   * The chart component is keyed `${symbol}-${timeframe}`, so changing either
   * REMOUNTS it and the old object is disposed. Every handle is therefore checked
   * before use and re-taken when it goes stale.
   */
  function bindChart() {
    if (testChart) return (bound = testChart);
    if (bound && bound.host.isConnected && document.querySelector(CHART_SEL) === bound.host) return bound;
    unbind();
    const found = findChart();
    if (!found) return null;

    const off = [];
    // Each subscription is taken on its own: a build that has dropped one should
    // cost us that one redraw trigger, not the whole overlay. The rebind poll is
    // the floor under all of them.
    try {
      const ts = found.chart.timeScale();
      ts.subscribeVisibleLogicalRangeChange(drawSoon);
      off.push(() => ts.unsubscribeVisibleLogicalRangeChange(drawSoon));
    } catch (e) { log('no range subscription', e); }
    try {
      found.series.subscribeDataChanged(drawSoon);
      off.push(() => found.series.unsubscribeDataChanged(drawSoon));
    } catch (e) { log('no data subscription', e); }
    try {
      const ro = new ResizeObserver(drawSoon);
      ro.observe(found.host);
      off.push(() => ro.disconnect());
    } catch (e) { log('no resize observer', e); }

    bound = Object.assign(found, { off });
    log('chart bound');
    return bound;
  }

  /**
   * The main pane's box, in viewport coordinates. timeToCoordinate and
   * priceToCoordinate both answer in this box's space. It is found by area rather
   * than by class — the price scale and the time axis get their own, smaller
   * canvases, and the class names in there belong to a library we do not control.
   */
  function paneBox(host) {
    let best = null;
    for (const c of host.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      if (!best || r.width * r.height > best.width * best.height) best = r;
    }
    return best;
  }

  /**
   * One description of what should be marked, read by BOTH the overlay and the
   * panel so the two can never tell different stories about the same fill.
   */
  function chartModel() {
    const b = bindChart();
    const view = chartView || {};
    const set = candleSets.get(`${view.symbol}:${view.tf}`) || null;

    let bars = null, verified = null;
    if (b) {
      try { bars = b.series.data(); } catch (e) { log('series.data() refused', e); }
      if (bars && bars.length >= 2) verified = sameSymbol(bars, set && set.bars);
    }
    // No chart, or a chart that would not hand its bars over: fall back to the
    // last candles response, which is the same data one fetch earlier.
    if ((!bars || bars.length < 2) && set) { bars = set.bars; verified = true; }
    if (!bars || bars.length < 2) {
      return { symbol: view.symbol || null, tf: view.tf || null, bound: !!b, bars: null };
    }

    const bucketSecs = set ? set.bucketSecs : bucketOf(bars);
    const trade = view.symbol ? lastBuyFor(view.symbol) : null;
    return {
      symbol: view.symbol || null, tf: view.tf || null,
      bound: !!b, live: !!(b && verified !== null), verified,
      bars, bucketSecs, trade,
      pos: view.symbol ? positions.get(view.symbol) || null : null,
      at: trade ? placeTrade(trade, bars, bucketSecs) : null,
      covers: [
        Math.floor(bars[0].time / GAME_DAY_SECS),
        Math.floor((bars[bars.length - 1].time + bucketSecs - 1) / GAME_DAY_SECS),
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  let drawRaf = false;
  const drawSoon = () => {
    if (drawRaf) return;
    drawRaf = true;
    requestAnimationFrame(() => { drawRaf = false; drawOverlay(); });
  };

  const mk = (cls, style) => { const d = el('div', cls); Object.assign(d.style, style); return d; };

  function drawOverlay() {
    if (!$ovl) return;
    const hide = () => { $ovl.style.display = 'none'; };
    if (!ui.mark && !ui.costLine) return hide();

    const m = chartModel();
    if (!m.bound || !m.bars || !bound) return hide();
    const box = paneBox(bound.host);
    if (!box || box.width < 40 || box.height < 40) return hide();

    const ts = bound.chart.timeScale();
    const num = (v) => (isNum(v) ? v : null);
    const xOf = (t) => { try { return num(ts.timeToCoordinate(t)); } catch { return null; } };
    const yOf = (p) => { try { return num(bound.series.priceToCoordinate(p)); } catch { return null; } };

    const parts = [];
    const W = box.width;

    // Off the left or right of what is on screen, the coordinate still comes back
    // (the scale extrapolates) and would simply be clipped away — leaving the
    // operator to wonder where their mark went. An edge chip says which way.
    const edgeTag = (x, cls, text) => {
      const t = mk(`tag ${cls}`, x < 0 ? { left: '4px', top: '6px' } : { right: '4px', top: '6px' });
      t.textContent = x < 0 ? `◀ ${text}` : `${text} ▶`;
      return t;
    };

    if (ui.costLine && m.pos && isNum(m.pos.avgCost) && m.pos.shares) {
      const y = yOf(m.pos.avgCost);
      if (y !== null && y > -2 && y < box.height + 2) {
        parts.push(mk('hl cost', { top: `${y}px` }));
        const t = mk('tag cost', { left: '4px', top: `${Math.max(2, Math.min(box.height - 18, y + 4))}px` });
        t.textContent = `avg ${fmtNum(m.pos.avgCost)}`;
        parts.push(t);
      }
    }

    if (ui.mark && m.trade && m.at && m.verified === true) {
      const cls = BUY_TYPES.has(m.trade.trade_type) ? 'buy' : 'sell';
      const label = `${(m.trade.trade_type || '').toUpperCase()} ${fmtNum(m.trade.shares)} @ ${fmtNum(m.trade.price_per_share)}`;

      if (m.at.from != null) {
        const x1 = xOf(m.bars[m.at.from].time);
        const x2 = xOf(m.bars[m.at.to].time);
        if (x1 !== null && x2 !== null) {
          const mid = (x1 + x2) / 2;
          if (mid < 0 || mid > W) {
            parts.push(edgeTag(mid, cls, `${label} · D${m.trade.game_day}`));
          } else {
            // A day wider than one bar is a band, not a line — the fill happened
            // somewhere in there and the chart cannot say where. Half a bar is
            // added either side because a coordinate is a bar's centre.
            if (!m.at.exact) {
              const half = Math.max(2, Math.abs(xOf(m.bars[1].time) - xOf(m.bars[0].time)) / 2 || 3);
              parts.push(mk(`bd ${cls}`, { left: `${x1 - half}px`, width: `${(x2 - x1) + half * 2}px` }));
            }
            parts.push(mk(`vl ${cls}`, { left: `${mid}px` }));

            const y = yOf(m.trade.price_per_share);
            if (y !== null) {
              parts.push(mk(`hl ${cls}`, { top: `${y}px` }));
              parts.push(mk(`dot ${cls}`, { left: `${mid}px`, top: `${y}px` }));
            }
            // Flip the label to whichever side of the mark has room for it.
            const t = mk(`tag ${cls}`, mid > W - 130
              ? { right: `${Math.max(4, W - mid + 7)}px` } : { left: `${mid + 7}px` });
            t.style.top = `${y === null ? 6 : Math.max(2, Math.min(box.height - 18, y - 20))}px`;
            t.textContent = label;
            parts.push(t);
          }
        }
      }
    }

    if (!parts.length) return hide();
    Object.assign($ovl.style, {
      display: 'block',
      left: `${box.left}px`, top: `${box.top}px`,
      width: `${box.width}px`, height: `${box.height}px`,
    });
    $ovl.replaceChildren(...parts);
  }

  function paintToast(kind, head, body, actions) {
    if (!$toasts) return;
    const t = el('div', `toast ${kind}`);
    const close = el('button', null, '×');
    close.onclick = () => t.remove();
    t.append(close, el('h4', null, head), el('p', null, body));
    if (actions && actions.length) {
      const row = el('div', 'tacts');
      for (const a of actions) {
        const b = el('button', 'mini', a.label);
        if (a.title) b.title = a.title;
        b.onclick = () => { t.remove(); a.run(); };
        row.append(b);
      }
      t.append(row);
    }
    $toasts.prepend(t);
    // a card carrying an action sticks around: it is useless if it vanishes
    // while you are still deciding
    setTimeout(() => t.remove(), actions && actions.length ? 180_000 : kind === 'alert' ? 30_000 : 60_000);
    while ($toasts.children.length > 6) $toasts.lastElementChild.remove();
  }

  // ---------------------------------------------------------------------------
  // Skeleton — every persistent node is created here ONCE. Refresh only mutates
  // text and swaps rows; it never replaces the toolbar or the form, so an open
  // <select> or a half-typed input survives incoming price ticks.
  // ---------------------------------------------------------------------------
  function buildSkeleton() {
    const hdr = el('header');
    hdr.title = 'Drag to move · drag the bottom-right corner to resize · double-click to snap back';
    const cnt = el('span', 'cnt');
    const szBtn = el('button', 'mini', '⤢');
    szBtn.title = 'panel size';
    const snd = el('button', 'mini');
    snd.onclick = () => { ui.sound = !ui.sound; saveUI(); snd.textContent = ui.sound ? '🔊' : '🔇'; };
    snd.textContent = ui.sound ? '🔊' : '🔇';
    hdr.append(el('b', null, 'Market Watch'), el('span', 'sp'), cnt, szBtn, snd);

    // Size presets, folded away behind the header button until wanted.
    const sizes = el('div', 'sizes');
    sizes.style.display = ui.sizeBar ? 'flex' : 'none';
    szBtn.onclick = () => {
      ui.sizeBar = !ui.sizeBar; saveUI();
      sizes.style.display = ui.sizeBar ? 'flex' : 'none';
      paintSizes();
    };
    // The presets go through PANEL KIT's resizable() rather than round a second
    // sizing path of their own: one owner for width and height, whether the number
    // came from a button or from dragging the corner.
    //
    // They do have to finish the job themselves, though. apply() is the kit's
    // RESTORE path — it cannot tell being handed back a stored size from being
    // handed a new one, so it deliberately reports nothing, and a preset that
    // stopped there looked right and was forgotten on reload. So this does what
    // the corner-drag callback does: store the size, and park the panel, because a
    // sized panel still tethered gets shoved by the next response to land.
    for (const [name, w, h] of SIZE_PRESETS) {
      const b = el('button', 'mini', name);
      b.title = h === null ? `${w}px wide, filling the height below it` : `${w}×${h}`;
      b.onclick = () => {
        const size = { w: `${presetW(w)}px`, h: `${h === null ? fillH() : h}px` };
        panelResize?.apply(size);
        ui.size = size;
        if (!ui.panel) {
          const r = $panel.getBoundingClientRect();
          ui.panel = { x: r.left, y: r.top };
        }
        saveUI();
        paintSizes();
      };
      sizes.append(b);
    }
    const auto = el('button', 'mini', 'auto');
    auto.title = 'hand the size back — the panel sizes itself to its content again';
    auto.onclick = () => { panelResize?.reset(); placePanel(); paintSizes(); };
    const dim = el('span', 'dim');
    sizes.append(auto, dim);

    // toolbar: filter + delta window. Both persist across refreshes.
    const bar = el('div', 'toolbar');
    const filter = el('input');
    filter.type = 'search';
    filter.placeholder = 'filter symbols…';
    filter.value = ui.filter || '';
    filter.oninput = () => { ui.filter = filter.value; saveUI(); paintObserved(true); };
    const seg = el('div', 'seg');
    for (const [label, ms] of WINDOWS.slice(2)) {
      const b = el('button', ms === ui.deltaWin ? 'on' : null, label);
      b.onclick = () => {
        ui.deltaWin = ms; saveUI();
        [...seg.children].forEach((c) => c.classList.toggle('on', c === b));
        paintObserved(true);
      };
      seg.append(b);
    }
    bar.append(filter, seg);

    const scroll = el('div', 'scroll');
    const warnSec = el('section');
    warnSec.style.display = 'none';
    const warn = el('div', 'warnbox');
    warnSec.append(warn);

    const chartSec = buildChartSection();

    const obs = el('div');

    const ruleSec = el('section');
    const ruleBody = el('div');
    ruleSec.append(el('h5', null, 'Rules'), ruleBody);

    const formSec = el('section');
    formSec.append(el('h5', null, 'New rule'));
    const formHost = el('div');
    formSec.append(formHost);

    const ft = el('section');
    const wipe = el('button', 'mini danger', 'clear history');
    wipe.onclick = () => {
      if (!confirm('Delete all recorded price history? Rules are kept.')) return;
      for (const k of Object.keys(hist)) delete hist[k];
      writeJSON(K.hist, hist); rowCache.clear(); paintObserved(true);
    };
    const exp = el('button', 'mini', 'copy JSON');
    exp.style.marginLeft = '6px';
    exp.onclick = () => navigator.clipboard?.writeText(JSON.stringify(hist)).then(
      () => toast('ok', 'Copied', `${Object.keys(hist).length} series to clipboard.`), () => {});
    const note = el('div', 'muted', 'Reads only responses the app already fetched. Sends nothing. Alt+M toggles.');
    note.style.cssText = 'margin-top:7px;line-height:1.5';
    ft.append(wipe, exp, note);

    scroll.append(warnSec, chartSec.sec, obs, ruleSec, formSec, ft);
    $panel.append(hdr, sizes, bar, scroll);

    sk = { cnt, hdr, warnSec, warn, obs, ruleBody, formHost, filter, sizes, dim, chart: chartSec };
    buildForm();

    // If a tick arrived while the user held a control open, apply it on release.
    $panel.addEventListener('focusout', () => { if (dirty) setTimeout(refresh, 0); });
  }

  // ---------------------------------------------------------------------------
  // "On the chart" — the same model the overlay draws, written out in words.
  //
  // It is not a duplicate of the overlay, it is the part the overlay cannot say:
  // which days the chart covers, what we assumed about a fill's game day, and why
  // a mark is missing when one is. Every one of those is a number the operator can
  // check against the game's own history table, which is the point — this tool
  // decodes `game_day` and nothing verifies that decode except a human comparing it.
  // ---------------------------------------------------------------------------
  function buildChartSection() {
    const sec = el('section');
    const rows = el('div');
    const marks = el('div', 'marks');

    const sw = (key, label) => {
      const b = el('button', 'mini');
      const tick = el('span', 'sw');
      b.append(tick, document.createTextNode(` ${label}`));
      const paint = () => {
        b.classList.toggle('on', !!ui[key]);
        tick.textContent = ui[key] ? '●' : '○';
      };
      b.onclick = () => { ui[key] = !ui[key]; saveUI(); paint(); drawSoon(); paintChart(); };
      paint();
      return b;
    };
    marks.append(sw('mark', 'last buy'), sw('costLine', 'avg cost'));

    sec.append(el('h5', null, 'On the chart'), rows, marks);
    return { sec, rows, marks };
  }

  const row = (k, v, cls) => {
    const r = el('div', `cw${cls ? ` ${cls}` : ''}`);
    r.append(el('span', 'k', k));
    const val = el('span', 'v');
    if (typeof v === 'string') val.textContent = v; else val.append(...[].concat(v));
    r.append(val);
    return r;
  };
  const quiet = (t) => el('span', 'q', t);
  const pill = (kind, t) => el('span', `pill ${kind}`, t);

  function paintChart() {
    const { rows } = sk.chart;
    const m = chartModel();
    const out = [];

    if (!m.symbol) {
      out.push(row('chart', 'no stock chart seen yet — open the stocks screen'));
      rows.replaceChildren(...out);
      return;
    }

    // Only one of these is a problem. Not reaching the game's chart is the
    // designed fallback and gets the quiet pill; being on the wrong stock's chart
    // is the one thing that would mislead, and it is the only amber.
    const state = !m.bound ? pill('off', 'drawing here')
      : m.verified === false ? pill('warn', 'wrong stock')
        : m.verified === null ? pill('off', 'lining up')
          : pill('on', 'marked');
    out.push(row('stock', [document.createTextNode(`${m.symbol} · ${m.tf || '?'}`), ' ', state], 'head'));

    if (!m.bars) {
      out.push(row('bars', 'waiting for candles'));
      rows.replaceChildren(...out);
      return;
    }

    const [d0, d1] = m.covers;
    out.push(row('covers', [
      document.createTextNode(`D${d0} – D${d1}`), ' ',
      quiet(`${m.bars.length} bars · ${gameDate(d0 * GAME_DAY_SECS)} → ${gameDate(d1 * GAME_DAY_SECS)}`),
    ]));

    if (!m.trade) {
      out.push(row('last buy', Object.keys(trades).length
        ? 'none recorded for this stock'
        : 'no trades yet — open the stocks page’s History tab once and this fills in'));
    } else {
      const t = m.trade;
      out.push(row('last buy', [
        document.createTextNode(`${fmtNum(t.shares)} @ ${fmtNum(t.price_per_share)}`), ' ',
        quiet(`D${t.game_day} · ${gameDate(t.game_day * GAME_DAY_SECS)}`),
      ]));

      const at = m.at;
      const where = !at ? 'cannot be placed'
        : at.impossible ? 'later than the newest bar — game_day is not the absolute day we read it as, so nothing is drawn'
          : at.before ? `${at.days} game day${at.days === 1 ? '' : 's'} before this window — widen the timeframe`
            : at.after ? `${at.days} game day${at.days === 1 ? '' : 's'} after this window`
              : at.exact ? `bar ${at.from + 1} of ${m.bars.length}`
                : `bars ${at.from + 1}–${at.to + 1} of ${m.bars.length} — a game day is ${at.span} bars at this timeframe, so the mark is a band`;
      out.push(row('placed', where));
    }

    if (m.pos && isNum(m.pos.avgCost)) {
      const p = m.pos;
      const bits = [document.createTextNode(`${fmtNum(p.avgCost)}`)];
      if (isNum(p.price) && p.avgCost > 0) {
        const pct = ((p.price - p.avgCost) / p.avgCost) * 100;
        const span = el('span', pct >= 0 ? 'up' : 'dn', `  ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`);
        bits.push(span, ' ', quiet(`now ${fmtNum(p.price)}`));
      }
      out.push(row('avg cost', bits));
    }

    rows.replaceChildren(...out);
    if (!m.bound && m.bars) rows.append(fallbackChart(m));
  }

  /**
   * The same picture, drawn here, for when the game's chart cannot be reached.
   *
   * Rects only — no strokes to smear under the non-uniform scale that lets one
   * viewBox fill any panel width — except the marker lines, which ask for
   * non-scaling-stroke by name so they stay 1px however wide the panel is.
   */
  function fallbackChart(m) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 300, H = 96, PAD = 3;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'fb');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const bars = m.bars.slice(-120);
    const lows = bars.map((b) => b.low), highs = bars.map((b) => b.high);
    let lo = Math.min(...lows), hi = Math.max(...highs);
    if (m.trade && isNum(m.trade.price_per_share)) {
      lo = Math.min(lo, m.trade.price_per_share); hi = Math.max(hi, m.trade.price_per_share);
    }
    const span = (hi - lo) || 1;
    const y = (v) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
    const step = W / bars.length;
    const bw = Math.max(1, step * 0.62);

    const rect = (x, yy, w, h, fill, extra) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x.toFixed(2)); r.setAttribute('y', yy.toFixed(2));
      r.setAttribute('width', Math.max(0.3, w).toFixed(2));
      r.setAttribute('height', Math.max(0.5, h).toFixed(2));
      r.setAttribute('fill', fill);
      if (extra) for (const [k, v] of Object.entries(extra)) r.setAttribute(k, v);
      svg.append(r);
      return r;
    };

    bars.forEach((b, i) => {
      const cx = i * step + step / 2;
      const up = b.close >= b.open;
      const fill = up ? '#10b981' : '#f43f5e';
      rect(cx - 0.35, y(b.high), 0.7, y(b.low) - y(b.high), fill, { opacity: '.55' });
      const top = Math.min(y(b.open), y(b.close));
      rect(cx - bw / 2, top, bw, Math.abs(y(b.open) - y(b.close)), fill);
    });

    // The mark, on the same arithmetic the overlay uses.
    const first = m.bars.length - bars.length;
    if (ui.mark && m.trade && m.at && m.at.from != null && m.at.to >= first) {
      const a = Math.max(0, m.at.from - first), b = Math.max(0, m.at.to - first);
      const x1 = a * step, x2 = (b + 1) * step;
      const cls = BUY_TYPES.has(m.trade.trade_type) ? '#10b981' : '#f43f5e';
      if (!m.at.exact) rect(x1, 0, x2 - x1, H, cls, { opacity: '.14' });
      rect((x1 + x2) / 2 - 0.5, 0, 1, H, cls, { opacity: '.9' });
      const ty = y(m.trade.price_per_share);
      rect(0, ty - 0.5, W, 1, cls, { opacity: '.7' });
      rect((x1 + x2) / 2 - 2.5, ty - 2.5, 5, 5, cls);
    }
    if (ui.costLine && m.pos && isNum(m.pos.avgCost) && m.pos.shares) {
      const cy = y(m.pos.avgCost);
      if (cy >= 0 && cy <= H) rect(0, cy - 0.5, W, 1, '#f59e0b', { opacity: '.8' });
    }
    return svg;
  }

  const userBusy = () => {
    const a = root && root.activeElement;
    if (!a) return false;
    return ['SELECT', 'INPUT', 'TEXTAREA', 'OPTION'].includes(a.tagName);
  };

  let raf = false;
  function refresh() {
    if (!sk || !ui.open) return;
    if (raf) return;
    raf = true;
    requestAnimationFrame(() => {
      raf = false;
      // Never re-render underneath an open dropdown or a field being typed in.
      if (userBusy()) { dirty = true; return; }
      dirty = false;
      paintHeader();
      paintWarn();
      paintFabState();
      paintChart();
      paintObserved();
      paintRules();
      syncFormOptions();
      updateQtyPreview();   // holdings may have just arrived — resize the preview
      paintSizes();
      // The content just decided the height, so only now can we be sure the header
      // is still on screen. A panel whose drag handle is off the edge is the one
      // unrecoverable state, and every render is a chance to create it.
      panelDrag?.fit();
    });
  }

  function paintHeader() {
    const n = seriesIndex().size;
    sk.cnt.textContent = `${n} series · ${rules.length} rule${rules.length === 1 ? '' : 's'}`;
  }

  function paintWarn() {
    // Rules that carry a trade intent now produce a shortcut on the alert, not an
    // order. Say what will happen, so nobody expects a fill.
    const trading = rules.some((r) => r.enabled && r.action !== 'notify');
    sk.warnSec.style.display = trading ? '' : 'none';
    if (!trading) return;
    sk.warnSec.classList.remove('live');
    sk.warn.textContent = 'Buy/sell rules do not place orders — nothing here can. '
      + 'When one fires, the alert offers a button that takes you to the stocks screen '
      + 'with the size worked out, and you place the trade yourself.';
  }

  function paintFabState() {
    if (!$fab) return;
    $fab.classList.remove('live');
    $fab.title = 'Market Watch (Alt+M) — drag to move, double-click to reset';
  }

  // --- observed -------------------------------------------------------------
  const rowCache = new Map();   // rowId -> { host, px, dt, spark, sub }
  let lastStructSig = '';

  function paintObserved(force) {
    const groups = groupsOf();
    const q = (ui.filter || '').trim().toLowerCase();

    const visible = [];
    for (const [g, items] of groups) {
      const keep = items.filter((it) => !q || it.entity.toLowerCase().includes(q) || g.toLowerCase().includes(q));
      if (keep.length) visible.push([g, keep]);
    }

    const structSig = visible.map(([g, its]) =>
      `${g}${ui.hidden[g] ? '!' : ''}>${its.map((i) => `${i.entity}:${i.fields.join(',')}:${ui.expanded[i.series] ? 1 : 0}`).join('|')}`
    ).join('||');

    if (force || structSig !== lastStructSig) {
      lastStructSig = structSig;
      rowCache.clear();
      sk.obs.replaceChildren();

      if (!visible.length) {
        const s = el('section');
        s.append(el('div', 'empty', Object.keys(hist).length
          ? 'Nothing matches that filter.'
          : 'Nothing yet. Open a market screen — this only sees responses the app fetches on its own.'));
        sk.obs.append(s);
        return;
      }

      for (const [g, items] of visible.filter(([g2]) => !ui.hidden[g2])) {
        const grp = el('div', 'grp');
        const h = el('h6');
        const hide = el('button', 'mini', 'hide');
        hide.title = 'stop showing and recording this group';
        hide.onclick = (e) => {
          e.stopPropagation();
          ui.hidden[g] = 1; saveUI(); paintObserved(true);
        };
        h.append(el('span', null, g || 'root'), el('span', 'sp'), hide);
        grp.append(h);
        for (const it of items) grp.append(buildRow(g, it));
        sk.obs.append(grp);
      }

      // Muted groups collapse to one line each, so they're easy to bring back.
      const off = visible.filter(([g2]) => ui.hidden[g2]);
      if (off.length) {
        const box = el('div', 'grp');
        for (const [g, items] of off) {
          const line = el('div', 'muted-grp');
          const keptFor = rules.some((r) => r.enabled && splitSeries(r.series)[0] === g);
          line.append(el('span', null, `${g || 'root'} · ${items.length} hidden${keptFor ? ', still recording for a rule' : ''}`),
            el('span', 'sp'));
          const show = el('button', 'mini', 'show');
          show.onclick = () => { delete ui.hidden[g]; saveUI(); paintObserved(true); };
          line.append(show);
          box.append(line);
        }
        sk.obs.append(box);
      }
    }
    updateRowValues();
  }

  function buildRow(group, it) {
    const host = el('div');
    const head = el('div', 'row');
    const expanded = !!ui.expanded[it.series];

    const chev = el('span', 'chev', expanded ? '▾' : '▸');
    const sym = el('span', 'sym', it.entity);
    sym.title = it.series;
    const px = el('span', 'px');
    const dt = el('span', 'dt');
    const spark = sparkline(`${it.series}::${headlineField(it.series, it.fields)}`);
    const go = el('button', 'mini', '+');
    go.title = 'new rule on this series';
    go.onclick = (e) => {
      e.stopPropagation();
      prefill(it.series, headlineField(it.series, it.fields));
    };

    head.append(chev, sym, px, dt, spark, go);
    head.onclick = () => {
      if (expanded) delete ui.expanded[it.series]; else ui.expanded[it.series] = 1;
      saveUI(); paintObserved(true);
    };
    host.append(head);

    let sub = null;
    if (expanded) {
      sub = el('div', 'sub');
      for (const f of it.fields) {
        const key = `${it.series}::${f}`;
        const row = el('div', `f${demoted(it.series, f) ? ' stat' : ''}`);
        const v = el('span', 'v');
        const add = el('button', 'mini', '+');
        add.onclick = (e) => { e.stopPropagation(); prefill(it.series, f); };
        row.append(el('span', 'n', f), v, add);
        row.dataset.key = key;
        sub.append(row);
      }
      host.append(sub);
    }

    rowCache.set(it.series, { host, px, dt, spark, sub, it });
    return host;
  }

  function updateRowValues() {
    for (const [series, r] of rowCache) {
      const hf = headlineField(series, r.it.fields);
      const last = latest(`${series}::${hf}`);
      r.px.textContent = last ? fmtNum(last[1]) : '—';
      r.px.title = last ? `${hf} · ${fmtAgo(last[0])} ago` : '';

      const pct = deltaPct(`${series}::${hf}`, ui.deltaWin);
      r.dt.textContent = pct === null ? '·' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
      r.dt.className = `dt ${pct === null ? 'flat' : pct > 0.005 ? 'up' : pct < -0.005 ? 'dn' : 'flat'}`;
      r.dt.title = `change over ${winLabel(ui.deltaWin)}`;

      const fresh = sparkline(`${series}::${hf}`);
      r.spark.replaceChildren(...fresh.childNodes);

      if (!r.sub) continue;
      for (const f of r.sub.children) {
        const l = latest(f.dataset.key);
        f.querySelector('.v').textContent = l ? fmtNum(l[1]) : '—';
      }
    }
  }

  // --- rules ----------------------------------------------------------------
  function paintRules() {
    sk.ruleBody.replaceChildren();
    if (!rules.length) {
      sk.ruleBody.append(el('div', 'empty', 'No rules yet. Hit + on any row above.'));
      return;
    }
    for (const r of rules) {
      const row = el('div', 'rule');
      const on = el('input');
      on.type = 'checkbox'; on.checked = r.enabled; on.style.width = 'auto';
      on.onchange = () => { r.enabled = on.checked; saveRules(); };

      const o = OPS[r.op];
      const txt = el('div', 'txt', `${shortSeries(r.series)} · ${r.field} ${o.label} ${fmtNum(r.value)}${o.unit}`);
      txt.title = r.series;
      txt.append(el('em', null,
        (o.needsWindow ? ` in ${winLabel(r.windowMs)}` : '') +
        (r.qty ? ` → ${qtyLabel(r)}` : '') +
        (r.lastFiredAt ? ` · fired ${fmtAgo(r.lastFiredAt)} ago` : '')));

      const del = el('button', 'mini danger', '×');
      del.onclick = () => { rules = rules.filter((x) => x.id !== r.id); saveRules(); paintRules(); paintHeader(); };

      row.append(on, el('span', `badge ${r.action}`, r.action), txt, del);
      sk.ruleBody.append(row);
    }
  }

  // --- form (built once, never replaced) ------------------------------------
  let form = null;
  function buildForm() {
    const f = el('form');
    const mk = (tag, opts = {}) => Object.assign(document.createElement(tag), opts);

    const selSeries = mk('select');
    const selField = mk('select');
    const selOp = mk('select');
    for (const [k, v] of Object.entries(OPS)) selOp.append(new Option(v.label, k));
    const inVal = mk('input', { type: 'number', step: 'any', placeholder: 'threshold' });
    const selWin = mk('select');
    for (const [l, v] of WINDOWS) selWin.append(new Option(l, String(v)));
    selWin.value = '900000';
    const selCd = mk('select');
    for (const [l, v] of WINDOWS) selCd.append(new Option(`cooldown ${l}`, String(v)));
    selCd.value = String(CFG.DEFAULT_COOLDOWN_MS);
    const selAct = mk('select', { className: 'full' });
    selAct.append(new Option('notify me', 'notify'), new Option('auto-buy', 'buy'), new Option('auto-sell', 'sell'));

    // --- position size. Hidden entirely for notify rules, so the common case
    //     stays a four-field form.
    const qtyBox = el('div', 'qty');
    const selQty = mk('select');
    for (const [k, v] of Object.entries(QTY_MODES)) selQty.append(new Option(v.label, k));
    selQty.value = 'pctHeld';
    const inQtyVal = mk('input', { type: 'number', step: 'any', min: '0', placeholder: 'percent' });
    const selQtyField = mk('select');
    selQtyField.className = 'full';
    const prev = el('div', 'prev');
    qtyBox.append(el('div', 'lbl', 'position size'), selQty, inQtyVal, selQtyField, prev);

    const submit = mk('button', { type: 'submit', className: 'mini full', textContent: 'add rule' });
    submit.style.padding = '5px';

    selSeries.onchange = () => { syncFieldOptions(); updateQtyPreview(); };
    selOp.onchange = () => { selWin.disabled = !OPS[selOp.value].needsWindow; };
    selAct.onchange = () => updateQtyPreview();
    selQty.onchange = () => updateQtyPreview();
    selQtyField.onchange = () => updateQtyPreview();
    inQtyVal.oninput = () => updateQtyPreview();

    f.onsubmit = (e) => {
      e.preventDefault();
      const value = parseFloat(inVal.value);
      if (!selSeries.value || !selField.value || !Number.isFinite(value)) {
        toast('err', 'Incomplete rule', 'Pick a series, a field, and a numeric threshold.');
        return;
      }

      const trading = selAct.value !== 'notify';
      const mode = QTY_MODES[selQty.value];
      const qtyVal = parseFloat(inQtyVal.value);
      if (trading && mode.needsValue && !Number.isFinite(qtyVal)) {
        toast('err', 'Incomplete rule', `An auto-${selAct.value} rule needs a position size.`);
        return;
      }
      const qty = trading
        ? { mode: selQty.value, value: mode.needsValue ? qtyVal : null, field: selQtyField.value || null }
        : null;

      if (trading) {
        toast('ok', 'Rule added',
          'When it fires you get an alert with the size worked out and a button to the '
          + 'stocks screen. It will not place the order — nothing in this script can.');
      }
      rules.push({
        id: `r${now().toString(36)}${rules.length + 1}`,
        series: selSeries.value, field: selField.value, op: selOp.value, value,
        windowMs: Number(selWin.value), cooldownMs: Number(selCd.value),
        action: selAct.value, qty, enabled: true, lastFiredAt: 0,
      });
      saveRules(); inVal.value = ''; paintRules(); paintHeader(); paintWarn();
    };

    f.append(selSeries, selField, selOp, inVal, selWin, selCd, selAct, qtyBox, submit);
    sk.formHost.append(f);
    form = { f, selSeries, selField, selOp, inVal, selWin, selCd, selAct,
      qtyBox, selQty, inQtyVal, selQtyField, prev };
    syncFormOptions();
    updateQtyPreview();
  }

  /** Repopulate the "which field counts shares" override for the chosen series. */
  function syncQtyFieldOptions(series) {
    if (root.activeElement === form.selQtyField) return;
    const hs = holdingSeriesFor(series);
    const fields = hs ? (seriesIndex().get(hs) || []).slice().sort() : [];
    const sig = `${hs}|${fields.join(',')}`;
    if (sig === form._qtySig) return;
    form._qtySig = sig;

    const keep = form.selQtyField.value;
    form.selQtyField.replaceChildren();
    const auto = heldShares(series);
    form.selQtyField.append(new Option(
      auto ? `auto — reads ${auto.source.split('::')[1]}`
        : hs ? `auto — no share count found in ${shortSeries(hs)}`
          : 'auto — no holdings series observed yet', ''));
    for (const fl of fields) form.selQtyField.append(new Option(`count shares from "${fl}"`, fl));
    if (keep && fields.includes(keep)) form.selQtyField.value = keep;
  }

  /** Live "→ sell 120 shares" line under the size controls. */
  function updateQtyPreview() {
    if (!form || !form.qtyBox) return;
    const act = form.selAct.value;
    form.qtyBox.style.display = act === 'notify' ? 'none' : 'grid';
    if (act === 'notify') return;

    const mode = QTY_MODES[form.selQty.value];
    form.inQtyVal.style.display = mode.needsValue ? '' : 'none';
    form.inQtyVal.placeholder =
      mode.unit === '%' ? 'percent' : mode.unit === '$' ? 'amount to spend' : 'share count';

    const series = form.selSeries.value;
    if (!series) return;
    syncQtyFieldOptions(series);

    const probe = {
      series, action: act,
      qty: {
        mode: form.selQty.value,
        value: mode.needsValue ? parseFloat(form.inQtyVal.value) : null,
        field: form.selQtyField.value || null,
      },
    };
    const { shares, why } = resolveQty(probe, priceFor(series, null));
    form.prev.className = `prev ${shares === null ? 'no' : 'ok'}`;
    form.prev.textContent = shares === null
      ? `can't size yet — ${why}`
      : `→ ${act} ${fmtNum(shares)} shares · ${why}`;
  }

  let lastOptSig = '';
  function syncFormOptions() {
    if (!form) return;
    const idx = seriesIndex();
    const sig = [...idx.keys()].sort().join('|');
    if (sig === lastOptSig) { syncFieldOptions(); return; }
    // Never rewrite the list the user currently has open.
    if (root.activeElement === form.selSeries || root.activeElement === form.selField) { dirty = true; return; }
    lastOptSig = sig;

    const keep = form.selSeries.value;
    const all = [...idx.keys()].sort();
    // Short labels read better, but fall back to the full path when two groups
    // expose the same leaf name (stocks/instruments/PNRG vs stocks/holdings/PNRG).
    const seen = new Map();
    for (const s of all) seen.set(shortSeries(s), (seen.get(shortSeries(s)) || 0) + 1);

    form.selSeries.replaceChildren();
    for (const s of all) {
      const short = shortSeries(s);
      form.selSeries.append(new Option(seen.get(short) > 1 ? s : (short || s), s));
    }
    if (keep && idx.has(keep)) form.selSeries.value = keep;
    syncFieldOptions();
  }

  function syncFieldOptions() {
    if (!form) return;
    if (root.activeElement === form.selField) return;
    const fields = (seriesIndex().get(form.selSeries.value) || []).slice().sort();
    const keep = form.selField.value;
    if (fields.join(',') === [...form.selField.options].map((o) => o.value).join(',')) return;
    form.selField.replaceChildren();
    for (const f of fields) form.selField.append(new Option(f, f));
    if (keep && fields.includes(keep)) form.selField.value = keep;
  }

  function prefill(series, field) {
    if (!form) return;
    syncFormOptions();
    form.selSeries.value = series;
    syncFieldOptions();
    form.selField.value = field;
    const last = latest(`${series}::${field}`);
    if (last) form.inVal.value = String(Number(last[1].toFixed(2)));
    updateQtyPreview();
    form.f.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    form.inVal.focus();
    form.inVal.select();
  }

  // ===========================================================================
  // Boot
  // ===========================================================================
  // ---------------------------------------------------------------------------
  // Placement — the button is draggable and the panel follows it, flipping to
  // whichever side has room so it can't end up hanging off the viewport.
  // ---------------------------------------------------------------------------
  // FAB KIT v8's home row, in JS. This tool places its own button, so an inline
  // left/top always outranks the kit's CSS rule and the row has to be computed here
  // instead. The numbers are the block's, verbatim: sixteen 38px buttons 8px apart
  // is a 728px row, so half of it is 364 — centred on the viewport and floored at
  // where the game's own nav ends, sitting 7px down inside the header band.
  // tools/test-placement.js reads both the CSS and this literal and fails the build
  // if they ever drift apart, which is what caught this comment still saying v4.
  // The home row, mirrored out of FAB KIT v8's CSS. This tool writes an inline
  // left/top, and an inline value outranks any rule, so the kit never gets the last
  // word here — the two copies have to say the same thing instead. `row` is the
  // whole row (sixteen slots at a 46px pitch, less the gap the last one does not
  // need) and `edge` is what it keeps clear of the window.
  const HOME = { slot: 7, top: 7, floor: 440, half: 364, pitch: 46, edge: 8, row: 728,
                 narrow: 768, fold: 8, foldTop: 55 };

  /**
   * Which of the game's two layouts is on screen — asked the way the GAME asks
   * it, because these two must never disagree about the answer. Tailwind's md:
   * and the useIsMobile every chunk carries are both a media query, so this is
   * one too. Note that a media query's width INCLUDES the classic scrollbar and
   * rowWidth() below deliberately excludes it: same rule, two widths, on purpose
   * — this picks the regime, that places the button inside it.
   */
  const folded = () => (window.matchMedia
    ? window.matchMedia(`(max-width: ${HOME.narrow - 1}px)`).matches
    : window.innerWidth < HOME.narrow);

  /**
   * The width the row is laid out against, and the one place the difference
   * matters. CSS resolves a percentage for a fixed element against the initial
   * containing block, which EXCLUDES the classic scrollbar; window.innerWidth
   * includes it. Reading innerWidth here put this button half a scrollbar — 7.5px
   * on a 15px bar — to the right of where the kit puts the other fourteen, which
   * is most of the 8px gap: it sat all but touching its neighbour, and on a wider
   * scrollbar it overlapped. documentElement.clientWidth IS that containing block.
   */
  const rowWidth = () => document.documentElement.clientWidth || window.innerWidth;

  /**
   * Where this slot sits when nobody has dragged it, in both of the row's shapes.
   *
   * Wide: centred, but never left of the game's nav, and never so far right that
   * the far end of the row leaves the window. The edge outranks the nav on
   * purpose — a row sitting over the game's chrome is legible and clickable,
   * whereas a row past the edge gets clamped back by fit(), every stray button
   * onto the SAME pixel, and saved there.
   *
   * Folded: the mobile header has no empty band to borrow, so the row drops below
   * it and becomes two lines of eight, right-aligned to the same 8px edge. FAB KIT
   * v9 carries the four numbers and why each one is what it is; this is that
   * arithmetic again in JS, which is only needed because an inline left/top
   * outranks the stylesheet the other fourteen buttons are placed by.
   */
  const defaultFabPos = () => {
    const w = rowWidth();
    if (folded()) {
      const line = HOME.slot < HOME.fold ? 0 : 1;
      // max(edge, w - fold * pitch) is the rule's max(8px, 100% - 368px) spelled
      // out: the block is fold * pitch - edge wide and keeps one more edge to its
      // right, and the two edges cancel.
      return {
        x: Math.max(HOME.edge, w - HOME.fold * HOME.pitch)
           + (HOME.slot - line * HOME.fold) * HOME.pitch,
        y: HOME.foldTop + line * HOME.pitch,
      };
    }
    return {
      x: Math.max(HOME.edge,
                  Math.min(Math.max(HOME.floor, w / 2 - HOME.half), w - HOME.edge - HOME.row))
         + HOME.slot * HOME.pitch,
      y: HOME.top,
    };
  };

  const clampFab = ({ x, y }) => ({
    x: Math.min(Math.max(x, CFG.EDGE), Math.max(CFG.EDGE, window.innerWidth - CFG.FAB_SIZE - CFG.EDGE)),
    // The top floor is the row's own 7px, not CFG.EDGE. Clamping to 8 put this
    // button one pixel below the fourteen the kit places — every mount, every
    // reset, for as long as the row has existed.
    y: Math.min(Math.max(y, Math.min(CFG.EDGE, HOME.top)),
                Math.max(CFG.EDGE, window.innerHeight - CFG.FAB_SIZE - CFG.EDGE)),
  });

  /**
   * A hidden tab, a minimised window, or a collapsed devtools pane can report a
   * ~zero viewport. Clamping against that pins everything to the top-left corner
   * and the next save makes it permanent, so treat it as "no information" and
   * leave the stored position alone until real dimensions come back.
   */
  const viewportUsable = () => window.innerWidth > 120 && window.innerHeight > 120;

  /**
   * Where the button is right now: what the user dragged it to, or the home row.
   *
   * ui.fab holds a position the USER chose, and stays empty until they drag one.
   * placeFab() used to fill it in with the row instead — ui.fab = ui.fab ||
   * defaultFabPos() — which quietly turned a position derived from the viewport
   * into a stored constant on the first mount. The row is a function of the
   * window: resize it, zoom the page, drag it to a display with different
   * scaling, and the fourteen buttons the kit places in CSS all move, because
   * CSS re-resolves. This one did not, because there was nothing left to
   * re-resolve — the resize handler found a stored position and clamped that.
   * Derive it every time; store only what was actually chosen.
   */
  const fabAt = () => {
    if (ui.fab) return clampFab(ui.fab);
    // Not moved: ask the browser where the kit's rule actually put it, rather than
    // recomputing the row and hoping the two agree. They did not — see rowWidth().
    const r = $fab && $fab.getBoundingClientRect();
    return r && r.width ? { x: r.left, y: r.top } : clampFab(defaultFabPos());
  };

  function placeFab() {
    if (!$fab || !viewportUsable()) return;
    if (ui.fab) {
      const p = clampFab(ui.fab);
      Object.assign($fab.style, {
        left: `${p.x}px`, top: `${p.y}px`, right: 'auto', bottom: 'auto',
      });
    } else {
      // Nobody has moved this button, so it belongs to FAB KIT's rule exactly like
      // the other fourteen — clear the inline anchoring and let the CSS place it.
      //
      // Writing the row out here instead is what put this button 7.5px right of it:
      // an inline left/top is a SECOND copy of the row, and a copy is only ever as
      // fresh as the last event that recomputed it. There was no event for the one
      // that mattered — a scrollbar appearing narrows the containing block without
      // firing resize, and the button stayed where the pre-scrollbar viewport had
      // put it. defaultFabPos() is still the arithmetic of record for the panel and
      // for the start of a drag; it just no longer competes with the stylesheet.
      Object.assign($fab.style, { left: '', top: '', right: '', bottom: '' });
    }
    placePanel();
  }

  const panelW = () => Math.max(CFG.PANEL_MIN_W,
    Math.min(CFG.PANEL_W, window.innerWidth - CFG.EDGE * 2));

  /** A preset's width, clamped to a window it may not fit in. */
  const presetW = (w) => Math.max(CFG.PANEL_MIN_W, Math.min(w, window.innerWidth - CFG.EDGE * 2));

  /**
   * What a null-height preset resolves to: everything from the panel's current top
   * edge down to the bottom margin. Measured rather than assumed, because where the
   * panel's top edge IS depends on whether it is parked or still tethered to a
   * button that could be anywhere.
   */
  const fillH = () => {
    const top = $panel ? $panel.getBoundingClientRect().top : CFG.EDGE;
    return Math.max(CFG.PANEL_MIN_H, window.innerHeight - Math.max(0, top) - CFG.EDGE);
  };

  // Which edges the TETHERED panel hangs off its button by. Only meaningful while
  // ui.panel is empty; once the panel has been parked it is anchored by left/top
  // like every other panel in the repo, and neither of these is read again.
  let panelAlign = 'right', panelAnchor = 'bottom';

  function placePanel() {
    if (!$panel || !viewportUsable()) return;
    const { x, y } = fabAt();
    const gap = 10;
    const vw = window.innerWidth, vh = window.innerHeight;

    // The tether MEASURES the width; it never writes one. PANEL KIT's resizable()
    // treats an inline width or height as proof the user dragged the corner — it
    // has no other way to tell a gesture from a re-render — so a tether that set
    // `style.width` on every paint reported a resize it had invented, and the
    // panel parked itself and stopped following the button without anyone touching
    // it. The default width is the stylesheet's, clamped there against the
    // viewport, which is also the only place it belongs.
    const sized = !!(panelResize && panelResize.sized());
    const w = $panel.getBoundingClientRect().width || panelW();

    // Parked by hand: the panel keeps its own spot and stops following the button.
    // Height is capped to what is left below it so the body scrolls rather than
    // running off the bottom. Double-click the header hands both back.
    if (ui.panel) {
      $panel.style.left = `${ui.panel.x}px`;
      $panel.style.top = `${ui.panel.y}px`;
      $panel.style.right = 'auto';
      $panel.style.bottom = 'auto';
      if (!sized) {
        $panel.style.maxHeight = `${Math.max(CFG.PANEL_MIN_H, vh - ui.panel.y - CFG.EDGE)}px`;
        $panel.style.height = '';
      }
      panelDrag?.fit();
      return;
    }

    // Horizontal: hang the panel off whichever edge of the button leaves it
    // fully on screen, preferring right-aligned to match the default corner.
    // Sticky: keep the current side while it still fits, otherwise shrinking the
    // panel makes right-alignment viable again and the panel hops across the
    // button mid-gesture.
    const rightAligned = x + CFG.FAB_SIZE - w;
    const leftAligned = x;
    const fits = (l) => l >= CFG.EDGE && l + w <= vw - CFG.EDGE;

    let left;
    if (panelAlign === 'left' && fits(leftAligned)) left = leftAligned;
    else if (fits(rightAligned)) { left = rightAligned; panelAlign = 'right'; }
    else if (fits(leftAligned)) { left = leftAligned; panelAlign = 'left'; }
    else { left = rightAligned; panelAlign = 'right'; }
    left = Math.max(CFG.EDGE, Math.min(left, vw - w - CFG.EDGE));
    $panel.style.left = `${left}px`;
    $panel.style.right = 'auto';

    // Vertical: whichever side of the button has more room, capped to exactly
    // that much so it always fits.
    const above = y - gap - CFG.EDGE;
    const below = vh - (y + CFG.FAB_SIZE) - gap - CFG.EDGE;
    panelAnchor = above >= below ? 'bottom' : 'top';
    if (panelAnchor === 'bottom') {
      $panel.style.bottom = `${vh - y + gap}px`;
      $panel.style.top = 'auto';
    } else {
      $panel.style.top = `${y + CFG.FAB_SIZE + gap}px`;
      $panel.style.bottom = 'auto';
    }

    // Still tethered and never sized: cap the height at the room the button
    // leaves, so the body scrolls instead of the panel running off an edge.
    if (!sized) {
      $panel.style.maxHeight = `${Math.max(CFG.PANEL_MIN_H, Math.max(above, below))}px`;
      $panel.style.height = '';
    }
    // No fit() here on purpose. The tether has just placed the panel inside the
    // viewport itself, and fit() would convert its bottom/top anchoring into
    // left/top and report the move — which is how the panel would silently park
    // itself without anyone dragging it.
  }

  function paintSizes() {
    if (!sk || !sk.sizes) return;
    const r = $panel.getBoundingClientRect();
    sk.dim.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
    // A preset is "on" when the panel is actually that size, measured, rather than
    // when ui.size happens to hold the numbers it wrote. They come apart the moment
    // you drag the corner: the kit stores the new size and the preset that put the
    // panel there a second ago is no longer describing it.
    for (const b of sk.sizes.querySelectorAll('button')) {
      const p = SIZE_PRESETS.find(([n]) => n === b.textContent);
      b.classList.toggle('on', p
        ? Math.abs(r.width - presetW(p[1])) < 1.5 && (p[2] === null || Math.abs(r.height - p[2]) < 1.5)
        : b.textContent === 'auto' && !(panelResize && panelResize.sized()));
    }
  }

  function makeDraggable() {
    let drag = null;
    let suppressClick = false;

    $fab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = fabAt();
      drag = { dx: e.clientX - p.x, dy: e.clientY - p.y, id: e.pointerId, moved: false };
      try { $fab.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
      e.preventDefault();
    });

    $fab.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const nx = e.clientX - drag.dx, ny = e.clientY - drag.dy;
      // A few px of slop so a slightly shaky click still counts as a click.
      const at = fabAt();
      if (!drag.moved && Math.hypot(nx - at.x, ny - at.y) < 4) return;
      if (!drag.moved) { drag.moved = true; $fab.classList.add('dragging'); }
      ui.fab = clampFab({ x: nx, y: ny });
      placeFab();
    });

    const end = (e) => {
      if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
      const moved = drag.moved;
      drag = null;
      $fab.classList.remove('dragging');
      try { $fab.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      if (moved) { suppressClick = true; saveUI(); }
    };
    $fab.addEventListener('pointerup', end);
    $fab.addEventListener('pointercancel', end);

    // Click still drives the toggle, so the keyboard path keeps working; a drag
    // just swallows the click that follows it.
    $fab.onclick = () => {
      if (suppressClick) { suppressClick = false; return; }
      togglePanel();
    };

    // Double-click returns it to the corner if it gets lost.
    // Double-click FORGETS the chosen position rather than storing the row in its
    // place, so the button goes back to following the viewport as well as to the
    // right pixel — the same state it was in before it was ever dragged.
    $fab.ondblclick = () => { ui.fab = null; saveUI(); placeFab(); };
  }

  function mount() {
    if (root) return;
    const host = el('div');
    host.id = 'pkmw-root';
    root = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS;
    const wrap = el('div', 'wrap');
    $toasts = el('div', 'toasts');

    $fab = el('button', 'pk-fab fab', 'MKT');
    $fab.title = 'Market Watch (Alt+M) — drag to move, double-click to reset';

    $panel = el('div', 'panel');
    $panel.style.display = 'none';

    // The chart overlay. It sits in .wrap like everything else, so it inherits
    // pointer-events: none and cannot intercept a click meant for the game.
    $ovl = el('div', 'ovl');
    $ovl.style.display = 'none';

    wrap.append($ovl, $toasts, $panel, $fab);
    root.append(style, wrap);
    document.documentElement.append(host);

    buildSkeleton();

    // Park it where you like; until you do, it stays tethered to the button. This
    // is the pair every other panel in the repo gets, and the one thing market-watch
    // never had — it moved only by moving its button, and resized only through a
    // grip that hopped corners as the tether flipped sides.
    panelDrag = draggable($panel, sk.hdr, (pos) => {
      ui.panel = pos; saveUI();
      if (!pos) placePanel();   // reset() — hand it back to the tether
    });
    panelResize = resizable($panel, (size) => {
      ui.size = size ?? undefined;
      // Resizing is positioning. The tether re-derives the panel's box from the
      // button on every paint, so a sized panel still following the button would be
      // shoved around by the next response to land. Park it where it stands — the
      // same state dragging it produces, and one double-click hands back both.
      if (size && !ui.panel) {
        const r = $panel.getBoundingClientRect();
        ui.panel = { x: r.left, y: r.top };
      }
      saveUI();
      paintSizes();
    }, { drag: panelDrag, minW: CFG.PANEL_MIN_W, minH: CFG.PANEL_MIN_H });

    // One gesture hands back everything the panel remembers about its own shape.
    sk.hdr.addEventListener('dblclick', () => {
      panelDrag.reset(); panelResize.reset(); placePanel(); paintSizes();
    });

    placeFab();
    paintFabState();
    makeDraggable();
    // An UNMOVED button needs none of this — it is on the kit's stylesheet and the
    // browser re-resolves it for free. These three are for a button the user has
    // dragged: a stored position has to be re-clamped when the window it was stored
    // against changes shape, or a corner you dropped it in is off screen.
    //
    //   resize          the window itself, and browser zoom, which changes the CSS
    //                   viewport and so fires this too
    //   visualViewport  a pinch, which moves the visual viewport over the layout one
    //                   without firing the above
    //   ResizeObserver  the layout viewport changing width with no event at all,
    //                   which is what a scrollbar appearing or going does
    window.addEventListener('resize', placeFab);
    window.visualViewport?.addEventListener('resize', placeFab);
    try { new ResizeObserver(() => placeFab()).observe(document.documentElement); }
    catch { /* no ResizeObserver: the two listeners above still cover resize and zoom */ }

    // The overlay is pinned to a box in viewport coordinates, so anything that
    // moves that box has to move it too. Scroll is captured because the chart sits
    // in a scroll container of the app's, not on the document.
    window.addEventListener('resize', drawSoon);
    window.addEventListener('scroll', drawSoon, { capture: true, passive: true });

    // Floor under every subscription: the chart component is keyed on symbol and
    // timeframe, so switching either disposes the object we hold and mounts a new
    // one that has told nobody it exists. A querySelector once a second finds it.
    // Idle when the tab is hidden — there is nothing to draw on a page nobody is
    // looking at, and this repo does not run timers behind your back.
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!ui.mark && !ui.costLine) return;
      const host = document.querySelector(CHART_SEL);
      if (!host) { if (bound) { unbind(); drawSoon(); refresh(); } return; }
      if (!bound || bound.host !== host) { drawSoon(); refresh(); }
    }, CFG.REBIND_MS);

    if (ui.open) togglePanel(true);
    drawSoon();
  }

  function togglePanel(force) {
    ui.open = typeof force === 'boolean' ? force : !ui.open;
    saveUI();
    $panel.style.display = ui.open ? 'flex' : 'none';
    $fab.classList.toggle('pk-open', ui.open);   // the button says which window is up
    if (!ui.open) return;
    // display:none has no geometry, so a stored position and size can only be
    // restored once the panel is actually showing — the kit measures what it moves.
    if (ui.panel) panelDrag?.apply(ui.panel);
    panelResize?.apply(ui.size);
    placePanel();
    paintSizes();
    lastStructSig = '';
    refresh();
    panelDrag?.fit();   // content decides the height, so only now is the header sure to be reachable
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === CFG.HOTKEY) {
      e.preventDefault(); mount(); togglePanel();
    }
  });

  const boot = () => {
    mount();
    log(`ready — ${Object.keys(hist).length} series in local history, ${rules.length} rules.`);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  // Disclosed debug handle. Read-only helpers — nothing here writes to the game
  // and nothing phones home.
  window.__pkmw = {
    hist, get rules() { return rules; }, CFG, refresh,
    get ids() { return entityIds; },
    get trades() { return trades; },
    series: () => [...seriesIndex()].map(([s, f]) => ({ series: s, fields: f })),
    export: () => JSON.stringify({ hist, rules }, null, 2),

    // What the overlay thinks it is looking at, in one object. This is the thing
    // to print when a mark lands somewhere it should not: it carries the bars, the
    // decoded game day and the bar indexes the mark was computed from.
    model: () => chartModel(),

    // The bench seam. userscripts/tools/harness/ has no React and no chart library,
    // so the fiber walk has nothing to walk; handing it a stand-in exercises every
    // line downstream of the walk against canned candles. It only ever RECEIVES an
    // object — it cannot reach the game, and passing null puts the real lookup back.
    attachChart: (stub) => { testChart = stub ? Object.assign({ off: [] }, stub) : null; drawSoon(); refresh(); },
  };
})();
