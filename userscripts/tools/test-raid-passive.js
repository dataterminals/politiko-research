// A fence around the one property raid-watch claims absolutely: it originates no
// requests to politiko.io, and in particular it cannot take a raid action.
//
// This surface is the sharpest in the game to sit a script next to. Four write
// endpoints live directly beside the two reads:
//
//   POST /factions/{id}/raids/{raid}/cease
//   POST /factions/{id}/raids/{raid}/surrender
//   POST /factions/{id}/raids/{raid}/accept-surrender
//   POST /factions/{id}/raids/{raid}/flag-override
//
// Surrendering a war, or imposing a flag, on a script's initiative would be about the
// most consequential thing anything in this repo could do by accident. The disclosure
// block at the top of the shipped file promises none of it is reachable. This reads
// the shipped file and fails if that stops being true, because "we never added it" is
// only true until someone does.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'raid-watch.user.js'), 'utf8');

// strip comments, so the disclosure block — which names every forbidden path in order
// to promise they are absent — cannot itself trip the fence
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
  check(label, hits.length === 0, `found ${hits.length}: ${hits.slice(0, 3).join(' | ')}`);
};

console.log('\n— no raid action is reachable —');

absent('no cease', /\bcease\b/gi);
absent('no surrender, requested or accepted', /surrender/gi);
absent('no flag override', /flag-override|flagOverride/gi);
// the read paths are /raids and /raids/<id>/report; nothing else on this surface
absent('no other faction write path is named',
  /\/factions\/[^'"`\s]*\/(disband|leave|kick|promote|invite|apply|deposit|withdraw|embezzle|advocate)/gi);

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

absent('no write methods are constructed', /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/gi);
absent('no fetch() call of its own', /(?<!orig)\bfetch\s*\(\s*['"`/]/g);
absent('no XHR is constructed', /new XMLHttpRequest/g);
absent('no XHR is opened directly', /(?<!orig)\.open\s*\(\s*['"`](POST|GET|PUT|DELETE)/gi);
absent('no sendBeacon', /sendBeacon/g);
absent('no arming switch of any kind', /\bfunction arm\b|canExecute|isDryRun|AUTO_|DRY_RUN|EXECUTOR/g);
absent('nothing is scheduled to run on its own', /setInterval|requestIdleCallback/g);

console.log('\n— the tap is a tap —');

check('it only matches the two read routes',
  /RAIDS_RE\s*=\s*\/.*\\\/raids/.test(CODE) && /REPORT_RE\s*=\s*\/.*report/.test(CODE),
  'expected RAIDS_RE and REPORT_RE');
check('dispatch checks the report route before the list route',
  CODE.indexOf('REPORT_RE.test') < CODE.indexOf('RAIDS_RE.test'),
  'a report URL also matches the list route, so the specific test must come first');

// Polling is the failure mode this file exists to prevent, and there are exactly two
// ways to build one: setInterval (banned outright above) or a setTimeout that re-arms.
// So rather than count timers — the script legitimately owns a save debounce, a
// "copied" label reset and a blob-URL cleanup — assert that no timer body goes
// anywhere near the network or the ingest path.
const NETWORKISH = /fetch|XMLHttpRequest|dispatch|ingest|sendBeacon|setTimeout/;
const timerBodies = [...CODE.matchAll(/setTimeout\s*\(([\s\S]{0,200})/g)].map((m) => m[1]);
check('every timer body is inert', timerBodies.every((b) => !NETWORKISH.test(b)),
  timerBodies.filter((b) => NETWORKISH.test(b)).map((b) => b.slice(0, 80)).join(' | '));
check('...and there are only the three known ones', timerBodies.length === 3,
  `found ${timerBodies.length}; if you added one, say what it does here`);

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
