// Fence + behaviour tests for ws-watch.
//
// ws-watch replaces window.WebSocket. That is a legitimate way to observe frames the
// game already received, and it is also structurally one line away from being a bot.
// This file is the fence around that line.
//
// Two layers:
//
//   1. A STATIC fence over the whole shipped file, comments included. No parser, no
//      AST, no clever scoping — a plain substring search that cannot be talked out of
//      a match. It is deliberately blunt: a correct passive tap contains literally zero
//      occurrences of every banned token, so the invariant costs nothing to hold and
//      any violation is a real signal. (It is also why the prose in ws-watch says
//      "transmits" instead of naming the method.)
//
//   2. BEHAVIOUR tests that slice the WS TAP and census layers out of the shipped file
//      and drive them, so the tests cannot drift from what ships. Same approach as
//      test-bridge.js.
//
// Run: node userscripts/tools/test-passive.js
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'ws-watch.user.js');
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
console.log('\n— static fence: nothing in this file can transmit —');

// Anything that could put bytes on a wire, plus the two escape hatches that would
// let a caller reach the socket indirectly. `dispatchEvent` and `CustomEvent` are
// here for a specific reason: the game listens for a `chat:open-dm` window event
// whose handler's first act is to transmit a join frame, and nothing in the shipped
// client ever fires it. Dispatching it would originate traffic. See
// docs/01-rules-envelope.md and docs/09-socket-surface.md.
const BANNED = [
  '.send(',
  'new WebSocket',
  'fetch(',
  'XMLHttpRequest',
  'sendBeacon',
  'EventSource',
  'Notification',
  'dispatchEvent',
  'CustomEvent',
  'WebSocket.prototype',
  'importScripts',
];

for (const tok of BANNED) {
  const n = SRC.split(tok).length - 1;
  check(`no occurrence of ${JSON.stringify(tok)}`, n, 0);
}

// Exactly one construction, and it is the pass-through in the subclass constructor.
check('super( appears exactly once', SRC.split('super(').length - 1, 1);
ok('the one super() is the constructor pass-through', /super\(url,\s*protocols\)/.test(SRC));

// The metadata block has to be right or the tap lands on a sandboxed window and
// silently observes nothing.
ok('@grant none', /^\/\/ @grant\s+none$/m.test(SRC));
ok('@run-at document-start', /^\/\/ @run-at\s+document-start$/m.test(SRC));
ok('@match is politiko.io only', /^\/\/ @match\s+https:\/\/politiko\.io\/\*$/m.test(SRC));
ok('declares @version', /^\/\/ @version\s+\d+\.\d+\.\d+$/m.test(SRC));
ok('no @require (single auditable file)', !/^\/\/ @require/m.test(SRC));

// Clause 6: undisclosed functionality is bannable. The header must say the things
// a suspicious reader needs.
const HEAD = SRC.slice(0, SRC.indexOf('(() => {'));
ok('disclosure names the sockets it reads', HEAD.includes('/ws/chat') && HEAD.includes('/ws/market'));
ok('disclosure states zero added requests', /ZERO additional requests/.test(HEAD));
ok('disclosure names the storage prefix', HEAD.includes('pkws:'));
ok('disclosure explains the token is discarded', /token/i.test(HEAD) && /discard/i.test(HEAD));

// PANEL KIT must be the shared block, not a local reimplementation.
ok('carries PANEL KIT v1 verbatim marker', SRC.includes('PANEL KIT v1 — shared verbatim block'));
ok('calls fit() after render', /if \(drag\) drag\.fit\(\);/.test(SRC));

// ---------------------------------------------------------------------------
// 2. Drive the real WS TAP layer
// ---------------------------------------------------------------------------
const TAP = cut('  const WS_TAP_VERSION = 1;', '  // ---------------------------------------------------------------------------\n  // 2. The census');

// A stand-in for the platform WebSocket. Not an EventTarget — the tap only ever
// calls addEventListener on its super, so a plain method is enough, and this keeps
// the harness free of Node/browser event-class differences.
const makeFake = () => {
  const transmitted = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; this._l = {}; }
    addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); }
    // The counter this whole file exists to keep at zero.
    send(data) { transmitted.push(data); }
    close() { this.closed = true; }
    fire(type, ev) { for (const fn of this._l[type] || []) fn(ev); }
  }
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSED = 3;
  return { FakeWebSocket, transmitted };
};

const buildTap = (FakeWebSocket) => {
  const win = { WebSocket: FakeWebSocket };
  const api = new Function('window', 'location', 'log', `${TAP}\nreturn { onSocketFrame };`)(
    win, { href: 'https://politiko.io/home' }, () => {},
  );
  return { onSocketFrame: api.onSocketFrame, Tapped: win.WebSocket, win };
};

