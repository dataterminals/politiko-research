// Slices the real placement layer out of people-watch and exercises it against a
// synthetic viewport. Placement is the part that has to hold up on a layout this
// script does not control: the button has to stay reachable, and the panel has to
// stay fully on screen no matter which corner the button was dragged into.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'people-watch.user.js'), 'utf8');

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from} .. ${to}`);
  return SRC.slice(i, j);
};

const P_SLICE = cut('  const defaultFabPos = ()', '  function makeDraggable()');

const CFG = { PANEL_W: 560, PANEL_MIN_H: 160, FAB_SIZE: 38, EDGE: 8 };

// Just enough DOM for the layer to write into: a style bag per element, and a
// root whose querySelector hands back the panel.
const mkStage = (vw, vh, storedFab = null) => {
  const window = { innerWidth: vw, innerHeight: vh };
  const fab = { style: {} };
  const panel = { style: {} };
  const root = { querySelector: () => panel };
  const ui = { fab: storedFab };
  const api = new Function('window', 'fab', 'root', 'ui', 'CFG',
    `${P_SLICE}\nreturn { defaultFabPos, clampFab, viewportUsable, placeFab, placePanel };`
  )(window, fab, root, ui, CFG);
  return { window, fab, panel, ui, ...api };
};

const px = (v) => (typeof v === 'string' && v.endsWith('px') ? Number(v.slice(0, -2)) : NaN);

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

console.log('\n— default position —');
{
  const s = mkStage(1600, 900);
  const d = s.defaultFabPos();
  check('sits on the right edge', d.x, 1600 - CFG.FAB_SIZE - CFG.EDGE);
  check('sits in the upper third, not in a corner', d.y, Math.round(900 * 0.28));
  // The whole point of the height: the Comms dock is 420px tall and anchored to the
  // bottom of this same edge, so mid-height lands on top of it on a short window.
  check('clears a 420px dock on a 900px window', d.y + CFG.FAB_SIZE < 900 - 420, true);
  check('...and on a 720px one', Math.round(720 * 0.28) + CFG.FAB_SIZE < 720 - 420, true);
}

console.log('\n— clamping —');
{
  const s = mkStage(1600, 900);
  check('far off the right/bottom is pulled back in',
    s.clampFab({ x: 99999, y: 99999 }),
    { x: 1600 - CFG.FAB_SIZE - CFG.EDGE, y: 900 - CFG.FAB_SIZE - CFG.EDGE });
  check('negative coordinates are pulled back in', s.clampFab({ x: -500, y: -500 }), { x: CFG.EDGE, y: CFG.EDGE });
}
{
  // A viewport narrower than the button itself must not produce a negative edge.
  const s = mkStage(200, 160);
  const c = s.clampFab({ x: 9999, y: 9999 });
  check('a cramped viewport still clamps to >= EDGE', c.x >= CFG.EDGE && c.y >= CFG.EDGE, true);
}

console.log('\n— placeFab —');
{
  const s = mkStage(1600, 900);
  s.placeFab();
  check('writes left/top', [px(s.fab.style.left), px(s.fab.style.top)], [s.ui.fab.x, s.ui.fab.y]);
  check('clears the old right/bottom anchoring', [s.fab.style.right, s.fab.style.bottom], ['auto', 'auto']);
}
{
  const s = mkStage(1600, 900, { x: 40, y: 40 });
  s.placeFab();
  check('a stored position is honoured', s.ui.fab, { x: 40, y: 40 });
}
{
  // A hidden tab reports a ~zero viewport; clamping against it would pin the
  // button to the corner and the next save would make that permanent.
  const s = mkStage(0, 0, { x: 900, y: 400 });
  check('an unusable viewport is not treated as information', s.viewportUsable(), false);
  s.placeFab();
  check('...so the stored position survives it', s.ui.fab, { x: 900, y: 400 });
}
{
  // Shrinking the window must pull a now-offscreen button back into view.
  const s = mkStage(1600, 900, { x: 1550, y: 850 });
  s.window.innerWidth = 800; s.window.innerHeight = 600;
  s.placeFab();
  check('a resize drags the button back on screen',
    s.ui.fab, { x: 800 - CFG.FAB_SIZE - CFG.EDGE, y: 600 - CFG.FAB_SIZE - CFG.EDGE });
}

console.log('\n— panel follows the button —');
const onScreen = (s) => {
  const l = px(s.panel.style.left), w = px(s.panel.style.width);
  return l >= CFG.EDGE && l + w <= s.window.innerWidth - CFG.EDGE;
};
{
  const s = mkStage(1600, 900, { x: 1554, y: 430 });
  s.placeFab();
  check('right edge: panel opens inward', px(s.panel.style.left), 1554 + CFG.FAB_SIZE - CFG.PANEL_W);
  check('...and stays on screen', onScreen(s), true);
}
{
  const s = mkStage(1600, 900, { x: 8, y: 430 });
  s.placeFab();
  check('left edge: panel flips to left-aligned', px(s.panel.style.left), 8);
  check('...and stays on screen', onScreen(s), true);
}
{
  const s = mkStage(1600, 900, { x: 700, y: 20 });
  s.placeFab();
  check('button near the top: panel hangs below', px(s.panel.style.top), 20 + CFG.FAB_SIZE + 8);
  check('...with the bottom anchor released', s.panel.style.bottom, 'auto');
}
{
  const s = mkStage(1600, 900, { x: 700, y: 850 });
  s.placeFab();
  check('button near the bottom: panel hangs above', px(s.panel.style.bottom), 900 - 850 + 8);
  check('...with the top anchor released', s.panel.style.top, 'auto');
}
{
  const s = mkStage(420, 700, { x: 300, y: 300 });
  s.placeFab();
  check('a narrow viewport shrinks the panel to fit', px(s.panel.style.width), 420 - CFG.EDGE * 2);
  check('...and it is still fully on screen', onScreen(s), true);
}
{
  for (const y of [8, 200, 450, 700, 854]) {
    const s = mkStage(1600, 900, { x: 700, y });
    s.placeFab();
    const h = px(s.panel.style.maxHeight);
    check(`height at y=${y} is bounded and usable`, h >= CFG.PANEL_MIN_H && h <= 900, true);
  }
}

// ---------------------------------------------------------------------------
// PANEL KIT v2 is copied verbatim into every tool that draws a panel, with no build
// step and no @require, so each script stays one auditable file. CLAUDE.md states the
// copies must stay byte-identical and that changing the kit means bumping its version
// in all of them — but until now nothing checked, and a silent divergence between
// seven copies is exactly the kind of drift you only find when one panel behaves
// differently from the rest.
// ---------------------------------------------------------------------------
console.log('\n— PANEL KIT v2 is byte-identical everywhere —');
{
  const dir = path.join(__dirname, '..');
  const carriers = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.user.js'))
    .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('const draggable = (node, handle, onMove)'));

  check('every panel tool was found', carriers.length >= 6, true);

  const seen = new Map();
  for (const f of carriers) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // Marker to marker, not a line count: v1 was 93 lines and v2 is not, and a
    // hardcoded length quietly stops covering the tail the moment the kit grows.
    const i = src.indexOf('  const draggable = (node, handle, onMove)');
    const j = src.indexOf('      sized: () => !!mine,', i);
    check(`${f} carries a whole kit`, i >= 0 && j > i, true);
    const body = src.slice(i, j);
    const key = crypto.createHash('md5').update(body).digest('hex').slice(0, 12);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(f);
  }

  const variants = [...seen.entries()];
  check(`all ${carriers.length} copies agree`, variants.length, 1);
  if (variants.length > 1) {
    for (const [hash, files] of variants) console.log(`        ${hash}  ${files.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Every window this repo draws over the game has to be resizable, for the same
// reason every one of them has to be movable: it is our furniture sitting on top of
// somebody else's game, on a screen we do not control. A 340px column is fine until
// the table in it has eleven columns, and a 74vh panel is a wall on a laptop.
//
// Two implementations satisfy this, and both are legitimate:
//   - PANEL KIT v2's resizable(), which arms the browser's own grabber; and
//   - market-watch's corner grips, which it needs because its panel is pinned to its
//     button and therefore grows from whichever corner is free — the UA grabber only
//     ever grows a box right and down.
//
// Note the regexes below match `resizable(` — a CALL. The kit's own definition reads
// `const resizable = (`, with a space, so carrying the block is not enough to pass.
// ---------------------------------------------------------------------------
console.log('\n— every panel this repo draws can be resized —');
{
  const dir = path.join(__dirname, '..');

  // Tools that draw no window of their own, and why:
  //   _template   the skeleton; it has the kit but nothing to mount
  //   time-bridge headless, no UI at all
  //   comms-move  moves the GAME's Comms dock. Sizing that means overriding the
  //               game's own collapse behaviour and its inner .ch-panel, which is a
  //               larger claim than "this tool only repositions" — see its
  //               disclosure block. Out of scope on purpose, not an oversight.
  const NO_WINDOW = new Set(['_template.user.js', 'time-bridge.user.js', 'comms-move.user.js']);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.user.js'));
  const panels = files.filter((f) => !NO_WINDOW.has(f));
  check('every tool is accounted for', files.length, panels.length + NO_WINDOW.size);

  const missing = panels.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    return !/\bresizable\(/.test(src) && !/makeResizable\(\)/.test(src);
  });
  check('no panel ships without a way to resize it', missing, []);

  // A stored size is the other half: a panel that forgets on reload is a panel you
  // resize every session.
  const forgetful = panels.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    return !/\bui\.size\b/.test(src);
  });
  check('...and every one of them remembers it', forgetful, []);

  // The kit's resizable() takes the draggable() for the same node so a resize can
  // re-clamp the panel. Without it a panel grown past the viewport can push its own
  // drag handle off screen, which is the one unrecoverable state.
  const unfitted = panels.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/\bresizable\(/.test(src)) return false;      // market-watch re-places itself
    return !/\{\s*drag(:\s*\w+)?,/.test(src);
  });
  check('...and hands the kit its drag, so a resize cannot strand the handle', unfitted, []);
}

