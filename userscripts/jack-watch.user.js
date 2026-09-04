// ==UserScript==
// @name         Politiko — Jack Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  Solves the blackjack table the game never advertises a number for: the right action and what every other one costs, the chances behind it, a running count with the evidence for whether it means anything, and the money in and out. Reads only responses the game already fetched. Passive; zero added requests; presses nothing.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/jack-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/jack-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * `@grant none` is load-bearing, not a leftover default. Under any other grant both
 * Tampermonkey and Violentmonkey hand the script a sandboxed `window`, so the fetch wrap
 * below patches the sandbox's fetch and the page's real traffic never passes through it —
 * the tap silently sees nothing and the panel just sits there saying "no table yet".
 *
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON RESPONSE bodies of calls the game client itself made, on pages you are
 *             actively viewing. Never a request body, never a header, never a token.
 *
 *               GET  /api/corporations/{id}/casino/blackjack
 *                        the table config — bet limits, increment, your cash, the free
 *                        reserve, dealer availability — and the hand in progress
 *               GET  /api/corporations/{id}/casino/blackjack/history
 *                        { hands: [...] } — the whole array. The game renders hands[0]
 *                        and drops the rest; this keeps them
 *               …and the hand the game receives back when you press DEAL, HIT, STAND,
 *                        DOUBLE or SPLIT.
 *
 *             That last one is a RESPONSE to a request YOU initiated by clicking, and it
 *             is recognised BY SHAPE rather than by path: any payload carrying a hand id,
 *             a dealer's cards and a list of your hands is a hand. This file therefore
 *             contains neither of the endpoints that would deal a hand or send an action,
 *             reads neither the verb nor the request body off a tap record, and literally
 *             cannot tell a GET from a POST. See docs/19-casino-blackjack-surface.md.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. There is one `fetch` wrapper and
 *             it calls the original exactly once, to pass your own traffic through.
 *             Nothing here is polled, scheduled, retried, or fired while you are
 *             elsewhere: everything it knows arrived because the game asked for it while
 *             you were looking at the page. There is exactly one timer in the file and it
 *             changes a button's label back from "copied" — it touches nothing else, and
 *             tools/test-jack-passive.js fails the build if a second one appears or if
 *             that one ever learns to reach the network.
 *
 *   Writes:   nothing to the game, and this is the tool in this repo where that sentence
 *             has to be load-bearing rather than decorative. Slots ships its own auto-spin
 *             loop, so there was never an argument for scripting one; blackjack ships no
 *             automation at all, which makes a solver that knows the right action exactly
 *             one line away from a bot that presses it. That line is the whole difference
 *             between a reader and a bot, it is drawn here, and tools/test-jack-passive.js
 *             fails the build if the endpoints, the payload keys or an idempotency key
 *             ever appear in this file. See CLAUDE.md hard rule 2.
 *
 *   Storage:  localStorage keys prefixed `pkbj:` — the hand ledger, the table config it
 *             was read against, the decisions it inferred and what they cost, your opening
 *             stake, the planner inputs, the solved house edge (cached because it takes
 *             a second or two to compute and never changes), the mark that scopes the
 *             panel to one sitting, and panel state.
 *
 *   Alerts:   none. No notifications, no sound, no title or favicon writes, nothing raised
 *             from an unfocused tab. The panel is in-page and that is all.
 *
 *   Clipboard: written ONLY when you click "copy".
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 * Every field name and every rule below was measured off
 * artifacts/bundles/2026-09-03/CasinoBlackjackPage-BSYFJcI7.js —
 * docs/19-casino-blackjack-surface.md has it line by line.
 *
 * WHAT THIS CAN AND CANNOT TELL YOU
 *
 * Blackjack is the mirror image of the slot machine next door. Slots states its RTP and
 * hides the reel strips, so the headline number is exact and unverifiable. Blackjack
 * states no number at all — there is no RTP and no edge field anywhere on this surface —
 * but it prints the complete rule set on the page: six decks, blackjack 3:2, dealer stands
 * on soft 17, one split, double after split, split aces get one card, dealer peeks, no
 * insurance, no surrender. A stated rule set makes blackjack a solved game.
 *
 * COMPUTED, from those rules and nothing else. The dealer's final-total distribution, the
 * EV of every action available to you, therefore the correct action and the exact cost of
 * any other, and therefore the house edge under perfect play — which this tool works out
 * for itself rather than quoting: 0.4593% of every dollar staked, on a fresh shoe. Two
 * approximations are made and both are named on screen where their numbers are: the
 * dealer's distribution is computed once at your decision and held fixed while your own
 * draws are enumerated, and a split is priced as twice one hand.
 *
 * MEASURED, from your hands only, and always beside a sample count. Realized edge, TAX
 * DRAG, and what your own decisions cost. The drag is the one the page never shows: the
 * edge is charged on the round, but you are paid net, and "ordinary-income tax on positive
 * round profit" lands on winning rounds and gives nothing back on losing ones. So what the
 * table actually costs you is the computed edge PLUS the drag, and the drag is a straight
 * division of two observed sums with no distribution assumed for it.
 *
 * ESTIMATED, and labelled as such wherever it is printed: the ±1 SD band on a planned run.
 * It is the sample deviation of YOUR own per-round results, the sample count is on screen
 * beside it, and it is drawn as a band and never as a probability of anything.
 *
 * COUNTED, with the evidence for whether the count means anything printed next to it. Six
 * decks and a card-by-card record is the setup for a running count, and the count is easy.
 * Whether it MEANS anything turns on whether the shoe persists between hands, and nothing
 * on this surface says: there is no shoe, penetration or discard field anywhere, and the
 * six decks are a text label. That is measurable one-sidedly and this tool measures it —
 * cards carry suits, so a six-deck shoe holds exactly six of each of 52 codes, and the
 * seventh sighting of any one code PROVES a reshuffle. It can never prove the opposite.
 * Three more limits ride with it and the COUNT tab prints all three: you only ever see
 * your own table, the hole card is hidden while you act, and a count is a proxy — this
 * tool re-solves against the observed composition directly rather than converting a count
 * into an index, so nothing here is derived from the count at all.
 *
 * NOT AVAILABLE AT ALL: when anything happened. Nothing on this surface carries a
 * timestamp — not the hand, not history, nowhere the client reads. Every clock in this
 * panel is the local time this tool FIRST SAW the hand, and is labelled "seen". Order is
 * by hand id, which is the only ordering the wire gives.
 *
 * ONE SITTING, OR ALL OF THEM
 *
 * Every measured figure is a sum over the ledger, and a night at the table is invisible
 * inside a month of them. So LOG carries a "clear", and it starts the panel's figures at
 * your next hand. It sets a floor at the newest hand held; it does not delete, and could
 * not — the history poll re-sends the whole array every fifteen seconds, so a clear that
 * removed rows would be silently undone by the next poll while you watched. Whichever is
 * in force is named in the title bar, because a panel quietly showing a subset of your own
 * money is worse than one showing all of it.
 */

