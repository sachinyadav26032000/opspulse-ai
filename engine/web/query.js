/* ==========================================================================
   Composable account queries
   --------------------------------------------------------------------------
   The Executive Copilot could previously answer a fixed set of questions about
   insights the engine had already computed. It could not answer "Q3 renewals,
   now filter to under 50% adoption" because there was no query layer at all:
   every question ran fresh against pre-computed objects.

   This module is that layer. Three properties matter more than breadth:

   1. FIXED, PARAMETERISED QUERY TYPES — never open-ended generation.
      A model that writes its own filters invents joins, and the numbers stop
      reconciling. Every question maps to one of the types in QUERY_TYPES with
      typed parameters, or it maps to nothing and we say so. "Nothing" is a
      first-class, well-handled outcome here, not an error path.

   2. COMPOSITION IS A STACK, NOT A RE-RUN.
      `Give me Q3 renewals` then `now under 50% adoption` must narrow the first
      result set rather than run a fresh query. The stack is an ordered list of
      filters ANDed together; the UI shows it as removable pills so a user can
      see what they have narrowed to and undo any step.

   3. CONFIDENCE IS DATA COVERAGE, NOT A GUESS.
      A query has no statistical confidence the way a detector does. Claiming
      one would be fabrication. What can honestly be reported is how completely
      the underlying fields cover the book, and which field is the weakest link.
      That is what `confidenceOf` computes, and the weakest field is always
      named as the limiting factor.

   Reads exclusively through aggregate.js, per the rule that a number on a card
   and the same number behind a chart must come from one call.
   ========================================================================== */

import { accountRollup } from './aggregate.js';

/* The complete set. A question maps to one of these or to nothing. */
export const QUERY_TYPES = {
  RENEWAL_WINDOW: 'renewal_window',
  ADOPTION_THRESHOLD: 'adoption_threshold',
  ARR_THRESHOLD: 'arr_threshold',
  RISK_FILTER: 'risk_filter',
  ACCOUNT_LOOKUP: 'account_lookup',
  EXPOSURE_ROLLUP: 'exposure_rollup',
  CAUSE_GROUPING: 'cause_grouping',
  EXTERNAL_FILTER: 'external_filter',
};

/* Which types narrow the set (push a pill) and which read whatever the stack
   currently holds. An aggregation must never silently become a filter, or the
   pills stop describing the result. */
const FILTERS = new Set([
  QUERY_TYPES.RENEWAL_WINDOW,
  QUERY_TYPES.ADOPTION_THRESHOLD,
  QUERY_TYPES.ARR_THRESHOLD,
  QUERY_TYPES.RISK_FILTER,
  QUERY_TYPES.EXTERNAL_FILTER,
]);
export const isFilter = (q) => FILTERS.has(q?.type);

/* ------------------------------------------------------------------
   Field coverage
   ------------------------------------------------------------------ */

/* Per query type, the fields it actually reads. Confidence is reported as the
   coverage of these fields across the rows in scope, so the figure is a
   statement about the data rather than about the engine's belief. */
const FIELDS_USED = {
  [QUERY_TYPES.RENEWAL_WINDOW]: ['renewal_in_days'],
  [QUERY_TYPES.ADOPTION_THRESHOLD]: ['adoption_pct'],
  [QUERY_TYPES.ARR_THRESHOLD]: ['arr_usd'],
  [QUERY_TYPES.RISK_FILTER]: ['recent_escalations', 'nps', 'adoption_pct'],
  [QUERY_TYPES.ACCOUNT_LOOKUP]: ['adoption_pct', 'renewal_in_days', 'arr_usd'],
  [QUERY_TYPES.EXPOSURE_ROLLUP]: ['arr_usd', 'renewal_in_days'],
  [QUERY_TYPES.CAUSE_GROUPING]: ['adoption_pct', 'recent_escalations', 'nps'],
  /* External coverage is deliberately NOT reported as a percentage of the
     book: no feed covers every company, so a low number here would read as a
     data-quality failure when it is simply how corporate events work. */
  [QUERY_TYPES.EXTERNAL_FILTER]: ['arr_usd'],
};

