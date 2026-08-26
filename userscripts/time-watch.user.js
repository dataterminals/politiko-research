// ==UserScript==
// @name         Politiko — Time Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.6.0
// @description  Passive game-clock calibrator: reads the /api/time responses the app already polls, shows the real↔game time mapping, month schedule, and next-September countdown in your local timezone. Zero added requests.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/time-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON responses to GET /api/time that the game client itself requests
 *             (the sidebar polls it every ~60s). Nothing else is read off the wire.
 *   Sends:    nothing, to anyone
 *   Requests: ZERO additional requests to politiko.io
 *   Storage:  localStorage keys prefixed `pktw:` — captured time samples
 *             ({realMs, gameSeconds, acceleration}) and panel UI state
 *   Alerts:   none. No notifications, no sound, no attention-raising from
 *             unfocused tabs. The panel only redraws while the tab is visible.
 *   Clipboard: written ONLY when you click the "copy" button next to the
 *             calibration code (a PKT1|… string for the shared planner page).
 *
 * Design rule for this repo: consume, don't request. This script must never originate
 * a network call to Politiko, never touch a page you aren't actively viewing, and never
 * raise an alert from an unfocused tab. See docs/01-rules-envelope.md.
 *
 * What it computes (all client-side arithmetic on data the app already fetched):
 *   - the game calendar: 365-day years; Jan–Nov are 30 game days, December is 35
 *   - acceleration: game-seconds per real second, as sent by the server (fallback 52.14),
 *     plus an independent measured value from this script's own sample baseline
 *   - phase: the real-UTC instant of any game date, hence local wall-clock times for
 *     month boundaries (e.g. when September starts for you)
 */

