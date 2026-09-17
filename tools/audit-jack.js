#!/usr/bin/env node
// Politiko — jack-watch ledger audit
//
// Offline. Reads one file and asks of the blackjack ledger the things the panel does not:
// whether the receipts add up card by card, whether the deal looks like a fair six-deck
// shoe, what every decision cost, and — the question that produced this file — how bad a
// losing stretch has to be before it stops being ordinary weather.
//
// The panel refuses, on purpose, to turn a deviation into a probability
// (docs/19-casino-blackjack-surface.md, "What the exposure readout refuses to do"): the
// per-round distribution is not normal, and a percentage hung on a normal approximation is
// worst in exactly the tail somebody would consult it for. This tool sidesteps that
// objection instead of arguing with it. It draws per-round returns from an EMPIRICAL
// histogram — units of the opening bet, from thirty million simulated rounds of this rule
// set — and plays them through the ledger's own opening bets, in order, twenty thousand
// times. Nothing about the shape is assumed, so the answer is a count, not a curve.
//
// Every figure carries its bucket, as the panel's do:
//
//   COMPUTED    exact arithmetic on the stated rules — the house edge, an action's EV.
//   MEASURED    a sum, a count or a division over what the ledger actually holds.
//   ESTIMATED   anything a sample or a simulation stands behind — a deviation, a p-value,
//               a resampled quantile. These carry their sample size where it matters.
//
// DISCLOSURE
//
//   Reads:    one file — a store collection written by tools/collect-stores.js
//             (`artifacts/politiko-stores-*.json`, jack-watch under tools["pkbj:"].keys)
//             or a jack-watch LOG "save" bundle (format `jack-watch/round-ledger`,
//             versions 1 to 3; a version below 3 is noted, because its own money figures
//             were on the total-staked base, and everything here is recomputed) — and
//             userscripts/jack-watch.user.js, whose engine is lifted from between the
//             `// >>> ENGINE START` / `// <<< ENGINE END` markers the way
//             userscripts/tools/test-jack-ev.js lifts it. So "what the panel prints" here
//             IS the panel's arithmetic, not a copy of it, and the receipt checks that are
//             written independently are written independently of that.
//   Writes:   text to stdout. No file, no store, nothing else.
//   Requests: none. There is no network API, no browser API and no child process in this
//             file, and userscripts/tools/test-audit-jack.js fails the build if one appears.
//   Contents: hand ids, stakes and cards. Keep the inputs in artifacts/, which is gitignored.
//
// RUN IT
//
//   node tools/audit-jack.js                            newest artifacts/politiko-stores-*.json
//   node tools/audit-jack.js artifacts/politiko-stores-2026-09-12_19-16-47.json
//   node tools/audit-jack.js artifacts/jack-watch-round-ledger.json   a LOG "save" bundle
//
//   --corp <id>          which table, when a collection holds more than one (default: the fullest)
//   --scope whole,days,mark   which slices to print (default: all three; `mark` needs a mark)
//   --sims <n>           resampled ledgers per slice (default 20000)
//   --seed <n>           generator seed (default 20260917; same seed, same numbers)
//   --top <n>            mistakes and code deviations listed per slice (default 8)
//
// Fenced and driven by userscripts/tools/test-audit-jack.js.

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------------------
// The engine, lifted whole. If the block ever stops being liftable this is where it breaks,
// which is the point — see test-jack-ev.js for the same lift and the same reasoning.
// ---------------------------------------------------------------------------------------
const ENGINE_FILE = path.join(__dirname, '..', 'userscripts', 'jack-watch.user.js');
const liftEngine = (file = ENGINE_FILE) => {
  const SRC = fs.readFileSync(file, 'utf8');
  const A = '  // >>> ENGINE START';
  const B = '  // <<< ENGINE END';
  const i = SRC.indexOf(A);
  const j = SRC.indexOf(B, i);
  if (i < 0 || j <= i) throw new Error('engine markers not found in jack-watch.user.js');
  return new Function(`${SRC.slice(i, j)}
    return { num, RULES, RANKS, VAL, rankOf, codeOf, freshShoe, without, handOf, solve,
             roundEV, netOf, rollup, mean, stdev, roundReturns, upOf, replayNote, replayHand,
             decisionRoll, runDeviation };`)();
};

// ---------------------------------------------------------------------------------------
// The two fixed numbers this file brings with it, and where they came from.
//
// Per-round return histogram in units of the OPENING bet, from a 30M-round simulation of
// this rule set under perfect play on 2026-09-17: six decks, S17, DAS, one split, no
// surrender, 3:2. The tails are doubles and splits (−4 is a split with both halves doubled
// and both lost), +1.5 is a natural. The weights are rounded to four places and sum to
// 1.0002; they are normalised on use and the normalised mean and sd are printed beside the
// results so a reader can see the histogram agree with the edge and with the fixed sd.
// ---------------------------------------------------------------------------------------
const HIST = Object.freeze([
  [-4, 0.0002], [-3, 0.0017], [-2, 0.0426], [-1, 0.4344], [0, 0.0875],
  [1, 0.3266], [1.5, 0.0454], [2, 0.0592], [3, 0.0022], [4, 0.0004],
]);
// The textbook per-round sd of the same simulation. The panel uses the ledger's own sample
// sd, which is right for a long ledger and argues with itself on a short one — a day of
// forty rounds has a sd that is itself noise. Both are printed.
const FIXED_SD = 1.146;
const HIST_SOURCE = '30M simulated rounds, 2026-09-17';

const histStats = () => {
  const total = HIST.reduce((a, [, p]) => a + p, 0);
  let m = 0, m2 = 0;
  for (const [v, p] of HIST) { m += v * p / total; m2 += v * v * p / total; }
  return { mean: m, sd: Math.sqrt(m2 - m * m), total };
};

