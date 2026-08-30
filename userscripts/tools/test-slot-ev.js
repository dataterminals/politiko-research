// Drives slot-watch's engine — every number the panel prints — against known inputs.
//
// The panel makes three kinds of claim and they are not interchangeable, so the whole
// point of this file is to hold them apart:
//
//   EXACT.      Expected loss on a planned run is the table's own stated house edge times
//               what you would stake. "Covers" is your cash over your wager. Neither
//               assumes anything, and both are asserted here to the cent.
//
//   MEASURED.   Realized RTP, and tax drag. These are divisions of observed sums, so the
//               test that matters is the identity they have to satisfy — realized edge is
//               the gross shortfall PLUS the tax drag, always, or one of the three is
//               being computed wrong and the panel is quietly lying about what the
//               machine costs. docs/18-casino-slots-surface.md is the derivation.
//
//   ESTIMATED.  The ±1 SD band. It is a sample deviation and must carry its sample count;
//               fewer than two samples has no spread and must come back null rather than
//               zero, because a zero band reads as certainty.
//
// Two more things are load-bearing rather than taste, and both come from the surface
// rather than from arithmetic:
//
//   A free spin has no per-unit return. It pays out against a zero stake, so it is
//   excluded from the sample — folded in as a zero it would drag the mean down and invent
//   a worse machine than the one you are playing.
//
//   The same session arrives twice by two routes: as the receipt for the spin you placed,
//   which carries spins[] and both balances, and again in the history array, which is not
//   known to carry either. A later, thinner sighting must never delete what the first one
//   knew — that is what mergeSession() is for, and it is one of the easiest things in the
//   whole tool to get backwards.
//
// Run: node userscripts/tools/test-slot-ev.js
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'slot-watch.user.js'), 'utf8');
const A = '  // >>> ENGINE START';
const B = '  // <<< ENGINE END';
const i = SRC.indexOf(A);
const j = SRC.indexOf(B, i);
if (i < 0 || j <= i) throw new Error('engine markers not found in slot-watch.user.js');

