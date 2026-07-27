/* ==========================================================================
   The tool surface — what an LLM is allowed to ask this operation.
   --------------------------------------------------------------------------
   This is the whole point of the MCP layer: the engine already computes
   defensible answers, so the model's job is to CHOOSE and NARRATE them, never
   to compute them. Every tool here returns engine output. None of them ask a
   model to do arithmetic, and none of them invent a number the app itself
   would not print.

   Three constraints inherited from the rest of the codebase, kept literally:

   1. Dollar impact travels with its arithmetic. `explain_insight` returns the
      formula, the rounded inputs and the basis lines alongside the range, so a
      model quoting the range has the derivation in the same payload and cannot
      quote one without the other.
   2. Compliance exposure stays uncosted. Nothing here back-fills a dollar
      figure onto an insight whose `expected_impact.range_high_usd` is null.
   3. No parallel aggregation. `get_metric_series` returns the series the
      dataset itself computed (`meta.series`) and the series the detector
      attached to an insight — it does not re-slice the tickets with its own
      bucketing. Re-deriving CSAT here with slightly different close-day
      handling is exactly how a tool answer starts disagreeing with the chart
      the user is looking at.

   Read-only by design. There is no reseed, no resolve, no write of any kind:
   an agent inspecting an operation should not be able to change it.
   ========================================================================== */

import { generate } from '../data/generator.js';
import { runEngine } from '../engine/web/index.js';
import { dayLabel } from '../engine/web/aggregate.js';
import { buildIndex, search } from './retrieve.js';

/**
 * One world per process. The dataset rebuilds deterministically from the seed,
 * so a client that wants a different operation restarts the server with a
 * different OPSPULSE_SEED rather than mutating this one mid-conversation —
 * an agent halfway through a line of questioning should not have the ground
 * shift under it.
 */
export function createSession({ seed, asOf } = {}) {
  const s = seed ?? (Number(process.env.OPSPULSE_SEED) || 20260724);
  const at = asOf ?? Date.now();
  const ds = generate(s, at);
  const engine = runEngine(ds, { asOf: at });
  // Built once. ~11,600 documents; every search reuses it.
  const index = buildIndex(ds);
  return { seed: s, asOf: at, ds, engine, index };
}

const round = (n, p = 2) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p);
const usd = (n) => (n == null ? null : Math.round(n));

/** Insight as it appears in a list: enough to choose between, not to quote. */
function insightBrief(i) {
  const m = i._meta;
  return {
    insight_id: i.insight_id,
    title: m.title,
    signal_type: i.signal_type,
    headline: m.metric_label,
    severity_score: i.severity_score,
    confidence: round(i.why.confidence),
    status: i.status,
    entity: `${m.entity.kind}:${m.entity.key}`,
    affected_accounts: m.affected_accounts,
    impact_low_usd: usd(i.expected_impact.range_low_usd),
    impact_high_usd: usd(i.expected_impact.range_high_usd),
    horizon_days: i.expected_impact.time_horizon_days,
  };
}

const findInsight = (session, id) =>
  session.engine.insights.find((i) => i.insight_id === id) || null;

/* ── The tools ───────────────────────────────────────────────────────────── */

