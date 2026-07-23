'use strict';
/* ==========================================================================
   AGENT 3 — Root Cause
   in:  a flagged anomaly + surrounding signal window
   out: the `why` block { root_cause, contributing_signals[], confidence }
   technique: DETERMINISTIC cross-signal correlation first (which co-moving
   signals on the same entity corroborate the anomaly), THEN an LLM pass that
   only explains the correlation in plain language. It never sources facts the
   correlation didn't already establish → hallucination-bounded.
   ========================================================================== */

const { clamp, round, mean } = require('../util');
const { SIGNAL_TYPE_LABEL } = require('../signals');
const { narrate } = require('../llm');
const { CONTRIB_Z } = require('./anomalyDetection');

async function run(anomaly, scored) {
  // surrounding window = other bad-direction signals on the same entity
  const contributing = scored
    .filter((s) => s.entityId === anomaly.entityId && s.key !== anomaly.primary_key && s.bad && s.absZ >= CONTRIB_Z)
    .sort((a, b) => b.absZ - a.absZ);

  const n = contributing.length;
  const avgAbsZ = n ? mean(contributing.map((c) => c.absZ)) : 0;
  // confidence rises with corroboration count and strength; bounded.
  const confidence = round(clamp(0.34 + 0.14 * n + 0.03 * Math.min(avgAbsZ, 4), 0, 0.95), 2);

  const contributing_detail = contributing.map((c) => ({
    key: c.key, label: c.label,
    direction: c.pct > 0 ? 'rose' : 'fell',
    pct: Math.abs(c.pct),
    weight: Math.round(clamp((c.absZ / 4) * 100, 25, 96)),
  }));

  // deterministic skeleton → LLM narration (template provider by default)
  let skeleton;
  if (n) {
    const top = contributing_detail[0];
    const rest = contributing_detail.slice(1);
    skeleton = `${top.label} ${top.direction} ${top.pct}% in the same window — the leading correlated driver of the ${SIGNAL_TYPE_LABEL[anomaly.signal_type]}.`;
    if (rest.length) skeleton += ` ${rest.map((r) => r.label).join(' and ')} moved in step (${n} corroborating signals).`;
  } else {
    skeleton = `Isolated ${SIGNAL_TYPE_LABEL[anomaly.signal_type]} with no strongly corroborating signals yet — monitor before acting.`;
  }
  const root_cause = await narrate('root_cause', { text: skeleton });

  return {
    why: {
      root_cause,
      contributing_signals: contributing.map((c) => c.key),
      confidence,
    },
    _contributing_detail: contributing_detail,
  };
}

module.exports = { run };
