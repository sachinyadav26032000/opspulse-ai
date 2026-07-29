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
import { CONFIDENCE_CUTOFF, SIGNAL_TYPES } from '../engine/web/schema.js';
import { buildCohort, WINDOWS, COHORT_DEFAULTS } from '../engine/web/cohort.js';
import { TUNABLE, setTunable } from '../config/thresholds.js';
import { buildAccountDetail } from '../engine/web/exposure.js';

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
  ledger: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l8 3.5v5.7c0 4.3-3.2 7.6-8 8.8-4.8-1.2-8-4.5-8-8.8V6.5L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m8.8 12 2.2 2.2 4.2-4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>',
  renew: '<svg viewBox="0 0 24 24" fill="none"><path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4v4.5H8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v-4.5h-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

const sevClass = (s) => (s >= 70 ? '' : s >= 50 ? 'sev-med' : 'sev-low');
/* Severity bands for the executive brief.
   --------------------------------------------------------------------------
   The brief holds a HIGHER bar than the feed, deliberately. sevClass (above)
   flags anything ≥70 so the operational feed surfaces everything notable —
   but measured over the engine's own output, 56% of insights clear 70 and the
   median is 74. A word that applies to most of the list is not a priority
   signal, and an executive brief that cries critical five times a day gets
   ignored on the sixth.

   At 80 the critical band is ~24% of insights — about two per run — which is
   what makes "default to three, expand when there are genuinely more" behave
   the way it reads. This is the one number to turn if the brief feels too
   quiet or too loud; nothing else needs to change with it. */
const CRITICAL_AT = 80;
const HIGH_AT = 55;
const BANDS = {
  critical: { label: 'Critical', quietLabel: 'Highest open', color: STATUS.critical },
  high: { label: 'High', quietLabel: 'High', color: STATUS.warning },
  medium: { label: 'Medium', quietLabel: 'Medium', color: SERIES[0] },
};
const bandOf = (i) => (i.severity_score >= CRITICAL_AT ? 'critical' : i.severity_score >= HIGH_AT ? 'high' : 'medium');

/**
 * Which decisions the executive brief puts in front of someone today.
 *
 * Exported because the Live Ops Floor's reduction band has to end on the same
 * number the brief shows — two places computing "how many decisions" from the
 * same insights and disagreeing would undermine the exact claim that screen is
 * making. One implementation, both callers.
 *
 * Every critical is included (unioned first, so a high-severity item that ranks
 * low on priority cannot fall off the bottom), topped up to three for
 * readability, and sorted so the bands stay contiguous.
 */
export const BRIEF_LIMIT = 4;

/**
 * What the executive brief puts in front of someone today.
 *
 * Ranked by REVENUE IMPACT, not severity. A support-operations decision can be
 * severity 86 and still be the wrong thing to lead a CRO with; the question the
 * brief answers is "what is this worth", so that is what orders it.
 *
 * Capped at BRIEF_LIMIT. Everything below the cut stays fully available in the
 * Decision Feed and the Workspace — nothing is discarded, and the caller is
 * given the cut list so the brief can say what it left out and why. A brief
 * that silently drops decisions is indistinguishable from one that never
 * found them.
 */
export function briefSelection(insights, limit = BRIEF_LIMIT) {
  const worth = (i) => (i.expected_impact.range_low_usd == null
    ? 0
    : (i.expected_impact.range_low_usd + i.expected_impact.range_high_usd) / 2);

  const ranked = (insights || []).slice().sort((a, b) => {
    const d = worth(b) - worth(a);
    return d !== 0 ? d : b.severity_score - a.severity_score;   // severity breaks ties only
  });

  const shown = ranked.slice(0, limit);
  const cut = ranked.slice(limit);
  const cutWorth = cut.reduce((s, i) => s + worth(i), 0);

  return {
    shown,
    cut,
    worth,
    sizing: {
      matched: ranked.length,
      shown: shown.length,
      cut: cut.length,
      cut_worth: cutWorth,
      shown_worth: shown.reduce((s, i) => s + worth(i), 0),
      uncosted_cut: cut.filter((i) => worth(i) === 0).length,
      basis: 'revenue impact (midpoint of the costed range), descending',
    },
  };
}

/** Back-compatible: the Live Ops Floor reduction band counts this array. */
export function selectBriefDecisions(insights, limit = BRIEF_LIMIT) {
  return briefSelection(insights, limit).shown;
}

/* A decision is taken against a SIGNAL, not against an insight_id: the engine
   rebuilds insight objects on every pass, so the id churns while the underlying
   problem persists. Keying on signal type + entity is what lets the ledger say
   "this is the same problem you decided on twenty minutes ago". */
const signalKey = (i) => `${i.signal_type}::${i._meta?.entity?.key ?? '_'}`;
const moneyRange = (i) => {
  const e = i.expected_impact;
  if (e.range_low_usd == null) return 'Not costed';
  return `${fmt.usdK(e.range_low_usd)} – ${fmt.usdK(e.range_high_usd)}`;
};
const unitFmt = (u) => (u === 'rate' ? fmt.pct : u === 'per_day' ? fmt.one : u === 'stars' ? fmt.stars : u === 'nps' ? fmt.nps : u === 'score' ? fmt.one : fmt.int);

/* Whose morning is it. Persisted so the greeting survives a reload; a mount
   option overrides it, which is the seam a real auth layer plugs into later. */
const USER_KEY = 'opspulse.user.v1';
const loadUser = (fallback) => { try { return localStorage.getItem(USER_KEY) || fallback; } catch { return fallback; } };
const saveUser = (n) => { try { localStorage.setItem(USER_KEY, n); } catch { /* privacy mode — the greeting just resets next load */ } };

