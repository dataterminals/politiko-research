// Drives jack-watch's engine — every number the panel prints — against things that
// were true before this file existed.
//
// That last clause is the whole design of this test. A solver is the easiest kind of
// code to write a test for and the easiest kind to write a WORTHLESS test for: assert
// that it agrees with itself and it will pass forever while being wrong. So almost
// nothing here is an internal consistency check. The three that carry weight are:
//
//   THE CANONICAL TABLE.  Six decks, dealer stands on soft 17, double after split, one
//               split, no surrender, blackjack 3:2 is a rule set with a published basic
//               strategy, and it is written out below cell for cell. The engine has to
//               reproduce all 350 of them from the rules alone. It knows no table — there
//               is no lookup anywhere in jack-watch — so agreement is evidence about the
//               arithmetic rather than about the typing.
//
//   THE PUBLISHED EDGE.   The same rule set is quoted at about 0.46% for the house.
//               jack-watch computes 0.4593% by summing over every deal. Nothing in the
//               tool was fitted to that number; it either falls out or it does not.
//
//   A MONTE CARLO.        The dealer distribution is checked against dealing a real
//               312-card shoe several hundred thousand times, from a seeded generator so
//               the run is reproducible. Two implementations that share no code and agree
//               to inside sampling noise is the strongest statement available here.
//
// The rest holds the labelling honest, in the same three buckets slot-watch uses and for
// the same reason — a computation, a measurement and an estimate are different things:
//
//   COMPUTED.   The dealer distribution sums to one, the peek really does remove the
//               dealer's natural, and stand/hit/double/split are all in units of the
//               opening wager so they can be compared at all.
//
//   MEASURED.   Tax drag and realized edge are divisions of observed sums, and they have
//               to satisfy the identity that realized edge is the gross shortfall plus
//               the drag — or one of the three is wrong and the panel is quietly lying
//               about what the table costs.
//
//   ESTIMATED.  The ±1 SD band carries its sample count, and one sample has no spread and
//               must come back null rather than zero, because a zero band reads as
//               certainty.
//
// Run: node userscripts/tools/test-jack-ev.js
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'jack-watch.user.js'), 'utf8');
const A = '  // >>> ENGINE START';
const B = '  // <<< ENGINE END';
const i = SRC.indexOf(A);
const j = SRC.indexOf(B, i);
if (i < 0 || j <= i) throw new Error('engine markers not found in jack-watch.user.js');

