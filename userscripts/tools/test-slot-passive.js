// A fence around slot-watch.
//
// This tool sits on the one screen in the game where a script that originates a request
// is not merely against the rules but obviously, immediately profitable-looking — the
// spin is a POST, the game itself ships a loop that fires up to a hundred of them, and
// the whole panel is about the money coming out the other end. Everything below exists to
// keep the distance between reading that and doing it from ever being one edit wide.
//
//   It must not know how to spin. `market-watch`'s order-execution seam was deleted on
//   2026-08-07 under exactly this reasoning (docs/01-rules-envelope.md): sizing a trade is
//   arithmetic on data the game already sent, placing one is a request, and the line
//   belongs between them. A tool that carries the endpoint and the payload shape is a bot
//   with the last line commented out. So the spins path, the idempotency key and the
//   request body shape are absent from the file — not disabled, absent.
//
//   And there is no argument for adding it. The rules envelope says to reach first for
//   something that removes the need to originate a request. Here the game has already
//   done it: auto-spin is a shipped, server-blessed, client-side loop with 10/25/50/100
//   presets. There is no tedium left for a script to relieve, which is why this tool is
//   allowed to be purely a reader and why it must stay one.
//
//   It must not be able to tell a GET from a POST. That is not a slogan — it is enforced
//   below. The tool's own code never reads the method or the request body off a tap
//   record, and recognises a settlement receipt BY SHAPE. That is what lets it consume
//   the response to a spin YOU pressed without ever containing the means to press one.
//
//   It must raise nothing. Every figure in this panel is about money, which makes it the
//   most tempting thing in the repo to shout about from a background tab. Clause 4 names
//   that case. Nothing here writes the title, the favicon, a sound, or a notification, and
//   the Notification API is absent rather than off.
//
//   It must not launder an estimate into a fact. The panel makes exact claims and
//   estimated ones and they are not interchangeable — tools/test-slot-ev.js drives the
//   arithmetic, and the checks at the end of this file hold the labelling honest: the band
//   carries its sample count, nothing computes a probability, and no clock claims to know
//   when a session was played, because nothing on this surface carries a timestamp.
//
// Run: node userscripts/tools/test-slot-passive.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'slot-watch.user.js');
const SRC = fs.readFileSync(FILE, 'utf8');

// The disclosure block names what the tool promises NOT to do, so it has to be held
// apart from the code or it trips every check written here.
const HEADER = SRC.slice(0, SRC.indexOf('(() => {'));
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

// The tool's OWN code: everything that is not a copy-verbatim shared block. HTTP TAP
// legitimately reads a method and a request body — that is what a tap is — so a check
// about what this tool reads has to be asked of this tool's lines and not of the kit's.
const without = (src, from, to) => {
  const i = src.indexOf(from);
  const j = src.indexOf(to, i);
  if (i < 0 || j <= i) throw new Error(`shared block not found: ${from.slice(0, 48)}`);
  return src.slice(0, i) + src.slice(j + to.length);
};
const MINE = without(
  without(CODE, 'const HTTP_TAP_VERSION = 1;', 'return api.subscribe;'),
  'const draggable = (node, handle, onMove)', 'sized: () => !!mine,',
);

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        ${detail}`); fail++; }
};
const absent = (label, re, src) => {
  const hits = (src || CODE).match(re) || [];
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

absent('it never constructs an XHR', /new\s+XMLHttpRequest/g);
absent('it never opens a socket', /new\s+WebSocket|new\s+EventSource/g);
absent('it never beacons', /sendBeacon/g);
absent('it never injects a fetching element',
  /new\s+Image\(|createElement\(\s*['"`](script|img|iframe|link|object|embed)/g);
