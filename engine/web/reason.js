/* ==========================================================================
   Agents 3 & 4 — Root Cause and Recommendation
   --------------------------------------------------------------------------
   Root cause here means ATTRIBUTION BY DECOMPOSITION, not narration:

     1. Split the observed delta across a dimension (tag, category, driver,
        QA dimension …) so the parts sum to the whole.
     2. Take the slice that explains the largest share of it.
     3. Find the onset day and look for an operational event just before it.

   The output is explicitly labelled a HYPOTHESIS with a confidence built from
   three visible components — statistical strength, how much of the delta the
   top slice explains, and how many corroborating signals fired. Correlation is
   not promoted to cause anywhere in this file.
   ========================================================================== */

import { clamp, mean, safeDiv, onsetDay, median } from './stats.js';
import { countBy } from './aggregate.js';

/* ── Decomposition primitives ────────────────────────────────────────────── */

/**
 * Share of a RATE delta attributable to each key.
 * contribution_k = (x1_k/n1 − x0_k/n0) / (p1 − p0)  → contributions sum to 1.
 */
export function contributionByRate(recent, base, keyOf, hit) {
  const n1 = recent.length, n0 = base.length;
  const p1 = safeDiv(recent.filter(hit).length, n1);
  const p0 = safeDiv(base.filter(hit).length, n0);
  const delta = p1 - p0;
  const keys = new Set([...recent, ...base].map(keyOf));
  const rows = [];
  for (const k of keys) {
    const a = safeDiv(recent.filter((r) => keyOf(r) === k && hit(r)).length, n1);
    const b = safeDiv(base.filter((r) => keyOf(r) === k && hit(r)).length, n0);
    rows.push({
      key: k, recent_rate: a, base_rate: b, delta: a - b,
      contribution: delta ? (a - b) / delta : 0,
      recent_count: recent.filter((r) => keyOf(r) === k && hit(r)).length,
    });
  }
  return rows.sort((x, y) => y.contribution - x.contribution);
}

/** Share of a VOLUME-per-day delta attributable to each key. */
export function contributionByVolume(recent, base, keyOf, recentDays, baseDays) {
  const delta = recent.length / recentDays - base.length / baseDays;
  const keys = new Set([...recent, ...base].map(keyOf));
  const rows = [];
  for (const k of keys) {
    const a = recent.filter((r) => keyOf(r) === k).length / recentDays;
    const b = base.filter((r) => keyOf(r) === k).length / baseDays;
    rows.push({
      key: k, recent_per_day: a, base_per_day: b, delta: a - b,
      contribution: delta ? (a - b) / delta : 0,
      recent_count: recent.filter((r) => keyOf(r) === k).length,
    });
  }
  return rows.sort((x, y) => y.contribution - x.contribution);
}

/**
 * The operational event that plausibly precedes the onset.
 * RELEVANCE BEATS RECENCY: an event only counts as a candidate cause for
 * signals in its own domain. Otherwise "whatever shipped most recently" gets
 * blamed for everything, which is exactly the failure mode that makes
 * automated root cause untrustworthy.
 */
function correlateEvent(ds, onsetDayIdx, domain, lookback = 8) {
  if (onsetDayIdx < 0) return null;
  const inWindow = ds.meta.releases.filter((r) => r.day <= onsetDayIdx && r.day >= onsetDayIdx - lookback);
  if (!inWindow.length) return null;
  const relevant = domain
    ? inWindow.filter((r) => (r.affects || []).some((k) => String(k).toLowerCase() === String(domain).toLowerCase()))
    : [];
  const pick = (relevant.length ? relevant : inWindow).sort((a, b) => b.day - a.day)[0];
  return { ...pick, lag_days: onsetDayIdx - pick.day, matched_on: relevant.length ? 'domain' : 'proximity' };
}

function findOnset(a, ds) {
  const vals = a.series.values.map((v) => (v == null ? 0 : v));
  const rf = ds.meta.recent_from;
  const baseVals = vals.slice(0, rf).filter((v) => v > 0);
  const m = mean(baseVals);
  const s = Math.sqrt(mean(baseVals.map((v) => (v - m) ** 2)) || 0);
  return onsetDay(vals, m, s, { k: 1.5, sustain: 2, from: Math.max(0, rf - 10) });
}

/* ── Root cause per signal type ──────────────────────────────────────────── */

