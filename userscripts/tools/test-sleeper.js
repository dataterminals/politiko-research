// Slices sleeper-watch's state machine, ingest and derive layers out of the shipped
// file and drives them against synthetic recruitment payloads.
//
// Two things are actually under test.
//
// The first is that the state machine is a faithful mirror of the client's own. The
// tool's whole value is pointing you at a card whose button is live, so a disagreement
// with SleeperRecruitmentPage is not a cosmetic bug — it would send you to a greyed-out
// action, or worse, stay quiet through the one hour a lead was workable.
//
// The second is that absence is read correctly. The recruitment screen re-fetches the
// whole lead list every 30 seconds, so a lead that stops appearing has ENDED, and the
// difference between "ended while its window was open" and "ended after expiring" is
// the only evidence this surface ever gives up about what converts a lead. Get the
// idempotence wrong and every poll invents an ending.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'sleeper-watch.user.js'), 'utf8');

const cut = (from, to) => {
  const i = SRC.indexOf(from), j = SRC.indexOf(to);
  if (i < 0 || j < 0 || j <= i) throw new Error(`markers not found: ${from} .. ${to}`);
  return SRC.slice(i, j);
};

// Time + state machine + ingest, then the derive layer, with the tap cut out from
// between them — the tap wraps window.fetch and XMLHttpRequest, which do not exist here
// and are the fence's job anyway (tools/test-sleeper-passive.js). Nothing in either half
// runs at definition time, so concatenating them across the gap is safe.
const SLICE = cut('  const ms = (iso) =>', '  // ===========================================================================\n  // Passive tap')
  + cut('  const liveLeads = () =>', '  // ===========================================================================\n  // Jump —');

/**
 * The slice closes over module state and over paint/save; inject inert versions. `meta`
 * is reassigned wholesale inside ingestRecruitment, so it comes back through a getter
 * rather than by reference.
 */
const mk = (opts = {}) => {
  const leads = opts.leads || {};
  const sleepers = opts.sleepers || {};
  const ledger = opts.ledger || [];
  const meta = opts.meta || {};
  const ui = Object.assign({ facTier: true, muted: {} }, opts.ui);
  const CFG = { MAX_LEDGER: 500 };
  // readSelectedIssue reads the page's own <select>; here it reads whatever the test says
  // is showing in it.
  const doc = {
    querySelectorAll: () => (opts.selected ? [{ value: opts.selected }] : []),
  };
  const loc = { pathname: opts.pathname || '/actions/sleeper-recruitment' };

  // RECRUIT_PATH is declared above the slice, in the config block. It has to be injected
  // rather than left out: readSelectedIssue reads it inside a best-effort try/catch, so a
  // missing binding would be swallowed as a ReferenceError and the issue capture would
  // look merely empty instead of broken.
  const api = new Function(
    'leads', 'sleepers', 'ledger', 'meta', 'ui', 'CFG', 'RECRUIT_PATH',
    'save', 'saveUi', 'paint', 'log', 'document', 'location',
    `${SLICE}\nreturn { isPast, canAct, leadState, leadTimer, facReady, fmtLeft,
       pressPreview, missedInHour, planText,
       ingestRecruitment, ingestFactionSleepers, ingestMeet, ingestSleeper, readSelectedIssue,
       liveLeads, sortedLeads, facSleepers, board, sweepMissed, issueDigest, endDigest,
       unackedMissed, ackMissed, ackBacklogOnce,
       getMeta: () => meta };`,
  )(leads, sleepers, ledger, meta, ui, CFG, '/actions/sleeper-recruitment',
    () => {}, () => {}, () => {}, () => {}, doc, loc);

  return { ...api, leads, sleepers, ledger, ui };
};

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
  if (!ok) { console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); fail++; }
};

const iso = (deltaMs) => new Date(Date.now() + deltaMs).toISOString();
const MIN = 60_000, HOUR = 60 * MIN;

const lead = (over = {}) => ({
  id: 1, display_name: 'Ariel Voss', archetype_name: 'Staffer', site_name: 'City Hall',
  issue: 'Housing', traits: { clue: 'Housing' }, status: 'meeting',
  next_meeting_at: iso(24 * HOUR), expires_at: iso(25 * HOUR), meeting_count: 1,
  ...over,
});

