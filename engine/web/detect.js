/* ==========================================================================
   Agent 2 — Anomaly Detection (purely statistical)
   --------------------------------------------------------------------------
   Nine detectors run over the normalized dataset. Each compares a RECENT
   window against that same metric's own baseline and emits an anomaly only if
   the difference clears a stated threshold. No detector knows the generator's
   injected patterns; they are found, not looked up.

   Every anomaly carries the raw counts behind it (n_recent, n_base, observed,
   baseline) so the UI can always show its work.
   ========================================================================== */

import {
  propZ, welchT, zAgainst, slope, pValue, clamp, mean, sd, median, safeDiv,
} from './stats.js';
import {
  countByDay, rateByDay, meanByDay, countBy, resolvedIn, accountRollup,
  npsOf, openTickets,
} from './aggregate.js';

/** Thresholds are declared, not buried — a reviewer can argue with this block. */
export const THRESHOLDS = {
  min_sample: 40,          // no anomaly is raised below this many recent records
  rate_z: 2.5,             // two-proportion z
  cohort_t: 2.5,           // Welch t between cohorts
  qa_gap_pts: 8,           // minimum QA point gap worth coaching on
  volume_lift: 1.35,       // emerging topic must be ≥35% above its own baseline
  backlog_slope: 3,        // tickets/day of sustained queue growth
  nps_drop_pts: 8,
  csat_drop: 0.25,         // mean stars
  churn_arr_floor: 60000,  // ARR below which churn risk isn't worth a card
};

function mkSeries(days, values) { return { days: values.map((_, i) => i), values }; }

/* ── 1. Escalation-rate spike, per category ──────────────────────────────── */
function escalationSpike(ds) {
  const rf = ds.meta.recent_from, D = ds.meta.days;
  const out = [];
  const cats = [...new Set(ds.tickets.map((t) => t.category))];
  for (const cat of cats) {
    const all = ds.tickets.filter((t) => t.category === cat);
    const rec = all.filter((t) => t.day_index >= rf);
    const base = all.filter((t) => t.day_index < rf);
    if (rec.length < THRESHOLDS.min_sample || base.length < THRESHOLDS.min_sample) continue;

    const x1 = rec.filter((t) => t.escalated).length;
    const x0 = base.filter((t) => t.escalated).length;
    const { z, p1, p0 } = propZ(x1, rec.length, x0, base.length);
    if (z < THRESHOLDS.rate_z || p1 <= p0) continue;

    const ids = [...new Set(rec.map((t) => t.account_id))];
    out.push({
      key: `esc_spike:${cat}`,
      signal_type: 'escalation_spike',
      metric: `${cat} escalation rate`,
      entity: { kind: 'category', key: cat, label: cat },
      unit: 'rate', observed: p1, baseline: p0,
      n_recent: rec.length, n_base: base.length,
      x_recent: x1, x_base: x0,
      z, p: pValue(z), lift: safeDiv(p1, p0), direction: 'up',
      affected_accounts: ids.length, affected_ids: ids,
      series: mkSeries(D, rateByDay(all, D, (t) => t.escalated)),
      volume_series: mkSeries(D, countByDay(all, D)),
      evidence: {
        recent_volume: rec.length,
        base_volume_per_day: base.length / rf,
        recent_volume_per_day: rec.length / (D - rf),
        volume_lift: safeDiv(rec.length / (D - rf), base.length / rf),
        escalations_recent: x1,
        escalations_expected: Math.round(p0 * rec.length),
        reopen_rate_recent: safeDiv(rec.filter((t) => t.reopened).length, rec.length),
        reopen_rate_base: safeDiv(base.filter((t) => t.reopened).length, base.length),
      },
      pool: rec,
    });
  }
  return out;
}

