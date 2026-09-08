// Drives the arithmetic behind market-watch's chart marks.
//
// The whole feature rests on ONE claim, and it is a claim about two different
// fields lining up:
//
//   a trade's `game_day` and a candle's `bucket_start` count from the same origin,
//   so `game_day * 86400` is a game-second in the chart's own x-axis space.
//
// Nothing in a payload states that. It was read off the client bundle on
// 2026-09-07 (docs/04-stocks-surface.md), and the evidence is circumstantial: the
// game decodes `bucket_start` with year=floor(s/31536000)+1, and docs/04 had
// already decoded `ipo_game_day: 1408` through the same calendar to Nov 14 Y4.
// The first test below re-derives that from this file's own decoder, which is the
// closest thing to a proof available without the wire — two fields, two documents,
// one date.
//
// Everything after it is about what happens when that claim is TRUE but the fill
// still cannot be drawn, because those are the cases that produce a wrong picture
// rather than no picture:
//
//   * a game day is finer than a 1w bar and coarser than a 4h bar, so the mark is
//     a line in one case and has to be a band in the other;
//   * bar times are identical across every instrument on a timeframe, so times
//     cannot tell PNRG from RCRD and only closes can;
//   * a fill dated later than the newest bar is not a fill placed badly, it means
//     the claim above is wrong, and the only safe response is to draw nothing.
//
// Run: node userscripts/tools/test-market-chart.js
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'market-watch.user.js'), 'utf8');
const A = '  // >>> ENGINE START';
const B = '  // <<< ENGINE END';
const i = SRC.indexOf(A);
const j = SRC.indexOf(B, i);
if (i < 0 || j <= i) throw new Error('engine markers not found in market-watch.user.js');

