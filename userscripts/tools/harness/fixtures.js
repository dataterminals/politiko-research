// Canned payloads for the panel harness.
//
// Every shape here was read off a client bundle in artifacts/, not off the wire — the
// same standard as the docs/ files. That means a fixture proves what the *client*
// expects, which is exactly what a panel is written against. Where a real capture later
// contradicts one of these, fix the fixture and say so in the matching docs/ file.
//
// To add a tool: give it an entry keyed by its script's basename (without `.user.js`),
// list the calls its panel feeds on, and the harness does the rest.
window.HARNESS_FIXTURES = {

  'quick-jump': {
    label: 'Quick Jump',
    hotkey: 'Alt+J',
    source: 'docs/12-navigation-surface.md',
    note: 'Fire the directory first — that is the call that teaches it every casino.',
    calls: [
      {
        label: 'directory page 1',
        path: '/api/corporations?page=1',
        body: {
          total: 4, pages: 1,
          items: [
            { id: 7, name: 'The House', type: 'casino', location_name: 'Tijuana', is_active: true },
            { id: 40, name: 'Aurora Rooms', type: 'casino', location_name: 'Vegas', is_active: true },
            { id: 55, name: 'Halcyon Gaming', type: 'casino', location_name: 'Reno', is_active: true },
            { id: 12, name: 'Meridian Logistics', type: 'logistics', location_name: 'Vegas', is_active: true },
            { id: 30, name: 'Dead Letter Media', type: 'media', location_name: 'Tijuana', is_active: false },
          ],
        },
      },
      {
        label: 'casino 7 — you are in its city',
        path: '/api/corporations/7/casino',
        body: {
          operational: true, wagering_suspended: false, current_city_access: true,
          venues: [{ property_id: 501, location_name: 'Tijuana' }],
          // craps is `live` here on purpose: the lobby hides it, and so must we
          games: [
            { key: 'blackjack', status: 'live' }, { key: 'slots', status: 'live' },
            { key: 'roulette', status: 'live' }, { key: 'poker', status: 'live' },
            { key: 'predictions', status: 'live' }, { key: 'craps', status: 'live' },
          ],
          available_dealers: 2, dealer_capacity: 4, reserve_balance: 250_000,
          prediction_fee_bps: 250, poker_rake_bps: 500, slots_rtp_bps: 9_400,
        },
      },
      {
        label: 'casino 40 — wrong city',
        path: '/api/corporations/40/casino',
        body: {
          operational: true, wagering_suspended: false, current_city_access: false,
          venues: [{ property_id: 777, location_name: 'Vegas' }, { property_id: 778, location_name: 'Reno' }],
          games: [{ key: 'blackjack', status: 'live' }, { key: 'slots', status: 'live' }],
          available_dealers: 0, dealer_capacity: 2, reserve_balance: 12_000,
          prediction_fee_bps: 300, poker_rake_bps: 500, slots_rtp_bps: 9_100,
        },
      },
      {
        label: 'casino 40 — fined, wagering suspended',
        path: '/api/corporations/40/casino',
        variant: 'suspended',
        body: {
          operational: true, wagering_suspended: true, current_city_access: true,
          venues: [{ property_id: 777, location_name: 'Vegas' }],
          games: [{ key: 'blackjack', status: 'live' }],
          available_dealers: 1, dealer_capacity: 2, reserve_balance: 400,
        },
      },
      {
        // a real casino corp that has not acquired a property yet — the client has copy
        // for this ("Awaiting a venue"), so it must still be listed
        label: 'casino 55 — typed casino, no venue yet',
        path: '/api/corporations/55/casino',
        body: {
          operational: false, wagering_suspended: false, current_city_access: false,
          venues: [], games: [], available_dealers: 0, dealer_capacity: 0, reserve_balance: 0,
        },
      },
      {
        // The corp page fetches /casino for EVERY corporation it renders, so a summary
        // can arrive attached to a haulage company. Firing this must NOT put Meridian
        // in the casino block — that is what `operational` gates. Watch the panel.
        label: 'casino body on a logistics corp (must NOT be listed)',
        path: '/api/corporations/12/casino',
        body: {
          operational: false, wagering_suspended: false, current_city_access: false,
          venues: [], games: [], available_dealers: 0, dealer_capacity: 0, reserve_balance: 0,
        },
      },
      {
        label: 'my corporation',
        path: '/api/corporations/mine',
        body: { id: 9, name: 'Bergen Holdings', type: 'financial', location_name: 'Tijuana', is_active: true },
      },
      {
        label: 'my faction',
        path: '/api/factions/mine',
        body: { faction: { id: 3, name: 'RE:PUBLIC' }, ranks: [], members: [] },
      },
      {
        label: 'something unrelated (must be ignored)',
        path: '/api/stocks/holdings',
        body: [{ id: 1, symbol: 'CAP', qty: 40 }],
      },
    ],
  },

  'people-watch': {
    label: 'People Watch',
    hotkey: 'Alt+P',
    source: 'docs/05-people-surface.md',
    note: 'Fire the roster pages, scroll the table down, then fire a profile — the list '
      + 'must stay exactly where you left it.',
    calls: (() => {
      const at = (ms) => new Date(Date.now() + ms).toISOString();
      const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
      const NAMES = ['ana', 'bo', 'cy', 'dev', 'eze', 'fen', 'gil', 'hana', 'ivo', 'jun',
        'kai', 'lior', 'mira', 'noor', 'oz', 'pia', 'quin', 'rae', 'sol', 'tov',
        'uma', 'vex', 'wren', 'xan', 'yaz', 'zia', 'ada', 'bex', 'caro', 'dot'];

      // Enough rows that the table actually scrolls — the whole point of the fixture.
      const page = (n) => ({
        page: n, total: NAMES.length, total_pages: 3, locations_visible: false,
        people: NAMES.slice((n - 1) * 10, n * 10).map((u, i) => ({
          username: u, rank_key: 'street', is_online: i % 7 === 0,
          last_online: at(-((n * 10 + i) % 19) * HOUR), status: 'idle',
        })),
      });

      const profile = (u, over = {}) => ({
        username: u, rank_key: 'street', is_online: false,
        created_at: at(-40 * DAY), last_online: at(-6 * HOUR), status: 'idle',
        attacks_won: 3, attacks_lost: 5,
        alignment: { social_count: 12, economic_count: 4 },
        ...over,
      });

      // Only PROFILED players get a table row — a roster page alone just teaches it a
      // username. So the bulk of this fixture is profiles: enough of them that the table
      // genuinely scrolls, which is the only way to see the thing being tested.
      const bulk = NAMES.slice(0, 22).map((u, i) => ({
        label: `profile: ${u}`,
        path: `/api/users/${u}`,
        body: profile(u, {
          last_online: at(-(i * 5 + 1) * HOUR),
          attacks_won: i % 6, attacks_lost: (i * 3) % 7,
          alignment: { social_count: (i * 7) % 45, economic_count: i % 5 },
          // a handful who signed up and left within the hour — the ◦ mark
          ...(i % 9 === 4 ? { created_at: at(-30 * DAY - 39 * MIN), last_online: at(-30 * DAY) } : {}),
        }),
      }));

      return [
        { label: 'roster page 1', path: '/api/people?page=1', body: page(1) },
        { label: 'roster page 2', path: '/api/people?page=2', body: page(2) },
        { label: 'roster page 3', path: '/api/people?page=3', body: page(3) },
        ...bulk,
        {
          label: 'mira again, freshly seen (scroll down first — you must not move)',
          path: '/api/users/mira',
          variant: 'refresh',
          body: profile('mira', { alignment: { social_count: 41, economic_count: 9 } }),
        },
        {
          label: 'something unrelated (must be ignored)',
          path: '/api/stocks/holdings',
          body: [{ id: 1, symbol: 'CAP', qty: 40 }],
        },
      ];
    })(),
  },

  'raid-watch': {
    label: 'Raid Watch',
    hotkey: 'Alt+R',
    source: 'docs/11-faction-raid-surface.md',
    note: 'The faction page re-polls this every 5s, so fire the poll repeatedly — nothing '
      + 'should accumulate, and the panel must stay draggable while it does.',
    calls: (() => {
      const at = (ms) => new Date(Date.now() + ms).toISOString();
      const MIN = 60_000;
      const raid = (over = {}) => ({
        id: 7, status: 'active',
        attacker_faction_id: 3, attacker_faction_name: 'RE:PUBLIC', defender_faction_name: 'Harbour Bloc',
        attacker_score: 100, defender_score: 80, attacker_members: 4, defender_members: 6,
        attacker_power_taken: 10, defender_power_taken: 25,
        committed_power: 500, committed_cash: 1000, cycle_month: 'September',
        created_at: at(-40 * MIN), last_scored_at: at(-2 * MIN), ...over,
      });
      const ev = (id, over = {}) => ({
        id, event_type: 'raid_hit', actor_username: 'ana', target_username: 'bo',
        score_delta: 5, power_delta: -2, created_at: at(-30 * MIN), ...over,
      });
      const P = '/api/factions/3/raids?events_page=1&events_limit=5';
      return [
        {
          label: 'raid poll — fire me several times, nothing may accumulate',
          path: P,
          body: { raids: [raid()], events: [ev(1), ev(2, { event_type: 'power_drain', score_delta: 0 })] },
        },
        {
          label: 'the score moves (one new sample, not one per poll)',
          path: P,
          variant: 'scored',
          body: {
            raids: [raid({ attacker_score: 140, defender_score: 92, last_scored_at: at(0) })],
            events: [ev(1), ev(2, { event_type: 'power_drain', score_delta: 0 }),
              ev(3, { event_type: 'sabotage', actor_username: 'cy', score_delta: 40 })],
          },
        },
        {
          label: 'a finished raid report (authoritative score_history)',
          path: '/api/factions/3/raids/7/report',
          body: {
            raid: raid({ status: 'concluded' }),
            score_history: [
              { at: at(-40 * MIN), attacker: 0, defender: 0 },
              { at: at(-20 * MIN), attacker: 60, defender: 45 },
              { at: at(0), attacker: 140, defender: 92 },
            ],
            events: [ev(1), ev(3, { event_type: 'sabotage', actor_username: 'cy', score_delta: 40 })],
          },
        },
        {
          label: 'something unrelated (must be ignored)',
          path: '/api/stocks/holdings',
          body: [{ id: 1, symbol: 'CAP', qty: 40 }],
        },
      ];
    })(),
  },

  'sleeper-watch': {
    label: 'Sleeper Watch',
    hotkey: 'Alt+S',
    source: 'docs/08-sleeper-surface.md',
    note: 'Every lead timestamp is relative to when you loaded this page, so the countdowns '
      + 'are live. Fire the poll, then fire it again WITHOUT Dov Mena to watch a lead end.',
    // Timestamps have to be relative or every state would be "missed" by the time anyone
    // opened the bench, so this entry builds its own rather than hardcoding instants.
    calls: (() => {
      const at = (ms) => new Date(Date.now() + ms).toISOString();
      const MIN = 60_000, HOUR = 60 * MIN;

      const site = (id, name, security_level, description) => ({ id, name, security_level, description });
      const header = {
        districts: [{
          name: 'Downtown',
          sites: [
            site(1, 'City Hall', 72, 'Clerks, aides, and people who owe favours.'),
            site(2, '14th Precinct', 88, 'Hard to work, worth more if you can.'),
            site(3, 'Harbour Authority', 41, 'Nobody watches the harbour.'),
          ],
        }],
        issues: ['Housing', 'Crime', 'Jobs', 'Corruption'],
        faction_name: 'RE:PUBLIC',
        location_name: 'Tijuana',
        window_minutes: 60,
        recruited_count: 2,
        sleeper_cap: 5,
        energy_cost: 10,
        sleepers: [
          {
            id: 9, display_name: 'Ines Roth', archetype_name: 'Clerk', site_name: 'City Hall',
            effectiveness: 62, issue: 'Housing', traits: { clue: 'Housing' },
            recruited_at: at(-6 * 24 * HOUR),
          },
          {
            id: 11, display_name: 'Sabri Kohl', archetype_name: 'Inspector', site_name: '14th Precinct',
            effectiveness: 34, issue: 'Corruption', traits: { clue: 'Corruption' },
            recruited_at: at(-2 * 24 * HOUR),
          },
        ],
      };

      // One lead in each state the client can render, so the panel's ordering, badges and
      // strip can all be checked in a single click.
      const leads = {
        open: {
          id: 1, display_name: 'Ariel Voss', archetype_name: 'Staffer', site_name: 'City Hall',
          issue: 'Housing', traits: { clue: 'talks about rent, constantly' }, status: 'meeting',
          next_meeting_at: at(-12 * MIN), expires_at: at(48 * MIN), meeting_count: 2,
        },
        closing: {
          id: 2, display_name: 'Dov Mena', archetype_name: 'Union rep', site_name: 'Harbour Authority',
          issue: 'Jobs', traits: { clue: 'the yard laid off forty people' }, status: 'meeting',
          next_meeting_at: at(-56 * MIN), expires_at: at(4 * MIN), meeting_count: 4,
        },
        fresh: {
          id: 3, display_name: 'Petra Lang', archetype_name: 'Aide', site_name: 'City Hall',
          issue: 'Corruption', traits: { clue: 'asks who signed off on it' }, status: 'lead',
          next_meeting_at: null, expires_at: null, meeting_count: 0,
        },
        waiting: {
          id: 4, display_name: 'Emre Sarr', archetype_name: 'Sergeant', site_name: '14th Precinct',
          issue: 'Crime', traits: { clue: 'wants more patrols' }, status: 'meeting',
          next_meeting_at: at(23 * HOUR + 40 * MIN), expires_at: at(24 * HOUR + 40 * MIN), meeting_count: 1,
        },
        soon: {
          id: 5, display_name: 'Nils Aebi', archetype_name: 'Journalist', site_name: 'Harbour Authority',
          issue: 'Corruption', traits: { clue: 'has been asking about the harbour' }, status: 'meeting',
          next_meeting_at: at(9 * MIN), expires_at: at(69 * MIN), meeting_count: 3,
        },
        missed: {
          id: 6, display_name: 'Rae Okonkwo', archetype_name: 'Contractor', site_name: 'City Hall',
          issue: 'Housing', traits: { clue: 'builds what the council approves' }, status: 'meeting',
          next_meeting_at: at(-3 * HOUR), expires_at: at(-2 * HOUR), meeting_count: 5,
        },
      };

      return [
        {
          label: 'recruitment poll — one lead in every state',
          path: '/api/actions/sleeper-recruitment',
          body: { ...header, leads: Object.values(leads) },
        },
        {
          // The poll returns the WHOLE list, so a lead that stops appearing has ended.
          // Fire this after the one above: Dov Mena vanishes mid-window, which is the
          // shape of a conversion, and the research tab should gain one ending.
          label: 'poll again, Dov Mena gone (ended mid-window)',
          path: '/api/actions/sleeper-recruitment',
          variant: 'converted',
          body: { ...header, leads: [leads.open, leads.fresh, leads.waiting, leads.soon, leads.missed] },
        },
        {
          label: 'poll with nothing but a waiting lead (quiet strip)',
          path: '/api/actions/sleeper-recruitment',
          variant: 'quiet',
          body: { ...header, leads: [leads.waiting] },
        },
        {
          label: 'faction sleepers — one cooldown up, one not',
          path: '/api/factions/3/sleepers',
          body: [
            {
              id: 9, display_name: 'Ines Roth', archetype_name: 'Clerk', effectiveness: 62,
              recruiter_username: 'dataterminals',
              can_advocate_at: at(-5 * MIN), can_embezzle_at: at(2 * HOUR + 15 * MIN),
            },
            {
              id: 11, display_name: 'Sabri Kohl', archetype_name: 'Inspector', effectiveness: 34,
              recruiter_username: 'someone_else',
              can_advocate_at: at(38 * MIN), can_embezzle_at: null,   // null means ready
            },
          ],
        },
        {
          label: 'a meeting reply — progress',
          path: '/api/actions/sleeper-recruitment/1/meet',
          body: { flavor: 'She talks for a while about the rent board.', outcome: 'progress' },
        },
        {
          label: 'a meeting reply — lost',
          path: '/api/actions/sleeper-recruitment/2/meet',
          variant: 'lost',
          body: { flavor: 'He stops returning your calls.', outcome: 'lost' },
        },
        {
          label: 'something unrelated (must be ignored)',
          path: '/api/stocks/holdings',
          body: [{ id: 1, symbol: 'CAP', qty: 40 }],
        },
      ];
    })(),
  },

  'world-watch': {
    label: 'World Watch',
    source: 'docs/13-world-politics-surface.md',
    note: 'Fire "status" and "locations" first — they are what lets the rest be placed in a '
      + 'city. Each of the other buttons fills one row of the WORLD tab, so you can watch the '
      + 'compass acquire its five markers one screen at a time, which is exactly how it fills '
      + 'in play. Fire the campaigns and protest polls twice: nothing may double-count.',
    calls: (() => {
      const policy = (policy_name, axis, description) => ({
        policy_id: policy_name, policy_name, axis, description,
      });
      const profile = (username, social_axis, economic_axis, over = {}) => ({
        username, role: 'user', status: 'active', is_npc: false,
        alignment: { social_axis, social_count: 24, economic_axis, economic_count: 11 },
        ...over,
      });
      const at = (ms) => new Date(Date.now() + ms).toISOString();

      return [
        {
          label: 'status (who + where)',
          path: '/api/user/status',
          body: {
            username: 'you', status: 'active', current_location_id: 2,
            current_location: { id: 2, key: 'new-york', name: 'New York', kind: 'domestic' },
          },
        },
        {
          label: 'locations (the world is six cities)',
          path: '/api/locations',
          body: [
            { id: 1, key: 'san-francisco', name: 'San Francisco', kind: 'domestic' },
            { id: 2, key: 'new-york', name: 'New York', kind: 'domestic' },
            { id: 3, key: 'washington-dc', name: 'Washington DC', kind: 'domestic' },
            { id: 4, key: 'austin', name: 'Austin', kind: 'domestic' },
            { id: 5, key: 'portland', name: 'Portland', kind: 'domestic' },
            { id: 6, key: 'tijuana', name: 'Tijuana', kind: 'overseas' },
          ],
        },
        {
          // All twenty, because the panel's headline claim is "13 social, 7 economic" and
          // a nineteen-policy fixture would let an off-by-one through unnoticed.
          label: 'government — all 20 policies, both chambers, the court',
          path: '/api/government',
          body: {
            president: { name: 'President Hoppe', alignment: 2, favorability: 18, term_number: 3 },
            house: [
              { alignment: -3, count: 12 }, { alignment: -2, count: 108 }, { alignment: -1, count: 60 },
              { alignment: 0, count: 90 }, { alignment: 1, count: 55 }, { alignment: 2, count: 95 },
              { alignment: 3, count: 15 },
            ],
            senate: [
              { alignment: -2, count: 18 }, { alignment: -1, count: 12 }, { alignment: 0, count: 20 },
              { alignment: 1, count: 22 }, { alignment: 2, count: 28 },
            ],
            supreme_court: [
              { id: 1, name: 'J. Alder', alignment: 3 }, { id: 2, name: 'J. Brand', alignment: 2 },
              { id: 3, name: 'J. Cowan', alignment: 2 }, { id: 4, name: 'J. Doss', alignment: 1 },
              { id: 5, name: 'J. Ekwe', alignment: 0 }, { id: 6, name: 'J. Fenn', alignment: -1 },
              { id: 7, name: 'J. Grieve', alignment: -2 }, { id: 8, name: 'J. Hale', alignment: -2 },
              { id: 9, name: 'J. Iyer', alignment: -3 },
            ],
            next_congressional_election: 'Y7 D310',
            next_presidential_election: 'Y8 D040',
            policies: [
              policy('Free Speech', -1, 'Broad protections, narrow exceptions.'),
              policy('Police Regulation', 2), policy('Civil Rights', -1),
              policy('Immigration', 3, 'Entry is capped and enforcement is funded.'),
              policy('Drug Law', 1), policy('Abortion Rights', 0), policy('Animal Rights', -2),
              policy('Healthcare', -3), policy('Gay Rights', 1), policy('Gun Control', 2),
              policy('Human Rights', 1), policy('Privacy Rights', 2), policy('Womens Rights', 0),
              policy('Corporate Law', 3), policy('Election Reform', -1), policy('Labor Laws', 2),
              policy('Military Spending', 3), policy('Nuclear Power', 0), policy('Pollution', -2),
              policy('Tax Structure', 1),
            ],
          },
        },
        {
          label: 'government — a 21st policy the client has never heard of',
          path: '/api/government',
          variant: 'unknown-policy',
          body: {
            policies: [policy('Tax Structure', 1), policy('Space Program', 3)],
            house: [], senate: [], supreme_court: [],
          },
        },
        {
          label: 'home · media campaigns (fire me twice)',
          path: '/api/home/media-campaigns',
          body: [
            { corporation_id: 30, corporation_name: 'Dead Letter Media', city_name: 'New York', issue: 'Immigration', alignment: 3, fans: 92_400 },
            { corporation_id: 31, corporation_name: 'Beacon Press', city_name: 'New York', issue: 'Immigration', alignment: -3, fans: 11_000 },
            { corporation_id: 32, corporation_name: 'Ledger', city_name: 'Austin', issue: 'Taxes', alignment: -2, fans: 4_100 },
            { corporation_id: 33, corporation_name: 'Vanguard Weekly', city_name: 'San Francisco', issue: 'Corporations', alignment: -3, fans: 26_000 },
          ],
        },
        {
          label: 'home · the one active protest (no meter — must not read as a deadlock)',
          path: '/api/home/active-protest',
          body: { id: 99, issue: 'Abortion', city_name: 'Portland' },
        },
        {
          label: 'protests · New York (fire me twice)',
          path: '/api/protests?location_id=2',
          body: [
            {
              id: 11, issue: 'gun-control', meter: -62, left_count: 9, right_count: 3,
              left_power: 14.2, right_power: 4.4, meter_rate: -0.019, forecast_shift: -1,
              end_ts: at(45 * 60_000), participants: [{ username: 'you', side: 'left' }], recent_events: [],
            },
            {
              id: 12, issue: 'Taxes', meter: 41, left_count: 2, right_count: 7,
              left_power: 3.1, right_power: 11.9, end_ts: at(90 * 60_000),
              participants: [], recent_events: [],
            },
          ],
        },
        {
          label: 'protests · Portland (the home page\'s protest, now with a meter)',
          path: '/api/protests?location_id=5',
          body: [
            {
              id: 99, issue: 'abortion', meter: -18, left_count: 4, right_count: 3,
              end_ts: at(20 * 60_000), participants: [], recent_events: [],
            },
          ],
        },
        {
          label: 'travel · state dominance (every state at once)',
          path: '/api/protests/state-dominance',
          body: [
            { state_fips: '06', dominant_side: 'left', dominance_score: 58, active_protests: 3, total_count: 1840, is_contested: false },
            { state_fips: 36, dominant_side: 'right', dominance_score: 81, active_protests: 2, total_count: 960, is_contested: true },
            { state_fips: '48', dominant_side: 'right', dominance_score: 22, active_protests: 1, total_count: 310, is_contested: true },
            { state_fips: '41', dominant_side: 'left', dominance_score: 12, active_protests: 1, total_count: 140, is_contested: true },
            { state_fips: '11', dominant_side: 'right', dominance_score: 44, active_protests: 1, total_count: 520, is_contested: false },
            { state_fips: '53', dominant_side: 'left', dominance_score: 33, active_protests: 0, total_count: 0, is_contested: false },
          ],
        },
        {
          label: 'graffiti · the walls of the city you are in',
          path: '/api/actions/graffiti',
          body: {
            city_name: 'New York',
            locations: [
              { key: 'rail-yard', name: 'Rail Yard', left_count: 22, right_count: 6, total_count: 28, difficulty: 2 },
              { key: 'overpass', name: 'Ninth Street Overpass', left_count: 9, right_count: 11, total_count: 20, difficulty: 3 },
              { key: 'depot', name: 'Depot Wall', left_count: 4, right_count: 1, total_count: 5, difficulty: 1 },
            ],
            spray_can_count: 3, juice_cost: 5,
          },
        },
        {
          label: 'poll · Taxes, professional firm (seven buckets)',
          path: '/api/actions/poll',
          body: {
            issue: 'Taxes', method: 'professional', mood: 'right-leaning',
            salience: 'hot', volatility: 'moderate', extreme_tag: null,
            far_left: 4, center_left: 6, slight_left: 10, neutral: 18,
            slight_right: 22, center_right: 30, far_right: 10,
            cooldown_until: at(5 * 60_000),
          },
        },
        {
          label: 'poll · Gun Control, street poll (three blocs, must read as coarse)',
          path: '/api/actions/poll',
          variant: 'coarse',
          body: {
            issue: 'Gun Control', method: 'street', mood: 'left-leaning',
            left_bloc: 61, center: 18, right_bloc: 21, cooldown_until: at(5 * 60_000),
          },
        },
        {
          label: 'poll · Healthcare, focus group',
          path: '/api/actions/poll',
          variant: 'healthcare',
          body: {
            issue: 'Healthcare', method: 'focus_group', mood: 'deadlocked',
            salience: 'boiling', volatility: 'high', best_target: 'Slight Right',
            persuasion_angle: 'costs, not coverage',
            far_left: 18, center_left: 14, slight_left: 12, neutral: 14,
            slight_right: 12, center_right: 16, far_right: 14,
            cooldown_until: at(5 * 60_000),
          },
        },
        { label: 'profile · alix', path: '/api/users/alix', body: profile('alix', 1.4, -2.1) },
        { label: 'profile · brann', path: '/api/users/brann', body: profile('brann', -2.2, -0.4) },
        { label: 'profile · carra', path: '/api/users/carra', body: profile('carra', 0.6, 2.4) },
        { label: 'profile · dov', path: '/api/users/dov', body: profile('dov', -1.1, 1.8) },
        {
          // The city column is sealed behind Privacy Rights today, so the panel has to
          // read correctly with no `location` at all — and correctly the day one arrives.
          label: 'profile · erran, WITH a city (the day Privacy Rights unseals it)',
          path: '/api/users/erran',
          variant: 'placed',
          body: profile('erran', 2.6, 1.2, { location: 'New York' }),
        },
        {
          label: 'profile · sealed alignment (must be ignored, not plotted at 0,0)',
          path: '/api/users/quiet',
          variant: 'sealed',
          body: { username: 'quiet', role: 'user', status: 'active', alignment: null },
        },
        {
          label: 'something unrelated (must be ignored)',
          path: '/api/stocks/holdings',
          body: [{ id: 1, symbol: 'CAP', qty: 40 }],
        },
      ];
    })(),
  },

  'gov-watch': {
    label: 'Gov Watch',
    source: 'docs/14-government-motion-surface.md',
    note: 'This one is a DIFF engine, so a single call proves almost nothing — fire "all" to lay '
      + 'the baseline, then the variant buttons to move the government under it. The variants are '
      + 'ordered as a story: three axes drift, a cycle rolls over, a justice is replaced, and the '
      + 'president falls under 10% approval. Every row on MOTION should carry a window, and here '
      + 'they will all be seconds wide because the harness fires them seconds apart.',
    calls: (() => {
      // GovernmentPage's own twenty names, in its own order. The axis values are invented;
      // the names and the 13/7 split are the client's.
      const NAMES = [
        'Tax Structure', 'Abortion Rights', 'Animal Rights', 'Civil Rights', 'Healthcare',
        'Drug Law', 'Free Speech', 'Gay Rights', 'Gun Control', 'Human Rights', 'Immigration',
        'Police Regulation', 'Privacy Rights', 'Womens Rights', 'Corporate Law',
        'Election Reform', 'Labor Laws', 'Military Spending', 'Nuclear Power', 'Pollution',
      ];
      const BASE = [1, -2, -1, -2, -1, 0, -3, -2, 2, -1, 1, 2, 3, -2, 2, 0, -1, 2, 1, -2];
      const policies = (over = {}) => NAMES.map((policy_name, i) => ({
        policy_id: policy_name, policy_name,
        axis: over[policy_name] !== undefined ? over[policy_name] : BASE[i],
        // A policy with an axis and no prose is legal — the client prints "No position set" —
        // so two of them ship without one on purpose.
        description: i % 9 === 4 ? undefined : `The federal position on ${policy_name.toLowerCase()}.`,
      }));

      // Only the axis is read from this feed, so the shape is deliberately thinner than
      // /api/government's — a tool that needed `description` here would break in play.
      const jobPolicies = (over = {}) => NAMES.map((policy_name, i) => ({
        policy_name, axis: over[policy_name] !== undefined ? over[policy_name] : BASE[i],
      }));

      const members = (shift = {}) => {
        const out = [];
        for (let s = 1; s <= 12; s++) {
          out.push({
            id: 100 + s, chamber: 'house', seat_number: s,
            alignment: shift[100 + s] !== undefined ? shift[100 + s] : [-2, -1, 0, 1, 2, -3][s % 6],
            incumbent: s % 4 !== 0,
          });
        }
        for (let s = 1; s <= 8; s++) {
          out.push({
            id: 200 + s, chamber: 'senate', seat_number: s,
            alignment: shift[200 + s] !== undefined ? shift[200 + s] : [1, 2, -2, 0, -1][s % 5],
            incumbent: true,
          });
        }
        return out;
      };

      const court = (over = {}) => [
        { id: 'j1', name: 'Alvarez', alignment: -2 }, { id: 'j2', name: 'Boone', alignment: -1 },
        { id: 'j3', name: 'Chandra', alignment: 0 }, { id: 'j4', name: 'Doyle', alignment: 1 },
        { id: 'j5', name: 'Eze', alignment: 2 }, { id: 'j6', name: 'Fitzgerald', alignment: 2 },
        { id: 'j7', name: 'Grant', alignment: 3 }, { id: 'j8', name: 'Hollis', alignment: -3 },
        { id: 'j9', name: 'Ibarra', alignment: 1 },
      ].filter((j) => over.drop !== j.id).map((j) => (over[j.id] !== undefined ? { ...j, alignment: over[j.id] } : j))
        .concat(over.add ? [over.add] : []);

      const gov = (over = {}) => ({
        president: over.president ?? { name: 'President Hoppe', alignment: 2, favorability: 31, term_number: 3 },
        house: over.house ?? [
          { alignment: -3, count: 12 }, { alignment: -2, count: 108 }, { alignment: -1, count: 60 },
          { alignment: 0, count: 90 }, { alignment: 1, count: 55 }, { alignment: 2, count: 95 },
          { alignment: 3, count: 15 },
        ],
        senate: over.senate ?? [
          { alignment: -2, count: 22 }, { alignment: -1, count: 14 }, { alignment: 0, count: 18 },
          { alignment: 1, count: 16 }, { alignment: 2, count: 26 }, { alignment: 3, count: 4 },
        ],
        supreme_court: court(over.court ?? {}),
        policies: policies(over.policies ?? {}),
        next_congressional_election: over.cong ?? 'March 12, Y9',
        next_presidential_election: over.pres ?? 'November 3, Y10',
      });

      const jobs = (over = {}) => ({
        next_cycle_month: over.cycle ?? '4',
        election_reform_axis: over.reform ?? 0,
        policies: jobPolicies(over.policies ?? {}),
        congress_members: members(over.members ?? {}),
        jobs: over.jobs ?? [
          {
            id: 91, job_type: 'lobbying', target_policy_name: 'Healthcare', direction: 'left',
            chamber: 'house', target_member_id: 103, status: 'recruiting', cycle_month: null,
            committed_power: 4200, committed_cash: 25000,
            slots: [{ role_key: 'fixer', assigned_user_id: 7, assigned_username: 'you', contribution_snapshot: { score: 12.5 } }],
            result_metadata: null,
          },
          {
            id: 92, job_type: 'training', status: 'recruiting', slots: [], result_metadata: null,
          },
        ],
      });

      return [
        {
          label: 'status (who)',
          path: '/api/user/status',
          body: { username: 'you', status: 'active', current_location_id: 2 },
        },
        {
          label: 'government — baseline (20 policies, chambers, 9 justices)',
          path: '/api/government',
          body: gov(),
        },
        {
          label: 'faction jobs — baseline (cycle 4, 20 members, 1 lobbying job)',
          path: '/api/factions/3/jobs',
          body: jobs(),
        },

        // ---- the variants below MOVE the government; fire them after the baseline ----
        {
          label: '① jobs: three axes drift (live feed, seconds-wide window)',
          path: '/api/factions/3/jobs',
          variant: 'drift',
          body: jobs({ policies: { Healthcare: -2, 'Gun Control': 1, 'Tax Structure': 2 }, reform: 1 }),
        },
        {
          label: '② jobs: cycle rolls 4 → 5 (this is what the CYCLE tab projects from)',
          path: '/api/factions/3/jobs',
          variant: 'roll',
          body: jobs({
            cycle: '5', reform: 1,
            policies: { Healthcare: -2, 'Gun Control': 1, 'Tax Structure': 2 },
            jobs: [{
              id: 91, job_type: 'lobbying', target_policy_name: 'Healthcare', direction: 'left',
              chamber: 'house', target_member_id: 103, status: 'resolved', cycle_month: '4',
              committed_power: 4200, committed_cash: 25000, slots: [],
              result_metadata: { outcome: 'axis_moved', score: 74, winner_job_id: 91 },
            }],
          }),
        },
        {
          label: '③ jobs: two house seats realign, one goes open',
          path: '/api/factions/3/jobs',
          variant: 'seats',
          body: jobs({ cycle: '5', members: { 101: 1, 105: -3 } }),
        },
        {
          // 1.4 is the case the game cannot draw: GovernmentPage clamps without rounding,
          // so no cell is raised and factionUtils would label it R++. The panel must print
          // the raw number and say so.
          label: '④ jobs: a FRACTIONAL axis arrives (the game renders this blank)',
          path: '/api/factions/3/jobs',
          variant: 'fractional',
          body: jobs({ cycle: '5', policies: { 'Free Speech': -1.4, Pollution: 0.5 } }),
        },
        {
          label: '⑤ government: a justice is replaced and two others move',
          path: '/api/government',
          variant: 'court',
          body: gov({ court: { drop: 'j3', add: { id: 'j10', name: 'Okonkwo', alignment: -2 }, j7: 1, j8: -2 } }),
        },
        {
          label: '⑥ government: approval falls 31% → 8% (impeachment line)',
          path: '/api/government',
          variant: 'impeach',
          body: gov({ president: { name: 'President Hoppe', alignment: 2, favorability: 8, term_number: 3 } }),
        },
        {
          label: '⑦ government: a new president takes office (one row, not four)',
          path: '/api/government',
          variant: 'succession',
          body: gov({
            president: { name: 'President Vance-Okoro', alignment: -1, favorability: 54, term_number: 1 },
            cong: 'March 12, Y10',
          }),
        },
        {
          label: '⑧ government: the House shifts left by 20 seats',
          path: '/api/government',
          variant: 'chamber',
          body: gov({
            house: [
              { alignment: -3, count: 18 }, { alignment: -2, count: 122 }, { alignment: -1, count: 60 },
              { alignment: 0, count: 90 }, { alignment: 1, count: 55 }, { alignment: 2, count: 80 },
              { alignment: 3, count: 10 },
            ],
          }),
        },
        {
          label: 'something unrelated (must be ignored)',
          path: '/api/factions/3/treasury/summary',
          body: { cash: 918_000, weekly_income: 42_000 },
        },
      ];
    })(),
  },

  'poll-watch': {
    label: 'Poll Watch',
    source: 'OpinionPollPage in the 2026-08-03 bundle pull',
    note: 'Fire the clock and the issue list first, then the memos. Same-issue memos in sequence are what produce a delta and a trend line; the error reply is there to prove the shape gate drops non-memos.',
    calls: [
      {
        label: 'game clock (stamps each memo)',
        path: '/api/time',
        body: { datetime: '07:52 September 1, Y3', acceleration: 52.14 },
      },
      {
        label: 'issue list',
        path: '/api/actions/poll/issues',
        body: {
          issues: [
            'Civil Rights', 'Drugs', 'Abortion', 'Animal Research', 'Healthcare',
            'Free Speech', 'LGBT Rights', 'Gun Control', 'Torture', 'Police Behavior',
            'Intelligence', "Women's Rights", 'Corporations', 'Elections', 'Sweatshops',
            'Military', 'Nuclear Power', 'Pollution', 'Taxes', 'Immigration',
          ],
        },
      },
      {
        label: "focus group — Women's Rights (fine, 7 buckets)",
        path: '/api/actions/poll',
        body: {
          issue: "Women's Rights", method: 'focus_group', mood: 'right-leaning',
          far_left: 6, center_left: 11, slight_left: 13, neutral: 18,
          slight_right: 17, center_right: 20, far_right: 15,
          volatility: 'moderate', salience: 'warm', popularity: 41,
          best_target: 'Slight Right', persuasion_angle:
            'The slight-right bloc splits on enforcement, not principle. Frame it as process and a third of them move.',
          cooldown_until: new Date(Date.now() + 11 * 60_000).toISOString(),
        },
      },
      {
        label: 'professional — same issue, moved left (delta + trend)',
        path: '/api/actions/poll',
        variant: 'moved',
        body: {
          issue: "Women's Rights", method: 'professional', mood: 'deadlocked',
          far_left: 9, center_left: 16, slight_left: 16, neutral: 19,
          slight_right: 14, center_right: 15, far_right: 11,
          volatility: 'high', salience: 'hot', popularity: 58,
          cooldown_until: new Date(Date.now() + 11 * 60_000).toISOString(),
        },
      },
      {
        label: 'street poll — Taxes (coarse, no lean figure)',
        path: '/api/actions/poll',
        variant: 'coarse',
        body: {
          issue: 'Taxes', method: 'street', mood: 'right-leaning',
          left_bloc: 24, center: 21, right_bloc: 55, extreme_tag: 'HARDENING',
        },
      },
      {
        label: 'online scrape — Civil Rights, boiling',
        path: '/api/actions/poll',
        variant: 'civil',
        body: {
          issue: 'Civil Rights', method: 'online', mood: 'apathetic / persuadable',
          left_bloc: 31, center: 34, right_bloc: 35,
          volatility: 'high', salience: 'boiling', popularity: 77,
        },
      },
      {
        label: 'a refused poll (must be ignored — no blocs)',
        path: '/api/actions/poll',
        variant: 'error',
        body: { message: 'Not enough energy.', issue: 'Taxes' },
      },
      {
        label: 'something unrelated (must be ignored)',
        path: '/api/stocks/holdings',
        body: [{ id: 1, symbol: 'CAP', qty: 40 }],
      },
    ],
  },

  'shop-watch': {
    label: 'Shop Watch',
    source: 'docs/15-shop-surface.md',
    note: 'Fire status, then city, then "first visit" and "second visit" in order — the '
      + 'bracket only exists as a difference between two readings. The last call is '
      + 'INVENTED and says so; everything above it is the client\'s own read set.',
    calls: [
      {
        label: 'user status — the one field taken from it',
        path: '/api/user/status',
        body: { current_location: { name: 'Tijuana', kind: 'city' } },
      },
      {
        label: 'city buildings',
        path: '/api/city',
        body: [
          { id: 14, name: 'Calle Ocho Guns', kind: 'shop', description: 'Ammunition, parts, and no questions.' },
          { id: 15, name: 'Sunset Pharmacy', kind: 'clinic', description: 'Patch-ups, discreet.' },
          { id: 16, name: 'The Yard', kind: 'dump', description: 'Scrap and salvage.' },
        ],
      },
      {
        // stock: null is the game's unlimited and MUST NOT read as a sell-out.
        label: 'first visit — ammo nearly gone',
        path: '/api/city/stores/14',
        body: [
          {
            item_def_id: 301, name: '9mm Rounds', category: 'material', rarity: 'common',
            description: 'Boxed, fifty to a carton.', icon_image_path: '/i/9mm.png',
            buy_price: 40, sell_price: 12, stock: 2,
          },
          {
            item_def_id: 302, name: '.45 ACP Rounds', category: 'material', rarity: 'common',
            description: 'Heavy, slow, convincing.', icon_image_path: '/i/45.png',
            buy_price: 65, sell_price: 20, stock: 0,
          },
          {
            item_def_id: 310, name: 'Cleaning Kit', category: 'tool', rarity: 'common',
            description: 'Keeps a barrel honest.', icon_image_path: '/i/kit.png',
            buy_price: 90, sell_price: 30, stock: null,
          },
        ],
      },
      {
        // A variant, because the harness keeps only the FIRST body per path and this is
        // the same endpoint read a second time — which is the whole mechanism under test.
        // Fire "first visit" first, then this one.
        label: 'second visit — a refill happened somewhere in between',
        path: '/api/city/stores/14',
        variant: 'second-visit',
        body: [
          {
            item_def_id: 301, name: '9mm Rounds', category: 'material', rarity: 'common',
            description: 'Boxed, fifty to a carton.', icon_image_path: '/i/9mm.png',
            buy_price: 40, sell_price: 12, stock: 24,
          },
          {
            item_def_id: 302, name: '.45 ACP Rounds', category: 'material', rarity: 'common',
            description: 'Heavy, slow, convincing.', icon_image_path: '/i/45.png',
            buy_price: 65, sell_price: 20, stock: 12,
          },
          {
            item_def_id: 310, name: 'Cleaning Kit', category: 'tool', rarity: 'common',
            description: 'Keeps a barrel honest.', icon_image_path: '/i/kit.png',
            buy_price: 90, sell_price: 30, stock: null,
          },
          {
            // Absent from the first reading: logged as "appeared", not as a restock.
            item_def_id: 315, name: 'Shotgun Shells', category: 'material', rarity: 'uncommon',
            description: 'Twelve gauge, buck.', icon_image_path: '/i/12g.png',
            buy_price: 120, sell_price: 40, stock: 6,
          },
        ],
      },
      {
        label: 'the sell side (field census only)',
        path: '/api/city/stores/14/sell',
        body: [
          {
            item_def_id: 301, player_item_id: 90211, name: '9mm Rounds', category: 'material',
            rarity: 'common', description: 'Boxed, fifty to a carton.',
            icon_image_path: '/i/9mm.png', sell_price: 12, qty: 31,
          },
        ],
      },
      {
        label: 'a purchase result (object, not an array — must be ignored)',
        path: '/api/city/stores/14',
        variant: 'mutation-result',
        body: { ok: true, item_def_id: 301, qty: 5, balance: 4200 },
      },
      {
        // NOT MEASURED. Nothing in the 2026-08-03 bundle reads a restock time, and no
        // capture has been taken, so this shape is INVENTED — its only job is to prove
        // the FIELDS tab lights up if the server ever does volunteer one. If a real
        // reading ever shows the true shape, replace this and say so in docs/15.
        label: 'HYPOTHETICAL — server volunteers fields the client drops',
        path: '/api/city/stores/14',
        variant: 'speculative',
        body: [
          {
            item_def_id: 301, name: '9mm Rounds', category: 'material', subcategory: 'ammo',
            rarity: 'common', description: 'Boxed, fifty to a carton.',
            icon_image_path: '/i/9mm.png', buy_price: 40, sell_price: 12, stock: 24,
            restocks_at: '2026-08-27T18:00:00Z', restock_qty: 24, max_stock: 48,
          },
        ],
      },
    ],
  },

  'market-watch': {
    label: 'Market Watch',
    hotkey: 'Alt+M',
    source: 'docs/04-stocks-surface.md',
    note: 'Fire the watchlist, then "prices moved" two or three times — a series is a '
      + 'difference between readings, so one call charts nothing. market-watch taps '
      + "onApi('*') on purpose, so the last call is charted too rather than ignored: "
      + 'that is the documented behaviour, not a leak.',
    calls: (() => {
      // Fields per docs/04: price, bid and ask moved across the observed window;
      // float_shares, spread_bps and ipo_game_day did not, and ipo_game_day read
      // 1408 identically on every instrument. Symbols are the five that were seen.
      const inst = (symbol, id, price, spread) => ({
        id, symbol, price,
        bid: +(price - spread / 2).toFixed(2),
        ask: +(price + spread / 2).toFixed(2),
        volume: id * 137,
        spread_bps: Math.round((spread / price) * 10_000),
        float_shares: id * 25_000,
        ipo_game_day: 1408,
      });
      const book = (mult) => [
        inst('PNRG', 10, +(28.70 * mult).toFixed(2), 0.14),
        inst('RCRD', 11, +(12.53 * mult).toFixed(2), 0.06),
        inst('SNTL', 12, +(4.02 * mult).toFixed(2), 0.03),
        inst('USTL', 13, +(61.25 * mult).toFixed(2), 0.31),
        inst('BRDL', 14, +(84.00 * mult).toFixed(2), 0.42),
      ];
      return [
        {
          label: 'watchlist (fire me first)',
          path: '/api/stocks/instruments',
          body: book(1),
        },
        {
          label: 'prices moved — fire me repeatedly, that is what a series is',
          path: '/api/stocks/instruments',
          variant: 'moved',
          body: book(1.043),
        },
        {
          label: 'prices moved hard (trips a 3% rule)',
          path: '/api/stocks/instruments',
          variant: 'moved',
          body: book(0.911),
        },
        {
          label: 'holdings — what position sizing reads',
          path: '/api/stocks/holdings',
          body: [
            { id: 77, instrument_id: 10, symbol: 'PNRG', shares: 92, avg_cost: 27.10 },
            { id: 78, instrument_id: 13, symbol: 'USTL', shares: 5, avg_cost: 59.80 },
          ],
        },
        {
          label: 'trades',
          path: '/api/stocks/trades?limit=50',
          body: [
            { id: 900, instrument_id: 10, symbol: 'PNRG', side: 'buy', shares: 92, price: 27.10 },
            { id: 901, instrument_id: 13, symbol: 'USTL', side: 'sell', shares: 1, price: 60.40 },
          ],
        },
        {
          label: 'tax',
          path: '/api/stocks/tax',
          body: { owed: 1240, rate_bps: 1500, paid_this_year: 310 },
        },
        {
          label: "a non-market payload (charted anyway — the '*' tap is deliberate)",
          path: '/api/public/stats',
          body: {
            citizens: 291, online_now: 14, game_year: 7, game_day: 298,
            active_corps: 15, bills_passed: 3, bills_killed: 89,
          },
        },
      ];
    })(),
  },

  'bar-watch': {
    label: 'Bar Watch',
    source: 'docs/17-attribute-surface.md',
    note: 'LastUpdate is stamped relative to when this page loaded, so the countdowns '
      + 'tick for real. Fire "bars" and watch; fire "energy already full" to see the '
      + 'alert fire, and "hp regen paused" to see a countdown correctly refuse to exist.',
    calls: (() => {
      // The projection is anchored on LastUpdate, so a hardcoded timestamp would render
      // a bar that filled up in 2026 and stayed there. These are stamped at load.
      const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
      return [
        {
          label: 'bars — mid fill',
          path: '/api/attributes',
          body: [
            // 47 + floor(3 * 2) = 53 of 100 at 2/min: about 23 minutes from full.
            { AttributeID: 1, AttributeName: 'energy', CurrentValue: 47, MaxValue: 100,
              BaseRegenRate: 2, CustomRegenRate: null, LastUpdate: ago(3) },
            // A custom rate, so the RATE column has something to show — whether the
            // server folds effects into this field is the open question in docs/17.
            { AttributeID: 2, AttributeName: 'juice', CurrentValue: 12, MaxValue: 40,
              BaseRegenRate: 3, CustomRegenRate: 4.5, LastUpdate: ago(1) },
            { AttributeID: 3, AttributeName: 'hp', CurrentValue: 88, MaxValue: 100,
              BaseRegenRate: 6, CustomRegenRate: null, LastUpdate: ago(0.5) },
          ],
        },
        {
          label: 'bars — energy already full',
          path: '/api/attributes',
          variant: true,
          body: [
            { AttributeID: 1, AttributeName: 'energy', CurrentValue: 100, MaxValue: 100,
              BaseRegenRate: 2, CustomRegenRate: null, LastUpdate: ago(30) },
            { AttributeID: 2, AttributeName: 'juice', CurrentValue: 12, MaxValue: 40,
              BaseRegenRate: 3, CustomRegenRate: null, LastUpdate: ago(1) },
            { AttributeID: 3, AttributeName: 'hp', CurrentValue: 88, MaxValue: 100,
              BaseRegenRate: 6, CustomRegenRate: null, LastUpdate: ago(0.5) },
          ],
        },
        {
          label: 'bars — hp regen paused (rate 0)',
          path: '/api/attributes',
          variant: true,
          body: [
            { AttributeID: 1, AttributeName: 'energy', CurrentValue: 47, MaxValue: 100,
              BaseRegenRate: 2, CustomRegenRate: null, LastUpdate: ago(3) },
            { AttributeID: 2, AttributeName: 'juice', CurrentValue: 12, MaxValue: 40,
              BaseRegenRate: 3, CustomRegenRate: null, LastUpdate: ago(1) },
            // The game's own us()/ds() return CurrentValue and null here, so the panel
            // must print no ETA rather than an infinite one.
            { AttributeID: 3, AttributeName: 'hp', CurrentValue: 41, MaxValue: 100,
              BaseRegenRate: 6, CustomRegenRate: 0, LastUpdate: ago(9) },
          ],
        },
        {
          label: 'effects — none',
          path: '/api/effects',
          body: [],
        },
        {
          label: 'effects — radiation (regen paused)',
          path: '/api/effects',
          variant: true,
          body: [
            { id: 71, effect_key: 'radiation', effect_type: 'damage_over_time',
              target_key: 'hp', value: -1, modifier_type: 'flat',
              expires_at: new Date(Date.now() + 22 * 60000).toISOString(),
              source_item_name: null },
          ],
        },
        {
          label: 'effects — a juice regen modifier',
          path: '/api/effects',
          variant: true,
          body: [
            { id: 72, effect_key: 'stim', effect_type: 'regen_modifier',
              target_key: 'juice', value: 50, modifier_type: 'percent',
              expires_at: new Date(Date.now() + 8 * 60000).toISOString(),
              source_item_name: 'Cheap Stimulant' },
          ],
        },
      ];
    })(),
  },
'slot-watch': {
    label: 'Slot Watch',
    source: 'docs/18-casino-slots-surface.md',
    note: 'Fire the config first — it is what teaches the panel the table’s stated edge, '
        + 'and without an edge there is no expectation line to draw against. Then history, '
        + 'then the receipt: the receipt is the only payload that carries spins[], so it is '
        + 'what unlocks the SPIN chart and the per-spin sample.',
    calls: (() => {
      // A session, built the way the server states them: gross is what came back, tax is
      // withheld from the profit, net is what was credited. The panel re-derives nothing,
      // so these have to reconcile or its own warning fires — which is worth seeing too,
      // and is the last variant below.
      const sess = (id, wager, spins, gross, tax) => ({
        id, total_wager: wager, spin_count: spins,
        gross_payout: gross, tax_amount: tax, net_payout: gross - tax,
      });

      // A run of paid spins that walks a balance, plus a free spin at the end — free spins
      // stake nothing, so they must not step the expectation line down. That is the case
      // test-slot-ev.js pins and this is where it is looked at.
      const run = (start, wager, gains) => {
        let bal = start;
        return gains.map((g, i) => {
          bal += g - (i === gains.length - 1 ? 0 : wager);
          return {
            effective_wager: i === gains.length - 1 ? 0 : wager,
            gross_payout: g,
            player_balance_after: bal,
            spin_type: i === gains.length - 1 ? 'free' : 'paid',
            spin_index: i + 1,
            scatter_count: g > 0 ? 3 : 0,
            free_spins_awarded: i === gains.length - 2 ? 8 : 0,
            // The two fields slimSpin() throws away, present so it can be seen doing it.
            grid: new Array(15).fill('cherry'),
            line_wins: g > 0 ? [{ line_id: 4, count: 3 }] : [],
          };
        });
      };

      return [
        {
          label: 'table config — 96% RTP',
          path: '/api/corporations/7/casino/slots',
          body: {
            slots_min_bet: 100, slots_max_bet: 25000, wager_increment: 100,
            player_cash: 184300, free_reserve: 2400000, max_coverable_wager: 25000,
            current_city_access: true, operational: true, wagering_suspended: false,
            theoretical_rtp_bps: 9600, house_edge_bps: 400,
            reel_config_version: 'cc-2026-08-14',
            rules: {
              paytable: { cherry: [2, 5, 15], missile: [8, 25, 100], gold_dome: [10, 40, 150] },
              scatter: { 3: { multiplier: 2 }, 4: { multiplier: 10 }, 5: { multiplier: 50 } },
            },
          },
        },
        {
          label: 'history — six sessions',
          path: '/api/corporations/7/casino/slots/history',
          // Newest first, the way the page reads sessions[0] as "last session". Two of the
          // six are taxed wins, which is what makes the tax drag a number rather than zero.
          body: {
            sessions: [
              sess(4106, 10000, 100, 8200, 0),
              sess(4098, 2500, 25, 4100, 240),
              sess(4091, 1000, 10, 300, 0),
              sess(4077, 5000, 50, 4600, 0),
              sess(4052, 2500, 25, 6900, 660),
              sess(4031, 1000, 10, 700, 0),
            ],
          },
        },
        {
          label: 'a spin receipt — carries spins[]',
          path: '/api/corporations/7/casino/slots/spins',
          body: {
            session: {
              ...sess(4112, 1000, 11, 1450, 45),
              player_balance_before: 184300,
              player_balance_after: 184300 + 1450 - 45 - 1000,
              spins: run(184300, 100, [0, 0, 250, 0, 0, 0, 400, 0, 0, 500, 300]),
            },
          },
        },
        {
          label: 'a losing receipt',
          path: '/api/corporations/7/casino/slots/spins',
          variant: true,
          body: {
            session: {
              ...sess(4118, 2500, 25, 900, 0),
              player_balance_before: 184695,
              player_balance_after: 184695 - 1600,
              spins: run(184695, 100, [0, 0, 0, 200, 0, 0, 0, 0, 0, 0, 0, 0, 300, 0, 0,
                0, 0, 0, 0, 0, 0, 400, 0, 0, 0]),
            },
          },
        },
        {
          label: 'a second table — 91% RTP, wrong city',
          path: '/api/corporations/40/casino/slots',
          body: {
            slots_min_bet: 500, slots_max_bet: 100000, wager_increment: 500,
            player_cash: 184300, free_reserve: 90000, max_coverable_wager: 45000,
            current_city_access: false, operational: true, wagering_suspended: false,
            theoretical_rtp_bps: 9100, house_edge_bps: 900,
            reel_config_version: 'cc-2026-07-02',
            rules: { paytable: { cherry: [2, 5, 15] }, scatter: { 3: { multiplier: 2 } } },
          },
        },
        {
          label: 'the table is fined — wagering suspended',
          path: '/api/corporations/7/casino/slots',
          variant: true,
          body: {
            slots_min_bet: 100, slots_max_bet: 25000, wager_increment: 100,
            player_cash: 184300, free_reserve: 0, max_coverable_wager: 0,
            current_city_access: true, operational: true, wagering_suspended: true,
            theoretical_rtp_bps: 9600, house_edge_bps: 400,
            reel_config_version: 'cc-2026-08-14',
            rules: { paytable: { cherry: [2, 5, 15] }, scatter: { 3: { multiplier: 2 } } },
          },
        },
        {
          label: 'a receipt that does not add up',
          path: '/api/corporations/7/casino/slots/history',
          variant: true,
          // gross - tax does not equal net. The panel must say so rather than print
          // figures built on an assumption that has stopped holding.
          body: { sessions: [{ ...sess(4120, 1000, 10, 1500, 100), net_payout: 999 }] },
        },
      ];
    })(),
  },

};
