// ==UserScript==
// @name         Politiko — Market Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.2.0
// @description  Records numeric series out of market/API responses the app already fetched, charts them locally, and fires threshold / %-move / rate-of-change alerts. Optional order execution is a seam and ships disabled.
// @author       dataterminals
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON bodies of /api/* responses the app requested on its own, via a
 *             passive fetch/XHR tap. No DOM scraping, no polling, no prefetch.
 *   Requests: ZERO additional requests to politiko.io in the shipped configuration.
 *   Sends:    nothing, to anyone, ever. No telemetry, no remote config.
 *   Storage:  localStorage keys prefixed `pkmw:` — observed price history, watch rules,
 *             and panel settings. All local. Clearable from the panel.
 *   Alerts:   in-page only, and only while the tab is visible. Alerts raised while
 *             hidden are queued and shown on return. No Notification API, no title
 *             flashing, no sound while backgrounded.
 *
 *   NOT SHIPPED, BUT SEAMED: `registerExecutor()` below is the attachment point for
 *   automatic order placement. It is empty, and AUTO_EXECUTE is false. If an executor
 *   is ever registered, this script BEGINS ORIGINATING WRITE REQUESTS to politiko.io
 *   and this disclosure block must be rewritten to say so before the file is shared
 *   with anyone. See CLAUDE.md hard rule 2 and docs/01-rules-envelope.md.
 */

