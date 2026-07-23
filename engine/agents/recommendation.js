'use strict';
/* ==========================================================================
   AGENT 4 — Recommendation
   in:  anomaly + root cause (signal_type + contributing signals)
   out: the `recommended_action` block { action, owner_role, playbook_id }
   technique: eval against the playbook library, then an LLM adapts the winning
   playbook to the specifics. It does NOT generate advice from scratch — every
   recommendation is traceable to an owned, auditable playbook.
   ========================================================================== */

const playbooks = require('../playbooks');
const { narrate } = require('../llm');

async function run(partial) {
  const pb = playbooks.match(partial.signal_type, partial.why.contributing_signals);
  if (!pb) {
    return {
      recommended_action: { action: 'Review manually — no matching playbook', owner_role: 'Ops Manager', playbook_id: 'pb_none' },
      _action_options: [{ label: 'Assign for manual review', sub: 'No playbook matched this signal type', ic: 'assign', rec: true }],
      _playbook: null,
    };
  }
  const ctx = { entityName: partial.entity.name };
  // LLM adapts the playbook's primary action to specifics (template by default)
  const action = await narrate('recommendation', { text: pb.primary(ctx) });

  return {
    recommended_action: {
      action,
      owner_role: pb.owner_role,
      playbook_id: pb.playbook_id,
    },
    _action_options: pb.steps,
    _playbook: { playbook_id: pb.playbook_id, name: pb.name, time_horizon_days: pb.time_horizon_days, impact_type: pb.impact_type },
  };
}

module.exports = { run };
