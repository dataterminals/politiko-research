// ==UserScript==
// @name         Politiko — XP Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.2.3
// @description  Ledger of your own stat/skill changes, diffed from responses the game already fetched: per-action XP where one action sits alone in a window, train/education awards measured exactly, everything else honestly labelled passive or ambiguous. Passive — zero added requests.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/xp-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/xp-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON responses the game client itself requested, on pages you are
 *             actively viewing. Specifically:
 *               GET  /api/user/status          — the app polls this every 10 s anyway;
 *                                                used for your own username and to
 *                                                notice jailed/traveling stretches
 *               GET  /api/users/<you>/stats    — fires when YOU open your own profile's
 *                                                stats tab; the live skill sheet
 *               GET  /api/train                — fires when YOU open the train page
 *               POST /api/train                — the response to a training you started;
 *                                                the one response in the game that
 *                                                states its own XP award
 *               GET  /api/education…           — fires on education pages; the course
 *                                                catalog with its declared rewards
 *               GET  /api/user/progression     — fires on the home page; its `current`
 *                                                values are a live full-width sheet
 *                                                (field-verified 2026-08-11, docs/10)
 *                                                and are read as readings; its `change`
 *                                                column is period-snapshot data and is
 *                                                not used
 *               POST /api/actions/*, /api/disobedience, /api/protests…, /api/combat…,
 *               /api/terminal/exec, /api/city/bank/rob, /api/travel, /api/jobs/specials
 *                                              — responses to actions YOU submitted,
 *                                                recorded as events for attribution
 *
 *             Only YOUR OWN character's data is ever stored. Another player's
 *             /stats response is ignored and never written anywhere. Request
 *             bodies are never read. The `auth` localStorage key (your tokens) is
 *             never touched, and credential-looking fields in any recorded
 *             response are redacted before storage.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. Nothing is polled, timed,
 *             scheduled, retried, or prefetched. Every reading this tool ever
 *             gets exists because you navigated somewhere and the game fetched
 *             what it always fetches there. The panel's "home ↻" button performs
 *             the same client-side route change as clicking Home in the game's
 *             own nav — the app then fetches as it normally would, and only at
 *             the moment you click.
 *
 *   Storage:  localStorage keys prefixed `pkxp:` — your own readings, deltas,
 *             action events, person-scrubbed response samples, panel position
 *             and size
 *
 *   Alerts:   none. No notifications, no sound, no title changes; the panel only
 *             renders while the tab is visible
 *
 *   Clipboard: written ONLY when you click "copy" (tab-separated delta history)
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 * What the numbers mean, and which parts are measured vs inferred:
 * docs/10-xp-surface.md.
 *
 * The honest limitation, stated up front: the game refreshes no skill data after
 * a crime — its own UI cannot show you what a crime trained. So a delta can only
 * be pinned to one action when your readings bracket that action alone. The
 * sheet-sandwich (a reading before and after; a window refocus on the mounted
 * page also refetches) is the operator-driven instrument, exactly like
 * people-watch's roster walk. Windows holding several actions are kept and
 * shown as ambiguous, never averaged into per-action numbers.
 *
 * As of 2026-08-11 the live game's profile stats tab is unfinished — it can
 * answer sealed/empty/an error for your own profile, and the panel says so when
 * it does. The working sheets are HOME (the dossier: every stat, live) and the
 * TRAIN page (live values for whatever your current city trains).
 *
 * Second purpose: crime responses might carry award fields the client discards
 * (both prior passive captures found the wire wider than the reader). This tool
 * keeps a few person-scrubbed raw samples per action endpoint so a real grinding
 * session can settle that. If awards do ride the responses, per-action XP stops
 * needing the diff engine at all.
 */