(() => {
  'use strict';

  const TAG = '[pk-time-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = {
    samples: 'pktw:samples',
    ui: 'pktw:ui',
  };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const MON = MONTHS.map((m) => m.slice(0, 3));

  // Game-calendar constants, mirrored from the client's own clock code
  // (entry chunk: parse = Y*31536e3 + month*2592e3 + (D-1)*86400 + H*3600 + M*60;
  //  render caps month at index 11, so December runs 35 days).
  const GS_YEAR = 31_536_000;   // 365 game days
  const GS_MONTH = 2_592_000;   // 30 game days
  const GS_DAY = 86_400;
  const FALLBACK_ACCEL = 52.14; // client fallback; server sends the live value

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // ---------------------------------------------------------------------------
  // Game-time math
  // ---------------------------------------------------------------------------

  /** "14:23 September 11, Y8" -> game-seconds since 00:00 Jan 1 Y1 (or null). */
  const parseGameDatetime = (s) => {
    const m = /(\d+):(\d+)\s+(\w+)\s+(\d+),?\s+Y(\d+)/.exec(String(s));
    if (!m) return null;
    const mi = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m[3].toLowerCase()));
    return (+m[5] - 1) * GS_YEAR + Math.max(0, mi) * GS_MONTH
      + (+m[4] - 1) * GS_DAY + (+m[1]) * 3600 + (+m[2]) * 60;
  };

  /** game-seconds -> {year, monthIdx, day, hh, mm, label} (December absorbs days 31–35). */
  const fromGameSeconds = (gs) => {
    gs = Math.round(gs); // game-second granularity; guards float epsilon under floor()
    const year = Math.floor(gs / GS_YEAR) + 1;
    const inYear = ((gs % GS_YEAR) + GS_YEAR) % GS_YEAR;
    const monthIdx = Math.min(Math.floor(inYear / GS_MONTH), 11);
    const inMonth = inYear - monthIdx * GS_MONTH;
    const day = Math.floor(inMonth / GS_DAY) + 1;
    const rem = inMonth % GS_DAY;
    const hh = Math.floor(rem / 3600), mm = Math.floor((rem % 3600) / 60);
    return {
      year, monthIdx, day, hh, mm,
      label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${MON[monthIdx]} ${day}, Y${year}`,
    };
  };

  /** game-seconds of 00:00 <month> 1, Y<year> */
  const monthStartGS = (year, monthIdx) => (year - 1) * GS_YEAR + monthIdx * GS_MONTH;

  // ---------------------------------------------------------------------------
  // Sample store — one entry per captured /api/time response
  // ---------------------------------------------------------------------------
  const store = Object.assign({ first: null, recent: [] }, readJSON(K.samples, {}));
  const ui = Object.assign({ open: true, x: null, y: null }, readJSON(K.ui, {}));

  const latest = () => store.recent[store.recent.length - 1] ?? store.first;

  const addSample = (s) => {
    const last = latest();
    // the datetime string has 1-game-minute resolution (~1.15s real); don't hoard duplicates
    if (last && s.gs === last.gs) return;
    if (!store.first) store.first = s;
    store.recent.push(s);
    if (store.recent.length > 120) store.recent.splice(0, store.recent.length - 120);
    writeJSON(K.samples, store);
    log('sample', s, 'epochUTC', new Date(epochRealMs(s)).toISOString());
  };

  /** real-ms instant of game zero (00:00 Jan 1 Y1) implied by one sample */
  const epochRealMs = (s) => s.t - (s.gs * 1000) / (s.accel || FALLBACK_ACCEL);

  /** acceleration measured across our own baseline (needs a few hours to mean much) */
  const measuredAccel = () => {
    const a = store.first, b = latest();
    if (!a || !b || b.t - a.t < 30 * 60_000) return null;
    return { value: (b.gs - a.gs) * 1000 / (b.t - a.t), baselineMs: b.t - a.t };
  };

  /** current game-seconds, freewheeling from the newest sample like the app does */
  const nowGS = () => {
    const s = latest();
    if (!s) return null;
    return s.gs + ((Date.now() - s.t) / 1000) * (s.accel || FALLBACK_ACCEL);
  };

  /** real Date when game-seconds gs will occur, per the newest sample's anchor */
  const realDateOfGS = (gs) => {
    const s = latest();
    if (!s) return null;
    return new Date(s.t + ((gs - s.gs) * 1000) / (s.accel || FALLBACK_ACCEL));
  };

  // ---------------------------------------------------------------------------
  // Passive tap — only /api/time responses the app fetched on its own
  // ---------------------------------------------------------------------------
  const isTimeURL = (u) => /\/api\/time(?:\?|$)/.test(String(u));

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      if (isTimeURL(url) && res.headers.get('content-type')?.includes('json')) {
        res.clone().json().then((data) => {
          const gs = parseGameDatetime(data?.datetime);
          if (gs == null) { log('unparsed datetime', data); return; }
          addSample({ t: Date.now(), gs, accel: Number(data?.acceleration) || FALLBACK_ACCEL });
          scheduleRender();
        }, () => {});
      }
    } catch (e) { log('tap error', e); }
    return res;
  };

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------
  let root = null, panel = null, head = null, body = null, fab = null;
  let drag = null, fabDrag = null, resize = null;

  const CSS = `
    /* FAB KIT v1 — shared verbatim block.
       Same rule as PANEL KIT: copy it in as it stands, and if it has to change,
       bump the version here and in every tool carrying a copy, so the copies can
       be diffed. Several of these tools are on screen at once, and buttons that
       each picked their own shape read as several unrelated add-ons rather than
       one set of tools. A 15px glyph is also a coin toss across fonts and
       platforms, and four of them tell you nothing about which is which. So the
       box is fixed here and only the word inside it belongs to the tool: three
       or four letters, upper case, no emoji.

       What this block deliberately leaves to the tool, because it IS the tool's:
         - which corner the button starts in: position / inset / z-index
         - state colour and badges layered on top (.hot, .live, .pkws-done)
       The tool's own rule goes AFTER this block: same specificity, later wins.

       Tools that also do their own placement maths keep CFG.FAB_SIZE in step
       with the 38px below; tools/test-placement.js fails the build if one drifts.

       people-watch is the one exception to the word. It wears the eye of
       providence, which is its mark and predates this block; the svg rule sizes
       that inside the same square as everyone else's letters. */
    .pk-fab {
      box-sizing: border-box; width: 38px; height: 38px; padding: 0;
      display: grid; place-items: center;
      background: #18181b; color: #e4e4e7;
      border: 1px solid #3f3f46; border-radius: 3px;
      font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: .08em; text-align: center;
      cursor: pointer; user-select: none; touch-action: none;
    }
    .pk-fab:hover { border-color: #71717a; color: #fafafa; }
    .pk-fab.dragging { cursor: grabbing; border-color: #52525b; }
    .pk-fab svg { width: 24px; height: 24px; display: block; }
    /* Default corner deliberately avoids bottom-right: the game's own Comms dock is
       fixed there (right: 20px, bottom: 0, 320×420), so anything parked in that corner
       lands on top of it. Bottom-left is align-watch's. That leaves the top-left, and
       the panel is anchored from the top rather than the bottom because it is ~500px
       tall — bottom-anchoring a panel that size pushes its head off a 720px screen.
       Drag it anywhere you like; it remembers. */
    .pktw-fab { position: fixed; left: 12px; top: 12px; z-index: 2147482000; }
    .pktw-panel { position: fixed; left: 12px; top: 52px; z-index: 2147482000;
      width: min(340px, calc(100vw - 24px)); max-height: 70vh;
      display: flex; flex-direction: column; border: 1px solid #3f3f46;
      border-radius: 8px; background: #09090bf2; color: #e4e4e7;
      font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .pktw-head { display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 7px 12px; border-bottom: 1px solid #27272a; user-select: none;
      font-size: 11px; color: #a1a1aa; text-transform: uppercase; letter-spacing: .08em; }
    .pktw-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 12px; }
    .pktw-panel h1 { font-size: 12px; margin: 0 0 6px; color: #a1a1aa;
      text-transform: uppercase; letter-spacing: .08em; }
    .pktw-big { font-size: 15px; font-weight: 600; margin: 2px 0 8px; }
    .pktw-row { display: flex; justify-content: space-between; gap: 8px; }
    .pktw-dim { color: #a1a1aa; }
    .pktw-hl { color: #fbbf24; }
    .pktw-ok { color: #34d399; }
    .pktw-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .pktw-table td { padding: 1px 4px 1px 0; white-space: nowrap; }
    .pktw-table tr.pktw-now td { color: #fbbf24; }
    .pktw-note { margin-top: 8px; color: #71717a; font-size: 11px; }
  `;

  const fmtLocal = (d, opts) => d.toLocaleString(undefined, Object.assign(
    { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, opts));

  const fmtDur = (ms) => {
    let s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    return (d ? `${d}d ` : '') + `${h}h ${String(m).padStart(2, '0')}m`;
  };

  const render = () => {
    if (!body || document.hidden) return;
    const s = latest();
    body.textContent = '';
    if (!s) {
      body.append(Object.assign(document.createElement('p'), {
        textContent: 'Waiting for the app to fetch /api/time (it polls every ~60s while logged in)…',
      }));
      return;
    }

    const gs = nowGS();
    const now = fromGameSeconds(gs);
    const big = document.createElement('div');
    big.className = 'pktw-big';
    big.textContent = now.label;
    body.append(big);

    const realnow = document.createElement('div');
    realnow.className = 'pktw-dim';
    realnow.style.marginBottom = '6px';
    realnow.textContent = '= ' + fmtLocal(new Date()) + ' your time';
    body.append(realnow);

    const meta = document.createElement('div');
    const ma = measuredAccel();
    const dayReal = GS_DAY / (s.accel || FALLBACK_ACCEL);
    meta.innerHTML =
      `<div class="pktw-row"><span class="pktw-dim">acceleration (server)</span><span>${(s.accel || FALLBACK_ACCEL).toFixed(4)}×</span></div>` +
      `<div class="pktw-row"><span class="pktw-dim">acceleration (measured)</span><span>${ma ? ma.value.toFixed(4) + '× over ' + fmtDur(ma.baselineMs) : 'need ≥30m of samples'}</span></div>` +
      `<div class="pktw-row"><span class="pktw-dim">1 game day</span><span>${Math.floor(dayReal / 60)}m ${(dayReal % 60).toFixed(1)}s real</span></div>` +
      `<div class="pktw-row"><span class="pktw-dim">1 game month / year</span><span>${fmtDur(GS_MONTH / s.accel * 1000)} / ${fmtDur(GS_YEAR / s.accel * 1000)}</span></div>` +
      `<div class="pktw-row"><span class="pktw-dim">samples held</span><span>${store.recent.length + (store.first ? 1 : 0)}</span></div>`;
    body.append(meta);

    // Calibration code — paste into the shared planner page to anchor it exactly.
    // Format: PKT1|<real ISO instant>|<game-seconds at that instant>|<acceleration>
    const codeRow = document.createElement('div');
    codeRow.className = 'pktw-row';
    codeRow.style.marginTop = '6px';
    const code = `PKT1|${new Date(s.t).toISOString()}|${s.gs}|${s.accel || FALLBACK_ACCEL}`;
    const codeEl = document.createElement('span');
    codeEl.className = 'pktw-dim';
    codeEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;';
    codeEl.title = code;
    codeEl.textContent = code;
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'copy';
    copyBtn.style.cssText = 'background:#27272a;color:#e4e4e7;border:1px solid #3f3f46;'
      + 'border-radius:4px;font:inherit;padding:0 8px;cursor:pointer;';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(code).then(
        () => { copyBtn.textContent = 'copied'; setTimeout(() => { copyBtn.textContent = 'copy'; }, 1500); },
        () => { copyBtn.textContent = 'failed'; },
      );
    });
    codeRow.append(codeEl, copyBtn);
    body.append(codeRow);

    // Next September (registration month) countdown
    let sepGS = monthStartGS(now.year, 8);
    const inSeptember = now.monthIdx === 8;
    if (!inSeptember && gs >= sepGS) sepGS = monthStartGS(now.year + 1, 8);
    const sepStart = realDateOfGS(sepGS);
    const sepEnd = realDateOfGS(sepGS + 30 * GS_DAY);
    const sep = document.createElement('div');
    sep.style.marginTop = '8px';
    sep.innerHTML = inSeptember
      ? `<span class="pktw-ok">September is NOW.</span> It ends ${fmtLocal(sepEnd)} (${fmtDur(realDateOfGS(monthStartGS(now.year, 9)) - Date.now())} left).`
      : `<span class="pktw-hl">Next September:</span> ${fmtLocal(sepStart)} → ${fmtLocal(sepEnd, { weekday: undefined, month: undefined, day: undefined })} local (in ${fmtDur(sepStart - Date.now())}).`;
    body.append(sep);

    // Month schedule for the current game year, local wall-clock
    const h = document.createElement('h1');
    h.style.marginTop = '10px';
    h.textContent = `Year ${now.year} months — your local time`;
    body.append(h);
    const table = document.createElement('table');
    table.className = 'pktw-table';
    for (let mi = 0; mi < 12; mi++) {
      const start = realDateOfGS(monthStartGS(now.year, mi));
      const tr = document.createElement('tr');
      if (mi === now.monthIdx) tr.className = 'pktw-now';
      tr.innerHTML = `<td>${MON[mi]}</td><td>${fmtLocal(start)}</td>` +
        `<td class="pktw-dim">${mi === 11 ? '35 game days' : '30 game days'}</td>`;
      table.append(tr);
    }
    body.append(table);

    const note = document.createElement('p');
    note.className = 'pktw-note';
    note.textContent = 'All figures derive from /api/time responses the app itself fetched. '
      + 'This panel adds zero requests and never alerts from background tabs.';
    body.append(note);
  };

  let renderTimer = null;
  /**
   * render() decides the panel's height, so nothing may draw without re-checking that
   * the header is still on screen afterwards. The panel starts small and grows once
   * the first /api/time sample lands — bottom-anchored, that growth pushes its head
   * straight off the top of the viewport, and the drag handle with it.
   */
  const draw = () => { render(); drag?.fit(); };
  const scheduleRender = () => { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; draw(); }, 50); };

  // ===========================================================================
  // PANEL KIT v2 — shared verbatim block, see userscripts/_template.user.js.
  // Every panel this repo ships is draggable and resizable, and remembers both.
  // ===========================================================================
  const draggable = (node, handle, onMove) => {
    const EDGE = 44; // px of the element that must stay reachable on screen
    let sx = 0, sy = 0, ox = 0, oy = 0, live = false, moved = false;
    let skew = null; // gap between the border box and what left/top actually set

    const place = (x, y) => {
      const w = node.offsetWidth, h = node.offsetHeight;
      const p = w && h ? {
        x: Math.min(Math.max(x, EDGE - w), window.innerWidth - EDGE),
        y: Math.min(Math.max(y, 0), window.innerHeight - Math.min(EDGE, h)),
      } : { x, y }; // hidden element: no geometry to clamp against, fix it on show
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
      // `left` positions the MARGIN edge, but every measurement here is the
      // border box. If the host page styles our element with a margin, each grab
      // drifts by that much and compounds. Measure the gap once, then cancel it.
      if (skew === null && w && h) {
        const seen = node.getBoundingClientRect();
        skew = { x: seen.left - p.x, y: seen.top - p.y };
      }
      if (skew && (skew.x || skew.y)) {
        node.style.left = `${p.x - skew.x}px`;
        node.style.top = `${p.y - skew.y}px`;
      }
      return p;
    };

    const down = (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      // a control inside the handle keeps its click; the handle itself still drags
      if (ev.target !== handle && ev.target.closest?.('button,input,select,textarea,a,[data-nodrag]')) return;
      const r = node.getBoundingClientRect();
      place(r.left, r.top); // convert whatever CSS anchoring it had into left/top
      sx = ev.clientX; sy = ev.clientY; ox = r.left; oy = r.top;
      live = true; moved = false;
      try { handle.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
      ev.preventDefault();
    };

    const move = (ev) => {
      if (!live) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return; // tremor isn't a drag
      moved = true;
      place(ox + dx, oy + dy);
    };

    const up = (ev) => {
      if (!live) return;
      live = false;
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
      if (!moved) return;
      const r = node.getBoundingClientRect();
      onMove({ x: r.left, y: r.top });
    };

    handle.style.touchAction = 'none'; // don't scroll the game while dragging
    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);

    // Never strand the panel: a short window, a rotation, or a panel that grew
    // taller than the space its CSS corner left it can all put the drag handle
    // off-screen, and then there is no way to get it back.
    const fit = () => {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const x = Math.min(Math.max(r.left, EDGE - r.width), window.innerWidth - EDGE);
      const y = Math.min(Math.max(r.top, 0), window.innerHeight - Math.min(EDGE, r.height));
      if (Math.abs(x - r.left) < 0.5 && Math.abs(y - r.top) < 0.5) return false;
      onMove(place(x, y));
      return true;
    };
    window.addEventListener('resize', fit);

    return {
      apply: (pos) => {
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
        place(pos.x, pos.y);
        return true;
      },
      reset: () => {
        node.style.left = node.style.top = node.style.right = node.style.bottom = '';
        onMove(null);
      },
      dragged: () => moved,
      fit, // call after mounting and after any render that changes the size

      // Convert whatever CSS corner the element is anchored to into explicit
      // left/top, without moving it. The browser's own resize grabber only grows a
      // box right and down, so a panel still hanging off `right`/`bottom` grows
      // away from the pointer; resizable() pins it the moment the grab starts.
      pin: () => {
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) return false; // hidden: nothing to measure
        place(r.left, r.top);
        return true;
      },
    };
  };

  // ---------------------------------------------------------------------------
  //    resizable(node, onSize, opts) -> { apply(size), reset(), sized() }
  //      node    the element that resizes (the same one draggable() moves)
  //      onSize  called with {w, h} as CSS lengths, or null when reset
  //      opts    { minW, minH, drag } — pass the draggable() for this same node so
  //              a resize can re-pin and re-clamp it
  //
  //    The browser's own grabber does the dragging. There is deliberately no second
  //    drag implementation here to keep in step with the one above: all this block
  //    does is arm the grabber, keep it pointing the right way, and remember the
  //    result. The grabber writes inline width/height, so inline values that differ
  //    from what we last wrote can only have come from the user — content re-renders
  //    never write them, which is what keeps auto-sizing intact until the first
  //    deliberate resize.
  // ---------------------------------------------------------------------------
  const resizable = (node, onSize, opts = {}) => {
    const GRAB = 18;                  // the corner the UA's grabber occupies
    const drag = opts.drag || null;
    let mine = null;                  // the last size WE wrote

    // A viewport this small is a hidden tab or a minimised window rather than a
    // real layout — the same trap the placement layers guard against. Capping
    // against it would shrink the panel to nothing and the next report would make
    // that permanent, so treat it as no information.
    const usable = () => window.innerWidth > 120 && window.innerHeight > 120;

    const floor = () => ({
      w: Math.min(opts.minW || 220, Math.max(80, window.innerWidth - 16)),
      h: Math.min(opts.minH || 140, Math.max(80, window.innerHeight - 16)),
    });

    // Cap growth at the viewport rather than at whatever vh the panel's own CSS
    // picked: a `max-height: 74vh` silently fights a chosen height, so the panel
    // stops growing while the pointer keeps going and then jumps on the way back.
    // Only ever applied once a size has actually been chosen, so an untouched
    // panel keeps its stylesheet's sizing exactly as written.
    const cap = () => {
      if (!usable()) return;
      const f = floor();
      node.style.minWidth = `${f.w}px`;
      node.style.minHeight = `${f.h}px`;
      node.style.maxWidth = `${Math.max(f.w, window.innerWidth - 16)}px`;
      node.style.maxHeight = `${Math.max(f.h, window.innerHeight - 16)}px`;
    };

    node.style.resize = 'both';
    node.style.overflow = 'hidden'; // `resize` is inert while overflow is visible

    const report = () => {
      const w = node.style.width, h = node.style.height;
      if (!w && !h) return;                             // never resized: still auto
      if (mine && mine.w === w && mine.h === h) return; // our own restore, not a gesture
      mine = { w, h };
      onSize(mine);
      if (drag) drag.fit(); // a taller panel can push its own handle off-screen
    };

    // Capture phase: the panel's own handlers must not be able to swallow the grab.
    // Nothing is preventDefault()ed — the UA still runs the resize itself.
    node.addEventListener('pointerdown', (ev) => {
      const r = node.getBoundingClientRect();
      if (ev.clientX < r.right - GRAB || ev.clientY < r.bottom - GRAB) return;
      cap();
      if (drag) drag.pin();
    }, true);

    // Two ways in, because neither alone is sufficient. ResizeObserver is the
    // precise one but it is delivered on the rendering lifecycle, so a page that is
    // not compositing never gets the callback. pointerup is the backstop: the
    // grabber is a pointer gesture, so releasing it always lands here. report() is
    // idempotent, so both firing costs nothing.
    if (typeof ResizeObserver === 'function') new ResizeObserver(report).observe(node);
    node.addEventListener('pointerup', report);
    window.addEventListener('resize', () => { if (mine) cap(); });

    return {
      apply: (size) => {
        if (!size || !size.w || !size.h) return false;
        mine = { w: String(size.w), h: String(size.h) };
        node.style.width = mine.w;
        node.style.height = mine.h;
        cap();
        if (drag) drag.pin(); // a restored size wants the same anchoring a grab does
        return true;
      },
      reset: () => {
        mine = null;
        node.style.width = node.style.height = '';
        node.style.minWidth = node.style.minHeight = '';
        node.style.maxWidth = node.style.maxHeight = '';
        onSize(null);
      },
      sized: () => !!mine,
    };
  };
  // ===================== end PANEL KIT v2 ====================================

  const mount = () => {
    if (root) return;
    root = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);

    fab = document.createElement('button');
    fab.className = 'pk-fab pktw-fab';
    fab.title = 'Politiko Time Watch (passive) — drag to move';
    fab.textContent = 'TIME';
    fab.addEventListener('click', () => {
      if (fabDrag.dragged()) return; // that gesture was a drag, not a click
      ui.open = !ui.open; writeJSON(K.ui, ui); sync();
    });
    root.append(fab);

    panel = document.createElement('div');
    panel.className = 'pktw-panel';

    head = document.createElement('div');
    head.className = 'pktw-head';
    head.title = 'Drag to move · drag the bottom-right corner to resize · double-click to snap back';
    head.append(Object.assign(document.createElement('span'), { textContent: 'time watch' }));
    const grip = document.createElement('span');
    grip.className = 'pktw-dim';
    grip.textContent = '⠿';
    head.append(grip);

    body = document.createElement('div');
    body.className = 'pktw-body';
    panel.append(head, body);
    root.append(panel);

    document.documentElement.append(root);

    drag = draggable(panel, head, (pos) => {
      Object.assign(ui, pos ?? { x: null, y: null });
      writeJSON(K.ui, ui);
    });
    resize = resizable(panel, (size) => { ui.size = size ?? undefined; writeJSON(K.ui, ui); },
      { drag, minW: 260, minH: 160 });
    // Double-click the header undoes both — the recovery path for a panel dragged
    // or resized into uselessness.
    head.addEventListener('dblclick', () => { drag.reset(); resize.reset(); });

    // the FAB moves too — it is UI in the way just as much as the panel is
    fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; writeJSON(K.ui, ui); });
    fabDrag.apply(ui.fab);

    sync();
  };

  const sync = () => {
    if (!panel) return;
    panel.style.display = ui.open ? 'flex' : 'none';
    if (!ui.open) return;
    drag.apply(ui);
    resize.apply(ui.size);   // display:none has no geometry, so restore on show
    render();      // content decides the height…
    drag.fit();    // …so only now can we be sure the header is still reachable
    fabDrag?.fit();
  };

  // Redraw each real second (~0.87 game minutes) — only while the tab is visible,
  // and not while the pointer is over the panel (so the copy button isn't rebuilt
  // out from under a click).
  setInterval(() => {
    if (!document.hidden && ui.open && !(panel && panel.matches(':hover'))) draw();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });

  const boot = () => { mount(); log('ready'); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
