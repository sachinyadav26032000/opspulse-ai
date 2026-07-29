/* ==========================================================================
   Churn reason taxonomy — a controlled vocabulary for WHY.
   --------------------------------------------------------------------------
   exposure.js already writes a `risk_reason` sentence per account, and it is
   good prose. But prose does not group. You cannot count it, rank it, or
   answer "what are the top three reasons my book is at risk this quarter" —
   which is the question a director asks after they have the list. Forty
   sentences is forty things to read; four reasons with counts is a decision.

   So: one PRIMARY reason per account, from a closed vocabulary, plus whatever
   else contributed. The sentence stays — it is the evidence for the label, not
   a replacement for it.

   THREE RULES THIS FILE KEEPS
   ---------------------------
   1. Derived from observables only. `_archetype` is the generator's hidden
      ground truth and this file never reads it — same discipline as every
      detector. tools/ can then SCORE the classifier against it, which is a
      real measurement rather than a tautology.

   2. Nothing is forced into a bucket. An account with no qualifying evidence
      gets `none`, not the nearest-looking label. A taxonomy that always has an
      answer is a taxonomy that is sometimes lying, and the whole product rests
      on not doing that.

   3. Silence is not a reason. It was tempting to make `silent` a seventh
      category, but it answers a different question: usage erosion is why the
      account is leaving, silence is why nobody noticed. Making it compete with
      the causes would hide a cause every time both were true. It is a flag.
   ========================================================================== */

import { REVENUE as T, TUNABLE } from '../../config/thresholds.js';

/* ── The vocabulary ──────────────────────────────────────────────────────
   Ordered by PRECEDENCE, strongest evidence first. An account matching three
   rules takes the first as primary and carries the rest as contributing.

   The order is an argument about evidence quality, not severity:
   a customer telling you they intend to leave outranks anything you inferred
   from telemetry, and a measured absence of adoption outranks a trend line. */
export const CHURN_REASONS = [
  {
    key: 'explicit_intent',
    label: 'Stated intent to leave',
    short: 'Intent',
    question: 'They have told us.',
    detail: 'A cancellation case is on record. This is the only reason here the customer stated rather than us inferring.',
  },
  {
    key: 'never_adopted',
    label: 'Never adopted',
    short: 'Never adopted',
    question: 'Was it ever switched on?',
    detail: 'Seats were provisioned and never activated. Onboarding failed and nothing broke, so nobody escalated.',
  },
  {
    key: 'usage_cliff',
    label: 'Usage collapsed',
    short: 'Cliff',
    question: 'What changed, and when?',
    detail: 'A sharp, recent fall rather than a drift. Something specific happened — a champion left, a project ended, a competitor landed.',
  },
  {
    key: 'usage_erosion',
    label: 'Usage eroding',
    short: 'Erosion',
    question: 'Why is the usage less?',
    detail: 'A sustained slide rather than a break. Rarely one cause, and rarely recoverable by a single call.',
  },
  {
    key: 'service_failure',
    label: 'Service experience',
    short: 'Service',
    question: 'Are we the problem?',
    detail: 'Repeat escalations or unresolved tickets. The product may be fine; the experience of being a customer is not.',
  },
  {
    key: 'sentiment',
    label: 'Sentiment decline',
    short: 'Sentiment',
    question: 'How do they feel about us?',
    detail: 'Detractor NPS or falling CSAT with no operational failure behind it. The softest signal here, and ranked last for that reason.',
  },
];

export const REASON_BY_KEY = new Map(CHURN_REASONS.map((r) => [r.key, r]));

/** Accounts that match nothing. Named rather than null so it can be counted. */
export const NO_REASON = {
  key: 'none',
  label: 'No qualifying signal',
  short: '—',
  question: 'Why is this account on the list at all?',
  detail: 'Renewing, but nothing measured says it is at risk. Often the right answer.',
};

const pct = (n) => `${n > 0 ? '+' : ''}${Math.round(n)}%`;

/**
 * Classify ONE account.
 *
 * `ctx` carries the contact facts the account record does not: escalation
 * count, ticket counts, the last day we heard from them, any cancellation
 * case, and recent/baseline CSAT. Passing it in rather than recomputing per
 * account keeps this O(1) — buildBookReasons does the indexing once.
 *
 * Returns `{ primary, contributing[], evidence[], is_silent, silent_days }`.
 * `evidence` holds the measured values behind every rule that fired, so the
 * label can always show its work.
 */
