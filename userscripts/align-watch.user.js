// ==UserScript==
// @name         Politiko — Align Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.2.0
// @description  Mirrors your character's political-compass chart from the profile screen onto the home page: last measured social/economic axes, every change since you installed it, and the projected effect of alignment actions you have taken since that reading. Passive — zero added requests.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/align-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/align-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON responses the game client itself requested, on pages you are
 *             actively viewing:
 *               GET /api/user/status   — the app polls this every 10 s anyway;
 *                                        used only to learn your own username
 *               GET /api/users/<name>  — fires when YOU open a profile page;
 *                                        this is the only response that carries
 *                                        `alignment`, which is why the panel
 *                                        mirrors a reading instead of polling
 *               GET /api/protests…     — fires on the protests page you are on;
 *                                        used to name the issue a protest is about
 *             …plus the request bodies of alignment-affecting actions YOU submit
 *             (POST /api/disobedience, /api/protests, /api/protests/<id>/join,
 *             /api/actions/graffiti) so the panel can tell you what is pending.
 *
 *             Only YOUR OWN character's alignment is ever stored. Other players'
 *             profiles you open are ignored and never written to disk.
 *             The `auth` localStorage key (your tokens) is never read.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. The panel's "open profile"
 *             button performs the same client-side route change as clicking your
 *             own name in the game's nav — the app then fetches as it normally
 *             would, and only at the moment you click. Nothing is timed,
 *             scheduled, retried, or fired while you are elsewhere.
 *
 *   Storage:  localStorage keys prefixed `pkaw:` — your own alignment readings,
 *             the actions you took between readings, and panel position/state
 *
 *   Alerts:   none. No notifications, no sound, nothing raised from an unfocused
 *             tab; the panel only redraws while the tab is visible
 *
 *   Clipboard: written ONLY when you click "copy" (tab-separated reading history)
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 * What the numbers mean, and which parts are measured vs inferred:
 * docs/07-alignment-surface.md.
 *
 * The honest limitation, stated up front: alignment is served by exactly one
 * endpoint, and the home page does not call it. So this panel shows your last
 * reading, how old it is, and what you have done since — not a live figure. Making
 * it live would mean originating a request, which this script does not do.
 */

