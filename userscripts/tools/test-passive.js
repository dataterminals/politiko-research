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

const buildCensus = (stored) => {
  let record = null;
  const api = new Function(
    'load', 'save', 'K', 'KNOWN', 'log', 'fmtDur', 'onSocketFrame', 'setInterval', 'window',
    `${CENSUS}\nreturn { answers, retired, report, seedVerdict, clockRate, get census() { return census; } };`,
  )(
    () => stored ?? null, () => {}, { census: 'c', ui: 'u' },
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

console.log('\n— the value allowlist is closed, not merely careful —');
{
  // The single most important property of 0.2.0. If a username, a chat body or any
  // other unlisted value can reach storage, the disclosure is a lie.
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'presence', { username: 'someone_else', online: true }, T0 + 10));
  feed(frame(1, 'chat', 'message', {
    client_msg_id: 'x', room_id: 3,
    message: { id: 1, sender: 'a_third_party', body: 'a private thing', sent_at: 'ts' },
  }, T0 + 20));
  feed(frame(1, 'chat', 'room_joined', { room_id: 3, kind: 'direct', label: 'Chat with Bob', dm_target: 'bob' }, T0 + 30));
  feed(open(2, 'market', T0 + 40));
  feed(frame(2, 'market', 'quote', { instrument_id: 8, price: 1, bid: 1, ask: 2, game_time: 5000 }, T0 + 50));

  const dump = JSON.stringify(api.census);
  ok('no other player username stored', !dump.includes('someone_else') && !dump.includes('a_third_party'));
  ok('no chat body stored', !dump.includes('a private thing'));
  ok('no room label or dm_target stored', !dump.includes('Chat with Bob') && !dump.includes('bob'));
  ok('no instrument_id value stored', !/"instrument_id":\s*8/.test(dump));
  ok('...but the allowlisted game_time IS stored', dump.includes('5000'));
  ok('...and the key NAMES still survive', dump.includes('username') && dump.includes('dm_target'));
}
{
  // The one path that stores values wholesale. Caught leaking a real username in
  // browser testing: a `typing` frame the game has no case for carried one.
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'typing', { username: 'alice', room_id: 1 }, T0 + 10));
  feed(frame(1, 'chat', 'sys_note', { level: 'warn', text: 'slow mode', ttl_ms: 30_000 }, T0 + 20));
  feed(frame(1, 'market', 'subscribed', { instrument_id: 8 }, T0 + 30));
  const dump = JSON.stringify(api.census.unknown);
  ok('an unknown frame does not retain a username', !dump.includes('alice'));
  ok('...but still reports that it HAS a username field', dump.includes('username') && dump.includes('<string>'));
  ok('free-text is scrubbed too', !dump.includes('slow mode'));
  // The scrub must not swallow the values that make a sample worth keeping.
  const sample = (kind, type) => api.census.unknown[kind][type].samples[0];
  ok('non-person values survive', sample('chat', 'sys_note').includes('"ttl_ms":30000'));
  ok('instrument ids survive intact', sample('market', 'subscribed').includes('"instrument_id":8'));
  ok('room ids survive intact', sample('chat', 'typing').includes('"room_id":1'));
}
{
  // presence.online must reach storage as counts and never beside a name.
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'presence', { username: 'p', online: true }, T0 + 10));
  feed(frame(1, 'chat', 'presence', { username: 'q', online: true }, T0 + 20));
  feed(frame(1, 'chat', 'presence', { username: 'r', online: false }, T0 + 30));
  check('online edges counted', api.census.presenceOn, 2);
  check('offline edges counted', api.census.presenceOff, 1);
  ok('no per-user structure exists', !JSON.stringify(api.census).match(/"[pqr]"/));
}

