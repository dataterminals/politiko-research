// A fence and a behaviour test around tools/read-stores.js.
//
// The reader is the consumer of the collector's bundle: it turns three megabytes of JSON
// into a brief that can be read at the top of a conversation. Two things it has to hold.
//
//   It originates nothing. It is a file reader that writes markdown; there is no reason
//   for a network API, a browser API or a child process to appear in it, and this test is
//   why one does not.
//
//   It never dies on a shape. Every section is guarded, so a store that changed shape in
//   a later tool version costs one section, not the brief. It is run here against a
//   synthetic bundle that covers every section, against a prior for the comparison
//   section, and against an empty bundle.
//
// Run: node userscripts/tools/test-read-stores.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', '..', 'tools', 'read-stores.js');
const SRC = fs.readFileSync(FILE, 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        ${detail}`); fail++; }
};
const absent = (label, re) => {
  const hits = CODE.match(re) || [];
  check(label, hits.length === 0, `found: ${hits.slice(0, 4).join(' | ')}`);
};

console.log('\n— it originates nothing —');
absent('it never fetches', /(?<![.\w])fetch\s*\(/g);
absent('it never constructs an XHR or a socket', /XMLHttpRequest|new\s+WebSocket|EventSource/g);
absent('it requires no network or process module', /require\(\s*['"`](http|https|net|dns|tls|child_process|dgram|worker_threads)['"`]\s*\)/g);
absent('it never imports at runtime', /\bimport\s*\(/g);
absent('it never touches a browser', /localStorage|document\.|window\./g);
check('it writes one file, only when asked',
  (CODE.match(/writeFileSync/g) || []).length === 1 && /if \(o\.out\) fs\.writeFileSync/.test(CODE),
  'expected exactly one writeFileSync, guarded by --out');

console.log('\n— it runs —');
const { brief, fromGs, parseGameMonth, collapse } = require(FILE);

check('game-second arithmetic matches time-watch',
  fromGs(0).label === 'January 1, Y1 00:00' && fromGs(31536000 * 7 + 2592000 * 8 + 86400 * 10 + 3600 * 14 + 60 * 23).label === 'September 11, Y8 14:23',
  `${fromGs(0).label} / ${fromGs(31536000 * 7 + 2592000 * 8 + 86400 * 10 + 3600 * 14 + 60 * 23).label}`);
check('a game month label parses to the first of that month',
  parseGameMonth('November Y16') === 15 * 31536000 + 10 * 2592000 && parseGameMonth('nonsense') === null,
  `${parseGameMonth('November Y16')}`);
check('endpoint ids collapse',
  collapse('/combat/050a0348-1faa-4fb0-bed9-08aa92b91d6f/action') === '/combat/{id}/action'
    && collapse('actions/sleeper-recruitment/canvass/#584') === 'actions/sleeper-recruitment/canvass/#N'
    && collapse('/actions/sleeper-recruitment/1144/meet') === '/actions/sleeper-recruitment/{id}/meet',
  `${collapse('/combat/050a0348-1faa-4fb0-bed9-08aa92b91d6f/action')} ${collapse('/actions/sleeper-recruitment/1144/meet')}`);

const NOW = Date.parse('2026-09-11T20:16:04.339Z');
const T = (h) => NOW - h * 3600e3;
const mk = (over) => ({
  collected_at: new Date(NOW).toISOString(),
  collector: 'tools/collect-stores.js',
  stats: { keys_read: 10, keys_skipped: 4, bytes_raw: 1000, unparsed: 0 },
  redactions: [],
  tools: {
    'pktw:': { tool: 'time-watch', keys: { samples: { first: { t: T(700), gs: 292096440, accel: 52.142857 }, recent: [{ t: T(0.01), gs: 450175560, accel: 52.142857 }] } } },
    'pkpl:': { tool: 'poll-watch', keys: { data: { clock: { t: T(0.01), gs: 450175560, accel: 52.142857 }, issues: ['Abortion', 'Taxes'], polls: [{ t: T(1), gs: 450100000, issue: 'Abortion', method: 'focus_group', mood: 'apathetic', volatility: 'stable', salience: 'quiet', best: 'Neutral voters', angle: 'Pragmatic appeals.', cooldown: '2026-09-11T20:11:06Z', fine: { far_left: 0, center_left: 0, slight_left: 0, neutral: 82, slight_right: 16, center_right: 0, far_right: 0 } }] } } },
    'pkmw:': { tool: 'market-watch', keys: { hist: { 'user/money::balance': [[T(3), 150000], [T(0.1), 154054]], 'user/progression/net_worth::value': [[T(0.1), 200000]], 'factions/mine::treasury': [[T(0.5), 999]], 'property/mine::count': [[T(0.5), 2]], 'attributes::CurrentValue': [[T(0.1), 153]] }, rules: [], ids: {} } },
    'pksw:': { tool: 'sleeper-watch', keys: {
      meta: { faction_name: 'Sneedcorp Conglomerate', location_name: 'San Francisco', window_minutes: 60, recruited_count: 2, sleeper_cap: 12, energy_cost: 6, issues: ['Abortion', 'Taxes', 'Elections'], sites: 18, polledAt: T(0.1), factionId: '16', facPolledAt: T(0.1) },
      sleepers: { 981: { id: '981', display_name: 'Riley Klein', archetype_name: 'Bartender', site_name: 'Club', issue: 'Abortion', effectiveness: 43, recruited_at: '2026-08-27T03:28:56Z', recruiter_username: 'dataterminals', mine: true, lastSeen: T(90), can_advocate_at: '2026-09-07T12:57:12Z', can_embezzle_at: null }, 944: { id: '944', display_name: 'Sam Other', archetype_name: 'Clerk', site_name: 'City Hall', issue: 'Taxes', effectiveness: 30, recruited_at: '2026-08-20T00:00:00Z', recruiter_username: 'someone_else', can_advocate_at: '2026-09-12T12:00:00Z', can_embezzle_at: '2026-09-01T00:00:00Z', factionId: '16', facSeen: T(90) } },
      leads: { 957: { id: '957', display_name: 'Jordan Foster', archetype_name: 'Journalist', site_name: 'City Hall', issue: "Women's Rights", status: 'meeting', next_meeting_at: '2026-08-25T02:51:50Z', meeting_count: 0, gone: true, goneState: 'missed' }, 1144: { id: '1144', display_name: 'Jamie Price', archetype_name: 'Aide', site_name: 'Capitol', issue: 'Elections', status: 'meeting', next_meeting_at: '2026-09-11T21:00:00Z', expires_at: '2026-09-11T22:00:00Z', meeting_count: 0, gone: false } },
      ledger: [{ kind: 'meet', at: T(0.2), leadId: '1144', name: 'Jamie Price', leadIssue: 'Elections', chosenIssue: 'Elections', outcome: 'scheduled' }],
    } },
    'pkgw:': { tool: 'gov-watch', keys: { data: {
      self: 'dataterminals', cycle: '173', reform: 3, roll: { t0: T(90), t1: T(16), from: '168', to: '173' }, next: { cong: 'November Y16', pres: 'November Y16' },
      pres: { name: 'President Bechtelar', a: 0, fav: 10, term: 11 },
      house: [{ a: -3, n: 2 }, { a: -1, n: 56 }, { a: 0, n: 106 }, { a: 3, n: 182 }], senate: [{ a: -1, n: 12 }, { a: 0, n: 26 }, { a: 3, n: 35 }],
      court: [{ id: '2', name: 'Justice Whitmore', a: -3 }],
      now: { 'policy:Tax Structure': { v: 3, t: T(16), since: T(300) }, 'policy:Abortion Rights': { v: 0, t: T(16), since: T(300) }, 'mem:35': { chamber: 'house', seat: 35, a: 3 } },
      desc: { 'Tax Structure': 'The only tax is a poverty tax.' },
      events: [{ kind: 'policy', key: 'Tax Structure', from: 2, to: 3, t0: T(200), t1: T(150) }, { kind: 'member', key: 'Senate 88', from: 1, to: 3, t0: T(90), t1: T(16) }],
      members: { 1: { chamber: 'house', seat: 1, a: 0, inc: false, t: T(16) }, 2: { chamber: 'house', seat: 2, a: 3, inc: true, t: T(16) } },
      jobs: { 2064: { policy: 'Gun Control', dir: 'right', status: 'resolved', cycle: '117', outcome: 'vote_pressured', t: T(16) } },
    } } },
    'pkww:': { tool: 'world-watch', keys: { data: {
      self: 'dataterminals', loc: 1, locName: 'San Francisco',
      gov: { t: T(16), policies: [['taxes', 3]], nextC: 'November Y16', nextP: 'November Y16', president: { name: 'President Bechtelar' } },
      polls: { abortion: { t: T(1), mean: 0.163, exact: true, method: 'focus_group', mood: 'apathetic / persuadable', salience: 'quiet', volatility: 'stable' } },
      protests: {}, campaigns: [], dom: {}, walls: { sanfrancisco: { t: T(200), left: 0, right: 25, n: 3 } },
      people: { dataterminals: { t: T(0.1), s: -0.011, sc: 5134, e: 0.172, ec: 842, city: 'sanfrancisco', npc: false }, Alocrin: { t: T(5), s: 0.4, sc: 10, e: -0.9, ec: 5, city: 'sanfrancisco', npc: false } },
      cities: { sanfrancisco: { name: 'San Francisco', id: 1, key: 'san-francisco', kind: 'city' }, tijuana: { name: 'Tijuana', id: 6, key: 'tijuana', kind: 'overseas' } },
      seen: { '/api/time': T(0.05), '/api/refresh': T(30) },
    } } },
    'pkpw:': { tool: 'people-watch', keys: {
      roster: { total: 1, totalPages: 1, usernames: ['Alocrin', 'Benis'], seenAt: T(25), locationsVisible: true },
      // sightings at 10:00, 11:00 and 12:00 Eastern on three days: quiet from 13:00 round to 10:00
      hours: { Benis: [8, 9, 10].flatMap((d) => [10, 11, 12].map((hr) => [Date.parse(`2026-09-${String(d).padStart(2, '0')}T${String(hr).padStart(2, '0')}:05:00-04:00`), 'last'])), Alocrin: [[Date.parse('2026-09-10T03:00:00-04:00'), 'seen']] },
      people: {
        Alocrin: { username: 'Alocrin', status: 'active', in_city: true, last_online: '2026-07-14T08:04:32Z', is_online: false, created_at: '2026-07-14T03:37:19Z', rank_key: 'deserter', is_npc: false, age: 30, combat: { attacks_won: 0, attacks_lost: 71, mugs_won: 0, times_mugged: 66, money_mugged: 0, money_lost_to_mugs: 11416 }, relationship: { is_friend: false, is_enemy: false, blocked_by_you: false, blocked_by_them: false }, faction_name: null, corp_name: 'F1337', location: 'San Francisco' },
        Benis: { username: 'Benis', status: 'active', in_city: false, last_online: new Date(T(2)).toISOString(), is_online: true, created_at: new Date(T(48)).toISOString(), rank_key: 'boss', is_npc: false, age: 1, combat: { attacks_won: 40, attacks_lost: 3, mugs_won: 12, times_mugged: 0, money_mugged: 50000, money_lost_to_mugs: 0 }, relationship: { is_friend: true, is_enemy: false, blocked_by_you: false, blocked_by_them: false }, faction_name: 'Redefining Reality', corp_name: null, location: 'Austin' },
      },
    } },
    'pkxp:': { tool: 'xp-watch', keys: { ledger: {
      me: 'dataterminals', status: 'ok',
      last: { persuasion: { v: 182.87, t: T(0.1) }, street_sense: { v: 227.5, t: T(0.1) }, heart: { v: 56.26, t: T(0.1) } },
      trainMeta: { heart: 56.26, daily_slots: 1, city_name: 'San Francisco', city_theme: 'West Coast Elite', targets: { heart: { practice_gain: 0.3146, class_gain: 0.4719 } } },
      assessment: { snapshot_date: '2026-09-11', previous_date: '2026-08-10', at: T(0.1), keys: 3, change: { persuasion: 137.04, street_sense: 165.07, heart: 50.65 } },
      eduCourses: { CMT1520: { completed: true, rewards: [{ key: 'computers', amount: 10 }] }, CMT2230: { completed: false, rewards: [{ key: 'law', amount: 5 }] } },
      mastery: { '/disobedience': { v: 70, since: 2523, steps: [{ d: 1, over: 67 }] } },
      actStats: { '/disobedience': { n: 2549, outcomes: { success: 2021, fail: 468, 'success+jailed': 47, 'fail+jailed': 9, 'success+hospitalized': 3, 'fail+hospitalized': 1 }, xp: { persuasion: { sum: 75.5, n: 2187 }, street_sense: { sum: 96.29, n: 2145 } } }, '/combat/050a0348-1faa-4fb0-bed9-08aa92b91d6f/action': { n: 3, outcomes: { success: 3 }, xp: { pistol: { sum: 0.4, n: 3 } } }, '/combat/61472c28-4c0e-4e78-b325-65e46e1cdb95/action': { n: 2, outcomes: { fail: 2 }, xp: {} }, '/actions/sleeper-recruitment/canvass': { n: 40, outcomes: { success: 40 }, xp: { persuasion: { sum: 4, n: 40 } } }, '/terminal/exec': { n: 5, outcomes: {}, xp: {} } },
      events: [{ t: T(30), kind: 'action', ep: '/disobedience', outcome: 'success' }, { t: T(0.5), kind: 'action', ep: '/terminal/exec', outcome: null }, { t: T(0.2), kind: 'action', ep: '/actions/sleeper-recruitment/canvass', outcome: 'success' }],
      deltas: [{ t: T(0.3), key: 'persuasion', d: 0.63, from: 182.24, to: 182.87, attrib: { type: 'ambiguous', n: 35, eps: ['/disobedience', '/actions/poll'] } }],
      sheetIssue: { t: T(1), kind: 'shift', axis: 'social' }, changeVerdict: { at: T(0.1), key: 'shotgun', dCurrent: 0.06, dChange: 0.06, kind: 'running', datesMoved: false },
    }, samples: {} } },
    'pkaw:': { tool: 'align-watch', keys: { data: { self: 'dataterminals', readings: [{ t: T(400), s: -0.05, sc: 100, e: 0.1, ec: 50, url: '/api/users/dataterminals' }, { t: T(0.2), s: -0.011, sc: 5134, e: 0.172, ec: 842, url: '/api/users/dataterminals' }] } } },
    'pksh:': { tool: 'shop-watch', keys: { data: { stores: { 5: { id: '5', name: 'Bay Area Auto', kind: 'shop', city: 'San Francisco', readings: [{ t: T(300), items: { 181: { name: 'Sedan', stock: 49, price: 1500, cat: 'vehicle' } } }, { t: T(17), items: { 181: { name: 'Sedan', stock: 47, price: 1500, cat: 'vehicle' } } }] } }, events: [], fields: {}, envelope: {}, seen: {}, readAt: T(17) } } },
    'pkqj:': { tool: 'quick-jump', keys: { places: { corps: { 1: { id: '1', name: 'Blackfin', type: 'financial', location_name: 'San Francisco', is_active: true, seenAt: T(100) } }, casinos: { 30: { operational: true, wagering_suspended: false, current_city_access: true, venues: [{ property_id: 66, location_name: 'San Francisco' }], games: [{ key: 'blackjack', status: 'live' }], seenAt: T(100) } }, factions: {} }, recent: [] } },
    'pkbj:': { tool: 'jack-watch', keys: { data: { corps: { 30: { cfg: {}, hands: [{}, {}, {}] } }, edge: { key: 'd6s17das1split', edge: 0.004593, deals: 550, at: T(160) } } } },
    'pksl:': { tool: 'slot-watch', keys: { data: { corps: { 30: { cfg: {}, sessions: [{}] } } } } },
    'pkrw:': { tool: 'raid-watch', keys: { raids: {}, reports: {}, events: { 11: { id: '11', raid_id: '2', event_type: 'leave', actor_username: 'John_Sneed', target_username: 'Benis', score_delta: 29, power_delta: -10, created_at: '2026-08-15T19:26:53Z', seenAt: T(400) } } } },
    'pkws:': { tool: 'ws-watch', keys: { census: { v: 1, startedAt: T(800), observedMs: 3600e3 * 200, frames: 257598, connects: 299, types: { chat: { presence: { n: 16850 }, message: { n: 445 } }, market: { quote: { n: 100 }, candle_update: { n: 50 } } }, presenceTotal: 12, clockType: 'quote.game_time' } } },
    'pkbw:': { tool: 'bar-watch', keys: { ui: { open: false } } },
  },
  ...over,
});

const bundle = mk({});
const prior = mk({ collected_at: new Date(T(24)).toISOString() });
prior.tools['pkmw:'].keys.hist['user/money::balance'] = [[T(30), 120000]];
prior.tools['pkxp:'].keys.ledger.last = { persuasion: { v: 180, t: T(30) }, street_sense: { v: 227.5, t: T(30) }, heart: { v: 50, t: T(30) } };
prior.tools['pkgw:'].keys.data.now['policy:Tax Structure'] = { v: 2, t: T(40), since: T(300) };
prior.tools['pkgw:'].keys.data.cycle = '168';
prior.tools['pkpw:'].keys.people = { Alocrin: { ...bundle.tools['pkpw:'].keys.people.Alocrin, location: 'Austin' } };
prior.tools['pksw:'].keys.sleepers = { 981: bundle.tools['pksw:'].keys.sleepers[981] };
prior.tools['pksw:'].keys.meta = { ...bundle.tools['pksw:'].keys.meta, recruited_count: 1 };

let md = '', err = null;
try { md = brief(bundle, prior); } catch (e) { err = e; }
check('a full synthetic bundle produces a brief', !err && md.length > 2000, err ? String(err.stack) : `length ${md.length}`);
// DUMP=<file> writes the synthetic brief out, so a failing expectation can be read against
// the line it was written for instead of reconstructed by hand.
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, md);

const has = (label, re) => check(label, re.test(md), `not found: ${re}`);
console.log('\n— the brief carries every section —');
for (const s of ['Clock', 'Levers', 'Government', 'Opinion', 'World', 'People', 'Hours', 'You', 'Faction and sleepers', 'Economy', 'Wire', 'Since the bundle of', 'Freshness per tool', 'What this bundle does not know']) has(`## ${s}`, new RegExp(`^## ${s}`, 'm'));
has('hours fold sightings onto Eastern time with a quiet stretch that wraps midnight', /\| Benis \| Redefining Reality \| ··········███··········· \| 9 \| 3 \| 13:00–10:00 \(21 h\) \|/);
has('...and too few sightings say so', /\| Alocrin \| [^|]* \| [·▁-█]{24} \| 1 \| 1 \| too few \|/);
check('no section fell back to its guard', !/could not be read/.test(md), (md.match(/_.*could not be read.*_/g) || []).join('\n'));

console.log('\n— and says the right things —');
has('game time is derived from the sample', /Game time at collection: \*\*[A-Z][a-z]+ \d+, Y\d+ \d\d:\d\d\*\*/);
has('the election is placed on the real calendar', /\| congressional election \| November Y16 \| 20\d\d-\d\d-\d\d \d\d:\d\dZ \|/);
has('the registration windows are listed', /registration window opens \| (January|September) 1, Y\d+/);
has('money is a lever', /\| money \| \$154,054 \|/);
has('the sleeper who can advocate is named, and the next one dated', /sleepers able to advocate \| 1 of 2 \| Riley Klein \(Abortion\); next Sam Other in/);
has('embezzle readiness is counted', /sleepers able to embezzle \| 1 of 2 \| Sam Other/);
has('the poll cooldown is read against collection time', /\| opinion poll \| available \|/);
has('chambers are summarised with a lean, in the game\'s words', /\| house \| mean a=1\.4\d \(Moderate Right\) \| 346 seats: left \(a<0\) 58 \(17%\), centre 106, right \(a>0\) 182 \(53%\)/);
has('the president gets the same words', /\| president \| President Bechtelar \(a=0, Moderate\) \|/);
has('unpolled issues are named', /never polled: Taxes, Elections/);
has('players in your city exclude you', /\| players in your city \| 1 \|/);
has('policies table reads the description', /\| Tax Structure \| 3 \| .* \| The only tax is a poverty tax\. \|/);
has('recent policy changes are listed', /\| Tax Structure \| 2 \| 3 \|/);
has('faction jobs are listed', /\| 2064 \| Gun Control \| right \| resolved \| 117 \| vote_pressured \|/);
has('opinion has the fine distribution', /\| abortion \| 0 \| 0 \| 0 \| 82 \| 16 \| 0 \| 0 \| Neutral voters \|/);
has('graffiti walls are read', /\| sanfrancisco \| 0 \| 25 \| 3 \|/);
has('endpoints seen are read as last-seen stamps, newest first', /Endpoints world-watch has seen the app call: 2; most recent \/api\/time \(3 min ago\), \/api\/refresh \(30\.0 h ago\)/);
has('activity buckets count', /\| < 1 d \| 1 \|[\s\S]*\| 30 d \+ \| 1 \|/);
has('new accounts are found', /### New accounts \(14 d\)[\s\S]*\| Benis \|/);
has('relationships are listed', /\| Benis \| yes \|  \|  \|  \|/);
has('fighters are ranked', /### Most active fighters[\s\S]*\| Benis \| 40 \| 3 \| 12 \| 0 \| 50,000 \|/);
has('your city lists the neighbours', /### In San Francisco[\s\S]*\| Alocrin \| deserter \|/);
has('alignment quadrants are counted', /\| social \+ \/ economic − \| 1 \|/);
has('skills table has the 30-day delta and the city gains', /\| heart \| 56\.26 \| \+50\.65 \| 0\.315 \| 0\.472 \|/);
has('actions collapse ids and sum outcomes', /\| \/combat\/\{id\}\/action \| 5 \| 60% \| 0 \| 0 \|/);
has('disobedience success rate and jail count', /\| \/disobedience \| 2,549 \| 81% \| 56 \| 4 \| street_sense 0\.038, persuasion 0\.030/);
has('an action with no recorded outcome is n/a, not 0%', /\| \/terminal\/exec \| 5 \| n\/a \| 0 \| 0 \|/);
has('education lists open courses with rewards', /\| CMT2230 \| law \+5 \|/);
has('sleepers table', /\| Riley Klein \| Bartender \| Club \| Abortion \| 43 \| yes \|/);
has('open leads exclude the gone', /### Open leads[\s\S]*\| Jamie Price \|/);
check('...and gone leads are counted, not listed', !/\| Jordan Foster \|/.test(md) && /1 gone \(missed 1\)/.test(md), 'a gone lead was listed or not counted');
has('shop stock movement is differenced', /\| Bay Area Auto \| San Francisco \| shop \| 2 \| .* \| 1 \| Sedan 49→47 \|/);
has('blackjack edge is stated', /house edge 0\.459% over 550 deals; 3 hands in the ledger/);
has('wire census is one line', /257,598 frames over 299 connections/);
has('the comparison finds the money change', /\| money \| \$120,000 → \$154,054 \| \+34,054 \|/);
has('...the skills that moved', /\| skills moved \| 2 \| heart \+6\.26, persuasion \+2\.87 \|/);
has('...the policy that changed', /\| policies changed \| 1 \| Tax Structure 2→3 \|/);
has('...the cycle roll', /\| cycle \| 168 → 173 \|/);
has('...the new player and the one who moved', /\| people \| \+1 new, 1 moved city \| Benis; Alocrin Austin→San Francisco \|/);
has('...and the sleeper recruited since', /\| sleepers recruited \| 1 → 2 \|/);
has('freshness ignores scheduled future dates', /\| sleeper-watch \| [a-z, ]+ \| 2026-09-11 20:1\dZ \|/);
has('bar-watch is settings only', /\| bar-watch \| \(settings only\) \|/);
has('gaps name what was never observed', /- no protest has been observed[\s\S]*- no raid has been observed[\s\S]*- no restock bracket/);
has('...and what nothing captures', /No store carries: inventory/);

console.log('\n— and an empty bundle still produces one —');
let md0 = '', err0 = null;
try { md0 = brief({ collected_at: new Date(NOW).toISOString(), tools: {} }, null); } catch (e) { err0 = e; }
check('an empty bundle does not throw', !err0 && /## Clock/.test(md0) && /No prior bundle/.test(md0), err0 ? String(err0.stack) : 'missing sections');
check('...and says so in every section', (md0.match(/_no /g) || []).length >= 6, `${(md0.match(/_no /g) || []).length} empty-section notes`);

let mdN = '', errN = null;
try { mdN = brief(bundle, null); } catch (e) { errN = e; }
check('no prior means no comparison section', !errN && !/## Since the bundle/.test(mdN) && /No prior bundle to compare with/.test(mdN), errN ? String(errN.stack) : 'comparison section present without a prior');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
