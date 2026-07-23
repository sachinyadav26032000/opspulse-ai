'use strict';
/* ==========================================================================
   OpsPulse Decision Engine — Impact model (rules-based v1)
   --------------------------------------------------------------------------
   Open CTO question #2: revenue_at_risk needs a DEFENSIBLE formula before it
   goes in front of a CRO. This is the v1 rules-based first pass (owned by Ops,
   swappable for a data-science churn model later):

       churn_risk  → account_ARR × churn_probability(health_decline)
       others      → per-type unit cost × magnitude of the decline

   Deterministic, explainable, and easy to defend line-by-line.
   ========================================================================== */

const { clamp, round } = require('./util');

const toThousand = (x) => Math.round(x / 1000) * 1000;

// churn probability as a function of composite-health point decline
function churnProbability(declinePts) {
  return round(clamp(0.15 + 0.026 * declinePts, 0.05, 0.85), 3);
}

function compute(signal_type, ctx) {
  const horizon = (ctx.playbook && ctx.playbook.time_horizon_days) || 14;
  const d = ctx.declinePts || 0;
  switch (signal_type) {
    case 'churn_risk': {
      const p = churnProbability(d);
      return {
        revenue_at_risk_usd: toThousand((ctx.entity.arr || 0) * p),
        type: 'churn_prevention',
        time_horizon_days: horizon,
        _basis: `ARR $${(ctx.entity.arr || 0).toLocaleString()} × churn P=${p} (health −${Math.round(d)}pts)`,
      };
    }
    case 'csat_drop':
      return { revenue_at_risk_usd: toThousand(12000 * d), type: 'csat_recovery', time_horizon_days: horizon, _basis: `$12k per CSAT-point at risk × ${Math.round(d)}pts` };
    case 'coaching_gap':
      return { revenue_at_risk_usd: toThousand(6000 * d), type: 'quality_recovery', time_horizon_days: horizon, _basis: `$6k per QA-point × ${Math.round(d)}pts` };
    case 'sla_risk':
      return { revenue_at_risk_usd: toThousand(15000 * d), type: 'sla_penalty_avoidance', time_horizon_days: horizon, _basis: `$15k penalty exposure per SLA-point × ${Math.round(d)}pts` };
    case 'emerging_topic':
    default:
      return { revenue_at_risk_usd: 0, type: 'product_signal', time_horizon_days: horizon, _basis: 'No direct revenue at risk — routed as product signal' };
  }
}

module.exports = { compute, churnProbability };