(() => {
  'use strict';

  const TAG = '[pk-xp-watch]';
  const VERSION = '0.2.3';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { ledger: 'pkxp:ledger', samples: 'pkxp:samples', ui: 'pkxp:ui' };

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // The taxonomy (6 core stats + 31 skills, all fractional floats) is measured in
  // docs/10-xp-surface.md. This tool deliberately hardcodes NO key list: whatever
  // keys arrive on your own sheet are tracked, so a server-side addition shows up
  // instead of being filtered out — the same posture as HomePage's own "Other"
  // bucket for keys its category table doesn't know.

  // Train responses name the target by LABEL ("First Aid"), not key. The train GET
  // supplies label→key pairs which we remember; this is the cold-start fallback.
  const slug = (label) => String(label ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

  // ===========================================================================
  // ROUTER — which /api responses this tool reads, and as what. Everything else
  // is dropped unread: an allowlist, so chat, messages, and every other private
  // surface are structurally unrecordable rather than carefully avoided.
  // ===========================================================================
  const classify = (url, method) => {
    let path;
    try { path = new URL(url, 'https://politiko.io').pathname; } catch { return null; }
    if (!path.startsWith('/api/')) return null;
    const p = path.slice(4); // drop /api
    const m = (method || 'GET').toUpperCase();

    if (m === 'GET') {
      if (p === '/user/status') return { kind: 'status' };
      if (p === '/train') return { kind: 'train-sheet' };
      if (p === '/user/progression') return { kind: 'assessment' };
      if (p === '/education' || p.startsWith('/education/')) return { kind: 'education' };
      const own = p.match(/^\/users\/([^/]+)\/stats$/);
      if (own) return { kind: 'stats-sheet', name: decodeURIComponent(own[1]) };
      return null;
    }
    if (m !== 'POST') return null;

    if (p === '/train') return { kind: 'train-award' };
    // Action endpoints worth an event: things that plausibly train a skill.
    // Extending this list is an edit to the script, on purpose (clause 6).
    // Numeric path segments are collapsed to {id} so per-target attempts
    // aggregate under one endpoint and no id is stored.
    const ep = p.replace(/\/\d+(?=\/|$)/g, '/{id}');
    if (/^\/actions\/[a-z-]+(\/|$)/.test(p)) return { kind: 'action', ep };
    if (p === '/disobedience') return { kind: 'action', ep };
    if (p === '/protests' || /^\/protests\/[^/]+\/join$/.test(p)) return { kind: 'action', ep };
    if (/^\/combat\/[^/]+\/(action|resolve)$/.test(p)) return { kind: 'action', ep };
    if (p === '/terminal/exec') return { kind: 'action', ep };
    if (p === '/city/bank/rob') return { kind: 'action', ep };
    if (p === '/travel') return { kind: 'action', ep };
    if (p === '/jobs/specials') return { kind: 'action', ep };
    return null;
  };

  // Known outcome fields per endpoint family — measured off the 2026-08-10 bundles.
  // Anything unrecognized stays null rather than guessed.
  const outcomeOf = (ep, data) => {
    if (!data || typeof data !== 'object') return null;
    if (ep.startsWith('/actions/car-theft')) {
      return data.jailed ? 'bust' : data.complete ? 'success'
        : data.abandoned ? 'abandoned' : data.stage ? 'in-progress' : null;
    }
    if (ep === '/actions/graffiti') {
      return (data.arrested || data.hospitalized) ? 'bust'
        : (data.paint_landed || data.deface_cleared) ? 'success' : null;
    }
    if (data.jailed === true || data.arrested === true) return 'bust';
    return null;
  };

  // ===========================================================================
  // SCRUB — before anything is stored. Same conventions as ws-watch 0.2.0:
  // credential-looking KEYS lose their value outright; person-shaped keys keep
  // the key and lose the value, so "this response carries a username" stays
  // answerable without recording whose.
  // ===========================================================================
  const SECRET = /(token|jwt|auth|bearer|secret|password|passwd|refresh|session|cookie|credential|apikey|api_key)/i;
  // Containment, not exact match: raw action responses are exactly the payloads
  // whose shape we do NOT know, so `username_of_officer` has to scrub as surely
  // as `username`. Award fields are numeric under non-person keys (gain, xp,
  // skill…), so aggressive stubbing here costs the discovery mission nothing.
  const PERSONAL = /(user|name|sender|recipient|target|combat|opponent|counterpart|officer|victim|attacker|defender|nick|body|text|message|content|label|title|email|avatar|quip)/i;
  const scrub = (v, d = 0) => {
    if (d > 6 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, d + 1));
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      o[k] = SECRET.test(k) ? '[redacted]'
        : (PERSONAL.test(k) && val !== null && typeof val !== 'object') ? `<${typeof val}>`
          : scrub(val, d + 1);
    }
    return o;
  };

  // ===========================================================================
  // ENGINE — a reducer over classified responses. Pure of DOM and network so the
  // tests can drive it straight out of this file.
  //
  // The model: `last[key]` is the newest trusted value of a stat/skill and when
  // it was read. Every fresh reading closes a window per key; a changed value is
  // a delta whose attribution comes from the events inside that window:
  //
  //   residual = delta − (train gains in window) − (education awards in window)
  //   residual ≈ 0                         → explained
  //   residual, exactly 1 action in window → attributed  (the per-action numbers)
  //   residual, no actions in window       → passive     (jail/travel if seen)
  //   residual, 2+ actions in window       → ambiguous   (kept, never averaged)
  //
  // Readings with UNCHANGED values still advance `last[key].t` — a reading that
  // shows no gain is evidence there was no gain, and it narrows future windows.
  // ===========================================================================
  const EPS = 5e-7; // below the 4-dp precision the game itself displays
  const CAP = { deltas: 1500, events: 1500, feed: 12 };

  const makeLedger = () => ({
    me: null,
    status: null,               // last seen /user/status status string
    sheetIssue: null,           // {t, kind:'sealed'|'empty'} when the live stats tab misbehaves
    last: {},                   // key → {v, t}
    labelToKey: {},             // "First Aid" → first_aid, learned from train GET
    trainMeta: null,            // {heart, daily_slots, targets:{key:{practice_gain,class_gain}}}
    eduCourses: {},             // code → {completed, rewards:[{key,amount}]}
    assessment: null,           // {snapshot_date, previous_date, change, currentSeen}
    changeVerdict: null,        // what the dossier's `change` column turned out to be
    events: [],                 // {t, kind:'action'|'train'|'edu'|'status', …}
    deltas: [],                 // {t, key, d, from, to, attrib:{type, ep?, n?, note?}}
    actStats: {},               // ep → {n, outcomes:{}, xp:{key:{sum,n}}}
    firstSeen: null,
  });

  const eventsIn = (L, t0, t1) => L.events.filter((e) => e.t > t0 && e.t <= t1);

  const closeWindow = (L, key, value, t, out) => {
    const prev = L.last[key];
    L.last[key] = { v: value, t };
    if (!prev || !(Math.abs(value - prev.v) > EPS)) return;

    const d = value - prev.v;
    const win = eventsIn(L, prev.t, t);
    const trainPart = win.reduce((s, e) => s + (e.kind === 'train' && e.key === key ? (e.gain ?? 0) : 0), 0);
    const eduPart = win.reduce((s, e) => s + (e.kind === 'edu'
      ? (e.rewards ?? []).filter((r) => r.key === key).reduce((a, r) => a + (r.amount ?? 0), 0) : 0), 0);
    const residual = d - trainPart - eduPart;
    const actions = win.filter((e) => e.kind === 'action');

    // Measured/declared awards get their own rows, so they are never folded into
    // an action's residual, and the residual row carries the attribution.
    let cursor = prev.v;
    const row = (part, attrib) => {
      out.push({ t, key, d: part, from: cursor, to: cursor + part, attrib });
      cursor += part;
    };
    if (trainPart !== 0) row(trainPart, { type: 'train', n: 0 });
    if (eduPart !== 0) row(eduPart, { type: 'education', n: 0 });
    if (Math.abs(residual) > EPS) {
      if (actions.length === 1) {
        row(residual, { type: 'action', ep: actions[0].ep, n: 1 });
        const a = (L.actStats[actions[0].ep] ??= { n: 0, outcomes: {}, xp: {} });
        const x = (a.xp[key] ??= { sum: 0, n: 0 });
        x.sum += residual; x.n += 1;
      } else if (actions.length === 0) {
        const note = win.find((e) => e.kind === 'status' && (e.to === 'jailed' || e.to === 'traveling'))?.to
          ?? (L.status === 'jailed' || L.status === 'traveling' ? L.status : null);
        row(residual, { type: 'passive', n: 0, note });
      } else {
        row(residual, { type: 'ambiguous', n: actions.length, eps: [...new Set(actions.map((a) => a.ep))] });
      }
    }
  };

  const pushEvent = (L, e) => {
    L.events.push(e);
    if (L.events.length > CAP.events) L.events.splice(0, L.events.length - CAP.events);
  };

  // One classified response in, zero or more delta rows out (already appended).
  const ingest = (L, msg, data, t) => {
    const out = [];
    if (!data || typeof data !== 'object') return out;
    L.firstSeen ??= t;

    if (msg.kind === 'status') {
      if (typeof data.username === 'string' && data.username) L.me = data.username;
      const s = typeof data.status === 'string' ? data.status : null;
      if (s && s !== L.status) {
        if (L.status !== null) pushEvent(L, { t, kind: 'status', from: L.status, to: s });
        L.status = s;
      }
      return out;
    }

    if (msg.kind === 'stats-sheet') {
      // Own sheet only. Another player's response is dropped whole, here, before
      // anything could store it.
      if (!L.me || msg.name !== L.me) return out;
      const sheet = data.stats;
      // Field report 2026-08-11: the live game's stats tab is unfinished and can
      // return a sealed/empty payload for your own profile. Silent nothing here
      // cost real debugging time, so the condition is recorded and surfaced in
      // the panel instead — and the train page is the working sheet meanwhile.
      if (data.can_view === false) { L.sheetIssue = { t, kind: 'sealed', axis: data.privacy_rights_axis ?? null }; return out; }
      if (!sheet || typeof sheet !== 'object') { L.sheetIssue = { t, kind: 'empty' }; return out; }
      L.sheetIssue = null;
      for (const [key, v] of Object.entries(sheet)) {
        if (typeof v === 'number' && Number.isFinite(v)) closeWindow(L, key, v, t, out);
      }
    }

    if (msg.kind === 'train-sheet') {
      const targets = Array.isArray(data.targets) ? data.targets : [];
      L.trainMeta = {
        heart: data.heart ?? null,
        daily_slots: data.daily_slots ?? null,
        // The target list is location-determined (docs/10, field-confirmed
        // 2026-08-11), so a reading without its city is half a datum: stamped
        // reports from different cities build the city→trainable-skills map.
        city_name: typeof data.city_name === 'string' ? data.city_name : null,
        city_theme: typeof data.city_theme === 'string' ? data.city_theme : null,
        targets: Object.fromEntries(targets.map((x) => [x.key, {
          practice_gain: x.practice_gain ?? null, class_gain: x.class_gain ?? null,
        }])),
      };
      for (const x of targets) {
        if (typeof x.label === 'string' && typeof x.key === 'string') L.labelToKey[x.label] = x.key;
        if (typeof x.key === 'string' && typeof x.value === 'number' && Number.isFinite(x.value)) {
          closeWindow(L, x.key, x.value, t, out);
        }
      }
    }

    if (msg.kind === 'train-award') {
      const key = L.labelToKey[data.target_label] ?? slug(data.target_label);
      const gain = typeof data.gain === 'number' ? data.gain : null;
      if (key && gain !== null) {
        pushEvent(L, { t, kind: 'train', key, gain, mode: data.mode ?? null });
        if (typeof data.after_value === 'number' && Number.isFinite(data.after_value)) {
          closeWindow(L, key, data.after_value, t, out); // the award explains itself
        }
      }
    }

    if (msg.kind === 'education') {
      const courses = []
        .concat(Array.isArray(data.courses) ? data.courses : [])
        .concat(Array.isArray(data.track?.courses) ? data.track.courses : [])
        .concat(Array.isArray(data.tracks) ? data.tracks.flatMap((x) => x.courses ?? []) : []);
      for (const c of courses) {
        if (!c || typeof c.code !== 'string') continue;
        const rewards = (Array.isArray(c.stat_rewards) ? c.stat_rewards : [])
          .filter((r) => r && typeof r.key === 'string' && typeof r.amount === 'number');
        const prev = L.eduCourses[c.code];
        if (prev && !prev.completed && c.completed === true && rewards.length) {
          pushEvent(L, { t, kind: 'edu', code: c.code, rewards });
        }
        L.eduCourses[c.code] = { completed: c.completed === true, rewards };
      }
      return out;
    }

    if (msg.kind === 'stats-sheet-error') {
      // The tab's request came back non-2xx. Field-measured 2026-08-11: the
      // unfinished stats tab left no sealed/empty trace, so the failure most
      // likely lives at the HTTP layer — record the status so one visit to the
      // broken tab measures it.
      if (L.me && msg.name === L.me) L.sheetIssue = { t, kind: `http ${data.status}` };
      return out;
    }

    if (msg.kind === 'assessment') {
      // PROMOTED 2026-08-11 (docs/10): `current` on the dossier is live. The
      // verdict came from the field — a crew account gained +1.18 persuasion
      // between two reports while the dossier's assessment dates stood still,
      // and the comparison still read 7/7 match. Only `change` is
      // snapshot-cycle data. So the home page is a full-width live sheet:
      // every visit reads all keys, crime skills included.
      const table = Array.isArray(data.stats_table) ? data.stats_table
        : Array.isArray(data.stats) ? data.stats : [];
      const change = {};
      for (const row of table) {
        if (!row || typeof row.key !== 'string') continue;
        if (typeof row.current === 'number' && Number.isFinite(row.current)) {
          closeWindow(L, row.key, row.current, t, out);
        }
        if (typeof row.change === 'number' && Number.isFinite(row.change)) change[row.key] = row.change;
      }

      // What IS the `change` column (the home page's little green arrows)?
      // The dates say "since the previous assessment", but that is the card's
      // framing, not a measurement — and the same framing already misled this
      // repo once about `current` (docs/10). Two dossier reads that bracket a
      // known gain discriminate the possibilities without any extra request:
      //
      //   change moves WITH current  → a running total against a fixed
      //                                baseline (a window, possibly rolling)
      //   change stays PUT           → frozen at assessment time; true
      //                                period-to-period snapshot data
      //
      // A rolling window has a further signature only time can show: an old
      // gain must eventually drop back OUT of `change`. One game year is one
      // real week (docs/06), so the operator's "is it a game year?" reading
      // predicts specifically that change ≈ the gains of the last 7 real days.
      const prev = L.assessment;
      if (prev && prev.change) {
        for (const k of Object.keys(change)) {
          const dCur = (L.last[k]?.v ?? 0) - (prev.currentSeen?.[k] ?? NaN);
          const dChg = change[k] - prev.change[k];
          if (!Number.isFinite(dCur) || Math.abs(dCur) <= EPS) continue;
          L.changeVerdict = {
            at: t, key: k, dCurrent: dCur, dChange: dChg,
            kind: Math.abs(dChg - dCur) <= EPS ? 'running'
              : Math.abs(dChg) <= EPS ? 'frozen' : 'other',
            datesMoved: prev.snapshot_date !== (data.snapshot_date ?? null),
          };
          break; // one clean witness is the whole experiment
        }
      }

      const currentSeen = {};
      for (const row of table) {
        if (row && typeof row.key === 'string' && typeof row.current === 'number') currentSeen[row.key] = row.current;
      }
      L.assessment = {
        snapshot_date: data.snapshot_date ?? null,
        previous_date: data.previous_date ?? null,
        at: t, keys: table.length, change, currentSeen,
      };
    }

    if (msg.kind === 'action') {
      const a = (L.actStats[msg.ep] ??= { n: 0, outcomes: {}, xp: {} });
      a.n += 1;
      const o = outcomeOf(msg.ep, data);
      if (o) a.outcomes[o] = (a.outcomes[o] ?? 0) + 1;
      pushEvent(L, { t, kind: 'action', ep: msg.ep, outcome: o });
    }

    if (out.length) {
      L.deltas.push(...out);
      if (L.deltas.length > CAP.deltas) L.deltas.splice(0, L.deltas.length - CAP.deltas);
    }
    return out;
  };

  // ===========================================================================
  // SAMPLES — the instrument half: a small ring of person-scrubbed raw action
  // responses per endpoint, so a real grinding session can reveal award fields
  // the client discards. 3 per endpoint, 2000 chars each, scrubbed before write.
  // ===========================================================================
  const SAMPLE_RING = 3, SAMPLE_CHARS = 2000;
  const recordSample = (samples, ep, data, t) => {
    const ring = (samples[ep] ??= []);
    let body;
    try { body = JSON.stringify(scrub(data)).slice(0, SAMPLE_CHARS); } catch { return; }
    ring.push({ t, body });
    if (ring.length > SAMPLE_RING) ring.splice(0, ring.length - SAMPLE_RING);
  };

  // One-click diagnostic report, built for pasting into a crew chat: which
  // targets /train actually serves (with predicted gains — the class-multiplier
  // question answers itself from this), what the sheet sources are doing, and
  // the current readings. Own-account numbers only; no username included.
  const buildReport = (L, samples, version) => {
    const lines = [`xp-watch ${version} report`];
    if (L.trainMeta) {
      const t = Object.entries(L.trainMeta.targets);
      const where = L.trainMeta.city_name
        ? `${L.trainMeta.city_name}${L.trainMeta.city_theme ? ` (${L.trainMeta.city_theme})` : ''}`
        : 'no city';
      lines.push(`train targets: ${t.length} @ ${where} · heart ${L.trainMeta.heart ?? '?'} · slots/window ${L.trainMeta.daily_slots ?? '?'}`);
      for (const [k, m] of t.sort((a, b) => a[0].localeCompare(b[0]))) {
        const v = L.last[k] ? L.last[k].v.toFixed(2) : '?';
        lines.push(`  ${k} = ${v}  practice +${m.practice_gain ?? '?'}  class +${m.class_gain ?? '?'}`);
      }
    } else {
      lines.push('train targets: page not visited yet');
    }
    lines.push(L.sheetIssue
      ? `profile stats tab: answered ${L.sheetIssue.kind}${L.sheetIssue.axis != null ? ` (rights axis ${L.sheetIssue.axis})` : ''}`
      : 'profile stats tab: no issue recorded');
    if (L.assessment?.snapshot_date != null || L.assessment?.keys) {
      lines.push(`home dossier assessed: ${L.assessment.snapshot_date ?? '?'} (prev ${L.assessment.previous_date ?? '?'}) · ${L.assessment.keys ?? 0} keys · live reading source`);
      const v = L.changeVerdict;
      if (v) {
        lines.push(`change column: ${v.kind === 'running' ? 'RUNNING — moved with the gain'
          : v.kind === 'frozen' ? 'FROZEN — did not move with the gain'
            : 'moved by a different amount'} (${v.key} current ${v.dCurrent > 0 ? '+' : ''}${v.dCurrent.toFixed(4)}, change ${v.dChange > 0 ? '+' : ''}${v.dChange.toFixed(4)}${v.datesMoved ? ', assessment dates moved' : ', dates unchanged'})`);
      }
      // The raw arrows, so a reader can sanity-check them against what they
      // know they did — the "is it a game year?" question needs the values.
      const top = Object.entries(L.assessment.change ?? {})
        .filter(([, n]) => Math.abs(n) > EPS)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
      if (top.length) lines.push(`change values: ${top.map(([k, n]) => `${k} ${n > 0 ? '+' : ''}${n}`).join(' · ')}`);
    }
    const keys = Object.keys(L.last);
    lines.push(`readings held: ${keys.length} key${keys.length === 1 ? '' : 's'} · deltas recorded: ${L.deltas.length} · sample endpoints: ${Object.keys(samples).length}`);
    // Key-name digest of the raw action samples, so a pasted report can reveal
    // response fields the client never renders — values stay home.
    const flat = (o, p, d, acc) => {
      if (d > 3 || !o || typeof o !== 'object') return acc;
      for (const [k, v] of Object.entries(o)) {
        const key = p ? `${p}.${k}` : k;
        acc.add(key);
        if (Array.isArray(v)) { if (v.length && typeof v[0] === 'object') flat(v[0], `${key}[]`, d + 1, acc); }
        else if (v && typeof v === 'object') flat(v, key, d + 1, acc);
      }
      return acc;
    };
    for (const [ep, ring] of Object.entries(samples)) {
      const seen = new Set();
      for (const s of ring) { try { flat(JSON.parse(s.body), '', 0, seen); } catch { /* truncated sample */ } }
      if (seen.size) {
        const list = [...seen].sort();
        lines.push(`sampled ${ep}: ${list.slice(0, 40).join(' ')}${list.length > 40 ? ' …' : ''}`);
      }
    }
    return lines.join('\n');
  };

  // ---------------------------------------------------------------------------
  // Persistent state
  // ---------------------------------------------------------------------------
  const stored = readJSON(K.ledger, null);
  const L = Object.assign(makeLedger(), stored);
  const samples = readJSON(K.samples, {});
  const sessionStart = Date.now();
  let dirty = false;
  const save = () => {
    if (!dirty) return;
    dirty = false;
    writeJSON(K.ledger, L);
    writeJSON(K.samples, samples);
  };
  setInterval(save, 3000); // local persistence cadence; no network anywhere near this
  window.addEventListener('beforeunload', save);

  // ---------------------------------------------------------------------------
  // Passive tap — observe responses the app requested on its own.
  // This ADDS NO REQUESTS. It only reads what was already in flight.
  // ---------------------------------------------------------------------------
  const listeners = new Set();
  const onApiResponse = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === 'string' ? req : req?.url ?? '';
      const method = (args[1]?.method ?? (typeof req === 'object' ? req?.method : null) ?? 'GET');
      if (url.includes('/api/')) {
        const msg = classify(url, method);
        if (msg && !res.ok) {
          // Body left unread. Only the own-sheet endpoint records its failure —
          // the broken stats tab was invisible to an ok-only tap (docs/10).
          if (msg.kind === 'stats-sheet') {
            const err = { ...msg, kind: 'stats-sheet-error' };
            listeners.forEach((fn) => { try { fn(err, { status: res.status }); } catch (e) { log('listener error', e); } });
          }
        } else if (msg && res.headers.get('content-type')?.includes('json')) {
          // clone so the app's own consumer still gets an unread body
          res.clone().json().then(
            (data) => listeners.forEach((fn) => { try { fn(msg, data); } catch (e) { log('listener error', e); } }),
            () => {},
          );
        }
      }
    } catch (e) { log('tap error', e); }
    return res;
  };

  onApiResponse((msg, data) => {
    const t = Date.now();
    const rows = ingest(L, msg, data, t);
    if (msg.kind === 'action') recordSample(samples, msg.ep, data, t);
    dirty = true;
    if (rows.length) log('delta', rows);
    scheduleRender();
  });

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

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------
  const ui = readJSON(K.ui, {});
  let panel = null, fab = null, drag = null, fabDrag = null, renderQueued = false;

  const fmt = (n) => {
    const s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return (n > 0 ? '+' : '') + s;
  };
  const age = (t) => {
    const m = Math.floor((Date.now() - t) / 6e4);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const issueLabel = (i) => i.kind === 'sealed'
    ? `<b>sealed</b>${i.axis != null ? ` (rights axis ${esc(String(i.axis))}, needs 3)` : ''}`
    : i.kind.startsWith('http') ? `<b>an error (${esc(i.kind.toUpperCase())})</b>`
      : '<b>empty</b>';

  const attribText = (a) => {
    if (a.type === 'action') return esc(a.ep.replace(/^\/actions\//, '').replace(/^\//, ''));
    if (a.type === 'train') return 'train';
    if (a.type === 'education') return 'education';
    if (a.type === 'ambiguous') return `ambiguous ×${a.n}`;
    return a.note ? `passive · ${esc(a.note)}` : 'passive';
  };
  const ATTRIB_COLOR = { action: '#34d399', train: '#38bdf8', education: '#a78bfa', passive: '#a1a1aa', ambiguous: '#fbbf24' };

  const CSS = `
    #pkxp-fab{position:fixed;right:16px;bottom:132px;z-index:99999;width:38px;height:26px;border-radius:4px;
      background:#18181b;border:1px solid #3f3f46;color:#e4e4e7;font:700 10px/24px ui-monospace,monospace;
      text-align:center;letter-spacing:.08em;user-select:none}
    #pkxp-fab:hover{border-color:#71717a}
    /* resize:both needs a non-visible overflow; .bd does the scrolling. The
       min-* pair is the same "never strand the UI" rule PANEL KIT's fit()
       enforces for position — a panel shrunk to nothing has no grab area
       left, and double-clicking the header restores both. */
    #pkxp{position:fixed;right:16px;bottom:166px;z-index:99999;width:340px;max-height:70vh;display:flex;
      flex-direction:column;background:#0c0c0f;border:1px solid #3f3f46;border-radius:6px;
      color:#d4d4d8;font:11px/1.5 ui-monospace,monospace;box-shadow:0 8px 30px rgba(0,0,0,.5);
      overflow:hidden;resize:both;min-width:260px;min-height:160px}
    #pkxp header{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #27272a;user-select:none}
    #pkxp header b{letter-spacing:.14em;font-size:10px;color:#fafafa}
    #pkxp header span{color:#71717a;font-size:10px}
    #pkxp header button{margin-left:auto;background:none;border:none;color:#a1a1aa;cursor:pointer;font-size:12px}
    #pkxp .bd{overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:10px}
    #pkxp h4{margin:0;font-size:9px;letter-spacing:.14em;color:#71717a;text-transform:uppercase}
    #pkxp table{border-collapse:collapse;width:100%}
    #pkxp td,#pkxp th{padding:1px 6px 1px 0;text-align:left;font-weight:400;white-space:nowrap}
    #pkxp th{color:#71717a;font-size:9px;text-transform:uppercase;letter-spacing:.1em}
    #pkxp td.num{text-align:right;font-variant-numeric:tabular-nums}
    #pkxp .hint{color:#a1a1aa;background:#18181b;border:1px solid #27272a;border-radius:4px;padding:6px 8px}
    #pkxp .ft{display:flex;gap:6px;padding:7px 10px;border-top:1px solid #27272a}
    #pkxp .ft button{background:#18181b;border:1px solid #3f3f46;border-radius:3px;color:#d4d4d8;
      font:10px ui-monospace,monospace;padding:3px 8px;cursor:pointer}
    #pkxp .ft button:hover{border-color:#71717a}
    #pkxp .muted{color:#71717a}
  `;

  const totalsBy = (from) => {
    const by = {}; // key → {action, train, education, passive, ambiguous}
    for (const d of L.deltas) {
      if (d.t < from) continue;
      const b = (by[d.key] ??= { action: 0, train: 0, education: 0, passive: 0, ambiguous: 0 });
      b[d.attrib.type] += d.d;
    }
    return by;
  };

  const render = () => {
    if (!panel || panel.hidden) return;
    const bd = panel.querySelector('.bd');
    const feed = L.deltas.slice(-CAP.feed).reverse();
    const sess = totalsBy(sessionStart), all = totalsBy(0);
    const sum = (b) => b.action + b.train + b.education + b.passive + b.ambiguous;

    const lastReadAt = Object.values(L.last).length
      ? Math.max(...Object.values(L.last).map((x) => x.t)) : null;
    const sheetAge = lastReadAt === null ? null : age(lastReadAt);
    // Actions taken since the last reading are UNMEASURED until a reading
    // closes their window. Field report 2026-08-11: a user ran three graffiti
    // attempts, saw "none attributed", and reasonably concluded the tool was
    // broken — nothing told him the measurement was still open. Say it.
    const pending = lastReadAt === null ? [] : L.events.filter((e) => e.kind === 'action' && e.t > lastReadAt);

    const rows = Object.keys(all)
      .map((k) => ({ k, s: sess[k] ? sum(sess[k]) : 0, a: sum(all[k]), last: L.last[k] }))
      .filter((r) => Math.abs(r.s) > EPS || Math.abs(r.a) > EPS)
      .sort((x, y) => Math.abs(y.s) - Math.abs(x.s) || Math.abs(y.a) - Math.abs(x.a));

    const acts = Object.entries(L.actStats)
      .filter(([, a]) => a.n > 0)
      .sort((x, y) => y[1].n - x[1].n)
      .slice(0, 10);

    bd.innerHTML = `
      ${L.sheetIssue ? `<div class="hint" style="border-color:#7c2d12;color:#fdba74">Your profile's stats tab
        answered ${issueLabel(L.sheetIssue)}
        — the game's stats tab is unfinished right now. Use <b>HOME</b> as your sheet
        instead: the dossier reads every stat live on each visit and window refocus, and
        this panel diffs what arrives.</div>` : ''}
      ${pending.length ? `<div class="hint" style="border-color:#155e75;color:#7dd3fc">
        <b>${pending.length} action${pending.length === 1 ? '' : 's'} not measured yet</b>
        (${esc([...new Set(pending.map((p) => p.ep.replace(/^\/actions\//, '').replace(/^\//, '')))].join(', '))}).
        Nothing is lost — a gain only becomes a number once a reading closes the window.
        Click <b>home ↻</b> below to take one now.${pending.length > 1
          ? ` With ${pending.length} actions in the window the total is measured but cannot be
             split between them; for exact per-action XP, read before and after a single action.` : ''}
      </div>` : ''}
      ${sheetAge === null && !L.sheetIssue ? `<div class="hint">No reading yet — click
        <b>home ↻</b> below. The home dossier reads ALL your stats live, on every visit and
        every window refocus, and this panel diffs what arrives. The loop: read, act, read.
        One action between two reads gives that action's exact XP in every skill it moved.</div>` : ''}
      <div>
        <h4>latest deltas</h4>
        ${feed.length === 0 ? '<div class="muted">none recorded yet</div>' : `<table>${feed.map((d) => `
          <tr><td class="muted">${age(d.t)}</td>
          <td class="num" style="color:${d.d >= 0 ? '#34d399' : '#f87171'}">${fmt(d.d)}</td>
          <td>${esc(d.key)}</td>
          <td style="color:${ATTRIB_COLOR[d.attrib.type]}">${attribText(d.attrib)}</td></tr>`).join('')}</table>`}
      </div>
      <div>
        <h4>skills · session / all-time</h4>
        ${rows.length === 0 ? '<div class="muted">no measured changes yet</div>' : `<table>
          <tr><th>key</th><th class="num">Δ session</th><th class="num">Δ all</th><th class="num">value</th><th>read</th></tr>
          ${rows.slice(0, 14).map((r) => `<tr><td>${esc(r.k)}</td>
            <td class="num">${Math.abs(r.s) > EPS ? fmt(r.s) : '·'}</td>
            <td class="num">${fmt(r.a)}</td>
            <td class="num">${r.last ? r.last.v.toFixed(2) : '—'}</td>
            <td class="muted">${r.last ? age(r.last.t) : '—'}</td></tr>`).join('')}</table>`}
      </div>
      <div>
        <h4>actions · measured xp only</h4>
        ${acts.length === 0 ? '<div class="muted">no action events yet</div>' : `<table>
          <tr><th>endpoint</th><th class="num">n</th><th>outcomes</th><th>xp/attempt</th></tr>
          ${acts.map(([ep, a]) => {
            const oc = Object.entries(a.outcomes).map(([k, v]) => `${esc(k)}:${v}`).join(' ') || '—';
            const xp = Object.entries(a.xp).map(([k, x]) => `${esc(k)} ${fmt(x.sum / x.n)}(${x.n})`).join(' · ')
              || `<span class="muted">${pending.some((p) => p.ep === ep) ? 'not measured yet' : 'no measured gain'}</span>`;
            return `<tr><td>${esc(ep.replace(/^\/actions\//, ''))}</td><td class="num">${a.n}</td><td>${oc}</td><td>${xp}</td></tr>`;
          }).join('')}</table>`}
      </div>
      <div class="muted">
        ${L.me ? `${esc(L.me)} · ` : ''}${sheetAge !== null ? (sheetAge === 'now' ? 'sheet fresh · ' : `sheet ${sheetAge} ago · `) : ''}
        ${L.assessment?.snapshot_date ? `dossier assessed ${esc(String(L.assessment.snapshot_date))} · ` : ''}
        samples: ${Object.keys(samples).length} endpoint${Object.keys(samples).length === 1 ? '' : 's'} (__pkxw.samples())
      </div>`;
    if (drag) drag.fit();
  };

  const scheduleRender = () => {
    if (renderQueued || document.visibilityState !== 'visible') return;
    renderQueued = true;
    // rAF coalesces bursts, but it does NOT fire while the page is not
    // compositing (backgrounded tab, installed PWA in the background). Relying
    // on it alone latches renderQueued forever and the panel silently stops
    // updating — which looks exactly like a broken tool. The timer is the
    // backstop; whichever wins clears the flag and the other becomes a no-op.
    let done = false;
    const run = () => { if (done) return; done = true; renderQueued = false; render(); };
    requestAnimationFrame(run);
    setTimeout(run, 250);
  };

  const exportAll = () => JSON.stringify({ ledger: L, samples }, null, 2);
  const copyTSV = () => {
    const lines = [['time', 'key', 'delta', 'from', 'to', 'attribution', 'detail'].join('\t')];
    for (const d of L.deltas) {
      lines.push([new Date(d.t).toISOString(), d.key, d.d, d.from, d.to, d.attrib.type,
        d.attrib.ep ?? d.attrib.note ?? (d.attrib.eps ?? []).join(',')].join('\t'));
    }
    try { navigator.clipboard.writeText(lines.join('\n')); } catch (e) { log('clipboard', e); }
  };

  const mount = () => {
    if (fab) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    fab = document.createElement('div');
    fab.id = 'pkxp-fab';
    fab.textContent = 'XP';
    document.body.appendChild(fab);

    panel = document.createElement('div');
    panel.id = 'pkxp';
    panel.hidden = !ui.open;
    panel.innerHTML = '<header><b>XP WATCH</b><button title="close">×</button></header><div class="bd"></div><div class="ft"></div>';
    document.body.appendChild(panel);

    const ft = panel.querySelector('.ft');
    for (const [label, fn] of [
      // Same client-side route change as clicking Home in the game's own nav.
      // The app then fetches the dossier as it normally would, and only at the
      // moment you click — which is what takes the reading. See docs/10.
      ['home ↻', () => {
        // Home is the router's INDEX route — the game's own nav links to `/`,
        // not `/home` (measured in the 2026-08-10 bundle).
        history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }],
      ['export', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([exportAll()], { type: 'application/json' }));
        a.download = `xp-watch-${new Date().toISOString().slice(0, 10)}.json`;
        a.click(); URL.revokeObjectURL(a.href);
      }],
      ['copy report', () => {
        try { navigator.clipboard.writeText(buildReport(L, samples, VERSION)); } catch (e) { log('clipboard', e); }
      }],
      ['copy tsv', copyTSV],
      ['clear', () => {
        if (!confirm('xp-watch: wipe all recorded readings, deltas and samples?')) return;
        Object.assign(L, makeLedger());
        for (const k of Object.keys(samples)) delete samples[k];
        dirty = true; save(); render();
      }],
    ]) {
      const b = document.createElement('button');
      b.textContent = label; b.dataset.nodrag = '1';
      b.addEventListener('click', fn);
      ft.appendChild(b);
    }

    panel.querySelector('header button').addEventListener('click', () => setOpen(false));

    //   Persist {x,y} yourself — the kit only reports it.
    drag = draggable(panel, panel.querySelector('header'), (pos) => {
      ui.panel = pos ?? undefined; writeJSON(K.ui, ui);
    });
    if (ui.panel) drag.apply(ui.panel);

    // --- Resize (local to this tool; PANEL KIT v1 above stays verbatim) ------
    // The browser's own resize grabber does the dragging. All we do is
    // remember the result: the grabber writes inline width/height, so inline
    // values that differ from what we stored can only have come from the user.
    // Content re-renders never write them, which is what keeps auto-sizing
    // intact until the first deliberate resize.
    const applySize = () => {
      if (!ui.size) return;
      panel.style.width = ui.size.w;
      panel.style.height = ui.size.h;
      panel.style.maxHeight = 'none'; // the 70vh cap would fight a chosen height
    };
    applySize();
    const rememberSize = () => {
      const w = panel.style.width, h = panel.style.height;
      if (!w && !h) return;                                      // still auto-sized
      if (ui.size && ui.size.w === w && ui.size.h === h) return;  // our own restore
      ui.size = { w, h };
      writeJSON(K.ui, ui);
      panel.style.maxHeight = 'none';
      if (drag) drag.fit();  // a taller panel can push its own handle off-screen
    };
    // Two ways in, because neither alone is sufficient. ResizeObserver is the
    // precise one but it is delivered on the rendering lifecycle, so a page
    // that is not compositing never gets the callback. pointerup is the
    // backstop: the grabber is a pointer gesture, so releasing it always lands
    // here. rememberSize() is idempotent, so both firing costs nothing.
    if (typeof ResizeObserver === 'function') new ResizeObserver(rememberSize).observe(panel);
    panel.addEventListener('pointerup', rememberSize);

    // Double-click the header: back to the default corner AND the default size.
    // This is the recovery path for a panel resized into uselessness.
    panel.querySelector('header').addEventListener('dblclick', () => {
      drag.reset();
      ui.size = undefined;
      writeJSON(K.ui, ui);
      panel.style.width = panel.style.height = '';
      panel.style.maxHeight = '';
      render();
    });

    fabDrag = draggable(fab, fab, (pos) => {
      ui.fab = pos ?? undefined; writeJSON(K.ui, ui);
    });
    if (ui.fab) fabDrag.apply(ui.fab);
    fab.addEventListener('click', () => { if (!fabDrag.dragged()) setOpen(panel.hidden); });

    // fit() clamps against the viewport, and a pre-render viewport can be 0×0 —
    // in which case the clamp lands the FAB at negative coordinates, off screen,
    // with no handle left to drag it back by. Only fit once the viewport is
    // real; until then, retry on resize/visibility (the KIT itself re-fits on
    // real resizes thereafter).
    const fitWhenReal = () => {
      if (window.innerWidth > 0 && window.innerHeight > 0) { drag.fit(); fabDrag.fit(); return true; }
      return false;
    };
    if (!fitWhenReal()) {
      let tries = 0;
      const iv = setInterval(() => { if (fitWhenReal() || ++tries > 40) clearInterval(iv); }, 250);
      const retry = () => { if (fitWhenReal()) document.removeEventListener('visibilitychange', retry); };
      document.addEventListener('visibilitychange', retry);
    }
  };

  const setOpen = (open) => {
    if (!panel) return;
    panel.hidden = !open;
    ui.open = open; writeJSON(K.ui, ui);
    if (open) { render(); drag.fit(); }
  };

  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyX') {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      setOpen(panel ? panel.hidden : true);
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleRender(); });

  // ---------------------------------------------------------------------------
  // Console API
  // ---------------------------------------------------------------------------
  window.__pkxw = {
    export: () => exportAll(),
    report: () => buildReport(L, samples, VERSION),
    deltas: () => L.deltas.slice(),
    samples: () => JSON.parse(JSON.stringify(samples)),
    ledger: () => JSON.parse(JSON.stringify(L)),
    clear: () => { Object.assign(L, makeLedger()); for (const k of Object.keys(samples)) delete samples[k]; dirty = true; save(); },
  };

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  const boot = () => { mount(); render(); log('ready'); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