const payload = (leads, over = {}) => ({
  districts: [{ name: 'Downtown', sites: [{ id: 1, name: 'City Hall' }, { id: 2, name: 'Precinct' }] }],
  issues: ['Housing', 'Crime', 'Jobs'],
  leads, sleepers: [],
  faction_name: 'Us', location_name: 'Miami', window_minutes: 60,
  recruited_count: 2, sleeper_cap: 5, energy_cost: 10,
  ...over,
});

// ---------------------------------------------------------------------------
console.log('\n— the state machine mirrors the client, badge for badge —');
{
  const m = mk();
  const S = (over) => m.leadState(lead(over));

  check('status "lead" is a new lead, whatever the timestamps say',
    S({ status: 'lead', next_meeting_at: iso(HOUR), expires_at: iso(2 * HOUR) }), 'new');
  check('before the appointment: waiting',
    S({ next_meeting_at: iso(HOUR), expires_at: iso(2 * HOUR) }), 'waiting');
  check('inside the window: open',
    S({ next_meeting_at: iso(-10 * MIN), expires_at: iso(50 * MIN) }), 'open');
  check('past the window: missed',
    S({ next_meeting_at: iso(-2 * HOUR), expires_at: iso(-HOUR) }), 'missed');

  // canAct requires BOTH timestamps — the client's own && chain. A lead carrying only
  // one of them is not workable, and calling it open would point at a dead button.
  check('a meeting with no expiry never reads as open',
    S({ next_meeting_at: iso(-10 * MIN), expires_at: null }), 'unknown');
  check('a meeting with no appointment is not workable either',
    S({ next_meeting_at: null, expires_at: iso(HOUR) }), 'unknown');

  check('canAct agrees with the open state',
    m.canAct(lead({ next_meeting_at: iso(-MIN), expires_at: iso(MIN) })), true);
  check('...and refuses one minute past expiry',
    m.canAct(lead({ next_meeting_at: iso(-2 * HOUR), expires_at: iso(-MIN) })), false);
}

console.log('\n— the countdown points at the right instant —');
{
  const m = mk();
  const waiting = m.leadTimer(lead({ next_meeting_at: iso(2 * HOUR), expires_at: iso(3 * HOUR) }));
  check('while waiting it counts to the appointment', waiting.to, 'opens');
  check('...and is about two hours', Math.round(waiting.left / MIN), 120);

  const open = m.leadTimer(lead({ next_meeting_at: iso(-20 * MIN), expires_at: iso(40 * MIN) }));
  check('once open it counts to the CLOSE, not the open', open.to, 'closes');
  check('...and is about forty minutes', Math.round(open.left / MIN), 40);

  check('a missed lead counts to nothing',
    m.leadTimer(lead({ next_meeting_at: iso(-3 * HOUR), expires_at: iso(-2 * HOUR) })).to, null);
}

console.log('\n— the 30-second poll must not accumulate —');
{
  const m = mk();
  const p = payload([lead(), lead({ id: 2, display_name: 'Dov Mena' })]);
  for (let i = 0; i < 20; i++) m.ingestRecruitment(p);

  check('two leads, however many polls', Object.keys(m.leads).length, 2);
  check('no lead is marked gone while it is still being sent',
    Object.values(m.leads).filter((l) => l.gone).length, 0);
  check('nothing was written to the ledger', m.ledger.length, 0);
  check('the header is captured', [m.getMeta().sleeper_cap, m.getMeta().energy_cost], [5, 10]);
  check('sites are counted across districts', m.getMeta().sites, 2);
}

