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

const P_SLICE = cut('  const HOME = {', '  function makeDraggable()');

const CFG = { PANEL_W: 560, PANEL_MIN_H: 160, FAB_SIZE: 38, EDGE: 8 };

// Just enough DOM for the layer to write into: a style bag per element, and a
// root whose querySelector hands back the panel.
//
// `bar` is the classic scrollbar, and it is here because it is the whole of one
// bug. The kit lays the row out in CSS, where a fixed element's percentages
// resolve against the initial containing block — documentElement.clientWidth,
// which EXCLUDES the scrollbar. The two tools that place their own button used
// window.innerWidth, which includes it. The default of 15 is what Chrome on
// Windows reports, so every stage below is asking the question the shipped page
// asks; pass 0 for a page with no bar.
const mkStage = (vw, vh, storedFab = null, bar = 15) => {
  const window = { innerWidth: vw, innerHeight: vh };
  const document = { documentElement: { clientWidth: Math.max(0, vw - bar) } };
  // The button reports where it actually IS, which is the whole point since v8: with
  // nothing stored, this layer hands the button back to FAB KIT's rule and then reads
  // the result instead of recomputing the row. `rect` stands in for the stylesheet —
  // set it to say "this is where the CSS put it" — and an inline left/top wins over
  // it, exactly as it does in a browser.
  const fab = {
    style: {},
    rect: { left: 0, top: 0, width: 38, height: 38 },
    getBoundingClientRect() {
      const l = px(this.style.left), t = px(this.style.top);
      return Number.isFinite(l) && Number.isFinite(t)
        ? { left: l, top: t, width: 38, height: 38 }
        : { ...this.rect };
    },
  };
  const panel = { style: {} };
  const root = { querySelector: () => panel };
  const ui = { fab: storedFab };
  const api = new Function('window', 'document', 'fab', 'root', 'ui', 'CFG',
    `${P_SLICE}\nreturn { defaultFabPos, clampFab, viewportUsable, placeFab, placePanel, fabAt, HOME };`
  )(window, document, fab, root, ui, CFG);
  return { window, document, fab, panel, ui, ...api };
};

const px = (v) => (typeof v === 'string' && v.endsWith('px') ? Number(v.slice(0, -2)) : NaN);

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

console.log('\n— the home row —');
{
  // FAB KIT v8: every button in this repo defaults to one slot of one row across the
  // band above the game's header rule. people-watch holds slot 0 and places its own
  // button, so this is the JS half of that row — the CSS half is checked at the bottom
  // of this file, against these same numbers.
  const s = mkStage(1700, 900);
  const d = s.defaultFabPos();
  check('sits in the header band, not in a corner', d.y, 7);
  check('the whole button clears the 52px band', d.y + CFG.FAB_SIZE <= 52, true);

  // Sixteen slots at a 46px pitch, and the three widths the row has to be right at.
  const ROW = 16 * CFG.FAB_SIZE + 15 * 8;
  check('sixteen slots make a 728px row', ROW, 728);
  check('...which is what 364 is half of', ROW, 364 * 2);

  // 1. THE ICB, NOT THE WINDOW. This is the whole of the v8 fix and the one probe
  //    that cannot be written by restating the arithmetic: the same viewport with
  //    and without a scrollbar must give two answers that differ by half the bar.
  //    Before v8 this layer read window.innerWidth and gave one answer for both,
  //    which is 7.5px right of where the kit's CSS puts everybody else — most of
  //    the 8px gap, so the eye sat all but touching ALGN and MKT touching SHOP.
  check('the row is laid out against the containing block, not the window',
    [mkStage(1920, 900, null, 15).defaultFabPos().x, mkStage(1920, 900, null, 0).defaultFabPos().x],
    [1905 / 2 - 364, 960 - 364]);
  check('...which is what the browser actually measured on the bench', mkStage(1920, 900).defaultFabPos().x, 588.5);

  // 2. THE NAV FLOOR. Below ~1623px the row would start climbing onto the game's own
  //    nav links, so it stops sliding left instead. That floor is why the maths is a
  //    max() rather than a subtraction, and it is the half most likely to get
  //    simplified away later.
  //
  //    Every slot the row gains moves that threshold: the row gets 46px wider, so it
  //    meets the floor 46px sooner. v4's two slots moved it from ~1378 to ~1470, v5's
  //    one moved it to ~1516, v6's to ~1562 and v7's to ~1608 — and v8 moved it 15
  //    more, because the number is now measured against the containing block. The two
  //    probes below straddle it deliberately: a test that only ever asked about
  //    1200px would have passed the whole way through every bump and told you nothing
  //    about the number that actually changed.
  check('centred when there is room', mkStage(2560, 1440).defaultFabPos().x, 2545 / 2 - 364);
  check('the floor engages below ~1623px', mkStage(1617, 900).defaultFabPos().x, 440);
  check('...and not above it', mkStage(1629, 900).defaultFabPos().x, 1614 / 2 - 364);
  check('floored clear of the nav on a 1200px window', mkStage(1200, 800).defaultFabPos().x, 440);

  // 3. THE EDGE YIELD, new in v8, and the reason the row is now a min() inside a max().
  //    The floor held the row clear of the nav; nothing held it clear of the WINDOW, so
  //    below ~1191px the far end of the row was off the screen — and then PANEL KIT's
  //    fit() dragged every stray button back to the same pixel and saved it there. Four
  //    buttons on one square, permanently. The edge now outranks the nav.
  check('below ~1191px the row gives up the nav floor rather than the edge',
    mkStage(1100, 800).defaultFabPos().x, 1085 - 736);
  check('...and the yield starts exactly where the row stops fitting',
    [mkStage(1197, 800).defaultFabPos().x, mkStage(1185, 800).defaultFabPos().x], [440, 1170 - 736]);

  // 4. THE FENCE. The two above are arithmetic; this is the property they exist for.
  //    Sweep the widths a desktop actually takes and assert the far slot is on screen
  //    at every one of them — that is the thing whose absence shipped, and the thing a
  //    seventeenth tool will break.
  const far = (vw) => {
    const st = mkStage(vw, 900);
    return st.defaultFabPos().x + (16 - 1) * st.HOME.pitch + CFG.FAB_SIZE;
  };
  const spills = [];
  for (let vw = 744 + 15; vw <= 2560; vw += 1) if (far(vw) > vw - 15) spills.push(vw);
  check('the far slot is on screen at every width from 759px up', spills.slice(0, 8), []);
  check('...and the left end never leaves either',
    [...Array(200)].map((_, i) => mkStage(760 + i * 9, 900).defaultFabPos().x).filter((x) => x < CFG.EDGE), []);

  // Under 744px of containing block the row simply IS wider than the window — sixteen
  // 38px buttons 8px apart are 728px — and it runs off the edge again. That is a
  // stated limit, not an oversight: the game is in its mobile layout there and the
  // alternative is a second regime for both JS copies of this row to get wrong.
  check('...and 744px is where that stops being possible', 15 * 46 + CFG.FAB_SIZE + CFG.EDGE * 2, 744);
}

