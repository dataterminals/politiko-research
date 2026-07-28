// Slices the real derived-views layer and exercises it against a history shaped
// like the live stocks page (symbols + fields taken from an actual panel capture).
const fs = require('fs');
const SRC = fs.readFileSync(require('path').join(__dirname,'..','userscripts','market-watch.user.js'), 'utf8');

const i = SRC.indexOf('const HEADLINE'), j = SRC.indexOf('function sparkline');
if (i < 0 || j < 0) throw new Error('markers not found');
const views = SRC.slice(i, j);

// Real field set + a plausible tick history.
const hist = {};
const push = (k, vals) => { hist[k] = vals.map((v, n) => [1000 + n * 60000, v]); };

const INSTRUMENTS = {
  PNRG: { price: [103.8, 102.4, 101.05], float_shares: 50_000_000, ipo: 1408, spread: 93 },
  RCRD: { price: [28.34, 28.5, 28.74],   float_shares: 35_000_000, ipo: 1408, spread: 57 },
  SNTL: { price: [85.6, 85.0, 84.43],    float_shares: 30_000_000, ipo: 1408, spread: 100 },
  USTL: { price: [386.1, 386.9, 387.24], float_shares: 60_000_000, ipo: 1408, spread: 172 },
};
for (const [sym, d] of Object.entries(INSTRUMENTS)) {
  const s = `stocks/instruments/${sym}`;
  push(`${s}::price`, d.price);
  push(`${s}::bid`, d.price.map((p) => +(p - 0.5).toFixed(2)));
  push(`${s}::ask`, d.price.map((p) => +(p + 0.5).toFixed(2)));
  push(`${s}::float_shares`, [d.float_shares, d.float_shares, d.float_shares]);
  push(`${s}::ipo_game_day`, [d.ipo, d.ipo, d.ipo]);
  push(`${s}::spread_bps`, [d.spread, d.spread, d.spread]);
}
push('stocks/tax::owed', [0, 0, 0]);

// Holdings, with the field names confirmed from a live panel capture. Note that
// `shares` and `avg_cost` sit still for a player who isn't trading — that must
// not be mistaken for immutable metadata.
push('stocks/holdings/SNTL::avg_cost', [86, 86, 86]);
push('stocks/holdings/SNTL::current_price', [85.6, 88.1, 89.72]);
push('stocks/holdings/SNTL::market_value', [85.6, 88.1, 89.72]);
push('stocks/holdings/SNTL::shares', [1, 1, 1]);
push('stocks/holdings/SNTL::unrealized_pnl', [-0.4, 2.1, 3.72]);

const isStatic = (key) => {
  const a = hist[key];
  if (!a || a.length < 3) return false;
  return a.every((p) => p[1] === a[0][1]);
};

const mod = new Function('hist', 'isStatic',
  `${views}\nreturn { seriesIndex, groupsOf, headlineField, shortSeries, splitSeries, demoted };`)(hist, isStatic);

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
  if (!ok) fail++;
};

const groups = mod.groupsOf();
console.log('groups:');
for (const [g, items] of groups) console.log(`   ${g || '(root)'} → ${items.map((i) => i.entity).join(', ')}`);

check('groups, biggest first', [...groups.keys()], ['stocks/instruments', 'stocks', 'stocks/holdings']);
check('instruments grouped by symbol',
  groups.get('stocks/instruments').map((i) => i.entity), ['PNRG', 'RCRD', 'SNTL', 'USTL']);
check('tax lands under stocks', groups.get('stocks').map((i) => i.entity), ['tax']);

console.log('\nheadline field per row:');
for (const [g, items] of groups) {
  for (const it of items) {
    const hf = mod.headlineField(it.series, it.fields);
    console.log(`   ${it.series.padEnd(28)} → ${hf}`);
  }
}
for (const sym of Object.keys(INSTRUMENTS)) {
  check(`${sym} headline is price`,
    mod.headlineField(`stocks/instruments/${sym}`, ['ask', 'bid', 'float_shares', 'ipo_game_day', 'price', 'spread_bps']),
    'price');
}
check('tax falls back to its only field',
  mod.headlineField('stocks/tax', ['owed']), 'owed');

console.log('\nstatic (auto-collapsed) fields for PNRG:');
const statics = ['ask', 'bid', 'float_shares', 'ipo_game_day', 'price', 'spread_bps']
  .filter((f) => isStatic(`stocks/instruments/PNRG::${f}`));
console.log(`   ${statics.join(', ')}`);
check('float_shares/ipo_game_day/spread_bps demoted, prices kept',
  statics, ['float_shares', 'ipo_game_day', 'spread_bps']);

check('shortSeries strips the path', mod.shortSeries('stocks/instruments/PNRG'), 'PNRG');

console.log('\n— holdings rows (live field names) —');
const HOLD = ['avg_cost', 'current_price', 'market_value', 'shares', 'unrealized_pnl'];
check('current_price wins the headline, not whatever sorts first',
  mod.headlineField('stocks/holdings/SNTL', HOLD), 'current_price');
check('a flat `shares` is NOT greyed out — sizing reads it',
  mod.demoted('stocks/holdings/SNTL', 'shares'), false);
check('a flat `avg_cost` is NOT greyed out either',
  mod.demoted('stocks/holdings/SNTL', 'avg_cost'), false);
check('genuine metadata still is',
  mod.demoted('stocks/instruments/PNRG', 'ipo_game_day'), true);
check('...and so is float_shares',
  mod.demoted('stocks/instruments/PNRG', 'float_shares'), true);
console.log('   demoted on a holdings row: ' +
  (HOLD.filter((f) => mod.demoted('stocks/holdings/SNTL', f)).join(', ') || '(none)'));

console.log(fail ? `\nFAIL (${fail})` : '\nALL OK');
process.exit(fail ? 1 : 0);
