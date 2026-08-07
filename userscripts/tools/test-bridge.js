// Exercises the Time Bridge's logic against stubbed GM storage and localStorage.
//
// The bridge cannot be run in a plain browser — GM_getValue/GM_setValue only exist
// inside a userscript manager — so the parts worth being sure about are sliced out and
// driven here instead. What matters is that an anchor only ever moves forward: a stale
// sample overwriting a fresh one would wind the planner's clock backwards, and nothing
// downstream would flag it.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'time-bridge.user.js'), 'utf8');

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from} .. ${to}`);
  return SRC.slice(i, j);
};

const SLICE = cut('  /** Newest {t, gs, accel} sample', '  // ---------------------------------------------------------------------------\n  // Time Wire — drop it');

const build = ({ samples, held }) => {
  const store = { gm: held, ls: { 'pktw:samples': samples == null ? null : JSON.stringify(samples) } };
  const localStorage = { getItem: (k) => store.ls[k] ?? null };
  const GM_getValue = () => store.gm ?? null;
  const GM_setValue = (_k, v) => { store.gm = v; };
  const api = new Function(
    'localStorage', 'GM_getValue', 'GM_setValue', 'SAMPLES', 'SLOT', 'FALLBACK_ACCEL', 'log',
    `${SLICE}\nreturn { publish, newestSample, codeOf };`,
  )(localStorage, GM_getValue, GM_setValue, 'pktw:samples', 'pkt1', 52.14, () => {});
  return { api, store };
};

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

const T0 = Date.UTC(2026, 7, 7, 12, 0, 0);
const sample = (t, gs, accel) => ({ t, gs, accel });

console.log('\n— picking the newest sample —');
{
  const { api } = build({ samples: { first: sample(T0, 100, 52.14), recent: [] } });
  check('falls back to first when nothing recent', api.newestSample().t, T0);
}
{
  const { api } = build({
    samples: { first: sample(T0, 100, 52.14), recent: [sample(T0 + 1000, 200, 52.14), sample(T0 + 5000, 300, 52.14)] },
  });
  check('takes the last recent sample', api.newestSample().gs, 300);
}
{
  const { api } = build({ samples: null });
  check('no store means no sample', api.newestSample(), null);
}
{
  const { api } = build({ samples: { first: { t: 'nope', gs: 1 }, recent: [] } });
  check('a malformed sample is rejected', api.newestSample(), null);
}

console.log('\n— the code it emits —');
{
  const { api } = build({ samples: { first: sample(T0, 242403780, 52.14), recent: [] } });
  check('PKT1 shape', api.codeOf(api.newestSample()),
    'PKT1|2026-08-07T12:00:00.000Z|242403780|52.14');
}
{
  const { api } = build({ samples: { first: sample(T0, 1, 0), recent: [] } });
  check('a missing rate falls back rather than emitting zero',
    api.codeOf(api.newestSample()).split('|')[3], '52.14');
}

console.log('\n— an anchor only ever moves forward —');
{
  const { api, store } = build({ samples: { first: sample(T0, 100, 52.14), recent: [] } });
  api.publish();
  check('first publish takes', store.gm.t, T0);
}
{
  const { api, store } = build({
    samples: { first: sample(T0, 100, 52.14), recent: [] },
    held: { t: T0 + 60_000, code: 'PKT1|newer' },
  });
  api.publish();
  check('an older sample does not overwrite a newer anchor', store.gm.code, 'PKT1|newer');
}
{
  const { api, store } = build({
    samples: { first: sample(T0, 1, 52.14), recent: [sample(T0 + 60_000, 999, 52.14)] },
    held: { t: T0, code: 'PKT1|older' },
  });
  api.publish();
  check('a newer sample does overwrite', store.gm.t, T0 + 60_000);
  check('...with the new reading', store.gm.code.split('|')[2], '999');
}
{
  const { api, store } = build({
    samples: { first: sample(T0, 100, 52.14), recent: [] },
    held: { t: T0, code: 'PKT1|same' },
  });
  api.publish();
  check('an equal timestamp is not republished', store.gm.code, 'PKT1|same');
}
{
  const { api, store } = build({ samples: null, held: { t: T0, code: 'PKT1|kept' } });
  api.publish();
  check('nothing to publish leaves the slot alone', store.gm.code, 'PKT1|kept');
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
