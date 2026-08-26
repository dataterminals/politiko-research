// Slices world-watch's constant table, aggregation core and ingest layer straight out
// of the shipped script and drives them with canned payloads. No DOM, no clock beyond
// Date.now(), no network — the harness cage exists for the panel; this is for the math.
//
// The thing worth guarding here is not the arithmetic, it is the *filing*. Every figure
// this tool prints is a mean over issues, split by the axis the game itself assigns each
// issue to. Mis-file one issue and the compass moves for reasons nobody can see, so the
// first block below checks all twenty against both names the client uses for them.
//
// Run: node userscripts/tools/test-world.js
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'world-watch.user.js'), 'utf8');

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from} .. ${to}`);
  return SRC.slice(i, j);
};

// One continuous range: the game constants, the pure aggregation core, the stored-state
// helpers and every take*() the tap feeds. It stops at the fetch wrapper, which is the
// only part that needs a browser.
const SLICE = cut('  const BOX = 16, PLOT = 188', '  const origFetch = window.fetch;');

const mk = () => {
  const store = {};
  const api = new Function('K', 'readJSON', 'writeJSON', 'log', 'scheduleRender', 'location', `
    ${SLICE}
    return { clamp3, px, py, word, short, hue, norm, issueOf, catOf, labelOf, ISSUE, POLICY,
             ORDER, FIPS, CITY_FIPS, BUCKETS, COARSE, leanOfMeter, leanOfCounts,
             leanOfDominance, pollMean, axes, meanOfPeople, radius,
             data, ui, LAYERS, pointOf, freshOf, rowsState, rowsPublic, rowsStreet,
             rowsMedia, peopleRows, cityKeys, cityName, cityKey, consume, seenKey };
  `)(
    { data: 'pkww:data', ui: 'pkww:ui' },
    (k, fallback) => (k in store ? JSON.parse(store[k]) : fallback),
    (k, v) => { store[k] = JSON.stringify(v); },
    () => {},
    () => {},
    { href: 'https://politiko.io/' },
  );
  api.feed = (p, body, query) => api.consume(p, `https://politiko.io${p}${query ? `?${query}` : ''}`, body);
  return api;
};

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};
const near = (label, got, want, tol = 1e-9) => {
  const ok = got != null && Math.abs(got - want) <= tol;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${got}\n        want ${want} ±${tol}`); fail++; }
};

// ---------------------------------------------------------------------------
console.log('\n— the filing: 20 issues, 13 social and 7 economic —');
{
  const w = mk();
  check('twenty issues, no more and no fewer', w.ORDER.length, 20);
  const social = w.ORDER.filter((s) => w.catOf(s) === 'social');
  const econ = w.ORDER.filter((s) => w.catOf(s) === 'economic');
  check('thirteen social', social.length, 13);
  check('seven economic', econ.length, 7);
  check('every issue is filed', social.length + econ.length, 20);

  // The two spellings the client actually ships: the slug it posts, and the label the
  // Government screen prints. Both have to land on the same issue.
  check('every policy name resolves', Object.keys(w.POLICY).filter((n) => !w.issueOf(n)), []);
  check('the policy names cover all twenty issues',
    new Set(Object.keys(w.POLICY).map((n) => w.issueOf(n))).size, 20);
  check('policy names and issue slugs agree on the axis',
    Object.entries(w.POLICY).filter(([n, slug]) => w.catOf(w.issueOf(n)) !== w.catOf(slug)), []);

  check('Drug Law is the Drugs issue', w.issueOf('Drug Law'), 'drugs');
  check('Gay Rights is LGBT Rights', w.issueOf('Gay Rights'), 'lgbt-rights');
  check('Labor Laws is Sweatshops', w.issueOf('Labor Laws'), 'sweatshops');
  check('ProtestPage\'s longer Police label resolves', w.issueOf('Police Behavior'), 'police-behavior');
  check('an apostrophe does not matter', w.issueOf("Women's Rights"), 'womens-rights');
  check('case and spacing do not matter', w.issueOf('  NUCLEAR   power '), 'nuclear-power');
  check('an unknown issue is null, not a guess', w.issueOf('Space Program'), null);
  check('a missing issue is null', w.issueOf(undefined), null);
}

// ---------------------------------------------------------------------------
console.log('\n— the compass geometry is ProfilePage\'s own —');
{
  const w = mk();
  check('economic −3 is the left edge', w.px(-3), 16);
  check('economic +3 is the right edge', w.px(3), 204);
  check('economic 0 is the middle', w.px(0), 110);
  check('social +3 is the TOP', w.py(3), 16);
  check('social −3 is the bottom', w.py(-3), 204);
  check('out of range clamps rather than escaping the box', [w.px(99), w.py(-99)], [204, 204]);
  check('the word scale is the client\'s, not the wiki\'s', [w.word(-3), w.word(0), w.word(3)],
    ['Tankie', 'Moderate', 'Fascist']);
  check('and it rounds to the nearest cell', w.word(1.4), 'Moderate Right');
  check('short codes match', [w.short(-2), w.short(2)], ['L+', 'R+']);
}

// ---------------------------------------------------------------------------
console.log('\n— left is negative, everywhere —');
{
  const w = mk();
  // protestShared draws the meter as `50 − meter/2` percent from the left, so a
  // negative meter is the left side winning. Every rescale here has to keep that sign.
  near('a −100 meter is the far left', w.leanOfMeter(-100), -3);
  near('a +100 meter is the far right', w.leanOfMeter(100), 3);
  near('a deadlocked meter is the centre', w.leanOfMeter(0), 0);
  near('and it is linear in between', w.leanOfMeter(50), 1.5);
  near('beyond ±100 still clamps', w.leanOfMeter(400), 3);

  near('a wall count of 3 left, 1 right leans left', w.leanOfCounts(3, 1), -1.5);
  near('an even wall is the centre', w.leanOfCounts(7, 7), 0);
  check('no counts is no reading, not a centred one', w.leanOfCounts(0, 0), null);

  near('a left-dominant state is negative',
    w.leanOfDominance({ dominant_side: 'left', dominance_score: 60, active_protests: 2 }), -1.8);
  near('a right-dominant state is positive',
    w.leanOfDominance({ dominant_side: 'right', dominance_score: 100, active_protests: 1 }), 3);
  check('a state with no active protest has no lean',
    w.leanOfDominance({ dominant_side: 'left', dominance_score: 90, active_protests: 0 }), null);
  check('a sideless row has no lean',
    w.leanOfDominance({ dominant_side: null, dominance_score: 90, active_protests: 3 }), null);
}

// ---------------------------------------------------------------------------
console.log('\n— polls: seven buckets, or three —');
{
  const w = mk();
  const exact = { far_left: 10, center_left: 10, slight_left: 10, neutral: 40, slight_right: 10, center_right: 10, far_right: 10 };
  const m = w.pollMean(exact);
  check('a symmetric public is dead centre', [m.mean, m.exact], [0, true]);
  near('a right-skewed public reads right',
    w.pollMean({ far_left: 0, center_left: 0, slight_left: 10, neutral: 20, slight_right: 30, center_right: 30, far_right: 10 }).mean,
    (10 * -1 + 20 * 0 + 30 * 1 + 30 * 2 + 10 * 3) / 100);

  const coarse = w.pollMean({ left_bloc: 50, center: 20, right_bloc: 30 });
  check('a cheap poll is recognised as coarse', coarse.exact, false);
  near('...and its blocs use the midpoints of the thirds they cover', coarse.mean, (50 * -2 + 30 * 2) / 100);

  // The client's own test for which shape arrived is `far_left === undefined`, so a
  // zero in that field must still count as the exact shape.
  check('far_left: 0 is still the exact shape',
    w.pollMean({ far_left: 0, neutral: 100 }).exact, true);
  check('a body with no buckets is no reading', w.pollMean({ issue: 'taxes' }), null);
  check('and neither is nothing at all', w.pollMean(null), null);
}

// ---------------------------------------------------------------------------
console.log('\n— the aggregator —');
{
  const w = mk();
  const p = w.axes([
    { cat: 'social', v: 2 }, { cat: 'social', v: -2 },
    { cat: 'economic', v: 3 },
  ]);
  check('axes are kept apart', [p.s, p.e], [0, 3]);
  check('and each counts its own samples', [p.sn, p.en], [2, 1]);

  const weighted = w.axes([{ cat: 'social', v: 3, w: 90 }, { cat: 'social', v: -3, w: 10 }]);
  near('weight moves the mean', weighted.s, (3 * 90 - 3 * 10) / 100);

  check('an empty axis is null, never zero', w.axes([{ cat: 'social', v: 1 }]).e, null);
  check('...and reports no samples', w.axes([]).sn, 0);
  check('a non-numeric value is skipped, not coerced',
    w.axes([{ cat: 'social', v: 'left' }, { cat: 'social', v: 2 }]).sn, 1);
  check('a zero weight falls back to one, rather than erasing the row',
    w.axes([{ cat: 'economic', v: 2, w: 0 }]).e, 2);
  check('an unfiled row cannot reach either axis',
    w.axes([{ cat: null, v: 3 }]), { s: null, sn: 0, e: null, en: 0 });

  const people = w.meanOfPeople([{ s: 1, e: -1 }, { s: 3, e: 1 }]);
  check('players average on both axes at once', [people.s, people.e, people.sn], [2, 0, 2]);
  check('a player missing an axis is not half-counted',
    w.meanOfPeople([{ s: 1 }, { s: 3, e: 1 }]).sn, 1);
  near('radius is the distance from dead centre', w.radius({ s: 3, e: 4 }), 5);
}

// ---------------------------------------------------------------------------
console.log('\n— ingest: the law —');
const GOV = {
  president: { name: 'President Hoppe', alignment: 2, favorability: 18, term_number: 3 },
  house: [{ alignment: -2, count: 120 }, { alignment: 0, count: 200 }, { alignment: 2, count: 115 }],
  senate: [{ alignment: -1, count: 40 }, { alignment: 1, count: 60 }],
  supreme_court: [{ id: 1, name: 'J. Alder', alignment: 3 }, { id: 2, name: 'J. Brand', alignment: -1 }],
  next_congressional_election: 'Y7 D310',
  next_presidential_election: 'Y8 D040',
  policies: [
    { policy_id: 1, policy_name: 'Free Speech', axis: -1 },
    { policy_id: 2, policy_name: 'Police Regulation', axis: 2 },
    { policy_id: 3, policy_name: 'Civil Rights', axis: -1 },
    { policy_id: 4, policy_name: 'Immigration', axis: 3 },
    { policy_id: 5, policy_name: 'Drug Law', axis: 1 },
    { policy_id: 6, policy_name: 'Abortion Rights', axis: 0 },
    { policy_id: 7, policy_name: 'Animal Rights', axis: -2 },
    { policy_id: 8, policy_name: 'Healthcare', axis: -3 },
    { policy_id: 9, policy_name: 'Gay Rights', axis: 1 },
    { policy_id: 10, policy_name: 'Gun Control', axis: 2 },
    { policy_id: 11, policy_name: 'Human Rights', axis: 1 },
    { policy_id: 12, policy_name: 'Privacy Rights', axis: 2 },
    { policy_id: 13, policy_name: 'Womens Rights', axis: 0 },
    { policy_id: 14, policy_name: 'Corporate Law', axis: 3 },
    { policy_id: 15, policy_name: 'Election Reform', axis: -1 },
    { policy_id: 16, policy_name: 'Labor Laws', axis: 2 },
    { policy_id: 17, policy_name: 'Military Spending', axis: 3 },
    { policy_id: 18, policy_name: 'Nuclear Power', axis: 0 },
    { policy_id: 19, policy_name: 'Pollution', axis: -2 },
    { policy_id: 20, policy_name: 'Tax Structure', axis: 1 },
  ],
};
{
  const w = mk();
  w.feed('/api/government', GOV);
  const law = w.LAYERS.find((l) => l.key === 'state');
  const p = w.pointOf(law, null);
  check('all twenty policies land, filed 13 and 7', [p.sn, p.en], [13, 7]);
  near('the social axis is the mean of the thirteen', p.s, (-1 + 2 - 1 + 3 + 1 + 0 - 2 - 3 + 1 + 2 + 1 + 2 + 0) / 13);
  near('the economic axis is the mean of the seven', p.e, (3 - 1 + 2 + 3 + 0 - 2 + 1) / 7);
  check('the president survives the trip', [w.data.gov.president.name, w.data.gov.president.a], ['President Hoppe', 2]);
  check('both chambers are kept as buckets', [w.data.gov.house.length, w.data.gov.senate.length], [3, 2]);
  check('the court is kept per justice', w.data.gov.court.length, 2);
  check('nothing was unfiled', w.data.gov.unknown, []);

  // A policy the client has never heard of must be visible, not silently dropped —
  // a twenty-first issue would change every figure on the panel.
  const w2 = mk();
  w2.feed('/api/government', { policies: [...GOV.policies, { policy_id: 21, policy_name: 'Space Program', axis: 3 }] });
  check('an unrecognised policy is reported rather than averaged in', w2.data.gov.unknown, ['Space Program']);
  check('...and the axes are unchanged by it', w2.pointOf(w2.LAYERS[0], null).sn, 13);
}
{
  // The faction lobbying screen carries the same policy list. It must top the axes up
  // without inventing a government payload's other halves.
  const w = mk();
  w.feed('/api/factions/12/jobs', { policies: [{ policy_name: 'Taxes', axis: -3 }], congress_members: [{ id: 1, alignment: 2 }] });
  check('the lobbying screen alone can seed the law', w.data.gov.policies.taxes, -3);
  check('...and brings no chamber data with it', [w.data.gov.house, w.data.gov.president], [[], null]);
  w.feed('/api/government', GOV);
  w.feed('/api/factions/12/jobs', { policies: [{ policy_name: 'Tax Structure', axis: -3 }] });
  check('a later lobbying read updates one axis in place', w.data.gov.policies.taxes, -3);
  check('...and leaves the other nineteen alone', Object.keys(w.data.gov.policies).length, 20);
}

// ---------------------------------------------------------------------------
console.log('\n— ingest: the public —');
{
  const w = mk();
  w.feed('/api/actions/poll', {
    issue: 'Taxes', method: 'professional', mood: 'right-leaning', salience: 'hot', volatility: 'moderate',
    far_left: 5, center_left: 5, slight_left: 10, neutral: 20, slight_right: 20, center_right: 30, far_right: 10,
  });
  check('a poll files itself under its issue', Object.keys(w.data.polls), ['taxes']);
  check('...on the economic axis', w.pointOf(w.LAYERS.find((l) => l.key === 'public'), null).en, 1);
  check('...and not the social one', w.pointOf(w.LAYERS.find((l) => l.key === 'public'), null).s, null);
  check('the method and mood come along', [w.data.polls.taxes.exact, w.data.polls.taxes.mood], [true, 'right-leaning']);

  w.feed('/api/actions/poll', { issue: 'taxes', method: 'street', left_bloc: 80, center: 10, right_bloc: 10 });
  check('a second poll on the same issue replaces the first, it does not stack',
    Object.keys(w.data.polls).length, 1);
  check('...and the newer coarse reading is marked coarse', w.data.polls.taxes.exact, false);
  near('...with the coarse mean', w.data.polls.taxes.mean, (80 * -2 + 10 * 2) / 100);

  w.feed('/api/actions/poll', { issue: 'Not An Issue', far_left: 100 });
  check('a poll on an unknown issue is not stored', Object.keys(w.data.polls).length, 1);
}

// ---------------------------------------------------------------------------
console.log('\n— ingest: the street, and where it happened —');
const LOCS = [
  { id: 1, key: 'san-francisco', name: 'San Francisco', kind: 'domestic' },
  { id: 2, key: 'new-york', name: 'New York', kind: 'domestic' },
  { id: 6, key: 'tijuana', name: 'Tijuana', kind: 'overseas' },
];
{
  const w = mk();
  w.feed('/api/locations', LOCS);
  check('the world\'s cities are learned', w.cityKeys().length, 3);
  check('...with the FIPS of the state they sit in', w.data.cities.sanfrancisco.fips, '06');
  check('...and none invented for an overseas one', w.data.cities.tijuana.fips, null);

  w.feed('/api/protests', [
    { id: 11, issue: 'gun-control', meter: -60, left_count: 8, right_count: 2, left_power: 5, right_power: 1 },
    { id: 12, issue: 'Taxes', meter: 40, left_count: 1, right_count: 3 },
  ], 'location_id=1');
  const street = w.LAYERS.find((l) => l.key === 'street');
  check('a list fetched for a location is attributed to that city',
    Object.values(w.data.protests).map((p) => p.city), ['sanfrancisco', 'sanfrancisco']);
  const sf = w.pointOf(street, 'sanfrancisco');
  near('the social axis carries the gun-control meter', sf.s, -1.8);
  near('the economic axis carries the tax meter', sf.e, 1.2);
  check('the other city has no street reading', w.pointOf(street, 'newyork'), { s: null, sn: 0, e: null, en: 0 });

  // Weight is heads: a protest with 10 people says more than one with 2.
  w.feed('/api/protests', [
    { id: 13, issue: 'gun-control', meter: 100, left_count: 0, right_count: 90 },
  ], 'location_id=1');
  const after = w.pointOf(street, 'sanfrancisco');
  near('a big protest outweighs a small one', after.s, (-1.8 * 10 + 3 * 90) / 100);

  // The home page names one protest and its city but carries no meter at all.
  const w2 = mk();
  w2.feed('/api/home/active-protest', { id: 99, issue: 'Abortion', city_name: 'New York' });
  check('the home page places a protest', w2.data.protests['99'].city, 'newyork');
  check('...but a protest with no meter is not a deadlocked one',
    w2.pointOf(w2.LAYERS.find((l) => l.key === 'street'), null).sn, 0);
  w2.feed('/api/protests/99', { id: 99, issue: 'abortion', meter: -20, left_count: 3, right_count: 1 });
  check('...and the city sticks when the meter finally arrives', w2.data.protests['99'].city, 'newyork');
  near('...as does the reading', w2.pointOf(w2.LAYERS.find((l) => l.key === 'street'), 'newyork').s, -0.6);
}

// ---------------------------------------------------------------------------
console.log('\n— ingest: the media, the walls, the map —');
{
  const w = mk();
  w.feed('/api/home/media-campaigns', [
    { corporation_id: 3, corporation_name: 'Dead Letter Media', city_name: 'New York', issue: 'Immigration', alignment: 3, fans: 90_000 },
    { corporation_id: 4, corporation_name: 'Beacon', city_name: 'New York', issue: 'Immigration', alignment: -3, fans: 10_000 },
    { corporation_id: 5, corporation_name: 'Ledger', city_name: 'Austin', issue: 'Taxes', alignment: -2, fans: 1_000 },
  ]);
  const media = w.LAYERS.find((l) => l.key === 'media');
  near('reach is the weight', w.pointOf(media, 'newyork').s, (3 * 90 - 3 * 10) / 100);
  check('a city with no campaign on an axis reads null there', w.pointOf(media, 'austin').s, null);
  near('...and the world is every campaign at once', w.pointOf(media, null).e, -2);

  // A campaign list is a snapshot of what is running. Re-reading the home page must
  // not stack a second copy of the same campaigns on top of the first.
  w.feed('/api/home/media-campaigns', [
    { corporation_id: 3, corporation_name: 'Dead Letter Media', city_name: 'New York', issue: 'Immigration', alignment: 3, fans: 90_000 },
  ]);
  check('a re-read replaces the covered city rather than doubling it',
    w.data.campaigns.filter((c) => c.city === 'newyork').length, 1);
  check('...and leaves cities the response did not mention alone',
    w.data.campaigns.filter((c) => c.city === 'austin').length, 1);

  w.feed('/api/user/status', { username: 'you', current_location_id: 2, current_location: { name: 'New York' } });
  w.feed('/api/actions/graffiti', {
    city_name: 'New York',
    locations: [
      { key: 'a', name: 'Rail Yard', left_count: 10, right_count: 2 },
      { key: 'b', name: 'Overpass', left_count: 5, right_count: 3 },
    ],
  });
  check('walls are summed for the city they are in', [w.data.walls.newyork.left, w.data.walls.newyork.right], [15, 5]);
  check('...and counted', w.data.walls.newyork.n, 2);

  w.feed('/api/protests/state-dominance', [
    { state_fips: 6, dominant_side: 'left', dominance_score: 40, active_protests: 2, total_count: 900, is_contested: false },
    { state_fips: '36', dominant_side: 'right', dominance_score: 80, active_protests: 1, total_count: 120, is_contested: true },
  ]);
  check('a numeric FIPS is padded to the two-digit form the map uses',
    Object.keys(w.data.dom).sort(), ['06', '36']);
  check('contested survives', w.data.dom['36'].contested, true);
}

// ---------------------------------------------------------------------------
console.log('\n— ingest: the citizens —');
{
  const w = mk();
  const profile = (username, s, e, extra) => ({
    username, alignment: { social_axis: s, social_count: 12, economic_axis: e, economic_count: 7 }, ...extra,
  });
  w.feed('/api/users/alix', profile('alix', 1.5, -2));
  w.feed('/api/users/brann', profile('brann', -0.5, 0));
  const cit = w.LAYERS.find((l) => l.key === 'people');
  check('two profiles, two citizens', w.pointOf(cit, null).sn, 2);
  near('...averaged on the social axis', w.pointOf(cit, null).s, 0.5);
  near('...and the economic one', w.pointOf(cit, null).e, -1);

  w.feed('/api/users/alix', profile('alix', 3, -2));
  check('re-opening a profile updates rather than double-counts', w.pointOf(cit, null).sn, 2);
  near('...with the newer reading', w.pointOf(cit, null).s, 1.25);

  check('a response with no alignment is not a citizen',
    (w.feed('/api/users/carra', { username: 'carra', alignment: null }), w.pointOf(cit, null).sn), 2);
  check('...and neither is one with a half-filled alignment',
    (w.feed('/api/users/dov', { username: 'dov', alignment: { social_axis: 1 } }), w.pointOf(cit, null).sn), 2);

  // Location is sealed behind the Privacy Rights policy today. The tool must handle
  // both worlds: no city now, a city the moment the server sends one.
  check('an unplaced citizen counts for the world', w.peopleRows(null).length, 2);
  check('...and for no city', w.peopleRows('newyork').length, 0);
  w.feed('/api/locations', LOCS);
  w.feed('/api/users/erran', profile('erran', 2, 2, { location: 'New York' }));
  check('a placed citizen counts for their city', w.peopleRows('newyork').length, 1);
  check('...and still for the world', w.peopleRows(null).length, 3);
}

// ---------------------------------------------------------------------------
console.log('\n— the panel\'s own bookkeeping —');
{
  const w = mk();
  w.feed('/api/users/alix', { username: 'alix', alignment: { social_axis: 1, social_count: 2, economic_axis: 1, economic_count: 2 } });
  w.feed('/api/protests/44', { id: 44, issue: 'drugs', meter: 5, left_count: 1, right_count: 1 });
  check('a profile path collapses to one row in the source table',
    Object.keys(w.data.seen).includes('/api/users/{id}'), true);
  check('...as does a protest id', Object.keys(w.data.seen).includes('/api/protests/{id}'), true);
  check('the session name is learned from the status poll',
    (w.feed('/api/user/status', { username: 'you', current_location_id: 2 }), w.data.self), 'you');

  // Freshness is per layer: the law can be an hour old while the street is a minute old,
  // and one panel-wide "last updated" would hide exactly that.
  const law = w.freshOf(w.LAYERS.find((l) => l.key === 'state'), null);
  const street = w.freshOf(w.LAYERS.find((l) => l.key === 'street'), null);
  check('a layer with no reading has no age', law, null);
  check('...and one with a reading does', typeof street, 'number');
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
