// Slices the real position-sizing layer and exercises resolveQty against a
// holdings/instruments split shaped like the live stocks page.
const fs = require('fs');
const SRC = fs.readFileSync(require('path').join(__dirname,'..','market-watch.user.js'), 'utf8');
const i = SRC.indexOf('const HEADLINE'), j = SRC.indexOf('function sparkline');
if (i < 0 || j < 0) throw new Error('markers not found');
const slice = SRC.slice(i, j);

let hist = {};
const setHist = (h) => { hist = h; };
const latest = (k) => (hist[k] && hist[k].length ? hist[k][hist[k].length - 1] : null);
const isStatic = (k) => {
  const a = hist[k];
  return !!a && a.length >= 3 && a.every((p) => p[1] === a[0][1]);
};
const fmtNum = (v) => Math.abs(v) >= 10000
  ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  : Number(v.toFixed(2)).toString();

const mod = new Function('getHist', 'isStatic', 'latest', 'fmtNum', `
  const hist = new Proxy({}, { get: (_, k) => getHist()[k], has: (_, k) => k in getHist(),
    ownKeys: () => Reflect.ownKeys(getHist()), getOwnPropertyDescriptor: (_, k) =>
      ({ configurable: true, enumerable: true, value: getHist()[k] }) });
  ${slice}
  return { holdingSeriesFor, heldShares, cashAvailable, resolveQty, QTY_MODES, qtyLabel, seriesIndex };
`)(() => hist, isStatic, latest, fmtNum);

const FULL = {
  'stocks/instruments/SNTL::price': [[1, 85.6], [2, 85.0], [3, 84.43]],
  'stocks/instruments/SNTL::bid': [[1, 84.9], [2, 84.5], [3, 84.01]],
  'stocks/holdings/SNTL::current_price': [[1, 85.6], [2, 85.0], [3, 84.43]],
  'stocks/holdings/SNTL::shares': [[1, 240], [2, 240], [3, 240]],
  'stocks/holdings/SNTL::avg_cost': [[1, 79.2], [2, 79.2], [3, 79.2]],
  'stocks/account::cash': [[1, 5000], [2, 5000], [3, 900]],
};

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};
const size = (series, action, mode, value, field) =>
  mod.resolveQty({ series, action, qty: { mode, value, field: field || null } },
    latest(`${series}::price`) ? latest(`${series}::price`)[1] : latest(`${series}::current_price`)?.[1]);

setHist(FULL);

console.log('— discovery —');
check('instruments row finds its holdings sibling',
  mod.holdingSeriesFor('stocks/instruments/SNTL'), 'stocks/holdings/SNTL');
check('a holdings row resolves to itself',
  mod.holdingSeriesFor('stocks/holdings/SNTL'), 'stocks/holdings/SNTL');
check('share count auto-detected',
  mod.heldShares('stocks/instruments/SNTL'), { qty: 240, source: 'stocks/holdings/SNTL::shares' });
check('cash auto-detected', mod.cashAvailable(), { cash: 900, source: 'stocks/account::cash' });

console.log('\n— sizing —');
check('50% of 240 held', size('stocks/instruments/SNTL', 'sell', 'pctHeld', 50).shares, 120);
check('everything held', size('stocks/instruments/SNTL', 'sell', 'all').shares, 240);
check('exact count under holding', size('stocks/instruments/SNTL', 'sell', 'shares', 100).shares, 100);
check('SELL clamped to holding', size('stocks/instruments/SNTL', 'sell', 'shares', 500).shares, 240);
check('BUY not clamped by holding', size('stocks/instruments/SNTL', 'buy', 'shares', 500).shares, 500);
check('33% rounds down, never up', size('stocks/instruments/SNTL', 'sell', 'pctHeld', 33).shares, 79);

console.log('\n— cash sizing —');
const c = size('stocks/instruments/SNTL', 'buy', 'cash', 1000);
check('$1000 at 84.43, capped by $900 cash', c.shares, 10);
console.log(`        why: ${c.why}`);

console.log('\n— refusals (must return null, never a guess) —');
const noQty = size('stocks/instruments/SNTL', 'sell', 'pctHeld', NaN);
check('missing size refuses', [noQty.shares, noQty.why], [null, 'enter a size']);
const tiny = size('stocks/instruments/SNTL', 'sell', 'pctHeld', 0.1);
check('sub-share percentage refuses', tiny.shares, null);
console.log(`        why: ${tiny.why}`);

setHist({ 'stocks/instruments/SNTL::price': [[1, 85.6], [2, 85.0], [3, 84.43]] });
const blind = size('stocks/instruments/SNTL', 'sell', 'pctHeld', 50);
check('no holdings observed refuses', blind.shares, null);
console.log(`        why: ${blind.why}`);
const unver = size('stocks/instruments/SNTL', 'sell', 'shares', 500);
check('exact-count SELL passes through when there is nothing to clamp against', unver.shares, 500);
check('...and says so instead of implying a check happened',
  /UNVERIFIED/.test(unver.why), true);
console.log(`        why: ${unver.why}`);

console.log('\n— field override —');
setHist(Object.assign({}, FULL, { 'stocks/holdings/SNTL::units': [[1, 12], [2, 12], [3, 12]] }));
check('override picks the named field',
  size('stocks/instruments/SNTL', 'sell', 'all', null, 'units').shares, 12);
check('auto still prefers "shares"', mod.heldShares('stocks/instruments/SNTL').qty, 240);

console.log(fail ? `\nFAIL (${fail})` : '\nALL OK');
process.exit(fail ? 1 : 0);