// mulberry32, not an LCG: a plain multiply-and-mask overflows a double at these constants
// and quietly stops being random, which shows up as a simulation that disagrees with the
// exact answer by ten times the sampling error. Math.imul keeps every step inside 32 bits.
// Copied from userscripts/tools/test-jack-ev.js, where the trap is documented.
const mulberry32 = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ---------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const money = (v) => (!isNum(v) ? 'n/a' : `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`);
const signedMoney = (v) => (!isNum(v) ? 'n/a' : (v > 0 ? '+' : '') + money(v));
const pct = (v, d = 3) => (!isNum(v) ? 'n/a' : `${(v * 100).toFixed(d)}%`);
const fix = (v, d = 3) => (!isNum(v) ? 'n/a' : v.toFixed(d));
const sdev = (z) => (!isNum(z) ? 'n/a' : `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(2)} sd`);
const n0 = (v) => (!isNum(v) ? 'n/a' : Math.round(v).toLocaleString('en-US'));
const plural = (n, w) => `${n0(n)} ${w}${n === 1 ? '' : 's'}`;

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const ET_STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const dayOf = (t) => (isNum(t) ? ET_DAY.format(new Date(t)) : null);
const stampOf = (t) => (isNum(t) ? `${ET_STAMP.format(new Date(t))} ET` : 'n/a');

const sortedQuantile = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))] : null);

// ---------------------------------------------------------------------------------------
// Chi-square survival function, via the regularised incomplete gamma (Numerical Recipes'
// gammp/gammq). p = Q(df/2, x/2). Checked in the test against the 5% critical values.
// ---------------------------------------------------------------------------------------
const lnGamma = (x) => {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};
const gammaPSeries = (a, x) => {
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 1000; n++) {
    ap += 1; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
};
const gammaQFraction = (a, x) => {
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
};
const chiP = (x2, df) => {
  if (!isNum(x2) || !isNum(df) || x2 < 0 || df <= 0) return null;
  if (x2 === 0) return 1;
  const a = df / 2, x = x2 / 2;
  return x < a + 1 ? 1 - gammaPSeries(a, x) : gammaQFraction(a, x);
};

// ---------------------------------------------------------------------------------------
// Loading. Two shapes, one ledger out: the panel's slim hand —
//   { id, status, outcome, seen, open, total, gross, tax, net, dealer[], hands[{cards, stake, outcome, status}] }
// sorted by id, which is the only ordering the wire gives (docs/19).
// ---------------------------------------------------------------------------------------
const settledOf = (h) => isNum(h.total) && isNum(h.gross) && isNum(h.tax) && isNum(h.net);

const fromCollection = (j, wantCorp) => {
  const keys = j.tools['pkbj:'].keys || {};
  const data = keys.data || {};
  const ui = keys.ui || {};
  const corps = data.corps && typeof data.corps === 'object' ? data.corps : {};
  const ids = Object.keys(corps);
  if (!ids.length) throw new Error('the collection carries jack-watch but no table: data.corps is empty');
  const sizeOf = (id) => Object.keys((corps[id] && corps[id].hands) || {}).length;
  let corp = wantCorp != null ? String(wantCorp) : null;
  if (corp === null) corp = ids.slice().sort((a, b) => sizeOf(b) - sizeOf(a))[0];
  if (!corps[corp]) throw new Error(`no corporation ${corp} in the collection; it holds ${ids.join(', ')}`);
  const hands = Object.values(corps[corp].hands || {})
    .filter((h) => h && typeof h === 'object' && isNum(h.id))
    .map((h) => ({
      id: h.id, status: h.status ?? null, outcome: h.outcome ?? null,
      seen: isNum(h.seen) ? h.seen : null,
      open: isNum(h.open) ? h.open : null,
      total: isNum(h.total) ? h.total : null, gross: isNum(h.gross) ? h.gross : null,
      tax: isNum(h.tax) ? h.tax : null, net: isNum(h.net) ? h.net : null,
      dealer: (h.dealer || []).filter((c) => typeof c === 'string'),
      hands: (h.hands || []).map((p) => ({
        cards: (p.cards || []).filter((c) => typeof c === 'string'),
        stake: isNum(p.stake) ? p.stake : null, outcome: p.outcome ?? null, status: p.status ?? null,
      })),
    }))
    .sort((a, b) => a.id - b.id);
  const mark = ui.mark && isNum(ui.mark[corp]) ? ui.mark[corp] : null;
  return {
    kind: 'store collection', corp, corps: ids.map((id) => ({ id, hands: sizeOf(id) })),
    hands, mark, storedEdge: data.edge && isNum(data.edge.edge) ? data.edge.edge : null,
    collectedAt: j.collected_at ?? null, tool: j.tools['pkbj:'].tool ?? null, version: null,
  };
};

const fromBundle = (j) => {
  const rounds = Array.isArray(j.rounds) ? j.rounds : [];
  const hands = rounds
    .filter((r) => r && typeof r === 'object' && isNum(r.id))
    .map((r) => ({
      id: r.id, status: r.status ?? null, outcome: r.outcome ?? null,
      seen: typeof r.first_seen === 'string' && Number.isFinite(Date.parse(r.first_seen)) ? Date.parse(r.first_seen) : null,
      open: isNum(r.opening_bet) ? r.opening_bet : null,
      total: isNum(r.total_staked) ? r.total_staked : null, gross: isNum(r.gross) ? r.gross : null,
      tax: isNum(r.tax) ? r.tax : null, net: isNum(r.credited) ? r.credited : null,
      dealer: (r.dealer || []).filter((c) => typeof c === 'string'),
      hands: (r.hands || []).map((p) => ({
        cards: (p.cards || []).filter((c) => typeof c === 'string'),
        stake: isNum(p.stake) ? p.stake : null, outcome: p.outcome ?? null, status: p.status ?? null,
      })),
    }))
    .sort((a, b) => a.id - b.id);
  const scope = j.scope || {};
  return {
    kind: 'save bundle', corp: scope.corporation != null ? String(scope.corporation) : null, corps: null,
    hands, mark: isNum(scope.mark) ? scope.mark : null, storedEdge: j.edge && isNum(j.edge.computed) ? j.edge.computed : null,
    collectedAt: j.collected_at ?? null, tool: j.tool ?? null, version: isNum(j.version) ? j.version : null,
  };
};

const detect = (j, opts = {}) => {
  if (j && typeof j === 'object' && j.format === 'jack-watch/round-ledger') return fromBundle(j);
  if (j && typeof j === 'object' && j.tools && j.tools['pkbj:'] && j.tools['pkbj:'].keys) return fromCollection(j, opts.corp);
  throw new Error('not a store collection (no tools["pkbj:"]) and not a jack-watch/round-ledger bundle');
};

const loadFile = (file, opts = {}) => {
  const L = detect(JSON.parse(fs.readFileSync(file, 'utf8')), opts);
  L.file = file;
  return L;
};

