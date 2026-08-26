// ==UserScript==
// @name         Politiko — World Watch
// @namespace    https://github.com/dataterminals/politiko-research
// @version      0.1.0
// @description  Plots the game world on the same political compass the game draws for your character — the law, public opinion, the street, the media and the citizens you have seen, as five separate readings — and breaks the same thing down city by city. Reads only responses the app already fetched. Passive; zero added requests.
// @author       dataterminals
// @homepageURL  https://github.com/dataterminals/politiko-research
// @supportURL   https://github.com/dataterminals/politiko-research/issues
// @updateURL    https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/world-watch.user.js
// @downloadURL  https://raw.githubusercontent.com/dataterminals/politiko-research/main/userscripts/world-watch.user.js
// @match        https://politiko.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * DISCLOSURE (Politiko rules, Scripting Abuse clause)
 *
 *   Reads:    JSON RESPONSE bodies of calls the game client itself made, on pages you
 *             are actively viewing. Never a request body, never a header, never a token.
 *
 *               GET  /api/government              the 20 policy axes, both chambers,
 *                                                 the president and the court
 *               GET  /api/factions/{id}/jobs      carries the same policy axes; read
 *                                                 for those only, faction data ignored
 *               POST /api/actions/poll            the RESPONSE to a poll you paid for:
 *                                                 public opinion on one issue
 *               GET  /api/protests…               live protests: issue, meter, headcount
 *               GET  /api/protests/state-dominance which side holds each US state
 *               GET  /api/actions/graffiti        the walls of the city you are in
 *               GET  /api/home/media-campaigns    per-city, per-issue campaigns + reach
 *               GET  /api/home/active-protest     one protest's id, issue and city
 *               GET  /api/locations               id/key/name of the world's cities
 *               GET  /api/users/<name>            a profile YOU opened — its `alignment`
 *               GET  /api/user/status             polled by the app every 10 s anyway;
 *                                                 used for your name and current city
 *
 *             Other players' alignments ARE stored, because a compass of "the world"
 *             is a compass of its people and there is no other way to have one. What is
 *             kept per player is exactly what the profile screen already shows you:
 *             username, two axis values, two sample counts, and when you saw it. No
 *             combat record, no money, no relationships, no timestamps of their play.
 *             The `auth` localStorage key (your tokens) is never read.
 *
 *   Sends:    nothing, to anyone
 *
 *   Requests: ZERO additional requests to politiko.io. There is one `fetch` wrapper and
 *             it calls the original exactly once, to pass your own traffic through. No
 *             timer in this file touches the network. The panel's jump buttons perform
 *             the same client-side route change as clicking the game's own nav links —
 *             the app then fetches what that page needs, and only at the moment you
 *             click. Nothing is scheduled, retried, or fired while you are elsewhere.
 *
 *   Storage:  localStorage keys prefixed `pkww:` — the readings above and panel state
 *
 *   Alerts:   none. No notifications, no sound, nothing raised from an unfocused tab;
 *             the panel only redraws while the tab is visible
 *
 *   Clipboard: written ONLY when you click "copy" (tab-separated, whatever tab you are on)
 *
 * Design rule for this repo: consume, don't request. See docs/01-rules-envelope.md.
 * The measurements behind every constant here, and which parts are the game's own
 * arithmetic versus ours: docs/13-world-politics-surface.md.
 *
 * THE HONEST LIMITATION, STATED UP FRONT
 *
 * The game has no world compass. It has a compass for a player, and it has twenty
 * issues that it files under `social` or `economic` for the purpose of moving that
 * player's two axes. This panel takes the game's own filing and applies it to everything
 * else that carries a left/right number on those same issues. That last step is OURS.
 * Every number here is computed from a value the server sent; no arrangement of them
 * into a point is something the game ever does. The panel says so on every screen, and
 * `nation` and `city` rows print their sample size so a point built from two readings
 * cannot pass for one built from twenty.
 */

