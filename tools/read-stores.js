#!/usr/bin/env node
// Politiko — store reader
//
// Turns a bundle written by tools/collect-stores.js into a brief: the state of the world,
// the levers you hold on it, then you, the people, the economy, and finally what the bundle
// does NOT know. It is written to be read at the top of a strategy conversation, so it errs
// toward complete over pretty and puts the world before the stat sheet.
//
// DISCLOSURE
//
//   Reads:    one bundle (the newest `artifacts/politiko-stores-*.json` unless a path is
//             given) and, for the "since last time" section, the next-newest as the prior
//             unless `--since <file>` or `--no-since` says otherwise.
//   Writes:   markdown to stdout; with `--out <file>`, that same markdown to one file.
//   Requests: none. This file has no network API in it, opens no browser, and touches no
//             store. It reads what the collector already moved out.
//   Contents: the brief names other players (usernames, cities, ranks, combat records)
//             because the bundle does. Keep it in artifacts/, which is gitignored.
//
// RUN IT
//
//   node tools/read-stores.js                         newest bundle, prior = next newest
//   node tools/read-stores.js artifacts/politiko-stores-2026-09-11_20-16-04.json
//   node tools/read-stores.js --since older.json      compare with a chosen prior
//   node tools/read-stores.js --no-since              no comparison section
//   node tools/read-stores.js --out artifacts/brief.md
//
// Fenced by userscripts/tools/test-read-stores.js, which also runs it against a synthetic
// bundle and against an empty one.

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------------------
// Game clock (docs/06-time-surface.md): a game year is 365 game days, a month is 30 with
// December absorbing 31–35, and game time runs `accel` × real time (52.14 ≈ one game year
// per real week).
// ---------------------------------------------------------------------------------------
const GS_DAY = 86400;
const GS_MONTH = 30 * GS_DAY;
const GS_YEAR = 365 * GS_DAY;
const FALLBACK_ACCEL = 365 / 7;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

