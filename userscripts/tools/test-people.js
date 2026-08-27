// Slices the real walk and metric layers out of people-watch and exercises them
// against synthetic ledger state.
//
// The queue suite that used to live here is gone with the crawler it tested: there is
// no longer any code that decides what to request, because nothing is requested. What
// replaces it is the walk, and that is worth pinning down for a different reason — it
// decides where a keypress sends you, and an off-by-one there means silently skipping
// a player on a 292-name list you are stepping through by hand.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'people-watch.user.js'), 'utf8');

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from} .. ${to}`);
  return SRC.slice(i, j);
};

const W_SLICE = cut('  const PROFILE_RE =', '  // ===========================================================================\n  // Derived metrics');
const D_SLICE = cut('  const ms = (iso) =>', '  const fmtDur = (msv)');
const S_SLICE = cut('  const ms = (iso) =>', '  // ===========================================================================\n  // Panel');
const C_SLICE = cut('  /** the <col> elements of the table paint() built last',
  '  /**\n   * The divider between one column and the next.');

/** rows() reads `people` and `ui` from the closure, so both are injected. */
const mkRows = (people, ui, CFG) =>
  new Function('people', 'ui', 'CFG',
    `${S_SLICE}\nreturn { rows, display, displayOrder, SORTS, COLUMNS, GROUPS, liveScore, derive, cityText, cityTitle };`)(people, ui, CFG);

/**
 * goProfile is never called here — it only touches history/window, which are stubs.
 *
 * `ui` and `displayOrder` are injected because 1.5.0 gave the walk two orders to choose
 * between, and the second one is the table's, which is built further down the file than
 * this slice reaches. The defaults keep every roster-order case reading as it did.
 */
const mkWalk = (people, roster, pathname, ui = { walk: 'roster' }, displayOrder = () => []) =>
  new Function('people', 'roster', 'location', 'history', 'window', 'paint', 'ui', 'displayOrder', 'save',
    `${W_SLICE}\nreturn { step, walkAt, nextUnseen, currentProfile, walkOrder, listOrder, resyncWalk, walkStale, swapWalk, mod, WALK };`)(
    people, roster, { pathname }, { pushState() {} }, { dispatchEvent() {} }, () => {}, ui, displayOrder, () => {});

const mkDerive = (CFG) => new Function('CFG', `${D_SLICE}\nreturn { derive, ms };`)(CFG);

/**
 * The column-sizing layer, against a table made of plain objects.
 *
 * Node has no layout engine, so nothing here can prove that a 40px column *looks*
 * like 40px — that was checked in tools/harness/. What it can prove is the
 * arithmetic between the stored map and the style properties, which is where the
 * damage would be: a clamp that does not clamp, a min-width that disagrees with the
 * widths it is the sum of, or a stored map that quietly loses a column.
 *
 * `shown` is what each header would measure on screen; the stub hands it back from
 * getBoundingClientRect so measureShown() has something real to read.
 */
const mkCols = (ui, COLUMNS, shown, CFG = { COL_MIN: 26 }) => {
  const colEls = COLUMNS.map(() => ({ style: {} }));
  const heads = COLUMNS.map((c) => ({
    cls: c.key,
    getBoundingClientRect: () => ({ width: shown[c.key] }),
  }));
  const table = {
    style: {},
    classList: { names: new Set(), add(n) { this.names.add(n); }, remove(n) { this.names.delete(n); } },
    // the real one asks for `thead th:not(.fill)`; the stub has no filler to exclude
    querySelectorAll: () => heads,
  };
  const api = new Function('ui', 'CFG', 'COLUMNS', 'saveNow', 'paint', 'seed',
    `${C_SLICE}\ncolEls = seed;\nreturn { applyCols, measureShown, measureNatural, colBase, colsComplete, resetCols, dragging: () => colDragging };`,
  )(ui, CFG, COLUMNS, () => {}, () => {}, colEls);
  return { ...api, table, colEls, widths: () => colEls.map((c) => c.style.width) };
};

const CFG = { NEVER_STUCK_MS: 2 * 3600_000 };

const HOUR = 3600_000;
const now = Date.now();

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

const rosterOf = (...usernames) => ({ total: usernames.length, totalPages: 1, usernames, seenAt: now, pages: { 1: now } });
const seen = (...usernames) => Object.fromEntries(usernames.map((u) => [u, { username: u, observedAt: now }]));

console.log('\n— walk: where am I —');
{
  const w = mkWalk({}, rosterOf('ana'), '/profile/ana');
  check('a profile route yields the username', w.currentProfile(), 'ana');
}
{
  const w = mkWalk({}, rosterOf('ana'), '/people');
  check('any other route yields null', w.currentProfile(), null);
}
{
  const w = mkWalk({}, rosterOf('a b'), '/profile/a%20b');
  check('an encoded name is decoded', w.currentProfile(), 'a b');
}

console.log('\n— walk: stepping —');
{
  const roster = rosterOf('ana', 'bo', 'cy');
  check('forward moves one', mkWalk({}, roster, '/profile/ana').step(1), 'bo');
  check('back moves one', mkWalk({}, roster, '/profile/bo').step(-1), 'ana');
  check('forward wraps at the end', mkWalk({}, roster, '/profile/cy').step(1), 'ana');
  check('back wraps at the start', mkWalk({}, roster, '/profile/ana').step(-1), 'cy');
}
{
  // you can land on a profile that was never on a roster page you walked
  const w = mkWalk({}, rosterOf('ana', 'bo'), '/profile/stranger');
  check('a stranger starts the walk at the top of the roster', w.step(1), 'ana');
}
{
  const w = mkWalk({}, rosterOf(), '/profile/ana');
  check('an empty roster has nowhere to go', w.step(1), null);
}

console.log('\n— walk: skipping to what is missing —');
{
  const roster = rosterOf('ana', 'bo', 'cy', 'di');
  const w = mkWalk(seen('bo', 'cy'), roster, '/profile/ana');
  check('skips players already profiled', w.nextUnseen(), 'di');
}
{
  const roster = rosterOf('ana', 'bo', 'cy');
  const w = mkWalk(seen('bo'), roster, '/profile/cy');
  check('wraps around to find one behind you', w.nextUnseen(), 'ana');
}
{
  const roster = rosterOf('ana', 'bo');
  const w = mkWalk(seen('ana', 'bo'), roster, '/profile/ana');
  check('a fully profiled roster has no next', w.nextUnseen(), null);
}
{
  // a roster-only record has no observedAt, so it still counts as unprofiled
  const roster = rosterOf('ana', 'bo');
  const w = mkWalk({ bo: { username: 'bo' } }, roster, '/profile/ana');
  check('a name seen on the roster but never opened is still unseen', w.nextUnseen(), 'bo');
}

console.log('\n— sorting: order and its reverse —');
{
  const SORT_CFG = { NEVER_STUCK_MS: 2 * HOUR, LIVE_TRUST_MS: 5 * 60_000 };
  const who = (n, over) => ({
    username: n, observedAt: now, is_npc: false, is_online: false,
    last_online: new Date(now - 3 * HOUR).toISOString(),
    created_at: new Date(now - 30 * 24 * HOUR).toISOString(),
    combat: { attacks_won: 1, attacks_lost: 1 }, ...over,
  });
  const ledger = {
    ana: who('ana', { last_online: new Date(now - 9 * 24 * HOUR).toISOString() }),   // most idle
    bo: who('bo', { last_online: new Date(now - 1 * HOUR).toISOString() }),
    cy: who('cy', { last_online: new Date(now - 30_000).toISOString() }),            // just now
  };
  const base = { hideNpc: true, hideOnline: false, minIdleDays: 0 };
  const names = (ui) => mkRows(ledger, { ...base, ...ui }, SORT_CFG).rows().map((x) => x.r.username);

  check('most idle, natural order', names({ sort: 'idle', dir: 1 }), ['ana', 'bo', 'cy']);
  check('...reversed', names({ sort: 'idle', dir: -1 }), ['cy', 'bo', 'ana']);
  check('name, natural order', names({ sort: 'name', dir: 1 }), ['ana', 'bo', 'cy']);
  check('...reversed', names({ sort: 'name', dir: -1 }), ['cy', 'bo', 'ana']);
  check('an unknown sort key falls back to idle', names({ sort: 'nope', dir: 1 }), ['ana', 'bo', 'cy']);

  // every sort must name a real column, or a header can never show as active
  const cols = new Set(mkRows({}, base, SORT_CFG).COLUMNS.map((c) => c.key));
  const S = mkRows({}, base, SORT_CFG).SORTS;
  check('every sort points at a real column',
    Object.values(S).every((s) => cols.has(s.col)), true);
  check('every column points at a real sort',
    mkRows({}, base, SORT_CFG).COLUMNS.every((c) => !!S[c.sort]), true);
}

console.log('\n— action counts: absent is not zero —');
{
  const CFG_A = { NEVER_STUCK_MS: 2 * HOUR, LIVE_TRUST_MS: 5 * 60_000 };
  const p = (n, alignment) => ({
    username: n, observedAt: now, is_online: false, combat: null, alignment,
    last_online: new Date(now - HOUR).toISOString(),
  });
  const ledger = {
    busy: p('busy', { social_count: 47, economic_count: 3 }),
    quiet: p('quiet', { social_count: 0, economic_count: 0 }),
    unknown: p('unknown', null),
    econ: p('econ', { social_count: 2, economic_count: 90 }),
  };
  const ui = { sort: 'social', dir: 1, hideNpc: true, hideOnline: false, minIdleDays: 0 };
  const m = mkRows(ledger, ui, CFG_A);

  check('most social actions first, never-observed last',
    m.rows().map((x) => x.r.username), ['busy', 'econ', 'quiet', 'unknown']);

  const d = Object.fromEntries(m.rows().map((x) => [x.r.username, x.d]));
  check('a genuine zero is a zero', d.quiet.socialActs, 0);
  check('an unobserved count is null, not zero', d.unknown.socialActs, null);
  check('political is the sum of both axes', d.busy.politicalActs, 50);
  check('...and stays null when neither axis was seen', d.unknown.politicalActs, null);

  const byPolitical = mkRows(ledger, { ...ui, sort: 'political' }, CFG_A)
    .rows().map((x) => x.r.username);
  check('economic volume counts toward political', byPolitical[0], 'econ');
}

console.log('\n— grouping —');
{
  const CFG_G = { NEVER_STUCK_MS: 2 * HOUR, LIVE_TRUST_MS: 5 * 60_000 };
  const { GROUPS } = mkRows({}, {}, CFG_G);
  check('none does not group', GROUPS.none.of, null);
  const r = { faction_name: 'The Hand', faction_rank: 'officer', corp_name: 'Nyx Media', corp_role: 'ceo' };
  check('faction reads faction_name', GROUPS.faction.of(r), 'The Hand');
  check('corp reads corp_name', GROUPS.corp.of(r), 'Nyx Media');
  check('an empty membership groups as null, not ""', GROUPS.faction.of({ faction_name: '' }), null);
  check('a missing membership groups as null', GROUPS.corp.of({}), null);
  check('city reads location', GROUPS.city.of({ location: 'Miami' }), 'Miami');
  check('an unrecorded city groups as null', GROUPS.city.of({}), null);
  // someone in transit still belongs to the city they left — it is the only bucket
  // the ledger can honestly put them in, and the row carries the mark instead
  check('a traveler groups under the city they left',
    GROUPS.city.of({ location: 'Miami', status: 'traveling' }), 'Miami');
}

console.log('\n— city: the name, and how much of it is honest —');
{
  const CFG_C = { NEVER_STUCK_MS: 2 * HOUR, LIVE_TRUST_MS: 5 * 60_000 };
  const p = (n, location, status) => ({
    username: n, observedAt: now, is_online: false, combat: null, status,
    location, locationAt: location ? now - 2 * HOUR : null,
    last_online: new Date(now - HOUR).toISOString(),
  });
  const ledger = {
    zeta: p('zeta', 'Austin', 'active'),
    ana: p('ana', 'Miami', 'active'),
    nomad: p('nomad', null, 'active'),
    gone: p('gone', 'Miami', 'traveling'),
  };
  const ui = { sort: 'city', dir: 1, hideNpc: true, hideOnline: false, minIdleDays: 0 };
  const m = mkRows(ledger, ui, CFG_C);

  // unknown last in natural order, exactly like the count sorts put "never observed"
  // below a genuine zero — a city we have never seen is not a place
  check('cities sort A→Z with the unrecorded one last',
    m.rows().map((x) => x.r.username), ['zeta', 'ana', 'gone', 'nomad']);
  check('...ties inside a city break by name',
    m.rows().filter((x) => x.d.city === 'Miami').map((x) => x.r.username), ['ana', 'gone']);
  check('...reversed puts the unrecorded one first',
    mkRows(ledger, { ...ui, dir: -1 }, CFG_C).rows().map((x) => x.r.username),
    ['nomad', 'gone', 'ana', 'zeta']);

  const d = Object.fromEntries(m.rows().map((x) => [x.r.username, x.d]));
  check('a recorded city derives', d.ana.city, 'Miami');
  check('an unrecorded city is null, not ""', d.nomad.city, null);
  check('traveling is read off status', d.gone.traveling, true);
  check('...and is false for everyone else', d.ana.traveling, false);
  check('city age comes from locationAt', Math.round(d.ana.cityAgeMs / HOUR), 2);
  check('no reading means no age', d.nomad.cityAgeMs, null);

  // the whole point of the mark: a traveler is not in the city we last saw them in,
  // so the cell must not print a bare name that reads as current
  const { cityText, cityTitle } = m;
  check('a settled player shows the bare city', cityText(d.ana), 'Miami');
  check('a traveler is marked, not asserted', cityText(d.gone), 'Miami ⇢');
  check('a traveler with no known city says so', cityText({ traveling: true, city: null }), '⇢ in transit');
  check('an unrecorded city renders as a dash', cityText(d.nomad), '—');
  check('the tooltip dates a settled reading', cityTitle(d.ana), 'Miami, as of 2h ago');
  check('...and spells out what a transit reading means',
    cityTitle(d.gone), 'in transit — Miami is where they were as of 2h ago');
  // never tell someone to open a profile to fix a seal that profiles cannot fix
  check('an unrecorded city points at the note, not at busywork',
    /open their profile/.test(cityTitle(d.nomad)), false);
}

console.log('\n— the city note: "not looked yet" is not "server sent nothing" —');
{
  // Blank cities have two completely different causes and the note must not merge
  // them: one is answered by browsing, the other cannot be answered at all. This is
  // the layer that decides whether a working tool reads as broken.
  const CFG_N = { NEVER_STUCK_MS: 2 * HOUR, LIVE_TRUST_MS: 5 * 60_000 };
  const mkNote = (people, roster) =>
    new Function('people', 'roster', 'ui', 'CFG', `${S_SLICE}\nreturn cityNote;`)(
      people, roster, {}, CFG_N)();

  const withCity = { a: { username: 'a', observedAt: now, location: 'Miami' } };
  const noCity = { a: { username: 'a', observedAt: now, location: null } };
  const rosterOnly = { a: { username: 'a', rosterSeenAt: now } };

  check('nothing read yet says so', mkNote(rosterOnly, { locationsVisible: null }),
    'cities: none yet — open a profile or page the roster');
  check('a sealed roster plus empty profiles reads as sealed',
    mkNote(noCity, { locationsVisible: false }),
    'cities: sealed — 1 profile(s) read, none carried one (hover)');
  check('...and hedges when the roster has not said either way',
    mkNote(noCity, { locationsVisible: null }),
    'cities: none in 1 profile(s) read — likely sealed (hover)');
  check('a visible roster with cities recorded points at the fast path',
    mkNote(withCity, { locationsVisible: true }),
    'cities: 1 recorded · roster is showing them — page People for ten at a time');
  check('...and a hidden roster points at the slow one',
    mkNote(withCity, { locationsVisible: false }),
    'cities: 1 recorded · roster is hiding them — one per profile you open');
}

console.log('\n— "active now" only claims what it can support —');
{
  const CFG_L = { NEVER_STUCK_MS: 2 * HOUR, LIVE_TRUST_MS: 5 * 60_000 };
  const { liveScore } = mkRows({}, {}, CFG_L);
  const idle3h = 3 * HOUR;
  check('online, and freshly observed', liveScore({ is_online: true }, 60_000, idle3h), 3);
  check('online, but observed hours ago', liveScore({ is_online: true }, 3 * HOUR, idle3h), 2);
  check('not flagged online, but last seen a minute ago', liveScore({ is_online: false }, 3 * HOUR, 60_000), 1);
  check('nothing to suggest activity', liveScore({ is_online: false }, 3 * HOUR, idle3h), 0);
  check('an online flag with no observation time is not trusted',
    liveScore({ is_online: true }, null, idle3h), 2);
}
{
  const CFG_L = { NEVER_STUCK_MS: 2 * HOUR, LIVE_TRUST_MS: 5 * 60_000 };
  const stale = { username: 'stale', observedAt: now - 6 * HOUR, is_online: true,
    last_online: new Date(now - 6 * HOUR).toISOString(), combat: null };
  const fresh = { username: 'fresh', observedAt: now - 30_000, is_online: true,
    last_online: new Date(now - 30_000).toISOString(), combat: null };
  const quiet = { username: 'quiet', observedAt: now - 30_000, is_online: false,
    last_online: new Date(now - 4 * 24 * HOUR).toISOString(), combat: null };
  const ui = { sort: 'live', dir: 1, hideNpc: true, hideOnline: false, minIdleDays: 0 };
  const got = mkRows({ stale, fresh, quiet }, ui, CFG_L).rows().map((x) => x.r.username);
  check('a trusted online reading outranks a stale one', got, ['fresh', 'stale', 'quiet']);

  const marked = mkRows({ stale, fresh, quiet }, ui, CFG_L).rows()
    .filter((x) => x.d.liveNow).map((x) => x.r.username);
  check('only the fresh one is marked live', marked, ['fresh']);
}

console.log('\n— metrics —');
{
  const { derive } = mkDerive(CFG);
  const d = derive({
    last_online: new Date(now - 4 * 24 * HOUR).toISOString(),
    created_at: new Date(now - 4 * 24 * HOUR - 39 * 60_000).toISOString(),
    combat_record: null,
    combat: { attacks_won: 0, attacks_lost: 7 },
  });
  check('idle days computed from last_online', Math.round(d.idleDays), 4);
  check('39 minutes of lifetime reads as never-stuck', d.neverStuck, true);
  check('W-L renders from the combat record', d.record, '0-7');
}
{
  const { derive } = mkDerive(CFG);
  const d = derive({
    last_online: new Date(now - 4 * 24 * HOUR).toISOString(),
    created_at: new Date(now - 20 * 24 * HOUR).toISOString(),
    combat: { attacks_won: 12, attacks_lost: 3 },
  });
  check('a long-lived account is not never-stuck', d.neverStuck, false);
  check('record survives a winning player', d.record, '12-3');
}
{
  const { derive } = mkDerive(CFG);
  const d = derive({ last_online: null, created_at: null, combat: null });
  check('missing last_online yields null idle, not NaN', d.idleMs, null);
  check('missing combat record still renders', d.record, '0-0');
  check('never-stuck is false when there is nothing to compare', d.neverStuck, false);
}

// ---------------------------------------------------------------------------
// The second walk order, added in 1.5.0: the panel's own list.
//
// Worth pinning down harder than the roster walk was, because the roster is a fixed
// order and the list is not — it re-sorts under you as profiles land and as time
// passes. Everything below is really one question: does a keypress still mean "the row
// below the one I am on" after the table has moved?
// ---------------------------------------------------------------------------
console.log('\n— walk: which order the keys follow —');
{
  const roster = rosterOf('ana', 'bo', 'cy');
  const ui = { walk: 'roster' };
  const w = mkWalk(seen('ana', 'bo', 'cy'), roster, '/profile/ana', ui, () => ['cy', 'ana']);
  check('roster mode steps along the roster', w.step(1), 'bo');
  ui.walk = 'list';
  check('list mode steps along the panel', w.step(1), 'cy');
  check('the position is read off whichever order is live', w.walkAt(), 1);
}
{
  const ui = { walk: 'roster' };
  const w = mkWalk({}, rosterOf('ana'), '/profile/ana', ui, () => []);
  w.swapWalk();
  check('swapping flips roster to list', ui.walk, 'list');
  w.swapWalk();
  check('...and list back to roster', ui.walk, 'roster');
}
{
  const ui = { walk: 'list' };
  const w = mkWalk(seen('ana', 'bo'), rosterOf('ana', 'bo'), '/profile/ana', ui, () => []);
  check('an empty list has nowhere to step', w.step(1), null);
  check('...and no position to report', w.walkAt(), -1);
}
{
  // hide online, ≥7d idle, a group you are not in: plenty of ways to be looking at
  // someone the list does not contain
  const ui = { walk: 'list' };
  const w = mkWalk(seen('ana', 'bo', 'cy'), rosterOf('ana', 'bo', 'cy'), '/profile/bo', ui,
    () => ['ana', 'cy']);
  check('standing outside the list starts you at the top of it', w.step(1), 'ana');
  check('...and the readout says you are not in it', w.walkAt(), -1);
}
{
  // the control that fills the ledger must not stop working because you sorted the table
  const ui = { walk: 'list' };
  const w = mkWalk(seen('ana'), rosterOf('ana', 'bo', 'cy'), '/profile/ana', ui, () => ['ana']);
  check('next unseen still walks the roster in list mode', w.nextUnseen(), 'bo');
}

console.log('\n— walk: the list moves, your place does not —');
{
  // sort by freshest data and every profile you open jumps to the top. Counting along
  // the live order would make ] mean "back to the one I just came from", forever.
  const roster = rosterOf('ana', 'bo', 'cy');
  let live = ['ana', 'bo', 'cy'];
  const ui = { walk: 'list', sort: 'fresh', dir: 1, group: 'none' };
  const w = mkWalk(seen('ana', 'bo', 'cy'), roster, '/profile/bo', ui, () => live.slice());

  check('the first step reads the list as it stands', w.step(1), 'cy');
  live = ['bo', 'ana', 'cy'];                    // opening bo made bo the freshest
  check('the table moving does not move your place', w.step(1), 'cy');
  check('...and the walk knows it is behind the table', w.walkStale(live), true);

  w.resyncWalk();
  check('resync takes a fresh copy', w.step(1), 'ana');
  check('...and is no longer behind', w.walkStale(live), false);
}
{
  // changing a control that decides the order is asking for a different list, so the
  // copy is rebuilt without being asked
  const roster = rosterOf('ana', 'bo', 'cy');
  let live = ['ana', 'bo', 'cy'];
  const ui = { walk: 'list', sort: 'idle', dir: 1, group: 'none' };
  const w = mkWalk(seen('ana', 'bo', 'cy'), roster, '/profile/ana', ui, () => live.slice());

  check('takes the list as it stands', w.step(1), 'bo');
  live = ['cy', 'bo', 'ana'];
  ui.dir = -1;                                   // you flipped the order yourself
  check('flipping the order rebuilds the copy', w.step(1), 'cy');

  live = ['bo', 'cy', 'ana'];
  ui.minIdleDays = 7;                            // ...as does changing a filter
  check('changing a filter rebuilds it too', w.step(1), 'bo');

  // and leaving the list for roster order and coming back is asking for it again. This
  // one cannot ride on the signature: roster order never looks at the copy, so nothing
  // would notice the signature change while you were away.
  live = ['ana', 'cy', 'bo'];
  w.swapWalk();                                  // out to roster order
  w.swapWalk();                                  // ...and back into the list
  check('stepping back into the list takes a fresh copy', w.step(1), 'cy');
}
{
  // a stale walk is only a thing in list mode
  const ui = { walk: 'roster' };
  const w = mkWalk(seen('ana'), rosterOf('ana', 'bo'), '/profile/ana', ui, () => ['ana']);
  w.step(1);
  check('roster order is never reported behind', w.walkStale(['bo']), false);
}

console.log('\n— the list the walk follows is the list you can see —');
{
  const D_CFG = { NEVER_STUCK_MS: 2 * HOUR, LIVE_TRUST_MS: 5 * 60_000, LIST_CAP: 400 };
  const who = (n, over) => ({
    username: n, observedAt: now, is_npc: false, is_online: false,
    last_online: new Date(now - 3 * HOUR).toISOString(),
    created_at: new Date(now - 30 * 24 * HOUR).toISOString(),
    combat: { attacks_won: 1, attacks_lost: 1 }, ...over,
  });
  const ledger = {
    ana: who('ana', { faction_name: 'Blue' }),
    bo: who('bo', { faction_name: 'Red' }),
    cy: who('cy', { faction_name: 'Red' }),
    di: who('di'),                                // no membership recorded
  };
  const base = { hideNpc: true, hideOnline: false, minIdleDays: 0, sort: 'name', dir: 1 };
  const mk = (over) => mkRows(ledger, { ...base, ...over }, D_CFG);

  {
    const r = mk({ group: 'none' });
    check('ungrouped, the walk order is rows() flattened',
      r.displayOrder(), r.rows().map((x) => x.r.username));
    check('ungrouped is one nameless bucket',
      r.display().map((g) => g.name), [null]);
  }
  {
    // grouping reorders the table, so it has to reorder the walk by the same amount
    const r = mk({ group: 'faction' });
    check('buckets: biggest first, unrecorded last',
      r.display().map((g) => [g.name, g.members.length]),
      [['Red', 2], ['Blue', 1], ['not recorded', 1]]);
    check('the walk follows the buckets, not the raw sort',
      r.displayOrder(), ['bo', 'cy', 'ana', 'di']);
  }
  {
    // the table stops drawing at the cap, so the walk has to stop counting there —
    // otherwise ] eventually sends you to a row that is not on screen
    const r = mkRows(ledger, { ...base, group: 'none' }, { ...D_CFG, LIST_CAP: 2 });
    check('the walk stops at the same cap the table draws', r.displayOrder(), ['ana', 'bo']);
  }
}

console.log('\n— column sizing —');
{
  const COLUMNS = [
    { key: 'player' }, { key: 'idle' }, { key: 'city' }, { key: 'social' },
    { key: 'rank' }, { key: 'record' }, { key: 'seen' },
  ];
  const SHOWN = { player: 91, idle: 86, city: 66, social: 86, rank: 91, record: 59, seen: 66 };
  const SUM = Object.values(SHOWN).reduce((a, b) => a + b, 0);

  {
    // Nothing stored is not a layout to restore. The table has to be left exactly as
    // the stylesheet wrote it, or `width: 100%` is fighting an inline table-layout
    // that nobody asked for.
    const ui = { cols: null };
    const c = mkCols(ui, COLUMNS, SHOWN);
    c.applyCols(c.table);
    check('no stored widths leaves the layout alone', c.table.style.tableLayout, '');
    check('...and writes no column width', c.widths(), ['', '', '', '', '', '', '']);
  }

  {
    const ui = { cols: { ...SHOWN, city: 26 } };
    const c = mkCols(ui, COLUMNS, SHOWN);
    c.applyCols(c.table);
    check('a full map pins the layout', c.table.style.tableLayout, 'fixed');
    check('...writes every column', c.widths(),
      ['91px', '86px', '26px', '86px', '91px', '59px', '66px']);
    // The min-width is what makes the body scroll rather than the columns shrink, so
    // it has to be the sum of the widths actually written — including the clamp.
    check('...and a min-width that is their sum', c.table.style.minWidth, `${SUM - 40}px`);
  }

  {
    // A width below the floor is stored as asked and drawn at the floor, so dragging
    // past the end and back does not lose the column you were dragging.
    const ui = { cols: { ...SHOWN, city: 4 } };
    const c = mkCols(ui, COLUMNS, SHOWN);
    c.applyCols(c.table);
    check('a width under the floor is drawn at the floor', c.widths()[2], '26px');
    check('...and counted at the floor too', c.table.style.minWidth, `${SUM - 66 + 26}px`);
  }

  {
    // The migration path: a stored map from before a column existed, carrying junk
    // and a key for a column that has since gone. Dropping the whole map over that
    // would throw away a layout someone chose; keeping the junk would write
    // `width: NaNpx`, which the browser ignores without saying so.
    const ui = { cols: { player: 200, city: 40, rank: null, ancient: 999 } };
    const c = mkCols(ui, COLUMNS, SHOWN);
    c.applyCols(c.table);
    check('a partial map keeps what was set', [ui.cols.player, ui.cols.city], [200, 40]);
    check('...measures what was missing', ui.cols.rank, SHOWN.rank);
    check('...drops a column that no longer exists', 'ancient' in ui.cols, false);
    check('...and is complete afterwards', c.colsComplete(ui.cols), true);
  }

  {
    // A gesture starts from the widths on screen, not from the naturals — measuring
    // naturals here would make the first pixel of the first drag a whole-table jump.
    const ui = { cols: null };
    const c = mkCols(ui, COLUMNS, SHOWN);
    check('the first gesture starts from what is on screen', c.colBase(c.table), SHOWN);
    ui.cols = { ...SHOWN, city: 30 };
    check('a later one starts from what is stored', c.colBase(c.table).city, 30);
    c.colBase(c.table).city = 1;
    check('...by copy, so a cancelled gesture cannot edit it', ui.cols.city, 30);
  }

  {
    // measureNatural() unpins the layout to read it and has to put every part of it
    // back — the class, the col widths, and both table properties.
    const ui = { cols: { ...SHOWN, city: 26 } };
    const c = mkCols(ui, COLUMNS, SHOWN);
    c.applyCols(c.table);
    const before = c.widths();
    c.measureNatural(c.table);
    check('measuring leaves no class behind', c.table.classList.names.size, 0);
    check('...restores every column width', c.widths(), before);
    check('...and the table properties', [c.table.style.tableLayout, c.table.style.minWidth],
      ['fixed', `${SUM - 40}px`]);
  }

  {
    const ui = { cols: { ...SHOWN } };
    const c = mkCols(ui, COLUMNS, SHOWN);
    c.applyCols(c.table);
    c.resetCols();
    check('the title bar hands the columns back', ui.cols, null);
  }
}

// ---------------------------------------------------------------------------
// Three things the arithmetic above cannot see, because they are structural.
// ---------------------------------------------------------------------------
console.log('\n— column sizing, structurally —');
{
  // `table-layout: fixed` shares spare width over EVERY column, so a panel wider than
  // the sum inflates all seven and none is the width it was dragged to. The eighth
  // column, declared with no width, is what takes the slack instead. It has to exist
  // in all three places or the rows come apart: one <col>, one <th>, one <td> a row —
  // and the group header's colSpan has to count it.
  const fillers = (SRC.match(/className: 'fill'/g) || []).length;
  check('the slack column is built in the head and in every row', fillers, 2);
  check('...has a <col> of its own, deliberately outside colEls',
    /colgroup\.append\(document\.createElement\('col'\)\); \/\/ the slack column/.test(SRC), true);
  check('...and the group header spans it', /colSpan = COLUMNS\.length \+ 1;/.test(SRC), true);

  // A repaint replaces the divider holding the pointer capture, and the drag stops
  // dead. paint() runs on every response, so this is seconds away at all times.
  check('a repaint waits for the drag to finish',
    /if \(colDragging\) \{ paintQueued = true; return; \}/.test(SRC)
    && /if \(paintQueued\) \{ paintQueued = false; paint\(\); \}/.test(SRC), true);

  // Sized columns are what make the table wider than its body, so sideways became a
  // place you can be — and a repaint that only restores scrollTop drops you back to
  // the left edge on every response, losing the column you scrolled across to read.
  check('a repaint restores both scroll axes',
    /kept\.top = b\.scrollTop; kept\.left = b\.scrollLeft;/.test(SRC)
    && /body\.scrollLeft = kept\.left;/.test(SRC), true);

  // The header sorts on click and the divider lives inside it. Stopping the pointer
  // event does not stop the click that follows, so both are needed — grabbing a
  // divider must never also re-sort the table under the gesture.
  check('the divider keeps its clicks away from the sort',
    /g\.addEventListener\('click', \(ev\) => ev\.stopPropagation\(\)\);/.test(SRC), true);
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
