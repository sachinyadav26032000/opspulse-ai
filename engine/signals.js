'use strict';
/* ==========================================================================
   OpsPulse Decision Engine — Signal catalog & source mapping
   --------------------------------------------------------------------------
   The Data Ingestion Agent uses SOURCE_MAP to normalize source-native metric
   names onto canonical signal keys, and CATALOG to attach label/unit/polarity.
   `headlineSignalType()` encodes which OUTCOME metrics are worth raising as a
   top-level insight (vs. sub-metrics that only ever corroborate as context).
   This is domain config, not per-scenario hard-coding.
   ========================================================================== */

// canonical key → display metadata. `better` = which direction is good.
const CATALOG = {
  composite_health:        { label: 'Composite account health', unit: 'pts',     better: 'up',   source: 'survey' },
  csat:                    { label: 'CSAT',                      unit: '%',       better: 'up',   source: 'survey' },
  sla_compliance:          { label: 'SLA compliance',            unit: '%',       better: 'up',   source: 'survey' },
  klaus_qa_score:          { label: 'QA score',                  unit: '%',       better: 'up',   source: 'klaus' },
  klaus_qa_refund:         { label: 'Refund-handling QA',        unit: '%',       better: 'up',   source: 'klaus' },
  aircall_sentiment:       { label: 'Call sentiment',            unit: '',        better: 'up',   source: 'aircall' },
  aircall_handle_time:     { label: 'Avg handle time',           unit: 'min',     better: 'down', source: 'aircall' },
  aircall_abandon_rate:    { label: 'Call abandon rate',         unit: '%',       better: 'down', source: 'aircall' },
  zendesk_response_time:   { label: 'First-response time',       unit: 'min',     better: 'down', source: 'zendesk' },
  zendesk_refund_volume:   { label: 'Refund ticket volume',      unit: 'tickets', better: 'down', source: 'zendesk' },
  zendesk_escalation_rate: { label: 'Escalation rate',           unit: '',        better: 'down', source: 'zendesk' },
  zendesk_offhours_inbound:{ label: 'Off-hours inbound',         unit: 'tickets', better: 'down', source: 'zendesk' },
  intercom_topic_pricing:  { label: '‘confusing pricing’ mentions', unit: '',    better: 'down', source: 'intercom' },
  topic_volume_csv:        { label: '‘export to CSV’ requests',  unit: '',        better: 'down', source: 'intercom' },
  intercom_intent_export:  { label: '‘export’ intent',           unit: '',        better: 'down', source: 'intercom' },
};

// source-native stream name → canonical key (ETL mapping, not ML)
const SOURCE_MAP = {
  survey:   { composite_health: 'composite_health', csat_pct: 'csat', sla_pct: 'sla_compliance' },
  klaus:    { qa_pct: 'klaus_qa_score', refund_qa_pct: 'klaus_qa_refund' },
  aircall:  { avg_sentiment: 'aircall_sentiment', avg_handle_minutes: 'aircall_handle_time', abandon_rate: 'aircall_abandon_rate' },
  zendesk:  { first_response_minutes: 'zendesk_response_time', refund_ticket_count: 'zendesk_refund_volume', escalation_rate: 'zendesk_escalation_rate', offhours_inbound: 'zendesk_offhours_inbound' },
  intercom: { pricing_mentions: 'intercom_topic_pricing', csv_requests: 'topic_volume_csv', export_intent: 'intercom_intent_export' },
};

/**
 * Which canonical metrics are OUTCOME/headline signals (worth a top-level
 * insight) and what type they map to. Sub-metrics return null → they can still
 * be pulled in as contributing context by the Root Cause Agent.
 */
function headlineSignalType(key, entityType) {
  switch (key) {
    case 'composite_health': return 'churn_risk';
    case 'csat':             return 'csat_drop';
    case 'sla_compliance':   return 'sla_risk';
    case 'topic_volume_csv': return 'emerging_topic';
    case 'klaus_qa_score':   return entityType === 'team' ? 'coaching_gap' : null;
    default:                 return null;
  }
}

const SIGNAL_TYPE_LABEL = {
  churn_risk: 'churn risk',
  csat_drop: 'CSAT decline',
  coaching_gap: 'coaching gap',
  sla_risk: 'SLA-breach risk',
  emerging_topic: 'emerging topic',
};

module.exports = { CATALOG, SOURCE_MAP, headlineSignalType, SIGNAL_TYPE_LABEL };
