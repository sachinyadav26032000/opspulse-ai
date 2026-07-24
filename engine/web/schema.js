/* ==========================================================================
   The insight contract — the interface every agent writes one field of.
   --------------------------------------------------------------------------
   Nothing reaches the UI as free text until it has passed through this shape.
   That is what makes the product auditable instead of an opaque model output.
   The browser engine widens SIGNAL_TYPES beyond the original five; everything
   else matches the reviewed contract field-for-field.
   ========================================================================== */

export const SIGNAL_TYPES = [
  'churn_risk', 'csat_drop', 'coaching_gap', 'sla_risk', 'emerging_topic',
  'escalation_spike', 'backlog_risk', 'nps_drop', 'compliance_risk',
];

export const STATUS = {
  UNASSIGNED: 'unassigned',
  HELD_FOR_REVIEW: 'held_for_review',  // below the confidence cutoff → a human confirms first
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
};

export const CONFIDENCE_CUTOFF = 0.6;  // below this an insight is held, never auto-actioned

export function createInsight(p) {
  return {
    insight_id: p.insight_id,
    signal_type: p.signal_type,
    severity_score: p.severity_score,
    what_happened: p.what_happened,
    why: {
      root_cause: p.why.root_cause,
      contributing_signals: p.why.contributing_signals || [],
      confidence: p.why.confidence,
      hypothesis: true,
    },
    recommended_action: {
      action: p.recommended_action.action,
      owner_role: p.recommended_action.owner_role,
      playbook_id: p.recommended_action.playbook_id,
    },
    expected_impact: {
      revenue_at_risk_usd: p.expected_impact.revenue_at_risk_usd,
      range_low_usd: p.expected_impact.range_low_usd,
      range_high_usd: p.expected_impact.range_high_usd,
      type: p.expected_impact.type,
      time_horizon_days: p.expected_impact.time_horizon_days,
    },
    status: p.status || STATUS.UNASSIGNED,
    generated_at: p.generated_at,
    _meta: p._meta || {},
  };
}

export function validateInsight(o, i = 0) {
  const e = [];
  const at = (f) => `insight[${i}].${f}`;
  const str = (v) => typeof v === 'string' && v.length > 0;
  const num = (v) => typeof v === 'number' && !Number.isNaN(v);

  if (!str(o.insight_id)) e.push(at('insight_id') + ' must be a non-empty string');
  if (!SIGNAL_TYPES.includes(o.signal_type)) e.push(at('signal_type') + ` invalid: ${o.signal_type}`);
  if (!num(o.severity_score) || o.severity_score < 0 || o.severity_score > 100) e.push(at('severity_score') + ' must be 0–100');
  if (!str(o.what_happened)) e.push(at('what_happened') + ' required');

  if (!o.why || typeof o.why !== 'object') e.push(at('why') + ' block required');
  else {
    if (!str(o.why.root_cause)) e.push(at('why.root_cause') + ' required');
    if (!Array.isArray(o.why.contributing_signals)) e.push(at('why.contributing_signals') + ' must be array');
    if (!num(o.why.confidence) || o.why.confidence < 0 || o.why.confidence > 1) e.push(at('why.confidence') + ' must be 0–1');
  }

  const ra = o.recommended_action;
  if (!ra || typeof ra !== 'object') e.push(at('recommended_action') + ' block required');
  else {
    if (!str(ra.action)) e.push(at('recommended_action.action') + ' required');
    if (!str(ra.owner_role)) e.push(at('recommended_action.owner_role') + ' required');
    if (!str(ra.playbook_id)) e.push(at('recommended_action.playbook_id') + ' required');
  }

  const ei = o.expected_impact;
  if (!ei || typeof ei !== 'object') e.push(at('expected_impact') + ' block required');
  else {
    // null is legal and meaningful: some exposures must not be given a price.
    if (ei.revenue_at_risk_usd !== null && !num(ei.revenue_at_risk_usd)) e.push(at('expected_impact.revenue_at_risk_usd') + ' must be number or null');
    if (ei.range_low_usd !== null && ei.range_high_usd !== null && num(ei.range_low_usd) && num(ei.range_high_usd) && ei.range_low_usd > ei.range_high_usd) {
      e.push(at('expected_impact') + ' range_low_usd must be ≤ range_high_usd');
    }
    if (!str(ei.type)) e.push(at('expected_impact.type') + ' required');
    if (!num(ei.time_horizon_days)) e.push(at('expected_impact.time_horizon_days') + ' must be number');
  }

  if (!Object.values(STATUS).includes(o.status)) e.push(at('status') + ` invalid: ${o.status}`);
  if (!str(o.generated_at)) e.push(at('generated_at') + ' required (ISO timestamp)');

  return { ok: e.length === 0, errors: e };
}

export function validateBrief(b) {
  const e = [];
  if (!b || typeof b !== 'object') return { ok: false, errors: ['brief is not an object'] };
  if (!Array.isArray(b.insights)) e.push('brief.insights must be an array');
  (b.insights || []).forEach((ins, i) => { const r = validateInsight(ins, i); if (!r.ok) e.push(...r.errors); });
  if (!b.rollup) e.push('brief.rollup required');
  else {
    if (typeof b.rollup.total_revenue_at_risk !== 'number') e.push('rollup.total_revenue_at_risk must be number');
    if (!Array.isArray(b.rollup.top_3_ids)) e.push('rollup.top_3_ids must be array');
    if (typeof b.rollup.org_health_delta_explanation !== 'string') e.push('rollup.org_health_delta_explanation must be string');
  }
  return { ok: e.length === 0, errors: e };
}
