// Fence + behaviour tests for xp-watch.
//
// xp-watch wraps window.fetch to read responses the game already requested. The
// wrap itself must be incapable of originating anything, the router must be a
// strict allowlist (chat and messages structurally unrecordable), and the delta
// engine's attribution rules are the whole point of the tool — a wrong
// attribution silently poisons the per-action numbers the crew asked for.
//
// Two layers, same approach as test-passive.js:
//
//   1. A STATIC fence over the whole shipped file, comments included — blunt
//      substring counts that cannot be talked out of a match.
//
//   2. BEHAVIOUR tests that slice the router/scrub/engine layer out of the
//      shipped file and drive it, so the tests cannot drift from what installs.
//
// Run: node userscripts/tools/test-xp.js
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'xp-watch.user.js');
const SRC = fs.readFileSync(FILE, 'utf8');

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};
const ok = (label, cond) => check(label, !!cond, true);

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from.slice(0, 40)} .. ${to.slice(0, 40)}`);
  return SRC.slice(i, j);
};

// ---------------------------------------------------------------------------
// 1. The static fence
// ---------------------------------------------------------------------------
console.log('\n— static fence: nothing in this file can originate traffic —');

// Everything that could put bytes on a wire. `fetch(` is included: the tap is a
// property *assignment* plus `origFetch.apply`, so a correct file contains zero
// call-shaped fetch tokens.
const BANNED = [
  'fetch(',
  '.send(',
  'new WebSocket',
  'XMLHttpRequest',
  'sendBeacon',
  'EventSource',
  'Notification(',
  'CustomEvent',
  'chat:open-dm',
  'importScripts',
  'WebSocket.prototype',
];
for (const tok of BANNED) {
  const n = SRC.split(tok).length - 1;
  check(`no occurrence of ${JSON.stringify(tok)}`, n, 0);
}

// `dispatchEvent` is NOT banned outright here, unlike in ws-watch — but the
// reason it is banned there still applies and the exception is deliberately
// hair-thin. ws-watch bans it because the game listens for a `chat:open-dm`
// window event whose handler's first act is to transmit a join frame; any
// event we dispatch that the GAME listens for can originate traffic. The one
// event allowed here is a popstate telling the app's own router that we
// changed the URL — the same client-side navigation align-watch performs, and
// the same thing clicking a nav link does. `CustomEvent` stays banned above,
// which is the constructor that vector needs.
{
  const dispatches = SRC.match(/dispatchEvent\([^)]*\)/g) ?? [];
  check('dispatchEvent appears exactly once', dispatches.length, 1);
  check('the one dispatch is a router popstate', dispatches[0], "dispatchEvent(new PopStateEvent('popstate')");
}

check('exactly one `window.fetch =` (the wrap)', SRC.split('window.fetch =').length - 1, 1);
check('exactly one `origFetch.apply` (the pass-through)', SRC.split('origFetch.apply').length - 1, 1);
check('exactly one localStorage.getItem (inside readJSON)', SRC.split('localStorage.getItem').length - 1, 1);

// The metadata block has to be right or the wrap lands on a sandboxed window
// and the tap silently observes nothing.
ok('@grant none', /^\/\/ @grant\s+none$/m.test(SRC));
ok('@run-at document-start', /^\/\/ @run-at\s+document-start$/m.test(SRC));
ok('@match is politiko.io only', /^\/\/ @match\s+https:\/\/politiko\.io\/\*$/m.test(SRC));
ok('declares @version', /^\/\/ @version\s+\d+\.\d+\.\d+$/m.test(SRC));
ok('no @require (single auditable file)', !/^\/\/ @require/m.test(SRC));

// Clause 6: the header must say what a suspicious reader needs.
const HEAD = SRC.slice(0, SRC.indexOf('(() => {'));
ok('disclosure states zero added requests', /ZERO additional requests/.test(HEAD));
ok('disclosure names the storage prefix', HEAD.includes('pkxp:'));
ok('disclosure says the auth key is never touched', /`auth` localStorage key/.test(HEAD) && /never touched/.test(HEAD));
ok('disclosure says other players are never stored', /Another player/.test(HEAD));
// 0.9.0 reads request bodies, so the line that used to say it never did is gone —
// and what replaces it has to name every endpoint and every field, or the tool is
// doing something its header does not say (clause 6).
{
  const flat = HEAD.replace(/\n \*/g, ' ').replace(/\s+/g, ' ');
  ok('disclosure has a Request bodies section', /Request bodies: read on FIVE action endpoints and nowhere else/.test(flat));
  for (const [ep, fields] of [
    ['POST /api/disobedience', 'issue_id → issue, site_key → site, leaning'],
    ['POST /api/protests', 'issue_id → issue, stance'],
    ['POST /api/protests/<id>/join', 'side'],
    ['POST /api/actions/graffiti', 'location_key → site, side'],
    ['POST /api/actions/poll', 'issue'],
  ]) ok(`...names ${ep} and its fields`, flat.includes(`${ep} ${fields}`));
  ok('...says a Request object body is never touched', /Request object is a stream the app has not consumed, and is never touched/.test(flat));
  ok('...and that everything else is left unread', /every body on every other endpoint, is left unread/.test(flat));
  ok('no stale "never read" claim survives', !/bodies are never read/.test(flat));
  ok('disclosure names the two lookup reads', flat.includes('GET /api/actions/poll/issues') && flat.includes('GET /api/protests, /api/protests/<id>'));
  ok('...and says the protest lookup is memory-only', /held in memory for this page load, never stored/.test(flat));
}

// The body is read in exactly one place, after the request has gone, for an action
// that succeeded — and nowhere else. `bodyOf` is called from `aimFor` only, and
// `aimFor` from the tap only.
check('bodyOf is called once (inside aimFor)', (SRC.match(/bodyOf\(args\)/g) ?? []).length, 1);
check('aimFor is called once', (SRC.match(/aimFor\(msg, args, protestIssue\)/g) ?? []).length, 1);
ok('...only for a successful action',
  /if \(msg && res\.ok && msg\.kind === 'action'\) msg = \{ \.\.\.msg, aim: aimFor\(msg, args, protestIssue\) \};/.test(SRC));
ok('...after the request has already gone',
  SRC.indexOf('const res = await origFetch.apply(this, args);') < SRC.indexOf('aimFor(msg, args, protestIssue)'));
ok('the protest lookup is never written anywhere', !/writeJSON\([^)]*protestIssue/.test(SRC) && !/L\.[a-zA-Z]+\s*=\s*protestIssue/.test(SRC));
ok('the event is built from named fields and the aim, never from the whole message',
  /pushEvent\(L, \{ t, kind: 'action', ep: msg\.ep, outcome: o, \.\.\.aimed\(L, msg, data\) \}\);/.test(SRC));

// The home button is a client-side route change to the router's INDEX path.
// `/home` is not a route in this app (measured); the game's own nav links to `/`.
ok('home button pushes the index path', /history\.pushState\(\{\}, '', '\/'\)/.test(SRC));
ok('home button is a route change, not a request', /new PopStateEvent\('popstate'\)/.test(SRC));
ok('no /home path anywhere', !SRC.includes("'/home'"));

// rAF alone latches when the page is not compositing; a stale panel reads as a
// broken tool. The render scheduler must carry a timer backstop.
ok('render scheduler has a non-rAF backstop', /requestAnimationFrame\(run\);\s*\n\s*setTimeout\(run, \d+\);/.test(SRC));

// PANEL KIT must be the shared block, not a local reimplementation.
ok('carries PANEL KIT v3 verbatim marker', SRC.includes('PANEL KIT v3 — shared verbatim block'));
ok('calls fit() after render', /if \(drag\) drag\.fit\(\);/.test(SRC));

// Resize used to be a local copy of this logic, living right here. PANEL KIT v3
// carries it now, so the kit's own guarantees — the pointerup backstop, the viewport
// cap, pinning the panel to left/top before the grab so it grows toward the pointer —
// are asserted once for every tool in tools/test-placement.js. What is left here is
// this tool's wiring, which is the part the kit cannot check for itself.
ok('the panel is resizable', /resize = resizable\(panel,/.test(SRC));
ok('...and is handed the drag, so a resize can re-fit the panel',
  /resize = resizable\(panel,[\s\S]{0,240}\{ drag, minW: \d+, minH: \d+ \}/.test(SRC));
ok('size is persisted under the ui key',
  /ui\.size = size \?\? undefined; writeJSON\(K\.ui, ui\);/.test(SRC));
ok('size is restored on mount', /if \(ui\.size\) resize\.apply\(ui\.size\);/.test(SRC));
ok('double-click clears the stored size, not just the position',
  /dblclick[\s\S]{0,200}drag\.reset\(\);\s*\n\s*resize\.reset\(\);/.test(SRC));

// The render path must be gated on visibility (no work from an unfocused tab).
ok('render is visibility-gated', SRC.includes("document.visibilityState !== 'visible'"));

// CLAUDE.md: a table in a panel may ship without draggable dividers, never without fixed
// layout — the horizontal scrollbar is the failure. Through 0.9.0 this panel's actions
// table measured 1693px wide in a 325px body on the bench. 0.9.1 takes the floor
// slot-watch and jack-watch set: fixed layout, declared widths summing to 100, an
// ellipsis where a cell does not fit, and the whole value in a title.
console.log('\n— 0.9.1: every table is fixed-layout, and every cell keeps its value —');
ok('the panel\'s tables are table-layout: fixed', /#pkxp table\{[^}]*table-layout:fixed[^}]*\}/.test(SRC));
ok('...and a cell that does not fit ends in an ellipsis rather than widening its column',
  /#pkxp td,#pkxp th\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis[^}]*\}/.test(SRC));
{
  const opens = SRC.match(/<table/g) ?? [];
  const declared = SRC.match(/<table>\$\{colgroup\('(feed|skills|acts)'\)\}/g) ?? [];
  check('every table opens on a declared colgroup', [opens.length, declared.length], [3, 3]);
}
check('no cell is written by hand — every one goes through cell(), which always writes a title',
  (SRC.match(/<t[dh][\s>]/g) ?? []).length, 0);
ok('cell() writes the title unconditionally, defaulting to the cell\'s own text',
  /const cell = \(tag, text, \{ cls = '', style = '', title = text, html = null \} = \{\}\) =>/.test(SRC)
    && / title="\$\{esc\(title\)\}">\$\{html \?\? esc\(text\)\}<\/\$\{tag\}>`;/.test(SRC));
