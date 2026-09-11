// ==UserScript==
// @name         Politiko — Jack Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.12.0
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
 *             Since 0.8.0 it also keeps a TRAIL for rounds it watched unfold: the state of
 *             the table each time that state changed, with the local clock time. That is a
 *             record of your own pace of play, so it is named here rather than buried —
 *             what was on the table, whose turn it was, the stakes, the menu on offer, and
 *             when. It stores no conclusion about any of it: no action is named, nothing
 *             is scored, and the decisions on screen are still replayed from the cards.
 *             Recording stops when the round settles, so the fifteen-second poll re-sending
 *             a finished hand adds nothing. Capped at 16 sightings per round and dropped
 *             entirely for rounds older than the most recent 120. Rounds read off the history poll get NO trail, because
 *             they were played before this tool was looking and any timestamp on them
 *             would be invented. It leaves your browser only through "copy+" or "save".
 *
 *   Downloads: "save" in LOG writes the same JSON that "copy+" produces to a file, through
 *             the browser's own download path, from a Blob built in the page. Nothing is
 *             transmitted and no destination is named — it exists so that a large export
 *             does not have to go through the clipboard.
 *
 *   Page:     since 0.10.0, with the "guide" switch ON, it marks the action to press on
 *             the blackjack table itself — the right button ringed in green, the worst
 *             press dimmed and dashed in red — so the answer is where your eyes already
 *             are rather than in a panel in the margin. It adds no request.
 *
 *             Since 0.12.0 that mark is drawn ON A LAYER OVER THE GAME'S CANVAS, because
 *             the table is a canvas: its buttons are painted pixels with no element under
 *             them, which is why the DOM-reading version of this never found them. The
 *             layer is this tool's own element, sitting above the canvas and never inside
 *             the game's DOM. It reads the canvas's SIZE AND POSITION and nothing else —
 *             no drawing context is ever requested and no pixel is ever read back, and
 *             tools/test-jack-passive.js fails the build if getContext, toDataURL or
 *             getImageData appears in this file. Where the buttons are is then arithmetic
 *             on the game's own layout, and WHICH buttons are there comes from the
 *             server's allowed_actions, which this tool already has. The older reader that
 *             looks for HIT / STAND / DOUBLE / SPLIT on real elements is still here and
 *             still runs when the page has no felt on it.
 *
 *             It CANNOT PRESS THEM, and over a canvas it is further from doing so than it
 *             ever was: the layer is pointer-events: none, so it cannot even receive a
 *             click, let alone forward one. There is no .click() on anything it finds, no
 *             synthesised mouse, pointer or keyboard event, and nothing driven through
 *             focus or requestSubmit — the single .click() in this file is the export
 *             anchor, which touches no game UI. tools/test-jack-passive.js counts them and
 *             fails the build on a second one. Nothing the game drew is restyled, moved or
 *             resized; the marks are a separate layer above it. The switch is OFF until
 *             you turn it on, and the panel prints what it located so a guide that matches
 *             nothing says so rather than leaving an absence to be read as an answer.
 *
 *   Advice:   the panel names the best action and prices every other one. It says nothing
 *             about HOW MUCH to bet, and that is deliberate rather than missing: at this
 *             table's 0.4593% house edge the stake that maximises a bankroll is zero, so
 *             any recommended size would be a fiction. HAND reports the exposure instead —
 *             what fraction of your bankroll the bet is, what the round could stake in the
 *             worst case the rules allow (four times the opener), and how many more bets
 *             that size your cash covers. No risk of ruin and no probability of anything
 *             is offered; see docs/19 for why a percentage on this distribution would be
 *             worst where it was most wanted.
 *
 *   Alerts:   none. No notifications, no sound, no title or favicon writes, nothing raised
 *             from an unfocused tab. The panel is in-page and that is all — including the
 *             loudest thing in it, which is HAND naming the worst button on the menu and
 *             what pressing it gives up. That is drawn on every solved hand rather than
 *             above some threshold, so it never fires and never stops firing; it is a
 *             repaint of a panel you are already looking at, nothing more.
 *
 *   Clipboard: written ONLY when you click one of the two buttons in LOG that say so.
 *             "copy" writes the ledger as TSV. "copy+" writes the same rounds as JSON,
 *             with the split hands kept nested, the action menu the server offered, the
 *             replayed decisions, and the reason any round has none. Both are the rounds
 *             already on your screen; neither adds a request, and nothing is transmitted
 *             anywhere — the clipboard is where it stops.
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

  // Stamped into the JSON export so a bundle pasted somewhere months later still says
  // which build produced it. Deliberately outside the engine markers below: the engine is
  // lifted whole by tools/test-jack-ev.js and must reference nothing it was not handed,
  // so exportBundle takes this as an argument rather than reaching for it.
  const SCRIPT_VERSION = '0.12.0';

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

  // The most a round can end up staking, in units of the opening bet, derived from the
  // rules rather than written down as a 4. One split makes two hands, and doubling after
  // a split is allowed, so each of those two can be doubled: 2 x 2. If the operator ever
  // reads a table that permits two splits, or forbids DAS, this follows without an edit.
  //
  // It is a ceiling and not a forecast. Measured across real play the multiplier sits near
  // 1.1, which is exactly why nobody has the ceiling in mind when they size a bet — and
  // why exposure() prints it.
  const MAX_STAKE_MULT = (RULES.splits + 1) * (RULES.doubleAfterSplit ? 2 : 1);

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

  // --- what a press is worth getting right ----------------------------------
  //
  // The best action on the menu, the WORST one, and the distance between them per $1
  // already on the hand. The hand that produced this function was an eleven against a ten
  // that got STOOD: 0.720 units on a $100k bet, about $72,000, the most expensive press in
  // a 41-hand ledger. The right action was on screen the whole time. What was missing
  // beside it was the size of the mistake, so this returns that, and HAND prints it.
  //
  // There is deliberately no threshold here, and the reason is worth keeping because the
  // obvious design does not survive being measured. Tiering the panel's loudness on this
  // gap — shout above some number, stay quiet below it — was tried first and dropped:
  // over every opening deal, weighted by how often it is actually dealt, best-to-worst
  // clears 0.6 on 45.7% of hands, and its top decile is not close calls at all but pat
  // hands, where the "mistake" being priced is hitting a twenty. Shouting on half the
  // hands, most loudly at the ones nobody misplays, is a colour you stop seeing. The
  // alternative statistic fails from the other end: second-best-to-worst puts the eleven
  // that started this at about the 80th percentile, unremarkable. Neither isolates the
  // hands people get wrong, because whether a button is tempting is not a property of the
  // cards — it is a property of the person, and this tool cannot see one. The table is in
  // docs/19-casino-blackjack-surface.md.
  //
  // So the loudness is structural rather than conditional: name the worst button, every
  // time, and let a figure in dollars be as alarming as the figure actually is. $720 does
  // not need red to read as small, and $72,012 does not need red to read as large.
  const pressCost = (ev, stake) => {
    const keys = Object.keys(ev || {}).filter((a) => num(ev[a]) !== null);
    if (keys.length < 2) return null;          // one button, or none, is not a decision
    let best = keys[0], worst = keys[0];
    for (const a of keys) {
      if (ev[a] > ev[best]) best = a;
      if (ev[a] < ev[worst]) worst = a;
    }
    const gap = ev[best] - ev[worst];
    const s = num(stake);
    return { best, worst, gap, cash: s === null ? null : gap * s };
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
    let played = 0, sinceBreak = 0;      // rounds, not hand ids — see below
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
      played++;
      // The GAP is the measurement, not the break. Every shoe policy breaks this test
      // eventually — a persistent shoe breaks it too, because this walk keeps counting
      // across a real reshuffle it cannot see — so a break on its own says nothing about
      // which policy is running. How far apart they land does.
      //
      // Counted in ROUNDS THIS LEDGER HOLDS, never in hand ids, and the reason is about
      // this tool rather than about the wire. Ids look usable — 51 rounds of real play
      // came back as 339..389 with no gaps at all, so the sequence appears to be the
      // player's own — but the LEDGER is what has holes in it: hands played before you
      // installed this, hands the history array had already dropped, hands the cap pruned.
      // An id difference would count those; a round is a thing this tool actually saw,
      // and the cadence being measured is a cadence of observations.
      if (overflows) {
        breaks.push({ id: h.id, after: sinceBreak });
        segments++; sinceBreak = 0; reset();
      }
      sinceBreak++;
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
    // Gaps between breaks, oldest first. The first entry is how many rounds this ledger
    // held before its first break, which is a floor rather than a gap — the tool was not
    // watching before you installed it — so it is dropped from the summary.
    const gaps = breaks.slice(1).map((b) => b.after);
    return {
      comp, byRank, cards, hidden, segments, breaks, gaps,
      played, sinceBreak: sinceBreak - 1,
      peak, peakCode,
      proven: breaks.length > 0,
      lastBreak: breaks.length ? breaks[breaks.length - 1].id : null,
      count: countOf(byRank, cards),
      // What the cadence looks like, when there is enough of it to have a shape. Both
      // numbers matter and the spread matters more: a break that is a coincidence lands
      // raggedly, a break that is a real shuffle cycle lands like clockwork.
      gapMean: gaps.length ? mean(gaps) : null,
      gapMin: gaps.length ? Math.min(...gaps) : null,
      gapMax: gaps.length ? Math.max(...gaps) : null,
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
    // `next` is a fresh slimHand and never carries one, so a plain spread would drop it.
    // Explicit rather than incidental: the trail is the only thing here that cannot be
    // rebuilt from a later sighting, because it is a record of earlier ones.
    if (old.trail) out.trail = old.trail;
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
  // The dealer's up card is the first one that is not face down.
  const upOf = (h) => {
    for (const c of h.dealer || []) { const r = rankOf(c); if (r !== null) return r; }
    return null;
  };

  // Replay a settled round's decisions out of the cards themselves.
  //
  // 0.4.0 and earlier inferred each decision from two consecutive states of a live hand,
  // which works but only ever sees hands played while the tool is watching AND only when
  // it catches every transition. Measured against 81 real rounds, that caught 3 decisions
  // where the stored cards held 115 — the whole back-catalogue that history hands over
  // free on the first poll was sitting there unread.
  //
  // A settled hand does not need inferring. The card list is in DRAW order, which is not
  // an assumption: across 81 rounds and 447 cards, no proper prefix of any hand — player
  // or dealer — busts, and under any other ordering that would happen constantly. So the
  // hand is simply walked, and each step is priced against the shoe as it stood then.
  //
  // Three shapes carry no decision at all and have to be dropped, or they replay as
  // nonsense:
  //
  //   the DEALER had a natural — the round was over before you could act. Five of the 81,
  //     and every one of them came out as "you stood on 8 against an ace" until they were
  //     excluded. That is the failure mode this whole function is one bug away from, and
  //     it is why the exclusions are checked before anything is recorded.
  //   YOU had a natural — paid immediately, nothing to decide.
  //   the round was SPLIT — which half took which card is not recoverable from the wire,
  //     so a split round contributes nothing rather than a guess.
  //
  // Priced against the TABLE composition — a fresh shoe less the cards face up at that
  // moment — and deliberately never against the counted one: "did you play it right" is a
  // question about that moment, and pricing it against a shoe state that keeps moving
  // would make yesterday's answer move with it.
  //
  // Worth knowing that this is a shade sharper than the printed strategy table and will
  // sometimes disagree with it. A sixteen made of three small cards is sitting in a shoe
  // those three cards have just made ten-rich, and standing it can price higher than
  // hitting it — a real result, not a bug, and why the panel says you played the MAX
  // rather than that you played it by the book.
  // Why a round carries no decisions, or null if it carries some. This is the gate
  // `replayHand` runs on, lifted out so it can be asked as a question rather than only
  // acted on — the export prints the reason per round, and a round that contributes
  // nothing to the decision ledger stops being indistinguishable from one that was
  // played perfectly. It is the same list of conditions in the same order, in one place,
  // because two copies of a bail list are two answers waiting to disagree.
  //
  // `split` is the one worth staring at. Which half of a split took which card is not on
  // the wire, so the replay cannot walk it — and splits are where the expensive mistakes
  // live. A ledger that silently omits them reads as "you played fine" when the truth is
  // "nobody looked". Naming the reason is what makes that visible in an export.
  const replayNote = (h) => {
    if (!h || h.status !== 'settled') return 'unsettled';
    const hands = h.hands || [];
    if (hands.length !== 1) return 'split';            // a split cannot be replayed
    const cards = (hands[0].cards || []).filter((c) => rankOf(c) !== null);
    if (cards.length < 2) return 'no cards';
    if (upOf(h) === null) return 'no up card';
    if (handOf(h.dealer || []).natural) return 'dealer natural';   // you never got to act
    if (handOf(cards.slice(0, 2)).natural) return 'player natural'; // nothing to decide
    const bet = num(h.open) ?? num(h.total);
    if (bet === null || bet <= 0) return 'no bet';
    return null;
  };

  const replayHand = (h) => {
    if (replayNote(h)) return [];
    const cards = (h.hands[0].cards || []).filter((c) => rankOf(c) !== null);
    const up = upOf(h);
    const bet = num(h.open) ?? num(h.total);
    // A double takes exactly one card, so it is the only way to stake twice the bet on a
    // three-card hand. Splits are already gone above, which is what makes that unambiguous.
    const doubled = num(h.total) === 2 * bet && cards.length === 3;
    const out = [];
    for (let k = 2; k <= cards.length; k++) {
      const held = cards.slice(0, k);
      const hand = handOf(held);
      if (hand.bust) break;                            // the bust ends it; the hit is recorded
      const first = k === 2;
      const act = k < cards.length ? (doubled && first ? 'double' : 'hit') : 'stand';
      const allowed = ['hit', 'stand'];
      if (first) allowed.push('double');
      if (first && rankOf(held[0]) === rankOf(held[1])) allowed.push('split');
      const { comp } = without(freshShoe(), [...held, h.dealer[0]]);
      const s = solve(held, up, comp, allowed);
      if (!s || !s.pick) break;
      const got = num(s.ev[act]);
      if (got === null) break;
      out.push({
        id: h.id, act, want: s.pick, ev: got, bestEV: s.ev[s.pick],
        // Cost is per dollar of the OPENING bet, so a mistake on a doubled hand is priced
        // once rather than twice — the double is itself one of the decisions being judged.
        cost: (s.ev[s.pick] - got) * bet, stake: bet,
      });
      if (act !== 'hit') break;                        // stand and double both end the hand
    }
    return out;
  };

  const decisionRoll = (list) => {
    let n = 0, matched = 0, cost = 0;
    for (const d of list) { n++; if (d.act === d.want) matched++; cost += num(d.cost) ?? 0; }
    return { n, matched, cost, rate: n ? matched / n : null };
  };

  // --- was that luck? -------------------------------------------------------
  //
  // How far the run sits from where the solved edge says it should — the one question
  // MONEY could not answer, and the first thing anybody asks after a good night. Fifty-one
  // real rounds finishing $143,000 up looks like a system until you notice that the same
  // fifty-one rounds have a cash deviation of nearly $300,000 under them.
  //
  // The spread is YOURS: the sample deviation of your own per-round results, applied to the
  // amounts you actually bet, so this is an ESTIMATE and carries its sample count. It comes
  // back as a distance in deviations and is never turned into a probability, for the same
  // reason slot-watch will not quote a risk of ruin — the per-round distribution here is
  // not remotely normal (a natural pays 1.5, a split that doubles both halves pays 4) and a
  // normal approximation is worst in exactly the tail somebody would want it for. A
  // distance is honest; a percentage hung on it would not be.
  const runDeviation = (list, edge, sd) => {
    const s = num(sd), e = num(edge);
    if (s === null || e === null || !(s > 0)) return null;
    let staked = 0, pnl = 0, sq = 0, n = 0;
    for (const h of list) {
      const nt = netOf(h);
      if (nt === null) continue;
      // The sample is per dollar of OPENING bet, so the cash spread has to be built out of
      // opening bets too — mixing in the doubled total would inflate it by the same rounds
      // twice over.
      const unit = num(h.open) ?? num(h.total);
      if (unit === null) continue;
      staked += h.total; pnl += nt; sq += (unit * s) * (unit * s); n++;
    }
    const cashSD = Math.sqrt(sq);
    if (!n || !(cashSD > 0)) return null;
    const expected = -staked * e;
    return { n, pnl, expected, cashSD, over: pnl - expected, z: (pnl - expected) / cashSD };
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

  // --- reading a button's label -------------------------------------------
  //
  // The pure half of the on-button guide. Given the text on a control, which action is it?
  // Matched on WORDS rather than on any class, because a generated class name is a hash
  // that changes every deploy and this has to still work in a month (CLAUDE.md).
  //
  // Deliberately not generous. The marks are cosmetic — nothing here presses anything — so
  // a miss costs a highlight that does not appear, which is visible and diagnosable. A
  // false positive costs a highlight on the WRONG control, which is worse than none at all
  // because it is confidently wrong. So exact matches for the short words, prefixes only
  // where a table is known to pad them ("DOUBLE DOWN"), and a length ceiling so a paragraph
  // that happens to contain the word "hit" is never mistaken for a button.
  // Exact against a known set rather than a prefix. A prefix looked tidier and was wrong:
  // `startsWith('DOUBLE')` also claims "doubles", which is how a label about the game
  // becomes a highlight on the wrong control. The set is short and adding to it is a
  // one-line change guided by the count the panel prints, which is the cheap direction to
  // be wrong in.
  const BUTTON_WORDS = {
    HIT: 'hit', HITME: 'hit',
    STAND: 'stand', STAY: 'stand',
    DOUBLE: 'double', DOUBLEDOWN: 'double',
    SPLIT: 'split', SPLITHAND: 'split', SPLITPAIR: 'split',
  };
  const actionOf = (label) => {
    if (typeof label !== 'string') return null;
    const w = label.toUpperCase().replace(/[^A-Z]/g, '');
    if (!w || w.length > 20) return null;
    return BUTTON_WORDS[w] || null;
  };

  // --- where the felt draws its buttons -------------------------------------
  //
  // The table is not HTML. It is a Phaser canvas, and `renderActions` draws HIT, STAND,
  // DOUBLE and SPLIT as rectangles with text painted on top of them — there is no
  // element under any of those words. That is why the DOM finder above found nothing on
  // a real table and why no wider selector was ever going to fix it: the labels are
  // pixels. A canvas cannot be annotated by adding elements to it, so the mark goes on a
  // layer ABOVE the canvas, placed by arithmetic. market-watch draws over the game's
  // chart canvas for the same reason and in the same way.
  //
  // The arithmetic is the game's own, read off the bundle rather than guessed:
  //
  //     let a = compact ? 112 : 132,                             // button width
  //         o = compact ? 8 : 14,                                // gap
  //         s = i.length * a + Math.max(0, i.length - 1) * o;    // row width
  //     i.forEach(([n, r], i) => {
  //       let c = this.tableWidth / 2 - s / 2 + a / 2 + i * (a + o);
  //       this.renderPrimaryButton(c, compact ? 759 : 565, a, compact ? 72 : 54, ...)
  //
  // `renderPrimaryButton` builds a Phaser rectangle, and a Phaser rectangle's origin is
  // its CENTRE — so `(c, y)` is the middle of the button and not its top-left corner.
  // Getting that one fact wrong puts every mark half a button up and to the left, which
  // is the kind of wrong that still looks deliberate.
  //
  // Two things make this computed rather than assumed. The row's CONTENTS are the game's
  // fixed order filtered by the server's own `allowed_actions`, which this tool already
  // has on the wire — so a two-button row and a four-button row are told apart by data,
  // never by counting pixels. And the BASE SIZE comes off the canvas itself: Phaser's
  // FIT mode sets the backing store to the game's base size and scales it with CSS, so
  // `canvas.width` is exactly the `tableWidth` these numbers are written against, and
  // `compact` is the game's own test applied to it. Nothing here reads a media query,
  // which is what keeps this correct under a zoom, a scrollbar, or a resized pane.
  const FELT_ORDER = ['hit', 'stand', 'double', 'split'];
  // The two sizes the page mounts: 900x680, or 540x1060 under the game's own
  // `(max-width: 639px)`. Every literal above belongs to these two and to nothing else,
  // so an unrecognised canvas draws NO marks and says so, rather than marks in invented
  // places. A mark on the wrong pixel is worse than no mark at all — it is the same
  // confidently-wrong failure the label matcher is kept narrow to avoid.
  const FELT_LAYOUTS = [[900, 680], [540, 1060]];

  const feltRow = (baseW, baseH, allowed) => {
    if (!FELT_LAYOUTS.some(([w, h]) => w === baseW && h === baseH)) return null;
    const list = Array.isArray(allowed) ? FELT_ORDER.filter((a) => allowed.includes(a)) : [];
    if (!list.length) return null;
    const compact = baseW <= 540;            // the game's own `get compact()`
    const w = compact ? 112 : 132;
    const gap = compact ? 8 : 14;
    const h = compact ? 72 : 54;
    const y = compact ? 759 : 565;
    const total = list.length * w + Math.max(0, list.length - 1) * gap;
    return list.map((action, i) => ({
      action, w, h, y,
      x: baseW / 2 - total / 2 + w / 2 + i * (w + gap),
    }));
  };

  // Game space to viewport pixels. `rect` is the canvas's own box, which already carries
  // whatever letterboxing FIT left over and whatever margin autoCenter added, so a single
  // scale factor off its width is the entire transform — and the corner falls out of the
  // centre by subtracting half the box, which is the step the origin note above is about.
  const feltPlace = (b, rect, baseW) => {
    const s = rect.width / baseW;
    return {
      left: rect.left + (b.x - b.w / 2) * s,
      top: rect.top + (b.y - b.h / 2) * s,
      width: b.w * s,
      height: b.h * s,
    };
  };

  // --- what a bet actually puts at risk -------------------------------------
  //
  // This panel prices every decision to three decimal places and, until now, said nothing
  // whatsoever about the bet. A 109-round session made the case: 128 of 129 decisions were
  // the maximum, the result sat 0.49 SD from expectation — and the bankroll still fell 88%,
  // because three bets went in at 43%, 48% and 52% of everything on hand. The play was
  // fine. The exposure was the whole story, and nothing on screen mentioned it.
  //
  // Two things it must NOT do, both of which are the obvious version.
  //
  //   No risk of ruin, and no probability of anything. slot-watch refuses one for a reason
  //   that applies harder here: the per-round distribution is not remotely normal — a
  //   natural pays 1.5 and a split with both halves doubled swings four units — so a
  //   percentage hung on it would be worst in exactly the tail somebody would want it for.
  //   docs/19 has the argument. What is offered instead is arithmetic that assumes nothing:
  //   how many more bets this size your cash covers.
  //
  //   No recommended bet. At a 0.4593% disadvantage the Kelly-optimal stake is zero, so any
  //   "correct" size this could print would be a fiction dressed as advice. It reports what
  //   is at risk and lets the number be the argument, the same way HAND names the worst
  //   press in dollars rather than colouring it.
  //
  // `worst` is the part that is easy to get wrong by leaving it out. The opening bet is not
  // the exposure: one split is allowed and doubling after it is, so a round can stake FOUR
  // times what you put up, and a $200,000 opener is a $800,000 hand in the worst case the
  // rules permit. The measured multiplier on real play is about 1.1, which is exactly why
  // nobody thinks about the ceiling.
  // `live` says whether that bet is currently ON THE TABLE, and it changes the question
  // rather than decorating it. 0.9.0 got this wrong by assuming it always was.
  //
  //   Live: the stake is already out of your cash, so the bankroll it was placed from is
  //   cash + bet, and the question is retrospective — what fraction of it is riding.
  //
  //   Between rounds: the round has settled and your cash already reflects it. Adding the
  //   bet back counts it twice. It happened to look right after a LOSS, where cash + the
  //   lost stake really is what you had a moment ago, and was wrong after a win, where the
  //   winnings are in cash and the stake gets added on top. A reading that is correct on
  //   half the rounds is worse than one that is plainly one thing or the other.
  //
  // So between rounds the question becomes the forward-looking one, which is the useful one
  // anyway: bet that again and what fraction of what you have is it? A session that ended
  // at $55 with a last bet of $100 should say 182% and mean it — you cannot place that bet
  // — rather than quietly report 64% of a bankroll that no longer exists.
  const exposure = ({ bet, cash, live }) => {
    const b = num(bet), c = num(cash);
    if (b === null || c === null || b <= 0 || c < 0) return null;
    const bankroll = live ? c + b : c;
    const worst = b * MAX_STAKE_MULT;
    return {
      bet: b, cash: c, live: !!live, bankroll,
      frac: bankroll > 0 ? b / bankroll : null,
      worst,
      worstFrac: bankroll > 0 ? worst / bankroll : null,
      // Pure division, no distribution: how many more bets of this size the cash covers.
      // This one never depended on `live` and was right all along — it is the number that
      // counted 5, 4, 3, 2, 1, 0 through a real bust while the percentage beside it was
      // arguing with itself.
      covers: Math.floor(c / b),
    };
  };

  // --- the trail: what was on the table, and when ---------------------------
  //
  // 0.4.0 watched you play and stored what it concluded. 0.5.0 deleted that, and the
  // reason is the most useful thing this file has learned: measured against 81 real
  // rounds, watching caught 3 decisions where replaying the stored cards caught 109. A
  // watcher only ever sees the hands it happened to be running for; the cards are already
  // in the history the moment you look. So the decisions are replayed, and nothing here
  // is allowed to become a second answer to that question.
  //
  // This is a different question. Two things are true of the cards and will stay true
  // however long the replay is stared at:
  //
  //   The wire never says WHEN. Every timestamp in the ledger is when this tool first read
  //   a round, not when it was played, so how long a decision took is not in there at all.
  //
  //   A split cannot be walked backwards. Which half took which card is unrecoverable from
  //   the settled round — but it is perfectly visible while it happens, one sighting at a
  //   time, because each response carries the whole hand as it then stood.
  //
  // So this records STATE, with a clock, and draws no conclusion whatsoever. No action is
  // named, no EV is attached, nothing is scored. It is the raw material an analysis can
  // difference offline, and keeping it dumb is what stops it from ever disagreeing with
  // the replay: a fact about the table at 12:04:03 cannot contradict an answer, only
  // date it. tools/test-jack-passive.js fences exactly that — a judgement word appearing
  // in a trail entry fails the build.
  const trailSig = (h) => JSON.stringify([
    h.status ?? null, num(h.cur),
    (h.hands || []).map((p) => (p.cards || []).length),
    (h.hands || []).map((p) => num(p.stake)),
    (h.dealer || []).length,
  ]);

  // Append only on CHANGE. The client refetches this table every fifteen seconds and the
  // history poll re-sends every settled round forever, so an entry per sighting would be
  // a log of the poll rather than of the play.
  const pushTrail = (trail, h, at, cap) => {
    const list = Array.isArray(trail) ? trail : [];
    const last = list[list.length - 1];
    // The round is over, and a trail is a record of it unfolding. Everything after the
    // settle is the fifteen-second poll re-sending a finished hand, which is a log of the
    // polling and not of the play.
    //
    // This was not theoretical. 0.8.0 shipped with `cur` in the signature and no stop, and
    // the server reports `current_hand` as the number of hands COMPLETED once a round
    // settles — 1 on a normal hand, 2 on a split — while the history poll re-sends the
    // same finished round with 0. Two different values, so two different signatures, so
    // every single round in an 83-round export carried a duplicate settled entry about
    // 90ms after the real one, identical in every card and every stake. A third of the
    // trail was the poll waving at itself.
    if (last && last.st === 'settled') return list;
    const sig = trailSig(h);
    if (last && last.sig === sig) return list;
    const next = list.concat([{
      at: num(at),
      sig,
      st: h.status ?? null,
      cur: num(h.cur),
      // The cards themselves, per hand, as they stood at this instant. This is the half a
      // settled split can never give back.
      c: (h.hands || []).map((p) => (p.cards || []).slice()),
      s: (h.hands || []).map((p) => num(p.stake)),
      d: (h.dealer || []).slice(),
      // The menu that was actually on offer AT THIS MOMENT, which is the only place it is
      // ever true — the stored round keeps the last one and the replay only assumes one.
      a: Array.isArray(h.allowed) ? h.allowed.slice() : null,
    }]);
    // Oldest first out. A round that somehow keeps changing must not grow without bound
    // inside a store shared with fifteen other tools.
    return next.length > cap ? next.slice(next.length - cap) : next;
  };

  // --- the export, in full --------------------------------------------------
  //
  // `copy` puts a flat TSV on the clipboard and is the right shape for eyeballing a run
  // in a spreadsheet. This is the other half, and the split between them is not
  // terse-versus-verbose — it is a shape problem. A round with a split holds TWO hands,
  // each with its own cards, its own stake and its own outcome, and a flat row cannot
  // carry that: the TSV joins the hands with a pipe and drops the per-half money on the
  // floor. So the second button emits JSON, because the thing being exported is nested.
  //
  // What is here that the TSV cannot have:
  //
  //   Per-hand stake and outcome, so a split stops being one blurred row. Given that the
  //   decision replay refuses splits outright, this is currently the ONLY way to ask
  //   anything at all about them — how often, how much, how they landed.
  //
  //   `allowed`, the menu the server actually offered. The replay SYNTHESISES a menu from
  //   the rules (hit and stand always, double on the first decision, split on a pair), and
  //   nothing has ever checked that against what the table really put in front of you. A
  //   double the house would not have covered would be scored as a mistake you never had
  //   the chance to make. Exporting both is what makes the two comparable.
  //
  //   `decisions`, so an analysis does not have to reimplement the solver to see the
  //   answers this panel already computed — and `no_decisions`, which says WHY a round
  //   contributed none. A round excluded for a split and a round played perfectly are the
  //   same absence in the old export, and they are not the same thing.
  //
  //   The proven reshuffle points. Everything else about the shoe is recomputable from the
  //   cards, which are all here in dealing order, but the seventh-sighting proof is the
  //   one piece of state that took a whole ledger to establish.
  //
  // Nothing is derived here that the panel does not already derive for itself; this is a
  // serialiser, not a second engine.
  const exportBundle = (o) => {
    const list = o.list || [];
    const byRound = new Map();
    for (const d of o.decisions || []) {
      if (!byRound.has(d.id)) byRound.set(d.id, []);
      byRound.get(d.id).push({
        step: byRound.get(d.id).length + 1,
        played: d.act, maximum: d.want, ev: d.ev, bestEV: d.bestEV,
        gap: num(d.bestEV) === null || num(d.ev) === null ? null : d.bestEV - d.ev,
        cost: d.cost, stake: d.stake,
      });
    }
    return {
      format: 'jack-watch/round-ledger',
      // 1 -> 2 in 0.8.2: `active_hand` became `current_hand` on both the round and each
      // sighting. That is a rename a reader cannot detect by inspection — an old file and
      // a new one are both valid JSON with a plausible field — so the number is what says
      // which one is in your hand.
      version: 2,
      // Handed in rather than read off a constant: the engine is lifted whole by
      // tools/test-jack-ev.js and has to reference nothing it was not given.
      tool: typeof o.tool === 'string' ? o.tool : 'jack-watch',
      collected_at: new Date(num(o.at) ?? Date.now()).toISOString(),
      scope: {
        corporation: o.id ?? null,
        rounds_exported: list.length,
        rounds_held: num(o.held) ?? null,
        hidden_by_mark: num(o.hidden) ?? null,
        mark: num(o.floor),
      },
      rules: {
        decks: RULES.decks, blackjack_pays: 1.5, dealer_stands_soft_17: true,
        double_after_split: true, splits_allowed: 1, split_aces_one_card: true,
        dealer_peeks: true, insurance: false, surrender: false,
      },
      table: o.cfg || null,
      edge: {
        computed: num(o.edge), tax_drag_measured: num(o.drag), effective: num(o.effEdge),
        note: 'computed is exact given perfect play; drag is measured from these rounds.',
      },
      shoe: o.shoe ? {
        cards_seen: num(o.shoe.cards), hole_cards_never_seen: num(o.shoe.hidden),
        proven_reshuffles: (o.shoe.breaks || []).slice(),
        segments: num(o.shoe.segments),
        note: 'A seventh sighting of one exact card proves a reshuffle. Nothing can prove '
            + 'the absence of one, and other players at this table are never visible.',
      } : null,
      money: o.roll || null,
      luck: o.luck || null,
      limits: [
        'Decisions are REPLAYED from the settled cards, never observed. The wire never '
        + 'says which button was pressed.',
        'A split contributes no decisions at all — which half took which card is not on '
        + 'the wire. See no_decisions on each round.',
        'Every replay is priced against the TABLE shoe (a fresh shoe less the cards '
        + 'visible in that round), not the counted one, so an old answer never moves.',
        'Timestamps are when this tool FIRST SAW a round, not when it was played.',
        'observed[] is present only for rounds watched as they happened, and is state '
        + 'plus a clock — never a conclusion. A round read off the history poll has none, '
        + 'because any timing put on it would be invented.',
        'observed[] is the only place a split can be reconstructed: which half took which '
        + 'card is visible one sighting at a time, and not at all once the round settles.',
        'current_hand is the server\'s field, reported raw: an index into hands[] while '
        + 'the round is live, and the number of hands COMPLETED once it is settled (1 '
        + 'ordinarily, 2 after a split). It is NOT the game\'s `active_hand`, which is a '
        + 'different field on the table config holding the hand in progress.',
      ],
      rounds: list.map((h) => ({
        id: h.id,
        first_seen: num(h.seen) === null ? null : new Date(h.seen).toISOString(),
        status: h.status ?? null,
        outcome: h.outcome ?? null,
        opening_bet: num(h.open),
        total_staked: num(h.total),
        gross: num(h.gross), tax: num(h.tax), credited: num(h.net),
        result: netOf(h),
        allowed_at_last_sighting: h.allowed || null,
        // The server's `current_hand`, under the server's own name and uninterpreted. It
        // was called `active_hand` until 0.8.2, which was wrong twice over: the game
        // already HAS an `active_hand` on the table config and it is a different thing
        // entirely (the hand in progress, or null — see docs/19), and the value here is
        // not an active hand once a round settles. It is an index into `hands` while you
        // are still playing, and the number of hands COMPLETED afterwards — 1 on an
        // ordinary round, 2 on a split. Reporting it raw and saying so beats renaming it
        // to something that would be a guess in one of those two states.
        current_hand: num(h.cur),
        dealer: (h.dealer || []).slice(),
        split: (h.hands || []).length > 1,
        hands: (h.hands || []).map((p) => ({
          cards: (p.cards || []).slice(),
          stake: num(p.stake),
          outcome: p.outcome ?? null,
          status: p.status ?? null,
        })),
        decisions: byRound.get(h.id) || null,
        no_decisions: replayNote(h),
        // Present only for rounds this tool watched unfold. Absent — not empty — for
        // anything read off the history poll, because there is no honest timestamp to put
        // on a round that was played before the page was open. State and a clock, never a
        // conclusion: what the table looked like, and when it looked like that.
        observed: Array.isArray(h.trail) ? h.trail.map((t) => ({
          at: num(t.at) === null ? null : new Date(t.at).toISOString(),
          since_previous_ms: null,     // filled below; the first entry has no previous
          status: t.st ?? null,
          // Same field, same caveat, and here it is the one that caused a bug: this
          // flipping from 1 to 0 between the settle and the next poll is what made two
          // identical settled sightings look like two different states in 0.8.0.
          current_hand: num(t.cur),
          hands: (t.c || []).map((cards, i) => ({
            cards: (cards || []).slice(),
            stake: ((t.s || [])[i] ?? null),
          })),
          dealer: (t.d || []).slice(),
          allowed: t.a || null,
        })).map((e, i, all) => (i === 0 ? e : Object.assign(e, {
          since_previous_ms: num(h.trail[i].at) === null || num(h.trail[i - 1].at) === null
            ? null : h.trail[i].at - h.trail[i - 1].at,
        }))) : null,
      })),
    };
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
  // 3. PANEL KIT v3 — shared verbatim block, see userscripts/_template.user.js.
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
    // A hidden tab and a minimised window both report a ~zero viewport. Clamping
    // against that pins the element into the top-left corner — and then onMove()
    // SAVES it, so the stored position is (-44, -38) forever after and the element
    // has permanently left wherever it belonged. Five of sixteen buttons landed
    // there the first time tools/harness/row.html ran. Treat a viewport that small
    // as no information, the same as the placement layer already does.
    const usable = () => window.innerWidth > 120 && window.innerHeight > 120;

    const fit = () => {
      if (!usable()) return false;
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
    /* FAB KIT v9 — shared verbatim block.
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

       v8 is the first version that changes what the row DOES rather than how wide
       it is, because on a real screen the row was not one row. Two faults, both
       found by tools/harness/row.html, which loads every shipped tool at once and
       measures the buttons instead of reading them as text:

         1. The row ran off the right-hand edge below about 1200px. The floor at
            440 held it clear of the game's nav, nothing held it clear of the
            window, and PANEL KIT's fit() then clamped every button past the edge
            to the SAME pixel and saved it. Four buttons on one square, and the
            save made it permanent. So the row now yields: it prefers to be
            centred, it will not sit left of the nav, but it gives up the nav floor
            before it gives up the edge. Overlapping the game's chrome is a thing
            you can see and click around; a stack of buttons is not.
         2. In the centred half, 50% here and window.innerWidth / 2 in the two
            tools that place their own button are not the same number. A fixed
            element's percentages resolve against the initial containing block,
            which EXCLUDES the classic scrollbar; innerWidth includes it. Half a
            scrollbar — 7.5px on this box — is most of the 8px gap, so the eye and
            MKT each sat all but touching the button to their right. The JS half of
            the row now reads document.documentElement.clientWidth, which is that
            same containing block. test-placement.js fails a copy that reaches for
            innerWidth instead.

       v9 is the second, and it takes on what v8 left as a stated limit: below
       744px of containing block the row is simply wider than the window, so it ran
       off the edge and fit() stacked it exactly as it used to at 1200. v8 called
       that a phone and moved on. It is not only a phone — it is any window the
       game has put into its MOBILE layout, which on a desktop is a half-screen
       pane, a snapped window, or a zoom level. The operator runs the game at 150%
       on half a tablet, where 125% is already past the breakpoint.

       And in that layout the band this row was built for does not exist. The
       desktop header (hidden md:block) is a wordmark, five nav links and an
       account menu, with empty screen in the middle. The mobile header (md:hidden,
       h-12) is a hamburger and the wordmark on the left, a flex-1 horizontally
       scrollable strip of your own vitals filling the middle, and the username and
       its caret pinned right. There is no gap to borrow: a row sliding left to stay
       on screen lands on the account menu, and its far end does not stay on screen
       anyway.

       So under the breakpoint the row leaves the band and FOLDS — two lines of
       eight, parked directly under the mobile header, right-aligned to the same
       8px edge. Four numbers do that, and each is a measurement rather than a
       taste:

         767  the game's own breakpoint. Tailwind's md: is width >= 48rem, and
              every chunk that branches in JS uses shadcn's useIsMobile, which is
              matchMedia('(max-width: 767px)'). Asking the same question the same
              way is the point: the fold and the layout it is folding for can never
              disagree about which one is on screen.
          55  where the mobile header ends. h-12 is 48px and its border-b is one
              more, and then the same ~6px of air the desktop band leaves above the
              button.
           8  half the row, which is the number 364 is half of, counted in buttons
              instead of pixels. It moves with the tool count exactly as 364 and
              736 do: a seventeenth tool means nine and eight, a new version, and a
              pass over every copy.
         368  the fold block: 8 * 46 - 8 = 360 wide, plus the 8px it keeps off the
              right edge — the same shape as the 736 above it.

       One subtlety worth stating, because it looks like the v8 bug and is its
       mirror image: a media query's width INCLUDES the classic scrollbar (Media
       Queries 4 says so, which is why the game's md: and this fold flip on the
       same pixel), while a percentage inside the rule EXCLUDES it. Two different
       widths in one rule, deliberately — the regime is chosen against the window,
       and the arithmetic inside it is done against the containing block. The two
       tools that compute this row in JS therefore ask matchMedia which regime they
       are in and documentElement.clientWidth where to sit, and test-placement.js
       fails a copy that mixes the two up.

       With both regimes the row now fits at every width worth having: at or above
       the breakpoint the one-line row needs 744 and the narrowest containing block
       up there is about 751, and below it the fold needs 376. Under 376 the tail
       overhangs again, and that IS a phone.

       What the fold covers is the strip of page directly under the mobile header,
       and, when there is one, the live-combat banner that renders there. Named
       rather than solved: a narrow screen has no free band, every one of these
       buttons drags, and double-click still brings one home.

       The kit owns the row. A tool owns its SLOT and nothing else about position:

         .pkxx-fab { --pk-slot: 16; z-index: 2147482000; }

       Slots are fixed rather than packed, and that is the whole point — installing
       a sixteenth tool does not shuffle the fifteen buttons you already know by
       position, and a tool you do not have simply leaves its slot empty. v8 is the
       one deliberate exception to that: the operator asked for the row to be dealt
       again by what the tools are FOR, rather than by the alphabet that recorded
       the order they were written in. It is a re-deal, not a sort to be re-run —
       from here the fixed-slot rule resumes, and a seventeenth tool takes slot 16.

         0  the eye  people-watch     yours: the ledger, and your own numbers
         1  ALGN     align-watch
         2  XP       xp-watch
         3  BARS     bar-watch
         4  JUMP     quick-jump       where you go, and what you do when you get there
         5  JACK     jack-watch
         6  SLOT     slot-watch
         7  MKT      market-watch
         8  SHOP     shop-watch
         9  RAID     raid-watch       your faction
        10  SLP      sleeper-watch
        11  WRLD     world-watch      the world
        12  GOV      gov-watch
        13  POLL     poll-watch
        14  TIME     time-watch       instruments
        15  SOCK     ws-watch

       The eye still leads, because it is the mark of the set. ALGN and XP sit
       together because they are both your own character read back to you; JUMP is
       the launcher that reaches the casinos, so JACK and SLOT follow it; SOCK is
       last because it is the one tool that is meant to be uninstalled.

       The fold splits that list down the middle, which is worth knowing before
       anything is renumbered: slots 0-7 are the first line and 8-15 the second, so
       the grouping above is also what each line of the fold means.

       Sixteen 38px buttons 8px apart is a 728px row, so it runs 364px either side
       of the middle of the viewport. The floor at 440px is where the game's own
       chrome ends — 24px of padding, a 62px wordmark, 24px of gap and five nav
       links, measured off the bundle — so above about 1608px the row is centred,
       and below that it stops sliding left rather than climb onto the nav. Below
       about 1174px it starts sliding left again, because from there the far end of
       the row would be off the edge, and that outranks the nav.

       Six numbers, if that header ever changes shape: 7 (where the band is), 440
       (where the nav ends), 364 (half the row), 736 (the whole row plus the 8px it
       keeps off the right edge), and the fold's 55 and 368. Nothing else in here
       is placement.

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
      /* The home row, in four variables so the fold below can move it without
         restating it. --pk-slot is the tool's; the rest of this is the kit's.
         Read --pk-start insides out: centre the row, but not left of the nav
         (440), and not so far right that its far end leaves the window
         (736 = 728 + 8) — that inner min is what stops fit() stacking the tail. */
      --pk-line: 0;
      --pk-col: var(--pk-slot, 0);
      --pk-band: 7px;
      --pk-start: max(8px, min(max(440px, 50% - 364px), 100% - 736px));
      position: fixed;
      top: calc(var(--pk-band) + var(--pk-line) * 46px);
      left: calc(var(--pk-start) + var(--pk-col) * 46px);
      display: grid; place-items: center;
      background: #18181b; color: #e4e4e7;
      border: 1px solid #3f3f46; border-radius: 3px;
      font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: .08em; text-align: center;
      cursor: pointer; user-select: none; touch-action: none;
    }
    /* v9, the fold: the same four variables with different answers. Under the
       game's own breakpoint the row leaves a header band it does not fit in and
       becomes two lines of eight, under the mobile header, right-aligned to the
       same edge. clamp() rather than mod(): the line is 0 up to slot 8 and 1 from
       there, which is the whole of a fold of two, and it asks nothing of the engine
       that has not worked for years. Both lines still resolve their x against a
       percentage, so the block follows the window with no script running. */
    @media (max-width: 767px) {
      .pk-fab {
        --pk-line: clamp(0, calc(var(--pk-slot, 0) - 7), 1);
        --pk-col: calc(var(--pk-slot, 0) - var(--pk-line) * 8);
        --pk-band: 55px;
        --pk-start: max(8px, 100% - 368px);
      }
    }
    .pk-fab:hover { border-color: #71717a; color: #fafafa; }
    .pk-fab.dragging { cursor: grabbing; border-color: #52525b; }
    /* Open, and last: neither hover nor a drag may un-fill it. */
    .pk-fab.pk-open { background: #3f3f46; border-color: #a1a1aa; color: #fafafa; }
    .pk-fab svg { width: 24px; height: 24px; display: block; }
    .pkbj-fab { --pk-slot: 5; z-index: 2147481880; }
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
    /* The price of getting it wrong. The right action was always on this screen; what was
       missing beside it was the magnitude, so a hand with $720 riding on the press and one
       with $72,012 riding on it read exactly alike until you did the subtraction yourself.
       One weight, not three: the digits carry the alarm, and the engine note above records
       what happened when the loudness was tiered on the gap instead. */
    .pkbj-pick .cost { display: block; margin-top: 3px; font-size: 12px;
                       color: #fca5a5; font-variant-numeric: tabular-nums; }

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
    /* The button that costs the most. Marked every time rather than above a threshold —
       it is the one press this panel exists to stop, and it is never ambiguous. */
    .pkbj-tbl tr.worst td { background: #2a1215; }
    .pkbj-tbl tr.worst td:first-child { color: #fca5a5; }

    /* The on-button guide. These land on the GAME's own controls, which is why they are
       drawn with outline and box-shadow and nothing else: both paint outside the box and
       neither participates in layout, so a marked button is the same size and in the same
       place as an unmarked one. Anything that changed the metrics would move the table's
       buttons around under the cursor, which is a worse crime than being hard to see.

       !important because these compete with a stylesheet we do not control and cannot
       predict; specificity arguments against an unknown opponent are not winnable. */
    .pkbj-best {
      outline: 2px solid #4ade80 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(74, 222, 128, .25), 0 0 12px rgba(74, 222, 128, .45) !important;
      border-radius: 4px;
    }
    .pkbj-avoid {
      outline: 2px dashed #f87171 !important;
      outline-offset: 2px !important;
      opacity: .55 !important;
    }
    /* Motion is the thing the eye catches without being asked, which is the whole point —
       but it is one short pulse on arrival rather than a loop, because a control that
       throbs forever beside a money figure is a casino's trick and not ours. */
    @keyframes pkbj-nudge {
      from { box-shadow: 0 0 0 10px rgba(74, 222, 128, 0), 0 0 0 rgba(74, 222, 128, 0); }
    }
    .pkbj-best { animation: pkbj-nudge .45s ease-out 1; }
    @media (prefers-reduced-motion: reduce) { .pkbj-best { animation: none; } }

    /* The felt's marks, which are the ones that actually land on this table. The buttons
       are painted into a canvas, so these are not ON them — they are a layer above the
       canvas, pinned by arithmetic to where the game draws each one.

       pointer-events: none on the layer, inherited by every mark in it. That is
       load-bearing rather than tidy: the felt underneath keeps every click, so a mark
       can never eat a press meant for the game — and it is also the shape of the
       promise, because a layer that cannot be clicked is not a button this tool could
       ever be one edit away from pressing.

       Below the panel's z-index on purpose. This is pinned over the play area, the panel
       lives in the margin, and on a narrow window the two overlap — the panel is the
       thing you are reading when that happens. */
    .pkbj-ovl { position: fixed; inset: 0; pointer-events: none; z-index: 2147481875;
                display: none; }
    .pkbj-ovl > div { position: absolute; box-sizing: border-box; border-radius: 5px; }
    /* Border rather than outline here, unlike the DOM marks. An outline is drawn OUTSIDE
       the box, which is right when the box is the game's own button and must not move;
       these boxes are ours and are already exactly the button's size, so the mark belongs
       on the edge rather than around it. */
    .pkbj-ovl .best { border: 2px solid #4ade80;
                      box-shadow: 0 0 0 3px rgba(74,222,128,.2), 0 0 14px rgba(74,222,128,.5);
                      animation: pkbj-nudge .45s ease-out 1; }
    /* Dimming is a scrim, because we cannot reach into the canvas to lower a button's
       opacity the way the DOM marks do. Dark enough to read as "not this one", light
       enough that the word underneath is still legible — a mark that hides the label
       would make the guide harder to argue with, not easier. */
    .pkbj-ovl .avoid { border: 2px dashed #f87171; background: rgba(9,9,11,.5); }
    @media (prefers-reduced-motion: reduce) { .pkbj-ovl .best { animation: none; } }

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
  // How far back the decision replay walks. Every settled round in the ledger could be
  // replayed, but each one costs a handful of solves and the question it answers — how am
  // I playing — is about recent play. Memoised by hand id, so this is paid once.
  const MAX_REPLAY = 150;
  // Sightings kept per watched round. A deal, three hits and a settle is five; a split
  // that doubles both halves is about nine. Sixteen is room for the worst honest round
  // and a hard stop on anything stranger, because this store is shared with fifteen other
  // tools and a runaway list here is a quota failure in one of them.
  const MAX_TRAIL = 16;
  // How many recent rounds keep a trail at all. The trail answers "how did that unfold",
  // which is a question about play you can still remember; the cards answer everything
  // else and are kept for all MAX_HANDS. Trimming the tail is what keeps a busy table
  // from turning a few hundred rounds into a few hundred kilobytes.
  const MAX_TRAILED = 120;

  const data = readJSON(K.data, null) || { corps: {} };
  if (!data.corps || typeof data.corps !== 'object') data.corps = {};

  const ui = readJSON(K.ui, null) || {};
  if (typeof ui.open !== 'boolean') ui.open = false;
  // The on-button guide, off until asked for. It changes how the GAME's own controls
  // look, which is a bigger imposition than anything else this panel does, so it is not
  // something to discover by surprise.
  if (typeof ui.guide !== 'boolean') ui.guide = false;
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
    if (!data.corps[id]) data.corps[id] = { cfg: null, hands: {} };
    const c = data.corps[id];
    if (!c.hands || typeof c.hands !== 'object') c.hands = {};
    // Written by 0.4.0 and earlier, which stored what it inferred as it watched. The
    // decisions are replayed from the cards now, so a stored copy is a second answer that
    // can only ever disagree with the first.
    if (c.decisions) delete c.decisions;
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
    // The trail is dropped long before the round is. Two different retentions on purpose:
    // the cards are the ledger and answer the money and the decisions, so they are kept
    // for everything; the trail only answers how a round unfolded, and an unfolding from
    // four hundred rounds ago is not a question anyone has. Dropping it is not a loss of
    // an answer — the round keeps every card it ever had.
    for (const h of all.slice(MAX_TRAILED)) if (h.trail) delete h.trail;
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
    const merged = mergeHand(prev, slim);

    // The trail is only ever kept for a round this tool actually WATCHED. A round whose
    // first sighting is already settled came off the history poll — it was played before
    // anyone was looking, possibly days ago, and stamping it now would manufacture a
    // timing observation out of the moment the page happened to load. That would be worse
    // than having none: a fabricated latency is indistinguishable from a real one once it
    // is in the file. So back-catalogue rounds carry no trail at all, and their absence is
    // the honest answer to "how long did that take".
    // Recorded from `slim` — the sighting exactly as it arrived — and never from `merged`.
    // mergeHand deliberately keeps the LONGEST card list it has ever seen, because a later
    // sighting must not be allowed to delete what an earlier one knew. That is right for
    // the ledger and wrong for a record of observations: feed it the merge and a poll that
    // re-sends an older view of a live round produces a trail entry pairing the newest
    // cards with the older status — a state that was never on the wire at any instant. The
    // whole claim this makes is "the table looked like this, then", so it logs what came in.
    const watched = prev ? Array.isArray(prev.trail) : slim.status !== 'settled';
    if (watched) merged.trail = pushTrail(prev && prev.trail, slim, at, MAX_TRAIL);
    else if (prev && prev.trail) merged.trail = prev.trail;

    c.hands[slim.id] = merged;
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

  // How to read a gap. These two are the only numbers in this file that came from a
  // SIMULATION rather than from the wire or from the stated rules, and they are used for
  // exactly one thing — telling you what your own gaps look like next to. Nothing is
  // computed from them and no decision turns on them.
  //
  // Measured by dealing this tool's own solver against four shoe policies, a few thousand
  // sessions each: at 5.5 cards a round, a table that reshuffles every round trips the
  // seven-of-a-code test on coincidence alone about every 23 rounds and raggedly (14 to
  // 30), while a persistent shoe trips it on its real shuffle cycle, later and like
  // clockwork — 43 rounds and a 40-to-45 spread at three-quarter penetration. The SPREAD
  // is the discriminating half and it is the half that is easy to miss. The table is in
  // docs/19-casino-blackjack-surface.md.
  const GAP_TYPICAL = 'twenty to fifty';
  const GAP_KEY = 'Around 23 rounds and ragged (14–31) is what reshuffling every round '
    + 'looks like; around 43 and like clockwork (41–46) is a six-deck shoe cut at three '
    + 'quarters. The spread says more than the average — a coincidence lands raggedly, a '
    + 'shuffle cycle does not. Simulated, not observed; see docs/19.';

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
    const edge = solvedEdge();
    const drag2 = roll.taxDrag;

    return {
      id, cfg, list, asc, roll, live, last, shoe, comp, tableComp,
      stake, seed, manual,
      floor, held: held.length, hidden: held.length - list.length,
      newest: held.length ? held[0].id : null,
      stakeNote: stake === null ? 'not set' : (manual ? 'yours' : seedSrc),
      edge,
      effEdge: edge === null ? null : edge + (drag2 ?? 0),
      sd: stdev(returns), sdN: returns.length,
      luck: runDeviation(list, edge, stdev(returns)),
      bounds: betBounds(cfg),
      now: num(cfg.cash) !== null ? cfg.cash : (stake === null ? null : stake + roll.net),
    };
  };

  // Decisions are replayed from the cards rather than stored, so this memo is what keeps
  // that affordable: a hand is walked once and never again. In memory only, and keyed by
  // hand id — a settled hand's cards never change, which is exactly what makes the answer
  // safe to keep and pointless to recompute.
  const replayMemo = new Map();
  const decisionsOf = (list) => {
    const out = [];
    let walked = 0;
    for (const h of list) {                            // newest first
      if (h.status !== 'settled') continue;
      if (walked++ >= MAX_REPLAY) break;
      let d = replayMemo.get(h.id);
      if (!d) { d = replayHand(h); replayMemo.set(h.id, d); }
      for (const x of d) out.push(x);
    }
    return out;
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

  // Below this many rounds between breaks, the table is turning the shoe over faster than
  // any real penetration would — simulated, a six-deck shoe cut at three quarters breaks
  // this test every 41 to 46 rounds, and reshuffling every round breaks it every 14 to 31.
  // A measured mean under this sits in the second band, and a counted composition built
  // across a shoe that has already gone back in the box is worse than no composition.
  const GAP_DEAD = 35;

  const shoeNote = (v) => {
    const n = el('div', 'pkbj-scope');
    if (ui.shoe === 'COUNTED') {
      n.append(el('b', null, 'COUNTED shoe. '));
      n.append(document.createTextNode(
        `Solving against the ${v.shoe.comp.reduce((a, b) => a + b, 0)} cards this tool has not `
        + `seen dealt since the last proven reshuffle. That is only right if the shoe persists `
        + `between hands and nobody else is drawing from it — neither is established. COUNT has `
        + `the evidence.`));
      if (num(v.shoe.gapMean) !== null && v.shoe.gapMean < GAP_DEAD) {
        n.append(el('b', null,
          ` And your own evidence is against it: breaks every ${v.shoe.gapMean.toFixed(0)} rounds `
          + 'on average, where a shoe cut at three quarters would break every 41 to 46. This '
          + 'table is putting cards back in the box faster than a count can outlive, so COUNTED '
          + 'is solving against a shoe that is partly gone. TABLE is the better answer here.'));
      }
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

    // What the bet puts at risk. The bet in question is the live hand's if one is in
    // play, and otherwise the last one you placed — which is the best available guess at
    // the next one, because the bet is chosen in the game's own UI and this panel never
    // sees it until it has been placed. Labelled for which it is, so a stale reference is
    // never mistaken for a live one.
    const ref = v.live ? num((v.live.hands || [])[0] && v.live.hands[0].stake) ?? num(v.live.open)
      : (v.last ? num(v.last.open) : null);
    // The on-button guide's switch, and its own diagnosis. A guide that quietly matches
    // nothing is worse than no guide, because you would sit there believing the absence of
    // a highlight meant something. So it says how many action controls it can actually see,
    // and the count is the first thing to look at if the marks never appear.
    {
      const bar = el('div', 'pkbj-bar');
      const b = el('button', 'pkbj-btn' + (ui.guide ? ' on' : ''),
        ui.guide ? 'guide: on' : 'guide: off');
      b.title = 'outline the action to press on the game\'s own button, and dim the worst '
        + 'one. Marks only; this tool cannot press anything.';
      b.addEventListener('click', () => {
        ui.guide = !ui.guide;
        saveUI();
        render();
      });
      bar.append(b);
      if (ui.guide) {
        // Several different failures used to wear one sentence, which is how an evening
        // gets wasted, so each says what it is. "on the felt" means the canvas was
        // measured and the marks are arithmetic; "found" means this page was built out of
        // elements after all and the old DOM finder answered; the rest are the ways each
        // of those can come up empty, and every one of them names its own fix.
        bar.append(el('span', 'pkbj-n', guideVia === 'felt'
          ? `${guideSeen} button${guideSeen === 1 ? '' : 's'} on the felt`
          : (guideVia === 'dom'
            ? `${guideSeen} action button${guideSeen === 1 ? '' : 's'} found`
            : (!v.live ? 'waiting for a hand'
              : (guideNote || (guideScanned
                ? `no action words on ${guideScanned} visible controls`
                : 'no controls found on this page'))))));
        // When it cannot find them, it can at least say what it DID see. This repo does
        // not point Claude at the live table, so a finder built against a stand-in is
        // going to be wrong in ways no amount of local testing reveals — and the loop of
        // "still nothing" / "try this" is expensive in a way one paste is not. The report
        // goes to the clipboard because the operator should not have to open a console to
        // tell a tool what it is looking at.
        if (!guideVia && v.live) {
          const rep = el('button', 'pkbj-btn', 'copy what it sees');
          rep.title = 'a short description of the controls on this page, to paste back';
          rep.addEventListener('click', () => {
            navigator.clipboard.writeText(guideReport()).then(() => flash(rep, 'copied', 'copy what it sees'),
              () => { rep.textContent = 'blocked'; });
          });
          bar.append(rep);
        }
      }
      body.append(bar);
    }

    const exp = exposure({ bet: ref, cash: cfg.cash, live: !!v.live });
    if (exp) {
      const g = el('div', 'pkbj-stats');
      // Two different questions, so two different sentences. Live: what fraction of the
      // bankroll is riding right now. Between rounds: what fraction would ride if you bet
      // that again — which is the only version of the question you can still act on, and
      // the one a session that ends at $55 needs to be able to say 182% to.
      stat(g, exp.live ? 'this bet' : 'bet it again', money(exp.bet),
        !exp.live && exp.frac > 1 ? 'down' : null,
        exp.frac === null ? null : (exp.live
          ? pct(exp.frac, 1) + ' of your bankroll'
          : pct(exp.frac, 1) + ' of your cash'));
      // The ceiling nobody has in mind. A round can stake four times the opener under
      // these rules, and the measured multiplier of about 1.1 is why that is a surprise.
      stat(g, 'worst case', money(exp.worst), exp.worstFrac > 0.5 ? 'down' : null,
        `if split and both doubled — ${pct(exp.worstFrac, 1)} of it`);
      // Arithmetic, not a forecast. No probability is offered anywhere here and the
      // engine note says why.
      stat(g, 'cash covers', `${exp.covers}`, exp.covers <= 2 ? 'down' : null,
        exp.covers === 0 ? 'you cannot bet this again'
          : (exp.covers === 1 ? 'one more bet this size' : 'more bets this size'));
      body.append(g);
      body.append(el('div', 'pkbj-note',
        'Exposure, not advice. There is no recommended bet here and there never will be: at '
        + 'a house edge of ' + pct(v.edge ?? 0.004593, 4) + ' the stake that maximises your '
        + 'bankroll is zero, so any "right" size would be a fiction. No risk of ruin either '
        + '— the per-round payouts run from −2 to +4 and nothing about that shape is normal, '
        + 'so a percentage hung on it would be worst exactly where you would want it. '
        + '"Cash covers" is division and assumes nothing.'));
    }

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
    // Solved once and read twice: the headline under the recommendation, and the row it
    // marks in the table further down. It lives out here rather than beside the first of
    // those because the second is in a different block, and a const that is not is a
    // ReferenceError that takes the whole action table down with it.
    const cost = s ? pressCost(s.ev, mine && mine.stake) : null;

    // The recommendation, and the price of the alternatives. This is the only loud
    // thing in the panel because it is the only time-critical one.
    if (s && s.pick) {
      const box = el('div', 'pkbj-pick');
      box.append(el('b', null, WORD[s.pick] || s.pick.toUpperCase()));
      // The magnitude, and the button it belongs to, directly under the action and above
      // the per-dollar detail — at the table this is read in about that order and often
      // only that far. Naming the worst press is the point: "up to" is a ceiling, and a
      // ceiling with no name attached is the thing you have to go and work out yourself.
      if (cost) {
        const worst = WORD[cost.worst] || cost.worst;
        box.append(el('span', 'cost', cost.cash === null
          ? `${worst} costs ${ev(-cost.gap)} per $1 staked — the worst press here`
          : `${worst} gives up ${money(cost.cash)} — the worst press here`));
      }
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
      for (const k of ['action', 'ev / $1', 'on this hand', 'gives up']) hr.append(el('th', null, k));
      thead.append(hr);
      t.append(thead);
      const tb = el('tbody');
      const top = Math.max(...Object.keys(s.ev).map((a) => s.ev[a]));
      for (const a of Object.keys(s.ev).sort((x, y) => s.ev[y] - s.ev[x])) {
        // The pick keeps its mark by colouring the row rather than by a glyph in a column
        // of its own: that column was 16% of a panel that lives in a margin, spent on
        // repeating what the 15px word directly above already said, and it is now
        // carrying the number this view did not have. The worst row is marked too, and
        // that is the loud half — the pick tells you where to go, this tells you what
        // not to touch, and only the second one has ever cost real money here.
        const tr = el('tr', a === s.pick ? 'live' : (cost && a === cost.worst ? 'worst' : null));
        tr.append(el('td', null, WORD[a] || a));
        const e = s.ev[a];
        const c1 = el('td', e >= 0 ? 'up' : 'down', ev(e));
        tr.append(c1);
        const stake = num(mine && mine.stake);
        const cash = stake === null ? null : e * mine.stake;
        tr.append(el('td', cash === null ? null : (cash >= 0 ? 'up' : 'down'),
          cash === null ? '—' : signed(cash)));
        const give = top - e;
        tr.append(el('td', give > 0 ? 'down' : null,
          give <= 0 ? '—' : (stake === null ? ev(-give) : '−' + money(give * stake))));
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
      + 'server — so "gives up" measures each row against the best button actually in front '
      + 'of you, the pick gives up nothing by definition, and the figure above the cards is '
      + 'the worst row here. A large one means money rides on the press, not that the '
      + 'decision is close: how close it is, is two rows sitting a thousandth apart. Two '
      + 'approximations, both in docs/19: the dealer distribution is held fixed while your '
      + 'own draws are enumerated, and a split is priced as twice one hand.'));
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
      ev2.append(el('b', null, 'A reshuffle is proven. '));
      ev2.append(document.createTextNode(
        `${sh.peakCode || 'One card'} came out a seventh time at hand #${sh.lastBreak}, and a `
        + `six-deck shoe holds six of each. ${sh.segments - 1} break`
        + `${sh.segments === 2 ? '' : 's'} so far, and the count above restarts at each one. `
        + 'A break on its own settles nothing, though: this test keeps counting across a real '
        + 'reshuffle it cannot see, so a persistent shoe trips it too — just later. '));
      ev2.append(el('b', null, 'The GAP is the measurement.'));
      if (sh.gaps.length) {
        ev2.append(document.createTextNode(
          ` Yours: ${sh.gaps.join(', ')} round${sh.gaps.length === 1 && sh.gaps[0] === 1 ? '' : 's'} `
          + `between breaks (mean ${sh.gapMean.toFixed(1)}, ${sh.gapMin}–${sh.gapMax}). ${GAP_KEY}`));
      } else {
        ev2.append(document.createTextNode(
          ' One break is not a gap — a second one is what turns this into a number, and it is '
          + `${GAP_TYPICAL} rounds off, which is itself the answer: where in that range it `
          + `lands is most of what there is to learn here. ${GAP_KEY}`));
      }
    } else {
      ev2.append(el('b', null, 'No reshuffle proven yet. '));
      ev2.append(document.createTextNode(
        `The most any one card has been seen is ${sh.peak}${sh.peakCode ? ' (' + sh.peakCode + ')' : ''}`
        + ' and seven would be impossible in six decks. That is consistent with a persistent shoe '
        + 'and PROVES NOTHING — this test only ever fires in one direction. It is not idle, '
        + `though: ${sh.played} round${sh.played === 1 ? '' : 's'} in, and a table that reshuffled `
        + 'every round would have tripped it around round 24 and almost certainly by round 32. '
        + 'Past about forty clean rounds, per-round reshuffling is the one story your ledger has '
        + 'already ruled out.'));
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
    stat(g2, 'tax drag', pct(v.roll.taxDrag, 3), v.roll.taxDrag ? 'down' : null,
      v.roll.n && !v.roll.taxed ? 'nothing taxed yet' : 'measured');
    stat(g2, 'effective edge', pct(v.effEdge, 3), null,
      v.edge === null ? 'needs the solve' : 'computed + measured');
    stat(g2, 'realized edge', pct(v.roll.realizedEdge, 2),
      num(v.roll.realizedEdge) === null ? null : (v.roll.realizedEdge > 0 ? 'down' : 'up'),
      'what actually happened');
    body.append(g2);

    // A zero drag is a fact about the government, not about the table, and the difference
    // matters the moment somebody passes a budget. Measured 2026-09-04: not one round in
    // 51 was taxed, over $1.87m staked — because income tax had been all but abolished,
    // not because blackjack is exempt. So the effective edge above is the computed one
    // TODAY, and this line is what stops that reading as a permanent property.
    if (v.roll.n && !v.roll.taxed) {
      body.append(el('div', 'pkbj-scope',
        `Not one of these ${v.roll.n} round${v.roll.n === 1 ? ' was' : 's was'} taxed, so the `
        + 'effective edge above is just the computed one. That is a reading of the current tax '
        + 'code rather than of this table — the rate is set by the government and a budget can '
        + 'bring it back, at which point the drag stops being zero and this figure moves without '
        + 'anything about the blackjack changing. It is measured every time you look, so it will '
        + 'follow — but a long ledger spanning a rate change reports the blend of both, and LOG\'s '
        + '"clear" is how you ask about the rate you are actually playing under.'));
    }

    body.append(drawChart(curveOf(v.asc, v.stake, v.effEdge)));

    // What your own play cost, which is the one number on this surface that is about
    // you rather than about the table.
    const d = decisionRoll(decisionsOf(v.list));
    const g3 = el('div', 'pkbj-stats');
    stat(g3, 'decisions seen', String(d.n), null, 'replayed from the cards');
    stat(g3, 'played the max', d.rate === null ? '—' : pct(d.rate, 0), null,
      `${d.matched} of ${d.n}`);
    stat(g3, 'given up', d.n ? (d.cost > 0 ? signed(-d.cost) : money(0)) : '—', d.cost > 0 ? 'down' : null,
      'ev, at the stakes you played');
    body.append(g3);

    // And the question that follows a good night, which every other figure here dances
    // around: is this you, or is it variance? It is almost always variance, and the panel
    // is more use saying so than leaving you to guess.
    if (v.luck) {
      const g4 = el('div', 'pkbj-stats');
      stat(g4, 'vs expectation', signed(v.luck.over),
        v.luck.over > 0 ? 'up' : (v.luck.over < 0 ? 'down' : null),
        `edge says ${signed(v.luck.expected)}`);
      stat(g4, 'in deviations', (v.luck.z >= 0 ? '+' : '−') + Math.abs(v.luck.z).toFixed(2) + ' sd',
        'est', `1 sd on this run is ${money(v.luck.cashSD)}`);
      body.append(g4);
      body.append(el('div', 'pkbj-scope',
        `Under a deviation and a half either way is the ordinary weather of ${v.luck.n} `
        + 'round' + (v.luck.n === 1 ? '' : 's') + ' and says nothing about how you played — '
        + 'the spread is measured from your own results and is an estimate, and it is left as '
        + 'a distance rather than dressed up as a percentage, because the per-round payouts '
        + 'here run from −2 to +4 and nothing about that shape is normal.'));
    }

    body.append(el('div', 'pkbj-note',
      'The dashed line is what perfect play plus the measured tax drag says this run should have '
      + 'cost; the gap to your line is the luck. The wire never says what you pressed, but a '
      + 'settled round does not need to be asked: its cards are in the order they were dealt, so '
      + 'the hand is simply walked. That reads the whole back-catalogue history hands over on the '
      + 'first poll, not only the rounds this tool watched live. Rounds that carry no decision are '
      + 'dropped rather than guessed at — a dealer natural (you never acted), your own natural, '
      + 'and any round you split, where which half took which card is not on the wire. Each step '
      + 'is priced against the TABLE shoe: a '
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

  // The only timer in this file, and all it does is put a button's label back. Both export
  // buttons share it rather than each bringing its own setTimeout, and that is a fence
  // talking rather than taste: tools/test-jack-passive.js COUNTS the timers here, because a
  // tool that reaches for setTimeout a second time is one edit away from reaching for it a
  // third to repaint on a schedule — and a repaint on a schedule is the first half of
  // alerting from a tab nobody is looking at. One timer, one job, easy to keep honest.
  const flash = (btn, word, back) => {
    btn.textContent = word;
    setTimeout(() => { btn.textContent = back; }, 1200);
  };

  // At most one outstanding Blob URL from the save button, released on the next save.
  let lastSaveURL = null;

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

    // What an export has to carry, learned the hard way from one that did not.
    //
    //   `bet` is the OPENING wager and `staked` is what the round ended up risking. Without
    //   both, a $50,000 round is indistinguishable from a doubled $25,000 one, and the
    //   staking multiplier — the whole reason the planner does not understate exposure —
    //   cannot be checked against the rows it was computed from.
    //
    //   `cards` is the only reason an export can answer anything about the shoe. The
    //   sighting test is per exact code, so an export without suits is an export the
    //   shoe question cannot be asked of at all.
    const copy = el('button', 'pkbj-btn', 'copy');
    copy.addEventListener('click', () => {
      const rows = [['id', 'bet', 'staked', 'gross', 'tax', 'net', 'result', 'outcome',
        'dealer', 'player', 'seen'].join('\t')];
      for (const h of v.list) {
        rows.push([h.id, h.open ?? '', h.total ?? '', h.gross ?? '', h.tax ?? '', h.net ?? '',
          netOf(h) ?? '', h.outcome ?? h.status ?? '',
          (h.dealer || []).join(' '),
          (h.hands || []).map((p) => (p.cards || []).join(' ')).join(' | '),
          new Date(h.seen).toISOString()].join('\t'));
      }
      navigator.clipboard.writeText(rows.join('\n')).then(() => flash(copy, 'copied', 'copy'),
        () => { copy.textContent = 'blocked'; });
    });

    // The nested half. See exportBundle in the engine for what it carries and why it is
    // JSON rather than more columns — the short version is that a split round holds two
    // hands with two stakes and two outcomes, and a flat row has never been able to say
    // so. It also happens to be the jack-watch section of tools/collect-stores.js, which
    // means the one export worth having most often no longer needs the DevTools console.
    const copyJSON = el('button', 'pkbj-btn', 'copy+');
    copyJSON.title = 'the whole ledger as JSON: nested split hands, the menu the server '
      + 'offered, the replayed decisions, and why a round has none';
    copyJSON.addEventListener('click', () => {
      const bundle = exportBundle({
        tool: `jack-watch ${SCRIPT_VERSION}`,
        at: Date.now(),
        id: v.id, cfg: v.cfg, list: v.list, held: v.held, hidden: v.hidden, floor: v.floor,
        shoe: v.shoe, roll: v.roll, luck: v.luck,
        edge: v.edge, effEdge: v.effEdge, drag: v.roll ? v.roll.taxDrag : null,
        decisions: decisionsOf(v.list),
      });
      navigator.clipboard.writeText(JSON.stringify(bundle, null, 2)).then(() => flash(copyJSON, 'copied', 'copy+'),
        () => { copyJSON.textContent = 'blocked'; });
    });

    // The same bundle, as a file. `copy+` on a real session is fifteen to fifty kilobytes
    // of JSON, and the clipboard is a bad pipe for that — it has to be pasted somewhere to
    // exist, and "somewhere" is usually a chat box that was not built for it. This hands
    // it to the browser's own download path instead, exactly the way
    // tools/collect-stores.js does, so the export arrives as a file you can attach.
    //
    // Nothing is transmitted: the Blob is built in the page from rounds already on your
    // screen and handed to the browser. There is no request here and no destination.
    const save = el('button', 'pkbj-btn', 'save');
    save.title = 'the same JSON as a downloaded file, for when it is too big to paste';
    save.addEventListener('click', () => {
      const bundle = exportBundle({
        tool: `jack-watch ${SCRIPT_VERSION}`,
        at: Date.now(),
        id: v.id, cfg: v.cfg, list: v.list, held: v.held, hidden: v.hidden, floor: v.floor,
        shoe: v.shoe, roll: v.roll, luck: v.luck,
        edge: v.edge, effEdge: v.effEdge, drag: v.roll ? v.roll.taxDrag : null,
        decisions: decisionsOf(v.list),
      });
      const stamp = bundle.collected_at.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      // The previous URL is released on the NEXT save rather than on a timer. A second
      // setTimeout would be the cheap way and it is the wrong one: this file is allowed
      // exactly one timer, tools/test-jack-passive.js counts them, and the reason is that
      // a tool reaching for a schedule twice is one edit from repainting on one. At most
      // one object URL is ever outstanding, and it dies with the tab regardless.
      if (lastSaveURL) URL.revokeObjectURL(lastSaveURL);
      lastSaveURL = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const a = el('a');
      a.href = lastSaveURL;
      a.download = `jack-watch-${v.id}-${stamp}.json`;
      a.click();
      flash(save, 'saved', 'save');
    });

    bar.append(copy, copyJSON, save, el('span', 'pkbj-n', `${v.held} held`));
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

    // Above the early return on purpose. The guide's whole reason to exist is that you
    // should not need the panel open to know what to press — a version that only marked
    // buttons while the panel was showing would be solving the problem for the one case
    // that never had it.
    paintGuide(v);

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
  // 12.5 The on-button guide.
  //
  //      The recommendation has always been correct and always been in the wrong
  //      place. It lives in a panel, and a panel lives in a margin (CLAUDE.md), so
  //      reading it costs a look at the cards, a look at the margin, a look back,
  //      and then a press — three fixations per decision, several hundred times a
  //      night. This puts the answer ON the control you are about to press, which
  //      is where your eyes already are.
  //
  //      WHAT THE TABLE ACTUALLY IS, since 0.12.0 and since three versions were
  //      spent not knowing. It is a Phaser canvas. HIT, STAND, DOUBLE and SPLIT are
  //      rectangles painted into it, with no element under any of them, so the DOM
  //      finder below could never have worked and no wider selector was ever going
  //      to fix it. The marks are therefore drawn on a layer ABOVE the canvas and
  //      placed by arithmetic — the game's own layout arithmetic, read off the
  //      bundle — which is what `feltRow` and `feltPlace` in the engine are.
  //
  //      THE LINE, because this is the closest this file has ever been to it.
  //
  //      Locating the game's buttons is reading the DOM of a page you are actively
  //      viewing, which docs/01-rules-envelope.md scores as permitted on its very
  //      first row; over a canvas that is a box and two integers, and never a pixel
  //      read back. Drawing computed information over the page is the same row, and
  //      market-watch already marks the game's chart canvas this way. Neither adds a
  //      request.
  //
  //      Pressing one would be a script-initiated game action, and it does not
  //      matter that React would build the request rather than us — that is
  //      precisely the hole tools/test-sleeper-passive.js exists to close, in its
  //      own words a synthetic click "slips past every network check in this file".
  //      So this section knows exactly where every action button is and cannot
  //      press one: there is no .click() here, no dispatchEvent, no synthetic
  //      pointer of any kind, and the fence counts them. The one .click() in this
  //      file is the export anchor, which touches no game UI.
  //
  //      Marks are re-applied by a MutationObserver rather than a timer, for two
  //      reasons. React re-renders the button row on every state change and would
  //      otherwise wipe the class within milliseconds. And this file is allowed
  //      exactly one timer — an observer is not one, it is idle until the page
  //      itself changes, which is the same argument comms-move makes for watching
  //      the dock.
  // ---------------------------------------------------------------------------
  const MARK_BEST = 'pkbj-best';
  const MARK_WORST = 'pkbj-avoid';

  // Only ever OUR marks come off, and only off elements we put them on.
  const clearMarks = (root) => {
    for (const n of (root || document).querySelectorAll('.' + MARK_BEST + ', .' + MARK_WORST)) {
      n.classList.remove(MARK_BEST, MARK_WORST);
    }
  };

  // Every visible control on the page whose label names an action, keyed by action.
  // Our own panel is skipped outright: it has buttons too, and a tool that highlighted
  // its own UI would be marking the wrong thing in the most confusing possible way.
  // Visible enough to outline. NOT `offsetParent`, which was the first version and was
  // wrong on a live table: offsetParent is null for anything `position: fixed`, so a row of
  // buttons pinned to the felt reads as invisible while being the most visible thing on the
  // screen. A rectangle with area cannot be argued with.
  const onScreen = (n) => {
    const r = n.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const c = getComputedStyle(n);
    return c.visibility !== 'hidden' && c.display !== 'none';
  };

  // Anything this tool drew. The mark layer is in here as well as the panel and the
  // button, and that is not tidiness: the layer is inside document.body, which is what
  // the guide's own MutationObserver watches, so a layer that did not count as ours
  // would be a repaint reacting to itself.
  const ours = (n) => !!(n && n.closest && (n.closest('.pkbj-panel') || n.closest('.pkbj-ovl')
    || n.classList.contains('pkbj-fab')));

  // Two passes, because a table's action controls are usually <button> and occasionally
  // not. The first pass is the narrow, obviously-right one. The second only runs if the
  // first found nothing at all, and looks for the deepest element whose whole text IS the
  // word — then hands back the clickable-looking thing wrapping it, so the outline lands on
  // the control rather than on the label inside it.
  const CONTROLS = 'button, [role="button"], a, [tabindex], input[type="button"], input[type="submit"]';

  let guideScanned = 0;           // visible controls examined, for the panel's diagnosis
  const actionButtons = () => {
    const found = new Map();
    guideScanned = 0;
    for (const n of document.querySelectorAll(CONTROLS)) {
      if (ours(n) || !onScreen(n)) continue;
      guideScanned++;
      const a = actionOf(n.textContent);
      if (a && !found.has(a)) found.set(a, n);
    }
    if (found.size) return found;

    for (const n of document.querySelectorAll('body *')) {
      if (ours(n) || !onScreen(n)) continue;
      const a = actionOf(n.textContent);
      if (!a || found.has(a)) continue;
      // Climb to the OUTERMOST element whose entire text is still just this word. That is
      // the control; anything above it has picked up a sibling's text and anything below is
      // a label inside it.
      //
      // The first version sniffed `cursor: pointer` instead and marked the wrong element on
      // its first real test, because cursor is INHERITED — a <span> inside a clickable <div>
      // reports pointer just as loudly as the div does, so the outline landed around the
      // text rather than around the button. Text containment is not inherited and cannot
      // make that mistake.
      let box = n;
      for (let up = 0; up < 4; up++) {
        const p = box.parentElement;
        if (!p || ours(p) || p === document.body) break;
        if (actionOf(p.textContent) !== a) break;
        box = p;
      }
      found.set(a, box);
    }
    return found;
  };

  // What the marks should be right now, or null for "nothing to mark". Read off the same
  // view the panel draws, so the button and the panel can never disagree.
  const guideTargets = (v) => {
    if (!ui.guide) return null;
    if (!active || !ROUTE.test(location.pathname)) return null;   // not at this table
    if (!v || !v.live) return null;
    // The felt draws "HAND ACTIONS UNAVAILABLE" in place of the whole row when the client
    // judges the server's table data incomplete, and your cash is half of the test it
    // uses. Marking a row that is not on screen is the confidently-wrong failure again.
    if (num(v.cfg.cash) === null) return null;
    const i = num(v.live.cur) ?? 0;
    const mine = (v.live.hands || [])[i];
    if (!mine) return null;
    const s = solve(mine.cards, upOf(v.live), v.comp, v.live.allowed);
    if (!s || !s.pick) return null;
    const cost = pressCost(s.ev, mine.stake);
    return { best: s.pick, worst: cost ? cost.worst : null, allowed: v.live.allowed };
  };

  // The game's own canvas. Phaser mounts exactly one and nothing else on this route draws
  // to one. Found by area rather than by class — a generated class is a hash that changes
  // every deploy (CLAUDE.md), and market-watch picks the chart's main pane out of a
  // library's several canvases the same way. Our own UI has no canvas at all, but it is
  // skipped anyway, because `ours()` is cheaper than the assumption staying true.
  //
  // Reading `width`, `height` and the box is ALL this does. It never asks for a drawing
  // context and never reads a pixel back: docs/01-rules-envelope.md puts canvas readback
  // next to the fingerprint headers, and tools/test-jack-passive.js fails the build if
  // `getContext`, `toDataURL` or `getImageData` ever appears in this file.
  const feltCanvas = () => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      if (ours(c)) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      if (!best || r.width * r.height > best.r.width * best.r.height) best = { c, r };
    }
    return best;
  };

  // The layer the felt's marks live on. Built once, on first use — a tool whose guide is
  // never switched on adds nothing to the page.
  let ovl = null;
  const overlay = () => {
    if (!ovl) { ovl = el('div', 'pkbj-ovl'); document.body.append(ovl); }
    return ovl;
  };
  const hideFelt = () => { if (ovl) { ovl.replaceChildren(); ovl.style.display = 'none'; } };

  let guideSeen = 0;              // how many buttons were located, for the panel
  let guideVia = null;            // 'felt' | 'dom' | null — which finder answered
  let guideNote = null;           // why the felt declined, when it did

  // Marks over the canvas. Returns false when this page is not a felt it recognises, so
  // the DOM finder below still gets its turn on a table that is ever built out of
  // elements again.
  const paintFelt = (want) => {
    guideNote = null;
    const found = feltCanvas();
    if (!found) return false;
    const row = feltRow(found.c.width, found.c.height, want.allowed);
    if (!row) {
      // A canvas this size is a table whose layout changed, and every pixel constant in
      // feltRow belongs to the two sizes it did not match. Saying which size it saw is
      // the difference between a one-line fix and another evening of guessing.
      guideNote = `the table is ${found.c.width}x${found.c.height}, which is not a felt this knows`;
      return false;
    }
    if (!(found.r.width > 0 && found.r.height > 0)) return false;

    const layer = overlay();
    layer.replaceChildren();
    for (const b of row) {
      // The worst press is only marked when it is a DIFFERENT button, which it always is
      // by construction — but a hand offering one action would otherwise take both marks
      // on the same box, which reads as a contradiction.
      const cls = b.action === want.best ? 'best'
        : (b.action === want.worst && want.worst !== want.best ? 'avoid' : null);
      if (!cls) continue;
      const box = feltPlace(b, found.r, found.c.width);
      const d = el('div', cls);
      d.style.left = `${box.left}px`;
      d.style.top = `${box.top}px`;
      d.style.width = `${box.width}px`;
      d.style.height = `${box.height}px`;
      layer.append(d);
    }
    layer.style.display = layer.firstChild ? 'block' : 'none';
    guideSeen = row.length;
    guideVia = 'felt';
    return true;
  };

  // The last thing the felt was asked to mark. Kept so the marks can be re-placed when
  // the canvas MOVES without the game changing state — a scroll, a resize, a zoom — which
  // is cheap, where re-deriving the whole view to answer the same question is not.
  let feltWant = null;
  let placing = 0;
  const placeFelt = () => {
    if (placing || !feltWant) return;
    placing = requestAnimationFrame(() => { placing = 0; if (feltWant) paintFelt(feltWant); });
  };

  // What the panel would SAY about the guide right now. The diagnosis line is the thing
  // you read when the marks are not where you expect, so a stale one is worse than no
  // line at all — a wrong count is what sent three versions chasing the wrong cause. The
  // panel only redraws on a repaint and the guide runs on its own observer, so the two
  // drift: the felt can stop being recognised while the panel still claims four buttons.
  // When what there is to say changes, ask for a repaint.
  //
  // Compared as a string and acted on only when it CHANGES, because render calls
  // paintGuide and this calls repaint, and that cycle has to be broken by something.
  // "Nothing new to say" is the honest place to break it: it settles after one frame.
  let guideSaid = null;
  const guideEcho = () => {
    const said = `${guideVia}|${guideSeen}|${guideNote}|${guideScanned}`;
    if (said === guideSaid) return;
    guideSaid = said;
    if (ui.open) repaint();
  };

  // `v` is handed in by render, which has just built it. The observer calls this with
  // nothing and pays for its own view() — that path only runs when the page actually
  // changed, which is exactly when the answer might be stale.
  const paintGuide = (v) => {
    const want = guideTargets(v === undefined ? view() : v);
    clearMarks();
    if (!want) {
      guideSeen = 0; guideVia = null; guideNote = null; feltWant = null;
      hideFelt(); guideEcho(); return;
    }

    // The felt first, because that is what this table actually is.
    if (paintFelt(want)) { feltWant = want; guideEcho(); return; }
    feltWant = null;
    hideFelt();

    const btns = actionButtons();
    guideSeen = btns.size;
    guideVia = btns.size ? 'dom' : null;
    const best = btns.get(want.best);
    if (best) best.classList.add(MARK_BEST);
    if (want.worst && want.worst !== want.best) {
      const bad = btns.get(want.worst);
      if (bad) bad.classList.add(MARK_WORST);
    }
    guideEcho();
  };

  // What the scanner can see, in a form that fits in a message. Written for the case the
  // guide keeps failing on a table nobody here can open: rather than another round of
  // guessing, it answers the questions that actually separate the causes.
  //
  // The canvas block leads, because the canvas is the answer on this table and its two
  // numbers decide everything. A backing size that is not one of the two known layouts is
  // the whole diagnosis — every pixel constant in `feltRow` is written against those two,
  // and the new ones are a one-line change once the size is known. A canvas whose backing
  // size and displayed box disagree in ASPECT would mean Phaser stopped letterboxing the
  // way FIT does, which is the one assumption the placement arithmetic rests on.
  //
  // The DOM block stays underneath for the table that is ever built out of elements:
  //
  //   Is the word in the page's text at all? If not, the label is drawn — canvas, an
  //   image, or a font trick — and no DOM reader will ever find it.
  //   Is it behind an iframe or a shadow root? Both are invisible to querySelectorAll from
  //   out here, and both need a different approach rather than a wider selector.
  //   If elements DO hold the word, are they failing the visibility test, or is their text
  //   longer than it looks?
  //
  // Truncated hard, and it names no player and no figure — it is a description of controls.
  const guideReport = () => {
    const L = [];
    const controls = [...document.querySelectorAll(CONTROLS)].filter((n) => !ours(n) && onScreen(n));
    const text = (document.body.innerText || '').toUpperCase();
    L.push(`jack-watch ${SCRIPT_VERSION} — guide diagnosis`);
    L.push(`route: ${location.pathname}`);
    L.push('');
    const canvases = [...document.querySelectorAll('canvas')].filter((n) => !ours(n));
    L.push(`canvases on the page: ${canvases.length}`
      + `  (known felts: ${FELT_LAYOUTS.map(([w, h]) => `${w}x${h}`).join(', ')})`);
    for (const c of canvases.slice(0, 4)) {
      const r = c.getBoundingClientRect();
      const known = FELT_LAYOUTS.some(([w, h]) => w === c.width && h === c.height);
      L.push(`    backing ${c.width}x${c.height} ${known ? '(known)' : '(UNKNOWN LAYOUT)'}`
        + ` · box ${Math.round(r.width)}x${Math.round(r.height)}`
        + ` · aspect backing ${(c.width / (c.height || 1)).toFixed(3)}`
        + ` vs box ${(r.width / (r.height || 1)).toFixed(3)}`);
    }
    L.push('');
    L.push(`visible controls matching the selector: ${controls.length}`);
    L.push(`iframes: ${document.querySelectorAll('iframe').length}`);
    let shadows = 0;
    for (const n of document.querySelectorAll('body *')) if (n.shadowRoot) shadows++;
    L.push(`open shadow roots: ${shadows}`);
    L.push('');
    for (const w of ['HIT', 'STAND', 'DOUBLE', 'SPLIT']) {
      const holders = [...document.querySelectorAll('body *')].filter((n) => !ours(n)
        && (n.textContent || '').toUpperCase().replace(/[^A-Z]/g, '') === w);
      const deepest = holders.filter((n) => ![...n.children].some((k) =>
        (k.textContent || '').toUpperCase().replace(/[^A-Z]/g, '') === w));
      L.push(`"${w}": in page text ${text.includes(w) ? 'YES' : 'no'}`
        + ` · elements whose whole text is exactly this: ${holders.length}`);
      for (const n of deepest.slice(0, 2)) {
        const cls = (typeof n.className === 'string' ? n.className : '').slice(0, 44);
        const r = n.getBoundingClientRect();
        L.push(`    <${n.tagName.toLowerCase()}> visible=${onScreen(n)}`
          + ` ${Math.round(r.width)}x${Math.round(r.height)} role=${n.getAttribute('role') || '-'}`
          + ` class="${cls}"`);
      }
    }
    L.push('');
    L.push('sample of the visible controls it did find:');
    for (const n of controls.slice(0, 10)) {
      const cls = (typeof n.className === 'string' ? n.className : '').slice(0, 32);
      L.push(`  <${n.tagName.toLowerCase()}> role=${n.getAttribute('role') || '-'}`
        + ` class="${cls}" text="${(n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`);
    }
    return L.join('\n');
  };

  // Idle until the page changes. `paintGuide` is cheap and re-entrant: it clears its own
  // marks and re-derives them, so a burst of mutations settles correctly.
  //
  // A mutation is not the only thing that moves a mark, though, and this is the part the
  // DOM version never needed: a class sits on its button through anything, while a box
  // pinned to viewport coordinates is wrong the moment the canvas moves under it. Three
  // things move it with no mutation at all — the page scrolling, the window resizing, and
  // a zoom — so each re-PLACES the marks without re-deriving them. Placement is a rect
  // and a few style writes; deriving is the whole view, and paying for that on every
  // scroll event is how a panel becomes the reason the table stutters.
  let guideObserver = null;
  const watchButtons = () => {
    if (guideObserver) return;
    // Only the GAME changing is news. Our own UI churns constantly — the panel rebuilds
    // its body on every render, and the mark layer rewrites its children every time the
    // marks move — and both of those are inside the subtree being watched.
    //
    // This is not an optimisation. Marking a DOM button was an ATTRIBUTE write, which a
    // childList observer never saw; drawing a layer is a childList write, which it sees
    // every time, and a repaint that re-triggers the observer that caused it does not
    // settle — it spins until the tab is killed. The bench found this in the first
    // second of the first run.
    guideObserver = new MutationObserver((recs) => {
      for (const r of recs) if (!ours(r.target)) { paintGuide(); return; }
    });
    guideObserver.observe(document.body, { childList: true, subtree: true });

    // Captured, because the felt sits in a scroll container of the app's rather than on
    // the document, and a scroll event there does not bubble.
    window.addEventListener('scroll', placeFelt, { capture: true, passive: true });
    window.addEventListener('resize', placeFelt);
    window.visualViewport?.addEventListener('resize', placeFelt);
    // The layout viewport changing width with no event at all, which is what a scrollbar
    // appearing or going does — and what the game's own pane does when the panel beside
    // it changes the page's height.
    try { new ResizeObserver(placeFelt).observe(document.documentElement); }
    catch { /* no ResizeObserver: the three listeners above still cover scroll and zoom */ }
  };

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
    // Idle until the page mutates. Started unconditionally rather than when the guide is
    // switched on, because the switch has to work while a hand is already on the table
    // and an observer that starts late misses the render it was needed for.
    watchButtons();
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
