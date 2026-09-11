// A fence around tools/collect-stores.js.
//
// The collector is the one file in this repo whose whole purpose is to move data OUT of
// the browser, so it is the one file where "it only reads our own stores" has to be a
// property of the code rather than a sentence in a header.
//
// Four things it exists to hold:
//
//   The key filter stays anchored. `/^(pk[a-z]{2,4}:)/` cannot match `auth` or
//   `device_signals`; an unanchored version matching anywhere in the key can, and the
//   difference is one character. docs/01-rules-envelope.md puts both keys on a never-touch
//   list, and since the 2026-09-03 build `auth` also carries the account's fedded state —
//   so a bundle that swept it up would be exporting a token AND a moderation record.
//
//   It originates nothing. A collector is the natural place for someone to add "refresh
//   everything first, then dump" — which is the exact line docs/01-rules-envelope.md
//   draws, and it would convert a passive exporter into a scraper of pages nobody is
//   viewing. There is no network API in this file, and this test is why it stays that way.
//
//   It writes nothing back. Reading a store is safe; a bug that writes one corrupts the
//   readings of a tool that has no idea this file exists.
//
//   The scrub drops credentials and keeps readings. The first bundle ever collected
//   (2026-09-11) had 28 redactions and every one was a false positive — `canvass` for
//   `canvas`, `secretary` for `secret`, a counter under `/api/refresh` — so the file is
//   RUN here against a stub store holding both kinds, and the test asks for each by name.
//
// Run: node userscripts/tools/test-collect.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FILE = path.join(__dirname, '..', '..', 'tools', 'collect-stores.js');
const SRC = fs.readFileSync(FILE, 'utf8');

// The disclosure block names what the tool promises NOT to do, so it trips every check
// written here unless it is held apart from the code.
const SPLIT = SRC.indexOf('(() => {');
const HEADER = SRC.slice(0, SPLIT);
const CODE = SRC.slice(SPLIT)
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