console.log('\n— clamping —');
{
  const s = mkStage(1600, 900);
  check('far off the right/bottom is pulled back in',
    s.clampFab({ x: 99999, y: 99999 }),
    { x: 1600 - CFG.FAB_SIZE - CFG.EDGE, y: 900 - CFG.FAB_SIZE - CFG.EDGE });
  // The top floor is the ROW's 7px, not CFG.EDGE's 8. It has to be, or the clamp
  // moves a button that is sitting exactly where the kit put it: this layer runs on
  // every mount and every resize, so a one-pixel disagreement between the clamp and
  // the row is a permanent one-pixel step in a row of sixteen — which is what
  // shipped, on the only two buttons that use this code.
  check('negative coordinates are pulled back in', s.clampFab({ x: -500, y: -500 }), { x: CFG.EDGE, y: 7 });
  check('...and the home row survives its own clamp', s.clampFab(s.defaultFabPos()), s.defaultFabPos());
}
{
  // A viewport narrower than the button itself must not produce a negative edge.
  const s = mkStage(200, 160);
  const c = s.clampFab({ x: 9999, y: 9999 });
  check('a cramped viewport still clamps to >= EDGE', c.x >= CFG.EDGE && c.y >= 7, true);
}

console.log('\n— placeFab —');
{
  // AN UNTOUCHED BUTTON BELONGS TO THE STYLESHEET. This is v8's fix, and it is a
  // deletion rather than an addition: placeFab used to write the row out as an
  // inline left/top, which is a SECOND copy of a number the kit's CSS already
  // knows — and an inline value outranks the rule, so the copy always won.
  //
  // A copy is only ever as fresh as the last thing that recomputed it, and the
  // event that mattered does not exist: a scrollbar appearing narrows the
  // containing block without firing resize. On the bench that left the eye 7.5px
  // right of the row — half a scrollbar, most of an 8px gap — until something
  // unrelated happened to fire one. Clearing the anchoring has no such failure
  // mode, because there is nothing left to keep in step.
  const s = mkStage(1600, 900);
  s.placeFab();
  check('hands an unmoved button back to the kit, rather than writing the row out',
    [s.fab.style.left, s.fab.style.top, s.fab.style.right, s.fab.style.bottom], ['', '', '', '']);

  // ui.fab is the position the USER chose, and an untouched button has not chosen
  // one. Filling it in on mount reads as harmless and is the same bug from the
  // other side: a value derived from the viewport, frozen into storage.
  check('...and stores nothing, because nobody moved it', s.ui.fab, null);

  // And what the panel hangs off is then the MEASURED button, not a recomputation.
  s.fab.rect = { left: 588.5, top: 7, width: 38, height: 38 };
  check('...so the panel follows where the button actually is', s.fabAt(), { x: 588.5, y: 7 });
}
{
  // THE FREEZE, from the storage side. Before v8 the first mount stored the row, so
  // every later resize found a stored position and only clamped it — the fourteen
  // CSS-placed buttons moved and this one did not. Same shape as a browser zoom.
  const s = mkStage(2560, 1440);
  s.placeFab();
  s.window.innerWidth = 1400; s.document.documentElement.clientWidth = 1385;
  s.placeFab();
  check('a resize leaves it on the stylesheet, not on the first viewport it saw',
    [s.ui.fab, s.fab.style.left], [null, '']);
}
{
  const s = mkStage(1600, 900, { x: 40, y: 40 });
  s.placeFab();
  check('a stored position is honoured', [px(s.fab.style.left), s.ui.fab], [40, { x: 40, y: 40 }]);
  check('...and anchors explicitly, so a CSS corner cannot fight it',
    [s.fab.style.right, s.fab.style.bottom], ['auto', 'auto']);
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
  s.document.documentElement.clientWidth = 785;
  s.placeFab();
  check('a resize drags the button back on screen',
    { x: px(s.fab.style.left), y: px(s.fab.style.top) },
    { x: 800 - CFG.FAB_SIZE - CFG.EDGE, y: 600 - CFG.FAB_SIZE - CFG.EDGE });
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
// Before anything about the blocks: every shipped file has to PARSE.
//
// Nothing in this suite used to. The checks below read the tools as text and the
// driven ones slice single functions out of them, so a file could be syntactically
// broken from end to end and the whole suite would still print ALL OK.
//
// The way that actually happened: FAB KIT's CSS is pasted inside a template
// literal, and a backtick written into its comment ends the literal. Every copy
// took it at once, every text check passed, and the first sign of it was a tool
// that silently never mounted. A parse is one line and it fences the whole class.
// ---------------------------------------------------------------------------
console.log('\n— every shipped userscript parses —');
{
  const dir = path.join(__dirname, '..');
  const broken = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.user.js'))) {
    try {
      // The scripts are IIFEs, not modules; new Function parses without running.
      new Function(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      broken.push(`${f}: ${e.message}`);
    }
  }
  check('no tool ships a syntax error', broken, []);
}

// ---------------------------------------------------------------------------
// PANEL KIT v3 is copied verbatim into every tool that draws a panel, with no build
// step and no @require, so each script stays one auditable file. CLAUDE.md states the
// copies must stay byte-identical and that changing the kit means bumping its version
// in all of them — but until now nothing checked, and a silent divergence between
// seven copies is exactly the kind of drift you only find when one panel behaves
// differently from the rest.
// ---------------------------------------------------------------------------
console.log('\n— PANEL KIT v3 is byte-identical everywhere —');
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
// HTTP TAP v1 is the third copy-verbatim block, and it is the one sitting on the
// network path, so a divergence between copies is worse here than in the furniture:
// the whole reason it exists is that eleven private fetch wrappers each cloned and
// parsed every /api/ response before deciding they did not want it. One drifted copy
// and a tool is back to installing a second layer nobody can see.
// ---------------------------------------------------------------------------
console.log('\n— HTTP TAP v1 is byte-identical everywhere —');
{
  const dir = path.join(__dirname, '..');
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.user.js'));
  const carriers = all.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('const HTTP_TAP_VERSION ='));

  check('the template carries the block', carriers.includes('_template.user.js'), true);

  const seen = new Map();
  for (const f of carriers) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const i = src.indexOf('  const HTTP_TAP_VERSION =');
    const j = src.indexOf('    return api.subscribe;', i);
    check(`${f} carries a whole tap`, i >= 0 && j > i, true);
    const key = crypto.createHash('md5').update(src.slice(i, j)).digest('hex').slice(0, 12);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(f);
  }

  const variants = [...seen.entries()];
  check(`all ${carriers.length} copies agree`, variants.length, 1);
  if (variants.length > 1) {
    for (const [hash, files] of variants) console.log(`        ${hash}  ${files.join(', ')}`);
  }

  // A tool on the shared tap must not also keep its own wrapper — that is the
  // stacking this block was written to end. Tools not yet migrated are expected to
  // still have one, so this only checks the ones that carry the block.
  for (const f of carriers) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const own = (src.match(/window\.fetch = /g) || []).length;
    check(`${f} installs fetch once`, own, 1);
    const xhr = (src.match(/XMLHttpRequest\.prototype\.(open|send) = /g) || []).length;
    check(`${f} patches XHR at most once each`, xhr <= 2, true);
  }

  // Progress, printed rather than asserted: the migration is deliberately one tool
  // at a time, and a half-migrated tree is a valid state.
  const legacy = all.filter((f) => f !== '_template.user.js')
    .filter((f) => !fs.readFileSync(path.join(dir, f), 'utf8').includes('const HTTP_TAP_VERSION ='))
    .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('window.fetch = '));
  console.log(`        ${carriers.length - 1} tool(s) on the shared tap; ${legacy.length} still private${legacy.length ? ': ' + legacy.join(', ') : ''}`);
}

