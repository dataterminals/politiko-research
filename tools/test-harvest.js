// Slices the real sampler out of market-watch.user.js and exercises it, so the
// test can't drift from the shipped source.
const fs = require('fs');
const SRC = fs.readFileSync(require('path').join(__dirname,'..','market-watch.user.js'), 'utf8');

const between = (a, b) => {
  const i = SRC.indexOf(a), j = SRC.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`marker not found: ${i < 0 ? a : b}`);
  return SRC.slice(i, j);
};

const sampler = between('const ID_KEYS', '// Passive tap');

const preamble = `
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const location = { origin: 'https://politiko.io' };
  const entityIds = new Map();
  const saveIds = () => {};
`;

const mod = new Function(
  `${preamble}\n${sampler}\nreturn { scopeOf, harvest, identityOf, entityIds };`)();

const cases = [
  ['/api/public/stats', {
    citizens: 291, online_now: 0, game_year: 7, game_day: 298,
    active_corps: 15, bills_passed: 3, bills_killed: 89, president_name: 'President Hoppe',
  }],
  ['/api/public/drug-markets', [
    { city: 'Riga', weed: 131, cocaine: 940, heat: 4 },
    { city: 'Vilnius', weed: 118, cocaine: 1020, heat: 7 },
  ]],
  ['/api/public/top-corps', { data: [
    { id: 12, name: 'Baltic Freight', revenue: 84000, employees: 12 },
    { id: 19, name: 'Nordkraft', revenue: 61250, employees: 8 },
  ] }],
  // hypothetical share market, nested + paginated
  ['/api/market/stocks?page=2', {
    page: 2, limit: 50, total_pages: 3, updated_at: 1753600000,
    data: [
      { symbol: 'ACME', price: 12.53, change_pct: 3.11, volume: 9001, meta: { float: 250000 } },
      { symbol: 'HOPX', price: 4.02, change_pct: -1.8, volume: 411, meta: { float: 90000 } },
    ],
  }],
  // keyed map rather than a list
  ['/api/market/index', { markets: { riga: { volume: 12, spread: 0.4 }, vilnius: { volume: 8, spread: 0.9 } } }],
];

let fail = 0;
for (const [url, payload] of cases) {
  const scope = mod.scopeOf(url);
  const out = [];
  mod.harvest(payload, scope, out);
  console.log(`\n${url}   → scope "${scope}"`);
  if (!out.length) { console.log('   !! NOTHING HARVESTED'); fail++; continue; }
  for (const [s, f, v] of out) console.log(`   ${s} :: ${f} = ${v}`);
}

// leak checks
const leaks = [];
{
  const out = [];
  mod.harvest(cases[3][1], mod.scopeOf(cases[3][0]), out);
  for (const [, f] of out) if (/^(page|limit|total_pages|updated_at)$/.test(f)) leaks.push(f);
}
console.log(`\npagination/meta fields leaked as series: ${leaks.length ? leaks.join(', ') : 'none'}`);
if (leaks.length) fail++;

// Order requests are addressed by instrument_id, and SKIP_FIELD keeps *_id out of
// the series data — so the id has to be captured on the side, with provenance.
console.log('\ninstrument ids captured alongside tickers:');
mod.entityIds.clear();
mod.harvest([{ id: 10, symbol: 'RCRD', price: 28.7 }], 'stocks/instruments', []);
mod.harvest([{ id: 77, symbol: 'RCRD', shares: 92 }], 'stocks/holdings', []);
mod.harvest([{ instrument_id: 42, symbol: 'BRDL', shares: 5 }], 'stocks/holdings', []);
for (const [k, v] of mod.entityIds) console.log(`   ${k} -> ${v.id} (sure: ${v.sure})`);

const expect = (k, want) => {
  const got = mod.entityIds.get(k);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${k}`);
  if (!ok) { console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); fail++; }
};
expect('stocks/instruments/RCRD', { id: 10, sure: true });   // bare id, but on the instruments list
expect('stocks/holdings/RCRD', { id: 77, sure: false });     // bare id on a holding: not an instrument id
expect('stocks/holdings/BRDL', { id: 42, sure: true });      // named instrument_id: unambiguous
console.log(fail ? `\nFAIL (${fail})` : '\nOK');
process.exit(fail ? 1 : 0);
