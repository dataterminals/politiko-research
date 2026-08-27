// A fence around the one property sleeper-watch claims absolutely: it originates no
// requests to politiko.io, and in particular it cannot take a sleeper action.
//
// Five write endpoints sit directly beside the three reads:
//
//   POST /actions/sleeper-recruitment/canvass                 costs energy
//   POST /actions/sleeper-recruitment/{id}/meet               can lose the lead outright
//   POST /actions/sleeper-recruitment/{id}/drop               discards it
//   POST /factions/{id}/sleepers/{sleeper}/advocate
//   POST /factions/{id}/sleepers/{sleeper}/embezzle
//
// This tool exists to tell you a window is open. The temptation it must never grow is
// walking through it for you — a script-pressed `meet` is exactly the kind of
// script-initiated game action the clause bans, and a mistimed one throws the lead away.
//
// The fence differs from test-raid-passive in one deliberate way. That file bans
// setInterval outright, because raid-watch has no honest use for a repeating timer.
// This one HAS to run a clock: the whole product is a countdown, and it ticks once a
// second. So instead of banning timers, this asserts the stronger property that makes
// any timer safe — that nothing anywhere in the file can originate a request at all.
// A timer that cannot reach the network is not a poll, whatever its period.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'sleeper-watch.user.js'), 'utf8');

// Strip comments, so the disclosure block — which names every forbidden path in order to
// promise they are absent — cannot itself trip the fence.
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

// Every string literal in the code. A URL this script could request would have to be one
// of these; a path mentioned inside a regex literal is a matcher for a response that
// already arrived, which is the opposite thing.
const STRINGS = (CODE.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || []);

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        ${detail}`); fail++; }
};
const absent = (label, re) => {
  const hits = CODE.match(re) || [];
  check(label, hits.length === 0, `found ${hits.length}: ${hits.slice(0, 3).join(' | ')}`);
};
const noString = (label, re) => {
  const hits = STRINGS.filter((s) => re.test(s));
  check(label, hits.length === 0, `found ${hits.length}: ${hits.slice(0, 3).join(' | ')}`);
};

console.log('\n— no sleeper action is reachable —');

// Word-level bans are useless here: the panel legitimately prints "advocate",
// "embezzle" and "canvass" as English. What must not exist is any of them as a PATH,
// and a path could only ever live in a string.
noString('no recruitment write path is ever written down',
  /sleeper-recruitment\/(canvass|[^/'"`\s]+\/(meet|drop))/i);
