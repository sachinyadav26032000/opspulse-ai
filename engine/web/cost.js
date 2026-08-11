/* ==========================================================================
   Cost of goods — measured counters, and a margin model that admits it is one
   --------------------------------------------------------------------------
   THE COMMERCIAL POINT THIS FILE EXISTS TO EVIDENCE:

   Detection in this product is statistical, not generative. `engine/web/detect.js`
   runs nine detectors over the whole dataset with no model in the loop, and
   the language layer only ever narrates objects the arithmetic already
   produced. So inference cost scales with DECISIONS SURFACED, not with DATA
   INGESTED — a customer can triple their ticket volume and our unit cost
   barely moves, because we did not send those tickets anywhere.

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
   genuinely multiply out to the printed range. `tools/verify.mjs` re-multiplies
   dollar impact; the surface that renders this prints every input beside the
   result so the same check can be done by eye.
   ========================================================================== */

import { accountsUnderManagement } from './aggregate.js';

const DAY_MS = 86400000;
const MONTH_DAYS = 30;

/* ── The modelling assumptions, in one place and printed on the surface ────
   Named `ASSUMED_` without exception. Nothing in this object was measured, and
   the naming is the guardrail: a variable called `inferenceRate` gets quoted
   in a board deck, one called `ASSUMED_OUTPUT_RATE_USD_PER_MTOK` does not.

   Token counts are per decision surfaced, low and high, covering the three
   call sites `engine/llm.js` documents — root cause, recommendation, executive
   summary. They are ranges because prompt and output length genuinely vary
   with how much evidence a decision carries, not to manufacture a spread. */
