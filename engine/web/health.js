/* ==========================================================================
   Operations Health Score + Risk Radar
   --------------------------------------------------------------------------
   One composite number is only trustworthy if you can open it. Every score
   here is a weighted mean of named drivers, and every driver states its own
   value, its target, and the band it was scored against — so "health 72" can
   always be answered with "because of these four things".

   The same function computes the CURRENT window and the PRIOR window, which is
   what makes the delta arrow real rather than decorative.
   ========================================================================== */

import { mean, median, clamp, safeDiv } from './stats.js';
import { npsOf, csatOf, resolvedIn, accountRollup, DAY_MS } from './aggregate.js';

/** Linear score in 0–100. `good` scores 100, `bad` scores 0, either direction. */
function band(value, good, bad) {
  if (value == null || Number.isNaN(value)) return 50;
  const t = (value - bad) / (good - bad);
  return clamp(t, 0, 1) * 100;
}

const driver = (label, value, display, score, weight, target) =>
  ({ label, value, display, score: Math.round(score), weight, target });

function dimension(key, label, drivers, hint) {
  const wsum = drivers.reduce((s, d) => s + d.weight, 0) || 1;
  const score = drivers.reduce((s, d) => s + d.score * d.weight, 0) / wsum;
  return { key, label, score: Math.round(score), risk: Math.round(100 - score), drivers, hint };
}

/**
 * @param {object} ds
 * @param {number} fromDay inclusive
 * @param {number} toDay   inclusive
 */
