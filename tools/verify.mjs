/* ==========================================================================
   Verification harness — run with:  node tools/verify.mjs
   --------------------------------------------------------------------------
   The acceptance test for the whole system: generate the data, run the
   engine, and ASSERT that the four injected patterns are found, ranked, and
   costed with arithmetic that reconciles. If a pattern stops surfacing, the
   fix belongs in the generator or a threshold — never in the UI.
   ========================================================================== */

import { generate } from '../data/generator.js';
import { runEngine } from '../engine/web/index.js';

const AS_OF = Date.parse('2026-07-24T14:20:00Z');
const SEEDS = [20260724, 7, 99, 1234, 20250101];

let failures = 0, checks = 0;
const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;

function check(label, cond, detail = '') {
  checks++;
  if (cond) console.log(`  ${g('PASS')} ${label}${detail ? dim('  ' + detail) : ''}`);
  else { failures++; console.log(`  ${r('FAIL')} ${label}${detail ? '  ' + detail : ''}`); }
}

function bySignal(insights, type) { return insights.find((i) => i.signal_type === type); }

/* ── Main seed: full assertions ─────────────────────────────────────────── */
console.log('\n=== OpsPulse verification ===\n');
console.log(`Primary seed ${SEEDS[0]} · as of ${new Date(AS_OF).toISOString()}\n`);

const t0 = Date.now();
const ds = generate(SEEDS[0], AS_OF);
const tGen = Date.now() - t0;
const out = runEngine(ds);

console.log(`Dataset: ${ds.tickets.length} tickets · ${ds.escalations.length} escalations · ${ds.nps.length} NPS · ${ds.qa.length} QA  ${dim(`(${tGen} ms)`)}`);
console.log(`Engine : ${out.insights.length} insights from ${out.run.stats.anomalies_flagged} anomalies  ${dim(JSON.stringify(out.run.timings_ms))}\n`);

console.log('— Dataset volumes —');
check('10,000 support tickets', ds.tickets.length === 10000, `${ds.tickets.length}`);
check('500 escalations', ds.escalations.length === 500, `${ds.escalations.length}`);
check('1,000 NPS responses', ds.nps.length === 1000, `${ds.nps.length}`);
check('100 QA reviews', ds.qa.length === 100, `${ds.qa.length}`);

console.log('\n— Contract —');
check('every insight validates against the schema', out.run.contract_valid, out.run.contract_errors.slice(0, 3).join('; '));
check('insights are ranked by priority', out.insights.every((x, i, a) => i === 0 || a[i - 1]._meta.priority >= x._meta.priority));

console.log('\n— P1  Refund escalation spike —');
const p1 = out.insights.find((i) => i.signal_type === 'escalation_spike' && i._meta.entity.key === 'Refund');
check('detected as an escalation spike on Refund', !!p1);
if (p1) {
  const m = p1._meta;
  check('escalation rate ≥ 2.5× its own baseline', m.lift >= 2.5, `${m.lift.toFixed(2)}×  (${(m.baseline * 100).toFixed(1)}% → ${(m.observed * 100).toFixed(1)}%)`);
  check('blast radius is exactly 231 customers', m.affected_accounts === 231, `${m.affected_accounts}`);
  check('root cause names the policy window', /policy window/i.test(p1.why.root_cause), dim(p1.why.root_cause.slice(0, 90) + '…'));
  check('correlated to the refund policy event', !!m.correlated_event && /refund policy/i.test(m.correlated_event.label), m.correlated_event?.label || 'none');
  check('confidence in the 0.80–0.95 band', p1.why.confidence >= 0.8 && p1.why.confidence <= 0.95, `${(p1.why.confidence * 100).toFixed(0)}%`);
  check('recommends the refund-policy playbook', p1.recommended_action.playbook_id === 'PB-REFUND-POLICY-01', p1.recommended_action.playbook_id);
  check('leads the executive top 3', out.brief.top_3[0] === p1, `rank ${out.insights.indexOf(p1) + 1} of ${out.insights.length}`);
  // The arithmetic on the card must actually reconcile.
  const [lo, hi] = [m.impact.low, m.impact.high];
  const c = out.churn_model;
  check('impact is a range, not a point estimate', lo != null && hi != null && hi > lo, `$${lo.toLocaleString()} – $${hi.toLocaleString()}`);
  check('churn lift is measured from the data, not assumed', c.lift_pts > 0, `${(c.lift_pts * 100).toFixed(1)} pts over ${(c.n_escalated + c.n_not_escalated).toLocaleString()} accounts`);
}

