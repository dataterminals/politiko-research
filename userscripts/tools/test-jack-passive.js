// The fence around jack-watch. Everything here is a property the tool has to KEEP.
//
//   It must not know how to play. This is the tool in the repo where that sentence has
//   to carry weight rather than decorate. Every other passive tool reads something the
//   game shows you badly; this one computes the correct action and prints it, which
//   leaves it exactly one line away from a bot — the line being a POST it does not know
//   how to build. On slots there was at least an argument that no automation was worth
//   writing, because the game already ships auto-spin. Blackjack ships nothing: every
//   deal and every action is a button, so the temptation is real and the fence is what
//   answers it. Neither endpoint, neither payload key and no idempotency key appears in
//   the file — not disabled, absent. See CLAUDE.md hard rule 2 and
//   docs/01-rules-envelope.md.
//
//   It must not be able to tell a GET from a POST. Not a slogan — enforced below. The
//   tool's own code never reads the verb, the request body, or the response status off a
//   tap record, and recognises a hand BY SHAPE. That is what lets it consume the state
//   you get back for pressing HIT without containing the means to press one.
//
//   It must raise nothing. Every figure in this panel is about money and one of them is
//   about a decision that is waiting on you, which makes it the most tempting thing in
//   the repo to shout about from a background tab. Clause 4 names that case. Nothing
//   here writes the title, the favicon, a sound or a notification, and the Notification
//   API is absent rather than off.
//
//   It must not launder one kind of claim into another. The panel computes, measures and
//   estimates, and those are three different things — tools/test-jack-ev.js drives the
//   arithmetic, and the checks here hold the labelling honest: the edge is solved rather
//   than quoted, the drag is measured rather than modelled, the band carries its sample
//   count, and no clock claims to know when a hand was played, because nothing on this
//   surface carries a timestamp.
//
//   It must not turn a one-sided test into a two-sided claim. The seventh sighting of a
//   card proves a reshuffle; nothing proves the absence of one. A panel that let "no
//   reshuffle seen yet" read as "the shoe persists" would be inventing the one fact this
//   surface refuses to give up, and every count on screen leans on it.
//
//   It must not carry a strategy table. The whole argument for a solver is that it is
//   derived from the stated rules and therefore follows the shoe; a lookup table is a
//   different tool wearing the same panel, and it would be wrong in exactly the cases the
//   COUNT tab exists for.
//
// Run: node userscripts/tools/test-jack-passive.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'jack-watch.user.js');
const SRC = fs.readFileSync(FILE, 'utf8');

// The disclosure block names what the tool promises NOT to do, so it has to be held
// apart from the code or it trips every check written here.
const HEADER = SRC.slice(0, SRC.indexOf('(() => {'));
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

// The tool's OWN code: everything that is not a copy-verbatim shared block. HTTP TAP
// legitimately reads a verb and a request body — that is what a tap is — so a check
// about what this tool reads has to be asked of this tool's lines and not of the kit's.
const strip = (src, from, to) => {
  const i = src.indexOf(from);
  const j = src.indexOf(to, i);
  if (i < 0 || j <= i) throw new Error(`shared block not found: ${from.slice(0, 48)}`);
  return src.slice(0, i) + src.slice(j + to.length);
};
const MINE = strip(
  strip(CODE, 'const HTTP_TAP_VERSION = 1;', 'return api.subscribe;'),
  'const draggable = (node, handle, onMove)', 'sized: () => !!mine,',
);

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        ${detail}`); fail++; }
};
const absent = (label, re, src) => {
  const hits = (src || CODE).match(re) || [];
  check(label, hits.length === 0, `found: ${hits.slice(0, 4).join(' | ')}`);
};

console.log('\n— it originates nothing —');

const fetchCalls = [...CODE.matchAll(/(?<![.\w])fetch\s*\(/g)].length;
const passthrough = [...CODE.matchAll(/origFetch\.apply\(/g)].length;
check('the only fetch call is the tap passing the game\'s own through',
  fetchCalls === 0 && passthrough === 1,
  `${fetchCalls} bare fetch( call(s), ${passthrough} passthrough(s); expected 0 and 1`);

check('...with the game\'s own arguments, unrewritten',
  /origFetch\.apply\(this, args\)/.test(CODE)
    && !/\bargs\s*=[^=]/.test(CODE) && !/args\[\d\]\s*=[^=]/.test(CODE),
  'expected origFetch.apply(this, args) and no assignment to args');

absent('it never constructs an XHR', /new\s+XMLHttpRequest/g);
absent('it never opens a socket', /new\s+WebSocket|new\s+EventSource/g);
absent('it never beacons', /sendBeacon/g);
absent('it never injects a fetching element',
  /new\s+Image\(|createElement\(\s*['"`](script|img|iframe|link|object|embed)/g);