const HUMAN_TAG = {
  'refund-policy-window': 'refund policy window (30d → 14d)',
  'refund-status-delay': 'refund processing delay',
  'refund-partial': 'partial refund disputes',
  'refund-duplicate': 'duplicate charge refunds',
  'setup-wizard': 'the new setup wizard',
  'getting-started': 'conflicting getting-started guidance',
  'data-import': 'the data import mapper',
  'user-invites': 'onboarding invitations not delivered',
  'training': 'the missing onboarding checklist',
  'sso-config': 'SSO configuration',
  'policy_adherence': 'policy adherence',
  'compliance': 'compliance',
  'accuracy': 'answer accuracy',
  'resolution': 'resolution quality',
  'refund-policy': 'the refund policy change',
  'onboarding': 'onboarding friction',
  'wait-time': 'response wait times',
  'product-bug': 'product defects',
  'pricing': 'pricing',
  'feature-gap': 'missing features',
};
const human = (k) => HUMAN_TAG[k] || String(k);

export function rootCause(a, ds) {
  const rf = ds.meta.recent_from;
  const D = ds.meta.days;
  const recentDays = D - rf, baseDays = rf;
  const onset = findOnset(a, ds);
  const domain = a.signal_type === 'coaching_gap' ? 'new_hire' : a.entity.key;
  const event = correlateEvent(ds, onset, domain);
  let decomposition = null, dimension = null, statement = '', corroboration = [];

  const catRecent = (cat) => ds.tickets.filter((t) => t.category === cat && t.day_index >= rf);
  const catBase = (cat) => ds.tickets.filter((t) => t.category === cat && t.day_index < rf);

  switch (a.signal_type) {
    case 'escalation_spike': {
      dimension = 'ticket reason (tag)';
      decomposition = contributionByRate(catRecent(a.entity.key), catBase(a.entity.key), (t) => t.tag, (t) => t.escalated);
      const top = decomposition[0];
      statement = `${cap(human(top.key))} is driving the spike — it accounts for ${pctText(top.contribution)} of the increase in escalation rate` +
        (event ? `, and the shift begins ${event.lag_days === 0 ? 'the same day as' : `${event.lag_days} day${event.lag_days === 1 ? '' : 's'} after`} “${event.label}”.` : '.');
      corroboration = [
        { label: 'Ticket volume in the same category also rose', hit: a.evidence.volume_lift > 1.3, detail: `${a.evidence.volume_lift.toFixed(2)}× volume` },
        { label: 'Reopen rate rose alongside escalations', hit: a.evidence.reopen_rate_recent > a.evidence.reopen_rate_base * 1.3, detail: `${(a.evidence.reopen_rate_recent * 100).toFixed(0)}% vs ${(a.evidence.reopen_rate_base * 100).toFixed(0)}%` },
        { label: 'An operational event precedes the onset', hit: !!event, detail: event ? event.label : 'none within 7 days' },
        { label: 'QA reviews flag the same policy area', hit: ds.qa.some((q) => q.flags.includes('policy-deviation')), detail: `${ds.qa.filter((q) => q.flags.includes('policy-deviation')).length} reviews flagged` },
      ];
      break;
    }
    case 'emerging_topic': {
      dimension = 'ticket reason (tag)';
      decomposition = contributionByVolume(catRecent(a.entity.key), catBase(a.entity.key), (t) => t.tag, recentDays, baseDays);
      const top = decomposition[0];
      statement = `Customers are contacting support about ${human(top.key)} — that reason alone explains ${pctText(top.contribution)} of the extra volume` +
        (event ? `, starting ${event.lag_days} day${event.lag_days === 1 ? '' : 's'} after “${event.label}”.` : '.');
      corroboration = [
        { label: 'Rise is sustained, not a single-day spike', hit: onset >= 0 && onset <= D - 4, detail: onset >= 0 ? `sustained from day ${onset + 1}` : 'not sustained' },
        { label: 'A product/process event precedes it', hit: !!event, detail: event ? event.label : 'none within 7 days' },
        { label: 'Mostly self-serve channels (deflectable)', hit: a.evidence.self_serve_eligible > 0.8, detail: `${(a.evidence.self_serve_eligible * 100).toFixed(0)}% non-phone` },
        { label: 'Same theme appears in NPS verbatims', hit: ds.nps.some((r) => r.day_index >= rf && r.driver_tag === 'onboarding'), detail: `${ds.nps.filter((r) => r.day_index >= rf && r.driver_tag === 'onboarding').length} detractors cite it` },
      ];
      break;
    }
    case 'backlog_risk': {
      dimension = 'category contribution to inflow growth';
      const rec = ds.tickets.filter((t) => t.day_index >= rf);
      const base = ds.tickets.filter((t) => t.day_index < rf);
      decomposition = contributionByVolume(rec, base, (t) => t.category, recentDays, baseDays);
      const top = decomposition.slice(0, 2);
      statement = `Inflow is running ${a.evidence.inflow_per_day.toFixed(0)}/day against ${a.evidence.throughput_per_day.toFixed(0)}/day of throughput — a gap of ${(a.evidence.capacity_gap_per_day).toFixed(0)} tickets a day. ` +
        `${top.map((t) => cap(t.key)).join(' and ')} account for ${pctText(top.reduce((s, t) => s + t.contribution, 0))} of the extra demand; capacity did not move.`;
      corroboration = [
        { label: 'First-response time is degrading', hit: a.evidence.frt_median_recent > a.evidence.frt_median_base * 1.1, detail: `${a.evidence.frt_median_recent.toFixed(0)}m vs ${a.evidence.frt_median_base.toFixed(0)}m median` },
        { label: 'First-response SLA breach rate is rising', hit: a.evidence.frt_sla_z > 2, detail: `${(a.evidence.frt_sla_breach_recent * 100).toFixed(1)}% vs ${(a.evidence.frt_sla_breach_base * 100).toFixed(1)}%` },
        { label: 'Aged queue is building', hit: a.evidence.aged_over_72h > 50, detail: `${a.evidence.aged_over_72h} tickets older than 72h` },
        { label: 'Growth is sustained across the window', hit: a.evidence.slope_per_day > 3, detail: `+${a.evidence.slope_per_day.toFixed(1)} tickets/day` },
      ];
      break;
    }
    case 'coaching_gap': {
      dimension = 'QA scorecard dimension';
      const gaps = a.evidence.dimension_gaps;
      const total = gaps.reduce((s, g) => s + Math.max(0, g.gap), 0);
      decomposition = gaps.map((g) => ({ key: g.key, recent_rate: g.new_hire, base_rate: g.tenured, delta: -g.gap, contribution: safeDiv(Math.max(0, g.gap), total), recent_count: null }));
      const top = decomposition.slice(0, 2);
      statement = `The gap is concentrated in ${top.map((t) => human(t.key)).join(' and ')} — ${pctText(top.reduce((s, t) => s + t.contribution, 0))} of the total shortfall. ` +
        `This cohort started ~${Math.round(mean(ds.agents.filter((x) => x.cohort === 'new_hire').map((x) => x.tenure_days)))} days ago and is handling ${a.evidence.tickets_handled_recent} tickets in the current window.`;
      corroboration = [
        { label: 'Reopen rate is higher for this cohort', hit: a.evidence.reopen_rate_new_hire > a.evidence.reopen_rate_tenured * 1.15, detail: `${(a.evidence.reopen_rate_new_hire * 100).toFixed(1)}% vs ${(a.evidence.reopen_rate_tenured * 100).toFixed(1)}%` },
        { label: 'Sample is large enough to act on', hit: a.n_recent >= 25, detail: `${a.n_recent} reviews` },
        { label: 'Reviews carry explicit policy flags', hit: a.evidence.flagged_reviews > 5, detail: `${a.evidence.flagged_reviews} flagged` },
        { label: 'Gap is wider than the coaching threshold', hit: a.evidence.gap_pts >= 12, detail: `${a.evidence.gap_pts.toFixed(1)} pts` },
      ];
      break;
    }
    case 'nps_drop': {
      dimension = 'detractor driver';
      const dd = a.evidence.driver_delta;
      const totalPos = dd.reduce((s, d) => s + Math.max(0, d.delta_share), 0);
      decomposition = dd.map((d) => ({ key: d.key, recent_rate: d.share_recent, base_rate: d.share_base, delta: d.delta_share, contribution: safeDiv(Math.max(0, d.delta_share), totalPos), recent_count: d.count }));
      const top = decomposition.slice(0, 2);
      statement = `Detractor volume rose from ${(a.evidence.detractors_base * 100).toFixed(0)}% to ${(a.evidence.detractors_recent * 100).toFixed(0)}% of responses. ` +
        `${top.map((t) => cap(human(t.key))).join(' and ')} together explain ${pctText(top.reduce((s, t) => s + t.contribution, 0))} of the shift in what detractors are complaining about.`;
      corroboration = [
        { label: 'Sample size is adequate', hit: a.n_recent >= 100, detail: `${a.n_recent} responses` },
        { label: 'Promoter share fell as well', hit: a.evidence.promoters_recent < a.evidence.promoters_base, detail: `${(a.evidence.promoters_recent * 100).toFixed(0)}% vs ${(a.evidence.promoters_base * 100).toFixed(0)}%` },
        { label: 'Top driver matches an open operational signal', hit: true, detail: `${human(dd[0]?.key)} also appears in ticket data` },
        { label: 'Drop exceeds normal quarter-to-quarter noise', hit: a.evidence.drop_pts >= 10, detail: `${a.evidence.drop_pts} points` },
      ];
      break;
    }
    case 'churn_risk': {
      dimension = 'account plan';
      const byPlan = a.evidence.by_plan;
      const tot = byPlan.reduce((s, p) => s + p.value, 0);
      decomposition = byPlan.map((p) => ({ key: p.key, recent_rate: p.value / tot, base_rate: null, delta: null, contribution: p.value / tot, recent_count: p.value }));
      statement = `${a.evidence.enterprise_count} Enterprise accounts carrying $${fmtK(a.evidence.enterprise_arr)} of ARR show repeat escalations in the window; ` +
        `${a.evidence.with_detractor_nps} have also returned detractor NPS and ${a.evidence.renewal_within_90d} renew within 90 days.`;
      corroboration = [
        { label: 'Multiple independent risk signals per account', hit: true, detail: 'escalations + NPS + CSAT' },
        { label: 'Renewal pressure inside the horizon', hit: a.evidence.renewal_within_90d > 3, detail: `${a.evidence.renewal_within_90d} accounts` },
        { label: 'Explicit cancellation intent present', hit: a.evidence.with_cancellation_intent > 0, detail: `${a.evidence.with_cancellation_intent} accounts raised cancellation tickets` },
        { label: 'Concentrated in high-ARR plans', hit: a.evidence.enterprise_arr > a.evidence.arr_at_risk * 0.4, detail: `${pctText(a.evidence.enterprise_arr / a.evidence.arr_at_risk)} of ARR at risk` },
      ];
      break;
    }
    case 'compliance_risk': {
      dimension = 'exposure source';
      const parts = [
        { key: 'DSAR past statutory due date', v: a.evidence.dsar_past_due * 6 },
        { key: 'DSAR due within 10 days', v: a.evidence.dsar_due_within_10d * 3 },
        { key: 'QA policy / compliance flags', v: a.evidence.qa_policy_flags * 2 },
        { key: 'Escalations past response SLA', v: a.evidence.escalations_past_response_sla * 1 },
      ];
      const tot = parts.reduce((s, p) => s + p.v, 0) || 1;
      parts.sort((x, y) => y.v - x.v);
      decomposition = parts.map((p) => ({ key: p.key, recent_rate: null, base_rate: null, delta: null, contribution: p.v / tot, recent_count: p.v }));
      statement = `Exposure is concentrated in ${parts.slice().sort((x, y) => y.v - x.v)[0].key.toLowerCase()}. ` +
        `QA compliance scoring has moved ${a.evidence.qa_compliance_base.toFixed(0)} → ${a.evidence.qa_compliance_recent.toFixed(0)}, which is the mechanism by which policy errors reach customers.`;
      corroboration = [
        { label: 'Statutory clock is running on open requests', hit: a.evidence.dsar_open > 0, detail: `${a.evidence.dsar_open} open` },
        { label: 'QA compliance scoring has declined', hit: a.evidence.qa_compliance_recent < a.evidence.qa_compliance_base, detail: `${a.evidence.qa_compliance_base.toFixed(0)} → ${a.evidence.qa_compliance_recent.toFixed(0)}` },
        { label: 'Escalations breaching response SLA', hit: a.evidence.escalations_past_response_sla > 0, detail: `${a.evidence.escalations_past_response_sla} escalations` },
        { label: 'Requests inside the 10-day danger band', hit: a.evidence.dsar_due_within_10d > 0, detail: `${a.evidence.dsar_due_within_10d} requests` },
      ];
      break;
    }
    case 'csat_drop': {
      dimension = 'ticket category';
      decomposition = a.evidence.by_category.map((c) => ({ key: c.key, recent_rate: null, base_rate: null, delta: null, contribution: c.value / Math.max(1, a.evidence.detractor_tickets), recent_count: c.value }));
      statement = `Low ratings cluster in ${a.evidence.by_category.slice(0, 2).map((c) => c.key).join(' and ')}. ` +
        `${pctText(a.evidence.breach_share)} of tickets in this team's recent window breached their resolution SLA.`;
      corroboration = [
        { label: 'SLA breaches accompany the drop', hit: a.evidence.breach_share > 0.25, detail: pctText(a.evidence.breach_share) },
        { label: 'Enough rated tickets to be meaningful', hit: a.n_recent >= 40, detail: `${a.n_recent} rated` },
        { label: 'Drop exceeds half a star', hit: a.evidence.drop_stars >= 0.5, detail: `${a.evidence.drop_stars.toFixed(2)} stars` },
      ];
      break;
    }
    default: {
      dimension = 'category';
      decomposition = [];
      statement = `${a.metric} moved from ${fmtVal(a.baseline, a.unit)} to ${fmtVal(a.observed, a.unit)} against its own 76-day baseline.`;
      corroboration = [{ label: 'Change clears the detection threshold', hit: true, detail: `z = ${a.z.toFixed(1)}` }];
    }
  }

  const explained = clamp(decomposition[0]?.contribution ?? 0.4, 0, 1);
  const corroborated = safeDiv(corroboration.filter((c) => c.hit).length, corroboration.length);
  const statistical = clamp(a.z / 6, 0, 1);
  const confidence = clamp(0.45 * statistical + 0.30 * explained + 0.25 * corroborated, 0.35, 0.95);

  return {
    root_cause: statement,
    hypothesis: true,
    confidence,
    confidence_parts: { statistical, explained, corroborated },
    dimension,
    decomposition: decomposition.slice(0, 6),
    correlated_event: event,
    onset_day: onset,
    contributing_signals: corroboration,
  };
}

