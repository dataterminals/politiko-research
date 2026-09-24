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
const { brief, fromGs, gameDay, realOf, pollMean, parseGameMonth, collapse } = require(FILE);

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
// The game second a Herald entry needs to carry to have been printed h hours before
// collection, read against the one time-watch sample the fixture holds. Writing the
// fixture this way round is itself the fence: if the reader's conversion drifts, an
// entry lands in the wrong poll window and the join below stops matching.
const GS = (h) => Math.round(450175560 + ((T(h) - T(0.01)) / 1000) * 52.142857);
const mk = (over) => ({
  collected_at: new Date(NOW).toISOString(),
  collector: 'tools/collect-stores.js',
  stats: { keys_read: 10, keys_skipped: 4, bytes_raw: 1000, unparsed: 0 },
  redactions: [],
  tools: {
    'pktw:': { tool: 'time-watch', keys: { samples: { first: { t: T(700), gs: 292096440, accel: 52.142857 }, recent: [{ t: T(0.01), gs: 450175560, accel: 52.142857 }] } } },
    // Three pairs, for the Herald join. Abortion moves across a window holding two
    // conservative World entries and no disobedience of ours — the shape the section
    // exists to surface. Taxes moves across a burst that starts before the event ledger
    // does, so its count is a floor. Pollution is the deterministic repeat (docs/21: an
    // untouched issue comes back identical), and opens before the ledger with nothing in
    // it. Every cooldown stays in the past so the Levers row still reads "available".
    'pkpl:': { tool: 'poll-watch', keys: { data: { clock: { t: T(0.01), gs: 450175560, accel: 52.142857 }, issues: ['Abortion', 'Taxes'], polls: [
      { t: T(36), issue: 'Taxes', method: 'focus_group', mood: 'apathetic', volatility: 'stable', salience: 'warm', best: 'Neutral voters', angle: 'Pragmatic appeals.', cooldown: '2026-09-10T09:00:00Z', fine: { far_left: 0, center_left: 0, slight_left: 0, neutral: 60, slight_right: 38, center_right: 0, far_right: 0 } },
      { t: T(34), issue: 'Pollution', method: 'focus_group', mood: 'apathetic', volatility: 'stable', salience: 'boiling', best: 'Neutral voters', angle: 'Pragmatic appeals.', cooldown: '2026-09-10T11:00:00Z', fine: { far_left: 0, center_left: 2, slight_left: 0, neutral: 73, slight_right: 23, center_right: 0, far_right: 0 } },
      { t: T(31), issue: 'Pollution', method: 'focus_group', mood: 'apathetic', volatility: 'stable', salience: 'boiling', best: 'Neutral voters', angle: 'Pragmatic appeals.', cooldown: '2026-09-10T14:00:00Z', fine: { far_left: 0, center_left: 2, slight_left: 0, neutral: 73, slight_right: 23, center_right: 0, far_right: 0 } },
      { t: T(12), issue: 'Taxes', method: 'focus_group', mood: 'apathetic', volatility: 'moderate', salience: 'warm', best: 'Neutral voters', angle: 'Pragmatic appeals.', cooldown: '2026-09-11T09:00:00Z', fine: { far_left: 0, center_left: 0, slight_left: 0, neutral: 70, slight_right: 28, center_right: 0, far_right: 0 } },
      { t: T(6), issue: 'Abortion', method: 'focus_group', mood: 'apathetic', volatility: 'stable', salience: 'quiet', best: 'Neutral voters', angle: 'Pragmatic appeals.', cooldown: '2026-09-11T15:00:00Z', fine: { far_left: 0, center_left: 0, slight_left: 0, neutral: 90, slight_right: 8, center_right: 0, far_right: 0 } },
      { t: T(1), gs: 450100000, issue: 'Abortion', method: 'focus_group', mood: 'apathetic', volatility: 'stable', salience: 'quiet', best: 'Neutral voters', angle: 'Pragmatic appeals.', cooldown: '2026-09-11T20:11:06Z', fine: { far_left: 0, center_left: 0, slight_left: 0, neutral: 82, slight_right: 16, center_right: 0, far_right: 0 } },
    ] } } },
    'pkmw:': { tool: 'market-watch', keys: { hist: { 'user/money::balance': [[T(3), 150000], [T(0.1), 154054]], 'user/progression/net_worth::value': [[T(0.1), 200000]], 'factions/mine::treasury': [[T(0.5), 999]], 'property/mine::count': [[T(0.5), 2]], 'attributes::CurrentValue': [[T(0.1), 153]] }, rules: [], ids: {} } },
    'pksw:': { tool: 'sleeper-watch', keys: {
      meta: { faction_name: 'Sneedcorp Conglomerate', location_name: 'San Francisco', window_minutes: 60, recruited_count: 2, sleeper_cap: 12, energy_cost: 6, issues: ['Abortion', 'Taxes', 'Elections'], sites: 18, polledAt: T(0.1), factionId: '16', facPolledAt: T(0.1) },
      sleepers: { 981: { id: '981', display_name: 'Riley Klein', archetype_name: 'Bartender', site_name: 'Club', issue: 'Abortion', effectiveness: 43, recruited_at: '2026-08-27T03:28:56Z', recruiter_username: 'dataterminals', mine: true, lastSeen: T(90), can_advocate_at: '2026-09-07T12:57:12Z', can_embezzle_at: null }, 944: { id: '944', display_name: 'Sam Other', archetype_name: 'Clerk', site_name: 'City Hall', issue: 'Taxes', effectiveness: 30, recruited_at: '2026-08-20T00:00:00Z', recruiter_username: 'someone_else', can_advocate_at: '2026-09-12T12:00:00Z', can_embezzle_at: '2026-09-01T00:00:00Z', factionId: '16', facSeen: T(90) } },
      leads: { 957: { id: '957', display_name: 'Jordan Foster', archetype_name: 'Journalist', site_name: 'City Hall', issue: "Women's Rights", status: 'meeting', next_meeting_at: '2026-08-25T02:51:50Z', meeting_count: 0, gone: true, goneState: 'missed' }, 1144: { id: '1144', display_name: 'Jamie Price', archetype_name: 'Aide', site_name: 'Capitol', issue: 'Elections', status: 'meeting', next_meeting_at: '2026-09-11T21:00:00Z', expires_at: '2026-09-11T22:00:00Z', meeting_count: 0, gone: false },
        // Expired while still listed: `gone` is false and the lead is dead. sleeper-watch
        // drops a lead only when a poll comes back without it.
        1187: { id: '1187', display_name: 'Quinn Hayes', archetype_name: 'Court Clerk', site_name: 'Police Station', issue: 'Elections', status: 'meeting', next_meeting_at: '2026-09-09T22:28:04Z', expires_at: '2026-09-09T23:28:04Z', meeting_count: 0, gone: false, announcedMissed: true } },
      ledger: [{ kind: 'meet', at: T(0.2), leadId: '1144', name: 'Jamie Price', leadIssue: 'Elections', chosenIssue: 'Elections', outcome: 'scheduled' }],
    } },
    'pkgw:': { tool: 'gov-watch', keys: { data: {
      self: 'dataterminals', cycle: '173', reform: 3, roll: { t0: T(90), t1: T(16), from: '168', to: '173' }, next: { cong: 'November Y16', pres: 'November Y16' },
      pres: { name: 'President Bechtelar', a: 0, fav: 10, term: 11 },
      house: [{ a: -3, n: 2 }, { a: -1, n: 56 }, { a: 0, n: 106 }, { a: 3, n: 182 }], senate: [{ a: -1, n: 12 }, { a: 0, n: 26 }, { a: 3, n: 35 }],
      court: [{ id: '2', name: 'Justice Whitmore', a: -3 }],
      now: { 'policy:Tax Structure': { v: 3, t: T(16), since: T(300) }, 'policy:Abortion Rights': { v: 0, t: T(16), since: T(300) }, 'mem:35': { chamber: 'house', seat: 35, a: 3 } },
      desc: { 'Tax Structure': 'The only tax is a poverty tax.' },
      events: [{ kind: 'policy', key: 'Tax Structure', from: 2, to: 3, t0: T(200), t1: T(150) }, { kind: 'member', key: 'Senate 88', from: 1, to: 3, t0: T(90), t1: T(16) },
        // the 2026-09-12 shape: Corporate Law moves in a window that overlaps Upton's arrival,
        // and Election Reform goes out and back in the same stretch
        { kind: 'policy', key: 'Corporate Law', from: 0, to: -1, t0: T(26), t1: T(23) },
        { kind: 'reform', key: 'Election Reform', from: 3, to: 2, t0: T(24.5), t1: T(24.4) }, { kind: 'reform', key: 'Election Reform', from: 2, to: 3, t0: T(24.4), t1: T(24.3) },
        { kind: 'court', key: 'Justice Whitmore', from: -2, to: -3, t0: T(24.5), t1: T(24.1) }],
      // gov-watch 0.7.0's Herald record. Headlines and the June 1, Y15 date are the ones seen
      // on 2026-09-12; every body is invented for the test.
      bills: {
        860: { gametime: 454464000, category: 'Supreme Court', headline: 'United States v. Farrell, Corp.', from: null, to: null, hy: null, hn: null, sy: null, sn: null, outcome: null, body: null, cut: null, spin: null, firstSeen: T(80), lastSeen: T(1) },
        861: { gametime: 454464000, category: 'Supreme Court', headline: 'United States v. Upton', from: null, to: null, hy: null, hn: null, sy: null, sn: null, outcome: null, body: `TEST FIXTURE | not the real ruling.\n\nThe Court holds ${'the charter provision void, '.repeat(20)}END-OF-BODY`, cut: 5200, spin: null, firstSeen: T(24), lastSeen: T(1), prior: T(24.02) },
        814: { gametime: 454000000, category: 'Congress', headline: 'Slavery Repeal Act', from: 3, to: 2, hy: 253, hn: 182, sy: 65, sn: 35, outcome: 'signed', body: 'A bill.', firstSeen: T(80), lastSeen: T(1), prior: T(81) },
        815: { gametime: 454000000, category: 'Congress', headline: 'Sedition Expansion Act', from: 2, to: 3, hy: 194, hn: 241, sy: 40, sn: 60, outcome: 'dead in Congress', body: null, proseDropped: true, firstSeen: T(80), lastSeen: T(1), prior: T(81) },
        // A ballot measure and an impeachment: neither a bill in a chamber nor a ruling.
        870: { gametime: 453000000, category: 'Election', headline: 'Protect our Borders Passes by Ballot', from: null, to: null, hy: null, hn: null, sy: null, sn: null, outcome: null, firstSeen: T(70), lastSeen: T(1) },
        871: { gametime: 454200000, category: 'Impeachment', headline: 'President Bechtelar Removed From Office', from: null, to: null, hy: 329, hn: 106, sy: 74, sn: 26, outcome: 'convicted', firstSeen: T(60), lastSeen: T(1) },
        816: { gametime: 454000000, category: 'Congress', headline: 'Still Counting', from: 1, to: 0, hy: 240, hn: 195, sy: 60, sn: 40, outcome: null, body: null, firstSeen: T(2), lastSeen: T(1), prior: T(2.02) },
        // World entries, placed by the real hour they were printed rather than by a raw
        // game second. Tremors sits before every poll and must land in no window at all;
        // MILL CLOSES falls inside the Taxes pair; CLINIC REGRET and LATE TERM inside the
        // Abortion pair, with STATUE GONE beside them in the 0.6.0 shape — a headline and
        // a date, no prose and no spin.
        840: { gametime: GS(40), category: 'World', headline: 'Tremors', body: 'World prose.', spin: 'liberal', firstSeen: T(80), lastSeen: T(1), prior: T(81) },
        880: { gametime: GS(16), category: 'World', headline: 'MILL CLOSES', body: 'World prose.', spin: 'liberal', firstSeen: T(15), lastSeen: T(1), prior: T(16.1) },
        881: { gametime: GS(5), category: 'World', headline: 'CLINIC REGRET', body: 'World prose.', spin: 'conservative', firstSeen: T(4), lastSeen: T(1), prior: T(5.1) },
        882: { gametime: GS(3), category: 'World', headline: 'LATE TERM', body: 'World prose.', spin: 'conservative', firstSeen: T(2), lastSeen: T(1), prior: T(3.1) },
        838: { gametime: GS(4), category: 'World', headline: 'STATUE GONE', firstSeen: T(3), lastSeen: T(1) },
        // 24 minutes before the Abortion pair opens: a window is half-open at its lower
        // edge, and this entry belongs to no poll of Abortion at all.
        879: { gametime: GS(6.4), category: 'World', headline: 'RIVER ON FIRE', body: 'World prose.', spin: 'liberal', firstSeen: T(6), lastSeen: T(1), prior: T(6.5) },
      },
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
      // T(30) is the oldest event the ledger still holds, so a window that opens before it
      // gets a floor. The burst at T(26) sits inside the Taxes pair and outside the last
      // day, and nothing disobedient falls inside the Abortion pair at all.
      events: [{ t: T(30), kind: 'action', ep: '/disobedience', outcome: 'success' },
        ...[26, 25.9, 25.8, 25.7].map((h) => ({ t: T(h), kind: 'action', ep: '/disobedience', outcome: 'success' })),
        { t: T(25.6), kind: 'action', ep: '/disobedience', outcome: 'fail+jailed' },
        // On the stroke of the poll that opens the Abortion pair, and so outside it: the
        // poll reads the public before this action, not after it.
        { t: T(6), kind: 'action', ep: '/disobedience', outcome: 'success' },
        // Events with no endpoint — a status flip and a class. Grouped by `ep` they printed
        // as "undefined".
        { t: T(3), kind: 'status', from: 'active', to: 'jailed' }, { t: T(2.5), kind: 'status', from: 'jailed', to: 'active' },
        { t: T(1.5), kind: 'train', key: 'heart', gain: 0.4718, mode: 'class' },
        { t: T(0.5), kind: 'action', ep: '/terminal/exec', outcome: null }, { t: T(0.2), kind: 'action', ep: '/actions/sleeper-recruitment/canvass', outcome: 'success' }],
      deltas: [{ t: T(1.5), key: 'heart', d: 0.4718, from: 55.79, to: 56.26, attrib: { type: 'train', n: 0 } }, { t: T(0.3), key: 'persuasion', d: 0.63, from: 182.24, to: 182.87, attrib: { type: 'ambiguous', n: 35, eps: ['/disobedience', '/actions/poll'] } }],
      sheetIssue: { t: T(1), kind: 'shift', axis: 'social' }, changeVerdict: { at: T(0.1), key: 'shotgun', dCurrent: 0.06, dChange: 0.06, kind: 'running', datesMoved: false },
    }, samples: {} } },
    'pkaw:': { tool: 'align-watch', keys: { data: { self: 'dataterminals', readings: [{ t: T(400), s: -0.05, sc: 100, e: 0.1, ec: 50, url: '/api/users/dataterminals' }, { t: T(0.2), s: -0.011, sc: 5134, e: 0.172, ec: 842, url: '/api/users/dataterminals' }] } } },
    'pksh:': { tool: 'shop-watch', keys: { data: { stores: { 5: { id: '5', name: 'Bay Area Auto', kind: 'shop', city: 'San Francisco', readings: [{ t: T(300), items: { 181: { name: 'Sedan', stock: 49, price: 1500, cat: 'vehicle' } } }, { t: T(17), items: { 181: { name: 'Sedan', stock: 47, price: 1500, cat: 'vehicle' } } }] } }, events: [], fields: {}, envelope: {}, seen: {}, readAt: T(17) } } },
    'pkqj:': { tool: 'quick-jump', keys: { places: { corps: { 1: { id: '1', name: 'Blackfin', type: 'financial', location_name: 'San Francisco', is_active: true, seenAt: T(100) } }, casinos: { 30: { operational: true, wagering_suspended: false, current_city_access: true, venues: [{ property_id: 66, location_name: 'San Francisco' }], games: [{ key: 'blackjack', status: 'live' }], seenAt: T(100) } }, factions: {} }, recent: [] } },
    'pkbj:': { tool: 'jack-watch', keys: { data: { corps: { 30: { cfg: {}, hands: { 939: { id: 939 }, 940: { id: 940 }, 941: { id: 941 } } } }, edge: { key: 'd6s17das1split', edge: 0.004593, deals: 550, at: T(160) } } } },
    'pksl:': { tool: 'slot-watch', keys: { data: { corps: { 30: { cfg: {}, sessions: { 1647: { id: 1647 }, 1648: { id: 1648 } } } } } } },
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
prior.tools['pkgw:'].keys.data.bills = Object.fromEntries(Object.entries(bundle.tools['pkgw:'].keys.data.bills).filter(([id]) => id !== '861'));
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
for (const s of ['Clock', 'Levers', 'Government', 'Court and the Record', 'Opinion', 'The Herald against the polls', 'World', 'People', 'Hours', 'You', 'Faction and sleepers', 'Economy', 'Wire', 'Since the bundle of', 'Freshness per tool', 'What this bundle does not know']) has(`## ${s}`, new RegExp(`^## ${s}`, 'm'));
has('hours fold sightings onto Eastern time with a quiet stretch that wraps midnight', /\| Benis \| Redefining Reality \| ··········███··········· \| 9 \| 3 \| 13:00–10:00 \(21 h\) \|/);
has('...and too few sightings say so', /\| Alocrin \| [^|]* \| [·▁-█]{24} \| 1 \| 1 \| too few \|/);
check('no section fell back to its guard', !/could not be read/.test(md), (md.match(/_.*could not be read.*_/g) || []).join('\n'));

console.log('\n— and says the right things —');
has('game time is derived from the sample', /Game time at collection: \*\*[A-Z][a-z]+ \d+, Y\d+ \d\d:\d\d\*\*/);
has('the election is placed on the real calendar', /\| congressional election \| November Y16 \| 20\d\d-\d\d-\d\d \d\d:\d\dZ \|/);
has('the registration windows are listed', /registration window opens \| (January|September) 1, Y\d+/);
has('money is a lever', /\| money \| \$154,054 \|/);
has('the sleeper who can advocate is named, and the next one dated', /sleepers able to advocate \| 1 of 2 \| Riley Klein \(Abortion\); next Sam Other in/);
has('embezzle readiness is counted, and the price is printed beside it',
  /sleepers able to embezzle \| 1 of 2 \| Sam Other · pays cash out of that sleeper's own effectiveness/);
has('the poll cooldown is read against collection time', /\| opinion poll \| available \|/);
has('chambers are summarised with a lean, in the game\'s words', /\| house \| mean a=1\.4\d \(Moderate Right\) \| 346 seats: left \(a<0\) 58 \(17%\), centre 106, right \(a>0\) 182 \(53%\)/);
has('the president gets the same words', /\| president \| President Bechtelar \(a=0, Moderate\) \|/);
has('unpolled issues are named', /never polled: Taxes, Elections/);
has('players in your city exclude you', /\| players in your city \| 1 \|/);
has('policies table reads the description', /\| Tax Structure \| 3 \| .* \| The only tax is a poverty tax\. \|/);
has('recent policy changes are listed', /\| Tax Structure \| 2 \| 3 \|/);
has('faction jobs are listed', /\| 2064 \| Gun Control \| right \| resolved \| 117 \| vote_pressured \|/);
console.log('\n— court rulings, and what was observed beside them —');
{
  const sec = (md.split(/^## Court and the Record$/m)[1] || '').split(/^## /m)[0];
  const hasC = (label, re) => check(label, re.test(sec), `not found: ${re}\n${sec.slice(0, 1600)}`);
  hasC('entries are counted by category, with the prose held', /13 Herald entries kept \(World 6, Congress 3, Supreme Court 2, Impeachment 1, Election 1\); [\d,]+ chars of prose held on 7, 1 dropped for the budget\./);
  hasC('decided bills are split toward vs away from the centre', /\| toward the centre \| 1 \| 1 \| 100% \| 1 \|[\s\S]*\| away from the centre \| 1 \| 0 \| 0% \| 0 \|/);
  check('...and pending is not counted as a loss', !/\| toward the centre \| 2 \|/.test(sec), 'a pending bill was counted as decided');
  hasC('the Congressional Record opens with a count by outcome, pending first', /^### Congressional Record\n\n3 Congress bills: pending 1, signed 1, dead in Congress 1\.$/m);
  hasC('...calls the tally printed raw, not the deciding number, not a margin', /\*\*printed raw\*\*[^\n]*not the deciding number and is not a margin/);
  check('...and no column or line calls it a margin', !/\| [^|\n]*margin[^|\n]* \|/i.test(sec) && !/^- [^\n]*margin/im.test(sec), 'something is labelled a margin');
  hasC('...lists every bill with both tallies and its fate, null as pending',
    /\| game date \| bill \| axis \| House \| Senate \| outcome \|\n\|---\|---\|---\|---\|---\|---\|\n\| May 25, Y15 \| Still Counting \| \+1→0 \| 240–195 \| 60–40 \| pending \|\n\| May 25, Y15 \| Slavery Repeal Act \| \+3→\+2 \| 253–182 \| 65–35 \| signed \|\n\| May 25, Y15 \| Sedition Expansion Act \| \+2→\+3 \| 194–241 \| 40–60 \| dead in Congress \|/);
  hasC('ballot measures get one line each, with no tally', /^### Ballot measures\n\n- May 14, Y15 — \*\*Protect our Borders Passes by Ballot\*\*$/m);
  hasC('an impeachment carries its vote and verdict', /^### Impeachment\n\n- May 27, Y15 — \*\*President Bechtelar Removed From Office\*\* · House 329–106, Senate 74–26 \(printed raw\) · convicted$/m);
  hasC('...and all three sit before the rulings', /### Congressional Record[\s\S]*### Ballot measures[\s\S]*### Impeachment[\s\S]*### Supreme Court rulings/);
  hasC('rulings are newest first by the paper\'s date, then first sighting', /\*\*United States v\. Upton\*\*[\s\S]*\*\*United States v\. Farrell, Corp\.\*\*/);
  hasC('the game date uses the Herald arithmetic', /\*\*United States v\. Upton\*\* — June 1, Y15 · appeared between 2026-09-10 20:1\dZ and 2026-09-10 20:1\dZ \(1 min window\)/);
  hasC('a 0.6.0 ruling from the first Herald reading has no lower edge', /\*\*United States v\. Farrell, Corp\.\*\* — June 1, Y15 · already on the front page at gov-watch's first Herald reading[^\n]*no lower edge/);
  hasC('the body is quoted to ~300 chars, flattened and pipe-escaped', /> TEST FIXTURE \\\| not the real ruling\. The Court holds the charter provision void, [^\n]{150,}…/);
  check('...and never in full', !/END-OF-BODY/.test(sec), 'the whole body reached the brief');
  hasC('...with the stored cut disclosed', /stored cut at [\d,]+ of 5,200 chars/);
  hasC('a ruling without text says why', /no text kept \(first seen before gov-watch 0\.7\.0, or none printed\)/);
  hasC('the overlapping move is observed beside Upton', /observed in an overlapping window: Corporate Law 0 → -1, between 2026-09-10 18:1\dZ and 2026-09-10 21:1\dZ \(3\.0 h wide\)/);
  hasC('...a round trip is one line, after the net move', /Corporate Law 0 → -1[^\n]*\n  observed in an overlapping window: Election Reform 3 → 3 \(2 moves\)/);
  check('...and only policy and reform moves are considered', !/Whitmore/.test(sec) && !/Tax Structure/.test(sec), 'a non-policy or far-off event was listed');
  hasC('Farrell, with nothing near it, says so', /no lower edge\n  _no text kept[^\n]*\n  no recorded axis move in an overlapping window \(±30 min\)/);
  hasC('the section states adjacency is not a cause', /_Adjacency only\./);
  check('...and never uses causal language',
    !/\b(because|caused|causes|due to|as a result|moved by|led to|triggered|thanks to|resulted in)\b/i.test(sec.replace(/neither payload says what moved the axis/, '')),
    (sec.match(/\b(because|caused|causes|due to|as a result|moved by|led to|triggered|thanks to|resulted in)\b/gi) || []).join(', '));
  has('the comparison names a ruling that arrived since', /\| Herald entries \| \+1 \| ruling: United States v\. Upton \|/);
  check('the gaps line no longer claims no newspaper text is kept', /newspaper text beyond the front page's Congress, Supreme Court and World entries/.test(md), 'stale gaps line');

  // The overlap rule is copied from gov-watch, because a userscript cannot be required.
  // If the two ever disagree the brief and the panel list different moves under one ruling.
  const GW = fs.readFileSync(path.join(__dirname, '..', 'gov-watch.user.js'), 'utf8');
  const nearOf = (s) => (s.match(/const NEAR_MS = ([^;]+);/) || [])[1];
  check('NEAR_MS matches gov-watch', nearOf(GW) && nearOf(GW) === nearOf(SRC), `gov-watch ${nearOf(GW)} / read-stores ${nearOf(SRC)}`);
  check('...and so does the passed() test and the open-window rule',
    /o === 'signed' \|\| o === 'veto overridden'/.test(GW) && /o === 'signed' \|\| o === 'veto overridden'/.test(SRC)
      && /r\.prior === null \|\| \(r\.prior === undefined && /.test(GW) && /r\.prior === null \|\| \(r\.prior === undefined && /.test(SRC),
    'the success test or the open-window rule differs between gov-watch and read-stores');

  // A malformed record costs nothing: junk rows and bodies survive without the guard.
  const junk = mk({});
  junk.tools['pkgw:'].keys.data.bills = { 1: null, 2: { category: 'Supreme Court', body: 42, gametime: 'x', firstSeen: 'y' }, 3: { category: 'Supreme Court', headline: 'A|B', body: 'ok', firstSeen: T(5), prior: T(5.1) } };
  junk.tools['pkgw:'].keys.data.events = [null, { kind: 'policy', t0: 'x' }];
  const mdJ = brief(junk, null);
  const asString = mk({});
  asString.tools['pkgw:'].keys.data = JSON.stringify(asString.tools['pkgw:'].keys.data);
  const mdS = brief(asString, null);
  check('a gov-watch store exported as a JSON string is still read', /\| May 25, Y15 \| Still Counting \|/.test(mdS) && !/court: could not be read/.test(mdS), (mdS.split(/^## Court and the Record$/m)[1] || '').slice(0, 400));
  for (const [label, set] of [['with no bills key', (d) => { delete d.bills; }], ['with an empty bills map', (d) => { d.bills = {}; }]]) {
    const e = mk({}); set(e.tools['pkgw:'].keys.data);
    let mdX = ''; try { mdX = brief(e, null); } catch (err) { mdX = String(err.stack); }
    check(`a gov-watch store ${label} says so and does not throw`, /^## Court and the Record\n\n_no Herald entries/m.test(mdX) && !/could not be read/.test(mdX), (mdX.split(/^## Court and the Record$/m)[1] || mdX).slice(0, 300));
  }
  check('malformed bills and events do not trip the guard', !/court: could not be read/.test(mdJ) && /\*\*A\\\|B\*\*/.test(mdJ) && /no game date/.test(mdJ), (mdJ.split(/^## Court and the Record$/m)[1] || '').slice(0, 600));
}

console.log('\n— the Herald against the polls —');
{
  // The two conversions the section is built on, checked on their own before the section
  // that uses them. Both are against the real 2026-09-17 bundle: Herald entry 843, the
  // impeachment, is dated June 21, Y15 and was printed 2026-09-13 04:46Z against that
  // bundle's clock. If this drifts, every story lands in the wrong poll window.
  const SAMPLE = { t: 1789673101449, gs: 476961720, accel: 52.142857142857146 };
  check('a Herald game second lands on the real calendar',
    gameDay(456193039) === 'June 21, Y15' && Math.abs(realOf(SAMPLE, 456193039) - Date.parse('2026-09-13T04:46:38Z')) < 60e3,
    `${gameDay(456193039)} / ${new Date(realOf(SAMPLE, 456193039)).toISOString()}`);
  check('...and an entry with no game second, or a bundle with no sample, is not placed at all',
    !Number.isFinite(realOf(SAMPLE, undefined)) && !Number.isFinite(realOf(null, 456193039)) && gameDay('x') === 'no game date',
    `${realOf(SAMPLE, undefined)} / ${realOf(null, 456193039)} / ${gameDay('x')}`);
  // docs/21's mean: bucket-weighted over the buckets that are there, which sum to ~98.
  // Dividing by 100 instead reads the first dose-response bracket as −0.084, not −0.086.
  const LGBT0 = { far_left: 0, center_left: 0, slight_left: 0, neutral: 58, slight_right: 37, center_right: 0, far_right: 2 };
  const LGBT1 = { far_left: 0, center_left: 0, slight_left: 0, neutral: 67, slight_right: 29, center_right: 0, far_right: 2 };
  check("the poll mean is docs/21's bucket-weighted mean",
    Math.abs(pollMean(LGBT0) - 0.4433) < 5e-4 && Math.abs(pollMean(LGBT1) - pollMean(LGBT0) + 0.086) < 5e-4
      && pollMean(null) === null && pollMean({ neutral: 0 }) === null && pollMean({ far_right: 'x' }) === null,
    `${pollMean(LGBT0)} → ${pollMean(LGBT1)}`);

  const sec = (md.split(/^## The Herald against the polls$/m)[1] || '').split(/^## /m)[0];
  const hasH = (label, re) => check(label, re.test(sec), `not found: ${re}\n${sec.slice(0, 2400)}`);
  hasH('the spun entries are counted, and the unspun ones explained',
    /6 World entries kept, 5 carrying a spin \(3 liberal, 2 conservative\)\. Prose and spin arrive with gov-watch 0\.7\.0, so an empty spin column on a window that closes before 2026-09-10 04:16Z means nothing was kept, not that nothing was printed\./);
  hasH('an entry is placed on the real calendar, newest first',
    /\| LATE TERM \| conservative \| April 4, Y15 \| 2026-09-11 17:16Z \|[^|]*\| 3\.0 h ago \|[\s\S]*\| Tremors \| liberal \|/);
  hasH('a window with one-sided spin and nothing of ours in it is one row',
    /\| Abortion \| 2026-09-11 14:16Z \| 2026-09-11 19:16Z \| 5\.0 h \| 0\.082 → 0\.163 \| \+0\.082 \| 3 — 2 conservative, 1 unspun \| LATE TERM \(con\); CLINIC REGRET \(con\) \| \*\*none\*\* \|/);
  hasH('a window the ledger only half covers gets a floor, not a count',
    /\| Taxes \| 2026-09-10 08:16Z \| 2026-09-11 08:16Z \| 24\.0 h \| 0\.388 → 0\.286 \| -0\.102 \| 1 — 1 liberal \| MILL CLOSES \(lib\) \| ≥ 6 \(5 ok\) \|/);
  hasH('...and a window that closes before the ledger opens says so, rather than "none"',
    /\| Pollution \| 2026-09-10 10:16Z \| 2026-09-10 13:16Z \| 3\.0 h \| 0\.194 → 0\.194 \| 0\.000 \| 0 \| — \| none kept \(the ledger starts inside this window\) \|/);
  check('an entry printed before every poll is joined to no window',
    !/Tremors/.test(sec.split('### What landed between two polls')[1] || ''), 'Tremors reached a window row');
  // Newest first, so the freshest measurement leads and the truncation at 16 drops the
  // oldest windows rather than the ones worth reading.
  hasH('windows are listed newest first', /### What landed between two polls[\s\S]*\| Abortion \|[\s\S]*\| Taxes \|[\s\S]*\| Pollution \|/);
  hasH('the open windows are listed stalest first, and are not a measurement',
    /### Open windows[\s\S]*\| Pollution \| 2026-09-10 13:16Z \| 0\.194 \| 31\.0 h \| 5 — 2 liberal, 2 conservative, 1 unspun \|[\s\S]*\| Abortion \| 2026-09-11 19:16Z \| 0\.163 \| 1\.0 h \| 0 \| — \| 0 of 2 \(0 ok\) \|[\s\S]*Nothing has closed these windows, so no row here is a measurement/);
  // An hour with a terminal command and a canvass in it is not an untouched hour, and the
  // bold "none" has to mean what poll-watch's "no actions of yours" means.
  hasH('an action that is not disobedience still counts against "nothing of ours"',
    /\| Abortion \| 2026-09-11 19:16Z \| 0\.163 \| 1\.0 h \| 0 \| — \| 0 of 2 \(0 ok\) \|/);
  hasH('the section states adjacency is not a cause', /_Adjacency only, and thinner than the Court's\./);
  hasH('...and that the ledger cannot name the issue an action was aimed at',
    /not the issue it was aimed at — so "our actions" is every disobedience action in the window, on any issue/);
  check('...and never uses causal language',
    !/\b(because|caused|causes|due to|as a result|moved by|led to|triggered|thanks to|resulted in)\b/i.test(sec),
    (sec.match(/\b(because|caused|causes|due to|as a result|moved by|led to|triggered|thanks to|resulted in)\b/gi) || []).join(', '));

  // poll-watch 0.8.0's memo counts the operator's own actions in the same window from the
  // same ledger. If the two files disagree about which endpoint is a reading, or about
  // which edge of the window is open, the panel and the brief print different counts for
  // one window and one of them is wrong. Same rule as NEAR_MS above.
  {
    const PW = fs.readFileSync(path.join(__dirname, '..', 'poll-watch.user.js'), 'utf8');
    const readingOf = (s) => (s.match(/const READING = ([^;]+);/) || [])[1];
    check('the "a poll is a reading" exclusion matches poll-watch',
      readingOf(PW) && readingOf(PW) === readingOf(SRC), `poll-watch ${readingOf(PW)} / read-stores ${readingOf(SRC)}`);
    check('...and so does the half-open window',
      /t > fromT && t <= toT/.test(PW) && /ms\(e\.t\) > t0 && ms\(e\.t\) <= t1/.test(SRC),
      'the window edges differ between poll-watch and read-stores');
  }

  // gov-watch below 0.7.0 keeps the headline and the date and drops the prose and the spin.
  // The join still runs; every spin column is empty, and the brief has to say which kind of
  // empty that is — nothing kept, rather than nothing printed.
  const noProse = mk({});
  for (const x of Object.values(noProse.tools['pkgw:'].keys.data.bills)) { delete x.body; delete x.spin; }
  const mdNP = brief(noProse, null);
  const secNP = (mdNP.split(/^## The Herald against the polls$/m)[1] || '').split(/^## /m)[0];
  check('with no prose kept at all, the empty spin column is explained rather than blank',
    /6 World entries kept and not one carries a spin/.test(secNP) && /empty for want of a reading, not for want of a front page/.test(secNP)
      && !/### World entries with a spin/.test(secNP), secNP.slice(0, 900));
  check('...and the join still runs on the polls alone',
    /\| Abortion \| 2026-09-11 14:16Z \| 2026-09-11 19:16Z \| 5\.0 h \| 0\.082 → 0\.163 \| \+0\.082 \| 3 — 3 unspun \| — \| \*\*none\*\* \|/.test(secNP), secNP.slice(0, 2400));
  check('...and the gaps list says the front page cannot be lined up',
    /no Herald entry carries a spin, so the front page cannot be lined up against the polls/.test(mdNP), 'no gap line');

  // No clock at all: a Herald entry carries game seconds and nothing else, so not one of
  // them can be placed — and the brief says that instead of printing zeroes.
  const noClock = mk({});
  delete noClock.tools['pktw:'];
  delete noClock.tools['pkpl:'].keys.data.clock;
  const secNC = (brief(noClock, null).split(/^## The Herald against the polls$/m)[1] || '').split(/^## /m)[0];
  check('with no time sample, nothing is placed and the polls still join',
    /_no time sample in the bundle: a Herald entry carries game seconds/.test(secNC)
      && /\| Abortion \|[^\n]*\| \+0\.082 \| 0 \| — \| \*\*none\*\* \|/.test(secNC), secNC.slice(0, 900));

  // A spin on an entry the paper never dated is a fourth kind of empty, and reads
  // differently from a store that kept no spin at all.
  const noDate = mk({});
  for (const x of Object.values(noDate.tools['pkgw:'].keys.data.bills)) delete x.gametime;
  const secND = (brief(noDate, null).split(/^## The Herald against the polls$/m)[1] || '').split(/^## /m)[0];
  check('spun entries the paper never dated are called out as undatable, not as unspun',
    /6 World entries kept, some of them spun, and not one carries a usable game date/.test(secND)
      && /\| Abortion \|[^\n]*\| \+0\.082 \| 0 \| — \| \*\*none\*\* \|/.test(secND), secND.slice(0, 900));

  // One poll of an issue is not a window.
  const onePoll = mk({});
  onePoll.tools['pkpl:'].keys.data.polls = onePoll.tools['pkpl:'].keys.data.polls.slice(0, 1);
  const secOne = (brief(onePoll, null).split(/^## The Herald against the polls$/m)[1] || '').split(/^## /m)[0];
  check('one poll is not a window', /1 poll kept and no issue has been polled twice/.test(secOne), secOne.slice(0, 600));
}

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
check('...and a lead that expired while still listed is not open',
  !/### Open leads\n\n[^#]*\| Quinn Hayes \|/.test(md)
    && /\| open leads \| 1 \| Jamie Price in [^|]* · missed while still listed: Quinn Hayes \(last window closed [\d.]+ [hd] ago\) \|/.test(md)
    && /Missed while still listed: Quinn Hayes \(Elections, window closed [\d.]+ [hd] ago\)/.test(md),
  (md.match(/\| open leads \|[^\n]*/) || [''])[0]);
has('...nor counted as gone', /3 leads ever seen; 1 gone \(missed 1\)/);
has('an event with no endpoint is named by its kind', /\| \(status\) \| 2 \| active→jailed 1, jailed→active 1 \|[\s\S]*\| \(train\) \| 1 \| heart class 1 \|/);
has('a skill gain with no endpoints reads as its type alone', /\| heart \| \+0\.472 \| 56\.26 \| train \|/);
check('nothing in the brief prints "undefined" or "NaN"', !/undefined|NaN/.test(md), (md.match(/[^\n]*(undefined|NaN)[^\n]*/) || [''])[0]);
has('shop stock movement is differenced', /\| Bay Area Auto \| San Francisco \| shop \| 2 \| .* \| 1 \| Sedan 49→47 \|/);
has('blackjack edge is stated, and hands kept as a map are counted', /house edge 0\.459% over 550 deals; 3 hands kept\./);
has('...and slot sessions kept as a map', /Slots: 2 sessions kept\./);
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
check('...and the Herald join says it has no polls to join to', /_no polls kept: poll-watch stores a focus group when you run one/.test(md0), 'the Herald section is silent on an empty bundle');
check('...and says so in every section', (md0.match(/_no /g) || []).length >= 6, `${(md0.match(/_no /g) || []).length} empty-section notes`);

let mdN = '', errN = null;
try { mdN = brief(bundle, null); } catch (e) { errN = e; }
check('no prior means no comparison section', !errN && !/## Since the bundle/.test(mdN) && /No prior bundle to compare with/.test(mdN), errN ? String(errN.stack) : 'comparison section present without a prior');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