// ---------------------------------------------------------------------------
// Every window this repo draws over the game has to be resizable, for the same
// reason every one of them has to be movable: it is our furniture sitting on top of
// somebody else's game, on a screen we do not control. A 340px column is fine until
// the table in it has eleven columns, and a 74vh panel is a wall on a laptop.
//
// There is now exactly one implementation: PANEL KIT v3's resizable(), which arms the
// browser's own grabber.
//
// It used to be two. market-watch drew its own corner grips, because its panel was
// pinned to its button and so had to grow from whichever corner was free, and the UA
// grabber only ever grows a box right and down. The cost of that exception was not the
// grips — it was that the panel could not be MOVED at all. You moved the button and the
// panel followed it. As of 1.8.0 it is on the kit like everything else: the tether is
// still the default, and the first drag of the header parks the panel and stops it
// following. The `makeResizable()` escape hatch below is gone with it, so a tool cannot
// quietly opt out of the kit by rolling its own again.
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
    return !/\bresizable\(/.test(src);
  });
  check('no panel ships without a way to resize it', missing, []);

  // Every panel is also MOVABLE, and by its own header rather than by proxy. This is
  // the half market-watch was missing: it had a resize and no drag at all, so the only
  // way to move the window was to move the button it hung off.
  const stuck = panels.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    return !/\bdraggable\(/.test(src);
  });
  check('...or without a way to move it', stuck, []);

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
    if (!/\bresizable\(/.test(src)) return false;      // already reported by `missing`
    return !/\{\s*drag(:\s*\w+)?,/.test(src);
  });
  check('...and hands the kit its drag, so a resize cannot strand the handle', unfitted, []);
}

