/* ==========================================================================
   Aggregation layer — one place that knows how to slice the dataset.
   --------------------------------------------------------------------------
   Both the detection engine and every BI drill-down read through these
   functions, so a number on a card and the same number in the chart behind it
   can never disagree. That is the whole point of putting them here.
   ========================================================================== */

import { mean, median, safeDiv } from './stats.js';

export const DAY_MS = 86400000;

/* ── Window helpers ──────────────────────────────────────────────────────── */

export function windows(ds) {
  const recentFrom = ds.meta.recent_from;
  return {
    recentFrom,
    recentTo: ds.meta.days - 1,
    baseFrom: 0,
    baseTo: recentFrom - 1,
    recentDays: ds.meta.days - recentFrom,
    baseDays: recentFrom,
  };
}

export const inRecent = (ds) => (x) => x.day_index >= ds.meta.recent_from;
export const inBase = (ds) => (x) => x.day_index < ds.meta.recent_from;

export const dayLabel = (ds, d) =>
  new Date(ds.meta.day0 + d * DAY_MS).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* ── Generic shapes ──────────────────────────────────────────────────────── */

/** Count items per day index → dense array of length days. */
export function countByDay(items, days) {
  const out = new Array(days).fill(0);
  for (const it of items) if (it.day_index >= 0 && it.day_index < days) out[it.day_index]++;
  return out;
}

/** Mean of `valueOf` per day (days with no data → null, so lines break honestly). */
export function meanByDay(items, days, valueOf) {
  const acc = Array.from({ length: days }, () => []);
  for (const it of items) {
    const v = valueOf(it);
    if (v == null || Number.isNaN(v)) continue;
    if (it.day_index >= 0 && it.day_index < days) acc[it.day_index].push(v);
  }
  return acc.map((a) => (a.length ? mean(a) : null));
}

/** Rate (0–1) per day of items satisfying `hit`. */
export function rateByDay(items, days, hit) {
  const n = new Array(days).fill(0), k = new Array(days).fill(0);
  for (const it of items) {
    if (it.day_index < 0 || it.day_index >= days) continue;
    n[it.day_index]++;
    if (hit(it)) k[it.day_index]++;
  }
  return n.map((den, i) => (den ? k[i] / den : null));
}

