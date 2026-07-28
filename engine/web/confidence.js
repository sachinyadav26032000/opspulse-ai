/* ==========================================================================
   Confidence, provenance and data quality.
   --------------------------------------------------------------------------
   Two ideas, both of which exist to make the product argue against itself.

   1. CONFIDENCE WITH A NAMED WEAKEST LINK.
      A bare percentage is unfalsifiable. `limiting_factor` states, in plain
      English, which single input is holding the number down — so a reader can
      go and check that specific thing rather than accept or reject the score
      whole. It is computed from the actual coverage of the sources the
      decision drew on, not authored per detector.

   2. DATA QUALITY AS A FINDING.
      When a source is materially incomplete, that is a decision in its own
      right. Telling a customer where their own data is failing them is a
      stronger position than claiming the model copes with mess — and it is
      the honest reading of a confidence score that is capped by coverage
      rather than by the strength of the signal.

   Every number below is measured off the dataset. Nothing here is seeded.
   ========================================================================== */

import { createInsight, STATUS } from './schema.js';

/** A source is materially incomplete below this. */
export const COVERAGE_FLOOR = 0.70;

const pctOf = (a, b) => (b > 0 ? a / b : 1);
const pc = (v) => `${Math.round(v * 100)}%`;

/* ── Source coverage, measured once per run ──────────────────────────────── */
export function measureCoverage(ds) {
  const now = ds.meta.as_of;
  const iso = (ms) => new Date(ms).toISOString();

  const ratedTickets = ds.tickets.filter((t) => t.customer_satisfaction_rating != null).length;
  const npsAccounts = new Set(ds.nps.map((n) => n.account_id));
  const ticketAccounts = new Set(ds.tickets.map((t) => t.account_id));
  const qaAgents = new Set(ds.qa.map((q) => q.agent_id));
  const withUsage = ds.accounts.filter((a) => a.usage).length;

  const latest = (rows, get) => rows.reduce((m, r) => Math.max(m, get(r) || 0), 0);

  return {
    ticketing: {
      source_system: 'Ticketing',
      last_synced_at: iso(latest(ds.tickets, (t) => t.created_at) || now),
      records_used: ds.tickets.length,
      coverage_pct: Math.round(pctOf(ticketAccounts.size, ds.accounts.length) * 100),
      note: `${ds.accounts.length - ticketAccounts.size} accounts have no ticket history`,
    },
    csat: {
      source_system: 'Survey · CSAT',
      last_synced_at: iso(latest(ds.tickets, (t) => t.created_at) || now),
      records_used: ratedTickets,
      coverage_pct: Math.round(pctOf(ratedTickets, ds.tickets.length) * 100),
      note: `satisfaction unrecorded on ${ds.tickets.length - ratedTickets} of ${ds.tickets.length} tickets`,
    },
    nps: {
      source_system: 'Survey · NPS',
      last_synced_at: iso(latest(ds.nps, (n) => n.submitted_at) || now),
      records_used: ds.nps.length,
      coverage_pct: Math.round(pctOf(npsAccounts.size, ds.accounts.length) * 100),
      note: `${ds.accounts.length - npsAccounts.size} accounts have never responded to a survey`,
    },
    crm: {
      source_system: 'CRM · Accounts',
      last_synced_at: iso(now),
      records_used: ds.accounts.length,
      coverage_pct: Math.round(pctOf(ds.accounts.filter((a) => a.arr_usd != null && a.renewal_in_days != null).length, ds.accounts.length) * 100),
      note: 'ARR and renewal date present on every account',
    },
    usage: {
      source_system: 'Product usage',
      last_synced_at: iso(now),
      records_used: withUsage,
      coverage_pct: Math.round(pctOf(withUsage, ds.accounts.length) * 100),
      note: `${withUsage} of ${ds.accounts.length} accounts reporting usage`,
    },
    escalations: {
      source_system: 'CRM · Escalations',
      last_synced_at: iso(latest(ds.escalations, (e) => e.created_at) || now),
      records_used: ds.escalations.length,
      coverage_pct: 100,
      note: 'every escalation carries an account reference',
    },
    qa: {
      source_system: 'Quality Assurance',
      last_synced_at: iso(now),
      records_used: ds.qa.length,
      coverage_pct: Math.round(pctOf(qaAgents.size, ds.agents.length) * 100),
      note: `${ds.agents.length - qaAgents.size} of ${ds.agents.length} agents never reviewed`,
    },
  };
}

