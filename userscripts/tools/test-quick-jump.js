// Slices quick-jump's catalogue, ingest and derived layers out of the shipped file and
// drives them against synthetic payloads.
//
// Two things are actually load-bearing here.
//
// The first is dispatch order. `/api/corporations/mine` and `/api/corporations/7/casino`
// both also satisfy the looser `/api/corporations/<id>` shape, so a mis-ordered chain
// quietly files your own corp under the id "mine" and files a casino summary as if it
// were a corporation. Neither failure throws; both just produce a launcher full of
// plausible garbage.
//
// The second is the gate. `current_city_access` is a snapshot from whenever that corp
// page last loaded, and offering a casino door without it is worse than offering
// nothing — it costs a page load to be told to travel. See docs/12-navigation-surface.md.
//
// Run: node userscripts/tools/test-quick-jump.js
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'quick-jump.user.js'), 'utf8');

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from} .. ${to}`);
  return SRC.slice(i, j);
};

// catalogue + ingest/dispatch + derived, with the fetch and XHR wraps cut out from
// between them — those patch globals that do not exist here, and are the fence's job
// (tools/test-quick-jump-passive.js). Nothing in any slice runs at definition time.
const SLICE =
  cut('  const CATALOG = [', '  // Ingest — everything below')
  + cut('  const now = () => Date.now();', '  const origFetch = window.fetch;')
  + cut('  const fmtAge = (ms) =>', '  // CSS');

/** The slice closes over module state and over paint/save; inject inert versions. */
const mk = (places = { corps: {}, casinos: {}, factions: {} }) => {
  const CFG = { FRESH_MS: 5 * 60_000, PIN_MAX: 9, RECENT_MAX: 8 };
  const ui = { pins: [] };
  const api = new Function('places', 'ui', 'CFG', 'savePlaces', 'saveUi', 'paint', 'log', 'location',
    `${SLICE}\nreturn { CATALOG, HIDDEN_GAMES, GAME_LABEL, dispatch, ingestCorp, ingestCasino,`
    + ` gateOf, liveGames, casinoCorps, otherCorps, allDestinations, labelFor, route };`
  )(places, ui, CFG, () => {}, () => {}, () => {}, () => {}, { origin: 'https://politiko.io' });
  return { ...api, places, ui };
};

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};
const ok = (label, cond, detail) => {
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}`);
  if (!cond) { console.log(`        ${detail}`); fail++; }
};

const API = 'https://politiko.io/api';

// ---------------------------------------------------------------------------
// Fixtures — shapes read off the 2026-08-10 bundle, not off the wire.
// ---------------------------------------------------------------------------
const dirPage = {
  total: 3, pages: 1,
  items: [
    { id: 7, name: 'The House', type: 'casino', location_name: 'Tijuana', is_active: true },
    { id: 12, name: 'Meridian Logistics', type: 'logistics', location_name: 'Vegas', is_active: true },
    { id: 30, name: 'Dead Letter Media', type: 'media', location_name: 'Tijuana', is_active: false },
  ],
};

const casinoSummary = (over = {}) => ({
  operational: true,
  wagering_suspended: false,
  current_city_access: true,
  venues: [{ property_id: 501, location_name: 'Tijuana' }, { property_id: 502, location_name: 'Vegas' }],
  games: [
    { key: 'blackjack', status: 'live' },
    { key: 'slots', status: 'live' },
    { key: 'roulette', status: 'live' },
    { key: 'poker', status: 'live' },
    { key: 'predictions', status: 'live' },
    { key: 'craps', status: 'live' },
  ],
  available_dealers: 2, dealer_capacity: 4, reserve_balance: 250_000,
  ...over,
});

console.log('\n— dispatch files things where they belong —');
{
  const t = mk();
  t.dispatch(`${API}/corporations?page=1`, dirPage);
  check('a directory page lands three corps', Object.keys(t.places.corps).sort(), ['12', '30', '7']);
  check('the casino is typed', t.places.corps['7'].type, 'casino');
  check('...and no casino summary was invented', Object.keys(t.places.casinos), []);
}
{
  const t = mk();
  t.dispatch(`${API}/corporations/mine`, { id: 9, name: 'My Corp', type: 'factory' });
  ok('/corporations/mine is not a corp called "mine"', !t.places.corps.mine, JSON.stringify(t.places.corps));
  check('it is filed under its real id', Object.keys(t.places.corps), ['9']);
}
{
  const t = mk();
  t.dispatch(`${API}/corporations/7/casino`, casinoSummary());
  check('a casino summary is filed as a casino', Object.keys(t.places.casinos), ['7']);
  ok('...and stubs the corp so it is nameable', !!t.places.corps['7'], 'expected a corp stub for 7');
  check('...typed as a casino', t.places.corps['7'].type, 'casino');
  check('venues survive', t.places.casinos['7'].venues.map((v) => v.location_name), ['Tijuana', 'Vegas']);
}
{
  const t = mk();
  t.dispatch(`${API}/corporations/7`, { id: 7, name: 'The House', location_name: 'Tijuana' });
  check('a corp detail page lands one corp', Object.keys(t.places.corps), ['7']);
  check('...and did not become a casino summary', Object.keys(t.places.casinos), []);
}
{
  const t = mk();
  t.dispatch(`${API}/factions/mine`, { faction: { id: 3, name: 'RE:PUBLIC' } });
  check('a faction is unwrapped from .faction', t.places.factions['3'].name, 'RE:PUBLIC');
}
{
  const t = mk();
  t.dispatch(`${API}/users/bob`, { id: 'bob' });
  t.dispatch(`${API}/stocks/holdings`, [{ id: 1 }]);
  check('unrelated responses are ignored',
    [Object.keys(t.places.corps).length, Object.keys(t.places.factions).length], [0, 0]);
}