// ---------------------------------------------------------------------------
// PANEL KIT v2's resizable(), driven.
//
// The static checks above prove every tool CARRIES the block and WIRES it. This
// drives the block itself, because the parts that matter are the ones that only
// misbehave in states you would otherwise have to reproduce by hand:
//
//   - the browser's grabber only grows a box right and down, so a panel still
//     hanging off its CSS `right`/`bottom` corner grows AWAY from the pointer.
//     That was live in xp-watch for six versions. The grab has to pin first.
//   - a `max-height: 74vh` in the panel's own stylesheet silently outranks a
//     chosen height: the panel stops growing while the pointer keeps going.
//   - a restore must not read back as a user gesture, or every mount rewrites
//     storage and a cleared size resurrects itself.
//   - a minimised window reports a ~zero viewport. Capping against that shrinks
//     the panel to nothing and the next report makes it permanent.
// ---------------------------------------------------------------------------
console.log('\n— resizable(), driven —');
{
  const tpl = fs.readFileSync(path.join(__dirname, '..', '_template.user.js'), 'utf8');
  const a = tpl.indexOf('  const resizable = (node, onSize, opts = {}) => {');
  const b = tpl.indexOf('      sized: () => !!mine,', a);
  if (a < 0 || b < a) throw new Error('resizable() markers not found in _template.user.js');
  const SLICE = tpl.slice(a, b) + '      sized: () => !!mine,\n    };\n  };\n';

  const stage = (vw, vh, rect) => {
    const onWindow = [];
    const win = { innerWidth: vw, innerHeight: vh, addEventListener: (t, fn) => onWindow.push(fn) };
    const bound = [];
    const node = {
      style: {},
      addEventListener: (t, fn) => bound.push({ t, fn }),
      getBoundingClientRect: () => rect,
    };
    const seen = [], fits = [], pins = [];
    const drag = { fit: () => fits.push(1), pin: () => pins.push(1) };
    // ResizeObserver deliberately absent: this exercises the pointerup backstop,
    // which is the only path a non-compositing page is left with.
    const make = new Function('window', 'ResizeObserver', SLICE + '\nreturn resizable;')(win, undefined);
    const api = make(node, (s) => seen.push(s), { drag, minW: 260, minH: 160 });
    return {
      win, node, seen, fits, pins, api,
      fire: (t, ev) => bound.filter((x) => x.t === t).forEach((x) => x.fn(ev)),
      resizeWindow: () => onWindow.forEach((fn) => fn()),
    };
  };

  const RECT = { left: 100, top: 100, right: 400, bottom: 300, width: 300, height: 200 };

  {
    const s = stage(1280, 720, RECT);
    check('arms the browser grabber', s.node.style.resize, 'both');
    // `resize` is inert while overflow is visible — the easiest way there is to ship
    // this looking correct and having it do nothing at all.
    check('...with a non-visible overflow, or the grabber does nothing', s.node.style.overflow, 'hidden');
    check('an untouched panel keeps its stylesheet sizing', s.node.style.maxHeight, undefined);
    check('...and reports nothing', s.seen, []);
  }

  {
    // A grab in the corner pins, then caps. Anywhere else is an ordinary click on
    // the panel and must not touch the geometry.
    const s = stage(1280, 720, RECT);
    s.fire('pointerdown', { clientX: 200, clientY: 200 });
    check('a click in the middle is not a grab', [s.pins.length, s.node.style.maxWidth], [0, undefined]);

    s.fire('pointerdown', { clientX: 395, clientY: 295 });
    check('a grab in the corner pins the panel to left/top', s.pins.length, 1);
    check('...and caps growth at the viewport, not at 74vh', s.node.style.maxHeight, '704px');
    check('...and keeps a floor under it', [s.node.style.minWidth, s.node.style.minHeight], ['260px', '160px']);
  }

  {
    // The gesture itself: the UA writes inline width/height, we read them back.
    const s = stage(1280, 720, RECT);
    s.fire('pointerdown', { clientX: 395, clientY: 295 });
    s.node.style.width = '520px'; s.node.style.height = '460px';
    s.fire('pointerup', {});
    check('a chosen size is reported once', s.seen, [{ w: '520px', h: '460px' }]);
    check('...and re-fits, so a grown panel cannot strand its own handle', s.fits.length, 1);

    s.fire('pointerup', {});
    check('...and reporting the same size again is a no-op', s.seen.length, 1);
  }

  {
    // A restore is not a gesture. If it read back as one, every mount would rewrite
    // storage and a cleared size would resurrect itself.
    const s = stage(1280, 720, RECT);
    check('apply() takes a stored size', s.api.apply({ w: '520px', h: '460px' }), true);
    check('...and writes it', [s.node.style.width, s.node.style.height], ['520px', '460px']);
    check('...and pins it, the same as a grab would', s.pins.length, 1);
    check('...but does NOT report it back as a user resize', s.seen, []);
    check('...and knows it is sized', s.api.sized(), true);

    s.node.style.width = '600px';
    s.fire('pointerup', {});
    check('a real gesture after a restore still reports', s.seen, [{ w: '600px', h: '460px' }]);
  }

  {
    const s = stage(1280, 720, RECT);
    s.api.apply({ w: '520px', h: '460px' });
    s.api.reset();
    check('reset() clears the size', [s.node.style.width, s.node.style.height], ['', '']);
    check('...and the caps with it, back to the stylesheet', [s.node.style.maxWidth, s.node.style.maxHeight], ['', '']);
    check('...and says so', s.seen, [null]);
    check('...and is no longer sized', s.api.sized(), false);

    // The clearing write must not immediately read back as a new zero-size gesture.
    s.fire('pointerup', {});
    check('...and an empty size is not a gesture', s.seen.length, 1);
  }

  {
    // A minimised window or a hidden tab reports ~0. Capping against that would
    // shrink the panel to nothing and the next report would make it permanent —
    // the same trap viewportUsable() guards against in the placement layer above.
    const s = stage(0, 0, RECT);
    s.fire('pointerdown', { clientX: 395, clientY: 295 });
    check('a zero viewport is treated as no information', s.node.style.maxHeight, undefined);

    const t = stage(1280, 720, RECT);
    t.api.apply({ w: '520px', h: '460px' });
    t.win.innerWidth = 0; t.win.innerHeight = 0;
    t.resizeWindow();
    check('...and a minimise does not re-cap a sized panel to nothing', t.node.style.maxHeight, '704px');
  }
}