console.log('\n— absence is a reading, and it is recorded once —');
{
  const m = mk();
  m.ingestRecruitment(payload([lead(), lead({ id: 2 })]));
  // lead 2 vanishes while its window was open: the shape of a conversion
  m.leads['2'].next_meeting_at = iso(-10 * MIN);
  m.leads['2'].expires_at = iso(20 * MIN);
  m.ingestRecruitment(payload([lead()]));

  check('the missing lead is marked gone', m.leads['2'].gone, true);
  check('...with the state it was last in', m.leads['2'].goneState, 'open');
  check('...and one ledger row', m.ledger.filter((r) => r.kind === 'end').length, 1);

  for (let i = 0; i < 5; i++) m.ingestRecruitment(payload([lead()]));
  check('further polls do not re-record it', m.ledger.filter((r) => r.kind === 'end').length, 1);
  check('the surviving lead is untouched', m.leads['1'].gone, false);
  check('liveLeads excludes the departed', m.liveLeads().length, 1);
}

console.log('\n— a lead that expired unworked ends as missed, not as a conversion —');
{
  const m = mk();
  m.ingestRecruitment(payload([lead({ next_meeting_at: iso(-3 * HOUR), expires_at: iso(-2 * HOUR) })]));
  m.ingestRecruitment(payload([]));
  check('gone state is missed', m.leads['1'].goneState, 'missed');
  check('the ending digest buckets it', m.endDigest().missed.n, 1);
  check('...with the meeting count it died on', m.endDigest().missed.meetings, [1]);
}

console.log('\n— a fresh appointment clears what was already said about the old one —');
{
  const m = mk();
  const old = lead({ next_meeting_at: iso(-3 * HOUR), expires_at: iso(-2 * HOUR) });
  m.ingestRecruitment(payload([old]));
  m.sweepMissed();
  check('the miss is announced once', m.leads['1'].announcedMissed, true);
  check('...and not twice', m.sweepMissed().length, 0);

  m.ui.muted[`lead:1:${old.expires_at}`] = 1;
  m.ingestRecruitment(payload([lead({ next_meeting_at: iso(HOUR), expires_at: iso(2 * HOUR) })]));
  check('a new appointment reopens the announcement', m.leads['1'].announcedMissed, false);
  check('...and drops the stale mute', Object.keys(m.ui.muted).length, 0);
}

console.log('\n— urgency order: what you can do now, closing soonest, first —');
{
  const m = mk();
  m.ingestRecruitment(payload([
    lead({ id: 1, display_name: 'waiting', next_meeting_at: iso(6 * HOUR), expires_at: iso(7 * HOUR) }),
    lead({ id: 2, display_name: 'open-late', next_meeting_at: iso(-5 * MIN), expires_at: iso(55 * MIN) }),
    lead({ id: 3, display_name: 'fresh', status: 'lead', next_meeting_at: null, expires_at: null }),
    lead({ id: 4, display_name: 'open-soon', next_meeting_at: iso(-50 * MIN), expires_at: iso(10 * MIN) }),
    lead({ id: 5, display_name: 'missed', next_meeting_at: iso(-3 * HOUR), expires_at: iso(-2 * HOUR) }),
  ]));

  check('open closes-soonest first, then new, then waiting, then missed',
    m.sortedLeads().map((r) => r.l.display_name),
    ['open-soon', 'open-late', 'fresh', 'waiting', 'missed']);

  const b = m.board();
  check('the board splits them', [b.open.length, b.fresh.length, b.waiting.length, b.missed.length], [2, 1, 1, 1]);
  check('the next thing to open is the waiting one', b.next.l.display_name, 'waiting');
}

console.log('\n— the two sleeper sources merge onto one row —');
{
  const m = mk();
  // the recruitment page knows where it came from
  m.ingestRecruitment(payload([], {
    sleepers: [{ id: 9, display_name: 'Ines Roth', site_name: 'Precinct', effectiveness: 62, issue: 'Crime' }],
  }));
  check('recruited sleeper recorded', Object.keys(m.sleepers).length, 1);
  check('...but with no cooldown reading yet', m.sleepers['9'].facSeen, undefined);

  // the faction panel knows when it can act again
  m.ingestFactionSleepers('/api/factions/42/sleepers', [
    { id: 9, display_name: 'Ines Roth', effectiveness: 62, recruiter_username: 'dataterminals', can_advocate_at: iso(-MIN), can_embezzle_at: iso(30 * MIN) },
  ]);

  check('still one row, not two', Object.keys(m.sleepers).length, 1);
  check('the site survives from the recruitment side', m.sleepers['9'].site_name, 'Precinct');
  check('the cooldowns arrive from the faction side', m.facSleepers().length, 1);
  check('the faction id is remembered for the jump', m.getMeta().factionId, '42');

  check('a past cooldown is ready', m.facReady(m.sleepers['9'].can_advocate_at), true);
  check('a future one is not', m.facReady(m.sleepers['9'].can_embezzle_at), false);
  check('a null cooldown is ready — the client treats it the same way', m.facReady(null), true);

  const b = m.board();
  check('the board offers the advocate, not the embezzle', [b.adv.length, b.emb.length], [1, 0]);
}

