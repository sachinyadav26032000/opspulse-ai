/* ==========================================================================
   app.html's data layer — the same operation, in the shapes app.js renders.
   --------------------------------------------------------------------------
   app.html was built before the engine existed. It carried its own seeded PRNG
   and five hand-written risk objects, so it was a fourth surface whose numbers
   agreed with nothing: the churn card said "6 accounts / $180–340k" no matter
   what the dataset said, and its "live" ticker invented events that had never
   happened.

   Nothing here changes how that screen LOOKS. Every renderer in app.js is
   untouched; this module just supplies what those renderers used to hard-code,
   read from the same store NorthDesk and OpsPulse read. The insight contract
   (engine/web/schema.js) already carries every field the old literals had —
   what happened, why, what it is worth, what to do — because both were written
   against the same four questions. This is the adapter between them, and where
   a field genuinely has no counterpart it is derived from the record and
   commented, not invented.
   ========================================================================== */

import { computeHealth } from '../engine/web/health.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/* Resolution time is generated lognormal and behaves like it: across a full
   dataset the mean is ~49h and the median ~3h, because a handful of 300-hour
   tickets drag the average somewhere no actual ticket lives. Every
   time-to-resolve figure on this screen is therefore a median. */
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Day index a ticket was CLOSED on — see the note in buildAnalytics. */
const resolveDay = (ds, t) => Math.floor((t.resolved_at - ds.meta.day0) / 86400000);
const money = (n) => (n >= 1000 ? '$' + Math.round(n / 1000) + 'k' : '$' + Math.round(n));
const pct = (n) => Math.round(n * 100);

/** "12m ago" — the feed's age column, from the insight's own timestamp. */
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
}

/* app.js keys its action handler off `ic`, and the icon decides what pressing
   the button does (escalate / assign / coach / queue a workflow). Mapping it
   from the signal type keeps the button's behaviour matched to the insight
   rather than to its position in a list. */
const PRIMARY_IC = {
  churn_risk: 'esc', escalation_spike: 'esc', sla_risk: 'esc',
  coaching_gap: 'coach', nps_drop: 'survey', csat_drop: 'flow',
  backlog_risk: 'assign', compliance_risk: 'esc', emerging_topic: 'flow',
};
const STEP_IC = ['flow', 'coach', 'assign', 'flow'];

/** Which system a corroborating signal came out of — for the little src chip. */
const SIGNAL_SRC = {
  nps_drop: 'Survey', coaching_gap: 'QA', csat_drop: 'Survey',
  compliance_risk: 'Tickets', churn_risk: 'Accounts',
};

/**
 * One engine insight → one app.js risk object.
 * The four questions map field-for-field; only `priority` needs arithmetic,
 * because app.js ranks on an ANNUALIZED figure and the engine costs each
 * insight over its own horizon (30 days for a cost-to-serve leak, 90 for
 * revenue at risk). Comparing them without annualising would rank a 90-day
 * total above a 30-day one that is three times worse per year.
 */