const listCollections = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^politiko-stores-.*\.json$/.test(f))
    .sort().reverse()
    .map((f) => path.join(dir, f));
};

// ---------------------------------------------------------------------------------------
// Slices: the whole ledger, each Eastern calendar day of `seen`, and above the LOG mark.
// `seen` is when the tool first read the round, never when it was played (docs/19) — so a
// history back-fill lands whole on the day it was collected, and the header says so.
// ---------------------------------------------------------------------------------------
const slicesOf = (L, which = ['whole', 'days', 'mark']) => {
  const settled = L.hands.filter(settledOf);
  const out = [];
  if (which.includes('whole')) out.push({ name: 'whole ledger', list: settled });
  if (which.includes('days')) {
    const byDay = new Map();
    for (const h of settled) {
      const d = dayOf(h.seen) || 'no seen stamp';
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(h);
    }
    for (const d of [...byDay.keys()].sort()) out.push({ name: `seen ${d} (Eastern)`, list: byDay.get(d) });
  }
  if (which.includes('mark')) {
    if (isNum(L.mark)) out.push({ name: `above the LOG mark #${L.mark}`, list: settled.filter((h) => h.id > L.mark) });
    else out.push({ name: 'above the LOG mark', list: null });
  }
  return out;
};

// ---------------------------------------------------------------------------------------
// 1. Money, as the panel prints it — and the same distance measured two more ways.
// ---------------------------------------------------------------------------------------
const moneyOf = (E, list, edge) => {
  const r = E.rollup(list);
  const rets = E.roundReturns(list);
  const sd = E.stdev(rets);
  // The panel's own distance: expectation on the opening bets since 0.13.0, spread from
  // the ledger's own sample sd. The same distance is then taken with the fixed textbook
  // sd, so a short slice — a day of forty rounds, whose sample sd is itself noise — does
  // not argue with itself.
  const panel = E.runDeviation(list, edge, sd);
  let opened = 0, staked = 0, pnl = 0, sq = 0, n = 0;
  for (const h of list) {
    const nt = E.netOf(h);
    if (nt === null) continue;
    const unit = isNum(h.open) ? h.open : h.total;
    if (!isNum(unit)) continue;
    opened += unit; staked += h.total; pnl += nt; sq += unit * unit; n++;
  }
  const expected = -opened * edge;
  const dist = (s) => (isNum(s) && s > 0 && n ? { cashSD: Math.sqrt(sq) * s, z: (pnl - expected) / (Math.sqrt(sq) * s) } : null);
  return {
    roll: r, sdSample: sd, sdN: rets.length, panel, opened, pnl, expected,
    // what 0.12.0 and earlier charged: the edge on everything the rounds went on to stake
    expectedOldBase: -staked * edge,
    fixed: dist(FIXED_SD),
  };
};

// ---------------------------------------------------------------------------------------
// 2. Decisions, replayed from the cards by the panel's own walk.
// ---------------------------------------------------------------------------------------
const decisionsOf = (E, list) => {
  const reasons = new Map();
  const all = [];
  for (const h of list) {
    const note = E.replayNote(h);
    const key = note ?? 'replayed';
    reasons.set(key, (reasons.get(key) || 0) + 1);
    if (note) continue;
    const cards = (h.hands[0].cards || []).filter((c) => E.rankOf(c) !== null);
    const ds = E.replayHand(h);
    // The walk prices one step per card from the second on, so the k-th decision was
    // taken holding the first k+2 cards.
    ds.forEach((d, i) => all.push(Object.assign({}, d, {
      held: cards.slice(0, i + 2), total: E.handOf(cards.slice(0, i + 2)).best, up: h.dealer[0],
      gap: isNum(d.bestEV) && isNum(d.ev) ? d.bestEV - d.ev : null,
    })));
  }
  const roll = E.decisionRoll(all);
  const played = new Map();
  const departures = new Map();
  for (const d of all) {
    played.set(d.act, (played.get(d.act) || 0) + 1);
    if (d.act === d.want) continue;
    const k = `${d.act} → ${d.want}`;
    const cur = departures.get(k) || { n: 0, cost: 0 };
    cur.n++; cur.cost += isNum(d.cost) ? d.cost : 0;
    departures.set(k, cur);
  }
  const worst = all.filter((d) => d.act !== d.want).sort((a, b) => (b.cost || 0) - (a.cost || 0));
  return { reasons, roll, played, departures, worst, all };
};

// ---------------------------------------------------------------------------------------
// 3. Receipts, recomputed from the cards without the engine's EVs. A second, independent
// totaller on purpose: agreement between two implementations is the check.
// ---------------------------------------------------------------------------------------
const pip = (card) => {
  if (typeof card !== 'string' || card.length < 2) return null;
  const r = card.slice(0, -1).toUpperCase();
  if (r === 'A') return 1;
  if (r === 'J' || r === 'Q' || r === 'K' || r === '10') return 10;
  const v = Number(r);
  return Number.isInteger(v) && v >= 2 && v <= 9 ? v : null;
};
const suitOf = (card) => (typeof card === 'string' && card.length >= 2 ? card.slice(-1).toUpperCase() : null);
const total = (cards) => {
  let t = 0, aces = 0, n = 0, unknown = 0;
  for (const c of cards || []) {
    const v = pip(c);
    if (v === null) { unknown++; continue; }
    t += v; if (v === 1) aces++; n++;
  }
  const soft = aces > 0 && t + 10 <= 21;
  const best = soft ? t + 10 : t;
  return { best, soft, bust: t > 21, n, unknown, natural: n === 2 && unknown === 0 && best === 21 };
};
const isNatural = (cards) => total(cards).natural;