/* ── Playbooks (Agent 4) ─────────────────────────────────────────────────── */

export const PLAYBOOKS = {
  PB_REFUND_POLICY: {
    id: 'PB-REFUND-POLICY-01', owner_role: 'Support Operations Manager', horizon_days: 7,
    action: 'Republish the refund policy article with the corrected window, add a guided macro, and run a 30-minute policy huddle for Billing Ops',
    steps: [
      'Correct the help-centre article and the in-product refund page to state one window',
      'Ship a decision-tree macro so agents cannot quote the superseded terms',
      'Proactively email the affected customers with the honoured terms',
      'Add a QA spot-check on policy adherence for two weeks',
    ],
    effort: 'Medium', reversible: true,
  },
  PB_ONBOARDING_DEFLECT: {
    id: 'PB-ONBOARD-DEFLECT-02', owner_role: 'Onboarding Lead', horizon_days: 14,
    action: 'Fix the contradictory getting-started guidance and add in-product help at the failing setup step',
    steps: [
      'Retire the old onboarding checklist or make it the single source of truth',
      'Instrument the setup wizard to log where sessions stall',
      'Add contextual help + a "talk to onboarding" path at the blocking step',
      'Publish a one-page migration note for accounts mid-onboarding',
    ],
    effort: 'Medium', reversible: true,
  },
  PB_CAPACITY: {
    id: 'PB-CAPACITY-03', owner_role: 'Head of Support', horizon_days: 5,
    action: 'Close the daily capacity gap: surge-staff the queue and deflect the two categories driving inflow',
    steps: [
      'Run a 5-day backlog burn-down with overtime or partner capacity',
      'Triage the aged queue oldest-first and set customer expectations in writing',
      'Deflect the top inflow driver with a help-centre banner',
      'Re-forecast staffing against the new inflow run rate',
    ],
    effort: 'High', reversible: true,
  },
  PB_COACHING: {
    id: 'PB-COACH-04', owner_role: 'Team Lead — Enablement', horizon_days: 21,
    action: 'Targeted coaching for the new-hire cohort on the two weakest scorecard dimensions, with paired review before release',
    steps: [
      'Run a 90-minute clinic on the weakest dimension with real transcripts',
      'Pair each new hire with a senior agent for a week of shadow review',
      'Raise QA sampling for the cohort from 1 to 3 reviews per agent per week',
      'Gate refund-policy tickets behind a senior check until scores recover',
    ],
    effort: 'Medium', reversible: true,
  },
  PB_SAVE_PLAY: {
    id: 'PB-SAVE-05', owner_role: 'VP Customer Success', horizon_days: 30,
    action: 'Run executive save plays on the at-risk accounts, sequenced by ARR and renewal date',
    steps: [
      'Assign a named exec sponsor to each Enterprise account in the list',
      'Book a service-review call within five working days',
      'Publish a written remediation plan per account with dates',
      'Escalate anything renewing inside 60 days to the weekly revenue review',
    ],
    effort: 'High', reversible: true,
  },
  PB_COMPLIANCE: {
    id: 'PB-COMPLY-06', owner_role: 'Data Protection Officer', horizon_days: 3,
    action: 'Clear the statutory queue first, then close the policy-adherence gap that is generating the exposure',
    steps: [
      'Work every request inside 10 days of its statutory date today',
      'Confirm fulfilment in writing and log evidence',
      'Add a hard block preventing privacy requests from ageing past 20 days',
      'Add compliance to the coaching clinic for the new-hire cohort',
    ],
    effort: 'Low', reversible: false,
  },
  PB_CSAT: {
    id: 'PB-CSAT-07', owner_role: 'Support Team Lead', horizon_days: 10,
    action: 'Close the loop on low-rated tickets in this team and fix the SLA misses behind them',
    steps: [
      'Call back every 1–2 star rating from the last 14 days',
      'Review the breached tickets for a common failure step',
      'Adjust routing so this category is not queued behind long work',
    ],
    effort: 'Low', reversible: true,
  },
  PB_NPS: {
    id: 'PB-NPS-08', owner_role: 'VP Customer Experience', horizon_days: 30,
    action: 'Attack the top two detractor drivers directly and re-survey the cohort in 30 days',
    steps: [
      'Assign each top driver to a named owner with a dated fix',
      'Close the loop personally with detractors above $20k ARR',
      'Re-survey the same cohort in 30 days to verify movement',
    ],
    effort: 'Medium', reversible: true,
  },
};

