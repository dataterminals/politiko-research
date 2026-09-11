// Politiko — store collector
//
// Bundles what this repo's own userscripts have ALREADY stored into one JSON file, so a
// session's readings can be handed to someone (or something) that reads files instead of
// screenshots. It is the export half of the tools; it collects nothing new. The other
// half is tools/read-stores.js, which turns the bundle into a brief.
//
// DISCLOSURE (Politiko rules, Scripting Abuse clause)
//
//   Reads:    localStorage keys matching /^pk[a-z]{2,4}:/ on the current origin — the
//             sixteen prefixes this repo's tools write under, and nothing else. The
//             filter is anchored, so `auth` and `device_signals` cannot match it; both
//             are on an explicit denylist as well, checked after the prefix.
//   Writes:   nothing. No localStorage key is created, changed or removed.
//   Requests: ZERO. This file contains no fetch, no XMLHttpRequest, no WebSocket, no
//             sendBeacon, no dynamic import, and constructs no fetching element. It
//             cannot reach politiko.io or anywhere else.
//   Alerts:   none.
//   Scrubs:   before writing, any value under a key whose NAME carries a credential
//             word as a whole token (`token`, `auth`, `secret`, `password`, `cookie`,
//             `refresh`, `canvas`, …) is replaced by `[redacted]`, and any string VALUE
//             shaped like a JWT or a 40+ character opaque blob is replaced by its
//             length. Numbers and booleans are never redacted — a counter cannot be a
//             credential. The rule is whole tokens, not substrings: see below.
//   Output:   a file the browser saves through its normal download path, from a Blob
//             built in the page. Nothing is transmitted. The return value is a summary
//             (key names and sizes), never the bundle itself.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
//   It does not refresh anything first. The bundle is as old as the last time the
//   operator looked at the screen that filled each store, and every tool already records
//   its own ages — a "make it current" step is the line in docs/01-rules-envelope.md, and
//   it is exactly the feature this file will keep being asked for.
//
//   It does not read the game's query cache, the DOM, or any key it did not write. Its
//   whole safety argument is that it reads only this repo's own stores, and widening the
//   filter throws that away.
//
//   It does not touch `auth`. That key holds the access token, the refresh token, the
//   username, the role — and, since the 2026-09-03 build, the account's `fedded` state.
//   See docs/01-rules-envelope.md. `device_signals` is next to it on the same list.
//
// WHAT IT REDACTS, AND WHAT IT DOES NOT (found 2026-09-11)
//
//   The first bundle ever collected carried 28 redactions and every one was a false
//   positive: the key-name check was a substring match, so `canvass` (the sleeper action)
//   matched `canvas`, `Slutty secretary` (a corporation job) matched `secret`, and
//   world-watch's last-seen stamp for `/api/refresh` matched `refresh`. The cost was the XP
//   record of every canvass and a dozen market ids — real readings, blanked for a word
//   inside a word. The check now splits a key into tokens (on anything that is not a letter or
//   digit, and on a lower→upper case change) and asks whether any WHOLE token is a
//   credential word, so `refresh_token`, `refreshToken` and `x-csrf-token` all still trip
//   it and `canvass` does not. userscripts/tools/test-collect.js runs this file against a
//   stub store holding both kinds and fails the build if either side moves.
//
// RUN IT
//
//   Either: on a politiko.io tab the operator has open, paste the whole file into the
//   DevTools console. Or: from any same-origin document that never boots the app — a
//   static file such as https://politiko.io/favicon.svg has the same localStorage and
//   zero scripts, which is how a browser extension's script runner collects for an
//   installed PWA whose window it cannot reach. The download anchor is created in the
//   XHTML namespace so that an SVG document can run it unchanged.
//
//   It prints a summary and saves `politiko-stores-<stamp>.json`. Move that into
//   artifacts/, which is gitignored — the bundle contains observations of other players
//   and belongs nowhere near a commit. Then `node tools/read-stores.js` reads it.
//
// Fenced by userscripts/tools/test-collect.js.