const receiptsOf = (list, top) => {
  const out = {
    naturals: { n: 0, bad: [] }, dealerNaturals: { n: 0, bad: [] },
    s17: { n: 0, bad: [], bustedShort: 0, bustedRounds: 0 },
    gross: { n: 0, bad: [] }, splits: { n: 0, bad: [], aceTwentyOnes: [] },
    reconcile: { n: 0, bad: [] },
  };
  for (const h of list) {
    const dealer = total(h.dealer);
    const dNat = isNatural(h.dealer);
    const single = h.hands.length === 1;
    const p0 = single ? h.hands[0] : null;
    const open = isNum(h.open) ? h.open : h.total;

    // gross − tax = net on every round, or every other number is built on sand
    out.reconcile.n++;
    if (h.gross - h.tax !== h.net) out.reconcile.bad.push({ id: h.id, gross: h.gross, tax: h.tax, net: h.net });

    // a single-hand natural pays 2.5× the bet, or pushes against the dealer's own
    if (single && isNatural(p0.cards)) {
      out.naturals.n++;
      const want = dNat ? open : 2.5 * open;
      if (h.gross !== want || h.total !== open) {
        out.naturals.bad.push({ id: h.id, gross: h.gross, want, total: h.total, open, note: dNat ? 'push vs dealer natural' : '3:2' });
      }
    }
    // the peek: a dealer natural ends the round before any double or split, so nothing
    // beyond the opening bet is ever collected, and a non-natural player hand gets nothing
    if (dNat) {
      out.dealerNaturals.n++;
      const pNat = single && isNatural(p0.cards);
      const want = pNat ? open : 0;
      if (h.total !== open || h.gross !== want) {
        out.dealerNaturals.bad.push({ id: h.id, total: h.total, open, gross: h.gross, want });
      }
    }
    // S17: with a live, non-natural player hand the dealer stands at 17 or better and
    // never draws past a standing total. Rounds where every player hand bust are excluded
    // (the dealer does not play them out — measured, docs/19), and so are naturals.
    const allBust = h.hands.every((p) => total(p.cards).bust);
    if (allBust) { out.s17.bustedRounds++; if (dealer.best < 17 && !dealer.bust) out.s17.bustedShort++; }
    const pNatAny = h.hands.some((p) => p.cards.length === 2 && isNatural(p.cards)) && single;
    if (!allBust && !dNat && !pNatAny && dealer.unknown === 0 && h.dealer.length >= 2) {
      out.s17.n++;
      if (!dealer.bust && dealer.best < 17) out.s17.bad.push({ id: h.id, dealer: h.dealer, why: `stood on ${dealer.best}` });
      for (let k = 2; k < h.dealer.length; k++) {
        const pre = total(h.dealer.slice(0, k));
        if (pre.best >= 17 && !pre.bust) { out.s17.bad.push({ id: h.id, dealer: h.dealer, why: `drew on ${pre.soft ? 'soft ' : ''}${pre.best}` }); break; }
      }
    }
    // every single-hand non-natural gross, from the cards. A dealer natural beats a
    // three-card 21; otherwise bust loses, a dealer bust wins, and totals compare.
    if (single && !isNatural(p0.cards) && p0.cards.length >= 2 && dealer.unknown === 0 && h.dealer.length >= 2) {
      const stake = isNum(p0.stake) ? p0.stake : h.total;
      const p = total(p0.cards);
      let want;
      if (p.bust) want = 0;
      else if (dNat) want = 0;
      else if (dealer.bust) want = 2 * stake;
      else if (p.best > dealer.best) want = 2 * stake;
      else if (p.best === dealer.best) want = stake;
      else want = 0;
      out.gross.n++;
      if (h.gross !== want || h.total !== stake) {
        out.gross.bad.push({ id: h.id, cards: p0.cards, dealer: h.dealer, stake, total: h.total, gross: h.gross, want });
      }
    }
    // splits: each half against the same dealer hand, a 21 on a split ace assumed to pay
    // even money (docs/19 lists that as unstated). Any split-ace 21 is listed with what it
    // actually paid, because that is the way to find out.
    if (!single && h.hands.length === 2 && dealer.unknown === 0 && h.dealer.length >= 2) {
      out.splits.n++;
      let want = 0, stakes = 0, ok = true;
      for (const p of h.hands) {
        const stake = isNum(p.stake) ? p.stake : null;
        if (stake === null || p.cards.length < 2) { ok = false; break; }
        stakes += stake;
        const t = total(p.cards);
        let w;
        if (t.bust) w = 0;
        else if (dNat) w = 0;
        else if (dealer.bust) w = 2 * stake;
        else if (t.best > dealer.best) w = 2 * stake;
        else if (t.best === dealer.best) w = stake;
        else w = 0;
        want += w;
        if (pip(p.cards[0]) === 1 && p.cards.length === 2 && t.best === 21) {
          out.splits.aceTwentyOnes.push({ id: h.id, cards: p.cards, dealer: h.dealer, stake, gross: h.gross, evenMoney: want });
        }
      }
      if (ok && (h.gross !== want || h.total !== stakes)) {
        out.splits.bad.push({ id: h.id, hands: h.hands.map((p) => p.cards), dealer: h.dealer, total: h.total, stakes, gross: h.gross, want });
      }
    }
  }
  for (const k of Object.keys(out)) if (out[k].bad && out[k].bad.length > top) out[k].more = out[k].bad.length - top;
  return out;
};

// ---------------------------------------------------------------------------------------
// 4. Card fairness. Every card the ledger holds, by rank class, exact code and suit; and
// rank shares by table position, because a shoe that is fair overall and not fair by
// position is the shape a rigged deal would take.
// ---------------------------------------------------------------------------------------
const POSITIONS = ['dealer up', 'hole', 'dealer draws', 'player 1st', 'player 2nd', 'player draws'];
const SUITS = ['S', 'H', 'D', 'C'];
const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];
const codeOf = (card) => {
  if (typeof card !== 'string' || card.length < 2) return null;
  const c = card.toUpperCase();
  const r = c.slice(0, -1), s = c.slice(-1);
  if (!SUITS.includes(s) || pip(c) === null) return null;
  return r + s;
};
const rankClass = (card) => { const v = pip(card); return v === null ? null : (v === 1 ? 0 : v - 1); };

