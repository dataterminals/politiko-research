// A fence around tools/collect-stores.js.
//
// The collector is the one file in this repo whose whole purpose is to move data OUT of
// the browser, so it is the one file where "it only reads our own stores" has to be a
// property of the code rather than a sentence in a header.
//
// Three things it exists to hold:
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
// Run: node userscripts/tools/test-collect.js
const fs = require('fs');
const path = require('path');
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
  /new\s+Image\(|createElement\(\s*['"`](script|img|iframe|object|embed|link)/g);
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

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