absent('it never imports at runtime', /\bimport\s*\(/g);
absent('it names no write verb', /method:\s*['"`](POST|PUT|PATCH|DELETE)/gi);
absent('it builds no request body', /\bbody:\s*(JSON\.stringify|new\s+FormData|new\s+URLSearchParams)/g);

console.log('\n— it knows no way to play a hand —');

// The two mutations the whole page exists to fire, and the three strings that would be
// needed to fire either. Knowing the shape is the whole of the distance between a reader
// and a bot, and here — unlike slots — the game ships no automation of its own to make
// the question academic.
absent('it does not know the endpoint that deals a hand', /casino\/blackjack\/hands|['"`][^'"`]*\/hands\b/g);
absent('it does not know the endpoint that sends an action', /\/actions\b/g);
absent('it does not know the idempotency key', /idempotency/gi);
absent('...nor how one is minted', /randomUUID|crypto\./g);
absent('it does not know the deal payload shape', /[{,]\s*wager\s*:/g);
absent('it does not know the action payload shape', /[{,]\s*action\s*:/g);
absent('it names no play verb',
  /\bdoDeal|\bplaceBet|\bsendAction|\bplayHand|blackjack:(deal|action)/g);

// The only /api/ path in the tool's own code is the prefix it subscribes to. A second one
// is either a new subscription the disclosure does not cover, or a call.
const apiStrings = [...MINE.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map((m) => m[1]);
check('it names exactly one API path, and it is a prefix',
  apiStrings.length === 1 && apiStrings[0] === '/api/corporations/',
  `api paths named: ${apiStrings.join(' | ') || '(none)'}`);

// It does know the blackjack PAGE route — that is how it tells which table you are
// looking at — and a route is not an endpoint. Worth asserting so the difference stays
// deliberate rather than accidental.
check('the casino path it knows is a page, not an endpoint',
  /const ROUTE = \/\^\\\/corporations\\\/\(\\d\+\)\\\/casino\\\/blackjack/.test(MINE)
    && !/['"`][^'"`]*api[^'"`]*casino/.test(MINE),
  'the only casino path may be the page route used to identify the table in view');

console.log('\n— it cannot tell a GET from a POST —');

// This is the property that lets it consume the hand you get back for pressing a button
// without containing the means to press one. It is a real constraint on the code, so it
// is checked as one rather than asserted in prose.
check('the tap record is destructured to the path and the parsed body, and nothing else',
  /const consume = \(\{ path, data: payload \}\) =>/.test(MINE),
  'consume() must take { path, data } only');
absent('it never reads the verb off a record', /\.method\b|\bmethod\b/g, MINE);
absent('it never reads the request body off a record', /(?<!document)\.body\b/g, MINE);
// Unlike slot-watch this tool cannot ban `.status` outright — `status` is a field on the
// hand itself and half the panel turns on whether it says player_turn. So the ban is on
// the RECORD's fields by name, and the destructure above is what makes that airtight:
// what is never bound cannot be read.
absent('it never reads a response status or an ok flag',
  /\brec\.(ok|status|method|body)\b|\bpayload\.(ok|status(?!\b\s*===\s*['"`](player_turn|settled))|method)\b/g, MINE);

// The shape gate, and the reason none of the above costs it anything.
check('a hand is recognised by its shape',
  /const isHand = \(o\) => !!o && typeof o === 'object' && !Array\.isArray\(o\)\s*\n\s*&& num\(o\.id\) !== null && Array\.isArray\(o\.player_hands\) && Array\.isArray\(o\.dealer_cards\);/.test(CODE),
  'expected a shape gate over id + player_hands + dealer_cards');
check('...a settled one by the four receipt fields',
  /const SETTLED = \['total_wager', 'gross_payout', 'tax_amount', 'net_payout'\];/.test(CODE),
  'expected a shape gate for the settlement numbers');
check('...and a config by the pair only a table has',
  /num\(d\.blackjack_min_bet\) !== null && num\(d\.blackjack_max_bet\) !== null/.test(CODE),
  'expected a shape gate for the table config too');

console.log('\n— it raises nothing —');

// Clause 4's own worked example. Not off, not behind a flag: absent.
absent('it never notifies', /Notification|showNotification/g);
absent('it never registers a worker', /serviceWorker|pushManager|PushManager/g);
absent('it never plays a sound', /new\s+Audio\(|AudioContext|createOscillator/g);
absent('it never pokes the title bar', /document\.title\s*=/g);
absent('it never swaps the favicon', /rel=['"`]?icon|shortcut icon/gi);
absent('it never takes focus', /window\.focus\s*\(|\.blur\s*\(\)|alert\s*\(/g);
check('the disclosure says so in as many words',
  /Alerts:\s*none/i.test(HEADER),
  'the header must state that this tool raises no alerts');

// The one genuinely new temptation on this surface: a hand waiting on a decision is a
// deadline, and a deadline is what a background alert is for. It is allowed to light the
// button, and that is the whole of it.
check('a waiting hand lights the button and does nothing else',
  /fab\.classList\.toggle\('live', waiting\);/.test(CODE)
    && !/waiting[\s\S]{0,200}(document\.title|Notification|Audio)/.test(CODE),
  'a pending decision may only be shown in-page');

console.log('\n— nothing runs on its own —');

// One timer, and it changes a button's label. It may not reach the network, navigate, or
// repaint — a redraw on a schedule is the first half of alerting from a background tab.
const NAVISH = /fetch|XMLHttpRequest|pushState|PopStateEvent|location\s*\.|consume\s*\(|render\s*\(/;
const bodies = [...CODE.matchAll(/set(?:Timeout|Interval)\s*\(([\s\S]{0,260})/g)].map((m) => m[1]);
check('there is exactly one timer in the file', bodies.length === 1, `${bodies.length} found`);
check('...and it touches nothing but a label',
  bodies.every((b) => !NAVISH.test(b)),
  `suspect timer body: ${bodies.find((b) => NAVISH.test(b))?.slice(0, 120)}`);

// Repaints are coalesced onto an animation frame, which a hidden tab does not run — so
// the panel cannot spin in the background even by accident.
check('repaints are coalesced onto a frame, not a schedule',
  /requestAnimationFrame\(\(\) => \{ pending = 0; render\(\); \}\)/.test(CODE)
    && /if \(pending\) return;/.test(CODE),
  'expected a single-flight requestAnimationFrame coalescer');

// The two expensive computations are half a second each. Neither may be put on a
// schedule or run at boot: a solver that fires itself is a busy loop in a game tab.
check('the solve is behind a click and kept afterwards',
  /const r = roundEV\(freshShoe\(\)\);/.test(CODE)
    && /addEventListener\('click', \(\) => \{\s*\n\s*b\.disabled = true;/.test(CODE)
    && /data\.edge = \{ key: EDGE_KEY/.test(CODE),
  'roundEV() must be reachable only from a deliberate click, and cached after');
check('...and so is the grid',
  /gridCache = \{ key, grid: gridOf\(v\.comp\), mode: ui\.shoe \};/.test(CODE)
    && !/setTimeout[\s\S]{0,80}gridOf|requestAnimationFrame[\s\S]{0,80}gridOf/.test(CODE),
  'gridOf() must be reachable only from a deliberate click');
// Both solves freeze the tab, so the cost belongs on the button BEFORE it is pressed —
// nothing is painted between the click and the result, so a "solving…" label would be a
// promise the browser never gets a frame to keep.
check('...and both say what they will cost before you press them',
  /'solve the edge \(~2s\)'/.test(CODE) && /'solve the grid for this shoe \(~2s\)'/.test(CODE)
    && !/textContent = 'solving/.test(CODE),
  'a synchronous solve must advertise its cost on the button, not mid-freeze');

console.log('\n— it reads responses, never requests —');

check('it subscribes to one path prefix by name, not to everything',
  /onApi\('\/api\/corporations\/', consume\)/.test(CODE) && !/onApi\(\s*'\*'/.test(CODE),
  'a * subscriber opts the whole repo back into parsing every response');
absent('it never reads the auth key', /['"`]auth['"`]\s*\)|getItem\(\s*['"`]auth/g);
absent('it never reads the device fingerprint', /device_signals/g);

// The five fingerprint headers are how multi-accounting is enforced. A passive tap sees
// them; touching them is indistinguishable from evading that enforcement.
absent('it never touches the fingerprint headers', /X-CT-(TZ|Screen|Lang|Platform|Canvas)/gi);

console.log('\n— the solver is derived, not recited —');

// A lookup table would be a different tool in the same panel: right off the top of the
// shoe, wrong in exactly the cases COUNT exists for, and unable to say what any other
// action costs. So the rules are declared once and everything comes out of them.
check('the rule set is stated once, as data, where it can be read',
  /const RULES = Object\.freeze\(\{/.test(CODE)
    && /decks: 6,/.test(CODE) && /naturalPays: 1\.5,/.test(CODE)
    && /standsSoft17: true,/.test(CODE) && /splits: 1,/.test(CODE)
    && /doubleAfterSplit: true,/.test(CODE) && /splitAcesOneCard: true,/.test(CODE)
    && /peek: true,/.test(CODE),
  'the eight rules the House rules aside prints must be declared, not scattered');
check('...and the S17 line lives in one function rather than in a >=',
  /const dealerStands = \(t, a\) => \{/.test(CODE)
    && /return RULES\.standsSoft17 \|\| !isSoft\(t, a\);/.test(CODE),
  'expected dealerStands() to be the only place the soft-17 rule is decided');
check('the recommendation is an argmax over computed EV',
  /for \(const a in ev\) if \(pick === null \|\| ev\[a\] > ev\[pick\]\) pick = a;/.test(CODE),
  'the pick must be whichever action prices highest, and nothing else');
check('...over only the actions the table itself offered',
  /const can = Array\.isArray\(allowed\) && allowed\.length/.test(CODE),
  'allowed_actions is the server\'s list and is what the solver is restricted to');

// A strategy table would show up as a long run of action letters or words in a literal.
// This is deliberately blunt, which is the point: it catches the paste.
const literals = [...MINE.matchAll(/['"`]([HSDPhsdp]{8,})['"`]/g)].map((m) => m[1]);
check('there is no strategy table anywhere in the file', literals.length === 0,
  `looks like a lookup row: ${literals.slice(0, 3).join(' | ')}`);
absent('...and no index numbers either', /illustrious|\bI18\b|deviation(Index|Table)/gi);

console.log('\n— a computation, a measurement and an estimate stay apart —');

// COMPUTED. The edge is solved from the rules by summing over every deal. The moment it
// acquires a fudge factor, or gets read off a field, the panel's strongest claim stops
// being true — and there IS no field: this surface advertises no RTP and no edge.
check('the edge is summed over every deal, not read off a payload',
  /const roundEV = \(shoe\) => \{/.test(CODE) && /ev \+= pHand \* pUp \* e;/.test(CODE),
  'roundEV must integrate over the deal');
absent('...and there is no edge field on this surface to be tempted by',
  /house_edge_bps|theoretical_rtp_bps|_rtp_bps/g);
check('expected loss is the solved edge times the stake, and nothing else',
  /expLoss: e === null \? null : staked \* e,/.test(CODE),
  'expLoss must use the solved edge alone');
check('...and "cover" assumes nothing at all',
  /cover: bank === null \? null : Math\.floor\(bank \/ w\),/.test(CODE),
  'cover must be bankroll over bet, floored');

// MEASURED. Tax drag is a division of two observed sums; the moment it acquires a
// coefficient it has become a model wearing a measurement's label. Same for the staking
// multiplier, which is the other place a guess would be easy and invisible.
check('tax drag is measured, not modelled',
  /taxDrag: wagered \? tax \/ wagered : null,/.test(CODE),
  'tax drag must be observed tax over observed stake');
check('...and so is what a round really stakes',
  /stakeMult: opened \? wagered \/ opened : null,/.test(CODE),
  'the staking multiplier must be two observed sums');
check('the effective edge is the solved one plus the measured drag, and says so',
  /effEdge: edge === null \? null : edge \+ \(drag2 \?\? 0\),/.test(CODE)
    && /'computed \+ measured'/.test(CODE),
  'expected effEdge and a label naming both halves');

// ESTIMATED. The band is a sample deviation, it carries its count, and nothing anywhere
// turns it into a probability.
check('the band is a sample deviation and carries its count',
  /band: s === null \? null : w \* Math\.sqrt\(n\) \* s,/.test(CODE) && /bandN:/.test(CODE),
  'expected a sample band with its n');
check('...and is printed as an estimate',
  /stat\(g2, '± 1 sd'[\s\S]{0,120}'est'/.test(CODE),
  'the band must be styled as an estimate wherever it is printed');
absent('nothing quotes a risk of ruin', /riskOfRuin|ruinProb|probabilityOf/gi);
check('...and the panel says why not',
  /will not\s*\n?\s*\+ 'quote you a risk of ruin/.test(CODE) || /risk of ruin/.test(CODE),
  'the note must say the band is a band, not a probability');

console.log('\n— the count never becomes a claim about the shoe —');

// One-sided, and the whole reason the count is allowed on screen at all. A seventh
// sighting proves a reshuffle; nothing proves persistence, and the panel has to say so
// in the branch where nothing has been proved — which is the branch that will be showing
// almost all of the time.
check('a reshuffle is proved by a seventh sighting of one card',
  /if \(\(byCode\[code\] \|\| 0\) \+ tally\[code\] > PER_CODE\) overflows = true;/.test(CODE)
    && /const PER_CODE = RULES\.decks;/.test(CODE),
  'expected the six-of-each test');
check('...and a hand goes wholly into one shoe or the other',
  /if \(overflows\) \{\s*breaks\.push\(\{ id: h\.id, after: sinceBreak \}\);\s*segments\+\+; sinceBreak = 0; reset\(\);\s*\}/.test(CODE)
    && CODE.indexOf('if ((byCode[code] || 0) + tally[code] > PER_CODE) overflows = true;')
       < CODE.indexOf('byCode[code] = (byCode[code] || 0) + 1;'),
  'a hand split across a reshuffle would corrupt both counts, so the whole hand is tested first');

// A break on its own settles nothing — every shoe policy trips this test eventually,
// because the walk keeps counting across a real reshuffle it cannot see. What separates
// them is how far apart the breaks land, so the gap is the thing that has to be measured
// and shown, and it has to be measured in ROUNDS THIS LEDGER HOLDS rather than in hand
// ids. Not because ids are unusable — 51 rounds of real play came back contiguous — but
// because the ledger is what has holes in it: hands from before you installed this, hands
// history had already dropped, hands the cap pruned. The cadence being measured is a
// cadence of observations, so it is counted in observations.
check('the gap between breaks is measured, in rounds rather than in ids',
  /breaks\.push\(\{ id: h\.id, after: sinceBreak \}\)/.test(CODE)
    && /const gaps = breaks\.slice\(1\)\.map\(\(b\) => b\.after\);/.test(CODE)
    && /gapMean:|gapMin:|gapMax:/.test(CODE),
  'expected a per-round gap between breaks, with its spread');
check('...and the panel says a break alone settles nothing',
  /A break on its own settles nothing/.test(CODE) && /The GAP is the measurement/.test(CODE),
  'the proved branch must not read as evidence against a persistent shoe');
check('...and the simulated yardstick is labelled as simulated',
  /Simulated, not observed; see docs\/19\./.test(CODE)
    && /const GAP_KEY = /.test(CODE) && /const GAP_TYPICAL = /.test(CODE),
  'the only numbers here that came from a simulation must say so where they print');
check('...and "not proved" is never printed as "did not happen"',
  /No reshuffle proven yet/.test(CODE) && /PROVES NOTHING/.test(CODE),
  'the unproved branch must say that it proves nothing');
check('the three limits on any count here are printed with it',
  /You only ever see /.test(CODE) && /hole card is face down/.test(CODE)
    && /a count is only a proxy/.test(CODE),
  'other players, the hole card, and count-as-proxy all belong on the COUNT tab');
// The strongest version of this: the true count may reach a stat box and nowhere else.
// A count that fed the solver would be an index system with the indexes hidden, and it
// would be strictly worse than the composition the solver already holds.
const trueLines = MINE.split('\n').filter((l) => /\.true\b/.test(l));
check('nothing is derived from the count',
  trueLines.length > 0 && trueLines.every((l) => /stat\(/.test(l) || /^\s*null,/.test(l)),
  `the true count reaches something other than a stat box: ${trueLines.find((l) => !/stat\(/.test(l))}`);
check('the shoe assumption is named wherever the solver is used',
  /const shoeNote = \(v\) => \{/.test(CODE)
    && [...CODE.matchAll(/shoeNote\(v\)/g)].length >= 2,
  'both the HAND and COUNT tabs must state which composition is in force');

console.log('\n— no clock claims to know more than it does —');

// The panel says the word "timestamp" a good deal, because saying there is none is half
// the point of the LOG tab. What must not appear is a READ of one.
absent('no field is read as a time',
  /\.(created_at|played_at|updated_at|timestamp|dealt_at|settled_at)\b/gi);
absent('...and none is looked for by name either',
  /\b(created_at|played_at|updated_at)\b/g, MINE.replace(/'[^']*'/g, "''"));
check('every clock is a local first-seen stamp',
  /slim\.seen = prev \? prev\.seen : at;/.test(CODE)
    && /out\.seen = old\.seen;/.test(CODE),
  'first seen must be set once and never moved');
check('...and is labelled as one on screen',
  /first read the /.test(SRC) && /nothing on this surface carries a timestamp/i.test(SRC),
  'the disclosure and the panel must both say what the clock means');
check('ordering is by hand id, which is the only ordering the wire gives',
  /sort\(\(a, b\) => b\.id - a\.id\)/.test(CODE),
  'expected the ledger to be ordered by id');

console.log('\n— clearing the panel hides, and never deletes —');

const drops = [...CODE.matchAll(/delete\s+c\.hands\[/g)].length;
check('the only hand ever removed is the one the cap pushes out',
  drops === 1 && /for \(const h of all\.slice\(MAX_HANDS\)\) delete c\.hands\[h\.id\];/.test(CODE),
  `${drops} deletion(s) of a stored hand; expected exactly the one in prune()`);
check('...so the mark is a floor, applied in one place',
  /const above = \(list, floor\) => \(num\(floor\) === null \? list : list\.filter\(\(h\) => h\.id > floor\)\);/.test(CODE)
    && [...CODE.matchAll(/above\(held, floor\)/g)].length === 1,
  'expected a single id floor and exactly one call site for it');
check('...and every money figure is computed over what is left',
  /const list = above\(held, floor\);/.test(CODE) && /const roll = rollup\(list\);/.test(CODE)
    && /const returns = roundReturns\(list\);/.test(CODE),
  'the rollup and the per-round sample must both read the filtered list');

// But the shoe is not money. A mark hides what you would rather not look at; it cannot
// un-deal a card, and a count that restarted because you pressed "clear" would be wrong
// in a way nothing on screen could explain.
check('...but the shoe is read from every hand, marked or not',
  /const shoe = shoeState\(held\.slice\(\)\.reverse\(\)\);/.test(CODE)
    && /it cannot un-deal a card/.test(CODE),
  'the count must be built from held, not from the filtered list');

check('the panel says when it is showing you a subset',
  /subtitle\.textContent = v\.floor === null \? where : `\$\{where\} · from #\$\{v\.floor\}`;/.test(CODE)
    && /pkbj-scope/.test(CODE) && /Showing this run only/.test(CODE),
  'a mark must be named in the title bar and explained above the tab');
check('...and the way back is always reachable',
  /delete ui\.mark\[v\.id\]/.test(CODE) && /if \(!v\.held\) \{/.test(CODE),
  'an "all" button must exist, and an empty view must not early-return past it');

console.log('\n— it stays inside its own storage —');

const keys = [...CODE.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*([^,)]+)/g)].map((m) => m[1].trim());
check('every localStorage key is one of its own',
  keys.length > 0 && keys.every((k) => /^k$|^K\.(data|ui)$/.test(k)),
  `keys touched: ${keys.join(' | ')}`);
check('...and they are namespaced to this tool',
  /const K = \{ data: 'pkbj:data', ui: 'pkbj:ui' \};/.test(CODE),
  'expected the pkbj: prefix');

// The ledger is bounded. Four hundred rounds of cards in localStorage is a quota error
// that eats the panel state on the way out.
check('the ledger and the decision list are both capped',
  /const MAX_HANDS = \d+;/.test(CODE) && /const MAX_DECISIONS = \d+;/.test(CODE)
    && /c\.decisions\.splice\(0, c\.decisions\.length - MAX_DECISIONS\);/.test(CODE),
  'expected both caps');
// The solved grid is derived and would be stale the moment the shoe moved, so it lives
// in memory and dies with the tab. The edge is a constant and is kept.
check('the grid is never persisted, and the edge always is',
  /let gridCache = null;/.test(CODE) && !/K\.data[\s\S]{0,80}grid/.test(CODE)
    && /const EDGE_KEY = /.test(CODE),
  'a stored grid would outlive the shoe it describes');

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