// ---------------------------------------------------------------------------
// Embezzle is a number, not an event.
//
// It siphons a few thousand dollars out of the faction and takes it out of that
// sleeper's own effectiveness, so "you may now embezzle" is not news — it is pocket
// change offered for a permanently worse asset, and the standing answer is no
// (operator, 2026-09-16). The cooldown is still tracked and still counted down in the
// Sleepers tab, because the reading is worth having and what drives it is still an open
// question. What it may not do is raise the strip or light the button.
//
// Fenced here because the difference is one filter away, and because the same edit has a
// second half the board cannot show: the mute key. While the embezzle timestamp was part
// of it, any faction poll that moved that cooldown minted a new key and re-raised an
// advocate strip you had already dismissed, for a readiness that had not changed.
// ---------------------------------------------------------------------------
console.log('\n— an embezzle cooldown is counted down, never announced —');
{
  const m = mk();
  m.ingestFactionSleepers('/api/factions/42/sleepers', [
    { id: 9, display_name: 'Ines Roth', can_advocate_at: iso(30 * MIN), can_embezzle_at: iso(-MIN) },
  ]);
  const b = m.board();
  check('a sleeper that can only embezzle is nothing to announce', b.adv.length, 0);
  check('...but the reading is still kept for the table', b.emb.length, 1);

  // The `faction tier` option gates the ANNOUNCEMENT, not the reading. The Sleepers tab
  // draws both columns whatever the option says, and signature() has to see them flip or
  // a column sits at a dead countdown instead of repainting to `ready`.
  const off = mk({ ui: { facTier: false } });
  off.ingestFactionSleepers('/api/factions/42/sleepers', [
    { id: 9, display_name: 'Ines Roth', can_advocate_at: iso(-MIN), can_embezzle_at: iso(-MIN) },
  ]);
  check('the option does not reach the board', [off.board().adv.length, off.board().emb.length], [1, 1]);

  // Source-level, because the strip and the button are outside the slice. Both live
  // between stripEvent() and signature(), and both must still ask the option.
  const surface = SRC.slice(SRC.indexOf('const stripEvent'), SRC.indexOf('const signature'));
  check('nothing in the strip or the button counts an embezzle', /b\.emb/.test(surface), false);
  check('...and both still ask the faction-tier option first', (surface.match(/ui\.facTier/g) || []).length, 2);

  const facKeys = [...new Set(SRC.match(/`fac:[^`]*`/g) || [])];
  check('every fac: mute key is the advocate timestamp alone', facKeys,
    ['`fac:${s.id}:${s.can_advocate_at ?? \'\'}`']);
}

console.log('\n— the issue question the client cannot answer —');
{
  const m = mk({ selected: 'Housing' });
  m.ingestRecruitment(payload([lead({ id: 1, issue: 'Housing' }), lead({ id: 2, issue: 'Crime' })]));

  m.ingestMeet('/api/actions/sleeper-recruitment/1/meet', { outcome: 'progress' });
  m.ingestMeet('/api/actions/sleeper-recruitment/2/meet', { outcome: 'lost' });

  const d = m.issueDigest();
  check('talking Housing to the Housing lead is a match', [d.match.n, d.match.lost], [1, 0]);
  check('talking Housing to the Crime lead is not', [d.miss.n, d.miss.lost], [1, 1]);
  check('the chosen issue is captured from the page', m.ledger[0].chosenIssue, 'Housing');
  check('...alongside the clue it was matched against', m.ledger[1].clue, 'Housing');
}

console.log('\n— with no page to read, the meeting is still recorded —');
{
  const m = mk({ pathname: '/home' });        // the reply landed after you navigated away
  m.ingestRecruitment(payload([lead()]));
  m.ingestMeet('/api/actions/sleeper-recruitment/1/meet', { outcome: 'progress' });
  check('the row survives', m.ledger.length, 1);
  check('...with the issue unknown rather than guessed', m.ledger[0].chosenIssue, null);
  check('and the digest buckets it as unknown', m.issueDigest().unknown.n, 1);
}

// ---------------------------------------------------------------------------
// The ledger's `end` row records TWO instants, and conflating them is the bug this
// fences. `at`/`noticedAt` is when the recruitment poll next ran and found the lead
// gone; `expiresAt` is the server's own instant, which for a missed lead IS the ending.
// In the bundle that prompted 0.9.0 the two were 21 h apart for one cohort and ten days
// apart for another, and the ledger only carried the later one.
// ---------------------------------------------------------------------------
console.log('\n— an ending is stamped with when it happened, not when we looked —');
{
  const m = mk();
  const expired = iso(-26 * HOUR);
  m.ingestRecruitment(payload([lead({ next_meeting_at: iso(-27 * HOUR), expires_at: expired })]));
  m.ingestRecruitment(payload([]));           // noticed a day later, on the next visit

  const end = m.ledger.find((e) => e.kind === 'end');
  check('the end row carries the server’s expiry', end.expiresAt, expired);
  check('...and the moment we noticed, under its own name', end.noticedAt, end.at);
  check('...which is strictly later than the expiry',
    end.noticedAt > Date.parse(end.expiresAt), true);
  check('the ending is still classified as missed', end.state, 'missed');
}

// ---------------------------------------------------------------------------
// A lead dies two ways, and before 0.9.0 the reporting only covered the rarer one.
// ---------------------------------------------------------------------------
console.log('\n— both ways a window can close are reported —');
{
  // (a) expired and STILL listed: sweepMissed's path.
  const m = mk();
  m.ingestRecruitment(payload([lead({ next_meeting_at: iso(-2 * HOUR), expires_at: iso(-HOUR) })]));
  check('expired-but-listed is an unacknowledged loss', m.unackedMissed().length, 1);

  // (b) expired while you were away, then GONE from the next poll. sweepMissed() skips
  // `l.gone` and never sees this one — it is the path that cost nine leads.
  const n = mk();
  n.ingestRecruitment(payload([lead({ next_meeting_at: iso(-2 * HOUR), expires_at: iso(-HOUR) })]));
  n.ingestRecruitment(payload([]));
  check('sweepMissed alone cannot see the gone lead', n.sweepMissed().length, 0);
  check('...but it is still an unacknowledged loss', n.unackedMissed().length, 1);
  check('...named, so the strip can say which one',
    n.unackedMissed()[0].display_name, 'Ariel Voss');

  // A lead that ended INSIDE its window is not a missed window.
  const o = mk();
  o.ingestRecruitment(payload([lead({ next_meeting_at: iso(-10 * MIN), expires_at: iso(50 * MIN) })]));
  o.ingestRecruitment(payload([]));
  check('a lead that ended while open is not reported as missed', o.unackedMissed().length, 0);
}

console.log('\n— dismissal is remembered, so a reload cannot swallow it —');
{
  const m = mk();
  m.ingestRecruitment(payload([lead({ next_meeting_at: iso(-2 * HOUR), expires_at: iso(-HOUR) })]));
  m.ingestRecruitment(payload([]));
  check('the loss is pending', m.unackedMissed().length, 1);

  m.ackMissed();
  check('dismissing clears it', m.unackedMissed().length, 0);
  check('...by writing to the lead, not to a variable', m.leads['1'].missedAck, true);

  // Same store, fresh script context — what a page reload actually is.
  const again = mk({ leads: m.leads, ledger: m.ledger, meta: m.getMeta() });
  check('and it stays dismissed across a reload', again.unackedMissed().length, 0);
}

console.log('\n— installing 0.9.0 does not mourn leads you lost last month —');
{
  const m = mk();
  m.ingestRecruitment(payload([
    lead({ id: 1, next_meeting_at: iso(-40 * HOUR), expires_at: iso(-39 * HOUR) }),
    lead({ id: 2, next_meeting_at: iso(-30 * HOUR), expires_at: iso(-29 * HOUR) }),
  ]));
  check('two losses are pending before the upgrade step', m.unackedMissed().length, 2);

  m.ackBacklogOnce();
  check('the backlog is acknowledged once', m.unackedMissed().length, 0);
  check('...and a baseline is recorded', typeof m.getMeta().missedAckBaseline, 'number');

  // Anything that dies AFTER the baseline is news again.
  m.ingestRecruitment(payload([lead({ id: 3, next_meeting_at: iso(-2 * HOUR), expires_at: iso(-HOUR) })]));
  check('a fresh loss still reports', m.unackedMissed().length, 1);

  const again = mk({ leads: m.leads, ledger: m.ledger, meta: m.getMeta() });
  again.ackBacklogOnce();
  check('the upgrade step never runs twice', again.unackedMissed().length, 1);
}

// ---------------------------------------------------------------------------
// What a press right now would schedule.
//
// The offset is measured, not read off the client: 40 presses paired against their own
// next_meeting_at, all 24.00 h, docs/08-sleeper-surface.md. So the arithmetic is cheap
// and the thing worth fencing is the second half — which hour a loss belongs to.
//
// A missed window has TWO instants and they can be a day apart: `expires_at`, the
// server's own, and the ledger's `at`, which is merely when the poll next looked and
// found the lead gone. Bucket the count off `at` and the panel files last night's loss
// under whatever hour the page happened to be reopened — which is exactly the hour it
// would then advise you to avoid, on evidence about your browsing rather than the game.
// ---------------------------------------------------------------------------
console.log('\n— a press now, and what this hour has cost before —');
{
  const m = mk({ meta: { window_minutes: 60 } });
  const now = Date.now();
  const pp = m.pressPreview(now);
  check('the appointment is press + 24 h', pp.opens - now, 24 * HOUR);
  check('...and the window is as long as the header says', pp.closes - pp.opens, 60 * MIN);

  const m45 = mk({ meta: { window_minutes: 45 } });
  const p45 = m45.pressPreview(now);
  check('a server that says 45 minutes is believed, not overridden', p45.closes - p45.opens, 45 * MIN);

  const m0 = mk();
  check('...and with no header yet, the hour the badge hardcodes is assumed',
    m0.pressPreview(now).closes - m0.pressPreview(now).opens, 60 * MIN);

  // 26 h ago: the window closed two clock-hours before this one, and the poll that
  // noticed is running now. The hour it belongs to is the first, not the second.
  const closed = new Date(Date.now() - 26 * HOUR);
  const m2 = mk();
  m2.ingestRecruitment(payload([lead({ id: 1, next_meeting_at: iso(-27 * HOUR), expires_at: closed.toISOString() })]));
  m2.ingestRecruitment(payload([]));
  check('the loss is counted in the hour its window closed', m2.missedInHour(closed.getHours()), 1);
  check('...and not in the hour the poll noticed it', m2.missedInHour(new Date().getHours()), 0);

  // 24 h ago is the same clock hour as the window a press right now would open.
  const m3 = mk();
  m3.ingestRecruitment(payload([lead({ id: 7, next_meeting_at: iso(-25 * HOUR), expires_at: iso(-24 * HOUR) })]));
  check('so the plan line warns about the hour it is about to book', /1 already lost in this hour/.test(m3.planText()), true);
  check('...and says nothing extra about a clean hour', /already lost/.test(m.planText()), false);
  check('either way it leads with the window', /^window /.test(m.planText()), true);
}

console.log(fail ? `\n${fail} FAILED\n` : '\nALL OK\n');
process.exit(fail ? 1 : 0);