const fairnessOf = (list, top) => {
  const cards = [];             // { code, rank, suit, pos }
  let hidden = 0, unplaced = 0, splitRounds = 0;
  for (const h of list) {
    const push = (card, pos) => {
      const code = codeOf(card);
      if (code === null) { if (card === 'hidden') hidden++; return; }
      cards.push({ code, rank: rankClass(card), suit: code.slice(-1), pos });
    };
    h.dealer.forEach((c, i) => push(c, i === 0 ? 'dealer up' : (i === 1 ? 'hole' : 'dealer draws')));
    if (h.hands.length === 1) {
      h.hands[0].cards.forEach((c, i) => push(c, i === 0 ? 'player 1st' : (i === 1 ? 'player 2nd' : 'player draws')));
    } else {
      // which half took which card is not on the wire, and the second half's first card
      // was dealt as the player's second — pooled tests take them, the position table does not
      splitRounds++;
      for (const p of h.hands) for (const c of p.cards) { push(c, null); unplaced++; }
    }
  }
  const n = cards.length;
  const chi = (counts, expected) => counts.reduce((a, o, i) => a + (expected[i] > 0 ? (o - expected[i]) ** 2 / expected[i] : 0), 0);

  const rankCounts = new Array(10).fill(0);
  const codeCounts = Object.create(null);
  const suitCounts = { S: 0, H: 0, D: 0, C: 0 };
  let hilo = 0;
  for (const c of cards) {
    rankCounts[c.rank]++;
    codeCounts[c.code] = (codeCounts[c.code] || 0) + 1;
    suitCounts[c.suit]++;
    if (c.rank >= 1 && c.rank <= 5) hilo++; else if (c.rank === 0 || c.rank === 9) hilo--;
  }
  const rankExp = RANK_LABELS.map((_, r) => n * (r === 9 ? 4 / 13 : 1 / 13));
  const rankX2 = chi(rankCounts, rankExp);
  const codes = [];
  for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) for (const s of SUITS) codes.push(r + s);
  const codeObs = codes.map((c) => codeCounts[c] || 0);
  const codeExp = codes.map(() => n / 52);
  const codeX2 = chi(codeObs, codeExp);
  const suitObs = SUITS.map((s) => suitCounts[s]);
  const suitX2 = chi(suitObs, SUITS.map(() => n / 4));
  const codeDev = codes.map((c, i) => ({ code: c, obs: codeObs[i], exp: codeExp[i], z: codeExp[i] > 0 ? (codeObs[i] - codeExp[i]) / Math.sqrt(codeExp[i]) : 0 }))
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const missing = codes.filter((c) => !codeCounts[c]);

  const share = (sub, pred, p) => {
    const k = sub.filter(pred).length, m = sub.length;
    return { k, share: m ? k / m : null, z: m ? (k - m * p) / Math.sqrt(m * p * (1 - p)) : null };
  };
  const positions = POSITIONS.concat(['all']).map((pos) => {
    const sub = pos === 'all' ? cards : cards.filter((c) => c.pos === pos);
    return { pos, n: sub.length, tens: share(sub, (c) => c.rank === 9, 4 / 13), aces: share(sub, (c) => c.rank === 0, 1 / 13) };
  });

  return {
    n, hidden, unplaced, splitRounds,
    rank: { x2: rankX2, df: 9, p: chiP(rankX2, 9), counts: rankCounts, expected: rankExp },
    code: { x2: codeX2, df: 51, p: chiP(codeX2, 51), missing, top: codeDev.slice(0, top) },
    suit: { x2: suitX2, df: 3, p: chiP(suitX2, 3), counts: suitObs },
    hilo: { sum: hilo, sd: Math.sqrt(n * 10 / 13), z: n ? hilo / Math.sqrt(n * 10 / 13) : null },
    positions,
  };
};

// ---------------------------------------------------------------------------------------
// 5. Drawdown, sized by resampling — the observed slide, then twenty thousand ledgers with
// the same opening bets in the same order and returns drawn from the histogram.
// ---------------------------------------------------------------------------------------
const observedOf = (E, list) => {
  const rows = list.map((h) => ({ id: h.id, r: E.netOf(h), open: isNum(h.open) ? h.open : h.total })).filter((x) => x.r !== null && isNum(x.open));
  let cum = 0, peak = 0, peakAt = -1, maxDD = 0, ddPeakAt = -1, ddTroughAt = -1, peakCum = 0, troughCum = 0;
  let run = 0, runFrom = -1, best = 0, bestFrom = -1, bestTo = -1;
  rows.forEach((x, i) => {
    cum += x.r;
    if (cum > peak) { peak = cum; peakAt = i; }
    const dd = peak - cum;
    if (dd > maxDD) { maxDD = dd; ddPeakAt = peakAt; ddTroughAt = i; peakCum = peak; troughCum = cum; }
    // A losing run is losses in a row with pushes IGNORED — a push neither counts nor ends
    // it. That is the run a player feels, and the one docs/19 measured at nine.
    if (x.r < 0) { if (!run) runFrom = i; run++; if (run > best) { best = run; bestFrom = runFrom; bestTo = i; } } else if (x.r > 0) run = 0;
  });
  const idAt = (i) => (i < 0 ? null : rows[i].id);
  return {
    n: rows.length, final: cum, opens: rows.map((x) => x.open),
    maxDD, peakId: idAt(ddPeakAt), troughId: idAt(ddTroughAt), peakCum, troughCum,
    peakIsStart: maxDD > 0 && ddPeakAt < 0,
    slideN: maxDD > 0 ? ddTroughAt - ddPeakAt : 0,
    run: best, runFrom: idAt(bestFrom), runTo: idAt(bestTo),
  };
};

