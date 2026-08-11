/* ==========================================================================
   Cost of goods — measured counters, and a margin model that admits it is one
   --------------------------------------------------------------------------
   THE COMMERCIAL POINT THIS FILE EXISTS TO EVIDENCE:

   Detection in this product is statistical, not generative. `engine/web/detect.js`
   runs nine detectors over the whole dataset with no model in the loop, and
   the language layer only ever narrates objects the arithmetic already
   produced. Models explain and summarise; they do not scan. So inference cost
   scales with DECISIONS SURFACED, not with DATA INGESTED — a customer can
   triple their ticket volume and our unit cost barely moves.

   That is the margin story, and it is only worth telling if the numbers behind
   it are honest. Which forces a split this file takes seriously:

   MEASURED — counted off the real dataset, engine run and ledger. These are
   facts about this build.

   MODELLED — what those counters would cost. Every rate here is an ASSUMPTION,
   because `engine/llm.js` is a deliberate stub that throws and the Copilot is
   templated NLG: this build makes ZERO inference calls, so there is no
   measured token spend to report and never will be until a provider is wired
   in. Reporting a single-point margin off invented rates would be the most
   quotable and least defensible number in the product.

   So margin comes back as a RANGE with its inputs attached, under the same
   rule dollar impact already obeys (`CLAUDE.md` §3.1): inputs are rounded to
   display precision BEFORE the range is computed, so the printed inputs
   genuinely multiply out to the printed range.

   THE FOUR COST DRIVERS ARE THE ONES THE PRICING PROPOSAL NAMES, not a set
   invented here. Three of them are exactly why the gated features are gated:
     · Contact centre    → ASR cost per call transcribed
     · External signals  → licensed feeds, $25–50K per source per YEAR
     · Executive Copilot → inference per query, unbounded by user behaviour
   Giving those away at the Essential price would destroy margin at precisely
   the tier with the least budget. The gating is a margin decision first and a
   packaging decision second.
   ========================================================================== */

import { accountsUnderManagement } from './aggregate.js';

const DAY_MS = 86400000;
const MONTH_DAYS = 30;

/* ── The modelling assumptions, in one place and printed on the surface ────
   Named `ASSUMED_` without exception. Nothing in this object was measured, and
   the naming is the guardrail: a variable called `inferenceRate` gets quoted
   in a board deck, one called `ASSUMED_OUTPUT_RATE_USD_PER_MTOK` does not. */
