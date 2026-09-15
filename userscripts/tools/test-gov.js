// Slices gov-watch's constant table, diff core and ingest layer straight out of the
// shipped script and drives them with canned payloads. No DOM, no network — the harness
// cage exists for the panel; this is for the engine.
//
// The thing worth guarding here is not the arithmetic, it is the BRACKET. Every row this
// tool prints claims a change happened between two times, and that claim is the whole
// product. Two ways to get it wrong:
//
//   Narrowing it. Stamping a change with `now` reads as "this happened just now" when
//   what actually happened is "you looked, and it had already changed". A tool that does
//   that turns a week-old shift into breaking news.
//
//   Widening it. Failing to advance the confirmed-at clock on a reading that AGREED
//   means the next real change gets bracketed back to the first sighting instead of the
//   last confirmation, and a fifteen-second window is reported as a four-day one.
//
// Both directions are checked below, because both are silent.
//
// Run: node userscripts/tools/test-gov.js
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'gov-watch.user.js'), 'utf8');

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from} .. ${to}`);
  return SRC.slice(i, j);
};

// One continuous range: the game constants, the pure diff core, the stored-state helpers
// and both take*() the tap feeds. It stops at the fetch wrapper, which needs a browser.
const SLICE = cut('  const SEATS = {', '  const origFetch = window.fetch;');

const mk = () => {
  const store = {};
  const dom = mkDom();
  const api = new Function('K', 'readJSON', 'writeJSON', 'log', 'scheduleRender', 'location', 'document', `
    ${SLICE}
    ${RENDER}
    return { SEATS, WORD, SHORT, HUE, clamp3, word, short, hue, WING, FAV_AMBER, FAV_IMPEACH,
             GAME_MONTH_MS, POLICIES, axisOf, num, str, isFractional, diffField, bracketOf,
             isLive, tally, tallyMembers, centre, projectCycle,
             data, ui, takeGovernment, takeJobs, takeNewspaper, consume, seenKey, pathOf,
             billRow, sameBill, billList, gameDate, editionNo, passed,
             PROSE_CATS, PROSE_MAX, PROSE_BUDGET, trimProse, courtList, appearance, adjacentMoves, byAxis, NEAR_MS,
             renderers: { bills: renderBills, law: renderLaw, motion: renderMotion } };
  `)(
    { data: 'pkgw:data', ui: 'pkgw:ui' },
    (k, fallback) => (k in store ? JSON.parse(store[k]) : fallback),
    (k, v) => { store[k] = JSON.stringify(v); },
    () => {},
    () => {},
    { href: 'https://politiko.io/' },
    dom,
  );
  api.feed = (p, body) => api.consume(p, `https://politiko.io${p}`, body);
  api.dom = dom;
  return api;
};

// The renderers live past the fetch wrapper, so they need their own slice and a DOM.
const RENDER = cut('  const el = (tag, cls, text) =>', '  const TABS = [');

const mkDom = () => {
  const mkEl = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], dataset: {}, style: {},
      className: '', title: '', _text: '',
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
      set textContent(v) { this._text = v === '' ? '' : String(v); if (v === '') this.children = []; },
      append(...cs) { for (const c of cs) this.children.push(typeof c === 'object' ? c : mkText(String(c))); },
      appendChild(c) { this.children.push(c); return c; },
      addEventListener() {},
      querySelectorAll() { return []; },
      matches() { return false; },
    };
    return e;
  };
  const mkText = (t) => ({ tagName: '#text', children: [], get textContent() { return t; } });
  return { createElement: mkEl, createTextNode: mkText };
};