const resample = (opens, obs, { sims = 20000, seed = 20260917, window = 0 } = {}) => {
  const n = opens.length;
  const total = HIST.reduce((a, [, p]) => a + p, 0);
  const cum = [];
  let acc = 0;
  for (const [v, p] of HIST) { acc += p / total; cum.push([acc, v]); }
  cum[cum.length - 1][0] = 1;
  const draw = (u) => { for (let i = 0; i < cum.length; i++) if (u < cum[i][0]) return cum[i][1]; return cum[cum.length - 1][1]; };
  const rnd = mulberry32(seed);
  const finals = new Float64Array(sims), dds = new Float64Array(sims), wins = new Float64Array(sims), runs = new Int32Array(sims);
  const pre = new Float64Array(n + 1);
  let ddHits = 0, winHits = 0, runHits = 0, finalHits = 0, sumRet = 0, sumRet2 = 0;
  const N = window > 0 && window <= n ? window : 0;
  for (let s = 0; s < sims; s++) {
    let c = 0, peak = 0, dd = 0, run = 0, maxRun = 0, worst = Infinity;
    for (let i = 0; i < n; i++) {
      const r = draw(rnd());
      sumRet += r; sumRet2 += r * r;
      c += opens[i] * r;
      pre[i + 1] = c;
      if (c > peak) peak = c;
      if (peak - c > dd) dd = peak - c;
      if (r < 0) { run++; if (run > maxRun) maxRun = run; } else if (r > 0) run = 0;   // pushes ignored, as observed
      if (N && i + 1 >= N) { const w = c - pre[i + 1 - N]; if (w < worst) worst = w; }
    }
    finals[s] = c; dds[s] = dd; wins[s] = N ? worst : 0; runs[s] = maxRun;
    if (dd >= obs.maxDD) ddHits++;
    if (N && worst <= -obs.maxDD) winHits++;
    if (maxRun >= obs.run) runHits++;
    if (c <= obs.final) finalHits++;
  }
  finals.sort(); dds.sort(); wins.sort(); runs.sort();
  const q = (arr, p) => sortedQuantile(arr, p);
  const meanOf = (arr) => { let t = 0; for (const v of arr) t += v; return arr.length ? t / arr.length : null; };
  const draws = sims * n;
  const m = draws ? sumRet / draws : null;
  return {
    sims, seed, n, draws, meanRet: m, sdRet: draws ? Math.sqrt(sumRet2 / draws - m * m) : null,
    final: { median: q(finals, 0.5), p5: q(finals, 0.05), p95: q(finals, 0.95), pAtMostObs: sims ? finalHits / sims : null },
    dd: { median: q(dds, 0.5), mean: meanOf(dds), p75: q(dds, 0.75), p90: q(dds, 0.9), pAtLeastObs: sims ? ddHits / sims : null },
    win: { N, median: N ? q(wins, 0.5) : null, p10: N ? q(wins, 0.1) : null, p5: N ? q(wins, 0.05) : null, pAtMostObs: N && sims ? winHits / sims : null },
    run: { median: q(runs, 0.5), p90: q(runs, 0.9), pAtLeastObs: sims ? runHits / sims : null },
  };
};