// The engine is written to be liftable: no DOM, no storage, no clock. `isNum` is
// the single utility it borrows from the file around it, so the test declares one.
// If the engine ever reaches for anything else, this line is where it breaks —
// which is the point of lifting it rather than re-implementing it.
const E = new Function(`
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
${SRC.slice(i, j)}
  return { GAME_DAY_SECS, gameDate, bucketOf, BUY_TYPES, pickLastBuy, placeTrade, sameSymbol };
`)();

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        ${detail}`); fail++; }
};
const eq = (label, got, want) =>
  check(label, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const DAY = 86_400;
/** A run of bars, `count` of them, `bucket` apart, ending at the start of `endDay`. */
const barsTo = (endDay, bucket, count, px = 27) => {
  const out = [];
  const last = endDay * DAY;
  for (let k = count - 1; k >= 0; k--) {   // k counts back from the oldest bar
    const v = px + (count - k) * 0.01;
    out.push({ time: last - k * bucket, open: v, high: v + 0.2, low: v - 0.2, close: v });
  }
  return out;
};

// ---------------------------------------------------------------------------
console.log('\n— game_day and bucket_start are the same clock —');
// ---------------------------------------------------------------------------

// docs/04-stocks-surface.md: every instrument reported ipo_game_day 1408, and that
// was decoded — independently, through docs/06's calendar constants — to Nov 14 of
// year 4. If this decoder disagrees, one of the two documents is wrong and the
// marks are landing on the wrong bars.
eq('ipo_game_day 1408 decodes to the date docs/04 recorded',
  E.gameDate(1408 * DAY), 'Yr4 Nov 14');

eq('day 0 is the first day of year 1', E.gameDate(0), 'Yr1 Jan 1');
eq('day 364 is the last day of year 1', E.gameDate(364 * DAY), 'Yr1 Dec 35');
eq('day 365 rolls into year 2', E.gameDate(365 * DAY), 'Yr2 Jan 1');

// A game year is 365 days but twelve 30-day months is 360, so December runs to 35.
// The game's own chart formatter skips the month clamp and prints `undefined` for
// those five days; we clamp. This asserts the difference is deliberate.
eq('December absorbs the five overflow days', E.gameDate(359 * DAY), 'Yr1 Dec 30');
check('...and none of the overflow days decodes to undefined',
  [360, 361, 362, 363, 364].every((d) => !/undefined/.test(E.gameDate(d * DAY))),
  [360, 364].map((d) => E.gameDate(d * DAY)).join(' | '));

// ---------------------------------------------------------------------------
console.log('\n— bucket width comes off the bars, not off trust —');
// ---------------------------------------------------------------------------
eq('1d bars measure one game day', E.bucketOf(barsTo(5040, DAY, 150)), DAY);
eq('4h bars measure four game hours', E.bucketOf(barsTo(5040, 14_400, 150)), 14_400);
eq('1w bars measure seven game days', E.bucketOf(barsTo(5040, 604_800, 150)), 604_800);

// A median, not a mean: one missing bar must not drag the width.
const holed = barsTo(5040, DAY, 40);
holed.splice(11, 1);
eq('a hole in the series does not move the width', E.bucketOf(holed), DAY);
eq('too few bars to measure falls back to a game day', E.bucketOf([{ time: 0 }]), DAY);

// ---------------------------------------------------------------------------
console.log('\n— placing a fill among the bars —');
// ---------------------------------------------------------------------------
const buy = (game_day, extra) => Object.assign(
  { id: 1, game_day, symbol: 'PNRG', trade_type: 'buy', shares: 92, price_per_share: 27.1 },
  extra);

{
  // 1d: 150 bars ending at D5040, so the run is D4891..D5040 and a fill on D5033
  // is bar index 142 — one bar, exactly.
  const bars = barsTo(5040, DAY, 150);
  const at = E.placeTrade(buy(5033), bars, DAY);
  eq('1d — a fill lands on exactly one bar', [at.from, at.to, at.exact], [142, 142, true]);
  eq('...and that bar starts on the day of the fill', bars[at.from].time / DAY, 5033);

  eq('1d — the newest bar is reachable', E.placeTrade(buy(5040), bars, DAY).from, 149);
  eq('1d — the oldest bar is reachable', E.placeTrade(buy(4891), bars, DAY).from, 0);
}

{
  // 4h: six bars share a game day, so a fill can only be placed to within a day
  // and the mark has to be a band. This is the case where a line would be a lie.
  const bars = barsTo(5040, 14_400, 150);
  const at = E.placeTrade(buy(5033), bars, 14_400);
  check('4h — a fill spans the six bars of its game day', at.span === 6 && !at.exact,
    JSON.stringify(at));
  eq('...starting at the first bucket of that day', bars[at.from].time, 5033 * DAY);
  eq('...and ending at the last one', bars[at.to].time, 5033 * DAY + 5 * 14_400);
}

{
  // 1w: a bar is seven days, so the day is finer than the bar and the fill sits
  // inside one bar with room to spare.
  const bars = barsTo(5040, 604_800, 150);
  const at = E.placeTrade(buy(5033), bars, 604_800);
  check('1w — a fill sits inside a single seven-day bar', at.exact === true, JSON.stringify(at));
  check('...on the bar whose week contains it',
    bars[at.from].time <= 5033 * DAY && 5033 * DAY < bars[at.from].time + 604_800,
    `bar starts D${bars[at.from].time / DAY}`);
}

// ---------------------------------------------------------------------------
console.log('\n— fills that must NOT be drawn —');
// ---------------------------------------------------------------------------
{
  const bars = barsTo(5040, DAY, 150);   // D4891..D5040

  const before = E.placeTrade(buy(4102), bars, DAY);
  check('older than the window says so, with the distance', before.before === true, JSON.stringify(before));
  eq('...counted in whole game days', before.days, 4891 - 4103);

  // The one that matters. A fill cannot be dated after the newest bar; if it reads
  // that way then `game_day` is not the absolute day this whole feature assumes,
  // and the honest output is a refusal rather than a mark somewhere plausible.
  const ahead = E.placeTrade(buy(5200), bars, DAY);
  eq('a fill later than the newest bar refuses outright', ahead, { impossible: true });
  check('...and it is distinguishable from merely "after"',
    ahead.after === undefined && ahead.from === undefined, JSON.stringify(ahead));

  eq('one day past the newest bar is still just "after"',
    E.placeTrade(buy(5041), bars, DAY).after, true);

  check('a fill with no game day places nowhere',
    E.placeTrade({ game_day: null }, bars, DAY) === null, 'expected null');
  check('a chart with no bars places nowhere',
    E.placeTrade(buy(5033), [], DAY) === null, 'expected null');
}

// ---------------------------------------------------------------------------
console.log('\n— which stock is on screen —');
// ---------------------------------------------------------------------------
{
  const mine = barsTo(5040, DAY, 150, 27);
  const same = mine.map((b) => ({ ...b }));
  const other = mine.map((b) => ({ ...b, close: b.close / 2.29, open: b.open / 2.29 }));

  check('identical closes confirm the same stock', E.sameSymbol(same, mine) === true, 'expected true');
  check('different closes reject it', E.sameSymbol(other, mine) === false, 'expected false');

  // The point of the whole check: PNRG and RCRD share every bucket boundary, so a
  // comparison on time alone would confirm the wrong stock every single time.
  check('...which times alone could never have caught',
    other.every((b, k) => b.time === mine[k].time), 'the two runs should share every time');

  // The last bar is live — the socket updates it between the fetch and now — so it
  // is skipped, and a run whose only difference is there must still confirm.
  const drifted = mine.map((b) => ({ ...b }));
  drifted[drifted.length - 1].close += 3.5;
  check('a moving last bar does not reject the right stock',
    E.sameSymbol(drifted, mine) === true, 'expected true');

  // No overlap at all is "cannot say", not "no" — a bucket rollover between the
  // fetch and the read is normal, and null is what stops a mark being drawn.
  const shifted = barsTo(9000, DAY, 150);
  check('no shared bar answers null rather than guessing',
    E.sameSymbol(shifted, mine) === null, 'expected null');
  check('nothing to compare against answers null',
    E.sameSymbol(mine, null) === null, 'expected null');
}

// ---------------------------------------------------------------------------
console.log('\n— which fill counts as "the last buy" —');
// ---------------------------------------------------------------------------
{
  // Sorted newest-first, the way tradesFor() hands them over.
  const list = [
    { id: 905, game_day: 5039, trade_type: 'sell', shares: 10 },
    { id: 904, game_day: 5036, trade_type: 'short_open', shares: 20 },
    { id: 903, game_day: 5033, trade_type: 'buy', shares: 92 },
    { id: 900, game_day: 4102, trade_type: 'buy', shares: 30 },
  ];
  eq('a sell is not a purchase', E.pickLastBuy(list).id, 903);

  // Opening a short is a SALE. Marking it as a buy would put the mark on the right
  // day and tell you the opposite of which way you are facing on the position.
  check('opening a short is not a purchase', !E.BUY_TYPES.has('short_open'), 'short_open counted as a buy');
  check('covering a short is not a purchase either', !E.BUY_TYPES.has('short_cover'), 'short_cover counted as a buy');

  // A margin buy is a purchase that happens to be financed, and it does move your
  // position — leaving it out would silently ignore a real entry.
  check('a margin buy is a purchase', E.BUY_TYPES.has('margin_open'), 'margin_open not counted as a buy');
  eq('...and wins when it is the newest',
    E.pickLastBuy([{ id: 910, game_day: 5040, trade_type: 'margin_open' }, ...list]).id, 910);

  check('no purchases at all comes back null',
    E.pickLastBuy(list.filter((t) => t.trade_type === 'sell')) === null, 'expected null');

  // Every type StocksPage's history table can render, so a new one cannot quietly
  // fall into the wrong bucket.
  const KNOWN = ['buy', 'sell', 'short_open', 'short_cover', 'margin_open',
    'margin_close', 'margin_liquidation', 'short_liquidation'];
  eq('exactly two of the eight trade types are purchases',
    KNOWN.filter((t) => E.BUY_TYPES.has(t)), ['buy', 'margin_open']);
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