export const ASSUMPTIONS = {
  /* Per decision surfaced, covering the three call sites `engine/llm.js`
     documents — root cause, recommendation, executive summary. Ranged because
     prompt and output length genuinely vary with how much evidence a decision
     carries, not to manufacture a spread. */
  ASSUMED_CALLS_PER_DECISION: 3,
  ASSUMED_TOKENS_IN_PER_DECISION: [2000, 3500],
  ASSUMED_TOKENS_OUT_PER_DECISION: [700, 1100],
  ASSUMED_INPUT_RATE_USD_PER_MTOK: 3,
  ASSUMED_OUTPUT_RATE_USD_PER_MTOK: 15,

  /* Copilot inference is a SEPARATE line from decision inference, because it
     has a different risk shape: decisions are bounded by what the engine
     raises, whereas queries are unbounded by user behaviour. One curious
     director on a Friday afternoon is the tail this line exists to expose. */
  ASSUMED_COPILOT_QUERIES_PER_MONTH: [40, 160],
  ASSUMED_TOKENS_PER_COPILOT_QUERY: [1500, 4000],

  /* Detection is arithmetic over a dataset that fits in memory: hosting and
     storage for a scored book, not model spend. */
  ASSUMED_COMPUTE_USD_PER_1K_ACCOUNTS_MONTH: 4,

  /* THE LINE THAT DOMINATES EVERYTHING ELSE.
     A licensed market-intelligence feed — Crunchbase, Tracxn, ZoomInfo class —
     is $25–50K per source per year, recurring, and it does NOT scale down for
     small customers. It is a fixed cost of carrying the capability at all,
     which is why it is amortised across the paying base below rather than
     charged per lookup. Modelling it per-lookup was the first mistake this
     file made: it made a $50K/year commitment look like two cents. */
  ASSUMED_FEED_USD_PER_SOURCE_YEAR: [25000, 50000],
  ASSUMED_FEED_SOURCES: 2,
  /* Ten Growth customers is the seed-round milestone the proposal is built
     around, so it is the base the fixed feed cost is spread over. Change this
     and the whole external-signals economic case moves — which is the point of
     surfacing it as an input rather than burying it in a constant. */
  ASSUMED_PAYING_CUSTOMERS: 10,

  /* Automatic speech recognition, per call transcribed. Zero in this build.
     The architecture that keeps it survivable is worth stating: ingest 100% of
     CDR metadata, which is cheap, and transcribe SELECTIVELY on a detection
     trigger rather than transcribing everything. */
  ASSUMED_ASR_USD_PER_CALL: 0.06,
  ASSUMED_CALLS_PER_ACCOUNT_MONTH: 1.2,
  ASSUMED_TRANSCRIBE_SHARE: 0.15,

  /* Support and customer success, allocated to cost of goods.
     ------------------------------------------------------------------------
     Not in the proposal's list of cost drivers, and included anyway, because
     it is the whole substance of the proposal's OPEN QUESTION 1: "if we
     support those customers as heavily as Growth ones, the tier loses money."
     That question cannot be answered by a model that does not carry a support
     line, and an earlier cut of this file reported a 99% gross margin
     precisely because it did not have one.

     Allocated per thousand accounts rather than as a share of revenue — CS
     effort tracks book size, and a percentage-of-price line would make margin
     mathematically insensitive to volume and bury the architecture story. */
  ASSUMED_SUPPORT_USD_PER_1K_ACCOUNTS_MONTH: [200, 320],
};

/**
 * The counters, per customer per month.
 *
 * `ledgerRows` is optional: on a freshly opened session the ledger holds only
 * the seeded history, and on a long-running one it holds real episodes too.
 * Either way the monthly rate is derived from the span the rows actually
 * cover rather than assumed, so a session open for ten minutes does not report
 * ten minutes of decisions as a monthly total.
 */
export function costMetrics(ds, engineRun, ledgerRows = [], { entitled, asOf = Date.now(), copilotQueries = 0 } = {}) {
  const accounts = accountsUnderManagement(ds);

  /* Decisions surfaced per month.
     ------------------------------------------------------------------------
     The tempting definition is `engine.insights.length`, and it is wrong: that
     is how many risks are OPEN right now, and the engine re-raises the same
     ones every ~9 seconds. Counting passes would report thousands of decisions
     a day for an operation that produced nine.

     A decision is an EPISODE — one `insight_id#episode` row on the ledger,
     opened once and closed once. So the honest rate is episodes divided by the
     span of time the ledger actually covers. */
  const surfacedAt = ledgerRows.map((r) => r.surfaced_at).filter((n) => typeof n === 'number');
  const spanMs = surfacedAt.length > 1 ? Math.max(...surfacedAt) - Math.min(...surfacedAt) : 0;
  const spanMonths = spanMs > 0 ? spanMs / (MONTH_DAYS * DAY_MS) : 0;
  const decisionsPerMonth = spanMonths >= 1
    ? Math.round(ledgerRows.length / spanMonths)
    /* Too short a span to divide by — a fresh session, or a ledger with one
       row. Fall back to what the engine is holding open right now, which is
       the same order of magnitude and does not require inventing a duration. */
    : (engineRun?.stats?.insights_built ?? ledgerRows.length);

  const trailing30 = surfacedAt.filter((t) => asOf - t <= MONTH_DAYS * DAY_MS).length;

  return {
    /* ── MEASURED ─────────────────────────────────────────────────────── */
    decisions_surfaced: decisionsPerMonth,
    decisions_surfaced_trailing_30d: trailing30,
    accounts_processed: accounts,
    records_scanned: engineRun?.stats?.records_in ?? 0,
    /* Real: every question actually asked of the Copilot in this session. */
    copilot_queries: copilotQueries,

    /* Zero, and structurally so. `engine/llm.js` throws by design and the
       Copilot is templated NLG over insight objects, so this build has never
       made an inference call and cannot accidentally start. These stay in the
       shape because the shape is what a real deployment fills in — reporting
       them as absent would hide the line item rather than measure it. */
    inference_calls: 0,
    inference_tokens_in: 0,
    inference_tokens_out: 0,

    /* Zero until contact centre ships. There is no telephony source in this
       build, so no figure anywhere in the product derives from call data. */
    calls_transcribed: 0,

    /* Licensed feeds are a FIXED annual commitment, not a per-account meter,
       so what is reported here is whether the capability is carried at all. */
    external_feed_sources: entitled?.can('external_signals') ? ASSUMPTIONS.ASSUMED_FEED_SOURCES : 0,
  };
}

