// ==UserScript==
// @name         Politiko — Time Bridge
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  Carries the game-clock anchor Time Watch already captured over to the Politiko Time Wire planner, so the planner calibrates itself instead of waiting for you to copy a code. Moves one string between two pages on your own machine; touches the network not at all.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-bridge.user.js
// @match        https://politiko.io/*
// @match        https://dataterminals.github.io/PolitikoTimeWire/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    on politiko.io — one localStorage key, `pktw:samples`, which the Time
 *             Watch userscript wrote there from /api/time responses the game itself
 *             requested. This script does not read the page, the DOM, the network, or
 *             any other key. It never touches `auth`.
 *   Requests: ZERO, to anyone. There is no fetch, no XHR, and no beacon in this file.
 *             It moves one string between two pages on your own machine.
 *   Sends:    nothing, anywhere. The only transport is Tampermonkey's own script
 *             storage, which never leaves the browser.
 *   Storage:  GM storage key `pkt1` — the latest calibration code, and when it was
 *             taken. On the Time Wire page, localStorage `ptw:handoff` — the same
 *             string, in the slot that page reads.
 *   Alerts:   none.
 *
 * Why this exists: the two pages are different origins, so Time Watch cannot write to
 * Time Wire's storage and Time Wire cannot read Politiko's. A userscript that runs on
 * both is the only thing that can see across, short of a server — and a server is the
 * one thing this project is not adding for a string that describes a clock.
 *
 * Note the grants. Time Watch runs at `@grant none` because its whole job is patching
 * the page's own `fetch`, and any grant would sandbox `window` and break the tap. This
 * script patches nothing and taps nothing, so it can take the grants it needs for
 * cross-origin storage without that cost. Keep them separate for exactly that reason.
 */

(() => {
  'use strict';

  const TAG = '[pk-time-bridge]';
  const log = (...a) => console.debug(TAG, ...a);

  const SLOT = 'pkt1';                 // GM storage, shared across both origins
  const SAMPLES = 'pktw:samples';      // Time Watch's own key, on politiko.io
  const HANDOFF = 'ptw:handoff';       // the slot Time Wire reads, on its own origin

  const FALLBACK_ACCEL = 52.14;        // matches Time Watch; the server sends the real one

  const onTimeWire = location.hostname === 'dataterminals.github.io';

  // ---------------------------------------------------------------------------
  // politiko.io — publish the newest anchor Time Watch has recorded
  // ---------------------------------------------------------------------------

  /** Newest {t, gs, accel} sample Time Watch has stored, or null. */
  const newestSample = () => {
    let store;
    try { store = JSON.parse(localStorage.getItem(SAMPLES) || 'null'); }
    catch { return null; }
    if (!store) return null;
    const s = (Array.isArray(store.recent) && store.recent.length)
      ? store.recent[store.recent.length - 1]
      : store.first;
    if (!s || !Number.isFinite(s.t) || !Number.isFinite(s.gs)) return null;
    return s;
  };

  const codeOf = (s) => `PKT1|${new Date(s.t).toISOString()}|${s.gs}|${s.accel || FALLBACK_ACCEL}`;

  function publish() {
    const s = newestSample();
    if (!s) return;
    let held = null;
    try { held = GM_getValue(SLOT, null); } catch { /* first run */ }
    // only ever move forward — an older sample must not overwrite a newer one
    if (held && Number.isFinite(held.t) && held.t >= s.t) return;
    try {
      GM_setValue(SLOT, { t: s.t, code: codeOf(s) });
      log('published anchor from', new Date(s.t).toISOString());
    } catch (e) { log('publish failed', e); }
  }

  // ---------------------------------------------------------------------------
  // Time Wire — drop it in the slot the planner reads
  // ---------------------------------------------------------------------------

  function deliver() {
    let held = null;
    try { held = GM_getValue(SLOT, null); } catch { return; }
    if (!held || typeof held.code !== 'string') return;
    try {
      // Written at document-start, so it is already sitting there when the planner
      // boots. Same string twice is a no-op on that side — it ignores any anchor
      // that is not newer than the one it already holds.
      if (localStorage.getItem(HANDOFF) === held.code) return;
      localStorage.setItem(HANDOFF, held.code);
      log('handed over anchor from', new Date(held.t).toISOString());
    } catch (e) { log('handover failed', e); }
  }

  // ---------------------------------------------------------------------------
  // Boot
  //
  // On politiko.io, Time Watch keeps recording while you play, so re-publish on a
  // slow timer and when you leave the tab — that last one is what makes the anchor
  // fresh at the moment you switch over to the planner.
  // ---------------------------------------------------------------------------

  if (onTimeWire) {
    deliver();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) deliver(); });
  } else {
    publish();
    setInterval(publish, 60_000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) publish(); });
    window.addEventListener('pagehide', publish);
  }

  log('ready —', onTimeWire ? 'delivering to Time Wire' : 'publishing from Politiko');
})();