(() => {
  'use strict';

  const TAG = '[pk-world-watch]';
  const log = (...a) => console.debug(TAG, ...a);

  const K = { data: 'pkww:data', ui: 'pkww:ui' };

  const readJSON = (k, fallback) => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fallback; }
    catch (e) { log('read fail', k, e); return fallback; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { log('write fail (quota?)', k, e); }
  };

  // ===========================================================================
  // 1. Game constants, lifted from the client bundles (2026-08-10 pull).
  //    All of this is arithmetic the app already does on data it already has.
  //    docs/13-world-politics-surface.md carries the evidence line by line.
  // ===========================================================================

  // ProfilePage's compass: viewBox 0 0 220 220, plot box 16..204, axes clamped ±3.
  //   x = 16 + (economic + 3) / 6 * 188      (−3 = L, +3 = R)
  //   y = 16 + (3 − social)  / 6 * 188       (+3 = AUTHORITY at top, −3 = LIBERTY)
  const BOX = 16, PLOT = 188, MID = BOX + PLOT / 2;
  const clamp3 = (v) => Math.max(-3, Math.min(3, Number.isFinite(+v) ? +v : 0));
  const px = (economic) => BOX + (clamp3(economic) + 3) / 6 * PLOT;
  const py = (social) => BOX + (3 - clamp3(social)) / 6 * PLOT;

  // GovernmentPage's own −3..+3 word scale and colours. Note this is NOT the wiki's
  // list (Communist/Progressive/Liberal/Moderate/Conservative/Republican/Far-Right) —
  // the shipped client disagrees with the shipped wiki, and the client is what renders.
  const WORD = ['Tankie', 'Progressive', 'Moderate Left', 'Moderate', 'Moderate Right', 'Conservative', 'Fascist'];
  const SHORT = ['L++', 'L+', 'Mod-', 'Mod', 'Mod+', 'R+', 'R++'];
  const HUE = ['#1e3a8a', '#60a5fa', '#bfdbfe', '#52525b', '#fca5a5', '#f87171', '#EA0C0C'];
  const bucket3 = (v) => Math.round(clamp3(v)) + 3;
  const word = (v) => WORD[bucket3(v)];
  const short = (v) => SHORT[bucket3(v)];
  const hue = (v) => HUE[bucket3(v)];

  // ActivismPage's issue table — the game's own filing of each issue under an axis.
  // 13 social, 7 economic. This is the hinge the whole tool turns on.
  const ISSUE = {
    'free-speech': ['Free Speech', 'social'], 'police-behavior': ['Police', 'social'],
    'civil-rights': ['Civil Rights', 'social'], 'immigration': ['Immigration', 'social'],
    'drugs': ['Drugs', 'social'], 'abortion': ['Abortion', 'social'],
    'animal-research': ['Animal Research', 'social'], 'healthcare': ['Healthcare', 'social'],
    'lgbt-rights': ['LGBT Rights', 'social'], 'gun-control': ['Gun Control', 'social'],
    'torture': ['Torture', 'social'], 'intelligence': ['Intelligence', 'social'],
    'womens-rights': ["Women's Rights", 'social'], 'corporations': ['Corporations', 'economic'],
    'elections': ['Elections', 'economic'], 'sweatshops': ['Sweatshops', 'economic'],
    'military': ['Military', 'economic'], 'nuclear-power': ['Nuclear Power', 'economic'],
    'pollution': ['Pollution', 'economic'], 'taxes': ['Taxes', 'economic'],
  };
  const ORDER = Object.keys(ISSUE);

  // GovernmentPage names its 20 policies differently from ActivismPage's 20 issues.
  // Eighteen of the pairings are the same words; the two that are not — Human Rights /
  // Torture and Privacy Rights / Intelligence — are both social either way, so even a
  // swapped guess leaves every axis figure identical. It only affects the ISSUES table.
  const POLICY = {
    'Free Speech': 'free-speech', 'Police Regulation': 'police-behavior',
    'Civil Rights': 'civil-rights', 'Immigration': 'immigration', 'Drug Law': 'drugs',
    'Abortion Rights': 'abortion', 'Animal Rights': 'animal-research',
    'Healthcare': 'healthcare', 'Gay Rights': 'lgbt-rights', 'Gun Control': 'gun-control',
    'Human Rights': 'torture', 'Privacy Rights': 'intelligence',
    'Womens Rights': 'womens-rights', 'Corporate Law': 'corporations',
    'Election Reform': 'elections', 'Labor Laws': 'sweatshops',
    'Military Spending': 'military', 'Nuclear Power': 'nuclear-power',
    'Pollution': 'pollution', 'Tax Structure': 'taxes',
  };

  // OpinionPollPage renders seven buckets when the poll was exact (professional firm,
  // focus group) and three when it was cheap (street, online scrape). Its own test for
  // which shape arrived is `far_left === undefined`, so that is the test used here.
  // The bucket values are OURS: seven cells across −3..+3 land on the integers; the
  // coarse three are the midpoints of the thirds they cover.
  const BUCKETS = [['far_left', -3], ['center_left', -2], ['slight_left', -1], ['neutral', 0],
    ['slight_right', 1], ['center_right', 2], ['far_right', 3]];
  const COARSE = [['left_bloc', -2], ['center', 0], ['right_bloc', 2]];

  // TravelPage hardcodes the world's cities and their coordinates. Six of them, five in
  // the United States and one overseas. The FIPS codes are the ANSI ones the state map
  // is drawn from (us-atlas), so they are how /protests/state-dominance keys its rows.
  const CITY_FIPS = {
    'san-francisco': '06', 'portland': '41', 'washington-dc': '11',
    'new-york': '36', 'austin': '48',
  };
  const FIPS = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
    '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL',
    '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
    '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE',
    '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
    '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
    '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV',
    '55': 'WI', '56': 'WY',
  };

  // ===========================================================================
  // 2. The aggregation core. Pure functions over plain data — this is the layer
  //    userscripts/tools/test-world.js slices out and exercises, so keep it free
  //    of DOM, storage and clocks.
  // ===========================================================================

  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // One lookup for every way the client spells an issue: the slug it posts, the label
  // ActivismPage prints, the label ProtestPage prints, and the policy name the
  // Government screen uses. Anything unrecognised resolves to null and is counted, not
  // silently dropped — an unknown issue is a finding, not a rounding error.
  const ISSUE_BY = (() => {
    const m = Object.create(null);
    for (const [slug, [label]] of Object.entries(ISSUE)) { m[norm(slug)] = slug; m[norm(label)] = slug; }
    for (const [name, slug] of Object.entries(POLICY)) m[norm(name)] = slug;
    m[norm('Police Behavior')] = 'police-behavior'; // ProtestPage's own longer label
    m[norm('Animal Testing')] = 'animal-research';
    m[norm('Drug Policy')] = 'drugs';
    return m;
  })();
  const issueOf = (v) => (typeof v === 'string' || typeof v === 'number' ? ISSUE_BY[norm(v)] ?? null : null);
  const catOf = (slug) => ISSUE[slug]?.[1] ?? null;
  const labelOf = (slug) => ISSUE[slug]?.[0] ?? slug;

  /**
   * A protest's `meter` runs −100..+100 with NEGATIVE = left winning — measured, that
   * is protestShared's own bar (`50 − meter/2` percent) and its own labels. Rescaling
   * it onto −3..+3 is ours, and it is the only sensible mapping: both ranges are
   * symmetric, and the compass is the target.
   */
  const leanOfMeter = (meter) => clamp3((Number(meter) || 0) * 3 / 100);

  /** two head-counts to a −3..+3 lean; used for graffiti walls and protest rosters */
  const leanOfCounts = (left, right) => {
    const l = Math.max(0, Number(left) || 0), r = Math.max(0, Number(right) || 0);
    return (l + r) > 0 ? clamp3((r - l) / (l + r) * 3) : null;
  };

  /** state-dominance rows: a side plus a 0..100 score, so the same −3..+3 rescale */
  const leanOfDominance = (row) => {
    if (!row || !row.dominant_side || !(row.active_protests > 0)) return null;
    const sign = row.dominant_side === 'left' ? -1 : row.dominant_side === 'right' ? 1 : 0;
    if (!sign) return null;
    return clamp3(sign * Math.abs(Number(row.dominance_score) || 0) / 100 * 3);
  };

  /**
   * The mean of a poll's buckets. Returns null rather than 0 for a body with no bucket
   * at all, because "we have no reading" and "the public is dead centre" are different
   * claims and only one of them is ever true here.
   */
  const pollMean = (body) => {
    if (!body || typeof body !== 'object') return null;
    const exact = body.far_left !== undefined;
    let sum = 0, w = 0;
    for (const [k, v] of (exact ? BUCKETS : COARSE)) {
      const p = Number(body[k]);
      if (Number.isFinite(p) && p > 0) { sum += p * v; w += p; }
    }
    return w > 0 ? { mean: sum / w, exact, weight: w } : null;
  };

  /**
   * Weighted mean of {cat, v, w} rows, split by axis. The weight is what each source
   * has to offer as a measure of how much a reading counts: heads at a protest, fans
   * reached by a campaign, one apiece for a law or a poll. `w` of 0 or absent is 1.
   */
  const axes = (rows) => {
    const acc = { social: { sum: 0, w: 0, n: 0 }, economic: { sum: 0, w: 0, n: 0 } };
    for (const r of rows || []) {
      const a = acc[r.cat];
      if (!a || !Number.isFinite(+r.v)) continue;
      const w = Number.isFinite(+r.w) && +r.w > 0 ? +r.w : 1;
      a.sum += +r.v * w; a.w += w; a.n += 1;
    }
    return {
      s: acc.social.w ? acc.social.sum / acc.social.w : null, sn: acc.social.n,
      e: acc.economic.w ? acc.economic.sum / acc.economic.w : null, en: acc.economic.n,
    };
  };

  /** mean of players' own two axes — the only source that arrives already on both */
  const meanOfPeople = (rows) => {
    let ss = 0, es = 0, n = 0;
    for (const p of rows || []) {
      if (!Number.isFinite(+p.s) || !Number.isFinite(+p.e)) continue;
      ss += +p.s; es += +p.e; n += 1;
    }
    return n ? { s: ss / n, sn: n, e: es / n, en: n } : { s: null, sn: 0, e: null, en: 0 };
  };

  /** how far a point sits from the origin, in compass units — "how polarised" */
  const radius = (p) => (p && p.s != null && p.e != null ? Math.hypot(p.s, p.e) : null);

  // ===========================================================================
  // 3. Stored state
  // ===========================================================================

  const BLANK = {
    self: null, loc: null, locName: null,
    gov: null,          // {t, policies:{slug:axis}, unknown:[], house, senate, president, court, next}
    polls: {},          // slug -> {t, mean, exact, method, mood, salience, volatility}
    protests: {},       // id  -> {t, issue, city, meter, l, r, lp, rp}
    campaigns: [],      // {t, city, issue, v, fans, corp}
    walls: {},          // cityKey -> {t, left, right, n, name}
    dom: {},            // fips -> {t, side, score, active, total, contested}
    people: {},         // username -> {t, s, sc, e, ec, city}
    cities: {},         // cityKey -> {name, id, key, kind}
    seen: {},           // path -> t, for the SOURCES tab
  };

  const CAP = { people: 500, protests: 250, campaigns: 250 };

  const data = Object.assign({}, BLANK, readJSON(K.data, {}));
  for (const k of Object.keys(BLANK)) if (data[k] == null) data[k] = BLANK[k];

  const ui = Object.assign({
    open: false, tab: 'world', everywhere: true, city: null,
    layers: { state: true, public: true, street: true, media: true, people: true },
    x: null, y: null, fab: null, size: undefined,
  }, readJSON(K.ui, {}));
  ui.layers = Object.assign({ state: true, public: true, street: true, media: true, people: true }, ui.layers);

  let saveTimer = null;
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; writeJSON(K.data, data); }, 400);
  };
  const saveUI = () => writeJSON(K.ui, ui);

  /** oldest-first trim of a keyed bag, so a long session cannot grow without bound */
  const trim = (bag, cap) => {
    const keys = Object.keys(bag);
    if (keys.length <= cap) return;
    keys.sort((a, b) => (bag[a].t || 0) - (bag[b].t || 0))
      .slice(0, keys.length - cap)
      .forEach((k) => delete bag[k]);
  };

  const cityKey = (name) => (name ? norm(name) : null);

  const noteCity = (name, extra) => {
    const k = cityKey(name);
    if (!k) return null;
    const c = data.cities[k] || (data.cities[k] = { name: String(name) });
    if (extra) Object.assign(c, extra);
    if (!c.fips) c.fips = CITY_FIPS[c.key ?? ''] ?? CITY_FIPS[k] ?? null;
    return k;
  };

  const cityName = (k) => data.cities[k]?.name ?? k;

  /** every city we know of, ordered so the world's own list wins over names we saw */
  const cityKeys = () => Object.keys(data.cities).sort((a, b) => {
    const A = data.cities[a], B = data.cities[b];
    if (!!A.id !== !!B.id) return A.id ? -1 : 1;
    return String(A.name).localeCompare(String(B.name));
  });

  // ===========================================================================
  // 4. Layers — each turns stored readings into rows the aggregator understands.
  //    `city` is a city key, or null for the whole world.
  // ===========================================================================

  const rowsState = () => Object.entries(data.gov?.policies ?? {})
    .map(([slug, v]) => ({ cat: catOf(slug), v, w: 1, issue: slug }))
    .filter((r) => r.cat);

  const rowsPublic = () => Object.entries(data.polls)
    .map(([slug, p]) => ({ cat: catOf(slug), v: p.mean, w: 1, issue: slug, t: p.t }))
    .filter((r) => r.cat && Number.isFinite(+r.v));

  const rowsStreet = (city) => Object.values(data.protests)
    .filter((p) => (city ? p.city === city : true) && p.meter != null && Number.isFinite(+p.meter))
    .map((p) => ({
      cat: catOf(p.issue), v: leanOfMeter(p.meter), w: Math.max(1, (p.l || 0) + (p.r || 0)),
      issue: p.issue, t: p.t,
    }))
    .filter((r) => r.cat);

  const rowsMedia = (city) => data.campaigns
    .filter((c) => (city ? c.city === city : true))
    .map((c) => ({ cat: catOf(c.issue), v: c.v, w: Math.max(1, c.fans || 0), issue: c.issue, t: c.t }))
    .filter((r) => r.cat && Number.isFinite(+r.v));

  const peopleRows = (city) => Object.entries(data.people)
    .filter(([, p]) => (city ? p.city === city : true))
    .map(([who, p]) => ({ who, ...p }));

  const LAYERS = [
    { key: 'state', label: 'the law', glyph: '◆', color: '#fbbf24', rows: () => rowsState(), national: true,
      hint: 'Government · the 20 policy axes as they stand' },
    { key: 'public', label: 'the public', glyph: '●', color: '#60a5fa', rows: () => rowsPublic(), national: true,
      hint: 'Opinion Polls · one issue per poll you run' },
    { key: 'street', label: 'the street', glyph: '▲', color: '#f87171', rows: (c) => rowsStreet(c),
      hint: 'Protests · live meters, weighted by heads' },
    { key: 'media', label: 'the media', glyph: '■', color: '#c084fc', rows: (c) => rowsMedia(c),
      hint: 'Home · corporate campaigns, weighted by fans' },
    { key: 'people', label: 'the citizens', glyph: '✕', color: '#34d399', people: true,
      hint: 'Profiles you opened · their own two axes' },
  ];

  const pointOf = (layer, city) => (layer.people
    ? meanOfPeople(peopleRows(city))
    : axes(layer.rows(city)));

  /** the freshest reading feeding a layer, so staleness is per-layer not per-panel */
  const freshOf = (layer, city) => {
    if (layer.key === 'state') return data.gov?.t ?? null;
    const rows = layer.people ? peopleRows(city) : layer.rows(city);
    let t = null;
    for (const r of rows) if (Number.isFinite(+r.t) && (t == null || +r.t > t)) t = +r.t;
    return t;
  };

  // ===========================================================================
  // 5. Passive tap. One wrapper, one call to the original, response bodies only.
  //    Nothing here originates a request and nothing here reads a request body.
  // ===========================================================================

  const pathOf = (u) => { try { return new URL(u, location.href).pathname; } catch { return ''; } };
  const queryOf = (u) => { try { return new URL(u, location.href).searchParams; } catch { return new URLSearchParams(); } };

  // `+null` is 0 and `+''` is 0, so a bare Number.isFinite would silently turn an
  // absent meter into a perfect deadlock. Absent stays absent.
  const num = (v) => (v == null || v === '' ? null : (Number.isFinite(+v) ? +v : null));

  const takeGovernment = (b) => {
    if (!b || !Array.isArray(b.policies)) return false;
    const policies = {}, unknown = [];
    for (const p of b.policies) {
      const slug = issueOf(p?.policy_name ?? p?.policy_id);
      const v = num(p?.axis);
      if (slug && v != null) policies[slug] = v;
      else if (p?.policy_name) unknown.push(String(p.policy_name));
    }
    if (!Object.keys(policies).length) return false;
    const chamber = (rows) => (Array.isArray(rows) ? rows
      .map((r) => ({ a: num(r?.alignment), n: num(r?.count) ?? 0 }))
      .filter((r) => r.a != null) : []);
    data.gov = {
      t: Date.now(), policies, unknown,
      house: chamber(b.house), senate: chamber(b.senate),
      court: Array.isArray(b.supreme_court)
        ? b.supreme_court.map((j) => ({ name: String(j?.name ?? '?'), a: num(j?.alignment) })).filter((j) => j.a != null)
        : [],
      president: b.president ? {
        name: String(b.president.name ?? '?'), a: num(b.president.alignment),
        fav: num(b.president.favorability), term: num(b.president.term_number),
      } : null,
      nextC: b.next_congressional_election ?? null,
      nextP: b.next_presidential_election ?? null,
    };
    return true;
  };

  /** the faction lobbying screen carries the same policy list; take only that */
  const takePolicyOnly = (b) => {
    if (!b || !Array.isArray(b.policies) || data.gov?.policies == null) return takeGovernment(b);
    let touched = false;
    for (const p of b.policies) {
      const slug = issueOf(p?.policy_name ?? p?.policy_id);
      const v = num(p?.axis);
      if (slug && v != null && data.gov.policies[slug] !== v) { data.gov.policies[slug] = v; touched = true; }
    }
    if (touched) data.gov.t = Date.now();
    return touched;
  };

  const takePoll = (b) => {
    const slug = issueOf(b?.issue);
    const m = pollMean(b);
    if (!slug || !m) return false;
    data.polls[slug] = {
      t: Date.now(), mean: m.mean, exact: m.exact, method: b.method ?? null,
      mood: b.mood ?? null, salience: b.salience ?? null, volatility: b.volatility ?? null,
    };
    return true;
  };

  /**
   * Protests arrive in four shapes — a list for a location, one protest, the home
   * page's single "active protest", and a join echo — so this walks whatever it is
   * handed rather than assuming a bare array. `city` comes from the location_id the
   * app asked for, or from a `city_name` in the row, and is filled in later if the
   * same protest turns up somewhere that knows where it is.
   */
  const takeProtests = (node, ctxCity, depth = 0) => {
    if (!node || depth > 6) return false;
    if (Array.isArray(node)) return node.map((n) => takeProtests(n, ctxCity, depth + 1)).some(Boolean);
    if (typeof node !== 'object') return false;

    let touched = false;
    const id = node.id ?? node.protest_id;
    const slug = issueOf(node.issue_id ?? node.issue ?? node.issue_key ?? node.topic);
    if (id != null && slug) {
      const key = String(id);
      const prev = data.protests[key] ?? {};
      const city = noteCity(node.city_name ?? node.location_name) ?? ctxCity ?? prev.city ?? null;
      const rec = {
        t: Date.now(), issue: slug, city,
        meter: num(node.meter) ?? prev.meter ?? null,
        l: num(node.left_count) ?? prev.l ?? 0, r: num(node.right_count) ?? prev.r ?? 0,
        lp: num(node.left_power) ?? prev.lp ?? null, rp: num(node.right_power) ?? prev.rp ?? null,
        end: node.end_ts ?? prev.end ?? null,
      };
      if (JSON.stringify({ ...prev, t: 0 }) !== JSON.stringify({ ...rec, t: 0 })) touched = true;
      data.protests[key] = rec;
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') touched = takeProtests(v, ctxCity, depth + 1) || touched;
    return touched;
  };

  const takeDominance = (b) => {
    if (!Array.isArray(b)) return false;
    let touched = false;
    for (const row of b) {
      const f = row?.state_fips == null ? null : String(row.state_fips).padStart(2, '0');
      if (!f) continue;
      data.dom[f] = {
        t: Date.now(), side: row.dominant_side ?? null, score: num(row.dominance_score) ?? 0,
        active: num(row.active_protests) ?? 0, total: num(row.total_count) ?? 0,
        contested: !!row.is_contested,
      };
      touched = true;
    }
    return touched;
  };

  const takeGraffiti = (b) => {
    if (!b || !Array.isArray(b.locations)) return false;
    const k = noteCity(b.city_name ?? b.current_location?.name ?? data.locName);
    if (!k) return false;
    let left = 0, right = 0, n = 0;
    for (const w of b.locations) {
      const l = num(w?.left_count), r = num(w?.right_count);
      if (l == null && r == null) continue;
      left += l || 0; right += r || 0; n += 1;
    }
    if (!n) return false;
    data.walls[k] = { t: Date.now(), left, right, n };
    return true;
  };

  const takeCampaigns = (b) => {
    if (!Array.isArray(b)) return false;
    const fresh = [];
    for (const c of b) {
      const slug = issueOf(c?.issue);
      const v = num(c?.alignment);
      const k = noteCity(c?.city_name);
      if (!slug || v == null) continue;
      fresh.push({
        t: Date.now(), city: k, issue: slug, v, fans: num(c?.fans) ?? 0,
        corp: c?.corporation_name ? String(c.corporation_name) : null,
        id: c?.corporation_id ?? null,
      });
    }
    if (!fresh.length) return false;
    // A campaign list is a snapshot of what is running, not an event log: replace the
    // rows for the cities this response covered rather than piling duplicates up.
    const covered = new Set(fresh.map((c) => c.city));
    data.campaigns = data.campaigns.filter((c) => !covered.has(c.city)).concat(fresh);
    if (data.campaigns.length > CAP.campaigns) data.campaigns = data.campaigns.slice(-CAP.campaigns);
    return true;
  };

  const takeLocations = (b) => {
    if (!Array.isArray(b)) return false;
    let touched = false;
    for (const l of b) {
      if (!l?.name) continue;
      noteCity(l.name, { id: l.id ?? null, key: l.key ?? null, kind: l.kind ?? null });
      touched = true;
    }
    return touched;
  };

  /**
   * Any response carrying an `alignment` object is a profile. What is kept is exactly
   * what the profile screen already shows: the two axes, the two sample sizes, and the
   * name they belong to. `location` is stored when the server sends it — as of
   * 2026-08-14 it is sealed behind the Privacy Rights policy and never arrives, which
   * is why the city view says so instead of pretending the column is empty by chance.
   */
  const takePerson = (path, b) => {
    const a = b?.alignment;
    if (!a || !Number.isFinite(+a.social_axis) || !Number.isFinite(+a.economic_axis)) return false;
    const who = typeof b.username === 'string' ? b.username
      : (/^\/api\/users\/([^/]+)$/.exec(path)?.[1] ?? null);
    if (!who) return false;
    data.people[who] = {
      t: Date.now(), s: +a.social_axis, sc: num(a.social_count) ?? 0,
      e: +a.economic_axis, ec: num(a.economic_count) ?? 0,
      city: noteCity(b.location) ?? null,
      npc: !!b.is_npc,
    };
    trim(data.people, CAP.people);
    return true;
  };

  /** collapse the variable part of a path so the SOURCES table has one row per shape */
  const seenKey = (path) => path
    .replace(/^\/api\/users\/[^/]+$/, '/api/users/{id}')
    .replace(/\/\d+/g, '/{id}');

  const consume = (path, url, body) => {
    let touched = false;
    data.seen[seenKey(path)] = Date.now();

    if (path === '/api/user/status') {
      if (typeof body?.username === 'string' && body.username !== data.self) { data.self = body.username; touched = true; }
      const id = body?.current_location_id ?? null;
      if (id !== data.loc) { data.loc = id; touched = true; }
      const nm = body?.current_location?.name ?? null;
      if (nm && nm !== data.locName) { data.locName = nm; noteCity(nm); touched = true; }
    } else if (path === '/api/government') {
      touched = takeGovernment(body) || touched;
    } else if (/^\/api\/factions\/[^/]+\/jobs$/.test(path)) {
      touched = takePolicyOnly(body) || touched;
    } else if (path === '/api/actions/poll') {
      touched = takePoll(body) || touched;
    } else if (path === '/api/protests/state-dominance') {
      touched = takeDominance(body) || touched;
    } else if (path.startsWith('/api/protests')) {
      const lid = queryOf(url).get('location_id');
      const byId = lid ? Object.entries(data.cities).find(([, c]) => String(c.id) === String(lid)) : null;
      touched = takeProtests(body, byId ? byId[0] : null) || touched;
      trim(data.protests, CAP.protests);
    } else if (path === '/api/home/active-protest') {
      touched = takeProtests(body, null) || touched;
    } else if (path === '/api/home/media-campaigns') {
      touched = takeCampaigns(body) || touched;
    } else if (path === '/api/actions/graffiti') {
      touched = takeGraffiti(body) || touched;
    } else if (path === '/api/locations') {
      touched = takeLocations(body) || touched;
    }

    // A profile can arrive from more than one path, so this runs regardless of which
    // branch above matched — including none of them.
    touched = takePerson(path, body) || touched;

    if (touched) { save(); scheduleRender(); }
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const target = args[0];
    const url = typeof target === 'string' ? target : (target?.url ?? '');
    const p = origFetch.apply(this, args);
    try {
      const path = pathOf(url);
      if (!path.startsWith('/api/')) return p;
      return p.then((res) => {
        try {
          if (res.ok && res.headers.get('content-type')?.includes('json')) {
            // clone, so the app's own consumer still gets an unread body
            res.clone().json().then((parsed) => { try { consume(path, url, parsed); } catch (e) { log('consume error', e); } }, () => {});
          }
        } catch (e) { log('tap error', e); }
        return res;
      });
    } catch (e) { log('tap error', e); }
    return p;
  };

  // ===========================================================================
  // 6. Panel
  // ===========================================================================

  let root = null, panel = null, head = null, body = null, fab = null;
  let title = null, drag = null, fabDrag = null, resize = null;

  const CSS = `
    .pkww-fab { position: fixed; left: 12px; bottom: 108px; z-index: 2147482000;
      width: 34px; height: 34px; border-radius: 17px; border: 1px solid #3f3f46;
      background: #18181b; color: #e4e4e7; font-size: 15px; line-height: 32px;
      text-align: center; cursor: pointer; user-select: none; opacity: .85; padding: 0; }
    .pkww-fab:hover { opacity: 1; }
    .pkww-panel { position: fixed; left: 12px; bottom: 148px; z-index: 2147482000;
      width: min(360px, calc(100vw - 24px)); max-height: min(80vh, 820px);
      display: flex; flex-direction: column;
      border: 1px solid #3f3f46; border-radius: 8px; background: #09090bf2; color: #e4e4e7;
      font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
    .pkww-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
      border-bottom: 1px solid #27272a; user-select: none; }
    .pkww-head h1 { flex: 1; font-size: 11px; margin: 0; color: #a1a1aa;
      text-transform: uppercase; letter-spacing: .08em; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .pkww-tabs { display: flex; gap: 0; border-bottom: 1px solid #27272a; }
    .pkww-tab { flex: 1; background: none; border: 0; border-bottom: 2px solid transparent;
      color: #71717a; font: inherit; font-size: 10px; letter-spacing: .1em;
      text-transform: uppercase; padding: 6px 2px; cursor: pointer; }
    .pkww-tab:hover { color: #d4d4d8; }
    .pkww-tab[data-on="1"] { color: #e4e4e7; border-bottom-color: #60a5fa; }
    .pkww-btn { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
      border-radius: 4px; font: inherit; font-size: 10.5px; padding: 1px 6px; cursor: pointer; }
    .pkww-btn:hover { background: #3f3f46; }
    .pkww-btn[data-on="1"] { border-color: #fbbf24; color: #fbbf24; }
    .pkww-btn[data-on="0"] { color: #52525b; }
    .pkww-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px; }
    .pkww-row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .pkww-dim { color: #a1a1aa; }
    .pkww-faint { color: #71717a; }
    .pkww-h2 { margin: 12px 0 5px; color: #a1a1aa; font-size: 10px;
      text-transform: uppercase; letter-spacing: .1em;
      border-top: 1px solid #27272a; padding-top: 8px; }
    .pkww-h2:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
    .pkww-svg { width: 100%; height: auto; display: block; }
    .pkww-note { margin: 9px 0 0; color: #71717a; font-size: 10.5px; line-height: 1.45; }
    .pkww-legend { width: 100%; border-collapse: collapse; font-size: 11px; }
    .pkww-legend td { padding: 2px 0; vertical-align: baseline; }
    .pkww-legend td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pkww-legend td.c { color: #71717a; font-size: 10px; text-align: right; white-space: nowrap; }
    .pkww-legend tr[data-off="1"] td { opacity: .38; }
    .pkww-glyph { cursor: pointer; }
    .pkww-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
    .pkww-tbl th { color: #71717a; font-weight: 400; font-size: 9.5px; text-align: right;
      text-transform: uppercase; letter-spacing: .08em; padding: 0 0 3px; border-bottom: 1px solid #27272a; }
    .pkww-tbl th:first-child, .pkww-tbl td:first-child { text-align: left; }
    .pkww-tbl td { padding: 1.5px 0 1.5px 8px; text-align: right;
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pkww-tbl td:first-child { padding-left: 0; white-space: normal; }
    .pkww-tbl tr.s td:first-child::before { content: 'S '; color: #3f3f46; }
    .pkww-tbl tr.e td:first-child::before { content: 'E '; color: #3f3f46; }
    .pkww-bar { position: relative; height: 7px; background: #18181b;
      border: 1px solid #27272a; border-radius: 2px; overflow: hidden; }
    .pkww-bar i { position: absolute; top: 0; bottom: 0; display: block; }
    .pkww-bar u { position: absolute; top: -1px; bottom: -1px; width: 1px; background: #52525b; left: 50%; }
    .pkww-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .pkww-jump { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const sign1 = (v) => (v == null ? '—' : (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)));
  const sign2 = (v) => (v == null ? '—' : (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)));

  const ago = (ms) => {
    if (!ms) return 'never';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  const compact = (n) => {
    if (!Number.isFinite(+n)) return '—';
    const v = Math.abs(+n);
    if (v >= 1e6) return `${(+n / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(+n / 1e3).toFixed(1)}k`;
    return String(Math.round(+n));
  };

  /**
   * The game's own compass, redrawn from its own constants, with a marker per layer
   * instead of one for a player. `ghost` markers are the national point drawn behind a
   * city's, so "this city versus the country" is a look rather than a subtraction.
   */
  const compass = (marks, cloud, ghosts) => {
    const n = (v) => Number(v).toFixed(2);
    const grid = [-2, -1, 1, 2].map((g) => {
      const x = n(BOX + (g + 3) / 6 * PLOT), y = n(BOX + (3 - g) / 6 * PLOT);
      return `<line x1="${x}" y1="16" x2="${x}" y2="204" stroke="rgba(255,255,255,.05)" stroke-width=".5"/>`
        + `<line x1="16" y1="${y}" x2="204" y2="${y}" stroke="rgba(255,255,255,.05)" stroke-width=".5"/>`;
    }).join('');

    const dots = (cloud || []).map((p) => `<circle cx="${n(px(p.e))}" cy="${n(py(p.s))}" r="1.5" fill="rgba(52,211,153,.30)"/>`).join('');

    const ghostEls = (ghosts || []).map((m) => {
      const x = n(px(m.e)), y = n(py(m.s));
      return `<circle cx="${x}" cy="${y}" r="3.4" fill="none" stroke="${m.color}" stroke-opacity=".28" stroke-width=".8" stroke-dasharray="1.6 1.6"/>`;
    }).join('');

    const glyphs = (marks || []).map((m) => {
      const x = +n(px(m.e)), y = +n(py(m.s));
      const shape = m.glyph === '◆' ? `<path d="M${x} ${y - 4.6}L${x + 4.6} ${y}L${x} ${y + 4.6}L${x - 4.6} ${y}Z"/>`
        : m.glyph === '▲' ? `<path d="M${x} ${y - 4.8}L${x + 4.4} ${y + 3.4}L${x - 4.4} ${y + 3.4}Z"/>`
          : m.glyph === '■' ? `<rect x="${x - 3.8}" y="${y - 3.8}" width="7.6" height="7.6"/>`
            : m.glyph === '✕' ? `<path d="M${x - 4.2} ${y - 4.2}L${x + 4.2} ${y + 4.2}M${x + 4.2} ${y - 4.2}L${x - 4.2} ${y + 4.2}" stroke="${m.color}" stroke-width="1.6" fill="none"/>`
              : `<circle cx="${x}" cy="${y}" r="4.1"/>`;
      return `<g fill="${m.color}" fill-opacity=".92">`
        + `<circle cx="${x}" cy="${y}" r="8.5" fill="none" stroke="${m.color}" stroke-opacity=".22" stroke-width=".8"/>`
        + shape + '</g>';
    }).join('');

    return `<svg viewBox="0 0 220 220" class="pkww-svg" aria-label="World political compass">
      <rect x="16" y="16" width="94" height="94" fill="rgba(220,38,38,.13)"/>
      <rect x="110" y="16" width="94" height="94" fill="rgba(37,99,235,.13)"/>
      <rect x="16" y="110" width="94" height="94" fill="rgba(22,163,74,.10)"/>
      <rect x="110" y="110" width="94" height="94" fill="rgba(202,138,4,.09)"/>
      ${grid}
      <line x1="${MID}" y1="16" x2="${MID}" y2="204" stroke="rgba(255,255,255,.14)" stroke-width=".8"/>
      <line x1="16" y1="${MID}" x2="204" y2="${MID}" stroke="rgba(255,255,255,.14)" stroke-width=".8"/>
      <rect x="16" y="16" width="188" height="188" fill="none" stroke="rgba(255,255,255,.10)" stroke-width=".8"/>
      <text x="110" y="9" text-anchor="middle" fill="rgba(220,38,38,.65)" font-size="7" font-family="ui-monospace, monospace" letter-spacing=".12em">AUTHORITY</text>
      <text x="110" y="219" text-anchor="middle" fill="rgba(22,163,74,.65)" font-size="7" font-family="ui-monospace, monospace" letter-spacing=".12em">LIBERTY</text>
      <text x="11" y="112" text-anchor="end" fill="rgba(255,255,255,.28)" font-size="7" font-family="ui-monospace, monospace">L</text>
      <text x="209" y="112" text-anchor="start" fill="rgba(255,255,255,.28)" font-size="7" font-family="ui-monospace, monospace">R</text>
      <text x="19" y="24" fill="rgba(220,38,38,.55)" font-size="5" font-family="ui-monospace, monospace" letter-spacing=".08em">AUTH·LEFT</text>
      <text x="201" y="24" text-anchor="end" fill="rgba(96,130,235,.55)" font-size="5" font-family="ui-monospace, monospace" letter-spacing=".08em">AUTH·RIGHT</text>
      <text x="19" y="201" fill="rgba(22,163,74,.55)" font-size="5" font-family="ui-monospace, monospace" letter-spacing=".08em">LIB·LEFT</text>
      <text x="201" y="201" text-anchor="end" fill="rgba(202,138,4,.55)" font-size="5" font-family="ui-monospace, monospace" letter-spacing=".08em">LIB·RIGHT</text>
      ${dots}${ghostEls}${glyphs}
    </svg>`;
  };

  /** a −3..+3 value as a centre-anchored bar; the game's own left/right colours */
  const ruler = (v, colour) => {
    const wrap = el('div', 'pkww-bar');
    if (v != null) {
      const half = Math.min(50, Math.abs(clamp3(v)) / 3 * 50);
      const i = document.createElement('i');
      i.style.background = colour || (v < 0 ? '#2563eb' : '#b91c1c');
      i.style.width = `${half}%`;
      if (v < 0) i.style.right = '50%'; else i.style.left = '50%';
      wrap.append(i);
    }
    wrap.append(document.createElement('u'));
    return wrap;
  };

  /** client-side navigation, exactly as clicking the game's own link does it */
  const jump = (href) => {
    if (location.pathname === href) return;
    const st = history.state;
    const idx = (st && Number.isFinite(st.idx) ? st.idx : 0) + 1;
    history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', href);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  };

  const jumpBtn = (label, href, why) => {
    const b = el('button', 'pkww-btn', label);
    b.title = `${why}\nSame client-side navigation as clicking the game's own link. The app fetches what that page needs, and only because you clicked.`;
    b.addEventListener('click', () => jump(href));
    return b;
  };

  const h2 = (text) => el('p', 'pkww-h2', text);

  // ---------------------------------------------------------------------------
  // WORLD
  // ---------------------------------------------------------------------------
  const renderWorld = (out) => {
    const marks = [], legend = el('table', 'pkww-legend');
    const cloud = ui.layers.people ? peopleRows(null).filter((p) => Number.isFinite(+p.s)) : [];

    for (const layer of LAYERS) {
      const p = pointOf(layer, null);
      const on = ui.layers[layer.key] !== false;
      const has = p.s != null || p.e != null;
      if (on && p.s != null && p.e != null) marks.push({ ...p, glyph: layer.glyph, color: layer.color });

      const tr = document.createElement('tr');
      tr.dataset.off = on && has ? '0' : '1';
      const g = el('td', 'pkww-glyph', layer.glyph);
      g.style.color = layer.color; g.style.width = '14px';
      g.title = `${layer.hint}\nClick to show or hide this layer`;
      g.addEventListener('click', () => { ui.layers[layer.key] = !on; saveUI(); render(); });
      const name = el('td', null, layer.label);
      name.title = layer.hint;
      tr.append(g, name,
        el('td', 'n', has ? sign2(p.s) : '—'),
        el('td', 'n', has ? sign2(p.e) : '—'),
        el('td', 'c', has ? `${layer.people ? p.sn : `${p.sn}·${p.en}`} · ${ago(freshOf(layer, null))}` : 'no reading'));
      legend.append(tr);
    }

    const chart = document.createElement('div');
    chart.innerHTML = compass(marks, cloud);
    out.append(chart);

    const hdr = document.createElement('tr');
    hdr.append(el('td', 'c', ''), el('td', 'c', ''), el('td', 'c', 'social'), el('td', 'c', 'econ'), el('td', 'c', 'n · age'));
    legend.prepend(hdr);
    out.append(legend);

    // What is missing, and the one click that would fix it. This is the whole
    // acquisition story: every row fills from a screen you were going to open anyway.
    const gaps = [];
    if (!data.gov) gaps.push(['Government', '/government', 'fills the law']);
    if (!Object.keys(data.polls).length) gaps.push(['Polls', '/actions/poll', 'fills the public']);
    if (!Object.keys(data.protests).length) gaps.push(['Protests', '/protests', 'fills the street']);
    if (!data.campaigns.length) gaps.push(['Home', '/', 'fills the media']);
    if (!Object.keys(data.people).length && data.self) gaps.push(['Your profile', `/profile/${encodeURIComponent(data.self)}`, 'first citizen']);
    if (!Object.keys(data.dom).length) gaps.push(['Travel', '/travel', 'fills the map']);
    if (gaps.length) {
      out.append(h2('nothing here yet'));
      const jrow = el('div', 'pkww-jump');
      for (const [label, href, why] of gaps) jrow.append(jumpBtn(label, href, why));
      out.append(jrow);
    }

    // Power — single-axis by nature. Congress members carry one alignment, not two,
    // so they get a ruler rather than a place on the compass.
    if (data.gov) {
      out.append(h2('power'));
      const g = data.gov;
      const t = el('table', 'pkww-tbl');
      const centre = (rows) => {
        let sum = 0, n = 0;
        for (const r of rows) { sum += r.a * (r.n || 1); n += (r.n || 1); }
        return n ? sum / n : null;
      };
      const line = (label, v, extra) => {
        const tr = document.createElement('tr');
        const c = el('td', null, label);
        const bar = el('td', null);
        bar.style.width = '46%'; bar.style.paddingLeft = '10px';
        bar.append(ruler(v));
        const val = el('td', 'n', v == null ? '—' : sign1(v));
        val.style.color = v == null ? '' : hue(v);
        tr.append(c, bar, val, el('td', 'c', extra ?? ''));
        return tr;
      };
      if (g.president) {
        t.append(line(g.president.name, g.president.a,
          `${short(g.president.a)}${g.president.fav != null ? ` · ${g.president.fav}%` : ''}`));
      }
      const hc = centre(g.house), sc = centre(g.senate), cc = centre(g.court.map((j) => ({ a: j.a, n: 1 })));
      const seats = (rows) => rows.reduce((a, r) => a + (r.n || 1), 0);
      if (g.house.length) t.append(line('house', hc, `${seats(g.house)} seats`));
      if (g.senate.length) t.append(line('senate', sc, `${seats(g.senate)} seats`));
      if (g.court.length) t.append(line('court', cc, `${g.court.length} justices`));
      out.append(t);
      const el2 = el('p', 'pkww-note',
        `Seat-weighted mean of the alignment buckets the Government screen draws. One axis only — a legislator carries a single left→right score, not a compass point.`
        + (g.nextC || g.nextP ? ` Next: congress ${g.nextC ?? '—'} · presidential ${g.nextP ?? '—'}.` : ''));
      out.append(el2);
    }

    out.append(h2('how to read this'));
    out.append(el('p', 'pkww-note',
      'Five populations, five readings, one chart. Each is the mean of the −3..+3 numbers that source '
      + 'carries, split by the axis the game itself files each issue under — 13 social issues, 7 economic. '
      + 'The split is the game\'s; putting the two means on a compass is this tool\'s, and the game never '
      + 'does it. n is how many readings went in (social·economic), so a point built from two is visibly '
      + 'not a point built from twenty. Click a glyph to hide its layer.'));
    if (data.gov?.unknown?.length) {
      out.append(el('p', 'pkww-note', `Unfiled policy names, counted rather than dropped: ${data.gov.unknown.join(', ')}.`));
    }
  };

  // ---------------------------------------------------------------------------
  // CITIES
  // ---------------------------------------------------------------------------
  const renderCities = (out) => {
    const keys = cityKeys();
    if (!keys.length) {
      out.append(el('p', 'pkww-dim', 'No city has been named yet. The Travel screen lists every one of them; the home page names one per media campaign.'));
      const jrow = el('div', 'pkww-jump');
      jrow.append(jumpBtn('Travel', '/travel', 'lists the world\'s cities and the state map'));
      jrow.append(jumpBtn('Home', '/', 'names cities via media campaigns'));
      out.append(jrow);
      return;
    }
    if (!ui.city || !data.cities[ui.city]) ui.city = keys[0];

    const chips = el('div', 'pkww-chips');
    for (const k of keys) {
      const b = el('button', 'pkww-btn', cityName(k));
      b.dataset.on = k === ui.city ? '1' : '0';
      b.addEventListener('click', () => { ui.city = k; saveUI(); render(); });
      chips.append(b);
    }
    out.append(chips);

    const city = ui.city;
    const marks = [], ghosts = [];
    const cloud = ui.layers.people ? peopleRows(city).filter((p) => Number.isFinite(+p.s)) : [];
    const legend = el('table', 'pkww-legend');
    const hdr = document.createElement('tr');
    hdr.append(el('td', 'c', ''), el('td', 'c', ''), el('td', 'c', 'social'), el('td', 'c', 'econ'), el('td', 'c', 'vs nation'));
    legend.append(hdr);

    for (const layer of LAYERS) {
      if (layer.national) continue; // the law and the polls are country-wide, not city-wide
      const p = pointOf(layer, city);
      const nat = pointOf(layer, null);
      const on = ui.layers[layer.key] !== false;
      const has = p.s != null && p.e != null;
      if (on && has) {
        marks.push({ ...p, glyph: layer.glyph, color: layer.color });
        if (nat.s != null && nat.e != null) ghosts.push({ ...nat, color: layer.color });
      }
      const tr = document.createElement('tr');
      tr.dataset.off = on && has ? '0' : '1';
      const g = el('td', 'pkww-glyph', layer.glyph);
      g.style.color = layer.color; g.style.width = '14px';
      g.addEventListener('click', () => { ui.layers[layer.key] = !on; saveUI(); render(); });
      const d = has && nat.s != null
        ? `${sign1(p.s - nat.s)} / ${sign1(p.e - nat.e)}`
        : '—';
      tr.append(g, el('td', null, layer.label),
        el('td', 'n', has ? sign2(p.s) : '—'),
        el('td', 'n', has ? sign2(p.e) : '—'),
        el('td', 'c', d));
      legend.append(tr);
    }

    const chart = document.createElement('div');
    chart.innerHTML = compass(marks, cloud, ghosts);
    out.append(chart);
    out.append(legend);
    out.append(el('p', 'pkww-note',
      `Solid markers are ${cityName(city)}. The dashed rings behind them are the same layer for the whole world, `
      + 'so the gap is the city\'s own politics. The law and the polls are country-wide and sit on the WORLD tab only.'));

    // Single-axis city readings: walls and the state map. Neither splits by issue —
    // a wall has a side and no subject — so neither can be a compass point.
    const w = data.walls[city];
    const c = data.cities[city];
    const dom = c?.fips ? data.dom[c.fips] : null;
    out.append(h2('one-axis readings'));
    const t = el('table', 'pkww-tbl');
    const line = (label, v, extra, title) => {
      const tr = document.createElement('tr');
      if (title) tr.title = title;
      const bar = el('td', null); bar.style.width = '44%'; bar.style.paddingLeft = '10px';
      bar.append(ruler(v));
      tr.append(el('td', null, label), bar, el('td', 'n', sign1(v)), el('td', 'c', extra ?? ''));
      return tr;
    };
    if (w) {
      const lean = leanOfCounts(w.left, w.right);
      const tot = w.left + w.right;
      t.append(line('walls', lean,
        tot ? `L ${Math.round(w.left / tot * 100)}% · R ${Math.round(w.right / tot * 100)}% · ${w.n} walls` : `${w.n} walls`,
        'Graffiti · the citywide pulse the game itself sums, redrawn on the −3..+3 scale'));
    }
    if (dom) {
      t.append(line(`state ${FIPS[c.fips] ?? c.fips}`, leanOfDominance(dom),
        `${dom.active} active · ${compact(dom.total)}${dom.contested ? ' · contested' : ''}`,
        'Travel · /protests/state-dominance, the map the game colours its own states with'));
    }
    if (!w && !dom) out.append(el('p', 'pkww-faint', 'Nothing yet — open Graffiti while you are in this city, or Travel for the state map.'));
    else out.append(t);

    const people = peopleRows(city);
    out.append(h2('citizens here'));
    if (people.length) {
      out.append(el('p', 'pkww-dim', `${people.length} profile${people.length === 1 ? '' : 's'} placed in ${cityName(city)}.`));
    } else {
      out.append(el('p', 'pkww-faint',
        'None — a profile only carries a city while the Privacy Rights policy leaves it unsealed, and as of the last field check it does not. '
        + 'Every profile you open still counts on the WORLD tab; only the city column is blank, and it is blank by policy rather than by luck.'));
    }

    // The whole state map, not just the states our cities sit in — the endpoint hands
    // over every one of them at once, so throwing the rest away would be a choice.
    const doms = Object.entries(data.dom)
      .filter(([, d]) => d.active > 0 || d.total > 0)
      .sort((a, b) => (b[1].total || 0) - (a[1].total || 0));
    if (doms.length) {
      out.append(h2(`the map · ${doms.length} states`));
      const st = el('table', 'pkww-tbl');
      const hr = document.createElement('tr');
      hr.append(el('th', null, 'state'), el('th', null, ''), el('th', null, 'lean'), el('th', null, 'active · total'));
      st.append(hr);
      for (const [f, d] of doms.slice(0, 20)) {
        const bar = el('td', null); bar.style.width = '38%'; bar.style.paddingLeft = '10px';
        bar.append(ruler(leanOfDominance(d)));
        const tr = document.createElement('tr');
        if (c?.fips === f) tr.style.color = '#fbbf24';
        tr.append(el('td', null, FIPS[f] ?? f), bar,
          el('td', 'n', sign1(leanOfDominance(d))),
          el('td', 'c', `${d.active} · ${compact(d.total)}${d.contested ? ' ⚑' : ''}`));
        st.append(tr);
      }
      out.append(st);
      if (doms.length > 20) out.append(el('p', 'pkww-faint', `${doms.length - 20} quieter states not listed.`));
      out.append(el('p', 'pkww-note', `⚑ marks a state the server itself calls contested. Read ${ago(Object.values(data.dom)[0]?.t)} ago on the Travel screen.`));
    }
  };

  // ---------------------------------------------------------------------------
  // ISSUES
  // ---------------------------------------------------------------------------
  const renderIssues = (out) => {
    const street = {}, media = {};
    for (const r of rowsStreet(null)) (street[r.issue] ??= []).push(r);
    for (const r of rowsMedia(null)) (media[r.issue] ??= []).push(r);
    const wmean = (rows) => {
      if (!rows?.length) return null;
      let s = 0, w = 0;
      for (const r of rows) { const q = Math.max(1, r.w || 1); s += r.v * q; w += q; }
      return w ? s / w : null;
    };

    const t = el('table', 'pkww-tbl');
    const hr = document.createElement('tr');
    hr.append(el('th', null, 'issue'), el('th', null, 'law'), el('th', null, 'public'), el('th', null, 'street'), el('th', null, 'media'));
    t.append(hr);

    let covered = 0;
    for (const slug of ORDER) {
      const cat = catOf(slug);
      const law = data.gov?.policies?.[slug];
      const poll = data.polls[slug];
      const stv = wmean(street[slug]), mev = wmean(media[slug]);
      if (law != null || poll || stv != null || mev != null) covered += 1;
      const tr = document.createElement('tr');
      tr.className = cat === 'social' ? 's' : 'e';
      tr.title = `${labelOf(slug)} · ${cat} axis`;
      const lawTd = el('td', 'n', law == null ? '·' : sign1(law));
      if (law != null) lawTd.style.color = hue(law);
      const pollTd = el('td', 'n', poll ? sign1(poll.mean) : '·');
      if (poll) {
        pollTd.style.color = hue(poll.mean);
        pollTd.title = `${poll.exact ? 'exact' : 'coarse'} · ${poll.method ?? '?'} · ${poll.mood ?? 'mood unknown'} · ${ago(poll.t)} ago`;
        if (!poll.exact) pollTd.style.opacity = '.7';
      }
      tr.append(el('td', null, labelOf(slug)), lawTd, pollTd,
        el('td', 'n', stv == null ? '·' : sign1(stv)),
        el('td', 'n', mev == null ? '·' : sign1(mev)));
      t.append(tr);
    }
    out.append(t);
    out.append(el('p', 'pkww-note',
      `${covered} of 20 issues carry at least one reading. S and E mark which axis the game files an issue under. `
      + 'A dimmed poll figure came from a street or online poll, which the game itself calls noisy or biased; '
      + 'the professional and focus-group methods return all seven buckets and are printed at full strength.'));

    const polled = Object.entries(data.polls);
    if (polled.length) {
      out.append(h2('poll notes'));
      const nt = el('table', 'pkww-tbl');
      for (const [slug, p] of polled.sort((a, b) => b[1].t - a[1].t)) {
        const tr = document.createElement('tr');
        tr.append(el('td', null, labelOf(slug)),
          el('td', 'c', p.mood ?? '—'),
          el('td', 'c', p.salience ? `salience ${p.salience}` : ''),
          el('td', 'c', p.volatility ? `${p.volatility}` : ''),
          el('td', 'c', `${ago(p.t)} ago`));
        nt.append(tr);
      }
      out.append(nt);
    }
    const jrow = el('div', 'pkww-jump');
    jrow.append(jumpBtn('Opinion Polls', '/actions/poll', 'one issue per poll, and it costs energy'));
    jrow.append(jumpBtn('Government', '/government', 'all 20 policy axes at once'));
    out.append(jrow);
  };

  // ---------------------------------------------------------------------------
  // SOURCES
  // ---------------------------------------------------------------------------
  const SOURCES = [
    ['/api/government', 'the law · 20 policy axes, chambers, court', '/government', 'Government'],
    ['/api/actions/poll', 'the public · one issue per poll', '/actions/poll', 'Polls'],
    ['/api/protests', 'the street · live meters', '/protests', 'Protests'],
    ['/api/protests/state-dominance', 'the map · every US state', '/travel', 'Travel'],
    ['/api/home/media-campaigns', 'the media · per city, per issue', '/', 'Home'],
    ['/api/actions/graffiti', 'walls · the city you are in', '/actions/graffiti', 'Graffiti'],
    ['/api/locations', 'the world\'s cities', '/travel', 'Travel'],
    ['/api/users/{id}', 'citizens · one profile at a time', null, null],
    ['/api/user/status', 'your name and current city', null, null],
  ];

  const renderSources = (out) => {
    out.append(el('p', 'pkww-note',
      'Every row is a response the game fetched for a page you opened. This tool asks for none of them; '
      + 'it reads what arrives and stores the numbers above. Nothing is polled, prefetched or retried.'));
    const t = el('table', 'pkww-tbl');
    const hr = document.createElement('tr');
    hr.append(el('th', null, 'endpoint'), el('th', null, 'last seen'));
    t.append(hr);
    for (const [path, what, href, label] of SOURCES) {
      const seen = data.seen[path] ?? (path === '/api/protests'
        ? Math.max(0, ...Object.keys(data.seen).filter((k) => k.startsWith('/api/protests')).map((k) => data.seen[k])) || null
        : null);
      const tr = document.createElement('tr');
      tr.title = what;
      const c1 = el('td', null, path.replace('/api', ''));
      if (!seen) c1.style.color = '#52525b';
      const c2 = el('td', 'c', seen ? `${ago(seen)} ago` : 'not yet');
      tr.append(c1, c2);
      const c3 = el('td', null);
      if (href) c3.append(jumpBtn(label, href, what));
      tr.append(c3);
      t.append(tr);
    }
    out.append(t);

    out.append(h2('held locally'));
    const held = el('table', 'pkww-tbl');
    const rowOf = (k, v, extra) => {
      const tr = document.createElement('tr');
      tr.append(el('td', null, k), el('td', 'n', String(v)), el('td', 'c', extra ?? ''));
      return tr;
    };
    held.append(rowOf('policies', Object.keys(data.gov?.policies ?? {}).length, data.gov ? `${ago(data.gov.t)} ago` : ''));
    held.append(rowOf('polls', Object.keys(data.polls).length, 'latest per issue'));
    held.append(rowOf('protests', Object.keys(data.protests).length, `cap ${CAP.protests}`));
    held.append(rowOf('campaigns', data.campaigns.length, `cap ${CAP.campaigns}`));
    held.append(rowOf('wall reads', Object.keys(data.walls).length, 'one per city'));
    held.append(rowOf('states', Object.keys(data.dom).length, ''));
    held.append(rowOf('citizens', Object.keys(data.people).length, `cap ${CAP.people}`));
    held.append(rowOf('cities', Object.keys(data.cities).length, ''));
    let bytes = 0;
    try { bytes = (localStorage.getItem(K.data) ?? '').length; } catch { /* private mode */ }
    held.append(rowOf('storage', `${(bytes / 1024).toFixed(1)}kB`, K.data));
    out.append(held);

    const row = el('div', 'pkww-jump');
    const copy = el('button', 'pkww-btn', 'copy');
    copy.title = 'Copy the current tab as tab-separated text, to the clipboard, on this click only';
    copy.addEventListener('click', () => {
      const lines = [];
      lines.push(['layer', 'scope', 'social', 'economic', 'n_social', 'n_economic'].join('\t'));
      for (const layer of LAYERS) {
        const p = pointOf(layer, null);
        lines.push([layer.label, 'world', p.s ?? '', p.e ?? '', p.sn, p.en].join('\t'));
      }
      for (const k of cityKeys()) {
        for (const layer of LAYERS) {
          if (layer.national) continue;
          const p = pointOf(layer, k);
          if (p.s == null && p.e == null) continue;
          lines.push([layer.label, cityName(k), p.s ?? '', p.e ?? '', p.sn, p.en].join('\t'));
        }
      }
      lines.push('');
      lines.push(['issue', 'axis', 'law', 'public'].join('\t'));
      for (const slug of ORDER) {
        lines.push([labelOf(slug), catOf(slug), data.gov?.policies?.[slug] ?? '', data.polls[slug]?.mean ?? ''].join('\t'));
      }
      navigator.clipboard?.writeText(lines.join('\n')).then(
        () => { copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy'; }, 1200); },
        () => { copy.textContent = 'blocked'; setTimeout(() => { copy.textContent = 'copy'; }, 1200); },
      );
    });
    const wipe = el('button', 'pkww-btn', 'wipe');
    wipe.title = 'Forget every reading and start over';
    wipe.addEventListener('click', () => {
      if (wipe.dataset.arm !== '1') {
        wipe.dataset.arm = '1'; wipe.textContent = 'sure?';
        setTimeout(() => { wipe.dataset.arm = '0'; wipe.textContent = 'wipe'; }, 3000);
        return;
      }
      for (const k of Object.keys(BLANK)) data[k] = Array.isArray(BLANK[k]) ? [] : (typeof BLANK[k] === 'object' && BLANK[k] ? {} : BLANK[k]);
      writeJSON(K.data, data);
      render();
    });
    row.append(copy, wipe);
    out.append(row);

    out.append(el('p', 'pkww-note',
      'What this cannot be: live. Nothing here refreshes on its own, because refreshing would mean asking, '
      + 'and asking is the line this repo does not cross. Every figure is as old as the last time you looked '
      + 'at the screen that carries it — the age beside each row is the whole caveat.'));
  };

  // ---------------------------------------------------------------------------

  const TABS = [
    ['world', 'world', renderWorld],
    ['cities', 'cities', renderCities],
    ['issues', 'issues', renderIssues],
    ['sources', 'sources', renderSources],
  ];

  const render = () => {
    if (!body || document.hidden || !ui.open) return;
    body.textContent = '';
    const tab = TABS.find((t) => t[0] === ui.tab) ?? TABS[0];
    try { tab[2](body); }
    catch (e) { log('render error', e); body.append(el('p', 'pkww-faint', `render failed: ${e && e.message}`)); }
    for (const b of head.parentNode.querySelectorAll('.pkww-tab')) b.dataset.on = b.dataset.tab === ui.tab ? '1' : '0';
    drag?.fit();
  };

  let renderTimer = null;
  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 250);
  };

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

  const onHome = () => ui.everywhere || location.pathname === '/';

  const sync = () => {
    if (!root) return;
    const show = onHome();
    root.style.display = show ? '' : 'none';
    panel.style.display = show && ui.open ? 'flex' : 'none';
    fab.setAttribute('aria-expanded', String(ui.open));
    const n = Object.keys(data.people).length;
    title.textContent = `world compass${n ? ` · ${n} seen` : ''}`;
    if (show && ui.open) {
      drag.apply(ui);
      resize.apply(ui.size);   // display:none has no geometry, so restore on show
      render();      // content decides the height…
      drag.fit();    // …so only now can we be sure the header is still reachable
      fabDrag?.fit();
    }
  };

  const mount = () => {
    if (root) return;
    root = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);

    fab = el('button', 'pkww-fab', '⊕');
    fab.title = 'Politiko World Watch (passive) — drag to move';
    fab.addEventListener('click', () => {
      if (fabDrag.dragged()) return; // that gesture was a drag, not a click
      ui.open = !ui.open; saveUI(); sync();
    });
    root.append(fab);

    panel = el('div', 'pkww-panel');
    head = el('div', 'pkww-head');
    head.title = 'Drag to move · drag the bottom-right corner to resize · double-click to snap back';
    title = el('h1', '', 'world compass');

    const pinBtn = el('button', 'pkww-btn', 'home only');
    pinBtn.title = 'Show this panel only on the home page instead of everywhere';
    pinBtn.dataset.on = ui.everywhere ? '0' : '1';
    pinBtn.addEventListener('click', () => {
      ui.everywhere = !ui.everywhere; saveUI();
      pinBtn.dataset.on = ui.everywhere ? '0' : '1';
      sync();
    });

    const close = el('button', 'pkww-btn', '×');
    close.title = 'Hide (the ⊕ button brings it back)';
    close.addEventListener('click', () => { ui.open = false; saveUI(); sync(); });

    head.append(title, pinBtn, close);

    const tabs = el('div', 'pkww-tabs');
    for (const [key, label] of TABS) {
      const b = el('button', 'pkww-tab', label);
      b.dataset.tab = key;
      b.dataset.on = ui.tab === key ? '1' : '0';
      b.addEventListener('click', () => { ui.tab = key; saveUI(); render(); });
      tabs.append(b);
    }

    body = el('div', 'pkww-body');
    panel.append(head, tabs, body);
    root.append(panel);
    document.documentElement.append(root);

    drag = draggable(panel, head, (pos) => { Object.assign(ui, pos ?? { x: null, y: null }); saveUI(); });
    resize = resizable(panel, (size) => { ui.size = size ?? undefined; saveUI(); },
      { drag, minW: 260, minH: 200 });
    // Double-click the header undoes both — the recovery path for a panel dragged
    // or resized into uselessness.
    head.addEventListener('dblclick', () => { drag.reset(); resize.reset(); });

    // the FAB moves too — it is UI in the way just as much as the panel is
    fabDrag = draggable(fab, fab, (pos) => { ui.fab = pos; saveUI(); });
    fabDrag.apply(ui.fab);

    sync();
  };

  // ---------------------------------------------------------------------------
  // SPA lifecycle — React Router means no page loads
  // ---------------------------------------------------------------------------
  let lastPath = null;
  const checkRoute = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    sync();
  };
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) { const r = orig.apply(this, a); queueMicrotask(checkRoute); return r; };
  }
  window.addEventListener('popstate', checkRoute);

  // Freshness text ages; nothing else needs a clock. Visible tab only, and never
  // while the pointer is inside the panel — a redraw under the cursor loses a click.
  setInterval(() => { if (!document.hidden && ui.open && onHome() && !panel?.matches(':hover')) render(); }, 20_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRender(); });

  const boot = () => { mount(); checkRoute(); log('ready', data.self ? `as @${data.self}` : '(session unknown yet)'); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