/* Rounds a dollar figure the way it will be printed, so the arithmetic a
   reader does by hand matches the arithmetic here. Two decimals below $100,
   whole dollars above it. */
const money = (v) => (Math.abs(v) < 100 ? Math.round(v * 100) / 100 : Math.round(v));

/**
 * Cost of goods and gross margin, as a range, with every input returned
 * alongside so the surface can print the working.
 *
 * The ordering rule from CLAUDE.md §3.1 is obeyed literally: each input is
 * rounded to the precision it will be DISPLAYED at, and the range is computed
 * from those rounded values.
 */
export function marginModel(metrics, tier, entitled, a = ASSUMPTIONS) {
  const price = tier.list_price_usd_month;

  /* Inputs, at display precision, before anything is multiplied. */
  const decisions = Math.round(metrics.decisions_surfaced);
  const accounts = Math.round(metrics.accounts_processed);

  const can = (f) => (entitled ? entitled.can(f) : true);

  /* ── Decision inference ────────────────────────────────────────────────
     Low uses the low end of BOTH token ranges and high uses the high end of
     both: the two move together, because a decision carrying more evidence has
     both a longer prompt and a longer narration. Pairing low-in with high-out
     would produce a wider band than the model supports and read as hedging. */
  const tIn = a.ASSUMED_TOKENS_IN_PER_DECISION;
  const tOut = a.ASSUMED_TOKENS_OUT_PER_DECISION;
  const inferenceAt = (i, o) => money(
    (decisions * i / 1e6) * a.ASSUMED_INPUT_RATE_USD_PER_MTOK
    + (decisions * o / 1e6) * a.ASSUMED_OUTPUT_RATE_USD_PER_MTOK,
  );
  const inferenceLow = inferenceAt(tIn[0], tOut[0]);
  const inferenceHigh = inferenceAt(tIn[1], tOut[1]);

  /* ── Copilot inference — Enterprise only, and unbounded by us ──────────── */
  const q = a.ASSUMED_COPILOT_QUERIES_PER_MONTH;
  const qTok = a.ASSUMED_TOKENS_PER_COPILOT_QUERY;
  const copilotAt = (n, t) => money((n * t / 1e6) * a.ASSUMED_OUTPUT_RATE_USD_PER_MTOK);
  const copilotLow = can('executive_copilot') ? copilotAt(q[0], qTok[0]) : 0;
  const copilotHigh = can('executive_copilot') ? copilotAt(q[1], qTok[1]) : 0;

  /* ── Compute & storage ─────────────────────────────────────────────────── */
  const compute = money((accounts / 1000) * a.ASSUMED_COMPUTE_USD_PER_1K_ACCOUNTS_MONTH);

  /* ── Licensed feeds — fixed, annual, amortised ──────────────────────────
     Per month per customer = (sources × $/source/year) ÷ 12 ÷ paying base.
     The division by the customer base is the entire economics of this line:
     at one customer it is larger than the Growth price, and at ten it is a
     rounding error. That is why external signals cannot sit on Essential. */
  const feedMonthly = (rate) => (a.ASSUMED_FEED_SOURCES * rate) / 12 / a.ASSUMED_PAYING_CUSTOMERS;
  const feedLow = can('external_signals') ? money(feedMonthly(a.ASSUMED_FEED_USD_PER_SOURCE_YEAR[0])) : 0;
  const feedHigh = can('external_signals') ? money(feedMonthly(a.ASSUMED_FEED_USD_PER_SOURCE_YEAR[1])) : 0;

  /* ── ASR — zero, because contact centre does not ship ──────────────────── */
  const asrModelled = money(accounts * a.ASSUMED_CALLS_PER_ACCOUNT_MONTH * a.ASSUMED_TRANSCRIBE_SHARE * a.ASSUMED_ASR_USD_PER_CALL);
  const asr = metrics.calls_transcribed > 0 ? money(metrics.calls_transcribed * a.ASSUMED_ASR_USD_PER_CALL) : 0;

  /* ── Support ───────────────────────────────────────────────────────────── */
  const sup = a.ASSUMED_SUPPORT_USD_PER_1K_ACCOUNTS_MONTH;
  const supportLow = money((accounts / 1000) * sup[0]);
  const supportHigh = money((accounts / 1000) * sup[1]);

  /* Note which way round these go: the HIGH cost produces the LOW margin. */
  const cogsLow = money(inferenceLow + copilotLow + compute + feedLow + asr + supportLow);
  const cogsHigh = money(inferenceHigh + copilotHigh + compute + feedHigh + asr + supportHigh);

  const pct = (cogs) => (price > 0 ? Math.round(((price - cogs) / price) * 100) : null);

  return {
    price_usd_month: price,
    price_is_floor: !!tier.price_is_floor,
    line_items: [
      { k: 'Decision inference', low: inferenceLow, high: inferenceHigh,
        basis: `${decisions} decisions × ${tIn[0]}–${tIn[1]} in / ${tOut[0]}–${tOut[1]} out tokens @ $${a.ASSUMED_INPUT_RATE_USD_PER_MTOK}/$${a.ASSUMED_OUTPUT_RATE_USD_PER_MTOK} per Mtok`,
        measured: false },
      { k: 'Copilot inference', low: copilotLow, high: copilotHigh,
        basis: can('executive_copilot')
          ? `${q[0]}–${q[1]} queries × ${qTok[0]}–${qTok[1]} tokens — unbounded by user behaviour`
          : 'not entitled on this plan',
        measured: false },
      { k: 'Licensed feeds', low: feedLow, high: feedHigh,
        basis: can('external_signals')
          ? `${a.ASSUMED_FEED_SOURCES} sources × $${(a.ASSUMED_FEED_USD_PER_SOURCE_YEAR[0] / 1000)}–${(a.ASSUMED_FEED_USD_PER_SOURCE_YEAR[1] / 1000)}K per year ÷ 12 ÷ ${a.ASSUMED_PAYING_CUSTOMERS} customers`
          : 'not entitled on this plan — the feed is not carried',
        measured: false },
      { k: 'Compute & storage', low: compute, high: compute,
        basis: `${accounts.toLocaleString()} accounts @ $${a.ASSUMED_COMPUTE_USD_PER_1K_ACCOUNTS_MONTH} per 1,000 / month`,
        measured: false },
      { k: 'Support & CS', low: supportLow, high: supportHigh,
        basis: `${accounts.toLocaleString()} accounts @ $${sup[0]}–$${sup[1]} per 1,000 / month`,
        measured: false },
      { k: 'Call transcription (ASR)', low: asr, high: asr,
        basis: `0 calls — no telephony source connected. At ${a.ASSUMED_CALLS_PER_ACCOUNT_MONTH} calls/account/month with ${Math.round(a.ASSUMED_TRANSCRIBE_SHARE * 100)}% selectively transcribed this would be about $${asrModelled}`,
        measured: true },
    ],
    cogs_low_usd: cogsLow,
    cogs_high_usd: cogsHigh,
    margin_low_pct: pct(cogsHigh),
    margin_high_pct: pct(cogsLow),
    meets_target: pct(cogsHigh) != null && pct(cogsHigh) >= 70,
    /* How much of modelled cost tracks decisions rather than volume ingested.
       The architecture claim, stated as a proportion so it survives whatever
       the rates turn out to be. */
    decision_scaled_share_pct: cogsHigh > 0 ? Math.round((inferenceHigh / cogsHigh) * 100) : 0,
    assumptions: a,
  };
}

