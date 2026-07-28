// Slices the real redaction/body-parsing layer out of the userscript.
const fs = require('fs');
const SRC = fs.readFileSync(require('path').join(__dirname,'..','userscripts','market-watch.user.js'), 'utf8');
const i = SRC.indexOf('const SECRETISH'), j = SRC.indexOf('function captureWrite');
if (i < 0 || j < 0) throw new Error('markers not found');
const mod = new Function(`${SRC.slice(i, j)}\nreturn { redact, parseBody };`)();

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

// A plausible order request must survive intact — that's the whole point.
check('an order body passes through untouched',
  mod.parseBody(JSON.stringify({ symbol: 'RCRD', side: 'buy', quantity: 50 })),
  { symbol: 'RCRD', side: 'buy', quantity: 50 });

console.log('\n— redaction —');
for (const k of ['password', 'access_token', 'csrfToken', 'sessionId', 'apiKey',
  'api_key', 'Authorization', 'refresh_token', 'otp']) {
  const got = mod.parseBody(JSON.stringify({ [k]: 'hunter2', symbol: 'RCRD' }));
  check(`${k} redacted`, got, { [k]: '<redacted>', symbol: 'RCRD' });
}
check('nested secrets too',
  mod.parseBody(JSON.stringify({ order: { symbol: 'X', auth: { token: 'abc' } } })),
  { order: { symbol: 'X', auth: '<redacted>' } });
check('arrays of objects walked',
  mod.parseBody(JSON.stringify({ items: [{ qty: 1, secret: 'x' }] })),
  { items: [{ qty: 1, secret: '<redacted>' }] });

console.log('\n— non-JSON bodies —');
check('form-encoded is parsed and redacted',
  mod.redact(Object.fromEntries(new URLSearchParams('symbol=RCRD&token=abc'))),
  { symbol: 'RCRD', token: '<redacted>' });
check('unparseable body is truncated, not dropped',
  mod.parseBody('not json at all'), 'not json at all');
check('null body stays null', mod.parseBody(null), null);
const big = mod.parseBody('x'.repeat(1000));
check('long opaque body capped at 300', big.length, 300);

console.log(fail ? `\nFAIL (${fail})` : '\nALL OK');
process.exit(fail ? 1 : 0);
