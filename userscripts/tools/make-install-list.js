// Regenerates userscripts/INSTALL.md — the paste-ready list of install links.
//
// Name, version, link and row position are read back out of the scripts themselves,
// so the list cannot drift from the headers the way a hand-kept table does. The
// button word and the one-line blurb are the hand-written part, and a tool missing
// from that table is a hard error rather than a blank cell.
//
// It also asks git what actually exists on origin/main. A raw.githubusercontent.com
// link serves the pushed file, so a tool that is only committed locally is a 404 and
// a tool that is pushed but since edited serves the old version. Neither belongs in
// something you paste into a faction Discord, so both are held out of the paste
// blocks and reported instead.
//
//   node userscripts/tools/make-install-list.js
//
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..');
const ROOT = path.join(DIR, '..');
const OUT = path.join(DIR, 'INSTALL.md');
const RAW = 'https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts';
const DISCORD_LIMIT = 2000;
const PACK_TO = 1900; // headroom under Discord's limit for the "1/2" label

// The hand-written half. `word` is the button's label — null for the two tools that
// draw no button — and `blurb` rides next to a 100-char URL in a message with a hard
// character limit, so keep it short. A tool missing from here is a hard error.
//
// The words are not parsed out of the scripts because each tool mounts its button a
// little differently (el()'s third argument, className, textContent), and a parser
// covering all of them would be guessing. Whether the row itself is coherent is
// test-placement.js's job, not this file's.
const TOOLS = {
  'people-watch': { word: '(eye)', blurb: "who you've seen: last-online, city, rank, least-active first" },
  'align-watch': { word: 'ALGN', blurb: 'your political compass on the home page, with a change log' },
  'gov-watch': { word: 'GOV', blurb: 'change ledger for the government: what moved between readings' },
  'quick-jump': { word: 'JUMP', blurb: "launcher for the 64 screens the sidebar can't reach" },
  'market-watch': { word: 'MKT', blurb: 'charts market series locally and fires threshold alerts' },
  'raid-watch': { word: 'RAID', blurb: 'records faction raids, their event log and post-mortems' },
  'sleeper-watch': { word: 'SLP', blurb: 'keeps sleeper-recruitment timers running after you leave' },
  'ws-watch': { word: 'SOCK', blurb: 'read-only observer for the three sockets the game opens' },
  'time-watch': { word: 'TIME', blurb: 'real to game clock, month schedule, next-registration countdown' },
  'world-watch': { word: 'WRLD', blurb: 'plots law, opinion, street, media and citizens on one compass' },
  'xp-watch': { word: 'XP', blurb: 'ledger of your own stat and skill changes, action by action' },
  'poll-watch': { word: 'POLL', blurb: 'keeps every opinion-poll memo, with bloc spread and trends' },
  'shop-watch': { word: 'SHOP', blurb: 'shop fields the UI never shows, and brackets every restock' },
  'bar-watch': { word: 'BARS', blurb: 'time to full for Energy, Juice and HP, with alerts you set' },
  'slot-watch': { word: 'SLOT', blurb: 'slots bankroll against the house edge, and what a run really costs' },
  'jack-watch': { word: 'JACK', blurb: 'blackjack solved: the right play, the chances, the count, the money' },
  'comms-move': { word: null, blurb: "adds a drag bar to the game's Comms dock so you can move it" },
  'time-bridge': { word: null, blurb: "hands Time Watch's clock anchor to the Time Wire planner" },
};

const meta = (src, key) => {
  const m = src.match(new RegExp('^// @' + key + '\\s+(.+?)\\s*$', 'm'));
  return m ? m[1] : null;
};