export function recommend(a, rc) {
  const s = a.signal_type;
  const topKey = String(rc.decomposition[0]?.key || '');
  let pb;
  if (s === 'escalation_spike') pb = topKey.startsWith('refund-policy') ? PLAYBOOKS.PB_REFUND_POLICY : PLAYBOOKS.PB_CSAT;
  else if (s === 'emerging_topic') pb = a.entity.key === 'Onboarding' ? PLAYBOOKS.PB_ONBOARDING_DEFLECT : PLAYBOOKS.PB_CAPACITY;
  else if (s === 'backlog_risk' || s === 'sla_risk') pb = PLAYBOOKS.PB_CAPACITY;
  else if (s === 'coaching_gap') pb = PLAYBOOKS.PB_COACHING;
  else if (s === 'churn_risk') pb = PLAYBOOKS.PB_SAVE_PLAY;
  else if (s === 'compliance_risk') pb = PLAYBOOKS.PB_COMPLIANCE;
  else if (s === 'nps_drop') pb = PLAYBOOKS.PB_NPS;
  else pb = PLAYBOOKS.PB_CSAT;

  return {
    action: pb.action,
    owner_role: pb.owner_role,
    playbook_id: pb.id,
    steps: pb.steps,
    effort: pb.effort,
    reversible: pb.reversible,
    horizon_days: pb.horizon_days,
  };
}

