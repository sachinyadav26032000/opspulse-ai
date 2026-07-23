'use strict';
/* ==========================================================================
   OpsPulse Decision Engine — simulated RAW source feed
   --------------------------------------------------------------------------
   Stands in for live Zendesk / Aircall / Klaus QA / NPS-survey / Intercom
   connectors. Emits 28-day daily series in each source's NATIVE metric names;
   the Ingestion Agent normalizes them. Seeded → fully reproducible.

   The series are shaped so the (real, statistical) detector flags exactly the
   five showcase scenarios — the engine still has to find them; the data isn't
   labeled with answers.
   ========================================================================== */

const { mulberry32, round } = require('./util');

const LEN = 28;

function genSeries(rng, { base, noise, breach = 0, breachDays = 4, weekendDip = 0 }) {
  const out = [];
  for (let t = 0; t < LEN; t++) {
    let v = base;
    if (weekendDip && (t % 7 === 5 || t % 7 === 6)) v -= weekendDip;   // seasonal (weekend) effect
    v += (rng() * 2 - 1) * noise;                                       // baseline noise
    if (t >= LEN - breachDays) v += breach * ((t - (LEN - breachDays) + 1) / breachDays); // ramped breach
    out.push({ t, value: round(v, 3) });
  }
  return out;
}

// Scenario definitions: entity + its source streams. breach sign encodes
// direction (e.g. response time rises, sentiment falls).
const SCENARIOS = [
  {
    entity: { type: 'segment', id: 'seg_ent', name: 'Enterprise tier', arr: 560000, accounts: 6 },
    streams: [
      { source: 'survey',  stream: 'composite_health',       base: 82,  noise: 1.1, breach: -15, breachDays: 5 },
      { source: 'zendesk', stream: 'first_response_minutes', base: 45,  noise: 2.5, breach: 18,  breachDays: 5, weekendDip: 4 },
      { source: 'aircall', stream: 'avg_sentiment',          base: 0.36, noise: 0.05, breach: -0.5, breachDays: 5 },
      { source: 'klaus',   stream: 'qa_pct',                 base: 88,  noise: 1.4, breach: -6,  breachDays: 5 },
    ],
  },
  {
    entity: { type: 'queue', id: 'q_billing', name: 'Billing queue' },
    streams: [
      { source: 'survey',   stream: 'csat_pct',            base: 78,  noise: 1.2, breach: -7,  breachDays: 4 },
      { source: 'zendesk',  stream: 'refund_ticket_count', base: 100, noise: 7,   breach: 44,  breachDays: 4, weekendDip: 22 },
      { source: 'klaus',    stream: 'refund_qa_pct',       base: 85,  noise: 1.8, breach: -11, breachDays: 4 },
      { source: 'intercom', stream: 'pricing_mentions',    base: 20,  noise: 4,   breach: 46,  breachDays: 4 },
    ],
  },
  {
    entity: { type: 'team', id: 'team_b', name: 'Team B · Tier 1' },
    streams: [
      { source: 'klaus',   stream: 'qa_pct',            base: 84,   noise: 1.4, breach: -10,  breachDays: 5 },
      { source: 'zendesk', stream: 'escalation_rate',   base: 0.11, noise: 0.018, breach: 0.12, breachDays: 5 },
      { source: 'aircall', stream: 'avg_handle_minutes',base: 7.5,  noise: 0.5, breach: 2,    breachDays: 5 },
    ],
  },
  {
    entity: { type: 'queue', id: 'q_emea_night', name: 'EMEA night shift' },
    streams: [
      { source: 'survey',  stream: 'sla_pct',        base: 96, noise: 0.7, breach: -5,  breachDays: 4 },
      { source: 'zendesk', stream: 'offhours_inbound',base: 100, noise: 6,  breach: 18,  breachDays: 4, weekendDip: 14 },
      { source: 'aircall', stream: 'abandon_rate',   base: 4,  noise: 0.6, breach: 3,   breachDays: 4 },
    ],
  },
  {
    entity: { type: 'topic', id: 'topic_csv', name: 'export to CSV' },
    streams: [
      { source: 'intercom', stream: 'csv_requests',  base: 5, noise: 1.4, breach: 27, breachDays: 3 },
      { source: 'intercom', stream: 'export_intent', base: 6, noise: 1.2, breach: 13, breachDays: 3 },
    ],
  },
  // --- healthy background entities (detector must NOT flag these) ---
  {
    entity: { type: 'team', id: 'team_a', name: 'Team A · Onboarding' },
    streams: [{ source: 'klaus', stream: 'qa_pct', base: 91, noise: 1.2, breach: 0 }],
  },
  {
    entity: { type: 'queue', id: 'q_onboarding', name: 'Onboarding queue' },
    streams: [{ source: 'survey', stream: 'csat_pct', base: 90, noise: 1.1, breach: 0 }],
  },
];

/** Emit the raw source feed: one record per (source, stream, entity). */
function generate(seed = 42) {
  const rng = mulberry32(seed);
  const raw = [];
  SCENARIOS.forEach((sc) => {
    sc.streams.forEach((st) => {
      raw.push({
        source: st.source,
        stream: st.stream,
        entity: sc.entity,
        series: genSeries(rng, st),
      });
    });
  });
  return raw;
}

module.exports = { generate };
