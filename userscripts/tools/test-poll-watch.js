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
// SINCE 2026-09-11 this file is also one of exactly two in the repo allowed to raise a
// desktop notification, on exactly one event: the `cooldown_until` in the operator's own
// memo expiring. That is an operator decision taken with the ban risk priced, written up
// in docs/01-rules-envelope.md, and it is narrow on purpose — so the job of the section
// below is to hold it at that width rather than to assert an absence:
//
//   Only `window.Notification` — the page-level constructor, which sends nothing. The
//   OTHER way to make a notification is a service worker with a push subscription, and
//   that is a registration request plus an endpoint the game knows nothing about.
//   `serviceWorker`, `pushManager`, `showNotification` stay banned outright.
//
//   It cannot fire while you are looking at the page (`document.hasFocus()`), it cannot
//   fire with its switch off, and it cannot fire without permission. Each of those is
//   checked at the point of writing, not merely where the switch is offered.
//
//   Every raise has a clear, on four exits: the panel being opened, a new memo landing,
//   the switch going off, and `pagehide`. A notification that can be raised and not
//   taken back outlives the page that made it.
//
//   Permission is asked for from the switch click and ONLY while it is still `default`.
//   The grant is per origin and Politiko's own Web Push shares it, so asking again after
//   a denial is both useless and a way to turn the game's own notifications off.
//
//   And still: no sound, no `document.title`, no favicon, no `window.focus()`. The
//   decision was about one channel. It is not a licence for the other four.
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
// The notification channel is allowed (see the head of this file); the four other ways
// to reach a tab you are not looking at are not, and neither is the push half.
absent('it never makes a sound', /new\s+Audio|AudioContext|createOscillator/g);
absent('it never pokes the tab title', /document\.title\s*=/g);
absent('it never swaps the favicon', /rel~?=|['"`]icon['"`]/g);
absent('it never registers a worker or subscribes to push',
  /serviceWorker|pushManager|PushManager|showNotification|getSubscription|vapid/gi);
absent('it never takes focus', /window\.focus\s*\(|\.blur\s*\(\)|(?<![.\w])alert\s*\(/g);

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

console.log('\n— the one notification channel is held at its width —');

// Reached through `window.` every time. A bare `Notification` would still work in the
// page, but the prefix is what makes every use of it greppable in one line, and this
// check is the thing that keeps it that way.
const bareNotif = CODE.match(/(?<!window\.)\bNotification\b/g) || [];
check('Notification is only ever reached through window.', bareNotif.length === 0,
  `${bareNotif.length} bare mention(s)`);
check('exactly one notification is ever constructed',
  (CODE.match(/new\s+window\.Notification\s*\(/g) || []).length === 1,
  `${(CODE.match(/new\s+window\.Notification\s*\(/g) || []).length}; a second one is a second channel`);
check('permission is requested from exactly one place',
  (CODE.match(/requestPermission/g) || []).length === 1,
  'one switch, one prompt');

const defaults = CODE.match(/const DEFAULT_CH = \{([^}]*)\}/);
check('there is a single defaults object', !!defaults, 'expected `const DEFAULT_CH = { … }`');
if (defaults) {
  check('PAGE is on', /page:\s*true/.test(defaults[1]), defaults[1].trim());
  check('NOTIFY is off', /notify:\s*false/.test(defaults[1]), defaults[1].trim());
}

const raise = CODE.slice(CODE.indexOf('const notifyRaise = '),
  CODE.indexOf('const notifyRaise = ') + 700);
check('it refuses to fire when its switch is off', raise.includes('if (!ui.ch.notify'),
  'expected an early return on ui.ch.notify inside notifyRaise()');
check('...when permission was never granted',
  /Notification\.permission !== 'granted'\) return;/.test(raise),
  'expected an early return unless the permission is granted');
check('...and when you are already looking at the page',
  /if \(document\.hasFocus\(\)\) return;/.test(raise),
  'a notification over a window you are looking at is noise — PAGE already said it');

const arm = CODE.slice(CODE.indexOf('const notifyArm = '), CODE.indexOf('const notifyArm = ') + 500);
check('permission is only ever asked for while it is still undecided',
  /permission !== 'default'\) return false;/.test(arm),
  're-asking after a denial is useless, and the grant is shared with the game\'s own push');
check('...and only from the click that switches the channel on',
  /if \(k === 'notify' && ui\.ch\.notify\) \{\s*notifyArm\(\)/.test(CODE),
  'permission cannot be requested outside a user gesture');
check('...and a refusal switches the channel back off',
  /ui\.ch\.notify = false;[\s\S]{0,60}dataset\.on = '0';/.test(CODE),
  'a lit switch that can never fire is a lie told by the panel');

check('notifyClear() exists', CODE.includes('const notifyClear = '), 'expected const notifyClear = …');
check('switching NOTIFY off takes it back',
  /if \(k === 'notify' && !ui\.ch\.notify\) notifyClear\(\);/.test(CODE),
  'the channel switch must close what it already raised');
check('opening the panel takes it back',
  /if \(ui\.open\) notifyClear\(\);/.test(CODE),
  'you have seen it; the OS copy has no further job');
check('a new deadline takes it back',
  /cool\.ready = false;\s*notifyClear\(\);/.test(CODE),
  'a fresh memo retires whatever the last one was still saying');
check('...and pagehide takes it back, so none outlives the page',
  /pagehide['"`],\s*notifyClear\)/.test(CODE),
  'expected a pagehide listener that closes the notification');

console.log('\n— the alert is a comparison, not a question —');

check('the deadline is the one that arrived inside the memo',
  /const latestCooldown = /.test(CODE) && /Date\.parse\(p\.cooldown\)/.test(CODE),
  'cooldown_until is absolute and already in hand; nothing needs to be asked');
check('only a deadline still in the future can be crossed',
  /cool\.armed = !!iso && Date\.parse\(iso\) > Date\.now\(\);/.test(CODE),
  'arriving to a cooldown that expired hours ago is not news');
check('the alert state is evaluated whether or not the tab is visible',
  /setInterval\(\(\) => \{\s*tick\(\);/.test(CODE),
  'gating this on visibility switches the channel off exactly where it is wanted');
check('...while the repaint stays gated on it',
  /if \(!document\.hidden && ui\.open && onStage\(\)/.test(CODE),
  'a hidden tab must not be repainted');

console.log('\n— it reads only its own storage —');

const lsSites = [...CODE.matchAll(/localStorage\.(getItem|setItem|removeItem|clear)\b/g)].map((m) => m[1]);
eq('localStorage is touched by three verbs and never cleared',
  [...new Set(lsSites)].sort(), ['getItem', 'removeItem', 'setItem']);
const helperArgs = [...CODE.matchAll(/\b(?:readJSON|writeJSON)\(\s*([A-Za-z.]+)/g)].map((m) => m[1]);
check('every key handed to them is a K.* or OLD.* constant',
  helperArgs.length >= 4 && helperArgs.every((a) => /^(K|OLD)\./.test(a)),
  `args: ${helperArgs.join(' | ')}`);
absent('it never reads the game\'s auth blob', /getItem\(\s*['"`]auth/g);
check('both live key names sit under this tool\'s own prefix',
  (CODE.match(/'pkpl:[a-z]+'/g) || []).length === 2,
  `found ${(CODE.match(/'pkpl:[a-z]+'/g) || []).length}`);

console.log('\n— it stays auditable —');

check('@grant none', /@grant\s+none/.test(SRC), 'any other grant sandboxes window and blinds the tap');
check('the disclosure block names Requests: ZERO', /Requests:\s*ZERO/.test(SRC), 'clause 6');
const HEADER = SRC.slice(0, SRC.indexOf('(() => {'));
check('the header states both channels, with their defaults',
  /PAGE\s+\(default ON\)/.test(HEADER) && /NOTIFY \(default OFF\)/.test(HEADER),
  'clause 6: every channel has to be named, with its default');
check('...and says where the deadline came from',
  /cooldown_until` is an absolute timestamp/.test(HEADER),
  'the rules argument for this channel IS that sentence; it has to be in the file');
check('...and names the operator decision that allowed it',
  /2026-09-11/.test(HEADER) && /01-rules-envelope\.md/.test(HEADER),
  'a channel this narrow has to say what authorised it');
check('...and warns that the permission is the game\'s too',
  /per ORIGIN/.test(HEADER),
  'a Block answered here switches Politiko\'s own push off');
check('PANEL KIT v3 is present', /PANEL KIT v3 — shared verbatim block/.test(SRC), 'panels must be movable AND resizable');
check('FAB KIT v9 is present', /FAB KIT v9 — shared verbatim block/.test(SRC), 'the button belongs to the home row');
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
  const K = { data: 'pkpl:data', ui: 'pkpl:ui' };
  const log = () => {};
  // addPoll re-arms the cooldown alert, which lives outside this slice. The fence above
  // is what holds tick() honest; here it only has to exist.
  const tick = () => {};
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


// ---------------------------------------------------------------------------
// The move off `pkpw:`, a prefix this tool shared with people-watch without either
// of them knowing. Both wrote `pkpw:ui`; nothing threw, because a panel merges its
// stored blob over its own defaults and ignores what it does not recognise. The
// symptom surfaced somewhere else entirely — `open`, `fab` and `size` belonged to
// whichever panel saved last, so dragging one tool's button moved the other's.
//
// What makes the migration safe is an asymmetry that is easy to get backwards, so it
// is pinned here rather than left to the comment explaining it: `pkpw:data` was this
// tool's alone and is deleted, while `pkpw:ui` is still people-watch's LIVE panel
// state and has to survive untouched.
// ---------------------------------------------------------------------------
console.log('\n— the one-time move off a shared prefix —');

check('the old keys are held apart from the live ones',
  /const OLD = \{ data: 'pkpw:data', ui: 'pkpw:ui' \};/.test(CODE),
  'the migration has to spell out both old names in one place');
check('the ambiguous fields are excluded by name',
  /const MINE = \['view', 'everywhere', 'x', 'y', 'issue'\];/.test(CODE),
  'open/fab/size may hold people-watch\'s values and must not cross');
absent('the old ui key is never written', /(?:writeJSON|setItem)\(\s*OLD\.ui/g);
absent('...and never removed', /removeItem\(\s*OLD\.ui/g);
check('the old data key is the only thing removed anywhere',
  (CODE.match(/removeItem\(\s*[A-Za-z.]+/g) || []).join(' | ') === 'removeItem(OLD.data',
  `removals: ${(CODE.match(/removeItem\(\s*[A-Za-z.]+/g) || []).join(' | ')}`);

console.log('\n— ...driven against a store both tools had written to —');
{
  const mig = cut('  // The keys — and the one-time move', '  const data = Object.assign({ polls:');
  const drive = (init) => {
    const S = new Map(Object.entries(init));
    const localStorage = {
      getItem: (k) => (S.has(k) ? S.get(k) : null),
      setItem: (k, v) => S.set(k, String(v)),
      removeItem: (k) => S.delete(k),
    };
    // The slice starts at K and runs past the tool's own readJSON/writeJSON, so only
    // the logger sitting above them has to be supplied.
    // eslint-disable-next-line no-new-func
    new Function('localStorage', `const log = () => {};\n${mig}`)(localStorage);
    return { keys: [...S.keys()].sort(), get: (k) => (S.has(k) ? JSON.parse(S.get(k)) : null) };
  };

  // A store as it actually looked with both tools installed: the shared ui blob holds
  // this tool's fields, people-watch's fields, and three names that belong to whichever
  // one saved last.
  const shared = {
    open: true, fab: { x: 900, y: 40 }, size: { w: 560, h: 400 },
    view: 'trend', everywhere: false, x: 120, y: 200, issue: 'econ',
    sort: 'idle', dir: 1, hideNpc: true, cols: { name: 90 }, panel: { x: 5, y: 5 },
  };
  const a = drive({
    'pkpw:data': JSON.stringify({ polls: [{ id: 1 }], issues: ['econ'], clock: 7 }),
    'pkpw:ui': JSON.stringify(shared),
    'pkpw:people': JSON.stringify({ someone: 1 }),
  });
  eq('the memos land under the new key', a.get('pkpl:data'),
    { polls: [{ id: 1 }], issues: ['econ'], clock: 7 });
  eq('...and the old data key is gone', a.get('pkpw:data'), null);
  eq('the panel state keeps only what was ours', a.get('pkpl:ui'),
    { view: 'trend', everywhere: false, x: 120, y: 200, issue: 'econ' });
  eq('...so no ambiguous field crosses over',
    ['open', 'fab', 'size'].filter((f) => f in a.get('pkpl:ui')), []);
  eq('...and people-watch\'s live blob is untouched', a.get('pkpw:ui'), shared);
  eq('...as is every other key of theirs', a.get('pkpw:people'), { someone: 1 });

  // Idempotence, which is what stops a second install from eating a live session.
  const b = drive({
    'pkpl:data': JSON.stringify({ polls: ['new'] }),
    'pkpl:ui': JSON.stringify({ view: 'latest' }),
    'pkpw:data': JSON.stringify({ polls: ['stale'] }),
  });
  eq('an existing new key is never overwritten', b.get('pkpl:data'), { polls: ['new'] });
  eq('...nor is the panel state', b.get('pkpl:ui'), { view: 'latest' });
  eq('...and a second run removes nothing', b.get('pkpw:data'), { polls: ['stale'] });

  eq('a fresh install writes nothing at all', drive({}).keys, []);
}
console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
