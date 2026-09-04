// How to read jack-watch's shoe test — the simulation behind the two numbers the COUNT
// tab quotes, and behind the table in docs/19-casino-blackjack-surface.md.
//
// This is not a test and nothing fails. It is a bench for one question that the shipped
// client cannot answer and only play can: given that the tool declares a "break" the
// first time it sees a seventh copy of one of the 52 card codes, what does that cadence
// LOOK like under each thing the server might actually be doing?
//
// The question got sharper the moment the first version of it ran. The obvious reading of
// a break is "the table reshuffled, so the shoe does not persist" — and that reading is
// wrong. jack-watch keeps counting across a real reshuffle it has no way to see, so a
// perfectly persistent six-deck shoe trips the same test, just later. Every policy breaks
// eventually. What separates them is the DISTANCE between breaks, and — the half that is
// easy to miss — its SPREAD: a break that happens by coincidence lands raggedly, a break
// that is really a shuffle cycle lands like clockwork.
//
// Rounds are dealt properly rather than approximated: real cards out of a real 312-card
// shoe, the player using jack-watch's own solver (cached to a grid, because a simulation
// of ordinary play only needs ordinary play), the dealer standing on soft 17, one split,
// double after split, and the peek. Seeded, so the table below is reproducible.
//
//   node userscripts/tools/sim-shoe-cadence.js
//
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'jack-watch.user.js'), 'utf8');
const A = '  // >>> ENGINE START';
const B = '  // <<< ENGINE END';
const E = new Function(`${SRC.slice(SRC.indexOf(A), SRC.indexOf(B))}
  return { RANKS, VAL, CARD, freshShoe, handOf, dealerStands, gridOf, PER_CODE };`)();

// mulberry32. A plain multiply-and-mask LCG overflows a double at the usual constants and
// quietly stops being random — which showed up in the first draft of this file as a
// simulation that disagreed with the exact dealer distribution by ten times the sampling
// error. Math.imul keeps every step inside 32 bits.
let seed = 20260904 >>> 0;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const RANK_CODES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rankIdx = (r) => (r === 'A' ? 0 : (['10', 'J', 'Q', 'K'].includes(r) ? 9 : Number(r) - 1));
const buildShoe = () => {
  const s = [];
  for (let d = 0; d < 6; d++) for (const su of 'SHDC') for (const r of RANK_CODES) {
    s.push({ code: r + su, r: rankIdx(r) });
  }
  return s;
};

// Basic strategy, solved once off a fresh shoe and then used as a lookup. jack-watch
// itself never does this — it re-solves every hand against the composition — but a model
// of an ordinary player only needs an ordinary player.
const G = E.gridOf(E.freshShoe());
const pick = (cards, up, canDouble, canSplit) => {
  const h = E.handOf(cards.map((c) => E.CARD[c.r]));
  if (cards.length === 2 && cards[0].r === cards[1].r && canSplit) {
    const row = G.pair.find((x) => x.label === E.RANKS[cards[0].r] + E.RANKS[cards[0].r]);
    const a = row && row.row[up];
    if (a === 'split') return 'split';
    if (a) return a === 'double' && !canDouble ? 'hit' : a;
  }
  const rows = h.soft ? G.soft : G.hard;
  const label = h.soft ? 'A' + E.RANKS[h.t - h.a] : String(h.best);
  const row = rows.find((x) => x.label === label) || G.hard.find((x) => x.label === String(h.best));
  const a = row && row.row[up];
  if (a === 'double' && !canDouble) return 'hit';
  return a || (h.best >= 17 ? 'stand' : 'hit');
};

// The two things the server might be doing. `penetration` is how deep into the shoe the
// cut card sits; `perRound` is a fresh shoe every hand, which is what an implementation
// that never modelled a shoe at all would look like from outside.
const makeTable = (mode, penetration) => {
  let shoe = [], n = 0;
  const reshuffle = () => { shoe = buildShoe(); n = shoe.length; };
  reshuffle();
  return {
    startRound() {
      if (mode === 'perRound') reshuffle();
      else if (n < 312 * (1 - penetration)) reshuffle();
    },
    take() { const k = (rnd() * n) | 0; const c = shoe[k]; shoe[k] = shoe[--n]; return c; },
  };
};

