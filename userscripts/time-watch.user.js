// ==UserScript==
// @name         Politiko — Time Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  Reads the game's own /api/time responses as they arrive and emits a PKT1 calibration code for Politiko Time Wire. Adds no requests, sends nothing, stores nothing.
// @author       dataterminals
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    `/api/time` responses that the game client requested on its own, observed
 *             by wrapping `fetch` and `XMLHttpRequest` in this tab. Also reads the `Date`
 *             response header of those same responses, to report how far your computer's
 *             clock sits from the server's.
 *   Shows:    a small panel in the corner of the page, in a shadow root of its own so it
 *             cannot inherit or disturb the game's styles.
 *   Sends:    nothing, to anyone. The calibration code is put on screen for you to copy;
 *             nothing transmits it.
 *   Requests: ZERO additional requests to politiko.io. This script never originates a
 *             call — it only looks at responses already in flight.
 *   Storage:  none. No localStorage, no sessionStorage, no cookies.
 *   Writes:   nothing to the game. No clicks, no form input, no game actions.
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 *
 * ---------------------------------------------------------------------------
 * STATUS: the field names in /api/time are NOT yet confirmed.
 *
 * `/api/time` is a known authenticated endpoint (docs/05-people-surface.md lists it), but
 * no capture of its body has been recorded in this repo, and probing it to find out would
 * breach hard rule 4. So this script does not assume a shape: it searches the response for
 * a game-clock value and an acceleration value across the plausible names, reports which
 * key it used, and prints the decoded game date big enough to check against the sidebar.
 *
 * If the panel says it could not read the response, it lists the keys it actually saw.
 * One run on a live session pins the shape down for good — at which point this can be
 * narrowed to the real field names and docs/06-time-surface.md can be written.
 * ---------------------------------------------------------------------------
 */