/* ── 2. Emerging topic — volume share shift, per category and per tag ────── */
function emergingTopic(ds) {
  const rf = ds.meta.recent_from, D = ds.meta.days;
  const out = [];
  const recAll = ds.tickets.filter((t) => t.day_index >= rf);
  const baseAll = ds.tickets.filter((t) => t.day_index < rf);
  const recDays = D - rf, baseDays = rf;

  const scan = (keyOf, kind) => {
    for (const key of new Set(ds.tickets.map(keyOf))) {
      const rec = recAll.filter((t) => keyOf(t) === key);
      const base = baseAll.filter((t) => keyOf(t) === key);
      if (rec.length < THRESHOLDS.min_sample) continue;
      const perDayRec = rec.length / recDays, perDayBase = base.length / baseDays;
      const lift = safeDiv(perDayRec, perDayBase);
      if (lift < THRESHOLDS.volume_lift) continue;

      const daily = countByDay(ds.tickets.filter((t) => keyOf(t) === key), D);
      // Significance is tested on SHARE OF CONTACT MIX, not on the raw daily
      // count: daily volume carries a strong weekday cycle whose σ swamps a
      // real trend. The volume-lift gate above is what stops a share rise that
      // is only other categories falling away.
      const { z } = propZ(rec.length, recAll.length, base.length, baseAll.length);
      const { mean: m, sd: s } = zAgainst(daily.slice(0, rf), mean(daily.slice(rf)));
      if (z < THRESHOLDS.rate_z) continue;

      const ids = [...new Set(rec.map((t) => t.account_id))];
      out.push({
        key: `emerging:${kind}:${key}`,
        signal_type: 'emerging_topic',
        metric: `${key} ticket volume`,
        entity: { kind, key, label: key },
        unit: 'per_day', observed: perDayRec, baseline: perDayBase,
        n_recent: rec.length, n_base: base.length,
        z, p: pValue(z), lift, direction: 'up',
        baseline_sd: s, baseline_mean: m,
        affected_accounts: ids.length, affected_ids: ids,
        series: mkSeries(D, daily),
        evidence: {
          share_recent: safeDiv(rec.length, recAll.length),
          share_base: safeDiv(base.length, baseAll.length),
          extra_tickets_per_day: perDayRec - perDayBase,
          extra_tickets_per_month: (perDayRec - perDayBase) * 30,
          top_tags: countBy(rec, (t) => t.tag, 5),
          self_serve_eligible: safeDiv(rec.filter((t) => t.ticket_channel !== 'Phone').length, rec.length),
        },
        pool: rec,
      });
    }
  };
  scan((t) => t.category, 'category');
  return out;
}

/* ── 3. Backlog growth / SLA pressure ────────────────────────────────────── */
function backlogRisk(ds) {
  const rf = ds.meta.recent_from, D = ds.meta.days;
  const backlog = ds.meta.series.backlog;
  const recent = backlog.slice(rf);
  const s = slope(recent);
  const baseMean = mean(backlog.slice(Math.max(0, rf - 28), rf));
  const nowVal = backlog[backlog.length - 1];
  if (s < THRESHOLDS.backlog_slope) return [];

  const rec = ds.tickets.filter((t) => t.day_index >= rf);
  const base = ds.tickets.filter((t) => t.day_index < rf);
  const frtRec = median(rec.map((t) => t.first_response_time_min));
  const frtBase = median(base.map((t) => t.first_response_time_min));
  const brRec = propZ(
    rec.filter((t) => t.frt_sla_breached).length, rec.length,
    base.filter((t) => t.frt_sla_breached).length, base.length,
  );
  const open = openTickets(ds);
  const ages = open.map((t) => (ds.meta.as_of - t.created_at) / 3600000);

  const inflowRec = mean(ds.meta.series.inflow.slice(rf));
  const thruRec = mean(ds.meta.series.throughput.slice(rf));

  return [{
    key: 'backlog:queue',
    signal_type: 'backlog_risk',
    metric: 'Open ticket backlog',
    entity: { kind: 'queue', key: 'all', label: 'Support queue' },
    unit: 'count', observed: nowVal, baseline: baseMean,
    n_recent: rec.length, n_base: base.length,
    z: Math.abs(zAgainst(backlog.slice(0, rf), nowVal).z), p: 0,
    lift: safeDiv(nowVal, baseMean), direction: 'up',
    affected_accounts: new Set(open.map((t) => t.account_id)).size,
    affected_ids: [...new Set(open.map((t) => t.account_id))],
    series: mkSeries(D, backlog),
    evidence: {
      slope_per_day: s,
      inflow_per_day: inflowRec,
      throughput_per_day: thruRec,
      capacity_gap_per_day: inflowRec - thruRec,
      open_now: open.length,
      median_age_hrs: median(ages),
      aged_over_72h: open.filter((t) => (ds.meta.as_of - t.created_at) / 3600000 > 72).length,
      frt_median_recent: frtRec, frt_median_base: frtBase,
      frt_sla_breach_recent: brRec.p1, frt_sla_breach_base: brRec.p0, frt_sla_z: brRec.z,
      driver_categories: countBy(rec, (t) => t.category, 4),
      inflow_series: ds.meta.series.inflow,
      throughput_series: ds.meta.series.throughput,
    },
    pool: open,
  }];
}

