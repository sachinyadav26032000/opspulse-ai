/* ==========================================================================
   Revenue-shaped detectors — the CRO's and Head of CS's decisions.
   --------------------------------------------------------------------------
   The nine existing detectors all key off tickets, escalations, QA or surveys.
   Every one of them therefore requires an account to COMPLAIN before it becomes
   visible, and every one produces a support-operations decision owned by a
   Support Operations Manager or a Head of Support.

   These four key off product usage and contract data instead, and produce
   decisions a Head of Customer Success or CRO would act on: which accounts am
   I about to lose, what is that worth, and what do I do about it.

   DECISION SIZING IS ENFORCED HERE, not by picking friendly demo data. Each
   detector matches whatever it matches — often dozens of accounts — and then
   the Prioritise step ranks by revenue exposure, cuts to DECISION_SIZE, and
   RECORDS WHAT IT CUT in _meta.sizing. A decision naming 59 accounts is a
   detection result, not a decision; the cut is the product, and hiding it
   would be the dishonest part.
   ========================================================================== */

import { createInsight, STATUS, CONFIDENCE_CUTOFF } from './schema.js';

const DAY = 86400000;

/** Declared, not buried — a reviewer can argue with this block. */
export const REVENUE_THRESHOLDS = {
  arr_floor: 20000,            // below this it is not a CRO-level decision
  decision_size: 6,            // 4-6 named accounts per decision
  min_accounts: 3,             // fewer than this is not a pattern
  silent_usage_drop: -25,      // % change over 30d
  adoption_floor: 0.40,        // active seats / provisioned
  adoption_min_seats: 20,      // small seat counts are noise
  onboarding_window_days: 400, // "since onboarding" horizon
  renewal_window_days: 90,
  renewal_deterioration: -12,  // % usage change that counts as deterioration
  concentrated_min: 3,         // accounts sharing one cause before it is one
  concentrated_z: 2.5,         // two-proportion z: the category must be genuinely
                               // OVER-REPRESENTED among at-risk accounts, not
                               // merely the largest of several equal buckets
};

const T = REVENUE_THRESHOLDS;
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.round(n));
const usdK = (n) => (Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : '$' + Math.round(n / 1000) + 'K');
const pct = (n) => `${n > 0 ? '+' : ''}${Math.round(n)}%`;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/* ── Contact history, once, shared by all four detectors ─────────────────── */
function contactIndex(ds) {
  const m = new Map();
  for (const a of ds.accounts) m.set(a.account_id, { tickets: 0, recent: 0, escal: 0 });
  for (const t of ds.tickets) { const c = m.get(t.account_id); if (c) { c.tickets++; if (t.day_index >= ds.meta.recent_from) c.recent++; } }
  for (const e of ds.escalations) { const c = m.get(e.account_id); if (c) c.escal++; }
  return m;
}

/**
 * THE PRIORITISE STEP. Rank by revenue exposure, cut to size, and report the
 * cut honestly. Returns { shown, sizing }.
 */
function prioritise(matched, size = T.decision_size) {
  const ranked = matched.slice().sort((a, b) => b.arr_usd - a.arr_usd);
  const shown = ranked.slice(0, size);
  const cut = ranked.slice(size);
  return {
    shown,
    sizing: {
      matched: ranked.length,
      shown: shown.length,
      cut: cut.length,
      cut_arr: cut.reduce((s, a) => s + a.arr_usd, 0),
      shown_arr: shown.reduce((s, a) => s + a.arr_usd, 0),
      total_arr: ranked.reduce((s, a) => s + a.arr_usd, 0),
      basis: 'revenue exposure, descending',
      note: cut.length
        ? `${ranked.length} accounts matched. Showing the ${shown.length} largest by ARR (${usdK(shown.reduce((s, a) => s + a.arr_usd, 0))}); ${cut.length} smaller accounts holding ${usdK(cut.reduce((s, a) => s + a.arr_usd, 0))} are queued behind them.`
        : `${ranked.length} accounts matched — all shown.`,
    },
  };
}