export function classifyAccount(acct, ctx = {}) {
  const u = acct.usage || {};
  const hist = (u.usage_history || []).map((h) => h.adoption_pct).filter((n) => n != null);
  const matched = [];
  const evidence = [];

  const add = (key, ev) => { matched.push(key); evidence.push({ reason: key, ...ev }); };

  /* 1. Stated intent. */
  if (ctx.cancellation) {
    const c = ctx.cancellation;
    add('explicit_intent', {
      label: c.open ? 'Open cancellation case' : 'Cancellation case on record',
      value: `${c.severity}${c.days_ago != null ? ` · ${c.days_ago}d ago` : ''}`,
      source: 'escalations[] where reason is a cancellation',
    });
  }

  const trend = u.usage_trend_30d;

  /* 2. Never adopted. The discriminator against decline is the HISTORY: an
     account that eroded was once above the bar, so its peak clears it. An
     account that never adopted never does. Without that test every long-dead
     account reads as "eroding", which points a CSM at a save conversation for
     something that was never switched on. */
  const adoption = u.feature_adoption_pct;
  const peak = hist.length ? Math.max(...hist) : adoption;
  /* "Never adopted" means FLAT AND LOW: it never rose, and nothing is
     happening to it now. The second half is what makes it work, and it has to
     be tested on USAGE rather than on adoption.

     Testing the adoption history alone stole 47 of 127 genuine cliffs on the
     canonical seed. Those accounts read 35→27% adoption — an 8-point drift —
     while their usage fell 71% over the same window. The two measure
     different things: adoption is how MUCH of the product they touch, usage is
     how OFTEN. A customer can keep using the same three features far less.
     Only the second number shows the cliff, so only the second number can
     distinguish a collapse from a launch that never happened. */
  const decliningNow = trend != null && trend <= -TUNABLE.usage_decline_pct;
  if (adoption != null && adoption < T.adoption_decision_threshold
      && peak != null && peak < T.adoption_decision_threshold && !decliningNow) {
    add('never_adopted', {
      label: 'Adoption never cleared the bar',
      value: `${Math.round(adoption)}% now, ${Math.round(peak)}% at best over ${hist.length || 0} months`,
      source: 'accounts[].usage.feature_adoption_pct and usage_history[]',
    });
  }

  /* 3 & 4. Collapse vs drift. Same metric, and the boundary is what separates
     "something happened" from "nothing is happening". */
  if (trend != null && trend <= -TUNABLE.usage_cliff_pct) {
    add('usage_cliff', {
      label: 'Sharp fall in the last 30 days',
      value: pct(trend),
      source: 'accounts[].usage.usage_trend_30d',
    });
  } else if (trend != null && trend <= -TUNABLE.usage_decline_pct) {
    add('usage_erosion', {
      label: 'Sustained fall over 30 days',
      value: pct(trend),
      source: 'accounts[].usage.usage_trend_30d',
    });
  }

  /* 5. Service. Two escalations is a pattern; one is an incident.
     BUT contact volume is not risk, and this file must not be the place that
     forgets it. The dataset carries `engaged_noisy` accounts — heavy
     escalators with healthy, rising usage — specifically so a naive model can
     be shown flagging them. A first pass did exactly that: 149 healthy and 42
     engaged_noisy accounts came back as service failures, which would send
     CSMs to apologise to their happiest customers.
     So escalations alone are not enough. The relationship has to be
     deteriorating somewhere else too — usage going the wrong way, or the
     customer saying so. */
  const esc = ctx.escalations || 0;
  const openT = ctx.open_tickets || 0;
  const trendDown = trend != null && trend < 0;
  const lowAdoption = adoption != null && adoption < TUNABLE.adoption_worklist_threshold;
  const unhappy = (ctx.nps != null && ctx.nps <= 6)
    || (ctx.csat_recent != null && ctx.csat_base != null && ctx.csat_recent < ctx.csat_base);
  const relationshipSouring = trendDown || lowAdoption || unhappy;
  if (relationshipSouring && (esc >= 2 || (esc >= 1 && openT >= 1))) {
    add('service_failure', {
      label: esc >= 2 ? 'Repeat escalations' : 'Escalation with work still open',
      value: `${esc} escalation${esc === 1 ? '' : 's'}${openT ? `, ${openT} ticket${openT === 1 ? '' : 's'} open` : ''}`,
      source: 'escalations[] and tickets[] grouped by account_id',
    });
  }

  /* 6. Sentiment — the softest signal, and the one most able to manufacture
     false risk. A detractor score on an account whose usage is rising and
     whose adoption is above the worklist bar is a complaint, not a churn
     reason; treating it as one put 139 healthy accounts on the at-risk list.
     Someone can be annoyed about a specific thing and still be expanding. */
  const activelyHealthy = trend != null && trend > 0
    && adoption != null && adoption >= TUNABLE.adoption_worklist_threshold;
  const { nps, csat_recent: cr, csat_base: cb } = ctx;
  if (activelyHealthy) {
    /* no sentiment reason — the usage contradicts it */
  } else if (nps != null && nps <= 6) {
    add('sentiment', { label: 'Detractor NPS', value: String(nps), source: 'nps_responses[] latest per account' });
  } else if (cr != null && cb != null && cr < cb - 0.5) {
    add('sentiment', {
      label: 'Satisfaction slipping',
      value: `${cb.toFixed(1)}★ → ${cr.toFixed(1)}★`,
      source: 'tickets[].csat, recent window against baseline',
    });
  }

  /* Silence is about DETECTABILITY, not cause — see the header. It rides
     alongside the reason instead of competing with it. */
  const silentDays = ctx.days_since_contact;
  const isSilent = silentDays != null && silentDays >= TUNABLE.silent_account_days;

  const order = CHURN_REASONS.map((r) => r.key);
  matched.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return {
    primary: matched.length ? REASON_BY_KEY.get(matched[0]) : NO_REASON,
    contributing: matched.slice(1).map((k) => REASON_BY_KEY.get(k)),
    evidence,
    is_silent: isSilent,
    silent_days: silentDays ?? null,
  };
}

