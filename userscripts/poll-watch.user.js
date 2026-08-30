// ==UserScript==
// @name         Politiko — Poll Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.4.0
// @description  Keeps every opinion-poll memo you run — timestamped in real and game time, with the bloc spread, the per-issue trend since your last poll, and TSV/JSON export. Passive: it reads the memo the game already handed you and originates no requests.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/poll-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/poll-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON responses the game client itself requested, on pages you are
 *             actively viewing:
 *               POST /api/actions/poll        — the memo returned by a poll YOU ran.
 *                                               This script does not run polls; it
 *                                               reads the reply to the one you paid
 *                                               for, at the moment it arrives.
 *               GET  /api/actions/poll/issues — the issue list the poll screen loads
 *                                               when you open it; used for labels only
 *               GET  /api/time                — the sidebar polls this every ~60s
 *                                               anyway; used only to stamp each memo
 *                                               with the game date it was taken on
 *             Nothing else is read off the wire. No request body is inspected, no
 *             other page's traffic is touched, and the `auth` localStorage key
 *             (your tokens) is never read.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. There is no re-poll button,
 *             no refresh, no timer that touches the network. A poll costs 5 energy
 *             (plus $500 / $1,000 for the two accurate methods) and sits behind a
 *             server cooldown — spending that on your behalf is exactly the thing
 *             this repo does not do. The panel is a filing cabinet, not a pollster.
 *
 *   Storage:  localStorage keys prefixed `pkpw:` — the captured memos, the issue
 *             list, and panel position/state
 *
 *   Alerts:   none. No notifications, no sound, nothing raised from an unfocused
 *             tab; the panel only redraws while the tab is visible
 *
 *   Clipboard: written ONLY when you click "copy tsv" or "copy json"
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 *
 * WHAT THE NUMBERS ARE, AND WHERE THEY CAME FROM
 *
 * Every field below was read off OpinionPollPage in the 2026-08-03 bundle pull, not
 * off the wire. The memo has two shapes and the client picks between them by testing
 * `far_left === undefined`:
 *
 *   coarse (street poll, online scrape)   left_bloc / center / right_bloc
 *   fine   (professional firm, focus group)
 *                                         far_left / center_left / slight_left /
 *                                         neutral / slight_right / center_right /
 *                                         far_right
 *
 * plus `mood`, `extreme_tag`, `volatility`, `salience`, `popularity`, `best_target`,
 * `persuasion_angle` and `cooldown_until`, any of which may be absent depending on
 * the method you paid for. Street polls are documented in-game as "may be off by
 * ±8%" and the online scrape as "biased toward extreme views", so this panel marks
 * both as approximate rather than pretending the series is uniform.
 *
 * Two derived numbers, and they are ARITHMETIC ON WHAT ARRIVED, not a model:
 *
 *   net   right% − left%, on −100…+100. Defined for both shapes, which makes it the
 *         only series that stays comparable when you switch methods. This is the
 *         number the trend line and the deltas use.
 *   lean  the same spread weighted −3…+3 by bucket, so it lands on the scale the
 *         game's own policy axes use. Fine memos only — a coarse one has nowhere to
 *         put the weights, and inventing them would fabricate precision.
 *
 * The honest limitation: a memo is a snapshot of the moment you bought it. Nothing
 * here refreshes, because refreshing means running a poll, and running a poll is
 * yours to decide. A trend across two street polls is two noisy points, and the
 * panel says so rather than drawing a confident line through them.
 */