// ---------------------------------------------------------------------------
// PANEL KIT v3's draggable().fit(), driven — the zero-viewport guard.
//
// fit() is the safety net: it exists so a short window or a rotation can never leave
// a drag handle off screen with no way back. It runs on every resize, and when it
// moves something it calls onMove(), which every tool in this repo writes to storage.
//
// A hidden tab and a minimised window both report innerWidth/innerHeight of ~0, and
// a resize fires on the way there. Clamping against zero puts the element at
// (EDGE - width, -height) — (-44, -38) for a 38px button — and then SAVES it. Every
// button that took that resize ends up on the same pixel, off the top-left corner,
// and the stored position outlives the window. tools/harness/row.html found five of
// sixteen sitting there the first time it ran, and none of the text checks above can
// see it: every copy of the kit was byte-identical and correct, and the bug was that
// correct code ran against a viewport that was not information.
//
// The placement layer at the top of this file has guarded against exactly this since
// it was written (viewportUsable). The kit had not.
// ---------------------------------------------------------------------------
console.log('\n— fit() ignores a viewport that is not information —');
{
  const tpl = fs.readFileSync(path.join(__dirname, '..', '_template.user.js'), 'utf8');
  const a = tpl.indexOf('  const draggable = (node, handle, onMove) => {');
  const b = tpl.indexOf('  const resizable = (node, onSize, opts = {}) => {');
  if (a < 0 || b < a) throw new Error('draggable() markers not found in _template.user.js');
  const SLICE = tpl.slice(a, b);

  const stage = (vw, vh, rect) => {
    const win = { innerWidth: vw, innerHeight: vh, addEventListener: () => {} };
    const node = { style: {}, getBoundingClientRect: () => rect, offsetWidth: rect.width, offsetHeight: rect.height };
    const handle = { style: {}, addEventListener: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {} };
    const moves = [];
    const make = new Function('window', SLICE + '\nreturn draggable;')(win);
    return { node, moves, api: make(node, handle, (p) => moves.push(p)), win };
  };

  const BTN = { left: 486, top: 7, right: 524, bottom: 45, width: 38, height: 38 };

  {
    const s = stage(0, 0, BTN);
    check('a minimised window moves nothing', s.api.fit(), false);
    check('...and writes no position', [s.moves, s.node.style.left], [[], undefined]);
  }
  {
    // The same button, the same call, a viewport that IS information: still nothing
    // to do, because it is on screen. The guard must not be doing the work.
    const s = stage(1512, 900, BTN);
    check('a real viewport with the button in the row also moves nothing', s.api.fit(), false);
  }
  {
    // ...and when there genuinely is something to do, it still does it. A guard that
    // swallowed the real case would be worse than the bug.
    const s = stage(600, 400, { left: 1400, top: 7, right: 1438, bottom: 45, width: 38, height: 38 });
    check('a button left off the right edge is pulled back', s.api.fit(), true);
    check('...to somewhere reachable, and reported once',
      [s.moves.length, s.moves[0].x <= 600 - 44, s.moves[0].x > 0], [1, true, true]);
  }
}

// ---------------------------------------------------------------------------
// PANEL KIT v3's resizable(), driven.
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

