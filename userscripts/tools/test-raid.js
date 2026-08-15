// Slices raid-watch's ingest and digest layers out of the shipped file and drives them
// against synthetic poll payloads.
//
// The thing under test is idempotence. The faction page re-fetches the same raid list
// every five seconds for as long as it is open, so every ingest path sees the same rows
// dozens of times over. A dedupe that leaks turns a twenty-minute war into thousands of
// phantom events and a score curve that is really a clock.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'raid-watch.user.js'), 'utf8');

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from} .. ${to}`);
  return SRC.slice(i, j);
};

// Ingest and derive, with the tap cut out from between them — the tap wraps
// window.fetch and window.XMLHttpRequest, which do not exist here and are the fence's
// job anyway (tools/test-raid-passive.js). Nothing in either half runs at definition
// time, so concatenating them out of order is safe.
const SLICE = cut('  const num = (v) =>', '  // ===========================================================================\n  // Passive tap')
  + cut('  const ms = (iso) =>', '  // ===========================================================================\n  // PANEL KIT v1');

/** The slice closes over module state and `paint`/`save`; inject inert versions. */
const mk = (raids = {}, events = {}, reports = {}) => {
  const CFG = { MAX_EVENTS: 4000, MAX_SAMPLES: 3000 };
  const api = new Function('raids', 'events', 'reports', 'CFG', 'save', 'paint', 'log',
    `${SLICE}\nreturn { ingestRaidsPoll, ingestReport, ingestRaid, ingestEvent, typeDigest, actorBoard, curveOf, raidList, eventList, trimEvents };`
  )(raids, events, reports, CFG, () => {}, () => {}, () => {});
  return { ...api, raids, events, reports };
};

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

const raid = (over = {}) => ({
  id: 7, status: 'active',
  attacker_faction_id: 1, attacker_faction_name: 'Us', defender_faction_name: 'RE:PUBLIC',
  attacker_score: 100, defender_score: 80,
  attacker_members: 4, defender_members: 6,
  attacker_power_taken: 10, defender_power_taken: 25,
  committed_power: 500, committed_cash: 1000, cycle_month: 'September',
  created_at: '2026-08-14T10:00:00Z', last_scored_at: '2026-08-14T10:05:00Z',
  ...over,
});
const ev = (id, over = {}) => ({
  id, event_type: 'raid_hit', actor_username: 'ana', target_username: 'bo',
  score_delta: 5, power_delta: -2, created_at: '2026-08-14T10:01:00Z', ...over,
});

console.log('\n— the five-second poll must not accumulate —');
{
  const m = mk();
  const payload = { raids: [raid()], events: [ev(1), ev(2)] };
  for (let i = 0; i < 12; i++) m.ingestRaidsPoll('/api/factions/1/raids', payload);

  check('one raid, however many polls', Object.keys(m.raids).length, 1);
  check('events dedupe by id', Object.keys(m.events).length, 2);
  check('an unchanged score records one sample, not twelve', m.raids['7'].samples.length, 1);
}

console.log('\n— a sample is a score CHANGE, not a poll —');
{
  const m = mk();
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid({ attacker_score: 100, defender_score: 80 })] });
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid({ attacker_score: 100, defender_score: 80 })] });
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid({ attacker_score: 110, defender_score: 80 })] });
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid({ attacker_score: 110, defender_score: 95 })] });
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid({ attacker_score: 110, defender_score: 95 })] });

  const s = m.raids['7'].samples;
  check('three distinct scorelines, three samples', s.length, 3);
  check('...in order', s.map((p) => `${p.a}-${p.d}`), ['100-80', '110-80', '110-95']);
  check('the raid carries the latest score', [m.raids['7'].attacker_score, m.raids['7'].defender_score], [110, 95]);
}

console.log('\n— an absent field must not erase what we already knew —');
{
  const m = mk();
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid()] });
  // a later payload that simply omits membership and commitment
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [{ id: 7, status: 'surrender_requested', attacker_score: 120, defender_score: 95 }] });

  const r = m.raids['7'];
  check('status advances', r.status, 'surrender_requested');
  check('faction names survive an omission', [r.attacker_faction_name, r.defender_faction_name], ['Us', 'RE:PUBLIC']);
  check('committed power survives', r.committed_power, 500);
  check('cycle survives', r.cycle_month, 'September');
}

console.log('\n— the event-type digest, which is the whole point —');
{
  const m = mk();
  m.ingestRaidsPoll('/api/f/1/raids', {
    events: [
      ev(1, { event_type: 'raid_hit', score_delta: 5, power_delta: -2, actor_username: 'ana' }),
      ev(2, { event_type: 'raid_hit', score_delta: 7, power_delta: -3, actor_username: 'bo' }),
      ev(3, { event_type: 'raid_hit', score_delta: 0, power_delta: 0, actor_username: 'ana' }),
      ev(4, { event_type: 'flag_imposed', score_delta: 0, power_delta: 0, actor_username: 'cy' }),
    ],
  });
  const d = m.typeDigest();
  check('types ranked by frequency', d.map((g) => g.type), ['raid_hit', 'flag_imposed']);
  check('score sums per type', d[0].score, 12);
  check('power sums per type', d[0].power, -5);
  check('scoring counts only non-zero deltas', [d[0].scored, d[0].n], [2, 3]);
  check('distinct actors are counted, not summed', d[0].actors, 2);
  check('a zero-delta type still appears', d[1].type, 'flag_imposed');

  const who = m.actorBoard();
  check('the board ranks by score contributed', who.map((w) => w.name), ['bo', 'ana', 'cy']);
  check('...and counts actions separately from score', [who[1].n, who[1].score], [2, 5]);
}

console.log('\n— an event with no id cannot be recorded —');
{
  const m = mk();
  // React keys the log by e.id, so an id is expected; without one there is no way to
  // dedupe and a poll would multiply it forever. Dropping it is the safe failure.
  check('no id, no record', m.ingestEvent({ event_type: 'x' }), false);
  check('...and nothing was stored', Object.keys(m.events).length, 0);
}

console.log('\n— the report is authoritative where our sampling is not —');
{
  const m = mk();
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid({ attacker_score: 100, defender_score: 80 })] });
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid({ attacker_score: 110, defender_score: 90 })] });
  check('sampled curve is used before a report exists', m.curveOf(m.raids['7']).source, 'sampled');

  m.ingestReport('/api/factions/1/raids/7/report', {
    id: 7, ...raid(), status: 'resolved',
    score_history: [
      { created_at: '2026-08-14T10:00:00Z', attacker_score: 0, defender_score: 0 },
      { created_at: '2026-08-14T10:02:00Z', attacker_score: 60, defender_score: 40 },
      { created_at: '2026-08-14T10:05:00Z', attacker_score: 120, defender_score: 95 },
    ],
    events: [ev(9, { event_type: 'raid_resolved', score_delta: 0 })],
  });

  const c = m.curveOf(m.raids['7']);
  check('the report wins once captured', c.source, 'report');
  check('...with the server\'s own points', c.points.length, 3);
  check('the report also updates the raid', m.raids['7'].status, 'resolved');
  check('...and contributes its events', !!m.events['9'], true);
}

console.log('\n— one reading is not a curve —');
{
  const m = mk();
  m.ingestRaidsPoll('/api/f/1/raids', { raids: [raid()] });
  const c = m.curveOf(m.raids['7']);
  check('a single sample is labelled, not drawn as a line', c.source, 'single');
  check('...and carries exactly one point', c.points.length, 1);
  check('an unknown raid yields nothing', m.curveOf(null).source, 'none');
}

console.log('\n— the report id can come from the URL when the body omits it —');
{
  const m = mk();
  m.ingestReport('/api/factions/3/raids/42/report', { score_history: [], events: [] });
  check('keyed off the URL', Object.keys(m.reports), ['42']);
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