export function riskFromInsight(ins) {
  const m = ins._meta;
  const ei = ins.expected_impact;
  const costed = ei.range_low_usd != null && ei.range_high_usd != null;
  const horizon = ei.time_horizon_days || 30;
  const midpoint = costed ? (ei.range_low_usd + ei.range_high_usd) / 2 : 0;
  const annualK = Math.round((midpoint * (365 / horizon)) / 1000);

  const sev = ins.severity_score >= 70 ? 'high' : ins.severity_score >= 45 ? 'medium' : 'low';
  const held = ins.status === 'held_for_review';

  return {
    id: ins.insight_id, iid: ins.insight_id,
    sev, score: ins.severity_score,
    title: m.title,
    owner: 'Unassigned',
    team: ins.recommended_action.owner_role,
    age: ago(ins.generated_at),
    metric: m.metric_label,
    whatHappened: ins.what_happened,
    why: {
      confidence: ins.why.confidence,
      hypothesis: ins.why.root_cause,
      note: held
        ? `Below the ${pct(0.6)}% confidence cutoff — held for review, never auto-actioned.`
        : 'Correlation, not a confirmed cause — verify before it drives an executive action.',
    },
    impact: {
      costed,
      value: costed ? `${money(ei.range_low_usd)} – ${money(ei.range_high_usd)}` : '',
      type: (ei.type || '').replace(/_/g, ' '),
      horizon: `${horizon}-day window`,
      formula: m.impact?.formula || '',
      // Shown instead of a dollar figure when the engine refuses to price something.
      note: m.impact?.note || 'Deliberately uncosted.',
    },
    rec: { owner: ins.recommended_action.owner_role, playbook: ins.recommended_action.playbook_id },
    priority: {
      annualK,
      urgencyDays: horizon,
      impactLabel: costed ? `$${annualK}k/yr` : 'uncosted',
      urgencyLabel: `${horizon}-day window`,
      rationale: costed
        ? `${m.metric_label}. Costed at ${money(ei.range_low_usd)}–${money(ei.range_high_usd)} over ${horizon} days — ${'$' + annualK}k annualized — at ${pct(ins.why.confidence)}% confidence.`
        : `${m.metric_label}. Left uncosted on purpose, so it ranks on severity and confidence alone (${pct(ins.why.confidence)}%).`,
    },
    /* `hit` is the engine's boolean: the corroborating check either fired or it
       did not. Rendering it as a two-state bar is the honest width — a
       continuous-looking value here would imply a precision the check has no
       claim to. */
    signals: (ins.why.contributing_signals || []).slice(0, 4).map((s) => ({
      src: SIGNAL_SRC[ins.signal_type] || 'Tickets',
      label: s.detail ? `${s.label} — ${s.detail}` : s.label,
      w: s.hit ? 88 : 32,
    })),
    actions: (m.steps || []).slice(0, 3).map((step, i) => ({
      ic: i === 0 ? (PRIMARY_IC[ins.signal_type] || 'flow') : STEP_IC[i % STEP_IC.length],
      t: step,
      s: i === 0
        ? `${ins.recommended_action.owner_role} · ${m.effort || 'medium'} effort · ${horizon}-day horizon`
        : `Playbook ${ins.recommended_action.playbook_id} · step ${i + 1}`,
      rec: i === 0 && !held,          // nothing held for review is presented as the AI's pick
    })),
  };
}

/** Health scored over nine trailing 7-day windows — a real series, not a curve. */
function healthSeries(ds, points = 9) {
  const last = ds.meta.days - 1;
  const out = [];
  for (let i = points - 1; i >= 0; i--) {
    const to = last - i;
    out.push(computeHealth(ds, Math.max(0, to - 6), to).score);
  }
  return out;
}

/** Per-day statistic over the last n days, for the KPI sparklines. */
function daily(rows, ds, n, dayOf, valueOf, stat = mean) {
  const last = ds.meta.days - 1;
  const out = [];
  for (let d = last - n + 1; d <= last; d++) {
    const vals = rows.filter((r) => dayOf(r) === d).map(valueOf).filter((v) => v != null && !Number.isNaN(v));
    out.push(vals.length ? stat(vals) : (out[out.length - 1] ?? 0));
  }
  return out;
}