console.log('\n— the seeding question, rebuilt around composition —');
{
  const { api, feed } = buildCensus();
  // Two connects that each open with an all-online burst = a roster seed.
  for (const c of [1, 2]) {
    feed(open(c, 'chat', T0));
    for (let i = 0; i < 3; i++) feed(frame(c, 'chat', 'presence', { username: `u${i}`, online: true }, T0 + 500 * i));
    feed(close(c, 'chat', T0 + 9000));
  }
  const a = answerOf(api, 'seed');
  check('two all-online bursts settle it as SEEDED', a.state, 'done');
  ok('...and say so', a.text.startsWith('SEEDED'));
  ok('...reporting the burst sizes', a.text.includes('3, 3'));
}
{
  const { api, feed } = buildCensus();
  // THE CASE 0.1.x GOT WRONG: three frames near a connect, but a mix of on and off.
  // That is churn from reloading players, not a roster.
  for (const c of [1, 2, 3]) {
    feed(open(c, 'chat', T0));
    feed(frame(c, 'chat', 'presence', { username: 'a', online: true }, T0 + 100));
    feed(frame(c, 'chat', 'presence', { username: 'b', online: false }, T0 + 200));
    feed(frame(c, 'chat', 'presence', { username: 'a', online: true }, T0 + 300));
    feed(close(c, 'chat', T0 + 9000));
  }
  const a = answerOf(api, 'seed');
  check('a mixed burst is NOT read as a seed', a.state, 'open');
  ok('...and is named as churn', a.text.includes('mixed'));
}
{
  const { api, feed } = buildCensus();
  for (let c = 1; c <= 3; c++) {
    feed(open(c, 'chat', T0));
    feed(frame(c, 'chat', 'presence', { username: 'u', online: true }, T0 + 60_000)); // past the window
    feed(close(c, 'chat', T0 + 90_000));
  }
  const a = answerOf(api, 'seed');
  check('three silent connects settle it as NOT SEEDED', a.state, 'done');
  ok('...and say so', a.text.startsWith('NOT SEEDED'));
}
{
  const { api, feed } = buildCensus();
  for (let c = 1; c <= 5; c++) { feed(open(c, 'chat', T0)); feed(close(c, 'chat', T0 + 90_000)); }
  const a = answerOf(api, 'seed');
  check('silence with no presence anywhere proves nothing', a.state, 'open');
}
{
  const { api, feed } = buildCensus();
  // A single all-online burst is suggestive but not enough — one clean window can
  // still be coincidence, so the bar is two.
  feed(open(1, 'chat', T0));
  for (let i = 0; i < 4; i++) feed(frame(1, 'chat', 'presence', { username: `u${i}`, online: true }, T0 + 100 * i));
  feed(close(1, 'chat', T0 + 9000));
  const a = answerOf(api, 'seed');
  check('one all-online burst is not yet enough', a.state, 'open');
  ok('...and says how far off it is', a.text.includes('need 2'));
}

console.log('\n— quote.game_time —');
{
  const { api, feed } = buildCensus();
  feed(open(1, 'market', T0));
  // 52.14 game-seconds per real second over 60 real seconds = 3128.4 game-seconds.
  feed(frame(1, 'market', 'quote', { instrument_id: 1, game_time: 1_000_000 }, T0));
  feed(frame(1, 'market', 'quote', { instrument_id: 1, game_time: 1_003_128 }, T0 + 60_000));
  const r = api.clockRate();
  ok('a rate is derivable from two samples', !!r);
  ok('...and lands on the documented ~52.14', Math.abs(r.rate - 52.14) < 0.1);
  const a = answerOf(api, 'clock');
  check('the question settles', a.state, 'done');
  ok('...and cross-checks against docs/06', a.text.includes('matches'));
}
{
  const { api, feed } = buildCensus();
  feed(open(1, 'market', T0));
  feed(frame(1, 'market', 'quote', { instrument_id: 1, game_time: 1000 }, T0));
  feed(frame(1, 'market', 'quote', { instrument_id: 1, game_time: 1010 }, T0 + 5000));
  check('too short a baseline yields no rate', api.clockRate(), null);
  check('...and the question stays open', answerOf(api, 'clock').state, 'open');
}
{
  const { api, feed } = buildCensus();
  feed(open(1, 'market', T0));
  feed(frame(1, 'market', 'quote', { instrument_id: 1, game_time: '2026-08-08T00:00:00Z' }, T0));
  const a = answerOf(api, 'clock');
  check('a non-numeric game_time settles differently', a.state, 'done');
  ok('...naming the type', a.text.includes('string'));
}
{
  const { api, feed } = buildCensus();
  feed(open(1, 'market', T0));
  for (const [tf, bs] of [['1m', 100], ['1m', 100], ['1m', 160], ['5m', 100]]) {
    feed(frame(1, 'market', 'candle_update', { instrument_id: 1, timeframe: tf, bucket_start: bs }, T0));
  }
  check('timeframes tallied', api.census.timeframes, { '1m': 3, '5m': 1 });
  check('bucket_start deduped per timeframe', api.census.buckets, { '1m': [100, 160], '5m': [100] });
}

console.log('\n— inter-arrival histogram —');
{
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'presence', { online: true }, T0));
  feed(frame(1, 'chat', 'presence', { online: true }, T0 + 500));      // <1s
  feed(frame(1, 'chat', 'presence', { online: true }, T0 + 3000));     // 1-5s
  feed(frame(1, 'chat', 'presence', { online: true }, T0 + 100_000));  // 1-5m
  const a = api.census.arrivals['chat/presence'];
  check('frames counted', a.n, 4);
  check('gaps bucketed', a.buckets, { '<1s': 1, '1-5s': 1, '1-5m': 1 });
}

