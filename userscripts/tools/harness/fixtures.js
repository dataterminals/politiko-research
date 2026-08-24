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

};