export function buildModel(store) {
  const ds = store.dataset;
  const eng = store.engine;
  const h = eng.health;
  /* Outcome metrics are measured over tickets CLOSED in the window, not tickets
     OPENED in it. Of the tickets opened in the last fortnight, only the ones
     already closed have an SLA result or a rating — and those skew fast and
     happy, so "opened in the window" would flatter every one of these numbers. */
  const closed = ds.tickets.filter((t) => t.resolved_at != null && resolveDay(ds, t) >= ds.meta.recent_from);
  const rated = closed.filter((t) => t.customer_satisfaction_rating != null);

  const csat = rated.length ? (mean(rated.map((t) => t.customer_satisfaction_rating)) / 5) * 100 : 0;
  const slaOk = closed.length ? (closed.filter((t) => !t.sla_breached).length / closed.length) * 100 : 100;
  const medRes = closed.length ? median(closed.map((t) => t.time_to_resolution_hrs)) : 0;
  const allClosed = ds.tickets.filter((t) => t.resolved_at != null);

  const risks = eng.insights.map(riskFromInsight);

  const kpis = [
    { k: 'Org Health', id: 'kHealth', v: String(h.score), d: `${h.delta >= 0 ? '+' : ''}${h.delta} vs prior`, up: h.delta >= 0, spark: healthSeries(ds) },
    { k: 'CSAT · recent', id: 'kCsat', v: csat.toFixed(0) + '%', d: `${rated.length} rated`, up: csat >= 80,
      spark: daily(rated, ds, 9, (t) => resolveDay(ds, t), (t) => t.customer_satisfaction_rating * 20) },
    { k: 'SLA Compliance', id: 'kSla', v: slaOk.toFixed(0) + '%', d: `${closed.length} closed`, up: slaOk >= 90,
      spark: daily(allClosed, ds, 9, (t) => resolveDay(ds, t), (t) => (t.sla_breached ? 0 : 100)) },
    { k: 'Open Risks', id: 'kRisks', v: String(risks.length), d: `${risks.filter((r) => r.sev === 'high').length} high`, up: false,
      spark: healthSeries(ds).map((v) => 100 - v) },
    // Labelled median, because it IS the median — see the note on `median`.
    { k: 'Median Resolution', id: 'kRes', v: medRes.toFixed(1) + 'h', d: `${ds.meta.days - ds.meta.recent_from}d median`, up: medRes < 6,
      spark: daily(allClosed, ds, 9, (t) => resolveDay(ds, t), (t) => t.time_to_resolution_hrs, median) },
  ];

  /* The connector rail. The names are the SaaS tools a desk like this actually
     runs on; the counts are records really present in the dataset, so the
     rail moves when the simulator moves instead of drifting on a timer. */
  const byChannel = (c) => ds.tickets.filter((t) => t.ticket_channel === c).length;
  const sources = [
    { name: 'Zendesk', meta: 'Ticketing', ic: 'ticket', base: ds.tickets.length },
    { name: 'Aircall', meta: 'Call transcripts', ic: 'phone', base: byChannel('Phone') },
    { name: 'Klaus QA', meta: 'Quality reviews', ic: 'qa', base: ds.qa.length },
    { name: 'Delighted', meta: 'NPS / CSAT surveys', ic: 'survey', base: ds.nps.length },
    { name: 'Intercom', meta: 'Live chat', ic: 'chat', base: byChannel('Chat') },
  ];

  const PALETTE = ['#34d399', '#22d3ee', '#fbbf24', '#fb7185', '#a78bfa'];
  // Colour follows RANK, not name, so the bar palette reads best→worst.
  const teams = [...new Set(ds.qa.map((q) => q.team))]
    .map((name) => {
      const rows = ds.qa.filter((q) => q.team === name);
      return { name, score: Math.round(mean(rows.map((q) => q.overall_score))) };
    })
    .sort((a, b) => b.score - a.score)
    .map((t, i) => ({ ...t, color: PALETTE[i % PALETTE.length] }));

  return {
    risks, kpis, sources, teams,
    health: h.score,
    prevHealth: h.score - h.delta,
    today: new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      + ' · ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
}

/* Colour per event kind, matching the old ticker's palette so the rail looks
   the same — the difference is that these rows are events that happened. */
const TICK_COLOR = { ticket: '#38bdf8', resolved: '#34d399', escalation: '#fb7185', nps: '#fbbf24', qa: '#a78bfa', upload: '#22d3ee' };
const TICK_SRC = { ticket: 'Tickets', resolved: 'Tickets', escalation: 'Calls', nps: 'Survey', qa: 'QA', upload: 'Upload' };

/** The live rail, straight off the store's event feed. */
export function tickRows(store, n = 7) {
  return store.feed.slice(0, n).map((f) => ({
    src: TICK_SRC[f.kind] || 'Tickets',
    txt: f.text,
    c: TICK_COLOR[f.kind] || '#38bdf8',
    at: f.at,
  }));
}

/* ── Analytics view ───────────────────────────────────────────────────────
   assets/analytics.js is pure chart rendering around one data function. This
   is that function, computed instead of simulated: same keys, same lengths,
   so every chart on the screen keeps its shape. */
/**
 * What the analytics view is allowed to ask for. The dataset is 90 days ending
 * today, so a date picker has to be clamped to that — offering January when the
 * data starts in April produces an empty chart and no explanation.
 */
/* `toISOString()` is UTC, and every date the charts render is LOCAL. East of
   Greenwich those disagree by a day at the boundary, which showed up as a
   picker whose maximum was the day before the last point on the chart. */
const isoLocal = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Local midnight of the day a timestamp falls in. */
const midnight = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function analyticsBounds(store) {
  const ds = store.dataset;
  return {
    days: ds.meta.days,
    minDate: isoLocal(ds.meta.day0),
    maxDate: isoLocal(ds.meta.day0 + (ds.meta.days - 1) * 86400000),
  };
}

/** Calendar date (YYYY-MM-DD or ms) → the day index it falls on, clamped. */
export function dayIndexOf(store, date) {
  const ds = store.dataset;
  const ms = typeof date === 'number' ? date : Date.parse(date + 'T00:00:00');
  if (Number.isNaN(ms)) return null;
  // Round, not floor: across a DST change the two midnights are 23 or 25 hours
  // apart and flooring would silently drop a day.
  const d = Math.round((midnight(ms) - midnight(ds.meta.day0)) / 86400000);
  return Math.max(0, Math.min(ds.meta.days - 1, d));
}

/**
 * @param {number|{from:number,to:number}} range  a trailing day count (7/30/90)
 *        or an explicit inclusive window of day indices, for a custom range.
 */
export function buildAnalytics(store, range) {
  const ds = store.dataset;
  const lastDay = ds.meta.days - 1;

  let from, to;
  if (range && typeof range === 'object') {
    from = Math.max(0, Math.min(lastDay, range.from));
    to = Math.max(0, Math.min(lastDay, range.to));
    if (from > to) [from, to] = [to, from];        // dates picked back-to-front
  } else {
    to = lastDay;
    from = Math.max(0, lastDay - (Number(range) || 30) + 1);
  }
  const days = to - from + 1;

  const span = [];
  for (let d = from; d <= to; d++) span.push(d);

  const dayTickets = span.map((d) => ds.tickets.filter((t) => t.day_index === d));
  const dayNps = span.map((d) => ds.nps.filter((r) => r.day_index === d));

  /* Resolution-quality metrics are bucketed by the day a ticket was RESOLVED,
     not the day it was opened. Bucketing them by creation day looks natural and
     is quietly wrong at the recent end: of the tickets opened yesterday, only
     the ones already closed have an SLA outcome — and those are the fast ones.
     The chart then shows SLA compliance climbing toward today on every dataset,
     which is an artifact of who has finished, not a trend. */
  const closedIndex = new Map(span.map((d) => [d, []]));
  for (const t of ds.tickets) {
    if (t.resolved_at == null) continue;
    const d = resolveDay(ds, t);
    if (closedIndex.has(d)) closedIndex.get(d).push(t);
  }
  const dayClosed = span.map((d) => closedIndex.get(d));

  const labels = span.map((d, i) => {
    const dt = new Date(ds.meta.day0 + d * 86400000);
    const show = days <= 7 || i === 0 || i === span.length - 1 || i % Math.ceil(span.length / 6) === 0;
    return show ? dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  });

  const carry = (arr, fallback) => {
    let prev = fallback;
    return arr.map((v) => { if (v == null || Number.isNaN(v)) return prev; prev = v; return v; });
  };

  const csat = carry(dayClosed.map((ts) => {
    const r = ts.filter((t) => t.customer_satisfaction_rating != null);
    return r.length ? (mean(r.map((t) => t.customer_satisfaction_rating)) / 5) * 100 : null;
  }), 80);

  /* NPS on a 7-day trailing window, not per day. A day carries 6–18 responses
     here, and a single day's score off that many swings ±70 points — the line
     would be noise drawn over the top of the 18-point decline it exists to
     show. Trailing windows are also how NPS is actually reported. */
  const nps = span.map((d) => {
    const rs = ds.nps.filter((r) => r.day_index > d - 7 && r.day_index <= d);
    if (!rs.length) return null;
    const p = rs.filter((r) => r.score >= 9).length, det = rs.filter((r) => r.score <= 6).length;
    return ((p - det) / rs.length) * 100;
  });
  const npsSeries = carry(nps, 30);

  const sla = carry(dayClosed.map((ts) => (
    ts.length ? (ts.filter((t) => !t.sla_breached).length / ts.length) * 100 : null
  )), 95);

  const handle = carry(dayClosed.map((ts) => {
    const r = ts.filter((t) => t.time_to_resolution_hrs != null);
    return r.length ? median(r.map((t) => t.time_to_resolution_hrs)) : null;
  }), 5);

  // The old view's five "channels" were sources, not ticket channels; keep the
  // same five lanes but fill them with the records each one really produced.
  const chanKeys = ['Tickets', 'Calls', 'Chat', 'Survey', 'QA'];
  const channels = {
    Tickets: dayTickets.map((ts) => ts.length),
    Calls: dayTickets.map((ts) => ts.filter((t) => t.ticket_channel === 'Phone').length),
    Chat: dayTickets.map((ts) => ts.filter((t) => t.ticket_channel === 'Chat').length),
    Survey: dayNps.map((rs) => rs.length),
    QA: span.map((d) => ds.qa.filter((q) => q.day_index === d).length),
  };

  /* Risk mix — the engine's own insights, weighted by severity, so the donut
     is a picture of what the decision feed is actually carrying. */
  const GROUP = {
    churn_risk: 'Churn risk', nps_drop: 'Churn risk',
    csat_drop: 'CSAT / quality', coaching_gap: 'Coaching gap',
    sla_risk: 'SLA breach', backlog_risk: 'SLA breach',
    escalation_spike: 'CSAT / quality', compliance_risk: 'Other signals',
    emerging_topic: 'Other signals',
  };
  const mix = new Map();
  for (const i of store.engine.insights) {
    const k = GROUP[i.signal_type] || 'Other signals';
    mix.set(k, (mix.get(k) || 0) + i.severity_score);
  }
  const mixTotal = [...mix.values()].reduce((a, b) => a + b, 0) || 1;
  const riskMix = [...mix.entries()]
    .map(([label, v]) => ({ label, value: Math.round((v / mixTotal) * 100) }))
    .sort((a, b) => b.value - a.value);

  const EDGES = [[0, 1], [1, 2], [2, 4], [4, 8], [8, 24], [24, Infinity]];
  const EDGE_LABELS = ['<1h', '1–2h', '2–4h', '4–8h', '8–24h', '>24h'];
  // Bounded at BOTH ends — with a custom range the window no longer runs to today.
  const resolvedAll = ds.tickets.filter((t) => t.time_to_resolution_hrs != null && t.day_index >= from && t.day_index <= to);
  const resBuckets = EDGES.map(([lo, hi], i) => ({
    label: EDGE_LABELS[i],
    value: resolvedAll.filter((t) => t.time_to_resolution_hrs >= lo && t.time_to_resolution_hrs < hi).length,
  }));

  /* Sentiment heat: 7 days × 12 two-hour buckets, scored from the CSAT ratings
     that landed in each bucket, mapped 1–5 → −1..1. Empty buckets read 0 —
     "no signal" rather than a number nobody submitted. */
  const heat = [];
  for (let d = 6; d >= 0; d--) {
    const dayIdx = to - d;                 // last 7 days OF THE WINDOW, not of the dataset
    const rows = ds.tickets.filter((t) => t.day_index === dayIdx && t.customer_satisfaction_rating != null);
    const row = [];
    for (let b = 0; b < 12; b++) {
      const inBucket = rows.filter((t) => { const hr = new Date(t.created_at).getHours(); return hr >= b * 2 && hr < b * 2 + 2; });
      row.push(inBucket.length ? (mean(inBucket.map((t) => t.customer_satisfaction_rating)) - 3) / 2 : 0);
    }
    heat.push(row);
  }

  const DIMS = ['greeting', 'accuracy', 'empathy', 'policy_adherence', 'resolution', 'compliance'];
  const qaDims = ['Greeting', 'Accuracy', 'Empathy', 'Policy', 'Resolution', 'Compliance'];
  const cohort = (c) => {
    const rows = ds.qa.filter((q) => q.cohort === c);
    return DIMS.map((k) => Math.round(mean(rows.map((q) => q.dimensions[k]))));
  };
  const qaTeams = [
    { name: 'Tenured agents', color: '#3987e5', vals: cohort('tenured') },
    { name: 'New-hire cohort', color: '#d95926', vals: cohort('new_hire') },
  ];

  const scoreBy = new Map();
  for (const q of ds.qa) {
    if (!scoreBy.has(q.agent_id)) scoreBy.set(q.agent_id, []);
    scoreBy.get(q.agent_id).push(q.overall_score);
  }
  const agents = [...scoreBy.entries()]
    .map(([id, xs]) => ({ name: ds.agents.find((a) => a.agent_id === id)?.name || id, score: Math.round(mean(xs)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return { labels, csat, nps: npsSeries, sla, handle, channels, chanKeys, riskMix, resBuckets, heat, qaDims, qaTeams, agents };
}
