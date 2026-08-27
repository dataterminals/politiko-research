// Fence + behaviour tests for poll-watch.
//
// poll-watch sits directly beside a WRITE endpoint that spends real resources.
// `POST /api/actions/poll` costs 5 energy, plus $500 or $1,000 for the two methods
// worth having, and it is rate-limited by a server cooldown the memo itself reports.
// A panel that files those memos is one line away from a panel that refreshes them,
// and "refresh" here means spending the operator's energy without being asked —
// clause 1 and clause 2 of the Scripting Abuse rules in a single call.
//
// So the fence is the strong form: nothing anywhere in the file may originate a
// request, which makes the one repeating timer it owns safe whatever its period.
//
// The behaviour half slices the derivation and export layers straight out of the
// shipped script and drives them, so the tests cannot drift from what installs.
// The properties that matter there are all about not inventing data:
//
//   - a refused poll is an error body, not a memo, and must not become a data point
//   - `lean` exists only for the two methods that return seven buckets; a street
//     poll has nowhere to put the −3…+3 weights and must return null rather than a
//     confident-looking number
//   - `net` is defined for both shapes, because it is the only series that stays
//     comparable when the operator switches methods mid-campaign
//
// Run: node userscripts/tools/test-poll-watch.js
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'poll-watch.user.js');
const SRC = fs.readFileSync(FILE, 'utf8');

// strip comments, so the disclosure block — which names the very paths and verbs it
// promises never to use — cannot itself trip the fence
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        ${detail}`); fail++; }
};
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want),
  `got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
const absent = (label, re) => {
  const hits = CODE.match(re) || [];
  check(label, hits.length === 0, `found: ${hits.slice(0, 4).join(' | ')}`);
};

// ---------------------------------------------------------------------------
// 1. The fence
// ---------------------------------------------------------------------------
console.log('\n— it originates nothing —');