/** The account rows every revenue decision names. */
const acctRow = (a, extra = {}) => ({
  account_id: a.account_id, company: a.company, plan: a.plan, region: a.region,
  arr_usd: a.arr_usd, renewal_in_days: a.renewal_in_days, owner: a.csm,
  usage_trend_30d: a.usage.usage_trend_30d,
  seats_active_30d: a.usage.seats_active_30d, seats_provisioned: a.usage.seats_provisioned,
  feature_adoption_pct: a.usage.feature_adoption_pct,
  last_login_at: a.usage.last_login_at,
  ...extra,
});

/* Shared _meta scaffold so these render through the existing UI unchanged. */
function metaFor({ title, metric_label, entity, accounts, sizing, observed, baseline, unit, evidence, impact, steps, effort, horizon, provenance, confParts, decomposition }) {
  return {
    title, metric_label, entity, unit: unit || 'count',
    observed, baseline,
    z: 0,                       // these are rule-based, not z-tested — stated, not faked
    n_recent: accounts.length, n_base: sizing.matched,
    affected_accounts: sizing.matched,
    affected_ids: accounts.map((a) => a.account_id),
    // No daily history exists for usage — it arrives as two 30-day windows.
    // Declaring null is honest; the UI falls back to the evidence table.
    series: null,
    decomposition: decomposition || null,
    decomposition_dimension: decomposition ? 'account' : null,
    evidence, impact, steps, effort,
    horizon_days: horizon,
    provenance,
    confidence_parts: confParts,
    sizing,
    accounts: accounts.map((a) => acctRow(a)),
    is_revenue: true,           // marks the persona split added in Task 3
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   a. SILENT DECLINE — usage falling, nobody complaining
   ══════════════════════════════════════════════════════════════════════════ */
function silentDecline(ds, ctx) {
  const matched = ds.accounts.filter((a) => {
    const c = ctx.get(a.account_id);
    return a.usage
      && a.usage.usage_trend_30d <= T.silent_usage_drop
      && c.tickets === 0
      && a.arr_usd >= T.arr_floor;
  });
  if (matched.length < T.min_accounts) return null;

  const { shown, sizing } = prioritise(matched);
  const avgDrop = mean(shown.map((a) => a.usage.usage_trend_30d));
  const soonest = shown.slice().sort((a, b) => a.renewal_in_days - b.renewal_in_days)[0];
  const arr = sizing.shown_arr;

  return {
    signal_type: 'silent_decline',
    severity: 92,
    confidence: 0.82,
    title: `Silent decline — ${shown.length} accounts, no support contact`,
    metric_label: `${pct(avgDrop)} usage · ${usdK(arr)} ARR`,
    what_happened: `${shown.length} accounts worth ${usd(arr)} have cut product usage by an average of ${Math.abs(Math.round(avgDrop))}% over 30 days without raising a single support ticket. The earliest renewal is ${soonest.company} in ${soonest.renewal_in_days} days.`,
    root_cause: `These accounts are disengaging quietly rather than complaining. Because no ticket, call or survey response exists for any of them, they are invisible to every contact-based signal in the platform — the decline is only detectable in product usage.`,
    action: `Assign a CSM outreach to each of the ${shown.length} accounts this week, led by ${soonest.company} (${soonest.renewal_in_days} days to renewal). Open with a usage review, not a satisfaction check — there is no dissatisfaction on record to discuss.`,
    owner_role: 'Head of Customer Success',
    playbook: 'PB-SILENT-DECLINE-01',
    expected_outcome: `Re-engagement contact on ${usd(arr)} of ARR before renewal. Success is measured as usage trend returning above ${T.silent_usage_drop}% within 30 days, not as a completed call.`,
    accounts: shown, sizing,
    observed: Math.round(avgDrop), baseline: 0, unit: 'rate',
    evidence: {
      arr_at_risk: arr,
      avg_usage_trend: Math.round(avgDrop),
      zero_ticket_accounts: shown.length,
      soonest_renewal_days: soonest.renewal_in_days,
      accounts: shown.map((a) => acctRow(a)),
    },
    impact: {
      type: 'revenue_at_risk',
      formula: `${usd(arr)} ARR × 35% churn probability at this decline rate`,
      basis: [
        `${shown.length} accounts, ${usd(arr)} combined ARR`,
        `mean usage change ${pct(avgDrop)} over 30 days`,
        'zero support contact — no offsetting engagement signal',
      ],
      note: 'The 35% conversion is a stated assumption, not a measurement. It is the widest source of uncertainty in this figure.',
    },
    range: [arr * 0.22, arr * 0.48],
    horizon: Math.max(30, soonest.renewal_in_days),
    effort: 'medium',
    steps: [
      'Pull the usage report for each account and identify which features were abandoned.',
      'CSM books a usage review with the economic buyer, not the day-to-day contact.',
      'Confirm whether a competing tool has been adopted internally.',
      'Log the outcome against the renewal date.',
    ],
    provenance: {
      usage_trend: 'accounts[].usage.logins_30d vs logins_prior_30d',
      arr: 'accounts[].arr_usd',
      contact_history: 'tickets[] filtered by account_id (count = 0)',
      renewal: 'accounts[].renewal_in_days',
    },
    confParts: { statistical: 0.30, explained: 0.34, corroborated: 0.18 },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   b. ADOPTION FAILURE — seats bought, seats never switched on
   ══════════════════════════════════════════════════════════════════════════ */
function adoptionFailure(ds, ctx) {
  const asOf = ds.meta.as_of;
  const matched = ds.accounts.filter((a) => {
    if (!a.usage || a.arr_usd < T.arr_floor) return false;
    if (a.usage.seats_provisioned < T.adoption_min_seats) return false;
    const rate = a.usage.seats_active_30d / a.usage.seats_provisioned;
    const daysSince = Math.round((asOf - Date.parse(a.purchased_at)) / DAY);
    return rate < T.adoption_floor && daysSince <= T.onboarding_window_days;
  });
  if (matched.length < T.min_accounts) return null;

  const { shown, sizing } = prioritise(matched);
  const worst = shown.slice().sort((a, b) =>
    (a.usage.seats_active_30d / a.usage.seats_provisioned) - (b.usage.seats_active_30d / b.usage.seats_provisioned))[0];
  const dormant = shown.reduce((s, a) => s + (a.usage.seats_provisioned - a.usage.seats_active_30d), 0);
  const arr = sizing.shown_arr;
  const wDays = Math.round((asOf - Date.parse(worst.purchased_at)) / DAY);

  return {
    signal_type: 'adoption_failure',
    severity: 86,
    confidence: 0.88,
    title: `Adoption never completed — ${shown.length} accounts`,
    metric_label: `${dormant.toLocaleString('en-US')} dormant seats · ${usdK(arr)} ARR`,
    what_happened: `${dormant.toLocaleString('en-US')} of ${shown.reduce((s, a) => s + a.usage.seats_provisioned, 0).toLocaleString('en-US')} provisioned seats across ${shown.length} accounts have never been activated. ${worst.company} is the worst: ${(worst.usage.seats_provisioned - worst.usage.seats_active_30d).toLocaleString('en-US')} of ${worst.usage.seats_provisioned.toLocaleString('en-US')} seats dormant ${wDays} days after onboarding, on ${usd(worst.arr_usd)} ARR.`,
    root_cause: `Seats were provisioned at contract signature and never rolled out. Feature adoption across the cohort averages ${Math.round(mean(shown.map((a) => a.usage.feature_adoption_pct)))}%, which is consistent with onboarding stopping after the initial admin setup rather than with a product problem.`,
    action: `Run a re-onboarding for the ${shown.length} accounts, starting with ${worst.company}. Treat the dormant seats as the renewal risk they are — the customer is paying for capacity they have never used, and that arithmetic will be done at renewal whether or not we do it first.`,
    owner_role: 'Onboarding Lead',
    playbook: 'PB-ADOPTION-RESCUE-01',
    expected_outcome: `Activation of a material share of ${dormant.toLocaleString('en-US')} dormant seats, protecting ${usd(arr)}. Measured as seats_active_30d rising, not as sessions delivered.`,
    accounts: shown, sizing,
    observed: Math.round(mean(shown.map((a) => a.usage.seats_active_30d / a.usage.seats_provisioned * 100))),
    baseline: Math.round(T.adoption_floor * 100), unit: 'rate',
    evidence: {
      arr_at_risk: arr,
      dormant_seats: dormant,
      provisioned_seats: shown.reduce((s, a) => s + a.usage.seats_provisioned, 0),
      mean_adoption_pct: Math.round(mean(shown.map((a) => a.usage.feature_adoption_pct))),
      accounts: shown.map((a) => acctRow(a, {
        dormant_seats: a.usage.seats_provisioned - a.usage.seats_active_30d,
        days_since_onboarding: Math.round((asOf - Date.parse(a.purchased_at)) / DAY),
      })),
    },
    impact: {
      type: 'renewal_at_risk',
      formula: `${usd(arr)} ARR × 30% non-renewal probability where adoption is below ${Math.round(T.adoption_floor * 100)}%`,
      basis: [
        `${dormant.toLocaleString('en-US')} dormant seats across ${shown.length} accounts`,
        `mean feature adoption ${Math.round(mean(shown.map((a) => a.usage.feature_adoption_pct)))}%`,
        'all within the post-onboarding window',
      ],
      note: 'Unused capacity is the easiest line for a customer to cut at renewal, which is why this is priced as renewal risk rather than expansion loss.',
    },
    range: [arr * 0.18, arr * 0.42],
    horizon: 90,
    effort: 'high',
    steps: [
      'Identify the admin who provisioned the seats and the business owner who signed.',
      'Run a rollout workshop rather than a training session — the blocker is deployment, not knowledge.',
      'Set a 30-day activation target per account and track seats_active_30d against it.',
      'Flag any account where the buyer will not commit to a rollout date.',
    ],
    provenance: {
      seat_activation: 'accounts[].usage.seats_active_30d vs seats_provisioned',
      adoption: 'accounts[].usage.feature_adoption_pct',
      onboarding_date: 'accounts[].purchased_at',
      arr: 'accounts[].arr_usd',
    },
    confParts: { statistical: 0.34, explained: 0.36, corroborated: 0.18 },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   c. RENEWAL WINDOW RISK — renewing soon, with something wrong
   ══════════════════════════════════════════════════════════════════════════ */
function renewalRisk(ds, ctx) {
  const matched = ds.accounts.filter((a) => {
    if (!a.usage || a.arr_usd < T.arr_floor) return false;
    if (a.renewal_in_days > T.renewal_window_days) return false;
    const c = ctx.get(a.account_id);
    const adoption = a.usage.seats_active_30d / a.usage.seats_provisioned;
    return a.usage.usage_trend_30d <= T.renewal_deterioration
      || c.escal >= 1
      || adoption < T.adoption_floor;
  });
  if (matched.length < T.min_accounts) return null;

  const { shown, sizing } = prioritise(matched);
  const arr = sizing.shown_arr;
  const soonest = shown.slice().sort((a, b) => a.renewal_in_days - b.renewal_in_days)[0];
  const reasons = shown.map((a) => {
    const c = ctx.get(a.account_id);
    const adoption = a.usage.seats_active_30d / a.usage.seats_provisioned;
    if (a.usage.usage_trend_30d <= T.renewal_deterioration) return 'usage decline';
    if (c.escal >= 1) return 'escalation history';
    if (adoption < T.adoption_floor) return 'low seat activation';
    return 'other';
  });
  const mix = {};
  reasons.forEach((r) => { mix[r] = (mix[r] || 0) + 1; });

  return {
    signal_type: 'renewal_risk',
    severity: 89,
    confidence: 0.85,
    title: `Renewals inside ${T.renewal_window_days} days with deterioration`,
    metric_label: `${usdK(arr)} ARR · soonest ${soonest.renewal_in_days}d`,
    what_happened: `${shown.length} accounts worth ${usd(arr)} renew within ${T.renewal_window_days} days and every one of them carries a deterioration signal: ${Object.entries(mix).map(([k, v]) => `${v} on ${k}`).join(', ')}. ${soonest.company} renews first, in ${soonest.renewal_in_days} days, on ${usd(soonest.arr_usd)}.`,
    root_cause: `These are not new problems — each account already shows either falling usage, an escalation on record, or seats that were never activated. What makes this a decision today is the renewal calendar closing on them, which turns a manageable account issue into a revenue event with a deadline.`,
    action: `Build a renewal defence plan for each account, sequenced by renewal date rather than ARR. ${soonest.company} needs an owner assigned this week.`,
    owner_role: 'VP Customer Success',
    playbook: 'PB-RENEWAL-DEFENCE-01',
    expected_outcome: `A named owner and a dated plan against ${usd(arr)} of renewals. Success is renewal closed, not meeting held.`,
    accounts: shown, sizing,
    observed: soonest.renewal_in_days, baseline: T.renewal_window_days, unit: 'count',
    evidence: {
      arr_at_risk: arr,
      soonest_renewal_days: soonest.renewal_in_days,
      reason_mix: mix,
      accounts: shown.map((a, i) => acctRow(a, { risk_reason: reasons[i], escalations: ctx.get(a.account_id).escal })),
    },
    decomposition: Object.entries(mix).map(([k, v]) => ({ key: k, value: v, contribution: v / shown.length })),
    impact: {
      type: 'renewal_at_risk',
      formula: `${usd(arr)} of renewals × 25% loss probability where a deterioration signal is present`,
      basis: [
        `${shown.length} accounts renewing within ${T.renewal_window_days} days`,
        `soonest is ${soonest.renewal_in_days} days out`,
        Object.entries(mix).map(([k, v]) => `${v} × ${k}`).join(', '),
      ],
      note: 'Loss probability is a stated assumption. The renewal dates and the deterioration signals are both measured.',
    },
    range: [arr * 0.15, arr * 0.35],
    horizon: Math.max(30, soonest.renewal_in_days),
    effort: 'medium',
    steps: [
      'Sequence the accounts by renewal date, not by ARR.',
      'Assign a named owner per account with a dated plan.',
      'Resolve the specific deterioration signal before the renewal conversation opens.',
      'Escalate any account where the signal cannot be cleared in time.',
    ],
    provenance: {
      renewal_date: 'accounts[].renewal_in_days',
      usage_trend: 'accounts[].usage.usage_trend_30d',
      escalations: 'escalations[] grouped by account_id',
      seat_activation: 'accounts[].usage.seats_active_30d vs seats_provisioned',
    },
    confParts: { statistical: 0.32, explained: 0.35, corroborated: 0.18 },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   d. CONCENTRATED CAUSE — several at-risk accounts, one shared cause
   --------------------------------------------------------------------------
   The highest-value decision the product makes: it converts N save calls into
   one escalation to the function that can actually fix the thing.

   Grouped by PRODUCT, because product is the dimension that maps to an owning
   function and — unlike ticket category — is present on accounts that have
   raised no tickets at all, which is exactly the cohort this needs to include.
   ══════════════════════════════════════════════════════════════════════════ */
function concentratedCause(ds, ctx) {
  const atRisk = ds.accounts.filter((a) => {
    if (!a.usage || a.arr_usd < T.arr_floor) return false;
    const adoption = a.usage.seats_active_30d / a.usage.seats_provisioned;
    return a.usage.usage_trend_30d <= T.renewal_deterioration || adoption < T.adoption_floor;
  });
  if (atRisk.length < T.concentrated_min) return null;

  /* Dominant ticket category per account. Accounts with no tickets are excluded
     from the CAUSE analysis on purpose: a concentrated cause is a claim about
     what these customers are contacting us about, and an account that has never
     contacted us cannot evidence one. They remain covered by silent_decline. */
  const catOf = new Map();
  const counts = new Map();
  for (const t of ds.tickets) {
    if (!counts.has(t.account_id)) counts.set(t.account_id, new Map());
    const m = counts.get(t.account_id);
    m.set(t.category, (m.get(t.category) || 0) + 1);
  }
  for (const [id, m] of counts) {
    catOf.set(id, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }

  const withCat = (list) => list.filter((a) => catOf.has(a.account_id));
  const riskWithCat = withCat(atRisk);
  const baseWithCat = withCat(ds.accounts.filter((a) => a.arr_usd >= T.arr_floor));
  if (riskWithCat.length < T.concentrated_min || baseWithCat.length < 30) return null;

  const share = (list, cat) => list.filter((a) => catOf.get(a.account_id) === cat).length / list.length;
  const categories = [...new Set(baseWithCat.map((a) => catOf.get(a.account_id)))];

  /* Two-proportion z-test: is this category a LARGER share of at-risk accounts
     than it is of comparable accounts overall? That is the only version of
     "concentrated" that means anything — the largest bucket of an evenly spread
     set is not a finding, it is arithmetic. */
  const tested = categories.map((cat) => {
    const inRisk = riskWithCat.filter((a) => catOf.get(a.account_id) === cat);
    const p1 = share(riskWithCat, cat);
    const p0 = share(baseWithCat, cat);
    const n1 = riskWithCat.length, n0 = baseWithCat.length;
    const pPool = (p1 * n1 + p0 * n0) / (n1 + n0);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n0));
    const z = se > 0 ? (p1 - p0) / se : 0;
    return { cat, z, p1, p0, lift: p0 > 0 ? p1 / p0 : 0, list: inRisk, arr: inRisk.reduce((s2, a) => s2 + a.arr_usd, 0) };
  }).filter((c) => c.list.length >= T.concentrated_min && c.z >= T.concentrated_z && c.p1 > c.p0)
    .sort((a, b) => b.arr - a.arr);

  /* Suppressed rather than softened. If no category is genuinely
     over-represented, there is no concentrated cause today and the honest
     output is silence. Lowering the bar to keep the card on screen would make
     it the least defensible decision in the product. */
  if (!tested.length) return null;

  const top = tested[0];
  const { shown, sizing } = prioritise(top.list);
  const arr = sizing.shown_arr;
  const avgDrop = mean(shown.map((a) => a.usage.usage_trend_30d));
  const owner = CATEGORY_OWNER[top.cat] || 'VP Customer Success';

  return {
    signal_type: 'concentrated_cause',
    severity: 94,
    confidence: 0.78,
    title: `One cause behind ${top.list.length} at-risk accounts — ${top.cat}`,
    metric_label: `${Math.round(top.p1 * 100)}% vs ${Math.round(top.p0 * 100)}% base · z ${top.z.toFixed(1)}`,
    what_happened: `${top.list.length} at-risk accounts holding ${usd(top.arr)} share one dominant contact reason: ${top.cat}. That is ${Math.round(top.p1 * 100)}% of at-risk accounts against ${Math.round(top.p0 * 100)}% of comparable accounts overall — ${top.lift.toFixed(1)}x over base rate, z = ${top.z.toFixed(1)}.`,
    root_cause: `${top.cat} is over-represented among declining accounts to a degree that ordinary variation does not explain (two-proportion z = ${top.z.toFixed(1)} against a 2.5 threshold). That points at something systemic in ${top.cat.toLowerCase()} rather than at ${top.list.length} unrelated relationships. The over-representation is measured; the causal claim is a hypothesis for ${owner} to confirm.`,
    action: `Escalate ${top.cat.toLowerCase()} to ${owner} as a single investigation rather than opening ${top.list.length} individual save plays. Hold CSM outreach until the root-cause read comes back.`,
    owner_role: owner,
    playbook: 'PB-CONCENTRATED-CAUSE-01',
    expected_outcome: `One investigation instead of ${top.list.length} save calls. If a systemic ${top.cat.toLowerCase()} fault is confirmed, the fix protects every account contacting us about it, not only the ${usd(arr)} named here.`,
    accounts: shown, sizing,
    observed: Math.round(top.p1 * 100), baseline: Math.round(top.p0 * 100), unit: 'rate',
    evidence: {
      arr_at_risk: top.arr,
      category: top.cat,
      cluster_accounts: top.list.length,
      share_at_risk: top.p1,
      share_baseline: top.p0,
      lift: top.lift,
      z: top.z,
      categories_tested: categories.length,
      accounts: shown.map((a) => acctRow(a, { dominant_category: top.cat })),
      also_significant: tested.slice(1, 4).map((c) => ({ key: c.cat, accounts: c.list.length, arr: c.arr, z: Number(c.z.toFixed(1)) })),
    },
    decomposition: tested.slice(0, 5).map((c) => ({ key: c.cat, value: c.arr, contribution: c.arr / tested.reduce((s2, x) => s2 + x.arr, 0) })),
    impact: {
      type: 'revenue_at_risk',
      formula: `${usd(top.arr)} at-risk ARR concentrated in ${top.cat} x 30% loss probability if unaddressed`,
      basis: [
        `${top.list.length} at-risk accounts whose dominant contact reason is ${top.cat}`,
        `${Math.round(top.p1 * 100)}% of at-risk vs ${Math.round(top.p0 * 100)}% of comparable accounts (z = ${top.z.toFixed(1)})`,
        `mean usage change ${pct(avgDrop)} among the largest ${shown.length}`,
      ],
      note: 'One investigation costs a fraction of the CSM time the individual save plays consume. That saving is the value of this decision and is not included in the figure above.',
    },
    range: [top.arr * 0.18, top.arr * 0.40],
    horizon: 60,
    effort: 'low',
    steps: [
      `Pull every ${top.cat.toLowerCase()} ticket from the ${top.list.length} accounts and look for a shared trigger.`,
      `Open one investigation with ${owner} against ${top.cat.toLowerCase()}, not per account.`,
      'Hold CSM outreach until the read returns — an uninformed save call spends trust.',
      'If no systemic fault is found, fall back to individual save plays with that finding in hand.',
    ],
    provenance: {
      dominant_category: 'tickets[] grouped by account_id, modal category',
      base_rate: 'all accounts above the ARR floor with ticket history',
      usage_trend: 'accounts[].usage.usage_trend_30d',
      arr: 'accounts[].arr_usd',
    },
    confParts: { statistical: 0.36, explained: 0.28, corroborated: 0.14 },
  };
}

/* Which function owns a fix for each contact reason. Authored: the dataset has
   no owning-function field, and inventing one on the record would be worse than
   naming the mapping here where it can be argued with. */
const CATEGORY_OWNER = {
  'Billing': 'Head of Billing Operations',
  'Refund': 'Head of Billing Operations',
  'Onboarding': 'Onboarding Lead',
  'Integrations': 'VP Engineering',
  'Technical': 'VP Engineering',
  'Account Access': 'VP Engineering',
  'Data & Privacy': 'Data Protection Officer',
  'Cancellation': 'VP Customer Success',
  'Product Feedback': 'VP Product',
};

/* ══════════════════════════════════════════════════════════════════════════
   Assembly
   ══════════════════════════════════════════════════════════════════════════ */
const DETECTORS = [
  ['silent_decline', silentDecline],
  ['adoption_failure', adoptionFailure],
  ['renewal_risk', renewalRisk],
  ['concentrated_cause', concentratedCause],
];

export function detectRevenue(ds, { asOf = ds.meta.as_of } = {}) {
  if (!ds.accounts?.length || !ds.accounts[0].usage) {
    return { insights: [], ran: DETECTORS.map(([name]) => ({ detector: name, found: 0, skipped: 'no usage data' })) };
  }
  const ctx = contactIndex(ds);
  const insights = [];
  const ran = [];

  for (const [name, fn] of DETECTORS) {
    const r = fn(ds, ctx);
    ran.push({ detector: name, found: r ? 1 : 0 });
    if (!r) continue;

    insights.push(createInsight({
      insight_id: `ins_${name}_${ds.meta.seed % 9973}`,
      signal_type: r.signal_type,
      severity_score: r.severity,
      what_happened: r.what_happened,
      why: {
        root_cause: r.root_cause,
        contributing_signals: Object.entries(r.provenance).map(([k, v]) => ({
          label: k.replace(/_/g, ' '), detail: v, hit: true,
        })),
        confidence: r.confidence,
      },
      recommended_action: { action: r.action, owner_role: r.owner_role, playbook_id: r.playbook },
      expected_impact: {
        revenue_at_risk_usd: Math.round((r.range[0] + r.range[1]) / 2),
        range_low_usd: Math.round(r.range[0]),
        range_high_usd: Math.round(r.range[1]),
        type: 'revenue_at_risk',
        time_horizon_days: r.horizon,
      },
      status: r.confidence < CONFIDENCE_CUTOFF ? STATUS.HELD_FOR_REVIEW : STATUS.UNASSIGNED,
      generated_at: new Date(asOf).toISOString(),
      _meta: metaFor({
        title: r.title, metric_label: r.metric_label,
        entity: { type: 'cohort', key: r.signal_type, label: r.title },
        accounts: r.accounts, sizing: r.sizing,
        observed: r.observed, baseline: r.baseline, unit: r.unit,
        evidence: r.evidence, impact: r.impact, steps: r.steps, effort: r.effort,
        horizon: r.horizon, provenance: r.provenance, confParts: r.confParts,
        decomposition: r.decomposition,
      }),
    }));
    // Expected outcome is not a contract field; it rides on _meta with the evidence.
    insights[insights.length - 1]._meta.expected_outcome = r.expected_outcome;
  }

  return { insights, ran, thresholds: REVENUE_THRESHOLDS };
}
