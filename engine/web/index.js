/* ==========================================================================
   The Decision Engine — orchestrator
   --------------------------------------------------------------------------
        Ingestion → Anomaly Detection (statistical)
             └─ per anomaly → Root Cause → Recommendation → Impact
                                   └→ Executive Summary → ExecutiveBrief

   Detection decides WHAT is true. The reasoning agents only explain it and
   attach a playbook. The Executive Summary agent ranks, rolls up, and writes
   the briefing — over insight objects, never over raw data.
   ========================================================================== */

import { detect } from './detect.js';
import { rootCause, recommend, impact, empiricalChurnLift, fmtVal, fmtK, cap } from './reason.js';
import { healthWithDelta } from './health.js';
import { createInsight, validateInsight, STATUS, CONFIDENCE_CUTOFF } from './schema.js';
import { clamp, mean } from './stats.js';
import { dayLabel } from './aggregate.js';

/* ── Titles: short enough to scan a feed, specific enough to act on ─────── */
function titleFor(a) {
  switch (a.signal_type) {
    case 'escalation_spike': return `${a.entity.label} escalation spike`;
    case 'emerging_topic':   return `${a.entity.label} contact surge`;
    case 'backlog_risk':     return 'Ticket backlog is outgrowing capacity';
    case 'coaching_gap':     return 'New-hire cohort QA decline';
    case 'nps_drop':         return 'NPS decline';
    case 'churn_risk':       return `Churn risk — ${a.affected_accounts} accounts`;
    case 'compliance_risk':  return 'Compliance exposure building';
    case 'csat_drop':        return `CSAT drop — ${a.entity.label}`;
    case 'sla_risk':         return `SLA breach risk — ${a.entity.label}`;
    default:                 return a.metric;
  }
}

function whatHappened(a, ds) {
  const w = `last ${ds.meta.days - ds.meta.recent_from} days`;
  switch (a.signal_type) {
    case 'escalation_spike':
      return `${a.entity.label} escalations moved from ${fmtVal(a.baseline, 'rate')} to ${fmtVal(a.observed, 'rate')} of that category's tickets over the ${w} — ${a.x_recent} escalations where the baseline predicts ${a.evidence.escalations_expected}. ${a.affected_accounts} distinct customers are involved.`;
    case 'emerging_topic':
      return `${a.entity.label} contacts are running at ${a.observed.toFixed(1)}/day against a ${a.baseline.toFixed(1)}/day baseline (${a.lift.toFixed(2)}×), an extra ${Math.round(a.evidence.extra_tickets_per_month)} contacts a month.`;
    case 'backlog_risk':
      return `Open backlog has grown from ${Math.round(a.baseline)} to ${Math.round(a.observed)} tickets in the ${w}, +${a.evidence.slope_per_day.toFixed(1)}/day. ${a.evidence.aged_over_72h} tickets are older than 72 hours and median first response has slipped ${a.evidence.frt_median_base.toFixed(0)}→${a.evidence.frt_median_recent.toFixed(0)} minutes.`;
    case 'coaching_gap':
      return `The new-hire cohort is scoring ${a.observed.toFixed(1)} on QA against ${a.baseline.toFixed(1)} for tenured agents — a ${a.evidence.gap_pts.toFixed(1)} point gap across ${a.n_recent} reviews of ${a.evidence.agents_in_cohort} agents.`;
    case 'nps_drop':
      return `NPS has fallen from ${fmtVal(a.baseline, 'nps')} to ${fmtVal(a.observed, 'nps')} — ${a.evidence.drop_pts} points — across ${a.n_recent} responses in the ${w}.`;
    case 'churn_risk':
      return `${a.affected_accounts} accounts holding $${fmtK(a.evidence.arr_at_risk)} of ARR now show repeat escalations combined with detractor NPS or low CSAT. ${a.evidence.renewal_within_90d} of them renew within 90 days.`;
    case 'compliance_risk':
      return `${a.evidence.dsar_open} statutory data requests are open, ${a.evidence.dsar_due_within_10d} of them within 10 days of their legal deadline, alongside ${a.evidence.qa_policy_flags} QA policy-deviation flags.`;
    case 'csat_drop':
      return `${a.entity.label} CSAT has fallen ${a.baseline.toFixed(2)}★ → ${a.observed.toFixed(2)}★ across ${a.n_recent} rated tickets.`;
    case 'sla_risk':
      return `${a.entity.label} resolution-SLA breaches have risen from ${fmtVal(a.baseline, 'rate')} to ${fmtVal(a.observed, 'rate')} of tickets resolved in the ${w}.`;
    default:
      return `${a.metric} moved from ${fmtVal(a.baseline, a.unit)} to ${fmtVal(a.observed, a.unit)}.`;
  }
}

