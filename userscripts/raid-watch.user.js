// ==UserScript==
// @name         Politiko — Raid Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  Records faction raids from responses the game already fetched: the raid list your faction page polls on its own every five seconds, its event log, and the post-mortem report. Builds the event-type vocabulary the client never spells out, charts the score curve, and ranks who actually did the work. Passive — zero added requests, and it never touches a raid action.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/raid-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/raid-watch.user.js
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
 *               /api/factions/<id>/raids                    the faction page's own poll
 *               /api/factions/<id>/raids/<raid>/report      when you open a report
 *             No DOM scraping.
 *
 *   Requests: ZERO. This script does not originate network calls to politiko.io.
 *
 *             This matters more here than in any other tool in this repo. The raid
 *             surface has four write endpoints sitting directly beside the two read
 *             ones — cease, surrender, accept-surrender, flag-override. This script
 *             contains no code that can call them, no arming switch, and no seam where
 *             one could be added quietly. tools/test-raid-passive.js fails the build if
 *             any of those paths, or any non-GET verb, ever appears in this file.
 *
 *             The faction page polls the raid list every five seconds by itself, for as
 *             long as you have it open. Everything this tool knows is a copy of what
 *             that poll already brought back. Close the page and it learns nothing.
 *
 *   Sends:    nothing, to anyone, ever. No telemetry, no remote config, no export
 *             off-machine. Everything stays in this browser.
 *
 *   Storage:  localStorage keys prefixed `pkrw:` — observed raids with their score
 *             samples, the deduplicated event log, captured reports, and panel
 *             settings. All local. Clearable from the panel.
 *
 *   Alerts:   none. No notifications, no title flashing, no sound.
 *
 *   Personal data: the event log and the member rosters hold other players' usernames
 *             and their contribution to a fight. It never leaves this browser and must
 *             never be committed. `copy digest` is the shareable output and is scrubbed
 *             of usernames by construction — it carries vocabulary and totals only.
 *
 * See docs/11-faction-raid-surface.md for the surface this reads and what was inferred
 * from the client rather than measured off the wire.
 */