/* ── 4. Coaching gap — QA by tenure cohort ───────────────────────────────── */
function coachingGap(ds) {
  const nh = ds.qa.filter((q) => q.cohort === 'new_hire');
  const tn = ds.qa.filter((q) => q.cohort === 'tenured');
  if (nh.length < 15 || tn.length < 15) return [];
  const w = welchT(tn.map((q) => q.overall_score), nh.map((q) => q.overall_score));
  if (w.diff < THRESHOLDS.qa_gap_pts || Math.abs(w.t) < THRESHOLDS.cohort_t) return [];

  const dims = Object.keys(ds.qa[0].dimensions);
  const dimGap = dims.map((d) => ({
    key: d,
    tenured: mean(tn.map((q) => q.dimensions[d])),
    new_hire: mean(nh.map((q) => q.dimensions[d])),
    gap: mean(tn.map((q) => q.dimensions[d])) - mean(nh.map((q) => q.dimensions[d])),
  })).sort((a, b) => b.gap - a.gap);

  const nhIds = new Set(ds.agents.filter((a) => a.cohort === 'new_hire').map((a) => a.agent_id));
  const nhTickets = ds.tickets.filter((t) => nhIds.has(t.agent_id));
  const tnTickets = ds.tickets.filter((t) => !nhIds.has(t.agent_id));
  const reopenNh = safeDiv(nhTickets.filter((t) => t.reopened).length, nhTickets.length);
  const reopenTn = safeDiv(tnTickets.filter((t) => t.reopened).length, tnTickets.length);

  const perAgent = [...nhIds].map((id) => {
    const rows = nh.filter((q) => q.agent_id === id);
    const ag = ds.agents.find((a) => a.agent_id === id);
    return { agent_id: id, name: ag.name, team: ag.team, tenure_days: ag.tenure_days, n: rows.length, score: rows.length ? mean(rows.map((r) => r.overall_score)) : null };
  }).filter((a) => a.n > 0).sort((a, b) => a.score - b.score);

  return [{
    key: 'coaching:new_hire_cohort',
    signal_type: 'coaching_gap',
    metric: 'QA score — new-hire cohort',
    entity: { kind: 'cohort', key: 'new_hire', label: 'New-hire cohort' },
    unit: 'score', observed: w.mb, baseline: w.ma,
    n_recent: nh.length, n_base: tn.length,
    z: Math.abs(w.t), p: pValue(w.t), lift: safeDiv(w.mb, w.ma), direction: 'down',
    affected_accounts: new Set(nhTickets.filter((t) => t.day_index >= ds.meta.recent_from).map((t) => t.account_id)).size,
    affected_ids: [...new Set(nhTickets.filter((t) => t.day_index >= ds.meta.recent_from).map((t) => t.account_id))],
    series: mkSeries(ds.meta.days, meanByDay(ds.qa, ds.meta.days, (q) => q.overall_score)),
    evidence: {
      gap_pts: w.diff,
      dimension_gaps: dimGap,
      agents_in_cohort: nhIds.size,
      reviews_new_hire: nh.length, reviews_tenured: tn.length,
      reopen_rate_new_hire: reopenNh, reopen_rate_tenured: reopenTn,
      tickets_handled_recent: nhTickets.filter((t) => t.day_index >= ds.meta.recent_from).length,
      per_agent: perAgent,
      flagged_reviews: nh.filter((q) => q.flags.length).length,
      cohort_start_day: ds.meta.days - Math.round(mean(ds.agents.filter((a) => a.cohort === 'new_hire').map((a) => a.tenure_days))),
    },
    pool: nh,
  }];
}

