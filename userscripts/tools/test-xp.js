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
ok('disclosure says request bodies are never read', /Request\s*\n?\s*\*\s*bodies are never read|Request bodies are never read/.test(HEAD.replace(/\n \* {13}/g, ' ')));

// The home button is a client-side route change to the router's INDEX path.
// `/home` is not a route in this app (measured); the game's own nav links to `/`.
ok('home button pushes the index path', /history\.pushState\(\{\}, '', '\/'\)/.test(SRC));
ok('home button is a route change, not a request', /new PopStateEvent\('popstate'\)/.test(SRC));
ok('no /home path anywhere', !SRC.includes("'/home'"));

// rAF alone latches when the page is not compositing; a stale panel reads as a
// broken tool. The render scheduler must carry a timer backstop.
ok('render scheduler has a non-rAF backstop', /requestAnimationFrame\(run\);\s*\n\s*setTimeout\(run, \d+\);/.test(SRC));

// PANEL KIT must be the shared block, not a local reimplementation.
ok('carries PANEL KIT v1 verbatim marker', SRC.includes('PANEL KIT v1 — shared verbatim block'));
ok('calls fit() after render', /if \(drag\) drag\.fit\(\);/.test(SRC));

// Resize is a LOCAL addition; PANEL KIT v1 stays byte-identical to the copies
// in every other tool (CLAUDE.md: changing it means bumping it everywhere).
// These assertions are about the parts that strand the UI if they regress.
ok('panel is resizable', /resize:both/.test(SRC));
ok('resize has a non-visible overflow to work at all', /overflow:hidden;resize:both/.test(SRC));
ok('minimum size keeps a grab area', /min-width:\d+px;min-height:\d+px/.test(SRC));
ok('a chosen size drops the 70vh cap', SRC.includes("panel.style.maxHeight = 'none'"));
ok('size is persisted under the ui key', /ui\.size = \{ w, h \};\s*\n\s*writeJSON\(K\.ui, ui\);/.test(SRC));
ok('size is restored on mount', /panel\.style\.width = ui\.size\.w;/.test(SRC));
ok('resize re-fits, so a grown panel cannot strand its own handle', /rememberSize = \(\)[\s\S]{0,500}drag\.fit\(\)/.test(SRC));
ok('pointerup backstop exists (ResizeObserver needs a compositing page)',
  SRC.includes("panel.addEventListener('pointerup', rememberSize)"));
ok('double-click clears the stored size, not just the position',
  /dblclick[\s\S]{0,240}ui\.size = undefined/.test(SRC));

// The render path must be gated on visibility (no work from an unfocused tab).
ok('render is visibility-gated', SRC.includes("document.visibilityState !== 'visible'"));

// ---------------------------------------------------------------------------
// 2. Slice the router / scrub / engine layer and drive it
// ---------------------------------------------------------------------------
const ENGINE = cut('  const slug = (label)', '  // Persistent state');
const build = () => new Function('log', `${ENGINE}
  return { slug, classify, outcomeOf, scrub, makeLedger, ingest, recordSample, buildReport, EPS, CAP };`)(() => {});
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
  check('protest join: id collapsed', c('/api/protests/9/join', 'POST'), { kind: 'action', ep: '/protests/{id}/join' });

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

console.log('');
if (fail) { console.error(`${fail} failing`); process.exit(1); }
console.log('all green');
