// ==UserScript==
// @name         Politiko — <TOOL NAME>
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  <one line — state plainly what it reads and what it shows; clause 6 requires full disclosure>
// @author       dataterminals
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    <what, from where — DOM of the page you are viewing / responses the app
 *             already requested / the client's own query cache>
 *   Sends:    nothing, to anyone
 *   Requests: ZERO additional requests to politiko.io
 *   Storage:  <localStorage keys, or "none">
 *
 * Design rule for this repo: consume, don't request. This script must never originate
 * a network call to Politiko, never touch a page you aren't actively viewing, and never
 * raise an alert from an unfocused tab. See docs/01-rules-envelope.md.
 */

(() => {
  'use strict';

  const TAG = '[politiko-tool]';
  const log = (...a) => console.debug(TAG, ...a);

  // ---------------------------------------------------------------------------
  // 1. Passive tap — observe responses the app requested on its own.
  //    This ADDS NO REQUESTS. It only reads what was already in flight.
  // ---------------------------------------------------------------------------
  const listeners = new Set();
  /** @param {(info: {url: string, status: number, data: any}) => void} fn */
  const onApiResponse = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      if (url.includes('/api/') && res.headers.get('content-type')?.includes('json')) {
        // clone so the app's own consumer still gets an unread body
        res.clone().json().then(
          (data) => listeners.forEach((fn) => { try { fn({ url, status: res.status, data }); } catch (e) { log('listener error', e); } }),
          () => {},
        );
      }
    } catch (e) { log('tap error', e); }
    return res;
  };

  // ---------------------------------------------------------------------------
  // 2. SPA lifecycle — React Router means no page loads. Re-mount on route change
  //    and always clean up after yourself.
  // ---------------------------------------------------------------------------
  let lastPath = null;
  let teardown = () => {};

  const onRoute = (path) => {
    log('route', path);
    teardown();
    teardown = () => {};

    // if (path.startsWith('/market')) teardown = mountMarketOverlay();
  };

  const checkRoute = () => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      onRoute(lastPath);
    }
  };

  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) { const r = orig.apply(this, a); queueMicrotask(checkRoute); return r; };
  }
  window.addEventListener('popstate', checkRoute);

  // ---------------------------------------------------------------------------
  // 3. Boot
  // ---------------------------------------------------------------------------
  const boot = () => {
    log('ready');
    checkRoute();
    onApiResponse(({ url, data }) => log('api', url, data));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
</content>