/* Human names, so the limiting factor reads as a sentence rather than a column. */
const FIELD_LABEL = {
  renewal_in_days: 'renewal dates',
  adoption_pct: 'product usage',
  arr_usd: 'contract value',
  recent_escalations: 'escalation history',
  nps: 'NPS responses',
};

/**
 * Coverage-based confidence, with the weakest contributing field named.
 * Deliberately not a probability that the answer is "right" — a filter is
 * either applied or not. It is the share of rows for which every field the
 * query touched is actually present.
 */
export function confidenceOf(rows, type) {
  const fields = FIELDS_USED[type] || [];
  if (!rows.length || !fields.length) {
    return { pct: null, limiting_factor: 'no rows in scope' };
  }
  let worst = null;
  for (const f of fields) {
    const present = rows.filter((r) => r[f] != null).length;
    const pct = Math.round((present / rows.length) * 100);
    if (!worst || pct < worst.pct) worst = { field: f, pct };
  }
  return {
    pct: worst.pct,
    limiting_factor: worst.pct >= 100
      ? `complete coverage of ${FIELD_LABEL[worst.field] || worst.field}`
      : `${100 - worst.pct}% of accounts in scope have no ${FIELD_LABEL[worst.field] || worst.field}`,
  };
}

/* ------------------------------------------------------------------
   Applying the stack
   ------------------------------------------------------------------ */

/** Renewal date implied by the contract field, relative to the dataset's as-of. */
function renewalDate(row, ds) {
  return new Date(ds.meta.as_of + row.renewal_in_days * 86400000);
}

function applyOne(rows, q, ds) {
  switch (q.type) {
    case QUERY_TYPES.RENEWAL_WINDOW: {
      if (q.params.quarter) {
        const { quarter, year } = q.params;
        return rows.filter((r) => {
          if (r.renewal_in_days == null) return false;
          const d = renewalDate(r, ds);
          return Math.floor(d.getMonth() / 3) + 1 === quarter && d.getFullYear() === year;
        });
      }
      const max = q.params.days;
      return rows.filter((r) => r.renewal_in_days != null && r.renewal_in_days <= max);
    }
    case QUERY_TYPES.ADOPTION_THRESHOLD: {
      const { op, value } = q.params;
      return rows.filter((r) => r.adoption_pct != null && (op === 'lt' ? r.adoption_pct < value : r.adoption_pct >= value));
    }
    case QUERY_TYPES.ARR_THRESHOLD: {
      const { op, value } = q.params;
      return rows.filter((r) => r.arr_usd != null && (op === 'lt' ? r.arr_usd < value : r.arr_usd >= value));
    }
    case QUERY_TYPES.RISK_FILTER:
      /* The same at-risk rule the engine's churn detector uses, kept here in
         one place so the Copilot and the Feed cannot disagree about who is at
         risk: a recent escalation, or a detractor NPS, or adoption down 10+
         points against the account's own baseline.

         An external risk event qualifies ON ITS OWN. That is the entire point
         of the external feed: an account being acquired is at risk precisely
         WHEN its internal metrics look healthy, so requiring an internal
         signal too would filter out exactly the accounts this data exists to
         catch. */
      return rows.filter((r) =>
        externalReasonFor(r) != null ||
        (r.recent_escalations > 0) ||
        (r.nps != null && r.nps <= 6) ||
        (r.adoption_delta_pct != null && r.adoption_delta_pct <= -10));
    case QUERY_TYPES.EXTERNAL_FILTER:
      return rows.filter((r) => (r.external_signals || []).some((s) => !q.params.type || s.type === q.params.type));
    default:
      return rows;
  }
}

/** Resolve an ordered filter stack to the rows that survive all of it. */
export function resolve(ds, stack) {
  let rows = accountRollup(ds);
  for (const q of stack) if (isFilter(q)) rows = applyOne(rows, q, ds);
  return rows;
}