const fromGs = (gs) => {
  gs = Math.round(gs);
  const year = Math.floor(gs / GS_YEAR) + 1;
  const inYear = ((gs % GS_YEAR) + GS_YEAR) % GS_YEAR;
  const monthIdx = Math.min(Math.floor(inYear / GS_MONTH), 11);
  const inMonth = inYear - monthIdx * GS_MONTH;
  const day = Math.floor(inMonth / GS_DAY) + 1;
  const rem = inMonth % GS_DAY;
  const hh = Math.floor(rem / 3600), mm = Math.floor((rem % 3600) / 60);
  return { year, monthIdx, day, hh, mm, label: `${MONTHS[monthIdx]} ${day}, Y${year} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
};
const gsOf = (year, monthIdx, day = 1) => (year - 1) * GS_YEAR + monthIdx * GS_MONTH + (day - 1) * GS_DAY;
/** "November Y16" -> gs at 00:00 on the 1st, or null. */
const parseGameMonth = (s) => {
  const m = /([A-Za-z]+)\s+Y(\d+)/.exec(String(s || ''));
  if (!m) return null;
  const mi = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m[1].toLowerCase()));
  return mi < 0 ? null : gsOf(+m[2], mi);
};

// ---------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------
const ms = (t) => (typeof t === 'number' ? t : typeof t === 'string' ? Date.parse(t) : NaN);
const iso = (t) => { const x = ms(t); return Number.isFinite(x) ? new Date(x).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : 'n/a'; };
const et = (t) => {
  const x = ms(t);
  if (!Number.isFinite(x)) return 'n/a';
  return new Date(x).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
};
const span = (d) => {
  const a = Math.abs(d);
  if (a < 60e3) return `${Math.round(a / 1e3)} s`;
  if (a < 3600e3) return `${Math.round(a / 60e3)} min`;
  if (a < 48 * 3600e3) return `${(a / 3600e3).toFixed(1)} h`;
  return `${(a / 86400e3).toFixed(1)} d`;
};
/** relative to `now`: "3 min ago" or "in 2.0 h". */
const rel = (t, now) => { const x = ms(t); if (!Number.isFinite(x)) return 'n/a'; const d = x - now; return d < 0 ? `${span(d)} ago` : `in ${span(d)}`; };
const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : x == null ? 'n/a' : String(x));
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
const signed = (x, d = 0) => (x > 0 ? '+' : '') + num(x, d);
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
/** /combat/<uuid>/action -> /combat/{id}/action; …/#584 -> …/#N */
const collapse = (ep) => String(ep).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{id}').replace(/#\d+/g, '#N').replace(/\/\d+(?=\/|$)/g, '/{id}');
const count = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined);

const tool = (b, p, k) => b && b.tools && b.tools[p] && b.tools[p].keys ? b.tools[p].keys[k] : undefined;

// The −3..+3 policy axis, in the words the game paints it with (docs/13-world-politics-
// surface.md): negative is the left bloc, positive the right.
const AXIS_WORDS = { '-3': 'Tankie', '-2': 'Progressive', '-1': 'Moderate Left', 0: 'Moderate', 1: 'Moderate Right', 2: 'Conservative', 3: 'Fascist' };
const axisWord = (a) => AXIS_WORDS[String(Math.round(a))] || String(a);

// ---------------------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------------------
function brief(b, prior) {
  const now = ms(b.collected_at);
  const L = [];
  const p = (...s) => L.push(...s);
  const h = (t) => p('', `## ${t}`, '');
  const h3 = (t) => p('', `### ${t}`, '');
  const table = (head, rows) => {
    if (!rows.length) { p('_none_'); return; }
    p(`| ${head.map(cell).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
    for (const r of rows) p(`| ${r.map(cell).join(' | ')} |`);
  };
  const guard = (title, fn) => { try { fn(); } catch (e) { p(`_${title}: could not be read (${e && e.message})_`); } };

  // -- clock ----------------------------------------------------------------------------
  const tw = tool(b, 'pktw:', 'samples');
  const pl = tool(b, 'pkpl:', 'data');
  const sample = last(tw && tw.recent) || (pl && pl.clock) || null;
  const accel = (sample && sample.accel) || FALLBACK_ACCEL;
  const gsNow = sample ? sample.gs + ((now - sample.t) / 1000) * accel : null;
  const realOfGs = (gs) => (sample ? sample.t + ((gs - sample.gs) / accel) * 1000 : NaN);

  p('# Politiko — state of things', '',
    `Bundle collected **${iso(now)}** (${et(now)}) by ${b.collector || 'collect-stores'}; `
    + `${b.stats ? `${b.stats.keys_read} keys, ${num(b.stats.bytes_raw)} bytes raw` : 'no stats'}`
    + `${b.redactions && b.redactions.length ? `; **${b.redactions.length} redactions**` : ''}.`,
    prior ? `Compared with the bundle of ${iso(prior.collected_at)}, ${span(now - ms(prior.collected_at))} earlier.` : 'No prior bundle to compare with.',
    '', '_Every value is as old as the last screen that filled it. Ages below are relative to collection time, not to now._');

  h('Clock');
  guard('clock', () => {
    if (!sample) { p('_no time sample in the bundle_'); return; }
    const g = fromGs(gsNow);
    p(`Game time at collection: **${g.label}** (acceleration ${accel.toFixed(2)}×; one game year = ${(GS_YEAR / accel / 86400).toFixed(2)} real days). Sample age ${rel(sample.t, now)}.`);
    const rows = [];
    const gw = tool(b, 'pkgw:', 'data');
    const ww = tool(b, 'pkww:', 'data');
    const next = (gw && gw.next) || (ww && ww.gov && { cong: ww.gov.nextC, pres: ww.gov.nextP }) || {};
    for (const [what, label] of [['congressional election', next.cong], ['presidential election', next.pres]]) {
      const gs = parseGameMonth(label);
      if (gs != null) rows.push([what, label, iso(realOfGs(gs)), et(realOfGs(gs)), rel(realOfGs(gs), now)]);
    }
    // College registration opens in January and September of every game year.
    const cands = [];
    for (const y of [g.year, g.year + 1]) for (const mi of [0, 8]) cands.push({ gs: gsOf(y, mi), label: `${MONTHS[mi]} 1, Y${y}` });
    for (const c of cands.filter((c) => c.gs > gsNow).slice(0, 2)) rows.push(['registration window opens', c.label, iso(realOfGs(c.gs)), et(realOfGs(c.gs)), rel(realOfGs(c.gs), now)]);
    const ny = gsOf(g.year + 1, 0);
    rows.push(['new game year', `January 1, Y${g.year + 1}`, iso(realOfGs(ny)), et(realOfGs(ny)), rel(realOfGs(ny), now)]);
    table(['event', 'game date', 'real (UTC)', 'real (ET)', 'from collection'], rows);
  });

  // -- levers ---------------------------------------------------------------------------
  h('Levers');
  guard('levers', () => {
    const mw = tool(b, 'pkmw:', 'hist') || {};
    const sw = b.tools['pksw:'] && b.tools['pksw:'].keys || {};
    const gw = tool(b, 'pkgw:', 'data');
    const ww = tool(b, 'pkww:', 'data');
    const pw = tool(b, 'pkpw:', 'people') || {};
    const xp = tool(b, 'pkxp:', 'ledger');
    const rows = [];
    const money = mw['user/money::balance'];
    if (money && money.length) rows.push(['money', `$${num(last(money)[1])}`, `${money.length} readings, ${rel(money[0][0], now)} → ${rel(last(money)[0], now)}`]);
    for (const [k, series] of Object.entries(mw)) if (k.startsWith('user/progression/') && series.length) rows.push([k.replace('user/progression/', '').replace('::', ' · '), num(last(series)[1]), rel(last(series)[0], now)]);
    if (sw.meta) {
      rows.push(['faction', sw.meta.faction_name || 'n/a', `sleepers ${sw.meta.recruited_count}/${sw.meta.sleeper_cap}; canvass costs ${sw.meta.energy_cost} energy; ${sw.meta.sites} sites; meeting window ${sw.meta.window_minutes} min`]);
      const sl = Object.values(sw.sleepers || {});
      const ready = sl.filter((s) => s.can_advocate_at && ms(s.can_advocate_at) <= now);
      const soon = sl.filter((s) => s.can_advocate_at && ms(s.can_advocate_at) > now).sort((a, c) => ms(a.can_advocate_at) - ms(c.can_advocate_at));
      rows.push(['sleepers able to advocate', `${ready.length} of ${sl.length}`, ready.map((s) => `${s.display_name} (${s.issue})`).join(', ') + (soon.length ? `; next ${soon[0].display_name} ${rel(soon[0].can_advocate_at, now)}` : '')]);
      const emb = sl.filter((s) => s.can_embezzle_at && ms(s.can_embezzle_at) <= now);
      rows.push(['sleepers able to embezzle', `${emb.length} of ${sl.length}`, emb.map((s) => s.display_name).join(', ')]);
      const leads = Object.values(sw.leads || {}).filter((l) => !l.gone);
      const meetings = leads.filter((l) => l.next_meeting_at).sort((a, c) => ms(a.next_meeting_at) - ms(c.next_meeting_at));
      rows.push(['open leads', `${leads.length}`, meetings.slice(0, 3).map((l) => `${l.display_name} ${rel(l.next_meeting_at, now)}`).join('; ')]);
    }
    if (pl && pl.polls && pl.polls.length) {
      const cd = pl.polls.map((x) => ms(x.cooldown)).filter(Number.isFinite).sort((a, c) => c - a)[0];
      rows.push(['opinion poll', cd > now ? `on cooldown ${rel(cd, now)}` : 'available', `${pl.polls.length} polls kept`]);
    }
    if (gw && gw.pres) rows.push(['president', `${gw.pres.name} (a=${gw.pres.a}, ${axisWord(gw.pres.a)})`, `favour ${gw.pres.fav}, term ${gw.pres.term}; cycle ${gw.cycle}; next ${gw.next && gw.next.pres}`]);
    for (const [name, arr] of [['house', gw && gw.house], ['senate', gw && gw.senate]]) {
      if (!arr) continue;
      const tot = arr.reduce((s, x) => s + x.n, 0);
      const mean = arr.reduce((s, x) => s + x.a * x.n, 0) / (tot || 1);
      const neg = arr.filter((x) => x.a < 0).reduce((s, x) => s + x.n, 0), pos = arr.filter((x) => x.a > 0).reduce((s, x) => s + x.n, 0), zero = tot - neg - pos;
      rows.push([name, `mean a=${mean.toFixed(2)} (${axisWord(mean)})`, `${tot} seats: left (a<0) ${neg} (${pct(neg, tot)}), centre ${zero}, right (a>0) ${pos} (${pct(pos, tot)})`]);
    }
    if (ww && ww.polls) {
      const polled = Object.keys(ww.polls);
      const all = (sw.meta && sw.meta.issues) || [];
      const un = all.filter((i) => !polled.some((k) => norm(k) === norm(i)));
      rows.push(['issues polled', `${polled.length}${all.length ? ` of ${all.length}` : ''}`, un.length ? `never polled: ${un.join(', ')}` : 'all polled']);
    }
    const ppl = Object.values(pw);
    if (ppl.length) {
      const me = (xp && xp.me) || (ww && ww.self);
      const myCity = (xp && xp.trainMeta && xp.trainMeta.city_name) || (ww && ww.locName);
      const here = ppl.filter((x) => x.username !== me && (x.in_city || (myCity && x.location === myCity)));
      rows.push(['players in your city', `${here.length}`, `${here.filter((x) => x.is_online).length} online at last look; you: ${myCity || 'n/a'}`]);
    }
    if (xp && xp.trainMeta) rows.push(['training slots today', `${xp.trainMeta.daily_slots}`, `${xp.trainMeta.city_theme || ''}`]);
    table(['lever', 'state', 'detail'], rows);
  });

  // -- government -----------------------------------------------------------------------
  h('Government');
  guard('government', () => {
    const gw = tool(b, 'pkgw:', 'data');
    const ww = tool(b, 'pkww:', 'data');
    if (!gw && !(ww && ww.gov)) { p('_no government reading in the bundle_'); return; }
    if (gw) {
      p(`Read ${rel(gw.now && gw.now['policy:Tax Structure'] ? gw.now['policy:Tax Structure'].t : ww && ww.gov && ww.gov.t, now)}; cycle **${gw.cycle}**, reform ${gw.reform}; `
        + `${gw.roll ? `last roll ${gw.roll.from}→${gw.roll.to} between ${iso(gw.roll.t0)} and ${iso(gw.roll.t1)}` : ''}. `
        + `Next: congress ${gw.next && gw.next.cong}, president ${gw.next && gw.next.pres}.`);
      if (gw.pres) p('', `**${gw.pres.name}** — alignment ${gw.pres.a}, favour ${gw.pres.fav}, term ${gw.pres.term}.`);
      h3('Chambers');
      const axis = [-3, -2, -1, 0, 1, 2, 3];
      const row = (arr) => axis.map((a) => { const x = (arr || []).find((y) => y.a === a); return x ? x.n : 0; });
      table(['chamber', ...axis.map((a) => `a=${a}`), 'seats'], [
        ['house', ...row(gw.house), row(gw.house).reduce((s, x) => s + x, 0)],
        ['senate', ...row(gw.senate), row(gw.senate).reduce((s, x) => s + x, 0)],
      ]);
      p('', `Axis: ${[-3, -2, -1, 0, 1, 2, 3].map((a) => `${a > 0 ? '+' : ''}${a} ${axisWord(a)}`).join(', ')}.`);
      const members = Object.values(gw.members || {});
      if (members.length) p('', `${members.length} seats tracked, ${members.filter((m) => m.inc).length} incumbents.`);
      if (gw.court) p('', `Court: ${gw.court.map((j) => `${j.name} (${j.a})`).join(', ')}.`);
      h3('Policies');
      const pol = Object.entries(gw.now || {}).filter(([k]) => k.startsWith('policy:')).map(([k, v]) => [k.slice(7), v]);
      table(['policy', 'value', 'since', 'reads as'], pol.map(([name, v]) => [name, v.v, rel(v.since, now), trunc((gw.desc || {})[name] || '', 110)]));
      const ev = (gw.events || []).slice().sort((a, c) => (c.t1 || 0) - (a.t1 || 0));
      const polEv = ev.filter((e) => e.kind === 'policy');
      const kinds = count(ev, (e) => e.kind);
      p('', `${ev.length} change events on record (${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}).`);
      if (polEv.length) { h3('Recent policy changes'); table(['policy', 'from', 'to', 'seen between', ''], polEv.slice(0, 12).map((e) => [e.key, e.from, e.to, iso(e.t0), iso(e.t1)])); }
      const jobs = Object.entries(gw.jobs || {}).map(([id, j]) => ({ id, ...j })).sort((a, c) => (c.t || 0) - (a.t || 0));
      if (jobs.length) { h3('Faction jobs seen'); table(['id', 'policy', 'dir', 'status', 'cycle', 'outcome', 'seen'], jobs.slice(0, 15).map((j) => [j.id, j.policy, j.dir, j.status, j.cycle, j.outcome || '', rel(j.t, now)])); }
    } else {
      const g = ww.gov;
      p(`world-watch reading ${rel(g.t, now)}: ${g.president && g.president.name}; next ${g.nextC} / ${g.nextP}.`);
      table(['policy', 'value'], (g.policies || []).map(([k, v]) => [k, v]));
    }
  });

  // -- opinion --------------------------------------------------------------------------
  h('Opinion');
  guard('opinion', () => {
    const ww = tool(b, 'pkww:', 'data');
    const polls = (ww && ww.polls) || {};
    const kept = (pl && pl.polls) || [];
    const latestBy = {};
    for (const x of kept) if (!latestBy[norm(x.issue)] || x.t > latestBy[norm(x.issue)].t) latestBy[norm(x.issue)] = x;
    const issues = Object.entries(polls).map(([k, v]) => ({ k, ...v, fine: latestBy[norm(k)] && latestBy[norm(k)].fine, best: latestBy[norm(k)] && latestBy[norm(k)].best, angle: latestBy[norm(k)] && latestBy[norm(k)].angle }));
    if (!issues.length) { p('_no opinion readings_'); return; }
    table(['issue', 'mean', 'mood', 'salience', 'volatility', 'method', 'read'], issues.sort((a, c) => c.t - a.t).map((i) => [i.k, num(i.mean, 2), i.mood, i.salience, i.volatility, i.method, rel(i.t, now)]));
    const fine = issues.filter((i) => i.fine);
    if (fine.length) {
      h3('Fine distribution (latest poll per issue)');
      const cols = ['far_left', 'center_left', 'slight_left', 'neutral', 'slight_right', 'center_right', 'far_right'];
      table(['issue', ...cols, 'swing group', 'angle'], fine.map((i) => [i.k, ...cols.map((c) => i.fine[c]), i.best || '', trunc(i.angle || '', 90)]));
    }
  });

  // -- world ----------------------------------------------------------------------------
  h('World');
  guard('world', () => {
    const ww = tool(b, 'pkww:', 'data');
    if (!ww) { p('_no world-watch data_'); return; }
    const cities = Object.values(ww.cities || {});
    p(`You are in **${ww.locName || 'n/a'}**. ${cities.length} locations known: ${cities.map((c) => `${c.name} (${c.kind})`).join(', ')}.`);
    const walls = Object.entries(ww.walls || {});
    if (walls.length) { h3('Graffiti walls'); table(['city', 'left', 'right', 'tags', 'read'], walls.map(([c, w]) => [c, w.left, w.right, w.n, rel(w.t, now)])); }
    const protests = Object.keys(ww.protests || {}).length, campaigns = (ww.campaigns || []).length, dom = Object.keys(ww.dom || {}).length;
    p('', `Protests observed: ${protests}. Media campaigns observed: ${campaigns}. State-dominance entries: ${dom}.`);
    if (protests) table(['protest', 'detail'], Object.entries(ww.protests).map(([k, v]) => [k, trunc(JSON.stringify(v), 140)]));
    if (campaigns) table(['campaign'], ww.campaigns.map((c) => [trunc(JSON.stringify(c), 160)]));
    if (dom) table(['state', 'holder'], Object.entries(ww.dom).map(([k, v]) => [k, trunc(JSON.stringify(v), 100)]));
    // `seen` maps an endpoint to the last time the app called it (a ms timestamp); an older
    // shape held counts, so anything under 1e12 is read as one.
    const seen = Object.entries(ww.seen || {}).filter(([, n]) => typeof n === 'number').sort((a, c) => c[1] - a[1]);
    if (seen.length) {
      const stamps = seen[0][1] > 1e12;
      p('', `Endpoints world-watch has seen the app call: ${seen.length}; ${stamps ? 'most recent' : 'busiest'} ${seen.slice(0, 6).map(([k, n]) => (stamps ? `${k} (${rel(n, now)})` : `${k} ×${n}`)).join(', ')}.`);
    }
  });

  // -- people ---------------------------------------------------------------------------
  h('People');
  guard('people', () => {
    const pw = tool(b, 'pkpw:', 'people') || {};
    const roster = tool(b, 'pkpw:', 'roster');
    const ww = tool(b, 'pkww:', 'data');
    const ppl = Object.values(pw);
    if (!ppl.length) { p('_no people ledger_'); return; }
    const me = (tool(b, 'pkxp:', 'ledger') || {}).me || (ww && ww.self);
    const online = ppl.filter((x) => x.is_online).length, npc = ppl.filter((x) => x.is_npc).length;
    p(`${ppl.length} players in the ledger${roster && roster.usernames ? ` (roster ${roster.usernames.length}, read ${rel(roster.seenAt, now)})` : ''}; ${online} online at last look; ${npc} NPCs.`);
    const bucket = (x) => { const t = ms(x.last_online); if (!Number.isFinite(t)) return 'unknown'; const d = (now - t) / 86400e3; return d < 1 ? '< 1 d' : d < 7 ? '< 7 d' : d < 30 ? '< 30 d' : '30 d +'; };
    h3('Activity (last online)');
    table(['bucket', 'players'], ['< 1 d', '< 7 d', '< 30 d', '30 d +', 'unknown'].map((k) => [k, ppl.filter((x) => bucket(x) === k).length]));
    h3('By city');
    table(['city', 'players', 'online'], count(ppl, (x) => x.location || 'unknown').map(([c, n]) => [c, n, ppl.filter((x) => (x.location || 'unknown') === c && x.is_online).length]));
    h3('By rank');
    table(['rank', 'players'], count(ppl, (x) => x.rank_key || 'unknown').slice(0, 15));
    const fac = count(ppl.filter((x) => x.faction_name), (x) => x.faction_name);
    if (fac.length) { h3('Factions'); table(['faction', 'members seen'], fac); }
    const corp = count(ppl.filter((x) => x.corp_name), (x) => x.corp_name);
    if (corp.length) { h3('Corporations'); table(['corporation', 'members seen'], corp.slice(0, 20)); }
    const fresh = ppl.filter((x) => Number.isFinite(ms(x.created_at)) && now - ms(x.created_at) < 14 * 86400e3).sort((a, c) => ms(c.created_at) - ms(a.created_at));
    if (fresh.length) { h3('New accounts (14 d)'); table(['player', 'created', 'city', 'rank', 'last online'], fresh.slice(0, 20).map((x) => [x.username, iso(x.created_at), x.location || '', x.rank_key || '', rel(x.last_online, now)])); }
    const rels = ppl.filter((x) => x.relationship && (x.relationship.is_friend || x.relationship.is_enemy || x.relationship.blocked_by_you || x.relationship.blocked_by_them));
    if (rels.length) { h3('Relationships'); table(['player', 'friend', 'enemy', 'blocked by you', 'blocked you'], rels.map((x) => [x.username, x.relationship.is_friend ? 'yes' : '', x.relationship.is_enemy ? 'yes' : '', x.relationship.blocked_by_you ? 'yes' : '', x.relationship.blocked_by_them ? 'yes' : ''])); }
    const fighters = ppl.filter((x) => x.combat && (x.combat.attacks_won || x.combat.mugs_won)).sort((a, c) => (c.combat.attacks_won + c.combat.mugs_won) - (a.combat.attacks_won + a.combat.mugs_won));
    if (fighters.length) { h3('Most active fighters'); table(['player', 'attacks won', 'lost', 'mugs won', 'mugged', 'money mugged', 'city', 'last online'], fighters.slice(0, 12).map((x) => [x.username, x.combat.attacks_won, x.combat.attacks_lost, x.combat.mugs_won, x.combat.times_mugged, num(x.combat.money_mugged), x.location || '', rel(x.last_online, now)])); }
    const myCity = (tool(b, 'pkxp:', 'ledger') || {}).trainMeta && tool(b, 'pkxp:', 'ledger').trainMeta.city_name || (ww && ww.locName);
    const here = ppl.filter((x) => x.username !== me && (x.in_city || (myCity && x.location === myCity))).sort((a, c) => ms(c.last_online) - ms(a.last_online));
    if (here.length) { h3(`In ${myCity || 'your city'}`); table(['player', 'rank', 'faction', 'corp', 'online', 'last online', 'attacks won'], here.slice(0, 25).map((x) => [x.username, x.rank_key || '', x.faction_name || '', x.corp_name || '', x.is_online ? 'yes' : '', rel(x.last_online, now), x.combat ? x.combat.attacks_won : ''])); }
    const al = Object.entries((ww && ww.people) || {}).map(([u, v]) => ({ u, ...v })).filter((x) => typeof x.s === 'number' && typeof x.e === 'number');
    if (al.length) {
      h3('Alignment of the population (world-watch)');
      const q = (x) => `${Math.abs(x.s) < 0.1 ? 'social centre' : x.s < 0 ? 'social −' : 'social +'} / ${Math.abs(x.e) < 0.1 ? 'economic centre' : x.e < 0 ? 'economic −' : 'economic +'}`;
      const meanS = al.reduce((s, x) => s + x.s, 0) / al.length, meanE = al.reduce((s, x) => s + x.e, 0) / al.length;
      p(`${al.length} compass readings; mean social ${meanS.toFixed(3)}, mean economic ${meanE.toFixed(3)}.`, '');
      table(['quadrant', 'players'], count(al, q));
      const extreme = al.slice().sort((a, c) => (Math.abs(c.s) + Math.abs(c.e)) - (Math.abs(a.s) + Math.abs(a.e))).slice(0, 10);
      h3('Furthest from centre');
      table(['player', 'social', 'economic', 'samples', 'city', 'read'], extreme.map((x) => [x.u, num(x.s, 3), num(x.e, 3), `${x.sc}/${x.ec}`, x.city || '', rel(x.t, now)]));
    }
  });

  // -- you ------------------------------------------------------------------------------
  h('You');
  guard('you', () => {
    const xp = tool(b, 'pkxp:', 'ledger');
    const aw = tool(b, 'pkaw:', 'data');
    const mw = tool(b, 'pkmw:', 'hist') || {};
    if (!xp && !aw) { p('_no self readings_'); return; }
    const me = (xp && xp.me) || (aw && aw.self) || 'n/a';
    p(`**${me}**${xp && xp.status ? `, status ${xp.status}` : ''}${xp && xp.trainMeta ? `, in ${xp.trainMeta.city_name} (${xp.trainMeta.city_theme})` : ''}.`);
    if (aw && aw.readings && aw.readings.length) {
      const a0 = aw.readings[0], a1 = last(aw.readings);
      p('', `Alignment: social **${num(a1.s, 3)}** (${a1.sc} samples), economic **${num(a1.e, 3)}** (${a1.ec} samples), read ${rel(a1.t, now)}; over ${aw.readings.length} readings since ${iso(a0.t)}: social ${signed(a1.s - a0.s, 3)}, economic ${signed(a1.e - a0.e, 3)}.`);
    }
    const money = mw['user/money::balance'];
    if (money && money.length) {
      const vals = money.map((x) => x[1]);
      p('', `Money: **$${num(last(money)[1])}** at ${rel(last(money)[0], now)}; ${money.length} readings spanning ${span(last(money)[0] - money[0][0])}, min $${num(Math.min(...vals))}, max $${num(Math.max(...vals))}.`);
    }
    if (xp && xp.last) {
      h3('Skills');
      const ch = (xp.assessment && xp.assessment.change) || {};
      const tg = (xp.trainMeta && xp.trainMeta.targets) || {};
      const rows = Object.entries(xp.last).map(([k, v]) => [k, v.v]).sort((a, c) => c[1] - a[1]);
      p(xp.assessment ? `${rows.length} skills; 30-day change measured ${xp.assessment.previous_date} → ${xp.assessment.snapshot_date}. Practice/class gains are for the city you are in.` : `${rows.length} skills.`, '');
      table(['skill', 'value', 'Δ 30 d', 'practice gain', 'class gain'], rows.map(([k, v]) => [k, num(v, 2), k in ch ? signed(ch[k], 2) : '', tg[k] ? num(tg[k].practice_gain, 3) : '', tg[k] ? num(tg[k].class_gain, 3) : '']));
    }
    if (xp && xp.actStats) {
      h3('Actions (all time in the ledger)');
      const agg = new Map();
      for (const [ep, s] of Object.entries(xp.actStats)) {
        const k = collapse(ep);
        const a = agg.get(k) || { n: 0, out: {}, xp: {} };
        a.n += s.n || 0;
        for (const [o, n] of Object.entries(s.outcomes || {})) a.out[o] = (a.out[o] || 0) + n;
        for (const [sk, v] of Object.entries(s.xp || {})) { const x = a.xp[sk] || { sum: 0, n: 0 }; x.sum += v.sum; x.n += v.n; a.xp[sk] = x; }
        agg.set(k, a);
      }
      const rows = [...agg.entries()].sort((a, c) => c[1].n - a[1].n).map(([k, a]) => {
        // Only actions whose responses carry an outcome get a rate; a fetch that records
        // none (a terminal command, a poll) is "n/a", not 0%.
        const judged = Object.values(a.out).reduce((s, n) => s + n, 0);
        const ok = Object.entries(a.out).filter(([o]) => o.startsWith('success')).reduce((s, [, n]) => s + n, 0);
        const jail = Object.entries(a.out).filter(([o]) => o.includes('jailed')).reduce((s, [, n]) => s + n, 0);
        const hosp = Object.entries(a.out).filter(([o]) => o.includes('hospital')).reduce((s, [, n]) => s + n, 0);
        const yields = Object.entries(a.xp).map(([sk, x]) => [sk, x.sum / (a.n || 1)]).sort((p1, p2) => p2[1] - p1[1]).slice(0, 3).map(([sk, y]) => `${sk} ${y.toFixed(3)}`).join(', ');
        return [k, num(a.n), judged ? pct(ok, judged) : 'n/a', jail, hosp, yields];
      });
      table(['action', 'n', 'success', 'jailed', 'hospitalised', 'xp per action (top 3)'], rows);
    }
    if (xp && xp.mastery) { h3('Mastery'); table(['action', 'level', 'since', 'steps recorded'], Object.entries(xp.mastery).map(([k, m]) => [k, m.v, m.since, (m.steps || []).length])); }
    if (xp && xp.eduCourses) {
      const all = Object.entries(xp.eduCourses);
      const done = all.filter(([, c]) => c.completed);
      h3('Education');
      p(`${done.length} of ${all.length} known courses completed.`, '');
      const open = all.filter(([, c]) => !c.completed);
      if (open.length) table(['course', 'rewards'], open.map(([code, c]) => [code, (c.rewards || []).map((r) => `${r.key} +${r.amount}`).join(', ')]));
    }
    if (xp && xp.events && xp.events.length) {
      const day = xp.events.filter((e) => now - e.t < 86400e3);
      h3('Last 24 h of activity');
      p(`${day.length} events in the last day (${xp.events.length} kept in total, oldest ${rel(xp.events[0].t, now)}).`, '');
      table(['endpoint', 'n', 'outcomes'], count(day, (e) => collapse(e.ep)).slice(0, 15).map(([ep, n]) => [ep, n, count(day.filter((e) => collapse(e.ep) === ep), (e) => e.outcome || 'n/a').map(([o, m]) => `${o} ${m}`).join(', ')]));
    }
    if (xp && xp.deltas && xp.deltas.length) {
      h3('Latest skill gains');
      table(['when', 'skill', 'Δ', 'to', 'attributed to'], xp.deltas.slice(-12).reverse().map((d) => [rel(d.t, now), d.key, signed(d.d, 3), num(d.to, 2), d.attrib ? `${d.attrib.type}: ${(d.attrib.eps || []).map(collapse).join(', ')}` : '']));
    }
    if (xp && xp.sheetIssue) p('', `Sheet issue flagged: ${JSON.stringify(xp.sheetIssue)}.`);
    if (xp && xp.changeVerdict) p('', `Change verdict: ${xp.changeVerdict.kind} on ${xp.changeVerdict.key} (dates moved: ${xp.changeVerdict.datesMoved}).`);
  });

  // -- faction --------------------------------------------------------------------------
  h('Faction and sleepers');
  guard('faction', () => {
    const sw = b.tools['pksw:'] && b.tools['pksw:'].keys;
    const rw = b.tools['pkrw:'] && b.tools['pkrw:'].keys;
    const mw = tool(b, 'pkmw:', 'hist') || {};
    if (!sw && !rw) { p('_no faction readings_'); return; }
    if (sw && sw.meta) p(`**${sw.meta.faction_name}** (id ${sw.meta.factionId}), read ${rel(sw.meta.facPolledAt || sw.meta.polledAt, now)}. Recruited ${sw.meta.recruited_count} of ${sw.meta.sleeper_cap}; canvass costs ${sw.meta.energy_cost} energy across ${sw.meta.sites} sites; meeting window ${sw.meta.window_minutes} min.`);
    const sl = Object.values((sw && sw.sleepers) || {});
    if (sl.length) { h3('Sleepers'); table(['name', 'archetype', 'site', 'issue', 'eff.', 'mine', 'recruited', 'advocate', 'embezzle', 'seen'], sl.map((s) => [s.display_name, s.archetype_name, s.site_name, s.issue, s.effectiveness, s.mine ? 'yes' : (s.recruiter_username || ''), iso(s.recruited_at), s.can_advocate_at ? rel(s.can_advocate_at, now) : 'n/a', s.can_embezzle_at ? rel(s.can_embezzle_at, now) : 'n/a', rel(s.lastSeen || s.facSeen, now)])); }
    const leads = Object.values((sw && sw.leads) || {});
    const open = leads.filter((l) => !l.gone);
    if (open.length) { h3('Open leads'); table(['name', 'archetype', 'site', 'issue', 'status', 'meetings', 'next meeting', 'expires'], open.map((l) => [l.display_name, l.archetype_name, l.site_name, l.issue, l.status, l.meeting_count, l.next_meeting_at ? rel(l.next_meeting_at, now) : '', l.expires_at ? rel(l.expires_at, now) : ''])); }
    if (leads.length) p('', `${leads.length} leads ever seen; ${leads.length - open.length} gone (${count(leads.filter((l) => l.gone), (l) => l.goneState || 'unknown').map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}).`);
    const ledger = (sw && sw.ledger) || [];
    if (ledger.length) { h3('Sleeper ledger (latest)'); table(['when', 'kind', 'lead', 'issue', 'outcome'], ledger.slice(-8).reverse().map((e) => [rel(e.at, now), e.kind, e.name, e.chosenIssue || e.leadIssue || '', e.outcome || e.state || ''])); }
    const fac = Object.entries(mw).filter(([k]) => k.startsWith('factions/')).map(([k, s]) => [k, last(s)]).filter(([, v]) => v);
    if (fac.length) { h3('Faction numbers market-watch has tracked'); table(['series', 'last', 'read'], fac.slice(0, 20).map(([k, v]) => [k, num(v[1]), rel(v[0], now)])); }
    if (rw) {
      const ev = Object.values(rw.events || {}).sort((a, c) => ms(c.created_at) - ms(a.created_at));
      p('', `Raids: ${Object.keys(rw.raids || {}).length} raids, ${Object.keys(rw.reports || {}).length} reports, ${ev.length} events${ev.length ? `; latest ${ev[0].event_type} by ${ev[0].actor_username} on ${ev[0].target_username} at ${iso(ev[0].created_at)}` : ''}.`);
    }
  });

  // -- economy --------------------------------------------------------------------------
  h('Economy');
  guard('economy', () => {
    const sh = tool(b, 'pksh:', 'data');
    const qj = tool(b, 'pkqj:', 'places');
    const bj = tool(b, 'pkbj:', 'data');
    const sl = tool(b, 'pksl:', 'data');
    const mw = tool(b, 'pkmw:', 'hist') || {};
    if (sh && sh.stores) {
      h3('Shops');
      const rows = Object.values(sh.stores).map((s) => {
        const r = s.readings || [];
        const first = r[0] && r[0].items || {}, lastR = last(r) && last(r).items || {};
        const changed = Object.entries(lastR).filter(([id, it]) => first[id] && first[id].stock !== it.stock).map(([id, it]) => `${it.name} ${first[id].stock}→${it.stock}`);
        return [s.name, s.city, s.kind, r.length, last(r) ? rel(last(r).t, now) : 'n/a', Object.keys(lastR).length, changed.join('; ') || 'no stock change across readings'];
      });
      table(['store', 'city', 'kind', 'readings', 'last', 'items', 'stock moved (first → last)'], rows);
      p('', `${(sh.events || []).length} restock brackets recorded.`);
    }
    const prop = Object.entries(mw).filter(([k]) => k.startsWith('property/')).map(([k, s]) => [k, last(s)]).filter(([, v]) => v);
    if (prop.length) { h3('Property series'); table(['series', 'last', 'read'], prop.slice(0, 20).map(([k, v]) => [k, num(v[1]), rel(v[0], now)])); }
    if (qj && qj.corps) { h3('Corporations known'); table(['id', 'name', 'type', 'city', 'active', 'seen'], Object.values(qj.corps).map((c) => [c.id, c.name, c.type, c.location_name, c.is_active ? 'yes' : 'no', rel(c.seenAt, now)])); }
    if (qj && qj.casinos) {
      h3('Casinos');
      for (const [id, c] of Object.entries(qj.casinos)) p(`Casino ${id}: ${c.operational ? 'operational' : 'closed'}${c.wagering_suspended ? ', wagering suspended' : ''}; venues ${(c.venues || []).map((v) => v.location_name).join(', ')}; games ${(c.games || []).map((g) => `${g.key} (${g.status})`).join(', ')}.`);
      if (bj && bj.edge) p(`Blackjack: rule set ${bj.edge.key}, house edge ${(bj.edge.edge * 100).toFixed(3)}% over ${num(bj.edge.deals)} deals; ${Object.values(bj.corps || {}).reduce((s, c) => s + ((c.hands || []).length), 0)} hands in the ledger.`);
      if (sl && sl.corps) p(`Slots: ${Object.values(sl.corps).reduce((s, c) => s + ((c.sessions || []).length), 0)} sessions in the ledger.`);
    }
    const fams = count(Object.keys(mw), (k) => k.replace(/#\d+/g, '#N').replace(/::.*/, '').split('/').slice(0, 2).join('/'));
    if (fams.length) p('', `market-watch keeps ${Object.keys(mw).length} numeric series in ${fams.length} families: ${fams.slice(0, 14).map(([f, n]) => `${f} (${n})`).join(', ')}${fams.length > 14 ? ', …' : ''}.`);
  });

  // -- wire -----------------------------------------------------------------------------
  h('Wire');
  guard('wire', () => {
    const ws = tool(b, 'pkws:', 'census');
    if (!ws) { p('_no socket census_'); return; }
    const t = ws.types || {};
    const n = (a, b2) => (t[a] && t[a][b2] ? t[a][b2].n : 0);
    p(`${num(ws.frames)} frames over ${num(ws.connects)} connections since ${iso(ws.startedAt)} (${span(ws.observedMs || 0)} observed); chat presence ${num(n('chat', 'presence'))}, chat messages ${num(n('chat', 'message'))}, market quotes ${num(n('market', 'quote'))}, candles ${num(n('market', 'candle_update'))}; presence total ${ws.presenceTotal != null ? ws.presenceTotal : 'n/a'}; clock via ${ws.clockType || 'n/a'}.`);
  });

  // -- since ----------------------------------------------------------------------------
  if (prior) {
    h(`Since the bundle of ${iso(prior.collected_at)}`);
    guard('since', () => {
      const rows = [];
      const mwA = tool(prior, 'pkmw:', 'hist') || {}, mwB = tool(b, 'pkmw:', 'hist') || {};
      const mA = last(mwA['user/money::balance']), mB = last(mwB['user/money::balance']);
      if (mA && mB) rows.push(['money', `$${num(mA[1])} → $${num(mB[1])}`, signed(mB[1] - mA[1])]);
      const xA = tool(prior, 'pkxp:', 'ledger'), xB = tool(b, 'pkxp:', 'ledger');
      if (xA && xB && xA.last && xB.last) {
        const d = Object.keys(xB.last).map((k) => [k, xB.last[k].v - (xA.last[k] ? xA.last[k].v : 0)]).filter(([, v]) => Math.abs(v) > 1e-9).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1]));
        rows.push(['skills moved', `${d.length}`, d.slice(0, 10).map(([k, v]) => `${k} ${signed(v, 2)}`).join(', ')]);
        rows.push(['events logged', `${(xB.events || []).filter((e) => e.t > ms(prior.collected_at)).length}`, 'in the ledger, after the prior bundle']);
      }
      const aA = last((tool(prior, 'pkaw:', 'data') || {}).readings), aB = last((tool(b, 'pkaw:', 'data') || {}).readings);
      if (aA && aB) rows.push(['alignment', `social ${signed(aB.s - aA.s, 3)}, economic ${signed(aB.e - aA.e, 3)}`, `samples ${aA.sc}/${aA.ec} → ${aB.sc}/${aB.ec}`]);
      const sA = (prior.tools['pksw:'] && prior.tools['pksw:'].keys) || {}, sB = (b.tools['pksw:'] && b.tools['pksw:'].keys) || {};
      if (sA.meta && sB.meta) rows.push(['sleepers recruited', `${sA.meta.recruited_count} → ${sB.meta.recruited_count}`, `cap ${sB.meta.sleeper_cap}`]);
      const slA = new Set(Object.keys(sA.sleepers || {})), slB = Object.entries(sB.sleepers || {});
      const newSl = slB.filter(([id]) => !slA.has(id)).map(([, s]) => s.display_name);
      const goneSl = [...slA].filter((id) => !(sB.sleepers || {})[id]);
      if (newSl.length || goneSl.length) rows.push(['sleeper roster', `+${newSl.length} / −${goneSl.length}`, `${newSl.join(', ')}${goneSl.length ? `; gone: ${goneSl.length}` : ''}`]);
      const ldA = Object.keys(sA.leads || {}).length, ldB = Object.keys(sB.leads || {}).length;
      if (ldA !== ldB) rows.push(['leads seen', `${ldA} → ${ldB}`, '']);
      const gA = tool(prior, 'pkgw:', 'data'), gB = tool(b, 'pkgw:', 'data');
      if (gA && gB) {
        const ch = Object.entries(gB.now || {}).filter(([k, v]) => k.startsWith('policy:') && gA.now && gA.now[k] && gA.now[k].v !== v.v).map(([k, v]) => `${k.slice(7)} ${gA.now[k].v}→${v.v}`);
        rows.push(['policies changed', `${ch.length}`, ch.join(', ')]);
        if (gA.cycle !== gB.cycle) rows.push(['cycle', `${gA.cycle} → ${gB.cycle}`, '']);
        if ((gA.pres && gA.pres.name) !== (gB.pres && gB.pres.name)) rows.push(['president', `${gA.pres && gA.pres.name} → ${gB.pres && gB.pres.name}`, '']);
        rows.push(['government events', `${(gA.events || []).length} → ${(gB.events || []).length}`, '']);
      }
      const pA = tool(prior, 'pkpw:', 'people') || {}, pB = tool(b, 'pkpw:', 'people') || {};
      const newP = Object.keys(pB).filter((u) => !pA[u]);
      const moved = Object.keys(pB).filter((u) => pA[u] && pA[u].location && pB[u].location && pA[u].location !== pB[u].location).map((u) => `${u} ${pA[u].location}→${pB[u].location}`);
      if (Object.keys(pB).length) rows.push(['people', `+${newP.length} new, ${moved.length} moved city`, `${newP.slice(0, 10).join(', ')}${moved.length ? `; ${moved.slice(0, 10).join(', ')}` : ''}`]);
      const wA = (tool(prior, 'pkww:', 'data') || {}).polls || {}, wB = (tool(b, 'pkww:', 'data') || {}).polls || {};
      const newPolls = Object.keys(wB).filter((k) => !wA[k] || wA[k].t !== wB[k].t);
      if (Object.keys(wB).length) rows.push(['polls refreshed', `${newPolls.length}`, newPolls.join(', ')]);
      const shA = tool(prior, 'pksh:', 'data'), shB = tool(b, 'pksh:', 'data');
      if (shA && shB) { const cnt = (s) => Object.values(s.stores || {}).reduce((n, st) => n + (st.readings || []).length, 0); rows.push(['shop readings', `${cnt(shA)} → ${cnt(shB)}`, '']); }
      table(['what', 'change', 'detail'], rows);
    });
  }

  // -- freshness & gaps -----------------------------------------------------------------
  h('Freshness per tool');
  guard('freshness', () => {
    const lo = now - 120 * 86400e3, hi = now + 60e3;
    const newest = (v, acc) => {
      if (typeof v === 'number') { if (v > lo && v < hi && v > acc.t) acc.t = v; }
      else if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) { const t = Date.parse(v); if (t > lo && t < hi && t > acc.t) acc.t = t; }
      else if (Array.isArray(v)) v.forEach((x) => newest(x, acc));
      else if (v && typeof v === 'object') Object.values(v).forEach((x) => newest(x, acc));
      return acc;
    };
    const rows = [];
    for (const [pfx, t] of Object.entries(b.tools || {})) {
      const keys = Object.entries(t.keys || {}).filter(([k]) => k !== 'ui');
      if (!keys.length) { rows.push([t.tool || pfx, '(settings only)', '', '']); continue; }
      const acc = { t: 0 }; keys.forEach(([, v]) => newest(v, acc));
      rows.push([t.tool || pfx, keys.map(([k]) => k).join(', '), acc.t ? iso(acc.t) : 'no timestamp', acc.t ? rel(acc.t, now) : '']);
    }
    rows.sort((a, c) => (a[2] > c[2] ? -1 : a[2] < c[2] ? 1 : 0));
    table(['tool', 'stores', 'newest observation', 'age at collection'], rows);
  });

  h('What this bundle does not know');
  guard('gaps', () => {
    const gaps = [];
    const ww = tool(b, 'pkww:', 'data'), rw = b.tools['pkrw:'] && b.tools['pkrw:'].keys, sh = tool(b, 'pksh:', 'data'), mw = tool(b, 'pkmw:', 'hist') || {};
    if (!ww) gaps.push('no world-watch data: no government, opinion, walls or population compass');
    else {
      if (!Object.keys(ww.protests || {}).length) gaps.push('no protest has been observed');
      if (!(ww.campaigns || []).length) gaps.push('no media campaign has been observed');
      if (!Object.keys(ww.dom || {}).length) gaps.push('state dominance has never been read');
    }
    if (!rw || !Object.keys(rw.raids || {}).length) gaps.push('no raid has been observed');
    if (!sh || !(sh.events || []).length) gaps.push('no restock bracket has been caught, so restock timing is unknown');
    const money = mw['user/money::balance'];
    if (!money || !money.length) gaps.push('no money reading');
    else if (last(money)[0] - money[0][0] < 2 * 86400e3) gaps.push(`money history spans only ${span(last(money)[0] - money[0][0])}`);
    if (!tool(b, 'pkgw:', 'data')) gaps.push('no gov-watch ledger');
    if (!tool(b, 'pkpw:', 'people')) gaps.push('no people ledger');
    if (!(b.tools['pksw:'] && b.tools['pksw:'].keys.meta)) gaps.push('no faction reading');
    if (!gaps.length) p('_every store carries data_'); else for (const g of gaps) p(`- ${g}`);
    p('', '_No store carries: inventory, bank or estate balances as a series, corporation books, newspaper article text, chat, or the combat log beyond XP samples. Those are not thin readings; nothing captures them._');
  });

  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------
function listBundles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^politiko-stores-.*\.json$/.test(f)).sort().reverse().map((f) => path.join(dir, f));
}

function parseArgs(argv) {
  const o = { bundle: null, since: undefined, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') o.since = argv[++i];
    else if (a === '--no-since') o.since = null;
    else if (a === '--out') o.out = argv[++i];
    else if (!a.startsWith('--')) o.bundle = a;
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const dir = path.join(__dirname, '..', 'artifacts');
  const found = listBundles(dir);
  const bundlePath = o.bundle || found[0];
  if (!bundlePath) { console.error(`no bundle: pass a path or put politiko-stores-*.json in ${dir}`); process.exit(2); }
  const b = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  let priorPath = o.since;
  if (priorPath === undefined) priorPath = found.find((f) => path.resolve(f) !== path.resolve(bundlePath)) || null;
  const prior = priorPath ? JSON.parse(fs.readFileSync(priorPath, 'utf8')) : null;
  const md = brief(b, prior);
  if (o.out) fs.writeFileSync(o.out, md);
  process.stdout.write(md);
  console.error(`read ${bundlePath}${priorPath ? `, compared with ${priorPath}` : ''}${o.out ? `, written to ${o.out}` : ''}`);
}

module.exports = { brief, fromGs, parseGameMonth, collapse, listBundles };
if (require.main === module) main();