/** Group into { key: items[] } preserving insertion order. */
export function groupBy(items, keyOf) {
  const m = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

/** Counts by key, sorted desc — the shape every bar chart wants. */
export function countBy(items, keyOf, limit = 0) {
  const m = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (k == null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  const rows = [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  return limit ? rows.slice(0, limit) : rows;
}

/** Rolling mean, used to keep noisy daily series legible without hiding shape. */
export function rolling(series, w = 7) {
  return series.map((_, i) => {
    const from = Math.max(0, i - w + 1);
    const slice = series.slice(from, i + 1).filter((v) => v != null);
    return slice.length ? mean(slice) : null;
  });
}

/* ── Domain metrics ──────────────────────────────────────────────────────── */

/** Net Promoter Score, −100…+100, from a set of responses. */
export function npsOf(responses) {
  if (!responses.length) return { nps: 0, promoters: 0, passives: 0, detractors: 0, n: 0 };
  const promoters = responses.filter((r) => r.score >= 9).length;
  const detractors = responses.filter((r) => r.score <= 6).length;
  const passives = responses.length - promoters - detractors;
  return {
    nps: Math.round(((promoters - detractors) / responses.length) * 100),
    promoters, passives, detractors, n: responses.length,
  };
}

export function csatOf(tickets) {
  const rated = tickets.filter((t) => t.customer_satisfaction_rating != null);
  if (!rated.length) return { avg: 0, pctSatisfied: 0, n: 0 };
  return {
    avg: mean(rated.map((t) => t.customer_satisfaction_rating)),
    pctSatisfied: safeDiv(rated.filter((t) => t.customer_satisfaction_rating >= 4).length, rated.length),
    n: rated.length,
  };
}

export const openTickets = (ds) => ds.tickets.filter((t) => !t.resolved_at);

export function backlogAges(ds) {
  const now = ds.meta.as_of;
  return openTickets(ds).map((t) => (now - t.created_at) / 3600000);
}

/** Resolution-SLA breach measured on tickets RESOLVED inside a day window —
 *  the reporting convention that avoids survivorship bias on open work. */
export function resolvedIn(ds, fromDay, toDay) {
  const lo = ds.meta.day0 + fromDay * DAY_MS;
  const hi = ds.meta.day0 + (toDay + 1) * DAY_MS;
  return ds.tickets.filter((t) => t.resolved_at != null && t.resolved_at >= lo && t.resolved_at < hi);
}

/** Per-account rollup — the unit churn risk is actually assessed on. */
export function accountRollup(ds) {
  const byAcct = new Map();
  const ensure = (id) => {
    if (!byAcct.has(id)) {
      byAcct.set(id, {
        account_id: id, tickets: 0, recent_tickets: 0, escalations: 0, recent_escalations: 0,
        breaches: 0, reopened: 0, nps: null, nps_day: -1, csat: [], cancellation: false,
      });
    }
    return byAcct.get(id);
  };
  const rf = ds.meta.recent_from;
  for (const t of ds.tickets) {
    const a = ensure(t.account_id);
    a.tickets++;
    if (t.day_index >= rf) a.recent_tickets++;
    if (t.sla_breached) a.breaches++;
    if (t.reopened) a.reopened++;
    if (t.category === 'Cancellation') a.cancellation = true;
    if (t.customer_satisfaction_rating != null) a.csat.push(t.customer_satisfaction_rating);
  }
  for (const e of ds.escalations) {
    const a = ensure(e.account_id);
    a.escalations++;
    if (e.day_index >= rf) a.recent_escalations++;
  }
  for (const r of ds.nps) {
    const a = ensure(r.account_id);
    if (r.day_index > a.nps_day) { a.nps = r.score; a.nps_day = r.day_index; a.nps_segment = r.segment; a.nps_driver = r.driver_tag; }
  }
  const meta = new Map(ds.accounts.map((a) => [a.account_id, a]));
  return [...byAcct.values()].map((a) => {
    const m = meta.get(a.account_id) || {};
    return { ...m, ...a, csat_avg: a.csat.length ? mean(a.csat) : null, ...adoptionOf(m, ds) };
  });
}

/**
 * Adoption, derived rather than stored.
 *
 * The generator packs only `usage_weeks` (exact integer active-seat counts) and
 * `seats` (the contracted number) onto an account. Every percentage below is
 * computed from those two integers at read time, so a printed "58%" genuinely
 * re-divides from the printed seat counts. Storing a rounded ratio alongside
 * exact counts would let the two drift, which is the failure rule 1 exists to
 * prevent.
 *
 * `recent` is the mean of the weeks inside the analysis window and `baseline`
 * the mean of everything before it, so the comparison is each account against
 * its own history rather than against the book.
 */
export function adoptionOf(acct, ds) {
  const w = acct?.usage_weeks;
  if (!Array.isArray(w) || !w.length || !acct.seats) {
    return { adoption_pct: null, adoption_baseline_pct: null, adoption_delta_pct: null, active_seats: null };
  }
  const from = ds?.meta?.recent_week_from ?? Math.max(0, w.length - 2);
  const recentWeeks = w.slice(from);
  const baseWeeks = w.slice(0, from);
  const seatsMean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  /* Round the seat means to whole seats FIRST, then divide. Deriving the
     percentage from the unrounded mean while printing the rounded seat count
     lets the two disagree by a point, which is exactly the drift rule 1
     forbids: the printed inputs must multiply out to the printed figure. */
  const round = (s) => (s == null ? null : Math.round(s));
  const recentSeats = round(seatsMean(recentWeeks));
  const baseSeats = round(seatsMean(baseWeeks));
  const pct = (s) => (s == null ? null : Math.round((s / acct.seats) * 100));

  const adoption = pct(recentSeats);
  const baseline = pct(baseSeats);
  return {
    active_seats: recentSeats,
    baseline_active_seats: baseSeats,
    adoption_pct: adoption,
    adoption_baseline_pct: baseline,
    /* Difference of the two ROUNDED percentages, not a rounding of the true
       difference, so "72% to 48%" always reports as exactly 24 points. */
    adoption_delta_pct: adoption == null || baseline == null ? null : adoption - baseline,
  };
}

/**
 * Accounts under management — one of the two axes the product is priced on, so
 * it gets one definition and every consumer reads it from here.
 *
 * The obvious implementation is `ds.accounts.length`, and it is wrong in a way
 * that only shows up on the exact customers we would be billing hardest.
 * `data/csv.js` gives an uploaded ticket a synthetic `account_id` of
 * `UP:<email|company|name>` whenever the row carries no id matching the master
 * list, and it never creates an account master record to go with it. So a
 * customer who uploads a book of 800 accounts adds 800 distinct account ids to
 * the ticket stream and ZERO to `ds.accounts`. Counting the master list would
 * read 2,400 and be wrong on precisely the number the invoice depends on.
 *
 * The union is therefore the honest count: every account we hold a contract
 * record for, plus every account we have seen traffic from. Note that it is
 * NOT filtered to accounts with recent activity — a dormant account is still
 * one we are storing, scoring and reporting on, and quietly dropping it would
 * be marking our own homework in our own favour.
 */
export function accountIdsUnderManagement(ds) {
  const ids = new Set();
  for (const a of ds.accounts) ids.add(a.account_id);
  for (const t of ds.tickets) if (t.account_id) ids.add(t.account_id);
  return ids;
}

export function accountsUnderManagement(ds) {
  return accountIdsUnderManagement(ds).size;
}

/**
 * Sources connected — the other priced axis.
 *
 * Counted as streams that actually carry records rather than as a static list
 * of six, so a customer who has connected tickets and nothing else is billed
 * for one source and not for the shape of our schema. Uploaded CSV counts as
 * its own source: it is a real ingest path with real rows behind it, and
 * pretending otherwise would let someone run the whole product through the
 * drop zone on the cheapest plan.
 */
export function sourcesConnected(ds) {
  const has = (rows) => Array.isArray(rows) && rows.length > 0;
  const uploaded = (rows) => Array.isArray(rows) && rows.some((r) => r.is_uploaded);
  return [
    { key: 'tickets',     label: 'Support tickets',  connected: has(ds.tickets),     records: ds.tickets.length },
    { key: 'escalations', label: 'Escalations',      connected: has(ds.escalations), records: ds.escalations.length },
    { key: 'nps',         label: 'NPS responses',    connected: has(ds.nps),         records: ds.nps.length },
    { key: 'qa',          label: 'QA reviews',       connected: has(ds.qa),          records: ds.qa.length },
    { key: 'accounts',    label: 'Account master',   connected: has(ds.accounts),    records: ds.accounts.length },
    {
      key: 'upload',
      label: 'CSV upload',
      connected: uploaded(ds.tickets) || uploaded(ds.nps) || uploaded(ds.qa),
      records: ds.tickets.filter((t) => t.is_uploaded).length
        + ds.nps.filter((n) => n.is_uploaded).length
        + ds.qa.filter((q) => q.is_uploaded).length,
    },
  ];
}

/** Median helper re-exported so drill-downs don't import two modules. */
export { median, mean };