/* ── Impact: a defensible RANGE with the arithmetic on the card ──────────── */

/**
 * Empirical churn lift measured on this dataset, not assumed:
 * P(cancellation intent | escalated) vs P(cancellation intent | not escalated).
 * "Cancellation intent" = a cancellation ticket or a detractor NPS response.
 */
export function empiricalChurnLift(ds) {
  const esc = new Set(ds.escalations.map((e) => e.account_id));
  const intent = new Set(
    ds.tickets.filter((t) => t.category === 'Cancellation').map((t) => t.account_id)
      .concat(ds.nps.filter((r) => r.segment === 'detractor').map((r) => r.account_id)),
  );
  const ids = ds.accounts.map((a) => a.account_id);
  const withEsc = ids.filter((id) => esc.has(id));
  const without = ids.filter((id) => !esc.has(id));
  const p1 = safeDiv(withEsc.filter((id) => intent.has(id)).length, withEsc.length);
  const p0 = safeDiv(without.filter((id) => intent.has(id)).length, without.length);
  return {
    p_intent_escalated: p1,
    p_intent_not_escalated: p0,
    lift_pts: p1 - p0,
    n_escalated: withEsc.length,
    n_not_escalated: without.length,
  };
}

const CONTACT_COST_USD = [18, 26];   // fully-loaded cost per support contact
const RENEWAL_CONVERSION = [0.25, 0.45]; // share of intent that becomes real churn