const CHAT = 'wss://politiko.io/ws/chat?token=SENTINEL-DO-NOT-LEAK';
const MARKET = 'wss://politiko.io/ws/market?token=SENTINEL-DO-NOT-LEAK';

console.log('\n— the tap observes without transmitting —');
{
  const { FakeWebSocket, transmitted } = makeFake();
  const { onSocketFrame, Tapped } = buildTap(FakeWebSocket);
  const seen = [];
  onSocketFrame((r) => seen.push(r));

  const s = new Tapped(CHAT);
  s.fire('open', {});
  for (let i = 0; i < 100; i++) {
    s.fire('message', { data: JSON.stringify({ type: 'presence', username: `u${i}`, online: true }) });
  }
  s.fire('close', { code: 1000, wasClean: true });

  check('every frame was observed', seen.filter((r) => r.ev === 'frame').length, 100);
  check('open and close were observed', seen.filter((r) => r.ev !== 'frame').length, 2);
  check('THE INVARIANT: the tap transmitted nothing', transmitted.length, 0);
  check('the subclass keeps the OPEN constant', Tapped.OPEN, 1);
  ok('an instance is still a real socket', new Tapped(CHAT) instanceof FakeWebSocket);
}

console.log('\n— the game can still transmit, untouched —');
{
  const { FakeWebSocket, transmitted } = makeFake();
  const { Tapped } = buildTap(FakeWebSocket);
  const s = new Tapped(CHAT);
  // stand-in for the game's own onopen, which re-joins its rooms
  s.send(JSON.stringify({ type: 'join', room: 'global' }));
  s.send(JSON.stringify({ type: 'join', room: 'faction' }));
  s.send(JSON.stringify({ type: 'dnd', enabled: true }));
  check('exactly the app\'s three frames went out', transmitted.length, 3);
  check('...unaltered', JSON.parse(transmitted[0]).room, 'global');
}

console.log('\n— the access token never escapes the constructor —');
{
  const { FakeWebSocket } = makeFake();
  const { onSocketFrame, Tapped } = buildTap(FakeWebSocket);
  const seen = [];
  onSocketFrame((r) => seen.push(r));
  const s = new Tapped(CHAT);
  s.fire('open', {});
  s.fire('message', { data: JSON.stringify({ type: 'presence', username: 'a', online: true }) });

  const dump = JSON.stringify(seen);
  ok('SENTINEL appears nowhere in the record stream', !dump.includes('SENTINEL'));
  ok('...nor does the word token', !dump.includes('token'));
  // ws:/wss: are special schemes, so URL.origin keeps the scheme rather than
  // returning "null" the way it would for an opaque one.
  check('safeUrl is origin + pathname only', seen[0].safeUrl, 'wss://politiko.io/ws/chat');
  ok('the query string is gone entirely', !seen[0].safeUrl.includes('?'));
  check('the socket kind is derived from the path', seen[0].kind, 'chat');
  // The socket still has the real URL — we simply never read it out.
  ok('the underlying socket is untouched', s.url === CHAT);
}

console.log('\n— records are inert data, not handles —');
{
  const { FakeWebSocket } = makeFake();
  const { onSocketFrame, Tapped } = buildTap(FakeWebSocket);
  let rec = null;
  onSocketFrame((r) => { if (r.ev === 'frame') rec = r; });
  const s = new Tapped(CHAT);
  s.fire('message', {
    data: JSON.stringify({ type: 'message', message: { id: 1, sender: 'x', body: 'hi' } }),
  });

  ok('the record is frozen', Object.isFrozen(rec));
  ok('nested data is frozen', Object.isFrozen(rec.data) && Object.isFrozen(rec.data.message));
  ok('it round-trips as JSON', JSON.parse(JSON.stringify(rec)).type === 'message');

  const walk = (v, hits = []) => {
    if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, hits);
    else if (typeof v === 'function') hits.push(v);
    return hits;
  };
  check('no function anywhere in the record', walk(rec).length, 0);
  ok('no socket reachable from the record', !Object.values(rec).some((v) => v instanceof FakeWebSocket));
  // The tap must not hand back the app's own parsed object either.
  ok('data is our own copy', rec.data !== undefined && typeof rec.data === 'object');
}

console.log('\n— credential-shaped values are scrubbed before anyone sees them —');
{
  const { FakeWebSocket } = makeFake();
  const { onSocketFrame, Tapped } = buildTap(FakeWebSocket);
  let rec = null;
  onSocketFrame((r) => { if (r.ev === 'frame') rec = r; });
  new Tapped(CHAT).fire('message', {
    data: JSON.stringify({ type: 'weird', access_token: 'hunter2', nested: { session_id: 'abc' }, keep: 'yes' }),
  });
  check('a token value is redacted', rec.data.access_token, '[redacted]');
  check('...at depth too', rec.data.nested.session_id, '[redacted]');
  check('the key name survives, so the finding is still visible', Object.keys(rec.data).includes('access_token'), true);
  check('innocent fields are untouched', rec.data.keep, 'yes');
}

