// A fence around bar-watch.
//
// This is the first tool in the repo whose `Alerts:` disclosure is not the word "none",
// so it is the first one where that line has to be enforced rather than merely asserted.
// Three of its four channels are off by default and two of them can be perceived from a
// tab you are not looking at. That is an operator decision, recorded in
// docs/01-rules-envelope.md — but a decision about TITLE, ICON and SOUND is not a
// decision about anything else, and the distance between them is exactly what this file
// exists to hold open.
//
// What that means concretely:
//
//   The desktop notification stays absent. Not off, not behind a flag, not "disabled by
//   default" — the Notification API, the service worker and the push manager do not
//   appear in the file at all. That is the case clause 4 names as its own worked
//   example, and the moment the API is referenced anywhere the distance between "we
//   chose not to" and "someone flips a boolean" is one line.
//
//   Every raise has a clear. A channel that writes to the tab (title, favicon) and
//   cannot put it back leaves a permanent mark on a browser the tool does not own. Both
//   have to be restored when the alert ends, when the channel is switched off, and on
//   pagehide — the third is the one that gets forgotten.
//
//   The alert is arithmetic, not a request. The whole rules argument for TITLE and SOUND
//   rests on there being nothing extracted from an unfocused page: the projection runs on
//   a payload captured while the page was in front of you, and the client's own polling
//   stops on blur. A single fetch in this tool and that argument is gone — not weakened,
//   gone — because then something IS being pulled from a page nobody is viewing in order
//   to raise an alert, which is clause 4 verbatim.
//
//   The countdown is the client's own arithmetic. `CustomRegenRate ?? BaseRegenRate` is
//   not a detail: reimplementing the rate from the wiki's 6/2/3 per minute produces a
//   panel that disagrees with the sidebar the moment anything modifies a rate, and a
//   countdown that disagrees with the game is worse than no countdown.
//
//   No canvas. Drawing a favicon on a canvas would be an ordinary thing to do and is NOT
//   what X-CT-Canvas fingerprints — but docs/01-rules-envelope.md puts canvas next to the
//   multi-account enforcement mechanism, and this tool does not need it. An SVG data URI
//   costs nothing and leaves nothing to explain.
//
// Run: node userscripts/tools/test-bar-passive.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'bar-watch.user.js');
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