/* ------------------------------------------------------------------
   Natural language → a query, or nothing
   ------------------------------------------------------------------ */

const MONTH_QUARTER = { q1: 1, q2: 2, q3: 3, q4: 4 };

/**
 * Map a question to one parameterised query.
 *
 * Returns null when nothing matches. The caller must then say what it cannot
 * answer and offer the nearest supported query — never guess. Order matters:
 * the most specific patterns are tested first.
 */
export function parseQuestion(text, ds, scope) {
  const q = String(text || '').toLowerCase().replace(/[^a-z0-9%$.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const asOfYear = new Date(ds.meta.as_of).getFullYear();

  /* Account lookup: "why is Fable Media in there". Tested first because a
     company name can contain words that look like other intents. */
  const named = matchAccount(q, ds, scope);
  if (named && /\bwhy\b|\babout\b|\bexplain\b|\bwho\b|\btell me\b/.test(q)) {
    return {
      type: QUERY_TYPES.ACCOUNT_LOOKUP,
      params: { account_id: named.account.account_id, shared_name: named.sharedName },
      label: named.account.company,
    };
  }

  /* Quarter: "Q3", "q3 renewals", "my Q3 renewal number" */
  const qm = q.match(/\bq([1-4])\b/);
  if (qm && /renew/.test(q)) {
    const quarter = MONTH_QUARTER['q' + qm[1]];
    return { type: QUERY_TYPES.RENEWAL_WINDOW, params: { quarter, year: asOfYear }, label: `Q${quarter} ${asOfYear} renewals` };
  }

  /* Explicit day/month window: "renewals in the next 90 days" */
  const dm = q.match(/(?:next|within|in)\s+(\d+)\s*(day|days|month|months)/);
  if (dm && /renew/.test(q)) {
    const n = Number(dm[1]);
    const days = /month/.test(dm[2]) ? n * 30 : n;
    return { type: QUERY_TYPES.RENEWAL_WINDOW, params: { days }, label: `renewing within ${days} days` };
  }
  if (/renew/.test(q) && /quarter|this quarter/.test(q)) {
    const quarter = Math.floor(new Date(ds.meta.as_of).getMonth() / 3) + 1;
    return { type: QUERY_TYPES.RENEWAL_WINDOW, params: { quarter, year: asOfYear }, label: `Q${quarter} ${asOfYear} renewals` };
  }

  /* Adoption / usage threshold: "under 50% monthly active usage",
     "below 60% adoption", "above 80% adoption" */
  const am = q.match(/(under|below|less than|above|over|at least)\s+(\d{1,3})\s*%?/);
  if (am && /(adopt|usage|active|utilis|utiliz|seats)/.test(q)) {
    const op = /(under|below|less than)/.test(am[1]) ? 'lt' : 'gte';
    const value = Number(am[2]);
    return {
      type: QUERY_TYPES.ADOPTION_THRESHOLD,
      params: { op, value },
      label: `adoption ${op === 'lt' ? 'under' : 'at or above'} ${value}%`,
    };
  }

  /* ARR threshold: "over $100k ARR" */
  const arrm = q.match(/(under|below|above|over|at least)\s*\$?\s*([\d.]+)\s*(k|m)?/);
  if (arrm && /(arr|contract|revenue|value|worth)/.test(q) && !/adopt|usage|renew/.test(q)) {
    const mult = arrm[3] === 'm' ? 1e6 : arrm[3] === 'k' ? 1e3 : 1;
    const value = Number(arrm[2]) * mult;
    const op = /(under|below)/.test(arrm[1]) ? 'lt' : 'gte';
    return { type: QUERY_TYPES.ARR_THRESHOLD, params: { op, value }, label: `ARR ${op === 'lt' ? 'under' : 'at or above'} $${fmtK(value)}` };
  }

  /* Exposure rollup: "how much ARR is at risk" */
  if (/(how much|total|sum)/.test(q) && /(arr|revenue|exposure|at risk|exposed)/.test(q)) {
    return { type: QUERY_TYPES.EXPOSURE_ROLLUP, params: {}, label: 'ARR exposed' };
  }

  /* Cause grouping: "why are they at risk", "what are the reasons" */
  if (/(reason|cause|why are|what is driving|drivers)/.test(q)) {
    return { type: QUERY_TYPES.CAUSE_GROUPING, params: {}, label: 'reasons, ranked' };
  }

  /* External events: "which customers have been acquired", "any acquisitions",
     "who lost their champion". Tested before the generic risk filter so the
     more specific question wins. */
  if (/(acqui|merger|merged|bought|takeover)/.test(q)) {
    return { type: QUERY_TYPES.EXTERNAL_FILTER, params: { type: 'acquisition' }, label: 'acquisition or merger' };
  }
  if (/(bankrupt|distress|insolven|administration|restructur)/.test(q)) {
    return { type: QUERY_TYPES.EXTERNAL_FILTER, params: { type: 'distress' }, label: 'financial distress' };
  }
  if (/(champion|stakeholder|sponsor|left|departur|departed)/.test(q)) {
    return { type: QUERY_TYPES.EXTERNAL_FILTER, params: { type: 'stakeholder_change' }, label: 'stakeholder departure' };
  }
  if (/(funding|raised|series [a-e]|expansion opportunit)/.test(q)) {
    return { type: QUERY_TYPES.EXTERNAL_FILTER, params: { type: 'funding' }, label: 'funding raised' };
  }
  if (/(external|corporate event|news)/.test(q)) {
    return { type: QUERY_TYPES.EXTERNAL_FILTER, params: {}, label: 'any external event' };
  }

  /* Risk filter: "which accounts warrant attention", "who is at risk" */
  if (/(at risk|attention|worry|watch|trouble|churn)/.test(q)) {
    return { type: QUERY_TYPES.RISK_FILTER, params: {}, label: 'at-risk accounts' };
  }

  /* A bare company name with no question verb still resolves to that account. */
  if (named) {
    return {
      type: QUERY_TYPES.ACCOUNT_LOOKUP,
      params: { account_id: named.account.account_id, shared_name: named.sharedName },
      label: named.account.company,
    };
  }

  return null;
}

/**
 * Resolve a company name mentioned in a question to one account.
 *
 * Two things make this harder than a lookup. Company names are NOT unique in
 * this dataset (2,400 accounts share ~430 names, some up to 13 times), and
 * "why is X in there" is a question about the set the user is looking at. So:
 *
 *   - search the CURRENT filtered set first, because that is what "in there"
 *     refers to. Matching globally would resolve to an account the user cannot
 *     see and answer confidently about the wrong company.
 *   - prefer the longest name match, so "Fable Media Group" beats "Fable".
 *   - report how many candidates shared the name, so the caller can say the
 *     answer is about one of several rather than implying it is the only one.
 */
function matchAccount(q, ds, scope) {
  const pick = (list) => {
    let best = null, longest = 0;
    for (const a of list) {
      const name = (a.company || '').toLowerCase();
      if (!name || !q.includes(name)) continue;
      if (name.length > longest) { best = [a]; longest = name.length; }
      else if (name.length === longest && best) best.push(a);
    }
    return best;
  };
  /* Scope first, then the whole book, so a name absent from the current set
     still resolves rather than returning nothing. */
  const inScope = scope && scope.length ? pick(scope) : null;
  const candidates = inScope && inScope.length ? inScope : pick(ds.accounts);
  if (!candidates || !candidates.length) return null;
  /* Several accounts genuinely share this name. Take the largest by contract
     value and hand the count back so the answer can admit the ambiguity. */
  const sorted = candidates.slice().sort((a, b) => (b.arr_usd || 0) - (a.arr_usd || 0));
  return { account: sorted[0], sharedName: candidates.length, fromScope: !!(inScope && inScope.length) };
}

function fmtK(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'm';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

/* What we can offer when a question maps to nothing. Kept beside the parser so
   the two cannot drift apart. */
export const SUPPORTED = [
  'renewals in a quarter or a day window',
  'accounts above or below an adoption threshold',
  'accounts above or below a contract value',
  'which accounts are at risk',
  'total ARR exposed across the current set',
  'the reasons behind the current set, ranked',
  'a single account by name',
  'accounts carrying an external corporate event (acquisition, distress, stakeholder change, funding)',
];

/* ==========================================================================
   Building the structured answer
   --------------------------------------------------------------------------
   Every response has the same shape, because the value of this surface is that
   a director learns to read it once. Prose paragraphs would each have to be
   parsed afresh:

     headline   the one number the question asked for
     rows       the accounts behind it (the UI caps the render, never the count)
     why        what the number means, in one sentence, from the data
     confidence coverage, plus the field that limits it, always named
     actions    suggested refinements, as further queries rather than free text

   `unanswerable` is a first-class outcome. When it is set the UI must render
   the missing data and the nearest supported query, and must not render a
   number. A confidently wrong figure would undo the product's whole argument.
   ========================================================================== */

const money = (n) => '$' + fmtK(Math.round(n));

/** Total ARR across rows. Plain sum of a contract field, not an estimate. */
const arrOf = (rows) => rows.reduce((s, r) => s + (r.arr_usd || 0), 0);

/**
 * Why each account sits in the current set. Returns the single strongest
 * reason, in a fixed precedence, so the same account always explains itself
 * the same way. External events take precedence over internal scoring: see
 * `externalReasonFor`, which returns null until Task 2 wires the feed.
 */
export function reasonFor(row) {
  const ext = externalReasonFor(row);
  if (ext) return ext;
  if (row.adoption_delta_pct != null && row.adoption_delta_pct <= -10) {
    return { key: 'adoption_decline', label: 'Adoption decline', detail: `${row.adoption_baseline_pct}% to ${row.adoption_pct}% of seats active` };
  }
  if (row.recent_escalations > 0) {
    return { key: 'escalation', label: 'Open escalation', detail: `${row.recent_escalations} in the current window` };
  }
  if (row.nps != null && row.nps <= 6) {
    return { key: 'detractor', label: 'Detractor NPS', detail: `last score ${row.nps}` };
  }
  if (row.cancellation) return { key: 'cancellation', label: 'Cancellation contact', detail: 'raised a cancellation ticket' };
  return { key: 'stable', label: 'No open risk signal', detail: 'in scope by filter only' };
}

/* Placeholder until Task 2. Declared here so precedence is expressed in one
   place rather than bolted on later. */
function externalReasonFor(row) {
  const sig = (row.external_signals || []).filter((s) => s.effect === 'risk_up');
  if (!sig.length) return null;
  const top = sig.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
  return { key: 'external_event', label: externalLabel(top.type), detail: top.headline, external: top };
}

function externalLabel(type) {
  return type === 'acquisition' ? 'Acquired or merging'
    : type === 'distress' ? 'Financial distress'
    : type === 'stakeholder_change' ? 'Champion departed'
    : 'External event';
}

/**
 * Run a question against the current stack and return a structured answer.
 * `stack` is the filter stack BEFORE this question; the caller decides whether
 * to commit the returned `nextStack`.
 */
export function ask(ds, stack, text) {
  /* Resolve the CURRENT set before parsing, so a company name in the question
     can be matched against what the user is actually looking at. */
  const scope = resolve(ds, stack);
  const parsed = parseQuestion(text, ds, scope);

  if (!parsed) {
    return {
      unanswerable: {
        missing: 'That question does not map to a supported query.',
        supported: SUPPORTED,
      },
      nextStack: stack,
    };
  }

  /* A filter narrows what is already there; anything else reads the current
     set without changing it. */
  const nextStack = isFilter(parsed) ? [...stack, parsed] : stack;
  const rows = resolve(ds, nextStack);
  const conf = confidenceOf(rows, parsed.type);

  if (parsed.type === QUERY_TYPES.ACCOUNT_LOOKUP) {
    const all = resolve(ds, []);
    const row = all.find((r) => r.account_id === parsed.params.account_id);
    if (!row) {
      return { unanswerable: { missing: `No account named "${parsed.label}" in the current dataset.`, supported: SUPPORTED }, nextStack: stack };
    }
    const inSet = rows.some((r) => r.account_id === row.account_id);
    const reason = reasonFor(row);
    /* Company names are not unique in this dataset. Saying "Acme is in the set
       because X" when thirteen accounts are called Acme would be a confidently
       wrong answer about the wrong company, so the count is stated. */
    const shared = parsed.params.shared_name > 1
      ? ` ${parsed.params.shared_name} accounts share this company name; this is ${row.account_id}, the largest by contract value.`
      : '';
    return {
      query: parsed,
      headline: { value: money(row.arr_usd), label: `${row.company} · renews in ${row.renewal_in_days} days` },
      rows: [row],
      total: 1,
      why: (inSet
        ? `${row.company} is in this set because ${reason.label.toLowerCase()}: ${reason.detail}.`
        : `${row.company} is not in the current filtered set. ${reason.label}: ${reason.detail}.`) + shared,
      confidence: confidenceOf([row], parsed.type),
      actions: suggestions(ds, nextStack, rows),
      nextStack,
    };
  }

  if (parsed.type === QUERY_TYPES.EXPOSURE_ROLLUP) {
    const atRisk = rows.filter((r) => reasonFor(r).key !== 'stable');
    return {
      query: parsed,
      headline: { value: money(arrOf(atRisk)), label: `ARR exposed across ${atRisk.length} account${atRisk.length === 1 ? '' : 's'}` },
      rows: atRisk.slice().sort((a, b) => b.arr_usd - a.arr_usd),
      total: atRisk.length,
      why: `Contract value of the accounts in the current set carrying at least one open risk signal. This is ARR under contract on those accounts, not a prediction of what will be lost.`,
      confidence: conf,
      actions: suggestions(ds, nextStack, rows),
      nextStack,
    };
  }

  if (parsed.type === QUERY_TYPES.CAUSE_GROUPING) {
    const groups = new Map();
    for (const r of rows) {
      const g = reasonFor(r);
      if (!groups.has(g.key)) groups.set(g.key, { key: g.key, label: g.label, n: 0, arr: 0 });
      const e = groups.get(g.key);
      e.n++; e.arr += r.arr_usd || 0;
    }
    const ranked = [...groups.values()].sort((a, b) => b.arr - a.arr);
    return {
      query: parsed,
      headline: { value: String(ranked.length), label: `distinct reasons across ${rows.length} accounts` },
      rows: [],
      groups: ranked,
      total: rows.length,
      why: `Each account is grouped by its single strongest reason, in a fixed precedence, so one account is never counted under two headings.`,
      confidence: conf,
      actions: suggestions(ds, nextStack, rows),
      nextStack,
    };
  }

  /* The filter types all answer the same way: how many, worth how much. */
  return {
    query: parsed,
    headline: { value: String(rows.length), label: `accounts · ${money(arrOf(rows))} ARR` },
    rows: rows.slice().sort((a, b) => b.arr_usd - a.arr_usd),
    total: rows.length,
    why: whyFilter(parsed, rows, ds),
    confidence: conf,
    actions: suggestions(ds, nextStack, rows),
    nextStack,
  };
}

function whyFilter(q, rows, ds) {
  switch (q.type) {
    case QUERY_TYPES.RENEWAL_WINDOW:
      return q.params.quarter
        ? `Accounts whose contract renewal date falls in Q${q.params.quarter} ${q.params.year}. Renewal dates are a contract field, so this is exact rather than modelled.`
        : `Accounts renewing within ${q.params.days} days of ${new Date(ds.meta.as_of).toDateString()}.`;
    case QUERY_TYPES.ADOPTION_THRESHOLD:
      return `Adoption is weekly active seats over contracted seats, averaged across the ${ds.meta.days - ds.meta.recent_from}-day analysis window and compared with each account's own earlier baseline.`;
    case QUERY_TYPES.ARR_THRESHOLD:
      return `Filtered on contract value, which comes from billing rather than from any model.`;
    case QUERY_TYPES.EXTERNAL_FILTER:
      return `External corporate events, which internal metrics cannot see. These are SEEDED sample records, not a live feed: every one is marked as such and carries no source link, because a fabricated citation is worse than none.`;
    case QUERY_TYPES.RISK_FILTER:
      return `An account is at risk if it carries an external risk event, an escalation in the current window, a detractor NPS, or adoption down 10 or more points against its own baseline. An external event qualifies on its own, because an acquisition is most dangerous exactly when the internal metrics look fine.`;
    default:
      return '';
  }
}

/**
 * Next-step chips. These are refinements of the CURRENT set rather than fresh
 * questions, which is the behaviour that makes the surface feel composable.
 * Only offered when they would actually change the result.
 */
function suggestions(ds, stack, rows) {
  const out = [];
  const has = (t) => stack.some((s) => s.type === t);

  if (!has(QUERY_TYPES.ADOPTION_THRESHOLD) && rows.some((r) => r.adoption_pct != null && r.adoption_pct < 50)) {
    out.push({ label: 'Narrow to under 50% adoption', question: 'filter to under 50% adoption' });
  }
  if (!has(QUERY_TYPES.RISK_FILTER) && rows.some((r) => reasonFor(r).key !== 'stable')) {
    out.push({ label: 'Only at-risk accounts', question: 'which are at risk' });
  }
  if (!has(QUERY_TYPES.RENEWAL_WINDOW)) {
    out.push({ label: 'Renewing within 90 days', question: 'renewing in the next 90 days' });
  }
  if (!has(QUERY_TYPES.EXTERNAL_FILTER) && rows.some((r) => (r.external_signals || []).length)) {
    out.push({ label: 'Only external events', question: 'which have an external event' });
  }
  out.push({ label: 'Total ARR exposed', question: 'how much ARR is at risk' });
  out.push({ label: 'Break down the reasons', question: 'what are the reasons' });
  return out.slice(0, 4);
}

/**
 * The empty-state template chips, DERIVED from today's data rather than
 * hardcoded, so a chip never offers a question whose answer is zero. Each one
 * carries the real question text that will be run.
 */
export function templateQuestions(ds) {
  const rows = accountRollup(ds);
  const asOf = new Date(ds.meta.as_of);
  const quarter = Math.floor(asOf.getMonth() / 3) + 1;
  const out = [];

  const inQ = rows.filter((r) => {
    if (r.renewal_in_days == null) return false;
    const d = new Date(ds.meta.as_of + r.renewal_in_days * 86400000);
    return Math.floor(d.getMonth() / 3) + 1 === quarter && d.getFullYear() === asOf.getFullYear();
  });
  if (inQ.length) out.push({ label: `What is my Q${quarter} renewal number?`, question: `what is my Q${quarter} renewal number` });

  if (rows.some((r) => reasonFor(r).key !== 'stable')) {
    out.push({ label: 'Which accounts warrant attention today?', question: 'which accounts warrant attention today' });
    out.push({ label: 'How much ARR is at risk?', question: 'how much ARR is at risk' });
  }
  if (rows.some((r) => r.adoption_pct != null && r.adoption_pct < 60)) {
    out.push({ label: 'Which accounts are below 60% adoption?', question: 'which accounts are below 60% adoption' });
  }
  const biggest = rows.filter((r) => reasonFor(r).key !== 'stable').sort((a, b) => b.arr_usd - a.arr_usd)[0];
  if (biggest) out.push({ label: `Why is ${biggest.company} at risk?`, question: `why is ${biggest.company} at risk` });

  return out.slice(0, 6);
}