console.log('\n— learning is idempotent, and additive —');
{
  const t = mk();
  t.dispatch(`${API}/corporations?page=1`, dirPage);
  t.dispatch(`${API}/corporations?page=1`, dirPage);
  check('the same page twice is still three corps', Object.keys(t.places.corps).length, 3);

  // the corp detail response carries no `type`; the directory row did. Losing it here
  // would drop The House out of the casino list on the next visit to its own page.
  t.dispatch(`${API}/corporations/7`, { id: 7, name: 'The House Ltd' });
  check('a later payload without a type keeps the known one', t.places.corps['7'].type, 'casino');
  check('...but does take the newer name', t.places.corps['7'].name, 'The House Ltd');
}

console.log('\n— the gate is always stated —');
{
  const t = mk();
  const gate = (over, ageMs = 1000) => {
    t.places.casinos['7'] = { ...casinoSummary(over), seenAt: Date.now() - ageMs };
    return t.gateOf('7');
  };
  check('unknown when never seen', t.gateOf('99').tone, 'dim');
  ok('...and says how to fix it', /open its corp page/.test(t.gateOf('99').text), t.gateOf('99').text);

  check('open reads positive', gate({}).tone, 'pos');
  ok('...with an age attached', /ago/.test(gate({}).text), gate({}).text);

  const away = gate({ current_city_access: false });
  check('locked reads as a warning', away.tone, 'warn');
  ok('...and names the cities to travel to', /Tijuana \/ Vegas/.test(away.text), away.text);

  check('no venue is dim', gate({ operational: false }).tone, 'dim');
  check('suspended wagering is negative', gate({ wagering_suspended: true }).tone, 'neg');

  // an open gate read an hour ago is not the same claim as one read a second ago
  check('a stale open gate is downgraded, not hidden', gate({}, 60 * 60_000).tone, 'warn');
  ok('...and still says it is open', /open to you/.test(gate({}, 60 * 60_000).text), gate({}, 60 * 60_000).text);
}

console.log('\n— it offers only doors the game offers —');
{
  const t = mk();
  t.dispatch(`${API}/corporations/7/casino`, casinoSummary());
  const keys = t.liveGames('7').map((g) => g.key);
  check('craps is dropped even when the server calls it live', keys,
    ['blackjack', 'slots', 'roulette', 'poker', 'predictions']);

  t.dispatch(`${API}/corporations/7/casino`, casinoSummary({
    games: [{ key: 'blackjack', status: 'live' }, { key: 'poker', status: 'closed' }],
  }));
  check('a game that is not live is dropped', t.liveGames('7').map((g) => g.key), ['blackjack']);

  const hrefs = t.allDestinations().map((d) => d.href);
  ok('no craps route is ever emitted', !hrefs.some((h) => h.includes('craps')),
    hrefs.filter((h) => h.includes('craps')).join(' | '));
  ok('the floor is offered', hrefs.includes('/corporations/7/casino'), 'missing floor href');
  ok('the table is offered', hrefs.includes('/corporations/7/casino/blackjack'), 'missing blackjack href');
}