/** Render one tab into a detached node and hand back the node plus a flat text dump. */
const renderTab = (a, name) => {
  const out = a.dom.createElement('div');
  a.renderers[name](out);
  const walk = (n, acc) => { acc.push(n); for (const c of n.children) walk(c, acc); return acc; };
  const nodes = walk(out, []);
  return {
    out,
    nodes,
    text: out.textContent,
    rows: nodes.filter((n) => n.tagName === 'TR').map((tr) => tr.children.map((td) => td.textContent)),
    titles: nodes.map((n) => n.title).filter(Boolean),
  };
};

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};
const ok = (label, cond, detail) => {
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}`);
  if (!cond) { console.log(`        ${detail ?? ''}`); fail++; }
};

const P = (name, axis, description) => ({ policy_id: name, policy_name: name, axis, description });
const evs = (api, kind) => api.data.events.filter((e) => e.kind === kind);
const last = (api, kind) => evs(api, kind).slice(-1)[0];

// ===========================================================================
console.log('\n── the bracket ─────────────────────────────────────────────────');
// ===========================================================================
{
  const a = mk();
  const store = {};

  // t=1000: first sighting. A baseline is NOT a change — there is nothing to compare to,
  // and reporting one would make every fresh install look like a coup.
  check('baseline emits no event', a.diffField(store, 'x', 5, 1000), null);
  check('baseline records the value', store.x, { v: 5, t: 1000, since: 1000 });

  // t=2000: same value. This is the load-bearing one — it moves the CONFIRMED clock
  // without moving `since`, so a later change is bracketed from here, not from 1000.
  check('agreeing reading emits no event', a.diffField(store, 'x', 5, 2000), null);
  check('agreeing reading advances t, not since', store.x, { v: 5, t: 2000, since: 1000 });

  // t=3000: it moved. The old value was still true at 2000; the new one is true now.
  const ev = a.diffField(store, 'x', 7, 3000);
  check('change brackets from the LAST confirmation', [ev.t0, ev.t1], [2000, 3000]);
  check('change carries both values', [ev.from, ev.to], [5, 7]);
  check('change carries how long the old value held', ev.since, 1000);
  check('bracket width is t1 − t0', a.bracketOf(ev), 1000);
  check('the new value starts its own clock', store.x, { v: 7, t: 3000, since: 3000 });

  // A missing field is not a change to null. Only /api/government carries the court, so
  // every jobs poll would otherwise read as "the entire supreme court resigned".
  check('a feed that omits the field changes nothing', a.diffField(store, 'x', null, 4000), null);
  check('…and does not touch the clocks', store.x, { v: 7, t: 3000, since: 3000 });

  check('a sub-minute window counts as live', a.isLive({ t0: 0, t1: 15000 }), true);
  check('a four-day window does not', a.isLive({ t0: 0, t1: 4 * 864e5 }), false);
}

// ===========================================================================
console.log('\n── policy axes ─────────────────────────────────────────────────');
// ===========================================================================
{
  const a = mk();
  a.feed('/api/government', { policies: [P('Healthcare', -1, 'Public option.'), P('Tax Structure', 1, 'Flat.')] });
  check('first reading logs nothing', a.data.events.length, 0);
  check('…but records both axes', [a.data.now['policy:Healthcare'].v, a.data.now['policy:Tax Structure'].v], [-1, 1]);

  a.feed('/api/government', { policies: [P('Healthcare', -2, 'Public option.'), P('Tax Structure', 1, 'Flat.')] });
  check('one axis moving logs exactly one event', evs(a, 'policy').length, 1);
  check('…naming the policy that moved', last(a, 'policy').key, 'Healthcare');
  check('…with both values', [last(a, 'policy').from, last(a, 'policy').to], [-1, -2]);

  // Prose moves independently of the number. A government that rewrites its stance
  // without moving its axis has done something, and nothing else records it.
  a.feed('/api/government', { policies: [P('Healthcare', -2, 'Single payer.'), P('Tax Structure', 1, 'Flat.')] });
  check('prose changing alone logs a prose event', evs(a, 'prose').length, 1);
  check('…and not a policy event', evs(a, 'policy').length, 1);
  check('…carrying the new text', last(a, 'prose').to, 'Single payer.');

  // The jobs feed carries name + axis and no prose. Reading a missing description as a
  // cleared one would log a prose event on every single 15-second poll.
  a.feed('/api/factions/3/jobs', { policies: [{ policy_name: 'Healthcare', axis: -2 }] });
  check('the jobs feed does not fabricate a prose change', evs(a, 'prose').length, 1);
  a.feed('/api/factions/3/jobs', { policies: [{ policy_name: 'Healthcare', axis: -3 }] });
  check('…but does log an axis move', evs(a, 'policy').length, 2);
  check('…from the live feed, same field as the wide one', last(a, 'policy').key, 'Healthcare');
}

// ===========================================================================
console.log('\n── the president ───────────────────────────────────────────────');
// ===========================================================================
{
  const a = mk();
  const pres = (name, alignment, favorability, term_number) => ({
    policies: [P('Healthcare', 0)],
    president: { name, alignment, favorability, term_number },
  });
  a.feed('/api/government', pres('Hoppe', 2, 31, 3));
  check('first president is a baseline, not an event', a.data.events.length, 0);

  a.feed('/api/government', pres('Hoppe', 2, 22, 3));
  check('approval drop logs one event', evs(a, 'pres-fav').length, 1);
  check('…flagged as crossing the amber line', last(a, 'pres-fav').crossed, ['amber']);

  // Only the line actually crossed is flagged: 22 was already under amber, so this move
  // crosses the impeachment line and nothing else. Re-flagging amber here would make a
  // slow slide look like it re-broke every threshold on the way down.
  a.feed('/api/government', pres('Hoppe', 2, 8, 3));
  check('falling under 10 flags impeachment only', last(a, 'pres-fav').crossed, ['impeach']);

  // …and a single reading that skips both lines at once flags both, because both were
  // in fact crossed inside that one window.
  const b = mk();
  b.feed('/api/government', pres('Kell', 0, 40, 1));
  b.feed('/api/government', pres('Kell', 0, 6, 1));
  check('a fall past both lines in one window flags both', last(b, 'pres-fav').crossed, ['impeach', 'amber']);

  a.feed('/api/government', pres('Hoppe', 2, 14, 3));
  check('recovering above 10 is flagged too', last(a, 'pres-fav').crossed, ['safe']);

  // A succession is ONE event. Emitting four (name, alignment, approval, term) would read
  // as the sitting president collapsing rather than a different person taking office.
  const before = a.data.events.length;
  a.feed('/api/government', pres('Vance-Okoro', -1, 54, 1));
  check('a new president logs exactly one row', a.data.events.length - before, 1);
  check('…of kind succession', last(a, 'succession').kind, 'succession');
  check('…naming both people', [last(a, 'succession').from, last(a, 'succession').to], ['Hoppe', 'Vance-Okoro']);
  check('no separate approval row for the new president', evs(a, 'pres-fav').length, 3);

  // …and the successor's own numbers become the new baseline rather than diffing against
  // their predecessor's.
  a.feed('/api/government', pres('Vance-Okoro', -1, 51, 1));
  check('the successor is then tracked normally', evs(a, 'pres-fav').length, 4);
  check('…from their own first reading', [last(a, 'pres-fav').from, last(a, 'pres-fav').to], [54, 51]);
}

// ===========================================================================
console.log('\n── chambers and the court ──────────────────────────────────────');
// ===========================================================================
{
  const a = mk();

  // GovernmentPage's own asymmetric cut: wings at ±2, moderate spanning three buckets.
  check('wing cut matches the client', [a.WING(-3), a.WING(-2), a.WING(-1), a.WING(0), a.WING(1), a.WING(2), a.WING(3)],
    ['left', 'left', 'mod', 'mod', 'mod', 'right', 'right']);
  check('tally uses it', a.tally([
    { alignment: -3, count: 12 }, { alignment: -2, count: 108 }, { alignment: -1, count: 60 },
    { alignment: 0, count: 90 }, { alignment: 1, count: 55 }, { alignment: 2, count: 95 },
    { alignment: 3, count: 15 },
  ]), { left: 120, mod: 205, right: 110, total: 435 });
  check('the house fixture is a full chamber', 120 + 205 + 110, a.SEATS.house.total);

  const house = (rows) => ({ policies: [P('Healthcare', 0)], house: rows });
  a.feed('/api/government', house([{ alignment: -2, count: 100 }, { alignment: 0, count: 235 }, { alignment: 2, count: 100 }]));
  a.feed('/api/government', house([{ alignment: -2, count: 120 }, { alignment: 0, count: 215 }, { alignment: 2, count: 100 }]));
  check('a wing gaining seats logs a chamber event', evs(a, 'chamber').length, 2);
  check('…for the wing that grew', last(a, 'chamber').wing, 'mod');
  check('…and the one that shrank', evs(a, 'chamber')[0].wing, 'left');

  // The bucket feed genuinely cannot see a −1 → 0 move: both are `mod`. The test asserts
  // the blindness rather than pretending it away, because the panel's own copy says so.
  const before = evs(a, 'chamber').length;
  a.feed('/api/government', house([{ alignment: -2, count: 120 }, { alignment: -1, count: 215 }, { alignment: 2, count: 100 }]));
  check('a within-moderate shift is invisible to the buckets', evs(a, 'chamber').length - before, 0);

  const b = mk();
  const cj = (rows) => ({ policies: [P('Healthcare', 0)], supreme_court: rows });
  b.feed('/api/government', cj([{ id: 'j1', name: 'Alvarez', alignment: -2 }, { id: 'j2', name: 'Boone', alignment: 1 }]));
  check('the first court reading seats nobody', b.data.events.length, 0);
  b.feed('/api/government', cj([{ id: 'j1', name: 'Alvarez', alignment: -1 }, { id: 'j2', name: 'Boone', alignment: 1 }]));
  check('a justice moving logs one row', evs(b, 'court').length, 1);
  check('…named', last(b, 'court').name, 'Alvarez');
  b.feed('/api/government', cj([{ id: 'j1', name: 'Alvarez', alignment: -1 }, { id: 'j3', name: 'Chandra', alignment: 3 }]));
  check('a justice leaving logs a row', evs(b, 'court-leave').length, 1);
  check('…and the replacement logs one too', evs(b, 'court-join').length, 1);
  check('…with the right names', [last(b, 'court-leave').key, last(b, 'court-join').key], ['Boone', 'Chandra']);
  check('the stored court is the new one', b.data.court.map((j) => j.id), ['j1', 'j3']);
}

// ===========================================================================
console.log('\n── congress members, cycle, lobbying ────────────────────────────');
// ===========================================================================
{
  const a = mk();
  const mem = (id, chamber, seat_number, alignment, incumbent = true) => ({ id, chamber, seat_number, alignment, incumbent });
  const jb = (over) => Object.assign({
    next_cycle_month: '4', election_reform_axis: 0,
    policies: [{ policy_name: 'Healthcare', axis: 0 }],
    congress_members: [mem(101, 'house', 1, -2), mem(102, 'house', 2, 0), mem(201, 'senate', 1, 2)],
  }, over);

  a.feed('/api/factions/3/jobs', jb());
  check('the first roster is a baseline', a.data.events.length, 0);
  check('…and is stored per member', Object.keys(a.data.members).length, 3);

  a.feed('/api/factions/3/jobs', jb({ congress_members: [mem(101, 'house', 1, -1), mem(102, 'house', 2, 0), mem(201, 'senate', 1, 2)] }));
  check('a member realigning logs one row', evs(a, 'member').length, 1);
  check('…labelled by seat, which is the whole identity a seat has', last(a, 'member').seat, 'House 1');

  // This is the move the bucket feed cannot see (−2 → −1 is left → mod there, but here it
  // is a named seat) — the per-member feed is why the tool reads both.
  check('…and it is a wing change the buckets would blur', [a.WING(-2), a.WING(-1)], ['left', 'mod']);

  a.feed('/api/factions/3/jobs', jb({ congress_members: [mem(101, 'house', 1, -1, false), mem(102, 'house', 2, 0), mem(201, 'senate', 1, 2)] }));
  check('an incumbency flip logs a seat row', evs(a, 'seat').length, 1);
  check('…in the right direction', [last(a, 'seat').from, last(a, 'seat').to], ['incumbent', 'open']);

  // The cycle counter is the heartbeat; witnessing a rollover is the only way to place
  // the boundary in real time.
  check('no rollover witnessed yet', a.data.roll, null);
  a.feed('/api/factions/3/jobs', jb({ next_cycle_month: '5' }));
  check('the rollover logs a cycle row', evs(a, 'cycle').length, 1);
  check('…and is remembered for the projection', [a.data.roll.from, a.data.roll.to], ['4', '5']);

  const proj = a.projectCycle({ t0: 1000, t1: 2000 }, 2000 + a.GAME_MONTH_MS / 2);
  check('the projection lands one game month after the rollover', proj.at, 2000 + a.GAME_MONTH_MS);
  check('…carries the width of that observation as its confidence', proj.conf, 1000);
  check('…and counts nothing missed yet', proj.missed, 0);
  const stale = a.projectCycle({ t0: 0, t1: 0 }, a.GAME_MONTH_MS * 3.5);
  check('boundaries that passed unwatched are counted, not hidden', stale.missed, 3);
  check('projecting needs a witnessed rollover', a.projectCycle(null, 1), null);

  // A game month is ~13h49m, so the cycle runs about twice a real day.
  ok('a game month is between 13 and 14 real hours',
    a.GAME_MONTH_MS > 13 * 36e5 && a.GAME_MONTH_MS < 14 * 36e5, `${a.GAME_MONTH_MS} ms`);

  const j = (status, over = {}) => ({
    id: 91, job_type: 'lobbying', target_policy_name: 'Healthcare', direction: 'left',
    status, cycle_month: '4', committed_power: 4200, committed_cash: 25000,
    slots: [{ role_key: 'fixer', assigned_user_id: 7, assigned_username: 'you', contribution_snapshot: { score: 12.5 } }],
    result_metadata: null, ...over,
  });
  a.feed('/api/factions/3/jobs', jb({ jobs: [j('recruiting'), { id: 92, job_type: 'training', status: 'recruiting' }] }));
  check('a first-seen job is a baseline', evs(a, 'job').length, 0);
  check('training jobs are not government movement and are skipped', Object.keys(a.data.jobs), ['91']);

  a.feed('/api/factions/3/jobs', jb({ jobs: [j('locked')] }));
  check('a status transition logs a job row', evs(a, 'job').length, 1);
  a.feed('/api/factions/3/jobs', jb({ jobs: [j('resolved', { result_metadata: { outcome: 'axis_moved', score: 74, winner_job_id: 91 } })] }));
  check('…and so does resolution', evs(a, 'job').length, 2);
  check('…carrying the outcome', last(a, 'job').outcome, 'axis_moved');

  // Disclosure says status only. A slot's occupant is a person, and this tool has no
  // business keeping one — the check is here so a future edit cannot quietly widen it.
  const stored = JSON.stringify(a.data.jobs);
  ok('no username is stored on a job', !stored.includes('you'), stored);
  ok('no committed resources are stored', !stored.includes('4200') && !stored.includes('25000'), stored);
  ok('no slot is stored', !stored.includes('fixer'), stored);
}

// ===========================================================================
console.log('\n── what the game cannot draw ───────────────────────────────────');
// ===========================================================================
{
  const a = mk();
  check('integers are not fractional', [a.isFractional(0), a.isFractional(-3), a.isFractional(2)], [false, false, false]);
  check('a fractional axis is caught', [a.isFractional(1.4), a.isFractional(-0.5)], [true, true]);
  check('a non-number is not', [a.isFractional(null), a.isFractional('x')], [false, false]);

  // GovernmentPage clamps without rounding and then tests equality, so 1.4 raises no cell.
  // The panel prints the raw value; these guard the labels it prints beside it.
  check('the word scale rounds for its label', [a.word(1.4), a.word(2.6)], ['Moderate Right', 'Fascist']);
  check('clamping matches the client', [a.clamp3(9), a.clamp3(-9), a.clamp3(1.4)], [3, -3, 1.4]);
  check('the short scale is the Government screen’s, not factionUtils’',
    [a.short(-1), a.short(0), a.short(1)], ['Mod-', 'Mod', 'Mod+']);

  a.feed('/api/factions/3/jobs', { policies: [{ policy_name: 'Free Speech', axis: -3 }] });
  a.feed('/api/factions/3/jobs', { policies: [{ policy_name: 'Free Speech', axis: -1.4 }] });
  check('a drift into a fraction is logged like any other', evs(a, 'policy').length, 1);
  check('…at full precision', last(a, 'policy').to, -1.4);
}

// ===========================================================================
console.log('\n── the tap reads only what it says it does ─────────────────────');
// ===========================================================================
{
  const a = mk();
  check('path shapes collapse for the SOURCES table',
    [a.seenKey('/api/factions/3/jobs'), a.seenKey('/api/government')],
    ['/api/factions/{id}/jobs', '/api/government']);

  a.feed('/api/factions/3/treasury/summary', { cash: 918000, weekly_income: 42000 });
  check('faction treasury is ignored', a.data.events.length, 0);
  ok('…and not stored', !JSON.stringify(a.data).includes('918000'));

  // An unread path must not even be timestamped. `seen` is a freshness map for the three
  // declared feeds, and letting it record everything would quietly turn it into a log of
  // every route the app visited — usernames and all.
  a.feed('/api/government', { policies: [P('Healthcare', 0)] });
  a.feed('/api/users/erran', { username: 'erran', alignment: { social_axis: 2.6, economic_axis: 1.2 } });
  ok('other players’ profiles are not read by this tool', !JSON.stringify(a.data).includes('erran'));
  check('…and unread paths are not even timestamped', Object.keys(a.data.seen).sort(), ['/api/government']);

  a.feed('/api/user/status', { username: 'you', current_location_id: 2, cash: 55000 });
  check('status contributes only the name', a.data.self, 'you');
  ok('…not the money', !JSON.stringify(a.data).includes('55000'));

  // Malformed payloads must not throw: the tap runs inside the app's own promise chain.
  for (const junk of [null, undefined, {}, { policies: 'no' }, { policies: [null, {}] }, []]) {
    try { a.feed('/api/government', junk); a.feed('/api/factions/3/jobs', junk); }
    catch (e) { ok(`malformed payload survives: ${JSON.stringify(junk)}`, false, String(e)); }
  }
  ok('every malformed payload survived', true);
}

// ---------------------------------------------------------------------------
// The Congressional Record (0.6.0). The Herald arrives on every screen and the
// client draws three headlines out of it; what matters here is the half it drops.
// ---------------------------------------------------------------------------
console.log('\n\u2014 bills: what a Herald entry becomes \u2014');
{
  const a = mk();
  const entry = (id, over) => Object.assign({
    id, gametime: 450000000,
    metadata: Object.assign({
      category: 'Congress', headline: 'A bill about something',
      from_axis: 3, to_axis: 2, house_yea: 253, house_nay: 182,
      senate_yea: 65, senate_nay: 35, outcome: null,
    }, over || {}),
  }, over && over.gametime ? { gametime: over.gametime } : null);

  a.feed('/api/newspaper', [entry(814, { headline: 'Walk it back' })]);
  const b = a.data.bills['814'];
  check('a Congress entry is kept by id', [b.from, b.to, b.hy, b.hn, b.sy, b.sn],
    [3, 2, 253, 182, 65, 35]);
  check('...with the headline and category', [b.headline, b.category], ['Walk it back', 'Congress']);
  ok('...and firstSeen/lastSeen are stamped', !!b.firstSeen && !!b.lastSeen);
  check('a pending bill keeps a null outcome rather than reading as dead', b.outcome, null);
  ok('...and no event is logged for merely seeing it', a.data.events.filter((e) => e.kind === 'bill').length === 0);

  // Re-reading the same unchanged row every 60s must not churn the ledger.
  const before = JSON.stringify(a.data.events);
  a.feed('/api/newspaper', [entry(814, { headline: 'Walk it back' })]);
  check('an unchanged re-read logs nothing', JSON.stringify(a.data.events), before);
  check('...and there is still one bill', Object.keys(a.data.bills).length, 1);

  // The outcome landing is the event, and it carries the bracket like every other row.
  a.feed('/api/newspaper', [entry(814, { headline: 'Walk it back', outcome: 'signed' })]);
  const ev = a.data.events.filter((e) => e.kind === 'bill');
  check('an outcome landing is one bracketed event', ev.length, 1);
  check('...from pending to the outcome', [ev[0].from, ev[0].to], [null, 'signed']);
  ok('...with a window, not a timestamp', ev[0].t0 <= ev[0].t1);
  check('...and it carries the axis the bill moved', [ev[0].axisFrom, ev[0].axisTo], [3, 2]);
  check('the stored row is updated in place', a.data.bills['814'].outcome, 'signed');
}

console.log('\n\u2014 bills: the direction the client never draws \u2014');
{
  const a = mk();
  check('toward the centre and away from it are told apart by |to| < |from|',
    [Math.abs(2) < Math.abs(3), Math.abs(3) < Math.abs(2)], [true, false]);
  check('passed() is the client\'s own two-value test',
    [a.passed('signed'), a.passed('veto overridden'), a.passed('vetoed'), a.passed('dead in Congress'), a.passed(null)],
    [true, true, false, false, false]);
}

console.log('\n\u2014 bills: the calendar the client computes \u2014');
{
  const a = mk();
  check('game zero is January 1, Y1', a.gameDate(0), 'January 1, Y1');
  check('edition numbers count game months from 1', [a.editionNo(0), a.editionNo(2592000)], [1, 2]);
  // The client clamps the month and does not clamp the day, so a 365-day year ends with
  // five days of December past the 30th. Reproduced deliberately \u2014 docs/20.
  check('December runs to the 35th, exactly as the paper prints it',
    a.gameDate(31536000 - 86400), 'December 35, Y1');
  check('a missing gametime is a dash, not a date', a.gameDate(undefined), '\u2014');
}

console.log('\n\u2014 bills: what it refuses to keep \u2014');
{
  const a = mk();
  // An entry with no vote table is prose. It is still a Herald row and still gets kept,
  // but nothing numeric may be invented for it.
  a.feed('/api/newspaper', [{ id: 900, gametime: 450000000, metadata: { category: 'World', headline: 'Weather', body: 'long prose', spin: 'liberal' } }]);
  const w = a.data.bills['900'];
  check('a prose entry keeps no tallies', [w.hy, w.hn, w.sy, w.sn, w.from, w.to], [null, null, null, null, null, null]);
  // Reversed in 0.7.0 on purpose: World is front-page prose the game writes. What is still
  // refused is prose from any OTHER category — see "bills: the prose" below.
  check('...and since 0.7.0 a World entry keeps its body and spin', [w.body, w.spin], ['long prose', 'liberal']);

  // congress_alignment_swing is the one published delta in the whole client.
  a.feed('/api/newspaper', [{ id: 901, gametime: 450000000, metadata: { category: 'Election',
    congress_alignment_swing: [{ label: 'House', delta: 25 }, { label: 'Senate', delta: -4 }] } }]);
  check('a published swing is kept per label', a.data.swings.map((x) => [x.label, x.delta]),
    [['House', 25], ['Senate', -4]]);
  a.feed('/api/newspaper', [{ id: 901, gametime: 450000000, metadata: { category: 'Election',
    congress_alignment_swing: [{ label: 'House', delta: 25 }, { label: 'Senate', delta: -4 }] } }]);
  check('...and re-reading the same edition does not duplicate it', a.data.swings.length, 2);
}

// ---------------------------------------------------------------------------
// The prose (0.7.0). Kept because on 2026-09-12 two Supreme Court rulings landed in the
// same window Corporate Law moved with no bill in the Record, and the ruling text was the
// only evidence left \u2014 and 0.6.0 had dropped it. The line this guards is narrow: three
// game-authored front-page categories, capped, and nothing else.
// ---------------------------------------------------------------------------
console.log('\n\u2014 bills: the prose, and only the front page\'s \u2014');
{
  const a = mk();
  const GT = 450 * 2592000;
  const e = (id, category, body, extra) => ({ id, gametime: GT, metadata: Object.assign({ category, headline: `h${id}`, body }, extra || {}) });

  a.feed('/api/newspaper', [
    e(1, 'Supreme Court', 'The court holds that the statute stands.'),
    e(2, 'Congress', 'A bill to do a thing.', { from_axis: 1, to_axis: 0 }),
    e(3, 'World', 'Tremors downstate.', { spin: 'conservative' }),
  ]);
  check('Supreme Court, Congress and World each keep their body',
    ['1', '2', '3'].map((id) => a.data.bills[id].body),
    ['The court holds that the statute stands.', 'A bill to do a thing.', 'Tremors downstate.']);
  check('...and a spin where there is one', [a.data.bills['3'].spin, a.data.bills['1'].spin], ['conservative', null]);

  // Every other category keeps its row and loses its prose \u2014 including the swing
  // entries, and including a category nobody has seen yet. An allow-list, not a deny-list.
  a.feed('/api/newspaper', [
    e(10, 'Election', 'ELECTION PROSE', { spin: 'ELECTION SPIN' }),
    e(11, 'Classifieds', 'PLAYER PROSE', { posted_by: 'someone' }),
    e(12, 'supreme court', 'WRONG CASE PROSE'),
    e(13, undefined, 'NO CATEGORY PROSE'),
    e(14, 'Opinion', 'NEW CATEGORY PROSE'),
  ]);
  const s = JSON.stringify(a.data);
  for (const t of ['ELECTION PROSE', 'ELECTION SPIN', 'PLAYER PROSE', 'WRONG CASE PROSE', 'NO CATEGORY PROSE', 'NEW CATEGORY PROSE']) {
    ok(`not kept outside the three categories: ${t}`, !s.includes(t));
  }
  ok('...while those rows themselves are still kept', ['10', '11', '12', '13', '14'].every((id) => a.data.bills[id]));
  ok('...and no author field ever reaches storage', !s.includes('someone'));

  // The cap. One runaway body must not eat a localStorage quota shared with the game.
  const huge = 'x'.repeat(a.PROSE_MAX * 3);
  a.feed('/api/newspaper', [e(20, 'Supreme Court', huge)]);
  check('a body is cut at PROSE_MAX', a.data.bills['20'].body.length, a.PROSE_MAX);
  check('...and remembers how long it really was', a.data.bills['20'].cut, a.PROSE_MAX * 3);
  check('an uncut body carries no cut length', a.data.bills['1'].cut, null);
  ok('PROSE_MAX is the documented 4,000', a.PROSE_MAX === 4000);

  // Malformed bodies: the tap runs inside the app's own promise chain, so nothing throws,
  // and nothing that is not a non-empty string becomes a body.
  for (const [id, body, spin] of [[30, 42, 7], [31, { html: '<b>' }, ['a']], [32, ['a', 'b'], {}], [33, '', ''], [34, '   \n ', null], [35, null, undefined], [36, undefined, 'x'.repeat(500)]]) {
    try { a.feed('/api/newspaper', [e(id, 'Supreme Court', body, { spin })]); }
    catch (err) { ok(`malformed body survives: ${JSON.stringify(body)}`, false, String(err)); }
  }
  check('a non-string or blank body is null, never "[object Object]" or ""',
    [30, 31, 32, 33, 34, 35, 36].map((id) => a.data.bills[String(id)].body), [null, null, null, null, null, null, null]);
  check('...a non-string spin is null', [30, 31, 32].map((id) => a.data.bills[String(id)].spin), [null, null, null]);
  check('...and an overlong spin is cut', a.data.bills['36'].spin.length, 40);
  for (const junk of [[{ id: 40, metadata: 'Supreme Court' }], [{ id: 41, metadata: [1, 2] }], [{ id: 42, metadata: null }]]) {
    try { a.feed('/api/newspaper', junk); } catch (err) { ok('malformed metadata survives', false, String(err)); }
  }
  ok('non-object metadata survives and keeps no prose', a.data.bills['40'].body === null && a.data.bills['41'].body === null);

  // A 0.6.0 row has no body. It is filled in on the next reading without logging an event,
  // and an unchanged re-read after that churns nothing.
  const b = mk();
  b.data.bills['77'] = { gametime: GT, category: 'Supreme Court', headline: 'old', from: null, to: null,
    hy: null, hn: null, sy: null, sn: null, outcome: null, firstSeen: 5, lastSeen: 5 };
  b.feed('/api/newspaper', [{ id: 77, gametime: GT, metadata: { category: 'Supreme Court', headline: 'old', body: 'Backfilled.' } }]);
  check('a 0.6.0 row gets its body on the next reading', b.data.bills['77'].body, 'Backfilled.');
  check('...keeps its original first sighting', b.data.bills['77'].firstSeen, 5);
  check('...and logs no event for it', b.data.events.length, 0);

  // The store-wide budget. Rows stay; bodies go, World and Congress before the court.
  const c = mk();
  const per = a.PROSE_MAX;
  const n = Math.ceil(a.PROSE_BUDGET / per) + 4;
  const batch = [];
  for (let i = 0; i < n; i++) batch.push({ id: 1000 + i, gametime: GT + i, metadata: { category: i < 3 ? 'Supreme Court' : 'World', headline: `w${i}`, body: String(i).padEnd(per, '.') } });
  c.feed('/api/newspaper', batch);
  const held = Object.values(c.data.bills).reduce((sum, r) => sum + (r.body ? r.body.length : 0), 0);
  ok('total prose stays under PROSE_BUDGET', held <= a.PROSE_BUDGET, `${held} chars held`);
  check('every row is still kept', Object.keys(c.data.bills).length, n);
  check('court rulings keep their text, even the oldest', [0, 1, 2].map((i) => !!c.data.bills[String(1000 + i)].body), [true, true, true]);
  ok('...the oldest World text went first', c.data.bills['1003'].proseDropped === true && !!c.data.bills[String(1000 + n - 1)].body);
  const before = JSON.stringify(c.data.bills['1003']);
  c.feed('/api/newspaper', batch);
  check('a dropped body is not re-added on the next poll', JSON.stringify(c.data.bills['1003']).replace(/"lastSeen":\d+/, ''), before.replace(/"lastSeen":\d+/, ''));
}

console.log('\n\u2014 bills: court rulings, and what sits next to them \u2014');
{
  const a = mk();
  const GT = 14 * 31536000 + 5 * 2592000; // June 1, Y15
  const ruling = (id, headline, body) => ({ id, gametime: GT, metadata: { category: 'Supreme Court', headline, body } });
  check('the fixture date is the one the paper printed', a.gameDate(GT), 'June 1, Y15');

  // The first-ever Herald reading: nothing bounds an entry's arrival from below.
  a.feed('/api/newspaper', [{ ...ruling(500, 'Old Precedent', 'Held long ago.'), gametime: GT - 2592000 }]);
  check('an entry on the very first Herald reading has no prior reading', a.data.bills['500'].prior, null);
  check('...so its window is open', a.appearance(a.data.bills['500'], a.data.bills['500'].firstSeen).state, 'open');

  // Pin the clocks so the windows are exact.
  a.data.seen['/api/newspaper'] = 1_000_000;
  const now = 1_060_000;
  a.takeNewspaper([ruling(501, 'United States v. Upton', 'The court finds the corporate statute void.')], now);
  const r = a.data.bills['501'];
  check('a later entry is bracketed by the reading before it', [r.prior, r.firstSeen], [1_000_000, now]);
  check('...state bracketed', a.appearance(r, 0).state, 'bracketed');
  check('a 0.6.0 row on the first reading is open, otherwise unrecorded',
    [a.appearance({ firstSeen: 9 }, 9).state, a.appearance({ firstSeen: 12 }, 9).state], ['open', 'unrecorded']);
  check('no first sighting, no window', a.appearance({}, 0), null);

  const app = a.appearance(r, 0);
  const NEAR = a.NEAR_MS;
  const events = [
    { kind: 'policy', key: 'Corporate Law', from: 0, to: -1, t0: 900_000, t1: 1_030_000 },          // overlaps
    { kind: 'policy', key: 'Healthcare', from: 1, to: 2, t0: now + NEAR - 1, t1: now + NEAR + 5000 }, // just inside the slack
    { kind: 'policy', key: 'Pollution', from: 1, to: 2, t0: now + NEAR + 1, t1: now + NEAR + 5000 },  // just outside
    { kind: 'policy', key: 'Drug Law', from: 1, to: 0, t0: 0, t1: 1_000_000 - NEAR - 1 },             // before
    { kind: 'reform', key: 'Election Reform', from: 0, to: 1, t0: 1_010_000, t1: 1_020_000 },
    { kind: 'court', key: 'Alvarez', from: 1, to: 2, t0: 1_010_000, t1: 1_020_000 },                  // not a policy axis
    { kind: 'policy', key: 'Broken', t0: 'x', t1: null },
  ];
  check('adjacency is window overlap widened by NEAR_MS, over policy and reform moves only',
    a.adjacentMoves(app, events).map((e) => e.key), ['Corporate Law', 'Healthcare', 'Election Reform']);
  check('...and nothing for no window', a.adjacentMoves(null, events), []);
  check('moves collapse to one net line per axis, with the span of their windows',
    a.byAxis([
      { key: 'Free Speech', from: -3, to: -1.4, t0: 10, t1: 20 },
      { key: 'Pollution', from: 1, to: 2, t0: 12, t1: 14 },
      { key: 'Free Speech', from: -1.4, to: -3, t0: 20, t1: 30 },
      { key: 'Free Speech', from: -3, to: -2, t0: 5, t1: 40 },
    ]).map((g) => [g.key, g.from, g.to, g.t0, g.t1, g.n]),
    [['Free Speech', -3, -2, 5, 40, 3], ['Pollution', 1, 2, 12, 14, 1]]);
  check('...and an axis that came back to where it started sorts after a net move',
    a.byAxis([
      { key: 'Tax Structure', from: 1, to: 2, t0: 1, t1: 2 },
      { key: 'Tax Structure', from: 2, to: 1, t0: 2, t1: 3 },
      { key: 'Corporate Law', from: 0, to: -1, t0: 1, t1: 3 },
    ]).map((g) => g.key), ['Corporate Law', 'Tax Structure']);
  check('NEAR_MS is thirty minutes', NEAR, 30 * 60000);

  // The tab. Newest first, headline and game date, prose expandable, and the adjacency
  // worded as an observation.
  a.data.events.push(events[0]);
  a.takeNewspaper([{ id: 502, gametime: GT + 2592000, metadata: { category: 'Supreme Court', headline: 'United States v. Farrell, Corp.', body: 'x'.repeat(5000) } }], now + 60000);
  const v = renderTab(a, 'bills');
  ok('the court section is drawn', /court \u00b7 3/.test(v.text), v.text.slice(0, 200));
  const heads = v.nodes.filter((nd) => nd.className === 'pkgw-ev').map((nd) => nd.children[0].children[0].textContent);
  check('rulings are listed newest edition first', heads.slice(0, 2), ['United States v. Farrell, Corp.', 'United States v. Upton']);
  ok('...with the game date the paper printed', v.text.includes('June 1, Y15') && v.text.includes('July 1, Y15'));
  const details = v.nodes.filter((nd) => nd.tagName === 'DETAILS');
  ok('the prose sits in an expander', details.some((d) => d.textContent.includes('The court finds the corporate statute void.')));
  ok('...and the opening of it in the hover', v.titles.includes('The court finds the corporate statute void.'));
  ok('a cut ruling says it was cut, and from how long', /cut at 4,000 of 5,000 characters/.test(v.text));
  ok('a hover is clipped, the expander is not',
    v.titles.some((t) => t.length === 601 && t.endsWith('\u2026')) && details.some((d) => d.textContent.includes('x'.repeat(4000))));

  const obs = v.nodes.filter((nd) => nd.className === 'pkgw-obs').map((nd) => nd.textContent);
  ok('the Corporate Law move is shown beside Upton', obs.some((t) => /^observed: Corporate Law 0 \u2192 -1 moved in an overlapping window/.test(t)), obs.join(' | '));
  ok('...and never as a cause', !/because|caused|due to|as a result|moved by|led to|triggered/i.test(v.text), v.text);
  ok('the section says adjacency is not causation', /Adjacency is an observation, not a cause/.test(v.text));
  ok('an open-window ruling warns it may be much older',
    v.nodes.some((nd) => nd.className === 'pkgw-ev' && /Old Precedent/.test(nd.textContent) && /first Herald reading/.test(nd.textContent)));
  ok('a ruling with nothing near it says so plainly', obs.some((t) => /no recorded axis move overlaps this window/.test(t)));

  // A boundary that moves many axes at once must not bury the ruling under a wall of lines.
  for (let i = 0; i < 10; i++) {
    a.data.events.push({ kind: 'policy', key: a.POLICIES[i], from: 0, to: 1, t0: 1_010_000, t1: 1_020_000 });
    a.data.events.push({ kind: 'policy', key: a.POLICIES[i], from: 1, to: 0, t0: 1_020_000, t1: 1_030_000 });
  }
  const crowd = renderTab(a, 'bills');
  const upton = crowd.nodes.find((nd) => nd.className === 'pkgw-ev' && /United States v\. Upton/.test(nd.textContent));
  const lines = upton.children.filter((nd) => nd.className === 'pkgw-obs').map((nd) => nd.textContent);
  check('a crowded window is capped at six axis lines plus a tail', lines.length, 7);
  ok('...the tail counts what it hid', /and 5 more axes in the same stretch/.test(lines[6]), lines[6]);
  ok('...and a repeated axis reads as one net line', lines.some((t) => /\(2 moves\) moved in an overlapping window/.test(t)), lines.join(' | '));
  ok('...with the one net move still first, not buried by round trips', /^observed: Corporate Law 0 → -1 moved/.test(lines[0]), lines[0]);
  ok('Record rows carry their prose in the hover too', v.titles.some((t) => t.startsWith('United States v. Upton') && t.includes('corporate statute void')));

  // A 0.6.0 ruling with no text is kept and says why it is bare.
  const b = mk();
  b.data.bills['9'] = { gametime: GT, category: 'Supreme Court', headline: 'Bare', firstSeen: 3, lastSeen: 3 };
  ok('a ruling kept without text says why', /no text kept for this entry/.test(renderTab(b, 'bills').text));
  ok('no court section without a ruling', !/court \u00b7/.test(renderTab(mk(), 'bills').text));
}

console.log('\n\u2014 bills: the sibling endpoints are not this tool\'s business \u2014');
{
  const a = mk();
  // Every one of these is a real Herald endpoint carrying other players' text or
  // location. consume() routes on an exact path, so feeding one must store nothing at
  // all \u2014 not even a freshness stamp, which is how a username gets into storage by
  // accident.
  const before = JSON.stringify(a.data);
  a.feed('/api/newspaper/bounties', { bounties: [{ id: 1, target_username: 'someone', target_location: 'Austin' }] });
  a.feed('/api/newspaper/personals', { personals: [{ id: 1, body: 'text', posted_by: 'someone' }] });
  a.feed('/api/newspaper/classified-ads', { ads: [{ id: 1, body: 'text', posted_by: 'someone' }] });
  a.feed('/api/newspaper/job-listings', { listings: [{ id: 1, corp_name: 'X', position_name: 'Y' }] });
  a.feed('/api/newspaper/local', { articles: [{ id: 1, headline: 'local', byline: 'someone' }] });
  check('none of the five change a single byte of storage', JSON.stringify(a.data), before);
  ok('...and no username reached it', !JSON.stringify(a.data).includes('someone'));
  ok('...nor a location', !JSON.stringify(a.data).includes('Austin'));
}

console.log('\n\u2014 bills: malformed payloads survive \u2014');
{
  const a = mk();
  for (const junk of [null, undefined, {}, [], [null], [{}], [{ id: 1 }], [{ id: 2, metadata: null }],
    [{ id: 3, metadata: { house_yea: 'lots', from_axis: '', to_axis: null, congress_alignment_swing: 'no' } }]]) {
    try { a.feed('/api/newspaper', junk); }
    catch (e) { ok(`malformed Herald payload survives: ${JSON.stringify(junk)}`, false, String(e)); }
  }
  ok('every malformed Herald payload survived', true);
  const b = a.data.bills['3'];
  check('a non-numeric tally is null, never NaN', b ? [b.hy, b.from, b.to] : null, [null, null, null]);
  ok('...and junk in the swing field is ignored', a.data.swings.length === 0);
}

console.log('\n\u2014 bills: the tab itself \u2014');
{
  const a = mk();
  const empty = renderTab(a, 'bills');
  ok('with nothing stored it says where the feed comes from', /Herald card polls the front page/.test(empty.text));
  ok('...and warns that hiding the card stops it', /hidden that card/.test(empty.text));

  const GT = 450 * 2592000;
  a.feed('/api/newspaper', [
    { id: 814, gametime: GT, metadata: { category: 'Congress', headline: 'Slavery Repeal Act',
      from_axis: 3, to_axis: 2, house_yea: 253, house_nay: 182, senate_yea: 65, senate_nay: 35, outcome: 'signed' } },
    { id: 815, gametime: GT, metadata: { category: 'Congress', headline: 'Sedition Expansion Act',
      from_axis: 2, to_axis: 3, house_yea: 194, house_nay: 241, senate_yea: 40, senate_nay: 60, outcome: 'dead in Congress' } },
    { id: 830, gametime: GT, metadata: { category: 'Congress', headline: 'Promote Gender Equality',
      from_axis: -1, to_axis: -2, house_yea: 9, house_nay: 426, senate_yea: 4, senate_nay: 96, outcome: 'dead in Congress' } },
    { id: 816, gametime: GT, metadata: { category: 'Congress', headline: 'Still Counting',
      from_axis: 3, to_axis: 2, house_yea: 240, house_nay: 195, senate_yea: 60, senate_nay: 40, outcome: null } },
  ]);
  const v = renderTab(a, 'bills');

  // The finding the tab exists for, drawn rather than left to the reader.
  ok('the direction summary is drawn', /which way this congress votes/.test(v.text));
  const toward = v.rows.find((r) => r[0] === 'toward the centre');
  const away = v.rows.find((r) => r[0] === 'away from the centre');
  check('toward the centre: one of one decided passed', toward && toward.slice(1), ['1/1', '100%']);
  check('away from the centre: none of two passed', away && away.slice(1), ['0/2', '0%']);
  ok('...and a pending bill is excluded from the rate rather than counted as a loss',
    /left out of the rate/.test(v.text) && toward[1] === '1/1');

  // A row says what the game refuses to: which way the bill was trying to move.
  const row = v.rows.find((r) => r[0] === 'Slavery Repeal Act');
  check('a bill row carries the axis move the client never draws', row && row[1], '3 \u2192 2');
  check('...both chamber tallies', row && [row[2], row[3]], ['253\u2013182', '65\u201335']);
  check('...and its fate in one word', row && row[4], 'signed');

  const pending = v.rows.find((r) => r[0] === 'Still Counting');
  check('a bill with no outcome reads as pending, never as dead', pending && pending[4], 'pending');
  const dead = v.rows.find((r) => r[0] === 'Sedition Expansion Act');
  check('...and a dead one says dead', dead && dead[4], 'dead');

  // The two things the table must not overclaim, both in the hover text.
  ok('the margin is disclosed as a guide, not a verdict',
    v.titles.some((t) => /WEIGHTED count, so this margin is a guide/.test(t)));
  ok('...and pending is disclosed as not-the-same-as-dead',
    v.titles.some((t) => /not the same thing/.test(t)));
  ok('the edition date is in the hover, not invented into the row',
    v.titles.some((t) => /edition \d+/.test(t)));

  // A published swing only appears when the server sends one.
  ok('no swing section without a swing', !/published swings/.test(v.text));
  a.feed('/api/newspaper', [{ id: 850, gametime: GT, metadata: { category: 'Election',
    congress_alignment_swing: [{ label: 'House', delta: 25 }] } }]);
  const w = renderTab(a, 'bills');
  ok('...and one when there is', /published swings/.test(w.text));
  check('a swing prints its sign', w.rows.find((r) => r[0] === 'House'), ['House', '+25']);

  // A bill outcome is a government movement, so it belongs in the motion ledger too —
  // but only when this tool WITNESSED the transition. Feeding an already-decided bill
  // logs nothing, because "it was decided before you looked" is not a change we saw.
  ok('a bill first seen already decided logs no event',
    !renderTab(a, 'motion').text.includes('Slavery Repeal Act'));
  const b = mk();
  const pend = { id: 900, gametime: GT, metadata: { category: 'Congress', headline: 'Late Bill',
    from_axis: 3, to_axis: 2, house_yea: 250, house_nay: 185, senate_yea: 60, senate_nay: 40, outcome: null } };
  b.feed('/api/newspaper', [pend]);
  b.feed('/api/newspaper', [{ ...pend, metadata: { ...pend.metadata, outcome: 'signed' } }]);
  const m = renderTab(b, 'motion');
  ok('...but a transition we watched reaches the motion ledger by its headline', /Late Bill/.test(m.text));
  ok('...and reads pending to signed', /pending/.test(m.text) && /signed/.test(m.text));
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
