// A fence and a behaviour test around tools/audit-jack.js.
//
// The audit is the offline half of jack-watch's arithmetic: it reads a file, lifts the
// panel's own engine, and asks the questions the panel refuses to. Three things it has to
// hold, and this file is why they stay held.
//
//   It originates nothing and writes nothing. A file reader that prints text has no reason
//   for a network API, a browser API, a child process or a file write to appear in it.
//
//   It lifts the engine rather than copying it. Every "what the panel prints" figure has
//   to be the panel's arithmetic; a second solver in this repo is a second answer waiting
//   to disagree. The receipt checks are written independently ON PURPOSE, and the fixture
//   below is what proves they catch what they are for: each check is run on a clean ledger
//   and then on the same ledger with one receipt bent, and has to flag exactly that one.
//
//   It reads both shapes. A store collection (tools["pkbj:"].keys.data.corps[id].hands,
//   an object keyed by hand id) and a LOG "save" bundle (jack-watch/round-ledger, rounds[]
//   in the export's own names) have to come out as the same ledger — and a bundle from
//   before 0.13.0 has to be named as one, because its own money figures were on a
//   different base.
//
// Run: node userscripts/tools/test-audit-jack.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE = path.join(__dirname, '..', '..', 'tools', 'audit-jack.js');
const SRC = fs.readFileSync(FILE, 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        ${detail}`); fail++; }
};
const same = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want),
  `got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
const near = (label, got, want, eps) => check(label, typeof got === 'number' && Math.abs(got - want) <= eps,
  `got ${got}, want ~${want} (±${eps})`);
const absent = (label, re) => {
  const hits = CODE.match(re) || [];
  check(label, hits.length === 0, `found: ${hits.slice(0, 4).join(' | ')}`);
};

// ---------------------------------------------------------------------------
console.log('\n— it originates nothing and writes nothing —');
absent('it never fetches', /(?<![.\w])fetch\s*\(/g);
absent('it never constructs an XHR or a socket', /XMLHttpRequest|new\s+WebSocket|EventSource/g);
absent('it requires no network or process module', /require\(\s*['"`](http|https|net|dns|tls|child_process|dgram|worker_threads)['"`]\s*\)/g);
absent('it never imports at runtime', /\bimport\s*\(/g);
absent('it never touches a browser', /localStorage|document\.|window\./g);
absent('it writes no file at all', /writeFileSync|createWriteStream|appendFileSync|writeFile\(/g);

console.log('\n— it lifts the engine rather than copying it —');
check('it slices between the ENGINE markers', /ENGINE START/.test(SRC) && /ENGINE END/.test(SRC), 'markers not referenced');
absent('no second solver: dealerDist is not defined here', /const dealerDist\s*=/g);
absent('...nor roundEV', /const roundEV\s*=/g);
absent('...nor replayHand', /const replayHand\s*=/g);
check('the receipt totaller IS its own, because that check is meant to be independent',
  /const total = \(cards\)/.test(SRC), 'no independent totaller');
check('every figure is bucketed', ['COMPUTED', 'MEASURED', 'ESTIMATED'].every((w) => SRC.includes(`'${w}'`)), 'a bucket label is missing');

// ---------------------------------------------------------------------------
const A = require(FILE);
const E = A.liftEngine();

console.log('\n— the two fixed numbers agree with each other —');
{
  const hs = A.histStats();
  near('the histogram weights sum to one, near enough to normalise', hs.total, 1, 0.001);
  near('...and its mean is the edge, to the rounding of the weights', hs.mean, -0.0046, 0.0006);
  near('...and its sd is the fixed sd', hs.sd, A.FIXED_SD, 0.002);
  const r1 = A.mulberry32(7), r2 = A.mulberry32(7);
  same('the generator is seeded', [r1(), r1(), r1()], [r2(), r2(), r2()]);
  const xs = Array.from({ length: 1000 }, A.mulberry32(99));
  check('...and stays inside [0, 1)', xs.every((x) => x >= 0 && x < 1), 'out of range');
}

console.log('\n— chi-square, against the 5% critical values —');
near('1 df', A.chiP(3.841, 1), 0.05, 2e-4);
near('3 df', A.chiP(7.815, 3), 0.05, 2e-4);
near('9 df', A.chiP(16.919, 9), 0.05, 2e-4);
near('51 df', A.chiP(68.669, 51), 0.05, 2e-4);
near('12 df, the 2026-09-04 rank test', A.chiP(13.53, 12), 0.332, 0.003);
same('zero is certainty and junk is refused', [A.chiP(0, 5), A.chiP(-1, 3), A.chiP(3, 0)], [1, null, null]);

// ---------------------------------------------------------------------------
// The fixture. Nine settled rounds and one live one, at a $100 bet, on two Eastern days —
// one of them stamped after midnight UTC and before midnight Eastern, because that is the
// boundary a calendar day has to be taken on. Every receipt is right; the checks below
// bend one at a time.
//
//   1001 win      19 v 17           +100
//   1002 lose     hit 11 → 15 v 17  -100      two departures: hit an 11 vs 7, stood 15 vs 7
//   1003 natural  A K v 17          +150      paid 3:2
//   1004 dealer natural  15 v A Q   -100      stamped 03:30Z = 23:30 ET the day before
//   1005 double   5 6 T v 6 T 9     +200      dealer bust, 2× on a $200 stake
//   1006 split    8 T | 8 9 v 7 T   +100      one half won, one pushed
//   1007 bust     T 6 9 v T 6       -100      dealer left on 16: does not play out a bust
//   1008 push     9 9 v T 8            0      stood a pair of nines against a TEN — correct
//   1009 lose     T 6 v A 6         -100      stood 16 against an ace
//   1010 live     no settlement, excluded and counted
//
// Cumulative: 100 0 150 50 250 350 250 250 150 — peak +350 at #1006, trough +150 at
// #1009, so the drawdown is $200 over 3 rounds; and with pushes ignored, #1007 and #1009
// are a losing run of two.
const S = (iso) => Date.parse(iso);
const H = (id, seen, dealer, hands, open, total, gross, net, outcome, status = 'settled') =>
  ({ id, status, outcome, cur: 0, allowed: [], dealer, hands, open, total, gross, tax: 0, net, seen });
const P = (cards, stake, outcome) => ({ cards, stake, outcome, status: 'resolved' });
const clean = () => [
  H(1001, S('2026-09-10T20:00:00-04:00'), ['9H', '8C'], [P(['10S', '9D'], 100, 'won')], 100, 100, 200, 200, 'won'),
  H(1002, S('2026-09-10T20:01:00-04:00'), ['10D', '7S'], [P(['6H', '5C', '4D'], 100, 'lost')], 100, 100, 0, 0, 'lost'),
  H(1003, S('2026-09-10T20:02:00-04:00'), ['9S', '8D'], [P(['AS', 'KH'], 100, 'blackjack')], 100, 100, 250, 250, 'won'),
  H(1004, S('2026-09-11T03:30:00Z'), ['AD', 'QS'], [P(['8H', '7C'], 100, 'lost')], 100, 100, 0, 0, 'lost'),
  H(1005, S('2026-09-11T10:00:00-04:00'), ['6D', '10H', '9S'], [P(['5H', '6C', '10D'], 200, 'won')], 100, 200, 400, 400, 'won'),
  H(1006, S('2026-09-11T10:01:00-04:00'), ['7H', '10C'], [P(['8S', '10D'], 100, 'won'), P(['8H', '9C'], 100, 'push')], 100, 200, 300, 300, 'mixed'),
  H(1007, S('2026-09-11T10:02:00-04:00'), ['10S', '6D'], [P(['10H', '6C', '9D'], 100, 'lost')], 100, 100, 0, 0, 'lost'),
  H(1008, S('2026-09-11T10:03:00-04:00'), ['10S', '8D'], [P(['9H', '9C'], 100, 'push')], 100, 100, 100, 100, 'push'),
  H(1009, S('2026-09-11T10:04:00-04:00'), ['AS', '6D'], [P(['10H', '6C'], 100, 'lost')], 100, 100, 0, 0, 'lost'),
  { id: 1010, status: 'player_turn', outcome: null, cur: 0, allowed: ['hit', 'stand'], dealer: ['5C', 'hidden'],
    hands: [{ cards: ['9D', '2H'], stake: 100, outcome: null, status: null }], open: 100, seen: S('2026-09-11T10:05:00-04:00') },
];
const collection = (hands, over = {}) => ({
  collected_at: '2026-09-11T15:00:00.000Z', collector: 'tools/collect-stores.js', stats: {}, redactions: [],
  tools: {
    'pkbj:': { tool: 'jack-watch', keys: {
      ui: { mark: { 30: 1006 } },
      data: { corps: { 30: { cfg: null, hands: Object.fromEntries(hands.map((h) => [String(h.id), h])) } },
        edge: { key: 'd6s17das1split', edge: 0.004593195974693846, deals: 550 } },
    } },
    ...over,
  },
});
const bundle = (hands, version = 3) => ({
  format: 'jack-watch/round-ledger', version, tool: 'jack-watch test', collected_at: '2026-09-11T15:00:00.000Z',
  scope: { corporation: '30', rounds_exported: hands.length, rounds_held: hands.length, hidden_by_mark: 0, mark: 1006 },
  edge: { computed: 0.004593195974693846 },
  rounds: hands.map((h) => ({
    id: h.id, first_seen: new Date(h.seen).toISOString(), status: h.status, outcome: h.outcome,
    opening_bet: h.open, total_staked: h.total ?? null, gross: h.gross ?? null, tax: h.tax ?? null, credited: h.net ?? null,
    result: h.net == null ? null : h.net - h.total, allowed_at_last_sighting: h.allowed, current_hand: h.cur,
    dealer: h.dealer.slice(), split: h.hands.length > 1,
    hands: h.hands.map((p) => ({ cards: p.cards.slice(), stake: p.stake, outcome: p.outcome, status: p.status })),
    decisions: null, no_decisions: null, observed: null,
  })),
});

// ---------------------------------------------------------------------------
console.log('\n— it reads both shapes as one ledger —');
let L;
{
  L = A.detect(collection(clean()));
  same('a store collection is recognised', [L.kind, L.corp, L.mark, L.version], ['store collection', '30', 1006, null]);
  same('...its hands come out sorted by id', L.hands.map((h) => h.id), [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010]);
  same('...with the live round kept but not settled', L.hands.filter((h) => h.status === 'settled').length, 9);
  near('...and the edge it carried', L.storedEdge, 0.0045932, 1e-6);

  const B = A.detect(bundle(clean()));
  same('a save bundle is recognised', [B.kind, B.corp, B.mark, B.version], ['save bundle', '30', 1006, 3]);
  same('...and is the same ledger', B.hands.map((h) => [h.id, h.open, h.total, h.gross, h.net, h.seen]),
    L.hands.map((h) => [h.id, h.open, h.total, h.gross, h.net, h.seen]));
  same('...cards and stakes included', B.hands[5].hands, L.hands[5].hands);
  same('a pre-0.13.0 bundle loads and says which version it is', A.detect(bundle(clean(), 2)).version, 2);

  let threw = null;
  try { A.detect({ hello: 'world' }); } catch (e) { threw = e.message; }
  check('anything else is refused with a reason', /not a store collection/.test(threw || ''), String(threw));

  const two = collection(clean());
  two.tools['pkbj:'].keys.data.corps['31'] = { cfg: null, hands: { 5: H(5, S('2026-09-11T10:00:00-04:00'), ['9H', '8C'], [P(['10S', '9D'], 10, 'won')], 10, 10, 20, 20, 'won') } };
  same('two tables: the fullest is picked by default', A.detect(two).corp, '30');
  same('...and --corp picks the other', [A.detect(two, { corp: '31' }).corp, A.detect(two, { corp: 31 }).hands.length], ['31', 1]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-jack-'));
  const f1 = path.join(dir, 'politiko-stores-2026-09-11_15-00-00.json');
  const f2 = path.join(dir, 'jack-watch-round-ledger.json');
  fs.writeFileSync(f1, JSON.stringify(collection(clean())));
  fs.writeFileSync(f2, JSON.stringify(bundle(clean())));
  same('a collection on disk is detected by content, not by name', A.loadFile(f1).kind, 'store collection');
  same('...and so is a bundle', A.loadFile(f2).kind, 'save bundle');
  same('the newest collection in a directory is found by its name', path.basename(A.listCollections(dir)[0]), path.basename(f1));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n— the slices —');
{
  const s = A.slicesOf(L);
  same('whole, each Eastern day, above the mark', s.map((x) => x.name),
    ['whole ledger', 'seen 2026-09-10 (Eastern)', 'seen 2026-09-11 (Eastern)', 'above the LOG mark #1006']);
  same('the whole ledger is the settled rounds', s[0].list.length, 9);
  same('a round seen at 03:30Z is still the day before in New York', s[1].list.map((h) => h.id), [1001, 1002, 1003, 1004]);
  same('...and the rest are the next day', s[2].list.map((h) => h.id), [1005, 1006, 1007, 1008, 1009]);
  same('above the mark is strictly above', s[3].list.map((h) => h.id), [1007, 1008, 1009]);
  const noMark = A.detect(collection(clean()));
  noMark.mark = null;
  same('no mark, no slice — and it says so rather than slicing everything', A.slicesOf(noMark)[3].list, null);
  same('--scope narrows', A.slicesOf(L, ['whole']).length, 1);
}

// ---------------------------------------------------------------------------
console.log('\n— 1. money, as the panel prints it —');
const settled = L.hands.filter((h) => h.status === 'settled');
const EDGE = E.roundEV(E.freshShoe()).edge;
{
  const m = A.moneyOf(E, settled, EDGE);
  same('the sums are the panel\'s', [m.roll.n, m.roll.opened, m.roll.wagered, m.roll.credited, m.roll.net], [9, 900, 1100, 1250, 150]);
  same('...wins, pushes, losses', [m.roll.wins, m.roll.pushes, m.roll.losses, m.roll.naturals], [4, 1, 4, 1]);
  near('expectation is the edge on the OPENING bets', m.expected, -900 * EDGE, 1e-9);
  near('...which is what the panel charges since 0.13.0', m.panel.expected, m.expected, 1e-9);
  near('...and the old base is kept beside it for reading a 0.12.0 screen', m.expectedOldBase, -1100 * EDGE, 1e-9);
  near('the fixed-sd distance is the same expectation over sqrt(sum of squared bets) × 1.146',
    m.fixed.z, (150 + 900 * EDGE) / (300 * A.FIXED_SD), 1e-9);
  check('the sample sd carries its count', m.sdN === 9 && m.sdSample > 0, `${m.sdN} ${m.sdSample}`);
  const one = A.moneyOf(E, settled.slice(0, 1), EDGE);
  same('one round has no sample distance', one.panel, null);
  check('...but still has a fixed-sd one', one.fixed !== null && Number.isFinite(one.fixed.z), JSON.stringify(one.fixed));
}

console.log('\n— 2. decisions, replayed —');
{
  const d = A.decisionsOf(E, settled);
  same('rounds by replay status', [...d.reasons.entries()].sort(), [['dealer natural', 1], ['player natural', 1], ['replayed', 6], ['split', 1]]);
  // 1001 stood 19, 1005 doubled 11 v 6, 1007 hit 16 v T, 1008 stood nines v T: four right.
  // 1002 hit an 11 v 7 and then stood 15 v 7, 1009 stood 16 v A: three wrong.
  same('seven decisions, four at the maximum', [d.roll.n, d.roll.matched], [7, 4]);
  const second = d.all.find((x) => x.id === 1002 && x.held.length === 3);
  same('the cards held at each decision are rebuilt from the walk', [second.held, second.total, second.up, second.act, second.want],
    [['6H', '5C', '4D'], 15, '10D', 'stand', 'hit']);
  same('the worst is sorted by cost and names the press', d.worst.every((w, i, a) => i === 0 || a[i - 1].cost >= w.cost), true);
  check('sixteen stood against an ace is in it', d.worst.some((w) => w.id === 1009 && w.act === 'stand' && w.want === 'hit'), JSON.stringify(d.worst.map((w) => w.id)));
  check('EV given up is the sum of the departures', Math.abs(d.roll.cost - d.worst.reduce((a, w) => a + w.cost, 0)) < 1e-9, `${d.roll.cost}`);
}

// ---------------------------------------------------------------------------
console.log('\n— 3. receipts: a clean ledger passes every check —');
{
  const rc = A.receiptsOf(settled, 8);
  same('reconcile', [rc.reconcile.n, rc.reconcile.bad.length], [9, 0]);
  same('naturals paid 3:2', [rc.naturals.n, rc.naturals.bad.length], [1, 0]);
  same('the peek', [rc.dealerNaturals.n, rc.dealerNaturals.bad.length], [1, 0]);
  same('S17 on the six rounds the dealer played out', [rc.s17.n, rc.s17.bad.length], [6, 0]);
  same('...with the all-bust round excluded and its short dealer counted', [rc.s17.bustedRounds, rc.s17.bustedShort], [1, 1]);
  same('single-hand gross from the cards, naturals excluded, dealer naturals included', [rc.gross.n, rc.gross.bad.length], [7, 0]);
  same('the split, both halves', [rc.splits.n, rc.splits.bad.length, rc.splits.aceTwentyOnes.length], [1, 0, 0]);
}

console.log('\n— 3. receipts: each check catches the one thing it is for —');
{
  const bent = (fn) => { const hs = clean(); fn(Object.fromEntries(hs.map((h) => [h.id, h]))); return A.receiptsOf(hs.filter((h) => h.status === 'settled'), 8); };
  const r1 = bent((h) => { h[1003].gross = 200; h[1003].net = 200; });
  same('a natural paid even money', [r1.naturals.bad.length, r1.naturals.bad[0].id, r1.naturals.bad[0].want], [1, 1003, 250]);
  const r2 = bent((h) => { h[1004].total = 200; });
  same('a dealer natural collecting a doubled stake', [r2.dealerNaturals.bad.length, r2.dealerNaturals.bad[0].id], [1, 1004]);
  const r3 = bent((h) => { h[1001].dealer = ['9H', '7C']; });
  check('the dealer standing on sixteen', r3.s17.bad.length === 1 && /stood on 16/.test(r3.s17.bad[0].why), JSON.stringify(r3.s17.bad));
  const r4 = bent((h) => { h[1008].dealer = ['10S', '8D', '2C']; });
  check('the dealer drawing on eighteen', r4.s17.bad.length === 1 && /drew on 18/.test(r4.s17.bad[0].why), JSON.stringify(r4.s17.bad));
  const r4b = bent((h) => { h[1009].dealer = ['AS', '6D', '4C']; });
  check('...or on a SOFT seventeen, which S17 stands', r4b.s17.bad.length === 1 && /drew on soft 17/.test(r4b.s17.bad[0].why), JSON.stringify(r4b.s17.bad));
  const r5 = bent((h) => { h[1001].gross = 300; h[1001].net = 300; });
  same('a gross the cards do not support', [r5.gross.bad.length, r5.gross.bad[0].id, r5.gross.bad[0].want], [1, 1001, 200]);
  const r6 = bent((h) => { h[1006].gross = 400; h[1006].net = 400; });
  same('...on a split too', [r6.splits.bad.length, r6.splits.bad[0].want], [1, 300]);
  const r7 = bent((h) => { h[1001].net = 150; });
  same('gross − tax ≠ net', [r7.reconcile.bad.length, r7.reconcile.bad[0].id], [1, 1001]);
  const r8 = bent((h) => {
    h[1006].hands = [P(['AS', 'KD'], 100, 'won'), P(['AH', '5C'], 100, 'lost')];
    h[1006].gross = 250; h[1006].net = 250;
  });
  check('a 21 on a split ace is listed with what it paid, because nothing states it',
    r8.splits.aceTwentyOnes.length === 1 && r8.splits.aceTwentyOnes[0].evenMoney === 200 && r8.splits.aceTwentyOnes[0].gross === 250,
    JSON.stringify(r8.splits.aceTwentyOnes));
  same('...and the even-money assumption is what the mismatch is measured against', r8.splits.bad.length, 1);
}

// ---------------------------------------------------------------------------
console.log('\n— 4. card fairness —');
{
  const f = A.fairnessOf(settled, 6);
  same('every card in every settled round is counted', [f.n, f.hidden], [42, 0]);
  same('a split round\'s player cards are pooled but not placed', [f.splitRounds, f.unplaced], [1, 4]);
  same('the three tests carry their degrees of freedom', [f.rank.df, f.code.df, f.suit.df], [9, 51, 3]);
  check('...and a p each', [f.rank.p, f.code.p, f.suit.p].every((p) => p >= 0 && p <= 1), JSON.stringify([f.rank.p, f.code.p, f.suit.p]));
  same('the position table has every seat and a total', f.positions.map((q) => q.pos),
    ['dealer up', 'hole', 'dealer draws', 'player 1st', 'player 2nd', 'player draws', 'all']);
  same('...one first card per non-split round', f.positions.find((q) => q.pos === 'player 1st').n, 8);
  same('...and the total is every card', f.positions.find((q) => q.pos === 'all').n, 42);
  same('the top code deviations are listed for reading a borderline χ²', f.code.top.length, 6);
  same('codes never seen are named', f.code.missing.length + Object.keys(f.code.top).length > 0, true);
  const tens = f.positions.find((q) => q.pos === 'all').tens;
  near('the tens share is a count over the cards', tens.share, 12 / 42, 1e-12);
  const hiddenHand = A.fairnessOf([H(1, 1, ['5C', 'hidden'], [P(['9D', '2H'], 100, null)], 100, 100, 0, 0, 'lost')], 6);
  same('a face-down card is counted as unseen, never as a card', [hiddenHand.n, hiddenHand.hidden], [3, 1]);
}

// ---------------------------------------------------------------------------
console.log('\n— 5. the observed slide —');
{
  const o = A.observedOf(E, settled);
  same('final, drawdown, where and how long', [o.n, o.final, o.maxDD, o.peakId, o.troughId, o.peakCum, o.troughCum, o.slideN],
    [9, 150, 200, 1006, 1009, 350, 150, 3]);
  same('the longest losing run ignores the push in the middle of it', [o.run, o.runFrom, o.runTo], [2, 1007, 1009]);
  const strict = A.observedOf(E, settled.filter((h) => h.id !== 1008));
  same('...and is the same two losses without it', [strict.run, strict.runFrom, strict.runTo], [2, 1007, 1009]);
  same('the opening bets, in order, are what the resampling replays', o.opens, new Array(9).fill(100));
  const down = A.observedOf(E, settled.filter((h) => h.id === 1002 || h.id === 1004 || h.id === 1007));
  same('a ledger that only fell peaked at the start', [down.peakIsStart, down.maxDD, down.run, down.slideN], [true, 300, 3, 3]);
  const flat = A.observedOf(E, settled.filter((h) => h.id === 1001 || h.id === 1003));
  same('...and one that only rose has no drawdown', [flat.maxDD, flat.slideN, flat.run], [0, 0, 0]);
}

console.log('\n— 5. the resampling —');
{
  const o = A.observedOf(E, settled);
  const a = A.resample(o.opens, o, { sims: 20000, seed: 20260917, window: o.slideN });
  const b = A.resample(o.opens, o, { sims: 20000, seed: 20260917, window: o.slideN });
  same('the same seed gives the same ledgers', [a.final.median, a.dd.mean, a.win.p5, a.run.p90, a.dd.pAtLeastObs],
    [b.final.median, b.dd.mean, b.win.p5, b.run.p90, b.dd.pAtLeastObs]);
  const c = A.resample(o.opens, o, { sims: 20000, seed: 1, window: o.slideN });
  check('...and a different seed gives different ones', c.dd.mean !== a.dd.mean, `${c.dd.mean} vs ${a.dd.mean}`);
  same('it counts what it drew', [a.sims, a.n, a.draws], [20000, 9, 180000]);
  near('the drawn mean is the histogram\'s', a.meanRet, A.histStats().mean, 0.01);
  near('...and so is the drawn sd', a.sdRet, A.FIXED_SD, 0.01);
  check('every probability is a fraction of the ledgers', [a.final.pAtMostObs, a.dd.pAtLeastObs, a.win.pAtMostObs, a.run.pAtLeastObs]
    .every((p) => p >= 0 && p <= 1), JSON.stringify(a));
  check('a $200 drawdown in nine rounds at $100 is common, and so are two losses in a row',
    a.dd.pAtLeastObs > 0.5 && a.run.pAtLeastObs > 0.7, `${a.dd.pAtLeastObs} ${a.run.pAtLeastObs}`);
  check('the quantiles are ordered', a.final.p5 <= a.final.median && a.final.median <= a.final.p95
    && a.dd.median <= a.dd.p75 && a.dd.p75 <= a.dd.p90 && a.win.p5 <= a.win.p10 && a.win.p10 <= a.win.median, JSON.stringify(a));
  same('the window is the observed slide length', a.win.N, 3);
  const noWin = A.resample(o.opens, o, { sims: 100, seed: 3, window: 0 });
  same('no slide, no window statistic', [noWin.win.N, noWin.win.median, noWin.win.pAtMostObs], [0, null, null]);
}

// ---------------------------------------------------------------------------
console.log('\n— the report —');
{
  const text = A.report(L, { engine: E, sims: 500 });
  check('it is headed', /^# jack-watch ledger audit/.test(text), text.slice(0, 40));
  for (const s of ['## whole ledger', '## seen 2026-09-10 (Eastern)', '## seen 2026-09-11 (Eastern)', '## above the LOG mark #1006',
    '— 1. money', '— 2. decisions', '— 3. receipts', '— 4. card fairness', '— 5. drawdown']) {
    check(`it prints "${s}"`, text.includes(s), 'missing');
  }
  check('every bucket appears', ['[COMPUTED]', '[MEASURED]', '[ESTIMATED]'].every((w) => text.includes(w)), 'a bucket is missing');
  check('the mark slice has three rounds', /above the LOG mark #1006\n\n— 1\. money[^\n]*\n  rounds\s+3 /.test(text), 'mark slice not three rounds');
  check('the resampling names its source and seed', /30M simulated rounds, 2026-09-17/.test(text) && /seed 20260917/.test(text), 'source or seed missing');
  check('the live round is counted and not audited', /rounds held\s+10 \(9 settled, 1 not\)/.test(text), 'held/settled line');
  check('a scope option narrows the report', !A.report(L, { engine: E, sims: 0, scope: ['whole'] }).includes('## seen'), 'days printed anyway');
  const old = A.detect(bundle(clean(), 2));
  check('a pre-0.13.0 bundle is named as one', A.report(old, { engine: E, sims: 0, scope: ['whole'] }).includes('pre-0.13.0'), 'no note');
  const empty = A.detect(collection([]));
  const e = A.report(empty, { engine: E, sims: 0 });
  check('an empty ledger reports rather than throws', /no settled rounds/.test(e) && /rounds held\s+0/.test(e), e.slice(0, 200));
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