(() => {
  'use strict';

  const TAG = '[pk-poll-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { data: 'pkpw:data', ui: 'pkpw:ui' };

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
  // ---------------------------------------------------------------------------

  // OpinionPollPage's method table, verbatim — label, cost, and whether the game
  // itself describes the result as trustworthy.
  const METHOD = {
    street: { tag: 'ST', label: 'street poll', cost: '5 energy', exact: false, why: 'may be off by ±8%' },
    online: { tag: 'ON', label: 'online scrape', cost: '5 energy', exact: false, why: 'biased toward extreme views' },
    professional: { tag: 'PR', label: 'professional firm', cost: '5 energy + $500', exact: true, why: 'exact blocs + volatility' },
    focus_group: { tag: 'FG', label: 'focus group', cost: '5 energy + $1,000', exact: true, why: 'exact data + persuasion angle' },
  };

  // The seven buckets in the order the game renders them, with the −3…+3 weight
  // each one sits at. Weights are this script's arithmetic, not a server field.
  const BUCKETS = [
    ['far_left', 'Far Left', -3, '#1e3a8a'],
    ['center_left', 'Center Left', -2, '#2563eb'],
    ['slight_left', 'Slight Left', -1, '#60a5fa'],
    ['neutral', 'Neutral', 0, '#71717a'],
    ['slight_right', 'Slight Right', 1, '#f87171'],
    ['center_right', 'Center Right', 2, '#dc2626'],
    ['far_right', 'Far Right', 3, '#7f1d1d'],
  ];

  // Colour bands the game uses for the two qualitative fields, so a memo in this
  // panel reads the same as it did on the poll screen.
  const VOL_HEX = { high: '#f87171', moderate: '#fbbf24', stable: '#34d399' };
  const SAL_HEX = { quiet: '#71717a', warm: '#fbbf24', hot: '#fb923c', boiling: '#f87171' };
  const MOOD_HEX = {
    deadlocked: '#fbbf24', 'left-leaning': '#60a5fa',
    'right-leaning': '#f87171', 'apathetic / persuadable': '#34d399',
  };

  // time-watch's calendar, same source: 365-day years, 30-day months, December
  // absorbing days 31–35. See docs/06-time-surface.md.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const GS_YEAR = 31_536_000, GS_MONTH = 2_592_000, GS_DAY = 86_400;
  const FALLBACK_ACCEL = 52.14;

  const parseGameDatetime = (s) => {
    const m = /(\d+):(\d+)\s+(\w+)\s+(\d+),?\s+Y(\d+)/.exec(String(s));
    if (!m) return null;
    const mi = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m[3].toLowerCase()));
    return (+m[5] - 1) * GS_YEAR + Math.max(0, mi) * GS_MONTH
      + (+m[4] - 1) * GS_DAY + (+m[1]) * 3600 + (+m[2]) * 60;
  };

  const gameLabel = (gs) => {
    if (!Number.isFinite(gs)) return null;
    const year = Math.floor(gs / GS_YEAR) + 1;
    const inYear = ((gs % GS_YEAR) + GS_YEAR) % GS_YEAR;
    const mi = Math.min(Math.floor(inYear / GS_MONTH), 11);
    const inMonth = inYear - mi * GS_MONTH;
    const day = Math.floor(inMonth / GS_DAY) + 1;
    const rem = inMonth % GS_DAY;
    const hh = String(Math.floor(rem / 3600)).padStart(2, '0');
    const mm = String(Math.floor((rem % 3600) / 60)).padStart(2, '0');
    return `${MONTHS[mi].slice(0, 3)} ${day}, Y${year} ${hh}:${mm}`;
  };

  // ---------------------------------------------------------------------------
  // Store
  // ---------------------------------------------------------------------------
  const CAP = 400; // memos kept; oldest dropped first

  const data = Object.assign({ polls: [], issues: [], clock: null }, readJSON(K.data, {}));
  const ui = Object.assign(
    // everywhere defaults ON: this one is a notebook, not a home-page mirror — you want
    // it open beside the media tab while picking a document, and beside activism while
    // picking an issue. The pin narrows it to the two pages it is *about*.
    { open: true, view: 'latest', everywhere: true, x: null, y: null, fab: null, size: undefined, issue: null },
    readJSON(K.ui, {}),
  );

  const save = () => writeJSON(K.data, data);
  const saveUI = () => writeJSON(K.ui, ui);

  const num = (v) => (Number.isFinite(+v) ? +v : null);

  /** current game-seconds, freewheeling from the newest /api/time sample the app made */
  const nowGS = () => {
    const c = data.clock;
    if (!c) return null;
    return c.gs + ((Date.now() - c.t) / 1000) * (c.accel || FALLBACK_ACCEL);
  };

  /**
   * Normalise a memo into a stored row. Returns null for anything that isn't one —
   * the tap gates on SHAPE rather than on the HTTP verb, so a failed poll (which
   * returns an error body, not a memo) is ignored for free, and so is any other
   * response that happens to share the path prefix.
   */
  const toRow = (body) => {
    if (!body || typeof body !== 'object') return null;
    if (typeof body.issue !== 'string' || !body.issue) return null;

    const fineKeys = BUCKETS.filter(([k]) => num(body[k]) != null);
    const coarse = num(body.left_bloc) != null || num(body.right_bloc) != null;
    if (fineKeys.length < 2 && !coarse) return null; // not a memo

    const row = {
      t: Date.now(),
      gs: nowGS(),
      issue: body.issue,
      method: typeof body.method === 'string' ? body.method : null,
      mood: typeof body.mood === 'string' ? body.mood : null,
      extreme: typeof body.extreme_tag === 'string' ? body.extreme_tag : null,
      volatility: typeof body.volatility === 'string' ? body.volatility : null,
      salience: typeof body.salience === 'string' ? body.salience : null,
      popularity: num(body.popularity),
      best: typeof body.best_target === 'string' ? body.best_target : null,
      angle: typeof body.persuasion_angle === 'string' ? body.persuasion_angle : null,
      cooldown: typeof body.cooldown_until === 'string' ? body.cooldown_until : null,
      fine: null, coarse: null,
    };

    if (fineKeys.length >= 2) {
      row.fine = {};
      for (const [k] of BUCKETS) row.fine[k] = num(body[k]) ?? 0;
    } else {
      row.coarse = {
        left_bloc: num(body.left_bloc) ?? 0,
        center: num(body.center) ?? 0,
        right_bloc: num(body.right_bloc) ?? 0,
      };
    }
    return row;
  };

  /** left / neutral / right totals, whichever shape the memo came in */
  const blocs = (p) => (p.fine
    ? {
      l: p.fine.far_left + p.fine.center_left + p.fine.slight_left,
      c: p.fine.neutral,
      r: p.fine.slight_right + p.fine.center_right + p.fine.far_right,
    }
    : { l: p.coarse.left_bloc, c: p.coarse.center, r: p.coarse.right_bloc });

  /** right% − left%, on −100…+100. The one series that survives a method change. */
  const net = (p) => { const b = blocs(p); return b.r - b.l; };

  /** the same spread weighted onto the game's own −3…+3 scale. Fine memos only. */
  const lean = (p) => {
    if (!p.fine) return null;
    let s = 0, tot = 0;
    for (const [k, , w] of BUCKETS) { s += p.fine[k] * w; tot += p.fine[k]; }
    return tot > 0 ? s / tot : 0;
  };

  const exact = (p) => METHOD[p.method]?.exact === true;

  /** "R+18" / "L+7" / "even" — never a bare sign, which reads as the wrong axis */
  const sideText = (v, digits = 0) => {
    if (v == null) return '—';        // Number(null) is 0, which would read as a real 'even'
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const m = Math.abs(n).toFixed(digits);
    if (Math.abs(n) < (digits ? 0.05 : 0.5)) return 'even';
    return `${n > 0 ? 'R' : 'L'}+${m}`;
  };

  const issuesSeen = () => {
    const seen = new Map();
    for (const p of data.polls) {
      const list = seen.get(p.issue) ?? [];
      list.push(p);
      seen.set(p.issue, list);
    }
    return seen;
  };

  const addPoll = (row) => {
    // A memo arrives once. Guard anyway: a re-render of the poll screen, or the
    // bench firing the same fixture twice, must not become two data points.
    const twin = data.polls.find((p) => p.issue === row.issue && p.method === row.method
      && Math.abs(p.t - row.t) < 10_000 && net(p) === net(row));
    if (twin) { log('duplicate memo ignored', row.issue); return; }

    data.polls.push(row);
    if (data.polls.length > CAP) data.polls.splice(0, data.polls.length - CAP);
    ui.issue = row.issue; // the issue you just polled is the one you want to look at
    save(); saveUI();
    log('memo filed', row.issue, row.method, 'net', net(row).toFixed(1));
  };

  // ---------------------------------------------------------------------------
  // Passive tap — only responses the app fetched on its own. Adds nothing to the
  // wire: no body is inspected, no request is made, nothing is retried.
  // ---------------------------------------------------------------------------
  const pathOf = (u) => { try { return new URL(u, location.href).pathname; } catch { return ''; } };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const target = args[0];
    const url = typeof target === 'string' ? target : (target?.url ?? '');
    const res = await origFetch.apply(this, args);
    try {
      const path = pathOf(url);
      if (!path.startsWith('/api/')) return res;
      if (!res.headers.get('content-type')?.includes('json')) return res;

      res.clone().json().then((body) => {
        if (path === '/api/time') {
          const gs = parseGameDatetime(body?.datetime);
          if (gs != null) {
            data.clock = { t: Date.now(), gs, accel: Number(body?.acceleration) || FALLBACK_ACCEL };
            save();
          }
          return;
        }
        if (path === '/api/actions/poll/issues') {
          const list = Array.isArray(body?.issues) ? body.issues.filter((s) => typeof s === 'string') : null;
          if (list && list.length) { data.issues = list; save(); scheduleRender(); }
          return;
        }
        if (path === '/api/actions/poll') {
          const row = toRow(body);
          if (row) { addPoll(row); scheduleRender(); }
        }
      }, () => {});
    } catch (e) { log('tap error', e); }
    return res;
  };

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------
  let root = null, panel = null, head = null, body = null, fab = null;
  let title = null, pinBtn = null, drag = null, fabDrag = null, resize = null;

  const CSS = `
    /* FAB KIT v6 — shared verbatim block.
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
       widened it to fourteen for bar-watch, and v6 widens it to fifteen for
       slot-watch. Half the row is written out below because CSS cannot count the
       tools that happen to be installed, which means every slot the row gains costs
       a version bump and a pass over every copy — the price of the row being one row
       rather than each tool's guess at one.

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 15; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       a fifteenth tool does not shuffle the fourteen buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. The eye
       leads because it is the mark of the set; the words are alphabetical after it:

         0  the eye  people-watch     8  TIME  time-watch
         1  ALGN     align-watch      9  WRLD  world-watch
         2  GOV      gov-watch       10  XP    xp-watch
         3  JUMP     quick-jump      11  POLL  poll-watch
         4  MKT      market-watch    12  SHOP  shop-watch
         5  RAID     raid-watch      13  BARS  bar-watch
         6  SLP      sleeper-watch   14  SLOT  slot-watch
         7  SOCK     ws-watch

       POLL, SHOP, BARS and SLOT are on the end rather than sorted in among the
       others, and that is deliberate: the alphabet describes how the first eleven
       were handed out, not a sort to be re-run. Slots are fixed, so a tool that
       arrives later takes the next free number and nothing already on screen moves.

       Fifteen 38px buttons 8px apart is a 682px row, so it runs 341px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1562px the row is centred,
       and below that it stops sliding left rather than climb onto the nav.

       Three numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 341 (half the row). Nothing else in here is placement.

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
      left: calc(max(440px, 50% - 341px) + var(--pk-slot, 0) * 46px);
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
    /* Slot 11 of the kit's home row. This tool used to park its own button on the
       left edge just under time-watch, from the days when a free corner was a
       thing each tool negotiated for; FAB KIT v4 widened the row by one to take
       it, and the corner is nobody's now. Drag it anywhere; it remembers, and
       double-clicking it gives the slot back. */
    .pkpw-fab { --pk-slot: 11; z-index: 2147482000; }
    .pkpw-panel { position: fixed; left: 12px; top: 96px; z-index: 2147482000;
      width: min(360px, calc(100vw - 24px)); max-height: min(78vh, 780px);
      display: flex; flex-direction: column;
      border: 1px solid #3f3f46; border-radius: 8px; background: #09090bf2; color: #e4e4e7;
      font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .pkpw-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
      border-bottom: 1px solid #27272a; user-select: none; }
    .pkpw-head h1 { flex: 1; font-size: 11px; margin: 0; color: #a1a1aa;
      text-transform: uppercase; letter-spacing: .08em; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .pkpw-btn { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
      border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 7px; cursor: pointer; }
    .pkpw-btn:hover { background: #3f3f46; }
    .pkpw-btn[data-on="1"] { border-color: #fbbf24; color: #fbbf24; }
    .pkpw-tabs { display: flex; gap: 4px; padding: 7px 10px 0; }
    .pkpw-body { overflow: auto; padding: 10px; }
    .pkpw-row { display: flex; justify-content: space-between; gap: 8px; }
    .pkpw-dim { color: #a1a1aa; }
    .pkpw-faint { color: #71717a; }
    .pkpw-h2 { margin: 12px 0 5px; color: #a1a1aa; font-size: 10px;
      text-transform: uppercase; letter-spacing: .1em;
      border-top: 1px solid #27272a; padding-top: 8px; }
    .pkpw-h2:first-child { margin-top: 0; border-top: 0; padding-top: 0; }
    .pkpw-big { font-size: 15px; font-weight: 600; }
    .pkpw-tag { font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase;
      border: 1px solid #3f3f46; border-radius: 2px; padding: 0 4px; color: #a1a1aa; }
    .pkpw-stack { display: flex; height: 10px; border-radius: 2px; overflow: hidden;
      background: #27272a; margin: 6px 0 3px; }
    .pkpw-stack span { display: block; height: 100%; }
    .pkpw-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
    .pkpw-bar b { flex: 0 0 82px; font-weight: 400; color: #71767a; font-size: 10px;
      text-transform: uppercase; letter-spacing: .06em; }
    .pkpw-bar i { flex: 1; height: 7px; background: #27272a; border-radius: 2px;
      overflow: hidden; font-style: normal; }
    .pkpw-bar i > span { display: block; height: 100%; }
    .pkpw-bar u { flex: 0 0 34px; text-align: right; text-decoration: none;
      color: #d4d4d8; font-size: 10.5px; }
    .pkpw-list { margin: 0; padding: 0; list-style: none; }
    .pkpw-list li { display: flex; justify-content: space-between; gap: 8px;
      padding: 3px 0; border-bottom: 1px solid #18181b; cursor: pointer; }
    .pkpw-list li:hover { background: #ffffff08; }
    .pkpw-list li[data-on="1"] { color: #fbbf24; }
    .pkpw-note { margin: 10px 0 0; color: #71717a; font-size: 10.5px; line-height: 1.4; }
    .pkpw-quote { margin: 6px 0 0; padding-left: 8px; border-left: 2px solid #3f3f46;
      color: #a1a1aa; font-size: 11px; line-height: 1.5; }
    .pkpw-spark { width: 100%; height: 34px; display: block; margin: 4px 0 2px; }
    .pkpw-tools { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const ago = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m ago`;
    return `${Math.floor(h / 24)}d ${h % 24}h ago`;
  };

  const stamp = (p) => {
    const real = new Date(p.t).toLocaleString(undefined,
      { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const g = gameLabel(p.gs);
    return g ? `${real} · ${g}` : real;
  };

  const countdown = (iso) => {
    const end = Date.parse(iso);
    if (!Number.isFinite(end)) return null;
    const left = end - Date.now();
    if (left <= 0) return null;
    const s = Math.round(left / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  };

  /** the seven-bucket (or three-bloc) stacked bar, built from numbers only */
  const stackOf = (p) => {
    const wrap = el('div', 'pkpw-stack');
    const parts = p.fine
      ? BUCKETS.map(([k, , , hex]) => [p.fine[k], hex])
      : [[p.coarse.left_bloc, '#60a5fa'], [p.coarse.center, '#71717a'], [p.coarse.right_bloc, '#f87171']];
    const total = parts.reduce((a, [v]) => a + Math.max(0, v), 0) || 1;
    for (const [v, hex] of parts) {
      const s = el('span');
      s.style.width = `${(Math.max(0, v) / total) * 100}%`;
      s.style.background = hex;
      wrap.append(s);
    }
    return wrap;
  };

  const barRow = (label, pct, hex) => {
    const row = el('div', 'pkpw-bar');
    row.append(el('b', '', label));
    const track = el('i');
    const fill = el('span');
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    fill.style.background = hex;
    track.append(fill);
    row.append(track, el('u', '', `${Math.round(pct)}%`));
    return row;
  };

  /** net over time for one issue. Numbers only — no server string reaches the SVG. */
  const sparkline = (list) => {
    if (list.length < 2) return null;
    const W = 320, H = 34, PAD = 3;
    const xs = list.map((_, i) => PAD + (i / (list.length - 1)) * (W - 2 * PAD));
    const ys = list.map((p) => {
      const v = Math.max(-100, Math.min(100, net(p)));
      return PAD + ((100 - v) / 200) * (H - 2 * PAD);
    });
    const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const mid = (PAD + (H - PAD) / 1) / 2;
    const dots = xs.map((x, i) => {
      const solid = exact(list[i]);
      return `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="${solid ? 2.1 : 1.7}" `
        + `fill="${solid ? '#e4e4e7' : 'none'}" stroke="#e4e4e7" stroke-width=".8" opacity="${solid ? 1 : .6}"/>`;
    }).join('');
    const wrap = document.createElement('div');
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="pkpw-spark" preserveAspectRatio="none" aria-label="net lean over time">
      <line x1="0" y1="${mid.toFixed(1)}" x2="${W}" y2="${mid.toFixed(1)}" stroke="rgba(255,255,255,.14)" stroke-width=".7"/>
      <polyline points="${pts}" fill="none" stroke="rgba(251,191,36,.75)" stroke-width="1.3"/>
      ${dots}
    </svg>`;
    return wrap;
  };

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  const renderMemo = (p, prev) => {
    const frag = document.createDocumentFragment();

    const m = METHOD[p.method];
    const hdr = el('div', 'pkpw-row');
    hdr.append(el('span', 'pkpw-big', p.issue));
    hdr.append(el('span', 'pkpw-tag', m ? m.tag : (p.method ?? '??')));
    frag.append(hdr);
    frag.append(el('p', 'pkpw-faint', stamp(p)));

    // mood + the two qualitative bands, coloured the way the game colours them
    const line = el('div', 'pkpw-row');
    line.style.marginTop = '6px';
    const mood = el('span', '', p.mood ?? '—');
    if (p.mood && MOOD_HEX[p.mood]) mood.style.color = MOOD_HEX[p.mood];
    line.append(mood);
    if (p.extreme) {
      const x = el('span', 'pkpw-tag', p.extreme);
      x.style.color = '#f87171'; x.style.borderColor = '#f8717155';
      line.append(x);
    }
    frag.append(line);

    frag.append(stackOf(p));

    // the spread itself
    if (p.fine) {
      for (const [k, label, , hex] of BUCKETS) frag.append(barRow(label, p.fine[k], hex));
    } else {
      frag.append(barRow('Left Bloc', p.coarse.left_bloc, '#60a5fa'));
      frag.append(barRow('Neutral', p.coarse.center, '#71717a'));
      frag.append(barRow('Right Bloc', p.coarse.right_bloc, '#f87171'));
    }

    // the derived pair, with the delta against your previous poll on this issue
    frag.append(el('div', 'pkpw-h2', 'where it sits'));
    const b = blocs(p);
    const netRow = el('div', 'pkpw-row');
    netRow.append(el('span', 'pkpw-dim', 'net (right − left)'));
    netRow.append(el('span', '', `${sideText(net(p))}  ${Math.round(b.l)}/${Math.round(b.c)}/${Math.round(b.r)}`));
    frag.append(netRow);

    const lv = lean(p);
    const leanRow = el('div', 'pkpw-row');
    leanRow.append(el('span', 'pkpw-dim', 'lean (−3…+3)'));
    leanRow.append(el('span', '', lv == null ? 'needs an exact method' : sideText(lv, 2)));
    frag.append(leanRow);

    if (prev) {
      const d = net(p) - net(prev);
      const dRow = el('div', 'pkpw-row');
      dRow.append(el('span', 'pkpw-dim', `since your last (${ago(prev.t)})`));
      const v = el('span', '', Math.abs(d) < 0.5 ? 'unmoved' : `${d > 0 ? '→ right' : '← left'} ${Math.abs(d).toFixed(1)}`);
      v.style.color = Math.abs(d) < 0.5 ? '#a1a1aa' : (d > 0 ? '#f87171' : '#60a5fa');
      dRow.append(v);
      frag.append(dRow);
      if (!exact(p) || !exact(prev)) {
        frag.append(el('p', 'pkpw-note',
          'One of those two is a street poll or an online scrape, so this delta carries their error with it — the game rates street at ±8% and the scrape as extreme-biased.'));
      }
    }

    if (p.volatility || p.salience || p.best) {
      frag.append(el('div', 'pkpw-h2', 'read'));
      if (p.volatility) {
        const r = el('div', 'pkpw-row');
        r.append(el('span', 'pkpw-dim', 'volatility'));
        const v = el('span', '', p.volatility);
        if (VOL_HEX[p.volatility]) v.style.color = VOL_HEX[p.volatility];
        r.append(v); frag.append(r);
      }
      if (p.salience) {
        const r = el('div', 'pkpw-row');
        r.append(el('span', 'pkpw-dim', 'salience'));
        const v = el('span', '', p.popularity != null ? `${p.salience} · ${p.popularity}` : p.salience);
        if (SAL_HEX[p.salience]) v.style.color = SAL_HEX[p.salience];
        r.append(v); frag.append(r);
      }
      if (p.best) {
        const r = el('div', 'pkpw-row');
        r.append(el('span', 'pkpw-dim', 'best target'));
        r.append(el('span', '', p.best));
        frag.append(r);
      }
    }

    if (p.angle) {
      frag.append(el('div', 'pkpw-h2', 'opportunity'));
      frag.append(el('p', 'pkpw-quote', p.angle));
    }

    return frag;
  };

  const viewLatest = () => {
    const chosen = ui.issue && issuesSeen().has(ui.issue)
      ? issuesSeen().get(ui.issue)
      : data.polls;
    const p = chosen[chosen.length - 1];
    if (!p) return null;
    const prev = chosen[chosen.length - 2] ?? null;

    const frag = document.createDocumentFragment();
    frag.append(renderMemo(p, prev));

    const series = issuesSeen().get(p.issue) ?? [];
    if (series.length > 1) {
      frag.append(el('div', 'pkpw-h2', `trend · ${series.length} polls`));
      const sp = sparkline(series);
      if (sp) frag.append(sp);
      const ends = el('div', 'pkpw-row');
      ends.append(el('span', 'pkpw-faint', `${sideText(net(series[0]))} · ${ago(series[0].t)}`));
      ends.append(el('span', 'pkpw-faint', `now ${sideText(net(p))}`));
      frag.append(ends);
      frag.append(el('p', 'pkpw-note',
        'Filled dots are professional or focus-group readings; hollow ones are street or online and carry the game\'s own stated error.'));
    }

    const cd = p.cooldown ? countdown(p.cooldown) : null;
    if (cd) frag.append(el('p', 'pkpw-note', `Server cooldown from that poll: ${cd} left. This panel never polls — that is yours to spend.`));

    return frag;
  };

  const viewIssues = () => {
    const seen = issuesSeen();
    if (!seen.size) return null;
    const frag = document.createDocumentFragment();
    frag.append(el('div', 'pkpw-h2', `issues · ${seen.size} of ${data.issues.length || '?'}`));

    const list = el('ul', 'pkpw-list');
    const rows = [...seen.entries()].sort((a, b) => b[1][b[1].length - 1].t - a[1][a[1].length - 1].t);
    for (const [issue, polls] of rows) {
      const last = polls[polls.length - 1];
      const li = document.createElement('li');
      if (issue === ui.issue) li.dataset.on = '1';
      li.title = `${polls.length} poll(s) · newest ${stamp(last)}`;

      const left = el('span', '', issue);
      const right = el('span', 'pkpw-faint', '');
      const d = polls.length > 1 ? net(last) - net(polls[0]) : null;
      right.textContent = d == null || Math.abs(d) < 0.5
        ? `${sideText(net(last))} · ${ago(last.t)}`
        : `${sideText(net(last))} ${d > 0 ? '→R' : '→L'}${Math.abs(d).toFixed(0)} · ${ago(last.t)}`;

      li.append(left, right);
      li.addEventListener('click', () => {
        ui.issue = issue === ui.issue ? null : issue;
        ui.view = 'latest';
        saveUI(); render(); drag?.fit();
      });
      list.append(li);
    }
    frag.append(list);

    const unpolled = (data.issues || []).filter((i) => !seen.has(i));
    if (unpolled.length) {
      frag.append(el('div', 'pkpw-h2', `never polled · ${unpolled.length}`));
      frag.append(el('p', 'pkpw-faint', unpolled.join(' · ')));
    }
    frag.append(el('p', 'pkpw-note',
      'Click an issue to pin it — the latest tab then shows that issue instead of your most recent poll.'));
    return frag;
  };

  const viewLog = () => {
    if (!data.polls.length) return null;
    const frag = document.createDocumentFragment();
    frag.append(el('div', 'pkpw-h2', `log · ${data.polls.length} memos`));
    const list = el('ul', 'pkpw-list');
    for (let i = data.polls.length - 1; i >= 0; i--) {
      const p = data.polls[i];
      const li = document.createElement('li');
      li.title = `${METHOD[p.method]?.label ?? p.method ?? 'unknown method'} · ${stamp(p)}`;
      const left = el('span', '', `${p.issue}`);
      const meta = el('span', 'pkpw-faint',
        `${METHOD[p.method]?.tag ?? '??'} ${sideText(net(p))} · ${ago(p.t)}`);
      li.append(left, meta);
      li.addEventListener('click', () => {
        ui.issue = p.issue; ui.view = 'latest'; saveUI(); render(); drag?.fit();
      });
      list.append(li);
    }
    frag.append(list);
    return frag;
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  const COLS = ['iso', 'game_time', 'issue', 'method', 'exact', 'mood', 'extreme_tag',
    'left_pct', 'center_pct', 'right_pct', 'net', 'lean',
    ...BUCKETS.map(([k]) => k), 'volatility', 'salience', 'popularity', 'best_target'];

  const tsv = () => {
    const cell = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));
    const lines = [COLS.join('\t')];
    for (const p of data.polls) {
      const b = blocs(p), lv = lean(p);
      lines.push([
        new Date(p.t).toISOString(), gameLabel(p.gs) ?? '', p.issue, p.method ?? '',
        exact(p) ? 'yes' : 'no', p.mood ?? '', p.extreme ?? '',
        b.l, b.c, b.r, net(p).toFixed(1), lv == null ? '' : lv.toFixed(3),
        ...BUCKETS.map(([k]) => (p.fine ? p.fine[k] : '')),
        p.volatility ?? '', p.salience ?? '', p.popularity ?? '', p.best ?? '',
      ].map(cell).join('\t'));
    }
    return lines.join('\n');
  };

  const copyBtn = (label, produce) => {
    const b = el('button', 'pkpw-btn', label);
    b.addEventListener('click', () => {
      navigator.clipboard?.writeText(produce()).then(
        () => { b.textContent = 'copied'; setTimeout(() => { b.textContent = label; }, 1500); },
        () => { b.textContent = 'failed'; setTimeout(() => { b.textContent = label; }, 1500); },
      );
    });
    return b;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const render = () => {
    if (!body || document.hidden || !ui.open) return;
    body.textContent = '';

    if (!data.polls.length) {
      body.append(el('p', 'pkpw-dim',
        'No memos yet. Run a poll from Actions → Opinion Polls and this catches the reply as it lands — '
        + 'issue, method, the full spread, and the game date it was taken on.'));
      body.append(el('p', 'pkpw-note',
        'It files what you buy; it never buys. A professional firm ($500) or focus group ($1,000) returns the '
        + 'seven-bucket spread, which is the only shape that supports the −3…+3 lean figure.'));
      return;
    }

    const view = { latest: viewLatest, issues: viewIssues, log: viewLog }[ui.view] ?? viewLatest;
    const out = view();
    if (out) body.append(out);
    else body.append(el('p', 'pkpw-dim', 'Nothing to show in this tab yet.'));

    const tools = el('div', 'pkpw-tools');
    tools.append(copyBtn('copy tsv', tsv));
    tools.append(copyBtn('copy json', () => JSON.stringify(data.polls, null, 2)));
    if (ui.issue) {
      const clear = el('button', 'pkpw-btn', `unpin ${ui.issue}`);
      clear.addEventListener('click', () => { ui.issue = null; saveUI(); render(); drag?.fit(); });
      tools.append(clear);
    }
    body.append(tools);
  };

  let renderTimer = null;
  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; sync(); }, 60);
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

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------
  const POLL_PAGE = '/actions/opinion-poll';
  const onStage = () => ui.everywhere || location.pathname === '/' || location.pathname === POLL_PAGE;

  const TABS = [['latest', 'latest'], ['issues', 'issues'], ['log', 'log']];
  let tabBar = null;

  const sync = () => {
    if (!root) return;
    const show = onStage();
    root.style.display = show ? '' : 'none';
    panel.style.display = show && ui.open ? 'flex' : 'none';
    // The button says which window is already up. Both of these sit ABOVE the
    // `show && ui.open` gate below, so closing the panel reaches them too — under
    // the gate the class is only ever added and a closed panel leaves a lit button.
    fab.classList.toggle('pk-open', ui.open);
    fab.setAttribute('aria-expanded', String(ui.open));
    pinBtn.dataset.on = ui.everywhere ? '1' : '0';
    title.textContent = data.polls.length ? `polls · ${data.polls.length}` : 'polls';
    for (const b of tabBar.children) b.dataset.on = b.dataset.view === ui.view ? '1' : '0';
    if (show && ui.open) {
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

    fab = el('button', 'pk-fab pkpw-fab', 'POLL');
    fab.title = 'Politiko Poll Watch (passive) — drag to move, double-click to put it back';
    fab.addEventListener('click', () => {
      if (fabDrag.dragged()) return; // that gesture was a drag, not a click
      ui.open = !ui.open; saveUI(); sync();
    });
    root.append(fab);

    panel = el('div', 'pkpw-panel');
    head = el('div', 'pkpw-head');
    head.title = 'Drag to move · double-click to snap back';
    title = el('h1', '', 'polls');

    pinBtn = el('button', 'pkpw-btn', 'all pages');
    pinBtn.title = 'Lit: visible on every screen. Click to narrow it to the home page and Actions → Opinion Polls.';
    pinBtn.addEventListener('click', () => { ui.everywhere = !ui.everywhere; saveUI(); sync(); });

    const close = el('button', 'pkpw-btn', '×');
    close.title = 'Hide (the POLL button brings it back)';
    close.addEventListener('click', () => { ui.open = false; saveUI(); sync(); });

    head.append(title, pinBtn, close);

    tabBar = el('div', 'pkpw-tabs');
    for (const [key, label] of TABS) {
      const b = el('button', 'pkpw-btn', label);
      b.dataset.view = key;
      b.addEventListener('click', () => { ui.view = key; saveUI(); sync(); });
      tabBar.append(b);
    }

    body = el('div', 'pkpw-body');
    panel.append(head, tabBar, body);
    root.append(panel);
    document.documentElement.append(root);

    drag = draggable(panel, head, (pos) => { Object.assign(ui, pos ?? { x: null, y: null }); saveUI(); });
    resize = resizable(panel, (size) => { ui.size = size ?? undefined; saveUI(); },
      { drag, minW: 260, minH: 160 });
    // Double-click the header undoes both — the recovery path for a panel dragged
    // or resized into uselessness.
    head.addEventListener('dblclick', () => { drag.reset(); resize.reset(); });

    // the FAB moves too — it is UI in the way just as much as the panel is
    fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUI(); });
    fabDrag.apply(ui.fab);
    // Double-click puts it back in the row. reset() drops the stored position AND
    // clears the inline left/top, which is the only thing that lets the kit's rule
    // apply again — see FAB KIT v4.
    fab.addEventListener('dblclick', () => { ui.fab = null; saveUI(); fabDrag.reset(); });

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

  // "3m ago" and the cooldown both age; nothing else needs a clock, and this one
  // touches only text. Visible tab only, and never while you are reading a row.
  setInterval(() => {
    if (!document.hidden && ui.open && onStage() && !panel?.matches(':hover')) render();
  }, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRender(); });

  const boot = () => { mount(); checkRoute(); log('ready', `${data.polls.length} memo(s) on file`); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
