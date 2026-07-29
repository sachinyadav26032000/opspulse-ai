/* ==========================================================================
   Product usage — the signal a ticket-based tool cannot see.
   --------------------------------------------------------------------------
   Tickets and calls both measure COMPLAINTS. An account that is quietly
   churning does not complain; it stops logging in. Every detector in this
   engine keys off tickets, escalations, QA or survey responses — so an account
   only becomes visible by making noise. This module adds the other half.

   Run as a POST-PASS, after tickets and escalations exist, so each account's
   usage can be shaped against its real contact history rather than a guess
   made before that history was generated. That ordering is what makes the
   correlation honest: "usage down, zero tickets" is a genuine cross-reference
   of two independently generated series, not a label applied to both at once.

   THE ARCHETYPES, and why each earns its place in a demo:

     healthy         usage flat or up, adoption high. The control group.
     engaged_noisy   HIGH ticket volume, HEALTHY usage. An engaged customer,
                     not a churning one. Present specifically so the engine can
                     be shown NOT to treat contact volume as risk — a naive
                     model flags these and burns CSM time on happy customers.
     slow_decline    usage drifting down 15-35%, some contact. The common case.
     cliff           usage down 55-85%, recent and sharp, last login stale.
     silent_decline  usage down materially, ZERO tickets. Invisible to every
                     ticket-based tool on the market. The whole argument.
     never_adopted   seats provisioned, most never activated. Onboarding failed
                     and nobody noticed because nothing broke.

   Correlation is deliberately imperfect. Accounts with heavy escalation
   history are MORE LIKELY to decline, not certain to; and a fixed minimum of
   silent decliners is guaranteed among high-ARR accounts so the demo always
   has them regardless of which way the ticket dice fell.
   ========================================================================== */

import { makeRng } from './rng.js';

const DAY = 86400000;

/* Six months of monthly readings, so "how have they been consuming the product
   over the last few months?" has an answer. The SHAPE is the point — a CSM
   reads a cliff differently from a glide, and identically-shaped rows would
   teach them nothing.

   Two hard reconciliation rules, because a drill-down that contradicts its own
   card is worse than one that shows less:
     · the LAST month equals the current window exactly (seats_active_30d and
       feature_adoption_pct), so history and headline cannot disagree;
     · the last-to-previous step reproduces usage_trend_30d exactly, because
       that figure is published on the card and derived from the same two
       readings. */
export const HISTORY_MONTHS = 6;

export const ARCHETYPES = ['healthy', 'engaged_noisy', 'slow_decline', 'cliff', 'silent_decline', 'never_adopted'];

/* How many high-ARR accounts are FORCED into silent decline. Guaranteed rather
   than probabilistic: this is the cohort the product exists to find, and a demo
   that sometimes has none of them fails to make its own argument. */
const GUARANTEED_SILENT = 8;
const GUARANTEED_NEVER_ADOPTED = 5;
const GUARANTEED_ENGAGED_NOISY = 4;

/** Attach `usage` to every account. Mutates `ds.accounts` in place. */
export function attachUsage(ds) {
  // Own RNG stream, derived from the dataset seed, so usage is reproducible and
  // adding it does not shift any existing random draw.
  const rnd = makeRng((ds.meta.seed ^ 0x7a5ea9) >>> 0);
  const asOf = ds.meta.as_of;

  /* Per-account contact history, from the records that already exist. */
  const contact = new Map();
  for (const a of ds.accounts) contact.set(a.account_id, { tickets: 0, recent: 0, escal: 0, lastTicketAt: null });
  for (const t of ds.tickets) {
    const c = contact.get(t.account_id); if (!c) continue;
    c.tickets++;
    if (t.day_index >= ds.meta.recent_from) c.recent++;
    if (c.lastTicketAt == null || t.created_at > c.lastTicketAt) c.lastTicketAt = t.created_at;
  }
  for (const e of ds.escalations) { const c = contact.get(e.account_id); if (c) c.escal++; }

  /* ── Assign archetypes ───────────────────────────────────────────────── */
  const forced = new Map();

  /* Guaranteed cohorts are chosen DETERMINISTICALLY (highest ARR first among
     accounts that genuinely qualify), not sampled — a demo that sometimes
     lacks its central cohort cannot make its own argument.

     Silent decliners are drawn from accounts with ZERO tickets EVER, not
     merely none recently. The headline claim is "no tickets raised", and it
     has to be literally true when a CRO clicks into the account. */
  const zeroTicket = ds.accounts
    .filter((a) => contact.get(a.account_id).tickets === 0)
    .sort((a, b) => b.arr_usd - a.arr_usd);
  zeroTicket.slice(0, GUARANTEED_SILENT).forEach((a) => forced.set(a.account_id, 'silent_decline'));

  const seatHeavy = ds.accounts
    .filter((a) => !forced.has(a.account_id) && a.seats >= 20)
    .sort((a, b) => b.arr_usd - a.arr_usd);
  seatHeavy.slice(0, GUARANTEED_NEVER_ADOPTED).forEach((a) => forced.set(a.account_id, 'never_adopted'));

  // Must genuinely be noisy, or the "engaged, not churning" case proves nothing.
  const noisy = ds.accounts
    .filter((a) => !forced.has(a.account_id) && contact.get(a.account_id).tickets >= 4)
    .sort((a, b) => b.arr_usd - a.arr_usd);
  noisy.slice(0, GUARANTEED_ENGAGED_NOISY).forEach((a) => forced.set(a.account_id, 'engaged_noisy'));

  for (const a of ds.accounts) {
    const c = contact.get(a.account_id);
    a.usage = buildUsage(a, c, forced.get(a.account_id) || pickArchetype(a, c, rnd), rnd, asOf);
  }

  return ds;
}