(() => {
  'use strict';

  const TAG = '[pk-align-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { data: 'pkaw:data', ui: 'pkaw:ui' };

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // ---------------------------------------------------------------------------
  // Game constants, lifted from the client bundle (2026-08-03 pull).
  // All presentation math the app already does — none of it is a request.
  // See docs/07-alignment-surface.md for the evidence behind each line.
  // ---------------------------------------------------------------------------

  // ProfilePage's compass: viewBox 0 0 220 220, plot box 16..204, axes clamped ±3.
  //   x = 16 + (economic + 3) / 6 * 188      (−3 = L, +3 = R)
  //   y = 16 + (3 − social)  / 6 * 188      (+3 = AUTHORITY at top, −3 = LIBERTY)
  const BOX = 16, PLOT = 188, MID = BOX + PLOT / 2;
  const clamp3 = (v) => Math.max(-3, Math.min(3, Number.isFinite(+v) ? +v : 0));
  const px = (economic) => BOX + (clamp3(economic) + 3) / 6 * PLOT;
  const py = (social) => BOX + (3 - clamp3(social)) / 6 * PLOT;

  // The wiki's −3..+3 name scale. It is written for policy axes and NPCs, whose
  // single alignment score runs left→right; the player compass splits the same
  // numeric range across two axes and names the vertical one authority/liberty.
  // Shown as a legend, not stamped onto the social axis.
  const SCALE = ['Communist', 'Progressive', 'Liberal', 'Moderate', 'Conservative', 'Republican', 'Far-Right'];
  const scaleWord = (v) => SCALE[Math.round(clamp3(v)) + 3];

  // ActivismPage's issue table — which axis each of the 20 issues belongs to.
  const ISSUE = {
    'free-speech': ['Free Speech', 'social'], 'police-behavior': ['Police', 'social'],
    'civil-rights': ['Civil Rights', 'social'], 'immigration': ['Immigration', 'social'],
    'drugs': ['Drugs', 'social'], 'abortion': ['Abortion', 'social'],
    'animal-research': ['Animal Research', 'social'], 'healthcare': ['Healthcare', 'social'],
    'lgbt-rights': ['LGBT Rights', 'social'], 'gun-control': ['Gun Control', 'social'],
    'torture': ['Torture', 'social'], 'intelligence': ['Intelligence', 'social'],
    'womens-rights': ["Women's Rights", 'social'], 'corporations': ['Corporations', 'economic'],
    'elections': ['Elections', 'economic'], 'sweatshops': ['Sweatshops', 'economic'],
    'military': ['Military', 'economic'], 'nuclear-power': ['Nuclear Power', 'economic'],
    'pollution': ['Pollution', 'economic'], 'taxes': ['Taxes', 'economic'],
  };

  // Actions that the wiki says move personal alignment, and the payload field
  // carrying their direction. Graffiti is listed because it takes a side, but the
  // wiki names only protests and civil disobedience — so it is logged and shown,
  // and deliberately left out of the projection.
  const ACTIONS = [
    { re: /^\/api\/disobedience$/, kind: 'civil disobedience', dir: 'leaning', issue: 'issue_id', counts: true },
    { re: /^\/api\/protests$/, kind: 'protest organised', dir: 'stance', issue: 'issue_id', counts: true },
    { re: /^\/api\/protests\/([^/]+)\/join$/, kind: 'protest joined', dir: 'side', protestId: 1, counts: true },
    { re: /^\/api\/actions\/graffiti$/, kind: 'graffiti', dir: 'side', counts: false },
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const data = Object.assign(
    { self: null, readings: [], pending: [], seenAt: 0, protests: {} },
    readJSON(K.data, {}),
  );
  const ui = Object.assign({ open: true, x: null, y: null, everywhere: false }, readJSON(K.ui, {}));

  const save = () => writeJSON(K.data, data);
  const saveUI = () => writeJSON(K.ui, ui);

  /** newest alignment reading: {t, s, sc, e, ec, url} */
  const newest = () => data.readings[data.readings.length - 1] ?? null;
  const previous = () => data.readings[data.readings.length - 2] ?? null;

  const setSelf = (name) => {
    if (!name || data.self === name) return;
    if (data.self && data.self !== name) {
      // different character (shouldn't happen — one account, no alts) — start clean
      log('self changed', data.self, '->', name, '· clearing history');
      data.readings = []; data.pending = []; data.protests = {};
    }
    data.self = name;
    save();
    if (buffered) { addReading(buffered); buffered = null; }
    scheduleRender();
  };

  let buffered = null; // an alignment payload that arrived before we knew who we are

  const addReading = (r) => {
    data.seenAt = r.t;
    const n = newest();
    // The counts are part of the identity: if an action had been tallied, the
    // count would have moved even where the average rounded to the same value.
    // So an identical tuple means nothing new landed — keep the pending list.
    if (n && n.s === r.s && n.sc === r.sc && n.e === r.e && n.ec === r.ec) { save(); scheduleRender(); return; }
    data.readings.push(r);
    if (data.readings.length > 300) data.readings.splice(0, data.readings.length - 300);
    data.pending = []; // whatever was pending is now baked into the number
    save();
    log('reading', r);
    scheduleRender();
  };

  const addPending = (a) => {
    data.pending.push(a);
    if (data.pending.length > 50) data.pending.shift();
    save();
    log('pending action', a);
    scheduleRender();
  };

  // ---------------------------------------------------------------------------
  // Projection — INFERRED, not measured.
  //
  // The wiki says a player's alignment is "a running average of social and
  // economic positions", tracked per axis, and the profile prints each axis's
  // sample size as "N actions". If that is a plain mean, one more action at
  // stance s moves an axis from a to (a·n + s)/(n + 1) — so the same action
  // matters less the longer you have played.
  //
  // Protest/graffiti payloads carry only left|right, not a magnitude, so a
  // direction-only action is projected as a range: |s| = 1 at one end, |s| = 3 at
  // the other. The update is monotone in s, so those extremes bound the result.
  // ---------------------------------------------------------------------------
  const projectable = () => data.pending.filter((a) => a.axis && a.sign && a.counts);

  const project = (bound) => {
    const n0 = newest();
    if (!n0) return null;
    let s = n0.s, sc = n0.sc, e = n0.e, ec = n0.ec;
    for (const a of projectable()) {
      const mag = Number.isFinite(a.mag) ? a.mag
        : (bound === 'lo' ? (a.sign < 0 ? 3 : 1) : (a.sign < 0 ? 1 : 3));
      const v = a.sign * mag;
      if (a.axis === 'social') { s = (s * sc + v) / (sc + 1); sc += 1; }
      else { e = (e * ec + v) / (ec + 1); ec += 1; }
    }
    return { s, e, sc, ec };
  };

  /** how far one more action at stance s would move an axis holding n samples */
  const step = (a, n, s) => (s - a) / (n + 1);

  // ---------------------------------------------------------------------------
  // Passive tap — only responses the app fetched on its own, and the bodies of
  // requests you yourself submitted. Adds nothing to the wire.
  // ---------------------------------------------------------------------------
  const pathOf = (u) => { try { return new URL(u, location.href).pathname; } catch { return ''; } };

  const dirOf = (v) => {
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) return { sign: Math.sign(v), mag: Math.abs(v) };
    if (typeof v === 'string') {
      const n = Number(v);
      if (v.trim() !== '' && Number.isFinite(n) && n !== 0) return { sign: Math.sign(n), mag: Math.abs(n) };
      if (v === 'left') return { sign: -1, mag: null };
      if (v === 'right') return { sign: 1, mag: null };
    }
    return { sign: 0, mag: null };
  };

  /** pull {alignment} out of any response that happens to carry it, for us only */
  const harvest = (path, body) => {
    const a = body?.alignment;
    if (!a || !Number.isFinite(+a.social_axis)) return;
    const who = typeof body.username === 'string' ? body.username
      : (/^\/api\/users\/([^/]+)$/.exec(path)?.[1] ?? null);
    const r = {
      t: Date.now(),
      s: +a.social_axis, sc: +a.social_count || 0,
      e: +a.economic_axis, ec: +a.economic_count || 0,
      url: path,
    };
    if (!data.self) { if (who) { buffered = r; buffered.who = who; } return; }
    if (who && who !== data.self) return; // someone else's profile — not our business
    addReading(r);
  };

  /**
   * Protest id -> issue, so a join can be told which axis it moved.
   *
   * This walks whatever shape the payload happens to be rather than assuming a bare
   * array of rows, because the first version assumed one and missed: joining a protest
   * without the list endpoint having been in flight left the entry permanently
   * unattributable. Anything with an id and an issue we recognise counts, wherever it
   * is nested — a list, a single protest, or a join response that echoes it back.
   */
  const harvestProtests = (node, depth = 0) => {
    if (!node || depth > 6) return false;
    if (Array.isArray(node)) return node.map((n) => harvestProtests(n, depth + 1)).some(Boolean);
    if (typeof node !== 'object') return false;

    let touched = false;
    const id = node.id ?? node.protest_id;
    const issue = [node.issue_id, node.issue, node.issue_key, node.topic]
      .find((v) => typeof v === 'string' && ISSUE[v]);
    if (id != null && issue) {
      const key = String(id);
      if (data.protests[key]?.issue !== issue) {
        data.protests[key] = { issue, stance: Number(node.stance) };
        touched = true;
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') touched = harvestProtests(v, depth + 1) || touched;
    return touched;
  };

  /**
   * A protest's issue can arrive *after* you joined it — you open the protest page,
   * or the list refreshes. Fill in what couldn't be named at the time rather than
   * leaving the entry stranded outside the projection forever.
   */
  const backfill = () => {
    let changed = false;
    for (const a of data.pending) {
      if (a.axis || !a.protestId) continue;
      const meta = ISSUE[data.protests[a.protestId]?.issue];
      if (!meta) continue;
      a.issue = meta[0]; a.axis = meta[1]; changed = true;
    }
    return changed;
  };

  const remember = (path, body) => {
    const touched = harvestProtests(body);
    const filled = backfill();
    if (!touched && !filled) return;
    const keys = Object.keys(data.protests);
    if (keys.length > 100) keys.slice(0, keys.length - 100).forEach((k) => delete data.protests[k]);
    save();
    scheduleRender();
  };

  const noteAction = (path, rawBody) => {
    for (const spec of ACTIONS) {
      const m = spec.re.exec(path);
      if (!m) continue;
      let payload = {};
      try { payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : (rawBody ?? {}); } catch { /* not JSON */ }

      let issueId = spec.issue ? payload[spec.issue] : null;
      const stance = payload[spec.dir];
      // the protest id is kept even when its issue is unknown right now, so the entry
      // can be filled in later by backfill() instead of being stranded
      const protestId = spec.protestId != null ? String(m[spec.protestId]) : null;
      if (protestId && data.protests[protestId]) {
        // joining the "left" side of a protest is a left-leaning act regardless of
        // which side the organiser took, so `side` stays the direction
        issueId = data.protests[protestId].issue;
      }
      const meta = ISSUE[issueId] ?? null;
      const d = dirOf(stance);
      addPending({
        t: Date.now(), kind: spec.kind, counts: spec.counts, protestId,
        issue: meta ? meta[0] : (issueId ?? null),
        axis: meta ? meta[1] : null,
        sign: d.sign, mag: d.mag,
      });
      return;
    }
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const target = args[0];
    const url = typeof target === 'string' ? target : (target?.url ?? '');
    const init = args[1] ?? {};
    const method = String(init.method ?? target?.method ?? 'GET').toUpperCase();
    // only ever a string body, and only for the four action paths below;
    // Request objects are never drained — that would break the app's own send
    const body = typeof init.body === 'string' ? init.body : null;

    const res = await origFetch.apply(this, args);
    try {
      const path = pathOf(url);
      if (!path.startsWith('/api/')) return res;

      if (method === 'POST' && res.ok) noteAction(path, body);

      if (res.headers.get('content-type')?.includes('json')) {
        res.clone().json().then((parsed) => {
          if (path === '/api/user/status' && typeof parsed?.username === 'string') setSelf(parsed.username);
          if (path.startsWith('/api/protests')) remember(path, parsed);
          harvest(path, parsed);
        }, () => {});
      }
    } catch (e) { log('tap error', e); }
    return res;
  };

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------
  let root = null, panel = null, head = null, body = null, fab = null;
  let title = null, pinBtn = null, drag = null, fabDrag = null;

  const CSS = `
    .pkaw-fab { position: fixed; left: 12px; bottom: 64px; z-index: 2147482000;
      width: 34px; height: 34px; border-radius: 17px; border: 1px solid #3f3f46;
      background: #18181b; color: #e4e4e7; font-size: 15px; line-height: 32px;
      text-align: center; cursor: pointer; user-select: none; opacity: .85; padding: 0; }
    .pkaw-fab:hover { opacity: 1; }
    .pkaw-panel { position: fixed; left: 12px; bottom: 104px; z-index: 2147482000;
      width: min(320px, calc(100vw - 24px)); max-height: min(78vh, 760px);
      display: flex; flex-direction: column;
      border: 1px solid #3f3f46; border-radius: 8px; background: #09090bf2; color: #e4e4e7;
      font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .pkaw-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
      border-bottom: 1px solid #27272a; user-select: none; }
    .pkaw-head h1 { flex: 1; font-size: 11px; margin: 0; color: #a1a1aa;
      text-transform: uppercase; letter-spacing: .08em; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .pkaw-btn { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
      border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 7px; cursor: pointer; }
    .pkaw-btn:hover { background: #3f3f46; }
    .pkaw-btn[data-on="1"] { border-color: #fbbf24; color: #fbbf24; }
    .pkaw-body { overflow: auto; padding: 10px; }
    .pkaw-row { display: flex; justify-content: space-between; gap: 8px; }
    .pkaw-dim { color: #a1a1aa; }
    .pkaw-faint { color: #71717a; }
    .pkaw-up { color: #34d399; }
    .pkaw-down { color: #f87171; }
    .pkaw-ax { margin-top: 8px; }
    .pkaw-ax .v { font-size: 15px; font-weight: 600; }
    .pkaw-ax .pkaw-row { align-items: baseline; }
    .pkaw-h2 { margin: 12px 0 4px; color: #a1a1aa; font-size: 10px;
      text-transform: uppercase; letter-spacing: .1em;
      border-top: 1px solid #27272a; padding-top: 8px; }
    .pkaw-list { margin: 0; padding: 0; list-style: none; }
    .pkaw-list li { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
    .pkaw-note { margin: 10px 0 0; color: #71717a; font-size: 10.5px; line-height: 1.4; }
    .pkaw-svg { width: 100%; height: auto; display: block; }
  `;

  const sign1 = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)); // ProfilePage's own format
  const sign2 = (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));

  const ago = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m ago`;
    return `${Math.floor(h / 24)}d ${h % 24}h ago`;
  };

  const clockOf = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  /** the game's own compass, redrawn from its own constants, plus our trail/projection */
  const compass = (r, proj) => {
    const n = (v) => Number(v).toFixed(2);
    const grid = [-2, -1, 1, 2].map((g) => {
      const x = n(BOX + (g + 3) / 6 * PLOT), y = n(BOX + (3 - g) / 6 * PLOT);
      return `<line x1="${x}" y1="16" x2="${x}" y2="204" stroke="rgba(255,255,255,.05)" stroke-width=".5"/>`
        + `<line x1="16" y1="${y}" x2="204" y2="${y}" stroke="rgba(255,255,255,.05)" stroke-width=".5"/>`;
    }).join('');

    // where we have been: oldest → newest, faint
    const trail = data.readings.slice(-14);
    const pts = trail.map((p) => `${n(px(p.e))},${n(py(p.s))}`).join(' ');
    const trailEl = trail.length > 1
      ? `<polyline points="${pts}" fill="none" stroke="rgba(251,191,36,.35)" stroke-width=".9"/>`
        + trail.slice(0, -1).map((p) => `<circle cx="${n(px(p.e))}" cy="${n(py(p.s))}" r="1.4" fill="rgba(251,191,36,.45)"/>`).join('')
      : '';

    const x = n(px(r.e)), y = n(py(r.s));

    // projection: a segment between the |s|=1 and |s|=3 bounds, dashed = inferred
    let projEl = '';
    if (proj) {
      const x1 = n(px(proj.lo.e)), y1 = n(py(proj.lo.s));
      const x2 = n(px(proj.hi.e)), y2 = n(py(proj.hi.s));
      const same = x1 === x2 && y1 === y2;
      projEl = (same ? '' : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(52,211,153,.75)" stroke-width="1.4" stroke-linecap="round"/>`)
        + `<line x1="${x}" y1="${y}" x2="${n((+x1 + +x2) / 2)}" y2="${n((+y1 + +y2) / 2)}" stroke="rgba(52,211,153,.35)" stroke-width=".7" stroke-dasharray="2 2"/>`
        + `<circle cx="${x1}" cy="${y1}" r="2.4" fill="none" stroke="rgba(52,211,153,.85)" stroke-width=".9"/>`
        + (same ? '' : `<circle cx="${x2}" cy="${y2}" r="2.4" fill="none" stroke="rgba(52,211,153,.85)" stroke-width=".9"/>`);
    }

    return `<svg viewBox="0 0 220 220" class="pkaw-svg" aria-label="Political compass">
      <rect x="16" y="16" width="94" height="94" fill="rgba(220,38,38,.13)"/>
      <rect x="110" y="16" width="94" height="94" fill="rgba(37,99,235,.13)"/>
      <rect x="16" y="110" width="94" height="94" fill="rgba(22,163,74,.10)"/>
      <rect x="110" y="110" width="94" height="94" fill="rgba(202,138,4,.09)"/>
      ${grid}
      <line x1="${MID}" y1="16" x2="${MID}" y2="204" stroke="rgba(255,255,255,.14)" stroke-width=".8"/>
      <line x1="16" y1="${MID}" x2="204" y2="${MID}" stroke="rgba(255,255,255,.14)" stroke-width=".8"/>
      <rect x="16" y="16" width="188" height="188" fill="none" stroke="rgba(255,255,255,.10)" stroke-width=".8"/>
      <text x="110" y="9" text-anchor="middle" fill="rgba(220,38,38,.65)" font-size="7" font-family="ui-monospace, monospace" letter-spacing=".12em">AUTHORITY</text>
      <text x="110" y="219" text-anchor="middle" fill="rgba(22,163,74,.65)" font-size="7" font-family="ui-monospace, monospace" letter-spacing=".12em">LIBERTY</text>
      <text x="11" y="112" text-anchor="end" fill="rgba(255,255,255,.28)" font-size="7" font-family="ui-monospace, monospace">L</text>
      <text x="209" y="112" text-anchor="start" fill="rgba(255,255,255,.28)" font-size="7" font-family="ui-monospace, monospace">R</text>
      <text x="19" y="24" fill="rgba(220,38,38,.55)" font-size="5" font-family="ui-monospace, monospace" letter-spacing=".08em">AUTH·LEFT</text>
      <text x="201" y="24" text-anchor="end" fill="rgba(96,130,235,.55)" font-size="5" font-family="ui-monospace, monospace" letter-spacing=".08em">AUTH·RIGHT</text>
      <text x="19" y="201" fill="rgba(22,163,74,.55)" font-size="5" font-family="ui-monospace, monospace" letter-spacing=".08em">LIB·LEFT</text>
      <text x="201" y="201" text-anchor="end" fill="rgba(202,138,4,.55)" font-size="5" font-family="ui-monospace, monospace" letter-spacing=".08em">LIB·RIGHT</text>
      ${trailEl}
      ${projEl}
      <line x1="${n(+x - 6)}" y1="${y}" x2="${n(+x + 6)}" y2="${y}" stroke="rgba(255,255,255,.55)" stroke-width=".9"/>
      <line x1="${x}" y1="${n(+y - 6)}" x2="${x}" y2="${n(+y + 6)}" stroke="rgba(255,255,255,.55)" stroke-width=".9"/>
      <circle cx="${x}" cy="${y}" r="8" fill="none" stroke="rgba(255,255,255,.20)" stroke-width=".8"/>
      <circle cx="${x}" cy="${y}" r="3" fill="white" opacity=".92"/>
    </svg>`;
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const render = () => {
    if (!body || document.hidden || !ui.open) return;
    body.textContent = '';

    const r = newest();
    if (!r) {
      body.append(el('p', 'pkaw-dim',
        data.self
          ? `No reading yet. Open your own profile once (@${data.self}) — that is the only page the game fetches alignment for, and this panel mirrors it from there.`
          : 'Waiting for the app to identify your session (it polls /api/user/status every 10s)…'));
      if (data.self) body.append(profileBtn());
      return;
    }

    // chart
    const pend = projectable();
    const proj = pend.length ? { lo: project('lo'), hi: project('hi') } : null;
    const chart = document.createElement('div');
    chart.innerHTML = compass(r, proj);
    body.append(chart);

    // axes
    const prev = previous();
    for (const [label, val, count, prevVal, ends] of [
      ['social', r.s, r.sc, prev?.s, ['liberty', 'authority']],
      ['economic', r.e, r.ec, prev?.e, ['left', 'right']],
    ]) {
      const block = el('div', 'pkaw-ax');

      const top = el('div', 'pkaw-row');
      top.append(el('span', 'pkaw-dim', label));
      const val$ = document.createElement('span');
      val$.append(el('span', 'v', sign1(val)));
      val$.append(el('span', 'pkaw-faint', ` ${val === 0 ? 'centre' : ends[val > 0 ? 1 : 0]}`));
      if (prevVal != null && val !== prevVal) {
        const d = val - prevVal;
        const delta = el('span', d > 0 ? 'pkaw-up' : 'pkaw-down', ` ${sign2(d)}`);
        delta.title = `moved ${sign2(d)} since the reading before this one (${clockOf(prev.t)})`;
        val$.append(delta);
      }
      top.append(val$);
      block.append(top);

      block.append(el('div', 'pkaw-faint',
        `${count} action${count === 1 ? '' : 's'} averaged · ±3 act → `
        + `${ends[0]} ${sign2(step(val, count, -3))} · ${ends[1]} ${sign2(step(val, count, 3))}†`));
      body.append(block);
    }

    const freshness = el('div', 'pkaw-row');
    freshness.append(el('span', 'pkaw-faint', `read ${ago(r.t)}`));
    freshness.append(el('span', 'pkaw-faint', `checked ${ago(data.seenAt || r.t)}`));
    body.append(freshness);

    // pending actions since that reading
    if (data.pending.length) {
      body.append(el('h2', 'pkaw-h2', `since that reading · ${data.pending.length}`));
      const list = el('ul', 'pkaw-list');
      for (const a of data.pending.slice(-8)) {
        const li = document.createElement('li');
        const dir = a.sign === 0 ? '?' : (a.sign < 0 ? 'left' : 'right');
        const what = `${a.kind}${a.issue ? ` · ${a.issue}` : ''}`;
        li.append(el('span', a.counts && a.axis ? '' : 'pkaw-faint', what));

        const right = document.createElement('span');
        if (a.counts && !a.axis) {
          // The game never told us which issue this was about, but you know — you
          // were there. One click beats leaving it out of the projection.
          right.append(el('span', 'pkaw-faint', `${dir} · which axis? `));
          for (const axis of ['social', 'economic']) {
            const b = el('button', 'pkaw-btn', axis);
            b.style.marginLeft = '4px';
            b.title = `count this as a ${axis} action at stance ${dir}`;
            b.addEventListener('click', () => { a.axis = axis; save(); render(); });
            right.append(b);
          }
        } else {
          right.className = 'pkaw-faint';
          right.textContent = `${a.axis ?? 'axis?'} · ${dir} · ${clockOf(a.t)}`;
        }
        li.append(right);
        list.append(li);
      }
      body.append(list);

      if (proj) {
        const lo = proj.lo, hi = proj.hi;
        const band = (a, b) => (Math.abs(a - b) < 0.005 ? sign2(a) : `${sign2(Math.min(a, b))}…${sign2(Math.max(a, b))}`);
        const p = el('div', '');
        p.innerHTML = `<div class="pkaw-row"><span class="pkaw-dim">projected social†</span><span>${band(lo.s, hi.s)}</span></div>`
          + `<div class="pkaw-row"><span class="pkaw-dim">projected economic†</span><span>${band(lo.e, hi.e)}</span></div>`;
        body.append(p);
      }
      // say only what actually applies — a blanket sentence naming graffiti when
      // nothing here is graffiti reads like the tool has lost track of its own state
      const unnamed = data.pending.filter((a) => a.counts && !a.axis).length;
      const uncounted = data.pending.filter((a) => !a.counts).length;
      const why = [];
      if (unnamed) {
        why.push(`${unnamed} left out until you say which axis: the game only names a protest's `
          + `issue in the list response, and it never arrived for this one. Pick it above, or open `
          + `the protest and it fills itself in.`);
      }
      if (uncounted) {
        why.push(`${uncounted} left out on purpose: graffiti takes a side but the wiki names only `
          + `protests and civil disobedience as alignment sources, so counting it would be a guess.`);
      }
      for (const line of why) body.append(el('p', 'pkaw-note', line));
    }

    // history
    if (data.readings.length > 1) {
      body.append(el('h2', 'pkaw-h2', 'changes'));
      const list = el('ul', 'pkaw-list');
      for (let i = data.readings.length - 1; i > 0 && i > data.readings.length - 9; i--) {
        const now = data.readings[i], was = data.readings[i - 1];
        const bits = [];
        if (now.s !== was.s) bits.push(`social ${sign1(was.s)}→${sign1(now.s)}`);
        if (now.e !== was.e) bits.push(`econ ${sign1(was.e)}→${sign1(now.e)}`);
        if (!bits.length) bits.push(`+${(now.sc - was.sc) + (now.ec - was.ec)} actions, axes unmoved`);
        const li = document.createElement('li');
        li.append(el('span', '', bits.join(' · ')));
        li.append(el('span', 'pkaw-faint', clockOf(now.t)));
        list.append(li);
      }
      body.append(list);
    }

    // actions row
    const tools = el('div', 'pkaw-row');
    tools.style.marginTop = '10px';
    tools.append(profileBtn());
    const copy = el('button', 'pkaw-btn', 'copy history');
    copy.addEventListener('click', () => {
      const tsv = ['iso\tsocial\tsocial_actions\teconomic\teconomic_actions']
        .concat(data.readings.map((x) => [new Date(x.t).toISOString(), x.s, x.sc, x.e, x.ec].join('\t')))
        .join('\n');
      navigator.clipboard?.writeText(tsv).then(
        () => { copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy history'; }, 1500); },
        () => { copy.textContent = 'failed'; },
      );
    });
    tools.append(copy);
    body.append(tools);

    body.append(el('p', 'pkaw-note',
      `Scale −3 ${SCALE[0].toLowerCase()} · 0 ${SCALE[3].toLowerCase()} · +3 ${SCALE[6].toLowerCase()} `
      + `(the wiki's naming, written for policy axes and NPCs; the compass names its vertical axis authority/liberty). `
      + `Nearest word for your economic axis: ${scaleWord(r.e)}.`));
    body.append(el('p', 'pkaw-note',
      `† inferred, not measured: the wiki calls player alignment a running average, so this treats one more action at stance s as (a·n + s)/(n+1). `
      + `Direction-only actions are shown as a range for |s| = 1…3. Alignment itself is only served on /api/users/<name>, so it refreshes when you open your profile — never on a timer.`));
  };

  const profileBtn = () => {
    const b = el('button', 'pkaw-btn', 'open profile ↻');
    b.title = 'Same client-side navigation as clicking your own name in the game nav. '
      + 'The app fetches your profile as it normally would, and only because you clicked.';
    b.addEventListener('click', () => {
      if (!data.self) return;
      history.pushState({}, '', `/profile/${encodeURIComponent(data.self)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    return b;
  };

  let renderTimer = null;
  const scheduleRender = () => {
    if (renderTimer) return;
    // sync(), not render() — the header carries the username, which can arrive
    // from /api/user/status at any moment. sync() is a no-op before mount.
    renderTimer = setTimeout(() => { renderTimer = null; sync(); }, 60);
  };

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------

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

  const onHome = () => ui.everywhere || location.pathname === '/';

  const sync = () => {
    if (!root) return;
    const show = onHome();
    root.style.display = show ? '' : 'none';
    panel.style.display = show && ui.open ? 'flex' : 'none';
    fab.setAttribute('aria-expanded', String(ui.open));
    pinBtn.dataset.on = ui.everywhere ? '1' : '0';
    title.textContent = data.self ? `alignment · @${data.self}` : 'alignment';
    if (show && ui.open) {
      drag.apply(ui);
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

    fab = el('button', 'pkaw-fab', '◎');
    fab.title = 'Politiko Align Watch (passive) — drag to move';
    fab.addEventListener('click', () => {
      if (fabDrag.dragged()) return; // that gesture was a drag, not a click
      ui.open = !ui.open; saveUI(); sync();
    });
    root.append(fab);

    panel = el('div', 'pkaw-panel');
    head = el('div', 'pkaw-head');
    head.title = 'Drag to move · double-click to snap back';
    title = el('h1', '', 'alignment');

    pinBtn = el('button', 'pkaw-btn', 'all pages');
    pinBtn.title = 'Show this panel on every screen instead of only the home page';
    pinBtn.addEventListener('click', () => { ui.everywhere = !ui.everywhere; saveUI(); sync(); });

    const close = el('button', 'pkaw-btn', '×');
    close.title = 'Hide (the ◎ button brings it back)';
    close.addEventListener('click', () => { ui.open = false; saveUI(); sync(); });

    head.append(title, pinBtn, close);
    body = el('div', 'pkaw-body');
    panel.append(head, body);
    root.append(panel);
    document.documentElement.append(root);

    drag = draggable(panel, head, (pos) => { Object.assign(ui, pos ?? { x: null, y: null }); saveUI(); });
    head.addEventListener('dblclick', drag.reset);

    // the FAB moves too — it is UI in the way just as much as the panel is
    fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUI(); });
    fabDrag.apply(ui.fab);

    sync();
  };

  // ---------------------------------------------------------------------------
  // SPA lifecycle — React Router means no page loads
  // ---------------------------------------------------------------------------
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

  // Freshness text ages; nothing else needs a clock. Visible tab only.
  setInterval(() => { if (!document.hidden && ui.open && onHome() && !panel?.matches(':hover')) render(); }, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRender(); });

  const boot = () => { mount(); checkRoute(); log('ready', data.self ? `as @${data.self}` : '(session unknown yet)'); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