(() => {
  'use strict';

  const TAG = '[politiko-time-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  // ---------------------------------------------------------------------------
  // Calendar constants — mirrored from PolitikoTimeWire/src/clock.js, which in
  // turn mirrors the game client. Kept in sync by hand; they are game constants
  // and do not drift.
  // ---------------------------------------------------------------------------

  const GS_HOUR = 3600;
  const GS_DAY = 86_400;
  const GS_MONTH = 2_592_000; // 30 game days
  const GS_YEAR = 31_536_000; // 365 game days
  const DEFAULT_ACCEL = 52.14;

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* The built-in anchor from Time Wire, used only to sanity-check an extraction.
     It is good to ±2.4 minutes with a slow rate creep, so it can say "that is the
     wrong field" but never "that is the wrong second". */
  const BUILTIN = { iso: '2026-08-03T16:56:05Z', gs: 7 * GS_YEAR + 251 * GS_DAY, accel: DEFAULT_ACCEL };

  const toGameSeconds = ({ year, monthIdx, day, hour = 0, minute = 0, second = 0 }) =>
    (year - 1) * GS_YEAR + monthIdx * GS_MONTH + (day - 1) * GS_DAY
    + hour * GS_HOUR + minute * 60 + second;

  function fromGameSeconds(gs) {
    gs = Math.round(gs);
    const year = Math.floor(gs / GS_YEAR) + 1;
    const inYear = ((gs % GS_YEAR) + GS_YEAR) % GS_YEAR;
    const monthIdx = Math.min(Math.floor(inYear / GS_MONTH), 11);
    const inMonth = inYear - monthIdx * GS_MONTH;
    const day = Math.floor(inMonth / GS_DAY) + 1;
    const rem = inMonth % GS_DAY;
    return {
      year, monthIdx, day,
      hour: Math.floor(rem / GS_HOUR),
      minute: Math.floor((rem % GS_HOUR) / 60),
    };
  }

  const formatGame = (gs) => {
    const t = fromGameSeconds(gs);
    return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} `
      + `${MONTHS[t.monthIdx]} ${t.day}, Y${t.year}`;
  };

  /** The code Time Wire parses: PKT1|<real ISO>|<game seconds>|<accel>. */
  const makeCode = (atMs, gs, accel) =>
    `PKT1|${new Date(atMs).toISOString()}|${Math.round(gs)}|${accel}`;

  // ---------------------------------------------------------------------------
  // Reading the response
  //
  // Nothing here assumes a shape. Each candidate name is tried in turn and the
  // one that hits is reported, so a wrong guess is visible rather than silent.
  // ---------------------------------------------------------------------------

  const GS_KEYS = ['game_seconds', 'gameSeconds', 'game_time', 'gameTime', 'seconds',
    'elapsed', 'clock', 'time', 'now', 'current_time', 'currentTime'];
  const ACCEL_KEYS = ['acceleration', 'accel', 'rate', 'speed', 'multiplier', 'factor', 'scale'];
  const PARTS_KEYS = { year: ['year', 'y'], month: ['month', 'month_index', 'monthIdx', 'mon'], day: ['day', 'd'], hour: ['hour', 'h'], minute: ['minute', 'min', 'm'], second: ['second', 'sec', 's'] };

  /** Depth-first search for the first key in `names` holding a finite number. */
  function findNumber(obj, names, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    for (const name of names) {
      const v = obj[name];
      if (typeof v === 'number' && Number.isFinite(v)) return { value: v, key: name };
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return { value: Number(v), key: name };
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const hit = findNumber(v, names, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * An object carrying calendar parts, e.g. { year: 8, month: 9, day: 11, ... }.
   *
   * Whether `month` is 0- or 1-based cannot be decided from one sample: only a 0 proves
   * 0-based and only a 12 proves 1-based, and everything between is ambiguous. Rather
   * than guess, both readings are returned for the caller to arbitrate — the two are a
   * whole game month apart, which is ~13 h 49 m of real time, so the built-in estimate
   * separates them comfortably even at its ±2.4 minute accuracy.
   */
  function findParts(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    const pick = (names) => findNumber(obj, names, 0);
    const year = pick(PARTS_KEYS.year), month = pick(PARTS_KEYS.month), day = pick(PARTS_KEYS.day);
    if (!(year && month && day)) return null;

    const hour = pick(PARTS_KEYS.hour), minute = pick(PARTS_KEYS.minute), second = pick(PARTS_KEYS.second);
    const build = (monthIdx) => toGameSeconds({
      year: year.value, monthIdx: Math.min(Math.max(monthIdx, 0), 11), day: day.value,
      hour: hour?.value ?? 0, minute: minute?.value ?? 0, second: second?.value ?? 0,
    });

    const via = `calendar parts (${year.key}/${month.key}/${day.key})`;
    if (month.value <= 0) return { gs: build(0), via: `${via}, 0-based month` };
    if (month.value >= 12) return { gs: build(month.value - 1), via: `${via}, 1-based month` };
    return {
      via,
      candidates: [
        { gs: build(month.value), label: '0-based month' },
        { gs: build(month.value - 1), label: '1-based month' },
      ],
    };
  }

  /** "14:23 September 11, Y8" as the sidebar renders it. */
  function findFormatted(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const m = /(\d{1,2}):(\d{2})\s+([A-Za-z]+)\.?\s+(\d{1,2}),?\s*Y\s*(\d+)/.exec(v.trim());
        if (m) {
          const monthIdx = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m[3].toLowerCase()));
          if (monthIdx >= 0) {
            return {
              gs: toGameSeconds({ year: +m[5], monthIdx, day: +m[4], hour: +m[1], minute: +m[2] }),
              via: `formatted string (${k})`,
            };
          }
        }
      } else if (v && typeof v === 'object') {
        const hit = findFormatted(v, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  function extract(data, atMs) {
    const accelHit = findNumber(data, ACCEL_KEYS);
    const accel = accelHit && accelHit.value > 0 && accelHit.value <= 10_000 ? accelHit.value : null;

    /* Order matters. An explicit game-second count is the most direct reading;
       calendar parts and a rendered string both throw away sub-minute precision,
       so they are fallbacks rather than equals. */
    const direct = findNumber(data, GS_KEYS);
    let candidate = direct
      ? { gs: direct.value, via: `numeric field (${direct.key})` }
      : (findParts(data) || findFormatted(data));

    if (!candidate) return { ok: false, accel, accelKey: accelHit?.key ?? null };

    if (candidate.candidates) {
      /* Undecidable from the payload alone, so let the built-in estimate arbitrate:
         take whichever reading it sits closer to. */
      const [best] = candidate.candidates
        .map((c) => ({ ...c, off: Math.abs(driftFromBuiltin(c.gs, atMs, accel ?? DEFAULT_ACCEL)) }))
        .sort((a, b) => a.off - b.off);
      candidate = { gs: best.gs, via: `${candidate.via}, read as ${best.label}`, resolved: best.label };
    }
    return { ok: true, ...candidate, accel, accelKey: accelHit?.key ?? null };
  }

  /** How far the reading sits from the built-in estimate, in real seconds. */
  function driftFromBuiltin(gs, atMs, accel) {
    const epochMs = Date.parse(BUILTIN.iso) - (BUILTIN.gs * 1000) / BUILTIN.accel;
    const expectedGS = ((atMs - epochMs) * BUILTIN.accel) / 1000;
    return (gs - expectedGS) / (accel || BUILTIN.accel);
  }

  // ---------------------------------------------------------------------------
  // Passive taps.
  //
  // `fetch` is the verified path (see HANDOFF.md), but XHR is wrapped too so the
  // script still works if this particular call does not go through fetch. Both
  // only observe; neither issues anything.
  // ---------------------------------------------------------------------------

  const isTimeUrl = (url) => /\/api\/time(\?|$|\/)/.test(String(url || ''));
  const listeners = new Set();
  const emit = (info) => listeners.forEach((fn) => { try { fn(info); } catch (e) { log('listener error', e); } });

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      if (isTimeUrl(url) && res.ok) {
        const at = Date.now();
        const serverDate = Date.parse(res.headers.get('date') || '');
        // clone so the game's own consumer still receives an unread body
        res.clone().json().then((data) => emit({ data, at, serverDate }), () => {});
      }
    } catch (e) { log('fetch tap error', e); }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__pkUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (isTimeUrl(this.__pkUrl)) {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          const at = Date.now();
          const serverDate = Date.parse(this.getResponseHeader('date') || '');
          const data = typeof this.response === 'string' ? JSON.parse(this.response) : this.response;
          emit({ data, at, serverDate });
        } catch (e) { log('xhr tap error', e); }
      });
    }
    return origSend.apply(this, args);
  };

  // ---------------------------------------------------------------------------
  // Panel. Lives in a shadow root so the game's stylesheet cannot reach it and
  // it cannot reach the game's. No generated class names are referenced —
  // chunk hashes and CSS classes change every deploy.
  // ---------------------------------------------------------------------------

  const UI = {
    css: `
      :host { all: initial; }
      .wrap { position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: #e8e2da; background: #17120e; border: 1px solid #4a3428;
        border-radius: 8px; padding: 10px 12px; max-width: 340px;
        box-shadow: 0 6px 24px rgba(0,0,0,.5); }
      .hd { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
      .ttl { font-weight: 600; color: #d8794c; letter-spacing: .02em; flex: 1; }
      .x { cursor: pointer; color: #8d7f74; padding: 0 3px; }
      .x:hover { color: #e8e2da; }
      .gt { font-size: 15px; color: #fff; margin: 2px 0 6px; }
      .code { display: block; width: 100%; box-sizing: border-box; background: #0d0a08;
        border: 1px solid #3a2a20; border-radius: 5px; color: #c8b3a3;
        padding: 6px 7px; font: inherit; word-break: break-all; resize: none; }
      .row { display: flex; gap: 6px; margin-top: 7px; align-items: center; }
      button { font: inherit; cursor: pointer; background: #2a1c14; color: #e8e2da;
        border: 1px solid #4a3428; border-radius: 5px; padding: 4px 10px; }
      button:hover { background: #3a2a20; }
      .note { color: #8d7f74; margin-top: 6px; }
      .warn { color: #e0a458; }
      .err { color: #e07a5f; }
      pre { white-space: pre-wrap; word-break: break-all; margin: 5px 0 0;
        color: #8d7f74; max-height: 130px; overflow: auto; }
    `,
    host: null, root: null,
  };

  function mount() {
    if (UI.host) return;
    UI.host = document.createElement('div');
    UI.host.setAttribute('data-politiko-time-watch', '');
    UI.root = UI.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = UI.css;
    UI.root.append(style, document.createElement('div'));
    document.body.append(UI.host);
    render({ state: 'waiting' });
  }

  function render(view) {
    if (!UI.root) return;
    const box = UI.root.querySelector('div');
    box.className = 'wrap';
    box.replaceChildren();

    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };

    const hd = el('div', 'hd');
    hd.append(el('span', 'ttl', 'Time Watch'));
    const close = el('span', 'x', '×');
    close.title = 'Hide until reload';
    close.addEventListener('click', () => UI.host.remove());
    hd.append(close);
    box.append(hd);

    if (view.state === 'waiting') {
      box.append(el('div', 'note', 'Watching for the game to fetch /api/time. It should '
        + 'arrive on its own — move around the game as usual.'));
      return;
    }

    if (view.state === 'unreadable') {
      box.append(el('div', 'err', 'Saw /api/time but could not find a clock value in it.'));
      box.append(el('div', 'note', 'Field names are unconfirmed. These are the keys it '
        + 'returned — pass them on and the script can be pinned to the real shape:'));
      box.append(el('pre', null, view.keys));
      return;
    }

    box.append(el('div', 'gt', view.game));
    box.append(el('div', 'note', 'Check that against the game’s sidebar clock. If it '
      + 'does not match, the wrong field was read — do not use this code.'));

    const code = el('textarea', 'code');
    code.readOnly = true;
    code.rows = 3;
    code.value = view.code;
    code.addEventListener('focus', () => code.select());
    box.append(code);

    const row = el('div', 'row');
    const copy = el('button', null, 'Copy code');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(view.code);
        copy.textContent = 'Copied';
      } catch {
        code.select();
        copy.textContent = 'Press Ctrl+C';
      }
      setTimeout(() => { copy.textContent = 'Copy code'; }, 1600);
    });
    row.append(copy);
    box.append(row);

    box.append(el('div', 'note', `read from ${view.via}${view.accelNote}`));
    for (const w of view.warnings) box.append(el('div', 'warn', w));
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  listeners.add(({ data, at, serverDate }) => {
    const got = extract(data, at);

    if (!got.ok) {
      log('unreadable /api/time payload', data);
      let keys;
      try { keys = JSON.stringify(data, null, 1).slice(0, 1200); } catch { keys = String(data); }
      render({ state: 'unreadable', keys });
      return;
    }

    const accel = got.accel ?? DEFAULT_ACCEL;
    const warnings = [];

    if (got.accel == null) {
      warnings.push(`No acceleration field found — assuming ${DEFAULT_ACCEL}.`);
    }
    if (got.resolved) {
      warnings.push(`The month field is ambiguous; it was read as ${got.resolved} because that `
        + 'matches the built-in estimate. If the date above is a month out, that is why.');
    }

    /* A wrong field usually lands years away, not minutes. This cannot confirm a
       reading — the built-in is only good to a couple of minutes — but it does
       catch reading a unix timestamp or a row id by mistake. */
    const drift = driftFromBuiltin(got.gs, at, accel);
    if (Math.abs(drift) > 3 * 60 * 60) {
      warnings.push(`This is ${(drift / 3600).toFixed(1)} h of real time from the built-in `
        + 'estimate — large enough that it is probably the wrong field.');
    }

    if (Number.isFinite(serverDate)) {
      const skew = (serverDate - at) / 1000;
      /* The Date header has whole-second granularity, so anything under ~2 s is
         indistinguishable from rounding plus latency and not worth reporting. */
      if (Math.abs(skew) >= 2) {
        warnings.push(`Your computer's clock is ${Math.abs(skew).toFixed(0)} s `
          + `${skew > 0 ? 'behind' : 'ahead of'} the server's. The code is stamped with `
          + 'your clock, so fix the skew before relying on it.');
      }
    }

    render({
      state: 'ok',
      game: formatGame(got.gs),
      code: makeCode(at, got.gs, accel),
      via: got.via,
      accelNote: got.accelKey ? `, rate from ${got.accelKey} = ${accel}` : `, rate assumed ${accel}`,
      warnings,
    });
  });

  const boot = () => { mount(); log('ready — watching /api/time'); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