/* Escalation history raises the ODDS of decline without determining it —
   a perfect correlation would make usage a restatement of the ticket data
   rather than an independent source. */
function pickArchetype(a, c, rnd) {
  /* Escalation history and recent contact raise the ODDS of decline steeply,
     but never determine it — a perfect correlation would make usage a
     restatement of the ticket data rather than an independent source. The
     gradient below runs roughly 26% -> 43% -> 60% -> 77% declining as stress
     climbs, which is visible in aggregate yet still leaves healthy accounts
     under stress and declining accounts with a clean ticket history. */
  const stress = Math.min(3, c.escal) + (c.recent >= 3 ? 1 : 0);

  if (rnd.chance(c.tickets === 0 ? 0.05 : 0.008)) return 'silent_decline';
  if (a.seats >= 15 && rnd.chance(0.03)) return 'never_adopted';
  if (c.tickets >= 4 && rnd.chance(0.10)) return 'engaged_noisy';

  const w = {
    healthy: Math.max(0.03, 0.68 - stress * 0.20),
    slow_decline: 0.22 + stress * 0.08,
    cliff: 0.04 + stress * 0.09,
    engaged_noisy: Math.max(0.02, 0.06 - stress * 0.01),
  };
  return rnd.weighted(w);
}

function buildUsage(a, c, archetype, rnd, asOf) {
  const seats = a.seats;
  let activeRate, trendPct, daysSinceLogin, adoption;

  switch (archetype) {
    case 'healthy':
      activeRate = rnd.range(0.72, 0.96);
      trendPct = rnd.range(-4, 18);
      daysSinceLogin = rnd.int(0, 2);
      adoption = rnd.range(0.62, 0.93);
      break;
    case 'engaged_noisy':
      // Heavy contact, healthy product use. Deliberately indistinguishable from
      // a churn risk if you only look at tickets.
      activeRate = rnd.range(0.74, 0.97);
      trendPct = rnd.range(2, 26);
      daysSinceLogin = rnd.int(0, 1);
      adoption = rnd.range(0.70, 0.95);
      break;
    case 'slow_decline':
      activeRate = rnd.range(0.44, 0.70);
      trendPct = -rnd.range(15, 35);
      daysSinceLogin = rnd.int(3, 11);
      adoption = rnd.range(0.38, 0.66);
      break;
    case 'cliff':
      activeRate = rnd.range(0.12, 0.34);
      trendPct = -rnd.range(55, 85);
      daysSinceLogin = rnd.int(9, 27);
      adoption = rnd.range(0.20, 0.48);
      break;
    case 'silent_decline':
      activeRate = rnd.range(0.20, 0.45);
      trendPct = -rnd.range(42, 74);
      daysSinceLogin = rnd.int(12, 34);
      adoption = rnd.range(0.24, 0.52);
      break;
    case 'never_adopted':
      // Seats bought, seats never switched on. Adoption never got off the floor.
      activeRate = rnd.range(0.10, 0.30);
      trendPct = rnd.range(-12, 6);
      daysSinceLogin = rnd.int(4, 20);
      adoption = rnd.range(0.08, 0.26);
      break;
    default:
      activeRate = 0.7; trendPct = 0; daysSinceLogin = 3; adoption = 0.6;
  }

  const seatsActive = Math.max(0, Math.min(seats, Math.round(seats * activeRate)));

  /* Logins are derived from active seats so the two cannot disagree, then the
     trend is derived BACK from the two login counts — the published
     usage_trend_30d is therefore always exactly what the numbers say. */
  const perSeat = rnd.range(9, 26);

  /* `recovering` is a shape, not an archetype: an account that dipped and is
     climbing back reads as healthy TODAY, and only the trajectory reveals it
     was in trouble. Assigning it here rather than in pickArchetype keeps the
     archetype mix — and everything documented about it — unchanged. */
  const shape = (archetype === 'healthy' || archetype === 'engaged_noisy') && rnd.chance(0.18)
    ? 'recovering' : archetype;

  /* THE HISTORY IS THE SOURCE OF TRUTH, and logins and the trend are derived
     FROM it — not alongside it.

     Deriving them in parallel meant the published trend came from a real-valued
     calculation while the sparkline plotted rounded integers, so on small
     accounts the two disagreed: a card reading -70% above a series that steps
     3 -> 1, which is -67%. 608 of 2,400 accounts contradicted themselves that
     way. Reading both off the same integers removes the possibility. */
  const history = buildHistory({
    shape, seats, seatsActive,
    adoptionPct: Math.round(adoption * 100),
    trend: trendPct, rnd, asOf,
  });
  const prevActive = history[HISTORY_MONTHS - 2].active_users;

  /* The trend comes from the ACTIVE-USER integers — the same numbers the
     sparkline plots — so the two agree exactly. Rounding each login count
     independently was enough to break it on small accounts: 1 -> 2 active
     users is -50%, but 12 -> 23 logins is -47.8%, and the card and the chart
     then disagreed on seven accounts. Logins are derived from the trend rather
     than computed beside it. */
  const trueTrend = prevActive > 0 ? ((seatsActive - prevActive) / prevActive) * 100 : 0;
  const logins30 = Math.max(0, Math.round(seatsActive * perSeat));
  const loginsPrior = Math.max(1, Math.round(logins30 / (1 + trueTrend / 100)));

  return {
    seats_provisioned: seats,
    seats_active_30d: seatsActive,
    logins_30d: logins30,
    logins_prior_30d: loginsPrior,
    last_login_at: new Date(asOf - daysSinceLogin * DAY).toISOString(),
    feature_adoption_pct: Math.round(adoption * 100),
    usage_trend_30d: Math.round(trueTrend * 10) / 10,
    usage_history: history,
    // Kept for the detectors and for SEED_NOTES; not fields a real CRM returns.
    _archetype: archetype,
    _shape: shape,
  };
}