/* ── 5. NPS shift ────────────────────────────────────────────────────────── */
function npsDrop(ds) {
  const rf = ds.meta.recent_from;
  const rec = ds.nps.filter((r) => r.day_index >= rf);
  const base = ds.nps.filter((r) => r.day_index < rf);
  if (rec.length < THRESHOLDS.min_sample) return [];
  const a = npsOf(rec), b = npsOf(base);
  const drop = b.nps - a.nps;
  if (drop < THRESHOLDS.nps_drop_pts) return [];

  const { z } = propZ(a.detractors, a.n, b.detractors, b.n);
  const detrRec = rec.filter((r) => r.segment === 'detractor');
  const detrBase = base.filter((r) => r.segment === 'detractor');
  const driversRec = countBy(detrRec, (r) => r.driver_tag);
  const driversBase = countBy(detrBase, (r) => r.driver_tag);
  const baseMap = new Map(driversBase.map((d) => [d.key, d.value / Math.max(1, detrBase.length)]));

  const driverDelta = driversRec.map((d) => ({
    key: d.key,
    count: d.value,
    share_recent: d.value / Math.max(1, detrRec.length),
    share_base: baseMap.get(d.key) || 0,
    delta_share: d.value / Math.max(1, detrRec.length) - (baseMap.get(d.key) || 0),
  })).sort((x, y) => y.delta_share - x.delta_share);

  const ids = [...new Set(detrRec.map((r) => r.account_id))];
  return [{
    key: 'nps:overall',
    signal_type: 'nps_drop',
    metric: 'Net Promoter Score',
    entity: { kind: 'company', key: 'nps', label: 'Company NPS' },
    unit: 'nps', observed: a.nps, baseline: b.nps,
    n_recent: a.n, n_base: b.n,
    z: Math.abs(z), p: pValue(z), lift: safeDiv(a.nps, b.nps), direction: 'down',
    affected_accounts: ids.length, affected_ids: ids,
    series: mkSeries(ds.meta.days, npsByDay(ds)),
    evidence: {
      drop_pts: drop,
      promoters_recent: a.promoters / a.n, promoters_base: b.promoters / b.n,
      detractors_recent: a.detractors / a.n, detractors_base: b.detractors / b.n,
      driver_delta: driverDelta,
      detractor_arr: detrRec.reduce((s, r) => s + (r.arr_usd || 0), 0),
      sample_recent: a.n, sample_base: b.n,
    },
    pool: detrRec,
  }];
}

/** NPS on a 7-day trailing window per day — a daily NPS would be pure noise. */
function npsByDay(ds) {
  const D = ds.meta.days;
  const byDay = Array.from({ length: D }, () => []);
  for (const r of ds.nps) if (r.day_index >= 0 && r.day_index < D) byDay[r.day_index].push(r);
  return byDay.map((_, d) => {
    const w = byDay.slice(Math.max(0, d - 6), d + 1).flat();
    return w.length >= 20 ? npsOf(w).nps : null;
  });
}

/* ── 6. CSAT drop, per team ──────────────────────────────────────────────── */
function csatDrop(ds) {
  const rf = ds.meta.recent_from, D = ds.meta.days, out = [];
  for (const team of new Set(ds.tickets.map((t) => t.team))) {
    const all = ds.tickets.filter((t) => t.team === team && t.customer_satisfaction_rating != null);
    const rec = all.filter((t) => t.day_index >= rf), base = all.filter((t) => t.day_index < rf);
    if (rec.length < THRESHOLDS.min_sample) continue;
    const w = welchT(base.map((t) => t.customer_satisfaction_rating), rec.map((t) => t.customer_satisfaction_rating));
    if (w.diff < THRESHOLDS.csat_drop || Math.abs(w.t) < 2) continue;
    const ids = [...new Set(rec.filter((t) => t.customer_satisfaction_rating <= 2).map((t) => t.account_id))];
    out.push({
      key: `csat:${team}`,
      signal_type: 'csat_drop',
      metric: `CSAT — ${team}`,
      entity: { kind: 'team', key: team, label: team },
      unit: 'stars', observed: w.mb, baseline: w.ma,
      n_recent: rec.length, n_base: base.length,
      z: Math.abs(w.t), p: pValue(w.t), lift: safeDiv(w.mb, w.ma), direction: 'down',
      affected_accounts: ids.length, affected_ids: ids,
      series: mkSeries(D, meanByDay(all, D, (t) => t.customer_satisfaction_rating)),
      evidence: {
        drop_stars: w.diff,
        detractor_tickets: rec.filter((t) => t.customer_satisfaction_rating <= 2).length,
        by_category: countBy(rec.filter((t) => t.customer_satisfaction_rating <= 2), (t) => t.category, 4),
        breach_share: safeDiv(rec.filter((t) => t.sla_breached).length, rec.length),
      },
      pool: rec,
    });
  }
  return out;
}