noString('no faction sleeper write path is ever written down',
  /sleepers\/[^/'"`\s]+\/(advocate|embezzle)/i);
noString('no other faction write path either',
  /factions\/[^'"`\s]*\/(disband|leave|kick|promote|invite|apply|deposit|withdraw)/i);

// The bare /api/ string is the four-character filter the tap uses to decide whether a
// response is worth looking at. Since HTTP TAP v1 there are also subscription prefixes:
// naming the paths this tool wants is the whole of how the shared tap knows what to
// parse, and a path nobody named is never read at all. Those are allowed by identity —
// collected from the onApi() call in this very file — so a quoted endpoint that is NOT
// a registered prefix still fails, which is the property this check exists for. A read
// prefix is also not a write path: the five endpoints named at the top of this file are
// fenced separately above, and none of them is a prefix of anything subscribed here.
const subPrefixes = new Set(
  [...CODE.matchAll(/onApi\(\s*(\[[^\]]*\]|['"`][^'"`]*['"`])/g)]
    .flatMap((m) => [...m[1].matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map((x) => x[1])),
);
const registered = (s) => subPrefixes.has(s.slice(1, -1));
check('the tool subscribes to named paths, not to everything',
  subPrefixes.size > 0 && !/onApi\(\s*['"`]\*['"`]/.test(CODE),
  `prefixes: ${[...subPrefixes].join(', ') || 'none'}`);
const apiStrings = STRINGS.filter((s) => s.includes('/api/'));
check('every /api/ string is the tap filter or a named subscription',
  apiStrings.length > 0 && apiStrings.every((s) => s === "'/api/'" || registered(s)),
  `found: ${[...new Set(apiStrings)].filter((s) => s !== "'/api/'" && !registered(s)).join(' | ')}`);

console.log('\n— no way to originate a request at all —');

const origFetchUses = CODE.match(/origFetch[.(]/g) || [];
check('origFetch is referenced exactly once', origFetchUses.length === 1,
  `referenced ${origFetchUses.length} times`);
check('...and that use is the tap calling through',
  /origFetch\.apply\(this, args\)/.test(CODE), 'expected origFetch.apply(this, args)');

const origSendUses = CODE.match(/origSend[.(]/g) || [];
check('origSend is referenced exactly once', origSendUses.length === 1,
  `referenced ${origSendUses.length} times`);
check('...and that use is the tap calling through',
  /origSend\.apply\(this, a\)/.test(CODE), 'expected origSend.apply(this, a)');

const origOpenUses = CODE.match(/origOpen[.(]/g) || [];
check('origOpen is referenced exactly once', origOpenUses.length === 1,
  `referenced ${origOpenUses.length} times`);

absent('no write methods are constructed', /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/gi);
absent('no fetch() call of its own', /(?<!orig)\bfetch\s*\(/g);
absent('no XHR is constructed', /new XMLHttpRequest/g);
absent('no XHR is opened directly', /(?<!orig)\.open\s*\(/g);
absent('no .post/.put/.delete helper is called', /\.(post|put|patch|delete)\s*\(/gi);
absent('no sendBeacon', /sendBeacon/g);
absent('no EventSource, no socket of its own', /EventSource|new WebSocket/g);
absent('no dynamic import', /\bimport\s*\(/g);
absent('no form is submitted', /\.submit\s*\(|new FormData/g);
absent('no arming switch of any kind', /\bfunction arm\b|canExecute|isDryRun|AUTO_|DRY_RUN|EXECUTOR/g);

console.log('\n— the clock is a clock —');

// One repeating timer, and it must be the countdown. Anything else repeating is either
// a poll or the beginning of one.
const intervals = [...CODE.matchAll(/setInterval\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
check('exactly one setInterval', intervals.length === 1, `found ${intervals.length}: ${intervals.join(', ')}`);
check('...and it runs the countdown tick', intervals[0] === 'tick', `runs ${intervals[0]}`);

// The tick may only subtract now from deadlines already sitting in the DOM. If it ever
// learns to fetch, the tool becomes the background poller the clause names.
const tickBody = (/const tick = \(\) => \{([\s\S]*?)\n  \};/.exec(CODE) || [])[1] || '';
check('the tick body was found', tickBody.length > 0, 'could not locate const tick');
const NETWORKISH = /fetch|XMLHttpRequest|dispatch|ingest|sendBeacon|navigate|pushState/;
check('...and it touches nothing networkish', !NETWORKISH.test(tickBody),
  (tickBody.match(NETWORKISH) || []).join(' | '));

// settle() re-arms a setTimeout, which is the other way to build a poll. It is allowed
// only because what it polls is the DOM, waiting for a route to finish rendering, and
// because it is bounded.
const settleBody = (/const settle = \(fn\) => \{([\s\S]*?)\n  \};/.exec(CODE) || [])[1] || '';
check('the re-arming settle loop was found', settleBody.length > 0, 'could not locate const settle');
check('...it is bounded by a try counter', /\+\+tries\s*>\s*\d+\)\s*return/.test(settleBody), 'expected a tries cap');
check('...and it never reaches the network', !NETWORKISH.test(settleBody),
  (settleBody.match(NETWORKISH) || []).join(' | '));

const timerBodies = [...CODE.matchAll(/setTimeout\s*\(([\s\S]{0,160})/g)].map((m) => m[1]);
check('no timer anywhere touches the network',
  timerBodies.every((b) => !/fetch|XMLHttpRequest|sendBeacon|dispatch|ingest/.test(b)),
  timerBodies.filter((b) => /fetch|XMLHttpRequest|sendBeacon|dispatch|ingest/.test(b))
    .map((b) => b.slice(0, 70)).join(' | '));

console.log('\n— the jump navigates, and only ever to a page —');

const pushes = CODE.match(/pushState/g) || [];
check('exactly one pushState', pushes.length === 1, `found ${pushes.length}`);
// The bare '/api/' filter is fine and is checked above; what must not exist is a string
// naming an actual endpoint — that prefix followed by anything but the closing quote.
// A registered read subscription is exempt: it is handed to the tap, never to a jump,
// and the single pushState below is fenced on its own.
check('no navigable string is an API endpoint',
  STRINGS.filter((s) => /^(['"`])\/api\/[^'"`]/.test(s)).every(registered),
  `found: ${STRINGS.filter((s) => /^(['"`])\/api\/[^'"`]/.test(s) && !registered(s)).join(' | ')}`);
// Nothing may click the game's own action buttons on your behalf. clickTab exists, and
// it is allowed exactly one caller with exactly one argument: the faction page's tab
// strip, which is local component state with no URL to link to.
const clicks = [...CODE.matchAll(/clickTab\(([^)]*)\)/g)].map((m) => m[1]);
check('clickTab is only ever asked for the Sleepers tab',
  clicks.filter((c) => c && c !== 'label').every((c) => c === "'Sleepers'"),
  clicks.join(' | '));
absent('nothing clicks a button by action name',
  /\.click\(\)[\s\S]{0,40}(meet|canvass|drop|advocate|embezzle)/i);

// The sharpest hole in this particular fence, and the reason it is counted rather than
// pattern-matched. Everything above bars ORIGINATING a request — but pressing the game's
// own Talk about issue button originates nothing itself: React does it, on our behalf,
// which is precisely the script-initiated game action the clause bans. A synthetic click
// slips past every network check in this file.
//
// So .click() is capped by count. There are exactly two, both known, and a third has to
// be argued for here before it can ship. The match deliberately ignores the receiver —
// an earlier version keyed on `\w+.click()` and sailed straight past
// `document.querySelector('button').click()`, which is the exact line this exists to stop.
const clickers = CODE.match(/\.click\s*\(\s*\)/g) || [];
check('exactly two synthetic clicks exist', clickers.length === 2,
  `found ${clickers.length}`);

const bodyOf = (name) => (new RegExp(`const ${name} = [\\s\\S]*?\\n  \\};`).exec(CODE) || [''])[0];
const clickTabBody = bodyOf('clickTab');
const downloadBody = bodyOf('download');
check('...one is the faction tab strip',
  (clickTabBody.match(/\.click\(\)/g) || []).length === 1, 'clickTab should own exactly one');
check('...the other is the export anchor, which touches no game UI',
  (downloadBody.match(/\.click\(\)/g) || []).length === 1, 'download should own exactly one');
check('...and neither lives anywhere that runs on a timer',
  !/\.click\(\)/.test(tickBody) && !/\.click\(\)/.test(settleBody),
  'a click reached by the clock is automation, whatever it clicks');

console.log('\n— the tap is a tap —');

check('it matches the three read routes',
  /RECRUIT_RE\s*=\s*\//.test(CODE) && /MEET_RE\s*=\s*\//.test(CODE) && /FACSLEEP_RE\s*=\s*\//.test(CODE),
  'expected RECRUIT_RE, MEET_RE and FACSLEEP_RE');
check('the meeting route is tested before the list route',
  CODE.indexOf('MEET_RE.test') < CODE.indexOf('RECRUIT_RE.test'),
  'a /meet URL also matches the list route, so the specific test must come first');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
