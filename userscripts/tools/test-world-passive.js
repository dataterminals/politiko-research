// A fence around world-watch.
//
// This is the widest reader in the repo: eleven endpoints, five of them political, one
// of them other people's profiles. Width is exactly what makes it easy to spoil, and
// there are three specific ways.
//
//   Filling the gaps. The panel's whole design is a list of readings you do not have
//   yet, each with a button to the screen that carries it. That is one keystroke away
//   from "just fetch /api/government on boot", which converts a passive tool into a
//   scraper of a page you are not viewing — clause 2 and clause 5, in one line.
//
//   Refreshing. Every figure here is as old as the last time you looked at its screen,
//   and the panel says so on four tabs. A timer that refreshes anything would make the
//   caveat false and the tool bannable at the same time. No timer in this file may
//   touch the network or navigation, whatever its period.
//
//   Drifting from the disclosure. Clause 6 makes undisclosed functionality bannable,
//   and a header comment is only true on the day it is written. So the last block below
//   reads the paths the CODE recognises and fails if the disclosure does not name every
//   one of them. Adding an endpoint means documenting it, or the build stops.
//
// Run: node userscripts/tools/test-world-passive.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'world-watch.user.js');
const SRC = fs.readFileSync(FILE, 'utf8');

// The disclosure block names what the tool promises not to do, so it has to be held
// apart from the code or it trips every check written here.
const HEADER = SRC.slice(0, SRC.indexOf('(() => {'));
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

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

