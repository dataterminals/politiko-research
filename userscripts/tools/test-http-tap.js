// Slices HTTP TAP v1 out of the template and drives it against stubs.
//
// The block exists because eleven tools each installed their own window.fetch
// wrapper and nine of them cloned and parsed every /api/ body before checking
// whether they wanted it. Everything below is a property that consolidation has
// to keep: one installer no matter the load order, one parse per response rather
// than one per subscriber, nothing read at all on a path nobody asked for, and a
// payload one tool cannot edit out from under another.
//
// Run: node userscripts/tools/test-http-tap.js
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', '_template.user.js'), 'utf8');

const i = SRC.indexOf('  const HTTP_TAP_VERSION =');
const j = SRC.indexOf('    return api.subscribe;', i);
if (i < 0 || j < 0) throw new Error('HTTP TAP markers not found in _template.user.js');
// Marker to marker, not a line count — same reason PANEL KIT is sliced this way.
const SLICE = `${SRC.slice(i, j)}    return api.subscribe;\n  })();\n  return onApi;`;

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

// --- stubs -----------------------------------------------------------------
// A page, near enough: one window, one XHR prototype, and a fetch that answers
// with whatever the test queued. Counters live here so a test can ask how many
// times a body was actually read.
const mkPage = () => {
  const stats = { clones: 0, parses: 0, xhrParses: 0, fetches: 0 };

  const mkRes = (body, { ct = 'application/json', status = 200 } = {}) => {
    const res = {
      status, ok: status >= 200 && status < 300, bodyUsed: false,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ct : null) },
      json: async () => { res.bodyUsed = true; stats.parses++; return JSON.parse(JSON.stringify(body)); },
      clone: () => { stats.clones++; return mkRes(body, { ct, status }); },
    };
    return res;
  };

  let queued = null;
  const window = {
    fetch: async (url, init) => { stats.fetches++; return queued ?? mkRes({}); },
  };

  class XMLHttpRequest {
    constructor() { this.responseType = ''; }
    open() {}
    send() {}
    addEventListener(ev, fn) { (this.__l ??= []).push([ev, fn]); }
    getResponseHeader() { return this.__ct ?? 'application/json'; }
  }

  const location = { href: 'https://politiko.io/' };
  const log = () => {};

  const load = () => new Function('window', 'log', 'XMLHttpRequest', 'location', SLICE)(
    window, log, XMLHttpRequest, location,
  );

  // Drive one XHR through the patched prototype the way the browser would.
  // responseType '' hands back text; 'json' hands back a live object and makes
  // responseText throw, exactly as a real XHR does.
  const xhr = (url, body, { ct = 'application/json', status = 200, responseType = '' } = {}) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.send();
    x.status = status;
    x.__ct = ct;
    x.responseType = responseType;
    Object.defineProperty(x, 'responseText', {
      get: () => {
        if (responseType !== '' && responseType !== 'text') throw new Error('InvalidStateError');
        stats.xhrParses++;
        return typeof body === 'string' ? body : JSON.stringify(body);
      },
      configurable: true,
    });
    Object.defineProperty(x, 'response', { get: () => body, configurable: true });
    for (const [ev, fn] of x.__l ?? []) if (ev === 'load') fn();
    return x;
  };

  return {
    window, XMLHttpRequest, stats, load, xhr, mkRes,
    serve: (r) => { queued = r; },
  };
};