absent('it never imports at runtime', /\bimport\s*\(/g);
absent('it names no write verb', /method:\s*['"`](POST|PUT|PATCH|DELETE)/gi);
absent('it builds no request body', /\bbody:\s*(JSON\.stringify|new\s+FormData|new\s+URLSearchParams)/g);

console.log('\n— it knows no way to place a spin —');

// The mutation the whole page exists to fire. Neither the path nor either payload key may
// appear anywhere: knowing the shape is the whole of the distance between a reader and a
// bot, and the game already ships the auto-spin loop that would be the only excuse.
absent('it does not know the spin endpoint', /\/spins\b|slots\/spins/g);
absent('it does not know the idempotency key', /idempotency/gi);
absent('it does not know the request payload shape', /\btotal_wager\s*:\s*[^,}\s]/g);
absent('it names no spin verb', /\bplaceSpin|\bdoSpin|\bautoSpin|\bspinRequest|slots:spin/g);

// The only /api/ path in the tool's own code is the prefix it subscribes to. A second one
// is either a new subscription that the disclosure does not cover, or a call.
const apiStrings = [...MINE.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map((m) => m[1]);
check('it names exactly one API path, and it is a prefix',
  apiStrings.length === 1 && apiStrings[0] === '/api/corporations/',
  `api paths named: ${apiStrings.join(' | ') || '(none)'}`);

// It does know the slots PAGE route — that is how it tells which table you are looking at
// — and a route is not an endpoint. Worth asserting so the difference stays deliberate.
check('the casino route it knows is a page, not an endpoint',
  /const ROUTE = \/\^\\\/corporations\\\/\(\\d\+\)\\\/casino\\\/slots/.test(MINE)
    && !/['"`][^'"`]*api[^'"`]*casino/.test(MINE),
  'the only casino path may be the page route used to identify the table in view');

console.log('\n— it cannot tell a GET from a POST —');

// This is the property that lets it consume the receipt for a spin you pressed without
// containing the means to press one. It is a real constraint on the code, so it is
// checked as one rather than asserted in prose.
check('the tap record is destructured to the path and the parsed body, and nothing else',
  /const consume = \(\{ path, data: payload \}\) =>/.test(MINE),
  'consume() must take { path, data } only');
absent('it never reads the method off a record', /\.method\b|\bmethod\b/g, MINE);
absent('it never reads the request body off a record', /(?<!document)\.body\b/g, MINE);
absent('it never reads a status or an ok flag', /\.status\b|\brec\.ok\b/g, MINE);

// The shape gate, and the reason none of the above costs it anything.
check('a session is recognised by its six settlement fields',
  /const RECEIPT = \['id', 'total_wager', 'spin_count', 'gross_payout', 'tax_amount', 'net_payout'\];/.test(CODE)
    && /RECEIPT\.every\(\(k\) => num\(o\[k\]\) !== null\)/.test(CODE),
  'expected a shape gate over the six rendered receipt fields');
check('...and a config by the two fields only a table has',
  /num\(d\.slots_min_bet\) !== null && num\(d\.theoretical_rtp_bps\) !== null/.test(CODE),
  'expected a shape gate for the table config too');

console.log('\n— it raises nothing —');

// Clause 4's own worked example. Not off, not behind a flag: absent.
absent('it never notifies', /Notification|showNotification/g);
absent('it never registers a worker', /serviceWorker|pushManager|PushManager/g);
absent('it never plays a sound', /new\s+Audio\(|AudioContext|createOscillator/g);
absent('it never pokes the title bar', /document\.title\s*=/g);
absent('it never swaps the favicon', /rel=['"`]?icon|shortcut icon/gi);
absent('it never takes focus', /window\.focus\s*\(|\.blur\s*\(\)|alert\s*\(/g);
check('the disclosure says so in as many words',
  /Alerts:\s*none/i.test(HEADER),
  'the header must state that this tool raises no alerts');

console.log('\n— nothing runs on its own —');

// One timer, and it changes a button's label. It may not reach the network, navigate, or
// repaint — a redraw on a schedule is the first half of alerting from a background tab.
const NAVISH = /fetch|XMLHttpRequest|pushState|PopStateEvent|location\s*\.|consume\s*\(|render\s*\(/;
const bodies = [...CODE.matchAll(/set(?:Timeout|Interval)\s*\(([\s\S]{0,260})/g)].map((m) => m[1]);
check('there is exactly one timer in the file', bodies.length === 1, `${bodies.length} found`);
check('...and it touches nothing but a label',
  bodies.every((b) => !NAVISH.test(b)),
  `suspect timer body: ${bodies.find((b) => NAVISH.test(b))?.slice(0, 120)}`);

// Repaints are coalesced onto an animation frame, which a hidden tab does not run — so
// the panel cannot spin in the background even by accident.
check('repaints are coalesced onto a frame, not a schedule',
  /requestAnimationFrame\(\(\) => \{ pending = 0; render\(\); \}\)/.test(CODE)
    && /if \(pending\) return;/.test(CODE),
  'expected a single-flight requestAnimationFrame coalescer');

console.log('\n— it reads responses, never requests —');

check('it subscribes to one path prefix by name, not to everything',
  /onApi\('\/api\/corporations\/', consume\)/.test(CODE) && !/onApi\(\s*'\*'/.test(CODE),
  'a * subscriber opts the whole repo back into parsing every response');
absent('it never reads the auth key', /['"`]auth['"`]\s*\)|getItem\(\s*['"`]auth/g);
absent('it never reads the device fingerprint', /device_signals/g);

// The five fingerprint headers are how multi-accounting is enforced. A passive tap sees
// them; touching them is indistinguishable from evading that enforcement.
absent('it never touches the fingerprint headers', /X-CT-(TZ|Screen|Lang|Platform|Canvas)/gi);

console.log('\n— an estimate is never printed as a fact —');

// The exact half. Expected loss is the table's own stated edge times what you would
// stake; "covers" is cash over wager. If either ever starts folding in a measured or
// assumed quantity, the panel's strongest claim stops being true.
check('expected loss is the STATED edge times the stake, and nothing else',
  /expLoss: e === null \? null : staked \* e,/.test(CODE),
  'expLoss must use the server-stated edge alone');
check('...and "covers" assumes nothing at all',
  /cover: bank === null \? null : Math\.floor\(bank \/ w\),/.test(CODE),
  'covers must be bankroll over wager, floored');

// The measured half. Tax drag is a division of two observed sums — the moment it acquires
// a coefficient it has become a model wearing a measurement's label.
check('tax drag is measured, not modelled',
  /taxDrag: wagered \? tax \/ wagered : null,/.test(CODE),
  'tax drag must be total tax over total staked');
check('effective edge is the stated edge plus that measurement',
  /const eff = e === null \? null : e \+ d;/.test(CODE),
  'effective edge must be stated edge + measured drag, with nothing else in it');

// The estimated half. A band without its sample count is a number people will use.
check('the band always carries its sample count',
  /bandN: num\(sdN\) \?\? 0,/.test(CODE) && /sampled/.test(SRC),
  'plan() must return the sample size and the panel must print it');
check('...and it is marked as an estimate on screen',
  /'est'/.test(CODE), 'estimated figures need the est class');
check('a single sample yields no band rather than a band of zero',
  /if \(!xs \|\| xs\.length < 2\) return null;/.test(CODE),
  'a zero band reads as certainty; too few samples must return null');
absent('nothing computes a probability of anything',
  /\berf\(|normalCdf|riskOfRuin|probabilityOf|\bpRuin\b/g);
check('the disclosure says why there is no risk of ruin',
  /heavy-tailed/.test(HEADER) && /will not quote you a risk of ruin/.test(HEADER),
  'the header must explain why no probability is offered');

// Free spins pay out against a zero stake. Folding them into the sample as zeros invents
// a worse machine than the one being played, and dividing by them throws.
check('free spins are excluded from the per-spin sample',
  /if \(w === null \|\| g === null \|\| w <= 0\) continue;/.test(CODE),
  'spinReturns() must skip spins with no stake');

console.log('\n— no clock claims to know more than it does —');

// Nothing on this surface carries a timestamp (docs/18). Every time in the panel is the
// local moment this tool first saw a receipt, and inventing a played-at would be the
// easiest untrue thing in the whole file.
// A field READ, not the word — the panel's own notes say "nothing on this surface carries
// a timestamp", and that sentence is the point rather than a violation of it.
absent('it does not read a timestamp that is not there',
  /\.(created_at|played_at|occurred_at|resolved_at|timestamp)\b/g);
check('first seen is stamped locally and never moves',
  /slim\.seen = prev \? prev\.seen : at;/.test(CODE) && /out\.seen = old\.seen;/.test(CODE),
  'a re-sighting must not move the first-seen stamp');
check('...and the panel labels it as first-seen, not as played',
  /first SAW/.test(SRC) && /nothing on this surface carries a timestamp/i.test(SRC),
  'the disclosure and the panel must both say what the clock means');

console.log('\n— it stays inside its own storage —');

// First argument only — setItem's second is a JSON.stringify(...) whose own paren would
// otherwise swallow the match and make this check fail on correct code.
const keys = [...CODE.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*([^,)]+)/g)].map((m) => m[1].trim());
check('every localStorage key is one of its own',
  keys.length > 0 && keys.every((k) => /^k$|^K\.(data|ui)$/.test(k)),
  `keys touched: ${keys.join(' | ')}`);
check('...and they are namespaced to this tool',
  /const K = \{ data: 'pksl:data', ui: 'pksl:ui' \};/.test(CODE),
  'expected the pksl: prefix');

// The ledger is bounded. An unbounded per-spin record in localStorage is a quota error
// that eats the panel state on the way out.
check('the ledger is capped, and the per-spin record more tightly',
  /const MAX_SESSIONS = \d+;/.test(CODE) && /const MAX_DEEP = \d+;/.test(CODE)
    && /all\.slice\(MAX_DEEP\)\.forEach\(\(s\) => \{ if \(s\.spins\) delete s\.spins; \}\);/.test(CODE),
  'expected both caps and the spin-record trim');
// `grid` as a CSS value is all over the stylesheet, so this asks the only question that
// matters instead: is the reel grid ever READ off a spin? What is never read cannot be
// stored, and slimSpin() is held to exactly the four keys it is allowed to keep.
const slim = CODE.slice(CODE.indexOf('const slimSpin = (sp) =>'), CODE.indexOf('const slimSession ='));
check('...and the reel grid is dropped before anything is stored',
  !/\.grid\b/.test(MINE) && !/\.line_wins\b/.test(MINE)
    && ['w:', 'g:', 'b:', 'f:'].every((k) => slim.includes(k))
    && !/grid|line_wins/.test(slim),
  `slimSpin() must keep four numbers and never read the grid — saw: ${slim.trim().slice(0, 140)}`);

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