/* THE credibility check: for every costed insight, re-multiply the inputs that
   are PRINTED ON THE CARD and require them to reproduce the printed range. If
   a value is rounded for display but not for the math, this fails. */
console.log('\n— Shown inputs must compute to the shown range —');
for (const i of out.insights) {
  const im = i._meta.impact;
  if (im.low == null) {
    check(`${i._meta.title}: uncosted by design`, im.range_factor === null, im.formula);
    continue;
  }
  const product = im.inputs.reduce((s, x) => s * x.value, 1);
  const okLo = Math.round(product * im.range_factor[0]) === im.low;
  const okHi = Math.round(product * im.range_factor[1]) === im.high;
  check(`${i._meta.title}: ${im.formula} = $${im.low.toLocaleString()}–$${im.high.toLocaleString()}`, okLo && okHi,
    okLo && okHi ? '' : `recomputed $${Math.round(product * im.range_factor[0]).toLocaleString()}–$${Math.round(product * im.range_factor[1]).toLocaleString()}`);
}

console.log('\n— P2  New-hire QA decline —');
const p2 = bySignal(out.insights, 'coaching_gap');
check('detected as a coaching gap', !!p2);
if (p2) {
  const m = p2._meta;
  check('gap ≥ 10 QA points', m.evidence.gap_pts >= 10, `${m.evidence.gap_pts.toFixed(1)} pts (${m.baseline.toFixed(1)} vs ${m.observed.toFixed(1)})`);
  check('weakest dimension is policy adherence or compliance',
    ['policy_adherence', 'compliance'].includes(m.evidence.dimension_gaps[0].key), m.evidence.dimension_gaps[0].key);
  check('names the per-agent detail for coaching', m.evidence.per_agent.length >= 5, `${m.evidence.per_agent.length} agents scored`);
  check('recommends the coaching playbook', p2.recommended_action.playbook_id === 'PB-COACH-04');
}

console.log('\n— P3  Onboarding confusion —');
const p3 = out.insights.find((i) => i.signal_type === 'emerging_topic' && i._meta.entity.key === 'Onboarding');
check('detected as an emerging topic on Onboarding', !!p3);
if (p3) {
  const m = p3._meta;
  check('volume ≥ 1.35× its own baseline', m.lift >= 1.35, `${m.lift.toFixed(2)}× (${m.baseline.toFixed(1)}/day → ${m.observed.toFixed(1)}/day)`);
  check('root cause points at the new onboarding flow',
    /wizard|getting-started|setup|import/i.test(p3.why.root_cause), dim(p3.why.root_cause.slice(0, 90) + '…'));
  check('correlated to the onboarding release', !!m.correlated_event && /onboarding/i.test(m.correlated_event.label), m.correlated_event?.label || 'none');
  check('recommends the onboarding-deflection playbook', p3.recommended_action.playbook_id === 'PB-ONBOARD-DEFLECT-02');
}

console.log('\n— P4  Ticket backlog increase —');
const p4 = bySignal(out.insights, 'backlog_risk');
check('detected as a backlog risk', !!p4);
if (p4) {
  const m = p4._meta;
  check('backlog grew ≥ 40% over the window', m.lift >= 1.4, `${Math.round(m.baseline)} → ${Math.round(m.observed)} (${m.lift.toFixed(2)}×)`);
  check('inflow exceeds throughput', m.evidence.capacity_gap_per_day > 0, `${m.evidence.capacity_gap_per_day.toFixed(1)} tickets/day gap`);
  check('first-response time degraded alongside it', m.evidence.frt_median_recent > m.evidence.frt_median_base, `${m.evidence.frt_median_base.toFixed(0)}m → ${m.evidence.frt_median_recent.toFixed(0)}m`);
  check('attributes growth to the two surging categories',
    m.decomposition.slice(0, 2).map((d) => d.key).sort().join(',') === 'Onboarding,Refund',
    m.decomposition.slice(0, 2).map((d) => `${d.key} ${(d.contribution * 100).toFixed(0)}%`).join(' + '));
}

console.log('\n— P5  Emergent: NPS drop with attributed drivers —');
const p5 = bySignal(out.insights, 'nps_drop');
check('detected as an NPS drop', !!p5);
if (p5) {
  const m = p5._meta;
  check('drop ≥ 12 points', m.evidence.drop_pts >= 12, `${m.baseline} → ${m.observed} (−${m.evidence.drop_pts})`);
  check('top detractor driver is the refund policy or onboarding',
    ['refund-policy', 'onboarding'].includes(m.decomposition[0].key), m.decomposition[0].key);
  check('driver contributions are a decomposition (sum ≈ 1)',
    Math.abs(m.decomposition.reduce((s, d) => s + Math.max(0, d.contribution), 0) - 1) < 0.02);
}