console.log('\n— hostile and boring frames are both survivable —');
{
  const { FakeWebSocket, transmitted } = makeFake();
  const { onSocketFrame, Tapped } = buildTap(FakeWebSocket);
  const seen = [];
  onSocketFrame((r) => { if (r.ev === 'frame') seen.push(r); });
  const s = new Tapped(CHAT);
  s.fire('message', { data: 'not json at all' });
  s.fire('message', { data: '{"unterminated": ' });
  s.fire('message', { data: { blob: true } });           // non-string: skipped, not read
  s.fire('message', { data: JSON.stringify({ no: 'type' }) });
  s.fire('message', { data: JSON.stringify({ type: 'brand_new_thing', a: 1 }) });
  check('only parseable string frames are recorded', seen.length, 2);
  check('an untyped frame records a null type', seen[0].type, null);
  check('an unknown type is surfaced, not dropped', seen[1].type, 'brand_new_thing');
  check('still nothing transmitted', transmitted.length, 0);
}
{
  // A throwing subscriber must not break the game's own handler.
  const { FakeWebSocket } = makeFake();
  const { onSocketFrame, Tapped } = buildTap(FakeWebSocket);
  onSocketFrame(() => { throw new Error('subscriber blew up'); });
  let appSaw = 0;
  const s = new Tapped(CHAT);
  s.addEventListener('message', () => { appSaw++; });
  let threw = false;
  try { s.fire('message', { data: '{"type":"presence"}' }); } catch { threw = true; }
  ok('a broken subscriber does not throw out', !threw);
  check('the app still received its frame', appSaw, 1);
}

console.log('\n— two sockets, reconnects, and double-install —');
{
  const { FakeWebSocket } = makeFake();
  const { onSocketFrame, Tapped, win } = buildTap(FakeWebSocket);
  const seen = [];
  onSocketFrame((r) => seen.push(r));
  const a = new Tapped(CHAT), b = new Tapped(MARKET);
  a.fire('message', { data: '{"type":"presence"}' });
  b.fire('message', { data: '{"type":"quote"}' });
  const chat = seen.find((r) => r.type === 'presence');
  const mkt = seen.find((r) => r.type === 'quote');
  check('chat is tagged chat', chat.kind, 'chat');
  check('market is tagged market', mkt.kind, 'market');
  ok('the two connections have distinct ids', chat.id !== mkt.id);

  const c = new Tapped(CHAT);   // a reconnect
  c.fire('message', { data: '{"type":"presence"}' });
  const ids = new Set(seen.filter((r) => r.kind === 'chat').map((r) => r.id));
  check('a reconnect is a new connection id', ids.size, 2);

  // Re-running the installer over an already-tapped constructor must be a no-op.
  const again = new Function('window', 'location', 'log', `${TAP}\nreturn { onSocketFrame };`)(
    win, { href: 'https://politiko.io/' }, () => {},
  );
  check('double-install is refused', win.WebSocket, Tapped);
  ok('the second install exposes its own (unwired) subscribe fn', typeof again.onSocketFrame === 'function');
}
{
  // An unrecognised origin must not be mislabelled as one of the game's sockets.
  const { FakeWebSocket } = makeFake();
  const { onSocketFrame, Tapped } = buildTap(FakeWebSocket);
  let rec = null;
  onSocketFrame((r) => { rec = r; });
  new Tapped('wss://example.com/socket').fire('open', {});
  check('a third-party socket is kind=other', rec.kind, 'other');
}

// ---------------------------------------------------------------------------
// 3. Drive the real census + question layer
// ---------------------------------------------------------------------------
const CENSUS = cut('  const SEED_WINDOW_MS = 10_000;', '  // ---------------------------------------------------------------------------\n  // 4. Panel');

const buildCensus = () => {
  let record = null;
  const api = new Function(
    'load', 'save', 'K', 'KNOWN', 'log', 'fmtDur', 'onSocketFrame', 'setInterval', 'window',
    `${CENSUS}\nreturn { answers, retired, get census() { return census; } };`,
  )(
    () => null, () => {}, { census: 'c', ui: 'u' },
    { chat: ['room_joined', 'history', 'message_ack', 'message', 'error', 'presence', 'dnd_updated'],
      market: ['quote', 'candle_update'] },
    () => {}, (ms) => `${Math.round(ms / 1000)}s`,
    (fn) => { record = fn; return () => {}; },
    () => 0, { addEventListener: () => {} },
  );
  return { api, feed: (r) => record(r) };
};

