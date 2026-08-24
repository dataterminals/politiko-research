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
// PANEL KIT v1 is copied verbatim into every tool that draws a panel, with no build
// step and no @require, so each script stays one auditable file. CLAUDE.md states the
// copies must stay byte-identical and that changing the kit means bumping its version
// in all of them — but until now nothing checked, and a silent divergence between
// seven copies is exactly the kind of drift you only find when one panel behaves
// differently from the rest.
// ---------------------------------------------------------------------------
console.log('\n— PANEL KIT v1 is byte-identical everywhere —');
{
  const dir = path.join(__dirname, '..');
  const carriers = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.user.js'))
    .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('const draggable = (node, handle, onMove)'));

  check('every panel tool was found', carriers.length >= 6, true);

  const seen = new Map();
  for (const f of carriers) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes('const draggable = (node, handle, onMove)'));
    const body = lines.slice(i, i + 93).join('\n');
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
  const KNOWN_BROKEN = new Set(['quick-jump.user.js']);

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