(() => {
  'use strict';

  const TAG = '[pkmw]';
  const log = (...a) => console.debug(TAG, ...a);

  // ===========================================================================
  // Config
  // ===========================================================================
  const CFG = {
    // Master switch for the execution seam. Flipping this alone does nothing —
    // an executor must also be registered for the series. See EXECUTORS below.
    AUTO_EXECUTE: false,

    MAX_POINTS_PER_SERIES: 300,   // ring buffer depth
    MAX_SERIES: 400,              // total tracked series::field pairs
    MIN_SAMPLE_GAP_MS: 60_000,    // re-record an unchanged value at most this often
    SAVE_DEBOUNCE_MS: 2_000,
    DEFAULT_COOLDOWN_MS: 15 * 60_000,
    HOTKEY: 'm',                  // Alt+M toggles the panel
  };

  const K = { hist: 'pkmw:hist', rules: 'pkmw:rules', ui: 'pkmw:ui' };

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
    { open: false, sound: true, deltaWin: 3_600_000, filter: '', expanded: {} },
    readJSON(K.ui, {}),
  );

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

  /** Append a sample, deduping unchanged values inside MIN_SAMPLE_GAP_MS. */
  function record(series, field, value, t = now()) {
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
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const raw = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (raw.includes('/api/') && (res.headers.get('content-type') || '').includes('json')) {
        res.clone().json().then((d) => ingest(raw, d), () => {});
      }
    } catch (e) { log('fetch tap', e); }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__pkmwUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        const url = this.__pkmwUrl || '';
        if (!String(url).includes('/api/')) return;
        const ct = this.getResponseHeader('content-type') || '';
        if (!ct.includes('json')) return;
        const body = this.responseType === '' || this.responseType === 'text'
          ? JSON.parse(this.responseText)
          : this.response;
        ingest(String(url), body);
      } catch { /* not our problem */ }
    });
    return origSend.apply(this, a);
  };

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
  // Execution seam
  //
  // Empty by design. An executor is a function that places one order for a
  // series and returns a promise. Registering one turns this script from a
  // pure reader into something that ORIGINATES WRITE REQUESTS to politiko.io.
  //
  //   registerExecutor('stocks/instruments/PNRG', async ({ side, rule, ev }) => { ... })
  //
  // Nothing can be written here yet: the order endpoint, its request shape, and
  // the session auth scheme are all still unknown, and CLAUDE.md hard rule 4
  // forbids probing endpoints to find out. The gap closes by observing a real
  // order placed by hand, in DevTools.
  //
  // Until then a rule with action=buy/sell degrades to a loud notify that states
  // exactly what it would have sent.
  // ===========================================================================
  const EXECUTORS = new Map();
  function registerExecutor(series, fn) {
    if (typeof fn !== 'function') throw new TypeError('executor must be a function');
    EXECUTORS.set(series, fn);
    log('executor registered for', series, '— this script can now place orders.');
    refresh();
  }

  async function tryExecute(rule, ev, hit) {
    const side = rule.action === 'buy' ? 'buy' : 'sell';
    const exec = EXECUTORS.get(rule.series);

    if (!CFG.AUTO_EXECUTE || !exec) {
      const why = !CFG.AUTO_EXECUTE ? 'AUTO_EXECUTE is off' : `no executor registered for ${rule.series}`;
      toast('warn', `WOULD ${side.toUpperCase()} — ${shortSeries(rule.series)}`,
        `${describe(rule, ev, hit).body}\nNot sent: ${why}.`);
      return;
    }

    try {
      const result = await exec({ side, rule, ev, hit, qty: rule.qty ?? null });
      toast('ok', `${side.toUpperCase()} SENT — ${shortSeries(rule.series)}`, String(result ?? 'order placed'));
    } catch (e) {
      toast('err', `${side.toUpperCase()} FAILED — ${shortSeries(rule.series)}`, String((e && e.message) || e));
    }
  }

  function fire(rule, ev, hit) {
    const d = describe(rule, ev, hit);
    if (rule.action === 'notify') toast('alert', d.head, d.body);
    else tryExecute(rule, ev, hit);
  }

  // ===========================================================================
  // Alerts — in-page only, and only while visible.
  // ===========================================================================
  const pending = [];

  function toast(kind, head, body) {
    if (document.visibilityState !== 'visible') { pending.push([kind, head, body]); return; }
    paintToast(kind, head, body);
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
    return pool[0];
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

  // ===========================================================================
  // UI — shadow DOM so the app's stylesheet (and its hashed classes) can't
  // reach us and we can't reach it.
  // ===========================================================================
  let root = null, $panel = null, $toasts = null;
  let sk = null;          // skeleton refs, built exactly once
  let dirty = false;      // a refresh was suppressed while the user was busy

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
    .wrap { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
    .toasts { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 8px; width: 340px; }
    .toast { pointer-events: auto; background: #09090b; color: #e4e4e7; border: 1px solid #27272a;
             border-left-width: 3px; border-radius: 8px; padding: 10px 12px; font-size: 12px;
             box-shadow: 0 8px 24px rgba(0,0,0,.5); animation: in .18s ease-out; }
    .toast h4 { margin: 0 0 4px; font-size: 12px; font-weight: 600; letter-spacing: .01em; }
    .toast p { margin: 0; color: #a1a1aa; white-space: pre-wrap; line-height: 1.45; }
    .toast.alert { border-left-color: #22c55e; }
    .toast.warn  { border-left-color: #f59e0b; }
    .toast.err   { border-left-color: #ef4444; }
    .toast.ok    { border-left-color: #3b82f6; }
    .toast button { float: right; background: none; border: 0; color: #52525b; cursor: pointer; font-size: 14px; line-height: 1; }
    @keyframes in { from { opacity: 0; transform: translateY(-6px); } }

    .fab { pointer-events: auto; position: absolute; bottom: 16px; right: 16px; width: 40px; height: 40px;
           border-radius: 999px; background: #18181b; color: #e4e4e7; border: 1px solid #3f3f46;
           cursor: pointer; font-size: 15px; box-shadow: 0 4px 14px rgba(0,0,0,.45); }

    .panel { pointer-events: auto; position: absolute; bottom: 66px; right: 16px; width: 430px;
             max-height: 74vh; display: flex; flex-direction: column; background: #09090b;
             color: #e4e4e7; border: 1px solid #27272a; border-radius: 10px; font-size: 12px;
             box-shadow: 0 16px 48px rgba(0,0,0,.6); }
    .panel > .scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
    header { flex: 0 0 auto; border-bottom: 1px solid #27272a; padding: 9px 12px;
             display: flex; align-items: center; gap: 8px; }
    header b { font-size: 12px; font-weight: 600; }
    header .sp { flex: 1; }
    header .cnt { color: #52525b; font-size: 11px; }
    section { padding: 10px 12px; border-bottom: 1px solid #18181b; }
    section:last-child { border-bottom: 0; }
    h5 { margin: 0 0 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #52525b; }
    .muted { color: #52525b; }
    button.mini { background: #18181b; border: 1px solid #27272a; color: #a1a1aa; border-radius: 5px;
                  padding: 2px 7px; cursor: pointer; font-size: 11px; }
    button.mini:hover { border-color: #3f3f46; color: #e4e4e7; }
    button.mini.danger:hover { border-color: #ef4444; color: #ef4444; }
    .up { color: #22c55e; } .dn { color: #ef4444; } .flat { color: #3f3f46; }

    .rule { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-top: 1px solid #18181b; }
    .rule:first-of-type { border-top: 0; }
    .rule .txt { flex: 1; line-height: 1.35; }
    .rule .txt em { font-style: normal; color: #71717a; }
    .badge { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; padding: 1px 5px;
             border-radius: 3px; border: 1px solid currentColor; }
    .badge.notify { color: #3b82f6; } .badge.buy { color: #22c55e; } .badge.sell { color: #f59e0b; }

    form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    form .full { grid-column: 1 / -1; }
    input, select { width: 100%; background: #18181b; border: 1px solid #27272a; color: #e4e4e7;
                    border-radius: 5px; padding: 4px 6px; font-size: 11px; }
    input:focus, select:focus { outline: 1px solid #3f3f46; }
    .warnbox { background: #1c1410; border: 1px solid #7c2d12; color: #fdba74; border-radius: 6px;
               padding: 7px 9px; line-height: 1.45; }

    .toolbar { flex: 0 0 auto; display: flex; gap: 6px; align-items: center; padding: 7px 12px;
               border-bottom: 1px solid #18181b; }
    .toolbar input { flex: 1; }
    .seg { display: flex; border: 1px solid #27272a; border-radius: 5px; overflow: hidden; flex: 0 0 auto; }
    .seg button { background: none; border: 0; color: #52525b; padding: 3px 6px; cursor: pointer;
                  font-size: 10px; font-variant-numeric: tabular-nums; }
    .seg button.on { background: #27272a; color: #e4e4e7; }

    .grp { padding: 9px 12px 5px; }
    .grp h6 { margin: 0 0 3px; font-size: 10px; font-weight: 500; color: #3f3f46;
              letter-spacing: .04em; display: flex; gap: 6px; align-items: baseline; }
    .row { display: flex; align-items: center; gap: 7px; padding: 4px 0;
           border-top: 1px solid #131316; cursor: pointer; }
    .row:hover { background: #0d0d10; }
    .row .sym { flex: 0 0 78px; color: #e4e4e7; font-weight: 500;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .px  { flex: 1; text-align: right; font-variant-numeric: tabular-nums; }
    .row .dt  { flex: 0 0 50px; text-align: right; font-variant-numeric: tabular-nums; font-size: 11px; }
    .row .sk  { flex: 0 0 50px; height: 15px; display: block; }
    .row .chev { flex: 0 0 9px; color: #3f3f46; font-size: 9px; }
    .sub { padding: 2px 0 6px 8px; border-top: 1px solid #131316; }
    .sub .f { display: flex; gap: 8px; padding: 2px 0; align-items: center; }
    .sub .f .n { flex: 1; color: #71717a; }
    .sub .f .v { font-variant-numeric: tabular-nums; color: #a1a1aa; }
    .sub .f.stat .n, .sub .f.stat .v { color: #3f3f46; }
    .sub .f.stat .n::after { content: ' · fixed'; font-size: 9px; }
    .empty { color: #52525b; padding: 4px 0; line-height: 1.5; }
  `;

  function paintToast(kind, head, body) {
    if (!$toasts) return;
    const t = el('div', `toast ${kind}`);
    const close = el('button', null, '×');
    close.onclick = () => t.remove();
    t.append(close, el('h4', null, head), el('p', null, body));
    $toasts.prepend(t);
    setTimeout(() => t.remove(), kind === 'alert' ? 30_000 : 60_000);
    while ($toasts.children.length > 6) $toasts.lastElementChild.remove();
  }

  // ---------------------------------------------------------------------------
  // Skeleton — every persistent node is created here ONCE. Refresh only mutates
  // text and swaps rows; it never replaces the toolbar or the form, so an open
  // <select> or a half-typed input survives incoming price ticks.
  // ---------------------------------------------------------------------------
  function buildSkeleton() {
    const hdr = el('header');
    const cnt = el('span', 'cnt');
    const snd = el('button', 'mini');
    snd.onclick = () => { ui.sound = !ui.sound; saveUI(); snd.textContent = ui.sound ? '🔊' : '🔇'; };
    snd.textContent = ui.sound ? '🔊' : '🔇';
    hdr.append(el('b', null, 'Market Watch'), el('span', 'sp'), cnt, snd);

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

    scroll.append(warnSec, obs, ruleSec, formSec, ft);
    $panel.append(hdr, bar, scroll);

    sk = { cnt, warnSec, warn, obs, ruleBody, formHost, filter };
    buildForm();

    // If a tick arrived while the user held a control open, apply it on release.
    $panel.addEventListener('focusout', () => { if (dirty) setTimeout(refresh, 0); });
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
      paintObserved();
      paintRules();
      syncFormOptions();
    });
  }

  function paintHeader() {
    const n = seriesIndex().size;
    sk.cnt.textContent = `${n} series · ${rules.length} rule${rules.length === 1 ? '' : 's'}`;
  }

  function paintWarn() {
    const armed = rules.some((r) => r.action !== 'notify');
    sk.warnSec.style.display = armed ? '' : 'none';
    if (!armed) return;
    sk.warn.textContent = CFG.AUTO_EXECUTE && EXECUTORS.size
      ? `LIVE: ${EXECUTORS.size} executor(s) registered. This script will place real orders.`
      : 'Execute rules are armed but no executor is wired — they will alert with the order they would have sent, and send nothing. See the seam in this file.';
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
      `${g}>${its.map((i) => `${i.entity}:${i.fields.join(',')}:${ui.expanded[i.series] ? 1 : 0}`).join('|')}`
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

      for (const [g, items] of visible) {
        const grp = el('div', 'grp');
        grp.append(el('h6', null, g || 'root'));
        for (const it of items) grp.append(buildRow(g, it));
        sk.obs.append(grp);
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
        const stat = isStatic(key);
        const row = el('div', `f${stat ? ' stat' : ''}`);
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

    const submit = mk('button', { type: 'submit', className: 'mini full', textContent: 'add rule' });
    submit.style.padding = '5px';

    selSeries.onchange = () => syncFieldOptions();
    selOp.onchange = () => { selWin.disabled = !OPS[selOp.value].needsWindow; };

    f.onsubmit = (e) => {
      e.preventDefault();
      const value = parseFloat(inVal.value);
      if (!selSeries.value || !selField.value || !Number.isFinite(value)) {
        toast('err', 'Incomplete rule', 'Pick a series, a field, and a numeric threshold.');
        return;
      }
      if (selAct.value !== 'notify' && !(CFG.AUTO_EXECUTE && EXECUTORS.has(selSeries.value))) {
        toast('warn', 'Rule added — but it cannot trade',
          'No executor is wired for this series, so it will alert with the order it would have sent instead. That seam is unimplemented on purpose; the endpoint and auth shape are still unknown.');
      }
      rules.push({
        id: `r${now().toString(36)}${rules.length + 1}`,
        series: selSeries.value, field: selField.value, op: selOp.value, value,
        windowMs: Number(selWin.value), cooldownMs: Number(selCd.value),
        action: selAct.value, enabled: true, lastFiredAt: 0,
      });
      saveRules(); inVal.value = ''; paintRules(); paintHeader(); paintWarn();
    };

    f.append(selSeries, selField, selOp, inVal, selWin, selCd, selAct, submit);
    sk.formHost.append(f);
    form = { f, selSeries, selField, selOp, inVal, selWin, selCd, selAct };
    syncFormOptions();
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
    form.f.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    form.inVal.focus();
    form.inVal.select();
  }

  // ===========================================================================
  // Boot
  // ===========================================================================
  function mount() {
    if (root) return;
    const host = el('div');
    host.id = 'pkmw-root';
    root = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS;
    const wrap = el('div', 'wrap');
    $toasts = el('div', 'toasts');

    const fab = el('button', 'fab', '📈');
    fab.title = 'Market Watch (Alt+M)';
    fab.onclick = () => togglePanel();

    $panel = el('div', 'panel');
    $panel.style.display = 'none';

    wrap.append($toasts, $panel, fab);
    root.append(style, wrap);
    document.documentElement.append(host);

    buildSkeleton();
    if (ui.open) togglePanel(true);
  }

  function togglePanel(force) {
    ui.open = typeof force === 'boolean' ? force : !ui.open;
    saveUI();
    $panel.style.display = ui.open ? 'flex' : 'none';
    if (ui.open) { lastStructSig = ''; refresh(); }
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

  // Disclosed debug handle. Read-only helpers plus the executor registration
  // point — nothing here phones home.
  window.__pkmw = {
    hist, get rules() { return rules; }, CFG, EXECUTORS, registerExecutor, refresh,
    series: () => [...seriesIndex()].map(([s, f]) => ({ series: s, fields: f })),
    export: () => JSON.stringify({ hist, rules }, null, 2),
  };
})();
