// ==UserScript==
// @name         Politiko — Gov Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.4.0
// @description  A change ledger for the government. Records every policy axis, seat, justice, congress member and presidential number the app already fetched, and reports what moved between two readings — with the window the change happened in, never a timestamp it cannot know. Passive; zero added requests.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/gov-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/gov-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON RESPONSE bodies of calls the game client itself made, on pages you
 *             are actively viewing. Never a request body, never a header, never a token.
 *
 *               GET  /api/government             the 20 policy axes and their prose
 *                                                positions, both chambers, the
 *                                                president, the court, election dates
 *               GET  /api/factions/{id}/jobs     the same 20 axes on the app's own
 *                                                15-second poll, plus every congress
 *                                                member, the Congress cycle counter and
 *                                                the election-reform axis. Lobbying jobs
 *                                                are read for STATUS ONLY — see below
 *               GET  /api/user/status            polled by the app every 10 s anyway;
 *                                                used only for the clock and your name
 *
 *             Faction data other than the government fields is ignored: no treasury, no
 *             roster, no ledger, no inventory, no raids. From the jobs payload this tool
 *             keeps a job's id, target policy, direction, status, cycle and outcome —
 *             because a lobbying job IS a government-movement event and there is no other
 *             record of one. It does NOT keep who filled a slot, what they committed, or
 *             any username attached to a job.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. There is one `fetch` wrapper and
 *             it calls the original exactly once, to pass your own traffic through. No
 *             timer in this file touches the network. The panel's jump buttons perform
 *             the same client-side route change as clicking the game's own nav links —
 *             the app then fetches what that page needs, and only at the moment you
 *             click. Nothing is scheduled, retried, or fired while you are elsewhere.
 *
 *   Writes:   nothing to the game. This tool has never sent a POST, and the lobbying
 *             mutation shapes are deliberately absent from this file.
 *
 *   Storage:  localStorage keys prefixed `pkgw:` — the readings above, the change ledger
 *             built from them, and panel state
 *
 *   Alerts:   none. No notifications, no sound, nothing raised from an unfocused tab;
 *             the panel only redraws while the tab is visible
 *
 *   Clipboard: written ONLY when you click "copy" (tab-separated, whatever tab you are on)
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 * The measurements behind every constant here: docs/14-government-motion-surface.md.
 *
 * THE HONEST LIMITATION, STATED UP FRONT
 *
 * This tool cannot see a change it was not looking at. It compares consecutive readings
 * of the same field, and a reading only happens when the app fetches — which it does on
 * the Government screen when you open it, and every fifteen seconds while you sit on your
 * faction's Jobs tab. So a change is never known to have happened AT a time. It is known
 * to have happened BETWEEN two readings, and every row in the ledger prints that window
 * rather than a clock time. A row whose window is four days wide is drawn to look four
 * days wide, because it is.
 *
 * Refreshing anything on a timer would narrow those windows and would also be the exact
 * thing the scripting clause prohibits. The cadence is knowable instead: the client says
 * Congress runs monthly, and docs/06-time-surface.md says a game month is about fourteen
 * real hours. So the CYCLE tab projects the next boundary and gives you a button to the
 * screen — one keypress, no request this tool made.
 */