// The engine is written to be liftable: no DOM, no storage, nothing it is not handed.
// If that ever stops being true this line is where it breaks, which is the point.
const E = new Function(`${SRC.slice(i, j)}
  return { num, bpsRate, RECEIPT, isReceipt, netOf, slimSpin, slimSession, mergeSession,
           rollup, mean, stdev, spinReturns, plan, curveBySession, curveBySpin, extent };`)();

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};
const near = (label, got, want, eps = 1e-9) => {
  const ok = typeof got === 'number' && Math.abs(got - want) <= eps;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${got}\n        want ~${want}`); fail++; }
};

// Two receipts, chosen so the second is a loss and the first is taxed — the asymmetry is
// the thing being tested and it does not show up in a sample where every session wins.
const A1 = { id: 11, total_wager: 1000, spin_count: 10, gross_payout: 1200, tax_amount: 40, net_payout: 1160 };
const A2 = { id: 12, total_wager: 1000, spin_count: 10, gross_payout: 500, tax_amount: 0, net_payout: 500 };

console.log('\n— basis points —');
near('9600 bps is 96%', E.bpsRate(9600), 0.96);
near('400 bps is 4%', E.bpsRate(400), 0.04);
check('a missing rate stays missing', E.bpsRate(undefined), null);
check('...and so does a string', E.bpsRate('9600'), null);

console.log('\n— what counts as a receipt —');
check('the six settlement fields make one', E.isReceipt(A1), true);
check('five of them do not', E.isReceipt({ ...A1, net_payout: undefined }), false);
check('the table config is not a receipt',
  E.isReceipt({ slots_min_bet: 10, theoretical_rtp_bps: 9600, player_cash: 5000 }), false);
check('an array is not a receipt', E.isReceipt([A1]), false);
check('null is not a receipt', E.isReceipt(null), false);
// The shape gate is the whole reason no spin-placing endpoint appears in the tool.
check('the gate is exactly the six rendered fields', E.RECEIPT,
  ['id', 'total_wager', 'spin_count', 'gross_payout', 'tax_amount', 'net_payout']);

console.log('\n— a session\'s P&L is credited minus staked —');
check('a taxed win is net of the tax', E.netOf(A1), 160);
check('...and not the gross result', E.netOf(A1) === A1.gross_payout - A1.total_wager, false);
check('a loss is a loss', E.netOf(A2), -500);

console.log('\n— the rollup —');
{
  const r = E.rollup([A1, A2]);
  check('sessions', r.n, 2);
  check('spins', r.spins, 20);
  check('staked', r.wagered, 2000);
  check('gross', r.gross, 1700);
  check('tax', r.tax, 40);
  check('credited', r.credited, 1660);
  check('net', r.net, -340);
  check('winning sessions', r.wins, 1);
  check('taxed sessions', r.taxed, 1);
  near('realized RTP is gross over staked', r.realizedRTP, 0.85);
  near('tax drag is tax over staked', r.taxDrag, 0.02);
  near('realized edge is what the house kept', r.realizedEdge, 0.17);
  near('win rate', r.winRate, 0.5);

  // THE identity. If this ever fails, the panel's headline claim — that what the machine
  // actually costs is the gross shortfall plus the tax — is not what it is computing.
  near('realized edge === (1 − realized RTP) + tax drag',
    r.realizedEdge, (1 - r.realizedRTP) + r.taxDrag);

  check('gross − tax reconciles with net', r.reconciles, true);
}
{
  // The client renders gross and tax as separate fields and never checks they add up. If
  // the server ever stops reconciling them the panel has to say so rather than print.
  const r = E.rollup([{ ...A1, net_payout: 999 }]);
  check('a receipt that does not add up is flagged', r.reconciles, false);
}
{
  const r = E.rollup([]);
  check('an empty ledger divides by nothing',
    [r.n, r.realizedRTP, r.taxDrag, r.realizedEdge, r.winRate], [0, null, null, null, null]);
}

console.log('\n— the planner: the exact half —');
{
  const r = E.plan({ wager: 100, spins: 10, edge: 0.04, drag: 0.02, bankroll: 5000, sd: 2, sdN: 50 });
  check('staked is wager times spins', r.staked, 1000);
  near('expected loss is staked times the STATED edge', r.expLoss, 40);
  near('expected return is the rest', r.expReturn, 960);
  near('effective edge adds the measured drag', r.effEdge, 0.06);
  near('...and the loss with it', r.expLossEff, 60);
  near('expected bankroll after', r.expAfter, 4940);
  check('covers: cash over wager, floored', r.cover, 50);
  check('...and the run fits inside it', r.coversRun, true);
}
{
  // The only bankroll claim in the tool that assumes nothing at all, so it has to be
  // exactly right at the boundary rather than approximately right near it.
  const r = E.plan({ wager: 300, spins: 10, edge: 0.04, bankroll: 2999 });
  check('9 spins of headroom, not 10', r.cover, 9);
  check('...so a 10-spin run does not fit', r.coversRun, false);
  const t = E.plan({ wager: 300, spins: 10, edge: 0.04, bankroll: 3000 });
  check('...and at exactly the cost, it does', [t.cover, t.coversRun], [10, true]);
}
{
  const r = E.plan({ wager: 100, spins: 10, edge: null, drag: null, bankroll: 5000 });
  check('with no stated edge nothing is projected',
    [r.expLoss, r.effEdge, r.expLossEff, r.expAfter], [null, null, null, null]);
  check('...but the exact figures still stand', [r.staked, r.cover], [1000, 50]);
}
check('a zero wager is not a plan', E.plan({ wager: 0, spins: 10, edge: 0.04 }), null);
check('nor is a zero-spin run', E.plan({ wager: 100, spins: 0, edge: 0.04 }), null);
check('nor is a blank one', E.plan({ wager: null, spins: null, edge: 0.04 }), null);

console.log('\n— the planner: the estimated half —');
{
  const r = E.plan({ wager: 100, spins: 10, edge: 0.04, bankroll: 5000, sd: 2, sdN: 50 });
  near('the band is wager × √spins × sd', r.band, 100 * Math.sqrt(10) * 2, 1e-9);
  check('...and carries its sample count, always', r.bandN, 50);
}
{
  const r = E.plan({ wager: 100, spins: 10, edge: 0.04, bankroll: 5000 });
  // A zero band reads as certainty, which is the opposite of what no sample means.
  check('no sample means no band, not a band of zero', r.band, null);
  check('...and a sample count of zero', r.bandN, 0);
}

console.log('\n— the per-spin sample —');
{
  const sessions = [{
    ...A1,
    spins: [
      { w: 100, g: 0, b: 900, f: false },
      { w: 100, g: 400, b: 1200, f: false },
      { w: 0, g: 300, b: 1500, f: true },   // free: pays out against nothing
    ],
  }];
  check('free spins are excluded from the sample', E.spinReturns(sessions), [0, 4]);
  check('a session with no per-spin record contributes nothing',
    E.spinReturns([A2]), []);
}
near('sample deviation of 1..5', E.stdev([1, 2, 3, 4, 5]), Math.sqrt(2.5));
check('one sample has no spread', E.stdev([7]), null);
check('no samples have no spread', E.stdev([]), null);
near('the mean is the mean', E.mean([1, 2, 3, 4]), 2.5);

console.log('\n— what is kept, and what is thrown away —');
{
  const raw = {
    ...A1,
    player_balance_before: 5000, player_balance_after: 5160,
    spins: [{
      effective_wager: 100, gross_payout: 250, player_balance_after: 5150,
      spin_type: 'paid', spin_index: 1, scatter_count: 0, free_spins_awarded: 0,
      grid: new Array(15).fill('cherry'),
      line_wins: [{ line_id: 3, count: 4 }],
    }],
  };
  const slim = E.slimSession(raw);
  check('the four numbers that matter survive', slim.spins[0], { w: 100, g: 250, b: 5150, f: false });
  check('the reel grid does not', 'grid' in slim.spins[0], false);
  check('...nor do the winning lines', 'line_wins' in slim.spins[0], false);
  check('both balances survive', [slim.player_balance_before, slim.player_balance_after], [5000, 5160]);
  check('a free spin is marked', E.slimSpin({ effective_wager: 0, gross_payout: 90, player_balance_after: 1, spin_type: 'free' }).f, true);
}

console.log('\n— a thinner sighting never erases a richer one —');
{
  const rich = { ...E.slimSession({ ...A1, player_balance_before: 5000, spins: [{ effective_wager: 100, gross_payout: 0, player_balance_after: 4900 }] }), seen: 1000 };
  const thin = { ...E.slimSession(A1), seen: 2000 };   // as history returns it
  const m = E.mergeSession(rich, thin);
  check('the per-spin record is kept', m.spins.length, 1);
  check('the opening balance is kept', m.player_balance_before, 5000);
  check('first seen is first seen, and does not move', m.seen, 1000);

  // …and the other way round: a richer sighting must be allowed to fill the gaps.
  const back = E.mergeSession(thin, rich);
  check('a later, richer sighting fills in what was missing', back.spins.length, 1);
  check('...still without moving first seen', back.seen, 2000);

  check('a first sighting is itself', E.mergeSession(null, thin), thin);
}

console.log('\n— the curves —');
{
  // oldest first, which is the order money moves in
  const pts = E.curveBySession([A1, A2], 5000, 0.06);
  check('one point per session, plus the start', pts.length, 3);
  check('it starts at the stake', [pts[0].actual, pts[0].expected], [5000, 5000]);
  check('the actual line walks the receipts', [pts[1].actual, pts[2].actual], [5160, 4660]);
  near('expectation after 1000 staked', pts[1].expected, 5000 - 1000 * 0.06);
  near('...and after 2000', pts[2].expected, 5000 - 2000 * 0.06);
  check('points are labelled by session', [pts[0].label, pts[1].label], ['start', '#11']);
}
check('a curve with no stake cannot be drawn', E.curveBySession([A1], null, 0.06), null);
{
  const pts = E.curveBySession([A1], 5000, null);
  check('with no edge there is no expectation line', pts[1].expected, null);
  check('...but your own money still draws', pts[1].actual, 5160);
}
{
  const s = {
    ...A1, player_balance_before: 5000,
    spins: [{ w: 100, g: 0, b: 4900, f: false }, { w: 100, g: 500, b: 5300, f: false },
      { w: 0, g: 200, b: 5500, f: true }],
  };
  const pts = E.curveBySpin(s, 0.06);
  check('one point per spin, plus the start', pts.length, 4);
  check('the balance after each spin is the line', pts.map((p) => p.actual), [5000, 4900, 5300, 5500]);
  // A free spin stakes nothing, so expectation must not step down across it.
  near('expectation steps with the STAKE, not the spin', pts[2].expected, 5000 - 200 * 0.06);
  check('...so a free spin leaves it where it was', pts[3].expected, pts[2].expected);
}
check('no per-spin record, no per-spin curve', E.curveBySpin(A2, 0.06), null);
check('no opening balance, no per-spin curve',
  E.curveBySpin({ ...A1, spins: [{ w: 1, g: 0, b: 2, f: false }] }, 0.06), null);
check('a gap in the balances is not a curve',
  E.curveBySpin({ ...A1, player_balance_before: 5000, spins: [{ w: 1, g: 0, b: null, f: false }] }, 0.06), null);

console.log('\n— the drawing extent —');
{
  const e = E.extent([{ actual: 100, expected: 100 }, { actual: 200, expected: 50 }]);
  check('it spans both series', [e.lo < 50, e.hi > 200], [true, true]);
}
{
  // A flat line on the frame reads as a broken chart, so it gets padded either way.
  const e = E.extent([{ actual: 100, expected: 100 }, { actual: 100, expected: 100 }]);
  check('a flat run still has a range', e.hi > e.lo, true);
}
check('nothing to draw is nothing to scale', E.extent([{ actual: null, expected: null }]), null);

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
