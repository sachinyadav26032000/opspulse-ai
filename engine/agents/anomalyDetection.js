'use strict';
/* ==========================================================================
   AGENT 2 — Insight / Anomaly Detection
   in:  normalized signal stream
   out: flagged anomalies with severity score  (+ a scored view of every
        series so the Root Cause Agent can pull the surrounding window)
   technique: statistical baselining — seasonality-aware rolling z-scores.
   LLM is deliberately NOT used here: it is unreliable at NOTICING anomalies
   in noisy time-series. "Keep the boring part boring."
   ========================================================================== */

const { rollingZ, mean, round, pctChange } = require('../util');

const HIGH_Z = 2.6;     // primary/headline anomaly threshold
const CONTRIB_Z = 1.4;  // threshold for a signal to count as contributing context

// business weighting so a health/churn breach outranks a cosmetic one
const BUSINESS_BASE = {
  churn_risk: 86, csat_drop: 80, coaching_gap: 62, sla_risk: 55, emerging_topic: 40,
};

/** Is this move in the "bad" direction for the metric's polarity? */
function isBad(better, z) { return better === 'up' ? z <= 0 : z >= 0; }

function scoreRecord(rec) {
  const z = rollingZ(rec.series, 3);
  const baselineMean = z.baselineMean;
  const observed = z.observed;
  const bad = isBad(rec.better, z.z) && Math.abs(z.z) >= CONTRIB_Z;
  return {
    key: rec.key, label: rec.label, unit: rec.unit, better: rec.better,
    entityId: rec.entityId, entity: rec.entity, headline_type: rec.headline_type,
    z: z.z, absZ: Math.abs(z.z), direction: z.direction,
    observed, baselineMean,
    declinePts: round(Math.abs(observed - baselineMean), 1),
    pct: pctChange(baselineMean, observed),
    bad,
  };
}

function whatHappened(a) {
  const name = a.entity.name;
  const dPts = Math.round(a.declinePts);
  const b = Math.round(a.baselineMean), o = Math.round(a.observed);
  switch (a.headline_type) {
    case 'churn_risk':     return `${a.entity.accounts} enterprise accounts show composite health decline >${dPts}pts in 7 days`;
    case 'csat_drop':      return `CSAT in ${name} fell ${dPts}pts (${b}%→${o}%) this week`;
    case 'coaching_gap':   return `QA score for ${name} dropped ${dPts}pts week-over-week`;
    case 'sla_risk':       return `SLA compliance in ${name} slipping ${b}%→${o}% — projected below 90% within 3 days`;
    case 'emerging_topic': return `New request cluster ‘${name}’ — volume up ${Math.abs(a.pct)}% in 48h`;
    default:               return `${a.label} anomaly in ${name}`;
  }
}

function severity(a) {
  const base = BUSINESS_BASE[a.headline_type] || 40;
  const zBonus = Math.round(Math.min(9, Math.max(0, (a.absZ - HIGH_Z)) * 2.2));
  return Math.max(0, Math.min(99, base + zBonus));
}

function run(normalized) {
  const scored = normalized.map(scoreRecord);
  const anomalies = scored
    .filter((s) => s.headline_type && s.bad && s.absZ >= HIGH_Z)
    .map((a) => ({
      anomaly_id: 'anom_' + a.entityId + '_' + a.key,
      signal_type: a.headline_type,
      severity_score: severity(a),
      entityId: a.entityId, entity: a.entity,
      primary_key: a.key, primary_label: a.label,
      z: a.z, observed: a.observed, baselineMean: a.baselineMean,
      declinePts: a.declinePts, pct: a.pct,
      what_happened: whatHappened(a),
    }))
    .sort((x, y) => y.severity_score - x.severity_score);
  return { anomalies, scored, thresholds: { HIGH_Z, CONTRIB_Z } };
}

module.exports = { run, HIGH_Z, CONTRIB_Z };
