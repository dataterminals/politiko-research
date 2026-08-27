// ==UserScript==
// @name         Politiko — People Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      1.7.0
// @description  Builds a local ledger of players' last-online times, cities, ranks and combat records from the profiles you open, and sorts it least-active-first. Fully passive: it reads responses the game already made and originates nothing. Includes a next/back walk so filling the ledger by hand is one keypress per player — along the roster, or along the panel's own sorted and filtered list.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/people-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/people-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON bodies of /api/* responses via a passive fetch/XHR tap — only the
 *             ones the game requested on its own, on pages you are actively viewing.
 *             Specifically /api/people (roster pages) and /api/users/<name> (profiles).
 *             No DOM scraping.
 *
 *   Requests: ZERO. This script does not originate network calls to politiko.io.
 *
 *             Clicking a name in the panel, or a walk button, is navigation — not a
 *             request this script originates. It performs the same client-side route
 *             change as clicking that player anywhere else in the game, and the app
 *             then fetches the profile as it always would, once, because you clicked.
 *             Nothing is queued, paced, retried, or continued in the background.
 *
 *   Sends:    nothing, to anyone, ever. No telemetry, no remote config, no export
 *             off-machine. Everything stays in this browser.
 *
 *   Storage:  localStorage keys prefixed `pkpw:` — the observed player ledger, roster
 *             metadata, and panel settings. All local. Clearable from the panel.
 *
 *             As of 1.3.0 the ledger also keeps each player's city. Both sources are
 *             fields the game already sends: `location` on a profile you opened, and
 *             `location_name` on roster rows when the server is unlocking that column
 *             (`locations_visible`). Neither adds a request, and nothing asks for a
 *             location that was not already in a response on screen.
 *
 *   Alerts:   none. No notifications, no title flashing, no sound.
 *
 *   Personal data: the ledger holds other players' usernames and public profile fields.
 *             It never leaves this browser and must never be committed — artifacts/ and
 *             anything session-derived are gitignored for exactly this reason.
 *
 * HISTORY, stated plainly because the file used to say otherwise: versions up to 0.4.0
 * shipped an opt-in crawler that originated paced requests to /api/people and
 * /api/users/<name> to fill the ledger automatically. That is prohibited by the
 * scripting clause — items 2 and 5, penalty game ban — and it was carried as a
 * knowingly accepted risk from 2026-07-28. It is gone as of 1.0.0: the arming system,
 * the queue, the pacing and the request-originating code have all been removed rather
 * than disabled. What replaces it is the walk, which is just you pressing a key.
 */