absent('it never fetches', /(?<![.\w])fetch\s*\(/g);
absent('it never constructs an XHR', /new\s+XMLHttpRequest/g);
absent('it never opens a socket', /new\s+WebSocket|new\s+EventSource/g);
absent('it never beacons', /sendBeacon/g);
absent('it never injects a fetching element',
  /new\s+Image\(|createElement\(\s*['"`](script|img|iframe|object|embed|link)|createElementNS\(\s*[^,]+,\s*['"`](script|img|iframe|object|embed|link)/g);
absent('it never imports at runtime', /\bimport\s*\(/g);
absent('it names no write verb', /method:\s*['"`](POST|PUT|PATCH|DELETE)/gi);
absent('it never notifies', /Notification|showNotification|serviceWorker/g);

console.log('\n— the key filter is anchored —');

const prefix = CODE.match(/const\s+PREFIX\s*=\s*(\/[^\n]*?\/[gimsuy]*)\s*;/);
check('PREFIX is declared', !!prefix, 'expected a `const PREFIX = /.../` declaration');
check('...and is anchored at the start of the key',
  !!prefix && prefix[1].startsWith('/^'),
  `PREFIX is ${prefix ? prefix[1] : '(missing)'} — an unanchored filter matches auth-like keys mid-string`);
check('...and requires the pk sigil plus a colon',
  !!prefix && /\^\(?pk/.test(prefix[1]) && prefix[1].includes(':'),
  'the filter has to name the repo\'s own prefix shape, not any key');

if (prefix) {
  // The filter is the safety argument, so exercise it rather than trusting the shape.
  const re = new RegExp(prefix[1].slice(1, prefix[1].lastIndexOf('/')));
  const mustMiss = ['auth', 'device_signals', 'AUTH', 'x-pkaw:', 'theme', 'politiko_push_preferences'];
  const mustHit = ['pkaw:ui', 'pkxp:ledger', 'pkww:readings'];
  check('...so the never-touch keys cannot match it',
    mustMiss.every((k) => !re.test(k)),
    `matched: ${mustMiss.filter((k) => re.test(k)).join(', ')}`);
  check('...and this repo\'s own keys still do',
    mustHit.every((k) => re.test(k)),
    `missed: ${mustHit.filter((k) => !re.test(k)).join(', ')}`);
}

console.log('\n— the never-touch keys are named and never read —');

check('auth and device_signals are on an explicit denylist',
  /const\s+NEVER\s*=\s*\[[^\]]*'auth'[^\]]*'device_signals'[^\]]*\]/.test(CODE),
  'docs/01-rules-envelope.md names both; the denylist has to name them too');
absent('it never reads a key by that name',
  /getItem\(\s*['"`](auth|device_signals)|localStorage\.(auth|device_signals)|localStorage\[\s*['"`](auth|device_signals)/g);

console.log('\n— it writes nothing back —');

absent('it never writes a store', /setItem\(|removeItem\(|localStorage\.clear\(/g);
check('it reads the store only by index and by key',
  /localStorage\.key\(/.test(CODE) && /localStorage\.getItem\(/.test(CODE),
  'expected localStorage.key(i) + getItem(key) and nothing else');

console.log('\n— it does not widen past our own stores —');

absent('it never reaches into the app\'s query cache',
  /queryClient|__REACT_QUERY|getQueryData|queryCache/g);
absent('it never reads the DOM for data', /querySelector|getElementsBy|innerText|textContent\s*[^=]/g);
absent('it never reads a cookie', /document\.cookie/g);

console.log('\n— run against a stub store: what it keeps, what it drops —');

// One stub store with every shape the scrub has to get right. The three keys that must
// never be read are here with recognisable payloads, so a leak is greppable in the output;
// the three keys that were wrongly redacted on 2026-09-11 are here verbatim; and `pkxx:probe`
// holds the credential names that MUST still be dropped alongside readings that must not.
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop';
const STORE = {
  auth: JSON.stringify({ accessToken: JWT, fedded: false, username: 'LEAK-auth' }),
  device_signals: '{"canvas":"LEAK-device-signals"}',
  theme: 'dark',
  'pkxp:ledger': JSON.stringify({
    me: 'someone',
    actStats: { '/actions/sleeper-recruitment/canvass': { n: 3, outcomes: { success: 2 } } },
  }),
  'pkmw:ids': JSON.stringify({
    'corporations/Zebulon & Zyklon Law/Slutty secretary': { id: 5, sure: true },
    'actions/sleeper-recruitment/canvass/#584': { id: 584, sure: false },
  }),
  'pkww:data': JSON.stringify({ seen: { '/api/refresh': 12, '/api/time': 3 } }),
  'pkxx:probe': JSON.stringify({
    refresh_token: 'drop-1', refreshToken: 'drop-2', accessToken: 'drop-3', 'x-csrf-token': 'drop-4',
    authorization: 'drop-5', client_secret: 'drop-6', password: 'drop-7', canvasHash: 'drop-8',
    fingerprint: 'drop-9', jwt: 'drop-10', nested: { cookie: 'drop-11', keep: 'keep-nested' },
    opaque: 'A'.repeat(48),
    note: 'keep-note', count: 7, flag: true, secretary: 'keep-secretary', canvass: 'keep-canvass',
    refreshed_at: 'keep-refreshed-at', tokens_left: 4,
  }),
};

const clicks = [];
const blobs = [];
const created = [];
const anchor = (ns, tag) => { const el = { ns, tag, click() { clicks.push(el); } }; created.push(el); return el; };
const sandbox = {
  localStorage: {
    get length() { return Object.keys(STORE).length; },
    key: (i) => Object.keys(STORE)[i] ?? null,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : null),
  },
  location: { origin: 'https://politiko.io' },
  URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:stub'; }, revokeObjectURL: () => {} },
  Blob: class { constructor(parts, opts) { this.text = parts.join(''); this.type = opts && opts.type; } },
  document: {
    createElementNS: (ns, tag) => anchor(ns, tag),
    createElement: (tag) => anchor(null, tag),
  },
  setTimeout: () => 0,
  console: { log() {}, table() {}, warn() {} },
};

let summary = null, bundle = null, runErr = null;
try {
  summary = vm.runInNewContext(SRC, sandbox, { filename: FILE });
  bundle = JSON.parse(blobs[0].text);
} catch (e) { runErr = e; }

check('the file runs against a stub localStorage', !runErr && !!bundle, runErr ? String(runErr && runErr.stack) : 'no blob was written');

if (bundle) {
  const out = JSON.stringify(bundle);
  check('the three foreign keys are counted, not read',
    bundle.stats.keys_skipped === 3 && bundle.stats.keys_read === 4,
    `keys_skipped=${bundle.stats.keys_skipped} keys_read=${bundle.stats.keys_read}`);
  check('...and nothing from them reaches the output',
    !out.includes('LEAK-') && !out.includes(JWT) && !('auth' in bundle.tools) && !Object.keys(bundle.tools).some((p) => !/^pk[a-z]{2,4}:$/.test(p)),
    'a never-touch key\'s payload is in the bundle');

  const xp = bundle.tools['pkxp:'] && bundle.tools['pkxp:'].keys.ledger;
  const mw = bundle.tools['pkmw:'] && bundle.tools['pkmw:'].keys.ids;
  const ww = bundle.tools['pkww:'] && bundle.tools['pkww:'].keys.data;
  const probe = bundle.tools['pkxx:'] && bundle.tools['pkxx:'].keys.probe;

  check('canvass is not canvas: the XP record of the sleeper action survives',
    !!xp && xp.actStats['/actions/sleeper-recruitment/canvass'] && xp.actStats['/actions/sleeper-recruitment/canvass'].n === 3,
    `got ${JSON.stringify(xp && xp.actStats)}`);
  check('secretary is not secret: the corporation job id survives',
    !!mw && mw['corporations/Zebulon & Zyklon Law/Slutty secretary'] && mw['corporations/Zebulon & Zyklon Law/Slutty secretary'].id === 5
      && mw['actions/sleeper-recruitment/canvass/#584'] && mw['actions/sleeper-recruitment/canvass/#584'].id === 584,
    `got ${JSON.stringify(mw)}`);
  check('a counter under a credential-shaped name is a number and passes',
    !!ww && ww.seen['/api/refresh'] === 12 && ww.seen['/api/time'] === 3,
    `got ${JSON.stringify(ww && ww.seen)}`);

  const dropped = ['refresh_token', 'refreshToken', 'accessToken', 'x-csrf-token', 'authorization',
    'client_secret', 'password', 'canvasHash', 'fingerprint', 'jwt'];
  check('every credential-named string is dropped',
    !!probe && dropped.every((k) => probe[k] === '[redacted]') && probe.nested && probe.nested.cookie === '[redacted]',
    `still present: ${probe ? dropped.filter((k) => probe[k] !== '[redacted]').join(', ') : '(no probe)'}`);
  check('...a nested sibling under the same parent is not',
    !!probe && probe.nested && probe.nested.keep === 'keep-nested',
    'redacting a key must not take its siblings with it');
  check('...an opaque 48-character value is dropped by shape',
    !!probe && typeof probe.opaque === 'string' && probe.opaque.startsWith('[redacted 48'),
    `got ${probe && probe.opaque}`);
  check('...and readings whose names merely CONTAIN a credential word are kept',
    !!probe && probe.note === 'keep-note' && probe.count === 7 && probe.flag === true
      && probe.secretary === 'keep-secretary' && probe.canvass === 'keep-canvass'
      && probe.refreshed_at === 'keep-refreshed-at' && probe.tokens_left === 4,
    `got ${JSON.stringify(probe)}`);
  check('the redaction list names exactly the drops, with a reason each',
    bundle.redactions.length === 12 && bundle.redactions.every((r) => r.path && /^(key name|value shape)$/.test(r.why)),
    `${bundle.redactions.length} redactions: ${bundle.redactions.map((r) => r.path).join(', ')}`);
  check('nothing dropped leaks through its own path list',
    !out.includes('drop-'),
    'a redacted value is still somewhere in the output');

  check('the download is one XHTML anchor, so an SVG page can run it',
    clicks.length === 1 && clicks[0].tag === 'a' && clicks[0].ns === 'http://www.w3.org/1999/xhtml'
      && created.length === 1 && blobs.length === 1 && blobs[0].type === 'application/json',
    `clicks=${clicks.length} created=${created.map((e) => `${e.ns}:${e.tag}`).join(',')} blob=${blobs[0] && blobs[0].type}`);
  check('...named politiko-stores-<stamp>.json',
    /^politiko-stores-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.json$/.test(clicks[0] && clicks[0].download),
    `download=${clicks[0] && clicks[0].download}`);
  check('the return value is a summary, never the bundle',
    !!summary && summary.name === clicks[0].download && summary.written === blobs[0].text.length
      && Array.isArray(summary.tools['pkxx:'].keys) && summary.tools['pkxx:'].keys[0] === 'probe'
      && !JSON.stringify(summary).includes('keep-') && !JSON.stringify(summary).includes('someone'),
    `summary=${JSON.stringify(summary).slice(0, 200)}`);
}

console.log('\n— the disclosure matches the build —');

check('the header states zero requests',
  /ZERO\.?\s/.test(HEADER) && /Requests:/.test(HEADER),
  'clause 6: the request budget has to be stated');
check('...and states that it writes nothing',
  /Writes:\s*nothing/.test(HEADER),
  'clause 6: a tool that could write has to say it does not');
check('...and names the filter it reads by',
  /\^pk\[a-z\]\{2,4\}:/.test(HEADER),
  'clause 6: storage read has to be disclosed precisely, not as "our keys"');
check('...and names both never-touch keys',
  /device_signals/.test(HEADER) && /`auth`/.test(HEADER),
  'the two keys this file must not read are the two worth naming');
check('...and refuses the refresh feature in writing',
  /does not refresh/i.test(HEADER),
  'the feature this file will keep being asked for has to be refused where it is read');
check('...and says the output is not transmitted',
  /Nothing is transmitted/.test(HEADER),
  'a file that produces a download has to say where it goes');
check('...and discloses the scrub as whole tokens, numbers exempt',
  /Scrubs:/.test(HEADER) && /whole token/i.test(HEADER) && /Numbers and booleans are never redacted/.test(HEADER),
  'a redaction is a change to the reading, so the rule has to be stated where it is read');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