// Slot extraction, same as test-placement.js does it: skip past the FAB KIT comment
// block (which contains a worked example that would otherwise match), then take the
// first fab rule that is not the kit's own `.pk-fab`.
const RULE = /^[ \t]*([#.][\w.:#-]*fab[\w.:#-]*)[ \t]*\{([^}]*)\}/gim;
const KIT_END = '    .pk-fab svg { width: 24px; height: 24px; display: block; }';
const slotOf = (src) => {
  const i = src.indexOf(KIT_END);
  const own = i < 0 ? src : src.slice(i + KIT_END.length);
  for (const m of own.matchAll(RULE)) {
    if (m[1].startsWith('.pk-fab')) continue; // that IS the kit
    const d = m[2].match(/--pk-slot:\s*(\d+)/);
    if (d) return Number(d[1]);
  }
  return null;
};

// What origin/main actually serves. An unfetched or missing remote is not fatal —
// the list still generates, it just cannot vouch for the links.
let live = null;
try {
  const tree = execFileSync('git', ['ls-tree', '-r', 'origin/main', '--', 'userscripts/'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const found = new Map();
  for (const line of tree.split('\n')) {
    const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (m) found.set(path.basename(m[2]), m[1]);
  }
  // An empty tree means the ref or the pathspec did not resolve, not that the
  // directory is empty. Reporting every tool as unpushed would be worse than
  // reporting that the check could not run at all.
  live = found.size ? found : null;
} catch {
  live = null;
}

const hashOf = (file) => {
  try {
    return execFileSync('git', ['hash-object', file], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const tools = [];
const notes = [];
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.user.js') && f !== '_template.user.js');
for (const file of files) {
  const base = file.replace(/\.user\.js$/, '');
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  const hand = TOOLS[base];
  if (!hand) {
    console.error('\n  ' + base + ' is not in TOOLS in ' + path.basename(__filename) +
      '.\n  Add a word (or null) and a one-line blurb, then re-run.\n');
    process.exit(1);
  }
  const name = (meta(src, 'name') || base).replace(/^Politiko\s*[—-]\s*/, '');
  const slot = slotOf(src);
  // The row is test-placement.js's to enforce, but a tool whose button is not where
  // this list says it is makes the list wrong too, so say so rather than print a dash.
  if (hand.word && slot === null) notes.push(name + ' has a button but declares no `--pk-slot`, so it does not sit in the row.');
  if (!hand.word && slot !== null) notes.push(name + ' claims slot ' + slot + ' but is listed here as drawing no button.');
  let state = 'unknown';
  if (live) {
    if (!live.has(file)) state = 'unpushed';
    else if (live.get(file) !== hashOf(path.join(DIR, file))) state = 'stale';
    else state = 'live';
  }
  tools.push({
    base,
    file,
    name,
    state,
    slot,
    version: meta(src, 'version') || '?',
    word: hand.word,
    blurb: hand.blurb,
    url: RAW + '/' + file,
  });
}

// Screen order: the row left to right, then the tools that draw no button.
tools.sort((a, b) => {
  if (a.slot === null && b.slot === null) return a.name.localeCompare(b.name);
  if (a.slot === null) return 1;
  if (b.slot === null) return -1;
  return a.slot - b.slot;
});

// people-watch's button is the eye of providence rather than a word, so there is no
// label to lead with — the parenthesised entry in TOOLS is a description of it.
const worded = (t) => t.word && !t.word.startsWith('(');
const label = (t) => (worded(t) ? t.word + ' — ' + t.name : t.name);
const entry = (t) => '**' + label(t) + '** · ' + t.blurb + '\n<' + t.url + '>';

// Pack the postable tools into messages that fit, rather than picking a split that
// stops fitting the first time a tool is added.
const postable = tools.filter((t) => t.state === 'live' || t.state === 'unknown');
const held = tools.filter((t) => t.state === 'unpushed' || t.state === 'stale');

const chunks = [];
for (const t of postable) {
  const e = entry(t);
  const last = chunks[chunks.length - 1];
  if (last && last.len + e.length + 2 <= PACK_TO) {
    last.parts.push(e);
    last.len += e.length + 2;
  } else {
    chunks.push({ parts: [e], len: e.length + 320 }); // 320 ~ the header and footer lines
  }
}

const messages = chunks.map((c, i) => {
  const head =
    chunks.length > 1
      ? '## Politiko userscripts — install links (' + (i + 1) + '/' + chunks.length + ')'
      : '## Politiko userscripts — install links';
  const tail =
    i === chunks.length - 1
      ? '\n\nInstall Tampermonkey first, then click a link and confirm the prompt. Every one of these is passive: it reads what the game already sent your browser and originates no requests of its own. Source for all of them: <https://github.com/dataterminals/politiko-research/tree/main/userscripts>'
      : '';
  return head + '\n\n' + c.parts.join('\n\n') + tail;
});

const row = (t) =>
  '| ' + (t.slot === null ? '—' : t.slot) +
  ' | ' + (worded(t) ? '`' + t.word + '`' : t.word || '—') +
  ' | ' + t.name +
  ' | ' + t.version +
  ' | ' + t.blurb +
  ' | [`' + t.file + '`](' + t.url + ') |';

let md = '';
md += '# Install links\n\n';
md += 'Paste-ready list of every installable tool in this directory. **Generated** — run\n';
md += '`node userscripts/tools/make-install-list.js` after any version bump or new tool\n';
md += 'rather than editing this file, and push before you post: these are\n';
md += '`raw.githubusercontent.com` links, so they serve whatever is on `origin/main`.\n\n';
md += 'Tools are listed in the order their buttons sit on screen, left to right.\n\n';
md += '## How to install\n\n';
md += '1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).\n';
md += '2. Click a raw link below and confirm the install prompt.\n';
md += '3. Reload politiko.io. Buttons land in one row above the header rule; drag any of\n';
md += '   them anywhere, double-click one to send it home.\n\n';
md += "Each script declares `@updateURL`, so fixes arrive on your script manager's own\n";
md += 'update check — no reinstall.\n\n';

if (held.length) {
  md += '> [!WARNING]\n';
  md += '> Held out of the paste blocks below — these links do not serve current code yet:\n';
  for (const t of held) {
    md += '> - **' + t.name + ' ' + t.version + '** — ' +
      (t.state === 'unpushed'
        ? 'committed locally but not on `origin/main`; the raw link 404s.'
        : 'local file differs from `origin/main`; the raw link serves the older version.') + '\n';
  }
  md += '>\n> Push, re-run the generator, then post.\n\n';
}
if (live === null) {
  md += '> [!NOTE]\n';
  md += '> `origin/main` was not readable when this ran, so no link below was checked\n';
  md += '> against what the remote actually serves.\n\n';
}
if (notes.length) {
  md += '> [!NOTE]\n';
  md += '> The row and this list disagree — `node userscripts/tools/test-placement.js` has the detail:\n';
  for (const n of notes) md += '> - ' + n + '\n';
  md += '\n';
}

md += '## Discord paste\n\n';
md += "Discord's message limit is " + DISCORD_LIMIT + ' characters, so this is split into ' +
  (messages.length === 1 ? 'one message' : messages.length + ' messages') + '. Copy each block and post ' +
  (messages.length === 1 ? 'it' : 'them in order') + '.\n\n';

messages.forEach((m, i) => {
  md += '**Message ' + (i + 1) + ' of ' + messages.length + '** — ' + m.length + ' characters\n\n';
  md += '```\n' + m + '\n```\n\n';
});

md += '## Full list\n\n';
md += '| slot | button | tool | version | what it does | raw link |\n';
md += '|---|---|---|---|---|---|\n';
md += tools.map(row).join('\n') + '\n\n';
md += '`_template.user.js` is not installable — it is the skeleton the others were built\n';
md += 'from, and the home of the shared `PANEL KIT` and `FAB KIT` blocks.\n\n';
md += 'Slots are fixed rather than packed: a tool you do not have leaves its slot empty, and\n';
md += 'installing a new one never shuffles the buttons you already know by position.\n';

fs.writeFileSync(OUT, md);

const over = messages.filter((m) => m.length > DISCORD_LIMIT);
console.log('\n  wrote ' + path.relative(process.cwd(), OUT));
console.log('  ' + tools.length + ' tools · ' + postable.length + ' postable · ' +
  messages.length + ' message(s) [' + messages.map((m) => m.length).join(', ') + ' chars]');
for (const t of held) console.log('  HELD  ' + t.name + ' ' + t.version + ' — ' + t.state);
for (const n of notes) console.log('  NOTE  ' + n);
if (over.length) {
  console.error('  FAIL  ' + over.length + ' message(s) over ' + DISCORD_LIMIT + ' chars');
  process.exit(1);
}
console.log('');