/**
 * "Target gross margin above 70% at Growth tier. If we cannot hit that, the
 * tier is priced wrong, not the architecture."
 *
 * So: how many paying customers does the licensed feed have to be spread
 * across before Growth clears 70% at its own ceiling? Solved rather than
 * guessed, because the feed is the only cost line with a lever on it that is
 * neither a price rise nor a support cut.
 *
 * Returns null if the tier clears the target with the feed cost ignored
 * entirely — in that case the feed is not what is binding and the answer lies
 * in the support line instead.
 */
export function feedBreakEven(tier, entitled, targetPct = 70, a = ASSUMPTIONS) {
  const accounts = tier.max_accounts;
  if (accounts == null) return null;
  const price = tier.list_price_usd_month;
  const budget = price * (1 - targetPct / 100);

  const atCeiling = { decisions_surfaced: 3, accounts_processed: accounts, records_scanned: 0, calls_transcribed: 0, external_feed_sources: 0, copilot_queries: 0 };
  /* Everything except the feed, at the pessimistic end — that is the case the
     target has to survive. */
  const noFeed = marginModel(atCeiling, tier, entitled, { ...a, ASSUMED_FEED_USD_PER_SOURCE_YEAR: [0, 0] });
  const headroom = budget - noFeed.cogs_high_usd;
  if (headroom <= 0) {
    return { reachable: false, customers_needed: null, headroom_usd: Math.round(headroom), target_pct: targetPct };
  }
  const annual = a.ASSUMED_FEED_SOURCES * a.ASSUMED_FEED_USD_PER_SOURCE_YEAR[1];
  return {
    reachable: true,
    customers_needed: Math.ceil(annual / 12 / headroom),
    headroom_usd: Math.round(headroom),
    target_pct: targetPct,
    at_current_base: a.ASSUMED_PAYING_CUSTOMERS,
  };
}