export const TOOLS = [
  {
    name: 'describe_operation',
    description:
      'Ground yourself before answering anything else. Returns the company, the ' +
      'window under analysis, record counts, the release/policy timeline, the ' +
      'declared detector thresholds, and how many anomalies cleared them. Call ' +
      'this first in a new conversation so later answers can cite the window and ' +
      'the sample sizes rather than implying them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run(session) {
      const { ds, engine } = session;
      return {
        org: ds.meta.org,
        source: ds.meta.source,
        seed: session.seed,
        as_of: new Date(ds.meta.as_of).toISOString(),
        window: {
          days: ds.meta.days,
          recent_from_day: ds.meta.recent_from,
          recent_days: ds.meta.days - ds.meta.recent_from,
          first_day: dayLabel(ds, 0),
          last_day: dayLabel(ds, ds.meta.days - 1),
          recent_label: `${dayLabel(ds, ds.meta.recent_from)} – ${dayLabel(ds, ds.meta.days - 1)}`,
        },
        counts: ds.meta.counts,
        releases: ds.meta.releases.map((r) => ({
          day_index: r.day, date: dayLabel(ds, r.day), kind: r.kind,
          label: r.label, affects: r.affects,
        })),
        detection: {
          detectors_run: engine.run.detectors_run,
          thresholds: engine.run.thresholds,
          anomalies_flagged: engine.run.stats.anomalies_flagged,
          insights_built: engine.run.stats.insights_built,
          held_for_review: engine.run.stats.held_for_review,
          contract_valid: engine.run.contract_valid,
        },
        note:
          'Detection is statistical, not looked up: the thresholds above are the ' +
          'entire decision rule. All data is simulated.',
      };
    },
  },

  {
    name: 'get_executive_brief',
    description:
      "The 9am answer: the top 3 operational risks and what to do about them. " +
      'The top 3 is diversity-aware — ranked purely by priority one story would ' +
      'take two slots, so the strongest card per entity wins its slot. Use this ' +
      "for \"what should I care about today\"; use list_insights when the user " +
      'wants the full feed.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run(session) {
      const b = session.engine.brief;
      return {
        brief_id: b.brief_id,
        period: b.period,
        generated_at: b.generated_at,
        health: { score: b.health.score, delta: b.health.delta },
        narrative_lines: b.narrative_lines,
        top_3: b.top_3.map(insightBrief),
        opportunities: b.opportunities.map((o) => ({
          insight_id: o.insight_id, title: o.title, action: o.action,
          owner_role: o.owner_role, effort: o.effort, horizon_days: o.horizon_days,
          value_low_usd: usd(o.value_low), value_high_usd: usd(o.value_high),
        })),
        total_revenue_at_risk_usd: b.rollup.total_revenue_at_risk,
        health_delta_explanation: b.rollup.org_health_delta_explanation,
        note:
          'Ranked by severity × confidence × urgency, so a larger but slower-moving ' +
          'exposure can legitimately sit outside the top 3 — the narrative says so ' +
          'explicitly when that happens. Call explain_insight before quoting any ' +
          'dollar figure.',
      };
    },
  },

  {
    name: 'list_insights',
    description:
      'The full decision feed, ranked. Each entry is a summary — call ' +
      'explain_insight for the evidence, the root-cause decomposition and the ' +
      'impact arithmetic behind any one of them.',
    inputSchema: {
      type: 'object',
      properties: {
        signal_type: {
          type: 'string',
          description: 'Optional filter, e.g. escalation_spike, backlog_risk, nps_drop, coaching_gap.',
        },
        status: {
          type: 'string',
          enum: ['unassigned', 'held_for_review'],
          description: 'Filter by workflow status. held_for_review means confidence fell below the 60% cutoff.',
        },
      },
      additionalProperties: false,
    },
    run(session, args = {}) {
      let list = session.engine.insights;
      if (args.signal_type) list = list.filter((i) => i.signal_type === args.signal_type);
      if (args.status) list = list.filter((i) => i.status === args.status);
      return {
        count: list.length,
        total: session.engine.insights.length,
        insights: list.map(insightBrief),
        note:
          'Anything with status held_for_review is below the 60% confidence cutoff ' +
          'and must not be presented as actionable without saying so.',
      };
    },
  },

  {
    name: 'explain_insight',
    description:
      'Everything behind one insight: what happened, the statistical test that ' +
      'found it, the root-cause decomposition (parts sum to the whole), the three ' +
      'components of the confidence score, the recommended playbook, and the full ' +
      'impact arithmetic — formula, rounded inputs and stated assumptions. Call ' +
      'this before quoting any number from this insight; the range and its ' +
      'derivation are returned together so you can never cite one without the other.',
    inputSchema: {
      type: 'object',
      properties: {
        insight_id: { type: 'string', description: 'From get_executive_brief or list_insights, e.g. ins_1a2b3c.' },
      },
      required: ['insight_id'],
      additionalProperties: false,
    },
    run(session, args) {
      const i = findInsight(session, args.insight_id);
      if (!i) {
        return {
          error: `No insight with id ${args.insight_id}.`,
          available: session.engine.insights.map((x) => x.insight_id),
        };
      }
      const m = i._meta;
      const imp = m.impact;
      return {
        insight_id: i.insight_id,
        title: m.title,
        signal_type: i.signal_type,
        status: i.status,
        what_happened: i.what_happened,

        evidence: {
          observed: m.observed, baseline: m.baseline, unit: m.unit,
          lift: round(m.lift, 3),
          z: round(m.z, 2), p: m.p,
          n_recent: m.n_recent, n_base: m.n_base,
          affected_accounts: m.affected_accounts,
          detail: m.evidence,
        },

        why: {
          root_cause: i.why.root_cause,
          contributing_signals: i.why.contributing_signals,
          confidence: round(i.why.confidence, 3),
          confidence_parts: {
            statistical_strength: round(m.confidence_parts.statistical, 3),
            explained_by_top_driver: round(m.confidence_parts.explained, 3),
            corroborating_signals: round(m.confidence_parts.corroborated, 3),
            weights: { statistical: 0.45, explained: 0.30, corroborated: 0.25 },
          },
          decomposition_dimension: m.decomposition_dimension,
          decomposition: m.decomposition,
          onset_day: m.onset_day,
          correlated_event: m.correlated_event,
          caveat:
            'This is a hypothesis built by decomposition, not a proven cause. ' +
            (i.status === 'held_for_review'
              ? 'It is BELOW the 60% confidence cutoff and is held for review — say so.'
              : 'It cleared the 60% confidence cutoff.'),
        },

        recommended_action: { ...i.recommended_action, effort: m.effort, horizon_days: m.horizon_days, steps: m.steps },

        expected_impact: imp.low == null
          ? {
              type: i.expected_impact.type,
              costed: false,
              why_uncosted:
                'Deliberately not costed. A statutory deadline is a legal question, ' +
                'and a fabricated fine probability would be the least defensible ' +
                'number on the page. Do not estimate one.',
            }
          : {
              type: imp.type,
              costed: true,
              range_low_usd: usd(imp.low),
              range_high_usd: usd(imp.high),
              midpoint_usd: usd(i.expected_impact.revenue_at_risk_usd),
              time_horizon_days: imp.time_horizon_days,
              formula: imp.formula,
              inputs: imp.inputs,
              basis: imp.basis,
              note: imp.note,
              arithmetic_warning:
                'Inputs are rounded to display precision BEFORE the range is computed, ' +
                'so the printed inputs genuinely multiply out to the printed range. ' +
                'Quote the formula alongside the range; never quote a point estimate ' +
                'as if it were measured.',
            },

        severity: { score: i.severity_score, parts: m.severity_parts, urgency: round(m.urgency, 3) },
        series: m.series,
        provenance: m.provenance,
      };
    },
  },

  {
    name: 'search_evidence',
    description:
      'Retrieve the actual customer and agent text behind a pattern — ticket ' +
      'subjects and descriptions, NPS verbatims, QA reviewer notes. BM25 ranked. ' +
      'Every passage carries the id of the record it came from, so quotes stay ' +
      'attributable. Use this when the user asks what people are actually saying, ' +
      'or to corroborate an insight with primary text. It cannot tell you whether ' +
      'a change is statistically significant — that is what the insights are for.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, e.g. "refund window 30 days" or "onboarding setup confusing".' },
        kind: { type: 'string', enum: ['ticket', 'nps', 'qa'], description: 'Restrict to one record type.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Passages to return (default 8).' },
        from_day: { type: 'integer', description: 'Inclusive lower bound on day index (0–89).' },
        to_day: { type: 'integer', description: 'Inclusive upper bound on day index (0–89).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run(session, args) {
      const r = search(session.index, args.query, args);
      return {
        ...r,
        corpus_size: session.index.n,
        note:
          'Ranked by BM25 relevance, NOT by frequency — the number of passages ' +
          'returned is not evidence of how common a complaint is. For prevalence, ' +
          'use the insight evidence counts. Cite record_id when quoting.',
      };
    },
  },

  {
    name: 'get_metric_series',
    description:
      'Daily values for a top-level operational series across the full 90-day ' +
      'window, so you can describe a trend rather than assert one. Returns only ' +
      'series the dataset itself computes — this tool deliberately does not ' +
      're-slice the records with its own bucketing, because a second aggregation ' +
      'is how a tool answer starts disagreeing with the chart on screen.',
    inputSchema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['inflow', 'backlog', 'throughput', 'backlog_target'],
          description: 'inflow = tickets created/day; backlog = open at end of day; throughput = resolved/day.',
        },
        last_days: { type: 'integer', minimum: 1, maximum: 90, description: 'Return only the last N days.' },
      },
      required: ['metric'],
      additionalProperties: false,
    },
    run(session, args) {
      const { ds } = session;
      const full = ds.meta.series[args.metric];
      if (!full) {
        return { error: `Unknown metric ${args.metric}.`, available: Object.keys(ds.meta.series) };
      }
      const n = args.last_days ? Math.min(args.last_days, full.length) : full.length;
      const from = full.length - n;
      return {
        metric: args.metric,
        days: n,
        from_day: from,
        to_day: full.length - 1,
        labels: Array.from({ length: n }, (_, k) => dayLabel(ds, from + k)),
        values: full.slice(from),
        first: full[from],
        last: full[full.length - 1],
        change: round(full[full.length - 1] - full[from], 2),
      };
    },
  },

  {
    name: 'get_health',
    description:
      'The operations health score and its four risk dimensions, each with the ' +
      'drivers that moved it, their weights and their targets. Use this for ' +
      '"how are we doing overall" — the drivers are what make the score ' +
      'explainable rather than a number to be trusted on faith.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run(session) {
      const h = session.engine.health;
      return {
        score: h.score,
        delta: h.delta,
        window: h.window,
        dimensions: h.dimensions,
        note: 'Every dimension score is built from the weighted drivers listed under it; cite the drivers, not just the score.',
      };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Execute a tool by name. Throws only on unknown tool; tool-level problems
    come back as a normal result with an `error` field so a model can read and
    recover from them rather than seeing a protocol failure. */
export function callTool(session, name, args = {}) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    const err = new Error(`Unknown tool: ${name}`);
    err.code = -32601;
    throw err;
  }
  return tool.run(session, args || {});
}
