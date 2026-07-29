/* ==========================================================================
   Renewals × Adoption — the cohort a CS director actually works.
   --------------------------------------------------------------------------
   From the validation call, almost verbatim:

     "What are my upcoming Q3 renewals? And add me another column which says
      MAU — monthly active usage, or product adoption. Let's say it's less than
      70 or 60%, and that's the cohort I go after."

   Two controls, one table. This is deliberately NOT a report builder: the
   workflow is one query run repeatedly, not twenty queries run once.

   THREE SCOPE LEVELS, because "my renewals" means different books to different
   people in the same org:

     csm      an individual queue        ~40 accounts, ~6 renewing a quarter
     region   a director's book          ~90 renewing a quarter   ← default
     all      the VP rollup              ~360 renewing a quarter

   Region is the default because it is the altitude the question was asked at.

   The table is a WORKING LIST, not a decision — forty rows sorted by ARR is
   correct here. Decision sizing applies to the brief item that points at this
   surface, not to the surface itself.
   ========================================================================== */

import { buildBookReasons } from './churn-reason.js';

const DAY = 86400000;

/* Defaults live in config/thresholds.js so a customer can tune them at
   onboarding — "less than 70 or 60%" was said as one phrase on the call, which
   is what a dial sounds like. Re-exported under the original name. */
export { COHORT as COHORT_DEFAULTS } from '../../config/thresholds.js';
import { COHORT as COHORT_DEFAULTS } from '../../config/thresholds.js';

export const WINDOWS = [
  { key: 'quarter', label: 'This quarter' },
  { key: 'next_quarter', label: 'Next quarter' },
  { key: 'd90', label: 'Next 90 days' },
  { key: 'd180', label: 'Next 180 days' },
];