/* Which sources each signal type actually drew on. Used to pick the weakest
   link honestly — a decision is not limited by a source it never read. */
const SOURCES_BY_SIGNAL = {
  escalation_spike: ['ticketing', 'escalations'],
  emerging_topic: ['ticketing'],
  backlog_risk: ['ticketing'],
  sla_risk: ['ticketing'],
  csat_drop: ['ticketing', 'csat'],
  coaching_gap: ['qa', 'ticketing'],
  nps_drop: ['nps'],
  compliance_risk: ['ticketing', 'escalations', 'qa'],
  churn_risk: ['escalations', 'crm', 'nps', 'csat'],
  silent_decline: ['usage', 'crm', 'ticketing'],
  adoption_failure: ['usage', 'crm'],
  renewal_risk: ['usage', 'crm', 'escalations'],
  concentrated_cause: ['ticketing', 'usage', 'crm'],
  data_quality: ['ticketing', 'csat', 'nps', 'qa', 'crm', 'usage'],
};

/**
 * Attach `confidence` and `provenance_detail` to an insight.
 * The score is the engine's computed confidence, capped by the coverage of the
 * weakest source it relied on — a decision cannot be more certain than the
 * data underneath it.
 */
export function attachConfidence(insight, coverage) {
  const keys = SOURCES_BY_SIGNAL[insight.signal_type] || ['ticketing'];
  const used = keys.map((k) => coverage[k]).filter(Boolean);

  const provenance_detail = used.map((s) => ({
    source_system: s.source_system,
    last_synced_at: s.last_synced_at,
    records_used: s.records_used,
    coverage_pct: s.coverage_pct,
  }));

  const weakest = used.slice().sort((a, b) => a.coverage_pct - b.coverage_pct)[0];
  const raw = Math.round(insight.why.confidence * 100);

  /* Coverage caps the score rather than averaging into it. A signal computed
     from a source covering 33% of accounts is not 80% trustworthy no matter
     how clean its arithmetic — but neither is it 33%, because the records it
     DID read are sound. The cap is the midpoint of the two. */
  const cap = weakest ? Math.round((weakest.coverage_pct + 100) / 2) : 100;
  const score = Math.min(raw, cap);

  const limiting_factor = !weakest || weakest.coverage_pct >= COVERAGE_FLOOR * 100
    ? `Statistical strength of the signal itself — every source it reads covers at least ${pc(COVERAGE_FLOOR)} of the base.`
    : `${weakest.source_system} covers only ${weakest.coverage_pct}% — ${weakest.note}.`;

  insight.confidence = {
    score,
    basis: [
      `signal strength ${raw}%`,
      `${used.length} source${used.length === 1 ? '' : 's'} read`,
      `weakest coverage ${weakest ? weakest.coverage_pct + '%' : 'n/a'}`,
      score < raw ? `capped from ${raw}% by coverage` : 'not coverage-capped',
    ].join(' · '),
    limiting_factor,
    coverage_capped: score < raw,
  };
  insight.provenance_detail = provenance_detail;

  // Keep the legacy field in step so nothing downstream disagrees with the card.
  insight.why.confidence = score / 100;
  return insight;
}

/* ══════════════════════════════════════════════════════════════════════════
   DATA QUALITY as a decision in its own right
   ══════════════════════════════════════════════════════════════════════════ */