// ---------------------------------------------------------------------------
// FAB KIT v8 — one button, sixteen copies.
//
// The toggle button is the only part of this repo a player sees before they open
// anything, and several of these tools sit on the same screen at once. Before the
// kit each tool had picked its own: three different sizes, two different shapes,
// and four emoji that render at the mercy of whatever font the platform hands them.
// Uniform is the point — so the box lives in one block and only the WORD inside it
// belongs to the tool.
//
// Same enforcement as PANEL KIT above, plus three things the hash cannot see: that
// the element actually wears the class, that the word is a word, and that a tool
// doing its own placement maths agrees with the kit about how big the box is.
// ---------------------------------------------------------------------------
console.log('\n— FAB KIT v8 is one button everywhere —');
{
  const dir = path.join(__dirname, '..');
  const A = '    /* FAB KIT v8 — shared verbatim block.';
  const B = '    .pk-fab svg { width: 24px; height: 24px; display: block; }';
  const BOX = 38; // .pk-fab's width/height, and what CFG.FAB_SIZE has to agree with

  // people-watch wears the eye of providence instead of a word. It is the mark the
  // tool has always had, it predates the kit, and it is the ONLY exception — a
  // second symbol button and the set stops reading as a set. Everything else about
  // it is the kit: same square, same border, same corner behaviour.
  const SYMBOL = new Set(['people-watch.user.js']);

  // Tools that draw no button of their own, and why. Same list as the panel one
  // minus _template, which carries the kit as FAB_CSS for the next tool to copy.
  const NO_FAB = new Set(['time-bridge.user.js', 'comms-move.user.js']);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.user.js'));
  const carriers = files.filter((f) => !NO_FAB.has(f));
  check('every tool is accounted for', files.length, carriers.length + NO_FAB.size);

  const seen = new Map();
  for (const f of carriers) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const i = src.indexOf(A);
    const j = src.indexOf(B, i);
    check(`${f} carries a whole kit`, i >= 0 && j > i, true);
    if (i < 0 || j <= i) continue;
    const body = src.slice(i, j + B.length);
    const key = crypto.createHash('md5').update(body).digest('hex').slice(0, 12);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(f);
  }

  const variants = [...seen.entries()];
  check(`all ${carriers.length} copies agree`, variants.length, 1);
  if (variants.length > 1) {
    for (const [hash, list] of variants) console.log(`        ${hash}  ${list.join(', ')}`);
  }

  // A copy of the CSS is inert if nothing wears the class. _template mounts nothing,
  // so it is exempt from this one and from the label check below.
  const mounted = carriers.filter((f) => f !== '_template.user.js');
  const unworn = mounted.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    return !/(?:className\s*=\s*'pk-fab|el\(\s*'(?:button|div)'\s*,\s*'pk-fab)/.test(src);
  });
  check('every button actually wears pk-fab', unworn, []);

  // v2 moved the open state onto the button, and the CSS for it is inert in any tool
  // that never sets the class. That failure is silent, and it is precisely the thing
  // the state was added to fix: ten buttons on one screen, every panel remembering
  // whether it was open, and no way to tell which windows are already up except by
  // clicking one and watching it close.
  const OPEN = /classList\.toggle\(\s*'pk-open'\s*,/;
  const unlit = mounted.filter((f) => !OPEN.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  check('every button says when its own panel is open', unlit, []);

  // toggle(name, cond) with the SECOND argument, always. A bare add() paired with a
  // remove() elsewhere is two places that have to agree about one fact, and the one
  // that gets missed is the close path — which strands a lit button over nothing.
  const oneWay = [];
  for (const f of mounted) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/classList\.(add|remove|toggle)\(\s*'pk-open'\s*([,)])/g)) {
      if (m[1] !== 'toggle' || m[2] !== ',') oneWay.push(`${f} (${m[0].trim()}…)`);
    }
  }
  check('...as toggle(name, cond), never a one-way add', oneWay, []);

  // And it has to sit ABOVE the paint function's own `if (!ui.open) return`. Below it
  // the class is only ever added, never removed: the panel closes and the button stays
  // lit until something else repaints it. Opening works, which is what makes it easy
  // to ship — you have to close a panel and look at the button to see it at all.
  const late = [];
  for (const f of mounted) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const lit = src.search(OPEN);
    if (lit < 0) continue;                     // already reported as unlit, above
    const early = src.search(/if \(!ui\.open\) return/);
    if (early >= 0 && early < lit) late.push(f);
  }
  check('...above the early return, so closing reaches it too', late, []);

  // The word. Three or four upper-case letters, like a ticker — long enough to tell
  // ALGN from a shrug, short enough to fit the box at 11px. XP is two and is the
  // abbreviation everyone already uses; a third letter would only make it worse.
  const labelOf = (src) => {
    let m = src.match(/el\(\s*'(?:button|div)'\s*,\s*'pk-fab[^']*'\s*,\s*'([^']*)'\s*\)/);
    if (m) return m[1];
    m = src.match(/\bfab\.textContent\s*=\s*'([^']*)'/);
    if (m) return m[1];
    m = src.match(/\bfab\.append\(\s*document\.createTextNode\('([^']*)'\)/);
    if (m) return m[1];
    if (/\bfab\.innerHTML\s*=\s*EYE_SVG\b/.test(src)) return null; // the mark, not a word
    return undefined;                                                 // unreadable: a failure
  };

  const labels = [];
  for (const f of mounted) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const label = labelOf(src);
    if (SYMBOL.has(f)) {
      check(`${f} still wears its symbol`, label, null);
      continue;
    }
    check(`${f}: a 2-4 letter word, upper case, no emoji`,
      typeof label === 'string' && /^[A-Z]{2,4}$/.test(label) ? label : `bad label: ${label}`,
      typeof label === 'string' && /^[A-Z]{2,4}$/.test(label) ? label : 'A-Z, 2-4 chars');
    if (typeof label === 'string') labels.push(`${label} (${f})`);
  }

  // Two buttons reading the same word is worse than either reading nothing.
  const words = labels.map((l) => l.split(' ')[0]);
  check('no two buttons say the same thing',
    words.filter((w, i) => words.indexOf(w) !== i), []);
  console.log(`        ${words.sort().join('  ')}`);

  // A tool that places its own button measures against CFG.FAB_SIZE while the browser
  // measures against .pk-fab. Let those two disagree and the button clamps to the
  // wrong edge — off by exactly the drift, which is small enough to look like nothing
  // until the viewport is short.
  const drifted = [];
  for (const f of mounted) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = src.match(/FAB_SIZE:\s*(\d+)/);
    if (m && Number(m[1]) !== BOX) drifted.push(`${f} (${m[1]})`);
  }
  check(`CFG.FAB_SIZE agrees with the ${BOX}px box`, drifted, []);

  // The kit owns the box; the tool owns the corner and the state colours. A tool that
  // re-declares width/height/radius/font in its own rule is back to picking its own
  // shape, which is the whole thing this block exists to stop. Descendant selectors
  // (sleeper-watch's .fab .dot badge) are their own box and are not covered.
  const BOXY = /(?:^|[;{\s])(?:width|height|border-radius|font|font-size|font-family)\s*:/;
  const redeclared = [];
  for (const f of carriers) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/^[ \t]*([#.][\w.:#-]*fab[\w.:#-]*)[ \t]*\{([^}]*)\}/gmi)) {
      const [, sel, decls] = m;
      if (sel.startsWith('.pk-fab')) continue;   // that IS the kit
      if (BOXY.test(decls)) redeclared.push(`${f} (${sel})`);
    }
  }
  check('no tool redeclares the box in its own rule', redeclared, []);

  // Wearing the class at mount is not the same as keeping it. A repaint that rebuilds
  // the button's className from its state — `fab.className = \`fab${hot ? ' hot' : ''}\``
  // — drops pk-fab on the first tick and takes the whole kit with it: no box, no
  // border, no background, no font.
  //
  // What makes it worth a check of its own is how quietly it fails. The button keeps
  // its position and its click handler, so nothing throws, nothing logs, and the
  // element is still right there in the DOM with its text in it. Against the game's
  // dark chrome the result is not a broken button, it is no button — which is how
  // sleeper-watch 0.3.0 got out the door. Use classList.toggle for state.
  const clobbered = [];
  for (const f of mounted) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/[\w$]*[Ff]ab\.className\s*=\s*([^;\n]+)/g)) {
      if (!m[1].includes('pk-fab')) clobbered.push(`${f} (${m[1].trim()})`);
    }
  }
  check('no repaint drops pk-fab off the button', clobbered, []);
}