/** Severity: money, reach, statistical strength, and how fast it is moving. */
function severityOf(a, imp) {
  const money = imp.high != null
    ? clamp(Math.log10(1 + imp.high) / Math.log10(1 + 500000), 0, 1)
    : clamp((a.evidence.dsar_open ?? 0) / 25 + (a.evidence.dsar_due_within_10d ?? 0) / 10, 0, 1);
  const reach = clamp(a.affected_accounts / 400, 0, 1);
  const stat = clamp(a.z / 6, 0, 1);
  const trend = clamp((a.lift || 1) - 1, 0, 1);
  return {
    score: Math.round(100 * (0.33 * money + 0.27 * reach + 0.22 * stat + 0.18 * trend)),
    parts: { money, reach, stat, trend },
  };
}

const shortHash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
};

/** Headline metric shown on the card face. */
function metricLabel(a, imp) {
  switch (a.signal_type) {
    case 'escalation_spike': return `${(a.observed * 100).toFixed(0)}% escalation rate · ${a.lift.toFixed(1)}× baseline`;
    case 'emerging_topic':   return `+${Math.round((a.lift - 1) * 100)}% volume · ${Math.round(a.evidence.extra_tickets_per_month)} extra/mo`;
    case 'backlog_risk':     return `${Math.round(a.observed)} open · +${a.evidence.slope_per_day.toFixed(1)}/day`;
    case 'coaching_gap':     return `QA ${a.baseline.toFixed(0)} → ${a.observed.toFixed(0)} (−${a.evidence.gap_pts.toFixed(0)} pts)`;
    case 'nps_drop':         return `NPS ${fmtVal(a.baseline, 'nps')} → ${fmtVal(a.observed, 'nps')}`;
    case 'churn_risk':       return `$${fmtK(a.evidence.arr_at_risk)} ARR exposed`;
    case 'compliance_risk':  return `${a.evidence.dsar_due_within_10d} requests inside 10 days`;
    case 'csat_drop':        return `CSAT ${a.baseline.toFixed(2)} → ${a.observed.toFixed(2)}★`;
    case 'sla_risk':         return `${(a.observed * 100).toFixed(0)}% breached · ${a.lift.toFixed(1)}×`;
    default:                 return fmtVal(a.observed, a.unit);
  }
}

/* ── Executive Summary agent ─────────────────────────────────────────────── */
/**
 * The exec top-3 is DIVERSITY-AWARE. Ranked purely by priority, the refund
 * story would take two of the three slots (its escalation spike and its volume
 * surge are separate anomalies with the same cause). A director opening the app
 * at 9am needs three different problems, not the same one told twice — so the
 * strongest card per entity wins its slot and the rest stay in the full feed.
 */