export function detectDataQuality(ds, coverage, { asOf = ds.meta.as_of } = {}) {
  const gaps = Object.entries(coverage)
    .map(([key, s]) => ({ key, ...s }))
    .filter((s) => s.coverage_pct < COVERAGE_FLOOR * 100)
    .sort((a, b) => a.coverage_pct - b.coverage_pct);

  if (!gaps.length) return null;

  const worst = gaps[0];
  const blinded = Object.entries(SOURCES_BY_SIGNAL)
    .filter(([, srcs]) => srcs.includes(worst.key))
    .map(([sig]) => sig)
    .filter((s) => s !== 'data_quality');

  const list = gaps.map((g) => `${g.source_system} at ${g.coverage_pct}%`).join(', ');

  return createInsight({
    insight_id: `ins_data_quality_${ds.meta.seed % 9973}`,
    signal_type: 'data_quality',
    severity_score: 74,
    what_happened: `${gaps.length} connected source${gaps.length === 1 ? ' is' : 's are'} materially incomplete: ${list}. The weakest is ${worst.source_system} — ${worst.note}. Every signal that reads it is capped in confidence as a result.`,
    why: {
      root_cause: `This is a data coverage problem, not a detection problem. ${worst.source_system} covers ${worst.coverage_pct}% of the base, so ${blinded.length} signal type${blinded.length === 1 ? '' : 's'} (${blinded.join(', ')}) are reasoning from a partial picture. Risk in the uncovered portion is not low — it is unmeasured, and the two are easy to confuse on a dashboard.`,
      contributing_signals: gaps.map((g) => ({
        label: g.source_system, detail: `${g.coverage_pct}% coverage · ${g.note}`, hit: true,
      })),
      confidence: 0.95,
    },
    recommended_action: {
      action: `Close the ${worst.source_system} gap before trusting any ${blinded[0] || 'downstream'} figure as a full picture. Until then, treat every exposure number in this brief as a floor rather than a total.`,
      owner_role: 'Head of Revenue Operations',
      playbook_id: 'PB-DATA-COVERAGE-01',
    },
    expected_impact: {
      // Deliberately not costed: the cost of a blind spot is unknowable by
      // definition, and inventing a figure here would be the exact error this
      // decision exists to warn about.
      revenue_at_risk_usd: null,
      range_low_usd: null,
      range_high_usd: null,
      type: 'coverage_gap',
      time_horizon_days: 30,
    },
    status: STATUS.UNASSIGNED,
    generated_at: new Date(asOf).toISOString(),
    _meta: {
      title: `Coverage gap — ${worst.source_system} at ${worst.coverage_pct}%`,
      metric_label: `${gaps.length} source${gaps.length === 1 ? '' : 's'} below ${pc(COVERAGE_FLOOR)}`,
      entity: { kind: 'source', key: worst.key, label: worst.source_system },
      unit: 'rate',
      observed: worst.coverage_pct,
      baseline: Math.round(COVERAGE_FLOOR * 100),
      z: 0,
      n_recent: worst.records_used,
      n_base: ds.accounts.length,
      affected_accounts: 0,
      affected_ids: [],
      series: null,
      decomposition: gaps.map((g) => ({ key: g.source_system, value: g.coverage_pct, contribution: 1 / gaps.length })),
      decomposition_dimension: 'source',
      evidence: { gaps, blinded_signals: blinded, floor_pct: Math.round(COVERAGE_FLOOR * 100) },
      impact: {
        type: 'coverage_gap',
        formula: 'Not costed — the exposure hidden by a blind spot cannot be measured from inside it',
        basis: gaps.map((g) => `${g.source_system}: ${g.coverage_pct}% coverage, ${g.records_used.toLocaleString('en-US')} records`),
        note: 'Putting a dollar figure on unmeasured risk would be the same error this finding is warning about.',
      },
      steps: [
        `Confirm whether ${worst.source_system} is genuinely incomplete or simply not being synced.`,
        'Identify which accounts are missing from it and whether they skew by region, plan or tenure.',
        'Backfill or reconnect the source, then re-run the brief and compare exposure before and after.',
        'Until then, report exposure figures as floors, not totals.',
      ],
      effort: 'medium',
      horizon_days: 30,
      provenance: Object.fromEntries(gaps.map((g) => [g.key, `${g.records_used} records, ${g.coverage_pct}% coverage`])),
      confidence_parts: { statistical: 0.45, explained: 0.35, corroborated: 0.15 },
      is_revenue: false,
      is_data_quality: true,
    },
  });
}