(() => {
  'use strict';

  const TAG = '[pk-gov-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { data: 'pkgw:data', ui: 'pkgw:ui' };

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // ===========================================================================
  // 1. Game constants, lifted from the client bundles (2026-08-10 pull).
  //    docs/14-government-motion-surface.md carries the evidence line by line.
  // ===========================================================================

  // GovernmentPage hardcodes both chamber sizes and both majorities in its render —
  // they are not served, so they are ours to carry.
  const SEATS = { house: { total: 435, majority: 218 }, senate: { total: 100, majority: 51 } };

  // GovernmentPage's own −3..+3 scale. Note the client ships THREE spellings of this
  // scale (the wiki table in 07, this one, and factionUtils' L/C/R). This is the one the
  // Government screen renders, so it is the one a government tool prints.
  const WORD = ['Tankie', 'Progressive', 'Moderate Left', 'Moderate', 'Moderate Right', 'Conservative', 'Fascist'];
  const SHORT = ['L++', 'L+', 'Mod-', 'Mod', 'Mod+', 'R+', 'R++'];
  const HUE = ['#1e3a8a', '#60a5fa', '#bfdbfe', '#52525b', '#fca5a5', '#f87171', '#EA0C0C'];

  const clamp3 = (v) => Math.max(-3, Math.min(3, Number.isFinite(+v) ? +v : 0));
  const bucket3 = (v) => Math.round(clamp3(v)) + 3;
  const word = (v) => WORD[bucket3(v)];
  const short = (v) => SHORT[bucket3(v)];
  const hue = (v) => HUE[bucket3(v)];

  // GovernmentPage's own wing test, and it is NOT symmetric around a single cut:
  // moderate is three buckets wide and each wing is two. A seat moving −2 → −1 leaves
  // the left tally; the same seat moving −1 → 0 changes no tally at all. That is why
  // this tool prefers the per-member feed wherever it has one.
  const WING = (a) => (a <= -2 ? 'left' : a >= 2 ? 'right' : 'mod');

  // The president's favorability render: amber under 25, rose under 10, and under 10 it
  // adds the line "Impeachment proceedings imminent". The thresholds are the client's.
  const FAV_AMBER = 25, FAV_IMPEACH = 10;

  // 06-time-surface.md: the game runs at ~52.14× real time and a game month is
  // 2_592_000 game-seconds. FactionPage calls the Congress cycle monthly and renders it
  // as "Month {N}", so a cycle is READ as a game month — inferred, not measured, and the
  // CYCLE tab says so wherever it uses this number.
  const ACCEL = 52.14;
  const GAME_MONTH_MS = Math.round(2592000 / ACCEL * 1000); // ≈ 13 h 48 m 32 s

  // The 20 policy names GovernmentPage renders, in its own order. Used to keep the LAW
  // tab stable when a reading arrives with fewer rows than the last one did.
  const POLICIES = [
    'Tax Structure', 'Abortion Rights', 'Animal Rights', 'Civil Rights', 'Healthcare',
    'Drug Law', 'Free Speech', 'Gay Rights', 'Gun Control', 'Human Rights', 'Immigration',
    'Police Regulation', 'Privacy Rights', 'Womens Rights', 'Corporate Law',
    'Election Reform', 'Labor Laws', 'Military Spending', 'Nuclear Power', 'Pollution',
  ];

  // ActivismPage files each issue under one axis; 13-world-politics-surface.md pairs the
  // policy names to it. Carried here so the LAW tab can group by axis — the pairing of
  // Human Rights↔Torture and Privacy Rights↔Intelligence is a guess, and both are social
  // either way, so no grouping here depends on which way round it is.
  const AXIS_OF = {
    'Tax Structure': 'economic', 'Corporate Law': 'economic', 'Election Reform': 'economic',
    'Labor Laws': 'economic', 'Military Spending': 'economic', 'Nuclear Power': 'economic',
    'Pollution': 'economic',
  };
  const axisOf = (name) => AXIS_OF[name] ?? 'social';

  // ===========================================================================
  // 2. The diff core. Pure functions over plain data — this is the layer
  //    userscripts/tools/test-gov.js slices out and exercises, so keep it free
  //    of DOM, storage and clocks.
  // ===========================================================================

  const num = (v) => (v == null || v === '' ? null : (Number.isFinite(+v) ? +v : null));
  const str = (v) => (v == null ? null : String(v));

  /**
   * True when a value carries a fraction the game cannot draw. GovernmentPage clamps but
   * never rounds, and every consumer keys off equality with an integer — so a policy at
   * 1.4 raises no cell, a justice at 1.4 is counted in no bucket, and factionUtils'
   * `===` chain renders anything fractional as `R++`. The client is structurally unable
   * to show these, which is a large part of why this tool prints raw values.
   */
  const isFractional = (v) => Number.isFinite(+v) && Math.round(+v) !== +v;

  /**
   * The whole engine, in one function.
   *
   * `field` holds the last CONFIRMED value of one thing plus two clocks: `t` is when we
   * last saw a reading that still said this, and `since` is when this value first
   * appeared. So when a reading disagrees, the change is bracketed by (t, now] — the old
   * value was still true at `t`, and the new one was true by `now`. That bracket is the
   * only honest statement available, and it is what gets stored on the event.
   *
   * Returns the event it recorded, or null when nothing moved. Callers push the event.
   *
   * `label` is what the event calls itself. It is separate from `key` because the store
   * needs a namespaced key (`policy:Healthcare`, `mem:101`) and the ledger needs a name a
   * person recognises — and because the LAW tab finds a policy's history by matching the
   * event's name against the policy's, which a namespaced key would silently never do.
   */
  const diffField = (store, key, next, now, label) => {
    if (next == null) return null;                 // this feed does not carry the field
    const prior = store[key];
    if (!prior) { store[key] = { v: next, t: now, since: now }; return null; } // baseline
    if (prior.v === next) { prior.t = now; return null; }                      // confirmed
    const ev = { key: label ?? key, from: prior.v, to: next, t0: prior.t, t1: now, since: prior.since };
    store[key] = { v: next, t: now, since: now };
    return ev;
  };

  /** how wide the window on a change is, in ms — the row's own honesty */
  const bracketOf = (ev) => Math.max(0, (ev?.t1 ?? 0) - (ev?.t0 ?? 0));

  /**
   * A bracket narrow enough that "as it happened" is a fair description. The faction
   * jobs feed refetches every 15 s, so anything under a minute came off that feed and
   * genuinely is live; anything wider is a gap between two times you happened to look.
   */
  const LIVE_MS = 60000;
  const isLive = (ev) => bracketOf(ev) <= LIVE_MS;

  /** chamber buckets → a {wing: seats} tally, using the client's own asymmetric cut */
  const tally = (rows) => {
    const out = { left: 0, mod: 0, right: 0, total: 0 };
    for (const r of rows || []) {
      const a = num(r?.alignment ?? r?.a), n = num(r?.count ?? r?.n) ?? 0;
      if (a == null) continue;
      out[WING(a)] += n; out.total += n;
    }
    return out;
  };

  /** the same tally from the per-member feed, which does not lose the sub-bucket moves */
  const tallyMembers = (members, chamber) => {
    const out = { left: 0, mod: 0, right: 0, total: 0, open: 0 };
    for (const m of Object.values(members || {})) {
      if (chamber && m.chamber !== chamber) continue;
      const a = num(m.a);
      if (a == null) continue;
      out[WING(a)] += 1; out.total += 1;
      if (!m.inc) out.open += 1;
    }
    return out;
  };

  /** mean alignment of a chamber's buckets — a chamber's centre of gravity */
  const centre = (rows) => {
    let sum = 0, n = 0;
    for (const r of rows || []) {
      const a = num(r?.alignment ?? r?.a), c = num(r?.count ?? r?.n) ?? 0;
      if (a == null || c <= 0) continue;
      sum += a * c; n += c;
    }
    return n ? sum / n : null;
  };

  /**
   * Project the next Congress boundary from the last rollover we actually witnessed.
   * Returns null until one has been witnessed — there is no way to know where the
   * boundary sits without having seen one cross, and guessing at it would be inventing
   * a schedule. `conf` carries the width of the bracket on that observation, because a
   * rollover seen through a four-hour gap projects a four-hour-wide boundary.
   */
  const projectCycle = (roll, now) => {
    if (!roll || roll.t1 == null) return null;
    const elapsed = now - roll.t1;
    const periods = Math.floor(elapsed / GAME_MONTH_MS) + 1;
    return {
      at: roll.t1 + periods * GAME_MONTH_MS,
      in: roll.t1 + periods * GAME_MONTH_MS - now,
      conf: bracketOf(roll),
      missed: periods - 1,      // boundaries that passed while nobody was looking
    };
  };

  // ===========================================================================
  // 3. Stored state
  // ===========================================================================

  const BLANK = {
    self: null,
    now: {},          // field key -> {v, t, since}   the diff engine's memory
    events: [],       // {kind, key, from, to, t0, t1} newest last
    desc: {},         // policy name -> its prose position, kept out of `now` (long)
    members: {},      // member id  -> {chamber, seat, a, inc, t}
    jobs: {},         // job id     -> {policy, dir, status, cycle, outcome, t}
    house: [], senate: [], court: [],
    pres: null,       // {name, a, fav, term}
    next: {},         // {cong, pres}
    cycle: null, reform: null,
    roll: null,       // the last witnessed cycle rollover event, for the projection
    seen: {},         // path -> t, for the SOURCES tab
    first: null,      // when this ledger started, so "no change" can be qualified
  };

  const CAP = { events: 900, jobs: 200 };

  const data = Object.assign({}, BLANK, readJSON(K.data, {}));
  for (const k of Object.keys(BLANK)) if (data[k] == null) data[k] = BLANK[k];

  const ui = Object.assign({
    open: false, tab: 'motion', everywhere: true, filter: 'all', quiet: false,
    x: null, y: null, fab: null, size: undefined,
  }, readJSON(K.ui, {}));

  let saveTimer = null;
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; writeJSON(K.data, data); }, 400);
  };
  const saveUI = () => writeJSON(K.ui, ui);

  /** newest-wins trim, so a long-lived ledger cannot grow without bound */
  const trimEvents = () => {
    if (data.events.length > CAP.events) data.events.splice(0, data.events.length - CAP.events);
  };

  const push = (kind, ev, extra) => {
    if (!ev) return false;
    data.events.push(Object.assign({ kind }, ev, extra || null));
    trimEvents();
    return true;
  };

  // ===========================================================================
  // 4. Ingest — one take*() per payload shape. Each returns whether anything moved.
  // ===========================================================================

  /** GET /api/government — the wide reading, and the only one carrying prose and court */
  const takeGovernment = (b, now) => {
    if (!b || !Array.isArray(b.policies)) return false;
    let touched = false;

    for (const p of b.policies) {
      const name = str(p?.policy_name);
      const a = num(p?.axis);
      if (!name || a == null) continue;
      touched = push('policy', diffField(data.now, `policy:${name}`, a, now, name)) || touched;

      // The prose position moves independently of the number, and a government that
      // rewrites its stance without moving its axis is a real event with no other record.
      const d = str(p?.description) ?? '';
      if (data.desc[name] !== undefined && data.desc[name] !== d) {
        touched = push('prose', {
          key: name, from: data.desc[name], to: d,
          t0: data.now[`policy:${name}`]?.t ?? now, t1: now,
        }) || touched;
      }
      data.desc[name] = d;
    }

    const pr = b.president;
    if (pr) {
      const name = str(pr.name);
      // A new name is not four separate changes, it is one succession. Emitting it as
      // such keeps the ledger readable and stops a new president's numbers reading as
      // the old one's collapse.
      const had = data.now['pres:name'];
      if (had && name && had.v !== name) {
        push('succession', { key: 'president', from: had.v, to: name, t0: had.t, t1: now },
          { fromA: data.now['pres:align']?.v ?? null, toA: num(pr.alignment) });
        for (const k of ['pres:align', 'pres:fav', 'pres:term']) delete data.now[k];
        data.now['pres:name'] = { v: name, t: now, since: now };
        touched = true;
      } else {
        touched = push('president', diffField(data.now, 'pres:name', name, now, 'president')) || touched;
      }
      touched = push('pres-align', diffField(data.now, 'pres:align', num(pr.alignment), now, 'president')) || touched;
      touched = push('pres-term', diffField(data.now, 'pres:term', num(pr.term_number), now, 'president')) || touched;

      const fav = num(pr.favorability);
      const favEv = diffField(data.now, 'pres:fav', fav, now, 'president');
      if (favEv) {
        // Annotate the crossings the client itself reacts to, rather than emitting a
        // second row for them — one number moved, and it moved past a line.
        const crossed = [];
        if (favEv.from >= FAV_IMPEACH && favEv.to < FAV_IMPEACH) crossed.push('impeach');
        else if (favEv.from < FAV_IMPEACH && favEv.to >= FAV_IMPEACH) crossed.push('safe');
        if (favEv.from >= FAV_AMBER && favEv.to < FAV_AMBER) crossed.push('amber');
        push('pres-fav', favEv, crossed.length ? { crossed } : null);
        touched = true;
      }
      data.pres = { name, a: num(pr.alignment), fav, term: num(pr.term_number) };
    }

    for (const ch of ['house', 'senate']) {
      const rows = Array.isArray(b[ch]) ? b[ch] : null;
      if (!rows) continue;
      const t = tally(rows);
      for (const wing of ['left', 'mod', 'right']) {
        touched = push('chamber', diffField(data.now, `${ch}:${wing}`, t[wing], now, `${ch} ${wing}`), { chamber: ch, wing }) || touched;
      }
      data[ch] = rows.map((r) => ({ a: num(r?.alignment), n: num(r?.count) ?? 0 }))
        .filter((r) => r.a != null);
    }

    if (Array.isArray(b.supreme_court)) {
      const seen = new Set();
      for (const j of b.supreme_court) {
        const id = str(j?.id) ?? str(j?.name);
        const a = num(j?.alignment);
        if (!id || a == null) continue;
        seen.add(id);
        const had = data.now[`court:${id}`];
        if (!had) {
          // Only call it an appointment once the court has been seen at all — the very
          // first reading is nine baselines, not nine appointments.
          if (data.court.length) {
            push('court-join', { key: str(j?.name) ?? id, from: null, to: a, t0: data.now['court:seen']?.t ?? now, t1: now });
            touched = true;
          }
          data.now[`court:${id}`] = { v: a, t: now, since: now };
        } else {
          touched = push('court', diffField(data.now, `court:${id}`, a, now, str(j?.name) ?? id), { name: str(j?.name) ?? id }) || touched;
        }
      }
      for (const k of Object.keys(data.now)) {
        if (!k.startsWith('court:') || k === 'court:seen') continue;
        const id = k.slice(6);
        if (seen.has(id)) continue;
        const gone = data.court.find((j) => j.id === id);
        push('court-leave', { key: gone?.name ?? id, from: data.now[k].v, to: null, t0: data.now[k].t, t1: now });
        delete data.now[k];
        touched = true;
      }
      data.now['court:seen'] = { v: seen.size, t: now, since: data.now['court:seen']?.since ?? now };
      data.court = b.supreme_court
        .map((j) => ({ id: str(j?.id) ?? str(j?.name), name: str(j?.name) ?? '?', a: num(j?.alignment) }))
        .filter((j) => j.a != null);
    }

    touched = push('election', diffField(data.now, 'next:cong', str(b.next_congressional_election), now, 'congressional election'), { which: 'congressional' }) || touched;
    touched = push('election', diffField(data.now, 'next:pres', str(b.next_presidential_election), now, 'presidential election'), { which: 'presidential' }) || touched;
    data.next = { cong: str(b.next_congressional_election), pres: str(b.next_presidential_election) };

    return touched;
  };

  /**
   * GET /api/factions/{id}/jobs — the live feed. Carries the same policy axes on the
   * app's own 15-second poll, every congress member, the cycle counter, and the jobs.
   * It has no prose, no court and no president, so it updates a strict subset.
   */
  const takeJobs = (b, now) => {
    if (!b || typeof b !== 'object') return false;
    let touched = false;

    if (Array.isArray(b.policies)) {
      for (const p of b.policies) {
        const name = str(p?.policy_name), a = num(p?.axis);
        if (!name || a == null) continue;
        touched = push('policy', diffField(data.now, `policy:${name}`, a, now, name)) || touched;
      }
    }

    touched = push('reform', diffField(data.now, 'reform', num(b.election_reform_axis), now, 'Election Reform')) || touched;
    if (num(b.election_reform_axis) != null) data.reform = num(b.election_reform_axis);

    // The cycle counter rolling over is the heartbeat, and witnessing one is the only
    // way to place the boundary in real time. Keep the event itself, not just the value.
    const cyc = str(b.next_cycle_month);
    const cycEv = diffField(data.now, 'cycle', cyc, now, 'cycle');
    if (cycEv) {
      push('cycle', cycEv);
      data.roll = { t0: cycEv.t0, t1: cycEv.t1, from: cycEv.from, to: cycEv.to };
      touched = true;
    }
    if (cyc != null) data.cycle = cyc;

    if (Array.isArray(b.congress_members)) {
      const seen = new Set();
      const known = Object.keys(data.members).length;
      for (const m of b.congress_members) {
        const id = str(m?.id);
        const a = num(m?.alignment);
        if (!id || a == null) continue;
        seen.add(id);
        const chamber = str(m?.chamber) ?? '?';
        const seat = num(m?.seat_number);
        const inc = !!m?.incumbent;
        const label = `${chamber === 'house' ? 'House' : 'Senate'} ${seat ?? '?'}`;

        if (known) {
          touched = push('member', diffField(data.now, `mem:${id}`, a, now, label), { seat: label, chamber }) || touched;
          const hadInc = data.now[`inc:${id}`];
          if (hadInc && hadInc.v !== inc) {
            push('seat', { key: label, from: hadInc.v ? 'incumbent' : 'open', to: inc ? 'incumbent' : 'open', t0: hadInc.t, t1: now }, { chamber });
            touched = true;
          }
        }
        data.now[`mem:${id}`] = data.now[`mem:${id}`] ?? { v: a, t: now, since: now };
        data.now[`mem:${id}`].v = a; data.now[`mem:${id}`].t = now;
        data.now[`inc:${id}`] = { v: inc, t: now, since: data.now[`inc:${id}`]?.since ?? now };
        data.members[id] = { chamber, seat, a, inc, t: now };
      }
      // A member vanishing from a full roster reading is a seat change worth a row; a
      // partial reading is not evidence of anyone leaving, so require a full-looking one.
      if (seen.size >= Math.min(known, 20)) {
        for (const id of Object.keys(data.members)) {
          if (seen.has(id)) continue;
          const m = data.members[id];
          push('seat', {
            key: `${m.chamber === 'house' ? 'House' : 'Senate'} ${m.seat ?? '?'}`,
            from: short(m.a), to: null, t0: m.t, t1: now,
          }, { chamber: m.chamber, left: true });
          delete data.members[id]; delete data.now[`mem:${id}`]; delete data.now[`inc:${id}`];
          touched = true;
        }
      }
    }

    // Lobbying jobs, status only. A job IS a push on a policy axis, so its lifecycle is
    // the closest thing the client has to a legislative record. Nothing about who filled
    // a slot or what they committed is read or stored.
    if (Array.isArray(b.jobs)) {
      for (const j of b.jobs) {
        const id = str(j?.id);
        if (!id || str(j?.job_type) !== 'lobbying') continue;
        const status = str(j?.status) ?? '?';
        const meta = j?.result_metadata || {};
        const rec = {
          policy: str(j?.target_policy_name), dir: str(j?.direction),
          status, cycle: str(j?.cycle_month), outcome: str(meta.outcome), t: now,
        };
        const had = data.jobs[id];
        if (had && had.status !== status) {
          push('job', { key: rec.policy ?? `#${id}`, from: had.status, to: status, t0: had.t, t1: now },
            { dir: rec.dir, cycle: rec.cycle, outcome: rec.outcome, job: id });
          touched = true;
        }
        data.jobs[id] = rec;
      }
      const ids = Object.keys(data.jobs);
      if (ids.length > CAP.jobs) {
        ids.sort((a, c) => (data.jobs[a].t || 0) - (data.jobs[c].t || 0))
          .slice(0, ids.length - CAP.jobs).forEach((k) => delete data.jobs[k]);
      }
    }

    return touched;
  };

  const pathOf = (u) => { try { return new URL(u, location.href).pathname; } catch { return ''; } };

  /** collapse the variable part of a path so the SOURCES table has one row per shape */
  const seenKey = (path) => path.replace(/\/\d+/g, '/{id}');

  const consume = (path, url, body) => {
    const now = Date.now();
    let touched = false;

    // Freshness is recorded ONLY for the three paths this tool declares. A blanket
    // `seen[path] = now` would look harmless and would in fact keep a list of every API
    // route the app touched — including `/api/users/<name>`, which puts other players'
    // usernames in this tool's storage as a side effect of a timestamp. The disclosure
    // says three endpoints, so three is what gets written down.
    let known = true;
    if (path === '/api/user/status') {
      if (typeof body?.username === 'string' && body.username !== data.self) { data.self = body.username; touched = true; }
    } else if (path === '/api/government') {
      touched = takeGovernment(body, now) || touched;
    } else if (/^\/api\/factions\/[^/]+\/jobs$/.test(path)) {
      touched = takeJobs(body, now) || touched;
    } else known = false;

    if (!known) return;
    data.seen[seenKey(path)] = now;
    if (data.first == null) { data.first = now; touched = true; }

    if (touched) { save(); scheduleRender(); }
  };

  // ===========================================================================
  // 5. The tap. One wrapper, one call to the original, nothing else.
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
            res.clone().json().then((parsed) => { try { consume(path, url, parsed); } catch (e) { log('consume error', e); } }, () => {});
          }
        } catch (e) { log('tap error', e); }
        return res;
      });
    } catch (e) { log('tap error', e); }
    return p;
  };

  // ===========================================================================
  // 6. Panel
  // ===========================================================================

  let root = null, panel = null, head = null, body = null, fab = null;
  let title = null, drag = null, fabDrag = null, resize = null;

  const CSS = `
    /* FAB KIT v7 — shared verbatim block.
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

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 16; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       a sixteenth tool does not shuffle the fifteen buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. The eye
       leads because it is the mark of the set; the words are alphabetical after it:

         0  the eye  people-watch     8  TIME  time-watch
         1  ALGN     align-watch      9  WRLD  world-watch
         2  GOV      gov-watch       10  XP    xp-watch
         3  JUMP     quick-jump      11  POLL  poll-watch
         4  MKT      market-watch    12  SHOP  shop-watch
         5  RAID     raid-watch      13  BARS  bar-watch
         6  SLP      sleeper-watch   14  SLOT  slot-watch
         7  SOCK     ws-watch        15  JACK  jack-watch

       POLL, SHOP, BARS, SLOT and JACK are on the end rather than sorted in among
       the others, and that is deliberate: the alphabet describes how the first
       eleven were handed out, not a sort to be re-run. Slots are fixed, so a tool
       that arrives later takes the next free number and nothing already on screen

       Sixteen 38px buttons 8px apart is a 728px row, so it runs 364px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1608px the row is centred,
       and below that it stops sliding left rather than climb onto the nav.

       Three numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 364 (half the row). Nothing else in here is placement.

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
      left: calc(max(440px, 50% - 364px) + var(--pk-slot, 0) * 46px);
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
    .pkgw-fab { --pk-slot: 2; z-index: 2147482000; }
    .pkgw-fab[data-new="1"] { border-color: #fbbf24; color: #fbbf24; }
    .pkgw-panel { position: fixed; left: 12px; bottom: 202px; z-index: 2147482000;
      width: min(380px, calc(100vw - 24px)); max-height: min(80vh, 820px);
      display: flex; flex-direction: column;
      border: 1px solid #3f3f46; border-radius: 8px; background: #09090bf2; color: #e4e4e7;
      font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .pkgw-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
      border-bottom: 1px solid #27272a; user-select: none; }
    .pkgw-head h1 { flex: 1; font-size: 11px; margin: 0; color: #a1a1aa;
      text-transform: uppercase; letter-spacing: .08em; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .pkgw-tabs { display: flex; gap: 0; border-bottom: 1px solid #27272a; }
    .pkgw-tab { flex: 1; background: none; border: 0; border-bottom: 2px solid transparent;
      color: #71717a; font: inherit; font-size: 10px; letter-spacing: .1em;
      text-transform: uppercase; padding: 6px 2px; cursor: pointer; }
    .pkgw-tab:hover { color: #d4d4d8; }
    .pkgw-tab[data-on="1"] { color: #e4e4e7; border-bottom-color: #60a5fa; }
    .pkgw-btn { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
      border-radius: 4px; font: inherit; font-size: 10.5px; padding: 1px 6px; cursor: pointer; }
    .pkgw-btn:hover { background: #3f3f46; }
    .pkgw-btn[data-on="1"] { border-color: #fbbf24; color: #fbbf24; }
    .pkgw-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px; }
    .pkgw-h2 { margin: 12px 0 5px; font-size: 10px; letter-spacing: .1em; color: #71717a;
      text-transform: uppercase; }
    .pkgw-h2:first-child { margin-top: 0; }
    .pkgw-row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .pkgw-dim { color: #a1a1aa; }
    .pkgw-faint { color: #71717a; }
    .pkgw-note { color: #71717a; font-size: 10.5px; line-height: 1.5; margin: 10px 0 0;
      border-top: 1px solid #27272a; padding-top: 8px; }
    .pkgw-warn { color: #fbbf24; }
    .pkgw-tbl { width: 100%; border-collapse: collapse; }
    .pkgw-tbl td { padding: 2px 0; vertical-align: baseline; }
    .pkgw-tbl td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pkgw-tbl tr[data-off="1"] { opacity: .45; }
    .pkgw-ev { border-left: 2px solid #27272a; padding: 3px 0 3px 7px; margin: 0 0 3px; }
    .pkgw-ev[data-live="1"] { border-left-color: #4ade80; }
    .pkgw-ev[data-big="1"] { border-left-color: #fbbf24; }
    .pkgw-ev .w { color: #52525b; font-size: 10px; }
    .pkgw-bar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; margin: 2px 0 0; }
    .pkgw-cell { height: 5px; border-radius: 2px; background: #27272a; }
    .pkgw-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 8px; }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const sign1 = (v) => (v == null ? '—' : (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)));
  const sign2 = (v) => (v == null ? '—' : (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)));
  const plain = (v) => (v == null ? '—' : (isFractional(v) ? (+v).toFixed(2) : String(v)));

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

  const ago = (ms) => (ms ? dur(Date.now() - ms) : 'never');

  const when = (ms) => {
    if (!ms) return '—';
    try { return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return String(ms); }
  };

  const jump = (href) => {
    if (location.pathname === href) return;
    const st = history.state;
    const idx = (st && Number.isFinite(st.idx) ? st.idx : 0) + 1;
    history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', href);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  };

  const jumpBtn = (label, href, why) => {
    const b = el('button', 'pkgw-btn', label);
    b.title = `${why}\nSame client-side navigation as clicking the game's own link. The app fetches what that page needs, and only because you clicked.`;
    b.addEventListener('click', () => jump(href));
    return b;
  };

  const h2 = (text) => el('p', 'pkgw-h2', text);

  /** the seven-cell policy bar GovernmentPage draws, with the current cell raised */
  const bar = (v) => {
    const w = el('div', 'pkgw-bar');
    const t = clamp3(v);
    for (let i = -3; i <= 3; i++) {
      const c = el('div', 'pkgw-cell');
      const d = Math.abs(i - Math.round(t));
      if (d === 0) { c.style.height = '8px'; c.style.background = hue(t); }
      else if (d === 1) c.style.background = `${hue(t)}38`;
      w.append(c);
    }
    return w;
  };

  /** whether the live feed is actually live right now */
  const liveNow = () => {
    const t = data.seen['/api/factions/{id}/jobs'];
    return t && Date.now() - t < 45000;
  };

  const EVENT_GROUPS = {
    all: () => true,
    law: (e) => e.kind === 'policy' || e.kind === 'prose' || e.kind === 'reform' || e.kind === 'job',
    seats: (e) => e.kind === 'chamber' || e.kind === 'member' || e.kind === 'seat' || e.kind === 'court'
      || e.kind === 'court-join' || e.kind === 'court-leave',
    exec: (e) => e.kind === 'succession' || e.kind === 'president' || e.kind === 'pres-align'
      || e.kind === 'pres-fav' || e.kind === 'pres-term' || e.kind === 'election',
  };

  /** one ledger row's sentence — the whole readability of the tool lives here */
  const describe = (e) => {
    const k = e.kind;
    if (k === 'policy') return [`${e.key}`, `${sign1(e.from)} → ${sign1(e.to)}`, `${short(e.from)} → ${short(e.to)}`];
    if (k === 'prose') return [`${e.key} — position rewritten`, '', e.to ? `now: ${e.to}` : 'position cleared'];
    if (k === 'reform') return ['Election Reform axis', `${sign1(e.from)} → ${sign1(e.to)}`, 'the lobbying header\'s own stat'];
    if (k === 'succession') return [`New president: ${e.to}`, '', `replaced ${e.from}${e.toA != null ? ` · ${word(e.toA)}` : ''}`];
    if (k === 'president') return [`President: ${e.to}`, '', 'first reading'];
    if (k === 'pres-align') return ['President alignment', `${sign1(e.from)} → ${sign1(e.to)}`, `${word(e.from)} → ${word(e.to)}`];
    if (k === 'pres-term') return ['Presidential term', `${e.from} → ${e.to}`, 'term number advanced'];
    if (k === 'pres-fav') {
      const tail = (e.crossed || []).includes('impeach') ? 'below 10% — impeachment proceedings imminent'
        : (e.crossed || []).includes('amber') ? 'below 25%'
          : (e.crossed || []).includes('safe') ? 'back above 10%' : '';
      return ['Approval', `${e.from}% → ${e.to}%`, tail];
    }
    if (k === 'chamber') return [`${e.chamber === 'house' ? 'House' : 'Senate'} · ${e.wing}`, `${e.from} → ${e.to}`, `${e.to > e.from ? '+' : ''}${e.to - e.from} seats in this wing`];
    if (k === 'member') return [`${e.seat}`, `${sign1(e.from)} → ${sign1(e.to)}`, `${short(e.from)} → ${short(e.to)}`];
    if (k === 'seat') return [`${e.key}`, '', e.left ? 'no longer on the roster' : `${e.from} → ${e.to}`];
    if (k === 'court') return [`Justice ${e.name}`, `${sign1(e.from)} → ${sign1(e.to)}`, `${short(e.from)} → ${short(e.to)}`];
    if (k === 'court-join') return [`Justice ${e.key} seated`, sign1(e.to), word(e.to)];
    if (k === 'court-leave') return [`Justice ${e.key} left the court`, sign1(e.from), ''];
    if (k === 'election') return [`Next ${e.which} election`, '', `${e.from} → ${e.to}`];
    if (k === 'cycle') return ['Congress cycle', `Month ${e.from} → ${e.to}`, 'a cycle resolved in this window'];
    if (k === 'job') {
      const tail = e.outcome ? `outcome: ${String(e.outcome).replaceAll('_', ' ')}` : `cycle ${e.cycle ?? '—'}`;
      return [`Lobbying · ${e.key}`, `${e.from} → ${e.to}`, `push ${e.dir ?? '?'} · ${tail}`];
    }
    return [k, `${e.from} → ${e.to}`, ''];
  };

  const BIG = new Set(['succession', 'cycle', 'court-join', 'court-leave']);

  const eventNode = (e) => {
    const [headline, delta, tail] = describe(e);
    const n = el('div', 'pkgw-ev');
    n.dataset.live = isLive(e) ? '1' : '0';
    if (BIG.has(e.kind) || (e.crossed || []).includes('impeach')) n.dataset.big = '1';

    const top = el('div', 'pkgw-row');
    const lab = el('span', null, headline);
    if ((e.crossed || []).includes('impeach')) lab.className = 'pkgw-warn';
    top.append(lab, el('span', 'pkgw-dim', delta));
    n.append(top);

    if (tail) n.append(el('div', 'pkgw-faint', tail));

    // The bracket, always. This is the row's honesty and it is never omitted: a change
    // seen through a four-day gap has to look like one.
    const w = bracketOf(e);
    const line = el('div', 'w', isLive(e)
      ? `${when(e.t1)} · seen live (${dur(w)} window)`
      : `between ${when(e.t0)} and ${when(e.t1)} · ${dur(w)} window`);
    line.title = isLive(e)
      ? 'Both readings came off the faction Jobs feed, which the app refetches every 15 s. This is as close to "as it happened" as the game permits.'
      : 'The old value was still true at the first time, and the new one was true by the second. The change happened somewhere in between — this tool cannot narrow it further without asking, and it will not ask.';
    n.append(line);
    return n;
  };

  // ---------------------------------------------------------------------------
  // MOTION — the ledger
  // ---------------------------------------------------------------------------
  const renderMotion = (out) => {
    const chips = el('div', 'pkgw-chips');
    for (const [key, label] of [['all', 'everything'], ['law', 'the law'], ['seats', 'seats'], ['exec', 'executive']]) {
      const b = el('button', 'pkgw-btn', label);
      b.dataset.on = ui.filter === key ? '1' : '0';
      b.addEventListener('click', () => { ui.filter = key; saveUI(); render(); });
      chips.append(b);
    }
    const q = el('button', 'pkgw-btn', 'live only');
    q.dataset.on = ui.quiet ? '1' : '0';
    q.title = 'Show only changes whose window was under a minute — the ones the 15-second faction feed caught as they happened';
    q.addEventListener('click', () => { ui.quiet = !ui.quiet; saveUI(); render(); });
    chips.append(q);
    out.append(chips);

    const pass = EVENT_GROUPS[ui.filter] ?? EVENT_GROUPS.all;
    const rows = data.events.filter((e) => pass(e) && (!ui.quiet || isLive(e))).slice(-200).reverse();

    if (!rows.length) {
      out.append(el('p', 'pkgw-faint', data.first
        ? `Nothing has moved since ${when(data.first)} in this view — or nothing you were looking at has. `
          + 'The ledger only records changes between two readings, so a quiet list means either a quiet government or a quiet operator.'
        : 'Nothing recorded yet. Open the Government screen once to lay a baseline; every later reading is compared against it.'));
      const j = el('div', 'pkgw-chips');
      j.append(jumpBtn('Government', '/government', 'the wide reading — policies, chambers, court, president'));
      out.append(j);
      return;
    }

    let day = null;
    for (const e of rows) {
      const d = new Date(e.t1).toDateString();
      if (d !== day) { day = d; out.append(h2(d)); }
      out.append(eventNode(e));
    }

    if (data.events.length > rows.length) {
      out.append(el('p', 'pkgw-faint', `${data.events.length - rows.length} more not shown by this filter.`));
    }
  };

  // ---------------------------------------------------------------------------
  // LAW — the 20 axes as they stand, with drift since first seen
  // ---------------------------------------------------------------------------
  const renderLaw = (out) => {
    const names = new Set(POLICIES);
    for (const k of Object.keys(data.now)) if (k.startsWith('policy:')) names.add(k.slice(7));

    const known = [...names].filter((n) => data.now[`policy:${n}`]);
    if (!known.length) {
      out.append(el('p', 'pkgw-faint',
        'No policy axis recorded yet. The Government screen carries all twenty with their written positions; '
        + 'your faction\'s Jobs tab carries the same twenty numbers and refetches them every fifteen seconds.'));
      const j = el('div', 'pkgw-chips');
      j.append(jumpBtn('Government', '/government', 'all 20 axes, with prose'));
      out.append(j);
      return;
    }

    const frac = known.filter((n) => isFractional(data.now[`policy:${n}`].v));
    if (frac.length) {
      out.append(el('p', 'pkgw-warn',
        `${frac.length} ${frac.length === 1 ? 'axis is' : 'axes are'} fractional: ${frac.join(', ')}. `
        + 'The game clamps but never rounds, so its own bar raises no cell for these — this is motion the client cannot draw.'));
    }

    for (const axis of ['social', 'economic']) {
      const rows = known.filter((n) => axisOf(n) === axis)
        .sort((a, b) => (data.now[`policy:${b}`].v - data.now[`policy:${a}`].v));
      if (!rows.length) continue;
      out.append(h2(`${axis} · ${rows.length}`));
      const t = el('table', 'pkgw-tbl');
      for (const name of rows) {
        const f = data.now[`policy:${name}`];
        const moves = data.events.filter((e) => e.kind === 'policy' && e.key === name);
        const firstV = moves.length ? moves[0].from : f.v;
        const drift = f.v - firstV;

        const tr = document.createElement('tr');
        const nameCell = el('td', null, name);
        nameCell.title = data.desc[name] ? data.desc[name] : 'No position set';
        const val = el('td', 'n', plain(f.v));
        val.style.color = hue(f.v);
        val.title = `${word(f.v)} · ${short(f.v)}\nheld this value for ${ago(f.since)}`;
        const dr = el('td', 'n', moves.length ? sign1(drift) : '·');
        dr.title = moves.length
          ? `${moves.length} recorded move${moves.length === 1 ? '' : 's'} · last ${ago(moves[moves.length - 1].t1)} ago`
          : 'no move recorded since this tool first saw it';
        if (drift) dr.style.color = drift > 0 ? '#f87171' : '#60a5fa';
        tr.append(nameCell, val, dr);
        t.append(tr);

        const brow = document.createElement('tr');
        const bcell = document.createElement('td');
        bcell.colSpan = 3;
        bcell.append(bar(f.v));
        brow.append(bcell);
        t.append(brow);
      }
      out.append(t);
    }

    const jobs = Object.entries(data.jobs).filter(([, j]) => j.status !== 'resolved' && j.status !== 'failed' && j.status !== 'cancelled');
    if (jobs.length) {
      out.append(h2(`lobbying in flight · ${jobs.length}`));
      const t = el('table', 'pkgw-tbl');
      for (const [id, j] of jobs) {
        const tr = document.createElement('tr');
        tr.append(el('td', null, j.policy ?? `#${id}`),
          el('td', 'n', j.dir === 'right' ? '→ R' : '← L'),
          el('td', 'n', j.status));
        t.append(tr);
      }
      out.append(t);
    }

    out.append(el('p', 'pkgw-note',
      'Δ is measured from the first value this ledger ever saw, not from the start of the game — a blank Δ means '
      + 'the axis has not moved while anyone was watching. Hover a name for its written position, a number for how long it has held.'));
  };

  // ---------------------------------------------------------------------------
  // SEATS — chambers, court, president
  // ---------------------------------------------------------------------------
  const renderSeats = (out) => {
    if (data.pres) {
      out.append(h2('executive'));
      const t = el('table', 'pkgw-tbl');
      const r1 = document.createElement('tr');
      r1.append(el('td', null, data.pres.name ?? '—'),
        el('td', 'n', sign1(data.pres.a)),
        el('td', 'n', word(data.pres.a)));
      t.append(r1);
      const r2 = document.createElement('tr');
      const fav = el('td', 'n', data.pres.fav == null ? '—' : `${data.pres.fav}%`);
      if (data.pres.fav != null && data.pres.fav < FAV_IMPEACH) fav.className = 'n pkgw-warn';
      else if (data.pres.fav != null && data.pres.fav < FAV_AMBER) { fav.className = 'n'; fav.style.color = '#fbbf24'; }
      r2.append(el('td', 'pkgw-faint', `term ${data.pres.term ?? '—'}`), fav,
        el('td', 'n pkgw-faint', 'approval'));
      t.append(r2);
      out.append(t);
      if (data.pres.fav != null && data.pres.fav < FAV_IMPEACH) {
        out.append(el('p', 'pkgw-warn', 'Impeachment proceedings imminent — the client\'s own words below 10%.'));
      }
    }

    const live = Object.keys(data.members).length;
    let partial = false;
    for (const ch of ['house', 'senate']) {
      const rows = data[ch];
      const roster = live ? tallyMembers(data.members, ch) : null;
      const spec = SEATS[ch];

      // The chamber tally comes from the SERVER'S buckets, which cover every seat. The
      // per-member roster is a different thing: it is however many members the lobbying
      // screen listed, and nothing promises that is the whole chamber. Printing a
      // twelve-member sample as "the House" under a heading that says 435 seats would be
      // the most confident kind of wrong, so the two are kept apart — buckets tally the
      // chamber, the roster reports only its own size.
      const seats = rows.length ? tally(rows) : null;
      const shown = seats ?? roster;
      if (!shown || !shown.total) continue;
      const sampled = !seats && roster;
      if (sampled) partial = true;

      out.append(h2(`${ch} · ${spec.total} seats · ${spec.majority} majority`));

      const t = el('table', 'pkgw-tbl');
      const tr = document.createElement('tr');
      const L = el('td', 'n', String(shown.left)); L.style.color = hue(-2);
      const M = el('td', 'n', String(shown.mod)); M.style.color = hue(0);
      const R = el('td', 'n', String(shown.right)); R.style.color = hue(2);
      tr.append(el('td', 'pkgw-faint', 'left'), L, el('td', 'pkgw-faint', 'mod'), M,
        el('td', 'pkgw-faint', 'right'), R);
      t.append(tr);
      out.append(t);

      const bits = [];
      if (sampled) {
        // No bucket reading yet: say what these numbers actually are rather than letting
        // them read as the chamber.
        bits.push(`${shown.total} of ${spec.total} seats seen — not the chamber`);
      } else {
        const c = centre(rows);
        if (c != null) bits.push(`centre of gravity ${sign2(c)}`);
        if (shown.left >= spec.majority) bits.push('left holds a majority');
        else if (shown.right >= spec.majority) bits.push('right holds a majority');
        else bits.push('no wing holds a majority');
        if (shown.total !== spec.total) bits.push(`buckets sum to ${shown.total}`);
      }
      if (roster && roster.total) {
        bits.push(`${roster.total} member${roster.total === 1 ? '' : 's'} tracked by name${roster.open ? `, ${roster.open} open` : ''}`);
      }
      out.append(el('p', 'pkgw-faint', bits.join(' · ')));
    }

    if (partial) {
      out.append(el('p', 'pkgw-faint',
        'Those wing counts are the members your faction\'s lobbying screen listed, not the chamber — open the '
        + 'Government screen once and the server\'s own all-seat buckets replace them.'));
    } else if (!live && (data.house.length || data.senate.length)) {
      out.append(el('p', 'pkgw-faint',
        'Chamber figures are the Government screen\'s pre-aggregated buckets. Because its wings cut at ±2 and '
        + 'moderate spans three buckets, a seat can move without moving any tally — your faction\'s Jobs tab '
        + 'carries the per-member roster that does not lose those.'));
    }

    if (data.court.length) {
      out.append(h2(`supreme court · ${data.court.length}`));
      const t = el('table', 'pkgw-tbl');
      for (const j of [...data.court].sort((a, b) => a.a - b.a)) {
        const tr = document.createElement('tr');
        const v = el('td', 'n', plain(j.a));
        v.style.color = hue(j.a);
        const w = el('td', 'n', short(j.a));
        w.style.color = hue(j.a);
        tr.append(el('td', null, j.name), v, w);
        t.append(tr);
      }
      out.append(t);
      const lean = data.court.reduce((s, j) => s + j.a, 0) / data.court.length;
      out.append(el('p', 'pkgw-faint', `court leans ${sign2(lean)} · ${word(lean)}`));
    }

    if (data.next.cong || data.next.pres) {
      out.append(h2('next elections'));
      const t = el('table', 'pkgw-tbl');
      for (const [label, v] of [['congressional', data.next.cong], ['presidential', data.next.pres]]) {
        if (!v) continue;
        const tr = document.createElement('tr');
        tr.append(el('td', null, label), el('td', 'n', v));
        t.append(tr);
      }
      out.append(t);
    }

    // Only when the tab drew nothing at all. The roster alone is enough to fill it, and
    // following a rendered chamber with "nothing recorded yet" reads as a bug.
    if (!data.pres && !data.court.length && !data.house.length && !data.senate.length && !live) {
      out.append(el('p', 'pkgw-faint', 'Nothing recorded yet — only the Government screen carries the chambers, the court and the president.'));
      const j = el('div', 'pkgw-chips');
      j.append(jumpBtn('Government', '/government', 'chambers, court, president, elections'));
      out.append(j);
    }
  };

  // ---------------------------------------------------------------------------
  // CYCLE — the heartbeat, and how much of it you are seeing
  // ---------------------------------------------------------------------------
  const renderCycle = (out) => {
    out.append(h2('congress cycle'));

    const t = el('table', 'pkgw-tbl');
    const row = (k, v, why) => {
      const tr = document.createElement('tr');
      const a = el('td', null, k);
      if (why) a.title = why;
      tr.append(a, el('td', 'n', v));
      t.append(tr);
    };
    row('next cycle', data.cycle != null ? `Month ${data.cycle}` : '—',
      'FactionPage renders this as "Month {N}" in the lobbying header. It is the cycle a lock lands in.');
    row('a game month', dur(GAME_MONTH_MS), `2,592,000 game-seconds at ${ACCEL}× real time — docs/06-time-surface.md`);
    if (data.reform != null) row('election reform axis', plain(data.reform), 'promoted to its own card beside the cycle; the client gives no reason why');
    out.append(t);

    const proj = projectCycle(data.roll, Date.now());
    if (proj) {
      out.append(h2('projection'));
      const p = el('table', 'pkgw-tbl');
      const pr = (k, v) => { const tr = document.createElement('tr'); tr.append(el('td', null, k), el('td', 'n', v)); p.append(tr); };
      pr('next boundary in', dur(proj.in));
      pr('at about', when(proj.at));
      pr('confidence', `±${dur(proj.conf)}`);
      if (proj.missed > 0) pr('boundaries missed', String(proj.missed));
      out.append(p);
      out.append(el('p', 'pkgw-faint',
        `Projected forward from the one rollover this tool actually witnessed (${when(data.roll.t1)}), `
        + `assuming a cycle is a game month. The ± is the width of the window on that observation — `
        + 'it does not shrink with time, and nothing here re-checks it.'));
    } else {
      out.append(el('p', 'pkgw-faint',
        'No rollover witnessed yet, so there is nothing to project from. The boundary can only be placed by '
        + 'having seen the counter cross while you were watching — the faction Jobs tab polls every fifteen '
        + 'seconds, so sitting on it is what catches one.'));
    }

    out.append(h2('resolution'));
    const feeds = el('table', 'pkgw-tbl');
    const feed = (label, path, note) => {
      const tr = document.createElement('tr');
      const seen = data.seen[path];
      const a = el('td', null, label); a.title = note;
      tr.dataset.off = seen ? '0' : '1';
      tr.append(a, el('td', 'n', seen ? `${ago(seen)} ago` : 'never'));
      feeds.append(tr);
    };
    feed('faction jobs · every 15s', '/api/factions/{id}/jobs',
      'refetchInterval: 15e3 — the only live feed of the law in the game. Carries the 20 axes, every congress member and the cycle counter.');
    feed('government · on open', '/api/government',
      'staleTime: 6e4 and no refetch interval — this one only arrives when you open the screen.');
    out.append(feeds);

    const l = liveNow();
    out.append(el('p', l ? 'pkgw-faint' : 'pkgw-warn', l
      ? 'Live now: the faction feed has reported within the last 45 seconds, so the law and the roster are current to within fifteen.'
      : 'Not live: nothing is polling. Every figure is as old as the last time you looked at the screen carrying it.'));

    const j = el('div', 'pkgw-chips');
    j.append(jumpBtn('Government', '/government', 'the wide reading, and the only one with prose, court and president'));
    j.append(jumpBtn('Faction', '/faction', 'the Jobs tab is the 15-second feed — open it and leave it open'));
    out.append(j);

    out.append(el('p', 'pkgw-note',
      'That a cycle is a GAME month is inferred, not measured: the client renders "Month {N}" with no year and '
      + 'no real date, in a game whose only calendar is its own. One field observation settles it. Until then '
      + 'every countdown on this tab is a projection with its assumption attached — see '
      + 'docs/14-government-motion-surface.md.'));
  };

  // ---------------------------------------------------------------------------
  // SOURCES
  // ---------------------------------------------------------------------------
  const SOURCES = [
    ['/api/government', 'policies + prose, chambers, court, president, elections', '/government', 'Government'],
    ['/api/factions/{id}/jobs', 'policies, congress members, cycle, lobbying status', '/faction', 'Faction'],
    ['/api/user/status', 'your name only — the app polls this every 10s anyway', null, null],
  ];

  const renderSources = (out) => {
    out.append(h2('what fills what'));
    const t = el('table', 'pkgw-tbl');
    for (const [path, why, href, label] of SOURCES) {
      const tr = document.createElement('tr');
      const seen = data.seen[path];
      tr.dataset.off = seen ? '0' : '1';
      const a = el('td', null, path.replace('/api/', ''));
      a.title = why;
      const b = el('td', 'n', seen ? `${ago(seen)} ago` : 'never');
      tr.append(a, b);
      if (href) {
        const c = document.createElement('td');
        c.style.textAlign = 'right';
        c.append(jumpBtn(label, href, why));
        tr.append(c);
      } else tr.append(document.createElement('td'));
      t.append(tr);
    }
    out.append(t);

    out.append(h2('held'));
    const h = el('table', 'pkgw-tbl');
    const hr = (k, v, why) => {
      const tr = document.createElement('tr');
      const a = el('td', null, k); if (why) a.title = why;
      tr.append(a, el('td', 'n', v)); h.append(tr);
    };
    hr('recorded changes', String(data.events.length), `capped at ${CAP.events}, oldest dropped first`);
    hr('policy axes', String(Object.keys(data.now).filter((k) => k.startsWith('policy:')).length));
    hr('congress members', String(Object.keys(data.members).length));
    hr('justices', String(data.court.length));
    hr('lobbying jobs', String(Object.keys(data.jobs).length), 'status only — no slot, no username, no committed resources');
    hr('ledger began', data.first ? when(data.first) : '—');
    out.append(h);

    const tools = el('div', 'pkgw-chips');
    const copy = el('button', 'pkgw-btn', 'copy');
    copy.title = 'Copy the current tab as tab-separated text';
    copy.addEventListener('click', () => {
      const lines = [];
      if (ui.tab === 'motion') {
        lines.push(['when_from', 'when_to', 'window_ms', 'kind', 'what', 'from', 'to'].join('\t'));
        for (const e of data.events) {
          lines.push([new Date(e.t0).toISOString(), new Date(e.t1).toISOString(), bracketOf(e),
            e.kind, describe(e)[0], e.from ?? '', e.to ?? ''].join('\t'));
        }
      } else {
        lines.push(['policy', 'axis', 'axis_word', 'held_since'].join('\t'));
        for (const k of Object.keys(data.now)) {
          if (!k.startsWith('policy:')) continue;
          const f = data.now[k];
          lines.push([k.slice(7), f.v, word(f.v), new Date(f.since).toISOString()].join('\t'));
        }
      }
      const text = lines.join('\n');
      navigator.clipboard?.writeText(text).then(
        () => { copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy'; }, 1200); },
        () => { copy.textContent = 'blocked'; setTimeout(() => { copy.textContent = 'copy'; }, 1200); },
      );
    });
    tools.append(copy);

    const wipe = el('button', 'pkgw-btn', 'forget everything');
    wipe.title = 'Clear the ledger and every stored reading. There is no undo, and nothing is re-fetched to replace it.';
    wipe.addEventListener('click', () => {
      if (wipe.dataset.on !== '1') { wipe.dataset.on = '1'; wipe.textContent = 'really?'; setTimeout(() => { wipe.dataset.on = '0'; wipe.textContent = 'forget everything'; }, 3000); return; }
      for (const k of Object.keys(BLANK)) data[k] = Array.isArray(BLANK[k]) ? [] : (BLANK[k] && typeof BLANK[k] === 'object' ? {} : BLANK[k]);
      writeJSON(K.data, data);
      render();
    });
    tools.append(wipe);
    out.append(tools);

    out.append(el('p', 'pkgw-note',
      'This tool adds no requests. Both feeds above are polls the app makes on its own — one when you open the '
      + 'Government screen, one every fifteen seconds while your faction\'s Jobs tab is open. Nothing here '
      + 'refreshes, retries, or fires while you are elsewhere, and the jump buttons are the same client-side '
      + 'navigation as clicking the game\'s own links.'));
  };

  // ---------------------------------------------------------------------------

  const TABS = [
    ['motion', 'motion', renderMotion],
    ['law', 'law', renderLaw],
    ['seats', 'seats', renderSeats],
    ['cycle', 'cycle', renderCycle],
    ['sources', 'sources', renderSources],
  ];

  const render = () => {
    if (!body || document.hidden || !ui.open) return;
    body.textContent = '';
    const tab = TABS.find((t) => t[0] === ui.tab) ?? TABS[0];
    try { tab[2](body); }
    catch (e) { log('render error', e); body.append(el('p', 'pkgw-faint', `render failed: ${e && e.message}`)); }
    for (const b of head.parentNode.querySelectorAll('.pkgw-tab')) b.dataset.on = b.dataset.tab === ui.tab ? '1' : '0';
    drag?.fit();
  };

  let renderTimer = null;
  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; sync(); }, 250);
  };

  // ===========================================================================
  // PANEL KIT v2 — shared verbatim block, see userscripts/_template.user.js.
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
  // ===================== end PANEL KIT v2 ====================================

  const onHome = () => ui.everywhere || location.pathname === '/';

  /** changes since the panel was last opened — the GOV button's only job as an indicator */
  const unseen = () => data.events.filter((e) => e.t1 > (ui.readAt || 0)).length;

  const sync = () => {
    if (!root) return;
    const show = onHome();
    root.style.display = show ? '' : 'none';
    panel.style.display = show && ui.open ? 'flex' : 'none';
    fab.setAttribute('aria-expanded', String(ui.open));
    fab.classList.toggle('pk-open', ui.open);   // the button says which window is up

    const n = unseen();
    fab.dataset.new = !ui.open && n ? '1' : '0';
    fab.title = n && !ui.open
      ? `Politiko Gov Watch — ${n} recorded change${n === 1 ? '' : 's'} you have not looked at`
      : 'Politiko Gov Watch (passive) — drag to move';

    const live = liveNow();
    title.textContent = `gov watch${live ? ' · live' : ''}${data.events.length ? ` · ${data.events.length} logged` : ''}`;

    if (show && ui.open) {
      if (n) { ui.readAt = Date.now(); saveUI(); }
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

    fab = el('button', 'pk-fab pkgw-fab', 'GOV');
    fab.title = 'Politiko Gov Watch (passive) — drag to move';
    fab.addEventListener('click', () => {
      if (fabDrag.dragged()) return; // that gesture was a drag, not a click
      ui.open = !ui.open; saveUI(); sync();
    });
    root.append(fab);

    panel = el('div', 'pkgw-panel');
    head = el('div', 'pkgw-head');
    head.title = 'Drag to move · drag the bottom-right corner to resize · double-click to snap back';
    title = el('h1', '', 'gov watch');

    const pinBtn = el('button', 'pkgw-btn', 'home only');
    pinBtn.title = 'Show this panel only on the home page instead of everywhere';
    pinBtn.dataset.on = ui.everywhere ? '0' : '1';
    pinBtn.addEventListener('click', () => {
      ui.everywhere = !ui.everywhere; saveUI();
      pinBtn.dataset.on = ui.everywhere ? '0' : '1';
      sync();
    });

    const close = el('button', 'pkgw-btn', '×');
    close.title = 'Hide (the GOV button brings it back)';
    close.addEventListener('click', () => { ui.open = false; saveUI(); sync(); });

    head.append(title, pinBtn, close);

    const tabs = el('div', 'pkgw-tabs');
    for (const [key, label] of TABS) {
      const b = el('button', 'pkgw-tab', label);
      b.dataset.tab = key;
      b.dataset.on = ui.tab === key ? '1' : '0';
      b.addEventListener('click', () => { ui.tab = key; saveUI(); render(); });
      tabs.append(b);
    }

    body = el('div', 'pkgw-body');
    panel.append(head, tabs, body);
    root.append(panel);
    document.documentElement.append(root);

    drag = draggable(panel, head, (pos) => { Object.assign(ui, pos ?? { x: null, y: null }); saveUI(); });
    resize = resizable(panel, (size) => { ui.size = size ?? undefined; saveUI(); },
      { drag, minW: 280, minH: 220 });
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
  // "home only" mode cares, but it cares immediately. Wrapping history here does not
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

  // The CYCLE tab counts down and every freshness figure ages, so the panel restates
  // itself on a slow tick. This timer draws and nothing else — it asks the game for
  // nothing, which is what tools/test-gov-passive.js pins. Visible tab only, and never
  // while the pointer is inside the panel: a redraw under the cursor loses a click.
  setInterval(() => { if (!document.hidden && ui.open && onHome() && !panel?.matches(':hover')) render(); }, 20_000);

  // The panel is redrawn on becoming visible rather than while hidden: render() bails
  // on document.hidden, so a tab that was in the background catches up on focus.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

  const boot = () => {
    mount();
    checkRoute();
    log('ready — passive; zero added requests. docs/14-government-motion-surface.md');
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