console.log('\n— migrating a v1 census —');
{
  const v1 = {
    v: 1, startedAt: T0, observedMs: 1_240_008, frames: 125, connects: 8,
    types: { chat: { presence: { n: 27, keys: { online: 27 }, firstAt: T0, lastAt: T0 } } },
    unknown: { market: { subscribed: { n: 14, firstAt: T0, samples: ['{"type":"subscribed"}'] } } },
    seeded: true, seedEvidence: '3 presence frames within 10s of a connect',
    quietRuns: 0, presenceTotal: 27, selfName: 'dataterminals', selfInPresence: true, errorScopes: {},
  };
  const { api } = buildCensus(v1);
  const c = api.census;
  check('version bumped', c.v, 2);
  check('frame counts preserved', c.frames, 125);
  check('hard-won unknown samples preserved', c.unknown.market.subscribed.n, 14);
  check('presence total preserved', c.presenceTotal, 27);
  check('self identity preserved', c.selfName, 'dataterminals');
  check('startedAt preserved', c.startedAt, T0);
  check('provenance recorded', c.migratedFrom, 1);
  ok('the v1 seed verdict is NOT carried over', c.seeded === undefined && c.seedEvidence === undefined);
  check('...so the seeding question starts over', answerOf(api, 'seed').state, 'open');
  check('value counters start empty', [c.presenceOn, c.presenceOff, c.clock.length], [0, 0, 0]);
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

  // Two all-online connect windows settle `seed`; a stray type settles `unknown`;
  // a quote settles `mfields`; two spaced game_time samples settle `clock`.
  for (const c of [1, 2]) {
    feed(open(c, 'chat', T0));
    for (let i = 0; i < 3; i++) feed(frame(c, 'chat', 'presence', { username: `u${i}`, online: true }, T0 + i));
    feed(close(c, 'chat', T0 + 9000));
  }
  feed(frame(1, 'chat', 'typing', {}, T0 + 10));            // settles `unknown`
  feed(open(3, 'market', T0));
  feed(frame(3, 'market', 'quote', { instrument_id: 1, price: 5, game_time: 1_000_000 }, T0));
  feed(frame(3, 'market', 'quote', { instrument_id: 1, price: 6, game_time: 1_003_128 }, T0 + 60_000));

  const open_ = api.answers().filter((a) => a.blocking && a.state !== 'done').map((a) => a.id);
  check('every blocking question is settled', open_, []);
  check('so the tool reports itself retired', api.retired(), true);
  check('a rare bonus question staying open does not block that',
    answerOf(api, 'escope').state, 'open');
}

console.log('\n— the findings report —');
{
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'presence', { username: 'zed', online: true }, T0 + 10));
  feed(frame(1, 'chat', 'typing', { username: 'zed' }, T0 + 20));
  const r = api.report();
  ok('leads with a timestamp', /^# ws-watch findings — \d{4}-\d{2}-\d{2}T/.test(r));
  ok('states the sample size', r.includes('2 frames · 1 connections'));
  ok('marks settled questions with [x]', r.includes('[x] Does a presence frame carry'));
  ok('marks open questions with [ ]', /\[ \] Does the server seed presence/.test(r));
  ok('flags bonus questions as non-blocking', r.includes('(bonus)'));
  ok('reports unrecognised types with their sample', r.includes('chat/typing ×1') && r.includes('"type":"typing"'));
  ok('...with the person scrubbed out of it', r.includes('"username":"<string>"') && !r.includes('"zed"'));
  ok('lists frame shapes by key name', r.includes('chat/presence ×1 — online username'));
  ok('embeds the raw census as fenced json', r.includes('```json') && r.includes('"presenceTotal": 1'));
  ok('the raw block is parseable', (() => {
    const m = r.match(/```json\n([\s\S]*?)\n```/);
    try { return JSON.parse(m[1]).v === 2; } catch { return false; }
  })());
}
{
  // The report must not become a second way to leak what the census refuses to store.
  const { api, feed } = buildCensus();
  feed(open(1, 'chat', T0));
  feed(frame(1, 'chat', 'message', { message: { sender: 'someone', body: 'a private thing' } }, T0 + 10));
  const r = api.report();
  ok('no chat body reaches the report', !r.includes('a private thing'));
  ok('no other player name reaches the report', !r.includes('someone'));
  ok('...but the shape does', r.includes('message.sender') && r.includes('message.body'));
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
