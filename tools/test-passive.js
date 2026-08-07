// A fence around the one property this script now claims absolutely: it originates
// no requests to politiko.io.
//
// The order-execution seam was deleted in 1.0.0. This reads the shipped file and
// fails if anything that could send a request has come back — because "we removed
// it" is only true until someone adds it again, and the disclosure block at the top
// of the file is a promise to whoever installs it.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'market-watch.user.js'), 'utf8');

// strip comments so the history note (which names the deleted things) can't trip this
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

console.log('\n— no way to originate a request —');

// The tap keeps a reference to the real fetch so it can call through. That single
// call-through is the only legitimate use; anything else is a request we made.
const origFetchUses = CODE.match(/origFetch[.(]/g) || [];
check('origFetch is referenced exactly once', origFetchUses.length === 1,
  `referenced ${origFetchUses.length} times`);
check('...and that use is the tap calling through',
  /origFetch\.apply\(this, args\)/.test(CODE), 'expected origFetch.apply(this, args)');

absent('no write methods are constructed', /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/gi);
absent('no fetch() call of its own', /(?<!orig)\bfetch\s*\(\s*['"`/]/g);
absent('no XHR is opened', /new XMLHttpRequest|\.open\s*\(\s*['"`](POST|GET)/gi);
absent('no sendBeacon', /sendBeacon/g);
absent('no executor seam', /registerExecutor|wireExecutor|EXECUTORS/g);
absent('no arming', /\bfunction arm\b|canExecute|isDryRun|AUTO_EXECUTE|DRY_RUN/g);
absent('no order routes', /ORDER_ROUTES|stocks\/(buy|sell)\b/g);
absent('no request-body capture', /captureWrite/g);

console.log('\n— the alert shortcut navigates, and only navigates —');
check('it uses history navigation, not a request',
  /history\.pushState\(\{\}, '', '\/stocks'\)/.test(CODE), 'expected a pushState to /stocks');
check('the ticker match is on text, never a generated class',
  /textContent\.trim\(\) === sym/.test(CODE), 'expected an exact textContent match');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