/* ── Monthly trajectory ─────────────────────────────────────────────────── */
const SHAPES = {
  /* Multipliers are relative to the PENULTIMATE month, not to today.
     That matters: the last step is already fixed by usage_trend_30d, so a shape
     defined against today fought it — a cliff account with a -80% trend forced
     month 5 to five times today's figure, spiking above every earlier month.
     Defining the run-up against month 5 lets the two rules agree, and it is
     also the truer model: these four points are the trajectory BEFORE the
     recent change, and the last step is the change itself. */
  //                 6mo ago            -> month 5 (=1.0)
  healthy:        [0.90, 0.93, 0.96, 0.98],   // steady, gently up
  engaged_noisy:  [0.86, 0.90, 0.94, 0.97],   // growing use, lots of contact
  slow_decline:   [1.30, 1.20, 1.11, 1.05],   // a glide, easy to miss
  cliff:          [1.00, 1.01, 0.99, 1.00],   // flat — then it falls off
  silent_decline: [1.55, 1.38, 1.22, 1.09],   // fading, and never says why
  never_adopted:  [1.02, 1.00, 1.01, 1.00],   // never started, so never fell
  recovering:     [1.42, 1.15, 0.78, 0.88],   // dipped, climbing back
};

function buildHistory({ shape, seats, seatsActive, adoptionPct, trend, rnd, asOf }) {
  const mult = SHAPES[shape] || SHAPES.healthy;
  const d = new Date(asOf);

  /* Month 5 is solved backwards from the published 30-day trend, so the last
     step of the series reproduces the figure on the card by construction. */
  const prev = trend <= -99
    ? seatsActive * 4
    : seatsActive / (1 + trend / 100);

  const out = [];
  for (let i = 0; i < HISTORY_MONTHS; i++) {
    const back = HISTORY_MONTHS - 1 - i;
    const m = new Date(d.getFullYear(), d.getMonth() - back, 1);
    const month = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;

    let active;
    if (i === HISTORY_MONTHS - 1) active = seatsActive;                 // today, exactly
    else if (i === HISTORY_MONTHS - 2) active = prev;                   // fixed by the trend
    else active = prev * mult[i] * (1 + rnd.range(-0.035, 0.035));      // the run-up

    active = Math.max(0, Math.min(seats, Math.round(active)));

    /* Adoption tracks seat activity without being a restatement of it — a team
       can hold seats open while using fewer features. Anchored to today. */
    const ratio = seatsActive > 0 ? active / seatsActive : 1;
    const adoption = i === HISTORY_MONTHS - 1
      ? adoptionPct
      : Math.max(2, Math.min(100, Math.round(adoptionPct * (0.74 + 0.26 * Math.min(ratio, 2.2)))));

    out.push({ month, active_users: active, adoption_pct: adoption });
  }
  return out;
}
