// ==UserScript==
// @name         Politiko — Sleeper Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.4.0
// @description  Keeps the sleeper-recruitment timers alive after you leave the page. Reads the poll the recruitment screen already makes, remembers when each lead's meeting window opens, counts it down on every Politiko page, and hands you a one-click jump back with that lead's own issue pre-selected. Also counts down the faction advocate/embezzle cooldowns. Passive — zero added requests, and it never meets, canvasses, drops, advocates or embezzles.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/sleeper-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/sleeper-watch.user.js
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
 *             ones the game requested on its own, on pages you are actively viewing:
 *               /api/actions/sleeper-recruitment            the recruitment screen's 30s poll
 *               /api/actions/sleeper-recruitment/<id>/meet  the reply to a meeting YOU pressed
 *               /api/factions/<id>/sleepers                 the faction page's sleeper panel
 *
 *             Plus, on the recruitment screen only, the value currently showing in the
 *             page's own Conversation Issue <select> — read from the DOM of the page you
 *             are looking at, at the moment a meeting reply lands, so the recorded
 *             outcome knows which issue produced it. Nothing else is scraped.
 *
 *   Requests: ZERO. This script does not originate network calls to politiko.io.
 *
 *             It matters here. Every read endpoint above sits beside a write one —
 *             canvass, meet, drop, advocate, embezzle. This script contains no code
 *             that can call any of them, no arming switch, and no seam where one could
 *             be added quietly. tools/test-sleeper-passive.js fails the build if any of
 *             those paths, any non-GET verb, or any timer that touches the network ever
 *             appears in this file.
 *
 *             It also adds no poll of its own. Everything it knows is a copy of what the
 *             recruitment screen's own 30s refetch already brought back while you were
 *             standing on it. The countdown that runs afterwards is arithmetic on an
 *             absolute timestamp the server already handed you — it needs no network at
 *             all, which is the whole reason this tool can exist inside the clause.
 *
 *   Sends:    nothing, to anyone, ever. No telemetry, no export off-machine.
 *
 *   Storage:  localStorage keys prefixed `pksw:` — observed leads and their meeting
 *             timestamps, recruited sleepers and their cooldowns, a local ledger of how
 *             leads ended, the last recruitment header (cap, energy cost), and panel/UI
 *             state. All local. Clearable from the panel.
 *
 *   Alerts:   in-page only, and never from an unfocused tab. No Notification API, no
 *             sound, no title flashing, no favicon badge, no calendar entry, nothing
 *             written to disk on its own — nothing that could draw attention to this
 *             window or to another one. When a window opens, a strip appears inside the
 *             page you are already looking at, and that is the whole of it. The
 *             countdown redraw stops entirely while the tab is hidden.
 *
 *   Exports:  two buttons, neither ever automatic. `copy digest` puts a counts-only
 *             summary on your clipboard — scrubbed of NPC names and usernames by
 *             construction. `export` saves the raw local store as a JSON file. Both
 *             happen only when you press them, and neither sends anything anywhere.
 *
 *   Acts:     the strip and the lead rows carry a `go` button. It performs the same
 *             client-side navigation as clicking Actions -> Recruit Sleepers yourself,
 *             then best-effort sets the page's issue dropdown to that lead's own issue
 *             and scrolls its card into view. It presses nothing. Talk about issue,
 *             Canvass and Drop are yours, in the game's own UI.
 *
 *   Personal data: lead and sleeper records carry NPC display names, and the faction
 *             sleeper roster carries the usernames of whoever recruited them. It never
 *             leaves this browser and must never be committed.
 *
 * See docs/08-sleeper-surface.md for the surface this reads and what is inferred rather
 * than measured.
 */

