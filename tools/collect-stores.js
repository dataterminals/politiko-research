// Politiko — store collector
//
// Bundles what this repo's own userscripts have ALREADY stored into one JSON file, so a
// session's readings can be handed to someone (or something) that reads files instead of
// screenshots. It is the export half of the tools; it collects nothing new.
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
//   Output:   a file the browser saves through its normal download path, from a Blob
//             built in the page. Nothing is transmitted.
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
// RUN IT
//
//   On a politiko.io tab the operator has open, paste the whole file into the DevTools
//   console. It prints a summary and saves `politiko-stores-<stamp>.json`. Move that into
//   artifacts/, which is gitignored — the bundle contains observations of other players
//   and belongs nowhere near a commit.
//
// Fenced by userscripts/tools/test-collect.js.

(() => {
  'use strict';

  // The sixteen prefixes on disk as of 2026-09-06. The regex is the filter; this list is
  // only used to label and group, so a tool added later is collected without a code change
  // and simply lands under its own prefix with a null label.
  const KNOWN = {
    'pkaw:': 'align-watch',   'pkbj:': 'jack-watch',    'pkbw:': 'bar-watch',
    'pkcm:': 'comms-move',    'pkgw:': 'gov-watch',     'pkmw:': 'market-watch',
    'pkpw:': 'poll-watch',    'pkqj:': 'quick-jump',    'pkrw:': 'raid-watch',
    'pksl:': 'slot-watch',    'pksw:': 'shop-watch',    'pktw:': 'time-watch',
    'pkws:': 'ws-watch',      'pkww:': 'world-watch',   'pkxp:': 'xp-watch',
    'pkxx:': 'xp-watch (aux)',
  };

  // Anchored. A key has to START with pk<2-4 letters>: to be read at all.
  const PREFIX = /^(pk[a-z]{2,4}:)/;

  // Defence in depth. Nothing matching PREFIX can equal one of these, but the cost of
  // saying so is one line and the cost of being wrong is a token in a file.
  const NEVER = ['auth', 'device_signals'];

  // A key NAME that looks like it holds a secret, wherever it appears in a stored object.
  const SECRET_KEY = /token|auth|bearer|secret|password|passwd|cookie|jwt|signature|refresh|credential|device_signal|fingerprint|canvas|x-ct-/i;

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
      if (SECRET_KEY.test(k)) {
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

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
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

  return bundle;
})();