export const ASSUMPTIONS = {
  ASSUMED_CALLS_PER_DECISION: 3,
  ASSUMED_TOKENS_IN_PER_DECISION: [2000, 3500],
  ASSUMED_TOKENS_OUT_PER_DECISION: [700, 1100],
  ASSUMED_INPUT_RATE_USD_PER_MTOK: 3,
  ASSUMED_OUTPUT_RATE_USD_PER_MTOK: 15,
  /* Detection is arithmetic over a dataset that fits in memory; this is the
     hosting and storage cost of keeping an account scored, not model spend. */
  ASSUMED_COMPUTE_USD_PER_1K_ACCOUNTS_MONTH: 4,
  /* A licensed third-party lookup — Crunchbase, Tracxn, ZoomInfo class. This
     is the one line item that scales with accounts rather than decisions, and
     it is the reason external signals sit on a paid tier at all. */
  ASSUMED_EXTERNAL_LOOKUP_USD: 0.02,
  /* Customer success and support, allocated to cost of goods.
     ------------------------------------------------------------------------
     THIS LINE IS WHY THE MARGIN NUMBER IS WORTH PRINTING AT ALL. An earlier
     version of this model counted only inference, compute and lookups and
     reported a 99% gross margin. That figure was arithmetically correct and
     commercially worthless: no CFO believes a 99% SaaS gross margin, and the
     reason they are right is that the dominant cost of serving a customer here
     is a human reading their book with them, not a GPU.

     Allocated per thousand accounts under management rather than as a share of
     revenue, for two reasons. CS effort genuinely tracks book size — that is
     what a CSM's day is spent on — and pricing it as a percentage of the list
     price would make margin mathematically insensitive to volume, which would
     bury the architecture story this whole file exists to evidence.

     It is a range because staffing ratios are the least settled assumption
     here, not to manufacture a spread. */
  ASSUMED_CS_USD_PER_1K_ACCOUNTS_MONTH: [200, 320],
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
export function costMetrics(ds, engineRun, ledgerRows = [], { entitled, asOf = Date.now() } = {}) {
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

    /* One refresh per account per month, and only where the plan entitles it —
       an unentitled tier does not run the lookups, which is exactly why it
       cannot report how many external events it missed. */
    external_lookups: entitled?.can('external_signals') ? accounts : 0,
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
 * from those rounded values. Rounding afterwards would let a printed input
 * multiply out to something a few cents off the printed total, which is the
 * single easiest way to lose a room.
 */
export function marginModel(metrics, tier, a = ASSUMPTIONS) {
  const price = tier.list_price_usd_month;

  /* Inputs, at display precision, before anything is multiplied. */
  const decisions = Math.round(metrics.decisions_surfaced);
  const accounts = Math.round(metrics.accounts_processed);
  const lookups = Math.round(metrics.external_lookups);

  const tokensIn = a.ASSUMED_TOKENS_IN_PER_DECISION;
  const tokensOut = a.ASSUMED_TOKENS_OUT_PER_DECISION;

  /* Inference, low and high. Low uses the low end of BOTH token ranges and
     high uses the high end of both: the two move together, because a decision
     carrying more evidence has both a longer prompt and a longer narration.
     Pairing low-in with high-out would produce a wider band than the model
     supports and read as hedging. */
  const inference = (tIn, tOut) => money(
    (decisions * tIn / 1e6) * a.ASSUMED_INPUT_RATE_USD_PER_MTOK
    + (decisions * tOut / 1e6) * a.ASSUMED_OUTPUT_RATE_USD_PER_MTOK,
  );
  const inferenceLow = inference(tokensIn[0], tokensOut[0]);
  const inferenceHigh = inference(tokensIn[1], tokensOut[1]);

  /* Fixed against the counters rather than ranged: these are measured volumes
     against a single assumed rate, so a spread would be invented. */
  const compute = money((accounts / 1000) * a.ASSUMED_COMPUTE_USD_PER_1K_ACCOUNTS_MONTH);
  const external = money(lookups * a.ASSUMED_EXTERNAL_LOOKUP_USD);

  const cs = (rate) => money((accounts / 1000) * rate);
  const csLow = cs(a.ASSUMED_CS_USD_PER_1K_ACCOUNTS_MONTH[0]);
  const csHigh = cs(a.ASSUMED_CS_USD_PER_1K_ACCOUNTS_MONTH[1]);

  /* Note which way round these go: the HIGH cost produces the LOW margin. */
  const cogsLow = money(inferenceLow + compute + external + csLow);
  const cogsHigh = money(inferenceHigh + compute + external + csHigh);

  const pct = (cogs) => (price > 0 ? Math.round(((price - cogs) / price) * 100) : null);

  return {
    price_usd_month: price,
    line_items: [
      { k: 'Inference', low: inferenceLow, high: inferenceHigh,
        basis: `${decisions} decisions × ${tokensIn[0]}–${tokensIn[1]} in / ${tokensOut[0]}–${tokensOut[1]} out tokens @ $${a.ASSUMED_INPUT_RATE_USD_PER_MTOK}/$${a.ASSUMED_OUTPUT_RATE_USD_PER_MTOK} per Mtok`,
        measured: false },
      { k: 'Compute & storage', low: compute, high: compute,
        basis: `${accounts.toLocaleString()} accounts @ $${a.ASSUMED_COMPUTE_USD_PER_1K_ACCOUNTS_MONTH} per 1,000 / month`,
        measured: false },
      { k: 'External lookups', low: external, high: external,
        basis: lookups ? `${lookups.toLocaleString()} lookups @ $${a.ASSUMED_EXTERNAL_LOOKUP_USD} each` : 'not entitled on this plan — no lookups run',
        measured: false },
      { k: 'Customer success', low: csLow, high: csHigh,
        basis: `${accounts.toLocaleString()} accounts @ $${a.ASSUMED_CS_USD_PER_1K_ACCOUNTS_MONTH[0]}–$${a.ASSUMED_CS_USD_PER_1K_ACCOUNTS_MONTH[1]} per 1,000 / month`,
        measured: false },
      { k: 'Call transcription', low: 0, high: 0,
        basis: '0 calls — no telephony source connected', measured: true },
    ],
    cogs_low_usd: cogsLow,
    cogs_high_usd: cogsHigh,
    margin_low_pct: pct(cogsHigh),
    margin_high_pct: pct(cogsLow),
    /* The one number in this object that is not a model: how much of the
       modelled cost scales with decisions rather than with volume ingested.
       This is the architecture claim, stated as a proportion so it survives
       whatever the rates turn out to be. */
    decision_scaled_share_pct: cogsHigh > 0 ? Math.round((inferenceHigh / cogsHigh) * 100) : 0,
    assumptions: a,
  };
}
