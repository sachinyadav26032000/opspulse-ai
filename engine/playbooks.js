'use strict';
/* ==========================================================================
   OpsPulse Decision Engine — Playbook library (v1)
   --------------------------------------------------------------------------
   The Recommendation Agent does NOT invent advice from scratch. It matches an
   enriched insight against this library and adapts the winning playbook to the
   specifics. A rules-based v1 (7 playbooks) is enough to start; each is
   auditable and owned by a role.
   ========================================================================== */

const PLAYBOOKS = [
  {
    playbook_id: 'pb_churn_escalation_v2',
    name: 'Enterprise churn escalation',
    applies_to: { signal_type: 'churn_risk' },
    owner_role: 'CS Manager',
    time_horizon_days: 14,
    impact_type: 'churn_prevention',
    // primary action + secondary steps (secondary shown in the Insight Explorer)
    primary: (ctx) => `Escalate ${ctx.entityName} to CS leadership and assign a senior recovery owner`,
    steps: [
      { label: 'Escalate to CS leadership', sub: 'Loop in the VP of Success + assign a save-play', ic: 'esc', rec: true },
      { label: 'Assign recovery owner', sub: 'Route the accounts to a senior CSM', ic: 'assign' },
      { label: 'Fix upstream SLA rule', sub: 'Auto-page on-call when the breaching metric recurs', ic: 'flow' },
    ],
  },
  {
    playbook_id: 'pb_csat_recovery_v1',
    name: 'CSAT recovery — process regression',
    applies_to: { signal_type: 'csat_drop' },
    owner_role: 'Support Team Lead',
    time_horizon_days: 7,
    impact_type: 'csat_recovery',
    primary: (ctx) => `Publish an updated macro/policy for ${ctx.entityName} and brief the queue`,
    steps: [
      { label: 'Publish macro + policy update', sub: 'Ship a canned response for the affected flow', ic: 'flow', rec: true },
      { label: 'Brief the queue', sub: '15-min huddle + updated playbook', ic: 'coach' },
      { label: 'Assign to queue lead', sub: 'Owner: track resolution back to green', ic: 'assign' },
    ],
  },
  {
    playbook_id: 'pb_agent_coaching_v1',
    name: 'Targeted agent coaching',
    applies_to: { signal_type: 'coaching_gap' },
    owner_role: 'Support Team Lead',
    time_horizon_days: 21,
    impact_type: 'quality_recovery',
    primary: (ctx) => `Schedule targeted coaching for ${ctx.entityName} on the weak QA dimension`,
    steps: [
      { label: 'Schedule targeted coaching', sub: 'Focus the module on the failing scenario', ic: 'coach', rec: true },
      { label: 'Pair with a senior mentor', sub: 'Buddy system for two weeks', ic: 'assign' },
      { label: 'Surface top KB articles', sub: 'Pin fixes to the agent workspace', ic: 'flow' },
    ],
  },
  {
    playbook_id: 'pb_sla_coverage_v1',
    name: 'SLA coverage adjustment',
    applies_to: { signal_type: 'sla_risk' },
    owner_role: 'WFM Planner',
    time_horizon_days: 5,
    impact_type: 'sla_penalty_avoidance',
    primary: (ctx) => `Adjust coverage for ${ctx.entityName} before SLA crosses the threshold`,
    steps: [
      { label: 'Adjust coverage schedule', sub: 'Shift agents into the at-risk window', ic: 'flow', rec: true },
      { label: 'Flag to WFM planning', sub: 'Request temporary capacity', ic: 'esc' },
    ],
  },
  {
    playbook_id: 'pb_product_signal_v1',
    name: 'Route emerging product signal',
    applies_to: { signal_type: 'emerging_topic' },
    owner_role: 'Product Ops',
    time_horizon_days: 30,
    impact_type: 'product_signal',
    primary: (ctx) => `Route the '${ctx.entityName}' cluster to the product board as a feature signal`,
    steps: [
      { label: 'Route to product board', sub: 'Tag as a feature signal', ic: 'flow', rec: true },
      { label: 'Snooze & re-evaluate', sub: 'Revisit if volume keeps growing', ic: 'dismiss' },
    ],
  },
  // --- extra library depth (not triggered by the demo scenarios) ---
  {
    playbook_id: 'pb_sentiment_deescalation_v1',
    name: 'Call sentiment de-escalation',
    applies_to: { signal_type: 'csat_drop', requires_signal: 'aircall_sentiment' },
    owner_role: 'Support Team Lead',
    time_horizon_days: 3,
    impact_type: 'csat_recovery',
    primary: (ctx) => `De-escalation coaching for calls in ${ctx.entityName}`,
    steps: [{ label: 'De-escalation coaching', sub: 'Targeted call-handling review', ic: 'coach', rec: true }],
  },
  {
    playbook_id: 'pb_staffing_rebalance_v1',
    name: 'Cross-queue staffing rebalance',
    applies_to: { signal_type: 'sla_risk', requires_signal: 'zendesk_offhours_inbound' },
    owner_role: 'WFM Planner',
    time_horizon_days: 7,
    impact_type: 'sla_penalty_avoidance',
    primary: (ctx) => `Rebalance staffing toward ${ctx.entityName}`,
    steps: [{ label: 'Rebalance staffing', sub: 'Move capacity from low-load queues', ic: 'flow', rec: true }],
  },
];

/** Match: same signal_type; prefer a playbook whose required signal is present. */
function match(signal_type, contributing_signals) {
  const candidates = PLAYBOOKS.filter((p) => p.applies_to.signal_type === signal_type);
  if (!candidates.length) return null;
  const specific = candidates.find(
    (p) => p.applies_to.requires_signal && contributing_signals.includes(p.applies_to.requires_signal)
  );
  return specific || candidates[0];
}

module.exports = { PLAYBOOKS, match };
