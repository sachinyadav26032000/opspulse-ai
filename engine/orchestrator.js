'use strict';
/* ==========================================================================
   OpsPulse Decision Engine — Orchestrator
   --------------------------------------------------------------------------
   A pipeline / state machine, NOT another agent with its own judgment:

     Ingestion → Anomaly Detection
        └─(per flagged anomaly, in parallel)→ Root Cause → Recommendation
                                                     └→ Executive Summary → ExecutiveBrief

   Root Cause + Recommendation fan out per anomaly (they don't need to see each
   other's anomalies — that's where the latency budget comes back). Executive
   Summary runs last, once, over the whole ranked set.
   ========================================================================== */

const mockData = require('./mockData');
const impact = require('./impact');
const { hash, round } = require('./util');
const { createInsight } = require('./schema');

const ingestion = require('./agents/ingestion');
const detection = require('./agents/anomalyDetection');
const rootCause = require('./agents/rootCause');
const recommendation = require('./agents/recommendation');
const executiveSummary = require('./agents/executiveSummary');

const AGES = ['12m ago', '27m ago', '44m ago', '1h ago', '2h ago', '3h ago'];

function titleFor(signal_type, entity) {
  switch (signal_type) {
    case 'churn_risk':     return `Enterprise churn risk — ${entity.accounts} accounts`;
    case 'csat_drop':      return `CSAT drop — ${entity.name}`;
    case 'coaching_gap':   return `Agent coaching gap — ${entity.name}`;
    case 'sla_risk':       return `SLA breach risk — ${entity.name}`;
    case 'emerging_topic': return `Emerging topic — ‘${entity.name}’`;
    default:               return entity.name;
  }
}

function metricLabel(a, rev) {
  const b = Math.round(a.baselineMean), o = Math.round(a.observed);
  switch (a.signal_type) {
    case 'churn_risk':     return `$${Math.round(rev / 1000)}k ARR at risk`;
    case 'csat_drop':      return `CSAT ${b}%→${o}%`;
    case 'coaching_gap':   return `QA ${b}%→${o}%`;
    case 'sla_risk':       return `SLA ${b}%→${o}%`;
    case 'emerging_topic': return `+${Math.abs(a.pct)}% requests`;
    default:               return a.primary_label;
  }
}

async function run({ seed = 42, asOf = '2026-07-22T09:41:00Z', period = 'Wed, Jul 22 · daily digest' } = {}) {
  const t = {};
  const mark = (k, fn) => { const s = Date.now(); const r = fn(); t[k] = Date.now() - s; return r; };
  const markA = async (k, fn) => { const s = Date.now(); const r = await fn(); t[k] = Date.now() - s; return r; };

  // ── Stage 1: Ingestion ────────────────────────────────────────────────
  const raw = mockData.generate(seed);
  const { normalized, stats: ingestStats } = mark('ingestion', () => ingestion.run(raw));

  // ── Stage 2: Anomaly detection (statistical) ──────────────────────────
  const { anomalies, scored, thresholds } = mark('detection', () => detection.run(normalized));

  // ── Stage 3+4: per-anomaly fan-out (Root Cause → Recommendation) ──────
  const s34 = Date.now();
  const insights = await Promise.all(anomalies.map(async (a, idx) => {
    const rc = await rootCause.run(a, scored);
    const rec = await recommendation.run({ signal_type: a.signal_type, entity: a.entity, why: rc.why });

    const impactBlock = impact.compute(a.signal_type, {
      entity: a.entity, declinePts: a.declinePts, playbook: rec._playbook,
    });

    return createInsight({
      insight_id: 'ins_' + hash(a.entityId + a.signal_type),
      signal_type: a.signal_type,
      severity_score: a.severity_score,
      what_happened: a.what_happened,
      why: rc.why,
      recommended_action: rec.recommended_action,
      expected_impact: { revenue_at_risk_usd: impactBlock.revenue_at_risk_usd, type: impactBlock.type, time_horizon_days: impactBlock.time_horizon_days },
      generated_at: asOf,
      _meta: {
        title: titleFor(a.signal_type, a.entity),
        metric_label: metricLabel(a, impactBlock.revenue_at_risk_usd),
        team_label: a.entity.name,
        age: AGES[idx] || 'today',
        contributing_detail: rc._contributing_detail,
        action_options: rec._action_options,
        impact_basis: impactBlock._basis,
        entity: a.entity,
        provenance: ['ingestion', 'anomaly_detection', 'root_cause', 'recommendation'],
      },
    });
  }));
  t.rootcause_recommendation = Date.now() - s34;

  // ── Stage 5: Executive Summary (once, whole set) ──────────────────────
  const brief = await markA('exec_summary', () => executiveSummary.run(insights, { asOf, period }));

  return {
    brief,
    run: {
      timings_ms: t,
      stats: {
        raw_records: raw.length,
        normalized: ingestStats.out,
        anomalies_flagged: anomalies.length,
        insights_built: insights.length,
        thresholds,
      },
    },
  };
}

module.exports = { run };