/**
 * Index the contact facts every account needs, once.
 *
 * One pass per collection rather than a filter per account: at 2,400 accounts
 * against ~40k tickets the naive version is ~96M comparisons and visibly
 * stalls the render.
 */
export function buildContext(ds) {
  const m = new Map();
  for (const a of ds.accounts) {
    m.set(a.account_id, {
      escalations: 0, open_tickets: 0, tickets: 0, last_day: -Infinity,
      cancellation: null, nps: null, csat_recent: null, csat_base: null,
      _csatR: [], _csatB: [], _npsDay: -Infinity,
    });
  }
  const lastDay = ds.meta.days - 1;
  const rf = ds.meta.recent_from;

  for (const t of ds.tickets) {
    const c = m.get(t.account_id); if (!c) continue;
    c.tickets++;
    if (t.day_index > c.last_day) c.last_day = t.day_index;
    if (t.ticket_status !== 'Closed' && t.ticket_status !== 'Resolved') c.open_tickets++;
    const rating = t.customer_satisfaction_rating;
    if (rating != null) (t.day_index >= rf ? c._csatR : c._csatB).push(rating);
  }
  for (const e of ds.escalations) {
    const c = m.get(e.account_id); if (!c) continue;
    c.escalations++;
    /* A cancellation case is the only place a customer states intent rather
       than us inferring it, so it is worth finding precisely. Keep the most
       recent, and record whether it is still open — an open case and an
       80-day-old closed one are not the same fact. */
    /* Same test exposure.js uses, deliberately. Two definitions of "this
       customer said they might leave" drifting apart would put a cancellation
       in the risk_reason sentence and a different reason on the label beside
       it, on the same row. */
    if (/cancel/i.test(e.category || '') || /cancel/i.test(e.reason || '')) {
      const dayIdx = e.day_index ?? 0;
      if (!c.cancellation || dayIdx > c.cancellation.day_index) {
        c.cancellation = {
          day_index: dayIdx,
          days_ago: Math.max(0, lastDay - dayIdx),
          severity: e.severity || 'P2',
          open: e.status !== 'Closed',
        };
      }
    }
  }
  for (const n of ds.nps || []) {
    const c = m.get(n.account_id); if (!c) continue;
    const d = n.day_index ?? 0;
    if (d >= c._npsDay) { c._npsDay = d; c.nps = n.score; }
  }
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  for (const c of m.values()) {
    c.csat_recent = avg(c._csatR);
    c.csat_base = avg(c._csatB);
    c.days_since_contact = c.last_day === -Infinity ? null : lastDay - c.last_day;
    delete c._csatR; delete c._csatB; delete c._npsDay;
  }
  return m;
}

/**
 * Classify a set of accounts and report the mix.
 *
 * The mix is the point: "48 at risk" is a number, "19 eroding, 12 never
 * adopted, 9 service, 8 sentiment" is four different plays.
 */
export function buildBookReasons(ds, accounts, ctx = buildContext(ds)) {
  const rows = accounts.map((a) => ({
    account_id: a.account_id,
    arr_usd: a.arr_usd,
    ...classifyAccount(a, ctx.get(a.account_id) || {}),
  }));

  const tally = new Map();
  for (const r of rows) {
    const k = r.primary.key;
    const t = tally.get(k) || { reason: r.primary, n: 0, arr: 0, silent: 0 };
    t.n++; t.arr += r.arr_usd || 0; if (r.is_silent) t.silent++;
    tally.set(k, t);
  }

  const mix = [...tally.values()].sort((a, b) => b.arr - a.arr || b.n - a.n);
  return {
    rows,
    byId: new Map(rows.map((r) => [r.account_id, r])),
    mix,
    total: rows.length,
    silent: rows.filter((r) => r.is_silent).length,
    unexplained: rows.filter((r) => r.primary.key === 'none').length,
  };
}