// ---------------------------------------------------------------------------
// A drag handle has to outlive the redraw.
//
// PANEL KIT binds its pointer listeners to the handle NODE it is handed. A panel that
// rebuilds its header inside paint() — `panelEl.replaceChildren()`, then a fresh `hd`,
// then `grip = hd` — hands the kit a node that the very next repaint throws away. The
// panel drags until the first poll lands, and then never again.
//
// It is a nasty one to catch by eye, for two reasons. The FAB is bound separately at
// mount, so it keeps working and the whole thing reads as a panel-only quirk; and the
// first drag after opening does work, because that paint is the one that bound it.
//
// The byte-identical check above does not help here — every copy of the kit is correct,
// and the tool wires it to the wrong node.
// ---------------------------------------------------------------------------
console.log('\n— the drag handle survives a repaint —');
{
  const dir = path.join(__dirname, '..');

  // Known-affected and not yet fixed; these predate this check. Delete a name as it is
  // fixed — never add one to make the build green.
  const KNOWN_BROKEN = new Set([]);

  const carriers = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.user.js'))
    .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('const draggable = (node, handle, onMove)'));

  const broken = [];
  for (const f of carriers) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/draggable\(\s*([\w$]+)\s*,\s*([\w$]+)\s*,/g)) {
      const [, node, handle] = m;
      if (node === handle) continue;                    // a bare FAB drags from itself
      const wipe = src.indexOf(node + '.replaceChildren()');
      if (wipe < 0) continue;                           // this panel is never cleared wholesale
      // an assignment to the handle AFTER the node is emptied means it is rebuilt per paint
      if (new RegExp('^\\s*' + handle + '\\s*=[^=]', 'm').test(src.slice(wipe))) {
        broken.push({ file: f, wiring: `${node}/${handle}` });
      }
    }
  }

  const unexpected = broken.filter((b) => !KNOWN_BROKEN.has(b.file));
  check('no tool rebuilds its drag handle inside the redraw',
    unexpected.map((b) => `${b.file} (${b.wiring})`), []);

  const still = [...new Set(broken.map((b) => b.file))].filter((f) => KNOWN_BROKEN.has(f)).sort();
  if (still.length) console.log(`        known and still unfixed: ${still.join(', ')}`);

  // If a listed tool starts passing, the entry is stale and must go — otherwise the list
  // quietly becomes a place where fixed things are still called broken.
  check('the known-broken list has no stale entries',
    [...KNOWN_BROKEN].filter((f) => !broken.some((b) => b.file === f)), []);
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
