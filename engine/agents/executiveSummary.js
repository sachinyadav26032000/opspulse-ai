'use strict';
/* ==========================================================================
   AGENT 5 — Executive Summary
   in:  all enriched insights for the period
   out: one ExecutiveBrief — ranked insights + a rollup
   technique: LLM synthesis over STRUCTURED inputs only (never raw data), doing
   prioritization across insights, not generating new ones. This is the only
   agent that sees the whole ranked set. It also enforces the CONFIDENCE GATE.
   ========================================================================== */

const { createBrief, STATUS } = require('../schema');
const { narrate } = require('../llm');
const { round } = require('../util');

// Open CTO question #6: confidence cutoff before an insight ships to the CRO
// brief vs. is held for a human to confirm first.
const CONFIDENCE_CUTOFF = 0.60;

async function run(insights, { asOf, period }) {
  // apply the confidence gate
  insights.forEach((ins) => {
    if (ins.why.confidence < CONFIDENCE_CUTOFF) ins.status = STATUS.HELD_FOR_REVIEW;
  });

  const shipped = insights
    .filter((i) => i.status !== STATUS.HELD_FOR_REVIEW)
    .sort((a, b) => b.severity_score - a.severity_score);
  const held = insights.filter((i) => i.status === STATUS.HELD_FOR_REVIEW);

  // brief renders shipped first (ranked), held appended
  const ordered = shipped.concat(held);

  const total_revenue_at_risk = shipped.reduce((s, i) => s + i.expected_impact.revenue_at_risk_usd, 0);
  const top3 = shipped.slice(0, 3);
  const top_3_ids = top3.map((i) => i.insight_id);

  const org_health_delta_explanation =
    `Org health pressured by ${shipped.length} active risk${shipped.length === 1 ? '' : 's'} ` +
    `($${(total_revenue_at_risk / 1000).toFixed(0)}k at risk); the largest driver is ` +
    `${top3[0] ? top3[0].what_happened.toLowerCase() : 'n/a'}.` +
    (held.length ? ` ${held.length} lower-confidence signal${held.length === 1 ? '' : 's'} held for human review.` : '');

  const summarySkeleton =
    `Today's top ${top3.length}: ` +
    top3.map((i, n) => `(${n + 1}) ${i.what_happened} — $${(i.expected_impact.revenue_at_risk_usd / 1000).toFixed(0)}k, ${i.recommended_action.action}`).join('; ') +
    `. Total $${(total_revenue_at_risk / 1000).toFixed(0)}k at risk this period.`;
  const narrative = await narrate('exec_summary', { text: summarySkeleton });

  return createBrief({
    insights: ordered,
    rollup: { total_revenue_at_risk, top_3_ids, org_health_delta_explanation },
    narrative,
    generated_at: asOf,
    period,
  });
}

module.exports = { run, CONFIDENCE_CUTOFF };