absent('it never constructs an XHR', /new\s+XMLHttpRequest/g);
absent('it never opens a socket', /new\s+WebSocket|new\s+EventSource/g);
absent('it never beacons', /sendBeacon/g);
absent('it never injects a fetching element',
  /new\s+Image\(|createElement\(\s*['"`](script|img|iframe|object|embed)/g);
absent('it never imports at runtime', /\bimport\s*\(/g);
absent('it names no write verb', /method:\s*['"`](POST|PUT|PATCH|DELETE)/gi);
absent('it builds no request body', /\bbody:\s*(JSON\.stringify|new\s+FormData|new\s+URLSearchParams)/g);

console.log('\n— the notification API is absent, not disabled —');

absent('it never notifies', /Notification|showNotification/g);
absent('it never registers a worker', /serviceWorker|pushManager|PushManager/g);
absent('it never touches the game\'s push preferences', /politiko_push_preferences|push\/(vapid|subscription)/g);
absent('it never takes focus', /window\.focus\s*\(|\.blur\s*\(\)|alert\s*\(/g);
absent('it never draws on a canvas', /getContext\s*\(|createElement\(\s*['"`]canvas|toDataURL|OffscreenCanvas/g);

console.log('\n— the three tab-reaching channels are opt-in —');

// The defaults live in one object so there is one place to read them and one place a
// mistake could be made. PAGE is the only one that ships on.
const defaults = CODE.match(/const DEFAULT_CH = \{([^}]*)\}/);
check('there is a single defaults object', !!defaults, 'expected `const DEFAULT_CH = { … }`');
if (defaults) {
  const d = defaults[1];
  check('PAGE is on', /page:\s*true/.test(d), d.trim());
  check('TITLE is off', /title:\s*false/.test(d), d.trim());
  check('ICON is off', /icon:\s*false/.test(d), d.trim());
  check('SOUND is off', /sound:\s*false/.test(d), d.trim());
}

// Every channel that writes outside the panel is gated on its own switch at the point
// it writes, not merely at the point it is offered.
for (const [word, fn, flag] of [['title', 'titleRaise', 'ui.ch.title'],
  ['icon', 'iconRaise', 'ui.ch.icon'],
  ['sound', 'soundPlay', 'ui.ch.sound']]) {
  const body = CODE.slice(CODE.indexOf(`const ${fn} = `), CODE.indexOf(`const ${fn} = `) + 260);
  check(`${word} refuses to fire when its switch is off`,
    body.includes(`if (!${flag}`),
    `expected an early return on ${flag} inside ${fn}()`);
}

console.log('\n— every raise has a clear —');

for (const fn of ['titleClear', 'iconClear']) {
  check(`${fn}() exists`, CODE.includes(`const ${fn} = `), `expected const ${fn} = …`);
}
check('switching TITLE off puts the tab title back',
  /if \(k === 'title' && !ui\.ch\.title\) titleClear\(\);/.test(CODE),
  'the channel switch must clear what it already wrote');
check('switching ICON off puts the favicon back',
  /if \(k === 'icon' && !ui\.ch\.icon\) iconClear\(\);/.test(CODE),
  'the channel switch must restore the favicon it replaced');
check('the tick clears both when nothing is at its level',
  /titleClear\(\);\s*iconClear\(\);/.test(CODE),
  'expected titleClear() and iconClear() on the else branch of the tick');
check('...and pagehide clears both, so no tab is left marked',
  /pagehide[\s\S]{0,80}titleClear\(\);\s*iconClear\(\);/.test(CODE),
  'expected a pagehide listener that clears the title and the favicon');
check('the original title is remembered before it is overwritten',
  /if \(baseTitle === null\) baseTitle = document\.title;/.test(CODE),
  'expected the base title to be captured on the first raise');
check('the original favicon href is remembered before it is overwritten',
  /l\.getAttribute\('href'\)/.test(CODE) && /iconSaved = links\.map/.test(CODE),
  'expected the existing icon hrefs to be saved before being replaced');

console.log('\n— the sound is synthesised, never fetched —');

absent('no audio file is loaded from anywhere', /new\s+Audio\(|\.src\s*=\s*['"`][^'"`]*\.(mp3|ogg|wav)/g);
check('the tone is built with an oscillator',
  /createOscillator\(\)/.test(CODE) && /AudioContext/.test(CODE),
  'expected WebAudio synthesis rather than a media element');
check('the context is armed on the click that enables the channel',
  /if \(k === 'sound' && ui\.ch\.sound\) soundArm\(\);/.test(CODE),
  'a context built outside a user gesture stays suspended and silently never plays');

console.log('\n— it alerts once, and re-arms by falling back —');

check('a bar that is already at its level on load does not fire',
  /if \(!state\.seeded && rows\.length\)/.test(CODE),
  'expected the first payload to seed the fired state without alerting');
check('a bar only fires on the crossing',
  /if \(now_hit && !state\.fired\[name\]\)/.test(CODE),
  'expected a rising-edge test rather than a level test');
check('...and dropping below re-arms it',
  /if \(!now_hit\) state\.fired\[name\] = false;/.test(CODE),
  'expected the fired flag to clear when the bar falls back');

console.log('\n— nothing runs on its own —');

// The tick may compute and it may draw. It may not reach the network. Unlike the other
// tools it is deliberately NOT gated on document.hidden — evaluating the alert while the
// tab is in the background is the entire point of the TITLE channel — so the gate is on
// the painting instead, one level in.
const NAVISH = /fetch|XMLHttpRequest|pushState|PopStateEvent|location\s*\.|consume\s*\(/;
const bodies = [...CODE.matchAll(/set(?:Timeout|Interval)\s*\(([\s\S]{0,260})/g)].map((m) => m[1]);
check('no timer touches the network or navigates',
  bodies.every((b) => !NAVISH.test(b)),
  `suspect timer body: ${bodies.find((b) => NAVISH.test(b))?.slice(0, 120)}`);
check('the repaint is gated on the tab being visible',
  /if \(ui\.open && !document\.hidden && panel\)/.test(CODE),
  'a hidden tab must not be repainted; only the alert state is evaluated there');
check('...and the tick is the only timer in the file',
  bodies.length === 1 && /tick, 1000/.test(CODE),
  `${bodies.length} timers found; expected exactly one`);

console.log('\n— it reads responses, never requests —');

check('both payloads are gated on being arrays',
  (CODE.match(/if \(!Array\.isArray\(data\)\) return;/g) || []).length === 2,
  'each subscription must refuse a payload that is not the listing shape');
check('it subscribes to two paths by name, not to everything',
  /onApi\('\/api\/attributes'/.test(CODE) && /onApi\('\/api\/effects'/.test(CODE)
    && !/onApi\(\s*'\*'/.test(CODE),
  'a * subscriber opts the whole repo back into parsing every response');
absent('it never reads the auth key', /['"`]auth['"`]\s*\)|getItem\(\s*['"`]auth/g);
absent('it never reads the device fingerprint', /device_signals/g);

// The five fingerprint headers are how multi-accounting is enforced. A passive tap sees
// them; touching them is indistinguishable from evading that enforcement.
absent('it never touches the fingerprint headers', /X-CT-(TZ|Screen|Lang|Platform|Canvas)/gi);

console.log('\n— the projection is the client\'s own —');

check('the effective rate is the game\'s expression, verbatim',
  /const rateOf = \(r\) => r\.CustomRegenRate \?\? r\.BaseRegenRate;/.test(CODE),
  'expected CustomRegenRate ?? BaseRegenRate — see docs/17-attribute-surface.md');
check('no rate is hardcoded from the wiki',
  !/\b(6|2|3)\s*\/\s*min\b/.test(CODE) && !/BASE_RATE|RATES\s*=/.test(CODE),
  'the wiki quotes 6/2/3 per minute; a literal here would disagree with the sidebar');
check('the value is floored per whole point, like the game',
  /Math\.floor\(mins \* rate\)/.test(CODE),
  'expected Math.floor(mins * rate) — partial points are not shown by the game');
check('a paused or negative rate yields no ETA rather than a wrong one',
  (CODE.match(/if \(!\(rate > 0\)\) return/g) || []).length >= 2,
  'expected every projection to refuse when the rate is not positive');
check('an effect that touches a bar is named next to it',
  /const EFFECT_BARS = /.test(CODE) && /regen_modifier/.test(CODE) && /damage_over_time/.test(CODE),
  'a countdown drawn while radiation drains HP is worse than no countdown');
check('...and the tool does not model the effect itself',
  !/value\s*\*\s*rate|rate\s*[*+]\s*e\.value|applyModifier/.test(CODE),
  'whether CustomRegenRate already includes modifiers is NOT measured — do not guess');

console.log('\n— it stays inside its own storage —');

// First argument only — setItem's second is a JSON.stringify(...) whose own paren would
// otherwise swallow the match and make this check fail on correct code.
const keys = [...CODE.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*([^,)]+)/g)].map((m) => m[1].trim());
check('every localStorage key is one of its own',
  keys.every((k) => /^k$|^K\.ui$/.test(k)),
  `keys touched: ${keys.join(' | ')}`);
check('no game data is persisted',
  !/writeJSON\(K\.(?!ui)/.test(CODE) && !/rows:.*localStorage/.test(CODE),
  'readings are held in memory only; the disclosure says so');

console.log('\n— the disclosure matches the build —');

check('the header states the four channels',
  /PAGE\s+\(default ON\)/.test(HEADER) && /TITLE \(default OFF\)/.test(HEADER)
    && /ICON  \(default OFF\)/.test(HEADER) && /SOUND \(default OFF\)/.test(HEADER),
  'clause 6: every channel has to be named, with its default');
check('...and says there is no desktop notification',
  /NO desktop\/OS notification/.test(HEADER),
  'the one thing this tool deliberately does not do has to be stated');
check('...and states zero added requests',
  /ZERO additional requests to politiko\.io/.test(HEADER),
  'clause 6: the request budget has to be stated');
check('...and names the storage key it uses',
  /localStorage key `pkbw:ui`/.test(HEADER),
  'clause 6: storage has to be disclosed');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
