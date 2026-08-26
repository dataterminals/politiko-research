// A fence around gov-watch.
//
// This tool reads two endpoints and is tempted by both, in different ways.
//
//   The Government screen is a page you are not on. Every tab here can print "no reading
//   yet" and offer a button to the screen that would fix it, and that button is one lazy
//   edit away from "just fetch /api/government on boot" — which turns a passive reader
//   into a scraper of a page nobody opened. Clause 2 and clause 5, in one line.
//
//   The faction feed is a fifteen-second poll THE APP MAKES. That is exactly why the tool
//   may read it, and exactly why it must never make it itself. A timer in this file that
//   touched the network would be indistinguishable from the app's own poll on the wire
//   and completely different in the rules.
//
//   Then there is the cycle. This tool knows the government moves about twice a real day
//   and can project when. Knowing when to look is fine; looking on your behalf is not.
//
// Two more things this file pins that are specific to a change ledger:
//
//   The bracket. Every row claims a change happened between two times. The panel must
//   never print one without its window, because a window is the difference between a
//   measurement and a guess.
//
//   The blast radius. A lobbying job carries usernames, committed cash and slot rosters.
//   The disclosure says status only, so the code has to keep that promise in the shape of
//   what it stores, not just in the header.
//
// Run: node userscripts/tools/test-gov-passive.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'gov-watch.user.js');
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