(() => {
  'use strict';

  const TAG = '[pkrw]';
  const VERSION = '0.1.0';
  const log = (...a) => console.debug(TAG, ...a);

  // ===========================================================================
  // Config
  // ===========================================================================
  const CFG = {
    HOTKEY: 'r',              // Alt+R toggles the panel
    PANEL_W: 620,
    PANEL_MIN_H: 160,
    FAB_SIZE: 42,
    EDGE: 8,
    MAX_EVENTS: 4000,         // ring the log rather than growing without bound
    MAX_SAMPLES: 3000,        // per raid
  };

  const K = {
    raids: 'pkrw:raids',
    events: 'pkrw:events',
    reports: 'pkrw:reports',
    ui: 'pkrw:ui',
  };

  // ===========================================================================
  // Storage
  // ===========================================================================
  const readJSON = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('save failed', k, e); }
  };

  /** @type {Record<string, any>} raid id -> observed raid, with score samples */
  let raids = readJSON(K.raids, {});
  /** @type {Record<string, any>} event id -> observed event */
  let events = readJSON(K.events, {});
  /** @type {Record<string, any>} raid id -> captured post-mortem report */
  let reports = readJSON(K.reports, {});
  let ui = readJSON(K.ui, { open: false, tab: 'types', raid: null, fab: null, panel: null });
  if (typeof ui.tab !== 'string') ui.tab = 'types';

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeJSON(K.raids, raids);
      writeJSON(K.events, events);
      writeJSON(K.reports, reports);
      writeJSON(K.ui, ui);
    }, 1_000);
  };
  const saveUi = () => { writeJSON(K.ui, ui); };

  // ===========================================================================
  // Ingest — every record here came off a response the game made on its own.
  //
  // The poll repeats every five seconds and returns the same rows again and again,
  // so both halves are written to be idempotent: raids upsert by id, events dedupe
  // by id, and a score sample is appended only when a score actually MOVED. Storing
  // one sample per poll would bury twelve identical points a minute and turn the
  // curve into a clock rather than a record of the fight.
  // ===========================================================================
  const num = (v) => (Number.isFinite(v) ? v : null);

  const ingestRaid = (r) => {
    if (!r || r.id == null) return;
    const id = String(r.id);
    const cur = raids[id] || { id, samples: [], firstSeen: Date.now() };
    const a = num(r.attacker_score) ?? cur.attacker_score ?? null;
    const d = num(r.defender_score) ?? cur.defender_score ?? null;

    // a sample per score CHANGE, not per poll
    const last = cur.samples[cur.samples.length - 1];
    if (a != null && d != null && (!last || last.a !== a || last.d !== d)) {
      cur.samples.push({ at: Date.now(), a, d, scoredAt: r.last_scored_at ?? null });
      if (cur.samples.length > CFG.MAX_SAMPLES) cur.samples.splice(0, cur.samples.length - CFG.MAX_SAMPLES);
    }

    raids[id] = {
      ...cur,
      id,
      status: r.status ?? cur.status ?? null,
      attacker_faction_id: r.attacker_faction_id ?? cur.attacker_faction_id ?? null,
      attacker_faction_name: r.attacker_faction_name ?? cur.attacker_faction_name ?? null,
      defender_faction_name: r.defender_faction_name ?? cur.defender_faction_name ?? null,
      attacker_score: a,
      defender_score: d,
      attacker_members: num(r.attacker_members) ?? cur.attacker_members ?? null,
      defender_members: num(r.defender_members) ?? cur.defender_members ?? null,
      attacker_power_taken: num(r.attacker_power_taken) ?? cur.attacker_power_taken ?? null,
      defender_power_taken: num(r.defender_power_taken) ?? cur.defender_power_taken ?? null,
      committed_power: num(r.committed_power) ?? cur.committed_power ?? null,
      committed_cash: num(r.committed_cash) ?? cur.committed_cash ?? null,
      cycle_month: r.cycle_month ?? cur.cycle_month ?? null,
      created_at: r.created_at ?? cur.created_at ?? null,
      last_scored_at: r.last_scored_at ?? cur.last_scored_at ?? null,
      lastSeen: Date.now(),
    };
  };

  const ingestEvent = (e) => {
    if (!e || e.id == null) return false;
    const id = String(e.id);
    if (events[id]) return false;                       // the poll re-sends these
    events[id] = {
      id,
      raid_id: e.raid_id != null ? String(e.raid_id) : null,
      event_type: e.event_type ?? null,
      actor_username: e.actor_username ?? null,
      target_username: e.target_username ?? null,
      score_delta: num(e.score_delta) ?? 0,
      power_delta: num(e.power_delta) ?? 0,
      created_at: e.created_at ?? null,
      seenAt: Date.now(),
    };
    return true;
  };

  const trimEvents = () => {
    const ids = Object.keys(events);
    if (ids.length <= CFG.MAX_EVENTS) return;
    // drop the oldest by created_at, falling back to when we saw them
    const ordered = ids.sort((x, y) => tms(events[x]) - tms(events[y]));
    for (const id of ordered.slice(0, ids.length - CFG.MAX_EVENTS)) delete events[id];
  };

  const ingestRaidsPoll = (url, data) => {
    if (!data || (!Array.isArray(data.raids) && !Array.isArray(data.events))) return;
    for (const r of data.raids || []) ingestRaid(r);
    let fresh = 0;
    for (const e of data.events || []) if (ingestEvent(e)) fresh++;
    if (fresh) trimEvents();
    if (fresh) log('raids poll —', (data.raids || []).length, 'raid(s),', fresh, 'new event(s)');
    save(); paint();
  };

  const ingestReport = (url, data) => {
    if (!data) return;
    const m = /\/factions\/[^/]+\/raids\/([^/]+)\/report/.exec(url);
    const id = String(data.id ?? m?.[1] ?? '');
    if (!id) return;
    reports[id] = { ...data, capturedAt: Date.now() };
    // a report restates the raid and carries the server's own score history, which is
    // authoritative where our sampled curve is merely observed
    ingestRaid({ ...data, id: data.id ?? id });
    for (const e of data.events || []) ingestEvent(e);
    trimEvents();
    log('report captured for raid', id);
    save(); paint();
  };

  // ===========================================================================
  // Passive tap — reads responses already in flight. Adds no requests itself.
  // ===========================================================================
  const route = (u) => {
    try { return new URL(u, location.origin).pathname + new URL(u, location.origin).search; }
    catch { return String(u); }
  };

  const RAIDS_RE = /\/api\/factions\/[^/]+\/raids(\?|$)/;
  const REPORT_RE = /\/api\/factions\/[^/]+\/raids\/[^/]+\/report(\?|$)/;

  const dispatch = (url, data) => {
    const p = route(url);
    if (REPORT_RE.test(p)) ingestReport(p, data);
    else if (RAIDS_RE.test(p)) ingestRaidsPoll(p, data);
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
    this.__pkrwUrl = u;
    return origOpen.call(this, m, u, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        const u = this.__pkrwUrl || '';
        if (u.includes('/api/') && (this.getResponseHeader('content-type') || '').includes('json')) {
          dispatch(u, JSON.parse(this.responseText));
        }
      } catch { /* not json */ }
    });
    return origSend.apply(this, a);
  };

  // ===========================================================================
  // Derived
  // ===========================================================================
  const ms = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? t : null; };
  const tms = (e) => ms(e.created_at) ?? e.seenAt ?? 0;

  const fmtDur = (msv) => {
    if (msv == null) return '—';
    const s = Math.floor(msv / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  };
  const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
  const fmtSigned = (n) => (n == null || n === 0 ? '0' : (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString()));

  const eventList = () => Object.values(events).sort((a, b) => tms(b) - tms(a));
  const raidList = () => Object.values(raids).sort((a, b) => (ms(b.created_at) ?? b.firstSeen ?? 0) - (ms(a.created_at) ?? a.firstSeen ?? 0));

  /**
   * The event-type digest — the thing this tool exists to produce.
   *
   * `event_type` is the one part of the raid surface the client never enumerates: it
   * renders `event_type.replaceAll('_',' ')` and has no label map, no colour map and no
   * switch, so the vocabulary cannot be read out of a bundle the way the player status
   * enum could. It can only be learned by watching raids happen. This is that tally.
   */
  const typeDigest = () => {
    const by = new Map();
    for (const e of Object.values(events)) {
      const k = e.event_type || '(none)';
      const g = by.get(k) || { type: k, n: 0, score: 0, power: 0, scored: 0, first: Infinity, last: -Infinity, actors: new Set() };
      g.n++;
      g.score += e.score_delta || 0;
      g.power += e.power_delta || 0;
      if (e.score_delta) g.scored++;
      const t = tms(e);
      if (t < g.first) g.first = t;
      if (t > g.last) g.last = t;
      if (e.actor_username) g.actors.add(e.actor_username);
      by.set(k, g);
    }
    return [...by.values()]
      .map((g) => ({
        ...g,
        actors: g.actors.size,
        avgScore: g.n ? g.score / g.n : 0,
        first: Number.isFinite(g.first) ? g.first : null,
        last: Number.isFinite(g.last) ? g.last : null,
      }))
      .sort((a, b) => b.n - a.n || a.type.localeCompare(b.type));
  };

  /** Who actually did the work, from event attribution rather than from a roster. */
  const actorBoard = () => {
    const by = new Map();
    for (const e of Object.values(events)) {
      if (!e.actor_username) continue;
      const g = by.get(e.actor_username) || { name: e.actor_username, n: 0, score: 0, power: 0, types: new Set() };
      g.n++;
      g.score += e.score_delta || 0;
      g.power += e.power_delta || 0;
      if (e.event_type) g.types.add(e.event_type);
      by.set(e.actor_username, g);
    }
    return [...by.values()]
      .map((g) => ({ ...g, types: g.types.size }))
      .sort((a, b) => b.score - a.score || b.n - a.n);
  };

  /** Which raid the panel is showing; defaults to the newest one seen. */
  const activeRaid = () => {
    const list = raidList();
    if (!list.length) return null;
    return list.find((r) => r.id === ui.raid) || list[0];
  };

  /**
   * The curve. The server's own `score_history` is authoritative and is preferred when
   * a report has been captured; our sampled points are the fallback and are marked as
   * such, because they are only as dense as the poll and only exist for a raid watched
   * live. A short raid can legitimately carry a single point — the client synthesises
   * one from current scores in that case — and one point is not a curve, so say so.
   */
  const curveOf = (raid) => {
    if (!raid) return { points: [], source: 'none' };
    const rep = reports[raid.id];
    const hist = rep?.score_history;
    if (Array.isArray(hist) && hist.length > 1) {
      return {
        source: 'report',
        points: hist.map((h) => ({ t: ms(h.created_at) ?? 0, a: h.attacker_score ?? 0, d: h.defender_score ?? 0 })),
      };
    }
    if (raid.samples && raid.samples.length > 1) {
      return { source: 'sampled', points: raid.samples.map((s) => ({ t: s.at, a: s.a, d: s.d })) };
    }
    const one = raid.samples?.[0] || (raid.attacker_score != null ? { at: raid.firstSeen, a: raid.attacker_score, d: raid.defender_score } : null);
    return one ? { source: 'single', points: [{ t: one.at, a: one.a, d: one.d }] } : { points: [], source: 'none' };
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
  // Panel
  // ===========================================================================
  let host = null, root = null, fab = null, panelEl = null;
  let grip = null, panelDrag = null, fabDrag = null;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .fab {
      position: fixed; right: 12px; bottom: 150px; width: ${CFG.FAB_SIZE}px; height: ${CFG.FAB_SIZE}px;
      z-index: 2147483000; display: grid; place-items: center; cursor: pointer;
      background: #18181b; color: #f4f4f5; border: 1px solid #3f3f46; border-radius: 3px;
      font-size: 11px; letter-spacing: .08em; user-select: none;
    }
    .fab:hover { border-color: #71717a; }
    .panel {
      position: fixed; right: 12px; bottom: 200px; width: ${CFG.PANEL_W}px;
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
    .body { overflow: auto; padding: 8px 10px; }
    .tabs { display: flex; gap: 4px; padding: 6px 10px 0; border-bottom: 1px solid #27272a; }
    .tab {
      padding: 4px 9px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
      background: none; border: 1px solid transparent; border-bottom: none; color: #71717a;
      cursor: pointer; border-radius: 3px 3px 0 0;
    }
    .tab.on { color: #e4e4e7; background: #18181b; border-color: #27272a; }
    button.act {
      background: #18181b; color: #d4d4d8; border: 1px solid #3f3f46; border-radius: 3px;
      padding: 3px 8px; font-size: 10px; cursor: pointer;
    }
    button.act:hover { border-color: #71717a; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #18181b; white-space: nowrap; }
    th { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .dim { color: #71717a; }
    .pos { color: #4ade80; }
    .neg { color: #f87171; }
    .atk { color: #f87171; }
    .def { color: #60a5fa; }
    .note { padding: 6px 10px; border-top: 1px solid #27272a; font-size: 10px; color: #71717a; }
    .empty { padding: 18px 6px; text-align: center; color: #52525b; font-size: 11px; line-height: 1.6; }
    select {
      background: #18181b; color: #d4d4d8; border: 1px solid #3f3f46;
      border-radius: 3px; font-size: 10px; padding: 2px 4px; max-width: 260px;
    }
    .kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 11px; margin-bottom: 8px; }
    .kv .k { color: #71717a; }
    svg { display: block; }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const TABS = [
    ['types', 'event types'],
    ['events', 'log'],
    ['curve', 'curve'],
    ['who', 'who'],
    ['raids', 'raids'],
  ];

  // ---------------------------------------------------------------------------
  // Tab bodies
  // ---------------------------------------------------------------------------
  const table = (cols, rows) => {
    const t = el('table');
    const thead = el('thead');
    const htr = el('tr');
    for (const c of cols) {
      const th = el('th', c.num ? 'num' : null, c.label);
      htr.append(th);
    }
    thead.append(htr); t.append(thead);
    const tb = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      for (const c of cols) {
        const td = el('td', [c.num ? 'num' : '', c.cls?.(r) || ''].filter(Boolean).join(' '));
        td.textContent = c.get(r);
        if (c.title) td.title = c.title(r);
        tr.append(td);
      }
      tb.append(tr);
    }
    t.append(tb);
    return t;
  };

  const renderTypes = (body) => {
    const rows = typeDigest();
    if (!rows.length) {
      body.append(el('div', 'empty',
        'No raid events recorded yet.\nOpen your faction page during a raid, or open a raid report.'));
      return;
    }
    body.append(table([
      { label: 'event type', get: (r) => r.type },
      { label: 'n', num: true, get: (r) => fmtNum(r.n) },
      { label: 'Σ score', num: true, get: (r) => fmtSigned(r.score), cls: (r) => (r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : 'dim') },
      { label: 'Σ power', num: true, get: (r) => fmtSigned(r.power), cls: (r) => (r.power > 0 ? 'pos' : r.power < 0 ? 'neg' : 'dim') },
      { label: 'scoring', num: true, get: (r) => `${r.scored}/${r.n}`,
        title: () => 'how many of these carried a non-zero score delta' },
      { label: 'actors', num: true, get: (r) => fmtNum(r.actors) },
      { label: 'last', num: true, get: (r) => (r.last ? fmtDur(Date.now() - r.last) : '—') },
    ], rows));
  };

  const renderEvents = (body) => {
    const rows = eventList().slice(0, 300);
    if (!rows.length) {
      body.append(el('div', 'empty', 'No events recorded yet.'));
      return;
    }
    body.append(table([
      { label: 'when', get: (r) => (tms(r) ? fmtDur(Date.now() - tms(r)) : '—'), cls: () => 'dim' },
      { label: 'event', get: (r) => String(r.event_type || '—').replaceAll('_', ' ') },
      { label: 'by', get: (r) => r.actor_username || '—' },
      { label: 'against', get: (r) => r.target_username || '—', cls: () => 'dim' },
      { label: 'score', num: true, get: (r) => fmtSigned(r.score_delta), cls: (r) => (r.score_delta > 0 ? 'pos' : r.score_delta < 0 ? 'neg' : 'dim') },
      { label: 'power', num: true, get: (r) => fmtSigned(r.power_delta), cls: (r) => (r.power_delta > 0 ? 'pos' : r.power_delta < 0 ? 'neg' : 'dim') },
    ], rows));
  };

  const renderWho = (body) => {
    const rows = actorBoard();
    if (!rows.length) {
      body.append(el('div', 'empty', 'No attributed events yet.'));
      return;
    }
    body.append(table([
      { label: 'player', get: (r) => r.name },
      { label: 'actions', num: true, get: (r) => fmtNum(r.n) },
      { label: 'Σ score', num: true, get: (r) => fmtSigned(r.score), cls: (r) => (r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : 'dim') },
      { label: 'Σ power', num: true, get: (r) => fmtSigned(r.power) },
      { label: 'kinds', num: true, get: (r) => fmtNum(r.types) },
    ], rows));
  };

  /** Two-line score chart, inline SVG, no library. */
  const sparkline = (points, w, h) => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    const pad = 4;
    const t0 = points[0].t, t1 = points[points.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const top = Math.max(1, ...points.map((p) => Math.max(p.a, p.d)));
    const x = (t) => pad + ((t - t0) / span) * (w - pad * 2);
    const y = (v) => h - pad - (v / top) * (h - pad * 2);
    for (const [key, colour] of [['a', '#f87171'], ['d', '#60a5fa']]) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' '));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', colour);
      path.setAttribute('stroke-width', '1.5');
      svg.append(path);
    }
    return svg;
  };

  const renderCurve = (body, raid) => {
    if (!raid) { body.append(el('div', 'empty', 'No raids recorded yet.')); return; }
    const { points, source } = curveOf(raid);

    const kv = el('div', 'kv');
    const add = (k, v, cls) => { kv.append(el('span', 'k', k)); kv.append(el('span', cls || null, v)); };
    add('attacker', `${raid.attacker_faction_name ?? '—'}  ${fmtNum(raid.attacker_score)}`, 'atk');
    add('defender', `${raid.defender_faction_name ?? '—'}  ${fmtNum(raid.defender_score)}`, 'def');
    add('status', String(raid.status ?? '—'));
    add('power taken', `atk ${fmtNum(raid.attacker_power_taken)} · def ${fmtNum(raid.defender_power_taken)}`);
    add('committed', `${fmtNum(raid.committed_power)} power${raid.committed_cash != null ? ` · $${fmtNum(raid.committed_cash)}` : ''}`);
    add('last hit', raid.last_scored_at ? `${fmtDur(Date.now() - (ms(raid.last_scored_at) ?? 0))} ago` : '—');
    body.append(kv);

    if (points.length > 1) {
      body.append(sparkline(points, CFG.PANEL_W - 40, 90));
      body.append(el('div', 'note', source === 'report'
        ? `${points.length} points from the server's own score_history (authoritative)`
        : `${points.length} points sampled from the faction page's own poll — only as dense as the time you had the page open`));
    } else {
      body.append(el('div', 'empty', points.length
        ? 'Only one score reading — not a curve.\nThe game synthesises a single point when it has no history either.'
        : 'No score readings for this raid yet.'));
    }
  };

  const renderRaids = (body) => {
    const rows = raidList();
    if (!rows.length) {
      body.append(el('div', 'empty',
        'No raids recorded yet.\n\nThis fills itself while your faction page is open —\nthe game polls its own raid list every five seconds.'));
      return;
    }
    body.append(table([
      { label: 'attacker', get: (r) => r.attacker_faction_name || '—', cls: () => 'atk' },
      { label: 'defender', get: (r) => r.defender_faction_name || '—', cls: () => 'def' },
      { label: 'score', num: true, get: (r) => `${fmtNum(r.attacker_score)} – ${fmtNum(r.defender_score)}` },
      { label: 'status', get: (r) => String(r.status ?? '—').replaceAll('_', ' ') },
      { label: 'pts', num: true, get: (r) => fmtNum(r.samples?.length ?? 0),
        title: () => 'score samples this tool observed' },
      { label: 'report', get: (r) => (reports[r.id] ? 'yes' : '—'), cls: (r) => (reports[r.id] ? '' : 'dim') },
      { label: 'started', num: true, get: (r) => (ms(r.created_at) ? `${fmtDur(Date.now() - ms(r.created_at))} ago` : '—') },
    ], rows));
  };

  // ---------------------------------------------------------------------------
  // The shareable digest — vocabulary and totals, no usernames.
  // ---------------------------------------------------------------------------
  const buildDigest = () => {
    const L = [];
    L.push(`raid-watch ${VERSION} — event-type digest`);
    L.push(`raids observed: ${Object.keys(raids).length} · events: ${Object.keys(events).length}`
         + ` · reports: ${Object.keys(reports).length}`);
    L.push('');
    L.push('EVENT TYPES (the vocabulary the client never spells out)');
    const digest = typeDigest();
    if (!digest.length) L.push('  (none observed yet)');
    for (const g of digest) {
      L.push(`  ${g.type}  ×${g.n}  score ${fmtSigned(g.score)}  power ${fmtSigned(g.power)}`
           + `  scoring ${g.scored}/${g.n}  distinct actors ${g.actors}`);
    }
    L.push('');
    L.push('RAIDS');
    for (const r of raidList()) {
      L.push(`  ${r.attacker_faction_name ?? '?'} vs ${r.defender_faction_name ?? '?'}`
           + ` — ${fmtNum(r.attacker_score)}–${fmtNum(r.defender_score)}`
           + ` · status ${r.status ?? '?'}`
           + ` · members ${fmtNum(r.attacker_members)}/${fmtNum(r.defender_members)}`
           + ` · power taken ${fmtNum(r.attacker_power_taken)}/${fmtNum(r.defender_power_taken)}`
           + ` · committed ${fmtNum(r.committed_power)}`
           + ` · cycle ${r.cycle_month ?? '?'}`
           + ` · ${r.samples?.length ?? 0} sampled point(s)`
           + `${reports[r.id] ? ` · report: ${reports[r.id].score_history?.length ?? 0} history point(s)` : ''}`);
    }
    L.push('');
    L.push('Passive capture. No usernames included. Deltas are sums over observed events.');
    return L.join('\n');
  };

  const copyText = (s, btn) => {
    const done = () => { const o = btn.textContent; btn.textContent = 'copied'; setTimeout(() => { btn.textContent = o; }, 1200); };
    navigator.clipboard?.writeText(s).then(done, () => {
      const ta = el('textarea'); ta.value = s; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); done(); } finally { ta.remove(); }
    });
  };

  const download = (name, text) => {
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
  };

  // ---------------------------------------------------------------------------
  // Mount / paint
  // ---------------------------------------------------------------------------
  const mount = () => {
    if (host) return;
    host = el('div');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483000';
    document.documentElement.append(host);
    root = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS; root.append(style);

    fab = el('div', 'fab', 'RAID');
    fab.title = 'Raid Watch (Alt+R) — drag to move, double-click to reset';
    root.append(fab);

    fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUi(); });
    fabDrag.apply(ui.fab);
    fab.addEventListener('click', () => { if (!fabDrag.dragged()) toggle(); });
    fab.addEventListener('dblclick', () => { ui.fab = null; saveUi(); fabDrag.reset(); });

    panelEl = el('div', 'panel');
    panelEl.style.display = 'none';
    root.append(panelEl);
  };

  const toggle = (force) => {
    ui.open = force == null ? !ui.open : !!force;
    saveUi();
    paint();
  };

  function paint() {
    if (!root || !panelEl) return;
    panelEl.style.display = ui.open ? 'flex' : 'none';
    if (!ui.open) return;
    panelEl.replaceChildren();

    // header
    const hd = el('div', 'hd');
    hd.append(el('b', null, 'Raid Watch'));
    const cov = el('span', 'cov',
      `${Object.keys(raids).length} raid(s) · ${Object.keys(events).length} event(s) · ${typeDigest().length} type(s)`);
    hd.append(cov);
    hd.append(el('span', 'sp'));
    const close = el('button', 'act', '×');
    close.addEventListener('click', () => toggle(false));
    hd.append(close);
    panelEl.append(hd);
    grip = hd;

    // tabs
    const tabs = el('div', 'tabs');
    for (const [key, label] of TABS) {
      const b = el('button', `tab${ui.tab === key ? ' on' : ''}`, label);
      b.addEventListener('click', () => { ui.tab = key; saveUi(); paint(); });
      tabs.append(b);
    }
    panelEl.append(tabs);

    // raid selector, where a tab is about one raid
    const body = el('div', 'body');
    const raid = activeRaid();
    if ((ui.tab === 'curve') && raidList().length > 1) {
      const sel = el('select');
      for (const r of raidList()) {
        const o = new Option(`${r.attacker_faction_name ?? '?'} vs ${r.defender_faction_name ?? '?'}`, r.id);
        sel.append(o);
      }
      sel.value = raid?.id ?? '';
      sel.addEventListener('change', () => { ui.raid = sel.value; saveUi(); paint(); });
      const wrap = el('div'); wrap.style.marginBottom = '8px'; wrap.append(sel);
      body.append(wrap);
    }

    if (ui.tab === 'types') renderTypes(body);
    else if (ui.tab === 'events') renderEvents(body);
    else if (ui.tab === 'curve') renderCurve(body, raid);
    else if (ui.tab === 'who') renderWho(body);
    else renderRaids(body);
    panelEl.append(body);

    // actions
    const note = el('div', 'note');
    const bar = el('span');
    const mk = (label, fn) => { const b = el('button', 'act', label); b.style.marginRight = '4px'; b.addEventListener('click', () => fn(b)); bar.append(b); return b; };
    mk('copy digest', (b) => copyText(buildDigest(), b));
    mk('export', () => download(`raid-watch-${VERSION}.json`, JSON.stringify({ raids, events, reports }, null, 2)));
    mk('clear', () => {
      raids = {}; events = {}; reports = {};
      writeJSON(K.raids, raids); writeJSON(K.events, events); writeJSON(K.reports, reports);
      paint();
    });
    note.append(bar);
    note.append(el('div', null,
      'passive · fills itself while your faction page is open — the game polls its own raid list every 5s · no raid action is ever sent'));
    panelEl.append(note);

    // placement, then never leave the handle off-screen
    if (!panelDrag) {
      panelDrag = draggable(panelEl, grip, (pos) => { ui.panel = pos; saveUi(); });
      grip.addEventListener('dblclick', () => { ui.panel = null; saveUi(); panelDrag.reset(); });
    }
    panelDrag.apply(ui.panel);
    panelDrag.fit();
  }

  // ===========================================================================
  // Boot
  // ===========================================================================
  const typing = (t) => /^(input|textarea|select)$/i.test(t?.tagName || '') || t?.isContentEditable;

  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (typing(e.target)) return;
    if (e.key.toLowerCase() === CFG.HOTKEY) { e.preventDefault(); toggle(); }
  });

  const boot = () => {
    mount();
    paint();
    log(`ready ${VERSION} — passive; the faction page's own 5s poll feeds this`);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Console surface, mirroring the other tools in this repo.
  window.__pkrw = {
    raids: () => raids,
    events: () => eventList(),
    types: () => typeDigest(),
    who: () => actorBoard(),
    reports: () => reports,
    digest: () => buildDigest(),
    export: () => ({ raids, events, reports }),
    clear: () => { raids = {}; events = {}; reports = {}; writeJSON(K.raids, {}); writeJSON(K.events, {}); writeJSON(K.reports, {}); paint(); },
  };
})();