const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  // -------------------------------------------------------------------------
  console.log('\n— one installer, whatever the load order —');
  {
    const p = mkPage();
    const bare = p.window.fetch;
    const bareSend = p.XMLHttpRequest.prototype.send;

    const subs = [];
    for (let n = 0; n < 11; n++) subs.push(p.load()); // eleven tools, as shipped

    check('every copy got a subscribe function', subs.every((s) => typeof s === 'function'), true);
    check('fetch was wrapped', p.window.fetch !== bare, true);
    check('XHR send was wrapped', p.XMLHttpRequest.prototype.send !== bareSend, true);

    // The second copy must find the first, not stack on it. Load a twelfth and
    // confirm nothing moved.
    const beforeFetch = p.window.fetch, beforeSend = p.XMLHttpRequest.prototype.send;
    p.load();
    check('a later copy does not re-wrap fetch', p.window.fetch === beforeFetch, true);
    check('a later copy does not re-wrap XHR', p.XMLHttpRequest.prototype.send === beforeSend, true);
    check('all copies share one registry', subs.every((s) => s === subs[0]), true);
  }

  // -------------------------------------------------------------------------
  console.log('\n— a path nobody asked for is never read —');
  {
    const p = mkPage();
    const onApi = p.load();
    const seen = [];
    onApi('/api/government', (r) => seen.push(r.path));

    p.serve(p.mkRes({ citizens: 291 }));
    await p.window.fetch('https://politiko.io/api/user/status');
    await tick();

    check('nothing delivered', seen, []);
    check('body never cloned', p.stats.clones, 0);
    check('body never parsed', p.stats.parses, 0);
    check('the request still went out', p.stats.fetches, 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— a wanted path is parsed once and delivered to everyone —');
  {
    const p = mkPage();
    const onApi = p.load();
    const got = [];
    onApi('/api/government', (r) => got.push(['a', r.data.president]));
    onApi('/api/government', (r) => got.push(['b', r.data.president]));
    onApi('/api/gov', (r) => got.push(['prefix', r.data.president])); // prefix, not exact
    onApi('*', (r) => got.push(['star', r.data.president]));
    onApi('/api/time', () => got.push(['wrong', null]));

    p.serve(p.mkRes({ president: 'Hoppe' }));
    await p.window.fetch('https://politiko.io/api/government');
    await tick();

    check('delivered to all four matching subscribers', got.length, 4);
    check('the one on another path stayed quiet', got.some((g) => g[0] === 'wrong'), false);
    check('parsed exactly once', p.stats.parses, 1);
    check('cloned exactly once', p.stats.clones, 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— the shared payload cannot be edited out from under a peer —');
  {
    const p = mkPage();
    const onApi = p.load();
    let bView = null;
    onApi('/api/government', (r) => {
      try { r.data.president = 'TAMPERED'; } catch { /* frozen, as intended */ }
      try { r.data.seats.push('extra'); } catch { /* frozen, as intended */ }
    });
    onApi('/api/government', (r) => { bView = { p: r.data.president, n: r.data.seats.length }; });

    p.serve(p.mkRes({ president: 'Hoppe', seats: ['a', 'b'] }));
    await p.window.fetch('https://politiko.io/api/government');
    await tick();

    check('the second tool sees the server value', bView, { p: 'Hoppe', n: 2 });
  }

  // -------------------------------------------------------------------------
  console.log('\n— a throwing subscriber is contained —');
  {
    const p = mkPage();
    const onApi = p.load();
    const got = [];
    onApi('/api/time', () => { throw new Error('boom'); });
    onApi('/api/time', (r) => got.push(r.status));

    p.serve(p.mkRes({ datetime: 'x' }));
    const res = await p.window.fetch('https://politiko.io/api/time');
    await tick();

    check('the next subscriber still ran', got, [200]);
    check("the app's own body is still unread", res.bodyUsed, false);
  }

  // -------------------------------------------------------------------------
  console.log('\n— the record —');
  {
    const p = mkPage();
    const onApi = p.load();
    let rec = null;
    onApi('/api/actions/poll', (r) => { rec = r; });

    p.serve(p.mkRes({ ok: true }));
    await p.window.fetch('https://politiko.io/api/actions/poll?page=3', {
      method: 'post', body: 'issue=housing',
    });
    await tick();

    check('url is kept whole, query and all', rec.url, 'https://politiko.io/api/actions/poll?page=3');
    check('path is the pathname alone', rec.path, '/api/actions/poll');
    check('method is upper-cased', rec.method, 'POST');
    check('a string request body is carried', rec.body, 'issue=housing');
    check('ok and status are reported', [rec.ok, rec.status], [true, 200]);
    check('the record itself is frozen', Object.isFrozen(rec), true);
  }

  // -------------------------------------------------------------------------
  console.log('\n— a Request object is never drained —');
  {
    const p = mkPage();
    const onApi = p.load();
    let rec = null;
    onApi('/api/time', (r) => { rec = r; });

    // A Request-shaped first argument: the tap may read .url and .method as
    // properties, and must not touch anything that consumes the body.
    let drained = false;
    const req = {
      url: 'https://politiko.io/api/time',
      method: 'PUT',
      get body() { drained = true; return 'nope'; },
      text: () => { drained = true; return Promise.resolve('nope'); },
      json: () => { drained = true; return Promise.resolve({}); },
    };
    p.serve(p.mkRes({ datetime: 'x' }));
    await p.window.fetch(req);
    await tick();

    check('the Request body was not read', drained, false);
    check('no body is reported for it', rec.body, null);
    check('its method still came through', rec.method, 'PUT');
  }

  // -------------------------------------------------------------------------
  console.log('\n— non-JSON still reports the status —');
  {
    const p = mkPage();
    const onApi = p.load();
    let rec = null;
    onApi('/api/actions/donations', (r) => { rec = r; });

    p.serve(p.mkRes('page not found', { ct: 'text/plain', status: 404 }));
    await p.window.fetch('https://politiko.io/api/actions/donations');
    await tick();

    check('a record still arrives', [rec.status, rec.ok, rec.data], [404, false, null]);
    check('nothing was parsed', p.stats.parses, 0);
  }

  // -------------------------------------------------------------------------
  console.log('\n— XHR takes the same path —');
  {
    const p = mkPage();
    const onApi = p.load();
    for (let n = 0; n < 4; n++) p.load(); // the five tools that used to patch XHR
    const got = [];
    onApi('/api/people', (r) => got.push(r.data.total));

    p.xhr('https://politiko.io/api/people?page=1', { total: 22 });
    check('delivered', got, [22]);
    check('responseText read once, not once per tool', p.stats.xhrParses, 1);

    p.xhr('https://politiko.io/api/user/status', { hp: 100 });
    check('an unwanted XHR path is never parsed', p.stats.xhrParses, 1);

    p.xhr('https://politiko.io/assets/index.js', { nope: 1 });
    check('a non-API XHR is ignored', p.stats.xhrParses, 1);
  }

  // -------------------------------------------------------------------------
  // responseType 'json' is the case market-watch carried privately before the block
  // existed: responseText throws, and this.response is an object the APP holds, so
  // freezing it in place would take away the game's own ability to mutate its reply.
  console.log('\n— an XHR that answers with an object, not text —');
  {
    const p = mkPage();
    const onApi = p.load();
    let seen = null;
    onApi('/api/people', (r) => { seen = r.data; });

    const live = { total: 22, items: [{ name: 'mira' }] };
    p.xhr('https://politiko.io/api/people', live, { responseType: 'json' });

    check('it still arrives', seen && seen.total, 22);
    check('and is frozen for us', Object.isFrozen(seen), true);
    check("but the app's own object is untouched", Object.isFrozen(live), false);
    live.total = 23; // the app mutating its reply must not reach a subscriber
    check('the subscriber kept its own copy', seen.total, 22);
  }

  // -------------------------------------------------------------------------
  console.log('\n— an XHR carrying something that is not JSON at all —');
  {
    const p = mkPage();
    const onApi = p.load();
    let calls = 0;
    onApi('/api/people', () => { calls++; });

    p.xhr('https://politiko.io/api/people', 'not json at all');
    check('a body that will not parse is dropped, not delivered', calls, 0);

    p.xhr('https://politiko.io/api/people', { ok: 1 }, { ct: 'text/html' });
    check('a non-JSON content-type still reports the status', calls, 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n— unsubscribe —');
  {
    const p = mkPage();
    const onApi = p.load();
    const got = [];
    const off = onApi('/api/time', (r) => got.push(r.path));

    p.serve(p.mkRes({ datetime: 'x' }));
    await p.window.fetch('https://politiko.io/api/time');
    await tick();
    off();
    await p.window.fetch('https://politiko.io/api/time');
    await tick();

    check('delivered once, then stopped', got, ['/api/time']);
    check('and stopped reading the body too', p.stats.parses, 1);
  }

  console.log(fail ? `\n${fail} failing\n` : '\nall good\n');
  process.exit(fail ? 1 : 0);
})();