export function computeHealth(ds, fromDay, toDay) {
  const inWin = (x) => x.day_index >= fromDay && x.day_index <= toDay;
  const tickets = ds.tickets.filter(inWin);
  const escal = ds.escalations.filter(inWin);
  const nps = ds.nps.filter(inWin);
  const qa = ds.qa.filter(inWin);
  const asOf = Math.min(ds.meta.as_of, ds.meta.day0 + (toDay + 1) * DAY_MS);

  /* ── Support ── */
  const backlogNow = ds.meta.series.backlog[toDay] ?? 0;
  const openAtEnd = ds.tickets.filter((t) => t.created_at <= asOf && (!t.resolved_at || t.resolved_at > asOf));
  const ages = openAtEnd.map((t) => (asOf - t.created_at) / 3600000);
  const frtBreach = safeDiv(tickets.filter((t) => t.frt_sla_breached).length, tickets.length);
  const resolved = resolvedIn(ds, fromDay, toDay);
  const resBreach = safeDiv(resolved.filter((t) => t.sla_breached).length, resolved.length);

  const support = dimension('support', 'Support Risk', [
    driver('Open backlog', backlogNow, `${backlogNow} tickets`, band(backlogNow, 180, 520), 0.30, '≤ 180'),
    driver('First-response SLA breach', frtBreach, `${(frtBreach * 100).toFixed(1)}%`, band(frtBreach, 0.02, 0.12), 0.25, '≤ 2%'),
    driver('Median age of open queue', median(ages), `${median(ages).toFixed(0)} h`, band(median(ages), 24, 200), 0.25, '≤ 24 h'),
    driver('Resolution SLA breach', resBreach, `${(resBreach * 100).toFixed(1)}%`, band(resBreach, 0.10, 0.45), 0.20, '≤ 10%'),
  ], 'Can the desk keep up with what is arriving?');

  /* ── Customer ── */
  const n = npsOf(nps);
  const c = csatOf(tickets);
  const rollup = accountRollup(ds);
  const atRiskArr = rollup
    .filter((a) => a.recent_escalations >= 2 || (a.recent_escalations >= 1 && a.nps_segment === 'detractor'))
    .reduce((s, a) => s + (a.arr_usd || 0), 0);
  const totalArr = ds.accounts.reduce((s, a) => s + a.arr_usd, 0);
  const arrShare = safeDiv(atRiskArr, totalArr);
  const escRate = safeDiv(escal.length, tickets.length);

  const customer = dimension('customer', 'Customer Risk', [
    driver('Net Promoter Score', n.nps, `${n.nps > 0 ? '+' : ''}${n.nps}`, band(n.nps, 45, -10), 0.35, '≥ +45'),
    driver('CSAT average', c.avg, `${c.avg.toFixed(2)} ★`, band(c.avg, 4.5, 3.0), 0.25, '≥ 4.5★'),
    driver('ARR in at-risk accounts', arrShare, `${(arrShare * 100).toFixed(1)}% of book`, band(arrShare, 0.01, 0.10), 0.25, '≤ 1%'),
    driver('Escalation rate', escRate, `${(escRate * 100).toFixed(1)}%`, band(escRate, 0.03, 0.12), 0.15, '≤ 3%'),
  ], 'Are customers still with us — and would they say so?');

  /* ── Quality ── */
  const qaMean = qa.length ? mean(qa.map((q) => q.overall_score)) : null;
  const nh = qa.filter((q) => q.cohort === 'new_hire');
  const tn = qa.filter((q) => q.cohort === 'tenured');
  const gap = nh.length && tn.length ? mean(tn.map((q) => q.overall_score)) - mean(nh.map((q) => q.overall_score)) : 0;
  const reopen = safeDiv(tickets.filter((t) => t.reopened).length, tickets.length);

  const quality = dimension('quality', 'Quality Risk', [
    driver('QA score (all agents)', qaMean, qaMean == null ? '—' : `${qaMean.toFixed(1)}`, band(qaMean ?? 85, 92, 70), 0.40, '≥ 92'),
    driver('New-hire vs tenured gap', gap, `${gap.toFixed(1)} pts`, band(gap, 3, 25), 0.35, '≤ 3 pts'),
    driver('Reopen rate', reopen, `${(reopen * 100).toFixed(1)}%`, band(reopen, 0.03, 0.15), 0.25, '≤ 3%'),
  ], 'Is the work being done correctly the first time?');

  /* ── Compliance ── */
  const dsarOpen = ds.tickets.filter((t) => t.regulatory_due_at != null && (!t.resolved_at || t.resolved_at > asOf) && t.created_at <= asOf);
  const dsarUrgent = dsarOpen.filter((t) => (t.regulatory_due_at - asOf) / DAY_MS <= 10).length;
  const qaComp = qa.length ? mean(qa.map((q) => q.dimensions.compliance)) : null;
  const escPastSla = escal.filter((e) => e.sla_breached).length;
  const policyFlags = qa.filter((q) => q.flags.includes('policy-deviation')).length;

  const compliance = dimension('compliance', 'Compliance Risk', [
    driver('Statutory requests near deadline', dsarUrgent, `${dsarUrgent} within 10 days`, band(dsarUrgent, 0, 12), 0.35, '0'),
    driver('QA compliance dimension', qaComp, qaComp == null ? '—' : `${qaComp.toFixed(1)}`, band(qaComp ?? 90, 95, 65), 0.30, '≥ 95'),
    driver('Escalations past response SLA', escPastSla, `${escPastSla} open`, band(escPastSla, 0, 25), 0.20, '0'),
    driver('QA policy-deviation flags', policyFlags, `${policyFlags} reviews`, band(policyFlags, 0, 20), 0.15, '0'),
  ], 'Are we meeting obligations we do not get to negotiate?');

  const dims = [support, customer, quality, compliance];
  const WEIGHTS = { support: 0.30, customer: 0.30, quality: 0.25, compliance: 0.15 };
  const overall = Math.round(dims.reduce((s, d) => s + d.score * WEIGHTS[d.key], 0));

  return {
    score: overall,
    window: { from: fromDay, to: toDay },
    dimensions: dims,
    weights: WEIGHTS,
    facts: {
      tickets: tickets.length, escalations: escal.length, nps_responses: nps.length,
      qa_reviews: qa.length, backlog: backlogNow, nps: n.nps, csat: c.avg,
      open_now: openAtEnd.length, arr_at_risk: atRiskArr,
    },
  };
}

/** Current window + the window before it, so the delta is measured not guessed. */
export function healthWithDelta(ds) {
  const rf = ds.meta.recent_from, last = ds.meta.days - 1;
  const span = last - rf;
  const now = computeHealth(ds, rf, last);
  const prior = computeHealth(ds, Math.max(0, rf - span - 1), rf - 1);
  now.delta = now.score - prior.score;
  now.prior = prior;
  now.dimensions.forEach((d) => {
    const p = prior.dimensions.find((x) => x.key === d.key);
    d.delta = p ? d.score - p.score : 0;
  });
  return now;
}