// This tool watches a screen with buttons on it. A lobbying job is created by a POST that
// the client defines and this file must not learn — the shapes live in docs/14, not here.
absent('it knows no lobbying mutation', /\/jobs\/[^'"`]*\/(lock|slots|resolve)|target_member_id|committed_cash|committed_power/g);

console.log('\n— it reads responses, never requests —');

const WRAP = CODE.slice(CODE.indexOf('const origFetch = window.fetch;'), CODE.indexOf('// 6. Panel'));
check('the wrapper never looks at the second argument',
  !/args\[1\]/.test(WRAP) && !/\binit\b/.test(WRAP),
  'the fetch wrapper reads args[1] / init — that is the request body and headers');
check('...and clones before reading, so the app still gets its body',
  /res\.clone\(\)\.json\(\)/.test(WRAP),
  'expected res.clone().json() — reading the original drains it out from under the game');
absent('it never reads the auth key', /['"`]auth['"`]\s*\)|getItem\(\s*['"`]auth/g);

console.log('\n— nothing runs on its own —');

const NAVISH = /fetch|XMLHttpRequest|pushState|PopStateEvent|jump\s*\(|location\s*\.|consume\s*\(/;
const bodies = [...CODE.matchAll(/set(?:Timeout|Interval)\s*\(([\s\S]{0,260})/g)].map((m) => m[1]);
check('every timer body is inert',
  bodies.every((b) => !NAVISH.test(b)),
  bodies.filter((b) => NAVISH.test(b)).map((b) => b.slice(0, 90)).join(' | '));
check('there is exactly one repeating timer, and it only redraws',
  [...CODE.matchAll(/setInterval\s*\(/g)].length === 1 && /setInterval\([\s\S]{0,200}render\(\)/.test(CODE),
  `found ${[...CODE.matchAll(/setInterval\s*\(/g)].length} setInterval site(s)`);
absent('nothing runs while the tab is hidden without checking', /requestIdleCallback/g);
check('...and the redraw checks first',
  /document\.hidden/.test(CODE), 'expected a document.hidden guard on the redraw');

// The specific trap for THIS tool: it computes when the next Congress cycle lands. That
// projection must feed a sentence, never a scheduler.
check('the cycle projection drives text, not a timer',
  !/setTimeout\([^)]*proj|setTimeout\([^)]*GAME_MONTH|setInterval\([^)]*GAME_MONTH/.test(CODE),
  'the projected boundary is being used to schedule something');
check('...and nothing waits for a boundary to come round',
  !/GAME_MONTH_MS\s*\)\s*;?\s*$/m.test(CODE.replace(/const GAME_MONTH_MS[^\n]*\n/, '')),
  'GAME_MONTH_MS appears at the end of a call — check it is not a delay');

console.log('\n— it draws attention to nothing —');

absent('no notifications', /new\s+Notification|Notification\.requestPermission|registration\.showNotification/g);
absent('no dialogs', /\b(alert|confirm|prompt)\s*\(/g);
absent('no title flashing', /document\.title\s*=/g);
absent('no audio', /new\s+Audio|AudioContext/g);
absent('it never clicks the game for you', /\.click\(\)/g);

console.log('\n— a jump is a click —');

const pushSites = [...CODE.matchAll(/history\.pushState\s*\(/g)].length;
check('exactly one place navigates', pushSites === 1, `${pushSites} pushState call sites`);
check('...and it carries the router\'s index forward',
  /Number\.isFinite\(st\.idx\)/.test(CODE) && /new PopStateEvent\('popstate', \{ state: history\.state \}\)/.test(CODE),
  'expected the idx-carrying pushState from docs/12-navigation-surface.md');
check('...reachable only from a click handler',
  /addEventListener\('click', \(\) => jump\(href\)\)/.test(CODE),
  'expected jump() to be wired to a click and nothing else');
const jumpCalls = [...CODE.matchAll(/(?<![\w.])jump\s*\(/g)].length;
check('...and invoked from nowhere else',
  jumpCalls === 1, `${jumpCalls} jump( call site(s); expected only the click handler`);
// The route wrapper calls through to the original before looking; it must not navigate.
check('the route watcher only observes',
  /orig\.apply\(this, a\);\s*queueMicrotask\(checkRoute\)/.test(CODE),
  'expected the pushState wrapper to call through and then merely re-sync');

console.log('\n— every change keeps its window —');

// The bracket is the product. A row without one is a claim the tool cannot support.
check('an event always carries both ends of its window',
  /t0: prior\.t, t1: now/.test(CODE),
  'expected diffField to stamp t0 from the last CONFIRMED reading and t1 from this one');
check('...and an agreeing reading advances the confirmation clock',
  /if \(prior\.v === next\) \{ prior\.t = now; return null; \}/.test(CODE),
  'without this, a change is bracketed back to first sighting and every window is too wide');
check('...and the panel prints it on every row',
  /const w = bracketOf\(e\);/.test(CODE) && /n\.append\(line\)/.test(CODE),
  'expected the window line to be appended unconditionally, not behind a flag');
check('a missing field is not a change',
  /if \(next == null\) return null;/.test(CODE),
  'a feed that omits a field would otherwise read as that field being cleared');

console.log('\n— the ledger keeps only what the header claims —');

// A lobbying job carries people. The disclosure says status only; pin the shape.
const JOBREC = CODE.slice(CODE.indexOf('const rec = {'), CODE.indexOf('const had = data.jobs[id];'));
check('a stored job keeps no person',
  JOBREC.length > 0 && !/assigned_username|assigned_user_id|slots|committed/.test(JOBREC),
  `the stored job record reads: ${JOBREC.replace(/\s+/g, ' ').slice(0, 160)}`);
check('...and only the fields the header lists',
  /policy: str\(j\?\.target_policy_name\)/.test(JOBREC) && /status,/.test(JOBREC),
  'expected policy / direction / status / cycle / outcome and nothing else');
check('freshness is recorded only for declared paths',
  /if \(!known\) return;\s*\n\s*data\.seen\[seenKey\(path\)\] = now;/.test(CODE),
  'a blanket seen[path] would log every route the app touched, usernames included');

console.log('\n— it cannot grow without bound —');

check('the change ledger is capped', /if \(data\.events\.length > CAP\.events\)/.test(CODE),
  'expected trimEvents() to hold data.events at CAP.events');
check('the job list is capped', /ids\.length > CAP\.jobs/.test(CODE), 'expected a cap on data.jobs');
check('a failed write is survivable', /catch \(e\) \{ log\('write fail \(quota\?\)'/.test(CODE),
  'expected the quota-tolerant writeJSON');

console.log('\n— storage stays in its own namespace —');
{
  const keys = [...CODE.matchAll(/['"`](pk[a-z]{0,4}:[a-z]*)['"`]/g)].map((m) => m[1]);
  check('every storage key is ours', keys.length > 0 && keys.every((k) => k.startsWith('pkgw:')),
    `foreign keys: ${keys.filter((k) => !k.startsWith('pkgw:')).join(', ')}`);
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

  const literals = [...CODE.matchAll(/['"`](\/api\/[a-z0-9/_{}-]*)['"`]/gi)].map((m) => m[1]);
  const regexed = [...CODE.matchAll(/\/\^\\\/api((?:\\\/[a-z0-9_-]+|\\\/\[\^\\?\/\]\+|\\\/\(\[\^\\?\/\]\+\))+)/gi)]
    .map((m) => `/api${m[1].replace(/\\\//g, '/').replace(/\[\^\/?\]\+|\(\[\^\/?\]\+\)/g, '{id}')}`);

  const recognised = [...new Set([...literals, ...regexed].map(norm))]
    .filter((p) => p !== '/api' && p !== '');
  check('the code recognises the endpoints we think it does', recognised.length === 3,
    `${recognised.length}: ${recognised.join(', ')}`);

  const declared = [...HEADER.matchAll(/(\/api\/[a-z0-9/_{}<>-]*)/gi)].map((m) => norm(m[1]));
  const undeclared = recognised.filter((p) => !declared.includes(p));
  check('every endpoint the code reads is named in the disclosure', undeclared.length === 0,
    `missing from the header: ${undeclared.join(', ')}`);

  check('the disclosure still claims zero added requests',
    /ZERO additional requests to politiko\.io/.test(HEADER), 'the header no longer makes the claim this file fences');
  check('...and still says what it stores', /Storage:\s+localStorage keys prefixed `pkgw:`/.test(HEADER),
    'expected the Storage line');
  check('...and that it never writes to the game',
    /Writes:\s+nothing to the game/.test(HEADER),
    'this tool reads the screen where lobbying is bought — the header must say it never buys any');
  check('...and that a job is read for status only',
    /Lobbying jobs are read for STATUS ONLY|read for STATUS ONLY/.test(HEADER),
    'the header must be explicit about the one payload here that carries other people');
  check('...and that it cannot see a change it was not looking at',
    /BETWEEN two readings/.test(HEADER),
    'the header must state the limitation the whole tool is shaped around');
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