function topDistinct(insights, n = 3) {
  const seen = new Set(), out = [];
  for (const i of insights) {
    const k = `${i._meta.entity.kind}:${i._meta.entity.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
    if (out.length === n) break;
  }
  return out;
}

function buildBrief(insights, health, ds, opts) {
  const top3 = topDistinct(insights, 3);
  const totalRisk = insights.reduce((s, i) => s + (i.expected_impact.revenue_at_risk_usd || 0), 0);

  const worst = health.dimensions.slice().sort((a, b) => a.score - b.score)[0];
  const moved = health.dimensions.slice().sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0];
  const deltaExplanation = health.delta === 0
    ? `Health is flat at ${health.score}. ${worst.label} remains the weakest dimension at ${worst.score}.`
    : `Health moved ${health.delta > 0 ? '+' : ''}${health.delta} to ${health.score}, driven mostly by ${moved.label} (${moved.delta > 0 ? '+' : ''}${moved.delta}). Weakest dimension: ${worst.label} at ${worst.score}/100.`;

  /* Opportunities are the mirror image of risk: places where a fix is cheap,
     reversible, and the evidence is strong enough to act on today. */
  const opportunities = insights
    .filter((i) => i._meta.effort !== 'High' && i.why.confidence >= 0.7)
    .slice(0, 3)
    .map((i) => ({
      insight_id: i.insight_id,
      title: `Recover ${i._meta.impact.high != null ? '$' + fmtK(i._meta.impact.high) : 'exposure'} — ${i._meta.title.toLowerCase()}`,
      action: i.recommended_action.action,
      owner_role: i.recommended_action.owner_role,
      effort: i._meta.effort,
      horizon_days: i._meta.horizon_days,
      value_low: i._meta.impact.low,
      value_high: i._meta.impact.high,
    }));

  /* The top-3 is ranked by severity × confidence × URGENCY, so a large but
     slow-moving exposure can legitimately sit outside it. Say so explicitly:
     a reader who spots a bigger number further down the feed should find it
     already acknowledged here, not feel it was buried. */
  const biggest = insights
    .filter((i) => i.expected_impact.range_high_usd != null)
    .sort((a, b) => b.expected_impact.range_high_usd - a.expected_impact.range_high_usd)[0];
  const biggestLine = biggest && !top3.includes(biggest)
    ? `The largest single exposure in the feed is ${biggest._meta.title.toLowerCase()} at $${fmtK(biggest.expected_impact.range_low_usd)}–$${fmtK(biggest.expected_impact.range_high_usd)}. It sits outside today's top three because its horizon is ${biggest.expected_impact.time_horizon_days} days, not because it is smaller — ${biggest.recommended_action.owner_role} owns it this quarter.`
    : '';

  const narrativeLines = [
    `${health.score}/100 operations health, ${health.delta >= 0 ? 'up' : 'down'} ${Math.abs(health.delta)} on the prior ${ds.meta.days - ds.meta.recent_from} days.`,
    top3.length
      ? `The single thing to act on today is ${top3[0]._meta.title.toLowerCase()}: ${top3[0].what_happened}`
      : 'No anomaly cleared the detection thresholds in this window.',
    top3.length > 1 ? `Behind it: ${top3.slice(1).map((i) => i._meta.title.toLowerCase()).join(', and ')}.` : '',
    biggestLine,
    totalRisk > 0 ? `Total quantified exposure across the open feed is $${fmtK(totalRisk)} at the midpoint of each estimate.` : '',
    `${insights.filter((i) => i.status === STATUS.HELD_FOR_REVIEW).length} insight(s) are held below the ${Math.round(CONFIDENCE_CUTOFF * 100)}% confidence cutoff and need a human before they are actioned.`,
  ].filter(Boolean);

  return {
    brief_id: 'brief_' + new Date(opts.asOf).toISOString().slice(0, 10).replace(/-/g, ''),
    generated_at: new Date(opts.asOf).toISOString(),
    period: `${dayLabel(ds, ds.meta.recent_from)} – ${dayLabel(ds, ds.meta.days - 1)} · ${ds.meta.days - ds.meta.recent_from}-day window`,
    insights,
    health,
    opportunities,
    top_3: top3,
    rollup: {
      total_revenue_at_risk: Math.round(totalRisk),
      top_3_ids: top3.map((i) => i.insight_id),
      org_health_delta_explanation: deltaExplanation,
    },
    narrative: narrativeLines.join(' '),
    narrative_lines: narrativeLines,
  };
}

/* ── Public entry point ──────────────────────────────────────────────────── */

/* ── Naming the accounts a finding is about ───────────────────────────────
   Ranked by ARR and then by proximity to renewal, because that is the order in
   which a CSM should work them: the biggest number that is closest to being
   decided. Capped at five — the contract carries the list a human will act on
   this week, not the full cohort, which stays available on `_meta.affected_ids`
   for anything that needs to re-derive the whole set.

   `owner` is the account's own CSM, which is a real person's name once a CRM
   export has been joined and the generator's placeholder before that. It is
   deliberately separate from `recommended_action.owner_role`: the role says who
   should run the play, the owner says whose account it is, and on a book with a
   named owner per account those are frequently not the same person. */
const NAMED_ACCOUNT_LIMIT = 5;

function namedAccountsFor(a, ds) {
  const ids = a.affected_ids;
  if (!Array.isArray(ids) || !ids.length) return [];
  const byId = new Map(ds.accounts.map((x) => [x.account_id, x]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((x, y) => (y.arr_usd - x.arr_usd) || ((x.renewal_in_days ?? 9e9) - (y.renewal_in_days ?? 9e9)))
    .slice(0, NAMED_ACCOUNT_LIMIT)
    .map((x) => ({
      account_id: x.account_id,
      company: x.company,
      arr_usd: x.arr_usd ?? null,
      renewal_in_days: x.renewal_in_days ?? null,
      owner: x.csm || null,
    }));
}

export function runEngine(ds, { asOf = ds.meta.as_of } = {}) {
  const t = {};
  const mark = (k, fn) => { const s = Date.now(); const r = fn(); t[k] = Date.now() - s; return r; };

  const { anomalies, detectors_run, thresholds, sources } = mark('detection', () => detect(ds));
  const churn = mark('impact_model', () => empiricalChurnLift(ds));

  /* ── Coverage ceiling ───────────────────────────────────────────────────
     Confidence is built inside `rootCause` from the three declared weights
     (45% statistical / 30% explained / 25% corroborated) and those weights are
     not touched here. What this adds is a CEILING on the result when the book
     is missing sources.

     The reason is that the three terms are all computed from data that IS
     present, so they cannot see what is absent. A book with no usage and no
     NPS can still produce a 0.95 escalation finding — internally consistent,
     and overconfident, because two of the signals that would corroborate or
     contradict it were never read. Before this, dropping an entire stream
     moved peak confidence by nothing at all: it stayed at 0.95.

     The ceiling only ever LOWERS a score. Nothing here can lift a finding over
     the 60% floor that holds it for review, which is the one direction the
     confidence rule must never move. */
  const coverageCeiling = clamp(0.60 + 0.35 * sources.coverage, 0.60, 0.95);

  const insights = mark('reasoning', () => anomalies.map((a) => {
    const rcRaw = rootCause(a, ds);
    /* Capped, with the uncapped figure kept alongside it. A number that moved
       has to show why it moved, so the card can say "78%, capped from 91% —
       two of five sources are not connected" rather than quietly presenting a
       lower score as though it were the arithmetic's own answer. */
    const capped = Math.min(rcRaw.confidence, coverageCeiling);
    const rc = capped < rcRaw.confidence
      ? { ...rcRaw, confidence: capped, confidence_uncapped: rcRaw.confidence, confidence_capped_by: 'source_coverage' }
      : rcRaw;
    const rec = recommend(a, rc);
    const imp = impact(a, ds, churn);
    const sev = severityOf(a, imp);
    const mid = imp.low != null && imp.high != null ? Math.round((imp.low + imp.high) / 2) : null;
    const urgency = clamp(1.25 - rec.horizon_days / 120, 0.4, 1.25);

    return createInsight({
      insight_id: 'ins_' + shortHash(a.key),
      signal_type: a.signal_type,
      severity_score: sev.score,
      what_happened: whatHappened(a, ds),
      affected_accounts: a.affected_accounts ?? null,
      named_accounts: namedAccountsFor(a, ds),
      why: { root_cause: rc.root_cause, contributing_signals: rc.contributing_signals, confidence: rc.confidence },
      recommended_action: rec,
      expected_impact: {
        revenue_at_risk_usd: mid,
        range_low_usd: imp.low,
        range_high_usd: imp.high,
        type: imp.type,
        time_horizon_days: imp.time_horizon_days,
      },
      status: rc.confidence < CONFIDENCE_CUTOFF ? STATUS.HELD_FOR_REVIEW : STATUS.UNASSIGNED,
      generated_at: new Date(asOf).toISOString(),
      _meta: {
        key: a.key,
        title: titleFor(a),
        metric_label: metricLabel(a, imp),
        entity: a.entity,
        unit: a.unit,
        observed: a.observed,
        baseline: a.baseline,
        lift: a.lift,
        z: a.z,
        p: a.p,
        n_recent: a.n_recent,
        n_base: a.n_base,
        affected_accounts: a.affected_accounts,
        affected_ids: a.affected_ids,
        series: a.series,
        evidence: a.evidence,
        severity_parts: sev.parts,
        priority: sev.score * rc.confidence * urgency,
        urgency,
        effort: rec.effort,
        horizon_days: rec.horizon_days,
        steps: rec.steps,
        impact: imp,
        confidence_parts: rc.confidence_parts,
        confidence_uncapped: rc.confidence_uncapped ?? null,
        confidence_capped_by: rc.confidence_capped_by ?? null,
        decomposition: rc.decomposition,
        decomposition_dimension: rc.dimension,
        correlated_event: rc.correlated_event,
        onset_day: rc.onset_day,
        provenance: {
          what_happened: 'anomaly_detection',
          why: 'root_cause',
          recommended_action: 'recommendation',
          expected_impact: 'impact_model (empirical lift + stated assumptions)',
          severity_score: 'executive_summary',
        },
      },
    });
  }));

  insights.sort((x, y) => y._meta.priority - x._meta.priority);

  const health = mark('health', () => healthWithDelta(ds));
  const brief = mark('exec_summary', () => buildBrief(insights, health, ds, { asOf }));

  const errors = [];
  insights.forEach((ins, i) => { const r = validateInsight(ins, i); if (!r.ok) errors.push(...r.errors); });

  return {
    brief,
    insights,
    health,
    churn_model: churn,
    run: {
      timings_ms: t,
      detectors_run,
      thresholds,
      /* Which streams the book actually carries, which detectors were skipped
         for want of one, and the ceiling that coverage put on confidence. On
         the run object rather than buried per-insight, because "what could not
         be looked at" is a property of the analysis, not of any one finding. */
      sources,
      confidence_ceiling: coverageCeiling,
      contract_valid: errors.length === 0,
      contract_errors: errors,
      stats: {
        records_in: ds.tickets.length + ds.escalations.length + ds.nps.length + ds.qa.length,
        anomalies_flagged: anomalies.length,
        insights_built: insights.length,
        held_for_review: insights.filter((i) => i.status === STATUS.HELD_FOR_REVIEW).length,
      },
    },
  };
}

export { STATUS, CONFIDENCE_CUTOFF };