export function mountOpsPulse(root, store, { onOpenTicket, user } = {}) {
  root.classList.add('op-root');
  root.innerHTML = '';

  const state = {
    view: 'today', filter: 'all', q: '', selected: null, chat: [], lastUpload: null,
    user: user || loadUser('Sudharshan'),
    focus: null,   // signal_key returned from the workspace — highlighted, never auto-committed
    drillId: null,     // decision being drilled into (Level 2)
    drillAccount: null, // account being drilled into (Level 3)
    /* adoption_risk_pct is deliberately ABSENT, not copied from COHORT_DEFAULTS.
       buildCohort falls back to config when it is undefined, so the Assurance
       dial reaches this view; spreading it here would snapshot 60 at mount and
       silently ignore the dial forever. It is set only once the user edits the
       cohort's own field, which then means "I want this view different". */
    cohort: { scope: COHORT_DEFAULTS.scope, window: COHORT_DEFAULTS.window, scopeValue: null },
  };

  /* Coming back from the workspace via "Take action". We highlight the decision
     and scroll to it; we deliberately do NOT auto-commit, because committing is
     the human act the whole ledger exists to record. */
  try {
    const back = new URLSearchParams(location.search).get('decide');
    if (back) state.focus = back;
  } catch { /* no location in a non-browser host — the briefing still renders */ }

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
    <button class="lv-btn" id="opData" title="Connect a source — CSV ingest and the current signal inventory">${IC.up}<span>Data</span></button>
    <button class="lv-btn" id="opToggle">${IC.pause}<span>Pause</span></button>
    <button class="lv-btn" id="opReseed" title="Generate a different random operation with the same four patterns">${IC.dice}<span>New data</span></button>`;
  root.appendChild(top);

  const body = el('div', 'lv-body');
  root.appendChild(body);

  /* Nav order IS the argument: detect → rank → commit → interrogate → audit.
     Data ingest is deliberately NOT here — it is a source-connection chore, not
     a decision surface, and putting it at this level made the product read as a
     file uploader with charts. It lives in the top chrome instead. */
  /* Four tabs, and they have to fit on one line beside the logo and the
     controls at 1280px — seven overflowed by ~250px and silently scrolled.

     Executive Copilot is deliberately NOT here. It is a tool you reach from
     wherever you are (a decision card, Cmd+K, the docked rail), not a place
     you navigate to; giving it a tab would mean taking it away again. It stays
     reachable from the brief's "Ask about the operation" while the rail is built. */
  const NAV = [
    { id: 'today', label: 'Today', icon: IC.sun },
    { id: 'feed', label: 'Decision Feed', icon: IC.feed, badge: () => store.engine.insights.length },
    { id: 'cohort', label: 'Renewals', icon: IC.renew },
    { id: 'radar', label: 'Risk Radar', icon: IC.radar },
  ];
  /* Reachable, de-emphasised. Both are surfaces you go to on purpose rather
     than pass through, so neither earns a permanent slot. */
  const NAV_MORE = [
    /* Workspace moved here to make room for Renewals, which is the workflow the
       buyer actually described. Workspace is an investigation surface reached
       from a decision card or the drill-down, not somewhere you navigate to
       cold — and a fifth primary tab overflowed the header at 1280px, which
       would bring back the silently-scrolling nav. One line to swap back. */
    { id: 'dash', label: 'Workspace', icon: IC.home },
    { id: 'ledger', label: 'Decision Ledger', icon: IC.ledger, badge: () => store.decisions.filter((x) => x.status !== 'closed').length },
    { id: 'assurance', label: 'Assurance', icon: IC.shield },
  ];

  const nav = root.querySelector('#opNav');
  let moreOpen = false;

  const navBtn = (n, cls) => {
    const bv = n.badge ? n.badge() : 0;
    const b = el('button', cls, `${n.icon}<span>${esc(n.label)}</span>${bv ? `<span class="badge">${bv}</span>` : ''}`);
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      moreOpen = false;
      state.view = n.id; render(); body.scrollTop = 0;
    });
    return b;
  };

  function renderNav() {
    nav.innerHTML = '';
    for (const n of NAV) nav.appendChild(navBtn(n, state.view === n.id ? 'on' : ''));

    const inMore = NAV_MORE.some((n) => n.id === state.view);
    const wrapMore = el('div', 'lv-more');
    const trigger = el('button', inMore ? 'on' : '', `${IC.more}<span>More</span>`);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', String(moreOpen));
    trigger.addEventListener('click', (ev) => { ev.stopPropagation(); moreOpen = !moreOpen; renderNav(); });
    wrapMore.appendChild(trigger);

    if (moreOpen) {
      const menu = el('div', 'lv-more-menu');
      menu.setAttribute('role', 'menu');
      for (const n of NAV_MORE) menu.appendChild(navBtn(n, state.view === n.id ? 'on' : ''));
      wrapMore.appendChild(menu);
      setTimeout(() => menu.querySelector('button')?.focus(), 0);
    }
    nav.appendChild(wrapMore);
  }

  /* Close the overflow on an outside click or Escape — a menu that only closes
     by re-clicking its trigger is a trap. */
  document.addEventListener('click', () => { if (moreOpen) { moreOpen = false; renderNav(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && moreOpen) { moreOpen = false; renderNav(); } });

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
  const labelsFor = (from, to) => { const d = ds(); const out = []; for (let i = from; i <= to; i++) out.push(dayLabel(d, i)); return out; };
  const win = (n) => { const d = ds(); const to = d.meta.days - 1; return { from: Math.max(0, to - n + 1), to }; };
  const releaseMarkers = (from) => ds().meta.releases.filter((r) => r.day >= from).map((r) => ({ i: r.day - from, label: r.kind === 'policy' ? 'policy' : r.kind === 'org' ? 'new hires' : 'release' }));

  /**
   * A dense row of stat tiles. Reuses .kpi-strip/.kpi so these read as the same
   * component family as the dashboard strip rather than a second visual language.
   * `onClick` is optional — a tile that goes nowhere renders as static.
   */
  function statStrip(items) {
    const strip = el('div', 'kpi-strip');
    for (const it of items) {
      const c = el('div', 'kpi' + (it.onClick ? '' : ' static'),
        `<div class="k">${esc(it.k)}</div>
         <div class="v" ${it.color ? `style="color:${it.color}"` : ''}>${esc(it.v)}</div>
         ${it.spark ? sparkline(it.spark, { color: it.sparkColor || SERIES[0] }) : `<div class="s">${esc(it.s || '')}</div>`}`);
      if (it.onClick) c.addEventListener('click', it.onClick);
      strip.appendChild(c);
    }
    return strip;
  }

  /* Band counts drive several of the new summaries. */
  const bandCounts = (list) => list.reduce((a, i) => { a[bandOf(i)] = (a[bandOf(i)] || 0) + 1; return a; }, { critical: 0, high: 0, medium: 0 });
  const bandColor = (i) => (bandOf(i) === 'critical' ? STATUS.critical : bandOf(i) === 'high' ? STATUS.warning : SERIES[0]);
  const medianOf = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);

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
    const blocks = [];

    /* Revenue signals key off product usage, which arrives as two 30-day
       windows rather than a daily series — so `_meta.series` is legitimately
       null. Showing no trend line is correct; fabricating 45 daily points from
       two readings would be inventing data to fill a chart. */
    const vals = m.series ? m.series.values.slice(from, to + 1) : null;

    const fmtFor = unitFmt(m.unit);

    if (vals) blocks.push(lineChart({
      title: `${m.metric_label ? m.entity.label + ' — ' : ''}${ins._meta.title}`,
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
        note: 'Contributions are shares of the measured delta and sum to 100% — this is attribution by decomposition, not a guess about cause.',
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
        title: 'New-hire agents by QA score', subtitle: 'lowest first — this is the coaching list',
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
        note: '7-day rolling means. Capacity did not change; demand did — which is why the queue grows.',
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
        { title: 'The save list', hint: 'sorted by ARR — work top-down' },
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
          barChart({ title: 'Detractor drivers — current window', rows: countBy(rec.filter((r) => r.segment === 'detractor'), (r) => String(r.driver_tag).replace(/-/g, ' '), 6), color: STATUS.critical }),
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
              { key: `${k.replace(/_/g, ' ')} — tenured`, value: mean(tn.map((q) => q.dimensions[k])), color: SERIES[0] },
              { key: `${k.replace(/_/g, ' ')} — new hire`, value: mean(nh.map((q) => q.dimensions[k])), color: STATUS.serious },
            ]), format: (v) => Math.round(v), maxRows: 12 }),
        ],
      };
    },
    escalations: () => {
      const d = ds();
      const open = d.escalations.filter((e) => e.status !== 'Closed');
      const rec = d.escalations.filter((e) => e.day_index >= d.meta.recent_from);
      return {
        title: 'Escalations', subtitle: 'Where work is leaving the normal path — the earliest warning a desk gets.',
        kpis: [
          { k: 'Open', v: fmt.int(open.length), s: 'not yet closed' },
          { k: 'In window', v: fmt.int(rec.length), s: `${d.meta.days - d.meta.recent_from} days` },
          { k: 'P1', v: fmt.int(open.filter((e) => e.severity === 'P1').length), s: 'highest severity', color: STATUS.critical },
          { k: 'Past response SLA', v: fmt.int(d.escalations.filter((e) => e.sla_breached).length), s: 'breaching now' },
        ],
        blocks: [
          lineChart({ title: 'Escalations per day', labels: labelsFor(0, d.meta.days - 1), series: [{ name: 'Escalations', values: rolling(countByDay(d.escalations, d.meta.days), 7) }], format: fmt.one, area: true, markers: releaseMarkers(0) }),
          (() => { const g = el('div', 'grid2');
            g.appendChild(barChart({ title: 'By category — current window', rows: countBy(rec, (e) => e.category, 8), color: STATUS.serious }));
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

  /* Open the cohort surface from the brief. Scope and window are FORCED to
     match the detector's own query — company-wide, and the same renewal window
     it counted. Landing on the region-scoped quarter default would show 48
     accounts under a card that just said 128, and the first thing the user
     would conclude is that one of the two numbers is wrong. */
  function openCohort() {
    state.cohort.scope = 'all';
    state.cohort.scopeValue = null;
    state.cohort.window = 'd90';
    delete state.cohort.adoption_risk_pct;   // follow the configured dial
    state.view = 'cohort';
    render();
    body.scrollTop = 0;
  }

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
        <div><dt>Impact</dt><dd>${drillable(ins)
          ? `<span class="drill-link" data-drill="1" role="button" tabindex="0" title="${m.scope_is_full ? `Open the ${fmt.int(m.affected_accounts)}-account cohort` : `Open the ${m.exposed_accounts.length} exposed accounts`}">${fmt.int(m.affected_accounts)} customers${m.evidence.arr_at_risk ? ` · ${fmt.usdK(m.evidence.arr_at_risk)} ARR` : ''} <i>›</i></span>`
          : `${fmt.int(m.affected_accounts)} customers${m.evidence.arr_at_risk ? ` · ${fmt.usdK(m.evidence.arr_at_risk)} ARR` : ''}`}</dd></div>
        <div><dt>Root cause <span class="muted">(hypothesis)</span></dt><dd>${esc(firstSentence(ins.why.root_cause))}</dd></div>
        <div><dt>Recommended action</dt><dd>${esc(ins.recommended_action.action)}</dd></div>
        <div><dt>${ins.expected_impact.range_low_usd == null ? 'Exposure' : 'Value at stake'}</dt><dd class="money">${esc(moneyRange(ins))}</dd></div>
      </dl>
      <div class="foot">
        <span class="conf" title="${esc(ins.confidence ? ins.confidence.limiting_factor : 'Confidence = 45% statistical strength + 30% share of change explained + 25% corroborating signals')}">
          <span class="bar"><i style="width:${Math.round(ins.why.confidence * 100)}%"></i></span><b>${Math.round(ins.why.confidence * 100)}%</b> confidence
        </span>
        <span class="chip">${esc(ins.recommended_action.owner_role)}</span>
        ${ins.status === 'held_for_review' ? '<span class="chip held">held for review</span>' : ''}
      </div>`;
    const link = c.querySelector('[data-drill]');
    if (link) {
      /* A cohort-wide decision opens the cohort, not the six accounts it named
         as examples — those six are illustrative, and landing on them would
         answer a question the card didn't ask. */
      const go = (ev) => { ev.stopPropagation(); if (ins.signal_type === 'renewal_cohort') openCohort(); else openAccounts(ins); };
      link.addEventListener('click', go);
      link.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(ev); } });
    }
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
          <span class="conf" title="${esc(ins.confidence ? ins.confidence.limiting_factor : '')}"><span class="bar"><i style="width:${Math.round(ins.why.confidence * 100)}%"></i></span><b>${Math.round(ins.why.confidence * 100)}%</b></span>
          ${ins.confidence?.coverage_capped ? '<span class="chip held" title="' + esc(ins.confidence.limiting_factor) + '">coverage-capped</span>' : ''}
        </div>
      </div>
      <div class="right"><div class="m">${esc(moneyRange(ins))}</div><div class="h">${drillable(ins)
        ? `<span class="drill-link" data-drill="1" role="button" tabindex="0">${fmt.int(m.affected_accounts)} customers <i>›</i></span>`
        : `${fmt.int(m.affected_accounts)} customers`} · ${ins.expected_impact.time_horizon_days}d</div></div>`;
    const flink = r.querySelector('[data-drill]');
    if (flink) {
      const go = (ev) => { ev.stopPropagation(); openAccounts(ins); };
      flink.addEventListener('click', go);
      flink.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(ev); } });
    }
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
        Correlation, not confirmed cause — a human closes that gap.
      </p>
      ${ins.confidence ? `<p class="limiting"><b>Limiting factor:</b> ${esc(ins.confidence.limiting_factor)}</p>` : ''}
      <ul class="evidence">${ins.why.contributing_signals.map((s) => `<li><span class="mark ${s.hit ? 'y' : 'n'}">${s.hit ? '✓' : '–'}</span><span>${esc(s.label)} <span class="det">— ${esc(s.detail)}</span></span></li>`).join('')}</ul>`;
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
      const existing = store.decisions.find((x) => x.signal_key === signalKey(ins) && x.status !== 'closed');
      const decide = el('button', 'lv-btn', existing ? `In the ledger — ${esc(existing.decision_id)}` : `Commit decision → ${esc(ins.recommended_action.owner_role)}`);
      decide.addEventListener('click', () => commitDecision(ins));
      const json = el('button', 'lv-btn', 'View insight JSON');
      json.addEventListener('click', () => showJson(ins));
      acts.appendChild(open); acts.appendChild(decide); acts.appendChild(json);
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
    openDrill({ title: 'Insight contract', subtitle: 'Every card on this screen is a rendering of this object — nothing reaches the UI as free text.', blocks: [panel] });
  }

  /* ══════════════════════════════════════════════════════════════════════
     SCREENS
     ══════════════════════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════════════════
     TODAY — the morning briefing, and the first thing anyone sees
     ----------------------------------------------------------------------
     This screen exists because the old first screen answered "how is the
     operation doing?" when the only question a director actually opens with
     is "what do I have to decide today, and what does it cost me if I don't?"

     Every sentence here is generated from the insight objects. None of the
     numbers are written into the template — if the engine finds a quieter
     week, this screen says so rather than manufacturing three crises.
     ══════════════════════════════════════════════════════════════════════ */

  const midUsd = (i) => (i.expected_impact.range_low_usd == null ? null
    : (i.expected_impact.range_low_usd + i.expected_impact.range_high_usd) / 2);

  /* The workspace (app.html) is a separate page with its own dashboard. It
     cannot read our in-memory engine, so the decision travels with the link as
     context — enough for the workspace to say what you are investigating and
     to hand you back with the same decision in focus. */
  function workspaceHref(ins) {
    const q = new URLSearchParams({
      signal: signalKey(ins),
      t: ins._meta.title,
      metric: ins._meta.metric_label || '',
      sev: String(ins.severity_score),
      conf: String(Math.round(ins.why.confidence * 100)),
      owner: ins.recommended_action.owner_role,
      pb: ins.recommended_action.playbook_id,
      money: moneyRange(ins),
      act: ins.recommended_action.action,
      band: bandOf(ins),
    });
    return `app.html?${q.toString()}`;
  }

  /** Open tickets that cross the 72-hour mark within the next 48 hours. */
  function crossing72hIn48h() {
    const d = ds(), now = d.meta.as_of;
    return openTickets(d).filter((t) => { const a = (now - t.created_at) / 3600000; return a >= 24 && a < 72; }).length;
  }

  /** The consequence of doing nothing, in one sentence. */
  function consequenceLine(ins) {
    const m = ins._meta, ev = m.evidence || {}, days = ins.expected_impact.time_horizon_days;
    const money = moneyRange(ins);
    const label = esc(m.entity?.label || m.entity?.key || 'This signal');
    const B = (s) => `<b>${s}</b>`;

    switch (ins.signal_type) {
      case 'escalation_spike':
        return `${B(label + ' escalations')} are likely to cost ${B(money)} over the next ${B(days + ' days')}.`;
      case 'emerging_topic': {
        const lift = m.baseline ? (m.observed / m.baseline) : null;
        return `${B(label + ' contacts')} are running ${lift ? B(lift.toFixed(1) + '×') + ' their baseline' : 'well above baseline'} — ${B(money)} at stake over ${days} days.`;
      }
      case 'backlog_risk': {
        const n = crossing72hIn48h();
        return `${B(fmt.int(n) + ' open tickets')} cross the 72-hour SLA ${B('within 48 hours')} — the queue is growing ${B(Number(ev.slope_per_day || 0).toFixed(1) + '/day')}.`;
      }
      case 'churn_risk':
        return `Churn risk increased for ${B(fmt.int(ev.enterprise_count ?? m.affected_accounts) + ' enterprise accounts')} — ${B(fmt.usdK(ev.arr_at_risk || 0))} of ARR, ${B(fmt.int(ev.renewal_within_90d || 0))} renewing inside 90 days.`;
      case 'coaching_gap':
        return `The new-hire cohort is ${B(Number(ev.gap_pts || 0).toFixed(1) + ' QA points')} behind tenured agents — ${B(money)} in rework over ${days} days.`;
      case 'nps_drop':
        return `NPS fell ${B(Number(ev.drop_pts || 0).toFixed(0) + ' points')} to ${B(fmt.nps(m.observed))} — ${B(fmt.usdK(ev.detractor_arr || 0))} of ARR sits behind those responses.`;
      case 'csat_drop':
        return `CSAT dropped to ${B(fmt.stars(m.observed))} from ${B(fmt.stars(m.baseline))} — ${B(money)} at stake over ${days} days.`;
      case 'sla_risk':
        return `First-response SLA breaches rose to ${B(fmt.pct(m.observed))} from ${B(fmt.pct(m.baseline))} — ${B(money)} over ${days} days.`;
      case 'compliance_risk':
        return `${B(fmt.int(ev.dsar_due_within_10d || ev.dsar_open || 0) + ' statutory requests')} fall due within 10 days${ev.dsar_past_due ? `, and ${B(fmt.int(ev.dsar_past_due))} are already past due` : ''} — ${B('deliberately not costed')}.`;
      default:
        return esc(ins.what_happened);
    }
  }

  /** The action, named as specifically as the evidence allows. */
  function actionLine(ins) {
    const m = ins._meta, ev = m.evidence || {};
    const base = ins.recommended_action.action;
    const top = m.decomposition?.[0];
    let detail = '';

    switch (ins.signal_type) {
      case 'churn_risk': {
        const a = ev.top_accounts?.[0];
        if (a) detail = `Start with ${a.company} — ${fmt.usdK(a.arr_usd)} ARR, renews in ${a.renewal_in_days} days.`;
        break;
      }
      case 'coaching_gap': {
        const worst = ev.per_agent?.slice().sort((x, y) => x.score - y.score)[0];
        if (worst) detail = `Start with ${worst.name} — lowest at ${Math.round(worst.score)} on ${worst.n} reviews.`;
        break;
      }
      case 'compliance_risk': {
        const soonest = ev.items?.[0];
        if (soonest) detail = `${soonest.ticket_id} for ${soonest.company} is due in ${soonest.days_left} days.`;
        break;
      }
      case 'backlog_risk':
        if (top) detail = `${String(top.key).replace(/[-_]/g, ' ')} is the largest driver at ${fmt.pct0(top.contribution)} of the growth.`;
        break;
      default:
        if (top) detail = `${String(top.key).replace(/[-_]/g, ' ')} explains ${fmt.pct0(top.contribution)} of the change.`;
    }
    return { base, detail };
  }

  function renderGreeting(host) {
    const h = el('div', 'brief-greet');
    h.innerHTML = `<h1>Good ${hourGreeting()}, <button class="brief-name" title="Click to change who this briefing is for">${esc(state.user)}</button>.</h1>`;
    h.querySelector('.brief-name').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const btn = ev.currentTarget;
      const input = el('input', 'brief-name-input');
      input.value = state.user;
      input.setAttribute('aria-label', 'Your name');
      const commit = () => {
        const v = input.value.trim();
        if (v) { state.user = v; saveUser(v); }
        render();
      };
      input.addEventListener('keydown', (k) => { if (k.key === 'Enter') commit(); if (k.key === 'Escape') render(); });
      input.addEventListener('blur', commit);
      btn.replaceWith(input);
      input.focus(); input.select();
    });
    host.appendChild(h);
  }

  /* ══════════════════════════════════════════════════════════════════════
     THE DRILL-DOWN SPINE — decision → exposed accounts → one account
     ----------------------------------------------------------------------
     One path, three levels deep, rather than making everything shallowly
     clickable. The money figure on a decision IS the affordance; there is no
     extra button, because the thing you want to interrogate is the number.

     No router, by decision. Levels are held in `state` and the breadcrumb is
     the only way back — browser back would need history integration that
     touches how every existing surface is entered.
     ══════════════════════════════════════════════════════════════════════ */

  const drillable = (ins) => (ins?._meta?.exposed_accounts?.length || 0) > 0;

  function openAccounts(ins) {
    state.drillId = ins.insight_id;
    state.drillAccount = null;
    state.view = 'accounts';
    render(); body.scrollTop = 0;
  }
  function openAccount(accountId) {
    state.drillAccount = accountId;
    state.view = 'account';
    render(); body.scrollTop = 0;
  }
  const drilledInsight = () => eng().insights.find((i) => i.insight_id === state.drillId);

  /** Persistent across all three levels. Each crumb is a real way back. */
  function breadcrumb(trail) {
    const bc = el('nav', 'crumbs');
    bc.setAttribute('aria-label', 'Breadcrumb');
    trail.forEach((c, i) => {
      const last = i === trail.length - 1;
      if (last) {
        const cur = el('span', 'crumb on', esc(c.label));
        cur.setAttribute('aria-current', 'page');
        bc.appendChild(cur);
      } else {
        const b = el('button', 'crumb', esc(c.label));
        b.addEventListener('click', c.go);
        bc.appendChild(b);
        bc.appendChild(el('span', 'sep', '›'));
      }
    });
    return bc;
  }

  const toBrief = () => { state.view = 'today'; state.drillId = null; state.drillAccount = null; render(); body.scrollTop = 0; };
  const toAccounts = () => { state.drillAccount = null; state.view = 'accounts'; render(); body.scrollTop = 0; };

  /* ── LEVEL 2 · the exposed accounts ──────────────────────────────────── */
  function viewAccounts() {
    const ins = drilledInsight();
    const wrap = el('div', 'lv-view drill-level');
    if (!ins) { wrap.appendChild(el('div', 'empty', 'That decision is no longer in the current feed.')); return wrap; }

    const m = ins._meta;
    const accts = (m.exposed_accounts || []).slice().sort((a, b) => b.arr_usd - a.arr_usd);
    const total = accts.reduce((s2, a) => s2 + a.arr_usd, 0);

    wrap.appendChild(breadcrumb([
      { label: 'Today', go: toBrief },
      { label: m.title },
    ]));

    /* The parent decision stays visible — you must never lose the thread of
       which decision you are inside. */
    const hd = el('div', 'drill-parent');
    hd.innerHTML = `
      <div class="dp-band bd-${bandOf(ins)}"></div>
      <div class="dp-main">
        <div class="dp-kicker">Exposed accounts behind this decision</div>
        <h2>${esc(m.title)}</h2>
        <p class="dp-sub">${esc(ins.what_happened)}</p>
        <div class="dp-meta">
          <span><b>${esc(moneyRange(ins))}</b> over ${ins.expected_impact.time_horizon_days} days</span>
          <span><b>${Math.round(ins.why.confidence * 100)}%</b> confidence</span>
          <span>${esc(ins.recommended_action.owner_role)}</span>
          ${ins.confidence?.coverage_capped ? '<span class="chip held">coverage-capped</span>' : ''}
        </div>
        ${ins.confidence ? `<p class="limiting"><b>Limiting factor:</b> ${esc(ins.confidence.limiting_factor)}</p>` : ''}
      </div>`;
    wrap.appendChild(hd);

    const p = el('div', 'panel');
    p.innerHTML = `<div class="panel-hd"><h3>${accts.length} accounts, largest exposure first</h3>
      <span class="hint">${m.sizing ? esc(m.sizing.note) : 'every matched account'}</span></div>`;
    const bd = el('div', 'panel-bd tight');

    const rows = el('div', 'acct-list');
    accts.forEach((a, i) => {
      const urgent = a.renewal_in_days <= 30;
      const r = el('button', 'acct-row' + (urgent ? ' urgent' : ''));
      r.innerHTML = `
        <span class="ar-n">${String(i + 1).padStart(2, '0')}</span>
        <span class="ar-name">${esc(a.account_name)}<small>${esc(a.plan)} · ${esc(a.region)} · ${esc(a.owner)}</small></span>
        <span class="ar-arr">${esc(fmt.usd(a.arr_usd))}</span>
        <span class="ar-ren">${a.renewal_in_days}d<small>${esc(a.renewal_date)}</small></span>
        <span class="ar-why">${esc(a.risk_reason)}</span>
        <span class="ar-go" aria-hidden="true">›</span>`;
      r.addEventListener('click', () => openAccount(a.account_id));
      rows.appendChild(r);
    });
    bd.appendChild(rows);

    /* Reconciliation. A drill-down whose rows do not add up to the headline is
       the fastest way to lose a room. */
    const foot = el('div', 'acct-total');
    const matches = m.evidence?.arr_at_risk_scoped == null || Math.round(m.evidence.arr_at_risk_scoped) === Math.round(total);
    foot.innerHTML = `
      <span>Total, ${accts.length} account${accts.length === 1 ? '' : 's'} shown</span>
      <b>${esc(fmt.usd(total))}</b>
      <span class="rec ${matches ? 'ok' : 'bad'}">${matches ? '✓ reconciles to the decision headline' : '✕ does not match the headline'}</span>`;
    bd.appendChild(foot);

    if (m.sizing?.cut) {
      const cut = el('p', 'muted');
      cut.style.cssText = 'font-size:.75rem;margin:12px 14px 4px;line-height:1.55';
      cut.textContent = `${m.sizing.cut} further account${m.sizing.cut === 1 ? '' : 's'} matched this signal, holding ${fmt.usdK(m.sizing.cut_arr)}. They are ranked below these on revenue exposure and remain in the feed — this decision is scoped to what one person can work this week.`;
      bd.appendChild(cut);
    }

    p.appendChild(bd);
    wrap.appendChild(p);
    return wrap;
  }

  /* ── LEVEL 3 · one account, and why it specifically is at risk ────────── */
  function viewAccount() {
    const ins = drilledInsight();
    const wrap = el('div', 'lv-view drill-level');
    /* Reached either from a decision (Level 2) or straight from the cohort
       table, where the account may not be flagged by any insight at all — which
       is the point of that surface. Build the detail directly when there is no
       decision context. */
    const a = ins?._meta?.exposed_accounts?.find((x) => x.account_id === state.drillAccount)
      || buildAccountDetail(ds(), state.drillAccount);
    if (!a) { wrap.appendChild(el('div', 'empty', 'That account is no longer in the dataset.')); return wrap; }

    wrap.appendChild(breadcrumb(ins
      ? [{ label: 'Today', go: toBrief }, { label: ins._meta.title, go: toAccounts }, { label: a.account_name }]
      : [{ label: 'Renewals', go: () => { state.view = 'cohort'; state.drillAccount = null; render(); body.scrollTop = 0; } },
         { label: a.account_name }]));

    const head = el('div', 'acct-head');
    head.innerHTML = `
      <div>
        <h2>${esc(a.account_name)}</h2>
        <div class="ah-meta">${esc(a.plan)} · ${esc(a.region)} · ${esc(a.account_id)}${a.contact_name ? ` · ${esc(a.contact_name)}` : ''}</div>
      </div>
      <dl class="ah-facts">
        <div><dt>ARR</dt><dd>${esc(fmt.usd(a.arr_usd))}</dd></div>
        <div><dt>Renews</dt><dd class="${a.renewal_in_days <= 30 ? 'urgent' : ''}">${a.renewal_in_days} days<small>${esc(a.renewal_date)}</small></dd></div>
        <div><dt>Owner</dt><dd>${esc(a.owner)}</dd></div>
      </dl>`;
    wrap.appendChild(head);

    /* The answer to "why is this one leaving", in prominent type. */
    const why = el('div', 'acct-why');
    why.innerHTML = `<div class="aw-lbl">Why this account is at risk</div><p>${esc(a.risk_reason)}</p>`;
    wrap.appendChild(why);

    const ev = el('div', 'panel');
    ev.innerHTML = `<div class="panel-hd"><h3>Evidence</h3><span class="hint">${a.supporting_signals.length} signal${a.supporting_signals.length === 1 ? '' : 's'} across ${new Set(a.supporting_signals.map((x) => x.source.split(' · ')[0])).size} source systems</span></div>`;
    const ebd = el('div', 'panel-bd tight');
    const list = el('div', 'sig-list');
    for (const sg of a.supporting_signals) {
      const row = el('div', 'sig');
      row.innerHTML = `
        <span class="sg-src">${esc(sg.source)}</span>
        <span class="sg-metric">${esc(sg.metric)}</span>
        <span class="sg-val">${esc(sg.value)}</span>
        <span class="sg-delta">${esc(sg.delta || '')}</span>
        <span class="sg-when">${sg.observed_at ? esc(String(sg.observed_at).slice(0, 10)) : '—'}</span>
        ${sg.detail ? `<span class="sg-detail">${esc(sg.detail)}</span>` : ''}`;
      list.appendChild(row);
    }
    ebd.appendChild(list);
    const note = el('p', 'muted');
    note.style.cssText = 'font-size:.73rem;margin:10px 14px;line-height:1.55';
    note.textContent = 'Each row names the system it came from. No single tool holds all of these — that spread is the point, and it is why the pattern is only visible here.';
    ebd.appendChild(note);
    ev.appendChild(ebd);
    wrap.appendChild(ev);

    if (a.recommended_action) {
      const act = el('div', 'acct-action');
      act.innerHTML = `
        <div class="aa-lbl">Recommended action for this account</div>
        <p>${esc(a.recommended_action.action)}</p>
        <div class="aa-owner">${esc(a.recommended_action.owner)}${a.recommended_action.owner_role ? ` · ${esc(a.recommended_action.owner_role)}` : ''}</div>`;
      wrap.appendChild(act);
    }

    const back = el('div', 'brief-cta');
    const b = el('button', 'lv-btn', ins
      ? `← Back to the ${ins._meta.exposed_accounts.length} exposed accounts`
      : '← Back to the renewals cohort');
    b.addEventListener('click', ins ? toAccounts : () => { state.view = 'cohort'; state.drillAccount = null; render(); body.scrollTop = 0; });
    back.appendChild(b);
    wrap.appendChild(back);
    return wrap;
  }


  /* ══════════════════════════════════════════════════════════════════════
     RENEWALS × ADOPTION — the cohort a CS director works
     ----------------------------------------------------------------------
     "What are my upcoming Q3 renewals? Add me a column for adoption. Under
      60%, and that's the cohort I go after."

     Three controls, one table. Deliberately not a report builder: this is one
     query run repeatedly, not twenty run once. The table is a WORKING LIST —
     forty rows sorted by ARR is correct, and decision sizing applies to the
     brief item that points here, not to this surface.
     ══════════════════════════════════════════════════════════════════════ */
  function viewCohort() {
    const d = ds();
    const c = buildCohort(d, state.cohort);
    if (!state.cohort.scopeValue) state.cohort.scopeValue = c.scopeValue;

    const wrap = el('div', 'lv-view');

    /* ── Controls ── */
    const tools = el('div', 'coh-tools');
    const levelSeg = ['csm', 'region', 'all'].map((k) =>
      `<button data-lvl="${k}" class="${c.scope === k ? 'on' : ''}">${k === 'csm' ? 'My queue' : k === 'region' ? 'Region' : 'All'}</button>`).join('');
    tools.innerHTML = `
      <div class="seg" id="cohLevel">${levelSeg}</div>
      ${c.scope === 'all' ? '' : `<select class="coh-sel" id="cohScope">${
        c.options[c.scope].map((o) => `<option value="${esc(o.key)}"${o.key === c.scopeValue ? ' selected' : ''}>${esc(o.label)} · ${o.n}</option>`).join('')}</select>`}
      <select class="coh-sel" id="cohWin">${
        WINDOWS.map((w) => `<option value="${w.key}"${w.key === state.cohort.window ? ' selected' : ''}>${esc(w.label)}</option>`).join('')}</select>
      <label class="coh-thresh">Adoption below
        <input id="cohThr" type="number" min="1" max="100" step="5" value="${c.threshold}" /><span>%</span>
      </label>`;
    wrap.appendChild(tools);

    /* ── The one line that answers the question ── */
    const sum = el('div', 'coh-summary');
    const s2 = c.summary;
    sum.innerHTML = `
      <div class="cs-line">
        <b>${fmt.int(s2.renewing)}</b> account${s2.renewing === 1 ? '' : 's'} renewing in <b>${esc(c.window.label)}</b>
        <span class="sep">·</span>
        <b class="risk">${fmt.int(s2.below)}</b> below <b>${c.threshold}%</b> adoption
        <span class="sep">·</span>
        <b class="risk">${esc(fmt.usdK(s2.arr_at_risk))}</b> at risk
      </div>
      <div class="cs-sub">${esc(c.scopeLabel)} · ${esc(fmt.usdK(s2.arr_total))} renewing in total${
        s2.offline_below ? ` · ${s2.offline_below} of the at-risk accounts are offline-billed, carrying ${s2.runway_gained} extra days of runway between them` : ''}</div>`;
    wrap.appendChild(sum);

    /* ── The table ── */
    const p = el('div', 'panel');
    p.innerHTML = `<div class="panel-hd"><h3>Renewal book</h3><span class="hint">sorted by ARR · a working list, not a shortlist</span></div>`;
    const bd = el('div', 'panel-bd tight');

    if (!c.rows.length) {
      bd.appendChild(el('div', 'empty', `No accounts in ${c.scopeLabel} renew in ${c.window.label}.`));
    } else {
      const head = el('div', 'coh-head');
      head.innerHTML = `<span>Account</span><span class="r">ARR</span><span>Renewal</span><span>Effective churn</span>
        <span class="r">Adoption</span><span>Trend</span><span>Owner</span>`;
      bd.appendChild(head);

      const list = el('div', 'coh-list');
      for (const r of c.rows) {
        const row = el('button', 'coh-row' + (r.below_threshold ? ' below' : ''));
        row.innerHTML = `
          <span class="cr-name">${esc(r.account_name)}<small>${esc(r.plan)} · ${esc(r.region)}</small></span>
          <span class="r cr-arr">${esc(fmt.usd(r.arr_usd))}</span>
          <span class="cr-ren">${esc(r.renewal_date || '—')}<small>${r.renewal_in_days}d</small></span>
          <span class="cr-eff${r.runway_differs ? ' gained' : ''}">${esc(r.effective_churn_date || '—')}<small>${
            r.runway_differs ? `+${r.credit_days}d · ${esc(r.billing_channel)}` : esc(r.billing_channel || 'same')}</small></span>
          <span class="r cr-adopt">${r.adoption_pct == null ? '—' : r.adoption_pct + '%'}</span>
          <span class="cr-trend">${sparkline(r.history, { color: r.below_threshold ? STATUS.critical : SERIES[2] })}<small>${
            r.usage_trend_30d == null ? '' : (r.usage_trend_30d > 0 ? '+' : '') + Math.round(r.usage_trend_30d) + '%'}</small></span>
          <span class="cr-owner">${esc(r.owner)}</span>`;
        row.addEventListener('click', () => {
          state.drillId = null;
          state.drillAccount = r.account_id;
          state.view = 'account';
          render(); body.scrollTop = 0;
        });
        list.appendChild(row);
      }
      bd.appendChild(list);

      const foot = el('p', 'muted');
      foot.style.cssText = 'font-size:.74rem;margin:0;padding:calc(var(--u)*2);border-top:1px solid var(--line);line-height:1.55';
      foot.innerHTML = `Accounts below the threshold carry a left rail. <b>Effective churn</b> is the renewal date plus any credit the billing terms allow — an offline account renewing in 20 days has 50 days of runway, so working the book by renewal date alone puts the wrong account first.`;
      bd.appendChild(foot);
    }

    p.appendChild(bd);
    wrap.appendChild(p);

    /* Handlers bound synchronously, not in a setTimeout. The elements already
       exist on `wrap` before it is inserted, so deferring buys nothing and
       loses any click that lands before the next macrotask — which a user
       switching scope immediately after the view paints will do. */
    {
      wrap.querySelectorAll('#cohLevel button').forEach((b) => b.addEventListener('click', () => {
        state.cohort.scope = b.dataset.lvl;
        state.cohort.scopeValue = null;   // re-default for the new level
        render();
      }));
      const sc = wrap.querySelector('#cohScope');
      if (sc) sc.addEventListener('change', () => { state.cohort.scopeValue = sc.value; render(); });
      const wn = wrap.querySelector('#cohWin');
      if (wn) wn.addEventListener('change', () => { state.cohort.window = wn.value; render(); });
      const th = wrap.querySelector('#cohThr');
      if (th) th.addEventListener('change', () => {
        const v = Math.max(1, Math.min(100, Number(th.value) || COHORT_DEFAULTS.adoption_risk_pct));
        state.cohort.adoption_risk_pct = v; render();
      });
    }

    return wrap;
  }

  function viewToday() {
    const e = eng(), b = e.brief, h = e.health;
    const wrap = el('div', 'lv-view');
    const screen = el('div', 'brief-screen');

    const when = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const stamp = el('div', 'brief-when', `${esc(when)} · ${esc(b.period)}`);
    screen.appendChild(stamp);
    renderGreeting(screen);

    /* ── How many decisions, and which ──────────────────────────────────
       Not "always three". An executive does not want three decisions, they
       want the RIGHT decisions — so severity picks the count:

         · no criticals      → say so, and demote the rest to "worth knowing"
         · 1–2 criticals     → top up to 3 by priority, for readability
         · 5 criticals       → show all five, grouped by band

       Criticals are unioned in FIRST so a high-severity item that ranks 4th
       on priority (severity × confidence × urgency) can never be silently
       dropped off the bottom of a three-item list. */
    const ranked = e.insights;
    const sel = briefSelection(ranked);           // ranked by revenue impact, capped
    const shown = sel.shown;
    const critical = shown.filter((i) => bandOf(i) === 'critical');

    if (!ranked.length) {
      screen.appendChild(el('p', 'brief-sub', 'Nothing requires a decision today. No signal cleared its detection threshold in the current window — which is a result, not an empty screen.'));
      const acts = el('div', 'brief-cta');
      const f = el('button', 'lv-btn', 'Open the Decision Feed');
      f.addEventListener('click', () => { state.view = 'feed'; render(); body.scrollTop = 0; });
      acts.appendChild(f);
      screen.appendChild(acts);
      wrap.appendChild(screen);
      return wrap;
    }

    const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const spell = (n) => NUM[n] || String(n);

    if (!critical.length) {
      screen.appendChild(el('p', 'brief-sub', 'No critical decisions today.'));
      screen.appendChild(el('p', 'brief-note',
        `Nothing cleared the critical threshold. ${spell(shown.length)} lower-severity signal${shown.length === 1 ? ' is' : 's are'} open below — worth knowing, but none of them need you today.`));
    } else {
      screen.appendChild(el('p', 'brief-sub',
        `${spell(shown.length)} decision${shown.length === 1 ? '' : 's'} require${shown.length === 1 ? 's' : ''} your attention today.`));
      if (critical.length > 3) {
        screen.appendChild(el('p', 'brief-note',
          `That is more than usual — ${critical.length} signals are in the critical band, so none of them have been held back for readability.`));
      }
    }

    /* Say what was left out. The brief is a cut, and a cut you cannot see is
       indistinguishable from a search that found nothing. */
    if (sel.sizing.cut > 0) {
      const s2 = sel.sizing;
      const money = s2.cut_worth > 0 ? ` carrying ${fmt.usdK(s2.cut_worth)} between them` : '';
      const note = el('p', 'brief-note');
      note.innerHTML = `Ranked by revenue impact. ${s2.cut} further decision${s2.cut === 1 ? '' : 's'}${money} sit${s2.cut === 1 ? 's' : ''} below the cut` +
        `${s2.uncosted_cut ? `, ${s2.uncosted_cut} of which carr${s2.uncosted_cut === 1 ? 'ies' : 'y'} no costed exposure` : ''} — ` +
        `all of them remain in the <b>Decision Feed</b>.`;
      const open = el('button', 'lv-btn', `Open the feed (${e.insights.length}) →`);
      open.addEventListener('click', () => { state.view = 'feed'; render(); body.scrollTop = 0; });
      screen.appendChild(note);
      const row = el('div', 'brief-cta');
      row.style.marginTop = '10px';
      row.appendChild(open);
      screen.appendChild(row);
    }

    /* ── The decisions, grouped by band ── */
    const list = el('div', 'brief-decisions');
    let lastBand = null;
    let n = 0;
    shown.forEach((ins) => {
      const band = bandOf(ins);
      if (band !== lastBand) {
        const count = shown.filter((x) => bandOf(x) === band).length;
        const meta = BANDS[band];
        list.appendChild(el('div', 'bd-band',
          `<span class="dot" style="background:${meta.color}"></span>${esc(critical.length ? meta.label : meta.quietLabel)}<span class="ct">${count}</span>`));
        lastBand = band;
      }
      const i = n++;
      const { base, detail } = actionLine(ins);
      const committed = store.decisions.find((x) => x.signal_key === signalKey(ins) && x.status !== 'closed');
      const item = el('article', `bd-item bd-${band}${committed ? ' done' : ''}${state.focus === signalKey(ins) ? ' focus' : ''}`);
      item.innerHTML = `
        <div class="n">${String(i + 1).padStart(2, '0')}</div>
        <div class="bd-main">
          <p class="bd-line">${consequenceLine(ins)}</p>
          <div class="bd-act">
            <span class="arrow">↳</span>
            <div>
              <div class="bd-do">${esc(base)}</div>
              ${detail ? `<div class="bd-detail">${esc(detail)}</div>` : ''}
              <div class="bd-chips">
                ${drillable(ins) ? (ins._meta.scope_is_full
                  /* Cohort-wide: the chip must count the COHORT, because that
                     is what the action covers and what the link opens. Showing
                     "6 accounts" on a decision about 128 understates it by a
                     factor of twenty and lands the user on the wrong screen. */
                  ? `<span class="chip drill-link" data-drill="1" role="button" tabindex="0" title="Open the ${fmt.int(ins._meta.affected_accounts)}-account cohort">${fmt.int(ins._meta.affected_accounts)} accounts · ${esc(fmt.usdK(ins._meta.evidence.arr_at_risk))} ARR <i>›</i></span>`
                  : `<span class="chip drill-link" data-drill="1" role="button" tabindex="0" title="Open the ${ins._meta.exposed_accounts.length} exposed accounts">${ins._meta.exposed_accounts.length} accounts · ${esc(fmt.usdK(ins._meta.exposed_accounts.reduce((s2, a) => s2 + a.arr_usd, 0)))} ARR <i>›</i></span>`) : ''}
                <span class="chip">${esc(ins.recommended_action.owner_role)}</span>
                <span class="chip">playbook ${esc(ins.recommended_action.playbook_id)}</span>
                <span class="chip" title="${esc(ins.confidence ? ins.confidence.limiting_factor : '')}">${Math.round(ins.why.confidence * 100)}% confidence</span>
                ${ins.confidence?.coverage_capped ? '<span class="chip held">coverage-capped</span>' : ''}
                ${ins.status === 'held_for_review' ? '<span class="chip held">held — confirm before acting</span>' : ''}
              </div>
            </div>
          </div>
        </div>`;

      const dl = item.querySelector('[data-drill]');
      if (dl) {
        const go = (ev) => { ev.stopPropagation(); if (ins.signal_type === 'renewal_cohort') openCohort(); else openAccounts(ins); };
        dl.addEventListener('click', go);
        dl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(ev); } });
      }

      const acts = el('div', 'bd-actions');
      const commit = el('button', committed ? 'lv-btn' : 'lv-btn primary',
        committed ? `✓ Committed · ${esc(committed.decision_id)}` : 'Commit this decision');
      commit.addEventListener('click', (ev) => { ev.stopPropagation(); commitDecision(ins); });
      const why = el('button', 'lv-btn', 'Show me why');
      why.addEventListener('click', (ev) => { ev.stopPropagation(); drillInsight(ins); });
      const dig = el('a', 'lv-btn', 'Investigate in the workspace →');
      dig.href = workspaceHref(ins);
      dig.title = 'Opens the operational workspace with this decision as its context';
      acts.appendChild(commit); acts.appendChild(why); acts.appendChild(dig);
      item.querySelector('.bd-main').appendChild(acts);
      list.appendChild(item);
    });
    screen.appendChild(list);

    /* ── Revenue protected ── */
    const costed = shown.filter((i) => midUsd(i) != null);
    const protectedUsd = costed.reduce((s, i) => s + midUsd(i), 0);
    const uncosted = shown.length - costed.length;

    const prot = el('div', 'brief-protect');
    prot.innerHTML = `
      <div class="lbl">Estimated revenue protected</div>
      <div class="amt">${costed.length ? esc(fmt.usdK(protectedUsd)) : '—'}</div>
      <p class="foot">
        ${costed.length
          ? `Midpoint of the costed range on ${costed.length === 1 ? 'the one decision that carries a dollar figure' : `all ${costed.length} costed decisions`}, if actioned inside their stated horizons.`
          : 'None of today\'s decisions carry a dollar figure.'}
        ${uncosted ? ` ${uncosted} of ${shown.length} ${uncosted === 1 ? 'is' : 'are'} deliberately not costed — a statutory deadline is a legal question, and a fabricated figure would be the least defensible number on this screen.` : ''}
      </p>`;
    screen.appendChild(prot);

    /* ── Commit-all + the supporting surfaces, deliberately below the fold ── */
    const cta = el('div', 'brief-cta');
    const pending = shown.filter((i) => !store.decisions.some((x) => x.signal_key === signalKey(i) && x.status !== 'closed'));
    if (pending.length) {
      const all = el('button', 'lv-btn primary', `Commit all ${pending.length} →`);
      all.addEventListener('click', () => {
        pending.forEach((i) => commitDecision(i, { quiet: true }));
        toast(`${pending.length} decisions recorded`, 'Each one snapshotted with the evidence as it stands now');
        state.view = 'ledger'; render(); body.scrollTop = 0;
      });
      cta.appendChild(all);
    } else {
      const led = el('button', 'lv-btn primary', 'All committed — open the ledger →');
      led.addEventListener('click', () => { state.view = 'ledger'; render(); body.scrollTop = 0; });
      cta.appendChild(led);
    }
    const ask = el('button', 'lv-btn', 'Ask about the operation');
    ask.addEventListener('click', () => { state.view = 'copilot'; render(); body.scrollTop = 0; });
    cta.appendChild(ask);
    screen.appendChild(cta);

    /* Context strip: this is the evidence the briefing stands on, and it is
       small on purpose — it exists to be challenged, not read first. */
    const ctx = el('div', 'brief-ctx');
    const items = [
      { k: 'Operations health', v: `${h.score}/100`, s: `${h.delta >= 0 ? '+' : ''}${h.delta} vs prior period`, go: 'radar' },
      { k: 'Records analysed', v: fmt.int(e.run.stats.records_in), s: `across ${e.run.detectors_run.length} detectors`, go: 'assurance' },
      { k: 'Signals raised', v: String(e.insights.length), s: `${e.run.stats.held_for_review} held below the confidence floor`, go: 'feed' },
      { k: 'Total at risk', v: fmt.usdK(b.rollup.total_revenue_at_risk), s: 'every costed signal, not just today\'s three', go: 'feed' },
    ];
    for (const it of items) {
      const c = el('button', 'bctx', `<div class="k">${esc(it.k)}</div><div class="v">${esc(it.v)}</div><div class="s">${esc(it.s)}</div>`);
      c.addEventListener('click', () => { state.view = it.go; render(); body.scrollTop = 0; });
      ctx.appendChild(c);
    }
    screen.appendChild(ctx);

    if (state.focus) {
      setTimeout(() => {
        const f = body.querySelector('.bd-item.focus');
        if (f) f.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
    }

    wrap.appendChild(screen);
    return wrap;
  }

  function viewDashboard() {
    const d = ds(), e = eng(), h = e.health, b = e.brief;
    const wrap = el('div', 'lv-view');

    const hero = el('div', 'op-hero');
    const dArrow = h.delta > 0 ? 'up' : h.delta < 0 ? 'down' : 'flat';
    hero.innerHTML = `
      <div>
        <div class="when">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${esc(b.period)}</div>
        <h2>Here are your top ${b.top_3.length} operational risks — and what to do about them.</h2>
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
    const rec = d.tickets.filter((t) => t.day_index >= d.meta.recent_from);
    const open = openTickets(d);
    const npsRec = npsOf(d.nps.filter((r) => r.day_index >= d.meta.recent_from));
    const csatRec = csatOf(rec);
    const kpis = [
      { key: 'tickets', k: 'Tickets / day', v: fmt.one(rec.length / (d.meta.days - d.meta.recent_from)), spark: rolling(countByDay(d.tickets, d.meta.days), 7).slice(-30) },
      { key: 'backlog', k: 'Open backlog', v: fmt.int(open.length), spark: d.meta.series.backlog.slice(-30), bad: true },
      { key: 'escalations', k: 'Open escalations', v: fmt.int(d.escalations.filter((x) => x.status !== 'Closed').length), spark: rolling(countByDay(d.escalations, d.meta.days), 7).slice(-30), bad: true },
      { key: 'nps', k: 'NPS', v: fmt.nps(npsRec.nps), spark: null, bad: npsRec.nps < 25 },
      { key: 'csat', k: 'CSAT', v: fmt.stars(csatRec.avg), spark: rolling(meanByDay(d.tickets, d.meta.days, (t) => t.customer_satisfaction_rating), 7).slice(-30) },
      { key: 'qa', k: 'QA average', v: fmt.one(mean(d.qa.map((q) => q.overall_score))), spark: rolling(meanByDay(d.qa, d.meta.days, (q) => q.overall_score), 14).slice(-30) },
    ];
    const strip = el('div', 'kpi-strip');
    for (const k of kpis) {
      const c = el('div', 'kpi', `<div class="k">${esc(k.k)}</div><div class="v" ${k.bad ? `style="color:${STATUS.warning}"` : ''}>${esc(k.v)}</div>${k.spark ? sparkline(k.spark, { color: k.bad ? STATUS.serious : SERIES[0] }) : '<div style="height:26px"></div>'}`);
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
      const text = `OpsPulse — ${b.period}\nHealth ${h.score}/100 (${h.delta >= 0 ? '+' : ''}${h.delta})\n\n${b.narrative_lines.join('\n\n')}\n\nTOP ${b.top_3.length}:\n` +
        b.top_3.map((i, n) => `${n + 1}. ${i._meta.title} — ${i._meta.metric_label}\n   Impact: ${i._meta.affected_accounts} customers · ${moneyRange(i)}\n   Cause (hypothesis, ${Math.round(i.why.confidence * 100)}%): ${firstSentence(i.why.root_cause)}\n   Action: ${i.recommended_action.action} → ${i.recommended_action.owner_role}`).join('\n\n');
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

    /* Below the fold: where the work sits and what the engine made of it. Both
       are read straight off the same dataset the cards above were built from. */
    const mix = el('div', 'grid2');
    mix.appendChild(barChart({
      title: 'Where the open work sits', subtitle: `${fmt.int(open.length)} unresolved tickets by category`,
      rows: countBy(open, (t) => t.category, 9),
      note: 'Open queue only — closed work is excluded, so this is what is still costing time.',
    }));
    mix.appendChild(barChart({
      title: 'What the engine made of it', subtitle: `${e.insights.length} signals raised from ${fmt.int(e.run.stats.records_in)} records`,
      rows: [...groupBy(e.insights, (i) => i.signal_type)].map(([k, v]) => ({
        key: String(k).replace(/_/g, ' '),
        value: v.length,
        hint: `${Math.max(...v.map((x) => x.severity_score))} worst severity`,
        color: v.some((x) => bandOf(x) === 'critical') ? STATUS.critical : v.some((x) => bandOf(x) === 'high') ? STATUS.warning : SERIES[0],
      })).sort((a, b) => b.value - a.value),
      format: (v) => Math.round(v),
      note: 'Coloured by the worst band present in each type. A type with no bar did not clear its detection threshold this window.',
    }));
    wrap.appendChild(mix);

    /* Queue against the level the desk is staffed for — the single series that
       explains most of what the top three are about. */
    const q = el('div', 'panel');
    q.innerHTML = '<div class="panel-hd"><h3>Queue against target</h3><span class="hint">90 days · the gap is unstaffed work</span></div>';
    const qbd = el('div', 'panel-bd');
    qbd.appendChild(lineChart({
      title: 'Open backlog vs target', subtitle: 'the level this desk is staffed to hold',
      labels: labelsFor(0, d.meta.days - 1),
      series: [
        { name: 'Open backlog', values: d.meta.series.backlog },
        { name: 'Target', values: d.meta.series.backlog_target },
      ],
      format: fmt.int, zeroBase: false, markers: releaseMarkers(0),
      bands: [{ from: d.meta.recent_from, to: d.meta.days - 1, label: 'analysis window' }],
    }));
    q.appendChild(qbd);
    wrap.appendChild(q);

    return wrap;
  }

  function tickerPanel() {
    const p = el('div', 'panel');
    p.innerHTML = '<div class="panel-hd"><h3>Live ingest</h3><span class="hint">from NorthDesk</span></div>';
    const bd = el('div', 'panel-bd tight');
    const t = el('div', 'ticker');
    t.style.padding = '8px';
    const icCls = { ticket: 't', resolved: 'r', escalation: 'e', nps: 'n', qa: 'q', upload: 'u', decision: 'd' };
    const icTxt = { ticket: '+', resolved: '✓', escalation: '!', nps: '★', qa: 'Q', upload: '↑', decision: '⚑' };
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

    /* What shape is the feed in? The list answers item-by-item; these answer it
       in aggregate, which is the question someone triaging actually opens with. */
    const all = e.insights;
    const bc = bandCounts(all);
    const costed = all.filter((i) => i.expected_impact.range_low_usd != null);
    const atStake = costed.reduce((s, i) => s + (i.expected_impact.range_low_usd + i.expected_impact.range_high_usd) / 2, 0);
    const heldN = all.filter((i) => i.status === 'held_for_review').length;
    const accounts = all.reduce((s, i) => s + (i._meta.affected_accounts || 0), 0);

    wrap.appendChild(statStrip([
      { k: 'Open signals', v: String(all.length), s: `${costed.length} carry a costed range` },
      { k: 'Critical', v: String(bc.critical), s: `${bc.high} high · ${bc.medium} medium`, color: bc.critical ? STATUS.critical : STATUS.good },
      { k: 'Value at stake', v: costed.length ? fmt.usdK(atStake) : '—', s: 'midpoint of every costed range' },
      { k: 'Median confidence', v: `${Math.round(medianOf(all.map((i) => i.why.confidence)) * 100)}%`, s: `floor is ${Math.round(CONFIDENCE_CUTOFF * 100)}%` },
      { k: 'Held for review', v: String(heldN), s: 'below the floor — never auto-actioned', color: heldN ? STATUS.warning : STATUS.good },
      { k: 'Customers affected', v: fmt.int(accounts), s: 'summed across open signals' },
    ]));

    /* Severity and money, side by side — the two orderings a triager flips
       between. Bars are coloured by band, which is a reserved status usage. */
    const shape = el('div', 'grid2');
    shape.appendChild(barChart({
      title: 'Severity ladder', subtitle: 'every open signal, worst first',
      rows: all.slice().sort((a, b) => b.severity_score - a.severity_score).map((i) => ({
        key: i._meta.title, value: i.severity_score, hint: `${Math.round(i.why.confidence * 100)}% confidence`, color: bandColor(i),
      })),
      format: (v) => Math.round(v), maxRows: 12,
      note: `Critical is ≥ ${CRITICAL_AT}, high ≥ ${HIGH_AT}. The brief promotes every critical; the rest wait here.`,
    }));
    shape.appendChild(barChart({
      title: 'Where the money is', subtitle: 'midpoint of the costed range',
      rows: costed.slice().sort((a, b) => b.expected_impact.range_high_usd - a.expected_impact.range_high_usd).map((i) => ({
        key: i._meta.title, value: (i.expected_impact.range_low_usd + i.expected_impact.range_high_usd) / 2,
        hint: `${i.expected_impact.time_horizon_days}-day horizon`, color: bandColor(i),
      })),
      format: fmt.usdK, maxRows: 12,
      note: all.length - costed.length ? `${all.length - costed.length} signal(s) are deliberately not costed and are absent here.` : undefined,
    }));
    wrap.appendChild(shape);

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
        <p class="muted" style="font-size:.74rem;margin:12px 0 0;line-height:1.55">Nine statistical detectors run over the live dataset; anything clearing its threshold is root-caused by decomposition and matched to a playbook. Detection is arithmetic — the language layer only explains what it found.</p>
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
    const d = ds(), e = eng();
    const wrap = el('div', 'lv-view');

    /* The radar answers "which dimension", but not "by how much" or "since
       when". These three blocks carry the numbers the shape only implies. */
    const allDrivers = h.dimensions.flatMap((dim) => dim.drivers.map((dr) => ({ ...dr, dim: dim.label, dimKey: dim.key })));
    const below = allDrivers.filter((dr) => dr.score < 70);
    const worst = h.dimensions.slice().sort((a, b) => a.score - b.score)[0];

    wrap.appendChild(statStrip([
      { k: 'Composite health', v: `${h.score}`, s: `${h.delta >= 0 ? '+' : ''}${h.delta} vs prior period`, color: h.score >= 70 ? STATUS.good : h.score >= 50 ? STATUS.warning : STATUS.critical },
      { k: 'Weakest dimension', v: String(worst.score), s: worst.label, color: STATUS.critical, onClick: () => drillDimension(worst.key) },
      { k: 'Drivers below target', v: `${below.length}/${allDrivers.length}`, s: 'across all four dimensions', color: below.length ? STATUS.warning : STATUS.good },
      { k: 'Open signals', v: String(e.insights.length), s: `${bandCounts(e.insights).critical} critical`, onClick: () => { state.view = 'feed'; render(); } },
      { k: 'Backlog now', v: fmt.int(openTickets(d).length), spark: d.meta.series.backlog.slice(-30), sparkColor: STATUS.serious },
      { k: 'Escalations open', v: fmt.int(d.escalations.filter((x) => x.status !== 'Closed').length), spark: rolling(countByDay(d.escalations, d.meta.days), 7).slice(-30), sparkColor: STATUS.warning },
    ]));

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

    /* Every driver in the composite, worst first — 15 real numbers the radar
       compresses into four points. This is the "by how much". */
    const dp = el('div', 'panel');
    dp.innerHTML = '<div class="panel-hd"><h3>Every driver in the score, worst first</h3><span class="hint">the four radar points expanded — click any dimension card above to open its maths</span></div>';
    const dbd = el('div', 'panel-bd');
    dbd.appendChild(barChart({
      title: 'Driver scores against their own target band',
      subtitle: `${below.length} of ${allDrivers.length} are below target`,
      rows: allDrivers.slice().sort((a, b) => a.score - b.score).map((dr) => ({
        key: `${dr.label} · ${dr.dim.split(' ')[0]}`,
        value: Math.round(dr.score),
        hint: `now ${dr.display} · target ${dr.target}`,
        color: dr.score >= 70 ? STATUS.good : dr.score >= 45 ? STATUS.warning : STATUS.critical,
      })),
      format: (v) => Math.round(v),
      maxRows: 16,
      note: 'Scored 0–100 against each driver\'s own target band, so they are comparable to each other despite measuring different things. Green is at or above target.',
    }));
    dp.appendChild(dbd);
    wrap.appendChild(dp);

    /* The "since when". Both series are real 90-day arrays off the dataset. */
    const trends = el('div', 'grid2');
    trends.appendChild(lineChart({
      title: 'Queue against target', subtitle: 'open backlog vs the level the desk is staffed for',
      labels: labelsFor(d.meta.days - 45, d.meta.days - 1),
      series: [
        { name: 'Open backlog', values: d.meta.series.backlog.slice(d.meta.days - 45) },
        { name: 'Target', values: d.meta.series.backlog_target.slice(d.meta.days - 45) },
      ],
      format: fmt.int, zeroBase: false, markers: releaseMarkers(d.meta.days - 45),
      bands: [{ from: d.meta.recent_from - (d.meta.days - 45), to: 44, label: 'analysis window' }],
      note: 'The gap between the two lines is the part of the queue nobody is staffed to clear.',
    }));
    trends.appendChild(lineChart({
      title: 'Demand vs capacity', subtitle: '7-day rolling · tickets in against tickets resolved',
      labels: labelsFor(d.meta.days - 45, d.meta.days - 1),
      series: [
        { name: 'Arriving', values: rolling(d.meta.series.inflow, 7).slice(d.meta.days - 45) },
        { name: 'Resolved', values: rolling(d.meta.series.throughput, 7).slice(d.meta.days - 45) },
      ],
      format: fmt.one, zeroBase: false,
      note: 'Where arriving sits above resolved, the queue is growing — that difference is what the backlog chart accumulates.',
    }));
    wrap.appendChild(trends);

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
  const SUGGESTIONS = [
    'What should I focus on today?',
    'Why did NPS drop?',
    'What operational risks are emerging?',
    'What is our biggest operational risk?',
    'How is the new-hire cohort performing?',
    'How much revenue is at risk?',
    'Why is the backlog growing?',
    'Are we exposed on compliance?',
    'What have we decided so far?',
  ];

  function answer(qRaw) {
    const q = qRaw.toLowerCase();
    const e = eng(), h = e.health, b = e.brief, d = ds();
    const find = (t, key) => e.insights.find((i) => i.signal_type === t && (!key || i._meta.entity.key === key));
    const has = (...ws) => ws.some((w) => q.includes(w));
    const chip = (label, fn) => ({ label, fn });

    const insLine = (i) => `<li><strong>${esc(i._meta.title)}</strong> — ${esc(i._meta.metric_label)}. ${esc(firstSentence(i.why.root_cause))} <em>Do:</em> ${esc(i.recommended_action.action)} (${esc(i.recommended_action.owner_role)}, ${Math.round(i.why.confidence * 100)}% confidence).</li>`;

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
      if (!i) return { html: `NPS is <strong>${fmt.nps(a.nps)}</strong> across ${a.n} responses, against a baseline of ${fmt.nps(base.nps)} — no drop large enough to raise a card.<div class="src">${a.n} responses in the current window.</div>`, chips: [chip('Open NPS analysis', () => openDrill(KPI_DRILLS.nps()))] };
      const dd = i._meta.decomposition.slice(0, 3);
      return {
        html: `NPS fell from <strong>${fmt.nps(i._meta.baseline)}</strong> to <strong>${fmt.nps(i._meta.observed)}</strong> — ${i._meta.evidence.drop_pts} points across ${i._meta.n_recent} responses.
          <p style="margin:9px 0 0">Detractors went from ${fmt.pct0(i._meta.evidence.detractors_base)} to ${fmt.pct0(i._meta.evidence.detractors_recent)} of responses. What changed in <em>what they complain about</em>:</p>
          <ul>${dd.map((x) => `<li><strong>${esc(String(x.key).replace(/-/g, ' '))}</strong> — ${fmt.pct0(x.share_recent ?? x.recent_rate)} of detractors now vs ${fmt.pct0(x.base_rate ?? 0)} before; explains ${fmt.pct0(x.contribution)} of the shift.</li>`).join('')}</ul>
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
          <p style="margin:10px 0 0">On the radar, <strong>${esc(worst.label)}</strong> is weakest at ${worst.score}/100 — driven by ${esc(worst.drivers.slice().sort((a2, b2) => a2.score - b2.score)[0].label.toLowerCase())} (${esc(worst.drivers.slice().sort((a2, b2) => a2.score - b2.score)[0].display)}).</p>
          <div class="src">An emerging topic must be ≥1.35× its own baseline AND clear a share-of-mix z-test of 2.5, so ordinary weekly noise does not qualify.</div>`,
        chips: [chip('Open Risk Radar', () => { state.view = 'radar'; render(); }), ...em.slice(0, 2).map((i) => chip(i._meta.title, () => drillInsight(i)))],
      };
    }
    if (has('biggest', 'worst', 'top risk', 'most important', 'number one', 'single')) {
      const i = b.top_3[0];
      return {
        html: `<strong>${esc(i._meta.title)}.</strong> ${esc(i.what_happened)}
          <p style="margin:9px 0 0"><strong>Why (hypothesis, ${Math.round(i.why.confidence * 100)}% confidence):</strong> ${esc(i.why.root_cause)}</p>
          <p style="margin:9px 0 0"><strong>Worth:</strong> ${esc(moneyRange(i))} over ${i.expected_impact.time_horizon_days} days — ${esc(i._meta.impact.formula)}.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)} — owner ${esc(i.recommended_action.owner_role)}, playbook ${esc(i.recommended_action.playbook_id)}.</p>
          <div class="src">Largest single exposure in the feed is actually ${esc(largestExposure(e)._meta.title)} at ${esc(moneyRange(largestExposure(e)))} — it ranks lower here because its horizon is ${largestExposure(e).expected_impact.time_horizon_days} days, not because it is smaller.</div>`,
        chips: [chip('Open drill-down', () => drillInsight(i)), chip(largestExposure(e)._meta.title, () => drillInsight(largestExposure(e)))],
      };
    }
    if (has('new hire', 'new-hire', 'cohort', 'coach', 'qa', 'quality', 'agent perform')) {
      const i = find('coaching_gap');
      if (!i) return { html: 'No coaching gap is currently clearing the detection threshold.', chips: [chip('Open QA analysis', () => openDrill(KPI_DRILLS.qa()))] };
      const ev = i._meta.evidence;
      return {
        html: `The new-hire cohort is scoring <strong>${i._meta.observed.toFixed(1)}</strong> on QA against <strong>${i._meta.baseline.toFixed(1)}</strong> for tenured agents — a ${ev.gap_pts.toFixed(1)} point gap across ${i._meta.n_recent} reviews of ${ev.agents_in_cohort} agents.
          <ul>${ev.dimension_gaps.slice(0, 3).map((g) => `<li><strong>${esc(g.key.replace(/_/g, ' '))}</strong> — ${g.new_hire.toFixed(0)} vs ${g.tenured.toFixed(0)} (gap ${g.gap.toFixed(1)})</li>`).join('')}</ul>
          <p style="margin:9px 0 0">It costs real money through rework: reopen rate ${fmt.pct(ev.reopen_rate_new_hire)} vs ${fmt.pct(ev.reopen_rate_tenured)}, on ${fmt.int(ev.tickets_handled_recent)} tickets in the window. The bigger cost is indirect — the same policy-adherence weakness shows up in your refund escalations.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}</p>
          <div class="src">Welch t-test between cohorts, t = ${i._meta.z.toFixed(1)}. Worst-scoring agents are listed in the drill-down as the coaching list.</div>`,
        chips: [chip('Open coaching list', () => drillInsight(i)), chip('QA BI', () => openDrill(KPI_DRILLS.qa()))],
      };
    }
    if (has('revenue', 'money', 'at risk', 'cost', 'dollar', '$', 'worth', 'financial')) {
      const costed = e.insights.filter((i) => i.expected_impact.range_low_usd != null).sort((a2, b2) => b2.expected_impact.range_high_usd - a2.expected_impact.range_high_usd);
      return {
        html: `<strong>${fmt.usdK(b.rollup.total_revenue_at_risk)}</strong> in total, taking the midpoint of every costed estimate. Broken down:
          <ul>${costed.map((i) => `<li><strong>${esc(i._meta.title)}</strong> — ${esc(moneyRange(i))} over ${i.expected_impact.time_horizon_days}d. ${esc(i._meta.impact.formula)}</li>`).join('')}</ul>
          <p style="margin:10px 0 0">Compliance exposure is deliberately <strong>not costed</strong> — a statutory deadline is a legal question, and a fabricated fine probability would be the least defensible number on the page.</p>
          <div class="src">Every range is a range on purpose. Cancellation-intent lift is measured on this dataset (${fmt.pct(e.churn_model.lift_pts)} across ${fmt.int(e.churn_model.n_escalated + e.churn_model.n_not_escalated)} accounts); the conversion band is a stated assumption, and it is the widest source of uncertainty.</div>`,
        chips: costed.slice(0, 3).map((i) => chip(i._meta.title, () => drillInsight(i))),
      };
    }
    if (has('backlog', 'queue', 'wait', 'sla', 'capacity', 'slow', 'response time')) {
      const i = find('backlog_risk');
      if (!i) return { html: 'The queue is stable — no backlog anomaly is clearing the threshold.', chips: [chip('Open backlog BI', () => openDrill(KPI_DRILLS.backlog()))] };
      const ev = i._meta.evidence;
      return {
        html: `Open backlog has gone from <strong>${Math.round(i._meta.baseline)}</strong> to <strong>${Math.round(i._meta.observed)}</strong> tickets, growing ${ev.slope_per_day.toFixed(1)}/day.
          <p style="margin:9px 0 0">Inflow is ${ev.inflow_per_day.toFixed(0)}/day against ${ev.throughput_per_day.toFixed(0)}/day of throughput — a ${ev.capacity_gap_per_day.toFixed(0)} ticket/day gap. Capacity did not fall; demand rose, and ${i._meta.decomposition.slice(0, 2).map((x) => x.key).join(' and ')} account for ${fmt.pct0(i._meta.decomposition.slice(0, 2).reduce((s, x) => s + x.contribution, 0))} of the extra.</p>
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
        html: `Yes — and it is the one item I have <strong>not</strong> put a dollar figure on.
          <p style="margin:9px 0 0">${ev.dsar_open} statutory data requests are open, <strong>${ev.dsar_due_within_10d} within 10 days</strong> of their legal deadline${ev.dsar_past_due ? `, and ${ev.dsar_past_due} already past due` : ''}. QA compliance scoring has moved ${ev.qa_compliance_base.toFixed(0)} → ${ev.qa_compliance_recent.toFixed(0)}, which is the mechanism by which policy errors reach customers.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)} — owner ${esc(i.recommended_action.owner_role)}.</p>
          <div class="src">This insight sits at ${Math.round(i.why.confidence * 100)}% confidence${i.status === 'held_for_review' ? ' and is HELD below the 60% cutoff — a human confirms before it is actioned' : ''}.</div>`,
        chips: [chip('Open compliance drill-down', () => drillInsight(i)), chip('Compliance dimension', () => drillDimension('compliance'))],
      };
    }
    if (has('churn', 'renew', 'accounts at risk', 'save', 'cancel')) {
      const i = find('churn_risk');
      if (!i) return { html: 'No account cluster is currently meeting the churn-risk rule.', chips: [] };
      const ev = i._meta.evidence;
      return {
        html: `<strong>${i._meta.affected_accounts} accounts</strong> holding ${fmt.usdK(ev.arr_at_risk)} of ARR meet the at-risk rule — repeat escalations plus a detractor NPS or low CSAT.
          <p style="margin:9px 0 0">${ev.enterprise_count} are Enterprise (${fmt.usdK(ev.enterprise_arr)}), ${ev.renewal_within_90d} renew within 90 days, and ${ev.with_cancellation_intent} have already raised a cancellation ticket.</p>
          <p style="margin:9px 0 0"><strong>Do:</strong> ${esc(i.recommended_action.action)}</p>
          <div class="src">The drill-down gives you the save list sorted by ARR.</div>`,
        chips: [chip('Open the save list', () => drillInsight(i))],
      };
    }
    if (has('decided', 'decision', 'ledger', 'committed', 'what did we do', 'acted', 'follow up', 'follow-up')) {
      const decs = store.decisions;
      if (!decs.length) {
        return {
          html: `Nothing has been committed yet — the ledger is empty.
            <p style="margin:9px 0 0">I can recommend, but a recommendation is not a decision. Commit one from any insight and I will track the signal it was taken against and tell you honestly whether it moved.</p>
            <div class="src">The ledger snapshots severity, confidence and the metric at commit time, so an outcome can be judged later without the engine rewriting its own history.</div>`,
          chips: [chip('Open the Decision Feed', () => { state.view = 'feed'; render(); })],
        };
      }
      const rows = decs.map((dd) => ({ dd, oc: ledgerOutcome(dd) }));
      const good = rows.filter((x) => x.oc.key === 'cleared' || x.oc.key === 'improving');
      const bad = rows.filter((x) => x.oc.key === 'worsening');
      return {
        html: `<strong>${decs.length} decision${decs.length === 1 ? '' : 's'} committed</strong>, ${decs.filter((dd) => dd.status !== 'closed').length} still open.
          <ul>${rows.map((x) => `<li><strong>${esc(x.dd.title)}</strong> → ${esc(x.dd.owner_role)} (${esc(x.dd.decision_id)}, playbook ${esc(x.dd.playbook_id)}). <em>${esc(x.oc.label)}</em> — ${esc(x.oc.detail)}.</li>`).join('')}</ul>
          <p style="margin:10px 0 0">${good.length} of ${decs.length} ${good.length === 1 ? 'is' : 'are'} moving the right way${bad.length ? `, and ${bad.length} ${bad.length === 1 ? 'has' : 'have'} got worse since ${bad.length === 1 ? 'it was' : 'they were'} committed — that is worth looking at before anything new is added` : ''}.</p>
          ${decs.some((dd) => dd.held_at_decision) ? `<p style="margin:9px 0 0">${decs.filter((dd) => dd.held_at_decision).length} ${decs.filter((dd) => dd.held_at_decision).length === 1 ? 'was' : 'were'} committed below the ${Math.round(CONFIDENCE_CUTOFF * 100)}% confidence floor and ${decs.filter((dd) => dd.held_at_decision).length === 1 ? 'is' : 'are'} flagged as an override in the ledger.</p>` : ''}
          <div class="src">Outcome is measured by re-reading the same signal each decision was taken against — matched on signal type and entity, not insight id.</div>`,
        chips: [chip('Open the Decision Ledger', () => { state.view = 'ledger'; render(); }), ...rows.slice(0, 2).filter((x) => x.oc.live).map((x) => chip(x.dd.title, () => drillInsight(x.oc.live)))],
      };
    }
    if (has('health', 'score', 'how are we', 'overall')) {
      return {
        html: `Operations health is <strong>${h.score}/100</strong>, ${h.delta >= 0 ? 'up' : 'down'} ${Math.abs(h.delta)} on the prior period.
          <ul>${h.dimensions.map((dd) => `<li><strong>${esc(dd.label)}</strong> ${dd.score}/100 (${dd.delta > 0 ? '+' : ''}${dd.delta}) — weakest driver: ${esc(dd.drivers.slice().sort((a2, b2) => a2.score - b2.score)[0].label.toLowerCase())} at ${esc(dd.drivers.slice().sort((a2, b2) => a2.score - b2.score)[0].display)}</li>`).join('')}</ul>
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

    /* Fallback: search the insight set rather than inventing an answer. */
    const hits = e.insights.filter((i) => (i._meta.title + ' ' + i.what_happened + ' ' + i.why.root_cause).toLowerCase().split(/\W+/).some((w) => w.length > 3 && q.includes(w)));
    if (hits.length) {
      return { html: `Closest matches in the current feed:<ul>${hits.slice(0, 3).map(insLine).join('')}</ul><div class="src">I answer from the ${e.insights.length} insights the engine has computed — I will not answer beyond the data.</div>`, chips: hits.slice(0, 3).map((i) => chip(i._meta.title, () => drillInsight(i))) };
    }
    return {
      html: `I do not have an answer grounded in the current data for that, and I would rather say so than guess.
        <p style="margin:9px 0 0">I can answer questions about: the day's priorities, NPS and CSAT movement, the backlog and SLA position, the new-hire QA gap, emerging contact topics, churn and renewal risk, compliance exposure, and where revenue is at risk.</p>
        <div class="src">Offline build: answers are templated over the engine's computed insight objects, not generated by a language model. Every number above is traceable to a record.</div>`,
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
      state.chat.push({ who: 'OpsPulse', html: `Good ${hourGreeting()}. I have analysed <strong>${fmt.int(eng().run.stats.records_in)}</strong> records across tickets, escalations, QA and NPS. Ask me anything about the operation — or start with the question most people open with.`, chips: [] });
    }
    for (const m of state.chat) {
      const box = el('div', 'msg' + (m.who === 'You' ? ' me' : ''));
      box.innerHTML = `<span class="who">${esc(m.who)}</span><div class="bubble">${m.html}</div>`;
      if (m.chips?.length) {
        const acts = el('div', 'acts');
        m.chips.forEach((c) => { const b = el('button', 'lv-btn', esc(c.label)); b.addEventListener('click', c.fn); acts.appendChild(b); });
        box.appendChild(acts);
      }
      log.appendChild(box);
    }
    chat.appendChild(log);

    const sug = el('div', 'suggest');
    SUGGESTIONS.forEach((s) => { const b = el('button', '', esc(s)); b.addEventListener('click', () => ask(s)); sug.appendChild(b); });
    chat.appendChild(sug);

    const ask_ = el('form', 'chat-ask');
    ask_.innerHTML = '<input id="cpQ" placeholder="Ask about risks, causes, customers, revenue…" autocomplete="off"/><button class="lv-btn primary" type="submit">Ask</button>';
    ask_.addEventListener('submit', (e2) => { e2.preventDefault(); const v = ask_.querySelector('#cpQ').value.trim(); if (v) ask(v); });
    chat.appendChild(ask_);
    p.appendChild(chat);
    wrap.appendChild(p);

    setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
    return wrap;
  }

  function ask(q) {
    state.chat.push({ who: 'You', html: esc(q), chips: [] });
    const a = answer(q);
    state.chat.push({ who: 'OpsPulse', html: a.html, chips: a.chips });
    render();
    setTimeout(() => { const l = body.querySelector('.chat-log'); if (l) l.scrollTop = l.scrollHeight; }, 0);
  }

  /* ══════════════════════════════════════════════════════════════════════
     DECISION LEDGER
     ----------------------------------------------------------------------
     The loop was open: the product detected, explained, recommended — and
     then forgot. Detection without a record of what was decided is reporting,
     not decision intelligence. This closes it.

     The ledger deliberately does NOT ask the engine what a decision was worth
     after the fact. It snapshots severity, confidence and the metric AS THEY
     WERE at commit time, then re-reads the same signal on every engine pass.
     Outcome is the difference between those two readings — which means the
     product can be wrong in public, and that is the point.
     ══════════════════════════════════════════════════════════════════════ */

  /** `quiet` batches a commit: no toast, no navigation — the caller does both. */
  function commitDecision(ins, { quiet = false } = {}) {
    const m = ins._meta;
    const key = signalKey(ins);
    const existing = store.decisions.find((x) => x.signal_key === key && x.status !== 'closed');
    if (existing) {
      if (quiet) return existing;
      toast('Already in the ledger', `${existing.decision_id} — ${existing.title}`);
      state.view = 'ledger'; render(); body.scrollTop = 0;
      return existing;
    }
    const rec = store.recordDecision({
      signal_key: key,
      insight_id: ins.insight_id,
      signal_type: ins.signal_type,
      title: m.title,
      metric_label: m.metric_label,
      unit: m.unit,
      action: ins.recommended_action.action,
      owner_role: ins.recommended_action.owner_role,
      playbook_id: ins.recommended_action.playbook_id,
      root_cause: firstSentence(ins.why.root_cause),
      severity_at_decision: ins.severity_score,
      confidence_at_decision: ins.why.confidence,
      observed_at_decision: m.observed,
      baseline_at_decision: m.baseline,
      affected_accounts: m.affected_accounts,
      value_low: ins.expected_impact.range_low_usd,
      value_high: ins.expected_impact.range_high_usd,
      horizon_days: ins.expected_impact.time_horizon_days,
      // Committing below the cutoff is ALLOWED but permanently recorded. A
      // control you can bypass silently is not a control.
      held_at_decision: ins.status === 'held_for_review',
    });
    if (quiet) return rec;
    toast(`${rec.decision_id} recorded`, `${rec.owner_role} · playbook ${rec.playbook_id}`);
    state.view = 'ledger'; render(); body.scrollTop = 0;
    return rec;
  }

  /** Re-read the signal this decision was taken against, and score the move. */
  function ledgerOutcome(dec) {
    const live = eng().insights.find((i) => signalKey(i) === dec.signal_key);
    if (!live) {
      return {
        key: 'cleared', label: 'Cleared', color: STATUS.good, sevNow: null, observedNow: null,
        detail: 'no longer clears its detection threshold',
      };
    }
    const sevNow = live.severity_score;
    const delta = sevNow - dec.severity_at_decision;
    const detail = `severity ${dec.severity_at_decision} → ${sevNow}`;
    if (delta <= -5) return { key: 'improving', label: 'Improving', color: STATUS.good, sevNow, observedNow: live._meta.observed, detail, live };
    if (delta >= 5) return { key: 'worsening', label: 'Worsening', color: STATUS.critical, sevNow, observedNow: live._meta.observed, detail, live };
    return { key: 'holding', label: 'Holding', color: STATUS.warning, sevNow, observedNow: live._meta.observed, detail, live };
  }

  const DEC_STATUS = {
    open: { label: 'Open', chip: '' },
    in_progress: { label: 'In progress', chip: 'info' },
    closed: { label: 'Closed', chip: 'ok' },
  };

  function ledgerRow(dec) {
    const oc = ledgerOutcome(dec);
    const f = unitFmt(dec.unit);
    const pct = Math.round(dec.confidence_at_decision * 100);
    const st = DEC_STATUS[dec.status] || DEC_STATUS.open;

    const r = el('div', 'feed-row led');
    r.innerHTML = `
      <div class="sev"><b style="color:${oc.color}">${oc.sevNow ?? '✓'}</b><small>${oc.sevNow ? 'sev now' : 'clear'}</small></div>
      <div>
        <div class="ttl">${esc(dec.title)}</div>
        <div class="sub">
          <span class="chip">${esc(dec.decision_id)}</span>
          <span class="chip ${st.chip}">${esc(st.label)}</span>
          <span class="chip">${esc(dec.owner_role)}</span>
          <span class="chip">playbook ${esc(dec.playbook_id)}</span>
          ${dec.held_at_decision ? '<span class="chip held">committed below cutoff</span>' : ''}
          <span class="conf" title="Confidence recorded at the moment of the decision — not recomputed since">
            <span class="bar"><i style="width:${pct}%"></i></span><b>${pct}%</b> at decision
          </span>
        </div>
        <p class="led-act">${esc(dec.action)}</p>
        <div class="led-meta">
          <span><b>${esc(dec.metric_label)}</b></span>
          <span>at decision <b>${esc(f(dec.observed_at_decision))}</b>${dec.baseline_at_decision != null ? ` vs baseline ${esc(f(dec.baseline_at_decision))}` : ''}</span>
          ${oc.observedNow != null ? `<span>now <b style="color:${oc.color}">${esc(f(oc.observedNow))}</b></span>` : ''}
          <span>committed ${esc(relTime(dec.decided_at))} ago</span>
          <span>${dec.value_low == null ? 'not costed' : `${esc(fmt.usdK(dec.value_low))} – ${esc(fmt.usdK(dec.value_high))}`}</span>
        </div>
      </div>
      <div class="right">
        <div class="m" style="color:${oc.color}">${esc(oc.label)}</div>
        <div class="h">${esc(oc.detail)}</div>
      </div>`;

    const acts = el('div', 'act-row');
    if (dec.status === 'open') {
      const b = el('button', 'lv-btn', 'Mark in progress');
      b.addEventListener('click', () => { store.updateDecision(dec.decision_id, { status: 'in_progress' }); render(); });
      acts.appendChild(b);
    }
    if (dec.status !== 'closed') {
      const b = el('button', 'lv-btn', 'Close decision');
      b.addEventListener('click', () => {
        store.updateDecision(dec.decision_id, { status: 'closed', outcome_at_close: ledgerOutcome(dec).key });
        toast(`${dec.decision_id} closed`, `outcome recorded as ${ledgerOutcome(dec).label.toLowerCase()}`);
        render();
      });
      acts.appendChild(b);
    }
    if (oc.live) {
      const b = el('button', 'lv-btn', 'Open the signal');
      b.addEventListener('click', () => drillInsight(oc.live));
      acts.appendChild(b);
    }
    r.children[1].appendChild(acts);   // the middle column, next to .sev and .right
    return r;
  }

  function viewLedger() {
    const wrap = el('div', 'lv-view');
    const decs = store.decisions;

    const p = el('div', 'panel');
    p.innerHTML = `<div class="panel-hd"><h3>Decision Ledger</h3><span class="hint">every commitment, the evidence behind it, and what happened next</span></div>`;
    const bd = el('div', 'panel-bd');

    if (!decs.length) {
      bd.appendChild(el('div', 'empty', 'No decisions committed yet. Open any risk in the Decision Feed and commit the recommended action — it is recorded here with the evidence as it stood at that moment.'));
      const go = el('div', 'act-row');
      const b = el('button', 'lv-btn primary', 'Open the Decision Feed →');
      b.addEventListener('click', () => { state.view = 'feed'; render(); body.scrollTop = 0; });
      go.appendChild(b);
      bd.appendChild(go);
      p.appendChild(bd); wrap.appendChild(p);
      return wrap;
    }

    const outcomes = decs.map(ledgerOutcome);
    const cleared = outcomes.filter((o) => o.key === 'cleared' || o.key === 'improving').length;
    const costed = decs.filter((d) => d.value_low != null);
    const addressed = costed.reduce((s, d) => s + (d.value_low + d.value_high) / 2, 0);

    const k = el('div', 'drill-kpis');
    k.innerHTML = [
      { k: 'Decisions committed', v: String(decs.length), s: `${decs.filter((d) => d.status !== 'closed').length} still open` },
      { k: 'Moving the right way', v: `${cleared}/${decs.length}`, s: 'cleared or improving since commit', color: cleared ? STATUS.good : undefined },
      { k: 'Value addressed', v: costed.length ? fmt.usdK(addressed) : '—', s: `${costed.length} of ${decs.length} carried a costed range` },
      { k: 'Below-cutoff overrides', v: String(decs.filter((d) => d.held_at_decision).length), s: `confidence floor is ${Math.round(CONFIDENCE_CUTOFF * 100)}%` },
    ].map((x) => `<div><div class="k">${esc(x.k)}</div><div class="v" ${x.color ? `style="color:${x.color}"` : ''}>${esc(x.v)}</div><div class="s">${esc(x.s)}</div></div>`).join('');
    bd.appendChild(k);

    const list = el('div', 'feed');
    list.style.marginTop = '14px';
    for (const d of decs) list.appendChild(ledgerRow(d));
    bd.appendChild(list);

    const note = el('p', 'muted');
    note.style.cssText = 'font-size:.74rem;margin:14px 0 0;line-height:1.6';
    note.innerHTML = `Outcome is measured by re-reading the <b>same signal</b> the decision was taken against — matched on signal type and entity, not on insight id, because the engine rebuilds insight objects on every pass. <b>Cleared</b> means that signal no longer clears its detection threshold. Confidence and severity shown are the values recorded at commit time and are never back-dated.`;
    bd.appendChild(note);

    p.appendChild(bd);
    wrap.appendChild(p);
    return wrap;
  }

  /* ══════════════════════════════════════════════════════════════════════
     ASSURANCE — the audit surface
     ----------------------------------------------------------------------
     This was a sidebar panel titled "Engine run". It is the artifact a risk,
     audit or data-governance reviewer actually asks for, so it is a screen.
     ══════════════════════════════════════════════════════════════════════ */

  function viewAssurance() {
    const e = eng(), r = e.run, d = ds();
    const wrap = el('div', 'lv-view');

    const p = el('div', 'panel');
    p.innerHTML = `<div class="panel-hd"><h3>Assurance</h3><span class="hint">contract ${r.contract_valid ? 'valid' : 'INVALID'} · ${Object.values(r.timings_ms).reduce((a, x) => a + x, 0)} ms last pass</span></div>`;
    const bd = el('div', 'panel-bd');

    const k = el('div', 'drill-kpis');
    k.innerHTML = [
      { k: 'Records analysed', v: fmt.int(r.stats.records_in), s: 'tickets · escalations · NPS · QA' },
      { k: 'Anomalies flagged', v: String(r.stats.anomalies_flagged), s: `from ${r.detectors_run.length} detectors` },
      { k: 'Insights published', v: String(r.stats.insights_built), s: 'one card per entity' },
      { k: 'Held for review', v: String(r.stats.held_for_review), s: `below the ${Math.round(CONFIDENCE_CUTOFF * 100)}% confidence floor`, color: r.stats.held_for_review ? STATUS.warning : undefined },
      { k: 'Contract validation', v: r.contract_valid ? 'PASS' : 'FAIL', s: `${r.contract_errors.length} schema error${r.contract_errors.length === 1 ? '' : 's'}`, color: r.contract_valid ? STATUS.good : STATUS.critical },
    ].map((x) => `<div><div class="k">${esc(x.k)}</div><div class="v" ${x.color ? `style="color:${x.color}"` : ''}>${esc(x.v)}</div><div class="s">${esc(x.s)}</div></div>`).join('');
    bd.appendChild(k);
    p.appendChild(bd);
    wrap.appendChild(p);

    /* ── The dials a customer owns ──────────────────────────────────────
       Four numbers, editable, that re-run the engine on change. They sit in
       Assurance rather than a settings modal on purpose: the honest place to
       show someone what a threshold does is beside the size of the set it
       selects. Each dial therefore carries its OWN live count — the headline
       KPIs above barely move when a dial turns (a detector that was already
       firing keeps firing, it just sweeps more accounts), so pointing at them
       would have been a claim the numbers don't support. */
    const tp = el('div', 'panel');
    tp.innerHTML = `<div class="panel-hd"><h3>Thresholds</h3><span class="hint">business definitions · yours to set</span></div>`;
    const tb = el('div', 'panel-bd');
    /* Days since each account last raised a ticket — the one input none of the
       account records carry directly. Built once for the silent dial. */
    const lastSeen = new Map(d.accounts.map((a) => [a.account_id, -Infinity]));
    for (const t of d.tickets) if (t.day_index > lastSeen.get(t.account_id)) lastSeen.set(t.account_id, t.day_index);
    const quietFor = (a) => d.meta.days - 1 - lastSeen.get(a.account_id);

    const DIALS = [
      { k: 'adoption_risk_pct', label: 'Low adoption below', unit: '%', hint: 'active seats as a share of provisioned',
        sel: (v) => d.accounts.filter((a) => a.usage && a.usage.feature_adoption_pct < v) },
      { k: 'renewal_window_days', label: 'Renewal window', unit: 'days', hint: 'how far ahead a renewal is this quarter\u2019s problem',
        sel: (v) => d.accounts.filter((a) => a.renewal_in_days >= 0 && a.renewal_in_days <= v) },
      { k: 'usage_decline_pct', label: 'Usage decline at', unit: '%', hint: 'fall over 30 days that counts as a decline',
        sel: (v) => d.accounts.filter((a) => a.usage && a.usage.usage_trend_30d <= -v) },
      { k: 'silent_account_days', label: 'Silent after', unit: 'days', hint: 'no support contact for this long',
        sel: (v) => d.accounts.filter((a) => quietFor(a) >= v) },
    ];
    const grid = el('div', 'thr-grid');
    for (const d of DIALS) {
      const row = el('div', 'thr-row');
      const hit = d.sel(TUNABLE[d.k]);
      const hitArr = hit.reduce((s2, a) => s2 + (a.arr_usd || 0), 0);
      row.innerHTML = `<label for="thr_${d.k}">${esc(d.label)}</label>
        <span class="thr-in"><input id="thr_${d.k}" type="number" min="1" max="${d.k.endsWith('_pct') ? 100 : 400}" step="${d.k.endsWith('_pct') ? 5 : 10}" value="${TUNABLE[d.k]}" /><span>${esc(d.unit)}</span></span>
        <small>${esc(d.hint)} &middot; <b class="thr-n">selects ${fmt.int(hit.length)} account${hit.length === 1 ? '' : 's'}</b> holding ${esc(fmt.usdK(hitArr))}</small>`;
      const inp = row.querySelector('input');
      inp.addEventListener('change', () => {
        try { setTunable(d.k, inp.value); } catch { inp.value = TUNABLE[d.k]; return; }
        /* Re-run the engine rather than patching the view: these feed nine
           detectors, and re-deriving is the only way the numbers on screen
           stay consistent with each other. */
        store.recompute('thresholds');
        render();
      });
      grid.appendChild(row);
    }
    tb.appendChild(grid);
    const tnote = el('p', 'muted');
    tnote.style.cssText = 'font-size:.74rem;margin:calc(var(--u)*1.5) 0 0;line-height:1.55';
    tnote.innerHTML = 'These four are business definitions \u2014 two customers do not share a meaning of \u201clow adoption.\u201d The statistical bars each detector clears (z-scores, minimum samples) are deliberately <b>not</b> on this panel: they hold the false-positive rate down and are ours to defend, not yours to turn.';
    tb.appendChild(tnote);
    tp.appendChild(tb);
    wrap.appendChild(tp);

    /* The four governance rules, stated as rules rather than marketing. */
    const gp = el('div', 'panel');
    gp.innerHTML = '<div class="panel-hd"><h3>Governance rules in force</h3><span class="hint">these are enforced in code, not in policy</span></div>';
    const gbd = el('div', 'panel-bd');
    const gg = el('div', 'q-grid');
    [
      ['Confidence floor', `Anything below <b>${Math.round(CONFIDENCE_CUTOFF * 100)}%</b> is marked <code>held_for_review</code> and is never auto-actioned. ${r.stats.held_for_review} insight${r.stats.held_for_review === 1 ? ' is' : 's are'} held on this pass. Committing one anyway is permitted — and permanently recorded in the ledger as an override.`],
      ['Cause is always a hypothesis', 'Every <code>why</code> block carries <code>hypothesis: true</code> as a structural field. The system attributes by decomposition — contributions are shares of a measured delta and sum to 100% — and never claims a confirmed cause. A human closes that gap.'],
      ['Some exposures are not priced', 'Compliance exposure returns <code>null</code> for value at risk. <code>null</code> is a legal, validated value in the contract. A fabricated fine probability would be the least defensible number in the product, so the system declines to produce one.'],
      ['Nothing reaches the UI as free text', 'Every card is a rendering of a validated insight object. Detection is arithmetic; the language layer only describes what detection already found. It cannot introduce a claim the data does not support.'],
    ].forEach(([h, body_]) => {
      const q = el('div', 'qbox');
      q.innerHTML = `<h5>${esc(h)}</h5><p>${body_}</p>`;
      gg.appendChild(q);
    });
    gbd.appendChild(gg);
    gp.appendChild(gbd);
    wrap.appendChild(gp);

    /* Detectors and their declared thresholds — arguable by a reviewer. */
    const TH_NOTE = {
      escalation_spike: 'two-proportion z ≥ 2.5 on escalation rate, per category',
      emerging_topic: 'volume ≥ 1.35× its own baseline AND share-of-mix z ≥ 2.5',
      backlog_risk: 'sustained queue growth ≥ 3 tickets/day',
      coaching_gap: 'QA gap ≥ 8 points AND Welch t ≥ 2.5 between cohorts',
      nps_drop: 'NPS fall ≥ 8 points on ≥ 40 responses',
      csat_drop: 'mean-star fall ≥ 0.25 AND Welch t ≥ 2',
      churn_risk: 'repeat escalations + detractor/low CSAT, ARR floor $60k, ≥ 5 accounts',
      compliance_risk: 'open statutory requests against their legal deadline',
      sla_risk: 'two-proportion z ≥ 2.5 on SLA breach rate',
    };
    const dp = table(
      [{ label: 'Detector', key: 'name' }, { label: 'Threshold it must clear', key: 'th' }, { label: 'Firing now', key: 'found', num: true }],
      r.detectors_run.map((x) => ({
        name: x.detector.replace(/_/g, ' '),
        th: TH_NOTE[x.detector] || 'declared in engine/web/detect.js',
        found: x.found,
      })),
      { title: 'Detectors and declared thresholds', hint: `minimum sample ${r.thresholds.min_sample} recent records before any anomaly is raised` },
    );
    const dnote = el('p', 'muted');
    dnote.style.cssText = 'font-size:.74rem;margin:10px 0 0;line-height:1.6';
    dnote.innerHTML = `No detector knows what generated the data. Each compares a recent window against this operation's own baseline and raises a card only when the difference clears the stated threshold — which is why a quiet week produces an empty feed rather than invented findings.`;
    dp.querySelector('.panel-bd').appendChild(dnote);
    wrap.appendChild(dp);

    /* Provenance — where every published field came from. */
    const rows = [];
    for (const i of e.insights) {
      for (const [field, src] of Object.entries(i._meta.provenance || {})) {
        rows.push({ ins: i._meta.title, field: field.replace(/_/g, ' '), src });
      }
    }
    wrap.appendChild(table(
      [{ label: 'Insight', key: 'ins' }, { label: 'Field', key: 'field' }, { label: 'Derived from', key: 'src' }],
      rows, { title: 'Provenance of the current feed', hint: `${rows.length} traced fields · no field is published without a source` },
    ));

    /* Coverage: the contract's declared signal vocabulary vs what fired. */
    const cp = el('div', 'panel');
    cp.innerHTML = '<div class="panel-hd"><h3>Signal coverage</h3><span class="hint">the contract\'s full vocabulary, and what is live</span></div>';
    const cbd = el('div', 'panel-bd');
    const cd = el('div', 'drv');
    cd.innerHTML = SIGNAL_TYPES.map((t) => {
      const n = e.insights.filter((i) => i.signal_type === t).length;
      return `<div class="drv-row" style="grid-template-columns:1fr auto"><span class="n">${esc(t.replace(/_/g, ' '))}</span><span class="v" style="color:${n ? STATUS.warning : 'var(--text-dim)'}">${n || '—'}</span></div>`;
    }).join('');
    cbd.appendChild(cd);
    const cnote = el('p', 'muted');
    cnote.style.cssText = 'font-size:.74rem;margin:10px 0 0;line-height:1.6';
    cnote.innerHTML = `A dash means that signal type is defined in the contract and currently silent — not missing. Data last ingested: ${fmt.int(d.tickets.length)} tickets, ${fmt.int(d.escalations.length)} escalations, ${fmt.int(d.nps.length)} NPS responses, ${fmt.int(d.qa.length)} QA reviews.`;
    cbd.appendChild(cnote);
    cp.appendChild(cbd);
    wrap.appendChild(cp);

    if (!r.contract_valid) {
      const ep = el('div', 'panel');
      ep.innerHTML = '<div class="panel-hd"><h3>Contract violations</h3><span class="hint">published anyway — visibly</span></div>';
      const ebd = el('div', 'panel-bd');
      ebd.innerHTML = `<ul class="steps">${r.contract_errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
      ep.appendChild(ebd);
      wrap.appendChild(ep);
    }

    return wrap;
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
      <p>Support tickets · QA reviews · NPS responses. Columns are matched automatically — the Kaggle
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
    note.innerHTML = `<b>Excel (.xlsx) is not supported in this offline build</b> — a real xlsx file is a zipped XML package and parsing it needs a library this dependency-free prototype does not ship. Export the sheet as CSV and it will ingest fully. This upload is not a progress bar: rows are parsed, mapped, appended to the live dataset and the nine detectors re-run, so the Decision Feed changes because of your file.`;
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
      rp.innerHTML = `<div class="panel-hd"><h3>Last ingest — ${esc(r.file)}</h3><span class="hint">${r.ok ? `detected as ${esc(r.kind)} data` : 'rejected'}</span></div>`;
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
          <p class="muted" style="font-size:.78rem;margin-top:10px">The engine re-ran over the combined dataset — check the Decision Feed for what changed.</p>`;
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
    const v = state.view === 'cohort' ? viewCohort()
      : state.view === 'accounts' ? viewAccounts()
      : state.view === 'account' ? viewAccount()
      : state.view === 'today' ? viewToday()
      : state.view === 'dash' ? viewDashboard()
      : state.view === 'feed' ? viewFeed()
      : state.view === 'radar' ? viewRadar()
      : state.view === 'ledger' ? viewLedger()
      : state.view === 'copilot' ? viewCopilot()
      : state.view === 'assurance' ? viewAssurance()
      : viewUpload();
    body.appendChild(v);
    body.scrollTop = scrollTop;
    refreshChrome();
  }

  const toggleBtn = root.querySelector('#opToggle');
  toggleBtn.addEventListener('click', () => store.toggle());
  root.querySelector('#opData').addEventListener('click', () => { state.view = 'upload'; render(); body.scrollTop = 0; });
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
  return { destroy: () => { unsub(); modal.remove(); toasts.remove(); root.innerHTML = ''; } };
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
