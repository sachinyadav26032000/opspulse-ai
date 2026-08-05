/* ==========================================================================
   OpsPulse — the decision engine UI
   --------------------------------------------------------------------------
   Five screens: Dashboard · Decision Feed · Risk Radar · Executive Copilot ·
   Data Upload.

   THE DESIGN RULE FOR THE DASHBOARD: a CX director opening this at 9am must
   see, above everything else, "here are your top 3 operational risks and what
   to do about them." The health gauge, the KPI strip and the charts are all
   secondary — they exist to let someone challenge the top three, not to be
   read first. Nothing on that screen is a metric without a consequence.

   Every number is clickable. Clicking opens a BI drill-down built from the
   SAME aggregation functions the engine used, so a figure on a card and the
   chart behind it are incapable of disagreeing.
   ========================================================================== */

import {
  lineChart, barChart, stackedBar, donut, contributionChart, radarChart,
  gaugeSvg, sparkline, fmt, SERIES, STATUS, hideTip,
} from './charts.js';
import {
  countByDay, meanByDay, countBy, npsOf, csatOf, dayLabel,
  rolling, openTickets, groupBy,
} from '../engine/web/aggregate.js';
import { KAGGLE_COLUMNS } from '../data/generator.js';
import { toCsv } from '../data/csv.js';
/* The composable query layer. The Copilot tries this first for questions about
   accounts, and falls back to the insight narratives below for questions about
   what the engine detected. Neither path can invent a number. */
import { ask as runQuery, resolve as resolveStack, templateQuestions, reasonFor, SUPPORTED } from '../engine/web/query.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const IC = {
  home: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  feed: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  radar: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.4"/><path d="M12 12 19 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 4.5 19 12 7 19.5v-15Z" fill="currentColor"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none"><path d="M14 3v5h5M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
};

const sevClass = (s) => (s >= 70 ? '' : s >= 50 ? 'sev-med' : 'sev-low');
const moneyRange = (i) => {
  const e = i.expected_impact;
  if (e.range_low_usd == null) return 'Not costed';
  return `${fmt.usdK(e.range_low_usd)} – ${fmt.usdK(e.range_high_usd)}`;
};

