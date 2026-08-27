// A fence around the two properties quick-jump claims absolutely:
//
//   1. it originates no requests to politiko.io, and
//   2. it never surfaces a door the game's own client hides.
//
// This tool is the first in the repo whose whole purpose is to *move you*, which makes
// it the easiest one to spoil. Two ways, specifically:
//
//   Prefetching. A launcher that knows about a casino only after you have paged the
//   directory is an obvious candidate for "just fetch page 1 on boot". That single line
//   would convert a passive tool into a scraper of a page you are not viewing — clause
//   2 and clause 5 of the Scripting Abuse rules, both of them, in one go.
//
//   Chaining. A jump is a navigation the operator asked for. A jump that schedules the
//   next one is a crawler. There is no timer in this file that touches navigation, and
//   this asserts there never will be.
//
// Run: node userscripts/tools/test-quick-jump-passive.js
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'quick-jump.user.js'), 'utf8');

// strip comments, so the disclosure block — which names what it promises to avoid —
// cannot itself trip the fence
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

// The tap owns exactly one reference to the real fetch and calls it once, to pass the
// game's own call through. Any other call site is a request this script invented.
const fetchCalls = [...CODE.matchAll(/(?<![.\w])fetch\s*\(/g)].length;
const passthrough = [...CODE.matchAll(/origFetch\.apply\(/g)].length;
check('the only fetch call is the tap passing the game\'s own through',
  fetchCalls === 0 && passthrough === 1,
  `${fetchCalls} bare fetch( call(s), ${passthrough} passthrough(s); expected 0 and 1`);

absent('it never constructs an XHR', /new\s+XMLHttpRequest/g);
absent('it never opens a socket', /new\s+WebSocket/g);
absent('it never beacons', /sendBeacon|navigator\.sendBeacon/g);
absent('it never injects a fetching element', /new\s+Image\(|createElement\(\s*['"`](script|img|iframe|link)/g);
absent('it names no write verb', /method:\s*['"`](POST|PUT|PATCH|DELETE)/gi);

// `/api/` appears in this file, and should: the tap has to recognise the game's own
// calls to know which ones to read. What must never appear is an /api/ path used as a
// destination. Two shapes are legitimate. A recogniser — .includes()/.startsWith() —
// and, since HTTP TAP v1, a subscription prefix: the shared tap is asked for the paths
// this tool wants and parses nothing else, and naming a path is the whole of that API.
// Prefixes are therefore allowed by identity, collected from the onApi() call itself,
// so a quoted path that is NOT registered still fails. Everything path-shaped that is
// used for matching still has to live in a regex, which cannot be fetched.
const subPrefixes = new Set(
  [...CODE.matchAll(/onApi\(\s*(\[[^\]]*\]|['"`][^'"`]*['"`])/g)]
    .flatMap((m) => [...m[1].matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map((x) => x[1])),
);
check('the tool subscribes to named paths, not to everything',
  subPrefixes.size > 0 && !/onApi\(\s*['"`]\*['"`]/.test(CODE),
  `prefixes: ${[...subPrefixes].join(', ') || 'none'}${/onApi\(\s*['"`]\*['"`]/.test(CODE) ? ' (and a * subscription)' : ''}`);

const apiLiterals = [...CODE.matchAll(/.{16}['"`]\/api\/[^'"`]*['"`]/g)].map((m) => m[0]);
const legit = (s) => /(includes|startsWith)\(\s*['"`]\/api\/['"`]$/.test(s)
  || [...subPrefixes].some((p) => s.endsWith(`'${p}'`) || s.endsWith(`"${p}"`) || s.endsWith(`\`${p}\``));
check('every quoted /api/ is a recogniser or a subscription, not a destination',
  apiLiterals.length > 0 && apiLiterals.every(legit),
  `not a guard: ${apiLiterals.filter((s) => !legit(s)).join(' | ')}`);
check('the path patterns are regexes, which cannot be called',
  /casino:\s*\/\^\\\/api\\\//.test(CODE)
    && [...CODE.matchAll(/['"`](\/api\/corporations[^'"`]*)['"`]/g)].every((m) => subPrefixes.has(m[1])),
  'expected R.* to be regex literals and no quoted /api/corporations path beyond the subscription');

// The XHR wrap must only observe. `open` records the URL, `send` adds a load listener.
check('the XHR wrap only observes',
  /origOpen\.call\(this/.test(CODE) && /origSend\.apply\(this/.test(CODE)
    && !/\.open\s*\(\s*['"`](GET|POST)/i.test(CODE),
  'expected pass-through open/send and no direct .open("GET"…) of our own');

console.log('\n— nothing runs on its own —');

absent('nothing is scheduled to repeat', /setInterval|requestIdleCallback/g);

// A jump is a keypress. A timer that can jump is a crawler, so no timer body may reach
// navigation, the tap, or storage-of-record. quick-jump legitimately owns no timers at
// all today; if one is added it has to stay inert.
const NAVISH = /fetch|XMLHttpRequest|pushState|PopStateEvent|jump\s*\(|dispatch\s*\(|location\s*\./;
const timerBodies = [...CODE.matchAll(/setTimeout\s*\(([\s\S]{0,240})/g)].map((m) => m[1]);
check('every timer body is inert', timerBodies.every((b) => !NAVISH.test(b)),
  timerBodies.filter((b) => NAVISH.test(b)).map((b) => b.slice(0, 80)).join(' | '));
check('...and there are none at all yet', timerBodies.length === 0,
  `found ${timerBodies.length}; if you added one, say what it does here`);

console.log('\n— a jump is a keypress —');

// Navigation exists on purpose, so rather than ban it, pin it: exactly one place may
// navigate, and it must be reachable only from a handler the operator triggered.
const pushes = [...CODE.matchAll(/history\.pushState\(/g)].length;
check('there is exactly one navigation site', pushes === 1, `found ${pushes}`);
check('it carries the router index forward',
  /Number\.isFinite\(st\.idx\)/.test(CODE) && /idx\s*\}/.test(CODE),
  'expected the pushed state to increment history.state.idx — see docs/12-navigation-surface.md');
absent('it never hard-navigates behind your back', /location\.(assign|replace|reload)\s*\(|location\.href\s*=/g);

// every call to jump() must sit in a user-gesture handler
const jumpSites = [...CODE.matchAll(/[^.\w]jump\s*\(/g)].length;
const jumpDef = [...CODE.matchAll(/const jump = /g)].length;
check('jump is called only from handlers, and defined once',
  jumpDef === 1 && jumpSites >= 2,
  `${jumpDef} definition(s), ${jumpSites} call site(s)`);
const orphan = /(setTimeout|setInterval|then\s*\(\s*\(\)\s*=>\s*jump)/.test(CODE);
check('no jump is deferred or chained', !orphan, 'a scheduled jump is a crawler');

console.log('\n— it hides what the game hides —');

// The lobby filters craps out of the only screen that would link to it. Whatever the
// reason, routing around it is not ours to do. The only mention of craps in this file
// must be the denylist that excludes it.
const crapsHits = [...CODE.matchAll(/craps/gi)].map((m) => CODE.slice(Math.max(0, m.index - 60), m.index + 20));
check('craps appears only in the hidden-games denylist',
  crapsHits.length === 1 && /HIDDEN_GAMES\s*=\s*new Set\(\[\s*'craps'/.test(CODE),
  `${crapsHits.length} mention(s): ${crapsHits.map((h) => h.replace(/\s+/g, ' ').slice(-50)).join(' | ')}`);
check('the denylist is actually applied',
  /HIDDEN_GAMES\.has\(/.test(CODE), 'expected liveGames() to filter on HIDDEN_GAMES');

console.log('\n— it reads only its own storage —');

// Storage goes through two helpers, so the property to hold is that those are the only
// two touch points and that nothing ever names a key they were not given.
const lsSites = [...CODE.matchAll(/localStorage\.(getItem|setItem|removeItem|clear)\b/g)].map((m) => m[1]);
check('localStorage is touched in exactly two places',
  lsSites.length === 2 && lsSites.includes('getItem') && lsSites.includes('setItem'),
  `sites: ${lsSites.join(', ')}`);
const helperArgs = [...CODE.matchAll(/\b(?:readJSON|writeJSON)\(\s*([A-Za-z.]+)/g)].map((m) => m[1]);
check('every key handed to them is a K.* constant',
  helperArgs.length >= 6 && helperArgs.every((a) => a.startsWith('K.')),
  `args: ${helperArgs.join(' | ')}`);
absent('it never reads the game\'s auth blob', /getItem\(\s*['"`]auth/g);
check('all three key names are namespaced',
  (CODE.match(/'pkqj:[a-z]+'/g) || []).length === 3,
  `found ${(CODE.match(/'pkqj:[a-z]+'/g) || []).length}`);

console.log('\n— it stays auditable —');

check('@grant none', /@grant\s+none/.test(SRC), 'any other grant sandboxes window and blinds the tap');
check('the disclosure block names Requests: ZERO', /Requests:\s*ZERO/.test(SRC), 'clause 6');
check('PANEL KIT v2 is present', /PANEL KIT v2 — shared verbatim block/.test(SRC), 'panels must be movable');
check('the panel is resizable', SRC.includes('panelResize = resizable(panelEl,'),
  'CLAUDE.md: every window this repo draws is resizable, not just movable');
// 0.2.0: a destination click no longer closes the panel, so walking a set costs one
// keypress each instead of a reopen and a retype. If a toggle(false) ever creeps back
// into jump(), that is the regression — nothing else in the file can cause it.
check('the panel stays open across a jump',
  !/const jump = [\s\S]{0,1200}toggle\(false\)/.test(SRC),
  'jump() closes the panel again — 0.2.0 exists to stop exactly that');
check('...and repaints instead, so recents and the current row are not left stale',
  /const jump = [\s\S]{0,1200}\n {4}paint\(\);/.test(SRC),
  'a jump that neither closes nor repaints leaves a lying list on screen');
check('fit() runs after render', /panelDrag\.fit\(\)/.test(CODE), 'an off-screen handle is unrecoverable');
absent('no hashed chunk name is hardcoded', /-[A-Za-z0-9_-]{8}\.js/g);
absent('it sends nothing anywhere', /https?:\/\/(?!politiko\.io|raw\.github|github\.com)/g);

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