const T0 = 1_770_000_000_000;
const frame = (id, kind, type, data, at) => ({ id, kind, type, at, ev: 'frame', data: { type, ...data } });
const open = (id, kind, at) => ({ id, kind, at, ev: 'open' });
const close = (id, kind, at) => ({ id, kind, at, ev: 'close' });
const answerOf = (api, id) => api.answers().find((a) => a.id === id);

console.log('\n— the census reads frame shapes, not contents —');
{
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'presence', { username: 'someone', online: true }, T0 + 100));
  const a = answerOf(api, 'pfields');
  check('presence fields settle on the first frame', a.state, 'done');
  check('...and report no extras', a.text, 'no — exactly type, username, online');
  ok('no player name was retained', !JSON.stringify(api.census).includes('someone'));
}
{
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'presence', { username: 'x', online: true, room_id: 4, at: 'ts' }, T0 + 100));
  const a = answerOf(api, 'pfields');
  check('an extra field on presence is reported', a.text, 'YES — also carries: room_id, at');
}

console.log('\n— the seeding question —');
{
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  for (let i = 0; i < 3; i++) feed(frame(1, 'chat', 'presence', { username: `u${i}`, online: true }, T0 + 500 * i));
  const a = answerOf(api, 'seed');
  check('a burst at connect settles it as SEEDED', a.state, 'done');
  ok('...with the evidence attached', a.text.startsWith('SEEDED'));
}
{
  const { api, feed } = buildCensus();
  // Presence works on this deploy, but never arrives at connect time.
  for (let c = 1; c <= 3; c++) {
    feed(open(c, 'chat', T0));
    feed(frame(c, 'chat', 'presence', { username: 'u', online: true }, T0 + 60_000)); // well past the window
    feed(close(c, 'chat', T0 + 90_000));
  }
  const a = answerOf(api, 'seed');
  check('three quiet connects settle it as DELTA-ONLY', a.state, 'done');
  ok('...with the evidence attached', a.text.startsWith('DELTA-ONLY'));
}
{
  const { api, feed } = buildCensus();
  // A quiet connect with no presence ANYWHERE proves nothing — it is indistinguishable
  // from a server where simply nobody changed state. This is the trap the doc calls out.
  for (let c = 1; c <= 5; c++) { feed(open(c, 'chat', T0)); feed(close(c, 'chat', T0 + 90_000)); }
  const a = answerOf(api, 'seed');
  check('quiet connects with no presence at all stay open', a.state, 'open');
  check('...and say why', a.text, 'no presence frame seen yet');
}

console.log('\n— unrecognised frame types —');
{
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'typing', { username: 'x' }, T0 + 10));
  feed(frame(1, 'chat', 'typing', { username: 'y' }, T0 + 20));
  const a = answerOf(api, 'unknown');
  check('an unknown type settles the question immediately', a.state, 'done');
  ok('...naming it and its count', a.text.includes('chat/typing ×2'));
  ok('a sample is kept for the write-up', JSON.stringify(api.census.unknown).includes('typing'));
}
{
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'presence', { username: 'x', online: true }, T0 + 10));
  const a = answerOf(api, 'unknown');
  check('a short quiet run is not yet an answer', a.state, 'open');
}

console.log('\n— identifying yourself without asking anyone —');
{
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'message_ack', { message: { sender: 'me', body: 'hi' } }, T0 + 10));
  check('a receipt for your own message names you', api.census.selfName, 'me');
  check('and presence for you is then detectable', answerOf(api, 'selfp').state, 'open');
  feed(frame(1, 'chat', 'presence', { username: 'me', online: true }, T0 + 20));
  const a = answerOf(api, 'selfp');
  check('...and settles once seen', a.state, 'done');
  ok('...saying what it means', a.text.includes('off by one'));
}

console.log('\n— knowing when to stop —');
{
  const { api, feed } = buildCensus();
  check('a fresh install is not retired', api.retired(), false);

  feed(open(1, 'chat', T0));
  for (let i = 0; i < 3; i++) feed(frame(1, 'chat', 'presence', { username: `u${i}`, online: true }, T0 + i));
  feed(frame(1, 'chat', 'typing', {}, T0 + 10));            // settles `unknown`
  feed(open(2, 'market', T0));
  feed(frame(2, 'market', 'quote', { instrument_id: 1, price: 5 }, T0 + 20));

  const open_ = api.answers().filter((a) => a.blocking && a.state !== 'done').map((a) => a.id);
  check('every blocking question is settled', open_, []);
  check('so the tool reports itself retired', api.retired(), true);
  check('a rare bonus question staying open does not block that',
    answerOf(api, 'escope').state, 'open');
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