(() => {
  'use strict';

  // The seventeen prefixes on disk as of 2026-09-06. The regex is the filter; this list
  // is only used to label and group, so a tool added later is collected without a code
  // change and simply lands under its own prefix with a null label.
  //
  // Three of these were wrong until the labels were checked against what the tools
  // actually write, and the reason they were wrong is worth keeping: `pkpw:` and `pksw:`
  // each had TWO tools writing under them, so no single label could have been right.
  // poll-watch moved to `pkpl:` and shop-watch to `pksh:`; userscripts/tools/
  // test-placement.js now fails the build if two tools ever write one key again. The
  // third, `pkxx:`, is _template.user.js — never installed, and never xp-watch, which
  // has only ever written `pkxp:`.
  const KNOWN = {
    'pkaw:': 'align-watch',   'pkbj:': 'jack-watch',    'pkbw:': 'bar-watch',
    'pkcm:': 'comms-move',    'pkgw:': 'gov-watch',     'pkmw:': 'market-watch',
    'pkpl:': 'poll-watch',    'pkpw:': 'people-watch',  'pkqj:': 'quick-jump',
    'pkrw:': 'raid-watch',    'pksh:': 'shop-watch',    'pksl:': 'slot-watch',
    'pksw:': 'sleeper-watch', 'pktw:': 'time-watch',    'pkws:': 'ws-watch',
    'pkww:': 'world-watch',   'pkxp:': 'xp-watch',      'pkxx:': '_template (not installed)',
  };

  // Anchored. A key has to START with pk<2-4 letters>: to be read at all.
  const PREFIX = /^(pk[a-z]{2,4}:)/;

  // Defence in depth. Nothing matching PREFIX can equal one of these, but the cost of
  // saying so is one line and the cost of being wrong is a token in a file.
  const NEVER = ['auth', 'device_signals'];

  // A key NAME whose value is a credential — judged by whole tokens, never substrings.
  // `canvass` is not `canvas`, `secretary` is not `secret`; see the header for the bundle
  // that taught us that. A key is split on anything that is not a letter or digit and on
  // a lower→upper case change, so `refresh_token`, `refreshToken` and `x-csrf-token` all
  // carry the token `token`.
  const SECRET_WORDS = new Set([
    'token', 'auth', 'authorization', 'authentication', 'oauth', 'bearer', 'secret',
    'password', 'passwd', 'cookie', 'cookies', 'jwt', 'signature', 'refresh',
    'credential', 'credentials', 'fingerprint', 'canvas',
  ]);
  // Two literal fragments that are not words: the game's own `device_signals` key and
  // the `x-ct-*` header family it sends.
  const SECRET_FRAGMENTS = /device_signal|x-ct-/i;
  const tokensOf = (k) => String(k)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const isSecretKey = (k) => SECRET_FRAGMENTS.test(k) || tokensOf(k).some((t) => SECRET_WORDS.has(t));

  // A VALUE that looks like a JWT or a long opaque credential, whatever it is called.
  const SECRET_VALUE = /^(ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.|[A-Za-z0-9_-]{40,}$)/;

  const redactions = [];

  const scrub = (value, path) => {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string' && SECRET_VALUE.test(value)) {
        redactions.push({ path, why: 'value shape' });
        return `[redacted ${value.length} chars]`;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v, i) => scrub(v, `${path}[${i}]`));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Only a string or a structure can hold a credential. A number or boolean under a
      // secret-shaped name — `seen['/api/refresh'] = <a timestamp>` — is a reading, and
      // passes.
      const holdsData = typeof v === 'string' || (v !== null && typeof v === 'object');
      if (holdsData && isSecretKey(k)) {
        redactions.push({ path: `${path}.${k}`, why: 'key name' });
        out[k] = '[redacted]';
        continue;
      }
      out[k] = scrub(v, `${path}.${k}`);
    }
    return out;
  };

  const tools = {};
  const stats = { keys_read: 0, keys_skipped: 0, bytes_raw: 0, unparsed: 0 };

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const m = key && key.match(PREFIX);
    if (!m || NEVER.includes(key)) { stats.keys_skipped++; continue; }

    const prefix = m[1];
    const raw = localStorage.getItem(key);
    stats.keys_read++;
    stats.bytes_raw += (raw || '').length;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;            // a tool storing a bare string is fine; keep it verbatim
      stats.unparsed++;
    }

    (tools[prefix] || (tools[prefix] = { tool: KNOWN[prefix] || null, keys: {} }))
      .keys[key.slice(prefix.length)] = scrub(parsed, key);
  }

  const bundle = {
    collected_at: new Date().toISOString(),
    origin: location.origin,
    collector: 'tools/collect-stores.js',
    note: 'Readings already held by this repo\'s userscripts. Nothing was refreshed to '
        + 'produce this file; every value is as old as the last screen that filled it, and '
        + 'each tool records its own ages inside its own keys.',
    stats,
    redactions,
    tools,
  };

  const json = JSON.stringify(bundle, null, 2);
  const stamp = bundle.collected_at.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const name = `politiko-stores-${stamp}.json`;

  // The anchor is created in the XHTML namespace on purpose: in an XML document (an SVG
  // opened as a page) `createElement('a')` makes a namespace-less element with no
  // download behaviour, and this file has to run from exactly such a page. In an HTML
  // document the two calls are the same element.
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElementNS('http://www.w3.org/1999/xhtml', 'a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(
    `%cpolitiko store collector%c  ${name}`,
    'font-weight:bold', 'color:#888',
  );
  console.log(`  ${stats.keys_read} keys from ${Object.keys(tools).length} tools`
    + `  ·  ${kb(stats.bytes_raw)} raw, ${kb(json.length)} written`
    + `  ·  ${stats.keys_skipped} keys skipped`
    + (stats.unparsed ? `  ·  ${stats.unparsed} not JSON` : ''));
  console.table(Object.entries(tools).map(([prefix, t]) => ({
    prefix, tool: t.tool || '(unknown)', keys: Object.keys(t.keys).length,
  })));
  if (redactions.length) {
    console.warn(`  ${redactions.length} value(s) redacted — a tool stored something `
      + `credential-shaped. Paths:`, redactions.map((r) => r.path));
  }
  console.log('  Move it into artifacts/ (gitignored). It contains other players\' data.');

  // A summary, never the bundle. In a console the file is already on disk and this is
  // what you want to see; through an extension's script runner the return value travels
  // back to whoever asked, and three megabytes of other players' readings is not a thing
  // to hand over as a side effect.
  return {
    name,
    stats,
    redactions: redactions.length,
    written: json.length,
    tools: Object.fromEntries(Object.entries(tools).map(([p, t]) => [p, { tool: t.tool, keys: Object.keys(t.keys) }])),
  };
})();