ok('numeric headers sit over their numbers', /#pkxp th\.num\{text-align:right\}/.test(SRC));
ok('the footer wraps instead of clipping a button at the resize floor', /#pkxp \.ft\{display:flex;flex-wrap:wrap;/.test(SRC));
{
  const T = new Function(`${cut('  const esc = (s)', '  const CSS = `')}
    return { TABLE_COLS, colgroup, cell, plain, attribText, attribTitle };`)();
  for (const [name, widths] of Object.entries(T.TABLE_COLS)) {
    check(`${name}: declared widths sum to 100`, widths.reduce((s, w) => s + w, 0), 100);
    check(`${name}: the colgroup declares one col per width`, (T.colgroup(name).match(/<col style="width:\d+%">/g) ?? []).length, widths.length);
  }
  // The colgroup has to match the cells the table actually draws, or a fixed layout
  // hands the missing columns zero width and the last cell swallows the rest.
  const seg = (name) => SRC.slice(SRC.indexOf(`colgroup('${name}')}`), SRC.indexOf('</table>', SRC.indexOf(`colgroup('${name}')}`)));
  const count = (s, re) => (s.match(re) ?? []).length;
  check('feed: four cells a row, four columns', count(seg('feed'), /cell\('td'/g), T.TABLE_COLS.feed.length);
  check('skills: five headers, five cells a row, five columns',
    [count(seg('skills'), /cell\('th'/g), count(seg('skills'), /cell\('td'/g)], [T.TABLE_COLS.skills.length, T.TABLE_COLS.skills.length]);
  check('actions: four headers, four columns', count(seg('acts'), /cell\('th'/g), T.TABLE_COLS.acts.length);

  check('a cell carries its text as its title, escaped once in each place',
    T.cell('td', 'a"b<c', { cls: 'num' }), '<td class="num" title="a&quot;b&lt;c">a&quot;b&lt;c</td>');
  check('...and even an empty cell writes the attribute', T.cell('th', ''), '<th title=""></th>');
  const inferred = { type: 'inferred', ep: '/disobedience', n: 19, by: [{ ep: '/actions/poll', alone: 5 }] };
  check('the inferred label is markup, and its plain text has none', T.plain(T.attribText(inferred)), '≈ disobedience ×19');
  ok('...while its title stays the 0.9.0 reason', /^Inferred by exclusion, not measured\./.test(T.attribTitle(inferred)));
  check('a label that owes no reason is titled with itself', T.attribTitle({ type: 'action', ep: '/disobedience', n: 2 }), '');
  ok('...which is why the feed falls back to its plain text', /title: attribTitle\(d\.attrib\) \|\| plain\(attribText\(d\.attrib\)\)/.test(SRC));
}

// ---------------------------------------------------------------------------
// 2. Slice the router / scrub / engine layer and drive it
// ---------------------------------------------------------------------------
const ENGINE = cut('  const slug = (label)', '  // Persistent state');
const build = () => new Function('log', `${ENGINE}
  return { slug, classify, outcomeOf, scrub, makeLedger, ingest, recordSample, buildReport, EPS, CAP,
    bodyOf, aimOf, aimFor, issueKey, issueName, harvestProtests, MIN_ALONE };`)(() => {});
const E = build();

console.log('\n— router: a strict allowlist —');
{
  const c = (u, m) => E.classify(u, m);
  check('own stats GET', c('https://politiko.io/api/users/Ms.%20Deni/stats', 'GET'), { kind: 'stats-sheet', name: 'Ms. Deni' });
  check('train GET', c('/api/train', 'GET'), { kind: 'train-sheet' });
  check('train POST', c('/api/train', 'POST'), { kind: 'train-award' });
  check('status GET', c('/api/user/status', 'GET'), { kind: 'status' });
  check('progression GET', c('/api/user/progression', 'GET'), { kind: 'assessment' });
  check('education overview', c('/api/education', 'GET'), { kind: 'education' });
  check('education track', c('/api/education/law', 'GET'), { kind: 'education' });
  check('car theft start', c('/api/actions/car-theft/start', 'POST'), { kind: 'action', ep: '/actions/car-theft/start' });
  check('graffiti', c('/api/actions/graffiti', 'POST'), { kind: 'action', ep: '/actions/graffiti' });
  check('deal-drugs', c('/api/actions/deal-drugs', 'POST'), { kind: 'action', ep: '/actions/deal-drugs' });
  check('sleeper meet: id collapsed', c('/api/actions/sleeper-recruitment/44/meet', 'POST'), { kind: 'action', ep: '/actions/sleeper-recruitment/{id}/meet' });
  check('combat action: id collapsed', c('/api/combat/17/action', 'POST'), { kind: 'action', ep: '/combat/{id}/action' });
  check('combat resolve: id collapsed', c('/api/combat/17/resolve', 'POST'), { kind: 'action', ep: '/combat/{id}/resolve' });
  check('terminal exec', c('/api/terminal/exec', 'POST'), { kind: 'action', ep: '/terminal/exec' });
  check('bank rob', c('/api/city/bank/rob', 'POST'), { kind: 'action', ep: '/city/bank/rob' });
  check('travel', c('/api/travel', 'POST'), { kind: 'action', ep: '/travel' });
  check('disobedience', c('/api/disobedience', 'POST'), { kind: 'action', ep: '/disobedience' });
  // The ref rides the routing message so the tap can look the protest's issue up;
  // the engine tests below prove it never reaches an event.
  check('protest join: id collapsed, ref kept for the lookup', c('/api/protests/9/join', 'POST'), { kind: 'action', ep: '/protests/{id}/join', ref: '9' });
  check('protest start', c('/api/protests', 'POST'), { kind: 'action', ep: '/protests' });
  check('protest leave is not an action', c('/api/protests/9/leave', 'POST'), null);
  check('poll issue list is a lookup', c('/api/actions/poll/issues', 'GET'), { kind: 'issue-list' });
  check('protest list is a lookup', c('/api/protests?location_id=4', 'GET'), { kind: 'protests' });
  check('one protest is a lookup', c('/api/protests/9', 'GET'), { kind: 'protests' });

  // The privacy-load-bearing negatives: chat and mail can never be recorded
  // because the router refuses to classify them at all.
  check('chat settings → dropped', c('/api/chat/settings', 'GET'), null);
  check('chat history → dropped', c('/api/chat/rooms/3/history', 'GET'), null);
  check('messages → dropped', c('/api/messages', 'POST'), null);
  check('message reply → dropped', c('/api/messages/5/reply', 'POST'), null);
  check('another player profile → dropped', c('/api/users/somebody', 'GET'), null);
  check('stats via POST → dropped', c('/api/users/me/stats', 'POST'), null);
  check('bank collect (not a crime) → dropped', c('/api/city/bank/collect', 'POST'), null);
  check('non-api → dropped', c('https://politiko.io/assets/index.js', 'GET'), null);
  check('other origin api → still parsed by path only', c('https://politiko.io/api/train', 'GET'), { kind: 'train-sheet' });
}

console.log('\n— outcome classifier: the MEASURED wire fields, never guessed —');
{
  check('car theft jailed', E.outcomeOf('/actions/car-theft/resolve-timeout', { jailed: true }), 'bust');
  check('car theft complete', E.outcomeOf('/actions/car-theft/choice', { complete: true }), 'success');
  check('car theft mid-flow', E.outcomeOf('/actions/car-theft/start', { stage: 'chase' }), 'in-progress');
  // Real 2026-08-11 graffiti payload shape: success + arrested/hospitalized.
  check('graffiti success', E.outcomeOf('/actions/graffiti', { success: true, arrested: false, hospitalized: false }), 'success');
  check('graffiti plain fail', E.outcomeOf('/actions/graffiti', { success: false, arrested: false, hospitalized: false }), 'fail');
  // The distinction klyde's question needs: failing and being hospitalised are
  // separate facts, and "did a failed action still pay XP" needs them apart.
  check('graffiti fail + hospitalised', E.outcomeOf('/actions/graffiti', { success: false, hospitalized: true }), 'fail+hospitalized');
  check('graffiti fail + arrested', E.outcomeOf('/actions/graffiti', { success: false, arrested: true }), 'fail+arrested');
  check('disobedience success while jailed', E.outcomeOf('/disobedience', { success: true, jailed: true }), 'success+jailed');
  check('bust without a success field', E.outcomeOf('/actions/deal-drugs', { jailed: true }), 'bust');
  check('unknown shape stays null', E.outcomeOf('/actions/deal-drugs', { message: 'sold' }), null);
  // The misread that shipped in 0.1.0: these are animation keys in the bundle,
  // not response fields. They must not resurrect as a success signal.
  check('bundle animation keys are not outcome fields', E.outcomeOf('/actions/graffiti', { paint_landed: true }), null);
}

console.log('\n— scrub: keys survive, people and credentials do not —');
{
  const s = E.scrub({
    access_token: 'SENTINEL-A', username: 'klyde', combatant: 'officer bob',
    username_of_officer: 'bob', arresting_officer: 'sgt pepper',
    xp_gained: 1.25, nested: { refresh_token: 'SENTINEL-B', street_sense: 0.5 },
  });
  check('credential value redacted', s.access_token, '[redacted]');
  check('nested credential redacted', s.nested.refresh_token, '[redacted]');
  check('person key kept, value typed out', s.username, '<string>');
  check('combatant scrubbed', s.combatant, '<string>');
  check('person-shaped compound key scrubbed (containment, not exact)', s.username_of_officer, '<string>');
  check('officer key scrubbed', s.arresting_officer, '<string>');
  check('numbers untouched', s.xp_gained, 1.25);
  check('nested numbers untouched', s.nested.street_sense, 0.5);
  ok('no sentinel survives anywhere', !JSON.stringify(s).includes('SENTINEL'));
  ok('no person value survives anywhere', !/klyde|bob|pepper/.test(JSON.stringify(s)));
}

console.log('\n— engine: identity and own-sheet gating —');
{
  const L = E.makeLedger();
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 5 } }, 1000);
  check('sheet before identity is dropped', L.last, {});
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 2000);
  check('status teaches identity', L.me, 'me');
  E.ingest(L, { kind: 'stats-sheet', name: 'rival' }, { can_view: true, stats: { stealth: 99 } }, 3000);
  check("another player's sheet is dropped whole", L.last, {});
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 5 } }, 4000);
  check('own sheet lands', L.last.stealth.v, 5);
  check('first sight makes no delta', L.deltas.length, 0);
}

console.log('\n— engine: the unfinished live stats tab (field report 2026-08-11) —');
{
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: false, privacy_rights_axis: -1.2 }, 2000);
  check('sealed own sheet recorded as an issue', L.sheetIssue, { t: 2000, kind: 'sealed', axis: -1.2 });
  check('sealed sheet stores no values', L.last, {});
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, {}, 3000);
  check('empty own sheet recorded as an issue', L.sheetIssue, { t: 3000, kind: 'empty' });
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 5 } }, 4000);
  check('a working sheet clears the issue', L.sheetIssue, null);
  check('and lands normally', L.last.stealth.v, 5);
  // the train page is the working sheet meanwhile — same ledger, same windows
  E.ingest(L, { kind: 'action', ep: '/actions/graffiti' }, {}, 5000);
  E.ingest(L, { kind: 'train-sheet' }, { targets: [{ kind: 'skill', key: 'stealth', label: 'Stealth', value: 5.05, practice_gain: 0.1, class_gain: 0.15 }] }, 6000);
  check('train-page reading closes the window', L.deltas[L.deltas.length - 1].attrib, { type: 'action', ep: '/actions/graffiti', n: 1 });
}

console.log('\n— engine: attribution rules —');
const boot = () => {
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10, driving: 3, law: 2, strength: 7 } }, 2000);
  return L;
};
{
  // one action alone in the window → attributed, and the per-action stats learn
  const L = boot();
  E.ingest(L, { kind: 'action', ep: '/actions/car-theft/choice' }, { complete: true }, 3000);
  const rows = E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10.12, driving: 3, law: 2, strength: 7 } }, 4000);
  check('one delta row', rows.length, 1);
  check('attributed to the action', rows[0].attrib, { type: 'action', ep: '/actions/car-theft/choice', n: 1 });
  check('delta value', rows[0].d.toFixed(4), '0.1200');
  check('per-action xp learned', L.actStats['/actions/car-theft/choice'].xp.stealth.sum.toFixed(4), '0.1200');
}
{
  // two actions in the window → ambiguous, per-action stats deliberately learn nothing
  const L = boot();
  E.ingest(L, { kind: 'action', ep: '/actions/graffiti' }, {}, 3000);
  E.ingest(L, { kind: 'action', ep: '/actions/deal-drugs' }, {}, 3500);
  const rows = E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10.3, driving: 3, law: 2, strength: 7 } }, 4000);
  check('ambiguous attribution', rows[0].attrib.type, 'ambiguous');
  check('both endpoints listed', rows[0].attrib.eps.length, 2);
  check('graffiti learned no xp', L.actStats['/actions/graffiti'].xp, {});
  check('deal-drugs learned no xp', L.actStats['/actions/deal-drugs'].xp, {});
}
{
  // no actions, jailed transition inside the window → passive, labelled
  const L = boot();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'jailed' }, 3000);
  const rows = E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10, driving: 3, law: 2, strength: 7, street_sense: 0.4 } }, 4000);
  check('street_sense first sight, no delta', rows.length, 0);
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10, driving: 3, law: 2, strength: 7, street_sense: 0.55 } }, 5000);
  const d = L.deltas[L.deltas.length - 1];
  check('passive with jail note', d.attrib, { type: 'passive', n: 0, note: 'jailed' });
}
{
  // a train award explains itself: event + after_value in one response
  const L = boot();
  E.ingest(L, { kind: 'train-sheet' }, {
    heart: 12, daily_slots: 4,
    targets: [{ kind: 'attribute', key: 'strength', label: 'Strength', value: 7, practice_gain: 0.8, class_gain: 1.2 }],
  }, 3000);
  const rows = E.ingest(L, { kind: 'train-award' }, { mode: 'practice', target_label: 'Strength', gain: 0.8, after_value: 7.8 }, 4000);
  check('train delta row', rows.length, 1);
  check('train attribution', rows[0].attrib.type, 'train');
  check('value advanced to after_value', L.last.strength.v, 7.8);
  const again = E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10, driving: 3, law: 2, strength: 7.8 } }, 5000);
  check('later sheet at same value makes no delta', again.length, 0);
}
{
  // label→key falls back to slug when the train sheet was never seen
  const L = boot();
  const rows = E.ingest(L, { kind: 'train-award' }, { mode: 'practice', target_label: 'Street Sense', gain: 0.2, after_value: 0.2 }, 3000);
  check('slug fallback keys the award', rows.length ? 'delta' : L.events[L.events.length - 1].key, 'street_sense');
  check('slug()', E.slug('Street Sense'), 'street_sense');
  check('slug() handles SMG', E.slug('SMG'), 'smg');
}
{
  // the realistic mixed sequence: an award carrying after_value closes its own
  // window at award time, so the later sheet closes a CLEAN single-action window
  const L = boot();
  E.ingest(L, { kind: 'train-award' }, { mode: 'practice', target_label: 'Stealth', gain: 0.5, after_value: 10.5 }, 3000);
  E.ingest(L, { kind: 'action', ep: '/actions/car-theft/choice' }, { complete: true }, 3500);
  const rows = E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10.6, driving: 3, law: 2, strength: 7 } }, 4000);
  check('sheet closes a clean window: one action row', rows.map((r) => [r.attrib.type, +r.d.toFixed(4)]), [['action', 0.1]]);
  check('cumulative record holds both rows', L.deltas.map((r) => [r.attrib.type, +r.d.toFixed(4)]), [['train', 0.5], ['action', 0.1]]);
  check('action stats learned only the residual', L.actStats['/actions/car-theft/choice'].xp.stealth.sum.toFixed(4), '0.1000');
}
{
  // the parts path: an award WITHOUT after_value stays in the window, and the
  // next sheet splits measured train part from action residual — never folded
  const L = boot();
  E.ingest(L, { kind: 'train-award' }, { mode: 'practice', target_label: 'Stealth', gain: 0.5 }, 3000);
  E.ingest(L, { kind: 'action', ep: '/actions/car-theft/choice' }, { complete: true }, 3500);
  const rows = E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10.6, driving: 3, law: 2, strength: 7 } }, 4000);
  check('mixed window splits into two rows', rows.map((r) => [r.attrib.type, +r.d.toFixed(4)]), [['train', 0.5], ['action', 0.1]]);
  check('split rows chain from/to through the window',
    [rows[0].from, rows[0].to, rows[1].from, +rows[1].to.toFixed(4)], [10, 10.5, 10.5, 10.6]);
}
{
  // education completion detected across two reads, then explains a sheet delta
  const L = boot();
  E.ingest(L, { kind: 'education' }, { courses: [{ code: 'LAW101', completed: false, stat_rewards: [{ key: 'law', amount: 1 }] }] }, 3000);
  E.ingest(L, { kind: 'education' }, { courses: [{ code: 'LAW101', completed: true, stat_rewards: [{ key: 'law', amount: 1 }] }] }, 4000);
  check('completion became an event', L.events.filter((e) => e.kind === 'edu').length, 1);
  const rows = E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10, driving: 3, law: 3, strength: 7 } }, 5000);
  check('sheet delta explained as education', rows.map((r) => [r.attrib.type, +r.d.toFixed(4)]), [['education', 1]]);
}
{
  // an unchanged reading narrows the window: the earlier action is excluded
  const L = boot();
  E.ingest(L, { kind: 'action', ep: '/actions/graffiti' }, {}, 3000);
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10, driving: 3, law: 2, strength: 7 } }, 4000); // unchanged
  E.ingest(L, { kind: 'action', ep: '/actions/deal-drugs' }, {}, 5000);
  const rows = E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: true, stats: { stealth: 10.2, driving: 3, law: 2, strength: 7 } }, 6000);
  check('window excludes the pre-reading action', rows[0].attrib, { type: 'action', ep: '/actions/deal-drugs', n: 1 });
}
{
  // assessment is a live reading source since 0.2.0 (docs/10 field verdict)
  const L = boot();
  const rows = E.ingest(L, { kind: 'assessment' }, { stats_table: [{ key: 'stealth', current: 10.4, change: 5 }], snapshot_date: 'Y7 D300', previous_date: 'Y7 D290' }, 3000);
  check('assessment closes windows like any reading', rows.map((r) => [r.key, +r.d.toFixed(4)]), [['stealth', 0.4]]);
  check('reading advanced', L.last.stealth.v, 10.4);
  check('assessment dates kept for display', L.assessment.snapshot_date, 'Y7 D300');
}
{
  // caps hold
  const L = boot();
  for (let i = 0; i < 2000; i++) {
    E.ingest(L, { kind: 'action', ep: '/actions/graffiti' }, {}, 3000 + i);
  }
  ok('events capped', L.events.length <= E.CAP.events);
  check('attempt count still exact', L.actStats['/actions/graffiti'].n, 2000);
}

console.log('\n— 0.1.3: the broken tab’s HTTP status is finally visible —');
{
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'stats-sheet-error', name: 'rival' }, { status: 404 }, 2000);
  check('another player’s erroring tab is ignored', L.sheetIssue, null);
  E.ingest(L, { kind: 'stats-sheet-error', name: 'me' }, { status: 404 }, 3000);
  check('own tab error recorded with its status', L.sheetIssue, { t: 3000, kind: 'http 404' });
  ok('report says so', E.buildReport(L, {}, '9.9.9').includes('answered http 404'));
}

console.log('\n— 0.2.0: the home dossier is a live full-width reading source —');
{
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  const first = E.ingest(L, { kind: 'assessment' }, {
    snapshot_date: '2026-08-11', previous_date: '2026-07-27',
    stats_table: [
      { key: 'stealth', label: 'Stealth', current: 10, change: 0.5 },
      { key: 'street_sense', label: 'Street Sense', current: 0.55, change: 0.55 },
      { key: 'art', label: 'Art', current: 1.0, change: 0 },
    ],
  }, 2000);
  check('first dossier visit is a baseline, no deltas', first.length, 0);
  check('dossier keys became readings', Object.keys(L.last).sort(), ['art', 'stealth', 'street_sense']);
  // the klyde workflow: home → one disobedience → home
  E.ingest(L, { kind: 'action', ep: '/disobedience' }, {}, 3000);
  const rows = E.ingest(L, { kind: 'assessment' }, {
    snapshot_date: '2026-08-11', previous_date: '2026-07-27',
    stats_table: [
      { key: 'stealth', label: 'Stealth', current: 10, change: 0.5 },
      { key: 'street_sense', label: 'Street Sense', current: 0.55, change: 0.55 },
      { key: 'art', label: 'Art', current: 1.18, change: 0 },
    ],
  }, 4000);
  check('home sandwich attributes the art gain to the disobedience',
    rows.map((r) => [r.key, +r.d.toFixed(4), r.attrib.type, r.attrib.ep]),
    [['art', 0.18, 'action', '/disobedience']]);
  check('change column stored, never a reading', L.assessment.change.street_sense, 0.55);
  const r = E.buildReport(L, {}, '9.9.9');
  ok('report marks the dossier as a live source', r.includes('· 3 keys · live reading source'));
  ok('no self-referential comparison line remains', !r.includes('dossier vs live'));
}

console.log('\n— 0.2.7: mastery is shown by the game; the RATE is not —');
{
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  // 8 disobediences; mastery ticks 41 → 42 on the 5th.
  for (let i = 0; i < 8; i++) {
    E.ingest(L, { kind: 'action', ep: '/disobedience' }, { success: true, mastery: i < 4 ? 41 : 42 }, 2000 + i);
  }
  check('current value tracked', L.mastery['/disobedience'].v, 42);
  check('one step, measured over the attempts it took', L.mastery['/disobedience'].steps, [{ d: 1, over: 4 }]);
  const r = E.buildReport(L, {}, '9.9.9');
  ok('report uses the game’s own scale and tier', r.includes('mastery disobedience: 42/100 (practiced)'));
  ok('and the rate the game never shows', r.includes('+1 over 4 attempts'));
  // 18 points to go at 0.25/attempt = 72 attempts.
  ok('and the distance to fluent', r.includes('~72 more to fluent'));
}
{
  // A stat that has not moved must not fake a rate.
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  for (let i = 0; i < 3; i++) E.ingest(L, { kind: 'action', ep: '/disobedience' }, { mastery: 41 }, 2000 + i);
  check('no step recorded', L.mastery['/disobedience'].steps.length, 0);
  // The span is the attempts spent AT this value (3), not the attempt number
  // it first appeared at (1) — the distinction the first cut got wrong.
  ok('report counts the attempts spent at this value',
    E.buildReport(L, {}, '9.9.9').includes('unchanged over 3 attempts'));
  ok('no fluent projection without a rate', !E.buildReport(L, {}, '9.9.9').includes('to fluent'));
}
{
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'action', ep: '/disobedience' }, { mastery: 72 }, 2000);
  E.ingest(L, { kind: 'action', ep: '/disobedience' }, { mastery: 73 }, 2001);
  ok('tier vocabulary matches the game at the top end', E.buildReport(L, {}, '9.9.9').includes('73/100 (fluent)'));
  ok('no projection once fluent is passed', !E.buildReport(L, {}, '9.9.9').includes('to fluent'));
}

console.log('\n— 0.2.6: the report carries the measurement, not just the instrument —');
{
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'assessment' }, { snapshot_date: 'x', stats_table: [{ key: 'persuasion', current: 10, change: 0 }] }, 2000);
  for (let i = 0; i < 3; i++) {
    E.ingest(L, { kind: 'action', ep: '/disobedience' }, { success: i < 2, hospitalized: i === 2 }, 3000 + i);
  }
  E.ingest(L, { kind: 'assessment' }, { snapshot_date: 'x', stats_table: [{ key: 'persuasion', current: 10.06, change: 0 }] }, 4000);
  const r = E.buildReport(L, {}, '9.9.9');
  ok('report has a measured-per-action section', r.includes('measured per action:'));
  ok('with the per-attempt average and its n', r.includes('persuasion +0.02(n=3)'));
  ok('and the outcome split beside it', /disobedience ×3 · success:2 fail\+hospitalized:1/.test(r));
  // The sealed tab is a policy gate; the report must name the axis, not guess.
  E.ingest(L, { kind: 'stats-sheet', name: 'me' }, { can_view: false, privacy_rights_axis: 0 }, 5000);
  ok('sealed tab reports its axis', E.buildReport(L, {}, '9.9.9').includes('answered sealed (rights axis 0)'));
}

console.log('\n— 0.2.5: N identical actions in one window are N samples, not noise —');
{
  // The real 2026-08-11 case: 3 disobediences between two readings, +0.06.
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'assessment' }, {
    snapshot_date: '2026-08-11', stats_table: [{ key: 'persuasion', current: 10, change: 1 }],
  }, 2000);
  for (let i = 0; i < 3; i++) E.ingest(L, { kind: 'action', ep: '/disobedience' }, { success: true }, 3000 + i);
  const rows = E.ingest(L, { kind: 'assessment' }, {
    snapshot_date: '2026-08-11', stats_table: [{ key: 'persuasion', current: 10.06, change: 1.06 }],
  }, 4000);
  check('a uniform window is attributed, not discarded',
    rows.map((r) => [r.key, +r.d.toFixed(4), r.attrib.type, r.attrib.ep, r.attrib.n]),
    [['persuasion', 0.06, 'action', '/disobedience', 3]]);
  check('per-attempt average is total/N', +(L.actStats['/disobedience'].xp.persuasion.sum
    / L.actStats['/disobedience'].xp.persuasion.n).toFixed(4), 0.02);

  // Mixed endpoints still cannot be split, and must not be averaged.
  const M = E.makeLedger();
  E.ingest(M, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(M, { kind: 'assessment' }, { snapshot_date: 'x', stats_table: [{ key: 'stealth', current: 5, change: 0 }] }, 2000);
  E.ingest(M, { kind: 'action', ep: '/disobedience' }, {}, 3000);
  E.ingest(M, { kind: 'action', ep: '/actions/graffiti' }, {}, 3001);
  const mixed = E.ingest(M, { kind: 'assessment' }, { snapshot_date: 'x', stats_table: [{ key: 'stealth', current: 5.1, change: 0 }] }, 4000);
  check('mixed endpoints stay ambiguous', mixed[0].attrib.type, 'ambiguous');
  check('and enter no per-action average', M.actStats['/disobedience']?.xp?.stealth, undefined);
}

console.log('\n— 0.2.3: what IS the change column (the home page green arrows)? —');
const dossier = (art, change) => ({
  snapshot_date: '2026-08-11', previous_date: '2026-08-04',
  stats_table: [{ key: 'art', label: 'Art', current: art, change }],
});
{
  // running: the arrow moves with the gain → a total against some baseline
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'assessment' }, dossier(1.0, 0.5), 2000);
  check('one reading is not yet an experiment', L.changeVerdict, null);
  E.ingest(L, { kind: 'assessment' }, dossier(1.18, 0.68), 3000);
  check('verdict: running', [L.changeVerdict.kind, +L.changeVerdict.dCurrent.toFixed(4), +L.changeVerdict.dChange.toFixed(4)],
    ['running', 0.18, 0.18]);
  ok('report states it', E.buildReport(L, {}, '9.9.9').includes('change column: RUNNING'));
  ok('report prints the raw arrows for eyeballing', E.buildReport(L, {}, '9.9.9').includes('change values: art +0.68'));
}
{
  // frozen: the arrow ignores the gain → period data fixed at assessment time
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'assessment' }, dossier(1.0, 0.5), 2000);
  E.ingest(L, { kind: 'assessment' }, dossier(1.18, 0.5), 3000);
  check('verdict: frozen', L.changeVerdict.kind, 'frozen');
  ok('report states it', E.buildReport(L, {}, '9.9.9').includes('change column: FROZEN'));
  ok('report notes the dates held still', E.buildReport(L, {}, '9.9.9').includes('dates unchanged'));
}
{
  // no gain between reads → no witness, no claim
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'assessment' }, dossier(1.0, 0.5), 2000);
  E.ingest(L, { kind: 'assessment' }, dossier(1.0, 0.5), 3000);
  check('no gain means no verdict', L.changeVerdict, null);
}

console.log('\n— 0.2.0: sample key digest in the report, values stay home —');
{
  const L = E.makeLedger();
  const samples = {};
  E.recordSample(samples, '/disobedience', {
    swing: 3, jailed: false, secret_token: 'SENTINEL',
    xp_award: { persuasion: 0.4, art: 0.18 }, witnesses: [{ username: 'bob', mood: 2 }],
  }, 1000);
  const r = E.buildReport(L, samples, '9.9.9');
  ok('digest names the endpoint', r.includes('sampled /disobedience:'));
  ok('digest surfaces nested award-shaped keys', r.includes('xp_award.persuasion') && r.includes('xp_award.art'));
  ok('digest walks arrays', r.includes('witnesses[].username'));
  // Numbers and booleans carry values (a bare `mastery` key is useless);
  // strings and objects stay key-only, which is where people and prose live.
  ok('numeric values are shown', r.includes('xp_award.persuasion=0.4'));
  ok('booleans are shown', r.includes('jailed=false'));
  ok('string values are NOT shown', r.includes('witnesses[].username') && !r.includes('bob'));
  ok('credentials never appear', !r.includes('SENTINEL'));
}
{
  // distinct values accumulate across the ring — the point of sampling is to
  // see a field VARY, which is what identifies an award
  const samples = {};
  for (const [m, s] of [[0.02, true], [0.03, false], [0.02, true]]) {
    E.recordSample(samples, '/disobedience', { mastery: m, success: s }, 1);
  }
  const r = E.buildReport(E.makeLedger(), samples, '9.9.9');
  ok('distinct numeric values are collected', /mastery=0\.02,0\.03|mastery=0\.03,0\.02/.test(r));
  ok('distinct booleans are collected', /success=(true,false|false,true)/.test(r));
}

console.log('\n— the copy-report button: paste-ready, console-free —');
{
  const L = E.makeLedger();
  ok('unvisited train page is said plainly', E.buildReport(L, {}, '9.9.9').includes('page not visited yet'));

  E.ingest(L, { kind: 'status' }, { username: 'klydetestuser', status: 'active' }, 1000);
  E.ingest(L, { kind: 'train-sheet' }, {
    heart: 12, daily_slots: 4, city_name: 'New York', city_theme: 'Finance',
    targets: [
      { kind: 'skill', key: 'stealth', label: 'Stealth', value: 10, practice_gain: 0.1, class_gain: 0.15 },
      { kind: 'attribute', key: 'strength', label: 'Strength', value: 7, practice_gain: 0.8, class_gain: 1.2 },
    ],
  }, 2000);
  E.ingest(L, { kind: 'stats-sheet', name: 'klydetestuser' }, { can_view: false, privacy_rights_axis: -1.2 }, 3000);
  E.ingest(L, { kind: 'assessment' }, { snapshot_date: 'Y7 D300', previous_date: 'Y7 D290' }, 4000);
  const r = E.buildReport(L, { '/actions/graffiti': [{}] }, '9.9.9');
  ok('names the version', r.includes('xp-watch 9.9.9'));
  ok('stamps the city and theme (the map datum)', r.includes('train targets: 2 @ New York (Finance) · heart 12 · slots/window 4'));
  {
    const N = E.makeLedger();
    E.ingest(N, { kind: 'train-sheet' }, { heart: 1, daily_slots: 1, targets: [{ kind: 'attribute', key: 'heart', label: 'Heart', value: 1, practice_gain: 0.3, class_gain: 0.45 }] }, 500);
    ok('no city renders as such ("only Heart" case)', E.buildReport(N, {}, '9.9.9').includes('train targets: 1 @ no city'));
  }
  ok('lists both target lines with value and both gains',
    r.includes('stealth = 10.00  practice +0.1  class +0.15') && r.includes('strength = 7.00  practice +0.8  class +1.2'));
  ok('targets sorted by key', r.indexOf('stealth =') < r.indexOf('strength ='));
  ok('reports the sealed stats tab with the axis', r.includes('answered sealed (rights axis -1.2)'));
  ok('reports the dossier assessment dates', r.includes('assessed: Y7 D300 (prev Y7 D290)'));
  ok('tallies readings, deltas, samples', r.includes('readings held: 2 keys · deltas recorded: 0 · sample endpoints: 1'));
  ok('never includes the username', !r.includes('klydetestuser'));
}

console.log('\n— samples: ring of 3, scrubbed before write —');
{
  const samples = {};
  for (let i = 0; i < 5; i++) {
    E.recordSample(samples, '/actions/deal-drugs', { username: 'klyde', take: 100 + i, session_token: 'SENTINEL' }, i);
  }
  check('ring holds 3', samples['/actions/deal-drugs'].length, 3);
  ok('oldest evicted', samples['/actions/deal-drugs'][0].body.includes('102'));
  ok('no sentinel in storage', !JSON.stringify(samples).includes('SENTINEL'));
  ok('no username value in storage', !JSON.stringify(samples).includes('klyde'));
  ok('the username KEY survives (discovery)', samples['/actions/deal-drugs'][0].body.includes('"username"'));
}

// ---------------------------------------------------------------------------
// 0.9.0 — what an action was aimed at
// ---------------------------------------------------------------------------
// The real disobedience body, as ActivismPage builds it in the 2026-09-23 bundle:
// `i.post('/disobedience', {issue_id:S, site_key:E, leaning:F})`, stringified by the
// client's one wrapper before fetch ever sees it.
const DISOB_BODY = JSON.stringify({ issue_id: 'civil-rights', site_key: 'sf-05', leaning: 0 });
const POLL_NAMES = ['Abortion', 'Animal Research', 'Civil Rights', 'Corporations', 'Drugs', 'Elections',
  'Free Speech', 'Gun Control', 'Healthcare', 'Immigration', 'Intelligence', 'LGBT Rights', 'Military',
  'Nuclear Power', 'Police Behavior', 'Pollution', 'Sweatshops', 'Taxes', 'Torture', "Women's Rights"];
const ACTIVISM_IDS = ['free-speech', 'police-behavior', 'civil-rights', 'immigration', 'drugs', 'abortion',
  'animal-research', 'healthcare', 'lgbt-rights', 'gun-control', 'torture', 'intelligence', 'womens-rights',
  'corporations', 'elections', 'sweatshops', 'military', 'nuclear-power', 'pollution', 'taxes'];

console.log('\n— 0.9.0: the body read — a string, an allowlist, nothing else —');
{
  const init = { method: 'POST', body: DISOB_BODY };
  check('a disobedience body yields issue, site and leaning',
    E.aimFor({ kind: 'action', ep: '/disobedience' }, ['/api/disobedience', init], new Map()),
    { issue: 'civil-rights', site: 'sf-05', leaning: 0 });
  check('...and the body string is untouched', init.body, DISOB_BODY);
  check('a leaning of 0 is kept, not dropped as falsy',
    E.aimOf('/disobedience', { issue_id: 'taxes', site_key: 'x', leaning: 0 }).leaning, 0);

  // A Request object: its body is a stream the app still has to send. Reading it would
  // take it from the app, so it is not read — and the test proves the stream is still there.
  const req = new Request('https://politiko.io/api/disobedience', { method: 'POST', body: DISOB_BODY });
  check('a Request-object body gives no aim', E.aimFor({ kind: 'action', ep: '/disobedience' }, [req], new Map()), null);
  check('...and its stream is left unconsumed', req.bodyUsed, false);
  check('...even with an init that carries no body', E.bodyOf([req, { method: 'POST' }]), null);

  check('a non-string body (FormData-like) is not read', E.bodyOf(['/api/x', { body: { issue_id: 'taxes' } }]), null);
  check('malformed JSON is not an aim', E.bodyOf(['/api/x', { body: '{issue_id:' }]), null);
  check('an array body is not an aim', E.bodyOf(['/api/x', { body: '["taxes"]' }]), null);
  check('an oversized body is not parsed', E.bodyOf(['/api/x', { body: `{"issue_id":"${'a'.repeat(5000)}"}` }]), null);
  check('no init at all is fine', E.bodyOf(['/api/x']), null);

  check('fields outside the allowlist are never copied',
    E.aimOf('/disobedience', { issue_id: 'taxes', site_key: 'sf-01', leaning: -2, username: 'LEAK', note: 'LEAK' }),
    { issue: 'taxes', site: 'sf-01', leaning: -2 });
  check('an endpoint outside the allowlist has its body left unread',
    E.aimOf('/terminal/exec', { command: 'LEAK', issue_id: 'taxes' }), null);
  check('...and so does combat', E.aimOf('/combat/{id}/action', { action: 'shoot', issue_id: 'taxes' }), null);
  check('objects, NaN and long strings are dropped, not stringified',
    E.aimOf('/disobedience', { issue_id: { x: 1 }, site_key: 'y'.repeat(65), leaning: NaN }), null);
  check('a protest start keeps its stance', E.aimOf('/protests', { issue_id: 'drugs', stance: -2, location_id: 4 }),
    { issue: 'drugs', stance: -2 });
  check('graffiti keeps the wall and the side', E.aimOf('/actions/graffiti', { location_key: 'mission', side: 'R', mode: 'paint' }),
    { site: 'mission', side: 'R' });
  check('a poll names its issue', E.aimOf('/actions/poll', { issue: 'Civil Rights', method: 'focus_group' }), { issue: 'Civil Rights' });
}

console.log('\n— 0.9.0: one issue, three spellings, one key —');
{
  // Measured 2026-09-23: ActivismPage's 20 ids and the poll screen's 20 names. The key
  // has to join every pair, including the two whose labels disagree between chunks.
  const unmatched = ACTIVISM_IDS.filter((id) => !POLL_NAMES.some((n) => E.issueKey(n) === E.issueKey(id)));
  check('every disobedience id meets its poll name', unmatched, []);
  check('police-behavior is "Police Behavior", not ActivismPage\'s "Police"', E.issueName(POLL_NAMES, 'police-behavior'), 'Police Behavior');
  check('the apostrophe does not split Women\'s Rights', E.issueName(POLL_NAMES, 'womens-rights'), "Women's Rights");
  check('an unknown issue id is kept exactly as sent', E.issueName(POLL_NAMES, 'space-program'), 'space-program');
  check('...and so is any id before the names are known', E.issueName([], 'civil-rights'), 'civil-rights');
}

console.log('\n— 0.9.0: the aim lands on the event —');
{
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'action', ep: '/disobedience', aim: { issue: 'civil-rights', site: 'sf-05', leaning: 0 } }, { success: true }, 2000);
  check('before the poll screen is seen, the raw id is stored', L.events.at(-1),
    { t: 2000, kind: 'action', ep: '/disobedience', outcome: 'success', issue: 'civil-rights', site: 'sf-05', leaning: 0 });

  E.ingest(L, { kind: 'issue-list' }, { issues: POLL_NAMES }, 2500);
  check('the poll screen teaches the names', L.issueNames.length, 20);
  E.ingest(L, { kind: 'action', ep: '/disobedience', aim: { issue: 'civil-rights', site: 'sf-05', leaning: 0 } }, { success: false }, 3000);
  check('after it, the game\'s own name is stored', L.events.at(-1).issue, 'Civil Rights');
  E.ingest(L, { kind: 'action', ep: '/disobedience', aim: { issue: 'space-program', site: 'sf-05', leaning: 1 } }, { success: true }, 3100);
  check('an unknown issue id stays raw, still recorded', L.events.at(-1).issue, 'space-program');

  // A poll whose body could not be read still names its issue in the memo.
  E.ingest(L, { kind: 'action', ep: '/actions/poll' }, { issue: 'Taxes', method: 'street', left_bloc: 1 }, 3200);
  check('a poll with no body read takes its issue from the memo', L.events.at(-1).issue, 'Taxes');

  // An action with no aim at all is the 0.8.0 event, byte for byte.
  E.ingest(L, { kind: 'action', ep: '/terminal/exec' }, {}, 3300);
  check('an action with nothing to aim at is the old shape', L.events.at(-1), { t: 3300, kind: 'action', ep: '/terminal/exec', outcome: null });

  // Protest join: the body names a side, the lookup names the issue, the ref goes nowhere.
  const protests = new Map();
  E.harvestProtests([{ id: 9, issue: 'Drugs', issue_id: 'drugs', participants: [{ username: 'LEAK', side: 'left' }] },
    { id: 10, issue_id: 'taxes' }, { id: null, issue: 'x' }, 'junk'], protests);
  check('the protest list yields id → issue and nothing else', [...protests], [['9', 'Drugs'], ['10', 'taxes']]);
  E.harvestProtests({ id: 11, issue: 'Elections', participants: [] }, protests);
  check('...one protest\'s own page does too', protests.get('11'), 'Elections');
  const msg = E.classify('/api/protests/9/join', 'POST');
  const aim = E.aimFor(msg, ['/api/protests/9/join', { method: 'POST', body: '{"side":"left"}' }], protests);
  check('a join is named from the list', aim, { side: 'left', issue: 'Drugs' });
  E.ingest(L, { ...msg, aim }, {}, 3400);
  check('...and the event carries no protest id', L.events.at(-1), { t: 3400, kind: 'action', ep: '/protests/{id}/join', outcome: null, side: 'left', issue: 'Drugs' });
  check('a join whose protest was never listed keeps just its side',
    E.aimFor(E.classify('/api/protests/77/join', 'POST'), ['/api/protests/77/join', { body: '{"side":"right"}' }], protests), { side: 'right' });
  const big = new Map();
  for (let i = 0; i < 260; i++) E.harvestProtests([{ id: i, issue: 'Taxes' }], big);
  check('the lookup is capped', big.size, 200);

  const r = E.buildReport(L, {}, '9.9.9');
  ok('the report says what the actions were aimed at, one line per issue',
    /aimed at \(events held\): Civil Rights 2 · space-program 1 · Drugs 1$/m.test(r));
  ok('...leaving the poll out, as a reading', !/aimed at[^\n]*Taxes/.test(r));
}

console.log('\n— 0.9.0: neither scrub blanks the new fields —');
{
  // xp-watch's own scrub guards samples; collect-stores' guards the export (test-collect.js
  // runs the file itself). Every body field name and every event field name must pass here.
  const fields = { issue_id: 'civil-rights', site_key: 'sf-05', leaning: -1, location_key: 'mission',
    issue: 'Civil Rights', site: 'sf-05', side: 'left', stance: 2, alone: { street_sense: 5 } };
  check('xp-watch scrub keeps every aim field', E.scrub(fields), fields);
}

console.log('\n— 0.9.0: clean windows count attempts alone, moved or not —');
const ledgerWith = (keys) => {
  const L = E.makeLedger();
  E.ingest(L, { kind: 'status' }, { username: 'me', status: 'active' }, 1000);
  E.ingest(L, { kind: 'assessment' }, { snapshot_date: 'x', stats_table: Object.entries(keys).map(([key, current]) => ({ key, current, change: 0 })) }, 2000);
  return L;
};
let clock = 3000;
const read = (L, keys) => E.ingest(L, { kind: 'assessment' }, { snapshot_date: 'x', stats_table: Object.entries(keys).map(([key, current]) => ({ key, current, change: 0 })) }, clock += 10);
const act = (L, ep, n = 1) => { for (let i = 0; i < n; i++) E.ingest(L, { kind: 'action', ep }, { success: true }, clock += 10); };
{
  const L = ledgerWith({ street_sense: 10, writing: 5 });
  act(L, '/actions/poll');
  read(L, { street_sense: 10, writing: 5 });
  check('an unchanged reading still counts the attempt', L.actStats['/actions/poll'].alone, { street_sense: 1, writing: 1 });
  check('...without inventing an award', L.actStats['/actions/poll'].xp, {});
  act(L, '/actions/poll'); act(L, '/disobedience', 3);
  read(L, { street_sense: 10.06, writing: 5 });
  check('a mixed window counts nothing alone', L.actStats['/actions/poll'].alone, { street_sense: 1, writing: 1 });
  check('...for either endpoint', L.actStats['/disobedience'].alone, undefined);
  act(L, '/disobedience', 3);
  read(L, { street_sense: 10.12, writing: 5 });
  check('N attempts alone count N', L.actStats['/disobedience'].alone, { street_sense: 3, writing: 3 });
}

console.log('\n— 0.9.0: attribution by exclusion — where it fires —');
// The operator's shape: disobedience measured on street_sense, the poll watched alone
// five times with street_sense read and never moving it, then a burst with the poll
// that opened it inside the same window.
const teach = ({ pollAlone = 5, pollTouches = false, disobMeasured = true } = {}) => {
  const L = ledgerWith({ street_sense: 10, writing: 5, persuasion: 20 });
  let ss = 10, w = 5, p = 20;
  if (disobMeasured) { act(L, '/disobedience', 2); read(L, { street_sense: ss += 0.04, writing: w, persuasion: p += 0.04 }); }
  for (let i = 0; i < pollAlone; i++) {
    act(L, '/actions/poll');
    read(L, { street_sense: (pollTouches && i === 0) ? (ss += 0.01) : ss, writing: w += 0.5, persuasion: p });
  }
  return { L, now: { ss, w, p } };
};
{
  const { L, now } = teach();
  const before = JSON.stringify(L.actStats['/disobedience'].xp);
  act(L, '/actions/poll'); act(L, '/disobedience', 19);
  const rows = read(L, { street_sense: now.ss + 0.38, writing: now.w + 0.5, persuasion: now.p + 0.38 });
  const ssRow = rows.find((x) => x.key === 'street_sense');
  check('the burst\'s street_sense is inferred to disobedience', ssRow.attrib,
    { type: 'inferred', rule: 'exclusion', ep: '/disobedience', n: 19, by: [{ ep: '/actions/poll', alone: 5 }] });
  check('...and the whole residual rides on it', +ssRow.d.toFixed(4), 0.38);
  check('the per-action averages learned nothing from it', JSON.stringify(L.actStats['/disobedience'].xp), before);
  // Writing, the other way round: the poll is the one seen to award it, and
  // disobedience was watched alone twice — below the bar, so it stays ambiguous.
  check('writing stays ambiguous: disobedience has only 2 solo attempts on it',
    rows.find((x) => x.key === 'writing').attrib.type, 'ambiguous');
  const r = E.buildReport(L, {}, '9.9.9');
  ok('the report counts the inferred row apart', /attribution: action \d+ · inferred 2 · ambiguous 1/.test(r));
}

console.log('\n— 0.9.0: attribution by exclusion — where it must not —');
{
  const { L, now } = teach({ pollAlone: 4 });
  act(L, '/actions/poll'); act(L, '/disobedience', 19);
  const rows = read(L, { street_sense: now.ss + 0.38, writing: now.w, persuasion: now.p });
  check('four solo polls are not enough: ambiguous', rows[0].attrib.type, 'ambiguous');
}
{
  const { L, now } = teach({ pollTouches: true });
  check('(the poll did measure a street_sense change once)', !!L.actStats['/actions/poll'].xp.street_sense, true);
  act(L, '/actions/poll'); act(L, '/disobedience', 19);
  const rows = read(L, { street_sense: now.ss + 0.38, writing: now.w, persuasion: now.p });
  check('an endpoint that ever moved the key is never ruled out: ambiguous', rows[0].attrib.type, 'ambiguous');
}
{
  const { L, now } = teach({ disobMeasured: false });
  act(L, '/actions/poll'); act(L, '/disobedience', 19);
  const rows = read(L, { street_sense: now.ss + 0.38, writing: now.w, persuasion: now.p });
  check('a survivor never seen to award the key gets nothing: ambiguous', rows[0].attrib.type, 'ambiguous');
}
{
  const { L, now } = teach();
  // terminal/exec measured on street_sense too: two candidates left standing
  act(L, '/terminal/exec'); read(L, { street_sense: now.ss + 0.1, writing: now.w, persuasion: now.p });
  act(L, '/actions/poll'); act(L, '/disobedience', 5); act(L, '/terminal/exec');
  const rows = read(L, { street_sense: now.ss + 0.3, writing: now.w, persuasion: now.p });
  check('two endpoints that can award it: ambiguous', rows[0].attrib.type, 'ambiguous');
}
{
  // A 0.8.0 ledger: xp profiles, no `alone` anywhere. Nothing can be ruled out.
  const L = ledgerWith({ street_sense: 10 });
  L.actStats['/actions/poll'] = { n: 28, outcomes: {}, xp: { writing: { sum: 15, n: 1 } } };
  L.actStats['/disobedience'] = { n: 2571, outcomes: {}, xp: { street_sense: { sum: 44.19, n: 1204 } } };
  act(L, '/actions/poll'); act(L, '/disobedience', 19);
  const rows = read(L, { street_sense: 10.38 });
  check('an old ledger with no solo counts stays ambiguous, and does not throw', rows[0].attrib.type, 'ambiguous');
}

// ---------------------------------------------------------------------------
// The tap itself, sliced out and driven against a stub fetch. What has to hold:
// the app's arguments reach the real fetch untouched, a string body is read once
// and only for an action that succeeded, and a Request object's stream is never
// taken from the app.
// ---------------------------------------------------------------------------
const TAP = cut('  const listeners = new Set();', '  onApiResponse((msg, data) => {');
const tapTests = async () => {
  console.log('\n— 0.9.0: the tap reads the body the app already sent, and only that —');
  const sent = [];
  let reply = { ok: true, status: 200, data: { success: true } };
  const win = {
    fetch: async (...a) => {
      sent.push(a);
      const r = reply;
      return { ok: r.ok, status: r.status, headers: { get: () => 'application/json' }, clone: () => ({ json: async () => r.data }) };
    },
  };
  const T = new Function('window', 'log', `${ENGINE}\n${TAP}\n return { onApiResponse, protestIssue };`)(win, () => {});
  const got = [];
  T.onApiResponse((m, d) => got.push([m, d]));
  const flush = () => new Promise((r) => setTimeout(r, 0));

  let reads = 0;
  const init = { method: 'POST', get body() { reads++; return DISOB_BODY; } };
  await win.fetch('https://politiko.io/api/disobedience', init);
  await flush();
  check('the real fetch got the app\'s own init object', sent[0][1] === init, true);
  check('...and the listener got the aim', got[0][0].aim, { issue: 'civil-rights', site: 'sf-05', leaning: 0 });
  check('the body was read once', reads, 1);

  reply = { ok: false, status: 400, data: { error: 'not enough juice' } };
  reads = 0;
  await win.fetch('https://politiko.io/api/disobedience', init);
  await flush();
  check('a refused action\'s body is never read', reads, 0);

  reply = { ok: true, status: 200, data: [] };
  reads = 0;
  await win.fetch('https://politiko.io/api/user/status', { method: 'GET', get body() { reads++; return '{}'; } });
  check('a reading\'s body is never read', reads, 0);
  await win.fetch('https://politiko.io/api/terminal/exec', { method: 'POST', get body() { reads++; return '{"command":"LEAK"}'; } });
  await flush();
  check('an action outside AIM has its body left unread — not even parsed', reads, 0);
  check('...and carries no aim', got.at(-1)[0].aim, null);

  reply = { ok: true, status: 200, data: { success: true } };
  const req = new Request('https://politiko.io/api/disobedience', { method: 'POST', body: DISOB_BODY });
  await win.fetch(req);
  await flush();
  check('a Request object reaches the real fetch as itself', sent.at(-1)[0] === req, true);
  check('...its stream is not consumed', req.bodyUsed, false);
  check('...and its action simply has no aim', got.at(-1)[0].aim, null);

  T.protestIssue.set('9', 'Drugs');
  await win.fetch('https://politiko.io/api/protests/9/join', { method: 'POST', body: '{"side":"left"}' });
  await flush();
  check('a join is named from the page\'s own protest list', got.at(-1)[0].aim, { side: 'left', issue: 'Drugs' });
};

tapTests().catch((e) => { console.log(`FAIL  tap tests threw: ${e && e.stack}`); fail++; }).then(() => {
  console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
  process.exit(fail ? 1 : 0);
});