console.log('\n— Health & radar —');
const h = out.health;
check('health score is 0–100', h.score >= 0 && h.score <= 100, `${h.score}/100 (Δ${h.delta >= 0 ? '+' : ''}${h.delta})`);
check('all four risk dimensions present',
  ['support', 'customer', 'quality', 'compliance'].every((k) => h.dimensions.some((d) => d.key === k)),
  h.dimensions.map((d) => `${d.label.split(' ')[0]} ${d.score}`).join(' · '));
check('every dimension exposes its drivers', h.dimensions.every((d) => d.drivers.length >= 3));
check('composite equals the weighted mean of its dimensions',
  Math.abs(h.score - h.dimensions.reduce((s, d) => s + d.score * h.weights[d.key], 0)) <= 0.5);

console.log('\n— Executive brief —');
check('exec top 3 covers three DIFFERENT entities',
  new Set(out.brief.top_3.map((i) => `${i._meta.entity.kind}:${i._meta.entity.key}`)).size === out.brief.top_3.length,
  out.brief.top_3.map((i) => i._meta.title).join(' | '));
check('top 3 ids match the top 3 exec cards',
  out.brief.rollup.top_3_ids.join() === out.brief.top_3.map((i) => i.insight_id).join());
check('narrative leads with what to act on today', /act on today/i.test(out.brief.narrative));
check('compliance exposure is deliberately uncosted',
  (bySignal(out.insights, 'compliance_risk')?.expected_impact.revenue_at_risk_usd ?? null) === null);

console.log('\n— Ranked feed —');
out.insights.forEach((i, n) => {
  const imp = i.expected_impact;
  const money = imp.range_low_usd == null ? 'uncosted' : `$${Math.round(imp.range_low_usd / 1000)}k–$${Math.round(imp.range_high_usd / 1000)}k`;
  console.log(`  ${String(n + 1).padStart(2)}. sev ${String(i.severity_score).padStart(3)} · conf ${String(Math.round(i.why.confidence * 100)).padStart(3)}% · ${money.padEnd(13)} ${i._meta.title}`);
});

/* ── Stability: patterns must not depend on one lucky RNG, and must not depend
      on which day of the week the app happens to be opened. Production uses
      Date.now(); this pins several calendar positions including a weekend. ── */
console.log('\n— Stability across seeds and calendar positions —');
const AS_OF_CASES = [
  ['Thu 14:20', AS_OF],
  ['Sat 09:05', Date.parse('2026-07-25T09:05:00Z')],
  ['Sun 21:40', Date.parse('2026-07-26T21:40:00Z')],
  ['Mon 08:00', Date.parse('2026-08-03T08:00:00Z')],
];
for (const seed of SEEDS.slice(1)) {
  for (const [label, asOf] of AS_OF_CASES) {
    const d2 = generate(seed, asOf);
    const o2 = runEngine(d2);
    const p = {
      P1: o2.insights.find((i) => i.signal_type === 'escalation_spike' && i._meta.entity.key === 'Refund'),
      P2: bySignal(o2.insights, 'coaching_gap'),
      P3: o2.insights.find((i) => i.signal_type === 'emerging_topic' && i._meta.entity.key === 'Onboarding'),
      P4: bySignal(o2.insights, 'backlog_risk'),
    };
    const missing = Object.entries(p).filter(([, v]) => !v).map(([k]) => k);
    // NPS is quoted verbatim by the copilot, so it has to stay in a believable
    // band on EVERY seed — a negative-NPS draw reads as a broken demo. The
    // floor here is the DETECTOR's own threshold (8 pts), not a stricter number
    // invented for the test: with ~190 responses the sampling error is ±10, so
    // demanding more than the engine demands would be testing luck.
    const nps = bySignal(o2.insights, 'nps_drop')?._meta;
    const npsOk = nps && nps.observed >= 0 && nps.evidence.drop_pts >= 8 && nps.evidence.drop_pts <= 32;
    check(`seed ${seed} · ${label}: four patterns + credible NPS drop`, missing.length === 0 && npsOk,
      missing.length ? `missing ${missing.join(',')}`
        : !npsOk ? `NPS ${nps ? `${nps.baseline}→${nps.observed}` : 'not detected'}`
        : `radius ${p.P1._meta.affected_accounts} · NPS ${nps.baseline}→${nps.observed}`);
  }
}

console.log(`\n${failures === 0 ? g('ALL CHECKS PASSED') : r(`${failures} CHECK(S) FAILED`)}  (${checks - failures}/${checks})\n`);
process.exit(failures === 0 ? 0 : 1);