/** Day offsets from as-of for a named window. */
export function windowRange(key, asOf) {
  const d = new Date(asOf);
  const q = Math.floor(d.getMonth() / 3);
  const mk = (start, end) => ({
    from: Math.max(0, Math.ceil((start - asOf) / DAY)),
    to: Math.floor((end - asOf) / DAY),
  });

  if (key === 'quarter') {
    const end = new Date(d.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
    return { ...mk(asOf, end.getTime()), label: `Q${q + 1} ${d.getFullYear()}` };
  }
  if (key === 'next_quarter') {
    const s = new Date(d.getFullYear(), q * 3 + 3, 1);
    const e = new Date(d.getFullYear(), q * 3 + 6, 0, 23, 59, 59);
    const nq = (q + 1) % 4;
    return { ...mk(s.getTime(), e.getTime()), label: `Q${nq + 1} ${s.getFullYear()}` };
  }
  const days = key === 'd180' ? 180 : 90;
  return { from: 0, to: days, label: `next ${days} days` };
}

/** The scope options actually present in this dataset, largest book first. */
export function scopeOptions(ds) {
  const byRegion = tally(ds.accounts, (a) => a.region);
  const byCsm = tally(ds.accounts, (a) => a.csm);
  return {
    all: [{ key: '*', label: 'All accounts', n: ds.accounts.length }],
    region: byRegion,
    csm: byCsm,
  };
}

function tally(rows, get) {
  const m = new Map();
  for (const r of rows) m.set(get(r), (m.get(get(r)) || 0) + 1);
  return [...m.entries()].map(([key, n]) => ({ key, label: key, n })).sort((a, b) => b.n - a.n);
}

/**
 * Build the cohort.
 *
 * `at risk` is the ARR of accounts below the adoption threshold — not the
 * whole renewal book. The distinction is the point of the screen: plenty of
 * accounts renew, and only some of them are in trouble.
 */
export function buildCohort(ds, opts = {}) {
  const asOf = ds.meta.as_of;
  const scope = opts.scope || COHORT_DEFAULTS.scope;
  const threshold = opts.adoption_worklist_threshold ?? COHORT_DEFAULTS.adoption_worklist_threshold;
  const win = windowRange(opts.window || COHORT_DEFAULTS.window, asOf);

  /* Accounts a decision elsewhere already names individually. They stay ON the
     list — hiding them made the surface say 104 where the card said 100, and a
     reader's first conclusion is that one of the two numbers is wrong. Showing
     all of them with four marked is visible arithmetic: it demonstrates that
     the two decisions deliberately don't double-count, rather than asking the
     reader to take it on trust. */
  const countedElsewhere = new Set(opts.counted_elsewhere || []);

  const options = scopeOptions(ds);
  const scopeValue = opts.scopeValue || (scope === 'all' ? '*' : options[scope][0]?.key);

  const inScope = ds.accounts.filter((a) => {
    if (scope === 'all') return true;
    if (scope === 'region') return a.region === scopeValue;
    return a.csm === scopeValue;
  });

  const renewing = inScope.filter((a) => a.renewal_in_days >= win.from && a.renewal_in_days <= win.to);

  /* WHY each account is at risk, not just that it is. The director's follow-up
     question — "why is the usage less?" — is a per-row question on this screen
     and a mix question on the summary. Classified over the renewing set only,
     since that is what the screen is about. */
  const reasons = buildBookReasons(ds, renewing);

  const rows = renewing
    .map((a) => {
      const u = a.usage || {};
      const b = a.billing || {};
      const adoption = u.feature_adoption_pct ?? null;
      const why = reasons.byId.get(a.account_id);
      return {
        churn_reason: why.primary,
        churn_contributing: why.contributing,
        churn_evidence: why.evidence,
        is_silent: why.is_silent,
        silent_days: why.silent_days,
        account_id: a.account_id,
        account_name: a.company,
        arr_usd: a.arr_usd,
        plan: a.plan,
        region: a.region,
        owner: a.csm,
        renewal_in_days: a.renewal_in_days,
        renewal_date: b.renewal_date || null,
        effective_churn_date: b.effective_churn_date || null,
        effective_churn_in_days: b.effective_churn_in_days ?? a.renewal_in_days,
        billing_channel: b.channel || null,
        credit_days: b.credit_days ?? 0,
        // True where the credit window changes which account to work first.
        runway_differs: (b.credit_days ?? 0) > 0,
        adoption_pct: adoption,
        below_threshold: adoption != null && adoption < threshold,
        counted_elsewhere: countedElsewhere.has(a.account_id),
        usage_trend_30d: u.usage_trend_30d ?? null,
        history: (u.usage_history || []).map((h) => h.adoption_pct),
        seats_active_30d: u.seats_active_30d ?? null,
        seats_provisioned: u.seats_provisioned ?? null,
      };
    })
    .sort((x, y) => y.arr_usd - x.arr_usd);

  const atRisk = rows.filter((r) => r.below_threshold);
  /* The mix is computed over the AT-RISK rows, not the whole renewal book:
     "48 at risk" is a number, "19 eroding, 12 never adopted, 9 service" is
     four different plays and a staffing decision. */
  const reasonMix = (() => {
    const m = new Map();
    for (const r of atRisk) {
      const t = m.get(r.churn_reason.key) || { reason: r.churn_reason, n: 0, arr: 0 };
      t.n++; t.arr += r.arr_usd; m.set(r.churn_reason.key, t);
    }
    return [...m.values()].sort((a, b) => b.arr - a.arr || b.n - a.n);
  })();
  /* The cohort a play would cover: at-risk minus whatever is already owned
     individually. This is the figure the brief card carries. */
  const alsoNamed = atRisk.filter((r) => r.counted_elsewhere);
  const playable = atRisk.filter((r) => !r.counted_elsewhere);

  return {
    rows,
    scope,
    scopeValue,
    scopeLabel: scope === 'all' ? 'All accounts' : scopeValue,
    options,
    window: win,
    threshold,
    summary: {
      renewing: rows.length,
      below: atRisk.length,
      arr_at_risk: atRisk.reduce((s, r) => s + r.arr_usd, 0),
      arr_total: rows.reduce((s, r) => s + r.arr_usd, 0),
      also_named: alsoNamed.length,
      also_named_arr: alsoNamed.reduce((s, r) => s + r.arr_usd, 0),
      playable: playable.length,
      playable_arr: playable.reduce((s, r) => s + r.arr_usd, 0),
      reason_mix: reasonMix,
      silent_below: atRisk.filter((r) => r.is_silent).length,
      offline_below: atRisk.filter((r) => r.runway_differs).length,
      // Accounts whose real deadline sits in a later month than the renewal.
      runway_gained: atRisk.filter((r) => r.runway_differs).reduce((s, r) => s + r.credit_days, 0),
    },
  };
}