// The tap owns exactly one reference to the real fetch and calls it once, to pass
// the game's own call through. Any other call site is a request this script invented.
const fetchCalls = [...CODE.matchAll(/(?<![.\w])fetch\s*\(/g)].length;
const passthrough = [...CODE.matchAll(/origFetch\.apply\(/g)].length;
check('the only fetch call is the tap passing the game\'s own through',
  fetchCalls === 0 && passthrough === 1,
  `${fetchCalls} bare fetch( call(s), ${passthrough} passthrough(s); expected 0 and 1`);

absent('it never constructs an XHR', /new\s+XMLHttpRequest/g);
absent('it never opens a socket', /new\s+WebSocket|EventSource/g);
absent('it never beacons', /sendBeacon/g);
absent('it never injects a fetching element', /new\s+Image\(|createElement\(\s*['"`](script|img|iframe|link)/g);
absent('it names no write verb', /method:\s*['"`](POST|PUT|PATCH|DELETE)/gi);
absent('it never presses the game\'s own buttons', /\.click\s*\(/g);
absent('it never hard-navigates', /location\.(assign|replace|reload)\s*\(|location\.href\s*=/g);
absent('it raises nothing from an unfocused tab', /new\s+Notification|Notification\.requestPermission|new\s+Audio/g);

// Every quoted /api/ string in this file is something the tap COMPARES a path
// against. None may sit where a URL argument goes.
const apiLiterals = [...CODE.matchAll(/.{0,14}['"`]\/api\/[^'"`]*['"`]/g)].map((m) => m[0]);
check('every quoted /api/ is a recogniser, not a destination',
  apiLiterals.length >= 4 && apiLiterals.every((s) => /(startsWith\(|===\s*)$/.test(s.slice(0, s.indexOf('\'')))),
  `not a comparison: ${apiLiterals.filter((s) => !/(startsWith\(|===\s*)$/.test(s.slice(0, s.indexOf('\'')))).join(' | ')}`);

console.log('\n— its one timer cannot reach the wire —');

// poll-watch legitimately repeats: "3m ago" and the cooldown countdown both age.
// The property that makes that safe is that no timer body touches anything that
// could send. Both ways to build a poller are covered — setInterval, and a
// setTimeout that re-arms — because the fence above already bans the verbs.
const NETWORKISH = /fetch|XMLHttpRequest|WebSocket|sendBeacon|\.click\(|pushState|location\s*\./;
const timerBodies = [
  ...[...CODE.matchAll(/setInterval\s*\(([\s\S]{0,320})/g)].map((m) => m[1]),
  ...[...CODE.matchAll(/setTimeout\s*\(([\s\S]{0,320})/g)].map((m) => m[1]),
];
check('every timer body is inert', timerBodies.every((b) => !NETWORKISH.test(b)),
  timerBodies.filter((b) => NETWORKISH.test(b)).map((b) => b.slice(0, 90)).join(' | '));
check('there is exactly one repeating timer', [...CODE.matchAll(/setInterval\s*\(/g)].length === 1,
  `found ${[...CODE.matchAll(/setInterval\s*\(/g)].length}; a second one needs a reason written here`);

console.log('\n— it reads only its own storage —');

const lsSites = [...CODE.matchAll(/localStorage\.(getItem|setItem|removeItem|clear)\b/g)].map((m) => m[1]);
eq('localStorage is touched in exactly two places', lsSites.sort(), ['getItem', 'setItem']);
const helperArgs = [...CODE.matchAll(/\b(?:readJSON|writeJSON)\(\s*([A-Za-z.]+)/g)].map((m) => m[1]);
check('every key handed to them is a K.* constant',
  helperArgs.length >= 4 && helperArgs.every((a) => a.startsWith('K.')),
  `args: ${helperArgs.join(' | ')}`);
absent('it never reads the game\'s auth blob', /getItem\(\s*['"`]auth/g);
check('both key names are namespaced', (CODE.match(/'pkpw:[a-z]+'/g) || []).length === 2,
  `found ${(CODE.match(/'pkpw:[a-z]+'/g) || []).length}`);

console.log('\n— it stays auditable —');

check('@grant none', /@grant\s+none/.test(SRC), 'any other grant sandboxes window and blinds the tap');
check('the disclosure block names Requests: ZERO', /Requests:\s*ZERO/.test(SRC), 'clause 6');
check('PANEL KIT v1 is present', /PANEL KIT v1 — shared verbatim block/.test(SRC), 'panels must be movable');
check('fit() runs after render', /render\(\);\s*\n\s*drag\.fit\(\)/.test(CODE), 'an off-screen handle is unrecoverable');
absent('no hashed chunk name is hardcoded', /-[A-Za-z0-9_-]{8}\.js/g);
absent('it sends nothing anywhere', /https?:\/\/(?!politiko\.io|raw\.github|github\.com)/g);

// Server strings (issue names, the persuasion angle) must never reach innerHTML.
// The only innerHTML in the file builds an SVG out of numbers this script computed.
const innerHTMLs = [...CODE.matchAll(/innerHTML\s*=\s*([\s\S]{0,400}?);\n/g)].map((m) => m[1]);
check('innerHTML is used once, for the numeric sparkline only',
  innerHTMLs.length === 1 && /<svg/.test(innerHTMLs[0])
    && !/p\.issue|p\.angle|p\.best|p\.mood|\.method/.test(innerHTMLs[0]),
  `${innerHTMLs.length} site(s): ${innerHTMLs.map((s) => s.slice(0, 70)).join(' | ')}`);

// ---------------------------------------------------------------------------
// 2. Behaviour — the derivation layer, sliced out of the shipped file
// ---------------------------------------------------------------------------
const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from.slice(0, 40)} .. ${to.slice(0, 40)}`);
  return SRC.slice(i, j);
};

const derive = cut('const METHOD = {', '  // Passive tap — only responses the app fetched');
const exportLayer = cut('const COLS = [', '  const copyBtn = ');

const store = new Map();
const stub = `
  const K = { data: 'pkpw:data', ui: 'pkpw:ui' };
  const log = () => {};
  const readJSON = (k, fallback) => (STORE.has(k) ? JSON.parse(STORE.get(k)) : fallback);
  const writeJSON = (k, v) => STORE.set(k, JSON.stringify(v));
`;
// eslint-disable-next-line no-new-func
const layer = new Function('STORE', `${stub}\n${derive}\n${exportLayer}\n return {
  METHOD, BUCKETS, data, ui, toRow, blocs, net, lean, exact, sideText, addPoll,
  issuesSeen, nowGS, parseGameDatetime, gameLabel, tsv, COLS };`)(store);

const FINE = {
  issue: "Women's Rights", method: 'focus_group', mood: 'right-leaning',
  far_left: 10, center_left: 15, slight_left: 10, neutral: 20,
  slight_right: 15, center_right: 20, far_right: 10,
  volatility: 'moderate', salience: 'warm', popularity: 41,
  best_target: 'Slight Right', persuasion_angle: 'Frame it as process.',
};
const COARSE = {
  issue: 'Taxes', method: 'street', mood: 'right-leaning',
  left_bloc: 30, center: 25, right_bloc: 45, extreme_tag: 'HARDENING',
};

console.log('\n— a memo is recognised by its shape, not its verb —');

const fine = layer.toRow(FINE);
const coarse = layer.toRow(COARSE);
check('a seven-bucket memo parses', !!fine && !!fine.fine && fine.coarse === null,
  JSON.stringify(fine));
check('a three-bloc memo parses', !!coarse && !!coarse.coarse && coarse.fine === null,
  JSON.stringify(coarse));
eq('a refused poll is not a memo',
  layer.toRow({ message: 'Not enough energy.', issue: 'Taxes' }), null);
eq('an unrelated response is not a memo', layer.toRow([{ id: 1, symbol: 'CAP' }]), null);
eq('neither is a bare issue name', layer.toRow({ issue: 'Taxes' }), null);
eq('nor one lone number', layer.toRow({ issue: 'Taxes', neutral: 40 }), null);
eq('the method is carried through', [fine.method, coarse.method], ['focus_group', 'street']);
eq('the game rates the two paid methods as exact, the cheap two as not',
  ['street', 'online', 'professional', 'focus_group'].map((m) => layer.METHOD[m].exact),
  [false, false, true, true]);

console.log('\n— the derived numbers are arithmetic, not a model —');

eq('blocs collapse the seven buckets', layer.blocs(fine), { l: 35, c: 20, r: 45 });
eq('blocs pass a coarse memo straight through', layer.blocs(coarse), { l: 30, c: 25, r: 45 });
eq('net is right minus left, fine', layer.net(fine), 10);
eq('net is right minus left, coarse', layer.net(coarse), 15);
eq('lean weights the buckets onto −3…+3', +layer.lean(fine).toFixed(4), 0.15);
eq('lean is null for a coarse memo rather than a guess', layer.lean(coarse), null);
eq('lean handles an empty spread without dividing by zero',
  layer.lean({ fine: Object.fromEntries(layer.BUCKETS.map(([k]) => [k, 0])) }), 0);

console.log('\n— a side is named, never left as a bare sign —');

eq('positive reads right', layer.sideText(10), 'R+10');
eq('negative reads left', layer.sideText(-10), 'L+10');
eq('a rounding-noise difference reads as even', layer.sideText(0.2), 'even');
eq('two decimals for the lean scale', layer.sideText(0.15, 2), 'R+0.15');
eq('a missing value is a dash, not a zero', layer.sideText(null), '—');

console.log('\n— filing does not fabricate data points —');

layer.data.polls.length = 0;
const a = layer.toRow(FINE);
layer.addPoll(a);
layer.addPoll(layer.toRow(FINE)); // same memo seen twice — one re-render, one bench click
eq('the same memo twice is filed once', layer.data.polls.length, 1);
layer.addPoll(layer.toRow(COARSE));
eq('a different issue is a second point', layer.data.polls.length, 2);
layer.addPoll(layer.toRow({ ...FINE, far_right: 25, neutral: 5 }));
eq('the same issue with a moved spread is a real second reading', layer.data.polls.length, 3);
eq('the issue you just polled becomes the pinned one', layer.ui.issue, "Women's Rights");

layer.data.polls.length = 0;
for (let i = 0; i < 420; i++) layer.addPoll(layer.toRow({ ...FINE, issue: `I${i}` }));
check('the store is capped', layer.data.polls.length === 400, `kept ${layer.data.polls.length}`);
eq('and it drops the oldest, not the newest', layer.data.polls[399].issue, 'I419');

console.log('\n— the game clock stamps a memo when the app has supplied one —');

eq('no clock yet means no game stamp', layer.nowGS(), null);
const gs = layer.parseGameDatetime('07:52 September 1, Y3');
eq('the app\'s datetime string parses', typeof gs, 'number');
eq('and round-trips to the same date', layer.gameLabel(gs), 'Sep 1, Y3 07:52');
eq('an unparseable datetime is null, not a wrong date', layer.parseGameDatetime('soon'), null);
layer.data.clock = { t: Date.now(), gs, accel: 52.14 };
check('with a clock, a memo carries game-seconds', Number.isFinite(layer.toRow(FINE).gs),
  String(layer.toRow(FINE).gs));

console.log('\n— the export says what it has and blanks what it does not —');

layer.data.polls.length = 0;
layer.data.clock = { t: Date.now(), gs, accel: 52.14 };
layer.addPoll(layer.toRow(FINE));
layer.addPoll(layer.toRow(COARSE));
const rows = layer.tsv().split('\n');
eq('a header plus one row per memo', rows.length, 3);
eq('the header is the column list', rows[0].split('\t'), layer.COLS);

const byName = (line) => Object.fromEntries(layer.COLS.map((c, i) => [c, line.split('\t')[i]]));
const rFine = byName(rows[1]), rCoarse = byName(rows[2]);
eq('the fine row carries its lean', rFine.lean, '0.150');
eq('the coarse row leaves lean blank rather than zero', rCoarse.lean, '');
eq('the coarse row leaves the seven buckets blank',
  layer.BUCKETS.map(([k]) => rCoarse[k]), ['', '', '', '', '', '', '']);
eq('both rows carry net', [rFine.net, rCoarse.net], ['10.0', '15.0']);
eq('both rows say whether the method was exact', [rFine.exact, rCoarse.exact], ['yes', 'no']);
eq('both rows carry the game date', [rFine.game_time, rCoarse.game_time],
  ['Sep 1, Y3 07:52', 'Sep 1, Y3 07:52']);
check('a tab inside a server string cannot break a column',
  !layer.tsv().split('\n').some((l) => l.split('\t').length !== layer.COLS.length),
  'a row has the wrong column count');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