export function mountOpsPulse(container, store, { onOpenTicket } = {}) {
  /* One root child, for the same reason as the service desk: host pages size
     the app with `#app > * { flex: 1 }`, and appending the toolbar as a
     sibling of the body made the toolbar grow to half the viewport. */
  container.innerHTML = '';
  const root = el('div', 'op-root');
  container.appendChild(root);

  /* `filters` is the Copilot's query stack: an ordered list of narrowing
     queries, rendered as removable pills. It lives on view state rather than
     in the store because it is one person's line of enquiry, not part of the
     operation every tab shares. */
  const state = { view: 'dash', filter: 'all', q: '', selected: null, chat: [], filters: [], lastUpload: null };

  /* ── Chrome ───────────────────────────────────────────────────────────── */
  const top = el('div', 'lv-top');
  top.innerHTML = `
    <div class="lv-brand">
      <span class="dot" style="background:var(--grad)">
        <svg viewBox="0 0 24 24" fill="none"><path d="M2 12h4l2.2-6 3.4 12 2.6-8 1.6 4H22" stroke="#04120c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>OpsPulse<span class="muted" style="font-weight:600"> AI</span>
    </div>
    <nav class="lv-nav" id="opNav"></nav>
    <div class="lv-spacer"></div>
    <span class="lv-live"><span class="lv-dot" id="opDot"></span><span id="opLive">live</span></span>
    <button class="lv-btn" id="opToggle">${IC.pause}<span>Pause</span></button>
    <button class="lv-btn" id="opReseed" title="Generate a different random operation with the same four patterns">${IC.dice}<span>New data</span></button>`;
  root.appendChild(top);

  const body = el('div', 'lv-body');
  root.appendChild(body);

  const NAV = [
    { id: 'dash', label: 'Dashboard', icon: IC.home },
    { id: 'feed', label: 'Decision Feed', icon: IC.feed, badge: () => store.engine.insights.length },
    { id: 'radar', label: 'Risk Radar', icon: IC.radar },
    { id: 'copilot', label: 'Executive Copilot', icon: IC.chat },
    { id: 'upload', label: 'Data Upload', icon: IC.up },
  ];
  const nav = root.querySelector('#opNav');
  function renderNav() {
    nav.innerHTML = '';
    for (const n of NAV) {
      const b = el('button', state.view === n.id ? 'on' : '', `${n.icon}<span>${esc(n.label)}</span>${n.badge ? `<span class="badge">${n.badge()}</span>` : ''}`);
      b.addEventListener('click', () => { state.view = n.id; render(); body.scrollTop = 0; });
      nav.appendChild(b);
    }
  }

  /* ── Drill-down modal ─────────────────────────────────────────────────── */
  const modal = el('div', 'drill');
  modal.hidden = true;
  modal.innerHTML = `<div class="scrim"></div><div class="drill-panel"><div class="drill-hd"><div><h3></h3><p></p></div><button class="drill-x" aria-label="Close">✕</button></div><div class="drill-bd"></div></div>`;
  document.body.appendChild(modal);
  // A drill-down freezes the page beneath it: an engine pass that lands while
  // someone is reading a chart must not swap the numbers under their cursor.
  // The deferred re-render happens on close instead.
  let dirty = false;
  const closeDrill = () => {
    modal.hidden = true;
    hideTip();
    if (dirty) { dirty = false; render(); }
  };
  modal.querySelector('.scrim').addEventListener('click', closeDrill);
  modal.querySelector('.drill-x').addEventListener('click', closeDrill);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrill(); });

  function openDrill({ title, subtitle, kpis = [], blocks = [] }) {
    modal.querySelector('h3').textContent = title;
    modal.querySelector('.drill-hd p').textContent = subtitle || '';
    const bd = modal.querySelector('.drill-bd');
    bd.innerHTML = '';
    if (kpis.length) {
      const k = el('div', 'drill-kpis');
      k.innerHTML = kpis.map((x) => `<div><div class="k">${esc(x.k)}</div><div class="v" ${x.color ? `style="color:${x.color}"` : ''}>${esc(x.v)}</div><div class="s">${esc(x.s || '')}</div></div>`).join('');
      bd.appendChild(k);
    }
    for (const b of blocks) bd.appendChild(b);
    modal.hidden = false;
    modal.querySelector('.drill-panel').scrollTop = 0;
  }

  const toasts = el('div', 'toasts');
  document.body.appendChild(toasts);
  function toast(title, sub) {
    const t = el('div', 'toast', `<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`);
    toasts.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  /* ── Shared data helpers ──────────────────────────────────────────────── */
  const ds = () => store.dataset;
  const eng = () => store.engine;

  /* The KPI strip, as data.
     ------------------------------------------------------------------------
     Pulled out of the dashboard renderer because it is now read twice: once
     when the screen is built, and again on every ~3.2s tick to refresh the
     numbers in place. Those numbers are the ones NorthDesk also shows, and a
     full re-render was reserved for the ~9s engine pass so the top-3 cannot
     flicker under a reader — which meant the two panes sat up to nine seconds
     apart on the same metric. Recomputing the strip alone is cheap and touches
     no card, so both apps now move together without reintroducing the flicker. */
  function kpiModel(d) {
    const rec = d.tickets.filter((t) => t.day_index >= d.meta.recent_from);
    const open = openTickets(d);
    const npsRec = npsOf(d.nps.filter((r) => r.day_index >= d.meta.recent_from));
    const csatRec = csatOf(rec);
    return [
      { key: 'tickets', k: 'Tickets / day', v: fmt.one(rec.length / (d.meta.days - d.meta.recent_from)), spark: rolling(countByDay(d.tickets, d.meta.days), 7).slice(-30) },
      { key: 'backlog', k: 'Open backlog', v: fmt.int(open.length), spark: d.meta.series.backlog.slice(-30), bad: true },
      { key: 'escalations', k: 'Open escalations', v: fmt.int(d.escalations.filter((x) => x.status !== 'Closed').length), spark: rolling(countByDay(d.escalations, d.meta.days), 7).slice(-30), bad: true },
      { key: 'nps', k: 'NPS', v: fmt.nps(npsRec.nps), spark: null, bad: npsRec.nps < 25 },
      { key: 'csat', k: 'CSAT', v: fmt.stars(csatRec.avg), spark: rolling(meanByDay(d.tickets, d.meta.days, (t) => t.customer_satisfaction_rating), 7).slice(-30) },
      { key: 'qa', k: 'QA average', v: fmt.one(mean(d.qa.map((q) => q.overall_score))), spark: rolling(meanByDay(d.qa, d.meta.days, (q) => q.overall_score), 14).slice(-30) },
    ];
  }

  /** Repaint the strip's values without rebuilding it — no flicker, no lost hover. */
  function refreshKpis() {
    const strip = body.querySelector('.kpi-strip');
    if (!strip) return;                       // not on the dashboard
    for (const k of kpiModel(ds())) {
      const v = strip.querySelector(`.kpi[data-kpi="${k.key}"] .v`);
      if (!v) continue;
      const next = String(k.v);
      if (v.textContent !== next) v.textContent = next;
      const colour = k.bad ? STATUS.warning : '';
      if (v.style.color !== colour) v.style.color = colour;
    }
  }

  const labelsFor = (from, to) => { const d = ds(); const out = []; for (let i = from; i <= to; i++) out.push(dayLabel(d, i)); return out; };
  const win = (n) => { const d = ds(); const to = d.meta.days - 1; return { from: Math.max(0, to - n + 1), to }; };
  const releaseMarkers = (from) => ds().meta.releases.filter((r) => r.day >= from).map((r) => ({ i: r.day - from, label: r.kind === 'policy' ? 'policy' : r.kind === 'org' ? 'new hires' : 'release' }));

  function table(cols, rows, opts = {}) {
    const wrap = el('div', 'panel');
    wrap.innerHTML = `<div class="panel-hd"><h3>${esc(opts.title || 'Detail')}</h3>${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ''}</div>`;
    const bd = el('div', 'panel-bd tight');
    const scroll = el('div', '', '');
    scroll.style.cssText = 'max-height:320px;overflow:auto';
    const t = el('table', 'dtable');
    t.innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.raw ? r[c.key] : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>`;
    scroll.appendChild(t); bd.appendChild(scroll); wrap.appendChild(bd);
    return wrap;
  }

  /* ══════════════════════════════════════════════════════════════════════
     BI DRILL-DOWNS
     ══════════════════════════════════════════════════════════════════════ */

  function drillInsight(ins) {
    const d = ds(), m = ins._meta;
    const from = Math.max(0, d.meta.days - 45), to = d.meta.days - 1;
    const labels = labelsFor(from, to);
    const vals = m.series.values.slice(from, to + 1);
    const blocks = [];

    const fmtFor = m.unit === 'rate' ? fmt.pct : m.unit === 'per_day' ? fmt.one : m.unit === 'stars' ? fmt.stars : m.unit === 'nps' ? fmt.nps : m.unit === 'score' ? fmt.one : fmt.int;

    blocks.push(lineChart({
      title: `${m.metric_label ? m.entity.label + ' · ' : ''}${ins._meta.title}`,
      subtitle: 'last 45 days · shaded band is the analysis window',
      labels, series: [{ name: m.metric || 'value', values: vals }],
      format: fmtFor, area: true,
      markers: releaseMarkers(from),
      bands: [{ from: d.meta.recent_from - from, to: to - from, label: 'analysis window' }],
      note: `Detected at z = ${m.z.toFixed(1)} against this metric's own ${d.meta.recent_from}-day baseline (threshold z ≥ 2.5). Dashed lines mark operational events.`,
    }));

    if (m.decomposition?.length) {
      blocks.push(contributionChart({
        title: 'What explains the change',
        subtitle: `decomposed by ${m.decomposition_dimension}`,
        rows: m.decomposition.map((r) => ({ ...r, label: String(r.key).replace(/[-_]/g, ' ') })),
        note: 'Contributions are shares of the measured delta and sum to 100%. This is attribution by decomposition, not a guess about cause.',
      }));
    }

    /* Signal-specific supporting analysis */
    const grid = el('div', 'grid2');
    if (ins.signal_type === 'escalation_spike' || ins.signal_type === 'emerging_topic') {
      const cat = m.entity.key;
      const rec = d.tickets.filter((t) => t.category === cat && t.day_index >= d.meta.recent_from);
      const base = d.tickets.filter((t) => t.category === cat && t.day_index < d.meta.recent_from);
      grid.appendChild(barChart({
        title: 'Recent reasons in this category', subtitle: `${rec.length} tickets in the window`,
        rows: countBy(rec, (t) => String(t.tag).replace(/-/g, ' '), 7),
      }));
      grid.appendChild(donut({
        title: 'Channel mix', subtitle: 'how these customers are reaching us',
        rows: countBy(rec, (t) => t.ticket_channel).slice(0, 5), centreLabel: 'tickets',
      }));
      blocks.push(grid);
      blocks.push(stackedBar({
        title: 'Daily volume by priority', subtitle: 'last 21 days',
        labels: labelsFor(d.meta.days - 21, d.meta.days - 1),
        series: ['Critical', 'High', 'Medium', 'Low'].map((p, i) => ({
          name: p, color: [STATUS.critical, STATUS.serious, SERIES[3], SERIES[0]][i],
          values: countByDay(d.tickets.filter((t) => t.category === cat && t.ticket_priority === p), d.meta.days).slice(d.meta.days - 21),
        })),
      }));
      const accounts = countBy(rec, (t) => t.company, 10);
      blocks.push(table(
        [{ label: 'Account', key: 'key' }, { label: 'Tickets in window', key: 'value', num: true }],
        accounts, { title: 'Most affected accounts', hint: `${m.affected_accounts} distinct customers in total` },
      ));
    }

    if (ins.signal_type === 'coaching_gap') {
      const ev = m.evidence;
      grid.appendChild(barChart({
        title: 'QA gap by scorecard dimension', subtitle: 'tenured minus new hire, in points',
        rows: ev.dimension_gaps.map((g) => ({ key: g.key.replace(/_/g, ' '), value: g.gap, hint: 'Gap' })),
        format: fmt.one, color: STATUS.serious,
      }));
      grid.appendChild(barChart({
        title: 'New-hire agents by QA score', subtitle: 'lowest first, this is the coaching list',
        rows: ev.per_agent.map((a) => ({ key: a.name, value: a.score, hint: 'QA' })),
        format: (v) => Math.round(v), color: SERIES[0], maxRows: 12,
      }));
      blocks.push(grid);
      blocks.push(table(
        [{ label: 'Agent', key: 'name' }, { label: 'Team', key: 'team' }, { label: 'Tenure (days)', key: 'tenure_days', num: true }, { label: 'Reviews', key: 'n', num: true }, { label: 'QA score', key: 'score', num: true }],
        ev.per_agent.map((a) => ({ ...a, score: Math.round(a.score) })), { title: 'Cohort detail' },
      ));
    }

    if (ins.signal_type === 'backlog_risk') {
      const ev = m.evidence;
      blocks.push(lineChart({
        title: 'Inflow vs throughput', subtitle: 'the gap is the backlog',
        labels: labelsFor(d.meta.days - 45, d.meta.days - 1),
        series: [
          { name: 'Tickets in', values: rolling(ev.inflow_series, 7).slice(d.meta.days - 45) },
          { name: 'Tickets resolved', values: rolling(ev.throughput_series, 7).slice(d.meta.days - 45) },
        ],
        format: fmt.one, zeroBase: false,
        note: '7-day rolling means. Capacity did not change; demand did, which is why the queue grows.',
      }));
      grid.appendChild(barChart({
        title: 'Open queue by category', rows: countBy(openTickets(d), (t) => t.category, 8),
      }));
      grid.appendChild(barChart({
        title: 'Open queue by age band',
        rows: (() => {
          const bands = [['< 24h', 0, 24], ['1–3 days', 24, 72], ['3–7 days', 72, 168], ['> 7 days', 168, 1e9]];
          const now = d.meta.as_of;
          return bands.map(([key, lo, hi], i) => ({
            key, color: [SERIES[2], SERIES[3], STATUS.serious, STATUS.critical][i],
            value: openTickets(d).filter((t) => { const a = (now - t.created_at) / 3600000; return a >= lo && a < hi; }).length,
          }));
        })(),
      }));
      blocks.push(grid);
    }

    if (ins.signal_type === 'nps_drop') {
      const rec = d.nps.filter((r) => r.day_index >= d.meta.recent_from);
      grid.appendChild(donut({
        title: 'Response mix in the window',
        rows: [
          { key: 'Promoters (9–10)', value: rec.filter((r) => r.score >= 9).length, color: STATUS.good },
          { key: 'Passives (7–8)', value: rec.filter((r) => r.score >= 7 && r.score <= 8).length, color: SERIES[3] },
          { key: 'Detractors (0–6)', value: rec.filter((r) => r.score <= 6).length, color: STATUS.critical },
        ], centreLabel: 'responses',
      }));
      grid.appendChild(barChart({
        title: 'What detractors are citing', subtitle: 'current window',
        rows: countBy(rec.filter((r) => r.segment === 'detractor'), (r) => String(r.driver_tag).replace(/-/g, ' '), 6), color: STATUS.critical,
      }));
      blocks.push(grid);
      blocks.push(table(
        [{ label: 'Account', key: 'company' }, { label: 'Score', key: 'score', num: true }, { label: 'Driver', key: 'driver_tag' }, { label: 'ARR', key: 'arr', num: true }, { label: 'What they said', key: 'verbatim' }],
        rec.filter((r) => r.segment === 'detractor').sort((a, b) => b.arr_usd - a.arr_usd).slice(0, 25)
          .map((r) => ({ ...r, arr: fmt.usd(r.arr_usd), driver_tag: String(r.driver_tag).replace(/-/g, ' ') })),
        { title: 'Detractor verbatims by ARR', hint: 'highest-value unhappy customers first' },
      ));
    }

    if (ins.signal_type === 'churn_risk') {
      const ev = m.evidence;
      grid.appendChild(donut({ title: 'At-risk accounts by plan', rows: ev.by_plan.map((p) => ({ key: p.key, value: p.value })), centreLabel: 'accounts' }));
      grid.appendChild(barChart({
        title: 'Top at-risk accounts by ARR',
        rows: ev.top_accounts.map((a) => ({ key: a.company, value: a.arr_usd, hint: 'ARR' })), format: fmt.usdK, color: STATUS.critical,
      }));
      blocks.push(grid);
      blocks.push(table(
        [{ label: 'Account', key: 'company' }, { label: 'Plan', key: 'plan' }, { label: 'ARR', key: 'arr', num: true }, { label: 'Escalations', key: 'escalations', num: true }, { label: 'Last NPS', key: 'npsv', num: true }, { label: 'Renews in', key: 'ren', num: true }],
        ev.top_accounts.map((a) => ({ ...a, arr: fmt.usd(a.arr_usd), npsv: a.nps ?? '—', ren: a.renewal_in_days + 'd' })),
        { title: 'The save list', hint: 'sorted by ARR, work top-down' },
      ));
    }

    if (ins.signal_type === 'compliance_risk') {
      blocks.push(table(
        [{ label: 'Ticket', key: 'ticket_id' }, { label: 'Account', key: 'company' }, { label: 'Type', key: 'tag' }, { label: 'Days to statutory deadline', key: 'days_left', num: true }],
        m.evidence.items, { title: 'Open statutory requests', hint: 'soonest deadline first' },
      ));
    }

    /* The four questions, always last so the charts have already argued the case */
    blocks.push(explorerBlock(ins, true));

    openDrill({
      title: m.title,
      subtitle: ins.what_happened,
      kpis: [
        { k: 'Severity', v: String(ins.severity_score), s: 'impact × reach × strength × trend' },
        { k: 'Confidence', v: `${Math.round(ins.why.confidence * 100)}%`, s: 'hypothesis, not proof' },
        { k: 'Customers affected', v: fmt.int(m.affected_accounts), s: 'distinct accounts' },
        { k: ins.expected_impact.range_low_usd == null ? 'Exposure' : 'Value at stake', v: moneyRange(ins), s: `${ins.expected_impact.time_horizon_days}-day horizon` },
      ],
      blocks,
    });
  }

  const KPI_DRILLS = {
    backlog: () => {
      const d = ds();
      const s = d.meta.series;
      const open = openTickets(d);
      return {
        title: 'Open backlog', subtitle: 'Every ticket currently unresolved, and how the queue got here.',
        kpis: [
          { k: 'Open now', v: fmt.int(open.length), s: 'unresolved tickets' },
          { k: 'Median age', v: fmt.hrs(median(open.map((t) => (d.meta.as_of - t.created_at) / 3600000))), s: 'of the open queue' },
          { k: 'Older than 72h', v: fmt.int(open.filter((t) => (d.meta.as_of - t.created_at) / 3600000 > 72).length), s: 'aged work' },
          { k: 'Escalated', v: fmt.int(open.filter((t) => t.escalated).length), s: 'open + escalated' },
        ],
        blocks: [
          lineChart({ title: 'Backlog over 90 days', labels: labelsFor(0, d.meta.days - 1), series: [{ name: 'Open tickets', values: s.backlog }], area: true, markers: releaseMarkers(0), bands: [{ from: d.meta.recent_from, to: d.meta.days - 1, label: 'analysis window' }] }),
          lineChart({ title: 'Inflow vs throughput', subtitle: '7-day rolling', labels: labelsFor(0, d.meta.days - 1), series: [{ name: 'In', values: rolling(s.inflow, 7) }, { name: 'Resolved', values: rolling(s.throughput, 7) }], format: fmt.one, zeroBase: false }),
          (() => { const g = el('div', 'grid2'); g.appendChild(barChart({ title: 'Open by category', rows: countBy(open, (t) => t.category, 9) })); g.appendChild(barChart({ title: 'Open by team', rows: countBy(open, (t) => t.team) })); return g; })(),
        ],
      };
    },
    nps: () => {
      const d = ds();
      const rec = d.nps.filter((r) => r.day_index >= d.meta.recent_from);
      const base = d.nps.filter((r) => r.day_index < d.meta.recent_from);
      const a = npsOf(rec), b = npsOf(base);
      const byDayVals = [];
      for (let i = 0; i < d.meta.days; i++) {
        const w = d.nps.filter((r) => r.day_index <= i && r.day_index > i - 7);
        byDayVals.push(w.length >= 20 ? npsOf(w).nps : null);
      }
      return {
        title: 'Net Promoter Score', subtitle: 'Rolling 7-day NPS, and what the detractors are actually saying.',
        kpis: [
          { k: 'Current NPS', v: fmt.nps(a.nps), s: `${a.n} responses`, color: a.nps < 20 ? STATUS.critical : undefined },
          { k: 'Baseline NPS', v: fmt.nps(b.nps), s: `${b.n} responses` },
          { k: 'Detractor share', v: fmt.pct0(a.detractors / a.n), s: `was ${fmt.pct0(b.detractors / b.n)}` },
          { k: 'Detractor ARR', v: fmt.usdK(rec.filter((r) => r.segment === 'detractor').reduce((s2, r) => s2 + r.arr_usd, 0)), s: 'revenue behind the complaints' },
        ],
        blocks: [
          lineChart({ title: 'NPS trend', subtitle: '7-day rolling window', labels: labelsFor(0, d.meta.days - 1), series: [{ name: 'NPS', values: byDayVals }], format: fmt.nps, zeroBase: false, markers: releaseMarkers(0) }),
          stackedBar({ title: 'Response mix by week', labels: weekLabels(d), series: [
            { name: 'Promoters', color: STATUS.good, values: weekAgg(d, d.nps, (r) => r.score >= 9) },
            { name: 'Passives', color: SERIES[3], values: weekAgg(d, d.nps, (r) => r.score >= 7 && r.score <= 8) },
            { name: 'Detractors', color: STATUS.critical, values: weekAgg(d, d.nps, (r) => r.score <= 6) },
          ] }),
          barChart({ title: 'Detractor drivers · current window', rows: countBy(rec.filter((r) => r.segment === 'detractor'), (r) => String(r.driver_tag).replace(/-/g, ' '), 6), color: STATUS.critical }),
        ],
      };
    },
    csat: () => {
      const d = ds();
      const rec = d.tickets.filter((t) => t.day_index >= d.meta.recent_from);
      const c = csatOf(rec), cb = csatOf(d.tickets.filter((t) => t.day_index < d.meta.recent_from));
      return {
        title: 'Customer satisfaction', subtitle: 'Post-resolution ratings, and which work is producing the low ones.',
        kpis: [
          { k: 'CSAT', v: fmt.stars(c.avg), s: `${c.n} rated tickets` },
          { k: 'Baseline', v: fmt.stars(cb.avg), s: `${cb.n} rated` },
          { k: '4–5 star share', v: fmt.pct0(c.pctSatisfied), s: `was ${fmt.pct0(cb.pctSatisfied)}` },
          { k: '1–2 star tickets', v: fmt.int(rec.filter((t) => t.customer_satisfaction_rating <= 2).length), s: 'in the window' },
        ],
        blocks: [
          lineChart({ title: 'CSAT trend', labels: labelsFor(0, d.meta.days - 1), series: [{ name: 'CSAT', values: rolling(meanByDay(d.tickets, d.meta.days, (t) => t.customer_satisfaction_rating), 7) }], format: fmt.stars, zeroBase: false }),
          (() => { const g = el('div', 'grid2');
            g.appendChild(barChart({ title: 'Low ratings by category', rows: countBy(rec.filter((t) => t.customer_satisfaction_rating <= 2), (t) => t.category, 7), color: STATUS.critical }));
            g.appendChild(barChart({ title: 'CSAT by team', rows: [...groupBy(rec.filter((t) => t.customer_satisfaction_rating != null), (t) => t.team)].map(([k, v]) => ({ key: k, value: csatOf(v).avg })), format: fmt.stars }));
            return g; })(),
        ],
      };
    },
    qa: () => {
      const d = ds();
      const nh = d.qa.filter((q) => q.cohort === 'new_hire'), tn = d.qa.filter((q) => q.cohort === 'tenured');
      const dims = Object.keys(d.qa[0].dimensions);
      return {
        title: 'Quality assurance', subtitle: 'Scorecard performance, split by tenure cohort.',
        kpis: [
          { k: 'QA average', v: fmt.one(mean(d.qa.map((q) => q.overall_score))), s: `${d.qa.length} reviews` },
          { k: 'Tenured', v: fmt.one(mean(tn.map((q) => q.overall_score))), s: `${tn.length} reviews` },
          { k: 'New hire', v: fmt.one(mean(nh.map((q) => q.overall_score))), s: `${nh.length} reviews`, color: STATUS.critical },
          { k: 'Flagged reviews', v: fmt.int(d.qa.filter((q) => q.flags.length).length), s: 'policy / compliance' },
        ],
        blocks: [
          lineChart({ title: 'QA score over time', subtitle: 'by cohort', labels: labelsFor(0, d.meta.days - 1), series: [
            { name: 'Tenured', values: rolling(meanByDay(tn, d.meta.days, (q) => q.overall_score), 14) },
            { name: 'New hire', values: rolling(meanByDay(nh, d.meta.days, (q) => q.overall_score), 14) },
          ], format: fmt.one, zeroBase: false }),
          barChart({ title: 'Scorecard dimensions', subtitle: 'tenured vs new hire',
            rows: dims.flatMap((k) => [
              { key: `${k.replace(/_/g, ' ')} · tenured`, value: mean(tn.map((q) => q.dimensions[k])), color: SERIES[0] },
              { key: `${k.replace(/_/g, ' ')} · new hire`, value: mean(nh.map((q) => q.dimensions[k])), color: STATUS.serious },
            ]), format: (v) => Math.round(v), maxRows: 12 }),
        ],
      };
    },
    escalations: () => {
      const d = ds();
      const open = d.escalations.filter((e) => e.status !== 'Closed');
      const rec = d.escalations.filter((e) => e.day_index >= d.meta.recent_from);
      return {
        title: 'Escalations', subtitle: 'Where work is leaving the normal path. The earliest warning a desk gets.',
        kpis: [
          { k: 'Open', v: fmt.int(open.length), s: 'not yet closed' },
          { k: 'In window', v: fmt.int(rec.length), s: `${d.meta.days - d.meta.recent_from} days` },
          { k: 'P1', v: fmt.int(open.filter((e) => e.severity === 'P1').length), s: 'highest severity', color: STATUS.critical },
          { k: 'Past response SLA', v: fmt.int(d.escalations.filter((e) => e.sla_breached).length), s: 'breaching now' },
        ],
        blocks: [
          lineChart({ title: 'Escalations per day', labels: labelsFor(0, d.meta.days - 1), series: [{ name: 'Escalations', values: rolling(countByDay(d.escalations, d.meta.days), 7) }], format: fmt.one, area: true, markers: releaseMarkers(0) }),
          (() => { const g = el('div', 'grid2');
            g.appendChild(barChart({ title: 'By category · current window', rows: countBy(rec, (e) => e.category, 8), color: STATUS.serious }));
            g.appendChild(donut({ title: 'By severity', rows: countBy(open, (e) => e.severity), centreLabel: 'open' }));
            return g; })(),
          table([{ label: 'ID', key: 'escalation_id' }, { label: 'Account', key: 'company' }, { label: 'Severity', key: 'severity' }, { label: 'Reason', key: 'reason' }, { label: 'ARR', key: 'arr', num: true }],
            open.sort((a, b) => b.arr_usd - a.arr_usd).slice(0, 25).map((e) => ({ ...e, arr: fmt.usd(e.arr_usd) })), { title: 'Open escalations by ARR' }),
        ],
      };
    },
    tickets: () => {
      const d = ds();
      const rec = d.tickets.filter((t) => t.day_index >= d.meta.recent_from);
      const base = d.tickets.filter((t) => t.day_index < d.meta.recent_from);
      const cats = [...new Set(d.tickets.map((t) => t.category))];
      return {
        title: 'Ticket volume & mix', subtitle: 'What is arriving, and how the mix has shifted against baseline.',
        kpis: [
          { k: 'Total tickets', v: fmt.int(d.tickets.length), s: '90 days' },
          { k: 'Per day now', v: fmt.one(rec.length / (d.meta.days - d.meta.recent_from)), s: `baseline ${fmt.one(base.length / d.meta.recent_from)}` },
          { k: 'First-response SLA miss', v: fmt.pct(rec.filter((t) => t.frt_sla_breached).length / rec.length), s: `was ${fmt.pct(base.filter((t) => t.frt_sla_breached).length / base.length)}` },
          { k: 'Median first response', v: fmt.min(median(rec.map((t) => t.first_response_time_min))), s: `was ${fmt.min(median(base.map((t) => t.first_response_time_min)))}` },
        ],
        blocks: [
          lineChart({ title: 'Daily ticket volume', subtitle: '7-day rolling', labels: labelsFor(0, d.meta.days - 1), series: [{ name: 'Tickets', values: rolling(countByDay(d.tickets, d.meta.days), 7) }], format: fmt.one, area: true, markers: releaseMarkers(0), bands: [{ from: d.meta.recent_from, to: d.meta.days - 1, label: 'analysis window' }] }),
          barChart({
            title: 'Mix shift vs baseline', subtitle: 'change in tickets per day, by category',
            rows: cats.map((c) => ({
              key: c,
              value: rec.filter((t) => t.category === c).length / (d.meta.days - d.meta.recent_from) - base.filter((t) => t.category === c).length / d.meta.recent_from,
              hint: 'Δ per day',
            })).sort((a, b) => b.value - a.value).map((r) => ({ ...r, color: r.value > 1 ? STATUS.critical : r.value > 0 ? SERIES[3] : SERIES[2] })),
            format: (v) => (v > 0 ? '+' : '') + v.toFixed(1),
            note: 'Only refund and onboarding grew; every other category is flat. That is what makes the surge explainable rather than seasonal.',
          }),
          stackedBar({ title: 'Weekly volume by top categories', labels: weekLabels(d), series: ['Technical', 'Refund', 'Onboarding', 'Billing'].map((c, i) => ({ name: c, color: SERIES[i], values: weekAgg(d, d.tickets, (t) => t.category === c) })) }),
        ],
      };
    },
  };

  function drillDimension(dimKey) {
    const h = eng().health;
    const dim = h.dimensions.find((x) => x.key === dimKey);
    const prior = h.prior.dimensions.find((x) => x.key === dimKey);
    const blocks = [];
    blocks.push(barChart({
      title: 'Driver scores', subtitle: 'each scored 0–100 against its own target band',
      rows: dim.drivers.map((dr) => ({ key: dr.label, value: dr.score, hint: `${dr.display} (target ${dr.target})`, color: dr.score >= 70 ? STATUS.good : dr.score >= 45 ? STATUS.warning : STATUS.critical })),
      format: (v) => Math.round(v),
      note: `Dimension score is the weighted mean of these drivers: ${dim.drivers.map((dr) => `${dr.label} ${Math.round(dr.weight * 100)}%`).join(', ')}.`,
    }));
    blocks.push(table(
      [{ label: 'Driver', key: 'label' }, { label: 'Current value', key: 'display' }, { label: 'Target', key: 'target' }, { label: 'Score', key: 'score', num: true }, { label: 'Weight', key: 'w', num: true }, { label: 'Prior period', key: 'p' }],
      dim.drivers.map((dr, i) => ({ ...dr, w: `${Math.round(dr.weight * 100)}%`, p: prior?.drivers[i]?.display ?? '—' })),
      { title: 'How this score is built', hint: 'nothing here is a judgement call the numbers do not support' },
    ));
    const related = eng().insights.filter((i) => relatedDimension(i.signal_type) === dimKey);
    if (related.length) {
      const p = el('div', 'panel');
      p.innerHTML = '<div class="panel-hd"><h3>Open insights in this dimension</h3></div>';
      const bd = el('div', 'panel-bd');
      const feed = el('div', 'feed');
      for (const i of related) feed.appendChild(feedRow(i));
      bd.appendChild(feed); p.appendChild(bd); blocks.push(p);
    }
    openDrill({
      title: dim.label, subtitle: dim.hint,
      kpis: [
        { k: 'Score', v: String(dim.score), s: 'higher is healthier', color: dim.score >= 70 ? STATUS.good : dim.score >= 50 ? STATUS.warning : STATUS.critical },
        { k: 'Risk', v: String(dim.risk), s: '100 − score' },
        { k: 'Change', v: `${dim.delta > 0 ? '+' : ''}${dim.delta}`, s: 'vs prior period' },
        { k: 'Weight in health', v: fmt.pct0(h.weights[dim.key]), s: 'of the composite' },
      ],
      blocks,
    });
  }

  const relatedDimension = (t) => ({
    escalation_spike: 'customer', churn_risk: 'customer', nps_drop: 'customer', csat_drop: 'customer',
    backlog_risk: 'support', sla_risk: 'support', emerging_topic: 'support',
    coaching_gap: 'quality', compliance_risk: 'compliance',
  }[t] || 'support');

  /* ══════════════════════════════════════════════════════════════════════
     SHARED CARD / EXPLORER RENDERERS
     ══════════════════════════════════════════════════════════════════════ */

  function riskCard(ins, rank) {
    const m = ins._meta;
    const c = el('article', `risk-card ${sevClass(ins.severity_score)}`);
    c.innerHTML = `
      <span class="rank">#${rank}</span>
      <h4>${esc(m.title)}</h4>
      <div class="metric">${esc(m.metric_label)}</div>
      <dl>
        <div><dt>Impact</dt><dd>${fmt.int(m.affected_accounts)} customers${m.evidence.arr_at_risk ? ` · ${fmt.usdK(m.evidence.arr_at_risk)} ARR` : ''}</dd></div>
        <div><dt>Root cause <span class="muted">(hypothesis)</span></dt><dd>${esc(firstSentence(ins.why.root_cause))}</dd></div>
        <div><dt>Recommended action</dt><dd>${esc(ins.recommended_action.action)}</dd></div>
        <div><dt>${ins.expected_impact.range_low_usd == null ? 'Exposure' : 'Value at stake'}</dt><dd class="money">${esc(moneyRange(ins))}</dd></div>
      </dl>
      <div class="foot">
        <span class="conf" title="Confidence = 45% statistical strength + 30% share of change explained + 25% corroborating signals">
          <span class="bar"><i style="width:${Math.round(ins.why.confidence * 100)}%"></i></span><b>${Math.round(ins.why.confidence * 100)}%</b> confidence
        </span>
        <span class="chip">${esc(ins.recommended_action.owner_role)}</span>
        ${ins.status === 'held_for_review' ? '<span class="chip held">held for review</span>' : ''}
      </div>`;
    c.addEventListener('click', () => drillInsight(ins));
    return c;
  }

  function feedRow(ins) {
    const m = ins._meta;
    const r = el('div', 'feed-row' + (state.selected === ins.insight_id ? ' on' : ''));
    const sevCol = ins.severity_score >= 70 ? STATUS.critical : ins.severity_score >= 50 ? STATUS.warning : SERIES[0];
    r.innerHTML = `
      <div class="sev"><b style="color:${sevCol}">${ins.severity_score}</b><small>sev</small></div>
      <div>
        <div class="ttl">${esc(m.title)}</div>
        <div class="sub">
          <span>${esc(m.metric_label)}</span>
          <span class="chip">${esc(ins.signal_type.replace(/_/g, ' '))}</span>
          <span class="chip">${esc(ins.recommended_action.owner_role)}</span>
          ${ins.status === 'held_for_review' ? '<span class="chip held">held</span>' : ''}
          <span class="conf"><span class="bar"><i style="width:${Math.round(ins.why.confidence * 100)}%"></i></span><b>${Math.round(ins.why.confidence * 100)}%</b></span>
        </div>
      </div>
      <div class="right"><div class="m">${esc(moneyRange(ins))}</div><div class="h">${fmt.int(m.affected_accounts)} customers · ${ins.expected_impact.time_horizon_days}d</div></div>`;
    r.addEventListener('click', () => { state.selected = ins.insight_id; render(); });
    return r;
  }

  /** The four questions — what happened, why, what it's worth, what to do. */
  function explorerBlock(ins, inDrill = false) {
    const m = ins._meta;
    const p = el('div', 'panel');
    p.innerHTML = `<div class="panel-hd"><h3>${inDrill ? 'The four questions' : esc(m.title)}</h3><span class="hint">${esc(ins.insight_id)} · ${esc(m.decomposition_dimension || '')}</span></div>`;
    const bd = el('div', 'panel-bd');

    const grid = el('div', 'q-grid');

    const q1 = el('div', 'qbox');
    q1.innerHTML = `<h5>1 · What happened</h5><div class="big">${esc(m.metric_label)}</div><p style="margin-top:6px">${esc(ins.what_happened)}</p>
      <p class="muted" style="margin-top:8px;font-size:.76rem">Detected statistically: z = ${m.z.toFixed(1)}, n = ${fmt.int(m.n_recent)} in window vs ${fmt.int(m.n_base)} baseline.</p>`;
    grid.appendChild(q1);

    const cp = m.confidence_parts;
    const q2 = el('div', 'qbox');
    q2.innerHTML = `<h5>2 · Why <span class="chip md">hypothesis</span></h5><p>${esc(ins.why.root_cause)}</p>
      <div style="margin-top:10px" class="conf"><span class="bar" style="width:80px"><i style="width:${Math.round(ins.why.confidence * 100)}%"></i></span><b>${Math.round(ins.why.confidence * 100)}%</b> confidence</div>
      <p class="muted" style="margin-top:6px;font-size:.75rem">
        statistical ${fmt.pct0(cp.statistical)} · explained by top driver ${fmt.pct0(cp.explained)} · corroborated ${fmt.pct0(cp.corroborated)}.
        Correlation, not confirmed cause. A human closes that gap.
      </p>
      <ul class="evidence">${ins.why.contributing_signals.map((s) => `<li><span class="mark ${s.hit ? 'y' : 'n'}">${s.hit ? '✓' : '–'}</span><span>${esc(s.label)} <span class="det">· ${esc(s.detail)}</span></span></li>`).join('')}</ul>`;
    grid.appendChild(q2);

    const im = m.impact;
    const q3 = el('div', 'qbox');
    q3.innerHTML = `<h5>3 · What it is worth</h5><div class="big">${esc(moneyRange(ins))}</div>
      <p class="muted" style="margin-top:3px;font-size:.76rem">${esc(im.type.replace(/_/g, ' '))} · ${ins.expected_impact.time_horizon_days}-day horizon</p>
      <div class="math"><div class="f">${esc(im.formula)}</div>
        <ul>${im.basis.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
        ${im.note ? `<div class="caveat">${esc(im.note)}</div>` : ''}</div>`;
    grid.appendChild(q3);

    const q4 = el('div', 'qbox');
    q4.innerHTML = `<h5>4 · What to do</h5><p><strong style="color:var(--text)">${esc(ins.recommended_action.action)}</strong></p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <span class="chip info">${esc(ins.recommended_action.owner_role)}</span>
        <span class="chip">playbook ${esc(ins.recommended_action.playbook_id)}</span>
        <span class="chip">${esc(m.effort)} effort</span>
        <span class="chip">${m.horizon_days}-day window</span>
      </div>
      <ol class="steps">${m.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
    grid.appendChild(q4);
    bd.appendChild(grid);

    if (!inDrill) {
      const acts = el('div', 'act-row');
      const open = el('button', 'lv-btn primary', 'Open BI drill-down');
      open.addEventListener('click', () => drillInsight(ins));
      const assign = el('button', 'lv-btn', `Assign to ${ins.recommended_action.owner_role}`);
      assign.addEventListener('click', () => toast('Assigned', `${m.title} → ${ins.recommended_action.owner_role}`));
      const json = el('button', 'lv-btn', 'View insight JSON');
      json.addEventListener('click', () => showJson(ins));
      acts.appendChild(open); acts.appendChild(assign); acts.appendChild(json);
      bd.appendChild(acts);
    }

    const prov = el('p', 'muted');
    prov.style.cssText = 'font-size:.72rem;margin:12px 0 0;line-height:1.5';
    prov.innerHTML = `<b>Provenance:</b> ` + Object.entries(m.provenance).map(([k, v]) => `${k.replace(/_/g, ' ')} ← <code style="color:var(--cyan)">${esc(v)}</code>`).join(' · ');
    bd.appendChild(prov);

    p.appendChild(bd);
    return p;
  }

  function showJson(ins) {
    const pre = el('pre');
    pre.style.cssText = 'margin:0;font-size:.72rem;line-height:1.55;color:var(--text-soft);white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto';
    const clean = JSON.parse(JSON.stringify(ins));
    delete clean._meta.series; delete clean._meta.affected_ids; delete clean._meta.evidence;
    pre.textContent = JSON.stringify(clean, null, 2);
    const panel = el('div', 'panel');
    panel.innerHTML = '<div class="panel-hd"><h3>Insight object (wire contract)</h3><span class="hint">_meta.series / affected_ids / evidence trimmed for readability</span></div>';
    const bd = el('div', 'panel-bd'); bd.appendChild(pre); panel.appendChild(bd);
    openDrill({ title: 'Insight contract', subtitle: 'Every card on this screen is a rendering of this object. Nothing reaches the UI as free text.', blocks: [panel] });
  }

  /* ══════════════════════════════════════════════════════════════════════
     SCREENS
     ══════════════════════════════════════════════════════════════════════ */

  function viewDashboard() {
    const d = ds(), e = eng(), h = e.health, b = e.brief;
    const wrap = el('div', 'lv-view');

    const hero = el('div', 'op-hero');
    const dArrow = h.delta > 0 ? 'up' : h.delta < 0 ? 'down' : 'flat';
    hero.innerHTML = `
      <div>
        <div class="when">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${esc(b.period)}</div>
        <h2>Here are your top ${b.top_3.length} operational risks, and what to do about them.</h2>
        <p class="lede">${esc(b.rollup.org_health_delta_explanation)}</p>
      </div>
      <div class="op-gauge">
        ${gaugeSvg(h.score)}
        <div><div class="lbl">Ops health</div><div class="delta ${dArrow}">${h.delta > 0 ? '▲' : h.delta < 0 ? '▼' : '■'} ${Math.abs(h.delta)} vs prior</div>
        <div class="muted" style="font-size:.72rem;margin-top:6px;max-width:12ch">click to open the score</div></div>
      </div>`;
    hero.querySelector('.op-gauge').style.cursor = 'pointer';
    hero.querySelector('.op-gauge').addEventListener('click', () => { state.view = 'radar'; render(); });
    wrap.appendChild(hero);

    const t3 = el('div', 'top3');
    b.top_3.forEach((i, n) => t3.appendChild(riskCard(i, n + 1)));
    wrap.appendChild(t3);

    /* KPI strip — secondary by design, but every tile opens real BI */
    const strip = el('div', 'kpi-strip');
    for (const k of kpiModel(d)) {
      const c = el('div', 'kpi', `<div class="k">${esc(k.k)}</div><div class="v" ${k.bad ? `style="color:${STATUS.warning}"` : ''}>${esc(k.v)}</div>${k.spark ? sparkline(k.spark, { color: k.bad ? STATUS.serious : SERIES[0] }) : '<div style="height:26px"></div>'}`);
      c.dataset.kpi = k.key;                  // so the tick refresh can find its tile
      c.addEventListener('click', () => openDrill(KPI_DRILLS[k.key]()));
      strip.appendChild(c);
    }
    wrap.appendChild(strip);

    /* Briefing + opportunities + live ingest */
    const cols = el('div', 'cols2');
    const left = el('div', 'stack');

    const brief = el('div', 'panel');
    brief.innerHTML = `<div class="panel-hd"><h3>Daily executive briefing</h3><span class="hint">auto-generated · ${esc(b.brief_id)}</span></div>`;
    const bbd = el('div', 'panel-bd');
    bbd.innerHTML = `<ul class="brief-lines">${b.narrative_lines.map((l) => `<li><span>${esc(l)}</span></li>`).join('')}</ul>`;
    const brow = el('div', 'act-row');
    const copyBtn = el('button', 'lv-btn', 'Copy briefing');
    copyBtn.addEventListener('click', async () => {
      const text = `OpsPulse · ${b.period}\nHealth ${h.score}/100 (${h.delta >= 0 ? '+' : ''}${h.delta})\n\n${b.narrative_lines.join('\n\n')}\n\nTOP ${b.top_3.length}:\n` +
        b.top_3.map((i, n) => `${n + 1}. ${i._meta.title} · ${i._meta.metric_label}\n   Impact: ${i._meta.affected_accounts} customers · ${moneyRange(i)}\n   Cause (hypothesis, ${Math.round(i.why.confidence * 100)}%): ${firstSentence(i.why.root_cause)}\n   Action: ${i.recommended_action.action} → ${i.recommended_action.owner_role}`).join('\n\n');
      try { await navigator.clipboard.writeText(text); toast('Briefing copied', 'Paste it straight into email or Slack'); }
      catch { toast('Copy blocked', 'Clipboard needs a user gesture on this browser'); }
    });
    const feedBtn = el('button', 'lv-btn', 'Open decision feed →');
    feedBtn.addEventListener('click', () => { state.view = 'feed'; render(); });
    brow.appendChild(copyBtn); brow.appendChild(feedBtn);
    bbd.appendChild(brow);
    brief.appendChild(bbd);
    left.appendChild(brief);

    left.appendChild((() => {
      const p = el('div', 'panel');
      p.innerHTML = '<div class="panel-hd"><h3>Ticket volume & mix</h3><span class="hint">click for the full breakdown</span></div>';
      const bd = el('div', 'panel-bd');
      bd.appendChild(lineChart({
        title: 'Daily volume', subtitle: '7-day rolling · last 45 days',
        labels: labelsFor(d.meta.days - 45, d.meta.days - 1),
        series: [{ name: 'Tickets', values: rolling(countByDay(d.tickets, d.meta.days), 7).slice(d.meta.days - 45) }],
        format: fmt.one, area: true, markers: releaseMarkers(d.meta.days - 45),
        bands: [{ from: d.meta.recent_from - (d.meta.days - 45), to: 44, label: 'analysis window' }],
      }));
      p.appendChild(bd);
      p.style.cursor = 'pointer';
      p.addEventListener('click', (ev) => { if (!ev.target.closest('.viz-table-btn')) openDrill(KPI_DRILLS.tickets()); });
      return p;
    })());
    cols.appendChild(left);

    const right = el('div', 'stack');
    const opp = el('div', 'panel');
    opp.innerHTML = '<div class="panel-hd"><h3>Top opportunities</h3><span class="hint">low effort, high confidence</span></div>';
    const obd = el('div', 'panel-bd');
    const ol = el('div', 'opps');
    if (!b.opportunities.length) ol.appendChild(el('div', 'empty', 'No low-effort recoveries in this window.'));
    for (const o of b.opportunities) {
      const c = el('div', 'opp', `<div class="t">${esc(o.title)}</div><div class="s">${esc(o.action)}</div>
        <div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap"><span class="chip ok">${esc(o.effort)} effort</span><span class="chip">${esc(o.owner_role)}</span><span class="chip">${o.horizon_days}d</span></div>`);
      c.addEventListener('click', () => { const ins = e.insights.find((x) => x.insight_id === o.insight_id); if (ins) drillInsight(ins); });
      ol.appendChild(c);
    }
    obd.appendChild(ol); opp.appendChild(obd);
    right.appendChild(opp);

    right.appendChild(tickerPanel());
    cols.appendChild(right);
    wrap.appendChild(cols);
    return wrap;
  }

  function tickerPanel() {
    const p = el('div', 'panel');
    p.innerHTML = '<div class="panel-hd"><h3>Live ingest</h3><span class="hint">from NorthDesk</span></div>';
    const bd = el('div', 'panel-bd tight');
    const t = el('div', 'ticker');
    t.style.padding = '8px';
    const icCls = { ticket: 't', resolved: 'r', escalation: 'e', nps: 'n', qa: 'q', upload: 'u' };
    const icTxt = { ticket: '+', resolved: '✓', escalation: '!', nps: '★', qa: 'Q', upload: '↑' };
    const items = store.feed.slice(0, 26);
    if (!items.length) t.appendChild(el('div', 'empty', 'Waiting for the first events…'));
    for (const f of items) {
      t.appendChild(el('div', 'tick-row', `<span class="ic ${icCls[f.kind] || 't'}">${icTxt[f.kind] || '+'}</span><span class="tx">${esc(f.text)}</span><span class="tm">${esc(relTime(f.at))}</span>`));
    }
    bd.appendChild(t); p.appendChild(bd);
    return p;
  }

  function viewFeed() {
    const e = eng();
    const wrap = el('div', 'lv-view');
    const tools = el('div', 'feed-tools');
    tools.innerHTML = `
      <div class="seg" id="fFilter">
        ${[['all', 'All'], ['high', 'High severity'], ['money', 'Costed'], ['held', 'Held for review']].map(([k, l]) => `<button data-f="${k}" class="${state.filter === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="lv-search">${IC.search}<input id="fQ" placeholder="Search insights, causes, owners…" value="${esc(state.q)}"/></div>
      <span class="muted" style="font-size:.78rem" id="fCount"></span>`;
    wrap.appendChild(tools);

    let list = e.insights;
    if (state.filter === 'high') list = list.filter((i) => i.severity_score >= 70);
    if (state.filter === 'money') list = list.filter((i) => i.expected_impact.range_low_usd != null);
    if (state.filter === 'held') list = list.filter((i) => i.status === 'held_for_review');
    const q = state.q.trim().toLowerCase();
    if (q) list = list.filter((i) => (i._meta.title + i.what_happened + i.why.root_cause + i.recommended_action.action + i.recommended_action.owner_role).toLowerCase().includes(q));

    const cols = el('div', 'cols2');
    const left = el('div', 'stack');
    const feed = el('div', 'feed');
    if (!list.length) feed.appendChild(el('div', 'empty', 'Nothing matches this filter.'));
    for (const i of list) feed.appendChild(feedRow(i));
    left.appendChild(feed);

    const sel = e.insights.find((i) => i.insight_id === state.selected) || list[0];
    if (sel) left.appendChild(explorerBlock(sel));
    cols.appendChild(left);

    const right = el('div', 'stack');
    const stats = el('div', 'panel');
    const r = e.run;
    stats.innerHTML = `<div class="panel-hd"><h3>Engine run</h3><span class="hint">${Object.values(r.timings_ms).reduce((a, x) => a + x, 0)} ms</span></div>
      <div class="panel-bd">
        <div class="drv">
          ${[['Records analysed', fmt.int(r.stats.records_in)], ['Anomalies flagged', r.stats.anomalies_flagged], ['Insights built', r.stats.insights_built], ['Held below confidence cutoff', r.stats.held_for_review], ['Contract valid', r.contract_valid ? 'yes' : 'NO']]
            .map(([k, v]) => `<div class="drv-row" style="grid-template-columns:1fr auto"><span class="n">${esc(k)}</span><span class="v">${esc(String(v))}</span></div>`).join('')}
        </div>
        <p class="muted" style="font-size:.74rem;margin:12px 0 0;line-height:1.55">Nine statistical detectors run over the live dataset; anything clearing its threshold is root-caused by decomposition and matched to a playbook. Detection is arithmetic. The language layer only explains what it found.</p>
        <div class="drv" style="margin-top:10px">${r.detectors_run.map((x) => `<div class="drv-row" style="grid-template-columns:1fr auto"><span class="n">${esc(x.detector.replace(/_/g, ' '))}</span><span class="v" style="color:${x.found ? STATUS.warning : 'var(--text-dim)'}">${x.found}</span></div>`).join('')}</div>
      </div>`;
    right.appendChild(stats);
    right.appendChild(tickerPanel());
    cols.appendChild(right);
    wrap.appendChild(cols);

    setTimeout(() => {
      wrap.querySelectorAll('#fFilter button').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.f; render(); }));
      const qi = wrap.querySelector('#fQ');
      qi?.addEventListener('input', (ev) => {
        state.q = ev.target.value;
        const pos = ev.target.selectionStart;
        render();
        const again = body.querySelector('#fQ');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      });
      const c = wrap.querySelector('#fCount');
      if (c) c.textContent = `${list.length} of ${e.insights.length} insights`;
    }, 0);
    return wrap;
  }

  function viewRadar() {
    const h = eng().health;
    const wrap = el('div', 'lv-view');
    const p = el('div', 'panel');
    p.innerHTML = `<div class="panel-hd"><h3>Risk Radar</h3><span class="hint">operations health ${h.score}/100 · ${h.delta >= 0 ? '+' : ''}${h.delta} vs prior period</span></div>`;
    const bd = el('div', 'panel-bd');
    const rw = el('div', 'radar-wrap');
    const rv = el('div');
    rv.innerHTML = radarChart({ dimensions: h.dimensions });
    rv.innerHTML += `<p class="muted" style="font-size:.74rem;text-align:center;margin:6px 0 0;line-height:1.5">Further from centre = more risk. Composite health is the weighted mean of the four: ${h.dimensions.map((d) => `${d.label.split(' ')[0]} ${fmt.pct0(h.weights[d.key])}`).join(' · ')}.</p>`;
    rw.appendChild(rv);

    const grid = el('div', 'dim-grid');
    for (const dim of h.dimensions) {
      const col = dim.score >= 70 ? STATUS.good : dim.score >= 50 ? STATUS.warning : STATUS.critical;
      const c = el('div', 'dim-card');
      c.innerHTML = `<div class="top"><h4>${esc(dim.label)}</h4><span class="score" style="color:${col}">${dim.score}</span></div>
        <div class="hint">${esc(dim.hint)} <span style="color:${dim.delta > 0 ? 'var(--ok)' : dim.delta < 0 ? 'var(--danger)' : 'var(--text-dim)'}">${dim.delta > 0 ? '▲' : dim.delta < 0 ? '▼' : '■'} ${Math.abs(dim.delta)}</span></div>
        <div class="drv">${dim.drivers.map((dr) => `
          <div class="drv-row">
            <span class="n">${esc(dr.label)}</span>
            <span class="drv-meter"><i style="width:${dr.score}%;background:${dr.score >= 70 ? STATUS.good : dr.score >= 45 ? STATUS.warning : STATUS.critical}"></i></span>
            <span class="v">${esc(dr.display)}</span>
          </div>`).join('')}</div>`;
      c.addEventListener('click', () => drillDimension(dim.key));
      grid.appendChild(c);
    }
    rw.appendChild(grid);
    bd.appendChild(rw);
    p.appendChild(bd);
    wrap.appendChild(p);

    const p2 = el('div', 'panel');
    p2.innerHTML = '<div class="panel-hd"><h3>Open insights by risk dimension</h3><span class="hint">what is actually driving each score</span></div>';
    const b2 = el('div', 'panel-bd');
    const feed = el('div', 'feed');
    for (const i of eng().insights) feed.appendChild(feedRow(i));
    b2.appendChild(feed); p2.appendChild(b2);
    wrap.appendChild(p2);
    return wrap;
  }

  /* ── Executive Copilot ────────────────────────────────────────────────── */
  /* The old hardcoded SUGGESTIONS array lived here. It is gone: template
     questions are now derived from today's data by templateQuestions() in
     engine/web/query.js, so a chip can never offer a question whose answer is
     zero accounts.

     These are the topics the INSIGHT narratives below cover, as distinct from
     the account queries in query.js. Listed only so a refusal can name the
     whole surface area rather than half of it. */
  const INSIGHT_TOPICS = [
    'the day’s priorities and what to do first',
    'NPS and CSAT movement, with the drivers decomposed',
    'the backlog, SLA position and queue capacity',
    'the new-hire QA gap',
    'emerging contact topics and compliance exposure',
  ];

  function answer(qRaw) {
    const q = qRaw.toLowerCase();
    const e = eng(), h = e.health, b = e.brief, d = ds();
    const find = (t, key) => e.insights.find((i) => i.signal_type === t && (!key || i._meta.entity.key === key));
    const has = (...ws) => ws.some((w) => q.includes(w));
    const chip = (label, fn) => ({ label, fn });

    const insLine = (i) => `<li><strong>${esc(i._meta.title)}</strong>: ${esc(i._meta.metric_label)}. ${esc(firstSentence(i.why.root_cause))} <em>Do:</em> ${esc(i.recommended_action.action)} (${esc(i.recommended_action.owner_role)}, ${Math.round(i.why.confidence * 100)}% confidence).</li>`;

    if (has('focus', 'today', 'priorit', 'first', 'start with', 'morning')) {
      return {
        html: `<strong>Three things, in this order.</strong><ul>${b.top_3.map(insLine).join('')}</ul>
          <p style="margin:10px 0 0">Operations health is <strong>${h.score}/100</strong> (${h.delta >= 0 ? '+' : ''}${h.delta} on the prior period). The weakest dimension is <strong>${esc(h.dimensions.slice().sort((x, y) => x.score - y.score)[0].label)}</strong>.</p>
          <div class="src">Ranked by severity × confidence × urgency, one card per entity so you do not get the same problem three times. ${fmt.int(e.run.stats.records_in)} records analysed.</div>`,
        chips: b.top_3.map((i) => chip(i._meta.title, () => drillInsight(i))),
      };
    }
    if (has('nps', 'promoter', 'detractor', 'survey', 'sentiment')) {
      const i = find('nps_drop');
      const rec = d.nps.filter((r) => r.day_index >= d.meta.recent_from);
      const a = npsOf(rec), base = npsOf(d.nps.filter((r) => r.day_index < d.meta.recent_from));
      if (!i) return { html: `NPS is <strong>${fmt.nps(a.nps)}</strong> across ${a.n} responses, against a baseline of ${fmt.nps(base.nps)}, no drop large enough to raise a card.<div class="src">${a.n} responses in the current window.</div>`, chips: [chip('Open NPS analysis', () => openDrill(KPI_DRILLS.nps()))] };
      const dd = i._meta.decomposition.slice(0, 3);
      return {
        html: `NPS fell from <strong>${fmt.nps(i._meta.baseline)}</strong> to <strong>${fmt.nps(i._meta.observed)}</strong>, ${i._meta.evidence.drop_pts} points across ${i._meta.n_recent} responses.
          <p style="margin:9px 0 0">Detractors went from ${fmt.pct0(i._meta.evidence.detractors_base)} to ${fmt.pct0(i._meta.evidence.detractors_recent)} of responses. What changed in <em>what they complain about</em>:</p>
          <ul>${dd.map((x) => `<li><strong>${esc(String(x.key).replace(/-/g, ' '))}</strong>: ${fmt.pct0(x.share_recent ?? x.recent_rate)} of detractors now vs ${fmt.pct0(x.base_rate ?? 0)} before; explains ${fmt.pct0(x.contribution)} of the shift.</li>`).join('')}</ul>
          <p style="margin:9px 0 0">That first driver is the same refund-policy change behind your top-ranked risk, so fixing one moves both.</p>
          <div class="src">Drivers are decomposed from detractor verbatim tags; contributions sum to 100%. ${fmt.usdK(i._meta.evidence.detractor_arr)} of ARR sits behind these responses.</div>`,
        chips: [chip('Open NPS BI', () => openDrill(KPI_DRILLS.nps())), chip('Open the insight', () => drillInsight(i))],
      };
    }
    if (has('emerging', 'new risk', 'what risks', 'coming', 'building', 'watch')) {
      const em = e.insights.filter((i) => i.signal_type === 'emerging_topic' || i.signal_type === 'escalation_spike');
      const worst = h.dimensions.slice().sort((x, y) => x.score - y.score)[0];
      return {
        html: `<strong>${em.length} emerging signal${em.length === 1 ? '' : 's'}</strong>, all in the current window:<ul>${em.map(insLine).join('')}</ul>
          <p style="margin:10px 0 0">On the radar, <strong>${esc(worst.label)}</strong> is weakest at ${worst.score}/100, driven by ${esc(worst.drivers.slice().sort((a2, b2) => a2.score - b2.score)[0].label.toLowerCase())} (${esc(worst.drivers.slice().sort((a2, b2) => a2.score - b2.score)[0].display)}).</p>
          <div class="src">An emerging topic must be ≥1.35× its own baseline AND clear a share-of-mix z-test of 2.5, so ordinary weekly noise does not qualify.</div>`,
        chips: [chip('Open Risk Radar', () => { state.view = 'radar'; render(); }), ...em.slice(0, 2).map((i) => chip(i._meta.title, () => drillInsight(i)))],
      };
    }
    if (has('biggest', 'worst', 'top risk', 'most important', 'number one', 'single')) {
      const i = b.top_3[0];
      return {
        html: `<strong>${esc(i._meta.title)}.</strong> ${esc(i.what_happened)}
          <p style="margin:9px 0 0"><strong>Why (hypothesis, ${Math.round(i.why.confidence * 100)}% confidence):</strong> ${esc(i.why.root_cause)}</p>
          <p style="margin:9px 0 0"><strong>Worth:</strong> ${esc(moneyRange(i))} over ${i.expected_impact.time_horizon_days} days: ${esc(i._meta.impact.formula)}.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}, owner ${esc(i.recommended_action.owner_role)}, playbook ${esc(i.recommended_action.playbook_id)}.</p>
          <div class="src">Largest single exposure in the feed is actually ${esc(largestExposure(e)._meta.title)} at ${esc(moneyRange(largestExposure(e)))}, but it ranks lower here because its horizon is ${largestExposure(e).expected_impact.time_horizon_days} days, not because it is smaller.</div>`,
        chips: [chip('Open drill-down', () => drillInsight(i)), chip(largestExposure(e)._meta.title, () => drillInsight(largestExposure(e)))],
      };
    }
    if (has('new hire', 'new-hire', 'cohort', 'coach', 'qa', 'quality', 'agent perform')) {
      const i = find('coaching_gap');
      if (!i) return { html: 'No coaching gap is currently clearing the detection threshold.', chips: [chip('Open QA analysis', () => openDrill(KPI_DRILLS.qa()))] };
      const ev = i._meta.evidence;
      return {
        html: `The new-hire cohort is scoring <strong>${i._meta.observed.toFixed(1)}</strong> on QA against <strong>${i._meta.baseline.toFixed(1)}</strong> for tenured agents, a ${ev.gap_pts.toFixed(1)} point gap across ${i._meta.n_recent} reviews of ${ev.agents_in_cohort} agents.
          <ul>${ev.dimension_gaps.slice(0, 3).map((g) => `<li><strong>${esc(g.key.replace(/_/g, ' '))}</strong>: ${g.new_hire.toFixed(0)} vs ${g.tenured.toFixed(0)} (gap ${g.gap.toFixed(1)})</li>`).join('')}</ul>
          <p style="margin:9px 0 0">It costs real money through rework: reopen rate ${fmt.pct(ev.reopen_rate_new_hire)} vs ${fmt.pct(ev.reopen_rate_tenured)}, on ${fmt.int(ev.tickets_handled_recent)} tickets in the window. The bigger cost is indirect: the same policy-adherence weakness shows up in your refund escalations.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}</p>
          <div class="src">Welch t-test between cohorts, t = ${i._meta.z.toFixed(1)}. Worst-scoring agents are listed in the drill-down as the coaching list.</div>`,
        chips: [chip('Open coaching list', () => drillInsight(i)), chip('QA BI', () => openDrill(KPI_DRILLS.qa()))],
      };
    }
    if (has('revenue', 'money', 'at risk', 'cost', 'dollar', '$', 'worth', 'financial')) {
      const costed = e.insights.filter((i) => i.expected_impact.range_low_usd != null).sort((a2, b2) => b2.expected_impact.range_high_usd - a2.expected_impact.range_high_usd);
      return {
        html: `<strong>${fmt.usdK(b.rollup.total_revenue_at_risk)}</strong> in total, taking the midpoint of every costed estimate. Broken down:
          <ul>${costed.map((i) => `<li><strong>${esc(i._meta.title)}</strong>: ${esc(moneyRange(i))} over ${i.expected_impact.time_horizon_days}d. ${esc(i._meta.impact.formula)}</li>`).join('')}</ul>
          <p style="margin:10px 0 0">Compliance exposure is deliberately <strong>not costed</strong>: a statutory deadline is a legal question, and a fabricated fine probability would be the least defensible number on the page.</p>
          <div class="src">Every range is a range on purpose. Cancellation-intent lift is measured on this dataset (${fmt.pct(e.churn_model.lift_pts)} across ${fmt.int(e.churn_model.n_escalated + e.churn_model.n_not_escalated)} accounts); the conversion band is a stated assumption, and it is the widest source of uncertainty.</div>`,
        chips: costed.slice(0, 3).map((i) => chip(i._meta.title, () => drillInsight(i))),
      };
    }
    if (has('backlog', 'queue', 'wait', 'sla', 'capacity', 'slow', 'response time')) {
      const i = find('backlog_risk');
      if (!i) return { html: 'The queue is stable. No backlog anomaly is clearing the threshold.', chips: [chip('Open backlog BI', () => openDrill(KPI_DRILLS.backlog()))] };
      const ev = i._meta.evidence;
      return {
        html: `Open backlog has gone from <strong>${Math.round(i._meta.baseline)}</strong> to <strong>${Math.round(i._meta.observed)}</strong> tickets, growing ${ev.slope_per_day.toFixed(1)}/day.
          <p style="margin:9px 0 0">Inflow is ${ev.inflow_per_day.toFixed(0)}/day against ${ev.throughput_per_day.toFixed(0)}/day of throughput, a ${ev.capacity_gap_per_day.toFixed(0)} ticket/day gap. Capacity did not fall; demand rose, and ${i._meta.decomposition.slice(0, 2).map((x) => x.key).join(' and ')} account for ${fmt.pct0(i._meta.decomposition.slice(0, 2).reduce((s, x) => s + x.contribution, 0))} of the extra.</p>
          <p style="margin:9px 0 0">Customers are feeling it: median first response ${ev.frt_median_base.toFixed(0)}m → ${ev.frt_median_recent.toFixed(0)}m, and ${fmt.int(ev.aged_over_72h)} tickets are now older than 72 hours.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}</p>
          <div class="src">Fixing the two demand drivers is the durable move; surge staffing only buys time.</div>`,
        chips: [chip('Open backlog drill-down', () => drillInsight(i)), chip('Backlog BI', () => openDrill(KPI_DRILLS.backlog()))],
      };
    }
    if (has('compliance', 'gdpr', 'dsar', 'regulat', 'legal', 'privacy')) {
      const i = find('compliance_risk');
      const dim = h.dimensions.find((x) => x.key === 'compliance');
      if (!i) return { html: `Compliance risk scores ${dim.score}/100 with nothing above the alert threshold.`, chips: [chip('Open compliance dimension', () => drillDimension('compliance'))] };
      const ev = i._meta.evidence;
      return {
        html: `Yes, and it is the one item I have <strong>not</strong> put a dollar figure on.
          <p style="margin:9px 0 0">${ev.dsar_open} statutory data requests are open, <strong>${ev.dsar_due_within_10d} within 10 days</strong> of their legal deadline${ev.dsar_past_due ? `, and ${ev.dsar_past_due} already past due` : ''}. QA compliance scoring has moved ${ev.qa_compliance_base.toFixed(0)} → ${ev.qa_compliance_recent.toFixed(0)}, which is the mechanism by which policy errors reach customers.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}, owner ${esc(i.recommended_action.owner_role)}.</p>
          <div class="src">This insight sits at ${Math.round(i.why.confidence * 100)}% confidence${i.status === 'held_for_review' ? ' and is HELD below the 60% cutoff, so a human confirms before it is actioned' : ''}.</div>`,
        chips: [chip('Open compliance drill-down', () => drillInsight(i)), chip('Compliance dimension', () => drillDimension('compliance'))],
      };
    }
    if (has('churn', 'renew', 'accounts at risk', 'save', 'cancel')) {
      const i = find('churn_risk');
      if (!i) return { html: 'No account cluster is currently meeting the churn-risk rule.', chips: [] };
      const ev = i._meta.evidence;
      return {
        html: `<strong>${i._meta.affected_accounts} accounts</strong> holding ${fmt.usdK(ev.arr_at_risk)} of ARR meet the at-risk rule: repeat escalations plus a detractor NPS or low CSAT.
          <p style="margin:9px 0 0">${ev.enterprise_count} are Enterprise (${fmt.usdK(ev.enterprise_arr)}), ${ev.renewal_within_90d} renew within 90 days, and ${ev.with_cancellation_intent} have already raised a cancellation ticket.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}</p>
          <div class="src">The drill-down gives you the save list sorted by ARR.</div>`,
        chips: [chip('Open the save list', () => drillInsight(i))],
      };
    }
    if (has('health', 'score', 'how are we', 'overall')) {
      return {
        html: `Operations health is <strong>${h.score}/100</strong>, ${h.delta >= 0 ? 'up' : 'down'} ${Math.abs(h.delta)} on the prior period.
          <ul>${h.dimensions.map((dd) => `<li><strong>${esc(dd.label)}</strong> ${dd.score}/100 (${dd.delta > 0 ? '+' : ''}${dd.delta}), weakest driver: ${esc(dd.drivers.slice().sort((a2, b2) => a2.score - b2.score)[0].label.toLowerCase())} at ${esc(dd.drivers.slice().sort((a2, b2) => a2.score - b2.score)[0].display)}</li>`).join('')}</ul>
          <div class="src">Composite is the weighted mean of the four dimensions; each dimension is the weighted mean of its named drivers. Nothing in the score is unopenable.</div>`,
        chips: h.dimensions.map((dd) => chip(dd.label, () => drillDimension(dd.key))),
      };
    }
    if (has('refund')) {
      const i = find('escalation_spike', 'Refund') || find('emerging_topic', 'Refund');
      if (i) return { html: `${esc(i.what_happened)}<p style="margin:9px 0 0"><strong>Why:</strong> ${esc(i.why.root_cause)}</p><p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}</p><div class="src">${esc(i._meta.impact.formula)} = ${esc(moneyRange(i))}</div>`, chips: [chip('Open drill-down', () => drillInsight(i))] };
    }
    if (has('onboard', 'setup', 'getting started')) {
      const i = find('emerging_topic', 'Onboarding');
      if (i) return { html: `${esc(i.what_happened)}<p style="margin:9px 0 0"><strong>Why:</strong> ${esc(i.why.root_cause)}</p><p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}</p>`, chips: [chip('Open drill-down', () => drillInsight(i))] };
    }

    /* Fallback: search the insight set rather than inventing an answer.

       Matched on WHOLE WORDS, not substrings. The previous version tested
       `q.includes(word)` against the raw question, so an insight containing
       "here" matched a question containing "weather" and the Copilot answered
       an unrelated question with "closest matches in the current feed". A
       confident answer to a question nobody asked is worse than a refusal.

       Question words are also dropped. "what", "which", "there" and friends
       appear in ordinary insight prose, so leaving them in meant almost any
       sentence starting "what is..." matched something. */
    const NOISE = new Set([
      'what', 'which', 'when', 'where', 'that', 'this', 'those', 'these', 'there',
      'here', 'have', 'has', 'with', 'from', 'about', 'into', 'your', 'ours',
      'tell', 'show', 'give', 'does', 'doing', 'been', 'were', 'will', 'would',
      'could', 'should', 'much', 'many', 'more', 'most', 'some', 'over', 'than',
      'then', 'they', 'them', 'their', 'like', 'just', 'only', 'also', 'know',
    ]);
    const qWords = new Set(q.split(/\W+/).filter((w) => w.length > 3 && !NOISE.has(w)));
    const hits = qWords.size ? e.insights.filter((i) =>
      (i._meta.title + ' ' + i.what_happened + ' ' + i.why.root_cause)
        .toLowerCase().split(/\W+/).some((w) => w.length > 3 && qWords.has(w))) : [];
    if (hits.length) {
      return { html: `Closest matches in the current feed:<ul>${hits.slice(0, 3).map(insLine).join('')}</ul><div class="src">I answer from the ${e.insights.length} insights the engine has computed. I will not answer beyond the data.</div>`, chips: hits.slice(0, 3).map((i) => chip(i._meta.title, () => drillInsight(i))) };
    }
    /* Flagged so `ask` can tell a genuine refusal from an answer. When BOTH
       answerers decline, the caller renders one combined refusal listing the
       account queries and the insight topics, rather than stacking two
       partial "I cannot" messages that each omit half the capability. */
    return {
      declined: true,
      html: `I do not have an answer grounded in the current data for that, and I would rather say so than guess.`,
      chips: [],
    };
  }

  function viewCopilot() {
    const wrap = el('div', 'lv-view');
    const p = el('div', 'panel');
    p.innerHTML = `<div class="panel-hd"><h3>Executive Copilot</h3><span class="hint">grounded in ${fmt.int(eng().run.stats.records_in)} live records</span></div>`;
    const chat = el('div', 'chat');
    const log = el('div', 'chat-log');

    if (!state.chat.length) {
      state.chat.push({ who: 'OpsPulse', html: `Good ${hourGreeting()}. I have analysed <strong>${fmt.int(eng().run.stats.records_in)}</strong> records across tickets, escalations, QA, NPS and product usage. Ask a question, then keep narrowing: each follow-up filters the set you are already looking at.`, chips: [] });
    }

    /* The filter stack, as removable pills. Rendered above the log rather than
       inside it because it describes the CURRENT set, not a past turn: a user
       scrolled up the transcript still needs to see what they have narrowed
       to. Removing any pill re-resolves the whole stack from scratch. */
    if (state.filters.length) {
      const bar = el('div', 'qa-pills');
      bar.appendChild(el('span', 'qa-pills-k', 'Filtered to'));
      state.filters.forEach((f, idx) => {
        const pill = el('button', 'qa-pill', `${esc(f.label)}<span aria-hidden="true">×</span>`);
        pill.title = `Remove "${f.label}"`;
        pill.setAttribute('aria-label', `Remove filter ${f.label}`);
        pill.addEventListener('click', () => {
          state.filters = state.filters.filter((_, i) => i !== idx);
          const n = resolveStack(ds(), state.filters).length;
          state.chat.push({
            who: 'OpsPulse',
            html: `Removed <strong>${esc(f.label)}</strong>. ${state.filters.length ? `Back to <strong>${fmt.int(n)}</strong> accounts.` : `Filters cleared, all <strong>${fmt.int(n)}</strong> accounts back in scope.`}`,
            chips: [],
          });
          render();
        });
        bar.appendChild(pill);
      });
      const clear = el('button', 'qa-pill qa-pill-clear', 'Clear all');
      clear.addEventListener('click', () => {
        state.filters = [];
        state.chat.push({ who: 'OpsPulse', html: `Filters cleared, all <strong>${fmt.int(resolveStack(ds(), []).length)}</strong> accounts back in scope.`, chips: [] });
        render();
      });
      bar.appendChild(clear);
      chat.appendChild(bar);
    }

    for (const m of state.chat) {
      const box = el('div', 'msg' + (m.who === 'You' ? ' me' : ''));
      box.innerHTML = `<span class="who">${esc(m.who)}</span>`;
      const bubble = el('div', 'bubble');
      if (m.kind === 'query') {
        bubble.appendChild(m.result.unanswerable ? renderCannotAnswer(m.result.unanswerable) : renderQueryAnswer(m.result));
      } else {
        bubble.innerHTML = m.html;
      }
      box.appendChild(bubble);

      /* Suggested next steps are further QUERIES, not free text, which is what
         makes refinement feel continuous rather than like starting over. */
      const acts = el('div', 'acts');
      if (m.kind === 'query' && m.result.actions?.length) {
        m.result.actions.forEach((a) => {
          const b = el('button', 'lv-btn', esc(a.label));
          b.addEventListener('click', () => ask(a.question));
          acts.appendChild(b);
        });
      }
      if (m.chips?.length) m.chips.forEach((c) => { const b = el('button', 'lv-btn', esc(c.label)); b.addEventListener('click', c.fn); acts.appendChild(b); });
      if (acts.childNodes.length) box.appendChild(acts);
      log.appendChild(box);
    }
    chat.appendChild(log);

    /* Template questions, derived from today's data rather than hardcoded, so
       a chip never offers a question whose answer is zero. Shown only as the
       empty state: once someone is asking, the per-answer suggestions are the
       better next step because they refine the current set. */
    if (state.chat.length <= 1) {
      const sug = el('div', 'suggest');
      templateQuestions(ds()).forEach((t) => {
        const b = el('button', '', esc(t.label));
        b.addEventListener('click', () => ask(t.question));
        sug.appendChild(b);
      });
      chat.appendChild(sug);
    }

    const ask_ = el('form', 'chat-ask');
    ask_.innerHTML = '<input id="cpQ" placeholder="Ask about risks, causes, customers, revenue…" autocomplete="off"/><button class="lv-btn primary" type="submit">Ask</button>';
    ask_.addEventListener('submit', (e2) => { e2.preventDefault(); const v = ask_.querySelector('#cpQ').value.trim(); if (v) ask(v); });
    chat.appendChild(ask_);
    p.appendChild(chat);
    wrap.appendChild(p);

    setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
    return wrap;
  }

  /*
    Two answerers, tried in order.

    1. The query layer, for questions about ACCOUNTS: renewals in a window,
       adoption thresholds, exposure, a named customer. These compose, so the
       filter stack narrows and the pills grow.
    2. The insight narratives, for questions about what the ENGINE DETECTED:
       why NPS moved, the backlog, the new-hire QA gap. These read pre-computed
       insight objects and do not filter anything.

    Order matters. The query layer is strict (a question maps to a
    parameterised type or to nothing), so letting it decline first means the
    older narratives still catch everything they always did. If both decline,
    we say so and name what is supported rather than guessing.
  */
  function ask(q) {
    state.chat.push({ who: 'You', html: esc(q), chips: [] });

    const res = runQuery(ds(), state.filters, q);
    if (!res.unanswerable) {
      state.filters = res.nextStack;
      state.chat.push({ who: 'OpsPulse', kind: 'query', result: res, chips: [] });
    } else {
      const a = answer(q);
      if (a.declined) {
        /* Both answerers declined. One combined refusal, listing everything
           either of them could have answered, so the user learns the real
           surface area instead of half of it. */
        state.chat.push({
          who: 'OpsPulse',
          kind: 'query',
          result: { unanswerable: { missing: res.unanswerable.missing, supported: [...SUPPORTED, ...INSIGHT_TOPICS] } },
          chips: [],
        });
      } else {
        state.chat.push({ who: 'OpsPulse', html: a.html, chips: a.chips });
      }
    }

    render();
    setTimeout(() => { const l = body.querySelector('.chat-log'); if (l) l.scrollTop = l.scrollHeight; }, 0);
  }

  /* ── Structured answer rendering ──────────────────────────────────────────
     Every query answer renders in the same order, because the point of this
     surface is that a director learns to read it once:
       headline → the accounts → why → confidence and its limiter → next steps
     The account list is capped at six with the true total always shown, so the
     cap never reads as the answer. */
  const ACCOUNT_CAP = 6;

  function renderQueryAnswer(res) {
    const box = el('div', 'qa');

    box.appendChild(el('div', 'qa-head', `<span class="qa-n">${esc(res.headline.value)}</span><span class="qa-l">${esc(res.headline.label)}</span>`));

    if (res.groups) {
      const t = el('div', 'qa-groups');
      t.innerHTML = res.groups.map((g) => `
        <div class="qa-grp"><span class="qa-grp-l">${esc(g.label)}</span>
        <span class="qa-grp-n">${g.n}</span>
        <span class="qa-grp-a">${esc(fmt.usdK(g.arr))}</span></div>`).join('');
      box.appendChild(t);
    }

    if (res.rows && res.rows.length) {
      const shown = res.rows.slice(0, ACCOUNT_CAP);
      const list = el('div', 'qa-rows');
      list.innerHTML = shown.map((r) => {
        const why = reasonFor(r);
        return `<div class="qa-row">
          <span class="qa-co">${esc(r.company)}<small>${esc(r.account_id)} · renews in ${r.renewal_in_days}d</small></span>
          <span class="qa-why">${esc(why.label)}<small>${esc(why.detail)}</small></span>
          <span class="qa-arr">${esc(fmt.usdK(r.arr_usd))}</span>
        </div>`;
      }).join('');
      box.appendChild(list);
      if (res.total > shown.length) {
        box.appendChild(el('div', 'qa-more', `Showing ${shown.length} of <strong>${res.total}</strong>, largest contracts first.`));
      }
    }

    if (res.why) box.appendChild(el('div', 'qa-why-line', esc(res.why)));

    if (res.confidence && res.confidence.pct != null) {
      box.appendChild(el('div', 'qa-conf',
        `<strong>${res.confidence.pct}% data coverage</strong> · ${esc(res.confidence.limiting_factor)}`));
    }
    return box;
  }

  /* The refusal. Renders no number at all, on purpose: a figure next to "I
     cannot answer this" is the exact thing that gets remembered and quoted. */
  function renderCannotAnswer(u) {
    const box = el('div', 'qa qa-no');
    box.appendChild(el('div', 'qa-no-h', esc(u.missing)));
    box.appendChild(el('div', 'qa-no-b',
      `I will not guess at a number I cannot compute. What I can answer from the data connected today:<ul>${
        (u.supported || SUPPORTED).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`));
    return box;
  }

  /* ── Data Upload ──────────────────────────────────────────────────────── */
  function viewUpload() {
    const d = ds();
    const wrap = el('div', 'lv-view');

    const p = el('div', 'panel');
    p.innerHTML = '<div class="panel-hd"><h3>Data upload</h3><span class="hint">CSV · support tickets, QA reviews, NPS</span></div>';
    const bd = el('div', 'panel-bd');

    const drop = el('div', 'drop');
    drop.innerHTML = `${IC.up}<h4>Drop a CSV here, or click to choose a file</h4>
      <p>Support tickets · QA reviews · NPS responses. Columns are matched automatically. The Kaggle
      <code style="color:var(--cyan)">customer_support_tickets.csv</code> header works as-is, and so do most Zendesk / Freshdesk exports.</p>`;
    const input = el('input');
    input.type = 'file'; input.accept = '.csv,text/csv'; input.hidden = true;
    drop.appendChild(input);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e2) => { e2.preventDefault(); drop.classList.add('hot'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('hot'));
    drop.addEventListener('drop', (e2) => { e2.preventDefault(); drop.classList.remove('hot'); if (e2.dataTransfer.files[0]) handleFile(e2.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
    bd.appendChild(drop);

    const note = el('p', 'muted');
    note.style.cssText = 'font-size:.78rem;margin:12px 0 0;line-height:1.55';
    note.innerHTML = `<b>Excel (.xlsx) is not supported in this offline build</b>. A real xlsx file is a zipped XML package and parsing it needs a library this dependency-free prototype does not ship. Export the sheet as CSV and it will ingest fully. This upload is not a progress bar: rows are parsed, mapped, appended to the live dataset and the nine detectors re-run, so the Decision Feed changes because of your file.`;
    bd.appendChild(note);

    const sample = el('div', 'act-row');
    const dl = el('button', 'lv-btn', `${IC.file}<span>Download a sample CSV (500 tickets)</span>`);
    dl.addEventListener('click', () => {
      const rows = d.tickets.slice(-500).map((t) => ({
        'Ticket ID': t.ticket_id, 'Customer Name': t.customer_name, 'Customer Email': t.customer_email,
        'Customer Age': t.customer_age, 'Customer Gender': t.customer_gender, 'Product Purchased': t.product_purchased,
        'Date of Purchase': t.date_of_purchase, 'Ticket Type': t.ticket_type, 'Ticket Subject': t.ticket_subject,
        'Ticket Description': t.ticket_description, 'Ticket Status': t.ticket_status, 'Resolution': t.resolution,
        'Ticket Priority': t.ticket_priority, 'Ticket Channel': t.ticket_channel,
        'First Response Time': t.first_response_time_min, 'Time to Resolution': t.time_to_resolution_hrs,
        'Customer Satisfaction Rating': t.customer_satisfaction_rating,
      }));
      const blob = new Blob([toCsv(rows, KAGGLE_COLUMNS)], { type: 'text/csv' });
      const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'opspulse-sample-tickets.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Sample downloaded', 'Kaggle customer_support_tickets.csv schema');
    });
    sample.appendChild(dl);
    bd.appendChild(sample);

    const grid = el('div', 'src-grid');
    const srcs = [
      { t: 'Support tickets', c: d.tickets.length, s: `${d.tickets.filter((x) => x.is_uploaded).length} uploaded · ${d.tickets.filter((x) => x.is_live).length} live` },
      { t: 'Escalations', c: d.escalations.length, s: `${d.escalations.filter((x) => x.status !== 'Closed').length} open` },
      { t: 'NPS responses', c: d.nps.length, s: `${d.nps.filter((x) => x.is_uploaded).length} uploaded` },
      { t: 'QA reviews', c: d.qa.length, s: `${d.qa.filter((x) => x.is_uploaded).length} uploaded` },
      { t: 'Accounts', c: d.accounts.length, s: 'customer master' },
      { t: 'Agents', c: d.agents.length, s: `${d.agents.filter((a) => a.cohort === 'new_hire').length} new hires` },
    ];
    for (const s of srcs) grid.appendChild(el('div', 'src-card', `<div class="t">${esc(s.t)}</div><div class="c">${fmt.int(s.c)}</div><div class="s">${esc(s.s)}</div>`));
    bd.appendChild(grid);
    p.appendChild(bd);
    wrap.appendChild(p);

    if (state.lastUpload) {
      const r = state.lastUpload;
      const rp = el('div', 'panel');
      rp.innerHTML = `<div class="panel-hd"><h3>Last ingest · ${esc(r.file)}</h3><span class="hint">${r.ok ? `detected as ${esc(r.kind)} data` : 'rejected'}</span></div>`;
      const rbd = el('div', 'panel-bd');
      if (!r.ok) {
        rbd.innerHTML = `<p style="color:var(--danger);font-size:.86rem;margin:0">${esc(r.error)}</p>
          <p class="muted" style="font-size:.78rem;margin-top:8px">Headers found: ${(r.headers || []).map((h) => `<code>${esc(h)}</code>`).join(', ') || '—'}</p>`;
      } else {
        rbd.innerHTML = `
          <div class="drill-kpis">
            <div><div class="k">Rows in file</div><div class="v">${fmt.int(r.total_rows)}</div></div>
            <div><div class="k">Ingested</div><div class="v" style="color:${STATUS.good}">${fmt.int(r.added)}</div></div>
            <div><div class="k">Skipped</div><div class="v" style="color:${r.skipped ? STATUS.warning : 'inherit'}">${fmt.int(r.skipped)}</div></div>
            <div><div class="k">Columns mapped</div><div class="v">${Object.keys(r.mapped_columns).length}</div></div>
          </div>
          <table class="map-table"><thead><tr><th>Your column</th><th>Mapped to</th></tr></thead><tbody>
            ${Object.entries(r.mapped_columns).map(([f, h]) => `<tr><td><code>${esc(h)}</code></td><td>${esc(f.replace(/_/g, ' '))}</td></tr>`).join('')}
          </tbody></table>
          ${r.unmatched_fields.length ? `<p class="muted" style="font-size:.76rem;margin-top:10px">Not found in your file (defaults used): ${r.unmatched_fields.map((f) => `<code>${esc(f)}</code>`).join(', ')}</p>` : ''}
          ${r.errors.length ? `<p style="font-size:.76rem;margin-top:10px;color:var(--warn)">${r.errors.map(esc).join('<br>')}</p>` : ''}
          <p class="muted" style="font-size:.78rem;margin-top:10px">The engine re-ran over the combined dataset. Check the Decision Feed for what changed.</p>`;
      }
      rp.appendChild(rbd);
      wrap.appendChild(rp);
    }
    return wrap;
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = store.ingestCsv(String(reader.result));
      state.lastUpload = { ...res, file: file.name };
      state.view = 'upload';
      render();
      if (res.ok) toast(`Ingested ${res.added} rows`, `${file.name} → ${res.kind} data · engine re-ran`);
      else toast('Could not ingest that file', res.error);
    };
    reader.readAsText(file);
  }

  /* ── Render loop ──────────────────────────────────────────────────────── */
  function render() {
    renderNav();
    const scrollTop = body.scrollTop;
    body.innerHTML = '';
    const v = state.view === 'dash' ? viewDashboard()
      : state.view === 'feed' ? viewFeed()
      : state.view === 'radar' ? viewRadar()
      : state.view === 'copilot' ? viewCopilot()
      : viewUpload();
    body.appendChild(v);
    body.scrollTop = scrollTop;
    refreshChrome();
  }

  const toggleBtn = root.querySelector('#opToggle');
  toggleBtn.addEventListener('click', () => store.toggle());
  root.querySelector('#opReseed').addEventListener('click', () => {
    const s = store.reseed();
    state.chat = []; state.selected = null; state.lastUpload = null;
    toast('New operation generated', `seed ${s} · same four patterns, different everything else`);
    render();
  });

  function refreshChrome() {
    const c = store.counters;
    root.querySelector('#opLive').textContent = store.running ? `live · ${c.added} in · ${c.escalated} esc` : 'paused';
    root.querySelector('#opDot').className = 'lv-dot' + (store.running ? '' : ' off');
    toggleBtn.innerHTML = store.running ? `${IC.pause}<span>Pause</span>` : `${IC.play}<span>Resume</span>`;
  }

  const unsub = store.subscribe((evt) => {
    // Cheap ticks only refresh the ticker + chrome; a full re-render waits for
    // the engine pass, so the top-3 cannot flicker while someone is reading it.
    if (evt.type === 'tick') {
      refreshChrome();
      const busy = !modal.hidden || (body.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT');
      // A render deferred while the user was busy flushes on the first tick
      // after they are done, so the page never sits on stale insights.
      if (dirty && !busy) { dirty = false; render(); return; }
      if (!busy) {
        // The KPI numbers are the ones NorthDesk also shows, so they track the
        // tick; the cards behind them still wait for the engine pass.
        refreshKpis();
        const tk = body.querySelector('.ticker');
        if (tk) tk.replaceWith(tickerPanel().querySelector('.ticker'));
      }
      return;
    }
    if (evt.type === 'engine' || evt.type === 'reset') {
      // Never rebuild the DOM out from under someone who is mid-interaction:
      // an open drill-down, or a half-typed question in the copilot / search
      // box (render() recreates the input, dropping its value and focus).
      const typing = body.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT';
      if (!modal.hidden || typing) { dirty = true; refreshChrome(); return; }
      render();
    }
  });

  render();
  return { destroy: () => { unsub(); modal.remove(); toasts.remove(); container.innerHTML = ''; } };
}

/* ── local helpers ───────────────────────────────────────────────────────── */
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
function firstSentence(s) { const m = String(s).match(/^[^.]+\./); return m ? m[0] : String(s); }
function largestExposure(e) {
  return e.insights.filter((i) => i.expected_impact.range_high_usd != null)
    .sort((a, b) => b.expected_impact.range_high_usd - a.expected_impact.range_high_usd)[0] || e.insights[0];
}
function hourGreeting() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; }
function relTime(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 5 ? 'now' : s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h';
}
function weekLabels(d) {
  const out = [];
  for (let w = 0; w < Math.floor(d.meta.days / 7); w++) out.push(dayLabel(d, w * 7));
  return out;
}
function weekAgg(d, items, pred) {
  const weeks = Math.floor(d.meta.days / 7);
  const out = new Array(weeks).fill(0);
  for (const it of items) {
    const w = Math.floor(it.day_index / 7);
    if (w >= 0 && w < weeks && pred(it)) out[w]++;
  }
  return out;
}