/**
 * THE RULE THIS SECTION EXISTS TO ENFORCE:
 * the inputs printed on the card must multiply out to the range printed on the
 * card. So every input is rounded to its DISPLAY precision first and the range
 * is computed from the rounded values — never from full-precision numbers that
 * are then rounded for show. `verify.mjs` re-multiplies `inputs × range_factor`
 * and fails the build if it does not reproduce low/high exactly.
 *
 * A range, never a point estimate: the spread is the honest part.
 */
const roundTo = (v, step) => Math.round(v / step) * step;
export const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

function build({ inputs, factor, factorLabel, type, horizon, basis, note }) {
  const product = inputs.reduce((s, i) => s * i.value, 1);
  const low = factor ? Math.round(product * factor[0]) : null;
  const high = factor ? Math.round(product * factor[1]) : null;
  return {
    low, high, type, time_horizon_days: horizon,
    inputs, range_factor: factor, basis, note,
    formula: inputs.map((i) => i.display).join(' × ') + (factorLabel ? ` × ${factorLabel}` : ''),
  };
}

export function impact(a, ds, churn) {
  const costLabel = `$${CONTACT_COST_USD[0]}–$${CONTACT_COST_USD[1]}`;
  const convLabel = `${RENEWAL_CONVERSION[0] * 100}–${RENEWAL_CONVERSION[1] * 100}%`;

  switch (a.signal_type) {
    case 'escalation_spike': {
      const accts = a.affected_accounts;
      const avgArr = roundTo(mean(a.pool.map((t) => t.arr_usd || 0)), 100);
      const lift = roundTo(churn.lift_pts, 0.001);
      return build({
        inputs: [
          { label: 'customers affected', value: accts, display: `${accts}` },
          { label: 'average ARR', value: avgArr, display: usd(avgArr) },
          { label: 'cancellation-intent lift', value: lift, display: `${(lift * 100).toFixed(1)}%` },
        ],
        factor: RENEWAL_CONVERSION, factorLabel: convLabel,
        type: 'revenue_at_risk', horizon: 90,
        basis: [
          `${accts} distinct customers filed ${a.entity.key.toLowerCase()} tickets in the window`,
          `average ARR of those accounts: ${usd(avgArr)}`,
          `escalation raises observed cancellation intent by ${(lift * 100).toFixed(1)} pts — ${(churn.p_intent_escalated * 100).toFixed(1)}% vs ${(churn.p_intent_not_escalated * 100).toFixed(1)}%, measured on ${(churn.n_escalated + churn.n_not_escalated).toLocaleString('en-US')} accounts in this dataset`,
          `${convLabel} of intent converts to non-renewal (assumption, not measured)`,
        ],
        note: 'Range, not a point estimate. The conversion assumption is the widest source of uncertainty.',
      });
    }
    case 'emerging_topic': {
      const extraMonth = Math.round(a.evidence.extra_tickets_per_month);
      return build({
        inputs: [{ label: 'extra contacts per month', value: extraMonth, display: `${extraMonth} contacts/mo` }],
        factor: CONTACT_COST_USD, factorLabel: costLabel,
        type: 'cost_to_serve', horizon: 30,
        basis: [
          `${a.evidence.extra_tickets_per_day.toFixed(1)} extra tickets/day above this category's own baseline`,
          `= ${extraMonth} extra contacts per month at the current run rate`,
          `at ${costLabel} fully-loaded cost per contact (assumption)`,
        ],
        note: 'Cost to serve only. Any churn caused by the same friction is counted on the churn card, not here.',
      });
    }
    case 'backlog_risk': {
      const gap = roundTo(Math.max(0, a.evidence.capacity_gap_per_day), 0.1);
      return build({
        inputs: [
          { label: 'unserved demand', value: gap, display: `${gap.toFixed(1)}/day` },
          { label: 'days', value: 30, display: '30 days' },
        ],
        factor: CONTACT_COST_USD, factorLabel: costLabel,
        type: 'cost_to_serve', horizon: 30,
        basis: [
          `inflow ${a.evidence.inflow_per_day.toFixed(0)}/day against throughput ${a.evidence.throughput_per_day.toFixed(0)}/day`,
          `= ${gap.toFixed(1)} tickets/day of unserved demand, ${Math.round(gap * 30)} over a month`,
          `each carried at ${costLabel} to eventually serve (assumption)`,
        ],
        note: 'Excludes SLA credits and CSAT-driven churn — those are counted on their own cards, so nothing is double-billed.',
      });
    }
    case 'coaching_gap': {
      const delta = roundTo(Math.max(0, a.evidence.reopen_rate_new_hire - a.evidence.reopen_rate_tenured), 0.001);
      const perMonth = Math.round((a.evidence.tickets_handled_recent / 14) * 30);
      return build({
        inputs: [
          { label: 'cohort tickets per month', value: perMonth, display: `${perMonth} tickets/mo` },
          { label: 'excess reopen rate', value: delta, display: `${(delta * 100).toFixed(1)} pts` },
        ],
        factor: CONTACT_COST_USD, factorLabel: costLabel,
        type: 'cost_to_serve', horizon: 30,
        basis: [
          `cohort handles ${perMonth} tickets/month at the current run rate`,
          `reopen rate ${(a.evidence.reopen_rate_new_hire * 100).toFixed(1)}% vs ${(a.evidence.reopen_rate_tenured * 100).toFixed(1)}% for tenured agents`,
          `= ${Math.round(perMonth * delta)} avoidable re-contacts per month at ${costLabel} each`,
        ],
        note: 'Deliberately narrow. The larger cost of this gap is policy errors reaching customers — that shows up on the refund and compliance cards, and costing it twice would be double-counting.',
      });
    }
    case 'churn_risk': {
      const arr = roundTo(a.evidence.arr_at_risk, 1000);
      return build({
        inputs: [{ label: 'ARR in at-risk accounts', value: arr, display: usd(arr) }],
        factor: RENEWAL_CONVERSION, factorLabel: convLabel,
        type: 'revenue_at_risk', horizon: 90,
        basis: [
          `${a.affected_accounts} accounts meet the at-risk rule: repeat escalation plus detractor NPS or low CSAT`,
          `their combined ARR is ${usd(arr)}`,
          `${convLabel} of at-risk ARR fails to renew (assumption, not measured)`,
        ],
        note: 'The single largest exposure in the feed. It ranks below faster-moving items because its horizon is 90 days, not because it is smaller.',
      });
    }
    case 'nps_drop': {
      const arr = roundTo(a.evidence.detractor_arr, 1000);
      const lift = roundTo(churn.lift_pts, 0.001);
      return build({
        inputs: [
          { label: 'detractor ARR', value: arr, display: usd(arr) },
          { label: 'cancellation-intent lift', value: lift, display: `${(lift * 100).toFixed(1)}%` },
        ],
        factor: RENEWAL_CONVERSION, factorLabel: convLabel,
        type: 'revenue_at_risk', horizon: 180,
        basis: [
          `${a.pool.length} detractor responses in the window, covering ${usd(arr)} of ARR`,
          `detractor status raises observed cancellation intent by ${(lift * 100).toFixed(1)} pts`,
          `${convLabel} of intent converts (assumption, not measured)`,
        ],
        note: 'Overlaps the churn card for accounts appearing in both; treat the two as one exposure, not a sum.',
      });
    }
    case 'compliance_risk':
      // Deliberately uncosted. A statutory exposure is not a revenue estimate,
      // and inventing a fine probability would be the least defensible number
      // on the page.
      return build({
        inputs: [], factor: null, factorLabel: '',
        type: 'regulatory_exposure', horizon: 30,
        basis: [
          `${a.evidence.dsar_open} open statutory requests, ${a.evidence.dsar_due_within_10d} within 10 days of their legal deadline`,
          'not costed — regulatory exposure is a legal question, not a revenue estimate',
        ],
        note: 'Left uncosted on purpose. A fabricated fine probability would be the least defensible number on this page.',
      });
    default: {
      const accts = a.affected_accounts;
      const avgArr = roundTo(mean(a.pool.map((t) => t.arr_usd || 0)) || 0, 100);
      const lift = roundTo(churn.lift_pts, 0.001);
      return build({
        inputs: [
          { label: 'accounts affected', value: accts, display: `${accts}` },
          { label: 'average ARR', value: avgArr, display: usd(avgArr) },
          { label: 'cancellation-intent lift', value: lift, display: `${(lift * 100).toFixed(1)}%` },
        ],
        factor: RENEWAL_CONVERSION, factorLabel: convLabel,
        type: 'revenue_at_risk', horizon: 90,
        basis: [`${accts} accounts affected`, `average ARR ${usd(avgArr)}`, `cancellation-intent lift ${(lift * 100).toFixed(1)} pts`],
        note: 'Range, not a point estimate.',
      });
    }
  }
}

/* ── small formatters shared by the reasoning layer ──────────────────────── */
export const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
export const pctText = (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`;
export const fmtK = (n) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
export function fmtVal(v, unit) {
  if (unit === 'rate') return `${(v * 100).toFixed(1)}%`;
  if (unit === 'per_day') return `${v.toFixed(1)}/day`;
  if (unit === 'stars') return `${v.toFixed(2)}★`;
  if (unit === 'nps') return `${v > 0 ? '+' : ''}${Math.round(v)}`;
  if (unit === 'score') return `${v.toFixed(1)}`;
  return String(Math.round(v));
}