/**
 * OPEN QUESTION 1, answered rather than assumed: is $1,500 Essential viable?
 *
 * The proposal's own framing is the test — "if we support those customers as
 * heavily as Growth ones, the tier loses money" — so this runs the Essential
 * price against a book at the Essential CEILING, and then again against the
 * support load a Growth customer generates. If the second case fails the
 * margin target, the answer is that the tier only works with a lighter
 * support model, which is a commercial decision and not an engineering one.
 */
export function essentialViability(tiers, entitledFor, a = ASSUMPTIONS) {
  const t = tiers.essential;
  const atCeiling = { decisions_surfaced: 3, accounts_processed: t.max_accounts, records_scanned: 0, calls_transcribed: 0, external_feed_sources: 0, copilot_queries: 0 };
  const light = marginModel(atCeiling, t, entitledFor('essential'), a);

  /* Same price, same 500-account book, but supported like a Growth account —
     the proposal's stated failure mode, modelled as triple the support load
     rather than as a different rate card. */
  const heavyRates = {
    ...a,
    ASSUMED_SUPPORT_USD_PER_1K_ACCOUNTS_MONTH: [
      a.ASSUMED_SUPPORT_USD_PER_1K_ACCOUNTS_MONTH[0] * 3,
      a.ASSUMED_SUPPORT_USD_PER_1K_ACCOUNTS_MONTH[1] * 3,
    ],
  };
  const heavy = marginModel(atCeiling, t, entitledFor('essential'), heavyRates);

  return {
    light_support: light,
    heavy_support: heavy,
    verdict: heavy.meets_target
      ? 'Viable even under Growth-level support load.'
      : light.meets_target
        ? 'Viable only with a lighter support model — self-serve onboarding and pooled support, not a named CSM.'
        : 'Does not clear the margin target at its own ceiling. Starting at Growth is the safer call.',
  };
}