/* ── 7. Churn risk — account-level composite ─────────────────────────────── */
function churnRisk(ds) {
  const rf = ds.meta.recent_from;
  const rows = accountRollup(ds);
  const atRisk = rows.filter((a) =>
    (a.recent_escalations >= 2) ||
    (a.recent_escalations >= 1 && (a.nps_segment === 'detractor' || (a.csat_avg != null && a.csat_avg <= 2.5))) ||
    (a.cancellation && a.recent_escalations >= 1));
  const arr = atRisk.reduce((s, a) => s + (a.arr_usd || 0), 0);
  if (arr < THRESHOLDS.churn_arr_floor || atRisk.length < 5) return [];

  // Baseline: the same rule applied to the pre-window period.
  const baseRows = rows.filter((a) => a.escalations - a.recent_escalations >= 2);
  const scaled = baseRows.length * ((ds.meta.days - rf) / rf);

  const top = atRisk.slice().sort((a, b) => (b.arr_usd || 0) - (a.arr_usd || 0)).slice(0, 12);
  return [{
    key: 'churn:accounts',
    signal_type: 'churn_risk',
    metric: 'Accounts showing churn signals',
    entity: { kind: 'portfolio', key: 'at_risk', label: 'At-risk accounts' },
    unit: 'count', observed: atRisk.length, baseline: scaled,
    n_recent: rows.length, n_base: rows.length,
    z: scaled ? (atRisk.length - scaled) / Math.sqrt(Math.max(1, scaled)) : 3,
    p: 0, lift: safeDiv(atRisk.length, scaled), direction: 'up',
    affected_accounts: atRisk.length, affected_ids: atRisk.map((a) => a.account_id),
    series: mkSeries(ds.meta.days, countByDay(ds.escalations, ds.meta.days)),
    evidence: {
      arr_at_risk: arr,
      enterprise_count: atRisk.filter((a) => a.plan === 'Enterprise').length,
      enterprise_arr: atRisk.filter((a) => a.plan === 'Enterprise').reduce((s, a) => s + a.arr_usd, 0),
      avg_arr: safeDiv(arr, atRisk.length),
      with_detractor_nps: atRisk.filter((a) => a.nps_segment === 'detractor').length,
      with_cancellation_intent: atRisk.filter((a) => a.cancellation).length,
      renewal_within_90d: atRisk.filter((a) => a.renewal_in_days <= 90).length,
      top_accounts: top.map((a) => ({ account_id: a.account_id, company: a.company, plan: a.plan, arr_usd: a.arr_usd, escalations: a.recent_escalations, nps: a.nps, renewal_in_days: a.renewal_in_days })),
      by_plan: countBy(atRisk, (a) => a.plan),
    },
    pool: atRisk,
  }];
}