(() => {
  'use strict';

  const TAG = '[pksw]';
  const VERSION = '0.4.0';
  const log = (...a) => console.debug(TAG, ...a);

  // ===========================================================================
  // Config
  // ===========================================================================
  const CFG = {
    HOTKEY: 's',              // Alt+S toggles the panel
    PANEL_W: 640,
    FAB_SIZE: 38,   // must match FAB KIT's .pk-fab box
    TICK_MS: 1_000,           // countdown redraw; pure local arithmetic, no network
    HEADS_UP_MS: 15 * 60_000, // how early the strip warns that a window is about to open
    MAX_LEDGER: 500,
  };

  const RECRUIT_PATH = '/actions/sleeper-recruitment';

  const K = {
    leads: 'pksw:leads',
    sleepers: 'pksw:sleepers',
    ledger: 'pksw:ledger',
    meta: 'pksw:meta',
    ui: 'pksw:ui',
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

  /** @type {Record<string, any>} lead id -> the last full reading of that lead */
  let leads = readJSON(K.leads, {});
  /** @type {Record<string, any>} sleeper id -> merged recruitment-page + faction-page row */
  let sleepers = readJSON(K.sleepers, {});
  /** @type {any[]} meetings and endings, oldest first — the research output */
  let ledger = readJSON(K.ledger, []);
  /** @type {Record<string, any>} the recruitment response's header fields */
  let meta = readJSON(K.meta, {});
  let ui = Object.assign({
    open: false, tab: 'leads', fab: null, panel: null,
    size: null,         // {w, h} once you have dragged the panel's corner
    strip: true,        // show the actionable strip over the game
    strip_pos: null,    // where you dragged it to
    facTier: true,      // include faction advocate/embezzle cooldowns in the strip
    muted: {},          // event key -> true; dismissed strips, per window
  }, readJSON(K.ui, {}));

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeJSON(K.leads, leads);
      writeJSON(K.sleepers, sleepers);
      writeJSON(K.ledger, ledger);
      writeJSON(K.meta, meta);
    }, 800);
  };
  const saveUi = () => { writeJSON(K.ui, ui); };

  // ===========================================================================
  // Time
  // ===========================================================================
  const ms = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? t : null; };

  /**
   * A countdown, in the units that matter at that distance. A day-long wait does not
   * need seconds; the last minutes of a one-hour window are the entire point of this
   * tool, so those get them.
   */
  const fmtLeft = (left) => {
    if (left == null) return '—';
    if (left <= 0) return 'now';
    const s = Math.ceil(left / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    const h = Math.floor(s / 3600);
    return `${h}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  };

  const fmtAgo = (at) => {
    if (!at) return 'never';
    const s = Math.floor((Date.now() - at) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  const clock = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

  /**
   * A wall-clock instant, carrying its day whenever that is not today.
   *
   * This is not tidiness. An appointment set roughly a day out lands at close to the hour
   * it was made, so a bare "09:30 PM" against a 23h countdown reads as this evening — the
   * exact misreading the tool exists to prevent. Today stays bare because the hour that
   * matters, the one-hour window, is always today by the time you are looking at it.
   */
  const when = (t) => {
    if (!t) return '—';
    const d = new Date(t);
    return d.toDateString() === new Date().toDateString()
      ? clock(t)
      : `${d.toLocaleDateString([], { weekday: 'short' })} ${clock(t)}`;
  };

  // ===========================================================================
  // The lead state machine — a deliberate mirror of the client's own.
  //
  // SleeperRecruitmentPage derives each card's badge from two helpers, isPast(t) and
  // canAct(lead), where canAct requires BOTH next_meeting_at and expires_at to be
  // present and now to fall between them. Reproduced here field for field, because a
  // countdown that disagrees with the button it is pointing at is worse than no
  // countdown: it would send you to a card whose action is greyed out.
  //
  // One inherited quirk, worth knowing rather than fixing: the game's badge hardcodes
  // the string "1h window" while the chip beside it prints window_minutes from the
  // server. Everything here is sized off expires_at instead, which is the server's own
  // instant and cannot disagree with itself.
  // ===========================================================================
  const isPast = (iso) => { const t = ms(iso); return t == null || t <= Date.now(); };

  const canAct = (l, now = Date.now()) => {
    if (l.status === 'lead') return true;
    const meet = ms(l.next_meeting_at), exp = ms(l.expires_at);
    return meet != null && exp != null && now >= meet && now <= exp;
  };

  /** 'new' | 'waiting' | 'open' | 'missed' | 'unknown' */
  const leadState = (l, now = Date.now()) => {
    if (!l) return 'unknown';
    if (l.status === 'lead') return 'new';
    const meet = ms(l.next_meeting_at), exp = ms(l.expires_at);
    if (meet != null && now < meet) return 'waiting';
    if (canAct(l, now)) return 'open';
    if (exp != null && now > exp) return 'missed';
    return 'unknown';
  };

  /** What a row is counting down TO, and how long is left of it. */
  const leadTimer = (l, now = Date.now()) => {
    const st = leadState(l, now);
    if (st === 'waiting') return { to: 'opens', left: ms(l.next_meeting_at) - now, at: ms(l.next_meeting_at) };
    if (st === 'open') return { to: 'closes', left: ms(l.expires_at) - now, at: ms(l.expires_at) };
    return { to: null, left: null, at: null };
  };

  // The faction panel's own readiness test, which is isPast by another name: a null
  // cooldown means ready, and so does one in the past.
  const facReady = (iso) => isPast(iso);

  // ===========================================================================
  // Ingest — every record here came off a response the game made on its own.
  //
  // The recruitment screen refetches every 30 seconds while you stand on it, so the
  // lead half is written to be idempotent: rows upsert by id, and only a change to a
  // meeting timestamp is treated as news. The important asymmetry is that a lead's
  // ABSENCE is also a reading — the poll returns the whole list, so a lead that stops
  // appearing has ended, and how it ended is the thing worth keeping.
  // ===========================================================================
  const num = (v) => (Number.isFinite(v) ? v : null);
  const str = (v) => (typeof v === 'string' && v ? v : null);
  const clueOf = (r) => (typeof r?.traits?.clue === 'string' ? r.traits.clue : null);

  const ingestRecruitment = (data) => {
    if (!data || !Array.isArray(data.leads)) return;
    const now = Date.now();

    meta = {
      ...meta,
      faction_name: str(data.faction_name) ?? meta.faction_name ?? null,
      location_name: str(data.location_name) ?? meta.location_name ?? null,
      window_minutes: num(data.window_minutes) ?? meta.window_minutes ?? null,
      recruited_count: num(data.recruited_count) ?? meta.recruited_count ?? null,
      sleeper_cap: num(data.sleeper_cap) ?? meta.sleeper_cap ?? null,
      energy_cost: num(data.energy_cost) ?? meta.energy_cost ?? null,
      issues: (Array.isArray(data.issues) && data.issues.length) ? data.issues.slice(0, 60) : (meta.issues ?? null),
      sites: Array.isArray(data.districts)
        ? data.districts.reduce((n, d) => n + (Array.isArray(d.sites) ? d.sites.length : 0), 0)
        : (meta.sites ?? null),
      polledAt: now,
    };

    const present = new Set();
    for (const r of data.leads) {
      if (!r || r.id == null) continue;
      const id = String(r.id);
      present.add(id);
      const cur = leads[id] || { id, firstSeen: now };
      const next = {
        ...cur,
        id,
        display_name: str(r.display_name) ?? cur.display_name ?? null,
        archetype_name: str(r.archetype_name) ?? cur.archetype_name ?? null,
        site_name: str(r.site_name) ?? cur.site_name ?? null,
        issue: str(r.issue) ?? cur.issue ?? null,
        clue: clueOf(r) ?? cur.clue ?? null,
        status: str(r.status) ?? cur.status ?? null,
        next_meeting_at: r.next_meeting_at ?? null,
        expires_at: r.expires_at ?? null,
        meeting_count: num(r.meeting_count) ?? cur.meeting_count ?? 0,
        lastSeen: now,
        gone: false,
      };
      // A fresh appointment retires whatever the strip already said about the old one.
      if (next.next_meeting_at !== cur.next_meeting_at) {
        next.announcedMissed = false;
        delete ui.muted[`lead:${id}:${cur.expires_at ?? ''}`];
      }
      leads[id] = next;
    }

    // Absence is a reading too — but only from a poll that actually returned the list.
    for (const [id, l] of Object.entries(leads)) {
      if (present.has(id) || l.gone) continue;
      leads[id] = { ...l, gone: true, goneAt: now, goneState: leadState(l, now) };
      recordEnd(leads[id]);
    }

    if (Array.isArray(data.sleepers)) for (const s of data.sleepers) ingestSleeper(s, 'mine');
    save(); saveUi(); paint();
  };

  /**
   * The recruitment page and the faction panel describe the same rows from opposite
   * sides — the first knows where a sleeper came from, the second knows when it can act
   * again. Merged by id, with the faction fields stamped so a cooldown can say how old
   * the reading behind it is rather than presenting itself as current.
   */
  const ingestSleeper = (s, src, factionId) => {
    if (!s || s.id == null) return;
    const id = String(s.id);
    const cur = sleepers[id] || { id, firstSeen: Date.now() };
    sleepers[id] = {
      ...cur,
      id,
      display_name: str(s.display_name) ?? cur.display_name ?? null,
      archetype_name: str(s.archetype_name) ?? cur.archetype_name ?? null,
      site_name: str(s.site_name) ?? cur.site_name ?? null,
      issue: str(s.issue) ?? cur.issue ?? null,
      clue: clueOf(s) ?? cur.clue ?? null,
      effectiveness: num(s.effectiveness) ?? cur.effectiveness ?? null,
      recruited_at: s.recruited_at ?? cur.recruited_at ?? null,
      recruiter_username: str(s.recruiter_username) ?? cur.recruiter_username ?? null,
      ...(src === 'faction' ? {
        can_advocate_at: s.can_advocate_at ?? null,
        can_embezzle_at: s.can_embezzle_at ?? null,
        factionId: factionId ?? cur.factionId ?? null,
        facSeen: Date.now(),
      } : {}),
      mine: src === 'mine' ? true : (cur.mine ?? false),
      lastSeen: Date.now(),
    };
  };

  const ingestFactionSleepers = (path, data) => {
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.sleepers) ? data.sleepers : null);
    if (!rows) return;
    const fid = (/\/api\/factions\/([^/]+)\/sleepers/.exec(path) || [])[1] ?? null;
    if (fid) meta.factionId = fid;
    for (const s of rows) ingestSleeper(s, 'faction', fid);
    meta.facPolledAt = Date.now();
    save(); paint();
  };

  /**
   * The reply to a meeting you pressed. `outcome === 'lost'` is the only value the
   * client branches on, so it is the only one whose meaning is known; anything else is
   * recorded verbatim rather than bucketed into a guess.
   *
   * The issue is read off the page's own <select> at the instant the reply lands. It is
   * a DOM read of the screen you are standing on, and it is the missing half of the open
   * question in docs/08 — the clue names an issue, the selector is global, and nothing
   * client-side says whether matching them is what advances a lead. Pair enough of these
   * and the answer stops being an inference.
   */
  const ingestMeet = (path, data) => {
    const id = (/\/sleeper-recruitment\/([^/]+)\/meet/.exec(path) || [])[1];
    if (!id) return;
    const l = leads[String(id)] || null;
    ledger.push({
      kind: 'meet',
      at: Date.now(),
      leadId: String(id),
      name: l?.display_name ?? null,
      clue: l?.clue ?? null,
      leadIssue: l?.issue ?? null,
      chosenIssue: readSelectedIssue(),
      countBefore: l?.meeting_count ?? null,
      outcome: str(data?.outcome) ?? null,
    });
    trimLedger(); save();
  };

  /** How a lead left the list, as far as its last reading can honestly support. */
  const recordEnd = (l) => {
    ledger.push({
      kind: 'end',
      at: l.goneAt,
      leadId: l.id,
      name: l.display_name ?? null,
      clue: l.clue ?? null,
      leadIssue: l.issue ?? null,
      state: l.goneState,
      meetings: l.meeting_count ?? 0,
    });
    trimLedger();
  };

  const trimLedger = () => {
    if (ledger.length > CFG.MAX_LEDGER) ledger.splice(0, ledger.length - CFG.MAX_LEDGER);
  };

  /**
   * The page's Conversation Issue dropdown. Matched against the issue list the server
   * itself sent rather than on any class name — generated classes change every deploy,
   * and this has to keep working across one.
   */
  const readSelectedIssue = () => {
    try {
      if (location.pathname !== RECRUIT_PATH) return null;
      const known = new Set(meta.issues || []);
      if (!known.size) return null;
      for (const sel of document.querySelectorAll('select')) {
        if (sel.value && known.has(sel.value)) return sel.value;
      }
    } catch { /* best effort; the outcome row is still worth keeping without it */ }
    return null;
  };

  // ===========================================================================
  // Passive tap — reads responses already in flight. Adds no requests itself.
  // ===========================================================================
  const route = (u) => {
    try { const x = new URL(u, location.origin); return x.pathname + x.search; }
    catch { return String(u); }
  };

  const RECRUIT_RE = /\/api\/actions\/sleeper-recruitment(\?|$)/;
  const MEET_RE = /\/api\/actions\/sleeper-recruitment\/[^/]+\/meet(\?|$)/;
  const FACSLEEP_RE = /\/api\/factions\/[^/]+\/sleepers(\?|$)/;

  const dispatch = (url, data) => {
    const p = route(url);
    if (MEET_RE.test(p)) ingestMeet(p, data);
    else if (RECRUIT_RE.test(p)) ingestRecruitment(data);
    else if (FACSLEEP_RE.test(p)) ingestFactionSleepers(p, data);
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
    this.__pkswUrl = u;
    return origOpen.call(this, m, u, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        const u = this.__pkswUrl || '';
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
  const liveLeads = () => Object.values(leads).filter((l) => !l.gone);

  /**
   * Urgency order, and both the panel and the strip use it: something you can act on
   * now, soonest to CLOSE, comes before anything you are merely waiting for.
   */
  const RANK = { open: 0, new: 1, waiting: 2, unknown: 3, missed: 4 };
  const sortedLeads = (now = Date.now()) => liveLeads()
    .map((l) => ({ l, st: leadState(l, now), t: leadTimer(l, now) }))
    .sort((a, b) => (RANK[a.st] - RANK[b.st])
      || ((a.t.left ?? Infinity) - (b.t.left ?? Infinity))
      || String(a.l.display_name).localeCompare(String(b.l.display_name)));

  const facSleepers = () => Object.values(sleepers).filter((s) => s.facSeen);

  /** Everything actionable this second, plus the soonest thing that is not yet. */
  const board = (now = Date.now()) => {
    const rows = sortedLeads(now);
    const open = rows.filter((r) => r.st === 'open');
    const fresh = rows.filter((r) => r.st === 'new');
    const waiting = rows.filter((r) => r.st === 'waiting');
    const missed = rows.filter((r) => r.st === 'missed');
    const adv = ui.facTier ? facSleepers().filter((s) => facReady(s.can_advocate_at)) : [];
    const emb = ui.facTier ? facSleepers().filter((s) => facReady(s.can_embezzle_at)) : [];
    return { rows, open, fresh, waiting, missed, adv, emb, next: waiting[0] ?? null };
  };

  /**
   * Leads whose window closed while nobody was looking. Marked once, and reported
   * plainly, because a missed lead cannot be recovered — the action button never
   * re-enables and Drop is all that is left. Saying so is more use than a countdown
   * that silently hit zero.
   */
  const sweepMissed = (now = Date.now()) => {
    const fresh = [];
    for (const l of Object.values(leads)) {
      if (l.gone || l.announcedMissed) continue;
      if (leadState(l, now) !== 'missed') continue;
      leads[l.id] = { ...l, announcedMissed: true };
      fresh.push(leads[l.id]);
    }
    if (fresh.length) save();
    return fresh;
  };

  /**
   * What the ledger can say about the open question in docs/08: does talking about the
   * lead's own issue advance it, and does talking about another one lose it? Counted,
   * never asserted — the panel prints how many observations are behind each number, so
   * a two-sample coincidence cannot read as a finding.
   */
  const issueDigest = () => {
    const b = { match: { n: 0, lost: 0 }, miss: { n: 0, lost: 0 }, unknown: { n: 0, lost: 0 } };
    for (const r of ledger) {
      if (r.kind !== 'meet') continue;
      const k = (!r.chosenIssue || !r.leadIssue) ? 'unknown'
        : (r.chosenIssue === r.leadIssue ? 'match' : 'miss');
      b[k].n++;
      if (r.outcome === 'lost') b[k].lost++;
    }
    return b;
  };

  /** Meetings survived before a lead ended, grouped by how it ended. */
  const endDigest = () => {
    const out = {};
    for (const r of ledger) {
      if (r.kind !== 'end') continue;
      const k = r.state || 'unknown';
      (out[k] = out[k] || { n: 0, meetings: [] }).n++;
      out[k].meetings.push(r.meetings ?? 0);
    }
    return out;
  };

  // ===========================================================================
  // Jump — the same client-side navigation as clicking Actions -> Recruit Sleepers,
  // followed by a best-effort attempt to save you the hunting: set the page's issue
  // dropdown to THIS lead's issue, and scroll its card into view.
  //
  // The dropdown part is not decoration. The page has one issue selector and every lead
  // carries its own issue, so the selector is wrong for at least one card whenever you
  // hold more than one lead — and a meeting can come back `lost`. Setting it draws the
  // same line the rest of this repo draws: the tool lines the shot up, the operator
  // takes it. Nothing here presses Talk about issue.
  //
  // Everything after the navigation is optional. If the markup moved since this was
  // written you are still on the right screen, with the right lead named in the panel.
  // ===========================================================================
  const navigate = (path) => {
    if (location.pathname === path) return;
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  /** Retry the cosmetic half until the route has actually rendered, then stop. */
  const settle = (fn) => {
    let tries = 0;
    const tick = () => {
      if (++tries > 24) return;                       // ~4s, then give up quietly
      let done = false;
      try { done = fn(); } catch { /* best effort */ }
      if (!done) setTimeout(tick, 160);
    };
    setTimeout(tick, 160);
  };

  const jumpToLead = (lead) => {
    navigate(RECRUIT_PATH);
    settle(() => setIssue(lead?.issue) && highlightCard(lead?.display_name));
  };

  const jumpToFaction = () => {
    navigate(meta.factionId ? `/factions/${meta.factionId}` : '/faction');
    settle(() => clickTab('Sleepers'));
  };

  /** React ignores a plain .value assignment, so go through the native setter. */
  const setIssue = (issue) => {
    if (!issue) return true;
    const target = [...document.querySelectorAll('select')]
      .find((s) => s.offsetParent !== null && [...s.options].some((o) => o.value === issue));
    if (!target) return false;
    if (target.value !== issue) {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(target, issue);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  };

  /**
   * Find the lead's card by its own name and mark it. Matched on a leaf whose entire
   * text IS the name — never a class, which changes every deploy, and never an ancestor,
   * which would outline half the screen.
   */
  const highlightCard = (name) => {
    if (!name) return true;
    const leaf = [...document.querySelectorAll('p,span,div,h3,h4,b,strong')]
      .find((n) => !n.children.length && n.textContent.trim() === name && n.offsetParent !== null);
    if (!leaf) return false;
    const card = leaf.closest('article') || leaf.parentElement;
    if (!card) return false;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = card.style.outline;
    card.style.outline = '2px solid #4ade80';
    card.style.outlineOffset = '2px';
    setTimeout(() => { card.style.outline = prev; card.style.outlineOffset = ''; }, 6_000);
    return true;
  };

  /** The faction page's tab strip is local component state with no URL, so click it. */
  const clickTab = (label) => {
    const b = [...document.querySelectorAll('button,a,[role="tab"]')]
      .find((n) => n.textContent.trim() === label && n.offsetParent !== null);
    if (!b) return false;
    b.click();
    return true;
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
  // Panel
  // ===========================================================================
  let host = null, root = null, fab = null, fabDot = null, panelEl = null, stripEl = null;
  let hdEl = null, covEl = null, tabsEl = null, bodyEl = null, noteEl = null;
  const tabBtn = {};
  let panelDrag = null, fabDrag = null, stripDrag = null, panelResize = null, placed = false;
  let lastSig = null;          // board signature; a change means a full repaint is due
  let missedThisSession = [];  // what closed while nobody was looking

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
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
    .fab { --pk-slot: 6; z-index: 2147483000; }
    .fab.hot { border-color: #22c55e; color: #4ade80; }
    .fab.soon { border-color: #f59e0b; color: #fbbf24; }
    .fab .dot {
      position: absolute; top: -5px; right: -5px; min-width: 15px; height: 15px; padding: 0 3px;
      border-radius: 8px; background: #22c55e; color: #052e16; font-size: 9px; font-weight: 700;
      display: none; place-items: center; line-height: 15px; text-align: center;
    }
    .fab.hot .dot { display: block; }
    .fab.soon .dot { display: block; background: #f59e0b; color: #451a03; }

    /* The strip. In-page only, and it never appears anywhere but the page you are
       already looking at — no notification, no sound, no title. */
    .strip {
      position: fixed; right: 12px; bottom: 248px; z-index: 2147483000; max-width: min(460px, calc(100vw - 24px));
      display: none; align-items: center; gap: 10px; padding: 8px 10px;
      background: #09090b; color: #e4e4e7; border: 1px solid #27272a; border-left: 3px solid #22c55e;
      border-radius: 4px; box-shadow: 0 10px 40px rgba(0,0,0,.7); font-size: 12px; cursor: grab;
      user-select: none;
    }
    .strip.on { display: flex; }
    .strip.warn { border-left-color: #f59e0b; }
    .strip .txt { min-width: 0; }
    .strip .h { font-weight: 600; letter-spacing: .04em; }
    .strip .s { color: #a1a1aa; font-size: 11px; margin-top: 2px; }
    .strip .grow { flex: 1; }

    .panel {
      position: fixed; right: 12px; bottom: 248px; width: ${CFG.PANEL_W}px;
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
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 10px; }
    .tabs { display: flex; gap: 4px; padding: 6px 10px 0; border-bottom: 1px solid #27272a; }
    .tab {
      padding: 4px 9px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
      background: none; border: 1px solid transparent; border-bottom: none; color: #71717a;
      cursor: pointer; border-radius: 3px 3px 0 0;
    }
    .tab.on { color: #e4e4e7; background: #18181b; border-color: #27272a; }
    button.act {
      background: #18181b; color: #d4d4d8; border: 1px solid #3f3f46; border-radius: 3px;
      padding: 3px 8px; font-size: 10px; cursor: pointer; white-space: nowrap;
    }
    button.act:hover { border-color: #71717a; }
    button.act.go { border-color: #22c55e; color: #4ade80; }
    button.act.go:hover { background: #052e16; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #18181b; white-space: nowrap; }
    th { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.mono { font-variant-numeric: tabular-nums; }
    .dim { color: #71717a; }
    .warn { color: #fbbf24; }
    .bad { color: #f87171; }
    .good { color: #4ade80; }
    .badge {
      display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px;
      letter-spacing: .08em; text-transform: uppercase;
    }
    .badge.open { background: rgba(34,197,94,.12); color: #4ade80; }
    .badge.new { background: rgba(96,165,250,.12); color: #60a5fa; }
    .badge.waiting { background: #27272a; color: #a1a1aa; }
    .badge.missed { background: rgba(248,113,113,.12); color: #f87171; }
    .badge.unknown { background: #27272a; color: #71717a; }
    .note { padding: 6px 10px; border-top: 1px solid #27272a; font-size: 10px; color: #71717a; line-height: 1.5; }
    .empty { padding: 18px 6px; text-align: center; color: #52525b; font-size: 11px; line-height: 1.6; }
    .lost { margin-bottom: 8px; padding: 6px 8px; border: 1px solid rgba(248,113,113,.3);
            background: rgba(248,113,113,.05); color: #fca5a5; border-radius: 3px; font-size: 11px; line-height: 1.5; }
    .kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 11px; margin-bottom: 10px; }
    .kv .k { color: #71717a; }
    label.opt { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: #a1a1aa; margin-right: 10px; }
    h6 { margin: 12px 0 4px; font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: .08em; font-weight: 500; }
    h6:first-child { margin-top: 0; }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /**
   * A cell whose text is a countdown. The tick updates these in place rather than
   * rebuilding the panel, so a redraw every second cannot fight a drag in progress.
   */
  const countdownCell = (tag, cls, deadline) => {
    const n = el(tag, cls, fmtLeft(deadline == null ? null : deadline - Date.now()));
    if (deadline != null) n.dataset.deadline = String(deadline);
    return n;
  };

  const btn = (label, cls, fn) => {
    const b = el('button', `act${cls ? ` ${cls}` : ''}`, label);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
    return b;
  };

  const TABS = [
    ['leads', 'leads'],
    ['sleepers', 'sleepers'],
    ['research', 'research'],
  ];

  // ---------------------------------------------------------------------------
  // Tab bodies
  // ---------------------------------------------------------------------------
  const table = (cols, rows) => {
    const t = el('table');
    const tr = el('tr');
    for (const c of cols) tr.append(el('th', c.cls, c.label));
    const th = el('thead');
    th.append(tr);
    t.append(th);
    const tb = el('tbody');
    for (const r of rows) {
      const row = el('tr');
      for (const cell of r) row.append(cell);
      tb.append(row);
    }
    t.append(tb);
    return t;
  };

  function renderLeads(body) {
    const now = Date.now();
    const b = board(now);

    if (missedThisSession.length) {
      const box = el('div', 'lost');
      box.append(el('div', null,
        `${missedThisSession.length} window${missedThisSession.length > 1 ? 's' : ''} closed while you were away: `
        + missedThisSession.map((l) => l.display_name ?? l.id).join(', ')));
      box.append(el('div', 'dim',
        'A missed lead cannot be re-opened — the action stays disabled and only Drop is left.'));
      const clear = btn('dismiss', null, () => { missedThisSession = []; paint(); });
      clear.style.marginTop = '6px';
      box.append(clear);
      body.append(box);
    }

    if (!b.rows.length) {
      body.append(el('div', 'empty',
        meta.polledAt
          ? 'No live leads. Canvass a site on the recruitment screen and they show up here.'
          : 'Nothing recorded yet.\nOpen Actions → Recruit Sleepers once; this fills itself from the poll that page already makes.'));
      return;
    }

    const rows = b.rows.map(({ l, st, t }) => {
      const name = el('td', null, l.display_name ?? `#${l.id}`);
      name.title = `${l.archetype_name ?? 'unknown archetype'} · ${l.site_name ?? 'unknown site'}`;

      const state = el('td');
      state.append(el('span', `badge ${st}`, st === 'open' ? 'window open' : st));

      const left = countdownCell('td', 'mono', t.at);
      if (st === 'open') left.classList.add('good');
      else if (st === 'waiting' && t.left != null && t.left < CFG.HEADS_UP_MS) left.classList.add('warn');

      const win = el('td', 'dim mono', t.at ? `${t.to} ${when(t.at)}` : '—');
      const meets = el('td', 'num', String(l.meeting_count ?? 0));

      const issue = el('td', 'dim', l.issue ?? '—');
      issue.title = l.clue ? `clue: ${l.clue}` : 'no clue recorded';

      const go = el('td');
      if (st !== 'missed') go.append(btn('go →', st === 'open' || st === 'new' ? 'go' : null, () => jumpToLead(l)));
      else go.append(el('span', 'dim', '—'));

      return [name, state, left, win, meets, issue, go];
    });

    body.append(table([
      { label: 'lead' }, { label: 'state' }, { label: 'left' }, { label: 'window' },
      { label: 'meets', cls: 'num' }, { label: 'issue' }, { label: '' },
    ], rows));

    if (b.rows.some((r) => r.l.clue)) {
      body.append(el('div', 'note',
        'Hover a lead for its archetype and site; hover the issue for its clue. The go button sets the '
        + "page's issue dropdown to that lead's own issue — one selector, many leads, so it is wrong for "
        + 'at least one card whenever you hold more than one.'));
    }
  }

  function renderSleepers(body) {
    const all = Object.values(sleepers);
    if (!all.length) {
      body.append(el('div', 'empty',
        'No sleepers recorded yet.\nRecruited sleepers appear from the recruitment screen; their advocate and '
        + 'embezzle cooldowns come from your faction page, and only if your rank carries can_manage_sleepers.'));
      return;
    }

    const fac = facSleepers();
    const rows = all
      .sort((x, y) => (y.effectiveness ?? -1) - (x.effectiveness ?? -1))
      .map((s) => {
        const name = el('td', null, s.display_name ?? `#${s.id}`);
        name.title = s.archetype_name ?? '';
        const eff = el('td', 'num', s.effectiveness == null ? '—' : `${s.effectiveness}%`);
        const site = el('td', 'dim', s.site_name ?? '—');

        const mk = (iso, seen) => {
          if (!seen) return el('td', 'dim', '—');
          if (facReady(iso)) return el('td', 'good', 'ready');
          const c = countdownCell('td', 'mono warn', ms(iso));
          c.title = `ready at ${when(ms(iso))}`;
          return c;
        };
        const adv = mk(s.can_advocate_at, s.facSeen);
        const emb = mk(s.can_embezzle_at, s.facSeen);
        const by = el('td', 'dim', s.recruiter_username ?? (s.mine ? 'you' : '—'));
        return [name, eff, site, adv, emb, by];
      });

    body.append(table([
      { label: 'sleeper' }, { label: 'effect', cls: 'num' }, { label: 'site' },
      { label: 'advocate' }, { label: 'embezzle' }, { label: 'recruiter' },
    ], rows));

    const foot = el('div', 'note');
    if (!fac.length) {
      foot.append(el('div', null,
        'No cooldowns yet. They arrive only from the faction page’s Sleepers tab, which the client hides '
        + 'entirely unless your rank has can_manage_sleepers — so a player without that rank can run the '
        + 'whole recruitment loop and never see the button that makes it pay.'));
    } else {
      foot.append(el('div', null,
        `cooldowns as of ${fmtAgo(meta.facPolledAt)} · advocate generates power, embezzle siphons cash`));
      const go = btn('faction →', 'go', () => jumpToFaction());
      go.style.marginTop = '6px';
      foot.append(go);
    }
    body.append(foot);
  }

  function renderResearch(body) {
    const iss = issueDigest();
    const ends = endDigest();
    const meets = ledger.filter((r) => r.kind === 'meet');

    body.append(el('h6', null, 'does the issue have to match the clue?'));
    const total = iss.match.n + iss.miss.n;
    if (!total) {
      body.append(el('div', 'dim',
        'Nothing yet. Every meeting you press records the issue that was selected against the issue the lead '
        + 'carries; a few dozen of those answer a question the client cannot.'));
    } else {
      const pct = (o) => (o.n ? `${Math.round((o.lost / o.n) * 100)}%` : '—');
      body.append(table([
        { label: 'issue chosen' }, { label: 'meetings', cls: 'num' },
        { label: 'lost', cls: 'num' }, { label: 'lost rate', cls: 'num' },
      ], [
        [el('td', null, "the lead's own"), el('td', 'num', String(iss.match.n)),
          el('td', 'num', String(iss.match.lost)), el('td', 'num', pct(iss.match))],
        [el('td', null, 'a different one'), el('td', 'num', String(iss.miss.n)),
          el('td', 'num', String(iss.miss.lost)), el('td', 'num', pct(iss.miss))],
        [el('td', 'dim', 'not recorded'), el('td', 'num dim', String(iss.unknown.n)),
          el('td', 'num dim', String(iss.unknown.lost)), el('td', 'num dim', pct(iss.unknown))],
      ]));
      if (total < 20) {
        body.append(el('div', 'note',
          `${total} observation${total > 1 ? 's' : ''} — too few to conclude anything. The number is here so `
          + 'it can grow, not so it can be quoted.'));
      }
    }

    body.append(el('h6', null, 'how leads ended'));
    const endRows = Object.entries(ends).map(([state, o]) => {
      const avg = o.meetings.length
        ? (o.meetings.reduce((a, b) => a + b, 0) / o.meetings.length).toFixed(1) : '—';
      return [el('td', null, state), el('td', 'num', String(o.n)), el('td', 'num', avg)];
    });
    if (!endRows.length) body.append(el('div', 'dim', 'No lead has left the list since this was installed.'));
    else {
      body.append(table([{ label: 'last state' }, { label: 'n', cls: 'num' },
        { label: 'avg meetings', cls: 'num' }], endRows));
      body.append(el('div', 'note',
        'A lead that vanished while its window was open most likely converted; one that vanished after '
        + 'expiring was pruned. The server never says which, so the state is the last one observed, not a verdict.'));
    }

    body.append(el('h6', null, `meeting log (${meets.length})`));
    if (!meets.length) body.append(el('div', 'dim', 'No meetings observed yet.'));
    else {
      body.append(table([
        { label: 'when' }, { label: 'lead' }, { label: 'clue' },
        { label: 'lead issue' }, { label: 'chosen' }, { label: 'outcome' },
      ], meets.slice(-40).reverse().map((r) => [
        el('td', 'dim mono', when(r.at)),
        el('td', null, r.name ?? r.leadId),
        el('td', 'dim', r.clue ?? '—'),
        el('td', 'dim', r.leadIssue ?? '—'),
        el('td', r.chosenIssue && r.chosenIssue === r.leadIssue ? 'good' : null, r.chosenIssue ?? '—'),
        el('td', r.outcome === 'lost' ? 'bad' : null, r.outcome ?? '—'),
      ])));
    }
  }

  // ---------------------------------------------------------------------------
  // The strip — the whole point of the tool, and the only thing it ever shows you
  // unprompted. It is drawn inside the page you are already looking at: no
  // notification, no sound, no title change, nothing that reaches another window.
  // ---------------------------------------------------------------------------
  const stripEvent = (now = Date.now()) => {
    const b = board(now);

    const live = b.open.filter(({ l }) => !ui.muted[`lead:${l.id}:${l.expires_at ?? ''}`]);
    if (live.length) {
      const { l, t } = live[0];
      return {
        key: `lead:${l.id}:${l.expires_at ?? ''}`,
        tone: 'go',
        head: live.length > 1 ? `${live.length} MEETING WINDOWS OPEN` : 'MEETING WINDOW OPEN',
        sub: `${l.display_name ?? l.id} · closes in `,
        deadline: t.at,
        act: ['go →', () => jumpToLead(l)],
      };
    }

    const fresh = b.fresh.filter(({ l }) => !ui.muted[`new:${l.id}`]);
    if (fresh.length) {
      const { l } = fresh[0];
      return {
        key: `new:${l.id}`,
        tone: 'go',
        head: fresh.length > 1 ? `${fresh.length} NEW LEADS` : 'NEW LEAD',
        sub: `${l.display_name ?? l.id} · strike up a conversation to set the appointment`,
        deadline: null,
        act: ['go →', () => jumpToLead(l)],
      };
    }

    if (ui.facTier) {
      const ready = [...new Set([...b.adv, ...b.emb])].filter((s) => !ui.muted[`fac:${s.id}:${s.can_advocate_at ?? ''}:${s.can_embezzle_at ?? ''}`]);
      if (ready.length) {
        const s = ready[0];
        const what = [b.adv.includes(s) ? 'advocate' : null, b.emb.includes(s) ? 'embezzle' : null]
          .filter(Boolean).join(' + ');
        return {
          key: `fac:${s.id}:${s.can_advocate_at ?? ''}:${s.can_embezzle_at ?? ''}`,
          tone: 'go',
          head: ready.length > 1 ? `${ready.length} SLEEPERS READY` : 'SLEEPER READY',
          sub: `${s.display_name ?? s.id} · ${what}`,
          deadline: null,
          act: ['faction →', () => jumpToFaction()],
        };
      }
    }

    const soon = b.next;
    if (soon && soon.t.left != null && soon.t.left <= CFG.HEADS_UP_MS
        && !ui.muted[`soon:${soon.l.id}:${soon.l.next_meeting_at ?? ''}`]) {
      return {
        key: `soon:${soon.l.id}:${soon.l.next_meeting_at ?? ''}`,
        tone: 'warn',
        head: 'WINDOW OPENS SOON',
        sub: `${soon.l.display_name ?? soon.l.id} · in `,
        deadline: soon.t.at,
        act: ['go →', () => jumpToLead(soon.l)],
      };
    }

    return null;
  };

  /** Forget mute keys whose event can never fire again, so the store cannot grow forever. */
  const pruneMuted = () => {
    const live = new Set();
    for (const l of Object.values(leads)) {
      live.add(`lead:${l.id}:${l.expires_at ?? ''}`);
      live.add(`new:${l.id}`);
      live.add(`soon:${l.id}:${l.next_meeting_at ?? ''}`);
    }
    for (const s of Object.values(sleepers)) {
      live.add(`fac:${s.id}:${s.can_advocate_at ?? ''}:${s.can_embezzle_at ?? ''}`);
    }
    let changed = false;
    for (const k of Object.keys(ui.muted)) if (!live.has(k)) { delete ui.muted[k]; changed = true; }
    if (changed) saveUi();
  };

  function paintStrip() {
    if (!stripEl) return;
    const ev = ui.strip ? stripEvent() : null;
    stripEl.replaceChildren();
    stripEl.className = `strip${ev ? ' on' : ''}${ev && ev.tone === 'warn' ? ' warn' : ''}`;
    if (!ev) return;

    const txt = el('div', 'txt');
    txt.append(el('div', 'h', ev.head));
    const sub = el('div', 's');
    sub.append(document.createTextNode(ev.sub));
    if (ev.deadline != null) sub.append(countdownCell('span', null, ev.deadline));
    txt.append(sub);
    stripEl.append(txt, el('div', 'grow'));

    // No dragged() guard here, unlike the FAB. The kit already refuses to start a drag
    // on a button inside the handle, so `moved` is whatever the last strip drag left it
    // as — guarding on it would swallow the first click after you move the strip.
    stripEl.append(btn(ev.act[0], 'go', () => ev.act[1]()));
    stripEl.append(btn('×', null, () => { ui.muted[ev.key] = 1; saveUi(); paintStrip(); paintFab(); }));

    if (stripDrag) { stripDrag.apply(ui.strip_pos); stripDrag.fit(); }
  }

  function paintFab() {
    if (!fab) return;
    const b = board();
    const hot = b.open.length + b.fresh.length + (ui.facTier ? new Set([...b.adv, ...b.emb]).size : 0);
    const soon = !hot && b.next && b.next.t.left != null && b.next.t.left <= CFG.HEADS_UP_MS;
    // toggle(), never assign. Rebuilding className here is what shipped in 0.3.0, and
    // it dropped `pk-fab` on the first repaint — the button kept its position and its
    // click handler and lost the entire FAB KIT box, so it went invisible rather than
    // broken. Nothing throws when that happens, which is why it got out.
    fab.classList.toggle('hot', !!hot);
    fab.classList.toggle('soon', !hot && !!soon);
    fab.classList.toggle('pk-open', ui.open);   // the button says which window is up
    fab.replaceChildren(document.createTextNode('SLP'), fabDot);
    fabDot.textContent = hot ? String(hot) : soon ? '!' : '';
  }

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

    fab = el('div', 'pk-fab fab');
    fab.title = 'Sleeper Watch (Alt+S) — drag to move, double-click to reset';
    fabDot = el('span', 'dot');
    fab.append(document.createTextNode('SLP'), fabDot);
    root.append(fab);

    fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUi(); });
    fabDrag.apply(ui.fab);
    fab.addEventListener('click', () => { if (!fabDrag.dragged()) toggle(); });
    fab.addEventListener('dblclick', () => { ui.fab = null; saveUi(); fabDrag.reset(); });

    stripEl = el('div', 'strip');
    root.append(stripEl);
    stripDrag = draggable(stripEl, stripEl, (pos) => { ui.strip_pos = pos; saveUi(); });
    stripEl.addEventListener('dblclick', () => { ui.strip_pos = null; saveUi(); stripDrag.reset(); });

    // The panel's CHROME is built exactly once, and the drag binds to that one header.
    //
    // It used to be rebuilt inside paint(), which quietly broke dragging: paint() begins
    // with replaceChildren(), so the header the kit was bound to got discarded on the
    // first repaint and every later one was a fresh, unbound node. The panel dragged
    // until the first poll landed and then never again — and because the FAB is bound
    // separately in here, it kept working, which made it look like a panel-only quirk.
    //
    // Only the body and footer are refilled now. That also keeps the drag handle a
    // stable node across a redraw, so a repaint can never land mid-gesture.
    panelEl = el('div', 'panel');
    panelEl.style.display = 'none';

    hdEl = el('div', 'hd');
    covEl = el('span', 'cov');
    hdEl.title = 'Drag to move · drag the bottom-right corner to resize · double-click to reset both';
    hdEl.append(el('b', null, 'Sleeper Watch'), covEl, el('span', 'sp'),
      btn('×', null, () => toggle(false)));

    tabsEl = el('div', 'tabs');
    for (const [key, label] of TABS) {
      const t = el('button', 'tab', label);
      t.addEventListener('click', () => { ui.tab = key; saveUi(); paint(); });
      tabBtn[key] = t;
      tabsEl.append(t);
    }

    bodyEl = el('div', 'body');
    noteEl = el('div', 'note');
    panelEl.append(hdEl, tabsEl, bodyEl, noteEl);
    root.append(panelEl);

    panelDrag = draggable(panelEl, hdEl, (pos) => { ui.panel = pos; saveUi(); });
    panelResize = resizable(panelEl, (size) => { ui.size = size; saveUi(); },
      { drag: panelDrag, minW: 280, minH: 180 });
    // Double-click the header undoes both — the recovery path for a panel dragged
    // or resized into uselessness.
    hdEl.addEventListener('dblclick', () => {
      ui.panel = null; ui.size = null; saveUi();
      panelDrag.reset(); panelResize.reset(); placed = true;
    });
  };

  const toggle = (force) => {
    ui.open = force == null ? !ui.open : !!force;
    saveUi();
    paint();
  };

  function paint() {
    if (!root) return;
    pruneMuted();
    paintFab();
    paintStrip();
    lastSig = signature();

    if (!panelEl) return;
    panelEl.style.display = ui.open ? 'flex' : 'none';
    if (!ui.open) return;

    const b = board();

    // header + tabs: refresh what they SAY, never who they are
    covEl.textContent = [
      `${b.rows.length} lead(s)`,
      meta.recruited_count != null && meta.sleeper_cap != null
        ? `${meta.recruited_count}/${meta.sleeper_cap} recruited` : null,
      meta.energy_cost != null ? `${meta.energy_cost} energy/canvass` : null,
    ].filter(Boolean).join(' · ');
    for (const [key] of TABS) tabBtn[key].className = `tab${ui.tab === key ? ' on' : ''}`;

    // A repaint can arrive on the tick while you are reading a long list, so don't
    // throw away where you had scrolled to.
    const scroll = bodyEl.scrollTop;
    bodyEl.replaceChildren();
    if (ui.tab === 'leads') renderLeads(bodyEl);
    else if (ui.tab === 'sleepers') renderSleepers(bodyEl);
    else renderResearch(bodyEl);
    bodyEl.scrollTop = scroll;

    // footer — options, actions, and how stale the list underneath is
    const note = el('div');
    noteEl.replaceChildren(note);

    const opts = el('div');
    const opt = (label, key, title) => {
      const w = el('label', 'opt');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!ui[key];
      cb.addEventListener('change', () => { ui[key] = cb.checked; saveUi(); paint(); });
      w.append(cb, document.createTextNode(label));
      w.title = title;
      return w;
    };
    opts.append(opt('strip', 'strip', 'show the actionable strip over the game'));
    opts.append(opt('faction tier', 'facTier', 'include advocate/embezzle cooldowns in the strip and the count'));
    note.append(opts);

    const bar = el('div');
    bar.style.margin = '6px 0';
    for (const [label, fn] of [
      ['copy digest', (bt) => copyText(buildDigest(), bt)],
      ['export', () => download(`sleeper-watch-${VERSION}.json`, JSON.stringify({ leads, sleepers, ledger, meta }, null, 2))],
      ['clear', () => {
        leads = {}; sleepers = {}; ledger = []; meta = {}; ui.muted = {}; missedThisSession = [];
        writeJSON(K.leads, leads); writeJSON(K.sleepers, sleepers);
        writeJSON(K.ledger, ledger); writeJSON(K.meta, meta); saveUi();
        paint();
      }],
    ]) { const x = btn(label, null, fn); x.style.marginRight = '4px'; bar.append(x); }
    note.append(bar);

    note.append(el('div', null,
      `list as of ${fmtAgo(meta.polledAt)} — it only refreshes while you stand on the recruitment screen. `
      + 'The countdowns are exact regardless: they run off the absolute timestamps the server already sent, '
      + 'so no request is needed to keep them honest. Passive · nothing here canvasses, meets, drops, '
      + 'advocates or embezzles.'));

    // Restore the saved position the first time the panel is actually on screen — at
    // mount it is display:none, so the kit has no geometry to clamp or de-skew against.
    // After that only fit() runs: apply() would fight a drag in progress, since ui.panel
    // still holds the pre-drag position until the gesture ends.
    if (!placed) { placed = true; panelDrag.apply(ui.panel); panelResize.apply(ui.size); }
    panelDrag.fit();
  }

  /**
   * A cheap fingerprint of everything that changes what the panel SHOWS, as opposed to
   * what it counts. The tick compares it and only rebuilds when a lead actually crosses
   * a state boundary — so a redraw can never land in the middle of a drag.
   */
  const signature = () => {
    const now = Date.now();
    const b = board(now);
    return [
      b.rows.map((r) => `${r.l.id}:${r.st}`).join('|'),
      b.adv.length, b.emb.length,
      (stripEvent(now) || {}).key ?? '-',
    ].join('#');
  };

  /**
   * The only repeating timer in this file, and it touches nothing but text nodes:
   * subtract now from a deadline already in the DOM. No fetch, no XHR, no navigation,
   * and it stops entirely while the tab is hidden.
   */
  const tick = () => {
    if (document.visibilityState !== 'visible' || !root) return;
    const missed = sweepMissed();
    if (missed.length) { missedThisSession.push(...missed); paint(); return; }
    if (signature() !== lastSig) { paint(); return; }
    const now = Date.now();
    for (const n of root.querySelectorAll('[data-deadline]')) {
      n.textContent = fmtLeft(Number(n.dataset.deadline) - now);
    }
  };

  // ---------------------------------------------------------------------------
  // Output — both operator-initiated, neither ever automatic.
  // ---------------------------------------------------------------------------
  /** Paste-ready and scrubbed by construction: no NPC names, no usernames, counts only. */
  const buildDigest = () => {
    const iss = issueDigest();
    const ends = endDigest();
    const lines = [
      `sleeper-watch ${VERSION} digest`,
      `window_minutes=${meta.window_minutes ?? '?'} energy_cost=${meta.energy_cost ?? '?'} `
        + `cap=${meta.recruited_count ?? '?'}/${meta.sleeper_cap ?? '?'} sites=${meta.sites ?? '?'} `
        + `issues=${(meta.issues || []).length}`,
      `leads live=${liveLeads().length} recorded=${Object.keys(leads).length} `
        + `sleepers=${Object.keys(sleepers).length} with_cooldowns=${facSleepers().length}`,
      '',
      'meetings by issue choice (chosen vs the lead’s own):',
      `  match   n=${iss.match.n} lost=${iss.match.lost}`,
      `  differ  n=${iss.miss.n} lost=${iss.miss.lost}`,
      `  unknown n=${iss.unknown.n} lost=${iss.unknown.lost}`,
      '',
      'lead endings by last observed state:',
      ...Object.entries(ends).map(([k, o]) => {
        const avg = o.meetings.length ? (o.meetings.reduce((a, x) => a + x, 0) / o.meetings.length).toFixed(1) : '—';
        return `  ${k} n=${o.n} avg_meetings=${avg}`;
      }),
    ];
    if (!Object.keys(ends).length) lines.push('  (none yet)');
    return lines.join('\n');
  };

  const copyText = (s, b) => {
    const done = () => { if (b) { const t = b.textContent; b.textContent = 'copied'; setTimeout(() => { b.textContent = t; }, 1200); } };
    if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(s).then(done, () => {}); return; }
    const ta = el('textarea'); ta.value = s; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { /* nothing else to try */ }
    ta.remove();
  };

  const download = (name, text) => {
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
  };

  // ===========================================================================
  // Boot
  // ===========================================================================
  const typing = (t) => /^(input|textarea|select)$/i.test(t?.tagName || '') || t?.isContentEditable;

  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (typing(e.target)) return;
    if (e.key.toLowerCase() === CFG.HOTKEY) { e.preventDefault(); toggle(); }
  });

  // Coming back to the tab is the moment the catch-up matters: whatever closed while
  // you were gone is reported once, here, and never chased into another window.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    missedThisSession.push(...sweepMissed());
    paint();
  });

  const boot = () => {
    mount();
    missedThisSession = sweepMissed();
    paint();
    setInterval(tick, CFG.TICK_MS);
    log(`ready ${VERSION} — passive; the recruitment screen's own 30s poll feeds this`);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Console surface, mirroring the other tools in this repo.
  window.__pksw = {
    leads: () => sortedLeads().map(({ l, st, t }) => ({ ...l, state: st, left: fmtLeft(t.left) })),
    sleepers: () => Object.values(sleepers),
    ledger: () => ledger,
    meta: () => meta,
    issues: () => issueDigest(),
    endings: () => endDigest(),
    digest: () => buildDigest(),
    export: () => ({ leads, sleepers, ledger, meta }),
    clear: () => {
      leads = {}; sleepers = {}; ledger = []; meta = {}; ui.muted = {}; missedThisSession = [];
      writeJSON(K.leads, {}); writeJSON(K.sleepers, {}); writeJSON(K.ledger, []); writeJSON(K.meta, {});
      saveUi(); paint();
    },
  };
})();
