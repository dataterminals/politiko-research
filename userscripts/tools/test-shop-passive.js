// A fence around shop-watch.
//
// This tool sits closer to the line than anything else in the repo, because the thing it
// was asked for is the thing the scripting clause names. The request was "notify me when
// the shops refresh." Three separate prohibitions live inside that sentence:
//
//   Polling. A stock number only changes on the server, so knowing it changed means
//   calling the store endpoint again. There is no socket event and no push. Every tab in
//   this panel can print "no reading yet", and every one of those is one lazy edit away
//   from "just fetch the store on boot" — clause 1 and clause 5, in one line.
//
//   The unfocused page. A shop you are not standing in is a page you are not viewing.
//   Clause 2 covers scraping it; there is no version of a background stock check that is
//   not that.
//
//   The alert. Clause 4 bans pulling from an unfocused page to raise an alert or draw
//   attention to another window. A desktop notification here is not a gray area, it is
//   the clause's own worked example. So this file must contain no notification API at
//   all — not disabled, not behind a flag, absent.
//
// Two more things specific to a tool that reads a shop:
//
//   The counter. BuildingPage posts to buy and to sell. Those shapes belong in docs/15,
//   not in this file, and market-watch's seam was deleted for exactly this reason on
//   2026-08-07. A tool that knows the purchase shape is one edit from using it.
//
//   The bracket. Every restock row claims a refill happened between two readings. The
//   panel must never print one as a moment, because a window is the difference between a
//   measurement and a guess.
//
// Run: node userscripts/tools/test-shop-passive.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'shop-watch.user.js');
const SRC = fs.readFileSync(FILE, 'utf8');

// The disclosure block names what the tool promises NOT to do, so it has to be held
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

console.log('\n— it knows no way to spend money —');

// BuildingPage's two mutations. Neither path nor either payload key may appear: knowing
// the shape is the whole of the distance between a reader and a bot.
absent('it does not know the purchase path', /stores\/[^'"`\s]*\/buy|\/buy['"`]/g);
absent('it does not know the sell mutation', /player_item_id\s*:/g);
absent('it does not know either payload key', /\bitem_def_id\s*:\s*[^,}\s]|\bqty\s*:\s*[^,}\s]/g);
absent('it names no purchase verb', /\bpurchase\s*\(|\bbuyItem|\bsellItem|\bplaceOrder/g);

console.log('\n— it raises nothing —');

// Clause 4, and the reason this tool exists in the shape it does. Not "off by default":
// the APIs are not referenced at all.
absent('it never notifies', /new\s+Notification|Notification\s*\.\s*(requestPermission|permission)|showNotification/g);
absent('it never registers a worker', /serviceWorker|pushManager|PushManager/g);
absent('it never plays a sound', /new\s+Audio\(|AudioContext|\.play\s*\(\)/g);
absent('it never pokes the title bar', /document\.title\s*=/g);
absent('it never takes focus', /window\.focus\s*\(|\.blur\s*\(\)|alert\s*\(/g);
check('the disclosure says so in as many words',
  /Alerts:\s*none/i.test(HEADER),
  'the header must state that this tool raises no alerts');

console.log('\n— nothing runs on its own —');

// A timer here may draw. It may not reach the network, and it may not run while hidden:
// a redraw in a background tab is the first half of alerting from one.
const NAVISH = /fetch|XMLHttpRequest|pushState|PopStateEvent|location\s*\.|consume\s*\(/;
const bodies = [...CODE.matchAll(/set(?:Timeout|Interval)\s*\(([\s\S]{0,260})/g)].map((m) => m[1]);
check('no timer touches the network or navigates',
  bodies.every((b) => !NAVISH.test(b)),
  `suspect timer body: ${bodies.find((b) => NAVISH.test(b))?.slice(0, 120)}`);
check('...and the repainting one is gated on the tab being visible',
  bodies.filter((b) => /render\s*\(\)/.test(b)).every((b) => /document\.hidden/.test(b)),
  'a timer that repaints must check document.hidden first');

console.log('\n— it reads responses, never requests —');

const WRAP = CODE.slice(CODE.indexOf('const origFetch = window.fetch;'), CODE.indexOf('PANEL KIT v2'));
check('the wrapper never looks at the second argument',
  !/args\[1\]/.test(WRAP) && !/\binit\b/.test(WRAP),
  'the fetch wrapper reads args[1] — that is the request body and headers');
check('...and clones before reading, so the app still gets its body',
  /res\.clone\(\)\.json\(\)/.test(WRAP),
  'expected res.clone().json() — reading the original drains it out from under the game');
absent('it never reads the auth key', /['"`]auth['"`]\s*\)|getItem\(\s*['"`]auth/g);

// The five fingerprint headers are how multi-accounting is enforced. A passive tap sees
// them; touching them is indistinguishable from evading that enforcement.
absent('it never touches the fingerprint headers', /X-CT-(TZ|Screen|Lang|Platform|Canvas)/gi);

console.log('\n— it takes one field from the player —');

// The disclosure promises current_location.name and nothing else out of /api/user/*.
// The code has to keep that promise in the shape of what it reads, not just in prose.
const USER = CODE.slice(CODE.indexOf("path.startsWith('/api/user/')"), CODE.indexOf("if (path === '/api/city')"));
check('the user branch reads current_location.name and returns',
  /current_location\?\.name/.test(USER) && /return;/.test(USER),
  'the /api/user branch must take one string and stop');
check('...and nothing else in the file reads a user field',
  (CODE.match(/current_location/g) || []).length === 1
    && !/\b(cash|money|balance|energy|juice|\bhp\b|email|user_id)\s*[:.]/.test(USER),
  'a second user field appeared outside the one the disclosure names');

console.log('\n— a bracket is never a moment —');

check('every restock row carries its window',
  /windowOf\s*\(/.test(CODE) && /t0[\s\S]{0,40}t1/.test(CODE),
  'expected a windowOf() that prints both ends of the bracket');
check('...and the window is built from two readings, not one',
  /const windowOf = \(e\) => `\$\{clock\(e\.t0\)\}/.test(CODE),
  'windowOf must render t0 → t1');
check('null stock is carried as unlimited, not coerced to zero',
  /=== null \|\| .*undefined \? null : Number/.test(CODE) && /'∞'/.test(CODE),
  'stock null means unlimited in this game; folding it to 0 invents a sell-out');

console.log('\n— the shape gate, not a method gate —');

// This is how a listing is consumed without a mutation's result object being consumed,
// with no sight of the request. If it goes, the tool starts reading write responses.
check('store payloads are only consumed when they are arrays',
  /if \(!Array\.isArray\(payload\)\) return;/.test(CODE),
  'expected an Array.isArray gate before a store payload is folded in');

console.log('\n— it stays inside its own storage —');
// First argument only — setItem's second is a JSON.stringify(...) whose own paren would
// otherwise swallow the match and make this check fail on correct code.
const keys = [...CODE.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*([^,)]+)/g)].map((m) => m[1].trim());
check('every localStorage key is one of its own',
  keys.every((k) => /^k$|^K\.(data|ui)$/.test(k)),
  `keys touched: ${keys.join(' | ')}`);

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