console.log('\n— casinos sort by whether you can get in —');
{
  const t = mk();
  t.dispatch(`${API}/corporations?page=1`, dirPage);
  t.dispatch(`${API}/corporations/40/casino`, casinoSummary({ current_city_access: true }));
  t.places.corps['40'].name = 'Aurora Rooms';
  t.places.casinos['7'] = { ...casinoSummary({ current_city_access: false }), seenAt: Date.now() };
  check('the one you can walk into is first', t.casinoCorps().map((c) => c.name),
    ['Aurora Rooms', 'The House']);
  check('non-casino corps stay out of the casino list',
    t.otherCorps().map((c) => c.name).sort(), ['Dead Letter Media', 'Meridian Logistics']);
}
{
  // The corp page fetches /corporations/<id>/casino for every corporation it renders,
  // so a summary can legitimately arrive attached to a haulage company. Listing it
  // would put a warehouse in the casino section.
  const t = mk();
  t.dispatch(`${API}/corporations?page=1`, dirPage);
  t.dispatch(`${API}/corporations/12/casino`, casinoSummary({
    operational: false, current_city_access: false, venues: [], games: [],
  }));
  check('a dead summary on a non-casino corp is not a casino',
    t.casinoCorps().some((c) => c.name === 'Meridian Logistics'), false);
  check('...and it stays an ordinary corp', t.otherCorps().some((c) => c.name === 'Meridian Logistics'), true);

  // the two lists must partition: anything falling out of both vanishes from the panel
  const all = Object.keys(t.places.corps).length;
  check('every known corp appears in exactly one list',
    t.casinoCorps().length + t.otherCorps().length, all);

  // but a corp the directory typed `casino` belongs there even with no floor yet —
  // the client has copy for exactly this state ("Awaiting a venue")
  t.dispatch(`${API}/corporations/7/casino`, casinoSummary({
    operational: false, current_city_access: false, venues: [], games: [],
  }));
  check('a typed casino with no venue is still listed', t.casinoCorps().map((c) => c.name), ['The House']);
  check('...and says so', t.gateOf('7').text, 'no venue — floor closed');
}

console.log('\n— every catalogue entry is a real route —');
{
  // Measured 2026-08-10 from the router in the entry bundle. Auth, error and redirect
  // routes are excluded — they are not destinations. `/` is an index route with no
  // `path` of its own, so it is added by hand.
  const REAL = new Set(['/',
    '/actions', '/actions/activism', '/actions/car-theft', '/actions/donations',
    '/actions/drug-deal', '/actions/graffiti', '/actions/hacking', '/actions/opinion-poll',
    '/actions/sleeper-recruitment', '/city', '/city/bank', '/city/cockfighting', '/contact',
    '/contacts', '/corporations', '/corporations/directory', '/education', '/estate-market',
    '/events', '/faction', '/factions/directory', '/fedded', '/forums', '/forums/my-posts',
    '/government', '/hospital', '/inventory', '/jail', '/job', '/market', '/market/players',
    '/marriage', '/messages', '/news', '/newspaper', '/newspaper/classified-ads/manage',
    '/newspaper/job-listings/manage', '/newspaper/personals/manage',
    '/newspaper/post-classified-ad', '/newspaper/post-job-listing', '/newspaper/post-personal',
    '/people', '/property', '/protests', '/rules', '/settings', '/settings/sidebar',
    '/stocks', '/trades', '/train', '/travel', '/wiki',
  ]);

  const t = mk();
  const flat = t.CATALOG.flatMap(([group, items]) => items.map(([href, label]) => ({ href, label, group })));
  const bogus = flat.filter((d) => !REAL.has(d.href));
  ok('no catalogue entry points at a route that does not exist', bogus.length === 0,
    bogus.map((d) => d.href).join(' | '));

  const dupes = flat.map((d) => d.href).filter((h, i, a) => a.indexOf(h) !== i);
  ok('no destination is listed twice', dupes.length === 0, dupes.join(' | '));
  ok('every entry has a label', flat.every((d) => d.label && d.label.length > 1), 'blank label');

  // the point of the tool: most of what it offers has no sidebar entry
  const SIDEBAR = new Set(['/', '/messages', '/contacts', '/faction', '/corporations', '/city',
    '/actions', '/train', '/travel', '/people', '/inventory', '/trades', '/job', '/hospital',
    '/jail', '/education', '/market', '/stocks', '/events', '/government']);
  const beyond = flat.filter((d) => !SIDEBAR.has(d.href)).length;
  ok(`${beyond} of ${flat.length} catalogue entries are unreachable from the sidebar`,
    beyond >= 30, `only ${beyond} — has the catalogue shrunk?`);

  // /property/:id resolves to the same component as /property and the client never
  // links to it, so its behaviour is unverified. Not shipped until somebody checks.
  ok('the unverified /property/:id form is not shipped',
    !t.allDestinations().some((d) => /^\/property\/.+/.test(d.href)),
    'see docs/12-navigation-surface.md');
}

console.log('\n— labels resolve for pinned hrefs —');
{
  const t = mk();
  t.dispatch(`${API}/corporations?page=1`, dirPage);
  t.dispatch(`${API}/corporations/7/casino`, casinoSummary());
  check('a pinned floor shows the casino name', t.labelFor('/corporations/7/casino'), 'The House · casino floor');
  check('a pinned static route shows its label', t.labelFor('/corporations/directory'), 'Corporation directory');
  check('an unknown href falls back to itself', t.labelFor('/nowhere'), '/nowhere');
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