// ---------------------------------------------------------------------------
// FAB KIT v8 — one row, sixteen slots.
//
// v3 took the last thing a tool still chose about its button: where it starts.
// Eleven tools picking their own corner meant eleven buttons down both edges of
// the screen in an order nobody chose, and finding the one you wanted meant
// remembering which corner that tool had claimed. They now default to one row
// across the band above the game's header rule, one slot each.
//
// v4 was that row two slots wider, for poll-watch and shop-watch, v5 was one wider
// again for bar-watch, v6 one wider again for slot-watch, and v7 one wider again for
// jack-watch. The width is the only thing that moved, and it moved in three places at
// once — the kit's CSS, the two tools that compute the row in JS, and the arithmetic
// below.
// Half the row is the number that has to be re-derived every time a slot is added,
// so it is derived here rather than restated: SLOTS is the one place to edit.
//
// A row only holds if nothing quietly steps out of it, and there are three ways to:
// take an inset back in your own rule, forget to declare a slot, or — for the two
// tools that place their own button — let the JS drift from the CSS. All three fail
// silently and only on someone else's screen, so all three are checked here.
// ---------------------------------------------------------------------------
console.log('\n— FAB KIT v8 puts every button in one row —');
{
  const dir = path.join(__dirname, '..');
  const NO_FAB = new Set(['time-bridge.user.js', 'comms-move.user.js']);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.user.js'));
  const mounted = files.filter((f) => !NO_FAB.has(f) && f !== '_template.user.js');
  const src = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

  // The row itself, read back out of the kit rather than restated here — restating
  // it is how a test ends up agreeing with itself instead of with the shipped file.
  const kit = src('_template.user.js');
  const row = kit.match(
    /position: fixed; top: (\d+)px;\s*\n\s*left: calc\(max\((\d+)px, min\(max\((\d+)px, 50% - (\d+)px\), 100% - (\d+)px\)\)\s*\n\s*\+ var\(--pk-slot, 0\) \* (\d+)px\);/);
  check('the kit places the row itself', !!row, true);
  const [TOP, EDGE, FLOOR, HALF, SPAN, PITCH] = row ? row.slice(1).map(Number) : [];
  check('...7px down, inside the 52px header band', [TOP, TOP + 38 <= 52], [7, true]);
  check('...floored where the game nav ends, centred above that', [FLOOR, HALF], [440, 364]);
  check('...at a 46px pitch, which is the 38px box and an 8px gap', PITCH, 38 + 8);
  check('...and kept off the window edge by the same 8px the buttons use', EDGE, 8);
  // Half the row, derived from what is actually installed rather than restated. The
  // row is only centred if the width the kit declares matches the number of buttons
  // standing in it, so jack-watch is what forced v7 and a seventeenth tool will fail
  // here until the kit is bumped again. That failure is the whole point: a row that
  // has quietly stopped being centred looks exactly like a row that has not.
  const SLOTS = mounted.length;
  check(`...and half the row is what ${SLOTS} slots need`,
    HALF, Math.round((SLOTS * 38 + (SLOTS - 1) * 8) / 2));
  // v8's number, and the one that stops the row being stacked on one pixel: the whole
  // row plus the margin it keeps off the right edge. It is derived the same way and
  // for the same reason — a seventeenth tool widens the row, and a `100% - 736px`
  // left behind while HALF moved would let the far slot back off the screen without
  // changing anything a reader would look at twice.
  check(`...and the span it must not overhang is the row plus that edge`,
    SPAN, SLOTS * 38 + (SLOTS - 1) * 8 + EDGE);

  // Every tool declares a slot, and the sixteen of them are exactly 0..15 — no
  // duplicates (two buttons stacked on one square, and the one underneath is
  // unreachable) and no gaps that are really a typo.
  const RULE = /^[ \t]*([#.][\w.:#-]*fab[\w.:#-]*)[ \t]*\{([^}]*)\}/gmi;
  const KIT_END = '    .pk-fab svg { width: 24px; height: 24px; display: block; }';
  const own = (s) => s.slice(s.indexOf(KIT_END) + KIT_END.length);   // past the block
  const slotOf = (s) => {
    for (const m of own(s).matchAll(RULE)) {
      if (m[1].startsWith('.pk-fab')) continue;            // that IS the kit
      const d = m[2].match(/--pk-slot:\s*(\d+)/);
      if (d) return Number(d[1]);
    }
    return null;
  };

  const slots = new Map();
  const slotless = [];
  for (const f of mounted) {
    const n = slotOf(src(f));
    if (n === null) { slotless.push(f); continue; }
    if (!slots.has(n)) slots.set(n, []);
    slots.get(n).push(f);
  }
  check('every tool declares its slot', slotless, []);
  check('no two tools claim the same slot',
    [...slots.entries()].filter(([, l]) => l.length > 1).map(([n, l]) => `${n}: ${l.join(' + ')}`), []);
  check(`the ${mounted.length} slots are 0..${mounted.length - 1}`,
    [...slots.keys()].sort((a, b) => a - b), mounted.map((_, i) => i));

  // Declaring a slot and WEARING it are two different things. A slot on a selector the
  // button does not carry is inert, and the failure is not an error — the button falls
  // back to var(--pk-slot, 0) and quietly parks itself on top of people-watch's eye.
  // So: the selector that carries the slot has to be a class or id the button is
  // actually given at mount.
  const wornBy = (s) => {
    const t = new Set();
    for (const m of s.matchAll(/el\(\s*'(?:button|div)'\s*,\s*'([^']*pk-fab[^']*)'/g)) {
      for (const c of m[1].split(/\s+/)) t.add('.' + c);
    }
    for (const m of s.matchAll(/[\w$]*[Ff]ab\.className\s*=\s*'([^']*pk-fab[^']*)'/g)) {
      for (const c of m[1].split(/\s+/)) t.add('.' + c);
    }
    for (const m of s.matchAll(/[\w$]*[Ff]ab\.id\s*=\s*'([^']+)'/g)) t.add('#' + m[1]);
    return t;
  };

  const inert = [];
  for (const f of mounted) {
    const s = src(f);
    let sel = null;
    for (const m of own(s).matchAll(RULE)) {
      if (m[1].startsWith('.pk-fab')) continue;
      if (/--pk-slot:/.test(m[2])) { sel = m[1]; break; }
    }
    if (sel && !wornBy(s).has(sel)) inert.push(`${f} (${sel} is never worn)`);
  }
  check('...on a selector the button actually wears', inert, []);

  // The kit owns where the button goes, full stop. A tool that sets an inset in its
  // own rule wins on specificity and leaves the row without saying so — and because
  // the rest of the kit still applies, the button looks completely correct.
  const INSET = /(?:^|[;{\s])(?:top|left|right|bottom|inset)\s*:/;
  const strayed = [];
  for (const f of files) {
    for (const m of own(src(f)).matchAll(RULE)) {
      const [, sel, decls] = m;
      if (sel.startsWith('.pk-fab')) continue;   // that IS the kit
      if (INSET.test(decls)) strayed.push(`${f} (${sel})`);
    }
  }
  check('no tool takes an inset back in its own rule', strayed, []);

  // market-watch and people-watch place their own button, so an inline left/top lands
  // on it every mount and the kit's rule never gets the last word. They carry the row
  // in JS instead, and the two copies have to say the same thing — a drift here is a
  // button that sits one slot off, or 16px high, on two tools out of fifteen.
  const SELF_PLACED = ['market-watch.user.js', 'people-watch.user.js'];
  for (const f of SELF_PLACED) {
    const s = src(f);
    const m = s.match(
      /const HOME = \{ slot: (\d+), top: (\d+), floor: (\d+), half: (\d+), pitch: (\d+), edge: (\d+), row: (\d+) \};/);
    check(`${f} carries the row in JS`, !!m, true);
    if (!m) continue;
    const [slot, top, floor, half, pitch, edge, span] = m.slice(1).map(Number);
    check(`${f}: the JS row matches the CSS`,
      [top, floor, half, pitch, edge, span + edge], [TOP, FLOOR, HALF, PITCH, EDGE, SPAN]);
    const css = slotOf(s);
    check(`${f}: the JS slot matches its own --pk-slot`, slot, css);

    // And the width it measures against. This is the fault v8 was opened for: CSS
    // resolves 50% for a fixed element against the initial containing block, which
    // excludes the classic scrollbar, and window.innerWidth includes it. Both copies
    // read innerWidth, so both sat half a scrollbar right of the row they were
    // supposed to be joining. A text check is enough because there are exactly two
    // ways to spell the width and only one of them is the containing block.
    const rowExpr = s.slice(s.indexOf('const rowWidth = ()'), s.indexOf('const defaultFabPos'));
    check(`${f}: lays the row out against the containing block`,
      /document\.documentElement\.clientWidth/.test(rowExpr), true);
    const place = s.slice(s.indexOf('const defaultFabPos'), s.indexOf('const clampFab'));
    check(`${f}: ...and defaultFabPos reaches for that, never innerWidth`,
      /window\.innerWidth/.test(place) ? 'reads innerWidth' : 'clean', 'clean');
  }

  // Double-click is the ONLY way back into the row. Drag a button somewhere awkward
  // and the stored position wins forever after; without the handler the row is only
  // ever true on a profile that has never touched it. Six of these were missing it
  // when the row was introduced, which is how it stopped being a recovery path and
  // started being a thing you happened to know about market-watch.
  //
  // What it has to do is FORGET, not re-place. Storing defaultFabPos() looks like the
  // same gesture and is not: the row is a function of the viewport, so writing it
  // down pins the button to the window it was reset in, and the next resize or zoom
  // moves the fourteen CSS-placed buttons out from under it. Both self-placing tools
  // did exactly that, which is why the shape is checked and not just the presence.
  const stranded = [], sticky = [];
  for (const f of mounted) {
    const s = src(f);
    let ok = false;
    for (const m of s.matchAll(/[\w$]*[Ff]ab\.(?:addEventListener\('dblclick'|ondblclick\s*=)/g)) {
      const body = s.slice(m.index, m.index + 220);
      if (/\.reset\(\)|ui\.fab = (?:null|undefined)/.test(body)) ok = true;
      if (/ui\.fab = defaultFabPos\(\)/.test(body)) sticky.push(f);
    }
    if (!ok) stranded.push(f);
  }
  check('every button can be double-clicked back into its slot', stranded, []);
  check('...by forgetting where it was put, not by storing the row', sticky, []);
}

// ---------------------------------------------------------------------------
// Every helper a render path calls has to exist.
//
// market-watch shipped with `paintArmBar()` and `paintWrites()` still standing in
// its refresh(), three weeks after the order-execution seam they belonged to was
// deleted — docs/01-rules-envelope.md, "its arming switch and the write-capture
// that fed it are deleted". The deletion missed the two call sites. The first threw
// a ReferenceError inside the requestAnimationFrame callback, and nothing in there
// catches, so every paint queued behind it was skipped: the observed list, the
// rules list and the FAB state stopped repainting the moment the panel was built.
//
// It stayed invisible for three reasons, and they are why this check is here:
//   - the engine suites (test-harvest, test-sizing, test-views) slice the sampler
//     and the rule evaluator out of the file and never load the paint layer at all;
//   - the throw is inside a rAF callback, so it reaches no caller — the panel goes
//     quiet rather than visibly breaking;
//   - market-watch is the tool nobody opens.
// Only the first is a thing a test can fix. This is the cheapest fix for it: a bare
// call to a render-path helper must resolve to a definition in the same file. It is
// a string check and not a scope analysis, so it will not catch a helper defined in
// the wrong closure — but a name that is called and defined nowhere is exactly the
// shape of this bug, and exactly the shape a half-finished deletion leaves behind.
// ---------------------------------------------------------------------------
console.log('\n— every helper a render path calls exists —');
{
  const dir = path.join(__dirname, '..');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.user.js')).sort();

  // This repo's vocabulary for "redraw some part of the panel". Only bare calls —
  // the leading class excludes a dot, so a method on an object is nobody's business
  // here and cannot be resolved by reading one file anyway.
  const CALL = /(^|[^.\w$])((?:paint|render|redraw|draw|sync|resync|update)[A-Z][\w$]*)\s*\(/g;

  // The three shapes a helper is declared in across these files: a hoisted function,
  // an assigned const/let/var, or a name destructured out of a kit's return. Anything
  // else reads as missing and fails the build, which is the safe way to be wrong.
  const declares = (src, n) => new RegExp(
    String.raw`\bfunction\s+` + n + String.raw`\b`
    + '|' + String.raw`\b(?:const|let|var)\s+` + n + String.raw`\s*=`
    + '|' + String.raw`[{,]\s*` + n + String.raw`\s*[,}=:]`,
  ).test(src);

  const dangling = [];
  let seen = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const called = new Set();
    for (const m of src.matchAll(CALL)) called.add(m[2]);
    seen += called.size;
    for (const n of called) if (!declares(src, n)) dangling.push(`${f}: ${n}()`);
  }

  // A regex that quietly stops matching would pass this section by finding nothing,
  // so the count is asserted too — the same reason the row above derives its half.
  check('the scan is actually finding render calls', seen >= 25, true);
  check(`no render-path call goes nowhere (${seen} checked)`, dangling, []);
}


// ---------------------------------------------------------------------------
// Two tools writing one localStorage key is the quietest bug this repo can ship, and
// it shipped twice. Nothing throws — a panel merges its stored blob over its own
// defaults and ignores what it does not recognise — so the symptom never appears where
// the cause is. `pkpw:ui` was people-watch's and poll-watch's at once, `pksw:ui` was
// sleeper-watch's and shop-watch's, and the shared field in both cases was `fab`:
// dragging one tool's button moved another tool's on the next load. That is the exact
// collision FAB KIT's fixed slots exist to prevent, arriving through the back door.
//
// So the key names are read out of every shipped tool and two owners is a build
// failure. Reads are not the problem and are not checked — time-bridge reads
// `pktw:samples` on purpose, which is the entire reason that tool exists — so the one
// deliberate share is named below the way the placement exceptions are.
// ---------------------------------------------------------------------------
console.log('\n— no two tools write the same storage key —');
{
  const dir = path.join(__dirname, '..');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.user.js')).sort();

  // key -> the tools allowed to name it together, and why.
  const SHARED = {
    'pktw:samples': ['time-bridge.user.js', 'time-watch.user.js'],  // the bridge only reads it
  };

  const owners = new Map();
  const migrating = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
    // A tool moving off a prefix still names the old keys, in one `const OLD = {...}`
    // holder. Those are keys it reads once and abandons, not keys it writes, so the
    // holder is cut out and scanned separately.
    //
    // Cut out, not filtered by value: excluding every literal that MATCHES something in
    // the holder would let a tool name one key in both places and vanish from the
    // ownership count altogether — which is to say it would hide the exact bug this
    // section exists to catch. Position is what tells the two apart, not spelling.
    const RE = /['"`](pk[a-z]{2,4}:[a-zA-Z0-9_.-]+)['"`]/g;
    const holder = /const OLD = \{[^}]*\}/g;
    for (const m of (code.match(holder) || []).join(' ').matchAll(RE)) migrating.push([f, m[1]]);
    for (const m of code.replace(holder, '').matchAll(RE)) {
      if (!owners.has(m[1])) owners.set(m[1], new Set());
      owners.get(m[1]).add(f);
    }
  }

  const clashes = [...owners.entries()]
    .filter(([k, set]) => set.size > 1)
    .filter(([k, set]) => {
      const allowed = SHARED[k];
      return !allowed || [...set].sort().join() !== allowed.slice().sort().join();
    })
    .map(([k, set]) => `${k} <- ${[...set].sort().join(' + ')}`);
  check('no key has two owners', clashes, []);

  // A regex that quietly stopped matching would pass the row above by finding nothing.
  check('the scan is actually finding keys', owners.size >= 30, true);

  // The other half of a migration: the key a tool is moving off may still belong to a
  // live sibling, and the sibling is exactly who this fence is protecting. So a tool is
  // allowed to name an old key only while some OTHER tool is not the one that owns it,
  // or — where it is — only to read it. Deleting a key another tool writes is the same
  // bug pointing the other way, and it would be silent in precisely the same manner.
  const unsafe = [];
  for (const [f, key] of migrating) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const holder = (src.match(/const OLD = \{([^}]*)\}/) || [, ''])[1];
    // The holder is one flat object literal, so the field name is what sits before
    // the first colon of the entry naming this key.
    const field = (holder.split(',').find((p) => p.includes(key)) || '').split(':')[0].trim();
    const removed = field && new RegExp(`removeItem\\(\\s*OLD\\.${field}\\b`).test(src);
    const alsoOwned = owners.has(key) && owners.get(key).size > 0;
    if (removed && alsoOwned) unsafe.push(`${f} deletes ${key}, still written by ${[...owners.get(key)].join(' + ')}`);
  }
  check('no migration deletes a key another tool still writes', unsafe, []);
}
console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