const fetchCalls = [...CODE.matchAll(/(?<![.\w])fetch\s*\(/g)].length;
const passthrough = [...CODE.matchAll(/origFetch\.apply\(/g)].length;
check('the only fetch call is the tap passing the game\'s own through',
  fetchCalls === 0 && passthrough === 1,
  `${fetchCalls} bare fetch( call(s), ${passthrough} passthrough(s); expected 0 and 1`);

// …and it passes the arguments through untouched. A rewritten argument list is a
// request of our own wearing the game's call as a costume.
check('...with the game\'s own arguments, unrewritten',
  /origFetch\.apply\(this, args\)/.test(CODE)
    && !/\bargs\s*=[^=]/.test(CODE) && !/args\[\d\]\s*=[^=]/.test(CODE),
  'expected origFetch.apply(this, args) and no assignment to args');

absent('it never constructs an XHR', /new\s+XMLHttpRequest|XMLHttpRequest\.prototype/g);
absent('it never opens a socket', /new\s+WebSocket|new\s+EventSource/g);
absent('it never beacons', /sendBeacon/g);
absent('it never injects a fetching element', /new\s+Image\(|createElement\(\s*['"`](script|img|iframe|link|object|embed)/g);
absent('it never imports at runtime', /\bimport\s*\(/g);
absent('it names no write verb', /method:\s*['"`](POST|PUT|PATCH|DELETE)/gi);
absent('it builds no request body', /\bbody:\s*(JSON\.stringify|new\s+FormData|new\s+URLSearchParams)/g);

console.log('\n— it reads responses, never requests —');

// The tap takes the response and nothing else. A tool that reads request bodies is not
// forbidden — align-watch does it, to know what YOU submitted — but this one has no
// business doing so, and saying so is cheaper than remembering it.
const WRAP = CODE.slice(CODE.indexOf('const origFetch = window.fetch;'), CODE.indexOf('// 6. Panel'));
check('the wrapper never looks at the second argument',
  !/args\[1\]/.test(WRAP) && !/\binit\b/.test(WRAP),
  'the fetch wrapper reads args[1] / init — that is the request body and headers');
check('...and clones before reading, so the app still gets its body',
  /res\.clone\(\)\.json\(\)/.test(WRAP),
  'expected res.clone().json() — reading the original drains it out from under the game');
absent('it never reads the auth key', /['"`]auth['"`]\s*\)|getItem\(\s*['"`]auth/g);

console.log('\n— nothing runs on its own —');

// Two ways to build a poll: setInterval, and a setTimeout that re-arms. Rather than ban
// timers — the panel legitimately ages its own freshness text — pin what they may do.
const NAVISH = /fetch|XMLHttpRequest|pushState|PopStateEvent|jump\s*\(|location\s*\.|consume\s*\(/;
const bodies = [...CODE.matchAll(/set(?:Timeout|Interval)\s*\(([\s\S]{0,260})/g)].map((m) => m[1]);
check('every timer body is inert',
  bodies.every((b) => !NAVISH.test(b)),
  bodies.filter((b) => NAVISH.test(b)).map((b) => b.slice(0, 90)).join(' | '));
check('there is exactly one repeating timer, and it only redraws',
  [...CODE.matchAll(/setInterval\s*\(/g)].length === 1 && /setInterval\([\s\S]{0,160}render\(\)/.test(CODE),
  `found ${[...CODE.matchAll(/setInterval\s*\(/g)].length} setInterval site(s)`);
absent('nothing runs while the tab is hidden without checking', /requestIdleCallback/g);
check('...and the redraw checks first',
  /document\.hidden/.test(CODE), 'expected a document.hidden guard on the redraw');

console.log('\n— it draws attention to nothing —');

absent('no notifications', /new\s+Notification|Notification\.requestPermission|registration\.showNotification/g);
absent('no dialogs', /\b(alert|confirm|prompt)\s*\(/g);
absent('no title flashing', /document\.title\s*=/g);
absent('no audio', /new\s+Audio|AudioContext/g);
absent('it never clicks the game for you', /\.click\(\)/g);

console.log('\n— a jump is a click —');

// Navigation exists on purpose: the panel's job includes telling you which screen would
// fill a gap, and a button is cheaper than a paragraph. So pin it rather than ban it.
const pushSites = [...CODE.matchAll(/history\.pushState\s*\(/g)].length;
check('exactly one place navigates', pushSites === 1, `${pushSites} pushState call sites`);
check('...and it carries the router\'s index forward',
  /Number\.isFinite\(st\.idx\)/.test(CODE) && /new PopStateEvent\('popstate', \{ state: history\.state \}\)/.test(CODE),
  'expected the idx-carrying pushState from docs/12-navigation-surface.md');
check('...reachable only from a click handler',
  /addEventListener\('click', \(\) => jump\(href\)\)/.test(CODE),
  'expected jump() to be wired to a click and nothing else');
// The definition is an arrow (`const jump = (href) =>`), so it is not a call site.
// Every `jump(` in the file is therefore something invoking it, and there may be one.
const jumpCalls = [...CODE.matchAll(/(?<![\w.])jump\s*\(/g)].length;
check('...and invoked from nowhere else',
  jumpCalls === 1, `${jumpCalls} jump( call site(s); expected only the click handler`);

console.log('\n— it cannot grow without bound —');

// A passive reader that quietly fills localStorage is its own kind of failure: the
// write starts throwing, every later reading is lost, and nothing says so.
check('the people ledger is capped', /trim\(data\.people, CAP\.people\)/.test(CODE), 'expected trim(data.people, CAP.people)');
check('the protest ledger is capped', /trim\(data\.protests, CAP\.protests\)/.test(CODE), 'expected trim(data.protests, CAP.protests)');
check('the campaign list is capped', /campaigns\.slice\(-CAP\.campaigns\)/.test(CODE), 'expected a slice against CAP.campaigns');
check('a failed write is survivable', /catch \(e\) \{ log\('write fail \(quota\?\)'/.test(CODE),
  'expected the quota-tolerant writeJSON');

console.log('\n— storage stays in its own namespace —');
{
  const keys = [...CODE.matchAll(/['"`](pk[a-z]{0,4}:[a-z]*)['"`]/g)].map((m) => m[1]);
  check('every storage key is ours', keys.length > 0 && keys.every((k) => k.startsWith('pkww:')),
    `foreign keys: ${keys.filter((k) => !k.startsWith('pkww:')).join(', ')}`);
  // Storage is reached two ways and only two: the readJSON/writeJSON pair, whose key is
  // their own parameter, and one direct getItem for the size readout. Both must be
  // keyed from K, so the namespace above is the whole story.
  const direct = [...CODE.matchAll(/localStorage\.(getItem|setItem|removeItem)\(\s*([^,)]+)/g)].map((m) => m[2].trim());
  check('...and nothing reaches storage except through K or the two helpers',
    direct.every((a) => /^K\./.test(a) || a === 'k'),
    `direct keys: ${direct.filter((a) => !/^K\./.test(a) && a !== 'k').join(', ')}`);
  const helperKeys = [...CODE.matchAll(/(?:read|write)JSON\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  check('...and the helpers are only ever handed one of ours',
    helperKeys.length > 0 && helperKeys.every((a) => /^K\./.test(a)),
    `keys passed to the helpers: ${helperKeys.filter((a) => !/^K\./.test(a)).join(', ')}`);
}

console.log('\n— the disclosure still describes the code —');
{
  const norm = (p) => p
    .replace(/\/\{[^}]*\}/g, '').replace(/\/<[^>]*>/g, '')
    .replace(/[…\s]+$/, '').replace(/\/$/, '');

  // Everything the code recognises: quoted literals, plus the paths spelled as regexes.
  const literals = [...CODE.matchAll(/['"`](\/api\/[a-z0-9/_{}-]*)['"`]/gi)].map((m) => m[1]);
  const regexed = [...CODE.matchAll(/\/\^\\\/api((?:\\\/[a-z0-9_-]+|\\\/\[\^\\?\/\]\+|\\\/\(\[\^\\?\/\]\+\))+)/gi)]
    .map((m) => `/api${m[1].replace(/\\\//g, '/').replace(/\[\^\/?\]\+|\(\[\^\/?\]\+\)/g, '{id}')}`);

  const recognised = [...new Set([...literals, ...regexed].map(norm))]
    .filter((p) => p !== '/api' && p !== '');
  check('the code recognises the endpoints we think it does', recognised.length >= 10,
    `only ${recognised.length}: ${recognised.join(', ')}`);

  const declared = [...HEADER.matchAll(/(\/api\/[a-z0-9/_{}<>-]*)/gi)].map((m) => norm(m[1]));
  const undeclared = recognised.filter((p) => !declared.includes(p));
  check('every endpoint the code reads is named in the disclosure', undeclared.length === 0,
    `missing from the header: ${undeclared.join(', ')}`);

  check('the disclosure still claims zero added requests',
    /ZERO additional requests to politiko\.io/.test(HEADER), 'the header no longer makes the claim this file fences');
  check('...and still says what it stores', /Storage:\s+localStorage keys prefixed `pkww:`/.test(HEADER),
    'expected the Storage line');
  check('...and that other players\' alignments are kept',
    /Other players' alignments ARE stored/.test(HEADER),
    'the header must say this outright — it is the one thing here a reader would not expect');
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