(() => {
  'use strict';

  const TAG = '[pk-jack-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { data: 'pkbj:data', ui: 'pkbj:ui' };

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // ===========================================================================
  // 1. THE ENGINE — every number this panel prints, and nothing that draws one.
  //
  //    tools/test-jack-ev.js slices this section out between the two markers
  //    below and drives it against the canonical basic-strategy table, the
  //    published edge for this rule set, and a Monte Carlo, so it must stay free
  //    of the DOM, of storage, and of anything it cannot be handed as an argument.
  //
  //    The rule the whole section is built around: a computation, a measurement
  //    and an estimate are three different things and are never mixed into one
  //    number. Anything derived from the stated rules is exact. Anything derived
  //    from what was observed carries its sample size. Anything shaped like a
  //    forecast says so.
  // ===========================================================================
  // >>> ENGINE START
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // The rule set, exactly as the House rules aside and the felt state it. Every
  // number below comes out of these eight lines and nothing else, which is the
  // whole reason this surface can be solved rather than only observed.
  const RULES = Object.freeze({
    decks: 6,              // "Six-Deck Table", the header subtitle
    naturalPays: 1.5,      // "Blackjack pays 3:2", also painted on the felt
    standsSoft17: true,    // "Dealer stands on soft 17"
    splits: 1,             // "One split"
    doubleAfterSplit: true,
    splitAcesOneCard: true,
    peek: true,            // "Dealer peeks on ace or ten"
    surrender: false,      // "No insurance or surrender"
    insurance: false,
  });

  // Ten rank classes, because ten J Q and K are one card as far as any of the
  // arithmetic is concerned. The ace is index 0 and is worth 1 here; the extra 10
  // it can be worth is added back by best().
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];
  const VAL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // A card string for a rank class, for the places that hand a rank back to something
  // that parses cards. RANKS is a LABEL — the 'T' in it is this repo's shorthand and
  // the client never writes one: a ten on the wire is '10', 'J', 'Q' or 'K'. Handing
  // 'TS' to rankOf() gets null back, correctly, and a grid built out of those is a grid
  // of blanks. It was, once.
  const CARD = ['AS', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', '10S'];
  const HIDDEN = 'hidden';
  const SUITS = 'SHDC';
  const FACES = ['10', 'J', 'Q', 'K'];

  // 'AS' -> 0, '10H' -> 9, 'KD' -> 9, 'hidden' -> null. Measured: the client
  // preloads a texture for all 52 rank+suit strings and totals a hand by slicing
  // the suit off the end.
  const rankOf = (card) => {
    if (typeof card !== 'string' || card === HIDDEN || card.length < 2) return null;
    const r = card.slice(0, -1).toUpperCase();
    if (r === 'A') return 0;
    if (FACES.includes(r)) return 9;
    const n = Number(r);
    return Number.isInteger(n) && n >= 2 && n <= 9 ? n - 1 : null;
  };

  // The exact card, for the sighting ledger — 'AS' and 'AH' are two of the 52
  // codes a six-deck shoe holds six of each of, and telling them apart is the
  // whole of how a reshuffle gets proved.
  const codeOf = (card) => {
    if (typeof card !== 'string' || card === HIDDEN || card.length < 2) return null;
    const c = card.toUpperCase();
    const suit = c.slice(-1);
    const r = c.slice(0, -1);
    if (!SUITS.includes(suit)) return null;
    if (r !== 'A' && !FACES.includes(r) && !(Number(r) >= 2 && Number(r) <= 9)) return null;
    return c;
  };

  const CODES = (() => {
    const out = [];
    for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', ...FACES]) {
      for (const s of SUITS) out.push(r + s);
    }
    return out;                                    // 52 of them
  })();
  const PER_CODE = RULES.decks;                    // six of each, and never a seventh
  const SHOE_SIZE = CODES.length * PER_CODE;       // 312

  const freshShoe = () => {
    const c = new Array(10).fill(4 * RULES.decks);
    c[9] = 16 * RULES.decks;                       // ten, jack, queen, king
    return c;
  };
  const shoeLeft = (c) => c.reduce((a, b) => a + b, 0);

  // Cards out of a composition, clamped at zero. A card we cannot remove means the
  // composition we are holding is not the shoe the server is dealing from, so the
  // caller is told rather than quietly given a wrong answer.
  const without = (comp, cards) => {
    const c = comp.slice();
    let impossible = 0;
    for (const card of cards || []) {
      const r = rankOf(card);
      if (r === null) continue;
      if (c[r] > 0) c[r]--; else impossible++;
    }
    return { comp: c, impossible };
  };

  // Aces are 1 unless one of them can be 11 without busting.
  const best = (t, a) => (a > 0 && t + 10 <= 21 ? t + 10 : t);
  const isSoft = (t, a) => a > 0 && t + 10 <= 21;

  // What a list of card strings adds up to. `unknown` counts face-down cards, which
  // is how the dealer's hand reads while you are still acting.
  const handOf = (cards) => {
    let t = 0, a = 0, n = 0, unknown = 0;
    for (const card of cards || []) {
      const r = rankOf(card);
      if (r === null) { unknown++; continue; }
      t += VAL[r]; if (r === 0) a++; n++;
    }
    const b = best(t, a);
    return {
      t, a, n, unknown, best: b, soft: isSoft(t, a), bust: t > 21,
      // A natural is two cards, an ace and a ten, and nothing else. It is not the
      // same thing as a 21 built out of three cards, and it is not the same thing
      // as a ten landing on a split ace — see splitEV.
      natural: n === 2 && unknown === 0 && b === 21,
    };
  };

  // --- the dealer -----------------------------------------------------------
  //
  // The distribution over the dealer's final total, exactly, by enumerating every
  // draw sequence with the cards removed as they come out. Six buckets: 17, 18, 19,
  // 20, 21, bust. S17, so every 17 stands, soft ones included.
  //
  // The peek is what makes this conditional. On an ace or a ten the dealer has
  // already looked; if it were a natural the round would be over and you would not
  // be reading this. So that branch is removed and the rest renormalised, and `bj`
  // comes back separately for the callers that price the deal itself.
  // The S17 line, and the only place in the file it lives. Under H17 the same
  // function with one flag flipped would draw on a soft seventeen — worth having as
  // a line rather than as a >= so that if this table's rules ever change the change
  // is one word.
  const dealerStands = (t, a) => {
    const b = best(t, a);
    if (b > 17) return true;
    if (b < 17) return false;
    return RULES.standsSoft17 || !isSoft(t, a);
  };

  const dealerDist = (up, comp) => {
    const out = [0, 0, 0, 0, 0, 0];
    const c = comp.slice();
    const rec = (t, a, p) => {
      if (p < 1e-12) return;                       // a branch worth less than a cent of a cent
      if (t > 21) { out[5] += p; return; }
      const b = best(t, a);
      if (dealerStands(t, a)) { out[b - 17] += p; return; }
      const n = shoeLeft(c);
      if (!n) { out[5] += p; return; }             // an exhausted shoe is not a real branch
      for (let r = 0; r < 10; r++) {
        if (!c[r]) continue;
        const q = c[r] / n;
        c[r]--;
        rec(t + VAL[r], a + (r === 0 ? 1 : 0), p * q);
        c[r]++;
      }
    };
    const bans = RULES.peek && up === 0 ? 9 : (RULES.peek && up === 9 ? 0 : -1);
    const n = shoeLeft(c);
    if (!n) return { p: out, bj: 0, usable: false };
    const bj = bans < 0 ? 0 : c[bans] / n;
    let mass = 0;
    for (let r = 0; r < 10; r++) if (r !== bans && c[r]) mass += c[r] / n;
    if (mass <= 0) return { p: out, bj, usable: false };
    for (let r = 0; r < 10; r++) {
      if (r === bans || !c[r]) continue;
      const q = (c[r] / n) / mass;
      c[r]--;
      rec(VAL[up] + VAL[r], (up === 0 ? 1 : 0) + (r === 0 ? 1 : 0), q);
      c[r]++;
    }
    return { p: out, bj, usable: true };
  };

  // What standing pays, in units of the wager, against a dealer who has already
  // peeked. Busting is -1 before the dealer draws at all.
  const standEV = (b, dd) => {
    if (b > 21) return -1;
    let ev = dd.p[5];
    for (let k = 0; k < 5; k++) {
      const d = 17 + k;
      if (b > d) ev += dd.p[k];
      else if (b < d) ev -= dd.p[k];
    }
    return ev;
  };

  // …and the three ways it can go, which is the same arithmetic split three ways
  // rather than netted. The panel prints these as chances because they ARE chances:
  // exact ones, off the stated rules, with nothing sampled.
  const standOdds = (b, dd) => {
    if (b > 21) return { win: 0, push: 0, lose: 1 };
    let win = dd.p[5], push = 0, lose = 0;
    for (let k = 0; k < 5; k++) {
      const d = 17 + k;
      if (b > d) win += dd.p[k];
      else if (b === d) push += dd.p[k];
      else lose += dd.p[k];
    }
    return { win, push, lose };
  };

  // Hitting: take one, then take the better of standing and hitting again. Doubling
  // is not offered after a hit, which is why it is not in the max().
  //
  // The dealer distribution is passed in and held fixed while these draws are
  // enumerated. Recomputing it after each of your own cards would be exact; this is
  // the first of the two approximations the panel names on screen.
  const hitEV = (t, a, comp, dd) => {
    const n = shoeLeft(comp);
    if (!n) return standEV(best(t, a), dd);
    let ev = 0;
    for (let r = 0; r < 10; r++) {
      if (!comp[r]) continue;
      const q = comp[r] / n;
      const nt = t + VAL[r], na = a + (r === 0 ? 1 : 0);
      if (nt > 21) { ev -= q; continue; }
      const nb = best(nt, na);
      comp[r]--;
      const s = standEV(nb, dd);
      const h = nb >= 21 ? s : hitEV(nt, na, comp, dd);
      comp[r]++;
      ev += q * (h > s ? h : s);
    }
    return ev;
  };

  // The chance the very next card busts you. One line, exact, and the number people
  // actually want when they are looking at a sixteen.
  const bustNext = (t, comp) => {
    const n = shoeLeft(comp);
    if (!n) return null;
    let p = 0;
    for (let r = 0; r < 10; r++) if (t + VAL[r] > 21) p += comp[r] / n;
    return p;
  };

  // Doubling: exactly one card, forced stand, twice the stake.
  const doubleEV = (t, a, comp, dd) => {
    const n = shoeLeft(comp);
    if (!n) return 2 * standEV(best(t, a), dd);
    let ev = 0;
    for (let r = 0; r < 10; r++) {
      if (!comp[r]) continue;
      const q = comp[r] / n;
      const nt = t + VAL[r], na = a + (r === 0 ? 1 : 0);
      ev += q * (nt > 21 ? -1 : standEV(best(nt, na), dd));
    }
    return 2 * ev;
  };

  // Splitting, in units of the ORIGINAL wager, so it is directly comparable with the
  // three above. One split, so neither half may split again; double after split is
  // allowed; a split ace takes exactly one card and stands.
  //
  // This is the second named approximation: both halves are priced against the same
  // composition and the result doubled, where the real pair is dealt from a shoe each
  // half is depleting.
  //
  // A ten on a split ace is 21 and not a natural. Nothing in the client says either
  // way — it is one of the three things docs/19 lists as unstated — and every table
  // that has ever existed pays it even money, so that is what is assumed here and
  // what the panel says next to the number.
  const splitEV = (r, comp, dd) => {
    const c = comp.slice();
    const n = shoeLeft(c);
    if (!n) return 0;
    let per = 0;
    for (let d = 0; d < 10; d++) {
      if (!c[d]) continue;
      const q = c[d] / n;
      const t = VAL[r] + VAL[d], a = (r === 0 ? 1 : 0) + (d === 0 ? 1 : 0);
      c[d]--;
      if (r === 0 && RULES.splitAcesOneCard) {
        per += q * standEV(best(t, a), dd);
      } else {
        const s = standEV(best(t, a), dd);
        const h = hitEV(t, a, c, dd);
        const dbl = RULES.doubleAfterSplit ? doubleEV(t, a, c, dd) : -Infinity;
        per += q * Math.max(s, h, dbl);
      }
      c[d]++;
    }
    return 2 * per;
  };

  // One decision, priced. `comp` must already have your cards and the dealer's up
  // card out of it; `allowed` is the server's own allowed_actions, so this can never
  // recommend something the table would refuse.
  const ACTIONS = ['hit', 'stand', 'double', 'split'];
  const solve = (cards, up, comp, allowed) => {
    if (up === null || up === undefined) return null;
    const h = handOf(cards);
    if (h.unknown || !h.n) return null;
    const dd = dealerDist(up, comp);
    if (!dd.usable) return null;
    const can = Array.isArray(allowed) && allowed.length
      ? ACTIONS.filter((a) => allowed.includes(a))
      : ACTIONS.filter((a) => a !== 'split' || (h.n === 2 && rankOf(cards[0]) === rankOf(cards[1])));
    const ev = {};
    for (const a of can) {
      if (a === 'stand') ev.stand = standEV(h.best, dd);
      else if (a === 'hit') ev.hit = h.bust ? -1 : hitEV(h.t, h.a, comp.slice(), dd);
      else if (a === 'double') ev.double = doubleEV(h.t, h.a, comp.slice(), dd);
      else if (a === 'split' && h.n === 2 && rankOf(cards[0]) === rankOf(cards[1])) {
        ev.split = splitEV(rankOf(cards[0]), comp.slice(), dd);
      }
    }
    let pick = null;
    for (const a in ev) if (pick === null || ev[a] > ev[pick]) pick = a;
    return {
      hand: h, dd, ev, pick,
      bustNext: h.bust ? null : bustNext(h.t, comp),
      odds: standOdds(h.best, dd),
      dealerBust: dd.p[5],
    };
  };

  // --- the whole table ------------------------------------------------------
  //
  // The house edge under perfect play, by summing over every initial deal: your two
  // cards, the dealer's up card, the peek, and then the best of whatever you are
  // allowed to do. Nothing is sampled and nothing is quoted — this is the number the
  // page does not carry, worked out from the rules it does.
  //
  // A second or two, so it is computed once behind a deliberate button and then kept.
  const roundEV = (shoe) => {
    const N0 = shoeLeft(shoe);
    if (N0 < 10) return null;
    let ev = 0, deals = 0;
    for (let i = 0; i < 10; i++) {
      if (!shoe[i]) continue;
      for (let j = i; j < 10; j++) {
        if (!shoe[j]) continue;
        const c1 = shoe.slice();
        let pHand;
        if (i === j) { pHand = (c1[i] / N0) * ((c1[i] - 1) / (N0 - 1)); c1[i] -= 2; }
        else { pHand = 2 * (c1[i] / N0) * (c1[j] / (N0 - 1)); c1[i]--; c1[j]--; }
        if (!(pHand > 0)) continue;
        const N1 = shoeLeft(c1);
        const natural = (i === 0 && j === 9) || (i === 9 && j === 0);
        for (let up = 0; up < 10; up++) {
          if (!c1[up]) continue;
          const pUp = c1[up] / N1;
          const c2 = c1.slice(); c2[up]--;
          const dd = dealerDist(up, c2);
          if (!dd.usable) continue;
          deals++;
          let e;
          if (natural) {
            // A push against the dealer's own natural, 3:2 otherwise.
            e = (1 - dd.bj) * RULES.naturalPays;
          } else {
            const t = VAL[i] + VAL[j], a = (i === 0 ? 1 : 0) + (j === 0 ? 1 : 0);
            let bestEV = Math.max(
              standEV(best(t, a), dd),
              hitEV(t, a, c2.slice(), dd),
              doubleEV(t, a, c2.slice(), dd),
            );
            if (i === j) bestEV = Math.max(bestEV, splitEV(i, c2.slice(), dd));
            e = dd.bj * -1 + (1 - dd.bj) * bestEV;
          }
          ev += pHand * pUp * e;
        }
      }
    }
    return { ev, edge: -ev, deals };
  };

  // The strategy grid, for whichever composition is in force. Derived, never a table
  // typed in from somewhere: on a fresh shoe it IS basic strategy, and against a shoe
  // that has been counted down it is basic strategy with the deviations already in it,
  // which is the same reason nothing here converts a count into an index.
  const GRID_HARD = [[1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8],
    [1, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9]];
  const gridOf = (shoe) => {
    const cell = (ranks, canSplit) => {
      const cards = ranks.map((r) => CARD[r]);
      const row = [];
      for (let up = 0; up < 10; up++) {
        const c = shoe.slice();
        let ok = true;
        for (const r of [...ranks, up]) { if (c[r] > 0) c[r]--; else ok = false; }
        if (!ok) { row.push(null); continue; }
        const s = solve(cards, up, c, canSplit ? ACTIONS : ['hit', 'stand', 'double']);
        row.push(s ? s.pick : null);
      }
      return row;
    };
    return {
      hard: GRID_HARD.map((r) => ({ label: String(VAL[r[0]] + VAL[r[1]]), row: cell(r, false) })),
      soft: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => ({ label: 'A' + RANKS[x], row: cell([0, x], false) })),
      pair: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => ({ label: RANKS[r] + RANKS[r], row: cell([r, r], true) })),
    };
  };

  // --- counting -------------------------------------------------------------
  //
  // Hi-Lo, because it is the one everybody means by "the count". Nothing in this file
  // is DERIVED from it — the solver runs against the composition itself, which is
  // strictly better and needs no index table. It is printed because it is the handle
  // people already have.
  const HILO = [-1, 1, 1, 1, 1, 1, 0, 0, 0, -1];
  const countOf = (seenByRank, cardsSeen) => {
    let running = 0;
    for (let r = 0; r < 10; r++) running += HILO[r] * (seenByRank[r] || 0);
    const left = SHOE_SIZE - cardsSeen;
    const decks = left / 52;
    return {
      running,
      cardsSeen,
      left,
      decks,
      // A true count wants at least half a deck under it; below that the division is
      // an amplifier rather than a normalisation and the number stops meaning anything.
      true: decks >= 0.5 ? running / decks : null,
    };
  };

  // --- the shoe, as far as it can be established ----------------------------
  //
  // Walk the hands oldest first and count every card by its exact code. Six decks hold
  // six of each of the 52, so a SEVENTH sighting is proof that the shoe was reshuffled
  // somewhere at or before that hand — the counting starts again from there. This is a
  // one-sided test on purpose: it can prove a reshuffle and it can never prove that one
  // did not happen, and the panel says so rather than implying otherwise.
  //
  // Derived from the stored hands every time rather than accumulated as hands arrive,
  // which is what makes it immune to the history poll re-sending the same hand forever.
  const shoeState = (handsAsc) => {
    let byCode = Object.create(null), byRank = new Array(10).fill(0), cards = 0;
    let hidden = 0, segments = 1;
    const breaks = [];
    let peak = 0, peakCode = null;
    const reset = () => { byCode = Object.create(null); byRank = new Array(10).fill(0); cards = 0; peak = 0; peakCode = null; };
    for (const h of handsAsc) {
      const list = [];
      for (const c of h.dealer || []) list.push(c);
      for (const p of h.hands || []) for (const c of p.cards || []) list.push(c);
      // A hand is taken whole or not at all: half of one counted into the old shoe and
      // half into the new would corrupt both.
      let overflows = false;
      const tally = Object.create(null);
      for (const card of list) {
        const code = codeOf(card);
        if (code === null) continue;
        tally[code] = (tally[code] || 0) + 1;
        if ((byCode[code] || 0) + tally[code] > PER_CODE) overflows = true;
      }
      if (overflows) { breaks.push(h.id); segments++; reset(); }
      for (const card of list) {
        const code = codeOf(card);
        if (code === null) { if (card === HIDDEN) hidden++; continue; }
        byCode[code] = (byCode[code] || 0) + 1;
        if (byCode[code] > peak) { peak = byCode[code]; peakCode = code; }
        const r = rankOf(card);
        if (r !== null) byRank[r]++;
        cards++;
      }
    }
    // What is left, clamped at zero: a negative count would mean the shoe model is
    // wrong, and the honest floor for "how many nines can still come out" is none.
    const comp = freshShoe();
    for (let r = 0; r < 10; r++) comp[r] = Math.max(0, comp[r] - byRank[r]);
    return {
      comp, byRank, cards, hidden, segments, breaks,
      peak, peakCode,
      proven: breaks.length > 0,
      lastBreak: breaks.length ? breaks[breaks.length - 1] : null,
      count: countOf(byRank, cards),
    };
  };

  // --- the receipts ---------------------------------------------------------
  //
  // Shape gates, and the whole of how this tool recognises what the tap hands it.
  // Matching on shape rather than on a path is what lets it consume the hand you get
  // back for pressing DEAL without this file containing the endpoint that would.
  const isHand = (o) => !!o && typeof o === 'object' && !Array.isArray(o)
    && num(o.id) !== null && Array.isArray(o.player_hands) && Array.isArray(o.dealer_cards);
  const SETTLED = ['total_wager', 'gross_payout', 'tax_amount', 'net_payout'];
  const isSettled = (o) => isHand(o) && SETTLED.every((k) => num(o[k]) !== null);

  // A round's P&L is what was CREDITED minus what was staked. gross_payout is not it —
  // the tax comes out in between, and that gap is one of the two things this panel
  // exists to show. net_payout is the server's own number and is used, not re-derived.
  const netOf = (h) => (num(h.net) === null || num(h.total) === null ? null : h.net - h.total);

  // Everything worth keeping off a hand, and nothing else. `wager` becomes `stake` on
  // the way in for a reason that is not cosmetic: `wager:` is a key in the request body
  // that deals a hand, and tools/test-jack-passive.js fails the build if this file
  // contains one.
  const slimHand = (h) => {
    const out = {
      id: h.id,
      status: typeof h.status === 'string' ? h.status : null,
      outcome: typeof h.outcome === 'string' ? h.outcome : null,
      cur: num(h.current_hand),
      allowed: Array.isArray(h.allowed_actions) ? h.allowed_actions.filter((a) => typeof a === 'string') : null,
      dealer: (h.dealer_cards || []).filter((c) => typeof c === 'string'),
      hands: (h.player_hands || []).map((p) => ({
        cards: (p.cards || []).filter((c) => typeof c === 'string'),
        stake: num(p.wager),
        outcome: typeof p.outcome === 'string' ? p.outcome : null,
        status: typeof p.status === 'string' ? p.status : null,
      })),
      open: num(h.opening_wager),
    };
    if (num(h.total_wager) !== null) out.total = h.total_wager;
    if (num(h.gross_payout) !== null) out.gross = h.gross_payout;
    if (num(h.tax_amount) !== null) out.tax = h.tax_amount;
    if (num(h.net_payout) !== null) out.net = h.net_payout;
    return out;
  };

  // The same hand arrives many times by three routes: once per action as the response
  // you get back, and again on every history poll for as long as it stays in the array.
  // A later sighting must never be allowed to delete what an earlier one knew — cards
  // only ever grow, and the settlement numbers only ever arrive.
  const mergeHand = (old, next) => {
    if (!old) return next;
    const out = { ...old, ...next };
    if ((old.dealer || []).length > (next.dealer || []).length) out.dealer = old.dealer;
    if ((old.hands || []).length > (next.hands || []).length) out.hands = old.hands;
    else {
      out.hands = (next.hands || []).map((p, i) => {
        const was = (old.hands || [])[i];
        if (was && (was.cards || []).length > (p.cards || []).length) return was;
        return p;
      });
    }
    for (const k of ['total', 'gross', 'tax', 'net', 'open']) {
      if (num(next[k]) === null && num(old[k]) !== null) out[k] = old[k];
    }
    if (!next.outcome && old.outcome) out.outcome = old.outcome;
    out.seen = old.seen;                           // first seen is first seen; it never moves
    return out;
  };

  // A sitting is a SLICE of the ledger, never a shorter ledger — same reasoning as
  // slot-watch, and the same reason it has to be a floor: the history poll re-sends the
  // whole array every fifteen seconds and ingest is shape-driven, so a clear that
  // removed rows would undo itself on the next poll in front of you, with no error.
  const above = (list, floor) => (num(floor) === null ? list : list.filter((h) => h.id > floor));

  const rollup = (list) => {
    let n = 0, rounds = 0, wagered = 0, gross = 0, tax = 0, credited = 0;
    let wins = 0, pushes = 0, losses = 0, taxed = 0, naturals = 0, opened = 0;
    for (const h of list) {
      const net = netOf(h);
      if (net === null) continue;
      n++; rounds++;
      wagered += h.total;
      gross += h.gross;
      tax += h.tax;
      credited += h.net;
      if (num(h.open) !== null) opened += h.open;
      if (net > 0) wins++; else if (net === 0) pushes++; else losses++;
      if (h.tax > 0) taxed++;
      if ((h.hands || []).some((p) => p.outcome === 'blackjack')) naturals++;
    }
    const net = credited - wagered;
    return {
      n, rounds, wagered, gross, tax, credited, net, wins, pushes, losses, taxed, naturals, opened,
      // Every rate below divides by what was actually staked, so every one is a
      // measurement of what happened and none of them is a projection.
      taxDrag: wagered ? tax / wagered : null,
      realizedEdge: wagered ? -net / wagered : null,
      winRate: n ? wins / n : null,
      // What a round actually stakes, per dollar of opening bet. Splits and doubles put
      // more than your opening wager at risk, so a planner that multiplies bet by rounds
      // is understating the exposure — by this much, measured rather than assumed.
      stakeMult: opened ? wagered / opened : null,
      // The client renders gross and tax as separate fields and never checks that they
      // reconcile with net. If they stop reconciling, every figure here is built on a
      // wrong assumption and the panel should say so rather than print.
      reconciles: gross - tax === credited,
    };
  };

  const mean = (xs) => (xs && xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const stdev = (xs) => {
    if (!xs || xs.length < 2) return null;         // one sample has no spread
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
  };

  // Per-unit result of a round, against the bet you chose rather than against what the
  // round went on to stake. That is the unit a planner works in.
  const roundReturns = (list) => {
    const out = [];
    for (const h of list) {
      const net = netOf(h);
      if (net === null || !(num(h.open) > 0)) continue;
      out.push(net / h.open);
    }
    return out;
  };

  // --- what you actually did ------------------------------------------------
  //
  // Two consecutive states of the same hand say what happened in between, and the wire
  // never says it outright. This is INFERENCE and is labelled as such everywhere it is
  // shown: if a transition is ambiguous, or a state was missed because the tool was not
  // running, nothing is recorded rather than something guessed.
  //
  // The order matters. A double adds a card AND doubles the stake, and a hit that busts
  // both adds a card and advances the hand, so the more specific test has to come first.
  const inferAct = (prev, next) => {
    if (!prev || !next || prev.status !== 'player_turn') return null;
    const i = num(prev.cur);
    if (i === null) return null;
    const a = (prev.hands || [])[i];
    const b = (next.hands || [])[i];
    if (!a || !b) return null;
    if ((next.hands || []).length > (prev.hands || []).length) return 'split';
    if (num(b.stake) !== null && num(a.stake) !== null && b.stake > a.stake) return 'double';
    if ((b.cards || []).length > (a.cards || []).length) return 'hit';
    if ((b.cards || []).length === (a.cards || []).length
      && (num(next.cur) > i || next.status === 'settled')) return 'stand';
    return null;
  };

  // The dealer's up card is the first one that is not face down.
  const upOf = (h) => {
    for (const c of h.dealer || []) { const r = rankOf(c); if (r !== null) return r; }
    return null;
  };

  // Price one inferred decision, against the TABLE composition — a fresh shoe with the
  // cards then face up taken out — and deliberately never against the counted one:
  // "did you play it right" is a question about that moment, and pricing it against a
  // shoe state that keeps moving would make yesterday's answer move with it.
  //
  // Worth knowing that this is a shade sharper than the printed strategy table, and will
  // sometimes disagree with it. A sixteen made of three small cards is sitting in a shoe
  // those three cards have just made ten-rich, and standing it can price higher than
  // hitting it — which is a real result and not a bug, and is why the panel says you
  // played the MAX rather than that you played it by the book.
  const priceDecision = (prev, act) => {
    const i = num(prev.cur);
    const hand = (prev.hands || [])[i];
    const up = upOf(prev);
    if (!hand || up === null) return null;
    const seen = [...(prev.dealer || []), ...(prev.hands || []).flatMap((p) => p.cards || [])];
    const { comp } = without(freshShoe(), seen);
    const s = solve(hand.cards, up, comp, prev.allowed);
    if (!s || !s.pick) return null;
    const got = num(s.ev[act]);
    if (got === null) return null;
    return {
      id: prev.id, i, act, want: s.pick,
      ev: got, bestEV: s.ev[s.pick],
      // Cost is per dollar of THIS hand's stake, so a mistake on a doubled hand counts
      // for what it actually cost rather than for one unit.
      cost: (s.ev[s.pick] - got) * (num(hand.stake) ?? 0),
      stake: num(hand.stake),
    };
  };

  const decisionRoll = (list) => {
    let n = 0, matched = 0, cost = 0;
    for (const d of list) { n++; if (d.act === d.want) matched++; cost += num(d.cost) ?? 0; }
    return { n, matched, cost, rate: n ? matched / n : null };
  };

  // --- the planner ----------------------------------------------------------
  //
  // `edge` is this tool's own solved number, so expLoss is exact GIVEN perfect play and
  // says so. `drag` is measured from your rounds. `sd` is a sample deviation and is only
  // ever a band. `mult` is the measured staking multiplier, and defaults to 1 — which
  // understates exposure — rather than to a guess.
  const plan = ({ bet, rounds, edge, drag, bankroll, sd, sdN, mult }) => {
    const w = num(bet), n = num(rounds);
    if (w === null || n === null || w <= 0 || n <= 0) return null;
    const m = num(mult) && mult > 0 ? mult : 1;
    const staked = w * n * m;
    const e = num(edge);
    const d = num(drag) ?? 0;
    const eff = e === null ? null : e + d;
    const bank = num(bankroll);
    const s = num(sd);
    return {
      staked, mult: m,
      expLoss: e === null ? null : staked * e,
      effEdge: eff,
      expLossEff: eff === null ? null : staked * eff,
      expAfter: (bank === null || eff === null) ? null : bank - staked * eff,
      // exact, and the only bankroll claim here that assumes nothing whatsoever
      cover: bank === null ? null : Math.floor(bank / w),
      coversRun: bank === null ? null : Math.floor(bank / w) >= n,
      // estimated: 1 SD of the sum of n independent per-round results, in cash
      band: s === null ? null : w * Math.sqrt(n) * s,
      bandN: num(sdN) ?? 0,
    };
  };

  // The largest bet the table will take right now, and the only one of the four bounds
  // that the page never states as a number. Measured off renderBetting: the deal is
  // blocked when wager * 4 exceeds the free reserve, four because a round can stake
  // twice over a split and twice again on a double after it.
  const COVER_MULT = 4;
  const betBounds = (cfg) => {
    const step = num(cfg.step) && cfg.step > 0 ? cfg.step : 1;
    const floorTo = (v) => Math.floor(v / step) * step;
    const cap = [];
    if (num(cfg.max) !== null) cap.push({ v: floorTo(cfg.max), why: 'table max' });
    if (num(cfg.cash) !== null) cap.push({ v: floorTo(cfg.cash), why: 'your cash' });
    if (num(cfg.reserve) !== null) cap.push({ v: floorTo(cfg.reserve / COVER_MULT), why: 'house reserve' });
    if (!cap.length) return null;
    let low = cap[0];
    for (const c of cap) if (c.v < low.v) low = c;
    return { max: low.v, why: low.why, min: num(cfg.min), step, all: cap };
  };

  // The bankroll curve: what happened, against what the solved edge says should have.
  // The gap between the two lines is the whole of the luck.
  const curveOf = (asc, start, eff) => {
    const s0 = num(start);
    if (s0 === null) return null;
    const pts = [{ i: 0, actual: s0, expected: s0, label: 'start' }];
    let bal = s0, staked = 0;
    asc.forEach((h, k) => {
      const net = netOf(h);
      if (net === null) return;
      bal += net;
      staked += h.total;
      pts.push({
        i: k + 1,
        actual: bal,
        expected: eff === null ? null : s0 - staked * eff,
        label: '#' + h.id,
      });
    });
    return pts.length > 1 ? pts : null;
  };

  // The drawing surface for a curve: the y range both series share, padded so a flat
  // line is not drawn on the frame.
  const extent = (pts) => {
    const vals = [];
    for (const p of pts) {
      if (num(p.actual) !== null) vals.push(p.actual);
      if (num(p.expected) !== null) vals.push(p.expected);
    }
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) { const pad = Math.max(1, Math.abs(hi) * 0.02); lo -= pad; hi += pad; }
    else { const pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
    return { lo, hi };
  };
  // <<< ENGINE END

  // ===========================================================================
  // 2. HTTP TAP v1 — shared verbatim block, see userscripts/_template.user.js.
  //    This ADDS NO REQUESTS. It only reads what the app already had in flight.
  // ===========================================================================
  const HTTP_TAP_VERSION = 1;

  const onApi = (() => {
    const KEY = '__pkHttpTap';
    const found = window[KEY];
    if (found && typeof found.subscribe === 'function') return found.subscribe;

    // An array, not a Set, for a reason that is about this repo rather than about
    // data structures: the passive fences are deliberately blunt text searches, and
    // several of them ban `.delete(` outright as an HTTP verb. A Set's own remove
    // method reads exactly like one. This block lands in every tool, so it must not
    // spend any tool's fence budget on a false positive.
    const subs = [];

    const tapPathOf = (u) => { try { return new URL(String(u), location.href).pathname; } catch { return ''; } };

    // Which subscribers want this path. An empty result means the body is never
    // read at all — no clone, no parse.
    const wanting = (p) => {
      const out = [];
      for (const s of subs) {
        if (s.prefixes === null || s.prefixes.some((x) => p.startsWith(x))) out.push(s);
      }
      return out;
    };

    // Freeze in place rather than copying: one traversal beats nine parses, and
    // the isFrozen check both stops the recursion and makes a second call cheap.
    const freeze = (v) => {
      if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
      Object.freeze(v);
      for (const k of Object.keys(v)) freeze(v[k]);
      return v;
    };

    const deliver = (want, rec) => {
      const frozen = Object.freeze(rec);
      for (const s of want) { try { s.fn(frozen); } catch (e) { log('subscriber error', e); } }
    };

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const target = args[0];
      const init = args[1];
      const url = typeof target === 'string' ? target : (target?.url ?? '');
      // String bodies only. A Request is never read — draining it would break the
      // app's own send, and it is not ours to consume.
      const body = typeof init?.body === 'string' ? init.body : null;
      const method = String(
        init?.method ?? (target && typeof target === 'object' ? target.method : null) ?? 'GET',
      ).toUpperCase();

      const res = await origFetch.apply(this, args);
      try {
        const path = tapPathOf(url);
        if (path.startsWith('/api/')) {
          const want = wanting(path);
          if (want.length) {
            const rec = { url, path, method, status: res.status, ok: res.ok, body };
            if ((res.headers.get('content-type') || '').includes('json')) {
              // clone so the app's own consumer still gets an unread body
              res.clone().json().then(
                (data) => deliver(want, { ...rec, data: freeze(data) }),
                () => deliver(want, { ...rec, data: null }),
              );
            } else {
              // Not JSON: still a fact worth reporting — a tool that watches for a
              // failed action needs the status even when there is no body to read.
              deliver(want, { ...rec, data: null });
            }
          }
        }
      } catch (e) { log('tap error', e); }
      return res;
    };

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__pkTapUrl = url;
      this.__pkTapMethod = String(method || 'GET').toUpperCase();
      return origOpen.call(this, method, url, ...rest);
    };

    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...a) {
      this.addEventListener('load', () => {
        try {
          const url = this.__pkTapUrl || '';
          const path = tapPathOf(url);
          if (!path.startsWith('/api/')) return;
          const want = wanting(path);
          if (!want.length) return; // the JSON.parse below is the expensive one
          const rec = {
            url, path, method: this.__pkTapMethod || 'GET',
            status: this.status, ok: this.status >= 200 && this.status < 300, body: null,
          };
          if (!(this.getResponseHeader('content-type') || '').includes('json')) {
            deliver(want, { ...rec, data: null });
            return;
          }
          // responseType 'json' hands back an already-parsed object and makes
          // responseText throw; anything text-shaped still needs parsing. That object
          // belongs to the app, which may well mutate it, so it is copied before it is
          // frozen — the freeze is ours to impose on subscribers, not on the game.
          let data;
          try {
            const raw = (this.responseType === '' || this.responseType === 'text')
              ? this.responseText : this.response;
            data = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw));
          } catch { return; }
          if (data === null || typeof data !== 'object') return;
          deliver(want, { ...rec, data: freeze(data) });
        } catch (e) { log('xhr tap error', e); }
      });
      return origSend.apply(this, a);
    };

    const api = Object.freeze({
      version: HTTP_TAP_VERSION,
      subscribe: (prefix, fn) => {
        const prefixes = prefix === '*' ? null : (Array.isArray(prefix) ? prefix.slice() : [prefix]);
        const s = { prefixes, fn };
        subs.push(s);
        return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
      },
    });
    Object.defineProperty(window, KEY, { value: api, configurable: true });
    log('tap installed, HTTP TAP v' + HTTP_TAP_VERSION);
    return api.subscribe;
  })();

  // ===========================================================================
  // 3. PANEL KIT v2 — shared verbatim block, see userscripts/_template.user.js.
  // ===========================================================================
  const draggable = (node, handle, onMove) => {
    const EDGE = 44; // px of the element that must stay reachable on screen
    let sx = 0, sy = 0, ox = 0, oy = 0, live = false, moved = false;
    let skew = null; // gap between the border box and what left/top actually set

    const place = (x, y) => {
      const w = node.offsetWidth, h = node.offsetHeight;
      const p = w && h ? {
        x: Math.min(Math.max(x, EDGE - w), window.innerWidth - EDGE),
        y: Math.min(Math.max(y, 0), window.innerHeight - Math.min(EDGE, h)),
      } : { x, y }; // hidden element: no geometry to clamp against, fix it on show
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
      // `left` positions the MARGIN edge, but every measurement here is the
      // border box. If the host page styles our element with a margin, each grab
      // drifts by that much and compounds. Measure the gap once, then cancel it.
      if (skew === null && w && h) {
        const seen = node.getBoundingClientRect();
        skew = { x: seen.left - p.x, y: seen.top - p.y };
      }
      if (skew && (skew.x || skew.y)) {
        node.style.left = `${p.x - skew.x}px`;
        node.style.top = `${p.y - skew.y}px`;
      }
      return p;
    };

    const down = (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      // a control inside the handle keeps its click; the handle itself still drags
      if (ev.target !== handle && ev.target.closest?.('button,input,select,textarea,a,[data-nodrag]')) return;
      const r = node.getBoundingClientRect();
      place(r.left, r.top); // convert whatever CSS anchoring it had into left/top
      sx = ev.clientX; sy = ev.clientY; ox = r.left; oy = r.top;
      live = true; moved = false;
      try { handle.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
      ev.preventDefault();
    };

    const move = (ev) => {
      if (!live) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return; // tremor isn't a drag
      moved = true;
      place(ox + dx, oy + dy);
    };

    const up = (ev) => {
      if (!live) return;
      live = false;
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
      if (!moved) return;
      const r = node.getBoundingClientRect();
      onMove({ x: r.left, y: r.top });
    };

    handle.style.touchAction = 'none'; // don't scroll the game while dragging
    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);

    // Never strand the panel: a short window, a rotation, or a panel that grew
    // taller than the space its CSS corner left it can all put the drag handle
    // off-screen, and then there is no way to get it back.
    const fit = () => {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const x = Math.min(Math.max(r.left, EDGE - r.width), window.innerWidth - EDGE);
      const y = Math.min(Math.max(r.top, 0), window.innerHeight - Math.min(EDGE, r.height));
      if (Math.abs(x - r.left) < 0.5 && Math.abs(y - r.top) < 0.5) return false;
      onMove(place(x, y));
      return true;
    };
    window.addEventListener('resize', fit);

    return {
      apply: (pos) => {
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
        place(pos.x, pos.y);
        return true;
      },
      reset: () => {
        node.style.left = node.style.top = node.style.right = node.style.bottom = '';
        onMove(null);
      },
      dragged: () => moved,
      fit, // call after mounting and after any render that changes the size

      // Convert whatever CSS corner the element is anchored to into explicit
      // left/top, without moving it. The browser's own resize grabber only grows a
      // box right and down, so a panel still hanging off `right`/`bottom` grows
      // away from the pointer; resizable() pins it the moment the grab starts.
      pin: () => {
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) return false; // hidden: nothing to measure
        place(r.left, r.top);
        return true;
      },
    };
  };

  // ---------------------------------------------------------------------------
  //    resizable(node, onSize, opts) -> { apply(size), reset(), sized() }
  //      node    the element that resizes (the same one draggable() moves)
  //      onSize  called with {w, h} as CSS lengths, or null when reset
  //      opts    { minW, minH, drag } — pass the draggable() for this same node so
  //              a resize can re-pin and re-clamp it
  //
  //    The browser's own grabber does the dragging. There is deliberately no second
  //    drag implementation here to keep in step with the one above: all this block
  //    does is arm the grabber, keep it pointing the right way, and remember the
  //    result. The grabber writes inline width/height, so inline values that differ
  //    from what we last wrote can only have come from the user — content re-renders
  //    never write them, which is what keeps auto-sizing intact until the first
  //    deliberate resize.
  // ---------------------------------------------------------------------------
  const resizable = (node, onSize, opts = {}) => {
    const GRAB = 18;                  // the corner the UA's grabber occupies
    const drag = opts.drag || null;
    let mine = null;                  // the last size WE wrote

    // A viewport this small is a hidden tab or a minimised window rather than a
    // real layout — the same trap the placement layers guard against. Capping
    // against it would shrink the panel to nothing and the next report would make
    // that permanent, so treat it as no information.
    const usable = () => window.innerWidth > 120 && window.innerHeight > 120;

    const floor = () => ({
      w: Math.min(opts.minW || 220, Math.max(80, window.innerWidth - 16)),
      h: Math.min(opts.minH || 140, Math.max(80, window.innerHeight - 16)),
    });

    // Cap growth at the viewport rather than at whatever vh the panel's own CSS
    // picked: a `max-height: 74vh` silently fights a chosen height, so the panel
    // stops growing while the pointer keeps going and then jumps on the way back.
    // Only ever applied once a size has actually been chosen, so an untouched
    // panel keeps its stylesheet's sizing exactly as written.
    const cap = () => {
      if (!usable()) return;
      const f = floor();
      node.style.minWidth = `${f.w}px`;
      node.style.minHeight = `${f.h}px`;
      node.style.maxWidth = `${Math.max(f.w, window.innerWidth - 16)}px`;
      node.style.maxHeight = `${Math.max(f.h, window.innerHeight - 16)}px`;
    };

    node.style.resize = 'both';
    node.style.overflow = 'hidden'; // `resize` is inert while overflow is visible

    const report = () => {
      const w = node.style.width, h = node.style.height;
      if (!w && !h) return;                             // never resized: still auto
      if (mine && mine.w === w && mine.h === h) return; // our own restore, not a gesture
      mine = { w, h };
      onSize(mine);
      if (drag) drag.fit(); // a taller panel can push its own handle off-screen
    };

    // Capture phase: the panel's own handlers must not be able to swallow the grab.
    // Nothing is preventDefault()ed — the UA still runs the resize itself.
    node.addEventListener('pointerdown', (ev) => {
      const r = node.getBoundingClientRect();
      if (ev.clientX < r.right - GRAB || ev.clientY < r.bottom - GRAB) return;
      cap();
      if (drag) drag.pin();
    }, true);

    // Two ways in, because neither alone is sufficient. ResizeObserver is the
    // precise one but it is delivered on the rendering lifecycle, so a page that is
    // not compositing never gets the callback. pointerup is the backstop: the
    // grabber is a pointer gesture, so releasing it always lands here. report() is
    // idempotent, so both firing costs nothing.
    if (typeof ResizeObserver === 'function') new ResizeObserver(report).observe(node);
    node.addEventListener('pointerup', report);
    window.addEventListener('resize', () => { if (mine) cap(); });

    return {
      apply: (size) => {
        if (!size || !size.w || !size.h) return false;
        mine = { w: String(size.w), h: String(size.h) };
        node.style.width = mine.w;
        node.style.height = mine.h;
        cap();
        if (drag) drag.pin(); // a restored size wants the same anchoring a grab does
        return true;
      },
      reset: () => {
        mine = null;
        node.style.width = node.style.height = '';
        node.style.minWidth = node.style.minHeight = '';
        node.style.maxWidth = node.style.maxHeight = '';
        onSize(null);
      },
      sized: () => !!mine,
    };
  };

  // ---------------------------------------------------------------------------
  // 4. Stylesheet.
  //
  //    PANEL_W is what the panel asks for, not what it usually gets. These windows
  //    get parked in the strip between the game's sidebar and its content, so the
  //    typical width is a couple of hundred pixels and everything below has to
  //    survive that: the strategy grid is eleven columns of one character, the
  //    stat grid reflows to one column, and the control bars wrap rather than
  //    scroll.
  // ---------------------------------------------------------------------------
  const PANEL_W = 384;

  const CSS = `
    /* FAB KIT v7 — shared verbatim block.
       Same rule as PANEL KIT: copy it in as it stands, and if it has to change,
       bump the version here and in every tool carrying a copy, so the copies can
       be diffed. Several of these tools are on screen at once, and buttons that
       each picked their own shape read as several unrelated add-ons rather than
       one set of tools. A 15px glyph is also a coin toss across fonts and
       platforms, and four of them tell you nothing about which is which. So the
       box is fixed here and only the word inside it belongs to the tool: three
       or four letters, upper case, no emoji.

       v2 adds .pk-open: the button is filled while its own panel is open. A dozen
       of these can sit on one screen and every panel remembers whether it was open,
       so the row of buttons was the one thing that could not tell you which
       windows you already had — you found that out by clicking one and closing it.

       v3 makes that row literal. Until now every tool picked its own corner, and
       eleven tools meant eleven buttons scattered down both edges of the screen in
       an order nobody chose: you hunted for the one you wanted. They now default
       to one row, side by side, in the band above the game's header rule — the
       header is 52px tall (py-3 either side of a 28px nav link) and the button is
       38, so top: 7 centres it there, and on any desktop layout that band is empty
       screen between the nav links and the account menu.

       v4 widened the row to thirteen slots, for poll-watch and shop-watch; v5
       widened it to fourteen for bar-watch, v6 to fifteen for slot-watch, and v7 to
       sixteen for jack-watch. Half the row is written out below because CSS cannot
       count the tools that happen to be installed, which means every slot the row
       gains costs a version bump and a pass over every copy — the price of the row
       being one row rather than each tool's guess at one.

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 16; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       a sixteenth tool does not shuffle the fifteen buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. The eye
       leads because it is the mark of the set; the words are alphabetical after it:

         0  the eye  people-watch     8  TIME  time-watch
         1  ALGN     align-watch      9  WRLD  world-watch
         2  GOV      gov-watch       10  XP    xp-watch
         3  JUMP     quick-jump      11  POLL  poll-watch
         4  MKT      market-watch    12  SHOP  shop-watch
         5  RAID     raid-watch      13  BARS  bar-watch
         6  SLP      sleeper-watch   14  SLOT  slot-watch
         7  SOCK     ws-watch        15  JACK  jack-watch

       POLL, SHOP, BARS, SLOT and JACK are on the end rather than sorted in among
       the others, and that is deliberate: the alphabet describes how the first
       eleven were handed out, not a sort to be re-run. Slots are fixed, so a tool
       that arrives later takes the next free number and nothing already on screen

       Sixteen 38px buttons 8px apart is a 728px row, so it runs 364px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1608px the row is centred,
       and below that it stops sliding left rather than climb onto the nav.

       Three numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 364 (half the row). Nothing else in here is placement.

       (No backticks anywhere in here, incidentally. This block is pasted INSIDE a
       template literal in every tool that carries it, and one backtick in a comment
       ends the literal and takes the rest of the file with it.)

       The FILL is the open channel, and it is the one property the kit keeps for
       itself. A tool's state rule comes after this block at the same specificity
       and therefore wins on border-color and color: an open sleeper-watch
       still reads green, an open market-watch still reads red, and both still read
       as open. Put the open state in either of those two properties instead and a
       tool's state colour erases it without a word. Hover does not outrank it
       either — open is a state; a pointer passing over is not.

       The fill is one palette step, #18181b to #3f3f46, and it does cost a state
       colour some contrast while that panel is open: market-watch's red goes from
       about 4.7:1 to 2.8:1. One step less (#27272a) buys that back, and at 38px it
       stops reading as filled at all — the border ends up doing the work alone.
       Both were rendered against a stack before this one was picked.

       What this block deliberately leaves to the tool, because it IS the tool's:
         - its slot in the row, and its z-index: --pk-slot / z-index
         - state colour and badges layered on top (.hot, .live, .pkws-done)
       The tool's own rule goes AFTER this block: same specificity, later wins.
       An inset is no longer among them — a tool that sets top/left/right/bottom
       has quietly left the row, and tools/test-placement.js fails that build.

       Tools that also do their own placement maths keep CFG.FAB_SIZE in step
       with the 38px below; tools/test-placement.js fails the build if one drifts.
       They also have to compute this row themselves, because an inline left/top
       outranks any rule here. Two do: market-watch and people-watch.

       people-watch is the one exception to the word. It wears the eye of
       providence, which is its mark and predates this block; the svg rule sizes
       that inside the same square as everyone else's letters. */
    .pk-fab {
      box-sizing: border-box; width: 38px; height: 38px; padding: 0;
      /* The home row. --pk-slot is the tool's; the three numbers are the kit's. */
      position: fixed; top: 7px;
      left: calc(max(440px, 50% - 364px) + var(--pk-slot, 0) * 46px);
      display: grid; place-items: center;
      background: #18181b; color: #e4e4e7;
      border: 1px solid #3f3f46; border-radius: 3px;
      font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: .08em; text-align: center;
      cursor: pointer; user-select: none; touch-action: none;
    }
    .pk-fab:hover { border-color: #71717a; color: #fafafa; }
    .pk-fab.dragging { cursor: grabbing; border-color: #52525b; }
    /* Open, and last: neither hover nor a drag may un-fill it. */
    .pk-fab.pk-open { background: #3f3f46; border-color: #a1a1aa; color: #fafafa; }
    .pk-fab svg { width: 24px; height: 24px; display: block; }
    .pkbj-fab { --pk-slot: 15; z-index: 2147481880; }
    .pkbj-fab.up { border-color: #15803d; color: #4ade80; }
    .pkbj-fab.down { border-color: #b91c1c; color: #f87171; }
    /* A hand waiting on you outranks either: the point of the button in that moment
       is that there is a decision on the table, not how the night is going. */
    .pkbj-fab.live { border-color: #a16207; color: #fbbf24; }

    .pkbj-panel {
      position: fixed; left: 12px; top: 96px; z-index: 2147481880;
      width: ${PANEL_W}px; max-width: calc(100vw - 24px); max-height: 80vh;
      display: none; flex-direction: column;
      box-sizing: border-box; background: #09090b; color: #e4e4e7;
      border: 1px solid #27272a; border-radius: 4px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      box-shadow: 0 10px 34px rgba(0,0,0,.6);
    }
    .pkbj-hd {
      display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
      padding: 7px 9px; border-bottom: 1px solid #27272a; background: #111113;
      border-radius: 3px 3px 0 0; cursor: grab; user-select: none;
    }
    .pkbj-ttl { font-weight: 700; letter-spacing: .1em; font-size: 10px; color: #a1a1aa; }
    .pkbj-sub { font-size: 10px; color: #52525b; margin-left: auto;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pkbj-x { background: none; border: 0; color: #52525b; cursor: pointer;
              font: inherit; padding: 0 2px; flex: 0 0 auto; }
    .pkbj-x:hover { color: #e4e4e7; }

    .pkbj-tabs { display: flex; flex: 0 0 auto; border-bottom: 1px solid #27272a; }
    .pkbj-tab { flex: 1 1 0; background: none; border: 0; border-bottom: 2px solid transparent;
                color: #52525b; cursor: pointer; padding: 5px 1px; min-width: 0;
                font: 700 9px/1 ui-monospace, monospace; letter-spacing: .08em; }
    .pkbj-tab:hover { color: #a1a1aa; }
    .pkbj-tab.on { color: #e4e4e7; border-bottom-color: #a1a1aa; }

    .pkbj-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 9px; }
    .pkbj-empty { color: #52525b; font-size: 11px; padding: 6px 2px; }

    /* auto-fit, so the grid is one column in a margin and three in a wide panel */
    .pkbj-stats { display: grid; gap: 6px; margin-bottom: 9px;
                  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); }
    .pkbj-stat { border: 1px solid #1f1f23; border-radius: 3px; padding: 5px 7px;
                 background: #0d0d10; min-width: 0; }
    .pkbj-k { display: block; font-size: 8px; letter-spacing: .14em; color: #52525b;
              text-transform: uppercase; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
    .pkbj-v { display: block; margin-top: 2px; font-size: 13px; color: #d4d4d8;
              overflow-wrap: anywhere; }
    .pkbj-v.up { color: #4ade80; } .pkbj-v.down { color: #f87171; }
    .pkbj-v.est { color: #a1a1aa; }
    .pkbj-n { font-size: 9px; color: #52525b; }

    /* The felt. Cards are text because a 200px margin has no room for anything
       else, and because a card that is only a colour is unreadable to half the
       people who might install this. */
    .pkbj-seat { border: 1px solid #1f1f23; border-radius: 3px; background: #0d0d10;
                 padding: 6px 7px; margin-bottom: 6px; }
    .pkbj-seat.act { border-color: #a16207; background: #14110a; }
    .pkbj-who { display: flex; gap: 6px; align-items: baseline; font-size: 9px;
                letter-spacing: .12em; text-transform: uppercase; color: #52525b; }
    .pkbj-who b { color: #a1a1aa; font-weight: 700; }
    .pkbj-who .tot { margin-left: auto; color: #d4d4d8; letter-spacing: 0;
                     font-size: 11px; text-transform: none; }
    .pkbj-cards { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
    .pkbj-card { border: 1px solid #3f3f46; border-radius: 2px; background: #18181b;
                 color: #e4e4e7; padding: 2px 4px; font-size: 11px; min-width: 20px;
                 text-align: center; }
    .pkbj-card.red { color: #fca5a5; }
    .pkbj-card.down { color: #52525b; border-style: dashed; }

    /* The recommendation. One line, and it is the only thing in the panel that is
       allowed to be loud, because it is the only thing that is time-critical. */
    .pkbj-pick { border: 1px solid #3f3f46; border-left: 3px solid #eab308;
                 border-radius: 3px; background: #14110a; padding: 6px 8px;
                 margin-bottom: 8px; }
    .pkbj-pick b { font-size: 15px; color: #fde68a; letter-spacing: .08em; }
    .pkbj-pick .why { display: block; margin-top: 2px; font-size: 10px; color: #a1a1aa; }

    .pkbj-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
                margin-bottom: 9px; }
    .pkbj-btn { background: #18181b; color: #a1a1aa; border: 1px solid #3f3f46;
                border-radius: 3px; padding: 3px 7px; cursor: pointer;
                font: 10px/1.3 ui-monospace, monospace; }
    .pkbj-btn:hover { border-color: #71717a; color: #e4e4e7; }
    .pkbj-btn.on { background: #27272a; color: #fafafa; border-color: #71717a; }
    .pkbj-btn:disabled { opacity: .4; cursor: default; }
    .pkbj-in { background: #0d0d10; color: #e4e4e7; border: 1px solid #3f3f46;
               border-radius: 3px; padding: 3px 5px; width: 11ch; min-width: 0;
               font: 11px ui-monospace, monospace; }
    .pkbj-lbl { font-size: 9px; letter-spacing: .1em; color: #52525b;
                text-transform: uppercase; }

    .pkbj-chart { border: 1px solid #1f1f23; border-radius: 3px; background: #0d0d10;
                  padding: 6px 7px 5px; margin-bottom: 9px; }
    .pkbj-chart svg { display: block; width: 100%; height: auto; }
    .pkbj-axis { display: flex; justify-content: space-between; gap: 8px;
                 font-size: 9px; color: #52525b; }
    .pkbj-axis span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pkbj-legend { display: flex; flex-wrap: wrap; gap: 4px 11px; font-size: 9px;
                   color: #71717a; margin-bottom: 4px; }
    .pkbj-swatch { display: inline-block; width: 14px; height: 0;
                   border-top: 2px solid currentColor; vertical-align: middle;
                   margin-right: 4px; }
    .pkbj-you { color: #60a5fa; } .pkbj-exp { color: #a1a1aa; }

    /* Fixed layout is the load-bearing half of the table rule in CLAUDE.md, for the
       reason that file gives: auto layout will not make a column narrower than its
       content at any price, so five columns of currency in a 240px margin push the
       table wider than the panel and you scroll sideways to read column one. Fixed
       layout truncates instead, every cell carries its full value in a title, and the
       widths sum to 100 so nothing is left to distribute. These tables do NOT carry
       people-watch's draggable dividers — see userscripts/README.md.

       (No backticks in here. This block is inside a template literal, and one
       backtick in a comment ends the literal and takes the rest of the file with it.) */
    .pkbj-tbl { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 10.5px; }
    .pkbj-tbl th { text-align: right; font-weight: 500; color: #52525b; font-size: 8px;
                   letter-spacing: .1em; text-transform: uppercase; padding: 0 0 4px 6px;
                   border-bottom: 1px solid #27272a; }
    .pkbj-tbl th:first-child, .pkbj-tbl td:first-child { text-align: left; padding-left: 0; }
    .pkbj-tbl td { text-align: right; padding: 3px 0 3px 6px; color: #a1a1aa;
                   border-bottom: 1px solid #141417; }
    .pkbj-tbl th, .pkbj-tbl td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pkbj-tbl col.c-id { width: 18%; } .pkbj-tbl col.c-a { width: 17%; }
    .pkbj-tbl col.c-b { width: 16%; } .pkbj-tbl col.c-c { width: 16%; }
    .pkbj-tbl col.c-d { width: 15%; } .pkbj-tbl col.c-e { width: 18%; }
    .pkbj-tbl td.up { color: #4ade80; } .pkbj-tbl td.down { color: #f87171; }
    .pkbj-tbl tr.live td:first-child { color: #fbbf24; }

    /* The strategy grid: eleven columns of one character each, which is the one
       shape that stays legible when the panel is a margin. */
    .pkbj-grid { width: 100%; table-layout: fixed; border-collapse: collapse;
                 font-size: 9px; margin-bottom: 7px; }
    .pkbj-grid th { color: #52525b; font-weight: 500; padding: 1px 0;
                    border-bottom: 1px solid #27272a; }
    .pkbj-grid td { text-align: center; padding: 1px 0; color: #71717a;
                    border: 1px solid #141417; }
    .pkbj-grid td:first-child, .pkbj-grid th:first-child {
      text-align: left; color: #a1a1aa; padding-left: 1px; }
    .pkbj-grid td.h { background: #1c1207; color: #fbbf24; }
    .pkbj-grid td.s { background: #0b1a12; color: #4ade80; }
    .pkbj-grid td.d { background: #101a2c; color: #60a5fa; }
    .pkbj-grid td.p { background: #1b1024; color: #c084fc; }
    /* Where this shoe disagrees with a fresh one. The whole reason the grid is
       computed rather than typed in. */
    .pkbj-grid td.dev { outline: 1px solid #fafafa; outline-offset: -1px; }

    .pkbj-note { font-size: 9.5px; line-height: 1.5; color: #52525b; margin-top: 8px;
                 border-top: 1px solid #1f1f23; padding-top: 7px; }
    .pkbj-warn { font-size: 10px; color: #fbbf24; border: 1px solid #78350f;
                 background: #1c1207; border-radius: 3px; padding: 5px 7px;
                 margin-bottom: 9px; }
    /* Deliberately not the warn colour. A mark, or a shoe assumption, is a thing you
       chose rather than a fault — but it changes what every number below it means, so
       it is a standing line rather than a footnote, and the bar down its left edge is
       what makes it read as one at a glance. */
    .pkbj-scope { font-size: 9.5px; line-height: 1.5; color: #71717a;
                  border: 1px solid #1f1f23; border-left: 2px solid #3f3f46;
                  background: #0d0d10; border-radius: 3px; padding: 4px 7px;
                  margin-bottom: 9px; }
    .pkbj-scope b { color: #a1a1aa; font-weight: 700; }
  `;

  // ---------------------------------------------------------------------------
  // 5. State.
  //
  //    Kept per casino corporation, because the numbers are per TABLE: two casinos
  //    can run different limits and different reserves, and — the one that actually
  //    bites — two tables are two shoes. Rolling their cards into one count would
  //    describe neither.
  // ---------------------------------------------------------------------------
  const MAX_HANDS = 400;         // rounds kept per table
  const MAX_DECISIONS = 400;     // inferred decisions kept per table

  const data = readJSON(K.data, null) || { corps: {} };
  if (!data.corps || typeof data.corps !== 'object') data.corps = {};

  const ui = readJSON(K.ui, null) || {};
  if (typeof ui.open !== 'boolean') ui.open = false;
  if (!['HAND', 'COUNT', 'MONEY', 'PLAN', 'LOG'].includes(ui.tab)) ui.tab = 'HAND';
  // Which composition the solver runs against, and the single most consequential
  // switch in the panel — see the note it prints in COUNT.
  if (!['TABLE', 'COUNTED'].includes(ui.shoe)) ui.shoe = 'TABLE';
  if (!ui.stake || typeof ui.stake !== 'object') ui.stake = {};
  if (!ui.planner || typeof ui.planner !== 'object') ui.planner = {};
  // corp id -> the hand id the panel's figures start above. Per table, like everything
  // else here: you can be mid-run at one table and looking at the whole history of
  // another, and one shared floor would make each of those a lie about the other.
  if (!ui.mark || typeof ui.mark !== 'object') ui.mark = {};

  const saveData = () => writeJSON(K.data, data);
  const saveUI = () => writeJSON(K.ui, ui);

  let active = null;             // corp id of the table currently in view, as a string

  const corp = (id) => {
    if (!data.corps[id]) data.corps[id] = { cfg: null, hands: {}, decisions: [] };
    const c = data.corps[id];
    if (!c.hands || typeof c.hands !== 'object') c.hands = {};
    if (!Array.isArray(c.decisions)) c.decisions = [];
    return c;
  };

  const known = () => Object.keys(data.corps).sort((a, b) => Number(a) - Number(b));

  // Newest first, which is the order the game's own history arrives in and the order
  // the log reads in. id is the only ordering the wire gives — see docs/19.
  const handsOf = (id) => {
    const c = data.corps[id];
    if (!c) return [];
    return Object.values(c.hands).sort((a, b) => b.id - a.id);
  };

  const prune = (c) => {
    const all = Object.values(c.hands).sort((a, b) => b.id - a.id);
    if (all.length > MAX_HANDS) {
      for (const h of all.slice(MAX_HANDS)) delete c.hands[h.id];
    }
    if (c.decisions.length > MAX_DECISIONS) {
      c.decisions.splice(0, c.decisions.length - MAX_DECISIONS);
    }
  };

  // The solved edge is a pure function of the rules, so it is worked out once, ever,
  // and kept. Half a second is nothing to pay once and too much to pay per repaint.
  const EDGE_KEY = `d${RULES.decks}s17das1split`;
  const solvedEdge = () => (data.edge && data.edge.key === EDGE_KEY ? num(data.edge.edge) : null);

  // ---------------------------------------------------------------------------
  // 6. Ingest.
  //
  //    Everything here is shape-driven. The tap hands over a path and a parsed
  //    body; this reads the corporation id out of the path and then decides what
  //    the payload IS by looking at it. It never reads the verb and never reads
  //    the request, which is why it cannot tell a GET from a POST and why neither
  //    of the two endpoints that would play a hand is in this file.
  // ---------------------------------------------------------------------------
  const CORP_PATH = /^\/api\/corporations\/(\d+)\//;

  // The table config, recognised by the pair of fields nothing else on this surface
  // carries. `active_hand` is not part of the gate: it is null between rounds, and a
  // gate that needed it would stop recognising the table exactly when you sat down.
  const isConfig = (d) => !!d && typeof d === 'object'
    && num(d.blackjack_min_bet) !== null && num(d.blackjack_max_bet) !== null;

  let pending = 0;
  const repaint = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; render(); });
  };

  const takeHand = (c, raw, at) => {
    const slim = slimHand(raw);
    const prev = c.hands[slim.id];
    slim.seen = prev ? prev.seen : at;

    // What you did, worked out from the state before and the state after, because the
    // wire never says. Priced once, here, against the basic-strategy baseline — see
    // priceDecision — so the ledger cannot move under an old answer.
    const act = inferAct(prev, slim);
    if (act) {
      const d = priceDecision(prev, act);
      if (d) { d.at = at; c.decisions.push(d); }
    }

    c.hands[slim.id] = mergeHand(prev, slim);
    return !prev;
  };

  const consume = ({ path, data: payload }) => {
    const m = CORP_PATH.exec(path || '');
    if (!m || !payload || typeof payload !== 'object') return;
    const id = m[1];
    const at = Date.now();
    let touched = false;

    if (isConfig(payload)) {
      const c = corp(id);
      c.cfg = {
        min: payload.blackjack_min_bet,
        max: payload.blackjack_max_bet,
        step: num(payload.wager_increment) ?? 1,
        cash: num(payload.player_cash),
        reserve: num(payload.free_reserve),
        held: num(payload.reserve_balance),
        dealers: num(payload.available_dealers),
        seats: num(payload.dealer_capacity),
        access: payload.current_city_access === true,
        live: payload.operational === true,
        suspended: payload.wagering_suspended === true,
        at,
      };
      active = id;
      touched = true;
    }

    // The history array, which the game fetches whole and renders one element of.
    if (Array.isArray(payload.hands)) {
      const c = corp(id);
      let added = 0;
      for (const h of payload.hands) if (isHand(h)) { if (takeHand(c, h, at)) added++; }
      if (payload.hands.length) { active = id; touched = true; }
      if (added) log('history', id, '+' + added);
    }

    // A single hand, however it arrived: the one riding on the config, the one the
    // game gets back for a button you pressed, or a bare one, so this does not depend
    // on either envelope staying the way it is.
    const one = isHand(payload.hand) ? payload.hand
      : (isHand(payload.active_hand) ? payload.active_hand : (isHand(payload) ? payload : null));
    if (one) {
      const c = corp(id);
      takeHand(c, one, at);
      active = id;
      touched = true;
    }

    if (!touched) return;
    prune(corp(id));
    saveData();
    repaint();
  };

  // ---------------------------------------------------------------------------
  // 7. Formatting.
  // ---------------------------------------------------------------------------
  const money = (v) => (num(v) === null ? '—' : '$' + Math.round(v).toLocaleString());
  const signed = (v) => (num(v) === null ? '—'
    : (v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(v)).toLocaleString());
  const pct = (r, dp) => (num(r) === null ? '—' : (r * 100).toFixed(dp == null ? 2 : dp) + '%');
  const ev = (v) => (num(v) === null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3));
  // 24-hour, because the column this lands in is the first one a narrow panel
  // truncates and " AM" is three characters that carry nothing the digits do not.
  const clock = (t) => (num(t) === null ? '—'
    : new Date(t).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }));
  const compact = (v) => {
    if (num(v) === null) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    return String(Math.round(v));
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const svgEl = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  };

  const WORD = { hit: 'HIT', stand: 'STAND', double: 'DOUBLE', split: 'SPLIT' };
  const LETTER = { hit: 'H', stand: 'S', double: 'D', split: 'P' };

  // ---------------------------------------------------------------------------
  // 8. The chart.
  //
  //    A fixed viewBox scaled to whatever width the panel has, with
  //    non-scaling-stroke so the lines stay 1px however narrow it gets, and with
  //    every label in HTML outside the SVG so no text is ever scaled down with it.
  //    That is what makes this readable in a 200px margin.
  // ---------------------------------------------------------------------------
  const VB = { w: 320, h: 112, pad: 3 };

  const drawChart = (pts) => {
    const box = el('div', 'pkbj-chart');
    const ext = pts && pts.length > 1 ? extent(pts) : null;
    if (!ext) {
      box.append(el('div', 'pkbj-empty', 'not enough of a run to draw yet'));
      return box;
    }

    const legend = el('div', 'pkbj-legend');
    for (const [cls, word] of [['pkbj-you', 'your money'], ['pkbj-exp', 'perfect play']]) {
      const s = el('span', cls);
      s.append(el('i', 'pkbj-swatch'), document.createTextNode(word));
      legend.append(s);
    }
    box.append(legend);

    const { w, h, pad } = VB;
    const x = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2);
    const y = (v) => pad + (1 - (v - ext.lo) / (ext.hi - ext.lo)) * (h - pad * 2);

    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', role: 'img' });
    svg.setAttribute('aria-label', 'bankroll against perfect play');

    // the opening stake, so "am I up or down on where I started" is one glance
    const start = pts[0].actual;
    if (start >= ext.lo && start <= ext.hi) {
      svg.append(svgEl('line', {
        x1: pad, x2: w - pad, y1: y(start), y2: y(start),
        stroke: '#3f3f46', 'stroke-width': 1, 'stroke-dasharray': '2 3',
        'vector-effect': 'non-scaling-stroke',
      }));
    }

    const path = (key, colour, dash) => {
      const d = [];
      let open = false;
      for (const p of pts) {
        const v = num(p[key]);
        if (v === null) { open = false; continue; }
        d.push(`${open ? 'L' : 'M'}${x(p.i).toFixed(2)} ${y(v).toFixed(2)}`);
        open = true;
      }
      if (d.length < 2) return;
      const n = svgEl('path', {
        d: d.join(' '), fill: 'none', stroke: colour, 'stroke-width': dash ? 1 : 1.5,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
      });
      if (dash) n.setAttribute('stroke-dasharray', '3 3');
      svg.append(n);
    };

    path('expected', '#a1a1aa', true);
    path('actual', '#60a5fa', false);
    box.append(svg);

    const axis = el('div', 'pkbj-axis');
    axis.append(
      el('span', null, `${compact(ext.lo)} – ${compact(ext.hi)}`),
      el('span', null, `${pts[0].label} → ${pts[pts.length - 1].label}`),
    );
    box.append(axis);
    return box;
  };

  // ---------------------------------------------------------------------------
  // 9. The panel.
  // ---------------------------------------------------------------------------
  const style = el('style');
  style.textContent = CSS;

  const fab = el('button', 'pk-fab pkbj-fab', 'JACK');
  fab.title = 'Jack Watch — the blackjack table, solved (drag to move, double-click to reset)';

  const panel = el('div', 'pkbj-panel');
  const head = el('div', 'pkbj-hd');
  const title = el('span', 'pkbj-ttl', 'JACK WATCH');
  const subtitle = el('span', 'pkbj-sub', '');
  const close = el('button', 'pkbj-x', '×');
  head.append(title, subtitle, close);

  const tabs = el('div', 'pkbj-tabs');
  const tabBtn = {};
  for (const name of ['HAND', 'COUNT', 'MONEY', 'PLAN', 'LOG']) {
    const b = el('button', 'pkbj-tab', name);
    b.addEventListener('click', () => { ui.tab = name; saveUI(); render(); });
    tabBtn[name] = b;
    tabs.append(b);
  }

  const body = el('div', 'pkbj-body');
  panel.append(head, tabs, body);

  const drag = draggable(panel, head, (pos) => {
    Object.assign(ui, pos ?? { x: null, y: null });
    saveUI();
  });
  const size = resizable(panel, (s) => { ui.size = s; saveUI(); }, { drag, minW: 250, minH: 190 });
  head.addEventListener('dblclick', () => { drag.reset(); size.reset(); });

  const fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUI(); });
  fabDrag.apply(ui.fab);
  fab.addEventListener('click', () => {
    if (fabDrag.dragged()) return;
    ui.open = !ui.open;
    saveUI();
    render();
  });
  fab.addEventListener('dblclick', () => { ui.fab = null; saveUI(); fabDrag.reset(); });
  close.addEventListener('click', () => { ui.open = false; saveUI(); render(); });

  // ---------------------------------------------------------------------------
  // 10. What the panel is looking at.
  //
  //     One place assembles it and every tab reads the result, which is what stops
  //     a mark or a shoe switch from half-applying: there is no second list and no
  //     second composition.
  // ---------------------------------------------------------------------------
  const view = () => {
    const id = active && data.corps[active] ? active : known()[known().length - 1];
    if (!id) return null;
    const c = data.corps[id];
    const held = handsOf(id);              // newest first, everything this table gave up
    const floor = num(ui.mark[id]);
    const list = above(held, floor);
    const asc = list.slice().reverse();    // oldest first, which is how money moves
    const roll = rollup(list);
    const cfg = c.cfg || {};

    // The shoe, from every hand this table has shown us — not just the ones above the
    // mark. A mark scopes your MONEY; it does not un-deal a card.
    const shoe = shoeState(held.slice().reverse());

    // The hand on the table, and the one the receipt is about. The live hand is the
    // newest that is still waiting on you; the receipt falls back to the newest settled.
    const live = held.find((h) => h.status === 'player_turn') || null;
    const last = held.find((h) => netOf(h) !== null) || null;

    // The composition the solver runs against, and the assumption that comes with it.
    //
    //   TABLE   — a fresh shoe with the cards now visible taken out. Exactly right if
    //             the server reshuffles every hand, and the safe default because it is
    //             also plain basic strategy.
    //   COUNTED — everything this tool has seen since the last PROVEN reshuffle taken
    //             out. Better if the shoe persists and you are the only one drawing
    //             from it, and neither of those is established. See docs/19.
    const onTable = live ? [...(live.dealer || []),
      ...(live.hands || []).flatMap((p) => p.cards || [])] : [];
    const tableComp = without(freshShoe(), onTable).comp;
    const comp = ui.shoe === 'COUNTED' ? shoe.comp : tableComp;

    // Where the curve starts. The good seed is arithmetic on two exact numbers: the
    // table reports your cash on every poll and the ledger knows what these rounds did
    // to it, so the balance before the oldest is cash minus that. It anchors the curve
    // so its right-hand end IS your cash rather than something near it.
    let seed = null, seedSrc = null;
    if (num(cfg.cash) !== null) { seed = cfg.cash - roll.net; seedSrc = 'from your cash'; }
    const manual = num(ui.stake[id]) !== null;
    const stake = manual ? ui.stake[id] : seed;

    const returns = roundReturns(list);
    const dec = decisionRoll((c.decisions || []).filter((d) => floor === null || d.id > floor));
    const edge = solvedEdge();
    const drag2 = roll.taxDrag;

    return {
      id, cfg, list, asc, roll, live, last, shoe, comp, tableComp, dec,
      stake, seed, manual,
      floor, held: held.length, hidden: held.length - list.length,
      newest: held.length ? held[0].id : null,
      stakeNote: stake === null ? 'not set' : (manual ? 'yours' : seedSrc),
      edge,
      effEdge: edge === null ? null : edge + (drag2 ?? 0),
      sd: stdev(returns), sdN: returns.length,
      bounds: betBounds(cfg),
      now: num(cfg.cash) !== null ? cfg.cash : (stake === null ? null : stake + roll.net),
    };
  };

  // The solved grid, held in memory only: it is derived from the shoe, it costs about
  // a second or two, and a stale one on disk would be a strategy table that quietly stopped
  // describing the shoe in front of you.
  const compKey = (c) => c.join('.');
  let gridCache = null;
  let freshGrid = null;

  // ---------------------------------------------------------------------------
  // 11. Tabs.
  // ---------------------------------------------------------------------------
  const stat = (grid, key, value, cls, note) => {
    const box = el('div', 'pkbj-stat');
    box.append(el('span', 'pkbj-k', key));
    box.append(el('span', 'pkbj-v' + (cls ? ' ' + cls : ''), value));
    if (note) box.append(el('span', 'pkbj-n', note));
    grid.append(box);
    return box;
  };

  const REDS = 'HD';
  const cardEl = (card) => {
    if (card === HIDDEN) return el('span', 'pkbj-card down', '?');
    const n = el('span', 'pkbj-card' + (REDS.includes(String(card).slice(-1).toUpperCase()) ? ' red' : ''), card);
    return n;
  };

  const seat = (who, cards, note, activeSeat) => {
    const box = el('div', 'pkbj-seat' + (activeSeat ? ' act' : ''));
    const line = el('div', 'pkbj-who');
    line.append(el('b', null, who));
    if (note) line.append(el('span', null, note));
    const h = handOf(cards);
    // A natural is worth saying out loud rather than printing as another 21: it is the
    // one hand on this table that pays 3:2, and two cards is the whole of the difference
    // between it and a 21 built out of three.
    const tot = h.unknown
      ? `${h.best}+?`
      : (h.natural ? 'BLACKJACK'
        : (h.bust ? `${h.t} BUST` : (h.soft ? `soft ${h.best}` : String(h.best))));
    line.append(el('span', 'tot', tot));
    box.append(line);
    const row = el('div', 'pkbj-cards');
    for (const c of cards || []) row.append(cardEl(c));
    if (!(cards || []).length) row.append(el('span', 'pkbj-empty', 'no cards'));
    box.append(row);
    return box;
  };

  const shoeNote = (v) => {
    const n = el('div', 'pkbj-scope');
    if (ui.shoe === 'COUNTED') {
      n.append(el('b', null, 'COUNTED shoe. '));
      n.append(document.createTextNode(
        `Solving against the ${v.shoe.comp.reduce((a, b) => a + b, 0)} cards this tool has not `
        + `seen dealt since the last proven reshuffle. That is only right if the shoe persists `
        + `between hands and nobody else is drawing from it — neither is established. COUNT has `
        + `the evidence.`));
    } else {
      n.append(el('b', null, 'TABLE shoe. '));
      n.append(document.createTextNode(
        'Solving against a fresh six-deck shoe less the cards now face up, which is exactly '
        + 'right if the table reshuffles every hand, and is plain basic strategy either way. '
        + 'COUNT switches it.'));
    }
    return n;
  };

  const renderHand = (v) => {
    const cfg = v.cfg;

    // The table, before anything else, because "why is DEAL greyed out" is the
    // question this panel gets asked first.
    const grid = el('div', 'pkbj-stats');
    const dealers = num(cfg.dealers) === null ? '—' : `${cfg.dealers}/${cfg.seats ?? '?'}`;
    stat(grid, 'dealers free', dealers, num(cfg.dealers) > 0 ? 'up' : 'down');
    stat(grid, 'your cash', money(cfg.cash));
    if (v.bounds) {
      stat(grid, 'max bet now', money(v.bounds.max), null, 'held by ' + v.bounds.why);
    }
    body.append(grid);

    if (!v.live) {
      body.append(el('div', 'pkbj-empty',
        'No hand in progress. Stack chips and press DEAL — the table sends the hand back and '
        + 'it lands here, card by card, with the action priced before you take it.'));
      if (v.last) {
        const n = netOf(v.last);
        body.append(seat('DEALER', v.last.dealer, 'last hand #' + v.last.id, false));
        (v.last.hands || []).forEach((p, i) => {
          body.append(seat('HAND ' + (i + 1), p.cards,
            (p.outcome || p.status || '').toUpperCase(), false));
        });
        const g2 = el('div', 'pkbj-stats');
        stat(g2, 'staked', money(v.last.total));
        stat(g2, 'tax', money(v.last.tax));
        stat(g2, 'result', signed(n), n > 0 ? 'up' : (n < 0 ? 'down' : null));
        body.append(g2);
      }
      body.append(el('div', 'pkbj-note',
        'Nothing here is pressed for you and nothing here knows how to press it. The solver '
        + 'reads; you play. See the disclosure at the top of this file.'));
      return;
    }

    const h = v.live;
    const up = upOf(h);
    const i = num(h.cur) ?? 0;
    const mine = (h.hands || [])[i];
    const s = mine ? solve(mine.cards, up, v.comp, h.allowed) : null;

    // The recommendation, and the price of the alternatives. This is the only loud
    // thing in the panel because it is the only time-critical one.
    if (s && s.pick) {
      const box = el('div', 'pkbj-pick');
      box.append(el('b', null, WORD[s.pick] || s.pick.toUpperCase()));
      const rest = Object.keys(s.ev).filter((a) => a !== s.pick)
        .sort((a, b) => s.ev[b] - s.ev[a])
        .map((a) => `${WORD[a] || a} ${ev(s.ev[a])}`).join('  ·  ');
      box.append(el('span', 'why',
        `${ev(s.ev[s.pick])} per $1 staked${rest ? '   vs   ' + rest : ''}`));
      body.append(box);
    }

    body.append(seat('DEALER', h.dealer, up === null ? '' : 'shows ' + RANKS[up], false));
    (h.hands || []).forEach((p, k) => {
      const note = k === i ? 'YOUR TURN' : (p.outcome || p.status || '').toUpperCase();
      body.append(seat('HAND ' + (k + 1) + '  ' + money(p.stake), p.cards, note, k === i));
    });

    // The chances. Every one of these is exact off the stated rules — nothing here is
    // sampled and nothing here is a forecast about a run.
    if (s) {
      const g = el('div', 'pkbj-stats');
      if (num(s.bustNext) !== null) {
        stat(g, 'bust if you hit', pct(s.bustNext, 1), s.bustNext > 0.5 ? 'down' : null);
      }
      stat(g, 'dealer busts', pct(s.dealerBust, 1), s.dealerBust > 0.35 ? 'up' : null);
      stat(g, 'stand: win / push', `${pct(s.odds.win, 1)} / ${pct(s.odds.push, 1)}`, null,
        'lose ' + pct(s.odds.lose, 1));
      body.append(g);

      const t = el('table', 'pkbj-tbl');
      const cols = el('colgroup');
      for (const cls of ['c-id', 'c-a', 'c-b', 'c-c']) cols.append(el('col', cls));
      t.append(cols);
      const thead = el('thead');
      const hr = el('tr');
      for (const k of ['action', 'ev / $1', 'on this hand', '']) hr.append(el('th', null, k));
      thead.append(hr);
      t.append(thead);
      const tb = el('tbody');
      for (const a of Object.keys(s.ev).sort((x, y) => s.ev[y] - s.ev[x])) {
        const tr = el('tr');
        tr.append(el('td', null, WORD[a] || a));
        const e = s.ev[a];
        const c1 = el('td', e >= 0 ? 'up' : 'down', ev(e));
        tr.append(c1);
        const cash = num(mine && mine.stake) === null ? null : e * mine.stake;
        tr.append(el('td', cash === null ? null : (cash >= 0 ? 'up' : 'down'),
          cash === null ? '—' : signed(cash)));
        tr.append(el('td', null, a === s.pick ? '◀' : ''));
        tb.append(tr);
      }
      t.append(tb);
      body.append(t);
    } else {
      body.append(el('div', 'pkbj-warn',
        'This hand cannot be solved from what has arrived — the dealer has no face-up card yet, '
        + 'or the cards are in a shape this tool does not recognise. Nothing is guessed.'));
    }

    body.append(shoeNote(v));
    body.append(el('div', 'pkbj-note',
      'EV is per dollar already on this hand, so DOUBLE and SPLIT can exceed ±1 — they stake '
      + 'more. Only actions the table itself offered are priced; the list comes from the '
      + 'server. Two approximations, both in docs/19: the dealer distribution is held fixed '
      + 'while your own draws are enumerated, and a split is priced as twice one hand.'));
  };

  const renderCount = (v) => {
    const sh = v.shoe, ct = sh.count;

    const bar = el('div', 'pkbj-bar');
    bar.append(el('span', 'pkbj-lbl', 'solve against'));
    for (const mode of ['TABLE', 'COUNTED']) {
      const b = el('button', 'pkbj-btn' + (ui.shoe === mode ? ' on' : ''), mode);
      b.title = mode === 'TABLE'
        ? 'a fresh shoe less the cards face up — right if the table reshuffles every hand'
        : 'less everything seen since the last proven reshuffle — right only if the shoe persists';
      b.addEventListener('click', () => { ui.shoe = mode; saveUI(); render(); });
      bar.append(b);
    }
    body.append(bar);
    body.append(shoeNote(v));

    const g = el('div', 'pkbj-stats');
    stat(g, 'running count', (ct.running > 0 ? '+' : '') + ct.running, null, 'hi-lo');
    stat(g, 'true count', ct.true === null ? '—' : (ct.true > 0 ? '+' : '') + ct.true.toFixed(1),
      null, ct.true === null ? 'under half a deck' : ct.decks.toFixed(1) + ' decks left');
    stat(g, 'cards seen', String(ct.cardsSeen), null, `of ${SHOE_SIZE}`);
    body.append(g);

    // The evidence, which is the whole reason the numbers above are allowed on screen.
    const ev2 = el('div', sh.proven ? 'pkbj-warn' : 'pkbj-scope');
    if (sh.proven) {
      ev2.append(document.createTextNode(
        `A reshuffle is PROVEN. ${sh.peakCode || 'One card'} came out a seventh time at `
        + `hand #${sh.lastBreak}, and a six-deck shoe holds six of each. ${sh.segments - 1} `
        + `break${sh.segments === 2 ? '' : 's'} so far, and the count above restarts at each one. `
        + `If breaks land every hand or two, this table is not dealing you a persistent shoe and `
        + `the count is noise — which is worth knowing and is exactly what this test is for.`));
    } else {
      ev2.append(el('b', null, 'No reshuffle proven yet. '));
      ev2.append(document.createTextNode(
        `The most any one card has been seen is ${sh.peak}${sh.peakCode ? ' (' + sh.peakCode + ')' : ''}`
        + ` and seven would be impossible in six decks. That is consistent with a persistent shoe `
        + `and PROVES NOTHING — the test only ever fires in one direction, and at five to eight `
        + `cards a round it needs tens of rounds to fire at all.`));
    }
    body.append(ev2);

    const t = el('table', 'pkbj-tbl');
    const cols = el('colgroup');
    for (const cls of ['c-id', 'c-a', 'c-b', 'c-c']) cols.append(el('col', cls));
    t.append(cols);
    const thead = el('thead');
    const hr = el('tr');
    for (const k of ['rank', 'seen', 'left', 'of shoe']) hr.append(el('th', null, k));
    thead.append(hr);
    t.append(thead);
    const tb = el('tbody');
    const left = sh.comp.reduce((a, b) => a + b, 0);
    const fresh = freshShoe();
    for (let r = 0; r < 10; r++) {
      const tr = el('tr');
      tr.append(el('td', null, RANKS[r]));
      tr.append(el('td', null, String(sh.byRank[r] || 0)));
      tr.append(el('td', null, String(sh.comp[r])));
      const share = left ? sh.comp[r] / left : null;
      const base = fresh[r] / SHOE_SIZE;
      tr.append(el('td', share === null ? null : (share > base ? 'up' : (share < base ? 'down' : null)),
        share === null ? '—' : pct(share, 1)));
      tb.append(tr);
    }
    t.append(tb);
    body.append(t);

    body.append(el('div', 'pkbj-note',
      'Three limits ride with every number above and none of them goes away. You only ever see '
      + 'YOUR table: if anyone else draws from this shoe the count is wrong by everything you '
      + 'did not see, and nothing on the wire says whether they do. The hole card is face down '
      + 'while you act, so a card in play is not yet counted, and a round that ends before the '
      + `reveal never contributes it — ${sh.hidden} face-down card${sh.hidden === 1 ? ' has' : 's have'} `
      + 'gone unseen so far. And a count is only a proxy: this tool solves against the '
      + 'composition itself, so nothing here is derived from the count at all.'));
  };

  const renderMoney = (v) => {
    if (!v.roll.reconciles && v.roll.n) {
      body.append(el('div', 'pkbj-warn',
        'gross − tax does not equal net on these receipts. Every figure below assumes it does, '
        + 'so treat them as unreliable and check docs/19-casino-blackjack-surface.md.'));
    }

    const bar = el('div', 'pkbj-bar');
    bar.append(el('span', 'pkbj-lbl', 'stake'));
    const stakeIn = el('input', 'pkbj-in');
    stakeIn.type = 'number';
    stakeIn.value = v.stake == null ? '' : String(Math.round(v.stake));
    stakeIn.placeholder = v.seed == null ? 'set' : String(Math.round(v.seed));
    stakeIn.title = 'what you had when you sat down — the wire does not say, so this is yours to set';
    const commit = () => {
      const n = Number(stakeIn.value);
      if (stakeIn.value === '') delete ui.stake[v.id];
      else if (Number.isFinite(n)) ui.stake[v.id] = n;
      saveUI();
      render();
    };
    stakeIn.addEventListener('change', commit);
    bar.append(stakeIn, el('span', 'pkbj-n', v.stakeNote));
    body.append(bar);

    const g = el('div', 'pkbj-stats');
    stat(g, 'net', signed(v.roll.net), v.roll.net > 0 ? 'up' : (v.roll.net < 0 ? 'down' : null),
      `${v.roll.n} round${v.roll.n === 1 ? '' : 's'}`);
    stat(g, 'staked', money(v.roll.wagered), null,
      v.roll.stakeMult === null ? null : `${v.roll.stakeMult.toFixed(2)}× your bets`);
    stat(g, 'tax paid', money(v.roll.tax), v.roll.tax ? 'down' : null,
      `${v.roll.taxed} taxed round${v.roll.taxed === 1 ? '' : 's'}`);
    stat(g, 'won / pushed', `${v.roll.wins} / ${v.roll.pushes}`, null,
      `${v.roll.losses} lost, ${v.roll.naturals} natural${v.roll.naturals === 1 ? '' : 's'}`);
    body.append(g);

    // Computed, measured and the gap between them, kept in that order and never
    // averaged into one number.
    const g2 = el('div', 'pkbj-stats');
    stat(g2, 'edge, perfect play', v.edge === null ? '—' : pct(v.edge, 3), null,
      v.edge === null ? 'not solved yet — see PLAN' : 'computed from the rules');
    stat(g2, 'tax drag', pct(v.roll.taxDrag, 3), v.roll.taxDrag ? 'down' : null, 'measured');
    stat(g2, 'effective edge', pct(v.effEdge, 3), null,
      v.edge === null ? 'needs the solve' : 'computed + measured');
    stat(g2, 'realized edge', pct(v.roll.realizedEdge, 2),
      num(v.roll.realizedEdge) === null ? null : (v.roll.realizedEdge > 0 ? 'down' : 'up'),
      'what actually happened');
    body.append(g2);

    body.append(drawChart(curveOf(v.asc, v.stake, v.effEdge)));

    // What your own play cost, which is the one number on this surface that is about
    // you rather than about the table.
    const d = v.dec;
    const g3 = el('div', 'pkbj-stats');
    stat(g3, 'decisions seen', String(d.n), null, 'inferred');
    stat(g3, 'played the max', d.rate === null ? '—' : pct(d.rate, 0), null,
      `${d.matched} of ${d.n}`);
    stat(g3, 'given up', d.n ? (d.cost > 0 ? signed(-d.cost) : money(0)) : '—', d.cost > 0 ? 'down' : null,
      'ev, at the stakes you played');
    body.append(g3);

    body.append(el('div', 'pkbj-note',
      'The dashed line is what perfect play plus the measured tax drag says this run should have '
      + 'cost; the gap to your line is the luck. "Decisions" are INFERRED from consecutive states '
      + 'of a hand — the wire never says what you pressed — and an ambiguous transition is '
      + 'recorded as nothing rather than as a guess. Each is priced against the TABLE shoe: a '
      + 'fresh six-deck shoe less the cards that were face up at the time, never the counted one, '
      + 'so an old answer never moves when the shoe does. That is a shade sharper than the '
      + 'printed strategy table and can disagree with it — a sixteen built out of three small '
      + 'cards sits in a shoe those cards have made ten-rich, and standing it can price higher '
      + 'than hitting it. Which is why the line above says you played the MAX rather than that '
      + 'you played it by the book.'));
  };

  const renderPlan = (v) => {
    const p = ui.planner;
    const cfg = v.cfg;
    const bar = el('div', 'pkbj-bar');
    const mk = (key, label, fallback) => {
      bar.append(el('span', 'pkbj-lbl', label));
      const inp = el('input', 'pkbj-in');
      inp.type = 'number';
      inp.value = p[key] == null ? '' : String(p[key]);
      inp.placeholder = fallback == null ? '' : String(fallback);
      inp.addEventListener('change', () => {
        const n = Number(inp.value);
        if (inp.value === '') delete p[key];
        else if (Number.isFinite(n)) p[key] = n;
        saveUI();
        render();
      });
      bar.append(inp);
      return inp;
    };
    mk('bet', 'bet', num(cfg.min) ?? 100);
    mk('rounds', 'rounds', 50);
    body.append(bar);

    const bet = num(p.bet) ?? num(cfg.min);
    const rounds = num(p.rounds) ?? 50;

    // The four bounds on a bet, three of which the page states and one of which it
    // only ever expresses by greying out a button.
    if (v.bounds) {
      const gb = el('div', 'pkbj-stats');
      stat(gb, 'table', `${money(v.bounds.min)}–${money(cfg.max)}`, null,
        'in steps of ' + money(v.bounds.step));
      stat(gb, 'house covers', money(num(cfg.reserve) === null ? null : cfg.reserve / COVER_MULT),
        null, 'reserve ÷ 4');
      stat(gb, 'max bet now', money(v.bounds.max), null, 'held by ' + v.bounds.why);
      body.append(gb);
    }

    const res = plan({
      bet, rounds, edge: v.edge, drag: v.roll.taxDrag, bankroll: v.now,
      sd: v.sd, sdN: v.sdN, mult: v.roll.stakeMult,
    });

    if (v.edge === null) {
      const w = el('div', 'pkbj-scope');
      w.append(el('b', null, 'The edge is not solved yet. '));
      w.append(document.createTextNode(
        'This table advertises no RTP and no edge — the number has to be worked out from the '
        + 'rules by summing over every possible deal. It locks the tab up for a second or two '
        + 'while it runs, once, and is then kept forever because the rules do not change.'));
      body.append(w);
      const b = el('button', 'pkbj-btn', 'solve the edge (~2s)');
      b.title = 'sums over all 550 opening deals — the tab is frozen while it runs, once';
      b.addEventListener('click', () => {
        b.disabled = true;
        // Deliberately synchronous and deliberately behind a deliberate click. A second of
        // arithmetic once in the life of an install is not worth a scheduler, and a
        // scheduler is the thing this repo does not put in a passive tool. Nothing is
        // painted between the disable and the result — a "solving…" label here would be a
        // lie the browser never gets a frame to tell, which is why the cost is on the
        // button instead, before you press it.
        const r = roundEV(freshShoe());
        if (r) { data.edge = { key: EDGE_KEY, edge: r.edge, deals: r.deals, at: Date.now() }; saveData(); }
        render();
      });
      body.append(b);
    } else if (res) {
      const g = el('div', 'pkbj-stats');
      stat(g, 'you will stake', money(res.staked), null,
        `${rounds} × ${money(bet)} × ${res.mult.toFixed(2)}`);
      stat(g, 'expected loss', money(res.expLoss), 'down', 'perfect play, before tax');
      stat(g, 'with tax drag', money(res.expLossEff), 'down',
        num(v.roll.taxDrag) === null ? 'no drag measured yet' : 'computed + measured');
      stat(g, 'bankroll after', money(res.expAfter), null, 'if it goes to plan');
      body.append(g);

      const g2 = el('div', 'pkbj-stats');
      stat(g2, 'cover', res.cover === null ? '—' : String(res.cover), res.coversRun ? null : 'down',
        'rounds if you never win');
      stat(g2, '± 1 sd', res.band === null ? '—' : money(res.band), 'est',
        res.bandN < 30 ? `only ${res.bandN} rounds sampled` : `${res.bandN} rounds sampled`);
      body.append(g2);

      body.append(el('div', 'pkbj-note',
        'Expected loss is exact arithmetic on the solved edge — but only if every hand is played '
        + 'at the maximum, which is what MONEY measures and mostly is not what happens. The '
        + 'staking multiplier is measured from your own rounds: splits and doubles put more than '
        + 'your opening bet at risk. "Cover" assumes nothing at all. The band is the sample '
        + 'deviation of YOUR results and is a band, never a probability — this tool will not '
        + 'quote you a risk of ruin, because it does not know one.'));
    }

    // The grid. Derived, not typed in — which is the point, because against a counted
    // shoe it is basic strategy with the deviations already folded in.
    const gbar = el('div', 'pkbj-bar');
    const FRESH_KEY = compKey(freshShoe());
    const gb = el('button', 'pkbj-btn', gridCache && gridCache.key === compKey(v.comp)
      ? 'redraw the grid' : 'solve the grid for this shoe (~2s)');
    gb.title = '350 hands against 10 up cards — the tab is frozen while it runs';
    gb.addEventListener('click', () => {
      gb.disabled = true;
      const key = compKey(v.comp);
      gridCache = { key, grid: gridOf(v.comp), mode: ui.shoe };
      // The fresh grid is what the outlines are measured against, and solving it is the
      // same work again. When the shoe in front of you IS a fresh one — no hand dealt, or
      // TABLE mode between rounds — the two are the same grid, so it is taken rather than
      // recomputed. That is the difference between one freeze and two.
      if (!freshGrid) freshGrid = key === FRESH_KEY ? gridCache.grid : gridOf(freshShoe());
      render();
    });
    gbar.append(gb);
    if (gridCache) {
      const clear = el('button', 'pkbj-btn', 'hide');
      clear.addEventListener('click', () => { gridCache = null; render(); });
      gbar.append(clear);
    }
    body.append(gbar);

    if (gridCache && freshGrid) {
      const draw = (name, rows, base) => {
        const t = el('table', 'pkbj-grid');
        const thead = el('thead');
        const hr = el('tr');
        hr.append(el('th', null, name));
        for (const r of RANKS) hr.append(el('th', null, r));
        thead.append(hr);
        t.append(thead);
        const tb = el('tbody');
        rows.forEach((row, ri) => {
          const tr = el('tr');
          tr.append(el('td', null, row.label));
          row.row.forEach((a, ci) => {
            const td = el('td', a ? LETTER[a].toLowerCase() : null, a ? LETTER[a] : '·');
            const was = base[ri] && base[ri].row[ci];
            if (a && was && a !== was) {
              td.classList.add('dev');
              td.title = `basic strategy says ${WORD[was]}; this shoe says ${WORD[a]}`;
            }
            tr.append(td);
          });
          tb.append(tr);
        });
        t.append(tb);
        body.append(t);
      };
      draw('HARD', gridCache.grid.hard, freshGrid.hard);
      draw('SOFT', gridCache.grid.soft, freshGrid.soft);
      draw('PAIR', gridCache.grid.pair, freshGrid.pair);
      body.append(el('div', 'pkbj-note',
        'H hit · S stand · D double · P split. Solved against the '
        + `${gridCache.mode} shoe, not looked up: on a fresh shoe this IS basic strategy, and an `
        + 'outlined cell is where the shoe in front of you disagrees with it. A cell only ever '
        + 'reflects the composition, never a count index.'));
    }
  };

  const renderLog = (v) => {
    const bar = el('div', 'pkbj-bar');
    const markBtn = el('button', 'pkbj-btn', 'clear');
    markBtn.title = 'start the figures at your next hand — nothing is deleted';
    markBtn.disabled = !v.newest;
    markBtn.addEventListener('click', () => {
      if (!v.newest) return;
      ui.mark[v.id] = v.newest;
      saveUI();
      render();
    });
    const allBtn = el('button', 'pkbj-btn' + (v.floor === null ? ' on' : ''), 'all');
    allBtn.addEventListener('click', () => { delete ui.mark[v.id]; saveUI(); render(); });
    bar.append(markBtn, allBtn);

    const copy = el('button', 'pkbj-btn', 'copy');
    copy.addEventListener('click', () => {
      const rows = [['id', 'staked', 'gross', 'tax', 'net', 'result', 'seen'].join('\t')];
      for (const h of v.list) {
        rows.push([h.id, h.total ?? '', h.gross ?? '', h.tax ?? '', h.net ?? '',
          netOf(h) ?? '', new Date(h.seen).toISOString()].join('\t'));
      }
      navigator.clipboard.writeText(rows.join('\n')).then(() => {
        copy.textContent = 'copied';
        setTimeout(() => { copy.textContent = 'copy'; }, 1200);
      }, () => { copy.textContent = 'blocked'; });
    });
    bar.append(copy, el('span', 'pkbj-n', `${v.held} held`));
    body.append(bar);

    if (!v.held) {
      body.append(el('div', 'pkbj-empty', 'no hands seen at this table yet'));
      return;
    }

    const t = el('table', 'pkbj-tbl');
    const cols = el('colgroup');
    for (const cls of ['c-id', 'c-a', 'c-b', 'c-c', 'c-d', 'c-e']) cols.append(el('col', cls));
    t.append(cols);
    const thead = el('thead');
    const hr = el('tr');
    for (const k of ['hand', 'staked', 'gross', 'tax', 'result', 'seen']) hr.append(el('th', null, k));
    thead.append(hr);
    t.append(thead);

    const tb = el('tbody');
    for (const h of v.list.slice(0, 120)) {
      const n = netOf(h);
      const tr = el('tr', h.status === 'player_turn' ? 'live' : null);
      const idCell = el('td', null, '#' + h.id);
      idCell.title = (h.outcome || h.status || '') + ' · '
        + (h.hands || []).map((p) => (p.cards || []).join(' ')).join('  |  ')
        + '  vs  ' + (h.dealer || []).join(' ');
      tr.append(idCell);
      tr.append(el('td', null, money(h.total)));
      tr.append(el('td', null, money(h.gross)));
      tr.append(el('td', h.tax ? 'down' : null, money(h.tax)));
      tr.append(el('td', n === null ? null : (n > 0 ? 'up' : (n < 0 ? 'down' : null)),
        n === null ? '—' : signed(n)));
      const seenCell = el('td', null, clock(h.seen));
      seenCell.title = 'when this tool first saw the hand — the wire carries no timestamp';
      tr.append(seenCell);
      tb.append(tr);
    }
    t.append(tb);
    body.append(t);
    body.append(el('div', 'pkbj-note',
      'Hover a hand id for the cards it was played with. "Seen" is when this tool first read the '
      + 'hand, not when it was played: nothing on this surface carries a timestamp, so ordering '
      + 'is by hand id and that is the only ordering the wire gives.'));
  };

  // ---------------------------------------------------------------------------
  // 12. Render.
  // ---------------------------------------------------------------------------

  function render() {
    // The one place the panel's display is written, so the button's own state is set
    // here too and above the early return — a closed panel must not leave a lit button
    // behind it.
    panel.style.display = ui.open ? 'flex' : 'none';
    fab.classList.toggle('pk-open', ui.open);

    const v = view();
    const n = v ? v.roll.net : 0;
    const waiting = !!(v && v.live);
    fab.classList.toggle('live', waiting);
    fab.classList.toggle('up', !waiting && !!v && v.roll.n > 0 && n > 0);
    fab.classList.toggle('down', !waiting && !!v && v.roll.n > 0 && n < 0);
    fab.title = waiting
      ? 'Jack Watch — a hand is waiting on you'
      : (v && v.roll.n
        ? `Jack Watch — ${signed(n)} over ${v.roll.n} round${v.roll.n === 1 ? '' : 's'}`
          + (v.floor === null ? '' : ` since #${v.floor}`)
        : 'Jack Watch — the blackjack table, solved');

    if (!ui.open) return;

    for (const name in tabBtn) tabBtn[name].classList.toggle('on', ui.tab === name);
    body.replaceChildren();

    if (!v) {
      subtitle.textContent = '';
      body.append(el('div', 'pkbj-empty',
        'nothing seen yet. Walk into a casino and open the blackjack table — the config and the '
        + 'hand history the game fetches on arrival land here by themselves. This tool asks '
        + 'politiko.io for nothing.'));
      drag.fit();
      return;
    }

    const tables = known();
    const where = tables.length > 1 ? `table ${v.id} of ${tables.length}` : `table ${v.id}`;
    subtitle.textContent = v.floor === null ? where : `${where} · from #${v.floor}`;

    if (v.cfg.suspended) {
      body.append(el('div', 'pkbj-warn', 'This casino has an unpaid regulatory fine — new hands are suspended.'));
    } else if (v.cfg.live === false) {
      body.append(el('div', 'pkbj-warn', 'This casino has no casino-type property; the table is not operational.'));
    } else if (v.cfg.access === false) {
      body.append(el('div', 'pkbj-warn', 'You are not in a city with one of this casino\'s venues.'));
    } else if (v.cfg.dealers === 0 && !v.live) {
      body.append(el('div', 'pkbj-warn', 'Every dealer at this casino is busy — the table will not take a new hand.'));
    }

    // Said once, above whichever tab is up, rather than three times inside them.
    if (v.floor !== null) {
      body.append(el('div', 'pkbj-scope',
        `Showing this run only — ${v.roll.n} round${v.roll.n === 1 ? '' : 's'} after `
        + `#${v.floor}, with ${v.hidden} held behind it. LOG's "all" brings them back. The count `
        + 'is not scoped by a mark: a mark hides money, it cannot un-deal a card.'));
    }

    if (ui.tab === 'HAND') renderHand(v);
    else if (ui.tab === 'COUNT') renderCount(v);
    else if (ui.tab === 'MONEY') renderMoney(v);
    else if (ui.tab === 'PLAN') renderPlan(v);
    else renderLog(v);

    drag.fit();       // a taller body must never push the drag handle off screen
  }

  // ---------------------------------------------------------------------------
  // 13. SPA lifecycle. React Router means no page loads, so the only way to know
  //     which table is in front of you is to watch the path.
  // ---------------------------------------------------------------------------
  const ROUTE = /^\/corporations\/(\d+)\/casino\/blackjack\b/;

  let lastPath = null;
  const checkRoute = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    const m = ROUTE.exec(lastPath);
    if (m) { active = m[1]; repaint(); }
  };

  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) { const r = orig.apply(this, a); queueMicrotask(checkRoute); return r; };
  }
  window.addEventListener('popstate', checkRoute);

  // ---------------------------------------------------------------------------
  // 14. Boot.
  // ---------------------------------------------------------------------------
  const boot = () => {
    document.head.append(style);
    document.body.append(fab, panel);

    // A hidden element has no geometry, so a stored size is applied on first open
    // rather than at mount — otherwise the clamp has nothing to measure against.
    let restored = false;
    const restore = () => {
      if (restored || !ui.open) return;
      restored = true;
      drag.apply(ui);
      size.apply(ui.size);
      drag.fit();
    };
    fab.addEventListener('click', restore);
    if (ui.open) queueMicrotask(restore);

    // The whole of this tool's contact with the network: it asks the shared tap for
    // one path prefix and reads what the game already brought back.
    onApi('/api/corporations/', consume);

    checkRoute();
    render();
    log('ready, ledger holds', known().reduce((a, id) => a + handsOf(id).length, 0), 'hand(s)');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