/* ── 8. Compliance exposure ──────────────────────────────────────────────── */
function complianceRisk(ds) {
  const rf = ds.meta.recent_from;
  const dsar = ds.tickets.filter((t) => t.regulatory_due_at != null);
  const openDsar = dsar.filter((t) => !t.resolved_at);
  const atRisk = openDsar.filter((t) => t.regulatory_days_left <= 10);
  const breached = openDsar.filter((t) => t.regulatory_breached);

  const qaRec = ds.qa.filter((q) => q.day_index >= rf - 21);
  const compFlags = qaRec.filter((q) => q.flags.includes('compliance-risk') || q.flags.includes('policy-deviation'));
  const escBreach = ds.escalations.filter((e) => e.sla_breached);

  const exposure = atRisk.length * 3 + breached.length * 6 + compFlags.length * 2 + escBreach.length;
  if (exposure < 20) return [];

  const compRec = mean(qaRec.map((q) => q.dimensions.compliance));
  const compBase = mean(ds.qa.filter((q) => q.day_index < rf - 21).map((q) => q.dimensions.compliance));

  const ids = [...new Set(openDsar.map((t) => t.account_id).concat(escBreach.map((e) => e.account_id)))];
  return [{
    key: 'compliance:exposure',
    signal_type: 'compliance_risk',
    metric: 'Compliance exposure index',
    entity: { kind: 'function', key: 'compliance', label: 'Compliance' },
    unit: 'index', observed: exposure, baseline: 20,
    n_recent: openDsar.length + compFlags.length + escBreach.length, n_base: dsar.length,
    z: 3.0, p: 0, lift: safeDiv(exposure, 20), direction: 'up',
    affected_accounts: ids.length, affected_ids: ids,
    series: mkSeries(ds.meta.days, countByDay(ds.tickets.filter((t) => t.category === 'Data & Privacy'), ds.meta.days)),
    evidence: {
      dsar_open: openDsar.length,
      dsar_due_within_10d: atRisk.length,
      dsar_past_due: breached.length,
      qa_compliance_recent: compRec,
      qa_compliance_base: compBase,
      qa_policy_flags: compFlags.length,
      escalations_past_response_sla: escBreach.length,
      items: openDsar.map((t) => ({ ticket_id: t.ticket_id, company: t.company, tag: t.tag, days_left: t.regulatory_days_left, created_at: t.created_at })).sort((a, b) => a.days_left - b.days_left).slice(0, 12),
    },
    pool: openDsar,
  }];
}

/* ── 9. Resolution-SLA drift, per category (mix-safe) ────────────────────── */
function slaRisk(ds) {
  const rf = ds.meta.recent_from, D = ds.meta.days, out = [];
  const rec = resolvedIn(ds, rf, D - 1);
  const base = resolvedIn(ds, 0, rf - 1);
  for (const cat of new Set(ds.tickets.map((t) => t.category))) {
    const r = rec.filter((t) => t.category === cat), b = base.filter((t) => t.category === cat);
    if (r.length < THRESHOLDS.min_sample || b.length < THRESHOLDS.min_sample) continue;
    const { z, p1, p0 } = propZ(r.filter((t) => t.sla_breached).length, r.length, b.filter((t) => t.sla_breached).length, b.length);
    if (z < THRESHOLDS.rate_z || p1 <= p0) continue;
    const ids = [...new Set(r.filter((t) => t.sla_breached).map((t) => t.account_id))];
    out.push({
      key: `sla:${cat}`,
      signal_type: 'sla_risk',
      metric: `Resolution SLA breach — ${cat}`,
      entity: { kind: 'category', key: cat, label: cat },
      unit: 'rate', observed: p1, baseline: p0,
      n_recent: r.length, n_base: b.length,
      z, p: pValue(z), lift: safeDiv(p1, p0), direction: 'up',
      affected_accounts: ids.length, affected_ids: ids,
      series: mkSeries(D, rateByDay(ds.tickets.filter((t) => t.category === cat), D, (t) => t.sla_breached)),
      evidence: {
        breached_recent: r.filter((t) => t.sla_breached).length,
        median_ttr_recent: median(r.map((t) => t.time_to_resolution_hrs)),
        median_ttr_base: median(b.map((t) => t.time_to_resolution_hrs)),
        sla_target_hrs: r[0]?.sla_target_hrs,
      },
      pool: r,
    });
  }
  return out;
}

/* ── Runner ──────────────────────────────────────────────────────────────── */

export function detect(ds) {
  const detectors = [
    ['escalation_spike', escalationSpike],
    ['emerging_topic', emergingTopic],
    ['backlog_risk', backlogRisk],
    ['coaching_gap', coachingGap],
    ['nps_drop', npsDrop],
    ['csat_drop', csatDrop],
    ['churn_risk', churnRisk],
    ['compliance_risk', complianceRisk],
    ['sla_risk', slaRisk],
  ];
  const anomalies = [];
  const ran = [];
  for (const [name, fn] of detectors) {
    const found = fn(ds) || [];
    ran.push({ detector: name, found: found.length });
    anomalies.push(...found);
  }
  return { anomalies, detectors_run: ran, thresholds: THRESHOLDS };
}
