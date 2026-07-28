// Slices the real order-wiring layer: instrument-id resolution, idempotency key
// format, and route learning. The shapes here come from an order actually
// observed on 2026-07-28 — POST /api/stocks/buy {instrument_id, shares,
// idempotency_key} — see docs/04-stocks-surface.md.
const fs = require('fs');
const SRC = fs.readFileSync(require('path').join(__dirname, '..', 'userscripts', 'market-watch.user.js'), 'utf8');
const cut = (a, b) => {
  const i = SRC.indexOf(a), j = SRC.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`marker missing: ${i < 0 ? a : b}`);
  return SRC.slice(i, j);
};

const shortSeries = (s) => { const i = s.lastIndexOf('/'); return i < 0 ? s : s.slice(i + 1); };
const splitSeries = (s) => { const i = s.lastIndexOf('/'); return i < 0 ? ['', s] : [s.slice(0, i), s.slice(i + 1)]; };

const ids = new Map();
const ordersMod = new Function('entityIds', 'shortSeries', 'splitSeries',
  `${cut('const idempotencyKey', 'function wireStocksExecutor')}
   return { idempotencyKey, instrumentIdFor };`)(ids, shortSeries, splitSeries);

const routeMod = new Function('log',
  `${cut('const ORDER_ROUTES', 'function captureWrite')}
   return { ORDER_ROUTES, learnRoute };`)(() => {});

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

console.log('— instrument id resolution —');
ids.clear();
ids.set('stocks/holdings/RCRD', { id: 77, sure: false });
check('a holding id alone is refused — wrong id space would trade the wrong stock',
  ordersMod.instrumentIdFor('stocks/holdings/RCRD'), null);

ids.set('stocks/instruments/RCRD', { id: 10, sure: true });
check('the instruments id is used once seen',
  ordersMod.instrumentIdFor('stocks/instruments/RCRD'), 10);
check('a rule written against the holdings row still resolves to the instrument',
  ordersMod.instrumentIdFor('stocks/holdings/RCRD'), 10);

ids.clear();
ids.set('stocks/holdings/BRDL', { id: 42, sure: true });   // came from a literal instrument_id
check('a literal instrument_id is trusted wherever it appears',
  ordersMod.instrumentIdFor('stocks/holdings/BRDL'), 42);
check('an unknown symbol resolves to nothing', ordersMod.instrumentIdFor('stocks/instruments/ZZZZ'), null);

console.log('\n— idempotency key —');
const OBSERVED = '1785269781763-jbdjuee201q';
const shape = (k) => /^\d{13}-[a-z0-9]{11}$/.test(k);
check('the observed key matches the shape we generate', shape(OBSERVED), true);
const keys = Array.from({ length: 200 }, () => ordersMod.idempotencyKey());
check('every generated key matches that shape', keys.every(shape), true);
check('keys are unique across a burst', new Set(keys).size, keys.length);
console.log(`        sample: ${keys[0]}`);

console.log('\n— routes —');
check('buy, observed 2026-07-28', routeMod.ORDER_ROUTES.buy, '/api/stocks/buy');
check('sell, observed 2026-07-28', routeMod.ORDER_ROUTES.sell, '/api/stocks/sell');

console.log('\n— route learning (paths move between deploys) —');
routeMod.learnRoute('GET', '/api/stocks/sell');
check('a GET teaches nothing', routeMod.ORDER_ROUTES.sell, '/api/stocks/sell');
routeMod.learnRoute('POST', '/api/stocks/nonsense');
check('an unrelated POST teaches nothing', routeMod.ORDER_ROUTES.sell, '/api/stocks/sell');
routeMod.learnRoute('POST', '/api/v2/stocks/sell');
check('a moved route seen on the wire wins over the default',
  routeMod.ORDER_ROUTES.sell, '/api/v2/stocks/sell');
check('...and does not disturb the other side', routeMod.ORDER_ROUTES.buy, '/api/stocks/buy');

console.log(fail ? `\nFAIL (${fail})` : '\nALL OK');
process.exit(fail ? 1 : 0);