// ---------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------
const report = (L, opts = {}) => {
  const E = opts.engine || liftEngine();
  const top = isNum(opts.top) ? opts.top : 8;
  const which = opts.scope || ['whole', 'days', 'mark'];
  const lines = [];
  const p = (s = '') => lines.push(s);
  const row = (label, value, tag, note) => p(`  ${label.padEnd(30)} ${String(value).padEnd(24)} ${tag ? `[${tag}]` : ''}${note ? `  ${note}` : ''}`);

  const edgeRun = E.roundEV(E.freshShoe());
  const edge = edgeRun.edge;
  const hs = histStats();

  const settled = L.hands.filter(settledOf);
  const seen = L.hands.map((h) => h.seen).filter(isNum);
  p('# jack-watch ledger audit');
  p();
  row('file', L.file ? path.basename(L.file) : '(object)', null);
  row('shape', `${L.kind}${L.version !== null ? ` v${L.version}` : ''}${L.tool ? ` (${L.tool})` : ''}`, null,
    L.version !== null && L.version < 3
      ? 'a pre-0.13.0 file: its own drag, realized edge and luck.expected were on the total-staked base; everything here is recomputed from the rounds'
      : null);
  row('collected', L.collectedAt ? `${L.collectedAt} = ${stampOf(Date.parse(L.collectedAt))}` : 'n/a', null);
  row('table', `corporation ${L.corp ?? 'n/a'}${L.corps && L.corps.length > 1 ? ` (also held: ${L.corps.filter((c) => c.id !== L.corp).map((c) => `${c.id}: ${c.hands}`).join(', ')})` : ''}`, null);
  row('rounds held', `${n0(L.hands.length)} (${n0(settled.length)} settled, ${n0(L.hands.length - settled.length)} not)`, 'MEASURED');
  if (L.hands.length) row('ids', `#${L.hands[0].id} – #${L.hands[L.hands.length - 1].id}`, 'MEASURED');
  if (seen.length) row('first seen', `${stampOf(Math.min(...seen))} – ${stampOf(Math.max(...seen))}`, 'MEASURED', 'when the tool first READ each round, never when it was played');
  row('LOG mark', isNum(L.mark) ? `#${L.mark}` : 'none', null);
  row('house edge, perfect play', pct(edge, 4), 'COMPUTED', `${n0(edgeRun.deals)} initial deals summed, fresh six-deck shoe`);
  if (isNum(L.storedEdge) && Math.abs(L.storedEdge - edge) > 1e-9) row('edge the file carried', pct(L.storedEdge, 4), 'COMPUTED', 'differs from the engine on disk');
  row('return histogram', `mean ${fix(hs.mean, 4)} u · sd ${fix(hs.sd, 3)} u`, 'ESTIMATED', `${HIST_SOURCE}; weights sum ${fix(hs.total, 4)}, normalised`);
  row('fixed per-round sd', `${FIXED_SD} u`, 'ESTIMATED', 'same simulation; used beside the sample sd below');
  p();
  p('  Buckets: COMPUTED is exact arithmetic on the stated rules; MEASURED is a sum, count or');
  p('  division over what the ledger holds; ESTIMATED is anything a sample or a simulation');
  p('  stands behind. A z here is a distance in deviations; the resampling in 5 is the only');
  p('  place a probability is attached to one, and it assumes no shape.');

  for (const slice of slicesOf(L, which)) {
    p();
    p(`## ${slice.name}`);
    p();
    if (slice.list === null) { p('  no mark set in the file — LOG\'s "clear" writes one; nothing to slice above.'); continue; }
    const list = slice.list;
    if (!list.length) { p('  no settled rounds in this slice.'); continue; }

    // -- 1 --------------------------------------------------------------------------------
    const m = moneyOf(E, list, edge);
    const r = m.roll;
    p('— 1. money, as the panel prints it —');
    row('rounds', `${n0(r.n)}  (${r.wins} won · ${r.pushes} push · ${r.losses} lost)`, 'MEASURED', `${plural(r.naturals, 'natural')}; win rate ${pct(r.winRate, 1)}`);
    row('opening bets', money(r.opened), 'MEASURED');
    row('total staked', money(r.wagered), 'MEASURED', `×${fix(r.stakeMult, 3)} of opening bets (doubles and splits)`);
    row('gross / tax / credited', `${money(r.gross)} / ${money(r.tax)} / ${money(r.credited)}`, 'MEASURED', r.reconciles ? 'gross − tax = credited on every round' : 'DOES NOT RECONCILE');
    row('net P&L', signedMoney(r.net), 'MEASURED');
    row('realized edge', pct(r.realizedEdge), 'MEASURED', 'cost per dollar of opening bet, the unit the edge is in; negative is in your favour');
    row('tax drag', r.taxed ? pct(r.taxDrag) : 'nothing taxed', 'MEASURED', r.taxed ? 'per dollar of opening bet' : null);
    row('per-round sd, this ledger', isNum(m.sdSample) ? `${fix(m.sdSample)} u over ${n0(m.sdN)}` : 'n/a', 'ESTIMATED', `sample sd of net ÷ opening bet; the simulation says ${FIXED_SD}`);
    row('expected', signedMoney(m.expected), 'COMPUTED', `edge × opening bets, the panel's base since 0.13.0 (on total staked, as 0.12.0 charged it: ${signedMoney(m.expectedOldBase)})`);
    row('distance, panel', m.panel ? `${sdev(m.panel.z)}  (1 sd = ${money(m.panel.cashSD)})` : 'n/a', 'ESTIMATED', 'runDeviation as MONEY prints it: this ledger\'s own sd');
    row('distance, fixed sd', m.fixed ? `${sdev(m.fixed.z)}  (1 sd = ${money(m.fixed.cashSD)})` : 'n/a', 'ESTIMATED', `same expectation, sd ${FIXED_SD} u — the one to read on a short slice`);

    // -- 2 --------------------------------------------------------------------------------
    const d = decisionsOf(E, list);
    p();
    p('— 2. decisions, replayed from the cards —');
    const reasons = [...d.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
    row('rounds by replay status', reasons, 'MEASURED', 'a split contributes no decisions: which half took which card is not on the wire');
    row('decisions', `${n0(d.roll.n)}  (${n0(d.roll.matched)} at the maximum, ${pct(d.roll.rate, 1)})`, 'COMPUTED', [...d.played.entries()].map(([k, v]) => `${k} ${v}`).join(' · '));
    row('EV given up', money(d.roll.cost), 'COMPUTED', 'sum over departures, priced against the table shoe at that moment');
    if (d.departures.size) {
      row('departures', [...d.departures.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([k, v]) => `${k} ×${v.n} (${money(v.cost)})`).join(' · '), 'COMPUTED');
      p('  top mistakes by cost:');
      for (const w of d.worst.slice(0, top)) {
        p(`    #${String(w.id).padEnd(6)} ${w.held.join(' ').padEnd(14)} (${String(w.total).padStart(2)}) vs ${String(w.up).padEnd(4)} ${w.act.padEnd(6)} → ${w.want.padEnd(6)} gap ${fix(w.gap)} u   cost ${money(w.cost)} on ${money(w.stake)}`);
      }
      if (d.worst.length > top) p(`    … and ${d.worst.length - top} more`);
    }

    // -- 3 --------------------------------------------------------------------------------
    const rc = receiptsOf(list, top);
    p();
    p('— 3. receipts, recomputed from the cards (independent of the engine) —');
    const verdict = (c, what) => `${n0(c.n)} checked · ${c.bad.length ? `${c.bad.length} OFF` : 'all agree'}${what ? `  ${what}` : ''}`;
    row('reconcile gross − tax = net', verdict(rc.reconcile), 'MEASURED');
    for (const b of rc.reconcile.bad.slice(0, top)) p(`    #${b.id}  gross ${money(b.gross)} − tax ${money(b.tax)} ≠ net ${money(b.net)}`);
    row('naturals paid 3:2', verdict(rc.naturals), 'MEASURED', 'single-hand two-card 21: 2.5× the bet, or a push against a dealer natural');
    for (const b of rc.naturals.bad.slice(0, top)) p(`    #${b.id}  gross ${money(b.gross)}, expected ${money(b.want)} (${b.note}); total ${money(b.total)} on ${money(b.open)}`);
    row('dealer naturals: the peek', verdict(rc.dealerNaturals), 'MEASURED', 'never more than the opening bet collected, nothing paid on a non-natural');
    for (const b of rc.dealerNaturals.bad.slice(0, top)) p(`    #${b.id}  total ${money(b.total)} on ${money(b.open)}, gross ${money(b.gross)} vs ${money(b.want)}`);
    row('dealer plays S17', verdict(rc.s17), 'MEASURED', `stands at 17+, never draws past one; ${rc.s17.bustedRounds} all-bust rounds excluded, ${rc.s17.bustedShort} of them left under 17`);
    for (const b of rc.s17.bad.slice(0, top)) p(`    #${b.id}  dealer ${b.dealer.join(' ')}: ${b.why}`);
    row('single-hand gross from cards', verdict(rc.gross), 'MEASURED', 'non-natural hands: bust 0, dealer bust 2×, compare totals, dealer natural beats a 21');
    for (const b of rc.gross.bad.slice(0, top)) p(`    #${b.id}  ${b.cards.join(' ')} vs ${b.dealer.join(' ')}: gross ${money(b.gross)}, expected ${money(b.want)} on ${money(b.stake)}${b.total !== b.stake ? ` (total ${money(b.total)} ≠ stake)` : ''}`);
    row('split gross from cards', verdict(rc.splits), 'MEASURED', 'both halves against the same dealer hand; a 21 on a split ace assumed even money');
    for (const b of rc.splits.bad.slice(0, top)) p(`    #${b.id}  ${b.hands.map((c) => c.join(' ')).join(' | ')} vs ${b.dealer.join(' ')}: gross ${money(b.gross)}, expected ${money(b.want)}; total ${money(b.total)} vs stakes ${money(b.stakes)}`);
    if (rc.splits.aceTwentyOnes.length) {
      p('  split-ace 21s — what they actually paid (docs/19 lists this as unstated):');
      for (const a of rc.splits.aceTwentyOnes.slice(0, top)) p(`    #${a.id}  ${a.cards.join(' ')} vs ${a.dealer.join(' ')}: round gross ${money(a.gross)}, even-money expectation ${money(a.evenMoney)}`);
    }

    // -- 4 --------------------------------------------------------------------------------
    const f = fairnessOf(list, top);
    p();
    p('— 4. card fairness —');
    row('cards', `${n0(f.n)}${f.hidden ? ` (+${f.hidden} never revealed)` : ''}`, 'MEASURED', f.splitRounds ? `${f.unplaced} from ${plural(f.splitRounds, 'split round')} pooled but not placed` : null);
    if (f.n) {
      const pv = (x) => (isNum(x) ? `p ${x < 0.001 ? '< 0.001' : fix(x, 3)}` : 'p n/a');
      row('rank χ², 9 df', `${fix(f.rank.x2, 2)}  ${pv(f.rank.p)}`, 'ESTIMATED', `5% critical 16.92; counts ${RANK_LABELS.map((l, i) => `${l}:${f.rank.counts[i]}`).join(' ')}`);
      row('code χ², 51 df', `${fix(f.code.x2, 2)}  ${pv(f.code.p)}`, 'ESTIMATED', `5% critical 68.67${f.code.missing.length ? `; never seen: ${f.code.missing.join(' ')}` : '; all 52 codes seen'}`);
      row('suit χ², 3 df', `${fix(f.suit.x2, 2)}  ${pv(f.suit.p)}`, 'ESTIMATED', `5% critical 7.81; S ${f.suit.counts[0]} H ${f.suit.counts[1]} D ${f.suit.counts[2]} C ${f.suit.counts[3]}`);
      row('hi-lo running total', `${f.hilo.sum >= 0 ? '+' : ''}${f.hilo.sum}  (${sdev(f.hilo.z)})`, 'ESTIMATED', `sd ${fix(f.hilo.sd, 1)} over ${f.n} cards`);
      p('  rank shares by position (tens expected 30.77%, aces 7.69%):');
      p(`    ${'position'.padEnd(14)} ${'n'.padStart(5)}   ${'tens'.padStart(7)} ${'z'.padStart(6)}   ${'aces'.padStart(7)} ${'z'.padStart(6)}`);
      for (const q of f.positions) {
        p(`    ${q.pos.padEnd(14)} ${String(q.n).padStart(5)}   ${pct(q.tens.share, 2).padStart(7)} ${fix(q.tens.z, 2).padStart(6)}   ${pct(q.aces.share, 2).padStart(7)} ${fix(q.aces.z, 2).padStart(6)}`);
      }
      p('  largest code deviations (so a borderline code χ² can be read):');
      p(`    ${f.code.top.map((c) => `${c.code} ${c.obs}/${fix(c.exp, 1)} (${c.z >= 0 ? '+' : ''}${fix(c.z, 2)})`).join('  ')}`);
    }

    // -- 5 --------------------------------------------------------------------------------
    const obs = observedOf(E, list);
    p();
    p('— 5. drawdown, sized by resampling —');
    row('final P&L', signedMoney(obs.final), 'MEASURED', `${plural(obs.n, 'round')} in id order`);
    if (obs.maxDD > 0) {
      row('max drawdown', money(obs.maxDD), 'MEASURED', `${obs.peakIsStart ? 'from the start' : `from #${obs.peakId} (${signedMoney(obs.peakCum)})`} to #${obs.troughId} (${signedMoney(obs.troughCum)}), ${plural(obs.slideN, 'round')}`);
    } else {
      row('max drawdown', '$0', 'MEASURED', 'never below the high-water mark');
    }
    row('longest losing run', obs.run ? `${obs.run} ${obs.run === 1 ? 'loss' : 'losses'}  (#${obs.runFrom}${obs.run > 1 ? ` – #${obs.runTo}` : ''})` : 'none', 'MEASURED', 'losses in a row; a push neither counts nor ends the run');
    const sims = isNum(opts.sims) ? opts.sims : 20000;
    if (sims > 0 && obs.n) {
      const sim = resample(obs.opens, obs, { sims, seed: isNum(opts.seed) ? opts.seed : 20260917, window: obs.slideN });
      p(`  ${n0(sim.sims)} ledgers of ${plural(sim.n, 'round')}, your opening bets in your order, returns drawn from the`);
      p(`  histogram (${HIST_SOURCE}; drawn mean ${fix(sim.meanRet, 4)} u, sd ${fix(sim.sdRet, 3)} u), seed ${sim.seed}.`);
      p('  Perfect play is assumed on every simulated round; your own play is priced in 2, not here.');
      row('final P&L', `median ${signedMoney(sim.final.median)} · 5th ${signedMoney(sim.final.p5)} · 95th ${signedMoney(sim.final.p95)}`, 'ESTIMATED', `P(final ≤ yours) = ${pct(sim.final.pAtMostObs, 1)}`);
      row('max drawdown', `median ${money(sim.dd.median)} · mean ${money(sim.dd.mean)} · 75th ${money(sim.dd.p75)} · 90th ${money(sim.dd.p90)}`, 'ESTIMATED', `P(≥ yours ${money(obs.maxDD)}) = ${pct(sim.dd.pAtLeastObs, 1)}`);
      if (sim.win.N) {
        row(`worst ${sim.win.N}-round window`, `median ${signedMoney(sim.win.median)} · 10th ${signedMoney(sim.win.p10)} · 5th ${signedMoney(sim.win.p5)}`, 'ESTIMATED', `P(≤ your slide ${signedMoney(-obs.maxDD)}) = ${pct(sim.win.pAtMostObs, 1)}`);
      }
      row('longest losing run', `median ${sim.run.median} · 90th ${sim.run.p90}`, 'ESTIMATED', `P(≥ yours ${obs.run}) = ${pct(sim.run.pAtLeastObs, 1)}`);
    }
  }
  p();
  return lines.join('\n');
};

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------
const parseArgs = (argv) => {
  const o = { scope: ['whole', 'days', 'mark'] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corp') o.corp = argv[++i];
    else if (a === '--scope') o.scope = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--sims') o.sims = Number(argv[++i]);
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--top') o.top = Number(argv[++i]);
    else if (!a.startsWith('--')) o.file = a;
  }
  return o;
};

function main() {
  const o = parseArgs(process.argv.slice(2));
  const file = o.file || listCollections(path.join(__dirname, '..', 'artifacts'))[0];
  if (!file) { console.error('no input: pass a store collection or a jack-watch save bundle, or put politiko-stores-*.json in artifacts/'); process.exit(2); }
  const L = loadFile(file, { corp: o.corp });
  process.stdout.write(`${report(L, o)}\n`);
}

module.exports = {
  HIST, FIXED_SD, histStats, mulberry32, chiP, liftEngine, detect, loadFile, listCollections,
  slicesOf, dayOf, moneyOf, decisionsOf, receiptsOf, fairnessOf, observedOf, resample, report, total, pip,
};
if (require.main === module) main();