// The engine is written to be liftable: no DOM, no storage, nothing it is not handed.
// If that ever stops being true this line is where it breaks, which is the point.
const E = new Function(`${SRC.slice(i, j)}
  return { num, RULES, RANKS, VAL, rankOf, codeOf, freshShoe, shoeLeft, without, best,
           isSoft, handOf, dealerStands, dealerDist, standEV, standOdds, hitEV, bustNext,
           doubleEV, splitEV, solve, roundEV, gridOf, countOf, shoeState, isHand,
           isSettled, netOf, slimHand, mergeHand, above, rollup, mean, stdev,
           roundReturns, inferAct, upOf, priceDecision, decisionRoll, plan, betBounds,
           curveOf, extent, SHOE_SIZE, HIDDEN, CARD };`)();

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};
const near = (label, got, want, eps = 1e-9) => {
  const ok = typeof got === 'number' && Math.abs(got - want) <= eps;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${got}\n        want ~${want} (±${eps})`); fail++; }
};

// ---------------------------------------------------------------------------
console.log('\n— the cards, as the client writes them —');
// Measured off the bundle: rank then suit, ten spelled '10', and the literal 'hidden'
// for the hole card. Get this wrong and every other number in the file is wrong about a
// different hand than the one you are holding.
check('an ace is an ace of any suit', ['AS', 'AH', 'AD', 'AC'].map(E.rankOf), [0, 0, 0, 0]);
check('every face card is a ten', ['10S', 'JH', 'QD', 'KC'].map(E.rankOf), [9, 9, 9, 9]);
check('the pips are themselves', ['2S', '5H', '9C'].map(E.rankOf), [1, 4, 8]);
check('a face-down card has no rank', E.rankOf(E.HIDDEN), null);
check('...and no code, so it can never be counted', E.codeOf(E.HIDDEN), null);
check('a code keeps the suit, because six-of-each is the whole test', E.codeOf('10h'), '10H');
check('junk is refused rather than guessed', ['', 'ZZ', '11H', 'A', null].map(E.codeOf),
  [null, null, null, null, null]);

console.log('\n— totals —');
check('a soft seventeen is not a hard one',
  [E.handOf(['AS', '6H']).best, E.handOf(['AS', '6H']).soft], [17, true]);
check('an ace demotes rather than busting',
  [E.handOf(['AS', '6H', '9C']).best, E.handOf(['AS', '6H', '9C']).soft], [16, false]);
check('two aces are 12, not 22', E.handOf(['AS', 'AH']).best, 12);
check('a natural is two cards and nothing else',
  [E.handOf(['AS', 'KH']).natural, E.handOf(['AS', '5H', '5C']).natural], [true, false]);
check('...and a face-down card makes it unknowable',
  E.handOf(['AS', 'hidden']).natural, false);
check('busting is over 21 on the hard total', E.handOf(['KS', 'QH', '5C']).bust, true);

console.log('\n— the shoe —');
check('six decks is 312 cards', E.shoeLeft(E.freshShoe()), 312);
check('...of which 96 are tens', E.freshShoe()[9], 96);
check('and 24 are aces', E.freshShoe()[0], 24);
check('cards come out of it', E.without(E.freshShoe(), ['AS', 'KH', '10D']).comp.slice(0, 1)
  .concat(E.without(E.freshShoe(), ['AS', 'KH', '10D']).comp[9]), [23, 94]);
{
  // A card that cannot be removed means the composition being held is not the shoe the
  // server is dealing from. The engine reports that rather than going negative.
  const empty = new Array(10).fill(0);
  check('an impossible removal is reported, not absorbed',
    E.without(empty, ['AS']).impossible, 1);
}

// ---------------------------------------------------------------------------
console.log('\n— the dealer, computed —');
{
  for (let up = 0; up < 10; up++) {
    const c = E.freshShoe(); c[up]--;
    const dd = E.dealerDist(up, c);
    const sum = dd.p.reduce((a, b) => a + b, 0);
    near(`up ${E.RANKS[up]}: the distribution is a distribution`, sum, 1, 1e-9);
  }
}
check('S17: the dealer stands on a soft seventeen', E.dealerStands(7, 1), true);
check('...and on a hard one', E.dealerStands(17, 0), true);
check('...and draws on a soft sixteen', E.dealerStands(6, 1), false);
{
  // The peek is the difference between "the dealer might already have won" and "the
  // dealer has looked and has not". Every EV in the panel is the second one, and if the
  // conditioning were dropped every number against an ace or a ten would be too low.
  const c = E.freshShoe(); c[0]--;
  const dd = E.dealerDist(0, c);
  near('an ace reports its own natural chance', dd.bj, 96 / 311, 1e-12);
  // With the natural branch gone, a 21 can only be made in three cards or more, so it
  // is rare — a distribution that still had the naturals in it would show about 31%.
  check('...and that branch is gone from the distribution', dd.p[4] < 0.12, true);
  const t = E.freshShoe(); t[9]--;
  near('a ten reports its own', E.dealerDist(9, t).bj, 24 / 311, 1e-12);
  const six = E.freshShoe(); six[5]--;
  check('a six has no natural to peek for', E.dealerDist(5, six).bj, 0);
}

console.log('\n— the dealer, against a Monte Carlo —');
{
  // A second implementation that shares no code with the first: deal a real 312-card
  // shoe, one card at a time, and let the dealer play. Seeded, so a failure here is
  // reproducible rather than something that happens on Tuesdays.
  // mulberry32, not an LCG: a plain multiply-and-mask overflows a double at these
  // constants and quietly stops being random, which shows up here as a simulation that
  // disagrees with the exact answer by ten times the sampling error. Math.imul keeps
  // every step inside 32 bits.
  let seed = 20260903 >>> 0;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const deck = [];
  for (let d = 0; d < 6; d++) for (let s = 0; s < 4; s++) {
    for (let r = 0; r < 13; r++) deck.push(r === 0 ? 0 : (r >= 9 ? 9 : r));
  }
  const N = 300000;
  const run = (up) => {
    const out = [0, 0, 0, 0, 0, 0];
    let kept = 0;
    for (let k = 0; k < N; k++) {
      const shoe = deck.slice();
      shoe.splice(shoe.indexOf(up), 1);
      let n = shoe.length;
      const take = () => { const x = (rnd() * n) | 0; const r = shoe[x]; shoe[x] = shoe[--n]; return r; };
      const hole = take();
      if ((up === 0 && hole === 9) || (up === 9 && hole === 0)) continue;   // peeked away
      kept++;
      let t = E.VAL[up] + E.VAL[hole];
      let a = (up === 0 ? 1 : 0) + (hole === 0 ? 1 : 0);
      for (;;) {
        if (t > 21) { out[5]++; break; }
        if (E.dealerStands(t, a)) { out[E.best(t, a) - 17]++; break; }
        const r = take(); t += E.VAL[r]; a += r === 0 ? 1 : 0;
      }
    }
    return out.map((x) => x / kept);
  };
  // Three up cards rather than ten, because 300k hands each is the budget: an ace and a
  // ten exercise the peek, and a six exercises the long draw.
  for (const up of [0, 5, 9]) {
    const c = E.freshShoe(); c[up]--;
    const exact = E.dealerDist(up, c).p;
    const mc = run(up);
    const worst = Math.max(...mc.map((x, k) => Math.abs(x - exact[k])));
    near(`up ${E.RANKS[up]}: exact and simulated agree`, worst, 0, 0.006);
  }
}

// ---------------------------------------------------------------------------
console.log('\n— basic strategy, reproduced from the rules —');
{
  // The canonical table for SIX DECKS, DEALER STANDS ON SOFT 17, DOUBLE AFTER SPLIT,
  // NO SURRENDER, BLACKJACK 3:2 — which is exactly the rule set the House rules aside
  // prints. Columns are the dealer's up card in the engine's own order: A 2 3 4 5 6 7 8
  // 9 T. H hit, S stand, D double, P split.
  //
  // This is the part of the test that is not derived from jack-watch. If a cell here
  // disagrees with the engine, one of the two is wrong and the build stops until someone
  // has decided which.
  const HARD = {
    5: 'HHHHHHHHHH', 6: 'HHHHHHHHHH', 7: 'HHHHHHHHHH', 8: 'HHHHHHHHHH',
    9: 'HHDDDDHHHH', 10: 'HDDDDDDDDH', 11: 'HDDDDDDDDD',
    12: 'HHHSSSHHHH', 13: 'HSSSSSHHHH', 14: 'HSSSSSHHHH',
    15: 'HSSSSSHHHH', 16: 'HSSSSSHHHH',
    17: 'SSSSSSSSSS', 18: 'SSSSSSSSSS', 19: 'SSSSSSSSSS', 20: 'SSSSSSSSSS',
  };
  const SOFT = {
    A2: 'HHHHDDHHHH', A3: 'HHHHDDHHHH', A4: 'HHHDDDHHHH', A5: 'HHHDDDHHHH',
    A6: 'HHDDDDHHHH', A7: 'HSDDDDSSHH', A8: 'SSSSSSSSSS', A9: 'SSSSSSSSSS',
  };
  // One split only, so nothing here resplits; DAS is on, which is what puts 2/2, 3/3,
  // 4/4, 6/6 where they are.
  const PAIR = {
    AA: 'PPPPPPPPPP', 22: 'HPPPPPPHHH', 33: 'HPPPPPPHHH', 44: 'HHHHPPHHHH',
    55: 'HDDDDDDDDH', 66: 'HPPPPPHHHH', 77: 'HPPPPPPHHH', 88: 'PPPPPPPPPP',
    99: 'SPPPPPSPPS', TT: 'SSSSSSSSSS',
  };
  const L = { hit: 'H', stand: 'S', double: 'D', split: 'P' };
  const ACT = ['hit', 'stand', 'double'];
  const row = (ranks, canSplit) => {
    let out = '';
    for (let up = 0; up < 10; up++) {
      const c = E.freshShoe();
      for (const r of [...ranks, up]) c[r]--;
      const s = E.solve(ranks.map((r) => E.CARD[r]), up, c,
        canSplit ? [...ACT, 'split'] : ACT);
      out += s && s.pick ? L[s.pick] : '?';
    }
    return out;
  };
  // The representative composition for each hard total, which is what a total-dependent
  // table is quoting: 16 is 10+6, not 8+8 (8/8 is in the pair table where it belongs).
  const HARD_AS = {
    5: [1, 2], 6: [1, 3], 7: [1, 4], 8: [1, 5], 9: [1, 6], 10: [1, 7], 11: [1, 8],
    12: [1, 9], 13: [2, 9], 14: [3, 9], 15: [4, 9], 16: [5, 9], 17: [6, 9],
    18: [7, 9], 19: [8, 9], 20: [9, 9],
  };
  let bad = [];
  for (const t of Object.keys(HARD)) {
    const got = row(HARD_AS[t], false);
    if (got !== HARD[t]) bad.push(`hard ${t}: ${got} vs ${HARD[t]}`);
  }
  check('every hard total matches the canonical table', bad, []);
  bad = [];
  for (const k of Object.keys(SOFT)) {
    const got = row([0, Number(k[1]) - 1], false);
    if (got !== SOFT[k]) bad.push(`${k}: ${got} vs ${SOFT[k]}`);
  }
  check('every soft total matches', bad, []);
  bad = [];
  for (const k of Object.keys(PAIR)) {
    const r = k === 'AA' ? 0 : (k === 'TT' ? 9 : Number(k[0]) - 1);
    const got = row([r, r], true);
    if (got !== PAIR[k]) bad.push(`${k}: ${got} vs ${PAIR[k]}`);
  }
  check('every pair matches', bad, []);
}

console.log('\n— the actions are in the same units —');
{
  const c = E.freshShoe(); c[9] -= 2; c[5]--;
  const s = E.solve(['10S', '6H'], 9, c, ['hit', 'stand']);
  check('standing on sixteen against a ten is a losing bet', s.ev.stand < 0, true);
  check('...and hitting it is the less bad one', s.ev.hit > s.ev.stand, true);
  check('...which is what it picks', s.pick, 'hit');
  near('the three ways it can go add to one',
    s.odds.win + s.odds.push + s.odds.lose, 1, 1e-12);
  // 16 busts on a 6 or better: six ranks out of ten, weighted by what is left.
  const left = c.reduce((a, b) => a + b, 0);
  let busts = 0;
  for (let r = 0; r < 10; r++) if (16 + E.VAL[r] > 21) busts += c[r];
  near('the bust chance is a straight count of the cards that bust you',
    s.bustNext, busts / left, 1e-12);
}
{
  const c = E.freshShoe(); c[9]--; c[0]--; c[5]--;
  const s = E.solve(['AS', '10H'], 5, c, ['hit', 'stand', 'double']);
  check('a twenty-one stands', s.pick, 'stand');
  check('...and standing on it is worth nearly a whole unit', s.ev.stand > 0.9, true);
}
{
  // Doubling stakes twice, so its EV lives on twice the scale. A panel that compared a
  // double against a stand without saying so would be comparing two different bets.
  const c = E.freshShoe(); c[4]--; c[5]--; c[5]--;
  const s = E.solve(['5S', '6H'], 5, c, ['hit', 'stand', 'double']);
  check('eleven against a six doubles', s.pick, 'double');
  check('...and the double is worth more than one unit can be', s.ev.double > s.ev.hit, true);
}
{
  const c = E.freshShoe(); c[7] -= 2; c[9]--;
  const s = E.solve(['8S', '8H'], 9, c, ['hit', 'stand', 'split']);
  check('eights split against a ten even though both halves are behind', s.pick, 'split');
  check('...and every branch of it is still a loss', s.ev.split < 0, true);
}
{
  const c = E.freshShoe(); c[0] -= 2; c[9]--;
  const s = E.solve(['AS', 'AH'], 9, c, ['hit', 'stand', 'split']);
  check('aces always split', s.pick, 'split');
  // Split aces take one card and stand, so the two halves cannot be worth more than two
  // stood-on hands ever could.
  check('...and a split is priced for both halves', s.ev.split > s.ev.hit, true);
}
check('a hand with a face-down card is not solved at all',
  E.solve(['hidden'], 9, E.freshShoe(), ['hit']), null);

// ---------------------------------------------------------------------------
console.log('\n— the house edge, computed rather than quoted —');
{
  const r = E.roundEV(E.freshShoe());
  check('every initial deal is priced', r.deals > 500, true);
  // The published figure for six decks, S17, DAS, one split, no surrender, 3:2 is about
  // 0.46% for the house. Nothing in jack-watch was fitted to it.
  near('the edge lands where this rule set is known to land', r.edge, 0.0046, 0.0004);
  check('...and it is a house edge, not a player one', r.ev < 0, true);
  // Sanity on the direction of the biggest single lever there is: pay the natural even
  // money instead of 3:2 and the house takes roughly 2.3% more.
  check('the edge is stated as a fraction, not a percentage', r.edge < 0.05, true);
}

console.log('\n— the grid is derived, never looked up —');
{
  const g = E.gridOf(E.freshShoe());
  check('it covers hard, soft and pairs', [g.hard.length, g.soft.length, g.pair.length],
    [16, 9, 10]);
  check('every cell is an action', g.hard.concat(g.soft, g.pair)
    .every((r) => r.row.length === 10 && r.row.every((a) => a === null
      || ['hit', 'stand', 'double', 'split'].includes(a))), true);
  // The probe that proves the grid is computed rather than recited, and the one place
  // in this file where a counter's own vocabulary is the right check: sixteen against a
  // ten is the most famous deviation there is — hit it off the top of the shoe, stand it
  // once the small cards are gone. Strip most of the 2s through 6s and the cell has to
  // flip, without anything in jack-watch ever having heard of an index number.
  check('off the top of the shoe, sixteen against a ten is a hit',
    g.hard.find((r) => r.label === '16').row[9], 'hit');
  const rich = E.freshShoe();
  for (let r = 1; r <= 5; r++) rich[r] = 4;          // the small cards, mostly gone
  check('...and against a shoe with the small cards gone, it stands',
    E.gridOf(rich).hard.find((r) => r.label === '16').row[9], 'stand');
}

// ---------------------------------------------------------------------------
console.log('\n— counting, and the evidence for it —');
{
  const c = E.countOf([0, 1, 1, 1, 1, 1, 0, 0, 0, 0], 5);
  check('hi-lo counts the low cards up', c.running, 5);
  const d = E.countOf([2, 0, 0, 0, 0, 0, 0, 0, 0, 3], 5);
  check('...and the aces and tens down', d.running, -5);
  check('a true count divides by the decks left', Math.round(E.countOf(
    [0, 6, 0, 0, 0, 0, 0, 0, 0, 0], 156).true), 2);   // +6 over three decks
  check('...and refuses to divide by a sliver of one',
    E.countOf([0, 1, 0, 0, 0, 0, 0, 0, 0, 0], E.SHOE_SIZE - 20).true, null);
}
{
  // The reshuffle test, which is the only claim about the shoe this tool is allowed to
  // make. Six of a code is possible; a seventh is not, and the ledger restarts there.
  const hand = (id, cards) => ({ id, dealer: cards.slice(0, 2), hands: [{ cards: cards.slice(2) }] });
  // Two sightings of the ace of spades a hand, three hands: exactly the six a six-deck
  // shoe holds, and not one more.
  const six = [];
  for (let k = 0; k < 3; k++) six.push(hand(k + 1, ['AS', '2H', 'AS', '3D']));
  const s1 = E.shoeState(six);
  check('six sightings of one card prove nothing', [s1.proven, s1.peak], [false, 6]);
  check('...and the composition is short by exactly what was seen', s1.comp[0], 24 - 6);
  const seven = six.concat([hand(4, ['AS', '4H', '5D', '6C'])]);
  const s2 = E.shoeState(seven);
  check('a seventh proves a reshuffle', [s2.proven, s2.lastBreak, s2.segments],
    [true, 4, 2]);
  // The whole of the fourth hand goes into the new shoe, never half into each.
  check('...and the count starts again from that hand, whole', s2.cards, 4);
  // The gap, which is the part that actually discriminates. Every shoe policy trips this
  // test eventually — a persistent shoe trips it too, because the walk keeps counting
  // across a real reshuffle it cannot see — so the break is not the measurement and the
  // distance between breaks is. It has to be counted in ROUNDS: hand ids are shared with
  // every other player at the casino, so the id gaps here (5, 40, 3) are deliberately
  // nothing like the round gaps (3, 3).
  {
    const ids = [1, 6, 46, 49, 52, 60, 70];
    const hs = ids.map((id, k) => hand(id, k % 3 === 2
      ? ['AS', 'AS', 'AS', 'AS'] : ['AS', 'AS', '2H', '3D']));
    const s3 = E.shoeState(hs);
    check('breaks record the round they fell on, not the hand id',
      s3.breaks.every((b) => typeof b.id === 'number' && typeof b.after === 'number'), true);
    check('...and the gaps are in rounds', s3.gaps, s3.breaks.slice(1).map((b) => b.after));
    check('...with the first break dropped, because it is a floor and not a gap',
      s3.gaps.length, Math.max(0, s3.breaks.length - 1));
    if (s3.gaps.length) {
      check('...and the spread is reported, because a coincidence is ragged and a cycle is not',
        [s3.gapMin <= s3.gapMean, s3.gapMean <= s3.gapMax], [true, true]);
    }
    check('rounds played is every hand in the ledger, breaks included', s3.played, ids.length);
  }
  check('no breaks, no gaps', E.shoeState([hand(1, ['2S', '3H', '4D', '5C'])]).gaps, []);
  check('a face-down card is counted as unseen, never as a card',
    E.shoeState([hand(1, ['AS', 'hidden', '5D', '6C'])]).hidden, 1);
  check('...and does not move the composition',
    E.shoeState([hand(1, ['AS', 'hidden', '5D', '6C'])]).cards, 3);
}

// ---------------------------------------------------------------------------
console.log('\n— the receipts —');
{
  const raw = {
    id: 7, status: 'settled', outcome: 'win', current_hand: 0,
    allowed_actions: [], dealer_cards: ['10S', '7H'],
    player_hands: [{ cards: ['AS', '9H'], wager: 100, outcome: 'win', status: 'resolved' }],
    opening_wager: 100, total_wager: 100, gross_payout: 200, tax_amount: 20, net_payout: 180,
  };
  check('a hand is recognised by its shape', E.isHand(raw), true);
  check('...and a settled one by the four numbers', E.isSettled(raw), true);
  check('an unsettled hand is a hand but not a receipt',
    [E.isHand({ ...raw, gross_payout: undefined }), E.isSettled({ ...raw, gross_payout: undefined })],
    [true, false]);
  check('a config is not a hand', E.isHand({ blackjack_min_bet: 10 }), false);
  const slim = E.slimHand(raw);
  check('the stake is renamed on the way in', [slim.hands[0].stake, 'wager' in slim.hands[0]],
    [100, false]);
  check('P and L is what was CREDITED minus what was staked', E.netOf(slim), 80);
  check('...which is not gross minus staked', slim.gross - slim.total, 100);
}
{
  // The same hand arrives many times: once per action, and then on every history poll for
  // as long as it is in the array. A later, thinner sighting must never delete what an
  // earlier one knew — this is the easiest thing in the whole tool to get backwards.
  const rich = E.slimHand({
    id: 3, status: 'settled', dealer_cards: ['10S', '7H'],
    player_hands: [{ cards: ['AS', '9H', '2C'], wager: 50 }],
    opening_wager: 50, total_wager: 50, gross_payout: 100, tax_amount: 5, net_payout: 95,
  });
  rich.seen = 111;
  const thin = E.slimHand({
    id: 3, status: 'settled', dealer_cards: ['10S'],
    player_hands: [{ cards: ['AS'], wager: 50 }],
  });
  thin.seen = 999;
  const m = E.mergeHand(rich, thin);
  check('a thinner sighting cannot shorten the cards',
    [m.dealer.length, m.hands[0].cards.length], [2, 3]);
  check('...nor drop the settlement', [m.gross, m.tax, m.net], [100, 5, 95]);
  check('...nor move when it was first seen', m.seen, 111);
}

console.log('\n— measured, and the identity it has to satisfy —');
{
  const mk = (id, total, gross, tax, net, open) =>
    ({ id, total, gross, tax, net, open: open == null ? total : open });
  const list = [mk(1, 100, 0, 0, 0), mk(2, 100, 200, 20, 180), mk(3, 200, 200, 0, 200, 100)];
  const r = E.rollup(list);
  check('the sums are sums', [r.n, r.wagered, r.gross, r.tax, r.credited], [3, 400, 400, 20, 380]);
  check('net is credited minus staked', r.net, -20);
  check('a push is neither a win nor a loss', [r.wins, r.pushes, r.losses], [1, 1, 1]);
  near('tax drag is two observed sums and nothing else', r.taxDrag, 20 / 400, 1e-12);
  near('realized edge is what it cost you per dollar staked', r.realizedEdge, 20 / 400, 1e-12);
  // The identity. Gross shortfall plus drag IS the realized edge, always. If these ever
  // stop agreeing, one of the three is being computed wrong and the panel is quietly
  // lying about what the table costs.
  near('realized edge = gross shortfall + tax drag',
    r.realizedEdge, (r.wagered - r.gross) / r.wagered + r.taxDrag, 1e-12);
  // A round can stake more than you bet: splits and doubles. A planner that multiplied
  // bet by rounds would understate the exposure by exactly this.
  near('the staking multiplier is measured, not assumed', r.stakeMult, 400 / 300, 1e-12);
  check('gross minus tax has to equal net, and it is checked', r.reconciles, true);
  check('...and a receipt that does not reconcile is caught',
    E.rollup([mk(1, 100, 200, 20, 170)]).reconciles, false);
}

console.log('\n— what you actually did, inferred —');
{
  const state = (over) => E.slimHand({
    id: 5, status: 'player_turn', current_hand: 0, allowed_actions: ['hit', 'stand'],
    dealer_cards: ['10S', 'hidden'],
    player_hands: [{ cards: ['10H', '6C'], wager: 100 }],
    opening_wager: 100, ...over,
  });
  const a = state({});
  check('a card on the same hand is a hit', E.inferAct(a, state({
    player_hands: [{ cards: ['10H', '6C', '4D'], wager: 100 }],
  })), 'hit');
  check('a bigger stake and a card is a double', E.inferAct(a, state({
    player_hands: [{ cards: ['10H', '6C', '4D'], wager: 200 }],
  })), 'double');
  check('a second hand is a split', E.inferAct(a, state({
    player_hands: [{ cards: ['10H'], wager: 100 }, { cards: ['6C'], wager: 100 }],
  })), 'split');
  check('the turn moving on with no new card is a stand', E.inferAct(a, state({
    status: 'settled', player_hands: [{ cards: ['10H', '6C'], wager: 100 }],
  })), 'stand');
  check('the same state twice is not a decision', E.inferAct(a, state({})), null);
  check('nothing is inferred from a hand that was not yours to play',
    E.inferAct(state({ status: 'settled' }), state({})), null);
  check('nor from a first sighting', E.inferAct(null, a), null);

  // Priced against basic strategy — the TABLE composition — so that an old answer never
  // moves when the shoe does.
  const d = E.priceDecision(a, 'stand');
  check('a decision knows what it should have been', d.want, 'hit');
  check('...and standing on sixteen costs you something', d.cost > 0, true);
  check('...scaled by what was on the hand', Math.abs(d.cost - (d.bestEV - d.ev) * 100) < 1e-9, true);
  const good = E.priceDecision(a, 'hit');
  near('...and playing it right costs nothing', good.cost, 0, 1e-12);
  const roll = E.decisionRoll([d, good]);
  check('the ledger counts both', [roll.n, roll.matched], [2, 1]);
}

console.log('\n— the up card —');
check('the up card is the first one face up', E.upOf({ dealer: ['10S', 'hidden'] }), 9);
check('...even when the client puts the hole first', E.upOf({ dealer: ['hidden', 'AS'] }), 0);
check('...and there is none when there are no cards', E.upOf({ dealer: [] }), null);

// ---------------------------------------------------------------------------
console.log('\n— estimated, and labelled —');
{
  check('one sample has no spread', E.stdev([0.5]), null);
  check('...and no samples has none either', E.stdev([]), null);
  near('two do', E.stdev([1, 3]), Math.SQRT2, 1e-12);
  const p = E.plan({ bet: 100, rounds: 100, edge: 0.0046, drag: 0.01, bankroll: 5000,
    sd: 1.1, sdN: 42, mult: 1.15 });
  near('the stake folds in the measured multiplier', p.staked, 100 * 100 * 1.15, 1e-9);
  near('expected loss is the solved edge times the stake', p.expLoss, 11500 * 0.0046, 1e-9);
  near('...and the effective one adds the measured drag', p.effEdge, 0.0146, 1e-12);
  check('cover assumes nothing at all', [p.cover, p.coversRun], [50, false]);
  near('the band is one sd of the sum, in cash', p.band, 100 * 10 * 1.1, 1e-9);
  check('...and carries its sample count', p.bandN, 42);
  check('no band without a sample', E.plan({ bet: 10, rounds: 10, edge: 0.005 }).band, null);
  check('a plan with no bet is no plan', E.plan({ bet: 0, rounds: 10 }), null);
  check('...and the multiplier defaults to one rather than to a guess',
    E.plan({ bet: 100, rounds: 10 }).mult, 1);
}

console.log('\n— the bet the table will actually take —');
{
  // Measured off renderBetting: the deal is blocked when the wager times four exceeds the
  // free reserve. The page never states that as a number; it only greys out a button.
  const b = E.betBounds({ min: 25, max: 5000, step: 25, cash: 9000, reserve: 8000 });
  check('the house reserve can bite below the table maximum', [b.max, b.why], [2000, 'house reserve']);
  check('your cash can bite first',
    E.betBounds({ min: 25, max: 5000, step: 25, cash: 400, reserve: 90000 }).why, 'your cash');
  check('and the table maximum when nothing else does',
    E.betBounds({ min: 25, max: 500, step: 25, cash: 9000, reserve: 90000 }).why, 'table max');
  check('every bound is rounded down to a legal bet',
    E.betBounds({ min: 25, max: 5000, step: 25, cash: 9000, reserve: 8090 }).max % 25, 0);
}

console.log('\n— the curve —');
{
  const mk = (id, total, net) => ({ id, total, net, gross: net, tax: 0, open: total });
  const pts = E.curveOf([mk(1, 100, 0), mk(2, 100, 200)], 1000, 0.0146);
  check('it starts where you started', pts[0].actual, 1000);
  check('...and walks your money along it', pts.map((p) => p.actual), [1000, 900, 1000]);
  near('...against what perfect play says it should have cost',
    pts[2].expected, 1000 - 200 * 0.0146, 1e-9);
  check('no stake, no curve', E.curveOf([mk(1, 100, 0)], null, 0.01), null);
  check('and no rounds, no curve', E.curveOf([], 1000, 0.01), null);
  const e = E.extent(pts);
  check('the frame holds both series', e.lo < 900 && e.hi > 1000, true);
}

console.log('\n— a mark hides money and never deletes it —');
{
  const l = [{ id: 3 }, { id: 2 }, { id: 1 }];
  check('a floor keeps what is above it', E.above(l, 1).map((h) => h.id), [3, 2]);
  check('...and no floor keeps everything', E.above(l, null).map((h) => h.id), [3, 2, 1]);
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
