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

// ---------------------------------------------------------------------------
// The chart bridge, added in 1.6.0, is the first thing in this repo to reach into
// another component's internals. It borrows the page's own chart object to ask it
// where things are. Borrowing is fine; the disclosure at the top of the file
// promises it is READ-ONLY, and that promise needs a fence, because every method
// that would break it sits on the very object we are holding.
// ---------------------------------------------------------------------------
console.log('\n— the chart is read, never written —');

// One call each of these and the player's own chart is altered underneath them.
// `applyOptions` is named in the duck-type check as a property, which is why this
// looks for a CALL — `typeof o.applyOptions === 'function'` must stay legal.
absent('never calls setData on the game chart', /\.setData\s*\(/g);
absent('never calls applyOptions on the game chart', /\.applyOptions\s*\(/g);
absent('never calls update on a series', /\bseries\.update\s*\(|\.current\.update\s*\(/g);
absent('never removes the game chart', /\bchart\.remove\s*\(|\.chart\.remove\s*\(/g);
absent('never calls setMarkers (v5 dropped it; we draw our own)', /setMarkers|createSeriesMarkers/g);

check('the reads it does make are the five it discloses',
  ['timeScale(', 'timeToCoordinate(', 'priceToCoordinate(', '.data()', 'subscribeDataChanged(']
    .every((m) => CODE.includes(m)),
  'a disclosed read method is missing — the disclosure block is now wrong');

check('every subscription it takes, it also releases',
  (CODE.match(/\bsubscribeVisibleLogicalRangeChange\b/g) || []).length
    === (CODE.match(/\bunsubscribeVisibleLogicalRangeChange\b/g) || []).length
  && (CODE.match(/(?<!un)\bsubscribeDataChanged\b/g) || []).length
    === (CODE.match(/\bunsubscribeDataChanged\b/g) || []).length,
  'a subscribe with no matching unsubscribe leaks onto a chart that gets remounted');

console.log('\n— the overlay draws and does nothing else —');
check('the overlay layer cannot take a pointer event',
  /\.ovl \{[^}]*pointer-events: none/.test(SRC),
  'expected pointer-events: none on .ovl — the game chart must still pan and zoom');
check('...and it claims no z-index of its own',
  !/\.ovl \{[^}]*z-index/.test(SRC),
  'a z-index on .ovl draws the marks over this tool’s own panel');
check('the overlay lives in our shadow root, not in the app’s DOM',
  /wrap\.append\(\$ovl/.test(CODE),
  'expected $ovl to be appended to .wrap, so React can never reconcile it away');

// Clause 4 of the scripting rules names desktop notifications directly. The API is
// absent from every file in this repo — not disabled, absent — and a tool that has
// just grown a drawing layer is exactly where one would get added by accident.
absent('the Notification API is absent, not merely unused', /\bNotification\b/g);

console.log('\n— what the marks are computed from —');
check('the arithmetic is liftable, so it can be tested without the game',
  SRC.includes('// >>> ENGINE START') && SRC.includes('// <<< ENGINE END'),
  'engine markers missing — userscripts/tools/test-market-chart.js cannot reach it');
check('a fill is placed by its game day, not by wall-clock time',
  /trade\.game_day \* GAME_DAY_SECS/.test(CODE),
  'expected the game_day -> game-seconds conversion the whole feature rests on');
check('a fill dated after the newest bar refuses to draw',
  /impossible: true/.test(CODE),
  'the guard against game_day not being an absolute day is gone');
check('a mark is only drawn once the stock has been confirmed',
  /m\.verified === true/.test(CODE),
  'expected the symbol check to gate the trade mark');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