(() => {
  'use strict';

  const TAG = '[pkpw]';
  const log = (...a) => console.debug(TAG, ...a);

  // ===========================================================================
  // Config
  // ===========================================================================
  const CFG = {
    // A profile whose whole lifetime was shorter than this never really engaged.
    NEVER_STUCK_MS: 2 * 3600_000,

    // `is_online` is a claim about *now* made from an observation taken whenever you
    // last opened that profile. It is only worth anything while that observation is
    // fresh — past this, someone "online" is just someone who was online once.
    LIVE_TRUST_MS: 5 * 60_000,

    HOTKEY: 'p',                // Alt+P toggles the panel
    WALK_PREV: '[',             // on a profile page, step back along the walk order
    WALK_NEXT: ']',             // ...and forward
    WALK_SWAP: '\\',            // ...and flip which order that is — the key sits right beside them
    LIST_CAP: 400,              // rows the table draws; the walk counts along the same ones
    PANEL_W: 560,
    PANEL_MIN_H: 160,
    FAB_SIZE: 38,   // must match FAB KIT's .pk-fab box           // a triangle carries less visual weight than a square of the same box
    EDGE: 8,                    // keep this much gap from the viewport edge
  };

  const K = {
    people: 'pkpw:people',
    roster: 'pkpw:roster',
    ui: 'pkpw:ui',
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

  /** @type {Record<string, any>} username -> observed profile */
  let people = readJSON(K.people, {});
  let roster = readJSON(K.roster, { total: null, totalPages: null, usernames: [], seenAt: 0, pages: {} });
  let ui = readJSON(K.ui, { sort: 'idle', dir: 1, group: 'none', hideOnline: false, hideNpc: true, minIdleDays: 0, walk: 'roster', open: false, fab: null, panel: null, size: null });
  if (ui.dir !== -1) ui.dir = 1;   // an older stored ui has no dir at all
  if (typeof ui.group !== 'string') ui.group = 'none';
  // there was only one walk order before 1.5.0, so that is what a stored ui without the
  // field meant — and roster is the right thing to land on if the value is ever junk,
  // because it is the only order that can reach a player you have not profiled
  if (ui.walk !== 'list') ui.walk = 'roster';

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeJSON(K.people, people);
      writeJSON(K.roster, roster);
      writeJSON(K.ui, ui);
    }, 1_000);
  };
  const saveNow = () => { clearTimeout(saveTimer); writeJSON(K.people, people); writeJSON(K.roster, roster); writeJSON(K.ui, ui); };

  // ===========================================================================
  // Ingest — every record here came off a response the game made on its own.
  // ===========================================================================
  const ingestRosterPage = (url, data) => {
    if (!data || !Array.isArray(data.people)) return;
    const page = Number(data.page) || null;
    roster.total = Number(data.total) || roster.total;
    roster.totalPages = Number(data.total_pages) || roster.totalPages;
    roster.seenAt = Date.now();
    if (page) roster.pages[page] = Date.now();
    // Whether the server is currently unlocking the roster's location column. The
    // client defaults it to true when the field is absent, so match that rather than
    // guessing. When it is on, one roster page yields ten cities for free; when it is
    // off the rows simply carry no name and the last profile reading stands.
    roster.locationsVisible = data.locations_visible ?? true;

    for (const r of data.people) {
      if (!r || typeof r.username !== 'string') continue;
      if (!roster.usernames.includes(r.username)) roster.usernames.push(r.username);
      const cur = people[r.username] || {};
      const rosterCity = typeof r.location_name === 'string' && r.location_name
        ? r.location_name
        : null;
      people[r.username] = {
        ...cur,
        username: r.username,
        status: r.status ?? cur.status ?? null,
        in_city: r.in_city ?? cur.in_city ?? null,
        // Same keep-the-old-value rule as membership below: an absent city means the
        // server did not send one, not that they left town.
        location: rosterCity ?? cur.location ?? null,
        locationAt: rosterCity ? Date.now() : (cur.locationAt ?? null),
        rosterSeenAt: Date.now(),
      };
    }
    log('roster page', page, 'of', roster.totalPages, '—', roster.usernames.length, 'known');
    save(); paint();
  };

  const ingestProfile = (url, data) => {
    if (!data || typeof data.username !== 'string' || !('last_online' in data)) return;
    const cur = people[data.username] || {};
    people[data.username] = {
      ...cur,
      username: data.username,
      status: data.status ?? null,
      last_online: data.last_online ?? null,
      is_online: !!data.is_online,
      created_at: data.created_at ?? null,
      rank_key: data.rank_key ?? null,
      is_npc: !!data.is_npc,
      age: data.age ?? null,
      combat: data.combat_record ? { ...data.combat_record } : (cur.combat ?? null),
      relationship: data.relationship ? { ...data.relationship } : (cur.relationship ?? null),
      // alignment carries the per-axis action counts the profile screen prints as
      // "N actions" — the only activity *volume* the API exposes anywhere
      alignment: data.alignment ? { ...data.alignment } : (cur.alignment ?? null),
      // membership. Keep the old value when a field is absent rather than nulling it:
      // a payload that simply stopped sending these should not read as "left their
      // faction", which is a conclusion this script has no business drawing.
      faction_id: data.faction_id ?? cur.faction_id ?? null,
      faction_name: data.faction_name ?? cur.faction_name ?? null,
      faction_rank: data.faction_rank ?? cur.faction_rank ?? null,
      corp_id: data.corp_id ?? cur.corp_id ?? null,
      corp_name: data.corp_name ?? cur.corp_name ?? null,
      corp_role: data.corp_role ?? cur.corp_role ?? null,
      location: data.location ?? cur.location ?? null,
      locationAt: data.location ? Date.now() : (cur.locationAt ?? null),
      observedAt: Date.now(),
    };
    if (!roster.usernames.includes(data.username)) roster.usernames.push(data.username);
    log('profile', data.username);
    save(); paint();
  };

  // ===========================================================================
  // Passive tap — reads responses already in flight. Adds no requests itself.
  // ===========================================================================
  const route = (u) => {
    try { return new URL(u, location.origin).pathname + new URL(u, location.origin).search; }
    catch { return String(u); }
  };

  const dispatch = (url, data) => {
    const p = route(url);
    if (/\/api\/people(\?|$)/.test(p)) ingestRosterPage(url, data);
    else if (/\/api\/users\/[^/]+$/.test(p)) ingestProfile(url, data);
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
    this.__pkpwUrl = u;
    return origOpen.call(this, m, u, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        const u = this.__pkpwUrl || '';
        if (u.includes('/api/') && (this.getResponseHeader('content-type') || '').includes('json')) {
          dispatch(u, JSON.parse(this.responseText));
        }
      } catch { /* not json */ }
    });
    return origSend.apply(this, a);
  };

  // ===========================================================================
  // Roster walk — the manual replacement for a crawler.
  //
  // The ledger only ever learns a player from a response the game itself made, so
  // somebody has to open the profiles. These step you along the roster you have
  // already enumerated, which turns a walk into one keypress per player instead of
  // a trip back to the People tab between each one.
  //
  // Every step is a navigation you asked for. The app fetches that profile exactly
  // as it would if you had clicked the player yourself, and nothing here is timed,
  // queued, or continued while you are looking at something else.
  // ===========================================================================
  const PROFILE_RE = /^\/profile\/([^/]+)$/;
  const mod = (n, m) => ((n % m) + m) % m;

  const currentProfile = () => {
    const m = PROFILE_RE.exec(location.pathname);
    try { return m ? decodeURIComponent(m[1]) : null; } catch { return m ? m[1] : null; }
  };

  /**
   * Two orders to walk, and they answer different questions.
   *
   *   roster — every username the game has paginated past you, in its order. It is the
   *            only one containing players you have never profiled, so it is the order
   *            that fills the ledger. Until 1.5.0 it was the only one there was.
   *   list   — exactly what the panel is showing: your sort, your filters, your
   *            grouping, top to bottom. By construction it holds only players you have
   *            already profiled, because an unprofiled one has nothing to rank. It is
   *            for working a shortlist you built — "the twelve most idle in Napoli" —
   *            rather than for filling the ledger.
   *
   * `displayOrder` lives down with the table, because it has to *be* the painted order
   * rather than agree with it by hand. Nothing here runs before boot, so reaching
   * forward for it resolves fine.
   */
  const WALK = { roster: 'roster', list: 'list' };

  /**
   * The list moves under you, and that is the whole difficulty with walking it.
   *
   * Sort by "freshest data" and every profile you open jumps to the top, so ] from the
   * top lands back on the one you just came from — a two-name loop that never advances.
   * Tick "hide online" and opening someone who is online drops them out from under you,
   * leaving the next keypress no position to count from and throwing you to row one.
   * Even "most idle" drifts on its own, because idle time is measured against now.
   *
   * So the walk takes a copy of the order and counts along the copy. The copy is rebuilt
   * when you change a control that decides the order — a different sort, a filter, the
   * grouping — because at that point you have asked for a different list, and again when
   * you step back into the list from roster order. Anything else that moves the table
   * underneath you leaves your place alone, and the walk bar's ⟳ folds those changes in
   * when you want them.
   *
   * This is the same problem 1.3.2 fixed for the scroll position, one layer down.
   *
   * In memory only: a walk does not outlive a reload, and none of it is stored.
   */
  let walkSnap = null;
  // Deliberately not ui.walk. Roster order never consults the copy, so nothing would
  // observe the signature changing while you were away from the list and it would come
  // back looking untouched — leaving and returning is handled in swapWalk, where it
  // actually happens.
  const listSig = () => [ui.sort, ui.dir, ui.group,
    ui.hideNpc ? 1 : 0, ui.hideOnline ? 1 : 0, ui.minIdleDays || 0].join('|');
  const listOrder = () => {
    const sig = listSig();
    if (!walkSnap || walkSnap.sig !== sig) walkSnap = { sig, order: displayOrder() };
    return walkSnap.order;
  };
  const resyncWalk = () => { walkSnap = null; };
  const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  /** true when the table has moved since the walk took its copy of it */
  const walkStale = (live) => ui.walk === WALK.list && !!walkSnap && !sameOrder(walkSnap.order, live);

  const walkOrder = () => (ui.walk === WALK.list ? listOrder() : roster.usernames);
  const swapWalk = () => {
    ui.walk = ui.walk === WALK.list ? WALK.roster : WALK.list;
    // Stepping into the list takes it as it stands. This costs you nothing: your place
    // is read off the profile you are standing on rather than off the copy, so all it
    // decides is whether what comes *next* is current — and it should be.
    if (ui.walk === WALK.list) resyncWalk();
    save(); paint();
  };

  const goProfile = (name) => {
    if (!name) return;
    history.pushState({}, '', `/profile/${encodeURIComponent(name)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    paint();
  };

  /** one place along the walk order from whoever is on screen; wraps at the ends */
  const step = (dir) => {
    const order = walkOrder();
    if (!order.length) return null;
    const i = order.indexOf(currentProfile());
    return i < 0 ? order[0] : order[mod(i + dir, order.length)];
  };

  /** where the profile on screen sits in the walk order, or -1 for "not in it" */
  const walkAt = () => walkOrder().indexOf(currentProfile());

  /**
   * The next player with no profile yet — the only ones a walk actually gains from.
   *
   * Always roster order, whichever way the walk is set. The panel's list is profiled
   * players by definition, so asking it for an unprofiled one is asking an empty
   * question; this is the control that fills the ledger, and it should not quietly stop
   * working because you sorted the table.
   */
  const nextUnseen = (dir = 1) => {
    const order = roster.usernames;
    if (!order.length) return null;
    const start = Math.max(0, order.indexOf(currentProfile()));
    for (let k = 1; k <= order.length; k++) {
      const cand = order[mod(start + dir * k, order.length)];
      if (!people[cand]?.observedAt) return cand;
    }
    return null;
  };

  // ===========================================================================
  // Derived metrics
  // ===========================================================================
  const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

  function derive(r) {
    const last = ms(r.last_online);
    const made = ms(r.created_at);
    const idleMs = last ? Date.now() - last : null;
    const lifetimeMs = last && made ? last - made : null;
    const staleMs = r.observedAt ? Date.now() - r.observedAt : null;
    const live = liveScore(r, staleMs, idleMs);
    const c = r.combat || {};
    const won = c.attacks_won ?? 0;
    const lost = c.attacks_lost ?? 0;
    const a = r.alignment || {};
    // null, not 0 — "never observed" and "has done none" sort differently and mean
    // completely different things about a player
    const num = (v) => (Number.isFinite(v) ? v : null);
    const socialActs = num(a.social_count);
    const econActs = num(a.economic_count);
    return {
      socialActs,
      econActs,
      politicalActs: socialActs == null && econActs == null ? null : (socialActs ?? 0) + (econActs ?? 0),
      idleMs,
      idleDays: idleMs == null ? null : idleMs / 86_400_000,
      neverStuck: lifetimeMs != null && lifetimeMs < CFG.NEVER_STUCK_MS,
      lifetimeMs,
      won, lost,
      record: `${won}-${lost}`,
      staleMs,
      live,
      liveNow: live === 3,
      city: r.location || null,
      cityAgeMs: r.locationAt ? Date.now() - r.locationAt : null,
      traveling: r.status === 'traveling',
    };
  }

  /**
   * The city, and how much of it is honest. `traveling` is a status the roster restates
   * on every page you turn, so it outranks the stored name: someone in transit is by
   * definition not in the city you last saw them in, and printing a bare name there
   * would be asserting something the ledger cannot support. The name is kept — it is
   * still where they left from, and it is what grouping needs — but it is marked.
   *
   * Status vocabulary, read off the 2026-08-03 bundle: active, jailed, hospitalized,
   * in_combat, traveling, dead.
   */
  const cityText = (d) => {
    if (d.traveling) return d.city ? `${d.city} ⇢` : '⇢ in transit';
    return d.city || '—';
  };

  /**
   * Whether cities are arriving at all, which is the server's call and not ours.
   *
   * Two independent switches, and both were dark when this shipped (field-checked
   * 2026-08-14): the roster envelope's `locations_visible`, and — separately — whether
   * a profile payload carries `location` at all. When the profile is sealed the game's
   * own stat box prints UNAVAILABLE / [ signal lost ], so a blank column here is the
   * tool reporting the world state correctly, not failing to read it.
   *
   * The distinction the note has to preserve is "you have not looked yet" versus "you
   * looked and the server sent nothing" — those need different things from the reader,
   * and collapsing them into one message is how a working tool gets called broken.
   */
  const CITY_NOTE_HELP =
    'A city can arrive two ways, both server-gated: `location_name` on roster rows '
    + '(when locations_visible is on) and `location` on a profile. Politiko gates player '
    + 'visibility behind government policy — the Privacy Rights axis, one of 20 policies '
    + 'on a -3..+3 scale — the same family of gate that seals the profile stats tab. If '
    + 'the game itself shows UNAVAILABLE / [ signal lost ] in a profile\'s location box, '
    + 'nothing client-side can recover it; it opens when the world policy moves.';

  const cityNote = () => {
    const profiled = Object.values(people).filter((p) => p.observedAt);
    const withCity = profiled.filter((p) => p.location).length;
    if (withCity) {
      return roster.locationsVisible
        ? `cities: ${withCity} recorded · roster is showing them — page People for ten at a time`
        : `cities: ${withCity} recorded · roster is hiding them — one per profile you open`;
    }
    // Nothing recorded. Say which of the two reasons it is.
    if (!profiled.length) return 'cities: none yet — open a profile or page the roster';
    return roster.locationsVisible === false
      ? `cities: sealed — ${profiled.length} profile(s) read, none carried one (hover)`
      : `cities: none in ${profiled.length} profile(s) read — likely sealed (hover)`;
  };

  const cityTitle = (d) => {
    // Deliberately does not say "open their profile": when the world seals locations
    // that is advice which cannot work, and the foot of the panel already reports
    // which of the two situations you are actually in.
    if (!d.city) return 'no city recorded — see the note at the foot of the panel';
    const age = d.cityAgeMs == null ? 'an unknown time ago' : `${fmtDur(d.cityAgeMs)} ago`;
    return d.traveling
      ? `in transit — ${d.city} is where they were as of ${age}`
      : `${d.city}, as of ${age}`;
  };

  /**
   * How much the ledger can say about someone being active *right now*, which is not
   * something it can ever really know — every field here was true when you looked, and
   * nothing refreshes on its own.
   *
   *   3  seen online, and seen recently enough to still mean it
   *   2  seen online, but a while ago — no evidence about now
   *   1  not flagged online, but their last_online is within minutes of now
   *   0  nothing suggesting activity
   */
  function liveScore(r, staleMs, idleMs) {
    if (r.is_online && staleMs != null && staleMs <= CFG.LIVE_TRUST_MS) return 3;
    if (r.is_online) return 2;
    if (idleMs != null && idleMs <= CFG.LIVE_TRUST_MS) return 1;
    return 0;
  }

  const fmtDur = (msv) => {
    if (msv == null) return '—';
    const s = Math.floor(msv / 1000);
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    const d = Math.floor(s / 86400);
    return d < 365 ? `${d}d` : `${(d / 365).toFixed(1)}y`;
  };

  /**
   * Every sort is written so its *natural* order matches its label — "most idle" puts
   * the most idle first. `ui.dir === -1` reverses whatever that was, which keeps one
   * toggle meaningful across columns that don't share a direction (A→Z is ascending,
   * most-idle-first is descending, and both are "natural" for their label).
   *
   * `col` is the table column the sort belongs to, so clicking a header and picking
   * from the dropdown drive the same state.
   */
  const SORTS = {
    idle: {
      label: 'most idle', col: 'idle',
      cmp: (a, b) => (b.d.idleMs ?? -1) - (a.d.idleMs ?? -1),
    },
    live: {
      label: 'active now', col: 'idle',
      // ranked by how much the ledger can actually claim, then by recency within that
      cmp: (a, b) => (b.d.live - a.d.live) || ((a.d.idleMs ?? Infinity) - (b.d.idleMs ?? Infinity)),
    },
    record: {
      label: 'worst record', col: 'record',
      cmp: (a, b) => (b.d.lost - b.d.won) - (a.d.lost - a.d.won),
    },
    fresh: {
      label: 'freshest data', col: 'seen',
      cmp: (a, b) => (a.d.staleMs ?? 0) - (b.d.staleMs ?? 0),
    },
    rank: {
      label: 'rank', col: 'rank',
      cmp: (a, b) => String(a.r.rank_key ?? '').localeCompare(String(b.r.rank_key ?? '')),
    },
    // -1 for "never observed", so an unknown count sorts below a genuine zero rather
    // than above everyone
    social: {
      label: 'most social actions', col: 'social',
      cmp: (a, b) => (b.d.socialActs ?? -1) - (a.d.socialActs ?? -1),
    },
    political: {
      label: 'most political actions', col: 'social',
      cmp: (a, b) => (b.d.politicalActs ?? -1) - (a.d.politicalActs ?? -1),
    },
    name: {
      label: 'name', col: 'player',
      cmp: (a, b) => a.r.username.localeCompare(b.r.username),
    },
    // '￿' sorts an unrecorded city after every real name, the same way the count
    // sorts use -1 — "we have never seen where they are" is not a place, and it should
    // not land in the middle of the alphabet
    city: {
      label: 'city', col: 'city',
      cmp: (a, b) => (a.d.city ?? '￿').localeCompare(b.d.city ?? '￿')
                  || a.r.username.localeCompare(b.r.username),
    },
  };

  const COLUMNS = [
    { key: 'player', label: 'player', sort: 'name' },
    { key: 'idle', label: 'idle', sort: 'idle' },
    { key: 'city', label: 'city', sort: 'city' },
    { key: 'social', label: 'social', sort: 'social' },
    { key: 'rank', label: 'rank', sort: 'rank' },
    { key: 'record', label: 'W-L', sort: 'record' },
    { key: 'seen', label: 'seen', sort: 'fresh' },
  ];

  /**
   * Grouping. Membership only lands when you open someone's profile, so a player
   * observed before this existed shows as unaffiliated until you look again — that is
   * missing data, not a claim that they left.
   */
  const GROUPS = {
    none: { label: 'no grouping', of: null },
    faction: { label: 'group by faction', of: (r) => r.faction_name || null, sub: (r) => r.faction_rank },
    corp: { label: 'group by corp', of: (r) => r.corp_name || null, sub: (r) => r.corp_role },
    // Someone in transit still buckets under the city they left, which is the only
    // place the ledger can honestly put them; the row itself carries the ⇢ mark.
    city: { label: 'group by city', of: (r) => r.location || null },
  };
  const UNGROUPED = 'not recorded';

  function rows() {
    const out = [];
    for (const u of Object.keys(people)) {
      const r = people[u];
      if (!r.observedAt) continue;           // roster-only, nothing to rank yet
      const d = derive(r);
      if (ui.hideNpc && r.is_npc) continue;
      if (ui.hideOnline && r.is_online) continue;
      if (ui.minIdleDays && (d.idleDays ?? 0) < ui.minIdleDays) continue;
      out.push({ r, d });
    }
    const cmp = (SORTS[ui.sort] || SORTS.idle).cmp;
    out.sort(cmp);
    if (ui.dir === -1) out.reverse();
    return out;
  }

  /**
   * The painted order, grouping and cap included: one list of buckets, in the order the
   * table lays them out. paint() renders from this and the walk counts along it, so
   * "next" cannot come to mean something other than "the row below". A null bucket name
   * is the ungrouped case — rows, no header.
   */
  function display() {
    const capped = rows().slice(0, CFG.LIST_CAP);
    const grouping = (GROUPS[ui.group] || GROUPS.none).of;
    if (!grouping) return [{ name: null, members: capped }];

    const buckets = new Map();
    for (const item of capped) {
      const key = grouping(item.r) ?? UNGROUPED;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
    // biggest group first, and whoever we have no membership for goes last —
    // it is the bucket that means "unknown", so it should not lead
    return [...buckets.entries()]
      .sort((a, b) => {
        if (a[0] === UNGROUPED) return 1;
        if (b[0] === UNGROUPED) return -1;
        return b[1].length - a[1].length || a[0].localeCompare(b[0]);
      })
      .map(([name, members]) => ({ name, members }));
  }

  /** just the names, flattened — what the walk steps along in list mode */
  const displayOrder = () => display().flatMap((g) => g.members.map((it) => it.r.username));

  // ===========================================================================
  // Panel
  // ===========================================================================
  let host = null, root = null, fab = null;
  let grip = null, gripCov = null, panelDrag = null, panelResize = null;

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

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-monospace, Menlo, Consolas, monospace; }
    .panel { position: fixed; z-index: 2147483000; background: #09090b; color: #e4e4e7;
      border: 1px solid #27272a; width: ${CFG.PANEL_W}px; max-height: 70vh; display: flex;
      flex-direction: column; font-size: 12px; }
    .bar { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-bottom: 1px solid #27272a; flex-wrap: wrap; }
    .bar b { font-weight: 600; letter-spacing: .04em; }
    .spacer { flex: 1; }
    button, select { background: #18181b; color: #e4e4e7; border: 1px solid #3f3f46;
      padding: 2px 7px; font-size: 11px; cursor: pointer; font-family: inherit; }
    button:hover { background: #27272a; }
    button.on { background: #dc2626; border-color: #dc2626; color: #fff; }
    button.dry { background: #ca8a04; border-color: #ca8a04; color: #000; }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid #18181b; white-space: nowrap; }
    th { position: sticky; top: 0; background: #09090b; color: #a1a1aa; font-weight: 500; font-size: 11px; }
    tr:hover td { background: #18181b; }
    /* the profile you are standing on, so the row and the page agree on where you are */
    tr.here td { background: #17171c; box-shadow: inset 2px 0 0 #dc2626; }
    tr.here:hover td { background: #1f1f26; }
    a.plink { color: inherit; text-decoration: none; cursor: pointer;
      border-bottom: 1px dotted #3f3f46; }
    a.plink:hover { color: #fafafa; border-bottom-color: #a1a1aa; }
    tr.grp td { background: #111116; color: #a1a1aa; font-size: 10px;
      letter-spacing: .14em; text-transform: uppercase; padding: 6px 8px;
      border-top: 1px solid #27272a; position: sticky; }
    th.sortable { cursor: pointer; user-select: none; }
    th.sortable:hover { color: #e4e4e7; }
    th.sorted { color: #fafafa; }
    .live { color: #4ade80; }
    .idle { color: #f87171; }
    .never { color: #fbbf24; }
    .dim { color: #71717a; }
    .transit { color: #60a5fa; font-style: italic; }
    .note { padding: 6px 8px; color: #a1a1aa; border-top: 1px solid #27272a; font-size: 11px; }
    /* FAB KIT v3 — shared verbatim block.
       Same rule as PANEL KIT: copy it in as it stands, and if it has to change,
       bump the version here and in every tool carrying a copy, so the copies can
       be diffed. Several of these tools are on screen at once, and buttons that
       each picked their own shape read as several unrelated add-ons rather than
       one set of tools. A 15px glyph is also a coin toss across fonts and
       platforms, and four of them tell you nothing about which is which. So the
       box is fixed here and only the word inside it belongs to the tool: three
       or four letters, upper case, no emoji.

       v2 adds .pk-open: the button is filled while its own panel is open. Ten of
       these can sit on one screen and every panel remembers whether it was open,
       so the row of buttons was the one thing that could not tell you which
       windows you already had — you found that out by clicking one and closing it.

       v3 makes that row literal. Until now every tool picked its own corner, and
       eleven tools meant eleven buttons scattered down both edges of the screen in
       an order nobody chose: you hunted for the one you wanted. They now default
       to one row, side by side, in the band above the game's header rule — the
       header is 52px tall (py-3 either side of a 28px nav link) and the button is
       38, so top: 7 centres it there, and on any desktop layout that band is empty
       screen between the nav links and the account menu.

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 11; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       an eleventh tool does not shuffle the ten buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. The eye
       leads because it is the mark of the set; the words are alphabetical after it:

         0  the eye  people-watch     6  SLP   sleeper-watch
         1  ALGN     align-watch      7  SOCK  ws-watch
         2  GOV      gov-watch        8  TIME  time-watch
         3  JUMP     quick-jump       9  WRLD  world-watch
         4  MKT      market-watch    10  XP    xp-watch
         5  RAID     raid-watch

       Eleven 38px buttons 8px apart is a 498px row, so it runs 249px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1380px the row is centred,
       and below that it stops sliding left rather than climb onto the nav.

       Three numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 249 (half the row). Nothing else in here is placement.

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
      left: calc(max(440px, 50% - 249px) + var(--pk-slot, 0) * 46px);
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
    /* The eye used to BE the button: a clip-path cut the box down to the triangle, so
       the silhouette and the hit area were both the eye of providence. FAB KIT ended
       that — every tool in the set wears the same square now, and this one keeps the
       eye as the mark inside the square rather than as its outline. It is still the
       only button in the repo that shows a symbol instead of a word. */
    /* Slot 0 — the eye leads the row. placeFab() writes left/top inline on mount,
       so the slot here only governs the paint before that lands; defaultFabPos()
       computes the same row in JS, and test-placement.js checks the two agree. */
    .fab { --pk-slot: 0; position: fixed; z-index: 2147483000; cursor: grab; }
    .fab.dragging { cursor: grabbing; color: #a1a1aa; }
    .grip { display: flex; gap: 8px; align-items: baseline; padding: 6px 8px;
      border-bottom: 1px solid #27272a; user-select: none; }
    .grip b { font-weight: 600; letter-spacing: .04em; }
    .grip .cov { margin-left: auto; }
  `;

  // The eye of providence. The triangle is drawn now, not cut: stroked and left
  // unfilled so the button's own background shows through, sitting inside the FAB KIT
  // square at the 24px the kit sizes an icon to.
  const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
      <path d="M12 2 22.6 22.2 1.4 22.2 Z" fill="none"/>
      <path d="M7.3 16.5c1.5-2.6 7.9-2.6 9.4 0-1.5 2.6-7.9 2.6-9.4 0Z"/>
      <circle cx="12" cy="16.5" r="1.45" fill="currentColor" stroke="none"/>
    </svg>`;

  function mount() {
    if (host) return;
    host = document.createElement('div');
    // The host must carry the z-index, not just the children. position:fixed makes it a
    // stacking context, so the huge z-indexes inside are only ever resolved against each
    // other — left on `auto` the whole shadow tree sits below the game's Comms dock
    // (z-index 9999) and clicks on the overlap land on chat instead of on us.
    host.style.cssText = 'position:fixed;inset:0;width:0;height:0;z-index:2147483000;';
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    root.append(style);
    document.documentElement.append(host);

    fab = document.createElement('button');
    fab.className = 'pk-fab fab';
    fab.innerHTML = EYE_SVG;
    fab.setAttribute('aria-label', 'People Watch');
    fab.title = 'People Watch — click to open, drag to move, double-click to reset';
    root.append(fab);

    const panel = document.createElement('div');
    panel.className = 'panel';

    // The drag handle has to outlive paint(), which rebuilds everything below it.
    grip = document.createElement('div');
    grip.className = 'grip';
    grip.title = 'Drag to move · drag the bottom-right corner to resize · double-click to re-tether';
    gripCov = document.createElement('span');
    gripCov.className = 'dim cov';
    grip.append(Object.assign(document.createElement('b'), { textContent: 'PEOPLE WATCH' }), gripCov);
    panel.append(grip);

    root.append(panel);

    // Park it where you like; until you do, it stays tethered to the button.
    panelDrag = draggable(panel, grip, (pos) => { ui.panel = pos; saveNow(); if (!pos) placePanel(); });
    panelResize = resizable(panel, (size) => {
      ui.size = size;
      // Resizing is positioning. The tether re-derives the panel's box from the
      // button on every paint, so a sized panel still following the button would be
      // shoved around by the next response to land. Park it where it stands — the
      // same state dragging it produces, and the same double-click hands both back.
      if (size && !ui.panel) {
        const r = panel.getBoundingClientRect();
        ui.panel = { x: r.left, y: r.top };
      }
      saveNow();
    }, { drag: panelDrag, minW: 320, minH: CFG.PANEL_MIN_H });
    grip.addEventListener('dblclick', () => { panelDrag.reset(); panelResize.reset(); });

    placeFab();
    makeDraggable();
    window.addEventListener('resize', placeFab);
    paint();
  }

  // ---------------------------------------------------------------------------
  // Placement — the button is draggable and the position is remembered, because
  // the game's own furniture (the chat dock) owns the bottom-right corner and
  // there is no arrangement that is right for every layout. The panel hangs off
  // whichever side of the button has room, so it can't end up off-screen.
  // ---------------------------------------------------------------------------
  // FAB KIT v3's home row, in JS. This tool places its own button, so an inline
  // left/top always outranks the kit's CSS rule and the row has to be computed here
  // instead. The numbers are the block's, verbatim: eleven 38px buttons 8px apart is
  // a 498px row, centred on the viewport and floored at where the game's own nav
  // ends, sitting 7px down inside the header band. tools/test-placement.js reads both
  // the CSS and this literal and fails the build if they ever drift apart.
  const HOME = { slot: 0, top: 7, floor: 440, half: 249, pitch: 46 };

  const defaultFabPos = () => ({
    x: Math.max(HOME.floor, Math.round(window.innerWidth / 2) - HOME.half) + HOME.slot * HOME.pitch,
    y: HOME.top,
  });

  const clampFab = ({ x, y }) => ({
    x: Math.min(Math.max(x, CFG.EDGE), Math.max(CFG.EDGE, window.innerWidth - CFG.FAB_SIZE - CFG.EDGE)),
    y: Math.min(Math.max(y, CFG.EDGE), Math.max(CFG.EDGE, window.innerHeight - CFG.FAB_SIZE - CFG.EDGE)),
  });

  /**
   * A hidden tab or a minimised window can report a ~zero viewport. Clamping
   * against that pins everything into the top-left corner and the next save
   * makes it permanent, so treat it as "no information" and leave the stored
   * position alone until real dimensions come back.
   */
  const viewportUsable = () => window.innerWidth > 120 && window.innerHeight > 120;

  function placeFab() {
    if (!fab || !viewportUsable()) return;
    ui.fab = clampFab(ui.fab || defaultFabPos());
    Object.assign(fab.style, {
      left: `${ui.fab.x}px`, top: `${ui.fab.y}px`, right: 'auto', bottom: 'auto',
    });
    placePanel();
  }

  // Which side of the button the panel is currently hanging off. Sticky, so it
  // doesn't flip back and forth while the button is being dragged along an edge.
  let panelAlign = 'right';

  function placePanel() {
    const panel = root && root.querySelector('.panel');
    if (!panel || !ui.fab || !viewportUsable()) return;
    const { x, y } = ui.fab;
    const gap = 8;
    const vw = window.innerWidth, vh = window.innerHeight;

    // Once you have dragged the panel's corner, the size is yours: PANEL KIT's
    // resizable() owns width, height and the viewport caps from then on, and this
    // function only positions. Writing either here would undo a chosen size on the
    // next paint — and paint() runs on every response the game lands.
    const sized = !!(ui.size && ui.size.w && ui.size.h);
    const w = sized ? (panel.getBoundingClientRect().width || CFG.PANEL_W)
      : Math.min(CFG.PANEL_W, vw - CFG.EDGE * 2);
    if (!sized) panel.style.width = `${w}px`;

    // Parked by hand: the panel keeps its own spot and stops following the button.
    // Height is capped to whatever is left below it so the table scrolls instead of
    // running off the bottom. Double-click the header to hand it back to the tether.
    if (ui.panel) {
      panel.style.left = `${ui.panel.x}px`;
      panel.style.top = `${ui.panel.y}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      if (!sized) panel.style.maxHeight = `${Math.max(CFG.PANEL_MIN_H, vh - ui.panel.y - CFG.EDGE)}px`;
      panelDrag?.fit();
      return;
    }

    // Horizontal: whichever edge of the button leaves the panel fully on screen,
    // preferring right-aligned so it opens inward from the right.
    const rightAligned = x + CFG.FAB_SIZE - w;
    const leftAligned = x;
    const fits = (l) => l >= CFG.EDGE && l + w <= vw - CFG.EDGE;

    let left;
    if (panelAlign === 'left' && fits(leftAligned)) left = leftAligned;
    else if (fits(rightAligned)) { left = rightAligned; panelAlign = 'right'; }
    else if (fits(leftAligned)) { left = leftAligned; panelAlign = 'left'; }
    else { left = rightAligned; panelAlign = 'right'; }
    panel.style.left = `${Math.max(CFG.EDGE, Math.min(left, vw - w - CFG.EDGE))}px`;
    panel.style.right = 'auto';

    // Vertical: whichever side of the button has more room, capped to exactly
    // that much so the table scrolls instead of overflowing the viewport.
    const above = y - gap - CFG.EDGE;
    const below = vh - (y + CFG.FAB_SIZE) - gap - CFG.EDGE;
    if (above >= below) {
      panel.style.bottom = `${vh - y + gap}px`;
      panel.style.top = 'auto';
    } else {
      panel.style.top = `${y + CFG.FAB_SIZE + gap}px`;
      panel.style.bottom = 'auto';
    }
    if (!sized) panel.style.maxHeight = `${Math.max(CFG.PANEL_MIN_H, Math.max(above, below))}px`;
  }

  function makeDraggable() {
    let drag = null;
    let suppressClick = false;

    fab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = ui.fab || (ui.fab = clampFab(defaultFabPos()));
      drag = { dx: e.clientX - p.x, dy: e.clientY - p.y, id: e.pointerId, moved: false };
      try { fab.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
      e.preventDefault();
    });

    fab.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const nx = e.clientX - drag.dx, ny = e.clientY - drag.dy;
      // A few px of slop, so a slightly shaky click still counts as a click.
      if (!drag.moved && Math.hypot(nx - ui.fab.x, ny - ui.fab.y) < 4) return;
      if (!drag.moved) { drag.moved = true; fab.classList.add('dragging'); }
      ui.fab = clampFab({ x: nx, y: ny });
      placeFab();
    });

    const end = (e) => {
      if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
      const moved = drag.moved;
      drag = null;
      fab.classList.remove('dragging');
      try { fab.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (moved) { suppressClick = true; save(); }
    };
    fab.addEventListener('pointerup', end);
    fab.addEventListener('pointercancel', end);

    // Click still drives the toggle, so the keyboard path keeps working; a drag
    // just swallows the click that follows it.
    fab.onclick = () => {
      if (suppressClick) { suppressClick = false; return; }
      ui.open = !ui.open; save(); paint();
    };

    // Double-click returns it to the default spot if it ever gets lost.
    fab.ondblclick = () => { ui.fab = defaultFabPos(); save(); placeFab(); };
  }

  /**
   * A real <a href>, so middle-click and ctrl-click open a tab the way they should and
   * the browser shows the destination on hover. A plain left click is intercepted and
   * turned into the SPA route change instead, because a full page load would throw away
   * the whole session's in-memory state for no reason.
   *
   * This is navigation, not a request we originate: it is the same thing clicking that
   * player anywhere else in the game does. The app fetches the profile itself, exactly
   * as it always would, and the tap ingests that response like any other.
   */
  const profileLink = (username) => {
    const a = document.createElement('a');
    a.className = 'plink';
    a.textContent = username;
    a.href = `/profile/${encodeURIComponent(username)}`;
    a.title = `open @${username}'s profile`;
    a.addEventListener('click', (e) => {
      // let the browser handle anything that isn't a plain left click
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      history.pushState({}, '', a.getAttribute('href'));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    return a;
  };

  function paint() {
    if (!root) return;
    const panel = root.querySelector('.panel');
    if (!panel) return;
    panel.style.display = ui.open ? 'flex' : 'none';
    fab.classList.toggle('pk-open', ui.open);   // the button says which window is up —
    if (!ui.open) return;                       // above the return, so closing reaches it
    panelResize.apply(ui.size); // display:none had no geometry to restore against

    // Built once, used twice: the table paints from it and the walk counts along it.
    const groups = display();
    const liveOrder = groups.flatMap((g) => g.members.map((it) => it.r.username));
    const known = roster.usernames.length;
    const withProfile = Object.values(people).filter((r) => r.observedAt).length;
    const total = roster.total ?? '?';

    // Where you were in the table, before the table stops existing.
    //
    // A repaint throws the body away and builds a new one, which starts at scroll zero.
    // That is fine when nothing is happening and ruinous when something is: opening a
    // profile repaints twice — once from goProfile, once when the response lands — and
    // opening profiles is the entire job. Working down a long ledger meant being thrown
    // back to the top on every single one, with no way to find your place again.
    //
    // Restored at the very end, after placePanel, because that can change the panel's
    // max height and so how far the body is able to scroll.
    const keptScroll = panel.querySelector('.body')?.scrollTop ?? 0;

    // keep the grip: it carries the drag listeners, everything below it is disposable
    panel.replaceChildren(grip);
    gripCov.textContent = `${withProfile}/${total} profiled · ${known} known`;

    // The walk bar, only while you are standing on a profile.
    const here = currentProfile();
    if (here) {
      const listMode = ui.walk === WALK.list;
      const which = listMode ? 'the list' : 'the roster';
      const order = walkOrder();
      const idx = walkAt();
      // counted off the roster either way: the list holds no unprofiled players at all,
      // so counting its unseen would print zero forever and mean nothing
      const unseen = roster.usernames.filter((u) => !people[u]?.observedAt).length;

      const bar = document.createElement('div');
      bar.className = 'bar';

      const jump = (label, name, hint) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.title = name ? `${hint} — @${name}` : hint;
        b.disabled = !name;
        b.onclick = () => goProfile(name);
        return b;
      };

      bar.append(jump(`‹ ${CFG.WALK_PREV}`, step(-1), `previous player in ${which}`));
      bar.append(jump(`${CFG.WALK_NEXT} ›`, step(1), `next player in ${which}`));
      bar.append(jump('next unseen ›', nextUnseen(),
        'skip ahead to a player with no profile yet — roster order, whichever way the walk is set'));

      // Which order the bracket keys follow. One button, two states, and the key beside
      // them on the keyboard does the same thing without the panel open.
      const src = document.createElement('button');
      src.textContent = listMode ? '⋮ list' : '⋮ roster';
      if (listMode) src.className = 'on';
      src.title = (listMode
        ? `${CFG.WALK_PREV} and ${CFG.WALK_NEXT} follow the panel's list — your sort, your filters,`
          + ' your grouping, top to bottom.\nOnly players you have already profiled are in it.'
        : `${CFG.WALK_PREV} and ${CFG.WALK_NEXT} follow the roster — every username the game has`
          + ' shown you, in its order.\nIt is the only order that reaches players you have not'
          + ' profiled yet.')
        + `\n\nClick, or press ${CFG.WALK_SWAP}, to switch.`;
      src.onclick = swapWalk;
      bar.append(src);

      // Only meaningful in list mode: roster order does not reshuffle underneath you.
      if (listMode) {
        const stale = walkStale(liveOrder);
        const sync = document.createElement('button');
        sync.textContent = '⟳';
        if (stale) sync.className = 'dry';
        sync.title = stale
          ? 'the table has moved since the walk took its copy — click to walk the list as it stands now'
          : 'the walk is following the list as it stands';
        sync.onclick = () => { resyncWalk(); paint(); };
        bar.append(sync);
      }

      const where = document.createElement('span');
      where.className = 'dim';
      where.textContent = !order.length
        ? (listMode ? 'nothing in the list to walk' : 'no roster pages seen yet')
        : idx >= 0
          ? `${idx + 1}/${order.length} · ${unseen} unseen`
          : `@${here} is not in ${which} · ${unseen} unseen`;
      bar.append(where);

      panel.append(bar);
    }

    const bar2 = document.createElement('div');
    bar2.className = 'bar';
    const sortSel = document.createElement('select');
    for (const [v, s] of Object.entries(SORTS)) sortSel.append(new Option(s.label, v));
    sortSel.value = ui.sort;
    sortSel.onchange = () => { ui.sort = sortSel.value; save(); paint(); };
    bar2.append(sortSel);

    const rev = document.createElement('button');
    rev.textContent = ui.dir === -1 ? '↑ reversed' : '↓ normal';
    rev.title = 'flip the order of whatever is selected';
    if (ui.dir === -1) rev.className = 'on';
    rev.onclick = () => { ui.dir = ui.dir === -1 ? 1 : -1; save(); paint(); };
    bar2.append(rev);

    const mk = (label, key) => {
      const b = document.createElement('button');
      b.textContent = `${ui[key] ? '☑' : '☐'} ${label}`;
      b.onclick = () => { ui[key] = !ui[key]; save(); paint(); };
      return b;
    };
    bar2.append(mk('hide npc', 'hideNpc'), mk('hide online', 'hideOnline'));

    const minSel = document.createElement('select');
    for (const d of [0, 1, 3, 7, 14, 30]) minSel.append(new Option(d ? `≥${d}d idle` : 'any idle', String(d)));
    minSel.value = String(ui.minIdleDays || 0);
    minSel.onchange = () => { ui.minIdleDays = Number(minSel.value); save(); paint(); };
    bar2.append(minSel);

    const grpSel = document.createElement('select');
    for (const [v, g] of Object.entries(GROUPS)) grpSel.append(new Option(g.label, v));
    grpSel.value = ui.group in GROUPS ? ui.group : 'none';
    grpSel.title = 'membership is recorded when you open a profile, so anyone you have '
      + 'not looked at since this landed shows as not recorded';
    grpSel.onchange = () => { ui.group = grpSel.value; save(); paint(); };
    bar2.append(grpSel);
    panel.append(bar2);

    const body = document.createElement('div');
    body.className = 'body';
    const table = document.createElement('table');
    // Clicking a header sorts by it; clicking the one already sorted flips the order.
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    const activeCol = (SORTS[ui.sort] || SORTS.idle).col;
    for (const c of COLUMNS) {
      const th = document.createElement('th');
      th.className = 'sortable';
      const on = c.key === activeCol;
      th.textContent = c.label + (on ? (ui.dir === -1 ? ' ▲' : ' ▼') : '');
      if (on) th.classList.add('sorted');
      th.title = on ? 'click to reverse' : `sort by ${SORTS[c.sort].label}`;
      th.onclick = () => {
        if (c.key === activeCol) ui.dir = ui.dir === -1 ? 1 : -1;
        else { ui.sort = c.sort; ui.dir = 1; }
        save(); paint();
      };
      htr.append(th);
    }
    thead.append(htr);
    table.append(thead);
    const tb = document.createElement('tbody');

    const buildRow = ({ r, d }) => {
      const tr = document.createElement('tr');
      if (r.username === here) tr.className = 'here';
      // Keyed rather than positional: the order here has to match COLUMNS, and an
      // index-based version silently mislabels every cell after an inserted column.
      const cells = [
        { link: true, cls: d.neverStuck ? 'never' : '' },
        // only claim "online" where the observation is fresh enough to support it;
        // a stale online flag is shown as plain idle time instead of a green light
        { text: d.liveNow ? '● online' : fmtDur(d.idleMs), cls: d.liveNow ? 'live' : 'idle' },
        { text: cityText(d), cls: d.traveling ? 'transit' : (d.city ? '' : 'dim'), title: cityTitle(d) },
        {
          text: d.socialActs == null ? '—' : String(d.socialActs),
          cls: 'dim',
          title: d.socialActs == null
            ? 'no alignment recorded — open their profile'
            : `${d.socialActs} social · ${d.econActs ?? 0} economic actions`,
        },
        { text: r.rank_key || '—' },
        { text: d.record },
        { text: fmtDur(d.staleMs), cls: 'dim' },
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        if (c.link) td.append(profileLink(r.username), document.createTextNode(d.neverStuck ? ' ◦' : ''));
        else td.textContent = c.text;
        if (c.cls) td.className = c.cls;
        if (c.title) td.title = c.title;
        tr.append(td);
      }
      return tr;
    };

    // The buckets display() already handed the walk, so "next" and "the row below"
    // cannot come apart.
    for (const g of groups) {
      if (g.name != null) {
        const head = document.createElement('tr');
        head.className = 'grp';
        const td = document.createElement('td');
        td.colSpan = COLUMNS.length;
        td.textContent = `${g.name} · ${g.members.length}`;
        head.append(td);
        tb.append(head);
      }
      for (const item of g.members) tb.append(buildRow(item));
    }
    table.append(tb);
    body.append(table);
    panel.append(body);

    const note = document.createElement('div');
    note.className = 'note';
    const unseen = roster.usernames.filter((u) => !people[u]?.observedAt).length;
    note.title = CITY_NOTE_HELP;
    note.textContent = `passive · ${unseen} known player(s) still unprofiled`
      + ` · open one to record it · ◦ = never stuck · ${cityNote()}`;
    panel.append(note);

    // the rows just changed the height, so re-place and re-check it is still reachable
    placePanel();

    // and put you back where you were looking. Assigning past the end is clamped by the
    // DOM, so a list that got shorter lands at its own bottom rather than nowhere.
    if (keptScroll) body.scrollTop = keptScroll;

    // Walking the list means the list should follow you down it. `nearest` is a no-op
    // when the row is already on screen, so an ordinary repaint does not yank the view
    // around — it moves only when a step has gone past the edge of what you can see.
    if (ui.walk === WALK.list) body.querySelector('tr.here')?.scrollIntoView({ block: 'nearest' });
  }

  // ===========================================================================
  // Boot
  // ===========================================================================
  const typing = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

  const boot = () => {
    mount();
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === CFG.HOTKEY) { ui.open = !ui.open; save(); paint(); return; }
      // walk keys work whether or not the panel is open, but never while you are
      // typing — the game has a chat box and swallowing a bracket would be rude
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target) || !currentProfile()) return;
      if (e.key === CFG.WALK_PREV) { e.preventDefault(); goProfile(step(-1)); }
      else if (e.key === CFG.WALK_NEXT) { e.preventDefault(); goProfile(step(1)); }
      else if (e.key === CFG.WALK_SWAP) { e.preventDefault(); swapWalk(); }
    });
    // the walk bar only exists on profile routes, so repaint when the route moves
    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m];
      history[m] = function (...a) { const r = orig.apply(this, a); queueMicrotask(paint); return r; };
    }
    window.addEventListener('popstate', () => queueMicrotask(paint));
    log('ready — passive ·', roster.usernames.length, 'known');
  };

  window.__pkpw = {
    people: () => people,
    roster: () => roster,
    rows,
    display,
    walkOrder,
    resync: () => { resyncWalk(); paint(); return walkOrder(); },
    unseen: () => roster.usernames.filter((u) => !people[u]?.observedAt),
    resetFab: () => { ui.fab = defaultFabPos(); saveNow(); placeFab(); return ui.fab; },
    clear: () => { people = {}; roster = { total: null, totalPages: null, usernames: [], seenAt: 0, pages: {} }; saveNow(); paint(); return 'cleared'; },
    export: () => JSON.stringify({ people, roster }, null, 2),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
