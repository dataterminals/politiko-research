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
  ok('...and its prose body is not stored', !JSON.stringify(a.data).includes('long prose'));

  // congress_alignment_swing is the one published delta in the whole client.
  a.feed('/api/newspaper', [{ id: 901, gametime: 450000000, metadata: { category: 'Election',
    congress_alignment_swing: [{ label: 'House', delta: 25 }, { label: 'Senate', delta: -4 }] } }]);
  check('a published swing is kept per label', a.data.swings.map((x) => [x.label, x.delta]),
    [['House', 25], ['Senate', -4]]);
  a.feed('/api/newspaper', [{ id: 901, gametime: 450000000, metadata: { category: 'Election',
    congress_alignment_swing: [{ label: 'House', delta: 25 }, { label: 'Senate', delta: -4 }] } }]);
  check('...and re-reading the same edition does not duplicate it', a.data.swings.length, 2);
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