// One round, and the cards that ended up face up in it — which is all a passive tool ever
// gets to count.
const playRound = (T) => {
  T.startRound();
  const take = () => T.take();
  const player = [[take(), take()]];
  const dealer = [take(), take()];
  const up = dealer[0].r;
  const val = (cs) => E.handOf(cs.map((c) => E.CARD[c.r]));
  if (val(player[0]).natural || val(dealer).natural) return player.flat().concat(dealer);
  let splits = 0;
  for (let i = 0; i < player.length; i++) {
    let acted = 0;
    for (;;) {
      const h = val(player[i]);
      if (h.bust || h.best === 21) break;
      const a = pick(player[i], up, acted === 0, splits < 1 && player.length < 2);
      if (a === 'split') {
        splits++;
        const moved = player[i].pop();
        player.push([moved, take()]);
        player[i].push(take());
        if (player[i][0].r === 0) break;      // split aces take one card and stand
        continue;
      }
      if (a === 'stand') break;
      player[i].push(take()); acted++;
      if (a === 'double') break;
    }
  }
  // MEASURED 2026-09-04, from 81 real rounds: when every player hand has busted the dealer
  // turns the hole card over and does NOT draw. Twelve of fifteen busted rounds ended with
  // the dealer's shown hand under seventeen, which a dealer who had played it out could
  // never do. The client says nothing about this either way, and it matters here because
  // it changes how many cards a round puts on the table.
  const allBust = player.every((h) => val(h).bust);
  if (!allBust) {
    for (;;) {
      const h = val(dealer);
      if (h.bust || E.dealerStands(h.t, h.a)) break;
      dealer.push(take());
    }
  }
  return player.flat().concat(dealer);
};

// Exactly what shoeState() does, on a session of the given length: accumulate by code,
// declare a break the first time a hand would push any code past six, reset, repeat.
const session = (T, rounds) => {
  let byCode = Object.create(null);
  const breaks = [];
  let cards = 0;
  for (let r = 1; r <= rounds; r++) {
    const seen = playRound(T);
    cards += seen.length;
    const tally = Object.create(null);
    let over = false;
    for (const c of seen) {
      tally[c.code] = (tally[c.code] || 0) + 1;
      if ((byCode[c.code] || 0) + tally[c.code] > E.PER_CODE) over = true;
    }
    if (over) { breaks.push(r); byCode = Object.create(null); }
    for (const c of seen) byCode[c.code] = (byCode[c.code] || 0) + 1;
  }
  return { breaks, cards };
};

const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : NaN);

const run = (name, make, trials = 2000, rounds = 300) => {
  const firsts = [], gaps = [];
  let cards = 0, played = 0;
  for (let t = 0; t < trials; t++) {
    const s = session(make(), rounds);
    cards += s.cards; played += rounds;
    if (s.breaks.length) firsts.push(s.breaks[0]);
    for (let i = 1; i < s.breaks.length; i++) gaps.push(s.breaks[i] - s.breaks[i - 1]);
  }
  firsts.sort((a, b) => a - b); gaps.sort((a, b) => a - b);
  return {
    name,
    perRound: cards / played,
    first: [q(firsts, 0.05), q(firsts, 0.5), q(firsts, 0.95)],
    gap: [q(gaps, 0.05), q(gaps, 0.5), q(gaps, 0.95)],
    clean40: firsts.filter((x) => x > 40).length / trials,
  };
};

const rows = [
  run('reshuffles every round', () => makeTable('perRound')),
  run('persistent shoe, cut at 50%', () => makeTable('shoe', 0.50)),
  run('persistent shoe, cut at 75%', () => makeTable('shoe', 0.75)),
  run('persistent shoe, cut at 90%', () => makeTable('shoe', 0.90)),
];

console.log(`\ncards seen per round: ${rows[0].perRound.toFixed(2)}\n`);
console.log('| what the table is doing | first break (5/50/95) | gap between breaks (5/50/95) | 40 clean rounds |');
console.log('|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.first.join(' / ')} | ${r.gap.join(' / ')} | ${(r.clean40 * 100).toFixed(1)}% |`);
}
console.log(`
Read the SPREAD, not just the middle. A break that happens by coincidence lands raggedly;
a break that is really a shuffle cycle lands like clockwork, and the two are much easier
to tell apart by the width of the band than by its centre.

The 40-clean-rounds column is the one-sided half stated the other way round: forty rounds
with no break is not proof that the shoe persists, but it is something a table that
reshuffled every round would essentially never produce.

Two assumptions, both unverifiable from the client and both worth remembering before any
of this is used on real numbers: that the shoe you are drawing from is yours alone, and
that the dealer's hole card turns over even when you bust. Sharing a shoe means seeing a
fraction of the cards drawn from it, which pushes every break later without changing what
the spread is telling you.`);
